# Sierpinski 3D Tetrahedron — Design

**Date:** 2026-06-06
**Status:** Approved for implementation
**Supersedes:** the 2D Sierpinski-triangle visualization shipped with Phase 3.

## Summary

Replace the 2D Sierpinski triangle (3-corner chaos game) with a 3D Sierpinski
tetrahedron (4-corner chaos game). The tetrahedron auto-rotates around its
vertical axis while the fractal fills in; the user can click-drag to orbit
the camera (azimuth + elevation). Each trail dot is tinted toward the corner
that produced it, making the four self-similar sub-tetrahedra visually
distinct.

This is a hard replacement: the 2D triangle rule (`SierpinskiChaos` 2D) and
its visualization (`SierpinskiTriangle`) are removed. The Phase 2 demos
(`ColorCycle`) and the Phase 3 alternative (`MidpointOnCircle` +
`DotsOnCircle`) stay in the codebase as 2D fallbacks for Phase 4's selector UI.

## Goals

1. The flagship visualization is a rotating 3D Sierpinski tetrahedron.
2. Each iteration animates a midpoint move toward one of four corners, then
   drops a dot tinted by that corner.
3. The camera auto-rotates by default; the user can click-drag to orbit.
4. The codebase still keeps its 2D rules/vizzes working as alternatives.

## Non-goals

- Free-fly camera (FPS-style WASD movement). Turntable only.
- Phase 4 rule selector UI — out of scope for this change.
- Wheel-based zoom in the canvas. The existing +/-/reset zoom controls in
  the canvas's upper-left handle zoom; pointer events are reserved for
  orbiting.
- Lighting / shading. The tetrahedron is a wireframe + colored dots.
- Mobile multi-touch gestures (pinch-zoom). Single-finger drag orbits;
  zoom stays on the buttons.

## Architecture

### Algorithm — `crates/viz-core/src/rules/sierpinski_chaos.rs`

- **Corners.** `CORNERS: [[f32; 3]; 4]` — a regular tetrahedron with
  vertices at `(+1, +1, +1)`, `(+1, -1, -1)`, `(-1, +1, -1)`, `(-1, -1, +1)`
  scaled by `1 / (2√2)`. Edge length = 1; circumscribed sphere radius
  `√3 / (2√2) ≈ 0.612`; centroid at the origin.
- **Pick.** `pick_corner(seed, i)` returns `0..4` — `(splitmix64(seed ^ i) >> 56) as usize & 0b11`. Top byte mod 4 is uniform (no bias).
- **Halfway / lerp.** 3D variants — straight element-wise from the 2D code.
- **Initial position.** `random_inside_tetrahedron(seed)`: draw three uniform
  `f32`s `u, v, w`; if `u + v + w > 1`, reflect via `u = 1 - u`, `v = 1 - v`,
  `w = 1 - w` (the standard simplex-sampling trick); then
  `P = a*A + u*B + v*C + w*D` with `a = 1 - u - v - w`. Yields a uniform
  point strictly inside the tetrahedron.
- **State.** `ChaosGameState`:
  - `initial_position: [f32; 3]`
  - `trail: Vec<[f32; 3]>`
  - `corner_for_dot: Vec<u8>` — pushed in lockstep with `trail`, records
    which corner produced each dot so the visualization can tint dots by
    corner without re-running the RNG per frame
  - `current_position: Option<[f32; 3]>` (substep animation, same role)
  - `chosen_corner: Option<usize>` (0..4)
  - `current_iteration: u32`
- **Substep.** Same two-phase structure as the 2D version: `sub < 0.33`
  highlights the chosen corner with `current_position = None`; `sub >= 0.33`
  lerps a single dot from the previous trail point toward the halfway
  target. No behavior change in 3D.

### Renderers (additive — 2D types untouched)

Three new files in `crates/viz-core/src/render/`:

#### `camera_3d.rs`

A turntable camera. Public fields/methods:

