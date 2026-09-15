//! Visualization for SortingRace: one small bar chart per lane, drawn into
//! rectangles the DOM hands down.
//!
//! Rust does no layout here. The lab overlays a CSS grid on the canvas,
//! measures its body cells and pushes them through `update_viz_config` as
//! `cells: [[x, y, w, h], …]` in **device pixels**, canvas origin top-left,
//! in the same row-major order as `SortingState::lanes`. This viz just fills
//! each rectangle with that lane's bars, so resizing the grid is a CSS
//! problem and never a shader one.
//!
//! Everything is one `InstancedQuads` draw: 28 lanes × 50 bars is 1400
//! opaque rects per frame. The viz owns its GL state for the frame — blend
//! and depth are off, since the bars are opaque and axis-aligned.

use serde::{Deserialize, Serialize};
use web_sys::WebGl2RenderingContext;

use crate::config::{color_property, number_property, ConfigSchema, NumberOpts};
use crate::render::{InstancedQuads, QuadInstance};
use crate::rules::sorting::{Lane, Op, SortingState};
use crate::traits::Visualization;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SortingVizConfig {
    pub background: [f32; 4],
    pub bar_color: [f32; 4],
    /// Bars touched by the last `Compare`.
    pub compare_color: [f32; 4],
    /// Bars touched by the last `Swap` / `Write`.
    pub write_color: [f32; 4],
    /// Every bar of a lane that has replayed its whole trace.
    pub done_color: [f32; 4],
    /// Gap between neighbouring bars, as a fraction of the slot width.
    pub bar_gap: f32,
    /// Inset from each cell rectangle, in device pixels.
    pub cell_padding_px: f32,
    /// `[x, y, w, h]` per lane in device pixels, canvas origin top-left,
    /// row-major like `SortingState::lanes`. Supplied by the lab's DOM grid;
    /// empty until the first measurement, which draws nothing but the
    /// background. Lanes without a cell are skipped; extra cells are ignored.
    #[serde(default)]
    pub cells: Vec<[f32; 4]>,
}

impl Default for SortingVizConfig {
    fn default() -> Self {
        Self {
            // #0f0f13
            background: [0.059, 0.059, 0.075, 1.0],
            // #9aa0b4
            bar_color: [0.604, 0.627, 0.706, 1.0],
            // #f2c14e
            compare_color: [0.949, 0.757, 0.306, 1.0],
            // #ef5b5b
            write_color: [0.937, 0.357, 0.357, 1.0],
            // #57c47b
            done_color: [0.341, 0.769, 0.482, 1.0],
            bar_gap: 0.15,
            cell_padding_px: 4.0,
            cells: Vec::new(),
        }
    }
}

impl ConfigSchema for SortingVizConfig {
    fn schema() -> serde_json::Value {
        let d = SortingVizConfig::default();
        serde_json::json!({
            "type": "object",
            "properties": {
                "background":    color_property("Background",    d.background),
                "bar_color":     color_property("Bar",           d.bar_color),
                "compare_color": color_property("Compare",       d.compare_color),
                "write_color":   color_property("Write",         d.write_color),
                "done_color":    color_property("Done",          d.done_color),
                "bar_gap": number_property(NumberOpts {
                    label: "Bar gap (fraction of slot)",
                    default: 0.15, min: 0.0, max: 0.9, step: 0.01,
                    integer: false, cosmetic: true, widget: None,
                }),
                "cell_padding_px": number_property(NumberOpts {
                    label: "Cell padding (px)",
                    default: 4.0, min: 0.0, max: 40.0, step: 1.0,
                    integer: false, cosmetic: true, widget: None,
                }),
                "cells": {
                    "type": "array",
                    "title": "Cell rectangles (device px)",
                    "items": {
                        "type": "array",
                        "items": { "type": "number" },
                        "minItems": 4,
                        "maxItems": 4,
                    },
                    "default": [],
                    "x-widget": "rects",
                    "x-cosmetic": true,
                },
            },
            "required": [
                "background", "bar_color", "compare_color", "write_color", "done_color",
                "bar_gap", "cell_padding_px", "cells"
            ],
        })
    }

    fn defaults() -> serde_json::Value {
        serde_json::to_value(SortingVizConfig::default()).unwrap()
    }
}

