//! The JPEG lab's rule: encode one image with the `jpeg` crate and walk its
//! scan. The whole file is encoded once per config (`init`); the engine clock
//! then counts MCUs scanned, so `advance_to` only moves a cursor.
//!
//! The config is the single source of truth for the encode: quality,
//! subsampling and Huffman mode change through a config push (which
//! re-encodes and rewinds; the lab restores the scan position). The selected
//! block is view state and moves through `apply_action` without re-encoding.

use std::sync::atomic::{AtomicU32, Ordering};

use jpeg::bits::BitSpan;
use jpeg::blocks::level_shift;
use jpeg::codec::{decode, encode, Encoded, HuffmanMode, Options};
use jpeg::metrics::{entropy_bits, psnr};
use jpeg::zigzag::to_zigzag;
use jpeg::{Rgb8Image, Subsampling};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::config::{number_property, ConfigSchema, NumberOpts};
use crate::jpeg_images::builtin_image;
use crate::traits::{Capabilities, Rule, SceneState};

/// Side of the generated built-ins when no pixels were pushed.
pub const BUILTIN_SIDE: usize = 256;

fn default_image_id() -> String {
    "gradient".to_string()
}
fn default_quality() -> u8 {
    50
}
fn default_subsampling() -> String {
    "420".to_string()
}
fn default_huffman() -> String {
    "optimized".to_string()
}
fn default_max_iterations() -> u32 {
    mcu_count(BUILTIN_SIDE, BUILTIN_SIDE, Subsampling::S420) as u32
}

/// What to encode and how. `pixels` never crosses as JSON: it arrives
/// through `apply_image` and lasts until the next config push.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JpegConfig {
    /// Which picture this is ("gradient", "text", "bars", "photo", "upload").
    /// Without pushed pixels, a generated id is rendered at 256 × 256 and
    /// anything else falls back to "gradient".
    #[serde(default = "default_image_id")]
    pub image_id: String,
    /// 1–100 (clamped by the encoder).
    #[serde(default = "default_quality")]
    pub quality: u8,
    /// "444", "422" or "420"; anything else is treated as "420".
    #[serde(default = "default_subsampling")]
    pub subsampling: String,
    /// "optimized" or "standard"; anything else is treated as "optimized".
    #[serde(default = "default_huffman")]
    pub huffman: String,
    /// The engine clock's length: the image's MCU count (the lab computes it).
    #[serde(default = "default_max_iterations")]
    pub max_iterations: u32,
    /// The image installed by `apply_image`.
    #[serde(skip)]
    pub pixels: Option<Rgb8Image>,
}

impl ConfigSchema for JpegConfig {
    fn schema() -> Value {
        json!({
            "type": "object",
            "properties": {
                "image_id": { "type": "string", "title": "Image", "default": default_image_id(), "x-cosmetic": false },
                "quality": number_property(NumberOpts {
                    label: "Quality",
                    default: 50.0,
                    min: 1.0,
                    max: 100.0,
                    step: 1.0,
                    integer: true,
                    cosmetic: false,
                    widget: None,
                }),
                "subsampling": { "type": "string", "title": "Subsampling", "enum": ["444", "422", "420"], "default": "420", "x-cosmetic": false },
                "huffman": { "type": "string", "title": "Huffman tables", "enum": ["optimized", "standard"], "default": "optimized", "x-cosmetic": false },
                "max_iterations": number_property(NumberOpts {
                    label: "MCUs",
                    default: default_max_iterations() as f64,
                    min: 1.0,
                    max: u32::MAX as f64,
                    step: 1.0,
                    integer: true,
                    cosmetic: false,
                    widget: None,
                }),
            },
            "required": ["image_id", "quality", "subsampling", "huffman", "max_iterations"],
        })
    }

    fn defaults() -> Value {
        json!({
            "image_id": default_image_id(),
            "quality": default_quality(),
            "subsampling": default_subsampling(),
            "huffman": default_huffman(),
            "max_iterations": default_max_iterations(),
        })
    }
}

/// `"444" | "422" | "420"` → mode (anything else → 4:2:0).
pub fn parse_subsampling(s: &str) -> Subsampling {
    match s {
        "444" => Subsampling::S444,
        "422" => Subsampling::S422,
        _ => Subsampling::S420,
    }
}

