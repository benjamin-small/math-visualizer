//! Sorting-algorithm lab: pure op traces plus the datasets they run on.

pub mod algorithms;
pub mod datasets;

use serde::{Deserialize, Serialize};

use crate::config::{number_property, ConfigSchema, NumberOpts};
use crate::traits::{Capabilities, Rule, SceneState};

pub use algorithms::{Algorithm, Op};
pub use datasets::Dataset;

/// Mixed into the seed per column so that two columns showing the same
/// dataset still get different arrays, while every algorithm in a column
/// sorts the identical array.
const COLUMN_SEED_MIX: u64 = 0x9E37_79B9_7F4A_7C15;

fn default_algorithms() -> Vec<Algorithm> {
    Algorithm::ALL.to_vec()
}

fn default_datasets() -> Vec<Dataset> {
    Dataset::ALL.to_vec()
}

fn default_size() -> u32 {
    50
}

/// Sentinel: the engine clock drives this rule, so playback must never
/// auto-pause on an iteration count.
fn default_max_iter() -> u32 {
    1_000_000_000
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SortingConfig {
    #[serde(default = "default_algorithms")]
    pub algorithms: Vec<Algorithm>,
    #[serde(default = "default_datasets")]
    pub datasets: Vec<Dataset>,
    #[serde(default = "default_size")]
    pub size: u32,
    #[serde(default = "default_max_iter")]
    pub max_iterations: u32,
}

impl Default for SortingConfig {
    fn default() -> Self {
        Self {
            algorithms: default_algorithms(),
            datasets: default_datasets(),
            size: default_size(),
            max_iterations: default_max_iter(),
        }
    }
}

/// The serde names of every variant, for a schema `enum` list.
fn variant_names<T: Serialize>(all: &[T]) -> Vec<serde_json::Value> {
    all.iter()
        .map(|v| serde_json::to_value(v).expect("enum serializes to a string"))
        .collect()
}

impl ConfigSchema for SortingConfig {
    fn schema() -> serde_json::Value {
        let algorithms = variant_names(&Algorithm::ALL);
        let datasets = variant_names(&Dataset::ALL);
        serde_json::json!({
            "type": "object",
            "properties": {
                "algorithms": {
                    "type": "array",
                    "title": "Algorithms",
                    "items": { "type": "string", "enum": algorithms },
                    "default": algorithms,
                    "x-cosmetic": false,
                },
                "datasets": {
                    "type": "array",
                    "title": "Datasets",
                    "items": { "type": "string", "enum": datasets },
                    "default": datasets,
                    "x-cosmetic": false,
                },
                "size": number_property(NumberOpts {
                    label: "Array size",
                    default: 50.0,
                    min: 10.0,
                    max: 300.0,
                    step: 1.0,
                    integer: true,
                    cosmetic: false,
                    widget: None,
                }),
                "max_iterations": number_property(NumberOpts {
                    label: "Steps",
                    default: 1_000_000_000.0,
                    min: 1.0,
                    max: 1_000_000_000.0,
                    step: 1.0,
                    integer: true,
                    cosmetic: false,
                    widget: None,
                }),
            },
            "required": ["algorithms", "datasets", "size", "max_iterations"],
        })
    }

    fn defaults() -> serde_json::Value {
        serde_json::to_value(SortingConfig::default()).unwrap()
    }
}

#[derive(Debug, Clone)]
pub struct Lane {
    pub algorithm: Algorithm,
    pub dataset: Dataset,
    pub initial: Vec<u16>,
    pub values: Vec<u16>,
    pub ops: Vec<Op>,
    pub cursor: usize,
    pub running: bool,
    pub compares: u32,
    pub writes: u32,
}

impl Lane {
    /// Whether the whole trace has been replayed.
    pub fn done(&self) -> bool {
        self.cursor >= self.ops.len()
    }

    /// The op the cursor last applied — what the viz highlights. `None`
    /// before the first tick.
    pub fn last_op(&self) -> Option<Op> {
        self.cursor
            .checked_sub(1)
            .and_then(|i| self.ops.get(i).copied())
    }

    /// Rewind to the initial array with the counters zeroed. Leaves
    /// `running` alone — the callers decide that.
    pub fn reset(&mut self) {
        self.values.clear();
        self.values.extend_from_slice(&self.initial);
        self.cursor = 0;
        self.compares = 0;
        self.writes = 0;
    }
}

#[derive(Debug, Default)]
pub struct SortingState {
    /// Row-major: `lane = row * cols + col`.
    pub lanes: Vec<Lane>,
    pub rows: usize,
    pub cols: usize,
    pub tick: u32,
}

impl SceneState for SortingState {
    /// Rewinds every lane to its initial array and stops it — the grid
    /// itself (and each lane's precomputed trace) is kept, so an
    /// engine-driven clear never re-runs `trace`.
    fn clear(&mut self) {
        for lane in &mut self.lanes {
            lane.reset();
            lane.running = false;
        }
        self.tick = 0;
    }
}

pub struct SortingRace;

impl Rule for SortingRace {
    type Config = SortingConfig;
    type State = SortingState;

    fn id(&self) -> &'static str {
        "sorting"
    }

    /// `init` records a full op trace per lane (bubble at n=300 is ~45k ops),
    /// so the engine must never rebuild on a step, and there is nothing to
    /// scrub back to: lanes start and stop independently of the clock.
    fn capabilities(&self) -> Capabilities {
        Capabilities {
            supports_scrub: false,
            cheap_recompute: false,
            checkpoint_every: None,
        }
    }

    /// One lane per (algorithm row, dataset column), row-major. Each column
    /// gets a single array that every algorithm in it sorts, so the race is
    /// fair; the traces are recorded here, once.
    fn init(&self, cfg: &Self::Config, seed: u64) -> Self::State {
        let size = (cfg.size as usize).clamp(10, 300);
        debug_assert!(size <= u16::MAX as usize);
        let column_inputs: Vec<Vec<u16>> = cfg
            .datasets
            .iter()
            .enumerate()
            .map(|(col, &ds)| {
                datasets::generate(ds, size, seed ^ (col as u64).wrapping_mul(COLUMN_SEED_MIX))
            })
            .collect();

        let mut lanes = Vec::with_capacity(cfg.algorithms.len() * cfg.datasets.len());
        for &algorithm in &cfg.algorithms {
            for (col, &dataset) in cfg.datasets.iter().enumerate() {
                let initial = column_inputs[col].clone();
                let ops = algorithms::trace(algorithm, &initial);
                lanes.push(Lane {
                    algorithm,
                    dataset,
                    values: initial.clone(),
                    initial,
                    ops,
                    cursor: 0,
                    running: false,
                    compares: 0,
                    writes: 0,
                });
            }
        }

        SortingState {
            lanes,
            rows: cfg.algorithms.len(),
            cols: cfg.datasets.len(),
            tick: 0,
        }
    }

    /// Each clock tick applies one op to every *running* lane; idle lanes
    /// stand still. A lane that reaches the end of its trace stops itself.
    fn advance_to(&self, state: &mut Self::State, _cfg: &Self::Config, _seed: u64, n: u32) {
        // Only Reset/SetSeed can move the clock backwards and both re-init;
        // rewind defensively so a stale state can never drift.
        if n < state.tick {
            for lane in &mut state.lanes {
                lane.reset();
            }
            state.tick = 0;
        }

        let delta = (n - state.tick) as usize;
        if delta > 0 {
            for lane in &mut state.lanes {
                if !lane.running {
                    continue;
                }
                let take = delta.min(lane.ops.len() - lane.cursor);
                for k in 0..take {
                    let op = lane.ops[lane.cursor + k];
                    match op {
                        Op::Compare(_, _) => lane.compares += 1,
                        Op::Swap(_, _) => lane.writes += 2,
                        Op::Write(_, _) => lane.writes += 1,
                    }
                    algorithms::apply(&mut lane.values, op);
                }
                lane.cursor += take;
                if lane.done() {
                    lane.running = false;
                }
            }
        }

        state.tick = n;
    }

    /// `{ rows, cols, tick, all_done, lanes: [{algorithm, dataset, compares,
    /// writes, cursor, total, running, done}, …] }`. The lab reads this every
    /// frame, so the op traces deliberately stay out of it.
    fn summary(&self, state: &Self::State) -> serde_json::Value {
        let lanes: Vec<serde_json::Value> = state
            .lanes
            .iter()
            .map(|l| {
                serde_json::json!({
                    "algorithm": l.algorithm,
                    "dataset": l.dataset,
                    "compares": l.compares,
                    "writes": l.writes,
                    "cursor": l.cursor,
                    "total": l.ops.len(),
                    "running": l.running,
                    "done": l.done(),
                })
            })
            .collect();
        serde_json::json!({
            "rows": state.rows,
            "cols": state.cols,
            "tick": state.tick,
            "all_done": state.lanes.iter().all(|l| l.done()),
            "lanes": lanes,
        })
    }

    /// Per-lane control that must not reset playback:
    /// `{"kind":"toggle","lane":i}`,
    /// `{"kind":"set_running","lanes":[i,…],"running":bool}`,
    /// `{"kind":"reset_all"}`.
    fn apply_action(
        &self,
        state: &mut Self::State,
        _cfg: &Self::Config,
        action: &serde_json::Value,
    ) -> Result<bool, String> {
        let kind = action
            .get("kind")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "sorting action: missing string field \"kind\"".to_string())?;

        match kind {
            "toggle" => {
                let idx = lane_index(action.get("lane"), "lane")?;
                let lane = lane_mut(state, idx)?;
                if lane.done() {
                    lane.reset();
                    lane.running = true;
                } else {
                    lane.running = !lane.running;
                }
            }
            "set_running" => {
                let running = action
                    .get("running")
                    .and_then(|v| v.as_bool())
                    .ok_or_else(|| {
                        "sorting action: missing boolean field \"running\"".to_string()
                    })?;
                let raw = action
                    .get("lanes")
                    .and_then(|v| v.as_array())
                    .ok_or_else(|| "sorting action: missing array field \"lanes\"".to_string())?;
                // Validate every index before touching state, so a bad batch
                // is a no-op rather than a half-applied one.
                let indices = raw
                    .iter()
                    .map(|v| lane_index(Some(v), "lanes[]"))
                    .collect::<Result<Vec<usize>, String>>()?;
                for &i in &indices {
                    check_lane(state, i)?;
                }
                for &i in &indices {
                    let lane = &mut state.lanes[i];
                    if running && lane.done() {
                        lane.reset();
                    }
                    lane.running = running;
                }
            }
            "reset_all" => {
                for lane in &mut state.lanes {
                    lane.reset();
                    lane.running = false;
                }
            }
            other => return Err(format!("sorting action: unknown kind {other:?}")),
        }

        Ok(true)
    }
}

