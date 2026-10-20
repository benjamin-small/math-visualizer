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
use jpeg::huffman::{canonical_codes, HuffTable};
use jpeg::metrics::{entropy_bits, psnr};
use jpeg::zigzag::to_zigzag;
use jpeg::{Rgb8Image, Subsampling};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::config::{number_property, ConfigSchema, NumberOpts};
use crate::jpeg_images::builtin_image;
use crate::rules::jpeg_hints::{find_hints, Hints};
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
/// through `apply_image` and lasts until the next config push. Any plain
/// rule-config push (`update_rule_config` and the page's `patchRuleConfig`)
/// drops the image (`pixels` is `#[serde(skip)]`) and re-encodes the generated
/// fallback, so a page that has its own pixels must push every change with
/// `update_rule_config_with_image`.
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
    /// Custom `[luma, chroma]` quantization tables (64 entries each, row-major,
    /// 1–255) used instead of the quality-scaled standard ones; `None` for the
    /// standard tables.
    #[serde(default)]
    pub tables: Option<[Vec<u16>; 2]>,
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
                "tables": { "title": "Custom quantization tables", "default": null, "x-cosmetic": false },
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
            "tables": null,
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

/// The encoder options a config asks for. Custom tables must have 64
/// entries each; their values are checked by the encoder (1–255).
pub fn options_of(cfg: &JpegConfig) -> Result<Options, String> {
    let tables = match &cfg.tables {
        None => None,
        Some([luma, chroma]) => {
            let table = |t: &Vec<u16>| -> Result<[u16; 64], String> {
                t.as_slice()
                    .try_into()
                    .map_err(|_| format!("a quantization table needs 64 entries, got {}", t.len()))
            };
            Some([table(luma)?, table(chroma)?])
        }
    };
    Ok(Options {
        quality: cfg.quality,
        subsampling: parse_subsampling(&cfg.subsampling),
        huffman: if cfg.huffman == "standard" {
            HuffmanMode::Standard
        } else {
            HuffmanMode::Optimized
        },
        tables,
        ..Options::default()
    })
}

/// The block every stage follows: component (0 = Y, 1 = Cb, 2 = Cr) and its
/// position in that component's block grid.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Selection {
    /// 0 = Y, 1 = Cb, 2 = Cr.
    pub component: usize,
    /// Block column in that component's grid.
    pub bx: usize,
    /// Block row in that component's grid.
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
    /// The block the stages follow.
    pub selection: Selection,
    /// Changes on every re-encode, so views know to re-upload textures.
    pub version: u32,
    /// Why the encode failed, if it did.
    pub error: Option<String>,
    /// Where each compression artifact is worst (None if the encode failed).
    pub hints: Option<Hints>,
    /// Bits the Huffman codes take (Σ over the four tables of symbol count ×
    /// code length), amplitude bits excluded; computed once per encode.
    pub code_bits: u64,
}

impl SceneState for JpegState {
    fn clear(&mut self) {
        self.n = 0;
    }
}