/// Mode → `"444" | "422" | "420"`.
pub fn subsampling_name(s: Subsampling) -> &'static str {
    match s {
        Subsampling::S444 => "444",
        Subsampling::S422 => "422",
        Subsampling::S420 => "420",
    }
}

/// How many MCUs a `w × h` colour image has.
pub fn mcu_count(w: usize, h: usize, s: Subsampling) -> usize {
    let (fh, fv) = s.factors();
    w.div_ceil(8 * fh) * h.div_ceil(8 * fv)
}

/// The encoder options a config asks for.
pub fn options_of(cfg: &JpegConfig) -> Options {
    Options {
        quality: cfg.quality,
        subsampling: parse_subsampling(&cfg.subsampling),
        huffman: if cfg.huffman == "standard" {
            HuffmanMode::Standard
        } else {
            HuffmanMode::Optimized
        },
        ..Options::default()
    }
}

/// The block every stage follows: component (0 = Y, 1 = Cb, 2 = Cr) and its
/// position in that component's block grid.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Selection {
    pub component: usize,
    pub bx: usize,
    pub by: usize,
}

/// One encode and how far the scan has got.
#[derive(Debug, Clone)]
pub struct JpegState {
    /// The picture as given.
    pub original: Rgb8Image,
    /// The encode (file and full trace); `None` only if encoding failed.
    pub encoded: Option<Encoded>,
    /// The file decoded again (what a viewer sees).
    pub decoded: Option<Rgb8Image>,
    /// PSNR of `decoded` against `original` (∞ for a perfect copy).
    pub psnr: f64,
    /// MCUs scanned (the engine clock).
    pub n: u32,
    pub selection: Selection,
    /// Changes on every re-encode, so views know to re-upload textures.
    pub version: u32,
    /// Why the encode failed, if it did.
    pub error: Option<String>,
}

impl SceneState for JpegState {
    fn clear(&mut self) {
        self.n = 0;
    }
}

static NEXT_VERSION: AtomicU32 = AtomicU32::new(1);

impl JpegState {
    /// Encodes `original` with `opts` and decodes the result.
    pub fn build(original: Rgb8Image, opts: &Options) -> Self {
        let version = NEXT_VERSION.fetch_add(1, Ordering::Relaxed);
        let (encoded, error) = match encode(&original, opts) {
            Ok(e) => (Some(e), None),
            Err(e) => (None, Some(e.to_string())),
        };
        let decoded = encoded
            .as_ref()
            .and_then(|e| decode(&e.bytes).ok())
            .map(|d| d.image);
        let psnr = decoded
            .as_ref()
            .and_then(|d| psnr(&original, d).ok())
            .unwrap_or(0.0);
        let selection = encoded
            .as_ref()
            .map(|e| busiest_block(&e.trace))
            .unwrap_or(Selection {
                component: 0,
                bx: 0,
                by: 0,
            });
        Self {
            original,
            encoded,
            decoded,
            psnr,
            n: 0,
            selection,
            version,
            error,
        }
    }

    /// Total MCUs in the scan (0 if the encode failed).
    pub fn total(&self) -> u32 {
        self.encoded
            .as_ref()
            .map_or(0, |e| e.trace.mcu_bits.len() as u32)
    }

    /// Payload bits written for the first `n` MCUs.
    pub fn bits_so_far(&self) -> u64 {
        let Some(e) = &self.encoded else { return 0 };
        let n = (self.n as usize).min(e.trace.mcu_bits.len());
        if n == 0 {
            return 0;
        }
        let last = e.trace.mcu_bits[n - 1];
        last.start_bit + last.len
    }
}

/// The luma block with the most AC energy (the most detail): the most telling
/// block to start every stage on. Ties go to the first in raster order.
pub fn busiest_block(t: &jpeg::codec::Trace) -> Selection {
    let (cols, _) = t.layout.grids[0];
    let mut best = (0usize, -1.0f32);
    for (i, b) in t.blocks[0].iter().enumerate() {
        let ac: f32 = b.dct[1..].iter().map(|c| c * c).sum();
        if ac > best.1 {
            best = (i, ac);
        }
    }
    Selection {
        component: 0,
        bx: best.0 % cols,
        by: best.0 / cols,
    }
}

/// The JPEG lab's rule.
pub struct JpegRule;