/// Read a lane index out of an action field.
fn lane_index(v: Option<&serde_json::Value>, field: &str) -> Result<usize, String> {
    v.and_then(|v| v.as_u64())
        .map(|i| i as usize)
        .ok_or_else(|| format!("sorting action: \"{field}\" must be a lane index"))
}

fn check_lane(state: &SortingState, i: usize) -> Result<(), String> {
    if i < state.lanes.len() {
        Ok(())
    } else {
        Err(format!(
            "sorting action: lane {i} out of range (grid has {})",
            state.lanes.len()
        ))
    }
}

fn lane_mut(state: &mut SortingState, i: usize) -> Result<&mut Lane, String> {
    check_lane(state, i)?;
    Ok(&mut state.lanes[i])
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn cfg() -> SortingConfig {
        SortingConfig {
            algorithms: vec![Algorithm::Bubble, Algorithm::Insertion],
            datasets: vec![Dataset::Random, Dataset::Reversed],
            size: 12,
            ..SortingConfig::default()
        }
    }

    fn is_sorted(v: &[u16]) -> bool {
        v.windows(2).all(|w| w[0] <= w[1])
    }

    /// Start every lane and run past the longest trace.
    fn run_all(rule: &SortingRace, st: &mut SortingState, c: &SortingConfig) {
        for l in &mut st.lanes {
            l.running = true;
        }
        let longest = st.lanes.iter().map(|l| l.ops.len()).max().unwrap_or(0);
        let target = st.tick + longest as u32 + 1;
        rule.advance_to(st, c, 0, target);
    }

    #[test]
    fn config_defaults_round_trip() {
        let d = SortingConfig::defaults();
        assert_eq!(d["size"], 50);
        assert_eq!(d["max_iterations"], 1_000_000_000u32);
        assert_eq!(d["algorithms"][0], "bubble");
        assert_eq!(d["datasets"][1], "nearly_sorted");

        let back: SortingConfig = serde_json::from_value(d).unwrap();
        assert_eq!(back.algorithms, Algorithm::ALL.to_vec());
        assert_eq!(back.datasets, Dataset::ALL.to_vec());
        assert_eq!(back.size, 50);
        assert_eq!(back.max_iterations, 1_000_000_000);

        // Every field carries a serde default, so a bare object still parses.
        let empty: SortingConfig = serde_json::from_value(json!({})).unwrap();
        assert_eq!(empty.size, 50);
        assert_eq!(empty.algorithms.len(), 7);
        assert_eq!(empty.datasets.len(), 4);
    }

    #[test]
    fn init_clamps_an_out_of_range_size() {
        let rule = SortingRace;
        let huge = SortingConfig {
            size: 100_000,
            ..cfg()
        };
        let st = rule.init(&huge, 0);
        assert_eq!(st.lanes[0].initial.len(), 300);

        let tiny = SortingConfig { size: 1, ..cfg() };
        let st = rule.init(&tiny, 0);
        assert_eq!(st.lanes[0].initial.len(), 10);
    }

    #[test]
    fn schema_declares_size_range_and_enum_choices() {
        let s = SortingConfig::schema();
        assert_eq!(s["properties"]["size"]["type"], "integer");
        assert_eq!(s["properties"]["size"]["minimum"], 10.0);
        assert_eq!(s["properties"]["size"]["maximum"], 300.0);
        assert_eq!(s["properties"]["size"]["x-cosmetic"], json!(false));
        assert_eq!(
            s["properties"]["max_iterations"]["default"],
            1_000_000_000.0
        );

        let algs = s["properties"]["algorithms"]["items"]["enum"]
            .as_array()
            .unwrap();
        assert_eq!(algs.len(), 7);
        assert_eq!(algs[0], "bubble");
        let dss = s["properties"]["datasets"]["items"]["enum"]
            .as_array()
            .unwrap();
        assert_eq!(dss.len(), 4);
        assert_eq!(dss[2], "reversed");
        assert_eq!(s["properties"]["datasets"]["x-cosmetic"], json!(false));
    }

    #[test]
    fn capabilities_disable_scrub_and_recompute() {
        let rule = SortingRace;
        assert_eq!(rule.id(), "sorting");
        let c = rule.capabilities();
        assert!(!c.supports_scrub);
        assert!(!c.cheap_recompute);
        assert!(c.checkpoint_every.is_none());
    }

    #[test]
    fn init_builds_the_grid_and_every_trace_sorts() {
        let rule = SortingRace;
        let c = cfg();
        let mut st = rule.init(&c, 7);

        assert_eq!(st.rows, 2);
        assert_eq!(st.cols, 2);
        assert_eq!(st.lanes.len(), 4);
        assert_eq!(st.tick, 0);

        // Row-major: lane = row * cols + col.
        assert_eq!(st.lanes[0].algorithm, Algorithm::Bubble);
        assert_eq!(st.lanes[0].dataset, Dataset::Random);
        assert_eq!(st.lanes[1].dataset, Dataset::Reversed);
        assert_eq!(st.lanes[2].algorithm, Algorithm::Insertion);
        assert_eq!(st.lanes[2].dataset, Dataset::Random);

        // Identical input down each column so the race is fair.
        assert_eq!(st.lanes[0].initial, st.lanes[2].initial);
        assert_eq!(st.lanes[1].initial, st.lanes[3].initial);
        assert_ne!(st.lanes[0].initial, st.lanes[1].initial);

        for l in &st.lanes {
            assert_eq!(l.initial.len(), 12);
            assert_eq!(l.values, l.initial);
            assert_eq!(l.cursor, 0);
            assert_eq!(l.compares, 0);
            assert_eq!(l.writes, 0);
            assert!(!l.running);
            assert!(!l.ops.is_empty());
        }

        run_all(&rule, &mut st, &c);
        for l in &st.lanes {
            assert!(l.done());
            assert!(is_sorted(&l.values), "{:?} did not sort", l.algorithm);
        }
    }

    #[test]
    fn columns_mix_the_seed_so_a_repeated_dataset_differs() {
        let rule = SortingRace;
        let c = SortingConfig {
            algorithms: vec![Algorithm::Bubble],
            datasets: vec![Dataset::Random, Dataset::Random],
            size: 32,
            ..SortingConfig::default()
        };
        let st = rule.init(&c, 11);
        assert_ne!(st.lanes[0].initial, st.lanes[1].initial);
    }

    #[test]
    fn idle_lanes_do_not_advance() {
        let rule = SortingRace;
        let c = cfg();
        let mut st = rule.init(&c, 3);

        rule.advance_to(&mut st, &c, 3, 50);

        assert_eq!(st.tick, 50);
        for l in &st.lanes {
            assert_eq!(l.cursor, 0);
            assert_eq!(l.values, l.initial);
            assert_eq!(l.compares, 0);
            assert_eq!(l.writes, 0);
        }
    }

    #[test]
    fn toggle_starts_an_idle_lane_and_one_tick_applies_one_op() {
        let rule = SortingRace;
        let c = cfg();
        let mut st = rule.init(&c, 5);

        assert!(st.lanes[1].last_op().is_none());
        assert_eq!(
            rule.apply_action(&mut st, &c, &json!({ "kind": "toggle", "lane": 1 })),
            Ok(true)
        );
        assert!(st.lanes[1].running);
        assert!(!st.lanes[0].running);

        let first = st.lanes[1].ops[0];
        rule.advance_to(&mut st, &c, 5, 1);
        assert_eq!(st.lanes[1].cursor, 1);
        assert_eq!(st.lanes[1].last_op(), Some(first));
        assert_eq!(st.lanes[0].cursor, 0, "the idle lane stayed put");

        // Toggling a running lane pauses it, keeping its progress.
        rule.apply_action(&mut st, &c, &json!({ "kind": "toggle", "lane": 1 }))
            .unwrap();
        assert!(!st.lanes[1].running);
        rule.advance_to(&mut st, &c, 5, 9);
        assert_eq!(st.lanes[1].cursor, 1);
    }

    #[test]
    fn counters_score_compares_and_writes_per_op() {
        let rule = SortingRace;
        let c = cfg();
        let mut st = rule.init(&c, 5);
        st.lanes[0].running = true;

        let mut compares = 0u32;
        let mut writes = 0u32;
        for op in st.lanes[0].ops.iter().take(40) {
            match op {
                Op::Compare(_, _) => compares += 1,
                Op::Swap(_, _) => writes += 2,
                Op::Write(_, _) => writes += 1,
            }
        }

        rule.advance_to(&mut st, &c, 5, 40);
        assert_eq!(st.lanes[0].compares, compares);
        assert_eq!(st.lanes[0].writes, writes);
    }

    #[test]
    fn batched_advance_matches_single_ticks() {
        let rule = SortingRace;
        let c = cfg();
        let mut batch = rule.init(&c, 9);
        let mut single = rule.init(&c, 9);
        for st in [&mut batch, &mut single] {
            for l in &mut st.lanes {
                l.running = true;
            }
        }

        rule.advance_to(&mut batch, &c, 9, 100);
        for n in 1..=100 {
            rule.advance_to(&mut single, &c, 9, n);
        }

        assert_eq!(batch.tick, single.tick);
        for (b, s) in batch.lanes.iter().zip(&single.lanes) {
            assert_eq!(b.cursor, s.cursor);
            assert_eq!(b.values, s.values);
            assert_eq!(b.compares, s.compares);
            assert_eq!(b.writes, s.writes);
            assert_eq!(b.running, s.running);
        }
        assert!(batch.lanes[0].cursor > 0);
    }

    #[test]
    fn a_lane_stops_running_when_its_trace_ends() {
        let rule = SortingRace;
        let c = cfg();
        let mut st = rule.init(&c, 1);
        let total = st.lanes[0].ops.len() as u32;
        st.lanes[0].running = true;

        rule.advance_to(&mut st, &c, 1, total - 1);
        assert!(st.lanes[0].running);
        assert!(!st.lanes[0].done());

        rule.advance_to(&mut st, &c, 1, total);
        assert!(!st.lanes[0].running);
        assert!(st.lanes[0].done());
        assert_eq!(st.lanes[0].cursor, total as usize);
        assert!(is_sorted(&st.lanes[0].values));
    }

    #[test]
    fn toggle_on_a_done_lane_restarts_it_from_initial() {
        let rule = SortingRace;
        let c = cfg();
        let mut st = rule.init(&c, 2);
        st.lanes[0].running = true;
        let total = st.lanes[0].ops.len() as u32;
        rule.advance_to(&mut st, &c, 2, total);
        assert!(st.lanes[0].done());
        assert!(st.lanes[0].compares > 0);

        rule.apply_action(&mut st, &c, &json!({ "kind": "toggle", "lane": 0 }))
            .unwrap();

        assert!(st.lanes[0].running);
        assert!(!st.lanes[0].done());
        assert_eq!(st.lanes[0].cursor, 0);
        assert_eq!(st.lanes[0].values, st.lanes[0].initial);
        assert_eq!(st.lanes[0].compares, 0);
        assert_eq!(st.lanes[0].writes, 0);
    }

    #[test]
    fn set_running_restarts_done_lanes_and_starts_idle_ones() {
        let rule = SortingRace;
        let c = cfg();
        let mut st = rule.init(&c, 2);
        st.lanes[0].running = true;
        let total = st.lanes[0].ops.len() as u32;
        rule.advance_to(&mut st, &c, 2, total);
        assert!(st.lanes[0].done());

        rule.apply_action(
            &mut st,
            &c,
            &json!({ "kind": "set_running", "lanes": [0, 2], "running": true }),
        )
        .unwrap();

        assert!(st.lanes[0].running);
        assert_eq!(st.lanes[0].cursor, 0, "the done lane was rewound");
        assert_eq!(st.lanes[0].compares, 0);
        assert!(st.lanes[2].running);
        assert_eq!(st.lanes[2].cursor, 0);
        assert!(!st.lanes[1].running, "untouched lanes keep their state");

        let target = st.tick + 4;
        rule.advance_to(&mut st, &c, 2, target);
        let progress = st.lanes[0].cursor;
        assert_eq!(progress, 4);

        rule.apply_action(
            &mut st,
            &c,
            &json!({ "kind": "set_running", "lanes": [0, 2], "running": false }),
        )
        .unwrap();
        assert!(!st.lanes[0].running);
        assert!(!st.lanes[2].running);
        assert_eq!(st.lanes[0].cursor, progress, "pausing keeps progress");
    }

    #[test]
    fn reset_all_rewinds_every_lane_and_leaves_the_tick_alone() {
        let rule = SortingRace;
        let c = cfg();
        let mut st = rule.init(&c, 4);
        for l in &mut st.lanes {
            l.running = true;
        }
        rule.advance_to(&mut st, &c, 4, 25);
        assert!(st.lanes[0].cursor > 0);

        rule.apply_action(&mut st, &c, &json!({ "kind": "reset_all" }))
            .unwrap();

        assert_eq!(st.tick, 25);
        for l in &st.lanes {
            assert_eq!(l.cursor, 0);
            assert_eq!(l.values, l.initial);
            assert_eq!(l.compares, 0);
            assert_eq!(l.writes, 0);
            assert!(!l.running);
        }
    }

    #[test]
    fn malformed_actions_are_errors_and_change_nothing() {
        let rule = SortingRace;
        let c = cfg();
        let mut st = rule.init(&c, 4);

        assert!(rule
            .apply_action(&mut st, &c, &json!({ "kind": "toggle", "lane": 99 }))
            .is_err());
        assert!(rule
            .apply_action(&mut st, &c, &json!({ "kind": "toggle" }))
            .is_err());
        assert!(rule
            .apply_action(
                &mut st,
                &c,
                &json!({ "kind": "set_running", "lanes": [0, 99], "running": true })
            )
            .is_err());
        assert!(rule
            .apply_action(&mut st, &c, &json!({ "kind": "set_running", "lanes": [0] }))
            .is_err());
        assert!(rule
            .apply_action(&mut st, &c, &json!({ "kind": "wobble" }))
            .is_err());
        assert!(rule
            .apply_action(&mut st, &c, &json!({ "lane": 0 }))
            .is_err());

        for l in &st.lanes {
            assert!(!l.running);
            assert_eq!(l.cursor, 0);
        }
    }

    #[test]
    fn summary_reports_the_grid_and_flips_all_done() {
        let rule = SortingRace;
        let c = cfg();
        let mut st = rule.init(&c, 6);

        let s = rule.summary(&st);
        assert_eq!(s["rows"], 2);
        assert_eq!(s["cols"], 2);
        assert_eq!(s["tick"], 0);
        assert_eq!(s["all_done"], json!(false));
        let lanes = s["lanes"].as_array().unwrap();
        assert_eq!(lanes.len(), 4);
        assert_eq!(lanes[0]["algorithm"], "bubble");
        assert_eq!(lanes[0]["dataset"], "random");
        assert_eq!(lanes[1]["dataset"], "reversed");
        assert_eq!(lanes[0]["cursor"], 0);
        assert_eq!(lanes[0]["total"], st.lanes[0].ops.len());
        assert_eq!(lanes[0]["compares"], 0);
        assert_eq!(lanes[0]["writes"], 0);
        assert_eq!(lanes[0]["running"], json!(false));
        assert_eq!(lanes[0]["done"], json!(false));
        assert!(lanes[0].get("ops").is_none(), "traces stay out of summary");

        run_all(&rule, &mut st, &c);
        let s = rule.summary(&st);
        assert_eq!(s["all_done"], json!(true));
        assert!(s["tick"].as_u64().unwrap() > 0);
        assert!(s["lanes"][0]["compares"].as_u64().unwrap() > 0);
        assert_eq!(s["lanes"][0]["running"], json!(false));
        assert_eq!(s["lanes"][0]["done"], json!(true));
    }

    #[test]
    fn rewinding_below_the_current_tick_resets_every_lane() {
        let rule = SortingRace;
        let c = cfg();
        let mut st = rule.init(&c, 8);
        st.lanes[0].running = true;
        rule.advance_to(&mut st, &c, 8, 30);
        assert_eq!(st.lanes[0].cursor, 30);

        rule.advance_to(&mut st, &c, 8, 5);

        assert_eq!(st.tick, 5);
        // The rewind reset the lane; the 5 ticks then replayed from the start.
        assert_eq!(st.lanes[0].cursor, 5);
        assert!(st.lanes[0].compares <= 5);
        for l in &st.lanes[1..] {
            assert_eq!(l.cursor, 0);
            assert_eq!(l.values, l.initial);
        }
    }

    #[test]
    fn clear_rewinds_lanes_and_the_tick() {
        let rule = SortingRace;
        let c = cfg();
        let mut st = rule.init(&c, 4);
        for l in &mut st.lanes {
            l.running = true;
        }
        rule.advance_to(&mut st, &c, 4, 20);

        st.clear();

        assert_eq!(st.tick, 0);
        assert_eq!(st.lanes.len(), 4, "the grid itself survives a clear");
        for l in &st.lanes {
            assert_eq!(l.cursor, 0);
            assert_eq!(l.values, l.initial);
            assert!(!l.running);
        }
    }

    #[test]
    fn a_new_size_changes_lane_length() {
        let rule = SortingRace;
        let small = rule.init(&SortingConfig { size: 10, ..cfg() }, 1);
        let big = rule.init(&SortingConfig { size: 40, ..cfg() }, 1);

        assert_eq!(small.lanes[0].initial.len(), 10);
        assert_eq!(small.lanes[0].values.len(), 10);
        assert_eq!(big.lanes[0].initial.len(), 40);
        assert!(big.lanes[0].ops.len() > small.lanes[0].ops.len());
    }
}
