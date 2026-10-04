# Notes & Chords Lab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fourth lab, `#/notes` ("Notes & Chords"): one to three musical notes each swing a dot on a bar; two notes draw a Lissajous figure, three draw a 3D curve in a rotating cube; a waveform strip, a swings-per-second slider that becomes pitch, sound past 20 Hz, and a pure-ratio vs piano tuning toggle.

**Architecture:** A Rust `Rule` (`rules/notes.rs`, the oscillator model: iteration = one swing of the root note) paired with a Rust WebGL2 `Visualization` (`visualizations/notes.rs`) registered in `engine/registry.rs`; one Svelte 5 lab component (`components/labs/NotesLab.svelte`) with pure helper modules under `web/src/lib/notes/`; a home tile; shared code touched only to lift `pixel_projection` into `render/` and to extract the AudioContext factory into `web/src/lib/audio/context.ts`.

**Tech Stack:** Rust (wasm-bindgen, serde, web-sys WebGL2), wasm-pack; Svelte 5 runes + Vite 5 + TypeScript; Vitest + jsdom + @testing-library/svelte; Web Audio.

**Spec:** `docs/superpowers/specs/2026-10-04-notes-and-chords-design.md` (binding; read it when a brief is ambiguous).

## Global Constraints

- **No git commands.** Two tracks run in the same checkout on disjoint files; the controller stages and commits each task's files. Never run `git add`, `git commit`, `git stash`, `git checkout` or anything that touches the index or the working tree beyond your own files. Unrelated uncommitted files in the tree belong to the other track — leave them alone.
- Rust validation (from the repo root): `cargo fmt --all` then `cargo fmt --all --check`, `cargo clippy --all-targets --all-features` (no new warnings), `cargo test --all-features`. Web validation (from `web/`): `npm run check` (svelte-check, strict TS with `noUnusedLocals`/`noUnusedParameters`) and `npm test` (`vitest run`). All must pass before you report DONE.
- Rust ↔ JS contract (verbatim from the spec):
  - Rule config `{ notes: number[] (MIDI, 1..=3; order = bar order: [0] left/y = root, [1] top/x, [2] right/z; default [60] = C4), just_intonation: boolean (default true), max_iterations: number (default u32::MAX = 4294967295) }`, every field has a serde default. A rule-config push resets playback to iteration 0 paused; the UI dispatches Play after it.
  - Playback `speed` (iterations/s) is the root note's swings per second (Hz). Rust floor 0.25, no ceiling.
  - Ratios are relative to `notes[0]`. Just intonation by semitone interval d (`rem_euclid(12)`, times 2^`div_euclid(12)`), 5-limit table `[1/1, 16/15, 9/8, 6/5, 5/4, 4/3, 45/32, 3/2, 8/5, 5/3, 9/5, 15/8]`, reduced by gcd. Equal temperament `2^(d/12)`. Period (root cycles) = lcm of the JUST denominators, also in piano mode. 3:2 → 2; C+E+G → 4; 45/32 → 32; 16/15 → 15; fifth below (2/3) → 3; octave → 1.
  - `rule_summary()` = `{ phase: number, period: number, closed: boolean, just_intonation: boolean, notes: [{ midi, ratio, num, den, displacement }] }`; `num/den` are always the just fraction. `phase` is unreduced (n + sub). `closed = phase >= period`.
  - Viz config carries `figure: [x, y, w, h]` and `strip: [x, y, w, h]` in DEVICE pixels, y-down, both serde-default; all-zero `figure` → the viz fits the canvas itself (centred square, 8% margin, no strip).
  - Bar geometry: `GUTTER_FRAC = 0.12` of the square side; the plot is the square inset by 12% on every side; each bar lies on its gutter's midline (6% in from the square's edge) and spans the plot's extent (12% → 88% of the side). Left bar = note 0 (y, +1 at the top), top bar = note 1 (x, +1 at the right), right bar = note 2 (z).
  - Colours: bars amber `#F2B23C` = [0.949, 0.698, 0.235, 1], coral `#F0665C` = [0.941, 0.400, 0.361, 1], mint `#6CC68E` = [0.424, 0.776, 0.557, 1]; trail `#F5E6CC` α 0.85 = [0.961, 0.902, 0.800, 0.85]; sum `#E6E9EE` α 0.9 = [0.902, 0.914, 0.933, 0.9]; guide `#9AA3AF` α 0.5 = [0.604, 0.639, 0.686, 0.5]; axis `#4A515C` = [0.290, 0.318, 0.361, 1]; background [0.07, 0.07, 0.09, 1].
- Web: no emoji or music glyphs typed into any `.svelte` file (`web/src/lib/__tests__/no-emoji.test.ts` rejects U+2600–27BF and arrows; ♯ U+266F and ♭ U+266D live in `.ts` only; write "to", not "→"). Icons only via `Icon.svelte`. Every button has visible text. Rounded corners, hairlines, tokens from `app.css` (`var(--…)`); never a bar colour as text on paper.
- Follow existing patterns: `visualizations/fourier_epicycles.rs` and `visualizations/sierpinski_pyramid.rs` (Rust viz), `rules/fourier_epicycles.rs` (rule config/schema), `components/labs/SortingLab.svelte` (own speed slider, Sound button, overlay measurement, URL sync), `sorting/audio.ts` (Web Audio wrapper), `components/__tests__/SortingLab.test.ts` (component test scaffold).
- Report files: write your report where the dispatch says; keep the final message under 15 lines.

## File map

| File | Responsibility |
|---|---|
| `crates/viz-core/src/render/camera_2d.rs` | gains `pub fn pixel_projection(w, h)` (lifted from sorting) |
| `crates/viz-core/src/rules/notes.rs` | theory helpers, `NotesConfig`, `NotesState`, `Notes` rule, summary |
| `crates/viz-core/src/visualizations/notes.rs` | `NotesVizConfig`, layout/sampling/smear helpers, 2D + 3D render |
| `crates/viz-core/src/engine/registry.rs` | `"notes"` lab registration |
| `crates/viz-core/tests/wasm.rs` | browser tests for the notes lab |
| `web/src/lib/audio/context.ts` | shared `AudioContextLike`, factory, `clamp01` |
| `web/src/lib/test/stubAudio.ts` | stub AudioContext for tests (moved from the sorting audio test) |
| `web/src/lib/notes/theory.ts` | note names, Hz, just/ET ratios, colours, picker range |
| `web/src/lib/notes/picker.ts` | note selection rules, URL param parsing |
| `web/src/lib/notes/speed.ts` | log slider mapping, Hz formatting, ramp |
| `web/src/lib/notes/layout.ts` | figure/strip layout, device conversion, label anchors |
| `web/src/lib/notes/summary.ts` | summary parsing and labels |
| `web/src/lib/notes/audio.ts` | `voicePlan`, `NotesAudio` |
| `web/src/lib/components/labs/NotesLab.svelte` | the lab page |
| `web/src/lib/router.ts`, `web/src/App.svelte`, `web/src/lib/components/Home.svelte` | registration, tab, tile |
| `README.md`, `docs/testing.md` | docs |

---

### Task 1: Rust theory, rule config/state, and the `pixel_projection` move

**Files:**
- Modify: `crates/viz-core/src/render/camera_2d.rs`, `crates/viz-core/src/render/mod.rs`, `crates/viz-core/src/visualizations/sorting.rs`
- Create: `crates/viz-core/src/rules/notes.rs`
- Modify: `crates/viz-core/src/rules/mod.rs` (`pub mod notes;`)

