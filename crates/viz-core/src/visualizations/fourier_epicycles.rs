//! Visualization for FourierEpicycles: the chain of rotating circles
//! (batched rings + arms), the pen-tagged trail the tip has drawn so far,
//! and the pen dot at the tip.
//!
//! Composes render utilities: InstancedRings for the K circles in one draw,
//! LineBatch for the arms and the trail segments, InstancedPoints for the
//! trail dots and the pen. Camera2D fits the path's bbox unioned with the
//! largest ring so the whole mechanism stays in frame; `set_zoom` scales
//! that fit.
//!
//! The viz owns all GL state for its frame: BLEND is enabled around the
//! whole draw (rings and points are alpha-feathered) and restored at the end.

use serde::{Deserialize, Serialize};
use web_sys::WebGl2RenderingContext;

use crate::config::{color_property, number_property, ConfigSchema, NumberOpts};
use crate::render::{
    Camera2D, InstancedPoints, InstancedRings, LineBatch, LineVertex, PointInstance, RingInstance,
};
use crate::rules::fourier_epicycles::FourierState;
use crate::traits::Visualization;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FourierEpicyclesVizConfig {
    pub background: [f32; 4],
    pub circle_color: [f32; 4],
    pub arm_color: [f32; 4],
    pub trail_color: [f32; 4],
    pub trail_size_px: f32,
    pub pen_color: [f32; 4],
    pub pen_size_px: f32,
    pub circle_stroke_px: f32,
    /// Rings whose *diameter* on screen is under this many pixels are not
    /// drawn. The math still includes them; this only trims sub-pixel noise
    /// from the hundreds of tiny high-frequency terms.
    pub min_circle_px: f32,
    /// World units of padding around the fitted bounds. The path is
    /// normalized by the UI to a max extent of ~2, so 0.15 is ~7%.
    pub padding: f32,
}

impl Default for FourierEpicyclesVizConfig {
    fn default() -> Self {
        Self {
            background: [0.07, 0.07, 0.09, 1.0],
            circle_color: [0.55, 0.60, 0.75, 0.55],
            arm_color: [0.85, 0.85, 0.90, 0.65],
            trail_color: [0.65, 0.85, 0.95, 1.0],
            trail_size_px: 2.0,
            pen_color: [0.98, 0.60, 0.35, 1.0],
            pen_size_px: 6.0,
            circle_stroke_px: 1.5,
            min_circle_px: 1.5,
            padding: 0.15,
        }
    }
}

impl ConfigSchema for FourierEpicyclesVizConfig {
    fn schema() -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "background":   color_property("Background",   [0.07, 0.07, 0.09, 1.0]),
                "circle_color": color_property("Circle color", [0.55, 0.60, 0.75, 0.55]),
                "arm_color":    color_property("Arm color",    [0.85, 0.85, 0.90, 0.65]),
                "trail_color":  color_property("Trail color",  [0.65, 0.85, 0.95, 1.0]),
                "trail_size_px": number_property(NumberOpts {
                    label: "Trail dot size (px)",
                    default: 2.0, min: 0.5, max: 20.0, step: 0.1,
                    integer: false, cosmetic: true, widget: None,
                }),
                "pen_color":    color_property("Pen color",    [0.98, 0.60, 0.35, 1.0]),
                "pen_size_px": number_property(NumberOpts {
                    label: "Pen dot size (px)",
                    default: 6.0, min: 0.5, max: 20.0, step: 0.1,
                    integer: false, cosmetic: true, widget: None,
                }),
                "circle_stroke_px": number_property(NumberOpts {
                    label: "Circle stroke (px)",
                    default: 1.5, min: 0.5, max: 8.0, step: 0.1,
                    integer: false, cosmetic: true, widget: None,
                }),
                "min_circle_px": number_property(NumberOpts {
                    label: "Hide circles smaller than (px)",
                    default: 1.5, min: 0.0, max: 20.0, step: 0.1,
                    integer: false, cosmetic: true, widget: None,
                }),
                "padding": number_property(NumberOpts {
                    label: "Padding around drawing",
                    default: 0.15, min: 0.0, max: 1.0, step: 0.01,
                    integer: false, cosmetic: true, widget: None,
                }),
            },
            "required": [
                "background", "circle_color", "arm_color",
                "trail_color", "trail_size_px",
                "pen_color", "pen_size_px",
                "circle_stroke_px", "min_circle_px", "padding"
            ],
        })
    }

    fn defaults() -> serde_json::Value {
        serde_json::to_value(FourierEpicyclesVizConfig::default()).unwrap()
    }
}

