//! Browser-side smoke tests. Run with:
//!   wasm-pack test --chrome --headless crates/viz-core

use viz_core::Engine;
use wasm_bindgen::JsCast;
use wasm_bindgen::JsValue;
use wasm_bindgen_test::*;
use web_sys::{HtmlCanvasElement, WebGl2RenderingContext};

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

// ---- "notes" lab ----

/// The WebGL2 context the engine made on `canvas`: a canvas hands the same
/// context back to every `getContext("webgl2")`.
fn gl_of(canvas: &HtmlCanvasElement) -> WebGl2RenderingContext {
    canvas
        .get_context("webgl2")
        .expect("getContext")
        .expect("the engine made a webgl2 context")
        .dyn_into::<WebGl2RenderingContext>()
        .expect("a WebGL2 context")
}

/// Every viewport, buffer and draw call the frames made was valid.
fn assert_no_gl_error(gl: &WebGl2RenderingContext) {
    assert_eq!(
        gl.get_error(),
        WebGl2RenderingContext::NO_ERROR,
        "GL error while rendering"
    );
}

/// The canvas pixel at (x, y), with y measured down from the top like the
/// viz's layout.
fn pixel_at(gl: &WebGl2RenderingContext, x: i32, y: i32) -> [u8; 4] {
    let mut px = [0u8; 4];
    gl.read_pixels_with_opt_u8_array(
        x,
        gl.drawing_buffer_height() - 1 - y,
        1,
        1,
        WebGl2RenderingContext::RGBA,
        WebGl2RenderingContext::UNSIGNED_BYTE,
        Some(&mut px),
    )
    .expect("readPixels");
    px
}

fn assert_rgb_near(px: [u8; 4], rgb: [u8; 3], what: &str) {
    let close = px
        .iter()
        .zip(rgb)
        .all(|(&got, want)| got.abs_diff(want) <= 4);
    assert!(close, "{what}: pixel {px:?}, expected about {rgb:?}");
}

fn summary_field(engine: &Engine, name: &str) -> JsValue {
    js_sys::Reflect::get(&engine.rule_summary(), &JsValue::from_str(name))
        .unwrap_or_else(|_| panic!("summary field {name}"))
}

fn snapshot_field(engine: &Engine, name: &str) -> JsValue {
    js_sys::Reflect::get(&engine.snapshot(), &JsValue::from_str(name))
        .unwrap_or_else(|_| panic!("snapshot field {name}"))
}

#[wasm_bindgen_test]
fn notes_lab_constructs_and_renders() {
    let canvas = make_canvas("test-canvas-notes");
    let mut engine =
        Engine::new("test-canvas-notes", Some("notes".into())).expect("engine constructs");
    // No rects yet: the viz fits its own square and draws note 0's time plot.
    engine.frame(0.0);
    engine.frame(16.0);
    assert_eq!(engine.lab_id(), "notes");
    assert_no_gl_error(&gl_of(&canvas));
}

#[wasm_bindgen_test]
fn notes_schemas_expose_notes_and_layout_rects() {
    make_canvas("test-canvas-notes-schemas");
    let engine =
        Engine::new("test-canvas-notes-schemas", Some("notes".into())).expect("engine constructs");

    let rule_props = js_sys::Reflect::get(&engine.rule_schema(), &JsValue::from_str("properties"))
        .expect("rule properties");
    let notes = js_sys::Reflect::get(&rule_props, &JsValue::from_str("notes")).expect("notes");
    assert!(
        !notes.is_undefined() && !notes.is_null(),
        "rule schema has notes"
    );

    let viz_props = js_sys::Reflect::get(&engine.viz_schema(), &JsValue::from_str("properties"))
        .expect("viz properties");
    for name in ["figure", "strip", "note_colors"] {
        let p = js_sys::Reflect::get(&viz_props, &JsValue::from_str(name))
            .unwrap_or_else(|_| panic!("missing property {name}"));
        assert!(!p.is_undefined() && !p.is_null(), "viz schema has {name}");
    }
}

