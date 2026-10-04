import { describe, it, expect } from 'vitest';
import { MARGIN, BAR_INSET, notesLayout, toDevice, labelAnchors, type Point } from '../layout';

const ZERO = { x: 0, y: 0, w: 0, h: 0 };

function expectPoint(p: Point, x: number, y: number) {
  expect(p.x).toBeCloseTo(x, 10);
  expect(p.y).toBeCloseTo(y, 10);
}

describe('constants', () => {
  it('use a 16 px margin and the 12% bar gutter the Rust viz draws with', () => {
    expect(MARGIN).toBe(16);
    expect(BAR_INSET).toBe(0.12);
  });
});

describe('notesLayout, landscape', () => {
  it('puts a square at the left and a slim band to its right, a margin apart and centred on the square', () => {
    const { figure, strip } = notesLayout(1168, 650);
    expect(figure).toEqual({ x: 16, y: 16, w: 618, h: 618 });
    expect(figure.w).toBe(figure.h);
    expect(strip.x).toBe(figure.x + figure.w + 16);
    expect(strip.x + strip.w).toBe(1168 - 16);
    expect(strip.h).toBe(Math.round(0.45 * figure.w)); // 278: the binding term, not the stage height
    expect(strip.h).toBe(278);
    expect(strip.y).toBe(186);
    expect(strip.y + strip.h / 2).toBe(figure.y + figure.h / 2); // vertically centred on the square
    expect(figure.x + figure.w).toBeLessThanOrEqual(strip.x);
  });

  it('caps the square at 60% of the free width so the strip is never squeezed out', () => {
    // 800 x 700: the height would allow 668, but 60% of the 752 px left after the margins is 451.2.
    const { figure, strip } = notesLayout(800, 700);
    expect(figure.w).toBeCloseTo(0.6 * (800 - 3 * 16), 10);
    expect(figure.h).toBe(figure.w);
    expect(figure.x).toBe(16);
    expect(figure.y + figure.h / 2).toBeCloseTo(700 / 2, 10); // centred vertically
    expect(strip.x).toBeCloseTo(figure.x + figure.w + 16, 10);
    expect(strip.x + strip.w).toBeCloseTo(800 - 16, 10);
    expect(strip.h).toBe(Math.round(0.45 * figure.w)); // 203, far short of the 668 px the stage would allow
    expect(strip.y).toBeCloseTo(248.5, 10);
    expect(strip.y + strip.h / 2).toBeCloseTo(700 / 2, 10); // centred on the stage, so on the square
    expect(strip.y + strip.h / 2).toBeCloseTo(figure.y + figure.h / 2, 10);
  });

  it('is limited by the height on a wide, short stage', () => {
    const { figure, strip } = notesLayout(1200, 300);
    expect(figure).toEqual({ x: 16, y: 16, w: 268, h: 268 });
    expect(strip).toEqual({ x: 300, y: 89.5, w: 884, h: 121 }); // 0.45 * 268 = 120.6, rounded
  });

  it('treats a square stage as landscape', () => {
    const { figure, strip } = notesLayout(700, 700);
    expect(figure.x).toBe(16);
    expect(strip.x).toBeGreaterThan(figure.x + figure.w);
    expect(strip.h).toBe(176);
    expect(strip.y).toBe(262);
    expect(strip.y + strip.h / 2).toBeCloseTo(figure.y + figure.h / 2, 10);
  });
});

describe('notesLayout, portrait', () => {
  it('puts a centred square on top and a slim band directly below it, a margin apart', () => {
    const { figure, strip } = notesLayout(343, 420);
    expect(figure.w).toBeCloseTo(0.6 * (420 - 3 * 16), 10); // 223.2: height-capped
    expect(figure.h).toBe(figure.w);
    expect(figure.y).toBe(16);
    expect(figure.x + figure.w / 2).toBeCloseTo(343 / 2, 10); // centred horizontally
    expect(strip.x).toBe(16);
    expect(strip.w).toBe(343 - 2 * 16);
    expect(strip.y).toBeCloseTo(figure.y + figure.h + 16, 10); // directly below, a margin down
    expect(strip.h).toBe(Math.round(0.45 * figure.w)); // 100 of the 148.8 px left: the binding term
    expect(strip.h).toBe(100);
    expect(strip.y + strip.h).toBeLessThan(420 - 16); // room to spare above the bottom margin
  });

  it('is limited by the width on a narrow, tall stage', () => {
    const { figure, strip } = notesLayout(300, 900);
    expect(figure).toEqual({ x: 16, y: 16, w: 268, h: 268 });
    expect(strip).toEqual({ x: 16, y: 300, w: 268, h: 121 }); // 0.45 * 268 = 120.6, rounded; 584 px were free
  });

  it('never lets the band run into the bottom margin, even where rounding would overshoot the room left', () => {
    // 40 x 50: the square is 1.2 px, 0.45 * 1.2 rounds up to 1, but only 0.8 px remain above the margin.
    const { figure, strip } = notesLayout(40, 50);
    expect(figure.w).toBeCloseTo(1.2, 10);
    expect(Math.round(0.45 * figure.w)).toBe(1);
    expect(strip.h).toBeCloseTo(0.8, 10);
    expect(strip.y + strip.h).toBeCloseTo(50 - 16, 10);
  });
});

