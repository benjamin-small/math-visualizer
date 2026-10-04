//! Notes & Chords: the oscillator model behind the lab. Each note is a sine
//! that swings a dot back and forth along one bar; two or three notes
//! together draw a Lissajous figure.
//!
//! **One iteration is one full swing of the root note** (the first note in
//! the config), so the shell's playback speed is literally the root's swings
//! per second (Hz). Every other note swings `ratio` times per root swing.
//!
//! The state is a pure function of `(config, n, sub)`: `advance_to` and
//! `substep` rebuild it from scratch, so scrubbing and replay need no
//! bookkeeping. `phase = n + sub` is kept **unreduced**: reducing it by the
//! figure's period would snap an equal-tempered figure back every period and
//! hide its drift. Each note reduces the phase itself, in f64, just before
//! the `sin`, so f32 never sees a large angle.
//!
//! Ratios come in two tunings. *Just* intonation uses the exact 5-limit
//! fractions in `JUST_RATIOS`, which is what lets a figure close: its period
//! is the lcm of the denominators. *Equal temperament* (the piano) uses
//! `2^(d/12)`. The period is always taken from the just fractions, even in
//! piano mode, so switching tuning keeps the same trail window and the piano
//! figure visibly fails to close.

use serde::{Deserialize, Serialize};

use crate::config::{boolean_property, number_property, ConfigSchema, NumberOpts};
use crate::traits::{Capabilities, Rule, SceneState};

/// MIDI note 60 (C4): the lab's default note and the fallback for an empty
/// note list.
pub const DEFAULT_NOTE: u8 = 60;
/// The lab draws at most three notes: the left, top and right bar.
pub const MAX_NOTES: usize = 3;
/// Highest MIDI note number.
const MAX_MIDI: u8 = 127;

/// 5-limit just intonation by semitone interval `0..12`, each fraction in
/// lowest terms.
pub const JUST_RATIOS: [(u32, u32); 12] = [
    (1, 1),
    (16, 15),
    (9, 8),
    (6, 5),
    (5, 4),
    (4, 3),
    (45, 32),
    (3, 2),
    (8, 5),
    (5, 3),
    (9, 5),
    (15, 8),
];

fn gcd(mut a: u32, mut b: u32) -> u32 {
    while b != 0 {
        (a, b) = (b, a % b);
    }
    a
}

/// Least common multiple of two positive integers, saturating at `u32::MAX`.
fn lcm(a: u32, b: u32) -> u32 {
    (a / gcd(a, b)).saturating_mul(b)
}

/// The just-intonation ratio `(numerator, denominator)`, in lowest terms, of
/// an interval of `semitones` (negative = downwards): the table entry at
/// `semitones.rem_euclid(12)` times `2^semitones.div_euclid(12)`, where
/// octaves up scale the numerator and octaves down the denominator.
///
/// Exact for every interval two MIDI notes can make (`|semitones| <= 127`);
/// absurdly large intervals saturate instead of overflowing.
pub fn just_ratio(semitones: i32) -> (u32, u32) {
    let (mut num, mut den) = JUST_RATIOS[semitones.rem_euclid(12) as usize];
    let octaves = semitones.div_euclid(12);
    let scale = 2u32.saturating_pow(octaves.unsigned_abs());
    if octaves >= 0 {
        num = num.saturating_mul(scale);
    } else {
        den = den.saturating_mul(scale);
    }
    let g = gcd(num, den);
    (num / g, den / g)
}

/// The equal-tempered (piano) frequency ratio of an interval of `semitones`.
pub fn et_ratio(semitones: i32) -> f64 {
    2f64.powf(semitones as f64 / 12.0)
}

/// Root swings after which the figure closes: the lcm of the just
/// denominators. Always at least 1: with no notes, or only notes swinging a
/// whole number of times per root swing (the root, octaves above it), the
/// figure closes after a single swing.
pub fn period_cycles(just: &[(u32, u32)]) -> u32 {
    just.iter()
        .fold(1, |period, &(_, den)| lcm(period, den.max(1)))
}

fn default_notes() -> Vec<u8> {
    vec![DEFAULT_NOTE]
}

fn default_true() -> bool {
    true
}

