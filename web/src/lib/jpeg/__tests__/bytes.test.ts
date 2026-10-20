import { describe, expect, it } from 'vitest';
import { blockFill, blockSize, entropyBits, formatBlock, histogram, neighbourDiffs, rgbSamples } from '../bytes';

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

describe('blocks of memory', () => {
  const KB = 1024;

  it('picks a whole power-of-two block so the raw pixels fill at most the given number', () => {
    expect(blockSize(192 * KB, 64)).toBe(4 * KB); // 48 blocks
    expect(blockSize(192 * KB, 32)).toBe(8 * KB); // 24 blocks
    expect(blockSize(64 * KB, 64)).toBe(KB); // exactly 64
    expect(blockSize(64 * KB + 1, 64)).toBe(2 * KB);
    for (const raw of [768, 12 * KB, 300 * KB, 3 * 1024 * KB]) {
      const b = blockSize(raw, 64);
      expect(Math.log2(b) % 1).toBe(0);
      expect(Math.ceil(raw / b)).toBeLessThanOrEqual(64);
      expect(Math.ceil(raw / b)).toBeGreaterThan(32); // never needlessly coarse
    }
    expect(blockSize(0, 64)).toBe(1);
  });

  it('fills whole blocks, then a share of the last', () => {
    expect(blockFill(10 * KB, 4 * KB)).toEqual({ full: 2, part: 0.5 });
    expect(blockFill(192 * KB, 4 * KB)).toEqual({ full: 48, part: 0 });
    expect(blockFill(0, 4 * KB)).toEqual({ full: 0, part: 0 });
    const tiny = blockFill(300, 4 * KB);
    expect(tiny.full).toBe(0);
    expect(tiny.part).toBeGreaterThan(0);
    expect(tiny.part).toBeLessThan(1);
  });

  it('names a block in whole units', () => {
    expect(formatBlock(4 * KB)).toBe('4 KB');
    expect(formatBlock(KB)).toBe('1 KB');
    expect(formatBlock(512)).toBe('512 B');
  });
});
