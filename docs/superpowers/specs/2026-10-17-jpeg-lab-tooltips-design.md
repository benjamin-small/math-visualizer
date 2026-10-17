# JPEG lab: explain-everything tooltips — Design

Status: implemented, 2026-10-17. Extends `2026-10-15-jpeg-lab-design.md` and `2026-10-16-jpeg-lab-gallery-design.md`.

## Intent

When someone points at anything in the JPEG lab, the lab should tell them what it is: a number, a cell, a bar, a chip, a pixel or a control. It should say what that thing means for this picture with these settings. The prompt was hovering a DCT coefficient and wanting the actual number explained. Today that only lights the pattern and updates the formula below the canvas. The reader is a layperson, so the first thing they see is plain English. The maths is one click away.

## Goals

1. **Hover shows a compact card** next to the pointer. It has three parts:
   - **the actual value**, for example `F(2,1) = −34.2`;
   - **what it means here, in plain words**, for example "how much of pattern (2, 1) is in this block: two half-waves across, one down; negative means light and dark are swapped";
   - **one line on what the current settings do to it**, for example "At quality 50 it rounds to −3 × 12: kept."
2. **More on demand.** The compact card shows a "More" affordance. Clicking the hovered thing or "More" pins the card in place and unfolds the detailed version. Depending on the element, that is:
   - a small picture of the pattern;
   - the element's share of the whole;
   - the exact arithmetic with this block's numbers;
   - what a different setting would change;
   - the formula with the numbers plugged in.

   A pinned card stays while the pointer moves away. Escape, its close button, or a click elsewhere closes it.
3. **Live:** card text follows the settings. With a card pinned, dragging the quality slider updates its rounding line as you drag. Changing the picture, block, plane or stage closes a card that no longer applies.
4. **Coverage:** the whole JPEG lab, including:
   - every bezel control;
   - the stage rail;
   - the readout;
   - every overview element;
   - every number, cell, bar, chip, curve point and panel on all nine stages;
   - the canvas panels themselves.

   The inventory below is the checklist.
5. **Every input method:**
   - Touch: a tap shows the compact card, and a tap on "More" unfolds it.
   - Keyboard: focusing a control or a focusable cell shows its card, and Enter unfolds it.
   - Screen readers: the compact text is the element's accessible description.

## Non-goals

- The other four labs. They keep their current titles and hovers for now.
- Rewriting the story text, formulas or NOTICE copy under each stage. The cards add to them; they do not replace them.
- New visualisations. The cards explain what is already drawn.

## Anti-goals

- Cards that state the obvious ("This is the quality slider") instead of what it means with these settings. Every compact card must contain either a live number or a consequence of the current settings.
- Jargon in the compact card. "Coefficient", "quantize", "entropy" and "MCU" may appear only after a plain-words explanation, or in the unfolded part.
- Cards that cover the thing being explained, flicker as the pointer crosses cell gaps, or lag behind the pointer.
- Tooltips that slow the lab. Hovering must not trigger an encode. The cards read data the page already has: the summary, the inspect views, the image and the config.

## Constraints

