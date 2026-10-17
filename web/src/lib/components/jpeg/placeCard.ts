// Where a card goes: right of and below its anchor when there is room, flipped
// left or up when there is not, and always at least `MARGIN` from every edge.

/** The least distance between a card and the viewport edge. */
export const MARGIN = 8;

export interface Anchor {
  x: number;
  y: number;
  /** The anchor's width (a rectangle, e.g. a button); 0 for a point. */
  w?: number;
  /** The anchor's height; 0 for a point. */
  h?: number;
}

/**
 * The top-left corner for a card of `card` size. It prefers `gap` px right of
 * and below the anchor, flips to the left or above when that would run past
 * the viewport, and finally clamps into the margin (a card wider than the
 * viewport sits at the margin and overflows on the right).
 */
export function placeCard(
  anchor: Anchor,
  card: { w: number; h: number },
  viewport: { w: number; h: number },
  gap = 12,
): { x: number; y: number } {
  let x = anchor.x + (anchor.w ?? 0) + gap;
  let y = anchor.y + (anchor.h ?? 0) + gap;
  if (x + card.w > viewport.w - MARGIN) x = anchor.x - gap - card.w;
  if (y + card.h > viewport.h - MARGIN) y = anchor.y - gap - card.h;
  const clamp = (v: number, size: number, room: number) => Math.max(MARGIN, Math.min(v, room - MARGIN - size));
  return { x: clamp(x, card.w, viewport.w), y: clamp(y, card.h, viewport.h) };
}
