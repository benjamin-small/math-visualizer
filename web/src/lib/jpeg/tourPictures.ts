// The tour's picture maths: split a picture into brightness and colour, share colour over
// squares, find a busy tile and crop the tiles around it, take one tile through the 8 × 8 wave
// transform and rounding, and count its zeros. Pure functions on pixels; the dialog does the drawing.
import { rgbToYcbcr } from './explain/bezel';
import { roundHalfAway, scaleTable, STD_LUMA, ZIGZAG } from './explain/quality';
import type { RgbaImage } from './images';

const clamp255 = (v: number) => Math.min(255, Math.max(0, Math.round(v)));

/** BT.601 full-range YCbCr back to RGB, rounded and clamped to 0-255 (the inverse of `rgbToYcbcr`). */
export function ycbcrToRgb(y: number, cb: number, cr: number): [number, number, number] {
  return [
    clamp255(y + 1.402 * (cr - 128)),
    clamp255(y - 0.344136 * (cb - 128) - 0.714136 * (cr - 128)),
    clamp255(y + 1.772 * (cb - 128)),
  ];
}

/** A new picture from `f(x, y)`, which gives a pixel's RGB. */
function build(img: RgbaImage, f: (x: number, y: number) => [number, number, number]): RgbaImage {
  const rgba = new Uint8Array(img.w * img.h * 4);
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const [r, g, b] = f(x, y);
      rgba.set([r, g, b, 255], (y * img.w + x) * 4);
    }
  }
  return { w: img.w, h: img.h, rgba };
}

/** Pixel `(x, y)` as unrounded YCbCr. */
function ycc(img: RgbaImage, x: number, y: number): [number, number, number] {
  const i = (y * img.w + x) * 4;
  return rgbToYcbcr(img.rgba[i], img.rgba[i + 1], img.rgba[i + 2]);
}

/** The picture's brightness alone: grey, from Y. */
export function brightnessImage(img: RgbaImage): RgbaImage {
  return build(img, (x, y) => {
    const g = clamp255(ycc(img, x, y)[0]);
    return [g, g, g];
  });
}

/** The picture's colour alone: each pixel's Cb and Cr with Y set to 128. A colour too vivid to show at that brightness is faded toward grey just enough to fit, so the brightness stays 128. */
export function colourImage(img: RgbaImage): RgbaImage {
  return build(img, (x, y) => {
    const [, cb, cr] = ycc(img, x, y);
    // Each channel is 128 + k·(cb or cr − 128); find the largest fade t in 0-1 that keeps all three in 0-255.
    const dr = 1.402 * (cr - 128);
    const dg = -0.344136 * (cb - 128) - 0.714136 * (cr - 128);
    const db = 1.772 * (cb - 128);
    let t = 1;
    for (const d of [dr, dg, db]) {
      if (d > 127) t = Math.min(t, 127 / d);
      else if (d < -128) t = Math.min(t, -128 / d);
    }
    return ycbcrToRgb(128, 128 + t * (cb - 128), 128 + t * (cr - 128));
  });
}

/** Keep every pixel's Y but average Cb and Cr over each `size × size` square (edge squares average what they cover). */
export function shareColour(img: RgbaImage, size: number): RgbaImage {
  const s = Math.max(1, Math.trunc(size));
  const sw = Math.ceil(img.w / s);
  const sh = Math.ceil(img.h / s);
  const cb = new Float64Array(sw * sh);
  const cr = new Float64Array(sw * sh);
  const n = new Float64Array(sw * sh);
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const k = Math.floor(y / s) * sw + Math.floor(x / s);
      const p = ycc(img, x, y);
      cb[k] += p[1];
      cr[k] += p[2];
      n[k] += 1;
    }
  }
  return build(img, (x, y) => {
    const k = Math.floor(y / s) * sw + Math.floor(x / s);
    return ycbcrToRgb(ycc(img, x, y)[0], cb[k] / n[k], cr[k] / n[k]);
  });
}

/** The tile column and row whose Y values vary most (edge tiles count the pixels they cover; ties go to the first, row-major). */
export function busiestTile(img: RgbaImage): [number, number] {
  let best: [number, number] = [0, 0];
  let bestVar = -1;
  for (let by = 0; by < Math.ceil(img.h / 8); by++) {
    for (let bx = 0; bx < Math.ceil(img.w / 8); bx++) {
      const ys: number[] = [];
      for (let y = by * 8; y < Math.min(img.h, by * 8 + 8); y++) {
        for (let x = bx * 8; x < Math.min(img.w, bx * 8 + 8); x++) ys.push(ycc(img, x, y)[0]);
      }
      // Two passes (mean, then squared deviations) so a flat tile is exactly 0 whatever its size.
      const mean = ys.reduce((a, v) => a + v, 0) / (ys.length || 1);
      const variance = ys.reduce((a, v) => a + (v - mean) ** 2, 0) / (ys.length || 1);
      if (variance > bestVar + 1e-9) {
        bestVar = variance;
        best = [bx, by];
      }
    }
  }
  return best;
}

