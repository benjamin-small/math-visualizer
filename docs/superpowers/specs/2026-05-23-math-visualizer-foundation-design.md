# Math Visualizer — Foundation Design

**Date:** 2026-05-23
**Status:** Approved through brainstorming; awaiting spec review before implementation plan.

## 1. Goals

Build a reusable, composable framework for interactive math visualizations, and ship the first visualization on top of it.

The framework must support:
- Multiple **Rules** (the math/logic of what to compute each iteration).
- Multiple **Visualizations** (how to render a rule's state).
- A **Configuration** panel that adapts automatically to whichever rule + viz are loaded.
- A **Playback** model with play/pause, step forward/back, and timeline scrub, where supported by the rule.
- Coordinate-system agnosticism: 2D polar, 2D grid, and 3D visualizations must all be expressible without engine changes.

Performance must scale from the first viz (≤ 10k dots) to future particle physics (≥ 100k entities at 60 fps) without rearchitecting.

The first visualization is the **midpoint-on-circle rule**:
1. Draw a circle.
2. Per iteration: place a random reference dot on the perimeter, a random reference dot inside the circle, then a permanent dot at the midpoint of those two. Reference dots clear at the end of the iteration.
3. Repeat for a configurable count.

## 2. Tech stack

- **Rust** compiled to WebAssembly with `wasm-pack` (target `web`) and `wasm-bindgen`.
- **WebGL2** accessed directly via `web-sys::WebGl2RenderingContext` (no `glow`/`wgpu` — the goal includes learning the raw WebGL API).
- **Svelte** (plain Svelte + Vite, not SvelteKit) for the UI shell: configuration panel, playback controls.
- **Vite** with `vite-plugin-wasm` and `vite-plugin-top-level-await` for bundling and dev server.
- **Build flow in dev:** `wasm-pack build crates/viz-core --target web` (re-run on Rust changes via `cargo-watch`) + `vite dev` for the Svelte side. Two processes; explicit and easy to debug.
- Ships as a static SPA.

## 3. Repository layout

```
math-visualizer/
├── crates/
│   └── viz-core/                  # Rust → WASM
│       ├── src/
│       │   ├── lib.rs             # wasm-bindgen entry, public API
│       │   ├── engine/            # Playback engine, scene state mgmt, checkpoints
│       │   ├── rules/             # Rule implementations (midpoint, ...)
│       │   ├── visualizations/    # WebGL2 renderers
│       │   ├── render/            # Reusable WebGL helpers (cameras, programs, batches)
│       │   └── config/            # ConfigSchema trait + derive macro
│       └── Cargo.toml
├── web/                           # Vite + Svelte app
│   ├── src/
│   │   ├── lib/
│   │   │   ├── widgets/           # Generic config widgets (slider, color, number, ...)
│   │   │   ├── playback/          # Play/pause/scrub controls
│   │   │   └── wasm/              # Typed wrapper around the WASM module
│   │   ├── App.svelte
│   │   ├── main.ts
│   │   └── app.css
│   ├── index.html
│   ├── package.json
│   └── vite.config.ts
├── docs/superpowers/specs/
└── README.md
```

Single Cargo crate for v1. If `viz-core` grows past ~3000 lines or a clear engine/rules/render seam emerges, split into separate crates later.

## 4. Core abstractions (Rust)

Four traits/types form the framework contract. The framework knows nothing about coordinate systems, dimensions, or rendering primitives — those live entirely in `Rule` and `Visualization` implementations.

### 4.1 SceneState

Per-rule, opaque to the framework. Examples:

- `MidpointState { permanent: Vec<[f32; 2]>, ref_perimeter: Option<[f32; 2]>, ref_interior: Option<[f32; 2]>, preview_midpoint: Option<[f32; 2]>, current_iteration: u32 }`
- `GridState { cells: Vec<u8>, width: u32, height: u32 }` — 2D cellular automata
- `ParticleState { positions: Vec<f32>, velocities: Vec<f32> }` — 2D or 3D particles
- `MeshState { vertices: Vec<f32>, indices: Vec<u32> }` — 3D meshes

```rust
pub trait SceneState {
    fn clear(&mut self);
}
```

### 4.2 Rule

```rust
pub trait Rule {
    type Config: ConfigSchema + DeserializeOwned + Serialize;
    type State: SceneState;

    fn id(&self) -> &'static str;
    fn capabilities(&self) -> Capabilities;

    fn init(&self, cfg: &Self::Config, seed: u64) -> Self::State;

    /// Advance `state` to integer iteration `n`. Idempotent for the
    /// same n: callers may invoke repeatedly for the same target.
    fn advance_to(&self, state: &mut Self::State, cfg: &Self::Config,
                  seed: u64, n: u32);

    /// Optional interpolated state within iteration n for animated play.
    /// `sub` ∈ [0, 1]. Default impl: no-op.
    fn substep(&self, _state: &mut Self::State, _cfg: &Self::Config,
               _seed: u64, _n: u32, _sub: f32) {}
}

pub struct Capabilities {
    pub supports_scrub: bool,
    pub cheap_recompute: bool,
    pub checkpoint_every: Option<u32>,
}
```

### 4.3 Visualization

```rust
pub trait Visualization {
    type State: SceneState;
    type Config: ConfigSchema + DeserializeOwned + Serialize;

    fn id(&self) -> &'static str;
    fn init(&mut self, gl: &WebGl2RenderingContext, cfg: &Self::Config);
    fn render(&mut self, gl: &WebGl2RenderingContext, state: &Self::State,
              cfg: &Self::Config);
    fn resize(&mut self, gl: &WebGl2RenderingContext, w: u32, h: u32);

    fn handle_input(&mut self, _ev: &InputEvent) {}
    fn tick(&mut self, _dt: f32) {}
}

pub enum InputEvent {
    PointerDown { x: f32, y: f32, button: u8 },
    PointerMove { x: f32, y: f32, dx: f32, dy: f32, buttons: u8 },
    PointerUp   { x: f32, y: f32, button: u8 },
    Wheel       { dx: f32, dy: f32 },
    Key         { code: String, down: bool, modifiers: Modifiers },
}
```

Compile-time state-type matching enforces Rule/Viz compatibility within Rust. Across the WASM boundary, a registry pairs Rule and Viz by string id; mismatched pairings fail at construction with a clear error.

### 4.4 ConfigSchema

```rust
pub trait ConfigSchema {
    fn schema() -> serde_json::Value;  // JSON Schema with x-* UI hints
    fn defaults() -> serde_json::Value;
}
```

Implemented via a `#[derive(ConfigSchema)]` proc-macro that reads field attributes:

```rust
#[derive(Serialize, Deserialize, ConfigSchema)]
pub struct DotsOnCircleVizConfig {
    #[config(min = 10.0, max = 800.0, step = 1.0,
             label = "Circle radius", cosmetic)]
    pub circle_radius: f32,

    #[config(widget = "color", label = "Background", cosmetic)]
    pub background: [f32; 4],
    // ...
}
```

Attributes:
- `min`, `max`, `step` → slider bounds.
- `label` → human-readable label in the panel.
- `widget = "color" | "seed" | "select"` → forces a specific widget; otherwise inferred from type.
- `cosmetic` → field can be edited live without resetting playback. Default is *structural*: edits reset iteration to 0 and pause.
- `enum_options = [...]` → for select widgets.

### 4.5 Shared rendering utilities (`viz-core::render`)

Composable building blocks any visualization can use. Not part of the trait contract — just convenience.

- `Camera2D` — orthographic projection, pan, zoom, fit-to-content.
- `OrbitCamera3D` — perspective, orbit/dolly/pan, default input bindings.
- `InstancedPoints` — efficient many-dot rendering (instanced quads with per-instance position, color, size).
- `LineBatch` — batched line-segment rendering.
- `MeshRenderer` — basic indexed mesh draw.
- `ShaderProgram` — thin wrapper over compile/link/uniform setting.

## 5. Engine and playback

### 5.1 State

```rust
pub struct PlaybackState {
    pub iteration: u32,
    pub sub_progress: f32,    // [0, 1] within current iteration
    pub playing: bool,
    pub speed: f32,           // iterations per second
    pub seed: u64,
    pub max_iterations: u32,  // mirrored from rule config
}

pub enum Command {
    Play, Pause, TogglePlay,
    StepForward, StepBack,
    JumpTo(u32),
    SetSpeed(f32),
    SetSeed(u64),
    Reset,
}
```

### 5.2 Engine

```rust
#[wasm_bindgen]
pub struct Engine { /* fields hidden */ }

#[wasm_bindgen]
impl Engine {
    pub fn new(canvas_id: &str, rule_id: &str, viz_id: &str) -> Result<Engine, JsValue>;

    pub fn dispatch(&mut self, cmd: JsValue);
    pub fn frame(&mut self, now_ms: f64);

    pub fn rule_schema(&self) -> JsValue;
    pub fn viz_schema(&self) -> JsValue;
    pub fn rule_config(&self) -> JsValue;
    pub fn viz_config(&self) -> JsValue;
    pub fn update_rule_config(&mut self, cfg: JsValue);
    pub fn update_viz_config(&mut self, cfg: JsValue);

    pub fn snapshot(&self) -> JsValue;          // PlaybackState as JSON
    pub fn capabilities(&self) -> JsValue;      // for UI adaptation
    pub fn resize(&mut self, w: u32, h: u32);
    pub fn forward_input(&mut self, ev: JsValue);
}
```

The engine holds the rule, viz, scene state, both configs, the playback state, and (for expensive rules) a `BTreeMap<u32, Box<dyn Any>>` of checkpoints.

### 5.3 Per-frame flow

Called once per `requestAnimationFrame` from JS:

1. `dt = now_ms - last_frame_time`.
2. If `playing`: `sub_progress += dt * speed`. When it crosses 1.0, increment `iteration`. Clamp at `max_iterations` and pause.
3. Reconstruct scene state for the new integer iteration:
   - **cheap_recompute = true**: `rule.init(...)` + `rule.advance_to(state, ..., n)` from scratch.
   - **checkpoint_every = Some(k)**: find nearest checkpoint ≤ n, clone, `advance_to(n)`. Record a new checkpoint every k iterations as crossed.
   - **supports_scrub = false**: only allow forward `step()`. Reject `JumpTo(n < current)` at the API level.
4. `rule.substep(state, ..., n, sub_progress)` for in-between animation.
5. `viz.tick(dt)` then `viz.render(gl, &state, &viz_cfg)`.

### 5.4 Command semantics

- `StepForward` / `StepBack` → adjust `iteration ± 1`, set `sub_progress = 0`, pause.
- `JumpTo(n)` → set `iteration = n`, `sub_progress = 0`. UI disables this when `!supports_scrub`.
- `SetSeed` → reset to iteration 0, paused.
- `Reset` → iteration 0, sub_progress 0, paused; seed unchanged.
- **Config edits**:
  - All-cosmetic field updates → apply live, no playback change.
  - Any structural field updated → reset to iteration 0, paused.

### 5.5 UI capability adaptation

When a scene is loaded, Svelte reads `engine.capabilities()`:

- `supports_scrub = false` → hide back button and timeline.
- `supports_scrub = true, cheap_recompute = true` → full timeline with instant scrubbing.
- `supports_scrub = true, cheap_recompute = false` → timeline snaps to nearest checkpoint on drag; show a brief "computing…" indicator on big jumps.

### 5.6 Deferred

- Snap-when-fast for the substep animation (currently always animated; at very high `speed`, substeps would be invisible). Punted to a later iteration.

## 6. Configuration UI

### 6.1 Schema flow

1. `#[derive(ConfigSchema)]` macro generates `schema()` and `defaults()` per config struct.
2. WASM exposes both rule and viz schemas to JS as JSON.
3. Svelte `<ConfigSection>` walks the schema and dispatches each field to a widget:
   - `number` with min/max → `<RangeSlider>`
   - `integer` → `<NumberInput>`
   - `boolean` → `<Toggle>`
   - `widget = "color"` → `<ColorPicker>` (returns `[r, g, b, a]` floats)
   - `widget = "select"` with `enum_options` → `<Select>`
   - `widget = "seed"` → `<SeedInput>` with shuffle and lock controls
4. The panel renders two sections side by side or stacked: **Rule** and **Visualization**.

### 6.2 Cosmetic vs structural

- Cosmetic field edits debounce ~50 ms then call `engine.update_viz_config(...)`. Live preview, no playback disruption.
- Structural field edits call `engine.update_rule_config(...)` immediately, which resets `iteration = 0`, `sub_progress = 0`, `playing = false`.

### 6.3 Seed handling

`u64` exceeds JS `Number` safe-integer range. The seed field uses a decimal-string representation in the JSON schema (`widget = "seed"`) and parses to `u64` in Rust. Includes a 🎲 randomize button. Avoids `BigInt` plumbing.

### 6.4 Layout

- Main area (left/fill): the WebGL canvas, sized to the viewport.
- Config panel (right): ~320 px, collapsible.
- Bottom bar: back / play-pause / forward / reset / timeline scrub / speed slider / iteration label (e.g. "47 / 500").

### 6.5 Persistence

`(rule_cfg, viz_cfg, seed)` saved to `localStorage` keyed by `<rule-id>:<viz-id>`. Restored on page load. (In v1 the rule/viz pair is hardcoded; the key form lands now so adding selection UI later doesn't require migrating storage.) Sharable URL via `#config=base64(...)` is a nice-to-have; deferred to a later iteration.

## 7. First visualization: midpoint-on-circle

### 7.1 Rule

```rust
pub struct MidpointOnCircle;

#[derive(Serialize, Deserialize, ConfigSchema)]
pub struct MidpointConfig {
    #[config(min = 1, max = 10_000, step = 1, label = "Iterations")]
    pub max_iterations: u32,

    #[config(widget = "seed", label = "Seed")]
    pub seed: String,  // decimal-string u64 (see §6.3); engine parses to u64
                       // before passing into Rule::{init,advance_to,substep}
}

pub struct MidpointState {
    pub permanent: Vec<[f32; 2]>,
    pub ref_perimeter: Option<[f32; 2]>,
    pub ref_interior: Option<[f32; 2]>,
    /// Set by `substep` during the [0.66, 1.0] sub-range so the viz can
    /// draw the midpoint preview before it commits to `permanent`.
    /// Cleared by `advance_to`.
    pub preview_midpoint: Option<[f32; 2]>,
    pub current_iteration: u32,
}
```

Capabilities: `supports_scrub = true`, `cheap_recompute = true`, `checkpoint_every = None`.

**Convention:** "iteration n" means *n full iterations have completed*. So at `iteration = 0`, nothing has happened yet (empty `permanent`). At `iteration = 5`, the midpoints from iterations 0, 1, 2, 3, 4 are all in `permanent`. The "currently animating" iteration during play is iteration n (the one whose substep ∈ [0,1] is in flight); when its substep reaches 1.0, the integer iteration becomes n+1 and the midpoint of the just-finished iteration is now in `permanent`.

`advance_to(state, cfg, seed, n)`:
- Clear `state.permanent`.
- For each `i in 0..n.min(cfg.max_iterations)`:
  - Per-iteration RNG seeded by `splitmix64(seed ^ i as u64)` (order-independent jumping).
  - Sample perimeter point: `theta ~ U[0, 2π)`, point = `(cos θ, sin θ)` on the unit circle.
  - Sample interior point: rejection-sample `(x, y) ~ U[-1, 1]²` until `x² + y² < 1`.
  - Push midpoint `((p.x + q.x) / 2, (p.y + q.y) / 2)` to `state.permanent`.
- Set `state.ref_perimeter = None`, `state.ref_interior = None`. (`advance_to` represents the *static snapshot* at integer iteration n; reference dots are an animation artifact owned by `substep`.)
- Set `state.current_iteration = n`.

`substep(state, ..., n, sub)`:
- Mutates only `state.ref_perimeter` and `state.ref_interior`. Never touches `state.permanent` — the new midpoint enters `permanent` when the engine's next `advance_to(n+1)` call fires at iteration rollover.
- Compute iteration n's reference points from `splitmix64(seed ^ n as u64)`.
- `sub ∈ [0.00, 0.33)` → `ref_perimeter = Some(p)`, `ref_interior = None`.
- `sub ∈ [0.33, 0.66)` → both `ref_*` set; viz draws the line between them.
- `sub ∈ [0.66, 1.00]` → both `ref_*` still set; `preview_midpoint = Some(mid)` so the viz draws the to-be-permanent dot at the midpoint (visible during the merge moment). The actual `permanent` push happens via `advance_to(n+1)` at rollover, which also clears `preview_midpoint`.

All math in unit-circle model space; the viz handles scaling to pixels.

### 7.2 Visualization

`DotsOnCircle` composes:
- `Camera2D` (fit-to-content for the unit circle with a configurable padding).
- One fragment-shader SDF circle (single quad covering the circle's bounding box, fragment shader computes signed distance and antialiases the stroke).
- `InstancedPoints` draw for all permanent dots (one color/size from config).
- `InstancedPoints` draw for the up-to-two reference dots (per-dot color from config).
- Optional `LineBatch` segment between the two reference dots during substep `[0.33, 1.0]`.

```rust
#[derive(Serialize, Deserialize, ConfigSchema)]
pub struct DotsOnCircleVizConfig {
    #[config(min = 10.0, max = 800.0, step = 1.0,
             label = "Circle radius (display)", cosmetic)]
    pub circle_radius: f32,

    #[config(min = 0.5, max = 8.0, step = 0.1,
             label = "Circle stroke", cosmetic)]
    pub circle_stroke: f32,

    #[config(widget = "color", label = "Circle color", cosmetic)]
    pub circle_color: [f32; 4],

    #[config(widget = "color", label = "Perimeter dot", cosmetic)]
    pub perimeter_color: [f32; 4],

    #[config(widget = "color", label = "Interior dot", cosmetic)]
    pub interior_color: [f32; 4],

    #[config(widget = "color", label = "Midpoint dot", cosmetic)]
    pub midpoint_color: [f32; 4],

    #[config(min = 0.5, max = 20.0, step = 0.1,
             label = "Dot size (px)", cosmetic)]
    pub dot_size: f32,

    #[config(widget = "color", label = "Reference line", cosmetic)]
    pub line_color: [f32; 4],

    #[config(widget = "color", label = "Background", cosmetic)]
    pub background: [f32; 4],
}
```

`resize(w, h)` updates the camera's viewport. No buffer reallocation.

## 8. Testing strategy

- **Rust unit tests** (`cargo test`):
  - `sample_iter(seed, n)` is deterministic, bounded (perimeter point on unit circle within ε, interior point strictly inside).
  - `advance_to(state, cfg, seed, n)` produces identical `permanent` vectors for the same (seed, n) regardless of starting iteration.
  - `midpoint(a, b)` correctness.
  - `ConfigSchema::schema()` round-trips through serde without loss.
  - `PlaybackState` command transitions, including edges at iteration 0 and `max_iterations`.
- **WASM integration tests** with `wasm-bindgen-test` (`wasm-pack test --chrome --headless`):
  - Engine instantiation, command dispatch, snapshot inspection.
  - Capability gating: `JumpTo(n < current)` rejected when `supports_scrub = false`.
  - Cosmetic vs structural config update side effects.
- **Svelte component tests** (Vitest):
  - Widgets render correctly from a sample JSON schema.
  - Debounce + structural-reset behavior.
- **Manual visual checklist** for v1 release:
  - First iteration renders correctly from a fresh page load.
  - Step forward/back work, including across rollover at the iteration boundary.
  - Timeline scrubbing is smooth.
  - Color/size changes apply live without resetting playback.
  - Seed change resets playback.
  - `localStorage` persistence survives a page reload.
- **Visual regression tests** (Playwright + canvas pixel snapshots) deferred to v2.

## 9. Non-goals (v1)

- Multiple rule/viz selection UI (the first build hardcodes the midpoint-on-circle pairing; selection UI lands when the second rule does).
- Sharable URL config encoding.
- WebGPU support.
- Server-side anything.
- Mobile / touch input tuning (basic mouse only).
- Visual regression tests.

## 10. Open implementation questions

- Exact WebGL2 plumbing: whether the engine owns the `WebGl2RenderingContext` and lends it to viz, or the viz acquires it from the canvas during `init`. Lean toward engine-owned (single point of context-loss handling). Decide during implementation.
- Whether to use `gl.POINTS` with a `gl_PointSize` shader vs instanced quads for the dot rendering. Instanced quads scale better and antialias more reliably; default to that.
- Whether `cargo-watch` + `wasm-pack` rebuild is fast enough for tight iteration, or if a Vite plugin (`vite-plugin-wasm-pack`) gives a better DX. Try the explicit approach first.
