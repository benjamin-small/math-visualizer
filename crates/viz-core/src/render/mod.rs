//! Reusable WebGL2 rendering helpers. Visualizations compose these to draw
//! shapes; the engine doesn't touch this module directly.

pub mod camera_2d;
pub mod camera_3d;
pub mod instanced_points;
pub mod instanced_points_3d;
pub mod line_batch;
pub mod sdf_circle;
pub mod shader;

pub use camera_2d::Camera2D;
pub use camera_3d::Camera3D;
pub use instanced_points::{InstancedPoints, PointInstance};
pub use instanced_points_3d::{InstancedPoints3D, PointInstance3D};
pub use line_batch::{LineBatch, LineVertex};
pub use sdf_circle::SdfCircle;
pub use shader::ShaderProgram;
