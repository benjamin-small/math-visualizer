// The coding stages' cards: the zigzag grid and sequence, the run-length
// tokens, and the Huffman tables, bars, leaves, cost line, block bits and file
// segments. Everything is worked out from the context, never by encoding.
import { lastNonZero } from '../formulas';
import { TABLE_LABELS, symbolLabel, type HuffTableView } from '../huffman';
import type { AcToken, SelectedBlock } from '../summary';
import { at, blockOf, quantized, validPattern, type BlockView } from './block';
import type { ExplainContext } from './context';
import { ZIGZAG } from './quality';
import type { Target } from './targets';
import { percent, plural, whole } from './text';
import type { Detail, Explanation } from './types';

const count = (n: number) => n.toLocaleString('en-US');

/** `32.5`, `42,988.2`, `48`: up to one decimal, with thousands separators. */
const oneDecimal = (x: number) => x.toLocaleString('en-US', { maximumFractionDigits: 1 });

/** `1 time`, `4,133 times`. */
const times = (n: number) => `${count(n)} ${n === 1 ? 'time' : 'times'}`;

/** "At quality 50", or "With your table" when the reader's own tables decide. */
function lead(b: BlockView): string {
  return b.custom ? 'With your table' : `At quality ${b.quality}`;
}

/** The rounded block in scan order: the encoder's own sequence when the summary has it. */
const zigzagOf = (b: BlockView): number[] => (b.sel.zigzag.length === 64 ? b.sel.zigzag : ZIGZAG.map((i) => quantized(b, i)));

// --- Zigzag -------------------------------------------------------------------------

function zigzagGrid(u: number, v: number, ctx: ExplainContext): Explanation | null {
  const b = blockOf(ctx);
  if (!b || !validPattern(u, v)) return null;
  const i = at(u, v);
  const k = ZIGZAG.indexOf(i);
  const q = quantized(b, i);
  const last = lastNonZero(zigzagOf(b));
  return {
    title: `Pattern (${u}, ${v}) in the scan`,
    value: `#${k + 1} of 64`,
    body: 'The scan reads the 8 × 8 grid along zigzag diagonals, from the block\'s average at the top left to the finest detail at the bottom right. That puts the numbers most likely to be zero together at the end.',
    consequence: `${lead(b)} this one rounds to ${whole(q)}${k > last ? ', and it sits in the zero tail' : ''}.`,
    details: [
      { kind: 'pattern', u, v },
      {
        kind: 'text',
        text: 'Low-frequency patterns come first because they carry most of a block, so the rounded numbers tend to shrink as the scan goes on.',
      },
    ],
  };
}

function zigzagSeq(k: number, ctx: ExplainContext): Explanation | null {
  const b = blockOf(ctx);
  if (!b || !Number.isInteger(k) || k < 0 || k > 63) return null;
  const i = ZIGZAG[k];
  const [u, v] = [i % 8, Math.floor(i / 8)];
  const seq = zigzagOf(b);
  const q = seq[k];
  const last = lastNonZero(seq);
  let consequence: string;
  if (k > last) {
    consequence =
      last < 0
        ? 'This number is in the zero tail: all 64 numbers rounded to zero, so the next step stores nothing but an end-of-block mark.'
        : `This number is in the zero tail: nothing non-zero comes after #${last + 1}, so the next step replaces everything from #${last + 2} on with one end-of-block mark.`;
  } else if (q === 0) {
    consequence = `A zero, but a non-zero number comes later (#${last + 1}), so it is still counted, inside a run of zeros.`;
  } else {
    consequence = `${lead(b)} it stays non-zero after rounding, so its value goes into the file.`;
  }
  return {
    title: `Number #${k + 1} in the scan`,
    value: whole(q),
    body: `Position #${k + 1} of 64: the rounded amount of pattern (${u}, ${v}).`,
    consequence,
    details: [
      { kind: 'pattern', u, v },
      {
        kind: 'rows',
        rows: [
          ['Position in the scan', `#${k + 1} of 64`],
          ['Pattern', `(${u}, ${v})`],
          ['Rounded value', whole(q)],
        ],
      },
    ],
  };
}

