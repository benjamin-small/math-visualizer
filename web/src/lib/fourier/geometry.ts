/**
 * Pure geometry for the Fourier lab's text → path pipeline. No font dependency.
 *
 * A font outline is many disconnected contours (letters, the holes in p/o/e, the dot on i),
 * but the DFT needs ONE closed loop. So contours are concatenated with straight *travel*
 * segments, and each sample carries `pen`: "draw the segment from this sample to the next
 * (wrapping N-1 → 0)". Travel samples are `pen: false` — the epicycles still move through
 * them, but no ink is drawn.
 */

export type Vec2 = { x: number; y: number };
export type PathPoint = { x: number; y: number; pen: boolean };

/** Minimal subset of opentype.js's Path.commands we consume. */
export type PathCommand =
  | { type: 'M' | 'L'; x: number; y: number }
  | { type: 'Q'; x1: number; y1: number; x: number; y: number }
  | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: 'Z' };

/** A loop vertex tagged with the contour it came from; `-1` marks the start of a travel hop. */
export type LoopVertex = { x: number; y: number; seg: number };

/** Tag for vertices/segments that are travel hops rather than glyph outline. */
export const TRAVEL = -1;

const EPS = 1e-9;

function near(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) <= EPS && Math.abs(a.y - b.y) <= EPS;
}

function dist2(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/**
 * Split commands into contours at `M`; flatten `Q`/`C` with `steps` fixed subdivisions; when a
 * contour ends (`Z`, the next `M`, or end of input) append its first point if the last point isn't
 * already (within 1e-9) equal to it, so every contour is explicitly closed. Contours with fewer
 * than 3 points (before closing) are dropped.
 *
 * Glyph contours are always closed outlines, but opentype.js 2.x omits the `Z` command from fill
 * paths, so closing on `Z` alone is not enough.
 */
export function flattenCommands(cmds: PathCommand[], steps = 16): Vec2[][] {
  const out: Vec2[][] = [];
  let cur: Vec2[] = [];
  const n = Math.max(1, Math.floor(steps));

  const endContour = () => {
    if (cur.length >= 3) {
      if (!near(cur[0], cur[cur.length - 1])) cur.push({ x: cur[0].x, y: cur[0].y });
      out.push(cur);
    }
    cur = [];
  };

  for (const cmd of cmds) {
    switch (cmd.type) {
      case 'M':
        endContour();
        cur.push({ x: cmd.x, y: cmd.y });
        break;
      case 'L':
        cur.push({ x: cmd.x, y: cmd.y });
        break;
      case 'Q': {
        const p0 = cur[cur.length - 1];
        if (!p0) {
          cur.push({ x: cmd.x, y: cmd.y });
          break;
        }
        for (let i = 1; i <= n; i++) {
          const t = i / n;
          const u = 1 - t;
          const a = u * u;
          const b = 2 * u * t;
          const c = t * t;
          cur.push({ x: a * p0.x + b * cmd.x1 + c * cmd.x, y: a * p0.y + b * cmd.y1 + c * cmd.y });
        }
        break;
      }
      case 'C': {
        const p0 = cur[cur.length - 1];
        if (!p0) {
          cur.push({ x: cmd.x, y: cmd.y });
          break;
        }
        for (let i = 1; i <= n; i++) {
          const t = i / n;
          const u = 1 - t;
          const a = u * u * u;
          const b = 3 * u * u * t;
          const c = 3 * u * t * t;
          const d = t * t * t;
          cur.push({
            x: a * p0.x + b * cmd.x1 + c * cmd.x2 + d * cmd.x,
            y: a * p0.y + b * cmd.y1 + c * cmd.y2 + d * cmd.y,
          });
        }
        break;
      }
      case 'Z':
        endContour();
        break;
    }
  }
  endContour();
  return out;
}

/**
 * Rotate a closed contour so it starts at the vertex nearest `prev` (short travel).
 * Identity when `prev` is undefined.
 *
 * An explicitly closed contour (last point equal to the first, as produced by
 * {@link flattenCommands}) stays explicitly closed: the duplicate is stripped before rotating
 * and the new first vertex is re-appended, so every edge of the outline survives.
 */
export function rotateToNearest(contour: Vec2[], prev?: Vec2): Vec2[] {
  if (!prev || contour.length < 2) return contour.slice();

  const closed = near(contour[0], contour[contour.length - 1]);
  const cycle = closed ? contour.slice(0, -1) : contour;

  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < cycle.length; i++) {
    const d = dist2(cycle[i], prev);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }

  const rotated = cycle.slice(best).concat(cycle.slice(0, best));
  if (closed) rotated.push({ x: rotated[0].x, y: rotated[0].y });
  return rotated;
}

