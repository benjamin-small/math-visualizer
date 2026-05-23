# Phase 3: Midpoint-on-Circle Visualization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Phase 2 demo (ColorCycleRule + ColorCycleViz) with the real midpoint-on-circle visualization: a circle, a deterministic seeded rule that picks two reference points per iteration, and a renderer that draws all the permanent midpoints plus the in-flight reference dots and connecting line.

**Architecture:** Introduce a `render/` module with reusable WebGL2 helpers (ShaderProgram, Camera2D, InstancedPoints, SdfCircle, LineBatch). Build `MidpointOnCircle` as a deterministic, cheap-recompute rule with a seeded RNG. Build `DotsOnCircle` as a Visualization that composes the render helpers. Swap the Engine's hardwired defaults from ColorCycle to Midpoint/DotsOnCircle. ColorCycle stays in the codebase as a working second-rule example for Phase 4's selector UI.

**Tech Stack:** Same as Phase 2 — Rust (`viz-core`), `wasm-bindgen`, `web-sys::WebGl2RenderingContext`, `serde`. No new dependencies.

**Spec reference:** [docs/superpowers/specs/2026-05-23-math-visualizer-foundation-design.md](../specs/2026-05-23-math-visualizer-foundation-design.md), §4.5 (render utilities), §7 (midpoint rule + DotsOnCircle viz).

**Not in this phase:** OrbitCamera3D, MeshRenderer, the ConfigSchema derive macro, the Phase 4 widget panel, rule/viz selector UI, persistence, seed widget. Each is the focus of a later phase. The Engine still hardwires the rule+viz at construction; a registry lands when the selector UI does.

---

## File map

Creating:

```
crates/viz-core/src/
├── render/
│   ├── mod.rs                       # Re-exports + GlContext alias
│   ├── shader.rs                    # ShaderProgram (compile/link/uniform helpers)
│   ├── camera_2d.rs                 # Camera2D (ortho proj, fit-to-content)
│   ├── instanced_points.rs          # Per-instance position+color+size, antialiased disc
│   ├── sdf_circle.rs                # Single-quad SDF-stroked circle
│   └── line_batch.rs                # Buffer of line segments
├── rules/
│   └── midpoint_on_circle.rs        # MidpointOnCircle rule + state + config + RNG
└── visualizations/
    └── dots_on_circle.rs            # DotsOnCircle viz composing the render utils

crates/viz-core/tests/
└── wasm.rs                          # (extended) tests for the new default rule/viz
```

Modifying:

```
crates/viz-core/src/lib.rs           # add `pub mod render;`
crates/viz-core/src/rules/mod.rs     # add `pub mod midpoint_on_circle;`
crates/viz-core/src/visualizations/mod.rs # add `pub mod dots_on_circle;`
crates/viz-core/src/engine/mod.rs    # swap defaults from ColorCycle to MidpointOnCircle/DotsOnCircle
README.md                            # status + project layout
```

