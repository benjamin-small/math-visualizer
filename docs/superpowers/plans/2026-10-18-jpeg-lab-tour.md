# JPEG Lab Guided Tour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A guided tour dialog that walks a first-time visitor through the nine JPEG steps with their chosen picture, opening by itself on the first visit and reopening from a "How JPEG works" button.

**Architecture:** The step data and picture maths are pure TypeScript modules (`jpeg/tour.ts`, `jpeg/tourPictures.ts`). A `TourVisual.svelte` component draws one step's picture, and the whole-picture encodes go through the existing WASM kit (`jpeg_encode_decode`, `jpeg_encode_stats`). `JpegTour.svelte` is the modal: the flow strip, the step panel, the picker, the slider, the keyboard and the swipe. `JpegLab.svelte` mounts it, remembers the first visit, and applies the hand-off.

**Tech Stack:** Svelte 5 (runes), TypeScript, Vitest + @testing-library/svelte (jsdom), the existing fake engine in `web/src/lib/test/fakeViz.ts`.

**Spec:** `docs/superpowers/specs/2026-10-18-jpeg-lab-tour-design.md`

## Global Constraints

- **Dependencies:** no new ones.
- **Copy:** sentence case, British spelling ("colour"), and no emoji or arrow glyphs (→ ← ↺ etc.) in `.svelte` files; a repo test scans for them.
- **Step text:**
  - Each step has a heading of a few words and **at most two short sentences** on screen.
  - None of these words appears in step headings or on-screen step text: DCT, quantize/quantization, chroma, Huffman, coefficient, luma, YCbCr, MCU.
- **Exaggeration:** a picture whose change would be invisible is exaggerated and labelled in one short caption on the picture.
- **The tour never blocks:**
  - Once closed by any route, it stays closed (`localStorage` key `jpeg-tour-seen`).
  - Storage access is wrapped in try/catch. With no storage, it opens on load and closes for that page view.
  - The lab keeps loading behind it.
- **Dialog:**
  - A custom overlay (`role="dialog"`, `aria-modal="true"`, a focus trap), not a native `<dialog>`, so that the lab's `TooltipHost` (z-index 1000) draws above it. The overlay's z-index is 900.
  - Escape closes it. ArrowLeft/ArrowRight move between steps, except when focus is in an input or select.
  - Focus returns to the "How JPEG works" button.
- **Settings:**
  - The tour encodes with the lab's colour mode and Huffman setting, and with the standard tables at the slider's quality.
  - The slider starts at the lab's quality.
- **Exits:**
  - "Show me in the lab" and "Start exploring" hand over the picture and quality. "Show me in the lab" opens the stage for the current step; "Start exploring" opens `overview`.
  - "Skip the tour", Escape and the close button change nothing in the lab.
  - A picture uploaded inside the tour reaches the lab only through a hand-off.
- **Encoding:** at most one encode is in flight, and the latest slider value wins.
- **Phone (< 600 px wide):**
  - The strip becomes a row of dots and the picture sits above the text.
  - A horizontal touch swipe of more than 40 px moves the step.
  - No horizontal page scroll.
- **Validation commands (from `web/`):**
  - `npx vitest run`, which must be all green;
  - `npx svelte-check --tsconfig ./tsconfig.json`, which must report 0 errors;
  - and from the repo root, `cargo fmt --all --check && cargo clippy --all-targets --all-features && cargo test --all-features`. No Rust changes are expected, but this must stay green.

## The steps (exact data for `TOUR_STEPS`)

| id | n | stage | lossy | heading | short (strip label) | line (on screen) | card (hover, one sentence) |
|---|---|---|---|---|---|---|---|
| `split` | 1 | `color` | no | Split brightness from colour | Split | Your eye notices brightness far more than colour. | Brightness carries the shapes, so colour can be stored more roughly without you noticing. |
| `share` | 2 | `subsample` | yes | Shrink the colour | Shrink colour | Neighbouring pixels share one colour, and you barely notice. | Each 2 × 2 square of pixels keeps one shared colour, so only a quarter of the colour is stored. |
| `tiles` | 3 | `blocks` | no | Cut into tiles | Tiles | The picture is cut into 8 × 8 squares. | From here on each tile is handled on its own, which is why a heavily squeezed JPEG looks blocky. |
| `waves` | 4 | `dct` | no | Describe each tile as waves | Waves | Smooth tiles need a few waves; busy ones need many. | Any 8 × 8 tile can be rebuilt by mixing 64 standard wave patterns in different amounts. |
| `round` | 5 | `quantize` | yes | Round off fine detail | Round off | Faint waves round to zero. This is the big saving. | Lower quality rounds harder: a smaller file, but softer edges and visible tiles. |
| `line` | 6 | `zigzag` | no | Line the numbers up | Line up | The zeros end up together at the end. | Reading a tile from its smooth waves to its busy ones puts the zeros last. |
| `count` | 7 | `rle` | no | Count the zeros | Count zeros | "Five zeros, then a 3" is shorter than writing them all out. | A long run of zeros costs almost nothing once it is counted instead of written. |
| `codes` | 8 | `huffman` | no | Short codes for common things | Short codes | Like Morse code, the most common things get the shortest codes. | Frequent patterns get short codes and rare ones long codes, so the total shrinks. |
| `open` | 9 | `decode` | no | Open it again | Open | Your viewer undoes every step to show the picture. | Nothing is lost here; what was rounded off in steps 2 and 5 stays gone. |

