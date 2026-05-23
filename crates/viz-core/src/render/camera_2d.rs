//! Orthographic 2D camera. Owns a target world-space rect and a viewport in
//! pixels. Produces a clip-space projection matrix (column-major 3×3 for 2D
//! homogeneous coords, exported as a 9-element f32 array for shader upload).

#[derive(Debug, Clone, Copy)]
pub struct Camera2D {
    /// World-space center of the visible region.
    pub center: [f32; 2],
    /// Half-width of the visible region in world units. Half-height is derived
    /// from this + viewport aspect ratio so units stay square.
    pub half_width: f32,
    /// Viewport size in pixels (backing-store, DPR-scaled). Used to compute
    /// the aspect ratio.
    pub viewport_px: [u32; 2],
}

impl Camera2D {
    pub fn new() -> Self {
        Self {
            center: [0.0, 0.0],
            half_width: 1.0,
            viewport_px: [1, 1],
        }
    }

    pub fn resize(&mut self, width: u32, height: u32) {
        self.viewport_px = [width.max(1), height.max(1)];
    }

    /// Adjust center + half_width so the given world-space bounding box fits
    /// inside the viewport with `padding` world units on every side.
    pub fn fit_to_bbox(&mut self, min: [f32; 2], max: [f32; 2], padding: f32) {
        let cx = (min[0] + max[0]) * 0.5;
        let cy = (min[1] + max[1]) * 0.5;
        let half_w = (max[0] - min[0]) * 0.5 + padding;
        let half_h = (max[1] - min[1]) * 0.5 + padding;
        let aspect = self.viewport_px[0].max(1) as f32 / self.viewport_px[1].max(1) as f32;
        // The visible region must contain both half_w and half_h. Pick the
        // tighter constraint after accounting for aspect.
        let chosen = if half_w / aspect >= half_h { half_w } else { half_h * aspect };
        self.center = [cx, cy];
        self.half_width = chosen.max(1e-6);
    }

    /// Column-major 3×3 ortho matrix mapping world coords → clip space.
    /// Clip space is [-1, +1] on both axes; OpenGL Y is up.
    pub fn projection(&self) -> [f32; 9] {
        let aspect = self.viewport_px[0].max(1) as f32 / self.viewport_px[1].max(1) as f32;
        let half_h = self.half_width / aspect;
        let sx = 1.0 / self.half_width;
        let sy = 1.0 / half_h;
        let tx = -self.center[0] * sx;
        let ty = -self.center[1] * sy;
        // Column-major:
        // | sx  0   tx |
        // | 0   sy  ty |
        // | 0   0   1  |
        [
            sx,  0.0, 0.0,
            0.0, sy,  0.0,
            tx,  ty,  1.0,
        ]
    }
}

impl Default for Camera2D {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: f32, b: f32) -> bool {
        (a - b).abs() < 1e-5
    }

    #[test]
    fn projection_identity_when_square_viewport_unit_half_width() {
        let mut cam = Camera2D::new();
        cam.resize(100, 100);
        let m = cam.projection();
        // sx and sy should be 1.0 (world coords already in clip space).
        assert!(approx(m[0], 1.0));
        assert!(approx(m[4], 1.0));
        // Translation should be 0.
        assert!(approx(m[6], 0.0));
        assert!(approx(m[7], 0.0));
    }

    #[test]
    fn fit_to_bbox_centers_and_zooms() {
        let mut cam = Camera2D::new();
        cam.resize(100, 100);
        cam.fit_to_bbox([-1.0, -1.0], [1.0, 1.0], 0.1);
        assert!(approx(cam.center[0], 0.0));
        assert!(approx(cam.center[1], 0.0));
        // Square viewport: half_width should be 1.0 + 0.1 padding.
        assert!(approx(cam.half_width, 1.1));
    }

    #[test]
    fn fit_to_bbox_picks_tighter_axis_in_wide_viewport() {
        let mut cam = Camera2D::new();
        // Wide viewport: 200x100, aspect = 2.0.
        cam.resize(200, 100);
        // Unit-square bbox. half_w = 1.0, half_h = 1.0, aspect = 2.
        // chosen = if half_w/aspect >= half_h: 1/2 >= 1? no, so chosen = half_h * aspect = 1*2 = 2.
        cam.fit_to_bbox([-1.0, -1.0], [1.0, 1.0], 0.0);
        assert!(approx(cam.half_width, 2.0));
    }

    #[test]
    fn fit_to_bbox_clamps_to_nonzero() {
        let mut cam = Camera2D::new();
        cam.resize(100, 100);
        cam.fit_to_bbox([0.0, 0.0], [0.0, 0.0], 0.0);
        assert!(cam.half_width > 0.0, "half_width never falls to literal zero");
    }

    #[test]
    fn projection_translates_with_center() {
        let mut cam = Camera2D::new();
        cam.resize(100, 100);
        cam.center = [3.0, -2.0];
        cam.half_width = 1.0;
        let m = cam.projection();
        // tx = -cx * sx = -3 * 1 = -3
        assert!(approx(m[6], -3.0));
        assert!(approx(m[7], 2.0));
    }
}
