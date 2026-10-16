# JPEG Lab, Plan 3: Quantize, Zigzag, Run-length, Huffman and Decode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the pipeline in the JPEG lab at `#/jpeg`: stages 5–8 and Decode, each with live numbers, formulas and controls, so a reader can follow one block from rounded coefficients to bits and back to pixels.

**Architecture:** The rule (Plan 2) gains what the new stages read:
- custom quantization tables in its config;
- the selected block's Huffman codes and amplitude bits in the summary;
- artifact hints (blocking, ringing, colour bleed) computed once per encode;
- two on-demand views, `rule_inspect("huffman")` and `rule_inspect("segments")`.

The viz gains five panel kinds (`quant`, `dequant_rebuild`, `zigzag`, `wipe`, `error`) and animates the zigzag path itself, reporting its progress through `viz_readout()`. The page lays each stage out as GL panels plus named DOM "slots" for its tools: the Q-table editor, the rate–distortion chart, the zigzag sequence, the token chips, the Huffman view and the decode tools. The R–D sweep and "Re-save ×20" run in the page through the existing kit functions, a few encodes per animation frame.

**Tech Stack:** Rust (wasm-bindgen, serde, WebGL2 via `web-sys`), the `jpeg` crate, Svelte 5 + TypeScript, KaTeX, Vitest + Testing Library, wasm-pack tests in headless Chrome.

**Spec:** `docs/superpowers/specs/2026-10-15-jpeg-lab-design.md` (Part 2 rule, inspect and viz; Part 3 stages 5–9; Delivery item 3). Task 6 writes the amendments listed under Global Constraints into the spec.

**Provenance:** every code block and diff below comes from a prototype that was built, tested and looked at in the browser before this plan was written. Its results:
- `jpeg` 85 and `viz-core` 307 native tests pass.
- In headless Chrome 155, 47 browser tests pass.
- 513 web tests pass.
- `fmt`, clippy (nothing new) and svelte-check are clean.
- Every new stage was screenshotted at 1440 and 375 px, light and dark, on the gradient and bars pictures.

If a step's expected output differs, stop and investigate rather than editing the test to pass.

## Global Constraints

- **Branch:** `jpeg-lab-pipeline`, already created from `main` after PR #39. Nothing is pushed until the end; the controller opens the PR after the final review.
- **Validation (AGENTS.md):**
  - `cargo fmt --all --check`
  - `cargo clippy --all-targets --all-features`: no warnings in files this plan touches. The existing `sierpinski_*` warnings stay.
  - `cargo test --all-features`
  - Web: `cd web && npx vitest run` and `npx svelte-check --tsconfig ./tsconfig.json`
  - Browser: `wasm-pack test --chrome --headless --chromedriver=/private/tmp/claude-501/-Users-bsmall-dev-math-visualizer/9f5e6f00-2b13-4952-8009-b31a54f0fe14/scratchpad/chromedriver-155/chromedriver-mac-arm64/chromedriver crates/viz-core`. The flag goes before the crate path; never run it alongside another cargo build.
  - After any Rust change the web track depends on: `wasm-pack build crates/viz-core --target web --out-dir pkg`.
- **Spec amendments this plan carries** (Task 6 writes them into the spec):
  1. Edited quantization tables travel in the **rule config** as `tables: [luma[64], chroma[64]] | null` (row-major, 1–255). There is no `set_tables` action: Plan 2's amendment 1 applies. A table that is not 64 entries becomes the summary's `error`; the config push itself succeeds.
  2. `rule_inspect("huffman")` returns four tables in the order `dc_luma`, `ac_luma`, `dc_chroma`, `ac_chroma`, each `{ name, bits, vals, codes: [{symbol, code}], counts: [[symbol, count]], entropy_bits, actual_bits }`. `rule_inspect("segments")` returns `[{ marker, kind, offset, len }]`. The tree is drawn from `bits`/`vals` with the kit's `jpeg_huffman_tree`. `"histogram"` is dropped.
  3. The summary's selected block spells out its bits: `dc_size`, `dc_code`, `dc_amp_bits`, and per token `code` and `amp_bits`. Concatenated in order they equal `bits`.
  4. The summary carries `hints: { blocking, ringing | null, bleed }` (luma block coordinates), computed in Rust once per encode:
     - *Blocking* is the block whose right or bottom border has the largest mean |decoded step − original step|. Only borders with a neighbouring block count.
     - *Ringing* is, among blocks with an original luma step above 64, the one with the largest mean luma error. It is `null` when no block has such an edge.
     - *Bleed* is the block with the largest mean Cb + Cr error.
  5. The zigzag path animates in the **viz**:
     - It advances at `zigzag_speed` cells per second and restarts when the encode or the selection changes.
     - The page reads it back through `viz_readout() → { zigzag }`. Pushing viz config every frame would reset the engine's frame clock.
  6. **Viz config** gains `zigzag_speed` (default 24), `wipe` (0.5) and `error_gain` (4). The new panel kinds are `quant`, `dequant_rebuild`, `zigzag`, `wipe` and `error`.
  7. **Page layout:**
     - `StageLayout.extra` becomes `slots: Partial<Record<SlotName, Rect>>`: named DOM areas `charts`, `qtable`, `rd`, `sequence`, `tokens`, `huffman`, `resave`.
     - A panel caption may run 120 px (`CAPTION_MIN`) wide over a narrower panel, so slots start clear of it.
  8. **Page-side encodes:**
     - The R–D curve (`jpeg_encode_stats`, q = 1…100, 4 per frame, cached per picture × subsampling × Huffman mode) always uses the quality-scaled tables.
     - "Re-save" is a fixed 20 generations (`jpeg_encode_decode`, one per frame), not a choice of N.
     - The Huffman stage's "with the other tables" size is one more `jpeg_encode_stats` and is hidden while custom tables are in use.
  9. **Custom tables** last until "Standard" is pressed, across pictures and settings, and are **not in the share link**.
  10. **Stage contents:**
      - Quantize shows the decoder's rebuilt block. The zero count lives on the Zigzag stage ("then N zeros").
      - The Huffman stage shows each symbol's code in the histogram's tooltips and on the tree's leaves instead of a separate code table.
      - On a phone-width stage the Q-table editor is hidden (its column is under 120 px); the hover formula still names each entry. Mobile polish moves to Plan 4.
- **Shared geometry:** the overlay's 8 × 8 cells use `layout.cells()`, which mirrors the viz's `cells_8x8`. The zigzag path is drawn over the same cells.
- **Copy:** sentence case. No emoji or arrow glyphs in `.svelte` files (a repo test scans them; `→` included); glyphs live in `.ts`.
- Doc comments on every pub item in Rust and on exported TS; comment density like the neighbours. Conventional commits: `feat(jpeg): …`, `feat(web): …`, `test(…)`, `docs: …`.
- **Crossing the boundary:** wasm-bindgen sends `None` as `undefined`, so parse optional fields with `== null`, never `=== null`. A JSON `null` inside an object (like `ringing`) also arrives as `undefined`.

## Review Focus

1. **A bad custom table** (63 entries, from a stale page or a hand-edited config) must show as the summary's `error`, not throw or poison later encodes. Task 2's `custom_tables_travel_in_the_config` and the browser test `custom_tables_and_the_huffman_views_cross_the_boundary` push a 3-entry table.
2. **A picture with no hard edges** (the gradient) has no ringing block. The hint must be `null`, cross as `undefined`, and the Ringing button must be disabled and say why, not jump to block 0,0. Task 1's `ringing_only_counts_blocks_with_a_hard_edge` (a flat picture gives `None`) and Task 4's summary test `reads the codes … and the artifact hints`.
3. **Editing the table while a chroma block is selected** must replace only that plane's table, and the other plane keeps the table the encoder was using. Task 5's `applies an edited Q table …` test (luma edit, chroma unchanged).
4. **The bits on the Run-length and Huffman stages** must be exactly the block's bits from the file. Task 2's `the_selected_blocks_codes_spell_out_its_bits` checks that DC code + amplitude + every token's code + amplitude == `bits`, on a real encode.
5. **A phone-width stage** (343 × 520) must keep every panel, caption and slot on the canvas without overlaps. The R–D chart must start clear of the rebuild panel's caption. Task 4's `jpegLayout` matrix (all nine stages, slots included) and `starts the R–D chart clear of the rebuild caption on a phone`.

---

## Task 1: Artifact hints

**Files:**
- Create: `crates/viz-core/src/rules/jpeg_hints.rs`
- Modify: `crates/viz-core/src/rules/mod.rs` (`pub mod jpeg_hints;` after `pub mod jpeg;`)

**Interfaces:**
- Consumes: `jpeg::Rgb8Image`, `jpeg::color::rgb_to_ycbcr`.
- Produces:
  - `pub const EDGE_STEP: f32 = 64.0`.
  - `#[derive(Serialize)] pub struct Hints { pub blocking: [usize; 2], pub ringing: Option<[usize; 2]>, pub bleed: [usize; 2] }`, in luma block coordinates `[bx, by]`.
  - `pub fn find_hints(orig: &Rgb8Image, dec: &Rgb8Image) -> Option<Hints>`, which is `None` when the sizes differ or the image is empty.
  - Task 2's rule stores the result in its state and puts it in the summary.

- [ ] **Step 1: Write the failing tests.** Add `pub mod jpeg_hints;` to `crates/viz-core/src/rules/mod.rs` after `pub mod jpeg;`. Then create `crates/viz-core/src/rules/jpeg_hints.rs` containing only:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn img(w: usize, h: usize, f: impl Fn(usize, usize) -> [u8; 3]) -> Rgb8Image {
        let mut rgba = Vec::with_capacity(w * h * 4);
        for y in 0..h {
            for x in 0..w {
                rgba.extend(f(x, y));
                rgba.push(255);
            }
        }
        Rgb8Image::new(w, h, rgba).unwrap()
    }

    #[test]
    fn blocking_finds_the_step_compression_added() {
        let orig = img(32, 16, |_, _| [100, 100, 100]);
        // The decoded copy jumps at x = 16 inside the top row of blocks only.
        let dec = img(32, 16, |x, y| {
            if x >= 16 && y < 8 {
                [130, 130, 130]
            } else {
                [100, 100, 100]
            }
        });
        let h = find_hints(&orig, &dec).unwrap();
        assert_eq!(h.blocking, [1, 0]);
    }

    #[test]
    fn a_step_the_original_already_had_is_not_blocking() {
        let step = |x: usize, _y: usize| {
            if x >= 16 {
                [200, 200, 200]
            } else {
                [50, 50, 50]
            }
        };
        let orig = img(32, 8, step);
        let dec = img(32, 8, step);
        let h = find_hints(&orig, &dec).unwrap();
        // Nothing changed anywhere: every score ties at 0, the first block wins.
        assert_eq!(h.blocking, [0, 0]);
    }

    #[test]
    fn ringing_only_counts_blocks_with_a_hard_edge() {
        // A hard edge in block (2, 0); the decoded copy wobbles there and,
        // more strongly, in the flat block (0, 0).
        let orig = img(
            24,
            8,
            |x, _| if x >= 20 { [255, 255, 255] } else { [0, 0, 0] },
        );
        let dec = img(24, 8, |x, y| {
            if x < 8 {
                [40, 40, 40]
            } else if x >= 20 {
                [255, 255, 255]
            } else if x >= 16 && (x + y) % 2 == 0 {
                [20, 20, 20]
            } else {
                [0, 0, 0]
            }
        });
        let h = find_hints(&orig, &dec).unwrap();
        assert_eq!(h.ringing, Some([2, 0]));
        let flat = img(16, 8, |_, _| [10, 10, 10]);
        assert_eq!(find_hints(&flat, &flat).unwrap().ringing, None);
    }

    #[test]
    fn bleed_finds_the_colour_change() {
        let orig = img(16, 16, |_, _| [200, 50, 50]);
        let dec = img(16, 16, |x, y| {
            if x >= 8 && y >= 8 {
                [120, 90, 110]
            } else {
                [200, 50, 50]
            }
        });
        assert_eq!(find_hints(&orig, &dec).unwrap().bleed, [1, 1]);
    }

    #[test]
    fn mismatched_or_odd_sizes() {
        let a = img(8, 8, |_, _| [0, 0, 0]);
        let b = img(9, 8, |_, _| [0, 0, 0]);
        assert_eq!(find_hints(&a, &b), None);
        let odd = img(13, 5, |x, _| [x as u8 * 10, 0, 0]);
        assert!(find_hints(&odd, &odd).is_some());
    }
}
```

- [ ] **Step 2: Run them to see them fail.** `cargo test -p viz-core rules::jpeg_hints` → FAIL to compile (`cannot find function find_hints`).

- [ ] **Step 3: Implement.** Above the test module in `crates/viz-core/src/rules/jpeg_hints.rs`:

```rust
//! Where the JPEG lab points the reader on the Decode stage: the luma block
//! where each classic artifact is worst, found by comparing the decoded
//! image with the original.
//!
//! - **Blocking**: compression added a step at the block's right or bottom
//!   border that the original didn't have.
//! - **Ringing**: a block with a hard edge in the original whose pixels moved
//!   the most (the cosine terms that were cut overshoot near edges).
//! - **Chroma bleed**: the block whose colour (Cb, Cr) moved the most.

use jpeg::color::rgb_to_ycbcr;
use jpeg::Rgb8Image;
use serde::Serialize;

/// A neighbour difference above this (in luma levels) counts as a hard edge.
pub const EDGE_STEP: f32 = 64.0;

/// Luma block coordinates `[bx, by]` of each artifact's worst block.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Hints {
    pub blocking: [usize; 2],
    /// `None` when the picture has no hard edges at all.
    pub ringing: Option<[usize; 2]>,
    pub bleed: [usize; 2],
}

fn ycc(img: &Rgb8Image, x: usize, y: usize) -> [f32; 3] {
    let i = (x + img.w * y) * 4;
    rgb_to_ycbcr(
        img.rgba[i] as f32,
        img.rgba[i + 1] as f32,
        img.rgba[i + 2] as f32,
    )
}

/// The three hints, or `None` when the images differ in size or are empty.
pub fn find_hints(orig: &Rgb8Image, dec: &Rgb8Image) -> Option<Hints> {
    if orig.w != dec.w || orig.h != dec.h || orig.w == 0 || orig.h == 0 {
        return None;
    }
    let (w, h) = (orig.w, orig.h);
    let (cols, rows) = (w.div_ceil(8), h.div_ceil(8));
    let o: Vec<[f32; 3]> = (0..w * h).map(|i| ycc(orig, i % w, i / w)).collect();
    let d: Vec<[f32; 3]> = (0..w * h).map(|i| ycc(dec, i % w, i / w)).collect();
    let at = |v: &Vec<[f32; 3]>, x: usize, y: usize, c: usize| v[x + w * y][c];

    let mut blocking = ([0, 0], -1.0f32);
    let mut ringing: ([usize; 2], f32) = ([0, 0], -1.0);
    let mut bleed = ([0, 0], -1.0f32);
    for by in 0..rows {
        for bx in 0..cols {
            let (x0, y0) = (bx * 8, by * 8);
            let (x1, y1) = ((x0 + 8).min(w), (y0 + 8).min(h));

            // Blocking: the step compression added across the right or the
            // bottom border (decoded step minus original step), averaged per
            // border so blocks at the image's edge aren't favoured.
            let border = |pairs: &mut dyn Iterator<Item = ((usize, usize), (usize, usize))>| {
                let (mut step, mut n) = (0.0f32, 0usize);
                for ((ax, ay), (bx2, by2)) in pairs {
                    let dd = at(&d, bx2, by2, 0) - at(&d, ax, ay, 0);
                    let od = at(&o, bx2, by2, 0) - at(&o, ax, ay, 0);
                    step += (dd - od).abs();
                    n += 1;
                }
                if n == 0 {
                    0.0
                } else {
                    step / n as f32
                }
            };
            let right = if x1 < w {
                border(&mut (y0..y1).map(|y| ((x1 - 1, y), (x1, y))))
            } else {
                0.0
            };
            let bottom = if y1 < h {
                border(&mut (x0..x1).map(|x| ((x, y1 - 1), (x, y1))))
            } else {
                0.0
            };
            if (x1 < w || y1 < h) && right.max(bottom) > blocking.1 {
                blocking = ([bx, by], right.max(bottom));
            }

            // Per-block errors and edge strength.
            let (mut lum_err, mut chroma_err, mut edge) = (0.0f32, 0.0f32, 0.0f32);
            let n = ((x1 - x0) * (y1 - y0)) as f32;
            for y in y0..y1 {
                for x in x0..x1 {
                    lum_err += (at(&d, x, y, 0) - at(&o, x, y, 0)).abs();
                    chroma_err += (at(&d, x, y, 1) - at(&o, x, y, 1)).abs()
                        + (at(&d, x, y, 2) - at(&o, x, y, 2)).abs();
                    if x + 1 < x1 {
                        edge = edge.max((at(&o, x + 1, y, 0) - at(&o, x, y, 0)).abs());
                    }
                    if y + 1 < y1 {
                        edge = edge.max((at(&o, x, y + 1, 0) - at(&o, x, y, 0)).abs());
                    }
                }
            }
            if edge > EDGE_STEP && lum_err / n > ringing.1 {
                ringing = ([bx, by], lum_err / n);
            }
            if chroma_err / n > bleed.1 {
                bleed = ([bx, by], chroma_err / n);
            }
        }
    }
    Some(Hints {
        blocking: blocking.0,
        ringing: (ringing.1 >= 0.0).then_some(ringing.0),
        bleed: bleed.0,
    })
}
```

- [ ] **Step 4: Run the tests.** `cargo test -p viz-core rules::jpeg_hints` → PASS, 5 tests. Then `cargo test -p viz-core` → 298 passed.

- [ ] **Step 5: Lint and commit.**

```bash
cargo fmt --all && cargo clippy --all-targets --all-features 2>&1 | grep -A4 '^warning: [a-z]' | grep -- '-->' | grep -v sierpinski   # expect no output
git add crates/viz-core/src/rules/mod.rs crates/viz-core/src/rules/jpeg_hints.rs
git commit -m "feat(jpeg): find where blocking, ringing and colour bleed are worst"
```

---

## Task 2: The rule — custom tables, the block's codes, hints and the Huffman views

**Files:**
- Modify: `crates/viz-core/src/rules/jpeg.rs`, `crates/viz-core/tests/jpeg_lab.rs` (one more browser test)

**Interfaces:**
- Consumes: Task 1's `Hints` and `find_hints`; `jpeg::codec::Options` (its `tables: Option<[Table; 2]>`); `jpeg::huffman::{canonical_codes, HuffTable}`; `jpeg::metrics::entropy_bits`; the trace's `segments`.
- Produces:
  - **Config:** `JpegConfig.tables: Option<[Vec<u16>; 2]>` (`#[serde(default)]`, `null` in the defaults and the schema).
  - **Options:** `pub fn options_of(cfg: &JpegConfig) -> Result<Options, String>`. It replaces the infallible conversion, and `init` builds `JpegState::failed(original, error)` on `Err`.
  - **State:** `JpegState.hints: Option<Hints>`, filled by `build`.
  - **Summary additions:** `hints`, and inside `selected`: `dc_size`, `dc_code`, `dc_amp_bits`, plus `code` and `amp_bits` on every token.
  - **Constant:** `pub const TABLE_NAMES: [&str; 4] = ["dc_luma", "ac_luma", "dc_chroma", "ac_chroma"]`.
  - **`inspect` keys:**
    - `"huffman"` returns 4 × `{ name, bits, vals, codes: [{symbol, code}], counts: [[symbol, count]], entropy_bits, actual_bits }`.
    - `"segments"` returns `[{ marker, kind, offset, len }]`, where `kind` is the `Debug` name (`"Soi"`, `"Dqt"`, `"Sos"`, …) and `len` includes the scan data for `Sos`.
    - `"tables"` is unchanged.
  - Task 4's `summary.ts` and `huffman.ts` read exactly these names.

- [ ] **Step 1: Write the failing tests.** Apply to `crates/viz-core/src/rules/jpeg.rs` (test module only: new tests, and the existing ones now call `options_of(&c).unwrap()`):

