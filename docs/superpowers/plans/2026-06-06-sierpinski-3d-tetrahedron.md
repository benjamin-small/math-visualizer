# Sierpinski 3D Tetrahedron Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 2D Sierpinski triangle flagship visualization with a 3D Sierpinski tetrahedron that auto-rotates and supports click-drag orbit, with each trail dot tinted by the corner it moved toward.

**Architecture:** Additive — add 3D Camera/InstancedPoints/LineBatch renderers next to the existing 2D ones; introduce a `ChaosGame3D` rule + `SierpinskiPyramid` viz alongside the 2D versions during development; swap the engine defaults; delete the 2D Sierpinski rule + viz at the end (the midpoint-on-circle and color-cycle 2D rules stay for Phase 4's selector).

**Tech Stack:** Rust → wasm-bindgen → WebGL2 (raw, via `web-sys`); Svelte 5 UI. No new deps.

**Spec:** [`docs/superpowers/specs/2026-06-06-sierpinski-3d-tetrahedron-design.md`](../specs/2026-06-06-sierpinski-3d-tetrahedron-design.md).

---

## Conventions used in this plan

- All test commands run from the repo root unless noted.
- "Workspace tests": `cargo test --workspace`.
- "Browser tests": `wasm-pack test --chrome --headless crates/viz-core`.
- WASM rebuild: `wasm-pack build crates/viz-core --target web --out-dir pkg`. Needed when JS-facing surface changes.
- Web typecheck: `cd web && npm run check`.
- Web component tests: `cd web && npm run test`.

After every commit, the workspace must compile and `cargo test --workspace` must pass. Browser tests are run at the end of each task that touches WebGL or wasm-bindgen surface.

Commit messages follow the repo's `<type>(<scope>): <short summary>` convention seen in `git log` (e.g. `feat(viz): …`, `feat(render): …`).

---

## Task 1: Camera3D — turntable camera with view-projection mat4

**Files:**
- Create: `crates/viz-core/src/render/camera_3d.rs`
- Modify: `crates/viz-core/src/render/mod.rs` (add module + re-export)

A turntable camera with `azimuth`, `elevation`, `distance` orbiting a `target`. Produces a 4×4 column-major view-projection matrix for shaders.

### Step 1.1: Write the failing tests

- [ ] Create `crates/viz-core/src/render/camera_3d.rs` with **only** the test module so it fails to compile:

```rust
//! Turntable 3D camera. Orbits a target point; produces a 4×4 column-major
//! view-projection matrix for shader upload.

// (struct/impl go here in Step 1.3)

#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: f32, b: f32, eps: f32) -> bool {
        (a - b).abs() < eps
    }

    #[test]
    fn new_has_sane_defaults() {
        let cam = Camera3D::new();
        assert!(cam.distance > 0.0);
        assert!(cam.fov_y > 0.0 && cam.fov_y < std::f32::consts::PI);
        assert_eq!(cam.target, [0.0, 0.0, 0.0]);
        assert_eq!(cam.viewport_px, [1, 1]);
    }

    #[test]
    fn resize_clamps_to_at_least_one() {
        let mut cam = Camera3D::new();
        cam.resize(0, 0);
        assert_eq!(cam.viewport_px, [1, 1]);
        cam.resize(800, 600);
        assert_eq!(cam.viewport_px, [800, 600]);
        assert!(approx(cam.aspect(), 800.0 / 600.0, 1e-5));
    }

    #[test]
    fn auto_advance_adds_to_azimuth_proportional_to_dt() {
        let mut a = Camera3D::new();
        let mut b = Camera3D::new();
        a.auto_advance(0.5, 1.0);
        b.auto_advance(0.25, 1.0);
        b.auto_advance(0.25, 1.0);
        assert!(approx(a.azimuth, b.azimuth, 1e-6));
    }

    #[test]
    fn orbit_drag_is_linear_in_pixels_on_azimuth() {
        let mut a = Camera3D::new();
        let mut b = Camera3D::new();
        a.orbit_drag(10.0, 0.0);
        b.orbit_drag(5.0, 0.0);
        b.orbit_drag(5.0, 0.0);
        assert!(approx(a.azimuth, b.azimuth, 1e-6));
    }

    #[test]
    fn elevation_clamps_below_pi_over_two() {
        let mut cam = Camera3D::new();
        cam.orbit_drag(0.0, 100_000.0);   // huge positive drag
        assert!(cam.elevation < std::f32::consts::FRAC_PI_2);
        cam.orbit_drag(0.0, -1_000_000.0); // huge negative drag
        assert!(cam.elevation > -std::f32::consts::FRAC_PI_2);
    }

    #[test]
    fn view_projection_is_deterministic() {
        let mut cam = Camera3D::new();
        cam.resize(800, 600);
        cam.azimuth = 0.5;
        cam.elevation = -0.3;
        cam.distance = 2.5;
        let m1 = cam.view_projection();
        let m2 = cam.view_projection();
        for i in 0..16 {
            assert!(approx(m1[i], m2[i], 1e-6), "differ at {i}");
        }
    }

    #[test]
    fn view_projection_maps_origin_in_front_of_camera() {
        // Camera at distance d on +Z axis looking at origin → origin projects
        // to clip-space (0, 0, +something with w > 0).
        let mut cam = Camera3D::new();
        cam.resize(100, 100);
        cam.azimuth = 0.0;
        cam.elevation = 0.0;
        cam.distance = 2.5;
        let m = cam.view_projection();
        // Multiply m * [0,0,0,1] = column 3 of m (column-major).
        let x = m[12];
        let y = m[13];
        let _z = m[14];
        let w = m[15];
        assert!(w > 0.0, "origin should be in front of camera, w={w}");
        // x and y near 0 (origin is on the view axis).
        assert!(approx(x, 0.0, 1e-4));
        assert!(approx(y, 0.0, 1e-4));
    }
}
```

- [ ] Add the module declaration in `crates/viz-core/src/render/mod.rs`:

```rust
pub mod camera_2d;
pub mod camera_3d;
pub mod instanced_points;
pub mod line_batch;
pub mod sdf_circle;
pub mod shader;

pub use camera_2d::Camera2D;
pub use camera_3d::Camera3D;
pub use instanced_points::{InstancedPoints, PointInstance};
pub use line_batch::{LineBatch, LineVertex};
pub use sdf_circle::SdfCircle;
pub use shader::ShaderProgram;
```

### Step 1.2: Run tests to verify they fail

- [ ] Run: `cargo test -p viz-core camera_3d --lib`
- [ ] Expected: compile error — `Camera3D` is not defined.

### Step 1.3: Implement Camera3D

- [ ] Replace the top of `crates/viz-core/src/render/camera_3d.rs` (the comment) with the full implementation, keeping the test module at the bottom:

```rust
//! Turntable 3D camera. Orbits a target point; produces a 4×4 column-major
//! view-projection matrix for shader upload.
//!
//! Conventions: right-handed; +Y is up; the camera looks down -Z in view
//! space. Azimuth is rotation around the Y axis (0 looks down -Z toward the
//! target from +Z); elevation is tilt above the equator (positive = looking
//! down from above). Both in radians.

const DRAG_SENS_RAD_PER_PX: f32 = 0.005;
const ELEVATION_LIMIT: f32 = std::f32::consts::FRAC_PI_2 - 0.01;

#[derive(Debug, Clone, Copy)]
pub struct Camera3D {
    pub target: [f32; 3],
    pub azimuth: f32,
    pub elevation: f32,
    pub distance: f32,
    pub fov_y: f32,
    pub viewport_px: [u32; 2],
}

impl Camera3D {
    pub fn new() -> Self {
        Self {
            target: [0.0, 0.0, 0.0],
            azimuth: 0.0,
            elevation: 0.0,
            distance: 2.5,
            fov_y: std::f32::consts::FRAC_PI_4, // 45°
            viewport_px: [1, 1],
        }
    }

    pub fn resize(&mut self, width: u32, height: u32) {
        self.viewport_px = [width.max(1), height.max(1)];
    }

    pub fn aspect(&self) -> f32 {
        self.viewport_px[0] as f32 / self.viewport_px[1] as f32
    }

    /// Add `dt * speed` to azimuth (auto-rotation).
    pub fn auto_advance(&mut self, dt: f32, speed: f32) {
        self.azimuth += dt * speed;
    }

    /// Apply a pixel-space drag delta as azimuth/elevation deltas. Elevation
    /// is clamped to avoid gimbal flip at the poles.
    pub fn orbit_drag(&mut self, dx_px: f32, dy_px: f32) {
        self.azimuth += dx_px * DRAG_SENS_RAD_PER_PX;
        self.elevation = (self.elevation + dy_px * DRAG_SENS_RAD_PER_PX)
            .clamp(-ELEVATION_LIMIT, ELEVATION_LIMIT);
    }

    /// World-space camera position (eye) derived from orbit angles.
    pub fn eye(&self) -> [f32; 3] {
        let ce = self.elevation.cos();
        let se = self.elevation.sin();
        let sa = self.azimuth.sin();
        let ca = self.azimuth.cos();
        [
            self.target[0] + self.distance * ce * sa,
            self.target[1] + self.distance * se,
            self.target[2] + self.distance * ce * ca,
        ]
    }

    /// Column-major 4×4 view × projection matrix for shader upload.
    pub fn view_projection(&self) -> [f32; 16] {
        let view = look_at(self.eye(), self.target, [0.0, 1.0, 0.0]);
        let proj = perspective(self.fov_y, self.aspect(), 0.05, 100.0);
        mul_mat4(&proj, &view)
    }
}

impl Default for Camera3D {
    fn default() -> Self { Self::new() }
}

// ---- mat4 / vec3 helpers (column-major) -----------------------------------

fn sub3(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn dot3(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn cross3(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn normalize3(v: [f32; 3]) -> [f32; 3] {
    let len = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt().max(1e-12);
    [v[0] / len, v[1] / len, v[2] / len]
}

/// Right-handed lookAt. Column-major output.
fn look_at(eye: [f32; 3], target: [f32; 3], up: [f32; 3]) -> [f32; 16] {
    let f = normalize3(sub3(target, eye)); // forward (camera looks toward target)
    let s = normalize3(cross3(f, up));     // right
    let u = cross3(s, f);                  // recomputed up
    [
        s[0], u[0], -f[0], 0.0,
        s[1], u[1], -f[1], 0.0,
        s[2], u[2], -f[2], 0.0,
        -dot3(s, eye), -dot3(u, eye), dot3(f, eye), 1.0,
    ]
}

/// Right-handed perspective, NDC depth in [-1, +1] (WebGL default).
fn perspective(fov_y: f32, aspect: f32, near: f32, far: f32) -> [f32; 16] {
    let f = 1.0 / (fov_y * 0.5).tan();
    let inv_nf = 1.0 / (near - far);
    let mut m = [0.0f32; 16];
    m[0]  = f / aspect;
    m[5]  = f;
    m[10] = (far + near) * inv_nf;
    m[11] = -1.0;
    m[14] = 2.0 * far * near * inv_nf;
    m
}

/// Column-major 4×4 multiply: result = a × b.
fn mul_mat4(a: &[f32; 16], b: &[f32; 16]) -> [f32; 16] {
    let mut r = [0.0f32; 16];
    for col in 0..4 {
        for row in 0..4 {
            let mut s = 0.0;
            for k in 0..4 {
                s += a[row + 4 * k] * b[k + 4 * col];
            }
            r[row + 4 * col] = s;
        }
    }
    r
}
```

### Step 1.4: Run tests to verify they pass

- [ ] Run: `cargo test -p viz-core camera_3d --lib`
- [ ] Expected: all 7 tests pass.
- [ ] Also run: `cargo test --workspace` and confirm nothing else broke.

### Step 1.5: Commit

- [ ] `git add crates/viz-core/src/render/camera_3d.rs crates/viz-core/src/render/mod.rs`
- [ ] Commit:

```bash
git commit -m "$(cat <<'EOF'
feat(render): Camera3D turntable camera with view-projection mat4

Right-handed lookAt + perspective, orbit_drag/auto_advance for orbit
control, elevation clamped at the poles. Will back the rotating
Sierpinski tetrahedron in the next tasks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: InstancedPoints3D — 3D dots with screen-space-constant pixel radius

**Files:**
- Create: `crates/viz-core/src/render/instanced_points_3d.rs`
- Modify: `crates/viz-core/src/render/mod.rs` (add module + re-export)

3D analog of `InstancedPoints`. Per-instance `(vec3 position, vec4 color, float radius_px)`. Uniform is `mat4 view_projection`. The radius is preserved in screen pixels regardless of depth by expanding the quad **after** the perspective projection (multiplying the screen-space offset by `clip.w` so the post-division pixel size stays constant).

### Step 2.1: Add module declaration and re-export

- [ ] Update `crates/viz-core/src/render/mod.rs`:

```rust
pub mod camera_2d;
pub mod camera_3d;
pub mod instanced_points;
pub mod instanced_points_3d;
pub mod line_batch;
pub mod sdf_circle;
pub mod shader;

pub use camera_2d::Camera2D;
pub use camera_3d::Camera3D;
pub use instanced_points::{InstancedPoints, PointInstance};
pub use instanced_points_3d::{InstancedPoints3D, PointInstance3D};
pub use line_batch::{LineBatch, LineVertex};
pub use sdf_circle::SdfCircle;
pub use shader::ShaderProgram;
```

### Step 2.2: Implement InstancedPoints3D

- [ ] Create `crates/viz-core/src/render/instanced_points_3d.rs`:

```rust
//! 3D analog of `InstancedPoints`. Each instance has a 3D world position, an
//! RGBA color, and a pixel-space radius. The quad expansion happens **after**
//! the perspective projection (multiplying the screen-space radius by clip.w
//! so the post-division pixel size stays constant). Antialiased disc fragment
//! shader, identical to the 2D version.

use web_sys::{WebGl2RenderingContext as Gl, WebGlBuffer, WebGlVertexArrayObject};

use super::shader::ShaderProgram;

/// Per-instance data. Tightly packed: [pos.x, pos.y, pos.z, r, g, b, a, radius_px].
#[derive(Debug, Clone, Copy)]
pub struct PointInstance3D {
    pub position: [f32; 3],
    pub color: [f32; 4],
    pub radius_px: f32,
}

const FLOATS_PER_INSTANCE: usize = 8;

const VERTEX_SRC: &str = r#"#version 300 es
precision mediump float;

layout(location=0) in vec2 a_corner;        // unit quad
layout(location=1) in vec3 a_position;
layout(location=2) in vec4 a_color;
layout(location=3) in float a_radius_px;

uniform mat4 u_view_proj;
uniform vec2 u_viewport_px;

out vec2 v_corner;
out vec4 v_color;

void main() {
    v_corner = a_corner;
    v_color = a_color;

    // Project the instance center; THEN offset by the (pixel-sized) corner
    // expressed in clip units. Multiplying by clip.w means after the
    // rasterizer's /w division the offset is exactly a_radius_px pixels,
    // regardless of depth.
    vec4 clip = u_view_proj * vec4(a_position, 1.0);
    vec2 radius_clip = vec2(a_radius_px) * 2.0 / u_viewport_px * clip.w;
    gl_Position = vec4(clip.xy + a_corner * radius_clip, clip.zw);
}
"#;

const FRAGMENT_SRC: &str = r#"#version 300 es
precision mediump float;

in vec2 v_corner;
in vec4 v_color;

out vec4 frag_color;

void main() {
    float dist = length(v_corner);
    float alpha = smoothstep(1.0, 0.9, dist);
    if (alpha <= 0.0) discard;
    frag_color = vec4(v_color.rgb, v_color.a * alpha);
}
"#;

pub struct InstancedPoints3D {
    program: ShaderProgram,
    vao: WebGlVertexArrayObject,
    instance_buffer: WebGlBuffer,
    instance_count: usize,
    u_view_proj_loc: Option<web_sys::WebGlUniformLocation>,
    u_viewport_loc: Option<web_sys::WebGlUniformLocation>,
}

impl InstancedPoints3D {
    pub fn new(gl: &Gl) -> Result<Self, String> {
        let program = ShaderProgram::new(gl, VERTEX_SRC, FRAGMENT_SRC)?;

        // Static quad buffer: triangle strip, four corners in [-1, 1].
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

        // a_corner (vec2) — per-vertex, attribute 0.
        gl.bind_buffer(Gl::ARRAY_BUFFER, Some(&quad_buf));
        gl.enable_vertex_attrib_array(0);
        gl.vertex_attrib_pointer_with_i32(0, 2, Gl::FLOAT, false, 0, 0);

        // Instance attributes 1..=3.
        gl.bind_buffer(Gl::ARRAY_BUFFER, Some(&instance_buffer));
        let stride = (FLOATS_PER_INSTANCE * 4) as i32;
        // a_position (vec3)
        gl.enable_vertex_attrib_array(1);
        gl.vertex_attrib_pointer_with_i32(1, 3, Gl::FLOAT, false, stride, 0);
        gl.vertex_attrib_divisor(1, 1);
        // a_color (vec4) — offset 3 floats
        gl.enable_vertex_attrib_array(2);
        gl.vertex_attrib_pointer_with_i32(2, 4, Gl::FLOAT, false, stride, 3 * 4);
        gl.vertex_attrib_divisor(2, 1);
        // a_radius_px (float) — offset 7 floats
        gl.enable_vertex_attrib_array(3);
        gl.vertex_attrib_pointer_with_i32(3, 1, Gl::FLOAT, false, stride, 7 * 4);
        gl.vertex_attrib_divisor(3, 1);

        gl.bind_vertex_array(None);

        let u_view_proj_loc = program.uniform_location(gl, "u_view_proj");
        let u_viewport_loc = program.uniform_location(gl, "u_viewport_px");

        Ok(Self {
            program,
            vao,
            instance_buffer,
            instance_count: 0,
            u_view_proj_loc,
            u_viewport_loc,
        })
    }

    pub fn upload(&mut self, gl: &Gl, instances: &[PointInstance3D]) {
        self.instance_count = instances.len();
        let mut packed = Vec::with_capacity(instances.len() * FLOATS_PER_INSTANCE);
        for inst in instances {
            packed.push(inst.position[0]);
            packed.push(inst.position[1]);
            packed.push(inst.position[2]);
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

    pub fn draw(&self, gl: &Gl, view_proj: &[f32; 16], viewport_px: [u32; 2]) {
        if self.instance_count == 0 { return; }
        self.program.use_program(gl);
        gl.uniform_matrix4fv_with_f32_array(self.u_view_proj_loc.as_ref(), false, view_proj);
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

### Step 2.3: Confirm it compiles

- [ ] Run: `cargo build -p viz-core --target wasm32-unknown-unknown`
- [ ] Expected: success (the type is unused but compiles).
- [ ] Also run: `cargo test --workspace` — should still pass with no new failures.

### Step 2.4: Commit

- [ ] `git add crates/viz-core/src/render/instanced_points_3d.rs crates/viz-core/src/render/mod.rs`
- [ ] Commit:

```bash
git commit -m "$(cat <<'EOF'
feat(render): InstancedPoints3D with depth-constant pixel radius

3D variant of the dot renderer: per-instance vec3 position, vec4 color,
float pixel radius. Multiplies the post-projection screen-space offset
by clip.w so the on-screen size stays constant regardless of depth.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: LineBatch3D — colored 3D line segments

**Files:**
- Create: `crates/viz-core/src/render/line_batch_3d.rs`
- Modify: `crates/viz-core/src/render/mod.rs` (add module + re-export)

3D analog of `LineBatch`. Per-vertex `(vec3 position, vec4 color)`, uniform `mat4 view_projection`. Used for the tetrahedron's 6 edges and the per-iteration guide line.

### Step 3.1: Add module declaration and re-export

- [ ] Update `crates/viz-core/src/render/mod.rs`:

```rust
pub mod camera_2d;
pub mod camera_3d;
pub mod instanced_points;
pub mod instanced_points_3d;
pub mod line_batch;
pub mod line_batch_3d;
pub mod sdf_circle;
pub mod shader;

pub use camera_2d::Camera2D;
pub use camera_3d::Camera3D;
pub use instanced_points::{InstancedPoints, PointInstance};
pub use instanced_points_3d::{InstancedPoints3D, PointInstance3D};
pub use line_batch::{LineBatch, LineVertex};
pub use line_batch_3d::{LineBatch3D, LineVertex3D};
pub use sdf_circle::SdfCircle;
pub use shader::ShaderProgram;
```

### Step 3.2: Implement LineBatch3D

- [ ] Create `crates/viz-core/src/render/line_batch_3d.rs`:

```rust
//! 3D analog of `LineBatch`. Per-vertex (vec3 position, vec4 color), uniform
//! mat4 view-projection. Same 1-pixel line-width caveat as the 2D version
//! (gl.lineWidth is capped to 1 on most platforms — that reads fine for the
//! tetrahedron's 6 edges + the per-iteration guide line).

use web_sys::{WebGl2RenderingContext as Gl, WebGlBuffer, WebGlVertexArrayObject};

use super::shader::ShaderProgram;

#[derive(Debug, Clone, Copy)]
pub struct LineVertex3D {
    pub position: [f32; 3],
    pub color: [f32; 4],
}

const FLOATS_PER_VERTEX: usize = 7;

const VERTEX_SRC: &str = r#"#version 300 es
precision mediump float;

layout(location=0) in vec3 a_position;
layout(location=1) in vec4 a_color;

uniform mat4 u_view_proj;

out vec4 v_color;

void main() {
    v_color = a_color;
    gl_Position = u_view_proj * vec4(a_position, 1.0);
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

pub struct LineBatch3D {
    program: ShaderProgram,
    vao: WebGlVertexArrayObject,
    buffer: WebGlBuffer,
    vertex_count: usize,
    u_view_proj: Option<web_sys::WebGlUniformLocation>,
}

impl LineBatch3D {
    pub fn new(gl: &Gl) -> Result<Self, String> {
        let program = ShaderProgram::new(gl, VERTEX_SRC, FRAGMENT_SRC)?;
        let buffer = gl.create_buffer().ok_or("create_buffer")?;

        let vao = gl.create_vertex_array().ok_or("create_vertex_array")?;
        gl.bind_vertex_array(Some(&vao));
        gl.bind_buffer(Gl::ARRAY_BUFFER, Some(&buffer));
        let stride = (FLOATS_PER_VERTEX * 4) as i32;
        gl.enable_vertex_attrib_array(0);
        gl.vertex_attrib_pointer_with_i32(0, 3, Gl::FLOAT, false, stride, 0);
        gl.enable_vertex_attrib_array(1);
        gl.vertex_attrib_pointer_with_i32(1, 4, Gl::FLOAT, false, stride, 3 * 4);
        gl.bind_vertex_array(None);

        let u_view_proj = program.uniform_location(gl, "u_view_proj");

        Ok(Self { program, vao, buffer, vertex_count: 0, u_view_proj })
    }

    pub fn upload(&mut self, gl: &Gl, vertices: &[LineVertex3D]) {
        self.vertex_count = vertices.len();
        let mut packed = Vec::with_capacity(vertices.len() * FLOATS_PER_VERTEX);
        for v in vertices {
            packed.push(v.position[0]);
            packed.push(v.position[1]);
            packed.push(v.position[2]);
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

    pub fn draw(&self, gl: &Gl, view_proj: &[f32; 16]) {
        if self.vertex_count == 0 { return; }
        self.program.use_program(gl);
        gl.uniform_matrix4fv_with_f32_array(self.u_view_proj.as_ref(), false, view_proj);
        gl.bind_vertex_array(Some(&self.vao));
        gl.enable(Gl::BLEND);
        gl.blend_func(Gl::SRC_ALPHA, Gl::ONE_MINUS_SRC_ALPHA);
        gl.draw_arrays(Gl::LINES, 0, self.vertex_count as i32);
        gl.bind_vertex_array(None);
    }
}
```

### Step 3.3: Confirm it compiles

- [ ] Run: `cargo build -p viz-core --target wasm32-unknown-unknown`
- [ ] Run: `cargo test --workspace`
- [ ] Expected: both succeed.

### Step 3.4: Commit

- [ ] `git add crates/viz-core/src/render/line_batch_3d.rs crates/viz-core/src/render/mod.rs`
- [ ] Commit:

```bash
git commit -m "$(cat <<'EOF'
feat(render): LineBatch3D for colored 3D line segments

Per-vertex vec3 position + vec4 color, mat4 view-projection uniform.
Will draw the tetrahedron's 6 edges and the per-iteration guide line.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: 3D chaos game primitives + `ChaosGame3D` rule (alongside 2D)

**Files:**
- Modify: `crates/viz-core/src/rules/sierpinski_chaos.rs` (add 3D items alongside existing 2D items)

Add the 3D tetrahedron corners, 3D math helpers, `ChaosGameState3D`, and a new `ChaosGame3D` rule. The 2D `SierpinskiChaos` / `ChaosGameState` / `CORNERS` stay in place so the workspace compiles. Task 11 (cleanup) deletes the 2D rule and renames the 3D types.

### Step 4.1: Write the failing tests

- [ ] Append to the `mod tests` block at the bottom of `crates/viz-core/src/rules/sierpinski_chaos.rs` (keep all existing 2D tests; add the 3D tests below them):

```rust
    // ---- 3D tetrahedron tests ----

    #[test]
    fn pick_corner_4_distribution_is_roughly_uniform() {
        let mut counts = [0u32; 4];
        for i in 0..4000 {
            counts[pick_corner_4(42, i)] += 1;
        }
        // 4000 / 4 = 1000 ± noise; allow ±20%.
        for c in counts {
            assert!(c > 800 && c < 1200, "corner counts: {counts:?}");
        }
    }

    #[test]
    fn corners_3d_edges_have_unit_length() {
        // Every pair of corners is one edge of a regular tetrahedron.
        for i in 0..4 {
            for j in (i + 1)..4 {
                let dx = CORNERS_3D[i][0] - CORNERS_3D[j][0];
                let dy = CORNERS_3D[i][1] - CORNERS_3D[j][1];
                let dz = CORNERS_3D[i][2] - CORNERS_3D[j][2];
                let d = (dx * dx + dy * dy + dz * dz).sqrt();
                assert!((d - 1.0).abs() < 1e-5, "edge {i}-{j} length {d}");
            }
        }
    }

    #[test]
    fn corners_3d_centroid_is_origin() {
        let mut s = [0.0f32; 3];
        for c in CORNERS_3D {
            s[0] += c[0]; s[1] += c[1]; s[2] += c[2];
        }
        for k in 0..3 {
            assert!((s[k] / 4.0).abs() < 1e-6);
        }
    }

    #[test]
    fn halfway_3d_is_the_midpoint() {
        assert_eq!(halfway_3d([0.0, 0.0, 0.0], [2.0, 4.0, 6.0]), [1.0, 2.0, 3.0]);
    }

    #[test]
    fn random_inside_tetrahedron_is_inside_for_many_seeds() {
        for seed in 0u64..40 {
            let p = random_inside_tetrahedron(seed);
            assert!(point_in_tetrahedron(p), "seed {seed}: {p:?}");
        }
    }

    #[test]
    fn rule_3d_advance_to_is_deterministic() {
        let rule = ChaosGame3D;
        let cfg = ChaosGameConfig::default();
        let mut a = rule.init(&cfg, 17);
        rule.advance_to(&mut a, &cfg, 17, 100);
        let mut b = rule.init(&cfg, 17);
        rule.advance_to(&mut b, &cfg, 17, 100);
        assert_eq!(a.trail, b.trail);
        assert_eq!(a.initial_position, b.initial_position);
        assert_eq!(a.corner_for_dot, b.corner_for_dot);
    }

    #[test]
    fn rule_3d_advance_to_is_jump_safe() {
        let rule = ChaosGame3D;
        let cfg = ChaosGameConfig::default();
        let mut direct = rule.init(&cfg, 99);
        rule.advance_to(&mut direct, &cfg, 99, 50);
        let mut backward = rule.init(&cfg, 99);
        rule.advance_to(&mut backward, &cfg, 99, 25);
        assert_eq!(&direct.trail[..25], &backward.trail[..]);
    }

    #[test]
    fn rule_3d_corner_for_dot_matches_pick_corner() {
        let rule = ChaosGame3D;
        let cfg = ChaosGameConfig::default();
        let mut state = rule.init(&cfg, 7);
        rule.advance_to(&mut state, &cfg, 7, 100);
        assert_eq!(state.corner_for_dot.len(), 100);
        for i in 0..100 {
            assert_eq!(state.corner_for_dot[i] as usize, pick_corner_4(7, i as u32));
        }
    }

    #[test]
    fn rule_3d_substep_highlights_corner_then_moves_dot() {
        let rule = ChaosGame3D;
        let cfg = ChaosGameConfig::default();
        let mut state = rule.init(&cfg, 0);
        rule.advance_to(&mut state, &cfg, 7, 5);

        rule.substep(&mut state, &cfg, 7, 5, 0.10);
        assert!(state.chosen_corner.is_some());
        assert!(state.current_position.is_none());

        rule.substep(&mut state, &cfg, 7, 5, 0.80);
        assert!(state.chosen_corner.is_some());
        let cp = state.current_position.expect("position set during move");
        let start = state.trail[4];
        let dx = cp[0] - start[0];
        let dy = cp[1] - start[1];
        let dz = cp[2] - start[2];
        let d = (dx * dx + dy * dy + dz * dz).sqrt();
        assert!(d > 1e-4, "dot moved away from start by sub=0.80");
    }

    fn point_in_tetrahedron(p: [f32; 3]) -> bool {
        // Barycentric check: solve for weights w_i ≥ 0 summing to 1 such that
        // p = sum_i w_i * CORNERS_3D[i]. With 4 unknowns and 4 equations
        // (3 coords + sum-to-1), we get a unique solution.
        let a = CORNERS_3D[0];
        let b = CORNERS_3D[1];
        let c = CORNERS_3D[2];
        let d = CORNERS_3D[3];
        let v0 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        let v1 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        let v2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
        let r  = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
        // det3
        let det = v0[0] * (v1[1] * v2[2] - v1[2] * v2[1])
                - v0[1] * (v1[0] * v2[2] - v1[2] * v2[0])
                + v0[2] * (v1[0] * v2[1] - v1[1] * v2[0]);
        let det_u = r[0]  * (v1[1] * v2[2] - v1[2] * v2[1])
                  - r[1]  * (v1[0] * v2[2] - v1[2] * v2[0])
                  + r[2]  * (v1[0] * v2[1] - v1[1] * v2[0]);
        let det_v = v0[0] * (r[1]  * v2[2] - r[2]  * v2[1])
                  - v0[1] * (r[0]  * v2[2] - r[2]  * v2[0])
                  + v0[2] * (r[0]  * v2[1] - r[1]  * v2[0]);
        let det_w = v0[0] * (v1[1] * r[2]  - v1[2] * r[1] )
                  - v0[1] * (v1[0] * r[2]  - v1[2] * r[0] )
                  + v0[2] * (v1[0] * r[1]  - v1[1] * r[0] );
        let u = det_u / det;
        let v = det_v / det;
        let w = det_w / det;
        let t = 1.0 - u - v - w;
        // Small tolerance so points exactly on a face count as inside.
        let eps = 1e-5;
        u >= -eps && v >= -eps && w >= -eps && t >= -eps
    }
```

### Step 4.2: Run tests to verify they fail

- [ ] Run: `cargo test -p viz-core sierpinski_chaos --lib`
- [ ] Expected: compile errors — none of `CORNERS_3D`, `pick_corner_4`, `halfway_3d`, `random_inside_tetrahedron`, `ChaosGame3D`, `ChaosGameState3D` exist yet.

### Step 4.3: Implement 3D primitives, state, and rule

- [ ] Add the following items to `crates/viz-core/src/rules/sierpinski_chaos.rs`. Place each block where it makes structural sense (constants near `CORNERS`, helpers near `halfway`, types near `ChaosGameState`, rule near `SierpinskiChaos`). Don't remove anything 2D — that's Task 11.

```rust
/// Regular tetrahedron, edge length 1, centered at the origin.
/// Vertices are `(±1, ±1, ±1)` with an even number of minus signs (so they
/// pick out a tetrahedron rather than a cube), then scaled by `1/(2√2)`.
pub const CORNERS_3D: [[f32; 3]; 4] = {
    // 1 / (2 * sqrt(2)) = 0.3535533905932738
    const K: f32 = 0.353_553_39;
    [
        [ K,  K,  K],
        [ K, -K, -K],
        [-K,  K, -K],
        [-K, -K,  K],
    ]
};

fn halfway_3d(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [
        (a[0] + b[0]) * 0.5,
        (a[1] + b[1]) * 0.5,
        (a[2] + b[2]) * 0.5,
    ]
}

fn lerp_3d(a: [f32; 3], b: [f32; 3], t: f32) -> [f32; 3] {
    [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
    ]
}

/// Pick a corner index in `0..4` uniformly for iteration `i`. Uses the top
/// 8 bits of `splitmix64(seed ^ i)` mod 4 — bias-free because 4 divides 256.
pub fn pick_corner_4(seed: u64, i: u32) -> usize {
    let raw = splitmix64(seed ^ (i as u64));
    (raw >> 56) as usize & 0b11
}

/// Deterministic uniform point strictly inside the tetrahedron.
/// Standard-simplex sampling: draw `u, v, w ~ U[0,1)`; if `u+v+w > 1`,
/// reflect via the (u, v, w) → (1-u, 1-v, 1-w) trick which is uniform on
/// the standard simplex when combined with barycentric placement.
fn random_inside_tetrahedron(seed: u64) -> [f32; 3] {
    let s1 = splitmix64(seed.wrapping_add(0xA5A5_A5A5_A5A5_A5A5));
    let s2 = splitmix64(s1);
    let s3 = splitmix64(s2);
    let mut u = bits_to_unit_f32(s1);
    let mut v = bits_to_unit_f32(s2);
    let mut w = bits_to_unit_f32(s3);
    if u + v + w > 1.0 {
        u = 1.0 - u;
        v = 1.0 - v;
        w = 1.0 - w;
    }
    let t = 1.0 - u - v - w;
    let a = CORNERS_3D[0];
    let b = CORNERS_3D[1];
    let c = CORNERS_3D[2];
    let d = CORNERS_3D[3];
    [
        t * a[0] + u * b[0] + v * c[0] + w * d[0],
        t * a[1] + u * b[1] + v * c[1] + w * d[1],
        t * a[2] + u * b[2] + v * c[2] + w * d[2],
    ]
}

#[derive(Debug, Default)]
pub struct ChaosGameState3D {
    pub initial_position: [f32; 3],
    pub trail: Vec<[f32; 3]>,
    /// One entry per trail dot: the index (0..4) of the corner the dot
    /// moved halfway toward. Lets the viz tint each dot by its corner
    /// without re-running the RNG every frame.
    pub corner_for_dot: Vec<u8>,
    pub current_position: Option<[f32; 3]>,
    pub chosen_corner: Option<usize>,
    pub current_iteration: u32,
}

impl SceneState for ChaosGameState3D {
    fn clear(&mut self) {
        self.initial_position = [0.0, 0.0, 0.0];
        self.trail.clear();
        self.corner_for_dot.clear();
        self.current_position = None;
        self.chosen_corner = None;
        self.current_iteration = 0;
    }
}

pub struct ChaosGame3D;

impl Rule for ChaosGame3D {
    type Config = ChaosGameConfig;
    type State = ChaosGameState3D;

    fn id(&self) -> &'static str { "sierpinski-chaos-3d" }
    fn capabilities(&self) -> Capabilities { Capabilities::cheap_scrubbable() }

    fn init(&self, _cfg: &Self::Config, _seed: u64) -> Self::State {
        ChaosGameState3D::default()
    }

    fn advance_to(
        &self,
        state: &mut Self::State,
        cfg: &Self::Config,
        seed: u64,
        n: u32,
    ) {
        state.trail.clear();
        state.corner_for_dot.clear();
        state.chosen_corner = None;

        let target = n.min(cfg.max_iterations);
        state.current_iteration = target;

        let mut pos = random_inside_tetrahedron(seed);
        state.initial_position = pos;
        state.trail.reserve(target as usize);
        state.corner_for_dot.reserve(target as usize);
        for i in 0..target {
            let corner_idx = pick_corner_4(seed, i);
            pos = halfway_3d(pos, CORNERS_3D[corner_idx]);
            state.trail.push(pos);
            state.corner_for_dot.push(corner_idx as u8);
        }
        state.current_position = Some(pos);
    }

    fn substep(
        &self,
        state: &mut Self::State,
        cfg: &Self::Config,
        seed: u64,
        n: u32,
        sub: f32,
    ) {
        if n >= cfg.max_iterations {
            state.chosen_corner = None;
            return;
        }
        let corner_idx = pick_corner_4(seed, n);
        let start_pos = if n == 0 {
            state.initial_position
        } else {
            state.trail.get((n - 1) as usize).copied().unwrap_or(state.initial_position)
        };
        let end_pos = halfway_3d(start_pos, CORNERS_3D[corner_idx]);
        let sub = sub.clamp(0.0, 1.0);
        state.chosen_corner = Some(corner_idx);
        if sub < 0.33 {
            state.current_position = None;
        } else {
            let t = ((sub - 0.33) / 0.67).clamp(0.0, 1.0);
            state.current_position = Some(lerp_3d(start_pos, end_pos, t));
        }
    }
}
```

### Step 4.4: Run tests to verify they pass

- [ ] Run: `cargo test -p viz-core sierpinski_chaos --lib`
- [ ] Expected: all 2D tests still pass AND all 3D tests pass.
- [ ] Run: `cargo test --workspace`
- [ ] Expected: pass.

### Step 4.5: Commit

- [ ] `git add crates/viz-core/src/rules/sierpinski_chaos.rs`
- [ ] Commit:

```bash
git commit -m "$(cat <<'EOF'
feat(rule): add 3D chaos-game primitives + ChaosGame3D alongside 2D

CORNERS_3D (regular tetrahedron, edge length 1), halfway_3d, lerp_3d,
pick_corner_4 (uniform 0..4), random_inside_tetrahedron (standard-simplex
sample), ChaosGameState3D (3D positions + corner_for_dot record), and
the new ChaosGame3D rule. The 2D rule + helpers stay in place until the
viz swap lands.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: SierpinskiPyramid scaffold — config, schema, registers in mod tree

**Files:**
- Create: `crates/viz-core/src/visualizations/sierpinski_pyramid.rs`
- Modify: `crates/viz-core/src/visualizations/mod.rs` (add module — keep `sierpinski_triangle` until cleanup)

Create the new viz file with the full config struct, `ConfigSchema` impl, and a `Visualization` impl whose `render()` just clears the background. The next three tasks (6–8) flesh out the render pipeline. The engine still uses `SierpinskiTriangle` at this point — Task 9 swaps it.

### Step 5.1: Write the failing tests

- [ ] Create `crates/viz-core/src/visualizations/sierpinski_pyramid.rs` with just the test module:

```rust
//! 3D Sierpinski tetrahedron visualization. Renders the 4 corners, the chaos
//! game trail (tinted per corner), the per-substep guide line + current
//! position dot, and a turntable camera that auto-rotates and accepts
//! pointer drags for orbit.

// (struct/impl follow in Step 5.3.)

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::ConfigSchema;

    #[test]
    fn defaults_round_trip() {
        let v: SierpinskiPyramidVizConfig =
            serde_json::from_value(SierpinskiPyramidVizConfig::defaults()).unwrap();
        assert!((v.padding - 0.1).abs() < 1e-6);
        assert_eq!(v.trail_size_px, 3.5);
        assert_eq!(v.corner_colors.len(), 4);
        assert!(v.auto_rotate_speed > 0.0);
        assert!((0.0..=1.0).contains(&v.trail_tint));
    }

    #[test]
    fn schema_lists_all_required_fields() {
        let schema = SierpinskiPyramidVizConfig::schema();
        let required = schema["required"].as_array().expect("required array");
        // background, edge_color, corner_colors, corner_highlight_color,
        // corner_size_px, trail_color, trail_tint, trail_size_px,
        // current_color, current_size_px, guide_color, burn_in_iterations,
        // auto_rotate_speed, padding = 14 fields.
        assert_eq!(required.len(), 14);
    }
}
```

- [ ] Update `crates/viz-core/src/visualizations/mod.rs`:

```rust
pub mod color_cycle;
pub mod dots_on_circle;
pub mod sierpinski_pyramid;
pub mod sierpinski_triangle;
```

### Step 5.2: Run tests to verify they fail

- [ ] Run: `cargo test -p viz-core sierpinski_pyramid --lib`
- [ ] Expected: compile errors — `SierpinskiPyramidVizConfig` undefined.

### Step 5.3: Implement scaffold

- [ ] Replace the contents of `crates/viz-core/src/visualizations/sierpinski_pyramid.rs` with:

```rust
//! 3D Sierpinski tetrahedron visualization. Renders the 4 corners, the chaos
//! game trail (tinted per corner), the per-substep guide line + current
//! position dot, and a turntable camera that auto-rotates and accepts
//! pointer drags for orbit.

use serde::{Deserialize, Serialize};
use web_sys::WebGl2RenderingContext;

use crate::config::{color_property, number_property, ConfigSchema, NumberOpts};
use crate::render::{Camera3D, InstancedPoints3D, LineBatch3D};
use crate::rules::sierpinski_chaos::ChaosGameState3D;
use crate::traits::{InputEvent, Visualization};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SierpinskiPyramidVizConfig {
    pub background: [f32; 4],
    pub edge_color: [f32; 4],

    /// One color per corner. Used both for the corner anchor dot and as
    /// the tint applied to trail dots that landed halfway toward it.
    pub corner_colors: [[f32; 4]; 4],
    pub corner_highlight_color: [f32; 4],
    pub corner_size_px: f32,

    pub trail_color: [f32; 4],
    /// 0.0 = trail dots are monochrome (trail_color);
    /// 1.0 = trail dots are pure corner_colors[k].
    pub trail_tint: f32,
    pub trail_size_px: f32,

    pub current_color: [f32; 4],
    pub current_size_px: f32,

    pub guide_color: [f32; 4],
    pub burn_in_iterations: u32,

    /// Radians/sec. 0 stops the auto-spin; default 0.25 ≈ 25s per revolution.
    pub auto_rotate_speed: f32,
    pub padding: f32,
}

impl Default for SierpinskiPyramidVizConfig {
    fn default() -> Self {
        Self {
            background: [0.07, 0.07, 0.09, 1.0],
            edge_color: [0.55, 0.55, 0.60, 0.8],
            corner_colors: [
                [0.30, 0.85, 0.95, 1.0], // cyan
                [0.95, 0.45, 0.85, 1.0], // magenta
                [0.98, 0.78, 0.30, 1.0], // amber
                [0.55, 0.90, 0.45, 1.0], // lime
            ],
            corner_highlight_color: [1.00, 0.98, 0.85, 1.0],
            corner_size_px: 10.0,
            trail_color: [0.65, 0.85, 0.95, 1.0],
            trail_tint: 0.65,
            trail_size_px: 3.5,
            current_color: [0.95, 0.55, 0.35, 1.0],
            current_size_px: 7.0,
            guide_color: [0.95, 0.75, 0.35, 0.55],
            burn_in_iterations: 20,
            auto_rotate_speed: 0.25,
            padding: 0.1,
        }
    }
}

impl ConfigSchema for SierpinskiPyramidVizConfig {
    fn schema() -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "background":               color_property("Background",              [0.07, 0.07, 0.09, 1.0]),
                "edge_color":               color_property("Tetrahedron edge color",  [0.55, 0.55, 0.60, 0.8]),
                "corner_colors": {
                    "type": "array",
                    "title": "Corner colors (4)",
                    "minItems": 4,
                    "maxItems": 4,
                    "items": color_property("Corner color", [0.30, 0.85, 0.95, 1.0]),
                },
                "corner_highlight_color":   color_property("Highlighted corner color", [1.00, 0.98, 0.85, 1.0]),
                "corner_size_px": number_property(NumberOpts {
                    label: "Corner dot size (px)",
                    default: 10.0, min: 1.0, max: 30.0, step: 0.5,
                    integer: false, cosmetic: true, widget: None,
                }),
                "trail_color":              color_property("Trail base color",        [0.65, 0.85, 0.95, 1.0]),
                "trail_tint": number_property(NumberOpts {
                    label: "Per-corner trail tint (0 mono → 1 full)",
                    default: 0.65, min: 0.0, max: 1.0, step: 0.05,
                    integer: false, cosmetic: true, widget: None,
                }),
                "trail_size_px": number_property(NumberOpts {
                    label: "Trail dot size (px)",
                    default: 3.5, min: 0.5, max: 20.0, step: 0.1,
                    integer: false, cosmetic: true, widget: None,
                }),
                "current_color":            color_property("Current dot color",       [0.95, 0.55, 0.35, 1.0]),
                "current_size_px": number_property(NumberOpts {
                    label: "Current dot size (px)",
                    default: 7.0, min: 0.5, max: 20.0, step: 0.1,
                    integer: false, cosmetic: true, widget: None,
                }),
                "guide_color":              color_property("Guide line color",        [0.95, 0.75, 0.35, 0.55]),
                "burn_in_iterations": number_property(NumberOpts {
                    label: "Skip first N iterations (burn-in)",
                    default: 20.0, min: 0.0, max: 1000.0, step: 1.0,
                    integer: true, cosmetic: true, widget: None,
                }),
                "auto_rotate_speed": number_property(NumberOpts {
                    label: "Auto-rotate speed (rad/s, 0 = stop)",
                    default: 0.25, min: 0.0, max: 3.0, step: 0.05,
                    integer: false, cosmetic: true, widget: None,
                }),
                "padding": number_property(NumberOpts {
                    label: "Padding (unused — fit handled by camera distance)",
                    default: 0.1, min: 0.0, max: 1.0, step: 0.01,
                    integer: false, cosmetic: true, widget: None,
                }),
            },
            "required": [
                "background", "edge_color",
                "corner_colors", "corner_highlight_color", "corner_size_px",
                "trail_color", "trail_tint", "trail_size_px",
                "current_color", "current_size_px",
                "guide_color", "burn_in_iterations",
                "auto_rotate_speed", "padding"
            ],
        })
    }

    fn defaults() -> serde_json::Value {
        serde_json::to_value(SierpinskiPyramidVizConfig::default()).unwrap()
    }
}

const BASE_CAMERA_DISTANCE: f32 = 2.5;

pub struct SierpinskiPyramid {
    camera: Camera3D,
    /// Accumulated by tick(dt); drives the auto-spin around the Y axis.
    auto_azimuth: f32,
    /// User-controlled offset from drag. Added to auto_azimuth at render time.
    azimuth_offset: f32,
    /// User-controlled elevation. Clamped at the poles inside Camera3D.
    elevation: f32,
    is_dragging: bool,
    /// 1.0 = default fit; >1 zooms in (camera distance shrinks).
    zoom: f32,
    points: Option<InstancedPoints3D>,
    lines: Option<LineBatch3D>,
}

impl SierpinskiPyramid {
    pub fn new() -> Self {
        let mut camera = Camera3D::new();
        camera.distance = BASE_CAMERA_DISTANCE;
        Self {
            camera,
            // Start with a 30° azimuth + slight downward tilt so the first
            // frame shows three faces rather than a flat profile.
            auto_azimuth: std::f32::consts::FRAC_PI_6,
            azimuth_offset: 0.0,
            elevation: -0.35,
            is_dragging: false,
            zoom: 1.0,
            points: None,
            lines: None,
        }
    }

    fn ensure_resources(&mut self, gl: &WebGl2RenderingContext) -> Result<(), String> {
        if self.points.is_none() { self.points = Some(InstancedPoints3D::new(gl)?); }
        if self.lines.is_none()  { self.lines  = Some(LineBatch3D::new(gl)?); }
        Ok(())
    }
}

impl Default for SierpinskiPyramid {
    fn default() -> Self { Self::new() }
}

impl Visualization for SierpinskiPyramid {
    type Config = SierpinskiPyramidVizConfig;
    type State = ChaosGameState3D;

    fn id(&self) -> &'static str { "sierpinski-pyramid" }

    fn init(&mut self, gl: &WebGl2RenderingContext, _cfg: &Self::Config) {
        let _ = self.ensure_resources(gl);
    }

    fn render(
        &mut self,
        gl: &WebGl2RenderingContext,
        _state: &Self::State,
        cfg: &Self::Config,
    ) {
        if self.ensure_resources(gl).is_err() { return; }

        // Background only for now — edges/dots/etc land in Tasks 6–8.
        gl.clear_color(cfg.background[0], cfg.background[1], cfg.background[2], cfg.background[3]);
        gl.clear(WebGl2RenderingContext::COLOR_BUFFER_BIT | WebGl2RenderingContext::DEPTH_BUFFER_BIT);
    }

    fn resize(&mut self, gl: &WebGl2RenderingContext, w: u32, h: u32) {
        self.camera.resize(w, h);
        gl.viewport(0, 0, w as i32, h as i32);
    }

    fn set_zoom(&mut self, zoom: f32) {
        self.zoom = zoom.clamp(0.25, 20.0);
    }

    fn tick(&mut self, _dt: f32) {
        // Auto-rotate wires up in Task 8.
    }

    fn handle_input(&mut self, _ev: &InputEvent) {
        // Drag wires up in Task 8.
    }
}
```

### Step 5.4: Run tests to verify they pass

- [ ] Run: `cargo test -p viz-core sierpinski_pyramid --lib`
- [ ] Expected: both tests pass.
- [ ] Run: `cargo test --workspace` — workspace stays green.

### Step 5.5: Commit

- [ ] `git add crates/viz-core/src/visualizations/sierpinski_pyramid.rs crates/viz-core/src/visualizations/mod.rs`
- [ ] Commit:

```bash
git commit -m "$(cat <<'EOF'
feat(viz): SierpinskiPyramid scaffold (config + schema + stub render)

Full config struct (4 corner colors, trail_tint, auto_rotate_speed),
ConfigSchema impl, and a Visualization stub that just clears the
background. Edges/dots/orbit wire up in the next tasks; engine still
uses SierpinskiTriangle until Task 9.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Pyramid render — tetrahedron edges + 4 corner dots

**Files:**
- Modify: `crates/viz-core/src/visualizations/sierpinski_pyramid.rs`

Replace the placeholder `render()` so it draws the 6 edges of the tetrahedron in `edge_color` and the 4 corner dots in `corner_colors`, with `corner_highlight_color` applied to the picked corner during a substep. Enable depth-test so closer geometry occludes farther.

This is a render-only change; no new tests. We confirm with the browser smoke test in Task 10. Local sanity check: `cargo build --target wasm32-unknown-unknown` + workspace tests.

### Step 6.1: Implement edges + corner dots in render()

- [ ] In `crates/viz-core/src/visualizations/sierpinski_pyramid.rs`, replace the `fn render(...)` body with:

```rust
    fn render(
        &mut self,
        gl: &WebGl2RenderingContext,
        state: &Self::State,
        cfg: &Self::Config,
    ) {
        if self.ensure_resources(gl).is_err() { return; }
        let points = self.points.as_mut().unwrap();
        let lines  = self.lines.as_mut().unwrap();

        // Camera placement.
        self.camera.distance = BASE_CAMERA_DISTANCE / self.zoom.max(0.1);
        self.camera.azimuth = self.auto_azimuth + self.azimuth_offset;
        self.camera.elevation = self.elevation;
        let vp = self.camera.view_projection();
        let viewport = self.camera.viewport_px;

        // Clear color + depth, enable depth test for occlusion.
        gl.enable(WebGl2RenderingContext::DEPTH_TEST);
        gl.clear_color(cfg.background[0], cfg.background[1], cfg.background[2], cfg.background[3]);
        gl.clear(WebGl2RenderingContext::COLOR_BUFFER_BIT | WebGl2RenderingContext::DEPTH_BUFFER_BIT);

        // ---- Edges: 6 segments connecting every pair of corners. ----
        let mut line_verts: Vec<LineVertex3D> = Vec::with_capacity(12);
        for i in 0..4 {
            for j in (i + 1)..4 {
                line_verts.push(LineVertex3D { position: CORNERS_3D[i], color: cfg.edge_color });
                line_verts.push(LineVertex3D { position: CORNERS_3D[j], color: cfg.edge_color });
            }
        }
        lines.upload(gl, &line_verts);
        lines.draw(gl, &vp);

        // ---- Corner dots. ----
        let mut points_data: Vec<PointInstance3D> = Vec::with_capacity(4);
        for (i, &corner) in CORNERS_3D.iter().enumerate() {
            let highlighted = state.chosen_corner == Some(i);
            let color = if highlighted { cfg.corner_highlight_color } else { cfg.corner_colors[i] };
            points_data.push(PointInstance3D {
                position: corner,
                color,
                radius_px: cfg.corner_size_px * 0.5,
            });
        }
        points.upload(gl, &points_data);
        points.draw(gl, &vp, viewport);
    }
```

- [ ] Add the missing imports at the top of `sierpinski_pyramid.rs`:

Replace
```rust
use crate::render::{Camera3D, InstancedPoints3D, LineBatch3D};
```
with
```rust
use crate::render::{Camera3D, InstancedPoints3D, LineBatch3D, LineVertex3D, PointInstance3D};
use crate::rules::sierpinski_chaos::{ChaosGameState3D, CORNERS_3D};
```
and **remove** the old `use crate::rules::sierpinski_chaos::ChaosGameState3D;` import so there's no duplicate.

### Step 6.2: Build + run workspace tests

- [ ] Run: `cargo build -p viz-core --target wasm32-unknown-unknown`
- [ ] Run: `cargo test --workspace`
- [ ] Expected: both succeed.

### Step 6.3: Commit

- [ ] `git add crates/viz-core/src/visualizations/sierpinski_pyramid.rs`
- [ ] Commit:

```bash
git commit -m "$(cat <<'EOF'
feat(viz): pyramid renders tetrahedron edges + 4 corner dots

6 edges in edge_color, 4 corner anchors with per-corner colors and
the highlight color applied to the substep-picked corner. Depth test
on so closer geometry occludes farther.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Pyramid render — trail dots with per-corner tint + burn-in

**Files:**
- Modify: `crates/viz-core/src/visualizations/sierpinski_pyramid.rs`

Add the chaos-game trail dots. Apply the conditional burn-in skip (same logic as the 2D viz: only skip past 2× the burn-in count). Tint each dot toward `corner_colors[corner_for_dot[i]]` by `trail_tint`.

### Step 7.1: Extend render() with trail dots

- [ ] In the `render()` method, insert this block **between** the edges section and the corner-dots `points.upload`/`draw` (so trail dots get appended into the same `points_data` vec and one draw call covers everything). The final layout becomes: clear → edges → build `points_data` (trail first, corners last) → upload/draw.

Replace the current corner-dots block:

```rust
        // ---- Corner dots. ----
        let mut points_data: Vec<PointInstance3D> = Vec::with_capacity(4);
        for (i, &corner) in CORNERS_3D.iter().enumerate() {
            let highlighted = state.chosen_corner == Some(i);
            let color = if highlighted { cfg.corner_highlight_color } else { cfg.corner_colors[i] };
            points_data.push(PointInstance3D {
                position: corner,
                color,
                radius_px: cfg.corner_size_px * 0.5,
            });
        }
        points.upload(gl, &points_data);
        points.draw(gl, &vp, viewport);
```

with:

```rust
        // ---- Build the full point list: trail (under) then corners (over). ----
        // The chaos orbit converges onto the Sierpinski set at rate (1/2)^n,
        // so the first ~20 iterations can sit in level-N holes. Skip them
        // only past 2× burn-in so a fresh playthrough at iter=1..20 still
        // shows the dot moving.
        let burn_in = cfg.burn_in_iterations as usize;
        let skip = if state.trail.len() > burn_in * 2 { burn_in } else { 0 };

        let mut points_data: Vec<PointInstance3D> =
            Vec::with_capacity(state.trail.len().saturating_sub(skip) + 4);

        for i in skip..state.trail.len() {
            let p = state.trail[i];
            let corner_idx = *state.corner_for_dot.get(i).unwrap_or(&0) as usize;
            let target = cfg.corner_colors[corner_idx & 0b11];
            let base = cfg.trail_color;
            let t = cfg.trail_tint.clamp(0.0, 1.0);
            let color = [
                base[0] + (target[0] - base[0]) * t,
                base[1] + (target[1] - base[1]) * t,
                base[2] + (target[2] - base[2]) * t,
                base[3] + (target[3] - base[3]) * t,
            ];
            points_data.push(PointInstance3D {
                position: p,
                color,
                radius_px: cfg.trail_size_px * 0.5,
            });
        }

        // Corner anchors over the trail.
        for (i, &corner) in CORNERS_3D.iter().enumerate() {
            let highlighted = state.chosen_corner == Some(i);
            let color = if highlighted { cfg.corner_highlight_color } else { cfg.corner_colors[i] };
            points_data.push(PointInstance3D {
                position: corner,
                color,
                radius_px: cfg.corner_size_px * 0.5,
            });
        }

        points.upload(gl, &points_data);
        points.draw(gl, &vp, viewport);
```

### Step 7.2: Build + workspace tests

- [ ] Run: `cargo build -p viz-core --target wasm32-unknown-unknown`
- [ ] Run: `cargo test --workspace`
- [ ] Expected: both succeed.

### Step 7.3: Commit

- [ ] `git add crates/viz-core/src/visualizations/sierpinski_pyramid.rs`
- [ ] Commit:

```bash
git commit -m "$(cat <<'EOF'
feat(viz): pyramid trail dots tinted per corner with burn-in skip

Each trail dot blends from trail_color toward its corner color by
trail_tint. Burn-in skip activates only after the trail is at least
2× the burn-in length so the first few iterations still animate.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Pyramid render — substep visuals (guide line + current dot) + auto-rotate + drag-to-orbit

**Files:**
- Modify: `crates/viz-core/src/visualizations/sierpinski_pyramid.rs`

Three additions to round out the viz:
1. Per-iteration **guide line** from the previous trail point to the chosen corner (`guide_color`).
2. **Current-position dot** from `state.current_position` (the lerping in-flight dot).
3. **`tick(dt)`** wires up auto-rotate; **`handle_input`** wires up drag-to-orbit.

### Step 8.1: Add guide line + current dot to render()

- [ ] In `crates/viz-core/src/visualizations/sierpinski_pyramid.rs`, **inside `render()`**, immediately after the `lines.upload(gl, &line_verts); lines.draw(gl, &vp);` block from Task 6, replace with this version that appends the guide line before drawing:

Replace
```rust
        // ---- Edges: 6 segments connecting every pair of corners. ----
        let mut line_verts: Vec<LineVertex3D> = Vec::with_capacity(12);
        for i in 0..4 {
            for j in (i + 1)..4 {
                line_verts.push(LineVertex3D { position: CORNERS_3D[i], color: cfg.edge_color });
                line_verts.push(LineVertex3D { position: CORNERS_3D[j], color: cfg.edge_color });
            }
        }
        lines.upload(gl, &line_verts);
        lines.draw(gl, &vp);
```

with

```rust
        // ---- Edges (6 segments) + optional guide line (1 segment). ----
        let mut line_verts: Vec<LineVertex3D> = Vec::with_capacity(14);
        for i in 0..4 {
            for j in (i + 1)..4 {
                line_verts.push(LineVertex3D { position: CORNERS_3D[i], color: cfg.edge_color });
                line_verts.push(LineVertex3D { position: CORNERS_3D[j], color: cfg.edge_color });
            }
        }
        if let Some(corner_idx) = state.chosen_corner {
            // Start point: the most recent trail dot (or the initial position
            // if no iterations have completed). End point: the picked corner.
            let start = state.trail.last().copied().unwrap_or(state.initial_position);
            line_verts.push(LineVertex3D { position: start,                  color: cfg.guide_color });
            line_verts.push(LineVertex3D { position: CORNERS_3D[corner_idx], color: cfg.guide_color });
        }
        lines.upload(gl, &line_verts);
        lines.draw(gl, &vp);
```

- [ ] At the **very end of `render()`** (after the existing corner-anchor loop, before `points.upload(gl, &points_data)`), append the current-position dot:

```rust
        if let Some(p) = state.current_position {
            points_data.push(PointInstance3D {
                position: p,
                color: cfg.current_color,
                radius_px: cfg.current_size_px * 0.5,
            });
        }
```

So the final tail of `render()` reads:

```rust
        // Corner anchors over the trail.
        for (i, &corner) in CORNERS_3D.iter().enumerate() {
            let highlighted = state.chosen_corner == Some(i);
            let color = if highlighted { cfg.corner_highlight_color } else { cfg.corner_colors[i] };
            points_data.push(PointInstance3D {
                position: corner,
                color,
                radius_px: cfg.corner_size_px * 0.5,
            });
        }

        if let Some(p) = state.current_position {
            points_data.push(PointInstance3D {
                position: p,
                color: cfg.current_color,
                radius_px: cfg.current_size_px * 0.5,
            });
        }

        points.upload(gl, &points_data);
        points.draw(gl, &vp, viewport);
    }
```

### Step 8.2: Wire up tick + handle_input

- [ ] Replace the placeholder `fn tick(&mut self, _dt: f32) {}` with:

```rust
    fn tick(&mut self, dt: f32) {
        // Auto-rotate always advances. Drag adds an offset on top — it does
        // not pause the auto-spin.
        // (auto_rotate_speed is plumbed through render() via the config; we
        //  store the latest value here so tick can use it even between frames
        //  where render hasn't run. Simpler approach: have render() handle
        //  the dt and skip tick — but the engine calls tick(dt) before
        //  render(), so we let render() do the integration using a stored
        //  speed. See render() where we set self.auto_azimuth.)
        let _ = dt; // see render() for the actual integration
    }
```

Wait — to keep `tick(dt)` doing the time integration (which the engine calls before `render()`), we need access to `cfg.auto_rotate_speed`, but `tick()` doesn't see the config. Cleanest fix: cache the latest config'd speed in the struct and integrate inside `tick`. Update accordingly:

- [ ] Add a field to the struct (in the `pub struct SierpinskiPyramid { ... }` block):

```rust
    /// Cached from the last `render()` call so `tick(dt)` can integrate
    /// without seeing the config. Set every frame in `render()`.
    cached_auto_speed: f32,
```

- [ ] Add the initializer in `SierpinskiPyramid::new()`:

```rust
            cached_auto_speed: 0.25,
```

(Right alongside the other fields.)

- [ ] Update `tick`:

```rust
    fn tick(&mut self, dt: f32) {
        // Auto-rotate always advances. Drag adds an offset on top — it
        // does not pause the auto-spin.
        self.auto_azimuth += self.cached_auto_speed * dt;
    }
```

- [ ] In `render()`, add this line right after the `self.camera.distance = ...` line:

```rust
        self.cached_auto_speed = cfg.auto_rotate_speed;
```

- [ ] Replace the placeholder `fn handle_input(&mut self, _ev: &InputEvent) {}` with:

```rust
    fn handle_input(&mut self, ev: &InputEvent) {
        match ev {
            InputEvent::PointerDown { .. } => {
                self.is_dragging = true;
            }
            InputEvent::PointerMove { dx, dy, buttons, .. } => {
                // Primary button held (bit 0) — drag to orbit.
                if *buttons & 1 != 0 {
                    self.is_dragging = true;
                    self.camera.azimuth = 0.0;
                    self.camera.elevation = 0.0;
                    // We track the offset on the viz, not the camera, so the
                    // auto-spin can keep accumulating. Apply the drag delta
                    // directly to azimuth_offset/elevation here and let
                    // render() compose them with auto_azimuth before
                    // setting camera.azimuth/elevation.
                    self.azimuth_offset += *dx * 0.005;
                    self.elevation = (self.elevation + *dy * 0.005)
                        .clamp(
                            -std::f32::consts::FRAC_PI_2 + 0.01,
                            std::f32::consts::FRAC_PI_2 - 0.01,
                        );
                }
            }
            InputEvent::PointerUp { .. } => {
                self.is_dragging = false;
            }
            _ => {}
        }
    }
```

Note: the two lines `self.camera.azimuth = 0.0; self.camera.elevation = 0.0;` inside the match are scratchpad-clearing — they don't matter visually because `render()` overwrites them every frame, but they reflect that we treat `Camera3D::azimuth/elevation` as ephemeral, derived from `auto_azimuth + azimuth_offset` / `elevation` at render time. You can remove them if preferred; they're a noop.

Actually — they *are* a noop and just noise. **Remove them**. The final `handle_input` reads:

```rust
    fn handle_input(&mut self, ev: &InputEvent) {
        match ev {
            InputEvent::PointerDown { .. } => {
                self.is_dragging = true;
            }
            InputEvent::PointerMove { dx, dy, buttons, .. } => {
                if *buttons & 1 != 0 {
                    self.is_dragging = true;
                    self.azimuth_offset += *dx * 0.005;
                    self.elevation = (self.elevation + *dy * 0.005)
                        .clamp(
                            -std::f32::consts::FRAC_PI_2 + 0.01,
                            std::f32::consts::FRAC_PI_2 - 0.01,
                        );
                }
            }
            InputEvent::PointerUp { .. } => {
                self.is_dragging = false;
            }
            _ => {}
        }
    }
```

### Step 8.3: Build + workspace tests

- [ ] Run: `cargo build -p viz-core --target wasm32-unknown-unknown`
- [ ] Run: `cargo test --workspace`
- [ ] Expected: both succeed.

### Step 8.4: Commit

- [ ] `git add crates/viz-core/src/visualizations/sierpinski_pyramid.rs`
- [ ] Commit:

```bash
git commit -m "$(cat <<'EOF'
feat(viz): pyramid substep visuals + auto-rotate + drag-to-orbit

Guide line from the previous trail point to the picked corner during
substep, current-position dot for in-flight animation. tick(dt) drives
the auto-spin around Y using a cached speed; handle_input applies
pointer-drag deltas as an azimuth offset + elevation (clamped to avoid
gimbal flip).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Engine swap — wire `ChaosGame3D` + `SierpinskiPyramid` as defaults

**Files:**
- Modify: `crates/viz-core/src/engine/mod.rs`

Swap the hardwired rule + viz the engine instantiates. This is where the user-visible behavior switches over.

### Step 9.1: Update engine imports and defaults

- [ ] In `crates/viz-core/src/engine/mod.rs`, change the two `use` lines that import the rule and viz:

Replace
```rust
use crate::rules::sierpinski_chaos::{ChaosGameConfig, SierpinskiChaos};
use crate::traits::InputEvent;
use crate::visualizations::sierpinski_triangle::{SierpinskiTriangle, SierpinskiTriangleVizConfig};
```

with
```rust
use crate::rules::sierpinski_chaos::{ChaosGame3D, ChaosGameConfig};
use crate::traits::InputEvent;
use crate::visualizations::sierpinski_pyramid::{SierpinskiPyramid, SierpinskiPyramidVizConfig};
```

- [ ] Inside `Engine::new()`, replace
```rust
        let rule_cfg = ChaosGameConfig::defaults();
        let viz_cfg = SierpinskiTriangleVizConfig::defaults();
        let max_iter = serde_json::from_value::<ChaosGameConfig>(rule_cfg.clone())
            .map(|c| c.max_iterations)
            .unwrap_or(50_000);

        let rule: Box<dyn ErasedRule> = Box::new(SierpinskiChaos);
        let mut viz: Box<dyn ErasedVisualization> = Box::new(SierpinskiTriangle::new());
```

with
```rust
        let rule_cfg = ChaosGameConfig::defaults();
        let viz_cfg = SierpinskiPyramidVizConfig::defaults();
        let max_iter = serde_json::from_value::<ChaosGameConfig>(rule_cfg.clone())
            .map(|c| c.max_iterations)
            .unwrap_or(50_000);

        let rule: Box<dyn ErasedRule> = Box::new(ChaosGame3D);
        let mut viz: Box<dyn ErasedVisualization> = Box::new(SierpinskiPyramid::new());
```

- [ ] Search the file for any **other** mentions of `SierpinskiChaos`, `SierpinskiTriangle`, or `SierpinskiTriangleVizConfig` and update accordingly. (At time of writing, the doc comment above `Engine::new` mentions phases; you can leave that copy as-is or update it. Optional.)

### Step 9.2: Rebuild the WASM package + workspace tests

- [ ] Run: `wasm-pack build crates/viz-core --target web --out-dir pkg`
- [ ] Expected: build succeeds.
- [ ] Run: `cargo test --workspace`
- [ ] Expected: pass.

### Step 9.3: Commit

- [ ] `git add crates/viz-core/src/engine/mod.rs crates/viz-core/pkg`

(If `pkg/` is gitignored — check `.gitignore` first; if so, don't add it.)

- [ ] Commit:

```bash
git commit -m "$(cat <<'EOF'
feat(engine): swap to ChaosGame3D + SierpinskiPyramid as defaults

The Sierpinski triangle (2D) is now the rotating Sierpinski
tetrahedron (3D). The 2D rule/viz remain in the codebase pending
cleanup in the next-to-last task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Web shell — canvas pointer events + info-panel copy

**Files:**
- Modify: `web/src/App.svelte`

Add `pointerdown` / `pointermove` / `pointerup` / `pointercancel` / `pointerleave` handlers on the canvas that build `InputEvent` payloads and pass them to `engine.forward_input(...)`. Use `setPointerCapture` on `pointerdown` so drags survive briefly leaving the canvas. Add `touch-action: none` to the canvas CSS so single-finger touch drags rotate the camera instead of scrolling. Update the info-panel copy to describe the 3D chaos game and the drag-to-orbit interaction.

### Step 10.1: Add pointer handlers + state

- [ ] In `web/src/App.svelte`, find the `<canvas>` element. Add `onpointerdown`, `onpointermove`, `onpointerup`, `onpointercancel`, and `onpointerleave` handlers. Near the existing engine wiring (where `engine` is declared via `$state` or the import + `new Engine(...)` pattern), add a `let lastPointer: { x: number; y: number } | null = null;` so we can compute `dx/dy` between pointermoves.

The handlers should call `engine.forward_input({...})`. Build the events to match the Rust `InputEvent` shape (see `crates/viz-core/src/traits.rs`):

```ts
function pointerEventCommon(e: PointerEvent) {
  const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
    button: e.button,
    buttons: e.buttons,
  };
}

function onCanvasPointerDown(e: PointerEvent) {
  (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
  const c = pointerEventCommon(e);
  lastPointer = { x: c.x, y: c.y };
  engine?.forward_input({ kind: 'PointerDown', x: c.x, y: c.y, button: c.button });
}

function onCanvasPointerMove(e: PointerEvent) {
  const c = pointerEventCommon(e);
  const dx = lastPointer ? c.x - lastPointer.x : 0;
  const dy = lastPointer ? c.y - lastPointer.y : 0;
  lastPointer = { x: c.x, y: c.y };
  engine?.forward_input({
    kind: 'PointerMove',
    x: c.x, y: c.y, dx, dy, buttons: c.buttons,
  });
}

function onCanvasPointerUp(e: PointerEvent) {
  const c = pointerEventCommon(e);
  lastPointer = null;
  try {
    (e.currentTarget as HTMLCanvasElement).releasePointerCapture(e.pointerId);
  } catch { /* not captured — ignore */ }
  engine?.forward_input({ kind: 'PointerUp', x: c.x, y: c.y, button: c.button });
}
```

- [ ] Bind them on the `<canvas>`:

```svelte
<canvas
  id="viz-canvas"
  bind:this={canvas}
  onpointerdown={onCanvasPointerDown}
  onpointermove={onCanvasPointerMove}
  onpointerup={onCanvasPointerUp}
  onpointercancel={onCanvasPointerUp}
  onpointerleave={onCanvasPointerUp}
></canvas>
```

(If the existing canvas has other handlers or props, keep them — just add these five.)

- [ ] In the `<style>` block, find the `canvas` (or `#viz-canvas`) selector and add `touch-action: none;`. If no such selector exists, add:

```css
#viz-canvas {
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
}
```

(Adjust to fit the surrounding rules — don't drop existing properties.)

### Step 10.2: Update info-panel description

- [ ] Find the info-panel description string (the text block inside the `.info` aside that explains the visualization) and replace it with copy that covers:
  - The 3D Sierpinski tetrahedron + chaos game in 4 corners.
  - The dot moving halfway toward a uniformly-picked corner each iteration.
  - Each dot's color = the corner it moved toward.
  - "The pyramid spins on its own — click and drag to rotate it yourself."
  - Use the existing copy style (markdown / prose, whatever's there).

Keep the tone consistent with the surrounding info-panel content. The pre-existing text described the 2D Sierpinski; rewrite it for 3D.

### Step 10.3: Typecheck + run vitest

- [ ] Run: `cd web && npm run check`
- [ ] Expected: 0 errors (or only pre-existing warnings unrelated to this change).
- [ ] Run: `cd web && npm run test`
- [ ] Expected: pass.

### Step 10.4: Manual sanity-check

- [ ] Run: `cd web && npm run dev` and open <http://localhost:5173/>.
- [ ] Confirm the tetrahedron renders, auto-rotates, fills in with corner-tinted dots, and click-drag orbits the camera.

### Step 10.5: Commit

- [ ] `git add web/src/App.svelte`
- [ ] Commit:

```bash
git commit -m "$(cat <<'EOF'
feat(ui): canvas pointer events forward to engine + 3D info copy

pointerdown/move/up/cancel/leave handlers build InputEvent payloads
and call engine.forward_input. setPointerCapture so drags survive
briefly leaving the canvas; touch-action: none so single-finger
touch drags rotate instead of scrolling. Info-panel copy describes
the 3D chaos game.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Cleanup — delete 2D Sierpinski rule + viz, rename 3D types

**Files:**
- Modify: `crates/viz-core/src/rules/sierpinski_chaos.rs` (delete 2D items, rename 3D items)
- Delete: `crates/viz-core/src/visualizations/sierpinski_triangle.rs`
- Modify: `crates/viz-core/src/visualizations/mod.rs` (drop the deleted module)
- Modify: `crates/viz-core/src/engine/mod.rs` (use renamed types)
- Modify: `crates/viz-core/tests/wasm.rs` (any references to old names)

Now that the engine is on 3D, remove the parallel 2D code and rename the 3D types to take their place per the spec ("the file remains `sierpinski_chaos.rs`, the type remains `SierpinskiChaos`").

### Step 11.1: Delete the 2D viz file and its module entry

- [ ] Delete the file `crates/viz-core/src/visualizations/sierpinski_triangle.rs`.
- [ ] Update `crates/viz-core/src/visualizations/mod.rs`:

```rust
pub mod color_cycle;
pub mod dots_on_circle;
pub mod sierpinski_pyramid;
```

### Step 11.2: Remove the 2D rule items + rename 3D items in-place

- [ ] In `crates/viz-core/src/rules/sierpinski_chaos.rs`, do all of the following:

1. **Delete** the 2D `CORNERS: [[f32; 2]; 3]` constant.
2. **Delete** the 2D `ChaosGameState` struct + its `SceneState` impl.
3. **Delete** the 2D `SierpinskiChaos` struct + its `Rule` impl.
4. **Delete** the 2D `halfway`, `lerp`, `pick_corner`, `random_inside_triangle` helpers.
5. **Delete** every 2D test case under `#[cfg(test)] mod tests` — specifically the ones whose names reference `triangle`, `pick_corner_distribution_is_roughly_uniform` (the 3-corner one), `initial_position_is_inside_triangle`, `advance_to_is_deterministic` (2D), `advance_to_is_jump_safe` (2D), `trail_length_matches_iterations_and_clamps` (2D), `substep_highlights_corner_then_moves_dot` (2D), `substep_at_or_past_max_clears_animation` (2D), `halfway_is_the_midpoint` (2D), and the `point_in_triangle` helper.
6. **Rename**:
   - `CORNERS_3D` → `CORNERS`
   - `halfway_3d` → `halfway`
   - `lerp_3d` → `lerp`
   - `pick_corner_4` → `pick_corner`
   - `random_inside_tetrahedron` → `random_inside_tetrahedron` (unchanged — the name describes the shape, not the dimension)
   - `ChaosGameState3D` → `ChaosGameState`
   - `ChaosGame3D` → `SierpinskiChaos`
   - Inside renamed tests: rename `rule_3d_advance_to_is_deterministic` → `advance_to_is_deterministic`, similar for the others. The 3D versions become the canonical tests.

Also keep the existing top-level doc comment but update it to describe the 4-corner tetrahedron rather than the 3-corner triangle. Suggested replacement for the first 3 doc lines:

```rust
//! Sierpinski Chaos Game (3D): pick one of four tetrahedron corners
//! uniformly at random, move halfway toward it, drop a dot, repeat.
//! Thousands of dots converge on the Sierpinski-tetrahedron attractor.
//!
//! Per-iteration RNG = `splitmix64(seed ^ iter)`. `advance_to(n)` is O(n);
//! cheap enough for the cheap-recompute path.
```

7. **Trail-length test:** add this test back (we deleted its 2D version) to ensure clamping still works:

```rust
    #[test]
    fn trail_length_matches_iterations_and_clamps() {
        let rule = SierpinskiChaos;
        let cfg = ChaosGameConfig { max_iterations: 50 };
        let mut state = rule.init(&cfg, 0);
        rule.advance_to(&mut state, &cfg, 7, 50);
        assert_eq!(state.trail.len(), 50);
        rule.advance_to(&mut state, &cfg, 7, 999);
        assert_eq!(state.trail.len(), 50, "advance past max should clamp");
    }

    #[test]
    fn substep_at_or_past_max_clears_animation() {
        let rule = SierpinskiChaos;
        let cfg = ChaosGameConfig { max_iterations: 5 };
        let mut state = rule.init(&cfg, 0);
        rule.advance_to(&mut state, &cfg, 0, 5);
        rule.substep(&mut state, &cfg, 0, 5, 0.5);
        assert!(state.chosen_corner.is_none());
    }
```

### Step 11.3: Update engine to use renamed types

- [ ] In `crates/viz-core/src/engine/mod.rs`, change:

```rust
use crate::rules::sierpinski_chaos::{ChaosGame3D, ChaosGameConfig};
```
to
```rust
use crate::rules::sierpinski_chaos::{ChaosGameConfig, SierpinskiChaos};
```

- [ ] Change the `let rule: Box<dyn ErasedRule> = Box::new(ChaosGame3D);` line to `Box::new(SierpinskiChaos);`.

### Step 11.4: Update `sierpinski_pyramid.rs` to use renamed types

- [ ] In `crates/viz-core/src/visualizations/sierpinski_pyramid.rs`, change:

```rust
use crate::render::{Camera3D, InstancedPoints3D, LineBatch3D, LineVertex3D, PointInstance3D};
use crate::rules::sierpinski_chaos::{ChaosGameState3D, CORNERS_3D};
```
to
```rust
use crate::render::{Camera3D, InstancedPoints3D, LineBatch3D, LineVertex3D, PointInstance3D};
use crate::rules::sierpinski_chaos::{ChaosGameState, CORNERS};
```

- [ ] In the `Visualization` impl, change `type State = ChaosGameState3D;` to `type State = ChaosGameState;`.

- [ ] Search-and-replace `CORNERS_3D` → `CORNERS` inside this file.

### Step 11.5: Update browser test references (if any)

- [ ] Open `crates/viz-core/tests/wasm.rs` and ensure none of the existing tests reference `SierpinskiTriangle` or `ChaosGame3D` by name. (The current tests reference `Engine` only, so this is probably a no-op — verify by grep.)

### Step 11.6: Build, run all gates

- [ ] Run: `cargo test --workspace`
- [ ] Expected: pass.
- [ ] Run: `wasm-pack build crates/viz-core --target web --out-dir pkg`
- [ ] Expected: build succeeds.
- [ ] Run: `wasm-pack test --chrome --headless crates/viz-core`
- [ ] Expected: all browser tests pass.
- [ ] Run: `cd web && npm run check && npm run test`
- [ ] Expected: 0 errors, tests pass.

### Step 11.7: Commit

- [ ] Run `git status` first to confirm the deletion of `sierpinski_triangle.rs` is staged.
- [ ] `git add -A crates/viz-core/src crates/viz-core/tests web` (only the relevant subdirs; do not blindly `git add .`).
- [ ] Commit:

```bash
git commit -m "$(cat <<'EOF'
refactor: drop 2D Sierpinski types; rename 3D types to canonical names

The 3D tetrahedron is now the canonical Sierpinski rule/viz. Delete the
2D ChaosGameState/SierpinskiChaos/CORNERS + sierpinski_triangle.rs viz;
rename ChaosGame3D → SierpinskiChaos, ChaosGameState3D → ChaosGameState,
CORNERS_3D → CORNERS, halfway_3d → halfway, lerp_3d → lerp,
pick_corner_4 → pick_corner. Engine and viz updated to reference the
new names.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Final acceptance — README + browser test for new schema fields

**Files:**
- Modify: `crates/viz-core/tests/wasm.rs` (add assertions for the new viz schema)
- Modify: `README.md` (update the status line)

### Step 12.1: Add browser test for new viz schema fields

- [ ] Append to `crates/viz-core/tests/wasm.rs`:

```rust
#[wasm_bindgen_test]
fn default_viz_schema_has_3d_pyramid_fields() {
    make_canvas("test-canvas-pyramid-schema");
    let engine = Engine::new("test-canvas-pyramid-schema").expect("engine constructs");

    let schema = engine.viz_schema();
    let props = js_sys::Reflect::get(&schema, &JsValue::from_str("properties"))
        .expect("properties field");
    for name in ["corner_colors", "auto_rotate_speed", "trail_tint", "edge_color"] {
        let p = js_sys::Reflect::get(&props, &JsValue::from_str(name))
            .unwrap_or_else(|_| panic!("missing property {name}"));
        assert!(!p.is_undefined() && !p.is_null(), "property {name} present");
    }
}

#[wasm_bindgen_test]
fn engine_forwards_pointer_events_without_error() {
    make_canvas("test-canvas-pointer");
    let mut engine = Engine::new("test-canvas-pointer").expect("engine constructs");

    let down = js_sys::JSON::parse(r#"{"kind":"PointerDown","x":10.0,"y":10.0,"button":0}"#).unwrap();
    engine.forward_input(down).expect("PointerDown forwards");

    let move_ev = js_sys::JSON::parse(
        r#"{"kind":"PointerMove","x":15.0,"y":12.0,"dx":5.0,"dy":2.0,"buttons":1}"#
    ).unwrap();
    engine.forward_input(move_ev).expect("PointerMove forwards");

    let up = js_sys::JSON::parse(r#"{"kind":"PointerUp","x":15.0,"y":12.0,"button":0}"#).unwrap();
    engine.forward_input(up).expect("PointerUp forwards");
}
```

### Step 12.2: Update README status line

- [ ] Open `README.md`. Find the status paragraph that starts `> **Status:** Phase 3 — the Sierpinski Chaos Game visualization.` and replace it with:

```markdown
> **Status:** Phase 3 (3D) — a rotating Sierpinski tetrahedron. Four corners
> of a regular tetrahedron, a deterministic seeded starting point, and each
> iteration moves halfway toward a uniformly-picked corner; thousands of dots
> converge on the 3D Sierpinski attractor. The tetrahedron auto-spins around
> its vertical axis — click-drag the canvas to orbit. Each dot is tinted by
> which corner produced it, making the four self-similar sub-tetrahedra
> visually distinct. The midpoint-on-circle rule and Phase 2 ColorCycle rule
> remain in the codebase as alternative working examples (Phase 4's selector
> UI will let you switch between them). See [`docs/superpowers/specs/`](docs/superpowers/specs/)
> for the design and [`docs/superpowers/plans/`](docs/superpowers/plans/) for
> execution plans.
```

(Leave the rest of the README untouched.)

### Step 12.3: Run all gates

- [ ] Run: `cargo test --workspace`
- [ ] Expected: pass.
- [ ] Run: `wasm-pack build crates/viz-core --target web --out-dir pkg`
- [ ] Expected: build succeeds.
- [ ] Run: `wasm-pack test --chrome --headless crates/viz-core`
- [ ] Expected: all browser tests pass (including the two added in Step 12.1).
- [ ] Run: `cd web && npm run check`
- [ ] Expected: 0 errors.
- [ ] Run: `cd web && npm run test`
- [ ] Expected: pass.
- [ ] Run: `cd web && npm run build`
- [ ] Expected: clean static build to `web/dist/`.

### Step 12.4: Manual acceptance against the spec

Walk the acceptance checklist from the spec:

- [ ] In the dev server (`cd web && npm run dev`), the tetrahedron renders, auto-rotates, fills in with corner-tinted dots.
- [ ] Click-drag on the canvas orbits the camera; release stops the drag.
- [ ] Zoom buttons in the canvas's upper-left still work.
- [ ] Info panel describes the 3D chaos game.
- [ ] Touch-drag on a phone (or DevTools device mode) rotates the camera without scrolling the page.

### Step 12.5: Commit + push

- [ ] `git add crates/viz-core/tests/wasm.rs README.md`
- [ ] Commit:

```bash
git commit -m "$(cat <<'EOF'
test(wasm): assert 3D viz schema + pointer-event round-trip
docs: README status line describes the 3D tetrahedron flagship

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] `git push origin main`
- [ ] Verify the GitHub Pages workflow republishes the live demo successfully.

---

## Self-review notes (post-write)

A pass for spec coverage / placeholder scan / consistency:

- **Spec coverage:** the 4 spec goals — flagship tetrahedron (Tasks 5–9), per-iteration substep animation (Task 8), auto-rotate + click-drag orbit (Tasks 8, 10), 2D rules still working (cleanup preserves color-cycle + midpoint-on-circle) — each has tasks behind it.
- **Type consistency:** `Camera3D` produces `[f32; 16]` mat4 column-major; `InstancedPoints3D::draw` and `LineBatch3D::draw` both take `&[f32; 16]`; `SierpinskiPyramid::render` calls `self.camera.view_projection()` and passes that result — consistent.
- **`PointInstance3D` field order:** matches the shader stride (3 + 4 + 1 = 8 floats) and `vertex_attrib_pointer_with_i32` byte offsets (`0`, `3*4`, `7*4`).
- **`pick_corner_4 & 0b11`** mask is equivalent to `% 4` for `0..=255`; preferred for clarity.
- **`cached_auto_speed` pattern:** justified inline — the engine calls `tick(dt)` before `render(...)`, so we can integrate in `tick` only if `tick` has access to the speed; caching it during `render` is the simplest workaround that doesn't require changing the `Visualization` trait.
- **Pointer event JSON shape:** matches `enum InputEvent` in `traits.rs` (`{kind, x, y, button|dx,dy,buttons}`); serde tags are `tag = "kind"`.
- **No placeholders / TBDs** in any task body. Every step that changes code shows the exact code.

Plan complete and saved to `docs/superpowers/plans/2026-06-06-sierpinski-3d-tetrahedron.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
