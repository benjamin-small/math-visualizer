import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatBytes, readSummary, readoutOf } from '../summary';
import { busiestLine, cumulativeEnergy, mirrored, periodic, termsFor } from '../math';
import { chromaKept, samplesKept, stageTex, NOTICE } from '../formulas';
import { decodeUpload, fitWithin } from '../images';
import { jpegSummaryFixture } from '../../test/fakeViz';

describe('readSummary', () => {
  it('parses the engine summary', () => {
    const s = readSummary(jpegSummaryFixture)!;
    expect(s.total).toBe(256);
    expect(s.mcu).toEqual([16, 16, 16, 16]);
    expect(s.grids[1]).toEqual([16, 16]);
    expect(s.selected!.bitSpan).toEqual([100, 6]);
    expect(s.selected!.dcDiff).toBe(2);
    expect(s.error).toBeNull();
  });

  it('treats undefined (a Rust None) as missing, not as a value', () => {
    const s = readSummary({ ...jpegSummaryFixture, psnr: undefined, quality: undefined, selected: undefined })!;
    expect(s.psnr).toBeNull();
    expect(s.quality).toBeNull();
    expect(s.selected).toBeNull();
  });

  it('rejects anything that is not a JPEG summary', () => {
    expect(readSummary(null)).toBeNull();
    expect(readSummary({ phase: 1 })).toBeNull();
    expect(readSummary({ ...jpegSummaryFixture, selected: { ...jpegSummaryFixture.selected, pixels: [1, 2] } })!.selected).toBeNull();
  });

  it('formats the readout', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(4096)).toBe('4.0 KB');
    const r = readoutOf(readSummary(jpegSummaryFixture)!);
    expect(r).toEqual({ size: '4.0 KB', of: '192.0 KB', ratio: '48.0 : 1', bpp: '0.50', psnr: '36.5 dB' });
    expect(readoutOf(readSummary({ ...jpegSummaryFixture, psnr: null })!).psnr).toBe('∞ dB');
  });
});

describe('math', () => {
  it('accumulates energy in the given order', () => {
    const e = cumulativeEnergy([3, 4, 0, 0], [1, 0, 2, 3]);
    expect(e).toEqual([16 / 25, 1, 1, 1]);
    expect(cumulativeEnergy([0, 0], [0, 1])).toEqual([0, 0]);
  });

  it('counts the terms that reach a share of the energy', () => {
    expect(termsFor([1, 1, 1, 1], 0.5)).toBe(2);
    expect(termsFor([9, 1], 0.9)).toBe(1);
    expect(termsFor([0, 0], 0.9)).toBe(0);
  });

  it('extends a row the two ways', () => {
    expect(periodic([1, 2], 2)).toEqual([1, 2, 1, 2]);
    expect(mirrored([1, 2], 3)).toEqual([1, 2, 2, 1, 1, 2]);
  });

  it('picks the busiest row or column', () => {
    const vertical = Array.from({ length: 64 }, (_, i) => (Math.floor(i / 8) < 4 ? 0 : 100));
    const b = busiestLine(vertical);
    expect(b.axis).toBe('column');
    expect(b.values).toEqual([0, 0, 0, 0, 100, 100, 100, 100]);
    const horizontal = Array.from({ length: 64 }, (_, i) => (i % 8) * 10);
    expect(busiestLine(horizontal).axis).toBe('row');
  });
});

describe('formulas', () => {
  it('knows how much each mode keeps', () => {
    expect(chromaKept('444')).toBe(1);
    expect(chromaKept('422')).toBe(0.5);
    expect(chromaKept('420')).toBe(0.25);
    expect(samplesKept('420')).toBe(0.5);
  });

  it('puts the selected block’s numbers into the formulas', () => {
    const s = readSummary(jpegSummaryFixture)!;
    expect(stageTex('blocks', s, null)[0]).toContain('= 100 - 128 = -28');
    expect(stageTex('dct', s, [1, 0])[1]).toContain('F(1,0)');
    expect(stageTex('dct', s, [1, 0])[1]).toContain('-20.0');
    expect(stageTex('subsample', s, null)[1]).toContain('25\\%');
    expect(stageTex('color', null, null)).toHaveLength(1);
    expect(stageTex('quantize', s, null)).toEqual([]);
  });

  it('has a notice for every ready stage', () => {
    for (const id of ['color', 'subsample', 'blocks', 'dct'] as const) expect(NOTICE[id].length).toBeGreaterThan(20);
  });
});

describe('images', () => {
  it('scales uploads down to fit 512, never up', () => {
    expect(fitWithin(300, 200)).toEqual({ w: 300, h: 200 });
    expect(fitWithin(4000, 3000)).toEqual({ w: 512, h: 384 });
    expect(fitWithin(10, 4000)).toEqual({ w: 1, h: 512 });
    expect(fitWithin(0, 10)).toEqual({ w: 0, h: 0 });
  });

  describe('decodeUpload', () => {
    const bitmap = () => ({ width: 4, height: 2, close: vi.fn() });
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    it('paints the canvas white before drawing, so transparent areas are not black', async () => {
      const calls: string[] = [];
      const ctx = {
        fillStyle: '',
        fillRect: vi.fn(() => calls.push(`fill ${ctx.fillStyle}`)),
        drawImage: vi.fn(() => calls.push('draw')),
        getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4 * 2 * 4) })),
      };
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
      const b = bitmap();
      vi.stubGlobal('createImageBitmap', vi.fn(() => Promise.resolve(b)));
      const img = await decodeUpload(new Blob(['x']));
      expect(calls).toEqual(['fill #fff', 'draw']);
      expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 4, 2);
      expect([img.w, img.h]).toEqual([4, 2]);
      expect(b.close).toHaveBeenCalled();
    });

    it('releases the bitmap when the canvas cannot be read', async () => {
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
      const b = bitmap();
      vi.stubGlobal('createImageBitmap', vi.fn(() => Promise.resolve(b)));
      await expect(decodeUpload(new Blob(['x']))).rejects.toThrow(/cannot read image pixels/);
      expect(b.close).toHaveBeenCalled();
    });
  });
});
