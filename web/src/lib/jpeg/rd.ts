// The rate–distortion curve: file size against quality (PSNR) as the quality
// setting sweeps 1–100. Each point is a full encode + decode through the Rust
// kit, so the sweep runs a few points per animation frame and the result is
// cached per picture and settings.

/** One encode: its size and how close the decoded copy is (Infinity for a perfect one). */
export interface RdPoint {
  quality: number;
  bytes: number;
  psnr: number;
}

/** The qualities the curve samples: every one from 1 to 100. */
export const RD_QUALITIES: readonly number[] = Array.from({ length: 100 }, (_, i) => i + 1);

/** The most points computed in one animation frame. */
export const RD_PER_FRAME = 4;

/** A frame stops starting new encodes once this many milliseconds have gone, so a large picture never holds a frame for long. */
export const RD_FRAME_BUDGET_MS = 8;

/** PSNR values above this are drawn at the top of the chart. */
export const RD_PSNR_CAP = 60;

const cache = new Map<string, RdPoint[]>();

/** The cache key for a picture (by identity tag) and the settings that change the curve. */
export function rdKey(imageTag: string, subsampling: string, huffman: string): string {
  return `${imageTag}|${subsampling}|${huffman}`;
}

/** Whatever has been computed for `key` so far (possibly a partial curve). */
export function cachedCurve(key: string): RdPoint[] {
  return cache.get(key) ?? [];
}

/** Record a point for `key`, keeping the curve sorted by quality. */
export function addPoint(key: string, p: RdPoint) {
  const pts = cache.get(key) ?? [];
  if (!pts.some((q) => q.quality === p.quality)) {
    pts.push(p);
    pts.sort((a, b) => a.quality - b.quality);
  }
  cache.set(key, pts);
}

/** The qualities still missing from `key`'s curve. */
export function missing(key: string): number[] {
  const have = new Set(cachedCurve(key).map((p) => p.quality));
  return RD_QUALITIES.filter((q) => !have.has(q));
}

/**
 * Run one frame's share of the sweep: `encode` each of `todo` in turn, at least
 * one and at most `RD_PER_FRAME`, and stop starting new ones once
 * `RD_FRAME_BUDGET_MS` has passed on `now`. Returns how many ran.
 */
export function sweepFrame(
  todo: readonly number[],
  encode: (quality: number) => void,
  now: () => number = () => performance.now(),
): number {
  const start = now();
  let done = 0;
  while (done < todo.length && done < RD_PER_FRAME) {
    encode(todo[done]);
    done++;
    if (now() - start >= RD_FRAME_BUDGET_MS) break;
  }
  return done;
}

/** Forget every curve (tests). */
export function clearCurves() {
  cache.clear();
}

/** SVG polyline points for `pts` in a `w × h` box: x = bytes (0 to the largest), y = PSNR (0 to `RD_PSNR_CAP`). */
export function rdPolyline(pts: readonly RdPoint[], w: number, h: number, maxBytes: number): string {
  return pts
    .map((p) => {
      const x = maxBytes > 0 ? (p.bytes / maxBytes) * w : 0;
      const y = h - (Math.min(p.psnr, RD_PSNR_CAP) / RD_PSNR_CAP) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}