```diff
--- a/crates/viz-core/src/rules/jpeg.rs
+++ b/crates/viz-core/src/rules/jpeg.rs
@@ -503,12 +503,12 @@
         c.quality = 90;
         c.subsampling = "444".into();
         c.huffman = "standard".into();
-        let o = options_of(&c);
+        let o = options_of(&c).unwrap();
         assert_eq!(o.quality, 90);
         assert_eq!(o.subsampling, Subsampling::S444);
         assert_eq!(o.huffman, HuffmanMode::Standard);
         c.subsampling = "nonsense".into();
-        assert_eq!(options_of(&c).subsampling, Subsampling::S420);
+        assert_eq!(options_of(&c).unwrap().subsampling, Subsampling::S420);
     }
 
     #[test]
@@ -637,4 +637,106 @@
         let b = JpegRule.init(&cfg(), 0);
         assert_ne!(a.version, b.version);
     }
-}
+
+    #[test]
+    fn custom_tables_travel_in_the_config() {
+        let mut c = cfg();
+        c.tables = Some([vec![1; 64], vec![255; 64]]);
+        let s = JpegRule.init(&c, 0);
+        assert!(s.error.is_none());
+        assert_eq!(
+            s.encoded.as_ref().unwrap().trace.tables,
+            [[1; 64], [255; 64]]
+        );
+        let json = serde_json::to_value(&c).unwrap();
+        assert_eq!(json["tables"][1][0], 255);
+        // Wrong length: refused before encoding, with a reason.
+        c.tables = Some([vec![1; 63], vec![1; 64]]);
+        let s = JpegRule.init(&c, 0);
+        assert!(s.encoded.is_none());
+        assert!(s.error.as_deref().unwrap().contains("64 entries"));
+        assert_eq!(JpegRule.summary(&s)["total"], 0);
+        // Out-of-range entries: refused by the encoder.
+        c.tables = Some([vec![0; 64], vec![1; 64]]);
+        assert!(JpegRule.init(&c, 0).error.is_some());
+    }
+
+    #[test]
+    fn the_selected_blocks_codes_spell_out_its_bits() {
+        let s = JpegRule.init(&cfg(), 0);
+        let sel = &JpegRule.summary(&s)["selected"];
+        let mut spelled = String::new();
+        spelled += sel["dc_code"].as_str().unwrap();
+        spelled += sel["dc_amp_bits"].as_str().unwrap();
+        for t in sel["tokens"].as_array().unwrap() {
+            spelled += t["code"].as_str().unwrap();
+            spelled += t["amp_bits"].as_str().unwrap();
+        }
+        assert_eq!(spelled, sel["bits"].as_str().unwrap());
+        assert!(!sel["dc_code"].as_str().unwrap().is_empty());
+    }
+
+    #[test]
+    fn huffman_view_lists_four_tables_above_their_entropy_bound() {
+        let s = JpegRule.init(&cfg(), 0);
+        let h = JpegRule.inspect(&s, "huffman");
+        let tables = h.as_array().unwrap();
+        assert_eq!(tables.len(), 4);
+        assert_eq!(tables[0]["name"], "dc_luma");
+        // One DC symbol per luma block: 32 × 32 blocks.
+        let dc_count: u64 = tables[0]["counts"]
+            .as_array()
+            .unwrap()
+            .iter()
+            .map(|c| c[1].as_u64().unwrap())
+            .sum();
+        assert_eq!(dc_count, 1024);
+        for t in tables {
+            assert_eq!(
+                t["codes"].as_array().unwrap().len(),
+                t["vals"].as_array().unwrap().len()
+            );
+            let (actual, bound) = (
+                t["actual_bits"].as_f64().unwrap(),
+                t["entropy_bits"].as_f64().unwrap(),
+            );
+            assert!(actual + 1e-6 >= bound, "{}: {actual} < {bound}", t["name"]);
+        }
+    }
+
+    #[test]
+    fn segments_view_walks_the_file() {
+        let s = JpegRule.init(&cfg(), 0);
+        let segs = JpegRule.inspect(&s, "segments");
+        let kinds: Vec<&str> = segs
+            .as_array()
+            .unwrap()
+            .iter()
+            .map(|v| v["kind"].as_str().unwrap())
+            .collect();
+        assert_eq!(kinds, ["Soi", "App0", "Dqt", "Sof0", "Dht", "Sos", "Eoi"]);
+        let last = &segs.as_array().unwrap()[6];
+        let bytes = JpegRule.bytes(&s).unwrap().len() as u64;
+        assert_eq!(
+            last["offset"].as_u64().unwrap() + last["len"].as_u64().unwrap(),
+            bytes
+        );
+    }
+
+    #[test]
+    fn hints_point_inside_the_grid() {
+        let s = JpegRule.init(&cfg(), 0);
+        let v = JpegRule.summary(&s);
+        for key in ["blocking", "bleed"] {
+            let b = &v["hints"][key];
+            assert!(
+                b[0].as_u64().unwrap() < 32 && b[1].as_u64().unwrap() < 32,
+                "{key}"
+            );
+        }
+        let mut c = cfg();
+        c.image_id = "text".into();
+        let t = JpegRule.init(&c, 0);
+        assert!(JpegRule.summary(&t)["hints"]["ringing"].is_array());
+    }
+}
```

And add this browser test to `crates/viz-core/tests/jpeg_lab.rs`, before `panels_render_after_a_re_encode`:

```diff
--- a/crates/viz-core/tests/jpeg_lab.rs
+++ b/crates/viz-core/tests/jpeg_lab.rs
@@ -166,6 +166,55 @@
 }
 
 #[wasm_bindgen_test]
+fn custom_tables_and_the_huffman_views_cross_the_boundary() {
+    make_canvas("jpeg-tables");
+    let mut engine = Engine::new("jpeg-tables", Some("jpeg".into())).unwrap();
+    let default_bytes = num(&engine.rule_summary(), "bytes");
+    let ones = vec!["1"; 64].join(",");
+    let rgba: Vec<u8> = (0..32 * 32 * 4).map(|i| (i * 13 % 256) as u8).collect();
+    engine
+        .update_rule_config_with_image(
+            js(&format!(
+                r#"{{"image_id":"upload","quality":50,"subsampling":"420","huffman":"optimized","max_iterations":4,"tables":[[{ones}],[{ones}]]}}"#
+            )),
+            32,
+            32,
+            &rgba,
+        )
+        .expect("config accepted");
+    let tables = engine.rule_inspect("tables");
+    assert_eq!(
+        js_sys::Array::from(&get(&tables, "luma")).get(63).as_f64(),
+        Some(1.0)
+    );
+    let huffman = js_sys::Array::from(&engine.rule_inspect("huffman"));
+    assert_eq!(huffman.length(), 4);
+    assert_eq!(
+        get(&huffman.get(0), "name").as_string().as_deref(),
+        Some("dc_luma")
+    );
+    let segments = js_sys::Array::from(&engine.rule_inspect("segments"));
+    assert_eq!(
+        get(&segments.get(0), "kind").as_string().as_deref(),
+        Some("Soi")
+    );
+    let summary = engine.rule_summary();
+    assert!(get(&summary, "hints").is_object());
+    assert!(num(&summary, "bytes") > 0.0 && num(&summary, "bytes") != default_bytes);
+
+    // A table that is not 64 entries is reported in the summary, not thrown.
+    engine
+        .update_rule_config_with_image(
+            js(r#"{"image_id":"upload","quality":50,"subsampling":"420","huffman":"optimized","max_iterations":4,"tables":[[1,2,3],[1]]}"#),
+            32,
+            32,
+            &rgba,
+        )
+        .expect("config accepted");
+    assert!(get(&engine.rule_summary(), "error").as_string().is_some());
+}
+
+#[wasm_bindgen_test]
 fn panels_render_after_a_re_encode() {
     let canvas = make_canvas("jpeg-reencode");
     let mut engine = Engine::new("jpeg-reencode", Some("jpeg".into())).unwrap();
```

- [ ] **Step 2: Run them to see them fail.** `cargo test -p viz-core rules::jpeg` → FAIL to compile (`cannot find function options_of`, `no field tables`).

- [ ] **Step 3: Implement.** Apply to `crates/viz-core/src/rules/jpeg.rs`:

```diff
--- a/crates/viz-core/src/rules/jpeg.rs
+++ b/crates/viz-core/src/rules/jpeg.rs
@@ -12,6 +12,7 @@
 use jpeg::bits::BitSpan;
 use jpeg::blocks::level_shift;
 use jpeg::codec::{decode, encode, Encoded, HuffmanMode, Options};
+use jpeg::huffman::{canonical_codes, HuffTable};
 use jpeg::metrics::{entropy_bits, psnr};
 use jpeg::zigzag::to_zigzag;
 use jpeg::{Rgb8Image, Subsampling};
@@ -20,6 +21,7 @@
 
 use crate::config::{number_property, ConfigSchema, NumberOpts};
 use crate::jpeg_images::builtin_image;
+use crate::rules::jpeg_hints::{find_hints, Hints};
 use crate::traits::{Capabilities, Rule, SceneState};
 
 /// Side of the generated built-ins when no pixels were pushed.
@@ -66,6 +68,11 @@
     /// The engine clock's length: the image's MCU count (the lab computes it).
     #[serde(default = "default_max_iterations")]
     pub max_iterations: u32,
+    /// Custom `[luma, chroma]` quantization tables (64 entries each, row-major,
+    /// 1–255) used instead of the quality-scaled standard ones; `None` for the
+    /// standard tables.
+    #[serde(default)]
+    pub tables: Option<[Vec<u16>; 2]>,
     /// The image installed by `apply_image`.
     #[serde(skip)]
     pub pixels: Option<Rgb8Image>,
@@ -89,6 +96,7 @@
                 }),
                 "subsampling": { "type": "string", "title": "Subsampling", "enum": ["444", "422", "420"], "default": "420", "x-cosmetic": false },
                 "huffman": { "type": "string", "title": "Huffman tables", "enum": ["optimized", "standard"], "default": "optimized", "x-cosmetic": false },
+                "tables": { "title": "Custom quantization tables", "default": null, "x-cosmetic": false },
                 "max_iterations": number_property(NumberOpts {
                     label: "MCUs",
                     default: default_max_iterations() as f64,
@@ -110,6 +118,7 @@
             "quality": default_quality(),
             "subsampling": default_subsampling(),
             "huffman": default_huffman(),
+            "tables": null,
             "max_iterations": default_max_iterations(),
         })
     }
@@ -139,9 +148,21 @@
     w.div_ceil(8 * fh) * h.div_ceil(8 * fv)
 }
 
-/// The encoder options a config asks for.
-pub fn options_of(cfg: &JpegConfig) -> Options {
-    Options {
+/// The encoder options a config asks for. Custom tables must have 64
+/// entries each; their values are checked by the encoder (1–255).
+pub fn options_of(cfg: &JpegConfig) -> Result<Options, String> {
+    let tables = match &cfg.tables {
+        None => None,
+        Some([luma, chroma]) => {
+            let table = |t: &Vec<u16>| -> Result<[u16; 64], String> {
+                t.as_slice()
+                    .try_into()
+                    .map_err(|_| format!("a quantization table needs 64 entries, got {}", t.len()))
+            };
+            Some([table(luma)?, table(chroma)?])
+        }
+    };
+    Ok(Options {
         quality: cfg.quality,
         subsampling: parse_subsampling(&cfg.subsampling),
         huffman: if cfg.huffman == "standard" {
@@ -149,8 +170,9 @@
         } else {
             HuffmanMode::Optimized
         },
+        tables,
         ..Options::default()
-    }
+    })
 }
 
 /// The block every stage follows: component (0 = Y, 1 = Cb, 2 = Cr) and its
@@ -184,6 +206,8 @@
     pub version: u32,
     /// Why the encode failed, if it did.
     pub error: Option<String>,
+    /// Where each compression artifact is worst (None if the encode failed).
+    pub hints: Option<Hints>,
 }
 
 impl SceneState for JpegState {
@@ -218,6 +242,7 @@
                 bx: 0,
                 by: 0,
             });
+        let hints = decoded.as_ref().and_then(|d| find_hints(&original, d));
         Self {
             original,
             encoded,
@@ -227,6 +252,26 @@
             selection,
             version,
             error,
+            hints,
+        }
+    }
+
+    /// A state that could not be encoded: the picture, no file, and why.
+    pub fn failed(original: Rgb8Image, error: String) -> Self {
+        Self {
+            original,
+            encoded: None,
+            decoded: None,
+            psnr: 0.0,
+            n: 0,
+            selection: Selection {
+                component: 0,
+                bx: 0,
+                by: 0,
+            },
+            version: NEXT_VERSION.fetch_add(1, Ordering::Relaxed),
+            error: Some(error),
+            hints: None,
         }
     }
 
@@ -273,6 +318,27 @@
 fn span_json(s: BitSpan) -> Value {
     json!([s.start_bit, s.len])
 }
+
+/// `code`'s low `len` bits as '0'/'1' (empty when the symbol has no code).
+fn code_string(t: &HuffTable, symbol: u8) -> String {
+    let len = t.len[symbol as usize] as usize;
+    if len == 0 {
+        return String::new();
+    }
+    format!("{:0len$b}", t.code[symbol as usize], len = len)
+}
+
+/// The `size` amplitude bits of `v` as '0'/'1'.
+fn amp_string(v: i32) -> String {
+    let (bits, size) = jpeg::rle::amplitude_bits(v);
+    if size == 0 {
+        return String::new();
+    }
+    format!("{:0size$b}", bits, size = size as usize)
+}
+
+/// The names `inspect("huffman")` gives the four tables, in trace order.
+pub const TABLE_NAMES: [&str; 4] = ["dc_luma", "ac_luma", "dc_chroma", "ac_chroma"];
 
 fn selected_json(state: &JpegState) -> Value {
     let Some(e) = &state.encoded else {
@@ -284,11 +350,24 @@
         return Value::Null;
     };
     let table = t.tables[(component > 0) as usize];
+    let (dc_slot, ac_slot) = if component == 0 { (0, 1) } else { (2, 3) };
+    let codes = |slot: usize| canonical_codes(&t.huffman[slot]).ok();
+    let (dc_codes, ac_codes) = (codes(dc_slot), codes(ac_slot));
     let tokens: Vec<Value> = b
         .tokens
         .iter()
-        .map(|tk| json!({ "run": tk.run, "size": tk.size, "amp": tk.amp, "symbol": tk.symbol() }))
+        .map(|tk| {
+            json!({
+                "run": tk.run,
+                "size": tk.size,
+                "amp": tk.amp,
+                "symbol": tk.symbol(),
+                "code": ac_codes.as_ref().map(|c| code_string(c, tk.symbol())).unwrap_or_default(),
+                "amp_bits": amp_string(tk.amp),
+            })
+        })
         .collect();
+    let dc_size = jpeg::rle::size_category(b.dc_diff);
     json!({
         "component": component,
         "bx": bx,
@@ -302,6 +381,9 @@
         "zigzag": to_zigzag(&b.quant).to_vec(),
         "dc_prev": b.dc_prev,
         "dc_diff": b.dc_diff,
+        "dc_size": dc_size,
+        "dc_code": dc_codes.as_ref().map(|c| code_string(c, dc_size)).unwrap_or_default(),
+        "dc_amp_bits": amp_string(b.dc_diff),
         "tokens": tokens,
         "bit_span": span_json(b.bits),
         "bits": t.bit_string(b.bits),
@@ -332,7 +414,10 @@
                 .or_else(|| builtin_image("gradient", BUILTIN_SIDE, BUILTIN_SIDE))
                 .expect("the gradient built-in always generates")
         });
-        JpegState::build(original, &options_of(cfg))
+        match options_of(cfg) {
+            Ok(opts) => JpegState::build(original, &opts),
+            Err(e) => JpegState::failed(original, e),
+        }
     }
 
     fn advance_to(&self, state: &mut Self::State, _cfg: &Self::Config, _seed: u64, n: u32) {
@@ -383,6 +468,7 @@
             "mcu": layout,
             "grids": grids,
             "selected": selected_json(state),
+            "hints": state.hints,
             "error": state.error,
         })
     }
@@ -432,13 +518,70 @@
         }
     }
 
-    /// `"tables"` → `{ "luma": [64], "chroma": [64] }` (row-major).
+    /// On-demand views:
+    /// - `"tables"` → `{ "luma": [64], "chroma": [64] }` (row-major).
+    /// - `"huffman"` → the four tables in `TABLE_NAMES` order, each
+    ///   `{ name, bits: [16], vals, codes: [{ symbol, code }], counts: [[symbol, count]],
+    ///   entropy_bits, actual_bits }` (counts only for symbols that occur;
+    ///   `actual_bits` = Σ count × code length, amplitude bits excluded).
+    /// - `"segments"` → `[{ marker, kind, offset, len }]` for the file's
+    ///   marker segments (SOS's `len` includes the scan data).
     fn inspect(&self, state: &Self::State, key: &str) -> Value {
-        match (key, &state.encoded) {
-            ("tables", Some(e)) => json!({
-                "luma": e.trace.tables[0].to_vec(),
-                "chroma": e.trace.tables[1].to_vec(),
+        let Some(e) = &state.encoded else {
+            return Value::Null;
+        };
+        let t = &e.trace;
+        match key {
+            "tables" => json!({
+                "luma": t.tables[0].to_vec(),
+                "chroma": t.tables[1].to_vec(),
             }),
+            "huffman" => Value::Array(
+                (0..4)
+                    .map(|slot| {
+                        let spec = &t.huffman[slot];
+                        let freq = &t.frequencies[slot];
+                        let codes = canonical_codes(spec).ok();
+                        let len = |s: u8| codes.as_ref().map_or(0, |c| c.len[s as usize] as u64);
+                        let counts: Vec<Value> = freq
+                            .iter()
+                            .enumerate()
+                            .filter(|(_, &c)| c > 0)
+                            .map(|(sym, &c)| json!([sym, c]))
+                            .collect();
+                        let actual: u64 = freq
+                            .iter()
+                            .enumerate()
+                            .map(|(sym, &c)| c as u64 * len(sym as u8))
+                            .sum();
+                        json!({
+                            "name": TABLE_NAMES[slot],
+                            "bits": spec.bits.to_vec(),
+                            "vals": spec.vals,
+                            "codes": spec.vals.iter().map(|&v| json!({
+                                "symbol": v,
+                                "code": codes.as_ref().map(|c| code_string(c, v)).unwrap_or_default(),
+                            })).collect::<Vec<_>>(),
+                            "counts": counts,
+                            "entropy_bits": entropy_bits(freq),
+                            "actual_bits": actual,
+                        })
+                    })
+                    .collect(),
+            ),
+            "segments" => Value::Array(
+                t.segments
+                    .iter()
+                    .map(|sg| {
+                        json!({
+                            "marker": sg.marker,
+                            "kind": format!("{:?}", sg.kind),
+                            "offset": sg.offset,
+                            "len": sg.len,
+                        })
+                    })
+                    .collect(),
+            ),
             _ => Value::Null,
         }
     }
```

- [ ] **Step 4: Run the tests.**
  - `cargo test -p viz-core rules::jpeg` → PASS (5 new tests).
  - `cargo test -p viz-core` → 303 passed.
  - `wasm-pack test --chrome --headless --chromedriver=/private/tmp/claude-501/-Users-bsmall-dev-math-visualizer/9f5e6f00-2b13-4952-8009-b31a54f0fe14/scratchpad/chromedriver-155/chromedriver-mac-arm64/chromedriver crates/viz-core --test jpeg_lab` → 7 passed.

- [ ] **Step 5: Lint and commit.**

```bash
cargo fmt --all && cargo clippy --all-targets --all-features 2>&1 | grep -A4 '^warning: [a-z]' | grep -- '-->' | grep -v sierpinski   # expect no output
git add crates/viz-core/src/rules/jpeg.rs crates/viz-core/tests/jpeg_lab.rs
git commit -m "feat(jpeg): custom Q tables, the block's codes, artifact hints and the Huffman views"
```

---

## Task 3: The viz — quantized cells, the decoder's rebuild, the zigzag path, the wipe and the error map

This task needs nothing from Task 2. It can run before or after it, but not at the same time: both touch `tests/jpeg_lab.rs`.

**Files:**
- Modify: `crates/viz-core/src/visualizations/jpeg.rs`, `crates/viz-core/tests/jpeg_lab.rs`

**Interfaces:**
- Consumes: the rule's `JpegState` (`encoded.trace`, `decoded`, `original`, `version`, `selection`); `jpeg::quant::dequantize`, `jpeg::dct::idct`, `jpeg::zigzag::ZIGZAG`.
- Produces:
  - **Viz config:** `JpegVizConfig` gains `zigzag_speed: f32` (24), `wipe: f32` (0.5) and `error_gain: f32` (4), all `#[serde(default = …)]`.
  - **Panel kinds:**
    - `quant`: the quantized block as dequantized diverging cells, with hover.
    - `dequant_rebuild`: `idct(dequantize(quant, table)) + 128` as grey cells.
    - `zigzag`: cells lit where `quant ≠ 0`, plus the path so far.
    - `wipe`: the original, with the decoded image scissored to the left `wipe` share, and an accent line.
    - `error`: the error texture drawn at `error_gain`.
  - **Pure helpers:**
    - `pub fn error_rgba(a: &Rgb8Image, b: &Rgb8Image) -> Vec<u8>`: per pixel, `e` = the mean |Δ| over R, G, B, tinted `(e, 0.55e, 0.25e)`, alpha 255.
    - `pub fn zigzag_path(cells: &[[f32; 4]; 64], t: f32) -> Vec<[f32; 2]>`: cell centres in zigzag order up to `t` cells, with the last point interpolated.
  - **Readout:** `Visualization::readout()` returns `{"zigzag": progress}` (0–64). Task 5's page reads it.

- [ ] **Step 1: Write the failing tests.** Apply to `crates/viz-core/src/visualizations/jpeg.rs` (test module only):

```diff
--- a/crates/viz-core/src/visualizations/jpeg.rs
+++ b/crates/viz-core/src/visualizations/jpeg.rs
@@ -1016,4 +1016,49 @@
     fn scissor_boxes_flip_y() {
         assert_eq!(scissor_box(100, [10.0, 20.0, 30.0, 40.0]), [10, 40, 30, 40]);
     }
-}
+
+    #[test]
+    fn the_new_view_fields_default() {
+        let c: JpegVizConfig = serde_json::from_value(json!({})).unwrap();
+        assert_eq!((c.zigzag_speed, c.wipe, c.error_gain), (24.0, 0.5, 4.0));
+    }
+
+    #[test]
+    fn error_bytes_are_the_mean_channel_difference_tinted_warm() {
+        let a = Rgb8Image::new(2, 1, vec![10, 10, 10, 255, 0, 0, 0, 255]).unwrap();
+        let b = Rgb8Image::new(2, 1, vec![10, 10, 10, 255, 30, 60, 90, 255]).unwrap();
+        let e = error_rgba(&a, &b);
+        assert_eq!(&e[..4], &[0, 0, 0, 255]);
+        assert_eq!(&e[4..], &[60, 33, 15, 255]);
+        let c = Rgb8Image::new(1, 1, vec![0; 4]).unwrap();
+        assert_eq!(error_rgba(&a, &c), vec![0; 8]);
+    }
+
+    #[test]
+    fn the_zigzag_path_visits_cells_in_scan_order() {
+        let cells = cells_8x8([0.0, 0.0, 80.0, 80.0], 0.0);
+        assert!(zigzag_path(&cells, 1.0).is_empty());
+        let p = zigzag_path(&cells, 3.0);
+        // (0,0) → (1,0) → (0,1): centres at 5, 15 and (5, 15).
+        assert_eq!(p, vec![[5.0, 5.0], [15.0, 5.0], [5.0, 15.0]]);
+        let half = zigzag_path(&cells, 2.5);
+        assert_eq!(half.last().copied(), Some([10.0, 10.0]));
+        assert_eq!(zigzag_path(&cells, 64.0).len(), 64);
+        assert_eq!(zigzag_path(&cells, 99.0).len(), 64);
+        assert_eq!(zigzag_path(&cells, 64.0)[63], [75.0, 75.0]);
+    }
+
+    #[test]
+    fn the_zigzag_path_grows_with_time_and_reports_it() {
+        let mut v = JpegViz::new();
+        assert_eq!(v.readout()["zigzag"], 0.0);
+        v.tick(0.5);
+        assert_eq!(v.readout()["zigzag"], 12.0);
+        v.tick(10.0);
+        assert_eq!(v.readout()["zigzag"], 64.0);
+        v.zig_speed = 0.0;
+        v.zig_progress = 3.0;
+        v.tick(0.01);
+        assert_eq!(v.readout()["zigzag"], 64.0);
+    }
+}
```

And extend the browser panel test in `crates/viz-core/tests/jpeg_lab.rs`:

```diff
--- a/crates/viz-core/tests/jpeg_lab.rs
+++ b/crates/viz-core/tests/jpeg_lab.rs
@@ -152,8 +152,13 @@
                 {"kind":"atlas","rect":[150,100,50,50]},
                 {"kind":"coeffs","rect":[200,100,50,50]},
                 {"kind":"rebuild","rect":[250,100,50,50]},
+                {"kind":"quant","rect":[300,100,50,50]},
+                {"kind":"dequant_rebuild","rect":[350,100,50,50]},
+                {"kind":"zigzag","rect":[0,200,80,80]},
+                {"kind":"wipe","rect":[80,200,100,100]},
+                {"kind":"error","rect":[180,200,100,100]},
                 {"kind":"unknown","rect":[0,0,1,1]}
-            ],"cube_mix":0.5,"dct_k":6,"hover":[1,2]}"#))
+            ],"cube_mix":0.5,"dct_k":6,"hover":[1,2],"zigzag_speed":30,"wipe":0.3,"error_gain":8}"#))
         .expect("panels accepted");
     engine
         .forward_input(js(
@@ -162,7 +167,11 @@
         .unwrap();
     engine.frame(0.0);
     engine.frame(16.0);
-    assert_eq!(gl_of(&canvas).get_error(), WebGl2RenderingContext::NO_ERROR);
+    engine.frame(116.0);
+    assert_eq!(gl_of(&canvas).get_error(), WebGl2RenderingContext::NO_ERROR);
+    // The zigzag path has moved on: 30 cells/s over the frames since it started.
+    let zig = num(&engine.viz_readout(), "zigzag");
+    assert!(zig > 0.0 && zig <= 64.0, "zigzag readout {zig}");
 }
 
 #[wasm_bindgen_test]
```

- [ ] **Step 2: Run them to see them fail.** `cargo test -p viz-core visualizations::jpeg` → FAIL to compile (`cannot find function error_rgba`, `no field zigzag_speed`).

- [ ] **Step 3: Implement.** Apply to `crates/viz-core/src/visualizations/jpeg.rs`:

```diff
--- a/crates/viz-core/src/visualizations/jpeg.rs
+++ b/crates/viz-core/src/visualizations/jpeg.rs
@@ -10,11 +10,20 @@
 //! full-resolution planes), `coded_cb` / `coded_cr` (the subsampled chroma as
 //! coded, shown blocky), `cube` (the pixels as points in the colour cube),
 //! `block` (the selected block's 64 samples), `atlas` (the 64 DCT basis
-//! patterns), `coeffs` (the selected block's DCT, signed) and `rebuild` (the
-//! block rebuilt from its first `dct_k` zigzag coefficients).
+//! patterns), `coeffs` (the selected block's DCT, signed), `rebuild` (the
+//! block rebuilt from its first `dct_k` zigzag coefficients), `quant` (the
+//! block's coefficients after quantization, as the decoder sees them),
+//! `dequant_rebuild` (the block rebuilt from those), `zigzag` (the quantized
+//! grid with the scan path growing through it at `zigzag_speed` cells a
+//! second, restarting when the block or the encode changes; the viz reports
+//! how far it has got through `readout()`),
+//! `wipe` (the original with the decoded image over its left `wipe` share)
+//! and `error` (per-pixel |decoded − original|, brightened by `error_gain`).
 
 use jpeg::color::{rgb_to_ycbcr, ycbcr_to_rgb};
-use jpeg::dct::{basis, idct_partial};
+use jpeg::dct::{basis, idct, idct_partial};
+use jpeg::quant::dequantize;
+use jpeg::zigzag::ZIGZAG;
 use jpeg::{Plane, Rgb8Image, Subsampling};
 use serde::{Deserialize, Serialize};
 use serde_json::{json, Value};
@@ -93,6 +102,26 @@
     /// The cube's idle spin, radians per second.
     #[serde(default = "default_auto_rotate")]
     pub auto_rotate_speed: f32,
+    /// How fast the `zigzag` panel's path grows, in cells per second
+    /// (0 = draw the whole path at once).
+    #[serde(default = "default_zigzag_speed")]
+    pub zigzag_speed: f32,
+    /// Share of the `wipe` panel (from the left) showing the decoded image.
+    #[serde(default = "default_wipe")]
+    pub wipe: f32,
+    /// Brightness multiplier for the `error` panel.
+    #[serde(default = "default_error_gain")]
+    pub error_gain: f32,
+}
+
+fn default_zigzag_speed() -> f32 {
+    24.0
+}
+fn default_wipe() -> f32 {
+    0.5
+}
+fn default_error_gain() -> f32 {
+    4.0
 }
 
 impl ConfigSchema for JpegVizConfig {
@@ -109,6 +138,9 @@
                 "dct_k": number_property(NumberOpts { label: "Coefficients kept", default: 64.0, min: 0.0, max: 64.0, step: 1.0, integer: true, cosmetic: true, widget: None }),
                 "hover": { "title": "Hovered coefficient", "default": null, "x-cosmetic": true },
                 "auto_rotate_speed": number_property(NumberOpts { label: "Cube spin", default: 0.2, min: 0.0, max: 2.0, step: 0.05, integer: false, cosmetic: true, widget: None }),
+                "zigzag_speed": number_property(NumberOpts { label: "Zigzag speed", default: 24.0, min: 0.0, max: 64.0, step: 1.0, integer: false, cosmetic: true, widget: None }),
+                "wipe": number_property(NumberOpts { label: "Decoded share", default: 0.5, min: 0.0, max: 1.0, step: 0.01, integer: false, cosmetic: true, widget: None }),
+                "error_gain": number_property(NumberOpts { label: "Error gain", default: 4.0, min: 1.0, max: 32.0, step: 0.5, integer: false, cosmetic: true, widget: None }),
             },
         })
     }
@@ -124,6 +156,9 @@
             "dct_k": default_dct_k(),
             "hover": null,
             "auto_rotate_speed": default_auto_rotate(),
+            "zigzag_speed": default_zigzag_speed(),
+            "wipe": default_wipe(),
+            "error_gain": default_error_gain(),
         })
     }
 }
@@ -353,6 +388,54 @@
     out
 }
 
+/// RGBA bytes of the per-pixel error between two same-size images: the mean
+/// |Δ| over R, G, B as a warm tint (the panel brightens it with
+/// `error_gain`). Mismatched sizes give all black.
+pub fn error_rgba(a: &Rgb8Image, b: &Rgb8Image) -> Vec<u8> {
+    let mut out = vec![0u8; a.w * a.h * 4];
+    if a.w != b.w || a.h != b.h {
+        return out;
+    }
+    for (i, (pa, pb)) in a
+        .rgba
+        .chunks_exact(4)
+        .zip(b.rgba.chunks_exact(4))
+        .enumerate()
+    {
+        let e = (0..3)
+            .map(|c| (pa[c] as f32 - pb[c] as f32).abs())
+            .sum::<f32>()
+            / 3.0;
+        out[i * 4] = e.round().min(255.0) as u8;
+        out[i * 4 + 1] = (e * 0.55).round().min(255.0) as u8;
+        out[i * 4 + 2] = (e * 0.25).round().min(255.0) as u8;
+        out[i * 4 + 3] = 255;
+    }
+    out
+}
+
+/// Centres of the 8 × 8 cells in zigzag order, the path drawn through the
+/// first `t` of them (`t` in 0–64; a fractional `t` ends part-way along the
+/// next step). Fewer than two points → no path.
+pub fn zigzag_path(cells: &[[f32; 4]; 64], t: f32) -> Vec<[f32; 2]> {
+    let centre = |k: usize| {
+        let c = cells[ZIGZAG[k] as usize];
+        [c[0] + c[2] / 2.0, c[1] + c[3] / 2.0]
+    };
+    let t = t.clamp(0.0, 64.0);
+    let whole = t.floor() as usize;
+    let mut pts: Vec<[f32; 2]> = (0..whole.min(64)).map(centre).collect();
+    let frac = t - whole as f32;
+    if frac > 0.0 && (1..64).contains(&whole) {
+        let (a, b) = (centre(whole - 1), centre(whole));
+        pts.push([a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac]);
+    }
+    if pts.len() < 2 {
+        pts.clear();
+    }
+    pts
+}
+
 /// GL scissor box for a y-down device-pixel rect on a canvas `canvas_h` high.
 pub fn scissor_box(canvas_h: u32, r: [f32; 4]) -> [i32; 4] {
     let y_up = canvas_h as f32 - (r[1] + r[3]);
@@ -417,6 +500,7 @@
     decoded: Texture,
     planes: [Texture; 3],
     coded: [Option<Texture>; 2],
+    error: Texture,
 }
 
 /// The cube's sampled pixels turned into GPU instances, valid for one encode
@@ -442,6 +526,12 @@
     cube_cache: Option<CubeCache>,
     quad_scratch: Vec<QuadInstance>,
     line_scratch: Vec<LineVertex>,
+    /// The zigzag path's progress in cells (0–64), advanced by `tick`.
+    zig_progress: f32,
+    /// Cells per second for `zig_progress` (0 = jump to the end).
+    zig_speed: f32,
+    /// The (encode, block) the path was started for; a change restarts it.
+    zig_key: Option<(u32, Selection)>,
 }
 
 impl JpegViz {
@@ -459,6 +549,9 @@
             textures: None,
             camera,
             auto_speed: default_auto_rotate(),
+            zig_progress: 0.0,
+            zig_speed: default_zigzag_speed(),
+            zig_key: None,
             cube_cache: None,
             quad_scratch: Vec::new(),
             line_scratch: Vec::new(),
@@ -518,12 +611,18 @@
                 None => Ok(None),
             }
         };
+        let error_bytes = state
+            .decoded
+            .as_ref()
+            .map_or_else(|| vec![0; (w * h * 4) as usize], |d| error_rgba(img, d));
+        let error = Texture::new(gl, w, h, &error_bytes, Filter::Nearest)?;
         self.textures = Some(Textures {
             version: state.version,
             original,
             decoded,
             planes,
             coded: [coded(1)?, coded(2)?],
+            error,
         });
         Ok(())
     }
@@ -738,6 +837,7 @@
 
     fn init(&mut self, gl: &Gl, cfg: &Self::Config) {
         self.auto_speed = cfg.auto_rotate_speed;
+        self.zig_speed = cfg.zigzag_speed.max(0.0);
         // A failure is retried by the next render, like the other vizzes.
         let _ = self.ensure_resources(gl);
     }
@@ -829,6 +929,80 @@
                         self.draw_cells(rect, &colors, None, cfg.accent);
                     }
                 }
+                "quant" => {
+                    if let Some(b) = trace.and_then(|t| t.block(sel.component, sel.bx, sel.by)) {
+                        let table =
+                            trace.map_or([1; 64], |t| t.tables[(sel.component > 0) as usize]);
+                        let colors = dequantize(&b.quant, &table).map(diverging);
+                        self.draw_cells(rect, &colors, hover, cfg.accent);
+                    }
+                }
+                "dequant_rebuild" => {
+                    if let Some(b) = trace.and_then(|t| t.block(sel.component, sel.bx, sel.by)) {
+                        let table =
+                            trace.map_or([1; 64], |t| t.tables[(sel.component > 0) as usize]);
+                        let rebuilt = idct(&dequantize(&b.quant, &table));
+                        let colors = rebuilt.map(|v| sample_color(sel.component, v + 128.0));
+                        self.draw_cells(rect, &colors, None, cfg.accent);
+                    }
+                }
+                "zigzag" => {
+                    if let Some(b) = trace.and_then(|t| t.block(sel.component, sel.bx, sel.by)) {
+                        let lit = [0.886, 0.478, 0.322, 0.55];
+                        let colors =
+                            b.quant
+                                .map(|q| if q != 0 { lit } else { [0.16, 0.16, 0.19, 1.0] });
+                        self.draw_cells(rect, &colors, None, cfg.accent);
+                        let gap = (rect[2] / 160.0).max(1.0);
+                        let key = Some((state.version, sel));
+                        if self.zig_key != key {
+                            self.zig_key = key;
+                            self.zig_progress = 0.0;
+                        }
+                        let path = zigzag_path(&cells_8x8(rect, gap), self.zig_progress);
+                        let c = [1.0, 1.0, 1.0, 0.85];
+                        for pair in path.windows(2) {
+                            self.line_scratch.push(LineVertex {
+                                position: pair[0],
+                                color: c,
+                            });
+                            self.line_scratch.push(LineVertex {
+                                position: pair[1],
+                                color: c,
+                            });
+                        }
+                    }
+                }
+                "wipe" => {
+                    if let (Some(q), Some(t)) = (&self.quad, &self.textures) {
+                        q.draw(gl, &t.original, rect, canvas, 1.0);
+                        let share = cfg.wipe.clamp(0.0, 1.0);
+                        if share > 0.0 {
+                            gl.enable(Gl::SCISSOR_TEST);
+                            let [x, y, w, h] = scissor_box(
+                                canvas[1],
+                                [rect[0], rect[1], rect[2] * share, rect[3]],
+                            );
+                            gl.scissor(x, y, w, h);
+                            q.draw(gl, &t.decoded, rect, canvas, 1.0);
+                            gl.disable(Gl::SCISSOR_TEST);
+                        }
+                        let edge = rect[0] + rect[2] * share;
+                        self.line_scratch.push(LineVertex {
+                            position: [edge, rect[1]],
+                            color: cfg.accent,
+                        });
+                        self.line_scratch.push(LineVertex {
+                            position: [edge, rect[1] + rect[3]],
+                            color: cfg.accent,
+                        });
+                    }
+                }
+                "error" => {
+                    if let (Some(q), Some(t)) = (&self.quad, &self.textures) {
+                        q.draw(gl, &t.error, rect, canvas, cfg.error_gain.max(0.0));
+                    }
+                }
                 "atlas" => self.draw_atlas(rect, hover, cfg.accent),
                 "cube" => {
                     // Flush 2D batches first so they stay under the cube.
@@ -857,6 +1031,16 @@
 
     fn tick(&mut self, dt: f32) {
         self.camera.auto_advance(dt, self.auto_speed);
+        self.zig_progress = if self.zig_speed > 0.0 {
+            (self.zig_progress + dt * self.zig_speed).min(64.0)
+        } else {
+            64.0
+        };
+    }
+
+    /// `{ "zigzag": cells }`: how far the zigzag path has grown (0–64).
+    fn readout(&self) -> Value {
+        json!({ "zigzag": self.zig_progress })
     }
 }
 
```

- [ ] **Step 4: Run the tests.**
  - `cargo test -p viz-core visualizations::jpeg` → PASS (4 new tests).
  - `cargo test -p viz-core` → 307 passed.
  - `wasm-pack test --chrome --headless --chromedriver=/private/tmp/claude-501/-Users-bsmall-dev-math-visualizer/9f5e6f00-2b13-4952-8009-b31a54f0fe14/scratchpad/chromedriver-155/chromedriver-mac-arm64/chromedriver crates/viz-core` → `jpeg_kit` 6, `jpeg_lab` 7, `jpeg_oracle` 1, `wasm` 33.
  - Then `wasm-pack build crates/viz-core --target web --out-dir pkg`, which the web tasks need.

- [ ] **Step 5: Lint and commit.**

```bash
cargo fmt --all && cargo clippy --all-targets --all-features 2>&1 | grep -A4 '^warning: [a-z]' | grep -- '-->' | grep -v sierpinski   # expect no output
git add crates/viz-core/src/visualizations/jpeg.rs crates/viz-core/tests/jpeg_lab.rs
git commit -m "feat(jpeg): quantized, rebuilt, zigzag, wipe and error panels; the viz animates the zigzag path"
```

---

## Task 4: The page's pure modules (layout slots, summary fields, formulas, R–D cache, Huffman view data)

This task touches only `web/`. It can run in parallel with Tasks 1–3: its tests use the fake engine, not the built package.

**Files:**
- Create: `web/src/lib/jpeg/rd.ts`, `web/src/lib/jpeg/huffman.ts`, `web/src/lib/jpeg/__tests__/rd.test.ts`, `web/src/lib/jpeg/__tests__/huffman.test.ts`
- Modify:
  - `web/src/lib/jpeg/{layout,summary,formulas,math}.ts`
  - their tests `layout.test.ts` and `summary.test.ts`
  - `web/src/lib/test/fakeViz.ts`
  - `web/src/lib/components/labs/JpegLab.svelte`: two lines only, `extra` → `slots`, so the page still type-checks.

**Interfaces:**
- Produces, for Task 5 (exact names):
  - **`layout.ts`:**
    - `PanelKind` gains `'quant' | 'dequant_rebuild' | 'zigzag' | 'wipe' | 'error'`.
    - `export type SlotName = 'charts' | 'qtable' | 'rd' | 'sequence' | 'tokens' | 'huffman' | 'resave'`.
    - `StageLayout.slots: Partial<Record<SlotName, Rect>>` replaces `extra`.
    - `CAPTION_MIN = 120`.
    - `jpegLayout` lays out `quantize`, `zigzag`, `rle`, `huffman` and `decode`.
  - **`summary.ts`:**
    - `AcToken` gains `code`, `ampBits`.
    - `SelectedBlock` gains `dcSize`, `dcCode`, `dcAmpBits`.
    - `export interface Hints { blocking: [number, number]; ringing: [number, number] | null; bleed: [number, number] }`, and `JpegSummary.hints: Hints | null`.
  - **`formulas.ts`:**
    - `QUANT_TEX`, `SIZE_TEX`, `CODE_TEX`, `PSNR_TEX`.
    - `lastNonZero(values): number` (−1 when all are zero).
    - `stageTex` cases for `quantize`, `zigzag`, `rle`, `huffman` and `decode`, and `NOTICE` text for each.
  - **`math.ts`:** `psnrOf(a: Uint8Array, b: Uint8Array): number`, over RGB with alpha ignored. It returns `Infinity` when the images are identical and `NaN` on a size mismatch.
  - **`rd.ts`:** `RdPoint`, `RD_QUALITIES`, `RD_PER_FRAME = 4`, `RD_PSNR_CAP = 60`, `rdKey`, `cachedCurve`, `addPoint`, `missing`, `clearCurves`, `rdPolyline`.
  - **`huffman.ts`:** `HuffTableView`, `SegmentView`, `TreeNodeView`, `TABLE_LABELS`, `readTables`, `readSegments`, `symbolLabel`, `topCounts`, `nodeXY`, `readTree`.
  - **`fakeViz.ts`:**
    - The JPEG fixture gains `dc_size`, `dc_code`, `dc_amp_bits`, token `code`/`amp_bits` and `hints`; its `bits` is now `'011101010'` and `bit_span` is `[100, 9]`.
    - New exports `jpegVizReadout` (`{ zigzag: 10 }`) and `jpegInspectFixture` (`tables`, `huffman`, `segments`).
    - `FakeEngine.viz_readout()` and `rule_inspect(key)` answer for the JPEG lab.
    - `makeVizMock()` gains `jpeg_encode_stats`, `jpeg_encode_decode` and `jpeg_huffman_tree`.

- [ ] **Step 1: Extend the test fake.** Apply to `web/src/lib/test/fakeViz.ts`:

```diff
--- a/web/src/lib/test/fakeViz.ts
+++ b/web/src/lib/test/fakeViz.ts
@@ -127,15 +127,48 @@
     zigzag: jpegBlock.map((_, i) => (i === 0 ? 8 : 0)),
     dc_prev: 6,
     dc_diff: 2,
-    tokens: [{ run: 0, size: 0, amp: 0, symbol: 0 }],
-    bit_span: [100, 6],
-    bits: '010101',
+    dc_size: 2,
+    dc_code: '011',
+    dc_amp_bits: '10',
+    tokens: [{ run: 0, size: 0, amp: 0, symbol: 0, code: '1010', amp_bits: '' }],
+    bit_span: [100, 9],
+    bits: '011101010',
   },
+  hints: { blocking: [3, 4], ringing: [5, 6], bleed: [7, 8] },
   error: undefined as string | undefined,
 };
 
 /** What the fake's `viz_readout()` returns on the notes lab (null elsewhere). Mutable so a test can move the 4D angle. */
 export const notesVizReadout = { angle_4d: 0 };
+
+/** What the fake's `viz_readout()` returns on the JPEG lab: how far the zigzag path has got. Mutable. */
+export const jpegVizReadout = { zigzag: 10 };
+
+/** What the fake's `rule_inspect(key)` returns on the JPEG lab, by key. */
+export const jpegInspectFixture: Record<string, unknown> = {
+  tables: { luma: Array.from({ length: 64 }, () => 16), chroma: Array.from({ length: 64 }, () => 17) },
+  huffman: ['dc_luma', 'ac_luma', 'dc_chroma', 'ac_chroma'].map((name) => ({
+    name,
+    bits: [0, 2, ...Array.from({ length: 14 }, () => 0)],
+    vals: [0, 1],
+    codes: [
+      { symbol: 0, code: '00' },
+      { symbol: 1, code: '01' },
+    ],
+    counts: [
+      [0, 30],
+      [1, 10],
+    ],
+    entropy_bits: 32.5,
+    actual_bits: 80,
+  })),
+  segments: [
+    { marker: 0xd8, kind: 'Soi', offset: 0, len: 2 },
+    { marker: 0xdb, kind: 'Dqt', offset: 2, len: 134 },
+    { marker: 0xda, kind: 'Sos', offset: 136, len: 3958 },
+    { marker: 0xd9, kind: 'Eoi', offset: 4094, len: 2 },
+  ],
+};
 
 /** What the fake's `snapshot()` returns. Mutable so a test can park the clock mid-scan, playing. */
 export const snapshotFixture = {
@@ -168,14 +201,17 @@
     if (this._lab === 'jpeg') return jpegSummaryFixture;
     return null;
   }
-  viz_readout() { return this._lab === 'notes' ? notesVizReadout : null; }
+  viz_readout() {
+    if (this._lab === 'notes') return notesVizReadout;
+    return this._lab === 'jpeg' ? jpegVizReadout : null;
+  }
   viz_config() { return {}; }
   update_rule_config(cfg: unknown) { updateRuleConfigSpy(cfg); }
   update_rule_config_with_path(cfg: unknown, xy: Float32Array, pen: Uint8Array) { updateRuleConfigWithPathSpy(cfg, xy, pen); }
   update_rule_config_with_image(cfg: unknown, w: number, h: number, rgba: Uint8Array) {
     updateRuleConfigWithImageSpy(cfg, w, h, rgba);
   }
-  rule_inspect(_key: string) { return undefined; }
+  rule_inspect(key: string) { return this._lab === 'jpeg' ? jpegInspectFixture[key] : undefined; }
   rule_bytes() { return this._lab === 'jpeg' ? new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) : undefined; }
   update_viz_config(cfg: unknown) { updateVizConfigSpy(cfg); }
   rule_action(action: unknown) { ruleActionSpy(action); return true; }
@@ -195,5 +231,18 @@
     jpeg_zigzag_order: () => Uint8Array.from({ length: 64 }, (_, i) => i),
     jpeg_dct_1d: (x: Float32Array) => Float32Array.from(x, (_, i) => (i === 0 ? 10 : 0)),
     jpeg_dft_1d: (x: Float32Array) => new Float32Array(x.length * 2).fill(1),
+    // Size grows and PSNR climbs with quality; the other Huffman mode costs 5000 bytes at any quality.
+    jpeg_encode_stats: (_rgba: Uint8Array, _w: number, _h: number, q: number, _s: string, huffman: string) => ({
+      bytes: huffman === 'standard' ? 5000 : 1000 + 40 * q,
+      psnr: 20 + q / 5,
+    }),
+    // Each generation drifts one more level from the original in every channel.
+    jpeg_encode_decode: (rgba: Uint8Array) => Uint8Array.from(rgba, (v) => Math.min(255, v + 1)),
+    jpeg_huffman_tree: () => [
+      { depth: 0, code: '', symbol: null },
+      { depth: 1, code: '0', symbol: null },
+      { depth: 2, code: '00', symbol: 0 },
+      { depth: 2, code: '01', symbol: 1 },
+    ],
   } as unknown as typeof import('viz-core');
 }
```

- [ ] **Step 2: Write the failing tests.**

`web/src/lib/jpeg/__tests__/layout.test.ts`:

```diff
--- a/web/src/lib/jpeg/__tests__/layout.test.ts
+++ b/web/src/lib/jpeg/__tests__/layout.test.ts
@@ -1,5 +1,6 @@
 import { describe, it, expect } from 'vitest';
 import {
+  CAPTION_MIN,
   LABEL,
   MARGIN,
   PORTRAIT_BELOW,
@@ -19,7 +20,7 @@
 const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
 
 describe('jpegLayout', () => {
-  const stages: StageId[] = ['color', 'subsample', 'blocks', 'dct'];
+  const stages: StageId[] = ['color', 'subsample', 'blocks', 'dct', 'quantize', 'zigzag', 'rle', 'huffman', 'decode'];
 
   for (const [w, h] of [
     [1134, 585],
@@ -29,13 +30,19 @@
     for (const stage of stages) {
       it(`keeps every ${stage} panel on a ${w}×${h} stage, captions included, without overlaps`, () => {
         const l = jpegLayout(stage, w, h, 256, 256, [10, 10]);
-        expect(l.panels.length).toBeGreaterThan(1);
+        // Every stage has the image plus at least one panel or slot of its own.
+        expect(l.panels.length + Object.keys(l.slots).length).toBeGreaterThan(1);
         for (const p of l.panels) {
           expect(p.rect.w).toBeGreaterThan(0);
           expect(inside({ ...p.rect, y: p.rect.y - LABEL, h: p.rect.h + LABEL }, w, h)).toBe(true);
         }
         for (let i = 0; i < l.panels.length; i++)
           for (let j = i + 1; j < l.panels.length; j++) expect(overlap(l.panels[i].rect, l.panels[j].rect)).toBe(false);
+        // Slots (DOM tools) stay on the stage and off the GL panels.
+        for (const r of Object.values(l.slots)) {
+          expect(inside(r!, w, h)).toBe(true);
+          for (const p of l.panels) expect(overlap(r!, p.rect)).toBe(false);
+        }
       });
     }
   }
@@ -70,6 +77,29 @@
     const crops = l.panels.filter((p) => p.crop).map((p) => p.crop);
     expect(crops).toHaveLength(4);
     expect(new Set(crops.map((c) => c!.join()))).toEqual(new Set(['156,124,32,32']));
+  });
+
+  it('gives each new stage its panels and slots', () => {
+    const kinds = (st: StageId) => jpegLayout(st, 1134, 585, 256, 256, [10, 10]).panels.map((p) => p.kind);
+    const slots = (st: StageId) => Object.keys(jpegLayout(st, 1134, 585, 256, 256, [10, 10]).slots).sort();
+    expect(kinds('quantize')).toEqual(['image', 'coeffs', 'quant', 'dequant_rebuild']);
+    expect(slots('quantize')).toEqual(['qtable', 'rd']);
+    expect(kinds('zigzag')).toEqual(['image', 'zigzag']);
+    expect(slots('zigzag')).toEqual(['sequence']);
+    expect(kinds('rle')).toEqual(['image', 'quant']);
+    expect(slots('rle')).toEqual(['tokens']);
+    expect(kinds('huffman')).toEqual(['image']);
+    expect(slots('huffman')).toEqual(['huffman']);
+    expect(kinds('decode')).toEqual(['image', 'wipe', 'error']);
+    expect(slots('decode')).toEqual(['resave']);
+    expect(slots('dct')).toEqual(['charts']);
+  });
+
+  it('starts the R–D chart clear of the rebuild caption on a phone', () => {
+    const l = jpegLayout('quantize', 343, 520, 256, 256, [10, 10]);
+    const rebuild = l.panels.find((p) => p.kind === 'dequant_rebuild')!.rect;
+    expect(rebuild.w).toBeLessThan(CAPTION_MIN);
+    expect(l.slots.rd!.x).toBeGreaterThanOrEqual(rebuild.x + CAPTION_MIN);
   });
 
   it('gives a stage too small for anything no panels', () => {
```
`web/src/lib/jpeg/__tests__/summary.test.ts`:

```diff
--- a/web/src/lib/jpeg/__tests__/summary.test.ts
+++ b/web/src/lib/jpeg/__tests__/summary.test.ts
@@ -1,7 +1,8 @@
 import { describe, it, expect, vi, afterEach } from 'vitest';
 import { formatBytes, readSummary, readoutOf } from '../summary';
-import { busiestLine, cumulativeEnergy, mirrored, periodic, termsFor } from '../math';
-import { chromaKept, samplesKept, stageTex, NOTICE } from '../formulas';
+import { busiestLine, cumulativeEnergy, mirrored, periodic, psnrOf, termsFor } from '../math';
+import { chromaKept, lastNonZero, samplesKept, stageTex, NOTICE } from '../formulas';
+import { STAGES } from '../stages';
 import { decodeUpload, fitWithin } from '../images';
 import { jpegSummaryFixture } from '../../test/fakeViz';
 
@@ -11,9 +12,22 @@
     expect(s.total).toBe(256);
     expect(s.mcu).toEqual([16, 16, 16, 16]);
     expect(s.grids[1]).toEqual([16, 16]);
-    expect(s.selected!.bitSpan).toEqual([100, 6]);
+    expect(s.selected!.bitSpan).toEqual([100, 9]);
     expect(s.selected!.dcDiff).toBe(2);
     expect(s.error).toBeNull();
+  });
+
+  it('reads the codes that spell out the selected block, and the artifact hints', () => {
+    const s = readSummary(jpegSummaryFixture)!;
+    const sel = s.selected!;
+    expect([sel.dcSize, sel.dcCode, sel.dcAmpBits]).toEqual([2, '011', '10']);
+    expect(sel.tokens[0]).toMatchObject({ code: '1010', ampBits: '' });
+    expect(sel.dcCode + sel.dcAmpBits + sel.tokens.map((t) => t.code + t.ampBits).join('')).toBe(sel.bits);
+    expect(s.hints).toEqual({ blocking: [3, 4], ringing: [5, 6], bleed: [7, 8] });
+    // A Rust None for ringing (no hard edge in the picture) stays null; a malformed hint drops them all.
+    expect(readSummary({ ...jpegSummaryFixture, hints: { blocking: [1, 2], ringing: undefined, bleed: [3, 4] } })!.hints!.ringing).toBeNull();
+    expect(readSummary({ ...jpegSummaryFixture, hints: { blocking: [1], bleed: [3, 4] } })!.hints).toBeNull();
+    expect(readSummary({ ...jpegSummaryFixture, hints: undefined })!.hints).toBeNull();
   });
 
   it('treats undefined (a Rust None) as missing, not as a value', () => {
@@ -81,11 +95,35 @@
     expect(stageTex('dct', s, [1, 0])[1]).toContain('-20.0');
     expect(stageTex('subsample', s, null)[1]).toContain('25\\%');
     expect(stageTex('color', null, null)).toHaveLength(1);
-    expect(stageTex('quantize', s, null)).toEqual([]);
+    expect(stageTex('quantize', s, null)[1]).toBe(String.raw`F_Q(0,0) = \operatorname{round}\!\left(\frac{120.0}{16}\right) = 8`);
+    expect(stageTex('quantize', s, [1, 0])[1]).toContain('\\frac{-20.0}{16}');
+    expect(stageTex('zigzag', s, null)[1]).toContain('\\#1\\text{ of }64');
+    expect(stageTex('zigzag', s, null)[1]).toContain('63\\text{ zeros follow}');
+    expect(stageTex('rle', s, null)[1]).toBe(String.raw`\Delta DC = 8 - (6) = 2,\quad \text{size} = 2`);
+    expect(stageTex('huffman', s, null)[1]).toContain('30000');
+    expect(stageTex('huffman', s, null)[1]).toContain('28000');
+    expect(stageTex('decode', s, null)[1]).toBe(String.raw`\text{PSNR} = 36.5\text{ dB}`);
+    expect(stageTex('decode', { ...s, psnr: null }, null)[1]).toContain('\\infty');
+    expect(stageTex('quantize', null, null)).toHaveLength(1);
   });
 
-  it('has a notice for every ready stage', () => {
-    for (const id of ['color', 'subsample', 'blocks', 'dct'] as const) expect(NOTICE[id].length).toBeGreaterThan(20);
+  it('has a notice for every stage', () => {
+    for (const { id } of STAGES) expect(NOTICE[id].length).toBeGreaterThan(20);
+  });
+
+  it('finds the last non-zero coefficient (-1 when there is none)', () => {
+    expect(lastNonZero([5, 0, 3, 0, 0])).toBe(2);
+    expect(lastNonZero([0, 0, 0])).toBe(-1);
+    expect(lastNonZero([])).toBe(-1);
+  });
+
+  it('measures PSNR over RGB, ignoring alpha', () => {
+    const a = new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255]);
+    expect(psnrOf(a, a)).toBe(Infinity);
+    // Every channel off by one: MSE = 1, PSNR = 20·log10(255).
+    const b = Uint8Array.from(a, (v, i) => (i % 4 === 3 ? 0 : v + 1));
+    expect(psnrOf(a, b)).toBeCloseTo(48.13, 2);
+    expect(psnrOf(a, a.slice(0, 4))).toBeNaN();
   });
 });
 
```
`web/src/lib/jpeg/__tests__/rd.test.ts` (new):

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { RD_PSNR_CAP, RD_QUALITIES, addPoint, cachedCurve, clearCurves, missing, rdKey, rdPolyline } from '../rd';

describe('rate–distortion cache', () => {
  beforeEach(() => clearCurves());

  it('samples every quality from 1 to 100', () => {
    expect(RD_QUALITIES).toHaveLength(100);
    expect([RD_QUALITIES[0], RD_QUALITIES[99]]).toEqual([1, 100]);
  });

  it('keys curves by picture and the settings that move them', () => {
    expect(rdKey('gradient', '420', 'optimized')).not.toBe(rdKey('gradient', '444', 'optimized'));
    expect(rdKey('upload-1', '420', 'optimized')).not.toBe(rdKey('upload-2', '420', 'optimized'));
  });

  it('keeps points sorted by quality, once each, and knows what is missing', () => {
    const k = rdKey('a', '420', 'optimized');
    addPoint(k, { quality: 50, bytes: 900, psnr: 33 });
    addPoint(k, { quality: 10, bytes: 300, psnr: 27 });
    addPoint(k, { quality: 50, bytes: 1, psnr: 1 });
    expect(cachedCurve(k).map((p) => p.quality)).toEqual([10, 50]);
    expect(cachedCurve(k)[1].bytes).toBe(900);
    expect(missing(k)).toHaveLength(98);
    expect(missing(k)).not.toContain(10);
    expect(cachedCurve(rdKey('b', '420', 'optimized'))).toEqual([]);
  });

  it('draws bytes across and PSNR up, capping a perfect copy at the top', () => {
    const pts = [
      { quality: 1, bytes: 0, psnr: 0 },
      { quality: 50, bytes: 500, psnr: RD_PSNR_CAP / 2 },
      { quality: 100, bytes: 1000, psnr: Infinity },
    ];
    expect(rdPolyline(pts, 200, 100, 1000)).toBe('0.0,100.0 100.0,50.0 200.0,0.0');
    expect(rdPolyline([], 200, 100, 1000)).toBe('');
  });
});
```
`web/src/lib/jpeg/__tests__/huffman.test.ts` (new):

```ts
import { describe, it, expect } from 'vitest';
import { nodeXY, readSegments, readTables, readTree, symbolLabel, topCounts } from '../huffman';
import { jpegInspectFixture } from '../../test/fakeViz';

describe('huffman view data', () => {
  it('reads the four tables and the segments', () => {
    const t = readTables(jpegInspectFixture.huffman);
    expect(t.map((x) => x.name)).toEqual(['dc_luma', 'ac_luma', 'dc_chroma', 'ac_chroma']);
    expect(t[0]).toMatchObject({ vals: [0, 1], entropyBits: 32.5, actualBits: 80 });
    expect(t[0].codes[1]).toEqual({ symbol: 1, code: '01' });
    expect(t[0].counts).toEqual([
      [0, 30],
      [1, 10],
    ]);
    const s = readSegments(jpegInspectFixture.segments);
    expect(s.map((x) => x.kind)).toEqual(['Soi', 'Dqt', 'Sos', 'Eoi']);
    expect(s.reduce((n, x) => n + x.len, 0)).toBe(4096);
  });

  it('turns junk into empty lists and safe defaults', () => {
    expect(readTables(undefined)).toEqual([]);
    expect(readSegments({})).toEqual([]);
    expect(readTables([null, { name: 3 }])).toEqual([{ name: '', bits: [], vals: [], codes: [], counts: [], entropyBits: 0, actualBits: 0 }]);
    expect(readTree('x')).toEqual([]);
  });

  it('names symbols the way the reader thinks of them', () => {
    expect(symbolLabel('dc_luma', 5)).toBe('size 5');
    expect(symbolLabel('ac_luma', 0x00)).toBe('EOB');
    expect(symbolLabel('ac_chroma', 0xf0)).toBe('ZRL');
    expect(symbolLabel('ac_luma', 0x23)).toBe('2/3');
  });

  it('ranks counts most frequent first, ties by symbol, up to a limit', () => {
    expect(
      topCounts(
        [
          [4, 1],
          [2, 9],
          [1, 9],
          [7, 3],
        ],
        3,
      ),
    ).toEqual([
      [1, 9],
      [2, 9],
      [7, 3],
    ]);
  });

  it('places tree nodes by depth (down) and code as a binary fraction (across)', () => {
    expect(nodeXY('', 100, 40, 4)).toEqual([50, 0]);
    expect(nodeXY('0', 100, 40, 4)).toEqual([25, 10]);
    expect(nodeXY('11', 100, 40, 4)).toEqual([87.5, 20]);
    // Siblings sit either side of their parent.
    const [px] = nodeXY('01', 100, 40, 4);
    expect(nodeXY('010', 100, 40, 4)[0]).toBeLessThan(px);
    expect(nodeXY('011', 100, 40, 4)[0]).toBeGreaterThan(px);
  });
});
```

- [ ] **Step 3: Run them to see them fail.** `cd web && npx vitest run src/lib/jpeg` → FAIL (`Failed to resolve import "../rd"` …).

- [ ] **Step 4: Implement.**

`web/src/lib/jpeg/layout.ts`:

```diff
--- a/web/src/lib/jpeg/layout.ts
+++ b/web/src/lib/jpeg/layout.ts
@@ -30,7 +30,18 @@
   | 'block'
   | 'atlas'
   | 'coeffs'
-  | 'rebuild';
+  | 'rebuild'
+  | 'quant'
+  | 'dequant_rebuild'
+  | 'zigzag'
+  | 'wipe'
+  | 'error';
+
+/**
+ * Named areas the page fills with DOM content (tables, charts, chips) rather
+ * than viz panels. Each rect includes room for its own heading at the top.
+ */
+export type SlotName = 'charts' | 'qtable' | 'rd' | 'sequence' | 'tokens' | 'huffman' | 'resave';
 
 /** One thing the viz draws, and where, with the caption the overlay prints above it. */
 export interface Panel {
@@ -49,8 +60,8 @@
   image: Rect;
   /** The viz's panels, drawn in order. */
   panels: Panel[];
-  /** Room left for DOM-only content (charts), or a zero rect. */
-  extra: Rect;
+  /** Areas for DOM-only content; a stage lists only the slots it uses. */
+  slots: Partial<Record<SlotName, Rect>>;
 }
 
 /** Space around and between panels. */
@@ -59,6 +70,8 @@
 export const LABEL = 22;
 /** Below this canvas width the image goes on top instead of at the left. */
 export const PORTRAIT_BELOW = 640;
+/** A panel caption may run this wide (CSS px) even over a narrower panel. */
+export const CAPTION_MIN = 120;
 /** Room kept under a panel for the controls the overlay puts there. */
 export const TOOLS = 44;
 /** Side, in image pixels, of the window the subsample stage magnifies around the selected block. */
@@ -122,7 +135,7 @@
 ): StageLayout {
   const m = MARGIN;
   if (!(cssW > 2 * m + 40 && cssH > 2 * m + LABEL + 40 && imgW > 0 && imgH > 0)) {
-    return { image: ZERO, panels: [], extra: ZERO };
+    return { image: ZERO, panels: [], slots: {} };
   }
   let imageArea: Rect;
   let focus: Rect;
@@ -139,7 +152,7 @@
   const panels: Panel[] = [
     { kind: stage === 'blocks' ? 'image_grid' : 'image', rect: image, label: 'The image — click a block' },
   ];
-  let extra: Rect = ZERO;
+  const slots: Partial<Record<SlotName, Rect>> = {};
   const g = m;
 
   switch (stage) {
@@ -193,13 +206,59 @@
       const below = belowLabel({ x: area.x, y: area.y + side + g, w: area.w, h: area.y + area.h - (area.y + side + g) });
       const rebuildSide = Math.max(0, Math.min(below.h - TOOLS, (below.w - g) * 0.4));
       panels.push({ kind: 'rebuild', rect: { x: below.x, y: below.y, w: rebuildSide, h: rebuildSide }, label: 'Rebuilt from the first k patterns' });
-      extra = { x: below.x + rebuildSide + g, y: below.y - LABEL, w: Math.max(0, below.w - rebuildSide - g), h: below.h + LABEL };
+      slots.charts = { x: below.x + rebuildSide + g, y: below.y - LABEL, w: Math.max(0, below.w - rebuildSide - g), h: below.h + LABEL };
+      break;
+    }
+    case 'quantize': {
+      const area = belowLabel(focus);
+      const side = Math.max(0, Math.min((area.w - 2 * g) / 3, area.h * 0.42));
+      const [c0, c1, c2] = columns({ x: area.x, y: area.y, w: area.w, h: side }, 3, g);
+      panels.push({ kind: 'coeffs', rect: squareTop(c0, side), label: 'Before: the DCT' });
+      const q = squareTop(c1, side);
+      slots.qtable = { x: q.x, y: q.y - LABEL, w: q.w, h: q.h + LABEL };
+      panels.push({ kind: 'quant', rect: squareTop(c2, side), label: 'After: rounded to whole steps' });
+      const below = belowLabel({ x: area.x, y: area.y + side + g, w: area.w, h: area.y + area.h - (area.y + side + g) });
+      const rebuildSide = Math.max(0, Math.min(below.h, (below.w - g) * 0.3));
+      panels.push({ kind: 'dequant_rebuild', rect: { x: below.x, y: below.y, w: rebuildSide, h: rebuildSide }, label: 'What the decoder rebuilds' });
+      // The chart starts clear of the rebuild panel's caption, which may be wider than the panel.
+      const rdX = below.x + Math.max(rebuildSide, CAPTION_MIN) + g;
+      slots.rd = { x: rdX, y: below.y - LABEL, w: Math.max(0, below.x + below.w - rdX), h: below.h + LABEL };
+      break;
+    }
+    case 'zigzag': {
+      const area = belowLabel(focus);
+      const strip = Math.min(96, area.h * 0.3);
+      const side = Math.max(0, Math.min(area.w, area.h - strip - g));
+      const zig = squareTop({ x: area.x, y: area.y, w: area.w, h: side }, side);
+      panels.push({ kind: 'zigzag', rect: zig, label: 'The rounded block, read in zigzag order' });
+      slots.sequence = { x: area.x, y: zig.y + zig.h + g, w: area.w, h: Math.max(0, area.y + area.h - (zig.y + zig.h + g)) };
+      break;
+    }
+    case 'rle': {
+      const area = belowLabel(focus);
+      const side = Math.max(0, Math.min(area.w * 0.34, area.h * 0.5));
+      panels.push({ kind: 'quant', rect: { x: area.x, y: area.y, w: side, h: side }, label: 'The rounded block' });
+      slots.tokens = { x: area.x + side + g, y: area.y - LABEL, w: Math.max(0, area.w - side - g), h: area.h + LABEL };
+      break;
+    }
+    case 'huffman': {
+      slots.huffman = { ...focus };
+      break;
+    }
+    case 'decode': {
+      const area = belowLabel(focus);
+      const topH = Math.max(0, area.h * 0.56);
+      panels.push({ kind: 'wipe', rect: fit({ x: area.x, y: area.y, w: area.w, h: topH }, imgW, imgH), label: 'Decoded (left of the line) against the original' });
+      const below = belowLabel({ x: area.x, y: area.y + topH + g, w: area.w, h: area.y + area.h - (area.y + topH + g) });
+      const [l, r] = columns(below, 2, g);
+      panels.push({ kind: 'error', rect: fit(l, imgW, imgH), label: 'What was lost, brightened' });
+      slots.resave = { x: r.x, y: r.y - LABEL, w: r.w, h: r.h + LABEL };
       break;
     }
     default:
       break;
   }
-  return { image, panels, extra };
+  return { image, panels, slots };
 }
 
 /** Panels as the viz config wants them: `[x, y, w, h]` in device pixels. */
```
`web/src/lib/jpeg/summary.ts`:

```diff
--- a/web/src/lib/jpeg/summary.ts
+++ b/web/src/lib/jpeg/summary.ts
@@ -12,6 +12,18 @@
   amp: number;
   /** The Huffman symbol, `run << 4 | size`. */
   symbol: number;
+  /** The symbol's Huffman code as 0s and 1s. */
+  code: string;
+  /** The amplitude bits that follow the code (empty for ZRL and EOB). */
+  ampBits: string;
+}
+
+/** Luma block `[bx, by]` where each compression artifact is worst. */
+export interface Hints {
+  blocking: [number, number];
+  /** Null when the picture has no hard edges. */
+  ringing: [number, number] | null;
+  bleed: [number, number];
 }
 
 /** The block the stages follow, with every intermediate form of it. */
@@ -40,6 +52,12 @@
   dcPrev: number;
   /** This block's quantized DC minus `dcPrev`: the value that gets coded. */
   dcDiff: number;
+  /** Bits needed for `dcDiff` (the DC Huffman symbol). */
+  dcSize: number;
+  /** The DC symbol's Huffman code as 0s and 1s. */
+  dcCode: string;
+  /** The amplitude bits of `dcDiff`. */
+  dcAmpBits: string;
   /** The AC coefficients as run/size tokens (ending with EOB unless the last coefficient is non-zero). */
   tokens: AcToken[];
   /** `[start bit, length]` of this block's bits in the entropy-coded payload. */
@@ -79,12 +97,27 @@
   /** Block grid `[cols, rows]` per component. */
   grids: [number, number][];
   selected: SelectedBlock | null;
+  /** Where each artifact is worst; null when the encode failed. */
+  hints: Hints | null;
   /** Why the encode failed, or null. */
   error: string | null;
 }
 
 const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
 const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
