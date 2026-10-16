# JPEG Lab, Plan 2: the engine lab and stages 1–4 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the JPEG lab on the page at `#/jpeg`. The engine encodes an image with the `jpeg` crate and its clock walks the scan, MCU by MCU. A page with a nine-stage rail shows the first four stages (Color, Subsample, Blocks, DCT) with live numbers, formulas and controls.

**Architecture:** Three generic engine hooks, behaviour-neutral for the other labs:
- `Rule::apply_image`, behind `Engine::update_rule_config_with_image`
- `Rule::inspect`, behind `Engine::rule_inspect`
- `Rule::bytes`, behind `Engine::rule_bytes`

On top of them sit a `jpeg` rule (one encode per config; the clock only moves a cursor), a new `TextureQuad` renderer, and a panel-driven `JpegViz`. The page is the layout authority: it pushes named panels with device-pixel rects, and the viz draws whatever is listed, so the numbers the page overlays line up with the cells drawn. Settings re-encode through a config push, and the page then restores the scan position. Only the selected block moves through a rule action.

**Tech Stack:** Rust (wasm-bindgen, serde, WebGL2 via `web-sys`), the `jpeg` crate, Svelte 5 + TypeScript, KaTeX (already a dependency), Vitest + Testing Library, wasm-pack tests in headless Chrome.

**Spec:** `docs/superpowers/specs/2026-10-15-jpeg-lab-design.md` (Part 2 engine and viz, Part 3 frame and stages 1–4, Delivery item 2). The amendments listed under Global Constraints are added to the spec in Task 6.

**Provenance:** every code block and diff below comes from a prototype that was built, tested and looked at in the browser before this plan was written. Its results:
- 292 `viz-core` native tests, 85 `jpeg` tests and 465 web tests pass.
- In headless Chrome 155, 45 browser tests pass.
- `fmt`, clippy (nothing new) and svelte-check are clean.
- Every stage was screenshotted at 1440 and 375 px, light and dark.

If a step's expected output differs, stop and investigate rather than editing the test to pass.

## Global Constraints

- **Branch:** `jpeg-lab-stages`, already created from `main` after PR #38. Nothing is pushed until the end; the controller opens the PR after the final review.
- **Validation (AGENTS.md):**
  - `cargo fmt --all --check`
  - `cargo clippy --all-targets --all-features`: no warnings in files this plan touches. The 7 existing `sierpinski_*` warnings stay.
  - `cargo test --all-features`
  - Web: `cd web && npx vitest run` and `npx svelte-check --tsconfig ./tsconfig.json`
  - Browser: `wasm-pack test --chrome --headless --chromedriver=/private/tmp/claude-501/-Users-bsmall-dev-math-visualizer/9f5e6f00-2b13-4952-8009-b31a54f0fe14/scratchpad/chromedriver-155/chromedriver-mac-arm64/chromedriver crates/viz-core`. The flag goes before the crate path; never run it alongside another cargo build.
  - After any Rust change the web track depends on: `wasm-pack build crates/viz-core --target web --out-dir pkg`.
- **Spec amendments this plan carries** (Task 6 writes them into the spec):
  1. Quality, subsampling and Huffman changes re-encode through a **rule-config push** with the image (`update_rule_config_with_image`). The page then restores the scan position (`JumpTo` the same share) and resumes playing if it was playing. Only `select_block` is a rule action. This keeps the engine's state from drifting away from its config, because the engine re-inits state from the config on every push.
  2. The rule's capabilities are scrubbable but **not cheap to recompute**, so Reset, Back and scrubbing move the cursor without re-encoding.
  3. The viz config is **panels-based**: `panels: [{ kind, rect, crop? }]` in device pixels, drawn in order. The planned `image_rect` / `focus_rect` / `aux_rect` / `stage` fields are dropped; the page decides what goes where.
  4. Plane panels take an optional `crop` (image pixels). The subsample stage magnifies a 32 px window around the selected block so chroma's blocks are visible at all.
  5. The first selection is the **luma block with the most AC energy**, so every stage opens on a block with detail.
  6. The bundled public-domain **photo** and the **home tile / nav link / README lab entry** move to Plan 4. `#/jpeg` works but is unlinked until then.
  7. The rail shows all nine stages; 5–9 are disabled until their plans land.
  8. The Color stage's formula is the static matrix. The summary carries only the selected component's samples, so there's no per-pixel RGB to plug in.
  9. `kit.ts` is still deferred. The DCT stage calls the three kit functions it needs (`jpeg_zigzag_order`, `jpeg_dct_1d`, `jpeg_dft_1d`) through `loadVizCore()` directly; a wrapper lands when more stages need the kit.
- **Shared geometry:** the overlay's 8 × 8 cells use `layout.cells()`, which mirrors the viz's `cells_8x8` with a gap of `max(w / 160, 1)` device pixels. If one changes, change both.
- **Copy:** sentence case, no emoji or arrow glyphs in `.svelte` files (a repo test scans them); glyphs like `↺` live in `.ts`.
- Doc comments on every pub item in Rust and on exported TS; comment density like the neighbours. Conventional commits: `feat(jpeg): …`, `feat(web): …`, `test(…)`, `docs: …`.
- The rule summary crosses with wasm-bindgen's `None` → `undefined`. Parse optional fields with `== null`, never `=== null`. `rule_inspect` of an unknown key is `undefined` in JS.

## Review Focus

1. **A setting changed mid-scan** (quality slider dragged while playing) must keep the scan where it was and keep playing, not rewind to 0. Task 5 tests that a quality change re-encodes with a typed array, and that a link with junk values loads cleaned up. The restore-and-play path is checked in the Task 6 browser check: the fake engine's snapshot never plays.
2. **A key press aimed at the window itself** (no element target) must not crash the arrow-key handler. Task 5's `moves between ready stages…` test fires `keyDown(window, …)`.
3. **An upload the browser can't decode** must keep the current image and show why, not push anything. Task 5's `keeps the current image…` test.
4. **Wrong-sized pixels pushed through the image path** must be refused with the engine untouched. Task 3's browser test `pixels_arrive_as_a_typed_array_and_reset_the_scan` pushes a 10-byte buffer.
5. **Stages laid out on small or odd stages** (343 × 520 phone, 800 × 420 short) must keep every panel and caption inside the canvas with no overlaps. Task 4's `jpegLayout` matrix test.

---

## Task 1: Generic engine hooks (image in, on-demand views, bytes out)

**Files:**
- Modify: `crates/viz-core/src/traits.rs`, `crates/viz-core/src/engine/erased.rs`, `crates/viz-core/src/engine/mod.rs`

**Interfaces:**
- Produces:
  - Rust `Rule` trait gains three methods, all with defaults so the other labs are unchanged:
    - `fn apply_image(&self, cfg: &mut Self::Config, w: u32, h: u32, rgba: &[u8]) -> bool` (default `false`)
    - `fn inspect(&self, state: &Self::State, key: &str) -> serde_json::Value` (default `Null`)
    - `fn bytes(&self, state: &Self::State) -> Option<Vec<u8>>` (default `None`)
  - `ErasedRule::{set_config_with_image, inspect, bytes}` and `ErasedError::ImageUnsupported`.
  - On `Engine` (wasm-bindgen):
    - `update_rule_config_with_image(cfg: JsValue, w: u32, h: u32, rgba: &[u8]) -> Result<(), JsValue>`: resets playback like `update_rule_config`
    - `rule_inspect(key: &str) -> JsValue`
    - `rule_bytes() -> Option<Vec<u8>>`

- [ ] **Step 1: Write the failing test.** Append to the `mod tests` block at the end of `crates/viz-core/src/engine/erased.rs` (before its closing `}`):

```rust
    #[test]
    fn rules_without_an_image_refuse_one_and_keep_their_config() {
        let mut rule = TypedRule::new(SierpinskiChaos);
        let before = rule.config_json();
        let err = rule
            .set_config_with_image(&before, 1, 1, &[0, 0, 0, 255])
            .unwrap_err();
        assert!(matches!(err, ErasedError::ImageUnsupported));
        assert_eq!(rule.config_json(), before);
        let state = rule.init(0);
        assert_eq!(rule.inspect(&*state, "tables").unwrap(), Value::Null);
        assert_eq!(rule.bytes(&*state).unwrap(), None);
    }
```

- [ ] **Step 2: Run it to see it fail.** `cargo test -p viz-core engine::erased` → FAIL to compile (`no method named set_config_with_image`, `no variant ImageUnsupported`).

- [ ] **Step 3: Implement.** Apply these diffs (exact; `git apply` works if you save each to a file):

`crates/viz-core/src/traits.rs`:

```diff
--- a/crates/viz-core/src/traits.rs
+++ b/crates/viz-core/src/traits.rs
@@ -87,6 +87,28 @@ pub trait Rule {
     ) -> Result<bool, String> {
         Ok(false)
     }
+
+    /// Optional bulk-image hook: install a `w × h` RGBA image (4 bytes per
+    /// pixel) into the config. Rules without an image keep the default and
+    /// return `false`. Backs `Engine::update_rule_config_with_image`, which
+    /// lets the pixels cross the WASM boundary as a typed-array view instead
+    /// of JSON.
+    fn apply_image(&self, _cfg: &mut Self::Config, _w: u32, _h: u32, _rgba: &[u8]) -> bool {
+        false
+    }
+
+    /// Optional on-demand view of the state for the UI, selected by `key`
+    /// (e.g. the JPEG lab's quantization tables). For data too large or too
+    /// rarely needed for the per-frame `summary`. Default: `null`.
+    fn inspect(&self, _state: &Self::State, _key: &str) -> serde_json::Value {
+        serde_json::Value::Null
+    }
+
+    /// Optional binary product of the state (e.g. the JPEG lab's file
+    /// bytes). Default: `None`.
+    fn bytes(&self, _state: &Self::State) -> Option<Vec<u8>> {
+        None
+    }
 }
 
 /// A visualization renders a rule's state to a WebGL2 context.
```

`crates/viz-core/src/engine/erased.rs` (the implementation part; the test was Step 1):

```diff
--- a/crates/viz-core/src/engine/erased.rs
+++ b/crates/viz-core/src/engine/erased.rs
@@ -31,6 +31,8 @@
     PathUnsupported,
     /// `Rule::apply_action` rejected the action as malformed.
     Action(String),
+    /// The active rule's config has no image (`Rule::apply_image` returned false).
+    ImageUnsupported,
 }
 
 impl std::fmt::Display for ErasedError {
@@ -40,6 +42,7 @@
             ErasedError::ConfigParse(e) => write!(f, "config parse error: {e}"),
             ErasedError::PathUnsupported => f.write_str("this rule does not accept a path"),
             ErasedError::Action(msg) => write!(f, "action rejected: {msg}"),
+            ErasedError::ImageUnsupported => f.write_str("this rule does not accept an image"),
         }
     }
 }
@@ -65,6 +68,15 @@
         xy: &[f32],
         pen: &[u8],
     ) -> Result<(), ErasedError>;
+    /// Parse the scalar fields from `cfg`, then install the `w × h` RGBA
+    /// image via `Rule::apply_image`. Atomic: the old config survives any error.
+    fn set_config_with_image(
+        &mut self,
+        cfg: &Value,
+        w: u32,
+        h: u32,
+        rgba: &[u8],
+    ) -> Result<(), ErasedError>;
     /// The current typed config, serialized on demand (large paths included —
     /// callers that only need scalars should avoid calling this per frame).
     fn config_json(&self) -> Value;
@@ -76,6 +88,10 @@
 
     /// Mutate live state without resetting playback. See `Rule::apply_action`.
     fn action(&self, state: &mut dyn Any, action: &Value) -> Result<bool, ErasedError>;
+    /// On-demand view selected by `key`. See `Rule::inspect`.
+    fn inspect(&self, state: &dyn Any, key: &str) -> Result<Value, ErasedError>;
+    /// Binary product of the state. See `Rule::bytes`.
+    fn bytes(&self, state: &dyn Any) -> Result<Option<Vec<u8>>, ErasedError>;
 }
 
 /// A concrete `Rule` together with its deserialized config.
@@ -136,6 +152,22 @@
         Ok(())
     }
 
+    fn set_config_with_image(
+        &mut self,
+        cfg: &Value,
+        w: u32,
+        h: u32,
+        rgba: &[u8],
+    ) -> Result<(), ErasedError> {
+        let mut typed: R::Config =
+            serde_json::from_value(cfg.clone()).map_err(ErasedError::ConfigParse)?;
+        if !self.rule.apply_image(&mut typed, w, h, rgba) {
+            return Err(ErasedError::ImageUnsupported);
+        }
+        self.cfg = typed;
+        Ok(())
+    }
+
     fn config_json(&self) -> Value {
         serde_json::to_value(&self.cfg).unwrap_or(Value::Null)
     }
@@ -174,6 +206,20 @@
         self.rule
             .apply_action(typed_state, &self.cfg, action)
             .map_err(ErasedError::Action)
+    }
+
+    fn inspect(&self, state: &dyn Any, key: &str) -> Result<Value, ErasedError> {
+        let typed = state
+            .downcast_ref::<R::State>()
+            .ok_or(ErasedError::StateDowncastFailed)?;
+        Ok(self.rule.inspect(typed, key))
+    }
+
+    fn bytes(&self, state: &dyn Any) -> Result<Option<Vec<u8>>, ErasedError> {
+        let typed = state
+            .downcast_ref::<R::State>()
+            .ok_or(ErasedError::StateDowncastFailed)?;
+        Ok(self.rule.bytes(typed))
     }
 }
 
```

`crates/viz-core/src/engine/mod.rs`:

```diff
--- a/crates/viz-core/src/engine/mod.rs
+++ b/crates/viz-core/src/engine/mod.rs
@@ -269,7 +269,48 @@ impl Engine {
         Ok(())
     }
 
-    /// Shared tail of the two rule-config setters: rewind, pause, adopt the
+    /// Like `update_rule_config`, but the rule's image arrives as a typed
+    /// array: `rgba` is `w × h` pixels, 4 bytes each (JS passes a
+    /// Uint8Array or Uint8ClampedArray view, so a 1 MB image skips JSON).
+    /// `cfg` carries the scalar fields. Errors if the active rule has no
+    /// image or rejects the pixels.
+    pub fn update_rule_config_with_image(
+        &mut self,
+        cfg: JsValue,
+        w: u32,
+        h: u32,
+        rgba: &[u8],
+    ) -> Result<(), JsValue> {
+        let parsed: Value = serde_wasm_bindgen::from_value(cfg)
+            .map_err(|e| JsValue::from_str(&format!("bad rule config: {e}")))?;
+        self.rule
+            .set_config_with_image(&parsed, w, h, rgba)
+            .map_err(|e| JsValue::from_str(&format!("bad rule config: {e}")))?;
+        let new_max = registry::max_iterations_of(&parsed, self.playback.max_iterations);
+        self.rule_cfg = parsed;
+        self.reset_playback_after_rule_config(new_max);
+        Ok(())
+    }
+
+    /// The rule's on-demand view for `key` (see `Rule::inspect`);
+    /// `undefined` in JS (a JSON null) for keys or rules without one.
+    pub fn rule_inspect(&self, key: &str) -> JsValue {
+        match self.rule.inspect(self.state.as_ref(), key) {
+            Ok(v) => to_js(&v),
+            Err(e) => {
+                warn(&format!("rule.inspect failed: {e}"));
+                JsValue::NULL
+            }
+        }
+    }
+
+    /// The rule's binary product (see `Rule::bytes`), e.g. the JPEG lab's
+    /// file; `undefined` when it has none.
+    pub fn rule_bytes(&self) -> Option<Vec<u8>> {
+        self.rule.bytes(self.state.as_ref()).ok().flatten()
+    }
+
+    /// Shared tail of the rule-config setters: rewind, pause, adopt the
     /// new step count, drop the stale frame timestamp, rebuild state.
     fn reset_playback_after_rule_config(&mut self, new_max: u32) {
         self.playback.iteration = 0;
```

- [ ] **Step 4: Run the tests.** `cargo test -p viz-core engine::erased` → PASS, 10 tests (9 existing + the new one). Then `cargo test -p viz-core` → 267 passed (266 + 1).

- [ ] **Step 5: Lint and commit.**

```bash
cargo fmt --all && cargo clippy --all-targets --all-features 2>&1 | grep -A4 '^warning: [a-z]' | grep -- '-->' | grep -v sierpinski   # expect no output
git add crates/viz-core/src/traits.rs crates/viz-core/src/engine/erased.rs crates/viz-core/src/engine/mod.rs
git commit -m "feat(viz-core): engine hooks for a bulk image, on-demand views and binary output"
```

---

## Task 2: The JPEG rule

**Files:**
- Create: `crates/viz-core/src/rules/jpeg.rs`
- Modify: `crates/viz-core/src/rules/mod.rs` (add `pub mod jpeg;` after `pub mod fourier_epicycles;`), `crates/viz-core/src/engine/erased.rs` (one more test)

**Interfaces:**
- Consumes: Task 1's hooks; `crate::jpeg_images::builtin_image`; `jpeg::codec::{encode, decode, Encoded, Options, HuffmanMode, Trace}`, `jpeg::metrics::{psnr, entropy_bits}`, `jpeg::blocks::level_shift`, `jpeg::zigzag::to_zigzag`.
- Produces:
  - **Config:** `JpegConfig { image_id: String, quality: u8, subsampling: String, huffman: String, max_iterations: u32, pixels: Option<Rgb8Image> }`.
    - `pixels` is `#[serde(skip)]` and arrives only through `apply_image`.
    - The defaults are `"gradient"`, 50, `"420"`, `"optimized"`, 256.
  - **Constants and helpers:** `BUILTIN_SIDE = 256`, `parse_subsampling`, `subsampling_name`, `mcu_count(w, h, s)`, `options_of(&cfg)`.
  - **State and selection:** `Selection { component, bx, by }`, and `JpegState { original, encoded: Option<Encoded>, decoded: Option<Rgb8Image>, psnr, n, selection, version, error }`.
    - `JpegState::build(original, &opts)`, `total()`, `bits_so_far()`.
    - `busiest_block(&Trace) -> Selection`.
  - **`JpegRule`:**
    - Capabilities: scrubbable, not cheap to recompute.
    - Summary JSON: `{ version, n, total, width, height, bytes, raw_bytes, bits_so_far, payload_bits, entropy_bits, psnr|null, quality, subsampling, mcu: [mcu_w, mcu_h, cols, rows], grids, selected: { component, bx, by, mcu, pixels, shifted, dct, quant, table, zigzag, dc_prev, dc_diff, tokens: [{run,size,amp,symbol}], bit_span: [start,len], bits }, error }`.
    - Action `{"kind":"select_block","component","bx","by"}`.
    - `inspect("tables")` returns `{ luma, chroma }`.
    - `bytes()` returns the file.
  - Task 3's viz and Task 5's page read exactly these names.