fn span_json(s: BitSpan) -> Value {
    json!([s.start_bit, s.len])
}

fn selected_json(state: &JpegState) -> Value {
    let Some(e) = &state.encoded else {
        return Value::Null;
    };
    let t = &e.trace;
    let Selection { component, bx, by } = state.selection;
    let (Some(pixels), Some(b)) = (t.pixels(component, bx, by), t.block(component, bx, by)) else {
        return Value::Null;
    };
    let table = t.tables[(component > 0) as usize];
    let tokens: Vec<Value> = b
        .tokens
        .iter()
        .map(|tk| json!({ "run": tk.run, "size": tk.size, "amp": tk.amp, "symbol": tk.symbol() }))
        .collect();
    json!({
        "component": component,
        "bx": bx,
        "by": by,
        "mcu": b.mcu,
        "pixels": pixels.to_vec(),
        "shifted": level_shift(&pixels).to_vec(),
        "dct": b.dct.to_vec(),
        "quant": b.quant.to_vec(),
        "table": table.to_vec(),
        "zigzag": to_zigzag(&b.quant).to_vec(),
        "dc_prev": b.dc_prev,
        "dc_diff": b.dc_diff,
        "tokens": tokens,
        "bit_span": span_json(b.bits),
        "bits": t.bit_string(b.bits),
    })
}

impl Rule for JpegRule {
    type Config = JpegConfig;
    type State = JpegState;