+const str = (v: unknown) => (typeof v === 'string' ? v : '');
+const pair = (v: unknown): [number, number] | null => {
+  const p = Array.isArray(v) ? v : [];
+  return p.length === 2 && p.every((x) => typeof x === 'number') ? [p[0], p[1]] : null;
+};
+
+function readHints(v: unknown): Hints | null {
+  if (!isObj(v)) return null;
+  const blocking = pair(v.blocking);
+  const bleed = pair(v.bleed);
+  return blocking && bleed ? { blocking, ringing: pair(v.ringing), bleed } : null;
+}
+
 const nums = (v: unknown): number[] => (Array.isArray(v) ? v.map((x) => num(x)) : []);
 
 function readSelected(v: unknown): SelectedBlock | null {
@@ -105,8 +138,18 @@
     zigzag: nums(v.zigzag),
     dcPrev: num(v.dc_prev),
     dcDiff: num(v.dc_diff),
+    dcSize: num(v.dc_size),
+    dcCode: str(v.dc_code),
+    dcAmpBits: str(v.dc_amp_bits),
     tokens: Array.isArray(v.tokens)
-      ? v.tokens.filter(isObj).map((t) => ({ run: num(t.run), size: num(t.size), amp: num(t.amp), symbol: num(t.symbol) }))
+      ? v.tokens.filter(isObj).map((t) => ({
+          run: num(t.run),
+          size: num(t.size),
+          amp: num(t.amp),
+          symbol: num(t.symbol),
+          code: str(t.code),
+          ampBits: str(t.amp_bits),
+        }))
       : [],
     bitSpan: [num(span[0]), num(span[1])],
     bits: typeof v.bits === 'string' ? v.bits : '',
@@ -139,6 +182,7 @@
         })
       : [],
     selected: readSelected(raw.selected),
