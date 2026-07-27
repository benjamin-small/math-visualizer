//! Renders a batch of 1-pixel-wide line segments in a single draw call.
//! Each vertex carries a position + color so segments can be colored
//! independently.
//!
//! Note: WebGL2's gl.lineWidth is widely capped to 1 on desktop GPUs.
//! Thicker lines need triangle-based rendering, which is overkill for the
//! Phase 3 reference line between two dots — a 1px line reads fine
//! against a circle stroke.

use web_sys::{WebGl2RenderingContext as Gl, WebGlBuffer, WebGlVertexArrayObject};

use super::shader::ShaderProgram;

#[derive(Debug, Clone, Copy)]
pub struct LineVertex {
    pub position: [f32; 2],
    pub color: [f32; 4],
}

const FLOATS_PER_VERTEX: usize = 6;

const VERTEX_SRC: &str = r#"#version 300 es
precision mediump float;

layout(location=0) in vec2 a_position;
layout(location=1) in vec4 a_color;

uniform mat3 u_proj;

out vec4 v_color;

void main() {
    v_color = a_color;
    vec3 clip = u_proj * vec3(a_position, 1.0);
    gl_Position = vec4(clip.xy, 0.0, 1.0);
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

pub struct LineBatch {
    program: ShaderProgram,
    vao: WebGlVertexArrayObject,
    buffer: WebGlBuffer,
    vertex_count: usize,
    u_proj: Option<web_sys::WebGlUniformLocation>,
}

impl LineBatch {
    pub fn new(gl: &Gl) -> Result<Self, String> {
        let program = ShaderProgram::new(gl, VERTEX_SRC, FRAGMENT_SRC)?;
        let buffer = gl.create_buffer().ok_or("create_buffer")?;

        let vao = gl.create_vertex_array().ok_or("create_vertex_array")?;
        gl.bind_vertex_array(Some(&vao));
        gl.bind_buffer(Gl::ARRAY_BUFFER, Some(&buffer));
        let stride = (FLOATS_PER_VERTEX * 4) as i32;
        gl.enable_vertex_attrib_array(0);
        gl.vertex_attrib_pointer_with_i32(0, 2, Gl::FLOAT, false, stride, 0);
        gl.enable_vertex_attrib_array(1);
        gl.vertex_attrib_pointer_with_i32(1, 4, Gl::FLOAT, false, stride, 2 * 4);
        gl.bind_vertex_array(None);

        let u_proj = program.uniform_location(gl, "u_proj");

        Ok(Self {
            program,
            vao,
            buffer,
            vertex_count: 0,
            u_proj,
        })
    }

    /// Upload a flat sequence of vertices. Vertices come in pairs (one
    /// segment = two consecutive vertices). Pass `&[]` to clear.
    pub fn upload(&mut self, gl: &Gl, vertices: &[LineVertex]) {
        self.vertex_count = vertices.len();
        let mut packed = Vec::with_capacity(vertices.len() * FLOATS_PER_VERTEX);
        for v in vertices {
            packed.push(v.position[0]);
            packed.push(v.position[1]);
            packed.push(v.color[0]);
            packed.push(v.color[1]);
            packed.push(v.color[2]);
            packed.push(v.color[3]);
        }
        gl.bind_buffer(Gl::ARRAY_BUFFER, Some(&self.buffer));
        unsafe {
            let view = js_sys::Float32Array::view(&packed);
            gl.buffer_data_with_array_buffer_view(Gl::ARRAY_BUFFER, &view, Gl::DYNAMIC_DRAW);
        }
    }

    pub fn draw(&self, gl: &Gl, projection: &[f32; 9]) {
        if self.vertex_count == 0 {
            return;
        }
        self.program.use_program(gl);
        gl.uniform_matrix3fv_with_f32_array(self.u_proj.as_ref(), false, projection);
        gl.bind_vertex_array(Some(&self.vao));
        gl.enable(Gl::BLEND);
        gl.blend_func(Gl::SRC_ALPHA, Gl::ONE_MINUS_SRC_ALPHA);
        gl.draw_arrays(Gl::LINES, 0, self.vertex_count as i32);
        gl.bind_vertex_array(None);
    }
}
