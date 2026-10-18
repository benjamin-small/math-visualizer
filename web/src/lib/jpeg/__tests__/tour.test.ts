import { describe, expect, it, vi } from 'vitest';
import { TOUR_JARGON, TOUR_SEEN_KEY, TOUR_STEPS, latestOnly, markTourSeen, sentenceCount, tourSeen } from '../tour';

describe('tour steps', () => {
  it('has the nine steps in order with their stages', () => {
    expect(TOUR_STEPS.map((s) => s.id)).toEqual(['split', 'share', 'tiles', 'waves', 'round', 'line', 'count', 'codes', 'open']);
    expect(TOUR_STEPS.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(TOUR_STEPS.map((s) => s.stage)).toEqual(['color', 'subsample', 'blocks', 'dct', 'quantize', 'zigzag', 'rle', 'huffman', 'decode']);
    expect(TOUR_STEPS.filter((s) => s.lossy).map((s) => s.id)).toEqual(['share', 'round']);
  });

  it.each(TOUR_STEPS.map((s) => [s.id, s] as const))('keeps %s short and plain', (_id, s) => {
    expect(sentenceCount(s.line)).toBeLessThanOrEqual(2);
    expect(sentenceCount(s.card)).toBe(1);
    expect(s.heading.split(/\s+/).length).toBeLessThanOrEqual(6);
    for (const t of [s.heading, s.line, s.card]) expect(t).not.toMatch(TOUR_JARGON);
    expect(s.heading).toMatch(/^[A-Z][^A-Z]*$/); // sentence case
  });

  it('gives every step a short strip label of at most two plain words', () => {
    expect(TOUR_STEPS.map((s) => s.short)).toEqual([
      'Split',
      'Shrink colour',
      'Tiles',
      'Waves',
      'Round off',
      'Line up',
      'Count zeros',
      'Short codes',
      'Open',
    ]);
    for (const s of TOUR_STEPS) {
      expect(s.short.split(/\s+/).length).toBeLessThanOrEqual(2);
      expect(s.short).not.toMatch(TOUR_JARGON);
      expect(s.short).toMatch(/^[A-Z][^A-Z]*$/); // sentence case
    }
  });

  it('catches jargon as whole words, in any case', () => {
    for (const w of ['DCT', 'quantize', 'Quantization', 'chroma', 'Huffman', 'coefficient', 'coefficients', 'luma', 'YCbCr', 'MCU']) {
      expect(w).toMatch(TOUR_JARGON);
    }
    expect('Cut into tiles, then count the zeros').not.toMatch(TOUR_JARGON);
  });
});

describe('sentenceCount', () => {
  it('counts sentences', () => {
    expect(sentenceCount('One. Two!')).toBe(2);
    expect(sentenceCount('"Five zeros, then a 3" is shorter than writing them all out.')).toBe(1);
  });
});

describe('first-visit memory', () => {
  it('remembers the first visit', () => {
    localStorage.removeItem(TOUR_SEEN_KEY);
    expect(tourSeen()).toBe(false);
    markTourSeen();
    expect(tourSeen()).toBe(true);
    expect(localStorage.getItem(TOUR_SEEN_KEY)).toBe('1');
  });

  it('treats storage that throws as not seen, and marking as a no-op', () => {
    const proto = localStorage instanceof Storage ? Storage.prototype : localStorage;
    const get = vi.spyOn(proto, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(proto, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(tourSeen()).toBe(false);
    expect(() => markTourSeen()).not.toThrow();
    // Closed once with storage blocked, it stays closed for the rest of this page view.
    expect(tourSeen()).toBe(true);
    get.mockRestore();
    set.mockRestore();
    // Storage that works is still the only memory that counts.
    localStorage.removeItem(TOUR_SEEN_KEY);
    expect(tourSeen()).toBe(false);
  });
});

describe('latestOnly', () => {
  const flush = () => new Promise<void>((r) => setTimeout(r, 0));

  it('runs one at a time and delivers only the latest', async () => {
    const pending: Array<(v: number) => void> = [];
    const run = vi.fn((_a: number) => new Promise<number>((r) => pending.push(r)));
    const got: number[] = [];
    const go = latestOnly(run, (r) => got.push(r));
    go(1);
    go(2);
    go(3);
    expect(run).toHaveBeenCalledTimes(1); // 2 and 3 wait; 2 is dropped
    pending[0](10);
    await flush();
    expect(got).toEqual([]); // 1's result is stale: 3 is waiting
    expect(run).toHaveBeenLastCalledWith(3);
    pending[1](30);
    await flush();
    expect(got).toEqual([30]);
  });

  it('passes the argument the result was made for', async () => {
    const got: Array<[number, string]> = [];
    const go = latestOnly(
      async (a: string) => a.length,
      (r, a) => got.push([r, a]),
    );
    go('abc');
    await flush();
    expect(got).toEqual([[3, 'abc']]);
  });

  it('keeps going after deliver throws', async () => {
    let first = true;
    const got: number[] = [];
    const go = latestOnly(
      async (a: number) => a,
      (r) => {
        if (first) {
          first = false;
          throw new Error('boom');
        }
        got.push(r);
      },
    );
    go(1);
    await flush();
    go(2);
    await flush();
    expect(got).toEqual([2]);
  });

  it('keeps going after run throws synchronously', async () => {
    const got: number[] = [];
    const go = latestOnly(
      (a: number): Promise<number> => {
        if (a === 1) throw new Error('boom');
        return Promise.resolve(a);
      },
      (r) => got.push(r),
    );
    go(1);
    await flush();
    go(2);
    await flush();
    expect(got).toEqual([2]);
  });

  it('keeps going after a run rejects', async () => {
    const got: number[] = [];
    const run = vi.fn(async (a: number) => {
      if (a === 1) throw new Error('boom');
      return a * 2;
    });
    const go = latestOnly(run, (r) => got.push(r));
    go(1);
    await flush();
    expect(got).toEqual([]);
    go(2);
    await flush();
    expect(got).toEqual([4]);
  });
});