## Review Focus

1. **Storage that throws** (Safari private mode, blocked site data): the tour opens and closes without an error. *Test in Task 1.*
2. **A fast slider drag** fires many inputs: never more than one encode in flight, and the picture ends on the last value, with no stale result after it. *Tests in Task 1 (`latestOnly`) and Task 2.*
3. **The tour opens before the kit or the picture is ready** (always true on a first visit): the step's picture area shows a loading state, while the text, strip and Next work. *Test in Task 2.*
4. **A tiny uploaded picture** (smaller than one 8 × 8 tile, or not a multiple of 8): the tile steps still draw, with no NaN or out-of-range reads. *Test in Task 1.*
5. **Keys inside the tour leak to the lab:** an arrow key in the tour must not change the lab's stage, and Escape closes only the tour. *Test in Task 4.*

---

### Task 1: Pure tour data and picture maths

**Files:**
- Create: `web/src/lib/jpeg/tour.ts`
- Create: `web/src/lib/jpeg/tourPictures.ts`
- Test: `web/src/lib/jpeg/__tests__/tour.test.ts`
- Test: `web/src/lib/jpeg/__tests__/tourPictures.test.ts`

**Interfaces:**
- Consumes:
  - `StageId` (`jpeg/stages.ts`);
  - `RgbaImage` (`jpeg/images.ts`);
  - `ImageId` (`jpeg/params.ts`);
  - `rgbToYcbcr` (`jpeg/explain/bezel.ts`);
  - `STD_LUMA`, `ZIGZAG`, `scaleTable`, `roundHalfAway` (`jpeg/explain/quality.ts`);
  - `idct8` (`jpeg/explain/block.ts`), used only in tests.
- Produces, in `tour.ts`:
  - `type TourStepId = 'split' | 'share' | 'tiles' | 'waves' | 'round' | 'line' | 'count' | 'codes' | 'open'`;
  - `interface TourStep { id: TourStepId; n: number; stage: StageId; lossy: boolean; heading: string; line: string; card: string }`;
  - `const TOUR_STEPS: readonly TourStep[]` (the table above, in order);
  - `const TOUR_SEEN_KEY = 'jpeg-tour-seen'`;
  - `function tourSeen(): boolean`;
  - `function markTourSeen(): void`;
  - `const TOUR_JARGON: RegExp` (matches `dct`, `quantiz*`, `chroma*`, `huffman`, `coefficient(s)`, `luma`, `ycbcr`, `mcu`, case-insensitive, whole words);
  - `function sentenceCount(text: string): number`;
  - `interface TourHandoff { stage: StageId; imageId: ImageId | 'upload'; image: RgbaImage; quality: number }`;
  - `function latestOnly<A, R>(run: (arg: A) => Promise<R>, deliver: (result: R, arg: A) => void): (arg: A) => void`.
