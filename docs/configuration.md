# Configuration

The application requires no secrets or runtime environment variables. Visualization behavior is implemented in the versioned Rust rule and visualization modules under `crates/viz-core/src/`.

The web build accepts one optional build-time variable:

| Variable | Default | Purpose |
|---|---|---|
| `BASE_PATH` | `/` | Vite base path used when serving beneath a subdirectory. |

GitHub Pages sets `BASE_PATH=/math-visualizer/` in its deployment workflow. Local development can use the default. The WASM package under `crates/viz-core/pkg/` is generated and gitignored; build it with `wasm-pack` before installing or building the web workspace.
