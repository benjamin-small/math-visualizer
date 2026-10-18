# JPEG lab: the guided tour — Design

Status: implemented, 2026-10-18. Extends `2026-10-15-jpeg-lab-design.md`, `2026-10-16-jpeg-lab-gallery-design.md` and `2026-10-17-jpeg-lab-tooltips-design.md`.

## Intent

The JPEG lab is detailed. To an average visitor it is overwhelming, and they may not grasp what each numbered step is for. The tour gives them the whole story first, in everyday words: **JPEG throws away what your eye won't miss, then packs what's left tightly.** It walks through the nine steps one at a time, showing the visitor's chosen picture going through each one. After the tour, the lab's numbered steps become the "show me how" for each part.

## Goals

1. **Opens by itself on the first visit** to the JPEG lab, as a dialog over the lab. A **"How JPEG works"** button in the lab reopens it at any time.
2. **A guided tour, one step at a time** (option B from the mockups):
   - **Flow strip:** a small flow chart across the top shows all nine steps and the .jpg file at the end. The current step is highlighted. The two steps that lose detail (2 and 5) are marked in orange, and the others read as "nothing lost".
   - **Step panel:** below the strip, a picture and a short text for the current step.
   - **Navigation:** Back, Next and a progress bar.
   - **Exits:** "Show me in the lab" opens that step in the lab, and "Skip the tour" closes the dialog.
3. **Short text.** Each step has a heading of a few words and **at most two short sentences**. Anything more goes in a hover card, using the lab's existing card system. Hovering a box in the flow strip shows its one-line summary, and clicking it moves the tour to that step.
4. **The visitor's own picture.** The tour has a picture picker with the same gallery as the lab, including uploads. Each step shows that picture going through the step. Changing the picture redraws the current step.
5. **One control: a quality slider on step 5** (round off fine detail). Dragging it updates the "after" picture and the file size. The other steps are look-and-read only.
6. **"Show me in the lab" carries the tour's picture and quality into the lab.** It closes the tour on that step's stage, and the lab opens on what the visitor was looking at.

## Non-goals

- Changing the lab's numbered stages, the existing 0 · Overview stage, or the card text. The tour sits in front of them; it does not replace them.
- The other four labs.
- New engine features. The tour uses what the WASM kit and the page already provide (see Constraints).

## Anti-goals

- **Too much text.** If a step needs a paragraph to explain, the step is wrong, not the word limit. Never more than two short sentences on screen per step.
- **Jargon on screen.** Words like DCT, quantize, chroma, Huffman and coefficient don't appear in the tour's step text or headings. A hover card may name the lab's term ("In the lab this is step 5, Quantize").
- **Pictures that show nothing.** If a real setting makes a step's change invisible, exaggerate it and label it (for example, "colour shown at a quarter of its detail", or "at quality 10").
- **A tour that blocks.** It never reappears by itself after the first time it is closed, however it was closed. It never stops the lab loading behind it.

## The nine steps

The headings and one-liners below are the intended voice. The builder may polish the wording within the limits above.

| # | Heading | On screen (one line, plus the picture) | Picture |
|---|---|---|---|
| 1 | Split brightness from colour | Your eye notices brightness far more than colour. | The picture's brightness beside its colour |
| 2 | Shrink the colour *(loses detail)* | Neighbouring pixels share one colour; you barely notice. | Before and after the colour is shared (exaggerated if needed) |
| 3 | Cut into tiles | The picture is cut into 8 × 8 squares. | The picture with the tile grid over it, one tile highlighted |
| 4 | Describe each tile as waves | Smooth tiles need a few waves; busy ones need many. | One tile zoomed, with the handful of wave patterns that make it |
| 5 | Round off fine detail *(loses detail)* | Faint waves round to zero; this is the big saving. | Before and after at the slider's quality, with the file size |
| 6 | Line the numbers up | The zeros end up together at the end. | One tile's numbers in their new order, the zero tail visible |
| 7 | Count the zeros | "Five zeros, then a 3" is shorter than writing them out. | The same numbers written as counts |
| 8 | Short codes for common things | Like Morse code: frequent things get the shortest codes. | Size bar, raw pixels down to the file |
| 9 | Open it again | Your viewer undoes every step to show the picture. | The opened JPEG beside the original, with the size saved; the last button reads "Start exploring" |

Steps 6–8 don't change the picture, and that is the point: nothing is lost there.

## Constraints

- **Stack:** Svelte 5 and TypeScript on the existing page, with no new dependencies. The repo's copy rules apply: sentence case, British spelling, and no emoji or arrow glyphs in `.svelte` files (a test scans for them).
- **Data comes only from what exists:**
  - the WASM kit: `jpeg_encode_decode` and `jpeg_encode_stats` for whole-picture results at any quality; `jpeg_fdct`, `jpeg_quantize`, `jpeg_to_zigzag` and `jpeg_ac_symbols` for one tile; `jpeg_rgb_to_ycbcr`;
  - the image loaders in `images.ts`;
  - the page's own state.

  Any new engine data needs a separate decision.
