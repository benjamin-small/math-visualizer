import { describe, it, expect } from 'vitest';
import { placeCard } from '../placeCard';

const card = { w: 200, h: 100 };
const view = { w: 800, h: 600 };

describe('placeCard', () => {
  it('prefers right of and below the anchor, a gap away', () => {
    expect(placeCard({ x: 10, y: 10 }, card, view)).toEqual({ x: 22, y: 22 });
  });

  it('flips left at the right edge', () => {
    const p = placeCard({ x: 790, y: 300 }, card, view);
    expect(p.x + 200).toBeLessThanOrEqual(792);
    expect(p.x).toBeLessThan(790);
  });

  it('flips up at the bottom edge', () => {
    const p = placeCard({ x: 300, y: 590 }, card, view);
    expect(p.y + 100).toBeLessThanOrEqual(592);
    expect(p.y).toBeLessThan(590);
  });

  it('clamps a wide card into a 375 x 812 phone viewport', () => {
    for (const x of [0, 100, 200, 374]) {
      const p = placeCard({ x, y: 400 }, { w: 340, h: 200 }, { w: 375, h: 812 });
      expect(p.x).toBeGreaterThanOrEqual(8);
      expect(p.x).toBeLessThanOrEqual(27);
    }
  });

  it('places beside a rectangle anchor rather than on it', () => {
    expect(placeCard({ x: 100, y: 100, w: 50, h: 30 }, card, view)).toEqual({ x: 162, y: 142 });
  });
});
