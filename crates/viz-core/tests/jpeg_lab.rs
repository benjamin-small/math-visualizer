//! The JPEG lab through the engine: construction, the bulk image path,
//! actions that keep the scan position, inspect/bytes, and every panel kind
//! rendering without a GL error.

use viz_core::Engine;
use wasm_bindgen::{JsCast, JsValue};
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
    canvas.set_width(320);
    canvas.set_height(200);
    document.body().unwrap().append_child(&canvas).unwrap();
    canvas
}

fn js(json: &str) -> JsValue {
    js_sys::JSON::parse(json).expect("valid JSON")
}

fn get(v: &JsValue, key: &str) -> JsValue {
    js_sys::Reflect::get(v, &JsValue::from_str(key)).unwrap()
}

fn num(v: &JsValue, key: &str) -> f64 {
    get(v, key)
        .as_f64()
        .unwrap_or_else(|| panic!("{key} is not a number"))
}

fn gl_of(canvas: &HtmlCanvasElement) -> WebGl2RenderingContext {
    canvas
        .get_context("webgl2")
        .unwrap()
        .unwrap()
        .dyn_into()
        .unwrap()
}

#[wasm_bindgen_test]
fn jpeg_lab_constructs_and_renders_the_default_scan() {
    let canvas = make_canvas("jpeg-default");
    let mut engine = Engine::new("jpeg-default", Some("jpeg".into())).expect("jpeg lab");
    engine.frame(0.0);
    let s = engine.rule_summary();
    assert_eq!(num(&s, "total"), 256.0);
    assert_eq!(num(&s, "width"), 256.0);
    assert!(num(&s, "bytes") > 0.0);
    assert_eq!(gl_of(&canvas).get_error(), WebGl2RenderingContext::NO_ERROR);
}