+    hints: readHints(raw.hints),
     error: typeof raw.error === 'string' ? raw.error : null,
   };
 }
```
`web/src/lib/jpeg/formulas.ts`:

```diff
--- a/web/src/lib/jpeg/formulas.ts
+++ b/web/src/lib/jpeg/formulas.ts
@@ -14,6 +14,20 @@
 
 /** The 8 × 8 forward DCT as written in the JPEG standard. */
 export const DCT_TEX = String.raw`F(u,v) = \tfrac14\, C(u)\, C(v) \sum_{x=0}^{7} \sum_{y=0}^{7} f(x,y)\, \cos\frac{(2x+1)u\pi}{16}\, \cos\frac{(2y+1)v\pi}{16}`;
+
+export const QUANT_TEX = String.raw`F_Q(u,v) = \operatorname{round}\!\left(\frac{F(u,v)}{Q(u,v)}\right),\qquad Q = \left\lfloor \frac{Q_{\text{base}}\cdot s + 50}{100} \right\rfloor,\; s = \begin{cases} 5000/q & q < 50 \\ 200 - 2q & q \ge 50 \end{cases}`;
+
+export const SIZE_TEX = String.raw`\text{size}(v) = \lceil \log_2(|v| + 1) \rceil,\qquad \text{token} = (\text{run of zeros},\ \text{size})\ \text{then size bits of } v`;
+
+export const CODE_TEX = String.raw`\text{code length}(x) \approx -\log_2 p(x),\qquad \text{bits} \ge \sum_x n_x \log_2 \frac{N}{n_x}`;
+
+export const PSNR_TEX = String.raw`\text{MSE} = \frac{1}{3wh}\sum (\hat I - I)^2,\qquad \text{PSNR} = 10 \log_{10} \frac{255^2}{\text{MSE}}`;
+
+/** Zigzag index of the last non-zero value (−1 when all are zero). */
+export function lastNonZero(zigzag: readonly number[]): number {
+  for (let k = zigzag.length - 1; k >= 0; k--) if (zigzag[k] !== 0) return k;
+  return -1;
+}
 
 /** Share of the chroma samples a mode keeps (each of Cb and Cr). */
 export function chromaKept(subsampling: string | null): number {
@@ -54,6 +68,42 @@
       const cv = v === 0 ? String.raw`\tfrac{1}{\sqrt2}` : '1';
       return [DCT_TEX, String.raw`F(${u},${v}) = \tfrac14 \cdot ${cu} \cdot ${cv} \sum \sum f(x,y)\cos\cdots = ${fmt(val, 1)}`];
     }
+    case 'quantize': {
+      if (!sel) return [QUANT_TEX];
+      const [u, v] = hover ?? [0, 0];
+      const i = u + 8 * v;
+      return [
+        QUANT_TEX,
+        String.raw`F_Q(${u},${v}) = \operatorname{round}\!\left(\frac{${fmt(sel.dct[i], 1)}}{${fmt(sel.table[i])}}\right) = ${fmt(sel.quant[i])}`,
+      ];
+    }
+    case 'zigzag': {
+      if (!sel) return [];
+      const last = lastNonZero(sel.zigzag);
+      return [
+        String.raw`\text{scan order: } (0,0),\,(1,0),\,(0,1),\,(0,2),\,(1,1),\,(2,0),\,\ldots,\,(7,7)`,
+        String.raw`\text{last non-zero} = \#${last + 1}\text{ of }64,\quad ${63 - last}\text{ zeros follow}`,
+      ];
+    }
+    case 'rle': {
+      if (!sel) return [SIZE_TEX];
+      return [
+        SIZE_TEX,
+        String.raw`\Delta DC = ${fmt(sel.quant[0])} - (${fmt(sel.dcPrev)}) = ${fmt(sel.dcDiff)},\quad \text{size} = ${sel.dcSize}`,
+      ];
+    }
+    case 'huffman': {
+      if (!s) return [CODE_TEX];
+      return [
+        CODE_TEX,
+        String.raw`\text{this image: } ${Math.round(s.payloadBits)}\text{ bits written} \ge ${Math.round(s.entropyBits)}\text{ bits (Shannon bound for its symbols)}`,
+      ];
+    }
+    case 'decode': {
+      if (!s) return [PSNR_TEX];
+      const psnr = s.psnr == null ? String.raw`\infty` : String.raw`${fmt(s.psnr, 1)}\text{ dB}`;
+      return [PSNR_TEX, String.raw`\text{PSNR} = ${psnr}`];
+    }
     default:
       return [];
   }
@@ -69,9 +119,14 @@
     'From here on the image is a pile of independent 8 × 8 problems, 64 numbers each. Click anywhere on the image to follow a different block.',
   dct:
     'A handful of low-frequency patterns carry almost all the energy. Slide k up from 0 and watch the block appear long before all 64 terms are in.',
-  quantize: '',
-  zigzag: '',
-  rle: '',
-  huffman: '',
-  decode: '',
+  quantize:
+    'Most of the loss happens here: each coefficient is divided by its table entry and rounded. The high-frequency corner has big entries, so it rounds to zero first. Edit a cell and apply it to see the whole image respond.',
+  zigzag:
+    'Reading the grid along the zigzag puts the low frequencies first, so the zeros the rounding made gather into one long tail at the end.',
+  rle:
+    'Sixty-four numbers become a handful of tokens: each says how many zeros to skip and how big the next number is, and one end-of-block token stands for the whole tail of zeros.',
+  huffman:
+    'Common symbols get short codes and rare ones long codes, so the file comes close to the entropy limit. Switch between optimized and standard tables to see what tailoring the codes to this image saves.',
+  decode:
+    'Undo every step and compare. Blocking, ringing and colour bleed are each the fingerprint of a step you have already seen; the hints jump to where each is worst.',
 };
```
`web/src/lib/jpeg/math.ts`:

```diff
--- a/web/src/lib/jpeg/math.ts
+++ b/web/src/lib/jpeg/math.ts
@@ -61,3 +61,20 @@
   }
   return best;
 }
+
+/**
+ * PSNR in dB between two same-size RGBA buffers over R, G and B (alpha
+ * ignored): Infinity when identical, NaN when the sizes differ.
+ */
+export function psnrOf(a: Uint8Array, b: Uint8Array): number {
+  if (a.length !== b.length || a.length % 4 !== 0) return NaN;
+  let sum = 0;
+  for (let i = 0; i < a.length; i += 4) {
+    for (let c = 0; c < 3; c++) {
+      const d = a[i + c] - b[i + c];
+      sum += d * d;
+    }
+  }
+  const mse = sum / ((a.length / 4) * 3);
+  return mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse);
+}
```
`web/src/lib/jpeg/rd.ts` (new):

```ts
// The rate–distortion curve: file size against quality (PSNR) as the quality
// setting sweeps 1–100. Each point is a full encode + decode through the Rust
// kit, so the sweep runs a few points per animation frame and the result is
// cached per picture and settings.

/** One encode: its size and how close the decoded copy is (Infinity for a perfect one). */
export interface RdPoint {
  quality: number;
  bytes: number;
  psnr: number;
}

/** The qualities the curve samples: every one from 1 to 100. */
export const RD_QUALITIES: readonly number[] = Array.from({ length: 100 }, (_, i) => i + 1);

/** Points computed per animation frame. */
export const RD_PER_FRAME = 4;

/** PSNR values above this are drawn at the top of the chart. */
export const RD_PSNR_CAP = 60;

const cache = new Map<string, RdPoint[]>();

/** The cache key for a picture (by identity tag) and the settings that change the curve. */
export function rdKey(imageTag: string, subsampling: string, huffman: string): string {
  return `${imageTag}|${subsampling}|${huffman}`;
}

/** Whatever has been computed for `key` so far (possibly a partial curve). */
export function cachedCurve(key: string): RdPoint[] {
  return cache.get(key) ?? [];
}

/** Record a point for `key`, keeping the curve sorted by quality. */
export function addPoint(key: string, p: RdPoint) {
  const pts = cache.get(key) ?? [];
  if (!pts.some((q) => q.quality === p.quality)) {
    pts.push(p);
    pts.sort((a, b) => a.quality - b.quality);
  }
  cache.set(key, pts);
}

/** The qualities still missing from `key`'s curve. */
export function missing(key: string): number[] {
  const have = new Set(cachedCurve(key).map((p) => p.quality));
  return RD_QUALITIES.filter((q) => !have.has(q));
}

/** Forget every curve (tests). */
export function clearCurves() {
  cache.clear();
}

