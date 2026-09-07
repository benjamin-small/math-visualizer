//! Batched antialiased stroked circles ("rings") in one instanced draw call.
//!
//! Each instance has a world-space center, a world-space radius, and an RGBA
//! color. Stroke half-width and feather width are uniforms in **world units**;
//! the visualization derives them from its world-units-per-pixel so the ring
//! stays ~N pixels wide at any zoom. This is the batched replacement for
//! `SdfCircle` when hundreds of circles must be drawn per frame (e.g. the
//! epicycles in the Fourier lab).
//!
//! Pure draw call: the caller owns blend state. The rim is alpha-feathered,
//! so the caller normally wants BLEND enabled with
//! SRC_ALPHA / ONE_MINUS_SRC_ALPHA around `draw`.

use web_sys::{WebGl2RenderingContext as Gl, WebGlBuffer, WebGlVertexArrayObject};

use super::shader::ShaderProgram;

/// Per-instance data. Layout in the GPU buffer is tightly packed:
/// [center.x, center.y, radius, color.r, color.g, color.b, color.a]
#[derive(Debug, Clone, Copy)]
pub struct RingInstance {
    pub center: [f32; 2],
    pub radius: f32,
    pub color: [f32; 4],
}

/// cx, cy, r, rgba
const FLOATS_PER_INSTANCE: usize = 7;

// highp on purpose: a ~0.005-world stroke at radius ~1 is below fp16
// resolution, so mediump quantizes the SDF and bands visibly on mobile GPUs.
const VERTEX_SRC: &str = r#"#version 300 es
precision highp float;

// Unit quad vertices (per-vertex, shared across instances).
layout(location=0) in vec2 a_corner;

// Per-instance attributes.
layout(location=1) in vec2 a_center;
layout(location=2) in float a_radius;
layout(location=3) in vec4 a_color;

uniform mat3 u_proj;
uniform float u_stroke;    // stroke half-width, world units
uniform float u_feather;   // antialias band width, world units

out vec2 v_local;          // fragment offset from the ring center, world units
out float v_radius;
out vec4 v_color;

void main() {
    // The quad must cover the stroke plus the feather beyond the radius.
    float ext = a_radius + u_stroke + u_feather;
    v_local = a_corner * ext;
    v_radius = a_radius;
    v_color = a_color;
    vec3 clip = u_proj * vec3(a_center + v_local, 1.0);
    gl_Position = vec4(clip.xy, 0.0, 1.0);
}
"#;

const FRAGMENT_SRC: &str = r#"#version 300 es
precision highp float;

in vec2 v_local;
in float v_radius;
in vec4 v_color;

uniform float u_stroke;
uniform float u_feather;

out vec4 frag_color;

void main() {
    // Signed distance to the circle, folded so both sides of the stroke
    // feather symmetrically.
    float d = abs(length(v_local) - v_radius);
    float alpha = 1.0 - smoothstep(u_stroke, u_stroke + u_feather, d);
    if (alpha <= 0.0) discard;
    frag_color = vec4(v_color.rgb, v_color.a * alpha);
}
"#;

pub struct InstancedRings {
    program: ShaderProgram,
    vao: WebGlVertexArrayObject,
    quad_buffer: WebGlBuffer,
    instance_buffer: WebGlBuffer,
    instance_count: usize,
    u_proj_loc: Option<web_sys::WebGlUniformLocation>,
    u_stroke_loc: Option<web_sys::WebGlUniformLocation>,
    u_feather_loc: Option<web_sys::WebGlUniformLocation>,
    gl: Gl,
}

