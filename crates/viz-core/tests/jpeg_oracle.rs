//! Our encoder's bytes, decoded by the browser, must match our decoder.

use jpeg::codec::{decode, encode, Options};
use jpeg::Subsampling;
use viz_core::jpeg_images::builtin_image;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::JsFuture;
use wasm_bindgen_test::*;
use web_sys::{
    Blob, BlobPropertyBag, ColorSpaceConversion, ImageBitmap, ImageBitmapOptions, OffscreenCanvas,
    OffscreenCanvasRenderingContext2d, PremultiplyAlpha,
};

wasm_bindgen_test_configure!(run_in_browser);

async fn browser_decode(bytes: &[u8], w: u32, h: u32) -> Vec<u8> {
    let parts = js_sys::Array::of1(&js_sys::Uint8Array::from(bytes));
    let props = BlobPropertyBag::new();
    props.set_type("image/jpeg");
    let blob = Blob::new_with_u8_array_sequence_and_options(&parts, &props).unwrap();
    let opts = ImageBitmapOptions::new();
    opts.set_color_space_conversion(ColorSpaceConversion::None);
    opts.set_premultiply_alpha(PremultiplyAlpha::None);
    let promise = web_sys::window()
        .unwrap()
        .create_image_bitmap_with_blob_and_image_bitmap_options(&blob, &opts)
        .unwrap();
    let bitmap: ImageBitmap = JsFuture::from(promise).await.unwrap().dyn_into().unwrap();
    assert_eq!((bitmap.width(), bitmap.height()), (w, h));
    let canvas = OffscreenCanvas::new(w, h).unwrap();
    let ctx: OffscreenCanvasRenderingContext2d = canvas
        .get_context("2d")
        .unwrap()
        .unwrap()
        .dyn_into()
        .unwrap();
    ctx.draw_image_with_image_bitmap(&bitmap, 0.0, 0.0).unwrap();
    ctx.get_image_data(0.0, 0.0, w as f64, h as f64)
        .unwrap()
        .data()
        .0
}

/// Our bytes decoded by the browser vs our own decoder: per channel, at
/// most 3 levels apart anywhere and 0.5 on average. (Measured on Chrome 155:
/// max 3, mean ≤ 0.37; the gap is libjpeg's integer IDCT, upsampling and
/// colour conversion vs our float ones.)
#[wasm_bindgen_test]
async fn browser_agrees_with_our_decoder() {
    for id in ["gradient", "text", "bars"] {
        for (w, h) in [(128usize, 128usize), (99, 61)] {
            let img = builtin_image(id, w, h).unwrap();
            for s in [Subsampling::S444, Subsampling::S422, Subsampling::S420] {
                for q in [10u8, 50, 90] {
                    let o = Options {
                        quality: q,
                        subsampling: s,
                        ..Options::default()
                    };
                    let e = encode(&img, &o).unwrap();
                    let ours = decode(&e.bytes).unwrap().image.rgba;
                    let theirs = browser_decode(&e.bytes, w as u32, h as u32).await;
                    let (mut max, mut sum, mut n) = (0u8, 0u64, 0u64);
                    for (a, b) in ours.chunks_exact(4).zip(theirs.chunks_exact(4)) {
                        for c in 0..3 {
                            let d = a[c].abs_diff(b[c]);
                            max = max.max(d);
                            sum += d as u64;
                            n += 1;
                        }
                    }
                    let mean = sum as f64 / n as f64;
                    let case = format!("{id} {w}x{h} {s:?} q{q}");
                    assert!(max <= 3, "{case}: max {max}");
                    assert!(mean <= 0.5, "{case}: mean {mean}");
                }
            }
        }
    }
}
