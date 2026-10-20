# JPEG lab: the decode stage puts the wipe first

Date: 2026-10-20. Status: built straight from the request (the user asked for no questions).

## Why

On the last stage, decode, the wipe (the decoded picture left of a line, the original right of it)
is the feature that shows what JPEG cost. But it shows the whole picture in a panel about a third
of the stage, so the small differences it exists to show are too small to see. The user: "the
swipe is a cool feature, but it's too small to be able to see the minute differences. Let's
rethink that last frame and focus on that swipe feature."

## What changes

- **The wipe is the stage's main panel.** It takes the full width of the stage's focus area and
  most of its height. The error map ("what was lost") and the re-save chart sit below it.
- **It is magnified around the current block.** A zoom control in the decode tools offers Whole
  picture, 2×, 4× and 8× (default 4×). At N× the wipe shows a square window of the picture
  `round(min(width, height) / N)` pixels on a side, centred on the current block (the same block
  the scan and every other stage follow), with crisp pixels (textures are already nearest-sampled).
  The error map shows the same window, so the two line up.
- **The window follows the current block.** Play walks it across the picture; Back and Forward
  step it; clicking a block or a Decode hint (Blocking, Ringing, Colour bleed) jumps it there.
  This is the existing "one current block" behaviour; nothing new to learn.
- **Drag the line on the picture.** Pressing on the wipe panel and dragging moves the wipe line
  to the pointer; the Wipe slider stays for keyboard and fine control and shows the same value.
- **The current block stays outlined** on both panels, through the zoom.
- **Labels say what is shown:** e.g. `Decoded (left of the line) against the original, 64 × 64 px
  around the block` and the same suffix on the error map; Whole picture keeps today's labels.
- **The zoom control explains itself** with an explain card, like every control in the lab.

## Calls made (my own, not discussed)

- Default zoom 4×: on the 256² pictures a 64-pixel window, so one picture pixel is several screen
  pixels on a phone and a desktop.
- Zoom is not written to the link (the wipe position is not either).
- The wipe line's position stays a share of the panel's width, so it means the same at every zoom.
- The left-hand scan picture stays as on every other stage (it is where blocks are picked).

## Constraints

- Never push viz config per scan step: the viz computes the window from the selection (as the
  subsample stage's zoom already does, via a panel's `zoom`).
- Copy rules: British spelling, sentence case, no emoji or arrow glyphs in `.svelte` files; no
  native `title` in the lab's own files; every new control has an explain card with a live value.
- Validation: cargo fmt / clippy / test, wasm-pack headless tests, vitest, svelte-check; update
  `docs/testing.md` counts. Browser check at 375 × 812 and 1024 × 768.