After Phase 3:
- The canvas shows a circle. Pressing play makes reference dots appear and fade, with a growing scatter of midpoint dots accumulating across iterations. Stepping shows each iteration's construction frame-by-frame.
- ColorCycle modules remain in the codebase as a second rule/viz example (used by Phase 4's selector); the demo is no longer the default.

---

## Conventions for this phase

**Coordinate system:** All rule math is in unit-circle space (centered at origin, radius 1). The visualization's `Camera2D` projects this to clip-space.

**Seed:** Lives only in `playback.seed` (engine-owned). `MidpointConfig` does NOT have a seed field. The Phase 4 panel will introduce a seed widget that calls `Command::SetSeed`, not `update_rule_config`.

**Substep ranges** (per design §7.1):
- `sub ∈ [0.00, 0.33)` → `ref_perimeter = Some(p)`, `ref_interior = None`, `preview_midpoint = None`.
- `sub ∈ [0.33, 0.66)` → both `ref_*` set, `preview_midpoint = None` (viz draws the connecting line in this range).
- `sub ∈ [0.66, 1.00]` → both `ref_*` set, `preview_midpoint = Some(mid)` (viz draws an extra dot at the midpoint).

At iteration rollover (advance_to(n+1)), `advance_to` rebuilds permanent up to the new n and clears `ref_*` + `preview_midpoint` to `None`.

**Per-iteration RNG:** `splitmix64(seed ^ (n as u64))` — order-independent (jumping to any n produces the same dots).

---

## Task 1: ShaderProgram wrapper

**Files:**
- Create: `crates/viz-core/src/render/mod.rs`
- Create: `crates/viz-core/src/render/shader.rs`
- Modify: `crates/viz-core/src/lib.rs`

- [ ] **Step 1: Create the render module root**

Create `crates/viz-core/src/render/mod.rs`:

```rust
//! Reusable WebGL2 rendering helpers. Visualizations compose these to draw
//! shapes; the engine doesn't touch this module directly.

pub mod camera_2d;
pub mod instanced_points;
pub mod line_batch;
pub mod sdf_circle;
pub mod shader;

pub use camera_2d::Camera2D;
pub use instanced_points::{InstancedPoints, PointInstance};
pub use line_batch::{LineBatch, LineVertex};
pub use sdf_circle::SdfCircle;
pub use shader::ShaderProgram;
```

(All five sub-modules referenced here will be created in Tasks 1-5. Each task's `pub mod` declaration above is already present; the implementations land per task.)

- [ ] **Step 2: Write the shader module**

Create `crates/viz-core/src/render/shader.rs`:

```rust
//! Thin wrapper over WebGL2 shader compile + program link.
//!
//! Errors are returned as String so callers can surface them via JsValue.

use web_sys::{WebGl2RenderingContext as Gl, WebGlProgram, WebGlShader, WebGlUniformLocation};

pub struct ShaderProgram {
    program: WebGlProgram,
}

impl ShaderProgram {
    /// Compile vertex + fragment shaders and link a program.
    pub fn new(gl: &Gl, vertex_src: &str, fragment_src: &str) -> Result<Self, String> {
        let vs = compile(gl, Gl::VERTEX_SHADER, vertex_src)?;
        let fs = compile(gl, Gl::FRAGMENT_SHADER, fragment_src)?;
        let program = gl.create_program().ok_or("create_program returned None")?;
        gl.attach_shader(&program, &vs);
        gl.attach_shader(&program, &fs);
        gl.link_program(&program);

        let linked = gl
            .get_program_parameter(&program, Gl::LINK_STATUS)
            .as_bool()
            .unwrap_or(false);

        // Shaders can be detached + deleted once linked; the program owns the bytecode.
        gl.delete_shader(Some(&vs));
        gl.delete_shader(Some(&fs));

        if !linked {
            let log = gl.get_program_info_log(&program).unwrap_or_default();
            gl.delete_program(Some(&program));
            return Err(format!("link failed: {log}"));
        }

        Ok(Self { program })
    }

    pub fn use_program(&self, gl: &Gl) {
        gl.use_program(Some(&self.program));
    }

    pub fn attribute_location(&self, gl: &Gl, name: &str) -> i32 {
        gl.get_attrib_location(&self.program, name)
    }

    pub fn uniform_location(&self, gl: &Gl, name: &str) -> Option<WebGlUniformLocation> {
        gl.get_uniform_location(&self.program, name)
    }

    pub fn raw(&self) -> &WebGlProgram {
        &self.program
    }
}

fn compile(gl: &Gl, kind: u32, src: &str) -> Result<WebGlShader, String> {
    let shader = gl.create_shader(kind).ok_or("create_shader returned None")?;
    gl.shader_source(&shader, src);
    gl.compile_shader(&shader);

    let ok = gl
        .get_shader_parameter(&shader, Gl::COMPILE_STATUS)
        .as_bool()
        .unwrap_or(false);
    if ok {
        Ok(shader)
    } else {
        let log = gl.get_shader_info_log(&shader).unwrap_or_default();
        gl.delete_shader(Some(&shader));
        Err(format!("compile failed: {log}"))
    }
}

// No #[cfg(test)] block: ShaderProgram requires a real WebGL context, so it's
// exercised by the wasm-bindgen-tests in `crates/viz-core/tests/wasm.rs`
// (Task 9).
```

- [ ] **Step 3: Add web-sys feature flags**

The shader module uses `WebGlProgram`, `WebGlShader`, and `WebGlUniformLocation`. Modify `crates/viz-core/Cargo.toml`'s `[dependencies.web-sys]` features list. Open the file, find the existing block, and ensure it includes (add the three missing):

```toml
[dependencies.web-sys]
version = "0.3"
features = [
    "Window",
    "Document",
    "HtmlCanvasElement",
    "WebGl2RenderingContext",
    "WebGlProgram",
    "WebGlShader",
    "WebGlUniformLocation",
    "WebGlBuffer",
    "WebGlVertexArrayObject",
    "console",
]
```

(The first 5 features were already there. `WebGlProgram`, `WebGlShader`, and `WebGlUniformLocation` are needed by shader.rs. `WebGlBuffer` and `WebGlVertexArrayObject` are needed by Tasks 3-5; adding them now keeps the Cargo.toml change atomic with the render module introduction.)

- [ ] **Step 4: Wire `render` into lib.rs**

Modify `crates/viz-core/src/lib.rs` to add `pub mod render;` alphabetically:

```rust
use wasm_bindgen::prelude::*;

pub mod config;
pub mod engine;
pub mod render;
pub mod rules;
pub mod traits;
pub mod visualizations;

pub use engine::Engine;

#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}
```

- [ ] **Step 5: Verify it compiles**

```bash
export PATH="$HOME/.cargo/bin:$PATH"
cargo build --workspace
```

Expected: clean build. Note: the four sibling modules referenced in `render/mod.rs` (camera_2d, instanced_points, line_batch, sdf_circle) DO NOT EXIST YET. Tasks 2-5 create them. For Task 1, comment out the four `pub mod` lines and `pub use` lines in `render/mod.rs` that point to those modules — uncomment them as each subsequent task creates the file. After Task 5, render/mod.rs will have the full content shown above.

Concretely, for Task 1's commit, `render/mod.rs` should be:

```rust
//! Reusable WebGL2 rendering helpers. Visualizations compose these to draw
//! shapes; the engine doesn't touch this module directly.

pub mod shader;

pub use shader::ShaderProgram;
```

```bash
cargo test --workspace
```

Expected: 28 tests pass (unchanged — no new tests in this task).

- [ ] **Step 6: Build wasm**

```bash
wasm-pack build crates/viz-core --target web --out-dir pkg
```

Expected: clean build.

- [ ] **Step 7: Commit**

```bash
git add crates/viz-core/Cargo.toml crates/viz-core/Cargo.lock crates/viz-core/src/render/ crates/viz-core/src/lib.rs
git commit -m "feat(render): add ShaderProgram wrapper and render module skeleton"
```

(`Cargo.lock` likely unchanged — no new deps — but stage it just in case.)

---

## Task 2: Camera2D

**Files:**
- Create: `crates/viz-core/src/render/camera_2d.rs`
- Modify: `crates/viz-core/src/render/mod.rs` (add the `pub mod camera_2d;` line)

- [ ] **Step 1: Write the module**

Create `crates/viz-core/src/render/camera_2d.rs`:

```rust
//! Orthographic 2D camera. Owns a target world-space rect and a viewport in
//! pixels. Produces a clip-space projection matrix (column-major 3×3 for 2D
//! homogeneous coords, exported as a 9-element f32 array for shader upload).

#[derive(Debug, Clone, Copy)]
pub struct Camera2D {
    /// World-space center of the visible region.
    pub center: [f32; 2],
    /// Half-width of the visible region in world units. Half-height is derived
    /// from this + viewport aspect ratio so units stay square.
    pub half_width: f32,
    /// Viewport size in pixels (backing-store, DPR-scaled). Used to compute
    /// the aspect ratio.
    pub viewport_px: [u32; 2],
}

impl Camera2D {
    pub fn new() -> Self {
        Self {
            center: [0.0, 0.0],
            half_width: 1.0,
            viewport_px: [1, 1],
        }
    }

    pub fn resize(&mut self, width: u32, height: u32) {
        self.viewport_px = [width.max(1), height.max(1)];
    }

    /// Adjust center + half_width so the given world-space bounding box fits
    /// inside the viewport with `padding` world units on every side.
    pub fn fit_to_bbox(&mut self, min: [f32; 2], max: [f32; 2], padding: f32) {
        let cx = (min[0] + max[0]) * 0.5;
        let cy = (min[1] + max[1]) * 0.5;
        let half_w = (max[0] - min[0]) * 0.5 + padding;
        let half_h = (max[1] - min[1]) * 0.5 + padding;
        let aspect = self.viewport_px[0].max(1) as f32 / self.viewport_px[1].max(1) as f32;
        // The visible region must contain both half_w and half_h. Pick the
        // tighter constraint after accounting for aspect.
        let chosen = if half_w / aspect >= half_h { half_w } else { half_h * aspect };
        self.center = [cx, cy];
        self.half_width = chosen.max(1e-6);
    }

    /// Column-major 3×3 ortho matrix mapping world coords → clip space.
    /// Clip space is [-1, +1] on both axes; OpenGL Y is up.
    pub fn projection(&self) -> [f32; 9] {
        let aspect = self.viewport_px[0].max(1) as f32 / self.viewport_px[1].max(1) as f32;
        let half_h = self.half_width / aspect;
        let sx = 1.0 / self.half_width;
        let sy = 1.0 / half_h;
        let tx = -self.center[0] * sx;
        let ty = -self.center[1] * sy;
        // Column-major:
        // | sx  0   tx |
        // | 0   sy  ty |
        // | 0   0   1  |
        [
            sx,  0.0, 0.0,
            0.0, sy,  0.0,
            tx,  ty,  1.0,
        ]
    }
}

impl Default for Camera2D {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: f32, b: f32) -> bool {
        (a - b).abs() < 1e-5
    }

    #[test]
    fn projection_identity_when_square_viewport_unit_half_width() {
        let mut cam = Camera2D::new();
        cam.resize(100, 100);
        let m = cam.projection();
        // sx and sy should be 1.0 (world coords already in clip space).
        assert!(approx(m[0], 1.0));
        assert!(approx(m[4], 1.0));
        // Translation should be 0.
        assert!(approx(m[6], 0.0));
        assert!(approx(m[7], 0.0));
    }

    #[test]
    fn fit_to_bbox_centers_and_zooms() {
        let mut cam = Camera2D::new();
        cam.resize(100, 100);
        cam.fit_to_bbox([-1.0, -1.0], [1.0, 1.0], 0.1);
        assert!(approx(cam.center[0], 0.0));
        assert!(approx(cam.center[1], 0.0));
        // Square viewport: half_width should be 1.0 + 0.1 padding.
        assert!(approx(cam.half_width, 1.1));
    }

    #[test]
    fn fit_to_bbox_picks_tighter_axis_in_wide_viewport() {
        let mut cam = Camera2D::new();
        // Wide viewport: 200x100, aspect = 2.0.
        cam.resize(200, 100);
        // Unit-square bbox. half_w = 1.0, half_h = 1.0, aspect = 2.
        // chosen = if half_w/aspect >= half_h: 1/2 >= 1? no, so chosen = half_h * aspect = 1*2 = 2.
        cam.fit_to_bbox([-1.0, -1.0], [1.0, 1.0], 0.0);
        assert!(approx(cam.half_width, 2.0));
    }

    #[test]
    fn fit_to_bbox_clamps_to_nonzero() {
        let mut cam = Camera2D::new();
        cam.resize(100, 100);
        cam.fit_to_bbox([0.0, 0.0], [0.0, 0.0], 0.0);
        assert!(cam.half_width > 0.0, "half_width never falls to literal zero");
    }

    #[test]
    fn projection_translates_with_center() {
        let mut cam = Camera2D::new();
        cam.resize(100, 100);
        cam.center = [3.0, -2.0];
        cam.half_width = 1.0;
        let m = cam.projection();
        // tx = -cx * sx = -3 * 1 = -3
        assert!(approx(m[6], -3.0));
        assert!(approx(m[7], 2.0));
    }
}
```

- [ ] **Step 2: Update render/mod.rs to expose Camera2D**

Replace `crates/viz-core/src/render/mod.rs` with:

```rust
//! Reusable WebGL2 rendering helpers. Visualizations compose these to draw
//! shapes; the engine doesn't touch this module directly.

pub mod camera_2d;
pub mod shader;

pub use camera_2d::Camera2D;
pub use shader::ShaderProgram;
```

- [ ] **Step 3: Run tests**

```bash
export PATH="$HOME/.cargo/bin:$PATH"
cargo test --workspace
```

Expected: 33 passing (28 prior + 5 new `camera_2d::tests::*`).

- [ ] **Step 4: Commit**

```bash
git add crates/viz-core/src/render/
git commit -m "feat(render): add Camera2D with fit-to-bbox + projection matrix"
```

---

## Task 3: InstancedPoints renderer

**Files:**
- Create: `crates/viz-core/src/render/instanced_points.rs`
- Modify: `crates/viz-core/src/render/mod.rs`

- [ ] **Step 1: Write the module**

Create `crates/viz-core/src/render/instanced_points.rs`:

```rust
//! Renders many circular dots in a single draw call. Each instance has a
//! world-space position, an RGBA color, and a pixel-space radius. The shape
//! is an antialiased disc computed in the fragment shader from gl_PointCoord
//! equivalent (we use a quad, not GL_POINTS, since GL_POINTS has size limits
//! on many platforms).

use web_sys::{WebGl2RenderingContext as Gl, WebGlBuffer, WebGlVertexArrayObject};

use super::shader::ShaderProgram;

/// Per-instance data. Layout in the GPU buffer is tightly packed:
/// [pos.x, pos.y, color.r, color.g, color.b, color.a, radius_px]
#[derive(Debug, Clone, Copy)]
pub struct PointInstance {
    pub position: [f32; 2],
    pub color: [f32; 4],
    pub radius_px: f32,
}

const FLOATS_PER_INSTANCE: usize = 7;

const VERTEX_SRC: &str = r#"#version 300 es
precision mediump float;

// Unit quad vertices (per-vertex, shared across instances).
layout(location=0) in vec2 a_corner;

// Per-instance attributes.
layout(location=1) in vec2 a_position;
layout(location=2) in vec4 a_color;
layout(location=3) in float a_radius_px;

uniform mat3 u_proj;
uniform vec2 u_viewport_px;  // for converting pixel radius to clip space

out vec2 v_corner;
out vec4 v_color;

void main() {
    v_corner = a_corner;
    v_color = a_color;

    // Project the instance position to clip space, then offset by the
    // (pixel-sized) corner expressed in clip units.
    vec3 clip = u_proj * vec3(a_position, 1.0);
    vec2 radius_clip = vec2(a_radius_px) * 2.0 / u_viewport_px;
    gl_Position = vec4(clip.xy + a_corner * radius_clip, 0.0, 1.0);
}
"#;

const FRAGMENT_SRC: &str = r#"#version 300 es
precision mediump float;

in vec2 v_corner;   // in [-1, 1] over the quad
in vec4 v_color;

out vec4 frag_color;

void main() {
    float dist = length(v_corner);
    // Antialiased disc: hard edge at dist=1 with one-pixel-ish smooth band.
    float alpha = smoothstep(1.0, 0.9, dist);
    if (alpha <= 0.0) discard;
    frag_color = vec4(v_color.rgb, v_color.a * alpha);
}
"#;

pub struct InstancedPoints {
    program: ShaderProgram,
    vao: WebGlVertexArrayObject,
    instance_buffer: WebGlBuffer,
    instance_count: usize,
    u_proj_loc: Option<web_sys::WebGlUniformLocation>,
    u_viewport_loc: Option<web_sys::WebGlUniformLocation>,
}

impl InstancedPoints {
    pub fn new(gl: &Gl) -> Result<Self, String> {
        let program = ShaderProgram::new(gl, VERTEX_SRC, FRAGMENT_SRC)?;

        // Static quad buffer: two triangles.
        let quad: [f32; 8] = [-1.0, -1.0, 1.0, -1.0, -1.0, 1.0, 1.0, 1.0];
        let quad_buf = gl.create_buffer().ok_or("create_buffer (quad)")?;
        gl.bind_buffer(Gl::ARRAY_BUFFER, Some(&quad_buf));
        unsafe {
            let view = js_sys::Float32Array::view(&quad);
            gl.buffer_data_with_array_buffer_view(Gl::ARRAY_BUFFER, &view, Gl::STATIC_DRAW);
        }

        let instance_buffer = gl.create_buffer().ok_or("create_buffer (instances)")?;

        let vao = gl.create_vertex_array().ok_or("create_vertex_array")?;
        gl.bind_vertex_array(Some(&vao));

        // Bind the static quad as attribute 0 (a_corner).
        gl.bind_buffer(Gl::ARRAY_BUFFER, Some(&quad_buf));
        gl.enable_vertex_attrib_array(0);
        gl.vertex_attrib_pointer_with_i32(0, 2, Gl::FLOAT, false, 0, 0);

        // Bind the instance buffer as attributes 1..=3.
        gl.bind_buffer(Gl::ARRAY_BUFFER, Some(&instance_buffer));
        let stride = (FLOATS_PER_INSTANCE * 4) as i32;
        // a_position (vec2)
        gl.enable_vertex_attrib_array(1);
        gl.vertex_attrib_pointer_with_i32(1, 2, Gl::FLOAT, false, stride, 0);
        gl.vertex_attrib_divisor(1, 1);
        // a_color (vec4)
        gl.enable_vertex_attrib_array(2);
        gl.vertex_attrib_pointer_with_i32(2, 4, Gl::FLOAT, false, stride, 2 * 4);
        gl.vertex_attrib_divisor(2, 1);
        // a_radius_px (float)
        gl.enable_vertex_attrib_array(3);
        gl.vertex_attrib_pointer_with_i32(3, 1, Gl::FLOAT, false, stride, 6 * 4);
        gl.vertex_attrib_divisor(3, 1);

        gl.bind_vertex_array(None);

        let u_proj_loc = program.uniform_location(gl, "u_proj");
        let u_viewport_loc = program.uniform_location(gl, "u_viewport_px");

        Ok(Self {
            program,
            vao,
            instance_buffer,
            instance_count: 0,
            u_proj_loc,
            u_viewport_loc,
        })
    }

    /// Upload a new instance set. Pass `&[]` to clear.
    pub fn upload(&mut self, gl: &Gl, instances: &[PointInstance]) {
        self.instance_count = instances.len();
        let mut packed = Vec::with_capacity(instances.len() * FLOATS_PER_INSTANCE);
        for inst in instances {
            packed.push(inst.position[0]);
            packed.push(inst.position[1]);
            packed.push(inst.color[0]);
            packed.push(inst.color[1]);
            packed.push(inst.color[2]);
            packed.push(inst.color[3]);
            packed.push(inst.radius_px);
        }
        gl.bind_buffer(Gl::ARRAY_BUFFER, Some(&self.instance_buffer));
        unsafe {
            let view = js_sys::Float32Array::view(&packed);
            gl.buffer_data_with_array_buffer_view(Gl::ARRAY_BUFFER, &view, Gl::DYNAMIC_DRAW);
        }
    }

    /// Draw the previously-uploaded instances using the given projection
    /// matrix and viewport size.
    pub fn draw(&self, gl: &Gl, projection: &[f32; 9], viewport_px: [u32; 2]) {
        if self.instance_count == 0 {
            return;
        }
        self.program.use_program(gl);
        gl.uniform_matrix3fv_with_f32_array(self.u_proj_loc.as_ref(), false, projection);
        gl.uniform2f(
            self.u_viewport_loc.as_ref(),
            viewport_px[0].max(1) as f32,
            viewport_px[1].max(1) as f32,
        );
        gl.bind_vertex_array(Some(&self.vao));
        gl.enable(Gl::BLEND);
        gl.blend_func(Gl::SRC_ALPHA, Gl::ONE_MINUS_SRC_ALPHA);
        gl.draw_arrays_instanced(Gl::TRIANGLE_STRIP, 0, 4, self.instance_count as i32);
        gl.bind_vertex_array(None);
    }
}
```

- [ ] **Step 2: Update render/mod.rs**

Replace `crates/viz-core/src/render/mod.rs` with:

```rust
//! Reusable WebGL2 rendering helpers. Visualizations compose these to draw
//! shapes; the engine doesn't touch this module directly.

pub mod camera_2d;
pub mod instanced_points;
pub mod shader;

pub use camera_2d::Camera2D;
pub use instanced_points::{InstancedPoints, PointInstance};
pub use shader::ShaderProgram;
```

- [ ] **Step 3: Verify it compiles**

```bash
export PATH="$HOME/.cargo/bin:$PATH"
cargo build --workspace
cargo test --workspace
```

Expected: clean build. 33 tests pass (no new native tests in this task — instanced rendering needs a real GL context, exercised by browser tests in Task 9).

```bash
wasm-pack build crates/viz-core --target web --out-dir pkg
```

Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add crates/viz-core/src/render/
git commit -m "feat(render): add InstancedPoints renderer (per-instance pos/color/radius)"
```

---

## Task 4: SDF circle renderer

**Files:**
- Create: `crates/viz-core/src/render/sdf_circle.rs`
- Modify: `crates/viz-core/src/render/mod.rs`

- [ ] **Step 1: Write the module**

Create `crates/viz-core/src/render/sdf_circle.rs`:

```rust
//! Antialiased stroked circle drawn as a single quad. The fragment shader
//! computes the signed distance from the unit circle and shades only the
//! stroke band.
//!
//! The quad is unit-sized in world space (covers [-1, 1] × [-1, 1]); the
//! viz translates/scales via the projection matrix.

use web_sys::{WebGl2RenderingContext as Gl, WebGlBuffer, WebGlVertexArrayObject};

use super::shader::ShaderProgram;

const VERTEX_SRC: &str = r#"#version 300 es
precision mediump float;

layout(location=0) in vec2 a_corner;  // unit quad in [-1, 1]^2

uniform mat3 u_proj;

out vec2 v_local;

void main() {
    v_local = a_corner;
    vec3 clip = u_proj * vec3(a_corner, 1.0);
    gl_Position = vec4(clip.xy, 0.0, 1.0);
}
"#;

const FRAGMENT_SRC: &str = r#"#version 300 es
precision mediump float;

in vec2 v_local;

uniform vec4 u_color;
uniform float u_stroke;        // half-width of the stroke band, in world units
uniform float u_pixel_width;   // approximate world-unit length of one pixel

out vec4 frag_color;

void main() {
    float d = abs(length(v_local) - 1.0);
    // Antialiased band: full opacity inside [0, stroke], smoothly drops to 0
    // over a one-pixel feather past stroke.
    float alpha = 1.0 - smoothstep(u_stroke, u_stroke + u_pixel_width, d);
    if (alpha <= 0.0) discard;
    frag_color = vec4(u_color.rgb, u_color.a * alpha);
}
"#;

pub struct SdfCircle {
    program: ShaderProgram,
    vao: WebGlVertexArrayObject,
    #[allow(dead_code)]
    quad_buffer: WebGlBuffer,  // kept alive so the VAO's binding stays valid
    u_proj: Option<web_sys::WebGlUniformLocation>,
    u_color: Option<web_sys::WebGlUniformLocation>,
    u_stroke: Option<web_sys::WebGlUniformLocation>,
    u_pixel_width: Option<web_sys::WebGlUniformLocation>,
}

impl SdfCircle {
    pub fn new(gl: &Gl) -> Result<Self, String> {
        let program = ShaderProgram::new(gl, VERTEX_SRC, FRAGMENT_SRC)?;

        let quad: [f32; 8] = [-1.0, -1.0, 1.0, -1.0, -1.0, 1.0, 1.0, 1.0];
        let quad_buffer = gl.create_buffer().ok_or("create_buffer")?;
        gl.bind_buffer(Gl::ARRAY_BUFFER, Some(&quad_buffer));
        unsafe {
            let view = js_sys::Float32Array::view(&quad);
            gl.buffer_data_with_array_buffer_view(Gl::ARRAY_BUFFER, &view, Gl::STATIC_DRAW);
        }

        let vao = gl.create_vertex_array().ok_or("create_vertex_array")?;
        gl.bind_vertex_array(Some(&vao));
        gl.bind_buffer(Gl::ARRAY_BUFFER, Some(&quad_buffer));
        gl.enable_vertex_attrib_array(0);
        gl.vertex_attrib_pointer_with_i32(0, 2, Gl::FLOAT, false, 0, 0);
        gl.bind_vertex_array(None);

        let u_proj = program.uniform_location(gl, "u_proj");
        let u_color = program.uniform_location(gl, "u_color");
        let u_stroke = program.uniform_location(gl, "u_stroke");
        let u_pixel_width = program.uniform_location(gl, "u_pixel_width");

        Ok(Self { program, vao, quad_buffer, u_proj, u_color, u_stroke, u_pixel_width })
    }

    /// Draw the circle with the given color, stroke half-width (world units),
    /// and projection. `world_units_per_pixel` is used to feather the edge by
    /// roughly one pixel — typically `cam.half_width * 2 / viewport_px[0]`.
    pub fn draw(
        &self,
        gl: &Gl,
        projection: &[f32; 9],
        color: [f32; 4],
        stroke_world: f32,
        world_units_per_pixel: f32,
    ) {
        self.program.use_program(gl);
        gl.uniform_matrix3fv_with_f32_array(self.u_proj.as_ref(), false, projection);
        gl.uniform4f(self.u_color.as_ref(), color[0], color[1], color[2], color[3]);
        gl.uniform1f(self.u_stroke.as_ref(), stroke_world.max(0.0));
        gl.uniform1f(self.u_pixel_width.as_ref(), world_units_per_pixel.max(1e-6));
        gl.bind_vertex_array(Some(&self.vao));
        gl.enable(Gl::BLEND);
        gl.blend_func(Gl::SRC_ALPHA, Gl::ONE_MINUS_SRC_ALPHA);
        gl.draw_arrays(Gl::TRIANGLE_STRIP, 0, 4);
        gl.bind_vertex_array(None);
    }
}
```

- [ ] **Step 2: Update render/mod.rs**

Replace `crates/viz-core/src/render/mod.rs` with:

```rust
//! Reusable WebGL2 rendering helpers. Visualizations compose these to draw
//! shapes; the engine doesn't touch this module directly.

pub mod camera_2d;
pub mod instanced_points;
pub mod sdf_circle;
pub mod shader;

pub use camera_2d::Camera2D;
pub use instanced_points::{InstancedPoints, PointInstance};
pub use sdf_circle::SdfCircle;
pub use shader::ShaderProgram;
```

- [ ] **Step 3: Verify compile + build**

```bash
export PATH="$HOME/.cargo/bin:$PATH"
cargo build --workspace
cargo test --workspace
wasm-pack build crates/viz-core --target web --out-dir pkg
```

Expected: all clean. 33 tests pass.

- [ ] **Step 4: Commit**

```bash
git add crates/viz-core/src/render/
git commit -m "feat(render): add SdfCircle (single-quad stroked circle with AA)"
```

---

## Task 5: LineBatch renderer

**Files:**
- Create: `crates/viz-core/src/render/line_batch.rs`
- Modify: `crates/viz-core/src/render/mod.rs`

- [ ] **Step 1: Write the module**

Create `crates/viz-core/src/render/line_batch.rs`:

```rust
//! Renders a batch of 1-pixel-wide line segments in a single draw call.
//! Each vertex carries a position + color so segments can be colored
//! independently.
//!
//! Note: WebGL2's gl.lineWidth is widely capped to 1 on desktop GPUs.
//! Thicker lines need triangle-based rendering, which is overkill for the
//! Phase 3 reference line between two dots — a 1px line reads fine
//! against a circle stroke.

use web_sys::{WebGl2RenderingContext as Gl, WebGlBuffer, WebGlVertexArrayObject};

use super::shader::ShaderProgram;

#[derive(Debug, Clone, Copy)]
pub struct LineVertex {
    pub position: [f32; 2],
    pub color: [f32; 4],
}

const FLOATS_PER_VERTEX: usize = 6;

const VERTEX_SRC: &str = r#"#version 300 es
precision mediump float;

layout(location=0) in vec2 a_position;
layout(location=1) in vec4 a_color;

uniform mat3 u_proj;

out vec4 v_color;

void main() {
    v_color = a_color;
    vec3 clip = u_proj * vec3(a_position, 1.0);
    gl_Position = vec4(clip.xy, 0.0, 1.0);
}
"#;

const FRAGMENT_SRC: &str = r#"#version 300 es
precision mediump float;
in vec4 v_color;
out vec4 frag_color;
void main() {
    frag_color = v_color;
}
"#;

pub struct LineBatch {
    program: ShaderProgram,
    vao: WebGlVertexArrayObject,
    buffer: WebGlBuffer,
    vertex_count: usize,
    u_proj: Option<web_sys::WebGlUniformLocation>,
}

impl LineBatch {
    pub fn new(gl: &Gl) -> Result<Self, String> {
        let program = ShaderProgram::new(gl, VERTEX_SRC, FRAGMENT_SRC)?;
        let buffer = gl.create_buffer().ok_or("create_buffer")?;

        let vao = gl.create_vertex_array().ok_or("create_vertex_array")?;
        gl.bind_vertex_array(Some(&vao));
        gl.bind_buffer(Gl::ARRAY_BUFFER, Some(&buffer));
        let stride = (FLOATS_PER_VERTEX * 4) as i32;
        gl.enable_vertex_attrib_array(0);
        gl.vertex_attrib_pointer_with_i32(0, 2, Gl::FLOAT, false, stride, 0);
        gl.enable_vertex_attrib_array(1);
        gl.vertex_attrib_pointer_with_i32(1, 4, Gl::FLOAT, false, stride, 2 * 4);
        gl.bind_vertex_array(None);

        let u_proj = program.uniform_location(gl, "u_proj");

        Ok(Self { program, vao, buffer, vertex_count: 0, u_proj })
    }

    /// Upload a flat sequence of vertices. Vertices come in pairs (one
    /// segment = two consecutive vertices). Pass `&[]` to clear.
    pub fn upload(&mut self, gl: &Gl, vertices: &[LineVertex]) {
        self.vertex_count = vertices.len();
        let mut packed = Vec::with_capacity(vertices.len() * FLOATS_PER_VERTEX);
        for v in vertices {
            packed.push(v.position[0]);
            packed.push(v.position[1]);
            packed.push(v.color[0]);
            packed.push(v.color[1]);
            packed.push(v.color[2]);
            packed.push(v.color[3]);
        }
        gl.bind_buffer(Gl::ARRAY_BUFFER, Some(&self.buffer));
        unsafe {
            let view = js_sys::Float32Array::view(&packed);
            gl.buffer_data_with_array_buffer_view(Gl::ARRAY_BUFFER, &view, Gl::DYNAMIC_DRAW);
        }
    }

    pub fn draw(&self, gl: &Gl, projection: &[f32; 9]) {
        if self.vertex_count == 0 {
            return;
        }
        self.program.use_program(gl);
        gl.uniform_matrix3fv_with_f32_array(self.u_proj.as_ref(), false, projection);
        gl.bind_vertex_array(Some(&self.vao));
        gl.enable(Gl::BLEND);
        gl.blend_func(Gl::SRC_ALPHA, Gl::ONE_MINUS_SRC_ALPHA);
        gl.draw_arrays(Gl::LINES, 0, self.vertex_count as i32);
        gl.bind_vertex_array(None);
    }
}
```

- [ ] **Step 2: Update render/mod.rs to the final shape**

Replace `crates/viz-core/src/render/mod.rs` with:

```rust
//! Reusable WebGL2 rendering helpers. Visualizations compose these to draw
//! shapes; the engine doesn't touch this module directly.

pub mod camera_2d;
pub mod instanced_points;
pub mod line_batch;
pub mod sdf_circle;
pub mod shader;

pub use camera_2d::Camera2D;
pub use instanced_points::{InstancedPoints, PointInstance};
pub use line_batch::{LineBatch, LineVertex};
pub use sdf_circle::SdfCircle;
pub use shader::ShaderProgram;
```

- [ ] **Step 3: Build + test**

```bash
export PATH="$HOME/.cargo/bin:$PATH"
cargo build --workspace
cargo test --workspace
wasm-pack build crates/viz-core --target web --out-dir pkg
```

Expected: 33 tests pass, clean build.

- [ ] **Step 4: Commit**

```bash
git add crates/viz-core/src/render/
git commit -m "feat(render): add LineBatch for colored line segments"
```

---

## Task 6: MidpointOnCircle rule

**Files:**
- Create: `crates/viz-core/src/rules/midpoint_on_circle.rs`
- Modify: `crates/viz-core/src/rules/mod.rs`

- [ ] **Step 1: Write the module**

Create `crates/viz-core/src/rules/midpoint_on_circle.rs`:

```rust
//! The flagship rule: random reference points on and inside a unit circle,
//! permanent midpoints accumulating across iterations. Deterministic given
//! (seed, iteration_index) via splitmix64 mixing.

use serde::{Deserialize, Serialize};

use crate::config::{number_property, ConfigSchema, NumberOpts};
use crate::traits::{Capabilities, Rule, SceneState};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MidpointConfig {
    pub max_iterations: u32,
}

impl Default for MidpointConfig {
    fn default() -> Self {
        // 100 iterations: enough to see the pattern emerge, fast enough that
        // play-through at default speed completes in a comfortable time.
        Self { max_iterations: 100 }
    }
}

impl ConfigSchema for MidpointConfig {
    fn schema() -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "max_iterations": number_property(NumberOpts {
                    label: "Iterations",
                    default: 100.0,
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
        serde_json::to_value(MidpointConfig::default()).unwrap()
    }
}

#[derive(Debug, Default)]
pub struct MidpointState {
    pub permanent: Vec<[f32; 2]>,
    pub ref_perimeter: Option<[f32; 2]>,
    pub ref_interior: Option<[f32; 2]>,
    pub preview_midpoint: Option<[f32; 2]>,
    pub current_iteration: u32,
}

impl SceneState for MidpointState {
    fn clear(&mut self) {
        self.permanent.clear();
        self.ref_perimeter = None;
        self.ref_interior = None;
        self.preview_midpoint = None;
        self.current_iteration = 0;
    }
}

pub struct MidpointOnCircle;

impl Rule for MidpointOnCircle {
    type Config = MidpointConfig;
    type State = MidpointState;

    fn id(&self) -> &'static str { "midpoint-on-circle" }
    fn capabilities(&self) -> Capabilities { Capabilities::cheap_scrubbable() }

    fn init(&self, _cfg: &Self::Config, _seed: u64) -> Self::State {
        MidpointState::default()
    }

    /// Rebuild `permanent` to reflect n full iterations completed. Reference
    /// dots are cleared (they're an animation artifact, set by `substep`).
    fn advance_to(
        &self,
        state: &mut Self::State,
        cfg: &Self::Config,
        seed: u64,
        n: u32,
    ) {
        state.permanent.clear();
        state.ref_perimeter = None;
        state.ref_interior = None;
        state.preview_midpoint = None;

        let target = n.min(cfg.max_iterations);
        for i in 0..target {
            let (perim, interior) = sample_iter(seed, i);
            state.permanent.push(midpoint(perim, interior));
        }
        state.current_iteration = target;
    }

    /// Animate iteration `n` in [0, 1] sub-progress.
    fn substep(
        &self,
        state: &mut Self::State,
        cfg: &Self::Config,
        seed: u64,
        n: u32,
        sub: f32,
    ) {
        if n >= cfg.max_iterations {
            // Past the end: no in-flight animation.
            state.ref_perimeter = None;
            state.ref_interior = None;
            state.preview_midpoint = None;
            return;
        }
        let (perim, interior) = sample_iter(seed, n);
        let sub = sub.clamp(0.0, 1.0);
        if sub < 0.33 {
            state.ref_perimeter = Some(perim);
            state.ref_interior = None;
            state.preview_midpoint = None;
        } else if sub < 0.66 {
            state.ref_perimeter = Some(perim);
            state.ref_interior = Some(interior);
            state.preview_midpoint = None;
        } else {
            state.ref_perimeter = Some(perim);
            state.ref_interior = Some(interior);
            state.preview_midpoint = Some(midpoint(perim, interior));
        }
    }
}

fn midpoint(a: [f32; 2], b: [f32; 2]) -> [f32; 2] {
    [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5]
}

/// SplitMix64 — fast, deterministic mixer. Used per-iteration so jumping to
/// any iteration produces the same dots without replaying history.
fn splitmix64(mut z: u64) -> u64 {
    z = z.wrapping_add(0x9E3779B97F4A7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D049BB133111EB);
    z ^ (z >> 31)
}

/// Two random f32s in [0, 1).
fn rand_f32_pair(state: u64) -> (f32, f32, u64) {
    let a = splitmix64(state);
    let b = splitmix64(a);
    let f1 = ((a >> 8) as u32 & 0x00FFFFFF) as f32 / (1 << 24) as f32;
    let f2 = ((b >> 8) as u32 & 0x00FFFFFF) as f32 / (1 << 24) as f32;
    (f1, f2, b)
}

/// Sample one iteration's reference perimeter point and interior point.
/// Perimeter: theta ~ U[0, 2π), point = (cos θ, sin θ).
/// Interior: rejection sample (x, y) ~ U[-1, 1]^2 until x²+y² < 1.
fn sample_iter(seed: u64, iter: u32) -> ([f32; 2], [f32; 2]) {
    let s = splitmix64(seed ^ (iter as u64));
    let (theta_unit, _, s) = rand_f32_pair(s);
    let theta = theta_unit * std::f32::consts::TAU;
    let perim = [theta.cos(), theta.sin()];

    let mut state = s;
    loop {
        let (u, v, next) = rand_f32_pair(state);
        state = next;
        let x = u * 2.0 - 1.0;
        let y = v * 2.0 - 1.0;
        if x * x + y * y < 1.0 {
            return (perim, [x, y]);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn perimeter_point_is_on_unit_circle() {
        for i in 0..50 {
            let (perim, _) = sample_iter(0, i);
            let r = (perim[0] * perim[0] + perim[1] * perim[1]).sqrt();
            assert!((r - 1.0).abs() < 1e-4, "iter {i}: perimeter r = {r}");
        }
    }

    #[test]
    fn interior_point_is_strictly_inside_unit_circle() {
        for i in 0..50 {
            let (_, interior) = sample_iter(42, i);
            let r2 = interior[0] * interior[0] + interior[1] * interior[1];
            assert!(r2 < 1.0, "iter {i}: interior r² = {r2}");
        }
    }

    #[test]
    fn advance_to_is_deterministic_given_seed() {
        let rule = MidpointOnCircle;
        let cfg = MidpointConfig::default();
        let mut a = rule.init(&cfg, 0);
        rule.advance_to(&mut a, &cfg, 17, 25);
        let mut b = rule.init(&cfg, 0);
        rule.advance_to(&mut b, &cfg, 17, 25);
        assert_eq!(a.permanent, b.permanent);
    }

    #[test]
    fn advance_to_is_jump_safe() {
        let rule = MidpointOnCircle;
        let cfg = MidpointConfig::default();
        // From 0, jump to 25 directly.
        let mut direct = rule.init(&cfg, 99);
        rule.advance_to(&mut direct, &cfg, 99, 25);
        // From 25, advance again to 25 — should be a no-op (idempotent).
        rule.advance_to(&mut direct, &cfg, 99, 25);
        assert_eq!(direct.permanent.len(), 25);
        // From 25, advance backward to 10 — should produce the same first
        // 10 points the first jump-to-25 path produced.
        let mut backward = rule.init(&cfg, 99);
        rule.advance_to(&mut backward, &cfg, 99, 10);
        assert_eq!(&direct.permanent[..10], &backward.permanent[..]);
    }

    #[test]
    fn advance_to_clamps_to_max_iterations() {
        let rule = MidpointOnCircle;
        let cfg = MidpointConfig { max_iterations: 10 };
        let mut state = rule.init(&cfg, 0);
        rule.advance_to(&mut state, &cfg, 0, 999);
        assert_eq!(state.permanent.len(), 10);
        assert_eq!(state.current_iteration, 10);
    }

    #[test]
    fn substep_phases() {
        let rule = MidpointOnCircle;
        let cfg = MidpointConfig::default();
        let mut state = rule.init(&cfg, 0);
        rule.advance_to(&mut state, &cfg, 7, 5);

        rule.substep(&mut state, &cfg, 7, 5, 0.10);
        assert!(state.ref_perimeter.is_some());
        assert!(state.ref_interior.is_none());
        assert!(state.preview_midpoint.is_none());

        rule.substep(&mut state, &cfg, 7, 5, 0.45);
        assert!(state.ref_perimeter.is_some());
        assert!(state.ref_interior.is_some());
        assert!(state.preview_midpoint.is_none());

        rule.substep(&mut state, &cfg, 7, 5, 0.80);
        assert!(state.ref_perimeter.is_some());
        assert!(state.ref_interior.is_some());
        assert!(state.preview_midpoint.is_some());
    }

    #[test]
    fn substep_at_or_past_max_clears_ref_dots() {
        let rule = MidpointOnCircle;
        let cfg = MidpointConfig { max_iterations: 5 };
        let mut state = rule.init(&cfg, 0);
        rule.advance_to(&mut state, &cfg, 0, 5);
        rule.substep(&mut state, &cfg, 0, 5, 0.5);
        assert!(state.ref_perimeter.is_none());
        assert!(state.ref_interior.is_none());
        assert!(state.preview_midpoint.is_none());
    }

    #[test]
    fn midpoint_is_the_average() {
        let m = midpoint([0.0, 0.0], [2.0, 4.0]);
        assert_eq!(m, [1.0, 2.0]);
    }

    #[test]
    fn splitmix64_is_deterministic() {
        assert_eq!(splitmix64(42), splitmix64(42));
        assert_ne!(splitmix64(42), splitmix64(43));
    }
}
```

- [ ] **Step 2: Wire into rules/mod.rs**

Replace `crates/viz-core/src/rules/mod.rs` with:

```rust
pub mod color_cycle;
pub mod midpoint_on_circle;
```

- [ ] **Step 3: Run tests**

```bash
export PATH="$HOME/.cargo/bin:$PATH"
cargo test --workspace
```

Expected: 42 passing (33 prior + 9 new in `rules::midpoint_on_circle::tests`).

- [ ] **Step 4: Commit**

```bash
git add crates/viz-core/src/rules/
git commit -m "feat(rules): add MidpointOnCircle with deterministic seeded sampling"
```

---

## Task 7: DotsOnCircle visualization

**Files:**
- Create: `crates/viz-core/src/visualizations/dots_on_circle.rs`
- Modify: `crates/viz-core/src/visualizations/mod.rs`

- [ ] **Step 1: Write the module**

Create `crates/viz-core/src/visualizations/dots_on_circle.rs`:

```rust
//! Visualization for MidpointOnCircle: a stroked circle, all permanent
//! midpoints, the two in-flight reference dots, an optional connecting line,
//! and an optional preview-midpoint dot during the substep merge phase.
//!
//! Composes render utilities: SdfCircle for the boundary, InstancedPoints
//! for all the dot types, LineBatch for the reference line. Camera2D fits
//! the unit circle to the viewport with padding.

use serde::{Deserialize, Serialize};
use web_sys::WebGl2RenderingContext;

use crate::config::{color_property, number_property, ConfigSchema, NumberOpts};
use crate::render::{Camera2D, InstancedPoints, LineBatch, LineVertex, PointInstance, SdfCircle};
use crate::rules::midpoint_on_circle::MidpointState;
use crate::traits::Visualization;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DotsOnCircleVizConfig {
    pub background: [f32; 4],
    pub circle_color: [f32; 4],
    pub circle_stroke_px: f32,
    pub perimeter_color: [f32; 4],
    pub interior_color: [f32; 4],
    pub midpoint_color: [f32; 4],
    pub preview_color: [f32; 4],
    pub line_color: [f32; 4],
    pub dot_size_px: f32,
    pub ref_dot_size_px: f32,
    pub padding: f32,  // world units of padding around the unit circle
}

impl Default for DotsOnCircleVizConfig {
    fn default() -> Self {
        Self {
            background: [0.07, 0.07, 0.09, 1.0],
            circle_color: [0.85, 0.85, 0.88, 1.0],
            circle_stroke_px: 1.5,
            perimeter_color: [0.95, 0.55, 0.35, 1.0],
            interior_color: [0.40, 0.80, 0.95, 1.0],
            midpoint_color: [0.90, 0.90, 0.95, 1.0],
            preview_color: [0.75, 0.90, 0.45, 1.0],
            line_color: [0.55, 0.55, 0.60, 0.8],
            dot_size_px: 3.0,
            ref_dot_size_px: 7.0,
            padding: 0.1,
        }
    }
}

impl ConfigSchema for DotsOnCircleVizConfig {
    fn schema() -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "background": color_property("Background", [0.07, 0.07, 0.09, 1.0]),
                "circle_color": color_property("Circle color", [0.85, 0.85, 0.88, 1.0]),
                "circle_stroke_px": number_property(NumberOpts {
                    label: "Circle stroke (px)",
                    default: 1.5, min: 0.5, max: 8.0, step: 0.1,
                    integer: false, cosmetic: true, widget: None,
                }),
                "perimeter_color": color_property("Perimeter dot color", [0.95, 0.55, 0.35, 1.0]),
                "interior_color": color_property("Interior dot color", [0.40, 0.80, 0.95, 1.0]),
                "midpoint_color": color_property("Midpoint dot color", [0.90, 0.90, 0.95, 1.0]),
                "preview_color": color_property("Preview midpoint color", [0.75, 0.90, 0.45, 1.0]),
                "line_color": color_property("Reference line color", [0.55, 0.55, 0.60, 0.8]),
                "dot_size_px": number_property(NumberOpts {
                    label: "Midpoint dot size (px)",
                    default: 3.0, min: 0.5, max: 20.0, step: 0.1,
                    integer: false, cosmetic: true, widget: None,
                }),
                "ref_dot_size_px": number_property(NumberOpts {
                    label: "Reference dot size (px)",
                    default: 7.0, min: 0.5, max: 30.0, step: 0.1,
                    integer: false, cosmetic: true, widget: None,
                }),
                "padding": number_property(NumberOpts {
                    label: "Padding around circle",
                    default: 0.1, min: 0.0, max: 1.0, step: 0.01,
                    integer: false, cosmetic: true, widget: None,
                }),
            },
            "required": [
                "background", "circle_color", "circle_stroke_px",
                "perimeter_color", "interior_color", "midpoint_color",
                "preview_color", "line_color",
                "dot_size_px", "ref_dot_size_px", "padding"
            ],
        })
    }

    fn defaults() -> serde_json::Value {
        serde_json::to_value(DotsOnCircleVizConfig::default()).unwrap()
    }
}

pub struct DotsOnCircle {
    camera: Camera2D,
    circle: Option<SdfCircle>,
    points: Option<InstancedPoints>,
    lines: Option<LineBatch>,
}

impl DotsOnCircle {
    pub fn new() -> Self {
        Self {
            camera: Camera2D::new(),
            circle: None,
            points: None,
            lines: None,
        }
    }

    fn ensure_resources(&mut self, gl: &WebGl2RenderingContext) -> Result<(), String> {
        if self.circle.is_none() { self.circle = Some(SdfCircle::new(gl)?); }
        if self.points.is_none() { self.points = Some(InstancedPoints::new(gl)?); }
        if self.lines.is_none()  { self.lines  = Some(LineBatch::new(gl)?); }
        Ok(())
    }
}

impl Default for DotsOnCircle {
    fn default() -> Self { Self::new() }
}

impl Visualization for DotsOnCircle {
    type Config = DotsOnCircleVizConfig;
    type State = MidpointState;

    fn id(&self) -> &'static str { "dots-on-circle" }

    fn init(&mut self, gl: &WebGl2RenderingContext, _cfg: &Self::Config) {
        // Try to allocate GPU resources. Errors are swallowed here — the next
        // render call will retry and the engine's frame() will log the failure
        // via console.warn.
        let _ = self.ensure_resources(gl);
    }

    fn render(
        &mut self,
        gl: &WebGl2RenderingContext,
        state: &Self::State,
        cfg: &Self::Config,
    ) {
        if self.ensure_resources(gl).is_err() {
            return;
        }
        let circle = self.circle.as_ref().unwrap();
        let points = self.points.as_mut().unwrap();
        let lines  = self.lines.as_mut().unwrap();

        // Fit camera to the unit circle + padding.
        self.camera
            .fit_to_bbox([-1.0, -1.0], [1.0, 1.0], cfg.padding.max(0.0));
        let proj = self.camera.projection();
        let viewport = self.camera.viewport_px;

        // Background.
        gl.clear_color(cfg.background[0], cfg.background[1], cfg.background[2], cfg.background[3]);
        gl.clear(WebGl2RenderingContext::COLOR_BUFFER_BIT);

        // Circle stroke. Convert pixel stroke to world units.
        let world_per_px = self.camera.half_width * 2.0 / viewport[0].max(1) as f32;
        let stroke_world = cfg.circle_stroke_px * world_per_px * 0.5;
        circle.draw(gl, &proj, cfg.circle_color, stroke_world, world_per_px);

        // Permanent midpoints + the optional preview midpoint + the two ref
        // dots all go in a single InstancedPoints draw — they share a shader
        // and only differ in per-instance color/size.
        let mut all_points: Vec<PointInstance> = Vec::with_capacity(
            state.permanent.len() + 3,
        );
        for p in &state.permanent {
            all_points.push(PointInstance {
                position: *p,
                color: cfg.midpoint_color,
                radius_px: cfg.dot_size_px * 0.5,
            });
        }
        if let Some(p) = state.preview_midpoint {
            all_points.push(PointInstance {
                position: p,
                color: cfg.preview_color,
                radius_px: cfg.ref_dot_size_px * 0.5,
            });
        }
        if let Some(p) = state.ref_perimeter {
            all_points.push(PointInstance {
                position: p,
                color: cfg.perimeter_color,
                radius_px: cfg.ref_dot_size_px * 0.5,
            });
        }
        if let Some(p) = state.ref_interior {
            all_points.push(PointInstance {
                position: p,
                color: cfg.interior_color,
                radius_px: cfg.ref_dot_size_px * 0.5,
            });
        }
        points.upload(gl, &all_points);
        points.draw(gl, &proj, viewport);

        // Reference line (only present when both ref dots are present).
        if let (Some(a), Some(b)) = (state.ref_perimeter, state.ref_interior) {
            let vs = [
                LineVertex { position: a, color: cfg.line_color },
                LineVertex { position: b, color: cfg.line_color },
            ];
            lines.upload(gl, &vs);
            lines.draw(gl, &proj);
        } else {
            lines.upload(gl, &[]);
        }
    }

    fn resize(&mut self, gl: &WebGl2RenderingContext, w: u32, h: u32) {
        self.camera.resize(w, h);
        gl.viewport(0, 0, w as i32, h as i32);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_round_trip() {
        let v: DotsOnCircleVizConfig =
            serde_json::from_value(DotsOnCircleVizConfig::defaults()).unwrap();
        assert!((v.padding - 0.1).abs() < 1e-6);
        assert_eq!(v.dot_size_px, 3.0);
    }

    #[test]
    fn schema_lists_all_required_fields() {
        let schema = DotsOnCircleVizConfig::schema();
        let required = schema["required"].as_array().expect("required array");
        // 11 fields per the impl above.
        assert_eq!(required.len(), 11);
    }
}
```

- [ ] **Step 2: Wire into visualizations/mod.rs**

Replace `crates/viz-core/src/visualizations/mod.rs` with:

```rust
pub mod color_cycle;
pub mod dots_on_circle;
```

- [ ] **Step 3: Run tests**

```bash
export PATH="$HOME/.cargo/bin:$PATH"
cargo test --workspace
```

Expected: 44 passing (42 prior + 2 new in `visualizations::dots_on_circle::tests`).

- [ ] **Step 4: Commit**

```bash
git add crates/viz-core/src/visualizations/
git commit -m "feat(viz): add DotsOnCircle composing SdfCircle + InstancedPoints + LineBatch"
```

---

## Task 8: Swap engine defaults

Replace ColorCycle with MidpointOnCircle + DotsOnCircle as the hardwired Engine defaults. The ColorCycle modules stay in the codebase as a second working example (Phase 4 will introduce a selector UI).

**Files:**
- Modify: `crates/viz-core/src/engine/mod.rs`

- [ ] **Step 1: Replace the rule/viz imports**

Open `crates/viz-core/src/engine/mod.rs`. Near the top there are three `use` lines pulling in the ColorCycle types:

```rust
use crate::rules::color_cycle::{ColorCycleConfig, ColorCycleRule};
use crate::traits::{InputEvent, Visualization};
use crate::visualizations::color_cycle::{ColorCycleViz, ColorCycleVizConfig};
```

Replace them with:

```rust
use crate::rules::midpoint_on_circle::{MidpointConfig, MidpointOnCircle};
use crate::traits::{InputEvent, Visualization};
use crate::visualizations::dots_on_circle::{DotsOnCircle, DotsOnCircleVizConfig};
```

- [ ] **Step 2: Replace the construction in `Engine::new`**

In `Engine::new`, find the block that initializes the rule and viz (after the GL context setup). It currently reads roughly:

```rust
let rule_cfg = ColorCycleConfig::defaults();
let viz_cfg = ColorCycleVizConfig::defaults();
let max_iter = serde_json::from_value::<ColorCycleConfig>(rule_cfg.clone())
    .map(|c| c.max_iterations)
    .unwrap_or(360);

let rule: Box<dyn ErasedRule> = Box::new(ColorCycleRule);
let mut viz: Box<dyn ErasedVisualization> = Box::new(ColorCycleViz);
```

Replace with:

```rust
let rule_cfg = MidpointConfig::defaults();
let viz_cfg = DotsOnCircleVizConfig::defaults();
let max_iter = serde_json::from_value::<MidpointConfig>(rule_cfg.clone())
    .map(|c| c.max_iterations)
    .unwrap_or(100);

let rule: Box<dyn ErasedRule> = Box::new(MidpointOnCircle);
let mut viz: Box<dyn ErasedVisualization> = Box::new(DotsOnCircle::new());
```

- [ ] **Step 3: Replace the `update_rule_config` body**

In `Engine::update_rule_config`, find the line that parses `ColorCycleConfig` for the new max_iterations:

```rust
let new_max = serde_json::from_value::<ColorCycleConfig>(parsed.clone())
    .map(|c| c.max_iterations.max(1))
    .unwrap_or(self.playback.max_iterations);
```

Replace with:

```rust
let new_max = serde_json::from_value::<MidpointConfig>(parsed.clone())
    .map(|c| c.max_iterations.max(1))
    .unwrap_or(self.playback.max_iterations);
```

- [ ] **Step 4: Verify it compiles + tests pass**

```bash
export PATH="$HOME/.cargo/bin:$PATH"
cargo test --workspace
wasm-pack build crates/viz-core --target web --out-dir pkg
```

Expected: 44 tests pass (no native test changes — the rule/viz tests cover both rules independently). Wasm build clean.

- [ ] **Step 5: Refresh the web symlink**

```bash
cd web && npm install && cd ..
```

- [ ] **Step 6: Commit**

```bash
git add crates/viz-core/src/engine/mod.rs
git commit -m "feat(engine): switch defaults to MidpointOnCircle + DotsOnCircle"
```

---

## Task 9: Browser tests for the new defaults

Extends the wasm-bindgen-test suite with one new test that asserts the rule schema's `properties` contains `max_iterations` after the engine swap.

**Files:**
- Modify: `crates/viz-core/tests/wasm.rs`

- [ ] **Step 1: Add the test**

Append to `crates/viz-core/tests/wasm.rs` (after the existing `engine_schema_round_trip` test, before the closing of any module):

```rust
#[wasm_bindgen_test]
fn default_rule_schema_has_max_iterations_field() {
    make_canvas("test-canvas-defaults");
    let engine = Engine::new("test-canvas-defaults").expect("engine constructs");

    let schema = engine.rule_schema();
    let props = js_sys::Reflect::get(&schema, &JsValue::from_str("properties"))
        .expect("properties field");
    let max_iter = js_sys::Reflect::get(&props, &JsValue::from_str("max_iterations"))
        .expect("max_iterations property");
    assert!(!max_iter.is_undefined() && !max_iter.is_null());
}
```

- [ ] **Step 2: Run the browser tests**

```bash
export PATH="$HOME/.cargo/bin:$PATH"
wasm-pack test --chrome --headless --chromedriver=/tmp/chromedriver-mac-arm64/chromedriver crates/viz-core
```

(Drop the `--chromedriver=` flag if your auto-downloaded one matches your Chrome.)

Expected: `test result: ok. 6 passed; 0 failed`.

- [ ] **Step 3: Commit**

```bash
git add crates/viz-core/tests/wasm.rs
git commit -m "test: assert default rule schema exposes max_iterations after swap"
```

---

## Task 10: README + Phase 3 acceptance

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the Status line and project layout**

Modify `README.md`. Change the Status line from:

```markdown
> **Status:** Phase 2 — core abstractions (Rule, Visualization, ConfigSchema) and playback engine, validated with a demo ColorCycleRule + ColorCycleViz. See …
```

to:

```markdown
> **Status:** Phase 3 — the midpoint-on-circle visualization. A unit circle, deterministic seeded reference points, and a growing field of midpoints driven by the Phase 2 playback engine. The Phase 2 ColorCycle rule + viz remain in the codebase as a second working example. See …
```

In the project layout block, replace the rules/visualizations subtrees with the updated structure (renderers added, midpoint files added):

```
math-visualizer/
├── crates/viz-core/                  # Rust crate compiled to WebAssembly
│   ├── src/
│   │   ├── lib.rs                    # wasm-bindgen entry point
│   │   ├── traits.rs                 # SceneState, Rule, Visualization, Capabilities, InputEvent
│   │   ├── config/                   # ConfigSchema trait + JSON Schema helpers
│   │   ├── engine/
│   │   │   ├── mod.rs                # Engine: orchestrates rule + viz + playback
│   │   │   ├── playback.rs           # PlaybackState, Command, pure reducer
│   │   │   └── erased.rs             # Type-erased dispatch over Rule/Visualization
│   │   ├── render/
│   │   │   ├── camera_2d.rs          # 2D ortho camera with fit-to-bbox
│   │   │   ├── shader.rs             # WebGL2 shader compile/link wrapper
│   │   │   ├── instanced_points.rs   # Per-instance position+color+radius dots
│   │   │   ├── sdf_circle.rs         # Single-quad antialiased stroked circle
│   │   │   └── line_batch.rs         # Colored line segment batch
│   │   ├── rules/
│   │   │   ├── midpoint_on_circle.rs # Phase 3 flagship rule (seeded RNG)
│   │   │   └── color_cycle.rs        # Phase 2 demo rule (still works)
│   │   └── visualizations/
│   │       ├── dots_on_circle.rs     # Phase 3 viz (SdfCircle + InstancedPoints + LineBatch)
│   │       └── color_cycle.rs        # Phase 2 demo viz
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

- [ ] **Step 2: Run the full Phase 3 acceptance checklist**

From the repo root:

```bash
export PATH="$HOME/.cargo/bin:$PATH"

# Rust unit tests — expect 44 passing
cargo test --workspace

# WASM browser tests — expect 6 passing
wasm-pack test --chrome --headless --chromedriver=/tmp/chromedriver-mac-arm64/chromedriver crates/viz-core

# JS tests — expect 3 passing (no changes from Phase 2)
cd web && npm run test

# Type check — expect 0 errors
npm run check

# Production build — expect ✓ built
npm run build
cd ..
```

All five gates must pass.

- [ ] **Step 3: Manual browser checklist**

Run `cd web && npm run dev` and open http://localhost:5173/. Verify:

- A circle appears, fit to the viewport with a small margin around it.
- Pressing ▶ (play): two reference dots appear in sequence each iteration (one on the perimeter, one inside), a thin line connects them, then a small "preview" dot appears at the midpoint, then the next iteration starts.
- Permanent midpoint dots accumulate over time — by iteration ~100 you should see a clear pattern emerging inside the circle.
- ▶▶ (step forward) and ◀ (step back) advance/retreat one iteration cleanly without breaking the animation.
- ↺ (reset) clears to an empty circle.
- The speed slider works — at 0.25 each iteration takes ~4 seconds; at 60 it's a blur but still draws.
- Resize the window: the circle stays fit to the viewport, dots stay crisp.
- DevTools console: clean, no red errors. (`viz.render failed` console.warn messages from Phase 2 should NOT appear — those would indicate a state-type mismatch.)

Stop the dev server (`pkill -f vite`).

- [ ] **Step 4: Commit the README**

```bash
git add README.md
git commit -m "docs: Phase 3 README update — midpoint-on-circle is now the default"
```

---

## Phase 3 acceptance summary

After Task 10 the following must all be true. Do not call Phase 3 done until each is verified:

- [ ] `cargo test --workspace` → 44 tests pass.
- [ ] `wasm-pack test --chrome --headless crates/viz-core` → 6 tests pass.
- [ ] `cd web && npm run test` → 3 tests pass.
- [ ] `cd web && npm run check` → 0 errors / 0 warnings.
- [ ] `cd web && npm run build` → succeeds.
- [ ] Manual browser checklist (Task 10 Step 3) — every item passes.

Phase 4 will introduce the auto-rendering config panel (ConfigSchema derive macro + Svelte widgets + cosmetic-vs-structural updates + localStorage persistence + a rule/viz selector).
