//! Fourier epicycles: a closed 2D path is DFT'd into rotating circles chained
//! tip-to-tail; the tip retraces the path over one playthrough.
//!
//! The model (DFT terms, origin, bbox, pen LUT) is computed once in `init`
//! and survives `clear()`. Iteration-derived state (`trail`, `chain`, ...) is
//! rebuilt incrementally by `advance_to`: forward steps append, backward
//! steps truncate. Sample `i` depends only on `(model, i)`, so truncation is
//! exact and a scrub costs O(Δn·K) rather than another O(M²) DFT.

use serde::{Deserialize, Serialize};

use crate::config::{number_property, ConfigSchema, NumberOpts};
use crate::traits::{Capabilities, Rule, SceneState};

fn default_true() -> bool {
    true
}

/// One sample of the traced path. `pen` = "draw the segment from this sample
/// to the next" — false on the straight travel segments between glyphs.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct PathPoint {
    pub x: f32,
    pub y: f32,
    #[serde(default = "default_true")]
    pub pen: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FourierConfig {
    /// Closed path to trace. The UI sends a power-of-two sample count
    /// (2048–65536, growing with `epicycles`) so the DFT takes the FFT path.
    /// Defaults to empty so the scalar-only JSON used with
    /// `Engine::update_rule_config_with_path` still parses.
    #[serde(default)]
    pub path: Vec<PathPoint>,
    /// Number of DFT terms kept (K), largest amplitudes first.
    pub epicycles: u32,
    /// Iterations per full trace; iteration `n` maps to `t = n / max_iterations`.
    pub max_iterations: u32,
}

impl Default for FourierConfig {
    fn default() -> Self {
        Self {
            path: Vec::new(),
            epicycles: 2000,
            max_iterations: 1200,
        }
    }
}

impl ConfigSchema for FourierConfig {
    fn schema() -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "array",
                    "title": "Traced path",
                    "default": [],
                    "x-widget": "path",
                    "x-cosmetic": false,
                    "items": {
                        "type": "object",
                        "properties": {
                            "x": { "type": "number" },
                            "y": { "type": "number" },
                            "pen": { "type": "boolean", "default": true },
                        },
                        "required": ["x", "y"],
                    },
                },
                "epicycles": number_property(NumberOpts {
                    label: "Epicycles",
                    default: 2000.0,
                    min: 1.0,
                    max: 50_000.0,
                    step: 1.0,
                    integer: true,
                    cosmetic: false,
                    widget: None,
                }),
                "max_iterations": number_property(NumberOpts {
                    label: "Steps per trace",
                    default: 1200.0,
                    min: 1.0,
                    max: 200_000.0,
                    step: 1.0,
                    integer: true,
                    cosmetic: false,
                    widget: None,
                }),
            },
            "required": ["path", "epicycles", "max_iterations"],
        })
    }

    fn defaults() -> serde_json::Value {
        serde_json::to_value(FourierConfig::default()).unwrap()
    }
}

/// One rotating circle: `amp · e^{i(2π·freq·t + phase)}`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Epicycle {
    pub freq: i32,
    pub amp: f32,
    pub phase: f32,
}

#[derive(Debug, Default)]
pub struct FourierState {
    // ---- model: computed by init(); KEPT by clear() ----
    /// Sorted by amplitude desc, k = 0 excluded, len = min(cfg.epicycles, M-1).
    pub epicycles: Vec<Epicycle>,
    /// The k = 0 term (path centroid).
    pub origin: [f32; 2],
    /// (min, max) of the input path. The viz can't see the config, so it
    /// lives here.
    pub bbox: Option<([f32; 2], [f32; 2])>,
    /// Pen flag per input sample (len M).
    pub pen_lut: Vec<bool>,
    /// `cfg.max_iterations` at init time (min 1).
    pub steps_per_loop: u32,
    // ---- iteration-derived: RESET by clear() ----
    /// Tip position at `t = i / steps` for `i in 0..current_iteration`.
    pub trail: Vec<[f32; 2]>,
    /// Pen flag for `trail[i]`.
    pub trail_pen: Vec<bool>,
    /// K+1 prefix sums at the current substep time (`chain[0] = origin`,
    /// last = tip); empty once the trace is complete.
    pub chain: Vec<[f32; 2]>,
    /// `= chain.last()`; None once complete.
    pub pen: Option<[f32; 2]>,
    pub current_iteration: u32,
}

