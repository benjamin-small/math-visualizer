//! Type-erased wrappers over Rule and Visualization. The engine holds these
//! behind Box<dyn …>; `TypedRule<R>` / `TypedViz<V>` adapt any concrete
//! Rule / Visualization to the erased traits.
//!
//! Rationale: Rule has associated types (Config, State) so it can't be
//! `dyn Rule` directly. The erased layer trades compile-time safety inside
//! the engine for the ability to swap rules at runtime. Inside each concrete
//! rule, the typed Rule trait still gives full safety.
//!
//! The wrappers own the *parsed* config. The engine calls `substep` and
//! `render` every frame and `advance_to` on every iteration rollover; if each
//! of those re-parsed a `serde_json::Value` (as they once did), a large
//! config — e.g. a Fourier lab's ~2000-point path — would cost milliseconds
//! per frame for nothing. Instead `set_config` parses once, on change, and
//! the hot path borrows the cached struct.

use std::any::Any;

use serde_json::Value;
use web_sys::WebGl2RenderingContext;

use crate::config::ConfigSchema;
use crate::traits::{Capabilities, InputEvent, Rule, Visualization};

/// Errors returned by erased dispatch.
#[derive(Debug)]
pub enum ErasedError {
    StateDowncastFailed,
    ConfigParse(serde_json::Error),
    /// The active rule's config has no path (`Rule::apply_path` returned false).
    PathUnsupported,
}

impl std::fmt::Display for ErasedError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ErasedError::StateDowncastFailed => f.write_str("scene state has wrong concrete type"),
            ErasedError::ConfigParse(e) => write!(f, "config parse error: {e}"),
            ErasedError::PathUnsupported => f.write_str("this rule does not accept a path"),
        }
    }
}

impl std::error::Error for ErasedError {}

pub trait ErasedRule {
    fn id(&self) -> &'static str;
    fn capabilities(&self) -> Capabilities;
    fn schema(&self) -> Value;
    fn defaults(&self) -> Value;

    /// Replace the cached config. Parse-then-swap: on error the previous
    /// config is kept, so a rejected update never leaves the rule
    /// half-applied.
    fn set_config(&mut self, cfg: &Value) -> Result<(), ErasedError>;

    /// Parse the scalar fields from `cfg`, then install `xy`/`pen` as the
    /// path via `Rule::apply_path`. Atomic: the old config survives any error.
    fn set_config_with_path(
        &mut self,
        cfg: &Value,
        xy: &[f32],
        pen: &[u8],
    ) -> Result<(), ErasedError>;
    /// The current typed config, serialized on demand (large paths included —
    /// callers that only need scalars should avoid calling this per frame).
    fn config_json(&self) -> Value;

    fn init(&self, seed: u64) -> Box<dyn Any>;
    fn advance_to(&self, state: &mut dyn Any, seed: u64, n: u32) -> Result<(), ErasedError>;
    fn substep(&self, state: &mut dyn Any, seed: u64, n: u32, sub: f32) -> Result<(), ErasedError>;
    fn summary(&self, state: &dyn Any) -> Result<Value, ErasedError>;
}

/// A concrete `Rule` together with its deserialized config.
pub struct TypedRule<R: Rule> {
    rule: R,
    cfg: R::Config,
}

impl<R: Rule> TypedRule<R> {
    /// Starts with the rule's schema defaults, which are valid by
    /// construction. (The `expect` is guarded natively by the registry's
    /// `every_registered_id_builds` test, which constructs every lab.)
    pub fn new(rule: R) -> Self {
        let cfg = serde_json::from_value(<R::Config as ConfigSchema>::defaults())
            .expect("config defaults must deserialize");
        Self { rule, cfg }
    }
}