/// Sentinel: the engine clock drives this rule, so playback must never
/// auto-pause on an iteration count.
fn default_max_iter() -> u32 {
    u32::MAX
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotesConfig {
    /// MIDI notes in bar order: `[0]` is the root (left bar, drives y), `[1]`
    /// the top bar (x), `[2]` the right bar (depth). Use `effective_notes`
    /// for the normalised list the model actually runs on.
    #[serde(default = "default_notes")]
    pub notes: Vec<u8>,
    /// Just intonation (exact ratios, figures close) or equal temperament
    /// (piano, figures drift).
    #[serde(default = "default_true")]
    pub just_intonation: bool,
    #[serde(default = "default_max_iter")]
    pub max_iterations: u32,
}

impl Default for NotesConfig {
    fn default() -> Self {
        Self {
            notes: default_notes(),
            just_intonation: default_true(),
            max_iterations: default_max_iter(),
        }
    }
}

impl NotesConfig {
    /// The notes the model runs on: an empty list becomes the default note,
    /// at most `MAX_NOTES` are kept (in order), and each is clamped to the
    /// MIDI range.
    pub fn effective_notes(&self) -> Vec<u8> {
        if self.notes.is_empty() {
            return default_notes();
        }
        self.notes
            .iter()
            .take(MAX_NOTES)
            .map(|&midi| midi.min(MAX_MIDI))
            .collect()
    }
}

impl ConfigSchema for NotesConfig {
    fn schema() -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "notes": {
                    "type": "array",
                    "title": "Notes (MIDI)",
                    "items": { "type": "integer", "minimum": 0, "maximum": MAX_MIDI },
                    "minItems": 1,
                    "maxItems": MAX_NOTES,
                    "default": [DEFAULT_NOTE],
                    "x-widget": "notes",
                    "x-cosmetic": false,
                },
                "just_intonation": boolean_property("Just intonation", true, false),
                "max_iterations": number_property(NumberOpts {
                    label: "Swings",
                    default: u32::MAX as f64,
                    min: 1.0,
                    max: u32::MAX as f64,
                    step: 1.0,
                    integer: true,
                    cosmetic: false,
                    widget: None,
                }),
            },
            "required": ["notes", "just_intonation", "max_iterations"],
        })
    }

    fn defaults() -> serde_json::Value {
        serde_json::to_value(NotesConfig::default()).unwrap()
    }
}

/// One note's slice of the model.
#[derive(Debug, Clone, PartialEq)]
pub struct NoteState {
    /// MIDI note number, after normalisation.
    pub midi: u8,
    /// Numerator of the just fraction of this note's interval from the root,
    /// in lowest terms. Always just, even in piano mode: it drives the
    /// figure's period and the UI's labels.
    pub num: u32,
    /// Denominator of the just fraction (see `num`).
    pub den: u32,
    /// Swings per root swing as actually played: `num / den` in just
    /// intonation, `2^(d/12)` in piano tuning.
    pub ratio: f64,
    /// Where the dot sits on its bar, in `[-1, 1]`:
    /// `sin(2π · ratio · phase)`.
    pub displacement: f32,
}

/// The model at one instant: every note's dot plus the figure's progress.
#[derive(Debug, Default)]
pub struct NotesState {
    /// In bar order; `notes[0]` is the root, with ratio 1.
    pub notes: Vec<NoteState>,
    /// Root swings after which a just-intonation figure closes.
    pub period: u32,
    pub just_intonation: bool,
    /// Root swings so far (`n + sub`), unreduced.
    pub phase: f64,
    /// `phase >= period`. Monotonic while playing, so a "done" derived from
    /// it never flickers.
    pub closed: bool,
}

impl SceneState for NotesState {
    /// Rewinds to phase 0 with every dot at rest. The model (notes, ratios,
    /// period) depends only on the config, so it is kept.
    fn clear(&mut self) {
        self.phase = 0.0;
        self.closed = false;
        for note in &mut self.notes {
            note.displacement = 0.0;
        }
    }
}

/// Where `note`'s dot sits at `phase` root swings: `sin(2π · ratio · phase)`,
/// computed in f64 and rounded to f32 only at the end.
///
/// The phase is reduced per note first, so the f64 never carries a large
/// angle (it grows without bound, into the millions at high swing rates).
/// With just intonation the exact fraction `num / den` repeats every `den`
/// root swings, so `phase mod den` gives the same sine. With equal
/// temperament the ratio is generally irrational, so there is no common
/// period and only the fractional number of the note's own cycles,
/// `(ratio · phase) mod 1`, is kept.
pub fn displacement_at(note: &NoteState, just_intonation: bool, phase: f64) -> f32 {
    let cycles = if just_intonation {
        let den = f64::from(note.den);
        f64::from(note.num) / den * phase.rem_euclid(den)
    } else {
        (note.ratio * phase).rem_euclid(1.0)
    };
    (std::f64::consts::TAU * cycles).sin() as f32
}

