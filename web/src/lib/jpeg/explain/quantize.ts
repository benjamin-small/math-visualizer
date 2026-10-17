// The Quantize stage's cards: a pattern's amount before rounding, its table
// step, what it rounds to, the rebuilt block, the table editor and the
// rate-distortion curve with its "you are here" dot.
import { formatBytes } from '../summary';
import { at, averageWord, blockOf, planeWord, quantized, rebuilt, validPattern, type BlockView } from './block';
import type { ExplainContext } from './context';
import { STD_CHROMA, STD_LUMA, roundHalfAway, scaleFactor, scaleTable, stepAtQuality } from './quality';
import type { Target } from './targets';
import { db, delta, plural, quotientEq, quotientValue, signed, whole } from './text';
import type { Detail, Explanation } from './types';

/** Said once per card, after the first dB figure. */
const GLOSS = ' (higher is closer)';

const texNum = (s: string) => s.replace('−', '-');

/** "Pattern (1, 0)", or "Average brightness" / "Average blue tint" / "Average red tint" for the flat one. */
function name(u: number, v: number, component: number): string {
  if (u !== 0 || v !== 0) return `Pattern (${u}, ${v})`;
  const w = averageWord(component);
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/** "At quality 50", or "With your table" when the reader's own tables decide. */
function lead(b: BlockView): string {
  return b.custom ? 'With your table' : `At quality ${b.quality}`;
}

function before(u: number, v: number, ctx: ExplainContext): Explanation | null {
  const b = blockOf(ctx);
  if (!b || !validPattern(u, v)) return null;
  const i = at(u, v);
  const f = b.sel.dct[i];
  const step = b.sel.table[i];
  return {
    title: `${name(u, v, b.sel.component)}, before rounding`,
    value: `F(${u},${v}) = ${signed(f)}`,
    body:
      i === 0
        ? `The exact amount of the block's ${averageWord(b.sel.component)}, with decimals. JPEG is about to round it.`
        : `The exact amount of pattern (${u}, ${v}) in this block, with decimals. JPEG is about to round it to a whole number of steps.`,
    consequence: `Divided by its step of ${step} it becomes ${quotientValue(f / step)}.`,
    details: [
      {
        kind: 'text',
        text: 'This is the output of the DCT. Rounding is where most of the picture is thrown away: the amount is divided by the table step and rounded to a whole number.',
      },
      {
        kind: 'rows',
        rows: [
          ['Amount', signed(f)],
          ['Step', String(step)],
          ['Amount ÷ step', quotientValue(f / step)],
          ['Rounded', whole(quantized(b, i))],
        ],
      },
    ],
  };
}

function tableCell(u: number, v: number, ctx: ExplainContext): Explanation | null {
  const b = blockOf(ctx);
  if (!b || !validPattern(u, v)) return null;
  const i = at(u, v);
  const step = b.sel.table[i];
  const base = b.sel.component === 0 ? STD_LUMA : STD_CHROMA;
  const plane = planeWord(b.sel.component);
  const details: Detail[] = [
    {
      kind: 'text',
      text: `Each of the 64 patterns has its own step. This is the ${plane} table. The steps grow towards the bottom right, where the fine, busy patterns are, because the eye notices them least.`,
    },
  ];
  if (!b.custom && scaleTable(base, b.quality)[i] === step) {
    const s = scaleFactor(b.quality);
    details.push({
      kind: 'rows',
      rows: [
        ['Standard table entry', String(base[i])],
        ['Scale at this quality', `${s}%`],
        ['Step used', String(step)],
      ],
    });
    details.push({
      kind: 'tex',
      tex: `\\left\\lfloor \\frac{${base[i]} \\cdot ${s} + 50}{100} \\right\\rfloor = ${step}`,
    });
  } else {
    details.push({
      kind: 'rows',
      rows: [
        ['Smallest step in this table', String(Math.min(...b.sel.table))],
        ['Largest step in this table', String(Math.max(...b.sel.table))],
        ['This step', String(step)],
      ],
    });
  }
  return {
    title: `Table step (${u}, ${v})`,
    value: String(step),
    body: `Pattern (${u}, ${v}) is counted in steps of ${step}: an amount under half a step is rounded away. Steps are larger for the busy, fine patterns because the eye notices them less.`,
    consequence: b.custom
      ? 'Your own table sets this step, so the quality slider does not change it.'
      : `At quality ${b.quality} every table entry is scaled to ${scaleFactor(b.quality)}% of the standard one, so this step is ${step}.`,
    details,
  };
}

function after(u: number, v: number, ctx: ExplainContext): Explanation | null {
  const b = blockOf(ctx);
  if (!b || !validPattern(u, v)) return null;
  const i = at(u, v);
  const f = b.sel.dct[i];
  const step = b.sel.table[i];
  const x = f / step;
  const r = quantized(b, i);
  const back = r * step;
  const zeros = b.sel.dct.filter((_, j) => quantized(b, j) === 0).length;
  const verdict = r !== 0 ? 'kept' : 'dropped';
  const lines: [string, string][] = [
    ['Before', signed(f)],
    ['Step', String(step)],
    ['Divided', quotientValue(x)],
    ['Stored', whole(r)],
    ['Decoder multiplies back', `${whole(r)} × ${step} = ${whole(back)}`],
    ['Off by', signed(back - f)],
  ];
  const details: Detail[] = [
    {
      kind: 'text',
      text: 'Only this whole number is stored. The decoder multiplies it by the step again, so what comes back is the nearest multiple of the step, not the original amount.',
    },
    { kind: 'rows', rows: lines },
    { kind: 'tex', tex: `\\operatorname{round}\\!\\left(\\frac{${texNum(signed(f))}}{${step}}\\right) = ${texNum(whole(r))}` },
    { kind: 'text', text: `${plural(zeros, 'pattern')} of this block's 64 round to zero and cost almost nothing to store.` },
  ];
  if (!b.custom && i !== 0) {
    const alt = b.quality > 20 ? 20 : 90;
    const s = stepAtQuality(b.sel.component, i, step, b.quality, alt);
    const y = roundHalfAway(f / s);
    details.push({
      kind: 'rows',
      rows: [[`At quality ${alt}`, `step ${s}: ${signed(f)} ÷ ${s} ${quotientEq(f / s)} → ${whole(y)} (${y !== 0 ? 'kept' : 'dropped'})`]],
    });
  }
  const closing = b.custom ? ' Your table sets the step, so quality does not change it.' : '';
  return {
    title: `${name(u, v, b.sel.component)}, rounded`,
    value: whole(r),
    body:
      r === 0
        ? `Pattern (${u}, ${v}) rounds to zero in this block, so it is thrown away.`
        : `What is stored for pattern (${u}, ${v}): the amount in whole steps. Zero would mean the pattern is thrown away.`,
    consequence: `${b.custom ? 'With your table' : `At quality ${b.quality}`}: ${signed(f)} ÷ ${step} ${quotientEq(x)} → rounds to ${whole(r)} (${verdict}).${closing}`,
    details,
  };
}

function rebuild(x: number, y: number, ctx: ExplainContext): Explanation | null {
  const b = blockOf(ctx);
  if (!b || !validPattern(x, y)) return null;
  const i = at(x, y);
  const grid = rebuilt(b);
  const now = grid[i];
  const original = b.sel.pixels.map(roundHalfAway); // whole, as the grid shows them
  const was = original[i];
  const err = now - was;
  const what = b.sel.component === 0 ? 'brightness' : 'colour value'; // planeWord, with "value" for a sample
  const all = grid.map((v, j) => Math.abs(v - original[j]));
  const mean = all.reduce((s, e) => s + e, 0) / 64;
  const worst = Math.max(...all);
  return {
    title: `Rebuilt sample (${x}, ${y})`,
    value: `${now} (error ${delta(err)})`,
    body: `The ${what} this sample gets back once the decoder undoes the rounding. The original was ${was}.`,
    consequence:
      err === 0
        ? `${lead(b)}, it comes back exactly.`
        : `${lead(b)}, it comes back ${Math.abs(err)} ${Math.abs(err) === 1 ? 'level' : 'levels'} ${err > 0 ? 'higher' : 'lower'}.`,
    details: [
      {
        kind: 'text',
        text: 'The decoder multiplies each stored number by its step, adds the 64 patterns back together, and shifts by 128. The difference from the original is the price of the rounding.',
      },
      {
        kind: 'rows',
        rows: [
          ['Original', String(was)],
          ['Rebuilt', String(now)],
          ['Error', delta(err)],
          ['Average error in this block', mean.toFixed(1)],
          ['Worst error in this block', String(worst)],
        ],
      },
    ],
  };
}

function editor(u: number, v: number, ctx: ExplainContext): Explanation | null {
  if (!validPattern(u, v)) return null;
  const i = at(u, v);
  const b = blockOf(ctx);
  const slot = (b?.sel.component ?? 0) === 0 ? 0 : 1;
  const step = ctx.customTables?.[slot][i] ?? b?.sel.table[i];
  if (step == null) return null;
  const rows: [string, string][] = [];
  let consequence = `Now: step ${step}.`;
  if (b) {
    const f = b.sel.dct[i];
    const r = roundHalfAway(f / step);
    consequence = `Now: step ${step}, so this block's ${signed(f)} becomes ${whole(r)}${r !== 0 ? ` × ${step}` : ''}.`;
    for (const s of [1, 255]) {
      const y = roundHalfAway(f / s);
      rows.push([`If the step were ${s}`, `${signed(f)} ÷ ${s} → ${whole(y)} (${y !== 0 ? 'kept' : 'dropped'})`]);
    }
  }
  const details: Detail[] = [
    {
      kind: 'text',
      text: 'Each cell is the step for one pattern. A bigger step rounds more of that pattern away: a smaller file and a rougher picture. A step of 1 keeps it almost exactly. Editing any cell makes the lab use your tables instead of the quality slider.',
    },
  ];
  if (rows.length) details.push({ kind: 'rows', rows });
  return {
    title: `Edit step (${u}, ${v})`,
    value: String(step),
    body: `Change how coarsely pattern (${u}, ${v}) is rounded. A bigger step throws more of it away; 1 keeps it nearly exact.`,
    consequence,
    acts: true,
    details,
  };
}

function rdPoint(quality: number, ctx: ExplainContext): Explanation | null {
  const p = ctx.rd.find((r) => r.quality === quality);
  if (!p) return null;
  const s = ctx.summary;
  const size = formatBytes(p.bytes);
  const custom = ctx.customTables !== null;
  let consequence: string | undefined;
  if (custom) {
    consequence = 'This curve is drawn for the standard tables; your own tables are not on it.';
  } else if (s && s.quality === p.quality) {
    consequence = 'This is where you are now.';
  } else if (s && s.bytes > 0) {
    const pct = Math.round((Math.abs(p.bytes - s.bytes) / s.bytes) * 100);
    const size2 = pct === 0 ? 'about the same size' : `${pct}% ${p.bytes < s.bytes ? 'smaller' : 'bigger'}`;
    const diff = s.psnr != null && Number.isFinite(s.psnr) && Number.isFinite(p.psnr) ? Math.abs(p.psnr - s.psnr) : null;
    const gap =
      diff == null ? '' : diff < 0.05 ? ' and about as close' : ` and ${diff.toFixed(1)} dB ${p.psnr < (s.psnr as number) ? 'lower' : 'higher'}`;
    consequence = `You are at quality ${s.quality ?? ctx.quality} (${formatBytes(s.bytes)}, ${db(s.psnr)}). This point is ${size2}${gap}.`;
  }
  const rows: [string, string][] = [
    ['Quality', String(p.quality)],
    ['File size', size],
    ['Closeness (PSNR)', db(p.psnr)],
  ];
  if (s && p.bytes > 0) {
    rows.push(['Compression', `${(s.rawBytes / p.bytes).toFixed(1)} : 1`]);
    rows.push(['Bits per pixel', ((8 * p.bytes) / Math.max(1, s.width * s.height)).toFixed(2)]);
  }
  return {
    title: `Quality ${p.quality}`,
    value: `${size}, ${db(p.psnr)}${GLOSS}`,
    body: `Encoding this picture at quality ${p.quality} makes a ${size} file whose copy scores ${db(p.psnr)}. Higher quality costs more bytes and looks closer.`,
    consequence,
    details: [
      {
        kind: 'text',
        text: 'Every point on this curve is a real encode and decode of this picture at that quality, so the curve is the trade of size against fidelity for this picture alone.',
      },
      ...(custom
        ? [{ kind: 'text', text: 'The curve is computed with the standard tables at each quality. While your own tables are in use, the lab\'s file does not sit on it.' } as Detail]
        : []),
      { kind: 'rows', rows },
    ],
  };
}

function dot(ctx: ExplainContext): Explanation | null {
  const s = ctx.summary;
  if (!s || s.bytes <= 0) return null;
  const q = s.quality ?? ctx.quality;
  const px = Math.max(1, s.width * s.height);
  const custom = ctx.customTables !== null;
  return {
    title: 'You are here',
    value: `quality ${q}: ${formatBytes(s.bytes)}, ${db(s.psnr)}${GLOSS}`,
    body: 'This dot is the picture as it is encoded now. Dragging the quality slider slides it along the curve.',
    consequence: custom
      ? 'Your own tables are in use, so this dot may sit off the curve, which is drawn for the standard tables.'
      : `The file is ${(s.rawBytes / s.bytes).toFixed(1)} times smaller than raw, ${((8 * s.bytes) / px).toFixed(2)} bits per pixel.`,
    details: [
      {
        kind: 'text',
        text: 'Left of the dot is a smaller, rougher file; right of it is a bigger, closer one. The curve flattens at the top: past a point, extra bytes buy almost no extra fidelity.',
      },
      {
        kind: 'rows',
        rows: [
          ['Quality', String(q)],
          ['File size', formatBytes(s.bytes)],
          ['Raw size', formatBytes(s.rawBytes)],
          ['Closeness (PSNR)', db(s.psnr)],
        ],
      },
    ],
  };
}

/** The Quantize stage's card for `t`, or null when it is not a Quantize target or the context lacks the data. */
export function explainQuantize(t: Target, ctx: ExplainContext): Explanation | null {
  switch (t.id) {
    case 'quantize.before':
      return before(t.u, t.v, ctx);
    case 'quantize.table':
      return tableCell(t.u, t.v, ctx);
    case 'quantize.after':
      return after(t.u, t.v, ctx);
    case 'quantize.editor':
      return editor(t.u, t.v, ctx);
    case 'quantize.rebuild':
      return rebuild(t.x, t.y, ctx);
    case 'quantize.rd':
      return rdPoint(t.quality, ctx);
    case 'quantize.dot':
      return dot(ctx);
    default:
      return null;
  }
}
