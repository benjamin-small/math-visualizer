# JPEG Lab: explain-everything tooltips — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every hoverable thing in the JPEG lab shows a plain-English card. The card gives the actual value, what it means here, and what the current settings do to it, and it unfolds on demand into the detailed arithmetic.

**Architecture:**
- **Explainers:** pure functions turn a *target* (what is under the pointer, with its coordinates) and an *explain context* (summary, settings, image, inspect views) into an `Explanation`. They are unit-tested with fixtures.
- **Host:** one `TooltipHost` per page owns the hover/pinned state machine, the delay, the placement, "More", pinning, Escape, outside clicks, long-press and keyboard. A Svelte action registers DOM targets with it.
- **Canvas:** a pure hit-test maps a pointer position over the WebGL canvas to a target, using the layout geometry the overlays already use.
- **Kit:** one small kit function decodes the current file once per encode, so pixel cards can show the JPEG's own pixels.

**Tech Stack:** Svelte 5 + TypeScript (web/), Vitest + Testing Library, Rust + wasm-bindgen (one kit function), wasm-pack in headless Chrome.

**Spec:** `docs/superpowers/specs/2026-10-17-jpeg-lab-tooltips-design.md`. Its Inventory section is the checklist the targets below implement.

## Global Constraints

- **Branch:** `jpeg-lab-tooltips` (from `main` after PR #41, design committed). Nothing is pushed until the end.
- **Validation (AGENTS.md):**
  - `cargo fmt --all --check`
  - `cargo clippy --all-targets --all-features`: nothing new outside `sierpinski_*`.
  - `cargo test --all-features`
  - `wasm-pack test --chrome --headless --chromedriver=<path> crates/viz-core` (the flag goes before the crate path).
  - `wasm-pack build crates/viz-core --target web --out-dir pkg`
  - `cd web && npx vitest run` and `npx svelte-check --tsconfig ./tsconfig.json`
- **Scope:** the JPEG lab only (`#/jpeg`). The other labs are untouched.
- **Voice:**
  - The compact card is written for a layperson.
  - It has three lines:
    1. the actual value;
    2. what it means here, in plain words;
    3. what the current settings do to it.
  - Every compact card contains a live number or a consequence of the current settings.
  - "Coefficient", "quantize", "entropy" and "MCU" appear only after a plain-words explanation, or in the unfolded part.
  - Sentence case, British spelling as in the lab ("colour").
  - No emoji or arrow glyphs in `.svelte` files (a repo test scans them). Arrows such as "→" may appear in `.ts` explainer strings.
- **The bar every card is measured against** (the hovered DCT coefficient, verbatim in structure):
  - value: `F(2,1) = −34.2`
  - body: `How much of pattern (2, 1) is in this block: two half-waves across, one down. Negative means its light and dark are swapped.`
  - consequence: `At quality 50 it rounds to −3 × 12: kept.`
- **Interaction rules (from the spec):**
  - Hover shows the compact card after **150 ms**. Moving to a neighbouring target while a card shows updates it at once.
  - **Acting** targets (buttons, chips, toggles, select, stage buttons, gallery tiles, the stage image, which picks a block) keep their click. Their card unfolds only through its **More** link.
  - **Non-acting** targets (numbers, cells, bars, pixels, curve points, label chips, segments) **pin** their card on click.
  - Touch:
    - Tapping a non-acting target shows its card, and More unfolds it.
    - Pressing and holding an acting target for **500 ms** shows its card and swallows that click.
  - Keyboard:
    - Focusing a target shows its compact card.
    - **Enter** on a non-acting target pins it.
    - **`?`** unfolds the focused target's card.
  - One pin at a time. Hovering other things still shows their compact cards while a card is pinned.
  - Escape, the card's close button, or a click elsewhere closes the pin. That click still does its normal job.
  - Live:
    - A pinned card re-evaluates when the context changes.
    - Changing the picture, the selected block, the plane or the stage closes it.
- **No encoding on hover.** Explainers read only the context. The decoded pixels come from Task 1's decode, run once per encode version.
- **No native tooltips:** every `title=` attribute in the JPEG lab's components is replaced by a card (Task 7's test enforces this).
- **The 3D cube** gets a card for its panel and its axes slider only, not per point.
- **Other qualities:** "what another setting would change" uses only `scaleTable` arithmetic on this block and the chroma sample counts. Sizes and PSNR at other qualities come only from cached R–D points (`cachedCurve`) when they exist.