impl SceneState for FourierState {
    /// Resets only the iteration-derived fields; the model is kept so that
    /// engine-driven clears never re-run the DFT.
    fn clear(&mut self) {
        self.trail.clear();
        self.trail_pen.clear();
        self.chain.clear();
        self.pen = None;
        self.current_iteration = 0;
    }
}

/// Naive O(M²) DFT of the path, computed in f64 with a precomputed twiddle
/// table so the inner loop is a complex multiply-add with no `sin`/`cos`.
///
/// Returns `(origin = c_0, epicycles)` with the epicycles sorted by amplitude
/// descending and the k = 0 term folded into `origin`. Frequencies are mapped
/// to `[-M/2, M/2)`. A path with fewer than two samples or any non-finite
/// coordinate yields `([0, 0], [])`.
pub fn dft(path: &[PathPoint]) -> ([f32; 2], Vec<Epicycle>) {
    let m = path.len();
    if m < 2 || path.iter().any(|p| !p.x.is_finite() || !p.y.is_finite()) {
        return ([0.0, 0.0], Vec::new());
    }

    let z: Vec<(f64, f64)> = path.iter().map(|p| (p.x as f64, p.y as f64)).collect();
    // O(M log M) when M is a power of two (the UI always sends one), else O(M²).
    let coeffs = if m.is_power_of_two() {
        fft_radix2(&z)
    } else {
        naive_dft(&z)
    };
    let inv_m = 1.0 / m as f64;

    let mut origin = [0.0f32; 2];
    let mut eps = Vec::with_capacity(m - 1);
    for (k_idx, &(re0, im0)) in coeffs.iter().enumerate() {
        let re = re0 * inv_m;
        let im = im0 * inv_m;

        let k = if 2 * k_idx < m {
            k_idx as i32
        } else {
            k_idx as i32 - m as i32
        };
        if k == 0 {
            origin = [re as f32, im as f32];
        } else {
            eps.push(Epicycle {
                freq: k,
                amp: re.hypot(im) as f32,
                phase: im.atan2(re) as f32,
            });
        }
    }
    eps.sort_by(|a, b| b.amp.total_cmp(&a.amp));
    (origin, eps)
}

/// Unnormalized forward DFT, `X[k] = Σ_j x[j]·e^{-2πi·jk/N}`, via a twiddle
/// table so the inner loop is a complex multiply-add. O(N²); used when N is
/// not a power of two.
fn naive_dft(x: &[(f64, f64)]) -> Vec<(f64, f64)> {
    let n = x.len();
    let twiddle: Vec<(f64, f64)> = (0..n)
        .map(|j| {
            let a = -std::f64::consts::TAU * j as f64 / n as f64;
            (a.cos(), a.sin())
        })
        .collect();
    (0..n)
        .map(|k| {
            let (mut re, mut im) = (0.0f64, 0.0f64);
            for (j, &(zr, zi)) in x.iter().enumerate() {
                let (wr, wi) = twiddle[(j * k) % n];
                re += zr * wr - zi * wi;
                im += zr * wi + zi * wr;
            }
            (re, im)
        })
        .collect()
}

