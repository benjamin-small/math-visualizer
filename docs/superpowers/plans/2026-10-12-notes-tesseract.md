# Notes & Chords: Four Notes and the Tesseract — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Notes & Chords lab play four notes (single picks or seventh chords) and draw them as a curve inside a tesseract that turns through the fourth dimension.

**Architecture:** The Rust rule accepts four notes; the Rust visualization gains a fourth bar, pure 4D helpers (`rotate_4d`, `project_4d`, `tesseract_edges`) and a `draw_figure_4d` that feeds the existing 3D line/point batches and camera. The viz owns the 4D angle (advanced in `tick`) and exposes it through a new `Visualization::readout()` → `Engine::viz_readout()`; the Svelte lab reads it every frame for its slider and pushes `turn_4d` / `angle_4d` through the viz config only on user input.

**Tech Stack:** Rust (wasm-bindgen, serde, WebGL2 via `web-sys`), Svelte 5 + TypeScript, Vitest + Testing Library, wasm-pack tests in headless Chrome.

**Spec:** `docs/superpowers/specs/2026-10-12-notes-tesseract-design.md`

## Global Constraints

- Branch: `notes-tesseract` (the spec is already committed there). `main` is PR-only; nothing is pushed until the final PR.
- Validation (AGENTS.md): `cargo fmt --all --check`, `cargo clippy --all-targets --all-features`, `cargo test --all-features`; web: `cd web && npx vitest run` and `npx svelte-check`; wasm: `wasm-pack test --chrome --headless --chromedriver=<path> crates/viz-core` (flag **before** the crate path; never concurrently with another cargo build).
- Axes: (x, y, z, w) = (note 2, root, note 3, note 4), each displacement × `CUBE_HALF` (0.5).
- 4D turn: rotate in the x–w plane, then the z–w plane, both by θ. Perspective `p = D / (D − w′)` with `D = 3 · CUBE_HALF`, then × `FIT_4D = 0.645` (just under √(5/12) ≈ 0.6455, the worst case over a full turn), so the projected tesseract stays within radius `√3 · CUBE_HALF`.
- Fourth note colour: `#7FA8E8` = `[0.498, 0.659, 0.910, 1.0]` (Rust default is the truth; JS `NOTE_COLORS` copies it). If the mockup step changes it, change both places.
- Viz config fields: `turn_4d: bool` (default `true`), `turn_4d_speed: f32` (rad/s, default `0.35`), `angle_4d: f32` (rad, default `0`), all `#[serde(default)]`. `angle_4d` is taken only when `turn_4d` is false.
- Readout shape: `{ "angle_4d": <radians in [0, 2π)> }`; every other visualization returns `null`.
- Seventh chord ids, labels and steps, in this order after the triads: `dom7` "Dom7" [0,4,7,10], `maj7` "Maj7" [0,4,7,11], `min7` "Min7" [0,3,7,10], `halfdim7` "Half-dim7" [0,3,6,10], `dim7` "Dim7" [0,3,6,9].
- Picker range stays C3–B5 (midi 48–83). `MAX_NOTES = 4` on both sides.
- Copy: sentence case, no emoji, ♯/♭ glyphs only in `.ts` files (a repo test scans `.svelte` files).
- Match the surrounding code: doc comments on every pub item in Rust, JSDoc on exported TS, comment density like the neighbours.

## Review Focus

1. **A layout or resize push while the 4D figure is turning** must not snap the angle back to the stale `angle_4d` left in the stored viz config → Task 4 tests `apply_turn_config` with `turn_4d: true` and a non-zero `angle_4d`.
2. **Dropping from four notes to three (or Reset) while the turn is held** must leave the 3D cube exactly as before and the controls hidden; picking four again shows the held angle → Task 8 test "hides the 4D controls below four notes and keeps the held angle".
3. **A seventh chord near the top** (Maj7 on C♯5 needs B♯5 = 84) must grey the root out, not build a three-note chord → Task 5 `chordOn(73, 'maj7')` is undefined, and Task 8 checks C♯5 is `aria-disabled` under Maj7.
4. **A link with five notes or `c=dom7` plus three notes** loads the first four notes and the chord mode without re-voicing → Task 5 `parseNotesParam('60,64,67,70,72')` and Task 8 link test.
5. **Interior trail points, not just corners, staying inside the camera view** at every θ → Task 3 samples random interior points as well as corners.

---

## Task 0: Mockup and look approval (controller only, no code)

**Files:** scratchpad only (nothing committed).

- [ ] **Step 1:** Build a static HTML mockup in the session scratchpad of (a) the bezel: Pick label, row 1 radios (Single notes … Sus4), a small "Sevenths" label and row 2 (Dom7 … Dim7), and the 4D controls ("4D turn" slider with a `123°` mono readout and a "Turn" toggle) styled like the existing pills; (b) the stage at 1168×650: figure square with four bars (fourth in `#7FA8E8` in the bottom gutter), a tesseract wireframe with a curve, and the ratio pill `20 : 25 : 30 : 36` in the strip's top-left corner. Light and dark.
- [ ] **Step 2:** Capture with the headless capture script used for the redesign and show the user. Record the approved fourth colour; if it differs from `#7FA8E8`, update Global Constraints before dispatching Tasks 4 and 5.

---

## Task 1: Rule accepts four notes

**Files:**
- Modify: `crates/viz-core/src/rules/notes.rs` (`MAX_NOTES` near line 32; tests module)

**Interfaces:**
- Produces: `pub const MAX_NOTES: usize = 4;` (schema `maxItems` already reads it).

- [ ] **Step 1: Write the failing tests** (in the rule's `mod tests`, next to `config_parses_with_missing_fields`)

```rust
    #[test]
    fn keeps_four_notes_and_drops_a_fifth() {
        let cfg = NotesConfig {
            notes: vec![60, 64, 67, 70, 72],
            ..NotesConfig::default()
        };
        assert_eq!(cfg.effective_notes(), vec![60, 64, 67, 70]);
        assert_eq!(NotesConfig::schema()["properties"]["notes"]["maxItems"], 4);
    }

    #[test]
    fn a_pure_dominant_seventh_closes_after_twenty_root_swings() {
        // C E G B♭: 1, 5/4, 3/2, 9/5 in the 5-limit table, so 20 : 25 : 30 : 36.
        let cfg = NotesConfig {
            notes: vec![60, 64, 67, 70],
            ..NotesConfig::default()
        };
        let state = Notes.init(&cfg, 0);
        assert_eq!(state.notes.len(), 4);
        assert_eq!(state.period, 20);
        let summary = Notes.summary(&state);
        let notes = summary["notes"].as_array().unwrap();
        assert_eq!(notes.len(), 4);
        assert_eq!((notes[3]["num"].as_u64(), notes[3]["den"].as_u64()), (Some(9), Some(5)));
    }
```

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test -p viz-core --lib rules::notes -- four_notes dominant_seventh`
Expected: FAIL (`effective_notes` returns three notes; `maxItems` is 3; `state.notes.len()` is 3).

- [ ] **Step 3: Implement**

Change `pub const MAX_NOTES: usize = 3;` to `pub const MAX_NOTES: usize = 4;` and update its doc comment to say "one per bar: left, top, right, bottom". Search the file for doc comments that say "three" or "at most 3" about the note count and update them.

- [ ] **Step 4: Run the rule tests**

Run: `cargo test -p viz-core --lib rules::notes`
Expected: all PASS. If an existing test asserted a three-note cap (e.g. a fourth note dropped), change it to a fifth note being dropped.

- [ ] **Step 5: Commit**

```bash
git add crates/viz-core/src/rules/notes.rs
git commit -m "feat(rule): notes accepts four notes; a pure dominant seventh closes after 20 swings"
```

---

## Task 2: Visualization readout through the engine

**Files:**
- Modify: `crates/viz-core/src/traits.rs` (`Visualization` trait, after `set_zoom`)
- Modify: `crates/viz-core/src/engine/erased.rs` (`ErasedVisualization` trait and `TypedViz` impl)
- Modify: `crates/viz-core/src/engine/mod.rs` (next to `rule_summary`, ~line 194)
- Test: `crates/viz-core/src/traits.rs` (new `mod tests`)

**Interfaces:**
- Produces: `Visualization::readout(&self) -> serde_json::Value` (default `Value::Null`); `ErasedVisualization::readout(&self) -> Value`; `Engine::viz_readout(&self) -> JsValue` (wasm-bindgen, JS name `viz_readout`).

- [ ] **Step 1: Write the failing test** (the erased wrapper's forwarding is pinned in Task 4, once `NotesViz` has a readout). Add to `traits.rs` tests (create `#[cfg(test)] mod tests` at the end of `traits.rs` if none exists) a minimal visualization:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    struct Bare;
    impl Visualization for Bare {
        type State = crate::rules::notes::NotesState;
        type Config = crate::visualizations::notes::NotesVizConfig;
        fn id(&self) -> &'static str {
            "bare"
        }
        fn init(&mut self, _gl: &WebGl2RenderingContext, _cfg: &Self::Config) {}
        fn render(&mut self, _gl: &WebGl2RenderingContext, _s: &Self::State, _c: &Self::Config) {}
    }

    #[test]
    fn readout_defaults_to_null() {
        assert_eq!(Bare.readout(), serde_json::Value::Null);
    }
}
```

(Use the import paths that compile in this crate; `NotesState` / `NotesVizConfig` are just convenient existing types that satisfy the bounds.)

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test -p viz-core --lib readout`
Expected: FAIL to compile (`no method named readout` on `Bare`).

