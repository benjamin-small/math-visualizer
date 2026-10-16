# JPEG Lab, Plan 4: overview screen and picture gallery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open the JPEG lab on a new "0 · Overview" stage that shows a picture before and after compression, its size, and three byte histograms. Behind it sits an eleven-picture gallery (photos, memes, maths extremes, artifact tests) with Grand Prismatic Spring as the default.

**Architecture:**
- **Rust:** three new deterministic generators (`cosines`, `cosines-shifted`, `noise`) and two undimmed panel kinds (`original`, `decoded`) for the viz.
- **Static files:** the five prepared pictures are committed under `web/public/jpeg/` with their credits and the scripts that make them.
- **Page:** pure modules (a picture catalog with loading, byte statistics) and an overview stage made of layout, components and wiring. The bezel's image radios become one grouped "Picture" select, and the thumbnail gallery sits under the canvas on the overview.

**Tech Stack:** Rust (`crates/jpeg`, `crates/viz-core`, wasm-bindgen, WebGL2), Svelte 5 + TypeScript, Vitest, wasm-pack in headless Chrome, Python 3 + Pillow for the asset scripts only.

**Spec:** `docs/superpowers/specs/2026-10-16-jpeg-lab-gallery-design.md`, which extends `docs/superpowers/specs/2026-10-15-jpeg-lab-design.md`. Read the gallery design's "Prototype measurements" table: the thresholds below come from it.

## Global Constraints

- **Branch:** `jpeg-lab-gallery`, already created from `main` after PR #40 with the design commits on it. Nothing is pushed until the end; the controller opens the PR after the final review.
- **Validation (AGENTS.md):**
  - `cargo fmt --all --check`
  - `cargo clippy --all-targets --all-features`: no new warnings outside `sierpinski_*`.
  - `cargo test --all-features`
  - `wasm-pack test --chrome --headless --chromedriver=<path> crates/viz-core` (the flag goes before the crate path).
  - `wasm-pack build crates/viz-core --target web --out-dir pkg` after any Rust change the page uses.
  - `cd web && npx vitest run` and `npx svelte-check --tsconfig ./tsconfig.json`
- **Picture ids, used verbatim in Rust, TS and the share link**, in gallery order:
  - photos: `spring`, `shuttle`
  - memes: `doge`, `honest-work`, `cartoon`
  - maths: `cosines`, `cosines-shifted`, `noise`
  - tests: `gradient`, `text`, `bars`
- **Defaults:**
  - `img` is `spring` and `stage` is `overview`. Both are omitted from the link when they are the default.
  - A link without `img=` opens the spring. Links naming any other id are unchanged.
- **Sizes:**
  - Generated pictures are 256 × 256 (`BUILTIN_SIDE`).
  - Bundled pictures are spring and shuttle at 256 × 256, doge at 272 × 320, honest-work at 320 × 203 and cartoon at 320 × 240.
  - Each PNG is at most 150,000 bytes.
- **Bundled files:**
  - They are loaded from `${import.meta.env.BASE_URL}jpeg/<id>.png`, so they work under the GitHub Pages base path, the same way `fourier/font.ts` loads its font.
  - They are never fetched from Wikimedia at run time.
- **Licences** (exact credit lines; they appear on the overview, in `web/public/jpeg/CREDITS.md` and in the README):
  - spring: "Grand Prismatic Spring, Yellowstone" · Jim Peaco, National Park Service · Public domain · https://commons.wikimedia.org/wiki/File:Grand_prismatic_spring.jpg
  - shuttle: "Atlantis (STS-135) on pad 39A" · Bill Ingalls, NASA · Public domain · https://commons.wikimedia.org/wiki/File:Brightly_lit_STS-135_on_launch_pad_39a.jpg
  - doge: "Doge (homemade)" · Euterpia, after a photo by Roberto Vasarri · CC0 · https://commons.wikimedia.org/wiki/File:Doge_homemade_meme.jpg
  - honest-work: "It ain't much, but it's honest work" · Cakelot1, photo by Dianne Johnson, USDA NRCS · Public domain · https://commons.wikimedia.org/wiki/File:Farmer_meme_with_apostrophe.jpg
  - cartoon: "Needs more JPEG" · made for this project · CC0
