//! Batched filled axis-aligned rectangles in one instanced draw call.
//!
//! Each instance is an axis-aligned box given by its min/max corners in
//! world space plus an RGBA color. This is the batched renderer for things
//! like the sorting-lab bars, where thousands of filled rects must be drawn
//! per frame as a single instanced call.
//!
//! Pure draw call: the caller owns blend state.

use web_sys::{WebGl2RenderingContext as Gl, WebGlBuffer, WebGlVertexArrayObject};

use super::shader::ShaderProgram;

/// Per-instance data. Layout in the GPU buffer is tightly packed:
/// [min.x, min.y, max.x, max.y, color.r, color.g, color.b, color.a]
#[derive(Debug, Clone, Copy)]
pub struct QuadInstance {
    pub min: [f32; 2],
    pub max: [f32; 2],
    pub color: [f32; 4],
}

/// min.x, min.y, max.x, max.y, rgba
const FLOATS_PER_INSTANCE: usize = 8;

const VERTEX_SRC: &str = r#"#version 300 es
precision mediump float;

// Unit quad vertices (per-vertex, shared across instances). Corners are in
// [0, 1] so they can be mixed directly between a_min and a_max.
layout(location=0) in vec2 a_corner;

// Per-instance attributes.
layout(location=1) in vec2 a_min;
layout(location=2) in vec2 a_max;
layout(location=3) in vec4 a_color;

uniform mat3 u_proj;

out vec4 v_color;

void main() {
    v_color = a_color;
    vec2 p = mix(a_min, a_max, a_corner);
    gl_Position = vec4((u_proj * vec3(p, 1.0)).xy, 0.0, 1.0);
}
"#;

const FRAGMENT_SRC: &str = r#"#version 300 es
precision mediump float;

in vec4 v_color;

out vec4 frag_color;

void main() {
    frag_color = v_color;
}
"#;

pub struct InstancedQuads {
    program: ShaderProgram,
    vao: WebGlVertexArrayObject,
    quad_buffer: WebGlBuffer,
    instance_buffer: WebGlBuffer,
    instance_count: usize,
    u_proj_loc: Option<web_sys::WebGlUniformLocation>,
    gl: Gl,
}

impl InstancedQuads {
    pub fn new(gl: &Gl) -> Result<Self, String> {
        let program = ShaderProgram::new(gl, VERTEX_SRC, FRAGMENT_SRC)?;

        // Static unit quad buffer: triangle strip, four corners in [0, 1].
        let quad: [f32; 8] = [0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 1.0];
        let quad_buffer = gl.create_buffer().ok_or("create_buffer (quad)")?;
        gl.bind_buffer(Gl::ARRAY_BUFFER, Some(&quad_buffer));
        unsafe {
            let view = js_sys::Float32Array::view(&quad);
            gl.buffer_data_with_array_buffer_view(Gl::ARRAY_BUFFER, &view, Gl::STATIC_DRAW);
        }

        let instance_buffer = gl.create_buffer().ok_or("create_buffer (instances)")?;

        let vao = gl.create_vertex_array().ok_or("create_vertex_array")?;
        gl.bind_vertex_array(Some(&vao));

        // a_corner (vec2) — per-vertex, attribute 0.
        gl.bind_buffer(Gl::ARRAY_BUFFER, Some(&quad_buffer));
        gl.enable_vertex_attrib_array(0);
        gl.vertex_attrib_pointer_with_i32(0, 2, Gl::FLOAT, false, 0, 0);

        // Instance attributes 1..=3, divisor 1.
        gl.bind_buffer(Gl::ARRAY_BUFFER, Some(&instance_buffer));
        let stride = (FLOATS_PER_INSTANCE * 4) as i32;
        // a_min (vec2) — offset 0
        gl.enable_vertex_attrib_array(1);
        gl.vertex_attrib_pointer_with_i32(1, 2, Gl::FLOAT, false, stride, 0);
        gl.vertex_attrib_divisor(1, 1);
        // a_max (vec2) — offset 2 floats
        gl.enable_vertex_attrib_array(2);
        gl.vertex_attrib_pointer_with_i32(2, 2, Gl::FLOAT, false, stride, 2 * 4);
        gl.vertex_attrib_divisor(2, 1);
        // a_color (vec4) — offset 4 floats
        gl.enable_vertex_attrib_array(3);
        gl.vertex_attrib_pointer_with_i32(3, 4, Gl::FLOAT, false, stride, 4 * 4);
        gl.vertex_attrib_divisor(3, 1);

        gl.bind_vertex_array(None);

        let u_proj_loc = program.uniform_location(gl, "u_proj");

        Ok(Self {
            program,
            vao,
            quad_buffer,
            instance_buffer,
            instance_count: 0,
            u_proj_loc,
            gl: gl.clone(),
        })
    }