- [ ] **Step 3: Implement**

`traits.rs`, inside `pub trait Visualization`, after `set_zoom`:

```rust
    /// Optional read-only snapshot of view state the UI mirrors every frame
    /// (e.g. the notes lab's 4D angle, which the viz advances in `tick`).
    /// Keep it cheap. Default: `null`.
    fn readout(&self) -> serde_json::Value {
        serde_json::Value::Null
    }
```

`erased.rs`: add `fn readout(&self) -> Value;` to `ErasedVisualization` (after `set_zoom`, with a one-line doc pointing at `Visualization::readout`), and in `impl<V> ErasedVisualization for TypedViz<V>`:

```rust
    fn readout(&self) -> Value {
        self.viz.readout()
    }
```

`engine/mod.rs`, after `rule_summary`:

```rust
    /// The active visualization's `readout()` (view state the UI mirrors,
    /// such as the notes lab's 4D angle); `null` for vizzes without one.
    pub fn viz_readout(&self) -> JsValue {
        to_js(&self.viz.readout())
    }
```

- [ ] **Step 4: Run tests**

Run: `cargo test -p viz-core --lib` then `cargo clippy --all-targets --all-features`
Expected: PASS, no new warnings.

- [ ] **Step 5: Commit**

```bash
git add crates/viz-core/src/traits.rs crates/viz-core/src/engine/erased.rs crates/viz-core/src/engine/mod.rs
git commit -m "feat(engine): visualizations can expose a readout, read with Engine::viz_readout"
```

---

## Task 3: Pure 4D helpers

**Files:**
- Modify: `crates/viz-core/src/visualizations/notes.rs` (new section after `cube_edges`; tests module)

**Interfaces:**
- Produces (all `pub`, in `visualizations::notes`):
  - `pub const FIT_4D: f32 = 0.645;`
  - `pub const PERSPECTIVE_4D: f32 = 3.0 * CUBE_HALF;` (the `D` above)
  - `pub fn rotate_4d(p: [f32; 4], theta: f32) -> [f32; 4]`
  - `pub fn project_4d(p: [f32; 4]) -> [f32; 3]`
  - `pub fn tesseract_edges(half: f32) -> [[[f32; 4]; 2]; 32]`

- [ ] **Step 1: Write the failing tests** (in `mod tests`)

```rust
    fn near4(a: [f32; 4], b: [f32; 4]) -> bool {
        a.iter().zip(b).all(|(x, y)| (x - y).abs() < 1e-5)
    }
    fn len3(p: [f32; 3]) -> f32 {
        (p[0] * p[0] + p[1] * p[1] + p[2] * p[2]).sqrt()
    }

    #[test]
    fn rotate_4d_is_the_identity_at_zero_and_periodic() {
        let p = [0.1, -0.2, 0.3, 0.4];
        assert!(near4(rotate_4d(p, 0.0), p));
        assert!(near4(rotate_4d(p, std::f32::consts::TAU), p));
        assert!(near4(rotate_4d(p, 1.0 + std::f32::consts::TAU), rotate_4d(p, 1.0)));
    }

    #[test]
    fn rotate_4d_keeps_y_and_brings_w_onto_x_at_a_quarter_turn() {
        let q = rotate_4d([0.0, 0.25, 0.0, 0.5], std::f32::consts::FRAC_PI_2);
        assert!((q[0] + 0.5).abs() < 1e-5, "x′ = −w, got {q:?}");
        assert!((q[1] - 0.25).abs() < 1e-6, "y is untouched");
    }

    #[test]
    fn rotate_4d_preserves_length() {
        let p = [0.3, -0.1, 0.2, -0.4];
        let l = |v: [f32; 4]| v.iter().map(|c| c * c).sum::<f32>();
        assert!((l(rotate_4d(p, 0.7)) - l(p)).abs() < 1e-5);
    }

    #[test]
    fn project_4d_shrinks_points_further_along_w() {
        let near = project_4d([0.3, 0.3, 0.3, -0.4]);
        let far = project_4d([0.3, 0.3, 0.3, 0.4]);
        // w toward the viewer (larger w) scales up; away scales down.
        assert!(len3(far) > len3(near));
        assert!((project_4d([0.0; 4])[0]).abs() < 1e-7);
    }

    #[test]
    fn the_turning_tesseract_stays_inside_the_cube_bounds() {
        let limit = 3f32.sqrt() * CUBE_HALF + 1e-4;
        let mut worst = 0f32;
        for k in 0u32..720 {
            let theta = std::f32::consts::TAU * k as f32 / 720.0;
            for [a, b] in tesseract_edges(CUBE_HALF) {
                for p in [a, b] {
                    worst = worst.max(len3(project_4d(rotate_4d(p, theta))));
                }
            }
            // Interior points (a trail lives inside the hypercube) too.
            for i in 0u32..16 {
                let f = |j: u32| ((i * 7 + j * 13 + k) % 17) as f32 / 16.0 * 2.0 - 1.0;
                let p = [f(1), f(2), f(3), f(4)].map(|c| c * CUBE_HALF);
                worst = worst.max(len3(project_4d(rotate_4d(p, theta))));
            }
        }
        assert!(worst <= limit, "worst radius {worst} > {limit}");
        assert!(worst > 0.97 * limit, "FIT_4D wastes the frame: {worst}");
    }

    #[test]
    fn tesseract_has_32_edges_each_along_one_axis() {
        let edges = tesseract_edges(0.5);
        assert_eq!(edges.len(), 32);
        for [a, b] in edges {
            let diff = (0..4).filter(|&i| (a[i] - b[i]).abs() > 1e-6).count();
            assert_eq!(diff, 1, "{a:?} → {b:?}");
            assert!(a.iter().chain(&b).all(|c| (c.abs() - 0.5).abs() < 1e-6));
        }
        // No edge appears twice.
        let mut keys: Vec<String> = edges.iter().map(|e| format!("{e:?}")).collect();
        keys.sort();
        keys.dedup();
        assert_eq!(keys.len(), 32);
    }
```

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test -p viz-core --lib visualizations::notes -- rotate_4d project_4d tesseract`
Expected: FAIL to compile (functions missing).

- [ ] **Step 3: Implement** (after `cube_edges`)

```rust
// ---- The fourth dimension ----

