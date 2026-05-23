//! Pure-state-machine playback model. The engine wraps this with side
//! effects (rule recompute, GL calls). Keeping the reducer pure makes
//! command behavior unit-testable without WebGL.

use serde::{Deserialize, Serialize};

use crate::traits::Capabilities;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct PlaybackState {
    pub iteration: u32,
    pub sub_progress: f32,
    pub playing: bool,
    pub speed: f32,
    pub seed: u64,
    pub max_iterations: u32,
}

impl PlaybackState {
    pub fn initial(seed: u64, max_iterations: u32) -> Self {
        Self {
            iteration: 0,
            sub_progress: 0.0,
            playing: false,
            speed: 1.0,
            seed,
            max_iterations: max_iterations.max(1),
        }
    }
}

/// User intents from the UI. Serialized from JS as `{"kind":"...", ...}`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum Command {
    Play,
    Pause,
    TogglePlay,
    StepForward,
    StepBack,
    JumpTo { iteration: u32 },
    SetSpeed { value: f32 },
    SetSeed { value: u64 },
    Reset,
}

/// Pure reducer: given the current playback state, current capabilities, and
/// a command, returns the next playback state. Whether `iteration` actually
/// changed (so the engine knows to recompute scene state) is signaled by
/// the `iteration_changed` flag in the returned struct.
#[derive(Debug, Clone, Copy)]
pub struct ReduceResult {
    pub next: PlaybackState,
    pub iteration_changed: bool,
    pub seed_changed: bool,
}

pub fn reduce(prev: PlaybackState, caps: Capabilities, cmd: &Command) -> ReduceResult {
    let mut next = prev;
    let mut iteration_changed = false;
    let mut seed_changed = false;

    match cmd {
        Command::Play => next.playing = prev.iteration < prev.max_iterations,
        Command::Pause => next.playing = false,
        Command::TogglePlay => {
            next.playing = !prev.playing && prev.iteration < prev.max_iterations;
        }
        Command::StepForward => {
            // Step preserves play state — scrubbing while playing keeps the
            // animation running from the new iteration.
            next.sub_progress = 0.0;
            if prev.iteration < prev.max_iterations {
                next.iteration = prev.iteration + 1;
                iteration_changed = true;
            }
        }
        Command::StepBack => {
            if !caps.supports_scrub {
                // Rule doesn't support going backward; ignore.
            } else {
                next.sub_progress = 0.0;
                if prev.iteration > 0 {
                    next.iteration = prev.iteration - 1;
                    iteration_changed = true;
                }
            }
        }
        Command::JumpTo { iteration } => {
            let target = (*iteration).min(prev.max_iterations);
            if !caps.supports_scrub && target < prev.iteration {
                // Rejected silently for non-scrubbing rules.
            } else if target != prev.iteration {
                next.iteration = target;
                next.sub_progress = 0.0;
                next.playing = false;
                iteration_changed = true;
            }
        }
        Command::SetSpeed { value } => {
            next.speed = value.max(0.0);
        }
        Command::SetSeed { value } => {
            if *value != prev.seed {
                next.seed = *value;
                next.iteration = 0;
                next.sub_progress = 0.0;
                next.playing = false;
                seed_changed = true;
                iteration_changed = true;
            }
        }
        Command::Reset => {
            next.iteration = 0;
            next.sub_progress = 0.0;
            next.playing = false;
            iteration_changed = prev.iteration != 0 || prev.sub_progress != 0.0;
        }
    }

    ReduceResult { next, iteration_changed, seed_changed }
}

/// Advance time during play. Called from the per-frame loop with dt in
/// seconds. Returns the integer iteration delta (0 most frames, ≥1 on
/// rollover). When `iteration` reaches `max_iterations`, playback auto-pauses.
pub fn advance_time(state: &mut PlaybackState, dt_seconds: f32) -> u32 {
    if !state.playing || state.iteration >= state.max_iterations {
        return 0;
    }
    state.sub_progress += dt_seconds * state.speed;
    let mut rolled = 0u32;
    while state.sub_progress >= 1.0 && state.iteration < state.max_iterations {
        state.sub_progress -= 1.0;
        state.iteration += 1;
        rolled += 1;
    }
    if state.iteration >= state.max_iterations {
        state.iteration = state.max_iterations;
        state.sub_progress = 0.0;
        state.playing = false;
    }
    rolled
}

#[cfg(test)]
mod tests {
    use super::*;

    fn caps_full() -> Capabilities { Capabilities::cheap_scrubbable() }
    fn caps_no_scrub() -> Capabilities {
        Capabilities { supports_scrub: false, cheap_recompute: false, checkpoint_every: None }
    }

    #[test]
    fn play_does_nothing_at_end() {
        let mut s = PlaybackState::initial(0, 10);
        s.iteration = 10;
        let r = reduce(s, caps_full(), &Command::Play);
        assert!(!r.next.playing);
    }