/// Unnormalized forward FFT (same contract as `naive_dft`) — iterative
/// radix-2 Cooley–Tukey in f64. `x.len()` must be a power of two.
fn fft_radix2(x: &[(f64, f64)]) -> Vec<(f64, f64)> {
    let n = x.len();
    debug_assert!(n.is_power_of_two());
    let mut a = x.to_vec();
    let bits = n.trailing_zeros();
    for i in 0..n {
        let j = if bits == 0 {
            0
        } else {
            i.reverse_bits() >> (usize::BITS - bits)
        };
        if j > i {
            a.swap(i, j);
        }
    }
    let mut len = 2;
    while len <= n {
        let half = len / 2;
        let ang = -std::f64::consts::TAU / len as f64;
        let (wr, wi) = (ang.cos(), ang.sin());
        for start in (0..n).step_by(len) {
            let (mut cr, mut ci) = (1.0f64, 0.0f64);
            for k in 0..half {
                let (ur, ui) = a[start + k];
                let (vr0, vi0) = a[start + k + half];
                let (vr, vi) = (vr0 * cr - vi0 * ci, vr0 * ci + vi0 * cr);
                a[start + k] = (ur + vr, ui + vi);
                a[start + k + half] = (ur - vr, ui - vi);
                let ncr = cr * wr - ci * wi;
                ci = cr * wi + ci * wr;
                cr = ncr;
            }
        }
        len <<= 1;
    }
    a
}

/// Rotation angle of one epicycle at time `t`. `rem_euclid` keeps the angle
/// small so f64→f32 precision doesn't jitter at |freq| ≈ 1500, t ≈ 1.
#[inline]
fn angle_at(e: &Epicycle, t: f64) -> f64 {
    std::f64::consts::TAU * ((e.freq as f64) * t).rem_euclid(1.0) + e.phase as f64
}

/// Tip position at time `t ∈ [0, 1)`: `origin + Σ amp·e^{i·angle}`.
fn eval_point(eps: &[Epicycle], origin: [f32; 2], t: f64) -> [f32; 2] {
    let (mut x, mut y) = (origin[0] as f64, origin[1] as f64);
    for e in eps {
        let a = angle_at(e, t);
        x += e.amp as f64 * a.cos();
        y += e.amp as f64 * a.sin();
    }
    [x as f32, y as f32]
}

/// Clears `out`, then pushes `origin` followed by the K prefix sums of the
/// chain at time `t` (so `out.last()` is the tip).
fn eval_chain(eps: &[Epicycle], origin: [f32; 2], t: f64, out: &mut Vec<[f32; 2]>) {
    out.clear();
    out.reserve(eps.len() + 1);
    out.push(origin);
    let (mut x, mut y) = (origin[0] as f64, origin[1] as f64);
    for e in eps {
        let a = angle_at(e, t);
        x += e.amp as f64 * a.cos();
        y += e.amp as f64 * a.sin();
        out.push([x as f32, y as f32]);
    }
}

/// Upper bound on terms returned by `summary` (the UI shows a handful).
pub const SUMMARY_MAX_TERMS: usize = 64;

pub struct FourierEpicycles;

impl Rule for FourierEpicycles {
    type Config = FourierConfig;
    type State = FourierState;

