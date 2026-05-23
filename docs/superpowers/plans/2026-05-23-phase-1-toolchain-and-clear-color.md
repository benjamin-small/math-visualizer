# Phase 1: Toolchain + Clear-Color Canvas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the full Rust → WASM → Vite/Svelte → WebGL2 toolchain end-to-end, validated by a Rust-driven canvas clear color that the user can change from a Svelte panel, plus working unit/integration test suites on both sides.

**Architecture:** Cargo workspace containing a single `viz-core` crate compiled to WebAssembly via `wasm-pack`. A `web/` Vite + Svelte (plain, not SvelteKit) app imports the wasm output and instantiates a small `Engine` struct that owns the WebGL2 context and exposes `frame()` / `set_clear_color()`. No domain abstractions yet — those land in Phase 3.

**Tech Stack:** Rust (stable, edition 2024), `wasm-bindgen`, `web-sys`, `wasm-pack`, `wasm-bindgen-test`; TypeScript, Vite 5, Svelte 5, `@sveltejs/vite-plugin-svelte`, `vite-plugin-wasm`, `vite-plugin-top-level-await`; Vitest + `@testing-library/svelte` for component tests.

**Spec reference:** [docs/superpowers/specs/2026-05-23-math-visualizer-foundation-design.md](../specs/2026-05-23-math-visualizer-foundation-design.md), §2 (tech stack), §3 (repo layout), §8 (testing).

---

## File map

Files this plan creates:

```
math-visualizer/
├── Cargo.toml                         # workspace root
├── rust-toolchain.toml                # pin Rust to stable
├── README.md                          # dev/build/test instructions
├── crates/
│   └── viz-core/
│       ├── Cargo.toml
│       ├── src/
│       │   ├── lib.rs                 # wasm-bindgen entry + Engine
│       │   └── engine/
│       │       └── mod.rs             # Engine struct (GL ctx + clear color)
│       └── tests/
│           └── wasm.rs                # wasm-bindgen-test smoke test
└── web/
    ├── package.json
    ├── vite.config.ts
    ├── svelte.config.js
    ├── tsconfig.json
    ├── tsconfig.node.json
    ├── vitest.config.ts
    ├── index.html
    └── src/
        ├── main.ts
        ├── App.svelte                 # canvas + 4 color inputs
        ├── app.css
        ├── vite-env.d.ts
        └── lib/
            ├── wasm/
            │   ├── loader.ts          # wraps the wasm-pack output
            │   └── __tests__/
            │       └── loader.test.ts # vitest smoke test
            └── components/
                └── __tests__/
                    └── App.test.ts    # vitest mount smoke test
```

WASM build output lands in `crates/viz-core/pkg/` (gitignored) and is consumed via a Vite alias to that path.

---

## Task 1: Bootstrap Cargo workspace + viz-core crate

**Files:**
- Create: `Cargo.toml`
- Create: `rust-toolchain.toml`
- Create: `crates/viz-core/Cargo.toml`
- Create: `crates/viz-core/src/lib.rs`

- [ ] **Step 1: Pin the Rust toolchain**

Create `rust-toolchain.toml`:

```toml
[toolchain]
channel = "stable"
components = ["rustfmt", "clippy"]
targets = ["wasm32-unknown-unknown"]
```

- [ ] **Step 2: Create the workspace root Cargo.toml**

Create `Cargo.toml`:

```toml
[workspace]
resolver = "2"
members = ["crates/viz-core"]

[workspace.package]
edition = "2021"
rust-version = "1.80"
license = "MIT OR Apache-2.0"

[profile.release]
opt-level = "z"
lto = true
codegen-units = 1
```

- [ ] **Step 3: Create the viz-core crate manifest**

Create `crates/viz-core/Cargo.toml`:

```toml
[package]
name = "viz-core"
version = "0.1.0"
edition.workspace = true
license.workspace = true

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
```

(Dependencies get added in Task 2.)

- [ ] **Step 4: Write a minimal lib.rs with one inline unit test**

Create `crates/viz-core/src/lib.rs`:

```rust
/// Sanity helper used by the bootstrap test. Removed once we have real code.
pub fn add(a: i32, b: i32) -> i32 {
    a + b
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_works() {
        assert_eq!(add(2, 3), 5);
    }
}
```

- [ ] **Step 5: Verify the workspace builds and the test passes**

Run: `cargo test --workspace`
Expected: `test result: ok. 1 passed; 0 failed`

- [ ] **Step 6: Commit**

```bash
git add Cargo.toml rust-toolchain.toml crates/viz-core/
git commit -m "chore: bootstrap cargo workspace and viz-core crate"
```

---

## Task 2: Add wasm-bindgen dependencies and produce a wasm-pack build

**Files:**
- Modify: `crates/viz-core/Cargo.toml`
- Modify: `crates/viz-core/src/lib.rs`

- [ ] **Step 1: Install wasm-pack (one-time, if missing)**

Run: `wasm-pack --version`
If it errors with "command not found": `cargo install wasm-pack` (or follow the instructions at https://rustwasm.github.io/wasm-pack/installer/).
Expected: `wasm-pack 0.13.x` or higher.

- [ ] **Step 2: Add wasm-bindgen + web-sys dependencies**

Replace the `[dependencies]` block in `crates/viz-core/Cargo.toml` with:

```toml
[dependencies]
wasm-bindgen = "0.2"
js-sys = "0.3"
console_error_panic_hook = "0.1"

[dependencies.web-sys]
version = "0.3"
features = [
    "Window",
    "Document",
    "HtmlCanvasElement",
    "WebGl2RenderingContext",
    "console",
]

[dev-dependencies]
wasm-bindgen-test = "0.3"
```

- [ ] **Step 3: Add a `#[wasm_bindgen]`-exported function**

Replace `crates/viz-core/src/lib.rs` with:

```rust
use wasm_bindgen::prelude::*;

#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}

/// Sanity helper exported to JS so we can prove the binding round-trips.
#[wasm_bindgen]
pub fn add(a: i32, b: i32) -> i32 {
    a + b
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_works() {
        assert_eq!(add(2, 3), 5);
    }
}
```

- [ ] **Step 4: Verify native build still works**

Run: `cargo test --workspace`
Expected: `test result: ok. 1 passed; 0 failed`

- [ ] **Step 5: Build the wasm package**

Run: `wasm-pack build crates/viz-core --target web --out-dir pkg`
Expected: `[INFO]: ✨ Done in <Ns>` and `[INFO]: 📦 Your wasm pkg is ready to publish at <path>/crates/viz-core/pkg`

- [ ] **Step 6: Verify the package output**

Run: `ls crates/viz-core/pkg/`
Expected files (among others): `viz_core.js`, `viz_core_bg.wasm`, `viz_core.d.ts`, `package.json`

- [ ] **Step 7: Commit**

```bash
git add crates/viz-core/Cargo.toml crates/viz-core/src/lib.rs
git commit -m "feat: add wasm-bindgen bindings and produce wasm-pack build"
```

---

## Task 3: Scaffold the Vite + Svelte web app

**Files:**
- Create: `web/package.json`
- Create: `web/tsconfig.json`
- Create: `web/tsconfig.node.json`
- Create: `web/svelte.config.js`
- Create: `web/vite.config.ts`
- Create: `web/index.html`
- Create: `web/src/main.ts`
- Create: `web/src/app.css`
- Create: `web/src/vite-env.d.ts`
- Create: `web/src/App.svelte`

- [ ] **Step 1: Create the web package manifest**

Create `web/package.json`:

```json
{
  "name": "math-visualizer-web",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "check": "svelte-check --tsconfig ./tsconfig.json"
  },
  "devDependencies": {
    "@sveltejs/vite-plugin-svelte": "^4.0.0",
    "@tsconfig/svelte": "^5.0.4",
    "svelte": "^5.0.0",
    "svelte-check": "^4.0.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "vite-plugin-top-level-await": "^1.4.4",
    "vite-plugin-wasm": "^3.3.0",
    "viz-core": "file:../crates/viz-core/pkg"
  }
}
```

The `viz-core` dependency points at the `pkg/` directory produced by `wasm-pack build`. Task 2 must have produced that directory or `npm install` will fail.

- [ ] **Step 2: Create the Svelte config**

Create `web/svelte.config.js`:

```js
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
};
```

- [ ] **Step 3: Create the TypeScript config**

Create `web/tsconfig.json`:

```json
{
  "extends": "@tsconfig/svelte/tsconfig.json",
  "compilerOptions": {
    "target": "ESNext",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "resolveJsonModule": true,
    "allowJs": false,
    "checkJs": false,
    "isolatedModules": true,
    "moduleDetection": "force",
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "allowImportingTsExtensions": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts", "src/**/*.svelte"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

Create `web/tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 4: Create the Vite config (no WASM plugins yet — added in Task 4)**

Create `web/vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
});
```

- [ ] **Step 5: Create the HTML entry**

Create `web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Math Visualizer</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 6: Create app.css and vite-env.d.ts**

Create `web/src/app.css`:

```css
:root {
  font-family: system-ui, -apple-system, sans-serif;
  background: #111;
  color: #eee;
}

* { box-sizing: border-box; }
html, body, #app { height: 100%; margin: 0; }
```

Create `web/src/vite-env.d.ts`:

```ts
/// <reference types="svelte" />
/// <reference types="vite/client" />
```

- [ ] **Step 7: Create a minimal App.svelte**

Create `web/src/App.svelte`:

```svelte
<script lang="ts">
  let message = 'Math Visualizer — Phase 1 scaffolding works.';
</script>

<main>
  <h1>{message}</h1>
</main>

<style>
  main {
    padding: 2rem;
  }
</style>
```

- [ ] **Step 8: Create the Svelte 5 mount entry**

Create `web/src/main.ts`:

```ts
import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';

const target = document.getElementById('app');
if (!target) throw new Error('#app element not found');

const app = mount(App, { target });

export default app;
```

- [ ] **Step 9: Install dependencies**

Run: `cd web && npm install`
Expected: `added <N> packages` with no errors. (If `viz-core` resolution fails, re-run `wasm-pack build crates/viz-core --target web` from the repo root, then `npm install` again.)

- [ ] **Step 10: Verify dev server starts**

Run: `cd web && npm run dev`
Expected: `VITE v5.x.x  ready in <ms>` and a `Local: http://localhost:5173/` URL.
Open the URL in a browser; the heading should render.
Stop the dev server (Ctrl-C).

- [ ] **Step 11: Verify the production build works**

Run: `cd web && npm run build`
Expected: `✓ built in <ms>` and a `dist/` directory.

- [ ] **Step 12: Commit**

```bash
git add web/
git commit -m "feat: scaffold vite + svelte web app"
```

---

## Task 4: Import the WASM module from Svelte and call `add()`

**Files:**
- Modify: `web/vite.config.ts`
- Create: `web/src/lib/wasm/loader.ts`
- Modify: `web/src/App.svelte`

- [ ] **Step 1: Add the WASM Vite plugins**

Replace `web/vite.config.ts` with:

```ts
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
  plugins: [svelte(), wasm(), topLevelAwait()],
  optimizeDeps: {
    exclude: ['viz-core'],
  },
});
```

- [ ] **Step 2: Create the loader module**

Create `web/src/lib/wasm/loader.ts`:

```ts
import init, * as vizCore from 'viz-core';

let initialized: Promise<typeof vizCore> | null = null;

export function loadVizCore(): Promise<typeof vizCore> {
  if (!initialized) {
    initialized = init().then(() => vizCore);
  }
  return initialized;
}

export type VizCore = typeof vizCore;
```

The single-flight pattern guarantees `init()` runs exactly once even if multiple callers race.

- [ ] **Step 3: Use the WASM module from App.svelte**

Replace `web/src/App.svelte` with:

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { loadVizCore } from './lib/wasm/loader';

  let status = $state('Loading WASM…');

  onMount(async () => {
    const viz = await loadVizCore();
    const sum = viz.add(2, 3);
    status = `WASM loaded. add(2, 3) = ${sum}`;
  });
</script>

<main>
  <h1>Math Visualizer</h1>
  <p>{status}</p>
</main>

<style>
  main { padding: 2rem; }
</style>
```

(Svelte 5 syntax: `$state` is a rune. No `let count = 0;` reactivity — must wrap in `$state(...)` when assigning later.)

- [ ] **Step 4: Verify in the browser**

Run: `cd web && npm run dev`
Open `http://localhost:5173/`.
Expected on-screen: "WASM loaded. add(2, 3) = 5".
Open the browser devtools console: should be free of errors.
Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add web/vite.config.ts web/src/lib/wasm/loader.ts web/src/App.svelte
git commit -m "feat: load wasm module from svelte and call exported fn"
```

---

## Task 5: Build the Engine struct with a WebGL2 clear-color frame

**Files:**
- Create: `crates/viz-core/src/engine/mod.rs`
- Modify: `crates/viz-core/src/lib.rs`

- [ ] **Step 1: Write the Engine module with unit tests for color state**

Create `crates/viz-core/src/engine/mod.rs`:

```rust
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use web_sys::{HtmlCanvasElement, WebGl2RenderingContext};

#[wasm_bindgen]
pub struct Engine {
    gl: WebGl2RenderingContext,
    clear_color: [f32; 4],
}

#[wasm_bindgen]
impl Engine {
    /// Construct an Engine bound to the canvas with id `canvas_id`.
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

        Ok(Engine {
            gl,
            clear_color: [0.0, 0.0, 0.0, 1.0],
        })
    }

    /// Render one frame: clear to `clear_color`.
    pub fn frame(&self) {
        let [r, g, b, a] = self.clear_color;
        self.gl.clear_color(r, g, b, a);
        self.gl.clear(WebGl2RenderingContext::COLOR_BUFFER_BIT);
    }

    pub fn set_clear_color(&mut self, r: f32, g: f32, b: f32, a: f32) {
        self.clear_color = [r.clamp(0.0, 1.0), g.clamp(0.0, 1.0), b.clamp(0.0, 1.0), a.clamp(0.0, 1.0)];
    }

    pub fn resize(&self, width: u32, height: u32) {
        self.gl.viewport(0, 0, width as i32, height as i32);
    }
}

