use wasm_bindgen::prelude::*;

pub mod config;
pub mod engine;
pub mod jpeg_images;
pub mod render;
pub mod rules;
pub mod traits;
pub mod visualizations;

pub use engine::Engine;

#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}