/// The 4D eye's distance along w: perspective scales a point by
/// `D / (D − w)`, so the far cube of a tesseract shrinks inside the near one.
pub const PERSPECTIVE_4D: f32 = 3.0 * CUBE_HALF;
/// Brings the perspective-projected tesseract back inside the 3D cube's
/// bounding sphere (radius `√3 · CUBE_HALF`) at every turn, so the camera
/// framing is unchanged. The worst case over a full turn is √(5/12) ≈ 0.6455;
/// pinned by `the_turning_tesseract_stays_inside_the_cube_bounds`.
pub const FIT_4D: f32 = 0.645;

/// Turns `p` = (x, y, z, w) by `theta` in the x–w plane and then in the z–w
/// plane. Periodic in 2π, so one slider covers every view; y (the root) is
/// never touched. At a quarter turn the fourth note lies along x.
pub fn rotate_4d(p: [f32; 4], theta: f32) -> [f32; 4] {
    let (s, c) = theta.sin_cos();
    let [x, y, z, w] = p;
    let (x, w) = (x * c - w * s, x * s + w * c);
    let (z, w) = (z * c - w * s, z * s + w * c);
    [x, y, z, w]
}

/// Perspective from 4D to 3D along w, then `FIT_4D`: larger w (nearer the 4D
/// eye) draws larger.
pub fn project_4d(p: [f32; 4]) -> [f32; 3] {
    let scale = FIT_4D * PERSPECTIVE_4D / (PERSPECTIVE_4D - p[3]);
    [p[0] * scale, p[1] * scale, p[2] * scale]
}

/// The tesseract `[-half, half]⁴` as its 32 edges: each joins two corners
/// that differ in exactly one coordinate.
pub fn tesseract_edges(half: f32) -> [[[f32; 4]; 2]; 32] {
    let corner = |bits: u32| -> [f32; 4] {
        std::array::from_fn(|axis| if bits & (1 << axis) != 0 { half } else { -half })
    };
    let mut out = [[[0.0; 4]; 2]; 32];
    let mut i = 0;
    for bits in 0..16u32 {
        for axis in 0..4 {
            let other = bits ^ (1 << axis);
            if other > bits {
                out[i] = [corner(bits), corner(other)];
                i += 1;
            }
        }
    }
    out
}
```

- [ ] **Step 4: Run tests**

Run: `cargo test -p viz-core --lib visualizations::notes`
Expected: PASS. If `worst > 0.97 * limit` fails only because the sampled worst is a hair lower, report the measured value rather than loosening silently.

- [ ] **Step 5: Commit**

```bash
git add crates/viz-core/src/visualizations/notes.rs
git commit -m "feat(viz): pure 4D helpers for the notes tesseract (rotate, project, edges)"
```

---

## Task 4: The fourth bar, the turn and `draw_figure_4d`

**Files:**
- Modify: `crates/viz-core/src/visualizations/notes.rs` (config, schema, `BarSide`, `layout`, `glow_quad`, `draw_bars`, `NotesViz` fields/`new`/`init`/`tick`/`render`, new `draw_figure_4d`, `readout`; tests)
- Modify: `crates/viz-core/tests/wasm.rs` (extend `notes_renders_one_two_and_three_notes`)

**Interfaces:**
- Consumes: Task 2 `Visualization::readout`; Task 3 `rotate_4d`, `project_4d`, `tesseract_edges`; Task 1 four-note rule.
- Produces: viz config fields `turn_4d`, `turn_4d_speed`, `angle_4d`; `note_colors: [[f32; 4]; 4]`; `BarSide::Bottom`; `Layout.bars: [Bar; 4]`; `NotesViz::apply_turn_config(&mut self, cfg: &NotesVizConfig)`; readout `{ "angle_4d": θ }`.

- [ ] **Step 1: Write the failing unit tests** (in `mod tests`)

```rust
    #[test]
    fn the_fourth_bar_runs_along_the_bottom_gutter_left_to_right() {
        let l = layout([1000, 800], [100.0, 50.0, 500.0, 500.0], [0.0; 4]);
        let gutter = GUTTER_FRAC * 500.0;
        let bottom = l.bars[3];
        assert_eq!(bottom.side, BarSide::Bottom);
        let y = 50.0 + 500.0 - gutter * 0.5;
        assert_point_near(bottom.from, [l.plot.x, y], "bottom bar from");
        assert_point_near(bottom.to, [l.plot.x + l.plot.w, y], "bottom bar to");
    }

    #[test]
    fn turn_config_defaults_and_schema() {
        let d = NotesVizConfig::default();
        assert!(d.turn_4d);
        assert_eq!(d.turn_4d_speed, 0.35);
        assert_eq!(d.angle_4d, 0.0);
        assert_eq!(d.note_colors.len(), 4);
        assert_eq!(d.note_colors[3], [0.498, 0.659, 0.910, 1.0]);
        let schema = NotesVizConfig::schema();
        for key in ["turn_4d", "turn_4d_speed", "angle_4d"] {
            assert!(schema["properties"][key].is_object(), "{key} in schema");
        }
        assert_eq!(schema["properties"]["note_colors"]["maxItems"], 4);
        // Older pushes without the new fields still parse, with the defaults.
        let mut older = NotesVizConfig::defaults();
        for key in ["turn_4d", "turn_4d_speed", "angle_4d"] {
            older.as_object_mut().unwrap().remove(key);
        }
        let parsed: NotesVizConfig = serde_json::from_value(older).expect("parses without the 4D fields");
        assert!(parsed.turn_4d);
        assert_eq!(parsed.turn_4d_speed, 0.35);
        assert_eq!(parsed.angle_4d, 0.0);
    }

    #[test]
    fn tick_turns_while_turning_and_holds_while_held() {
        let mut viz = NotesViz::new();
        viz.apply_turn_config(&NotesVizConfig { turn_4d_speed: 1.0, ..NotesVizConfig::default() });
        viz.tick(0.5);
        assert!((viz.angle_4d - 0.5).abs() < 1e-6);
        viz.apply_turn_config(&NotesVizConfig { turn_4d: false, angle_4d: 2.0, ..NotesVizConfig::default() });
        assert!((viz.angle_4d - 2.0).abs() < 1e-6, "a held config sets the angle");
        viz.tick(1.0);
        assert!((viz.angle_4d - 2.0).abs() < 1e-6, "held: tick leaves it");
    }

    #[test]
    fn a_turning_config_never_snaps_the_angle_back() {
        let mut viz = NotesViz::new();
        viz.apply_turn_config(&NotesVizConfig { turn_4d_speed: 1.0, ..NotesVizConfig::default() });
        viz.tick(1.2);
        // A layout push carries a stale angle_4d with turn_4d still on.
        viz.apply_turn_config(&NotesVizConfig { turn_4d_speed: 1.0, angle_4d: 0.1, ..NotesVizConfig::default() });
        assert!((viz.angle_4d - 1.2).abs() < 1e-6);
    }

    #[test]
    fn the_angle_wraps_and_the_readout_reports_it() {
        let mut viz = NotesViz::new();
        viz.apply_turn_config(&NotesVizConfig { turn_4d_speed: 1.0, ..NotesVizConfig::default() });
        viz.tick(std::f32::consts::TAU + 0.25);
        assert!((viz.angle_4d - 0.25).abs() < 1e-4);
        let r = viz.readout();
        assert!((r["angle_4d"].as_f64().unwrap() - 0.25).abs() < 1e-4);
        // Through the erased wrapper too.
        let erased = crate::engine::erased::TypedViz::new(NotesViz::new());
        use crate::engine::erased::ErasedVisualization;
        assert_eq!(erased.readout()["angle_4d"].as_f64(), Some(0.0));
    }
