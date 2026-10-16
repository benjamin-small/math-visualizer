// Pure geometry for the JPEG lab. The page measures its canvas, asks for the
// current stage's layout here and pushes the panels to the viz in device
// pixels; the overlay hangs labels and numbers on the same rects, so text and
// drawing line up by construction. Rust does no page layout.

import type { StageId } from './stages';

/** A rectangle in CSS pixels, canvas-local, y down. */
export interface Rect {
  /** Left edge. */
  x: number;
  /** Top edge. */
  y: number;
  /** Width. */
  w: number;
  /** Height. */
  h: number;
}

/** Panel kinds the Rust viz draws (see `visualizations/jpeg.rs`). */
export type PanelKind =
  | 'image'
  | 'image_grid'
  | 'plane_y'
  | 'plane_cb'
  | 'plane_cr'
  | 'coded_cb'
  | 'coded_cr'
  | 'cube'
  | 'block'
  | 'atlas'
  | 'coeffs'
  | 'rebuild';

/** One thing the viz draws, and where, with the caption the overlay prints above it. */
export interface Panel {
  /** What to draw. */
  kind: PanelKind;
  rect: Rect;
  /** Caption the overlay prints above the panel. */
  label: string;
  /** For plane panels: the part of the image shown, `[x, y, w, h]` in image pixels (default: all). */
  crop?: [number, number, number, number];
}

/** Where everything goes on one stage. */
export interface StageLayout {
  /** The image panel (also in `panels`): clicks here pick a block. */
  image: Rect;
  /** The viz's panels, drawn in order. */
  panels: Panel[];
  /** Room left for DOM-only content (charts), or a zero rect. */
  extra: Rect;
}

/** Space around and between panels. */
export const MARGIN = 16;
/** Height reserved above each panel for its caption. */
export const LABEL = 22;
/** Below this canvas width the image goes on top instead of at the left. */
export const PORTRAIT_BELOW = 640;
/** Room kept under a panel for the controls the overlay puts there. */
export const TOOLS = 44;
/** Side, in image pixels, of the window the subsample stage magnifies around the selected block. */
export const ZOOM_WINDOW = 32;

const ZERO: Rect = { x: 0, y: 0, w: 0, h: 0 };

/** The largest rect with aspect `aw : ah`, centred in `r` (same as the viz's `fit_rect`). */
export function fit(r: Rect, aw: number, ah: number): Rect {
  if (!(r.w > 0 && r.h > 0 && aw > 0 && ah > 0)) return { x: r.x, y: r.y, w: 0, h: 0 };
  const s = Math.min(r.w / aw, r.h / ah);
  const w = aw * s;
  const h = ah * s;
  return { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h };
}

/** A square of side `side` centred horizontally in `r`, at its top. */
function squareTop(r: Rect, side: number): Rect {
  const s = Math.max(0, Math.min(side, r.w, r.h));
  return { x: r.x + (r.w - s) / 2, y: r.y, w: s, h: s };
}

/** `r` shrunk by the caption band at its top. */
function belowLabel(r: Rect): Rect {
  return { x: r.x, y: r.y + LABEL, w: r.w, h: Math.max(0, r.h - LABEL) };
}

/**
 * A `ZOOM_WINDOW`-pixel square of the image centred on luma block `block`,
 * kept inside the image (smaller images are shown whole).
 */
export function zoomWindow(block: [number, number], imgW: number, imgH: number): [number, number, number, number] {
  const side = Math.min(ZOOM_WINDOW, imgW, imgH);
  const cx = block[0] * 8 + 4;
  const cy = block[1] * 8 + 4;
  const x = Math.max(0, Math.min(imgW - side, Math.round(cx - side / 2)));
  const y = Math.max(0, Math.min(imgH - side, Math.round(cy - side / 2)));
  return [x, y, side, side];
}

/** Splits `r` into `n` equal columns `gap` apart. */
function columns(r: Rect, n: number, gap: number): Rect[] {
  const w = (r.w - gap * (n - 1)) / n;
  return Array.from({ length: n }, (_, i) => ({ x: r.x + i * (w + gap), y: r.y, w: Math.max(0, w), h: r.h }));
}

/**
 * The stage's panels. Landscape: the image at the left (up to 45% of the
 * width), the stage's focus panels to its right. Portrait (narrower than
 * `PORTRAIT_BELOW`): the image on top (42% of the height), focus below.
 * `block` (luma block coordinates) centres the subsample stage's magnified
 * window. A canvas too small for anything gives empty panels.
 */
