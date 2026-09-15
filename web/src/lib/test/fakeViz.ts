// Shared test double for the viz-core WASM module. Component tests
// `vi.mock('../../wasm/loader')` to hand back `makeVizMock()` so LabShell
// mounts without a WebGL context.
import { vi } from 'vitest';
import type { FourierSummary } from '../fourier/summary';

/** jsdom has no rAF; drive frame loops off setTimeout(0) so one frame runs per macrotask. */
export function installRafPolyfill() {
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 0)) as unknown as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as unknown as typeof cancelAnimationFrame;
}

/** Records every `Engine.free()` so tests can assert the shell releases the engine on teardown. */
export const freeSpy = vi.fn();
/** Records every `Engine.dispatch(cmd)` so tests can assert on playback commands (e.g. Play after a config push). */
export const dispatchSpy = vi.fn();
/** Records every `Engine.update_rule_config(cfg)` so tests can assert on the config a lab pushes. */
export const updateRuleConfigSpy = vi.fn();
/** Records every `Engine.update_rule_config_with_path(cfg, xy, pen)` — the Fourier lab's typed-array push. */
export const updateRuleConfigWithPathSpy = vi.fn();
/** Records every `Engine.update_viz_config(cfg)` call. */
export const updateVizConfigSpy = vi.fn();
/** Records every `Engine.rule_action(action)` call; the fake always accepts (returns true). */
export const ruleActionSpy = vi.fn();
/**
 * What the fake's `rule_summary()` returns on the Fourier lab (null elsewhere,
 * like the real engine). Mutable so a test can reshape it before a push;
 * `total_terms` deliberately exceeds `terms.length`, mirroring the engine's
 * "top 64 of N" contract.
 */
export const ruleSummaryFixture: FourierSummary = {
  origin: [0.1, -0.05],
  total_terms: 2000,
  terms: [
    { freq: 1, amp: 0.5, phase: 0.1 },
    { freq: -1, amp: 0.25, phase: -0.2 },
    { freq: 2, amp: 0.125, phase: 0 },
  ],
};

/** One sorting-lab grid cell (lane = row * cols + col). */
export interface SortingLane {
  algorithm: string;
  dataset: string;
  compares: number;
  writes: number;
  cursor: number;
  total: number;
  running: boolean;
  done: boolean;
}

/** Shape of the sorting lab's `rule_summary()`: a 7 (algorithms) x 4 (datasets) grid of lanes. */
export interface SortingSummary {
  rows: number;
  cols: number;
  tick: number;
  all_done: boolean;
  lanes: SortingLane[];
}

const SORTING_ALGORITHMS = ['bubble', 'insertion', 'selection', 'shell', 'merge', 'quick', 'heap'] as const;
const SORTING_DATASETS = ['random', 'nearly_sorted', 'reversed', 'few_unique'] as const;

/** What the fake's `rule_summary()` returns on the sorting lab: 7x4=28 idle lanes, row-major (lane = row*4 + col). */
export const sortingSummaryFixture: SortingSummary = {
  rows: 7,
  cols: 4,
  tick: 0,
  all_done: false,
  lanes: SORTING_ALGORITHMS.flatMap((algorithm) =>
    SORTING_DATASETS.map((dataset) => ({
      algorithm,
      dataset,
      compares: 0,
      writes: 0,
      cursor: 0,
      total: 100,
      running: false,
      done: false,
    })),
  ),
};

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
  rule_summary() {
    if (this._lab === 'fourier') return ruleSummaryFixture;
    if (this._lab === 'sorting') return sortingSummaryFixture;
    return null;
  }
  viz_config() { return {}; }
  update_rule_config(cfg: unknown) { updateRuleConfigSpy(cfg); }
  update_rule_config_with_path(cfg: unknown, xy: Float32Array, pen: Uint8Array) { updateRuleConfigWithPathSpy(cfg, xy, pen); }
  update_viz_config(cfg: unknown) { updateVizConfigSpy(cfg); }
  rule_action(action: unknown) { ruleActionSpy(action); return true; }
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