/// Column-major mat3 mapping device pixels to clip space with **y down**, so
/// the cell rectangles measured in the DOM can be used verbatim:
/// `x ∈ [0, w] → [-1, 1]`, `y ∈ [0, h] → [1, -1]`.
fn pixel_projection(w: u32, h: u32) -> [f32; 9] {
    let w = w.max(1) as f32;
    let h = h.max(1) as f32;
    [2.0 / w, 0.0, 0.0, 0.0, -2.0 / h, 0.0, -1.0, 1.0, 1.0]
}

/// Color for bar `k`: a finished lane is uniformly `done_color`, otherwise the
/// indices of the op the cursor last applied are highlighted.
fn bar_color(lane: &Lane, k: usize, cfg: &SortingVizConfig) -> [f32; 4] {
    if lane.done() {
        return cfg.done_color;
    }
    let k = k as u16;
    match lane.last_op() {
        Some(Op::Compare(a, b)) if k == a || k == b => cfg.compare_color,
        Some(Op::Swap(a, b)) if k == a || k == b => cfg.write_color,
        Some(Op::Write(i, _)) if k == i => cfg.write_color,
        _ => cfg.bar_color,
    }
}

/// Append one lane's bars, laid out inside `cell` = `[x, y, w, h]` in device
/// pixels (origin top-left) inset by `cell_padding_px`. Bar heights are
/// proportional to the lane's largest value, so a lane always fills its cell.
fn push_lane_bars(
    out: &mut Vec<QuadInstance>,
    cell: [f32; 4],
    lane: &Lane,
    cfg: &SortingVizConfig,
) {
    let pad = cfg.cell_padding_px.max(0.0);
    let x = cell[0] + pad;
    let y = cell[1] + pad;
    let inner_w = (cell[2] - 2.0 * pad).max(0.0);
    let inner_h = (cell[3] - 2.0 * pad).max(0.0);

    let n = lane.values.len();
    if n == 0 || inner_w <= 0.0 || inner_h <= 0.0 {
        return;
    }

    let slot = inner_w / n as f32;
    let gap = cfg.bar_gap.clamp(0.0, 0.9);
    let max_value = lane.values.iter().copied().max().unwrap_or(1).max(1) as f32;

    out.reserve(n);
    for (k, &v) in lane.values.iter().enumerate() {
        let x0 = x + k as f32 * slot + slot * gap * 0.5;
        // Sub-pixel bars would vanish entirely at 300 values in a small cell.
        let x1 = x0 + (slot * (1.0 - gap)).max(1.0);
        let bar_h = inner_h * v as f32 / max_value;
        out.push(QuadInstance {
            min: [x0, y + inner_h - bar_h],
            max: [x1, y + inner_h],
            color: bar_color(lane, k, cfg),
        });
    }
}

pub struct SortingViz {
    viewport: [u32; 2],
    quads: Option<InstancedQuads>,
    /// Per-frame scratch, cleared and refilled so a 28×300 grid doesn't churn
    /// hundreds of KB of heap every frame.
    quad_scratch: Vec<QuadInstance>,
}

impl SortingViz {
    pub fn new() -> Self {
        Self {
            viewport: [1, 1],
            quads: None,
            quad_scratch: Vec::new(),
        }
    }

    fn ensure_resources(&mut self, gl: &WebGl2RenderingContext) -> Result<(), String> {
        if self.quads.is_none() {
            self.quads = Some(InstancedQuads::new(gl)?);
        }
        Ok(())
    }
}

impl Default for SortingViz {
    fn default() -> Self {
        Self::new()
    }
}

impl Visualization for SortingViz {
    type Config = SortingVizConfig;
    type State = SortingState;

