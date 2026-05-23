// Mirrors crates/viz-core/src/engine/playback.rs::Command. Shape: {kind: "..."}.

export type Command =
  | { kind: 'Play' }
  | { kind: 'Pause' }
  | { kind: 'TogglePlay' }
  | { kind: 'StepForward' }
  | { kind: 'StepBack' }
  | { kind: 'JumpTo'; iteration: number }
  | { kind: 'SetSpeed'; value: number }
  | { kind: 'SetSeed'; value: number }   // u64 in Rust; JS Number is safe up to 2^53. Phase 4 may revisit for shareable seeds spanning the full u64 range.
  | { kind: 'Reset' };

export const cmd = {
  play:        (): Command => ({ kind: 'Play' }),
  pause:       (): Command => ({ kind: 'Pause' }),
  togglePlay:  (): Command => ({ kind: 'TogglePlay' }),
  stepForward: (): Command => ({ kind: 'StepForward' }),
  stepBack:    (): Command => ({ kind: 'StepBack' }),
  jumpTo:      (iteration: number): Command => ({ kind: 'JumpTo', iteration }),
  setSpeed:    (value: number): Command => ({ kind: 'SetSpeed', value }),
  setSeed:     (value: number): Command => ({ kind: 'SetSeed', value }),
  reset:       (): Command => ({ kind: 'Reset' }),
};

export interface PlaybackSnapshot {
  iteration: number;
  sub_progress: number;
  playing: boolean;
  speed: number;
  seed: number;          // Note: JS Number loses precision above 2^53.
  max_iterations: number;
}

export interface Capabilities {
  supports_scrub: boolean;
  cheap_recompute: boolean;
  checkpoint_every: number | null;
}
