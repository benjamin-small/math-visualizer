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
    expect(e.body).toMatch(/original was 100/);
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
    expect(e.value).toBe('quality 50: 4.0 KB, 36.5 dB');
    expect(explain({ id: 'quantize.dot' }, q({ summary: null }))).toBeNull();
  });

  it('is null without a selected block', () => {
    expect(explain({ id: 'quantize.after', u: 0, v: 0 }, q({ summary: null }))).toBeNull();
  });
});