```

Also update the existing layout test that lists `[BarSide::Left, BarSide::Top, BarSide::Right]` (~line 1279) to include `BarSide::Bottom`, and any test that indexes `cfg.note_colors` as a 3-array.

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test -p viz-core --lib visualizations::notes`
Expected: FAIL to compile (`BarSide::Bottom`, `turn_4d`, `apply_turn_config`, `angle_4d` missing).

- [ ] **Step 3: Config and schema**

In `NotesVizConfig`: change `note_colors` to `[[f32; 4]; 4]` and its doc to "note 0 (left), 1 (top), 2 (right), 3 (bottom)". Add, after `auto_rotate_speed`:

```rust
    /// Whether `tick` turns the four-note figure through the fourth
    /// dimension. Off holds it at `angle_4d`.
    #[serde(default = "default_true")]
    pub turn_4d: bool,
    /// Radians per second of the 4D turn.
    #[serde(default = "default_turn_4d_speed")]
    pub turn_4d_speed: f32,
    /// The 4D angle in radians, taken only while `turn_4d` is off (the lab's
    /// slider holds it there); a turning figure ignores it, so a layout push
    /// carrying a stale value never snaps it back.
    #[serde(default)]
    pub angle_4d: f32,
```

with

```rust
fn default_true() -> bool {
    true
}
const DEFAULT_TURN_4D_SPEED: f32 = 0.35;
fn default_turn_4d_speed() -> f32 {
    DEFAULT_TURN_4D_SPEED
}
```

In `Default`: add `[0.498, 0.659, 0.910, 1.0], // soft blue #7FA8E8` as the fourth colour, and `turn_4d: true, turn_4d_speed: DEFAULT_TURN_4D_SPEED, angle_4d: 0.0,`.

In `schema()`: `note_colors` title "Note colors (4)", `minItems`/`maxItems` 4, add `color_property("Note 4 (bottom bar)", d.note_colors[3])` to `prefixItems` and change the comment to "four distinct bars; items=false forbids a fifth". Add properties:

```rust
                "turn_4d": { "type": "boolean", "title": "Turn through 4D (four notes)", "default": true },
                "turn_4d_speed": number_property(NumberOpts {
                    label: "4D turn speed (rad/s)",
                    default: DEFAULT_TURN_4D_SPEED as f64, min: 0.0, max: 3.0, step: 0.05,
                    integer: false, cosmetic: true, widget: None,
                }),
                "angle_4d": number_property(NumberOpts {
                    label: "4D angle when held (rad)",
                    default: 0.0, min: 0.0, max: std::f64::consts::TAU, step: 0.01,
                    integer: false, cosmetic: true, widget: None,
                }),
```

Do **not** add the three new keys to `required` (they are serde-defaulted; older pushes omit them).

- [ ] **Step 4: Layout and bars**

Add `Bottom` to `BarSide` (doc: "the fourth note's bar"). In `Bar`'s doc, say the bottom bar also runs left → right. `Layout.bars: [Bar; 4]`, doc "note 3 bottom". In `layout()` add `let bottom_y = figure.y + figure.h - midline;` and a fourth entry:

```rust
        Bar {
            side: BarSide::Bottom,
            from: [plot.x, bottom_y],
            to: [plot.x + plot.w, bottom_y],
        },
```

In `glow_quad` and `draw_bars`, change `BarSide::Top =>` to `BarSide::Top | BarSide::Bottom =>`.

- [ ] **Step 5: Turn state, `apply_turn_config`, `tick`, `readout`**

`NotesViz` fields (with docs): `angle_4d: f32` ("the 4D turn, radians in [0, 2π)") and `cached_turn_4d: (bool, f32)` ("`turn_4d` and its speed from the last `init`, for `tick`"). Initialise to `0.0` and `(true, DEFAULT_TURN_4D_SPEED)` in `new()`.

```rust
    /// The turn part of `init`, separate so it is testable without GL:
    /// caches whether and how fast `tick` turns, and while held takes the
    /// config's angle.
    fn apply_turn_config(&mut self, cfg: &NotesVizConfig) {
        self.cached_turn_4d = (cfg.turn_4d, cfg.turn_4d_speed);
        if !cfg.turn_4d {
            self.angle_4d = cfg.angle_4d.rem_euclid(std::f32::consts::TAU);
        }
    }
```

Call `self.apply_turn_config(cfg);` in `init` and extend `init`'s doc ("…and the 4D turn's settings; a held angle is taken from the config"). In `tick`, after the azimuth line:

```rust
        let (turning, speed) = self.cached_turn_4d;
        if turning {
            self.angle_4d = (self.angle_4d + speed * dt).rem_euclid(std::f32::consts::TAU);
        }
```

In `impl Visualization for NotesViz`:

```rust
    /// The 4D angle, so the lab's slider can follow the turn.
    fn readout(&self) -> serde_json::Value {
        serde_json::json!({ "angle_4d": self.angle_4d })
    }
```

- [ ] **Step 6: `draw_figure_4d` and `render`**

Add after `draw_figure_3d` (same shape, 4D points):

```rust
    /// Four notes: the curve inside a tesseract, turned through the fourth
    /// dimension by `angle_4d` (see `rotate_4d`), projected to 3D
    /// (`project_4d`) and drawn with the cube's camera, batches and pen.
    fn draw_figure_4d(
        &mut self,
        gl: &Gl,
        state: &NotesState,
        cfg: &NotesVizConfig,
        frame: &FrameCtx,
    ) {
        if self.ensure_3d_resources(gl).is_err() {
            return;
        }
        let [n0, n1, n2, n3] = [&state.notes[0], &state.notes[1], &state.notes[2], &state.notes[3]];
        let just = state.just_intonation;
        let theta = self.angle_4d;
        // x = note 1 (top), y = note 0 (left), z = note 2 (right), w = note 3 (bottom).
        let point_at = |t: f64| {
            project_4d(rotate_4d(
                [
                    displacement_at(n1, just, t) * CUBE_HALF,
                    displacement_at(n0, just, t) * CUBE_HALF,
                    displacement_at(n2, just, t) * CUBE_HALF,
                    displacement_at(n3, just, t) * CUBE_HALF,
                ],
                theta,
            ))
        };

        let [x, y, w, h] = gl_viewport_rect(frame.canvas[1], &frame.layout.plot);
        let plot_px = [w.max(0) as u32, h.max(0) as u32];
        gl.viewport(x, y, w, h);
        self.camera.resize(plot_px[0], plot_px[1]);
        self.camera.azimuth = self.auto_azimuth + self.azimuth_offset;
        self.camera.elevation = self.elevation;
        let view_proj = self.camera.view_projection();

        sample_trail(state, cfg, trail_window(state.period), &mut self.time_scratch);
        self.line_3d_scratch.clear();
        for [a, b] in tesseract_edges(CUBE_HALF) {
            for p in [a, b] {
                self.line_3d_scratch.push(LineVertex3D {
                    position: project_4d(rotate_4d(p, theta)),
                    color: cfg.axis_color,
                });
            }
        }
        push_polyline(
            &mut self.line_3d_scratch,
            self.time_scratch.iter().map(|&t| LineVertex3D {
                position: point_at(t),
                color: cfg.trail_color,
            }),
        );
        let lines_3d = self.lines_3d.as_mut().expect("ensure_3d_resources ran");
        lines_3d.upload(gl, &self.line_3d_scratch);
        lines_3d.draw(gl, &view_proj);

        let pen = PointInstance3D {
            position: point_at(state.phase),
            color: with_alpha(PEN_COLOR, 1.0 - frame.smear),
            radius_px: cfg.pen_size_px * 0.5,
        };
        let points_3d = self.points_3d.as_mut().expect("ensure_3d_resources ran");
        points_3d.upload(gl, &[pen]);
        points_3d.draw(gl, &view_proj, plot_px);

        gl.viewport(0, 0, frame.canvas[0] as i32, frame.canvas[1] as i32);
    }
```

