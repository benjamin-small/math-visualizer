# Math Visualizer

Interactive math visualizations built with Rust → WebAssembly → WebGL2, with a Svelte UI.

> **Status:** Phase 1 — toolchain and clear-color canvas. See [`docs/superpowers/specs/`](docs/superpowers/specs/) for the design and [`docs/superpowers/plans/`](docs/superpowers/plans/) for execution plans.

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
├── crates/viz-core/      # Rust crate compiled to WebAssembly
│   ├── src/
│   │   ├── lib.rs        # wasm-bindgen entry point
│   │   └── engine/       # Engine struct (WebGL2 context owner)
│   └── tests/wasm.rs     # wasm-bindgen-test browser smoke tests
└── web/                  # Vite + Svelte 5 app
    ├── src/
    │   ├── App.svelte    # Canvas + UI shell
    │   ├── main.ts       # Svelte 5 mount entry
    │   └── lib/
    │       └── wasm/loader.ts  # Single-flight WASM module loader
    ├── package.json
    └── vite.config.ts
```

See [docs/superpowers/specs/2026-05-23-math-visualizer-foundation-design.md](docs/superpowers/specs/2026-05-23-math-visualizer-foundation-design.md) for the full design — including the planned Rule/Visualization/Engine abstractions that land in Phase 2+.