- **Copy:** sentence case. No emoji or arrow glyphs in `.svelte` files (a repo test scans them); glyphs go in `.ts`. Doc comments on every pub Rust item and exported TS item, with comment density like the neighbours. Conventional commits.
- **wasm-bindgen:** `None` crosses as `undefined`, so parse with `== null`.

## Review Focus

1. **A bundled picture fails to load** (404, offline, or a wrong base path). The current picture stays, an inline error says why, and the Picture select shows the picture in use. Task 5: `keeps the current picture when a bundled one fails to load`.
2. **The site is served under `/math-visualizer/`.** Picture URLs must carry the base path. Task 4: `builds picture URLs from BASE_URL`.
3. **Non-square pictures** (272 × 320, 320 × 240, 320 × 203):
   - The overview fits both panels without distortion.
   - The byte statistics count `w·h·3` samples.
   - A shared `b=` is clamped to that picture's own block grid.
   - Tests: Task 4's `neighbourDiffs` on a 3 × 2 image, and Task 5's `clamps a shared block to the honest-work grid` (40 × 26 blocks, so `b=50,50` becomes `39,25`).
4. **Old share links:** `img=gradient&stage=dct&b=12,7` still opens the gradient on DCT with that block. A link with no `img=` opens the spring on the overview. Task 5: `still opens an old gradient link` and `opens the spring overview by default`.
5. **Changing picture from a deep stage** (Huffman, through the Picture select) keeps the stage, re-encodes, and writes `img=` into the link. Task 5: `changes picture from the Huffman stage`.

---

## Task 1: Maths pictures in Rust

**Files:**
- Modify: `crates/viz-core/src/jpeg_images.rs`: the generators plus a `mod tests` block.

**Interfaces:**
- Produces:
  - `GENERATED_IMAGES == ["gradient", "text", "bars", "cosines", "cosines-shifted", "noise"]`.
  - `builtin_image("cosines" | "cosines-shifted" | "noise", w, h)`.
  - The kit's existing `jpeg_builtin_image(id, w, h)` serves the new ids unchanged.

- [ ] **Step 1: Write the failing tests** in `jpeg_images.rs`'s test module. All use 256 × 256 and the encoder from `jpeg::codec` with `Options { quality: 50, subsampling: Subsampling::S420, huffman: HuffmanMode::Optimized, ..Options::default() }`.

```rust
#[test]
fn the_generated_list_names_every_picture() {
    assert_eq!(GENERATED_IMAGES, ["gradient", "text", "bars", "cosines", "cosines-shifted", "noise"]);
    for id in GENERATED_IMAGES { assert!(builtin_image(id, 16, 16).is_some(), "{id}"); }
}

#[test]
fn every_cosine_block_quantizes_to_at_most_two_numbers() {
    // Luma of each 8×8 block → level shift → fdct → quantize with scale_table(&STD_LUMA, 50):
    // at most 2 non-zero values, and when (u, v) = (bx % 8, by % 8) ≠ (0, 0) one of them sits at u + 8v.
}

#[test]
fn shifting_the_cosines_by_four_pixels_costs_at_least_five_times_the_bytes() {
    // bytes(cosines-shifted) >= 5 * bytes(cosines)   (prototype: 17,027 vs 2,461)
}

#[test]
fn noise_is_seeded_and_does_not_survive_compression() {
    // builtin_image("noise", 256, 256) == builtin_image("noise", 256, 256)
    // byte entropy of its RGB samples > 7.99 bits
    // PSNR(decode(encode(noise, q))) < 15 dB for q in [50, 90, 100]   (prototype: 11.8–12.7)
}
```

  Use `jpeg::color::rgb_to_ycbcr`, `jpeg::blocks::level_shift`, `jpeg::dct::fdct`, `jpeg::quant::{scale_table, quantize, STD_LUMA}` and `jpeg::metrics::psnr`. A local `entropy(&[u8]) -> f64` helper in the test module is fine.

