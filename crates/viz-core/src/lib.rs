use wasm_bindgen::prelude::*;

pub mod config;
pub mod engine;
pub mod traits;

pub use engine::Engine;

#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}