- [ ] **Step 1: Write the failing tests.** Add `pub mod jpeg;` to `crates/viz-core/src/rules/mod.rs`, then create `crates/viz-core/src/rules/jpeg.rs` containing only:

```rust
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
```

Also append to `crates/viz-core/src/engine/erased.rs`'s test module:

```rust
    #[test]
    fn the_jpeg_rule_takes_an_image_and_reports_bytes() {
        use crate::rules::jpeg::JpegRule;
        let mut rule = TypedRule::new(JpegRule);
        let cfg = rule.config_json();
        rule.set_config_with_image(&cfg, 2, 1, &[255, 0, 0, 255, 0, 0, 255, 255])
            .expect("image accepted");
        let state = rule.init(0);
        assert_eq!(rule.summary(&*state).unwrap()["width"], 2);
        assert!(rule.bytes(&*state).unwrap().is_some());
        // The pixels never appear in the reported config.
        assert!(rule.config_json().get("pixels").is_none());
        // A malformed config is refused before the image is looked at.
        assert!(rule
            .set_config_with_image(&json!({"quality": "high"}), 2, 1, &[0; 8])
            .is_err());
    }
```

- [ ] **Step 2: Run them to see them fail.** `cargo test -p viz-core rules::jpeg` → FAIL to compile (`cannot find type JpegConfig` …).

- [ ] **Step 3: Implement.** Above the test module in `crates/viz-core/src/rules/jpeg.rs`:

```rust
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
```

- [ ] **Step 4: Run the tests.** `cargo test -p viz-core rules::jpeg` → PASS, 11 tests. `cargo test -p viz-core engine::erased` → 11 passed; `cargo test -p viz-core` → 279 passed.

- [ ] **Step 5: Lint and commit.**

```bash
cargo fmt --all && cargo clippy --all-targets --all-features 2>&1 | grep -A4 '^warning: [a-z]' | grep -- '-->' | grep -v sierpinski   # expect no output
git add crates/viz-core/src/rules crates/viz-core/src/engine/erased.rs
git commit -m "feat(jpeg): the lab's rule — one encode per config, a scan cursor, the selected block"
```

---

## Task 3: `TextureQuad`, `JpegViz` and the registry entry

**Files:**
- Create: `crates/viz-core/src/render/texture_quad.rs`, `crates/viz-core/src/visualizations/jpeg.rs`, `crates/viz-core/tests/jpeg_lab.rs`
- Modify:
  - `crates/viz-core/src/render/mod.rs`: add `pub mod texture_quad;` after `pub mod shader;`
  - `crates/viz-core/src/visualizations/mod.rs`: add `pub mod jpeg;` after `pub mod fourier_epicycles;`
  - `crates/viz-core/Cargo.toml`: add `"WebGlTexture",` after `"WebGlVertexArrayObject",` in the main `web-sys` features
  - `crates/viz-core/src/engine/registry.rs`

