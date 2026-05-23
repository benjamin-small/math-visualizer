// Mirrors crates/viz-core/src/engine/playback.rs::Command. Shape: {kind: "..."}.

export type Command =
  | { kind: 'Play' }
  | { kind: 'Pause' }
  | { kind: 'TogglePlay' }
  | { kind: 'StepForward' }
  | { kind: 'StepBack' }
  | { kind: 'JumpTo'; iteration: number }
  | { kind: 'SetSpeed'; value: number }
  | { kind: 'SetSeed'; value: string }   // string-encoded u64; engine parses
  | { kind: 'Reset' };

export const cmd = {
  play:        (): Command => ({ kind: 'Play' }),
  pause:       (): Command => ({ kind: 'Pause' }),
  togglePlay:  (): Command => ({ kind: 'TogglePlay' }),
  stepForward: (): Command => ({ kind: 'StepForward' }),
  stepBack:    (): Command => ({ kind: 'StepBack' }),
  jumpTo:      (iteration: number): Command => ({ kind: 'JumpTo', iteration }),
  setSpeed:    (value: number): Command => ({ kind: 'SetSpeed', value }),
  // Note: SetSeed transit format is decimal-string for u64 range; engine
  // does the parse. Phase 4 introduces a real seed widget.
  setSeed:     (value: string): Command => ({ kind: 'SetSeed', value }),
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
