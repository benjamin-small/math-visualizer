import { describe, expect, it } from 'vitest';
import { TARGET_IDS, explain } from '..';
import { makeContext } from './fixture';

const text = (e: NonNullable<ReturnType<typeof explain>>) => [e.title, e.value, e.body, e.consequence].join(' ');

describe('Colour, subsample and blocks cards', () => {
  it('shows a block sample and its shifted value', () => {
    const e = explain({ id: 'blocks.cell', x: 0, y: 0 }, makeContext({ stage: 'blocks' }))!;
    expect(e.value).toBe('100');
    expect(e.consequence).toContain('−128 → −28');
    expect(e.body).toContain('block (21, 17)');
    expect(explain({ id: 'blocks.cell', x: 8, y: 0 }, makeContext())).toBeNull();
  });

  it('says where a colour block sits in the picture', () => {
    const e = explain({ id: 'blocks.cell', x: 1, y: 1 }, makeContext({ stage: 'blocks', component: 1 }))!;
    expect(e.body).toContain('Cb plane');
    expect(e.body).toContain('2 × 2 picture pixels');
    expect(e.body).toContain('(338, 274)'); // block (21, 17) * 16 + one cell * 2
  });

  it('names the plane being followed and its block', () => {
    const e = explain({ id: 'blocks.component' }, makeContext({ stage: 'blocks' }))!;
    expect(e.acts).toBe(true);
    expect(e.value).toBe('Y plane, block (21, 17)');
    expect(e.consequence).toContain('32 × 32 blocks');
    const cb = explain({ id: 'blocks.component' }, makeContext({ stage: 'blocks', component: 1 }))!;
    expect(cb.consequence).toContain('x 336-351, y 272-287');
  });

  it('explains the shift with this block\'s range', () => {
    const e = explain({ id: 'blocks.shift' }, makeContext({ stage: 'blocks' }))!;
    expect(e.acts).toBe(true);
    expect(e.consequence).toContain('runs from 100 to 142');
    expect(e.consequence).toContain('−28 to 14');
  });

  it('says how many samples a coded colour sample was averaged from', () => {
    const e = explain({ id: 'subsample.plane', which: 'coded', plane: 1, x: 10, y: 10 }, makeContext({ stage: 'subsample' }))!;
    expect(e.body).toContain('averaged from 4 samples (2 × 2)');
    const half = explain({ id: 'subsample.plane', which: 'coded', plane: 1, x: 10, y: 10 }, makeContext({ subsampling: '422', summary: null }))!;
    expect(half.body).toContain('averaged from 2 samples (2 × 1)');
    const exact = explain({ id: 'subsample.plane', which: 'coded', plane: 2, x: 10, y: 10 }, makeContext({ summary: { ...makeContext().summary!, subsampling: '444' } }))!;
    expect(exact.body).toContain('nothing is shared');
  });

  it('says what the full plane will be averaged into', () => {
    const e = explain({ id: 'subsample.plane', which: 'full', plane: 2, x: 3, y: 3 }, makeContext({ stage: 'subsample' }))!;
    expect(e.body).toContain('averaged with 3 neighbours (2 × 2)');
    expect(e.value).toMatch(/^Cr = \d+$/);
  });

  it('gives the share of samples kept', () => {
    const e = explain({ id: 'subsample.kept' }, makeContext({ stage: 'subsample' }))!;
    expect(e.value).toBe('50% of all samples');
    expect(e.consequence).toBe('At 4:2:0, 98,304 of this picture\'s 196,608 samples are stored.');
    const full = explain({ id: 'subsample.kept' }, makeContext({ summary: { ...makeContext().summary!, subsampling: '444' } }))!;
    expect(full.value).toBe('100% of all samples');
  });

  it('reads a plane value for a pixel', () => {
    const e = explain({ id: 'color.plane', plane: 0, x: 0, y: 0 }, makeContext({ stage: 'color' }))!;
    expect(e.value).toBe('Y = 200'); // the fixture picture is a flat 200 grey
    expect(explain({ id: 'color.plane', plane: 1, x: 0, y: 0 }, makeContext())!.value).toBe('Cb = 128');
    expect(explain({ id: 'color.plane', plane: 2, x: 999, y: 0 }, makeContext())).toBeNull();
  });

  it('describes the colour cube and the grey diagonal', () => {
    const e = explain({ id: 'color.cube' }, makeContext({ stage: 'color' }))!;
    expect(e.body).toContain('grey diagonal');
    expect(e.value).toBe('65,536 pixels, one point each');
    expect(e.consequence).toContain('About 100% of this picture\'s pixels sit close to the grey diagonal');
  });

  it('describes the axes slider with the picture\'s spread', () => {
    const e = explain({ id: 'color.axes' }, makeContext({ stage: 'color' }))!;
    expect(e.acts).toBe(true);
    expect(e.consequence).toBe('In this picture brightness spans about 0 levels, the blue tint about 0 and the red tint about 0.');
  });

  it('gives every early target a card with the three lines or says nothing', () => {
    const ctx = makeContext();
    const samples = [
      { id: 'color.cube' },
      { id: 'color.axes' },
      { id: 'color.plane', plane: 1, x: 1, y: 1 },
      { id: 'subsample.plane', which: 'full', plane: 1, x: 1, y: 1 },
      { id: 'subsample.kept' },
      { id: 'blocks.cell', x: 2, y: 3 },
      { id: 'blocks.component' },
      { id: 'blocks.shift' },
    ] as const;
    for (const t of samples) {
      const e = explain(t, ctx)!;
      expect(e, t.id).toBeTruthy();
      expect(e.body.length).toBeGreaterThan(20);
      expect(e.consequence, t.id).toBeTruthy();
      expect(text(e)).not.toMatch(/undefined|NaN|\[object/);
    }
    expect(TARGET_IDS).toContain('blocks.cell');
  });

  it('gives nothing without a picture or block', () => {
    const none = makeContext({ summary: null, image: null });
    expect(explain({ id: 'blocks.cell', x: 0, y: 0 }, none)).toBeNull();
    expect(explain({ id: 'color.plane', plane: 0, x: 0, y: 0 }, none)).toBeNull();
    expect(explain({ id: 'subsample.kept' }, none)!.value).toBe('50% of all samples');
  });
});