**Interfaces:**
- Consumes: Task 2's `JpegState`, `Selection`; `jpeg::dct::{basis, idct_partial}`, `jpeg::color::{rgb_to_ycbcr, ycbcr_to_rgb}`; existing renderers.
- Produces:
  - **Renderer:** `render::texture_quad::{Texture, TextureQuad, Filter}`.
    - `Texture::new(gl, w, h, rgba, filter)`
    - `TextureQuad::draw(gl, &tex, rect_px, canvas_px, dim)`
  - **Viz config:** `JpegVizConfig { background, accent, grid, dim, panels: Vec<Panel{kind, rect, crop}>, cube_mix, dct_k, hover: Option<[u32;2]>, auto_rotate_speed }`. An empty `panels` means one fitted `image`.
  - **Panel kinds:** `image`, `image_grid`, `plane_y`, `plane_cb`, `plane_cr`, `coded_cb`, `coded_cr`, `cube`, `block`, `atlas`, `coeffs`, `rebuild`.
  - **Pure helpers:** `fit_rect`, `map_rect`, `crop_target`, `scanned_rects`, `block_rect`, `cells_8x8` (gap is the caller's), `diverging`, `cube_point`, and others.
  - **Registry:** lab id `"jpeg"` in `LAB_IDS`.

- [ ] **Step 1: Write the failing tests.** Make the four "Modify" edits listed above (the registry edits are the diff below). Then create `crates/viz-core/src/visualizations/jpeg.rs` containing only its test module:

```rust
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
    fn scissor_boxes_flip_y() {
        assert_eq!(scissor_box(100, [10.0, 20.0, 30.0, 40.0]), [10, 40, 30, 40]);
    }
}
```

and `crates/viz-core/tests/jpeg_lab.rs`:

```rust
//! The JPEG lab through the engine: construction, the bulk image path,
//! actions that keep the scan position, inspect/bytes, and every panel kind
//! rendering without a GL error.

use viz_core::Engine;
use wasm_bindgen::{JsCast, JsValue};
use wasm_bindgen_test::*;
use web_sys::{HtmlCanvasElement, WebGl2RenderingContext};

wasm_bindgen_test_configure!(run_in_browser);

fn make_canvas(id: &str) -> HtmlCanvasElement {
    let document = web_sys::window().unwrap().document().unwrap();
    let canvas = document
        .create_element("canvas")
        .unwrap()
        .dyn_into::<HtmlCanvasElement>()
        .unwrap();
    canvas.set_id(id);
    canvas.set_width(320);
    canvas.set_height(200);
    document.body().unwrap().append_child(&canvas).unwrap();
    canvas
}

fn js(json: &str) -> JsValue {
    js_sys::JSON::parse(json).expect("valid JSON")
}

fn get(v: &JsValue, key: &str) -> JsValue {
    js_sys::Reflect::get(v, &JsValue::from_str(key)).unwrap()
}

fn num(v: &JsValue, key: &str) -> f64 {
    get(v, key)
        .as_f64()
        .unwrap_or_else(|| panic!("{key} is not a number"))
}

fn gl_of(canvas: &HtmlCanvasElement) -> WebGl2RenderingContext {
    canvas
        .get_context("webgl2")
        .unwrap()
        .unwrap()
        .dyn_into()
        .unwrap()
}

#[wasm_bindgen_test]
fn jpeg_lab_constructs_and_renders_the_default_scan() {
    let canvas = make_canvas("jpeg-default");
    let mut engine = Engine::new("jpeg-default", Some("jpeg".into())).expect("jpeg lab");
    engine.frame(0.0);
    let s = engine.rule_summary();
    assert_eq!(num(&s, "total"), 256.0);
    assert_eq!(num(&s, "width"), 256.0);
    assert!(num(&s, "bytes") > 0.0);
    assert_eq!(gl_of(&canvas).get_error(), WebGl2RenderingContext::NO_ERROR);
}

#[wasm_bindgen_test]
fn pixels_arrive_as_a_typed_array_and_reset_the_scan() {
    make_canvas("jpeg-image");
    let mut engine = Engine::new("jpeg-image", Some("jpeg".into())).unwrap();
    engine
        .dispatch(js(r#"{"kind":"JumpTo","iteration":40}"#))
        .unwrap();
    let rgba: Vec<u8> = (0..40 * 24 * 4).map(|i| (i * 7 % 256) as u8).collect();
    engine
        .update_rule_config_with_image(
            js(r#"{"image_id":"upload","quality":75,"subsampling":"444","huffman":"standard","max_iterations":15}"#),
            40,
            24,
            &rgba,
        )
        .expect("image accepted");
    let s = engine.rule_summary();
    assert_eq!((num(&s, "width"), num(&s, "height")), (40.0, 24.0));
    assert_eq!(num(&s, "total"), 15.0); // 5 × 3 MCUs of 8 × 8
    assert_eq!(get(&s, "subsampling").as_string().unwrap(), "444");
    let snap = engine.snapshot();
    assert_eq!(num(&snap, "iteration"), 0.0);
    assert_eq!(num(&snap, "max_iterations"), 15.0);
    // A buffer that doesn't match w × h × 4 is refused and changes nothing.
    assert!(engine
        .update_rule_config_with_image(js(r#"{"max_iterations":1}"#), 40, 24, &rgba[..10])
        .is_err());
    assert_eq!(num(&engine.rule_summary(), "width"), 40.0);
}

#[wasm_bindgen_test]
fn selecting_a_block_keeps_the_scan_position() {
    make_canvas("jpeg-select");
    let mut engine = Engine::new("jpeg-select", Some("jpeg".into())).unwrap();
    engine
        .dispatch(js(r#"{"kind":"JumpTo","iteration":100}"#))
        .unwrap();
    let ok = engine
        .rule_action(js(r#"{"kind":"select_block","component":2,"bx":4,"by":7}"#))
        .unwrap();
    assert!(ok);
    let sel = get(&engine.rule_summary(), "selected");
    assert_eq!(
        (num(&sel, "component"), num(&sel, "bx"), num(&sel, "by")),
        (2.0, 4.0, 7.0)
    );
    assert_eq!(num(&engine.snapshot(), "iteration"), 100.0);
    assert_eq!(num(&engine.rule_summary(), "n"), 100.0);
    assert!(engine
        .rule_action(js(
            r#"{"kind":"select_block","component":0,"bx":99,"by":0}"#
        ))
        .is_err());
    // Reset rewinds the cursor without re-encoding (the version is unchanged).
    let v = num(&engine.rule_summary(), "version");
    engine.dispatch(js(r#"{"kind":"Reset"}"#)).unwrap();
    assert_eq!(num(&engine.rule_summary(), "n"), 0.0);
    assert_eq!(num(&engine.rule_summary(), "version"), v);
}

#[wasm_bindgen_test]
fn inspect_and_bytes_cross_the_boundary() {
    make_canvas("jpeg-bytes");
    let engine = Engine::new("jpeg-bytes", Some("jpeg".into())).unwrap();
    let tables = engine.rule_inspect("tables");
    assert_eq!(js_sys::Array::from(&get(&tables, "luma")).length(), 64);
    // A JSON null crosses as `undefined` (serde-wasm-bindgen).
    assert!(engine.rule_inspect("nope").is_undefined());
    let bytes = engine.rule_bytes().expect("a file");
    assert_eq!(&bytes[..2], &[0xFF, 0xD8]);
    assert_eq!(bytes.len() as f64, num(&engine.rule_summary(), "bytes"));
}

#[wasm_bindgen_test]
fn every_panel_kind_renders_without_a_gl_error() {
    let canvas = make_canvas("jpeg-panels");
    let mut engine = Engine::new("jpeg-panels", Some("jpeg".into())).unwrap();
    engine
        .dispatch(js(r#"{"kind":"JumpTo","iteration":77}"#))
        .unwrap();
    engine
        .update_viz_config(js(r#"{"panels":[
                {"kind":"image","rect":[0,0,100,100]},
                {"kind":"image_grid","rect":[100,0,100,100]},
                {"kind":"plane_y","rect":[200,0,40,40]},
                {"kind":"plane_cb","rect":[240,0,40,40]},
                {"kind":"plane_cr","rect":[280,0,40,40]},
                {"kind":"coded_cb","rect":[200,40,40,40]},
                {"kind":"coded_cr","rect":[240,40,40,40]},
                {"kind":"cube","rect":[0,100,100,100]},
                {"kind":"block","rect":[100,100,50,50]},
                {"kind":"atlas","rect":[150,100,50,50]},
                {"kind":"coeffs","rect":[200,100,50,50]},
                {"kind":"rebuild","rect":[250,100,50,50]},
                {"kind":"unknown","rect":[0,0,1,1]}
            ],"cube_mix":0.5,"dct_k":6,"hover":[1,2]}"#))
        .expect("panels accepted");
    engine
        .forward_input(js(
            r#"{"kind":"PointerMove","x":10,"y":10,"dx":5,"dy":2,"buttons":1}"#,
        ))
        .unwrap();
    engine.frame(0.0);
    engine.frame(16.0);
    assert_eq!(gl_of(&canvas).get_error(), WebGl2RenderingContext::NO_ERROR);
}
```

`crates/viz-core/src/engine/registry.rs` (its new test is part of this diff):

```diff
--- a/crates/viz-core/src/engine/registry.rs
+++ b/crates/viz-core/src/engine/registry.rs
@@ -6,10 +6,12 @@ use serde_json::Value;
 use super::erased::{ErasedRule, ErasedVisualization, TypedRule, TypedViz};
 use crate::config::ConfigSchema;
 use crate::rules::fourier_epicycles::{FourierConfig, FourierEpicycles};
+use crate::rules::jpeg::{JpegConfig, JpegRule};
 use crate::rules::notes::{Notes, NotesConfig};
 use crate::rules::sierpinski_chaos::{ChaosGameConfig, SierpinskiChaos};
 use crate::rules::sorting::{SortingConfig, SortingRace};
 use crate::visualizations::fourier_epicycles::{FourierEpicyclesViz, FourierEpicyclesVizConfig};
+use crate::visualizations::jpeg::{JpegViz, JpegVizConfig};
 use crate::visualizations::notes::{NotesViz, NotesVizConfig};
 use crate::visualizations::sierpinski_pyramid::{SierpinskiPyramid, SierpinskiPyramidVizConfig};
 use crate::visualizations::sorting::{SortingViz, SortingVizConfig};
@@ -32,7 +34,7 @@ pub struct LabParts {
 pub const DEFAULT_LAB: &str = "sierpinski";
 
 /// Every id `build_lab` accepts.
-pub const LAB_IDS: &[&str] = &["sierpinski", "fourier", "sorting", "notes"];
+pub const LAB_IDS: &[&str] = &["sierpinski", "fourier", "sorting", "notes", "jpeg"];
 
 /// Build the rule/viz pair for `id`, or `None` if the id is unknown.
 ///
@@ -65,6 +67,12 @@ pub fn build_lab(id: &str) -> Option<LabParts> {
             rule_cfg: NotesConfig::defaults(),
             viz_cfg: NotesVizConfig::defaults(),
         }),
+        "jpeg" => Some(LabParts {
+            rule: Box::new(TypedRule::new(JpegRule)),
+            viz: Box::new(TypedViz::new(JpegViz::new())),
+            rule_cfg: JpegConfig::defaults(),
+            viz_cfg: JpegVizConfig::defaults(),
+        }),
         _ => None,
     }
 }
@@ -170,4 +178,14 @@ mod tests {
         // The layout rects come from the DOM; zero means "fit the canvas".
         assert_eq!(parts.viz_cfg["figure"], json!([0.0, 0.0, 0.0, 0.0]));
     }
+
+    #[test]
+    fn jpeg_lab_pairs_rule_and_viz() {
+        let parts = build_lab("jpeg").expect("jpeg lab should build");
+        assert_eq!(parts.rule.id(), "jpeg");
+        assert_eq!(parts.viz.id(), "jpeg");
+        // The default gradient at 256² in 4:2:0 is 16 × 16 MCUs.
+        assert_eq!(max_iterations_of(&parts.rule_cfg, 1), 256);
+        assert_eq!(parts.viz_cfg["panels"], json!([]));
+    }
 }
```

- [ ] **Step 2: Run them to see them fail.** `cargo test -p viz-core visualizations::jpeg` → FAIL to compile.

- [ ] **Step 3: Implement.** Create `crates/viz-core/src/render/texture_quad.rs`:

```rust
//! Draws an RGBA texture into a pixel rectangle — images, planes, anything
//! raster. Rects are device pixels, y down (as measured in the DOM).
//!
//! Pure draw call: the caller owns blend state and the scissor box.

use web_sys::{WebGl2RenderingContext as Gl, WebGlBuffer, WebGlTexture, WebGlVertexArrayObject};

use super::camera_2d::pixel_projection;
use super::shader::ShaderProgram;

const VERTEX_SRC: &str = r#"#version 300 es
precision mediump float;

layout(location=0) in vec2 a_corner; // unit quad, (0,0) top-left

uniform mat3 u_proj;
uniform vec4 u_rect; // x, y, w, h in device pixels, y down

out vec2 v_uv;

void main() {
    v_uv = a_corner;
    vec2 p = u_rect.xy + a_corner * u_rect.zw;
    gl_Position = vec4((u_proj * vec3(p, 1.0)).xy, 0.0, 1.0);
}
"#;

const FRAGMENT_SRC: &str = r#"#version 300 es
precision mediump float;

in vec2 v_uv;

uniform sampler2D u_tex;
uniform float u_dim;

out vec4 frag_color;

void main() {
    vec4 c = texture(u_tex, v_uv);
    frag_color = vec4(c.rgb * u_dim, c.a);
}
"#;

/// How a texture is sampled when it is stretched.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Filter {
    /// Hard pixel edges (block-level detail stays visible).
    Nearest,
    /// Smooth interpolation.
    Linear,
}

/// An uploaded RGBA texture and its size in texels.
pub struct Texture {
    tex: WebGlTexture,
    gl: Gl,
    pub w: u32,
    pub h: u32,
}

impl Texture {
    /// Uploads `rgba` (`w × h × 4` bytes, top row first) as a new texture.
    pub fn new(gl: &Gl, w: u32, h: u32, rgba: &[u8], filter: Filter) -> Result<Self, String> {
        if rgba.len() != (w as usize) * (h as usize) * 4 {
            return Err(format!(
                "texture needs {} bytes for {w}×{h}, got {}",
                (w as usize) * (h as usize) * 4,
                rgba.len()
            ));
        }
        let tex = gl.create_texture().ok_or("create_texture returned None")?;
        gl.bind_texture(Gl::TEXTURE_2D, Some(&tex));
        let f = match filter {
            Filter::Nearest => Gl::NEAREST,
            Filter::Linear => Gl::LINEAR,
        } as i32;
        gl.tex_parameteri(Gl::TEXTURE_2D, Gl::TEXTURE_MIN_FILTER, f);
        gl.tex_parameteri(Gl::TEXTURE_2D, Gl::TEXTURE_MAG_FILTER, f);
        gl.tex_parameteri(Gl::TEXTURE_2D, Gl::TEXTURE_WRAP_S, Gl::CLAMP_TO_EDGE as i32);
        gl.tex_parameteri(Gl::TEXTURE_2D, Gl::TEXTURE_WRAP_T, Gl::CLAMP_TO_EDGE as i32);
        gl.pixel_storei(Gl::UNPACK_ALIGNMENT, 1);
        gl.tex_image_2d_with_i32_and_i32_and_i32_and_format_and_type_and_opt_u8_array(
            Gl::TEXTURE_2D,
            0,
            Gl::RGBA8 as i32,
            w as i32,
            h as i32,
            0,
            Gl::RGBA,
            Gl::UNSIGNED_BYTE,
            Some(rgba),
        )
        .map_err(|e| format!("tex_image_2d failed: {e:?}"))?;
        gl.bind_texture(Gl::TEXTURE_2D, None);
        Ok(Self {
            tex,
            gl: gl.clone(),
            w,
            h,
        })
    }
}

impl Drop for Texture {
    fn drop(&mut self) {
        self.gl.delete_texture(Some(&self.tex));
    }
}

/// The shared program and quad for drawing `Texture`s.
pub struct TextureQuad {
    program: ShaderProgram,
    vao: WebGlVertexArrayObject,
    vbo: WebGlBuffer,
    gl: Gl,
}

impl TextureQuad {
    pub fn new(gl: &Gl) -> Result<Self, String> {
        let program = ShaderProgram::new(gl, VERTEX_SRC, FRAGMENT_SRC)?;
        let vao = gl
            .create_vertex_array()
            .ok_or("create_vertex_array returned None")?;
        let vbo = gl.create_buffer().ok_or("create_buffer returned None")?;
        gl.bind_vertex_array(Some(&vao));
        gl.bind_buffer(Gl::ARRAY_BUFFER, Some(&vbo));
        let corners: [f32; 8] = [0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 1.0];
        // SAFETY: the view lives only for this call and `corners` outlives it.
        unsafe {
            let view = js_sys::Float32Array::view(&corners);
            gl.buffer_data_with_array_buffer_view(Gl::ARRAY_BUFFER, &view, Gl::STATIC_DRAW);
        }
        gl.enable_vertex_attrib_array(0);
        gl.vertex_attrib_pointer_with_i32(0, 2, Gl::FLOAT, false, 0, 0);
        gl.bind_vertex_array(None);
        Ok(Self {
            program,
            vao,
            vbo,
            gl: gl.clone(),
        })
    }

    /// Draws `tex` stretched over `rect` (`[x, y, w, h]`, device px, y down)
    /// on a `canvas` of `[w, h]` device px, with its colour scaled by `dim`
    /// (1 = as is).
    pub fn draw(&self, gl: &Gl, tex: &Texture, rect: [f32; 4], canvas: [u32; 2], dim: f32) {
        self.program.use_program(gl);
        gl.uniform_matrix3fv_with_f32_array(
            self.program.uniform_location(gl, "u_proj").as_ref(),
            false,
            &pixel_projection(canvas[0], canvas[1]),
        );
        gl.uniform4fv_with_f32_array(self.program.uniform_location(gl, "u_rect").as_ref(), &rect);
        gl.uniform1f(self.program.uniform_location(gl, "u_dim").as_ref(), dim);
        gl.uniform1i(self.program.uniform_location(gl, "u_tex").as_ref(), 0);
        gl.active_texture(Gl::TEXTURE0);
        gl.bind_texture(Gl::TEXTURE_2D, Some(&tex.tex));
        gl.bind_vertex_array(Some(&self.vao));
        gl.draw_arrays(Gl::TRIANGLE_STRIP, 0, 4);
        gl.bind_vertex_array(None);
        gl.bind_texture(Gl::TEXTURE_2D, None);
    }
}

impl Drop for TextureQuad {
    fn drop(&mut self) {
        self.gl.delete_buffer(Some(&self.vbo));
        self.gl.delete_vertex_array(Some(&self.vao));
    }
}
```

and, above the test module in `crates/viz-core/src/visualizations/jpeg.rs`:

```rust
//! The JPEG lab's visualization. The page owns the layout: it pushes a list
//! of named panels, each with its device-pixel rect, and this draws whatever
//! is listed — so the numbers the page overlays line up with the cells drawn
//! here by construction. With no panels (the home tile, the wasm tests) it
//! fits one "image" panel to the canvas.
//!
//! Panel kinds: `image` (the scan: decoded where scanned, the original dimmed
//! elsewhere, the selected block outlined), `image_grid` (the same plus the
//! block grid and MCU outlines), `plane_y` / `plane_cb` / `plane_cr` (the
//! full-resolution planes), `coded_cb` / `coded_cr` (the subsampled chroma as
//! coded, shown blocky), `cube` (the pixels as points in the colour cube),
//! `block` (the selected block's 64 samples), `atlas` (the 64 DCT basis
//! patterns), `coeffs` (the selected block's DCT, signed) and `rebuild` (the
//! block rebuilt from its first `dct_k` zigzag coefficients).

use jpeg::color::{rgb_to_ycbcr, ycbcr_to_rgb};
use jpeg::dct::{basis, idct_partial};
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
    #[serde(default = "default_background")]
    pub background: [f32; 4],
    /// Outlines: the selected block, the scan front, hover.
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
/// image.
pub fn map_rect(sub: [f32; 4], panel: [f32; 4], img_w: usize, img_h: usize) -> [f32; 4] {
    let (sx, sy) = (panel[2] / img_w as f32, panel[3] / img_h as f32);
    let x0 = sub[0].clamp(0.0, img_w as f32);
    let y0 = sub[1].clamp(0.0, img_h as f32);
    let x1 = (sub[0] + sub[2]).clamp(0.0, img_w as f32);
    let y1 = (sub[1] + sub[3]).clamp(0.0, img_h as f32);
    [
        panel[0] + x0 * sx,
        panel[1] + y0 * sy,
        (x1 - x0) * sx,
        (y1 - y0) * sy,
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

// ---- The visualization ----

/// Textures built from one encode (`version`).
struct Textures {
    version: u32,
    original: Texture,
    decoded: Texture,
    planes: [Texture; 3],
    coded: [Option<Texture>; 2],
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
    cube_cache: Option<(u32, Vec<[f32; 3]>)>,
    quad_scratch: Vec<QuadInstance>,
    line_scratch: Vec<LineVertex>,
}

impl JpegViz {
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
            cube_cache: None,
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
        self.textures = Some(Textures {
            version: state.version,
            original,
            decoded,
            planes,
            coded: [coded(1)?, coded(2)?],
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
        let n = state.n as usize;
        if n < t.layout.units.len() {
            let (mx, my) = (n % t.layout.cols, n / t.layout.cols);
            let front = [
                (mx * t.layout.mcu_w) as f32,
                (my * t.layout.mcu_h) as f32,
                t.layout.mcu_w as f32,
                t.layout.mcu_h as f32,
            ];
            let c = [cfg.accent[0], cfg.accent[1], cfg.accent[2], 0.55];
            outline(map_rect(front, rect, iw, ih), c, &mut self.line_scratch);
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
        if self
            .cube_cache
            .as_ref()
            .is_none_or(|(v, _)| *v != state.version)
        {
            self.cube_cache = Some((state.version, sample_pixels(&state.original, 4096)));
        }
        let [x, y, w, h] = scissor_box(canvas[1], rect);
        if w <= 0 || h <= 0 {
            return;
        }
        gl.viewport(x, y, w, h);
        self.camera.resize(w as u32, h as u32);
        let vp = self.camera.view_projection();
        let mix = cfg.cube_mix;
        let edge_color = [1.0, 1.0, 1.0, 0.35];
        let mut lines: Vec<LineVertex3D> = Vec::with_capacity(32);
        for (a, b) in cube_edges() {
            lines.push(LineVertex3D {
                position: cube_point(a, mix),
                color: edge_color,
            });
            lines.push(LineVertex3D {
                position: cube_point(b, mix),
                color: edge_color,
            });
        }
        // The grey diagonal: black → white, the Y axis once the cube turns.
        let accent = cfg.accent;
        lines.push(LineVertex3D {
            position: cube_point([0.0; 3], mix),
            color: accent,
        });
        lines.push(LineVertex3D {
            position: cube_point([255.0; 3], mix),
            color: accent,
        });
        if let Some(l) = self.lines_3d.as_mut() {
            l.upload(gl, &lines);
            l.draw(gl, &vp);
        }
        let points: Vec<PointInstance3D> = self
            .cube_cache
            .as_ref()
            .map(|(_, px)| {
                px.iter()
                    .map(|&rgb| PointInstance3D {
                        position: cube_point(rgb, mix),
                        color: [rgb[0] / 255.0, rgb[1] / 255.0, rgb[2] / 255.0, 0.9],
                        radius_px: 2.0,
                    })
                    .collect()
            })
            .unwrap_or_default();
        if let Some(p) = self.points_3d.as_mut() {
            p.upload(gl, &points);
            p.draw(gl, &vp, [w as u32, h as u32]);
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
            }];
            &fallback
        } else {
            &cfg.panels
        };

        let hover = cfg.hover.map(|[u, v]| (u + 8 * v) as usize);
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
                    let crop = panel.crop.unwrap_or([0.0, 0.0, iw, ih]);
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
    }
}
```

- [ ] **Step 4: Run the tests.**
  - `cargo test -p viz-core` → 292 passed (279 + 12 viz tests + the registry's `jpeg_lab_pairs_rule_and_viz`).
  - Then `wasm-pack test --chrome --headless --chromedriver=/private/tmp/claude-501/-Users-bsmall-dev-math-visualizer/9f5e6f00-2b13-4952-8009-b31a54f0fe14/scratchpad/chromedriver-155/chromedriver-mac-arm64/chromedriver crates/viz-core` → `jpeg_lab.rs` 5 passed, `jpeg_kit.rs` 6, `jpeg_oracle.rs` 1, `wasm.rs` 33.
  - Then `wasm-pack build crates/viz-core --target web --out-dir pkg`, which the web track needs.

- [ ] **Step 5: Lint and commit.**

```bash
cargo fmt --all && cargo clippy --all-targets --all-features 2>&1 | grep -A4 '^warning: [a-z]' | grep -- '-->' | grep -v sierpinski   # expect no output
git add crates/viz-core Cargo.lock
git commit -m "feat(jpeg): texture renderer and the panel-driven JPEG visualization"
```

---

## Task 4: The page's pure modules (stages, link, summary, layout, maths, formulas, images)

This task can run in parallel with Tasks 2–3: it touches only `web/` and needs nothing from them.

**Files:**
- Create: `web/src/lib/jpeg/{stages,params,summary,layout,math,formulas,images}.ts`, plus three test files under `web/src/lib/jpeg/__tests__/`
- Modify: `web/src/lib/test/fakeViz.ts`. It gains the JPEG fixture and kit stubs the tests (and Task 5) use.

**Interfaces:**
- Produces, for Task 5 (exact names):
  - **`stages.ts`:** `StageId`, `STAGES`, `DEFAULT_STAGE`, `isStageId`, `readyStage`, `stepStage`.
  - **`params.ts`:** `ImageId`, `SubsamplingId`, `HuffmanId`, `IMAGE_IDS`, `JpegParams`, `DEFAULTS`, `clampQuality`, `parseParams`, `buildParams`, `mcuSize`, `mcuCount`.
  - **`summary.ts`:** `JpegSummary`, `SelectedBlock`, `AcToken`, `readSummary`, `formatBytes`, `readoutOf`.
  - **`layout.ts`:** `Rect`, `PanelKind`, `Panel`, `StageLayout`, `MARGIN`, `LABEL`, `PORTRAIT_BELOW`, `TOOLS`, `ZOOM_WINDOW`, `fit`, `zoomWindow`, `jpegLayout(stage, cssW, cssH, imgW, imgH, block?)`, `toDevicePanels`, `blockAt`, `cells`, `cellAt`.
  - **`math.ts`:** `cumulativeEnergy`, `termsFor`, `mirrored`, `periodic`, `busiestLine`.
  - **`formulas.ts`:** `COLOR_TEX`, `DCT_TEX`, `chromaKept`, `samplesKept`, `stageTex`, `NOTICE`.
  - **`images.ts`:** `RgbaImage`, `BUILTIN_SIDE`, `MAX_SIDE`, `IMAGES`, `loadBuiltin`, `fitWithin`, `decodeUpload`.
  - **`fakeViz.ts`:** `jpegSummaryFixture`, `updateRuleConfigWithImageSpy`; on `FakeEngine`: `update_rule_config_with_image`, `rule_inspect`, `rule_bytes`; on `makeVizMock()`: `jpeg_builtin_image`, `jpeg_zigzag_order`, `jpeg_dct_1d`, `jpeg_dft_1d`.

- [ ] **Step 1: Extend the test fake.** Apply to `web/src/lib/test/fakeViz.ts`:

```diff
--- a/web/src/lib/test/fakeViz.ts
+++ b/web/src/lib/test/fakeViz.ts
@@ -21,6 +21,8 @@ export const dispatchSpy = vi.fn();
 export const updateRuleConfigSpy = vi.fn();
 /** Records every `Engine.update_rule_config_with_path(cfg, xy, pen)` — the Fourier lab's typed-array push. */
 export const updateRuleConfigWithPathSpy = vi.fn();
+/** Records every `Engine.update_rule_config_with_image(cfg, w, h, rgba)` — the JPEG lab's typed-array push. */
+export const updateRuleConfigWithImageSpy = vi.fn();
 /** Records every `Engine.update_viz_config(cfg)` call. */
 export const updateVizConfigSpy = vi.fn();
 /** Records every `Engine.rule_action(action)` call; the fake always accepts (returns true). */
@@ -85,6 +87,53 @@ export const notesSummaryFixture: NotesSummary = {
   ],
 };
 
+/** A JPEG summary's selected block: a soft ramp, so every stage has numbers to show. */
+const jpegBlock = Array.from({ length: 64 }, (_, i) => 100 + (i % 8) * 4 + Math.floor(i / 8) * 2);
+
+/**
+ * What the fake's `rule_summary()` returns on the JPEG lab: the 256² gradient
+ * at quality 50, 4:2:0, a quarter scanned. Mutable so a test can reshape it.
+ */
+export const jpegSummaryFixture = {
+  version: 1,
+  n: 64,
+  total: 256,
+  width: 256,
+  height: 256,
+  bytes: 4096,
+  raw_bytes: 196608,
+  bits_so_far: 8000,
+  payload_bits: 30000,
+  entropy_bits: 28000,
+  psnr: 36.5,
+  quality: 50,
+  subsampling: '420',
+  mcu: [16, 16, 16, 16],
+  grids: [
+    [32, 32],
+    [16, 16],
+    [16, 16],
+  ],
+  selected: {
+    component: 0,
+    bx: 21,
+    by: 17,
+    mcu: 136,
+    pixels: jpegBlock,
+    shifted: jpegBlock.map((v) => v - 128),
+    dct: jpegBlock.map((_, i) => (i === 0 ? 120 : i < 3 ? -20 : 0)),
+    quant: jpegBlock.map((_, i) => (i === 0 ? 8 : 0)),
+    table: Array.from({ length: 64 }, () => 16),
+    zigzag: jpegBlock.map((_, i) => (i === 0 ? 8 : 0)),
+    dc_prev: 6,
+    dc_diff: 2,
+    tokens: [{ run: 0, size: 0, amp: 0, symbol: 0 }],
+    bit_span: [100, 6],
+    bits: '010101',
+  },
+  error: undefined as string | undefined,
+};
+
 /** What the fake's `viz_readout()` returns on the notes lab (null elsewhere). Mutable so a test can move the 4D angle. */
 export const notesVizReadout = { angle_4d: 0 };
 
@@ -115,12 +164,18 @@ export class FakeEngine {
     if (this._lab === 'fourier') return ruleSummaryFixture;
     if (this._lab === 'sorting') return sortingSummaryFixture;
     if (this._lab === 'notes') return notesSummaryFixture;
+    if (this._lab === 'jpeg') return jpegSummaryFixture;
     return null;
   }
   viz_readout() { return this._lab === 'notes' ? notesVizReadout : null; }
   viz_config() { return {}; }
   update_rule_config(cfg: unknown) { updateRuleConfigSpy(cfg); }
   update_rule_config_with_path(cfg: unknown, xy: Float32Array, pen: Uint8Array) { updateRuleConfigWithPathSpy(cfg, xy, pen); }
+  update_rule_config_with_image(cfg: unknown, w: number, h: number, rgba: Uint8Array) {
+    updateRuleConfigWithImageSpy(cfg, w, h, rgba);
+  }
+  rule_inspect(_key: string) { return undefined; }
+  rule_bytes() { return this._lab === 'jpeg' ? new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) : undefined; }
   update_viz_config(cfg: unknown) { updateVizConfigSpy(cfg); }
   rule_action(action: unknown) { ruleActionSpy(action); return true; }
   capabilities() { return { supports_scrub: true, cheap_recompute: true, checkpoint_every: null }; }
@@ -132,5 +187,12 @@ export class FakeEngine {
 
 /** Shaped like the resolved `viz-core` module, which is all `loadVizCore()` callers touch. */
 export function makeVizMock() {
-  return { Engine: FakeEngine } as unknown as typeof import('viz-core');
+  return {
+    Engine: FakeEngine,
+    // The few kit functions the JPEG lab calls: shaped like the real ones, values are placeholders.
+    jpeg_builtin_image: (_id: string, w: number, h: number) => new Uint8Array(w * h * 4).fill(128),
+    jpeg_zigzag_order: () => Uint8Array.from({ length: 64 }, (_, i) => i),
+    jpeg_dct_1d: (x: Float32Array) => Float32Array.from(x, (_, i) => (i === 0 ? 10 : 0)),
+    jpeg_dft_1d: (x: Float32Array) => new Float32Array(x.length * 2).fill(1),
+  } as unknown as typeof import('viz-core');
 }
```

- [ ] **Step 2: Write the failing tests.**

`web/src/lib/jpeg/__tests__/params.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DEFAULTS, buildParams, clampQuality, mcuCount, mcuSize, parseParams } from '../params';
import { STAGES, readyStage, stepStage } from '../stages';

describe('params', () => {
  it('reads an empty link as the defaults and writes the defaults as an empty link', () => {
    expect(parseParams('')).toEqual(DEFAULTS);
    expect(buildParams(DEFAULTS)).toBe('');
  });

  it('round-trips every field', () => {
    const p = { img: 'text', quality: 30, subsampling: '444', huffman: 'standard', stage: 'dct', block: [12, 7] } as const;
    const q = buildParams({ ...p, block: [12, 7] });
    expect(q).toBe('img=text&q=30&s=444&h=std&stage=dct&b=12,7');
    expect(parseParams(q)).toEqual({ ...p, block: [12, 7] });
  });

  it('falls back field by field on junk', () => {
    const p = parseParams('img=photo&q=abc&s=411&h=fast&stage=nope&b=1,-2');
    expect(p).toEqual(DEFAULTS);
    expect(parseParams('b=1,2,3').block).toBeUndefined();
    expect(parseParams('b=1.5,2').block).toBeUndefined();
  });

  it('clamps quality to whole numbers 1–100', () => {
    expect(clampQuality(0)).toBe(1);
    expect(clampQuality(250)).toBe(100);
    expect(clampQuality('49.6')).toBe(50);
    expect(clampQuality(NaN)).toBe(50);
    expect(parseParams('q=0').quality).toBe(1);
  });

  it('counts MCUs like the encoder', () => {
    expect(mcuSize('444')).toEqual([8, 8]);
    expect(mcuSize('422')).toEqual([16, 8]);
    expect(mcuCount(256, 256, '420')).toBe(256);
    expect(mcuCount(256, 256, '444')).toBe(1024);
    expect(mcuCount(99, 61, '420')).toBe(28);
    expect(mcuCount(1, 1, '422')).toBe(1);
  });
});

describe('stages', () => {
  it('lists nine stages, the first four ready', () => {
    expect(STAGES.map((s) => s.id)).toEqual(['color', 'subsample', 'blocks', 'dct', 'quantize', 'zigzag', 'rle', 'huffman', 'decode']);
    expect(STAGES.filter((s) => s.ready).map((s) => s.id)).toEqual(['color', 'subsample', 'blocks', 'dct']);
  });

  it('only lands on ready stages', () => {
    expect(readyStage('dct')).toBe('dct');
    expect(readyStage('huffman')).toBe('color');
    expect(readyStage(undefined)).toBe('color');
    expect(stepStage('color', -1)).toBe('color');
    expect(stepStage('blocks', 1)).toBe('dct');
    expect(stepStage('dct', 1)).toBe('dct');
    expect(stepStage('quantize', 1)).toBe('color');
  });
});
```
`web/src/lib/jpeg/__tests__/layout.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  LABEL,
  MARGIN,
  PORTRAIT_BELOW,
  TOOLS,
  blockAt,
  cellAt,
  cells,
  fit,
  jpegLayout,
  toDevicePanels,
  zoomWindow,
  type Rect,
} from '../layout';
import type { StageId } from '../stages';

const inside = (r: Rect, w: number, h: number) => r.x >= 0 && r.y >= 0 && r.x + r.w <= w + 1e-6 && r.y + r.h <= h + 1e-6;
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('jpegLayout', () => {
  const stages: StageId[] = ['color', 'subsample', 'blocks', 'dct'];

  for (const [w, h] of [
    [1134, 585],
    [343, 520],
    [800, 420],
  ]) {
    for (const stage of stages) {
      it(`keeps every ${stage} panel on a ${w}×${h} stage, captions included, without overlaps`, () => {
        const l = jpegLayout(stage, w, h, 256, 256, [10, 10]);
        expect(l.panels.length).toBeGreaterThan(1);
        for (const p of l.panels) {
          expect(p.rect.w).toBeGreaterThan(0);
          expect(inside({ ...p.rect, y: p.rect.y - LABEL, h: p.rect.h + LABEL }, w, h)).toBe(true);
        }
        for (let i = 0; i < l.panels.length; i++)
          for (let j = i + 1; j < l.panels.length; j++) expect(overlap(l.panels[i].rect, l.panels[j].rect)).toBe(false);
      });
    }
  }

  it('puts the image at the left on a wide stage and on top on a narrow one', () => {
    const wide = jpegLayout('color', 1134, 585, 256, 256);
    expect(wide.image.x).toBe(MARGIN);
    const cube = wide.panels.find((p) => p.kind === 'cube')!.rect;
    expect(cube.x).toBeGreaterThan(wide.image.x + wide.image.w);
    const narrow = jpegLayout('color', PORTRAIT_BELOW - 1, 700, 256, 256);
    const cube2 = narrow.panels.find((p) => p.kind === 'cube')!.rect;
    expect(cube2.y).toBeGreaterThan(narrow.image.y + narrow.image.h);
  });

  it('keeps the image square for a square picture and draws the grid only on the blocks stage', () => {
    const l = jpegLayout('blocks', 1134, 585, 256, 256);
    expect(l.image.w).toBeCloseTo(l.image.h);
    expect(l.panels[0].kind).toBe('image_grid');
    expect(jpegLayout('dct', 1134, 585, 256, 256).panels[0].kind).toBe('image');
  });

  it('leaves room under the block and the rebuild panel for their controls', () => {
    const h = 585;
    const block = jpegLayout('blocks', 1134, h, 256, 256).panels.find((p) => p.kind === 'block')!.rect;
    expect(block.y + block.h + TOOLS).toBeLessThanOrEqual(h);
    const rebuild = jpegLayout('dct', 1134, h, 256, 256).panels.find((p) => p.kind === 'rebuild')!.rect;
    expect(rebuild.y + rebuild.h + TOOLS).toBeLessThanOrEqual(h);
  });

  it('magnifies the same window around the block in all four subsample panels', () => {
    const l = jpegLayout('subsample', 1134, 585, 256, 256, [21, 17]);
    const crops = l.panels.filter((p) => p.crop).map((p) => p.crop);
    expect(crops).toHaveLength(4);
    expect(new Set(crops.map((c) => c!.join()))).toEqual(new Set(['156,124,32,32']));
  });

  it('gives a stage too small for anything no panels', () => {
    expect(jpegLayout('dct', 30, 30, 256, 256).panels).toEqual([]);
    expect(jpegLayout('dct', 800, 600, 0, 0).panels).toEqual([]);
  });

  it('hands the viz device pixels and the crop', () => {
    const [p] = toDevicePanels([{ kind: 'plane_cb', rect: { x: 1, y: 2, w: 3, h: 4 }, label: '', crop: [0, 0, 8, 8] }], 2);
    expect(p).toEqual({ kind: 'plane_cb', rect: [2, 4, 6, 8], crop: [0, 0, 8, 8] });
    expect(toDevicePanels([{ kind: 'image', rect: { x: 0, y: 0, w: 1, h: 1 }, label: '' }], 1)[0].crop).toBeNull();
  });
});

describe('geometry helpers', () => {
  it('fits an aspect ratio inside a rect, centred', () => {
    expect(fit({ x: 0, y: 0, w: 200, h: 100 }, 1, 1)).toEqual({ x: 50, y: 0, w: 100, h: 100 });
    expect(fit({ x: 0, y: 0, w: 0, h: 100 }, 1, 1).w).toBe(0);
  });

  it('keeps the zoom window inside the image', () => {
    expect(zoomWindow([0, 0], 256, 256)).toEqual([0, 0, 32, 32]);
    expect(zoomWindow([31, 31], 256, 256)).toEqual([224, 224, 32, 32]);
    expect(zoomWindow([1, 1], 20, 12)).toEqual([6, 0, 12, 12]); // centred on x = 12, side clipped to the 12 px height
  });

  it('finds the luma block under a click', () => {
    const img = { x: 10, y: 10, w: 512, h: 512 };
    expect(blockAt(10, 10, img, 256, 256)).toEqual([0, 0]);
    expect(blockAt(10 + 511, 10 + 511, img, 256, 256)).toEqual([31, 31]);
    expect(blockAt(9, 10, img, 256, 256)).toBeNull();
    expect(blockAt(10 + 512, 10, img, 256, 256)).toBeNull();
  });

  it('lays out 64 cells like the viz and finds the cell under the pointer', () => {
    const c = cells({ x: 0, y: 0, w: 160, h: 160 }, 1);
    expect(c).toHaveLength(64);
    expect(c[0]).toEqual({ x: 0, y: 0, w: 19.125, h: 19.125 });
    expect(c[63].x + c[63].w).toBeCloseTo(160);
    expect(cellAt(0, 0, { x: 0, y: 0, w: 80, h: 80 })).toEqual([0, 0]);
    expect(cellAt(79.9, 15, { x: 0, y: 0, w: 80, h: 80 })).toEqual([7, 1]);
    expect(cellAt(80, 15, { x: 0, y: 0, w: 80, h: 80 })).toBeNull();
  });
});
```
`web/src/lib/jpeg/__tests__/summary.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatBytes, readSummary, readoutOf } from '../summary';
import { busiestLine, cumulativeEnergy, mirrored, periodic, termsFor } from '../math';
import { chromaKept, samplesKept, stageTex, NOTICE } from '../formulas';
import { fitWithin } from '../images';
import { jpegSummaryFixture } from '../../test/fakeViz';

describe('readSummary', () => {
  it('parses the engine summary', () => {
    const s = readSummary(jpegSummaryFixture)!;
    expect(s.total).toBe(256);
    expect(s.mcu).toEqual([16, 16, 16, 16]);
    expect(s.grids[1]).toEqual([16, 16]);
    expect(s.selected!.bitSpan).toEqual([100, 6]);
    expect(s.selected!.dcDiff).toBe(2);
    expect(s.error).toBeNull();
  });

  it('treats undefined (a Rust None) as missing, not as a value', () => {
    const s = readSummary({ ...jpegSummaryFixture, psnr: undefined, quality: undefined, selected: undefined })!;
    expect(s.psnr).toBeNull();
    expect(s.quality).toBeNull();
    expect(s.selected).toBeNull();
  });

  it('rejects anything that is not a JPEG summary', () => {
    expect(readSummary(null)).toBeNull();
    expect(readSummary({ phase: 1 })).toBeNull();
    expect(readSummary({ ...jpegSummaryFixture, selected: { ...jpegSummaryFixture.selected, pixels: [1, 2] } })!.selected).toBeNull();
  });

  it('formats the readout', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(4096)).toBe('4.0 KB');
    const r = readoutOf(readSummary(jpegSummaryFixture)!);
    expect(r).toEqual({ size: '4.0 KB', of: '192.0 KB', ratio: '48.0 : 1', bpp: '0.50', psnr: '36.5 dB' });
    expect(readoutOf(readSummary({ ...jpegSummaryFixture, psnr: null })!).psnr).toBe('∞ dB');
  });
});

describe('math', () => {
  it('accumulates energy in the given order', () => {
    const e = cumulativeEnergy([3, 4, 0, 0], [1, 0, 2, 3]);
    expect(e).toEqual([16 / 25, 1, 1, 1]);
    expect(cumulativeEnergy([0, 0], [0, 1])).toEqual([0, 0]);
  });

  it('counts the terms that reach a share of the energy', () => {
    expect(termsFor([1, 1, 1, 1], 0.5)).toBe(2);
    expect(termsFor([9, 1], 0.9)).toBe(1);
    expect(termsFor([0, 0], 0.9)).toBe(0);
  });

  it('extends a row the two ways', () => {
    expect(periodic([1, 2], 2)).toEqual([1, 2, 1, 2]);
    expect(mirrored([1, 2], 3)).toEqual([1, 2, 2, 1, 1, 2]);
  });

  it('picks the busiest row or column', () => {
    const vertical = Array.from({ length: 64 }, (_, i) => (Math.floor(i / 8) < 4 ? 0 : 100));
    const b = busiestLine(vertical);
    expect(b.axis).toBe('column');
    expect(b.values).toEqual([0, 0, 0, 0, 100, 100, 100, 100]);
    const horizontal = Array.from({ length: 64 }, (_, i) => (i % 8) * 10);
    expect(busiestLine(horizontal).axis).toBe('row');
  });
});

describe('formulas', () => {
  it('knows how much each mode keeps', () => {
    expect(chromaKept('444')).toBe(1);
    expect(chromaKept('422')).toBe(0.5);
    expect(chromaKept('420')).toBe(0.25);
    expect(samplesKept('420')).toBe(0.5);
  });

  it('puts the selected block’s numbers into the formulas', () => {
    const s = readSummary(jpegSummaryFixture)!;
    expect(stageTex('blocks', s, null)[0]).toContain('= 100 - 128 = -28');
    expect(stageTex('dct', s, [1, 0])[1]).toContain('F(1,0)');
    expect(stageTex('dct', s, [1, 0])[1]).toContain('-20.0');
    expect(stageTex('subsample', s, null)[1]).toContain('25\\%');
    expect(stageTex('color', null, null)).toHaveLength(1);
    expect(stageTex('quantize', s, null)).toEqual([]);
  });

  it('has a notice for every ready stage', () => {
    for (const id of ['color', 'subsample', 'blocks', 'dct'] as const) expect(NOTICE[id].length).toBeGreaterThan(20);
  });
});

describe('images', () => {
  it('scales uploads down to fit 512, never up', () => {
    expect(fitWithin(300, 200)).toEqual({ w: 300, h: 200 });
    expect(fitWithin(4000, 3000)).toEqual({ w: 512, h: 384 });
    expect(fitWithin(10, 4000)).toEqual({ w: 1, h: 512 });
    expect(fitWithin(0, 10)).toEqual({ w: 0, h: 0 });
  });
});
```

- [ ] **Step 3: Run them to see them fail.** `cd web && npx vitest run src/lib/jpeg` → FAIL (`Failed to resolve import "../params"` …).

- [ ] **Step 4: Implement.**

`web/src/lib/jpeg/stages.ts`:

```ts
// The JPEG lab's pipeline: nine stages from pixels to bits and back. The rail
// shows all of them; a stage is `ready` once its screen exists (the rest are
// shown, disabled, so the whole pipeline is visible from the start).

export type StageId =
  | 'color'
  | 'subsample'
  | 'blocks'
  | 'dct'
  | 'quantize'
  | 'zigzag'
  | 'rle'
  | 'huffman'
  | 'decode';

export interface StageInfo {
  id: StageId;
  /** What the rail prints in the step's circle: 1–8, then ↺ for decode. */
  mark: string;
  title: string;
  /** One line under the title. */
  subtitle: string;
  ready: boolean;
}

export const STAGES: readonly StageInfo[] = [
  { id: 'color', mark: '1', title: 'Color', subtitle: 'RGB turns into brightness + two colour differences', ready: true },
  { id: 'subsample', mark: '2', title: 'Subsample', subtitle: 'Keep less colour than brightness', ready: true },
  { id: 'blocks', mark: '3', title: 'Blocks', subtitle: 'Cut each plane into 8 × 8 tiles', ready: true },
  { id: 'dct', mark: '4', title: 'DCT', subtitle: 'Rewrite a tile as 64 cosine patterns', ready: true },
  { id: 'quantize', mark: '5', title: 'Quantize', subtitle: 'Round the patterns coarsely', ready: false },
  { id: 'zigzag', mark: '6', title: 'Zigzag', subtitle: 'Low frequencies first', ready: false },
  { id: 'rle', mark: '7', title: 'Run-length', subtitle: 'Count the zeros', ready: false },
  { id: 'huffman', mark: '8', title: 'Huffman', subtitle: 'Short codes for common symbols', ready: false },
  { id: 'decode', mark: '↺', title: 'Decode', subtitle: 'Undo it all and compare', ready: false },
];

export const DEFAULT_STAGE: StageId = 'color';

export function isStageId(s: unknown): s is StageId {
  return typeof s === 'string' && STAGES.some((st) => st.id === s);
}

/** A stage the page can show: the id if it is ready, else the default. */
export function readyStage(s: unknown): StageId {
  return isStageId(s) && STAGES.find((st) => st.id === s)!.ready ? s : DEFAULT_STAGE;
}

/** The ready stage `delta` steps away (±1 for the arrow keys), stopping at the ends. */
export function stepStage(current: StageId, delta: number): StageId {
  const ready = STAGES.filter((s) => s.ready).map((s) => s.id);
  const i = ready.indexOf(current);
  if (i === -1) return ready[0];
  return ready[Math.max(0, Math.min(ready.length - 1, i + delta))];
}
```
`web/src/lib/jpeg/params.ts`:

```ts
// The JPEG lab's settings and its share link:
//   #/jpeg?img=text&q=30&s=444&h=std&stage=dct&b=12,7
// Defaults are omitted from the link, and anything malformed falls back to its
// default rather than failing the page.
import { buildQuery } from '../router';
import { DEFAULT_STAGE, readyStage, type StageId } from './stages';

export type ImageId = 'gradient' | 'text' | 'bars';
export type SubsamplingId = '444' | '422' | '420';
export type HuffmanId = 'optimized' | 'standard';

export const IMAGE_IDS: readonly ImageId[] = ['gradient', 'text', 'bars'];

export interface JpegParams {
  img: ImageId;
  /** 1–100. */
  quality: number;
  subsampling: SubsamplingId;
  huffman: HuffmanId;
  stage: StageId;
  /** The selected luma block `[bx, by]`; undefined → the encoder's default (the centre). */
  block?: [number, number];
}

export const DEFAULTS: JpegParams = {
  img: 'gradient',
  quality: 50,
  subsampling: '420',
  huffman: 'optimized',
  stage: DEFAULT_STAGE,
};

/** Quality from a link or a slider: a whole number in 1–100 (50 when unreadable). */
export function clampQuality(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return DEFAULTS.quality;
  return Math.min(100, Math.max(1, Math.round(n)));
}

export function parseParams(query: string): JpegParams {
  const p = new URLSearchParams(query);
  const img = p.get('img');
  const s = p.get('s');
  const block = p
    .get('b')
    ?.split(',')
    .map((v) => Number(v));
  return {
    img: (IMAGE_IDS as readonly string[]).includes(img ?? '') ? (img as ImageId) : DEFAULTS.img,
    quality: p.has('q') ? clampQuality(p.get('q')) : DEFAULTS.quality,
    subsampling: s === '444' || s === '422' || s === '420' ? s : DEFAULTS.subsampling,
    huffman: p.get('h') === 'std' ? 'standard' : 'optimized',
    stage: readyStage(p.get('stage')),
    block:
      block && block.length === 2 && block.every((v) => Number.isInteger(v) && v >= 0)
        ? [block[0], block[1]]
        : undefined,
  };
}

export function buildParams(p: JpegParams): string {
  return buildQuery({
    img: p.img === DEFAULTS.img ? undefined : p.img,
    q: p.quality === DEFAULTS.quality ? undefined : String(p.quality),
    s: p.subsampling === DEFAULTS.subsampling ? undefined : p.subsampling,
    h: p.huffman === 'standard' ? 'std' : undefined,
    stage: p.stage === DEFAULTS.stage ? undefined : p.stage,
    b: p.block ? p.block.join(',') : undefined,
  });
}

/** MCU size in pixels for a subsampling mode. */
export function mcuSize(s: SubsamplingId): [number, number] {
  return s === '444' ? [8, 8] : s === '422' ? [16, 8] : [16, 16];
}

/** How many MCUs a `w × h` image has — the engine clock's length. */
export function mcuCount(w: number, h: number, s: SubsamplingId): number {
  const [mw, mh] = mcuSize(s);
  return Math.ceil(w / mw) * Math.ceil(h / mh);
}
```
`web/src/lib/jpeg/summary.ts`:

```ts
// The JPEG rule's per-frame summary, parsed defensively: wasm-bindgen hands
// Rust's `None` over as `undefined`, so every optional field is checked with
// `== null` (null or undefined), never `=== null`.

export interface AcToken {
  run: number;
  size: number;
  amp: number;
  symbol: number;
}

export interface SelectedBlock {
  /** 0 = Y, 1 = Cb, 2 = Cr. */
  component: number;
  bx: number;
  by: number;
  mcu: number;
  /** The 64 coded samples (0–255), row-major. */
  pixels: number[];
  /** `pixels − 128`. */
  shifted: number[];
  dct: number[];
  quant: number[];
  table: number[];
  zigzag: number[];
  dcPrev: number;
  dcDiff: number;
  tokens: AcToken[];
  bitSpan: [number, number];
  bits: string;
}

export interface JpegSummary {
  version: number;
  n: number;
  total: number;
  width: number;
  height: number;
  bytes: number;
  rawBytes: number;
  bitsSoFar: number;
  payloadBits: number;
  entropyBits: number;
  /** dB; null for a perfect copy. */
  psnr: number | null;
  quality: number | null;
  subsampling: string | null;
  /** `[mcu_w, mcu_h, cols, rows]`. */
  mcu: [number, number, number, number] | null;
  /** Block grid `[cols, rows]` per component. */
  grids: [number, number][];
  selected: SelectedBlock | null;
  error: string | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const nums = (v: unknown): number[] => (Array.isArray(v) ? v.map((x) => num(x)) : []);

function readSelected(v: unknown): SelectedBlock | null {
  if (!isObj(v)) return null;
  const pixels = nums(v.pixels);
  if (pixels.length !== 64) return null;
  const span = nums(v.bit_span);
  return {
    component: num(v.component),
    bx: num(v.bx),
    by: num(v.by),
    mcu: num(v.mcu),
    pixels,
    shifted: nums(v.shifted),
    dct: nums(v.dct),
    quant: nums(v.quant),
    table: nums(v.table),
    zigzag: nums(v.zigzag),
    dcPrev: num(v.dc_prev),
    dcDiff: num(v.dc_diff),
    tokens: Array.isArray(v.tokens)
      ? v.tokens.filter(isObj).map((t) => ({ run: num(t.run), size: num(t.size), amp: num(t.amp), symbol: num(t.symbol) }))
      : [],
    bitSpan: [num(span[0]), num(span[1])],
    bits: typeof v.bits === 'string' ? v.bits : '',
  };
}

/** Parse what `engine.rule_summary()` returned; null when it isn't a JPEG summary. */
export function readSummary(raw: unknown): JpegSummary | null {
  if (!isObj(raw) || typeof raw.total !== 'number') return null;
  const mcu = nums(raw.mcu);
  return {
    version: num(raw.version),
    n: num(raw.n),
    total: num(raw.total),
    width: num(raw.width),
    height: num(raw.height),
    bytes: num(raw.bytes),
    rawBytes: num(raw.raw_bytes),
    bitsSoFar: num(raw.bits_so_far),
    payloadBits: num(raw.payload_bits),
    entropyBits: num(raw.entropy_bits),
    psnr: raw.psnr == null ? null : num(raw.psnr),
    quality: raw.quality == null ? null : num(raw.quality),
    subsampling: typeof raw.subsampling === 'string' ? raw.subsampling : null,
    mcu: mcu.length === 4 ? [mcu[0], mcu[1], mcu[2], mcu[3]] : null,
    grids: Array.isArray(raw.grids)
      ? raw.grids.map((g) => {
          const [c, r] = nums(g);
          return [num(c), num(r)] as [number, number];
        })
      : [],
    selected: readSelected(raw.selected),
    error: typeof raw.error === 'string' ? raw.error : null,
  };
}

/** `18.4 KB` / `512 B`: bytes for people. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${Math.round(n)} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}

/** The readout strip's figures: size, ratio, bits per pixel, PSNR. */
export function readoutOf(s: JpegSummary): { size: string; of: string; ratio: string; bpp: string; psnr: string } {
  const px = Math.max(1, s.width * s.height);
  return {
    size: formatBytes(s.bytes),
    of: formatBytes(s.rawBytes),
    ratio: s.bytes > 0 ? `${(s.rawBytes / s.bytes).toFixed(1)} : 1` : '–',
    bpp: ((8 * s.bytes) / px).toFixed(2),
    psnr: s.psnr == null ? '∞ dB' : `${s.psnr.toFixed(1)} dB`,
  };
}
```
`web/src/lib/jpeg/layout.ts`:

```ts
// Pure geometry for the JPEG lab. The page measures its canvas, asks for the
// current stage's layout here and pushes the panels to the viz in device
// pixels; the overlay hangs labels and numbers on the same rects, so text and
// drawing line up by construction. Rust does no page layout.

import type { StageId } from './stages';

/** A rectangle in CSS pixels, canvas-local, y down. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Panel kinds the Rust viz draws (see `visualizations/jpeg.rs`). */
export type PanelKind =
  | 'image'
  | 'image_grid'
  | 'plane_y'
  | 'plane_cb'
  | 'plane_cr'
  | 'coded_cb'
  | 'coded_cr'
  | 'cube'
  | 'block'
  | 'atlas'
  | 'coeffs'
  | 'rebuild';

export interface Panel {
  kind: PanelKind;
  rect: Rect;
  /** Caption the overlay prints above the panel. */
  label: string;
  /** For plane panels: the part of the image shown, `[x, y, w, h]` in image pixels (default: all). */
  crop?: [number, number, number, number];
}

export interface StageLayout {
  /** The image panel (also in `panels`): clicks here pick a block. */
  image: Rect;
  panels: Panel[];
  /** Room left for DOM-only content (charts), or a zero rect. */
  extra: Rect;
}

/** Space around and between panels. */
export const MARGIN = 16;
/** Height reserved above each panel for its caption. */
export const LABEL = 22;
/** Below this canvas width the image goes on top instead of at the left. */
export const PORTRAIT_BELOW = 640;
/** Room kept under a panel for the controls the overlay puts there. */
export const TOOLS = 44;
/** Side, in image pixels, of the window the subsample stage magnifies around the selected block. */
export const ZOOM_WINDOW = 32;

const ZERO: Rect = { x: 0, y: 0, w: 0, h: 0 };

/** The largest rect with aspect `aw : ah`, centred in `r` (same as the viz's `fit_rect`). */
export function fit(r: Rect, aw: number, ah: number): Rect {
  if (!(r.w > 0 && r.h > 0 && aw > 0 && ah > 0)) return { x: r.x, y: r.y, w: 0, h: 0 };
  const s = Math.min(r.w / aw, r.h / ah);
  const w = aw * s;
  const h = ah * s;
  return { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h };
}

/** A square of side `side` centred horizontally in `r`, at its top. */
function squareTop(r: Rect, side: number): Rect {
  const s = Math.max(0, Math.min(side, r.w, r.h));
  return { x: r.x + (r.w - s) / 2, y: r.y, w: s, h: s };
}

/** `r` shrunk by the caption band at its top. */
function belowLabel(r: Rect): Rect {
  return { x: r.x, y: r.y + LABEL, w: r.w, h: Math.max(0, r.h - LABEL) };
}

/**
 * A `ZOOM_WINDOW`-pixel square of the image centred on luma block `block`,
 * kept inside the image (smaller images are shown whole).
 */
export function zoomWindow(block: [number, number], imgW: number, imgH: number): [number, number, number, number] {
  const side = Math.min(ZOOM_WINDOW, imgW, imgH);
  const cx = block[0] * 8 + 4;
  const cy = block[1] * 8 + 4;
  const x = Math.max(0, Math.min(imgW - side, Math.round(cx - side / 2)));
  const y = Math.max(0, Math.min(imgH - side, Math.round(cy - side / 2)));
  return [x, y, side, side];
}

/** Splits `r` into `n` equal columns `gap` apart. */
function columns(r: Rect, n: number, gap: number): Rect[] {
  const w = (r.w - gap * (n - 1)) / n;
  return Array.from({ length: n }, (_, i) => ({ x: r.x + i * (w + gap), y: r.y, w: Math.max(0, w), h: r.h }));
}

/**
 * The stage's panels. Landscape: the image at the left (up to 45% of the
 * width), the stage's focus panels to its right. Portrait (narrower than
 * `PORTRAIT_BELOW`): the image on top (42% of the height), focus below.
 * `block` (luma block coordinates) centres the subsample stage's magnified
 * window. A canvas too small for anything gives empty panels.
 */
export function jpegLayout(
  stage: StageId,
  cssW: number,
  cssH: number,
  imgW: number,
  imgH: number,
  block: [number, number] = [0, 0],
): StageLayout {
  const m = MARGIN;
  if (!(cssW > 2 * m + 40 && cssH > 2 * m + LABEL + 40 && imgW > 0 && imgH > 0)) {
    return { image: ZERO, panels: [], extra: ZERO };
  }
  let imageArea: Rect;
  let focus: Rect;
  if (cssW >= PORTRAIT_BELOW) {
    const colW = Math.min(cssH - 2 * m - LABEL, (cssW - 3 * m) * 0.45);
    imageArea = { x: m, y: m, w: colW, h: cssH - 2 * m };
    focus = { x: 2 * m + colW, y: m, w: cssW - 3 * m - colW, h: cssH - 2 * m };
  } else {
    const rowH = (cssH - 3 * m) * 0.42;
    imageArea = { x: m, y: m, w: cssW - 2 * m, h: rowH };
    focus = { x: m, y: 2 * m + rowH, w: cssW - 2 * m, h: cssH - 3 * m - rowH };
  }
  const image = fit(belowLabel(imageArea), imgW, imgH);
  const panels: Panel[] = [
    { kind: stage === 'blocks' ? 'image_grid' : 'image', rect: image, label: 'The image — click a block' },
  ];
  let extra: Rect = ZERO;
  const g = m;

  switch (stage) {
    case 'color': {
      const cubeSide = Math.min(focus.w, (focus.h - LABEL) * 0.66);
      const cube = squareTop(belowLabel(focus), cubeSide);
      panels.push({ kind: 'cube', rect: cube, label: 'Every pixel as a point in the colour cube' });
      const row = { x: focus.x, y: cube.y + cube.h + g, w: focus.w, h: focus.y + focus.h - (cube.y + cube.h + g) };
      const kinds: [PanelKind, string][] = [
        ['plane_y', 'Y — brightness'],
        ['plane_cb', 'Cb — blue vs yellow'],
        ['plane_cr', 'Cr — red vs green'],
      ];
      columns(row, 3, g).forEach((c, i) => {
        panels.push({ kind: kinds[i][0], rect: fit(belowLabel(c), imgW, imgH), label: kinds[i][1] });
      });
      break;
    }
    case 'subsample': {
      const crop = zoomWindow(block, imgW, imgH);
      const zoom = `${crop[2]} × ${crop[3]} px around the block`;
      const [left, right] = columns(focus, 2, g);
      const half = (r: Rect): [Rect, Rect] => {
        const h = (r.h - g) / 2;
        return [
          { x: r.x, y: r.y, w: r.w, h },
          { x: r.x, y: r.y + h + g, w: r.w, h },
        ];
      };
      const [cbFull, crFull] = half(left);
      const [cbKept, crKept] = half(right);
      const sq = (r: Rect) => fit(belowLabel(r), 1, 1);
      panels.push({ kind: 'plane_cb', rect: sq(cbFull), label: `Cb as measured — ${zoom}`, crop });
      panels.push({ kind: 'coded_cb', rect: sq(cbKept), label: 'Cb as kept', crop });
      panels.push({ kind: 'plane_cr', rect: sq(crFull), label: `Cr as measured — ${zoom}`, crop });
      panels.push({ kind: 'coded_cr', rect: sq(crKept), label: 'Cr as kept', crop });
      break;
    }
    case 'blocks': {
      const area = belowLabel(focus);
      const side = Math.min(area.w, area.h - TOOLS);
      panels.push({ kind: 'block', rect: squareTop(area, side), label: 'The selected block, sample by sample' });
      break;
    }
    case 'dct': {
      const area = belowLabel(focus);
      const side = Math.min((area.w - g) / 2, area.h * 0.5);
      const [l, r] = columns({ x: area.x, y: area.y, w: area.w, h: side }, 2, g);
      panels.push({ kind: 'atlas', rect: squareTop(l, side), label: 'The 64 cosine patterns' });
      panels.push({ kind: 'coeffs', rect: squareTop(r, side), label: 'How much of each this block uses' });
      const below = belowLabel({ x: area.x, y: area.y + side + g, w: area.w, h: area.y + area.h - (area.y + side + g) });
      const rebuildSide = Math.max(0, Math.min(below.h - TOOLS, (below.w - g) * 0.4));
      panels.push({ kind: 'rebuild', rect: { x: below.x, y: below.y, w: rebuildSide, h: rebuildSide }, label: 'Rebuilt from the first k patterns' });
      extra = { x: below.x + rebuildSide + g, y: below.y - LABEL, w: Math.max(0, below.w - rebuildSide - g), h: below.h + LABEL };
      break;
    }
    default:
      break;
  }
  return { image, panels, extra };
}

/** Panels as the viz config wants them: `[x, y, w, h]` in device pixels. */
export function toDevicePanels(
  panels: Panel[],
  dpr: number,
): { kind: PanelKind; rect: [number, number, number, number]; crop: [number, number, number, number] | null }[] {
  return panels.map((p) => ({
    kind: p.kind,
    rect: [p.rect.x * dpr, p.rect.y * dpr, p.rect.w * dpr, p.rect.h * dpr],
    crop: p.crop ?? null,
  }));
}

/** The luma block under a point of the image panel, or null outside it. */
export function blockAt(x: number, y: number, image: Rect, imgW: number, imgH: number): [number, number] | null {
  if (!(image.w > 0 && image.h > 0) || x < image.x || y < image.y || x >= image.x + image.w || y >= image.y + image.h) {
    return null;
  }
  const px = ((x - image.x) / image.w) * imgW;
  const py = ((y - image.y) / image.h) * imgH;
  return [Math.floor(px / 8), Math.floor(py / 8)];
}

/**
 * The 64 cells of an 8 × 8 grid in `r`, row-major, matching the viz's
 * `cells_8x8` with its gap of `max(w / 160, 1)` device pixels (converted with
 * `dpr`), so overlay numbers sit on the drawn cells.
 */
export function cells(r: Rect, dpr: number): Rect[] {
  const gap = Math.max((r.w * dpr) / 160, 1) / dpr;
  const cw = (r.w - 7 * gap) / 8;
  const ch = (r.h - 7 * gap) / 8;
  return Array.from({ length: 64 }, (_, i) => ({
    x: r.x + (i % 8) * (cw + gap),
    y: r.y + Math.floor(i / 8) * (ch + gap),
    w: cw,
    h: ch,
  }));
}

/** Which of an 8 × 8 grid's cells `[u, v]` a point falls in, or null. */
export function cellAt(x: number, y: number, r: Rect): [number, number] | null {
  if (!(r.w > 0) || x < r.x || y < r.y || x >= r.x + r.w || y >= r.y + r.h) return null;
  return [Math.min(7, Math.floor(((x - r.x) / r.w) * 8)), Math.min(7, Math.floor(((y - r.y) / r.h) * 8))];
}
```
`web/src/lib/jpeg/math.ts`:

```ts
// Small pure helpers behind the DCT stage's charts. The transforms themselves
// come from the Rust kit; these only summarise their output.

/**
 * Running share of a block's energy (sum of squared coefficients) captured
 * by the first 1, 2, … 64 coefficients in `order` (the zigzag order). Ends
 * at 1; all zeros for an all-zero block.
 */
export function cumulativeEnergy(coeffs: readonly number[], order: readonly number[]): number[] {
  const total = coeffs.reduce((s, c) => s + c * c, 0);
  let acc = 0;
  return order.map((i) => {
    acc += coeffs[i] * coeffs[i];
    return total > 0 ? acc / total : 0;
  });
}

/** How many of the largest terms (by energy) reach `frac` of the total; 0 when there is no energy. */
export function termsFor(energies: readonly number[], frac: number): number {
  const total = energies.reduce((s, e) => s + e, 0);
  if (!(total > 0)) return 0;
  const sorted = [...energies].sort((a, b) => b - a);
  let acc = 0;
  for (let i = 0; i < sorted.length; i++) {
    acc += sorted[i];
    if (acc >= frac * total - 1e-9) return i + 1;
  }
  return sorted.length;
}

/** `x`, reversed `x`, `x`, … (`reps` copies): what the DCT assumes lies beyond the block. */
export function mirrored(x: readonly number[], reps: number): number[] {
  const out: number[] = [];
  for (let r = 0; r < reps; r++) out.push(...(r % 2 === 0 ? x : [...x].reverse()));
  return out;
}

/** `x` repeated `reps` times: what the DFT assumes. */
export function periodic(x: readonly number[], reps: number): number[] {
  const out: number[] = [];
  for (let r = 0; r < reps; r++) out.push(...x);
  return out;
}

/**
 * The row or column of a row-major 8 × 8 block with the most variation — the
 * most telling line for "why cosines?" — as `{ axis, index, values }`.
 */
export function busiestLine(block: readonly number[]): { axis: 'row' | 'column'; index: number; values: number[] } {
  let best = { axis: 'row' as 'row' | 'column', index: 0, values: block.slice(0, 8) };
  let bestSpread = -1;
  for (const axis of ['row', 'column'] as const) {
    for (let i = 0; i < 8; i++) {
      const values = Array.from({ length: 8 }, (_, j) => (axis === 'row' ? block[8 * i + j] : block[i + 8 * j]));
      const spread = Math.max(...values) - Math.min(...values) + Math.abs(values[7] - values[0]);
      if (spread > bestSpread) {
        bestSpread = spread;
        best = { axis, index: i, values };
      }
    }
  }
  return best;
}
```
`web/src/lib/jpeg/formulas.ts`:

```ts
// Each stage's formula (TeX) with live numbers for the selected block, and a
// one-line "notice" for the reader. Only numbers are interpolated into TeX.
import type { StageId } from './stages';
import type { JpegSummary } from './summary';

const COMPONENT = ['Y', 'C_b', 'C_r'];

const fmt = (v: number, digits = 0) => (Math.abs(v) < 1e-9 ? '0' : v.toFixed(digits));

export const COLOR_TEX = String.raw`\begin{bmatrix} Y \\ C_b \\ C_r \end{bmatrix} =
\begin{bmatrix} 0.299 & 0.587 & 0.114 \\ -0.1687 & -0.3313 & 0.5 \\ 0.5 & -0.4187 & -0.0813 \end{bmatrix}
\begin{bmatrix} R \\ G \\ B \end{bmatrix} + \begin{bmatrix} 0 \\ 128 \\ 128 \end{bmatrix}`;

export const DCT_TEX = String.raw`F(u,v) = \tfrac14\, C(u)\, C(v) \sum_{x=0}^{7} \sum_{y=0}^{7} f(x,y)\, \cos\frac{(2x+1)u\pi}{16}\, \cos\frac{(2y+1)v\pi}{16}`;

/** Share of the chroma samples a mode keeps (each of Cb and Cr). */
export function chromaKept(subsampling: string | null): number {
  return subsampling === '444' ? 1 : subsampling === '422' ? 0.5 : 0.25;
}

/** Share of all samples (Y + Cb + Cr) a mode keeps. */
export function samplesKept(subsampling: string | null): number {
  return (1 + 2 * chromaKept(subsampling)) / 3;
}

/** The formula for `stage`, with the selected block's numbers where the stage has them. */
export function stageTex(stage: StageId, s: JpegSummary | null, hover: [number, number] | null): string[] {
  const sel = s?.selected ?? null;
  switch (stage) {
    case 'color':
      return [COLOR_TEX];
    case 'subsample': {
      const keep = chromaKept(s?.subsampling ?? null);
      const avg =
        s?.subsampling === '444'
          ? String.raw`C'(i,j) = C(i,j)`
          : s?.subsampling === '422'
            ? String.raw`C'(i,j) = \tfrac12\,[\,C(2i,j) + C(2i{+}1,j)\,]`
            : String.raw`C'(i,j) = \tfrac14\,[\,C(2i,2j) + C(2i{+}1,2j) + C(2i,2j{+}1) + C(2i{+}1,2j{+}1)\,]`;
      return [avg, String.raw`\text{chroma kept} = ${Math.round(keep * 100)}\%,\quad \text{all samples kept} = ${Math.round(samplesKept(s?.subsampling ?? null) * 100)}\%`];
    }
    case 'blocks': {
      if (!sel) return [String.raw`f(x,y) = \text{sample}(x,y) - 128`];
      const c = COMPONENT[sel.component] ?? 'Y';
      return [String.raw`f(0,0) = ${c}(0,0) - 128 = ${fmt(sel.pixels[0])} - 128 = ${fmt(sel.shifted[0])}`];
    }
    case 'dct': {
      if (!sel) return [DCT_TEX];
      const [u, v] = hover ?? [0, 0];
      const val = sel.dct[u + 8 * v];
      const cu = u === 0 ? String.raw`\tfrac{1}{\sqrt2}` : '1';
      const cv = v === 0 ? String.raw`\tfrac{1}{\sqrt2}` : '1';
      return [DCT_TEX, String.raw`F(${u},${v}) = \tfrac14 \cdot ${cu} \cdot ${cv} \sum \sum f(x,y)\cos\cdots = ${fmt(val, 1)}`];
    }
    default:
      return [];
  }
}

