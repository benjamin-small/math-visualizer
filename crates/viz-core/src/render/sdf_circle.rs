//! Antialiased stroked circle drawn as a single quad. The fragment shader
//! computes the signed distance from the unit circle and shades only the
//! stroke band.
//!
//! The quad is unit-sized in world space (covers [-1, 1] × [-1, 1]); the
//! viz translates/scales via the projection matrix.

use web_sys::{WebGl2RenderingContext as Gl, WebGlBuffer, WebGlVertexArrayObject};

use super::shader::ShaderProgram;

const VERTEX_SRC: &str = r#"#version 300 es
precision mediump float;

layout(location=0) in vec2 a_corner;  // unit quad in [-1, 1]^2

uniform mat3 u_proj;

out vec2 v_local;

void main() {
    v_local = a_corner;
    vec3 clip = u_proj * vec3(a_corner, 1.0);
    gl_Position = vec4(clip.xy, 0.0, 1.0);
}
"#;

const FRAGMENT_SRC: &str = r#"#version 300 es
precision mediump float;

in vec2 v_local;

uniform vec4 u_color;
uniform float u_stroke;        // half-width of the stroke band, in world units
uniform float u_pixel_width;   // approximate world-unit length of one pixel

out vec4 frag_color;

void main() {
    float d = abs(length(v_local) - 1.0);
    // Antialiased band: full opacity inside [0, stroke], smoothly drops to 0
    // over a one-pixel feather past stroke.
    float alpha = 1.0 - smoothstep(u_stroke, u_stroke + u_pixel_width, d);
    if (alpha <= 0.0) discard;
    frag_color = vec4(u_color.rgb, u_color.a * alpha);
}
"#;

pub struct SdfCircle {
    program: ShaderProgram,
    vao: WebGlVertexArrayObject,
    #[allow(dead_code)]
    quad_buffer: WebGlBuffer,  // kept alive so the VAO's binding stays valid
    u_proj: Option<web_sys::WebGlUniformLocation>,
    u_color: Option<web_sys::WebGlUniformLocation>,
    u_stroke: Option<web_sys::WebGlUniformLocation>,
    u_pixel_width: Option<web_sys::WebGlUniformLocation>,
}

impl SdfCircle {
    pub fn new(gl: &Gl) -> Result<Self, String> {
        let program = ShaderProgram::new(gl, VERTEX_SRC, FRAGMENT_SRC)?;

        let quad: [f32; 8] = [-1.0, -1.0, 1.0, -1.0, -1.0, 1.0, 1.0, 1.0];
        let quad_buffer = gl.create_buffer().ok_or("create_buffer")?;
        gl.bind_buffer(Gl::ARRAY_BUFFER, Some(&quad_buffer));
        unsafe {
            let view = js_sys::Float32Array::view(&quad);
            gl.buffer_data_with_array_buffer_view(Gl::ARRAY_BUFFER, &view, Gl::STATIC_DRAW);
        }

        let vao = gl.create_vertex_array().ok_or("create_vertex_array")?;
        gl.bind_vertex_array(Some(&vao));
        gl.bind_buffer(Gl::ARRAY_BUFFER, Some(&quad_buffer));
        gl.enable_vertex_attrib_array(0);
        gl.vertex_attrib_pointer_with_i32(0, 2, Gl::FLOAT, false, 0, 0);
        gl.bind_vertex_array(None);

        let u_proj = program.uniform_location(gl, "u_proj");
        let u_color = program.uniform_location(gl, "u_color");
        let u_stroke = program.uniform_location(gl, "u_stroke");
        let u_pixel_width = program.uniform_location(gl, "u_pixel_width");

        Ok(Self { program, vao, quad_buffer, u_proj, u_color, u_stroke, u_pixel_width })
    }

    /// Draw the circle with the given color, stroke half-width (world units),
    /// and projection. `world_units_per_pixel` is used to feather the edge by
    /// roughly one pixel — typically `cam.half_width * 2 / viewport_px[0]`.
    pub fn draw(
        &self,
        gl: &Gl,
        projection: &[f32; 9],
        color: [f32; 4],
        stroke_world: f32,
        world_units_per_pixel: f32,
    ) {
        self.program.use_program(gl);
        gl.uniform_matrix3fv_with_f32_array(self.u_proj.as_ref(), false, projection);
        gl.uniform4f(self.u_color.as_ref(), color[0], color[1], color[2], color[3]);
        gl.uniform1f(self.u_stroke.as_ref(), stroke_world.max(0.0));
        gl.uniform1f(self.u_pixel_width.as_ref(), world_units_per_pixel.max(1e-6));
        gl.bind_vertex_array(Some(&self.vao));
        gl.enable(Gl::BLEND);
        gl.blend_func(Gl::SRC_ALPHA, Gl::ONE_MINUS_SRC_ALPHA);
        gl.draw_arrays(Gl::TRIANGLE_STRIP, 0, 4);
        gl.bind_vertex_array(None);
    }
}
