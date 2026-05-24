//! Visualization for SierpinskiChaos: a stroked triangle with 3 anchor
//! corner dots, the chaos-game trail, and a moving "current" dot during
//! substep animation. Composes Camera2D + InstancedPoints + LineBatch.

use serde::{Deserialize, Serialize};
use web_sys::WebGl2RenderingContext;

use crate::config::{color_property, number_property, ConfigSchema, NumberOpts};
use crate::render::{Camera2D, InstancedPoints, LineBatch, LineVertex, PointInstance};
use crate::rules::sierpinski_chaos::{ChaosGameState, CORNERS};
use crate::traits::Visualization;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SierpinskiTriangleVizConfig {
    pub background: [f32; 4],
    pub triangle_color: [f32; 4],
    pub corner_color: [f32; 4],
    pub corner_highlight_color: [f32; 4],
    pub corner_size_px: f32,
    pub trail_color: [f32; 4],
    pub trail_size_px: f32,
    pub current_color: [f32; 4],
    pub current_size_px: f32,
    /// Color of the per-iteration guide line from the previous trail dot
    /// to the chosen corner. Drawn during substep animation only.
    pub guide_color: [f32; 4],
    /// Skip this many early trail dots from rendering — the chaos-game orbit
    /// converges onto the Sierpinski set at rate (1/2)^n, so the first few
    /// iterations look like stray dots in "forbidden" regions of higher-level
    /// holes. By ~iteration 20 the dot is in a sub-triangle smaller than a
    /// pixel, so anything past the burn-in is visually indistinguishable
    /// from the true attractor.
    pub burn_in_iterations: u32,
    pub padding: f32,
}

impl Default for SierpinskiTriangleVizConfig {
    fn default() -> Self {
        Self {
            background: [0.07, 0.07, 0.09, 1.0],
            triangle_color: [0.45, 0.45, 0.50, 0.8],
            corner_color: [0.85, 0.85, 0.88, 1.0],
            corner_highlight_color: [0.98, 0.85, 0.30, 1.0],
            corner_size_px: 10.0,
            trail_color: [0.65, 0.85, 0.95, 1.0],
            trail_size_px: 3.5,
            current_color: [0.95, 0.55, 0.35, 1.0],
            current_size_px: 7.0,
            guide_color: [0.95, 0.75, 0.35, 0.55],
            burn_in_iterations: 20,
            padding: 0.1,
        }
    }
}

impl ConfigSchema for SierpinskiTriangleVizConfig {
    fn schema() -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "background": color_property("Background", [0.07, 0.07, 0.09, 1.0]),
                "triangle_color": color_property("Triangle edge color", [0.45, 0.45, 0.50, 0.8]),
                "corner_color": color_property("Corner dot color", [0.85, 0.85, 0.88, 1.0]),
                "corner_highlight_color": color_property("Highlighted corner color", [0.98, 0.85, 0.30, 1.0]),
                "corner_size_px": number_property(NumberOpts {
                    label: "Corner dot size (px)",
                    default: 10.0, min: 1.0, max: 30.0, step: 0.5,
                    integer: false, cosmetic: true, widget: None,
                }),
                "trail_color": color_property("Trail dot color", [0.65, 0.85, 0.95, 1.0]),
                "trail_size_px": number_property(NumberOpts {
                    label: "Trail dot size (px)",
                    default: 3.5, min: 0.5, max: 20.0, step: 0.1,
                    integer: false, cosmetic: true, widget: None,
                }),
                "current_color": color_property("Current dot color", [0.95, 0.55, 0.35, 1.0]),
                "current_size_px": number_property(NumberOpts {
                    label: "Current dot size (px)",
                    default: 7.0, min: 0.5, max: 20.0, step: 0.1,
                    integer: false, cosmetic: true, widget: None,
                }),
                "guide_color": color_property("Guide line color", [0.95, 0.75, 0.35, 0.55]),
                "burn_in_iterations": number_property(NumberOpts {
                    label: "Skip first N iterations (burn-in)",
                    default: 20.0, min: 0.0, max: 1000.0, step: 1.0,
                    integer: true, cosmetic: true, widget: None,
                }),
                "padding": number_property(NumberOpts {
                    label: "Padding around triangle",
                    default: 0.1, min: 0.0, max: 1.0, step: 0.01,
                    integer: false, cosmetic: true, widget: None,
                }),
            },
            "required": [
                "background", "triangle_color",
                "corner_color", "corner_highlight_color", "corner_size_px",
                "trail_color", "trail_size_px",
                "current_color", "current_size_px",
                "guide_color",
                "burn_in_iterations",
                "padding"
            ],
        })
    }

    fn defaults() -> serde_json::Value {
        serde_json::to_value(SierpinskiTriangleVizConfig::default()).unwrap()
    }
}

pub struct SierpinskiTriangle {
    camera: Camera2D,
    /// Multiplicative zoom — 1.0 fits the triangle to the viewport, >1
    /// zooms in. Updated via the Visualization::set_zoom trait method.
    zoom: f32,
    points: Option<InstancedPoints>,
    lines: Option<LineBatch>,
}

impl SierpinskiTriangle {
    pub fn new() -> Self {
        Self {
            camera: Camera2D::new(),
            zoom: 1.0,
            points: None,
            lines: None,
        }
    }

    fn ensure_resources(&mut self, gl: &WebGl2RenderingContext) -> Result<(), String> {
        if self.points.is_none() { self.points = Some(InstancedPoints::new(gl)?); }
        if self.lines.is_none()  { self.lines  = Some(LineBatch::new(gl)?); }
        Ok(())
    }
}

