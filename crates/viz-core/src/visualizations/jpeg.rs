//! The JPEG lab's visualization. The page owns the layout: it pushes a list
//! of named panels, each with its device-pixel rect, and this draws whatever
//! is listed — so the numbers the page overlays line up with the cells drawn
//! here by construction. With no panels (the home tile, the wasm tests) it
//! fits one "image" panel to the canvas.
//!
//! The scan position and the selection are one "current block": the rule keeps
//! the selection on the last scanned MCU, and every panel that shows the
//! picture outlines it in the accent colour (there is no separate scan-front
//! outline). A plane or coded panel with `zoom` set takes its window from the
//! selection, so it follows the scan without the page re-pushing a crop.
//!
//! Panel kinds: `image` (the scan: decoded where scanned, the original dimmed
//! elsewhere, the current block outlined), `image_grid` (the same plus the
//! block grid and MCU outlines), `plane_y` / `plane_cb` / `plane_cr` (the
//! full-resolution planes, current block outlined; `crop` or `zoom` magnifies),
//! `coded_cb` / `coded_cr` (the subsampled chroma as coded, shown blocky,
//! same outline and magnifying), `cube` (the pixels as points in the colour cube,
//! dimmed, with the current block's pixels lit on top),
//! `block` (the selected block's 64 samples), `atlas` (the 64 DCT basis
//! patterns), `coeffs` (the selected block's DCT, signed), `rebuild` (the
//! block rebuilt from its first `dct_k` zigzag coefficients), `quant` (the
//! block's coefficients after quantization, as the decoder sees them),
//! `dequant_rebuild` (the block rebuilt from those), `zigzag` (the quantized
//! grid with the scan path growing through it at `zigzag_speed` cells a
//! second, restarting when the block or the encode changes; the viz reports
//! how far it has got through `readout()`),
//! `wipe` (the original with the decoded image over its left `wipe` share, the
//! current block outlined),
//! `original` and `decoded` (the whole picture before and after compression at
//! full brightness, whatever the scan position) and `error` (per-pixel
//! |decoded − original|, brightened by `error_gain`, the current block
//! outlined).

use jpeg::color::{rgb_to_ycbcr, ycbcr_to_rgb};
use jpeg::dct::{basis, idct, idct_partial};
use jpeg::quant::dequantize;
use jpeg::zigzag::ZIGZAG;
use jpeg::{Plane, Rgb8Image, Subsampling};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use web_sys::WebGl2RenderingContext as Gl;

use crate::config::{color_property, number_property, ConfigSchema, NumberOpts};
use crate::render::texture_quad::{Filter, Texture, TextureQuad};
use crate::render::{
    pixel_projection, Camera3D, InstancedPoints3D, InstancedQuads, LineBatch, LineBatch3D,
    LineVertex, LineVertex3D, PointInstance3D, QuadInstance,
};
use crate::rules::jpeg::{JpegState, Selection};
use crate::traits::{InputEvent, Visualization};

/// One region of the canvas and what to draw in it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Panel {
    /// One of the kinds in the module docs; unknown kinds are skipped.
    pub kind: String,
    /// `[x, y, w, h]` in device pixels, y down.
    pub rect: [f32; 4],
    /// For plane panels: the part of the image to show, `[x, y, w, h]` in
    /// image pixels (default: all of it). A small crop magnifies, which is
    /// how the lab shows subsampled chroma's blocks.
    #[serde(default)]
    pub crop: Option<[f32; 4]>,
    /// For plane and coded panels: the side, in image pixels, of a square
    /// window centred on the selected block. Replaces `crop`, so the zoom
    /// follows the selection (and so the scan) without the page re-pushing
    /// a crop on every step.
    #[serde(default)]
    pub zoom: Option<f32>,
}

fn default_background() -> [f32; 4] {
    [0.07, 0.07, 0.09, 1.0]
}
fn default_accent() -> [f32; 4] {
    [0.886, 0.478, 0.322, 1.0]
}
fn default_grid() -> [f32; 4] {
    [1.0, 1.0, 1.0, 0.16]
}
fn default_dim() -> f32 {
    0.35
}
fn default_dct_k() -> u32 {
    64
}
fn default_auto_rotate() -> f32 {
    0.2
}

/// Look and layout. Every field defaults, so a partial push is fine.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JpegVizConfig {
    /// Clear colour behind the panels, RGBA in 0–1.
    #[serde(default = "default_background")]
    pub background: [f32; 4],
    /// Outlines: the current block, hover.
    #[serde(default = "default_accent")]
    pub accent: [f32; 4],
    /// Block-grid lines.
    #[serde(default = "default_grid")]
    pub grid: [f32; 4],
    /// Brightness of the not-yet-scanned part of the image (0–1).
    #[serde(default = "default_dim")]
    pub dim: f32,
    /// What to draw where (see the module docs).
    #[serde(default)]
    pub panels: Vec<Panel>,
    /// The colour cube's axes: 0 = RGB, 1 = YCbCr.
    #[serde(default)]
    pub cube_mix: f32,
    /// Coefficients kept by the `rebuild` panel, in zigzag order (0–64).
    #[serde(default = "default_dct_k")]
    pub dct_k: u32,
    /// The coefficient `[u, v]` under the pointer, outlined in `atlas` and
    /// `coeffs`.
    #[serde(default)]
    pub hover: Option<[u32; 2]>,
    /// The cube's idle spin, radians per second.
    #[serde(default = "default_auto_rotate")]
    pub auto_rotate_speed: f32,
    /// How fast the `zigzag` panel's path grows, in cells per second
    /// (0 = draw the whole path at once).
    #[serde(default = "default_zigzag_speed")]
    pub zigzag_speed: f32,
    /// Share of the `wipe` panel (from the left) showing the decoded image.
    #[serde(default = "default_wipe")]
    pub wipe: f32,
    /// Brightness multiplier for the `error` panel.
    #[serde(default = "default_error_gain")]
    pub error_gain: f32,
}

fn default_zigzag_speed() -> f32 {
    24.0
}
fn default_wipe() -> f32 {
    0.5
}
fn default_error_gain() -> f32 {
    4.0
}

impl ConfigSchema for JpegVizConfig {
    fn schema() -> Value {
        json!({
            "type": "object",
            "properties": {
                "background": color_property("Background", default_background()),
                "accent": color_property("Accent", default_accent()),
                "grid": color_property("Grid", default_grid()),
                "dim": number_property(NumberOpts { label: "Unscanned brightness", default: 0.35, min: 0.0, max: 1.0, step: 0.05, integer: false, cosmetic: true, widget: None }),
                "panels": { "type": "array", "title": "Panels", "default": [], "x-cosmetic": true },
                "cube_mix": number_property(NumberOpts { label: "RGB → YCbCr", default: 0.0, min: 0.0, max: 1.0, step: 0.01, integer: false, cosmetic: true, widget: None }),
                "dct_k": number_property(NumberOpts { label: "Coefficients kept", default: 64.0, min: 0.0, max: 64.0, step: 1.0, integer: true, cosmetic: true, widget: None }),
                "hover": { "title": "Hovered coefficient", "default": null, "x-cosmetic": true },
                "auto_rotate_speed": number_property(NumberOpts { label: "Cube spin", default: 0.2, min: 0.0, max: 2.0, step: 0.05, integer: false, cosmetic: true, widget: None }),
                "zigzag_speed": number_property(NumberOpts { label: "Zigzag speed", default: 24.0, min: 0.0, max: 64.0, step: 1.0, integer: false, cosmetic: true, widget: None }),
                "wipe": number_property(NumberOpts { label: "Decoded share", default: 0.5, min: 0.0, max: 1.0, step: 0.01, integer: false, cosmetic: true, widget: None }),
                "error_gain": number_property(NumberOpts { label: "Error gain", default: 4.0, min: 1.0, max: 32.0, step: 0.5, integer: false, cosmetic: true, widget: None }),
            },
        })
    }

    fn defaults() -> Value {
        json!({
            "background": default_background(),
            "accent": default_accent(),
            "grid": default_grid(),
            "dim": default_dim(),
            "panels": [],
            "cube_mix": 0.0,
            "dct_k": default_dct_k(),
            "hover": null,
            "auto_rotate_speed": default_auto_rotate(),
            "zigzag_speed": default_zigzag_speed(),
            "wipe": default_wipe(),
            "error_gain": default_error_gain(),
        })
    }
}

// ---- Pure helpers (tested natively) ----

