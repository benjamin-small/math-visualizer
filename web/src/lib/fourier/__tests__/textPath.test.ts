import { describe, expect, it, vi } from 'vitest';
import { loadFont } from '../font';
import { textToPath } from '../textPath';

// A fake font whose getPath() returns a 100×100 square outline, so no font file is needed.
vi.mock('../font', () => ({
  loadFont: vi.fn(async () => ({
    getPath: () => ({
      commands: [
        { type: 'M', x: 0, y: 0 },
        { type: 'L', x: 100, y: 0 },
        { type: 'L', x: 100, y: 100 },
        { type: 'L', x: 0, y: 100 },
        { type: 'Z' },
      ],
    }),
  })),
}));

describe('textToPath', () => {
  it('returns [] for blank text without loading the font', async () => {
    expect(await textToPath('')).toEqual([]);
    expect(await textToPath('   ')).toEqual([]);
    expect(loadFont).not.toHaveBeenCalled();
  });

  it('produces exactly `samples` finite, normalized, pen-tagged points', async () => {
    const pts = await textToPath('x', { samples: 40 });
    expect(pts).toHaveLength(40);
    for (const p of pts) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
      expect(typeof p.pen).toBe('boolean');
    }
    expect(pts.some((p) => p.pen)).toBe(true);

    // Normalized: bbox centered at the origin with max extent 2.
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(-1, 9);
    expect(Math.max(...xs)).toBeCloseTo(1, 9);
    expect(Math.min(...ys)).toBeCloseTo(-1, 9);
    expect(Math.max(...ys)).toBeCloseTo(1, 9);
  });
});
