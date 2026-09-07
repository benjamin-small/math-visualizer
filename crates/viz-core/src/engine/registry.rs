//! Lab registry: maps a lab id (chosen by the JS shell) to a rule + viz pair
//! with their default configs. Adding a lab = adding a match arm here.

use serde_json::Value;

use super::erased::{ErasedRule, ErasedVisualization, TypedRule, TypedViz};
use crate::config::ConfigSchema;
use crate::rules::sierpinski_chaos::{ChaosGameConfig, SierpinskiChaos};
use crate::visualizations::sierpinski_pyramid::{SierpinskiPyramid, SierpinskiPyramidVizConfig};

/// Everything the engine needs to stand up one lab: the type-erased rule and
/// visualization plus the default config JSON for each.
///
/// Invariant: `rule_cfg` / `viz_cfg` must be the JSON the wrappers were
/// built from (`TypedRule::new` / `TypedViz::new` parse the schema
/// defaults), since `Engine::new` reports them via `rule_config()` /
/// `viz_config()` without re-parsing.
pub struct LabParts {
    pub rule: Box<dyn ErasedRule>,
    pub viz: Box<dyn ErasedVisualization>,
    pub rule_cfg: Value,
    pub viz_cfg: Value,
}

/// Lab used when the JS shell passes no id.
pub const DEFAULT_LAB: &str = "sierpinski";

/// Every id `build_lab` accepts. (A "fourier" lab is added in a later step.)
pub const LAB_IDS: &[&str] = &["sierpinski"];

/// Build the rule/viz pair for `id`, or `None` if the id is unknown.
///
/// Constructing a lab allocates no GL resources — visualizations create
/// their buffers/programs lazily in `init`/`render` — so this is safe to
/// call natively (see the tests below).
pub fn build_lab(id: &str) -> Option<LabParts> {
    match id {
        "sierpinski" => Some(LabParts {
            rule: Box::new(TypedRule::new(SierpinskiChaos)),
            viz: Box::new(TypedViz::new(SierpinskiPyramid::new())),
            rule_cfg: ChaosGameConfig::defaults(),
            viz_cfg: SierpinskiPyramidVizConfig::defaults(),
        }),
        _ => None,
    }
}

/// Read `max_iterations` from any rule config JSON without knowing its
/// concrete type. Missing/non-integer → `fallback`; the result is always ≥ 1.
pub fn max_iterations_of(cfg: &Value, fallback: u32) -> u32 {
    cfg.get("max_iterations")
        .and_then(Value::as_u64)
        .map(|n| n.clamp(1, u32::MAX as u64) as u32)
        .unwrap_or(fallback.max(1))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn every_registered_id_builds() {
        for id in LAB_IDS {
            let parts = build_lab(id).unwrap_or_else(|| panic!("lab {id} should build"));
            assert!(!parts.rule.id().is_empty(), "lab {id}: rule id empty");
            assert!(!parts.viz.id().is_empty(), "lab {id}: viz id empty");
            assert!(
                parts.rule_cfg.is_object(),
                "lab {id}: rule cfg not an object"
            );
            assert!(parts.viz_cfg.is_object(), "lab {id}: viz cfg not an object");
        }
    }

    #[test]
    fn default_lab_is_registered() {
        assert!(LAB_IDS.contains(&DEFAULT_LAB));
        assert!(build_lab(DEFAULT_LAB).is_some());
    }

    #[test]
    fn unknown_id_is_none() {
        assert!(build_lab("nope").is_none());
        assert!(build_lab("").is_none());
    }

    #[test]
    fn max_iterations_of_reads_the_key() {
        assert_eq!(max_iterations_of(&json!({"max_iterations": 42}), 7), 42);
    }

    #[test]
    fn max_iterations_of_falls_back_when_missing() {
        assert_eq!(max_iterations_of(&json!({}), 7), 7);
        assert_eq!(max_iterations_of(&json!({"other": 3}), 7), 7);
        assert_eq!(max_iterations_of(&json!(null), 7), 7);
    }

    #[test]
    fn max_iterations_of_clamps_to_at_least_one() {
        assert_eq!(max_iterations_of(&json!({"max_iterations": 0}), 7), 1);
        assert_eq!(max_iterations_of(&json!({}), 0), 1);
    }

    #[test]
    fn max_iterations_of_falls_back_on_wrong_type() {
        assert_eq!(max_iterations_of(&json!({"max_iterations": "42"}), 7), 7);
        assert_eq!(max_iterations_of(&json!({"max_iterations": -1}), 7), 7);
    }

    #[test]
    fn sierpinski_defaults_carry_max_iterations() {
        let parts = build_lab("sierpinski").unwrap();
        assert_eq!(max_iterations_of(&parts.rule_cfg, 1), 50_000);
    }
}
