//! Visualization for the Notes & Chords lab: every note swings a dot along
//! its own bar, and together the notes draw a figure.
//!
//! The figure square (`figure`, pushed by the lab in device pixels, or
//! fitted to the canvas while unset) has a gutter on three sides: note 0's
//! bar on the left (it drives y), note 1's on top (x) and note 2's on the
//! right (depth). The plot sits inside the gutters. One note draws a time
//! plot of its swing; two draw their Lissajous figure, with dashed guides
//! from each dot to the pen; three draw a curve inside a slowly turning
//! wireframe cube (drag to orbit), rendered into the plot's own viewport. An
//! optional waveform strip (`strip`) shows each note's wave, their sum and a
//! playhead over the current block of swings.
//!
//! Everything is sampled from `displacement_at` every frame, never
//! accumulated, so resets and scrubs need no bookkeeping: the trail is the
//! last `trail_window` root swings up to the current phase. The only memory
//! between frames is the phase itself and the smear it drives: once a dot
//! crosses its bar several times a frame, the dots, pen, guides and playhead
//! fade out and each bar lights up as a solid strip instead, which is what a
//! sounding string looks like (and the strip holds its block still, see
//! `held_strip_origin`).
//!
//! The viz owns the GL state for its frame: blending on and no depth test
//! (it is all alpha-blended lines and discs, drawn in order), the viewport
//! switched to the plot for the 3D pass and back; blending is off and the
//! full viewport restored when it returns.

use serde::{Deserialize, Serialize};
use web_sys::WebGl2RenderingContext as Gl;

use crate::config::{color_property, number_property, ConfigSchema, NumberOpts};
use crate::render::{
    pixel_projection, Camera3D, InstancedPoints, InstancedPoints3D, InstancedQuads, LineBatch,
    LineBatch3D, LineVertex, LineVertex3D, PointInstance, PointInstance3D, QuadInstance,
};
use crate::rules::notes::{displacement_at, NoteState, NotesState};
use crate::traits::{InputEvent, Visualization};

/// Radians per second the cube turns by itself; 0.25 is about 25 s a turn.
const DEFAULT_AUTO_ROTATE_SPEED: f32 = 0.25;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotesVizConfig {
    pub background: [f32; 4],
    /// One colour per bar, in bar order: note 0 (left), 1 (top), 2 (right).
    /// The lab's legend and chips copy these (JS `NOTE_COLORS`).
    pub note_colors: [[f32; 4]; 3],
    /// The trail: the time plot, the 2D figure or the 3D curve.
    pub trail_color: [f32; 4],
    /// The strip's normalised sum of the notes.
    pub sum_color: [f32; 4],
    /// Dashed guides from the bar dots to the pen, and the strip's playhead.
    pub guide_color: [f32; 4],
    /// Bars, their centre ticks, the cube and the strip's centre line.
    pub axis_color: [f32; 4],
    pub dot_size_px: f32,
    pub pen_size_px: f32,
    /// Radians per second; 0 stops the cube's spin (dragging still orbits).
    pub auto_rotate_speed: f32,
    /// Trail samples per cycle of the fastest note.
    pub samples_per_cycle: u32,
    /// Cap on the trail's samples per frame, and on the segments of each of
    /// the strip's waves.
    pub max_samples: u32,
    /// `[x, y, w, h]` of the figure square in device pixels, canvas origin
    /// top-left, measured and pushed by the lab like the sorting lab's
    /// cells. All zero (no area) = unset: the viz fits a square to the canvas
    /// itself and draws no strip, which is what the home tile and the wasm
    /// tests rely on.
    #[serde(default)]
    pub figure: [f32; 4],
    /// `[x, y, w, h]` of the waveform strip, device pixels like `figure`.
    /// All zero = no strip.
    #[serde(default)]
    pub strip: [f32; 4],
}

impl Default for NotesVizConfig {
    fn default() -> Self {
        Self {
            background: [0.07, 0.07, 0.09, 1.0],
            note_colors: [
                [0.949, 0.698, 0.235, 1.0], // amber #F2B23C
                [0.941, 0.400, 0.361, 1.0], // coral #F0665C
                [0.424, 0.776, 0.557, 1.0], // mint #6CC68E
            ],
            // #F5E6CC at 85%
            trail_color: [0.961, 0.902, 0.800, 0.85],
            // #E6E9EE at 90%
            sum_color: [0.902, 0.914, 0.933, 0.9],
            // #9AA3AF at 50%
            guide_color: [0.604, 0.639, 0.686, 0.5],
            // #4A515C (green 81/255 to four places: clippy reads 0.318 as 1/π)
            axis_color: [0.290, 0.3176, 0.361, 1.0],
            dot_size_px: 8.0,
            pen_size_px: 6.0,
            auto_rotate_speed: DEFAULT_AUTO_ROTATE_SPEED,
            samples_per_cycle: 40,
            max_samples: 8192,
            figure: [0.0; 4],
            strip: [0.0; 4],
        }
    }
}

/// Schema for a device-pixel `[x, y, w, h]` the lab pushes from its layout.
fn rect_property(label: &str) -> serde_json::Value {
    serde_json::json!({
        "type": "array",
        "title": label,
        "items": { "type": "number" },
        "minItems": 4,
        "maxItems": 4,
        "default": [0.0, 0.0, 0.0, 0.0],
        "x-widget": "rect",
        "x-cosmetic": true,
    })
}

impl ConfigSchema for NotesVizConfig {
    fn schema() -> serde_json::Value {
        let d = NotesVizConfig::default();
        serde_json::json!({
            "type": "object",
            "properties": {
                "background": color_property("Background", d.background),
                "note_colors": {
                    "type": "array",
                    "title": "Note colors (3)",
                    "minItems": 3,
                    "maxItems": 3,
                    // Per-slot defaults so a schema-driven reset keeps three
                    // distinct bars; items=false forbids a fourth.
                    "prefixItems": [
                        color_property("Note 1 (left bar)",  d.note_colors[0]),
                        color_property("Note 2 (top bar)",   d.note_colors[1]),
                        color_property("Note 3 (right bar)", d.note_colors[2]),
                    ],
                    "items": false,
                },
                "trail_color": color_property("Trail", d.trail_color),
                "sum_color":   color_property("Sum line", d.sum_color),
                "guide_color": color_property("Guides and playhead", d.guide_color),
                "axis_color":  color_property("Bars and axes", d.axis_color),
                "dot_size_px": number_property(NumberOpts {
                    label: "Bar dot size (px)",
                    default: 8.0, min: 1.0, max: 30.0, step: 0.5,
                    integer: false, cosmetic: true, widget: None,
                }),
                "pen_size_px": number_property(NumberOpts {
                    label: "Pen dot size (px)",
                    default: 6.0, min: 1.0, max: 30.0, step: 0.5,
                    integer: false, cosmetic: true, widget: None,
                }),
                "auto_rotate_speed": number_property(NumberOpts {
                    label: "Cube auto-rotate speed (rad/s, 0 = stop)",
                    default: DEFAULT_AUTO_ROTATE_SPEED as f64, min: 0.0, max: 3.0, step: 0.05,
                    integer: false, cosmetic: true, widget: None,
                }),
                "samples_per_cycle": number_property(NumberOpts {
                    label: "Trail samples per cycle",
                    default: 40.0, min: 4.0, max: 400.0, step: 1.0,
                    integer: true, cosmetic: true, widget: None,
                }),
                "max_samples": number_property(NumberOpts {
                    label: "Max trail samples",
                    default: 8192.0, min: 2.0, max: 65536.0, step: 1.0,
                    integer: true, cosmetic: true, widget: None,
                }),
                "figure": rect_property("Figure square (device px)"),
                "strip":  rect_property("Waveform strip (device px)"),
            },
            "required": [
                "background", "note_colors",
                "trail_color", "sum_color", "guide_color", "axis_color",
                "dot_size_px", "pen_size_px", "auto_rotate_speed",
                "samples_per_cycle", "max_samples",
                "figure", "strip"
            ],
        })
    }

    fn defaults() -> serde_json::Value {
        serde_json::to_value(NotesVizConfig::default()).unwrap()
    }
}

// ---- Layout ----

/// Width of each bar's gutter as a fraction of the figure square's side: the
/// plot is the square inset by this on every side, and each bar lies on its
/// gutter's midline. The lab's overlay labels use the same number (JS
/// `BAR_INSET`).
pub const GUTTER_FRAC: f32 = 0.12;
/// Margin around the fallback square, as a fraction of the canvas's shorter
/// side.
pub const FALLBACK_MARGIN: f32 = 0.08;

/// An axis-aligned rectangle in device pixels, canvas origin top-left, y down.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

/// Which gutter of the figure square a bar lies in.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum BarSide {
    Left,
    Top,
    Right,
}

/// One note's bar, in device pixels. `from` = displacement −1 end, `to` = +1
/// end (left/right bars: bottom → top; top bar: left → right).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Bar {
    pub side: BarSide,
    pub from: [f32; 2],
    pub to: [f32; 2],
}