/** What to look for on each stage. */
export const NOTICE: Record<StageId, string> = {
  color:
    'Y looks like the picture itself; Cb and Cr are flat and soft. Turn the cube: the grey diagonal becomes the Y axis, and most pixels huddle close to it.',
  subsample:
    'Half the data is gone in 4:2:0, and you can barely tell — the eye resolves brightness far more finely than colour.',
  blocks:
    'From here on the image is a pile of independent 8 × 8 problems, 64 numbers each. Click anywhere on the image to follow a different block.',
  dct:
    'A handful of low-frequency patterns carry almost all the energy. Slide k up from 0 and watch the block appear long before all 64 terms are in.',
  quantize: '',
  zigzag: '',
  rle: '',
  huffman: '',
  decode: '',
};
```
`web/src/lib/jpeg/images.ts`:

```ts
// Where the lab's pictures come from: the generated built-ins (made in Rust
// by the kit, so the engine, the tests and the page all see the same pixels)
// and the reader's own uploads, decoded by the browser and scaled down to fit
// `MAX_SIDE`.
import { loadVizCore } from '../wasm/loader';
import type { ImageId } from './params';

/** RGBA pixels, 4 bytes each, top row first. */
export interface RgbaImage {
  w: number;
  h: number;
  rgba: Uint8Array;
}