- `azimuth: f32`, `elevation: f32` (radians)
- `distance: f32`, `fov_y: f32` (radians), `aspect: f32`
- `target: [f32; 3]` (default origin)
- `viewport_px: [u32; 2]`
- `auto_advance(&mut self, dt: f32, speed: f32)` — `azimuth += dt * speed`
- `orbit_drag(&mut self, dx_px: f32, dy_px: f32)` — `azimuth += dx_px * SENS`, `elevation = clamp(elevation + dy_px * SENS, -π/2 + ε, π/2 - ε)`. `SENS` is a fixed 0.005 rad/px (eyeballed feel — adjust at integration time if needed).
- `view_projection(&self) -> [f32; 16]` — column-major mat4 = perspective × view, where view is `lookAt(eye, target, up)` with `eye = target + spherical(azimuth, elevation, distance)`.
- `resize(w, h)` — updates `viewport_px` and `aspect`.

Elevation clamp avoids gimbal flip at the poles; the camera always sees an
upright tetrahedron.

#### `instanced_points_3d.rs`

Direct 3D analog of `InstancedPoints`. Per-instance attributes:

- `position: vec3`
- `color: vec4`
- `radius_px: f32`

Uniform: `mat4 view_projection`. Vertex shader projects center to clip
space, expands a quad in screen space by `radius_px`. Fragment shader
reuses the same screen-space SDF circle — antialiased disc with optional
alpha falloff. Identical pixel result to the 2D version when projected
into the camera's near plane.

#### `line_batch_3d.rs`

Direct 3D analog of `LineBatch`. Per-vertex `(position: vec3, color: vec4)`,
uniform `mat4 view_projection`. Used for the tetrahedron's 6 edges and the
per-iteration guide line.

### Visualization — `crates/viz-core/src/visualizations/sierpinski_pyramid.rs`

Replaces `sierpinski_triangle.rs`. Owns:

```
struct SierpinskiPyramid {
    camera: Camera3D,
    auto_azimuth: f32,        // accumulator from tick()
    azimuth_offset: f32,      // drag-applied delta
    elevation: f32,           // drag-applied; survives across frames
    is_dragging: bool,
    zoom: f32,                // multiplier from set_zoom; divides camera distance
    points: Option<InstancedPoints3D>,
    lines: Option<LineBatch3D>,
}
```

#### Config

```
struct SierpinskiPyramidVizConfig {
    background: [f32; 4],
    edge_color: [f32; 4],

    // One color per corner. Used both for that corner's anchor dot and as
    // the tint applied to trail dots that landed halfway toward it.
    corner_colors: [[f32; 4]; 4],
    corner_highlight_color: [f32; 4],     // applied to the picked corner during substep
    corner_size_px: f32,

    // 0.0 = trail dots are monochrome (trail_color);
    // 1.0 = trail dots are pure corner_colors[k].
    trail_color: [f32; 4],
    trail_tint: f32,
    trail_size_px: f32,

    current_color: [f32; 4],
    current_size_px: f32,

    guide_color: [f32; 4],
    burn_in_iterations: u32,

    // Radians/sec. 0 stops the auto-spin; default 0.25 → ~25s per revolution.
    auto_rotate_speed: f32,
    padding: f32,
}
```

Default `corner_colors`: cyan `(0.30, 0.85, 0.95)`, magenta `(0.95, 0.45, 0.85)`,
amber `(0.98, 0.78, 0.30)`, lime `(0.55, 0.90, 0.45)` — four perceptually
distinct hues at similar luminance so no corner visually dominates.

Default `trail_tint`: 0.65 (clearly corner-coded but not garish).

#### Lifecycle

- `init(gl, cfg)`: allocate `InstancedPoints3D` and `LineBatch3D`.
- `tick(dt)`: `auto_azimuth += cfg.auto_rotate_speed * dt`. Always — drag
  doesn't pause the auto-spin; it adds an offset.
- `handle_input(ev)`:
  - `PointerDown` → `is_dragging = true`.
  - `PointerMove` with primary button held → bump `azimuth_offset` by
    `dx * SENS`, `elevation` by `dy * SENS`, clamp elevation.
  - `PointerUp` / `PointerCancel` → `is_dragging = false`.
  - Wheel ignored (existing canvas-corner zoom buttons handle zoom).
