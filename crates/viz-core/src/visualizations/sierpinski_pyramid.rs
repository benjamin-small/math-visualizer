//! 3D Sierpinski tetrahedron visualization. Renders the 4 corners, the chaos
//! game trail (tinted per corner), the per-substep guide line + current
//! position dot, and a turntable camera that auto-rotates and accepts
//! pointer drags for orbit.

use serde::{Deserialize, Serialize};
use web_sys::WebGl2RenderingContext;

use crate::config::{color_property, number_property, ConfigSchema, NumberOpts};
use crate::render::{Camera3D, InstancedPoints3D, LineBatch3D, LineVertex3D, PointInstance3D};
use crate::rules::sierpinski_chaos::{ChaosGameState, CORNERS};
use crate::traits::{InputEvent, Visualization};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SierpinskiPyramidVizConfig {
    pub background: [f32; 4],
    pub edge_color: [f32; 4],

    /// One color per corner. Used both for the corner anchor dot and as
    /// the tint applied to trail dots that landed halfway toward it.
    pub corner_colors: [[f32; 4]; 4],
    pub corner_highlight_color: [f32; 4],
    pub corner_size_px: f32,

    pub trail_color: [f32; 4],
    /// 0.0 = trail dots are monochrome (trail_color);
    /// 1.0 = trail dots are pure corner_colors[k].
    pub trail_tint: f32,
    pub trail_size_px: f32,

    pub current_color: [f32; 4],
    pub current_size_px: f32,

    pub guide_color: [f32; 4],
    pub burn_in_iterations: u32,

    /// Radians/sec. 0 stops the auto-spin; default 0.25 ≈ 25s per revolution.
    pub auto_rotate_speed: f32,
    pub padding: f32,
}

impl Default for SierpinskiPyramidVizConfig {
    fn default() -> Self {
        Self {
            background: [0.07, 0.07, 0.09, 1.0],
            edge_color: [0.55, 0.55, 0.60, 0.8],
            corner_colors: [
                [0.30, 0.85, 0.95, 1.0], // cyan
                [0.95, 0.45, 0.85, 1.0], // magenta
                [0.98, 0.78, 0.30, 1.0], // amber
                [0.55, 0.90, 0.45, 1.0], // lime
            ],
            corner_highlight_color: [1.00, 0.98, 0.85, 1.0],
            corner_size_px: 10.0,
            trail_color: [0.65, 0.85, 0.95, 1.0],
            trail_tint: 0.65,
            trail_size_px: 3.5,
            current_color: [0.95, 0.55, 0.35, 1.0],
            current_size_px: 7.0,
            guide_color: [0.95, 0.75, 0.35, 0.55],
            burn_in_iterations: 20,
            auto_rotate_speed: 0.25,
            padding: 0.1,
        }
    }
}

impl ConfigSchema for SierpinskiPyramidVizConfig {
    fn schema() -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "background":               color_property("Background",              [0.07, 0.07, 0.09, 1.0]),
                "edge_color":               color_property("Tetrahedron edge color",  [0.55, 0.55, 0.60, 0.8]),
                "corner_colors": {
                    "type": "array",
                    "title": "Corner colors (4)",
                    "minItems": 4,
                    "maxItems": 4,
                    "items": color_property("Corner color", [0.30, 0.85, 0.95, 1.0]),
                },
                "corner_highlight_color":   color_property("Highlighted corner color", [1.00, 0.98, 0.85, 1.0]),
                "corner_size_px": number_property(NumberOpts {
                    label: "Corner dot size (px)",
                    default: 10.0, min: 1.0, max: 30.0, step: 0.5,
                    integer: false, cosmetic: true, widget: None,
                }),
                "trail_color":              color_property("Trail base color",        [0.65, 0.85, 0.95, 1.0]),
                "trail_tint": number_property(NumberOpts {
                    label: "Per-corner trail tint (0 mono -> 1 full)",
                    default: 0.65, min: 0.0, max: 1.0, step: 0.05,
                    integer: false, cosmetic: true, widget: None,
                }),
                "trail_size_px": number_property(NumberOpts {
                    label: "Trail dot size (px)",
                    default: 3.5, min: 0.5, max: 20.0, step: 0.1,
                    integer: false, cosmetic: true, widget: None,
                }),
                "current_color":            color_property("Current dot color",       [0.95, 0.55, 0.35, 1.0]),
                "current_size_px": number_property(NumberOpts {
                    label: "Current dot size (px)",
                    default: 7.0, min: 0.5, max: 20.0, step: 0.1,
                    integer: false, cosmetic: true, widget: None,
                }),
                "guide_color":              color_property("Guide line color",        [0.95, 0.75, 0.35, 0.55]),
                "burn_in_iterations": number_property(NumberOpts {
                    label: "Skip first N iterations (burn-in)",
                    default: 20.0, min: 0.0, max: 1000.0, step: 1.0,
                    integer: true, cosmetic: true, widget: None,
                }),
                "auto_rotate_speed": number_property(NumberOpts {
                    label: "Auto-rotate speed (rad/s, 0 = stop)",
                    default: 0.25, min: 0.0, max: 3.0, step: 0.05,
                    integer: false, cosmetic: true, widget: None,
                }),
                "padding": number_property(NumberOpts {
                    label: "Padding (unused -- fit handled by camera distance)",
                    default: 0.1, min: 0.0, max: 1.0, step: 0.01,
                    integer: false, cosmetic: true, widget: None,
                }),
            },
            "required": [
                "background", "edge_color",
                "corner_colors", "corner_highlight_color", "corner_size_px",
                "trail_color", "trail_tint", "trail_size_px",
                "current_color", "current_size_px",
                "guide_color", "burn_in_iterations",
                "auto_rotate_speed", "padding"
            ],
        })
    }

    fn defaults() -> serde_json::Value {
        serde_json::to_value(SierpinskiPyramidVizConfig::default()).unwrap()
    }
}

