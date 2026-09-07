import { describe, expect, it } from 'vitest';
import {
  buildLoop,
  flattenCommands,
  normalize,
  resampleClosed,
  rotateToNearest,
  type PathCommand,
  type PathPoint,
  type Vec2,
} from '../geometry';

// --- helpers -------------------------------------------------------------

const M = (x: number, y: number): PathCommand => ({ type: 'M', x, y });
const L = (x: number, y: number): PathCommand => ({ type: 'L', x, y });
const Q = (x1: number, y1: number, x: number, y: number): PathCommand => ({ type: 'Q', x1, y1, x, y });
const C = (x1: number, y1: number, x2: number, y2: number, x: number, y: number): PathCommand => ({
  type: 'C',
  x1,
  y1,
  x2,
  y2,
  x,
  y,
});
const Z: PathCommand = { type: 'Z' };

/** Axis-aligned unit square with its lower-left corner at (ox, oy), counter-clockwise, no closing duplicate. */
const square = (ox: number, oy: number): Vec2[] => [
  { x: ox, y: oy },
  { x: ox + 1, y: oy },
  { x: ox + 1, y: oy + 1 },
  { x: ox, y: oy + 1 },
];

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

const EPS = 1e-9;

/** True when `p` lies on the outline of the unit square at (ox, oy). */
function onSquare(p: Vec2, ox: number, oy: number): boolean {
  const inside = p.x >= ox - EPS && p.x <= ox + 1 + EPS && p.y >= oy - EPS && p.y <= oy + 1 + EPS;
  if (!inside) return false;
  return (
    Math.abs(p.x - ox) < EPS ||
    Math.abs(p.x - ox - 1) < EPS ||
    Math.abs(p.y - oy) < EPS ||
    Math.abs(p.y - oy - 1) < EPS
  );
}

/** Number of contiguous `pen === false` runs in a closed sample loop (a run that wraps N-1 → 0 counts once). */
function penUpRuns(pts: PathPoint[]): number {
  const n = pts.length;
  if (n === 0) return 0;
  let runs = 0;
  for (let k = 0; k < n; k++) {
    const prev = pts[(k - 1 + n) % n];
    if (!pts[k].pen && prev.pen) runs++;
  }
  // No true→false transition at all: either all pen-down (0 runs) or all pen-up (1 run).
  if (runs === 0 && !pts[0].pen) return 1;
  return runs;
}

const cubicAt = (p0: number, p1: number, p2: number, p3: number, t: number) => {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
};

// --- flattenCommands -------------------------------------------------------

