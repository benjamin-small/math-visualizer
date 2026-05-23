# Phase 2: Core Abstractions + Playback Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the framework's core abstractions (`SceneState`, `Rule`, `Visualization`, `ConfigSchema`) and refactor the `Engine` to drive a rule + visualization with a full playback state machine (play / pause / step / back / jump / reset). Prove the plumbing end-to-end with a trivial demo rule (`ColorCycleRule`) so Phase 3 can drop in the real midpoint rule with no architectural changes.

**Architecture:** Concrete `Rule` and `Visualization` implementations carry compile-time-typed config and state. An erased trait layer (`ErasedRule`, `ErasedVisualization`) lets the engine hold them behind `Box<dyn …>` while preserving the typed interface inside each impl via `Any` downcasts. The playback engine is a pure reducer — `(PlaybackState, Command) → PlaybackState` — driven by JS `dispatch()` calls and the rAF `frame(now_ms)` loop. The demo `ColorCycleRule` uses the existing WebGL clear-color path so this phase requires no new shader work; render utilities (shaders, cameras, batches) land in Phase 3 with the real visualization.

**Tech Stack:** Rust (`viz-core`), `wasm-bindgen`, `web-sys`, `serde`, `serde_json`, `wasm-bindgen-test`; Svelte 5, Vite, Vitest (no new JS deps).

**Spec reference:** [docs/superpowers/specs/2026-05-23-math-visualizer-foundation-design.md](../specs/2026-05-23-math-visualizer-foundation-design.md), §4 (core abstractions), §5 (engine + playback).

**Not in this phase:** Render utilities (Camera2D, SDF circle, InstancedPoints, LineBatch), the midpoint-on-circle rule, the DotsOnCircle visualization, the ConfigSchema proc-macro, the auto-rendering config panel, and localStorage persistence. Each is the focus of a later phase.

---

## File map

Creating:

```
crates/viz-core/src/
├── traits.rs                      # SceneState, Rule, Visualization, Capabilities, InputEvent
├── config/
│   └── mod.rs                     # ConfigSchema trait
├── engine/
│   ├── mod.rs                     # (rewritten) Engine struct, wasm-bindgen surface
│   ├── playback.rs                # PlaybackState, Command, reducer
│   └── erased.rs                  # ErasedRule, ErasedVisualization + blanket impls
├── rules/
│   ├── mod.rs
│   └── color_cycle.rs             # ColorCycleRule (demo)
└── visualizations/
    ├── mod.rs
    └── color_cycle.rs             # ColorCycleViz (demo)

crates/viz-core/tests/
└── wasm.rs                        # (extended) engine dispatch round-trip tests

web/src/
├── App.svelte                     # (rewritten) playback bar replaces RGBA sliders
└── lib/
    └── playback/
        └── commands.ts            # typed Command builders for engine.dispatch
```

After Phase 2 the user sees a canvas that cycles through colors as iteration advances, with a control bar of buttons (◀ ▶/⏸ ▶▶ ↺) + an iteration counter (`47 / 500`).

---

## Task 1: Core trait definitions

**Files:**
- Create: `crates/viz-core/src/traits.rs`
- Modify: `crates/viz-core/src/lib.rs`

- [ ] **Step 1: Write the failing test**

Add to `crates/viz-core/src/traits.rs` (creating the file):

```rust
//! Core framework traits. Implemented by concrete rules and visualizations.

use serde::{de::DeserializeOwned, Serialize};
use web_sys::WebGl2RenderingContext;

use crate::config::ConfigSchema;

/// A rule's state. Marker trait; the rule and visualization paired with it
/// know its concrete type. The engine treats it as opaque (via `dyn Any`).
pub trait SceneState: 'static {
    /// Reset to the empty/initial state. Called by `Rule::init` rebuilds.
    fn clear(&mut self);
}

/// Declares what playback operations a rule supports.
#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize)]
pub struct Capabilities {
    pub supports_scrub: bool,
    pub cheap_recompute: bool,
    pub checkpoint_every: Option<u32>,
}

impl Capabilities {
    /// The simplest rule: cheap to recompute from scratch, supports scrubbing.
    /// Used by ColorCycleRule and by any rule whose advance_to is O(n).
    pub const fn cheap_scrubbable() -> Self {
        Self { supports_scrub: true, cheap_recompute: true, checkpoint_every: None }
    }
}

/// A rule computes per-iteration state from `(config, seed, iteration_index)`.
pub trait Rule {
    type Config: ConfigSchema + Serialize + DeserializeOwned;
    type State: SceneState;

    fn id(&self) -> &'static str;
    fn capabilities(&self) -> Capabilities;

    fn init(&self, cfg: &Self::Config, seed: u64) -> Self::State;

    /// Advance `state` so it reflects iteration `n` (i.e. n full iterations
    /// have completed). Idempotent for the same n. For cheap-recompute rules
    /// this typically clears `state` and runs from 0..n.
    fn advance_to(&self, state: &mut Self::State, cfg: &Self::Config, seed: u64, n: u32);

    /// Interpolated state within iteration `n`. `sub` ∈ [0, 1]. Default: no-op.
    /// Should NOT push permanent state changes — those are owned by `advance_to`.
    fn substep(&self, _state: &mut Self::State, _cfg: &Self::Config, _seed: u64, _n: u32, _sub: f32) {}
}

/// A visualization renders a rule's state to a WebGL2 context.
pub trait Visualization {
    type State: SceneState;
    type Config: ConfigSchema + Serialize + DeserializeOwned;

    fn id(&self) -> &'static str;

    fn init(&mut self, gl: &WebGl2RenderingContext, cfg: &Self::Config);

    fn render(
        &mut self,
        gl: &WebGl2RenderingContext,
        state: &Self::State,
        cfg: &Self::Config,
    );

    fn resize(&mut self, _gl: &WebGl2RenderingContext, _w: u32, _h: u32) {}

    fn handle_input(&mut self, _ev: &InputEvent) {}

    /// Called once per frame with wall-clock dt (seconds). For camera inertia
    /// and viz-side animations; rule state belongs to the Rule.
    fn tick(&mut self, _dt: f32) {}
}

/// Pointer / keyboard input forwarded from the canvas to the active viz.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind")]
pub enum InputEvent {
    PointerDown { x: f32, y: f32, button: u8 },
    PointerMove { x: f32, y: f32, dx: f32, dy: f32, buttons: u8 },
    PointerUp   { x: f32, y: f32, button: u8 },
    Wheel       { dx: f32, dy: f32 },
    Key         { code: String, down: bool, ctrl: bool, alt: bool, shift: bool, meta: bool },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capabilities_cheap_scrubbable_defaults() {
        let c = Capabilities::cheap_scrubbable();
        assert!(c.supports_scrub);
        assert!(c.cheap_recompute);
        assert!(c.checkpoint_every.is_none());
    }

    #[test]
    fn input_event_round_trips_through_json() {
        let ev = InputEvent::PointerMove { x: 1.0, y: 2.0, dx: 0.1, dy: -0.1, buttons: 1 };
        let json = serde_json::to_string(&ev).unwrap();
        let back: InputEvent = serde_json::from_str(&json).unwrap();
        match back {
            InputEvent::PointerMove { x, y, dx, dy, buttons } => {
                assert!((x - 1.0).abs() < 1e-6);
                assert!((y - 2.0).abs() < 1e-6);
                assert!((dx - 0.1).abs() < 1e-6);
                assert!((dy + 0.1).abs() < 1e-6);
                assert_eq!(buttons, 1);
            }
            other => panic!("wrong variant: {other:?}"),
        }
    }
}
```

- [ ] **Step 2: Add serde to viz-core deps and create config module stub**

Modify `crates/viz-core/Cargo.toml` `[dependencies]` to ADD (keeping existing entries):

```toml
serde = { version = "1", features = ["derive"] }
serde_json = "1"
serde-wasm-bindgen = "0.6"
```

(Existing wasm-bindgen, js-sys, web-sys, console_error_panic_hook stay as-is.)

Create `crates/viz-core/src/config/mod.rs` as a minimal stub so `traits.rs` compiles (Task 2 fills it out):

```rust
//! ConfigSchema trait. Full impl lands in Task 2.

/// Implemented by every rule / visualization config struct. Surfaces the
/// schema as JSON for the Svelte panel to render widgets from.
pub trait ConfigSchema {
    fn schema() -> serde_json::Value;
    fn defaults() -> serde_json::Value;
}
```

- [ ] **Step 3: Wire new modules into lib.rs**

Replace `crates/viz-core/src/lib.rs` with:

```rust
use wasm_bindgen::prelude::*;

pub mod config;
pub mod engine;
pub mod traits;

pub use engine::Engine;

#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}
```

(The existing `engine::Engine` re-export survives — Engine itself gets rewritten in Task 7, but its module path stays the same.)

- [ ] **Step 4: Verify it compiles and tests pass**

```bash
cargo test --workspace
```