/** Side of the built-ins. */
export const BUILTIN_SIDE = 256;
/** Uploads are scaled down so neither side exceeds this. */
export const MAX_SIDE = 512;

export const IMAGES: readonly { id: ImageId; label: string; title: string }[] = [
  { id: 'gradient', label: 'Gradient', title: 'A smooth sky: low quality shows blocks' },
  { id: 'text', label: 'Text', title: 'Hard black-on-white edges: low quality rings' },
  { id: 'bars', label: 'Bars', title: 'Saturated colour: subsampling bleeds' },
];

/** A generated built-in at `BUILTIN_SIDE²`. */
export async function loadBuiltin(id: ImageId): Promise<RgbaImage> {
  const viz = await loadVizCore();
  return { w: BUILTIN_SIDE, h: BUILTIN_SIDE, rgba: viz.jpeg_builtin_image(id, BUILTIN_SIDE, BUILTIN_SIDE) };
}

/** The size an `w × h` upload is scaled to: unchanged when it fits, else shrunk to fit `max` keeping its shape. */
export function fitWithin(w: number, h: number, max = MAX_SIDE): { w: number; h: number } {
  if (!(w > 0 && h > 0)) return { w: 0, h: 0 };
  const s = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

/**
 * Decode an uploaded file with the browser and scale it to fit `MAX_SIDE`.
 * Rejects (with a reader-facing message) when the file is not an image the
 * browser can open.
 */
export async function decodeUpload(file: Blob): Promise<RgbaImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('That file is not an image this browser can open.');
  }
  const { w, h } = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This browser cannot read image pixels.');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const data = ctx.getImageData(0, 0, w, h).data;
  return { w, h, rgba: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
}
```

- [ ] **Step 5: Run the tests.** `cd web && npx vitest run src/lib/jpeg` → PASS, 41 tests. Then `npx vitest run` → 455 passed (414 + 41), and `npx svelte-check --tsconfig ./tsconfig.json` → 0 errors.

- [ ] **Step 6: Commit.**

```bash
git add web/src/lib/jpeg web/src/lib/test/fakeViz.ts
git commit -m "feat(web): JPEG lab stages, share link, summary parsing, layout and formulas"
```

---

## Task 5: The lab page

Needs Task 1 (the engine methods) built into `crates/viz-core/pkg` for type-checking, and Task 4's modules.

**Files:**
- Create: `web/src/lib/components/Tex.svelte`, `web/src/lib/components/jpeg/StageRail.svelte`, `web/src/lib/components/jpeg/CellNumbers.svelte`, `web/src/lib/components/jpeg/DctCharts.svelte`, `web/src/lib/components/labs/JpegLab.svelte`, `web/src/lib/components/__tests__/JpegLab.test.ts`
- Modify: `web/src/lib/router.ts`, `web/src/App.svelte`, `web/src/lib/components/labApi.svelte.ts`, `web/src/lib/components/Icon.svelte`

**Interfaces:**
- Consumes:
  - Task 4's modules and fakes.
  - `LabShell` (snippets `controls`, `overlay`, `story`; `zoom={false}`; `onReady`).
  - `cmd` from `playback/commands`; `route` and `replaceQuery` from `router.svelte`.
- Produces:
  - `LabApi.setRuleConfigWithImage(cfg, w, h, rgba)`.
  - Route `#/jpeg` (`LabId` gains `'jpeg'`; not linked from the nav or the home page until Plan 4).
  - `Tex.svelte`, a generic lazy-KaTeX formula component.
  - Icons `upload` and `download`.