    #[test]
    fn step_forward_increments_without_changing_play_state() {
        let paused = PlaybackState::initial(0, 10);
        let r = reduce(paused, caps_full(), &Command::StepForward);
        assert_eq!(r.next.iteration, 1);
        assert!(!r.next.playing, "stepping while paused stays paused");
        assert!(r.iteration_changed);

        let mut playing = PlaybackState::initial(0, 10);
        playing.playing = true;
        let r = reduce(playing, caps_full(), &Command::StepForward);
        assert_eq!(r.next.iteration, 1);
        assert!(r.next.playing, "stepping while playing keeps playing");
    }

    #[test]
    fn step_back_respects_capabilities() {
        let mut s = PlaybackState::initial(0, 10);
        s.iteration = 5;
        let r = reduce(s, caps_no_scrub(), &Command::StepBack);
        assert_eq!(r.next.iteration, 5);
        assert!(!r.iteration_changed);
    }

    #[test]
    fn step_back_at_zero_is_noop() {
        let s = PlaybackState::initial(0, 10);
        let r = reduce(s, caps_full(), &Command::StepBack);
        assert_eq!(r.next.iteration, 0);
        assert!(!r.iteration_changed);
    }

    #[test]
    fn jump_to_clamps_to_max() {
        let s = PlaybackState::initial(0, 10);
        let r = reduce(s, caps_full(), &Command::JumpTo { iteration: 999 });
        assert_eq!(r.next.iteration, 10);
        assert!(r.iteration_changed);
    }

    #[test]
    fn jump_backward_rejected_without_scrub() {
        let mut s = PlaybackState::initial(0, 10);
        s.iteration = 5;
        let r = reduce(s, caps_no_scrub(), &Command::JumpTo { iteration: 2 });
        assert_eq!(r.next.iteration, 5);
        assert!(!r.iteration_changed);
    }

    #[test]
    fn set_seed_resets_iteration() {
        let mut s = PlaybackState::initial(42, 10);
        s.iteration = 7;
        s.playing = true;
        let r = reduce(s, caps_full(), &Command::SetSeed { value: 99 });
        assert_eq!(r.next.seed, 99);
        assert_eq!(r.next.iteration, 0);
        assert!(!r.next.playing);
        assert!(r.iteration_changed);
        assert!(r.seed_changed);
    }

    #[test]
    fn reset_signals_change_only_when_not_already_zero() {
        let zero = PlaybackState::initial(0, 10);
        assert!(!reduce(zero, caps_full(), &Command::Reset).iteration_changed);

        let mut nonzero = PlaybackState::initial(0, 10);
        nonzero.iteration = 3;
        assert!(reduce(nonzero, caps_full(), &Command::Reset).iteration_changed);
    }

    #[test]
    fn advance_time_rolls_iterations_at_one_per_second_default() {
        let mut s = PlaybackState::initial(0, 10);
        s.playing = true;
        let rolled = advance_time(&mut s, 1.5);
        assert_eq!(rolled, 1);
        assert_eq!(s.iteration, 1);
        assert!((s.sub_progress - 0.5).abs() < 1e-6);
    }

    #[test]
    fn advance_time_clamps_at_max_and_pauses() {
        let mut s = PlaybackState::initial(0, 5);
        s.playing = true;
        let rolled = advance_time(&mut s, 100.0);
        assert_eq!(s.iteration, 5);
        assert!(!s.playing);
        // Rolled at most max_iterations times.
        assert_eq!(rolled, 5);
    }

    #[test]
    fn set_speed_clamps_negative_to_zero() {
        let s = PlaybackState::initial(0, 10);
        let r = reduce(s, caps_full(), &Command::SetSpeed { value: -3.5 });
        assert_eq!(r.next.speed, 0.0);
    }

    #[test]
    fn command_serde_round_trip() {
        let cmd = Command::JumpTo { iteration: 17 };
        let json = serde_json::to_string(&cmd).unwrap();
        assert!(json.contains("\"kind\":\"JumpTo\""));
        let back: Command = serde_json::from_str(&json).unwrap();
        match back {
            Command::JumpTo { iteration } => assert_eq!(iteration, 17),
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn pause_always_sets_playing_false() {
        let mut s = PlaybackState::initial(0, 10);
        s.playing = true;
        s.iteration = 3;
        let r = reduce(s, caps_full(), &Command::Pause);
        assert!(!r.next.playing);
        assert_eq!(r.next.iteration, 3, "pause must not move iteration");
        assert!(!r.iteration_changed);
    }

    #[test]
    fn toggle_play_at_end_stays_paused() {
        let mut s = PlaybackState::initial(0, 10);
        s.iteration = 10;
        s.playing = false;
        let r = reduce(s, caps_full(), &Command::TogglePlay);
        assert!(!r.next.playing, "cannot toggle into play when at max_iterations");
    }

    #[test]
    fn advance_time_when_paused_is_noop() {
        let mut s = PlaybackState::initial(0, 10);
        s.playing = false;
        s.sub_progress = 0.3;
        let rolled = advance_time(&mut s, 10.0);
        assert_eq!(rolled, 0);
        assert_eq!(s.iteration, 0);
        assert!((s.sub_progress - 0.3).abs() < 1e-6, "sub_progress unchanged when paused");
    }
}