**Interfaces produced** (all `pub` in `rules/notes.rs` unless noted):

```rust
pub const DEFAULT_NOTE: u8 = 60;            // C4
pub const MAX_NOTES: usize = 3;
/// 5-limit just table by semitone 0..12, each in lowest terms.
pub const JUST_RATIOS: [(u32, u32); 12] = [(1,1),(16,15),(9,8),(6,5),(5,4),(4,3),(45,32),(3,2),(8,5),(5,3),(9,5),(15,8)];
pub fn just_ratio(semitones: i32) -> (u32, u32);   // rem_euclid(12) entry × 2^div_euclid(12) octave factor (numerator for positive octaves, denominator for negative), reduced by gcd
pub fn et_ratio(semitones: i32) -> f64;             // 2f64.powf(d as f64 / 12.0)
pub fn period_cycles(just: &[(u32, u32)]) -> u32;   // lcm of denominators, ≥ 1 (empty → 1)
/// sin(2π · ratio · phase) as f32, computed in f64; reduces phase mod `den` for just ratios only, (ratio·phase).rem_euclid(1.0) for ET.
pub fn displacement_at(note: &NoteState, just_intonation: bool, phase: f64) -> f32;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotesConfig {
    #[serde(default = "default_notes")]    pub notes: Vec<u8>,          // [60]
    #[serde(default = "default_true")]     pub just_intonation: bool,   // true
    #[serde(default = "default_max_iter")] pub max_iterations: u32,     // u32::MAX
}
impl NotesConfig { pub fn effective_notes(&self) -> Vec<u8>; }  // empty → [60]; truncate to 3; clamp each to 127; order preserved
impl Default for NotesConfig; impl ConfigSchema for NotesConfig;   // required: ["notes","just_intonation","max_iterations"]

#[derive(Debug, Clone, PartialEq)]
pub struct NoteState { pub midi: u8, pub num: u32, pub den: u32, pub ratio: f64, pub displacement: f32 }
#[derive(Debug, Default)]
pub struct NotesState { pub notes: Vec<NoteState>, pub period: u32, pub just_intonation: bool, pub phase: f64, pub closed: bool }
impl SceneState for NotesState;             // clear(): phase 0, displacements 0, closed false (notes/period kept)

pub struct Notes;
impl Rule for Notes { type Config = NotesConfig; type State = NotesState;
    fn id(&self) -> &'static str { "notes" }
    fn capabilities(&self) -> Capabilities { Capabilities::cheap_scrubbable() }
    fn init(..) -> recompute(cfg, 0, 0.0)
    fn advance_to(state, cfg, _seed, n)        { *state = recompute(cfg, n, 0.0) }   // pure, idempotent
    fn substep(state, cfg, _seed, n, sub)      { *state = recompute(cfg, n, sub.clamp(0.0, 1.0)) }
    fn summary(state) -> json!({ "phase", "period", "closed", "just_intonation", "notes": [{ "midi", "ratio", "num", "den", "displacement" }] })
}
fn recompute(cfg: &NotesConfig, n: u32, sub: f32) -> NotesState;  // builds the model (ratios from notes[0], period) and displacements; phase = n as f64 + sub as f64 (unreduced)
```

Schema: `notes` → `{ "type": "array", "title": "Notes (MIDI)", "items": { "type": "integer", "minimum": 0, "maximum": 127 }, "minItems": 1, "maxItems": 3, "default": [60], "x-widget": "notes", "x-cosmetic": false }`; `just_intonation` → `boolean_property("Just intonation", true, false)`; `max_iterations` → `number_property` (label "Swings", default and max `u32::MAX as f64`, min 1, step 1, integer, non-cosmetic). `defaults()` via `serde_json::to_value(NotesConfig::default())`. In `camera_2d.rs`: `pub fn pixel_projection(w: u32, h: u32) -> [f32; 9]` with the body from `sorting.rs:115-119`, re-exported from `render/mod.rs` as `pub use camera_2d::{pixel_projection, Camera2D};`; sorting imports it and drops its private copy and the two tests that move with it.