- Produces, in `tourPictures.ts`:
  - `function ycbcrToRgb(y: number, cb: number, cr: number): [number, number, number]` (clamped to 0–255 and rounded);
  - `function brightnessImage(img: RgbaImage): RgbaImage` (grey from Y);
  - `function colourImage(img: RgbaImage): RgbaImage` (each pixel's Cb/Cr with Y set to 128);
  - `function shareColour(img: RgbaImage, size: number): RgbaImage` (Y per pixel; Cb and Cr averaged over each `size × size` square; edge squares average what they cover);
  - `function busiestTile(img: RgbaImage): [number, number]` (the tile column and row with the largest variance of Y among tiles; tiles at the edge count the pixels they cover; ties go to the first in row-major order; `[0, 0]` for any picture);
  - `function tileLuma(img: RgbaImage, bx: number, by: number): number[]` (64 Y values, row-major; reads past the edge repeat the last row or column);
  - `function fdct8(shifted: readonly number[]): number[]` (the forward 8 × 8 DCT, orthonormal JPEG scaling, so `idct8(fdct8(x)) ≈ x`);
  - `function tileNumbers(img: RgbaImage, bx: number, by: number, quality: number): number[]` (`roundHalfAway(fdct8(Y − 128)[i] / scaleTable(STD_LUMA, quality)[i])`, returned in zigzag order, 64 long);
  - `function strongestPatterns(coeffs: readonly number[], n: number): { u: number; v: number; amount: number }[]` (the `n` largest by |amount|, excluding (0, 0), row-major input);
  - `interface ZeroRun { zeros: number; value: number }`;
  - `function countZeros(zigzag: readonly number[]): { first: number; runs: ZeroRun[]; end: boolean }` (`first` = `zigzag[0]`; `runs` cover the positions 1 up to the last non-zero; `end` is true when zeros follow the last non-zero).

- [ ] **Step 1: Write the failing tests**

`tour.test.ts`:
```ts
it('has the nine steps in order with their stages', () => {
  expect(TOUR_STEPS.map((s) => s.id)).toEqual(['split','share','tiles','waves','round','line','count','codes','open']);
  expect(TOUR_STEPS.map((s) => s.n)).toEqual([1,2,3,4,5,6,7,8,9]);
  expect(TOUR_STEPS.map((s) => s.stage)).toEqual(['color','subsample','blocks','dct','quantize','zigzag','rle','huffman','decode']);
  expect(TOUR_STEPS.filter((s) => s.lossy).map((s) => s.id)).toEqual(['share','round']);
});
it.each(TOUR_STEPS.map((s) => [s.id, s] as const))('keeps %s short and plain', (_id, s) => {
  expect(sentenceCount(s.line)).toBeLessThanOrEqual(2);
  expect(sentenceCount(s.card)).toBe(1);
  expect(s.heading.split(/\s+/).length).toBeLessThanOrEqual(6);
  for (const t of [s.heading, s.line, s.card]) expect(t).not.toMatch(TOUR_JARGON);
  expect(s.heading).toMatch(/^[A-Z][^A-Z]*$/); // sentence case
});
it('counts sentences', () => {
  expect(sentenceCount('One. Two!')).toBe(2);
  expect(sentenceCount('"Five zeros, then a 3" is shorter than writing them all out.')).toBe(1);
});
it('remembers the first visit', () => {
  localStorage.removeItem(TOUR_SEEN_KEY);
  expect(tourSeen()).toBe(false);
  markTourSeen();
  expect(tourSeen()).toBe(true);
  expect(localStorage.getItem(TOUR_SEEN_KEY)).toBe('1');
});
it('treats storage that throws as not seen, and marking as a no-op', () => {
  const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
  const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  expect(tourSeen()).toBe(false);
  expect(() => markTourSeen()).not.toThrow();
  get.mockRestore(); set.mockRestore();
});
it('runs one at a time and delivers only the latest', async () => {
  const pending: Array<(v: number) => void> = [];
  const run = vi.fn((a: number) => new Promise<number>((r) => pending.push(r)));
  const got: number[] = [];
  const go = latestOnly(run, (r) => got.push(r));
  go(1); go(2); go(3);
  expect(run).toHaveBeenCalledTimes(1);   // 2 and 3 wait; 2 is dropped
  pending[0](10); await Promise.resolve(); await Promise.resolve();
  expect(got).toEqual([]);                // 1's result is stale: 3 is waiting
  expect(run).toHaveBeenLastCalledWith(3);
  pending[1](30); await Promise.resolve(); await Promise.resolve();
  expect(got).toEqual([30]);
});
```
If the jsdom polyfill in `web/src/lib/test/setup.ts` is not a `Storage` instance, spy on `window.localStorage.getItem` and `setItem` instead. A rejected `run` must not stop later calls; add one assertion for that.

`tourPictures.test.ts`, using a helper `img(w, h, f: (x, y) => [r, g, b])`:
```ts
it('splits brightness from colour and back', () => {
  const p = img(2, 1, (x) => (x ? [200, 40, 40] : [30, 90, 220]));
  const b = brightnessImage(p);
  expect(b.rgba[0]).toBe(b.rgba[1]); expect(b.rgba[1]).toBe(b.rgba[2]);       // grey
  expect(ycbcrToRgb(...rgbToYcbcr(200, 40, 40))).toEqual([200, 40, 40]);
  const c = colourImage(p);
  expect(Math.round(rgbToYcbcr(c.rgba[0], c.rgba[1], c.rgba[2])[0])).toBe(128);
});
it('shares colour over squares and keeps brightness', () => {
  const p = img(4, 4, (x, y) => ((x + y) % 2 ? [255, 0, 0] : [0, 0, 255]));
  const s = shareColour(p, 2);
  const cb = (i: number) => rgbToYcbcr(s.rgba[i], s.rgba[i + 1], s.rgba[i + 2])[1];
  expect(Math.abs(cb(0) - cb(4))).toBeLessThan(1.5);                         // same square, same colour
  expect(Math.abs(brightnessImage(s).rgba[0] - brightnessImage(p).rgba[0])).toBeLessThanOrEqual(2);
});
it('finds the busiest tile', () => {
  const p = img(16, 8, (x) => (x >= 8 ? (x % 2 ? [255, 255, 255] : [0, 0, 0]) : [100, 100, 100]));
  expect(busiestTile(p)).toEqual([1, 0]);
});
it('handles a picture smaller than a tile', () => {
  const p = img(5, 3, (x, y) => [x * 40, y * 60, 0]);
  expect(busiestTile(p)).toEqual([0, 0]);
  const t = tileLuma(p, 0, 0);
  expect(t).toHaveLength(64);
  expect(t.every(Number.isFinite)).toBe(true);
  expect(t[7]).toBe(t[4]);            // column 4 repeats past the edge
  expect(tileNumbers(p, 0, 0, 50).every(Number.isInteger)).toBe(true);
});
it('transforms a tile and back', () => {
  const x = Array.from({ length: 64 }, (_, i) => ((i * 37) % 255) - 128);
  idct8(fdct8(x)).forEach((v, i) => expect(v).toBeCloseTo(x[i], 3));
  expect(fdct8(Array(64).fill(16))[0]).toBeCloseTo(128, 3);  // flat tile: all DC (8 × 16)
});
it('rounds a flat tile to its average only', () => {
  const p = img(8, 8, () => [128, 128, 128]);
  expect(tileNumbers(p, 0, 0, 50).every((v) => v === 0)).toBe(true);
});
it('names the strongest patterns', () => {
  const c = Array(64).fill(0); c[0] = 500; c[1] = -40; c[8] = 25; c[9] = 3;
  expect(strongestPatterns(c, 2)).toEqual([{ u: 1, v: 0, amount: -40 }, { u: 0, v: 1, amount: 25 }]);
});
it('counts the zeros', () => {
  const z = [12, 0, 0, 3, -1, 0, 0, 0, 0, 2, ...Array(54).fill(0)];
  expect(countZeros(z)).toEqual({ first: 12, runs: [{ zeros: 2, value: 3 }, { zeros: 0, value: -1 }, { zeros: 4, value: 2 }], end: true });
  expect(countZeros([5, ...Array(63).fill(0)])).toEqual({ first: 5, runs: [], end: true });
  expect(countZeros(Array.from({ length: 64 }, () => 1)).end).toBe(false);
});
```

- [ ] **Step 2: Run the tests and confirm they fail.** From `web/`, run `npx vitest run src/lib/jpeg/__tests__/tour.test.ts src/lib/jpeg/__tests__/tourPictures.test.ts`. Expected: FAIL, because the modules don't exist yet.
- [ ] **Step 3: Implement both modules** with the signatures above.
  - `latestOnly`:
    - holds one `running` flag and one `pending: { arg } | null`;
    - a call while running replaces `pending`;
    - when a run settles, it delivers its result only if `pending` is null, then starts `pending` if set;
    - a rejection is swallowed and counts as settled.
  - `fdct8` is the textbook double sum, `F(u,v) = ¼·C(u)C(v)·Σ f(x,y)·cos((2x+1)uπ/16)·cos((2y+1)vπ/16)` with `C(0) = 1/√2`, so it matches `idct8` in `explain/block.ts`.
- [ ] **Step 4: Run the tests and confirm they pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit**: `git add web/src/lib/jpeg/tour.ts web/src/lib/jpeg/tourPictures.ts web/src/lib/jpeg/__tests__/tour.test.ts web/src/lib/jpeg/__tests__/tourPictures.test.ts && git commit -m "feat(web): tour steps and picture maths"`

### Task 2: `TourVisual.svelte`, one step's picture

**Files:**
- Create: `web/src/lib/components/jpeg/TourVisual.svelte`
- Test: `web/src/lib/components/jpeg/__tests__/TourVisual.test.ts`

**Interfaces:**
- Consumes:
  - everything from Task 1;
  - `VizCore` (`web/src/lib/wasm/loader.ts`), with `jpeg_encode_decode(rgba, w, h, quality, subsampling, huffman): Uint8Array` and `jpeg_encode_stats(...)`, which returns `{ bytes: number; psnr: number }`;
  - `formatBytes` from wherever the lab's readout gets it (grep `formatBytes` under `web/src/lib/jpeg`);
  - `SubsamplingId`, `HuffmanId` (`jpeg/params.ts`).
- Produces: `<TourVisual step={TourStepId} image={RgbaImage | null} quality={number} subsampling={SubsamplingId} huffman={HuffmanId} viz={VizCore | null} />`. Its root is `<figure class="tour-visual" data-step={step}>`. While `image` or `viz` is missing, or the first encode is pending, the root has `aria-busy="true"` and shows the text "Getting the picture ready". Each picture is a `<canvas>` with an `aria-label`. Captions are in `<figcaption>`.

What each step draws. Pictures are scaled to fit, with `image-rendering: pixelated` for the zoomed tile.

| step | draws | caption / text |
|---|---|---|
| split | `brightnessImage` and `colourImage`, side by side, labelled "Brightness" and "Colour" | none |
| share | the original and `shareColour(img, 4)`, labelled "Before" and "Colour shared" | "Exaggerated: colour shared over 4 × 4 pixels (JPEG uses 2 × 2)." |
| tiles | the picture with an 8 × 8 grid drawn over it at true scale (grid lines every 8 picture pixels), and the `busiestTile` outlined | none |
| waves | the busiest tile zoomed (its Y as grey), plus its 4 `strongestPatterns` as small grey wave images, labelled "+", with their amounts rounded | "Four of the waves that make this tile." |
| round | the original and the encode-decode at `quality`, labelled "Before" and "After" | `Quality ${quality} · ${formatBytes(bytes)}` |
| line | the busiest tile's `tileNumbers` at `quality` as a strip of 64 cells; the zero tail is dimmed | `${last + 1} numbers, then ${63 - last} zeros` |
| count | `countZeros` of the same numbers as chips: the first value, then "0 × n, v" for each run, then "end" when `end` | none |
| codes | two bars: the raw size `w × h × 3` and the file size at `quality`, both from `formatBytes` | `${ratio} times smaller` (ratio to 1 decimal) |
| open | the original and the encode-decode at `quality`, labelled "Original" and "Opened JPEG" | `${formatBytes(raw - bytes)} saved` |

- The encode and stats for `round`, `codes` and `open` go through one `latestOnly` runner keyed by `(image, quality, subsampling, huffman)`.
- The encode result is reused across those three steps for the same key: moving between steps doesn't re-encode.
- Canvas drawing guards `getContext('2d')` being null (jsdom).

- [ ] **Step 1: Write the failing tests** with `render` from `@testing-library/svelte`. Use a stub `viz` with `jpeg_encode_decode: vi.fn(rgba => rgba)` and `jpeg_encode_stats: vi.fn(() => ({ bytes: 4096, psnr: 32 }))`, and a 16 × 16 test image.
  ```ts
  it('shows a loading state until the picture and the kit are ready', async () => {
    const { container } = render(TourVisual, { step: 'round', image: null, quality: 50, subsampling: '420', huffman: 'optimized', viz: null });
    expect(container.querySelector('.tour-visual')!.getAttribute('aria-busy')).toBe('true');
    expect(container.textContent).toContain('Getting the picture ready');
  });
  it.each(['split','share','tiles','waves','line','count'])('draws %s without the kit', (step) => { /* image set, viz null: aria-busy false, at least one canvas or chip */ });
  it('labels the exaggerated colour sharing', () => { /* step share: figcaption contains 'Exaggerated' and '4 × 4' */ });
  it('encodes once for round, codes and open at the same settings', async () => {
    /* render round, then rerender codes, then open: jpeg_encode_decode called once; stats once */
    /* round caption 'Quality 50 · 4.0 KB'; codes contains 'times smaller'; open contains 'saved' */
  });
  it('ends on the last quality after a burst of changes', async () => {
    /* make jpeg_encode_stats resolve with bytes = 100 * quality; rerender quality 40, 30, 20 quickly; await settle;
       expect the caption to contain 'Quality 20' and the bytes for 20, and jpeg_encode_decode calls ≤ 2 */
  });
  it('dims the zero tail and counts the zeros', () => { /* step line: dimmed cells + text 'numbers, then'; step count: a chip 'end' */ });
  ```
  Note: the kit is synchronous. `latestOnly` needs a Promise, so wrap the call as `Promise.resolve().then(() => viz.jpeg_encode_decode(...))`. That keeps the burst test meaningful.
- [ ] **Step 2: Run the tests and confirm they fail.** From `web/`, run `npx vitest run src/lib/components/jpeg/__tests__/TourVisual.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `TourVisual.svelte`** as specified. Use the lab's CSS tokens (`var(--…)` as `Overview.svelte` does) and no arrow glyphs.
- [ ] **Step 4: Run the tests and confirm they pass,** and run `npx svelte-check --tsconfig ./tsconfig.json`. Expected: PASS and 0 errors.
- [ ] **Step 5: Commit**: `git add web/src/lib/components/jpeg/TourVisual.svelte web/src/lib/components/jpeg/__tests__/TourVisual.test.ts && git commit -m "feat(web): tour step pictures"`

### Task 3: `JpegTour.svelte`, the dialog, and its cards

**Files:**
- Create: `web/src/lib/components/jpeg/JpegTour.svelte`
- Create: `web/src/lib/jpeg/explain/tour.ts`
- Modify: `web/src/lib/jpeg/explain/targets.ts` (new ids), `web/src/lib/jpeg/explain/index.ts` (dispatch `tour`)
- Modify: `web/src/lib/jpeg/explain/__tests__/coverage.test.ts` (`SAMPLES` entries and the stage mapping for `tour.*`)
- Test: `web/src/lib/components/jpeg/__tests__/JpegTour.test.ts`, `web/src/lib/jpeg/explain/__tests__/tour.test.ts`

**Interfaces:**
- Consumes:
  - Tasks 1 and 2;
  - `TooltipController` and the `tooltip` action (`components/jpeg/tooltip.svelte.ts`);
  - `IMAGES`, `GROUP_LABELS`, `loadPicture`, `decodeUpload` (`jpeg/images.ts`);
  - `loadVizCore` (`wasm/loader.ts`);
  - `STAGES` (`jpeg/stages.ts`).
- Produces:
  - `<JpegTour imageId quality subsampling huffman image ctl onclose />`, with props:
    - `imageId: ImageId | 'upload'`;
    - `image: RgbaImage | null`, the lab's picture, used when `imageId` matches;
    - `quality: number`;
    - `subsampling: SubsamplingId`;
    - `huffman: HuffmanId`;
    - `ctl: TooltipController`;
    - `onclose: (handoff: TourHandoff | null) => void`.
  - Target ids:
    - `{ id: 'tour.step'; step: TourStepId }`;
    - `{ id: 'tour.quality'; quality: number }`;
    - `{ id: 'tour.open' }`. It is registered by Task 4; add its explainer and `SAMPLES` entry here. The coverage test's "registers every id" check will fail for `tour.open` until Task 4, so mark that one id with an `// added in Task 4` skip-list entry that Task 4 removes.
  - Cards (`explain/tour.ts`, `explainTour(t, ctx)`):
    - `tour.step`: title = heading, value = `Step ${n} of 9`, body = the step's `card`, consequence = `${lossy ? 'Loses detail you can't get back.' : 'Nothing is lost here.'} In the lab: step ${n}, ${STAGES title}.`
    - `tour.quality`: title "Quality", value = `${quality}`, body "How hard the fine detail is rounded off.", consequence "Lower means a smaller file and softer edges." (with "Higher keeps more detail." when quality ≥ 90).
    - `tour.open`: title "How JPEG works", value "Nine steps", body "A short walk through how a picture becomes a JPEG, using your picture.", consequence "Takes about a minute."
    - `acts: true` on all three.

Dialog contents and behaviour:
- **Frame:** a backdrop `.tour-backdrop` (fixed, z-index 900) and `div role="dialog" aria-modal="true" aria-labelledby="tour-title"`, with `h2#tour-title` "How a picture becomes a JPEG" and the one-line lede "JPEG throws away what your eye won't miss, then packs what's left tightly."
- **Close:** a close button labelled "Close the tour".
- **Picture:**
  - a `<select aria-label="Tour picture">` with the gallery grouped by `GROUP_LABELS`, plus a "Your picture" option when `imageId === 'upload'`;
  - a "Use your own picture" button wired to a hidden file input (`decodeUpload`).
  - Changing the picture loads it with `loadPicture`; a failure keeps the previous picture and shows the error text in the picture area.
