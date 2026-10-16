// Small pure helpers behind the DCT stage's charts. The transforms themselves
// come from the Rust kit; these only summarise their output.

/**
 * Running share of a block's energy (sum of squared coefficients) captured
 * by the first 1, 2, … 64 coefficients in `order` (the zigzag order). Ends
 * at 1; all zeros for an all-zero block.
 */
export function cumulativeEnergy(coeffs: readonly number[], order: readonly number[]): number[] {
  const total = coeffs.reduce((s, c) => s + c * c, 0);
  let acc = 0;
  return order.map((i) => {
    acc += coeffs[i] * coeffs[i];
    return total > 0 ? acc / total : 0;
  });
}

/** How many of the largest terms (by energy) reach `frac` of the total; 0 when there is no energy. */
export function termsFor(energies: readonly number[], frac: number): number {
  const total = energies.reduce((s, e) => s + e, 0);
  if (!(total > 0)) return 0;
  const sorted = [...energies].sort((a, b) => b - a);
  let acc = 0;
  for (let i = 0; i < sorted.length; i++) {
    acc += sorted[i];
    if (acc >= frac * total - 1e-9) return i + 1;
  }
  return sorted.length;
}

/** `x`, reversed `x`, `x`, … (`reps` copies): what the DCT assumes lies beyond the block. */
export function mirrored(x: readonly number[], reps: number): number[] {
  const out: number[] = [];
  for (let r = 0; r < reps; r++) out.push(...(r % 2 === 0 ? x : [...x].reverse()));
  return out;
}

/** `x` repeated `reps` times: what the DFT assumes. */
export function periodic(x: readonly number[], reps: number): number[] {
  const out: number[] = [];
  for (let r = 0; r < reps; r++) out.push(...x);
  return out;
}

/**
 * The row or column of a row-major 8 × 8 block with the most variation — the
 * most telling line for "why cosines?" — as `{ axis, index, values }`.
 */
export function busiestLine(block: readonly number[]): { axis: 'row' | 'column'; index: number; values: number[] } {
  let best = { axis: 'row' as 'row' | 'column', index: 0, values: block.slice(0, 8) };
  let bestSpread = -1;
  for (const axis of ['row', 'column'] as const) {
    for (let i = 0; i < 8; i++) {
      const values = Array.from({ length: 8 }, (_, j) => (axis === 'row' ? block[8 * i + j] : block[i + 8 * j]));
      const spread = Math.max(...values) - Math.min(...values) + Math.abs(values[7] - values[0]);
      if (spread > bestSpread) {
        bestSpread = spread;
        best = { axis, index: i, values };
      }
    }
  }
  return best;
}

/**
 * PSNR in dB between two same-size RGBA buffers over R, G and B (alpha
 * ignored): Infinity when identical, NaN when the sizes differ.
 */
export function psnrOf(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length || a.length % 4 !== 0) return NaN;
  let sum = 0;
  for (let i = 0; i < a.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d = a[i + c] - b[i + c];
      sum += d * d;
    }
  }
  const mse = sum / ((a.length / 4) * 3);
  return mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse);
}