In `render`, replace the 3/else branch with:

```rust
            match frame.n_notes {
                4 => self.draw_figure_4d(gl, state, cfg, &frame),
                3 => self.draw_figure_3d(gl, state, cfg, &frame),
                _ => self.draw_figure_2d(gl, state, cfg, &frame),
            }
```

Check the type of `cube_edges`/`LineVertex3D.position` (`[f32; 3]`) matches `project_4d`'s return. Update the struct/`ensure_3d_resources` docs that say "three notes" to "three or four notes".

- [ ] **Step 7: Run unit tests and clippy**

Run: `cargo test -p viz-core --lib && cargo clippy --all-targets --all-features && cargo fmt --all`
Expected: PASS, no new warnings.

- [ ] **Step 8: Extend the wasm test** (`crates/viz-core/tests/wasm.rs`, end of `notes_renders_one_two_and_three_notes`; rename it `notes_renders_one_to_four_notes`)

```rust
    // C, E, G and B♭ (20:25:30:36) draw the tesseract, and the viz reports its 4D angle.
    engine
        .update_rule_config(cmd(r#"{"notes":[60,64,67,70]}"#))
        .expect("four notes");
    engine.frame(48.0);
    assert_eq!(summary_field(&engine, "period").as_f64(), Some(20.0));
    assert_eq!(js_sys::Array::from(&summary_field(&engine, "notes")).length(), 4);
    let angle = js_sys::Reflect::get(&engine.viz_readout(), &JsValue::from_str("angle_4d"))
        .expect("readout has angle_4d");
    assert!(angle.as_f64().is_some());
    assert_no_gl_error(&gl_of(&canvas));
```