const BASE_CAMERA_DISTANCE: f32 = 2.5;

pub struct SierpinskiPyramid {
    camera: Camera3D,
    /// Accumulated by tick(dt); drives the auto-spin around the Y axis.
    auto_azimuth: f32,
    /// User-controlled offset from drag. Added to auto_azimuth at render time.
    azimuth_offset: f32,
    /// User-controlled elevation. Clamped at the poles inside Camera3D.
    elevation: f32,
    /// 1.0 = default fit; >1 zooms in (camera distance shrinks).
    zoom: f32,
    points: Option<InstancedPoints3D>,
    lines: Option<LineBatch3D>,
    /// Reusable scratch buffer for the per-frame point-instance list. Cleared
    /// each frame; never re-allocated. Avoids ~MB/frame heap churn at large
    /// trail sizes.
    points_scratch: Vec<PointInstance3D>,
    /// Cached from the last `render()` call so `tick(dt)` can integrate
    /// auto-rotation without seeing the config. Set every frame in `render()`.
    cached_auto_speed: f32,
}

impl SierpinskiPyramid {
    pub fn new() -> Self {
        let mut camera = Camera3D::new();
        camera.distance = BASE_CAMERA_DISTANCE;
        Self {
            camera,
            // Start with a 30 deg azimuth + slight downward tilt so the first
            // frame shows three faces rather than a flat profile.
            auto_azimuth: std::f32::consts::FRAC_PI_6,
            azimuth_offset: 0.0,
            elevation: -0.35,
            zoom: 1.0,
            points: None,
            lines: None,
            points_scratch: Vec::new(),
            cached_auto_speed: 0.25,
        }
    }

    fn ensure_resources(&mut self, gl: &WebGl2RenderingContext) -> Result<(), String> {
        if self.points.is_none() { self.points = Some(InstancedPoints3D::new(gl)?); }
        if self.lines.is_none()  { self.lines  = Some(LineBatch3D::new(gl)?); }
        Ok(())
    }
}

impl Default for SierpinskiPyramid {
    fn default() -> Self { Self::new() }
}

impl Visualization for SierpinskiPyramid {
    type Config = SierpinskiPyramidVizConfig;
    type State = ChaosGameState;

    fn id(&self) -> &'static str { "sierpinski-pyramid" }

    fn init(&mut self, gl: &WebGl2RenderingContext, cfg: &Self::Config) {
        // Seed the cache from cfg so the very first tick(dt) — which runs
        // BEFORE the first render() — integrates against the configured
        // speed, not the struct's hardcoded default.
        self.cached_auto_speed = cfg.auto_rotate_speed;
        let _ = self.ensure_resources(gl);
    }