/// The largest rect with the image's aspect ratio, centred in `area`.
pub fn fit_rect(area: [f32; 4], img_w: usize, img_h: usize) -> [f32; 4] {
    let [x, y, w, h] = area;
    if img_w == 0 || img_h == 0 || w <= 0.0 || h <= 0.0 {
        return [x, y, 0.0, 0.0];
    }
    let s = (w / img_w as f32).min(h / img_h as f32);
    let (fw, fh) = (img_w as f32 * s, img_h as f32 * s);
    [x + (w - fw) / 2.0, y + (h - fh) / 2.0, fw, fh]
}

/// `sub` (image pixels) mapped into `panel` (device pixels), clipped to the
/// image. A zero-size image maps to a zero-size rect at the panel's corner.
pub fn map_rect(sub: [f32; 4], panel: [f32; 4], img_w: usize, img_h: usize) -> [f32; 4] {
    map_rect_in_crop(sub, panel, [0.0, 0.0, img_w as f32, img_h as f32])
}

/// `sub` (image pixels) clipped to `crop`, then scaled so that `crop` fills
/// `panel` (device pixels). `map_rect(sub, panel, w, h)` is the case of a
/// crop that is the whole `w × h` image.
pub fn map_rect_in_crop(sub: [f32; 4], panel: [f32; 4], crop: [f32; 4]) -> [f32; 4] {
    let (sx, sy) = (panel[2] / crop[2].max(1e-6), panel[3] / crop[3].max(1e-6));
    let x0 = sub[0].clamp(crop[0], crop[0] + crop[2]);
    let y0 = sub[1].clamp(crop[1], crop[1] + crop[3]);
    let x1 = (sub[0] + sub[2]).clamp(crop[0], crop[0] + crop[2]);
    let y1 = (sub[1] + sub[3]).clamp(crop[1], crop[1] + crop[3]);
    [
        panel[0] + (x0 - crop[0]) * sx,
        panel[1] + (y0 - crop[1]) * sy,
        (x1 - x0) * sx,
        (y1 - y0) * sy,
    ]
}

/// The luma block (in 8 × 8 blocks) at the top-left of the area a block
/// covers: a luma block is its own anchor, a chroma block's is scaled by the
/// sampling factors.
pub fn luma_anchor(sel: Selection, s: Subsampling) -> (usize, usize) {
    if sel.component == 0 {
        (sel.bx, sel.by)
    } else {
        let (fh, fv) = s.factors();
        (sel.bx * fh, sel.by * fv)
    }
}

/// A `side`-pixel square of an `iw × ih` image centred on luma block
/// `anchor`, kept inside the image (a smaller image is shown whole), as
/// `[x, y, w, h]`. The twin of `zoomWindow` in `web/src/lib/jpeg/layout.ts`.
pub fn zoom_window(anchor: (usize, usize), side: f32, iw: usize, ih: usize) -> [f32; 4] {
    let side = side.min(iw as f32).min(ih as f32).max(0.0);
    let centre = |a: usize| a as f32 * 8.0 + 4.0;
    // Rounds half up like JavaScript's `Math.round`.
    let place = |c: f32, extent: usize| {
        (c - side / 2.0 + 0.5)
            .floor()
            .clamp(0.0, (extent as f32 - side).max(0.0))
    };
    [
        place(centre(anchor.0), iw),
        place(centre(anchor.1), ih),
        side,
        side,
    ]
}

/// Where to draw a texture spanning `span` image pixels (`[w, h]`, from the
/// image's top-left) so that `crop` (image pixels) lands exactly on `rect`
/// (device pixels). Scissor to `rect` to hide the rest.
pub fn crop_target(rect: [f32; 4], crop: [f32; 4], span: [f32; 2]) -> [f32; 4] {
    let sx = rect[2] / crop[2].max(1e-6);
    let sy = rect[3] / crop[3].max(1e-6);
    [
        rect[0] - crop[0] * sx,
        rect[1] - crop[1] * sy,
        span[0] * sx,
        span[1] * sy,
    ]
}

/// The image-pixel rects covered by the first `n` MCUs of a raster scan
/// (`cols` MCUs per row, each `mcu_w × mcu_h`): whole rows, then the
/// partial row.
pub fn scanned_rects(n: usize, cols: usize, mcu_w: usize, mcu_h: usize) -> Vec<[f32; 4]> {
    let mut out = Vec::with_capacity(2);
    if cols == 0 {
        return out;
    }
    let (rows, rem) = (n / cols, n % cols);
    if rows > 0 {
        out.push([0.0, 0.0, (cols * mcu_w) as f32, (rows * mcu_h) as f32]);
    }
    if rem > 0 {
        out.push([
            0.0,
            (rows * mcu_h) as f32,
            (rem * mcu_w) as f32,
            mcu_h as f32,
        ]);
    }
    out
}

/// The image-pixel rect a block covers: 8 × 8 for luma, scaled by the
/// sampling factors for chroma.
pub fn block_rect(sel: Selection, s: Subsampling) -> [f32; 4] {
    let (fh, fv) = if sel.component == 0 {
        (1, 1)
    } else {
        s.factors()
    };
    let (w, h) = (8 * fh, 8 * fv);
    [(sel.bx * w) as f32, (sel.by * h) as f32, w as f32, h as f32]
}

/// The four edges of a rect as line vertices.
pub fn outline(rect: [f32; 4], color: [f32; 4], out: &mut Vec<LineVertex>) {
    let [x, y, w, h] = rect;
    let c = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    for i in 0..4 {
        out.push(LineVertex {
            position: c[i],
            color,
        });
        out.push(LineVertex {
            position: c[(i + 1) % 4],
            color,
        });
    }
}

/// Whether a clipped rect has any area. A selection wholly outside a panel's
/// crop clips to zero width or height, and outlining that draws a stray edge.
fn visible(rect: [f32; 4]) -> bool {
    rect[2] > 0.0 && rect[3] > 0.0
}

/// `outline`, skipped when the rect has no area.
fn outline_if_visible(rect: [f32; 4], color: [f32; 4], out: &mut Vec<LineVertex>) {
    if visible(rect) {
        outline(rect, color, out);
    }
}

/// The current block outlined on a whole-picture panel at `rect`, in the
/// accent colour. Does nothing until there is an encode to name the block's
/// size.
fn outline_current_block(
    state: &JpegState,
    cfg: &JpegVizConfig,
    rect: [f32; 4],
    out: &mut Vec<LineVertex>,
) {
    if let Some(enc) = &state.encoded {
        let cur = block_rect(state.selection, enc.trace.options.subsampling);
        let (iw, ih) = (state.original.w, state.original.h);
        outline(map_rect(cur, rect, iw, ih), cfg.accent, out);
    }
}

/// Splits a square-ish rect into an 8 × 8 grid of cells, `gap` px apart.
pub fn cells_8x8(rect: [f32; 4], gap: f32) -> [[f32; 4]; 64] {
    let cw = (rect[2] - 7.0 * gap) / 8.0;
    let ch = (rect[3] - 7.0 * gap) / 8.0;
    std::array::from_fn(|i| {
        let (x, y) = ((i % 8) as f32, (i / 8) as f32);
        [rect[0] + x * (cw + gap), rect[1] + y * (ch + gap), cw, ch]
    })
}

/// Grey for a 0–255 sample.
pub fn gray(v: f32) -> [f32; 4] {
    let g = (v / 255.0).clamp(0.0, 1.0);
    [g, g, g, 1.0]
}

/// A chroma sample shown as colour at mid brightness: Cb runs yellow → blue,
/// Cr green → red.
pub fn chroma_color(component: usize, v: f32) -> [f32; 4] {
    let rgb = if component == 1 {
        ycbcr_to_rgb(128.0, v, 128.0)
    } else {
        ycbcr_to_rgb(128.0, 128.0, v)
    };
    [
        (rgb[0] / 255.0).clamp(0.0, 1.0),
        (rgb[1] / 255.0).clamp(0.0, 1.0),
        (rgb[2] / 255.0).clamp(0.0, 1.0),
        1.0,
    ]
}

/// Colour for a sample of `component` (grey for Y, tinted for chroma).
pub fn sample_color(component: usize, v: f32) -> [f32; 4] {
    if component == 0 {
        gray(v)
    } else {
        chroma_color(component, v)
    }
}

