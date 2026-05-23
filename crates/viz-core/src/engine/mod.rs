use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use web_sys::{HtmlCanvasElement, WebGl2RenderingContext};

#[wasm_bindgen]
pub struct Engine {
    gl: WebGl2RenderingContext,
    clear_color: [f32; 4],
}

#[wasm_bindgen]
impl Engine {
    /// Construct an Engine bound to the canvas with id `canvas_id`.
    #[wasm_bindgen(constructor)]
    pub fn new(canvas_id: &str) -> Result<Engine, JsValue> {
        let window = web_sys::window().ok_or_else(|| JsValue::from_str("no window"))?;
        let document = window
            .document()
            .ok_or_else(|| JsValue::from_str("no document"))?;
        let canvas = document
            .get_element_by_id(canvas_id)
            .ok_or_else(|| JsValue::from_str(&format!("canvas #{canvas_id} not found")))?
            .dyn_into::<HtmlCanvasElement>()
            .map_err(|_| JsValue::from_str("element is not a canvas"))?;

        let gl = canvas
            .get_context("webgl2")?
            .ok_or_else(|| JsValue::from_str("WebGL2 not supported"))?
            .dyn_into::<WebGl2RenderingContext>()
            .map_err(|_| JsValue::from_str("not a WebGL2 context"))?;

        Ok(Engine {
            gl,
            clear_color: [0.0, 0.0, 0.0, 1.0],
        })
    }

    /// Render one frame: clear to `clear_color`.
    pub fn frame(&self) {
        let [r, g, b, a] = self.clear_color;
        self.gl.clear_color(r, g, b, a);
        self.gl.clear(WebGl2RenderingContext::COLOR_BUFFER_BIT);
    }

    pub fn set_clear_color(&mut self, r: f32, g: f32, b: f32, a: f32) {
        self.clear_color = [r.clamp(0.0, 1.0), g.clamp(0.0, 1.0), b.clamp(0.0, 1.0), a.clamp(0.0, 1.0)];
    }

    pub fn resize(&self, width: u32, height: u32) {
        self.gl.viewport(0, 0, width as i32, height as i32);
    }
}

/// Pure-Rust testable helper for clamping. Lifted out so we can test the
/// rule without a WebGL context. Kept module-private; `set_clear_color`
/// applies the same clamp inline so this stays a unit-test seam.
pub(crate) fn clamp_color(c: [f32; 4]) -> [f32; 4] {
    [
        c[0].clamp(0.0, 1.0),
        c[1].clamp(0.0, 1.0),
        c[2].clamp(0.0, 1.0),
        c[3].clamp(0.0, 1.0),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamp_color_clamps_above_one() {
        assert_eq!(clamp_color([1.5, 0.5, -0.2, 2.0]), [1.0, 0.5, 0.0, 1.0]);
    }

    #[test]
    fn clamp_color_passes_through_in_range() {
        assert_eq!(clamp_color([0.1, 0.2, 0.3, 0.4]), [0.1, 0.2, 0.3, 0.4]);
    }
}