/// Where everything goes this frame, in device pixels. `bars` is in bar
/// order (note 0 left, note 1 top, note 2 right); a frame draws the first
/// `notes.len()` of them.
#[derive(Debug, Clone, PartialEq)]
pub struct Layout {
    pub figure: Rect,
    pub plot: Rect,
    pub bars: [Bar; 3],
    pub strip: Option<Rect>,
}

impl Rect {
    /// A config `[x, y, w, h]`, or `None` when it has no area: all zero is how
    /// the config spells "unset".
    fn from_config(r: [f32; 4]) -> Option<Rect> {
        let rect = Rect {
            x: r[0],
            y: r[1],
            w: r[2],
            h: r[3],
        };
        (rect.w > 0.0 && rect.h > 0.0).then_some(rect)
    }

    fn center(&self) -> [f32; 2] {
        [self.x + self.w * 0.5, self.y + self.h * 0.5]
    }
}

/// Lays out one frame from the config's device-pixel rects.
///
/// A `figure` with no area (all zero: the lab has not measured one yet, or
/// never will, like the home tile) is replaced by a square centred on the
/// canvas with `FALLBACK_MARGIN` of the shorter side around it, and then
/// there is no strip either. A `strip` with no area means no strip. The plot
/// is the figure inset by `GUTTER_FRAC` of its side all round; each bar lies
/// on its gutter's midline and spans the plot. The lab always sends a square;
/// a non-square figure keeps the gutter of its shorter side.
pub fn layout(canvas_px: [u32; 2], figure: [f32; 4], strip: [f32; 4]) -> Layout {
    let (figure, strip) = match Rect::from_config(figure) {
        Some(figure) => (figure, Rect::from_config(strip)),
        None => (fallback_square(canvas_px), None),
    };
    let gutter = GUTTER_FRAC * figure.w.min(figure.h);
    let plot = Rect {
        x: figure.x + gutter,
        y: figure.y + gutter,
        w: figure.w - 2.0 * gutter,
        h: figure.h - 2.0 * gutter,
    };
    let midline = gutter * 0.5;
    let left_x = figure.x + midline;
    let right_x = figure.x + figure.w - midline;
    let top_y = figure.y + midline;
    let (plot_top, plot_bottom) = (plot.y, plot.y + plot.h);
    let bars = [
        Bar {
            side: BarSide::Left,
            from: [left_x, plot_bottom],
            to: [left_x, plot_top],
        },
        Bar {
            side: BarSide::Top,
            from: [plot.x, top_y],
            to: [plot.x + plot.w, top_y],
        },
        Bar {
            side: BarSide::Right,
            from: [right_x, plot_bottom],
            to: [right_x, plot_top],
        },
    ];
    Layout {
        figure,
        plot,
        bars,
        strip,
    }
}

/// The figure square when the lab has not measured one: centred, with
/// `FALLBACK_MARGIN` of the canvas's shorter side on each side.
fn fallback_square(canvas_px: [u32; 2]) -> Rect {
    let (w, h) = (canvas_px[0] as f32, canvas_px[1] as f32);
    let side = w.min(h) * (1.0 - 2.0 * FALLBACK_MARGIN);
    Rect {
        x: (w - side) * 0.5,
        y: (h - side) * 0.5,
        w: side,
        h: side,
    }
}

/// Where a dot at `displacement` (−1 … 1) sits on `bar`.
pub fn bar_point(bar: &Bar, displacement: f32) -> [f32; 2] {
    let t = (displacement + 1.0) * 0.5;
    [
        bar.from[0] + (bar.to[0] - bar.from[0]) * t,
        bar.from[1] + (bar.to[1] - bar.from[1]) * t,
    ]
}

/// The 2D pen inside `plot` for note 1 at `x_disp` (+1 = right) and note 0 at
/// `y_disp` (+1 = up), in y-down device pixels. It shares its y with note 0's
/// dot on the left bar and its x with note 1's on the top bar, so the guides
/// from the dots to the pen are axis-aligned.
pub fn pen_point_2d(plot: &Rect, x_disp: f32, y_disp: f32) -> [f32; 2] {
    let [cx, cy] = plot.center();
    [cx + x_disp * plot.w * 0.5, cy - y_disp * plot.h * 0.5]
}

/// `plot` as a GL viewport `[x, y, w, h]` in whole pixels, y measured up from
/// the bottom of a canvas `canvas_h` pixels high.
pub fn gl_viewport_rect(canvas_h: u32, plot: &Rect) -> [i32; 4] {
    let y_up = canvas_h as f32 - (plot.y + plot.h);
    [
        plot.x.round() as i32,
        y_up.round() as i32,
        plot.w.round() as i32,
        plot.h.round() as i32,
    ]
}

// ---- Sampling ----

/// The trail never reaches back more than this many root swings.
pub const TRAIL_WINDOW_MAX: u32 = 64;

/// Root swings the trail reaches back: one whole figure (the period), capped
/// at `TRAIL_WINDOW_MAX` so a tangled chord, which can take hundreds of root
/// swings to close (C, C# and F#: 480), still draws a bounded trail.
pub fn trail_window(period: u32) -> f64 {
    f64::from(period.min(TRAIL_WINDOW_MAX))
}

/// Root swings across the strip and the one-note time plot: the period, but
/// at least two (a lone note shows two waves) and at most eight (so the waves
/// stay readable).
pub fn strip_window(period: u32) -> f64 {
    f64::from(period.clamp(2, 8))
}

/// Start of the strip's current block. The strip shows `[origin, origin +
/// window)` with a playhead sweeping across it, instead of scrolling.
pub fn strip_origin(phase: f64, window: f64) -> f64 {
    (phase / window).floor() * window
}

/// Segments for each of the strip's waves over a `window`-swing block:
/// `samples_per_cycle` per swing of the fastest note (`max_ratio` swings per
/// root swing), clamped to `[1, max_segments]` so a far-apart pair (a ratio
/// in the hundreds, which the schema allows) cannot upload millions of
/// vertices a frame. One segment is the floor even when `max_segments` is 0.
pub fn strip_segment_count(
    window: f64,
    max_ratio: f64,
    samples_per_cycle: f64,
    max_segments: u32,
) -> usize {
    let wanted = (window * max_ratio * samples_per_cycle).ceil();
    // `as` saturates and maps NaN to 0, so the clamp always sees a number.
    (wanted as usize).clamp(1, (max_segments as usize).max(1))
}

/// The strip's block for this frame, kept in `hold` as `(origin, window)`
/// while the swings smear. At audio rates the phase crosses whole blocks
/// every frame, and a wave that does not repeat within one block (a period
/// over eight swings, or piano tuning) would re-phase every frame; so from
/// `SMEAR_HI` up the held block is reused as long as its window still
/// matches, and is pinned afresh from the phase when there is none or the
/// window changed. Below the threshold the block follows the phase
/// (`strip_origin`) and the hold is let go.
pub fn held_strip_origin(
    hold: &mut Option<(f64, f64)>,
    smear: f32,
    phase: f64,
    window: f64,
) -> f64 {
    if smear < SMEAR_HI {
        *hold = None;
        return strip_origin(phase, window);
    }
    match *hold {
        Some((origin, held_window)) if held_window == window => origin,
        _ => {
            let origin = strip_origin(phase, window);
            *hold = Some((origin, window));
            origin
        }
    }
}

/// Where the playhead sits on the strip's block at `origin`, as a time in
/// that block: the phase itself while it is in the block, and once the
/// phase has run on past a held block, its place in its own block, so the
/// playhead stays on the strip while it fades out.
pub fn strip_playhead(phase: f64, origin: f64, window: f64) -> f64 {
    origin + (phase - origin).rem_euclid(window)
}

/// Samples for a trail spanning `span` root swings: `samples_per_cycle` per
/// swing of the fastest note (`max_ratio` swings per root swing), clamped to
/// `[2, max_samples]`. Two, one segment, is the floor even when `max_samples`
/// is lower.
pub fn trail_sample_count(
    span: f64,
    max_ratio: f64,
    samples_per_cycle: u32,
    max_samples: u32,
) -> usize {
    let wanted = (span * max_ratio * f64::from(samples_per_cycle)).ceil();
    // `as` saturates and maps NaN to 0, so the clamp always sees a number.
    (wanted as usize).clamp(2, (max_samples as usize).max(2))
}

/// Fills `out` with `count` evenly spaced times on `[max(0, phase − window),
/// phase]`, the last exactly `phase`: the trail grows from the start of
/// playback until it spans `window` swings, then slides along.
pub fn trail_times(phase: f64, window: f64, count: usize, out: &mut Vec<f64>) {
    out.clear();
    if count == 0 {
        return;
    }
    let start = (phase - window).max(0.0);
    let step = if count > 1 {
        (phase - start) / (count - 1) as f64
    } else {
        0.0
    };
    out.extend((0..count - 1).map(|i| start + step * i as f64));
    out.push(phase);
}

/// Times for a trail that ends at the current phase and reaches back
/// `window` root swings (or to 0), sampled densely enough for the fastest
/// note.
fn sample_trail(state: &NotesState, cfg: &NotesVizConfig, window: f64, out: &mut Vec<f64>) {
    let span = state.phase - (state.phase - window).max(0.0);
    let count = trail_sample_count(
        span,
        max_ratio(&state.notes),
        cfg.samples_per_cycle,
        cfg.max_samples,
    );
    trail_times(state.phase, window, count, out);
}

