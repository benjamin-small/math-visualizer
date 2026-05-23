//! ConfigSchema trait. Each rule and visualization implements this for its
//! Config struct so the Svelte panel can render widgets without hard-coding
//! per-rule knowledge.
//!
//! Phase 2 implements the trait by hand on every config struct. Phase 4
//! introduces a `#[derive(ConfigSchema)]` proc-macro that generates these
//! impls from field attributes.

use serde_json::{json, Value};

pub trait ConfigSchema {
    /// JSON Schema describing the config, with `x-*` extension keys carrying
    /// UI hints (widget kind, cosmetic flag, etc.). The Svelte panel walks
    /// the schema and dispatches each field to a generic widget.
    fn schema() -> Value;

    /// Default values for every field, shaped like the config itself when
    /// deserialized.
    fn defaults() -> Value;
}

/// Helper for hand-written schemas. Builds a JSON Schema property object
/// with our `x-*` extension keys filled in.
pub fn number_property(opts: NumberOpts) -> Value {
    let mut v = json!({
        "type": if opts.integer { "integer" } else { "number" },
        "title": opts.label,
        "default": opts.default,
        "minimum": opts.min,
        "maximum": opts.max,
        "x-step": opts.step,
        "x-cosmetic": opts.cosmetic,
    });
    if let Some(widget) = opts.widget {
        v["x-widget"] = json!(widget);
    }
    v
}

/// Helper for boolean fields.
pub fn boolean_property(label: &str, default: bool, cosmetic: bool) -> Value {
    json!({
        "type": "boolean",
        "title": label,
        "default": default,
        "x-cosmetic": cosmetic,
    })
}

/// Helper for a color field (RGBA tuple).
pub fn color_property(label: &str, default: [f32; 4]) -> Value {
    json!({
        "type": "array",
        "title": label,
        "default": default,
        "minItems": 4,
        "maxItems": 4,
        "items": { "type": "number", "minimum": 0.0, "maximum": 1.0 },
        "x-widget": "color",
        "x-cosmetic": true,
    })
}

/// Builder-shaped options for `number_property`. Keeps call sites readable.
#[derive(Debug, Clone)]
pub struct NumberOpts {
    pub label: &'static str,
    pub default: f64,
    pub min: f64,
    pub max: f64,
    pub step: f64,
    pub integer: bool,
    pub cosmetic: bool,
    pub widget: Option<&'static str>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn number_property_emits_expected_keys() {
        let p = number_property(NumberOpts {
            label: "Iterations",
            default: 500.0,
            min: 1.0,
            max: 10_000.0,
            step: 1.0,
            integer: true,
            cosmetic: false,
            widget: None,
        });
        assert_eq!(p["type"], "integer");
        assert_eq!(p["title"], "Iterations");
        assert_eq!(p["default"], 500.0);
        assert_eq!(p["minimum"], 1.0);
        assert_eq!(p["maximum"], 10_000.0);
        assert_eq!(p["x-step"], 1.0);
        assert_eq!(p["x-cosmetic"], false);
        assert!(p.get("x-widget").is_none());
    }

    #[test]
    fn color_property_marks_widget_and_cosmetic() {
        let p = color_property("Background", [0.0, 0.0, 0.0, 1.0]);
        assert_eq!(p["x-widget"], "color");
        assert_eq!(p["x-cosmetic"], true);
        assert_eq!(p["items"]["maximum"], 1.0);
    }
}
