//! Type-erased wrappers over Rule and Visualization. The engine holds these
//! behind Box<dyn …>; concrete impls of Rule/Visualization auto-impl the
//! erased trait via blanket impls.
//!
//! Rationale: Rule has associated types (Config, State) so it can't be
//! `dyn Rule` directly. The erased layer trades compile-time safety inside
//! the engine for the ability to swap rules at runtime. Inside each concrete
//! rule, the typed Rule trait still gives full safety.

use std::any::Any;

use serde_json::Value;
use web_sys::WebGl2RenderingContext;

use crate::config::ConfigSchema;
use crate::traits::{Capabilities, InputEvent, Rule, SceneState, Visualization};

/// Errors returned by erased dispatch.
#[derive(Debug)]
pub enum ErasedError {
    StateDowncastFailed,
    ConfigParse(serde_json::Error),
}

impl std::fmt::Display for ErasedError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ErasedError::StateDowncastFailed => f.write_str("scene state has wrong concrete type"),
            ErasedError::ConfigParse(e) => write!(f, "config parse error: {e}"),
        }
    }
}

impl std::error::Error for ErasedError {}

pub trait ErasedRule {
    fn id(&self) -> &'static str;
    fn capabilities(&self) -> Capabilities;
    fn schema(&self) -> Value;
    fn defaults(&self) -> Value;

    fn init(&self, cfg: &Value, seed: u64) -> Result<Box<dyn Any>, ErasedError>;
    fn advance_to(
        &self,
        state: &mut dyn Any,
        cfg: &Value,
        seed: u64,
        n: u32,
    ) -> Result<(), ErasedError>;
    fn substep(
        &self,
        state: &mut dyn Any,
        cfg: &Value,
        seed: u64,
        n: u32,
        sub: f32,
    ) -> Result<(), ErasedError>;
}

impl<R> ErasedRule for R
where
    R: Rule,
    R::State: 'static,
{
    fn id(&self) -> &'static str {
        Rule::id(self)
    }
    fn capabilities(&self) -> Capabilities {
        Rule::capabilities(self)
    }
    fn schema(&self) -> Value {
        <R::Config as ConfigSchema>::schema()
    }
    fn defaults(&self) -> Value {
        <R::Config as ConfigSchema>::defaults()
    }

    fn init(&self, cfg: &Value, seed: u64) -> Result<Box<dyn Any>, ErasedError> {
        let typed: R::Config =
            serde_json::from_value(cfg.clone()).map_err(ErasedError::ConfigParse)?;
        let state = Rule::init(self, &typed, seed);
        Ok(Box::new(state))
    }

    fn advance_to(
        &self,
        state: &mut dyn Any,
        cfg: &Value,
        seed: u64,
        n: u32,
    ) -> Result<(), ErasedError> {
        let typed_cfg: R::Config =
            serde_json::from_value(cfg.clone()).map_err(ErasedError::ConfigParse)?;
        let typed_state = state
            .downcast_mut::<R::State>()
            .ok_or(ErasedError::StateDowncastFailed)?;
        Rule::advance_to(self, typed_state, &typed_cfg, seed, n);
        Ok(())
    }

    fn substep(
        &self,
        state: &mut dyn Any,
        cfg: &Value,
        seed: u64,
        n: u32,
        sub: f32,
    ) -> Result<(), ErasedError> {
        let typed_cfg: R::Config =
            serde_json::from_value(cfg.clone()).map_err(ErasedError::ConfigParse)?;
        let typed_state = state
            .downcast_mut::<R::State>()
            .ok_or(ErasedError::StateDowncastFailed)?;
        Rule::substep(self, typed_state, &typed_cfg, seed, n, sub);
        Ok(())
    }
}

pub trait ErasedVisualization {
    fn id(&self) -> &'static str;
    fn schema(&self) -> Value;
    fn defaults(&self) -> Value;

    fn init(&mut self, gl: &WebGl2RenderingContext, cfg: &Value) -> Result<(), ErasedError>;
    fn render(
        &mut self,
        gl: &WebGl2RenderingContext,
        state: &dyn Any,
        cfg: &Value,
    ) -> Result<(), ErasedError>;
    fn resize(&mut self, gl: &WebGl2RenderingContext, w: u32, h: u32);
    fn handle_input(&mut self, ev: &InputEvent);
    fn tick(&mut self, dt: f32);
    fn set_zoom(&mut self, zoom: f32);
}

impl<V> ErasedVisualization for V
where
    V: Visualization,
    V::State: 'static,
{
    fn id(&self) -> &'static str {
        Visualization::id(self)
    }
    fn schema(&self) -> Value {
        <V::Config as ConfigSchema>::schema()
    }
    fn defaults(&self) -> Value {
        <V::Config as ConfigSchema>::defaults()
    }

    fn init(&mut self, gl: &WebGl2RenderingContext, cfg: &Value) -> Result<(), ErasedError> {
        let typed: V::Config =
            serde_json::from_value(cfg.clone()).map_err(ErasedError::ConfigParse)?;
        Visualization::init(self, gl, &typed);
        Ok(())
    }

    fn render(
        &mut self,
        gl: &WebGl2RenderingContext,
        state: &dyn Any,
        cfg: &Value,
    ) -> Result<(), ErasedError> {
        let typed_cfg: V::Config =
            serde_json::from_value(cfg.clone()).map_err(ErasedError::ConfigParse)?;
        let typed_state = state
            .downcast_ref::<V::State>()
            .ok_or(ErasedError::StateDowncastFailed)?;
        Visualization::render(self, gl, typed_state, &typed_cfg);
        Ok(())
    }

    fn resize(&mut self, gl: &WebGl2RenderingContext, w: u32, h: u32) {
        Visualization::resize(self, gl, w, h);
    }

    fn handle_input(&mut self, ev: &InputEvent) {
        Visualization::handle_input(self, ev);
    }

    fn tick(&mut self, dt: f32) {
        Visualization::tick(self, dt);
    }

    fn set_zoom(&mut self, zoom: f32) {
        Visualization::set_zoom(self, zoom);
    }
}

// NOTE: We can't unit-test the erased layer here without a concrete rule
// to wrap. That's covered in Task 5 (where ColorCycleRule provides a real
// concrete type) and Task 9 (browser-level engine round-trip tests).
//
// SceneState bound is used implicitly by the blanket impls via R::State:
// SceneState (from the Rule trait). The unused import is needed so the
// trait path resolves; rustc may warn it's unused — that's expected.
#[allow(unused_imports)]
use SceneState as _;
