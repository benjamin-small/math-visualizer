# JPEG Compression lab — Design

**Date:** 2026-10-15
**Status:** Approved (2026-10-15); amended by Plans 1, 2, 3 and 4 (see notes)
**Scope:** a fifth lab, `#/jpeg`: a new pure-Rust workspace crate `crates/jpeg` (a granular library of JPEG's parts plus a baseline codec built from them), stateless WASM bindings for those parts ("the kit"), a `jpeg` rule + WebGL2 visualization in `crates/viz-core`, two small generic engine additions, a Svelte lab page with an overview and nine stages, a home tile, docs.

## Amendment (Plan 1, 2026-10-15)

Prototyping the library before planning refined a few details, folded into the text below: `JpegError::Corrupt`; a pure `level_shift`; `HuffSpec`; `Segment.header_len`; `Decoded` without a trace; the decoder's per-sample clamp (without it the browser oracle's worst pixel was 23 levels off); a 16 MP decode cap; kit amplitude limits; `kit.ts` moving to slice 2; and the oracle tolerance set from measurement (max 3, mean 0.5).

## Amendment (Plan 2, 2026-10-16)

Building the engine lab and stages 1–4 settled these, folded into the text below:

1. Quality, subsampling and Huffman changes re-encode through a rule-config push with the image (`update_rule_config_with_image`); the page then restores the scan position (`JumpTo` the same share) and resumes playing if it was playing. Only `select_block` is a rule action, which keeps the engine's state from drifting away from its config (the engine re-inits state from the config on every push).
2. The rule's capabilities are scrubbable but not cheap to recompute, so Reset, Back and scrubbing move the cursor without re-encoding.
3. The viz config is panels-based: `panels: [{ kind, rect, crop? }]` in device pixels, drawn in order; the `image_rect` / `focus_rect` / `aux_rect` / `stage` fields are dropped and the page decides what goes where.
4. Plane panels take an optional `crop` (image pixels); the Subsample stage magnifies a 32 px window around the selected block so chroma's blocks are visible at all.
5. The first selection is the luma block with the most AC energy, so every stage opens on a block with detail.
6. The bundled public-domain photo and the home tile, nav link and README lab entry move to Plan 4, and so do the Color stage's per-plane rebuild toggles. `#/jpeg` works but is unlinked until then.
7. The rail shows all nine stages; 5–9 are disabled until their plans land.
8. The Color stage's formula is the static matrix, because the summary carries only the selected component's samples and there is no per-pixel RGB to plug in.
9. `kit.ts` is still deferred: the DCT stage calls the three kit functions it needs (`jpeg_zigzag_order`, `jpeg_dct_1d`, `jpeg_dft_1d`) through `loadVizCore()` directly, and a wrapper lands when more stages need the kit.
10. Review decisions: the lab's image panel takes arrow keys to move the selected block (keyboard access), and quality changes coalesce to one re-encode per animation frame, with the share link written when the slider is released.

## Amendment (Plan 3, 2026-10-16)

Building stages 5–9 settled these, folded into the text below:

1. Edited quantization tables travel in the rule config as `tables: [luma[64], chroma[64]] | null` (row-major, 1–255). There is no `set_tables` action: Plan 2's amendment 1 applies. A table that is not 64 entries becomes the summary's `error`; the config push itself succeeds.
2. `rule_inspect("huffman")` returns four tables in the order `dc_luma`, `ac_luma`, `dc_chroma`, `ac_chroma`, each `{ name, bits, vals, codes: [{symbol, code}], counts: [[symbol, count]], entropy_bits, actual_bits }`. `rule_inspect("segments")` returns `[{ marker, kind, offset, len }]`. The tree is drawn from `bits`/`vals` with the kit's `jpeg_huffman_tree`. `"histogram"` is dropped.
3. The summary's selected block spells out its bits: `dc_size`, `dc_code`, `dc_amp_bits`, and per token `code` and `amp_bits`. Concatenated in order they equal `bits`. The summary also carries `code_bits` (Σ symbol count × code length over the four Huffman tables, amplitude bits excluded, computed once per encode), so `payload_bits` = `code_bits` + amplitude bits, and `code_bits` is the figure to compare with `entropy_bits`.
4. The summary carries `hints: { blocking, ringing | null, bleed }` (luma block coordinates), computed in Rust once per encode. *Blocking* is the block whose right or bottom border has the largest mean \|decoded step − original step\|; only borders with a neighbouring block count. *Ringing* is, among blocks with an original luma step above 64, the one with the largest mean luma error; it is `null` when no block has such an edge. *Bleed* is the block with the largest mean Cb + Cr error.
5. The zigzag path animates in the viz: it advances at `zigzag_speed` cells per second and restarts when the encode or the selection changes. The page reads it back through `viz_readout() → { zigzag }`, because pushing viz config every frame would reset the engine's frame clock.
6. Viz config gains `zigzag_speed` (default 24), `wipe` (0.5) and `error_gain` (4). The new panel kinds are `quant`, `dequant_rebuild`, `zigzag`, `wipe` and `error`.
7. Page layout: `StageLayout.extra` becomes `slots: Partial<Record<SlotName, Rect>>`, named DOM areas `charts`, `qtable`, `rd`, `sequence`, `tokens`, `huffman`, `resave`. A panel caption may run 120 px (`CAPTION_MIN`) wide over a narrower panel, so slots start clear of it.
8. Page-side encodes: the R–D curve (`jpeg_encode_stats`, q = 1…100, up to 4 per frame within an ~8 ms frame budget, cached per picture × subsampling × Huffman mode) always uses the quality-scaled tables. "Re-save" is a fixed 20 generations (`jpeg_encode_decode`, one per frame), not a choice of N. The Huffman stage's "with the other tables" size is one more `jpeg_encode_stats` and is hidden while custom tables are in use.
9. Custom tables last until "Standard" is pressed, across pictures and settings, and are not in the share link. While they are in use a "Custom Q tables" chip with a "Standard" button shows in the readout row on every stage, Re-save is disabled (it re-encodes with the quality-scaled tables) with a note to press Standard first, and Save .jpg names the file `jpeg-lab-custom-<subsampling>.jpg`.
10. Stage contents: Quantize shows the decoder's rebuilt block, and the zero count lives on the Zigzag stage ("then N zeros"). The Huffman stage shows each symbol's code in the histogram's tooltips and on the tree's leaves instead of a separate code table. On a phone-width stage the Q-table editor is hidden (its column is under 120 px); the hover formula still names each entry. The Decode tools fit short stages and scroll, and the zigzag strip scrolls rather than clipping its zero tail. Mobile polish moves to Plan 4.

## Amendment (Plan 4, 2026-10-16)

The gallery and overview are specified in [`2026-10-16-jpeg-lab-gallery-design.md`](2026-10-16-jpeg-lab-gallery-design.md) and implemented on the `jpeg-lab-gallery` branch. These decisions are folded into the text below:
11. **The overview is stage 0.** The rail reads "0 · Overview" before Color, `overview` is the default `stage`, and the arrow keys reach it. It shows the original and the decoded JPEG side by side (live with quality, subsampling and Huffman), raw against JPEG bytes as two bars to scale with a ratio, three byte histograms with their Shannon entropy, the picture gallery with Upload, credits for bundled pictures, and a way into stage 1. The encode is shown finished: no scan animation or dimming. On narrow stages the three histograms stack one per row. The load alert sits at the top of the stats area rather than over the canvas. The current picture's credit also shows in the story column under the notice, so it never depends on how much room the stage has; the block-picking area is off on the overview, where there is no block to pick.
12. **Eleven pictures**, ids used verbatim in Rust, TypeScript and the share link, in gallery order: photos `spring`, `shuttle`; memes `doge`, `honest-work`, `cartoon`; maths `cosines`, `cosines-shifted`, `noise`; tests `gradient`, `text`, `bars`. The default is `spring` (it replaces the gradient). `img` and `stage` are omitted from the link when they are the defaults. A link without `img=` opens the spring; a link naming any id, including `gradient`, is unchanged. An uploaded picture is written to the link as `img=gradient`, outright: it is not the default, so a bare link would open the spring instead. If the very first picture fails to load, the lab falls back to the generated gradient and shows the alert, and the address keeps naming the picture that was asked for. The first picture's fetch starts when the page does, in parallel with the WASM load, and until it is in nothing is drawn and no readout shows.
13. **Picture select.** A compact "Picture" select in the bezel, on every stage including the overview, replaces the row of image buttons, with Upload beside it. The full thumbnail gallery, with the credits, is on the overview. Changing picture keeps the current stage, re-encodes and writes `img=` into the link. A bundled picture that fails to load leaves the current one in place with an inline error, and the select keeps showing the picture in use. A shared `b=` block is clamped to the new picture's own block grid.
14. **Three histograms**, each with its entropy in bits per byte: the raw RGB samples (`w·h·3`, no alpha); the neighbour differences (each sample minus the same channel of its left neighbour, mod 256); and the whole JPEG file, headers included. The maths is in `web/src/lib/jpeg/bytes.ts`. At q50 the spring reads about 7.77 / 5.66 / 7.95.
15. **New panel kinds `original` and `decoded`**: the picture and its decoded JPEG drawn undimmed, for the overview.
16. **Three maths pictures**, generated in Rust and deterministic (the noise uses a fixed seed), 256 × 256. *Made of cosines* is one DCT basis pattern per 8 × 8 block, aligned to the grid (about 2.5 KB at q50). *Cosines, shifted 4 px* is the same pattern offset by 4 px in x and y (about 17 KB, roughly 7 times larger). *Pure noise* has PSNR near 12 dB at every quality. The pictures are labelled "Made of cosines", "Cosines, shifted 4 px" and "Pure noise".
17. **Bundled PNGs** live in `web/public/jpeg/` (spring, shuttle, doge, honest-work, cartoon, each at most 150 KB, with `CREDITS.md`). They load from `${import.meta.env.BASE_URL}jpeg/<id>.png`, so they work under the GitHub Pages base path, and are never fetched from Wikimedia at run time. spring and shuttle are 256 × 256, doge 272 × 320, honest-work 320 × 203 and cartoon 320 × 240. Credits are on the overview and in the README. The scripts that regenerate them are in `scripts/jpeg-gallery/`.
18. **Gallery thumbnails.** Bundled pictures are the PNGs scaled in CSS. For generated pictures the pattern ones (cosines, cosines-shifted, noise, text) show a 1:1 centre window, because fine patterns alias when scaled; gradient and bars are scaled. Only the default picture loads up front; thumbnails load lazily.
19. **Delivery item 4 is split.** This gallery is the first part (the photo becomes a gallery). The home tile, nav link, README lab entry, the Color stage's Y-only and chroma-only toggles, the five-tile home grid and mobile polish move to the next plan. The home tile keeps the gradient until then.