impl<R> ErasedRule for TypedRule<R>
where
    R: Rule,
    R::State: 'static,
{
    fn id(&self) -> &'static str {
        self.rule.id()
    }
    fn capabilities(&self) -> Capabilities {
        self.rule.capabilities()
    }
    fn schema(&self) -> Value {
        <R::Config as ConfigSchema>::schema()
    }
    fn defaults(&self) -> Value {
        <R::Config as ConfigSchema>::defaults()
    }

    fn set_config(&mut self, cfg: &Value) -> Result<(), ErasedError> {
        // The only clone + parse left in this module; it runs on config
        // updates, never per frame. The `?` fires before the assignment,
        // so `self.cfg` is untouched on error.
        self.cfg = serde_json::from_value(cfg.clone()).map_err(ErasedError::ConfigParse)?;
        Ok(())
    }

    fn set_config_with_path(
        &mut self,
        cfg: &Value,
        xy: &[f32],
        pen: &[u8],
    ) -> Result<(), ErasedError> {
        let mut typed: R::Config =
            serde_json::from_value(cfg.clone()).map_err(ErasedError::ConfigParse)?;
        if !self.rule.apply_path(&mut typed, xy, pen) {
            return Err(ErasedError::PathUnsupported);
        }
        self.cfg = typed;
        Ok(())
    }

    fn config_json(&self) -> Value {
        serde_json::to_value(&self.cfg).unwrap_or(Value::Null)
    }

    fn init(&self, seed: u64) -> Box<dyn Any> {
        Box::new(self.rule.init(&self.cfg, seed))
    }

    fn advance_to(&self, state: &mut dyn Any, seed: u64, n: u32) -> Result<(), ErasedError> {
        let typed_state = state
            .downcast_mut::<R::State>()
            .ok_or(ErasedError::StateDowncastFailed)?;
        self.rule.advance_to(typed_state, &self.cfg, seed, n);
        Ok(())
    }

    fn substep(&self, state: &mut dyn Any, seed: u64, n: u32, sub: f32) -> Result<(), ErasedError> {
        let typed_state = state
            .downcast_mut::<R::State>()
            .ok_or(ErasedError::StateDowncastFailed)?;
        self.rule.substep(typed_state, &self.cfg, seed, n, sub);
        Ok(())
    }

    fn summary(&self, state: &dyn Any) -> Result<Value, ErasedError> {
        let typed = state
            .downcast_ref::<R::State>()
            .ok_or(ErasedError::StateDowncastFailed)?;
        Ok(self.rule.summary(typed))
    }
}

pub trait ErasedVisualization {
    fn id(&self) -> &'static str;
    fn schema(&self) -> Value;
    fn defaults(&self) -> Value;

    /// Replace the cached config. Parse-then-swap; see `ErasedRule::set_config`.
    fn set_config(&mut self, cfg: &Value) -> Result<(), ErasedError>;

    fn init(&mut self, gl: &WebGl2RenderingContext);
    fn render(&mut self, gl: &WebGl2RenderingContext, state: &dyn Any) -> Result<(), ErasedError>;
    fn resize(&mut self, gl: &WebGl2RenderingContext, w: u32, h: u32);
    fn handle_input(&mut self, ev: &InputEvent);
    fn tick(&mut self, dt: f32);
    fn set_zoom(&mut self, zoom: f32);
}

/// A concrete `Visualization` together with its deserialized config.
pub struct TypedViz<V: Visualization> {
    viz: V,
    cfg: V::Config,
}

impl<V: Visualization> TypedViz<V> {
    /// Starts with the visualization's schema defaults; see `TypedRule::new`.
    pub fn new(viz: V) -> Self {
        let cfg = serde_json::from_value(<V::Config as ConfigSchema>::defaults())
            .expect("config defaults must deserialize");
        Self { viz, cfg }
    }
}

