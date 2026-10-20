# JPEG lab: the stage follows the scan, and dead transport buttons say so

Date: 2026-10-19. Status: design, for planning.

## Why

The user pressed Play in the JPEG lab and saw nothing react. The scan walked an outline across
the picture, block by block, but every panel that explains the stage (the block's pixels, its
waves, its numbers, its bits) stayed on the block they had clicked, which is a separate position
from the scan. On top of that the scan starts playing by itself when the lab opens and is done
in about four seconds (64 steps a second), so by the time a reader looks, it has "already played"
and Play and Forward silently do nothing.

What the user wants, in their words: "the panels should follow the scanned block"; "don't
autoplay on load"; "scan slower so people have a chance to realize it's even happening"; and the
back, forward and play buttons should be disabled when they will have no effect, "with a tooltip
explaining they have no effect in that context".

Success: a reader presses Play on any stage from colour to decode and watches each block, in
turn, go through that stage in the panels, slowly enough to notice. A button that would do
nothing looks unavailable and, on hover or focus, says why.

## Goals

1. **One current block.** The scan position and the selected block become one thing.
   - Play walks it across the picture one scan step (one MCU) at a time, and every panel on the
     current stage follows it.
   - Back and Forward move it one step; the panels follow.
   - Clicking a block on the picture pauses the scan and jumps it there: the blocks before it
     show as scanned, the ones after it dimmed, and the panels show the clicked block.
   - The arrow keys on the picture and a Decode hint's "follow this block" move the same
     position, the same way as a click.
   - A shared link's block (`b=`) is where the scan sits when the link opens.
   - **The whole-picture stages light up the current block** (the user's choice). On colour,
     the cube lights up the current block's pixels (the rest of the cloud dimmed, as the
     picture's unscanned part is) and the three plane panels outline the block. On decode, the
     wipe and the error map outline the block. These marks follow the scan like every other
     panel. How a point or a square is lit up is the builder's call, in the lab's existing
     accent colour.
2. **No autoplay.** Opening the lab, picking another picture, uploading one, or a tour hand-off
   never starts the scan. It sits paused at the current block until the reader presses Play.
3. **A slower default speed**, so the scan is visibly a scan (see "Calls made" for the number).
   The speed slider keeps its range, so readers can still run it fast.
4. **Dead buttons are disabled, and say why.** In every lab that shows the shell's transport
   (JPEG, Sierpinski, Fourier):
   - At the start (step 0): Back and Reset are disabled.
   - At the end (the last step): Play and Forward are disabled. Play does not restart; Reset does.
   - In the JPEG lab's overview, which has no single block, all four are disabled.
   - Disabled buttons still show their explanation on hover and keyboard focus: the JPEG lab's
     explain cards, and the other labs' native tooltips. So they must stay focusable and
     hoverable. Use `aria-disabled="true"`, a disabled look and a click handler that does
     nothing, not the `disabled` attribute (which swallows hover and focus). The lab already
     does this in `components/jpeg/DecodeTools.svelte` (around :144-149, styled around :207).
   - Wording (sentence case, British spelling, plain words; final copy is the builder's, in
     the lab's voice):
     - At the end: the scan has reached the last block; Reset to scan again.
     - At the start: the scan is already at the start (in the JPEG lab, at the first block).
     - JPEG overview: the overview shows the whole picture at once; pick a stage to follow the
       scan one block at a time.

## Non-goals

- No change to the Sorting and Notes labs, which have their own controls and no shell transport.
- No change to the encoder, the file it writes, or what each stage's panels draw for a block,
  except the new current-block marks on the colour and decode stages (goal 1).
- No new keyboard shortcuts for the transport.
- No "play from the end restarts" behaviour.

## Anti-goals

- The panels lagging behind the scan, or the scan and the outline in the panels naming
  different blocks: there must be one block on screen, not two.
- The lab stuttering at high speeds because of following the scan. At 360 steps a second the
  panels may skip blocks (they only need to show the newest block each frame), but the frame
  rate must hold.
- A disabled button that gives no reason, or a reason that is wrong for the state it is in.
- Rewriting the URL on every scan step while playing.

## How it behaves today (for the builder)

- Shell transport: `web/src/lib/components/LabShell.svelte` renders Reset, Back, Play/Pause and
  Forward (:239-249) with no disabled state. Its `tip()` (:79) gives native titles unless
  `nativeTitles` is false, which the JPEG lab sets (`JpegLab.svelte`, `<LabShell ...>`).
- Engine semantics, `crates/viz-core/src/engine/playback.rs` `reduce` (:64-125): Play needs
  `iteration < max_iterations`; StepForward does nothing at max; StepBack does nothing at 0 (or
  without `supports_scrub`); Reset goes to 0 and pauses; playback pauses itself at the end.
- JPEG lab, `web/src/lib/components/labs/JpegLab.svelte`:
  - One iteration is one MCU: `max = mcuCount(w, h, subsampling)` in `encode()`.
  - The first encode plays from 0 (`first`, `cmd.play()`); later encodes rewind, jump back to
    the same share of the picture and resume if it was playing.
  - The selection is `anchor` (a luma block), sent to the rule with `select_block` in
    `selectAnchor()` (scaled into the chosen plane's grid). Clicks (`onImageClick`), arrow keys
    (`onImageKey`), Decode hints (`pickBlock`) and links (`linked.block`) all set `anchor`.
  - `DEFAULT_SPEED = 64` MCUs a second, set in `onReady`.
  - `onReady` attaches the explain cards to the shell's transport by querying
    `.transport button` in DOM order (Reset, Back, Play, Forward).
- Viz, `crates/viz-core/src/visualizations/jpeg.rs`: the `image` panel draws MCUs `0..n` decoded
  and the rest dimmed (`scanned_rects`), outlines the front MCU `n` (around :734-745), and
  separately outlines the selected block. The overview's panels ignore `n`.
- Explain cards for the transport: `web/src/lib/jpeg/explain/bezel.ts` (`resetCard`,
  `stepCard`, the play card, `positionCard`), ids in `web/src/lib/jpeg/explain/targets.ts`
  (`bezel.play`, `bezel.reset`, `bezel.step`, `bezel.position`). They already know when the
  scan is at the start or end. The coverage test (`jpeg/explain/__tests__/coverage.test.ts`)
  needs every id to keep a card with a live value or consequence, and forbids native `title`s in
  the lab's own files.
- The "How it works" tip in `JpegLab.svelte` describes the current behaviour ("Play runs the
  scan block by block ... clicking anywhere on the image follows that block") and must be
  rewritten to match.

## Calls made (not discussed with the user; the builder may revisit with care)

- **Which block is current.** The current block is the one the scan scanned last: with `n`
  steps scanned, the current MCU is `n - 1`. So the block that has just turned from dimmed to
  encoded is the one the panels describe. Picking a block in MCU `k` sets `n = k + 1`.
- **The JPEG lab's start is step 1, not 0.** Step 0 (nothing scanned) would show the same block
  in the panels as step 1, so Back from step 1 and the first Play step after a Reset would
  change nothing in the panels. So in this lab, Reset goes to step 1, Back stops there, and
  the start-disabled state (Back and Reset) shows there. The shell therefore takes the first
  step from the lab (default 0 for the other labs), rather than assuming `iteration === 0`.
  Step 0 is never reached in the JPEG lab once a picture is in.
- **Inside an MCU.** With shared colour (4:2:2, 4:2:0) one step covers several luma blocks. When
  the scan moves to an MCU, the panels show its top-left luma block, or that MCU's block in the
  chosen colour plane. A block picked by click, key, hint or link keeps the exact block picked
  (not snapped to the MCU's top-left) until the scan moves on.
- **One outline.** The separate scan-front outline goes; the current block's outline is the only
  one, so the picture never shows two positions.
- **Opening.** With no `b=` in the link, the current block is the encoder's default, the luma
  block with the most AC energy (amended while planning: the default is not block 0, 0). The
  scan sits paused just after it: at that block's MCU + 1.
- **Re-encoding** (quality, subsampling, tables, Huffman): the scan goes back to the current
  block's MCU in the new MCU grid (not "the same share of the picture"), and keeps playing if it
  was playing.
- **Default speed: 4 steps a second.** The 256 × 256 pictures (256 MCUs at 4:2:0) take about a
  minute to scan; 320 × 240 takes about 75 seconds. Known rough edge, out of scope: the shell's
  speed slider is linear from 0.25 to 360, so 4 sits at about 1% of its track.
- **The zigzag stage while playing.** Its path animation runs on its own clock and would restart
  four times a second. While the scan plays, show the zigzag path whole; animate it only when
  paused (as now, on each block change).
- **The URL** is written when the scan stops on a block (pause, step, click, key, hint, end of
  the scan), not on every step while playing.
- **The shell's disabled state** is generic: the shell works out start and end from the
  snapshot itself. A lab can also switch the whole transport off with a reason (the JPEG overview
  uses this). The JPEG lab's cards say why; the shell's native titles say why in the other labs.
- The explain-card wiring that finds the shell's buttons by DOM order stays, unless the builder
  makes it sturdier along the way.

## Left to the builder

- The look of the colour and decode stages' current-block marks, within the accent colour and
  without hiding what those panels show about the whole picture.
- Whether the selection follows the scan inside the Rust rule (in `step`, cheapest per frame)
  or in the Svelte lab (an effect on the iteration), as long as the anti-goals hold.
- How the shell takes the transport-off reason (prop shape and name).
- Exact copy for the cards and native titles, within the voice rules above.
- Test design. Existing tests that assume autoplay or "same share after a settings change" must
  change. New tests should cover: panels following Play, Back and Forward; a click jumping the
  scan; no autoplay on open, picture change, upload and tour hand-off; each disabled state and its
  reason, in the JPEG lab and in one other lab; the overview's transport off.
- Updating `docs/testing.md` (counts and scope) and the README's JPEG paragraph if anything there
  becomes untrue.

## Constraints

- Copy rules: British spelling, sentence case, no emoji or arrow glyphs in `.svelte` files.
- `main` is PR-only; validate with `cargo fmt --all --check`, `cargo clippy --all-targets
  --all-features`, `cargo test --all-features`, and from `web/`: `npx vitest run` and
  `npx svelte-check --tsconfig ./tsconfig.json`. Rust changes that reach the browser also need
  `wasm-pack test --headless --chrome crates/viz-core`.
- Browser check before done: the JPEG lab on a phone (375 × 812) and a desktop (1024 × 768):
  no autoplay, Play on the DCT stage moves the panels block by block, the colour and decode
  stages light up the current block as it moves, the disabled states and
  their cards at the start, at the end and on the overview. The hidden browser pane fires no
  ResizeObserver or animation frames, so reload at each size.