- **Strip:**
  - `<ol class="tour-strip">` of 9 `<button>`s, each with `aria-label` `Step ${n}: ${heading}`, `aria-current="step"` on the current one, the class `lossy` on the lossy ones, and the tooltip `tour.step`; clicking one moves the tour there.
  - After the 9th, a non-interactive `.jpg` end node with the text "file".
  - Under 600 px wide, the strip renders as dots: the same buttons, with their text visually hidden.
- **Panel:**
  - a step label `Step ${n} of 9`, plus ` · loses detail` when lossy;
  - `h3` heading;
  - `p` line;
  - `<TourVisual>`;
  - on `round` only, `<input type="range" min="1" max="100" aria-label="Quality">` with the `tour.quality` tooltip and the value shown beside it;
  - a progress bar of 9 segments (`aria-hidden`).
- **Buttons:**
  - "Skip the tour" calls `onclose(null)`;
  - "Back" is hidden on step 1;
  - "Show me in the lab" calls `onclose({ stage: step.stage, imageId, image, quality })`;
  - "Next", which reads "Start exploring" on step 9 and then calls `onclose({ stage: 'overview', … })`.
  - Hand-offs need a loaded `image`; until then both hand-off buttons are disabled.
- **Keyboard:**
  - The dialog's own `onkeydown` stops propagation of every key event, so the lab's window handler never sees it.
  - Escape calls `onclose(null)`. ArrowLeft/ArrowRight move the step unless the target is an `input` or `select`.
  - Tab and Shift+Tab wrap inside the dialog.
  - On mount, focus moves to the Next button.
