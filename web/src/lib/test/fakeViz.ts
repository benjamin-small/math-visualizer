// Shared test double for the viz-core WASM module. Component tests
// `vi.mock('../../wasm/loader')` to hand back `makeVizMock()` so LabShell
// mounts without a WebGL context.
import { vi } from 'vitest';
import type { FourierSummary } from '../fourier/summary';
import type { NotesSummary } from '../notes/summary';
import type { LaneSummary, SortingSummary } from '../sorting/summary';

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
/** Records every `Engine.update_rule_config_with_image(cfg, w, h, rgba)` — the JPEG lab's typed-array push. */
export const updateRuleConfigWithImageSpy = vi.fn();
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

const SORTING_ALGORITHMS = ['bubble', 'insertion', 'selection', 'shell', 'merge', 'quick', 'heap'] as const;
const SORTING_DATASETS = ['random', 'nearly_sorted', 'reversed', 'few_unique'] as const;

/** What the fake's `rule_summary()` returns on the sorting lab: 7x4=28 idle lanes, row-major (lane = row*4 + col). */
export const sortingSummaryFixture: SortingSummary = {
  rows: 7,
  cols: 4,
  tick: 0,
  all_done: false,
  lanes: SORTING_ALGORITHMS.flatMap((algorithm) =>
    SORTING_DATASETS.map(
      (dataset): LaneSummary => ({
        algorithm,
        dataset,
        compares: 0,
        writes: 0,
        cursor: 0,
        total: 100,
        running: false,
        done: false,
        size: 50,
        last_kind: null,
        last_value: null,
      }),
    ),
  ),
};

/**
 * What the fake's `rule_summary()` returns on the notes lab: C4 + G4 in just intonation, a 3:2 that
 * closes after two swings of C, not yet started. Mutable so a test can move `phase`, flip `closed`
 * or drop a note before a read (and restore it in `finally`).
 */
export const notesSummaryFixture: NotesSummary = {
  phase: 0,
  period: 2,
  closed: false,
  just_intonation: true,
  notes: [
    { midi: 60, ratio: 1, num: 1, den: 1, displacement: 0 },
    { midi: 67, ratio: 1.5, num: 3, den: 2, displacement: 0 },
  ],
};

/** A JPEG summary's selected block: a soft ramp, so every stage has numbers to show. */
const jpegBlock = Array.from({ length: 64 }, (_, i) => 100 + (i % 8) * 4 + Math.floor(i / 8) * 2);

/**
 * What the fake's `rule_summary()` returns on the JPEG lab: the 256² gradient
 * at quality 50, 4:2:0, a quarter scanned. Mutable so a test can reshape it.
 */
export const jpegSummaryFixture = {
  version: 1,
  n: 64,
  total: 256,
  width: 256,
  height: 256,
  bytes: 4096,
  raw_bytes: 196608,
  bits_so_far: 8000,
  payload_bits: 30000,
  entropy_bits: 28000,
  psnr: 36.5,
  quality: 50,
  subsampling: '420',
  mcu: [16, 16, 16, 16],
  grids: [
    [32, 32],
    [16, 16],
    [16, 16],
  ],
  selected: {
    component: 0,
    bx: 21,
    by: 17,
    mcu: 136,
    pixels: jpegBlock,
    shifted: jpegBlock.map((v) => v - 128),
    dct: jpegBlock.map((_, i) => (i === 0 ? 120 : i < 3 ? -20 : 0)),
    quant: jpegBlock.map((_, i) => (i === 0 ? 8 : 0)),
    table: Array.from({ length: 64 }, () => 16),
    zigzag: jpegBlock.map((_, i) => (i === 0 ? 8 : 0)),
    dc_prev: 6,
    dc_diff: 2,
    tokens: [{ run: 0, size: 0, amp: 0, symbol: 0 }],
    bit_span: [100, 6],
    bits: '010101',
  },
  error: undefined as string | undefined,
};

/** What the fake's `viz_readout()` returns on the notes lab (null elsewhere). Mutable so a test can move the 4D angle. */
export const notesVizReadout = { angle_4d: 0 };

/** What the fake's `snapshot()` returns. Mutable so a test can park the clock mid-scan, playing. */
export const snapshotFixture = {
  iteration: 0,
  sub_progress: 0,
  playing: false,
  speed: 1.0,
  seed: 0,
  max_iterations: 360,
};

export class FakeEngine {
  private readonly _lab: string | null | undefined;

  constructor(_id: string, lab?: string | null) {
    this._lab = lab;
  }

  free() { freeSpy(); }
  frame(_now: number) {}
  dispatch(cmd: unknown) { dispatchSpy(cmd); }
  snapshot() { return { ...snapshotFixture }; }
  rule_schema() { return {}; }
  viz_schema() { return {}; }
  rule_config() { return {}; }
  rule_summary() {
    if (this._lab === 'fourier') return ruleSummaryFixture;
    if (this._lab === 'sorting') return sortingSummaryFixture;
    if (this._lab === 'notes') return notesSummaryFixture;
    if (this._lab === 'jpeg') return jpegSummaryFixture;
    return null;
  }
  viz_readout() { return this._lab === 'notes' ? notesVizReadout : null; }
  viz_config() { return {}; }
  update_rule_config(cfg: unknown) { updateRuleConfigSpy(cfg); }
  update_rule_config_with_path(cfg: unknown, xy: Float32Array, pen: Uint8Array) { updateRuleConfigWithPathSpy(cfg, xy, pen); }
  update_rule_config_with_image(cfg: unknown, w: number, h: number, rgba: Uint8Array) {
    updateRuleConfigWithImageSpy(cfg, w, h, rgba);
  }
  rule_inspect(_key: string) { return undefined; }
  rule_bytes() { return this._lab === 'jpeg' ? new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) : undefined; }
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
  return {
    Engine: FakeEngine,
    // The few kit functions the JPEG lab calls: shaped like the real ones, values are placeholders.
    jpeg_builtin_image: (_id: string, w: number, h: number) => new Uint8Array(w * h * 4).fill(128),
    jpeg_zigzag_order: () => Uint8Array.from({ length: 64 }, (_, i) => i),
    jpeg_dct_1d: (x: Float32Array) => Float32Array.from(x, (_, i) => (i === 0 ? 10 : 0)),
    jpeg_dft_1d: (x: Float32Array) => new Float32Array(x.length * 2).fill(1),
  } as unknown as typeof import('viz-core');
}