/**
 * Concatenate contours into one closed loop. Vertices carry `seg` = contour index; the vertex
 * that *starts* a straight travel hop is tagged {@link TRAVEL} (`-1`).
 *
 * Layout: `[...contour0, hop, ...contour1 (rotated toward contour0's end), hop, ..., closingHop]`,
 * where each `hop` duplicates the previous contour's last vertex with `seg: -1`. The segment from
 * that duplicate to the next contour's first vertex is the travel; the final duplicate makes the
 * closing segment back to vertex 0 a travel hop too.
 */
export function buildLoop(contours: Vec2[][]): LoopVertex[] {
  const out: LoopVertex[] = [];
  let prev: Vec2 | undefined;

  contours.forEach((contour, idx) => {
    if (contour.length === 0) return;
    if (prev) out.push({ x: prev.x, y: prev.y, seg: TRAVEL });
    const rotated = rotateToNearest(contour, prev);
    for (const p of rotated) out.push({ x: p.x, y: p.y, seg: idx });
    prev = rotated[rotated.length - 1];
  });

  if (prev) out.push({ x: prev.x, y: prev.y, seg: TRAVEL });
  return out;
}

/**
 * Resample the closed polyline (last → first is a segment) to exactly `n` points spaced uniformly
 * by arc length, starting at vertex 0. Each sample inherits the tag of the source segment it lies
 * on — a segment is a contour segment only when both of its end vertices carry the same non-travel
 * tag; otherwise it is a travel segment. Then `pen[k] = tag[k] !== -1 && tag[k] === tag[(k+1) % n]`,
 * i.e. "draw k → k+1". Deriving pen per *segment* guarantees no ink across a travel hop regardless
 * of sample density.
 *
 * Degenerate input (< 2 vertices, zero total length, or n <= 0) → `[]`.
 */
export function resampleClosed(verts: LoopVertex[], n: number): PathPoint[] {
  const count = verts.length;
  if (count < 2 || !(n > 0)) return [];

  // Cumulative arc length over the N vertices plus the closing segment.
  const cum = new Float64Array(count + 1);
  for (let i = 0; i < count; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % count];
    cum[i + 1] = cum[i] + Math.hypot(b.x - a.x, b.y - a.y);
  }
  const total = cum[count];
  if (!(total > 0) || !Number.isFinite(total)) return [];

  const samples = Math.floor(n);
  const xs = new Float64Array(samples);
  const ys = new Float64Array(samples);
  const tags = new Int32Array(samples);

  let i = 0; // running segment pointer — target lengths are monotone
  for (let k = 0; k < samples; k++) {
    const s = (k * total) / samples;
    // Advance past segments that end at or before s (this also skips zero-length segments).
    while (i < count - 1 && cum[i + 1] <= s) i++;
    const a = verts[i];
    const b = verts[(i + 1) % count];
    const len = cum[i + 1] - cum[i];
    const t = len > 0 ? (s - cum[i]) / len : 0;
    xs[k] = a.x + (b.x - a.x) * t;
    ys[k] = a.y + (b.y - a.y) * t;
    tags[k] = a.seg === b.seg ? a.seg : TRAVEL;
  }

  const out: PathPoint[] = new Array(samples);
  for (let k = 0; k < samples; k++) {
    const tag = tags[k];
    const next = tags[(k + 1) % samples];
    out[k] = { x: xs[k], y: ys[k], pen: tag !== TRAVEL && tag === next };
  }
  return out;
}

/**
 * Flip y (font paths are y-down; the math is y-up), translate the bbox center to the origin, and
 * scale so `max(width, height) / 2 === 1`. Empty input → `[]`.
 */
export function normalize(points: PathPoint[]): PathPoint[] {
  if (points.length === 0) return [];

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const half = Math.max(maxX - minX, maxY - minY) / 2;
  const scale = half > 0 ? 1 / half : 1;

  return points.map((p) => ({ x: (p.x - cx) * scale, y: -(p.y - cy) * scale, pen: p.pen }));
}
