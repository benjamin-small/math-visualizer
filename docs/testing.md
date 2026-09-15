# Testing

Run the Rust and web suites with:

```sh
cargo test --all-features
cd web
npm test
npm run coverage
```

The Rust suite currently contains 177 passing tests. It exercises playback reduction, configuration schemas, deterministic seeded rules, geometric invariants, 2D and 3D camera behavior, serialization, type-erased dispatch, input handling, and visualization state. The separate browser-targeted WASM smoke suite currently contains 24 passing tests and is run with `wasm-pack test --chrome --headless crates/viz-core` as documented in the root README.

As measured on September 15, 2026, the 105 web tests (across 13 test files) cover 84.42% of statements, 84.98% of branches, 76.11% of functions, and 84.42% of lines. They exercise the single-flight WASM loader and representative Svelte application mount and interaction paths across the Fourier and sorting labs.

Instrumentation-based Rust source coverage is currently 0% because the Cargo test gate does not configure a Rust coverage reporter. The web report's principal gaps are the Svelte application's rendering and animation paths and the browser entry point. Real WebGL behavior remains outside the DOM-based unit-test environment.