describe('notesLayout, degenerate sizes', () => {
  it.each([
    [0, 0],
    [20, 20],
    [500, 0],
    [0, 500],
    [NaN, NaN],
  ])('returns two all-zero rects for %f x %f', (w, h) => {
    const { figure, strip } = notesLayout(w, h);
    expect(figure).toEqual(ZERO);
    expect(strip).toEqual(ZERO);
  });
});

describe('notesLayout, at any usable size', () => {
  it.each([
    [1168, 650],
    [1920, 1080],
    [800, 700],
    [1200, 300],
    [700, 700],
    [375, 812],
    [343, 420],
    [300, 900],
  ])('%i x %i keeps both rects inside the margins and apart', (w, h) => {
    const { figure, strip } = notesLayout(w, h);
    const m = MARGIN - 1e-9;
    for (const r of [figure, strip]) {
      expect(r.w).toBeGreaterThan(0);
      expect(r.h).toBeGreaterThan(0);
      expect(r.x).toBeGreaterThanOrEqual(m);
      expect(r.y).toBeGreaterThanOrEqual(m);
      expect(r.x + r.w).toBeLessThanOrEqual(w - MARGIN + 1e-9);
      expect(r.y + r.h).toBeLessThanOrEqual(h - MARGIN + 1e-9);
    }
    expect(figure.h).toBeCloseTo(figure.w, 10);
    const apartX = figure.x + figure.w + MARGIN - 1e-9 <= strip.x;
    const apartY = figure.y + figure.h + MARGIN - 1e-9 <= strip.y;
    expect(apartX || apartY).toBe(true);
  });

  it.each([
    [1168, 650],
    [1920, 1080],
    [800, 700],
    [1200, 300],
    [700, 700],
    [375, 812],
    [343, 420],
    [300, 900],
  ])('%i x %i makes the strip a slim band, centred beside a landscape square and just below a portrait one', (w, h) => {
    const { figure, strip } = notesLayout(w, h);
    expect(strip.h).toBe(Math.round(0.45 * figure.w));
    expect(strip.h).toBeLessThan(figure.h);
    if (w >= h) {
      expect(strip.y + strip.h / 2).toBeCloseTo(figure.y + figure.h / 2, 10);
    } else {
      expect(strip.y).toBeCloseTo(figure.y + figure.h + MARGIN, 10);
    }
  });
});

describe('toDevice', () => {
  const r = { x: 16, y: 16, w: 618, h: 618 };

  it('is the identity at a device pixel ratio of 1', () => {
    expect(toDevice(r, 1)).toEqual([16, 16, 618, 618]);
  });

  it('scales every component by the ratio', () => {
    expect(toDevice(r, 2)).toEqual([32, 32, 1236, 1236]);
  });

  it('rounds every component to a whole device pixel', () => {
    // 59.9 * 1.5 = 89.85, 16 * 1.5 = 24, 223.2 * 1.5 = 334.8
    expect(toDevice({ x: 59.9, y: 16, w: 223.2, h: 223.2 }, 1.5)).toEqual([90, 24, 335, 335]);
    expect(toDevice({ x: 1.5, y: 2.5, w: 3.5, h: 4.5 }, 1)).toEqual([2, 3, 4, 5]);
  });

  it('keeps an all-zero rect all zero', () => {
    expect(toDevice(ZERO, 2)).toEqual([0, 0, 0, 0]);
  });
});

describe('labelAnchors', () => {
  it('puts each bar label at its bar end and the ratio at the square bottom-centre', () => {
    const { bars, ratio } = labelAnchors({ x: 10, y: 20, w: 100, h: 100 });
    expectPoint(bars[0], 16, 108); // left bar: bottom end, 6% in
    expectPoint(bars[1], 98, 26); // top bar: right end, 6% down
    expectPoint(bars[2], 104, 108); // right bar: bottom end, 94% across
    expectPoint(ratio, 60, 114);
  });

  it('scales with the square', () => {
    const { bars, ratio } = labelAnchors({ x: 0, y: 0, w: 200, h: 200 });
    expectPoint(bars[0], 12, 176);
    expectPoint(bars[1], 176, 12);
    expectPoint(bars[2], 188, 176);
    expectPoint(ratio, 100, 188);
  });

  it('keeps every anchor inside the figure', () => {
    const { figure } = notesLayout(1168, 650);
    const { bars, ratio } = labelAnchors(figure);
    for (const p of [...bars, ratio]) {
      expect(p.x).toBeGreaterThan(figure.x);
      expect(p.x).toBeLessThan(figure.x + figure.w);
      expect(p.y).toBeGreaterThan(figure.y);
      expect(p.y).toBeLessThan(figure.y + figure.h);
    }
  });
});