## Review Focus

1. **The pointer crosses the 2 px gaps between cells.** The card must not flicker off and on. Task 3's host test `keeps the card while moving across a gap within 150 ms`; Task 4's hit-test maps gaps to the nearest cell's target.
2. **A card pinned near the canvas edge, or on a phone.** It must stay fully on screen, flipping side or top/bottom as needed, and the unfolded part scrolls inside a max height. Task 3's `placeCard` tests: the right edge, the bottom edge, and a 375 × 812 viewport.
3. **A card pinned while the reader changes picture or block.** It must close rather than show numbers for the old block. Task 3's test `closes a pinned card when its scope changes`; Task 4 passes the scope key.
4. **A quality drag with a quantize card pinned.** The consequence line must follow the slider, with no encode triggered by the card. Task 4's JpegLab test `updates a pinned quantize card as quality changes`, asserting the encode count is unchanged by the card.
5. **Touch long-press on an acting control** (a stage button). It must show the card and must not switch the stage; a normal tap still switches. Task 3's test `long-press shows the card and swallows the click`; Task 5 checks it on the stage rail.

---

## Task 1: Kit decode for the current file

**Files:** `crates/viz-core/src/jpeg_kit.rs` (with its tests), `crates/viz-core/tests/jpeg_kit.rs`

**Interfaces:**
- Produces: `#[wasm_bindgen] pub fn jpeg_decode(bytes: &[u8]) -> Result<Vec<u8>, JsError>`. It returns RGBA (`w·h·4`, alpha 255) by way of `jpeg::codec::decode`, and turns a corrupt or empty input into a `JsError` (never a panic).

- [ ] **Step 1: Write the failing tests.**
  - Native: `decode_returns_the_pixels_of_an_encoded_image`. Encode a 16 × 8 built-in gradient at q90. `jpeg_decode(bytes)` has length 16·8·4, every 4th byte is 255, and its RGB matches `jpeg_encode_decode` for the same settings exactly.
  - Native: `decode_refuses_garbage`. Both `jpeg_decode(&[])` and `jpeg_decode(&[0xFF, 0xD8, 0x00])` are `Err`.
  - Browser (`tests/jpeg_kit.rs`): `decode_crosses_the_boundary`. Take the engine's `rule_bytes()` and decode it. The length is `width·height·4`, using the summary's width and height.
- [ ] **Step 2: Run** `cargo test -p viz-core jpeg_kit`. Expected: FAIL (no `jpeg_decode`).
- [ ] **Step 3: Implement** with a doc comment saying it is meant to run once per encode, not per frame.
- [ ] **Step 4: Run** the native tests, `wasm-pack test … --test jpeg_kit` (7 passed), then `wasm-pack build`.
- [ ] **Step 5: Lint and commit:** `feat(jpeg): kit decode of a JPEG file to RGBA`.

---

## Task 2: Explainer core (types, context, quality maths, DCT and Quantize)

Pure TypeScript only; no UI. It can run in parallel with Task 1.

**Files:**
- Create, under `web/src/lib/jpeg/explain/`:
  - `types.ts`, `context.ts`, `quality.ts`, `targets.ts`, `dct.ts`, `quantize.ts`, `index.ts`
  - `__tests__/fixture.ts`, `__tests__/quality.test.ts`, `__tests__/dct.test.ts`, `__tests__/quantize.test.ts`

**Interfaces:**
- Produces:
  - **`types.ts`:**
    - `Detail = { kind: 'text'; text: string } | { kind: 'tex'; tex: string } | { kind: 'rows'; rows: [string, string][] } | { kind: 'pattern'; u: number; v: number }`
    - `Explanation = { title: string; value?: string; body: string; consequence?: string; details: Detail[]; acts?: boolean }`
  - **`targets.ts`:** the target union, with these exact `id` strings. Every inventory line of the spec maps to one id. All coordinates are numbers. `stage` is a `StageId`.

