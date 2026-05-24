//! Core framework traits. Implemented by concrete rules and visualizations.

use serde::{de::DeserializeOwned, Serialize};
use web_sys::WebGl2RenderingContext;

use crate::config::ConfigSchema;

/// A rule's state. Marker trait; the rule and visualization paired with it
/// know its concrete type. The engine treats it as opaque (via `dyn Any`).
pub trait SceneState: 'static {
    /// Reset to the empty/initial state. Called by `Rule::init` rebuilds.
    fn clear(&mut self);
}

/// Declares what playback operations a rule supports.
#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize)]
pub struct Capabilities {
    pub supports_scrub: bool,
    pub cheap_recompute: bool,
    pub checkpoint_every: Option<u32>,
}

impl Capabilities {
    /// The simplest rule: cheap to recompute from scratch, supports scrubbing.
    /// Used by ColorCycleRule and by any rule whose advance_to is O(n).
    pub const fn cheap_scrubbable() -> Self {
        Self { supports_scrub: true, cheap_recompute: true, checkpoint_every: None }
    }
}

/// A rule computes per-iteration state from `(config, seed, iteration_index)`.
pub trait Rule {
    type Config: ConfigSchema + Serialize + DeserializeOwned;
    type State: SceneState;

    fn id(&self) -> &'static str;
    fn capabilities(&self) -> Capabilities;

    fn init(&self, cfg: &Self::Config, seed: u64) -> Self::State;

    /// Advance `state` so it reflects iteration `n` (i.e. n full iterations
    /// have completed). Idempotent for the same n. For cheap-recompute rules
    /// this typically clears `state` and runs from 0..n.
    fn advance_to(&self, state: &mut Self::State, cfg: &Self::Config, seed: u64, n: u32);

    /// Interpolated state within iteration `n`. `sub` ∈ [0, 1]. Default: no-op.
    /// Should NOT push permanent state changes — those are owned by `advance_to`.
    fn substep(&self, _state: &mut Self::State, _cfg: &Self::Config, _seed: u64, _n: u32, _sub: f32) {}
}

/// A visualization renders a rule's state to a WebGL2 context.
pub trait Visualization {
    type State: SceneState;
    type Config: ConfigSchema + Serialize + DeserializeOwned;

    fn id(&self) -> &'static str;

    fn init(&mut self, gl: &WebGl2RenderingContext, cfg: &Self::Config);

    fn render(
        &mut self,
        gl: &WebGl2RenderingContext,
        state: &Self::State,
        cfg: &Self::Config,
    );

    fn resize(&mut self, _gl: &WebGl2RenderingContext, _w: u32, _h: u32) {}

    fn handle_input(&mut self, _ev: &InputEvent) {}

    /// Called once per frame with wall-clock dt (seconds). For camera inertia
    /// and viz-side animations; rule state belongs to the Rule.
    fn tick(&mut self, _dt: f32) {}

    /// Multiplicative zoom factor — 1.0 means fit-to-content (the viz's
    /// default framing); >1 zooms in, <1 zooms out. Visualizations that
    /// support zoom override this; default is no-op.
    fn set_zoom(&mut self, _zoom: f32) {}
}

/// Pointer / keyboard input forwarded from the canvas to the active viz.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind")]
pub enum InputEvent {
    PointerDown { x: f32, y: f32, button: u8 },
    PointerMove { x: f32, y: f32, dx: f32, dy: f32, buttons: u8 },
    PointerUp   { x: f32, y: f32, button: u8 },
    Wheel       { dx: f32, dy: f32 },
    Key         { code: String, down: bool, ctrl: bool, alt: bool, shift: bool, meta: bool },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capabilities_cheap_scrubbable_defaults() {
        let c = Capabilities::cheap_scrubbable();
        assert!(c.supports_scrub);
        assert!(c.cheap_recompute);
        assert!(c.checkpoint_every.is_none());
    }

    #[test]
    fn input_event_round_trips_through_json() {
        let ev = InputEvent::PointerMove { x: 1.0, y: 2.0, dx: 0.1, dy: -0.1, buttons: 1 };
        let json = serde_json::to_string(&ev).unwrap();
        let back: InputEvent = serde_json::from_str(&json).unwrap();
        match back {
            InputEvent::PointerMove { x, y, dx, dy, buttons } => {
                assert!((x - 1.0).abs() < 1e-6);
                assert!((y - 2.0).abs() < 1e-6);
                assert!((dx - 0.1).abs() < 1e-6);
                assert!((dy + 0.1).abs() < 1e-6);
                assert_eq!(buttons, 1);
            }
            other => panic!("wrong variant: {other:?}"),
        }
    }
}