Expected: existing `clamp_color_*` tests + new `capabilities_cheap_scrubbable_defaults` and `input_event_round_trips_through_json` all pass. Total: 4 passing.

```bash
wasm-pack build crates/viz-core --target web --out-dir pkg
```

Expected: clean build (no warnings about the new trait file or unused imports).

- [ ] **Step 5: Commit**

```bash
git add crates/viz-core/Cargo.toml crates/viz-core/Cargo.lock crates/viz-core/src/
git commit -m "feat(traits): add SceneState, Rule, Visualization, Capabilities, InputEvent"
```

(`Cargo.lock` is committed; the new serde deps update it. If git status doesn't show it as modified, that's because npm install in Phase 1 already pulled compatible transitives — fine, just stage the manifest and src changes.)

---

## Task 2: ConfigSchema trait

**Files:**
- Modify: `crates/viz-core/src/config/mod.rs`
- Test: inline tests

- [ ] **Step 1: Write the failing test**

Replace `crates/viz-core/src/config/mod.rs` with:

```rust
//! ConfigSchema trait. Each rule and visualization implements this for its
//! Config struct so the Svelte panel can render widgets without hard-coding
//! per-rule knowledge.
//!
//! Phase 2 implements the trait by hand on every config struct. Phase 4
//! introduces a `#[derive(ConfigSchema)]` proc-macro that generates these
//! impls from field attributes.

use serde_json::{json, Value};

pub trait ConfigSchema {
    /// JSON Schema describing the config, with `x-*` extension keys carrying
    /// UI hints (widget kind, cosmetic flag, etc.). The Svelte panel walks
    /// the schema and dispatches each field to a generic widget.
    fn schema() -> Value;

    /// Default values for every field, shaped like the config itself when
    /// deserialized.
    fn defaults() -> Value;
}

/// Helper for hand-written schemas. Builds a JSON Schema property object
/// with our `x-*` extension keys filled in.
pub fn number_property(opts: NumberOpts) -> Value {
    let mut v = json!({
        "type": if opts.integer { "integer" } else { "number" },
        "title": opts.label,
        "default": opts.default,
        "minimum": opts.min,
        "maximum": opts.max,
        "x-step": opts.step,
        "x-cosmetic": opts.cosmetic,
    });
    if let Some(widget) = opts.widget {
        v["x-widget"] = json!(widget);
    }
    v
}

/// Helper for boolean fields.
pub fn boolean_property(label: &str, default: bool, cosmetic: bool) -> Value {
    json!({
        "type": "boolean",
        "title": label,
        "default": default,
        "x-cosmetic": cosmetic,
    })
}

/// Helper for a color field (RGBA tuple).
pub fn color_property(label: &str, default: [f32; 4]) -> Value {
    json!({
        "type": "array",
        "title": label,
        "default": default,
        "minItems": 4,
        "maxItems": 4,
        "items": { "type": "number", "minimum": 0.0, "maximum": 1.0 },
        "x-widget": "color",
        "x-cosmetic": true,
    })
}

/// Builder-shaped options for `number_property`. Keeps call sites readable.
#[derive(Debug, Clone)]
pub struct NumberOpts {
    pub label: &'static str,
    pub default: f64,
    pub min: f64,
    pub max: f64,
    pub step: f64,
    pub integer: bool,
    pub cosmetic: bool,
    pub widget: Option<&'static str>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn number_property_emits_expected_keys() {
        let p = number_property(NumberOpts {
            label: "Iterations",
            default: 500.0,
            min: 1.0,
            max: 10_000.0,
            step: 1.0,
            integer: true,
            cosmetic: false,
            widget: None,
        });
        assert_eq!(p["type"], "integer");
        assert_eq!(p["title"], "Iterations");
        assert_eq!(p["default"], 500.0);
        assert_eq!(p["minimum"], 1.0);
        assert_eq!(p["maximum"], 10_000.0);
        assert_eq!(p["x-step"], 1.0);
        assert_eq!(p["x-cosmetic"], false);
        assert!(p.get("x-widget").is_none());
    }

    #[test]
    fn color_property_marks_widget_and_cosmetic() {
        let p = color_property("Background", [0.0, 0.0, 0.0, 1.0]);
        assert_eq!(p["x-widget"], "color");
        assert_eq!(p["x-cosmetic"], true);
        assert_eq!(p["items"]["maximum"], 1.0);
    }
}
```

- [ ] **Step 2: Verify tests pass**

```bash
cargo test --workspace
```

Expected: 6 passing total (4 from before + 2 new in `config::tests`).

- [ ] **Step 3: Commit**

```bash
git add crates/viz-core/src/config/
git commit -m "feat(config): add ConfigSchema trait and JSON Schema helpers"
```

---

## Task 3: PlaybackState reducer

**Files:**
- Create: `crates/viz-core/src/engine/playback.rs`
- Modify: `crates/viz-core/src/engine/mod.rs` (temporary — re-export the new module)

- [ ] **Step 1: Write the failing test**

Create `crates/viz-core/src/engine/playback.rs`:

```rust
//! Pure-state-machine playback model. The engine wraps this with side
//! effects (rule recompute, GL calls). Keeping the reducer pure makes
//! command behavior unit-testable without WebGL.

use serde::{Deserialize, Serialize};

use crate::traits::Capabilities;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct PlaybackState {
    pub iteration: u32,
    pub sub_progress: f32,
    pub playing: bool,
    pub speed: f32,
    pub seed: u64,
    pub max_iterations: u32,
}

impl PlaybackState {
    pub fn initial(seed: u64, max_iterations: u32) -> Self {
        Self {
            iteration: 0,
            sub_progress: 0.0,
            playing: false,
            speed: 1.0,
            seed,
            max_iterations: max_iterations.max(1),
        }
    }
}

/// User intents from the UI. Serialized from JS as `{"kind":"...", ...}`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum Command {
    Play,
    Pause,
    TogglePlay,
    StepForward,
    StepBack,
    JumpTo { iteration: u32 },
    SetSpeed { value: f32 },
    SetSeed { value: u64 },
    Reset,
}

/// Pure reducer: given the current playback state, current capabilities, and
/// a command, returns the next playback state. Whether `iteration` actually
/// changed (so the engine knows to recompute scene state) is signaled by
/// the `iteration_changed` flag in the returned struct.
#[derive(Debug, Clone, Copy)]
pub struct ReduceResult {
    pub next: PlaybackState,
    pub iteration_changed: bool,
    pub seed_changed: bool,
}

pub fn reduce(prev: PlaybackState, caps: Capabilities, cmd: &Command) -> ReduceResult {
    let mut next = prev;
    let mut iteration_changed = false;
    let mut seed_changed = false;

    match cmd {
        Command::Play => next.playing = prev.iteration < prev.max_iterations,
        Command::Pause => next.playing = false,
        Command::TogglePlay => {
            next.playing = !prev.playing && prev.iteration < prev.max_iterations;
        }
        Command::StepForward => {
            next.playing = false;
            next.sub_progress = 0.0;
            if prev.iteration < prev.max_iterations {
                next.iteration = prev.iteration + 1;
                iteration_changed = true;
            }
        }
        Command::StepBack => {
            if !caps.supports_scrub {
                // Rule doesn't support going backward; ignore.
            } else {
                next.playing = false;
                next.sub_progress = 0.0;
                if prev.iteration > 0 {
                    next.iteration = prev.iteration - 1;
                    iteration_changed = true;
                }
            }
        }
        Command::JumpTo { iteration } => {
            let target = (*iteration).min(prev.max_iterations);
            if !caps.supports_scrub && target < prev.iteration {
                // Rejected silently for non-scrubbing rules.
            } else if target != prev.iteration {
                next.iteration = target;
                next.sub_progress = 0.0;
                next.playing = false;
                iteration_changed = true;
            }
        }
        Command::SetSpeed { value } => {
            next.speed = value.max(0.0);
        }
        Command::SetSeed { value } => {
            if *value != prev.seed {
                next.seed = *value;
                next.iteration = 0;
                next.sub_progress = 0.0;
                next.playing = false;
                seed_changed = true;
                iteration_changed = true;
            }
        }
        Command::Reset => {
            next.iteration = 0;
            next.sub_progress = 0.0;
            next.playing = false;
            iteration_changed = prev.iteration != 0 || prev.sub_progress != 0.0;
        }
    }

    ReduceResult { next, iteration_changed, seed_changed }
}

/// Advance time during play. Called from the per-frame loop with dt in
/// seconds. Returns the integer iteration delta (0 most frames, ≥1 on
/// rollover). When `iteration` reaches `max_iterations`, playback auto-pauses.
pub fn advance_time(state: &mut PlaybackState, dt_seconds: f32) -> u32 {
    if !state.playing || state.iteration >= state.max_iterations {
        return 0;
    }
    state.sub_progress += dt_seconds * state.speed;
    let mut rolled = 0u32;
    while state.sub_progress >= 1.0 && state.iteration < state.max_iterations {
        state.sub_progress -= 1.0;
        state.iteration += 1;
        rolled += 1;
    }
    if state.iteration >= state.max_iterations {
        state.iteration = state.max_iterations;
        state.sub_progress = 0.0;
        state.playing = false;
    }
    rolled
}

