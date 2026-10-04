# Notes & Chords lab — Design

**Date:** 2026-10-04
**Status:** Approved for implementation
**Scope:** a fourth lab, `#/notes`: Rust rule + WebGL2 visualization in `crates/viz-core`, a Svelte lab page, a home tile, docs.

## Summary

A playground built from the "every note is a vibration" explainer: one note swings a dot back and forth on a bar; a second note swings a dot on a perpendicular bar and the pen at (x, y) draws a Lissajous figure (3:2 for C and G closes after two swings of C); speeding the swings past ~20 per second turns the motion into an audible pitch; simple ratios draw simple shapes, tangled ratios dissonance; a third note draws a 3D curve inside a slowly rotating cube; piano (equal-tempered) tuning gives 4 : 5.04 : 5.99 and the shape never sits still.

The lab follows the existing pattern exactly: a Rust `Rule` (the oscillator model) paired with a Rust `Visualization` (WebGL2) registered in `engine/registry.rs`, driven by one Svelte component under `components/labs/`, listed on the home page as a live tile.

## Goals

1. Pick up to three notes (C4…C5) and watch each one swing a dot on its own bar: first note on the left bar (drives y), second on the top bar (drives x), third on the right bar (drives depth).
2. Two notes draw the Lissajous figure with dotted guides from each bar's dot to the pen; three notes draw a 3D curve inside a slowly turning wireframe cube (drag to orbit).
3. A waveform strip under/beside the figure plots each note's sine and their sum with a moving playhead.
4. A "swings per second" slider from 0.25 to 1000 Hz, a "Real pitch" ramp to the first note's true frequency, and sound that fades in once the rate passes about 20 swings per second.
5. A "Pure ratios" / "Piano" toggle: just intonation closes the loop; equal temperament keeps the same window and visibly drifts.
6. Share links `#/notes?n=60,67&t=equal`; a home tile that shows C4 + G4 closing in two swings and reads Done.

## Non-goals (v1)

- The interval gallery grid and a harmony/dissonance readout.
- Zoom, scrubbing UI, or the shell's transport buttons (the lab owns Play/Pause/Reset and its own speed slider).
- Changing other labs' rendering. The only shared-code change is lifting sorting's private `pixel_projection` into `render/` and extracting the AudioContext factory shared with the sorting lab.

## Decisions

- Default note **C4**: the picker is one octave C4…C5 (13 chips), so starting at C makes every interval reachable upward and "Real pitch" lands on 262 Hz.
- The **root** (ratio 1, the note the speed slider counts) is the **first note picked** = the left bar, on both the Rust and JS sides. Notes picked below it get ratios < 1.
- The ratio readout lists notes in **ascending pitch** ("2 : 3", "4 : 5 : 6", "4 : 5.04 : 5.99"); the per-bar labels carry each note's swing count ("C ×2", "G ×3").
- The home grid becomes 2×2 for four tiles (one column at ≤900px).

## The key trick: playback speed is the pitch

The engine clock counts iterations; `speed` = iterations per second (`engine/playback.rs`). For this lab **one iteration = one full swing (cycle) of the root note**, so the shell's speed is literally swings per second = Hz. `substep(n, sub)` gives the continuous phase `n + sub` every frame. `max_iterations` defaults to `u32::MAX` so `advance_time` never auto-pauses (it would stop after 50 000 cycles otherwise; `Engine::new` reads the config's `max_iterations` through `registry::max_iterations_of(cfg, 50_000)`). `SetSpeed` has no ceiling (`playback.rs` clamps only the floor, 0.25).

## Rust ↔ JS contract

