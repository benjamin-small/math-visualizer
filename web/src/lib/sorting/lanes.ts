// Pure lane arithmetic and presentation for the sorting matrix: which lanes a
// row/column header owns, and how one lane reads in the UI. Kept out of the
// component so it can be unit-tested without a DOM.
import { laneIndex, type LaneSummary, type SortingSummary } from './summary';

/** Every lane of a rows x cols grid, row-major. */
export function allLanes(rows: number, cols: number): number[] {
  return Array.from({ length: rows * cols }, (_, i) => i);
}

/** The lanes of one algorithm (a matrix row), left to right. */
export function rowLanes(row: number, cols: number): number[] {
  return Array.from({ length: cols }, (_, c) => laneIndex(row, c, cols));
}

/** The lanes of one dataset (a matrix column), top to bottom. */
export function colLanes(col: number, rows: number, cols: number): number[] {
  return Array.from({ length: rows }, (_, r) => laneIndex(r, col, cols));
}

export type LaneState = 'idle' | 'running' | 'done';

/** Cell glyph per state: idle invites a click, running offers a pause, done is finished. */
export const LANE_GLYPH: Record<LaneState, string> = {
  idle: '▶',
  running: '⏸',
  done: '✓',
};

/** A lane's UI state — 'idle' while the engine has yet to report anything. */
export function laneState(lane: LaneSummary | undefined): LaneState {
  if (lane === undefined) return 'idle';
  if (lane.done) return 'done';
  return lane.running ? 'running' : 'idle';
}

/**
 * Should a header ▶ start its group or pause it? A group already running end
 * to end toggles off; anything else (including a summary we don't have yet)
 * starts.
 */
export function shouldRun(summary: SortingSummary | null, lanes: number[]): boolean {
  if (summary === null) return true;
  return !lanes.every((i) => summary.lanes[i]?.running);
}