function zigzagLast(ctx: ExplainContext): Explanation | null {
  const b = blockOf(ctx);
  if (!b) return null;
  const seq = zigzagOf(b);
  const last = lastNonZero(seq);
  const body =
    'The position of the last number that stays non-zero after rounding. Everything after it is zero and is not written out: one end-of-block mark stands in for all of it.';
  if (last < 0) {
    return {
      title: 'Last non-zero number',
      value: 'All 64 are zero',
      body,
      consequence: `${lead(b)} every number in this block rounds to zero, so only the end-of-block mark remains.`,
      details: [{ kind: 'text', text: 'A block like this is flat: it costs only a few bits.' }],
    };
  }
  return {
    title: 'Last non-zero number',
    value: `#${last + 1} of 64`,
    body,
    consequence: `${lead(b)} ${plural(63 - last, 'number')} after it ${63 - last === 1 ? 'is' : 'are'} zero and dropped from the file.`,
    details: [
      {
        kind: 'text',
        text: 'The earlier the last non-zero number, the fewer tokens this block needs. A lower quality moves it earlier.',
      },
      { kind: 'rows', rows: [['Non-zero numbers', String(seq.filter((x) => x !== 0).length)], ['Zeros in the tail', String(63 - last)]] },
    ],
  };
}

// --- Run-length ---------------------------------------------------------------------

type TokenKind = 'eob' | 'zrl' | 'run';

function kindOf(t: AcToken): TokenKind {
  if (t.size === 0 && t.run === 0) return 'eob';
  if (t.size === 0 && t.run === 15) return 'zrl';
  return 'run';
}

/** Where in the scan token `i`'s number sits (0-63): each earlier token used up its zeros and one number. */
function scanPosition(tokens: readonly AcToken[], i: number): number | null {
  let pos = 1;
  for (let j = 0; j < i; j++) pos += tokens[j].run + 1;
  const k = pos + (kindOf(tokens[i]) === 'run' ? tokens[i].run : 0);
  return k >= 0 && k <= 63 ? k : null; // a malformed token list can run past the block
}

/** The table mode in words, for the code lines. */
const tablesWord = (ctx: ExplainContext) => (ctx.huffman === 'optimized' ? 'optimized' : 'standard');

function token(i: number, ctx: ExplainContext): Explanation | null {
  const sel = ctx.summary?.selected;
  const t = sel?.tokens[i];
  if (!sel || !t || !Number.isInteger(i)) return null;
  const kind = kindOf(t);
  const bits = `${t.code}${t.ampBits}`;
  const written = `Written as ${plural(bits.length, 'bit')}: the ${tablesWord(ctx)} code ${t.code}${t.ampBits ? `, then ${t.ampBits}` : ''}.`;
  const rows: [string, string][] = [
    ['Symbol (run / size)', symbolLabel('ac', t.symbol)],
    ['Huffman code', t.code],
  ];
  if (t.ampBits) rows.push(['Amplitude bits', t.ampBits]);
  const details: Detail[] = [];
  let title: string;
  let value: string;
  let body: string;
  if (kind === 'eob') {
    title = 'End of block';
    value = 'End of block';
    body = 'A single mark that says every remaining number is zero, so the rest of the block needs nothing more.';
  } else if (kind === 'zrl') {
    title = 'Sixteen zeros';
    value = 'ZRL: sixteen zeros in a row';
    body = 'A run of sixteen zeros that is not yet followed by a number. The tokens after it carry on from there.';
  } else {
    const k = scanPosition(sel.tokens, i);
    title = `Token ${i + 1}`;
    value = `Skip ${plural(t.run, 'zero')}, then ${whole(t.amp)} (needs ${plural(t.size, 'bit')})`;
    body = `After ${plural(t.run, 'zero')} comes the number ${whole(t.amp)}, which fits in ${plural(t.size, 'bit')}. The zeros are not written one by one: their count goes inside the token's code.`;
    rows.push(['Number', whole(t.amp)]);
    if (k !== null) rows.push(['Place in the scan', `#${k + 1} of 64, pattern (${ZIGZAG[k] % 8}, ${Math.floor(ZIGZAG[k] / 8)})`]);
    details.push({
      kind: 'text',
      text: `The size is the number of bits the value needs. A larger value needs more bits, and the sign is carried in the bits themselves: a negative value is written as its positive twin with the bits flipped.`,
    });
  }
  details.push({ kind: 'rows', rows });
  return { title, value, body, consequence: written, details };
}