```ts
export type Target =
  | { id: 'bezel.picture' | 'bezel.upload' | 'bezel.quality' | 'bezel.chroma' | 'bezel.huffman' | 'bezel.save' | 'bezel.speed' }
  | { id: 'rail.stage'; stage: StageId }
  | { id: 'readout.size' | 'readout.ratio' | 'readout.bpp' | 'readout.psnr' | 'chip.custom' }
  | { id: 'image.pixel'; x: number; y: number }
  | { id: 'overview.pixel'; which: 'original' | 'decoded'; x: number; y: number }
  | { id: 'overview.sizes' }
  | { id: 'overview.hist'; kind: 'raw' | 'diff' | 'jpeg'; bin: number }
  | { id: 'overview.entropy'; kind: 'raw' | 'diff' | 'jpeg' }
  | { id: 'gallery.tile'; picture: ImageId | 'upload' }
  | { id: 'color.cube' | 'color.axes' }
  | { id: 'color.plane'; plane: 0 | 1 | 2; x: number; y: number }
  | { id: 'subsample.plane'; which: 'full' | 'coded'; plane: 1 | 2; x: number; y: number }
  | { id: 'subsample.kept' }
  | { id: 'blocks.cell'; x: number; y: number }
  | { id: 'blocks.component' | 'blocks.shift' }
  | { id: 'dct.coeff' | 'dct.atlas'; u: number; v: number }
  | { id: 'dct.k' }
  | { id: 'dct.energy'; k: number }
  | { id: 'dct.cosines'; chart: string; i: number }
  | { id: 'quantize.before' | 'quantize.table' | 'quantize.after' | 'quantize.editor'; u: number; v: number }
  | { id: 'quantize.rebuild'; x: number; y: number }
  | { id: 'quantize.rd'; quality: number }
  | { id: 'quantize.dot' }
  | { id: 'zigzag.grid'; u: number; v: number }
  | { id: 'zigzag.seq'; k: number }
  | { id: 'zigzag.last' }
  | { id: 'rle.token'; i: number }
  | { id: 'rle.dc' | 'rle.bits' }
  | { id: 'huffman.tab' | 'huffman.cost'; table: number }
  | { id: 'huffman.bar' | 'huffman.leaf'; table: number; symbol: number }
  | { id: 'huffman.bits'; part: number }
  | { id: 'huffman.segment'; i: number }
  | { id: 'decode.wipe' | 'decode.error'; x: number; y: number }
  | { id: 'decode.wipeSlider' | 'decode.gainSlider' }
  | { id: 'decode.hint'; kind: 'blocking' | 'ringing' | 'bleed' }
  | { id: 'decode.resave'; generation: number };
```

  - **`targets.ts` also exports:**
    - `export const TARGET_IDS: readonly Target['id'][]`, listing every id once. The coverage test uses it.
    - `export function scopeKey(t: Target, ctx: ExplainContext): string`. A pinned card closes when this changes. It is built from the picture, the selected block, the plane and the stage.
  - **`context.ts`:** the context type. Task 4 builds it in the page.

```ts
export interface ExplainContext {
  summary: JpegSummary | null; stage: StageId; imageId: ImageId | 'upload'; image: RgbaImage | null;
  decoded: Uint8Array | null; quality: number; subsampling: SubsamplingId; huffman: HuffmanId;
  customTables: [number[], number[]] | null; speed: number; dctK: number; wipe: number; errorGain: number;
  huffTables: HuffTableView[]; segments: SegmentView[]; rd: RdPoint[]; otherBytes: number | null;
  resave: number[]; jpeg: Uint8Array | null;
}
```

  - **`quality.ts`:**
    - `STD_LUMA` and `STD_CHROMA`: copy the 64 values from `crates/jpeg/src/quant.rs`.
    - `scaleFactor(q) => q < 50 ? floor(5000 / q) : 200 - 2q`, with q clamped to 1–100.
    - `scaleTable(base, q)` gives each entry `floor((b·s + 50) / 100)` clamped to 1–255, matching `scale_table` in Rust.
    - `roundHalfAway(x)` rounds halves away from zero, like Rust's `f32::round`. JavaScript's `Math.round(-0.5)` is `-0`, which is wrong here.
    - `tableFor(ctx, component)` gives the custom table when one is set, else the scaled standard table.
  - **`dct.ts` / `quantize.ts`:** `explainDct(t, ctx)` and `explainQuantize(t, ctx)` return an `Explanation`, or `null` when the context lacks the data (no summary, or no selected block). Plural forms read right: "1 bit", "2 bits".
  - **`index.ts`:** `export function explain(t: Target, ctx: ExplainContext): Explanation | null`. It dispatches on the id prefix. Ids whose module doesn't exist yet return `null`; later tasks fill them in.