#[wasm_bindgen_test]
fn notes_renders_one_two_and_three_notes() {
    let canvas = make_canvas("test-canvas-notes-counts");
    let mut engine =
        Engine::new("test-canvas-notes-counts", Some("notes".into())).expect("engine constructs");

    // Nothing picked: the stage is only cleared, and the model has no notes.
    engine
        .update_rule_config(cmd(r#"{"notes":[]}"#))
        .expect("no notes");
    engine.frame(0.0);
    engine.frame(16.0);
    assert_eq!(summary_field(&engine, "period").as_f64(), Some(1.0));
    assert_eq!(
        js_sys::Array::from(&summary_field(&engine, "notes")).length(),
        0
    );

    engine
        .update_rule_config(cmd(r#"{"notes":[60]}"#))
        .expect("one note");
    engine.frame(0.0);
    assert_eq!(summary_field(&engine, "period").as_f64(), Some(1.0));

    // C and G (3:2) close after two swings of C.
    engine
        .update_rule_config(cmd(r#"{"notes":[60,67]}"#))
        .expect("two notes");
    engine
        .dispatch(cmd(r#"{"kind":"StepForward"}"#))
        .expect("dispatch");
    engine
        .dispatch(cmd(r#"{"kind":"StepForward"}"#))
        .expect("dispatch");
    engine.frame(16.0);
    assert_eq!(summary_field(&engine, "period").as_f64(), Some(2.0));
    assert_eq!(summary_field(&engine, "closed").as_bool(), Some(true));

    // C, E and G (4:5:6) draw the 3D curve.
    engine
        .update_rule_config(cmd(r#"{"notes":[60,64,67]}"#))
        .expect("three notes");
    engine.frame(32.0);
    assert_eq!(summary_field(&engine, "period").as_f64(), Some(4.0));
    let notes = summary_field(&engine, "notes");
    assert_eq!(js_sys::Array::from(&notes).length(), 3);
    assert_no_gl_error(&gl_of(&canvas));
}

#[wasm_bindgen_test]
fn notes_et_toggle_keeps_the_period() {
    let canvas = make_canvas("test-canvas-notes-et");
    let mut engine =
        Engine::new("test-canvas-notes-et", Some("notes".into())).expect("engine constructs");
    engine
        .update_rule_config(cmd(r#"{"notes":[60,67],"just_intonation":false}"#))
        .expect("piano tuning");
    // The window still comes from the just fraction, so the piano figure
    // is drawn over the same two swings and visibly fails to close.
    assert_eq!(summary_field(&engine, "period").as_f64(), Some(2.0));
    assert_eq!(
        summary_field(&engine, "just_intonation").as_bool(),
        Some(false)
    );
    engine.frame(0.0);
    assert_no_gl_error(&gl_of(&canvas));
}

#[wasm_bindgen_test]
fn notes_accepts_figure_and_strip_rects() {
    let canvas = make_canvas("test-canvas-notes-rects");
    let mut engine =
        Engine::new("test-canvas-notes-rects", Some("notes".into())).expect("engine constructs");
    engine.resize(64, 64);

    // Patch the two rects into the installed config, as the lab does.
    let cfg = engine.viz_config();
    js_sys::Reflect::set(&cfg, &JsValue::from_str("figure"), &cmd("[8,8,48,48]")).unwrap();
    js_sys::Reflect::set(&cfg, &JsValue::from_str("strip"), &cmd("[8,58,48,6]")).unwrap();
    engine.update_viz_config(cfg).expect("rects accepted");

    let figure = js_sys::Reflect::get(&engine.viz_config(), &JsValue::from_str("figure"))
        .expect("figure echoed back");
    let figure: Vec<f64> = js_sys::Array::from(&figure)
        .iter()
        .map(|v| v.as_f64().expect("number"))
        .collect();
    assert_eq!(figure, vec![8.0, 8.0, 48.0, 48.0]);

    // The strip draws every wave and their sum; three notes add the cube.
    for notes in [r#"{"notes":[60,67]}"#, r#"{"notes":[60,64,67]}"#] {
        engine
            .update_rule_config(cmd(notes))
            .expect("notes accepted");
        engine
            .dispatch(cmd(r#"{"kind":"StepForward"}"#))
            .expect("dispatch");
        engine.frame(0.0);
        engine.frame(16.0);
    }
    assert_no_gl_error(&gl_of(&canvas));
}

#[wasm_bindgen_test]
fn notes_3d_drag_forwards_and_renders() {
    let canvas = make_canvas("test-canvas-notes-3d");
    let mut engine =
        Engine::new("test-canvas-notes-3d", Some("notes".into())).expect("engine constructs");
    engine
        .update_rule_config(cmd(r#"{"notes":[60,64,67]}"#))
        .expect("three notes");
    // Three swings in, so the curve has some length.
    for _ in 0..3 {
        engine
            .dispatch(cmd(r#"{"kind":"StepForward"}"#))
            .expect("dispatch");
    }

    engine
        .forward_input(cmd(
            r#"{"kind":"PointerDown","x":10.0,"y":10.0,"button":0}"#,
        ))
        .expect("PointerDown forwards");
    engine
        .forward_input(cmd(
            r#"{"kind":"PointerMove","x":30.0,"y":20.0,"dx":20.0,"dy":10.0,"buttons":1}"#,
        ))
        .expect("PointerMove forwards");
    engine
        .forward_input(cmd(r#"{"kind":"PointerUp","x":30.0,"y":20.0,"button":0}"#))
        .expect("PointerUp forwards");

    engine.frame(0.0);
    engine.frame(16.0);
    assert_no_gl_error(&gl_of(&canvas));
}

#[wasm_bindgen_test]
fn notes_playback_is_effectively_unbounded() {
    make_canvas("test-canvas-notes-unbounded");
    let mut engine = Engine::new("test-canvas-notes-unbounded", Some("notes".into()))
        .expect("engine constructs");
    engine
        .dispatch(cmd(r#"{"kind":"SetSpeed","value":8.0}"#))
        .expect("dispatch");
    engine
        .dispatch(cmd(r#"{"kind":"Play"}"#))
        .expect("dispatch");
    // frame() clamps dt to 0.25 s, so one second of play takes four steps.
    for t in [0.0, 250.0, 500.0, 750.0, 1000.0] {
        engine.frame(t);
    }

    let iteration = snapshot_field(&engine, "iteration")
        .as_f64()
        .expect("iteration");
    assert!(
        iteration >= 7.0,
        "8 swings a second for a second: {iteration}"
    );
    assert_eq!(snapshot_field(&engine, "playing").as_bool(), Some(true));
    assert_eq!(
        snapshot_field(&engine, "max_iterations").as_f64(),
        Some(4_294_967_295.0)
    );
}

#[wasm_bindgen_test]
fn notes_set_zoom_is_harmless() {
    let canvas = make_canvas("test-canvas-notes-zoom");
    let mut engine =
        Engine::new("test-canvas-notes-zoom", Some("notes".into())).expect("engine constructs");
    engine
        .update_rule_config(cmd(r#"{"notes":[60,64,67]}"#))
        .expect("three notes");
    engine.set_zoom(4.0);
    engine.frame(0.0);
    engine.set_zoom(0.25);
    engine.frame(16.0);
    assert_no_gl_error(&gl_of(&canvas));
}

#[wasm_bindgen_test]
fn notes_bar_dots_sit_where_the_layout_puts_them() {
    // A 64 px canvas and no rects: the fallback square is 53.76 px at
    // (5.12, 5.12), its 6.45 px gutters put the bars on x = 8.35 (left),
    // y = 8.35 (top) and x = 55.65 (right), and each bar spans the plot,
    // 11.57 … 52.43, centred on 32.
    for (id, notes) in [
        ("test-canvas-notes-dots-2d", r#"{"notes":[60]}"#),
        ("test-canvas-notes-dots-3d", r#"{"notes":[60,64,67]}"#),
    ] {
        let canvas = make_canvas(id);
        let mut engine = Engine::new(id, Some("notes".into())).expect("engine constructs");
        engine
            .update_rule_config(cmd(notes))
            .expect("notes accepted");
        // A quarter swing at the slowest speed: 1/16 of a swing a frame is
        // well under the smear, so the dots are drawn crisp and opaque.
        engine
            .dispatch(cmd(r#"{"kind":"SetSpeed","value":0.25}"#))
            .expect("dispatch");
        engine
            .dispatch(cmd(r#"{"kind":"Play"}"#))
            .expect("dispatch");
        for t in [0.0, 250.0, 500.0, 750.0, 1000.0] {
            engine.frame(t);
        }
        assert_eq!(summary_field(&engine, "phase").as_f64(), Some(0.25));

        let gl = gl_of(&canvas);
        // A quarter swing in, C is at +1: the top of the left bar, which is
        // the smaller y, never the bottom.
        assert_rgb_near(pixel_at(&gl, 8, 11), [242, 178, 60], "C atop the left bar");
        let bottom = pixel_at(&gl, 8, 52);
        assert!(bottom[0] < 128, "no dot at the left bar's foot: {bottom:?}");
        if notes.contains("67") {
            // E (5/4) at sin(2π · 1.25 · 0.25) = 0.924: x = 32 + 0.924 · 20.43.
            assert_rgb_near(pixel_at(&gl, 50, 8), [240, 102, 92], "E on the top bar");
            // G (3/2) at sin(2π · 1.5 · 0.25) = 0.707: y = 32 − 0.707 · 20.43.
            assert_rgb_near(pixel_at(&gl, 55, 17), [108, 198, 142], "G on the right bar");
        } else {
            // One note, one bar: the top gutter stays background.
            assert_rgb_near(pixel_at(&gl, 32, 8), [18, 18, 23], "no top bar");
        }
        assert_no_gl_error(&gl);
    }
}