- **Remembering the first visit:** `localStorage`, read and written inside try/catch. If storage is unavailable, the tour must still work: it opens on load, and closing it works for that page view.
- **Accessibility:**
  - It is a real modal dialog: focus moves in, Escape closes it, and focus returns to the "How JPEG works" button or the lab.
  - The arrow keys move between steps.
  - The flow strip boxes are buttons with names.
- **Phones:** the strip becomes a row of dots, the picture sits above the text, and swiping or the Next button moves on. No horizontal page scroll.
- **Performance:** dragging the slider doesn't queue encodes. At most one encode runs at a time, and the latest value wins. Encoding a 512 px picture is fast enough for this; a short trailing delay is fine.
- **Tests:**
  - The tour's step content is pure data, unit-tested: nine steps; each has a heading and at most two sentences; no jargon word in the on-screen text.
  - Component tests against the fake engine: first-visit opening, closing and reopening, keyboard, the picture picker, the slider, and the hand-off to the lab.

## Decided in the conversation

- Option B, the guided tour (not the whole-map-at-once option).
- Opens on the first visit; afterwards a button reopens it.
- A popup dialog over the lab is fine.
- The visitor selects a picture, and the tour shows that picture going through each step.
- A quality slider on step 5.
- Keep each step short.

## My calls (for you to check)

- **Where the button goes:** "How JPEG works" sits in the lab's header, next to the title, so it is easy to find and doesn't crowd the controls.
- **First visit means the first time this browser opens the JPEG lab**, including from a shared link. Closing the tour by any route counts as seen.
- **The tour starts on the lab's current picture**, so on a first visit that is the default, Grand Prismatic Spring. Its picker changes the tour's picture; "Show me in the lab" also changes the lab's.
- **Closing with "Skip the tour" or Escape leaves the lab's picture and quality as they were.** Only "Show me in the lab" and "Start exploring" carry the tour's picture and quality over.
- **Exaggerated pictures are labelled** on the picture itself, in one short caption.
- **Hover cards in the tour** use the existing tooltip host. The flow strip boxes and the step 5 slider get cards; the step text itself doesn't need them.
  - The tour is mounted inside the lab and shares the lab's tooltip controller.
  - It is a custom modal overlay (`role="dialog"`, `aria-modal="true"`, a focus trap) rather than a native `<dialog>`, so the cards can draw above it.
  - The new card ids are added to `explain/` like any other target. The "card text unchanged" non-goal covers only the existing cards.
- **The tour's settings follow the lab, except quality:**
  - It encodes with the lab's current colour mode and Huffman setting, but always with the standard tables at the slider's quality.
  - The slider starts at the lab's quality (50 on a first visit).
  - The hand-off sets only the picture and the quality. If the lab has custom tables, they stay, and the lab's own custom-tables chip says they override quality.
- **Where each exit lands:**
  - "Show me in the lab" opens the stage matching the current step; step 9 opens the Decode stage.
  - "Start exploring" on the last step opens the 0 · Overview stage with the tour's picture and quality.
  - Step 9 shows both buttons.
- **Loading:** the tour opens at once, and the lab keeps loading behind it.
  - It reaches the WASM kit through the same single-flight loader the lab uses.
  - While the kit or a picture is loading, the step's picture area shows a quiet loading state; the text and navigation work immediately.
- **A picture uploaded inside the tour** reaches the lab only through "Show me in the lab" or "Start exploring". Closing the tour any other way discards it.

## Left to the builder

- The component structure: for example, a `JpegTour.svelte` dialog plus a pure `tour.ts` with the step data and the per-step picture maths.
- How each step's picture is drawn: a 2D canvas or an `<img>` from an `ImageData`, and the exact visual treatment of the brightness/colour split, the tile grid, the wave patterns and the size bar.
- The exact wording, within the limits above.
- The dialog's look. It follows the lab's dark theme, its tokens and the mockup: the orange "loses detail" tag and the highlighted current step.

## Implementation notes

Differences and details from the build:

- **The header button** is a `headerAction` snippet prop on `LabShell`, rendered beside the `h1` in a `.title-row` flex row that wraps on phones (the button gets a 44 px touch height at 480 px and below).
- **The tour is mounted in the lab's `story` snippet**, just before `TooltipHost`, so it shares the lab's tooltip controller and the cards (z-index 1000) draw above the overlay (z-index 900).
- **The lab's arrow-key handler returns early while the tour is open**, as well as the tour stopping its own keys, so an arrow aimed at the page behind the dialog does nothing.
- **The hand-off re-encodes rather than reloads** when the tour's picture is the lab's own gallery picture: only the quality changes. A different gallery picture, or any upload, is loaded from the pixels the tour already holds, so nothing is fetched twice.
- **Focus returns to "How JPEG works"** after every exit, including Escape and the close button.
