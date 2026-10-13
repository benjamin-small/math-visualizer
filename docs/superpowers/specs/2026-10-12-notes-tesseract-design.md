# Notes & Chords: four notes and the tesseract — Design

**Date:** 2026-10-12
**Status:** Draft for review
**Scope:** extend the Notes & Chords lab (`#/notes`) from three notes to four: the Rust rule and visualization in `crates/viz-core`, one small engine/trait addition, the Svelte lab and its helpers, docs.

## Summary

Today one note swings a dot on a bar, two draw a Lissajous loop and three draw a curve inside a turning cube. This adds a fourth note. It gets a fourth bar (bottom gutter) and becomes the fourth coordinate, w, of the curve: the cube becomes a tesseract (16 corners, 32 edges, the cube-inside-a-cube picture), turned through the fourth dimension and squashed back to 3D with perspective, then drawn by the existing 3D pipeline. In pure ratios a dominant seventh (C, E, G, B♭) is 20 : 25 : 30 : 36, because the lab's 5-limit table makes the minor seventh 9/5; it closes after 20 swings of the root (the trail shows the last 64 at most, as now).

Four notes come from single-note mode (up to four picks) and from five new seventh chords in chord mode.

## Goals

1. Pick up to four notes in single-note mode; the fourth gets its own colour, bar, badge "4", legend swatch and voice.
2. Chord mode offers, besides the six triads, Dom7, Maj7, Min7, Half-dim7 and Dim7.
3. With four notes the figure is a tesseract frame with the curve inside it, turning through 4D on its own; the 3D spin and drag-to-orbit work as now.
4. A **4D turn** slider shows and sets the 4D angle; a **Turn** toggle starts and stops the automatic turn.
5. One to three notes look and behave exactly as today, apart from the ratio readout's new position.

## Non-goals

- Storing the 4D angle or the Turn state in the share link.
- Five or more notes; extended chords (9ths, 11ths), inversions or voicings.
- GPU-side 4D maths (approach B) or orthographic 4D (approach C); see Decisions.
- Any change to the other labs' behaviour.

## Decisions

