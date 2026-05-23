//! Visualization for MidpointOnCircle: a stroked circle, all permanent
//! midpoints, the two in-flight reference dots, an optional connecting line,
//! and an optional preview-midpoint dot during the substep merge phase.
//!
//! Composes render utilities: SdfCircle for the boundary, InstancedPoints
//! for all the dot types, LineBatch for the reference line. Camera2D fits
//! the unit circle to the viewport with padding.

use serde::{Deserialize, Serialize};
use web_sys::WebGl2RenderingContext;

use crate::config::{color_property, number_property, ConfigSchema, NumberOpts};
use crate::render::{Camera2D, InstancedPoints, LineBatch, LineVertex, PointInstance, SdfCircle};
use crate::rules::midpoint_on_circle::MidpointState;
use crate::traits::Visualization;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DotsOnCircleVizConfig {
    pub background: [f32; 4],
    pub circle_color: [f32; 4],
    pub circle_stroke_px: f32,
    pub perimeter_color: [f32; 4],
    pub interior_color: [f32; 4],
    pub midpoint_color: [f32; 4],
    pub preview_color: [f32; 4],
    pub line_color: [f32; 4],
    pub dot_size_px: f32,
    pub ref_dot_size_px: f32,
    pub padding: f32,  // world units of padding around the unit circle
}

impl Default for DotsOnCircleVizConfig {
    fn default() -> Self {
        Self {
            background: [0.07, 0.07, 0.09, 1.0],
            circle_color: [0.85, 0.85, 0.88, 1.0],
            circle_stroke_px: 1.5,
            perimeter_color: [0.95, 0.55, 0.35, 1.0],
            interior_color: [0.40, 0.80, 0.95, 1.0],
            midpoint_color: [0.90, 0.90, 0.95, 1.0],
            preview_color: [0.75, 0.90, 0.45, 1.0],
            line_color: [0.55, 0.55, 0.60, 0.8],
            dot_size_px: 3.0,
            ref_dot_size_px: 7.0,
            padding: 0.1,
        }
    }
}

impl ConfigSchema for DotsOnCircleVizConfig {
    fn schema() -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "background": color_property("Background", [0.07, 0.07, 0.09, 1.0]),
                "circle_color": color_property("Circle color", [0.85, 0.85, 0.88, 1.0]),
                "circle_stroke_px": number_property(NumberOpts {
                    label: "Circle stroke (px)",
                    default: 1.5, min: 0.5, max: 8.0, step: 0.1,
                    integer: false, cosmetic: true, widget: None,
                }),
                "perimeter_color": color_property("Perimeter dot color", [0.95, 0.55, 0.35, 1.0]),
                "interior_color": color_property("Interior dot color", [0.40, 0.80, 0.95, 1.0]),
                "midpoint_color": color_property("Midpoint dot color", [0.90, 0.90, 0.95, 1.0]),
                "preview_color": color_property("Preview midpoint color", [0.75, 0.90, 0.45, 1.0]),
                "line_color": color_property("Reference line color", [0.55, 0.55, 0.60, 0.8]),
                "dot_size_px": number_property(NumberOpts {
                    label: "Midpoint dot size (px)",
                    default: 3.0, min: 0.5, max: 20.0, step: 0.1,
                    integer: false, cosmetic: true, widget: None,
                }),
                "ref_dot_size_px": number_property(NumberOpts {
                    label: "Reference dot size (px)",
                    default: 7.0, min: 0.5, max: 30.0, step: 0.1,
                    integer: false, cosmetic: true, widget: None,
                }),
                "padding": number_property(NumberOpts {
                    label: "Padding around circle",
                    default: 0.1, min: 0.0, max: 1.0, step: 0.01,
                    integer: false, cosmetic: true, widget: None,
                }),
            },
            "required": [
                "background", "circle_color", "circle_stroke_px",
                "perimeter_color", "interior_color", "midpoint_color",
                "preview_color", "line_color",
                "dot_size_px", "ref_dot_size_px", "padding"
            ],
        })
    }

    fn defaults() -> serde_json::Value {
        serde_json::to_value(DotsOnCircleVizConfig::default()).unwrap()
    }
}

pub struct DotsOnCircle {
    camera: Camera2D,
    circle: Option<SdfCircle>,
    points: Option<InstancedPoints>,
    lines: Option<LineBatch>,
}

