//! Demo rule: hue cycles with iteration count.
//!
//! State is just the current integer iteration and substep progress. The
//! paired viz reads those to compute a clear-color. This exercises the full
//! Rule/Visualization/Engine plumbing with zero shader work.

use serde::{Deserialize, Serialize};

use crate::config::{number_property, ConfigSchema, NumberOpts};
use crate::traits::{Capabilities, Rule, SceneState};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColorCycleConfig {
    pub max_iterations: u32,
}

impl Default for ColorCycleConfig {
    fn default() -> Self { Self { max_iterations: 360 } }
}

impl ConfigSchema for ColorCycleConfig {
    fn schema() -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "max_iterations": number_property(NumberOpts {
                    label: "Iterations",
                    default: 360.0,
                    min: 1.0,
                    max: 10_000.0,
                    step: 1.0,
                    integer: true,
                    cosmetic: false,
                    widget: None,
                }),
            },
            "required": ["max_iterations"],
        })
    }

    fn defaults() -> serde_json::Value {
        serde_json::to_value(ColorCycleConfig::default()).unwrap()
    }
}

#[derive(Debug, Default)]
pub struct ColorCycleState {
    pub iteration: u32,
    pub sub_progress: f32,
}

impl SceneState for ColorCycleState {
    fn clear(&mut self) {
        self.iteration = 0;
        self.sub_progress = 0.0;
    }
}

pub struct ColorCycleRule;

impl Rule for ColorCycleRule {
    type Config = ColorCycleConfig;
    type State = ColorCycleState;

    fn id(&self) -> &'static str { "demo:color-cycle" }
    fn capabilities(&self) -> Capabilities { Capabilities::cheap_scrubbable() }

    fn init(&self, _cfg: &Self::Config, _seed: u64) -> Self::State {
        ColorCycleState::default()
    }

    fn advance_to(
        &self,
        state: &mut Self::State,
        cfg: &Self::Config,
        _seed: u64,
        n: u32,
    ) {
        state.iteration = n.min(cfg.max_iterations);
        state.sub_progress = 0.0;
    }

    fn substep(
        &self,
        state: &mut Self::State,
        _cfg: &Self::Config,
        _seed: u64,
        _n: u32,
        sub: f32,
    ) {
        state.sub_progress = sub.clamp(0.0, 1.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn advance_to_clamps_to_max() {
        let rule = ColorCycleRule;
        let cfg = ColorCycleConfig { max_iterations: 100 };
        let mut state = rule.init(&cfg, 0);
        rule.advance_to(&mut state, &cfg, 0, 999);
        assert_eq!(state.iteration, 100);
    }

    #[test]
    fn advance_to_is_idempotent() {
        let rule = ColorCycleRule;
        let cfg = ColorCycleConfig::default();
        let mut state = rule.init(&cfg, 42);
        rule.advance_to(&mut state, &cfg, 42, 25);
        let snap_a = (state.iteration, state.sub_progress);
        rule.advance_to(&mut state, &cfg, 42, 25);
        let snap_b = (state.iteration, state.sub_progress);
        assert_eq!(snap_a, snap_b);
    }

    #[test]
    fn substep_clamps() {
        let rule = ColorCycleRule;
        let cfg = ColorCycleConfig::default();
        let mut state = rule.init(&cfg, 0);
        rule.substep(&mut state, &cfg, 0, 0, 1.7);
        assert_eq!(state.sub_progress, 1.0);
        rule.substep(&mut state, &cfg, 0, 0, -0.3);
        assert_eq!(state.sub_progress, 0.0);
    }

    #[test]
    fn schema_round_trips_default_config() {
        let defaults: ColorCycleConfig = serde_json::from_value(ColorCycleConfig::defaults()).unwrap();
        assert_eq!(defaults.max_iterations, 360);
    }

    #[test]
    fn erased_dispatch_round_trips() {
        use crate::engine::erased::ErasedRule;

        let rule: &dyn ErasedRule = &ColorCycleRule;
        let cfg = ColorCycleConfig::defaults();
        let mut state = rule.init(&cfg, 0).expect("init");
        rule.advance_to(state.as_mut(), &cfg, 0, 17).expect("advance_to");

        // Downcast back to the concrete type and verify.
        let typed = state.downcast_ref::<ColorCycleState>().expect("downcast");
        assert_eq!(typed.iteration, 17);
    }
}
