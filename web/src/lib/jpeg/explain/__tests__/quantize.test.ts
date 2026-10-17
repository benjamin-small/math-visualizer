import { describe, expect, it } from 'vitest';
import { explain } from '..';
import { makeContext } from './fixture';

const q = (over = {}) => makeContext({ stage: 'quantize', ...over });

describe('Quantize cards', () => {
  it('shows what a coefficient rounds to, with the arithmetic', () => {
    const e = explain({ id: 'quantize.after', u: 0, v: 0 }, q())!;
    expect(e.value).toBe('8');
    expect(e.consequence).toMatch(/120\.0 ÷ 16 = 7\.5 .*8/);
    expect(e.consequence).toBe('At quality 50: 120.0 ÷ 16 = 7.5 → rounds to 8 (kept).');
    expect(explain({ id: 'quantize.after', u: 3, v: 0 }, q())!.consequence).toMatch(/\(dropped\)/);
    expect(explain({ id: 'quantize.after', u: 1, v: 0 }, q())!.value).toBe('−1');
  });

  it('shows the table the encoder used, not a recomputed one', () => {
    expect(explain({ id: 'quantize.table', u: 0, v: 0 }, q({ quality: 20 }))!.value).toBe('16');
    expect(explain({ id: 'quantize.table', u: 1, v: 0 }, q())!.value).toBe('16');
  });

  it('says so when the reader\'s own table decides', () => {
    const custom: [number[], number[]] = [Array(64).fill(99), Array(64).fill(99)];
    const e = explain({ id: 'quantize.after', u: 1, v: 0 }, q({ customTables: custom }))!;
    expect(e.consequence).toMatch(/your table/);
    expect(explain({ id: 'quantize.table', u: 1, v: 0 }, q({ customTables: custom }))!.consequence).toMatch(/Your own table/);
  });

  it('shows a coefficient before rounding', () => {
    const e = explain({ id: 'quantize.before', u: 1, v: 0 }, q())!;
    expect(e.value).toBe('F(1,0) = −20.0');
    expect(e.consequence).toBe('Divided by its step of 16 it becomes −1.25.');
  });

  it('shows the rebuilt sample and its error', () => {
    const e = explain({ id: 'quantize.rebuild', x: 0, y: 0 }, q())!;
    expect(e.value).toMatch(/^\d+ \(error [+−]?\d+\)$/);
    expect(e.body).toMatch(/original was 100\./);
    expect(e.consequence).toMatch(/^At quality 50, it comes back/);
  });

  it('explains an editor cell and overrides nothing by itself', () => {
    const e = explain({ id: 'quantize.editor', u: 1, v: 0 }, q())!;
    expect(e.value).toBe('16');
    expect(e.acts).toBe(true);
    expect(e.consequence).toBe("Now: step 16, so this block's −20.0 becomes −1 × 16.");
  });

  it('reads a point on the rate-distortion curve', () => {
    const rd = [{ quality: 30, bytes: 3000, psnr: 33.2 }];
    const e = explain({ id: 'quantize.rd', quality: 30 }, makeContext({ rd }))!;
    expect(e.value).toMatch(/2\.9 KB.*33\.2 dB/);
    expect(e.consequence).toMatch(/You are at quality 50 \(4\.0 KB, 36\.5 dB\)/);
    expect(explain({ id: 'quantize.rd', quality: 31 }, makeContext({ rd }))).toBeNull();
  });

  it('shows the you-are-here dot from the summary', () => {
    const e = explain({ id: 'quantize.dot' }, q())!;
    expect(e.value).toBe('quality 50: 4.0 KB, 36.5 dB (higher is closer)');
    expect(e.consequence).toMatch(/times smaller than raw/);
    expect(e.consequence).not.toMatch(/1\//);
    expect(explain({ id: 'quantize.dot' }, q({ summary: null }))).toBeNull();
  });

  it('is null without a selected block', () => {
    expect(explain({ id: 'quantize.after', u: 0, v: 0 }, q({ summary: null }))).toBeNull();
  });

  it('uses the value the encoder stored, not a recomputed one', () => {
    const base = q();
    const quant = [...base.summary!.selected!.quant];
    quant[1] = -2; // contradicts -20 / 16, as a pretend encoder
    const ctx = { ...base, summary: { ...base.summary!, selected: { ...base.summary!.selected!, quant } } };
    expect(explain({ id: 'quantize.after', u: 1, v: 0 }, ctx)!.value).toBe('−2');
    expect(explain({ id: 'dct.coeff', u: 1, v: 0 }, ctx)!.consequence).toMatch(/rounds to −2 × 16/);
  });

  it('describes colour blocks as colour', () => {
    const cb = explain({ id: 'quantize.before', u: 0, v: 0 }, q({ component: 1 }))!;
    expect(cb.title).toBe('Average blue tint, before rounding');
    expect(cb.body).toMatch(/average blue tint/);
    expect(cb.body).not.toMatch(/brightness/);
    const cr = explain({ id: 'quantize.after', u: 0, v: 0 }, q({ component: 2 }))!;
    expect(cr.title).toBe('Average red tint, rounded');
    expect(JSON.stringify(explain({ id: 'quantize.table', u: 0, v: 0 }, q({ component: 1 }))!.details)).toMatch(/colour table/);
    expect(explain({ id: 'quantize.table', u: 0, v: 0 }, q())!.details[0]).toMatchObject({ text: expect.stringMatching(/brightness table/) });
  });

  it('never shows a quotient that looks like a tie but rounds the other way', () => {
    const base = q();
    const dct = [...base.summary!.selected!.dct];
    const quant = [...base.summary!.selected!.quant];
    dct[1] = -23.9999; // -1.49999 (a hair under a tie): stored -1
    quant[1] = -1;
    const near = { ...base, summary: { ...base.summary!, selected: { ...base.summary!.selected!, dct, quant } } };
    expect(explain({ id: 'quantize.after', u: 1, v: 0 }, near)!.consequence).toBe('At quality 50: −24.0 ÷ 16 ≈ −1.5 → rounds to −1 (kept).');
    dct[1] = -24; // exactly -1.5: halves go away from zero
    quant[1] = -2;
    expect(explain({ id: 'quantize.after', u: 1, v: 0 }, near)!.consequence).toBe('At quality 50: −24.0 ÷ 16 = −1.5 → rounds to −2 (kept).');
    dct[1] = -20; // far from a tie: two decimals as before
    quant[1] = -1;
    expect(explain({ id: 'quantize.after', u: 1, v: 0 }, near)!.consequence).toMatch(/= −1\.25 →/);
  });

  it('says an amount under half a step is rounded away', () => {
    expect(explain({ id: 'quantize.table', u: 1, v: 0 }, q())!.body).toMatch(/under half a step is rounded away/);
  });

  it('glosses dB once and notes the standard tables for the curve', () => {
    const rd = [{ quality: 30, bytes: 3000, psnr: 33.2 }];
    const e = explain({ id: 'quantize.rd', quality: 30 }, makeContext({ rd }))!;
    expect(e.value).toBe('2.9 KB, 33.2 dB (higher is closer)');
    const custom: [number[], number[]] = [Array(64).fill(16), Array(64).fill(16)];
    const c = explain({ id: 'quantize.rd', quality: 30 }, makeContext({ rd, customTables: custom }))!;
    expect(c.consequence).toMatch(/standard tables/);
    expect(c.consequence).not.toMatch(/smaller|bigger/);
    expect(JSON.stringify(c.details)).toMatch(/standard tables/);
    const dot = explain({ id: 'quantize.dot' }, q({ customTables: custom }))!;
    expect(dot.consequence).toMatch(/off the curve/);
  });

  it('never says "0% smaller"', () => {
    const rd = [{ quality: 49, bytes: 4096, psnr: 36.5 }];
    const e = explain({ id: 'quantize.rd', quality: 49 }, makeContext({ rd }))!;
    expect(e.consequence).toMatch(/about the same size and about as close/);
    expect(e.consequence).not.toMatch(/0%/);
  });
});