Run (alone, nothing else building): `wasm-pack test --chrome --headless --chromedriver=<path> crates/viz-core`
Expected: PASS. (Driver recipe: the README's Chrome for Testing section; download into the session scratchpad.)

- [ ] **Step 9: Commit**

```bash
git add crates/viz-core/src/visualizations/notes.rs crates/viz-core/tests/wasm.rs
git commit -m "feat(viz): four notes draw a curve in a tesseract that turns through 4D, with a fourth bar"
```

---

## Task 5: Web helpers — fourth colour, four-note picker, seventh chords, four voices

**Files:**
- Modify: `web/src/lib/notes/theory.ts` (`NOTE_COLORS`)
- Modify: `web/src/lib/notes/picker.ts` (`MAX_NOTES`, header comment)
- Modify: `web/src/lib/notes/chords.ts`
- Test: `web/src/lib/notes/__tests__/theory.test.ts`, `picker.test.ts`, `chords.test.ts`, `audio.test.ts`

**Interfaces:**
- Produces: `NOTE_COLORS.bars: readonly [string, string, string, string]`; `MAX_NOTES = 4`; `ChordId` adds `'dom7' | 'maj7' | 'min7' | 'halfdim7' | 'dim7'`; `Chord = { id; label; group: 'triad' | 'seventh'; steps: readonly number[] }`; `CHORDS` in the Global Constraints order; `chordOn(root, id): number[] | undefined` unchanged in signature.

- [ ] **Step 1: Write the failing tests**

`theory.test.ts` (in the `NOTE_COLORS` describe, or a new one):

```ts
  it('has four bar colours, the fourth the soft blue of the bottom bar', () => {
    expect(NOTE_COLORS.bars).toHaveLength(4);
    expect(NOTE_COLORS.bars[3]).toBe('#7FA8E8');
  });
```

`picker.test.ts`: change `'allows up to three notes…'` to four (`expect(MAX_NOTES).toBe(4)`); in the toggle lock-out test use four picks (`[60, 64, 67, 70]` refuses `72`); change `'…stops at three'` to `'…stops at four'` with input `[60, 60, 48, 999, 61.5, NaN, 72, 64, 67]` → `[60, 48, 72, 64]`; and add:

```ts
  it('reads a link with five notes as its first four', () => {
    expect(parseNotesParam('60,64,67,70,72')).toEqual([60, 64, 67, 70]);
  });
```

`chords.test.ts`: replace the first two tests' expectations with:

```ts
  it('lists the six triads, then the five sevenths', () => {
    expect(CHORDS.map((c) => c.id)).toEqual([
      'major', 'minor', 'diminished', 'augmented', 'sus2', 'sus4',
      'dom7', 'maj7', 'min7', 'halfdim7', 'dim7',
    ]);
    expect(CHORDS.map((c) => c.label)).toEqual([
      'Major', 'Minor', 'Diminished', 'Augmented', 'Sus2', 'Sus4',
      'Dom7', 'Maj7', 'Min7', 'Half-dim7', 'Dim7',
    ]);
    for (const c of CHORDS) {
      expect(c.steps[0]).toBe(0);
      expect(c.steps).toHaveLength(c.group === 'triad' ? 3 : 4);
    }
    expect(CHORDS.filter((c) => c.group === 'seventh')).toHaveLength(5);
  });

  it('spells each seventh in semitones above its root', () => {
    expect(chordById('dom7').steps).toEqual([0, 4, 7, 10]);
    expect(chordById('maj7').steps).toEqual([0, 4, 7, 11]);
    expect(chordById('min7').steps).toEqual([0, 3, 7, 10]);
    expect(chordById('halfdim7').steps).toEqual([0, 3, 6, 10]);
    expect(chordById('dim7').steps).toEqual([0, 3, 6, 9]);
  });
```

(keep the existing triad-spelling test) and in `describe('chordOn')`:

```ts
  it('builds a seventh as four notes, and refuses one that would pass the top', () => {
    expect(chordOn(60, 'dom7')).toEqual([60, 64, 67, 70]);
    expect(chordOn(72, 'maj7')).toEqual([72, 76, 79, 83]); // C5 Maj7 ends on B5
    expect(chordOn(73, 'maj7')).toBeUndefined();
  });
```

and in `isChordId`'s bad list replace `'dom7'` with `'dom9'`.

`audio.test.ts`, in `'splits the level so any number of notes totals the same loudness'`, add `[1, 1.25, 1.5, 1.8]` to the list of ratio sets.

- [ ] **Step 2: Run to verify they fail**

Run: `cd web && npx vitest run src/lib/notes`
Expected: FAIL (three colours, `MAX_NOTES` 3, no sevenths).

- [ ] **Step 3: Implement**

`theory.ts`: `bars: ['#F2B23C', '#F0665C', '#6CC68E', '#7FA8E8'],` and widen the type to `readonly [string, string, string, string]`.

`picker.ts`: `export const MAX_NOTES = 4;`; header comment "up to four notes"; `toggleNote` doc "a fifth note".

`chords.ts`:

```ts
export type ChordId =
  | 'major' | 'minor' | 'diminished' | 'augmented' | 'sus2' | 'sus4'
  | 'dom7' | 'maj7' | 'min7' | 'halfdim7' | 'dim7';

/** A chord: its share-link id, its name in the picker, its row, and its notes in semitones above the root. */
export type Chord = { id: ChordId; label: string; group: 'triad' | 'seventh'; steps: readonly number[] };

/** Triads fill three bars and sevenths all four: root left, then top, right and bottom. */
export const CHORDS: readonly Chord[] = [
  { id: 'major', label: 'Major', group: 'triad', steps: [0, 4, 7] },
  { id: 'minor', label: 'Minor', group: 'triad', steps: [0, 3, 7] },
  { id: 'diminished', label: 'Diminished', group: 'triad', steps: [0, 3, 6] },
  { id: 'augmented', label: 'Augmented', group: 'triad', steps: [0, 4, 8] },
  { id: 'sus2', label: 'Sus2', group: 'triad', steps: [0, 2, 7] },
  { id: 'sus4', label: 'Sus4', group: 'triad', steps: [0, 5, 7] },
  { id: 'dom7', label: 'Dom7', group: 'seventh', steps: [0, 4, 7, 10] },
  { id: 'maj7', label: 'Maj7', group: 'seventh', steps: [0, 4, 7, 11] },
  { id: 'min7', label: 'Min7', group: 'seventh', steps: [0, 3, 7, 10] },
  { id: 'halfdim7', label: 'Half-dim7', group: 'seventh', steps: [0, 3, 6, 10] },
  { id: 'dim7', label: 'Dim7', group: 'seventh', steps: [0, 3, 6, 9] },
];
```

Update the file's header comment ("the six triads and five sevenths").

- [ ] **Step 4: Run tests**

Run: `cd web && npx vitest run src/lib/notes && npx svelte-check`
Expected: PASS; `svelte-check` may flag `NotesLab.svelte` places that assumed three colours — leave those for Task 8 only if they are type errors there, otherwise fix the helper.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/notes
git commit -m "feat(web): notes helpers take four notes and five seventh chords"
```

---

## Task 6: Label anchors for four bars and the ratio in the strip corner

**Files:**
- Modify: `web/src/lib/notes/layout.ts` (`labelAnchors`)
- Test: `web/src/lib/notes/__tests__/layout.test.ts`

**Interfaces:**
- Produces: `labelAnchors(figure: Rect, strip: Rect): { bars: [Point, Point, Point, Point]; ratio: Point; ratioInCorner: boolean }`. `ratio` is the strip's top-left corner when the strip has area (`ratioInCorner: true`), else the figure's bottom-centre (`false`).

- [ ] **Step 1: Write the failing tests** (replace the `labelAnchors` describe)

```ts
describe('labelAnchors', () => {
  const STRIP = { x: 140, y: 30, w: 300, h: 45 };

  it('puts each bar label at its bar end, the bottom bar at its right end', () => {
    const { bars } = labelAnchors({ x: 10, y: 20, w: 100, h: 100 }, STRIP);
    expectPoint(bars[0], 16, 108); // left bar: bottom end, 6% in
    expectPoint(bars[1], 98, 26); // top bar: right end, 6% down
    expectPoint(bars[2], 104, 108); // right bar: bottom end, 94% across
    expectPoint(bars[3], 98, 114); // bottom bar: right end, 6% up from the bottom
  });

  it('hangs the ratio in the strip top-left corner', () => {
    const { ratio, ratioInCorner } = labelAnchors({ x: 10, y: 20, w: 100, h: 100 }, STRIP);
    expectPoint(ratio, 140, 30);
    expect(ratioInCorner).toBe(true);
  });

  it('keeps the ratio at the figure bottom-centre when there is no strip', () => {
    const { ratio, ratioInCorner } = labelAnchors({ x: 10, y: 20, w: 100, h: 100 }, ZERO);
    expectPoint(ratio, 60, 114);
    expect(ratioInCorner).toBe(false);
  });

  it('scales with the square', () => {
    const { bars } = labelAnchors({ x: 0, y: 0, w: 200, h: 200 }, ZERO);
    expectPoint(bars[0], 12, 176);
    expectPoint(bars[1], 176, 12);
    expectPoint(bars[2], 188, 176);
    expectPoint(bars[3], 176, 188);
  });

  it('keeps every bar anchor inside the figure and the ratio on the strip', () => {
    const { figure, strip } = notesLayout(1168, 650);
    const { bars, ratio } = labelAnchors(figure, strip);
    for (const p of bars) {
      expect(p.x).toBeGreaterThan(figure.x);
      expect(p.x).toBeLessThan(figure.x + figure.w);
      expect(p.y).toBeGreaterThan(figure.y);
      expect(p.y).toBeLessThan(figure.y + figure.h);
    }
    expectPoint(ratio, strip.x, strip.y);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd web && npx vitest run src/lib/notes/__tests__/layout.test.ts`
Expected: FAIL (three bars; ratio at figure bottom-centre; no `ratioInCorner`).

- [ ] **Step 3: Implement**

```ts
/**
 * Where the overlay hangs its text, for a figure of side `figure.w`: one label
 * at each bar's end (left bar at the bottom, top bar at the right, right bar
 * at the bottom, bottom bar at the right) and the ratio readout. The bars lie
 * on their gutters' midlines, half of `BAR_INSET` in from the figure's edge,
 * and span the plot, which ends `BAR_INSET` short of the opposite edge. The
 * ratio hangs from the strip's top-left corner (the bottom gutter now holds
 * the fourth bar), or sits at the figure's bottom-centre when there is no
 * strip; `ratioInCorner` says which, so the page can align the pill.
 */
export function labelAnchors(
  figure: Rect,
  strip: Rect,
): { bars: [Point, Point, Point, Point]; ratio: Point; ratioInCorner: boolean } {
  const s = figure.w;
  const mid = BAR_INSET / 2;
  const far = 1 - BAR_INSET;
  const ratioInCorner = strip.w > 0 && strip.h > 0;
  return {
    bars: [
      { x: figure.x + mid * s, y: figure.y + far * s },
      { x: figure.x + far * s, y: figure.y + mid * s },
      { x: figure.x + (1 - mid) * s, y: figure.y + far * s },
      { x: figure.x + far * s, y: figure.y + (1 - mid) * s },
    ],
    ratio: ratioInCorner ? { x: strip.x, y: strip.y } : { x: figure.x + 0.5 * s, y: figure.y + (1 - mid) * s },
    ratioInCorner,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `cd web && npx vitest run src/lib/notes/__tests__/layout.test.ts`
Expected: PASS. (`NotesLab.svelte` still calls `labelAnchors(layout.figure)`; Task 8 updates it. `svelte-check` will flag it until then — expected.)

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/notes/layout.ts web/src/lib/notes/__tests__/layout.test.ts
git commit -m "feat(web): label anchors for a fourth bar; the ratio hangs from the strip corner"
```

---

## Task 7: `LabApi.readVizReadout` and the fake engine

**Files:**
- Modify: `web/src/lib/components/labApi.svelte.ts` (after `readSummary`)
- Modify: `web/src/lib/test/fakeViz.ts` (FakeEngine, exported fixture)
- Test: `web/src/lib/components/__tests__/labApi.test.ts` if it exists, else add the case to `NotesLab.test.ts` in Task 8

**Interfaces:**
- Consumes: Task 2 `Engine.viz_readout()` (generated wasm-bindgen typing appears after a wasm build; the fake supplies it in tests).
- Produces: `LabApi.readVizReadout(): unknown`; `export const notesVizReadout: { angle_4d: number }` in `fakeViz.ts` (mutable; the fake returns it on the notes lab, `null` elsewhere).

- [ ] **Step 1: Write the failing test**

If `web/src/lib/components/__tests__/labApi.test.ts` exists, add (following its setup for building a `LabApi` around a fake engine):

```ts
  it('reads the viz readout, or null without an engine', () => {
    expect(new LabApi().readVizReadout()).toBeNull();
  });
```

Otherwise skip this step; Task 8's lab tests exercise it.

- [ ] **Step 2: Implement**

`labApi.svelte.ts`:

```ts
  /** Read the visualization's readout (view state it advances itself, e.g. the notes lab's 4D angle), or null. */
  readVizReadout(): unknown {
    return this.engine?.viz_readout() ?? null;
  }
```

If `svelte-check` reports `viz_readout` missing on the generated `Engine` type, rebuild the wasm package (`npm --prefix web run build:wasm` or the README's wasm-pack build command) so the `.d.ts` picks up Task 2's method; do not cast around it.

`fakeViz.ts`: add near the notes fixture

```ts
/** What the fake's `viz_readout()` returns on the notes lab (null elsewhere). Mutable so a test can move the 4D angle. */
export const notesVizReadout = { angle_4d: 0 };
```

and in `FakeEngine`:

```ts
  viz_readout() { return this._lab === 'notes' ? notesVizReadout : null; }
```

- [ ] **Step 3: Run tests**

Run: `cd web && npx vitest run && npx svelte-check`
Expected: vitest PASS; `svelte-check` clean apart from the known `labelAnchors` call (Task 8).

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/components/labApi.svelte.ts web/src/lib/test/fakeViz.ts
git commit -m "feat(web): LabApi reads the visualization's readout"
```

---

## Task 8: The lab page — sevenths row, 4D controls, overlay, legend, docs

**Files:**
- Modify: `web/src/lib/components/labs/NotesLab.svelte`
- Test: `web/src/lib/components/__tests__/NotesLab.test.ts`
- Modify: `README.md` (Notes & Chords bullet), `docs/superpowers/specs/2026-10-04-notes-and-chords-design.md` (one pointer line)

**Interfaces:**
- Consumes: Task 5 `CHORDS` (with `group`), `MAX_NOTES = 4`, `NOTE_COLORS.bars[3]`; Task 6 `labelAnchors(figure, strip)` → `{ bars, ratio, ratioInCorner }`; Task 7 `api.readVizReadout()`, `notesVizReadout`; viz config keys `turn_4d`, `angle_4d` (radians).

- [ ] **Step 1: Write the failing tests** (import `notesVizReadout` from `../../test/fakeViz`; add `const lastViz = () => updateVizConfigSpy.mock.lastCall?.[0] as Record<string, unknown>;`)

Update existing tests:
- `'stops at three notes…'` → four: pick `64, 67, 70` after C4 (so `[60, 64, 67, 70]`), `unpicked` length `32`, title `'Pick up to four notes'`, the pressed set `[60, 64, 67, 70]`.
- chord mode `'starts on single notes and offers the six triads as radio buttons'` → twelve labels in order: Single notes, Major, Minor, Diminished, Augmented, Sus2, Sus4, Dom7, Maj7, Min7, Half-dim7, Dim7; still one shared `name`; and `getByText('Sevenths')` exists.
- `'drops a chord id it does not know'` → use `c=dom9`.

New tests (in `describe('chord mode')`):

```ts
    it('a seventh builds four notes on the pressed root', async () => {
      const { getByRole } = await renderLab();
      await choose(getByRole, 'Dom7');
      expect(lastPush()).toEqual(expect.objectContaining({ notes: [60, 64, 67, 70] }));
      expect(badge(chipFor(getByRole, 70))).toBe('4');
      await fireEvent.click(chipFor(getByRole, 62));
      expect(lastPush()).toEqual(expect.objectContaining({ notes: [62, 66, 69, 72] }));
      expect(location.hash).toBe('#/notes?n=62,66,69,72&c=dom7');
    });

    it('greys out a root whose seventh would pass B5', async () => {
      const { getByRole } = await renderLab();
      await choose(getByRole, 'Maj7');
      expect(chipFor(getByRole, 72).getAttribute('aria-disabled')).not.toBe('true');
      expect(chipFor(getByRole, 73).getAttribute('aria-disabled')).toBe('true');
    });
```

New `describe('4D turn')`:

```ts
  describe('4D turn', () => {
    const turnButton = (getByRole: (r: string, o: { name: string }) => HTMLElement) =>
      getByRole('button', { name: 'Turn' });

    it('shows its controls only with four notes', async () => {
      const { queryByLabelText, getByRole } = await renderLab('n=60,64,67');
      expect(queryByLabelText('4D turn')).toBeNull();
      await fireEvent.click(chipFor(getByRole, 70));
      expect(queryByLabelText('4D turn')).not.toBeNull();
      expect(turnButton(getByRole).getAttribute('aria-pressed')).toBe('true');
    });

    it('the slider follows the viz while turning', async () => {
      const { getByLabelText, container } = await renderLab('n=60,64,67,70');
      notesVizReadout.angle_4d = Math.PI / 2;
      try {
        await vi.waitFor(() => expect((getByLabelText('4D turn') as HTMLInputElement).value).toBe('90'));
        expect(container.querySelector('.turn-4d .value')?.textContent).toBe('90°');
      } finally {
        notesVizReadout.angle_4d = 0;
      }
    });

    it('grabbing the slider holds the turn at that angle; Turn resumes it', async () => {
      const { getByLabelText, getByRole } = await renderLab('n=60,64,67,70');
      updateVizConfigSpy.mockClear();
      await fireEvent.input(getByLabelText('4D turn'), { target: { value: '45' } });
      expect(lastViz()).toEqual(expect.objectContaining({ turn_4d: false }));
      expect(lastViz().angle_4d as number).toBeCloseTo(Math.PI / 4);
      expect(turnButton(getByRole).getAttribute('aria-pressed')).toBe('false');
      await fireEvent.click(turnButton(getByRole));
      expect(lastViz()).toEqual(expect.objectContaining({ turn_4d: true }));
      expect(turnButton(getByRole).getAttribute('aria-pressed')).toBe('true');
    });

    it('hides the 4D controls below four notes and keeps the held angle', async () => {
      const { getByLabelText, queryByLabelText, getByRole } = await renderLab('n=60,64,67,70');
      await fireEvent.input(getByLabelText('4D turn'), { target: { value: '30' } });
      await fireEvent.click(chipFor(getByRole, 70));
      expect(queryByLabelText('4D turn')).toBeNull();
      await fireEvent.click(chipFor(getByRole, 70));
      expect((getByLabelText('4D turn') as HTMLInputElement).value).toBe('30');
    });

    it('Reset turns it on again from 0', async () => {
      const { getByRole } = await renderLab('n=60,64,67,70');
      await fireEvent.click(turnButton(getByRole)); // hold
      updateVizConfigSpy.mockClear();
      await fireEvent.click(getByRole('button', { name: 'Reset' }));
      const pushes = updateVizConfigSpy.mock.calls.map(([c]) => c as Record<string, unknown>);
      expect(pushes).toContainEqual(expect.objectContaining({ turn_4d: false, angle_4d: 0 }));
      expect(pushes.at(-1)).toEqual(expect.objectContaining({ turn_4d: true }));
    });
  });
```

Overlay/legend (in `describe('layout and overlay')` / `'legend and story'`):

```ts
    it('labels four bars and hangs the ratio in the strip corner', async () => {
      // The fixture summary has two notes; give it four for this read.
      const saved = notesSummaryFixture.notes;
      notesSummaryFixture.notes = [...saved, saved[0], saved[1]].slice(0, 4);
      try {
        const { container } = await renderLab('n=60,64,67,70');
        await vi.waitFor(() => expect(container.querySelectorAll('.note-label')).toHaveLength(4));
        expect(container.querySelectorAll('.note-label.beside')).toHaveLength(2);
      } finally {
        notesSummaryFixture.notes = saved;
      }
    });
```

and change the legend swatch count from `5` to `6`. Add to the share-link `it.each`: `['n=60,64,67,70,72', '#/notes?n=60,64,67,70', [60, 64, 67, 70]]`, and a case `renderLab('n=60,64,67&c=dom7')` keeps notes `[60, 64, 67]` and `c=dom7` in the hash (links are not re-voiced).

If the overlay test's fixture shape differs (check `notesSummaryFixture` in `fakeViz.ts`), build four notes with the fixture's own note objects; the assertion is four `.note-label`s, two of them `.beside`.

- [ ] **Step 2: Run to verify they fail**

Run: `cd web && npx vitest run src/lib/components/__tests__/NotesLab.test.ts`
Expected: the new and updated tests FAIL.

- [ ] **Step 3: Implement — chord rows**

Replace the `{#each CHORDS …}` inside the Pick radiogroup with two rows; keep one `role="radiogroup"` and the shared `name="notes-pick"`:

```svelte
      {#each CHORDS.filter((c) => c.group === 'triad') as c (c.id)}
        <label class="btn" title={`A press builds a ${c.label.toLowerCase()} chord up from that note`}>
          <input type="radio" name="notes-pick" value={c.id} checked={chord === c.id} onchange={onPickMode} />{c.label}
        </label>
      {/each}
      <span class="row-break" aria-hidden="true"></span>
      <span class="name">Sevenths</span>
      {#each CHORDS.filter((c) => c.group === 'seventh') as c (c.id)}
        <label class="btn" title={`A press builds a ${c.label} chord up from that note: four notes`}>
          <input type="radio" name="notes-pick" value={c.id} checked={chord === c.id} onchange={onPickMode} />{c.label}
        </label>
      {/each}
```

CSS: `.pick-mode .row-break { flex-basis: 100%; height: 0; }`.

- [ ] **Step 4: Implement — 4D state and controls**

Script:

```ts
  /** The 4D turn (four notes): whether the viz turns it, and the angle in radians the slider shows. */
  let turning = $state(true);
  let angle4d = $state(0);
  const angleDeg = $derived(Math.round((angle4d * 180) / Math.PI) % 360);

  /** Hold the turn at the slider's angle. */
  function on4dInput(e: Event) {
    angle4d = (Number((e.target as HTMLInputElement).value) * Math.PI) / 180;
    turning = false;
    api?.patchVizConfig({ turn_4d: false, angle_4d: angle4d });
  }

  /** Start or stop the turn; stopping holds it where the slider shows. */
  function toggleTurn() {
    turning = !turning;
    api?.patchVizConfig(turning ? { turn_4d: true } : { turn_4d: false, angle_4d: angle4d });
  }
```

In the per-frame `$effect` (the one that reads `a.readSummary()`), after `summary = next;`:

```ts
    // While turning the viz owns the 4D angle; mirror it for the slider.
    const r = a.readVizReadout() as { angle_4d?: unknown } | null;
    if (untrack(() => turning) && typeof r?.angle_4d === 'number') angle4d = r.angle_4d;
```

(`untrack` keeps the effect from re-running on `turning`; it is already imported in this file — check.) In `onReset`, before `applyConfig()`:

```ts
    // A held angle is only taken while held, so set it held at 0, then turn.
    angle4d = 0;
    turning = true;
    api?.patchVizConfig({ turn_4d: false, angle_4d: 0 });
    api?.patchVizConfig({ turn_4d: true });
```

Update Reset's `title` to "…half a swing a second, the 4D turn back on, playing".

Markup, after the picker group:

```svelte
    {#if notes.length === 4}
      <div class="group turn-4d">
        <label class="speed">
          <span class="name">4D turn</span>
          <input type="range" min="0" max="359" step="1" value={angleDeg} oninput={on4dInput} aria-label="4D turn" />
          <span class="value mono">{angleDeg}°</span>
        </label>
        <button class="btn" aria-pressed={turning} onclick={toggleTurn} title={turning ? 'Hold the turn where it is' : 'Turn through the fourth dimension again'}>Turn</button>
      </div>
    {/if}
```

CSS: `.turn-4d .btn[aria-pressed="true"]` styled like `.tuning .btn[aria-pressed="true"]`; `.turn-4d .value { width: 4ch; text-align: right; color: var(--ink); }`.

- [ ] **Step 5: Implement — overlay, legend, copy**

- `const anchors = $derived(labelAnchors(layout.figure, layout.strip));`
- Note labels: `class:beside={i === 1 || i === 3}`.
- Ratio span: add `class:corner={anchors.ratioInCorner}`; CSS `.ratio.corner { transform: translate(6px, 6px); }`.
- Legend: add `<span class="item"><i class="swatch" style:background={NOTE_COLORS.bars[3]}></i>Note 4 (bottom bar)</span>` after note 3.
- `chipBlocked`: `'Pick up to four notes'`.
- Tips: "Pick up to four notes … A third note adds depth, and the curve turns inside a cube; a fourth turns that cube into a tesseract, a four-dimensional cube, and the curve folds through it. The **4D turn** slider holds it at an angle and **Turn** sets it going again; drag to look around it." Chord tip: mention the Sevenths row (Dom7, Maj7, Min7, Half-dim7, Dim7) build four notes. Link tip: `&c=dom7`.
- Any remaining "three" about the note count in this file's comments → "four" where it is about the cap.

- [ ] **Step 6: Run the web suite**

Run: `cd web && npx vitest run && npx svelte-check`
Expected: all PASS, 0 errors.

- [ ] **Step 7: Docs**

README Notes & Chords bullet: "pick up to four notes from C3 to B5, or set **Pick** to a chord (six triads, or a seventh: Dom7, Maj7, Min7, Half-dim7, Dim7) and press its root; … three draw a 3D curve in a turning cube and four a curve in a tesseract that turns through the fourth dimension (**4D turn** holds it, **Turn** restarts it) …". In `2026-10-04-notes-and-chords-design.md`, under the header add: `**Extended by:** \`2026-10-12-notes-tesseract-design.md\` (four notes, sevenths, the tesseract).`

- [ ] **Step 8: Commit**

```bash
git add web/src/lib/components/labs/NotesLab.svelte web/src/lib/components/__tests__/NotesLab.test.ts README.md docs/superpowers/specs/2026-10-04-notes-and-chords-design.md
git commit -m "feat(web): sevenths and four notes in the notes lab, with 4D turn controls"
```

---

## Task 9: Whole-branch validation, PR, deploy check (controller)

- [ ] **Step 1:** From the repo root: `cargo fmt --all --check && cargo clippy --all-targets --all-features && cargo test --all-features`; `cd web && npx vitest run && npx svelte-check`; the wasm tests alone. All pass; report counts.
- [ ] **Step 2:** Browser check on the dev server (port 5173, or 5174 if taken): `#/notes?n=60,64,67,70` shows four bars, the tesseract turning, the slider moving; grab the slider (holds), press Turn (resumes), drop a note (cube back, controls hidden); Dom7 on D4 builds D/F♯/A/C; no console errors. Screenshot as proof.
- [ ] **Step 3:** Push `notes-tesseract`, open the PR with summary + validation, bind it, and report. Merge only on the user's say-so.
