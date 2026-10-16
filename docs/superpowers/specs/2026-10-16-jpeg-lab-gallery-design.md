# JPEG lab: overview screen and picture gallery — Design

Status: implemented, 2026-10-16 (Plan 4, branch `jpeg-lab-gallery`; amended with prototype measurements below). Execution decisions are recorded as Plan 4 amendments 11–19 in the main spec. Extends `2026-10-15-jpeg-lab-design.md`, whose Delivery item 4 listed "the photo"; this design replaces that item. The rest of item 4 (home tile, nav link, README lab entry, the Color stage's Y-only/chroma-only toggles, the five-tile home grid, mobile polish) moves to the plan after this one.

## Intent

A first-time visitor should see what JPEG *did* before they see how. The lab opens on an overview of one picture: the original and the JPEG side by side, how much smaller the file is, and how the bytes are distributed before and after. The picture comes from a small gallery of real photos, internet memes and mathematical extremes. Each picture is chosen because it teaches something about compression. Grand Prismatic Spring replaces the generated gradient as the default.

## Goals

1. **The overview is a new first screen.** It comes before the nine stages and is the stage the lab opens on. It shows:
   - **Before and after:** the original and its JPEG (decoded), side by side. Both use the current quality, chroma and Huffman settings and update live as they change.
   - **Size:** raw bytes against JPEG bytes, as two bars to scale and a ratio (for example "192 KB → 4 KB · 48 : 1").
   - **Byte frequency:** three histograms of byte values 0–255, read left to right as a story, each with its Shannon entropy in bits per byte.
     1. **The raw bytes:** the RGB samples as a file would store them. For a photo they already look nearly random.
     2. **Neighbour differences:** each sample minus the same channel of its left neighbour, mod 256. They pile up around 0: the pattern is hidden in neighbours being alike.
     3. **The JPEG file's bytes:** random-looking again, but far fewer of them.
   - **The gallery:** every picture as a thumbnail on this screen, grouped by kind, with Upload as the last tile.
   - **A way into the steps:** an obvious route into stage 1.
   - **It is step 0 on the rail** ("0 · Overview", before Color). The lab opens there and the arrow keys reach it. The encode is shown finished there, without the scan animation or scan dimming. Moving into stage 1 behaves as today.
2. **The gallery**, in four groups:
   - **Photos:**
     - *Grand Prismatic Spring* (Yellowstone; public domain, Jim Peaco / NPS), for chroma bleed and blocking. **The default picture.**
     - *Space Shuttle Atlantis, STS-135, on pad 39A* (public domain, Bill Ingalls / NASA), for ringing and banding in the night sky.
   - **Memes:**
     - *Doge*: the CC0 recreation "Doge homemade meme.jpg" (Euterpia), built on a public-domain Shiba Inu photo. It is not the Kabosu photo.
     - *"It ain't much, but it's honest work"*: "Farmer meme with apostrophe.jpg", public domain. The text is PD-self by Cakelot1 and the photo is Dianne Johnson / USDA.
     - *An original cartoon meme* made for this repo, so the gallery has the flat-colour, bold-outline, chunky-caption look of cartoon memes. Famous cartoon memes are owned and cannot ship.
   - **Maths:** generated in Rust, like the current built-ins.
     - *Made of cosines*: every 8 × 8 block is one of the DCT's own basis patterns, aligned to the block grid, so each block codes to one or two non-zero coefficients. It is tiny and near-perfect.
     - *Cosines, shifted 4 px*: the same pattern offset by 4 pixels in x and y, so every pattern straddles blocks. It has the same detail and compresses far worse.
     - *Pure noise*: seeded random pixels. There is nothing to squeeze. JPEG still makes the file smaller, but only by destroying the picture: PSNR stays near 12 dB at every quality, even 100.
   - **Artifact tests:** the existing Gradient, Text and Bars, unchanged.
3. **Credits.** Each bundled photo or meme shows its title, author and licence in a small caption on the overview. The same attributions go in the README, and a credits file sits next to the images.

## Non-goals

- The home tile, nav link, README lab entry, Color toggles, five-tile home grid and mobile polish. They come in the next plan. The home tile may keep the gradient.
- Any change to the nine stages beyond what the new default picture and image ids need.
- Server-side anything: the site stays static on GitHub Pages.
- Fetching images from Wikimedia at run time.

## Anti-goals

- Shipping any image whose licence does not allow public redistribution. This includes famous memes that are owned: Success Kid, Distracted Boyfriend, This Is Fine, Pepe, Trollface, Nyan Cat, Grumpy Cat, Disaster Girl and others. The licensing research is in the session scratchpad report `gallery-recon.md`. Its findings are summarised in the licence table the builder writes.
- An overview so busy that the before/after comparison stops being the first thing the eye lands on.
- Slowing the first paint: the default photo must not make the lab noticeably slower to open than the generated gradient does today.

## Constraints

- **Stack:** Rust (`crates/jpeg`, `crates/viz-core`) → WASM → WebGL2, and Svelte 5 + TypeScript (`web/`). Nothing new is added.
- **Bundled images** are static files under `web/public/jpeg/`.
  - They are fetched and decoded by the browser, then pushed through the existing `update_rule_config_with_image` path, the same way as an upload.
  - Each is cropped square, downscaled from the Commons original, and committed losslessly as PNG.
  - Downscaling washes out the originals' own JPEG artifacts, so the lab compresses a clean image.
- **The maths images** are new generators in `crates/viz-core/src/jpeg_images.rs`, next to `gradient`/`text`/`bars`, exposed through `jpeg_builtin_image`. They must be deterministic: the noise uses a fixed seed.
- **Share links** keep working:
  - `img=` takes the new ids.
  - The default image becomes the spring and the default stage becomes the overview. Both are omitted from the link when they are the default.
  - Old links that name gradient, text or bars still load.
- Repo rules: AGENTS.md validation, docs and tests kept in sync, no emoji or arrow glyphs in `.svelte` files, sentence case, PR into protected `main`.

## Decided in the conversation

- The overview is the lab's new first screen.
- Byte frequency means the byte-value histogram, raw vs JPEG.
- The gallery has photos, popular memes and maths images.
- The maths images are one that compresses well and one that compresses badly: cosines and noise, plus the 4-px shifted twist.
- The memes are popular ones only where they are genuinely free to ship (Doge recreation, Honest Work), plus an original cartoon.
- Grand Prismatic Spring is the default picture.
- The overview is step 0 on the rail.
- On every other stage, a compact "Picture" dropdown in the bezel replaces today's row of image buttons. The full thumbnail gallery lives on the overview. Upload stays available in the bezel.

## My calls (for you to check)

- **The original cartoon meme.** Its subject and caption are the builder's to propose. It must be original, with no recognisable owned character. It needs flat colours, black outlines and a white Impact-style caption with a black stroke, and is drawn as an SVG in the repo and rasterised to the committed PNG.
- **Gradient, Text and Bars stay** as an "artifact tests" group. The Decode hints and the test suites rely on them.
- **Bundled pictures keep their framing.** Photos are hand-cropped square at 256 × 256, like the built-ins, so size readouts stay comparable and the scan stays short. Memes keep their full frame so the caption survives, with the long side scaled to 320 px. The pipeline already handles non-square images and partial blocks. Each committed PNG stays under 150 KB.
- **Loading:** only the default picture loads up front. Gallery thumbnails load lazily. Generated pictures are drawn to a small canvas from the kit's RGBA, and bundled ones are the PNGs scaled in CSS.
- **Byte histogram details:**
  - It shows each distribution's Shannon entropy in bits per byte, the maths behind "looks like noise".
  - The raw histogram counts the RGB samples, not alpha.
  - The JPEG histogram counts the whole file, headers included.
- **Doge's caption gets checked before shipping**, since the research didn't read its overlay text. The builder judges it: it must be ordinary Doge-style words with nothing offensive or pointed at a real person. If it fails, the builder recaptions the public-domain base photo `Shiba_inu_taiki.jpg` in Doge style and updates the credits.
- **The cartoon is drawn by a script, not by hand in an SVG.** `scripts/jpeg-gallery/make_cartoon.py` (Pillow) draws flat shapes with bold outlines. It renders the captions "SAVED IT AS JPEG" / "NEEDS MORE JPEG" in Impact, which is installed with macOS, onto a 320 × 240 PNG. Only the PNG ships; no font file is redistributed. The script is committed so the art can be regenerated.
- **The byte histograms are honest.** The JPEG histogram counts the whole file, so header and byte-stuffing spikes show. The entropy number in bits per byte carries the "looks like noise" message. If the headers dominate on tiny files, a "scan data only" toggle may be added; measure this in the prototype.
- **Old links without `img=` now open on the spring** rather than the gradient. That is acceptable for a lab this new. Links that name a picture are unaffected.

## Left to the builder

- The overview's layout:
  - It can reuse the existing panels (`image`, the wipe or decoded view) and DOM slots, or add a `decoded` panel kind.
  - It has to work at desktop and phone widths, with the before/after comparison dominant.
- Thumbnail rendering and the gallery strip's look; it is fine to scale the full PNGs in CSS.
- The exact maths generators (which basis patterns, the quilt arrangement, grey or colour), provided the cosine image codes to about one or two coefficients per block and the shifted version is clearly larger at the default quality. Measure both in the prototype and record the numbers in the plan.
- Image ids and labels.
- How loading a bundled picture shows progress or failure. It should behave like today's built-in/upload loading.

## Prototype measurements (2026-10-16)

All measured at quality 50, 4:2:0, optimized Huffman, with the repo's own encoder, on the prepared pictures.

| Picture | Size | Raw bytes | JPEG | PSNR | H raw | H neighbour diffs | H JPEG (bits/byte) |
|---|---|---|---|---|---|---|---|
| Grand Prismatic Spring | 256 × 256 | 196,608 | 10,283 | 30.3 dB | 7.77 | 5.66 | 7.95 |
| STS-135 | 256 × 256 | 196,608 | 6,973 | 28.9 dB | 7.02 | 4.51 | 7.94 |
| Doge | 272 × 320 | 261,120 | 9,118 | 27.1 dB | 7.61 | 4.81 | 7.94 |
| Honest work | 320 × 203 | 194,880 | 9,912 | 30.5 dB | 7.65 | 5.08 | 7.95 |
| Cartoon meme (original) | 320 × 240 | 230,400 | 11,132 | 28.9 dB | 5.09 | 2.72 | 7.95 |
| Made of cosines | 256 × 256 | 196,608 | 2,461 | 38.4 dB | 7.09 | n/a | 7.39 |
| Cosines, shifted 4 px | 256 × 256 | 196,608 | 17,027 | 25.3 dB | 7.09 | n/a | 7.92 |
| Pure noise | 256 × 256 | 196,608 | 25,317 | 11.8 dB | 8.00 | n/a | 7.95 |

- The shifted cosines are about 7× the aligned ones at the same quality.
- Noise keeps a PSNR of 11.2–12.7 dB from q25 to q100, and its file never exceeds the raw size at 4:2:0.
- The byte frequency of raw photo pixels is already 7.0–7.8 bits per byte, which is why the neighbour-difference histogram was added.
- The prepared PNGs are 100–141 KB each, under the 150 KB budget.
- Doge's caption ("wow.", "many edits", "much wiki", "such neutral" …) passes the check.
