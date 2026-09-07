//! Browser-side smoke tests. Run with:
//!   wasm-pack test --chrome --headless crates/viz-core

use viz_core::Engine;
use wasm_bindgen::JsCast;
use wasm_bindgen::JsValue;
use wasm_bindgen_test::*;
use web_sys::HtmlCanvasElement;

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
    let mut engine = Engine::new("test-canvas-construct", None).expect("engine constructs");
    // Just calling frame() proves the GL context is usable.
    engine.frame(0.0);
}

#[wasm_bindgen_test]
fn engine_errors_when_canvas_missing() {
    let result = Engine::new("definitely-not-a-canvas-id", None);
    assert!(result.is_err());
}

#[wasm_bindgen_test]
fn engine_step_forward_increments_iteration() {
    make_canvas("test-canvas-stepfwd");
    let mut engine = Engine::new("test-canvas-stepfwd", None).expect("engine constructs");

    engine
        .dispatch(cmd(r#"{"kind":"StepForward"}"#))
        .expect("dispatch");

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
    let mut engine = Engine::new("test-canvas-reset", None).expect("engine constructs");

    engine
        .dispatch(cmd(r#"{"kind":"StepForward"}"#))
        .expect("dispatch");
    engine
        .dispatch(cmd(r#"{"kind":"StepForward"}"#))
        .expect("dispatch");
    engine
        .dispatch(cmd(r#"{"kind":"Reset"}"#))
        .expect("dispatch");

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
    let engine = Engine::new("test-canvas-schema", None).expect("engine constructs");

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
    let engine = Engine::new("test-canvas-defaults", None).expect("engine constructs");

    let schema = engine.rule_schema();
    let props =
        js_sys::Reflect::get(&schema, &JsValue::from_str("properties")).expect("properties field");
    let max_iter = js_sys::Reflect::get(&props, &JsValue::from_str("max_iterations"))
        .expect("max_iterations property");
    assert!(!max_iter.is_undefined() && !max_iter.is_null());
}

#[wasm_bindgen_test]
fn default_viz_schema_has_3d_pyramid_fields() {
    make_canvas("test-canvas-pyramid-schema");
    let engine = Engine::new("test-canvas-pyramid-schema", None).expect("engine constructs");

    let schema = engine.viz_schema();
    let props =
        js_sys::Reflect::get(&schema, &JsValue::from_str("properties")).expect("properties field");
    for name in [
        "corner_colors",
        "auto_rotate_speed",
        "trail_tint",
        "edge_color",
    ] {
        let p = js_sys::Reflect::get(&props, &JsValue::from_str(name))
            .unwrap_or_else(|_| panic!("missing property {name}"));
        assert!(!p.is_undefined() && !p.is_null(), "property {name} present");
    }
}

#[wasm_bindgen_test]
fn engine_forwards_pointer_events_without_error() {
    make_canvas("test-canvas-pointer");
    let mut engine = Engine::new("test-canvas-pointer", None).expect("engine constructs");

    let down =
        js_sys::JSON::parse(r#"{"kind":"PointerDown","x":10.0,"y":10.0,"button":0}"#).unwrap();
    engine.forward_input(down).expect("PointerDown forwards");

    let move_ev = js_sys::JSON::parse(
        r#"{"kind":"PointerMove","x":15.0,"y":12.0,"dx":5.0,"dy":2.0,"buttons":1}"#,
    )
    .unwrap();
    engine.forward_input(move_ev).expect("PointerMove forwards");

    let up = js_sys::JSON::parse(r#"{"kind":"PointerUp","x":15.0,"y":12.0,"button":0}"#).unwrap();
    engine.forward_input(up).expect("PointerUp forwards");
}

#[wasm_bindgen_test]
fn engine_rejects_unknown_lab_id() {
    make_canvas("test-canvas-unknown-lab");
    assert!(Engine::new("test-canvas-unknown-lab", Some("nope".into())).is_err());
}

#[wasm_bindgen_test]
fn engine_reports_lab_id() {
    make_canvas("test-canvas-lab-id");
    let engine = Engine::new("test-canvas-lab-id", None).expect("engine constructs");
    assert_eq!(engine.lab_id(), "sierpinski");
}

#[wasm_bindgen_test]
fn engine_accepts_explicit_default_lab_id() {
    make_canvas("test-canvas-explicit-lab");
    let engine = Engine::new("test-canvas-explicit-lab", Some("sierpinski".into()))
        .expect("engine constructs");
    assert_eq!(engine.lab_id(), "sierpinski");
}

// ---- "fourier" lab ----

#[wasm_bindgen_test]
fn fourier_lab_constructs_and_renders() {
    make_canvas("test-canvas-fourier");
    let mut engine =
        Engine::new("test-canvas-fourier", Some("fourier".into())).expect("engine constructs");
    // Two frames: the first has no dt, the second exercises the rAF path
    // with a real dt. With the default (empty) path this renders nothing
    // but must still clear and run every draw call without error.
    engine.frame(0.0);
    engine.frame(16.0);
    assert_eq!(engine.lab_id(), "fourier");
}

#[wasm_bindgen_test]
fn fourier_rule_schema_has_path_and_epicycles() {
    make_canvas("test-canvas-fourier-rule-schema");
    let engine = Engine::new("test-canvas-fourier-rule-schema", Some("fourier".into()))
        .expect("engine constructs");

    let schema = engine.rule_schema();
    let props =
        js_sys::Reflect::get(&schema, &JsValue::from_str("properties")).expect("properties field");
    for name in ["path", "epicycles"] {
        let p = js_sys::Reflect::get(&props, &JsValue::from_str(name))
            .unwrap_or_else(|_| panic!("missing property {name}"));
        assert!(!p.is_undefined() && !p.is_null(), "property {name} present");
    }
}

#[wasm_bindgen_test]
fn fourier_viz_schema_has_circle_color() {
    make_canvas("test-canvas-fourier-viz-schema");
    let engine = Engine::new("test-canvas-fourier-viz-schema", Some("fourier".into()))
        .expect("engine constructs");

    let schema = engine.viz_schema();
    let props =
        js_sys::Reflect::get(&schema, &JsValue::from_str("properties")).expect("properties field");
    for name in ["circle_color", "min_circle_px"] {
        let p = js_sys::Reflect::get(&props, &JsValue::from_str(name))
            .unwrap_or_else(|_| panic!("missing property {name}"));
        assert!(!p.is_undefined() && !p.is_null(), "property {name} present");
    }
}

#[wasm_bindgen_test]
fn fourier_accepts_a_path_config_and_steps() {
    make_canvas("test-canvas-fourier-path");
    let mut engine =
        Engine::new("test-canvas-fourier-path", Some("fourier".into())).expect("engine constructs");

    // A 4-point diamond with one travel segment; 3 epicycles, 4 steps/loop.
    engine
        .update_rule_config(cmd(
            r#"{"path":[{"x":1,"y":0,"pen":true},{"x":0,"y":1,"pen":true},{"x":-1,"y":0,"pen":true},{"x":0,"y":-1,"pen":false}],"epicycles":3,"max_iterations":4}"#,
        ))
        .expect("path config accepted");

    engine
        .dispatch(cmd(r#"{"kind":"StepForward"}"#))
        .expect("dispatch");
    engine
        .dispatch(cmd(r#"{"kind":"StepForward"}"#))
        .expect("dispatch");

    let snap = engine.snapshot();
    let iter = js_sys::Reflect::get(&snap, &JsValue::from_str("iteration"))
        .expect("iteration field")
        .as_f64()
        .expect("number");
    assert_eq!(iter as u32, 2);

    // Now there is a real trail (2 samples), a live chain (4 points), and
    // 3 rings to draw.
    engine.frame(32.0);
}