- [ ] **Step 2: Run** `cargo test -p viz-core jpeg_images`. Expected: FAIL. The list has 3 entries, and the new ids return `None`.

- [ ] **Step 3: Implement the generators** (same `fn(x, y, w, h) -> [u8; 3]` shape as `gradient_px`).
  - **`cosines_px`:** block `(bx, by) = (x / 8, y / 8)` carries the DCT basis pattern `(u, v) = (bx % 8, by % 8)` on a constant teal tint.

    ```rust
    let c = |k: usize, n: usize| (PI * (2 * n + 1) as f32 * k as f32 / 16.0).cos();
    let l = 128.0 + 90.0 * c(u, x % 8) * c(v, y % 8);
    to_px([l - 40.0, l + 10.0, l + 25.0])
    ```

  - **`cosines-shifted`:** `cosines_px(x + 4, y + 4, w, h)`.
  - **`noise_px`:** `let r = splitmix64(0x4A50_4547 ^ (y * w + x) as u64); [r as u8, (r >> 8) as u8, (r >> 16) as u8]`. Doc comments say what each one teaches.

- [ ] **Step 4: Run** `cargo test -p viz-core jpeg_images` (PASS), then `cargo test --all-features`.

- [ ] **Step 5: Lint and commit.** `cargo fmt --all`, plus the clippy filter.

  ```bash
  git commit -m "feat(jpeg): maths pictures — cosines, cosines shifted and noise"
  ```

---

## Task 2: Undimmed `original` and `decoded` panels

