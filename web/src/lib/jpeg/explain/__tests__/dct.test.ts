import { describe, expect, it } from 'vitest';
import { explain } from '..';
import { TARGET_IDS, scopeKey, type Target } from '../targets';
import { stepAtQuality } from '../quality';
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
    expect(e.consequence).toBe('At quality 50, 2 of these 2 stay non-zero after rounding.');
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

describe('near ties in the other-quality rows', () => {
  it('writes "÷ step ≈ x" for a hair under a tie, never "= ≈"', () => {
    const base = makeContext({ quality: 50 });
    // Quality 20 scales the step: find it, then put the amount a hair under 1.5 steps.
    const step = stepAtQuality(0, 1, base.summary!.selected!.table[1], 50, 20);
    const dct = [...base.summary!.selected!.dct];
    dct[1] = -(1.5 * step - 0.0001);
    const near = { ...base, summary: { ...base.summary!, selected: { ...base.summary!.selected!, dct } } };
    const all = JSON.stringify(explain({ id: 'dct.coeff', u: 1, v: 0 }, near)!.details);
    expect(all).not.toContain('= ≈');
    expect(all).toContain(`÷ ${step} ≈ −1.5 → −1 (kept)`);
  });
});

describe('the why-cosines seam', () => {
  /** A block whose busiest line is a row (or a column) with fractional ends: 10.4 to 14.2, a jump of 3.8. */
  function lineCtx(axis: 'row' | 'column', end = 14.2) {
    const ctx = makeContext();
    const line = [10.4, 30, 50, 70, 90, 110, 120, end];
    // Every row (or column) is the same line, so the busiest one is the first.
    const shifted = Array.from({ length: 64 }, (_, k) => line[axis === 'row' ? k % 8 : Math.floor(k / 8)]);
    const s = ctx.summary!;
    return { ...ctx, summary: { ...s, selected: { ...s.selected!, shifted } } };
  }

  it('rounds the jump it prints, with the unit from the rounded value', () => {
    const e = explain({ id: 'dct.cosines', chart: 'dft', i: 8 }, lineCtx('row'))!;
    expect(e.consequence).toContain('jumps 4 levels at every seam');
    expect(e.consequence).not.toMatch(/3\.8/);
    // A jump of 0.6 rounds to one level, and says "level".
    expect(explain({ id: 'dct.cosines', chart: 'dft', i: 8 }, lineCtx('row', 11))!.consequence).toContain('jumps 1 level at every seam');
  });

  it('says "row" or "column" in the details, as the busiest line is', () => {
    const word = (axis: 'row' | 'column', chart: 'dft' | 'dct') => {
      const e = explain({ id: 'dct.cosines', chart, i: 8 }, lineCtx(axis))!;
      return JSON.stringify(e.details.filter((d) => d.kind === 'text'));
    };
    expect(word('row', 'dft')).toMatch(/the row as one period/);
    expect(word('column', 'dft')).toMatch(/the column as one period/);
    expect(word('row', 'dct')).toMatch(/the row as mirrored/);
    expect(word('column', 'dct')).toMatch(/the column as mirrored/);
  });
});

/** The context with block coefficients replaced (and `quant` re-derived or given). */
function withBlock(ctx: ReturnType<typeof makeContext>, patch: { dct?: number[]; quant?: number[] }) {
  const s = ctx.summary!;
  return { ...ctx, summary: { ...s, selected: { ...s.selected!, ...patch } } };
}

describe('colour planes', () => {
  it('describes a Cb block\'s flat pattern as a blue tint', () => {
    const e = explain({ id: 'dct.coeff', u: 0, v: 0 }, makeContext({ component: 1 }))!;
    expect(e.title).toBe('Average blue tint');
    expect(e.body).toMatch(/average blue tint/);
    expect(e.body).toMatch(/Higher is bluer, lower is yellower/);
    expect(e.body).not.toMatch(/brightness|lighter|light and dark/);
  });

  it('describes a Cr block\'s flat pattern as a red tint', () => {
    const e = explain({ id: 'dct.coeff', u: 0, v: 0 }, makeContext({ component: 2 }))!;
    expect(e.title).toBe('Average red tint');
    expect(e.body).toMatch(/Higher is redder, lower is greener/);
    expect(e.body).not.toMatch(/brightness|lighter/);
  });

  it('does not talk about light and dark for colour patterns', () => {
    const neg = explain({ id: 'dct.coeff', u: 1, v: 0 }, makeContext({ component: 1 }))!;
    expect(neg.body).toMatch(/pattern \(1, 0\)/);
    expect(neg.body).toMatch(/colour swings the opposite way/);
    expect(neg.body).not.toMatch(/light and dark|swapped/);
    const atlasFlat = explain({ id: 'dct.atlas', u: 0, v: 0 }, makeContext({ component: 2 }))!;
    expect(atlasFlat.body).toMatch(/average red tint/);
    expect(atlasFlat.body).not.toMatch(/brightness/);
  });

  it('keeps the brightness wording for Y', () => {
    expect(explain({ id: 'dct.coeff', u: 0, v: 0 }, makeContext())!.body).toMatch(/Higher means a lighter block/);
  });
});

describe('near ties and zeros', () => {
  it('uses the "none of it" wording when the amount shows as 0.0', () => {
    const ctx = withBlock(makeContext(), { dct: Array.from({ length: 64 }, (_, i) => (i === 1 ? -0.01 : 0)) });
    const e = explain({ id: 'dct.coeff', u: 1, v: 0 }, ctx)!;
    expect(e.value).toBe('F(1,0) = 0.0');
    expect(e.body).toMatch(/none of it/);
    expect(e.body).not.toMatch(/Negative|swapped/);
  });
});

describe('explain() and targets', () => {
  it('returns null for an id no explainer knows', () => {
    // Synthetic ids, so the test does not change meaning as later tasks write the remaining explainers.
    expect(explain({ id: 'nowhere.at-all' } as unknown as Target, makeContext())).toBeNull();
    expect(explain({ id: 'dct.unknown', u: 0, v: 0 } as unknown as Target, makeContext())).toBeNull();
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