- [ ] **Step 1: Write the failing test.** Create `web/src/lib/components/__tests__/JpegLab.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import {
  installRafPolyfill,
  dispatchSpy,
  ruleActionSpy,
  updateRuleConfigWithImageSpy,
  updateVizConfigSpy,
} from '../../test/fakeViz';
import { navigate, route } from '../../router.svelte';

installRafPolyfill();

vi.mock('../../wasm/loader', async () => {
  const { makeVizMock } = await import('../../test/fakeViz');
  return { loadVizCore: vi.fn(() => Promise.resolve(makeVizMock())) };
});

// App also imports the Fourier lab, which fetches a font; jsdom has no origin to fetch from.
vi.mock('../../fourier/textPath', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../fourier/textPath')>()),
  textToPath: vi.fn(async () => []),
}));

import App from '../../../App.svelte';

// jsdom lays nothing out; give the stage's canvas a desktop size so the lab
// has panels (and their controls) to show.
const size = (w: number, h: number) => ({
  configurable: true,
  get(this: HTMLElement) {
    return this.tagName === 'CANVAS' ? (w === 0 ? h : w) : 0;
  },
});
Object.defineProperty(HTMLElement.prototype, 'clientWidth', size(1134, 0));
Object.defineProperty(HTMLElement.prototype, 'clientHeight', size(0, 585));

type Push = [{ image_id: string; quality: number; subsampling: string; huffman: string; max_iterations: number }, number, number, Uint8Array];
const pushes = () => updateRuleConfigWithImageSpy.mock.calls as Push[];
const lastPush = () => pushes()[pushes().length - 1];
const kinds = () => dispatchSpy.mock.calls.map(([c]) => (c as { kind: string }).kind);
const lastViz = () => updateVizConfigSpy.mock.lastCall?.[0] as Record<string, unknown>;

async function renderLab(query = '') {
  navigate('jpeg', query);
  const result = render(App);
  await vi.waitFor(() => expect(pushes().length).toBeGreaterThan(0));
  return result;
}

describe('JpegLab.svelte', () => {
  beforeEach(() => {
    dispatchSpy.mockClear();
    ruleActionSpy.mockClear();
    updateRuleConfigWithImageSpy.mockClear();
    updateVizConfigSpy.mockClear();
  });

  it('encodes the default gradient as a typed array and plays the scan', async () => {
    await renderLab();
    const [cfg, w, h, rgba] = lastPush();
    expect(cfg).toEqual({ image_id: 'gradient', quality: 50, subsampling: '420', huffman: 'optimized', max_iterations: 256 });
    expect([w, h, rgba.length]).toEqual([256, 256, 256 * 256 * 4]);
    expect(kinds()).toContain('Play');
    expect(dispatchSpy).toHaveBeenCalledWith({ kind: 'SetSpeed', value: 64 });
  });

  it('shows the readout from the summary', async () => {
    const { container } = await renderLab();
    await vi.waitFor(() => expect(container.querySelector('.stats')?.textContent).toContain('4.0 KB'));
    expect(container.querySelector('.stats')?.textContent).toContain('36.5 dB');
  });

  it('re-encodes on a quality change and puts the scan back where it was', async () => {
    const { getByLabelText } = await renderLab();
    dispatchSpy.mockClear();
    await fireEvent.input(getByLabelText('Quality'), { target: { value: '20' } });
    expect(lastPush()[0].quality).toBe(20);
    // The fake snapshot sits at 0 of 360 and paused: nothing to restore, no Play.
    expect(kinds()).not.toContain('Play');
    expect(route.query).toContain('q=20');
  });

  it('counts MCUs for the chosen subsampling', async () => {
    const { getByLabelText } = await renderLab();
    await fireEvent.click(getByLabelText('4:4:4'));
    expect(lastPush()[0]).toMatchObject({ subsampling: '444', max_iterations: 1024 });
    expect(route.query).toContain('s=444');
  });

  it('loads a shared link and rewrites junk to what loaded', async () => {
    await renderLab('img=text&q=999&s=422&h=std&stage=huffman');
    expect(lastPush()[0]).toEqual({ image_id: 'text', quality: 100, subsampling: '422', huffman: 'standard', max_iterations: 512 });
    expect(route.query).toBe('img=text&q=100&s=422&h=std');
  });

  it('moves between ready stages with the rail and the arrow keys', async () => {
    const { getByRole, container } = await renderLab();
    expect(getByRole('button', { name: /Color/ }).getAttribute('aria-current')).toBe('step');
    expect((getByRole('button', { name: /Huffman/ }) as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.click(getByRole('button', { name: /DCT/ }));
    expect(route.query).toBe('stage=dct');
    await fireEvent.keyDown(window, { key: 'ArrowLeft' }); // a key on the window itself (no element target)
    expect(route.query).toBe('stage=blocks');
    // Keys typed into a control are the control's.
    const quality = container.querySelector('input[aria-label="Quality"]')!;
    await fireEvent.keyDown(quality, { key: 'ArrowLeft' });
    expect(route.query).toBe('stage=blocks');
    expect(container.querySelector('.stage-card h2')?.textContent).toContain('Blocks');
  });

  it('selects the plane to follow on the blocks stage', async () => {
    const { getByRole } = await renderLab('stage=blocks');
    ruleActionSpy.mockClear();
    await fireEvent.click(getByRole('button', { name: 'Cb' }));
    // The summary's luma block (21, 17) is the anchor; 4:2:0 halves it for chroma.
    expect(ruleActionSpy).toHaveBeenLastCalledWith({ kind: 'select_block', component: 1, bx: 10, by: 8 });
  });

  it('turns the cube and sets k through the viz config', async () => {
    const { getByLabelText } = await renderLab();
    await vi.waitFor(() => expect(getByLabelText('RGB axes to YCbCr axes')).toBeTruthy());
    await fireEvent.input(getByLabelText('RGB axes to YCbCr axes'), { target: { value: '1' } });
    expect(lastViz().cube_mix).toBe(1);
  });

  it('keeps the current image and says why when an upload cannot be read', async () => {
    const { container, findByRole } = await renderLab();
    const before = pushes().length;
    vi.stubGlobal('createImageBitmap', vi.fn(() => Promise.reject(new Error('nope'))));
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await fireEvent.change(input, { target: { files: [new File(['x'], 'x.txt', { type: 'text/plain' })] } });
    expect((await findByRole('alert')).textContent).toContain('not an image');
    expect(pushes().length).toBe(before);
    vi.unstubAllGlobals();
  });

  it('saves the encoded bytes as a .jpg', async () => {
    const { getByRole } = await renderLab('q=75&s=444');
    const create = vi.fn(() => 'blob:x');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await fireEvent.click(getByRole('button', { name: /Save .jpg/ }));
    expect(create).toHaveBeenCalledOnce();
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('jpeg-lab-q75-444.jpg');
    click.mockRestore();
  });
});
```

- [ ] **Step 2: Run it to see it fail.** `cd web && npx vitest run src/lib/components/__tests__/JpegLab.test.ts` → FAIL. Waiting for the first image push times out, because `#/jpeg` falls back to home.

- [ ] **Step 3: Wire the route, the API and the icons.** Apply:

`web/src/lib/router.ts`:

```diff
--- a/web/src/lib/router.ts
+++ b/web/src/lib/router.ts
@@ -1,11 +1,11 @@
 // Pure hash-route parsing. Kept free of runes/DOM so it's trivially testable;
 // the reactive `route` object lives in router.svelte.ts.
 
-export type LabId = 'sierpinski' | 'fourier' | 'sorting' | 'notes';
+export type LabId = 'sierpinski' | 'fourier' | 'sorting' | 'notes' | 'jpeg';
 /** Every page: the gallery home, or one lab. */
 export type RouteId = 'home' | LabId;
 
-export const LAB_IDS: readonly LabId[] = ['sierpinski', 'fourier', 'sorting', 'notes'];
+export const LAB_IDS: readonly LabId[] = ['sierpinski', 'fourier', 'sorting', 'notes', 'jpeg'];
 
 /** `#/fourier` → 'fourier'; anything else (empty, `#`, `#/`, unknown) → 'home'. */
 export function parseHash(hash: string): RouteId {
```
`web/src/App.svelte`:

```diff
--- a/web/src/App.svelte
+++ b/web/src/App.svelte
@@ -8,6 +8,7 @@
   import FourierLab from './lib/components/labs/FourierLab.svelte';
   import SortingLab from './lib/components/labs/SortingLab.svelte';
   import NotesLab from './lib/components/labs/NotesLab.svelte';
+  import JpegLab from './lib/components/labs/JpegLab.svelte';
 
   onMount(installRouter);
 </script>
@@ -39,6 +40,8 @@
       <SortingLab />
     {:else if route.id === 'notes'}
       <NotesLab />
+    {:else if route.id === 'jpeg'}
+      <JpegLab />
     {:else}
       <SierpinskiLab />
     {/if}
```
`web/src/lib/components/labApi.svelte.ts`:

```diff
--- a/web/src/lib/components/labApi.svelte.ts
+++ b/web/src/lib/components/labApi.svelte.ts
@@ -39,6 +39,19 @@ export class LabApi {
     }
   }
 