/** SVG polyline points for `pts` in a `w × h` box: x = bytes (0 to the largest), y = PSNR (0 to `RD_PSNR_CAP`). */
export function rdPolyline(pts: readonly RdPoint[], w: number, h: number, maxBytes: number): string {
  return pts
    .map((p) => {
      const x = maxBytes > 0 ? (p.bytes / maxBytes) * w : 0;
      const y = h - (Math.min(p.psnr, RD_PSNR_CAP) / RD_PSNR_CAP) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}
```
`web/src/lib/jpeg/huffman.ts` (new):

```ts
// The Huffman stage's data: the four tables from `rule_inspect("huffman")`,
// the file's segments from `rule_inspect("segments")`, and the geometry for
// drawing a code tree. Parsed defensively, like the summary.

/** One Huffman table as the rule reports it. */
export interface HuffTableView {
  /** `dc_luma`, `ac_luma`, `dc_chroma` or `ac_chroma`. */
  name: string;
  /** Codes of each length 1–16 (the DHT form). */
  bits: number[];
  /** Symbols in code order. */
  vals: number[];
  /** Each symbol's code as 0s and 1s, in code order. */
  codes: { symbol: number; code: string }[];
  /** `[symbol, count]` for every symbol this image used. */
  counts: [number, number][];
  /** Shannon's bound for these counts, in bits. */
  entropyBits: number;
  /** Bits the codes actually spend on these counts (amplitude bits excluded). */
  actualBits: number;
}

/** One marker segment of the file. */
export interface SegmentView {
  marker: number;
  /** `Soi`, `App0`, `Dqt`, `Sof0`, `Dht`, `Sos`, `Eoi`, … */
  kind: string;
  offset: number;
  /** Bytes, including the scan data for `Sos`. */
  len: number;
}

/** One node of a code tree, placed for drawing. */
export interface TreeNodeView {
  depth: number;
  /** The code leading here, as 0s and 1s ('' for the root). */
  code: string;
  /** Set on leaves. */
  symbol: number | null;
}

/** Tab labels, in table order. */
export const TABLE_LABELS: Record<string, string> = {
  dc_luma: 'DC · luma',
  ac_luma: 'AC · luma',
  dc_chroma: 'DC · chroma',
  ac_chroma: 'AC · chroma',
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const nums = (v: unknown) => (Array.isArray(v) ? v.map(num) : []);

/** Parse `rule_inspect("huffman")`; an empty list when it isn't one. */
export function readTables(raw: unknown): HuffTableView[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isObj).map((t) => ({
    name: typeof t.name === 'string' ? t.name : '',
    bits: nums(t.bits),
    vals: nums(t.vals),
    codes: Array.isArray(t.codes)
      ? t.codes.filter(isObj).map((c) => ({ symbol: num(c.symbol), code: typeof c.code === 'string' ? c.code : '' }))
      : [],
    counts: Array.isArray(t.counts) ? t.counts.map((c) => [num(nums(c)[0]), num(nums(c)[1])] as [number, number]) : [],
    entropyBits: num(t.entropy_bits),
    actualBits: num(t.actual_bits),
  }));
}

/** Parse `rule_inspect("segments")`; an empty list when it isn't one. */
export function readSegments(raw: unknown): SegmentView[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isObj).map((s) => ({
    marker: num(s.marker),
    kind: typeof s.kind === 'string' ? s.kind : '',
    offset: num(s.offset),
    len: num(s.len),
  }));
}

/** A symbol as the reader thinks of it: the DC size, or "run/size" for AC (EOB and ZRL by name). */
export function symbolLabel(table: string, symbol: number): string {
  if (table.startsWith('dc')) return `size ${symbol}`;
  if (symbol === 0x00) return 'EOB';
  if (symbol === 0xf0) return 'ZRL';
  return `${symbol >> 4}/${symbol & 15}`;
}

/** The counts, most frequent first (ties by symbol), at most `limit` of them. */
export function topCounts(counts: readonly [number, number][], limit: number): [number, number][] {
  return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, limit);
}

/**
 * Where a tree node sits in a `w × h` box: depth runs down (to `maxDepth`),
 * and the code, read as a binary fraction, runs across — so each subtree
 * owns a slice of the width under its parent.
 */
export function nodeXY(code: string, w: number, h: number, maxDepth: number): [number, number] {
  let lo = 0;
  let hi = 1;
  for (const b of code) {
    const mid = (lo + hi) / 2;
    if (b === '0') hi = mid;
    else lo = mid;
  }
  const y = maxDepth > 0 ? (code.length / maxDepth) * h : 0;
  return [((lo + hi) / 2) * w, y];
}

/** Parse the kit's `jpeg_huffman_tree` output. */
export function readTree(raw: unknown): TreeNodeView[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isObj).map((n) => ({
    depth: num(n.depth),
    code: typeof n.code === 'string' ? n.code : '',
    symbol: typeof n.symbol === 'number' ? n.symbol : null,
  }));
}
```

Then keep the page compiling against the new `StageLayout`. Apply to `web/src/lib/components/labs/JpegLab.svelte`:

```diff
--- a/web/src/lib/components/labs/JpegLab.svelte
+++ b/web/src/lib/components/labs/JpegLab.svelte
@@ -52,7 +52,7 @@
   /** Why the last picture could not be loaded (the current image stays). */
   let loadError = $state<string | null>(null);
   let summary = $state<JpegSummary | null>(null);
-  let layout = $state<StageLayout>({ image: { x: 0, y: 0, w: 0, h: 0 }, panels: [], extra: { x: 0, y: 0, w: 0, h: 0 } });
+  let layout = $state<StageLayout>({ image: { x: 0, y: 0, w: 0, h: 0 }, panels: [], slots: {} });
   let api = $state<LabApi | null>(null);
   let appliedQuery = route.query;
   let overlayEl: HTMLDivElement | null = null;
@@ -504,7 +504,7 @@
             <input type="range" min="0" max="64" step="1" value={dctK} oninput={onK} aria-label="Patterns kept" />
           </label>
         {/if}
-        <DctCharts rect={layout.extra} dct={sel.dct} shifted={sel.shifted} k={dctK} />
+        <DctCharts rect={layout.slots.charts ?? { x: 0, y: 0, w: 0, h: 0 }} dct={sel.dct} shifted={sel.shifted} k={dctK} />
       {/if}
 
       {#if loadError}
```

- [ ] **Step 5: Run the tests.**
  - `cd web && npx vitest run src/lib/jpeg` → PASS, 73 tests.
  - `npx vitest run` → 507 passed.
  - `npx svelte-check --tsconfig ./tsconfig.json` → 0 errors.

- [ ] **Step 6: Commit.**

```bash
git add web/src/lib/jpeg web/src/lib/test/fakeViz.ts web/src/lib/components/labs/JpegLab.svelte
git commit -m "feat(web): layout slots, block codes and hints, formulas, R–D cache and Huffman view data for stages 5–9"
```

---

## Task 5: The five stages on the page

Needs Task 4's modules. It type-checks against the package already on `main` (`rule_inspect`, `viz_readout` and the kit functions exist there), but the page only shows the new panels once Tasks 2–3 are built into `crates/viz-core/pkg`.

**Files:**
- Create: `web/src/lib/components/jpeg/QTable.svelte`, `web/src/lib/components/jpeg/RdChart.svelte`, `web/src/lib/components/jpeg/ZigzagStrip.svelte`, `web/src/lib/components/jpeg/TokenChips.svelte`, `web/src/lib/components/jpeg/HuffmanView.svelte`, `web/src/lib/components/jpeg/DecodeTools.svelte`
- Modify:
  - `web/src/lib/jpeg/stages.ts`: all nine stages ready.
  - `web/src/lib/jpeg/__tests__/params.test.ts`
  - `web/src/lib/components/jpeg/CellNumbers.svelte`: a `minCell` prop.
  - `web/src/lib/components/labs/JpegLab.svelte`
  - `web/src/lib/components/__tests__/JpegLab.test.ts`

**Interfaces:**
- Consumes:
  - Task 4's modules and fakes.
  - From the engine: `rule_inspect('tables' | 'huffman' | 'segments')` and `viz_readout()`, through `LabApi.readVizReadout()`.
  - Kit functions through `loadVizCore()`: `jpeg_encode_stats(rgba, w, h, q, subsampling, huffman) → { bytes, psnr }`, `jpeg_encode_decode(rgba, w, h, q, subsampling, huffman) → Uint8Array`, `jpeg_huffman_tree(bits, vals) → [{ depth, code, symbol? }]`.
- Produces:
  - **The rule config the page pushes:** `{ image_id, quality, subsampling, huffman, max_iterations, tables }`, where `tables` is `[number[], number[]] | null`.
  - **The viz config the page pushes:** `wipe` and `error_gain`, alongside `panels`, `cube_mix`, `dct_k` and `hover`.
  - **Components:**
    - `QTable { rect, table, which, custom, onapply, onstandard }`
    - `RdChart { rect, image, imageTag, subsampling, huffman, current }`
    - `ZigzagStrip { rect, zigzag, reached }`
    - `TokenChips { rect, sel }`
    - `HuffmanView { rect, tables, segments, sel, otherBytes, bytes, huffman }`
    - `DecodeTools { rect, image, quality, subsampling, huffman, hints, wipe, gain, onwipe, ongain, onpick }`
    - `CellNumbers` gains `minCell?: number` (default 26).

- [ ] **Step 1: Write the failing tests.** Apply:

`web/src/lib/jpeg/__tests__/params.test.ts`:

```diff
--- a/web/src/lib/jpeg/__tests__/params.test.ts
+++ b/web/src/lib/jpeg/__tests__/params.test.ts
@@ -51,18 +51,18 @@
 });
 
 describe('stages', () => {
-  it('lists nine stages, the first four ready', () => {
+  it('lists nine stages, all ready', () => {
     expect(STAGES.map((s) => s.id)).toEqual(['color', 'subsample', 'blocks', 'dct', 'quantize', 'zigzag', 'rle', 'huffman', 'decode']);
-    expect(STAGES.filter((s) => s.ready).map((s) => s.id)).toEqual(['color', 'subsample', 'blocks', 'dct']);
+    expect(STAGES.every((s) => s.ready)).toBe(true);
   });
 
-  it('only lands on ready stages', () => {
-    expect(readyStage('dct')).toBe('dct');
-    expect(readyStage('huffman')).toBe('color');
+  it('lands on a named stage and steps through all nine, stopping at the ends', () => {
+    expect(readyStage('huffman')).toBe('huffman');
+    expect(readyStage('nope')).toBe('color');
     expect(readyStage(undefined)).toBe('color');
     expect(stepStage('color', -1)).toBe('color');
-    expect(stepStage('blocks', 1)).toBe('dct');
-    expect(stepStage('dct', 1)).toBe('dct');
-    expect(stepStage('quantize', 1)).toBe('color');
+    expect(stepStage('dct', 1)).toBe('quantize');
+    expect(stepStage('huffman', 1)).toBe('decode');
+    expect(stepStage('decode', 1)).toBe('decode');
   });
 });
```

`web/src/lib/components/__tests__/JpegLab.test.ts`:

```diff
--- a/web/src/lib/components/__tests__/JpegLab.test.ts
+++ b/web/src/lib/components/__tests__/JpegLab.test.ts
@@ -37,7 +37,15 @@
 Object.defineProperty(HTMLElement.prototype, 'clientWidth', size(1134, 0));
 Object.defineProperty(HTMLElement.prototype, 'clientHeight', size(0, 585));
 
-type Push = [{ image_id: string; quality: number; subsampling: string; huffman: string; max_iterations: number }, number, number, Uint8Array];
+type Config = {
+  image_id: string;
+  quality: number;
+  subsampling: string;
+  huffman: string;
+  max_iterations: number;
+  tables: [number[], number[]] | null;
+};
+type Push = [Config, number, number, Uint8Array];
 const pushes = () => updateRuleConfigWithImageSpy.mock.calls as Push[];
 const lastPush = () => pushes()[pushes().length - 1];
 const kinds = () => dispatchSpy.mock.calls.map(([c]) => (c as { kind: string }).kind);
@@ -61,7 +69,7 @@
   it('encodes the default gradient as a typed array and plays the scan', async () => {
     await renderLab();
     const [cfg, w, h, rgba] = lastPush();
-    expect(cfg).toEqual({ image_id: 'gradient', quality: 50, subsampling: '420', huffman: 'optimized', max_iterations: 256 });
+    expect(cfg).toEqual({ image_id: 'gradient', quality: 50, subsampling: '420', huffman: 'optimized', max_iterations: 256, tables: null });
     expect([w, h, rgba.length]).toEqual([256, 256, 256 * 256 * 4]);
     expect(kinds()).toContain('Play');
     expect(dispatchSpy).toHaveBeenCalledWith({ kind: 'SetSpeed', value: 64 });
@@ -118,15 +126,15 @@
   });
 
   it('loads a shared link and rewrites junk to what loaded', async () => {
-    await renderLab('img=text&q=999&s=422&h=std&stage=huffman');
-    expect(lastPush()[0]).toEqual({ image_id: 'text', quality: 100, subsampling: '422', huffman: 'standard', max_iterations: 512 });
+    await renderLab('img=text&q=999&s=422&h=std&stage=nope');
+    expect(lastPush()[0]).toEqual({ image_id: 'text', quality: 100, subsampling: '422', huffman: 'standard', max_iterations: 512, tables: null });
     expect(route.query).toBe('img=text&q=100&s=422&h=std');
   });
 
   it('moves between ready stages with the rail and the arrow keys', async () => {
     const { getByRole, container } = await renderLab();
     expect(getByRole('button', { name: /Color/ }).getAttribute('aria-current')).toBe('step');
-    expect((getByRole('button', { name: /Huffman/ }) as HTMLButtonElement).disabled).toBe(true);
+    expect((getByRole('button', { name: /Huffman/ }) as HTMLButtonElement).disabled).toBe(false);
     await fireEvent.click(getByRole('button', { name: /DCT/ }));
     expect(route.query).toBe('stage=dct');
     await fireEvent.keyDown(window, { key: 'ArrowLeft' }); // a key on the window itself (no element target)
@@ -266,4 +274,73 @@
       vi.mocked(loadVizCore).mockClear();
     }
   });
+  it('applies an edited Q table to the selected plane and goes back to the standard tables', async () => {
+    const { getByLabelText, getByRole } = await renderLab('stage=quantize');
+    const cell = await vi.waitFor(() => getByLabelText('Q(1, 0)') as HTMLInputElement);
+    await fireEvent.change(cell, { target: { value: '99' } });
+    await fireEvent.click(getByRole('button', { name: 'Apply to image' }));
+    const [luma, chroma] = lastPush()[0].tables!;
+    expect(luma[1]).toBe(99);
+    expect(luma.filter((v) => v !== 16)).toEqual([99]);
+    // The chroma plane keeps the table the encoder was using.
+    expect(chroma.every((v) => v === 17)).toBe(true);
+    await fireEvent.click(getByRole('button', { name: 'Standard' }));
+    expect(lastPush()[0].tables).toBeNull();
+  });
+
+  it('draws the rate–distortion curve from the kit', async () => {
+    const { container } = await renderLab('stage=quantize');
+    await vi.waitFor(() => expect(container.querySelector('.rd polyline')?.getAttribute('points')?.split(' ').length).toBe(100), {
+      timeout: 3000,
+    });
+    expect(container.querySelector('.rd figcaption')?.textContent).not.toContain('of 100');
+  });
+
+  it('lights the zigzag cells the viz path has reached', async () => {
+    const { container } = await renderLab('stage=zigzag');
+    await vi.waitFor(() => expect(container.querySelectorAll('.seq li.lit')).toHaveLength(10));
+    expect(container.querySelector('.strip .head')?.textContent).toContain('#1 of 64');
+    expect(container.querySelectorAll('.seq li.tail')).toHaveLength(63);
+  });
+
+  it('spells out the selected block as tokens and their bits', async () => {
+    const { container } = await renderLab('stage=rle');
+    const chips = await vi.waitFor(() => {
+      const c = container.querySelectorAll('.tokens li');
+      expect(c).toHaveLength(2);
+      return c;
+    });
+    expect(chips[0].textContent).toContain('DC +2');
+    expect(chips[0].textContent).toContain('01110');
+    expect(chips[1].textContent).toContain('EOB');
+    expect(container.querySelector('.tokens .head')?.textContent).toContain('2 tokens and 9 bits');
+  });
+
+  it('shows the Huffman tables, the block bits, the file and what the other tables would cost', async () => {
+    const { container, getByRole } = await renderLab('stage=huffman');
+    await vi.waitFor(() => expect(container.querySelectorAll('[role="tab"]')).toHaveLength(4));
+    expect(getByRole('tab', { name: 'AC · luma' }).getAttribute('aria-selected')).toBe('true');
+    await vi.waitFor(() => expect(container.querySelector('p.stat')?.textContent).toContain('5000'));
+    expect(container.querySelector('p.stat')?.textContent).toContain('With standard tables');
+    expect(container.querySelector('.huff .bits')?.textContent).toBe('011101010');
+    expect(container.querySelectorAll('.file .seg')).toHaveLength(4);
+    await vi.waitFor(() => expect(container.querySelectorAll('circle.leaf')).toHaveLength(2));
+  });
+
+  it('jumps to the artifact hints, sets the wipe and error gain, and re-saves twenty times', async () => {
+    const { getByRole, getByLabelText, container } = await renderLab('stage=decode');
+    await vi.waitFor(() => getByRole('button', { name: 'Ringing' }));
+    ruleActionSpy.mockClear();
+    await fireEvent.click(getByRole('button', { name: 'Ringing' }));
+    expect(ruleActionSpy).toHaveBeenLastCalledWith({ kind: 'select_block', component: 0, bx: 5, by: 6 });
+    expect(route.query).toContain('b=5,6');
+    await fireEvent.input(getByLabelText('Decoded share of the comparison'), { target: { value: '0.25' } });
+    expect(lastViz().wipe).toBe(0.25);
+    await fireEvent.input(getByLabelText('Error brightness'), { target: { value: '9' } });
+    expect(lastViz().error_gain).toBe(9);
+    await fireEvent.click(getByRole('button', { name: /Re-save/ }));
+    await vi.waitFor(() => expect(container.querySelector('.resave')?.textContent).toContain('gen 20'), { timeout: 3000 });
+    // Each fake generation drifts one level further, so generation 20 is off by 20 in every channel.
+    expect(container.querySelector('.resave')?.textContent).toContain(`${(20 * Math.log10(255 / 20)).toFixed(2)} dB`);
+  });
 });
```

- [ ] **Step 2: Run them to see them fail.** `cd web && npx vitest run src/lib/jpeg/__tests__/params.test.ts src/lib/components/__tests__/JpegLab.test.ts` → FAIL. The stage tests still see four ready stages; the config has no `tables`; the new stage tests find none of their controls.

- [ ] **Step 3: Make every stage ready, and let `CellNumbers` show short numbers in smaller cells.** Apply:

`web/src/lib/jpeg/stages.ts`:

```diff
--- a/web/src/lib/jpeg/stages.ts
+++ b/web/src/lib/jpeg/stages.ts
@@ -34,11 +34,11 @@
   { id: 'subsample', mark: '2', title: 'Subsample', subtitle: 'Keep less colour than brightness', ready: true },
   { id: 'blocks', mark: '3', title: 'Blocks', subtitle: 'Cut each plane into 8 × 8 tiles', ready: true },
   { id: 'dct', mark: '4', title: 'DCT', subtitle: 'Rewrite a tile as 64 cosine patterns', ready: true },
-  { id: 'quantize', mark: '5', title: 'Quantize', subtitle: 'Round the patterns coarsely', ready: false },
-  { id: 'zigzag', mark: '6', title: 'Zigzag', subtitle: 'Low frequencies first', ready: false },
-  { id: 'rle', mark: '7', title: 'Run-length', subtitle: 'Count the zeros', ready: false },
-  { id: 'huffman', mark: '8', title: 'Huffman', subtitle: 'Short codes for common symbols', ready: false },
-  { id: 'decode', mark: '↺', title: 'Decode', subtitle: 'Undo it all and compare', ready: false },
+  { id: 'quantize', mark: '5', title: 'Quantize', subtitle: 'Round the patterns coarsely', ready: true },
+  { id: 'zigzag', mark: '6', title: 'Zigzag', subtitle: 'Low frequencies first', ready: true },
+  { id: 'rle', mark: '7', title: 'Run-length', subtitle: 'Count the zeros', ready: true },
+  { id: 'huffman', mark: '8', title: 'Huffman', subtitle: 'Short codes for common symbols', ready: true },
+  { id: 'decode', mark: '↺', title: 'Decode', subtitle: 'Undo it all and compare', ready: true },
 ];
 
 /** The stage a link without `stage=` opens on. */
```

`web/src/lib/components/jpeg/CellNumbers.svelte`:

```diff
--- a/web/src/lib/components/jpeg/CellNumbers.svelte
+++ b/web/src/lib/components/jpeg/CellNumbers.svelte
@@ -13,15 +13,15 @@
     digits?: number;
     /** Text colour: dark on light cells, light on dark ones. */
     shade?: (v: number) => 'dark' | 'light';
+    /** Below this cell width (CSS px) the numbers are hidden; short whole numbers fit in less. */
+    minCell?: number;
   }
 
-  let { rect, values, digits = 0, shade = () => 'light' }: Props = $props();
+  let { rect, values, digits = 0, shade = () => 'light', minCell = 26 }: Props = $props();
 
   const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
   const boxes = $derived(cells(rect, dpr));
