//! The engine ties rule + visualization + playback state together and exposes
//! the wasm-bindgen surface the JS shell drives.

use std::any::Any;

use serde::Serialize;
use serde_json::Value;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use web_sys::{HtmlCanvasElement, WebGl2RenderingContext};

/// Serialize a Rust value to a plain JS Object (not Map). serde-wasm-bindgen's
/// default treats serde maps as JS Maps, which doesn't play nicely with the
/// panel's normal property access; flipping this once means every getter
/// below returns a plain Object.
fn to_js(value: &impl Serialize) -> JsValue {
    let serializer = serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true);
    value.serialize(&serializer).unwrap_or(JsValue::NULL)
}

pub mod erased;
pub mod playback;

use crate::config::ConfigSchema;
use crate::rules::sierpinski_chaos::{ChaosGameConfig, SierpinskiChaos};
use crate::traits::InputEvent;
use crate::visualizations::sierpinski_pyramid::{SierpinskiPyramid, SierpinskiPyramidVizConfig};
use erased::{ErasedRule, ErasedVisualization};
use playback::{advance_time, reduce, Command, PlaybackState};

#[wasm_bindgen]
pub struct Engine {
    gl: WebGl2RenderingContext,
    rule: Box<dyn ErasedRule>,
    viz: Box<dyn ErasedVisualization>,
    rule_cfg: Value,
    viz_cfg: Value,
    state: Box<dyn Any>,
    playback: PlaybackState,
    last_frame_ms: Option<f64>,
}

#[wasm_bindgen]
impl Engine {
    /// Construct an Engine bound to the canvas with id `canvas_id`. Currently
    /// hardwires SierpinskiChaos + SierpinskiPyramid (a rotating 3D Sierpinski
    /// tetrahedron); a future rule/viz registry + selector UI will let the JS
    /// layer pick the pair (the midpoint-on-circle and color-cycle rules stay
    /// in the codebase as alternative options).
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

        let rule_cfg = ChaosGameConfig::defaults();
        let viz_cfg = SierpinskiPyramidVizConfig::defaults();
        let max_iter = serde_json::from_value::<ChaosGameConfig>(rule_cfg.clone())
            .map(|c| c.max_iterations)
            .unwrap_or(50_000);

        let rule: Box<dyn ErasedRule> = Box::new(SierpinskiChaos);
        let mut viz: Box<dyn ErasedVisualization> = Box::new(SierpinskiPyramid::new());

        viz.init(&gl, &viz_cfg)
            .map_err(|e| JsValue::from_str(&format!("viz init: {e}")))?;

        let state = rule
            .init(&rule_cfg, 0)
            .map_err(|e| JsValue::from_str(&format!("rule init: {e}")))?;