/// Builds the whole state for iteration `n`, `sub` of the way into the next
/// one. The model is at most three notes, so it is derived from the config
/// every time rather than cached; that is what keeps `advance_to` and
/// `substep` pure.
fn recompute(cfg: &NotesConfig, n: u32, sub: f32) -> NotesState {
    let midis = cfg.effective_notes();
    let root = i32::from(midis[0]);
    let mut notes: Vec<NoteState> = midis
        .iter()
        .map(|&midi| {
            let semitones = i32::from(midi) - root;
            let (num, den) = just_ratio(semitones);
            let ratio = if cfg.just_intonation {
                f64::from(num) / f64::from(den)
            } else {
                et_ratio(semitones)
            };
            NoteState {
                midi,
                num,
                den,
                ratio,
                displacement: 0.0,
            }
        })
        .collect();

    let just: Vec<(u32, u32)> = notes.iter().map(|note| (note.num, note.den)).collect();
    let period = period_cycles(&just);

    let phase = f64::from(n) + f64::from(sub);
    for note in &mut notes {
        note.displacement = displacement_at(note, cfg.just_intonation, phase);
    }

    NotesState {
        notes,
        period,
        just_intonation: cfg.just_intonation,
        phase,
        closed: phase >= f64::from(period),
    }
}

/// The rule behind the Notes & Chords lab.
pub struct Notes;

impl Rule for Notes {
    type Config = NotesConfig;
    type State = NotesState;

