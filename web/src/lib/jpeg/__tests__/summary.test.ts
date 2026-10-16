import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatBytes, readSummary, readoutOf } from '../summary';
import { busiestLine, cumulativeEnergy, mirrored, periodic, psnrOf, termsFor } from '../math';
import { ENTROPY_TEX, chromaKept, lastNonZero, samplesKept, stageTex, NOTICE } from '../formulas';
import { STAGES } from '../stages';
import { decodeUpload, fitWithin } from '../images';
import { jpegSummaryFixture } from '../../test/fakeViz';

describe('readSummary', () => {
  it('parses the engine summary', () => {
    const s = readSummary(jpegSummaryFixture)!;
    expect(s.total).toBe(256);
    expect(s.mcu).toEqual([16, 16, 16, 16]);
    expect(s.grids[1]).toEqual([16, 16]);
    expect(s.selected!.bitSpan).toEqual([100, 9]);
    expect(s.selected!.dcDiff).toBe(2);
    expect(s.error).toBeNull();
    // The scan's bits split into Huffman codes and amplitude bits.
    expect([s.payloadBits, s.codeBits, s.entropyBits]).toEqual([30000, 29000, 28000]);
  });

  it('reads the codes that spell out the selected block, and the artifact hints', () => {
    const s = readSummary(jpegSummaryFixture)!;
    const sel = s.selected!;
    expect([sel.dcSize, sel.dcCode, sel.dcAmpBits]).toEqual([2, '011', '10']);
    expect(sel.tokens[0]).toMatchObject({ code: '1010', ampBits: '' });
    expect(sel.dcCode + sel.dcAmpBits + sel.tokens.map((t) => t.code + t.ampBits).join('')).toBe(sel.bits);
    expect(s.hints).toEqual({ blocking: [3, 4], ringing: [5, 6], bleed: [7, 8] });
    // A Rust None for ringing (no hard edge in the picture) stays null; a malformed hint drops them all.
    expect(readSummary({ ...jpegSummaryFixture, hints: { blocking: [1, 2], ringing: undefined, bleed: [3, 4] } })!.hints!.ringing).toBeNull();
    expect(readSummary({ ...jpegSummaryFixture, hints: { blocking: [1], bleed: [3, 4] } })!.hints).toBeNull();
    expect(readSummary({ ...jpegSummaryFixture, hints: undefined })!.hints).toBeNull();
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
    expect(stageTex('quantize', s, null)[1]).toBe(String.raw`F_Q(0,0) = \operatorname{round}\!\left(\frac{120.0}{16}\right) = 8`);
    expect(stageTex('quantize', s, [1, 0])[1]).toContain('\\frac{-20.0}{16}');
    expect(stageTex('zigzag', s, null)[1]).toContain('\\#1\\text{ of }64');
    expect(stageTex('zigzag', s, null)[1]).toContain('63\\text{ zeros follow}');
    expect(stageTex('rle', s, null)[1]).toBe(String.raw`\Delta DC = 8 - (6) = 2,\quad \text{size} = 2`);
    // Code bits (not the payload) are compared with the bound; the payload adds the amplitude bits.
    const huffman = stageTex('huffman', s, null)[1];
    expect(huffman).toBe(
      String.raw`\text{codes: } 29000\text{ bits} \ge 28000\text{ bits (Shannon bound)},\quad 29000 + 1000\text{ amplitude bits} = 30000\text{ bits written}`,
    );
    expect(stageTex('decode', s, null)[1]).toBe(String.raw`\text{PSNR} = 36.5\text{ dB}`);
    expect(stageTex('decode', { ...s, psnr: null }, null)[1]).toContain('\\infty');
    expect(stageTex('quantize', null, null)).toHaveLength(1);
  });

  it('says "all 64 are zero" for a block with no non-zero value, not "#0 of 64"', () => {
    const s = readSummary(jpegSummaryFixture)!;
    const empty = { ...s, selected: { ...s.selected!, zigzag: Array.from({ length: 64 }, () => 0) } };
    const line = stageTex('zigzag', empty, null)[1];
    expect(line).toBe(String.raw`\text{all 64 are zero}`);
    expect(line).not.toContain('#0');
  });

  it('explains entropy on the overview', () => {
    expect(stageTex('overview', null, null)[0]).toBe(ENTROPY_TEX);
    expect(stageTex('overview', readSummary(jpegSummaryFixture), null)).toEqual([ENTROPY_TEX]);
  });

  it('has a notice for every stage', () => {
    for (const { id } of STAGES) expect(NOTICE[id].length).toBeGreaterThan(20);
    // Raw bytes are only random-looking for photographs (a gradient or a test card is not).
    expect(NOTICE.overview).toContain('For a photo, raw pixel bytes look almost random');
  });

  it('finds the last non-zero coefficient (-1 when there is none)', () => {
    expect(lastNonZero([5, 0, 3, 0, 0])).toBe(2);
    expect(lastNonZero([0, 0, 0])).toBe(-1);
    expect(lastNonZero([])).toBe(-1);
  });

  it('measures PSNR over RGB, ignoring alpha', () => {
    const a = new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255]);
    expect(psnrOf(a, a)).toBe(Infinity);
    // Every channel off by one: MSE = 1, PSNR = 20·log10(255).
    const b = Uint8Array.from(a, (v, i) => (i % 4 === 3 ? 0 : v + 1));
    expect(psnrOf(a, b)).toBeCloseTo(48.13, 2);
    expect(psnrOf(a, a.slice(0, 4))).toBeNaN();
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