- [ ] **Step 1: Write the fixture and the failing tests.**
  - The fixture `makeContext(overrides?)` has:
    - `summary = readSummary(jpegSummaryFixture)`, so DCT `[120, −20, −20, 0…]` with DC at index 0 and the table all 16s;
    - quality 50, 4:2:0, optimized Huffman, no custom tables, stage `dct`;
    - a 256 × 256 image filled with 200, and `decoded` filled with 198;
    - `huffTables = readTables(jpegInspectFixture.huffman)` and `segments = readSegments(jpegInspectFixture.segments)`;
    - `rd` empty, `resave` empty, and `jpeg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xD9])`.

```ts
// quality.test.ts
expect(scaleFactor(50)).toBe(100); expect(scaleFactor(20)).toBe(250); expect(scaleFactor(90)).toBe(20);
expect(scaleTable(STD_LUMA, 50)).toEqual(STD_LUMA);
expect(scaleTable(STD_LUMA, 100).every((v) => v === 1)).toBe(true);
expect(roundHalfAway(-0.5)).toBe(-1); expect(roundHalfAway(2.5)).toBe(3); expect(roundHalfAway(-1.25)).toBe(-1);
// dct.test.ts
const e = explain({ id: 'dct.coeff', u: 1, v: 0 }, makeContext())!;
expect(e.value).toBe('F(1,0) = −20.0');
expect(e.body).toMatch(/pattern \(1, 0\)/); expect(e.body).toMatch(/one half-wave across/); expect(e.body).toMatch(/swapped/);
expect(e.consequence).toBe('At quality 50 it rounds to −1 × 16: kept.');
expect(explain({ id: 'dct.coeff', u: 3, v: 0 }, makeContext())!.consequence).toMatch(/rounds to 0 × 16: dropped/);
expect(explain({ id: 'dct.coeff', u: 0, v: 0 }, makeContext())!.body).toMatch(/average brightness/);
expect(e.details.some((d) => d.kind === 'pattern')).toBe(true);
// details: lower quality re-rounding with this block's number (q20 → step 40 → −0.5 → −1)
expect(JSON.stringify(e.details)).toMatch(/quality 20/);
expect(explain({ id: 'dct.coeff', u: 1, v: 0 }, makeContext({ summary: null }))).toBeNull();
// quantize.test.ts
expect(explain({ id: 'quantize.after', u: 0, v: 0 }, makeContext({ stage: 'quantize' }))!.value).toBe('8');
expect(explain({ id: 'quantize.after', u: 0, v: 0 }, makeContext({ stage: 'quantize' }))!.consequence).toMatch(/120\.0 ÷ 16 = 7\.5 .*8/);
expect(explain({ id: 'quantize.table', u: 0, v: 0 }, makeContext({ quality: 20, stage: 'quantize' }))!.value).toBe('16');
expect(explain({ id: 'quantize.after', u: 1, v: 0 }, makeContext({ customTables: [Array(64).fill(99), Array(64).fill(99)], stage: 'quantize' }))!.consequence).toMatch(/your table/);
expect(explain({ id: 'quantize.rd', quality: 30 }, makeContext({ rd: [{ quality: 30, bytes: 3000, psnr: 33.2 }] }))!.value).toMatch(/2\.9 KB.*33\.2 dB/);
```

  - The quantize-table test at quality 20 checks that the card shows the table **the encoder used**: the summary's `table` (16), not a recomputed one.
- [ ] **Step 2: Run** `cd web && npx vitest run src/lib/jpeg/explain`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The DCT body describes the pattern from `(u, v)`: "one/two/… half-waves across, … down". For (0, 0) it says "the block's average brightness".
  - `dct.atlas`, `dct.k`, `dct.energy` and `dct.cosines` belong to this task too. Use `cumulativeEnergy` from `math.ts` for the shares.
  - `quantize.before`, `quantize.table`, `quantize.after`, `quantize.editor`, `quantize.rebuild`, `quantize.rd` and `quantize.dot`:
    - the rebuilt cell comes from `idct(dequantize)`, or from the summary, whichever exists;
    - R–D points come from `ctx.rd`;
    - the dot uses the summary's bytes and PSNR.