    fn id(&self) -> &'static str {
        "fourier-epicycles"
    }

    /// Scrubbable, but NOT cheap to recompute: `init` runs the O(M²) DFT, so
    /// the engine must never rebuild on a step/scrub command.
    fn capabilities(&self) -> Capabilities {
        Capabilities {
            supports_scrub: true,
            cheap_recompute: false,
            checkpoint_every: None,
        }
    }

    /// Install a packed path: `xy` = [x0, y0, x1, y1, …], `pen` one flag per
    /// sample. Rejects (returns false, leaving `cfg` untouched) on a shape
    /// mismatch so a truncated transfer can never become a silent half-path.
    fn apply_path(&self, cfg: &mut Self::Config, xy: &[f32], pen: &[u8]) -> bool {
        if xy.len() != pen.len() * 2 {
            return false;
        }
        cfg.path = xy
            .chunks_exact(2)
            .zip(pen)
            .map(|(c, &p)| PathPoint {
                x: c[0],
                y: c[1],
                pen: p != 0,
            })
            .collect();
        true
    }

    fn init(&self, cfg: &Self::Config, _seed: u64) -> Self::State {
        let (origin, mut epicycles) = dft(&cfg.path);
        epicycles.truncate(cfg.epicycles as usize);

        let bbox = cfg
            .path
            .iter()
            .fold(None::<([f32; 2], [f32; 2])>, |acc, p| match acc {
                None => Some(([p.x, p.y], [p.x, p.y])),
                Some((lo, hi)) => Some((
                    [lo[0].min(p.x), lo[1].min(p.y)],
                    [hi[0].max(p.x), hi[1].max(p.y)],
                )),
            });

        FourierState {
            epicycles,
            origin,
            bbox,
            pen_lut: cfg.path.iter().map(|p| p.pen).collect(),
            steps_per_loop: cfg.max_iterations.max(1),
            ..FourierState::default()
        }
    }

    /// Incremental: append samples `cur..target` going forward, truncate to
    /// `target` going backward. Never touches the model.
    fn advance_to(&self, state: &mut Self::State, cfg: &Self::Config, _seed: u64, n: u32) {
        let steps = cfg.max_iterations.max(1);
        if state.steps_per_loop != steps {
            // Config drifted under us: every sample's `t` changed, so the
            // trail is invalid. Model is unaffected.
            state.clear();
            state.steps_per_loop = steps;
        }

        let target = n.min(steps);
        let cur = state.current_iteration;
        if target < cur {
            state.trail.truncate(target as usize);
            state.trail_pen.truncate(target as usize);
        } else {
            let m = state.pen_lut.len();
            state.trail.reserve((target - cur) as usize);
            state.trail_pen.reserve((target - cur) as usize);
            for i in cur..target {
                let t = i as f64 / steps as f64;
                let p = eval_point(&state.epicycles, state.origin, t);
                state.trail.push(p);
                // floor(t·M) computed exactly in integers so a rounding error
                // in `i / steps * M` can't pick the previous sample's flag.
                let pen = if m == 0 {
                    false
                } else {
                    let idx = ((i as u64 * m as u64) / steps as u64) as usize;
                    state.pen_lut[idx.min(m - 1)]
                };
                state.trail_pen.push(pen);
            }
        }
        state.current_iteration = target;
    }

    /// Positions the chain at `t = (n + sub) / steps`. Once the trace is
    /// complete (`n >= steps`) the chain and pen are cleared.
    fn substep(&self, state: &mut Self::State, cfg: &Self::Config, _seed: u64, n: u32, sub: f32) {
        let steps = cfg.max_iterations.max(1);
        if n >= steps {
            state.chain.clear();
            state.pen = None;
            return;
        }
        let t = (n as f64 + sub.clamp(0.0, 1.0) as f64) / steps as f64;
        // Take the Vec out so the reused allocation doesn't conflict with the
        // shared borrow of `state.epicycles`.
        let mut chain = std::mem::take(&mut state.chain);
        eval_chain(&state.epicycles, state.origin, t, &mut chain);
        state.chain = chain;
        state.pen = state.chain.last().copied();
    }

    /// `{ origin: [x, y], total_terms, terms: [{freq, amp, phase}, …] }` —
    /// amplitude-descending, at most `SUMMARY_MAX_TERMS` entries.
    fn summary(&self, state: &Self::State) -> serde_json::Value {
        let terms: Vec<serde_json::Value> = state
            .epicycles
            .iter()
            .take(SUMMARY_MAX_TERMS)
            .map(|e| serde_json::json!({ "freq": e.freq, "amp": e.amp, "phase": e.phase }))
            .collect();
        serde_json::json!({
            "origin": state.origin,
            "total_terms": state.epicycles.len(),
            "terms": terms,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apply_path_packs_xy_and_pen_and_rejects_shape_mismatch() {
        let rule = FourierEpicycles;
        let mut cfg = FourierConfig::default();
        assert!(rule.apply_path(&mut cfg, &[1.0, 0.0, 0.0, 1.0, -1.0, 0.0], &[1, 1, 0]));
        assert_eq!(cfg.path.len(), 3);
        assert_eq!(
            cfg.path[1],
            PathPoint {
                x: 0.0,
                y: 1.0,
                pen: true
            }
        );
        assert_eq!(cfg.path[2].pen, false);
        // odd coordinate count / flag count mismatch → refused, path unchanged
        assert!(!rule.apply_path(&mut cfg, &[1.0, 0.0, 0.0], &[1, 1]));
        assert_eq!(cfg.path.len(), 3);
        // the scalar-only JSON form parses with an empty path
        let parsed: FourierConfig =
            serde_json::from_value(serde_json::json!({"epicycles": 5, "max_iterations": 9}))
                .unwrap();
        assert!(parsed.path.is_empty());
        assert_eq!(parsed.epicycles, 5);
    }

    #[test]
    fn fft_matches_naive_dft_on_a_power_of_two_signal() {
        let z: Vec<(f64, f64)> = (0..64)
            .map(|j| {
                let t = j as f64 * 0.37;
                (t.sin() + 0.3 * (3.0 * t).cos(), (2.0 * t).cos() - 0.2 * t)
            })
            .collect();
        let a = fft_radix2(&z);
        let b = naive_dft(&z);
        assert_eq!(a.len(), b.len());
        for (k, (p, q)) in a.iter().zip(&b).enumerate() {
            assert!(
                (p.0 - q.0).abs() < 1e-9 && (p.1 - q.1).abs() < 1e-9,
                "bin {k}: {p:?} vs {q:?}"
            );
        }
    }

    #[test]
    fn dft_of_a_non_power_of_two_circle_is_one_dominant_term() {
        // M = 30 is not a power of two → exercises the naive path end-to-end.
        let m = 30;
        let path: Vec<PathPoint> = (0..m)
            .map(|j| {
                let a = std::f64::consts::TAU * j as f64 / m as f64;
                PathPoint {
                    x: a.cos() as f32,
                    y: a.sin() as f32,
                    pen: true,
                }
            })
            .collect();
        let (origin, eps) = dft(&path);
        assert!(origin[0].abs() < 1e-5 && origin[1].abs() < 1e-5);
        assert_eq!(eps[0].freq.abs(), 1);
        assert!((eps[0].amp - 1.0).abs() < 1e-5);
        assert!(eps[1].amp < 1e-5);
    }
    use crate::config::ConfigSchema;
    use crate::traits::{Rule, SceneState};

    /// Unit circle, `pen: true` on every sample.
    fn circle_path(m: usize) -> Vec<PathPoint> {
        (0..m)
            .map(|j| {
                let th = std::f64::consts::TAU * j as f64 / m as f64;
                PathPoint {
                    x: th.cos() as f32,
                    y: th.sin() as f32,
                    pen: true,
                }
            })
            .collect()
    }

    fn cfg_with(path: Vec<PathPoint>, epicycles: u32, max_iterations: u32) -> FourierConfig {
        FourierConfig {
            path,
            epicycles,
            max_iterations,
        }
    }

    #[test]
    fn dft_of_unit_circle_is_one_epicycle() {
        let (origin, eps) = dft(&circle_path(64));
        assert_eq!(eps.len(), 63);
        assert_eq!(eps[0].freq.abs(), 1, "dominant term should be |k| = 1");
        assert!((eps[0].amp - 1.0).abs() < 1e-4, "amp = {}", eps[0].amp);
        assert!(
            eps[1].amp < 1e-6,
            "second term should vanish: {}",
            eps[1].amp
        );
        assert!(
            origin[0].abs() < 1e-6 && origin[1].abs() < 1e-6,
            "origin = {origin:?}"
        );
    }

    #[test]
    fn dft_reconstructs_path_with_all_terms() {
        let m = 32usize;
        let path: Vec<PathPoint> = (0..m)
            .map(|j| {
                let th = std::f64::consts::TAU * j as f64 / m as f64;
                let r = 1.0 + 0.3 * (3.0 * th).sin();
                PathPoint {
                    x: (r * th.cos()) as f32,
                    y: (r * th.sin()) as f32,
                    pen: true,
                }
            })
            .collect();
        let (origin, eps) = dft(&path);
        assert_eq!(eps.len(), m - 1);
        for (j, p) in path.iter().enumerate() {
            let q = eval_point(&eps, origin, j as f64 / m as f64);
            assert!(
                (q[0] - p.x).abs() < 1e-3 && (q[1] - p.y).abs() < 1e-3,
                "sample {j}: expected ({}, {}), got ({}, {})",
                p.x,
                p.y,
                q[0],
                q[1]
            );
        }
    }

    #[test]
    fn dft_rejects_empty_and_nonfinite() {
        let (origin, eps) = dft(&[]);
        assert!(eps.is_empty());
        assert_eq!(origin, [0.0, 0.0]);

        let (_, eps) = dft(&[PathPoint {
            x: 1.0,
            y: 0.0,
            pen: true,
        }]);
        assert!(eps.is_empty(), "a single point is not a path");

        let mut bad = circle_path(8);
        bad[3].y = f32::NAN;
        let (origin, eps) = dft(&bad);
        assert!(eps.is_empty());
        assert_eq!(origin, [0.0, 0.0]);
    }

    #[test]
    fn init_truncates_to_epicycles_and_records_model() {
        let rule = FourierEpicycles;
        let cfg = cfg_with(circle_path(64), 5, 300);
        let state = rule.init(&cfg, 0);
        assert_eq!(state.epicycles.len(), 5);
        let (min, max) = state.bbox.expect("bbox should be recorded");
        assert!(
            (min[0] + 1.0).abs() < 1e-5 && (min[1] + 1.0).abs() < 1e-3,
            "min = {min:?}"
        );
        assert!(
            (max[0] - 1.0).abs() < 1e-5 && (max[1] - 1.0).abs() < 1e-3,
            "max = {max:?}"
        );
        assert_eq!(state.pen_lut.len(), 64);
        assert_eq!(state.steps_per_loop, cfg.max_iterations);
        assert!(state.trail.is_empty());
        assert!(state.chain.is_empty());
        assert!(state.pen.is_none());
        assert_eq!(state.current_iteration, 0);

        // K > M-1 is clamped to what the DFT produced.
        let cfg = cfg_with(circle_path(16), 999, 300);
        let state = rule.init(&cfg, 0);
        assert_eq!(state.epicycles.len(), 15);

        // Empty path: no model, no bbox.
        let cfg = cfg_with(vec![], 250, 300);
        let state = rule.init(&cfg, 0);
        assert!(state.epicycles.is_empty());
        assert!(state.bbox.is_none());
        assert!(state.pen_lut.is_empty());
    }

    #[test]
    fn advance_is_incremental_and_matches_from_scratch() {
        let rule = FourierEpicycles;
        let cfg = cfg_with(circle_path(64), 10, 200);
        let mut inc = rule.init(&cfg, 0);
        rule.advance_to(&mut inc, &cfg, 0, 50);
        assert_eq!(inc.trail.len(), 50);
        rule.advance_to(&mut inc, &cfg, 0, 100);

        let mut fresh = rule.init(&cfg, 0);
        rule.advance_to(&mut fresh, &cfg, 0, 100);

        assert_eq!(inc.trail, fresh.trail);
        assert_eq!(inc.trail_pen, fresh.trail_pen);
        assert_eq!(inc.current_iteration, 100);
        // Idempotent for the same n.
        rule.advance_to(&mut inc, &cfg, 0, 100);
        assert_eq!(inc.trail, fresh.trail);
    }

    #[test]
    fn advance_backward_truncates_to_prefix() {
        let rule = FourierEpicycles;
        let cfg = cfg_with(circle_path(64), 10, 200);
        let mut full = rule.init(&cfg, 0);
        rule.advance_to(&mut full, &cfg, 0, 100);
        let expected_trail = full.trail[..25].to_vec();
        let expected_pen = full.trail_pen[..25].to_vec();

        rule.advance_to(&mut full, &cfg, 0, 25);
        assert_eq!(full.trail, expected_trail);
        assert_eq!(full.trail_pen, expected_pen);
        assert_eq!(full.current_iteration, 25);
    }

    #[test]
    fn advance_clamps_to_max_iterations() {
        let rule = FourierEpicycles;
        let cfg = cfg_with(circle_path(64), 10, 50);
        let mut state = rule.init(&cfg, 0);
        rule.advance_to(&mut state, &cfg, 0, 999);
        assert_eq!(state.trail.len(), 50);
        assert_eq!(state.trail_pen.len(), 50);
        assert_eq!(state.current_iteration, 50);
    }

    #[test]
    fn pen_flags_propagate_to_trail() {
        let rule = FourierEpicycles;
        let m = 64usize;
        let mut path = circle_path(m);
        for p in path.iter_mut().skip(m / 2) {
            p.pen = false;
        }
        let cfg = cfg_with(path.clone(), 63, m as u32);
        let mut state = rule.init(&cfg, 0);
        rule.advance_to(&mut state, &cfg, 0, m as u32);
        assert_eq!(state.trail_pen.len(), m);
        for (i, p) in path.iter().enumerate() {
            assert_eq!(state.trail_pen[i], p.pen, "sample {i}");
        }
    }

    #[test]
    fn substep_fills_chain_then_clears_when_complete() {
        let rule = FourierEpicycles;
        let cfg = cfg_with(circle_path(64), 10, 200);
        let mut state = rule.init(&cfg, 0);
        rule.advance_to(&mut state, &cfg, 0, 5);

        rule.substep(&mut state, &cfg, 0, 5, 0.5);
        assert_eq!(state.chain.len(), state.epicycles.len() + 1);
        assert_eq!(state.chain[0], state.origin);
        assert!(state.pen.is_some());
        assert_eq!(state.pen, state.chain.last().copied());
        // The tip at t = 5.5/200 on a unit circle should be on the circle.
        let tip = state.pen.unwrap();
        let r = (tip[0] * tip[0] + tip[1] * tip[1]).sqrt();
        assert!((r - 1.0).abs() < 1e-3, "tip radius = {r}");

        rule.substep(&mut state, &cfg, 0, cfg.max_iterations, 0.0);
        assert!(state.chain.is_empty());
        assert!(state.pen.is_none());
    }

    #[test]
    fn clear_keeps_model_resets_trail() {
        let rule = FourierEpicycles;
        let cfg = cfg_with(circle_path(64), 10, 200);
        let mut state = rule.init(&cfg, 0);
        rule.advance_to(&mut state, &cfg, 0, 40);
        rule.substep(&mut state, &cfg, 0, 40, 0.25);
        let model = state.epicycles.clone();
        let origin = state.origin;
        let bbox = state.bbox;
        let lut = state.pen_lut.clone();

        state.clear();
        assert!(state.trail.is_empty());
        assert!(state.trail_pen.is_empty());
        assert!(state.chain.is_empty());
        assert!(state.pen.is_none());
        assert_eq!(state.current_iteration, 0);
        assert_eq!(state.epicycles, model);
        assert_eq!(state.origin, origin);
        assert_eq!(state.bbox, bbox);
        assert_eq!(state.pen_lut, lut);
        assert_eq!(state.steps_per_loop, 200);
    }

    #[test]
    fn config_drift_in_max_iterations_resets_trail() {
        let rule = FourierEpicycles;
        let cfg = cfg_with(circle_path(64), 10, 200);
        let mut state = rule.init(&cfg, 0);
        rule.advance_to(&mut state, &cfg, 0, 100);
        let changed = cfg_with(circle_path(64), 10, 400);
        rule.advance_to(&mut state, &changed, 0, 100);
        assert_eq!(state.steps_per_loop, 400);
        assert_eq!(state.trail.len(), 100);
        let mut fresh = rule.init(&changed, 0);
        rule.advance_to(&mut fresh, &changed, 0, 100);
        assert_eq!(state.trail, fresh.trail);
    }

    #[test]
    fn max_iterations_one_does_not_panic() {
        let rule = FourierEpicycles;
        let cfg = cfg_with(circle_path(16), 4, 1);
        let mut state = rule.init(&cfg, 0);
        rule.advance_to(&mut state, &cfg, 0, 0);
        rule.substep(&mut state, &cfg, 0, 0, 0.5);
        assert_eq!(state.chain.len(), 5);
        rule.advance_to(&mut state, &cfg, 0, 1);
        assert_eq!(state.trail.len(), 1);
        rule.substep(&mut state, &cfg, 0, 1, 0.0);
        assert!(state.chain.is_empty());
        rule.advance_to(&mut state, &cfg, 0, 7);
        assert_eq!(state.trail.len(), 1);

        // max_iterations == 0 is treated as 1 rather than dividing by zero.
        let cfg0 = cfg_with(circle_path(16), 4, 0);
        let mut state = rule.init(&cfg0, 0);
        assert_eq!(state.steps_per_loop, 1);
        rule.advance_to(&mut state, &cfg0, 0, 5);
        rule.substep(&mut state, &cfg0, 0, 0, 0.5);
        assert_eq!(state.trail.len(), 1);
    }

    #[test]
    fn empty_path_advance_and_substep_are_harmless() {
        let rule = FourierEpicycles;
        let cfg = cfg_with(vec![], 250, 100);
        let mut state = rule.init(&cfg, 0);
        rule.advance_to(&mut state, &cfg, 0, 10);
        rule.substep(&mut state, &cfg, 0, 10, 0.5);
        assert_eq!(state.trail.len(), state.trail_pen.len());
        assert!(state.trail_pen.iter().all(|&p| !p));
        assert_eq!(state.current_iteration, 10);
    }

    #[test]
    fn capabilities_avoid_full_rebuild_on_step() {
        let caps = FourierEpicycles.capabilities();
        assert!(caps.supports_scrub);
        assert!(
            !caps.cheap_recompute,
            "init runs an O(M^2) DFT; never rebuild per step"
        );
        assert!(caps.checkpoint_every.is_none());
        assert_eq!(FourierEpicycles.id(), "fourier-epicycles");
    }

    #[test]
    fn config_defaults_round_trip() {
        let d = FourierConfig::defaults();
        let cfg: FourierConfig = serde_json::from_value(d.clone()).unwrap();
        assert!(cfg.path.is_empty());
        assert_eq!(cfg.epicycles, 2000);
        assert_eq!(cfg.max_iterations, 1200);
        assert_eq!(serde_json::to_value(&cfg).unwrap(), d);
    }

    #[test]
    fn pen_defaults_to_true_when_omitted() {
        let p: PathPoint = serde_json::from_str(r#"{"x":1,"y":2}"#).unwrap();
        assert_eq!(p.x, 1.0);
        assert_eq!(p.y, 2.0);
        assert!(p.pen);
        let p: PathPoint = serde_json::from_str(r#"{"x":1,"y":2,"pen":false}"#).unwrap();
        assert!(!p.pen);
    }

    #[test]
    fn schema_lists_all_required_fields() {
        let s = FourierConfig::schema();
        let required = s["required"].as_array().unwrap();
        assert_eq!(required.len(), 3);
        for key in ["path", "epicycles", "max_iterations"] {
            assert!(required.iter().any(|v| v == key), "missing {key}");
            assert!(s["properties"].get(key).is_some(), "no property for {key}");
        }
        assert_eq!(s["properties"]["path"]["x-widget"], "path");
        assert_eq!(s["properties"]["path"]["x-cosmetic"], false);
        assert_eq!(
            s["properties"]["path"]["items"]["properties"]["pen"]["default"],
            true
        );
        assert_eq!(s["properties"]["epicycles"]["type"], "integer");
        assert_eq!(
            s["properties"]["max_iterations"]["title"],
            "Steps per trace"
        );
    }

    #[test]
    fn summary_lists_top_terms_amplitude_descending() {
        let rule = FourierEpicycles;
        let cfg = cfg_with(circle_path(64), 5, 64);
        let state = rule.init(&cfg, 0);
        let s = rule.summary(&state);
        assert_eq!(s["total_terms"], 5);
        let terms = s["terms"].as_array().unwrap();
        assert_eq!(terms.len(), 5);
        assert_eq!(terms[0]["freq"].as_i64().unwrap().abs(), 1);
        let amps: Vec<f64> = terms.iter().map(|t| t["amp"].as_f64().unwrap()).collect();
        assert!(
            amps.windows(2).all(|w| w[0] >= w[1]),
            "amps not descending: {amps:?}"
        );
        assert!(s["origin"].as_array().unwrap().len() == 2);

        let empty = rule.init(&cfg_with(vec![], 5, 64), 0);
        let e = rule.summary(&empty);
        assert_eq!(e["total_terms"], 0);
        assert!(e["terms"].as_array().unwrap().is_empty());
    }
}
