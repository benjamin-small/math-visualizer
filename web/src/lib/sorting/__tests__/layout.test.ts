import { describe, it, expect } from 'vitest';
import { cellRects } from '../layout';

const canvas = { left: 100, top: 50, width: 800, height: 600 };

describe('cellRects', () => {
  it('makes rects relative to the canvas origin', () => {
    expect(cellRects([{ left: 120, top: 70, width: 40, height: 30 }], canvas, 1)).toEqual([
      [20, 20, 40, 30],
    ]);
  });

  it('scales offsets and sizes by the device pixel ratio', () => {
    expect(cellRects([{ left: 120, top: 70, width: 40, height: 30 }], canvas, 2)).toEqual([
      [40, 40, 80, 60],
    ]);
  });

  it('rounds every component to an integer', () => {
    // dpr 1.5: offsets 20*1.5 = 30, 20.4*1.5 = 30.6 → 31; sizes 40.2*1.5 = 60.3 → 60.
    expect(cellRects([{ left: 120, top: 70.4, width: 40.2, height: 30.1 }], canvas, 1.5)).toEqual([
      [30, 31, 60, 45],
    ]);
  });

  it('keeps input order and handles cells left of / above the canvas origin', () => {
    const rects = cellRects(
      [
        { left: 90, top: 40, width: 10, height: 10 },
        { left: 500, top: 400, width: 10, height: 10 },
      ],
      canvas,
      1,
    );
    expect(rects).toEqual([
      [-10, -10, 10, 10],
      [400, 350, 10, 10],
    ]);
  });

  it('returns an empty array for no cells', () => {
    expect(cellRects([], canvas, 2)).toEqual([]);
  });
});