- [ ] **Step 4: Run** the tests again: PASS.
- [ ] **Step 5: Commit:** `feat(web): explainer core for the JPEG lab, with the DCT and quantize cards`.

---

## Task 3: The card host and the target action

**Files:**
- Create, under `web/src/lib/components/jpeg/`:
  - `TooltipHost.svelte`
  - `tooltip.svelte.ts`
  - `placeCard.ts`
  - the tests `__tests__/tooltip.test.ts` and `__tests__/placeCard.test.ts`

**Interfaces:**
- Consumes: Task 2's `Target`, `Explanation`, `explain`, `scopeKey` and `ExplainContext`.
- Produces:
  - **`class TooltipController`** (in `tooltip.svelte.ts`). Its reactive state: `hovered: { target: Target; x: number; y: number } | null` and `pinned: { target: Target; rect: DOMRect; unfolded: boolean; scope: string } | null`. Its methods:
    - `hover(t, x, y)`: shows after 150 ms, or at once while a card is already showing.
    - `leave()`: hides after 120 ms unless another hover arrives first.
    - `pin(t, rect)`, `unfold()`, `close()`
    - `setContext(ctx)`: re-evaluates, and closes the pin when `scopeKey` changes.
  - **`export const tooltip: Action<HTMLElement | SVGElement, { ctl: TooltipController; target: Target | ((e: PointerEvent) => Target | null); acts?: boolean }>`**. It wires:
    - pointerenter, pointermove, pointerleave;
    - click: pins if `!acts`;
    - long-press of 500 ms for pointerType `touch` on `acts`: shows the card and calls `preventDefault` on the following click;
    - focus and blur;
    - keydown: Enter pins if `!acts`, and `?` unfolds.

    It also sets `aria-describedby` to the host's live compact-text element.
  - **`placeCard(anchor: { x: number; y: number; w?: number; h?: number }, card: { w: number; h: number }, viewport: { w: number; h: number }, gap = 12): { x: number; y: number }`**. It prefers right of and below the anchor, flips left or up to stay inside, and clamps to an 8 px margin.
  - **`TooltipHost.svelte`** props: `{ ctl: TooltipController; ctx: ExplainContext }`. It renders:
    - the hovered compact card (`role="tooltip"`), with a "More" button when `details.length > 0`;
    - the pinned card: compact plus unfolded details, `max-height: 50vh` with scrolling, and a close button;
    - `tex` details through the existing `Tex.svelte`, and `pattern` details as an 8 × 8 inline SVG of the basis.

    It listens for Escape and for pointerdown outside the card (closing without `preventDefault`).

