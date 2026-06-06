//! Turntable 3D camera. Orbits a target point; produces a 4×4 column-major
//! view-projection matrix for shader upload.
//!
//! Conventions: right-handed; +Y is up; the camera looks down -Z in view
//! space. Azimuth is rotation around the Y axis (0 looks down -Z toward the
//! target from +Z); elevation is tilt above the equator (positive = looking
//! down from above). Both in radians.

const DRAG_SENS_RAD_PER_PX: f32 = 0.005;
const ELEVATION_LIMIT: f32 = std::f32::consts::FRAC_PI_2 - 0.01;

#[derive(Debug, Clone, Copy)]
pub struct Camera3D {
    pub target: [f32; 3],
    pub azimuth: f32,
    pub elevation: f32,
    pub distance: f32,
    pub fov_y: f32,
    pub viewport_px: [u32; 2],
}

impl Camera3D {
    pub fn new() -> Self {
        Self {
            target: [0.0, 0.0, 0.0],
            azimuth: 0.0,
            elevation: 0.0,
            distance: 2.5,
            fov_y: std::f32::consts::FRAC_PI_4, // 45°
            viewport_px: [1, 1],
        }
    }

    pub fn resize(&mut self, width: u32, height: u32) {
        self.viewport_px = [width.max(1), height.max(1)];
    }

    pub fn aspect(&self) -> f32 {
        self.viewport_px[0] as f32 / self.viewport_px[1] as f32
    }

    /// Add `dt * speed` to azimuth (auto-rotation).
    pub fn auto_advance(&mut self, dt: f32, speed: f32) {
        self.azimuth += dt * speed;
    }

    /// Apply a pixel-space drag delta as azimuth/elevation deltas. Elevation
    /// is clamped to avoid gimbal flip at the poles.
    pub fn orbit_drag(&mut self, dx_px: f32, dy_px: f32) {
        self.azimuth += dx_px * DRAG_SENS_RAD_PER_PX;
        self.elevation = (self.elevation + dy_px * DRAG_SENS_RAD_PER_PX)
            .clamp(-ELEVATION_LIMIT, ELEVATION_LIMIT);
    }

    /// World-space camera position (eye) derived from orbit angles.
    pub fn eye(&self) -> [f32; 3] {
        let ce = self.elevation.cos();
        let se = self.elevation.sin();
        let sa = self.azimuth.sin();
        let ca = self.azimuth.cos();
        [
            self.target[0] + self.distance * ce * sa,
            self.target[1] + self.distance * se,
            self.target[2] + self.distance * ce * ca,
        ]
    }

    /// Column-major 4×4 view × projection matrix for shader upload.
    pub fn view_projection(&self) -> [f32; 16] {
        let view = look_at(self.eye(), self.target, [0.0, 1.0, 0.0]);
        let proj = perspective(self.fov_y, self.aspect(), 0.05, 100.0);
        mul_mat4(&proj, &view)
    }
}

impl Default for Camera3D {
    fn default() -> Self { Self::new() }
}

// ---- mat4 / vec3 helpers (column-major) -----------------------------------