    fn id(&self) -> &'static str {
        "sorting"
    }

    fn init(&mut self, gl: &WebGl2RenderingContext, _cfg: &Self::Config) {
        // Errors are swallowed here — the next render retries, and the
        // engine's frame() logs the failure via console.warn.
        let _ = self.ensure_resources(gl);
    }

    fn render(&mut self, gl: &WebGl2RenderingContext, state: &Self::State, cfg: &Self::Config) {
        if self.ensure_resources(gl).is_err() {
            return;
        }

        // ---- GL state. The bars are opaque axis-aligned rects: no blending,
        // no depth. InstancedQuads is a pure draw call and touches neither. ----
        gl.disable(WebGl2RenderingContext::DEPTH_TEST);
        gl.disable(WebGl2RenderingContext::BLEND);
        gl.clear_color(
            cfg.background[0],
            cfg.background[1],
            cfg.background[2],
            cfg.background[3],
        );
        gl.clear(WebGl2RenderingContext::COLOR_BUFFER_BIT);

        let scratch = &mut self.quad_scratch;
        scratch.clear();
        for (i, lane) in state.lanes.iter().enumerate() {
            let Some(&cell) = cfg.cells.get(i) else {
                continue;
            };
            push_lane_bars(scratch, cell, lane, cfg);
        }

        let proj = pixel_projection(self.viewport[0], self.viewport[1]);
        let quads = self.quads.as_mut().unwrap();
        // Always upload, even when empty, so stale geometry never lingers.
        quads.upload(gl, scratch);
        quads.draw(gl, &proj);
    }

    fn resize(&mut self, gl: &WebGl2RenderingContext, w: u32, h: u32) {
        self.viewport = [w, h];
        gl.viewport(0, 0, w as i32, h as i32);
    }

    /// Ignored: the lab hides the zoom control, because the bar grid is laid
    /// out by the DOM and zooming it would desync the cells from the overlay.
    fn set_zoom(&mut self, _zoom: f32) {}
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::sorting::{Algorithm, Dataset};

    /// An un-started lane. The trailing op keeps it short of `done()`, which
    /// would otherwise swallow every other color.
    fn lane(values: &[u16]) -> Lane {
        Lane {
            algorithm: Algorithm::Bubble,
            dataset: Dataset::Random,
            initial: values.to_vec(),
            values: values.to_vec(),
            ops: vec![Op::Compare(0, 0)],
            cursor: 0,
            running: false,
            compares: 0,
            writes: 0,
        }
    }

    /// A lane whose cursor has just applied `last`, with one op still pending
    /// so it is not `done()`.
    fn lane_after(values: &[u16], last: Op) -> Lane {
        let mut l = lane(values);
        l.ops = vec![last, Op::Compare(0, 0)];
        l.cursor = 1;
        assert!(!l.done());
        assert_eq!(l.last_op(), Some(last));
        l
    }

    #[test]
    fn defaults_round_trip() {
        let v: SortingVizConfig = serde_json::from_value(SortingVizConfig::defaults()).unwrap();
        assert_eq!(v.bar_gap, 0.15);
        assert_eq!(v.cell_padding_px, 4.0);
        assert!(v.cells.is_empty());
        assert_eq!(
            serde_json::to_value(&v).unwrap(),
            SortingVizConfig::defaults()
        );
    }

    #[test]
    fn schema_lists_all_required_fields() {
        let schema = SortingVizConfig::schema();
        let required = schema["required"].as_array().expect("required array");
        assert_eq!(required.len(), 8);
        for key in required {
            let key = key.as_str().unwrap();
            assert!(
                schema["properties"].get(key).is_some(),
                "no property for {key}"
            );
        }
        assert_eq!(schema["properties"]["cells"]["x-widget"], "rects");
        assert_eq!(schema["properties"]["cells"]["items"]["minItems"], 4);
    }

    #[test]
    fn cells_are_optional_when_deserializing() {
        let mut cfg = SortingVizConfig::defaults();
        cfg.as_object_mut().unwrap().remove("cells");
        let v: SortingVizConfig = serde_json::from_value(cfg).expect("cells default to empty");
        assert!(v.cells.is_empty());
    }

    #[test]
    fn id_is_sorting() {
        assert_eq!(SortingViz::new().id(), "sorting");
    }

    #[test]
    fn projection_maps_pixels_to_clip_with_y_down() {
        let p = pixel_projection(200, 100);
        assert_eq!(p, [0.01, 0.0, 0.0, 0.0, -0.02, 0.0, -1.0, 1.0, 1.0]);
        // Column-major: clip = p * (x, y, 1).
        let map = |x: f32, y: f32| (p[0] * x + p[3] * y + p[6], p[1] * x + p[4] * y + p[7]);
        assert_eq!(map(0.0, 0.0), (-1.0, 1.0), "top-left");
        assert_eq!(map(200.0, 100.0), (1.0, -1.0), "bottom-right");
        assert_eq!(map(100.0, 50.0), (0.0, 0.0), "center");
    }

    #[test]
    fn projection_survives_a_zero_sized_canvas() {
        let p = pixel_projection(0, 0);
        assert!(p.iter().all(|v| v.is_finite()));
    }

    #[test]
    fn bars_fill_the_padded_cell() {
        let cfg = SortingVizConfig::default();
        let mut out = Vec::new();
        // 100×100 cell at (10, 20), 4 px padding → inner 92×92 at (14, 24).
        push_lane_bars(
            &mut out,
            [10.0, 20.0, 100.0, 100.0],
            &lane(&[1, 2, 4, 8]),
            &cfg,
        );
        assert_eq!(out.len(), 4);

        let slot = 92.0 / 4.0;
        let gap = slot * 0.15;
        // First bar starts half a gap into its slot and is one gap narrower.
        assert!((out[0].min[0] - (14.0 + gap * 0.5)).abs() < 1e-3);
        assert!((out[0].max[0] - (14.0 + gap * 0.5 + slot - gap)).abs() < 1e-3);
        // Every bar sits on the same baseline, the bottom of the inner rect.
        for q in &out {
            assert!((q.max[1] - (24.0 + 92.0)).abs() < 1e-3, "baseline");
        }
        // Height ∝ value / max: the tallest bar fills the cell exactly.
        assert!(
            (out[3].min[1] - 24.0).abs() < 1e-3,
            "max value is full height"
        );
        assert!((out[0].min[1] - (24.0 + 92.0 - 92.0 / 8.0)).abs() < 1e-3);
    }

    #[test]
    fn narrow_bars_keep_a_minimum_width() {
        let cfg = SortingVizConfig::default();
        let values: Vec<u16> = (1..=300).collect();
        let mut out = Vec::new();
        // 100 px wide for 300 bars: a third of a pixel per slot.
        push_lane_bars(&mut out, [0.0, 0.0, 100.0, 60.0], &lane(&values), &cfg);
        assert_eq!(out.len(), 300);
        for q in &out {
            // `>= 1.0` up to f32 rounding of x0 + 1.0 at cell-scale offsets.
            assert!(q.max[0] - q.min[0] >= 0.99, "bar at least 1 px wide");
        }
    }

    #[test]
    fn degenerate_lanes_and_cells_draw_nothing() {
        let cfg = SortingVizConfig::default();
        let mut out = Vec::new();
        // No values at all.
        push_lane_bars(&mut out, [0.0, 0.0, 100.0, 100.0], &lane(&[]), &cfg);
        // A cell smaller than twice the padding has no inner rect left.
        push_lane_bars(&mut out, [0.0, 0.0, 6.0, 6.0], &lane(&[1, 2]), &cfg);
        assert!(out.is_empty());
    }

    #[test]
    fn colors_follow_the_last_op() {
        let cfg = SortingVizConfig::default();
        let bar = cfg.bar_color;
        // (lane, expected color per index)
        let cases = [
            ("untouched", lane(&[3, 1, 2]), [bar, bar, bar]),
            (
                "compare",
                lane_after(&[3, 1, 2], Op::Compare(0, 2)),
                [cfg.compare_color, bar, cfg.compare_color],
            ),
            (
                "swap",
                lane_after(&[3, 1, 2], Op::Swap(0, 1)),
                [cfg.write_color, cfg.write_color, bar],
            ),
            (
                "write",
                lane_after(&[3, 1, 2], Op::Write(1, 9)),
                [bar, cfg.write_color, bar],
            ),
        ];
        for (name, l, expected) in cases {
            for (k, want) in expected.iter().enumerate() {
                assert_eq!(bar_color(&l, k, &cfg), *want, "{name}, bar {k}");
            }
        }
    }

    #[test]
    fn a_finished_lane_is_entirely_done_color() {
        let cfg = SortingVizConfig::default();
        // cursor == ops.len() → done(), even though the last op was a compare
        // whose indices would otherwise be highlighted.
        let mut l = lane(&[1, 2, 3]);
        l.ops = vec![Op::Compare(0, 1)];
        l.cursor = 1;
        assert!(l.done());
        for k in 0..3 {
            assert_eq!(bar_color(&l, k, &cfg), cfg.done_color);
        }
    }
}