function dc(ctx: ExplainContext): Explanation | null {
  const b = blockOf(ctx);
  if (!b) return null;
  const { sel } = b;
  const mine = quantized(b, 0);
  const prev = sel.dcPrev < 0 ? `(${whole(sel.dcPrev)})` : whole(sel.dcPrev);
  return {
    title: 'The DC chip',
    value: `${whole(mine)} − ${prev} = ${whole(sel.dcDiff)}`,
    body: 'The first number of a block is its average. It is stored as the change from the previous block\'s average: neighbouring blocks tend to be alike, so the change is small and needs few bits.',
    consequence:
      sel.dcSize === 0
        ? `No change at all from the previous block (${prev}), so it needs no value bits: just the ${tablesWord(ctx)} code ${sel.dcCode}.`
        : `A change of ${whole(sel.dcDiff)} needs ${plural(sel.dcSize, 'bit')}: the ${tablesWord(ctx)} code ${sel.dcCode}, then ${sel.dcAmpBits}.`,
    details: [
      {
        kind: 'text',
        text: 'DC stands for the block\'s flat, average part. AC is the name for everything else, the 63 numbers that follow it.',
      },
      {
        kind: 'rows',
        rows: [
          ['This block\'s average', whole(mine)],
          ['Previous block\'s average', whole(sel.dcPrev)],
          ['Change', whole(sel.dcDiff)],
          ['Size (bits needed)', String(sel.dcSize)],
          ['Huffman code', sel.dcCode],
          ['Amplitude bits', sel.dcAmpBits || 'none'],
        ],
      },
    ],
  };
}

function bitCounts(ctx: ExplainContext): Explanation | null {
  const b = blockOf(ctx);
  if (!b) return null;
  const { sel } = b;
  const n = sel.bits.length;
  const tokens = sel.tokens.length + 1;
  return {
    title: 'Bits for this block',
    value: `${plural(tokens, 'token')}, ${plural(n, 'bit')}`,
    body: 'The block\'s 64 numbers are rewritten as a few tokens. Each token is a Huffman code (orange) followed by the bits of its value (blue). The fewer and shorter the tokens, the smaller the file.',
    consequence: `${lead(b)} this block costs ${plural(n, 'bit')} instead of the 512 its 64 samples would take as plain bytes.`,
    details: [
      {
        kind: 'rows',
        rows: [
          ['Tokens (the DC change counts as one)', String(tokens)],
          ['Bits', String(n)],
          ['As plain bytes', '512 bits'],
        ],
      },
    ],
  };
}

// --- Huffman ---------------------------------------------------------------------------------

/** What a symbol stands for, in words. */
function symbolWords(table: string, symbol: number): string {
  if (table.startsWith('dc')) {
    const s = symbol;
    return s === 0 ? "no change in the block's average" : `a change in the block's average that needs ${plural(s, 'bit')}`;
  }
  if (symbol === 0x00) return 'end of block: every remaining number is zero';
  if (symbol === 0xf0) return 'sixteen zeros in a row';
  return `skip ${plural(symbol >> 4, 'zero')}, then a number that needs ${plural(symbol & 15, 'bit')}`;
}

/** The brightness or the colour planes, from a table's name. */
const tablePlane = (name: string) => (name.endsWith('luma') ? 'brightness' : 'colour');

function tableOf(ctx: ExplainContext, index: number): HuffTableView | null {
  return Number.isInteger(index) ? (ctx.huffTables[index] ?? null) : null;
}

const total = (t: HuffTableView) => t.counts.reduce((s, [, n]) => s + n, 0);