#[cfg(test)]
mod tests {
    use super::*;

    fn caps_full() -> Capabilities { Capabilities::cheap_scrubbable() }
    fn caps_no_scrub() -> Capabilities {
        Capabilities { supports_scrub: false, cheap_recompute: false, checkpoint_every: None }
    }

    #[test]
    fn play_does_nothing_at_end() {
        let mut s = PlaybackState::initial(0, 10);
        s.iteration = 10;
        let r = reduce(s, caps_full(), &Command::Play);
        assert!(!r.next.playing);
    }

    #[test]
    fn step_forward_increments_and_pauses() {
        let s = PlaybackState::initial(0, 10);
        let r = reduce(s, caps_full(), &Command::StepForward);
        assert_eq!(r.next.iteration, 1);
        assert!(!r.next.playing);
        assert!(r.iteration_changed);
    }

    #[test]
    fn step_back_respects_capabilities() {
        let mut s = PlaybackState::initial(0, 10);
        s.iteration = 5;
        let r = reduce(s, caps_no_scrub(), &Command::StepBack);
        assert_eq!(r.next.iteration, 5);
        assert!(!r.iteration_changed);
    }

    #[test]
    fn step_back_at_zero_is_noop() {
        let s = PlaybackState::initial(0, 10);
        let r = reduce(s, caps_full(), &Command::StepBack);
        assert_eq!(r.next.iteration, 0);
        assert!(!r.iteration_changed);
    }

    #[test]
    fn jump_to_clamps_to_max() {
        let s = PlaybackState::initial(0, 10);
        let r = reduce(s, caps_full(), &Command::JumpTo { iteration: 999 });
        assert_eq!(r.next.iteration, 10);
        assert!(r.iteration_changed);
    }

    #[test]
    fn jump_backward_rejected_without_scrub() {
        let mut s = PlaybackState::initial(0, 10);
        s.iteration = 5;
        let r = reduce(s, caps_no_scrub(), &Command::JumpTo { iteration: 2 });
        assert_eq!(r.next.iteration, 5);
        assert!(!r.iteration_changed);
    }

    #[test]
    fn set_seed_resets_iteration() {
        let mut s = PlaybackState::initial(42, 10);
        s.iteration = 7;
        s.playing = true;
        let r = reduce(s, caps_full(), &Command::SetSeed { value: 99 });
        assert_eq!(r.next.seed, 99);
        assert_eq!(r.next.iteration, 0);
        assert!(!r.next.playing);
        assert!(r.iteration_changed);
        assert!(r.seed_changed);
    }

    #[test]
    fn reset_signals_change_only_when_not_already_zero() {
        let zero = PlaybackState::initial(0, 10);
        assert!(!reduce(zero, caps_full(), &Command::Reset).iteration_changed);

        let mut nonzero = PlaybackState::initial(0, 10);
        nonzero.iteration = 3;
        assert!(reduce(nonzero, caps_full(), &Command::Reset).iteration_changed);
    }

    #[test]
    fn advance_time_rolls_iterations_at_one_per_second_default() {
        let mut s = PlaybackState::initial(0, 10);
        s.playing = true;
        let rolled = advance_time(&mut s, 1.5);
        assert_eq!(rolled, 1);
        assert_eq!(s.iteration, 1);
        assert!((s.sub_progress - 0.5).abs() < 1e-6);
    }

    #[test]
    fn advance_time_clamps_at_max_and_pauses() {
        let mut s = PlaybackState::initial(0, 5);
        s.playing = true;
        let rolled = advance_time(&mut s, 100.0);
        assert_eq!(s.iteration, 5);
        assert!(!s.playing);
        // Rolled at most max_iterations times.
        assert_eq!(rolled, 5);
    }

    #[test]
    fn set_speed_clamps_negative_to_zero() {
        let s = PlaybackState::initial(0, 10);
        let r = reduce(s, caps_full(), &Command::SetSpeed { value: -3.5 });
        assert_eq!(r.next.speed, 0.0);
    }

    #[test]
    fn command_serde_round_trip() {
        let cmd = Command::JumpTo { iteration: 17 };
        let json = serde_json::to_string(&cmd).unwrap();
        assert!(json.contains("\"kind\":\"JumpTo\""));
        let back: Command = serde_json::from_str(&json).unwrap();
        match back {
            Command::JumpTo { iteration } => assert_eq!(iteration, 17),
            _ => panic!("wrong variant"),
        }
    }
}
```

- [ ] **Step 2: Wire the module into engine/mod.rs**

`crates/viz-core/src/engine/mod.rs` currently holds the Phase 1 `Engine` struct. Until Task 7 rewrites it, just add a `pub mod playback;` line at the top so the new module is reachable. Open the file and after the `use` lines near the top, add one line:

```rust
pub mod playback;
```

(Existing `pub struct Engine`, `#[wasm_bindgen] impl Engine { ... }`, and `clamp_color` stay untouched for now. Task 7 replaces them.)

- [ ] **Step 3: Run tests**

```bash
cargo test --workspace
```

Expected: 21 passing total (6 prior + 15 new in `engine::playback::tests`; the spec block shows 12 tests; 3 additional tests were added during P2/T3 code review for Pause/TogglePlay/advance_time-when-paused coverage).

- [ ] **Step 4: Commit**

```bash
git add crates/viz-core/src/engine/
git commit -m "feat(playback): add PlaybackState, Command enum, and pure reducer"
```

---

## Task 4: Erased trait layer

**Files:**
- Create: `crates/viz-core/src/engine/erased.rs`
- Modify: `crates/viz-core/src/engine/mod.rs` (add `pub mod erased;`)

- [ ] **Step 1: Write the module**

Create `crates/viz-core/src/engine/erased.rs`:

```rust
//! Type-erased wrappers over Rule and Visualization. The engine holds these
//! behind Box<dyn …>; concrete impls of Rule/Visualization auto-impl the
//! erased trait via blanket impls.
//!
//! Rationale: Rule has associated types (Config, State) so it can't be
//! `dyn Rule` directly. The erased layer trades compile-time safety inside
//! the engine for the ability to swap rules at runtime. Inside each concrete
//! rule, the typed Rule trait still gives full safety.

use std::any::Any;

use serde_json::Value;
use web_sys::WebGl2RenderingContext;

use crate::config::ConfigSchema;
use crate::traits::{Capabilities, InputEvent, Rule, SceneState, Visualization};

/// Errors returned by erased dispatch.
#[derive(Debug)]
pub enum ErasedError {
    StateDowncastFailed,
    ConfigParse(serde_json::Error),
}

impl std::fmt::Display for ErasedError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ErasedError::StateDowncastFailed => f.write_str("scene state has wrong concrete type"),
            ErasedError::ConfigParse(e) => write!(f, "config parse error: {e}"),
        }
    }
}

impl std::error::Error for ErasedError {}

pub trait ErasedRule {
    fn id(&self) -> &'static str;
    fn capabilities(&self) -> Capabilities;
    fn schema(&self) -> Value;
    fn defaults(&self) -> Value;

    fn init(&self, cfg: &Value, seed: u64) -> Result<Box<dyn Any>, ErasedError>;
    fn advance_to(
        &self,
        state: &mut dyn Any,
        cfg: &Value,
        seed: u64,
        n: u32,
    ) -> Result<(), ErasedError>;
    fn substep(
        &self,
        state: &mut dyn Any,
        cfg: &Value,
        seed: u64,
        n: u32,
        sub: f32,
    ) -> Result<(), ErasedError>;
}

impl<R> ErasedRule for R
where
    R: Rule,
    R::State: 'static,
{
    fn id(&self) -> &'static str { Rule::id(self) }
    fn capabilities(&self) -> Capabilities { Rule::capabilities(self) }
    fn schema(&self) -> Value { <R::Config as ConfigSchema>::schema() }
    fn defaults(&self) -> Value { <R::Config as ConfigSchema>::defaults() }

    fn init(&self, cfg: &Value, seed: u64) -> Result<Box<dyn Any>, ErasedError> {
        let typed: R::Config = serde_json::from_value(cfg.clone()).map_err(ErasedError::ConfigParse)?;
        let state = Rule::init(self, &typed, seed);
        Ok(Box::new(state))
    }

    fn advance_to(
        &self,
        state: &mut dyn Any,
        cfg: &Value,
        seed: u64,
        n: u32,
    ) -> Result<(), ErasedError> {
        let typed_cfg: R::Config = serde_json::from_value(cfg.clone()).map_err(ErasedError::ConfigParse)?;
        let typed_state = state.downcast_mut::<R::State>().ok_or(ErasedError::StateDowncastFailed)?;
        Rule::advance_to(self, typed_state, &typed_cfg, seed, n);
        Ok(())
    }

    fn substep(
        &self,
        state: &mut dyn Any,
        cfg: &Value,
        seed: u64,
        n: u32,
        sub: f32,
    ) -> Result<(), ErasedError> {
        let typed_cfg: R::Config = serde_json::from_value(cfg.clone()).map_err(ErasedError::ConfigParse)?;
        let typed_state = state.downcast_mut::<R::State>().ok_or(ErasedError::StateDowncastFailed)?;
        Rule::substep(self, typed_state, &typed_cfg, seed, n, sub);
        Ok(())
    }
}

pub trait ErasedVisualization {
    fn id(&self) -> &'static str;
    fn schema(&self) -> Value;
    fn defaults(&self) -> Value;

    fn init(&mut self, gl: &WebGl2RenderingContext, cfg: &Value) -> Result<(), ErasedError>;
    fn render(
        &mut self,
        gl: &WebGl2RenderingContext,
        state: &dyn Any,
        cfg: &Value,
    ) -> Result<(), ErasedError>;
    fn resize(&mut self, gl: &WebGl2RenderingContext, w: u32, h: u32);
    fn handle_input(&mut self, ev: &InputEvent);
    fn tick(&mut self, dt: f32);
}

impl<V> ErasedVisualization for V
where
    V: Visualization,
    V::State: 'static,
{
    fn id(&self) -> &'static str { Visualization::id(self) }
    fn schema(&self) -> Value { <V::Config as ConfigSchema>::schema() }
    fn defaults(&self) -> Value { <V::Config as ConfigSchema>::defaults() }

    fn init(&mut self, gl: &WebGl2RenderingContext, cfg: &Value) -> Result<(), ErasedError> {
        let typed: V::Config = serde_json::from_value(cfg.clone()).map_err(ErasedError::ConfigParse)?;
        Visualization::init(self, gl, &typed);
        Ok(())
    }

    fn render(
        &mut self,
        gl: &WebGl2RenderingContext,
        state: &dyn Any,
        cfg: &Value,
    ) -> Result<(), ErasedError> {
        let typed_cfg: V::Config = serde_json::from_value(cfg.clone()).map_err(ErasedError::ConfigParse)?;
        let typed_state = state.downcast_ref::<V::State>().ok_or(ErasedError::StateDowncastFailed)?;
        Visualization::render(self, gl, typed_state, &typed_cfg);
        Ok(())
    }

    fn resize(&mut self, gl: &WebGl2RenderingContext, w: u32, h: u32) {
        Visualization::resize(self, gl, w, h);
    }

    fn handle_input(&mut self, ev: &InputEvent) {
        Visualization::handle_input(self, ev);
    }

    fn tick(&mut self, dt: f32) {
        Visualization::tick(self, dt);
    }
}

#[cfg(not(test))]
#[allow(dead_code)]
pub fn _force_link_erased() {} // keep this symbol available; harmless

// Note: We can't unit-test the erased layer here without a concrete rule
// to wrap. That's covered in Task 5 (where ColorCycleRule provides a real
// concrete type) and Task 9 (browser-level engine round-trip tests).
```

- [ ] **Step 2: Add to engine/mod.rs**

In `crates/viz-core/src/engine/mod.rs`, add another module declaration alongside the existing `pub mod playback;`:

```rust
pub mod erased;
```

- [ ] **Step 3: Verify it compiles**

```bash
cargo test --workspace
```

Expected: 21 passing (no new tests in this task; just compile-time checks). The build must succeed — if it fails, the most likely cause is a type-bound mismatch between the blanket impl and the trait definition.

- [ ] **Step 4: Commit**

```bash
git add crates/viz-core/src/engine/
git commit -m "feat(engine): add ErasedRule/ErasedVisualization with blanket impls"
```

---

## Task 5: ColorCycleRule (demo rule)

**Files:**
- Create: `crates/viz-core/src/rules/mod.rs`
- Create: `crates/viz-core/src/rules/color_cycle.rs`
- Modify: `crates/viz-core/src/lib.rs` (add `pub mod rules;`)

- [ ] **Step 1: Create the rules module**

Create `crates/viz-core/src/rules/mod.rs`:

```rust
pub mod color_cycle;
```

- [ ] **Step 2: Write the rule with tests**

Create `crates/viz-core/src/rules/color_cycle.rs`:

```rust
//! Demo rule: hue cycles with iteration count.
//!
//! State is just the current integer iteration and substep progress. The
//! paired viz reads those to compute a clear-color. This exercises the full
//! Rule/Visualization/Engine plumbing with zero shader work.

use serde::{Deserialize, Serialize};

use crate::config::{number_property, ConfigSchema, NumberOpts};
use crate::traits::{Capabilities, Rule, SceneState};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColorCycleConfig {
    pub max_iterations: u32,
}

impl Default for ColorCycleConfig {
    fn default() -> Self { Self { max_iterations: 360 } }
}

impl ConfigSchema for ColorCycleConfig {
    fn schema() -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "max_iterations": number_property(NumberOpts {
                    label: "Iterations",
                    default: 360.0,
                    min: 1.0,
                    max: 10_000.0,
                    step: 1.0,
                    integer: true,
                    cosmetic: false,
                    widget: None,
                }),
            },
            "required": ["max_iterations"],
        })
    }

    fn defaults() -> serde_json::Value {
        serde_json::to_value(ColorCycleConfig::default()).unwrap()
    }
}

#[derive(Debug, Default)]
pub struct ColorCycleState {
    pub iteration: u32,
    pub sub_progress: f32,
}

impl SceneState for ColorCycleState {
    fn clear(&mut self) {
        self.iteration = 0;
        self.sub_progress = 0.0;
    }
}

pub struct ColorCycleRule;

impl Rule for ColorCycleRule {
    type Config = ColorCycleConfig;
    type State = ColorCycleState;

    fn id(&self) -> &'static str { "demo:color-cycle" }
    fn capabilities(&self) -> Capabilities { Capabilities::cheap_scrubbable() }

    fn init(&self, _cfg: &Self::Config, _seed: u64) -> Self::State {
        ColorCycleState::default()
    }

    fn advance_to(
        &self,
        state: &mut Self::State,
        cfg: &Self::Config,
        _seed: u64,
        n: u32,
    ) {
        state.iteration = n.min(cfg.max_iterations);
        state.sub_progress = 0.0;
    }

    fn substep(
        &self,
        state: &mut Self::State,
        _cfg: &Self::Config,
        _seed: u64,
        _n: u32,
        sub: f32,
    ) {
        state.sub_progress = sub.clamp(0.0, 1.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn advance_to_clamps_to_max() {
        let rule = ColorCycleRule;
        let cfg = ColorCycleConfig { max_iterations: 100 };
        let mut state = rule.init(&cfg, 0);
        rule.advance_to(&mut state, &cfg, 0, 999);
        assert_eq!(state.iteration, 100);
    }

    #[test]
    fn advance_to_is_idempotent() {
        let rule = ColorCycleRule;
        let cfg = ColorCycleConfig::default();
        let mut state = rule.init(&cfg, 42);
        rule.advance_to(&mut state, &cfg, 42, 25);
        let snap_a = (state.iteration, state.sub_progress);
        rule.advance_to(&mut state, &cfg, 42, 25);
        let snap_b = (state.iteration, state.sub_progress);
        assert_eq!(snap_a, snap_b);
    }

    #[test]
    fn substep_clamps() {
        let rule = ColorCycleRule;
        let cfg = ColorCycleConfig::default();
        let mut state = rule.init(&cfg, 0);
        rule.substep(&mut state, &cfg, 0, 0, 1.7);
        assert_eq!(state.sub_progress, 1.0);
        rule.substep(&mut state, &cfg, 0, 0, -0.3);
        assert_eq!(state.sub_progress, 0.0);
    }

    #[test]
    fn schema_round_trips_default_config() {
        let defaults: ColorCycleConfig = serde_json::from_value(ColorCycleConfig::defaults()).unwrap();
        assert_eq!(defaults.max_iterations, 360);
    }

    #[test]
    fn erased_dispatch_round_trips() {
        use crate::engine::erased::ErasedRule;

        let rule: &dyn ErasedRule = &ColorCycleRule;
        let cfg = ColorCycleConfig::defaults();
        let mut state = rule.init(&cfg, 0).expect("init");
        rule.advance_to(state.as_mut(), &cfg, 0, 17).expect("advance_to");

        // Downcast back to the concrete type and verify.
        let typed = state.downcast_ref::<ColorCycleState>().expect("downcast");
        assert_eq!(typed.iteration, 17);
    }
}
```

- [ ] **Step 3: Wire `rules` into lib.rs**

Modify `crates/viz-core/src/lib.rs` — add `pub mod rules;` alongside the existing module declarations:

```rust
use wasm_bindgen::prelude::*;

pub mod config;
pub mod engine;
pub mod rules;
pub mod traits;

pub use engine::Engine;

#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}
```

