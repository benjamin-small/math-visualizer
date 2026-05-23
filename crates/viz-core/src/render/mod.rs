//! Reusable WebGL2 rendering helpers. Visualizations compose these to draw
//! shapes; the engine doesn't touch this module directly.

pub mod shader;

pub use shader::ShaderProgram;
