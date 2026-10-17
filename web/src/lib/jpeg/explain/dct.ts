// The DCT stage's cards: a pattern's amount in this block, the atlas of
// patterns, the k slider, the energy curve and the "why cosines?" charts.
import { cumulativeEnergy, busiestLine, mirrored, periodic } from '../math';
import { at, blockOf, quantized, shareOf, survivors, validPattern, type BlockView } from './block';
import type { ExplainContext } from './context';
import { ZIGZAG, roundHalfAway, stepAtQuality } from './quality';
import type { Target } from './targets';
import { delta, percent, plural, ratio, signed, whole, word } from './text';
import type { Detail, Explanation } from './types';

/** `one half-wave across`, `two half-waves across`, or `flat across`. */
function across(u: number): string {
  return u === 0 ? 'flat across' : `${word(u)} half-wave${u > 1 ? 's' : ''} across`;
}

/** `one down` (after an `across` that already said "half-wave"), or the full phrase when nothing was said across. */
function down(u: number, v: number): string {
  if (v === 0) return 'flat down';
  return u === 0 ? `${word(v)} half-wave${v > 1 ? 's' : ''} down` : `${word(v)} down`;
}

/** The pattern in words: "two half-waves across, one down". */
export function patternWords(u: number, v: number): string {
  return u === 0 && v === 0 ? 'the same everywhere' : `${across(u)}, ${down(u, v)}`;
}

/** The "another quality" rows for one pattern, or a note that the reader's own table ignores quality. */
function otherQualities(b: BlockView, i: number, f: number): Detail[] {
  if (b.custom) {
    return [{ kind: 'text', text: 'Your own table is in use, so quality changes nothing here until you go back to the standard tables.' }];
  }
  const component = b.sel.component;
  const alts = [b.quality > 20 ? 20 : b.quality > 5 ? 5 : 0, 90].filter((q) => q > 0 && q !== b.quality);
  const rows: [string, string][] = alts.map((q) => {
    const step = stepAtQuality(component, i, b.sel.table[i], b.quality, q);
    const x = f / step;
    const r = roundHalfAway(x);
    return [`At quality ${q}`, `step ${step}: ${signed(f)} ÷ ${step} = ${ratio(x)} → ${whole(r)} (${r !== 0 ? 'kept' : 'dropped'})`];
  });
  return [{ kind: 'text', text: 'The same amount, rounded at another quality:' }, { kind: 'rows', rows }];
}

/** The unfolded part shared by the coefficient and atlas cards. */
function coefficientDetails(b: BlockView, u: number, v: number): Detail[] {
  const i = at(u, v);
  const f = b.sel.dct[i];
  const step = b.sel.table[i];
  const q = quantized(b, i);
  return [
    { kind: 'pattern', u, v },
    {
      kind: 'text',
      text:
        'The DCT rewrites the 8 × 8 block as a sum of 64 fixed patterns, each scaled by an amount. This is the amount for this pattern; adding all 64 back up rebuilds the block exactly.',
    },
    {
      kind: 'rows',
      rows: [
        ['Amount in this block', `F(${u},${v}) = ${signed(f)}`],
        ["Share of the block's detail", percent(shareOf(b.sel.dct, i))],
        ['Step in the table', String(step)],
        ['Amount ÷ step', ratio(f / step)],
        ['Rounded', whole(q)],
      ],
    },
    { kind: 'tex', tex: `\\operatorname{round}\\!\\left(\\frac{${signed(f).replace('−', '-')}}{${step}}\\right) = ${whole(q).replace('−', '-')}` },
    ...otherQualities(b, i, f),
  ];
}

/** What the rounding step does to this amount, as the one line every coefficient card ends on. */
function roundsTo(b: BlockView, i: number): string {
  const q = quantized(b, i);
  const step = b.sel.table[i];
  const lead = b.custom ? 'With your table' : `At quality ${b.quality}`;
  return `${lead} it rounds to ${whole(q)} × ${step}: ${q !== 0 ? 'kept' : 'dropped'}.`;
}

function coefficient(u: number, v: number, ctx: ExplainContext): Explanation | null {
  const b = blockOf(ctx);
  if (!b || !validPattern(u, v)) return null;
  const i = at(u, v);
  const f = b.sel.dct[i];
  let body: string;
  if (i === 0) {
    const mean = Math.round(f / 8 + 128);
    body = `The block's average brightness: about ${mean} on the 0-255 scale (pattern (0, 0) is flat, the same everywhere). Higher means a lighter block.`;
  } else {
    const sign =
      f < 0
        ? 'Negative means its light and dark are swapped.'
        : f > 0
          ? 'Positive means it lines up with the pattern as drawn.'
          : 'Zero means this block has none of it.';
    body = `How much of pattern (${u}, ${v}) is in this block: ${patternWords(u, v)}. ${sign}`;
  }
  return {
    title: i === 0 ? 'Average brightness' : `Pattern (${u}, ${v})`,
    value: `F(${u},${v}) = ${signed(f)}`,
    body,
    consequence: roundsTo(b, i),
    details: coefficientDetails(b, u, v),
  };
}

function atlas(u: number, v: number, ctx: ExplainContext): Explanation | null {
  const b = blockOf(ctx);
  if (!b || !validPattern(u, v)) return null;
  const i = at(u, v);
  const f = b.sel.dct[i];
  const what =
    i === 0
      ? 'The flat pattern: every pixel the same. Its amount is the block\'s average brightness.'
      : `What pattern (${u}, ${v}) looks like: ${patternWords(u, v)}. Every 8 × 8 block is a sum of these 64 patterns.`;
  return {
    title: i === 0 ? 'Flat pattern' : `Pattern (${u}, ${v})`,
    value: `F(${u},${v}) = ${signed(f)}`,
    body: what,
    consequence: `This block holds ${signed(f)} of it, ${percent(shareOf(b.sel.dct, i))} of its detail. ${roundsTo(b, i)}`,
    details: coefficientDetails(b, u, v),
  };
}