- **Stack:** Svelte 5 + TypeScript over the existing engine. No new dependencies.
- **Data sources:** the existing data only:
  - `rule_summary` (the selected block's samples, DCT, quantized values, table, zigzag, codes and bits; the file size, PSNR and hints);
  - `rule_inspect("tables" | "huffman" | "segments")`;
  - the page's own state (picture, quality, chroma, Huffman, custom tables, stage, hover cell, sweep and re-save data);
  - the image's RGBA.

  Any new engine data needs a separate decision.
- **Canvas hover:** canvas panels are drawn by WebGL, so their hover is hit-tested in the page with the same geometry the overlays already use (`layout.cells`, `blockAt`, panel rects).
- **Copy:** sentence case, no emoji or arrow glyphs in `.svelte` files (a repo test scans them), British spelling as in the rest of the lab ("colour").
- **Tests:** the card text is produced by pure functions that can be unit-tested with fixture data, separate from the card component.

## Decided in the conversation

- Compact card on hover, with a "More" / click-to-unfold detailed version (option A plus unfold).
- The JPEG lab only, for now.
- Written for laypeople.
- **Clicks keep their jobs:**
  - Things that already act on a click keep acting: stage buttons, chips, toggles, hint buttons, Save, Upload, gallery tiles, the Picture select, and the image (which picks a block). Their card unfolds only through its "More" link.
  - Things that do nothing on click pin their card on click: numbers, cells, bars, pixels, curve points, chips that are only labels, and segments.
  - On a phone: tapping a control does its job, and pressing and holding shows its card. Tapping a number, cell, bar or pixel shows its card, and "More" unfolds it.
  - A click elsewhere while a card is pinned closes the card, and that click also does whatever it normally does.

## My calls (for you to check)

- **Hover reuses the current behaviour.** Hovering a DCT or quantization cell still lights its pattern and updates the formula panel. The card is added on top.
- **One pin at a time.** A new pin replaces the old one. While a card is pinned, hovering other things still shows their compact cards as usual, and the pin stays put. That way a pinned card can update live while the quality slider (which has its own hover card) is dragged.
- **Placement:** the card goes beside the pointer and flips to stay on screen. When pinned, it anchors to the element.
- **Replacing titles:** the existing `title=` attributes in the lab move into the card system. Native browser tooltips would otherwise double up.
- **Delay:** cards appear after a short delay (about 150 ms) so that sweeping across a grid doesn't strobe. Once one card is showing, moving to a neighbour updates it immediately.
- **The unfolded part can be long but scrolls.** It never grows past about half the canvas height.

- **The 3D colour cube gets cards for the panel and its axes slider, not per point.** The cube rotates inside the engine, and the page can't tell which point is under the pointer without new engine data, which is out of scope.
- **"What a different setting would change"** uses only what the page can compute without encoding:
  - this block re-rounded at another quality, using the standard scaling formula;
  - sample counts for each chroma mode.

  File sizes and PSNR for other qualities appear only when the R–D curve has already been computed (on the Quantize stage, or cached from a visit there).
- **Delivery and coverage:** it ships as one piece. A test checks every item on the inventory below by id: each DOM target is registered with a card, and each canvas panel kind has a hit-test and a card.

## Inventory (the coverage checklist)

Each item lists what the compact card says. Live values are in angle brackets.

**Bezel and readout**
- **Picture select:** "<picture>: <why it's in the gallery, e.g. vivid colour shows chroma bleed>." More: its size, raw bytes and credit.
- **Upload:** what happens to the picture: it is scaled to fit 512 px and never leaves your browser.
- **Quality:** "<q>: every table entry is scaled by <s>%. Lower means bigger steps, so more numbers round to zero." More: the IJG scaling formula with these numbers, and this picture's size and PSNR at this quality.
- **Chroma 4:4:4 / 4:2:2 / 4:2:0:** "Keeps <100 / 50 / 25>% of the colour detail; brightness is kept in full." More: how many samples that is for this picture.
- **Huffman Optimized / Standard:** "Codes built from this picture's own symbol counts" or "the example tables from the standard", plus the size difference when known.
- **Save .jpg:** the file name and size you will get, and that it opens in any image viewer.
- **Speed:** "<n> blocks per second: the whole picture scans in <t> s."
- **Stage rail entries:** one sentence on what happens to the picture at that step.
- **Readout items:**
  - "<size> of <raw>": this file against the raw pixels.
  - Ratio: "the file is 1/<r> of the raw size".
  - Bits per pixel: what one pixel costs on average.
  - PSNR: how close the copy is, in plain words. Above 40 dB you can't see the difference; below 25 dB it's obvious.
- **Custom tables chip:** that your edited tables override quality, and how to go back.

**Overview**
- **Original / After JPEG pictures:** under the pointer, the pixel's colour before and after, and the difference.
- **Size bars:** raw against file size, with the ratio in words.
- **Histogram bars**, one per byte value:
  - **Raw:** "<n> bytes in the raw pixels have value <v>."
  - **Neighbour differences:** "<n> samples differ from their left neighbour by <±d>."
  - **JPEG:** "<n> bytes of the file have value <v>."
  - More: why the shape matters, the entropy formula with this picture's number, and the 0 / 255 wrap.
- **Entropy figures:** "<h> bits per byte: <how much room for squeezing that means>."
- **Gallery tiles:** the same as the Picture select.

**Stages 1–4**
- **Color:**
  - The cube panel: what the cloud of points is (this picture's colours, placed by their red, green and blue), and where the grey diagonal is.
  - The planes: a pixel's Y, Cb or Cr value and what it stands for.
  - The axes slider: what the rotation shows.
- **Subsample:**
  - A pixel in the full-resolution and the subsampled colour planes: which samples were averaged together under the current mode.
  - The "samples kept" figure.
- **Blocks:**
  - A cell: the sample value, its −128 shifted value, and where it sits in the picture.
  - The Y/Cb/Cr switch: which plane, and that block's position in that plane.
  - The −128 toggle: why the shift happens.
- **DCT:**
  - A coefficient: the worked example above.
  - An atlas pattern: what the pattern looks like in words, and this block's amount of it.
  - The *k* slider: how many patterns are kept and how much of the block's detail that is.
  - The energy curve, at a point: "the first <k> patterns hold <p>% of the detail".
  - The "Why cosines" charts: the values at a point.

**Stages 5–8**
- **Quantize:**
  - A coefficient before rounding: its value.
  - The table cell: "divide by <q>, larger at the high frequencies".
  - A coefficient after rounding: "<v> ÷ <q> = <x> → rounds to <r> (<kept/dropped>)".
  - The rebuilt block's cell: the rebuilt sample and its error.
  - Q-table editor cells: what changing this entry does.
  - R–D curve points: "quality <q>: <bytes>, <psnr> dB".
  - The "you are here" dot.
- **Zigzag:**
  - A grid cell: its zigzag position.
  - A sequence cell: its value and position, and whether it is in the zero tail.
  - The "last non-zero" figure.
- **Run-length:**
  - A token chip: "skip <run> zeros, then <amp> (needs <size> bits)", plus its bits.
  - The DC chip: this block's average minus the previous block's.
  - The bit counts.
- **Huffman:**
  - Table tabs: which symbols each table holds.
  - Histogram bars: "<symbol> appears <n> times; its code is <code> (<len> bits)".
  - Tree leaves: the symbol and its code.
  - The cost line: what "x% over" means.
  - Block bits: which token each run of bits belongs to.
  - Segment bar parts: what each segment holds and its size.

**Decode**
- **Wipe panel:** under the pointer, the original against the decoded pixel.
- **Error map:** the pixel's error before brightening, in levels.
- **Wipe and error sliders:** what they change.
- **Hint buttons:** which block and why it was chosen, with its score.
- **Re-save chart points:** "generation <g>: <psnr> dB".

## Left to the builder

- **Card component structure:** one shared tooltip host per page is suggested, plus a small action or attribute to register a target. Exact positioning maths too.
- **Organisation of the explainer functions:** for example, one module per stage.
- **The exact wording of each card,** within the voice rules above. The DCT example sets the bar.
- **How canvas pixels are read:**
  - The original is the page's RGBA.
  - Decoded values can come from an existing source, such as decoding the current file once per encode with the kit. Hovering must not encode.
  - If decoded pixels are too costly, show the original and the block's error instead, and say so.
- **Order of work.** Suggested: the shared card and the DCT/Quantize stages first, since they prompted this. Then the bezel and readout, then the remaining stages, then the overview, then the canvas panels.

## Implementation notes

Built as designed, with these differences:

- **Hover and focus on a Q-table step differ.** Pointing at a step shows its table card (what it divides by); focusing it to edit shows the editor card (what changing it does). Both are about the same step.
- **Ringing is `aria-disabled`, not `disabled`.** A disabled button gets no pointer or keyboard events, so its card (the picture has no hard edges) could not show. Clicking it still does nothing when there is no block to pick.
- **Hint scores are worked out from the decoded pixels**, in levels, with the same measures the engine picked the blocks by. Until the decoded copy arrives, the hint card omits the score and the pixel cards say the copy is still being decoded.
- **The re-save history lives in the page** (`DecodeTools` binds it up), so a pinned generation card can read it.
- **The energy curve, the "why cosines" chart and the Q-table steps were registered last**, when the coverage test found them unregistered.
- **The cube still has cards only for its panel and its axes slider**, as designed.