    /// Upload a new instance set. Pass `&[]` to clear.
    pub fn upload(&mut self, gl: &Gl, instances: &[QuadInstance]) {
        self.instance_count = instances.len();
        let packed = pack(instances);
        gl.bind_buffer(Gl::ARRAY_BUFFER, Some(&self.instance_buffer));
        unsafe {
            let view = js_sys::Float32Array::view(&packed);
            gl.buffer_data_with_array_buffer_view(Gl::ARRAY_BUFFER, &view, Gl::DYNAMIC_DRAW);
        }
    }

    /// Draw the previously-uploaded quads with the given projection matrix
    /// (column-major mat3, world -> clip).
    ///
    /// The caller owns blend state; this only issues the draw call.
    pub fn draw(&self, gl: &Gl, proj: &[f32; 9]) {
        if self.instance_count == 0 {
            return;
        }
        self.program.use_program(gl);
        gl.uniform_matrix3fv_with_f32_array(self.u_proj_loc.as_ref(), false, proj);
        gl.bind_vertex_array(Some(&self.vao));
        gl.draw_arrays_instanced(Gl::TRIANGLE_STRIP, 0, 4, self.instance_count as i32);
        gl.bind_vertex_array(None);
    }
}

impl Drop for InstancedQuads {
    fn drop(&mut self) {
        self.gl.delete_vertex_array(Some(&self.vao));
        self.gl.delete_buffer(Some(&self.instance_buffer));
        self.gl.delete_buffer(Some(&self.quad_buffer));
        // self.program's own Drop deletes the WebGlProgram.
    }
}

/// Flatten instances into the GPU layout:
/// [min.x, min.y, max.x, max.y, R, G, B, A] per quad.
fn pack(instances: &[QuadInstance]) -> Vec<f32> {
    let mut packed = Vec::with_capacity(instances.len() * FLOATS_PER_INSTANCE);
    for inst in instances {
        packed.push(inst.min[0]);
        packed.push(inst.min[1]);
        packed.push(inst.max[0]);
        packed.push(inst.max[1]);
        packed.push(inst.color[0]);
        packed.push(inst.color[1]);
        packed.push(inst.color[2]);
        packed.push(inst.color[3]);
    }
    packed
}

// Only `pack` is testable natively; `new`/`upload`/`draw` need a real WebGL
// context and are exercised by the wasm-bindgen browser tests.
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pack_empty_is_empty() {
        assert!(pack(&[]).is_empty());
    }

    #[test]
    fn pack_two_instances_in_documented_order() {
        let quads = [
            QuadInstance {
                min: [0.0, 0.0],
                max: [1.0, 2.0],
                color: [0.1, 0.2, 0.3, 0.4],
            },
            QuadInstance {
                min: [-5.0, 6.5],
                max: [-4.0, 7.5],
                color: [1.0, 0.0, 0.5, 1.0],
            },
        ];
        let packed = pack(&quads);
        assert_eq!(packed.len(), 2 * FLOATS_PER_INSTANCE);
        assert_eq!(
            packed,
            vec![
                0.0, 0.0, 1.0, 2.0, 0.1, 0.2, 0.3, 0.4, // quad 0
                -5.0, 6.5, -4.0, 7.5, 1.0, 0.0, 0.5, 1.0, // quad 1
            ]
        );
    }
}
