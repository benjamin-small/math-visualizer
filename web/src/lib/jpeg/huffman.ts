// The Huffman stage's data: the four tables from `rule_inspect("huffman")`,
// the file's segments from `rule_inspect("segments")`, and the geometry for
// drawing a code tree. Parsed defensively, like the summary.

/** One Huffman table as the rule reports it. */
export interface HuffTableView {
  /** `dc_luma`, `ac_luma`, `dc_chroma` or `ac_chroma`. */
  name: string;
  /** Codes of each length 1–16 (the DHT form). */
  bits: number[];
  /** Symbols in code order. */
  vals: number[];
  /** Each symbol's code as 0s and 1s, in code order. */
  codes: { symbol: number; code: string }[];
  /** `[symbol, count]` for every symbol this image used. */
  counts: [number, number][];
  /** Shannon's bound for these counts, in bits. */
  entropyBits: number;
  /** Bits the codes actually spend on these counts (amplitude bits excluded). */
  actualBits: number;
}

/** One marker segment of the file. */
export interface SegmentView {
  marker: number;
  /** `Soi`, `App0`, `Dqt`, `Sof0`, `Dht`, `Sos`, `Eoi`, … */
  kind: string;
  offset: number;
  /** Bytes, including the scan data for `Sos`. */
  len: number;
}

/** One node of a code tree, placed for drawing. */
export interface TreeNodeView {
  depth: number;
  /** The code leading here, as 0s and 1s ('' for the root). */
  code: string;
  /** Set on leaves. */
  symbol: number | null;
}

/** Tab labels, in table order. */
export const TABLE_LABELS: Record<string, string> = {
  dc_luma: 'DC · luma',
  ac_luma: 'AC · luma',
  dc_chroma: 'DC · chroma',
  ac_chroma: 'AC · chroma',
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const nums = (v: unknown) => (Array.isArray(v) ? v.map(num) : []);

/** Parse `rule_inspect("huffman")`; an empty list when it isn't one. */
export function readTables(raw: unknown): HuffTableView[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isObj).map((t) => ({
    name: typeof t.name === 'string' ? t.name : '',
    bits: nums(t.bits),
    vals: nums(t.vals),
    codes: Array.isArray(t.codes)
      ? t.codes.filter(isObj).map((c) => ({ symbol: num(c.symbol), code: typeof c.code === 'string' ? c.code : '' }))
      : [],
    counts: Array.isArray(t.counts) ? t.counts.map((c) => [num(nums(c)[0]), num(nums(c)[1])] as [number, number]) : [],
    entropyBits: num(t.entropy_bits),
    actualBits: num(t.actual_bits),
  }));
}

/** Parse `rule_inspect("segments")`; an empty list when it isn't one. */
export function readSegments(raw: unknown): SegmentView[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isObj).map((s) => ({
    marker: num(s.marker),
    kind: typeof s.kind === 'string' ? s.kind : '',
    offset: num(s.offset),
    len: num(s.len),
  }));
}

/** A symbol as the reader thinks of it: the DC size, or "run/size" for AC (EOB and ZRL by name). */
export function symbolLabel(table: string, symbol: number): string {
  if (table.startsWith('dc')) return `size ${symbol}`;
  if (symbol === 0x00) return 'EOB';
  if (symbol === 0xf0) return 'ZRL';
  return `${symbol >> 4}/${symbol & 15}`;
}

/** The counts, most frequent first (ties by symbol), at most `limit` of them. */
export function topCounts(counts: readonly [number, number][], limit: number): [number, number][] {
  return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, limit);
}

/**
 * Where a tree node sits in a `w × h` box: depth runs down (to `maxDepth`),
 * and the code, read as a binary fraction, runs across — so each subtree
 * owns a slice of the width under its parent.
 */
export function nodeXY(code: string, w: number, h: number, maxDepth: number): [number, number] {
  let lo = 0;
  let hi = 1;
  for (const b of code) {
    const mid = (lo + hi) / 2;
    if (b === '0') hi = mid;
    else lo = mid;
  }
  const y = maxDepth > 0 ? (code.length / maxDepth) * h : 0;
  return [((lo + hi) / 2) * w, y];
}

/** Parse the kit's `jpeg_huffman_tree` output. */
export function readTree(raw: unknown): TreeNodeView[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isObj).map((n) => ({
    depth: num(n.depth),
    code: typeof n.code === 'string' ? n.code : '',
    symbol: typeof n.symbol === 'number' ? n.symbol : null,
  }));
}