- [ ] **Step 1: Move `pixel_projection`.** Write/move its tests in `camera_2d.rs` first (`projection_maps_pixels_to_clip_with_y_down`: (0,0) → (−1, 1), (w, h) → (1, −1); `projection_survives_a_zero_sized_canvas`), move the function, re-export, switch `sorting.rs` to the import, delete its private copy and duplicated tests. `cargo test --all-features` stays green.
- [ ] **Step 2: Theory tests (red):** in `rules/notes.rs` `#[cfg(test)]`: `just_ratio_table_is_lowest_terms` (every entry gcd 1, equals the table above); `just_ratio_folds_octaves` (12 → (2,1); −12 → (1,2); 16 → (5,2); 19 → (3,1); 24 → (4,1)); `just_ratio_negative_interval_uses_euclidean_mod` (−7 → (2,3); −1 → (15,16); −5 → (3,4)); `et_ratio_matches_semitone_formula` (0 → 1.0; 12 → 2.0; −12 → 0.5; 7 → 1.4983 ± 1e-4); `period_examples` ([(3,2)] → 2; [(1,1),(5,4),(3,2)] → 4; [(45,32)] → 32; [(16,15)] → 15; [(2,3)] → 3; [] → 1; [(2,1)] → 1); `period_is_lcm_not_product` ([(3,2),(5,4)] → 4).
- [ ] **Step 3: Implement the theory helpers** (private `gcd`/`lcm`), run the tests (green).
- [ ] **Step 4: Config tests (red):** `config_defaults_round_trip` (`defaults()` → notes [60], `just_intonation` true, `max_iterations == u32::MAX`; `to_value(parsed) == defaults()`); `config_parses_with_missing_fields` (`{"notes":[60,64,67]}` fills the rest; `{}` → [60]); `config_rejects_bad_notes` (`{"notes":["A4"]}` and `{"notes":[300]}` are `Err`); `schema_lists_all_required_fields` (required len 3, each has a property; `notes.minItems == 1`, `maxItems == 3`, `items.maximum == 127`; `max_iterations.default == 4294967295.0`); `effective_notes_normalizes` ([] → [60]; 5 notes → first 3; 200 → 127; order preserved).
- [ ] **Step 5: Implement `NotesConfig`**, schema, defaults (green).
- [ ] **Step 6: State + rule tests (red):** `init_builds_ratios_and_period_for_c_major` ([60,64,67] just → (num,den) (1,1),(5,4),(3,2); ratios 1.0, 1.25, 1.5; period 4; phase 0; closed false; displacements 0); `init_in_et_keeps_the_just_period_and_fractions` (same notes, `just_intonation: false` → period 4, ratios 2^(4/12), 2^(7/12) ± 1e-9, (num,den) unchanged); `displacement_is_sine_of_ratio_times_phase` (root at phase 0.25 → 1.0; (3,2) at phase 0.5 → −1.0 ± 1e-6; root at phase 1.0 → 0 ± 1e-6); `phase_precision_at_one_million` (`[60,67]`: `recompute(cfg, 1_000_000, 0.25)` displacements equal `recompute(cfg, 0, 0.25)` exactly for (3,2); `[60,65]` (4/3) and `[60,66]` (45/32) within 1e-6; `phase == 1_000_000.25`); `et_mode_drifts_past_the_just_period` (`[60,67]` ET at n=2, sub=0: the second note's displacement differs from n=0 by more than 0.05; just mode is exactly equal); `a_lower_second_note_still_oscillates` (`[69,62]` → (2,3), period 3; at phase 1.5 the second note ≈ 0); `advance_to_is_idempotent_and_pure` (advance_to(5) twice → equal; advance_to(5) then advance_to(2) == fresh init + advance_to(2)); `substep_sets_fractional_phase_and_closed` (n=1, sub=0.5 → phase 1.5, closed false for period 2; n=2 → closed true; sub 1.7 clamps to 1.0); `clear_zeroes_motion_state`; `capabilities_and_id`; `summary_has_documented_shape` (keys; `notes[1].num == 3`, `den == 2`, `midi == 67`, `ratio == 1.5`; after advance_to(2) → `closed == true`, `phase == 2.0`).
- [ ] **Step 7: Implement `NoteState`, `NotesState`, `recompute`, `displacement_at`, the `Rule` impl and `summary`** (green). Add `pub mod notes;` to `rules/mod.rs`.
- [ ] **Step 8: Validate:** `cargo fmt --all`, `cargo fmt --all --check`, `cargo clippy --all-targets --all-features`, `cargo test --all-features`. Write the report.

---

### Task 2: Rust visualization, registry and browser tests

**Files:**
- Create: `crates/viz-core/src/visualizations/notes.rs`
- Modify: `crates/viz-core/src/visualizations/mod.rs` (`pub mod notes;`), `crates/viz-core/src/engine/registry.rs`, `crates/viz-core/tests/wasm.rs`

**Depends on:** Task 1 (`rules::notes::{Notes, NotesConfig, NotesState, NoteState, displacement_at}`, `render::pixel_projection`).

**Interfaces produced** (`visualizations/notes.rs`):

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotesVizConfig {
    pub background: [f32; 4], pub note_colors: [[f32; 4]; 3],
    pub trail_color: [f32; 4], pub sum_color: [f32; 4], pub guide_color: [f32; 4], pub axis_color: [f32; 4],
    pub dot_size_px: f32 /* 8 */, pub pen_size_px: f32 /* 6 */, pub auto_rotate_speed: f32 /* 0.25 */,
    pub samples_per_cycle: u32 /* 40 */, pub max_samples: u32 /* 8192 */,
    #[serde(default)] pub figure: [f32; 4], #[serde(default)] pub strip: [f32; 4],   // device px, y-down; all-zero = unset
}
impl Default; impl ConfigSchema;  // required = all 14 names; note_colors via three color_property items (like Sierpinski's corner_colors); figure/strip: array of 4 numbers, "x-widget": "rect", "x-cosmetic": true

pub const CUBE_HALF: f32 = 0.5; pub const GUTTER_FRAC: f32 = 0.12; pub const FALLBACK_MARGIN: f32 = 0.08;
pub const TRAIL_WINDOW_MAX: u32 = 64; pub const SMEAR_LO: f32 = 0.1; pub const SMEAR_HI: f32 = 0.5;

#[derive(Debug, Clone, Copy, PartialEq)] pub struct Rect { pub x: f32, pub y: f32, pub w: f32, pub h: f32 }
#[derive(Debug, Clone, Copy, PartialEq)] pub enum BarSide { Left, Top, Right }
/// `from` = displacement −1 end, `to` = +1 end (left/right bars: bottom → top; top bar: left → right).
#[derive(Debug, Clone, Copy, PartialEq)] pub struct Bar { pub side: BarSide, pub from: [f32; 2], pub to: [f32; 2] }
#[derive(Debug, Clone, PartialEq)] pub struct Layout { pub figure: Rect, pub plot: Rect, pub bars: [Bar; 3], pub strip: Option<Rect> }

pub fn layout(canvas_px: [u32; 2], figure: [f32; 4], strip: [f32; 4]) -> Layout;  // zero figure → centred square with FALLBACK_MARGIN of min(w,h) on each side, strip None; zero strip → None
pub fn bar_point(bar: &Bar, displacement: f32) -> [f32; 2];                        // lerp from→to by (d+1)/2
pub fn pen_point_2d(plot: &Rect, x_disp: f32, y_disp: f32) -> [f32; 2];            // x = cx + x_disp·w/2, y = cy − y_disp·h/2 (y-down)
pub fn gl_viewport_rect(canvas_h: u32, plot: &Rect) -> [i32; 4];                   // [x, H − (y + h), w, h] rounded
pub fn trail_window(period: u32) -> f64;         // min(period, TRAIL_WINDOW_MAX)
pub fn strip_window(period: u32) -> f64;         // clamp(period, 2, 8)
pub fn strip_origin(phase: f64, window: f64) -> f64;   // floor(phase / window) · window
pub fn trail_sample_count(span: f64, max_ratio: f64, samples_per_cycle: u32, max_samples: u32) -> usize; // clamp(ceil(span · max_ratio · spc), 2, max_samples)
pub fn trail_times(phase: f64, window: f64, count: usize, out: &mut Vec<f64>);     // evenly spaced on [max(0, phase − window), phase], last == phase
pub fn smoothstep(e0: f32, e1: f32, x: f32) -> f32;
pub fn smear_amount(delta_cycles: f32) -> f32;   // delta ≤ 0 → 0; else smoothstep(SMEAR_LO, SMEAR_HI, delta)
pub fn push_dashed(out: &mut Vec<LineVertex>, a: [f32; 2], b: [f32; 2], dash_px: f32, gap_px: f32, color: [f32; 4]);
pub fn glow_quad(bar: &Bar, half_thickness_px: f32, color: [f32; 4]) -> QuadInstance;
pub fn cube_edges(half: f32) -> [[f32; 3]; 24];  // 12 edges × 2 vertices
pub fn with_alpha(c: [f32; 4], scale: f32) -> [f32; 4];

pub struct NotesViz { /* viewport, camera: Camera3D, auto_azimuth, azimuth_offset, elevation, cached_auto_speed, last_phase: Option<f64>, smear, lazily created LineBatch / InstancedPoints / InstancedQuads / LineBatch3D / InstancedPoints3D, scratch Vecs */ }
impl NotesViz { pub fn new() -> Self; fn update_smear(&mut self, phase: f64) -> f32; }
impl Default for NotesViz;
impl Visualization for NotesViz { type Config = NotesVizConfig; type State = NotesState;
    fn id(&self) -> &'static str { "notes" }
    fn init(gl, cfg)   // cache auto_rotate_speed + ensure_resources only (runs on every update_viz_config; never reset camera or smear)
    fn render(gl, state, cfg); fn resize(gl, w, h)  /* camera-independent: store size, gl.viewport */;
    fn tick(dt)        // auto_azimuth += cached_auto_speed · dt
    fn handle_input(ev) // Sierpinski's PointerMove-with-button-1 arm: azimuth_offset += dx·0.005, elevation clamped to ±(π/2 − 0.01)
    fn set_zoom(_) {}  // no-op
}
```

Render order, one `render` call (private passes take a `FrameCtx { layout, smear, n_notes, proj: [f32; 9], canvas: [u32; 2] }` to stay under clippy's argument limit):
1. `ensure_resources`; `canvas = [gl.drawing_buffer_width(), gl.drawing_buffer_height()]` (every frame; wasm tests never call `resize`); `layout(canvas, cfg.figure, cfg.strip)`; `smear = update_smear(state.phase)` (0 when phase went backwards; tracker re-seeded); `proj = pixel_projection(w, h)`.
2. `gl.viewport(0, 0, w, h)`; DEPTH_TEST off; BLEND on with SRC_ALPHA / ONE_MINUS_SRC_ALPHA; clear colour = `background`; `clear(COLOR_BUFFER_BIT)`.
3. Figure. `n == 3` (3D): `camera.resize(plot.w, plot.h)` with the same integers as `gl.viewport(gl_viewport_rect(..))`; `camera.azimuth = auto_azimuth + azimuth_offset`, `camera.elevation = elevation`, distance 2.5; `LineBatch3D` with the 12 cube edges (`axis_color`) plus the curve as consecutive-sample segments (`trail_color`), where sample t gives (x, y, z) = (`displacement_at(note1, t)`, `displacement_at(note0, t)`, `displacement_at(note2, t)`) × `CUBE_HALF` over `trail_times(phase, trail_window(period), trail_sample_count(..))`; `InstancedPoints3D` pen at the last sample with alpha × (1 − smear), `viewport_px` = plot size; then restore `gl.viewport(0, 0, w, h)`. `n <= 2` (2D): `n == 1` → time plot over `strip_window(period)` cycles: x runs left→right across the plot for τ in `[phase − W, phase]` (newest sample at the right edge), y = note 0's displacement; `n == 2` → `pen_point_2d(plot, note1, note0)` for each sample; both as `LineBatch` segment pairs in `trail_color`; dashed guides (`push_dashed`, dash 4 px, gap 4 px, `guide_color` × (1 − smear)) from each bar dot to the pen; pen dot `InstancedPoints` (`pen_size_px`, `trail_color` brightened or white, × (1 − smear)).
4. Bars `[..n]`: axis line + a centre tick (6 px) in `axis_color` (`LineBatch`); `InstancedQuads` glow quad per bar (`glow_quad`, half thickness 2 px, `note_colors[i]` × smear — always upload, `&[]` when smear is 0); dots `InstancedPoints` at `bar_point(bar, displacement)` in `note_colors[i]` × (1 − smear), `dot_size_px`, `viewport_px` = canvas.
5. Strip (when `Some`): centre axis line (`axis_color`); per-note waves over `[strip_origin(phase, W), +W)`, 96 samples per cycle, in `note_colors[i]` × 0.8; the sum ÷ n in `sum_color` (skip when `n == 1`); a vertical playhead line at `(phase − t0) / W` in `guide_color`.
6. Restore: `gl.disable(BLEND)`; viewport back to the full canvas.

Registry: `LAB_IDS = &["sierpinski", "fourier", "sorting", "notes"]`; arm `"notes" => Some(LabParts { rule: Box::new(TypedRule::new(Notes)), viz: Box::new(TypedViz::new(NotesViz::new())), rule_cfg: NotesConfig::defaults(), viz_cfg: NotesVizConfig::defaults() })`.

- [ ] **Step 1: Config tests (red) then config:** `viz_defaults_round_trip` (dot 8, pen 6, auto 0.25, spc 40, max 8192, figure == [0;4], strip == [0;4]; `to_value(parsed) == defaults()`); `viz_schema_lists_all_required_fields` (14 required, each has a property; `figure["x-widget"] == "rect"`); `figure_and_strip_are_optional_when_deserializing` (remove both keys from the defaults JSON → parses with zeros). Implement `NotesVizConfig` + `Default` + `ConfigSchema`.
- [ ] **Step 2: Layout tests (red) then helpers:** `fallback_layout_is_a_centered_square_with_8pct_margin` (canvas 200×100 → side 84 centred at (100, 50); plot = figure inset by 12% of the side on every side; strip None); `explicit_figure_rect_is_used_verbatim` (figure [10,20,100,100], strip [10,130,100,20] → `layout.figure == Rect{10,20,100,100}`; plot inset 12 → Rect{22,32,76,76}; left bar x = 16 (gutter midline), top bar y = 26, right bar x = 104; left/right bars run from y = 108 (from, −1) to y = 32 (to, +1); top bar from x = 22 to x = 98; strip Some(Rect{10,130,100,20})); `bar_point_maps_displacement_to_bar_ends` (left bar: +1 → plot top (smaller y), −1 → plot bottom, 0 → centre; top bar: +1 → plot right); `pen_point_2d_is_centre_at_zero_and_y_down`; `gl_viewport_rect_flips_y` (canvas h 100, plot {10,20,30,30} → [10, 50, 30, 30]); `zero_sized_canvas_does_not_panic`.
- [ ] **Step 3: Sampling tests (red) then helpers:** `trail_window_caps_at_64` (1 → 1, 32 → 32, 480 → 64); `strip_window_clamps_2_to_8` (1 → 2, 4 → 4, 32 → 8); `strip_origin_is_the_current_block` (9.3, 4 → 8.0; 0.5, 4 → 0.0); `trail_sample_count_scales_and_clamps` (2, 1.5, 40 → 120; huge → max_samples; span 0 → 2); `trail_times_grow_from_zero_then_slide` (phase 0.5, window 2 → first 0.0, last 0.5; phase 10 → first 8.0, last 10.0; strictly increasing; `len == count`).
- [ ] **Step 4: Smear/dash/cube/glow tests (red) then helpers:** `smoothstep_endpoints_and_midpoint`; `smear_amount_is_zero_at_normal_speed_and_one_at_audio_rate` (1/60 → 0; 440/60 → 1; 0.3 → 0.5; −1 → 0); `push_dashed_covers_the_segment_with_short_dashes` ((0,0)→(100,0), dash 4, gap 4 → 13 dashes = 26 vertices, all x ∈ [0,100], y == 0, each dash ≤ 4 + 1e-4, last dash clipped to b); `push_dashed_degenerate_segment_pushes_nothing`; `cube_edges_has_12_edges_of_length_two_half` (24 vertices, coordinates ±half, each pair differs in exactly one axis, 12 unique edges); `cube_corners_stay_inside_the_frustum_over_a_sweep` (`Camera3D::new()`, `resize(100,100)`; for azimuth 0..360° step 5° and elevation −89..=89° step 2°, every corner at ±CUBE_HALF projected through `view_projection()` has `clip.w > 0` and |clip.x/w|, |clip.y/w| < 0.95); `glow_quad_spans_the_bar_with_thickness`.
- [ ] **Step 5: `NotesViz` struct, GL render, tick/input.** Tests: `id_is_notes`; `set_zoom_is_a_no_op`; copy Sierpinski's four drag tests (`drag_with_primary_button_orbits`, `drag_without_primary_button_is_ignored`, `elevation_clamps_at_the_poles`, `pointer_down_and_up_do_not_perturb_orientation`); `tick_advances_auto_azimuth_by_cached_speed`; `update_smear_ignores_backward_jumps` (10 → 10.02 ≈ 0; 10.02 → 17 → 1.0; 17 → 3 → 0.0). Then write `render` per the order above. GL code is not unit-tested natively.
- [ ] **Step 6: Register:** `pub mod notes;` in `visualizations/mod.rs`; registry arm + `LAB_IDS`; test `notes_lab_pairs_rule_and_viz` (`build_lab("notes")` → rule id "notes", viz id "notes", `max_iterations_of(&rule_cfg, 1) == u32::MAX`, `rule_cfg["notes"] == [60]`, `viz_cfg["figure"] == [0,0,0,0]`).
- [ ] **Step 7: Browser tests** in `tests/wasm.rs` (section `// ---- "notes" lab ----` after sorting, same `make_canvas`/`cmd` helpers, unique canvas ids): `notes_lab_constructs_and_renders` (new with Some("notes"), `frame(0.0)`, `frame(16.0)`, `lab_id() == "notes"`); `notes_schemas_expose_notes_and_layout_rects`; `notes_renders_one_two_and_three_notes` (`update_rule_config` `{"notes":[60]}` → frame, summary period 1; `{"notes":[60,67]}` → `StepForward` ×2, frame, period 2, closed true; `{"notes":[60,64,67]}` → frame, period 4, notes.length 3); `notes_et_toggle_keeps_the_period` (`{"notes":[60,67],"just_intonation":false}` → period 2, `just_intonation == false`, frame); `notes_accepts_figure_and_strip_rects` (`resize(64,64)`; viz_config with `figure = [8,8,48,48]`, `strip = [8,58,48,6]` via `update_viz_config`; `viz_config().figure` echoes; frame with 2 and with 3 notes); `notes_3d_drag_forwards_and_renders` (3 notes; PointerDown, PointerMove dx 20 dy 10 buttons 1, PointerUp; two frames); `notes_playback_is_effectively_unbounded` (`SetSpeed 8`, `Play`, frames at 0/250/500/750/1000 ms → `iteration >= 7`, `playing == true`, `max_iterations == 4294967295`); `notes_set_zoom_is_harmless`.
- [ ] **Step 8: Validate:** `cargo fmt --all`, `cargo fmt --all --check`, `cargo clippy --all-targets --all-features`, `cargo test --all-features`; then `wasm-pack test --chrome --headless crates/viz-core`. If chromedriver is missing or mismatched (SIGKILL / version error), download the Chrome-for-Testing driver matching the installed Chrome (`"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --version`, e.g. 154.0.8037.93) from `https://storage.googleapis.com/chrome-for-testing-public/<version>/mac-arm64/chromedriver-mac-arm64.zip` into the session scratchpad directory named in your dispatch, unzip it, and rerun with `wasm-pack test --chrome --headless --chromedriver=<path to chromedriver> crates/viz-core` (the flag must precede the crate path). If the download is impossible in your environment, say so in the report (DONE_WITH_CONCERNS) — the controller runs the browser suite. Never run `wasm-pack test` concurrently with another cargo build. Finally `wasm-pack build crates/viz-core --target web --out-dir pkg`. Write the report.

---

### Task 3: Web pure modules — shared audio context, theory, picker, speed, layout, summary, notes audio

**Files:**
- Create: `web/src/lib/audio/context.ts`, `web/src/lib/audio/__tests__/context.test.ts`, `web/src/lib/test/stubAudio.ts`
- Modify: `web/src/lib/sorting/audio.ts` (import from `../audio/context`, re-export the two types, delete the local copies and `clamp01`), `web/src/lib/sorting/__tests__/audio.test.ts` (import `param`/`makeStubContext` from `../../test/stubAudio`, delete the local definitions at lines 125-159; no assertion changes)
- Create: `web/src/lib/notes/theory.ts`, `picker.ts`, `speed.ts`, `layout.ts`, `summary.ts`, `audio.ts` and `web/src/lib/notes/__tests__/{theory,picker,speed,layout,summary,audio}.test.ts`
- Modify: `web/src/lib/test/fakeViz.ts` (add `notesSummaryFixture` and return it from `rule_summary()` when the lab is `'notes'`)

**Interfaces produced:**

```ts
// audio/context.ts
export type AudioContextLike = Pick<AudioContext, 'currentTime' | 'destination' | 'state' | 'resume' | 'close' | 'createOscillator' | 'createGain' | 'createDynamicsCompressor'>;
export type AudioContextFactory = () => AudioContextLike | null;
export const defaultContextFactory: AudioContextFactory;   // webkit fallback; null where there is no AudioContext (jsdom)
export function clamp01(v: number): number;                // NaN → 0
// test/stubAudio.ts
export function param(value?: number): { value; setTargetAtTime: Mock; cancelScheduledValues: Mock; setValueAtTime: Mock; exponentialRampToValueAtTime: Mock };
export function makeStubContext(): { ctx: AudioContextLike; raw: …; oscillators: … };   // exactly the helpers moved from the sorting test
// notes/theory.ts
export const NOTE_NAMES: readonly string[];   // 12: 'C','D♭','D','E♭','E','F','F♯','G','A♭','A','B♭','B' (index = midi % 12; the ♭/♯ glyphs live here only)
export function noteName(midi: number): string;      // 69 → 'A'
export function noteLabel(midi: number): string;     // 60 → 'C4' (octave = floor(midi/12) − 1)
export function midiToHz(midi: number): number;      // 440 · 2^((midi − 69)/12)
export const JUST_RATIOS: readonly { num: number; den: number }[];  // the 12-entry table from the Global Constraints
export function justRatio(semitones: number): { num: number; den: number };  // wraps octaves like Rust (12 → 2/1, 19 → 3/1, −7 → 2/3)
export function etRatio(semitones: number): number;
export const NOTE_COLORS: { bars: readonly [string, string, string]; trail: string; sum: string };  // '#F2B23C', '#F0665C', '#6CC68E', '#F5E6CC', '#E6E9EE'
export const PICKER_RANGE: readonly number[];        // 60..=72 (13)
// notes/picker.ts
export const MIN_NOTES = 1; export const MAX_NOTES = 3;
export function toggleNote(notes: readonly number[], midi: number): readonly number[];  // append when absent (max 3), remove when present (min 1), order of the others preserved; returns the SAME reference when refused (4th note, last note, midi outside PICKER_RANGE)
export function sanitizeNotes(candidates: readonly number[]): number[];   // integers within PICKER_RANGE, dedupe (first wins), first MAX_NOTES; may be []
export function parseNotesParam(raw: string | null): number[] | undefined; // '60,67' → [60, 67]; nothing valid → undefined
export function formatNotesParam(notes: readonly number[]): string;        // '60,67'
// notes/speed.ts
export const MIN_HZ = 0.25; export const MAX_HZ = 1000; export const RAMP_MS = 2500; export const DEFAULT_SPEED_HZ = 0.5;
export function sliderToHz(t: number): number;   // MIN_HZ · (MAX_HZ / MIN_HZ) ** clamp01(t)
export function hzToSlider(hz: number): number;  // inverse, clamped to [0, 1]
export function formatHz(hz: number): string;    // < 10 → 2 dp ('0.50 Hz'), < 100 → 1 dp ('15.8 Hz'), else 0 dp ('262 Hz')
export function rampSpeedAt(from: number, to: number, t: number): number;  // from · (to/from) ** clamp01(t), from floored at 0.01
// notes/layout.ts
export interface Rect { x: number; y: number; w: number; h: number }   // CSS px, canvas-local, y-down
export type DeviceRect = [number, number, number, number];
export const MARGIN = 16; export const BAR_INSET = 0.12;
export function notesLayout(cssW: number, cssH: number): { figure: Rect; strip: Rect };  // landscape (w ≥ h): side = min(h − 2M, 0.6·(w − 3M)), figure at x = M vertically centred, strip x = 2M + side, w = cssW − side − 3M, y = M, h = cssH − 2M; portrait: side = min(w − 2M, 0.6·(h − 3M)), figure y = M horizontally centred, strip below (y = 2M + side, h = cssH − side − 3M, x = M, w = cssW − 2M); any side ≤ 0 → both rects all-zero
export function toDevice(r: Rect, dpr: number): DeviceRect;   // Math.round each component
export function labelAnchors(figure: Rect): { bars: [Point, Point, Point]; ratio: Point };  // s = figure.w: bars [(x + 0.06s, y + 0.88s), (x + 0.88s, y + 0.06s), (x + 0.94s, y + 0.88s)], ratio (x + 0.5s, y + 0.94s)
// notes/summary.ts
export interface NoteSummary { midi: number; ratio: number; num: number | null; den: number | null; displacement: number }
export interface NotesSummary { phase: number; period: number; closed: boolean; just_intonation: boolean; notes: NoteSummary[] }
export function readSummary(raw: unknown): NotesSummary | null;  // finite-number/boolean checks; notes length 1–3; num/den both == null → both null; a half-set pair → null; returns a fresh copy
export function swingCount(note: NoteSummary, period: number): number | null;  // num · period / den; null without a fraction
export function swingLabel(note: NoteSummary, s: NotesSummary): string;  // just: 'C ×2'; piano: 'G ×3.00' (period × ratio, 2 dp); × is U+00D7
export function ratioLabel(s: NotesSummary): string;  // notes sorted by midi ascending; counts joined by ' : '; just → integers ('2 : 3', '4 : 5 : 6'); piano → period × ratio with 2 dp, root bare ('4 : 5.04 : 5.99'); one note → ''
export function tileReadout(s: NotesSummary | null): string;   // '1.3 / 2 swings'; null → 'Tuning up'
export function tileProgress(s: NotesSummary | null): number;  // closed ? 1 : min(1, phase / period); 0 for null
// notes/audio.ts
export const VOICE_LEVEL = 0.18; export const AUDIBLE_FROM_HZ = 20; export const AUDIBLE_FULL_HZ = 30;
export function audibility(speedHz: number): number;   // clamp01((speedHz − 20) / 10)
export interface VoiceTarget { freq: number; gain: number }
export interface NotesFrame { playing: boolean; speedHz: number; ratios: readonly number[] }
export function voicePlan(speedHz: number, ratios: readonly number[], playing: boolean, muted: boolean): VoiceTarget[];  // freq = speedHz · ratio; gain = playing && !muted ? VOICE_LEVEL / n · audibility(speedHz) : 0
export class NotesAudio { constructor(createContext?: AudioContextFactory, volume?: number); get muted; get volume; get supported; setVolume(v); setMuted(m); update(frame: NotesFrame): void; destroy(): void }
```

`NotesAudio` mirrors `SortingAudio`: starts muted; `setMuted(false)` creates and resumes the context (master GainNode → DynamicsCompressor → destination); `update` rebuilds the voices when `ratios.length` changes (stop the old oscillators; start sine oscillators with per-voice gains at 0), then per voice calls `frequency.setTargetAtTime(freq, now, 0.01)` / `gain.setTargetAtTime(gain, now, 0.02)` ONLY when the target differs from the last value sent (reset the memo when voices are rebuilt); `setVolume` applies the squared curve; `destroy` stops every voice and closes the context. `notesSummaryFixture`: `{ phase: 0, period: 2, closed: false, just_intonation: true, notes: [{ midi: 60, ratio: 1, num: 1, den: 1, displacement: 0 }, { midi: 67, ratio: 1.5, num: 3, den: 2, displacement: 0 }] }`.

- [ ] **Step 1 (shared audio context):** create `stubAudio.ts` by moving the helpers; update the sorting test's imports; `npx vitest run src/lib/sorting` stays green. Write `audio/__tests__/context.test.ts` (red): `defaultContextFactory()` is null in jsdom; returns an instance when `globalThis.AudioContext` is stubbed (restore after); falls back to `webkitAudioContext`; `clamp01` 0.3 → 0.3, 1.7 → 1, −1 → 0, NaN → 0. Create `context.ts`, rewire `sorting/audio.ts` (green).
- [ ] **Step 2 (theory):** test (red): all 12 `JUST_RATIOS`; `justRatio(12) = {2,1}`, `(19) = {3,1}`, `(7) = {3,2}`, `(-7) = {2,3}`; `midiToHz(69) = 440`, `(60) ≈ 261.63`, `(72) ≈ 523.25`; `etRatio(12) = 2`, `(7) ≈ 1.4983`; `noteName(69) = 'A'`, `(66) = 'F♯'`, `(61) = 'D♭'`, `(70) = 'B♭'`; `NOTE_NAMES` length 12 with flats at 1, 3, 8, 10 and the sharp at 6; `noteLabel(60) = 'C4'`, `(72) = 'C5'`; `PICKER_RANGE` 60…72; `NOTE_COLORS` are `#rrggbb`. Implement (green).
- [ ] **Step 3 (picker):** test (red): `[60] + 64 → [60, 64]`; `[60, 64, 67] − 64 → [60, 67]`; 4th refused (same reference); removing the only note refused; out-of-range refused; `sanitizeNotes([60, 60, 67, 999, 61.5, NaN, 72, 64]) → [60, 67, 72]`; `parseNotesParam('60,67') = [60, 67]`, `('69,76,81') = [69]`, `('abc')`, `('')`, `(null)` → undefined; `formatNotesParam([60, 67]) = '60,67'`. Implement.
- [ ] **Step 4 (speed):** test (red): `sliderToHz(0) = 0.25`, `(1) = 1000`, `(0.5) ≈ 15.81`; round trips for t ∈ {0, 0.25, 0.5, 0.75, 1}; clamps (`hzToSlider(0.1) = 0`, `(5000) = 1`, `sliderToHz(2) = 1000`, `(-1) = 0.25`); `formatHz(0.5) = '0.50 Hz'`, `(15.81) = '15.8 Hz'`, `(261.63) = '262 Hz'`, `(440) = '440 Hz'`; `rampSpeedAt(0.5, 440, 0) = 0.5`, `(…, 1) = 440`, `(…, 0.5) ≈ sqrt(0.5 · 440)`, `rampSpeedAt(440, 0.5, 1) = 0.5`, `from = 0` gives a finite result. Implement.
- [ ] **Step 5 (layout):** test (red): landscape 1168×650 → figure square at x = 16, vertically centred, strip x = figure.x + figure.w + 16, strip right edge = 1168 − 16, no overlap; a wide-but-short stage caps the square at 60% of the free width; portrait 343×420 → square on top (y = 16, horizontally centred), strip below with bottom margin 16; 0×0 and 20×20 → all zeros; `toDevice` for dpr 1, 2, 1.5; `labelAnchors({x:10, y:20, w:100, h:100})` → bars [(16, 108), (98, 26), (104, 108)], ratio (60, 114). Implement.
- [ ] **Step 6 (summary):** add the fixture to `fakeViz.ts`; test (red): accepts the fixture and returns a fresh copy; rejects null/undefined/42/the sorting and Fourier fixtures; rejects `phase: NaN`, `period: '2'`, `closed: 'no'`, missing `just_intonation`; rejects `notes: []`, four notes, `ratio: 'x'`; `num`/`den` both undefined or both missing → both null; half-set → null; `swingCount` C → 2, G → 3; `swingLabel` 'C ×2', 'G ×3'; piano note (ratio 1.4983, period 2, `just_intonation: false`) → 'G ×3.00'; `ratioLabel` just → '2 : 3'; piano triad (period 4, ratios 1, 1.2599, 1.4983, midis 60/64/67) → '4 : 5.04 : 5.99'; one note → ''; `tileReadout` '1.3 / 2 swings', null → 'Tuning up'; `tileProgress` 0.65, 1 when closed, 0 for null. Implement.
- [ ] **Step 7 (audio):** test (red, with `stubAudio`): `audibility(10) = 0`, `(20) = 0`, `(25) = 0.5`, `(30) = 1`, `(400) = 1`; `voicePlan(440, [1, 1.5], true, false)` → freqs [440, 660], gains VOICE_LEVEL/2; `voicePlan(15, …)` → gains 0, freqs set; paused or muted → gains 0; `[]` → `[]`; three ratios → VOICE_LEVEL/3. `NotesAudio`: starts muted and `update` never calls the factory; unmute creates + resumes the context and builds one compressor; `update` with 2 ratios → 2 oscillators of type 'sine', each started once, `setTargetAtTime(freq, now, 0.01)` and `(gain, now, 0.02)` with the planned values; an identical second `update` adds no calls; 3 ratios stop the 2 old oscillators and start 3 new; mute drives every gain to 0; volume squared curve + clamp; null factory → `supported` false and `update` does not throw; `destroy` stops every oscillator and closes the context. Implement.
- [ ] **Step 8: Validate:** from `web/`: `npm run check`, `npm test`. Write the report.

---

### Task 4: `NotesLab.svelte`, router and App registration

**Files:**
- Create: `web/src/lib/components/labs/NotesLab.svelte`, `web/src/lib/components/__tests__/NotesLab.test.ts`
- Modify: `web/src/lib/router.ts` (`LabId` + `LAB_IDS` gain `'notes'`; `buildQuery` keeps raw commas: post-pass `.replace(/%2C/g, ',')`), `web/src/lib/__tests__/router.test.ts` (add `parseHash('#/notes?n=60,67') === 'notes'` and `buildQuery({ n: '60,67' }) === 'n=60,67'` with a `URLSearchParams` round trip), `web/src/App.svelte` (tab `<a href="#/notes" aria-current={route.id === 'notes' ? 'page' : undefined}>Notes <span class="rest">&amp; Chords</span></a>` after Sorting; route branch `{:else if route.id === 'notes'}<NotesLab />` before the Sierpinski fallback; import), `web/src/lib/components/__tests__/App.test.ts` (tabs 3 → 4; the home link for Notes & Chords → `#/notes`; on `navigate('notes')` the active tab text is 'Notes & Chords')

**Depends on:** Task 3 modules.

**The component** (follow `SortingLab.svelte` closely):
- State: `notes = $state<number[]>([60])`, `just = $state(true)`, `speedHz = $state(DEFAULT_SPEED_HZ)`, `muted`/`volume` mirrors of a `new NotesAudio()`, `summary = $state<NotesSummary | null>(null)`, `layout = $state(notesLayout(0, 0))`, `api = $state<LabApi | null>(null)`, plain `appliedQuery`, `overlayEl`, `ro`, ramp handle/start values. Derived: `rootMidi = notes[0]`, `rootHz = midiToHz(rootMidi)`, `full = notes.length >= MAX_NOTES`.
- `paramsOf(query)` → `{ notes?: number[]; equal: boolean }` via `parseNotesParam`/`sanitizeNotes` and `t === 'equal'`; `syncUrl()` builds `{ n: notes equal to [60] ? undefined : formatNotesParam(notes), t: just ? undefined : 'equal' }`; the route-query `$effect` with `untrack` + `appliedQuery` guard (copy of sorting's); `applyNotes()`/`applyTuning()` → `patchRuleConfig({ notes: $state.snapshot(notes), just_intonation: just })` → `cmd.play()` → `syncUrl()`; `onChip(midi)` uses `toggleNote` and does nothing when the same reference comes back; `onTogglePlay()` (cancel ramp, `TogglePlay`); `onRestart()` (cancel ramp, `Reset`, `Play`); `onSpeedInput(e)` (cancel ramp, `speedHz = sliderToHz(value)`, dispatch `SetSpeed`); `startRealPitch()` (rAF ramp from `speedHz` to `rootHz` over `RAMP_MS` using `rampSpeedAt`, writing `speedHz` and dispatching each tick, exact target on the last tick; mirrors `LabShell.startRamp`); `cancelRamp()`; `toggleMute()`/`onVolume(e)` as sorting; `pushLayout()` (canvas = `overlayEl.closest('.stage')?.querySelector('canvas')`; `layout = notesLayout(canvas.clientWidth, canvas.clientHeight)`; `api.patchVizConfig({ figure: toDevice(layout.figure, dpr), strip: toDevice(layout.strip, dpr) })`); `observeResize()` (ResizeObserver on the overlay when defined + window resize); `onReady(a)` (set `api`, `SetSpeed DEFAULT_SPEED_HZ`, unconditional `patchRuleConfig({ notes, just_intonation })`, `Play`, canonical `syncUrl()` when the link differed, `pushLayout()`, `observeResize()`); `onDestroy` (ramp, observer, resize listener, `audio.destroy()`).
- Per-frame `$effect`: read `a.snapshot`, then `const next = readSummary(a.readSummary()); summary = next; audio.update({ playing: a.snapshot.playing, speedHz: a.snapshot.speed, ratios: next?.notes.map(n => n.ratio) ?? [] })` — never read `summary` inside it.
- Markup: `<LabShell labId="notes" title="Notes &amp; Chords" thesis="Every note is a vibration; two or three at once draw the shape of their interval." playback={false} zoom={false} {onReady}>`. `controls` snippet in bezel order: transport `.group` (Play/Pause `btn primary` with `Icon play|pause` from `api?.snapshot.playing`; Restart `btn` with `rotate-ccw`); `label.speed` "Swings per second" (`input type="range" min="0" max="1" step="0.001" value={hzToSlider(speedHz)} aria-label="Swings per second"`, `.value.mono` = `formatHz(speedHz)`); "Real pitch" `btn` (`title="Speed up to {formatHz(rootHz)}, the real pitch of {noteLabel(rootMidi)}"`); tuning `.group` with two `btn` "Pure ratios" / "Piano" (`aria-pressed`); picker `.group.picker` of 13 `btn chip` buttons (`aria-pressed={selected}`, `disabled={!selected && full}`, `title` = "Pick up to three notes" when disabled, visible text `noteLabel(midi)`, an `aria-hidden` badge with the order 1/2/3 when selected, `style="--note-color: {NOTE_COLORS.bars[order]}"`); sound `.group` copied from sorting (`class="btn mute"`, `aria-pressed={!muted}`, `aria-label="Sound"`, volume range disabled when muted). `overlay` snippet: `<div class="marks" bind:this={overlayEl}>` (pointer-events none) with one absolutely positioned `.note-label` per summary note at `labelAnchors(layout.figure).bars[i]` (colour `NOTE_COLORS.bars[i]`, text `swingLabel`), and `.ratio` at the ratio anchor when `summary.notes.length > 1` (text `ratioLabel`). `legend`: 5 `.item` swatches with inline `style="background: …"` (Note 1 (left bar), Note 2 (top bar), Note 3 (right bar), Trail, Sum line). `story`: `<h2>How it works</h2>`, paragraphs (every note is a vibration — the dot on each bar is where that vibration is right now; two notes drive one pen left-right and up-down, and a 3 : 2 ratio closes its loop after two swings of the first note; speed the swings past about twenty per second and the motion becomes a pitch — 262 swings a second is middle C; simple ratios draw simple shapes, which is harmony; piano tuning rounds every ratio off, so its shapes never quite sit still), and `.tip` paragraphs for the picker, the speed slider / Real pitch, the tuning toggle, Sound, and the share link (`?n=` and `&t=equal`).
- CSS: `.speed`, `.sound` as sorting; `.btn.chip[aria-pressed="true"]` with `border-color: var(--note-color)` and the badge in `var(--note-color)` on a dark pill (never the colour as plain text on paper); `.btn.chip:disabled` dimmed; `.marks` absolute inset 0, `pointer-events: none`; `.note-label`/`.ratio` absolutely positioned (`left`/`top` from the anchors in CSS px with `transform: translate(-50%, 4px)` for bottom labels and `translate(6px, -50%)` for the top bar's label), mono, 12–13px, light text on a translucent dark backing like sorting's `.badge`.

**Tests** (`NotesLab.test.ts`; same two `vi.mock`s as `SortingLab.test.ts` — loader and `textPath` — `installRafPolyfill()`, `renderLab(query = '')` = `navigate('notes', query)` → `render(App)` → `waitFor` a Play dispatch; `beforeEach` clears `dispatchSpy`, `updateRuleConfigSpy`, `updateVizConfigSpy`; build chip names with `noteLabel()` and label text with `swingLabel`/`ratioLabel` on the fixture so no glyph is typed in the test):
- shell: h1 "Notes & Chords"; `.readout`, `.clock`, `.zoom` absent; Play and Restart buttons with svg icons; 13 `.chip` buttons; the C4 chip `aria-pressed="true"`, all others false; on ready `update_rule_config` called with `objectContaining({ notes: [60], just_intonation: true })` and `SetSpeed 0.5` dispatched before `Play`.
- picker: clicking E4 → last `update_rule_config` has `notes: [60, 64]` followed by a `Play` dispatch; E4's badge reads "2"; selecting G4 too → every unselected chip `disabled` with a title and a click on one pushes nothing; deselecting C4 → `notes: [64, 67]` and E4's badge reads "1"; fresh mount, clicking C4 → still pressed, push count unchanged (1).
- transport: Play dispatches `TogglePlay`; Restart dispatches `Reset` then `Play`.
- tuning: "Pure ratios" pressed and "Piano" not; click Piano → push with `just_intonation: false` then Play, pressed states flip; clicking Piano again → no new push.
- speed: `fireEvent.input(getByLabelText('Swings per second'), { target: { value: '0.5' } })` → last `SetSpeed` value `toBeCloseTo(sliderToHz(0.5))` and the readout shows `formatHz(sliderToHz(0.5))`.
- Real pitch: `vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValue(10_000)`; click "Real pitch"; `waitFor` the last `SetSpeed` to be `toBeCloseTo(midiToHz(60), 1)` and the readout '262 Hz'; restore the spy; with `?n=69` the ramp ends at 440.
- sound: the two sorting sound tests adapted (muted start, disabled volume, toggle flips `aria-pressed`/icon/title, volume enables at 0.5).
- layout + overlay: `update_viz_config` called with `figure` and `strip` arrays of 4 integers; two `.note-label`s reading `swingLabel` of the fixture notes; `.ratio` reads `ratioLabel(fixture)` ('2 : 3'); mutate `notesSummaryFixture.notes` to one note → `.ratio` absent (restore in `finally`).
- URL: `?n=60,67` → push with `notes: [60, 67]`, C4 badge "1", G4 badge "2", `location.hash === '#/notes?n=60,67'`; `?n=60,67&t=equal` → `just_intonation: false` and Piano pressed; `?n=abc` → `#/notes`; `?n=60,61,62,63` → `#/notes?n=60,61,62`; `?n=69,76,81` → `#/notes?n=69`; selecting a note after mount updates the hash; `t=equal` appears only in piano mode.
- legend: 5 `.legend .swatch`; story: `h2` "How it works" and at least one `.tip`.

- [ ] **Step 1:** router changes + router tests (red → green).
- [ ] **Step 2:** write `NotesLab.test.ts` scaffold and the shell/picker tests (red); create `NotesLab.svelte` with state, picker, transport, tuning and the on-ready push; wire `App.svelte` (route + tab) so the test can render it (green).
- [ ] **Step 3:** speed slider, Real pitch ramp, sound tests (red) → implement (green).
- [ ] **Step 4:** layout push, overlay labels, URL params, legend, story tests (red) → implement (green).
- [ ] **Step 5:** update `App.test.ts` (4 tabs + Notes link); `npm run check`, `npm test` from `web/`. Write the report.

---

### Task 5: Home tile, docs

**Files:**
- Modify: `web/src/lib/components/Home.svelte`, `web/src/lib/components/__tests__/Home.test.ts`, `README.md`, `docs/testing.md`

**Depends on:** Tasks 2 and 4 (the test counts in `docs/testing.md` come from real runs of both suites).

**Home tile** (fourth entry in `tiles`, so the existing `clocks[2]` sorting assertion holds):
```ts
{
  lab: 'notes' as const,
  title: 'Notes & Chords',
  thesis: 'Two notes swing a dot left-right and up-down; the loop it draws is their interval.',
  setup: (api: LabApi) => {
    api.patchRuleConfig({ notes: [60, 67] });   // C4 + G4, a 3:2 that closes in two swings
    api.dispatch(cmd.setSpeed(0.5));
    api.dispatch(cmd.play());
  },
  readout: (api: LabApi) => tileReadout(readNotesSummary(api.readSummary())),
  done: (api: LabApi) => readNotesSummary(api.readSummary())?.closed ?? false,
  progress: (api: LabApi) => tileProgress(readNotesSummary(api.readSummary())),
}
```
(`import { readSummary as readNotesSummary, tileReadout, tileProgress } from '../notes/summary'` — the file already imports sorting's `readSummary`.) Copy: "Four small machines for looking at math."; the line-2 comment says four tiles; `.cards { grid-template-columns: repeat(2, 1fr); }` (≤900px stays one column).

**Home tests:** canvases 3 → 4 (lines 32 and 114); the unmount test waits for 3 Plays (Sierpinski, sorting, notes — Fourier never plays under the mock) and expects 4 frees (lines 48, 50; fix the comment); new cases: the notes tile pushes `notes: [60, 67]` and `SetSpeed 0.5`; its readout shows `tileReadout(notesSummaryFixture)` ('0.0 / 2 swings'); set `notesSummaryFixture.phase = 1` → the 4th clock width '50%'; set `closed = true` → the 4th tile shows `.done` "Done" with an svg (restore both in `finally`, as the sorting cases do); the thesis line contains "Four small machines".

**Docs:**
- `README.md` lines 7-38: "a gallery home page and **four** labs"; a bullet after Sorting: **Notes & Chords** (`#/notes`) — pick one to three notes from C4 to C5; each swings a dot on its own bar, two draw the Lissajous loop of their interval (a 3:2 closes after two swings of the first note), three draw a 3D curve in a turning cube; the speed slider is the first note's swings per second (0.25–1000 Hz), **Real pitch** ramps to its true frequency and **Sound** voices the notes once past about 20 swings per second; **Pure ratios** closes the loop, **Piano** tuning never quite does; share with `#/notes?n=60,67` (`&t=equal` for piano tuning). Project-layout tree: add `rules/notes.rs`, `visualizations/notes.rs`, `web/src/lib/audio/context.ts`, `web/src/lib/notes/`, `labs/NotesLab.svelte`, `test/stubAudio.ts` with one-line descriptions in the existing style.
- `docs/testing.md`: "four live tiles", "all four labs"; mention the notes lab's theory table, log speed mapping, layout, summary parsing and voice planner (against a stub AudioContext); replace the Rust/WASM/web test counts, file count, coverage percentages and the "As measured on" date with numbers from `cargo test --all-features` (count passing tests), `wasm-pack test` output if available (otherwise count `#[wasm_bindgen_test]` in `tests/wasm.rs`), and `npm run coverage`.

- [ ] **Step 1:** Home tests (red) → tile + copy + grid (green).
- [ ] **Step 2:** README and docs/testing.md.
- [ ] **Step 3:** `npm run check`, `npm test`, `npm run coverage` from `web/`; `cargo test --all-features` from the root for the count. Write the report.