        Ok(Engine {
            gl,
            rule,
            viz,
            rule_cfg,
            viz_cfg,
            state,
            playback: PlaybackState::initial(0, max_iter),
            last_frame_ms: None,
        })
    }

    /// rAF callback. `now_ms` is `performance.now()` from JS.
    pub fn frame(&mut self, now_ms: f64) {
        let dt = match self.last_frame_ms {
            None => 0.0,
            Some(prev) => ((now_ms - prev) as f32 / 1000.0).max(0.0),
        };
        self.last_frame_ms = Some(now_ms);

        let prev_iter = self.playback.iteration;
        let rolled = advance_time(&mut self.playback, dt);
        if rolled > 0 || self.playback.iteration != prev_iter {
            // advance_time rolled past one or more iterations: bring scene
            // state up to the new integer iteration.
            if let Err(e) = self.rule.advance_to(
                self.state.as_mut(),
                &self.rule_cfg,
                self.playback.seed,
                self.playback.iteration,
            ) {
                warn(&format!("rule.advance_to failed: {e}"));
            }
        }

        // Always interpolate within the current iteration.
        if let Err(e) = self.rule.substep(
            self.state.as_mut(),
            &self.rule_cfg,
            self.playback.seed,
            self.playback.iteration,
            self.playback.sub_progress,
        ) {
            warn(&format!("rule.substep failed: {e}"));
        }

        self.viz.tick(dt);
        if let Err(e) = self
            .viz
            .render(&self.gl, self.state.as_ref(), &self.viz_cfg)
        {
            warn(&format!("viz.render failed: {e}"));
        }
    }

    /// Receive a Command from JS. `cmd` deserializes to `playback::Command`.
    pub fn dispatch(&mut self, cmd: JsValue) -> Result<(), JsValue> {
        let parsed: Command = serde_wasm_bindgen::from_value(cmd)
            .map_err(|e| JsValue::from_str(&format!("bad command: {e}")))?;
        let caps = self.rule.capabilities();
        let r = reduce(self.playback, caps, &parsed);
        self.playback = r.next;

        if r.iteration_changed {
            // Cheap-recompute path: rebuild state from scratch up to current.
            if r.seed_changed || caps.cheap_recompute {
                let new_state = self
                    .rule
                    .init(&self.rule_cfg, self.playback.seed)
                    .map_err(|e| JsValue::from_str(&format!("rule init: {e}")))?;
                self.state = new_state;
            }
            let _ = self.rule.advance_to(
                self.state.as_mut(),
                &self.rule_cfg,
                self.playback.seed,
                self.playback.iteration,
            );
        }
        Ok(())
    }

    /// Snapshot the playback state for the UI to read each frame.
    pub fn snapshot(&self) -> JsValue {
        to_js(&self.playback)
    }

    pub fn rule_schema(&self) -> JsValue {
        to_js(&self.rule.schema())
    }

    pub fn viz_schema(&self) -> JsValue {
        to_js(&self.viz.schema())
    }

    pub fn rule_config(&self) -> JsValue {
        to_js(&self.rule_cfg)
    }

    pub fn viz_config(&self) -> JsValue {
        to_js(&self.viz_cfg)
    }

    /// Replace the rule config and reset playback. Phase 4's panel will call
    /// this on structural field edits.
    pub fn update_rule_config(&mut self, cfg: JsValue) -> Result<(), JsValue> {
        let parsed: Value = serde_wasm_bindgen::from_value(cfg)
            .map_err(|e| JsValue::from_str(&format!("bad rule config: {e}")))?;
        let new_max = serde_json::from_value::<ChaosGameConfig>(parsed.clone())
            .map(|c| c.max_iterations.max(1))
            .unwrap_or(self.playback.max_iterations);

        self.rule_cfg = parsed;
        self.playback.iteration = 0;
        self.playback.sub_progress = 0.0;
        self.playback.playing = false;
        self.playback.max_iterations = new_max;
        // The user may have spent seconds in a config panel before committing;
        // the next frame() must not feed that gap as `dt` into viz.tick().
        self.last_frame_ms = None;

        let new_state = self
            .rule
            .init(&self.rule_cfg, self.playback.seed)
            .map_err(|e| JsValue::from_str(&format!("rule init: {e}")))?;
        self.state = new_state;
        Ok(())
    }

    /// Replace the visualization config. Cosmetic-only edits don't reset
    /// playback; the engine doesn't enforce that distinction yet — the panel
    /// in Phase 4 will batch cosmetic vs structural separately.
    pub fn update_viz_config(&mut self, cfg: JsValue) -> Result<(), JsValue> {
        let parsed: Value = serde_wasm_bindgen::from_value(cfg)
            .map_err(|e| JsValue::from_str(&format!("bad viz config: {e}")))?;
        self.viz_cfg = parsed;
        self.viz
            .init(&self.gl, &self.viz_cfg)
            .map_err(|e| JsValue::from_str(&format!("viz init: {e}")))?;
        // Same rationale as update_rule_config: don't feed a stale dt to tick.
        self.last_frame_ms = None;
        Ok(())
    }

    pub fn capabilities(&self) -> JsValue {
        to_js(&self.rule.capabilities())
    }

    pub fn resize(&mut self, width: u32, height: u32) {
        self.viz.resize(&self.gl, width, height);
    }

    /// Apply a multiplicative zoom to the active visualization. 1.0 = the
    /// viz's default fit-to-content framing; >1 zooms in. Vizzes that don't
    /// support zoom silently ignore this.
    pub fn set_zoom(&mut self, zoom: f32) {
        self.viz.set_zoom(zoom);
    }

    /// Forward a pointer/keyboard event from the canvas. JS shape matches
    /// the `InputEvent` enum (`{kind:"PointerMove", x:..., ...}` etc.).
    pub fn forward_input(&mut self, ev: JsValue) -> Result<(), JsValue> {
        let parsed: InputEvent = serde_wasm_bindgen::from_value(ev)
            .map_err(|e| JsValue::from_str(&format!("bad input: {e}")))?;
        self.viz.handle_input(&parsed);
        Ok(())
    }
}

/// Log a warning to the browser console. Used by `frame()` to surface
/// errors from rule/viz dispatch that would otherwise be silent. (In Phase 2
/// these can't happen at runtime — the rule + viz are hardwired — but Phase
/// 3+ multiple rules make this real.)
fn warn(msg: &str) {
    web_sys::console::warn_1(&JsValue::from_str(msg));
}

#[cfg(test)]
mod tests {
    // No native unit tests for the Engine itself — it requires WebGL. See
    // crates/viz-core/tests/wasm.rs for browser-side tests (Task 9).
}
