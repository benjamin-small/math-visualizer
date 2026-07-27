//! The flagship rule: random reference points on and inside a unit circle,
//! permanent midpoints accumulating across iterations. Deterministic given
//! (seed, iteration_index) via splitmix64 mixing.

use serde::{Deserialize, Serialize};

use crate::config::{number_property, ConfigSchema, NumberOpts};
use crate::traits::{Capabilities, Rule, SceneState};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MidpointConfig {
    pub max_iterations: u32,
}

impl Default for MidpointConfig {
    fn default() -> Self {
        // 100 iterations: enough to see the pattern emerge, fast enough that
        // play-through at default speed completes in a comfortable time.
        Self {
            max_iterations: 100,
        }
    }
}

impl ConfigSchema for MidpointConfig {
    fn schema() -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "max_iterations": number_property(NumberOpts {
                    label: "Iterations",
                    default: 100.0,
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
        serde_json::to_value(MidpointConfig::default()).unwrap()
    }
}

#[derive(Debug, Default)]
pub struct MidpointState {
    pub permanent: Vec<[f32; 2]>,
    pub ref_perimeter: Option<[f32; 2]>,
    pub ref_interior: Option<[f32; 2]>,
    pub preview_midpoint: Option<[f32; 2]>,
    pub current_iteration: u32,
}

impl SceneState for MidpointState {
    fn clear(&mut self) {
        self.permanent.clear();
        self.ref_perimeter = None;
        self.ref_interior = None;
        self.preview_midpoint = None;
        self.current_iteration = 0;
    }
}

pub struct MidpointOnCircle;

impl Rule for MidpointOnCircle {
    type Config = MidpointConfig;
    type State = MidpointState;

    fn id(&self) -> &'static str {
        "midpoint-on-circle"
    }
    fn capabilities(&self) -> Capabilities {
        Capabilities::cheap_scrubbable()
    }

    fn init(&self, _cfg: &Self::Config, _seed: u64) -> Self::State {
        MidpointState::default()
    }

    /// Rebuild `permanent` to reflect n full iterations completed. Reference
    /// dots are cleared (they're an animation artifact, set by `substep`).
    fn advance_to(&self, state: &mut Self::State, cfg: &Self::Config, seed: u64, n: u32) {
        state.permanent.clear();
        state.ref_perimeter = None;
        state.ref_interior = None;
        state.preview_midpoint = None;

        let target = n.min(cfg.max_iterations);
        for i in 0..target {
            let (perim, interior) = sample_iter(seed, i);
            state.permanent.push(midpoint(perim, interior));
        }
        state.current_iteration = target;
    }

    /// Animate iteration `n` in [0, 1] sub-progress.
    fn substep(&self, state: &mut Self::State, cfg: &Self::Config, seed: u64, n: u32, sub: f32) {
        if n >= cfg.max_iterations {
            // Past the end: no in-flight animation.
            state.ref_perimeter = None;
            state.ref_interior = None;
            state.preview_midpoint = None;
            return;
        }
        let (perim, interior) = sample_iter(seed, n);
        let sub = sub.clamp(0.0, 1.0);
        if sub < 0.33 {
            state.ref_perimeter = Some(perim);
            state.ref_interior = None;
            state.preview_midpoint = None;
        } else if sub < 0.66 {
            state.ref_perimeter = Some(perim);
            state.ref_interior = Some(interior);
            state.preview_midpoint = None;
        } else {
            state.ref_perimeter = Some(perim);
            state.ref_interior = Some(interior);
            state.preview_midpoint = Some(midpoint(perim, interior));
        }
    }
}

fn midpoint(a: [f32; 2], b: [f32; 2]) -> [f32; 2] {
    [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5]
}

/// SplitMix64 — fast, deterministic mixer. Used per-iteration so jumping to
/// any iteration produces the same dots without replaying history.
fn splitmix64(mut z: u64) -> u64 {
    z = z.wrapping_add(0x9E3779B97F4A7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D049BB133111EB);
    z ^ (z >> 31)
}

/// Two random f32s in [0, 1).
fn rand_f32_pair(state: u64) -> (f32, f32, u64) {
    let a = splitmix64(state);
    let b = splitmix64(a);
    let f1 = ((a >> 8) as u32 & 0x00FFFFFF) as f32 / (1 << 24) as f32;
    let f2 = ((b >> 8) as u32 & 0x00FFFFFF) as f32 / (1 << 24) as f32;
    (f1, f2, b)
}

