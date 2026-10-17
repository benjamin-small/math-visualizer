// Which card a point on the canvas belongs to. The viz draws the panels; the
// page asks here what lies under the pointer, in the same CSS pixels the
// layout uses, so the answer matches what the reader sees.
import { cells, type PanelKind, type Rect, type StageLayout } from '../layout';
import type { StageId } from '../stages';
import type { SelectedBlock } from '../summary';
import type { Target } from './targets';

const inside = (r: Rect, x: number, y: number) => r.w > 0 && r.h > 0 && x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;

const clamp = (n: number, hi: number) => Math.min(hi, Math.max(0, n));

/** The device-pixel ratio the cell geometry was laid out with (the same one `CellNumbers` uses). */
const ratio = () => (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);

/**
 * The cell of an 8 × 8 panel nearest to a point, as `[column, row]`. A point in
 * the gap between two cells belongs to the nearer one, never to nothing, so a
 * pointer crossing a gap keeps its card.
 */
export function nearestCell(r: Rect, x: number, y: number): [number, number] {
  const c = cells(r, ratio());
  const pitchX = c[1].x - c[0].x;
  const pitchY = c[8].y - c[0].y;
  const col = clamp(Math.round((x - c[0].x - c[0].w / 2) / pitchX), 7);
  const row = clamp(Math.round((y - c[0].y - c[0].h / 2) / pitchY), 7);
  return [col, row];
}

/**
 * The target for cell `(u, v)` (column, row) of a cell panel of kind `kind` on
 * `stage`, or null when that panel carries no card there. The rebuilt picture
 * of the DCT stage is one card for the whole panel (the k slider's), whatever
 * the cell.
 */
export function cellTarget(stage: StageId, kind: PanelKind, u: number, v: number): Target | null {
  switch (kind) {
    case 'coeffs':
      return stage === 'dct' ? { id: 'dct.coeff', u, v } : stage === 'quantize' ? { id: 'quantize.before', u, v } : null;
    case 'atlas':
      return { id: 'dct.atlas', u, v };
    case 'quant':
      return stage === 'quantize' ? { id: 'quantize.after', u, v } : stage === 'zigzag' ? { id: 'zigzag.grid', u, v } : null;
    case 'zigzag':
      return { id: 'zigzag.grid', u, v };
    case 'rebuild':
      return { id: 'dct.k' };
    case 'dequant_rebuild':
      return { id: 'quantize.rebuild', x: u, y: v };
    case 'block':
      return { id: 'blocks.cell', x: u, y: v };
    default:
      return null;
  }
}

/** Panel kinds laid out as 8 × 8 cells. */
const CELL_PANELS: ReadonlySet<PanelKind> = new Set(['coeffs', 'atlas', 'quant', 'zigzag', 'rebuild', 'dequant_rebuild', 'block']);

/** The image pixel under a point of a picture panel, given the part of the image the panel shows. */
function pixelAt(r: Rect, x: number, y: number, img: { w: number; h: number }, crop?: [number, number, number, number]) {
  const [cx, cy, cw, ch] = crop ?? [0, 0, img.w, img.h];
  return {
    x: clamp(cx + Math.floor(((x - r.x) / r.w) * cw), cx + cw - 1),
    y: clamp(cy + Math.floor(((y - r.y) / r.h) * ch), cy + ch - 1),
  };
}

/**
 * The target under the point `(x, y)` (CSS pixels, relative to the overlay),
 * or null when the point is on no panel. `img` is the picture's size in
 * pixels; `sel` is the block the stages follow (reserved for the panels whose
 * cards depend on it).
 */
export function canvasTarget(
  layout: StageLayout,
  stage: StageId,
  img: { w: number; h: number },
  x: number,
  y: number,
  _sel: SelectedBlock | null,
): Target | null {
  const panel = layout.panels.find((p) => inside(p.rect, x, y));
  if (!panel) return null;
  const { kind, rect } = panel;
  if (CELL_PANELS.has(kind)) {
    const [u, v] = nearestCell(rect, x, y);
    return cellTarget(stage, kind, u, v);
  }
  if (kind === 'cube') return { id: 'color.cube' };
  if (!(img.w > 0 && img.h > 0)) return null;
  const p = pixelAt(rect, x, y, img, panel.crop);
  switch (kind) {
    case 'image':
    case 'image_grid':
      return { id: 'image.pixel', ...p };
    case 'original':
      return { id: 'overview.pixel', which: 'original', ...p };
    case 'decoded':
      return { id: 'overview.pixel', which: 'decoded', ...p };
    case 'wipe':
      return { id: 'decode.wipe', ...p };
    case 'error':
      return { id: 'decode.error', ...p };
    case 'plane_y':
      return stage === 'color' ? { id: 'color.plane', plane: 0, ...p } : null;
    case 'plane_cb':
    case 'plane_cr': {
      const plane = kind === 'plane_cb' ? 1 : 2;
      if (stage === 'color') return { id: 'color.plane', plane, ...p };
      return stage === 'subsample' ? { id: 'subsample.plane', which: 'full', plane, ...p } : null;
    }
    case 'coded_cb':
    case 'coded_cr':
      return { id: 'subsample.plane', which: 'coded', plane: kind === 'coded_cb' ? 1 : 2, ...p };
    default:
      return null;
  }
}
