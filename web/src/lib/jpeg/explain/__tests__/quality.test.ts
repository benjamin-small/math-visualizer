import { describe, expect, it } from 'vitest';
import { STD_CHROMA, STD_LUMA, ZIGZAG, roundHalfAway, scaleFactor, scaleTable, stepAtQuality, tableFor } from '../quality';
import { makeContext } from './fixture';

describe('IJG quality maths', () => {
  it('scales as the encoder does', () => {
    expect(scaleFactor(50)).toBe(100);
    expect(scaleFactor(20)).toBe(250);
    expect(scaleFactor(90)).toBe(20);
    expect(scaleTable(STD_LUMA, 50)).toEqual(STD_LUMA);
    expect(scaleTable(STD_LUMA, 100).every((v) => v === 1)).toBe(true);
    expect(scaleTable(STD_LUMA, 75)[0]).toBe(8);
    expect(scaleTable(STD_LUMA, 0)).toEqual(scaleTable(STD_LUMA, 1));
    expect(scaleTable(STD_LUMA, 1).every((v) => v <= 255 && v >= 160)).toBe(true);
  });

  it('copies the standard tables exactly', () => {
    expect(STD_LUMA).toHaveLength(64);
    expect(STD_CHROMA).toHaveLength(64);
    expect(STD_LUMA[0]).toBe(16);
    expect(STD_LUMA[63]).toBe(99);
    expect(STD_LUMA[10]).toBe(14);
    expect(STD_CHROMA[0]).toBe(17);
    expect(STD_CHROMA[63]).toBe(99);
    expect(STD_CHROMA[3]).toBe(47);
  });

  it('rounds halves away from zero', () => {
    expect(roundHalfAway(-0.5)).toBe(-1);
    expect(roundHalfAway(2.5)).toBe(3);
    expect(roundHalfAway(-1.25)).toBe(-1);
    expect(Object.is(roundHalfAway(-0.2), 0)).toBe(true);
  });

  it('picks the custom table when one is set', () => {
    expect(tableFor(makeContext(), 0)).toEqual(STD_LUMA);
    expect(tableFor(makeContext({ quality: 75 }), 1)[0]).toBe(scaleTable(STD_CHROMA, 75)[0]);
    const custom: [number[], number[]] = [Array(64).fill(3), Array(64).fill(7)];
    expect(tableFor(makeContext({ customTables: custom }), 0)[5]).toBe(3);
    expect(tableFor(makeContext({ customTables: custom }), 2)[5]).toBe(7);
  });

  it('is a permutation of 0-63 for the zigzag', () => {
    expect([...ZIGZAG].sort((a, b) => a - b)).toEqual(Array.from({ length: 64 }, (_, i) => i));
  });

  it('pins the zigzag order and agrees with the fixture\'s stored zigzag', () => {
    expect(ZIGZAG.slice(0, 6)).toEqual([0, 1, 8, 16, 9, 2]);
    const sel = makeContext().summary!.selected!;
    expect(ZIGZAG.map((i) => sel.quant[i])).toEqual(sel.zigzag);
    expect(sel.quant.map((q, i) => (q === roundHalfAway(sel.dct[i] / sel.table[i]) ? 0 : 1)).every((d) => d === 0)).toBe(true);
  });

  it('does not divide by zero at quality 100', () => {
    expect(stepAtQuality(0, 1, 16, 100, 20)).toBe(16); // not the standard entry at 100, and the scale is 0
    expect(stepAtQuality(0, 1, 1, 100, 20)).toBe(28); // the standard entry at 100 re-scales exactly
    expect(Number.isFinite(stepAtQuality(1, 5, 7, 100, 90))).toBe(true);
  });

  it('re-scales a step exactly for a standard table, in proportion otherwise', () => {
    expect(stepAtQuality(0, 1, 11, 50, 20)).toBe(28); // STD_LUMA[1] = 11, (11·250 + 50) / 100
    expect(stepAtQuality(0, 1, 16, 50, 20)).toBe(40); // not the standard entry: scaled by 250 / 100
    expect(stepAtQuality(0, 0, 16, 50, 100)).toBe(1);
  });
});
