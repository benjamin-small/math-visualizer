# Math Visualizer

Interactive math visualizations built with Rust → WebAssembly → WebGL2, with a Svelte UI.

> **Status:** Phase 2 — core abstractions (Rule, Visualization, ConfigSchema) and playback engine, validated with a demo ColorCycleRule + ColorCycleViz. See [`docs/superpowers/specs/`](docs/superpowers/specs/) for the design and [`docs/superpowers/plans/`](docs/superpowers/plans/) for execution plans.

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
│   │   │   └── erased.rs             # Type-erased dispatch over Rule/Visualization
│   │   ├── rules/
│   │   │   └── color_cycle.rs        # Demo rule (replaced by midpoint rule in Phase 3)
│   │   └── visualizations/
│   │       └── color_cycle.rs        # Demo viz using gl.clear + HSL (Phase 3 adds real renderers)
│   └── tests/wasm.rs                 # Browser smoke tests (Engine construction + dispatch round-trip)
└── web/                              # Vite + Svelte 5 app
    ├── src/
    │   ├── App.svelte                # Canvas + playback control bar
    │   ├── main.ts                   # Svelte 5 mount entry
    │   └── lib/
    │       ├── playback/commands.ts  # Typed Command builders for engine.dispatch
    │       ├── wasm/loader.ts        # Single-flight WASM module loader
    │       └── components/__tests__/ # Component mount tests (vitest + @testing-library/svelte)
    ├── package.json
    └── vite.config.ts
```

See [docs/superpowers/specs/2026-05-23-math-visualizer-foundation-design.md](docs/superpowers/specs/2026-05-23-math-visualizer-foundation-design.md) for the full design — including the planned Rule/Visualization/Engine abstractions that land in Phase 2+.