- **Approach A: 4D maths on the CPU in Rust, drawn by the existing 3D pipeline.** At most `max_samples` trail points plus 32 edges per frame, so the cost is negligible; the maths stays in pure, unit-testable functions; no new shader.
- **Axes:** (x, y, z, w) = (note 2, root, note 3, note 4), each displacement × `CUBE_HALF`. Notes 1–3 keep today's axes.
- **The turn:** one angle θ applied as a rotation in the x–w plane and then in the z–w plane, both by θ. Periodic in 360°, so one slider covers it. At θ = 90° the fourth note lies along x (the second note's old axis).
- **Perspective 4D → 3D:** `p = D / (D − w′)` scales x′, y′, z′, with `D = 3 · CUBE_HALF`, then a fixed fit factor brings the result back inside the current cube's bounding sphere (radius `√3 · CUBE_HALF`) for every θ, so the camera framing (`CAMERA_DISTANCE`) is unchanged. The fit factor is a named constant derived from the worst case and pinned by a test.
- **Who owns the angle:** the visualization. `update_viz_config` re-runs `init` and zeroes the next frame's dt, so the page cannot push the angle every frame without freezing the cube's spin. The viz advances the angle in `tick` and the page reads it back through a new readout (below).
- **Fourth colour:** a soft blue, default `#7FA8E8`, final value tuned against the dark stage in the mockup step; Rust's default is the truth and JS `NOTE_COLORS` copies it.
- **Fourth bar:** in the bottom gutter, on its midline, running left → right (mirroring the top bar).
- **Ratio readout:** moves to the strip's top-left corner (the dark pill it already has), for every pick size, because there is no free space below the figure (it fills the stage height in landscape, and the strip sits right under it in portrait). With no strip (a stage too small for the layout), it stays at the figure's bottom-centre.
- **Chord picker:** still one radio group with one shared `name` (arrow keys run through all 12). Row 1: Single notes and the six triads; row 2, after a small "Sevenths" label: the five sevenths.

## Rust

### Rule (`crates/viz-core/src/rules/notes.rs`)

- `MAX_NOTES` 3 → 4; the schema's `maxItems` follows it; `effective_notes()` keeps at most four.
- Ratios, `period_cycles`, the summary and the trail sampling are already per-note: no other change. New tests: four notes are kept and a fifth dropped; `[60, 64, 67, 70]` in pure ratios is 1, 5/4, 3/2, 9/5 (20 : 25 : 30 : 36) with a period of 20 root cycles; the summary lists four notes.

### Trait and engine (shared)

- `Visualization` gains `fn readout(&self) -> serde_json::Value`, default `Value::Null`, documented as cheap and read every frame. The erased wrapper forwards it.
- `Engine` exposes `viz_readout() -> JsValue`.
- No other visualization implements it, so the other labs are untouched.

### Visualization (`crates/viz-core/src/visualizations/notes.rs`)

- `NotesVizConfig.note_colors: [[f32; 4]; 4]`; the fourth default is the soft blue. Schema and defaults updated.
- New config fields, each `#[serde(default)]`:
  - `turn_4d: bool` (default `true`): whether `tick` advances the angle.
  - `turn_4d_speed: f32` (radians per second, default `0.35`).
  - `angle_4d: f32` (radians, default `0`): taken by `set_config`/`init` **only when `turn_4d` is false**, so the slider can hold an angle and no other config push (layout, resize) snaps a turning figure back.
- `NotesViz` keeps `angle_4d` state; `tick` adds `turn_4d_speed · dt` while turning and wraps it into [0, 2π).
- `readout()` returns `{ "angle_4d": θ }` (radians, in [0, 2π)).
- `Layout.bars: [Bar; 4]`; the fourth bar is on the bottom gutter's midline, spanning the plot left → right. `frame.n_notes` is capped by `layout.bars.len()` (now 4).
- `render`: four notes → `draw_figure_4d`; three → `draw_figure_3d`; one or two → `draw_figure_2d`, as now.
- `draw_figure_4d` mirrors `draw_figure_3d` (same viewport, camera, auto azimuth and drag offset, line and point batches): tesseract edges in `axis_color`, the trail in `trail_color`, the pen with the smear fade, each point through `project_4d(rotate_4d(p, θ))`.
- Pure helpers, all unit-tested:
  - `rotate_4d(p: [f32; 4], theta: f32) -> [f32; 4]`
  - `project_4d(p: [f32; 4]) -> [f32; 3]` (perspective and the fit factor)
  - `tesseract_edges(half: f32) -> [[[f32; 4]; 2]; 32]`
- `draw_bars` and `draw_strip` already loop over the notes in play; they pick up the fourth with no change beyond the colour array.

## Web

### Helpers (`web/src/lib/notes/`)

- `theory.ts`: `NOTE_COLORS.bars` gets the fourth colour.
- `picker.ts`: `MAX_NOTES = 4` (toggle lock-out, `sanitizeNotes`, link parsing).
- `chords.ts`: `Chord` gains `group: 'triad' | 'seventh'` and `steps` of length 3 or 4. New entries, in this order after the triads: `dom7` "Dom7" [0, 4, 7, 10], `maj7` "Maj7" [0, 4, 7, 11], `min7` "Min7" [0, 3, 7, 10], `halfdim7` "Half-dim7" [0, 3, 6, 10], `dim7` "Dim7" [0, 3, 6, 9]. `chordOn` and the B5 limit already work for any length (Maj7's highest root is C5).
- `layout.ts`: `labelAnchors(figure, strip)` returns four bar anchors (the fourth at the bottom bar's right end, placed beside it like the top bar's) and the ratio anchor at the strip's top-left corner, or the figure's bottom-centre when the strip is empty.
- `audio.ts`: no change (`VOICE_LEVEL / n`); a four-voice test.

### Lab API (`web/src/lib/components/labApi.svelte.ts`)

- `readVizReadout(): unknown` wraps `engine.viz_readout()`, `null` without an engine. The test fake engine (`test/fakeViz.ts`) gains `viz_readout`.

### Lab page (`components/labs/NotesLab.svelte`)

- Chord radios in two rows as described under Decisions; behaviour unchanged (a chord re-voices the current root; Single notes keeps the pick; a root change carries the speed).
- 4D controls, rendered only when four notes are picked:
  - **4D turn** slider, 0–359 whole degrees, with a mono degree readout.
  - **Turn** toggle, `aria-pressed` while turning.
  - The per-frame effect reads `api.readVizReadout()` and, while turning, moves the slider to the reported angle.
  - Slider input → `patchVizConfig({ turn_4d: false, angle_4d })` and Turn shows off.
  - Turn pressed → `patchVizConfig({ turn_4d: true })` (resumes from the held angle); pressed again → `{ turn_4d: false, angle_4d: current }`.
  - Reset → turn on, angle 0.
- Overlay: four swing labels; the ratio readout at its new anchor; the legend gets a fourth swatch.
- Tips: four notes, the tesseract and the 4D controls; the link tip mentions `c=dom7`.

## Docs

- README Notes & Chords bullet: up to four notes, sevenths, the tesseract.
- `2026-10-04-notes-and-chords-design.md`: point to this spec for the four-note extension.

## Mockup before building

A static mockup (headless capture) of the bezel's two chord rows and the 4D controls, and of the stage with four notes (the fourth bar, the tesseract and the ratio pill in the strip's corner), in light and dark. The look is approved before implementation starts.

## Testing

- **Rust unit tests:** `rotate_4d` is periodic in 2π and the identity at 0; at θ = π/2 the input's w lands on the x axis (x′ = −w); `project_4d` shrinks points with larger w′; every projected tesseract corner stays within `√3 · CUBE_HALF` for θ sampled over a full turn; 32 edges, each joining corners that differ in one coordinate; the fourth bar's position; config defaults round-trip and the schema lists the new fields; `tick` advances the angle while turning and not while held; `set_config` takes `angle_4d` only when held; `readout()` shape.
- **Rule tests:** as listed under Rule.
- **wasm test:** four notes render without error and `viz_readout()` returns an angle.
- **Web unit tests:** the seventh chord table and limits; four-note picker and link rules; four label anchors; the ratio anchor in the strip corner and its fallback; four-voice audio levels.
- **Lab tests:** 12 radios in one group in the stated order; a seventh built on a press; the 4D controls present only with four notes; slider input and Turn pushing the stated viz configs; the slider following the readout; Reset; links with four notes and with `c=dom7`.
- **Validation:** `cargo fmt --all --check`, `cargo clippy --all-targets --all-features`, `cargo test --all-features`, the wasm tests, `vitest`, `svelte-check`; then a browser check of the deployed site.