export function jpegLayout(
  stage: StageId,
  cssW: number,
  cssH: number,
  imgW: number,
  imgH: number,
  block: [number, number] = [0, 0],
): StageLayout {
  const m = MARGIN;
  if (!(cssW > 2 * m + 40 && cssH > 2 * m + LABEL + 40 && imgW > 0 && imgH > 0)) {
    return { image: ZERO, panels: [], extra: ZERO };
  }
  let imageArea: Rect;
  let focus: Rect;
  if (cssW >= PORTRAIT_BELOW) {
    const colW = Math.min(cssH - 2 * m - LABEL, (cssW - 3 * m) * 0.45);
    imageArea = { x: m, y: m, w: colW, h: cssH - 2 * m };
    focus = { x: 2 * m + colW, y: m, w: cssW - 3 * m - colW, h: cssH - 2 * m };
  } else {
    const rowH = (cssH - 3 * m) * 0.42;
    imageArea = { x: m, y: m, w: cssW - 2 * m, h: rowH };
    focus = { x: m, y: 2 * m + rowH, w: cssW - 2 * m, h: cssH - 3 * m - rowH };
  }
  const image = fit(belowLabel(imageArea), imgW, imgH);
  const panels: Panel[] = [
    { kind: stage === 'blocks' ? 'image_grid' : 'image', rect: image, label: 'The image — click a block' },
  ];
  let extra: Rect = ZERO;
  const g = m;

  switch (stage) {
    case 'color': {
      const cubeSide = Math.min(focus.w, (focus.h - LABEL) * 0.66);
      const cube = squareTop(belowLabel(focus), cubeSide);
      panels.push({ kind: 'cube', rect: cube, label: 'Every pixel as a point in the colour cube' });
      const row = { x: focus.x, y: cube.y + cube.h + g, w: focus.w, h: focus.y + focus.h - (cube.y + cube.h + g) };
      const kinds: [PanelKind, string][] = [
        ['plane_y', 'Y — brightness'],
        ['plane_cb', 'Cb — blue vs yellow'],
        ['plane_cr', 'Cr — red vs green'],
      ];
      columns(row, 3, g).forEach((c, i) => {
        panels.push({ kind: kinds[i][0], rect: fit(belowLabel(c), imgW, imgH), label: kinds[i][1] });
      });
      break;
    }
    case 'subsample': {
      const crop = zoomWindow(block, imgW, imgH);
      const zoom = `${crop[2]} × ${crop[3]} px around the block`;
      const [left, right] = columns(focus, 2, g);
      const half = (r: Rect): [Rect, Rect] => {
        const h = (r.h - g) / 2;
        return [
          { x: r.x, y: r.y, w: r.w, h },
          { x: r.x, y: r.y + h + g, w: r.w, h },
        ];
      };
      const [cbFull, crFull] = half(left);
      const [cbKept, crKept] = half(right);
      const sq = (r: Rect) => fit(belowLabel(r), 1, 1);
      panels.push({ kind: 'plane_cb', rect: sq(cbFull), label: `Cb as measured — ${zoom}`, crop });
      panels.push({ kind: 'coded_cb', rect: sq(cbKept), label: 'Cb as kept', crop });
      panels.push({ kind: 'plane_cr', rect: sq(crFull), label: `Cr as measured — ${zoom}`, crop });
      panels.push({ kind: 'coded_cr', rect: sq(crKept), label: 'Cr as kept', crop });
      break;
    }
    case 'blocks': {
      const area = belowLabel(focus);
      const side = Math.min(area.w, area.h - TOOLS);
      panels.push({ kind: 'block', rect: squareTop(area, side), label: 'The selected block, sample by sample' });
      break;
    }
    case 'dct': {
      const area = belowLabel(focus);
      const side = Math.min((area.w - g) / 2, area.h * 0.5);
      const [l, r] = columns({ x: area.x, y: area.y, w: area.w, h: side }, 2, g);
      panels.push({ kind: 'atlas', rect: squareTop(l, side), label: 'The 64 cosine patterns' });
      panels.push({ kind: 'coeffs', rect: squareTop(r, side), label: 'How much of each this block uses' });
      const below = belowLabel({ x: area.x, y: area.y + side + g, w: area.w, h: area.y + area.h - (area.y + side + g) });
      const rebuildSide = Math.max(0, Math.min(below.h - TOOLS, (below.w - g) * 0.4));
      panels.push({ kind: 'rebuild', rect: { x: below.x, y: below.y, w: rebuildSide, h: rebuildSide }, label: 'Rebuilt from the first k patterns' });
      extra = { x: below.x + rebuildSide + g, y: below.y - LABEL, w: Math.max(0, below.w - rebuildSide - g), h: below.h + LABEL };
      break;
    }
    default:
      break;
  }
  return { image, panels, extra };
}

/** Panels as the viz config wants them: `[x, y, w, h]` in device pixels. */
export function toDevicePanels(
  panels: Panel[],
  dpr: number,
): { kind: PanelKind; rect: [number, number, number, number]; crop: [number, number, number, number] | null }[] {
  return panels.map((p) => ({
    kind: p.kind,
    rect: [p.rect.x * dpr, p.rect.y * dpr, p.rect.w * dpr, p.rect.h * dpr],
    crop: p.crop ?? null,
  }));
}

/** The luma block under a point of the image panel, or null outside it. */
export function blockAt(x: number, y: number, image: Rect, imgW: number, imgH: number): [number, number] | null {
  if (!(image.w > 0 && image.h > 0) || x < image.x || y < image.y || x >= image.x + image.w || y >= image.y + image.h) {
    return null;
  }
  const px = ((x - image.x) / image.w) * imgW;
  const py = ((y - image.y) / image.h) * imgH;
  return [Math.floor(px / 8), Math.floor(py / 8)];
}

/**
 * The 64 cells of an 8 × 8 grid in `r`, row-major, matching the viz's
 * `cells_8x8` with its gap of `max(w / 160, 1)` device pixels (converted with
 * `dpr`), so overlay numbers sit on the drawn cells.
 */
export function cells(r: Rect, dpr: number): Rect[] {
  const gap = Math.max((r.w * dpr) / 160, 1) / dpr;
  const cw = (r.w - 7 * gap) / 8;
  const ch = (r.h - 7 * gap) / 8;
  return Array.from({ length: 64 }, (_, i) => ({
    x: r.x + (i % 8) * (cw + gap),
    y: r.y + Math.floor(i / 8) * (ch + gap),
    w: cw,
    h: ch,
  }));
}

/** Which of an 8 × 8 grid's cells `[u, v]` a point falls in, or null. */
export function cellAt(x: number, y: number, r: Rect): [number, number] | null {
  if (!(r.w > 0) || x < r.x || y < r.y || x >= r.x + r.w || y >= r.y + r.h) return null;
  return [Math.min(7, Math.floor(((x - r.x) / r.w) * 8)), Math.min(7, Math.floor(((y - r.y) / r.h) * 8))];
}