- [ ] **Step 4: Run tests**

```bash
cargo test --workspace
```

Expected: 26 passing total (21 prior + 5 new in `rules::color_cycle::tests`).

- [ ] **Step 5: Commit**

```bash
git add crates/viz-core/src/rules/ crates/viz-core/src/lib.rs
git commit -m "feat(rules): add ColorCycleRule (demo) with deterministic state"
```

---

## Task 6: ColorCycleViz (demo visualization)

**Files:**
- Create: `crates/viz-core/src/visualizations/mod.rs`
- Create: `crates/viz-core/src/visualizations/color_cycle.rs`
- Modify: `crates/viz-core/src/lib.rs` (add `pub mod visualizations;`)

- [ ] **Step 1: Create the visualizations module**

Create `crates/viz-core/src/visualizations/mod.rs`:

```rust
pub mod color_cycle;
```

- [ ] **Step 2: Write the visualization**

Create `crates/viz-core/src/visualizations/color_cycle.rs`:

```rust
//! Demo visualization: clears the canvas to an HSL-derived color that varies
//! with the rule's iteration and sub-progress. Uses no shaders, no buffers —
//! just `gl.clear()` from the WebGL2 context. Replaced by real visualizations
//! in Phase 3.

use serde::{Deserialize, Serialize};
use web_sys::WebGl2RenderingContext;

use crate::config::{boolean_property, color_property, number_property, ConfigSchema, NumberOpts};
use crate::rules::color_cycle::ColorCycleState;
use crate::traits::Visualization;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColorCycleVizConfig {
    /// Saturation 0..1.
    pub saturation: f32,
    /// Lightness at sub=0.
    pub lightness_min: f32,
    /// Lightness at sub=1.
    pub lightness_max: f32,
    /// Background color while iteration == 0.
    pub idle_color: [f32; 4],
    /// If true, hue advances continuously with sub_progress; otherwise hue
    /// snaps per integer iteration.
    pub smooth_hue: bool,
}

impl Default for ColorCycleVizConfig {
    fn default() -> Self {
        Self {
            saturation: 0.65,
            lightness_min: 0.20,
            lightness_max: 0.55,
            idle_color: [0.10, 0.10, 0.15, 1.0],
            smooth_hue: true,
        }
    }
}

impl ConfigSchema for ColorCycleVizConfig {
    fn schema() -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "saturation": number_property(NumberOpts {
                    label: "Saturation",
                    default: 0.65, min: 0.0, max: 1.0, step: 0.01,
                    integer: false, cosmetic: true, widget: None,
                }),
                "lightness_min": number_property(NumberOpts {
                    label: "Lightness min",
                    default: 0.20, min: 0.0, max: 1.0, step: 0.01,
                    integer: false, cosmetic: true, widget: None,
                }),
                "lightness_max": number_property(NumberOpts {
                    label: "Lightness max",
                    default: 0.55, min: 0.0, max: 1.0, step: 0.01,
                    integer: false, cosmetic: true, widget: None,
                }),
                "idle_color": color_property("Idle color", [0.10, 0.10, 0.15, 1.0]),
                "smooth_hue": boolean_property("Smooth hue", true, true),
            },
            "required": ["saturation", "lightness_min", "lightness_max", "idle_color", "smooth_hue"],
        })
    }

    fn defaults() -> serde_json::Value {
        serde_json::to_value(ColorCycleVizConfig::default()).unwrap()
    }
}

pub struct ColorCycleViz;

impl Visualization for ColorCycleViz {
    type Config = ColorCycleVizConfig;
    type State = ColorCycleState;

    fn id(&self) -> &'static str { "demo:color-cycle" }

    fn init(&mut self, _gl: &WebGl2RenderingContext, _cfg: &Self::Config) {}

    fn render(
        &mut self,
        gl: &WebGl2RenderingContext,
        state: &Self::State,
        cfg: &Self::Config,
    ) {
        let color = if state.iteration == 0 && state.sub_progress == 0.0 {
            cfg.idle_color
        } else {
            let hue_position = if cfg.smooth_hue {
                (state.iteration as f32 + state.sub_progress) / 360.0
            } else {
                state.iteration as f32 / 360.0
            };
            let hue = (hue_position * 360.0).rem_euclid(360.0);
            let lightness = cfg.lightness_min
                + (cfg.lightness_max - cfg.lightness_min) * state.sub_progress;
            let [r, g, b] = hsl_to_rgb(hue, cfg.saturation.clamp(0.0, 1.0), lightness.clamp(0.0, 1.0));
            [r, g, b, 1.0]
        };

        gl.clear_color(color[0], color[1], color[2], color[3]);
        gl.clear(WebGl2RenderingContext::COLOR_BUFFER_BIT);
    }

    fn resize(&mut self, gl: &WebGl2RenderingContext, w: u32, h: u32) {
        gl.viewport(0, 0, w as i32, h as i32);
    }
}

/// h ∈ [0, 360), s ∈ [0, 1], l ∈ [0, 1].
fn hsl_to_rgb(h: f32, s: f32, l: f32) -> [f32; 3] {
    let c = (1.0 - (2.0 * l - 1.0).abs()) * s;
    let h_prime = h / 60.0;
    let x = c * (1.0 - (h_prime.rem_euclid(2.0) - 1.0).abs());
    let (r1, g1, b1) = match h_prime as u32 {
        0 => (c, x, 0.0),
        1 => (x, c, 0.0),
        2 => (0.0, c, x),
        3 => (0.0, x, c),
        4 => (x, 0.0, c),
        5 => (c, 0.0, x),
        _ => (0.0, 0.0, 0.0),
    };
    let m = l - c / 2.0;
    [r1 + m, g1 + m, b1 + m]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_round_trip() {
        let v: ColorCycleVizConfig = serde_json::from_value(ColorCycleVizConfig::defaults()).unwrap();
        assert!((v.saturation - 0.65).abs() < 1e-6);
        assert!(v.smooth_hue);
    }

    #[test]
    fn hsl_red() {
        let [r, g, b] = hsl_to_rgb(0.0, 1.0, 0.5);
        assert!((r - 1.0).abs() < 1e-5);
        assert!(g.abs() < 1e-5);
        assert!(b.abs() < 1e-5);
    }

    #[test]
    fn hsl_green() {
        let [r, g, b] = hsl_to_rgb(120.0, 1.0, 0.5);
        assert!(r.abs() < 1e-5);
        assert!((g - 1.0).abs() < 1e-5);
        assert!(b.abs() < 1e-5);
    }

    #[test]
    fn hsl_zero_saturation_is_gray() {
        let [r, g, b] = hsl_to_rgb(200.0, 0.0, 0.5);
        assert!((r - 0.5).abs() < 1e-5);
        assert!((g - 0.5).abs() < 1e-5);
        assert!((b - 0.5).abs() < 1e-5);
    }
}
```

- [ ] **Step 3: Add `visualizations` to lib.rs**

Update `crates/viz-core/src/lib.rs` to:

```rust
use wasm_bindgen::prelude::*;

pub mod config;
pub mod engine;
pub mod rules;
pub mod traits;
pub mod visualizations;

pub use engine::Engine;

#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}
```

- [ ] **Step 4: Run tests**

```bash
cargo test --workspace
```

Expected: 30 passing (26 prior + 4 new in `visualizations::color_cycle::tests`).

- [ ] **Step 5: Commit**

```bash
git add crates/viz-core/src/visualizations/ crates/viz-core/src/lib.rs
git commit -m "feat(viz): add ColorCycleViz (demo) using gl.clear and HSL"
```

---

## Task 7: Engine rewrite

This task replaces the Phase 1 `Engine`. The new Engine holds a rule, a viz, their configs, the rule's scene state (as `Box<dyn Any>`), and a `PlaybackState`. It exposes a wasm-bindgen API the JS shell can call.

**Files:**
- Modify: `crates/viz-core/src/engine/mod.rs`

- [ ] **Step 1: Write the new Engine module**

Replace `crates/viz-core/src/engine/mod.rs` entirely with:

```rust
//! The engine ties rule + visualization + playback state together and exposes
//! the wasm-bindgen surface the JS shell drives.

use std::any::Any;

use serde_json::Value;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use web_sys::{HtmlCanvasElement, WebGl2RenderingContext};

pub mod erased;
pub mod playback;

use crate::config::ConfigSchema;
use crate::rules::color_cycle::{ColorCycleConfig, ColorCycleRule};
use crate::traits::{InputEvent, Visualization};
use crate::visualizations::color_cycle::{ColorCycleViz, ColorCycleVizConfig};
use erased::{ErasedRule, ErasedVisualization};
use playback::{advance_time, reduce, Command, PlaybackState};

#[wasm_bindgen]
pub struct Engine {
    gl: WebGl2RenderingContext,
    rule: Box<dyn ErasedRule>,
    viz: Box<dyn ErasedVisualization>,
    rule_cfg: Value,
    viz_cfg: Value,
    state: Box<dyn Any>,
    playback: PlaybackState,
    last_frame_ms: Option<f64>,
}

#[wasm_bindgen]
impl Engine {
    /// Construct an Engine bound to the canvas with id `canvas_id`. Phase 2
    /// hardwires ColorCycleRule + ColorCycleViz; Phase 3 will introduce a
    /// rule/viz registry indexed by string id.
    #[wasm_bindgen(constructor)]
    pub fn new(canvas_id: &str) -> Result<Engine, JsValue> {
        let window = web_sys::window().ok_or_else(|| JsValue::from_str("no window"))?;
        let document = window
            .document()
            .ok_or_else(|| JsValue::from_str("no document"))?;
        let canvas = document
            .get_element_by_id(canvas_id)
            .ok_or_else(|| JsValue::from_str(&format!("canvas #{canvas_id} not found")))?
            .dyn_into::<HtmlCanvasElement>()
            .map_err(|_| JsValue::from_str("element is not a canvas"))?;

        let gl = canvas
            .get_context("webgl2")?
            .ok_or_else(|| JsValue::from_str("WebGL2 not supported"))?
            .dyn_into::<WebGl2RenderingContext>()
            .map_err(|_| JsValue::from_str("not a WebGL2 context"))?;

        let rule_cfg = ColorCycleConfig::defaults();
        let viz_cfg = ColorCycleVizConfig::defaults();
        let max_iter = serde_json::from_value::<ColorCycleConfig>(rule_cfg.clone())
            .map(|c| c.max_iterations)
            .unwrap_or(360);

        let rule: Box<dyn ErasedRule> = Box::new(ColorCycleRule);
        let mut viz: Box<dyn ErasedVisualization> = Box::new(ColorCycleViz);

        viz.init(&gl, &viz_cfg)
            .map_err(|e| JsValue::from_str(&format!("viz init: {e}")))?;

        let state = rule
            .init(&rule_cfg, 0)
            .map_err(|e| JsValue::from_str(&format!("rule init: {e}")))?;

        Ok(Engine {
            gl,
            rule,
            viz,
            rule_cfg,
            viz_cfg,
            state,
            playback: PlaybackState::initial(0, max_iter),
            last_frame_ms: None,
        })
    }

    /// rAF callback. `now_ms` is `performance.now()` from JS.
    pub fn frame(&mut self, now_ms: f64) {
        let dt = match self.last_frame_ms {
            None => 0.0,
            Some(prev) => ((now_ms - prev) as f32 / 1000.0).max(0.0),
        };
        self.last_frame_ms = Some(now_ms);

        let prev_iter = self.playback.iteration;
        let rolled = advance_time(&mut self.playback, dt);
        if rolled > 0 || self.playback.iteration != prev_iter {
            // advance_time rolled past one or more iterations: bring scene
            // state up to the new integer iteration.
            let _ = self.rule.advance_to(
                self.state.as_mut(),
                &self.rule_cfg,
                self.playback.seed,
                self.playback.iteration,
            );
        }

        // Always interpolate within the current iteration.
        let _ = self.rule.substep(
            self.state.as_mut(),
            &self.rule_cfg,
            self.playback.seed,
            self.playback.iteration,
            self.playback.sub_progress,
        );

        self.viz.tick(dt);
        let _ = self.viz.render(&self.gl, self.state.as_ref(), &self.viz_cfg);
    }

    /// Receive a Command from JS. `cmd` deserializes to `playback::Command`.
    pub fn dispatch(&mut self, cmd: JsValue) -> Result<(), JsValue> {
        let parsed: Command = serde_wasm_bindgen::from_value(cmd)
            .map_err(|e| JsValue::from_str(&format!("bad command: {e}")))?;
        let caps = self.rule.capabilities();
        let r = reduce(self.playback, caps, &parsed);
        self.playback = r.next;

        if r.iteration_changed {
            // Cheap-recompute path: rebuild state from scratch up to current.
            if r.seed_changed || caps.cheap_recompute {
                let new_state = self
                    .rule
                    .init(&self.rule_cfg, self.playback.seed)
                    .map_err(|e| JsValue::from_str(&format!("rule init: {e}")))?;
                self.state = new_state;
            }
            let _ = self.rule.advance_to(
                self.state.as_mut(),
                &self.rule_cfg,
                self.playback.seed,
                self.playback.iteration,
            );
        }
        Ok(())
    }

    /// Snapshot the playback state for the UI to read each frame.
    pub fn snapshot(&self) -> JsValue {
        serde_wasm_bindgen::to_value(&self.playback).unwrap_or(JsValue::NULL)
    }

    pub fn rule_schema(&self) -> JsValue {
        serde_wasm_bindgen::to_value(&self.rule.schema()).unwrap_or(JsValue::NULL)
    }

    pub fn viz_schema(&self) -> JsValue {
        serde_wasm_bindgen::to_value(&self.viz.schema()).unwrap_or(JsValue::NULL)
    }

    pub fn rule_config(&self) -> JsValue {
        serde_wasm_bindgen::to_value(&self.rule_cfg).unwrap_or(JsValue::NULL)
    }

    pub fn viz_config(&self) -> JsValue {
        serde_wasm_bindgen::to_value(&self.viz_cfg).unwrap_or(JsValue::NULL)
    }

    /// Replace the rule config and reset playback. Phase 4's panel will call
    /// this on structural field edits.
    pub fn update_rule_config(&mut self, cfg: JsValue) -> Result<(), JsValue> {
        let parsed: Value = serde_wasm_bindgen::from_value(cfg)
            .map_err(|e| JsValue::from_str(&format!("bad rule config: {e}")))?;
        let new_max = serde_json::from_value::<ColorCycleConfig>(parsed.clone())
            .map(|c| c.max_iterations.max(1))
            .unwrap_or(self.playback.max_iterations);

        self.rule_cfg = parsed;
        self.playback.iteration = 0;
        self.playback.sub_progress = 0.0;
        self.playback.playing = false;
        self.playback.max_iterations = new_max;

        let new_state = self
            .rule
            .init(&self.rule_cfg, self.playback.seed)
            .map_err(|e| JsValue::from_str(&format!("rule init: {e}")))?;
        self.state = new_state;
        Ok(())
    }

    /// Replace the visualization config. Cosmetic-only edits don't reset
    /// playback; the engine doesn't enforce that distinction yet — the panel
    /// in Phase 4 will batch cosmetic vs structural separately.
    pub fn update_viz_config(&mut self, cfg: JsValue) -> Result<(), JsValue> {
        let parsed: Value = serde_wasm_bindgen::from_value(cfg)
            .map_err(|e| JsValue::from_str(&format!("bad viz config: {e}")))?;
        self.viz_cfg = parsed;
        let _ = self.viz.init(&self.gl, &self.viz_cfg);
        Ok(())
    }

    pub fn capabilities(&self) -> JsValue {
        serde_wasm_bindgen::to_value(&self.rule.capabilities()).unwrap_or(JsValue::NULL)
    }

    pub fn resize(&mut self, width: u32, height: u32) {
        self.viz.resize(&self.gl, width, height);
    }

    /// Forward a pointer/keyboard event from the canvas. JS shape matches
    /// the `InputEvent` enum (`{kind:"PointerMove", x:..., ...}` etc.).
    pub fn forward_input(&mut self, ev: JsValue) -> Result<(), JsValue> {
        let parsed: InputEvent = serde_wasm_bindgen::from_value(ev)
            .map_err(|e| JsValue::from_str(&format!("bad input: {e}")))?;
        self.viz.handle_input(&parsed);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    // No native unit tests for the Engine itself — it requires WebGL. See
    // crates/viz-core/tests/wasm.rs for browser-side tests (Task 9).
}
```

Note: the old Phase 1 `clamp_color` helper and its tests are removed by this rewrite. That's intentional — they served their purpose for Phase 1 and are no longer reachable.

- [ ] **Step 2: Verify the native test suite still passes**

```bash
cargo test --workspace
```

Expected: 28 tests pass. (Lost 2 from `clamp_color_*` removal; gained 0 in Engine itself; the prior count of 30 minus 2 = 28.)

If the test count is off, double-check that the old `clamp_color` tests were the only ones removed.

- [ ] **Step 3: Build for wasm**

```bash
wasm-pack build crates/viz-core --target web --out-dir pkg
```

Expected: clean build. `Engine`, `Engine.new`, `Engine.frame`, `Engine.dispatch`, etc. all appear in the generated `pkg/viz_core.d.ts`. Verify:

```bash
grep -E '(new|frame|dispatch|snapshot|rule_schema|viz_schema)' crates/viz-core/pkg/viz_core.d.ts | head -20
```

Each method should appear once.

- [ ] **Step 4: Refresh the web symlink**

```bash
cd web && npm install && cd ..
```

(No-op on most filesystems but safe to run; ensures `web/node_modules/viz-core` reflects the new exports.)

- [ ] **Step 5: Commit**

