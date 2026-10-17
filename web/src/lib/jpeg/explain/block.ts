// The selected block as the explainers read it, and the little maths they share
// (rounding a pattern, rebuilding the block, how much detail it holds).
import type { SelectedBlock } from '../summary';
import type { ExplainContext } from './context';
import { roundHalfAway, ZIGZAG } from './quality';

/** The block with the numbers the encoder really used. */
export interface BlockView {
  sel: SelectedBlock;
  /** The quality the encode in hand was made at (the page's slider until the first summary says otherwise). */
  quality: number;
  /** Whether the reader's own tables are in force, so quality is not what sets the steps. */
  custom: boolean;
}

/** The selected block, or null when there is no summary, no selected block, or a malformed one. */
export function blockOf(ctx: ExplainContext): BlockView | null {
  const sel = ctx.summary?.selected;
  if (!sel || sel.dct.length !== 64 || sel.table.length !== 64) return null;
  return { sel, quality: ctx.summary?.quality ?? ctx.quality, custom: ctx.customTables !== null };
}

/** The 8 × 8 index of pattern `(u, v)`: u across, v down. */
export const at = (u: number, v: number): number => u + 8 * v;

/** Whether `(u, v)` names a pattern of the 8 × 8 block. */
export function validPattern(u: number, v: number): boolean {
  return Number.isInteger(u) && Number.isInteger(v) && u >= 0 && u < 8 && v >= 0 && v < 8;
}

/** What pattern `i` was stored as: the encoder's own rounded value when the summary has it, else `round(F / Q)`, halves away from zero. */
export function quantized(b: BlockView, i: number): number {
  if (b.sel.quant.length === 64) return b.sel.quant[i];
  return roundHalfAway(b.sel.dct[i] / b.sel.table[i]);
}

/** What the plane holds, in plain words: "brightness" for Y, "colour" for Cb and Cr. */
export function planeWord(component: number): string {
  return component === 0 ? 'brightness' : 'colour';
}

/** What the flat pattern's amount means for this plane: the block's average brightness, blue tint or red tint. */
export function averageWord(component: number): string {
  return component === 0 ? 'average brightness' : component === 1 ? 'average blue tint' : 'average red tint';
}

/** The plain-words reading of a plane's average sample (0-255), with which way is more or less. */
export function averageMeaning(component: number, mean: number): string {
  if (component === 0) return `The block's average brightness: about ${mean} on the 0-255 scale. Higher means a lighter block.`;
  const [name, up, down] = component === 1 ? ['blue', 'bluer', 'yellower'] : ['red', 'redder', 'greener'];
  return `The block's average ${name} tint: about ${mean} on the 0-255 scale, where 128 is neutral. Higher is ${up}, lower is ${down}.`;
}

/** How many of the 64 patterns survive rounding (are not zero afterwards). */
export function survivors(b: BlockView, among: readonly number[] = ZIGZAG): number {
  return among.filter((i) => quantized(b, i) !== 0).length;
}

/** The share of the block's detail (its energy, the sum of squares) held by pattern `i`. */
export function shareOf(dct: readonly number[], i: number): number {
  const total = dct.reduce((s, c) => s + c * c, 0);
  return total > 0 ? (dct[i] * dct[i]) / total : 0;
}

const C = (n: number) => (n === 0 ? Math.SQRT1_2 : 1);
const COS = Array.from({ length: 8 }, (_, n) =>
  Array.from({ length: 8 }, (_, x) => Math.cos(((2 * x + 1) * n * Math.PI) / 16)),
);

/** The inverse 8 × 8 DCT of row-major coefficients (u across, v down): the samples they add up to. */
export function idct8(coeffs: readonly number[]): number[] {
  const out = new Array<number>(64).fill(0);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      let s = 0;
      for (let v = 0; v < 8; v++) {
        for (let u = 0; u < 8; u++) {
          const c = coeffs[at(u, v)];
          if (c !== 0) s += C(u) * C(v) * c * COS[u][x] * COS[v][y];
        }
      }
      out[at(x, y)] = s / 4;
    }
  }
  return out;
}

/** The block as the decoder rebuilds it: round, multiply back, inverse DCT, shift by +128, clamp to 0-255. */
export function rebuilt(b: BlockView): number[] {
  const coeffs = b.sel.dct.map((_, i) => quantized(b, i) * b.sel.table[i]);
  return idct8(coeffs).map((v) => Math.min(255, Math.max(0, roundHalfAway(v + 128))));
}