## Summary

A learning tool that follows one image, and one 8×8 block of it, through every step of baseline JPEG and back: colour transform, chroma subsampling, blocking, the 2D DCT, quantization, zigzag, run-length coding, Huffman coding, and decoding. The maths is the point: every stage shows its formula with live numbers for the selected block, and every stage's visual is the maths made visible (a rotating colour cube, the 64 cosine basis patterns, a block rebuilt term by term, a rate–distortion curve, a Huffman code tree, the exact bits a block became).

The codec is not a black box. `crates/jpeg` is a **library of parts**: every stage is a free, pure function with an inverse, so the UI (and tests) can pull any single piece out and run a small experiment with it: zero one DCT coefficient, edit one Q-table cell, build a Huffman tree for one block's symbols. The full encoder and decoder are just one composition of those parts, and they produce real `.jpg` bytes the browser can open.

## Goals

1. A granular, natively tested Rust library covering every baseline JPEG stage in both directions, exposing its constants and intermediate values.
2. A baseline JFIF encoder/decoder composed from it, whose output the browser's own decoder accepts and agrees with (the test oracle).
3. A lab page with a pipeline rail of an overview and nine stages (0 Overview · 1 Color · 2 Subsample · 3 Blocks · 4 DCT · 5 Quantize · 6 Zigzag · 7 Run-length · 8 Huffman · ⟲ Decode); the image and a selected block carry across every stage.
4. Live controls: quality 1–100, subsampling 4:4:4 / 4:2:2 / 4:2:0, Huffman tables optimized / standard; changes reshape every view without restarting the scan.
5. A gallery of eleven pictures (two photos, three memes, three maths pictures and the three artifact tests), each chosen to teach something about compression, plus upload of your own image (amendment 12).
6. A home tile, a share link, a Save .jpg button.

## Non-goals

- Progressive JPEG, arithmetic coding, restart intervals (DRI/RSTn), 12-bit precision, CMYK, EXIF/ICC handling. The decoder reports these as `Unsupported(kind)`. Each is a clean follow-up on the same modules.
- An animated, stage-by-stage decoder walk. Decode is one screen; each inverse is already shown in the stage that owns it.
- Sharing uploaded images through the link (the link names the generated gradient instead, as `img=gradient`).
- Changing other labs' behaviour. Shared-code changes are limited to the two generic engine hooks below, a new `render/texture_quad.rs`, and the home grid growing to five tiles.

## Decisions