/// Pure-Rust testable helper for clamping. Lifted out so we can test the
/// rule without a WebGL context. Kept module-private; `set_clear_color`
/// applies the same clamp inline so this stays a unit-test seam.
pub(crate) fn clamp_color(c: [f32; 4]) -> [f32; 4] {
    [
        c[0].clamp(0.0, 1.0),
        c[1].clamp(0.0, 1.0),
        c[2].clamp(0.0, 1.0),
        c[3].clamp(0.0, 1.0),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamp_color_clamps_above_one() {
        assert_eq!(clamp_color([1.5, 0.5, -0.2, 2.0]), [1.0, 0.5, 0.0, 1.0]);
    }

    #[test]
    fn clamp_color_passes_through_in_range() {
        assert_eq!(clamp_color([0.1, 0.2, 0.3, 0.4]), [0.1, 0.2, 0.3, 0.4]);
    }
}
```

- [ ] **Step 2: Re-export Engine from lib.rs and drop the `add` sanity helper**

Replace `crates/viz-core/src/lib.rs` with:

```rust
use wasm_bindgen::prelude::*;

pub mod engine;

pub use engine::Engine;

#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}
```

(The `add` function from Task 2 is no longer needed; the WASM smoke test in Task 7 will use `Engine` directly. We're not preserving `add` for the JS smoke test either — Task 6 replaces App.svelte's call.)

- [ ] **Step 3: Verify Rust tests pass and wasm builds**

Run: `cargo test --workspace`
Expected: `test result: ok. 2 passed; 0 failed` (both `clamp_color_*` tests).

Run: `wasm-pack build crates/viz-core --target web --out-dir pkg`
Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add crates/viz-core/src/
git commit -m "feat: add Engine struct owning a WebGL2 context and clear-color frame"
```

---

## Task 6: Wire the canvas + Engine into App.svelte with a requestAnimationFrame loop

**Files:**
- Modify: `web/src/App.svelte`

- [ ] **Step 1: Replace App.svelte with a canvas + Engine loop + RGBA inputs**

Replace `web/src/App.svelte` with:

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { loadVizCore } from './lib/wasm/loader';
  import type { Engine } from 'viz-core';

  let canvas: HTMLCanvasElement;
  let engine = $state<Engine | null>(null);
  let r = $state(0.1);
  let g = $state(0.1);
  let b = $state(0.15);
  let a = $state(1.0);
  let rafId = 0;

  onMount(async () => {
    const viz = await loadVizCore();
    engine = new viz.Engine('viz-canvas');
    sizeCanvas();  // must run after engine assignment so engine.resize() fires
    engine.set_clear_color(r, g, b, a);

    const loop = () => {
      engine?.frame();
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

  $effect(() => {
    engine?.set_clear_color(r, g, b, a);
  });
</script>

<div class="layout">
  <canvas id="viz-canvas" bind:this={canvas}></canvas>
  <aside class="panel">
    <h2>Clear color</h2>
    <label>R <input type="range" min="0" max="1" step="0.01" bind:value={r} /> {r.toFixed(2)}</label>
    <label>G <input type="range" min="0" max="1" step="0.01" bind:value={g} /> {g.toFixed(2)}</label>
    <label>B <input type="range" min="0" max="1" step="0.01" bind:value={b} /> {b.toFixed(2)}</label>
    <label>A <input type="range" min="0" max="1" step="0.01" bind:value={a} /> {a.toFixed(2)}</label>
  </aside>
</div>

<style>
  .layout {
    display: grid;
    grid-template-columns: 1fr 280px;
    height: 100vh;
  }
  canvas {
    width: 100%;
    height: 100%;
    display: block;
  }
  .panel {
    background: #1c1c1f;
    padding: 1rem;
    border-left: 1px solid #2a2a2f;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  label {
    display: grid;
    grid-template-columns: 1.5rem 1fr 3rem;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
  }
</style>
```

- [ ] **Step 2: Verify in the browser**

Run: `cd web && npm run dev`
Open `http://localhost:5173/`.
Expected:
- Canvas fills the left side with a dark navy color.
- Right panel shows four sliders (R, G, B, A).
- Moving any slider updates the canvas color smoothly.
- Resizing the window keeps the canvas filling its column without distortion.

Open devtools console: should be free of errors and warnings.
Stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add web/src/App.svelte
git commit -m "feat: drive a WebGL2 canvas from Rust with adjustable clear color"
```

---

## Task 7: Set up wasm-bindgen-test with a passing browser smoke test

**Files:**
- Create: `crates/viz-core/tests/wasm.rs`

- [ ] **Step 1: Write a wasm-bindgen-test that exercises the JS-facing Engine API**

Create `crates/viz-core/tests/wasm.rs`:

```rust
//! Browser-side smoke tests. Run with:
//!   wasm-pack test crates/viz-core --chrome --headless

use wasm_bindgen::JsCast;
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

#[wasm_bindgen_test]
fn engine_constructs_with_a_canvas() {
    make_canvas("test-canvas-construct");
    let engine = Engine::new("test-canvas-construct").expect("engine constructs");
    // Just calling frame() proves the GL context is usable.
    engine.frame();
}

#[wasm_bindgen_test]
fn engine_errors_when_canvas_missing() {
    let result = Engine::new("definitely-not-a-canvas-id");
    assert!(result.is_err());
}
```

- [ ] **Step 2: Run the WASM tests in headless Chrome**

Run: `wasm-pack test crates/viz-core --chrome --headless`
Expected: `running 2 tests` followed by `test result: ok. 2 passed; 0 failed`.

If `--chrome --headless` fails with a missing Chrome error, install Chrome / Chromium or substitute `--firefox --headless`.

- [ ] **Step 3: Commit**

```bash
git add crates/viz-core/tests/wasm.rs
git commit -m "test: wasm-bindgen-test smoke tests for Engine construction"
```

---

## Task 8: Set up Vitest with a Svelte component test

**Files:**
- Modify: `web/package.json`
- Create: `web/vitest.config.ts`
- Create: `web/src/lib/wasm/__tests__/loader.test.ts`
- Create: `web/src/lib/components/__tests__/App.test.ts`

- [ ] **Step 1: Add Vitest + testing-library dev dependencies**

Update `web/package.json`'s `devDependencies` to add (keep existing entries):

```json
{
  "devDependencies": {
    "@testing-library/jest-dom": "^6.5.0",
    "@testing-library/svelte": "^5.2.0",
    "@vitest/ui": "^2.1.0",
    "jsdom": "^25.0.0",
    "vitest": "^2.1.0"
  }
}
```

And add a `test` script (keep existing scripts):

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

Run: `cd web && npm install`
Expected: success.

- [ ] **Step 2: Create the Vitest config**

Create `web/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte({ hot: false })],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [],
    // The WASM module touches WebGL APIs that jsdom doesn't implement.
    // Component tests in this phase only assert on DOM scaffolding.
    server: {
      deps: {
        inline: [/^svelte/],
      },
    },
  },
});
```

- [ ] **Step 3: Write the loader unit test (verifies single-flight init)**

Create `web/src/lib/wasm/__tests__/loader.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the WASM module so the test stays pure-JS — no real WebGL context required.
const initMock = vi.fn(async () => undefined);
const fakeExports = { add: (a: number, b: number) => a + b };

