# JPEG Compression lab — Design

**Date:** 2026-10-15
**Status:** Approved (2026-10-15); amended by Plans 1 and 2 (see notes)
**Scope:** a fifth lab, `#/jpeg`: a new pure-Rust workspace crate `crates/jpeg` (a granular library of JPEG's parts plus a baseline codec built from them), stateless WASM bindings for those parts ("the kit"), a `jpeg` rule + WebGL2 visualization in `crates/viz-core`, two small generic engine additions, a Svelte lab page with a nine-stage stepper, a home tile, docs.

## Amendment (Plan 1, 2026-10-15)

Prototyping the library before planning refined a few details, folded into the text below: `JpegError::Corrupt`; a pure `level_shift`; `HuffSpec`; `Segment.header_len`; `Decoded` without a trace; the decoder's per-sample clamp (without it the browser oracle's worst pixel was 23 levels off); a 16 MP decode cap; kit amplitude limits; `kit.ts` moving to slice 2; and the oracle tolerance set from measurement (max 3, mean 0.5).

## Amendment (Plan 2, 2026-10-16)

Building the engine lab and stages 1–4 settled these, folded into the text below:

1. Quality, subsampling and Huffman changes re-encode through a rule-config push with the image (`update_rule_config_with_image`); the page then restores the scan position (`JumpTo` the same share) and resumes playing if it was playing. Only `select_block` is a rule action, which keeps the engine's state from drifting away from its config (the engine re-inits state from the config on every push).
2. The rule's capabilities are scrubbable but not cheap to recompute, so Reset, Back and scrubbing move the cursor without re-encoding.
3. The viz config is panels-based: `panels: [{ kind, rect, crop? }]` in device pixels, drawn in order; the `image_rect` / `focus_rect` / `aux_rect` / `stage` fields are dropped and the page decides what goes where.
4. Plane panels take an optional `crop` (image pixels); the Subsample stage magnifies a 32 px window around the selected block so chroma's blocks are visible at all.
5. The first selection is the luma block with the most AC energy, so every stage opens on a block with detail.
6. The bundled public-domain photo and the home tile, nav link and README lab entry move to Plan 4; `#/jpeg` works but is unlinked until then.
7. The rail shows all nine stages; 5–9 are disabled until their plans land.
8. The Color stage's formula is the static matrix, because the summary carries only the selected component's samples and there is no per-pixel RGB to plug in.
9. `kit.ts` is still deferred: the DCT stage calls the three kit functions it needs (`jpeg_zigzag_order`, `jpeg_dct_1d`, `jpeg_dft_1d`) through `loadVizCore()` directly, and a wrapper lands when more stages need the kit.
10. Review decisions: the lab's image panel takes arrow keys to move the selected block (keyboard access), and quality changes coalesce to one re-encode per animation frame, with the share link written when the slider is released.

## Summary

A learning tool that follows one image, and one 8×8 block of it, through every step of baseline JPEG and back: colour transform, chroma subsampling, blocking, the 2D DCT, quantization, zigzag, run-length coding, Huffman coding, and decoding. The maths is the point: every stage shows its formula with live numbers for the selected block, and every stage's visual is the maths made visible (a rotating colour cube, the 64 cosine basis patterns, a block rebuilt term by term, a rate–distortion curve, a Huffman code tree, the exact bits a block became).

The codec is not a black box. `crates/jpeg` is a **library of parts**: every stage is a free, pure function with an inverse, so the UI (and tests) can pull any single piece out and run a small experiment with it: zero one DCT coefficient, edit one Q-table cell, build a Huffman tree for one block's symbols. The full encoder and decoder are just one composition of those parts, and they produce real `.jpg` bytes the browser can open.

## Goals

1. A granular, natively tested Rust library covering every baseline JPEG stage in both directions, exposing its constants and intermediate values.
2. A baseline JFIF encoder/decoder composed from it, whose output the browser's own decoder accepts and agrees with (the test oracle).
3. A lab page with a pipeline rail of nine stages (1 Color · 2 Subsample · 3 Blocks · 4 DCT · 5 Quantize · 6 Zigzag · 7 Run-length · 8 Huffman · ⟲ Decode); the image and a selected block carry across every stage.
4. Live controls: quality 1–100, subsampling 4:4:4 / 4:2:2 / 4:2:0, Huffman tables optimized / standard; changes reshape every view without restarting the scan.
5. Four built-in images chosen to provoke one artifact each, plus upload of your own image.
6. A home tile, a share link, a Save .jpg button.

## Non-goals