- **Approach A (approved): a Rust library is the single source of truth.** WebGL draws the pixel-heavy views; HTML/SVG overlays draw everything that is text (numeric grids, tokens, the code tree, bit strings). Rejected: a TypeScript codec with Canvas2D (drops the project's Rust → WASM → WebGL backbone), and a Rust codec with all-Svelte visuals and no engine (no clock line, no live home tile, unlike the other labs).
- **The library is granular, not just a codec** (user requirement). No stage reads hidden state; whatever a stage needs from another (previous DC, a Q table, Huffman tables) is an explicit argument.
- **A separate crate**, `crates/jpeg` (package and lib name `jpeg`), with no `web-sys`, `wasm-bindgen` or GL dependency, so it builds and tests natively and its boundaries are enforced by the compiler. `viz-core` depends on it by path; there is still one WASM package.
- **Full codec now** (user choice), including optimized Huffman tables and a JFIF writer/parser.
- **Stage stepper** (user choice) rather than a dashboard or scroll story.
- **Built-ins + upload** (user choice); no paintable block.
- **The engine clock counts MCUs scanned.** Play walks the scan across the image; views fill in behind it; the clock line completes when the bitstream does.
- Generated pictures are 256×256; bundled pictures are 256×256 (photos) or up to 320 px on the long side (memes); uploads are downscaled to fit 512×512.

## Part 1 — `crates/jpeg`: the library of parts

### Data types

- `Block = [f32; 64]` (row-major, `x + 8y`) for pixel and coefficient values; `QBlock = [i32; 64]` for quantized values; `Table = [u16; 64]` for quantization tables (row-major).
- `Plane { w: usize, h: usize, data: Vec<f32> }`; `Rgb8Image { w, h, rgba: Vec<u8> }`.
- `Subsampling::{S444, S422, S420}` with `factors() -> (h, v)` for luma = (1,1) / (2,1) / (2,2); chroma always (1,1).
- `Component::{Y, Cb, Cr}`.
- `JpegError::{BadLength { expected, got }, BadDimensions, Truncated, BadMarker(u8), BadHuffmanCode, Corrupt(&'static str), Unsupported(&'static str)}`. Functions that take outside input return `Result<_, JpegError>`; nothing panics on malformed input.

### Modules (each: forward, inverse, and the extra handles experiments need)

| Module | Forward / inverse | Exposed for experiments |
|---|---|---|
| `color` | `rgb_to_ycbcr(r,g,b) -> [f32;3]` / `ycbcr_to_rgb`; `split_planes(&Rgb8Image) -> [Plane;3]` / `merge_planes` (clamps, rounds) | `RGB_TO_YCBCR: [[f32;3];3]`, `YCBCR_OFFSET: [f32;3]` and the inverse matrix (JFIF full-range BT.601: Y = .299R + .587G + .114B; Cb = −.168736R − .331264G + .5B + 128; Cr = .5R − .418688G − .081312B + 128) |
| `sampling` | `downsample(&Plane, Subsampling) -> Plane` (box average) / `upsample(&Plane, Subsampling, Upsample, w, h)` | `Upsample::{Nearest, Fancy}`: `Nearest` for the "see the chroma blocks" view; `Fancy` is libjpeg's triangle filter, used by the decoder so it matches browser decoders |
| `blocks` | `pad(&Plane, mcu_w, mcu_h) -> Plane` (edge replication) / `crop`; `to_blocks(&Plane) -> Vec<Block>` / `from_blocks`; `level_shift(&Block) -> Block` (−128) / `unshift` | `block_grid(w, h) -> (cols, rows)`; `mcu_layout(Subsampling, w, h)` listing, per MCU, the (component, block index) pairs in scan order |
| `dct` | `fdct(&Block) -> Block` / `idct(&Block) -> Block` (separable, precomputed cosine table, orthonormal DCT-II with C(0) = 1/√2) | `cos_table() -> [[f32;8];8]`; `basis(u, v) -> Block`; `idct_partial(&Block, k) -> Block` (first k coefficients in zigzag order); `energy(&Block) -> f32`; `dct_1d` / `idct_1d` / `dft_1d` on `[f32; N]`; `extend_periodic` / `extend_mirrored` for the "why cosines" demo |
| `quant` | `quantize(&Block, &Table) -> QBlock` (round half away from zero) / `dequantize` | `STD_LUMA`, `STD_CHROMA` (ITU T.81 Annex K, Tables K.1/K.2); `scale_table(&Table, quality) -> Table` (IJG: q < 50 → s = 5000/q, else s = 200 − 2q; entry = clamp((base·s + 50) / 100, 1, 255)) |
| `zigzag` | `to_zigzag(&QBlock) -> [i32;64]` / `from_zigzag` | `ZIGZAG: [u8; 64]` (zigzag index → row-major index) and its inverse |
| `rle` | `dc_diff(prev, dc) -> i32` / `dc_undiff`; `ac_symbols(&[i32;64]) -> Vec<AcToken>` / `ac_expand` | `size_category(v) -> u8` (bits needed for \|v\|); `amplitude_bits(v) -> (u16, u8)` / `from_amplitude_bits`; `AcToken { run, size, amp }`, with `ZRL` (15,0) and `EOB` (0,0) explicit; `symbol(run, size) -> u8` |
| `huffman` | `encode_symbol(&mut BitWriter, &HuffTable, sym)` / `decode_symbol(&mut BitReader, &HuffDecoder)` | `count_frequencies`; `optimal_lengths(&[u32; 256]) -> HuffSpec` (Annex K.2, codes ≤ 16 bits, all-ones code reserved); `HuffSpec { bits: [u8;16], vals: Vec<u8> }` (the DHT form); `canonical_codes(&HuffSpec) -> HuffTable`; `tree(&HuffSpec) -> Vec<TreeNode>` (nodes with depth, code, symbol, for drawing); `STD_DC_LUMA`, `STD_AC_LUMA`, `STD_DC_CHROMA`, `STD_AC_CHROMA` (Annex K.3) |
| `bits` | `BitWriter` (MSB-first, 0xFF → 0xFF 0x00 stuffing, pad with 1s) / `BitReader` (unstuffs, stops at markers) | `mark()` / `span_since(mark) -> BitSpan { start_bit, len }` so every block records its exact range |
| `jfif` | `write_segments(&Frame) -> Vec<u8>` / `parse_segments(&[u8]) -> Vec<Segment>` | `Segment { marker, kind, offset, header_len, len }` for SOI, APP0, DQT, SOF0, DHT, SOS (+ scan data), EOI; unknown APPn/COM skipped and listed |
| `codec` | `encode(&Rgb8Image, &Options) -> Encoded` / `decode(&[u8]) -> Result<Decoded, JpegError>` | `Options { quality, subsampling, huffman: Optimized \| Standard, tables: Option<[Table;2]> }`; `Encoded { bytes, trace }`; `Trace` holds every intermediate: the three planes, subsampled chroma, per-block DCT / quantized / DC prev and diff / AC tokens / bit span / MCU (raw samples come from `Trace::pixels(c, bx, by)`; the shifted block is `level_shift` of that and the zigzag block is `to_zigzag(&quant)`, both derived on demand rather than stored), the tables used, Huffman specs and frequencies, segment list. `Decoded { image, planes }` (the encoder's `Trace` already holds every intermediate). The decoder rounds and clamps each IDCT sample to 0–255 before upsampling and colour conversion, as libjpeg does, and refuses frames over 16 MP |
| `metrics` | — | `mse`, `psnr` (on RGB), `error_plane(a, b) -> Plane` (per-pixel mean \|Δ\|), `entropy_bits(&[u32]) -> f64` (Shannon bound for a symbol histogram) |

The codec supports 1 or 3 components (grayscale input is encoded as one component); the lab always uses 3.

## Part 2 — across the WASM boundary

### Generic engine additions (`crates/viz-core`)

- `Rule::apply_image(&self, cfg: &mut Config, w: u32, h: u32, rgba: &[u8]) -> bool` (default `false`) backing `Engine::update_rule_config_with_image(cfg, w, h, rgba: &[u8])`, the same shape as `apply_path` / `update_rule_config_with_path`. The image never crosses as JSON.
- `Rule::inspect(&self, state, key: &str) -> serde_json::Value` (default `Null`) backing `Engine::rule_inspect(key)`: on-demand, larger views that do not belong in the per-frame summary.
- `Rule::bytes(&self, state) -> Option<Vec<u8>>` (default `None`) backing `Engine::rule_bytes() -> Option<Uint8Array>` for Save .jpg.

### The `jpeg` lab (rule `rules/jpeg.rs`, viz `visualizations/jpeg.rs`, registered in `engine/registry.rs`)

- **Rule config** (a push re-encodes and resets playback, existing behaviour): `{ image_id: String, quality: u8 (1–100, default 50), subsampling: "444" | "422" | "420" (default "420"), huffman: "optimized" | "standard" (default "optimized"), tables: [[u16; 64]; 2] | null (edited luma and chroma Q tables, default null), max_iterations }`, every field `#[serde(default)]`. The pixels arrive through `apply_image`; without them the rule encodes a built-in generated in Rust (so the home tile and wasm tests need no JS).
- **State:** the `Encoded` trace, `n` (MCUs scanned), the selection `{ component, bx, by }`, and a `version: u32` bumped on every re-encode.
- **Clock:** `advance_to(n)` stores `n`; capabilities scrubbable but not cheap to recompute (Reset, Back and scrubbing move the cursor without re-encoding); `max_iterations` = MCU count, so playback auto-pauses at the end and the clock line reads scan progress.
- **Actions (`rule_action`, no playback reset):** settings arrive in rule-config pushes; `select_block` is the only action.
- **`rule_summary()`** (read every frame, kept small): `{ version, n, total, width, height, bytes, raw_bytes, bits_so_far, payload_bits, entropy_bits, psnr, quality, subsampling, mcu: [mcu_w, mcu_h, cols, rows], grids: [[cols, rows] per component], error, selected: { component, bx, by, mcu, pixels[64], shifted[64], dct[64], quant[64], table[64], zigzag[64], dc_prev, dc_diff, tokens[{ run, size, amp, symbol, code, amp_bits }], dc_size, dc_code, dc_amp_bits, bit_span, bits: String }, hints: { blocking, ringing | null, bleed } }`. `quality` and `subsampling` echo the encoded options, `psnr` is `null` when infinite, and `error` carries the encode failure message if any. JS parses with loose `== null` checks (wasm-bindgen sends `None` as `undefined`).
- **`rule_inspect(key)`**, called when a stage opens or `version` changes. `"huffman"` → four tables in the order `dc_luma`, `ac_luma`, `dc_chroma`, `ac_chroma`, each `{ name, bits, vals, codes: [{symbol, code}], counts: [[symbol, count]], entropy_bits, actual_bits }` (the tree is drawn from `bits`/`vals` with the kit's `jpeg_huffman_tree`); `"segments"` → `[{ marker, kind, offset, len }]`; `"tables"` → both scaled Q tables.
- **Built-in generators** (Rust, `viz-core/src/jpeg_images.rs`, shared by the rule, the kit and the tests): `gradient` (smooth sky → shows blocking), `text` (sharp black-on-white lines and glyph-like strokes → shows ringing), `bars` (saturated colour bars and a colour wheel → shows chroma bleed). Plan 4 adds the maths pictures `cosines`, `cosines-shifted` and `noise` (amendment 16). The photos and memes are bundled PNGs under 150 KB in `web/public/jpeg/` (amendment 17), loaded by JS and pushed through `apply_image`.

### The kit (`viz-core/src/jpeg_kit.rs`; the `web/src/lib/jpeg/kit.ts` wrapper is deferred)

Stateless `#[wasm_bindgen]` free functions mirroring the crate one-to-one with typed arrays: `fdct`, `idct`, `idct_partial`, `basis`, `dct_1d`, `dft_1d`, `quantize`, `dequantize`, `scale_table`, `std_table`, `to_zigzag`, `from_zigzag`, `ac_symbols`, `size_category`, `amplitude_bits`, `optimal_lengths`, `huffman_tree`, `rgb_to_ycbcr`, `builtin_image(id, w, h)`, `encode_stats(rgba, w, h, opts) -> { bytes, psnr }` and `encode_decode(rgba, w, h, opts) -> rgba` (for the R–D sweep and generation loss). Each checks argument lengths (and amplitudes within ±32767) and returns a `JsError` rather than panicking. A TypeScript wrapper `kit.ts` giving each a typed signature is deferred until more stages need the kit (amendment 9): the DCT stage calls `jpeg_zigzag_order`, `jpeg_dct_1d` and `jpeg_dft_1d` through `loadVizCore()` directly.

### The visualization (`JpegViz`)

- Draws a `panels` list pushed by JS: `[{ kind, rect, crop? }]` in device pixels, drawn in order, `#[serde(default)]` (empty → the viz fits the image to the canvas itself; the home tile and wasm tests rely on this). Plane panels take an optional `crop` in image pixels. Reads `gl.drawing_buffer_width()/height()` every frame.
- **Viz config:** the `panels` list (with `crop`), `cube_mix` (0 = RGB axes … 1 = YCbCr axes), `dct_k` (0–64), `hover: Option<[u32;2]>`, `dim` (brightness of the not-yet-scanned image, 0–1), `accent` and `grid` colours, `background`, `auto_rotate_speed`; `zigzag_speed` (cells per second, default 24), `wipe` (0–1, default 0.5) and `error_gain` (default 4). The panel kinds are the Plan 2 ones plus `quant`, `dequant_rebuild`, `zigzag`, `wipe` and `error`. The zigzag path animates in the viz and restarts when the encode or the selection changes; the page reads its position back through `viz_readout() → { zigzag }` rather than pushing config every frame. `init` only (re)creates resources; it never resets the camera.
- **New renderer** `render/texture_quad.rs`: draws an RGBA8 texture into a pixel rect with nearest or linear filtering and a `dim` factor that darkens it (there are no R8 textures and no colour maps: the viz turns samples into RGBA itself, grey for luma and tinted for chroma). Textures re-upload only when the encode's summary `version` changes, not when the selection moves.
- **Reused renderers:** `InstancedQuads` (8×8 cell grids, heatmaps, the basis atlas cells), `LineBatch` (block grid, MCU outlines, scan front, zigzag snake), `Camera3D` + `LineBatch3D` + `InstancedPoints3D` (the colour cube: up to 4096 sampled pixels as a point cloud, cube edges and axes interpolated from RGB to YCbCr by `cube_mix`; auto-rotate and drag-to-orbit as in Sierpinski).
- Scan progress: blocks beyond MCU `n` are drawn dimmed in every image view; the current MCU gets the terracotta outline.

### Overlays (Svelte DOM/SVG over the canvas, pointer-events where interactive)

Numeric 8×8 grids, the KaTeX formula panel (KaTeX is already a dependency, lazily loaded), AC token chips, the SVG Huffman tree, the coloured bit string, the JFIF byte bar, the R–D and generation-loss charts (SVG).

## Part 3 — the page

### Frame

- `LabShell labId="jpeg" title="JPEG Compression"`. Bezel, in order: Picture select (all eleven pictures, with Upload, amendment 13), Quality linear slider 1–100 with mono readout, Subsampling radio (real `type="radio"` inputs drawn as pills, Notes-lab pattern), Huffman radio (Optimized / Standard), scan Play/Pause + Reset, Save .jpg.
- **Pipeline rail** under the bezel: the overview (step 0) and nine numbered steps, the current one marked (`aria-current="step"`); click or ←/→ (when focus is not in a text field). Each step has a one-line subtitle.
- **Readout strip:** `18.4 KB of 192 KB · 10.4 : 1 · 2.30 bits/px · PSNR 34.1 dB`.
- **Stage area:** landscape (canvas at least 640 px wide, `PORTRAIT_BELOW` in `web/src/lib/jpeg/layout.ts`) → the image at the left (up to 45% of the width), the stage's focus panels to its right; narrower → the image on top (42% of the height), focus below. The page turns this into the viz's `panels` list; the rects come from `web/src/lib/jpeg/layout.ts` and are pushed like the Notes lab's (`ResizeObserver` + window-resize fallback + once in `onReady`). Clicking the image selects a block in every stage.
- **Formula panel** per stage with live numbers for the selected block or hovered cell, and a short "Notice" paragraph. The article below holds "How it works" for the whole pipeline.

### Stages

1. **Color.** Point cloud of the image's pixels in the colour cube; a slider turns the axes from RGB to YCbCr (the cube visibly rotates so the grey diagonal becomes Y). The Y, Cb, Cr planes in a row below the cube; the per-plane toggles (the image rebuilt from Y only or chroma only) move to the next plan. Formula: the static 3×3 matrix (amendment 8). *Notice:* Y looks like the photo; Cb and Cr are flat and soft.
2. **Subsample.** Cb and Cr at full resolution beside the subsampled planes (nearest upsampling, so the blocks show); the image recomposed with the chosen mode; "samples kept: 100 % / 67 % / 50 %". *Notice:* half the data gone, almost invisible.
3. **Blocks.** Block grid and MCU outlines over the image; the selected block as 8×8 numbered cells with a −128 shift toggle; a component switch Y / Cb / Cr (chroma shows the block covering the selection). Formula: f(x, y) − 128.
4. **DCT.** The 64-pattern basis atlas; the selected block's coefficients as a diverging heatmap with numbers. Hover a coefficient → its basis pattern lights and the formula shows F(u, v) with the block's actual sum. A *k* scrubber (0–64) rebuilds the block from the first *k* zigzag terms beside its shrinking error. An energy-compaction curve (cumulative energy by zigzag index). **Why cosines?** side panel: one row of the block, its periodic extension (DFT, a jump at the seam) vs its mirrored extension (DCT, smooth), and the number of terms each needs for 95 % of the energy. Formula: the 2D DCT-II.
5. **Quantize.** The scaled Q table (cells editable; "Apply to image" sends `tables` in the rule config; "Standard" restores), coefficients before → after, the block the decoder rebuilds. The rate–distortion curve (bytes vs PSNR for q = 1…100 via `encode_stats`, computed 4 points per frame and cached per image × subsampling × huffman) with a "you are here" dot. Formula: F_Q(u, v) = round(F(u, v) / Q(u, v)) and the IJG scaling.
6. **Zigzag.** The snake path animated over the quantized grid; the 1D sequence below with the zero tail highlighted and "last non-zero: #9 of 64". Formula: the index mapping.
7. **Run-length.** DC: this block's DC, the previous block's, their difference. AC: `(run, size) amplitude` token chips with ZRL and EOB; hover a token → its size category and amplitude bits. Formula: size = ⌈log₂(\|v\| + 1)⌉.
8. **Huffman.** Tabs DC/AC × luma/chroma: symbol frequency histogram, the SVG code tree with each code on its leaf and in the histogram's tooltips; the selected block's bits coloured by token; the JFIF byte bar (SOI APP0 DQT SOF0 DHT SOS … EOI, widths to scale); Shannon bound vs actual bits; Optimized ↔ Standard shows the size change. Formula: code length ≈ −log₂ p.
9. **Decode.** Original vs reconstruction with a wipe slider; the error heatmap (gain slider); PSNR. Three artifact hints, each selecting the block where it is worst: *blocking* → the luma block whose right or bottom border has the largest mean \|decoded step − original step\| (only borders with a neighbouring block count); *ringing* → among luma blocks with an original luma step above 64, the one with the largest mean luma error (disabled when no block has such an edge); *chroma bleed* → the block with the largest Cb + Cr error. **Re-save ×20** (via `encode_decode`, one generation per frame): generation loss as a PSNR-per-generation chart. The error map's gain defaults to 4. Formula: MSE and PSNR = 10 log₁₀(255² / MSE).

### Share link, tile, download, upload

- **Link:** `#/jpeg?img=gradient&q=50&s=420&h=opt&stage=dct&b=12,7` (sanitised; canonical rewrite on load; `img` defaults to `spring` and `stage` to `overview` and are omitted when default; uploads still fall back to `gradient`; `buildQuery` keeps raw commas as in the Notes lab).
- **Home tile:** `gradient` at q = 50 scanning; readout "41 % scanned · 18.4 KB"; `done` when `n == total`; `progress = n / total`. The home grid grows to five tiles (layout set in slice 4).
- **Save .jpg:** `engine.rule_bytes()` → Blob → download `jpeg-lab-q50-420.jpg`.
- **Upload:** file input and drag-and-drop on the stage; decoded with `createImageBitmap`, downscaled to fit 512×512 on a DOM canvas (painted white first, so transparent areas are not black; no `OffscreenCanvas`), pushed through `update_rule_config_with_image`. A failure shows an inline message and keeps the current image.

## Error handling and performance

- Every external input (kit arguments, uploaded files, foreign JPEG bytes) is validated; errors are typed `JpegError`s turned into `JsError`s at the boundary. Odd image sizes are edge-padded to the MCU and cropped on decode.
- Targets (release wasm): encode 256² in < 10 ms, 512² in < 40 ms; the R–D sweep and Re-save run incrementally across frames so the UI never blocks.

## Testing

- **Rust, `crates/jpeg` (native):**
  - round trips: colour within ±1 per channel; `idct(fdct(b)) ≈ b` within 1e-3; `from_zigzag(to_zigzag(q)) == q` and `ZIGZAG` is a permutation; `ac_expand(ac_symbols(z)) == z` including ZRL runs; `dc_undiff(dc_diff)`; amplitude bits; `BitWriter`/`BitReader` with stuffing; `pad`/`crop`, `to_blocks`/`from_blocks`.
  - invariants: `optimal_lengths` ≤ 16 bits, Kraft sum < 1 (all-ones reserved), canonical codes prefix-free; `scale_table` clamps to 1..=255 and q = 50 returns the base table; `basis` patterns orthonormal.
  - golden values: the classic textbook 8×8 block (Wikipedia "JPEG" example) with its published DCT coefficients and quantized values at q = 50; the Annex K standard Huffman tables rebuilt from BITS/HUFFVAL match the published codes.
  - end to end: PSNR non-decreasing in quality across q ∈ {10, 30, 50, 70, 90}; q = 100 with 4:4:4 gives PSNR > 45 dB; `parse_segments(encode(..))` lists SOI, APP0, DQT, SOF0, DHT, SOS, EOI in order; decode(encode(img)) for 1 and 3 components, every subsampling, odd sizes; malformed inputs (truncated, bad marker, progressive SOF2) return the right `JpegError`.
  - randomized blocks and images use the repo's deterministic `splitmix64` approach; no new test dependencies.
- **WASM browser (`crates/viz-core/tests/wasm.rs`):** the **browser-decoder oracle**: for the three generated built-ins × every subsampling × q ∈ {10, 50, 90}, decode our bytes with `createImageBitmap` and compare with our `decode`: max \|Δ\| ≤ 3 and mean \|Δ\| ≤ 0.5 per channel in every mode (measured on Chrome 155: max 3, mean ≤ 0.37; the 128×128 and 99×61 sizes are both checked). Plus: lab construction, `update_rule_config_with_image`, actions keep `n`, `rule_inspect` keys, `rule_bytes`, rendering every stage without GL errors.
- **Web (Vitest):** URL params, `layout.ts`, summary/inspect parsing, upload downscale maths, and a `JpegLab` component test against `FakeEngine` (stage switching, rail keyboard, bezel controls dispatch the right actions); `App`, `Home` and router tests updated for five labs (the next plan). A `kit.ts` wrapper test lands with the wrapper (amendment 9).
- **Browser:** every stage in light and dark at 1440 and 375 px via the capture script, plus the home tile.

## Delivery

Four PRs into protected `main`, each green on `cargo fmt --all --check`, `cargo clippy --all-targets --all-features`, `cargo test --all-features`, the wasm tests and the web tests:

1. **`crates/jpeg` + the kit + the oracle test.** The library is complete and proven before any UI exists.
2. **The engine lab + stages 1–4:** the generic engine hooks, the rule, `JpegViz`, `texture_quad`, the page frame (bezel, rail, readout, layout) and Color, Subsample, Blocks, DCT.
3. **Stages 5–8 + Decode:** quantization with editable tables and the R–D curve, zigzag, run-length, Huffman tree and byte bar, decode with wipe, error map and generation loss.
4. **The photo, the Color stage's Y-only and chroma-only toggles, home tile, nav link, share links, README, story and the five-tile home grid.** Split by Plan 4 (amendment 19): the gallery (overview, eleven pictures, Picture select, share-link defaults) ships first; the home tile, nav link, README lab entry, Color toggles, five-tile grid and mobile polish follow in the next plan.

Within slices 2 and 3, Rust and web pieces run as parallel subagents on disjoint files.