describe('flattenCommands', () => {
  it('flattens M/Q/Z into one explicitly closed contour', () => {
    const steps = 16;
    const contours = flattenCommands([M(0, 0), Q(1, 1, 2, 0), Z], steps);
    expect(contours).toHaveLength(1);
    const c = contours[0];

    // M point + `steps` subdivisions + the closing point (last != first before Z).
    expect(c).toHaveLength(1 + steps + 1);
    expect(c[0]).toEqual({ x: 0, y: 0 });
    expect(c[steps]).toEqual({ x: 2, y: 0 }); // t = 1 lands exactly on the end point
    expect(c[c.length - 1]).toEqual({ x: 0, y: 0 }); // Z closed it

    // t = 0.5 on the quadratic: 0.25*P0 + 0.5*P1 + 0.25*P2 = (1, 0.5)
    expect(c[steps / 2].x).toBeCloseTo(1, 12);
    expect(c[steps / 2].y).toBeCloseTo(0.5, 12);

    // No closing point is appended when the outline already ends on its first point.
    const already = flattenCommands([M(0, 0), L(1, 0), L(1, 1), L(0, 0), Z]);
    expect(already).toHaveLength(1);
    expect(already[0]).toHaveLength(4);
  });

  it('samples cubic curves at the closed-form Bézier value', () => {
    const steps = 4;
    const [c] = flattenCommands([M(0, 0), C(0, 1, 1, 1, 1, 0), Z], steps);

    // Interior sample at t = 0.5 → (0.5, 0.75).
    expect(c[2].x).toBeCloseTo(0.5, 12);
    expect(c[2].y).toBeCloseTo(0.75, 12);

    // Every subdivision matches the closed form.
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      expect(c[i].x).toBeCloseTo(cubicAt(0, 0, 1, 1, t), 12);
      expect(c[i].y).toBeCloseTo(cubicAt(0, 1, 1, 0, t), 12);
    }
  });

  it('closes contours at the next M / end of input even without Z (opentype.js 2.x omits Z for fill paths)', () => {
    const contours = flattenCommands([M(0, 0), L(1, 0), L(1, 1), M(5, 5), L(6, 5), L(6, 6)]);
    expect(contours).toHaveLength(2);
    expect(contours[0]).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 0 },
    ]);
    expect(contours[1]).toEqual([
      { x: 5, y: 5 },
      { x: 6, y: 5 },
      { x: 6, y: 6 },
      { x: 5, y: 5 },
    ]);
    // A contour that already returns to its start (as opentype.js 2.x's glyf parser does) gains nothing.
    expect(flattenCommands([M(0, 0), L(1, 0), L(1, 1), L(0, 0)])[0]).toHaveLength(4);
  });

  it('splits at M and drops contours with fewer than 3 points', () => {
    const cmds: PathCommand[] = [
      M(0, 0),
      L(1, 0), // 2-point contour, no Z → dropped
      M(5, 5),
      L(6, 5),
      L(6, 6),
      Z, // triangle + closing point → kept
      M(9, 9),
      Z, // 1-point contour → dropped
    ];
    const contours = flattenCommands(cmds);
    expect(contours).toHaveLength(1);
    expect(contours[0]).toHaveLength(4);
    expect(contours[0][0]).toEqual({ x: 5, y: 5 });
    expect(flattenCommands([])).toEqual([]);
  });
});

// --- rotateToNearest -------------------------------------------------------

