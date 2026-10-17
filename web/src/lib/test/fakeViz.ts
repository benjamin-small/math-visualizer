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
/** Records every kit `jpeg_decode(bytes)` call, so tests can assert the lab decodes once per encode. */
export const jpegDecodeSpy = vi.fn();
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
  code_bits: 29000,
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
    dc_size: 2,
    dc_code: '011',
    dc_amp_bits: '10',
    tokens: [{ run: 0, size: 0, amp: 0, symbol: 0, code: '1010', amp_bits: '' }],
    bit_span: [100, 9],
    bits: '011101010',
  },
  hints: { blocking: [3, 4], ringing: [5, 6], bleed: [7, 8] },
  error: undefined as string | undefined,
};

/** What the fake's `viz_readout()` returns on the notes lab (null elsewhere). Mutable so a test can move the 4D angle. */
export const notesVizReadout = { angle_4d: 0 };

/** What the fake's `viz_readout()` returns on the JPEG lab: how far the zigzag path has got. Mutable. */
export const jpegVizReadout = { zigzag: 10 };

/** What the fake's `rule_inspect(key)` returns on the JPEG lab, by key. */
export const jpegInspectFixture: Record<string, unknown> = {
  tables: { luma: Array.from({ length: 64 }, () => 16), chroma: Array.from({ length: 64 }, () => 17) },
  huffman: ['dc_luma', 'ac_luma', 'dc_chroma', 'ac_chroma'].map((name) => ({
    name,
    bits: [0, 2, ...Array.from({ length: 14 }, () => 0)],
    vals: [0, 1],
    codes: [
      { symbol: 0, code: '00' },
      { symbol: 1, code: '01' },
    ],
    counts: [
      [0, 30],
      [1, 10],
    ],
    entropy_bits: 32.5,
    actual_bits: 80,
  })),
  segments: [
    { marker: 0xd8, kind: 'Soi', offset: 0, len: 2 },
    { marker: 0xdb, kind: 'Dqt', offset: 2, len: 134 },
    { marker: 0xda, kind: 'Sos', offset: 136, len: 3958 },
    { marker: 0xd9, kind: 'Eoi', offset: 4094, len: 2 },
  ],
};

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
  viz_readout() {
    if (this._lab === 'notes') return notesVizReadout;
    return this._lab === 'jpeg' ? jpegVizReadout : null;
  }
  viz_config() { return {}; }
  update_rule_config(cfg: unknown) { updateRuleConfigSpy(cfg); }
  update_rule_config_with_path(cfg: unknown, xy: Float32Array, pen: Uint8Array) { updateRuleConfigWithPathSpy(cfg, xy, pen); }
  update_rule_config_with_image(cfg: unknown, w: number, h: number, rgba: Uint8Array) {
    updateRuleConfigWithImageSpy(cfg, w, h, rgba);
  }
  rule_inspect(key: string) { return this._lab === 'jpeg' ? jpegInspectFixture[key] : undefined; }
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
    // The decoded copy: one RGBA pixel per picture pixel (the summary fixture's size), all zero.
    jpeg_decode: (bytes: Uint8Array) => {
      jpegDecodeSpy(bytes);
      return new Uint8Array(jpegSummaryFixture.width * jpegSummaryFixture.height * 4);
    },
    jpeg_dft_1d: (x: Float32Array) => new Float32Array(x.length * 2).fill(1),
    // Size grows and PSNR climbs with quality; the other Huffman mode costs 5000 bytes at any quality.
    jpeg_encode_stats: (_rgba: Uint8Array, _w: number, _h: number, q: number, _s: string, huffman: string) => ({
      bytes: huffman === 'standard' ? 5000 : 1000 + 40 * q,
      psnr: 20 + q / 5,
    }),
    // Each generation drifts one more level from the original in every channel.
    jpeg_encode_decode: (rgba: Uint8Array) => Uint8Array.from(rgba, (v) => Math.min(255, v + 1)),
    jpeg_huffman_tree: () => [
      { depth: 0, code: '', symbol: null },
      { depth: 1, code: '0', symbol: null },
      { depth: 2, code: '00', symbol: 0 },
      { depth: 2, code: '01', symbol: 1 },
    ],
  } as unknown as typeof import('viz-core');
}