/// Signed coefficient colour: warm for positive, cool for negative, with a
/// log scale so small AC terms still show next to a large DC term.
pub fn diverging(c: f32) -> [f32; 4] {
    let t = ((1.0 + c.abs()).ln() / (1.0 + 1024.0f32).ln()).clamp(0.0, 1.0);
    let base = [0.12, 0.12, 0.14];
    let tip = if c >= 0.0 {
        [0.95, 0.55, 0.30]
    } else {
        [0.35, 0.60, 0.95]
    };
    [
        base[0] + (tip[0] - base[0]) * t,
        base[1] + (tip[1] - base[1]) * t,
        base[2] + (tip[2] - base[2]) * t,
        1.0,
    ]
}

/// Where a pixel sits in the cube: RGB axes at `mix = 0`, YCbCr at 1 (both
/// scaled to −0.5…0.5; x = R or Cb, y = G or Y, z = B or Cr).
pub fn cube_point(rgb: [f32; 3], mix: f32) -> [f32; 3] {
    let [y, cb, cr] = rgb_to_ycbcr(rgb[0], rgb[1], rgb[2]);
    let a = [rgb[0], rgb[1], rgb[2]];
    let b = [cb, y, cr];
    let m = mix.clamp(0.0, 1.0);
    std::array::from_fn(|i| (a[i] + (b[i] - a[i]) * m) / 255.0 - 0.5)
}

/// The RGB cube's 12 edges, each from one corner (0–255 per channel) to
/// another, in the order the cube is drawn.
pub fn cube_edges() -> [([f32; 3], [f32; 3]); 12] {
    let c = |i: u8| {
        [
            if i & 1 != 0 { 255.0 } else { 0.0 },
            if i & 2 != 0 { 255.0 } else { 0.0 },
            if i & 4 != 0 { 255.0 } else { 0.0 },
        ]
    };
    let pairs = [
        (0, 1),
        (0, 2),
        (0, 4),
        (1, 3),
        (1, 5),
        (2, 3),
        (2, 6),
        (3, 7),
        (4, 5),
        (4, 6),
        (5, 7),
        (6, 7),
    ];
    pairs.map(|(a, b)| (c(a), c(b)))
}

/// RGBA bytes for a plane: grey for Y (component 0), tinted for chroma.
pub fn plane_rgba(p: &Plane, component: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(p.data.len() * 4);
    for &v in &p.data {
        let c = sample_color(component, v);
        out.extend([
            (c[0] * 255.0).round() as u8,
            (c[1] * 255.0).round() as u8,
            (c[2] * 255.0).round() as u8,
            255,
        ]);
    }
    out
}

/// Every `step`-th pixel of an image (≤ ~4096 points), as RGB floats.
pub fn sample_pixels(img: &Rgb8Image, max_points: usize) -> Vec<[f32; 3]> {
    let step = ((img.w * img.h) as f32 / max_points.max(1) as f32)
        .sqrt()
        .ceil()
        .max(1.0) as usize;
    let mut out = Vec::new();
    for y in (0..img.h).step_by(step) {
        for x in (0..img.w).step_by(step) {
            let i = (x + img.w * y) * 4;
            out.push([
                img.rgba[i] as f32,
                img.rgba[i + 1] as f32,
                img.rgba[i + 2] as f32,
            ]);
        }
    }
    out
}

/// RGBA bytes of the per-pixel error between two same-size images: the mean
/// |Δ| over R, G, B as a warm tint (the panel brightens it with
/// `error_gain`). Mismatched sizes give all black.
pub fn error_rgba(a: &Rgb8Image, b: &Rgb8Image) -> Vec<u8> {
    let mut out = vec![0u8; a.w * a.h * 4];
    if a.w != b.w || a.h != b.h {
        return out;
    }
    for (i, (pa, pb)) in a
        .rgba
        .chunks_exact(4)
        .zip(b.rgba.chunks_exact(4))
        .enumerate()
    {
        let e = (0..3)
            .map(|c| (pa[c] as f32 - pb[c] as f32).abs())
            .sum::<f32>()
            / 3.0;
        out[i * 4] = e.round().min(255.0) as u8;
        out[i * 4 + 1] = (e * 0.55).round().min(255.0) as u8;
        out[i * 4 + 2] = (e * 0.25).round().min(255.0) as u8;
        out[i * 4 + 3] = 255;
    }
    out
}

/// Centres of the 8 × 8 cells in zigzag order, the path drawn through the
/// first `t` of them (`t` in 0–64; a fractional `t` ends part-way along the
/// next step). Fewer than two points → no path.
pub fn zigzag_path(cells: &[[f32; 4]; 64], t: f32) -> Vec<[f32; 2]> {
    let centre = |k: usize| {
        let c = cells[ZIGZAG[k] as usize];
        [c[0] + c[2] / 2.0, c[1] + c[3] / 2.0]
    };
    let t = t.clamp(0.0, 64.0);
    let whole = t.floor() as usize;
    let mut pts: Vec<[f32; 2]> = (0..whole.min(64)).map(centre).collect();
    let frac = t - whole as f32;
    if frac > 0.0 && (1..64).contains(&whole) {
        let (a, b) = (centre(whole - 1), centre(whole));
        pts.push([a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac]);
    }
    if pts.len() < 2 {
        pts.clear();
    }
    pts
}

/// GL scissor box for a y-down device-pixel rect on a canvas `canvas_h` high.
pub fn scissor_box(canvas_h: u32, r: [f32; 4]) -> [i32; 4] {
    let y_up = canvas_h as f32 - (r[1] + r[3]);
    [
        r[0].floor() as i32,
        y_up.floor() as i32,
        r[2].ceil().max(0.0) as i32,
        r[3].ceil().max(0.0) as i32,
    ]
}

/// The hovered coefficient `[u, v]` as an index into the 8 × 8 grid, or
/// `None` when absent or out of range (values come from JS).
pub fn hover_index(hover: Option<[u32; 2]>) -> Option<usize> {
    hover
        .filter(|[u, v]| *u < 8 && *v < 8)
        .map(|[u, v]| (u + 8 * v) as usize)
}

/// The RGB (0–255) of every image pixel inside the block's rect, clipped to
/// the picture, row by row.
pub fn block_pixels(img: &Rgb8Image, sel: Selection, s: Subsampling) -> Vec<[f32; 3]> {
    let mut out = Vec::new();
    block_pixels_into(img, sel, s, &mut out);
    out
}

/// `block_pixels`, appended to `out` so a caller can reuse its allocation.
fn block_pixels_into(img: &Rgb8Image, sel: Selection, s: Subsampling, out: &mut Vec<[f32; 3]>) {
    let [x, y, w, h] = block_rect(sel, s);
    let (x0, y0) = (x as usize, y as usize);
    let (x1, y1) = ((x0 + w as usize).min(img.w), (y0 + h as usize).min(img.h));
    for py in y0..y1 {
        for px in x0..x1 {
            let i = (px + img.w * py) * 4;
            out.push([
                img.rgba[i] as f32,
                img.rgba[i + 1] as f32,
                img.rgba[i + 2] as f32,
            ]);
        }
    }
}

/// A colour with its RGB scaled by `dim` (clamped to 0–1); alpha unchanged.
pub fn dimmed(c: [f32; 4], dim: f32) -> [f32; 4] {
    let d = dim.clamp(0.0, 1.0);
    [c[0] * d, c[1] * d, c[2] * d, c[3]]
}

/// Builds the cube's edge lines and pixel points for `mix`, the cloud dimmed
/// by `dim` so the current block's lit pixels stand out.
fn build_cube(img: &Rgb8Image, version: u32, mix: f32, dim: f32, accent: [f32; 4]) -> CubeCache {
    let edge_color = [1.0, 1.0, 1.0, 0.35];
    let mut lines: Vec<LineVertex3D> = Vec::with_capacity(26);
    for (a, b) in cube_edges() {
        for end in [a, b] {
            lines.push(LineVertex3D {
                position: cube_point(end, mix),
                color: edge_color,
            });
        }
    }
    // The grey diagonal: black → white, the Y axis once the cube turns.
    for end in [[0.0; 3], [255.0; 3]] {
        lines.push(LineVertex3D {
            position: cube_point(end, mix),
            color: accent,
        });
    }
    let points = sample_pixels(img, 4096)
        .into_iter()
        .map(|rgb| PointInstance3D {
            position: cube_point(rgb, mix),
            color: dimmed([rgb[0] / 255.0, rgb[1] / 255.0, rgb[2] / 255.0, 0.9], dim),
            radius_px: 2.0,
        })
        .collect();
    CubeCache {
        version,
        mix,
        dim,
        accent,
        lines,
        points,
    }
}

// ---- The visualization ----