- `set_zoom(z)`: clamp to `[0.25, 20.0]` (same range as the 2D version).
- `resize(gl, w, h)`: forwards to camera + sets WebGL viewport.
- `render(gl, state, cfg)`:
  1. Compute camera distance = `base_distance / zoom`; set
     `camera.azimuth = auto_azimuth + azimuth_offset`,
     `camera.elevation = elevation`.
  2. `gl.clearColor(...)`, enable `DEPTH_TEST`, `gl.clear(COLOR | DEPTH)`.
  3. Build the line vertex list: 6 tetrahedron edges (`edge_color`), plus
     the guide line from the last trail point to `CORNERS[chosen_corner]`
     (`guide_color`) when present.
  4. Build the point instance list:
     - Trail dots (post-burn-in): `radius = trail_size_px * 0.5`,
       `color = mix(trail_color, corner_colors[corner_for_dot[i]], trail_tint)`.
     - 4 corner dots: `radius = corner_size_px * 0.5`,
       `color = corner_colors[i]` (or `corner_highlight_color` when
       `chosen_corner == Some(i)`).
     - `current_position` dot (if set): `radius = current_size_px * 0.5`,
       `color = current_color`.
  5. `lines.upload + draw`, `points.upload + draw`.

#### Camera defaults

- `fov_y = π/4` (45°), `aspect = w/h`
- `base_distance = 2.5` (circumscribed sphere radius ≈ 0.612; at FOV 45°
  this puts the tetrahedron comfortably in frame with room for the
  guide line and the highlighted corner to breathe)
- Initial `azimuth = π/6` (30°), `elevation = -0.35` (~20° tilt down so
  the apex sits a touch above center and three faces are visible)
- `target = [0, 0, 0]`

### Engine — `crates/viz-core/src/engine/mod.rs`

- Replace `use crate::visualizations::sierpinski_triangle::{...}` with
  `use crate::visualizations::sierpinski_pyramid::{SierpinskiPyramid, SierpinskiPyramidVizConfig};`.
- Default rule and viz instantiation use the new types.
- `viz_cfg = SierpinskiPyramidVizConfig::defaults()`.
- All other Engine methods (`forward_input`, `set_zoom`, `dispatch`, etc.)
  are unchanged.

### Web UI — `web/src/App.svelte`

- Add canvas pointer listeners that forward to the engine:
  - `pointerdown` → `engine.forward_input({ kind: 'PointerDown', x, y, button })`.
  - `pointermove` → `engine.forward_input({ kind: 'PointerMove', x, y, dx, dy, buttons })`. Compute `dx/dy` from the previous pointermove (or 0 on first move after down).
  - `pointerup` / `pointercancel` / `pointerleave` → `engine.forward_input({ kind: 'PointerUp', x, y, button })`.
  - Use `setPointerCapture` on pointerdown so drags don't drop when the
    pointer briefly leaves the canvas.
- Add `touch-action: none` to the canvas CSS so single-finger touch drags
  rotate instead of scrolling the page on mobile.
- Update the info-panel description: explain the 4-corner chaos game,
  the rotation, drag-to-orbit, and that each dot is colored by the corner
  it moved toward.

## Data flow

```
User drags canvas
    │
    ▼
pointermove (JS) ── engine.forward_input ──► Engine::forward_input
                                                  │
                                                  ▼
                                             viz.handle_input
                                                  │
                                                  ▼
                                  azimuth_offset += dx * SENS,
                                  elevation     += dy * SENS

Every frame:
    JS rAF ── engine.frame(now_ms) ──► Engine::frame
                                          │
                                          ├─► advance_time(playback, dt)
                                          ├─► rule.advance_to (if iter changed)
                                          ├─► rule.substep
                                          ├─► viz.tick(dt)  ── auto_azimuth += dt * speed
                                          └─► viz.render
                                                  │
                                                  ▼
                                       camera.view_projection()
                                       lines.draw, points.draw
```

## Error handling

- Depth buffer: WebGL2 contexts ship with a depth buffer by default; if
  `gl.getContextAttributes().depth === false`, log a one-time
  `console.warn` and continue (rendering still works, just without
  occlusion).