- Rule config `NotesConfig { notes: Vec<u8> (MIDI, 1..=3, order = bar order: [0] left/y = root, [1] top/x, [2] right/z; default [60] = C4), just_intonation: bool (default true), max_iterations: u32 (default u32::MAX) }`, every field `#[serde(default)]`, `effective_notes()` normalises (empty → [60], truncate to 3, clamp 127). Capabilities `cheap_scrubbable()`. A rule-config push resets playback to 0 paused (existing engine behaviour) → the lab dispatches `Play` after it, as Fourier/Sorting do.
- Ratios relative to `notes[0]`: just intonation by semitone interval d (`rem_euclid(12)`, × 2^`div_euclid(12)`), 5-limit table `[1/1, 16/15, 9/8, 6/5, 5/4, 4/3, 45/32, 3/2, 8/5, 5/3, 9/5, 15/8]` reduced by gcd; equal temperament `2^(d/12)`. Figure period (root cycles) = lcm of the **just** denominators even in piano mode, so toggling tuning keeps the trail window and the piano figure visibly drifts. Must hold: 3:2 → 2; C+E+G → 4; 45/32 → 32; 16/15 → 15; fifth below (2/3) → 3; octave → 1.
- State recomputed from (n, sub) purely: `phase = n as f64 + sub as f64`, stored **unreduced** (reducing mod the just period would snap the piano figure back every period and kill the drift). `displacement_at(note, just, phase)` reduces **per note** in f64 — `phase.rem_euclid(den)` for a just ratio, `(ratio·phase).rem_euclid(1.0)` for ET — before `sin`, so f32 never sees a large phase. `closed = phase ≥ period` (monotonic while playing, so the tile's Done never flickers).
- `rule_summary()` (cheap, read per frame): `{ phase, period, closed, just_intonation, notes: [{ midi, ratio, num, den, displacement }] }` where `num/den` are always the just fraction (also in piano mode; the UI picks the label by `just_intonation`). JS parses with loose `== null` (wasm-bindgen sends `None` as `undefined`).
- Viz config includes two device-pixel rects pushed by JS like sorting's `cells`: `figure: [x,y,w,h]`, `strip: [x,y,w,h]`, both `#[serde(default)]` (all-zero figure → the viz fits the canvas itself: centred square, 8% margin, no strip; the home tile and wasm tests rely on this). The viz reads `gl.drawing_buffer_width()/height()` every frame (wasm tests never call `resize`).
- **Bar geometry is shared**: `GUTTER_FRAC = 0.12` of the square side; the plot is the square inset by 12% on every side; each bar lies on its gutter's midline (6% from the square's edge) and spans the plot's extent (12% → 88% of the side). JS `BAR_INSET = 0.12` reproduces this for the overlay labels.
- "Smear" is viz-side: it tracks the phase delta per frame; `smear = smoothstep(0.1, 0.5, delta)`, and 0 for a backward jump (reset/scrub) so there is no flash. It fades dots/pen/guides out and lights each bar as a solid strip (the video's 262 Hz look). JS never tells the viz the speed.
- Colours (Rust defaults are the truth; JS `NOTE_COLORS` copies the hex): bars amber `#F2B23C`, coral `#F0665C`, mint `#6CC68E`; trail warm white `#F5E6CC` α 0.85; sum `#E6E9EE` α 0.9; guide `#9AA3AF` α 0.5; axis `#4A515C`; background `[0.07, 0.07, 0.09, 1]` like Fourier.

## Visualization (`crates/viz-core/src/visualizations/notes.rs`)

- 2D (1–2 notes), y-down pixel projection: `layout(canvas_px, figure, strip) -> Layout { figure, plot, bars[3], strip }`; dots at `bar_point(bar, displacement)` (`InstancedPoints`); dotted guide lines bar-dot → pen (`push_dashed`); the trail = polyline sampled from the formula over the last `trail_window = min(period, 64)` root cycles ending at `phase` (`trail_sample_count = clamp(span × max_ratio × 40, 2, 8192)`; grows from nothing, then a stationary closed loop for pure ratios); with one note the plot is a time plot over `strip_window(period)` (2 cycles) with the newest sample at the right edge; pen dot; lit-bar quads (`glow_quad`, `InstancedQuads`) scaled by smear.
- Strip: per-note sines over the **current block** `[t0, t0 + W)`, `W = clamp(period, 2, 8)`, `t0 = floor(phase / W)·W`, plus the normalized sum (brighter, skipped for one note), centre axis, playhead at `(phase − t0)/W` — so the wave under the playhead equals the bar dot in every tuning; while the figure is smeared (audio rates) the block is held so long periods and piano tuning do not re-phase every frame.
- 3D (3 notes): `gl.viewport(gl_viewport_rect(canvas_h, plot))` (y-flipped, integer-rounded, same ints fed to `camera.resize`), `Camera3D` (aspect 1, distance 2.5), wireframe cube `CUBE_HALF = 0.5` (0.55 fails the frustum test) via `LineBatch3D`, curve x=note1/y=note0/z=note2 scaled by `CUBE_HALF`, pen (`InstancedPoints3D` with `viewport_px` = plot), auto-rotate in `tick`, drag in `handle_input` (Sierpinski pattern); then restore the full viewport and draw the three 2D bars + strip (no guide lines in 3D). BLEND on once, no DEPTH_TEST, no clear inside the 3D pass, state restored at the end of `render`.
- Viz config: `background, note_colors[3], trail_color, sum_color, guide_color, axis_color, dot_size_px (8), pen_size_px (6), auto_rotate_speed (0.25 rad/s), samples_per_cycle (40), max_samples (8192), figure, strip`. `set_zoom` no-op. `init` only caches `auto_rotate_speed` + `ensure_resources` (it runs on every `update_viz_config`; never reset camera/smear there).

## Web (`web/src/lib/notes/*`, `components/labs/NotesLab.svelte`)

- `LabShell labId="notes" title="Notes & Chords" playback={false} zoom={false}`; bezel controls in order: Play/Pause (primary) + Reset (back to C4, pure ratios and 0.5 Hz, from the first swing, playing); "Swings per second" **log** slider (`sliderToHz(t) = 0.25·4000^t`) with mono Hz readout; "Real pitch" button ramping exponentially from the current speed to `midiToHz(notes[0])` over 2.5 s (rAF; cancelled by slider input, any transport click, root change, destroy); "Pure ratios" / "Piano" buttons (aria-pressed); the note picker = 13 chip buttons C4…C5 (`noteLabel` like "C4"; names with real ♯/♭ glyphs live in `theory.ts` — the no-emoji test scans `.svelte` files only), selected chips tinted via `--note-color` on the border/badge (never as text on paper) and numbered 1/2/3, unselected chips `aria-disabled` (dimmed, still focusable) with a title hint once 3 are picked, the pick may be empty (link `n=none`; the stage then shows a prompt and Real pitch is disabled), default C4; Sound button + volume (sorting pattern). Default speed 0.5 Hz dispatched in `onReady`; the rule config `{ notes, just_intonation }` is pushed on ready unconditionally.
- Overlay (pointer-events none): one `.note-label` per note at its bar end — left bar bottom `(x + 0.06s, y + 0.88s)` below, top bar right `(x + 0.88s, y + 0.06s)` to the right, right bar bottom `(x + 0.94s, y + 0.88s)` below — reading `swingLabel` ("C ×2"; piano: "G ×3.00" = period × ratio); `.ratio` at the square's bottom-centre `(x + 0.5s, y + 0.94s)` reading `ratioLabel` (ascending pitch; hidden for one note). Positions come from `notes/layout.ts` (`notesLayout(cssW, cssH)`: landscape → square at the left, strip to its right; portrait → square on top, strip below; 16 px margins; degenerate sizes → all zeros), pushed to the viz via `patchVizConfig({ figure, strip })` in device pixels from a ResizeObserver on the overlay with a window-resize fallback and once in `onReady`, exactly like the sorting lab's `pushCells`.
- Audio `notes/audio.ts` (`NotesAudio`, modelled on `SortingAudio`; the shared `AudioContextLike`/`AudioContextFactory`/`defaultContextFactory`/`clamp01` move to `web/src/lib/audio/context.ts`, re-exported from `sorting/audio.ts`; the stub context helpers move to `web/src/lib/test/stubAudio.ts`): one persistent sine oscillator per note behind per-voice gains → master gain → compressor; `voicePlan(speedHz, ratios, playing, muted)`: freq = speedHz × ratio, gain = playing && !muted ? 0.18/n × clamp01((speedHz × ratio − 20)/10) : 0 (each voice gated by its own pitch); `update()` only touches an AudioParam whose target changed; `setTargetAtTime` ramps (freq 0.01 s, gain 0.02 s). Driven by a per-frame `$effect` on `api.snapshot` (speed/playing from the snapshot, ratios from the parsed summary).
- URL params `#/notes?n=60,67&t=equal` (`n` sanitised to the picker range, deduped, max 3; `t=equal` only in piano mode; canonical rewrite on load). `buildQuery` keeps raw commas (`URLSearchParams` would emit `%2C`).
- Home tile: `patchRuleConfig({ notes: [60, 67] })`, `setSpeed(0.5)`, `play()`; readout "1.3 / 2 swings" ("Tuning up" before the first summary); `done` = `closed`; `progress` = closed ? 1 : min(1, phase/period).
- Legend: 5 swatches (Note 1 left bar, Note 2 top bar, Note 3 right bar, Trail, Sum line) from `NOTE_COLORS`. Story: "How it works" plus `.tip` paragraphs for the controls, in the existing voice.

## Testing

- Rust: inline unit tests for the theory, config, state, layout, sampling, smear, dash, cube and frustum helpers; browser tests in `tests/wasm.rs` for construction, 1/2/3-note rendering, rect pushes, 3D drag and unbounded playback.
- Web: Vitest for every pure module (theory, picker, speed, layout, summary, audio, shared context) and a `NotesLab` component test against `FakeEngine`; `App`, `Home` and router tests updated for four labs.
- Browser: the lab at `#/notes` in light and dark, desktop and 375 px, plus the home tile.