/// Keeps the selection on the last scanned MCU: unchanged if it is already one
/// of that MCU's blocks, else the MCU's first block of the selection's own
/// component. Nothing scanned yet, or no encode, leaves it alone.
fn follow_scan(state: &mut JpegState) {
    let Some(last) = (state.n as usize).checked_sub(1) else {
        return;
    };
    let Some(e) = &state.encoded else {
        return;
    };
    let layout = &e.trace.layout;
    let (Some(units), Some(&(cols, _))) = (
        layout.units.get(last),
        layout.grids.get(state.selection.component),
    ) else {
        return;
    };
    if cols == 0 {
        return;
    }
    let Selection { component, bx, by } = state.selection;
    let mut own = units.iter().filter(|u| u.component == component);
    if own.clone().any(|u| u.block == by * cols + bx) {
        return;
    }
    if let Some(u) = own.next() {
        state.selection = Selection {
            component,
            bx: u.block % cols,
            by: u.block / cols,
        };
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
        let hints = decoded.as_ref().and_then(|d| find_hints(&original, d));
        let code_bits = encoded.as_ref().map_or(0, |e| code_bits_of(&e.trace));
        Self {
            original,
            encoded,
            decoded,
            psnr,
            n: 0,
            selection,
            version,
            error,
            hints,
            code_bits,
        }
    }

    /// A state that could not be encoded: the picture, no file, and why.
    pub fn failed(original: Rgb8Image, error: String) -> Self {
        Self {
            original,
            encoded: None,
            decoded: None,
            psnr: 0.0,
            n: 0,
            selection: Selection {
                component: 0,
                bx: 0,
                by: 0,
            },
            version: NEXT_VERSION.fetch_add(1, Ordering::Relaxed),
            error: Some(error),
            hints: None,
            code_bits: 0,
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

/// Bits the Huffman codes of `t` take: Σ over the four tables of symbol count
/// × code length. The payload is this plus the amplitude bits.
fn code_bits_of(t: &jpeg::codec::Trace) -> u64 {
    (0..4)
        .map(|slot| {
            let Ok(codes) = canonical_codes(&t.huffman[slot]) else {
                return 0;
            };
            t.frequencies[slot]
                .iter()
                .zip(codes.len.iter())
                .map(|(&count, &len)| count as u64 * len as u64)
                .sum::<u64>()
        })
        .sum()
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

/// `code`'s low `len` bits as '0'/'1' (empty when the symbol has no code).
fn code_string(t: &HuffTable, symbol: u8) -> String {
    let len = t.len[symbol as usize] as usize;
    if len == 0 {
        return String::new();
    }
    format!("{:0len$b}", t.code[symbol as usize], len = len)
}

/// The `size` amplitude bits of `v` as '0'/'1'.
fn amp_string(v: i32) -> String {
    let (bits, size) = jpeg::rle::amplitude_bits(v);
    if size == 0 {
        return String::new();
    }
    format!("{:0size$b}", bits, size = size as usize)
}

/// The names `inspect("huffman")` gives the four tables, in trace order.
pub const TABLE_NAMES: [&str; 4] = ["dc_luma", "ac_luma", "dc_chroma", "ac_chroma"];

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
    let (dc_slot, ac_slot) = if component == 0 { (0, 1) } else { (2, 3) };
    let codes = |slot: usize| canonical_codes(&t.huffman[slot]).ok();
    let (dc_codes, ac_codes) = (codes(dc_slot), codes(ac_slot));
    let tokens: Vec<Value> = b
        .tokens
        .iter()
        .map(|tk| {
            json!({
                "run": tk.run,
                "size": tk.size,
                "amp": tk.amp,
                "symbol": tk.symbol(),
                "code": ac_codes.as_ref().map(|c| code_string(c, tk.symbol())).unwrap_or_default(),
                "amp_bits": amp_string(tk.amp),
            })
        })
        .collect();
    let dc_size = jpeg::rle::size_category(b.dc_diff);
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
        "dc_size": dc_size,
        "dc_code": dc_codes.as_ref().map(|c| code_string(c, dc_size)).unwrap_or_default(),
        "dc_amp_bits": amp_string(b.dc_diff),
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
        match options_of(cfg) {
            Ok(opts) => JpegState::build(original, &opts),
            Err(e) => JpegState::failed(original, e),
        }
    }

    fn advance_to(&self, state: &mut Self::State, _cfg: &Self::Config, _seed: u64, n: u32) {
        state.n = n.min(state.total());
        follow_scan(state);
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
            "code_bits": state.code_bits,
            "entropy_bits": entropy,
            "psnr": if state.psnr.is_finite() { json!(state.psnr) } else { Value::Null },
            "quality": opts.map(|o| o.quality),
            "subsampling": opts.map(|o| subsampling_name(o.subsampling)),
            "mcu": layout,
            "grids": grids,
            "selected": selected_json(state),
            "hints": state.hints,
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
                // `as usize` would wrap a big index into the grid on wasm32.
                .and_then(|v| usize::try_from(v).ok())
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

    /// On-demand views:
    /// - `"tables"` → `{ "luma": [64], "chroma": [64] }` (row-major).
    /// - `"huffman"` → the four tables in `TABLE_NAMES` order, each
    ///   `{ name, bits: [16], vals, codes: [{ symbol, code }], counts: [[symbol, count]],
    ///   entropy_bits, actual_bits }` (counts only for symbols that occur;
    ///   `actual_bits` = Σ count × code length, amplitude bits excluded).
    /// - `"segments"` → `[{ marker, kind, offset, len }]` for the file's
    ///   marker segments (SOS's `len` includes the scan data).
    fn inspect(&self, state: &Self::State, key: &str) -> Value {
        let Some(e) = &state.encoded else {
            return Value::Null;
        };
        let t = &e.trace;
        match key {
            "tables" => json!({
                "luma": t.tables[0].to_vec(),
                "chroma": t.tables[1].to_vec(),
            }),
            "huffman" => Value::Array(
                (0..4)
                    .map(|slot| {
                        let spec = &t.huffman[slot];
                        let freq = &t.frequencies[slot];
                        let codes = canonical_codes(spec).ok();
                        let len = |s: u8| codes.as_ref().map_or(0, |c| c.len[s as usize] as u64);
                        let counts: Vec<Value> = freq
                            .iter()
                            .enumerate()
                            .filter(|(_, &c)| c > 0)
                            .map(|(sym, &c)| json!([sym, c]))
                            .collect();
                        let actual: u64 = freq
                            .iter()
                            .enumerate()
                            .map(|(sym, &c)| c as u64 * len(sym as u8))
                            .sum();
                        json!({
                            "name": TABLE_NAMES[slot],
                            "bits": spec.bits.to_vec(),
                            "vals": spec.vals,
                            "codes": spec.vals.iter().map(|&v| json!({
                                "symbol": v,
                                "code": codes.as_ref().map(|c| code_string(c, v)).unwrap_or_default(),
                            })).collect::<Vec<_>>(),
                            "counts": counts,
                            "entropy_bits": entropy_bits(freq),
                            "actual_bits": actual,
                        })
                    })
                    .collect(),
            ),
            "segments" => Value::Array(
                t.segments
                    .iter()
                    .map(|sg| {
                        json!({
                            "marker": sg.marker,
                            "kind": format!("{:?}", sg.kind),
                            "offset": sg.offset,
                            "len": sg.len,
                        })
                    })
                    .collect(),
            ),
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
        let o = options_of(&c).unwrap();
        assert_eq!(o.quality, 90);
        assert_eq!(o.subsampling, Subsampling::S444);
        assert_eq!(o.huffman, HuffmanMode::Standard);
        c.subsampling = "nonsense".into();
        assert_eq!(options_of(&c).unwrap().subsampling, Subsampling::S420);
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
        // Indices too big for a usize (on wasm32 they would wrap into the grid) are refused, not wrapped.
        for big in [u64::MAX, (1u64 << 32) + 3] {
            let huge = json!({"kind": "select_block", "component": 0, "bx": big, "by": 0});
            assert!(JpegRule.apply_action(&mut s, &c, &huge).is_err());
            let huge = json!({"kind": "select_block", "component": 0, "bx": 0, "by": big});
            assert!(JpegRule.apply_action(&mut s, &c, &huge).is_err());
        }
        assert_eq!(
            s.selection.bx, 3,
            "a refused action leaves the selection alone"
        );
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

    #[test]
    fn custom_tables_travel_in_the_config() {
        let mut c = cfg();
        c.tables = Some([vec![1; 64], vec![255; 64]]);
        let s = JpegRule.init(&c, 0);
        assert!(s.error.is_none());
        assert_eq!(
            s.encoded.as_ref().unwrap().trace.tables,
            [[1; 64], [255; 64]]
        );
        let json = serde_json::to_value(&c).unwrap();
        assert_eq!(json["tables"][1][0], 255);
        // Wrong length: refused before encoding, with a reason.
        c.tables = Some([vec![1; 63], vec![1; 64]]);
        let s = JpegRule.init(&c, 0);
        assert!(s.encoded.is_none());
        assert!(s.error.as_deref().unwrap().contains("64 entries"));
        assert_eq!(JpegRule.summary(&s)["total"], 0);
        // Out-of-range entries: refused by the encoder.
        c.tables = Some([vec![0; 64], vec![1; 64]]);
        assert!(JpegRule.init(&c, 0).error.is_some());
    }

    #[test]
    fn the_selected_blocks_codes_spell_out_its_bits() {
        let s = JpegRule.init(&cfg(), 0);
        let sel = &JpegRule.summary(&s)["selected"];
        let mut spelled = String::new();
        spelled += sel["dc_code"].as_str().unwrap();
        spelled += sel["dc_amp_bits"].as_str().unwrap();
        for t in sel["tokens"].as_array().unwrap() {
            spelled += t["code"].as_str().unwrap();
            spelled += t["amp_bits"].as_str().unwrap();
        }
        assert_eq!(spelled, sel["bits"].as_str().unwrap());
        assert!(!sel["dc_code"].as_str().unwrap().is_empty());
    }

    #[test]
    fn huffman_view_lists_four_tables_above_their_entropy_bound() {
        let s = JpegRule.init(&cfg(), 0);
        let h = JpegRule.inspect(&s, "huffman");
        let tables = h.as_array().unwrap();
        assert_eq!(tables.len(), 4);
        assert_eq!(tables[0]["name"], "dc_luma");
        // One DC symbol per luma block: 32 × 32 blocks.
        let dc_count: u64 = tables[0]["counts"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| c[1].as_u64().unwrap())
            .sum();
        assert_eq!(dc_count, 1024);
        for t in tables {
            assert_eq!(
                t["codes"].as_array().unwrap().len(),
                t["vals"].as_array().unwrap().len()
            );
            let (actual, bound) = (
                t["actual_bits"].as_f64().unwrap(),
                t["entropy_bits"].as_f64().unwrap(),
            );
            assert!(actual + 1e-6 >= bound, "{}: {actual} < {bound}", t["name"]);
        }
    }

    /// Amplitude bits counted straight from the blocks: each DC difference's
    /// size plus every AC token's size.
    fn amplitude_bits(s: &JpegState) -> u64 {
        let t = &s.encoded.as_ref().unwrap().trace;
        t.blocks
            .iter()
            .flatten()
            .map(|b| {
                jpeg::rle::size_category(b.dc_diff) as u64
                    + b.tokens.iter().map(|tk| tk.size as u64).sum::<u64>()
            })
            .sum()
    }

    #[test]
    fn code_bits_plus_amplitude_bits_make_the_payload() {
        for huffman in ["optimized", "standard"] {
            let mut c = cfg();
            c.huffman = huffman.into();
            let s = JpegRule.init(&c, 0);
            let v = JpegRule.summary(&s);
            let code = v["code_bits"].as_u64().unwrap();
            assert_eq!(
                code + amplitude_bits(&s),
                v["payload_bits"].as_u64().unwrap(),
                "{huffman}"
            );
            // It is the Huffman view's per-table `actual_bits`, summed.
            let tables = JpegRule.inspect(&s, "huffman");
            let viewed: u64 = tables
                .as_array()
                .unwrap()
                .iter()
                .map(|t| t["actual_bits"].as_u64().unwrap())
                .sum();
            assert_eq!(code, viewed, "{huffman}");
            // The codes alone sit at or above Shannon's bound for the symbols.
            assert!(
                code as f64 + 1e-6 >= v["entropy_bits"].as_f64().unwrap(),
                "{huffman}"
            );
        }
    }

    #[test]
    fn segments_view_walks_the_file() {
        let s = JpegRule.init(&cfg(), 0);
        let segs = JpegRule.inspect(&s, "segments");
        let kinds: Vec<&str> = segs
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v["kind"].as_str().unwrap())
            .collect();
        assert_eq!(kinds, ["Soi", "App0", "Dqt", "Sof0", "Dht", "Sos", "Eoi"]);
        let last = &segs.as_array().unwrap()[6];
        let bytes = JpegRule.bytes(&s).unwrap().len() as u64;
        assert_eq!(
            last["offset"].as_u64().unwrap() + last["len"].as_u64().unwrap(),
            bytes
        );
    }

    #[test]
    fn hints_point_inside_the_grid() {
        let s = JpegRule.init(&cfg(), 0);
        let v = JpegRule.summary(&s);
        for key in ["blocking", "bleed"] {
            let b = &v["hints"][key];
            assert!(
                b[0].as_u64().unwrap() < 32 && b[1].as_u64().unwrap() < 32,
                "{key}"
            );
        }
        let mut c = cfg();
        c.image_id = "text".into();
        let t = JpegRule.init(&c, 0);
        assert!(JpegRule.summary(&t)["hints"]["ringing"].is_array());
    }

    /// A config around a `w × h` picture of a deterministic pixel pattern.
    fn picture_cfg(w: usize, h: usize, subsampling: &str) -> JpegConfig {
        let mut c = cfg();
        let mut rgba = vec![255u8; w * h * 4];
        for (i, px) in rgba.chunks_mut(4).enumerate() {
            px[0] = (i * 7 % 256) as u8;
            px[1] = (i * 3 % 256) as u8;
            px[2] = (i * 11 % 256) as u8;
        }
        c.pixels = Some(Rgb8Image::new(w, h, rgba).unwrap());
        c.subsampling = subsampling.into();
        c
    }

    #[test]
    fn advance_to_moves_the_selection_to_the_last_scanned_mcu() {
        // 256² gradient at 4:2:0: 16 MCUs across, luma grid 32 × 32, chroma 16 × 16.
        let c = cfg();
        let mut s = JpegRule.init(&c, 0);
        // Start far from MCU 4, so the encoder's default block cannot already be in it.
        let far = json!({"kind": "select_block", "component": 0, "bx": 31, "by": 31});
        JpegRule.apply_action(&mut s, &c, &far).unwrap();
        JpegRule.advance_to(&mut s, &c, 0, 5); // MCU 4 = (4, 0)
        assert_eq!(
            s.selection,
            Selection {
                component: 0,
                bx: 8,
                by: 0
            }
        );
        let cb = json!({"kind": "select_block", "component": 1, "bx": 0, "by": 0});
        JpegRule.apply_action(&mut s, &c, &cb).unwrap();
        JpegRule.advance_to(&mut s, &c, 0, 18); // MCU 17 = (1, 1)
        assert_eq!(
            s.selection,
            Selection {
                component: 1,
                bx: 1,
                by: 1
            }
        );
    }

    #[test]
    fn a_block_already_in_the_current_mcu_is_kept() {
        let c = cfg();
        let mut s = JpegRule.init(&c, 0);
        let pick = json!({"kind": "select_block", "component": 0, "bx": 9, "by": 1}); // in MCU 4
        JpegRule.apply_action(&mut s, &c, &pick).unwrap();
        JpegRule.advance_to(&mut s, &c, 0, 5);
        assert_eq!(
            s.selection,
            Selection {
                component: 0,
                bx: 9,
                by: 1
            }
        );
        JpegRule.advance_to(&mut s, &c, 0, 6); // the scan moves on: MCU 5's first luma block
        assert_eq!(
            s.selection,
            Selection {
                component: 0,
                bx: 10,
                by: 0
            }
        );
    }

    #[test]
    fn advance_to_zero_leaves_the_selection() {
        let c = cfg();
        let mut s = JpegRule.init(&c, 0);
        let pick = json!({"kind": "select_block", "component": 0, "bx": 9, "by": 1});
        JpegRule.apply_action(&mut s, &c, &pick).unwrap();
        JpegRule.advance_to(&mut s, &c, 0, 0);
        assert_eq!(
            s.selection,
            Selection {
                component: 0,
                bx: 9,
                by: 1
            }
        );
    }

    #[test]
    fn the_follow_stays_on_the_grid_of_a_padded_picture() {
        // 24 × 10 at 4:2:0: 2 × 1 MCUs, the second one padded on the right and below.
        let c = picture_cfg(24, 10, "420");
        let mut s = JpegRule.init(&c, 0);
        let first = json!({"kind": "select_block", "component": 0, "bx": 0, "by": 0});
        JpegRule.apply_action(&mut s, &c, &first).unwrap();
        JpegRule.advance_to(&mut s, &c, 0, 2);
        assert_eq!(
            s.selection,
            Selection {
                component: 0,
                bx: 2,
                by: 0
            }
        );
        let cr = json!({"kind": "select_block", "component": 2, "bx": 0, "by": 0});
        JpegRule.apply_action(&mut s, &c, &cr).unwrap();
        JpegRule.advance_to(&mut s, &c, 0, 2);
        assert_eq!(
            s.selection,
            Selection {
                component: 2,
                bx: 1,
                by: 0
            }
        );
        JpegRule.advance_to(&mut s, &c, 0, 99); // clamped to the last MCU
        assert_eq!(
            s.selection,
            Selection {
                component: 2,
                bx: 1,
                by: 0
            }
        );
    }

    #[test]
    fn the_follow_clamps_a_runaway_step_to_the_last_mcu() {
        // 24 × 10 at 4:2:0: luma grid 4 × 2, the last MCU holds columns 2-3.
        let c = picture_cfg(24, 10, "420");
        let mut s = JpegRule.init(&c, 0);
        let first = json!({"kind": "select_block", "component": 0, "bx": 0, "by": 0});
        JpegRule.apply_action(&mut s, &c, &first).unwrap();
        JpegRule.advance_to(&mut s, &c, 0, 99);
        assert_eq!(s.n, s.total());
        assert_eq!(
            s.selection,
            Selection {
                component: 0,
                bx: 2,
                by: 0
            }
        );
    }

    #[test]
    fn a_padded_row_block_in_the_current_mcu_is_kept() {
        // (2, 1) is luma row 1 of MCU 1: the row that is partly padding.
        let c = picture_cfg(24, 10, "420");
        let mut s = JpegRule.init(&c, 0);
        let pick = json!({"kind": "select_block", "component": 0, "bx": 2, "by": 1});
        JpegRule.apply_action(&mut s, &c, &pick).unwrap();
        JpegRule.advance_to(&mut s, &c, 0, 2);
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
    fn a_failed_encode_leaves_the_selection_alone() {
        let c = picture_cfg(24, 10, "420");
        let original = JpegRule.init(&c, 0).original;
        let mut s = JpegState::failed(original, "no".into());
        let kept = Selection {
            component: 1,
            bx: 3,
            by: 2,
        };
        s.selection = kept;
        JpegRule.advance_to(&mut s, &c, 0, 3);
        assert_eq!(s.selection, kept);
    }

    #[test]
    fn at_444_each_step_is_one_block() {
        // 256² at 4:4:4: 32 MCUs across.
        let mut c = cfg();
        c.subsampling = "444".into();
        let mut s = JpegRule.init(&c, 0);
        let far = json!({"kind": "select_block", "component": 0, "bx": 31, "by": 31});
        JpegRule.apply_action(&mut s, &c, &far).unwrap();
        JpegRule.advance_to(&mut s, &c, 0, 3);
        assert_eq!(
            s.selection,
            Selection {
                component: 0,
                bx: 2,
                by: 0
            }
        );
    }
}
