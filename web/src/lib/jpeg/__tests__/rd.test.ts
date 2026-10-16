import { describe, it, expect, beforeEach, assert } from 'vitest';
import { RD_FRAME_BUDGET_MS, RD_PER_FRAME, RD_PSNR_CAP, RD_QUALITIES, addPoint, cachedCurve, clearCurves, missing, rdKey, rdPolyline, sweepFrame } from '../rd';

describe('rate–distortion cache', () => {
  beforeEach(() => clearCurves());

  it('samples every quality from 1 to 100', () => {
    expect(RD_QUALITIES).toHaveLength(100);
    expect([RD_QUALITIES[0], RD_QUALITIES[99]]).toEqual([1, 100]);
  });

  it('keys curves by picture and the settings that move them', () => {
    expect(rdKey('gradient', '420', 'optimized')).not.toBe(rdKey('gradient', '444', 'optimized'));
    expect(rdKey('upload-1', '420', 'optimized')).not.toBe(rdKey('upload-2', '420', 'optimized'));
  });

  it('keeps points sorted by quality, once each, and knows what is missing', () => {
    const k = rdKey('a', '420', 'optimized');
    addPoint(k, { quality: 50, bytes: 900, psnr: 33 });
    addPoint(k, { quality: 10, bytes: 300, psnr: 27 });
    addPoint(k, { quality: 50, bytes: 1, psnr: 1 });
    expect(cachedCurve(k).map((p) => p.quality)).toEqual([10, 50]);
    expect(cachedCurve(k)[1].bytes).toBe(900);
    expect(missing(k)).toHaveLength(98);
    expect(missing(k)).not.toContain(10);
    expect(cachedCurve(rdKey('b', '420', 'optimized'))).toEqual([]);
  });

  it('draws bytes across and PSNR up, capping a perfect copy at the top', () => {
    const pts = [
      { quality: 1, bytes: 0, psnr: 0 },
      { quality: 50, bytes: 500, psnr: RD_PSNR_CAP / 2 },
      { quality: 100, bytes: 1000, psnr: Infinity },
    ];
    expect(rdPolyline(pts, 200, 100, 1000)).toBe('0.0,100.0 100.0,50.0 200.0,0.0');
    expect(rdPolyline([], 200, 100, 1000)).toBe('');
  });
});

describe('sweepFrame', () => {
  /** A clock that moves `perCall` ms every time it is read. */
  const clock = (perCall: number) => {
    let t = 0;
    return () => (t += perCall);
  };

  it('always runs at least one encode, however slow', () => {
    const done: number[] = [];
    const n = sweepFrame([1, 2, 3, 4], (q) => done.push(q), clock(100));
    expect(n).toBe(1);
    expect(done).toEqual([1]);
  });

  it('stops once the budget is spent', () => {
    const done: number[] = [];
    // Each read of the clock costs 3 ms: start, then one read per encode.
    const n = sweepFrame([1, 2, 3, 4], (q) => done.push(q), clock(3));
    expect(RD_FRAME_BUDGET_MS).toBe(8);
    expect(n).toBe(3); // 3 ms, 6 ms after 1 and 2 are under 8; 9 ms after the third is over
    expect(done).toEqual([1, 2, 3]);
  });

  it('never runs more than the cap, and never past the end of the list', () => {
    const done: number[] = [];
    expect(sweepFrame(Array.from({ length: 10 }, (_, i) => i + 1), (q) => done.push(q), clock(0))).toBe(RD_PER_FRAME);
    expect(sweepFrame([7], () => {}, clock(0))).toBe(1);
    expect(sweepFrame([], () => assert.fail('nothing to run'), clock(0))).toBe(0);
  });
});
