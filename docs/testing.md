# Testing

Run the Rust and web suites with:

```sh
cargo test --all-features
cd web
npm test
npm run coverage
```

The Rust suite currently contains 178 passing tests. It exercises playback reduction, configuration schemas, deterministic seeded rules, geometric invariants, 2D and 3D camera behavior, serialization, type-erased dispatch, input handling, and visualization state. The separate browser-targeted WASM smoke suite currently contains 24 passing tests and is run with `wasm-pack test --chrome --headless crates/viz-core` as documented in the root README.

As measured on September 23, 2026, the 130 web tests (across 14 test files) cover 86.75% of statements, 86.45% of branches, 79.48% of functions, and 86.75% of lines. They exercise the single-flight WASM loader, the sorting lab's summary parsing and sonification planner (against a stub AudioContext), and representative Svelte application mount and interaction paths across the Fourier and sorting labs.

Instrumentation-based Rust source coverage is currently 0% because the Cargo test gate does not configure a Rust coverage reporter. The web report's principal gaps are the Svelte application's rendering and animation paths and the browser entry point. Real WebGL behavior remains outside the DOM-based unit-test environment.
