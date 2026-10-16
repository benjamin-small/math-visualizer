import { describe, it, expect, beforeEach } from 'vitest';
import { RD_PSNR_CAP, RD_QUALITIES, addPoint, cachedCurve, clearCurves, missing, rdKey, rdPolyline } from '../rd';

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