    fn id(&self) -> &'static str {
        "jpeg"
    }

    /// Scrubbable, but NOT cheap to recompute: a scrub or Reset only moves
    /// the cursor (`advance_to`) instead of re-encoding the image.
    fn capabilities(&self) -> Capabilities {
        Capabilities {
            supports_scrub: true,
            cheap_recompute: false,
            checkpoint_every: None,
        }
    }

    fn init(&self, cfg: &Self::Config, _seed: u64) -> Self::State {
        let original = cfg.pixels.clone().unwrap_or_else(|| {
            builtin_image(&cfg.image_id, BUILTIN_SIDE, BUILTIN_SIDE)
                .or_else(|| builtin_image("gradient", BUILTIN_SIDE, BUILTIN_SIDE))
                .expect("the gradient built-in always generates")
        });
        JpegState::build(original, &options_of(cfg))
    }

    fn advance_to(&self, state: &mut Self::State, _cfg: &Self::Config, _seed: u64, n: u32) {
        state.n = n.min(state.total());
    }

    fn apply_image(&self, cfg: &mut Self::Config, w: u32, h: u32, rgba: &[u8]) -> bool {
        match Rgb8Image::new(w as usize, h as usize, rgba.to_vec()) {
            Ok(img) => {
                cfg.pixels = Some(img);
                true
            }
            Err(_) => false,
        }
    }

    /// Cheap enough for every frame: scalars plus the selected block.
    fn summary(&self, state: &Self::State) -> Value {
        let (bytes, layout, grids, entropy, payload_bits) = match &state.encoded {
            Some(e) => {
                let t = &e.trace;
                let entropy: f64 = t.frequencies.iter().map(|f| entropy_bits(f)).sum();
                (
                    e.bytes.len(),
                    json!([t.layout.mcu_w, t.layout.mcu_h, t.layout.cols, t.layout.rows]),
                    json!(t.layout.grids),
                    entropy,
                    t.mcu_bits.iter().map(|s| s.len).sum::<u64>(),
                )
            }
            None => (0, Value::Null, Value::Null, 0.0, 0),
        };
        let opts = state.encoded.as_ref().map(|e| e.trace.options);
        json!({
            "version": state.version,
            "n": state.n,
            "total": state.total(),
            "width": state.original.w,
            "height": state.original.h,
            "bytes": bytes,
            "raw_bytes": state.original.w * state.original.h * 3,
            "bits_so_far": state.bits_so_far(),
            "payload_bits": payload_bits,
            "entropy_bits": entropy,
            "psnr": if state.psnr.is_finite() { json!(state.psnr) } else { Value::Null },
            "quality": opts.map(|o| o.quality),
            "subsampling": opts.map(|o| subsampling_name(o.subsampling)),
            "mcu": layout,
            "grids": grids,
            "selected": selected_json(state),
            "error": state.error,
        })
    }

    /// `{"kind": "select_block", "component": c, "bx": x, "by": y}` moves the
    /// selection (no re-encode). Out-of-range blocks are an error.
    fn apply_action(
        &self,
        state: &mut Self::State,
        _cfg: &Self::Config,
        action: &Value,
    ) -> Result<bool, String> {
        let kind = action
            .get("kind")
            .and_then(Value::as_str)
            .ok_or_else(|| "jpeg action: missing string field \"kind\"".to_string())?;
        if kind != "select_block" {
            return Ok(false);
        }
        let field = |name: &str| -> Result<usize, String> {
            action
                .get(name)
                .and_then(Value::as_u64)
                .map(|v| v as usize)
                .ok_or_else(|| format!("jpeg action: missing integer field {name:?}"))
        };
        let sel = Selection {
            component: field("component")?,
            bx: field("bx")?,
            by: field("by")?,
        };
        let grids = state
            .encoded
            .as_ref()
            .map(|e| e.trace.layout.grids.clone())
            .unwrap_or_default();
        match grids.get(sel.component) {
            Some(&(cols, rows)) if sel.bx < cols && sel.by < rows => {
                state.selection = sel;
                Ok(true)
            }
            _ => Err(format!(
                "jpeg action: block ({}, {}) of component {} is outside the image",
                sel.bx, sel.by, sel.component
            )),
        }
    }

    /// `"tables"` → `{ "luma": [64], "chroma": [64] }` (row-major).
    fn inspect(&self, state: &Self::State, key: &str) -> Value {
        match (key, &state.encoded) {
            ("tables", Some(e)) => json!({
                "luma": e.trace.tables[0].to_vec(),
                "chroma": e.trace.tables[1].to_vec(),
            }),
            _ => Value::Null,
        }
    }

    fn bytes(&self, state: &Self::State) -> Option<Vec<u8>> {
        state.encoded.as_ref().map(|e| e.bytes.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> JpegConfig {
        serde_json::from_value(JpegConfig::defaults()).unwrap()
    }

    #[test]
    fn defaults_encode_the_gradient_at_256() {
        let c = cfg();
        assert_eq!(c.image_id, "gradient");
        assert_eq!(c.max_iterations, 256); // 16 × 16 MCUs of 16 × 16 px
        let s = JpegRule.init(&c, 0);
        assert_eq!((s.original.w, s.original.h), (256, 256));
        assert_eq!(s.total(), 256);
        assert!(s.error.is_none());
        assert!(s.psnr > 25.0);
    }

    #[test]
    fn mcu_counts_follow_the_subsampling() {
        assert_eq!(mcu_count(256, 256, Subsampling::S444), 1024);
        assert_eq!(mcu_count(256, 256, Subsampling::S422), 512);
        assert_eq!(mcu_count(99, 61, Subsampling::S420), 7 * 4);
    }

    #[test]
    fn advance_moves_a_cursor_clamped_to_the_scan() {
        let c = cfg();
        let mut s = JpegRule.init(&c, 0);
        JpegRule.advance_to(&mut s, &c, 0, 10);
        assert_eq!(s.n, 10);
        assert!(s.bits_so_far() > 0);
        JpegRule.advance_to(&mut s, &c, 0, 10_000);
        assert_eq!(s.n, 256);
        assert_eq!(
            s.bits_so_far(),
            s.encoded
                .as_ref()
                .unwrap()
                .trace
                .mcu_bits
                .iter()
                .map(|b| b.len)
                .sum::<u64>()
        );
    }

    #[test]
    fn options_follow_the_config_strings() {
        let mut c = cfg();
        c.quality = 90;
        c.subsampling = "444".into();
        c.huffman = "standard".into();
        let o = options_of(&c);
        assert_eq!(o.quality, 90);
        assert_eq!(o.subsampling, Subsampling::S444);
        assert_eq!(o.huffman, HuffmanMode::Standard);
        c.subsampling = "nonsense".into();
        assert_eq!(options_of(&c).subsampling, Subsampling::S420);
    }

    #[test]
    fn pixels_arrive_through_apply_image_and_never_serialize() {
        let mut c = cfg();
        assert!(!JpegRule.apply_image(&mut c, 2, 2, &[0; 15]));
        assert!(JpegRule.apply_image(&mut c, 2, 2, &[200; 16]));
        let s = JpegRule.init(&c, 0);
        assert_eq!((s.original.w, s.original.h), (2, 2));
        let json = serde_json::to_value(&c).unwrap();
        assert!(json.get("pixels").is_none());
    }

    #[test]
    fn unknown_image_ids_fall_back_to_the_gradient() {
        let mut c = cfg();
        c.image_id = "photo".into();
        let s = JpegRule.init(&c, 0);
        assert_eq!(s.original, builtin_image("gradient", 256, 256).unwrap());
    }

    #[test]
    fn summary_carries_the_selected_block_through_every_stage() {
        let s = JpegRule.init(&cfg(), 0);
        let v = JpegRule.summary(&s);
        assert_eq!(v["total"], 256);
        assert_eq!(v["raw_bytes"], 256 * 256 * 3);
        assert_eq!(v["subsampling"], "420");
        assert_eq!(v["mcu"], json!([16, 16, 16, 16]));
        let sel = &v["selected"];
        assert_eq!(sel["component"], 0);
        let start = busiest_block(&s.encoded.as_ref().unwrap().trace);
        assert_eq!(
            (sel["bx"].as_u64(), sel["by"].as_u64()),
            (Some(start.bx as u64), Some(start.by as u64))
        );
        for key in ["pixels", "shifted", "dct", "quant", "table", "zigzag"] {
            assert_eq!(sel[key].as_array().unwrap().len(), 64, "{key}");
        }
        assert_eq!(
            sel["bits"].as_str().unwrap().len() as u64,
            sel["bit_span"][1].as_u64().unwrap()
        );
        assert!(v["psnr"].as_f64().unwrap() > 25.0);
    }

    #[test]
    fn select_block_moves_within_the_grid_only() {
        let c = cfg();
        let mut s = JpegRule.init(&c, 0);
        let ok = json!({"kind": "select_block", "component": 1, "bx": 3, "by": 5});
        assert_eq!(JpegRule.apply_action(&mut s, &c, &ok), Ok(true));
        assert_eq!(
            s.selection,
            Selection {
                component: 1,
                bx: 3,
                by: 5
            }
        );
        let out = json!({"kind": "select_block", "component": 1, "bx": 16, "by": 0});
        assert!(JpegRule.apply_action(&mut s, &c, &out).is_err());
        assert!(JpegRule
            .apply_action(
                &mut s,
                &c,
                &json!({"kind": "select_block", "component": 3, "bx": 0, "by": 0})
            )
            .is_err());
        assert_eq!(
            JpegRule.apply_action(&mut s, &c, &json!({"kind": "other"})),
            Ok(false)
        );
        assert!(JpegRule.apply_action(&mut s, &c, &json!({})).is_err());
    }

    #[test]
    fn inspect_and_bytes() {
        let s = JpegRule.init(&cfg(), 0);
        let t = JpegRule.inspect(&s, "tables");
        assert_eq!(t["luma"][0], 16);
        assert_eq!(t["chroma"].as_array().unwrap().len(), 64);
        assert_eq!(JpegRule.inspect(&s, "nope"), Value::Null);
        let bytes = JpegRule.bytes(&s).unwrap();
        assert_eq!(&bytes[..2], &[0xFF, 0xD8]);
    }

    #[test]
    fn the_first_selection_is_the_block_with_the_most_detail() {
        // Flat grey except one noisy luma block at (2, 1).
        let (w, h) = (32usize, 16usize);
        let mut rgba = vec![128u8; w * h * 4];
        for y in 8..16 {
            for x in 16..24 {
                let v = if (x + y) % 2 == 0 { 0 } else { 255 };
                rgba[(x + w * y) * 4..(x + w * y) * 4 + 3].copy_from_slice(&[v, v, v]);
            }
        }
        let mut c = cfg();
        assert!(JpegRule.apply_image(&mut c, w as u32, h as u32, &rgba));
        let s = JpegRule.init(&c, 0);
        assert_eq!(
            s.selection,
            Selection {
                component: 0,
                bx: 2,
                by: 1
            }
        );
    }

    #[test]
    fn every_re_encode_gets_a_new_version() {
        let a = JpegRule.init(&cfg(), 0);
        let b = JpegRule.init(&cfg(), 0);
        assert_ne!(a.version, b.version);
    }
}
