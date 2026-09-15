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

#[wasm_bindgen_test]
fn fourier_rule_summary_exposes_dft_terms() {
    make_canvas("test-canvas-fourier-summary");
    let mut engine = Engine::new("test-canvas-fourier-summary", Some("fourier".into()))
        .expect("engine constructs");
    // Before any path: null-ish summary with zero terms is fine; after a
    // path config the top terms must be present.
    let cfg = js_sys::JSON::parse(
        r#"{"path":[{"x":1,"y":0,"pen":true},{"x":0,"y":1,"pen":true},{"x":-1,"y":0,"pen":true},{"x":0,"y":-1,"pen":true}],"epicycles":3,"max_iterations":4}"#,
    )
    .unwrap();
    engine.update_rule_config(cfg).expect("config accepted");
    let s = engine.rule_summary();
    let terms = js_sys::Reflect::get(&s, &JsValue::from_str("terms")).expect("terms");
    let arr = js_sys::Array::from(&terms);
    assert_eq!(arr.length(), 3, "K = min(3, M-1) = 3 terms");
    let total = js_sys::Reflect::get(&s, &JsValue::from_str("total_terms")).unwrap();
    assert_eq!(total.as_f64(), Some(3.0));
}

#[wasm_bindgen_test]
fn fourier_accepts_a_typed_array_path() {
    make_canvas("test-canvas-fourier-typed");
    let mut engine = Engine::new("test-canvas-fourier-typed", Some("fourier".into()))
        .expect("engine constructs");
    let xy = [1.0f32, 0.0, 0.0, 1.0, -1.0, 0.0, 0.0, -1.0];
    let pen = [1u8, 1, 1, 0];
    engine
        .update_rule_config_with_path(cmd(r#"{"epicycles":3,"max_iterations":4}"#), &xy, &pen)
        .expect("typed-array path accepted");
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
    // rule_config() reflects the installed path.
    let cfg = engine.rule_config();
    let path = js_sys::Reflect::get(&cfg, &JsValue::from_str("path")).expect("path");
    assert_eq!(js_sys::Array::from(&path).length(), 4);
    engine.frame(32.0);
}

#[wasm_bindgen_test]
fn typed_array_path_rejects_bad_shapes_and_non_path_rules() {
    make_canvas("test-canvas-typed-errors");
    let mut fourier =
        Engine::new("test-canvas-typed-errors", Some("fourier".into())).expect("engine constructs");
    assert!(fourier
        .update_rule_config_with_path(
            cmd(r#"{"epicycles":3,"max_iterations":4}"#),
            &[1.0, 0.0, 0.0],
            &[1, 1]
        )
        .is_err());
    make_canvas("test-canvas-typed-errors-2");
    let mut pyramid = Engine::new("test-canvas-typed-errors-2", None).expect("engine constructs");
    assert!(pyramid
        .update_rule_config_with_path(cmd(r#"{"max_iterations":10}"#), &[1.0, 0.0], &[1])
        .is_err());
}

// ---- "sorting" lab ----

/// `rule_summary().lanes[i]` as a JsValue.
fn summary_lane(engine: &Engine, i: u32) -> JsValue {
    let s = engine.rule_summary();
    let lanes = js_sys::Reflect::get(&s, &JsValue::from_str("lanes")).expect("lanes");
    js_sys::Reflect::get(&lanes, &JsValue::from_f64(i as f64)).expect("lane")
}

fn lane_field(engine: &Engine, i: u32, name: &str) -> JsValue {
    js_sys::Reflect::get(&summary_lane(engine, i), &JsValue::from_str(name))
        .unwrap_or_else(|_| panic!("lane field {name}"))
}

#[wasm_bindgen_test]
fn sorting_lab_constructs_and_renders() {
    make_canvas("test-canvas-sorting");
    let mut engine =
        Engine::new("test-canvas-sorting", Some("sorting".into())).expect("engine constructs");
    assert_eq!(engine.lab_id(), "sorting");
    // No cells yet: this clears to the background and issues an empty draw.
    engine.frame(0.0);

    let rule_props = js_sys::Reflect::get(&engine.rule_schema(), &JsValue::from_str("properties"))
        .expect("rule properties");
    let size = js_sys::Reflect::get(&rule_props, &JsValue::from_str("size")).expect("size");
    assert!(
        !size.is_undefined() && !size.is_null(),
        "rule schema has size"
    );

    let viz_props = js_sys::Reflect::get(&engine.viz_schema(), &JsValue::from_str("properties"))
        .expect("viz properties");
    let cells = js_sys::Reflect::get(&viz_props, &JsValue::from_str("cells")).expect("cells");
    assert!(
        !cells.is_undefined() && !cells.is_null(),
        "viz schema has cells"
    );
}

#[wasm_bindgen_test]
fn sorting_rule_action_toggles_a_lane() {
    make_canvas("test-canvas-sorting-action");
    let mut engine = Engine::new("test-canvas-sorting-action", Some("sorting".into()))
        .expect("engine constructs");

    let handled = engine
        .rule_action(cmd(r#"{"kind":"toggle","lane":0}"#))
        .expect("toggle accepted");
    assert!(handled, "sorting handles rule actions");
    assert_eq!(lane_field(&engine, 0, "running").as_bool(), Some(true));

    // One second of clock at the default speed = one tick = one op, applied
    // to the running lane only. frame()'s dt is clamped to 0.25s per call, so
    // spread the second over four steps rather than one big jump.
    engine
        .dispatch(cmd(r#"{"kind":"Play"}"#))
        .expect("dispatch");
    engine.frame(0.0);
    engine.frame(250.0);
    engine.frame(500.0);
    engine.frame(750.0);
    engine.frame(1000.0);

    let cursor0 = lane_field(&engine, 0, "cursor").as_f64().expect("cursor");
    let cursor1 = lane_field(&engine, 1, "cursor").as_f64().expect("cursor");
    assert!(cursor0 > 0.0, "toggled lane advanced (cursor {cursor0})");
    assert_eq!(cursor1, 0.0, "idle lane stood still");
}

#[wasm_bindgen_test]
fn rule_action_rejects_bad_lane_and_unknown_kind() {
    make_canvas("test-canvas-sorting-bad-action");
    let mut engine = Engine::new("test-canvas-sorting-bad-action", Some("sorting".into()))
        .expect("engine constructs");

    assert!(engine
        .rule_action(cmd(r#"{"kind":"toggle","lane":9999}"#))
        .is_err());
    assert!(engine.rule_action(cmd(r#"{"kind":"fly"}"#)).is_err());
    assert!(engine.rule_action(cmd(r#"{"lane":0}"#)).is_err());
}

#[wasm_bindgen_test]
fn rule_action_is_unsupported_on_other_labs() {
    make_canvas("test-canvas-fourier-action");
    let mut engine = Engine::new("test-canvas-fourier-action", Some("fourier".into()))
        .expect("engine constructs");
    // Not an error — the rule simply has no actions.
    assert_eq!(
        engine.rule_action(cmd(r#"{"kind":"toggle","lane":0}"#)),
        Ok(false)
    );
}

#[wasm_bindgen_test]
fn sorting_accepts_cells_viz_config() {
    make_canvas("test-canvas-sorting-cells");
    let mut engine = Engine::new("test-canvas-sorting-cells", Some("sorting".into()))
        .expect("engine constructs");
    engine.resize(64, 64);

    // A 7×4 grid of cells over the 64×64 canvas, row-major like the lanes.
    let mut cells = String::from("[");
    for row in 0..7 {
        for col in 0..4 {
            if row + col > 0 {
                cells.push(',');
            }
            let x = col as f32 * 16.0;
            let y = row as f32 * 9.0;
            cells.push_str(&format!("[{x},{y},16,9]"));
        }
    }
    cells.push(']');

    let cfg = format!(
        r#"{{"background":[0.0,0.0,0.0,1.0],"bar_color":[0.6,0.6,0.7,1.0],"compare_color":[0.9,0.7,0.3,1.0],"write_color":[0.9,0.3,0.3,1.0],"done_color":[0.3,0.8,0.5,1.0],"bar_gap":0.15,"cell_padding_px":1.0,"cells":{cells}}}"#
    );
    engine
        .update_viz_config(cmd(&cfg))
        .expect("cells config accepted");

    let installed = js_sys::Reflect::get(&engine.viz_config(), &JsValue::from_str("cells"))
        .expect("cells echoed back");
    assert_eq!(js_sys::Array::from(&installed).length(), 28);

    // Run every lane so the draw covers bars, highlights and finished lanes.
    engine
        .rule_action(cmd(
            r#"{"kind":"set_running","lanes":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27],"running":true}"#,
        ))
        .expect("set_running accepted");
    engine
        .dispatch(cmd(r#"{"kind":"Play"}"#))
        .expect("dispatch");
    engine.frame(0.0);
    engine.frame(1000.0);
    engine.frame(2000.0);
}

#[wasm_bindgen_test]
fn frame_dt_is_clamped_so_a_huge_gap_cannot_fast_forward_a_lane() {
    make_canvas("test-canvas-sorting-dt-clamp");
    let mut engine = Engine::new("test-canvas-sorting-dt-clamp", Some("sorting".into()))
        .expect("engine constructs");

    engine
        .rule_action(cmd(r#"{"kind":"toggle","lane":0}"#))
        .expect("toggle accepted");
    engine
        .dispatch(cmd(r#"{"kind":"SetSpeed","value":60.0}"#))
        .expect("dispatch");
    engine
        .dispatch(cmd(r#"{"kind":"Play"}"#))
        .expect("dispatch");
    engine.frame(0.0);
    // A one-minute gap (e.g. a hidden tab) must be clamped to 0.25s of dt,
    // so at 60 ops/s this tick advances the lane by at most 15 ops.
    engine.frame(60_000.0);

    let cursor = lane_field(&engine, 0, "cursor").as_f64().expect("cursor");
    assert!(
        cursor <= 15.0,
        "cursor {cursor} exceeds the clamped dt budget"
    );
}