fn sub3(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn dot3(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn cross3(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn normalize3(v: [f32; 3]) -> [f32; 3] {
    let len = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt().max(1e-12);
    [v[0] / len, v[1] / len, v[2] / len]
}

/// Right-handed lookAt. Column-major output.
fn look_at(eye: [f32; 3], target: [f32; 3], up: [f32; 3]) -> [f32; 16] {
    let f = normalize3(sub3(target, eye)); // forward (camera looks toward target)
    let s = normalize3(cross3(f, up));     // right
    let u = cross3(s, f);                  // recomputed up
    [
        s[0], u[0], -f[0], 0.0,
        s[1], u[1], -f[1], 0.0,
        s[2], u[2], -f[2], 0.0,
        -dot3(s, eye), -dot3(u, eye), dot3(f, eye), 1.0,
    ]
}

/// Right-handed perspective, NDC depth in [-1, +1] (WebGL default).
fn perspective(fov_y: f32, aspect: f32, near: f32, far: f32) -> [f32; 16] {
    let f = 1.0 / (fov_y * 0.5).tan();
    let inv_nf = 1.0 / (near - far);
    let mut m = [0.0f32; 16];
    m[0]  = f / aspect;
    m[5]  = f;
    m[10] = (far + near) * inv_nf;
    m[11] = -1.0;
    m[14] = 2.0 * far * near * inv_nf;
    m
}

/// Column-major 4×4 multiply: result = a × b.
fn mul_mat4(a: &[f32; 16], b: &[f32; 16]) -> [f32; 16] {
    let mut r = [0.0f32; 16];
    for col in 0..4 {
        for row in 0..4 {
            let mut s = 0.0;
            for k in 0..4 {
                s += a[row + 4 * k] * b[k + 4 * col];
            }
            r[row + 4 * col] = s;
        }
    }
    r
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: f32, b: f32, eps: f32) -> bool {
        (a - b).abs() < eps
    }

    #[test]
    fn new_has_sane_defaults() {
        let cam = Camera3D::new();
        assert!(cam.distance > 0.0);
        assert!(cam.fov_y > 0.0 && cam.fov_y < std::f32::consts::PI);
        assert_eq!(cam.target, [0.0, 0.0, 0.0]);
        assert_eq!(cam.viewport_px, [1, 1]);
    }

    #[test]
    fn resize_clamps_to_at_least_one() {
        let mut cam = Camera3D::new();
        cam.resize(0, 0);
        assert_eq!(cam.viewport_px, [1, 1]);
        cam.resize(800, 600);
        assert_eq!(cam.viewport_px, [800, 600]);
        assert!(approx(cam.aspect(), 800.0 / 600.0, 1e-5));
    }

    #[test]
    fn auto_advance_adds_to_azimuth_proportional_to_dt() {
        let mut a = Camera3D::new();
        let mut b = Camera3D::new();
        a.auto_advance(0.5, 1.0);
        b.auto_advance(0.25, 1.0);
        b.auto_advance(0.25, 1.0);
        assert!(approx(a.azimuth, b.azimuth, 1e-6));
    }

    #[test]
    fn orbit_drag_is_linear_in_pixels_on_azimuth() {
        let mut a = Camera3D::new();
        let mut b = Camera3D::new();
        a.orbit_drag(10.0, 0.0);
        b.orbit_drag(5.0, 0.0);
        b.orbit_drag(5.0, 0.0);
        assert!(approx(a.azimuth, b.azimuth, 1e-6));
    }

    #[test]
    fn elevation_clamps_below_pi_over_two() {
        let mut cam = Camera3D::new();
        cam.orbit_drag(0.0, 100_000.0);   // huge positive drag
        assert!(cam.elevation < std::f32::consts::FRAC_PI_2);
        cam.orbit_drag(0.0, -1_000_000.0); // huge negative drag
        assert!(cam.elevation > -std::f32::consts::FRAC_PI_2);
    }

    #[test]
    fn view_projection_is_deterministic() {
        let mut cam = Camera3D::new();
        cam.resize(800, 600);
        cam.azimuth = 0.5;
        cam.elevation = -0.3;
        cam.distance = 2.5;
        let m1 = cam.view_projection();
        let m2 = cam.view_projection();
        for i in 0..16 {
            assert!(approx(m1[i], m2[i], 1e-6), "differ at {i}");
        }
    }

    #[test]
    fn view_projection_maps_origin_in_front_of_camera() {
        // Camera at distance d on +Z axis looking at origin → origin projects
        // to clip-space (0, 0, +something with w > 0).
        let mut cam = Camera3D::new();
        cam.resize(100, 100);
        cam.azimuth = 0.0;
        cam.elevation = 0.0;
        cam.distance = 2.5;
        let m = cam.view_projection();
        // Multiply m * [0,0,0,1] = column 3 of m (column-major).
        let x = m[12];
        let y = m[13];
        let _z = m[14];
        let w = m[15];
        assert!(w > 0.0, "origin should be in front of camera, w={w}");
        // x and y near 0 (origin is on the view axis).
        assert!(approx(x, 0.0, 1e-4));
        assert!(approx(y, 0.0, 1e-4));
    }
}