-  /** Below this cell width the numbers would overlap. */
-  const MIN_CELL = 26;
-  const show = $derived(boxes.length > 0 && boxes[0].w >= MIN_CELL);
+  const show = $derived(boxes.length > 0 && boxes[0].w >= minCell);
   const fontPx = $derived(Math.max(9, Math.min(14, (boxes[0]?.w ?? 0) * 0.3)));
   const fmt = (v: number) => {
     const s = v.toFixed(digits);
```

- [ ] **Step 4: Create the stage components.**

`web/src/lib/components/jpeg/QTable.svelte`:

```svelte
<script lang="ts">
  // The quantization table the selected block was divided by, as 64 editable
  // cells. Edits stay local until "Apply to image" sends them (as this
  // plane's table) for a re-encode; "Standard" goes back to the
  // quality-scaled tables.
  import type { Rect } from '../../jpeg/layout';

  interface Props {
    /** Where the table goes (its heading included). */
    rect: Rect;
    /** The table in use for the selected block's plane, row-major. */
    table: readonly number[];
    /** "Luma" or "chroma": which table the selected plane uses. */
    which: string;
    /** True while custom tables are in use. */
    custom: boolean;
    /** Send an edited table for a re-encode. */
    onapply: (table: number[]) => void;
    /** Drop custom tables (back to quality scaling). */
    onstandard: () => void;
  }

  let { rect, table, which, custom, onapply, onstandard }: Props = $props();

  /** Local edits, reset whenever the table in use changes. */
  let draft = $state<number[]>([]);
  $effect(() => {
    draft = [...table];
  });
  const dirty = $derived(draft.some((v, i) => v !== table[i]));

  /** A cell's value: a whole number in 1–255 (the last valid one when the input is junk). */
  function setCell(i: number, raw: string) {
    const v = Math.round(Number(raw));
    if (Number.isFinite(v)) draft[i] = Math.min(255, Math.max(1, v));
  }
</script>

{#if rect.w > 120}
  <div class="qtable" style:left="{rect.x}px" style:top="{rect.y}px" style:width="{rect.w}px" style:height="{rect.h}px">
    <div class="head">
      <span>Q table ({which}){custom ? ' — custom' : ''}</span>
    </div>
    <div class="grid" role="group" aria-label="Quantization table, {which}">
      {#each draft as v, i}
        <input
          class="mono"
          type="number"
          min="1"
          max="255"
          value={v}
          aria-label="Q({i % 8}, {Math.floor(i / 8)})"
          onchange={(e) => setCell(i, (e.currentTarget as HTMLInputElement).value)}
        />
      {/each}
    </div>
    <div class="actions">
      <button class="chip" disabled={!dirty} onclick={() => onapply([...draft])}>Apply to image</button>
      <button class="chip" disabled={!custom} onclick={onstandard}>Standard</button>
    </div>
  </div>
{/if}

<style>
  .qtable { position: absolute; display: flex; flex-direction: column; gap: 6px; pointer-events: auto; }
  .head { font-size: 12px; color: rgba(255, 255, 255, 0.72); height: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .grid { flex: 1; display: grid; grid-template-columns: repeat(8, 1fr); grid-auto-rows: 1fr; gap: 2px; min-height: 0; }
  input {
    width: 100%;
    min-width: 0;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.9);
    font-size: 11px;
    text-align: center;
    -moz-appearance: textfield;
    appearance: textfield;
  }
  input::-webkit-inner-spin-button { display: none; }
  input:focus { outline: 1px solid var(--accent); }
  .actions { display: flex; gap: 6px; }
  .chip {
    height: 26px;
    padding: 0 10px;
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.35);
    color: rgba(255, 255, 255, 0.85);
    font-size: 12px;
    cursor: pointer;
  }
  .chip:disabled { opacity: 0.4; cursor: default; }
</style>
```
`web/src/lib/components/jpeg/RdChart.svelte`:

```svelte
<script lang="ts">
  // The rate–distortion curve for the current picture and settings: file
  // size against PSNR for every quality from 1 to 100, with a dot where the
  // slider is. The sweep runs through the kit a few encodes per frame and is
  // cached, so returning to a picture is instant.
  import { onDestroy } from 'svelte';
  import { loadVizCore } from '../../wasm/loader';
  import type { Rect } from '../../jpeg/layout';
  import type { RgbaImage } from '../../jpeg/images';
  import { RD_PER_FRAME, RD_PSNR_CAP, addPoint, cachedCurve, missing, rdKey, rdPolyline, type RdPoint } from '../../jpeg/rd';

  interface Props {
    rect: Rect;
    image: RgbaImage;
    /** Identifies the picture for the cache (the image id, or a tag per upload). */
    imageTag: string;
    subsampling: string;
    huffman: string;
    /** The current encode: where the dot goes. */
    current: { bytes: number; psnr: number | null };
  }

  let { rect, image, imageTag, subsampling, huffman, current }: Props = $props();

  let points = $state<RdPoint[]>([]);
  let frame = 0;

  // (Re)start the sweep whenever the picture or the settings change.
  $effect(() => {
    const key = rdKey(imageTag, subsampling, huffman);
    const img = image;
    points = [...cachedCurve(key)];
    cancelAnimationFrame(frame);
    let alive = true;
    void loadVizCore().then((viz) => {
      const step = () => {
        if (!alive) return;
        const todo = missing(key).slice(0, RD_PER_FRAME);
        for (const q of todo) {
          try {
            const s = viz.jpeg_encode_stats(img.rgba, img.w, img.h, q, subsampling, huffman) as { bytes: number; psnr: number };
            addPoint(key, { quality: q, bytes: s.bytes, psnr: s.psnr });
          } catch {
            addPoint(key, { quality: q, bytes: 0, psnr: 0 });
          }
        }
        points = [...cachedCurve(key)];
        if (missing(key).length > 0) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    });
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
    };
  });
  onDestroy(() => cancelAnimationFrame(frame));

  const W = $derived(Math.max(0, rect.w - 8));
  const H = $derived(Math.max(0, rect.h - 40));
  const maxBytes = $derived(Math.max(1, ...points.map((p) => p.bytes), current.bytes));
  const dot = $derived({
    x: (current.bytes / maxBytes) * W,
    y: H - (Math.min(current.psnr ?? RD_PSNR_CAP, RD_PSNR_CAP) / RD_PSNR_CAP) * H,
  });
</script>

{#if rect.w > 120 && rect.h > 90}
  <figure class="rd" style:left="{rect.x}px" style:top="{rect.y}px" style:width="{rect.w}px" style:height="{rect.h}px">
    <figcaption>Size against quality, q = 1…100 {points.length < 100 ? `(${points.length} of 100)` : ''}</figcaption>
    <svg width={W} height={H} aria-label="Rate–distortion curve">
      <line class="axis" x1="0" y1={H} x2={W} y2={H} />
      <line class="axis" x1="0" y1="0" x2="0" y2={H} />
      <polyline class="curve" points={rdPolyline(points, W, H, maxBytes)} />
      <circle class="dot" cx={dot.x} cy={dot.y} r="4" />
    </svg>
    <div class="axes"><span>0</span><span>file size</span><span>{Math.round(maxBytes / 1024)} KB</span></div>
  </figure>
{/if}

<style>
  .rd { position: absolute; margin: 0; color: rgba(255, 255, 255, 0.72); font-size: 12px; }
  figcaption { height: 18px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  svg { display: block; overflow: visible; margin-left: 4px; }
  .axis { stroke: rgba(255, 255, 255, 0.25); }
  .curve { fill: none; stroke: #e27a52; stroke-width: 1.5; }
  .dot { fill: #fff; stroke: #e27a52; stroke-width: 2; }
  .axes { display: flex; justify-content: space-between; font-size: 11px; margin-top: 2px; }
</style>
```
`web/src/lib/components/jpeg/ZigzagStrip.svelte`:

```svelte
<script lang="ts">
  // The 64 rounded coefficients in zigzag order, as one sequence: the ones the
  // scan path has reached are lit, and the run of zeros after the last
  // non-zero value is marked as the tail the next stage throws away.
  import type { Rect } from '../../jpeg/layout';
  import { lastNonZero } from '../../jpeg/formulas';

  interface Props {
    rect: Rect;
    /** The block's quantized values in zigzag order. */
    zigzag: readonly number[];
    /** How many cells the path has reached (0–64). */
    reached: number;
  }

  let { rect, zigzag, reached }: Props = $props();

  const last = $derived(lastNonZero(zigzag));
</script>

{#if rect.w > 120 && rect.h > 40}
  <div class="strip" style:left="{rect.x}px" style:top="{rect.y}px" style:width="{rect.w}px" style:height="{rect.h}px">
    <div class="head">Last non-zero: <span class="mono">#{last + 1}</span> of 64 — then {63 - last} zeros</div>
    <ol class="seq mono" aria-label="Coefficients in zigzag order">
      {#each zigzag as v, k}
        <li class:lit={k < reached} class:tail={k > last}>{v}</li>
      {/each}
    </ol>
  </div>
{/if}

<style>
  .strip { position: absolute; display: flex; flex-direction: column; gap: 6px; color: rgba(255, 255, 255, 0.72); font-size: 12px; }
  .head { white-space: nowrap; }
  .seq { display: flex; flex-wrap: wrap; gap: 2px; margin: 0; padding: 0; list-style: none; }
  li {
    min-width: 26px;
    padding: 2px 0;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.05);
    text-align: center;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.45);
  }
  li.lit { background: rgba(226, 122, 82, 0.35); color: #fff; }
  li.tail { opacity: 0.45; text-decoration: line-through; text-decoration-color: rgba(255, 255, 255, 0.3); }
</style>
```
`web/src/lib/components/jpeg/TokenChips.svelte`:

```svelte
<script lang="ts">
  // The selected block as the encoder writes it: the DC value as a difference
  // from the previous block's, then the AC coefficients as (zeros skipped,
  // size) tokens with their amplitudes. Each chip shows the bits it becomes:
  // the Huffman code, then the amplitude bits.
  import type { Rect } from '../../jpeg/layout';
  import type { SelectedBlock } from '../../jpeg/summary';

  interface Props {
    rect: Rect;
    sel: SelectedBlock;
  }

  let { rect, sel }: Props = $props();

  /** What a token stands for, in words. */
  function label(t: SelectedBlock['tokens'][number]): string {
    if (t.size === 0 && t.run === 0) return 'EOB';
    if (t.size === 0 && t.run === 15) return 'ZRL';
    return `(${t.run}, ${t.size}) ${t.amp}`;
  }

  function title(t: SelectedBlock['tokens'][number]): string {
    if (t.size === 0 && t.run === 0) return 'End of block: every remaining coefficient is zero';
    if (t.size === 0 && t.run === 15) return 'Sixteen zeros in a row';
    return `Skip ${t.run} zero${t.run === 1 ? '' : 's'}, then ${t.amp} (needs ${t.size} bit${t.size === 1 ? '' : 's'})`;
  }

  const bitCount = $derived(sel.bits.length);
</script>

{#if rect.w > 120}
  <div class="tokens" style:left="{rect.x}px" style:top="{rect.y}px" style:width="{rect.w}px" style:height="{rect.h}px">
    <div class="head">64 numbers become {sel.tokens.length + 1} tokens and {bitCount} bits</div>
    <ul>
      <li class="chip dc" title="DC: this block's average, stored as the change from the previous block's ({sel.dcPrev})">
        <span class="what">DC {sel.dcDiff >= 0 ? '+' : ''}{sel.dcDiff}</span>
        <span class="bits mono"><span class="code">{sel.dcCode}</span><span class="amp">{sel.dcAmpBits}</span></span>
      </li>
      {#each sel.tokens as t, i (i)}
        <li class="chip" class:end={t.size === 0} title={title(t)}>
          <span class="what">{label(t)}</span>
          <span class="bits mono"><span class="code">{t.code}</span><span class="amp">{t.ampBits}</span></span>
        </li>
      {/each}
    </ul>
    <div class="key"><span class="sw code"></span>Huffman code <span class="sw amp"></span>amplitude bits</div>
  </div>
{/if}

<style>
  .tokens { position: absolute; display: flex; flex-direction: column; gap: 8px; overflow: auto; color: rgba(255, 255, 255, 0.72); font-size: 12px; pointer-events: auto; }
  .head { white-space: nowrap; }
  ul { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }
  .chip {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 4px 8px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.3);
  }
  .chip.dc { border-color: var(--accent); }
  .chip.end { border-style: dashed; }
  .what { color: rgba(255, 255, 255, 0.9); white-space: nowrap; }
  .bits { font-size: 11px; letter-spacing: 0.5px; word-break: break-all; }
  .code { color: #e9a07c; }
  .amp { color: #8fb7f2; }
  .key { display: flex; align-items: center; gap: 6px; font-size: 11px; }
  .sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; }
  .sw.code { background: #e9a07c; }
  .sw.amp { background: #8fb7f2; }
</style>
```
`web/src/lib/components/jpeg/HuffmanView.svelte`:

```svelte
<script lang="ts">
  // The Huffman stage: pick one of the four tables to see how often each
  // symbol occurs, the code tree that serves them (short codes high up), and
  // what the codes cost against Shannon's bound; below, the selected block's
  // bits coloured by part and the whole file as a bar of its segments.
  import { onMount } from 'svelte';
  import { loadVizCore, type VizCore } from '../../wasm/loader';
  import type { Rect } from '../../jpeg/layout';
  import type { SelectedBlock } from '../../jpeg/summary';
  import {
    TABLE_LABELS,
    nodeXY,
    readTree,
    symbolLabel,
    topCounts,
    type HuffTableView,
    type SegmentView,
  } from '../../jpeg/huffman';

  interface Props {
    rect: Rect;
    tables: HuffTableView[];
    segments: SegmentView[];
    sel: SelectedBlock | null;
    /** File size with the other Huffman mode, when known (for the comparison line). */
    otherBytes: number | null;
    bytes: number;
    huffman: string;
  }

  let { rect, tables, segments, sel, otherBytes, bytes, huffman }: Props = $props();

  let kit = $state<VizCore | null>(null);
  onMount(() => {
    let alive = true;
    void loadVizCore()
      .then((v) => {
        if (alive) kit = v;
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  });

  let tab = $state(1); // AC · luma: the biggest table
  const table = $derived(tables[tab] ?? null);
  const bars = $derived(table ? topCounts(table.counts, 24) : []);
  const maxCount = $derived(Math.max(1, ...bars.map((b) => b[1])));
  const tree = $derived(table && kit ? readTree(kit.jpeg_huffman_tree(new Uint8Array(table.bits), new Uint8Array(table.vals))) : []);
  const maxDepth = $derived(Math.max(1, ...tree.map((n) => n.depth)));
  const codeOf = $derived(new Map(table?.codes.map((c) => [c.symbol, c.code]) ?? []));
  const fileBytes = $derived(Math.max(1, segments.reduce((s, g) => s + g.len, 0)));

  /** The selected block's bits split by part, in file order. */
  const parts = $derived.by(() => {
    if (!sel) return [] as { text: string; kind: 'code' | 'amp' }[];
    const out: { text: string; kind: 'code' | 'amp' }[] = [
      { text: sel.dcCode, kind: 'code' },
      { text: sel.dcAmpBits, kind: 'amp' },
    ];
    for (const t of sel.tokens) out.push({ text: t.code, kind: 'code' }, { text: t.ampBits, kind: 'amp' });
    return out.filter((p) => p.text.length > 0);
  });

  const W = $derived(Math.max(0, rect.w));
  const chartH = $derived(Math.max(0, Math.min(220, rect.h - 190)));
  const half = $derived(Math.max(0, W / 2 - 8));
  /** Bar width; symbol names go under the bars when they fit. */
  const bw = $derived(half / Math.max(1, bars.length));
  /** Room under the bars for the symbol names. */
  const LABELS = 14;
</script>

{#if rect.w > 200 && rect.h > 220}
  <div class="huff" style:left="{rect.x}px" style:top="{rect.y}px" style:width="{rect.w}px" style:height="{rect.h}px">
    <div class="tabs" role="tablist" aria-label="Huffman tables">
      {#each tables as t, i (t.name)}
        <button role="tab" class="chip" aria-selected={i === tab} onclick={() => (tab = i)}>{TABLE_LABELS[t.name] ?? t.name}</button>
      {/each}
    </div>

    {#if table}
      <div class="row">
        <figure>
          <figcaption>How often each symbol occurs (top {bars.length})</figcaption>
          <svg width={half} height={chartH} aria-label="Symbol counts">
            {#each bars as [symbol, count], i}
              {@const h = (count / maxCount) * (chartH - LABELS - 4)}
              <rect class="bar" x={i * bw + 1} y={chartH - LABELS - h} width={Math.max(1, bw - 2)} height={h}>
                <title>{symbolLabel(table.name, symbol)}: {count} times, code {codeOf.get(symbol) ?? ''}</title>
              </rect>
              {#if bw >= 28}
                <text class="sym" x={i * bw + bw / 2} y={chartH - 2}>{symbolLabel(table.name, symbol).replace('size ', '')}</text>
              {/if}
            {/each}
          </svg>
        </figure>
        <figure>
          <figcaption>The code tree (left = 0, right = 1)</figcaption>
          <svg width={half} height={chartH} aria-label="Code tree">
            {#each tree as n (n.depth + ':' + n.code)}
              {#if n.depth > 0}
                {@const [x, y] = nodeXY(n.code, half, chartH - 6, maxDepth)}
                {@const [px, py] = nodeXY(n.code.slice(0, -1), half, chartH - 6, maxDepth)}
                <line class="edge" x1={px} y1={py + 3} x2={x} y2={y + 3} />
              {/if}
            {/each}
            {#each tree.filter((n) => n.symbol != null) as n (n.code)}
              {@const [x, y] = nodeXY(n.code, half, chartH - 6, maxDepth)}
              <circle class="leaf" cx={x} cy={y + 3} r="2.5"><title>{symbolLabel(table.name, n.symbol ?? 0)} = {n.code}</title></circle>
            {/each}
          </svg>
        </figure>
      </div>
      <p class="stat">
        This table: <span class="mono">{Math.round(table.actualBits)}</span> bits of codes against
        <span class="mono">{Math.round(table.entropyBits)}</span> at the entropy limit
        ({table.entropyBits > 0 ? ((100 * table.actualBits) / table.entropyBits - 100).toFixed(1) : '0.0'}% over).
        {#if otherBytes != null}
          With {huffman === 'optimized' ? 'standard' : 'optimized'} tables the file would be
          <span class="mono">{otherBytes}</span> bytes instead of <span class="mono">{bytes}</span>.
        {/if}
      </p>
    {/if}

    {#if sel}
      <div class="bits mono" aria-label="The selected block's bits">
        {#each parts as p, i (i)}<span class={p.kind}>{p.text}</span>{/each}
      </div>
    {/if}

    {#if segments.length}
      <div class="file" aria-label="The file's segments">
        {#each segments as s (s.offset)}
          <span class="seg" class:scan={s.kind === 'Sos'} style:flex-grow={Math.max(s.len / fileBytes, 0.02)} title="{s.kind}: {s.len} bytes at {s.offset}">{s.kind}</span>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .huff { position: absolute; display: flex; flex-direction: column; gap: 8px; color: rgba(255, 255, 255, 0.72); font-size: 12px; pointer-events: auto; overflow: hidden; }
  .tabs { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip {
    height: 26px;
    padding: 0 10px;
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.35);
    color: rgba(255, 255, 255, 0.85);
    font-size: 12px;
    cursor: pointer;
  }
  .chip[aria-selected='true'] { border-color: var(--accent); color: #fff; }
  .row { display: flex; gap: 16px; }
  figure { margin: 0; }
  figcaption { margin-bottom: 4px; white-space: nowrap; }
  svg { display: block; overflow: visible; }
  .bar { fill: #e27a52; }
  .sym { fill: rgba(255, 255, 255, 0.6); font-size: 10px; text-anchor: middle; }
  .edge { stroke: rgba(255, 255, 255, 0.25); }
  .leaf { fill: #8fb7f2; }
  .stat { margin: 0; line-height: 1.5; }
  .bits { font-size: 11px; line-height: 1.5; word-break: break-all; max-height: 4.5em; overflow: auto; }
  .bits .code { color: #e9a07c; }
  .bits .amp { color: #8fb7f2; }
  .file { display: flex; height: 22px; gap: 1px; }
  .seg {
    flex-basis: 0;
    min-width: 2px;
    overflow: hidden;
    padding: 0 3px;
    background: rgba(255, 255, 255, 0.12);
    font-size: 10px;
    line-height: 22px;
    white-space: nowrap;
  }
  .seg.scan { background: rgba(226, 122, 82, 0.45); color: #fff; }
</style>
```
`web/src/lib/components/jpeg/DecodeTools.svelte`:

```svelte
<script lang="ts">
  // The Decode stage's controls and its generation-loss chart: the wipe
  // between decoded and original, the error map's brightness, buttons that
  // jump to where blocking, ringing and colour bleed are worst, and "Re-save"
  // — decode, encode again with the same settings, repeat — plotting how far
  // each generation has drifted from the original.
  import { onDestroy } from 'svelte';
  import { loadVizCore } from '../../wasm/loader';
  import type { Rect } from '../../jpeg/layout';
  import type { RgbaImage } from '../../jpeg/images';
  import type { Hints } from '../../jpeg/summary';
  import { psnrOf } from '../../jpeg/math';

  interface Props {
    rect: Rect;
    image: RgbaImage;
    quality: number;
    subsampling: string;
    huffman: string;
    hints: Hints | null;
    wipe: number;
    gain: number;
    onwipe: (v: number) => void;
    ongain: (v: number) => void;
    /** Select a luma block (from a hint). */
    onpick: (block: [number, number]) => void;
  }

  let { rect, image, quality, subsampling, huffman, hints, wipe, gain, onwipe, ongain, onpick }: Props = $props();

  /** Generations re-saved per click. */
  const GENERATIONS = 20;
  /** PSNR per generation (generation 1 is the first save). */
  let history = $state<number[]>([]);
  let running = $state(false);
  let frame = 0;

  // A new picture or new settings start a fresh history.
  $effect(() => {
    void [image, quality, subsampling, huffman];
    cancelAnimationFrame(frame);
    running = false;
    history = [];
  });
  onDestroy(() => cancelAnimationFrame(frame));

  async function resave() {
    if (running) return;
    const viz = await loadVizCore();
    running = true;
    history = [];
    let current = image.rgba;
    const step = () => {
      if (!running) return;
      try {
        current = viz.jpeg_encode_decode(current, image.w, image.h, quality, subsampling, huffman);
        history = [...history, psnrOf(image.rgba, current)];
      } catch {
        running = false;
        return;
      }
      if (history.length < GENERATIONS) frame = requestAnimationFrame(step);
      else running = false;
    };
    frame = requestAnimationFrame(step);
  }

  const W = $derived(Math.max(0, rect.w - 8));
  const H = $derived(Math.max(0, rect.h - 150));
  const finite = $derived(history.filter((v) => Number.isFinite(v)));
  const top = $derived(Math.max(10, ...finite) + 2);
  const bottom = $derived(Math.max(0, Math.min(...(finite.length ? finite : [top - 10])) - 2));
  const points = $derived(
    history
      .map((v, i) => {
        const y = Number.isFinite(v) ? H - ((v - bottom) / Math.max(1, top - bottom)) * H : 0;
        return `${((i / (GENERATIONS - 1)) * W).toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' '),
  );
</script>

{#if rect.w > 160 && rect.h > 160}
  <div class="tools" style:left="{rect.x}px" style:top="{rect.y}px" style:width="{rect.w}px" style:height="{rect.h}px">
    <label class="ctl">
      <span>Wipe</span>
      <input type="range" min="0" max="1" step="0.01" value={wipe} oninput={(e) => onwipe(Number((e.currentTarget as HTMLInputElement).value))} aria-label="Decoded share of the comparison" />
    </label>
    <label class="ctl">
      <span>Error × <span class="mono">{gain}</span></span>
      <input type="range" min="1" max="16" step="1" value={gain} oninput={(e) => ongain(Number((e.currentTarget as HTMLInputElement).value))} aria-label="Error brightness" />
    </label>
    {#if hints}
      <div class="hints" role="group" aria-label="Jump to an artifact">
        <button class="chip" onclick={() => onpick(hints.blocking)} title="The block whose borders compression stepped most">Blocking</button>
        <button class="chip" disabled={!hints.ringing} onclick={() => hints.ringing && onpick(hints.ringing)} title={hints.ringing ? 'The block with a hard edge that moved most' : 'This picture has no hard edges to ring'}>Ringing</button>
        <button class="chip" onclick={() => onpick(hints.bleed)} title="The block whose colour moved most">Colour bleed</button>
      </div>
    {/if}
    <div class="resave">
      <button class="chip" onclick={() => void resave()} disabled={running}>{running ? `Re-saving… ${history.length}` : `Re-save ×${GENERATIONS}`}</button>
      {#if history.length}
        <span>gen {history.length}: <span class="mono">{Number.isFinite(history[history.length - 1]) ? history[history.length - 1].toFixed(2) : '∞'} dB</span></span>
      {/if}
    </div>
    <svg width={W} height={H} aria-label="PSNR per generation">
      <line class="axis" x1="0" y1={H} x2={W} y2={H} />
      <polyline class="curve" points={points} />
    </svg>
  </div>
{/if}

<style>
  .tools { position: absolute; display: flex; flex-direction: column; gap: 8px; color: rgba(255, 255, 255, 0.8); font-size: 12px; pointer-events: auto; }
  .ctl { display: flex; align-items: center; gap: 8px; }
  .ctl > span { width: 70px; flex: none; }
  .ctl input { flex: 1; accent-color: var(--accent); }
  .hints, .resave { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .chip {
    height: 26px;
    padding: 0 10px;
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.35);
    color: rgba(255, 255, 255, 0.85);
    font-size: 12px;
    cursor: pointer;
  }
  .chip:disabled { opacity: 0.45; cursor: default; }
  svg { display: block; overflow: visible; margin-left: 4px; }
  .axis { stroke: rgba(255, 255, 255, 0.25); }
  .curve { fill: none; stroke: #e27a52; stroke-width: 1.5; }
</style>
```

- [ ] **Step 5: Wire them into the page.** Apply to `web/src/lib/components/labs/JpegLab.svelte`:

```diff
--- a/web/src/lib/components/labs/JpegLab.svelte
+++ b/web/src/lib/components/labs/JpegLab.svelte
@@ -12,6 +12,12 @@
   import StageRail from '../jpeg/StageRail.svelte';
   import CellNumbers from '../jpeg/CellNumbers.svelte';
   import DctCharts from '../jpeg/DctCharts.svelte';
+  import QTable from '../jpeg/QTable.svelte';
+  import RdChart from '../jpeg/RdChart.svelte';
+  import ZigzagStrip from '../jpeg/ZigzagStrip.svelte';
+  import TokenChips from '../jpeg/TokenChips.svelte';
+  import HuffmanView from '../jpeg/HuffmanView.svelte';
+  import DecodeTools from '../jpeg/DecodeTools.svelte';
   import type { LabApi } from '../labApi.svelte';
   import { cmd } from '../../playback/commands';
   import { route, replaceQuery } from '../../router.svelte';
@@ -26,9 +32,11 @@
     type SubsamplingId,
   } from '../../jpeg/params';
   import { IMAGES, decodeUpload, loadBuiltin, type RgbaImage } from '../../jpeg/images';
-  import { blockAt, cellAt, jpegLayout, toDevicePanels, type Panel, type StageLayout } from '../../jpeg/layout';
+  import { CAPTION_MIN, blockAt, cellAt, jpegLayout, toDevicePanels, type Panel, type StageLayout } from '../../jpeg/layout';
   import { readSummary, readoutOf, type JpegSummary } from '../../jpeg/summary';
   import { NOTICE, stageTex } from '../../jpeg/formulas';
+  import { readSegments, readTables, type HuffTableView, type SegmentView } from '../../jpeg/huffman';
+  import { loadVizCore } from '../../wasm/loader';
 
   /** MCUs scanned per second by default: the 256² gradient (256 MCUs) scans in four seconds. */
   const DEFAULT_SPEED = 64;
@@ -47,6 +55,21 @@
   let dctK = $state(64);
   let hover = $state<[number, number] | null>(null);
   let showShifted = $state(true);
+  /** Decode stage: the decoded share of the comparison, and the error map's brightness. */
+  let wipe = $state(0.5);
+  let errorGain = $state(4);
+  /** Custom quantization tables `[luma, chroma]`, row-major; null = scaled from the quality. */
+  let customTables = $state.raw<[number[], number[]] | null>(null);
+  /** Huffman stage: the rule's four tables and the file's segments, read once per encode. */
+  let huffTables = $state.raw<HuffTableView[]>([]);
+  let segments = $state.raw<SegmentView[]>([]);
+  /** The file size with the other Huffman mode (null while unknown or with custom tables). */
+  let otherBytes = $state<number | null>(null);
+  /** Names the picture in the R–D cache: the image id, or one tag per upload. */
+  let imageTag = $state('gradient');
+  let uploads = 0;
+  /** Zigzag stage: how many cells the viz's scan path has reached. */
+  let zigReached = $state(0);
 
   let image = $state<RgbaImage | null>(null);
   /** Why the last picture could not be loaded (the current image stays). */
@@ -120,6 +143,48 @@
     summary = readSummary(a.readSummary());
   });
 
+  // The viz animates the zigzag path itself; read how far it has got each frame.
+  const frameSnap = $derived(api?.snapshot);
+  $effect(() => {
+    void frameSnap;
+    const a = api;
+    if (stage !== 'zigzag' || !a) return;
+    const r = a.readVizReadout() as { zigzag?: unknown } | null;
+    zigReached = typeof r?.zigzag === 'number' ? Math.min(64, Math.ceil(r.zigzag)) : 64;
+  });
+
+  // The Huffman stage reads the tables and segments once per encode.
+  const version = $derived(summary?.version ?? -1);
+  $effect(() => {
+    void version;
+    const engine = api?.engine;
+    if (stage !== 'huffman' || !engine) return;
+    huffTables = readTables(engine.rule_inspect('huffman'));
+    segments = readSegments(engine.rule_inspect('segments'));
+  });
+
+  // ...and what the other Huffman mode would cost (the kit encodes with quality-scaled tables only).
+  $effect(() => {
+    void version;
+    const img = image;
+    const other = huffman === 'optimized' ? 'standard' : 'optimized';
+    const [q, s] = [quality, subsampling];
+    otherBytes = null;
+    if (stage !== 'huffman' || !img || customTables) return;
+    let alive = true;
+    void loadVizCore().then((v) => {
+      if (!alive) return;
+      try {
+        otherBytes = (v.jpeg_encode_stats(img.rgba, img.w, img.h, q, s, other) as { bytes: number }).bytes;
+      } catch {
+        otherBytes = null;
+      }
+    });
+    return () => {
+      alive = false;
+    };
+  });
+
   /** `b` limited to the current image's luma block grid (the engine refuses blocks outside it). */
   function clampBlock(b: [number, number]): [number, number] {
     if (!image) return b;
@@ -159,7 +224,7 @@
     const wasPlaying = snap.playing;
     const max = mcuCount(img.w, img.h, subsampling);
     a.setRuleConfigWithImage(
-      { image_id: imageId, quality, subsampling, huffman, max_iterations: max },
+      { image_id: imageId, quality, subsampling, huffman, max_iterations: max, tables: customTables },
       img.w,
       img.h,
       img.rgba,
@@ -201,6 +266,7 @@
     loadError = null;
     image = img;
     imageId = id;
+    imageTag = id === 'upload' ? `upload-${++uploads}` : id;
     anchor = block ?? null;
     component = 0;
     first = true;
@@ -306,6 +372,40 @@
     api?.patchVizConfig({ dct_k: dctK });
   }
 
+  /** Use `table` for the selected block's plane (the other plane keeps the table it had) and re-encode. */
+  function applyTable(table: number[]) {
+    const cur = (api?.engine?.rule_inspect('tables') ?? null) as { luma?: number[]; chroma?: number[] } | null;
+    const next: [number[], number[]] = [customTables?.[0] ?? cur?.luma ?? table, customTables?.[1] ?? cur?.chroma ?? table];
+    next[sel && sel.component > 0 ? 1 : 0] = table;
+    customTables = next;
+    encode();
+  }
+
+  function standardTables() {
+    if (!customTables) return;
+    customTables = null;
+    encode();
+  }
+
+  function onWipe(v: number) {
+    wipe = v;
+    api?.patchVizConfig({ wipe });
+  }
+
+  function onGain(v: number) {
+    errorGain = v;
+    api?.patchVizConfig({ error_gain: errorGain });
+  }
+
+  /** Follow the luma block a Decode hint points at. */
+  function pickBlock(b: [number, number]) {
+    anchor = b;
+    component = 0;
+    selectAnchor();
+    pushLayout();
+    syncUrl();
+  }
+
   function saveJpeg() {
     const bytes = api?.engine?.rule_bytes();
     if (!bytes) return;
@@ -335,7 +435,7 @@
     const sel = summary?.selected;
     const block = anchor ?? (sel && sel.component === 0 ? ([sel.bx, sel.by] as [number, number]) : undefined);
     layout = jpegLayout(stage, canvas.clientWidth, canvas.clientHeight, image.w, image.h, block);
-    api.patchVizConfig({ panels: toDevicePanels(layout.panels, dpr), cube_mix: cubeMix, dct_k: dctK, hover });
+    api.patchVizConfig({ panels: toDevicePanels(layout.panels, dpr), cube_mix: cubeMix, dct_k: dctK, hover, wipe, error_gain: errorGain });
   }
 
   function onDrop(e: DragEvent) {
@@ -442,7 +542,7 @@
   {#snippet overlay()}
     <div class="marks" bind:this={overlayEl}>
       {#each layout.panels as p (p.kind)}
-        <span class="caption" style:left="{p.rect.x}px" style:top="{p.rect.y - 20}px" style:max-width="{Math.max(p.rect.w, 120)}px">{p.label}</span>
+        <span class="caption" style:left="{p.rect.x}px" style:top="{p.rect.y - 20}px" style:max-width="{Math.max(p.rect.w, CAPTION_MIN)}px">{p.label}</span>
       {/each}
       {#if layout.image.w > 0}
         <button
@@ -507,6 +607,92 @@
         <DctCharts rect={layout.slots.charts ?? { x: 0, y: 0, w: 0, h: 0 }} dct={sel.dct} shifted={sel.shifted} k={dctK} />
       {/if}
 
+      {#if stage === 'quantize' && sel}
+        {#each ['coeffs', 'quant'] as kind (kind)}
+          {@const r = panel(kind as Panel['kind'])}
+          {#if r}
+            <div
+              class="hover-area"
+              role="presentation"
+              style:left="{r.x}px"
+              style:top="{r.y}px"
+              style:width="{r.w}px"
+              style:height="{r.h}px"
+              onpointermove={(e) => onCellHover(e, r)}
+              onpointerdown={(e) => onCellHover(e, r)}
+              onpointerleave={clearHover}
+            ></div>
+            <CellNumbers rect={r} values={kind === 'coeffs' ? sel.dct : sel.quant} minCell={20} />
+          {/if}
+        {/each}
+        {#if layout.slots.qtable}
+          <QTable
+            rect={layout.slots.qtable}
+            table={sel.table}
+            which={sel.component === 0 ? 'Luma' : 'Chroma'}
+            custom={customTables !== null}
+            onapply={applyTable}
+            onstandard={standardTables}
+          />
+        {/if}
+        {#if layout.slots.rd && image}
+          <RdChart
+            rect={layout.slots.rd}
+            {image}
+            {imageTag}
+            {subsampling}
+            {huffman}
+            current={{ bytes: summary?.bytes ?? 0, psnr: summary?.psnr ?? null }}
+          />
+        {/if}
+      {/if}
+
+      {#if stage === 'zigzag' && sel}
+        {#if panel('zigzag')}
+          <CellNumbers rect={panel('zigzag')!} values={sel.quant} />
+        {/if}
+        {#if layout.slots.sequence}
+          <ZigzagStrip rect={layout.slots.sequence} zigzag={sel.zigzag} reached={zigReached} />
+        {/if}
+      {/if}
+
+      {#if stage === 'rle' && sel}
+        {#if panel('quant')}
+          <CellNumbers rect={panel('quant')!} values={sel.quant} minCell={20} />
+        {/if}
+        {#if layout.slots.tokens}
+          <TokenChips rect={layout.slots.tokens} {sel} />
+        {/if}
+      {/if}
+
+      {#if stage === 'huffman' && layout.slots.huffman}
+        <HuffmanView
+          rect={layout.slots.huffman}
+          tables={huffTables}
+          {segments}
+          {sel}
+          {otherBytes}
+          bytes={summary?.bytes ?? 0}
+          {huffman}
+        />
+      {/if}
+
+      {#if stage === 'decode' && layout.slots.resave && image}
+        <DecodeTools
+          rect={layout.slots.resave}
+          {image}
+          {quality}
+          {subsampling}
+          {huffman}
+          hints={summary?.hints ?? null}
+          {wipe}
+          gain={errorGain}
+          onwipe={onWipe}
+          ongain={onGain}
+          onpick={pickBlock}
+        />
+      {/if}
+
       {#if loadError}
         <p class="error" role="alert">{loadError}</p>
       {/if}
```

- [ ] **Step 6: Run the tests.**
  - `cd web && npx vitest run src/lib/components/__tests__/JpegLab.test.ts` → PASS, 26 tests.
  - `npx vitest run` → 513 passed. This includes `no-emoji.test.ts`: the copy uses words, not arrow glyphs.
  - `npx svelte-check --tsconfig ./tsconfig.json` → 0 errors.

- [ ] **Step 7: Commit.**

```bash
git add web/src
git commit -m "feat(web): JPEG lab stages 5–9 — Q table and R–D curve, zigzag, run-length, Huffman, decode"
```

---

## Task 6: Spec amendment, docs, full validation and the browser check

**Files:**
- Modify: `docs/superpowers/specs/2026-10-15-jpeg-lab-design.md`, `docs/testing.md`, `README.md` (project layout only)

- [ ] **Step 1: Amend the spec.**
  - After `## Amendment (Plan 2, 2026-10-16)`, add `## Amendment (Plan 3, 2026-10-16)`. Introduce it with "Building stages 5–9 settled these, folded into the text below:" and list the ten amendments in this plan's Global Constraints, one numbered line each, worded as decisions.
  - Then update the body to match:
    - **Part 2 rule config:** add `tables: [[u16; 64]; 2] | null`.
    - **`rule_summary()`:** add `hints` and the selected block's `dc_size`, `dc_code`, `dc_amp_bits`, and token `code` / `amp_bits`.
    - **`rule_inspect(key)`:** replace the sentence "Plan 2 implements only…" and the `"huffman"` / `"histogram"` shapes with the shapes in amendment 2. Drop `"histogram"`.
    - **Viz config:** replace "`wipe` (0–1) and `error_gain` arrive with the Decode stage (Plan 3)" with the three new fields and their defaults. Add the five panel kinds and the readout.
    - **Stage 5:** replace the `set_tables` parenthesis with "`tables` in the rule config"; replace "the zero count, the reconstructed block and its error" with "the block the decoder rebuilds".
    - **Stage 8:** replace "and canonical code table" with "with each code on its leaf and in the histogram's tooltips".
    - **Stage 9:**
      - Reword the blocking hint as amendment 4 defines it.
      - Replace "Re-save ×N (N ≤ 50 …)" with "Re-save ×20 (via `encode_decode`, one generation per frame)".
      - Add that the error map's gain defaults to 4.

- [ ] **Step 2: Update the docs.**
  - **`README.md` → Project layout:** under `rules/`, after the `jpeg.rs` line, add `│   │   │   ├── jpeg_hints.rs         # Where blocking, ringing and colour bleed are worst`.
  - **`docs/testing.md`:**
    - Set the Rust counts to what `cargo test --all-features` prints (`jpeg` 85; `viz-core` 307; total 392).
    - Set the wasm count to 47, with 7 JPEG lab engine tests.
    - Set the web count to 513 tests in 37 files. Add to that sentence: the R–D cache, the Huffman view data, and the five new stages against the fake engine.

- [ ] **Step 3: Full validation.**

```bash
cargo fmt --all --check
cargo clippy --all-targets --all-features 2>&1 | grep -A4 '^warning: [a-z]' | grep -- '-->' | grep -v sierpinski   # expect no output
cargo test --all-features 2>&1 | grep 'test result: ok. [1-9]'   # 85 and 307
wasm-pack test --chrome --headless --chromedriver=/private/tmp/claude-501/-Users-bsmall-dev-math-visualizer/9f5e6f00-2b13-4952-8009-b31a54f0fe14/scratchpad/chromedriver-155/chromedriver-mac-arm64/chromedriver crates/viz-core   # jpeg_kit 6, jpeg_lab 7, jpeg_oracle 1, wasm 33
wasm-pack build crates/viz-core --target web --out-dir pkg
cd web && npx vitest run && npx svelte-check --tsconfig ./tsconfig.json   # 513 passed, 0 errors
```

- [ ] **Step 4: Commit the docs.** `git add docs README.md && git commit -m "docs: JPEG lab stages 5–9 — spec amendment, layout and test counts"`

- [ ] **Step 5 (controller): Look at it.**
  - Start the dev server (`.claude/launch.json` `web`; read the port from `preview_logs`).
  - Capture `#/jpeg?stage=<s>&img=<i>` for `s` in quantize, zigzag, rle, huffman, decode and `i` in gradient, text, bars, with `node ~/.claude/skills/ui-critic/scripts/capture.mjs <url> <dir>` (1440 + 375, light + dark).
  - In the Browser pane:
    - Edit a Q-table cell and apply it, then check the image and the size change. Press "Standard" to go back.
    - Watch the R–D curve fill in.
    - Check that the Ringing hint is disabled on the gradient and jumps to an edge on the text picture.
    - Run "Re-save ×20" and confirm the PSNR curve falls and then flattens.
  - Fix anything found through the normal review loop.
