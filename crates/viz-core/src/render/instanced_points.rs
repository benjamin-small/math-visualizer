//! Renders many circular dots in a single draw call. Each instance has a
//! world-space position, an RGBA color, and a pixel-space radius. The shape
//! is an antialiased disc computed in the fragment shader from gl_PointCoord
//! equivalent (we use a quad, not GL_POINTS, since GL_POINTS has size limits
//! on many platforms).

use web_sys::{WebGl2RenderingContext as Gl, WebGlBuffer, WebGlVertexArrayObject};

use super::shader::ShaderProgram;

/// Per-instance data. Layout in the GPU buffer is tightly packed:
/// [pos.x, pos.y, color.r, color.g, color.b, color.a, radius_px]
#[derive(Debug, Clone, Copy)]
pub struct PointInstance {
    pub position: [f32; 2],
    pub color: [f32; 4],
    pub radius_px: f32,
}

const FLOATS_PER_INSTANCE: usize = 7;

const VERTEX_SRC: &str = r#"#version 300 es
precision mediump float;

// Unit quad vertices (per-vertex, shared across instances).
layout(location=0) in vec2 a_corner;

// Per-instance attributes.
layout(location=1) in vec2 a_position;
layout(location=2) in vec4 a_color;
layout(location=3) in float a_radius_px;

uniform mat3 u_proj;
uniform vec2 u_viewport_px;  // for converting pixel radius to clip space

out vec2 v_corner;
out vec4 v_color;

void main() {
    v_corner = a_corner;
    v_color = a_color;

    // Project the instance position to clip space, then offset by the
    // (pixel-sized) corner expressed in clip units.
    vec3 clip = u_proj * vec3(a_position, 1.0);
    vec2 radius_clip = vec2(a_radius_px) * 2.0 / u_viewport_px;
    gl_Position = vec4(clip.xy + a_corner * radius_clip, 0.0, 1.0);
}
"#;

const FRAGMENT_SRC: &str = r#"#version 300 es
precision mediump float;

in vec2 v_corner;   // in [-1, 1] over the quad
in vec4 v_color;

out vec4 frag_color;

void main() {
    float dist = length(v_corner);
    // Antialiased disc: hard edge at dist=1 with one-pixel-ish smooth band.
    float alpha = smoothstep(1.0, 0.9, dist);
    if (alpha <= 0.0) discard;
    frag_color = vec4(v_color.rgb, v_color.a * alpha);
}
"#;

pub struct InstancedPoints {
    program: ShaderProgram,
    vao: WebGlVertexArrayObject,
    instance_buffer: WebGlBuffer,
    instance_count: usize,
    u_proj_loc: Option<web_sys::WebGlUniformLocation>,
    u_viewport_loc: Option<web_sys::WebGlUniformLocation>,
}

impl InstancedPoints {
    pub fn new(gl: &Gl) -> Result<Self, String> {
        let program = ShaderProgram::new(gl, VERTEX_SRC, FRAGMENT_SRC)?;

        // Static quad buffer: two triangles.
        let quad: [f32; 8] = [-1.0, -1.0, 1.0, -1.0, -1.0, 1.0, 1.0, 1.0];
        let quad_buf = gl.create_buffer().ok_or("create_buffer (quad)")?;
        gl.bind_buffer(Gl::ARRAY_BUFFER, Some(&quad_buf));
        unsafe {
            let view = js_sys::Float32Array::view(&quad);
            gl.buffer_data_with_array_buffer_view(Gl::ARRAY_BUFFER, &view, Gl::STATIC_DRAW);
        }

        let instance_buffer = gl.create_buffer().ok_or("create_buffer (instances)")?;

        let vao = gl.create_vertex_array().ok_or("create_vertex_array")?;
        gl.bind_vertex_array(Some(&vao));

        // Bind the static quad as attribute 0 (a_corner).
        gl.bind_buffer(Gl::ARRAY_BUFFER, Some(&quad_buf));
        gl.enable_vertex_attrib_array(0);
        gl.vertex_attrib_pointer_with_i32(0, 2, Gl::FLOAT, false, 0, 0);

        // Bind the instance buffer as attributes 1..=3.
        gl.bind_buffer(Gl::ARRAY_BUFFER, Some(&instance_buffer));
        let stride = (FLOATS_PER_INSTANCE * 4) as i32;
        // a_position (vec2)
        gl.enable_vertex_attrib_array(1);
        gl.vertex_attrib_pointer_with_i32(1, 2, Gl::FLOAT, false, stride, 0);
        gl.vertex_attrib_divisor(1, 1);
        // a_color (vec4)
        gl.enable_vertex_attrib_array(2);
        gl.vertex_attrib_pointer_with_i32(2, 4, Gl::FLOAT, false, stride, 2 * 4);
        gl.vertex_attrib_divisor(2, 1);
        // a_radius_px (float)
        gl.enable_vertex_attrib_array(3);
        gl.vertex_attrib_pointer_with_i32(3, 1, Gl::FLOAT, false, stride, 6 * 4);
        gl.vertex_attrib_divisor(3, 1);

        gl.bind_vertex_array(None);

        let u_proj_loc = program.uniform_location(gl, "u_proj");
        let u_viewport_loc = program.uniform_location(gl, "u_viewport_px");

        Ok(Self {
            program,
            vao,
            instance_buffer,
            instance_count: 0,
            u_proj_loc,
            u_viewport_loc,
        })
    }

    /// Upload a new instance set. Pass `&[]` to clear.
    pub fn upload(&mut self, gl: &Gl, instances: &[PointInstance]) {
        self.instance_count = instances.len();
        let mut packed = Vec::with_capacity(instances.len() * FLOATS_PER_INSTANCE);
        for inst in instances {
            packed.push(inst.position[0]);
            packed.push(inst.position[1]);
            packed.push(inst.color[0]);
            packed.push(inst.color[1]);
            packed.push(inst.color[2]);
            packed.push(inst.color[3]);
            packed.push(inst.radius_px);
        }
        gl.bind_buffer(Gl::ARRAY_BUFFER, Some(&self.instance_buffer));
        unsafe {
            let view = js_sys::Float32Array::view(&packed);
            gl.buffer_data_with_array_buffer_view(Gl::ARRAY_BUFFER, &view, Gl::DYNAMIC_DRAW);
        }
    }

    /// Draw the previously-uploaded instances using the given projection
    /// matrix and viewport size.
    pub fn draw(&self, gl: &Gl, projection: &[f32; 9], viewport_px: [u32; 2]) {
        if self.instance_count == 0 {
            return;
        }
        self.program.use_program(gl);
        gl.uniform_matrix3fv_with_f32_array(self.u_proj_loc.as_ref(), false, projection);
        gl.uniform2f(
            self.u_viewport_loc.as_ref(),
            viewport_px[0].max(1) as f32,
            viewport_px[1].max(1) as f32,
        );
        gl.bind_vertex_array(Some(&self.vao));
        gl.enable(Gl::BLEND);
        gl.blend_func(Gl::SRC_ALPHA, Gl::ONE_MINUS_SRC_ALPHA);
        gl.draw_arrays_instanced(Gl::TRIANGLE_STRIP, 0, 4, self.instance_count as i32);
        gl.bind_vertex_array(None);
    }
}
