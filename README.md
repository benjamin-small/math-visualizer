# Math Visualizer

**🎨 Live demo: <https://benjamin-small.github.io/math-visualizer/>**

Math Visualizer is an interactive collection of mathematical visualizations built with Rust → WebAssembly → WebGL2, with a Svelte UI. It provides explorable examples of iterative rules and their geometric attractors.

> **Status:** two labs, switchable from the top nav.
>
> - **Sierpinski Pyramid** (`#/sierpinski`) — a rotating 3D Sierpinski tetrahedron built
>   by the chaos game: pick one of four corners, move halfway, drop a dot tinted by that
>   corner. Auto-spins; click-drag to orbit.
> - **Fourier Epicycles** (`#/fourier`) — type any text (default **"POIETIC TECH"**); its
>   glyph outlines become one closed path, the path's DFT becomes a chain of rotating
>   circles, and the chain's tip traces the letters live (pen lifts between glyphs).
>   Hundreds of circles render in one instanced draw call.
>   Share a message with `#/fourier?text=YOUR+TEXT` (`&n=` sets the epicycle count) —
>   the URL updates as you type, and **Copy link** puts it on the clipboard.
>
> The midpoint-on-circle and ColorCycle rules remain in the codebase as alternative
> examples. See [`docs/superpowers/specs/`](docs/superpowers/specs/) for designs and
> [`docs/superpowers/plans/`](docs/superpowers/plans/) for execution plans.

## Prerequisites

- Rust (stable, with the `wasm32-unknown-unknown` target — installed automatically on first build via `rust-toolchain.toml`)
- [`wasm-pack`](https://rustwasm.github.io/wasm-pack/installer/): `cargo install wasm-pack`
- Node.js 20+
- Chrome (or Chromium) for the WASM browser tests

## First-time setup

```bash
# Build the WASM package once so `npm install` can resolve the file: dep.
wasm-pack build crates/viz-core --target web --out-dir pkg

# Install JS dependencies.
cd web && npm install && cd ..
```

## Development

In two terminals (or run `./scripts/dev.sh` which orchestrates both):

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

# JS / Svelte component tests
cd web && npm run test

# WASM browser tests (headless Chrome) — flag must precede the path
wasm-pack test --chrome --headless crates/viz-core
```

### Chromedriver version mismatch

`wasm-pack test --chrome` auto-downloads the *latest* chromedriver, which may not match your installed Chrome. If the run dies with `signal: 9 (SIGKILL)` on chromedriver, fetch a matching version from [Chrome for Testing](https://googlechromelabs.github.io/chrome-for-testing/) and pass it explicitly:

```bash
# Check your Chrome major version
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --version

# Download the matching chromedriver (replace 148.0.7778.178 with yours)
curl -sLO https://storage.googleapis.com/chrome-for-testing-public/148.0.7778.178/mac-arm64/chromedriver-mac-arm64.zip
unzip chromedriver-mac-arm64.zip

# Run with the matched driver
wasm-pack test --chrome --headless \
  --chromedriver=$(pwd)/chromedriver-mac-arm64/chromedriver \
  crates/viz-core
```

## Type checking

```bash
cd web && npm run check
```

## Production build

```bash
cd web && npm run build
```

Outputs a static SPA to `web/dist/`.

## Project layout

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
│   │   │   ├── erased.rs             # TypedRule/TypedViz: typed-config wrappers behind dyn traits
│   │   │   └── registry.rs           # Lab registry: id → rule/viz pair + default configs
│   │   ├── render/
│   │   │   ├── camera_2d.rs          # 2D ortho camera with fit-to-bbox
│   │   │   ├── camera_3d.rs          # 3D turntable camera (azimuth/elevation/distance)
│   │   │   ├── shader.rs             # WebGL2 shader compile/link wrapper
│   │   │   ├── instanced_points.rs   # 2D per-instance position+color+radius dots
│   │   │   ├── instanced_points_3d.rs# 3D dots, pixel radius constant with depth
│   │   │   ├── instanced_rings.rs    # Batched antialiased stroked circles (epicycles)
│   │   │   ├── sdf_circle.rs         # Single-quad antialiased stroked circle
│   │   │   ├── line_batch.rs         # 2D colored line segment batch
│   │   │   └── line_batch_3d.rs      # 3D colored line segment batch
│   │   ├── rules/
│   │   │   ├── sierpinski_chaos.rs   # Default flagship rule (3D Chaos Game)
│   │   │   ├── fourier_epicycles.rs  # Fourier lab rule: DFT of a pen-tagged closed path
│   │   │   ├── midpoint_on_circle.rs # Alternative rule (still works)
│   │   │   └── color_cycle.rs        # Phase 2 demo rule
│   │   └── visualizations/
│   │       ├── sierpinski_pyramid.rs # Default viz (rotating 3D tetrahedron)
│   │       ├── fourier_epicycles.rs  # Fourier lab viz: rings + arms + pen-lifted trail
│   │       ├── dots_on_circle.rs     # Alternative viz (paired with midpoint)
│   │       └── color_cycle.rs        # Phase 2 demo viz
│   └── tests/wasm.rs                 # Browser smoke tests (Engine + dispatch round-trip)
└── web/                              # Vite + Svelte 5 app
    ├── public/fonts/                 # Space Mono (SIL OFL 1.1) + OFL.txt, for the Fourier lab
    ├── src/
    │   ├── App.svelte                # Top nav + hash-route switch between labs
    │   ├── main.ts                   # Svelte 5 mount entry
    │   └── lib/
    │       ├── router.ts / router.svelte.ts   # parseHash + reactive `route`, no dependency
    │       ├── components/
    │       │   ├── LabShell.svelte   # Engine bootstrap, rAF loop, canvas, zoom, playback bar
    │       │   ├── labApi.svelte.ts  # Handle labs use: dispatch / patch|setRuleConfig
    │       │   └── labs/             # SierpinskiLab.svelte, FourierLab.svelte (info + controls)
    │       ├── fourier/              # textToPath: opentype.js glyphs → closed, pen-tagged path
    │       ├── playback/commands.ts  # Typed Command builders for engine.dispatch
    │       ├── wasm/loader.ts        # Single-flight WASM module loader
    │       └── test/fakeViz.ts       # Shared FakeEngine for component tests
    ├── package.json
    └── vite.config.ts
```

See [docs/superpowers/specs/2026-05-23-math-visualizer-foundation-design.md](docs/superpowers/specs/2026-05-23-math-visualizer-foundation-design.md) for the full design — including the planned Rule/Visualization/Engine abstractions that land in Phase 2+.

See [docs/configuration.md](docs/configuration.md) for build-time configuration, [docs/testing.md](docs/testing.md) for measured coverage and test scope, and [docs/licensing.md](docs/licensing.md) for the workspace's declared license.
