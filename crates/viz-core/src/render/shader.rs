//! Thin wrapper over WebGL2 shader compile + program link.
//!
//! Errors are returned as String so callers can surface them via JsValue.

use web_sys::{WebGl2RenderingContext as Gl, WebGlProgram, WebGlShader, WebGlUniformLocation};

pub struct ShaderProgram {
    program: WebGlProgram,
    gl: Gl,
}

impl ShaderProgram {
    /// Compile vertex + fragment shaders and link a program.
    pub fn new(gl: &Gl, vertex_src: &str, fragment_src: &str) -> Result<Self, String> {
        let vs = compile(gl, Gl::VERTEX_SHADER, vertex_src)?;
        let fs = compile(gl, Gl::FRAGMENT_SHADER, fragment_src)?;
        let program = gl.create_program().ok_or("create_program returned None")?;
        gl.attach_shader(&program, &vs);
        gl.attach_shader(&program, &fs);
        gl.link_program(&program);

        let linked = gl
            .get_program_parameter(&program, Gl::LINK_STATUS)
            .as_bool()
            .unwrap_or(false);

        // Shaders can be detached + deleted once linked; the program owns the bytecode.
        gl.delete_shader(Some(&vs));
        gl.delete_shader(Some(&fs));

        if !linked {
            let log = gl.get_program_info_log(&program).unwrap_or_default();
            gl.delete_program(Some(&program));
            return Err(format!("link failed: {log}"));
        }

        Ok(Self { program, gl: gl.clone() })
    }

    pub fn use_program(&self, gl: &Gl) {
        gl.use_program(Some(&self.program));
    }

    pub fn attribute_location(&self, gl: &Gl, name: &str) -> i32 {
        gl.get_attrib_location(&self.program, name)
    }

    pub fn uniform_location(&self, gl: &Gl, name: &str) -> Option<WebGlUniformLocation> {
        gl.get_uniform_location(&self.program, name)
    }

    pub fn raw(&self) -> &WebGlProgram {
        &self.program
    }
}

impl Drop for ShaderProgram {
    fn drop(&mut self) {
        self.gl.delete_program(Some(&self.program));
    }
}

fn compile(gl: &Gl, kind: u32, src: &str) -> Result<WebGlShader, String> {
    let shader = gl.create_shader(kind).ok_or("create_shader returned None")?;
    gl.shader_source(&shader, src);
    gl.compile_shader(&shader);

    let ok = gl
        .get_shader_parameter(&shader, Gl::COMPILE_STATUS)
        .as_bool()
        .unwrap_or(false);
    if ok {
        Ok(shader)
    } else {
        let log = gl.get_shader_info_log(&shader).unwrap_or_default();
        gl.delete_shader(Some(&shader));
        Err(format!("compile failed: {log}"))
    }
}

// No #[cfg(test)] block: ShaderProgram requires a real WebGL context, so it's
// exercised by the wasm-bindgen-tests in `crates/viz-core/tests/wasm.rs`.
