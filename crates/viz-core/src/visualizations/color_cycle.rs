//! Demo visualization: clears the canvas to an HSL-derived color that varies
//! with the rule's iteration and sub-progress. Uses no shaders, no buffers —
//! just `gl.clear()` from the WebGL2 context. Replaced by real visualizations
//! in Phase 3.

use serde::{Deserialize, Serialize};
use web_sys::WebGl2RenderingContext;

use crate::config::{boolean_property, color_property, number_property, ConfigSchema, NumberOpts};
use crate::rules::color_cycle::ColorCycleState;
use crate::traits::Visualization;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColorCycleVizConfig {
    /// Saturation 0..1.
    pub saturation: f32,
    /// Lightness at sub=0.
    pub lightness_min: f32,
    /// Lightness at sub=1.
    pub lightness_max: f32,
    /// Background color while iteration == 0.
    pub idle_color: [f32; 4],
    /// If true, hue advances continuously with sub_progress; otherwise hue
    /// snaps per integer iteration.
    pub smooth_hue: bool,
}

impl Default for ColorCycleVizConfig {
    fn default() -> Self {
        Self {
            saturation: 0.65,
            lightness_min: 0.20,
            lightness_max: 0.55,
            idle_color: [0.10, 0.10, 0.15, 1.0],
            smooth_hue: true,
        }
    }
}

impl ConfigSchema for ColorCycleVizConfig {
    fn schema() -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "saturation": number_property(NumberOpts {
                    label: "Saturation",
                    default: 0.65, min: 0.0, max: 1.0, step: 0.01,
                    integer: false, cosmetic: true, widget: None,
                }),
                "lightness_min": number_property(NumberOpts {
                    label: "Lightness min",
                    default: 0.20, min: 0.0, max: 1.0, step: 0.01,
                    integer: false, cosmetic: true, widget: None,
                }),
                "lightness_max": number_property(NumberOpts {
                    label: "Lightness max",
                    default: 0.55, min: 0.0, max: 1.0, step: 0.01,
                    integer: false, cosmetic: true, widget: None,
                }),
                "idle_color": color_property("Idle color", [0.10, 0.10, 0.15, 1.0]),
                "smooth_hue": boolean_property("Smooth hue", true, true),
            },
            "required": ["saturation", "lightness_min", "lightness_max", "idle_color", "smooth_hue"],
        })
    }

    fn defaults() -> serde_json::Value {
        serde_json::to_value(ColorCycleVizConfig::default()).unwrap()
    }
}

pub struct ColorCycleViz;

impl Visualization for ColorCycleViz {
    type Config = ColorCycleVizConfig;
    type State = ColorCycleState;

    fn id(&self) -> &'static str { "demo:color-cycle" }

    fn init(&mut self, _gl: &WebGl2RenderingContext, _cfg: &Self::Config) {}

    fn render(
        &mut self,
        gl: &WebGl2RenderingContext,
        state: &Self::State,
        cfg: &Self::Config,
    ) {
        let color = if state.iteration == 0 && state.sub_progress == 0.0 {
            cfg.idle_color
        } else {
            let hue_position = if cfg.smooth_hue {
                (state.iteration as f32 + state.sub_progress) / 360.0
            } else {
                state.iteration as f32 / 360.0
            };
            let hue = (hue_position * 360.0).rem_euclid(360.0);
            let lightness = cfg.lightness_min
                + (cfg.lightness_max - cfg.lightness_min) * state.sub_progress;
            let [r, g, b] = hsl_to_rgb(hue, cfg.saturation.clamp(0.0, 1.0), lightness.clamp(0.0, 1.0));
            [r, g, b, 1.0]
        };

        gl.clear_color(color[0], color[1], color[2], color[3]);
        gl.clear(WebGl2RenderingContext::COLOR_BUFFER_BIT);
    }

    fn resize(&mut self, gl: &WebGl2RenderingContext, w: u32, h: u32) {
        gl.viewport(0, 0, w as i32, h as i32);
    }
}

/// h ∈ [0, 360), s ∈ [0, 1], l ∈ [0, 1].
fn hsl_to_rgb(h: f32, s: f32, l: f32) -> [f32; 3] {
    let c = (1.0 - (2.0 * l - 1.0).abs()) * s;
    let h_prime = h / 60.0;
    let x = c * (1.0 - (h_prime.rem_euclid(2.0) - 1.0).abs());
    let (r1, g1, b1) = match h_prime as u32 {
        0 => (c, x, 0.0),
        1 => (x, c, 0.0),
        2 => (0.0, c, x),
        3 => (0.0, x, c),
        4 => (x, 0.0, c),
        5 => (c, 0.0, x),
        _ => (0.0, 0.0, 0.0),
    };
    let m = l - c / 2.0;
    [r1 + m, g1 + m, b1 + m]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_round_trip() {
        let v: ColorCycleVizConfig = serde_json::from_value(ColorCycleVizConfig::defaults()).unwrap();
        assert!((v.saturation - 0.65).abs() < 1e-6);
        assert!(v.smooth_hue);
    }

    #[test]
    fn hsl_red() {
        let [r, g, b] = hsl_to_rgb(0.0, 1.0, 0.5);
        assert!((r - 1.0).abs() < 1e-5);
        assert!(g.abs() < 1e-5);
        assert!(b.abs() < 1e-5);
    }

    #[test]
    fn hsl_green() {
        let [r, g, b] = hsl_to_rgb(120.0, 1.0, 0.5);
        assert!(r.abs() < 1e-5);
        assert!((g - 1.0).abs() < 1e-5);
        assert!(b.abs() < 1e-5);
    }

    #[test]
    fn hsl_zero_saturation_is_gray() {
        let [r, g, b] = hsl_to_rgb(200.0, 0.0, 0.5);
        assert!((r - 0.5).abs() < 1e-5);
        assert!((g - 0.5).abs() < 1e-5);
        assert!((b - 0.5).abs() < 1e-5);
    }
}