/// Textures built from one encode (`version`).
struct Textures {
    version: u32,
    original: Texture,
    decoded: Texture,
    planes: [Texture; 3],
    coded: [Option<Texture>; 2],
    error: Texture,
}

/// The cube's sampled pixels turned into GPU instances, valid for one encode
/// (`version`), one `cube_mix`, one dimming and one accent colour.
struct CubeCache {
    version: u32,
    mix: f32,
    dim: f32,
    accent: [f32; 4],
    lines: Vec<LineVertex3D>,
    points: Vec<PointInstance3D>,
}

/// A NaN or infinite `dim` (JS can send one) falls back to the default, so it
/// cannot defeat the cube cache's equality check; a finite one is clamped to 0–1.
fn sane_dim(dim: f32) -> f32 {
    if dim.is_finite() {
        dim.clamp(0.0, 1.0)
    } else {
        default_dim()
    }
}

/// A NaN or infinite `cube_mix` falls back to the default (0, plain RGB), for
/// the same reason as `sane_dim`; a finite one is clamped to 0–1.
fn sane_mix(mix: f32) -> f32 {
    if mix.is_finite() {
        mix.clamp(0.0, 1.0)
    } else {
        0.0
    }
}

/// Whether `cache` must be rebuilt for these keys. The selection is not one:
/// the lit block is added per frame on top of the cached cloud.
fn cube_cache_stale(
    cache: Option<&CubeCache>,
    version: u32,
    mix: f32,
    dim: f32,
    accent: [f32; 4],
) -> bool {
    cache.is_none_or(|c| c.version != version || c.mix != mix || c.dim != dim || c.accent != accent)
}

/// GPU resources and view state.
pub struct JpegViz {
    quad: Option<TextureQuad>,
    quads: Option<InstancedQuads>,
    lines: Option<LineBatch>,
    lines_3d: Option<LineBatch3D>,
    points_3d: Option<InstancedPoints3D>,
    textures: Option<Textures>,
    camera: Camera3D,
    auto_speed: f32,
    cube_cache: Option<CubeCache>,
    /// Per-frame buffer for the current block's pixels lit in the cube.
    block_scratch: Vec<[f32; 3]>,
    /// Per-frame buffer: the cached cloud followed by the lit block.
    cube_points: Vec<PointInstance3D>,
    quad_scratch: Vec<QuadInstance>,
    line_scratch: Vec<LineVertex>,
    /// The zigzag path's progress in cells (0–64), advanced by `tick`.
    zig_progress: f32,
    /// Cells per second for `zig_progress` (0 = jump to the end).
    zig_speed: f32,
    /// The (encode, block) the path was started for; a change restarts it. It
    /// is `None` while no zigzag panel is drawn, so re-entering the stage replays it.
    zig_key: Option<(u32, Selection)>,
}

impl JpegViz {
    /// Starts the zigzag path over when `key` (the encode and block it draws,
    /// or `None` on a stage without the path) differs from the last one, so it
    /// replays on a new encode, a new block and on every re-entry to the stage.
    fn restart_zigzag_if(&mut self, key: Option<(u32, Selection)>) {
        if self.zig_key != key {
            self.zig_key = key;
            self.zig_progress = 0.0;
        }
    }

    /// A viz with no GPU resources yet; they are created on first use.
    pub fn new() -> Self {
        let mut camera = Camera3D::new();
        camera.elevation = 0.45;
        camera.azimuth = 0.6;
        Self {
            quad: None,
            quads: None,
            lines: None,
            lines_3d: None,
            points_3d: None,
            textures: None,
            camera,
            auto_speed: default_auto_rotate(),
            zig_progress: 0.0,
            zig_speed: default_zigzag_speed(),
            zig_key: None,
            cube_cache: None,
            block_scratch: Vec::new(),
            cube_points: Vec::new(),
            quad_scratch: Vec::new(),
            line_scratch: Vec::new(),
        }
    }

    fn ensure_resources(&mut self, gl: &Gl) -> Result<(), String> {
        if self.quad.is_none() {
            self.quad = Some(TextureQuad::new(gl)?);
        }
        if self.quads.is_none() {
            self.quads = Some(InstancedQuads::new(gl)?);
        }
        if self.lines.is_none() {
            self.lines = Some(LineBatch::new(gl)?);
        }
        if self.lines_3d.is_none() {
            self.lines_3d = Some(LineBatch3D::new(gl)?);
        }
        if self.points_3d.is_none() {
            self.points_3d = Some(InstancedPoints3D::new(gl)?);
        }
        Ok(())
    }

    /// Rebuilds the textures when the encode changed.
    fn ensure_textures(&mut self, gl: &Gl, state: &JpegState) -> Result<(), String> {
        if self
            .textures
            .as_ref()
            .is_some_and(|t| t.version == state.version)
        {
            return Ok(());
        }
        let Some(enc) = &state.encoded else {
            self.textures = None;
            return Ok(());
        };
        let t = &enc.trace;
        let img = &state.original;
        let (w, h) = (img.w as u32, img.h as u32);
        let original = Texture::new(gl, w, h, &img.rgba, Filter::Nearest)?;
        let decoded_rgba = state.decoded.as_ref().map_or(&img.rgba, |d| &d.rgba);
        let decoded = Texture::new(gl, w, h, decoded_rgba, Filter::Nearest)?;
        let plane =
            |c: usize| Texture::new(gl, w, h, &plane_rgba(&t.planes[c], c), Filter::Nearest);
        let planes = [plane(0)?, plane(1)?, plane(2)?];
        let coded = |c: usize| -> Result<Option<Texture>, String> {
            match t.coded.get(c) {
                Some(p) => Ok(Some(Texture::new(
                    gl,
                    p.w as u32,
                    p.h as u32,
                    &plane_rgba(p, c),
                    Filter::Nearest,
                )?)),
                None => Ok(None),
            }
        };
        let error_bytes = state
            .decoded
            .as_ref()
            .map_or_else(|| vec![0; (w * h * 4) as usize], |d| error_rgba(img, d));
        let error = Texture::new(gl, w, h, &error_bytes, Filter::Nearest)?;
        self.textures = Some(Textures {
            version: state.version,
            original,
            decoded,
            planes,
            coded: [coded(1)?, coded(2)?],
            error,
        });
        Ok(())
    }

    fn draw_quads(&mut self, gl: &Gl, proj: &[f32; 9]) {
        if let Some(q) = self.quads.as_mut() {
            q.upload(gl, &self.quad_scratch);
            q.draw(gl, proj);
        }
        self.quad_scratch.clear();
    }

    fn draw_lines(&mut self, gl: &Gl, proj: &[f32; 9]) {
        if let Some(l) = self.lines.as_mut() {
            l.upload(gl, &self.line_scratch);
            l.draw(gl, proj);
        }
        self.line_scratch.clear();
    }

    fn draw_image(
        &mut self,
        gl: &Gl,
        state: &JpegState,
        cfg: &JpegVizConfig,
        rect: [f32; 4],
        canvas: [u32; 2],
        grid: bool,
    ) {
        let (Some(tex), Some(enc), Some(quad)) = (&self.textures, &state.encoded, &self.quad)
        else {
            return;
        };
        let t = &enc.trace;
        let (iw, ih) = (state.original.w, state.original.h);
        quad.draw(gl, &tex.original, rect, canvas, cfg.dim);
        gl.enable(Gl::SCISSOR_TEST);
        for r in scanned_rects(
            state.n as usize,
            t.layout.cols,
            t.layout.mcu_w,
            t.layout.mcu_h,
        ) {
            let [x, y, w, h] = scissor_box(canvas[1], map_rect(r, rect, iw, ih));
            gl.scissor(x, y, w, h);
            quad.draw(gl, &tex.decoded, rect, canvas, 1.0);
        }
        gl.disable(Gl::SCISSOR_TEST);

        if grid {
            let thin = cfg.grid;
            let strong = [
                cfg.grid[0],
                cfg.grid[1],
                cfg.grid[2],
                (cfg.grid[3] * 2.5).min(1.0),
            ];
            let (sx, sy) = (rect[2] / iw as f32, rect[3] / ih as f32);
            let mut x = 8;
            while x < iw {
                let c = if x % t.layout.mcu_w == 0 {
                    strong
                } else {
                    thin
                };
                let px = rect[0] + x as f32 * sx;
                self.line_scratch.push(LineVertex {
                    position: [px, rect[1]],
                    color: c,
                });
                self.line_scratch.push(LineVertex {
                    position: [px, rect[1] + rect[3]],
                    color: c,
                });
                x += 8;
            }
            let mut y = 8;
            while y < ih {
                let c = if y % t.layout.mcu_h == 0 {
                    strong
                } else {
                    thin
                };
                let py = rect[1] + y as f32 * sy;
                self.line_scratch.push(LineVertex {
                    position: [rect[0], py],
                    color: c,
                });
                self.line_scratch.push(LineVertex {
                    position: [rect[0] + rect[2], py],
                    color: c,
                });
                y += 8;
            }
        }
        let sel = block_rect(state.selection, t.options.subsampling);
        outline(
            map_rect(sel, rect, iw, ih),
            cfg.accent,
            &mut self.line_scratch,
        );
    }

