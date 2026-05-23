//! Browser-side smoke tests. Run with:
//!   wasm-pack test --chrome --headless crates/viz-core

use wasm_bindgen::JsCast;
use wasm_bindgen::JsValue;
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

fn cmd(json: &str) -> JsValue {
    js_sys::JSON::parse(json).expect("valid JSON")
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

#[wasm_bindgen_test]
fn engine_step_forward_increments_iteration() {
    make_canvas("test-canvas-stepfwd");
    let mut engine = Engine::new("test-canvas-stepfwd").expect("engine constructs");

    engine.dispatch(cmd(r#"{"kind":"StepForward"}"#)).expect("dispatch");

    let snap = engine.snapshot();
    let iter = js_sys::Reflect::get(&snap, &JsValue::from_str("iteration"))
        .expect("iteration field")
        .as_f64()
        .expect("number");
    assert_eq!(iter as u32, 1);
}

#[wasm_bindgen_test]
fn engine_reset_returns_to_zero() {
    make_canvas("test-canvas-reset");
    let mut engine = Engine::new("test-canvas-reset").expect("engine constructs");

    engine.dispatch(cmd(r#"{"kind":"StepForward"}"#)).expect("dispatch");
    engine.dispatch(cmd(r#"{"kind":"StepForward"}"#)).expect("dispatch");
    engine.dispatch(cmd(r#"{"kind":"Reset"}"#)).expect("dispatch");

    let snap = engine.snapshot();
    let iter = js_sys::Reflect::get(&snap, &JsValue::from_str("iteration"))
        .expect("iteration field")
        .as_f64()
        .expect("number");
    assert_eq!(iter as u32, 0);
}

#[wasm_bindgen_test]
fn engine_schema_round_trip() {
    make_canvas("test-canvas-schema");
    let engine = Engine::new("test-canvas-schema").expect("engine constructs");

    let schema = engine.rule_schema();
    assert!(!schema.is_null());
    // Top-level "type" should be "object".
    let ty = js_sys::Reflect::get(&schema, &JsValue::from_str("type"))
        .expect("type field")
        .as_string()
        .expect("string");
    assert_eq!(ty, "object");
}

#[wasm_bindgen_test]
fn default_rule_schema_has_max_iterations_field() {
    make_canvas("test-canvas-defaults");
    let engine = Engine::new("test-canvas-defaults").expect("engine constructs");

    let schema = engine.rule_schema();
    let props = js_sys::Reflect::get(&schema, &JsValue::from_str("properties"))
        .expect("properties field");
    let max_iter = js_sys::Reflect::get(&props, &JsValue::from_str("max_iterations"))
        .expect("max_iterations property");
    assert!(!max_iter.is_undefined() && !max_iter.is_null());
}
