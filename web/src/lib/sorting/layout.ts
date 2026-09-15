// Pure geometry for the sorting lab: the CSS grid overlaid on the canvas is
// the single source of truth for where the panels are, so the lab measures its
// cell buttons and hands the rectangles to the viz. Rust does no layout math.

/** The part of a DOMRect this module needs (so tests can pass plain objects). */
export interface DOMRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** `[x, y, w, h]` in device pixels, canvas-relative — the viz config's `cells` entry. */
export type CellRect = [number, number, number, number];

/**
 * Cell boxes (CSS pixels, viewport-relative) → canvas-relative device pixels.
 * The canvas backing store is sized `cssSize * dpr`, so the same factor applies
 * to both the offset and the extent. Components are rounded to whole device
 * pixels: bars land on pixel boundaries and the viz gets stable integers while
 * the browser reports sub-pixel layout.
 */
export function cellRects(
  cellBoxes: DOMRectLike[],
  canvasBox: DOMRectLike,
  dpr: number,
): CellRect[] {
  return cellBoxes.map((c) => [
    Math.round((c.left - canvasBox.left) * dpr),
    Math.round((c.top - canvasBox.top) * dpr),
    Math.round(c.width * dpr),
    Math.round(c.height * dpr),
  ]);
}