/// World-space bounds the camera should fit: the path's bbox (or the unit
/// square when there is no path) unioned with the disc swept by the largest
/// epicycle, `origin ± first_amp`. Without the union the biggest ring —
/// whose diameter can exceed the drawing — would poke out of frame.
fn fit_bounds(
    bbox: Option<([f32; 2], [f32; 2])>,
    origin: [f32; 2],
    first_amp: Option<f32>,
) -> ([f32; 2], [f32; 2]) {
    let (mut lo, mut hi) = bbox.unwrap_or(([-1.0, -1.0], [1.0, 1.0]));
    if let Some(r) = first_amp {
        lo = [lo[0].min(origin[0] - r), lo[1].min(origin[1] - r)];
        hi = [hi[0].max(origin[0] + r), hi[1].max(origin[1] + r)];
    }
    (lo, hi)
}

pub struct FourierEpicyclesViz {
    camera: Camera2D,
    /// 1.0 = fit-to-content; >1 zooms in. Applied on top of the per-frame fit.
    zoom: f32,
    points: Option<InstancedPoints>,
    lines: Option<LineBatch>,
    rings: Option<InstancedRings>,
    /// Per-frame scratch buffers, cleared each frame and never re-allocated
    /// once they reach steady size. A ~1200-point trail plus a ~250-ring
    /// chain would otherwise churn hundreds of KB of heap per frame.
    points_scratch: Vec<PointInstance>,
    line_scratch: Vec<LineVertex>,
    ring_scratch: Vec<RingInstance>,
}

impl FourierEpicyclesViz {
    pub fn new() -> Self {
        Self {
            camera: Camera2D::new(),
            zoom: 1.0,
            points: None,
            lines: None,
            rings: None,
            points_scratch: Vec::new(),
            line_scratch: Vec::new(),
            ring_scratch: Vec::new(),
        }
    }

    fn ensure_resources(&mut self, gl: &WebGl2RenderingContext) -> Result<(), String> {
        if self.points.is_none() {
            self.points = Some(InstancedPoints::new(gl)?);
        }
        if self.lines.is_none() {
            self.lines = Some(LineBatch::new(gl)?);
        }
        if self.rings.is_none() {
            self.rings = Some(InstancedRings::new(gl)?);
        }
        Ok(())
    }
}

impl Default for FourierEpicyclesViz {
    fn default() -> Self {
        Self::new()
    }
}

impl Visualization for FourierEpicyclesViz {
    type Config = FourierEpicyclesVizConfig;
    type State = FourierState;