/** A rectangle of pixels in a picture. */
export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One axis of `tileCrop`: where the window starts and how long it is. */
function cropSpan(size: number, tile: number, count: number): [number, number] {
  const n = Math.max(1, Math.trunc(count));
  const tiles = Math.ceil(size / 8);
  const start = (tile - Math.floor(n / 2)) * 8;
  const at = Math.min(Math.max(0, start), Math.max(0, (tiles - n) * 8));
  return [at, Math.min(n * 8, size - at)];
}

/**
 * A window `cols` tiles wide and `rows` tiles tall, centred on tile `(bx, by)` as far as the picture
 * allows. It starts on the tile grid, stays inside the picture (so it can be smaller at an edge, or
 * the whole of a picture smaller than the window), and always holds the tile.
 */
export function tileCrop(img: { w: number; h: number }, bx: number, by: number, cols: number, rows: number): Crop {
  const [x, w] = cropSpan(img.w, bx, cols);
  const [y, h] = cropSpan(img.h, by, rows);
  return { x, y, w, h };
}

/** The pixels of `c`, which must lie inside `img`, as a picture of their own. */
export function cropImage(img: RgbaImage, c: Crop): RgbaImage {
  const rgba = new Uint8Array(c.w * c.h * 4);
  for (let j = 0; j < c.h; j++) {
    const from = ((c.y + j) * img.w + c.x) * 4;
    rgba.set(img.rgba.subarray(from, from + c.w * 4), j * c.w * 4);
  }
  return { w: c.w, h: c.h, rgba };
}

/** The 64 Y values of tile `(bx, by)`, row-major; reads past the picture's edge repeat its last row or column. */
export function tileLuma(img: RgbaImage, bx: number, by: number): number[] {
  const out: number[] = [];
  for (let j = 0; j < 8; j++) {
    const y = Math.min(img.h - 1, by * 8 + j);
    for (let i = 0; i < 8; i++) {
      const x = Math.min(img.w - 1, bx * 8 + i);
      out.push(ycc(img, x, y)[0]);
    }
  }
  return out;
}

const C = (n: number) => (n === 0 ? Math.SQRT1_2 : 1);
const COS = Array.from({ length: 8 }, (_, n) =>
  Array.from({ length: 8 }, (_, x) => Math.cos(((2 * x + 1) * n * Math.PI) / 16)),
);

/** The forward 8 × 8 DCT of row-major samples (JPEG's orthonormal scaling): `idct8(fdct8(x))` gives `x` back. */
export function fdct8(shifted: readonly number[]): number[] {
  const out = new Array<number>(64).fill(0);
  for (let v = 0; v < 8; v++) {
    for (let u = 0; u < 8; u++) {
      let s = 0;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) s += shifted[x + 8 * y] * COS[u][x] * COS[v][y];
      }
      out[u + 8 * v] = (C(u) * C(v) * s) / 4;
    }
  }
  return out;
}

/** Tile `(bx, by)` transformed and rounded at `quality` with the standard brightness steps, as 64 whole numbers in zigzag order. */
export function tileNumbers(img: RgbaImage, bx: number, by: number, quality: number): number[] {
  const coeffs = fdct8(tileLuma(img, bx, by).map((v) => v - 128));
  const steps = scaleTable(STD_LUMA, quality);
  return ZIGZAG.map((i) => roundHalfAway(coeffs[i] / steps[i]));
}

/** The `n` patterns with the largest amounts (by size, ignoring sign), leaving out the average at (0, 0). `coeffs` is row-major. */
export function strongestPatterns(coeffs: readonly number[], n: number): { u: number; v: number; amount: number }[] {
  return coeffs
    .map((amount, i) => ({ u: i % 8, v: Math.floor(i / 8), amount, i }))
    .filter((p) => p.i !== 0)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount) || a.i - b.i)
    .slice(0, Math.max(0, n))
    .map(({ u, v, amount }) => ({ u, v, amount }));
}

/** A run of zeros followed by the number that ended it. */
export interface ZeroRun {
  /** How many zeros came first. */
  zeros: number;
  /** The non-zero number after them. */
  value: number;
}

/** Zigzag numbers as the first one, then (zeros, number) pairs up to the last non-zero; `end` says whether zeros follow it. */
export function countZeros(zigzag: readonly number[]): { first: number; runs: ZeroRun[]; end: boolean } {
  let last = 0;
  for (let i = 1; i < zigzag.length; i++) if (zigzag[i] !== 0) last = i;
  const runs: ZeroRun[] = [];
  let zeros = 0;
  for (let i = 1; i <= last; i++) {
    if (zigzag[i] === 0) zeros++;
    else {
      runs.push({ zeros, value: zigzag[i] });
      zeros = 0;
    }
  }
  return { first: zigzag[0], runs, end: last < zigzag.length - 1 };
}