vi.mock('viz-core', () => ({
  default: initMock,
  add: fakeExports.add,
}));

describe('loadVizCore', () => {
  beforeEach(() => {
    initMock.mockClear();
    // Re-import the loader fresh per test to reset the module-level cache.
    vi.resetModules();
  });

  it('calls init exactly once across multiple parallel loads', async () => {
    const { loadVizCore } = await import('../loader');
    const [a, b, c] = await Promise.all([loadVizCore(), loadVizCore(), loadVizCore()]);
    expect(initMock).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('returns the wasm module exports', async () => {
    const { loadVizCore } = await import('../loader');
    const viz = await loadVizCore();
    expect(viz.add(2, 3)).toBe(5);
  });
});
```

(The Phase 1 loader exposes `viz.add` — Task 5 removed `add` from lib.rs in real code. We keep `add` in the *mock* so the loader test stays self-contained. Future phases will update this test as the surface evolves.)

- [ ] **Step 4: Write a minimal App.svelte mount test**

Create `web/src/lib/components/__tests__/App.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';

// Mock the WASM loader so App.svelte mounts without trying to instantiate WebGL.
vi.mock('../../wasm/loader', () => ({
  loadVizCore: vi.fn(() =>
    Promise.resolve({
      Engine: class {
        constructor(_: string) {}
        frame() {}
        set_clear_color(_r: number, _g: number, _b: number, _a: number) {}
        resize(_w: number, _h: number) {}
      },
    } as unknown as typeof import('viz-core'))
  ),
}));

import App from '../../../App.svelte';

describe('App.svelte', () => {
  it('mounts and renders the heading', () => {
    const { getByText } = render(App);
    expect(getByText('Math Visualizer')).toBeTruthy();
  });
});
```

- [ ] **Step 5: Run the Vitest suite**

Run: `cd web && npm run test`
Expected: `Test Files  2 passed (2)` and `Tests  3 passed (3)`.

If the mount test fails because `requestAnimationFrame` is undefined in jsdom, add to the top of `App.test.ts`:

```ts
globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 0)) as typeof requestAnimationFrame;
globalThis.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as typeof cancelAnimationFrame;
```

- [ ] **Step 6: Commit**

```bash
git add web/package.json web/vitest.config.ts web/src/lib/
git commit -m "test: set up vitest with loader unit test and App mount test"
```

---

## Task 9: README + top-level dev convenience script

**Files:**
- Create: `README.md`
- Create: `scripts/dev.sh`

- [ ] **Step 1: Write the README**

Create `README.md`:

```markdown
# Math Visualizer

