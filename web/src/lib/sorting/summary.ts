// The sorting lab's view of the engine: the grid of lanes reported by
// `rule_summary()`, plus the row/column vocabulary the page renders. Pure and
// dependency-free so it's trivially testable (same style as lib/fourier/summary.ts).

/** What the last op touched: a compare, or a write (swaps count as writes). */
export type TouchKind = 'compare' | 'write';

/** One grid cell: an algorithm running one dataset, with its live counters. */
export interface LaneSummary {
  algorithm: string;
  dataset: string;
  compares: number;
  writes: number;
  cursor: number;
  total: number;
  running: boolean;
  done: boolean;
  /** Length of the array under sort — `last_value` is in `[0, size)`. */
  size: number;
  /** Kind of the most recent op, or null before the first tick. */
  last_kind: TouchKind | null;
  /** The value the most recent op landed on (larger of a compared/swapped pair, or the value written), or null before the first tick. */
  last_value: number | null;
}

/** The whole grid: `rows` algorithms × `cols` datasets, row-major in `lanes`. */
export interface SortingSummary {
  rows: number;
  cols: number;
  tick: number;
  all_done: boolean;
  lanes: LaneSummary[];
}

/**
 * Rows of the matrix, in the order the engine lays lanes out. The `id`s and
 * labels here are a hand-kept mirror of the Rust source of truth —
 * `crates/viz-core/src/rules/sorting/algorithms.rs::Algorithm::label` (ids
 * are the serde `snake_case` variant names) — and `datasets.rs::Dataset::label`
 * for `DATASETS` below. Keep both lists in sync if either side changes.
 */
export const ALGORITHMS: readonly { id: string; label: string; complexity: string }[] = [
  { id: 'bubble', label: 'Bubble sort', complexity: 'O(n²)' },
  { id: 'insertion', label: 'Insertion sort', complexity: 'O(n²)' },
  { id: 'selection', label: 'Selection sort', complexity: 'O(n²)' },
  { id: 'shell', label: 'Shell sort', complexity: 'O(n^1.3)' },
  { id: 'merge', label: 'Merge sort', complexity: 'O(n log n)' },
  { id: 'quick', label: 'Quick sort', complexity: 'O(n log n)' },
  { id: 'heap', label: 'Heap sort', complexity: 'O(n log n)' },
];

/** Columns of the matrix, in the order the engine lays lanes out. */
export const DATASETS: readonly { id: string; label: string }[] = [
  { id: 'random', label: 'Random' },
  { id: 'nearly_sorted', label: 'Nearly sorted' },
  { id: 'reversed', label: 'Reversed' },
  { id: 'few_unique', label: 'Few unique' },
];

/** Lanes are row-major: row = algorithm, col = dataset. */
export function laneIndex(row: number, col: number, cols: number): number {
  return row * cols + col;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isCount(v: unknown): v is number {
  return isFiniteNumber(v) && Number.isInteger(v) && v > 0;
}

function isTouchKind(v: unknown): v is TouchKind {
  return v === 'compare' || v === 'write';
}

function readLane(raw: unknown): LaneSummary | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { algorithm, dataset, compares, writes, cursor, total, running, done, size, last_kind, last_value } =
    raw as Record<string, unknown>;
  if (typeof algorithm !== 'string' || typeof dataset !== 'string') return null;
  if (!isFiniteNumber(compares) || !isFiniteNumber(writes)) return null;
  if (!isFiniteNumber(cursor) || !isFiniteNumber(total)) return null;
  if (typeof running !== 'boolean' || typeof done !== 'boolean') return null;
  if (!isFiniteNumber(size)) return null;
  // Both unset before the first tick, both set after it — never one without
  // the other. The engine's `None` crosses wasm-bindgen as `undefined`, not
  // `null`, so accept either and normalize to null.
  if (last_kind == null && last_value == null) {
    return { algorithm, dataset, compares, writes, cursor, total, running, done, size, last_kind: null, last_value: null };
  }
  if (!isTouchKind(last_kind) || !isFiniteNumber(last_value)) return null;
  return { algorithm, dataset, compares, writes, cursor, total, running, done, size, last_kind, last_value };
}

/**
 * Validate the raw `engine.rule_summary()` value. Returns a fresh, normalized
 * summary, or `null` for null/undefined, another lab's summary, and any shape
 * whose lane count doesn't match `rows × cols`.
 */
export function readSummary(raw: unknown): SortingSummary | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { rows, cols, tick, all_done, lanes } = raw as Record<string, unknown>;
  if (!isCount(rows) || !isCount(cols)) return null;
  if (!isFiniteNumber(tick) || typeof all_done !== 'boolean') return null;
  if (!Array.isArray(lanes) || lanes.length !== rows * cols) return null;
  const out: LaneSummary[] = [];
  for (const l of lanes) {
    const lane = readLane(l);
    if (lane === null) return null;
    out.push(lane);
  }
  return { rows, cols, tick, all_done, lanes: out };
}
