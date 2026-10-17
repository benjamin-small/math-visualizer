// The IJG quality scaling and the standard tables, as the encoder applies them
// (mirrors `crates/jpeg/src/quant.rs`), so a card can say what another quality
// would do to a block without encoding anything.
import type { ExplainContext } from './context';

/** ITU T.81 Annex K, Table K.1 (luminance), row-major. */
export const STD_LUMA: readonly number[] = [
  16, 11, 10, 16, 24, 40, 51, 61, //
  12, 12, 14, 19, 26, 58, 60, 55, //
  14, 13, 16, 24, 40, 57, 69, 56, //
  14, 17, 22, 29, 51, 87, 80, 62, //
  18, 22, 37, 56, 68, 109, 103, 77, //
  24, 35, 55, 64, 81, 104, 113, 92, //
  49, 64, 78, 87, 103, 121, 120, 101, //
  72, 92, 95, 98, 112, 100, 103, 99, //
];

/** ITU T.81 Annex K, Table K.2 (chrominance), row-major. */
export const STD_CHROMA: readonly number[] = [
  17, 18, 24, 47, 99, 99, 99, 99, //
  18, 21, 26, 66, 99, 99, 99, 99, //
  24, 26, 56, 99, 99, 99, 99, 99, //
  47, 66, 99, 99, 99, 99, 99, 99, //
  99, 99, 99, 99, 99, 99, 99, 99, //
  99, 99, 99, 99, 99, 99, 99, 99, //
  99, 99, 99, 99, 99, 99, 99, 99, //
  99, 99, 99, 99, 99, 99, 99, 99, //
];

/** `ZIGZAG[k]` is the row-major index of the k-th pattern in scan order (low frequencies first). */
export const ZIGZAG: readonly number[] = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, //
  12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, //
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, //
  58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63, //
];

const clampQuality = (q: number) => Math.min(100, Math.max(1, Math.trunc(q)));

/** The scaling percentage: `5000 / q` below 50, `200 − 2q` from 50 (q clamped to 1-100). */
export function scaleFactor(q: number): number {
  const c = clampQuality(q);
  return c < 50 ? Math.floor(5000 / c) : 200 - 2 * c;
}

/** `base` scaled to quality `q`: each entry `floor((b·s + 50) / 100)`, clamped to 1-255. */
export function scaleTable(base: readonly number[], q: number): number[] {
  const s = scaleFactor(q);
  return base.map((b) => Math.min(255, Math.max(1, Math.floor((b * s + 50) / 100))));
}

/** Round to the nearest whole number, halves away from zero (like Rust's `f32::round`). */
export function roundHalfAway(x: number): number {
  const r = Math.sign(x) * Math.floor(Math.abs(x) + 0.5);
  return r === 0 ? 0 : r; // never -0
}

/** The table the settings call for: the reader's own when set, else the standard one at this quality. 0 = luma, else chroma. */
export function tableFor(ctx: ExplainContext, component: number): number[] {
  const slot = component === 0 ? 0 : 1;
  if (ctx.customTables) return ctx.customTables[slot];
  return scaleTable(slot === 0 ? STD_LUMA : STD_CHROMA, ctx.quality);
}

/**
 * The step an entry would have at quality `to`, given the step the encoder used
 * (`step`) at quality `from`. A standard table is re-scaled exactly; a custom
 * one (or any table that isn't the standard one at `from`) is scaled in proportion.
 */
export function stepAtQuality(
  component: number,
  index: number,
  step: number,
  from: number,
  to: number,
): number {
  const base = component === 0 ? STD_LUMA : STD_CHROMA;
  if (scaleTable(base, from)[index] === step) return scaleTable(base, to)[index];
  const estimate = (step * 100) / scaleFactor(from);
  return Math.min(255, Math.max(1, Math.floor((estimate * scaleFactor(to) + 50) / 100)));
}