- [ ] **Step 1: Write the failing tests.**
  - **`placeCard`:**
    - an anchor at (10, 10), card 200 × 100, viewport 800 × 600 gives (22, 22);
    - an anchor at (790, 300) flips left, so `x + 200 ≤ 792`;
    - an anchor at (300, 590) flips up, so `y + 100 ≤ 592`;
    - viewport 375 × 812 with a 340-wide card: x is clamped to 8…27.
  - **Controller and action** (fake timers, a host rendered with `makeContext()` from Task 2's fixture):
    - `shows the compact card after 150 ms of hover`: nothing at 100 ms; at 150 ms `role="tooltip"` contains `F(1,0) = −20.0`.
    - `keeps the card while moving across a gap within 150 ms`: pointerleave, then pointerenter on a neighbour at 60 ms. The card stays and switches to the neighbour's value at once.
    - `pins on click for a non-acting target and keeps it on leave`.
    - `does not pin on click for an acting target; More unfolds it instead`.
    - `long-press shows the card and swallows the click`: pointerdown with pointerType touch, advance 500 ms, then click. The card shows and the target's own onclick spy is not called. A short tap (100 ms) calls the spy and shows no card.
    - `Escape and outside clicks close the pin; the outside click still reaches its target` (a spy on the outside button is called).
    - `closes a pinned card when its scope changes` (change `summary.selected.bx` in the context).
    - `keyboard: focus shows the compact card, Enter pins, ? unfolds`.
    - `the target's accessible description is the compact text`.
- [ ] **Step 2: Run** `npx vitest run src/lib/components/jpeg/__tests__/tooltip.test.ts src/lib/components/jpeg/__tests__/placeCard.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** to the interfaces. Styling:
  - the lab's dark overlay look: `#23232a`, a 1 px rgba(255, 255, 255, .18) border, radius 8, a soft shadow, 12.5 px text, max width 320;
  - the value line in the mono font;
  - the consequence line in a softer colour.
- [ ] **Step 4: Run** the tests: PASS. svelte-check: 0 errors.
- [ ] **Step 5: Commit:** `feat(web): tooltip host, placement and target action for the JPEG lab`.

---

## Task 4: Canvas hit-testing and the DCT and Quantize stages end to end

**Files:**
- Create: `web/src/lib/jpeg/explain/hit.ts`, `web/src/lib/jpeg/explain/__tests__/hit.test.ts`
- Modify:
  - `web/src/lib/components/labs/JpegLab.svelte`: the context, the host, the canvas pointer layer, the DCT/Quantize wiring and the decoded pixels.
  - `web/src/lib/components/jpeg/QTable.svelte` (editor cells)
  - `web/src/lib/components/jpeg/RdChart.svelte` (curve points and the dot)
  - `web/src/lib/components/__tests__/JpegLab.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3, and `layout.ts` (`cells`, `cellAt`, `blockAt`, `fit`, `Panel`).
- Produces:
  - **`canvasTarget(layout: StageLayout, stage: StageId, img: { w: number; h: number }, x: number, y: number, sel: SelectedBlock | null): Target | null`** (CSS pixels relative to the overlay):
    - cell panels give `{ u, v }` or `{ x, y }` targets for that stage:
      - `coeffs`: `dct.coeff` on DCT, `quantize.before` on Quantize;
      - `atlas`: `dct.atlas`;
      - `quant`: `quantize.after` on Quantize, `zigzag.grid` on Zigzag;
      - `rebuild`: `dct.coeff`-scoped rebuild cells (they share `dct.k` details);
      - `dequant_rebuild`: `quantize.rebuild`;
      - `block`: `blocks.cell`;
      - `zigzag`: `zigzag.grid`.
    - picture panels give pixel targets in image pixels:
      - `image` and `image_grid`: `image.pixel`;
      - `original` and `decoded`: `overview.pixel`;
      - `wipe`: `decode.wipe`;
      - `error`: `decode.error`;
      - `plane_*`: `color.plane` on Color, `subsample.plane` on Subsample;
      - `coded_*`: `subsample.plane` with `which: 'coded'`.
    - `cube`: `color.cube`.
    - Gaps between cells map to the nearest cell.
  - **JpegLab state:**
    - `decoded: Uint8Array | null`, refreshed once per `summary.version` through `jpeg_decode(api.engine.rule_bytes())`, in an effect keyed on version and never on hover;
    - `ctl = new TooltipController()`;
    - `explainCtx` as a `$derived` `ExplainContext`;
    - `<TooltipHost {ctl} ctx={explainCtx} />` in the overlay.
  - **Pointer layer:** one pointermove, pointerleave and click listener on the overlay root calls `canvasTarget` for canvas regions. It doesn't block the existing hover areas: their handlers call `ctl.hover` too. The stage image stays acting (a click picks a block).

- [ ] **Step 1: Write the failing tests.**
  - **`hit.test.ts`** (layouts from `jpegLayout(stage, 1134, 585, 256, 256, [10, 10])`):
    - the centre of the DCT `coeffs` panel's cell (2, 1) gives `{ id: 'dct.coeff', u: 2, v: 1 }`;
    - a point in the gap between cells (2, 1) and (3, 1) gives one of the two, never null;
    - the image centre on DCT gives `{ id: 'image.pixel', x: 128, y: 128 }` (±1);
    - Quantize `quant` cell (0, 0) gives `quantize.after`;
    - the overview `decoded` panel's centre gives `overview.pixel` with `which: 'decoded'`;
    - outside every panel gives `null`.
  - **`JpegLab.test.ts`:**
    - `explains a DCT coefficient on hover`: on stage `dct`, hover the coefficient overlay at cell (1, 0) and advance 150 ms. The tooltip shows `F(1,0)` and `rounds to`.
    - `pins a quantize cell on click and unfolds the details`.
    - `updates a pinned quantize card as quality changes`: pin `quantize.after` (1, 0), then change Quality to 20. The consequence names quality 20 and the image push count rises only by the encode the slider itself causes.
    - `decodes the current file once per encode`: a `jpeg_decode` spy on the kit mock is called once after load and once after a quality change, and never on hover.
    - `an acting target keeps its click`: clicking the stage image still sends `select_block`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Add `jpeg_decode` to `makeVizMock()` in `fakeViz.ts`: it returns `new Uint8Array(w·h·4)` from the fixture's width and height.
  - Register QTable's 64 inputs with `use:tooltip` (target `quantize.editor`, `acts: true`, since they are inputs).
  - Register RdChart's points with a pointer-to-nearest-quality function, plus the dot.
- [ ] **Step 4: Run** the tests, the full suite and svelte-check.
- [ ] **Step 5: Commit:** `feat(web): explain the DCT and quantize stages on hover, with canvas hit-testing`.

---

## Task 5: The bezel, readout, rail, custom chip and Picture select

**Files:**
- Create: `web/src/lib/jpeg/explain/bezel.ts` and its test
- Modify: `JpegLab.svelte`, `StageRail.svelte`, `Gallery.svelte` (tiles share `bezel.picture`'s wording through `gallery.tile`), `JpegLab.test.ts`

**Interfaces:**
- Consumes: Tasks 2–4.
- Produces explainers for:
  - `bezel.*`;
  - `rail.stage`;
  - `readout.*`;
  - `chip.custom`;
  - `gallery.tile`;
  - `image.pixel`: the pixel's RGB, its Y/Cb/Cr through `jpeg_rgb_to_ycbcr` maths in TS (BT.601), its block, and "click to follow this block".

  All the `title=` attributes in these files are removed.

- [ ] **Step 1: Write the failing tests** (`bezel.test.ts`, with `makeContext`):
  - `bezel.quality` at 50: value `50`, and the body says every table entry is scaled by `100%`. At 20: `250%`.
  - `bezel.chroma` at 4:2:0: "Keeps 25% of the colour detail".
  - `readout.psnr` at 44.5: the body says you can't see the difference. At 22: says it's obvious.
  - `readout.ratio`: "1/48" for the fixture's 196,608 / 4,096.
  - `bezel.speed` at 64 with 256 MCUs gives "scans in 4 s".
  - `rail.stage` for `huffman` mentions short codes.
  - `chip.custom` says the edited tables override quality.
  - `gallery.tile` for `doge` gives the catalog title and the picture's size.
  - `image.pixel` at (0, 0) on the fixture image gives `RGB 200, 200, 200`, block (0, 0).

  `JpegLab.test.ts`:
  - `explains the quality slider in context`: focus Quality; the compact card shows "50" and "100%".
  - `the stage rail keeps its click; a long-press explains it`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** and register every bezel control, rail button, readout stat, chip and gallery tile with `use:tooltip`. Controls are `acts: true`; readout stats are `acts: false`.
- [ ] **Step 4: Run** the tests, the full suite, svelte-check and the no-emoji test.
- [ ] **Step 5: Commit:** `feat(web): explain the bezel, readout, rail and pictures`.

---

## Task 6: Stages 1–3 and 6–8 (Color, Subsample, Blocks, Zigzag, Run-length, Huffman)

**Files:**
- Create: `web/src/lib/jpeg/explain/{early,coding}.ts` and their tests
- Modify:
  - `JpegLab.svelte`: the Blocks controls, the Color slider, and the subsample "kept" figure.
  - `ZigzagStrip.svelte`, `TokenChips.svelte`, `HuffmanView.svelte` (bars, leaves, tabs, the cost line, bits parts and segments): remove their `title=` attributes.
  - `JpegLab.test.ts`

**Interfaces:**
- Consumes: Tasks 2–4.
- Produces:
  - `early.ts`: `color.*`, `subsample.*`, `blocks.*`.
  - `coding.ts`: `zigzag.*`, `rle.*`, `huffman.*`.
  - The block-bits target `huffman.bits` takes `part` = the index into HuffmanView's existing `parts` list.

- [ ] **Step 1: Write the failing tests:**
  - `blocks.cell` (0, 0) on the fixture gives value `100`, plus "−128 → −28".
  - `subsample.plane` coded at 4:2:0 says "averaged from 4 samples" (2 × 2).
  - `subsample.kept` at 4:2:0 says "50% of all samples".
  - `zigzag.seq` k = 0 gives position "#1 of 64" and value `8`. k = 5 is "in the zero tail".
  - `rle.token` 0 (the fixture's EOB) says "every remaining number is zero" and shows its code bits `1010`.
  - `rle.dc` gives "8 − 6 = 2".
  - `huffman.bar` (table 1, symbol 0) says it "appears 30 times" with code `00` (2 bits).
  - `huffman.cost` (table 0) gives "80 bits against 32.5".
  - `huffman.segment` 2 (Sos) gives "the scan: 3,958 bytes".
  - `color.cube` mentions the grey diagonal.

  `JpegLab.test.ts`: `explains a token chip on the run-length stage` (hover the first chip; the card contains its bits).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** and register the targets with `use:tooltip`. Strip, token and bar elements pin on click; tabs and buttons are acting.
- [ ] **Step 4: Run** the tests, the full suite and svelte-check.
- [ ] **Step 5: Commit:** `feat(web): explain the colour, block and coding stages`.

---

## Task 7: Overview and Decode, coverage, docs and the browser check

**Files:**
- Create: `web/src/lib/jpeg/explain/{overview,decode}.ts`, their tests, and `web/src/lib/jpeg/explain/__tests__/coverage.test.ts`
- Modify:
  - `Overview.svelte` (histogram bars through pointer-to-bin, size bars, entropy figures)
  - `DecodeTools.svelte` (sliders, hints, re-save points; remove its `title=` attributes)
  - `JpegLab.test.ts`
  - `docs/superpowers/specs/2026-10-17-jpeg-lab-tooltips-design.md`: Status becomes implemented, with notes on any deviation.
  - `docs/testing.md`: counts.

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `overview.*` explainers. Histogram counts are computed with `histogram()` from `bytes.ts` on demand, cached per image or JPEG.
  - `decode.*` explainers:
    - `decode.error` gives the pixel's error in levels before brightening, using `decoded`;
    - `decode.hint` gives the block and why it was chosen;
    - `decode.resave` gives "generation g: psnr dB".

- [ ] **Step 1: Write the failing tests.**
  - `overview.hist` raw bin 200 on the fixture image (all 200s) gives "196,608 bytes".
  - `overview.hist` diff bin 0 says the samples "differ from their left neighbour by 0".
  - `overview.entropy` jpeg mentions how much room there is left to squeeze.
  - `overview.pixel` decoded (0, 0) gives "198, 198, 198", and the body names the difference of 2.
  - `decode.error` (0, 0) gives "2 levels".
  - `decode.hint` ringing with `hints.ringing` null says the picture has no hard edges.
  - `decode.resave` 3 with `resave = [30, 28, 27]` gives "27.0 dB".
  - **`coverage.test.ts`:**
    - for every id in `TARGET_IDS`, `explain(sampleTarget(id), makeContext(stageFor(id)))` is non-null;
    - every such explanation has a non-empty `value` or `consequence` containing a digit or one of the setting words (quality, chroma, Huffman, table, picture);
    - every id string appears in at least one `.svelte` file under `web/src/lib/components/` or in `hit.ts` (a source scan with node:fs);
    - no `title=` attribute remains in `web/src/lib/components/jpeg/*.svelte` or `labs/JpegLab.svelte`. SVG `<title>` elements are removed too; the cards replace them.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** and register the targets. Histogram bars use a single target function on the `<svg>` that maps pointer x to the bin.
- [ ] **Step 4: Full validation.** Run every command in Global Constraints, then update `docs/testing.md` with the measured counts and the spec's status line.
- [ ] **Step 5: Commit:** `feat(web): explain the overview and decode stages; coverage test; docs`.
- [ ] **Step 6 (controller): Browser check.**
  - Start the `web` dev server.
  - Capture with the capture script:
    - the DCT stage with a pinned coefficient card;
    - the Quantize stage with a pinned card;
    - the overview with a histogram card;
    - each at 1440 and 375 px.
  - With headless Playwright against the real engine:
    - hover a DCT coefficient and confirm the card's value matches the cell's number;
    - drag quality with a quantize card pinned and confirm the consequence changes;
    - confirm long-press behaviour with touch emulation;
    - confirm there are no console errors and no native `title` tooltips.