    fn draw_cells(
        &mut self,
        rect: [f32; 4],
        colors: &[[f32; 4]; 64],
        hover: Option<usize>,
        accent: [f32; 4],
    ) {
        let gap = (rect[2] / 160.0).max(1.0);
        let cells = cells_8x8(rect, gap);
        for (cell, color) in cells.iter().zip(colors) {
            self.quad_scratch.push(QuadInstance {
                min: [cell[0], cell[1]],
                max: [cell[0] + cell[2], cell[1] + cell[3]],
                color: *color,
            });
        }
        if let Some(i) = hover.filter(|&i| i < 64) {
            outline(cells[i], accent, &mut self.line_scratch);
        }
    }

    fn draw_atlas(&mut self, rect: [f32; 4], hover: Option<usize>, accent: [f32; 4]) {
        let gap = (rect[2] / 60.0).max(2.0);
        let tiles = cells_8x8(rect, gap);
        for (i, tile) in tiles.iter().enumerate() {
            let pattern = basis(i % 8, i / 8);
            let cells = cells_8x8(*tile, 0.0);
            for (cell, v) in cells.iter().zip(pattern.iter()) {
                let g = (0.5 + v * 2.0).clamp(0.0, 1.0);
                self.quad_scratch.push(QuadInstance {
                    min: [cell[0], cell[1]],
                    max: [cell[0] + cell[2], cell[1] + cell[3]],
                    color: [g, g, g, 1.0],
                });
            }
        }
        if let Some(i) = hover.filter(|&i| i < 64) {
            let r = tiles[i];
            outline(
                [r[0] - 1.0, r[1] - 1.0, r[2] + 2.0, r[3] + 2.0],
                accent,
                &mut self.line_scratch,
            );
        }
    }

    fn draw_cube(
        &mut self,
        gl: &Gl,
        state: &JpegState,
        cfg: &JpegVizConfig,
        rect: [f32; 4],
        canvas: [u32; 2],
    ) {
        let mix = sane_mix(cfg.cube_mix);
        let dim = sane_dim(cfg.dim);
        if cube_cache_stale(
            self.cube_cache.as_ref(),
            state.version,
            mix,
            dim,
            cfg.accent,
        ) {
            self.cube_cache = Some(build_cube(
                &state.original,
                state.version,
                mix,
                dim,
                cfg.accent,
            ));
        }
        let [x, y, w, h] = scissor_box(canvas[1], rect);
        if w <= 0 || h <= 0 {
            return;
        }
        gl.viewport(x, y, w, h);
        self.camera.resize(w as u32, h as u32);
        let vp = self.camera.view_projection();
        if let Some(c) = &self.cube_cache {
            if let Some(l) = self.lines_3d.as_mut() {
                l.upload(gl, &c.lines);
                l.draw(gl, &vp);
            }
            if let Some(p) = self.points_3d.as_mut() {
                // The current block's pixels go after the dimmed cloud, at full
                // brightness and a larger radius, so they draw on top.
                self.block_scratch.clear();
                // Without an encode there is no block size to name, so none lights up.
                if let Some(enc) = &state.encoded {
                    block_pixels_into(
                        &state.original,
                        state.selection,
                        enc.trace.options.subsampling,
                        &mut self.block_scratch,
                    );
                }
                self.cube_points.clear();
                self.cube_points.extend_from_slice(&c.points);
                self.cube_points
                    .extend(self.block_scratch.iter().map(|rgb| PointInstance3D {
                        position: cube_point(*rgb, mix),
                        color: [rgb[0] / 255.0, rgb[1] / 255.0, rgb[2] / 255.0, 1.0],
                        radius_px: 3.5,
                    }));
                p.upload(gl, &self.cube_points);
                p.draw(gl, &vp, [w as u32, h as u32]);
            }
        }
        gl.viewport(0, 0, canvas[0] as i32, canvas[1] as i32);
    }
}

impl Default for JpegViz {
    fn default() -> Self {
        Self::new()
    }
}

impl Visualization for JpegViz {
    type State = JpegState;
    type Config = JpegVizConfig;

