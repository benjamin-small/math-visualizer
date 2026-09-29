# Testing

Run the Rust and web suites with:

```sh
cargo test --all-features
cd web
npm test
npm run coverage
```

The Rust suite currently contains 178 passing tests. It exercises playback reduction, configuration schemas, deterministic seeded rules, geometric invariants, 2D and 3D camera behavior, serialization, type-erased dispatch, input handling, and visualization state. The separate browser-targeted WASM smoke suite currently contains 24 passing tests and is run with `wasm-pack test --chrome --headless crates/viz-core` as documented in the root README.

As measured on September 28, 2026, the 159 web tests (across 22 test files) cover 88.03% of statements, 87.48% of branches, 84.21% of functions, and 88.03% of lines. They exercise the single-flight WASM loader, the shared engine lifecycle helper, the theme and token contracts, the sorting lab's summary parsing and sonification planner (against a stub AudioContext), the gallery home's three live tiles, and representative Svelte mount and interaction paths across all three labs.

Instrumentation-based Rust source coverage is currently 0% because the Cargo test gate does not configure a Rust coverage reporter. The web report's principal gaps are the Svelte components' pointer, zoom and speed-ramp paths, the pre-paint theme script in index.html, and the browser entry point. Real WebGL behavior remains outside the DOM-based unit-test environment.