- Progressive JPEG, arithmetic coding, restart intervals (DRI/RSTn), 12-bit precision, CMYK, EXIF/ICC handling. The decoder reports these as `Unsupported(kind)`. Each is a clean follow-up on the same modules.
- An animated, stage-by-stage decoder walk. Decode is one screen; each inverse is already shown in the stage that owns it.
- Sharing uploaded images through the link (the link falls back to the default built-in).
- Changing other labs' behaviour. Shared-code changes are limited to the two generic engine hooks below, a new `render/texture_quad.rs`, and the home grid growing to five tiles.

## Decisions

- **Approach A (approved): a Rust library is the single source of truth.** WebGL draws the pixel-heavy views; HTML/SVG overlays draw everything that is text (numeric grids, tokens, the code tree, bit strings). Rejected: a TypeScript codec with Canvas2D (drops the project's Rust → WASM → WebGL backbone), and a Rust codec with all-Svelte visuals and no engine (no clock line, no live home tile, unlike the other labs).
- **The library is granular, not just a codec** (user requirement). No stage reads hidden state; whatever a stage needs from another (previous DC, a Q table, Huffman tables) is an explicit argument.
- **A separate crate**, `crates/jpeg` (package and lib name `jpeg`), with no `web-sys`, `wasm-bindgen` or GL dependency, so it builds and tests natively and its boundaries are enforced by the compiler. `viz-core` depends on it by path; there is still one WASM package.
- **Full codec now** (user choice), including optimized Huffman tables and a JFIF writer/parser.
- **Stage stepper** (user choice) rather than a dashboard or scroll story.
- **Built-ins + upload** (user choice); no paintable block.
- **The engine clock counts MCUs scanned.** Play walks the scan across the image; views fill in behind it; the clock line completes when the bitstream does.
- Images are 256×256 for built-ins; uploads are downscaled to fit 512×512.

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

- **Rule config** (a push re-encodes and resets playback, existing behaviour): `{ image_id: String, quality: u8 (1–100, default 50), subsampling: "444" | "422" | "420" (default "420"), huffman: "optimized" | "standard" (default "optimized"), max_iterations }`, every field `#[serde(default)]`. The pixels arrive through `apply_image`; without them the rule encodes a built-in generated in Rust (so the home tile and wasm tests need no JS).
- **State:** the `Encoded` trace, `n` (MCUs scanned), the selection `{ component, bx, by }`, and a `version: u32` bumped on every re-encode.
- **Clock:** `advance_to(n)` stores `n`; capabilities scrubbable but not cheap to recompute (Reset, Back and scrubbing move the cursor without re-encoding); `max_iterations` = MCU count, so playback auto-pauses at the end and the clock line reads scan progress.
- **Actions (`rule_action`, no playback reset):** settings arrive in rule-config pushes; `select_block` is the only action.
- **`rule_summary()`** (read every frame, kept small): `{ version, n, total, width, height, bytes, raw_bytes, bits_so_far, psnr, entropy_bits, selected: { component, bx, by, pixels[64], shifted[64], dct[64], quant[64], table[64], zigzag[64], dc_prev, dc_diff, tokens[], bit_span, bits: String } }`. JS parses with loose `== null` checks (wasm-bindgen sends `None` as `undefined`).
- **`rule_inspect(key)`**, called when a stage opens or `version` changes: `"huffman"` → four `{ spec, frequencies, tree, entropy_bits, actual_bits }`; `"segments"` → the JFIF segment list; `"tables"` → both scaled Q tables; `"histogram"` → coefficient magnitude statistics for the energy view.
- **Built-in generators** (Rust, `viz-core/src/jpeg_images.rs`, shared by the rule, the kit and the tests): `gradient` (smooth sky → shows blocking), `text` (sharp black-on-white lines and glyph-like strokes → shows ringing), `bars` (saturated colour bars and a colour wheel → shows chroma bleed). A fourth, `photo`, is a bundled public-domain photograph (e.g. NASA), cropped to 256×256 and stored as a PNG under 150 KB in `web/public/jpeg/`, chosen in slice 4 and credited in the story; it is loaded by JS and pushed through `apply_image`.

### The kit (`viz-core/src/jpeg_kit.rs`, wrapped by `web/src/lib/jpeg/kit.ts`)

Stateless `#[wasm_bindgen]` free functions mirroring the crate one-to-one with typed arrays: `fdct`, `idct`, `idct_partial`, `basis`, `dct_1d`, `dft_1d`, `quantize`, `dequantize`, `scale_table`, `std_table`, `to_zigzag`, `from_zigzag`, `ac_symbols`, `size_category`, `amplitude_bits`, `optimal_lengths`, `huffman_tree`, `rgb_to_ycbcr`, `builtin_image(id, w, h)`, `encode_stats(rgba, w, h, opts) -> { bytes, psnr }` and `encode_decode(rgba, w, h, opts) -> rgba` (for the R–D sweep and generation loss). Each checks argument lengths (and amplitudes within ±32767) and returns a `JsError` rather than panicking. The TypeScript wrapper `kit.ts` gives each a typed signature; it lands in slice 2 with its first consumer.

### The visualization (`JpegViz`)

- Draws a `panels` list pushed by JS: `[{ kind, rect, crop? }]` in device pixels, drawn in order, `#[serde(default)]` (empty → the viz fits the image to the canvas itself; the home tile and wasm tests rely on this). Plane panels take an optional `crop` in image pixels. Reads `gl.drawing_buffer_width()/height()` every frame.
- **Viz config:** the `panels` list (with `crop`), `cube_mix` (0 = RGB axes … 1 = YCbCr axes), `dct_k` (0–64), `hover: Option<[u8;2]>`, `wipe` (0–1), `error_gain`, colours, `background`. `init` only (re)creates resources; it never resets the camera.
- **New renderer** `render/texture_quad.rs`: draws an R8 or RGBA8 texture into a pixel rect with nearest or linear filtering and an optional colour map (grayscale, diverging for signed coefficients, heat for error). Textures re-upload only when the summary `version` (or the selection) changes.
- **Reused renderers:** `InstancedQuads` (8×8 cell grids, heatmaps, the basis atlas cells), `LineBatch` (block grid, MCU outlines, scan front, zigzag snake), `Camera3D` + `LineBatch3D` + `InstancedPoints3D` (the colour cube: up to 16 384 sampled pixels as a point cloud, cube edges and axes interpolated from RGB to YCbCr by `cube_mix`; auto-rotate and drag-to-orbit as in Sierpinski).
- Scan progress: blocks beyond MCU `n` are drawn dimmed in every image view; the current MCU gets the terracotta outline.

### Overlays (Svelte DOM/SVG over the canvas, pointer-events where interactive)

Numeric 8×8 grids, the KaTeX formula panel (KaTeX is already a dependency, lazily loaded), AC token chips, the SVG Huffman tree and code table, the coloured bit string, the JFIF byte bar, the R–D and generation-loss charts (SVG).

## Part 3 — the page

### Frame

- `LabShell labId="jpeg" title="JPEG Compression"`. Bezel, in order: image picker (Gradient, Text, Bars, Upload…; Photo joins in Plan 4), Quality linear slider 1–100 with mono readout, Subsampling radio (real `type="radio"` inputs drawn as pills, Notes-lab pattern), Huffman radio (Optimized / Standard), scan Play/Pause + Reset, Save .jpg.
- **Pipeline rail** under the bezel: nine numbered steps, the current one marked (`aria-current="step"`); click or ←/→ (when focus is not in a text field). Each step has a one-line subtitle.
- **Readout strip:** `18.4 KB of 192 KB · 10.4 : 1 · 2.30 bits/px · PSNR 34.1 dB`.
- **Stage area:** landscape → the image on the left, the stage's focus view on the right, an auxiliary strip below; portrait (≤ 900 px) → stacked. The page turns this into the viz's `panels` list; the rects come from `web/src/lib/jpeg/layout.ts` and are pushed like the Notes lab's (`ResizeObserver` + window-resize fallback + once in `onReady`). Clicking the image selects a block in every stage.
- **Formula panel** per stage with live numbers for the selected block or hovered cell, and a short "Notice" paragraph. The article below holds "How it works" for the whole pipeline.

### Stages

1. **Color.** Point cloud of the image's pixels in the colour cube; a slider turns the axes from RGB to YCbCr (the cube visibly rotates so the grey diagonal becomes Y). The Y, Cb, Cr planes in the aux strip; per-plane toggles show the image rebuilt from Y only or chroma only. Formula: the 3×3 matrix with the selected pixel's values. *Notice:* Y looks like the photo; Cb and Cr are flat and soft.
2. **Subsample.** Cb and Cr at full resolution beside the subsampled planes (nearest upsampling, so the blocks show); the image recomposed with the chosen mode; "samples kept: 100 % / 67 % / 50 %". *Notice:* half the data gone, almost invisible.
3. **Blocks.** Block grid and MCU outlines over the image; the selected block as 8×8 numbered cells with a −128 shift toggle; a component switch Y / Cb / Cr (chroma shows the block covering the selection). Formula: f(x, y) − 128.
4. **DCT.** The 64-pattern basis atlas; the selected block's coefficients as a diverging heatmap with numbers. Hover a coefficient → its basis pattern lights and the formula shows F(u, v) with the block's actual sum. A *k* scrubber (0–64) rebuilds the block from the first *k* zigzag terms beside its shrinking error. An energy-compaction curve (cumulative energy by zigzag index). **Why cosines?** side panel: one row of the block, its periodic extension (DFT, a jump at the seam) vs its mirrored extension (DCT, smooth), and the number of terms each needs for 95 % of the energy. Formula: the 2D DCT-II.
5. **Quantize.** The scaled Q table (cells editable; "Apply to image" sends `set_tables`; "Standard" restores), coefficients before → after, the zero count, the reconstructed block and its error. The rate–distortion curve (bytes vs PSNR for q = 1…100 via `encode_stats`, computed a few points per frame and cached per image × subsampling × huffman) with a "you are here" dot. Formula: F_Q(u, v) = round(F(u, v) / Q(u, v)) and the IJG scaling.
6. **Zigzag.** The snake path animated over the quantized grid; the 1D sequence below with the zero tail highlighted and "last non-zero: #9 of 64". Formula: the index mapping.
7. **Run-length.** DC: this block's DC, the previous block's, their difference. AC: `(run, size) amplitude` token chips with ZRL and EOB; hover a token → its size category and amplitude bits. Formula: size = ⌈log₂(\|v\| + 1)⌉.
8. **Huffman.** Tabs DC/AC × luma/chroma: symbol frequency histogram, the SVG code tree and canonical code table; the selected block's bits coloured by token; the JFIF byte bar (SOI APP0 DQT SOF0 DHT SOS … EOI, widths to scale); Shannon bound vs actual bits; Optimized ↔ Standard shows the size change. Formula: code length ≈ −log₂ p.
9. **Decode.** Original vs reconstruction with a wipe slider; the error heatmap (gain slider); PSNR. Three artifact hints, each selecting the block where it is worst: *blocking* → the luma block with the largest mean \|Δ\| along its 8-px borders; *ringing* → among luma blocks containing a strong edge (max neighbour difference > 64 in the original), the one with the largest error; *chroma bleed* → the block with the largest Cb + Cr error. **Re-save ×N** (N ≤ 50, via `encode_decode`, one generation per frame): generation loss as a PSNR-per-generation chart. Formula: MSE and PSNR = 10 log₁₀(255² / MSE).

### Share link, tile, download, upload

- **Link:** `#/jpeg?img=gradient&q=50&s=420&h=opt&stage=dct&b=12,7` (sanitised; canonical rewrite on load; uploads fall back to `gradient`; `buildQuery` keeps raw commas as in the Notes lab).
- **Home tile:** `gradient` at q = 50 scanning; readout "41 % scanned · 18.4 KB"; `done` when `n == total`; `progress = n / total`. The home grid grows to five tiles (layout set in slice 4).
- **Save .jpg:** `engine.rule_bytes()` → Blob → download `jpeg-lab-q50-420.jpg`.
- **Upload:** file input and drag-and-drop on the stage; decoded with `createImageBitmap`, downscaled to fit 512×512 on an `OffscreenCanvas` (canvas fallback), pushed through `update_rule_config_with_image`. A failure shows an inline message and keeps the current image.

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
- **Web (Vitest):** `kit.ts` wrapper, URL params, `layout.ts`, summary/inspect parsing, upload downscale maths, and a `JpegLab` component test against `FakeEngine` (stage switching, rail keyboard, bezel controls dispatch the right actions); `App`, `Home` and router tests updated for five labs.
- **Browser:** every stage in light and dark at 1440 and 375 px via the capture script, plus the home tile.

## Delivery

Four PRs into protected `main`, each green on `cargo fmt --all --check`, `cargo clippy --all-targets --all-features`, `cargo test --all-features`, the wasm tests and the web tests:

1. **`crates/jpeg` + the kit + the oracle test.** The library is complete and proven before any UI exists.
2. **The engine lab + stages 1–4:** the generic engine hooks, the rule, `JpegViz`, `texture_quad`, the page frame (bezel, rail, readout, layout) and Color, Subsample, Blocks, DCT.
3. **Stages 5–8 + Decode:** quantization with editable tables and the R–D curve, zigzag, run-length, Huffman tree and byte bar, decode with wipe, error map and generation loss.
4. **Home tile, nav link, the photo, share links, README, story and the five-tile home grid.**

Within slices 2 and 3, Rust and web pieces run as parallel subagents on disjoint files.