impl<V> ErasedVisualization for TypedViz<V>
where
    V: Visualization,
    V::State: 'static,
{
    fn id(&self) -> &'static str {
        self.viz.id()
    }
    fn schema(&self) -> Value {
        <V::Config as ConfigSchema>::schema()
    }
    fn defaults(&self) -> Value {
        <V::Config as ConfigSchema>::defaults()
    }

    fn set_config(&mut self, cfg: &Value) -> Result<(), ErasedError> {
        self.cfg = serde_json::from_value(cfg.clone()).map_err(ErasedError::ConfigParse)?;
        Ok(())
    }

    fn init(&mut self, gl: &WebGl2RenderingContext) {
        self.viz.init(gl, &self.cfg);
    }

    fn render(&mut self, gl: &WebGl2RenderingContext, state: &dyn Any) -> Result<(), ErasedError> {
        let typed_state = state
            .downcast_ref::<V::State>()
            .ok_or(ErasedError::StateDowncastFailed)?;
        self.viz.render(gl, typed_state, &self.cfg);
        Ok(())
    }

    fn resize(&mut self, gl: &WebGl2RenderingContext, w: u32, h: u32) {
        self.viz.resize(gl, w, h);
    }

    fn handle_input(&mut self, ev: &InputEvent) {
        self.viz.handle_input(ev);
    }

    fn tick(&mut self, dt: f32) {
        self.viz.tick(dt);
    }

    fn set_zoom(&mut self, zoom: f32) {
        self.viz.set_zoom(zoom);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::sierpinski_chaos::{ChaosGameState, SierpinskiChaos};
    use crate::visualizations::sierpinski_pyramid::SierpinskiPyramid;
    use serde_json::json;

    /// Run `n` iterations from a fresh state and return how many trail dots
    /// the rule produced — i.e. `min(n, cfg.max_iterations)`.
    fn trail_len_after(rule: &dyn ErasedRule, n: u32) -> usize {
        let mut state = rule.init(0);
        rule.advance_to(&mut *state, 0, n).expect("advance_to");
        state
            .downcast_ref::<ChaosGameState>()
            .expect("downcast")
            .trail
            .len()
    }

    #[test]
    fn typed_rule_starts_with_defaults() {
        let rule = TypedRule::new(SierpinskiChaos);
        assert_eq!(rule.id(), "sierpinski-chaos");
        // Default max_iterations is 50_000, so 10 is not clamped.
        assert_eq!(trail_len_after(&rule, 10), 10);
    }

    #[test]
    fn set_config_is_atomic_on_error() {
        let mut rule = TypedRule::new(SierpinskiChaos);
        rule.set_config(&json!({"max_iterations": 5}))
            .expect("valid config");
        assert_eq!(trail_len_after(&rule, 999), 5);

        let err = rule
            .set_config(&json!({"max_iterations": "not a number"}))
            .expect_err("bad config must be rejected");
        assert!(matches!(err, ErasedError::ConfigParse(_)), "{err:?}");

        // The rejected update left the previous config in place.
        assert_eq!(trail_len_after(&rule, 999), 5);
    }

    #[test]
    fn advance_to_rejects_wrong_state_type() {
        let rule = TypedRule::new(SierpinskiChaos);
        let mut wrong = 42u8;
        let err = rule
            .advance_to(&mut wrong as &mut dyn Any, 0, 1)
            .expect_err("u8 is not ChaosGameState");
        assert!(matches!(err, ErasedError::StateDowncastFailed), "{err:?}");

        let err = rule
            .substep(&mut wrong as &mut dyn Any, 0, 1, 0.5)
            .expect_err("u8 is not ChaosGameState");
        assert!(matches!(err, ErasedError::StateDowncastFailed), "{err:?}");
    }

    #[test]
    fn typed_viz_config_and_identity() {
        // init/render need a GL context; everything else is testable natively.
        let mut viz = TypedViz::new(SierpinskiPyramid::new());
        assert_eq!(viz.id(), "sierpinski-pyramid");
        assert!(viz.schema().is_object());
        assert!(viz.defaults().is_object());

        let err = viz
            .set_config(&json!({"background": "not a color"}))
            .expect_err("bad config must be rejected");
        assert!(matches!(err, ErasedError::ConfigParse(_)), "{err:?}");

        viz.set_config(&viz.defaults())
            .expect("defaults round-trip");
    }

    #[test]
    fn summary_defaults_to_null_and_rejects_wrong_state() {
        let rule = TypedRule::new(SierpinskiChaos);
        let state = rule.init(0);
        assert!(rule.summary(state.as_ref()).unwrap().is_null());
        let wrong: u8 = 42;
        assert!(matches!(
            rule.summary(&wrong),
            Err(ErasedError::StateDowncastFailed)
        ));
    }
}

#[cfg(test)]
mod path_tests {
    use super::*;
    use crate::rules::fourier_epicycles::FourierEpicycles;
    use crate::rules::sierpinski_chaos::SierpinskiChaos;
    use serde_json::json;

    const XY: [f32; 8] = [1.0, 0.0, 0.0, 1.0, -1.0, 0.0, 0.0, -1.0];
    const PEN: [u8; 4] = [1, 1, 1, 0];

    #[test]
    fn typed_array_path_installs_into_a_path_rule() {
        let mut r = TypedRule::new(FourierEpicycles);
        r.set_config_with_path(&json!({"epicycles": 3, "max_iterations": 4}), &XY, &PEN)
            .expect("fourier accepts a path");
        let cfg = r.config_json();
        assert_eq!(cfg["epicycles"], 3);
        let path = cfg["path"].as_array().expect("path array");
        assert_eq!(path.len(), 4);
        assert_eq!(path[3]["pen"], false);
        assert_eq!(path[1]["y"], 1.0);
    }

    #[test]
    fn typed_array_path_is_rejected_by_rules_without_one() {
        let mut r = TypedRule::new(SierpinskiChaos);
        let before = r.config_json();
        let err = r
            .set_config_with_path(&json!({"max_iterations": 10}), &XY, &PEN)
            .expect_err("sierpinski has no path");
        assert!(matches!(err, ErasedError::PathUnsupported));
        assert_eq!(r.config_json(), before, "config untouched on error");
    }
}