impl InstancedRings {
    pub fn new(gl: &Gl) -> Result<Self, String> {
        let program = ShaderProgram::new(gl, VERTEX_SRC, FRAGMENT_SRC)?;

        // Static quad buffer: triangle strip, four corners in [-1, 1].
        let quad: [f32; 8] = [-1.0, -1.0, 1.0, -1.0, -1.0, 1.0, 1.0, 1.0];
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
        // a_center (vec2) — offset 0
        gl.enable_vertex_attrib_array(1);
        gl.vertex_attrib_pointer_with_i32(1, 2, Gl::FLOAT, false, stride, 0);
        gl.vertex_attrib_divisor(1, 1);
        // a_radius (float) — offset 2 floats
        gl.enable_vertex_attrib_array(2);
        gl.vertex_attrib_pointer_with_i32(2, 1, Gl::FLOAT, false, stride, 2 * 4);
        gl.vertex_attrib_divisor(2, 1);
        // a_color (vec4) — offset 3 floats
        gl.enable_vertex_attrib_array(3);
        gl.vertex_attrib_pointer_with_i32(3, 4, Gl::FLOAT, false, stride, 3 * 4);
        gl.vertex_attrib_divisor(3, 1);

        gl.bind_vertex_array(None);

        let u_proj_loc = program.uniform_location(gl, "u_proj");
        let u_stroke_loc = program.uniform_location(gl, "u_stroke");
        let u_feather_loc = program.uniform_location(gl, "u_feather");

        Ok(Self {
            program,
            vao,
            quad_buffer,
            instance_buffer,
            instance_count: 0,
            u_proj_loc,
            u_stroke_loc,
            u_feather_loc,
            gl: gl.clone(),
        })
    }

    /// Upload a new instance set. Pass `&[]` to clear.
    pub fn upload(&mut self, gl: &Gl, instances: &[RingInstance]) {
        self.instance_count = instances.len();
        let packed = pack(instances);
        gl.bind_buffer(Gl::ARRAY_BUFFER, Some(&self.instance_buffer));
        unsafe {
            let view = js_sys::Float32Array::view(&packed);
            gl.buffer_data_with_array_buffer_view(Gl::ARRAY_BUFFER, &view, Gl::DYNAMIC_DRAW);
        }
    }

    /// Draw the previously-uploaded rings with the given projection matrix
    /// (column-major mat3, world -> clip). `stroke_world` is the stroke
    /// half-width and `feather_world` the antialias band, both in world units.
    ///
    /// The caller owns blend state; this only issues the draw call.
    pub fn draw(&self, gl: &Gl, projection: &[f32; 9], stroke_world: f32, feather_world: f32) {
        if self.instance_count == 0 {
            return;
        }
        self.program.use_program(gl);
        gl.uniform_matrix3fv_with_f32_array(self.u_proj_loc.as_ref(), false, projection);
        gl.uniform1f(self.u_stroke_loc.as_ref(), stroke_world.max(0.0));
        // A zero feather makes smoothstep's edges coincide (undefined in GLSL);
        // clamp to a tiny positive band so the ring degrades to a hard edge.
        gl.uniform1f(self.u_feather_loc.as_ref(), feather_world.max(1e-6));
        gl.bind_vertex_array(Some(&self.vao));
        gl.draw_arrays_instanced(Gl::TRIANGLE_STRIP, 0, 4, self.instance_count as i32);
        gl.bind_vertex_array(None);
    }
}

impl Drop for InstancedRings {
    fn drop(&mut self) {
        self.gl.delete_vertex_array(Some(&self.vao));
        self.gl.delete_buffer(Some(&self.instance_buffer));
        self.gl.delete_buffer(Some(&self.quad_buffer));
        // self.program's own Drop deletes the WebGlProgram.
    }
}

/// Flatten instances into the GPU layout: [cx, cy, r, R, G, B, A] per ring.
fn pack(instances: &[RingInstance]) -> Vec<f32> {
    let mut packed = Vec::with_capacity(instances.len() * FLOATS_PER_INSTANCE);
    for inst in instances {
        packed.push(inst.center[0]);
        packed.push(inst.center[1]);
        packed.push(inst.radius);
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
        let rings = [
            RingInstance {
                center: [1.0, 2.0],
                radius: 3.0,
                color: [0.1, 0.2, 0.3, 0.4],
            },
            RingInstance {
                center: [-5.0, 6.5],
                radius: 0.25,
                color: [1.0, 0.0, 0.5, 1.0],
            },
        ];
        let packed = pack(&rings);
        assert_eq!(packed.len(), 2 * FLOATS_PER_INSTANCE);
        assert_eq!(
            packed,
            vec![
                1.0, 2.0, 3.0, 0.1, 0.2, 0.3, 0.4, // ring 0
                -5.0, 6.5, 0.25, 1.0, 0.0, 0.5, 1.0, // ring 1
            ]
        );
    }
}