function kSlider(ctx: ExplainContext): Explanation | null {
  const b = blockOf(ctx);
  if (!b) return null;
  const k = Math.min(64, Math.max(0, Math.round(ctx.dctK)));
  const energy = cumulativeEnergy(b.sel.dct, ZIGZAG);
  const share = k > 0 ? energy[k - 1] : 0;
  const keep = survivors(b);
  const consequence =
    k === 0
      ? 'With none kept the block rebuilds as flat mid-grey.'
      : k >= 64
        ? 'All 64 patterns put the block back exactly. The loss comes later, at the rounding step.'
        : `The first ${plural(k, 'pattern')} hold ${percent(share)} of this block's detail.`;
  return {
    title: 'Patterns kept',
    value: `k = ${k} of 64`,
    body: 'How many of the 64 patterns rebuild the block, counting from the flattest. Fewer patterns means a blurrier copy.',
    consequence,
    acts: true,
    details: [
      {
        kind: 'text',
        text: 'The patterns are taken in zigzag order: flat first, then slowly changing, then fine and busy. The curve below the picture shows how quickly they add up to the whole block.',
      },
      {
        kind: 'rows',
        rows: [
          ['Patterns kept', `${k} of 64`],
          ["Share of the block's detail", k > 0 ? percent(share) : '0%'],
          [b.custom ? 'Survive your table' : `Survive rounding at quality ${b.quality}`, `${keep} of 64`],
        ],
      },
    ],
  };
}

function energyPoint(k: number, ctx: ExplainContext): Explanation | null {
  const b = blockOf(ctx);
  if (!b || !Number.isFinite(k)) return null;
  const n = Math.min(64, Math.max(1, Math.round(k)));
  const share = cumulativeEnergy(b.sel.dct, ZIGZAG)[n - 1];
  const kept = survivors(b, ZIGZAG.slice(0, n));
  const lead = b.custom ? 'With your table' : `At quality ${b.quality}`;
  return {
    title: `First ${plural(n, 'pattern')}`,
    value: percent(share),
    body: `The first ${plural(n, 'pattern')}, counted from the flattest, hold ${percent(share)} of this block's detail (its energy).`,
    consequence: `${lead}, ${kept} of these ${n} survive rounding.`,
    details: [
      {
        kind: 'text',
        text: 'The curve climbs steeply when a block is mostly smooth: a few patterns carry nearly everything, which is what makes dropping the busy ones cheap.',
      },
      {
        kind: 'rows',
        rows: [
          ['Patterns counted', `${n} of 64`],
          ["Share of the block's detail", percent(share)],
          ['Left for the other patterns', percent(1 - share)],
        ],
      },
    ],
  };
}

function cosines(chart: string, i: number, ctx: ExplainContext): Explanation | null {
  const b = blockOf(ctx);
  const repeated = chart === 'dft' || chart === 'repeated';
  const reflected = chart === 'dct' || chart === 'mirrored';
  if (!b || (!repeated && !reflected) || !Number.isInteger(i) || i < 0 || i >= 24) return null;
  const line = busiestLine(b.sel.shifted);
  const series = repeated ? periodic(line.values, 3) : mirrored(line.values, 3);
  const v = series[i];
  const jump = Math.abs(line.values[7] - line.values[0]);
  const which = `${line.axis === 'row' ? 'Row' : 'Column'} ${line.index + 1}`;
  const level = v === 0 ? 'exactly mid-grey' : `${whole(Math.abs(v))} levels ${v > 0 ? 'above' : 'below'} mid-grey`;
  return {
    title: repeated ? 'Repeated copy' : 'Mirrored copy',
    value: whole(v),
    body: `${which} of this block, ${repeated ? 'repeated end to end' : 'mirrored at each end'}: this point is ${level}.`,
    consequence: repeated
      ? `Repeating it jumps ${jump} ${jump === 1 ? 'level' : 'levels'} at every seam (${whole(line.values[7])} to ${whole(line.values[0])}), and a jump needs many waves to draw.`
      : 'Mirroring has no jump at the seams, so far fewer waves are needed to draw it.',
    details: [
      {
        kind: 'text',
        text: repeated
          ? 'The Fourier transform treats the row as one period of an endless repeat. Where the end does not match the start, the repeat jumps, and the jump spreads energy over many frequencies.'
          : 'The cosine transform treats the row as mirrored at each end, so the edges always join smoothly. That is why JPEG uses cosines: most of the energy lands in a few terms.',
      },
      {
        kind: 'rows',
        rows: [
          ['Line', which],
          ['Point', `${(i % 8) + 1} of 8, copy ${Math.floor(i / 8) + 1} of 3`],
          ['Value (shifted by −128)', whole(v)],
          ['First to last sample', `${whole(line.values[0])} to ${whole(line.values[7])} (${delta(line.values[7] - line.values[0])})`],
        ],
      },
    ],
  };
}

/** The DCT stage's card for `t`, or null when it is not a DCT target or the context lacks the data. */
export function explainDct(t: Target, ctx: ExplainContext): Explanation | null {
  switch (t.id) {
    case 'dct.coeff':
      return coefficient(t.u, t.v, ctx);
    case 'dct.atlas':
      return atlas(t.u, t.v, ctx);
    case 'dct.k':
      return kSlider(ctx);
    case 'dct.energy':
      return energyPoint(t.k, ctx);
    case 'dct.cosines':
      return cosines(t.chart, t.i, ctx);
    default:
      return null;
  }
}
