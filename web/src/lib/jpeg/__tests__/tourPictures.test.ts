import { describe, expect, it } from 'vitest';
import type { RgbaImage } from '../images';
import { idct8 } from '../explain/block';
import { rgbToYcbcr } from '../explain/bezel';
import {
  brightnessImage,
  busiestTile,
  colourImage,
  countZeros,
  fdct8,
  shareColour,
  strongestPatterns,
  tileLuma,
  tileNumbers,
  ycbcrToRgb,
} from '../tourPictures';

function img(w: number, h: number, f: (x: number, y: number) => [number, number, number]): RgbaImage {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = f(x, y);
      rgba.set([r, g, b, 255], (y * w + x) * 4);
    }
  }
  return { w, h, rgba };
}

describe('tour picture maths', () => {
  it('splits brightness from colour and back', () => {
    const p = img(2, 1, (x) => (x ? [200, 40, 40] : [30, 90, 220]));
    const b = brightnessImage(p);
    expect(b.rgba[0]).toBe(b.rgba[1]);
    expect(b.rgba[1]).toBe(b.rgba[2]); // grey
    expect(ycbcrToRgb(...rgbToYcbcr(200, 40, 40))).toEqual([200, 40, 40]);
    const c = colourImage(p);
    expect(Math.round(rgbToYcbcr(c.rgba[0], c.rgba[1], c.rgba[2])[0])).toBe(128);
  });

  it('clamps and rounds when going back to RGB', () => {
    expect(ycbcrToRgb(300, 128, 128)).toEqual([255, 255, 255]);
    expect(ycbcrToRgb(-20, 128, 128)).toEqual([0, 0, 0]);
  });

  it('shares colour over squares and keeps brightness', () => {
    const p = img(4, 4, (x, y) => ((x + y) % 2 ? [200, 60, 60] : [60, 60, 200]));
    const s = shareColour(p, 2);
    const cb = (i: number) => rgbToYcbcr(s.rgba[i], s.rgba[i + 1], s.rgba[i + 2])[1];
    expect(Math.abs(cb(0) - cb(4))).toBeLessThan(1.5); // same square, same colour
    expect(Math.abs(brightnessImage(s).rgba[0] - brightnessImage(p).rgba[0])).toBeLessThanOrEqual(2);
  });

  it('averages the squares at the edge over what they cover', () => {
    const p = img(3, 1, (x) => (x === 2 ? [255, 0, 0] : [0, 0, 255]));
    const s = shareColour(p, 2);
    expect(s.w).toBe(3);
    expect(s.h).toBe(1);
    const cb = (x: number) => rgbToYcbcr(s.rgba[x * 4], s.rgba[x * 4 + 1], s.rgba[x * 4 + 2])[1];
    expect(Math.abs(cb(0) - cb(1))).toBeLessThan(1.5);
    // the lone edge pixel keeps its own colour (red has low Cb)
    expect(cb(2)).toBeLessThan(cb(0) - 50);
  });

  it('finds the busiest tile', () => {
    const p = img(16, 8, (x) => (x >= 8 ? (x % 2 ? [255, 255, 255] : [0, 0, 0]) : [100, 100, 100]));
    expect(busiestTile(p)).toEqual([1, 0]);
  });

  it('gives the first tile when several tie', () => {
    expect(busiestTile(img(16, 16, () => [9, 9, 9]))).toEqual([0, 0]);
  });

  it('handles a picture smaller than a tile', () => {
    const p = img(5, 3, (x, y) => [x * 40, y * 60, 0]);
    expect(busiestTile(p)).toEqual([0, 0]);
    const t = tileLuma(p, 0, 0);
    expect(t).toHaveLength(64);
    expect(t.every(Number.isFinite)).toBe(true);
    expect(t[7]).toBe(t[4]); // column 4 repeats past the edge
    expect(tileNumbers(p, 0, 0, 50).every(Number.isInteger)).toBe(true);
  });

  it('transforms a tile and back', () => {
    const x = Array.from({ length: 64 }, (_, i) => ((i * 37) % 255) - 128);
    idct8(fdct8(x)).forEach((v, i) => expect(v).toBeCloseTo(x[i], 3));
    expect(fdct8(Array(64).fill(16))[0]).toBeCloseTo(128, 3); // flat tile: all DC (8 × 16)
  });

  it('rounds a flat tile to its average only', () => {
    const p = img(8, 8, () => [128, 128, 128]);
    expect(tileNumbers(p, 0, 0, 50).every((v) => v === 0)).toBe(true);
  });

  it('returns tile numbers in zigzag order', () => {
    // Left half dark, right half light: a strong (1, 0) pattern, which is zigzag position 1.
    const p = img(8, 8, (x) => (x < 4 ? [0, 0, 0] : [255, 255, 255]));
    const n = tileNumbers(p, 0, 0, 90);
    expect(n).toHaveLength(64);
    expect(n[1]).not.toBe(0);
    expect(n[2]).toBe(0); // (0, 1): no change down the tile
  });

  it('names the strongest patterns', () => {
    const c = Array(64).fill(0);
    c[0] = 500;
    c[1] = -40;
    c[8] = 25;
    c[9] = 3;
    expect(strongestPatterns(c, 2)).toEqual([
      { u: 1, v: 0, amount: -40 },
      { u: 0, v: 1, amount: 25 },
    ]);
  });

  it('counts the zeros', () => {
    const z = [12, 0, 0, 3, -1, 0, 0, 0, 0, 2, ...Array(54).fill(0)];
    expect(countZeros(z)).toEqual({
      first: 12,
      runs: [
        { zeros: 2, value: 3 },
        { zeros: 0, value: -1 },
        { zeros: 4, value: 2 },
      ],
      end: true,
    });
    expect(countZeros([5, ...Array(63).fill(0)])).toEqual({ first: 5, runs: [], end: true });
    expect(countZeros(Array.from({ length: 64 }, () => 1)).end).toBe(false);
  });
});