function huffTab(index: number, ctx: ExplainContext): Explanation | null {
  const t = tableOf(ctx, index);
  if (!t) return null;
  const dcTable = t.name.startsWith('dc');
  const plane = tablePlane(t.name);
  const uses = total(t);
  return {
    title: TABLE_LABELS[t.name] ?? t.name,
    value: `${plural(t.vals.length, 'symbol')} with a code`,
    body: dcTable
      ? `This table codes each ${plane} block's average, stored as a change from the previous block. A symbol just says how many bits that change needs.`
      : `This table codes the fine detail of each ${plane} block. A symbol says how many zeros to skip and how many bits the next number needs.`,
    consequence: `${ctx.huffman === 'optimized' ? 'Optimized: built from this picture\'s own counts. ' : 'Standard: the example table from the JPEG specification. '}This picture uses ${t.counts.length} of its symbols, ${count(uses)} times in all.`,
    acts: true,
    details: [
      {
        kind: 'text',
        text: 'JPEG keeps four code tables: one each for the block averages and the detail, for brightness and for colour. Each gives short codes to the symbols that appear most.',
      },
      { kind: 'rows', rows: [['Symbols with a code', String(t.vals.length)], ['Symbols this picture uses', String(t.counts.length)], ['Uses in total', count(uses)]] },
    ],
  };
}

/** The code of `symbol` in `t`, or null when the table has none. */
const codeOf = (t: HuffTableView, symbol: number): string | null => t.codes.find((c) => c.symbol === symbol)?.code ?? null;

function huffBar(index: number, symbol: number, ctx: ExplainContext): Explanation | null {
  const t = tableOf(ctx, index);
  const n = t?.counts.find(([s]) => s === symbol)?.[1];
  const code = t ? codeOf(t, symbol) : null;
  if (!t || n == null || code == null) return null;
  const label = symbolLabel(t.name, symbol);
  const bitsUsed = t.counts.reduce((s, [sym, c]) => s + c * (codeOf(t, sym)?.length ?? 0), 0);
  const mine = n * code.length;
  const uses = total(t);
  const ideal = uses > 0 && n > 0 ? Math.log2(uses / n) : 0;
  return {
    title: `Symbol ${label}`,
    value: `${times(n)}, code ${code}`,
    body: `${label} (${symbolWords(t.name, symbol)}) appears ${times(n)}; its code is ${code} (${plural(code.length, 'bit')}). The more often a symbol appears, the shorter its code.`,
    consequence:
      bitsUsed > 0
        ? `${count(n)} × ${code.length} = ${count(mine)} bits: ${percent(mine / bitsUsed)} of this table's code bits.`
        : `${count(n)} uses at ${plural(code.length, 'bit')} each.`,
    details: [
      {
        kind: 'text',
        text: 'A code that suits a symbol\'s share of the uses would be about as long as the minus log (base 2) of that share. Real codes use whole bits, so they land near it.',
      },
      {
        kind: 'rows',
        rows: [
          ['Symbol', `${label} (0x${symbol.toString(16).padStart(2, '0')})`],
          ['Appears', count(n)],
          ['Share of the table\'s uses', percent(uses > 0 ? n / uses : 0)],
          ['Code', code],
          ['Code length', plural(code.length, 'bit')],
          ['Ideal length', `${ideal.toFixed(2)} bits`],
        ],
      },
    ],
  };
}

function huffLeaf(index: number, symbol: number, ctx: ExplainContext): Explanation | null {
  const t = tableOf(ctx, index);
  const code = t ? codeOf(t, symbol) : null;
  if (!t || code == null) return null;
  const label = symbolLabel(t.name, symbol);
  const n = t.counts.find(([s]) => s === symbol)?.[1] ?? 0;
  const path = code.length === 0 ? 'nothing' : code.split('').map((c) => (c === '0' ? 'left' : 'right')).join(', ');
  return {
    title: 'Leaf of the code tree',
    value: `${label} = ${code}`,
    body: `Start at the top of the tree and go ${path} (0 is left, 1 is right) to arrive at ${label}: ${symbolWords(t.name, symbol)}. The path, written as 0s and 1s, is its code.`,
    consequence:
      n > 0
        ? `This picture uses it ${times(n)}, so the file spends ${plural(code.length * n, 'bit')} on it.`
        : 'This picture never uses it, but the table keeps a code for it so any picture can be decoded.',
    details: [
      {
        kind: 'text',
        text: 'Short codes sit near the top of the tree and long ones near the bottom. No code is the start of another, so the decoder always knows where one ends.',
      },
      { kind: 'rows', rows: [['Symbol', label], ['Code', code], ['Length', plural(code.length, 'bit')]] },
    ],
  };
}