+  /**
+   * Replace the rule config with scalar fields as JSON plus an RGBA image as a
+   * typed array (`w × h × 4` bytes) — zero-copy across the WASM boundary. Only
+   * rules with an image (the JPEG lab) accept this.
+   */
+  setRuleConfigWithImage(cfg: object, w: number, h: number, rgba: Uint8Array) {
+    try {
+      this.engine?.update_rule_config_with_image(cfg, w, h, rgba);
+    } catch (err) {
+      console.warn('update_rule_config_with_image failed:', err);
+    }
+  }
+
   /** Replace the rule config wholesale (use this when the config is large, e.g. a 2000-point path). */
   setRuleConfig(cfg: object) {
     try {
```
`web/src/lib/components/Icon.svelte`:

```diff
--- a/web/src/lib/components/Icon.svelte
+++ b/web/src/lib/components/Icon.svelte
@@ -1,7 +1,7 @@
 <script lang="ts" module>
   export const ICON_NAMES = [
     'play', 'pause', 'skip-back', 'skip-forward', 'rotate-ccw', 'volume', 'volume-off',
-    'copy', 'check', 'zoom-in', 'zoom-out', 'sun', 'moon', 'monitor', 'github',
+    'copy', 'check', 'zoom-in', 'zoom-out', 'sun', 'moon', 'monitor', 'github', 'upload', 'download',
   ] as const;
   export type IconName = (typeof ICON_NAMES)[number];
 
@@ -21,6 +21,8 @@
     sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4 1.4-1.4"/>',
     moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
     monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
+    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
+    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
     github: '<path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.9a3.4 3.4 0 0 0-.9-2.6c3.1-.3 6.4-1.5 6.4-7A5.4 5.4 0 0 0 20 4.8 5 5 0 0 0 19.9 1S18.7.7 16 2.5a13.4 13.4 0 0 0-7 0C6.3.7 5.1 1 5.1 1A5 5 0 0 0 5 4.8a5.4 5.4 0 0 0-1.5 3.8c0 5.4 3.3 6.6 6.4 7a3.4 3.4 0 0 0-.9 2.6V23"/>',
   };
 </script>
```

- [ ] **Step 4: Create the components.**

`web/src/lib/components/Tex.svelte`:

```svelte
<script lang="ts">
  // One displayed formula. KaTeX (~280 KB) loads lazily on first use, so a
  // page that never shows a formula never pays for it; until it arrives the
  // TeX source shows as code. Callers interpolate only numbers into `tex`,
  // so the rendered HTML is safe to inject with {@html}.
  import { onMount } from 'svelte';

  interface Props {
    tex: string;
    /** Display (block) math; inline when false. */
    display?: boolean;
  }

  let { tex, display = true }: Props = $props();

  type RenderToString = (tex: string, options?: object) => string;
  let render = $state<RenderToString | null>(null);

  onMount(() => {
    let alive = true;
    void (async () => {
      try {
        const [{ default: katex }] = await Promise.all([import('katex'), import('katex/dist/katex.min.css')]);
        if (alive) render = katex.renderToString;
      } catch (err) {
        console.warn('KaTeX failed to load:', err);
      }
    })();
    return () => {
      alive = false;
    };
  });
</script>

<div class="tex" class:inline={!display}>
  {#if render}
    {@html render(tex, { displayMode: display, throwOnError: false })}
  {:else}
    <code>{tex}</code>
  {/if}
</div>

<style>
  .tex {
    overflow-x: auto;
    font-size: 0.85em;
    color: var(--ink);
  }
  .tex.inline {
    display: inline-block;
  }
  .tex :global(.katex-display) {
    margin: 0.4em 0;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 0.2em 0;
  }
  code {
    display: block;
    white-space: pre-wrap;
    font-size: 0.8em;
    opacity: 0.7;
  }
</style>
```
`web/src/lib/components/jpeg/StageRail.svelte`:

```svelte
<script lang="ts">
  // The pipeline rail: nine numbered steps, the current one marked. Stages
  // not built yet stay visible but disabled, so the whole pipeline reads at a
  // glance.
  import { STAGES, type StageId } from '../../jpeg/stages';

  interface Props {
    current: StageId;
    onselect: (id: StageId) => void;
  }

  let { current, onselect }: Props = $props();
</script>

<nav class="rail" aria-label="JPEG pipeline">
  <ol>
    {#each STAGES as s (s.id)}
      <li>
        <button
          class="step"
          class:current={s.id === current}
          aria-current={s.id === current ? 'step' : undefined}
          disabled={!s.ready}
          title={s.ready ? s.subtitle : `${s.subtitle} (coming soon)`}
          onclick={() => onselect(s.id)}
        >
          <span class="mark mono">{s.mark}</span>
          <span class="title">{s.title}</span>
        </button>
      </li>
    {/each}
  </ol>
</nav>

<style>
  .rail { width: 100%; }
  ol {
    display: flex;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
    overflow-x: auto;
  }
  li { flex: 1 0 auto; }
  .step {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 40px;
    padding: 0 10px;
    border: 1px solid transparent;
    border-radius: var(--radius-button);
    background: none;
    color: var(--stone);
    font-size: 14px;
    cursor: pointer;
    white-space: nowrap;
  }
  .step:hover:not(:disabled) { border-color: var(--line); color: var(--ink); }
  .step.current { border-color: var(--accent); color: var(--ink); background: var(--tint); }
  .step:disabled { cursor: default; opacity: 0.5; }
  .mark {
    display: inline-grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 1px solid var(--line);
    font-size: 12px;
    flex: none;
  }
  .current .mark { background: var(--accent); border-color: var(--accent); color: var(--paper); }
</style>
```
`web/src/lib/components/jpeg/CellNumbers.svelte`:

```svelte
<script lang="ts">
  // 64 numbers printed over an 8 × 8 panel the viz draws, one per cell, on the
  // same cell geometry (`layout.cells`). Hidden when the cells are too small
  // to hold a number legibly.
  import { cells, type Rect } from '../../jpeg/layout';

  interface Props {
    rect: Rect;
    values: readonly number[];
    /** Digits after the point. */
    digits?: number;
    /** Text colour: dark on light cells, light on dark ones. */
    shade?: (v: number) => 'dark' | 'light';
  }

  let { rect, values, digits = 0, shade = () => 'light' }: Props = $props();

  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const boxes = $derived(cells(rect, dpr));
  /** Below this cell width the numbers would overlap. */
  const MIN_CELL = 26;
  const show = $derived(boxes.length > 0 && boxes[0].w >= MIN_CELL);
  const fontPx = $derived(Math.max(9, Math.min(14, (boxes[0]?.w ?? 0) * 0.3)));
  const fmt = (v: number) => {
    const s = v.toFixed(digits);
    return s === '-0' || s === '-0.0' ? s.slice(1) : s;
  };
</script>

{#if show}
  {#each boxes as b, i}
    <span
      class="num mono {shade(values[i] ?? 0)}"
      style:left="{b.x}px"
      style:top="{b.y}px"
      style:width="{b.w}px"
      style:height="{b.h}px"
      style:font-size="{fontPx}px"
    >{fmt(values[i] ?? 0)}</span>
  {/each}
{/if}

<style>
  .num {
    position: absolute;
    display: grid;
    place-items: center;
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }
  .light { color: rgba(255, 255, 255, 0.9); text-shadow: 0 0 2px rgba(0, 0, 0, 0.6); }
  .dark { color: rgba(0, 0, 0, 0.8); text-shadow: 0 0 2px rgba(255, 255, 255, 0.5); }
</style>
```
`web/src/lib/components/jpeg/DctCharts.svelte`:

```svelte
<script lang="ts">
  // The DCT stage's two charts, drawn in the room the layout leaves beside the
  // rebuild panel: how fast the block's energy is captured in zigzag order
  // (with the k slider's position), and "why cosines?" — the block's busiest row or column
  // extended the way the DFT assumes (repeated: a jump at every seam) and the
  // way the DCT assumes (mirrored: smooth), with how many terms each needs for
  // 95% of the row's energy. The transforms come from the Rust kit.
  import { onMount } from 'svelte';
  import { loadVizCore, type VizCore } from '../../wasm/loader';
  import type { Rect } from '../../jpeg/layout';
  import { busiestLine, cumulativeEnergy, mirrored, periodic, termsFor } from '../../jpeg/math';

  interface Props {
    rect: Rect;
    /** The selected block's DCT and shifted samples, row-major. */
    dct: readonly number[];
    shifted: readonly number[];
    k: number;
  }

  let { rect, dct, shifted, k }: Props = $props();

  let kit = $state<VizCore | null>(null);
  onMount(() => {
    let alive = true;
    void loadVizCore().then((v) => {
      if (alive) kit = v;
    });
    return () => {
      alive = false;
    };
  });

  const order = $derived(kit ? Array.from(kit.jpeg_zigzag_order()) : []);
  const energy = $derived(order.length === 64 ? cumulativeEnergy(dct, order) : []);
  const lineInfo = $derived(busiestLine(shifted));
  const row = $derived(lineInfo.values);
  const dctTerms = $derived.by(() => {
    if (!kit) return 0;
    return termsFor(Array.from(kit.jpeg_dct_1d(new Float32Array(row))).map((c) => c * c), 0.95);
  });
  const dftTerms = $derived.by(() => {
    if (!kit) return 0;
    const z = Array.from(kit.jpeg_dft_1d(new Float32Array(row)));
    const e: number[] = [];
    for (let i = 0; i < z.length; i += 2) e.push(z[i] * z[i] + z[i + 1] * z[i + 1]);
    return termsFor(e, 0.95);
  });

  const half = $derived(Math.max(0, (rect.h - 16) / 2));
  const W = $derived(Math.max(0, rect.w));

  /** Polyline points for `ys` (in `[lo, hi]`) across a `w × h` box. */
  function line(ys: readonly number[], w: number, h: number, lo: number, hi: number): string {
    const span = hi - lo || 1;
    return ys
      .map((y, i) => `${((i / Math.max(1, ys.length - 1)) * w).toFixed(1)},${(h - ((y - lo) / span) * h).toFixed(1)}`)
      .join(' ');
  }
  const lo = $derived(Math.min(...row, 0) - 8);
  const hi = $derived(Math.max(...row, 0) + 8);
</script>

{#if rect.w > 80 && rect.h > 120}
  <div class="charts" style:left="{rect.x}px" style:top="{rect.y}px" style:width="{rect.w}px" style:height="{rect.h}px">
    <figure>
      <figcaption>Energy captured, zigzag order — {energy.length ? Math.round((energy[Math.max(0, k - 1)] ?? 0) * 100) : 0}% at k = {k}</figcaption>
      <svg width={W} height={half - 20} aria-hidden="true">
        <polyline class="curve" points={line(energy, W, half - 24, 0, 1)} />
        {#if k > 0}
          <line class="k" x1={((k - 1) / 63) * W} x2={((k - 1) / 63) * W} y1="0" y2={half - 24} />
        {/if}
      </svg>
    </figure>
    <figure>
      <figcaption>Why cosines? {lineInfo.axis === 'row' ? 'Row' : 'Column'} {lineInfo.index + 1}: repeated (DFT) needs {dftTerms} terms, mirrored (DCT) {dctTerms}, for 95%</figcaption>
      <svg width={W} height={half - 20} aria-hidden="true">
        <polyline class="dft" points={line(periodic(row, 3), W, (half - 24) / 2 - 4, lo, hi)} />
        <g transform="translate(0 {(half - 24) / 2 + 4})">
          <polyline class="dct" points={line(mirrored(row, 3), W, (half - 24) / 2 - 4, lo, hi)} />
        </g>
      </svg>
    </figure>
  </div>
{/if}

<style>
  .charts { position: absolute; display: grid; grid-template-rows: 1fr 1fr; gap: 16px; color: rgba(255, 255, 255, 0.72); }
  figure { margin: 0; }
  figcaption { font-size: 12px; margin-bottom: 6px; }
  svg { display: block; overflow: visible; }
  polyline { fill: none; stroke-width: 1.5; }
  .curve { stroke: #e27a52; }
  .k { stroke: rgba(255, 255, 255, 0.5); stroke-dasharray: 3 3; }
  .dft { stroke: #6ea0f0; }
  .dct { stroke: #e27a52; }
</style>
```
`web/src/lib/components/labs/JpegLab.svelte`:

```svelte
<script lang="ts">
  // The JPEG lab: one image followed through the compression pipeline, one
  // stage at a time. The engine encodes the image (Rust `jpeg` crate) and its
  // clock walks the scan MCU by MCU; this page owns the settings, the stage
  // rail and the layout. Settings re-encode through a rule-config push (which
  // rewinds the engine), after which the page puts the scan back where it was.
  // The selected block is view state and moves through a rule action.
  import { onDestroy, untrack } from 'svelte';
  import LabShell from '../LabShell.svelte';
  import Icon from '../Icon.svelte';
  import Tex from '../Tex.svelte';
  import StageRail from '../jpeg/StageRail.svelte';
  import CellNumbers from '../jpeg/CellNumbers.svelte';
  import DctCharts from '../jpeg/DctCharts.svelte';
  import type { LabApi } from '../labApi.svelte';
  import { cmd } from '../../playback/commands';
  import { route, replaceQuery } from '../../router.svelte';
  import { STAGES, stepStage, type StageId } from '../../jpeg/stages';
  import {
    buildParams,
    clampQuality,
    mcuCount,
    parseParams,
    type HuffmanId,
    type ImageId,
    type SubsamplingId,
  } from '../../jpeg/params';
  import { IMAGES, decodeUpload, loadBuiltin, type RgbaImage } from '../../jpeg/images';
  import { blockAt, cellAt, jpegLayout, toDevicePanels, type Panel, type StageLayout } from '../../jpeg/layout';
  import { readSummary, readoutOf, type JpegSummary } from '../../jpeg/summary';
  import { NOTICE, stageTex } from '../../jpeg/formulas';

  /** MCUs scanned per second by default: the 256² gradient (256 MCUs) scans in four seconds. */
  const DEFAULT_SPEED = 64;

  const linked = parseParams(route.query);
  let imageId = $state<ImageId | 'upload'>(linked.img);
  let quality = $state(linked.quality);
  let subsampling = $state<SubsamplingId>(linked.subsampling);
  let huffman = $state<HuffmanId>(linked.huffman);
  let stage = $state<StageId>(linked.stage);
  /** The block every stage follows, in luma block coordinates, and which plane to show it from. */
  let anchor = $state<[number, number] | null>(linked.block ?? null);
  let component = $state(0);
  /** Stage controls. */
  let cubeMix = $state(0);
  let dctK = $state(64);
  let hover = $state<[number, number] | null>(null);
  let showShifted = $state(true);

  let image = $state<RgbaImage | null>(null);
  let uploadError = $state<string | null>(null);
  let summary = $state<JpegSummary | null>(null);
  let layout = $state<StageLayout>({ image: { x: 0, y: 0, w: 0, h: 0 }, panels: [], extra: { x: 0, y: 0, w: 0, h: 0 } });
  let api = $state<LabApi | null>(null);
  let appliedQuery = route.query;
  let overlayEl: HTMLDivElement | null = null;
  let fileInput: HTMLInputElement | null = null;
  let ro: ResizeObserver | null = null;
  /** True until the first encode has started playing. */
  let first = true;

  const stageInfo = $derived(STAGES.find((s) => s.id === stage)!);
  const readout = $derived(summary ? readoutOf(summary) : null);
  const panel = (kind: Panel['kind']) => layout.panels.find((p) => p.kind === kind)?.rect;

  function currentQuery(): string {
    return buildParams({
      img: imageId === 'upload' ? 'gradient' : imageId,
      quality,
      subsampling,
      huffman,
      stage,
      block: anchor ?? undefined,
    });
  }

  function syncUrl() {
    const q = currentQuery();
    appliedQuery = q;
    replaceQuery(q);
  }

  // A pasted link or back/forward while on this page.
  $effect(() => {
    const q = route.query;
    untrack(() => {
      if (q === appliedQuery) return;
      appliedQuery = q;
      const p = parseParams(q);
      stage = p.stage;
      anchor = p.block ?? null;
      const encodeChanged = p.quality !== quality || p.subsampling !== subsampling || p.huffman !== huffman;
      quality = p.quality;
      subsampling = p.subsampling;
      huffman = p.huffman;
      if (p.img !== imageId) void chooseImage(p.img);
      else if (encodeChanged) encode();
      else selectAnchor();
      pushLayout();
    });
  });

  // The shell replaces `snapshot` every frame: re-read the summary off that clock.
  $effect(() => {
    const a = api;
    if (!a) return;
    void a.snapshot;
    summary = readSummary(a.readSummary());
  });

  /** Send the selection to the engine (the anchor scaled into the chosen plane's block grid). */
  function selectAnchor() {
    if (!api || !anchor) return;
    const [fh, fv] = component === 0 ? [1, 1] : subsampling === '444' ? [1, 1] : subsampling === '422' ? [2, 1] : [2, 2];
    api.ruleAction({ kind: 'select_block', component, bx: Math.floor(anchor[0] / fh), by: Math.floor(anchor[1] / fv) });
    summary = readSummary(api.readSummary());
  }

  /**
   * Re-encode with the current settings. The push rewinds the engine to 0,
   * paused; put the scan back at the same share of the image and resume if it
   * was playing (the very first encode starts playing from 0).
   */
  function encode() {
    const a = api;
    const img = image;
    if (!a?.engine || !img) return;
    const snap = a.snapshot;
    const share = snap.max_iterations > 0 ? snap.iteration / snap.max_iterations : 0;
    const wasPlaying = snap.playing;
    const max = mcuCount(img.w, img.h, subsampling);
    a.setRuleConfigWithImage(
      { image_id: imageId, quality, subsampling, huffman, max_iterations: max },
      img.w,
      img.h,
      img.rgba,
    );
    if (first) {
      first = false;
      a.dispatch(cmd.play());
    } else {
      const at = Math.round(share * max);
      if (at > 0) a.dispatch(cmd.jumpTo(at));
      if (wasPlaying) a.dispatch(cmd.play());
    }
    selectAnchor();
    summary = readSummary(a.readSummary());
    syncUrl();
  }

  async function chooseImage(id: ImageId) {
    uploadError = null;
    imageId = id;
    image = await loadBuiltin(id);
    anchor = null;
    first = true;
    encode();
    pushLayout();
  }

  async function onUpload(file: File | null | undefined) {
    if (!file) return;
    try {
      const img = await decodeUpload(file);
      uploadError = null;
      image = img;
      imageId = 'upload';
      anchor = null;
      first = true;
      encode();
      pushLayout();
    } catch (err) {
      // Keep the current image; say why.
      uploadError = err instanceof Error ? err.message : 'That file could not be read.';
    }
  }

  function onQuality(e: Event) {
    quality = clampQuality((e.target as HTMLInputElement).value);
    encode();
  }

  function setSubsampling(s: SubsamplingId) {
    if (s === subsampling) return;
    subsampling = s;
    encode();
  }

  function setHuffman(h: HuffmanId) {
    if (h === huffman) return;
    huffman = h;
    encode();
  }

  function setStage(s: StageId) {
    if (s === stage) return;
    stage = s;
    hover = null;
    api?.patchVizConfig({ hover: null });
    pushLayout();
    syncUrl();
  }

  function setComponent(c: number) {
    component = c;
    if (!anchor && summary?.selected) anchor = [summary.selected.bx, summary.selected.by];
    selectAnchor();
  }

  /** A click on the image picks the luma block under the pointer. */
  function onImageClick(e: MouseEvent) {
    if (!image) return;
    const box = (e.currentTarget as HTMLElement).parentElement!.getBoundingClientRect();
    const b = blockAt(e.clientX - box.left, e.clientY - box.top, layout.image, image.w, image.h);
    if (!b) return;
    anchor = b;
    selectAnchor();
    pushLayout();
    syncUrl();
  }

  /** Pointer over the atlas or the coefficients: outline that pattern in both. */
  function onCellHover(e: PointerEvent, rect: { x: number; y: number; w: number; h: number }) {
    const box = (e.currentTarget as HTMLElement).parentElement!.getBoundingClientRect();
    const uv = cellAt(e.clientX - box.left, e.clientY - box.top, rect);
    if (uv?.[0] === hover?.[0] && uv?.[1] === hover?.[1]) return;
    hover = uv;
    api?.patchVizConfig({ hover: uv });
  }

  function onCubeMix(e: Event) {
    cubeMix = Number((e.target as HTMLInputElement).value);
    api?.patchVizConfig({ cube_mix: cubeMix });
  }

  function onK(e: Event) {
    dctK = Number((e.target as HTMLInputElement).value);
    api?.patchVizConfig({ dct_k: dctK });
  }

  function saveJpeg() {
    const bytes = api?.engine?.rule_bytes();
    if (!bytes) return;
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `jpeg-lab-q${quality}-${subsampling}.jpg`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** The left and right arrow keys step through the ready stages, unless a form control has the keys. */
  function onKey(e: KeyboardEvent) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const t = e.target;
    if (t instanceof Element && t.closest('input, select, textarea, [contenteditable="true"], [contenteditable=""]')) return;
    setStage(stepStage(stage, e.key === 'ArrowRight' ? 1 : -1));
  }

  /** Lay the stage out from the canvas's CSS size and hand the viz its panels in device pixels. */
  function pushLayout() {
    const canvas = overlayEl?.closest('.stage')?.querySelector('canvas');
    if (!api?.engine || !canvas || !image) return;
    const dpr = window.devicePixelRatio || 1;
    const sel = summary?.selected;
    const block = anchor ?? (sel && sel.component === 0 ? ([sel.bx, sel.by] as [number, number]) : undefined);
    layout = jpegLayout(stage, canvas.clientWidth, canvas.clientHeight, image.w, image.h, block);
    api.patchVizConfig({ panels: toDevicePanels(layout.panels, dpr), cube_mix: cubeMix, dct_k: dctK, hover });
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    void onUpload(e.dataTransfer?.files?.[0]);
  }
  const onDragOver = (e: DragEvent) => e.preventDefault();

  async function onReady(a: LabApi) {
    api = a;
    a.dispatch(cmd.setSpeed(DEFAULT_SPEED));
    const stageEl = overlayEl?.closest('.stage') as HTMLElement | null;
    stageEl?.addEventListener('dragover', onDragOver);
    stageEl?.addEventListener('drop', onDrop);
    if (typeof ResizeObserver !== 'undefined' && overlayEl) {
      ro = new ResizeObserver(() => pushLayout());
      ro.observe(overlayEl);
    }
    window.addEventListener('resize', pushLayout);
    window.addEventListener('keydown', onKey);
    image = await loadBuiltin(imageId === 'upload' ? 'gradient' : imageId);
    encode();
    pushLayout();
    if (route.query !== currentQuery()) syncUrl();
  }

  onDestroy(() => {
    ro?.disconnect();
    ro = null;
    const stageEl = overlayEl?.closest('.stage') as HTMLElement | null;
    stageEl?.removeEventListener('dragover', onDragOver);
    stageEl?.removeEventListener('drop', onDrop);
    window.removeEventListener('resize', pushLayout);
    window.removeEventListener('keydown', onKey);
  });

  const sel = $derived(summary?.selected ?? null);
  /** Dark numbers on light cells. */
  const sampleShade = (v: number) => (v > 150 ? 'dark' : 'light') as 'dark' | 'light';
</script>

<LabShell
  labId="jpeg"
  title="JPEG Compression"
  thesis="Follow one picture, and one 8 × 8 block of it, from pixels to bits and back."
  zoom={false}
  {onReady}
>
  {#snippet controls()}
    <div class="group" role="radiogroup" aria-labelledby="jpeg-image-name">
      <span class="name" id="jpeg-image-name">Image</span>
      {#each IMAGES as im (im.id)}
        <label class="btn pill" title={im.title}>
          <input type="radio" name="jpeg-image" value={im.id} checked={imageId === im.id} onchange={() => void chooseImage(im.id)} />{im.label}
        </label>
      {/each}
      <button class="btn" onclick={() => fileInput?.click()} title="Use your own picture (scaled to fit 512 px); or drop one on the stage">
        <Icon name="upload" />Upload
      </button>
      <input
        class="file"
        type="file"
        accept="image/*"
        bind:this={fileInput}
        onchange={(e) => void onUpload((e.currentTarget as HTMLInputElement).files?.[0])}
      />
    </div>
    <label class="field quality">
      Quality
      <input type="range" min="1" max="100" step="1" value={quality} oninput={onQuality} aria-label="Quality" />
      <span class="mono value">{quality}</span>
    </label>
    <div class="group" role="radiogroup" aria-labelledby="jpeg-sub-name">
      <span class="name" id="jpeg-sub-name">Chroma</span>
      {#each [['444', '4:4:4'], ['422', '4:2:2'], ['420', '4:2:0']] as [id, label] (id)}
        <label class="btn pill">
          <input type="radio" name="jpeg-sub" value={id} checked={subsampling === id} onchange={() => setSubsampling(id as SubsamplingId)} />{label}
        </label>
      {/each}
    </div>
    <div class="group" role="radiogroup" aria-labelledby="jpeg-huff-name">
      <span class="name" id="jpeg-huff-name">Huffman</span>
      <label class="btn pill" title="Code lengths built from this image's own symbol counts">
        <input type="radio" name="jpeg-huff" value="optimized" checked={huffman === 'optimized'} onchange={() => setHuffman('optimized')} />Optimized
      </label>
      <label class="btn pill" title="The example tables from the JPEG standard">
        <input type="radio" name="jpeg-huff" value="standard" checked={huffman === 'standard'} onchange={() => setHuffman('standard')} />Standard
      </label>
    </div>
    <button class="btn" onclick={saveJpeg} disabled={!summary?.bytes}><Icon name="download" />Save .jpg</button>
    <div class="row">
      <StageRail current={stage} onselect={setStage} />
    </div>
    {#if readout}
      <div class="row stats" aria-live="off">
        <span class="stat"><span class="mono">{readout.size}</span> of {readout.of}</span>
        <span class="stat"><span class="mono">{readout.ratio}</span></span>
        <span class="stat"><span class="mono">{readout.bpp}</span> bits / pixel</span>
        <span class="stat">PSNR <span class="mono">{readout.psnr}</span></span>
      </div>
    {/if}
  {/snippet}

  {#snippet overlay()}
    <div class="marks" bind:this={overlayEl}>
      {#each layout.panels as p (p.kind)}
        <span class="caption" style:left="{p.rect.x}px" style:top="{p.rect.y - 20}px" style:max-width="{Math.max(p.rect.w, 120)}px">{p.label}</span>
      {/each}
      {#if layout.image.w > 0}
        <button
          class="hit"
          aria-label="Pick a block"
          style:left="{layout.image.x}px"
          style:top="{layout.image.y}px"
          style:width="{layout.image.w}px"
          style:height="{layout.image.h}px"
          onclick={onImageClick}
        ></button>
      {/if}

      {#if stage === 'color' && panel('cube')}
        {@const r = panel('cube')!}
        <label class="ctl" style:left="{r.x}px" style:top="{r.y + r.h - 34}px" style:width="{r.w}px">
          <span>RGB axes</span>
          <input type="range" min="0" max="1" step="0.01" value={cubeMix} oninput={onCubeMix} aria-label="RGB axes to YCbCr axes" />
          <span>YCbCr axes</span>
        </label>
      {/if}

      {#if stage === 'blocks' && panel('block') && sel}
        {@const r = panel('block')!}
        <CellNumbers rect={r} values={showShifted ? sel.shifted : sel.pixels} shade={(v) => sampleShade(showShifted ? v + 128 : v)} />
        <div class="ctl tools" style:left="{r.x}px" style:top="{r.y + r.h + 10}px">
          {#each ['Y', 'Cb', 'Cr'] as name, c (name)}
            <button class="chip" aria-pressed={component === c} onclick={() => setComponent(c)}>{name}</button>
          {/each}
          <button class="chip" aria-pressed={showShifted} onclick={() => (showShifted = !showShifted)} title="Centre the samples on zero">− 128</button>
        </div>
      {/if}

      {#if stage === 'dct' && sel}
        {#each ['atlas', 'coeffs'] as kind (kind)}
          {@const r = panel(kind as Panel['kind'])}
          {#if r}
            <div
              class="hover-area"
              role="presentation"
              style:left="{r.x}px"
              style:top="{r.y}px"
              style:width="{r.w}px"
              style:height="{r.h}px"
              onpointermove={(e) => onCellHover(e, r)}
            ></div>
          {/if}
        {/each}
        {#if panel('coeffs')}
          <CellNumbers rect={panel('coeffs')!} values={sel.dct} />
        {/if}
        {#if panel('rebuild')}
          {@const r = panel('rebuild')!}
          <label class="ctl" style:left="{r.x}px" style:top="{r.y + r.h + 8}px" style:width="{Math.max(r.w, 200)}px">
            <span>k = <span class="mono">{dctK}</span></span>
            <input type="range" min="0" max="64" step="1" value={dctK} oninput={onK} aria-label="Patterns kept" />
          </label>
        {/if}
        <DctCharts rect={layout.extra} dct={sel.dct} shifted={sel.shifted} k={dctK} />
      {/if}

      {#if uploadError}
        <p class="error" role="alert">{uploadError}</p>
      {/if}
      {#if summary?.error}
        <p class="error" role="alert">This image could not be encoded: {summary.error}</p>
      {/if}
    </div>
  {/snippet}

  {#snippet story()}
    <section class="stage-card" aria-live="polite">
      <h2><span class="mark">{stageInfo.mark}</span> {stageInfo.title}</h2>
      <p class="sub">{stageInfo.subtitle}</p>
      {#each stageTex(stage, summary, hover) as tex}
        <Tex {tex} />
      {/each}
      <p class="tip">{NOTICE[stage]}</p>
    </section>

    <h2>How it works</h2>
    <p>
      A JPEG file is the picture written as a recipe, not as pixels. The encoder turns colours into
      brightness and two colour differences, keeps less of the colour, cuts each plane into 8 × 8 blocks,
      rewrites every block as a weighted sum of 64 cosine patterns, rounds those weights coarsely, and
      packs what is left into as few bits as it can.
    </p>
    <p class="tip">
      Play runs the scan block by block: the image fills in as it would arrive over a slow connection.
      Click anywhere on the image to follow that block through every stage, and use the left and right arrow keys to move
      between stages.
    </p>
  {/snippet}
</LabShell>

<style>
  .file { display: none; }
  .quality input { width: 140px; }
  .quality .value { width: 3ch; text-align: right; color: var(--ink); }
  .name { color: var(--stone); font-size: 14px; }
  /* Radio inputs drawn as pills, as in the Notes lab. */
  .pill input { position: absolute; opacity: 0; pointer-events: none; }
  .pill:has(input:checked) { border-color: var(--accent); background: var(--tint); }
  .pill:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
  /* The rail and the readout each take a whole row, after the shell's speed slider. */
  .row { flex-basis: 100%; min-width: 0; max-width: 100%; order: 1; }
  .stats { display: flex; flex-wrap: wrap; gap: 6px 22px; }

  .marks { position: absolute; inset: 0; }
  .caption {
    position: absolute;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.72);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hit { position: absolute; padding: 0; border: 0; background: none; cursor: crosshair; pointer-events: auto; }
  .hover-area { position: absolute; pointer-events: auto; }
  .ctl {
    position: absolute;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.8);
    pointer-events: auto;
  }
  .ctl input { flex: 1; accent-color: var(--accent); }
  .tools { gap: 6px; }
  .chip {
    height: 28px;
    padding: 0 10px;
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.35);
    color: rgba(255, 255, 255, 0.85);
    font-size: 12px;
    cursor: pointer;
  }
  .chip[aria-pressed='true'] { border-color: var(--accent); color: #fff; }
  .error {
    position: absolute;
    left: 16px;
    bottom: 8px;
    margin: 0;
    padding: 6px 10px;
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.6);
    color: #ffb4a0;
    font-size: 13px;
    pointer-events: auto;
  }
  .stage-card { margin-bottom: 36px; }
  .stage-card h2 { display: flex; align-items: center; gap: 10px; }
  .stage-card .mark {
    display: inline-grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--paper);
    font-size: 14px;
  }
  .sub { color: var(--stone); margin-top: -4px; }
</style>
```

- [ ] **Step 5: Run the tests.**
  - `cd web && npx vitest run src/lib/components/__tests__/JpegLab.test.ts` → PASS, 10 tests.
  - `npx vitest run` → 465 passed. This includes `no-emoji.test.ts`: the page's copy uses words, not arrow glyphs.
  - `npx svelte-check --tsconfig ./tsconfig.json` → 0 errors.

- [ ] **Step 6: Commit.**

```bash
git add web/src
git commit -m "feat(web): the JPEG lab page — rail, settings, readout and stages 1–4"
```

---

## Task 6: Spec amendment, docs, full validation and the browser check

**Files:**
- Modify: `docs/superpowers/specs/2026-10-15-jpeg-lab-design.md`, `docs/testing.md`, `README.md` (project layout only)

- [ ] **Step 1: Amend the spec.** Under the spec's existing `## Amendment (Plan 1, 2026-10-15)` section, add `## Amendment (Plan 2, 2026-10-16)` listing the nine amendments in this plan's Global Constraints, one line each, worded as decisions. Then update the body to match:
  - **Part 2 "The `jpeg` lab":** replace the `set_quality` / `set_subsampling` / `set_huffman` / `set_tables` actions with "settings arrive in rule-config pushes; `select_block` is the only action".
  - **Part 2 viz config:** replace `image_rect` / `focus_rect` / `aux_rect` / `stage` with the `panels` list and `crop`.
  - **Part 3 built-in images:** move "Photo" to Plan 4.
  - **Delivery item 4:** add "nav link, the photo".

- [ ] **Step 2: Update the docs.**
  - **`README.md` → Project layout:**
    - Under `rules/` add `│   │   │   ├── jpeg.rs               # JPEG lab rule: one encode per config, a scan cursor, the selected block`.
    - Under `visualizations/` add `│   │       ├── jpeg.rs               # JPEG lab viz: panels the page lays out (image, planes, cube, cells)`.
    - Under `render/` add `│   │   │   ├── texture_quad.rs       # RGBA texture drawn into a pixel rect`.
    - Change the `tests/` line to name `jpeg_lab.rs` too.
  - **`docs/testing.md`:**
    - Set the Rust counts to what `cargo test --all-features` prints (jpeg 85 and viz-core 292 → 377).
    - Set the wasm count to 45 (adds the 5 JPEG lab engine tests).
    - Add a sentence to the web paragraph: the JPEG lab's stages, link, summary, layout, maths and formulas modules, plus its component test against the fake engine.

- [ ] **Step 3: Full validation.**

```bash
cargo fmt --all --check
cargo clippy --all-targets --all-features 2>&1 | grep -A4 '^warning: [a-z]' | grep -- '-->' | grep -v sierpinski   # expect no output
cargo test --all-features 2>&1 | grep 'test result: ok. [1-9]'   # 85 and 292
wasm-pack test --chrome --headless --chromedriver=/private/tmp/claude-501/-Users-bsmall-dev-math-visualizer/9f5e6f00-2b13-4952-8009-b31a54f0fe14/scratchpad/chromedriver-155/chromedriver-mac-arm64/chromedriver crates/viz-core   # jpeg_kit 6, jpeg_lab 5, jpeg_oracle 1, wasm 33
wasm-pack build crates/viz-core --target web --out-dir pkg
cd web && npx vitest run && npx svelte-check --tsconfig ./tsconfig.json   # 465 passed, 0 errors
```

- [ ] **Step 4: Commit the docs.** `git add docs README.md && git commit -m "docs: JPEG lab stages 1–4 — spec amendment, layout and test counts"`

- [ ] **Step 5 (controller): Look at it.**
  - Start the dev server (`.claude/launch.json` `web`; Vite may serve on 5174 when 5173 is taken, so read the port from `preview_logs`).
  - Capture `#/jpeg?stage=<s>&img=<i>` for every stage × {gradient, text, bars} with `node ~/.claude/skills/ui-critic/scripts/capture.mjs <url> <dir>` (1440 + 375, light + dark).
  - Check in the Browser pane that dragging Quality while playing keeps the scan position and keeps playing (Review Focus 1).
  - Check that an upload (any PNG) re-encodes, and that a non-image file shows the inline error.
  - Fix anything found through the normal review loop.