    fn render(
        &mut self,
        gl: &WebGl2RenderingContext,
        state: &Self::State,
        cfg: &Self::Config,
    ) {
        if self.ensure_resources(gl).is_err() { return; }
        let points = self.points.as_mut().unwrap();
        let lines  = self.lines.as_mut().unwrap();

        // Camera placement.
        self.camera.distance = BASE_CAMERA_DISTANCE / self.zoom.max(0.1);
        self.cached_auto_speed = cfg.auto_rotate_speed;
        self.camera.azimuth = self.auto_azimuth + self.azimuth_offset;
        self.camera.elevation = self.elevation;
        let vp = self.camera.view_projection();
        let viewport = self.camera.viewport_px;

        // Clear color + depth, enable depth test for occlusion.
        gl.enable(WebGl2RenderingContext::DEPTH_TEST);
        gl.clear_color(cfg.background[0], cfg.background[1], cfg.background[2], cfg.background[3]);
        gl.clear(WebGl2RenderingContext::COLOR_BUFFER_BIT | WebGl2RenderingContext::DEPTH_BUFFER_BIT);

        // ---- Edges (6 segments) + optional guide line (1 segment). ----
        let mut line_verts: Vec<LineVertex3D> = Vec::with_capacity(14);
        for i in 0..4 {
            for j in (i + 1)..4 {
                line_verts.push(LineVertex3D { position: CORNERS[i], color: cfg.edge_color });
                line_verts.push(LineVertex3D { position: CORNERS[j], color: cfg.edge_color });
            }
        }
        if let Some(corner_idx) = state.chosen_corner {
            // Start point: the most recent trail dot (or the initial position
            // if no iterations have completed). End point: the picked corner.
            let start = state.trail.last().copied().unwrap_or(state.initial_position);
            line_verts.push(LineVertex3D { position: start,                  color: cfg.guide_color });
            line_verts.push(LineVertex3D { position: CORNERS[corner_idx], color: cfg.guide_color });
        }
        lines.upload(gl, &line_verts);
        lines.draw(gl, &vp);

        // ---- Build the full point list: trail (under) then corners (over). ----
        // The chaos orbit converges onto the Sierpinski set at rate (1/2)^n,
        // so the first ~20 iterations can sit in level-N holes. Skip them
        // only past 2× burn-in so a fresh playthrough at iter=1..20 still
        // shows the dot moving.
        let burn_in = cfg.burn_in_iterations as usize;
        let skip = if state.trail.len() > burn_in * 2 { burn_in } else { 0 };

        // Reuse the persistent scratch buffer.
        let points_data = &mut self.points_scratch;
        points_data.clear();
        points_data.reserve(state.trail.len().saturating_sub(skip) + 4);

        for i in skip..state.trail.len() {
            let p = state.trail[i];
            let corner_idx = *state.corner_for_dot.get(i).unwrap_or(&0) as usize;
            let target = cfg.corner_colors[corner_idx & 0b11];
            let base = cfg.trail_color;
            let t = cfg.trail_tint.clamp(0.0, 1.0);
            let color = [
                base[0] + (target[0] - base[0]) * t,
                base[1] + (target[1] - base[1]) * t,
                base[2] + (target[2] - base[2]) * t,
                base[3] + (target[3] - base[3]) * t,
            ];
            points_data.push(PointInstance3D {
                position: p,
                color,
                radius_px: cfg.trail_size_px * 0.5,
            });
        }

        // Corner anchors over the trail.
        for (i, &corner) in CORNERS.iter().enumerate() {
            let highlighted = state.chosen_corner == Some(i);
            let color = if highlighted { cfg.corner_highlight_color } else { cfg.corner_colors[i] };
            points_data.push(PointInstance3D {
                position: corner,
                color,
                radius_px: cfg.corner_size_px * 0.5,
            });
        }

        if let Some(p) = state.current_position {
            points_data.push(PointInstance3D {
                position: p,
                color: cfg.current_color,
                radius_px: cfg.current_size_px * 0.5,
            });
        }

        points.upload(gl, &points_data);
        points.draw(gl, &vp, viewport);
    }

    fn resize(&mut self, gl: &WebGl2RenderingContext, w: u32, h: u32) {
        self.camera.resize(w, h);
        gl.viewport(0, 0, w as i32, h as i32);
    }

    fn set_zoom(&mut self, zoom: f32) {
        // Upper bound 4.0 (was 20.0) keeps camera distance ≥ 2.5/4 = 0.625,
        // outside the tetrahedron's circumscribed sphere (~0.612). Going
        // higher pushed the eye inside the geometry and put far-side corners
        // behind the camera, producing inverted disc artifacts in the
        // points shader where clip.w flips sign.
        self.zoom = zoom.clamp(0.25, 4.0);
    }

    fn tick(&mut self, dt: f32) {
        // Auto-rotate always advances. Drag adds an offset on top — it
        // does not pause the auto-spin.
        self.auto_azimuth += self.cached_auto_speed * dt;
    }

    fn handle_input(&mut self, ev: &InputEvent) {
        match ev {
            InputEvent::PointerMove { dx, dy, buttons, .. } if *buttons & 1 != 0 => {
                self.azimuth_offset += *dx * 0.005;
                self.elevation = (self.elevation + *dy * 0.005)
                    .clamp(
                        -std::f32::consts::FRAC_PI_2 + 0.01,
                        std::f32::consts::FRAC_PI_2 - 0.01,
                    );
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::ConfigSchema;

    #[test]
    fn defaults_round_trip() {
        let v: SierpinskiPyramidVizConfig =
            serde_json::from_value(SierpinskiPyramidVizConfig::defaults()).unwrap();
        assert!((v.padding - 0.1).abs() < 1e-6);
        assert_eq!(v.trail_size_px, 3.5);
        assert_eq!(v.corner_colors.len(), 4);
        assert!(v.auto_rotate_speed > 0.0);
        assert!((0.0..=1.0).contains(&v.trail_tint));
    }

    #[test]
    fn schema_lists_all_required_fields() {
        let schema = SierpinskiPyramidVizConfig::schema();
        let required = schema["required"].as_array().expect("required array");
        // background, edge_color, corner_colors, corner_highlight_color,
        // corner_size_px, trail_color, trail_tint, trail_size_px,
        // current_color, current_size_px, guide_color, burn_in_iterations,
        // auto_rotate_speed, padding = 14 fields.
        assert_eq!(required.len(), 14);
    }
}
