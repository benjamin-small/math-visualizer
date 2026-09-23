import { describe, it, expect } from 'vitest';
import { allLanes, rowLanes, colLanes, laneState, shouldRun, LANE_GLYPH } from '../lanes';
import type { LaneSummary, SortingSummary } from '../summary';

function lane(patch: Partial<LaneSummary> = {}): LaneSummary {
  return {
    algorithm: 'bubble',
    dataset: 'random',
    compares: 0,
    writes: 0,
    cursor: 0,
    total: 10,
    running: false,
    done: false,
    size: 50,
    last_kind: null,
    last_value: null,
    ...patch,
  };
}

function grid(lanes: LaneSummary[]): SortingSummary {
  return { rows: 1, cols: lanes.length, tick: 0, all_done: false, lanes };
}

describe('lane groups (7 x 4 grid)', () => {
  it('allLanes walks the grid row-major', () => {
    expect(allLanes(7, 4)).toHaveLength(28);
    expect(allLanes(7, 4)[27]).toBe(27);
    expect(allLanes(2, 3)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('rowLanes is one algorithm across every dataset', () => {
    expect(rowLanes(0, 4)).toEqual([0, 1, 2, 3]);
    expect(rowLanes(6, 4)).toEqual([24, 25, 26, 27]);
  });

  it('colLanes is one dataset down every algorithm', () => {
    expect(colLanes(0, 7, 4)).toEqual([0, 4, 8, 12, 16, 20, 24]);
    expect(colLanes(3, 7, 4)).toEqual([3, 7, 11, 15, 19, 23, 27]);
  });
});

describe('laneState', () => {
  it('reports idle, running and done', () => {
    expect(laneState(lane())).toBe('idle');
    expect(laneState(lane({ running: true }))).toBe('running');
    expect(laneState(lane({ done: true }))).toBe('done');
  });

  it('prefers done over running (a finished lane stops)', () => {
    expect(laneState(lane({ running: true, done: true }))).toBe('done');
  });

  it('treats a lane the engine has not reported as idle', () => {
    expect(laneState(undefined)).toBe('idle');
  });

  it('has a glyph per state', () => {
    expect(LANE_GLYPH[laneState(lane())]).toBe('▶');
    expect(LANE_GLYPH[laneState(lane({ running: true }))]).toBe('⏸');
    expect(LANE_GLYPH[laneState(lane({ done: true }))]).toBe('✓');
  });
});

describe('shouldRun', () => {
  it('starts a group that is idle or only partly running', () => {
    expect(shouldRun(grid([lane(), lane()]), [0, 1])).toBe(true);
    expect(shouldRun(grid([lane({ running: true }), lane()]), [0, 1])).toBe(true);
  });

  it('pauses a group that is running end to end', () => {
    expect(shouldRun(grid([lane({ running: true }), lane({ running: true })]), [0, 1])).toBe(false);
  });

  it('ignores lanes outside the group', () => {
    const s = grid([lane({ running: true }), lane()]);
    expect(shouldRun(s, [0])).toBe(false);
  });

  it('starts when the engine has not reported a summary yet', () => {
    expect(shouldRun(null, [0, 1])).toBe(true);
  });
});
