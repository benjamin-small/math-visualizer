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
    let mut engine = Engine::new("test-canvas-construct").expect("engine constructs");
    // Just calling frame() proves the GL context is usable.
    engine.frame(0.0);
}

#[wasm_bindgen_test]
fn engine_errors_when_canvas_missing() {
    let result = Engine::new("definitely-not-a-canvas-id");
    assert!(result.is_err());
}
