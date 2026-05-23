//! Sierpinski Chaos Game: pick one of three triangle corners uniformly at
//! random, move halfway toward it, drop a dot, repeat. Thousands of dots
//! converge on the Sierpinski-triangle attractor.
//!
//! Per-iteration RNG = `splitmix64(seed ^ iter)`. The current position at
//! iteration n depends on the whole sequence 0..n, so `advance_to` is O(n).
//! Cheap enough for the cheap-recompute path.

use serde::{Deserialize, Serialize};

use crate::config::{number_property, ConfigSchema, NumberOpts};
use crate::traits::{Capabilities, Rule, SceneState};

/// Equilateral triangle with edge length 1, centered at the origin.
/// Top, bottom-left, bottom-right.
pub const CORNERS: [[f32; 2]; 3] = [
    [0.0,  0.5773502691896258],   //  sqrt(3) / 3
    [-0.5, -0.2886751345948129],  // -sqrt(3) / 6
    [0.5,  -0.2886751345948129],
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChaosGameConfig {
    pub max_iterations: u32,
}

impl Default for ChaosGameConfig {
    fn default() -> Self {
        // 50k iterations produces a dense, clearly-resolved fractal out of
        // the box. At default playback speed it'd take forever to animate
        // through, but the per-iteration substep animation is the point of
        // the visualization at low max_iterations; for the full pattern,
        // users typically crank the speed slider.
        Self { max_iterations: 50_000 }
    }
}

impl ConfigSchema for ChaosGameConfig {
    fn schema() -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "max_iterations": number_property(NumberOpts {
                    label: "Iterations",
                    default: 50_000.0,
                    min: 1.0,
                    max: 200_000.0,
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
        serde_json::to_value(ChaosGameConfig::default()).unwrap()
    }
}

#[derive(Debug, Default)]
pub struct ChaosGameState {
    /// Random starting point inside the triangle (deterministic from seed).
    pub initial_position: [f32; 2],
    /// One entry per completed iteration: the dot placed by that iteration.
    pub trail: Vec<[f32; 2]>,
    /// Animation dot — set by `substep`, lerps from previous trail dot toward
    /// the next halfway point as sub progresses. `None` between iterations.
    pub current_position: Option<[f32; 2]>,
    /// Index of the corner highlighted during the current substep (0/1/2).
    pub chosen_corner: Option<usize>,
    pub current_iteration: u32,
}

impl SceneState for ChaosGameState {
    fn clear(&mut self) {
        self.initial_position = [0.0, 0.0];
        self.trail.clear();
        self.current_position = None;
        self.chosen_corner = None;
        self.current_iteration = 0;
    }
}

pub struct SierpinskiChaos;

impl Rule for SierpinskiChaos {
    type Config = ChaosGameConfig;
    type State = ChaosGameState;

    fn id(&self) -> &'static str { "sierpinski-chaos" }
    fn capabilities(&self) -> Capabilities { Capabilities::cheap_scrubbable() }

    fn init(&self, _cfg: &Self::Config, _seed: u64) -> Self::State {
        ChaosGameState::default()
    }

    fn advance_to(
        &self,
        state: &mut Self::State,
        cfg: &Self::Config,
        seed: u64,
        n: u32,
    ) {
        state.trail.clear();
        state.chosen_corner = None;

        let target = n.min(cfg.max_iterations);
        state.current_iteration = target;

        let mut pos = random_inside_triangle(seed);
        state.initial_position = pos;
        for i in 0..target {
            let corner_idx = pick_corner(seed, i);
            pos = halfway(pos, CORNERS[corner_idx]);
            state.trail.push(pos);
        }
        state.current_position = Some(pos);
    }

    fn substep(
        &self,
        state: &mut Self::State,
        cfg: &Self::Config,
        seed: u64,
        n: u32,
        sub: f32,
    ) {
        if n >= cfg.max_iterations {
            state.chosen_corner = None;
            return;
        }
        let corner_idx = pick_corner(seed, n);
        let start_pos = if n == 0 {
            state.initial_position
        } else {
            // Safe lookup: if state hasn't been advanced yet, fall back to the
            // initial position. The engine always calls advance_to first.
            state.trail.get((n - 1) as usize).copied().unwrap_or(state.initial_position)
        };
        let end_pos = halfway(start_pos, CORNERS[corner_idx]);
        let sub = sub.clamp(0.0, 1.0);
        state.chosen_corner = Some(corner_idx);
        if sub < 0.33 {
            // Phase 1: corner highlights, but the dot hasn't moved yet — the
            // "start" is either a trail dot (already rendered) or the initial
            // random point. Showing a separate in-flight marker here just
            // looks like a stray dot in the wrong place, especially when the
            // initial position lands in a Sierpinski forbidden region. So we
            // hide it until the move actually starts.
            state.current_position = None;
        } else {
            // Phase 2: dot lerps from start to the halfway point.
            let t = ((sub - 0.33) / 0.67).clamp(0.0, 1.0);
            state.current_position = Some(lerp(start_pos, end_pos, t));
        }
    }
}

fn halfway(a: [f32; 2], b: [f32; 2]) -> [f32; 2] {
    [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5]
}

fn lerp(a: [f32; 2], b: [f32; 2], t: f32) -> [f32; 2] {
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

/// SplitMix64 — deterministic mixer used per iteration.
fn splitmix64(mut z: u64) -> u64 {
    z = z.wrapping_add(0x9E3779B97F4A7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D049BB133111EB);
    z ^ (z >> 31)
}

/// Pick a corner index (0/1/2) uniformly for iteration `i`. Uses the top
/// 8 bits of a splitmix64 mixed value, which is better-distributed than
/// low bits when taking modulo a small number.
fn pick_corner(seed: u64, i: u32) -> usize {
    let raw = splitmix64(seed ^ (i as u64));
    (raw >> 56) as usize % 3
}

/// Deterministic uniformly-random point strictly inside the triangle.
/// Barycentric sampling: u, v ~ U[0, 1); if u + v > 1, reflect to keep
/// inside. Then p = w*A + u*B + v*C with w = 1 - u - v.
fn random_inside_triangle(seed: u64) -> [f32; 2] {
    // Mix the seed differently from per-iteration sampling so iteration 0's
    // corner pick doesn't correlate with the initial position.
    let s = splitmix64(seed.wrapping_add(0xA5A5_A5A5_A5A5_A5A5));
    let mut u = bits_to_unit_f32(s);
    let s2 = splitmix64(s);
    let mut v = bits_to_unit_f32(s2);
    if u + v > 1.0 {
        u = 1.0 - u;
        v = 1.0 - v;
    }
    let w = 1.0 - u - v;
    [
        w * CORNERS[0][0] + u * CORNERS[1][0] + v * CORNERS[2][0],
        w * CORNERS[0][1] + u * CORNERS[1][1] + v * CORNERS[2][1],
    ]
}

fn bits_to_unit_f32(bits: u64) -> f32 {
    ((bits >> 8) as u32 & 0x00FFFFFF) as f32 / (1 << 24) as f32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pick_corner_distribution_is_roughly_uniform() {
        let mut counts = [0u32; 3];
        for i in 0..3000 {
            counts[pick_corner(42, i)] += 1;
        }
        // Each corner should land near 1000 ± noise. Allow ±20% tolerance for
        // a 3000-sample chi-square-style sanity check.
        for c in counts {
            assert!(c > 800 && c < 1200, "corner counts: {counts:?}");
        }
    }

    #[test]
    fn initial_position_is_inside_triangle() {
        for seed in 0u64..20 {
            let p = random_inside_triangle(seed);
            assert!(point_in_triangle(p), "seed {seed}: {p:?}");
        }
    }

    #[test]
    fn advance_to_is_deterministic() {
        let rule = SierpinskiChaos;
        let cfg = ChaosGameConfig::default();
        let mut a = rule.init(&cfg, 0);
        rule.advance_to(&mut a, &cfg, 17, 100);
        let mut b = rule.init(&cfg, 0);
        rule.advance_to(&mut b, &cfg, 17, 100);
        assert_eq!(a.trail, b.trail);
        assert_eq!(a.initial_position, b.initial_position);
    }

    #[test]
    fn advance_to_is_jump_safe() {
        let rule = SierpinskiChaos;
        let cfg = ChaosGameConfig::default();
        let mut direct = rule.init(&cfg, 99);
        rule.advance_to(&mut direct, &cfg, 99, 50);
        let mut backward = rule.init(&cfg, 99);
        rule.advance_to(&mut backward, &cfg, 99, 25);
        assert_eq!(&direct.trail[..25], &backward.trail[..]);
    }

    #[test]
    fn trail_length_matches_iterations_and_clamps() {
        let rule = SierpinskiChaos;
        let cfg = ChaosGameConfig { max_iterations: 50 };
        let mut state = rule.init(&cfg, 0);
        rule.advance_to(&mut state, &cfg, 7, 50);
        assert_eq!(state.trail.len(), 50);
        rule.advance_to(&mut state, &cfg, 7, 999);
        assert_eq!(state.trail.len(), 50, "advance past max should clamp");
    }

    #[test]
    fn substep_highlights_corner_then_moves_dot() {
        let rule = SierpinskiChaos;
        let cfg = ChaosGameConfig::default();
        let mut state = rule.init(&cfg, 0);
        rule.advance_to(&mut state, &cfg, 7, 5);

        // Phase 1 (sub < 0.33): corner highlighted, no in-flight dot yet.
        rule.substep(&mut state, &cfg, 7, 5, 0.10);
        assert!(state.chosen_corner.is_some());
        assert!(state.current_position.is_none(),
            "in-flight dot suppressed until move actually starts");

        // Phase 2 (sub >= 0.33): dot appears mid-flight, moved off start.
        rule.substep(&mut state, &cfg, 7, 5, 0.80);
        assert!(state.chosen_corner.is_some());
        let cp = state.current_position.expect("current position set during move");
        let start = state.trail[4];
        assert!((cp[0] - start[0]).hypot(cp[1] - start[1]) > 1e-4,
            "dot moved away from start by sub=0.80");
    }

    #[test]
    fn substep_at_or_past_max_clears_animation() {
        let rule = SierpinskiChaos;
        let cfg = ChaosGameConfig { max_iterations: 5 };
        let mut state = rule.init(&cfg, 0);
        rule.advance_to(&mut state, &cfg, 0, 5);
        rule.substep(&mut state, &cfg, 0, 5, 0.5);
        assert!(state.chosen_corner.is_none());
    }

    #[test]
    fn halfway_is_the_midpoint() {
        let m = halfway([0.0, 0.0], [2.0, 4.0]);
        assert_eq!(m, [1.0, 2.0]);
    }

    fn point_in_triangle(p: [f32; 2]) -> bool {
        let a = CORNERS[0];
        let b = CORNERS[1];
        let c = CORNERS[2];
        let denom = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
        let u = ((b[1] - c[1]) * (p[0] - c[0]) + (c[0] - b[0]) * (p[1] - c[1])) / denom;
        let v = ((c[1] - a[1]) * (p[0] - c[0]) + (a[0] - c[0]) * (p[1] - c[1])) / denom;
        let w = 1.0 - u - v;
        u >= 0.0 && v >= 0.0 && w >= 0.0
    }
}