describe('rotateToNearest', () => {
  it('rotates a contour to start at the vertex nearest prev; identity without prev', () => {
    const c: Vec2[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(rotateToNearest(c, { x: 11, y: 9 })).toEqual([
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
    expect(rotateToNearest(c)).toEqual(c);
  });

  it('keeps an explicitly closed contour (last === first) closed after rotation', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };
    const c = { x: 10, y: 10 };
    const d = { x: 0, y: 10 };
    const rotated = rotateToNearest([a, b, c, d, a], { x: 11, y: 9 });
    expect(rotated).toEqual([c, d, a, b, c]);
  });
});

// --- buildLoop --------------------------------------------------------------

describe('buildLoop', () => {
  it('concatenates contours with -1-tagged travel vertices', () => {
    const loop = buildLoop([square(0, 0), square(3, 0)]);
    expect(loop).toHaveLength(4 + 1 + 4 + 1);
    expect(loop.map((v) => v.seg)).toEqual([0, 0, 0, 0, -1, 1, 1, 1, 1, -1]);

    // First contour is not rotated (no prev); the hop vertex duplicates its last vertex.
    expect(loop[0]).toEqual({ x: 0, y: 0, seg: 0 });
    expect(loop[4]).toEqual({ x: 0, y: 1, seg: -1 });
    // Second contour is rotated to start at its vertex nearest (0, 1), i.e. (3, 1).
    expect(loop[5]).toEqual({ x: 3, y: 1, seg: 1 });
    // The closing hop duplicates the last contour's last vertex.
    expect(loop[9]).toEqual({ x: 4, y: 1, seg: -1 });

    expect(buildLoop([])).toEqual([]);
  });
});

// --- resampleClosed --------------------------------------------------------

describe('resampleClosed', () => {
  it('resamples a closed polyline uniformly by arc length, starting at vertex 0', () => {
    const verts = square(0, 0).map((p) => ({ ...p, seg: 0 }));
    const pts = resampleClosed(verts, 8);
    expect(pts).toHaveLength(8);
    expect(pts[0]).toMatchObject({ x: 0, y: 0 });
    for (let k = 0; k < 8; k++) {
      expect(dist(pts[k], pts[(k + 1) % 8])).toBeCloseTo(0.5, 12);
      expect(pts[k].pen).toBe(true);
    }
  });

  it('yields one pen-up run per travel hop and never inks across a hop', () => {
    const pts = resampleClosed(buildLoop([square(0, 0), square(3, 0)]), 200);
    expect(pts).toHaveLength(200);
    expect(pts.some((p) => p.pen)).toBe(true);
    expect(penUpRuns(pts)).toBe(2);

    const which = (p: Vec2) => (onSquare(p, 0, 0) ? 'A' : onSquare(p, 3, 0) ? 'B' : 'T');
    for (let k = 0; k < pts.length; k++) {
      if (!pts[k].pen) continue;
      const here = which(pts[k]);
      expect(here).not.toBe('T');
      expect(which(pts[(k + 1) % pts.length])).toBe(here);
    }
  });

  it('derives pen per segment, so a hop shorter than the sample spacing still lifts the pen', () => {
    // B sits 0.01 above A: hop length 0.01 vs ~0.19 sample spacing → no sample lands on the hop.
    const b: Vec2[] = [
      { x: 0, y: 1.01 },
      { x: 0, y: 2.01 },
      { x: 1, y: 2.01 },
      { x: 1, y: 1.01 },
    ];
    const pts = resampleClosed(buildLoop([square(0, 0), b]), 40);
    expect(pts).toHaveLength(40);

    const which = (p: Vec2) => (onSquare(p, 0, 0) ? 'A' : onSquare(p, 0, 1.01) ? 'B' : 'T');
    let sawA = false;
    let sawB = false;
    for (let k = 0; k < pts.length; k++) {
      if (!pts[k].pen) continue;
      const here = which(pts[k]);
      expect(here).not.toBe('T');
      expect(which(pts[(k + 1) % pts.length])).toBe(here);
      if (here === 'A') sawA = true;
      if (here === 'B') sawB = true;
    }
    expect(sawA && sawB).toBe(true);
  });

  it('returns [] for degenerate input', () => {
    expect(resampleClosed([], 10)).toEqual([]);
    expect(resampleClosed([{ x: 1, y: 1, seg: 0 }], 10)).toEqual([]);
    const stuck = [1, 2, 3].map(() => ({ x: 1, y: 1, seg: 0 }));
    expect(resampleClosed(stuck, 10)).toEqual([]);
    expect(resampleClosed(square(0, 0).map((p) => ({ ...p, seg: 0 })), 0)).toEqual([]);
  });
});

// --- normalize ------------------------------------------------------------------

describe('normalize', () => {
  it('flips y, centers the bbox at the origin, and scales max(w, h) / 2 to 1', () => {
    const input: PathPoint[] = [
      { x: 100, y: 400, pen: true },
      { x: 300, y: 400, pen: true },
      { x: 300, y: 450, pen: false },
      { x: 100, y: 450, pen: true },
      { x: 200, y: 425, pen: false },
    ];
    const out = normalize(input);
    expect(out).toHaveLength(input.length);

    const xs = out.map((p) => p.x);
    const ys = out.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    expect((minX + maxX) / 2).toBeCloseTo(0, 12);
    expect((minY + maxY) / 2).toBeCloseTo(0, 12);
    expect(Math.max(maxX - minX, maxY - minY) / 2).toBeCloseTo(1, 12);
    expect(minX).toBeCloseTo(-1, 12);
    expect(maxX).toBeCloseTo(1, 12);

    // y is flipped: the input's larger y (450) maps to the smaller output y.
    expect(out[0].y).toBeCloseTo(0.25, 12); // y = 400
    expect(out[2].y).toBeCloseTo(-0.25, 12); // y = 450
    expect(out[2].y).toBeLessThan(out[0].y);

    // pen survives untouched.
    expect(out.map((p) => p.pen)).toEqual(input.map((p) => p.pen));

    expect(normalize([])).toEqual([]);
  });
});
