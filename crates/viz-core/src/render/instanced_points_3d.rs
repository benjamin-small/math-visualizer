//! 3D analog of `InstancedPoints`. Each instance has a 3D world position, an
//! RGBA color, and a pixel-space radius. The quad expansion happens **after**
//! the perspective projection (multiplying the screen-space radius by clip.w
//! so the post-division pixel size stays constant). Antialiased disc fragment
//! shader, identical to the 2D version.

use web_sys::{WebGl2RenderingContext as Gl, WebGlBuffer, WebGlVertexArrayObject};

use super::shader::ShaderProgram;

/// Per-instance data. Tightly packed: [pos.x, pos.y, pos.z, r, g, b, a, radius_px].
#[derive(Debug, Clone, Copy)]
pub struct PointInstance3D {
    pub position: [f32; 3],
    pub color: [f32; 4],
    pub radius_px: f32,
}

const FLOATS_PER_INSTANCE: usize = 8;

const VERTEX_SRC: &str = r#"#version 300 es
precision mediump float;

layout(location=0) in vec2 a_corner;        // unit quad
layout(location=1) in vec3 a_position;
layout(location=2) in vec4 a_color;
layout(location=3) in float a_radius_px;

uniform mat4 u_view_proj;
uniform vec2 u_viewport_px;

out vec2 v_corner;
out vec4 v_color;

void main() {
    v_corner = a_corner;
    v_color = a_color;

    // Project the instance center; THEN offset by the (pixel-sized) corner
    // expressed in clip units. Multiplying by clip.w means after the
    // rasterizer's /w division the offset is exactly a_radius_px pixels,
    // regardless of depth.
    vec4 clip = u_view_proj * vec4(a_position, 1.0);
    vec2 radius_clip = vec2(a_radius_px) * 2.0 / u_viewport_px * clip.w;
    gl_Position = vec4(clip.xy + a_corner * radius_clip, clip.zw);
}
"#;

const FRAGMENT_SRC: &str = r#"#version 300 es
precision mediump float;

in vec2 v_corner;
in vec4 v_color;

out vec4 frag_color;

void main() {
    float dist = length(v_corner);
    float alpha = smoothstep(1.0, 0.9, dist);
    if (alpha <= 0.0) discard;
    frag_color = vec4(v_color.rgb, v_color.a * alpha);
}
"#;

pub struct InstancedPoints3D {
    program: ShaderProgram,
    vao: WebGlVertexArrayObject,
    instance_buffer: WebGlBuffer,
    instance_count: usize,
    u_view_proj_loc: Option<web_sys::WebGlUniformLocation>,
    u_viewport_loc: Option<web_sys::WebGlUniformLocation>,
}

impl InstancedPoints3D {
    pub fn new(gl: &Gl) -> Result<Self, String> {
        let program = ShaderProgram::new(gl, VERTEX_SRC, FRAGMENT_SRC)?;

        // Static quad buffer: triangle strip, four corners in [-1, 1].
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

        // a_corner (vec2) — per-vertex, attribute 0.
        gl.bind_buffer(Gl::ARRAY_BUFFER, Some(&quad_buf));
        gl.enable_vertex_attrib_array(0);
        gl.vertex_attrib_pointer_with_i32(0, 2, Gl::FLOAT, false, 0, 0);

        // Instance attributes 1..=3.
        gl.bind_buffer(Gl::ARRAY_BUFFER, Some(&instance_buffer));
        let stride = (FLOATS_PER_INSTANCE * 4) as i32;
        // a_position (vec3)
        gl.enable_vertex_attrib_array(1);
        gl.vertex_attrib_pointer_with_i32(1, 3, Gl::FLOAT, false, stride, 0);
        gl.vertex_attrib_divisor(1, 1);
        // a_color (vec4) — offset 3 floats
        gl.enable_vertex_attrib_array(2);
        gl.vertex_attrib_pointer_with_i32(2, 4, Gl::FLOAT, false, stride, 3 * 4);
        gl.vertex_attrib_divisor(2, 1);
        // a_radius_px (float) — offset 7 floats
        gl.enable_vertex_attrib_array(3);
        gl.vertex_attrib_pointer_with_i32(3, 1, Gl::FLOAT, false, stride, 7 * 4);
        gl.vertex_attrib_divisor(3, 1);

        gl.bind_vertex_array(None);

        let u_view_proj_loc = program.uniform_location(gl, "u_view_proj");
        let u_viewport_loc = program.uniform_location(gl, "u_viewport_px");

        Ok(Self {
            program,
            vao,
            instance_buffer,
            instance_count: 0,
            u_view_proj_loc,
            u_viewport_loc,
        })
    }

    /// Upload a new instance set. Pass `&[]` to clear.
    pub fn upload(&mut self, gl: &Gl, instances: &[PointInstance3D]) {
        self.instance_count = instances.len();
        let mut packed = Vec::with_capacity(instances.len() * FLOATS_PER_INSTANCE);
        for inst in instances {
            packed.push(inst.position[0]);
            packed.push(inst.position[1]);
            packed.push(inst.position[2]);
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

    /// Draw the previously-uploaded instances using the given view-projection
    /// matrix (column-major mat4) and viewport size.
    pub fn draw(&self, gl: &Gl, view_proj: &[f32; 16], viewport_px: [u32; 2]) {
        if self.instance_count == 0 {
            return;
        }
        self.program.use_program(gl);
        gl.uniform_matrix4fv_with_f32_array(self.u_view_proj_loc.as_ref(), false, view_proj);
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