```bash
git add crates/viz-core/src/engine/mod.rs
git commit -m "feat(engine): refactor Engine to own rule+viz+state+playback"
```

---

## Task 8: App.svelte playback bar

This task replaces the Phase 1 RGBA-sliders demo with the playback control bar driving the new Engine. The visualization is the ColorCycleViz behind the scenes.

**Files:**
- Create: `web/src/lib/playback/commands.ts`
- Modify: `web/src/App.svelte`
- Modify: `web/src/lib/components/__tests__/App.test.ts` (update mock surface)

- [ ] **Step 1: Add the Command builders**

Create `web/src/lib/playback/commands.ts`:

```ts
// Mirrors crates/viz-core/src/engine/playback.rs::Command. Shape: {kind: "..."}.

export type Command =
  | { kind: 'Play' }
  | { kind: 'Pause' }
  | { kind: 'TogglePlay' }
  | { kind: 'StepForward' }
  | { kind: 'StepBack' }
  | { kind: 'JumpTo'; iteration: number }
  | { kind: 'SetSpeed'; value: number }
  | { kind: 'SetSeed'; value: string }   // string-encoded u64; engine parses
  | { kind: 'Reset' };

export const cmd = {
  play:        (): Command => ({ kind: 'Play' }),
  pause:       (): Command => ({ kind: 'Pause' }),
  togglePlay:  (): Command => ({ kind: 'TogglePlay' }),
  stepForward: (): Command => ({ kind: 'StepForward' }),
  stepBack:    (): Command => ({ kind: 'StepBack' }),
  jumpTo:      (iteration: number): Command => ({ kind: 'JumpTo', iteration }),
  setSpeed:    (value: number): Command => ({ kind: 'SetSpeed', value }),
  // Note: SetSeed transit format is decimal-string for u64 range; engine
  // does the parse. Phase 4 introduces a real seed widget.
  setSeed:     (value: string): Command => ({ kind: 'SetSeed', value }),
  reset:       (): Command => ({ kind: 'Reset' }),
};

export interface PlaybackSnapshot {
  iteration: number;
  sub_progress: number;
  playing: boolean;
  speed: number;
  seed: number;          // Note: JS Number loses precision above 2^53.
  max_iterations: number;
}

export interface Capabilities {
  supports_scrub: boolean;
  cheap_recompute: boolean;
  checkpoint_every: number | null;
}
```

**Note about `SetSeed` typing:** the Rust `Command::SetSeed { value: u64 }` won't accept a JS string directly. For Phase 2 we keep the JS-side type loose; in practice the Phase 2 UI exposes no seed control, so this command never fires. Phase 4 will introduce a string-typed widget and add explicit u64 parsing on the Rust side. The TS shape here documents the intended transit format for Phase 4.

- [ ] **Step 2: Replace App.svelte**

Replace `web/src/App.svelte` with:

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { loadVizCore } from './lib/wasm/loader';
  import type { Engine } from 'viz-core';
  import { cmd, type PlaybackSnapshot } from './lib/playback/commands';

  let canvas: HTMLCanvasElement;
  let engine = $state<Engine | null>(null);
  let snapshot = $state<PlaybackSnapshot>({
    iteration: 0,
    sub_progress: 0,
    playing: false,
    speed: 1.0,
    seed: 0,
    max_iterations: 1,
  });
  let rafId = 0;
  let lastNowMs = 0;

  onMount(async () => {
    const viz = await loadVizCore();
    engine = new viz.Engine('viz-canvas');
    sizeCanvas();

    const loop = (now: number) => {
      if (engine) {
        engine.frame(now);
        snapshot = engine.snapshot() as PlaybackSnapshot;
      }
      lastNowMs = now;
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);

    window.addEventListener('resize', sizeCanvas);
  });

  onDestroy(() => {
    cancelAnimationFrame(rafId);
    window.removeEventListener('resize', sizeCanvas);
  });

  function sizeCanvas() {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    engine?.resize(canvas.width, canvas.height);
  }

  function dispatch(c: ReturnType<typeof cmd[keyof typeof cmd]>) {
    engine?.dispatch(c);
  }
</script>

<div class="layout">
  <canvas id="viz-canvas" bind:this={canvas}></canvas>

  <footer class="playback-bar">
    <button onclick={() => dispatch(cmd.reset())} title="Reset to iteration 0">↺</button>
    <button onclick={() => dispatch(cmd.stepBack())} title="Step back">◀</button>
    <button
      onclick={() => dispatch(cmd.togglePlay())}
      title={snapshot.playing ? 'Pause' : 'Play'}
    >{snapshot.playing ? '⏸' : '▶'}</button>
    <button onclick={() => dispatch(cmd.stepForward())} title="Step forward">▶▶</button>

    <span class="iteration">
      {snapshot.iteration} / {snapshot.max_iterations}
      <span class="sub">{snapshot.sub_progress.toFixed(2)}</span>
    </span>

    <label class="speed">
      Speed
      <input
        type="range"
        min="0"
        max="60"
        step="0.5"
        value={snapshot.speed}
        oninput={(e) => dispatch(cmd.setSpeed(Number((e.target as HTMLInputElement).value)))}
      />
      <span class="value">{snapshot.speed.toFixed(1)}</span>
    </label>
  </footer>
</div>

<style>
  .layout {
    display: grid;
    grid-template-rows: 1fr auto;
    height: 100vh;
  }
  canvas {
    width: 100%;
    height: 100%;
    display: block;
  }
  .playback-bar {
    background: #1c1c1f;
    border-top: 1px solid #2a2a2f;
    padding: 0.5rem 1rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-size: 0.9rem;
  }
  .playback-bar button {
    background: #2a2a2f;
    color: #eee;
    border: 1px solid #3a3a40;
    border-radius: 4px;
    padding: 0.35rem 0.7rem;
    font-size: 1rem;
    cursor: pointer;
  }
  .playback-bar button:hover {
    background: #34343a;
  }
  .iteration {
    font-variant-numeric: tabular-nums;
    color: #bbb;
    min-width: 8rem;
  }
  .iteration .sub {
    color: #666;
    margin-left: 0.5rem;
  }
  .speed {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-left: auto;
    color: #bbb;
  }
  .speed .value {
    font-variant-numeric: tabular-nums;
    width: 2.5rem;
    text-align: right;
  }
</style>
```

- [ ] **Step 3: Update the App mount test for the new heading**

`web/src/lib/components/__tests__/App.test.ts` currently asserts on `'Clear color'` (a Phase 1 heading that no longer exists). Replace the file contents with:

```ts
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';

globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 0)) as typeof requestAnimationFrame;
globalThis.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as typeof cancelAnimationFrame;

// Mock the WASM loader so App.svelte mounts without instantiating WebGL.
vi.mock('../../wasm/loader', () => ({
  loadVizCore: vi.fn(() =>
    Promise.resolve({
      Engine: class {
        constructor(_: string) {}
        frame(_now: number) {}
        dispatch(_cmd: unknown) {}
        snapshot() {
          return {
            iteration: 0,
            sub_progress: 0,
            playing: false,
            speed: 1.0,
            seed: 0,
            max_iterations: 360,
          };
        }
        rule_schema() { return {}; }
        viz_schema() { return {}; }
        rule_config() { return {}; }
        viz_config() { return {}; }
        update_rule_config(_: unknown) {}
        update_viz_config(_: unknown) {}
        capabilities() { return { supports_scrub: true, cheap_recompute: true, checkpoint_every: null }; }
        resize(_w: number, _h: number) {}
        forward_input(_ev: unknown) {}
      },
    } as unknown as typeof import('viz-core'))
  ),
}));

import App from '../../../App.svelte';

describe('App.svelte', () => {
  it('mounts and renders the playback bar with iteration display', () => {
    const { getByTitle, container } = render(App);
    expect(getByTitle('Play')).toBeTruthy();
    expect(getByTitle('Step forward')).toBeTruthy();
    expect(getByTitle('Step back')).toBeTruthy();
    expect(getByTitle('Reset to iteration 0')).toBeTruthy();
    expect(container.textContent).toMatch(/0\s*\/\s*360/);
  });
});
```

- [ ] **Step 4: Run vitest + check + build**

```bash
cd web
npm run test   # expect 3 tests pass (2 loader + 1 App)
npm run check  # expect 0 errors
npm run build  # expect ✓ built
```

- [ ] **Step 5: Manual smoke (dev server)**

```bash
npm run dev > /tmp/vite_phase2.log 2>&1 &
sleep 4
cat /tmp/vite_phase2.log
curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://localhost:5173/
pkill -f vite || true
```

Expected: `VITE … ready` and `HTTP 200`. Open the URL in a browser. You should see a canvas filling most of the window plus a footer bar with buttons. Click play — the canvas should start cycling through colors. Click pause, step forward, step back, reset — each should behave per its label. The iteration counter updates live.

- [ ] **Step 6: Commit**

```bash
cd ..
git add web/src/App.svelte web/src/lib/playback/ web/src/lib/components/__tests__/App.test.ts
git commit -m "feat(ui): playback control bar driving engine.dispatch + snapshot"
```

---

## Task 9: Browser test for engine dispatch round-trip

**Files:**
- Modify: `crates/viz-core/tests/wasm.rs`

- [ ] **Step 1: Append new tests**

Replace `crates/viz-core/tests/wasm.rs` with (keeps the two Phase 1 tests, adds three new ones):

```rust
//! Browser-side smoke tests. Run with:
//!   wasm-pack test --chrome --headless crates/viz-core