- **Swipe:** on `pointerdown`/`pointerup` over the panel with `pointerType !== 'mouse'`, `|dx| > 40` and `|dx| > |dy|` moves the step (left swipe = next).
- **Kit:** `loadVizCore()` is called once on mount, and its result is passed to `TourVisual`.

- [ ] **Step 1: Write the failing tests.**
  - `explain/__tests__/tour.test.ts`:
    - `tour.step` for `round`: value `'Step 5 of 9'`, consequence contains `'Loses detail'` and `'step 5, Quantize'`.
    - `tour.step` for `line`: consequence contains `'Nothing is lost here.'`.
    - `tour.quality` with quality 30: value `'30'`.
    - `tour.open`: non-null.
  - `JpegTour.test.ts` (mock `loadVizCore` and `loadPicture` with `vi.mock`, following `JpegLab.test.ts`):
    - `opens on step 1 with the strip and focus on Next`:
      - the dialog has `aria-modal="true"`;
      - there are 9 strip buttons;
      - the current one is `Step 1: Split brightness from colour`;
      - `document.activeElement` is the Next button.
    - `moves with Next, Back, the strip and the arrow keys`:
      - Next leads to step 2;
      - ArrowRight on the dialog leads to step 3;
      - ArrowLeft goes back;
      - clicking strip button 5 leads to step 5;
      - Back is absent on step 1.
    - `does not move when the arrow is on the slider`: on step 5, ArrowRight on the range input leaves the step at 5.
    - `stops keys reaching the window`: a window keydown spy sees no ArrowRight dispatched inside the dialog.
    - `shows the slider only on step 5 and hands its quality over`:
      - the range is present only on round;
      - set it to 20 and click "Show me in the lab";
      - `onclose` gets `{ stage: 'quantize', quality: 20, imageId: 'spring' }` (plus the image).
    - `Start exploring on the last step lands on the overview`: the last Next button reads "Start exploring", and `onclose` gets `stage: 'overview'`.
    - `Skip, Escape and the close button hand nothing over`: each gives `onclose(null)`.
    - `wraps Tab inside the dialog`: Tab from the last focusable element lands on the first.
    - `changes the picture`: selecting `doge` calls `loadPicture('doge')`, and a hand-off then carries `imageId: 'doge'`.
    - `swipes on touch`: a pointerdown/pointerup pair with `pointerType: 'touch'` and dx −60 moves to the next step; with `pointerType: 'mouse'` it does not.
  - Coverage: add the `SAMPLES` entries `tour.step` → `{ id: 'tour.step', step: 'round' }`, `tour.quality` → `{ id: 'tour.quality', quality: 50 }` and `tour.open` → `{ id: 'tour.open' }`, and map the `tour` prefix in `stageFor` to `'overview'`.
