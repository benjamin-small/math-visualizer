import { describe, expect, it } from 'vitest';
import { explain } from '..';
import { TARGET_IDS, scopeKey } from '../targets';
import { makeContext } from './fixture';

describe('DCT cards', () => {
  it('explains a coefficient: value, plain meaning, what rounding does', () => {
    const e = explain({ id: 'dct.coeff', u: 1, v: 0 }, makeContext())!;
    expect(e.value).toBe('F(1,0) = −20.0');
    expect(e.body).toMatch(/pattern \(1, 0\)/);
    expect(e.body).toMatch(/one half-wave across/);
    expect(e.body).toMatch(/swapped/);
    expect(e.consequence).toBe('At quality 50 it rounds to −1 × 16: kept.');
    expect(e.details.some((d) => d.kind === 'pattern')).toBe(true);
    expect(JSON.stringify(e.details)).toMatch(/quality 20/);
  });

  it('says a coefficient that rounds to zero is dropped', () => {
    const e = explain({ id: 'dct.coeff', u: 3, v: 0 }, makeContext())!;
    expect(e.consequence).toMatch(/rounds to 0 × 16: dropped/);
  });

  it('calls the DC value the average brightness', () => {
    const e = explain({ id: 'dct.coeff', u: 0, v: 0 }, makeContext())!;
    expect(e.body).toMatch(/average brightness/);
    expect(e.value).toBe('F(0,0) = 120.0');
    expect(e.consequence).toBe('At quality 50 it rounds to 8 × 16: kept.');
  });

  it('describes patterns across and down, like the example', () => {
    const ctx = makeContext({
      summary: makeContext().summary && {
        ...makeContext().summary!,
        selected: { ...makeContext().summary!.selected!, dct: Array.from({ length: 64 }, (_, i) => (i === 10 ? -34.2 : 0)) },
      },
    });
    const e = explain({ id: 'dct.coeff', u: 2, v: 1 }, ctx)!;
    expect(e.value).toBe('F(2,1) = −34.2');
    expect(e.body).toBe(
      'How much of pattern (2, 1) is in this block: two half-waves across, one down. Negative means its light and dark are swapped.',
    );
    expect(explain({ id: 'dct.coeff', u: 0, v: 2 }, ctx)!.body).toMatch(/flat across, two half-waves down/);
  });

  it('follows a custom table instead of the quality', () => {
    const e = explain({ id: 'dct.coeff', u: 1, v: 0 }, makeContext({ customTables: [Array(64).fill(16), Array(64).fill(16)] }))!;
    expect(e.consequence).toMatch(/^With your table it rounds to/);
    expect(JSON.stringify(e.details)).not.toMatch(/At quality 20/);
  });

  it('returns null without a summary or a selected block', () => {
    expect(explain({ id: 'dct.coeff', u: 1, v: 0 }, makeContext({ summary: null }))).toBeNull();
    const s = makeContext().summary!;
    expect(explain({ id: 'dct.atlas', u: 1, v: 0 }, makeContext({ summary: { ...s, selected: null } }))).toBeNull();
    expect(explain({ id: 'dct.coeff', u: 8, v: 0 }, makeContext())).toBeNull();
  });

  it('tells the atlas pattern and this block\'s amount of it', () => {
    const e = explain({ id: 'dct.atlas', u: 1, v: 0 }, makeContext())!;
    expect(e.body).toMatch(/one half-wave across/);
    expect(e.consequence).toMatch(/−20\.0 of it/);
    expect(e.details.some((d) => d.kind === 'pattern')).toBe(true);
  });

  it('follows the k slider with the share of detail kept', () => {
    const none = explain({ id: 'dct.k' }, makeContext({ dctK: 0 }))!;
    expect(none.value).toBe('k = 0 of 64');
    expect(none.consequence).toMatch(/flat mid-grey/);
    const one = explain({ id: 'dct.k' }, makeContext({ dctK: 1 }))!;
    expect(one.consequence).toMatch(/first 1 pattern hold 9\d% /);
    expect(one.acts).toBe(true);
    expect(explain({ id: 'dct.k' }, makeContext({ dctK: 64 }))!.consequence).toMatch(/exactly/);
  });

  it('reads a point on the energy curve', () => {
    // DCT [120, −20, −20]: energy 14400 + 400 + 400; zigzag order 0, 1, 8 -> the first 2 hold 14800/15200
    const e = explain({ id: 'dct.energy', k: 2 }, makeContext())!;
    expect(e.value).toBe('97%');
    expect(e.body).toMatch(/first 2 patterns/);
    expect(e.consequence).toBe('At quality 50, 2 of these 2 survive rounding.');
    expect(explain({ id: 'dct.energy', k: 1 }, makeContext())!.body).toMatch(/first 1 pattern,/);
  });

  it('reads a point on the why-cosines charts', () => {
    const rep = explain({ id: 'dct.cosines', chart: 'dft', i: 8 }, makeContext())!;
    expect(rep.consequence).toMatch(/jumps \d+ levels? at every seam/);
    const mir = explain({ id: 'dct.cosines', chart: 'dct', i: 8 }, makeContext())!;
    expect(mir.consequence).toMatch(/no jump/);
    expect(explain({ id: 'dct.cosines', chart: 'nope', i: 0 }, makeContext())).toBeNull();
    expect(explain({ id: 'dct.cosines', chart: 'dft', i: 24 }, makeContext())).toBeNull();
  });
});

describe('explain() and targets', () => {
  it('returns null for ids whose explainer is not written yet', () => {
    expect(explain({ id: 'bezel.quality' }, makeContext())).toBeNull();
    expect(explain({ id: 'zigzag.last' }, makeContext())).toBeNull();
  });

  it('lists every id once', () => {
    expect(new Set(TARGET_IDS).size).toBe(TARGET_IDS.length);
    expect(TARGET_IDS).toContain('dct.coeff');
    expect(TARGET_IDS).toContain('decode.resave');
  });

  it('scopes a card to the picture, the stage and the block', () => {
    const t = { id: 'dct.k' } as const;
    const base = scopeKey(t, makeContext());
    expect(scopeKey(t, makeContext())).toBe(base);
    expect(scopeKey(t, makeContext({ imageId: 'doge' }))).not.toBe(base);
    expect(scopeKey(t, makeContext({ stage: 'quantize' }))).not.toBe(base);
    expect(scopeKey(t, makeContext({ quality: 20 }))).toBe(base);
    const s = makeContext().summary!;
    expect(scopeKey(t, makeContext({ summary: { ...s, selected: { ...s.selected!, bx: 3 } } }))).not.toBe(base);
    expect(scopeKey(t, makeContext({ summary: { ...s, selected: { ...s.selected!, component: 1 } } }))).not.toBe(base);
  });
});
