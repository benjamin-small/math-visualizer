//! 3D analog of `LineBatch`. Per-vertex (vec3 position, vec4 color), uniform
//! mat4 view-projection. Same 1-pixel line-width caveat as the 2D version
//! (gl.lineWidth is capped to 1 on most platforms — that reads fine for the
//! tetrahedron's 6 edges + the per-iteration guide line).

use web_sys::{WebGl2RenderingContext as Gl, WebGlBuffer, WebGlVertexArrayObject};

use super::shader::ShaderProgram;

#[derive(Debug, Clone, Copy)]
pub struct LineVertex3D {
    pub position: [f32; 3],
    pub color: [f32; 4],
}

const FLOATS_PER_VERTEX: usize = 7;

const VERTEX_SRC: &str = r#"#version 300 es
precision mediump float;

layout(location=0) in vec3 a_position;
layout(location=1) in vec4 a_color;

uniform mat4 u_view_proj;

out vec4 v_color;

void main() {
    v_color = a_color;
    gl_Position = u_view_proj * vec4(a_position, 1.0);
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

pub struct LineBatch3D {
    program: ShaderProgram,
    vao: WebGlVertexArrayObject,
    buffer: WebGlBuffer,
    vertex_count: usize,
    u_view_proj: Option<web_sys::WebGlUniformLocation>,
    gl: Gl,
}

impl LineBatch3D {
    pub fn new(gl: &Gl) -> Result<Self, String> {
        let program = ShaderProgram::new(gl, VERTEX_SRC, FRAGMENT_SRC)?;
        let buffer = gl.create_buffer().ok_or("create_buffer")?;

        let vao = gl.create_vertex_array().ok_or("create_vertex_array")?;
        gl.bind_vertex_array(Some(&vao));
        gl.bind_buffer(Gl::ARRAY_BUFFER, Some(&buffer));
        let stride = (FLOATS_PER_VERTEX * 4) as i32;
        gl.enable_vertex_attrib_array(0);
        gl.vertex_attrib_pointer_with_i32(0, 3, Gl::FLOAT, false, stride, 0);
        gl.enable_vertex_attrib_array(1);
        gl.vertex_attrib_pointer_with_i32(1, 4, Gl::FLOAT, false, stride, 3 * 4);
        gl.bind_vertex_array(None);

        let u_view_proj = program.uniform_location(gl, "u_view_proj");

        Ok(Self {
            program,
            vao,
            buffer,
            vertex_count: 0,
            u_view_proj,
            gl: gl.clone(),
        })
    }

    pub fn upload(&mut self, gl: &Gl, vertices: &[LineVertex3D]) {
        self.vertex_count = vertices.len();
        let mut packed = Vec::with_capacity(vertices.len() * FLOATS_PER_VERTEX);
        for v in vertices {
            packed.push(v.position[0]);
            packed.push(v.position[1]);
            packed.push(v.position[2]);
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

    /// Draw the previously-uploaded line segments. The caller owns blend /
    /// depth-test / depth-mask state. For alpha < 1 line colors, the caller
    /// normally wants BLEND on with SRC_ALPHA / ONE_MINUS_SRC_ALPHA and
    /// depth_mask(false) so translucent edges don't write depth and occlude
    /// later geometry behind them.
    pub fn draw(&self, gl: &Gl, view_proj: &[f32; 16]) {
        if self.vertex_count == 0 {
            return;
        }
        self.program.use_program(gl);
        gl.uniform_matrix4fv_with_f32_array(self.u_view_proj.as_ref(), false, view_proj);
        gl.bind_vertex_array(Some(&self.vao));
        gl.draw_arrays(Gl::LINES, 0, self.vertex_count as i32);
        gl.bind_vertex_array(None);
    }
}

impl Drop for LineBatch3D {
    fn drop(&mut self) {
        self.gl.delete_vertex_array(Some(&self.vao));
        self.gl.delete_buffer(Some(&self.buffer));
        // self.program's own Drop deletes the WebGlProgram.
    }
}