    fn id(&self) -> &'static str {
        "notes"
    }

    /// Cheap to recompute and scrubbable: the state is a pure function of
    /// `(config, n, sub)`.
    fn capabilities(&self) -> Capabilities {
        Capabilities::cheap_scrubbable()
    }

    fn init(&self, cfg: &Self::Config, _seed: u64) -> Self::State {
        recompute(cfg, 0, 0.0)
    }

    /// Pure and idempotent: rebuilds the state at the start of iteration `n`,
    /// whatever it was before.
    fn advance_to(&self, state: &mut Self::State, cfg: &Self::Config, _seed: u64, n: u32) {
        *state = recompute(cfg, n, 0.0);
    }

    /// Positions every dot at phase `n + sub`, with `sub` clamped to `[0, 1]`.
    fn substep(&self, state: &mut Self::State, cfg: &Self::Config, _seed: u64, n: u32, sub: f32) {
        *state = recompute(cfg, n, sub.clamp(0.0, 1.0));
    }

    /// `{ phase, period, closed, just_intonation, notes: [{ midi, ratio, num,
    /// den, displacement }, …] }`. The lab reads this every frame, so it is a
    /// handful of numbers. `num`/`den` are always the just fraction (also in
    /// piano mode); `ratio` is what actually swings.
    fn summary(&self, state: &Self::State) -> serde_json::Value {
        let notes: Vec<serde_json::Value> = state
            .notes
            .iter()
            .map(|note| {
                serde_json::json!({
                    "midi": note.midi,
                    "ratio": note.ratio,
                    "num": note.num,
                    "den": note.den,
                    "displacement": note.displacement,
                })
            })
            .collect();
        serde_json::json!({
            "phase": state.phase,
            "period": state.period,
            "closed": state.closed,
            "just_intonation": state.just_intonation,
            "notes": notes,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::f32::consts::FRAC_1_SQRT_2;
    use std::f64::consts::TAU;

    fn cfg(notes: &[u8], just_intonation: bool) -> NotesConfig {
        NotesConfig {
            notes: notes.to_vec(),
            just_intonation,
            max_iterations: u32::MAX,
        }
    }

    // ---- theory ----

    #[test]
    fn just_ratio_table_is_lowest_terms() {
        let expected = [
            (1, 1),
            (16, 15),
            (9, 8),
            (6, 5),
            (5, 4),
            (4, 3),
            (45, 32),
            (3, 2),
            (8, 5),
            (5, 3),
            (9, 5),
            (15, 8),
        ];
        assert_eq!(JUST_RATIOS, expected);
        for (num, den) in JUST_RATIOS {
            assert_eq!(gcd(num, den), 1, "{num}/{den} is not in lowest terms");
        }
    }

    #[test]
    fn just_ratio_within_one_octave_is_the_table() {
        for (d, &entry) in JUST_RATIOS.iter().enumerate() {
            assert_eq!(just_ratio(d as i32), entry, "interval of {d} semitones");
        }
    }

    #[test]
    fn just_ratio_folds_octaves() {
        assert_eq!(just_ratio(12), (2, 1));
        assert_eq!(just_ratio(-12), (1, 2));
        assert_eq!(just_ratio(16), (5, 2));
        assert_eq!(just_ratio(19), (3, 1));
        assert_eq!(just_ratio(24), (4, 1));
    }

    #[test]
    fn just_ratio_negative_interval_uses_euclidean_mod() {
        // A fifth below is 2/3, not the reciprocal of a table entry.
        assert_eq!(just_ratio(-7), (2, 3));
        assert_eq!(just_ratio(-1), (15, 16));
        assert_eq!(just_ratio(-5), (3, 4));
    }

    #[test]
    fn just_ratio_tracks_equal_temperament_across_the_midi_range() {
        // Every interval two MIDI notes can make (|d| <= 127): lowest terms,
        // no overflow, and within about 1% of the piano's ratio, so an octave
        // folded the wrong way anywhere shows up immediately.
        for d in -127..=127 {
            let (num, den) = just_ratio(d);
            assert_eq!(gcd(num, den), 1, "{num}/{den} for {d} semitones");
            let just = num as f64 / den as f64;
            let et = et_ratio(d);
            assert!(
                ((just - et) / et).abs() < 0.015,
                "{d} semitones: just {num}/{den} = {just}, equal temperament {et}"
            );
        }
    }

    #[test]
    fn extreme_intervals_saturate_instead_of_panicking() {
        // Far outside any MIDI interval, but the functions are public and
        // total: no overflow panic, and the fraction stays a valid one.
        for d in [i32::MAX, i32::MIN, 12 * 40, -12 * 40] {
            let (num, den) = just_ratio(d);
            assert!(num >= 1 && den >= 1, "{d}: {num}/{den}");
        }
        assert_eq!(just_ratio(12 * 40).0, u32::MAX);
        assert_eq!(period_cycles(&[(1, u32::MAX), (1, u32::MAX - 1)]), u32::MAX);
        // A zero denominator is not a fraction; it must not zero the period.
        assert_eq!(period_cycles(&[(1, 0), (1, 3)]), 3);
    }

    #[test]
    fn et_ratio_matches_semitone_formula() {
        assert!((et_ratio(0) - 1.0).abs() < 1e-12);
        assert!((et_ratio(12) - 2.0).abs() < 1e-12);
        assert!((et_ratio(-12) - 0.5).abs() < 1e-12);
        assert!((et_ratio(7) - 1.4983).abs() < 1e-4);
    }

    #[test]
    fn period_examples() {
        assert_eq!(period_cycles(&[(3, 2)]), 2);
        assert_eq!(period_cycles(&[(1, 1), (5, 4), (3, 2)]), 4);
        assert_eq!(period_cycles(&[(45, 32)]), 32);
        assert_eq!(period_cycles(&[(16, 15)]), 15);
        assert_eq!(period_cycles(&[(2, 3)]), 3);
        assert_eq!(period_cycles(&[]), 1);
        assert_eq!(period_cycles(&[(2, 1)]), 1);
    }

    #[test]
    fn period_is_lcm_not_product() {
        assert_eq!(period_cycles(&[(3, 2), (5, 4)]), 4);
    }

    // ---- config ----

    #[test]
    fn config_defaults_round_trip() {
        let defaults = NotesConfig::defaults();
        assert_eq!(defaults["notes"], json!([60]));
        assert_eq!(defaults["just_intonation"], true);
        assert_eq!(defaults["max_iterations"], u32::MAX);

        let parsed: NotesConfig = serde_json::from_value(defaults.clone()).unwrap();
        assert_eq!(parsed.notes, vec![60]);
        assert!(parsed.just_intonation);
        assert_eq!(parsed.max_iterations, u32::MAX);
        assert_eq!(serde_json::to_value(&parsed).unwrap(), defaults);
    }

    #[test]
    fn config_parses_with_missing_fields() {
        let parse = |v: serde_json::Value| serde_json::from_value::<NotesConfig>(v).unwrap();

        let chord = parse(json!({"notes": [60, 64, 67]}));
        assert_eq!(chord.notes, vec![60, 64, 67]);
        assert!(chord.just_intonation);
        assert_eq!(chord.max_iterations, u32::MAX);

        let empty = parse(json!({}));
        assert_eq!(empty.notes, vec![60]);
        assert!(empty.just_intonation);
        assert_eq!(empty.max_iterations, u32::MAX);

        // Each field defaults on its own.
        let piano = parse(json!({"just_intonation": false}));
        assert_eq!(piano.notes, vec![60]);
        assert!(!piano.just_intonation);
        assert_eq!(parse(json!({"max_iterations": 7})).max_iterations, 7);
    }

    #[test]
    fn config_rejects_bad_notes() {
        let parse = |v: serde_json::Value| serde_json::from_value::<NotesConfig>(v);
        assert!(parse(json!({"notes": ["A4"]})).is_err());
        assert!(parse(json!({"notes": [300]})).is_err());
        assert!(parse(json!({"notes": [-1]})).is_err());
    }

    #[test]
    fn schema_lists_all_required_fields() {
        let schema = NotesConfig::schema();
        let required = schema["required"].as_array().expect("required array");
        assert_eq!(required.len(), 3);
        for key in required {
            let key = key.as_str().unwrap();
            assert!(
                schema["properties"].get(key).is_some(),
                "no property for {key}"
            );
        }
        let notes = &schema["properties"]["notes"];
        assert_eq!(notes["minItems"], 1);
        assert_eq!(notes["maxItems"], 3);
        assert_eq!(notes["items"]["maximum"], 127);
        assert_eq!(
            schema["properties"]["max_iterations"]["default"],
            4294967295.0
        );
    }

    #[test]
    fn schema_describes_the_note_picker_and_unbounded_swings() {
        let schema = NotesConfig::schema();
        let props = &schema["properties"];

        let notes = &props["notes"];
        assert_eq!(notes["type"], "array");
        assert_eq!(notes["title"], "Notes (MIDI)");
        assert_eq!(notes["default"], json!([60]));
        assert_eq!(notes["x-widget"], "notes");
        assert_eq!(notes["x-cosmetic"], false);
        assert_eq!(notes["items"]["type"], "integer");
        assert_eq!(notes["items"]["minimum"], 0);

        assert_eq!(props["just_intonation"]["type"], "boolean");
        assert_eq!(props["just_intonation"]["title"], "Just intonation");
        assert_eq!(props["just_intonation"]["default"], true);
        assert_eq!(props["just_intonation"]["x-cosmetic"], false);

        let swings = &props["max_iterations"];
        assert_eq!(swings["type"], "integer");
        assert_eq!(swings["title"], "Swings");
        assert_eq!(swings["minimum"], 1.0);
        assert_eq!(swings["maximum"], 4294967295.0);
        assert_eq!(swings["x-step"], 1.0);
        assert_eq!(swings["x-cosmetic"], false);
    }

    #[test]
    fn effective_notes_normalizes() {
        let eff = |notes: &[u8]| cfg(notes, true).effective_notes();
        assert_eq!(eff(&[]), vec![60]);
        assert_eq!(eff(&[60, 62, 64, 65, 67]), vec![60, 62, 64]);
        assert_eq!(eff(&[200]), vec![127]);
        // Order is bar order, so it must survive; every kept note is clamped.
        assert_eq!(eff(&[67, 60, 64]), vec![67, 60, 64]);
        assert_eq!(eff(&[200, 10, 255, 30]), vec![127, 10, 127]);
    }

    // ---- state and rule ----

    /// Debug-printed state. `NotesState` is deliberately not `PartialEq`, and
    /// Debug prints every f32/f64 exactly, so equal strings mean states that
    /// are equal bit for bit.
    fn snapshot(state: &NotesState) -> String {
        format!("{state:?}")
    }

    fn note(midi: u8, num: u32, den: u32) -> NoteState {
        NoteState {
            midi,
            num,
            den,
            ratio: num as f64 / den as f64,
            displacement: 0.0,
        }
    }

    fn fractions(state: &NotesState) -> Vec<(u32, u32)> {
        state.notes.iter().map(|n| (n.num, n.den)).collect()
    }

    #[test]
    fn init_builds_ratios_and_period_for_c_major() {
        let state = Notes.init(&cfg(&[60, 64, 67], true), 0);
        let midis: Vec<u8> = state.notes.iter().map(|n| n.midi).collect();
        assert_eq!(midis, vec![60, 64, 67]);
        assert_eq!(fractions(&state), vec![(1, 1), (5, 4), (3, 2)]);
        let ratios: Vec<f64> = state.notes.iter().map(|n| n.ratio).collect();
        assert_eq!(ratios, vec![1.0, 1.25, 1.5]);
        assert_eq!(state.period, 4);
        assert!(state.just_intonation);
        assert_eq!(state.phase, 0.0);
        assert!(!state.closed);
        assert!(state.notes.iter().all(|n| n.displacement == 0.0));
    }

    #[test]
    fn init_in_et_keeps_the_just_period_and_fractions() {
        let state = Notes.init(&cfg(&[60, 64, 67], false), 0);
        assert!(!state.just_intonation);
        // The trail window and the label fractions stay just, so toggling the
        // tuning changes only how the figure moves.
        assert_eq!(state.period, 4);
        assert_eq!(fractions(&state), vec![(1, 1), (5, 4), (3, 2)]);
        assert!((state.notes[0].ratio - 1.0).abs() < 1e-9);
        assert!((state.notes[1].ratio - 2f64.powf(4.0 / 12.0)).abs() < 1e-9);
        assert!((state.notes[2].ratio - 2f64.powf(7.0 / 12.0)).abs() < 1e-9);
    }

    #[test]
    fn init_runs_on_the_normalized_notes() {
        let empty = Notes.init(&cfg(&[], true), 0);
        assert_eq!(empty.notes.len(), 1);
        assert_eq!(empty.notes[0].midi, 60);

        let crowded = Notes.init(&cfg(&[60, 64, 67, 72], true), 0);
        assert_eq!(crowded.notes.len(), 3);

        let loud = Notes.init(&cfg(&[200], true), 0);
        assert_eq!(loud.notes[0].midi, 127);
    }

    #[test]
    fn displacement_is_sine_of_ratio_times_phase() {
        let root = note(60, 1, 1);
        let fifth = note(67, 3, 2);
        assert!((displacement_at(&root, true, 0.25) - 1.0).abs() < 1e-6);
        assert!((displacement_at(&fifth, true, 0.5) + 1.0).abs() < 1e-6);
        assert!(displacement_at(&root, true, 1.0).abs() < 1e-6);

        // Piano tuning reads the equal-tempered `ratio`...
        let piano_fifth = NoteState {
            ratio: et_ratio(7),
            ..note(67, 3, 2)
        };
        let want = (TAU * et_ratio(7) * 0.3).sin() as f32;
        assert!((displacement_at(&piano_fifth, false, 0.3) - want).abs() < 1e-6);

        // ...while pure ratios read the exact fraction, never `ratio`.
        let odd = NoteState {
            ratio: 2.0,
            ..note(67, 3, 2)
        };
        assert!((displacement_at(&odd, true, 0.25) - FRAC_1_SQRT_2).abs() < 1e-6);
        assert!(displacement_at(&odd, false, 0.25).abs() < 1e-6);
    }

    #[test]
    fn recompute_fills_a_displacement_per_note_in_bar_order() {
        // C major a quarter of the way through the root's first swing.
        let state = recompute(&cfg(&[60, 64, 67], true), 0, 0.25);
        let d: Vec<f32> = state.notes.iter().map(|n| n.displacement).collect();
        assert!((d[0] - 1.0).abs() < 1e-6, "root: {}", d[0]);
        // sin(2π · 5/4 · 1/4) and sin(2π · 3/2 · 1/4)
        assert!((d[1] - 0.923_879_5).abs() < 1e-6, "major third: {}", d[1]);
        assert!((d[2] - FRAC_1_SQRT_2).abs() < 1e-6, "fifth: {}", d[2]);
    }

    #[test]
    fn phase_precision_at_one_million() {
        const N: u32 = 1_000_000;
        // sin(2π · (num/den) · (N + 1/4)) with the fractional cycle taken from
        // exact integer arithmetic: num · (4N + 1) / (4 · den), mod 1.
        let exact = |num: u64, den: u64| -> f32 {
            let quarters = (num * (4 * N as u64 + 1)) % (4 * den);
            (TAU * quarters as f64 / (4 * den) as f64).sin() as f32
        };

        // C + G: a million swings is a multiple of the period (2), so the pen
        // sits exactly where it did at the start.
        let fifth = cfg(&[60, 67], true);
        let late = recompute(&fifth, N, 0.25);
        let early = recompute(&fifth, 0, 0.25);
        assert_eq!(late.notes[1].displacement, early.notes[1].displacement);
        assert_eq!(late.notes[0].displacement, early.notes[0].displacement);
        assert_eq!(late.phase, 1_000_000.25, "phase stays unreduced");

        for (notes, num, den) in [([60, 67], 3, 2), ([60, 65], 4, 3), ([60, 66], 45, 32)] {
            let state = recompute(&cfg(&notes, true), N, 0.25);
            let got = state.notes[1].displacement;
            assert!(
                (got - exact(num, den)).abs() < 1e-6,
                "{num}/{den}: got {got}, exact {}",
                exact(num, den)
            );
            assert_eq!(state.phase, 1_000_000.25);
        }
    }

    #[test]
    fn et_mode_drifts_past_the_just_period() {
        // C + G has a just period of 2 swings.
        let just = cfg(&[60, 67], true);
        assert_eq!(
            recompute(&just, 2, 0.0).notes[1].displacement,
            recompute(&just, 0, 0.0).notes[1].displacement,
            "the just fifth is back exactly where it started"
        );

        // The piano's fifth (1.4983) is a hair under 3/2, so after the same two
        // swings it has not come home: sin(2π · frac(2 · 2^(7/12))) = -0.0213.
        let piano = cfg(&[60, 67], false);
        let start = recompute(&piano, 0, 0.0).notes[1].displacement;
        let after = recompute(&piano, 2, 0.0).notes[1].displacement;
        assert!(
            (after + 0.021_272).abs() < 1e-5,
            "after one period: {after}"
        );
        assert!((after - start).abs() > 0.02);

        // The miss compounds rather than snapping back: ten periods on, the
        // pen is clearly somewhere else.
        let later = recompute(&piano, 20, 0.0).notes[1].displacement;
        assert!((later - start).abs() > 0.05, "after ten periods: {later}");
    }

    #[test]
    fn a_lower_second_note_still_oscillates() {
        // Root A4, second note D4 a fifth below: ratio 2/3, three root swings
        // per figure.
        let lower = cfg(&[69, 62], true);
        let state = recompute(&lower, 1, 0.5);
        assert_eq!((state.notes[1].num, state.notes[1].den), (2, 3));
        assert_eq!(state.period, 3);
        // At phase 1.5 it has finished exactly one swing of its own...
        assert!(state.notes[1].displacement.abs() < 1e-6);
        // ...and it does swing: top of its range a quarter of the way through
        // one (0.375 root swings), bottom at three quarters (1.125).
        let top = recompute(&lower, 0, 0.375).notes[1].displacement;
        let bottom = recompute(&lower, 1, 0.125).notes[1].displacement;
        assert!((top - 1.0).abs() < 1e-6, "top: {top}");
        assert!((bottom + 1.0).abs() < 1e-6, "bottom: {bottom}");
    }

    #[test]
    fn advance_to_is_idempotent_and_pure() {
        let rule = Notes;
        let cfg = cfg(&[60, 64, 67], true);
        let mut state = rule.init(&cfg, 0);

        rule.advance_to(&mut state, &cfg, 0, 5);
        let at_five = snapshot(&state);
        rule.advance_to(&mut state, &cfg, 0, 5);
        assert_eq!(snapshot(&state), at_five, "same n twice");

        // Going backwards is the same as never having gone forward.
        rule.advance_to(&mut state, &cfg, 0, 2);
        let mut fresh = rule.init(&cfg, 0);
        rule.advance_to(&mut fresh, &cfg, 0, 2);
        assert_eq!(snapshot(&state), snapshot(&fresh));
        assert_ne!(snapshot(&state), at_five);
        assert_eq!(state.phase, 2.0);

        // The model is rebuilt from the config it is given each time.
        rule.advance_to(&mut state, &self::cfg(&[60, 67], true), 0, 2);
        assert_eq!(state.notes.len(), 2);
    }

    #[test]
    fn substep_sets_fractional_phase_and_closed() {
        let rule = Notes;
        let cfg = cfg(&[60, 67], true); // period 2
        let mut state = rule.init(&cfg, 0);

        rule.substep(&mut state, &cfg, 0, 1, 0.5);
        assert_eq!(state.phase, 1.5);
        assert!(!state.closed);

        rule.substep(&mut state, &cfg, 0, 2, 0.0);
        assert_eq!(state.phase, 2.0);
        assert!(state.closed);

        // `sub` is clamped into [0, 1].
        rule.substep(&mut state, &cfg, 0, 1, 1.7);
        assert_eq!(state.phase, 2.0);
        assert!(state.closed);
        rule.substep(&mut state, &cfg, 0, 1, -0.3);
        assert_eq!(state.phase, 1.0);
        assert!(!state.closed);

        // The dots move with it: phase 1.25 puts the root at the top and the
        // fifth (1.5 · 1.25 = 1.875 cycles) at sin(-π/4).
        rule.substep(&mut state, &cfg, 0, 1, 0.25);
        assert!((state.notes[0].displacement - 1.0).abs() < 1e-6);
        assert!((state.notes[1].displacement + FRAC_1_SQRT_2).abs() < 1e-6);
    }

    #[test]
    fn clear_zeroes_motion_state() {
        let rule = Notes;
        let cfg = cfg(&[60, 64, 67], true);
        let fresh = rule.init(&cfg, 0);

        let mut state = rule.init(&cfg, 0);
        rule.substep(&mut state, &cfg, 0, 5, 0.37);
        assert!(state.closed);
        assert!(state.notes.iter().any(|n| n.displacement != 0.0));

        state.clear();
        assert_eq!(state.phase, 0.0);
        assert!(!state.closed);
        assert!(state.notes.iter().all(|n| n.displacement == 0.0));
        // The model survives, so a clear never rebuilds ratios.
        assert_eq!(state.period, 4);
        assert_eq!(fractions(&state), vec![(1, 1), (5, 4), (3, 2)]);
        assert_eq!(snapshot(&state), snapshot(&fresh));
    }

    #[test]
    fn capabilities_and_id() {
        assert_eq!(Notes.id(), "notes");
        let caps = Notes.capabilities();
        assert!(caps.supports_scrub);
        assert!(caps.cheap_recompute);
        assert!(caps.checkpoint_every.is_none());
    }

    fn sorted_keys(value: &serde_json::Value) -> Vec<&str> {
        let mut keys: Vec<&str> = value
            .as_object()
            .expect("an object")
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        keys
    }

    #[test]
    fn summary_has_documented_shape() {
        let rule = Notes;
        let cfg = cfg(&[60, 67], true);
        let mut state = rule.init(&cfg, 0);

        let summary = rule.summary(&state);
        assert_eq!(
            sorted_keys(&summary),
            ["closed", "just_intonation", "notes", "period", "phase"]
        );
        assert_eq!(summary["phase"], 0.0);
        assert_eq!(summary["period"], 2);
        assert_eq!(summary["closed"], false);
        assert_eq!(summary["just_intonation"], true);

        let notes = summary["notes"].as_array().expect("notes array");
        assert_eq!(notes.len(), 2);
        assert_eq!(
            sorted_keys(&notes[1]),
            ["den", "displacement", "midi", "num", "ratio"]
        );
        assert_eq!(notes[1]["midi"], 67);
        assert_eq!(notes[1]["num"], 3);
        assert_eq!(notes[1]["den"], 2);
        assert_eq!(notes[1]["ratio"], 1.5);
        assert_eq!(notes[1]["displacement"], 0.0);

        rule.advance_to(&mut state, &cfg, 0, 2);
        let summary = rule.summary(&state);
        assert_eq!(summary["closed"], true);
        assert_eq!(summary["phase"], 2.0);
    }

    #[test]
    fn summary_reports_just_fractions_in_piano_mode() {
        let rule = Notes;
        let state = rule.init(&cfg(&[60, 67], false), 0);
        let summary = rule.summary(&state);
        assert_eq!(summary["just_intonation"], false);
        // The UI picks the label by `just_intonation`; the fraction is always
        // just, the ratio is what actually swings.
        let fifth = &summary["notes"][1];
        assert_eq!(fifth["num"], 3);
        assert_eq!(fifth["den"], 2);
        assert!((fifth["ratio"].as_f64().unwrap() - et_ratio(7)).abs() < 1e-9);
    }
}