- [ ] **Step 2: Run the tests and confirm they fail.** From `web/`, run `npx vitest run src/lib/components/jpeg/__tests__/JpegTour.test.ts src/lib/jpeg/explain`. Expected: FAIL.
- [ ] **Step 3: Implement** the cards, the target ids, the dispatch and `JpegTour.svelte` as specified. The dialog's styles use the lab's tokens and follow the mockup: an orange `lossy` tag, a highlighted current step, and a dark panel.
- [ ] **Step 4: Run all web tests and svelte-check.** From `web/`, run `npx vitest run && npx svelte-check --tsconfig ./tsconfig.json`. Expected: all pass (the coverage "registers every id" check passes thanks to the `tour.open` skip entry); 0 errors.
- [ ] **Step 5: Commit**: `git add web/src/lib/components/jpeg/JpegTour.svelte web/src/lib/components/jpeg/__tests__/JpegTour.test.ts web/src/lib/jpeg/explain && git commit -m "feat(web): the guided tour dialog and its cards"`

### Task 4: The lab opens the tour, plus the button, the hand-off and the docs

**Files:**
- Modify: `web/src/lib/components/LabShell.svelte` (a `headerAction?: Snippet` prop, rendered beside the `h1` in a `.title-row` flex row that wraps on phones)
- Modify: `web/src/lib/test/LabShellHost.svelte` and `web/src/lib/components/__tests__/LabShell.test.ts` (a test that `headerAction` renders next to the title)
- Modify: `web/src/lib/components/labs/JpegLab.svelte`
- Modify: `web/src/lib/components/__tests__/JpegLab.test.ts`, and every other test file that renders the JPEG lab route: grep `navigate('jpeg'` and `'#/jpeg'` under `web/src`.
- Modify: `web/src/lib/jpeg/explain/__tests__/coverage.test.ts` (remove the Task 3 `tour.open` skip entry)
- Modify: `docs/testing.md` (web test counts), `README.md` (one line in the JPEG lab section, if one exists, about the tour), and `docs/superpowers/specs/2026-10-18-jpeg-lab-tour-design.md` (status: implemented, with an "Implementation notes" section listing any differences).

