# JPEG lab: the stage follows the scan — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the JPEG lab, the scan position and the selected block become one "current block" that Play, Back, Forward, clicks, keys and links all move, with every panel following it; the scan never autoplays and runs slower; transport buttons that would do nothing are disabled and say why.

**Architecture:** The Rust rule moves the selection inside `advance_to` (the one entry point for every scan move), so following costs no JS round trip and no viz-config push per step (a viz-config push re-runs `init` and zeroes the next frame's dt). The viz computes the subsample stage's zoom window from the selection itself and draws the new current-block marks. On the web side the shell gains a generic disabled state, and the lab only mirrors the rule's selection into its `anchor` and stops autoplaying.

**Tech Stack:** Rust (viz-core, WebGL2 via web-sys, wasm-bindgen), Svelte 5 runes, TypeScript, Vitest + Testing Library (jsdom, a fake engine in `web/src/lib/test/fakeViz.ts`).

**Spec:** `docs/superpowers/specs/2026-10-19-jpeg-lab-scan-follows-design.md`

## Global Constraints

- Copy rules: British spelling, sentence case, no emoji or arrow glyphs in `.svelte` files.
- No native `title` on elements in `web/src/lib/components/jpeg/*` or `JpegLab.svelte` (coverage test); the JPEG lab's explanations are its explain cards.
- Disabled transport buttons use `aria-disabled="true"` plus a guarded click handler, never the `disabled` attribute (it swallows hover and focus, so no card or title could show).
- Never push viz config per scan step (`patchVizConfig` / `update_viz_config` re-runs `init` and zeroes the next frame's dt).
- Validation: `cargo fmt --all --check`, `cargo clippy --all-targets --all-features`, `cargo test --all-features`; from `web/`: `npx vitest run`, `npx svelte-check --tsconfig ./tsconfig.json`.
- Track split: Tasks 1–3 touch only `crates/`; Tasks 4–7 touch only `web/` and `docs/`. Implementers never run git; the controller commits by path.

## Review Focus

1. A picture whose size is not a whole number of MCUs (cartoon 320 × 240 at 4:2:0 has 15 rows of 16 px; honest-work is 203 px tall): following the scan into the padded last row or column must stay on the component's block grid and never select a block that does not exist. (Task 1 test `the_follow_stays_on_the_grid_of_a_padded_picture`.)
2. The scan at full speed (360 steps a second): the panels may skip blocks, but nothing may push viz config or rewrite the link per step. (Task 5 test `following the scan while playing pushes no viz config and writes no link`.)
3. A settings change mid-scan with the reader's own odd block picked (subsampling 4:2:0 to 4:4:4 changes the MCU grid): the scan must land on that block's step in the new grid, not "the same share". (Task 5 test `a settings change returns the scan to the current block's step`.)
4. Clicking a block behind the scan while it plays: the scan pauses and rewinds there (later blocks dim again), and the exact clicked block stays selected, not its MCU's top-left. (Task 1 test `a_block_already_in_the_current_mcu_is_kept`; Task 5 test `a click on the picture pauses the scan and jumps it there`.)
5. A shared link whose `b=` is off the grid: the block is clamped as today, and the scan opens paused at the clamped block's step. (Task 5 test `a shared block off the grid opens the scan at the clamped block's step`.)

---

### Task 1: The rule's selection follows the scan

**Files:**
- Modify: `crates/viz-core/src/rules/jpeg.rs` (`advance_to`, around :444-448; new helper beside it; tests in `mod tests`)

**Interfaces:**
- Produces: after `JpegRule.advance_to(state, cfg, seed, n)` with `n ≥ 1` and an encode present, `state.selection` lies in MCU `n - 1` (clamped `n`). If the selection was already one of MCU `n - 1`'s blocks it is unchanged; otherwise it becomes that MCU's first block (coding order, `trace.layout.units[n-1]`) in the selection's own component. `n == 0`, or a failed encode, leaves the selection alone. Nothing else changes (`summary()`, `apply_action` as today).

- [ ] **Step 1: Write the failing tests** in `mod tests` (use the existing `cfg()` helper; build a small picture by setting `c.pixels = Some(Rgb8Image::new(w, h, rgba).unwrap())` as other tests in the file do, and set `c.subsampling` through the config the same way):

```rust
#[test]
fn advance_to_moves_the_selection_to_the_last_scanned_mcu() {
    // 256² gradient at 4:2:0: 16 MCUs across, luma grid 32 × 32, chroma 16 × 16.
    let c = cfg();
    let mut s = JpegRule.init(&c, 0);
    // Start far from MCU 4, so the encoder's default block cannot already be in it.
    let far = json!({"kind": "select_block", "component": 0, "bx": 31, "by": 31});
    JpegRule.apply_action(&mut s, &c, &far).unwrap();
    JpegRule.advance_to(&mut s, &c, 0, 5); // MCU 4 = (4, 0)
    assert_eq!(s.selection, Selection { component: 0, bx: 8, by: 0 });
    let cb = json!({"kind": "select_block", "component": 1, "bx": 0, "by": 0});
    JpegRule.apply_action(&mut s, &c, &cb).unwrap();
    JpegRule.advance_to(&mut s, &c, 0, 18); // MCU 17 = (1, 1)
    assert_eq!(s.selection, Selection { component: 1, bx: 1, by: 1 });
}

#[test]
fn a_block_already_in_the_current_mcu_is_kept() {
    let c = cfg();
    let mut s = JpegRule.init(&c, 0);
    let pick = json!({"kind": "select_block", "component": 0, "bx": 9, "by": 1}); // in MCU 4
    JpegRule.apply_action(&mut s, &c, &pick).unwrap();
    JpegRule.advance_to(&mut s, &c, 0, 5);
    assert_eq!(s.selection, Selection { component: 0, bx: 9, by: 1 });
    JpegRule.advance_to(&mut s, &c, 0, 6); // the scan moves on: MCU 5's first luma block
    assert_eq!(s.selection, Selection { component: 0, bx: 10, by: 0 });
}

#[test]
fn advance_to_zero_leaves_the_selection() {
    let c = cfg();
    let mut s = JpegRule.init(&c, 0);
    let pick = json!({"kind": "select_block", "component": 0, "bx": 9, "by": 1});
    JpegRule.apply_action(&mut s, &c, &pick).unwrap();
    JpegRule.advance_to(&mut s, &c, 0, 0);
    assert_eq!(s.selection, Selection { component: 0, bx: 9, by: 1 });
}

#[test]
fn the_follow_stays_on_the_grid_of_a_padded_picture() {
    // 24 × 10 at 4:2:0: 2 × 1 MCUs, the second one padded on the right and below.
    // (build c with 24 × 10 RGBA pixels; subsampling "420")
    let mut s = JpegRule.init(&c, 0);
    let first = json!({"kind": "select_block", "component": 0, "bx": 0, "by": 0});
    JpegRule.apply_action(&mut s, &c, &first).unwrap();
    JpegRule.advance_to(&mut s, &c, 0, 2);
    assert_eq!(s.selection, Selection { component: 0, bx: 2, by: 0 });
    let cr = json!({"kind": "select_block", "component": 2, "bx": 0, "by": 0});
    JpegRule.apply_action(&mut s, &c, &cr).unwrap();
    JpegRule.advance_to(&mut s, &c, 0, 2);
    assert_eq!(s.selection, Selection { component: 2, bx: 1, by: 0 });
    JpegRule.advance_to(&mut s, &c, 0, 99); // clamped to the last MCU
    assert_eq!(s.selection, Selection { component: 2, bx: 1, by: 0 });
}

#[test]
fn at_444_each_step_is_one_block() {
    // (c with subsampling "444"): 32 MCUs across.
    let mut s = JpegRule.init(&c, 0);
    let far = json!({"kind": "select_block", "component": 0, "bx": 31, "by": 31});
    JpegRule.apply_action(&mut s, &c, &far).unwrap();
    JpegRule.advance_to(&mut s, &c, 0, 3);
    assert_eq!(s.selection, Selection { component: 0, bx: 2, by: 0 });
}
```

Also update any existing test this behaviour breaks (for example one that selects a block, advances, then expects the old selection). Keep its intent; say which in the report.

- [ ] **Step 2: Run, expect FAIL** — `cargo test -p viz-core --all-features rules::jpeg` (the four new tests fail on the selection).

- [ ] **Step 3: Implement** `fn follow_scan(state: &mut JpegState)` in `rules/jpeg.rs`, called at the end of `advance_to`. A unit's block is raster-indexed in its component's grid: `bx = unit.block % grids[c].0`, `by = unit.block / grids[c].0`.

- [ ] **Step 4: Run, expect PASS** — the same command, then `cargo test --all-features` and `cargo clippy --all-targets --all-features`.

- [ ] **Step 5: Controller commits** `crates/viz-core/src/rules/jpeg.rs` — `feat(viz-core): the JPEG rule's selection follows the scan`.

---

### Task 2: The viz takes the zoom window from the selection, marks the current block, and drops the scan-front outline

**Files:**
- Modify: `crates/viz-core/src/visualizations/jpeg.rs` (`Panel` :45-55; `draw_image` front outline :734-745; panel loop :893-1035; tests in `mod tests`; module docs at the top listing panel fields)

**Interfaces:**
- Consumes: `state.selection` (Task 1 keeps it on the scan).
- Produces (JSON the web side sends): a panel may carry `"zoom": <f32 image pixels> | null` (`#[serde(default)] pub zoom: Option<f32>`). When set on a plane or coded panel it replaces `crop` with `zoom_window(luma_anchor(selection, subsampling), zoom, iw, ih)`.
- Produces (pure helpers, `pub` for tests):
  - `pub fn luma_anchor(sel: Selection, s: Subsampling) -> (usize, usize)` — component 0: `(bx, by)`; otherwise `(bx * fh, by * fv)` with `(fh, fv) = s.factors()`.
  - `pub fn zoom_window(anchor: (usize, usize), side: f32, iw: usize, ih: usize) -> [f32; 4]` — mirrors `zoomWindow` in `web/src/lib/jpeg/layout.ts:108-115` exactly: `side' = min(side, iw, ih)`, centre `(ax * 8 + 4, ay * 8 + 4)`, `x = clamp(round(cx - side'/2), 0, iw - side')`, same for y.
  - `pub fn map_rect_in_crop(sub: [f32; 4], panel: [f32; 4], crop: [f32; 4]) -> [f32; 4]` — `sub` (image pixels) clipped to `crop`, then scaled so `crop` fills `panel`. `map_rect(sub, panel, w, h)` equals `map_rect_in_crop(sub, panel, [0, 0, w, h])`.

- [ ] **Step 1: Write the failing tests**

```rust
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
    assert_eq!(zoom_window((21, 17), 32.0, 256, 256), [156.0, 124.0, 32.0, 32.0]);
    assert_eq!(zoom_window((0, 0), 32.0, 256, 256), [0.0, 0.0, 32.0, 32.0]);
    assert_eq!(zoom_window((31, 31), 32.0, 256, 256), [224.0, 224.0, 32.0, 32.0]);
    // Smaller than the window: the window shrinks to the picture's short side.
    assert_eq!(zoom_window((2, 1), 32.0, 40, 24), [8.0, 0.0, 24.0, 24.0]);
}

#[test]
fn map_rect_in_crop_scales_and_clips_to_the_crop() {
    let crop = [156.0, 124.0, 32.0, 32.0];
    assert_eq!(map_rect_in_crop([168.0, 136.0, 8.0, 8.0], [0.0, 0.0, 128.0, 128.0], crop), [48.0, 48.0, 32.0, 32.0]);
    assert_eq!(map_rect_in_crop([150.0, 120.0, 16.0, 16.0], [0.0, 0.0, 128.0, 128.0], crop), [0.0, 0.0, 40.0, 48.0]);
    let panel = [100.0, 50.0, 512.0, 512.0];
    assert_eq!(
        map_rect_in_crop([8.0, 16.0, 8.0, 8.0], panel, [0.0, 0.0, 256.0, 256.0]),
        map_rect([8.0, 16.0, 8.0, 8.0], panel, 256, 256)
    );
}

#[test]
fn a_panel_reads_zoom_from_json() {
    let p: Panel = serde_json::from_value(json!({"kind": "plane_cb", "rect": [0, 0, 10, 10], "zoom": 32})).unwrap();
    assert_eq!(p.zoom, Some(32.0));
    let q: Panel = serde_json::from_value(json!({"kind": "plane_cb", "rect": [0, 0, 10, 10]})).unwrap();
    assert_eq!(q.zoom, None);
}
```

- [ ] **Step 2: Run, expect FAIL** — `cargo test -p viz-core --all-features visualizations::jpeg` (helpers and `zoom` missing).

- [ ] **Step 3: Implement**
  - `Panel.zoom` and the three helpers.
  - In the plane/coded arm: crop = `zoom` window if set, else `crop`, else whole image. After drawing, outline the current block (`block_rect(sel, subsampling)`) with `map_rect_in_crop` into the panel, in `cfg.accent`.
  - `wipe` and `error` arms: outline the current block with `map_rect(block_rect(..), rect, iw, ih)` in `cfg.accent`.
  - `draw_image`: remove the scan-front outline (the `if n < t.layout.units.len()` block); keep the scanned/dimmed fill and the selection outline.
  - Update the module docs' panel list (`zoom`, the new outlines, no front outline).

- [ ] **Step 4: Run, expect PASS** — the same command, then `cargo test --all-features`, `cargo clippy --all-targets --all-features`, `cargo fmt --all --check`.

- [ ] **Step 5: Controller commits** `crates/viz-core/src/visualizations/jpeg.rs` — `feat(viz-core): JPEG viz zooms around the selection, outlines the current block on whole-picture panels, one outline on the scan`.

---

### Task 3: The colour cube lights up the current block

**Files:**
- Modify: `crates/viz-core/src/visualizations/jpeg.rs` (`build_cube` :461-494, `CubeCache` :510-516, `draw_cube` :800-835, the `"cube"` arm; tests)

**Interfaces:**
- Consumes: `block_rect`, `state.selection`, `cfg.dim` (the existing "Unscanned brightness", default 0.35).
- Produces (pure, `pub` for tests):
  - `pub fn block_pixels(img: &Rgb8Image, sel: Selection, s: Subsampling) -> Vec<[f32; 3]>` — the RGB of every image pixel inside `block_rect(sel, s)`, clipped to the image, row by row.
  - `pub fn dimmed(c: [f32; 4], dim: f32) -> [f32; 4]` — RGB × `dim.clamp(0, 1)`, alpha unchanged.

- [ ] **Step 1: Write the failing tests**

```rust
#[test]
fn block_pixels_cover_the_block_clipped_to_the_picture() {
    let img = builtin_image("gradient", 256, 256).unwrap(); // or the helper the file's tests use
    let luma = block_pixels(&img, Selection { component: 0, bx: 1, by: 1 }, Subsampling::S420);
    assert_eq!(luma.len(), 64);
    assert_eq!(luma[0], img.rgb_at(8, 8)); // use the image's pixel accessor
    let chroma = block_pixels(&img, Selection { component: 1, bx: 0, by: 0 }, Subsampling::S420);
    assert_eq!(chroma.len(), 256);
    let small = Rgb8Image::new(24, 10, vec![0; 24 * 10 * 4]).unwrap();
    assert_eq!(block_pixels(&small, Selection { component: 0, bx: 2, by: 1 }, Subsampling::S420).len(), 16);
}

#[test]
fn dimmed_scales_colour_not_alpha() {
    assert_eq!(dimmed([1.0, 0.5, 0.2, 0.9], 0.5), [0.5, 0.25, 0.1, 0.9]);
    assert_eq!(dimmed([1.0, 1.0, 1.0, 1.0], 2.0), [1.0, 1.0, 1.0, 1.0]);
}
```

(Match the real names of the image accessor and the built-in helper in this crate; the assertions stay.)

- [ ] **Step 2: Run, expect FAIL** — `cargo test -p viz-core --all-features visualizations::jpeg`.

- [ ] **Step 3: Implement**
  - The cached cloud is stored dimmed (`dimmed(color, cfg.dim)`); the cache key adds `dim`.
  - Each frame, `draw_cube` uploads the cloud followed by the current block's pixels as `PointInstance3D { position: cube_point(rgb, mix), color: [r, g, b, 1.0], radius_px: 3.5 }`, so they draw on top. Use a scratch `Vec` on `JpegViz`, not a fresh allocation per frame.

- [ ] **Step 4: Run, expect PASS** — the same command, then the full cargo trio.

- [ ] **Step 5: Controller commits** — `feat(viz-core): the JPEG colour cube lights up the current block`.

---

### Task 4: The shell's transport says when a button would do nothing

**Files:**
- Modify: `web/src/lib/components/LabShell.svelte` (Props :20-57; handlers :128-157; transport markup :239-249; styles)
- Modify: `web/src/lib/test/LabShellHost.svelte` (pass `firstStep`, `transportOff`)
- Test: `web/src/lib/components/__tests__/LabShell.test.ts`

**Interfaces:**
- Produces (props on `LabShell`):
  - `firstStep?: number` (default 0): the lab's start. Back and Reset are disabled at `iteration <= firstStep`. Reset dispatches `cmd.reset()` and then, when `firstStep > 0`, `cmd.jumpTo(firstStep)`.
  - `transportOff?: string | null` (default null): when set, Reset, Back, Play and Forward are all disabled and the string is the reason.
- Disabled rules:
  - Reset and Back: `transportOff || iteration <= firstStep`.
  - Play: `transportOff || (!playing && iteration >= max_iterations)`. Pause, while playing, is never disabled.
  - Forward: `transportOff || iteration >= max_iterations`.
- A disabled button has `aria-disabled="true"`, keeps its focus and hover, and its click does nothing (dispatches nothing).
- Native titles (only when `nativeTitles`): when disabled, the reason replaces the usual title. Exact copy: off → the `transportOff` string; at the start → `Already at the start.`; at the end → `At the end: Reset to run it again.` Play gets a title only when disabled.
- Style: `.btn[aria-disabled='true'] { opacity: 0.45; cursor: default; }`, matching `DecodeTools.svelte`'s chips.

- [ ] **Step 1: Write the failing tests** (set `snapshotFixture` fields before render and restore after, as the file's other tests do; the buttons are found by role and name):

```ts
it('disables Back and Reset at the start, and says why', async () => {
  snapshotFixture.iteration = 0;
  const { getByRole } = render(LabShellHost);
  await waitForEngine();
  for (const name of [/Reset/, /Back/]) {
    const b = getByRole('button', { name });
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(b.getAttribute('title')).toBe('Already at the start.');
  }
  dispatchSpy.mockClear();
  await fireEvent.click(getByRole('button', { name: /Back/ }));
  expect(dispatchSpy).not.toHaveBeenCalled();
});

it('disables Play and Forward at the end, and says why', async () => {
  snapshotFixture.iteration = 360; // max_iterations
  const { getByRole } = render(LabShellHost);
  await waitForEngine();
  for (const name of [/Play/, /Forward/]) {
    const b = getByRole('button', { name });
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(b.getAttribute('title')).toBe('At the end: Reset to run it again.');
  }
  dispatchSpy.mockClear();
  await fireEvent.click(getByRole('button', { name: /Play/ }));
  expect(dispatchSpy).not.toHaveBeenCalled();
});

it('keeps Pause available while playing', async () => {
  Object.assign(snapshotFixture, { iteration: 360, playing: true });
  const { getByRole } = render(LabShellHost);
  await waitForEngine();
  expect(getByRole('button', { name: /Pause/ }).getAttribute('aria-disabled')).toBeNull();
});

it("treats the lab's first step as the start, and Reset goes there", async () => {
  snapshotFixture.iteration = 1;
  const { getByRole } = render(LabShellHost, { firstStep: 1 });
  await waitForEngine();
  expect(getByRole('button', { name: /Back/ }).getAttribute('aria-disabled')).toBe('true');
  snapshotFixture.iteration = 2;
  // (let the shell's frame loop pick up the new snapshot, as other tests in the file do)
  expect(getByRole('button', { name: /Back/ }).getAttribute('aria-disabled')).toBeNull();
  dispatchSpy.mockClear();
  await fireEvent.click(getByRole('button', { name: /Reset/ }));
  expect(dispatchSpy.mock.calls.map((c) => c[0])).toEqual([{ kind: 'Reset' }, { kind: 'JumpTo', iteration: 1 }]);
});

it('turns the whole transport off with its reason', async () => {
  snapshotFixture.iteration = 10;
  const { getByRole } = render(LabShellHost, { transportOff: 'Pick a stage first.' });
  await waitForEngine();
  for (const name of [/Reset/, /Back/, /Play/, /Forward/]) {
    const b = getByRole('button', { name });
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(b.getAttribute('title')).toBe('Pick a stage first.');
  }
});

it('marks buttons disabled without native titles when the lab draws its own cards', async () => {
  snapshotFixture.iteration = 0;
  const { getByRole } = render(LabShellHost, { nativeTitles: false });
  await waitForEngine();
  const back = getByRole('button', { name: /Back/ });
  expect(back.getAttribute('aria-disabled')).toBe('true');
  expect(back.hasAttribute('title')).toBe(false);
});
```

(`waitForEngine` stands for however the file's existing tests wait for the shell's engine; reuse that, do not add a new mechanism.)

- [ ] **Step 2: Run, expect FAIL** — from `web/`: `npx vitest run src/lib/components/__tests__/LabShell.test.ts`.

- [ ] **Step 3: Implement** the props, the `$derived` disabled flags, the guards in `onReset` / `onStepBack` / `onTogglePlay` / `onStepForward`, the attributes and the style. Add the two props to `LabShellHost.svelte`.

- [ ] **Step 4: Run, expect PASS** — the same file, then `npx vitest run src/lib/components/__tests__/SierpinskiLab.test.ts src/lib/components/__tests__/FourierLab.test.ts` (labs on the shell's transport) and `npx svelte-check --tsconfig ./tsconfig.json`.

- [ ] **Step 5: Controller commits** — `feat(web): the lab shell disables transport buttons that would do nothing, and says why`.

---

### Task 5: The JPEG lab's one current block, no autoplay, a slower scan

**Files:**
- Modify: `web/src/lib/jpeg/params.ts` (beside `mcuCount` :114)
- Modify: `web/src/lib/components/labs/JpegLab.svelte`
- Test: `web/src/lib/jpeg/__tests__/params.test.ts`, `web/src/lib/components/__tests__/JpegLab.test.ts`

**Interfaces:**
- Consumes: Task 4's `firstStep` and `transportOff` props. Task 1's rule behaviour (the fake engine does not emulate it; tests drive `jpegSummaryFixture.selected` and `snapshotFixture` directly).
- Produces (`params.ts`):
  - `export function mcuIndexOf(block: [number, number], s: SubsamplingId, imgW: number): number` — the scan index of the MCU holding luma block `block`: `cols = ceil(imgW / mcuW)`, `mx = floor(bx * 8 / mcuW)`, `my = floor(by * 8 / mcuH)`, index `my * cols + mx` (`[mcuW, mcuH] = mcuSize(s)`).
  - `export function lumaAnchorOf(sel: { component: number; bx: number; by: number }, s: SubsamplingId): [number, number]` — the TS twin of Task 2's `luma_anchor`.
- Produces (`JpegLab.svelte`):
  - `DEFAULT_SPEED = 4`, with the comment updated (the 256² gradient, 256 MCUs, scans in about a minute).
  - `firstStep={1}` on `<LabShell>`; `transportOff={stage === 'overview' ? OVERVIEW_TRANSPORT_OFF : null}` with `const OVERVIEW_TRANSPORT_OFF = 'The overview shows the whole picture at once. Pick a stage to follow the scan one block at a time.'`.
  - `first` and every autoplay are removed. `encode(writeUrl = true, resume = true)`: after the new config, it dispatches `cmd.jumpTo(mcuIndexOf(at, subsampling, img.w) + 1)`, where `at` is `anchor`, or else the encoder's default block read back from the summary (`lumaAnchorOf(summary.selected, subsampling)`, after `selectAnchor()`). It then dispatches `cmd.play()` only when `resume` and the scan was playing before. `loadImage` (a new picture, an upload, a tour hand-off of another picture, the gradient fallback) calls `encode(..., false)`.
  - `function pick(b: [number, number], c = component)` — the single way the reader picks a block: `anchor = clampBlock(b)`, `component = c`, `selectAnchor()`, then `cmd.pause()` and `cmd.jumpTo(mcuIndexOf(anchor, subsampling, image.w) + 1)`, then `syncUrl()`. `onImageClick`, `onImageKey` and `pickBlock` (Decode hints, `c = 0`) call it. The link's block on open goes through `encode`'s jump, not `pick`.
  - `function followScan()` — called from the existing iteration effect after `summary` is read. If `summary.selected` is not the block `anchor` maps to in the current component, it sets `anchor = lumaAnchorOf(summary.selected, subsampling)`. It then calls `syncUrl()` only when the scan is paused. It never calls `pushLayout()` or `patchVizConfig`.
  - On every playing → paused transition (including the engine pausing itself at the end): `syncUrl()`.
  - The zigzag path: on each transition of `playing`, `api.patchVizConfig({ zigzag_speed: playing ? 0 : ZIGZAG_SPEED })` with `const ZIGZAG_SPEED = 24` (mirrors `default_zigzag_speed` in the viz). Not on mount.
  - The "How it works" tip, exact copy: `On stages 1–9, Play runs the scan block by block: the picture fills in as it would arrive over a slow connection, and the panels follow each block as it is scanned. Clicking a block on the picture, or moving with the arrow keys there, puts the scan on that block. The left and right arrow keys elsewhere move between stages, the overview included.`

- [ ] **Step 1: Write the failing tests**

`params.test.ts`:

```ts
it('finds the scan step of a luma block', () => {
  expect(mcuIndexOf([21, 17], '420', 256)).toBe(8 * 16 + 10);
  expect(mcuIndexOf([3, 0], '444', 256)).toBe(3);
  expect(mcuIndexOf([5, 3], '422', 256)).toBe(3 * 16 + 2);
  expect(mcuIndexOf([2, 0], '420', 24)).toBe(1); // padded: 2 MCUs across
});

it('maps a selection to its top-left luma block', () => {
  expect(lumaAnchorOf({ component: 0, bx: 21, by: 17 }, '420')).toEqual([21, 17]);
  expect(lumaAnchorOf({ component: 1, bx: 3, by: 2 }, '420')).toEqual([6, 4]);
  expect(lumaAnchorOf({ component: 2, bx: 3, by: 2 }, '422')).toEqual([6, 2]);
  expect(lumaAnchorOf({ component: 1, bx: 3, by: 2 }, '444')).toEqual([3, 2]);
});
```

`JpegLab.test.ts`. Use the file's `renderLab()` and fixtures. The fixture's default selection is luma `(21, 17)` at 4:2:0 on 256², so its step is `mcuIndexOf([21, 17], '420', 256) + 1 = 139`.

```ts
it('does not play on open, on a new picture or on an upload', async () => {
  const { getByLabelText } = await renderLab(); // the picture <select>'s label, as other tests use it
  const kinds = () => dispatchSpy.mock.calls.map((c) => c[0].kind);
  expect(kinds()).not.toContain('Play');
  expect(dispatchSpy).toHaveBeenCalledWith({ kind: 'JumpTo', iteration: 139 });
  // pick another gallery picture, then upload one (reuse the file's helpers for both) ...
  expect(kinds()).not.toContain('Play');
});

it('a click on the picture pauses the scan and jumps it there', async () => {
  // click the image at luma block (2, 3), as 'picks a picture block' tests do
  // expect, in order: rule_action select_block {component 0, bx 2, by 3}, then Pause, then JumpTo(mcuIndexOf([2,3],'420',256)+1 = 18)
});

it('the panels and the link follow the scan while it is paused', async () => {
  // paused; set jpegSummaryFixture.selected to {component 0, bx 8, by 0, ...} and snapshotFixture.iteration = 5; let a frame pass
  // expect route.query to contain b=8,0 (the link's block param)
});

it('following the scan while playing pushes no viz config and writes no link', async () => {
  // playing: snapshotFixture.playing = true; updateVizConfigSpy.mockClear(); remember route.query
  // step iteration 5 -> 6 -> 7 with selected moving (8,0) -> (10,0) -> (12,0); let frames pass
  expect(updateVizConfigSpy).not.toHaveBeenCalled();
  // route.query unchanged; then snapshotFixture.playing = false; frame -> route.query now has b=12,0
});

it("a settings change returns the scan to the current block's step", async () => {
  // anchor (21, 17); playing; switch subsampling to 4:4:4
  // expect JumpTo(17 * 32 + 21 + 1 = 566) and then Play (it was playing)
  // paused, change quality: JumpTo again, and no Play
});

it("a shared block off the grid opens the scan at the clamped block's step", async () => {
  // open with b=999,999 (the existing clamp test's link); the clamped block is (31, 31) on 256²
  // expect JumpTo(mcuIndexOf([31, 31], '420', 256) + 1 = 256) and no Play
});

it('switches the transport off on the overview and on at a stage', async () => {
  const { getByRole } = await renderLab(); // opens on the overview
  for (const name of [/Reset/, /Back/, /Play/, /Forward/]) expect(getByRole('button', { name }).getAttribute('aria-disabled')).toBe('true');
  await fireEvent.click(getByRole('button', { name: 'Step 1: Color' }));
  // set snapshotFixture.iteration = 64 first (mid-scan); then Play, Forward, Back and Reset are all available
  for (const name of [/Reset/, /Back/, /Play/, /Forward/]) expect(getByRole('button', { name }).getAttribute('aria-disabled')).toBeNull();
});

it('shows the zigzag path whole while the scan plays', async () => {
  // toggle snapshotFixture.playing true then false with frames between
  expect(updateVizConfigSpy).toHaveBeenCalledWith(expect.objectContaining({ zigzag_speed: 0 }));
  expect(updateVizConfigSpy).toHaveBeenLastCalledWith(expect.objectContaining({ zigzag_speed: 24 }));
});
```

The comment lines are assertions to write with the file's existing helpers: the values are fixed, the mechanics are the file's. Replace the tests that assumed autoplay or "the same share" (`'encodes a picture as a typed array and plays the scan'`, `'restores the scan share and keeps playing after a settings change'`, and any other that expects `Play` after load). Name each replaced test in the report.

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/lib/jpeg/__tests__/params.test.ts src/lib/components/__tests__/JpegLab.test.ts`.

- [ ] **Step 3: Implement** as in Interfaces.

- [ ] **Step 4: Run, expect PASS** — the same files, then `npx vitest run` and `npx svelte-check --tsconfig ./tsconfig.json`.

- [ ] **Step 5: Controller commits** — `feat(web): the JPEG lab has one current block that the scan moves, no autoplay, a slower scan`.

---

### Task 6: The subsample stage's zoom follows the selection

**Files:**
- Modify: `web/src/lib/jpeg/layout.ts` (`Panel` :50-57, `jpegLayout` :153-226, `toDevicePanels` :301-310)
- Modify: `web/src/lib/jpeg/explain/hit.ts` (`canvasTarget` :75-100, `pixelAt` :61)
- Modify: `web/src/lib/components/labs/JpegLab.svelte` (`pushLayout`; the `canvasTarget(...)` call :489)
- Test: `web/src/lib/jpeg/__tests__/layout.test.ts`, `web/src/lib/jpeg/explain/__tests__/hit.test.ts`

**Interfaces:**
- Consumes: Task 2's panel `zoom`; Task 5's `lumaAnchorOf`.
- Produces:
  - `Panel` gains `zoom?: number` (image pixels). `jpegLayout(stage, cssW, cssH, imgW, imgH)` drops its `block` parameter. The subsample stage's four plane panels carry `zoom: ZOOM_WINDOW` and no `crop`. Their labels keep `${side} × ${side} px around the block`, with `side = Math.min(ZOOM_WINDOW, imgW, imgH)`.
  - `toDevicePanels` returns `{ kind, rect, crop, zoom }` with `zoom: p.zoom ?? null` (not scaled by dpr: it is in image pixels).
  - `canvasTarget(layout, stage, img, x, y, sel, subsampling: SubsamplingId = '420')`: for a panel with `zoom`, `pixelAt` uses `zoomWindow(lumaAnchorOf(sel, subsampling), img.w, img.h)` when `sel` is known, else the whole picture.
  - `pushLayout()` no longer passes a block, so a scan step never needs a layout push.

- [ ] **Step 1: Write the failing tests**

```ts
// layout.test.ts
it('zooms the subsample stage around the selection, not a fixed crop', () => {
  const l = jpegLayout('subsample', 900, 600, 256, 256);
  const planes = l.panels.filter((p) => p.kind.startsWith('plane_') || p.kind.startsWith('coded_'));
  expect(planes).toHaveLength(4);
  for (const p of planes) {
    expect(p.zoom).toBe(ZOOM_WINDOW);
    expect(p.crop).toBeUndefined();
  }
  expect(toDevicePanels(planes, 2)[0]).toMatchObject({ zoom: ZOOM_WINDOW, crop: null });
});

// hit.test.ts
it('reads a pixel under a zoomed panel through the selection’s window', () => {
  // use the subsample layout above and a selection {component 1, bx 3, by 2} at '420'
  // the window is zoomWindow([6, 4], 256, 256) = [36, 20, 32, 32]
  // a point at the zoomed panel's top-left corner maps to pixel (36, 20)
});
```

(Use a straight apostrophe in the test name. Get the existing hit tests' target shape for `pixel` from the file.)

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/lib/jpeg/__tests__/layout.test.ts src/lib/jpeg/explain/__tests__/hit.test.ts`.

- [ ] **Step 3: Implement** as in Interfaces; update existing layout tests that passed a block.

- [ ] **Step 4: Run, expect PASS** — the same files, then `npx vitest run` and `npx svelte-check --tsconfig ./tsconfig.json`.

- [ ] **Step 5: Controller commits** — `feat(web): the subsample stage's zoom follows the current block`.

---

### Task 7: The transport cards say why, and docs

**Files:**
- Modify: `web/src/lib/jpeg/explain/bezel.ts` (`scanFacts` :263, `playCard` :279, `resetCard` :302, `stepCard` :318, `STEP_DETAIL` :274)
- Test: `web/src/lib/jpeg/explain/__tests__/bezel.test.ts`
- Modify: `docs/testing.md` (web test count and the JPEG scope sentence)

**Interfaces:**
- Consumes: `ctx.stage`, `ctx.summary.n` / `total`, `ctx.playing`. The JPEG lab's first step is 1 (Task 5).
- Produces (copy; every card keeps its title, live `value` and `details`):
  - Overview (`ctx.stage === 'overview'`), all of play, reset, step back and step forward: `consequence` is `The overview shows the whole picture at once, so the scan has nothing to show here. Pick a stage to follow it one block at a time.`
  - Play, paused at the end: `body` is `The scan has reached the last block.` and `consequence` is `All ${total} steps are done. Reset to scan again.`
  - Play, otherwise paused: `body` is `Plays the scan: the lab walks across the picture one step at a time, in the order the file is written, and the panels follow each block as it is scanned.`
  - Reset: `body` is `Rewinds the scan to the first block. The picture stays encoded; only the replay goes back.`; at `n <= 1`, `consequence` is `The scan is already at the first block.`
  - Step back at `n <= 1`: `The scan is already at the first block.` Step forward at the end: `The scan has reached the last block. Reset to scan again.`
  - Normal step consequence: unchanged (`From step a to step b of c.`).

- [ ] **Step 1: Write the failing tests** in `bezel.test.ts`, using the file's context fixture:

```ts
it('says the overview has no scan to play', () => {
  for (const id of ['bezel.play', 'bezel.reset'] as const) {
    expect(explain({ id }, { ...ctx, stage: 'overview' })!.consequence).toContain('The overview shows the whole picture at once');
  }
  expect(explain({ id: 'bezel.step', dir: 'forward' }, { ...ctx, stage: 'overview' })!.consequence).toContain('Pick a stage to follow it');
});

it('treats step 1 as the start', () => {
  const at1 = withScan(ctx, 1, 256); // build the summary with n = 1, total = 256 as the file's helpers do
  expect(explain({ id: 'bezel.step', dir: 'back' }, at1)!.consequence).toBe('The scan is already at the first block.');
  expect(explain({ id: 'bezel.reset' }, at1)!.consequence).toBe('The scan is already at the first block.');
});

it('says Reset at the end', () => {
  const end = withScan(ctx, 256, 256);
  expect(explain({ id: 'bezel.play' }, end)!.consequence).toBe('All 256 steps are done. Reset to scan again.');
  expect(explain({ id: 'bezel.step', dir: 'forward' }, end)!.consequence).toBe('The scan has reached the last block. Reset to scan again.');
});

it('says the panels follow the scan', () => {
  expect(explain({ id: 'bezel.play' }, withScan(ctx, 64, 256))!.body).toContain('the panels follow each block as it is scanned');
});
```

Update existing assertions in the file that pinned the old copy ("already at the start", "Rewinds the scan to the start").

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/lib/jpeg/explain/__tests__/bezel.test.ts`.

- [ ] **Step 3: Implement** the copy.

- [ ] **Step 4: Run, expect PASS** — the same file, then `npx vitest run` (coverage test included) and `npx svelte-check --tsconfig ./tsconfig.json`. Update `docs/testing.md`'s web count to the number `npx vitest run` prints. Add to the JPEG paragraph's scope that the tests cover the panels following the scan, no autoplay, and the transport's disabled states with their reasons.

- [ ] **Step 5: Controller commits** `bezel.ts`, its test and `docs/testing.md` — `feat(web): the JPEG transport cards say why a button does nothing`.

---

## After the tasks (controller)

1. **Build the WASM package** so the dev server serves the new Rust: `wasm-pack build crates/viz-core --target web` (as `README.md` says). Then run `wasm-pack test --headless --chrome crates/viz-core` alone, with the chromedriver recipe if it mismatches.
2. **Final whole-branch review** on the most capable model.
3. **Browser check** in the pane (hard reload after the WASM build), at 375 × 812 and at 1024 × 768:
   - no autoplay on open, with the scan paused at the busiest block;
   - Play on the DCT stage moves the panels block by block;
   - the colour cube and the decode panels light up the current block;
   - clicking a block pauses and jumps the scan there;
   - the transport is off on the overview, Back and Reset are off at the first block, and Play and Forward are off at the end;
   - each disabled button's card says why.
4. **PR against `main`.**
