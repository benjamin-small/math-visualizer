//! The kit's bindings behave like the crate and refuse bad input.

use viz_core::jpeg_kit::*;
use wasm_bindgen::JsValue;
use wasm_bindgen_test::*;

wasm_bindgen_test_configure!(run_in_browser);

fn get(v: &JsValue, key: &str) -> JsValue {
    js_sys::Reflect::get(v, &JsValue::from_str(key)).unwrap()
}

#[wasm_bindgen_test]
fn dct_round_trips_through_the_boundary() {
    let block: Vec<f32> = (0..64).map(|i| (i % 9) as f32 * 7.0 - 30.0).collect();
    let back = jpeg_idct(&jpeg_fdct(&block).unwrap()).unwrap();
    for (a, b) in block.iter().zip(&back) {
        assert!((a - b).abs() < 1e-3);
    }
    assert_eq!(
        jpeg_idct_partial(&jpeg_fdct(&block).unwrap(), 0).unwrap(),
        vec![0.0; 64]
    );
    assert!(jpeg_basis(8, 0).is_err());
}

#[wasm_bindgen_test]
fn wrong_lengths_are_errors_not_panics() {
    assert!(jpeg_fdct(&[0.0; 63]).is_err());
    assert!(jpeg_quantize(&[0.0; 64], &[1; 10]).is_err());
    assert!(jpeg_to_zigzag(&[0; 65]).is_err());
    assert!(jpeg_optimal_lengths(&[1; 255]).is_err());
    assert!(jpeg_huffman_tree(&[0; 15], &[]).is_err());
    assert!(jpeg_encode_stats(&[0; 15], 2, 2, 50, "420", "optimized").is_err());
    assert!(jpeg_encode_stats(&[0; 16], 2, 2, 50, "411", "optimized").is_err());
    assert!(jpeg_builtin_image("nope", 8, 8).is_err());
    assert!(jpeg_builtin_image("gradient", 100_000, 100_000).is_err());
    // wasm32: 32768 * 32768 * 4 wraps to 0 without the checked multiply.
    assert!(jpeg_encode_stats(&[], 32768, 32768, 50, "420", "optimized").is_err());
}

#[wasm_bindgen_test]
fn tables_and_quantization() {
    let luma = jpeg_std_table(false);
    assert_eq!(luma[0], 16);
    assert_eq!(jpeg_scale_table(&luma, 50).unwrap(), luma);
    let mut c = vec![0.0f32; 64];
    c[0] = -415.38;
    let q = jpeg_quantize(&c, &luma).unwrap();
    assert_eq!(q[0], -26);
    assert_eq!(jpeg_dequantize(&q, &luma).unwrap()[0], -416.0);
    assert_eq!(jpeg_zigzag_order()[2], 8);
}

#[wasm_bindgen_test]
fn tokens_and_trees_cross_as_plain_objects() {
    let mut z = vec![0i32; 64];
    z[0] = 5;
    z[3] = -2;
    let tokens = jpeg_ac_symbols(&z).unwrap();
    let arr = js_sys::Array::from(&tokens);
    assert_eq!(arr.length(), 2); // (2, 2, −2) then EOB
    let first = arr.get(0);
    assert_eq!(get(&first, "run").as_f64(), Some(2.0));
    assert_eq!(get(&first, "symbol").as_f64(), Some(0x22 as f64));
    assert_eq!(get(&first, "bits").as_string().unwrap(), "01");

    let mut freq = vec![0u32; 256];
    freq[0] = 10;
    freq[1] = 5;
    freq[2] = 1;
    let spec = jpeg_optimal_lengths(&freq).unwrap();
    let bits: Vec<u8> = serde_wasm_bindgen::from_value(get(&spec, "bits")).unwrap();
    let vals: Vec<u8> = serde_wasm_bindgen::from_value(get(&spec, "vals")).unwrap();
    assert_eq!(vals, vec![0, 1, 2]);
    let nodes = js_sys::Array::from(&jpeg_huffman_tree(&bits, &vals).unwrap());
    assert_eq!(get(&nodes.get(0), "code").as_string().unwrap(), "");
    assert!(get(&nodes.get(0), "symbol").is_null() || get(&nodes.get(0), "symbol").is_undefined());
}

#[wasm_bindgen_test]
fn whole_image_helpers() {
    let rgba = jpeg_builtin_image("gradient", 32, 32).unwrap();
    assert_eq!(rgba.len(), 32 * 32 * 4);
    let low = jpeg_encode_stats(&rgba, 32, 32, 10, "420", "optimized").unwrap();
    let high = jpeg_encode_stats(&rgba, 32, 32, 90, "420", "optimized").unwrap();
    let (lb, hb) = (
        get(&low, "bytes").as_f64().unwrap(),
        get(&high, "bytes").as_f64().unwrap(),
    );
    let (lp, hp) = (
        get(&low, "psnr").as_f64().unwrap(),
        get(&high, "psnr").as_f64().unwrap(),
    );
    assert!(lb < hb && lp < hp);
    let once = jpeg_encode_decode(&rgba, 32, 32, 50, "420", "standard").unwrap();
    assert_eq!(once.len(), rgba.len());
    let ycc = jpeg_rgb_to_ycbcr(255.0, 255.0, 255.0);
    assert!((ycc[0] - 255.0).abs() < 0.01);
}

#[wasm_bindgen_test]
fn out_of_range_numbers_are_refused_or_clamped() {
    assert!(jpeg_amplitude_bits(40_000).is_err());
    assert!(jpeg_dequantize(&[100_000; 64], &[65_535; 64]).is_err());
    assert!(jpeg_amplitude_bits(i32::MIN).is_err());
    assert_eq!(jpeg_amplitude_bits(-5).unwrap(), vec![2, 3]);
    let mut z = vec![0i32; 64];
    z[1] = -40_000;
    assert!(jpeg_ac_symbols(&z).is_err());
    let luma = jpeg_std_table(false);
    assert_eq!(
        jpeg_scale_table(&luma, 0).unwrap(),
        jpeg_scale_table(&luma, 1).unwrap()
    );
    assert_eq!(jpeg_scale_table(&luma, 255).unwrap(), vec![1; 64]);
    let mut c = vec![0.0f32; 64];
    c[5] = f32::NAN;
    assert_eq!(jpeg_quantize(&c, &luma).unwrap()[5], 0);
    let rgba = jpeg_builtin_image("text", 16, 16).unwrap();
    assert!(jpeg_encode_stats(&rgba, 16, 16, 0, "444", "standard").is_ok());
}