#[wasm_bindgen_test]
fn pixels_arrive_as_a_typed_array_and_reset_the_scan() {
    make_canvas("jpeg-image");
    let mut engine = Engine::new("jpeg-image", Some("jpeg".into())).unwrap();
    engine
        .dispatch(js(r#"{"kind":"JumpTo","iteration":40}"#))
        .unwrap();
    let rgba: Vec<u8> = (0..40 * 24 * 4).map(|i| (i * 7 % 256) as u8).collect();
    engine
        .update_rule_config_with_image(
            js(r#"{"image_id":"upload","quality":75,"subsampling":"444","huffman":"standard","max_iterations":15}"#),
            40,
            24,
            &rgba,
        )
        .expect("image accepted");
    let s = engine.rule_summary();
    assert_eq!((num(&s, "width"), num(&s, "height")), (40.0, 24.0));
    assert_eq!(num(&s, "total"), 15.0); // 5 × 3 MCUs of 8 × 8
    assert_eq!(get(&s, "subsampling").as_string().unwrap(), "444");
    let snap = engine.snapshot();
    assert_eq!(num(&snap, "iteration"), 0.0);
    assert_eq!(num(&snap, "max_iterations"), 15.0);
    // A buffer that doesn't match w × h × 4 is refused and changes nothing.
    assert!(engine
        .update_rule_config_with_image(js(r#"{"max_iterations":1}"#), 40, 24, &rgba[..10])
        .is_err());
    assert_eq!(num(&engine.rule_summary(), "width"), 40.0);
}

#[wasm_bindgen_test]
fn selecting_a_block_keeps_the_scan_position() {
    make_canvas("jpeg-select");
    let mut engine = Engine::new("jpeg-select", Some("jpeg".into())).unwrap();
    engine
        .dispatch(js(r#"{"kind":"JumpTo","iteration":100}"#))
        .unwrap();
    let ok = engine
        .rule_action(js(r#"{"kind":"select_block","component":2,"bx":4,"by":7}"#))
        .unwrap();
    assert!(ok);
    let sel = get(&engine.rule_summary(), "selected");
    assert_eq!(
        (num(&sel, "component"), num(&sel, "bx"), num(&sel, "by")),
        (2.0, 4.0, 7.0)
    );
    assert_eq!(num(&engine.snapshot(), "iteration"), 100.0);
    assert_eq!(num(&engine.rule_summary(), "n"), 100.0);
    assert!(engine
        .rule_action(js(
            r#"{"kind":"select_block","component":0,"bx":99,"by":0}"#
        ))
        .is_err());
    // Reset rewinds the cursor without re-encoding (the version is unchanged).
    let v = num(&engine.rule_summary(), "version");
    engine.dispatch(js(r#"{"kind":"Reset"}"#)).unwrap();
    assert_eq!(num(&engine.rule_summary(), "n"), 0.0);
    assert_eq!(num(&engine.rule_summary(), "version"), v);
}

#[wasm_bindgen_test]
fn inspect_and_bytes_cross_the_boundary() {
    make_canvas("jpeg-bytes");
    let engine = Engine::new("jpeg-bytes", Some("jpeg".into())).unwrap();
    let tables = engine.rule_inspect("tables");
    assert_eq!(js_sys::Array::from(&get(&tables, "luma")).length(), 64);
    // A JSON null crosses as `undefined` (serde-wasm-bindgen).
    assert!(engine.rule_inspect("nope").is_undefined());
    let bytes = engine.rule_bytes().expect("a file");
    assert_eq!(&bytes[..2], &[0xFF, 0xD8]);
    assert_eq!(bytes.len() as f64, num(&engine.rule_summary(), "bytes"));
}

#[wasm_bindgen_test]
fn every_panel_kind_renders_without_a_gl_error() {
    let canvas = make_canvas("jpeg-panels");
    let mut engine = Engine::new("jpeg-panels", Some("jpeg".into())).unwrap();
    engine
        .dispatch(js(r#"{"kind":"JumpTo","iteration":77}"#))
        .unwrap();
    engine
        .update_viz_config(js(r#"{"panels":[
                {"kind":"image","rect":[0,0,100,100]},
                {"kind":"image_grid","rect":[100,0,100,100]},
                {"kind":"plane_y","rect":[200,0,40,40]},
                {"kind":"plane_cb","rect":[240,0,40,40]},
                {"kind":"plane_cr","rect":[280,0,40,40]},
                {"kind":"coded_cb","rect":[200,40,40,40]},
                {"kind":"coded_cr","rect":[240,40,40,40]},
                {"kind":"cube","rect":[0,100,100,100]},
                {"kind":"block","rect":[100,100,50,50]},
                {"kind":"atlas","rect":[150,100,50,50]},
                {"kind":"coeffs","rect":[200,100,50,50]},
                {"kind":"rebuild","rect":[250,100,50,50]},
                {"kind":"unknown","rect":[0,0,1,1]}
            ],"cube_mix":0.5,"dct_k":6,"hover":[1,2]}"#))
        .expect("panels accepted");
    engine
        .forward_input(js(
            r#"{"kind":"PointerMove","x":10,"y":10,"dx":5,"dy":2,"buttons":1}"#,
        ))
        .unwrap();
    engine.frame(0.0);
    engine.frame(16.0);
    assert_eq!(gl_of(&canvas).get_error(), WebGl2RenderingContext::NO_ERROR);
}

#[wasm_bindgen_test]
fn panels_render_after_a_re_encode() {
    let canvas = make_canvas("jpeg-reencode");
    let mut engine = Engine::new("jpeg-reencode", Some("jpeg".into())).unwrap();
    let rgba: Vec<u8> = (0..40 * 24 * 4).map(|i| (i * 7 % 256) as u8).collect();
    let rule = |quality: u32| {
        js(&format!(
            r#"{{"image_id":"upload","quality":{quality},"subsampling":"444","huffman":"standard","max_iterations":15}}"#
        ))
    };
    engine
        .update_rule_config_with_image(rule(75), 40, 24, &rgba)
        .expect("image accepted");
    engine
        .update_viz_config(js(r#"{"panels":[
                {"kind":"image","rect":[0,0,100,60]},
                {"kind":"image_grid","rect":[100,0,100,60]},
                {"kind":"plane_y","rect":[200,0,40,40]},
                {"kind":"plane_cb","rect":[240,0,40,40]},
                {"kind":"plane_cr","rect":[280,0,40,40]},
                {"kind":"coded_cb","rect":[200,40,40,40],"crop":[8,0,16,16]},
                {"kind":"coded_cr","rect":[240,40,40,40]},
                {"kind":"cube","rect":[0,100,100,100]},
                {"kind":"block","rect":[100,100,50,50]},
                {"kind":"atlas","rect":[150,100,50,50]},
                {"kind":"coeffs","rect":[200,100,50,50]},
                {"kind":"rebuild","rect":[250,100,50,50]}
            ],"cube_mix":0.5,"dct_k":6,"hover":[1,2]}"#))
        .expect("panels accepted");
    engine
        .dispatch(js(r#"{"kind":"JumpTo","iteration":7}"#))
        .unwrap();
    engine.frame(0.0);
    engine.frame(16.0);
    assert_eq!(gl_of(&canvas).get_error(), WebGl2RenderingContext::NO_ERROR);
    // A new encode (a new version) rebuilds every texture and the cube cache.
    engine
        .update_rule_config_with_image(rule(90), 40, 24, &rgba)
        .expect("image accepted");
    engine.frame(32.0);
    engine.frame(48.0);
    assert_eq!(gl_of(&canvas).get_error(), WebGl2RenderingContext::NO_ERROR);
}
