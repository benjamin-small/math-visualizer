# Testing

Run the Rust and web suites with:

```sh
cargo test --all-features
cd web
npm test
npm run coverage
```

The Rust suite currently contains 68 passing tests. It exercises playback reduction, configuration schemas, deterministic seeded rules, geometric invariants, 2D and 3D camera behavior, serialization, type-erased dispatch, input handling, and visualization state. The separate browser-targeted WASM smoke suite is run with `wasm-pack test --chrome --headless crates/viz-core` as documented in the root README.

As measured on August 27, 2026, the three web tests cover 51.86% of statements, 52.00% of branches, 12.50% of functions, and 51.86% of lines. They exercise the single-flight WASM loader and a representative Svelte application mount and interaction path.

Instrumentation-based Rust source coverage is currently 0% because the Cargo test gate does not configure a Rust coverage reporter. The web report's principal gaps are the Svelte application's rendering and animation paths and the browser entry point. Real WebGL behavior remains outside the DOM-based unit-test environment.