impl Default for SierpinskiTriangle {
    fn default() -> Self { Self::new() }
}

impl Visualization for SierpinskiTriangle {
    type Config = SierpinskiTriangleVizConfig;
    type State = ChaosGameState;

    fn id(&self) -> &'static str { "sierpinski-triangle" }

    fn init(&mut self, gl: &WebGl2RenderingContext, _cfg: &Self::Config) {
        let _ = self.ensure_resources(gl);
    }

    fn render(
        &mut self,
        gl: &WebGl2RenderingContext,
        state: &Self::State,
        cfg: &Self::Config,
    ) {
        if self.ensure_resources(gl).is_err() {
            return;
        }
        let points = self.points.as_mut().unwrap();
        let lines  = self.lines.as_mut().unwrap();

        // Fit camera to the triangle's bbox: x ∈ [-0.5, 0.5], y ∈ [-0.289, 0.577].
        let bbox_min = [CORNERS[1][0], CORNERS[1][1]];
        let bbox_max = [CORNERS[2][0], CORNERS[0][1]];
        self.camera.fit_to_bbox(bbox_min, bbox_max, cfg.padding.max(0.0));
        // Apply zoom after fit: larger zoom shrinks half_width → zooms in.
        self.camera.half_width /= self.zoom.max(0.1);
        let proj = self.camera.projection();
        let viewport = self.camera.viewport_px;

        // Background.
        gl.clear_color(cfg.background[0], cfg.background[1], cfg.background[2], cfg.background[3]);
        gl.clear(WebGl2RenderingContext::COLOR_BUFFER_BIT);

        // Triangle edges (3 line segments) + optional guide line from the
        // current trail position to the chosen corner. Single batch.
        let mut line_verts: Vec<LineVertex> = Vec::with_capacity(8);
        line_verts.push(LineVertex { position: CORNERS[0], color: cfg.triangle_color });
        line_verts.push(LineVertex { position: CORNERS[1], color: cfg.triangle_color });
        line_verts.push(LineVertex { position: CORNERS[1], color: cfg.triangle_color });
        line_verts.push(LineVertex { position: CORNERS[2], color: cfg.triangle_color });
        line_verts.push(LineVertex { position: CORNERS[2], color: cfg.triangle_color });
        line_verts.push(LineVertex { position: CORNERS[0], color: cfg.triangle_color });
        if let Some(corner_idx) = state.chosen_corner {
            // The start of this iteration's move is the last trail dot (or the
            // initial random position if no iterations have completed). The
            // guide runs from there to the chosen corner; the new permanent
            // dot lands at the midpoint.
            let start = state.trail.last().copied().unwrap_or(state.initial_position);
            line_verts.push(LineVertex { position: start,             color: cfg.guide_color });
            line_verts.push(LineVertex { position: CORNERS[corner_idx], color: cfg.guide_color });
        }
        lines.upload(gl, &line_verts);
        lines.draw(gl, &proj);

        // Dots: trail (many small) + 3 corners (big) + current (small-medium).
        // Order matters for z (later = on top). Trail under, corners + current
        // over so they read against the trail.
        // Conditional burn-in: the chaos orbit hasn't yet converged onto the
        // Sierpinski set during the first few iterations, so those early
        // dots can sit in level-N holes that get carved out at deeper
        // levels. BUT skipping them only makes sense once the trail is long
        // enough that the burn-in is a small fraction of what's visible —
        // otherwise stepping through iterations 1..20 shows nothing, which
        // defeats the learning use case. Apply skip only past 2× burn-in.
        let burn_in = cfg.burn_in_iterations as usize;
        let skip = if state.trail.len() > burn_in * 2 { burn_in } else { 0 };
        let trail_to_show = &state.trail[skip..];
        let mut all_points: Vec<PointInstance> =
            Vec::with_capacity(trail_to_show.len() + 4);
        for p in trail_to_show {
            all_points.push(PointInstance {
                position: *p,
                color: cfg.trail_color,
                radius_px: cfg.trail_size_px * 0.5,
            });
        }
        for (i, &corner) in CORNERS.iter().enumerate() {
            let highlighted = state.chosen_corner == Some(i);
            all_points.push(PointInstance {
                position: corner,
                color: if highlighted { cfg.corner_highlight_color } else { cfg.corner_color },
                radius_px: cfg.corner_size_px * 0.5,
            });
        }
        if let Some(p) = state.current_position {
            all_points.push(PointInstance {
                position: p,
                color: cfg.current_color,
                radius_px: cfg.current_size_px * 0.5,
            });
        }
        points.upload(gl, &all_points);
        points.draw(gl, &proj, viewport);
    }

    fn resize(&mut self, gl: &WebGl2RenderingContext, w: u32, h: u32) {
        self.camera.resize(w, h);
        gl.viewport(0, 0, w as i32, h as i32);
    }

    fn set_zoom(&mut self, zoom: f32) {
        // Clamp to a sensible range: 0.25× (zoomed way out, triangle is
        // tiny) to 20× (zoomed in tight on a sub-region).
        self.zoom = zoom.clamp(0.25, 20.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_round_trip() {
        let v: SierpinskiTriangleVizConfig =
            serde_json::from_value(SierpinskiTriangleVizConfig::defaults()).unwrap();
        assert!((v.padding - 0.1).abs() < 1e-6);
        assert_eq!(v.trail_size_px, 3.5);
    }

    #[test]
    fn schema_lists_all_required_fields() {
        let schema = SierpinskiTriangleVizConfig::schema();
        let required = schema["required"].as_array().expect("required array");
        assert_eq!(required.len(), 12);
    }
}