function huffCost(index: number, ctx: ExplainContext): Explanation | null {
  const t = tableOf(ctx, index);
  if (!t) return null;
  const actual = Math.round(t.actualBits);
  const entropy = oneDecimal(t.entropyBits);
  const over = t.entropyBits > 0 ? ((100 * t.actualBits) / t.entropyBits - 100).toFixed(1) : '0.0';
  const lines: string[] = [
    ctx.huffman === 'optimized'
      ? 'These codes were built from this picture\'s own counts, so they are about as short as Huffman codes can be.'
      : 'These are the standard codes, built for typical photos rather than this one, so some extra cost is expected.',
  ];
  const bytes = ctx.summary?.bytes;
  if (ctx.otherBytes != null && bytes) {
    lines.push(`With ${ctx.huffman === 'optimized' ? 'standard' : 'optimized'} tables the whole file would be ${count(ctx.otherBytes)} bytes instead of ${count(bytes)}.`);
  }
  return {
    title: 'What these codes cost',
    value: `${count(actual)} bits against ${entropy}`,
    body: `"x% over" compares the codes with the fewest bits any code could spend on the same symbols (the entropy limit, worked out from how often each symbol appears). 0% would be perfect, but a code can only use whole bits.`,
    consequence: `${over}% over. ${lines.join(' ')}`,
    details: [
      {
        kind: 'text',
        text: 'Amplitude bits, the ones that spell out each value, are not counted here: they cannot be shortened by any code.',
      },
      {
        kind: 'rows',
        rows: [
          ['Bits the codes spend', count(actual)],
          ['Entropy limit', `${entropy} bits`],
          ['Over the limit', `${over}%`],
        ],
      },
    ],
  };
}

/** One run of the selected block's bits and what it belongs to. */
export interface BitPart {
  text: string;
  kind: 'code' | 'amp';
  /** `'dc'` for the DC change, else the index of the token. */
  owner: 'dc' | number;
}

/** The block's bits split by part, in file order, leaving out parts with no bits. */
export function bitParts(sel: SelectedBlock): BitPart[] {
  const out: BitPart[] = [
    { text: sel.dcCode, kind: 'code', owner: 'dc' },
    { text: sel.dcAmpBits, kind: 'amp', owner: 'dc' },
  ];
  sel.tokens.forEach((t, i) => out.push({ text: t.code, kind: 'code', owner: i }, { text: t.ampBits, kind: 'amp', owner: i }));
  return out.filter((p) => p.text.length > 0);
}

function huffBits(part: number, ctx: ExplainContext): Explanation | null {
  const sel = ctx.summary?.selected;
  if (!sel) return null;
  const parts = bitParts(sel);
  const p = parts[part];
  if (!p || !Number.isInteger(part)) return null;
  const start = sel.bitSpan[0] + parts.slice(0, part).reduce((s, q) => s + q.text.length, 0);
  const end = start + p.text.length - 1;
  const t = p.owner === 'dc' ? null : sel.tokens[p.owner];
  const total = parts.reduce((s, q) => s + q.text.length, 0);
  const tag = p.kind === 'code' ? 'code' : 'value';
  let title: string;
  let body: string;
  if (p.owner === 'dc') {
    title = p.kind === 'code' ? 'Bits: the DC code' : 'Bits: the DC change';
    body =
      p.kind === 'code'
        ? `These ${p.text.length} bits are the ${tablesWord(ctx)} Huffman code for "needs ${plural(sel.dcSize, 'bit')}": they tell the decoder how many value bits follow.`
        : `These ${p.text.length} bits spell out the change from the previous block's average: ${p.text} means ${whole(sel.dcDiff)}.`;
  } else if (t) {
    const label = kindOf(t) === 'eob' ? 'end of block' : kindOf(t) === 'zrl' ? 'sixteen zeros' : `token ${p.owner + 1}`;
    title = p.kind === 'code' ? `Bits: the code for ${label}` : `Bits: the value of ${label}`;
    body =
      p.kind === 'code'
        ? `These ${p.text.length} bits are the Huffman code for "${symbolWords('ac', t.symbol)}".`
        : `These ${p.text.length} bits spell out the number itself: ${p.text} means ${whole(t.amp)}.`;
  } else {
    return null;
  }
  return {
    title,
    value: p.text,
    body,
    consequence: `Bits ${count(start)}-${count(end)} of the scan: part ${part + 1} of ${parts.length}, in this block's ${plural(total, 'bit')}.`,
    details: [
      {
        kind: 'text',
        text: p.kind === 'code' ? 'Orange bits are Huffman codes: short for common symbols, longer for rare ones.' : 'Blue bits spell out a value. A negative value is written as its positive twin with the bits flipped.',
      },
      { kind: 'rows', rows: [['Kind', tag], ['Bits', p.text], ['Starts at bit', count(start)]] },
    ],
  };
}

