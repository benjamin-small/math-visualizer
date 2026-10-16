//! Draws an RGBA texture into a pixel rectangle — images, planes, anything
//! raster. Rects are device pixels, y down (as measured in the DOM).
//!
//! Pure draw call: the caller owns blend state and the scissor box.

use web_sys::{WebGl2RenderingContext as Gl, WebGlBuffer, WebGlTexture, WebGlVertexArrayObject};

use super::camera_2d::pixel_projection;
use super::shader::ShaderProgram;

const VERTEX_SRC: &str = r#"#version 300 es
precision mediump float;

layout(location=0) in vec2 a_corner; // unit quad, (0,0) top-left

uniform mat3 u_proj;
uniform vec4 u_rect; // x, y, w, h in device pixels, y down

out vec2 v_uv;

void main() {
    v_uv = a_corner;
    vec2 p = u_rect.xy + a_corner * u_rect.zw;
    gl_Position = vec4((u_proj * vec3(p, 1.0)).xy, 0.0, 1.0);
}
"#;

const FRAGMENT_SRC: &str = r#"#version 300 es
precision mediump float;

in vec2 v_uv;

uniform sampler2D u_tex;
uniform float u_dim;

out vec4 frag_color;

void main() {
    vec4 c = texture(u_tex, v_uv);
    frag_color = vec4(c.rgb * u_dim, c.a);
}
"#;

/// How a texture is sampled when it is stretched.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Filter {
    /// Hard pixel edges (block-level detail stays visible).
    Nearest,
    /// Smooth interpolation.
    Linear,
}

/// An uploaded RGBA texture and its size in texels.
pub struct Texture {
    tex: WebGlTexture,
    gl: Gl,
    pub w: u32,
    pub h: u32,
}

impl Texture {
    /// Uploads `rgba` (`w × h × 4` bytes, top row first) as a new texture.
    pub fn new(gl: &Gl, w: u32, h: u32, rgba: &[u8], filter: Filter) -> Result<Self, String> {
        if rgba.len() != (w as usize) * (h as usize) * 4 {
            return Err(format!(
                "texture needs {} bytes for {w}×{h}, got {}",
                (w as usize) * (h as usize) * 4,
                rgba.len()
            ));
        }
        let tex = gl.create_texture().ok_or("create_texture returned None")?;
        gl.bind_texture(Gl::TEXTURE_2D, Some(&tex));
        let f = match filter {
            Filter::Nearest => Gl::NEAREST,
            Filter::Linear => Gl::LINEAR,
        } as i32;
        gl.tex_parameteri(Gl::TEXTURE_2D, Gl::TEXTURE_MIN_FILTER, f);
        gl.tex_parameteri(Gl::TEXTURE_2D, Gl::TEXTURE_MAG_FILTER, f);
        gl.tex_parameteri(Gl::TEXTURE_2D, Gl::TEXTURE_WRAP_S, Gl::CLAMP_TO_EDGE as i32);
        gl.tex_parameteri(Gl::TEXTURE_2D, Gl::TEXTURE_WRAP_T, Gl::CLAMP_TO_EDGE as i32);
        gl.pixel_storei(Gl::UNPACK_ALIGNMENT, 1);
        gl.tex_image_2d_with_i32_and_i32_and_i32_and_format_and_type_and_opt_u8_array(
            Gl::TEXTURE_2D,
            0,
            Gl::RGBA8 as i32,
            w as i32,
            h as i32,
            0,
            Gl::RGBA,
            Gl::UNSIGNED_BYTE,
            Some(rgba),
        )
        .map_err(|e| format!("tex_image_2d failed: {e:?}"))?;
        gl.bind_texture(Gl::TEXTURE_2D, None);
        Ok(Self {
            tex,
            gl: gl.clone(),
            w,
            h,
        })
    }
}

impl Drop for Texture {
    fn drop(&mut self) {
        self.gl.delete_texture(Some(&self.tex));
    }
}

/// The shared program and quad for drawing `Texture`s.
pub struct TextureQuad {
    program: ShaderProgram,
    vao: WebGlVertexArrayObject,
    vbo: WebGlBuffer,
    gl: Gl,
}

impl TextureQuad {
    pub fn new(gl: &Gl) -> Result<Self, String> {
        let program = ShaderProgram::new(gl, VERTEX_SRC, FRAGMENT_SRC)?;
        let vao = gl
            .create_vertex_array()
            .ok_or("create_vertex_array returned None")?;
        let vbo = gl.create_buffer().ok_or("create_buffer returned None")?;
        gl.bind_vertex_array(Some(&vao));
        gl.bind_buffer(Gl::ARRAY_BUFFER, Some(&vbo));
        let corners: [f32; 8] = [0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 1.0];
        // SAFETY: the view lives only for this call and `corners` outlives it.
        unsafe {
            let view = js_sys::Float32Array::view(&corners);
            gl.buffer_data_with_array_buffer_view(Gl::ARRAY_BUFFER, &view, Gl::STATIC_DRAW);
        }
        gl.enable_vertex_attrib_array(0);
        gl.vertex_attrib_pointer_with_i32(0, 2, Gl::FLOAT, false, 0, 0);
        gl.bind_vertex_array(None);
        Ok(Self {
            program,
            vao,
            vbo,
            gl: gl.clone(),
        })
    }

    /// Draws `tex` stretched over `rect` (`[x, y, w, h]`, device px, y down)
    /// on a `canvas` of `[w, h]` device px, with its colour scaled by `dim`
    /// (1 = as is).
    pub fn draw(&self, gl: &Gl, tex: &Texture, rect: [f32; 4], canvas: [u32; 2], dim: f32) {
        self.program.use_program(gl);
        gl.uniform_matrix3fv_with_f32_array(
            self.program.uniform_location(gl, "u_proj").as_ref(),
            false,
            &pixel_projection(canvas[0], canvas[1]),
        );
        gl.uniform4fv_with_f32_array(self.program.uniform_location(gl, "u_rect").as_ref(), &rect);
        gl.uniform1f(self.program.uniform_location(gl, "u_dim").as_ref(), dim);
        gl.uniform1i(self.program.uniform_location(gl, "u_tex").as_ref(), 0);
        gl.active_texture(Gl::TEXTURE0);
        gl.bind_texture(Gl::TEXTURE_2D, Some(&tex.tex));
        gl.bind_vertex_array(Some(&self.vao));
        gl.draw_arrays(Gl::TRIANGLE_STRIP, 0, 4);
        gl.bind_vertex_array(None);
        gl.bind_texture(Gl::TEXTURE_2D, None);
    }
}

impl Drop for TextureQuad {
    fn drop(&mut self) {
        self.gl.delete_buffer(Some(&self.vbo));
        self.gl.delete_vertex_array(Some(&self.vao));
    }
}
