//! ConfigSchema trait. Full impl lands in Task 2.

/// Implemented by every rule / visualization config struct. Surfaces the
/// schema as JSON for the Svelte panel to render widgets from.
pub trait ConfigSchema {
    fn schema() -> serde_json::Value;
    fn defaults() -> serde_json::Value;
}