- Bad pointer events: `forward_input` already wraps a `Result<(), JsValue>`;
  serde errors surface as console warnings as today.
- Drag clamps elevation to `(-π/2 + 0.01, π/2 - 0.01)`.
- Zoom clamps to `[0.25, 20.0]` exactly as the 2D version.
- Camera `aspect` is set to `1.0` (not 0) when `viewport_px` would
  otherwise be 0, to avoid divide-by-zero before the first `resize`.

## Testing

### Rust unit tests (`crates/viz-core/src/rules/sierpinski_chaos.rs`)

- `pick_corner_distribution_is_roughly_uniform` — now over 4 buckets.
- `initial_position_is_inside_tetrahedron` — barycentric inside-check in 3D.
- `advance_to_is_deterministic` — same shape, 3D trail.
- `advance_to_is_jump_safe` — same shape.
- `trail_length_matches_iterations_and_clamps` — same.
- `substep_highlights_corner_then_moves_dot` — 3D distance check.
- `halfway_is_the_midpoint` — 3D.
- `corner_for_dot_matches_pick_corner` — new: assert the recorded corner
  index matches `pick_corner(seed, i)` for every entry in the trail after
  `advance_to`.

### Camera3D unit tests (`crates/viz-core/src/render/camera_3d.rs`)

- `view_projection_is_deterministic` — same inputs → same matrix bits.
- `elevation_is_clamped_at_poles` — large positive/negative drag deltas
  saturate.
- `orbit_drag_is_linear_in_pixels` — `orbit_drag(dx, 0)` then
  `orbit_drag(dx, 0)` equals one `orbit_drag(2*dx, 0)` in azimuth.
- `auto_advance_adds_proportional_to_dt` — `auto_advance(dt, s)` once
  matches two `auto_advance(dt/2, s)` calls.

### Visualization tests (`crates/viz-core/src/visualizations/sierpinski_pyramid.rs`)

- `defaults_round_trip` — every default round-trips through serde.
- `schema_lists_all_required_fields` — count + names match the struct.

### Browser smoke test (`crates/viz-core/tests/wasm.rs`)

- `engine_boots_with_3d_defaults` — `Engine::new("canvas")` succeeds,
  `snapshot()` returns sane shape, `rule_schema` exposes `max_iterations`,
  `viz_schema` exposes `corner_colors` and `auto_rotate_speed`.
- `set_zoom_then_forward_input_round_trip` — call `set_zoom(1.5)`,
  forward a `PointerDown` + `PointerMove` + `PointerUp`, no errors.

### Web tests (`web/src/lib/components/__tests__/`)

- Existing playback-bar tests stay green (no Svelte API surface change).

## Acceptance checklist

- [ ] `cargo test --workspace` passes.
- [ ] `wasm-pack test --chrome --headless crates/viz-core` passes.
- [ ] `cd web && npm run check` shows 0 errors.
- [ ] `cd web && npm run test` passes.
- [ ] `cd web && npm run build` produces a static SPA.
- [ ] In the dev server: the tetrahedron renders, auto-rotates, and
      fills in with corner-tinted dots.
- [ ] Click-drag on the canvas orbits the camera; release stops the drag.
- [ ] Zoom buttons in the canvas's upper-left still work.
- [ ] Info panel describes the 3D chaos game.
- [ ] Touch-drag on mobile rotates the camera (no page scroll).

## Migration notes

- The 2D `sierpinski_triangle.rs` file and its types are deleted in this
  change. The 2D Sierpinski rule and viz are not preserved as fallbacks —
  the 2D triangle is fully superseded by the 3D tetrahedron. The
  midpoint-on-circle and color-cycle rules remain in the codebase as
  alternative 2D options (they'll surface in Phase 4's selector UI).
- The rule type is *renamed in concept only* — the file remains
  `sierpinski_chaos.rs`, the type remains `SierpinskiChaos`. Only the
  dimensionality changes. This keeps the engine wiring minimal.
- The visualization is renamed: the file moves from
  `sierpinski_triangle.rs` to `sierpinski_pyramid.rs` and the type from
  `SierpinskiTriangle` to `SierpinskiPyramid`. The engine and tests update
  their imports accordingly.