/// Sample one iteration's reference perimeter point and interior point.
/// Perimeter: theta ~ U[0, 2π), point = (cos θ, sin θ).
/// Interior: rejection sample (x, y) ~ U[-1, 1]^2 until x²+y² < 1.
fn sample_iter(seed: u64, iter: u32) -> ([f32; 2], [f32; 2]) {
    let s = splitmix64(seed ^ (iter as u64));
    let (theta_unit, _, s) = rand_f32_pair(s);
    let theta = theta_unit * std::f32::consts::TAU;
    let perim = [theta.cos(), theta.sin()];

    let mut state = s;
    loop {
        let (u, v, next) = rand_f32_pair(state);
        state = next;
        let x = u * 2.0 - 1.0;
        let y = v * 2.0 - 1.0;
        if x * x + y * y < 1.0 {
            return (perim, [x, y]);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn perimeter_point_is_on_unit_circle() {
        for i in 0..50 {
            let (perim, _) = sample_iter(0, i);
            let r = (perim[0] * perim[0] + perim[1] * perim[1]).sqrt();
            assert!((r - 1.0).abs() < 1e-4, "iter {i}: perimeter r = {r}");
        }
    }

    #[test]
    fn interior_point_is_strictly_inside_unit_circle() {
        for i in 0..50 {
            let (_, interior) = sample_iter(42, i);
            let r2 = interior[0] * interior[0] + interior[1] * interior[1];
            assert!(r2 < 1.0, "iter {i}: interior r² = {r2}");
        }
    }

    #[test]
    fn advance_to_is_deterministic_given_seed() {
        let rule = MidpointOnCircle;
        let cfg = MidpointConfig::default();
        let mut a = rule.init(&cfg, 0);
        rule.advance_to(&mut a, &cfg, 17, 25);
        let mut b = rule.init(&cfg, 0);
        rule.advance_to(&mut b, &cfg, 17, 25);
        assert_eq!(a.permanent, b.permanent);
    }

    #[test]
    fn advance_to_is_jump_safe() {
        let rule = MidpointOnCircle;
        let cfg = MidpointConfig::default();
        // From 0, jump to 25 directly.
        let mut direct = rule.init(&cfg, 99);
        rule.advance_to(&mut direct, &cfg, 99, 25);
        // From 25, advance again to 25 — should be a no-op (idempotent).
        rule.advance_to(&mut direct, &cfg, 99, 25);
        assert_eq!(direct.permanent.len(), 25);
        // From 25, advance backward to 10 — should produce the same first
        // 10 points the first jump-to-25 path produced.
        let mut backward = rule.init(&cfg, 99);
        rule.advance_to(&mut backward, &cfg, 99, 10);
        assert_eq!(&direct.permanent[..10], &backward.permanent[..]);
    }

    #[test]
    fn advance_to_clamps_to_max_iterations() {
        let rule = MidpointOnCircle;
        let cfg = MidpointConfig { max_iterations: 10 };
        let mut state = rule.init(&cfg, 0);
        rule.advance_to(&mut state, &cfg, 0, 999);
        assert_eq!(state.permanent.len(), 10);
        assert_eq!(state.current_iteration, 10);
    }

    #[test]
    fn substep_phases() {
        let rule = MidpointOnCircle;
        let cfg = MidpointConfig::default();
        let mut state = rule.init(&cfg, 0);
        rule.advance_to(&mut state, &cfg, 7, 5);

        rule.substep(&mut state, &cfg, 7, 5, 0.10);
        assert!(state.ref_perimeter.is_some());
        assert!(state.ref_interior.is_none());
        assert!(state.preview_midpoint.is_none());

        rule.substep(&mut state, &cfg, 7, 5, 0.45);
        assert!(state.ref_perimeter.is_some());
        assert!(state.ref_interior.is_some());
        assert!(state.preview_midpoint.is_none());

        rule.substep(&mut state, &cfg, 7, 5, 0.80);
        assert!(state.ref_perimeter.is_some());
        assert!(state.ref_interior.is_some());
        assert!(state.preview_midpoint.is_some());
    }

    #[test]
    fn substep_at_or_past_max_clears_ref_dots() {
        let rule = MidpointOnCircle;
        let cfg = MidpointConfig { max_iterations: 5 };
        let mut state = rule.init(&cfg, 0);
        rule.advance_to(&mut state, &cfg, 0, 5);
        rule.substep(&mut state, &cfg, 0, 5, 0.5);
        assert!(state.ref_perimeter.is_none());
        assert!(state.ref_interior.is_none());
        assert!(state.preview_midpoint.is_none());
    }

    #[test]
    fn midpoint_is_the_average() {
        let m = midpoint([0.0, 0.0], [2.0, 4.0]);
        assert_eq!(m, [1.0, 2.0]);
    }

    #[test]
    fn splitmix64_is_deterministic() {
        assert_eq!(splitmix64(42), splitmix64(42));
        assert_ne!(splitmix64(42), splitmix64(43));
    }
}