    fn id(&self) -> &'static str {
        "jpeg"
    }

    fn init(&mut self, gl: &Gl, cfg: &Self::Config) {
        self.auto_speed = cfg.auto_rotate_speed;
        self.zig_speed = cfg.zigzag_speed.max(0.0);
        // A failure is retried by the next render, like the other vizzes.
        let _ = self.ensure_resources(gl);
    }

    fn render(&mut self, gl: &Gl, state: &Self::State, cfg: &Self::Config) {
        if self.ensure_resources(gl).is_err() || self.ensure_textures(gl, state).is_err() {
            return;
        }
        let canvas = [
            gl.drawing_buffer_width().max(1) as u32,
            gl.drawing_buffer_height().max(1) as u32,
        ];
        gl.viewport(0, 0, canvas[0] as i32, canvas[1] as i32);
        let [r, g, b, a] = cfg.background;
        gl.clear_color(r, g, b, a);
        gl.clear(Gl::COLOR_BUFFER_BIT);
        gl.disable(Gl::DEPTH_TEST);
        gl.enable(Gl::BLEND);
        gl.blend_func(Gl::SRC_ALPHA, Gl::ONE_MINUS_SRC_ALPHA);
        let proj = pixel_projection(canvas[0], canvas[1]);

        let fallback;
        let panels: &[Panel] = if cfg.panels.is_empty() {
            let area = [0.0, 0.0, canvas[0] as f32, canvas[1] as f32];
            fallback = [Panel {
                kind: "image".into(),
                rect: fit_rect(area, state.original.w, state.original.h),
                crop: None,
                zoom: None,
            }];
            &fallback
        } else {
            &cfg.panels
        };

        if !panels.iter().any(|p| p.kind == "zigzag") {
            self.restart_zigzag_if(None);
        }
        let hover = hover_index(cfg.hover);
        let sel = state.selection;
        let trace = state.encoded.as_ref().map(|e| &e.trace);
        for panel in panels {
            let rect = panel.rect;
            match panel.kind.as_str() {
                "image" | "image_grid" => {
                    self.draw_image(gl, state, cfg, rect, canvas, panel.kind == "image_grid");
                }
                "plane_y" | "plane_cb" | "plane_cr" | "coded_cb" | "coded_cr" => {
                    let (Some(q), Some(t), Some(tr)) = (&self.quad, &self.textures, trace) else {
                        continue;
                    };
                    let (iw, ih) = (state.original.w as f32, state.original.h as f32);
                    let crop = match panel.zoom {
                        Some(side) => {
                            let anchor = luma_anchor(sel, tr.options.subsampling);
                            zoom_window(anchor, side, state.original.w, state.original.h)
                        }
                        None => panel.crop.unwrap_or([0.0, 0.0, iw, ih]),
                    };
                    let (tex, span) = match panel.kind.as_str() {
                        "plane_y" => (Some(&t.planes[0]), [iw, ih]),
                        "plane_cb" => (Some(&t.planes[1]), [iw, ih]),
                        "plane_cr" => (Some(&t.planes[2]), [iw, ih]),
                        kind => {
                            // The coded plane is subsampled and padded to whole
                            // MCUs: each texel covers `fh × fv` image pixels.
                            let (fh, fv) = tr.options.subsampling.factors();
                            let tex = t.coded[if kind == "coded_cb" { 0 } else { 1 }].as_ref();
                            let span = tex.map_or([iw, ih], |x| {
                                [(x.w as usize * fh) as f32, (x.h as usize * fv) as f32]
                            });
                            (tex, span)
                        }
                    };
                    if let Some(tex) = tex {
                        gl.enable(Gl::SCISSOR_TEST);
                        let [x, y, w, h] = scissor_box(canvas[1], rect);
                        gl.scissor(x, y, w, h);
                        q.draw(gl, tex, crop_target(rect, crop, span), canvas, 1.0);
                        gl.disable(Gl::SCISSOR_TEST);
                        let cur = block_rect(sel, tr.options.subsampling);
                        outline_if_visible(
                            map_rect_in_crop(cur, rect, crop),
                            cfg.accent,
                            &mut self.line_scratch,
                        );
                    }
                }
                "block" => {
                    if let Some(px) = trace.and_then(|t| t.pixels(sel.component, sel.bx, sel.by)) {
                        let colors = px.map(|v| sample_color(sel.component, v));
                        self.draw_cells(rect, &colors, None, cfg.accent);
                    }
                }
                "coeffs" => {
                    if let Some(b) = trace.and_then(|t| t.block(sel.component, sel.bx, sel.by)) {
                        let colors = b.dct.map(diverging);
                        self.draw_cells(rect, &colors, hover, cfg.accent);
                    }
                }
                "rebuild" => {
                    if let Some(b) = trace.and_then(|t| t.block(sel.component, sel.bx, sel.by)) {
                        let rebuilt = idct_partial(&b.dct, cfg.dct_k.min(64) as usize);
                        let colors = rebuilt.map(|v| sample_color(sel.component, v + 128.0));
                        self.draw_cells(rect, &colors, None, cfg.accent);
                    }
                }
                "quant" => {
                    if let Some(b) = trace.and_then(|t| t.block(sel.component, sel.bx, sel.by)) {
                        let table =
                            trace.map_or([1; 64], |t| t.tables[(sel.component > 0) as usize]);
                        let colors = dequantize(&b.quant, &table).map(diverging);
                        self.draw_cells(rect, &colors, hover, cfg.accent);
                    }
                }
                "dequant_rebuild" => {
                    if let Some(b) = trace.and_then(|t| t.block(sel.component, sel.bx, sel.by)) {
                        let table =
                            trace.map_or([1; 64], |t| t.tables[(sel.component > 0) as usize]);
                        let rebuilt = idct(&dequantize(&b.quant, &table));
                        let colors = rebuilt.map(|v| sample_color(sel.component, v + 128.0));
                        self.draw_cells(rect, &colors, None, cfg.accent);
                    }
                }
                "zigzag" => {
                    if let Some(b) = trace.and_then(|t| t.block(sel.component, sel.bx, sel.by)) {
                        let lit = [0.886, 0.478, 0.322, 0.55];
                        let colors =
                            b.quant
                                .map(|q| if q != 0 { lit } else { [0.16, 0.16, 0.19, 1.0] });
                        self.draw_cells(rect, &colors, None, cfg.accent);
                        let gap = (rect[2] / 160.0).max(1.0);
                        self.restart_zigzag_if(Some((state.version, sel)));
                        let path = zigzag_path(&cells_8x8(rect, gap), self.zig_progress);
                        let c = [1.0, 1.0, 1.0, 0.85];
                        for pair in path.windows(2) {
                            self.line_scratch.push(LineVertex {
                                position: pair[0],
                                color: c,
                            });
                            self.line_scratch.push(LineVertex {
                                position: pair[1],
                                color: c,
                            });
                        }
                    }
                }
                "original" | "decoded" => {
                    if let (Some(q), Some(t)) = (&self.quad, &self.textures) {
                        let tex = if panel.kind == "original" {
                            &t.original
                        } else {
                            &t.decoded
                        };
                        q.draw(gl, tex, rect, canvas, 1.0);
                    }
                }
                "wipe" => {
                    if let (Some(q), Some(t)) = (&self.quad, &self.textures) {
                        q.draw(gl, &t.original, rect, canvas, 1.0);
                        let share = cfg.wipe.clamp(0.0, 1.0);
                        if share > 0.0 {
                            gl.enable(Gl::SCISSOR_TEST);
                            let [x, y, w, h] = scissor_box(
                                canvas[1],
                                [rect[0], rect[1], rect[2] * share, rect[3]],
                            );
                            gl.scissor(x, y, w, h);
                            q.draw(gl, &t.decoded, rect, canvas, 1.0);
                            gl.disable(Gl::SCISSOR_TEST);
                        }
                        let edge = rect[0] + rect[2] * share;
                        self.line_scratch.push(LineVertex {
                            position: [edge, rect[1]],
                            color: cfg.accent,
                        });
                        self.line_scratch.push(LineVertex {
                            position: [edge, rect[1] + rect[3]],
                            color: cfg.accent,
                        });
                        outline_current_block(state, cfg, rect, &mut self.line_scratch);
                    }
                }
                "error" => {
                    if let (Some(q), Some(t)) = (&self.quad, &self.textures) {
                        q.draw(gl, &t.error, rect, canvas, cfg.error_gain.max(0.0));
                        outline_current_block(state, cfg, rect, &mut self.line_scratch);
                    }
                }
                "atlas" => self.draw_atlas(rect, hover, cfg.accent),
                "cube" => {
                    // Flush 2D batches first so they stay under the cube.
                    self.draw_quads(gl, &proj);
                    self.draw_lines(gl, &proj);
                    self.draw_cube(gl, state, cfg, rect, canvas);
                }
                _ => {}
            }
        }
        self.draw_quads(gl, &proj);
        self.draw_lines(gl, &proj);
        gl.disable(Gl::BLEND);
    }

    fn handle_input(&mut self, ev: &InputEvent) {
        if let InputEvent::PointerMove {
            dx, dy, buttons, ..
        } = ev
        {
            if *buttons & 1 != 0 {
                self.camera.orbit_drag(*dx, *dy);
            }
        }
    }

    fn tick(&mut self, dt: f32) {
        self.camera.auto_advance(dt, self.auto_speed);
        self.zig_progress = if self.zig_speed > 0.0 {
            (self.zig_progress + dt * self.zig_speed).min(64.0)
        } else {
            64.0
        };
    }

    /// `{ "zigzag": cells }`: how far the zigzag path has grown (0–64).
    fn readout(&self) -> Value {
        json!({ "zigzag": self.zig_progress })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_parse_and_have_no_panels() {
        let c: JpegVizConfig = serde_json::from_value(JpegVizConfig::defaults()).unwrap();
        assert!(c.panels.is_empty());
        assert_eq!(c.dct_k, 64);
        assert_eq!(c.hover, None);
        let partial: JpegVizConfig = serde_json::from_value(json!({
            "panels": [{ "kind": "image", "rect": [1, 2, 3, 4] }],
            "hover": [2, 3],
        }))
        .unwrap();
        assert_eq!(partial.panels[0].rect, [1.0, 2.0, 3.0, 4.0]);
        assert_eq!(partial.hover, Some([2, 3]));
    }

    #[test]
    fn fit_rect_keeps_the_aspect_and_centres() {
        assert_eq!(
            fit_rect([0.0, 0.0, 200.0, 100.0], 256, 256),
            [50.0, 0.0, 100.0, 100.0]
        );
        assert_eq!(
            fit_rect([10.0, 10.0, 100.0, 100.0], 200, 100),
            [10.0, 35.0, 100.0, 50.0]
        );
        assert_eq!(fit_rect([0.0, 0.0, 0.0, 10.0], 8, 8)[2], 0.0);
    }

    #[test]
    fn luma_anchor_scales_a_chroma_block_to_its_top_left_luma_block() {
        let s = |component, bx, by| Selection { component, bx, by };
        assert_eq!(luma_anchor(s(0, 21, 17), Subsampling::S420), (21, 17));
        assert_eq!(luma_anchor(s(1, 3, 2), Subsampling::S420), (6, 4));
        assert_eq!(luma_anchor(s(2, 3, 2), Subsampling::S422), (6, 2));
        assert_eq!(luma_anchor(s(1, 3, 2), Subsampling::S444), (3, 2));
    }

    #[test]
    fn zoom_window_matches_the_web_layout() {
        // ZOOM_WINDOW is 32 on the web side.
        assert_eq!(
            zoom_window((21, 17), 32.0, 256, 256),
            [156.0, 124.0, 32.0, 32.0]
        );
        assert_eq!(zoom_window((0, 0), 32.0, 256, 256), [0.0, 0.0, 32.0, 32.0]);
        assert_eq!(
            zoom_window((31, 31), 32.0, 256, 256),
            [224.0, 224.0, 32.0, 32.0]
        );
        // Smaller than the window: the window shrinks to the picture's short side.
        assert_eq!(zoom_window((2, 1), 32.0, 40, 24), [8.0, 0.0, 24.0, 24.0]);
    }

    #[test]
    fn map_rect_in_crop_scales_and_clips_to_the_crop() {
        let crop = [156.0, 124.0, 32.0, 32.0];
        assert_eq!(
            map_rect_in_crop([168.0, 136.0, 8.0, 8.0], [0.0, 0.0, 128.0, 128.0], crop),
            [48.0, 48.0, 32.0, 32.0]
        );
        assert_eq!(
            map_rect_in_crop([150.0, 120.0, 16.0, 16.0], [0.0, 0.0, 128.0, 128.0], crop),
            [0.0, 0.0, 40.0, 48.0]
        );
        let panel = [100.0, 50.0, 512.0, 512.0];
        assert_eq!(
            map_rect_in_crop([8.0, 16.0, 8.0, 8.0], panel, [0.0, 0.0, 256.0, 256.0]),
            map_rect([8.0, 16.0, 8.0, 8.0], panel, 256, 256)
        );
    }

    #[test]
    fn a_selection_outside_the_crop_is_not_visible() {
        let crop = [156.0, 124.0, 32.0, 32.0];
        let panel = [0.0, 0.0, 128.0, 128.0];
        // Wholly left of, and wholly below, the crop: clipped to a zero-size rect.
        let left = map_rect_in_crop([0.0, 130.0, 8.0, 8.0], panel, crop);
        let below = map_rect_in_crop([160.0, 200.0, 8.0, 8.0], panel, crop);
        assert!(!visible(left));
        assert!(!visible(below));
        // Inside, and straddling an edge of, the crop.
        assert!(visible(map_rect_in_crop(
            [168.0, 136.0, 8.0, 8.0],
            panel,
            crop
        )));
        assert!(visible(map_rect_in_crop(
            [150.0, 120.0, 16.0, 16.0],
            panel,
            crop
        )));
    }

    #[test]
    fn outline_if_visible_draws_only_what_overlaps() {
        let mut out = Vec::new();
        outline_if_visible([0.0, 0.0, 0.0, 5.0], [1.0; 4], &mut out);
        outline_if_visible([0.0, 0.0, 5.0, 0.0], [1.0; 4], &mut out);
        assert!(out.is_empty());
        outline_if_visible([0.0, 0.0, 5.0, 5.0], [1.0; 4], &mut out);
        assert_eq!(out.len(), 8);
    }

    #[test]
    fn map_rect_of_an_empty_image_is_finite() {
        let r = map_rect([0.0, 0.0, 8.0, 8.0], [10.0, 20.0, 64.0, 64.0], 0, 0);
        assert_eq!(r, [10.0, 20.0, 0.0, 0.0]);
    }

    fn cube_of(version: u32, mix: f32, dim: f32, accent: [f32; 4]) -> CubeCache {
        let img = Rgb8Image::new(2, 1, vec![10, 10, 10, 255, 0, 0, 0, 255]).unwrap();
        build_cube(&img, version, mix, dim, accent)
    }

    #[test]
    fn the_cube_cache_is_stale_when_a_key_changes() {
        let acc = [1.0, 0.5, 0.0, 1.0];
        assert!(cube_cache_stale(None, 1, 0.0, 0.35, acc));
        let c = cube_of(1, 0.0, 0.35, acc);
        assert!(!cube_cache_stale(Some(&c), 1, 0.0, 0.35, acc));
        assert!(cube_cache_stale(Some(&c), 2, 0.0, 0.35, acc));
        assert!(cube_cache_stale(Some(&c), 1, 0.5, 0.35, acc));
        assert!(cube_cache_stale(Some(&c), 1, 0.0, 0.5, acc));
        assert!(cube_cache_stale(
            Some(&c),
            1,
            0.0,
            0.35,
            [0.0, 0.5, 0.0, 1.0]
        ));
    }

    #[test]
    fn the_selection_is_not_a_cube_cache_key() {
        // The key is (version, mix, dim, accent) only: two builds for different
        // selections on the same encode share one cache.
        let acc = [1.0, 0.5, 0.0, 1.0];
        let c = cube_of(1, 0.0, 0.35, acc);
        assert!(!cube_cache_stale(Some(&c), 1, 0.0, 0.35, acc));
    }

    #[test]
    fn a_nan_dim_or_mix_does_not_rebuild_the_cube_every_frame() {
        let acc = [1.0, 0.5, 0.0, 1.0];
        // Raw NaN never equals itself, so it would always read as stale.
        let raw = cube_of(1, 0.0, f32::NAN, acc);
        assert!(cube_cache_stale(Some(&raw), 1, 0.0, f32::NAN, acc));
        // Sanitised once, the second frame finds the first frame's cache fresh.
        let c = cube_of(1, 0.0, sane_dim(f32::NAN), acc);
        assert!(!cube_cache_stale(Some(&c), 1, 0.0, sane_dim(f32::NAN), acc));
        assert_eq!(sane_dim(f32::NAN), 0.35);
        // The same for a NaN mix.
        let raw = cube_of(1, f32::NAN, 0.35, acc);
        assert!(cube_cache_stale(Some(&raw), 1, f32::NAN, 0.35, acc));
        let c = cube_of(1, sane_mix(f32::NAN), 0.35, acc);
        assert!(!cube_cache_stale(
            Some(&c),
            1,
            sane_mix(f32::NAN),
            0.35,
            acc
        ));
        assert_eq!(sane_mix(f32::NAN), 0.0);
        assert_eq!(sane_mix(f32::INFINITY), 0.0);
        assert_eq!(sane_mix(2.0), 1.0);
        assert_eq!(sane_mix(-1.0), 0.0);
        assert_eq!(sane_mix(0.5), 0.5);
        assert_eq!(sane_dim(f32::INFINITY), 0.35);
        assert_eq!(sane_dim(2.0), 1.0);
        assert_eq!(sane_dim(-1.0), 0.0);
        assert_eq!(sane_dim(0.5), 0.5);
    }

    #[test]
    fn a_panel_reads_zoom_from_json() {
        let p: Panel =
            serde_json::from_value(json!({"kind": "plane_cb", "rect": [0, 0, 10, 10], "zoom": 32}))
                .unwrap();
        assert_eq!(p.zoom, Some(32.0));
        let q: Panel =
            serde_json::from_value(json!({"kind": "plane_cb", "rect": [0, 0, 10, 10]})).unwrap();
        assert_eq!(q.zoom, None);
    }

    #[test]
    fn map_rect_scales_and_clips_to_the_image() {
        let panel = [100.0, 50.0, 512.0, 512.0]; // a 256² image shown at 2×
        assert_eq!(
            map_rect([8.0, 16.0, 8.0, 8.0], panel, 256, 256),
            [116.0, 82.0, 16.0, 16.0]
        );
        // A padded MCU hanging off the right edge is clipped.
        assert_eq!(map_rect([250.0, 0.0, 16.0, 16.0], panel, 256, 256)[2], 12.0);
    }

    #[test]
    fn scanned_rects_cover_whole_rows_then_the_partial_row() {
        assert!(scanned_rects(0, 4, 16, 16).is_empty());
        assert_eq!(scanned_rects(2, 4, 16, 16), vec![[0.0, 0.0, 32.0, 16.0]]);
        assert_eq!(
            scanned_rects(9, 4, 16, 8),
            vec![[0.0, 0.0, 64.0, 16.0], [0.0, 16.0, 16.0, 8.0]]
        );
        assert!(scanned_rects(3, 0, 16, 16).is_empty());
    }

    #[test]
    fn block_rects_scale_chroma_by_the_sampling_factors() {
        let luma = Selection {
            component: 0,
            bx: 2,
            by: 3,
        };
        assert_eq!(block_rect(luma, Subsampling::S420), [16.0, 24.0, 8.0, 8.0]);
        let cb = Selection {
            component: 1,
            bx: 2,
            by: 3,
        };
        assert_eq!(block_rect(cb, Subsampling::S420), [32.0, 48.0, 16.0, 16.0]);
        assert_eq!(block_rect(cb, Subsampling::S422), [32.0, 24.0, 16.0, 8.0]);
        assert_eq!(block_rect(cb, Subsampling::S444), [16.0, 24.0, 8.0, 8.0]);
    }

    #[test]
    fn cells_tile_the_rect_with_gaps() {
        let c = cells_8x8([0.0, 0.0, 87.0, 87.0], 1.0);
        assert_eq!(c[0], [0.0, 0.0, 10.0, 10.0]);
        assert_eq!(c[9], [11.0, 11.0, 10.0, 10.0]);
        assert_eq!(c[63][0] + c[63][2], 87.0);
    }

    #[test]
    fn colours() {
        assert_eq!(gray(255.0), [1.0, 1.0, 1.0, 1.0]);
        assert_eq!(gray(-5.0)[0], 0.0);
        let blue = chroma_color(1, 255.0);
        assert!(blue[2] > blue[0]);
        let red = chroma_color(2, 255.0);
        assert!(red[0] > red[2]);
        assert!(diverging(500.0)[0] > diverging(500.0)[2]);
        assert!(diverging(-500.0)[2] > diverging(-500.0)[0]);
        assert_eq!(diverging(0.0), [0.12, 0.12, 0.14, 1.0]);
    }

    #[test]
    fn the_cube_turns_its_grey_diagonal_into_the_y_axis() {
        let white_rgb = cube_point([255.0; 3], 0.0);
        assert_eq!(white_rgb, [0.5, 0.5, 0.5]);
        let white_ycc = cube_point([255.0; 3], 1.0);
        assert!(white_ycc[0].abs() < 0.01 && white_ycc[2].abs() < 0.01);
        assert!((white_ycc[1] - 0.5).abs() < 0.01);
        let black = cube_point([0.0; 3], 1.0);
        assert!((black[1] + 0.5).abs() < 0.01 && black[0].abs() < 0.01);
        assert_eq!(cube_edges().len(), 12);
    }

    #[test]
    fn sampling_caps_the_point_count() {
        let img = Rgb8Image::new(256, 256, vec![9; 256 * 256 * 4]).unwrap();
        let pts = sample_pixels(&img, 4096);
        assert!(pts.len() <= 4096 && pts.len() >= 1024);
        assert_eq!(pts[0], [9.0, 9.0, 9.0]);
    }

    #[test]
    fn block_pixels_cover_the_block_clipped_to_the_picture() {
        let mut rgba = Vec::new();
        for y in 0..256usize {
            for x in 0..256usize {
                rgba.extend([x as u8, y as u8, 7, 255]);
            }
        }
        let img = Rgb8Image::new(256, 256, rgba).unwrap();
        let luma = block_pixels(
            &img,
            Selection {
                component: 0,
                bx: 1,
                by: 1,
            },
            Subsampling::S420,
        );
        assert_eq!(luma.len(), 64);
        assert_eq!(luma[0], [8.0, 8.0, 7.0]);
        assert_eq!(luma[63], [15.0, 15.0, 7.0]);
        let chroma = block_pixels(
            &img,
            Selection {
                component: 1,
                bx: 0,
                by: 0,
            },
            Subsampling::S420,
        );
        assert_eq!(chroma.len(), 256);
        let small = Rgb8Image::new(24, 10, vec![0; 24 * 10 * 4]).unwrap();
        let edge = Selection {
            component: 0,
            bx: 2,
            by: 1,
        };
        assert_eq!(block_pixels(&small, edge, Subsampling::S420).len(), 16);
    }

    #[test]
    fn dimmed_scales_colour_not_alpha() {
        assert_eq!(dimmed([1.0, 0.5, 0.2, 0.9], 0.5), [0.5, 0.25, 0.1, 0.9]);
        assert_eq!(dimmed([1.0, 1.0, 1.0, 1.0], 2.0), [1.0, 1.0, 1.0, 1.0]);
    }

    #[test]
    fn plane_rgba_is_four_bytes_per_sample() {
        let p = Plane {
            w: 2,
            h: 1,
            data: vec![0.0, 255.0],
        };
        assert_eq!(plane_rgba(&p, 0), vec![0, 0, 0, 255, 255, 255, 255, 255]);
        assert_eq!(plane_rgba(&p, 1).len(), 8);
    }

    #[test]
    fn crop_target_lands_the_crop_on_the_rect() {
        // Show image pixels 32..64 × 16..48 of a 256² image in a 64² rect: 2×.
        let t = crop_target(
            [100.0, 10.0, 64.0, 64.0],
            [32.0, 16.0, 32.0, 32.0],
            [256.0, 256.0],
        );
        assert_eq!(t, [36.0, -22.0, 512.0, 512.0]);
        // No crop: the whole span fills the rect.
        assert_eq!(
            crop_target(
                [0.0, 0.0, 50.0, 50.0],
                [0.0, 0.0, 100.0, 100.0],
                [100.0, 100.0]
            ),
            [0.0, 0.0, 50.0, 50.0]
        );
    }

    #[test]
    fn hover_index_ignores_out_of_range_coefficients() {
        assert_eq!(hover_index(Some([1, 2])), Some(17));
        assert_eq!(hover_index(Some([9, 0])), None);
        assert_eq!(hover_index(Some([u32::MAX, u32::MAX])), None);
        assert_eq!(hover_index(None), None);
    }

    #[test]
    fn scissor_boxes_flip_y() {
        assert_eq!(scissor_box(100, [10.0, 20.0, 30.0, 40.0]), [10, 40, 30, 40]);
    }

    #[test]
    fn the_new_view_fields_default() {
        let c: JpegVizConfig = serde_json::from_value(json!({})).unwrap();
        assert_eq!((c.zigzag_speed, c.wipe, c.error_gain), (24.0, 0.5, 4.0));
    }

    #[test]
    fn error_bytes_are_the_mean_channel_difference_tinted_warm() {
        let a = Rgb8Image::new(2, 1, vec![10, 10, 10, 255, 0, 0, 0, 255]).unwrap();
        let b = Rgb8Image::new(2, 1, vec![10, 10, 10, 255, 30, 60, 90, 255]).unwrap();
        let e = error_rgba(&a, &b);
        assert_eq!(&e[..4], &[0, 0, 0, 255]);
        assert_eq!(&e[4..], &[60, 33, 15, 255]);
        let c = Rgb8Image::new(1, 1, vec![0; 4]).unwrap();
        assert_eq!(error_rgba(&a, &c), vec![0; 8]);
    }

    #[test]
    fn the_zigzag_path_visits_cells_in_scan_order() {
        let cells = cells_8x8([0.0, 0.0, 80.0, 80.0], 0.0);
        assert!(zigzag_path(&cells, 1.0).is_empty());
        let p = zigzag_path(&cells, 3.0);
        // (0,0) → (1,0) → (0,1): centres at 5, 15 and (5, 15).
        assert_eq!(p, vec![[5.0, 5.0], [15.0, 5.0], [5.0, 15.0]]);
        let half = zigzag_path(&cells, 2.5);
        assert_eq!(half.last().copied(), Some([10.0, 10.0]));
        assert_eq!(zigzag_path(&cells, 64.0).len(), 64);
        assert_eq!(zigzag_path(&cells, 99.0).len(), 64);
        assert_eq!(zigzag_path(&cells, 64.0)[63], [75.0, 75.0]);
    }

    #[test]
    fn the_zigzag_path_grows_with_time_and_reports_it() {
        let mut v = JpegViz::new();
        assert_eq!(v.readout()["zigzag"], 0.0);
        v.tick(0.5);
        assert_eq!(v.readout()["zigzag"], 12.0);
        v.tick(10.0);
        assert_eq!(v.readout()["zigzag"], 64.0);
        v.zig_speed = 0.0;
        v.zig_progress = 3.0;
        v.tick(0.01);
        assert_eq!(v.readout()["zigzag"], 64.0);
    }

    #[test]
    fn the_zigzag_path_restarts_when_its_key_changes_or_is_cleared() {
        let sel = |bx| Selection {
            component: 0,
            bx,
            by: 0,
        };
        let mut v = JpegViz::new();
        v.restart_zigzag_if(Some((1, sel(0))));
        v.tick(0.5);
        assert_eq!(v.readout()["zigzag"], 12.0);
        // The same encode and block: the path keeps growing.
        v.restart_zigzag_if(Some((1, sel(0))));
        assert_eq!(v.readout()["zigzag"], 12.0);
        // A new encode restarts it...
        v.restart_zigzag_if(Some((2, sel(0))));
        assert_eq!(v.readout()["zigzag"], 0.0);
        v.tick(0.5);
        // ...and so does a new block.
        v.restart_zigzag_if(Some((2, sel(1))));
        assert_eq!(v.readout()["zigzag"], 0.0);
        // Leaving the stage clears the key, so coming back to the same block replays it.
        v.tick(0.5);
        v.restart_zigzag_if(None);
        v.restart_zigzag_if(Some((2, sel(1))));
        assert_eq!(v.readout()["zigzag"], 0.0);
        v.tick(0.5);
        assert_eq!(v.readout()["zigzag"], 12.0);
    }
}
