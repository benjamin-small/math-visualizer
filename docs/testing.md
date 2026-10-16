# Testing

Run the Rust and web suites with:

```sh
cargo test --all-features
cd web
npm test
npm run coverage
```

The Rust suite currently contains 396 passing tests: 85 in the dependency-free `jpeg` crate (every stage's round trip and invariants, the published Wikipedia DCT and quantization values, the Annex K Huffman codes, and encoder/decoder end-to-end cases including corrupt and hostile input) and 311 in `viz-core`. It exercises playback reduction, configuration schemas, deterministic seeded rules, geometric invariants, 2D and 3D camera behavior, serialization, type-erased dispatch, input handling, and visualization state. The separate browser-targeted WASM smoke suite currently contains 47 passing tests (33 engine smoke tests, 6 JPEG kit tests, 7 JPEG lab engine tests, and the JPEG browser-decoder oracle, which checks that Chrome decodes our encoder's files to within 3 levels per channel of our own decoder) and is run with `wasm-pack test --chrome --headless crates/viz-core` as documented in the root README.

As measured on October 4, 2026, the 375 web tests (across 30 test files) cover 91.03% of statements, 89.29% of branches, 89.55% of functions, and 91.03% of lines. They exercise the single-flight WASM loader, the shared engine lifecycle helper, the theme and token contracts, the sorting lab's summary parsing and sonification planner (against a stub AudioContext), the notes lab's theory table, log speed mapping, layout, summary parsing and voice planner (against the same stub), the gallery home's four live tiles, and representative Svelte mount and interaction paths across all four labs. Since then the web suite has grown to 526 tests in 37 files, adding the JPEG lab's stages, share-link, summary, layout, maths and formulas modules, the R–D cache, the Huffman view data, and the five new stages, plus its component test against the fake engine.

Instrumentation-based Rust source coverage is currently 0% because the Cargo test gate does not configure a Rust coverage reporter. The web report's principal gaps are the Svelte components' pointer, zoom and speed-ramp paths, the pre-paint theme script in index.html, and the browser entry point. Real WebGL behavior remains outside the DOM-based unit-test environment.