Interactive math visualizations built with Rust → WebAssembly → WebGL2, with a Svelte UI.

> **Status:** Phase 1 — toolchain and clear-color canvas. See `docs/superpowers/specs/` for the design and `docs/superpowers/plans/` for execution plans.

## Prerequisites

- Rust (stable, with `wasm32-unknown-unknown` target — installed via `rust-toolchain.toml` on first build)
- `wasm-pack` (`cargo install wasm-pack`)
- Node.js 20+
- Chrome or Chromium for WASM browser tests

## First-time setup

```bash
# Build the WASM package once so `npm install` can resolve the file: dep.
wasm-pack build crates/viz-core --target web --out-dir pkg

# Install JS dependencies.
cd web && npm install && cd ..
```

## Development

In two terminals (or use `./scripts/dev.sh` which runs both):

```bash
# Terminal 1: rebuild WASM on Rust changes.
cargo watch -s 'wasm-pack build crates/viz-core --target web --out-dir pkg'

# Terminal 2: run the Vite dev server.
cd web && npm run dev
```

Open http://localhost:5173/.

`cargo-watch` is optional; install with `cargo install cargo-watch`. Without it, re-run the `wasm-pack build` command manually after Rust edits.

## Testing

```bash
# Rust unit tests
cargo test --workspace

# WASM browser tests (headless Chrome)
wasm-pack test crates/viz-core --chrome --headless

# JS / Svelte component tests
cd web && npm run test
```

