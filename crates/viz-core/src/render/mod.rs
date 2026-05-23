//! Reusable WebGL2 rendering helpers. Visualizations compose these to draw
//! shapes; the engine doesn't touch this module directly.

pub mod camera_2d;
pub mod instanced_points;
pub mod shader;

pub use camera_2d::Camera2D;
pub use instanced_points::{InstancedPoints, PointInstance};
pub use shader::ShaderProgram;