/// Swings of the fastest note per root swing: at least the root's own 1.
fn max_ratio(notes: &[NoteState]) -> f64 {
    notes.iter().map(|note| note.ratio).fold(1.0, f64::max)
}

// ---- Smear, dashes, glow, cube ----

/// Phase advance per frame, in root swings, where the dots start to blur…
pub const SMEAR_LO: f32 = 0.1;
/// …and where they are gone and the bars glow solid.
pub const SMEAR_HI: f32 = 0.5;
/// When the swings slow or stop, the smear falls by this factor a frame
/// rather than at once, so a single frame where the phase stands still (the
/// engine zeroes dt after every viz-config push) cannot flash the dots back.
const SMEAR_DECAY: f32 = 0.85;
/// A fading smear below this snaps to 0, which ends the tail: from fully lit
/// that is 19 frames (0.85^19 ≈ 0.046), about a third of a second at 60 fps.
const SMEAR_FLOOR: f32 = 0.05;
/// Half the cube's side, in world units. From `CAMERA_DISTANCE` with the
/// camera's 45° field of view every corner stays on screen at any angle;
/// 0.55 already pokes out at steep elevations.
pub const CUBE_HALF: f32 = 0.5;
/// The orbit camera's distance from the cube's centre.
const CAMERA_DISTANCE: f32 = 2.5;