## Project layout

See [docs/superpowers/specs/2026-05-23-math-visualizer-foundation-design.md](docs/superpowers/specs/2026-05-23-math-visualizer-foundation-design.md) for the full design.
```

- [ ] **Step 2: Write the convenience dev script**

Create `scripts/dev.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v cargo-watch >/dev/null 2>&1; then
  echo "cargo-watch not found. Install with: cargo install cargo-watch" >&2
  exit 1
fi

# Initial build so Vite has something to import.
wasm-pack build crates/viz-core --target web --out-dir pkg

# Rebuild WASM on Rust changes in the background.
cargo watch -w crates/viz-core/src -s 'wasm-pack build crates/viz-core --target web --out-dir pkg' &
WATCH_PID=$!
trap "kill $WATCH_PID 2>/dev/null || true" EXIT

# Foreground: Vite dev server.
cd web
npm run dev
```

Run: `chmod +x scripts/dev.sh`

- [ ] **Step 3: Manual smoke test of the documented workflow**

Run, from a clean shell:
```bash
wasm-pack build crates/viz-core --target web --out-dir pkg
cd web && npm install
npm run dev
```
Expected: dev server starts, the page renders, sliders adjust the canvas color.
Stop the dev server.

Run from repo root:
```bash
cargo test --workspace
wasm-pack test crates/viz-core --chrome --headless
cd web && npm run test
```
Expected: all three suites pass.

- [ ] **Step 4: Commit**

```bash
git add README.md scripts/dev.sh
git commit -m "docs: README and dev convenience script for Phase 1 workflow"
```

---

## Phase 1 acceptance checklist

After Task 9, verify all of the following manually:

- [ ] `cargo test --workspace` passes (≥ 2 tests).
- [ ] `wasm-pack test crates/viz-core --chrome --headless` passes (≥ 2 tests).
- [ ] `cd web && npm run test` passes (≥ 3 tests).
- [ ] `cd web && npm run build` produces a `dist/` directory without errors.
- [ ] `cd web && npm run check` passes (no TypeScript / Svelte errors).
- [ ] `npm run dev` shows a canvas with adjustable RGBA clear-color sliders, no devtools console errors.
- [ ] Browser devtools "Network" panel: `viz_core_bg.wasm` loaded successfully.
- [ ] Resizing the window keeps the canvas crisp (no blurry stretch).

If any check fails, fix in place rather than committing forward. When all checks pass, Phase 1 is done — Phase 2 begins with a separate plan.