    fn id(&self) -> &'static str {
        "fourier-epicycles"
    }

    fn init(&mut self, gl: &WebGl2RenderingContext, _cfg: &Self::Config) {
        // Errors are swallowed here — the next render call retries, and the
        // engine's frame() logs the failure via console.warn.
        let _ = self.ensure_resources(gl);
    }

    fn render(&mut self, gl: &WebGl2RenderingContext, state: &Self::State, cfg: &Self::Config) {
        if self.ensure_resources(gl).is_err() {
            return;
        }

        // ---- Camera: fit the path ∪ the largest ring, then apply zoom. ----
        // fit_to_bbox resets half_width, so the zoom divide must come after.
        let (lo, hi) = fit_bounds(
            state.bbox,
            state.origin,
            state.epicycles.first().map(|e| e.amp),
        );
        self.camera.fit_to_bbox(lo, hi, cfg.padding.max(0.0));
        self.camera.half_width /= self.zoom;
        let proj = self.camera.projection();
        let viewport = self.camera.viewport_px;
        let world_per_px = self.camera.half_width * 2.0 / viewport[0].max(1) as f32;

        let points = self.points.as_mut().unwrap();
        let lines = self.lines.as_mut().unwrap();
        let rings = self.rings.as_mut().unwrap();
        let points_scratch = &mut self.points_scratch;
        let line_scratch = &mut self.line_scratch;
        let ring_scratch = &mut self.ring_scratch;

        // ---- GL state. This viz owns it for the frame; the renderers below
        // are pure draw calls and never touch blend/depth. ----
        gl.disable(WebGl2RenderingContext::DEPTH_TEST);
        gl.enable(WebGl2RenderingContext::BLEND);
        gl.blend_func(
            WebGl2RenderingContext::SRC_ALPHA,
            WebGl2RenderingContext::ONE_MINUS_SRC_ALPHA,
        );
        gl.clear_color(
            cfg.background[0],
            cfg.background[1],
            cfg.background[2],
            cfg.background[3],
        );
        gl.clear(WebGl2RenderingContext::COLOR_BUFFER_BIT);

        let trail = &state.trail;
        let trail_pen = &state.trail_pen;
        debug_assert_eq!(trail.len(), trail_pen.len());

        // ---- Trail segments. ----
        // A segment is inked only when the pen is down at BOTH endpoints.
        // That never draws across a travel hop regardless of which sample
        // the flag is read as belonging to, at the cost of at most one
        // sub-sample-length gap at each pen lift.
        line_scratch.clear();
        line_scratch.reserve(trail.len() * 2 + 4);
        let push_seg = |buf: &mut Vec<LineVertex>, a: [f32; 2], b: [f32; 2], color: [f32; 4]| {
            buf.push(LineVertex { position: a, color });
            buf.push(LineVertex { position: b, color });
        };
        for i in 1..trail.len() {
            if trail_pen[i - 1] && trail_pen[i] {
                push_seg(line_scratch, trail[i - 1], trail[i], cfg.trail_color);
            }
        }
        // Live ink: connect the newest sample to the tip so the drawn line
        // doesn't lag one step behind the pen.
        if let (Some(&last), Some(&true), Some(pen)) = (trail.last(), trail_pen.last(), state.pen) {
            push_seg(line_scratch, last, pen, cfg.trail_color);
        }
        // Closing segment once the trace is complete (the path is closed,
        // but the trail's final sample sits one step short of trail[0]).
        let complete = state.current_iteration == state.steps_per_loop;
        if complete && trail.len() >= 2 && trail_pen.last() == Some(&true) && trail_pen[0] {
            push_seg(
                line_scratch,
                trail[trail.len() - 1],
                trail[0],
                cfg.trail_color,
            );
        }
        // Always upload, even when empty, so stale geometry never lingers.
        lines.upload(gl, line_scratch);
        lines.draw(gl, &proj);

        // ---- Trail dots (built now, drawn with the pen in one call below). ----
        points_scratch.clear();
        points_scratch.reserve(trail.len() + 1);
        let trail_radius = cfg.trail_size_px * 0.5;
        for (p, &inked) in trail.iter().zip(trail_pen.iter()) {
            if inked {
                points_scratch.push(PointInstance {
                    position: *p,
                    color: cfg.trail_color,
                    radius_px: trail_radius,
                });
            }
        }

        // ---- Arms: chain[i-1] → chain[i]. Empty once the trace completes. ----
        let chain = &state.chain;
        line_scratch.clear();
        line_scratch.reserve(chain.len().saturating_sub(1) * 2);
        for w in chain.windows(2) {
            push_seg(line_scratch, w[0], w[1], cfg.arm_color);
        }
        lines.upload(gl, line_scratch);
        lines.draw(gl, &proj);

        // ---- Rings: ring i is centered at chain[i] with radius amp_i. ----
        // zip stops at the shorter side, so with an empty chain nothing is
        // drawn and with a live chain (K+1 points) all K rings are.
        ring_scratch.clear();
        ring_scratch.reserve(state.epicycles.len());
        for (e, &center) in state.epicycles.iter().zip(chain.iter()) {
            let diameter_px = e.amp * 2.0 / world_per_px;
            if diameter_px < cfg.min_circle_px {
                continue;
            }
            ring_scratch.push(RingInstance {
                center,
                radius: e.amp,
                color: cfg.circle_color,
            });
        }
        rings.upload(gl, ring_scratch);
        rings.draw(
            gl,
            &proj,
            cfg.circle_stroke_px * world_per_px * 0.5,
            world_per_px,
        );

        // ---- Pen dot, pushed last so it draws on top of the trail dots. ----
        if let Some(p) = state.pen {
            points_scratch.push(PointInstance {
                position: p,
                color: cfg.pen_color,
                radius_px: cfg.pen_size_px * 0.5,
            });
        }
        points.upload(gl, points_scratch);
        points.draw(gl, &proj, viewport);

        // Restore default GL state so a future viz swap inherits a clean slate.
        gl.disable(WebGl2RenderingContext::BLEND);
    }

    fn resize(&mut self, gl: &WebGl2RenderingContext, w: u32, h: u32) {
        self.camera.resize(w, h);
        gl.viewport(0, 0, w as i32, h as i32);
    }

    fn set_zoom(&mut self, zoom: f32) {
        self.zoom = zoom.clamp(0.25, 8.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_round_trip() {
        let v: FourierEpicyclesVizConfig =
            serde_json::from_value(FourierEpicyclesVizConfig::defaults()).unwrap();
        assert!((v.padding - 0.15).abs() < 1e-6);
        assert_eq!(v.pen_size_px, 6.0);
        assert_eq!(v.min_circle_px, 1.5);
        assert_eq!(
            serde_json::to_value(&v).unwrap(),
            FourierEpicyclesVizConfig::defaults()
        );
    }

    #[test]
    fn schema_lists_all_required_fields() {
        let schema = FourierEpicyclesVizConfig::schema();
        let required = schema["required"].as_array().expect("required array");
        assert_eq!(required.len(), 10);
        for key in required {
            let key = key.as_str().unwrap();
            assert!(
                schema["properties"].get(key).is_some(),
                "no property for {key}"
            );
        }
    }

    #[test]
    fn id_is_fourier_epicycles() {
        assert_eq!(FourierEpicyclesViz::new().id(), "fourier-epicycles");
    }

    #[test]
    fn set_zoom_clamps() {
        let mut viz = FourierEpicyclesViz::new();
        viz.set_zoom(100.0);
        assert_eq!(viz.zoom, 8.0);
        viz.set_zoom(0.0);
        assert_eq!(viz.zoom, 0.25);
        viz.set_zoom(2.0);
        assert_eq!(viz.zoom, 2.0);
    }

    #[test]
    fn fit_bounds_none_is_unit_square() {
        assert_eq!(
            fit_bounds(None, [0.0, 0.0], None),
            ([-1.0, -1.0], [1.0, 1.0])
        );
    }

    #[test]
    fn fit_bounds_without_epicycles_is_the_bbox() {
        let bbox = ([-0.5, -2.0], [3.0, 0.25]);
        assert_eq!(fit_bounds(Some(bbox), [7.0, 7.0], None), bbox);
    }

    #[test]
    fn fit_bounds_expands_to_a_larger_disc() {
        let bbox = ([-0.5, -0.5], [0.5, 0.5]);
        assert_eq!(
            fit_bounds(Some(bbox), [0.0, 0.0], Some(2.0)),
            ([-2.0, -2.0], [2.0, 2.0])
        );
    }

    #[test]
    fn fit_bounds_keeps_a_bbox_that_already_contains_the_disc() {
        let bbox = ([-3.0, -3.0], [3.0, 3.0]);
        assert_eq!(fit_bounds(Some(bbox), [0.0, 0.0], Some(1.0)), bbox);
    }

    #[test]
    fn fit_bounds_expands_only_the_sides_the_disc_exceeds() {
        let bbox = ([-1.0, -1.0], [1.0, 1.0]);
        assert_eq!(
            fit_bounds(Some(bbox), [1.0, 0.0], Some(1.0)),
            ([-1.0, -1.0], [2.0, 1.0])
        );
    }
}
