// Shared test double for the viz-core WASM module. Component tests
// `vi.mock('../../wasm/loader')` to hand back `makeVizMock()` so LabShell
// mounts without a WebGL context.
import { vi } from 'vitest';

/** jsdom has no rAF; drive frame loops off setTimeout(0) so one frame runs per macrotask. */
export function installRafPolyfill() {
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 0)) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as typeof cancelAnimationFrame;
}

/** Records every `Engine.free()` so tests can assert the shell releases the engine on teardown. */
export const freeSpy = vi.fn();
/** Records every `Engine.dispatch(cmd)` so tests can assert on playback commands (e.g. Play after a config push). */
export const dispatchSpy = vi.fn();
/** Records every `Engine.update_rule_config(cfg)` so tests can assert on the config a lab pushes. */
export const updateRuleConfigSpy = vi.fn();

export class FakeEngine {
  private readonly _lab: string | null | undefined;

  constructor(_id: string, lab?: string | null) {
    this._lab = lab;
  }

  free() { freeSpy(); }
  frame(_now: number) {}
  dispatch(cmd: unknown) { dispatchSpy(cmd); }
  snapshot() {
    return {
      iteration: 0,
      sub_progress: 0,
      playing: false,
      speed: 1.0,
      seed: 0,
      max_iterations: 360,
    };
  }
  rule_schema() { return {}; }
  viz_schema() { return {}; }
  rule_config() { return {}; }
  viz_config() { return {}; }
  update_rule_config(cfg: unknown) { updateRuleConfigSpy(cfg); }
  update_viz_config(_: unknown) {}
  capabilities() { return { supports_scrub: true, cheap_recompute: true, checkpoint_every: null }; }
  resize(_w: number, _h: number) {}
  forward_input(_ev: unknown) {}
  set_zoom(_z: number) {}
  lab_id() { return this._lab ?? 'sierpinski'; }
}

/** Shaped like the resolved `viz-core` module, which is all `loadVizCore()` callers touch. */
export function makeVizMock() {
  return { Engine: FakeEngine } as unknown as typeof import('viz-core');
}
