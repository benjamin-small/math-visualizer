// Pure geometry for the Notes lab: where the square figure and the waveform
// strip sit on the stage, and where the overlay's text labels hang. The page
// measures its canvas, asks for the layout here and pushes the two rectangles
// to the viz as device pixels (like the sorting lab's cells), so Rust does no
// page layout.

/** A rectangle in CSS pixels, canvas-local, y down. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A point in CSS pixels, canvas-local, y down: where the overlay anchors a label. */
export interface Point {
  x: number;
  y: number;
}

/** `[x, y, w, h]` in device pixels, canvas-local — the viz config's `figure` / `strip` entries. */
export type DeviceRect = [number, number, number, number];

/** Space around the figure and the strip, and between them. */
export const MARGIN = 16;

/**
 * Each bar sits on the midline of a gutter this share of the figure's side wide
 * and spans the plot inside the gutters. The Rust viz's `GUTTER_FRAC` is the
 * same number: the overlay labels are placed from it.
 */
export const BAR_INSET = 0.12;

/** The most of the free length along the stage's long axis (what the margins leave) the figure may take; the strip gets the rest. */
const FIGURE_SHARE = 0.6;

function empty(): { figure: Rect; strip: Rect } {
  return { figure: { x: 0, y: 0, w: 0, h: 0 }, strip: { x: 0, y: 0, w: 0, h: 0 } };
}

/**
 * Lay the stage out as a square figure plus a strip. A landscape stage
 * (`cssW >= cssH`) puts the square at the left, vertically centred, with the
 * strip filling the height to its right; a portrait stage puts the square on
 * top, horizontally centred, with the strip filling the width below it. The
 * square is as large as the margins allow but takes at most 60% of the free
 * length along the long axis, so the strip always keeps room. A stage too
 * small for a square gives two all-zero rects, which tells the viz to fit the
 * canvas itself.
 */
export function notesLayout(cssW: number, cssH: number): { figure: Rect; strip: Rect } {
  const m = MARGIN;
  if (cssW >= cssH) {
    const side = Math.min(cssH - 2 * m, FIGURE_SHARE * (cssW - 3 * m));
    if (!(side > 0)) return empty();
    return {
      figure: { x: m, y: (cssH - side) / 2, w: side, h: side },
      strip: { x: 2 * m + side, y: m, w: cssW - side - 3 * m, h: cssH - 2 * m },
    };
  }
  const side = Math.min(cssW - 2 * m, FIGURE_SHARE * (cssH - 3 * m));
  if (!(side > 0)) return empty();
  return {
    figure: { x: (cssW - side) / 2, y: m, w: side, h: side },
    strip: { x: m, y: 2 * m + side, w: cssW - 2 * m, h: cssH - side - 3 * m },
  };
}

/**
 * CSS pixels to canvas device pixels (the backing store is `css * dpr`),
 * rounded per component so the viz gets stable whole pixels while the browser
 * reports sub-pixel layout.
 */
export function toDevice(r: Rect, dpr: number): DeviceRect {
  return [Math.round(r.x * dpr), Math.round(r.y * dpr), Math.round(r.w * dpr), Math.round(r.h * dpr)];
}

/**
 * Where the overlay hangs its text, for a figure of side `figure.w`: one label
 * at each bar's end (left bar at the bottom, top bar at the right, right bar
 * at the bottom) and the ratio readout at the bottom-centre. The bars lie on
 * their gutters' midlines, half of `BAR_INSET` in from the figure's edge, and
 * span the plot, which ends `BAR_INSET` short of the opposite edge.
 */
export function labelAnchors(figure: Rect): { bars: [Point, Point, Point]; ratio: Point } {
  const s = figure.w;
  const mid = BAR_INSET / 2;
  const far = 1 - BAR_INSET;
  return {
    bars: [
      { x: figure.x + mid * s, y: figure.y + far * s },
      { x: figure.x + far * s, y: figure.y + mid * s },
      { x: figure.x + (1 - mid) * s, y: figure.y + far * s },
    ],
    ratio: { x: figure.x + 0.5 * s, y: figure.y + (1 - mid) * s },
  };
}
