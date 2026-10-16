import { describe, expect, it } from 'vitest';
import { entropyBits, histogram, neighbourDiffs, rgbSamples } from '../bytes';

describe('byte statistics', () => {
  it('drops alpha', () => {
    expect([...rgbSamples(new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]))]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('takes neighbour differences per channel, wrapping mod 256', () => {
    // 3×2 image; row 0: (10,20,30) (12,20,25) (12,250,25); row 1: (0,0,0) (255,1,1) (0,0,0)
    // prettier-ignore
    const rgba = new Uint8Array([
      10, 20, 30, 255, 12, 20, 25, 255, 12, 250, 25, 255,
      0, 0, 0, 255, 255, 1, 1, 255, 0, 0, 0, 255,
    ]);
    const d = neighbourDiffs(rgba, 3, 2);
    expect(d.length).toBe(3 * 2 * 3);
    expect([...d]).toEqual([10, 20, 30, 2, 0, 251, 0, 230, 0, 0, 0, 0, 255, 1, 1, 1, 255, 255]);
  });

  it('counts bytes', () => {
    const h = histogram(new Uint8Array([0, 0, 7]));
    expect(h.length).toBe(256);
    expect(h[0]).toBe(2);
    expect(h[7]).toBe(1);
  });

  it('measures entropy', () => {
    expect(entropyBits(histogram(new Uint8Array(64).fill(9)))).toBe(0);
    expect(entropyBits(histogram(new Uint8Array([0, 1, 0, 1])))).toBeCloseTo(1);
    expect(entropyBits(histogram(Uint8Array.from({ length: 256 }, (_, i) => i)))).toBeCloseTo(8);
    expect(entropyBits(new Uint32Array(256))).toBe(0);
  });
});