/** What each marker segment of the file holds. */
const SEGMENTS: Record<string, string> = {
  Soi: 'the start marker',
  App0: 'the file header',
  Dqt: 'the step sizes (quantization tables)',
  Sof0: 'the picture\'s size and planes',
  Dht: 'the Huffman code tables',
  Sos: 'the scan',
  Eoi: 'the end marker',
};

function huffSegment(i: number, ctx: ExplainContext): Explanation | null {
  const s = Number.isInteger(i) ? ctx.segments[i] : undefined;
  if (!s) return null;
  const what = SEGMENTS[s.kind] ?? 'a marker segment';
  const all = Math.max(1, ctx.segments.reduce((sum, g) => sum + g.len, 0));
  let note: string;
  if (s.kind === 'Sos') note = 'This is the picture itself: every block\'s bits, one after another.';
  else if (s.kind === 'Dht') {
    note = ctx.huffman === 'optimized' ? 'Optimized codes are made for this picture, so their tables must travel in the file.' : 'Standard tables are the same every time, but the file still carries them.';
  } else if (s.kind === 'Dqt') note = ctx.customTables ? 'Your own tables are stored here so the decoder can undo them.' : 'The decoder needs these steps to multiply the rounded numbers back up.';
  else note = 'A small piece of bookkeeping the decoder reads first.';
  return {
    title: `${s.kind} segment`,
    value: `${s.kind}, ${what}: ${count(s.len)} bytes`,
    body: `${s.kind} holds ${what}. ${note}`,
    consequence: `${count(s.len)} of the file's ${count(all)} bytes: ${percent(s.len / all)}.`,
    details: [
      { kind: 'rows', rows: [['Marker', `${s.kind} (0xff${s.marker.toString(16).padStart(2, '0')})`], ['Starts at byte', count(s.offset)], ['Length', `${count(s.len)} bytes`]] },
    ],
  };
}

/** The card for a target of the zigzag, run-length or Huffman stage; null for an id this module does not own. */
export function explainCoding(t: Target, ctx: ExplainContext): Explanation | null {
  switch (t.id) {
    case 'zigzag.grid':
      return zigzagGrid(t.u, t.v, ctx);
    case 'zigzag.seq':
      return zigzagSeq(t.k, ctx);
    case 'zigzag.last':
      return zigzagLast(ctx);
    case 'rle.token':
      return token(t.i, ctx);
    case 'rle.dc':
      return dc(ctx);
    case 'rle.bits':
      return bitCounts(ctx);
    case 'huffman.tab':
      return huffTab(t.table, ctx);
    case 'huffman.cost':
      return huffCost(t.table, ctx);
    case 'huffman.bar':
      return huffBar(t.table, t.symbol, ctx);
    case 'huffman.leaf':
      return huffLeaf(t.table, t.symbol, ctx);
    case 'huffman.bits':
      return huffBits(t.part, ctx);
    case 'huffman.segment':
      return huffSegment(t.i, ctx);
    default:
      return null;
  }
}