impl DotsOnCircle {
    pub fn new() -> Self {
        Self {
            camera: Camera2D::new(),
            circle: None,
            points: None,
            lines: None,
        }
    }

    fn ensure_resources(&mut self, gl: &WebGl2RenderingContext) -> Result<(), String> {
        if self.circle.is_none() { self.circle = Some(SdfCircle::new(gl)?); }
        if self.points.is_none() { self.points = Some(InstancedPoints::new(gl)?); }
        if self.lines.is_none()  { self.lines  = Some(LineBatch::new(gl)?); }
        Ok(())
    }
}

impl Default for DotsOnCircle {
    fn default() -> Self { Self::new() }
}

impl Visualization for DotsOnCircle {
    type Config = DotsOnCircleVizConfig;
    type State = MidpointState;

    fn id(&self) -> &'static str { "dots-on-circle" }

    fn init(&mut self, gl: &WebGl2RenderingContext, _cfg: &Self::Config) {
        // Try to allocate GPU resources. Errors are swallowed here — the next
        // render call will retry and the engine's frame() will log the failure
        // via console.warn.
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
        let circle = self.circle.as_ref().unwrap();
        let points = self.points.as_mut().unwrap();
        let lines  = self.lines.as_mut().unwrap();

        // Fit camera to the unit circle + padding.
        self.camera
            .fit_to_bbox([-1.0, -1.0], [1.0, 1.0], cfg.padding.max(0.0));
        let proj = self.camera.projection();
        let viewport = self.camera.viewport_px;

        // Background.
        gl.clear_color(cfg.background[0], cfg.background[1], cfg.background[2], cfg.background[3]);
        gl.clear(WebGl2RenderingContext::COLOR_BUFFER_BIT);

        // Circle stroke. Convert pixel stroke to world units.
        let world_per_px = self.camera.half_width * 2.0 / viewport[0].max(1) as f32;
        let stroke_world = cfg.circle_stroke_px * world_per_px * 0.5;
        circle.draw(gl, &proj, cfg.circle_color, stroke_world, world_per_px);

        // Permanent midpoints + the optional preview midpoint + the two ref
        // dots all go in a single InstancedPoints draw — they share a shader
        // and only differ in per-instance color/size.
        let mut all_points: Vec<PointInstance> = Vec::with_capacity(
            state.permanent.len() + 3,
        );
        for p in &state.permanent {
            all_points.push(PointInstance {
                position: *p,
                color: cfg.midpoint_color,
                radius_px: cfg.dot_size_px * 0.5,
            });
        }
        if let Some(p) = state.preview_midpoint {
            all_points.push(PointInstance {
                position: p,
                color: cfg.preview_color,
                radius_px: cfg.ref_dot_size_px * 0.5,
            });
        }
        if let Some(p) = state.ref_perimeter {
            all_points.push(PointInstance {
                position: p,
                color: cfg.perimeter_color,
                radius_px: cfg.ref_dot_size_px * 0.5,
            });
        }
        if let Some(p) = state.ref_interior {
            all_points.push(PointInstance {
                position: p,
                color: cfg.interior_color,
                radius_px: cfg.ref_dot_size_px * 0.5,
            });
        }
        points.upload(gl, &all_points);
        points.draw(gl, &proj, viewport);

        // Reference line (only present when both ref dots are present).
        if let (Some(a), Some(b)) = (state.ref_perimeter, state.ref_interior) {
            let vs = [
                LineVertex { position: a, color: cfg.line_color },
                LineVertex { position: b, color: cfg.line_color },
            ];
            lines.upload(gl, &vs);
            lines.draw(gl, &proj);
        } else {
            lines.upload(gl, &[]);
        }
    }

    fn resize(&mut self, gl: &WebGl2RenderingContext, w: u32, h: u32) {
        self.camera.resize(w, h);
        gl.viewport(0, 0, w as i32, h as i32);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_round_trip() {
        let v: DotsOnCircleVizConfig =
            serde_json::from_value(DotsOnCircleVizConfig::defaults()).unwrap();
        assert!((v.padding - 0.1).abs() < 1e-6);
        assert_eq!(v.dot_size_px, 3.0);
    }

    #[test]
    fn schema_lists_all_required_fields() {
        let schema = DotsOnCircleVizConfig::schema();
        let required = schema["required"].as_array().expect("required array");
        // 11 fields per the impl above.
        assert_eq!(required.len(), 11);
    }
}