/// Hermite step like GLSL's: 0 at or below `e0`, 1 at or above `e1`, eased
/// (`3t² − 2t³`) between. Expects `e0 < e1`.
pub fn smoothstep(e0: f32, e1: f32, x: f32) -> f32 {
    let t = ((x - e0) / (e1 - e0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// How smeared the swings look when the phase moved `delta_cycles` root
/// swings since the last frame: 0 (crisp dots) at ordinary speeds, 1 (dots
/// gone, bars lit) once a dot crosses its bar several times a frame. A
/// backward jump (a reset, a scrub) is 0, so it never flashes the glow.
pub fn smear_amount(delta_cycles: f32) -> f32 {
    if delta_cycles > 0.0 {
        smoothstep(SMEAR_LO, SMEAR_HI, delta_cycles)
    } else {
        0.0
    }
}

/// Appends a dashed line from `a` to `b` as `LINES` vertex pairs: a dash of
/// `dash_px` every `dash_px + gap_px` starting at `a`, the last one clipped
/// at `b`. Pushes nothing for a zero-length segment or a non-positive dash.
pub fn push_dashed(
    out: &mut Vec<LineVertex>,
    a: [f32; 2],
    b: [f32; 2],
    dash_px: f32,
    gap_px: f32,
    color: [f32; 4],
) {
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let len = (dx * dx + dy * dy).sqrt();
    if !(len > 0.0 && dash_px > 0.0) {
        return;
    }
    let period = dash_px + gap_px.max(0.0);
    let at = |s: f32| [a[0] + dx * (s / len), a[1] + dy * (s / len)];
    // Counted up front rather than accumulated, so rounding never adds or
    // drops a dash.
    let count = (len / period).ceil() as usize;
    for k in 0..count {
        let start = k as f32 * period;
        let end = (start + dash_px).min(len);
        out.extend(segment(at(start), at(end), color));
    }
}

/// The lit strip over `bar` while the swings smear: the bar's whole length,
/// `half_thickness_px` to either side of it.
pub fn glow_quad(bar: &Bar, half_thickness_px: f32, color: [f32; 4]) -> QuadInstance {
    let h = half_thickness_px;
    let lo = [bar.from[0].min(bar.to[0]), bar.from[1].min(bar.to[1])];
    let hi = [bar.from[0].max(bar.to[0]), bar.from[1].max(bar.to[1])];
    let (min, max) = match bar.side {
        BarSide::Top => ([lo[0], lo[1] - h], [hi[0], hi[1] + h]),
        BarSide::Left | BarSide::Right => ([lo[0] - h, lo[1]], [hi[0] + h, hi[1]]),
    };
    QuadInstance { min, max, color }
}

/// The cube `[-half, half]³` as its 12 edges: 24 `LINES` endpoints.
pub fn cube_edges(half: f32) -> [[f32; 3]; 24] {
    let mut out = [[0.0; 3]; 24];
    let mut i = 0;
    for axis in 0..3 {
        // The four edges along `axis` stand at the four corners of the
        // square spanned by the other two axes.
        let (u, v) = ((axis + 1) % 3, (axis + 2) % 3);
        for (su, sv) in [(-half, -half), (half, -half), (-half, half), (half, half)] {
            let mut a = [0.0; 3];
            a[u] = su;
            a[v] = sv;
            let mut b = a;
            a[axis] = -half;
            b[axis] = half;
            out[i] = a;
            out[i + 1] = b;
            i += 2;
        }
    }
    out
}

/// `c` with its alpha scaled by `scale`.
pub fn with_alpha(c: [f32; 4], scale: f32) -> [f32; 4] {
    [c[0], c[1], c[2], c[3] * scale]
}

/// One `LINES` segment from `a` to `b`.
fn segment(a: [f32; 2], b: [f32; 2], color: [f32; 4]) -> [LineVertex; 2] {
    [
        LineVertex { position: a, color },
        LineVertex { position: b, color },
    ]
}

/// Appends the polyline through `vertices` as `LINES` pairs: every vertex
/// after the first closes a segment from the one before it.
fn push_polyline<V: Copy>(out: &mut Vec<V>, vertices: impl IntoIterator<Item = V>) {
    let mut prev = None;
    for v in vertices {
        if let Some(q) = prev {
            out.push(q);
            out.push(v);
        }
        prev = Some(v);
    }
}

// ---- The visualization ----

/// The pen: opaque white, over the warm-white trail.
const PEN_COLOR: [f32; 4] = [1.0, 1.0, 1.0, 1.0];
/// Length of the tick across each bar's centre (displacement 0).
const TICK_PX: f32 = 6.0;
/// Half the thickness of a bar lit by the smear.
const GLOW_HALF_PX: f32 = 2.0;
/// The dashed guides from the bar dots to the pen.
const DASH_PX: f32 = 4.0;
const GAP_PX: f32 = 4.0;
/// Strip samples per root swing, scaled by the fastest note's ratio.
const STRIP_SAMPLES_PER_CYCLE: f64 = 96.0;
/// The per-note waves sit a little under the brighter sum.
const STRIP_WAVE_ALPHA: f32 = 0.8;
/// Drag sensitivity, as Sierpinski's turntable (and `Camera3D`'s).
const DRAG_RAD_PER_PX: f32 = 0.005;
/// Elevation stops just short of the poles, where the orbit would flip.
const ELEVATION_LIMIT: f32 = std::f32::consts::FRAC_PI_2 - 0.01;

/// What every pass of one frame shares.
struct FrameCtx {
    layout: Layout,
    /// 0 crisp dots … 1 lit bars; see `smear_amount`.
    smear: f32,
    /// Notes in play, one per bar.
    n_notes: usize,
    /// Device pixels, y down, to clip space: every 2D pass draws with it.
    proj: [f32; 9],
    /// The drawing buffer's size in device pixels.
    canvas: [u32; 2],
}

/// The Notes & Chords visualization. Between frames it keeps only the orbit
/// camera's angles, the smear tracker and the strip's held block (plus GL
/// resources and scratch); everything it draws is rebuilt from the state
/// each frame.
pub struct NotesViz {
    camera: Camera3D,
    /// Accumulated by `tick`: the cube's slow spin.
    auto_azimuth: f32,
    /// Added by drags, on top of the spin.
    azimuth_offset: f32,
    /// Set by drags, clamped short of the poles.
    elevation: f32,
    /// `auto_rotate_speed` from the last `init`, so `tick`, which never sees
    /// the config, can spin the cube.
    cached_auto_speed: f32,
    /// The phase at the last frame, for the smear; `None` before the first.
    last_phase: Option<f64>,
    /// This frame's smear, 0 crisp dots … 1 lit bars: quick to rise, a few
    /// frames to fall (see `update_smear`).
    smear: f32,
    /// The strip's block `(origin, window)` while the swings smear, so the
    /// waves hold still at audio rates (see `held_strip_origin`); `None`
    /// otherwise. A backward jump lets it go.
    strip_hold: Option<(f64, f64)>,
    lines: Option<LineBatch>,
    points: Option<InstancedPoints>,
    quads: Option<InstancedQuads>,
    lines_3d: Option<LineBatch3D>,
    points_3d: Option<InstancedPoints3D>,
    /// Per-frame scratch, cleared and refilled every pass so a full trail
    /// (thousands of samples) doesn't churn the heap each frame.
    line_scratch: Vec<LineVertex>,
    line_3d_scratch: Vec<LineVertex3D>,
    point_scratch: Vec<PointInstance>,
    quad_scratch: Vec<QuadInstance>,
    time_scratch: Vec<f64>,
}

impl NotesViz {
    pub fn new() -> Self {
        let mut camera = Camera3D::new();
        camera.distance = CAMERA_DISTANCE;
        Self {
            camera,
            // A three-quarter view from slightly above, so the first frame
            // with three notes already reads as a cube.
            auto_azimuth: std::f32::consts::FRAC_PI_6,
            azimuth_offset: 0.0,
            elevation: 0.35,
            cached_auto_speed: DEFAULT_AUTO_ROTATE_SPEED,
            last_phase: None,
            smear: 0.0,
            strip_hold: None,
            lines: None,
            points: None,
            quads: None,
            lines_3d: None,
            points_3d: None,
            line_scratch: Vec::new(),
            line_3d_scratch: Vec::new(),
            point_scratch: Vec::new(),
            quad_scratch: Vec::new(),
            time_scratch: Vec::new(),
        }
    }

    /// The 2D batches every frame draws with. The cube's are made by
    /// `ensure_3d_resources` once three notes render.
    fn ensure_resources(&mut self, gl: &Gl) -> Result<(), String> {
        if self.lines.is_none() {
            self.lines = Some(LineBatch::new(gl)?);
        }
        if self.points.is_none() {
            self.points = Some(InstancedPoints::new(gl)?);
        }
        if self.quads.is_none() {
            self.quads = Some(InstancedQuads::new(gl)?);
        }
        Ok(())
    }

    /// The cube's line batch and pen, made the first time three notes
    /// render rather than up front: most notes engines (the home tile's
    /// two-note one among them) never draw the cube.
    fn ensure_3d_resources(&mut self, gl: &Gl) -> Result<(), String> {
        if self.lines_3d.is_none() {
            self.lines_3d = Some(LineBatch3D::new(gl)?);
        }
        if self.points_3d.is_none() {
            self.points_3d = Some(InstancedPoints3D::new(gl)?);
        }
        Ok(())
    }

    /// Tracks the phase from frame to frame and returns this frame's smear.
    /// It rises to `smear_amount` of the phase step at once but falls by
    /// `SMEAR_DECAY` a frame (to 0 below `SMEAR_FLOOR`), so a frame where the
    /// phase stands still keeps the glow while a real slowdown or a pause
    /// fades it out within about a third of a second. A backward jump (a
    /// reset or a scrub) still drops it to 0 at once and lets go of the
    /// strip's held block; the first frame starts at 0. Either way the
    /// tracker restarts from `phase`.
    fn update_smear(&mut self, phase: f64) -> f32 {
        let delta = self.last_phase.map_or(0.0, |last| phase - last);
        self.last_phase = Some(phase);
        self.smear = if delta < 0.0 {
            self.strip_hold = None;
            0.0
        } else {
            let tail = self.smear * SMEAR_DECAY;
            let tail = if tail < SMEAR_FLOOR { 0.0 } else { tail };
            smear_amount(delta as f32).max(tail)
        };
        self.smear
    }

    /// One or two notes, in pixel space: the trail (a time plot of note 0
    /// for one note, newest at the plot's right edge; the Lissajous figure
    /// for two), the dashed guides from each bar's dot to the pen, and the
    /// pen.
    fn draw_figure_2d(
        &mut self,
        gl: &Gl,
        state: &NotesState,
        cfg: &NotesVizConfig,
        frame: &FrameCtx,
    ) {
        let notes = &state.notes[..frame.n_notes];
        let Some(root) = notes.first() else {
            return;
        };
        let second = notes.get(1);
        let (plot, phase, just) = (frame.layout.plot, state.phase, state.just_intonation);
        let window = match second {
            Some(_) => trail_window(state.period),
            None => strip_window(state.period),
        };
        let pen_at = |t: f64| {
            let x = match second {
                Some(note) => displacement_at(note, just, t),
                // Time runs left to right: `window` swings across the plot.
                None => 1.0 - 2.0 * ((phase - t) / window) as f32,
            };
            pen_point_2d(&plot, x, displacement_at(root, just, t))
        };

        sample_trail(state, cfg, window, &mut self.time_scratch);
        self.line_scratch.clear();
        push_polyline(
            &mut self.line_scratch,
            self.time_scratch.iter().map(|&t| LineVertex {
                position: pen_at(t),
                color: cfg.trail_color,
            }),
        );
        let pen = pen_at(phase);
        let guide = with_alpha(cfg.guide_color, 1.0 - frame.smear);
        for (bar, note) in frame.layout.bars.iter().zip(notes) {
            let dot = bar_point(bar, note.displacement);
            push_dashed(&mut self.line_scratch, dot, pen, DASH_PX, GAP_PX, guide);
        }
        self.flush_lines(gl, &frame.proj);

        self.point_scratch.clear();
        self.point_scratch.push(PointInstance {
            position: pen,
            color: with_alpha(PEN_COLOR, 1.0 - frame.smear),
            radius_px: cfg.pen_size_px * 0.5,
        });
        self.flush_points(gl, frame);
    }

    /// Three notes: the curve inside the wireframe cube, drawn through the
    /// orbit camera into the plot's own viewport. Puts the full-canvas
    /// viewport back before returning, and never clears. The first such
    /// frame makes the cube's GL resources; a failure skips the figure and
    /// is retried by the next frame.
    fn draw_figure_3d(
        &mut self,
        gl: &Gl,
        state: &NotesState,
        cfg: &NotesVizConfig,
        frame: &FrameCtx,
    ) {
        if self.ensure_3d_resources(gl).is_err() {
            return;
        }
        let [n0, n1, n2] = [&state.notes[0], &state.notes[1], &state.notes[2]];
        let just = state.just_intonation;
        // x = note 1 (top bar), y = note 0 (left bar), z = note 2 (right
        // bar): seen from the front this is the two-note figure.
        let point_at = |t: f64| {
            [
                displacement_at(n1, just, t) * CUBE_HALF,
                displacement_at(n0, just, t) * CUBE_HALF,
                displacement_at(n2, just, t) * CUBE_HALF,
            ]
        };

        let [x, y, w, h] = gl_viewport_rect(frame.canvas[1], &frame.layout.plot);
        let plot_px = [w.max(0) as u32, h.max(0) as u32];
        gl.viewport(x, y, w, h);
        self.camera.resize(plot_px[0], plot_px[1]);
        self.camera.azimuth = self.auto_azimuth + self.azimuth_offset;
        self.camera.elevation = self.elevation;
        let view_proj = self.camera.view_projection();

        sample_trail(
            state,
            cfg,
            trail_window(state.period),
            &mut self.time_scratch,
        );
        self.line_3d_scratch.clear();
        self.line_3d_scratch
            .extend(cube_edges(CUBE_HALF).map(|position| LineVertex3D {
                position,
                color: cfg.axis_color,
            }));
        push_polyline(
            &mut self.line_3d_scratch,
            self.time_scratch.iter().map(|&t| LineVertex3D {
                position: point_at(t),
                color: cfg.trail_color,
            }),
        );
        let lines_3d = self.lines_3d.as_mut().expect("ensure_3d_resources ran");
        lines_3d.upload(gl, &self.line_3d_scratch);
        lines_3d.draw(gl, &view_proj);

        let pen = PointInstance3D {
            position: point_at(state.phase),
            color: with_alpha(PEN_COLOR, 1.0 - frame.smear),
            radius_px: cfg.pen_size_px * 0.5,
        };
        let points_3d = self.points_3d.as_mut().expect("ensure_3d_resources ran");
        points_3d.upload(gl, &[pen]);
        points_3d.draw(gl, &view_proj, plot_px);

        gl.viewport(0, 0, frame.canvas[0] as i32, frame.canvas[1] as i32);
    }

    /// The bars of the notes in play: each one's line and centre tick, its
    /// glow while the swings smear, and its dot.
    fn draw_bars(&mut self, gl: &Gl, state: &NotesState, cfg: &NotesVizConfig, frame: &FrameCtx) {
        let bars = &frame.layout.bars[..frame.n_notes];
        let axis = cfg.axis_color;
        let half_tick = TICK_PX * 0.5;
        self.line_scratch.clear();
        for bar in bars {
            let [cx, cy] = bar_point(bar, 0.0);
            let (dx, dy) = match bar.side {
                BarSide::Top => (0.0, half_tick),
                BarSide::Left | BarSide::Right => (half_tick, 0.0),
            };
            let tick = segment([cx - dx, cy - dy], [cx + dx, cy + dy], axis);
            self.line_scratch.extend(segment(bar.from, bar.to, axis));
            self.line_scratch.extend(tick);
        }
        self.flush_lines(gl, &frame.proj);

        // Uploaded every frame, empty without smear, so a glow never lingers.
        self.quad_scratch.clear();
        if frame.smear > 0.0 {
            self.quad_scratch.extend(
                bars.iter().zip(cfg.note_colors).map(|(bar, color)| {
                    glow_quad(bar, GLOW_HALF_PX, with_alpha(color, frame.smear))
                }),
            );
        }
        let quads = self.quads.as_mut().expect("ensure_resources ran");
        quads.upload(gl, &self.quad_scratch);
        quads.draw(gl, &frame.proj);

        self.point_scratch.clear();
        self.point_scratch
            .extend(bars.iter().zip(&state.notes).zip(cfg.note_colors).map(
                |((bar, note), color)| PointInstance {
                    position: bar_point(bar, note.displacement),
                    color: with_alpha(color, 1.0 - frame.smear),
                    radius_px: cfg.dot_size_px * 0.5,
                },
            ));
        self.flush_points(gl, frame);
    }

    /// The waveform strip, when the lab gave one: a centre line, each note's
    /// wave over the current block, their sum divided by the note count, and
    /// the playhead, which fades with the smear like the guides (at audio
    /// rates it would jump across the block every frame). Under the playhead
    /// each wave shows its dot's place on its bar, in either tuning. Once the
    /// swings smear, the block holds still (`held_strip_origin`) so the waves
    /// stop re-phasing every frame, and the fading playhead keeps to the
    /// strip (`strip_playhead`).
    fn draw_strip(&mut self, gl: &Gl, state: &NotesState, cfg: &NotesVizConfig, frame: &FrameCtx) {
        let Some(strip) = frame.layout.strip else {
            return;
        };
        let notes = &state.notes[..frame.n_notes];
        let just = state.just_intonation;
        let window = strip_window(state.period);
        let t0 = held_strip_origin(&mut self.strip_hold, frame.smear, state.phase, window);
        let segments = strip_segment_count(
            window,
            max_ratio(notes),
            STRIP_SAMPLES_PER_CYCLE,
            cfg.max_samples,
        );
        let times = move || (0..=segments).map(move |k| t0 + window * k as f64 / segments as f64);
        let [_, cy] = strip.center();
        let x_at = |t: f64| strip.x + strip.w * ((t - t0) / window) as f32;
        let vertex = |t: f64, displacement: f32, color: [f32; 4]| LineVertex {
            position: [x_at(t), cy - displacement * strip.h * 0.5],
            color,
        };

        let out = &mut self.line_scratch;
        out.clear();
        out.extend(segment(
            [strip.x, cy],
            [strip.x + strip.w, cy],
            cfg.axis_color,
        ));
        for (note, color) in notes.iter().zip(cfg.note_colors) {
            let color = with_alpha(color, STRIP_WAVE_ALPHA);
            push_polyline(
                out,
                times().map(|t| vertex(t, displacement_at(note, just, t), color)),
            );
        }
        if notes.len() > 1 {
            let n = notes.len() as f32;
            push_polyline(
                out,
                times().map(|t| {
                    let sum: f32 = notes
                        .iter()
                        .map(|note| displacement_at(note, just, t))
                        .sum();
                    vertex(t, sum / n, cfg.sum_color)
                }),
            );
        }
        let head = x_at(strip_playhead(state.phase, t0, window));
        let playhead = with_alpha(cfg.guide_color, 1.0 - frame.smear);
        out.extend(segment(
            [head, strip.y],
            [head, strip.y + strip.h],
            playhead,
        ));
        self.flush_lines(gl, &frame.proj);
    }

    /// Uploads the 2D line scratch and draws it across the whole canvas.
    fn flush_lines(&mut self, gl: &Gl, proj: &[f32; 9]) {
        let lines = self.lines.as_mut().expect("ensure_resources ran");
        lines.upload(gl, &self.line_scratch);
        lines.draw(gl, proj);
    }

    /// Uploads the 2D point scratch and draws it across the whole canvas.
    fn flush_points(&mut self, gl: &Gl, frame: &FrameCtx) {
        let points = self.points.as_mut().expect("ensure_resources ran");
        points.upload(gl, &self.point_scratch);
        points.draw(gl, &frame.proj, frame.canvas);
    }
}

impl Default for NotesViz {
    fn default() -> Self {
        Self::new()
    }
}

impl Visualization for NotesViz {
    type Config = NotesVizConfig;
    type State = NotesState;

    fn id(&self) -> &'static str {
        "notes"
    }

    /// Runs at construction and again on every `update_viz_config`, which
    /// the lab sends whenever its layout changes. So it only refreshes the
    /// spin speed `tick` uses and makes sure the 2D GL resources exist (the
    /// cube's wait for its first frame); the camera, the smear tracker and
    /// the strip's hold carry over.
    fn init(&mut self, gl: &Gl, cfg: &Self::Config) {
        self.cached_auto_speed = cfg.auto_rotate_speed;
        // A failure is retried by the next render, like the other vizzes.
        let _ = self.ensure_resources(gl);
    }

    fn render(&mut self, gl: &Gl, state: &Self::State, cfg: &Self::Config) {
        if self.ensure_resources(gl).is_err() {
            return;
        }
        // The drawing buffer's size is read every frame rather than kept
        // from `resize`, which the wasm tests never call.
        let canvas = [
            gl.drawing_buffer_width().max(0) as u32,
            gl.drawing_buffer_height().max(0) as u32,
        ];
        let layout = layout(canvas, cfg.figure, cfg.strip);
        let frame = FrameCtx {
            n_notes: state.notes.len().min(layout.bars.len()),
            layout,
            smear: self.update_smear(state.phase),
            proj: pixel_projection(canvas[0], canvas[1]),
            canvas,
        };
        let (w, h) = (canvas[0] as i32, canvas[1] as i32);

        // This viz owns the GL state for its frame. Everything is
        // alpha-blended and drawn in order, the cube included: no depth test.
        gl.viewport(0, 0, w, h);
        gl.disable(Gl::DEPTH_TEST);
        gl.enable(Gl::BLEND);
        gl.blend_func(Gl::SRC_ALPHA, Gl::ONE_MINUS_SRC_ALPHA);
        let [r, g, b, a] = cfg.background;
        gl.clear_color(r, g, b, a);
        gl.clear(Gl::COLOR_BUFFER_BIT);

        // Nothing picked leaves the cleared stage (the page shows a prompt).
        if frame.n_notes > 0 {
            if frame.n_notes == 3 {
                self.draw_figure_3d(gl, state, cfg, &frame);
            } else {
                self.draw_figure_2d(gl, state, cfg, &frame);
            }
            self.draw_bars(gl, state, cfg, &frame);
            self.draw_strip(gl, state, cfg, &frame);
        }

        // Leave a clean slate for whatever draws next.
        gl.disable(Gl::BLEND);
        gl.viewport(0, 0, w, h);
    }

    /// Only the GL viewport: `render` reads the canvas size itself, and the
    /// camera is sized to the plot, not the canvas.
    fn resize(&mut self, gl: &Gl, w: u32, h: u32) {
        gl.viewport(0, 0, w as i32, h as i32);
    }

    fn tick(&mut self, dt: f32) {
        // The spin always runs; a drag adds its offset on top.
        self.auto_azimuth += self.cached_auto_speed * dt;
    }

    /// Dragging with the primary button orbits the cube, as in the
    /// Sierpinski lab.
    fn handle_input(&mut self, ev: &InputEvent) {
        match ev {
            InputEvent::PointerMove {
                dx, dy, buttons, ..
            } if *buttons & 1 != 0 => {
                self.azimuth_offset += *dx * DRAG_RAD_PER_PX;
                self.elevation = (self.elevation + *dy * DRAG_RAD_PER_PX)
                    .clamp(-ELEVATION_LIMIT, ELEVATION_LIMIT);
            }
            _ => {}
        }
    }

    /// Ignored: the lab hides the zoom control, and `CUBE_HALF` only clears
    /// the frustum from `CAMERA_DISTANCE`.
    fn set_zoom(&mut self, _zoom: f32) {}
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::notes::{Notes, NotesConfig};
    use crate::traits::Rule;

    // ---- config ----

    #[test]
    fn viz_defaults_round_trip() {
        let v: NotesVizConfig = serde_json::from_value(NotesVizConfig::defaults()).unwrap();
        assert_eq!(v.dot_size_px, 8.0);
        assert_eq!(v.pen_size_px, 6.0);
        assert_eq!(v.auto_rotate_speed, 0.25);
        assert_eq!(v.samples_per_cycle, 40);
        assert_eq!(v.max_samples, 8192);
        assert_eq!(v.figure, [0.0; 4], "no figure: the viz fits the canvas");
        assert_eq!(v.strip, [0.0; 4], "no strip until the lab measures one");
        assert_eq!(
            serde_json::to_value(&v).unwrap(),
            NotesVizConfig::defaults()
        );
    }

    #[test]
    fn viz_schema_lists_all_required_fields() {
        let schema = NotesVizConfig::schema();
        let mut required: Vec<&str> = schema["required"]
            .as_array()
            .expect("required array")
            .iter()
            .map(|key| key.as_str().unwrap())
            .collect();
        for key in &required {
            assert!(
                schema["properties"].get(key).is_some(),
                "no property for {key}"
            );
        }
        // Every config field is required, and nothing else is.
        let defaults = NotesVizConfig::defaults();
        let mut fields: Vec<&str> = defaults
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        required.sort_unstable();
        fields.sort_unstable();
        assert_eq!(required.len(), 13);
        assert_eq!(required, fields);

        let props = &schema["properties"];
        assert_eq!(props["figure"]["x-widget"], "rect");
        assert_eq!(props["strip"]["x-widget"], "rect");
        assert_eq!(props["figure"]["minItems"], 4);
        assert_eq!(props["figure"]["x-cosmetic"], true);
        // One colour slot per bar, each defaulting to that bar's own colour,
        // so a schema-driven reset gives three distinct notes.
        let slots = props["note_colors"]["prefixItems"]
            .as_array()
            .expect("three colour slots");
        assert_eq!(slots.len(), 3);
        for (i, slot) in slots.iter().enumerate() {
            assert_eq!(slot["x-widget"], "color");
            assert_eq!(slot["default"], defaults["note_colors"][i], "slot {i}");
        }
        assert_ne!(slots[0]["default"], slots[1]["default"]);
        assert_ne!(slots[1]["default"], slots[2]["default"]);
    }

    #[test]
    fn figure_and_strip_are_optional_when_deserializing() {
        let mut cfg = NotesVizConfig::defaults();
        let obj = cfg.as_object_mut().unwrap();
        obj.remove("figure");
        obj.remove("strip");
        let v: NotesVizConfig = serde_json::from_value(cfg).expect("rects default to zero");
        assert_eq!(v.figure, [0.0; 4]);
        assert_eq!(v.strip, [0.0; 4]);
    }

    // ---- layout ----

    const EPS: f32 = 1e-3;

    fn assert_near(actual: f32, expected: f32, what: &str) {
        assert!(
            (actual - expected).abs() < EPS,
            "{what}: {actual} != {expected}"
        );
    }

    fn assert_point_near(actual: [f32; 2], expected: [f32; 2], what: &str) {
        assert_near(actual[0], expected[0], &format!("{what} x"));
        assert_near(actual[1], expected[1], &format!("{what} y"));
    }

    fn assert_rect_near(actual: Rect, expected: Rect, what: &str) {
        assert_near(actual.x, expected.x, &format!("{what} x"));
        assert_near(actual.y, expected.y, &format!("{what} y"));
        assert_near(actual.w, expected.w, &format!("{what} w"));
        assert_near(actual.h, expected.h, &format!("{what} h"));
    }

    /// The worked example: a 100 px figure square at (10, 20) with a strip
    /// under it. Gutters are 12 px, so the plot is (22, 32) 76 × 76.
    fn explicit() -> Layout {
        layout(
            [200, 200],
            [10.0, 20.0, 100.0, 100.0],
            [10.0, 130.0, 100.0, 20.0],
        )
    }

    #[test]
    fn fallback_layout_is_a_centered_square_with_8pct_margin() {
        // 200 × 100: 8% of the short side is 8 px a side, leaving an 84 px
        // square centred on (100, 50).
        let l = layout([200, 100], [0.0; 4], [0.0; 4]);
        let square = Rect {
            x: 58.0,
            y: 8.0,
            w: 84.0,
            h: 84.0,
        };
        assert_rect_near(l.figure, square, "figure");
        // Inset by 12% of the side (10.08 px) on every side.
        let plot = Rect {
            x: 68.08,
            y: 18.08,
            w: 63.84,
            h: 63.84,
        };
        assert_rect_near(l.plot, plot, "plot");
        assert_eq!(l.strip, None);

        // Without a figure there is no strip, even if one is set.
        let l = layout([200, 100], [0.0; 4], [10.0, 10.0, 50.0, 20.0]);
        assert_rect_near(l.figure, square, "figure, strip set");
        assert_eq!(l.strip, None);

        // A figure without area counts as unset too.
        let l = layout([200, 100], [5.0, 5.0, 0.0, 0.0], [0.0; 4]);
        assert_rect_near(l.figure, square, "figure, zero size");
    }

    #[test]
    fn explicit_figure_rect_is_used_verbatim() {
        let l = explicit();
        assert_eq!(
            l.figure,
            Rect {
                x: 10.0,
                y: 20.0,
                w: 100.0,
                h: 100.0
            }
        );
        let plot = Rect {
            x: 22.0,
            y: 32.0,
            w: 76.0,
            h: 76.0,
        };
        assert_rect_near(l.plot, plot, "plot");

        let [left, top, right] = l.bars;
        assert_eq!(
            [left.side, top.side, right.side],
            [BarSide::Left, BarSide::Top, BarSide::Right]
        );
        // On the gutter midlines (6 px in from the square's edge), spanning
        // the plot; `from` is the −1 end.
        assert_point_near(left.from, [16.0, 108.0], "left from");
        assert_point_near(left.to, [16.0, 32.0], "left to");
        assert_point_near(top.from, [22.0, 26.0], "top from");
        assert_point_near(top.to, [98.0, 26.0], "top to");
        assert_point_near(right.from, [104.0, 108.0], "right from");
        assert_point_near(right.to, [104.0, 32.0], "right to");

        assert_eq!(
            l.strip,
            Some(Rect {
                x: 10.0,
                y: 130.0,
                w: 100.0,
                h: 20.0
            })
        );
    }

    #[test]
    fn bar_point_maps_displacement_to_bar_ends() {
        let [left, top, right] = explicit().bars;
        assert_point_near(bar_point(&left, 1.0), [16.0, 32.0], "left +1, plot top");
        assert_point_near(
            bar_point(&left, -1.0),
            [16.0, 108.0],
            "left -1, plot bottom",
        );
        assert_point_near(bar_point(&left, 0.0), [16.0, 70.0], "left 0, centre");
        assert_point_near(bar_point(&right, 0.5), [104.0, 51.0], "right +0.5");
        assert_point_near(bar_point(&top, 1.0), [98.0, 26.0], "top +1, plot right");
        assert_point_near(bar_point(&top, -1.0), [22.0, 26.0], "top -1, plot left");
        assert_point_near(bar_point(&top, 0.5), [79.0, 26.0], "top +0.5");
    }

    #[test]
    fn pen_point_2d_is_centre_at_zero_and_y_down() {
        let l = explicit();
        let plot = l.plot;
        assert_point_near(pen_point_2d(&plot, 0.0, 0.0), [60.0, 70.0], "centre");
        // +x is right, +y is up, i.e. a smaller pixel y.
        assert_point_near(pen_point_2d(&plot, 1.0, 1.0), [98.0, 32.0], "top right");
        assert_point_near(
            pen_point_2d(&plot, -1.0, -1.0),
            [22.0, 108.0],
            "bottom left",
        );
        assert_point_near(pen_point_2d(&plot, 0.5, -0.5), [79.0, 89.0], "halfway");

        // So the dashed guides are axis-aligned: the pen shares its y with
        // note 0's dot on the left bar and its x with note 1's on the top.
        let [left, top, _] = l.bars;
        for d in [-1.0, -0.3, 0.0, 0.6, 1.0] {
            assert_near(pen_point_2d(&plot, 0.25, d)[1], bar_point(&left, d)[1], "y");
            assert_near(pen_point_2d(&plot, d, 0.25)[0], bar_point(&top, d)[0], "x");
        }
    }

    #[test]
    fn gl_viewport_rect_flips_y() {
        let plot = Rect {
            x: 10.0,
            y: 20.0,
            w: 30.0,
            h: 30.0,
        };
        // GL's origin is the bottom-left: the plot's bottom edge (y = 50) is
        // 50 px up from the bottom of a 100 px canvas.
        assert_eq!(gl_viewport_rect(100, &plot), [10, 50, 30, 30]);
        // Fractional rects round to whole pixels: bottom edge 50.4 → 49.6 up.
        let plot = Rect {
            x: 10.4,
            y: 20.2,
            w: 29.7,
            h: 30.2,
        };
        assert_eq!(gl_viewport_rect(100, &plot), [10, 50, 30, 30]);
    }

    #[test]
    fn zero_sized_canvas_does_not_panic() {
        let l = layout([0, 0], [0.0; 4], [0.0; 4]);
        assert_eq!(l.figure.w, 0.0);
        assert_eq!(l.plot.w, 0.0);
        assert_eq!(l.strip, None);
        for bar in l.bars {
            assert!(bar.from.iter().chain(&bar.to).all(|v| v.is_finite()));
        }
        assert_eq!(gl_viewport_rect(0, &l.plot), [0, 0, 0, 0]);
    }

    // ---- sampling ----

    /// The rule's real state for `notes` (just intonation) after `n` swings.
    fn notes_state(notes: &[u8], n: u32) -> NotesState {
        let cfg = NotesConfig {
            notes: notes.to_vec(),
            ..NotesConfig::default()
        };
        let mut state = Notes.init(&cfg, 0);
        Notes.advance_to(&mut state, &cfg, 0, n);
        state
    }

    #[test]
    fn trail_window_caps_at_64() {
        assert_eq!(trail_window(1), 1.0);
        assert_eq!(trail_window(32), 32.0);
        assert_eq!(trail_window(64), 64.0);
        assert_eq!(trail_window(480), 64.0);
    }

    #[test]
    fn strip_window_clamps_2_to_8() {
        assert_eq!(strip_window(1), 2.0);
        assert_eq!(strip_window(4), 4.0);
        assert_eq!(strip_window(32), 8.0);
    }

    #[test]
    fn strip_origin_is_the_current_block() {
        assert_eq!(strip_origin(9.3, 4.0), 8.0);
        assert_eq!(strip_origin(0.5, 4.0), 0.0);
        assert_eq!(strip_origin(8.0, 4.0), 8.0, "a block starts on its edge");
        assert_eq!(strip_origin(1_000_001.5, 2.0), 1_000_000.0);
    }

    #[test]
    fn strip_segment_count_scales_and_caps() {
        assert_eq!(strip_segment_count(2.0, 1.0, 96.0, 8192), 192);
        // A ratio near 1536 (the pick [0, 127], which the rule's schema
        // allows) would want about 295k segments a wave.
        assert_eq!(strip_segment_count(2.0, 1536.0, 96.0, 8192), 8192, "capped");
        assert_eq!(
            strip_segment_count(2.0, 1.0, 96.0, 0),
            1,
            "one segment at least"
        );
    }

    #[test]
    fn held_strip_origin_holds_the_block_while_smeared() {
        let mut hold = None;
        // At audio rates the phase crosses whole blocks every frame: the
        // first smeared frame pins its block…
        assert_eq!(held_strip_origin(&mut hold, 1.0, 9.3, 4.0), 8.0);
        assert_eq!(hold, Some((8.0, 4.0)));
        // …and later frames keep it, however far the phase runs on.
        assert_eq!(held_strip_origin(&mut hold, 1.0, 13.7, 4.0), 8.0);
        assert_eq!(held_strip_origin(&mut hold, 1.0, 1_000.1, 4.0), 8.0);
        assert_eq!(
            held_strip_origin(&mut hold, SMEAR_HI, 1_001.9, 4.0),
            8.0,
            "still held at the threshold"
        );
        assert_eq!(hold, Some((8.0, 4.0)));
    }

    #[test]
    fn held_strip_origin_releases_below_the_threshold() {
        let mut hold = Some((8.0, 4.0));
        assert_eq!(
            held_strip_origin(&mut hold, 0.0, 21.5, 4.0),
            20.0,
            "recomputed"
        );
        assert_eq!(hold, None, "released");
        // Just under the threshold the block follows the phase too.
        let mut hold = Some((8.0, 4.0));
        assert_eq!(held_strip_origin(&mut hold, 0.49, 21.5, 4.0), 20.0);
        assert_eq!(hold, None);
    }

    #[test]
    fn held_strip_origin_resets_when_the_window_changes() {
        // The held block was laid out for another window, so it no longer
        // lines up: the block is pinned afresh from the phase.
        let mut hold = Some((8.0, 4.0));
        assert_eq!(held_strip_origin(&mut hold, 1.0, 21.5, 8.0), 16.0);
        assert_eq!(hold, Some((16.0, 8.0)));
    }

    #[test]
    fn strip_playhead_stays_on_a_held_block() {
        assert_eq!(
            strip_playhead(9.5, 8.0, 4.0),
            9.5,
            "in the block: the phase"
        );
        // The phase has run on past a held block: the playhead shows its
        // place in its own block instead of leaving the strip.
        assert_eq!(strip_playhead(21.5, 8.0, 4.0), 9.5);
        assert_eq!(strip_playhead(1_000.0, 8.0, 4.0), 8.0, "a block edge");
    }

    #[test]
    fn trail_sample_count_scales_and_clamps() {
        // Two root swings of C + G: G swings 1.5 times per root swing.
        assert_eq!(trail_sample_count(2.0, 1.5, 40, 8192), 120);
        assert_eq!(trail_sample_count(0.26, 1.0, 40, 8192), 11, "rounds up");
        assert_eq!(trail_sample_count(64.0, 1e6, 400, 8192), 8192, "capped");
        assert_eq!(trail_sample_count(0.0, 1.5, 40, 8192), 2, "one segment");
        assert_eq!(trail_sample_count(1.0, 1.0, 40, 0), 2, "cap below two");
    }

    #[test]
    fn trail_times_grow_from_zero_then_slide() {
        let mut times = vec![99.0];
        // Early on the trail starts at 0 and grows…
        trail_times(0.5, 2.0, 5, &mut times);
        assert_eq!(times, vec![0.0, 0.125, 0.25, 0.375, 0.5]);
        // …then slides: always the last `window` swings, ending at the phase.
        trail_times(10.0, 2.0, 81, &mut times);
        assert_eq!(times.len(), 81);
        assert_eq!(times[0], 8.0);
        assert_eq!(times[40], 9.0);
        assert_eq!(times[80], 10.0);
        assert!(times.windows(2).all(|w| w[0] < w[1]), "strictly increasing");
        // A single sample is the pen; none is nothing.
        trail_times(3.0, 2.0, 1, &mut times);
        assert_eq!(times, vec![3.0]);
        trail_times(3.0, 2.0, 0, &mut times);
        assert!(times.is_empty());
    }

    #[test]
    fn trail_samples_resolve_the_fastest_note() {
        let cfg = NotesVizConfig::default(); // 40 samples per cycle
        let mut times = Vec::new();
        // C + G: two root swings at 1.5 G swings each.
        sample_trail(&notes_state(&[60, 67], 10), &cfg, 2.0, &mut times);
        assert_eq!(times.len(), 120);
        assert_eq!((times[0], times[119]), (8.0, 10.0));
        // G over a lower C (ratio 2/3): the root is the fastest.
        sample_trail(&notes_state(&[67, 60], 10), &cfg, 2.0, &mut times);
        assert_eq!(times.len(), 80);
        // A trail still shorter than its window gets fewer samples, not
        // sparser ones.
        sample_trail(&notes_state(&[60, 67], 1), &cfg, 2.0, &mut times);
        assert_eq!(times.len(), 60);
        assert_eq!((times[0], times[59]), (0.0, 1.0));
    }

    // ---- smear, dashes, cube, glow ----

    #[test]
    fn smoothstep_endpoints_and_midpoint() {
        assert_eq!(smoothstep(0.1, 0.5, 0.1), 0.0);
        assert_eq!(smoothstep(0.1, 0.5, 0.5), 1.0);
        assert!((smoothstep(0.1, 0.5, 0.3) - 0.5).abs() < 1e-6);
        // Clamped outside the edges, eased inside: 3t² − 2t³ at t = 1/4.
        assert_eq!(smoothstep(0.1, 0.5, -3.0), 0.0);
        assert_eq!(smoothstep(0.1, 0.5, 9.0), 1.0);
        assert!((smoothstep(0.0, 1.0, 0.25) - 0.15625).abs() < 1e-6);
    }

    #[test]
    fn smear_amount_is_zero_at_normal_speed_and_one_at_audio_rate() {
        // One swing a second, at 60 frames a second.
        assert_eq!(smear_amount(1.0 / 60.0), 0.0);
        // 440 swings a second.
        assert_eq!(smear_amount(440.0 / 60.0), 1.0);
        assert!((smear_amount(0.3) - 0.5).abs() < 1e-6);
        // A reset or a scrub jumps backwards: no smear.
        assert_eq!(smear_amount(-1.0), 0.0);
        assert_eq!(smear_amount(f32::NAN), 0.0);
    }

    #[test]
    fn push_dashed_covers_the_segment_with_short_dashes() {
        let color = [0.6, 0.6, 0.7, 0.5];
        let mut out = Vec::new();
        push_dashed(&mut out, [0.0, 0.0], [100.0, 0.0], 4.0, 4.0, color);
        // A dash starts every 8 px: 0, 8, …, 96.
        assert_eq!(out.len(), 26);
        for v in &out {
            assert!((0.0..=100.0).contains(&v.position[0]), "{:?}", v.position);
            assert_eq!(v.position[1], 0.0);
            assert_eq!(v.color, color);
        }
        for (k, dash) in out.chunks(2).enumerate() {
            let (start, end) = (dash[0].position[0], dash[1].position[0]);
            assert!((start - 8.0 * k as f32).abs() < 1e-4, "dash {k} at {start}");
            assert!(end > start && end - start <= 4.0 + 1e-4, "dash {k} length");
        }
        assert!((out[25].position[0] - 100.0).abs() < 1e-4, "ends on b");

        // Any direction, appended after what is there; an 18 px run clips
        // its third dash to the 2 px left before b.
        push_dashed(&mut out, [0.0, 0.0], [0.0, -18.0], 4.0, 4.0, color);
        let ys: Vec<f32> = out[26..].iter().map(|v| v.position[1]).collect();
        let want = [0.0, -4.0, -8.0, -12.0, -16.0, -18.0];
        assert_eq!(ys.len(), want.len());
        for (y, w) in ys.iter().zip(want) {
            assert!((y - w).abs() < 1e-4, "{ys:?}");
        }
        assert!(out[26..].iter().all(|v| v.position[0] == 0.0));
    }

    #[test]
    fn push_dashed_degenerate_segment_pushes_nothing() {
        let mut out = Vec::new();
        push_dashed(&mut out, [5.0, 5.0], [5.0, 5.0], 4.0, 4.0, [1.0; 4]);
        assert!(out.is_empty());
        // Zero-length dashes would never get anywhere.
        push_dashed(&mut out, [0.0, 0.0], [10.0, 0.0], 0.0, 4.0, [1.0; 4]);
        assert!(out.is_empty());
    }

    #[test]
    fn cube_edges_has_12_edges_of_length_two_half() {
        let half = 0.5;
        let verts = cube_edges(half);
        assert_eq!(verts.len(), 24);
        let mut edges: Vec<([f32; 3], [f32; 3])> = Vec::new();
        for pair in verts.chunks(2) {
            let (a, b) = (pair[0], pair[1]);
            assert!(
                a.iter().chain(&b).all(|c| c.abs() == half),
                "{a:?} → {b:?} joins two corners"
            );
            let axes = (0..3).filter(|&i| a[i] != b[i]).count();
            assert_eq!(axes, 1, "{a:?} → {b:?} runs along one axis");
            // Either direction is the same edge.
            edges.push(if a < b { (a, b) } else { (b, a) });
        }
        for i in 0..edges.len() {
            for j in i + 1..edges.len() {
                assert_ne!(edges[i], edges[j], "edges {i} and {j} repeat");
            }
        }
    }

    #[test]
    fn cube_corners_stay_inside_the_frustum_over_a_sweep() {
        let mut camera = Camera3D::new();
        camera.distance = CAMERA_DISTANCE;
        camera.resize(100, 100);
        let side = |i: usize, axis: usize| {
            if i & (1 << axis) == 0 {
                -CUBE_HALF
            } else {
                CUBE_HALF
            }
        };
        let corners: Vec<[f32; 3]> = (0..8)
            .map(|i| [side(i, 0), side(i, 1), side(i, 2)])
            .collect();
        for az in (0..360).step_by(5) {
            for el in (-89..=89).step_by(2) {
                camera.azimuth = (az as f32).to_radians();
                camera.elevation = (el as f32).to_radians();
                let m = camera.view_projection();
                for c in &corners {
                    // Column-major: clip = m · (c, 1).
                    let clip = |row: usize| {
                        m[row] * c[0] + m[4 + row] * c[1] + m[8 + row] * c[2] + m[12 + row]
                    };
                    let (x, y, w) = (clip(0), clip(1), clip(3));
                    assert!(w > 0.0, "{c:?} behind the eye at az {az}, el {el}");
                    assert!(
                        (x / w).abs() < 0.95 && (y / w).abs() < 0.95,
                        "{c:?} leaves the view at az {az}, el {el}: ({}, {})",
                        x / w,
                        y / w
                    );
                }
            }
        }
    }

    #[test]
    fn glow_quad_spans_the_bar_with_thickness() {
        let [left, top, right] = explicit().bars;
        let color = [0.9, 0.7, 0.2, 0.6];
        let q = glow_quad(&left, 2.0, color);
        assert_point_near(q.min, [14.0, 32.0], "left min");
        assert_point_near(q.max, [18.0, 108.0], "left max");
        assert_eq!(q.color, color);
        let q = glow_quad(&right, 2.0, color);
        assert_point_near(q.min, [102.0, 32.0], "right min");
        assert_point_near(q.max, [106.0, 108.0], "right max");
        let q = glow_quad(&top, 2.0, color);
        assert_point_near(q.min, [22.0, 24.0], "top min");
        assert_point_near(q.max, [98.0, 28.0], "top max");
    }

    #[test]
    fn with_alpha_scales_only_alpha() {
        assert_eq!(with_alpha([0.2, 0.4, 0.6, 0.8], 0.5), [0.2, 0.4, 0.6, 0.4]);
        assert_eq!(with_alpha([0.2, 0.4, 0.6, 0.8], 0.0), [0.2, 0.4, 0.6, 0.0]);
    }

    #[test]
    fn push_polyline_joins_consecutive_points() {
        let mut out = vec![[9.0, 9.0]];
        push_polyline(&mut out, [[0.0, 0.0], [1.0, 2.0], [3.0, 4.0]]);
        assert_eq!(
            out,
            vec![[9.0, 9.0], [0.0, 0.0], [1.0, 2.0], [1.0, 2.0], [3.0, 4.0]],
            "appended after what was there"
        );
        out.clear();
        push_polyline(&mut out, [[5.0, 5.0]]);
        assert!(out.is_empty(), "one point is no segment");
    }

    // ---- the viz: identity, camera, smear ----

    fn move_event(dx: f32, dy: f32, buttons: u8) -> InputEvent {
        InputEvent::PointerMove {
            x: 0.0,
            y: 0.0,
            dx,
            dy,
            buttons,
        }
    }

    #[test]
    fn id_is_notes() {
        assert_eq!(NotesViz::new().id(), "notes");
    }

    #[test]
    fn set_zoom_is_a_no_op() {
        // CUBE_HALF only fits the frustum from this distance, so a zoom that
        // moved the camera would push corners off screen.
        let mut viz = NotesViz::new();
        viz.set_zoom(4.0);
        viz.set_zoom(0.25);
        assert_eq!(viz.camera.distance, CAMERA_DISTANCE);
    }

    #[test]
    fn drag_with_primary_button_orbits() {
        let mut viz = NotesViz::new();
        let (az0, el0) = (viz.azimuth_offset, viz.elevation);
        viz.handle_input(&move_event(40.0, 20.0, 1));
        let daz = viz.azimuth_offset - az0;
        let del = viz.elevation - el0;
        // 0.005 rad per pixel, like Camera3D's drag sensitivity.
        assert!(
            (daz - 40.0 * 0.005).abs() < 1e-6,
            "azimuth_offset moved {daz}"
        );
        assert!((del - 20.0 * 0.005).abs() < 1e-6, "elevation moved {del}");
    }

    #[test]
    fn drag_without_primary_button_is_ignored() {
        let mut viz = NotesViz::new();
        let (az0, el0) = (viz.azimuth_offset, viz.elevation);
        // Hovering (no buttons) and a middle-button drag both leave it alone.
        viz.handle_input(&move_event(40.0, 20.0, 0));
        viz.handle_input(&move_event(40.0, 20.0, 4));
        assert_eq!(viz.azimuth_offset, az0);
        assert_eq!(viz.elevation, el0);
    }

    #[test]
    fn elevation_clamps_at_the_poles() {
        let mut viz = NotesViz::new();
        let limit = std::f32::consts::FRAC_PI_2 - 0.01;
        viz.handle_input(&move_event(0.0, 100_000.0, 1));
        assert!((viz.elevation - limit).abs() < 1e-6, "{}", viz.elevation);
        viz.handle_input(&move_event(0.0, -1_000_000.0, 1));
        assert!((viz.elevation + limit).abs() < 1e-6, "{}", viz.elevation);
    }

    #[test]
    fn pointer_down_and_up_do_not_perturb_orientation() {
        let mut viz = NotesViz::new();
        let (az0, el0) = (viz.azimuth_offset, viz.elevation);
        viz.handle_input(&InputEvent::PointerDown {
            x: 0.0,
            y: 0.0,
            button: 0,
        });
        viz.handle_input(&InputEvent::PointerUp {
            x: 0.0,
            y: 0.0,
            button: 0,
        });
        assert_eq!(viz.azimuth_offset, az0);
        assert_eq!(viz.elevation, el0);
    }

    #[test]
    fn tick_advances_auto_azimuth_by_cached_speed() {
        let mut viz = NotesViz::new();
        let az0 = viz.auto_azimuth;
        // Before any `init` it spins at the config default, 0.25 rad/s.
        viz.tick(2.0);
        assert!((viz.auto_azimuth - (az0 + 0.5)).abs() < 1e-6);
        viz.cached_auto_speed = 1.5;
        viz.tick(0.5);
        assert!((viz.auto_azimuth - (az0 + 1.25)).abs() < 1e-6);
        // The spin and the drag offset are kept apart.
        viz.handle_input(&move_event(10.0, 0.0, 1));
        let offset = viz.azimuth_offset;
        viz.tick(1.0);
        assert_eq!(viz.azimuth_offset, offset);
    }

    #[test]
    fn update_smear_ignores_backward_jumps() {
        let mut viz = NotesViz::new();
        assert_eq!(viz.update_smear(10.0), 0.0, "first frame");
        assert!(viz.update_smear(10.02) < 1e-6, "a slow step");
        assert_eq!(viz.update_smear(17.0), 1.0, "audio rate");
        assert_eq!(viz.update_smear(3.0), 0.0, "a reset jumps back");
        // The tracker restarts from where the jump landed.
        assert!(viz.update_smear(3.02) < 1e-6);
    }

    #[test]
    fn a_backward_jump_releases_the_strip_hold() {
        let mut viz = NotesViz::new();
        viz.update_smear(100.0);
        viz.strip_hold = Some((104.0, 4.0));
        viz.update_smear(107.0); // audio rate: a forward frame keeps it
        assert_eq!(viz.strip_hold, Some((104.0, 4.0)));
        viz.update_smear(0.0); // a reset rewinds to the start
        assert_eq!(viz.strip_hold, None);
    }

    #[test]
    fn smear_rises_at_once_and_fades_over_frames() {
        let mut viz = NotesViz::new();
        let mut phase = 100.0;
        viz.update_smear(phase);
        // 440 swings a second: fully smeared from the first fast frame.
        for _ in 0..10 {
            phase += 440.0 / 60.0;
            assert_eq!(viz.update_smear(phase), 1.0);
        }
        // After a viz-config push the engine zeroes dt, so the phase stands
        // still for a frame. That must not flash the dots back.
        let still = viz.update_smear(phase);
        assert!(still > 0.5, "one still frame: {still}");
        // A real stop fades out frame by frame, gone within twenty frames.
        let mut prev = still;
        for frame in 2..=20 {
            let smear = viz.update_smear(phase);
            assert!(smear <= prev, "still frame {frame}: {smear} after {prev}");
            prev = smear;
        }
        assert_eq!(prev, 0.0);
    }
}