**Files:**
- Modify: `crates/viz-core/src/visualizations/jpeg.rs` (the panel `match` near `"image" | "image_grid"`, and the module doc's panel-kind list) and `crates/viz-core/tests/jpeg_lab.rs`.

**Interfaces:**
- Consumes: the existing `Textures { original, decoded, … }` and `TextureQuad::draw(gl, &tex, rect, canvas, dim)`.
- Produces: panel kinds `original` (the original at full brightness) and `decoded` (the whole decoded image at full brightness). Neither depends on the scan position; Task 5 pushes them on the overview.

- [ ] **Step 1: Write the failing test.** In `jpeg_lab.rs` `every_panel_kind_renders_without_a_gl_error`, add `{"kind":"original","rect":[0,300,80,80]}` and `{"kind":"decoded","rect":[80,300,80,80]}` to the panel list.

  Add a new browser test, `original_and_decoded_panels_ignore_the_scan`. With the engine at `JumpTo 0` (nothing scanned), render one `decoded` panel filling a 64 × 64 canvas. Read back the centre pixel with `gl.read_pixels`. It must not be dark: its brightness must exceed the `dim × 255` level an unscanned `image` panel would give. Then render an `image` panel the same way and assert the centre pixel is the dimmed one. Tolerances: ±3 per channel.

- [ ] **Step 2: Run** `wasm-pack test … crates/viz-core --test jpeg_lab`. Expected: FAIL (the new test).

- [ ] **Step 3: Implement the two arms:** `quad.draw(gl, &tex.original | &tex.decoded, rect, canvas, 1.0)`. Update the module doc's kind list.

- [ ] **Step 4: Run** the browser tests (`jpeg_lab` 8 passed) and `cargo test -p viz-core`. Then rebuild the pkg.

- [ ] **Step 5: Lint and commit.**

  ```bash
  git commit -m "feat(jpeg): undimmed original and decoded panels"
  ```

---

## Task 3: The bundled pictures, their scripts and credits

The four Commons originals are in this session's scratchpad (`gallery-src/`), downloaded with the user's permission. The prepared PNGs (`gallery-out/*.png`) and the two scripts are there too:

`/private/tmp/claude-501/-Users-bsmall-dev-math-visualizer/9f5e6f00-2b13-4952-8009-b31a54f0fe14/scratchpad/`

**Files:**
- Create:
  - `web/public/jpeg/{spring,shuttle,doge,honest-work,cartoon}.png`, copied from `gallery-out/`
  - `web/public/jpeg/CREDITS.md`
  - `scripts/jpeg-gallery/make_gallery.py` and `scripts/jpeg-gallery/make_cartoon.py`, copied from the scratchpad
  - `scripts/jpeg-gallery/README.md`
- Modify: `README.md` (an "Image credits" section, plus `web/public/jpeg/` in the project layout).

- [ ] **Step 1: Copy the files and check them.** Copy the five PNGs and the two scripts. Run `python3 -c` with Pillow to print each PNG's size; expect spring 256×256, shuttle 256×256, doge 272×320, honest-work 320×203, cartoon 320×240. `ls -l` must show every PNG ≤ 150,000 bytes. Look at each one and confirm it is the expected picture: the pool, the shuttle, Doge with its wiki captions, the farmer, and the orange blob holding a blocky photo.

- [ ] **Step 2: Write the credits.** `CREDITS.md` has one entry per picture with exactly the credit lines from Global Constraints. It adds that the four Commons pictures were cropped and scaled, and names the crop boxes from `make_gallery.py`. `scripts/jpeg-gallery/README.md` says how to regenerate the pictures:
  - Download the four originals from the URLs in CREDITS.
  - Run `python3 make_gallery.py <src-dir> <out-dir>`.
  - Run `python3 make_cartoon.py <out.png> <Impact.ttf>`. The font is only used to render the PNG and is never committed.

  The README gets the same credit lines under "Image credits".

- [ ] **Step 3: Commit.**

  ```bash
  git add web/public/jpeg scripts/jpeg-gallery README.md
  git commit -m "feat(web): JPEG lab gallery pictures with credits and the scripts that make them"
  ```

---

## Task 4: The picture catalog and byte statistics (pure modules)

These changes alter no behaviour on the page: defaults and stages are untouched until Task 5.

**Files:**
- Create: `web/src/lib/jpeg/bytes.ts`, `web/src/lib/jpeg/__tests__/bytes.test.ts`, `web/src/lib/jpeg/__tests__/images.test.ts`
- Modify: `web/src/lib/jpeg/images.ts`, `web/src/lib/jpeg/params.ts` (the `ImageId` union and `IMAGE_IDS` only; `DEFAULTS` is untouched)

**Interfaces:**
- Produces, for Task 5:
  - **`params.ts`:**
    - `ImageId` is the union of the eleven ids.
    - `IMAGE_IDS` lists them in gallery order.
    - `DEFAULTS.img` stays `'gradient'` until Task 5.
  - **`images.ts`:**
    - `export type PictureGroup = 'photos' | 'memes' | 'maths' | 'tests'`
    - `export const GROUP_LABELS: Record<PictureGroup, string>`: "Photos", "Memes", "Maths", "Artifact tests".
    - `export interface Credit { title: string; author: string; licence: string; url?: string }`
    - `IMAGES: readonly { id: ImageId; label: string; title: string; group: PictureGroup; file?: { w: number; h: number }; credit?: Credit }[]` covers all eleven in gallery order. `file` is set exactly for the five bundled pictures.
    - `export function pictureUrl(id: ImageId): string` returns `${import.meta.env.BASE_URL}jpeg/${id}.png`.
    - `export async function loadPicture(id: ImageId): Promise<RgbaImage>`: for a bundled id it fetches `pictureUrl`, rejects on a non-OK response with a reader-facing message, and decodes through `decodeUpload`. For a generated id it uses `loadBuiltin`.
    - `export async function thumbnail(id: ImageId, side: number): Promise<string>`: for a bundled id it returns `pictureUrl(id)`. For a generated id it returns a PNG data URL drawn from `jpeg_builtin_image(id, side, side)` on a canvas.
  - **`bytes.ts`:**
    - `rgbSamples(rgba: Uint8Array): Uint8Array` drops every 4th byte.
    - `neighbourDiffs(rgba: Uint8Array, w: number, h: number): Uint8Array` gives each RGB sample minus the same channel of its left neighbour, mod 256. The first column subtracts 0. The length is `w·h·3`.
    - `histogram(bytes: Uint8Array): Uint32Array` has 256 bins.
    - `entropyBits(hist: Uint32Array): number` is the Shannon entropy in bits per byte (0 for an empty histogram).

- [ ] **Step 1: Write the failing tests.**

```ts
// bytes.test.ts
it('drops alpha', () => expect([...rgbSamples(new Uint8Array([1,2,3,255, 4,5,6,255]))]).toEqual([1,2,3,4,5,6]));
it('takes neighbour differences per channel, wrapping mod 256', () => {
  // 3×2 image; row 0: (10,20,30) (12,20,25) (12,250,25); row 1: (0,0,0) (255,1,1) (0,0,0)
  expect([...neighbourDiffs(rgba, 3, 2)]).toEqual([10,20,30, 2,0,251, 0,230,0, 0,0,0, 255,1,1, 1,255,255]);
});
it('counts bytes', () => expect(histogram(new Uint8Array([0,0,7]))[0]).toBe(2));
it('measures entropy', () => {
  expect(entropyBits(histogram(new Uint8Array(64).fill(9)))).toBe(0);
  expect(entropyBits(histogram(new Uint8Array([0,1,0,1])))).toBeCloseTo(1);
  expect(entropyBits(histogram(Uint8Array.from({ length: 256 }, (_, i) => i)))).toBeCloseTo(8);
  expect(entropyBits(new Uint32Array(256))).toBe(0);
});
// images.test.ts
it('lists the eleven pictures in gallery order and groups', /* ids === IMAGE_IDS; groups photos×2, memes×3, maths×3, tests×3 */);
it('has a credit for every bundled picture and none for generated ones');
it('builds picture URLs from BASE_URL', () => { vi.stubEnv('BASE_URL', '/math-visualizer/'); expect(pictureUrl('spring')).toBe('/math-visualizer/jpeg/spring.png'); });
it('ships every bundled picture at its catalog size and under 150 KB', /* read web/public/jpeg/<id>.png with node:fs; size <= 150_000; IHDR width/height (bytes 16–23, big-endian) === file.w/h */);
it('rejects a bundled picture that cannot be fetched', /* stub fetch → { ok: false, status: 404 }; loadPicture('spring') rejects with a message naming the picture */);
```

- [ ] **Step 2: Run** `cd web && npx vitest run src/lib/jpeg`. Expected: FAIL (missing exports).

- [ ] **Step 3: Implement** to the interfaces above. The label and title strings are free text: short, sentence case, saying what each picture shows off. For example, spring: "Grand Prismatic Spring", title "Vivid colour: watch chroma bleed". cosines-shifted: "Cosines, shifted 4 px", title "Same detail, off the 8 × 8 grid".

- [ ] **Step 4: Run** `npx vitest run` (the whole suite stays green: the page still renders its radios from `IMAGES`) and svelte-check.

- [ ] **Step 5: Commit.**

  ```bash
  git commit -m "feat(web): picture catalog with bundled loading, and byte statistics"
  ```

---

## Task 5: The overview stage, the gallery and the Picture select

**Files:**
- Create:
  - `web/src/lib/components/jpeg/Overview.svelte`: sizes and the three histograms, drawn in the `stats` slot.
  - `web/src/lib/components/jpeg/Gallery.svelte`: the thumbnail grid, shown under the canvas in the stage card on the overview.
- Modify:
  - `web/src/lib/jpeg/{stages,params,layout,formulas}.ts`
  - `web/src/lib/components/labs/JpegLab.svelte`
  - tests: `params.test.ts`, `layout.test.ts`, `summary.test.ts` (NOTICE/stageTex), `JpegLab.test.ts`

**Interfaces:**
- Consumes:
  - Task 1's ids through `loadPicture`.
  - Task 2's panel kinds `original` and `decoded`.
  - Task 4's catalog, `loadPicture`, `thumbnail` and byte statistics.
  - `api.engine.rule_bytes()` for the JPEG file.
- Produces:
  - **`stages.ts`:** `StageId` gains `'overview'`, first in `STAGES` with `{ mark: '0', title: 'Overview', subtitle: 'What JPEG did to this picture', ready: true }`. `DEFAULT_STAGE = 'overview'`.
  - **`params.ts`:** `DEFAULTS.img = 'spring'`.
  - **`layout.ts`:**
    - `PanelKind` gains `'original' | 'decoded'`, and `SlotName` gains `'stats'`.
    - The `overview` case lays out a top band (58% of the height after margins) of two equal columns: `original` ("Original") and `decoded` ("After JPEG").
    - Each is fitted to the picture's shape.
    - `slots.stats` takes the full width below.
    - `layout.image` is the `original` rect, so a click still picks a block.
    - At phone widths the same structure applies.
  - **`formulas.ts`:**
    - `NOTICE.overview` is free text in the style of the others. It covers the three histograms: raw bytes look random, neighbours give the pattern away, and the JPEG's bytes look random again but there are far fewer.
    - `stageTex('overview')` returns `[ENTROPY_TEX]`, with `export const ENTROPY_TEX = String.raw\`H = -\sum_{b=0}^{255} p_b \log_2 p_b \;\text{bits per byte}\``.
  - **`Overview.svelte`** props: `{ rect, image: RgbaImage, jpeg: Uint8Array | null, quality: number, credit?: Credit }`. It shows:
    - Two size bars to scale, raw `w·h·3` against JPEG length, labelled with `formatBytes` and the ratio.
    - Three 256-bin histograms (SVG): "Raw bytes", "Neighbour differences" and "JPEG file", each headed by `entropyBits` to two decimals and "bits / byte".
    - A one-line caption.
    - The credit line with a link when `credit` is set.
    - The histograms are recomputed only when `image` or `jpeg` changes.
  - **`Gallery.svelte`** props: `{ current: ImageId | 'upload', onpick: (id: ImageId) => void, onupload: () => void }`. It shows:
    - One labelled group per `PictureGroup` (`GROUP_LABELS`).
    - A button per picture with its thumbnail (`thumbnail(id, 64)`, `loading="lazy"` for files) and label, with `aria-pressed` on the current one.
    - An Upload tile at the end.
  - **`JpegLab.svelte`:**
    - The radio group becomes `<select aria-label="Picture">` with an `<optgroup>` per group, plus an "Uploaded picture" option shown only while an upload is in use. Upload stays as a button.
    - On load failure the select returns to the picture in use.
    - Pictures load through `loadPicture`.
    - On the overview it pushes the `original` and `decoded` panels, renders `Overview` in `slots.stats` with `jpeg = api.engine.rule_bytes()` (re-read when `summary.version` changes), and renders `Gallery` in the story snippet above "How it works".
    - The stage card shows an obvious "Step 1: Color" button that calls `setStage('color')`.

- [ ] **Step 1: Write and update the tests.**
  - **`params.test.ts`:** ten stages with `overview` first; `readyStage(undefined) === 'overview'`; `stepStage('color', -1) === 'overview'`; `parseParams('').img === 'spring'`; `buildParams(DEFAULTS) === ''`.
  - **`layout.test.ts`:** add `'overview'` to the stage matrix (panels and slots on the stage, no overlaps). Add `overview places original and decoded side by side above the stats slot`: equal heights, `decoded.x > original.x + original.w`, and `stats.y >= original.y + original.h`. Add `overview fits a non-square picture without distortion`: for 320 × 203, `rect.w / rect.h` is within 1% of 320/203.
  - **`summary.test.ts`:** the NOTICE loop already covers every stage; add `stageTex('overview', s, null)[0] === ENTROPY_TEX`.
  - **`JpegLab.test.ts`:**
    - `vi.mock('../../jpeg/images', …)`: keep the real catalog and make `loadPicture(id)` resolve to a solid image of the catalog size (`file` size, or 256 × 256) for every id. Existing tests that click picture radios now use `fireEvent.change(getByLabelText('Picture'), { target: { value: 'text' } })`.
    - `opens the spring overview by default`: the first push has `image_id: 'spring'` at 256 × 256. The viz panels include `original` and `decoded`. The stats show three histogram headings and a ratio. The gallery shows 11 picture buttons plus Upload.
    - `still opens an old gradient link`: `img=gradient&stage=dct&b=12,7` pushes `image_id: 'gradient'`, `select_block` (12, 7), stage `dct`.
    - `changes picture from the Huffman stage`: from `stage=huffman`, select `doge`. The push has `image_id: 'doge'` at 272 × 320, the stage stays `huffman`, and the link has `img=doge&stage=huffman`.
    - `clamps a shared block to the honest-work grid`: `img=honest-work&stage=blocks&b=50,50` gives `select_block` (39, 25).
    - `keeps the current picture when a bundled one fails to load`: make the next `loadPicture` reject. The alert shows the message, no new push happens, and the select's value is still the old id.
    - `picks a picture from the gallery`: clicking the "Made of cosines" thumbnail pushes `image_id: 'cosines'`.
    - `steps from the overview into the pipeline`: "Step 1: Color" sets `stage=color`, and ArrowLeft from color returns to the overview.
    - Update existing tests that assumed `gradient` or `color` defaults so they name what they need (`img=gradient`, `stage=color`) instead of relying on defaults.

- [ ] **Step 2: Run** `cd web && npx vitest run`. Expected: FAIL on the new and updated assertions.

- [ ] **Step 3: Implement** stages, params, layout, formulas, `Overview.svelte`, `Gallery.svelte` and the `JpegLab.svelte` wiring to the interfaces above.
  - The histogram bars are plain SVG `<rect>`s scaled to the tallest bin, in the lab's dark overlay style. The accent colour is for the JPEG one.
  - Reuse `formatBytes`.
  - No glyph arrows in `.svelte` files.

- [ ] **Step 4: Run** `npx vitest run` (all green), `npx svelte-check` (0 errors) and the no-emoji test.

- [ ] **Step 5: Commit.**

  ```bash
  git commit -m "feat(web): JPEG lab overview — before/after, sizes, three histograms, gallery and Picture select"
  ```

---

## Task 6: Spec amendment, docs, validation and the browser check

**Files:**
- Modify:
  - `docs/superpowers/specs/2026-10-15-jpeg-lab-design.md`: a Plan 4 amendment.
  - `docs/superpowers/specs/2026-10-16-jpeg-lab-gallery-design.md`: mark it implemented.
  - `docs/testing.md`: counts.
  - `README.md`: the lab's picture list, if it has one.

- [ ] **Step 1: Amend the main spec.**
  - Add `## Amendment (Plan 4, 2026-10-16)`. It points to the gallery design and lists, as decisions:
    - the overview as stage 0;
    - the eleven picture ids and the spring default;
    - the Picture select;
    - the three histograms;
    - the `original` and `decoded` panels;
    - the maths pictures;
    - bundled PNGs under `web/public/jpeg/`;
    - Delivery item 4 now split: this gallery, then the home tile, nav link, README lab entry, Color toggles, five-tile home grid and mobile polish in the next plan.
  - Update the body:
    - built-in images;
    - share link defaults;
    - the stage list gains "0. Overview".

- [ ] **Step 2: Docs.** Put measured counts into `docs/testing.md`, and add the byte-statistics and catalog modules to its web sentence.

- [ ] **Step 3: Full validation.** Run every command in Global Constraints' validation list. All are green.

- [ ] **Step 4: Commit** `docs: JPEG lab gallery — spec amendment and test counts`.

- [ ] **Step 5 (controller): Look at it.**
  - Start the `web` dev server.
  - Capture `#/jpeg` (the default) plus `#/jpeg?img=<id>` for every one of the eleven ids, at 1440 and 375 px, light and dark, with the capture script.
  - Check headless against the real engine:
    - the spring loads from `/jpeg/spring.png`;
    - the three entropies read about 7.77 / 5.66 / 7.95 at q50;
    - cosines against shifted are about 2.5 KB against 17 KB;
    - noise PSNR is about 12 dB;
    - the gallery switches pictures;
    - the select works from a deep stage.