use wasm_bindgen::JsCast;
use wasm_bindgen::JsValue;
use wasm_bindgen_test::*;
use web_sys::HtmlCanvasElement;
use viz_core::Engine;

wasm_bindgen_test_configure!(run_in_browser);

fn make_canvas(id: &str) -> HtmlCanvasElement {
    let document = web_sys::window().unwrap().document().unwrap();
    let canvas = document
        .create_element("canvas")
        .unwrap()
        .dyn_into::<HtmlCanvasElement>()
        .unwrap();
    canvas.set_id(id);
    canvas.set_width(64);
    canvas.set_height(64);
    document.body().unwrap().append_child(&canvas).unwrap();
    canvas
}

fn cmd(json: &str) -> JsValue {
    js_sys::JSON::parse(json).expect("valid JSON")
}

#[wasm_bindgen_test]
fn engine_constructs_with_a_canvas() {
    make_canvas("test-canvas-construct");
    let engine = Engine::new("test-canvas-construct").expect("engine constructs");
    engine.frame(0.0);
}

#[wasm_bindgen_test]
fn engine_errors_when_canvas_missing() {
    let result = Engine::new("definitely-not-a-canvas-id");
    assert!(result.is_err());
}

#[wasm_bindgen_test]
fn engine_step_forward_increments_iteration() {
    make_canvas("test-canvas-stepfwd");
    let mut engine = Engine::new("test-canvas-stepfwd").expect("engine constructs");

    engine.dispatch(cmd(r#"{"kind":"StepForward"}"#)).expect("dispatch");

    let snap = engine.snapshot();
    let iter = js_sys::Reflect::get(&snap, &JsValue::from_str("iteration"))
        .expect("iteration field")
        .as_f64()
        .expect("number");
    assert_eq!(iter as u32, 1);
}

#[wasm_bindgen_test]
fn engine_reset_returns_to_zero() {
    make_canvas("test-canvas-reset");
    let mut engine = Engine::new("test-canvas-reset").expect("engine constructs");

    engine.dispatch(cmd(r#"{"kind":"StepForward"}"#)).expect("dispatch");
    engine.dispatch(cmd(r#"{"kind":"StepForward"}"#)).expect("dispatch");
    engine.dispatch(cmd(r#"{"kind":"Reset"}"#)).expect("dispatch");

    let snap = engine.snapshot();
    let iter = js_sys::Reflect::get(&snap, &JsValue::from_str("iteration"))
        .expect("iteration field")
        .as_f64()
        .expect("number");
    assert_eq!(iter as u32, 0);
}

#[wasm_bindgen_test]
fn engine_schema_round_trip() {
    make_canvas("test-canvas-schema");
    let engine = Engine::new("test-canvas-schema").expect("engine constructs");

    let schema = engine.rule_schema();
    assert!(!schema.is_null());
    // Top-level "type" should be "object".
    let ty = js_sys::Reflect::get(&schema, &JsValue::from_str("type"))
        .expect("type field")
        .as_string()
        .expect("string");
    assert_eq!(ty, "object");
}
```

(`js_sys::JSON::parse` and `js_sys::Reflect` are already available because `js-sys` is in our dependencies — confirmed in Phase 1's Cargo.toml.)

- [ ] **Step 2: Run the browser tests**

If wasm-pack downloaded a chromedriver that matches your Chrome (the easy case):

```bash
wasm-pack test --chrome --headless crates/viz-core
```

If it doesn't match (you saw this on Phase 1), use the saved matched driver:

```bash
wasm-pack test --chrome --headless --chromedriver=/tmp/chromedriver-mac-arm64/chromedriver crates/viz-core
```

Expected: `running 5 tests` ... `test result: ok. 5 passed; 0 failed`.

- [ ] **Step 3: Commit**

```bash
git add crates/viz-core/tests/wasm.rs
git commit -m "test: wasm-bindgen-test coverage for engine dispatch + snapshot"
```

---

## Task 10: README update + Phase 2 acceptance

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-05-23-phase-2-core-abstractions.md` (this file; mark Phase 2 done at the bottom)

- [ ] **Step 1: Update the README's Status line and project layout**

Modify `README.md`. Change the Status line from:

```markdown
> **Status:** Phase 1 — toolchain and clear-color canvas. See …
```

to:

```markdown
> **Status:** Phase 2 — core abstractions and playback engine, validated with a demo ColorCycleRule + ColorCycleViz. See …
```

In the "Project layout" code block, replace the existing tree with this updated one (reflects the new module structure):

```
math-visualizer/
├── crates/viz-core/                  # Rust crate compiled to WebAssembly
│   ├── src/
│   │   ├── lib.rs                    # wasm-bindgen entry point
│   │   ├── traits.rs                 # SceneState, Rule, Visualization
│   │   ├── config/                   # ConfigSchema trait + JSON helpers
│   │   ├── engine/
│   │   │   ├── mod.rs                # Engine: orchestrates rule + viz + playback
│   │   │   ├── playback.rs           # PlaybackState, Command, reducer
│   │   │   └── erased.rs             # Type-erased dispatch over Rule/Visualization
│   │   ├── rules/
│   │   │   └── color_cycle.rs        # Demo rule (replaced in Phase 3)
│   │   └── visualizations/
│   │       └── color_cycle.rs        # Demo viz (replaced in Phase 3)
│   └── tests/wasm.rs                 # Browser smoke tests
└── web/                              # Vite + Svelte 5 app
    ├── src/
    │   ├── App.svelte                # Canvas + playback control bar
    │   ├── main.ts
    │   └── lib/
    │       ├── playback/commands.ts  # Typed Command builders for engine.dispatch
    │       └── wasm/loader.ts        # Single-flight WASM module loader
    ├── package.json
    └── vite.config.ts
```

- [ ] **Step 2: Run the full Phase 2 acceptance checklist**

From the repo root:

```bash
# Rust unit tests — expect 28 passing
cargo test --workspace

# WASM browser tests — expect 5 passing (use --chromedriver=PATH if needed)
wasm-pack test --chrome --headless crates/viz-core

# JS tests — expect 3 passing
cd web && npm run test

# Type check — expect 0 errors
npm run check

# Production build — expect ✓ built
npm run build
cd ..
```

All five gates must pass. If any fail, fix in place rather than committing forward.

- [ ] **Step 3: Manual browser checklist**

Run `cd web && npm run dev` and open http://localhost:5173/. Verify:

- Canvas fills the window; below it sits a playback bar with ↺ ◀ ▶ ▶▶ buttons, an iteration label (`0 / 360`), and a speed slider.
- Click ▶: canvas starts cycling through colors (red → yellow → green → cyan → blue → magenta → red, smoothly). Iteration counter advances.
- Click ⏸: animation freezes.
- Click ▶▶: iteration advances by exactly 1, sub-progress resets to 0.00. Canvas color snaps to the new iteration's hue.
- Click ◀: iteration decreases by 1.
- Click ↺ after stepping: returns to iteration 0, canvas to idle color.
- Drag speed slider: animation speed changes; iteration counter advances faster/slower accordingly. At speed=0, playback freezes even when ▶ is on.
- DevTools console: clean, no red errors.
- DevTools network: `viz_core_bg.wasm` loaded `200`.
- Resize window: canvas stays crisp.

Stop the dev server (`pkill -f vite`).

- [ ] **Step 4: Commit the README and close out**

```bash
git add README.md docs/superpowers/plans/
git commit -m "docs: README update and Phase 2 acceptance"
```

(There aren't pending changes in the plan doc itself, but staging it is harmless if `git status` shows nothing modified — skip the file from `git add` in that case.)

---

## Phase 2 acceptance summary

After Task 10 the following must all be true. Do not call Phase 2 done until each is verified:

- [ ] `cargo test --workspace` → 28 tests pass.
- [ ] `wasm-pack test --chrome --headless crates/viz-core` → 5 tests pass.
- [ ] `cd web && npm run test` → 3 tests pass.
- [ ] `cd web && npm run check` → 0 errors / 0 warnings.
- [ ] `cd web && npm run build` → succeeds.
- [ ] Manual browser checklist (Task 10 Step 3) — every item passes.

Phase 3 begins with a new plan: it adds the `crates/viz-core/src/render/` utilities (Camera2D, SDF circle, InstancedPoints, LineBatch), the `MidpointOnCircle` rule, the `DotsOnCircle` visualization, and swaps them in for the demo rule + viz at the `Engine::new` defaults.
