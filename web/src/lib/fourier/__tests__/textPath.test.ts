import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as opentype from 'opentype.js';
import { textToPath, glyphOutlineCommands, samplesFor, MIN_SAMPLES, MAX_SAMPLES } from '../textPath';
import type { PathCommand } from '../geometry';

// A 2-glyph fake font: each glyph is a unit square outline, advance 1000 units/em.
const square = (x: number): PathCommand[] => [
  { type: 'M', x, y: 0 }, { type: 'L', x: x + 50, y: 0 }, { type: 'L', x: x + 50, y: 50 }, { type: 'L', x, y: 50 }, { type: 'Z' },
];
const fakeFont = {
  unitsPerEm: 1000,
  charToGlyph: () => ({ advanceWidth: 600, getPath: (x: number) => ({ commands: square(x) }) }),
  getKerningValue: () => 0,
} as unknown as opentype.Font;

vi.mock('../font', () => ({ loadFont: vi.fn(async () => fakeFont) }));

describe('textToPath (fake font)', () => {
  it('returns [] for blank text', async () => {
    expect(await textToPath('')).toEqual([]);
    expect(await textToPath('   ')).toEqual([]);
  });
  it('produces the requested number of finite, pen-tagged samples', async () => {
    const pts = await textToPath('xy', { samples: 40 });
    expect(pts).toHaveLength(40);
    expect(pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    expect(pts.some((p) => p.pen)).toBe(true);
    expect(pts.some((p) => !p.pen)).toBe(true); // the hop between the two squares
  });
  it('advances by glyph width so glyphs do not overlap', () => {
    const cmds = glyphOutlineCommands(fakeFont, 'ab', 100);
    const xs = cmds.flatMap((c) => (c.type === 'M' ? [c.x] : []));
    expect(xs).toEqual([0, 60]); // 600 units * (100 / 1000)
  });
});

describe('samplesFor', () => {
  it('is a power of two, at least epicycles + 1, clamped to [MIN, MAX]', () => {
    expect(samplesFor(1)).toBe(MIN_SAMPLES);
    expect(samplesFor(2000)).toBe(2048);
    expect(samplesFor(2047)).toBe(2048);
    expect(samplesFor(2048)).toBe(4096);
    expect(samplesFor(50_000)).toBe(65_536);
    expect(samplesFor(1_000_000)).toBe(MAX_SAMPLES);
    for (const n of [3, 500, 2048, 9_999, 50_000]) {
      const s = samplesFor(n);
      expect(Number.isInteger(Math.log2(s))).toBe(true);
      expect(s).toBeGreaterThanOrEqual(Math.min(n + 1, MAX_SAMPLES));
    }
  });
});

describe('textToPath (real bundled font)', () => {
  // Guards against opentype.js shaping limitations: font.getPath() throws on
  // Space Mono's GSUB lookups, so we must build outlines per glyph.
  // vitest runs from web/ (its config dir); import.meta.url is not a file: URL there.
  const ttf = readFileSync(path.join(process.cwd(), 'public', 'fonts', 'SpaceMono-Regular.ttf'));
  const font = opentype.parse(ttf.buffer.slice(ttf.byteOffset, ttf.byteOffset + ttf.byteLength));

  it.each(['POIETIC TECH', 'poietic tech', 'Hello, world!'])('traces %j', async (text) => {
    const pts = await textToPath(text, { font });
    expect(pts).toHaveLength(2000);
    expect(pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    const xs = pts.map((p) => p.x);
    expect(Math.max(...xs)).toBeCloseTo(1, 2);
    expect(Math.min(...xs)).toBeCloseTo(-1, 2);
    const down = pts.filter((p) => p.pen).length;
    expect(down).toBeGreaterThan(1000);
    expect(down).toBeLessThan(2000); // travel hops between glyphs are pen-up
  });
});