**Interfaces:**
- Consumes: Task 3's `JpegTour`, `TourHandoff`, and `tourSeen` / `markTourSeen` / `TOUR_SEEN_KEY` from Task 1.
- Produces: the finished feature.

JpegLab changes:
- `let tourOpen = $state(!tourSeen());`
- A `headerAction` snippet with `<button class="btn how" bind:this={howButton} onclick={() => (tourOpen = true)} use:tooltip={{ ctl, target: { id: 'tour.open' }, acts: true }}>How JPEG works</button>`.
- `{#if tourOpen}<JpegTour imageId={imageId} image={image} {quality} {subsampling} {huffman} {ctl} onclose={onTourClose} />{/if}`, placed before `<TooltipHost>`.
- `onTourClose(h)`:
  - `markTourSeen(); tourOpen = false;`
  - if `h`:
    - `quality = h.quality`;
    - if `h.imageId !== imageId || h.imageId === 'upload'`, then `await loadImage(() => Promise.resolve(h.image), h.imageId)`; otherwise `encode()`;
    - `setStage(h.stage)`, and the URL is written as usual;
  - finally `await tick(); howButton?.focus()`.
- `onKey` returns early while `tourOpen`.

- [ ] **Step 1: Write the failing tests.**
  - First, in the existing suites, seed `localStorage.setItem(TOUR_SEEN_KEY, '1')` in `beforeEach`, so that existing tests never see the tour.
  - Then add `describe('the guided tour')` to `JpegLab.test.ts`, which removes the key in its own `beforeEach`:
    - `opens by itself on the first visit and not again`:
      - render and find `role="dialog"` named "How a picture becomes a JPEG";
      - Escape closes it;
      - `localStorage.getItem(TOUR_SEEN_KEY) === '1'`;
      - re-render: no dialog.
    - `reopens from the How JPEG works button and returns focus to it`: with the key set, click "How JPEG works", and the dialog opens; close it, and `document.activeElement` is the button.
    - `Show me in the lab carries the picture and quality`:
      - on the tour, go to step 5 and set the slider to 20;
      - click "Show me in the lab";
      - the dialog is gone, the last push has `quality: 20`, the route query contains `stage=quantize` and `q=20`.
      - Match the lab's actual query keys; read `buildParams` in `jpeg/params.ts`.
    - `Escape leaves the lab as it was`: the lab quality stays 50, and the stage and picture are unchanged.
    - `keys in the tour stay in the tour`: ArrowRight in the dialog doesn't change the route's `stage`.
    - `still opens when storage throws`: make `getItem` throw; the dialog opens; Escape closes it, with no error.
  - In `LabShell.test.ts`: `renders a header action beside the title`.
- [ ] **Step 2: Run the tests and confirm they fail.** From `web/`, run `npx vitest run src/lib/components/__tests__/JpegLab.test.ts src/lib/components/__tests__/LabShell.test.ts`. Expected: FAIL in the new tests only.
- [ ] **Step 3: Implement the LabShell prop and the JpegLab changes** as specified. Remove the coverage skip entry.
- [ ] **Step 4: Run the full validation.**
  - From `web/`: `npx vitest run && npx svelte-check --tsconfig ./tsconfig.json`, then all green, 0 errors.
  - From the root: the cargo trio, also all green.
- [ ] **Step 5: Update the docs** (testing.md counts from the real vitest summary, the README line, and the spec status) and commit: `git add -A web/src docs README.md && git commit -m "feat(web): the JPEG lab opens a guided tour on the first visit"`
