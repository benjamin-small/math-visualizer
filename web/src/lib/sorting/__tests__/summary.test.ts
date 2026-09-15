import { describe, it, expect } from 'vitest';
import { readSummary, laneIndex, ALGORITHMS, DATASETS, type LaneSummary } from '../summary';
import { sortingSummaryFixture } from '../../test/fakeViz';

function lane(patch: Partial<LaneSummary> = {}): LaneSummary {
  return {
    algorithm: 'bubble',
    dataset: 'random',
    compares: 3,
    writes: 1,
    cursor: 4,
    total: 100,
    running: true,
    done: false,
    ...patch,
  };
}

const oneLane = { rows: 1, cols: 1, tick: 7, all_done: false, lanes: [lane()] };

describe('readSummary', () => {
  it('accepts the engine shape and returns a normalized copy', () => {
    const s = readSummary(oneLane);
    expect(s).toEqual(oneLane);
    expect(s).not.toBe(oneLane);
    expect(s!.lanes[0]).not.toBe(oneLane.lanes[0]);
  });

  it('accepts the 7x4 grid the engine reports for this lab', () => {
    const s = readSummary(sortingSummaryFixture);
    expect(s?.rows).toBe(7);
    expect(s?.cols).toBe(4);
    expect(s?.lanes).toHaveLength(28);
  });

  it('rejects null, undefined and non-objects', () => {
    expect(readSummary(null)).toBeNull();
    expect(readSummary(undefined)).toBeNull();
    expect(readSummary(42)).toBeNull();
    expect(readSummary('sorting')).toBeNull();
  });

  it('rejects a summary from another lab', () => {
    expect(readSummary({ origin: [0, 0], total_terms: 3, terms: [] })).toBeNull();
  });

  it('rejects non-positive or non-integer grid dimensions', () => {
    expect(readSummary({ ...oneLane, rows: 0 })).toBeNull();
    expect(readSummary({ ...oneLane, cols: 1.5 })).toBeNull();
    expect(readSummary({ ...oneLane, rows: '1' })).toBeNull();
  });

  it('rejects a lane count that does not match rows x cols', () => {
    expect(readSummary({ ...oneLane, rows: 2 })).toBeNull();
    expect(readSummary({ ...oneLane, lanes: [] })).toBeNull();
  });

  it('rejects a bad tick or all_done', () => {
    expect(readSummary({ ...oneLane, tick: NaN })).toBeNull();
    expect(readSummary({ ...oneLane, all_done: 'no' })).toBeNull();
  });

  it('rejects malformed lanes', () => {
    expect(readSummary({ ...oneLane, lanes: [null] })).toBeNull();
    expect(readSummary({ ...oneLane, lanes: [{ ...lane(), algorithm: 7 }] })).toBeNull();
    expect(readSummary({ ...oneLane, lanes: [{ ...lane(), compares: 'many' }] })).toBeNull();
    expect(readSummary({ ...oneLane, lanes: [{ ...lane(), running: 1 }] })).toBeNull();
    const { done: _done, ...noDone } = lane();
    expect(readSummary({ ...oneLane, lanes: [noDone] })).toBeNull();
  });
});

describe('laneIndex', () => {
  it('is row-major', () => {
    expect(laneIndex(0, 0, 4)).toBe(0);
    expect(laneIndex(0, 3, 4)).toBe(3);
    expect(laneIndex(1, 0, 4)).toBe(4);
    expect(laneIndex(6, 3, 4)).toBe(27);
  });
});

describe('ALGORITHMS / DATASETS', () => {
  it('list the seven algorithms in engine order, with labels and complexities', () => {
    expect(ALGORITHMS.map((a) => a.id)).toEqual([
      'bubble', 'insertion', 'selection', 'shell', 'merge', 'quick', 'heap',
    ]);
    expect(ALGORITHMS[0]).toEqual({ id: 'bubble', label: 'Bubble sort', complexity: 'O(n²)' });
    expect(ALGORITHMS.map((a) => a.complexity)).toEqual([
      'O(n²)', 'O(n²)', 'O(n²)', 'O(n^1.3)', 'O(n log n)', 'O(n log n)', 'O(n log n)',
    ]);
  });

  it('list the four datasets in engine order', () => {
    expect(DATASETS).toEqual([
      { id: 'random', label: 'Random' },
      { id: 'nearly_sorted', label: 'Nearly sorted' },
      { id: 'reversed', label: 'Reversed' },
      { id: 'few_unique', label: 'Few unique' },
    ]);
  });

  it('match the ids the engine reports, in the same row-major order', () => {
    const { lanes, cols } = sortingSummaryFixture;
    ALGORITHMS.forEach((alg, row) =>
      DATASETS.forEach((ds, col) => {
        const l = lanes[laneIndex(row, col, cols)];
        expect([l.algorithm, l.dataset]).toEqual([alg.id, ds.id]);
      }),
    );
  });
});
