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
  | 'original'
  | 'decoded'
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
  | 'rebuild'
  | 'quant'
  | 'dequant_rebuild'
  | 'zigzag'
  | 'wipe'
  | 'error';

/**
 * Named areas the page fills with DOM content (tables, charts, chips) rather
 * than viz panels. Each rect includes room for its own heading at the top.
 */
export type SlotName = 'stats' | 'charts' | 'qtable' | 'rd' | 'sequence' | 'tokens' | 'huffman' | 'resave';

/** One thing the viz draws, and where, with the caption the overlay prints above it. */
export interface Panel {
  /** What to draw. */
  kind: PanelKind;
  rect: Rect;
  /** Caption the overlay prints above the panel. */
  label: string;
  /**
   * How wide (CSS px) the caption may run, when the layout knows: the band above the panel is free that far (wider
   * than the panel, or narrower than `CAPTION_MIN` where something else starts). Otherwise the panel's width, at
   * least `CAPTION_MIN`.
   */
  captionW?: number;
  /** For plane, wipe and error panels: the part of the image shown, `[x, y, w, h]` in image pixels (default: all). */
  crop?: [number, number, number, number];
  /**
   * For plane, coded, wipe and error panels: the side, in image pixels, of a square window the viz
   * centres on the current block itself, so the window follows the scan without a layout push. Replaces `crop`.
   */
  zoom?: number;
}

/** Where everything goes on one stage. */
export interface StageLayout {
  /** The image panel (also in `panels`): clicks here pick a block. */
  image: Rect;
  /** The viz's panels, drawn in order. */
  panels: Panel[];
  /** Areas for DOM-only content; a stage lists only the slots it uses. */
  slots: Partial<Record<SlotName, Rect>>;
}

/** Space around and between panels. */
export const MARGIN = 16;
/** Height reserved above each panel for its caption. */
export const LABEL = 22;
/** Below this canvas width the image goes on top instead of at the left. */
export const PORTRAIT_BELOW = 640;
/** A panel caption may run this wide (CSS px) even over a narrower panel. */
export const CAPTION_MIN = 120;
/** Room kept under a panel for the controls the overlay puts there. */
export const TOOLS = 44;
/** Side, in image pixels, of the window the subsample stage magnifies around the selected block. */
export const ZOOM_WINDOW = 32;
/** The decode stage's zoom factors: 1 is the whole picture. */
export const DECODE_ZOOMS = [1, 2, 4, 8] as const;
/** Share of the decode stage's focus area (below its caption) the wipe may take in height. */
const WIPE_SHARE = 0.64;
/** Height the decode tools' rows (sliders, zoom and its window line, hints, Re-save) take above the re-save chart. */
export const DECODE_TOOLS = 206;
/** The decode tools' slot height that leaves a re-save chart worth drawing. */
const DECODE_TOOLS_ROOM = DECODE_TOOLS + 48;
/** The narrowest column beside the wipe the decode tools may take. */
const DECODE_SIDE_MIN = 200;
/** The scan picture's share (of the width, or of the height in portrait) on the decode stage, so the wipe leads. */
const DECODE_IMAGE_SHARE = 0.28;
/**
 * Width (CSS px) of the decode tools' widest row, the three hint chips. A `.chip` (DecodeTools) is its text plus
 * 2 × 10 px padding and 2 × 1 px border, 6 px apart; at 12 px a character is about 6 px, so Blocking, Ringing and
 * Colour bleed (8, 7 and 12 characters) are 70 + 64 + 94 = 228 px with the two gaps, rounded up to 240. The zoom
 * chips' row (Whole picture, 2×, 4×, 8×) is about 220 px, so it fits too.
 */
export const DECODE_TOOLS_MIN_W = 240;
/**
 * Height (CSS px) the decode tools' rows need, one above the other, with no chart: from DecodeTools' CSS, two
 * slider rows (`.ctl`, 20 px), the zoom chips, the hints and Re-save (`.chip`, 26 px), the window line (15 px), and
 * five 6 px gaps make 163, plus 5 to spare.
 */
export const DECODE_TOOLS_FIT = 168;
/** On a short phone, the narrowest column beside the wipe for the scan picture and the error map. */
const DECODE_COLUMN_MIN = 88;
/** Below this caption room (CSS px) a decode caption keeps its first words rather than be cut off. */
const CAPTION_FULL = 150;
/** On the decode stage the scan picture covers at most this share of the wipe's area, so the wipe leads. */
const DECODE_IMAGE_MAX = 0.8;
/** The smallest error map worth keeping a re-save chart for; a shorter stage drops the chart instead. */
const DECODE_ERROR_MIN = 48;

/** `r` scaled about its centre so its area is at most `max`. */
function shrinkTo(r: Rect, max: number): Rect {
  const a = r.w * r.h;
  if (!(a > max) || !(max > 0)) return r;
  const s = Math.sqrt(max / a);
  return { x: r.x + (r.w * (1 - s)) / 2, y: r.y + (r.h * (1 - s)) / 2, w: r.w * s, h: r.h * s };
}

/**
 * Side, in image pixels, of the square window the decode stage shows at zoom
 * `factor` (the picture's shorter side over the factor, at least one block),
 * or null for the whole picture.
 */
export function decodeWindow(factor: number, imgW: number, imgH: number): number | null {
  if (!(factor > 1)) return null;
  return Math.max(8, Math.round(Math.min(imgW, imgH) / factor));
}

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
 * A square of the image `side` pixels across (`ZOOM_WINDOW` unless given)
 * centred on luma block `block`, kept inside the image (smaller images are
 * shown whole). The viz's `zoom_window` places it the same way.
 */
export function zoomWindow(block: [number, number], imgW: number, imgH: number, side0: number = ZOOM_WINDOW): [number, number, number, number] {
  const side = Math.max(0, Math.min(side0, imgW, imgH));
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
 * The overview: the picture before and after JPEG side by side in a top band,
 * the stats slot across the full width below. The band is at most 58% of the
 * height after margins and no taller than the pictures need (their caption
 * included), so a narrow phone hands the rest to the statistics. Clicks pick a
 * block on the original.
 */
function overviewLayout(cssW: number, cssH: number, imgW: number, imgH: number): StageLayout {
  const m = MARGIN;
  const area: Rect = { x: m, y: m, w: cssW - 2 * m, h: cssH - 2 * m };
  const colW = (area.w - m) / 2;
  const topH = Math.min(area.h * 0.58, colW * (imgH / imgW) + LABEL);
  const [left, right] = columns({ x: area.x, y: area.y, w: area.w, h: topH }, 2, m);
  const original = fit(belowLabel(left), imgW, imgH);
  const decoded = fit(belowLabel(right), imgW, imgH);
  const y = area.y + topH + m;
  return {
    image: original,
    panels: [
      { kind: 'original', rect: original, label: 'Original' },
      { kind: 'decoded', rect: decoded, label: 'After JPEG' },
    ],
    slots: { stats: { x: area.x, y, w: area.w, h: Math.max(0, area.y + area.h - y) } },
  };
}

/** The decode stage's error-map caption, kept to its first words where it has little room. */
const errorCaption = (room: number) => (room >= CAPTION_FULL ? 'What was lost, brightened' : 'What was lost');

/**
 * The decode stage on a portrait (phone) stage: the wipe as large as it can be while the controls fit below it
 * without scrolling (at least `DECODE_TOOLS_MIN_W` by `DECODE_TOOLS_FIT`). Of two arrangements, the one with the
 * larger wipe: the scan picture in a row on top (28% of the height) with the error map beside the controls under
 * the wipe; or, on a short phone, the scan picture and the error map in a column beside the wipe, with the
 * controls across the full width below.
 */
function decodePortraitLayout(cssW: number, cssH: number, imgW: number, imgH: number, decodeZoom: number): StageLayout {
  const m = MARGIN;
  const g = m;
  const side = decodeWindow(decodeZoom, imgW, imgH);
  const [aw, ah] = side === null ? [imgW, imgH] : [1, 1];
  const zoom = side === null ? {} : { zoom: side };
  const wipeLabel = 'Decoded (left of the line) against the original';
  const w = cssW - 2 * m;
  const rowH = (cssH - 3 * m) * DECODE_IMAGE_SHARE;
  const stacked: Rect = { x: m, y: 2 * m + rowH + LABEL, w, h: cssH - 3 * m - rowH - LABEL };
  const stackedH = Math.max(0, Math.min(stacked.h * WIPE_SHARE, (w * ah) / aw, stacked.h - g - DECODE_TOOLS_FIT));
  const beside: Rect = { x: m, y: m + LABEL, w, h: cssH - 2 * m - LABEL };
  const besideH = Math.max(0, Math.min(beside.h - g - DECODE_TOOLS_FIT, ((w - g - DECODE_COLUMN_MIN) * ah) / aw));

  if (besideH > stackedH) {
    // The wipe's caption runs the full width above it; the column's own captions start below that band.
    const wipe = { x: m, y: beside.y, w: (besideH * aw) / ah, h: besideH };
    const col = { x: m + wipe.w + g, y: beside.y, w: Math.max(0, w - wipe.w - g), h: besideH };
    const each = Math.max(0, Math.min(col.w, (besideH - 2 * LABEL - g) / 2));
    const pic = fit({ x: col.x, y: col.y + LABEL, w: col.w, h: each }, imgW, imgH);
    const image = { ...pic, x: col.x };
    const err = fit({ x: col.x, y: col.y + 2 * LABEL + each + g, w: col.w, h: each }, aw, ah);
    const below = beside.y + besideH + g;
    return {
      image,
      panels: [
        { kind: 'image', rect: image, label: col.w >= CAPTION_FULL ? 'The image — click a block' : 'Click a block', captionW: col.w },
        { kind: 'wipe', rect: wipe, label: wipeLabel, captionW: w, ...zoom },
        { kind: 'error', rect: { ...err, x: col.x }, label: errorCaption(col.w), captionW: col.w, ...zoom },
      ],
      slots: { resave: { x: m, y: below, w, h: Math.max(0, beside.y + beside.h - below) } },
    };
  }

  const image = fit(belowLabel({ x: m, y: m, w, h: rowH }), imgW, imgH);
  const wipe = fit({ x: m, y: stacked.y, w, h: stackedH }, aw, ah);
  const bottom = { x: m, y: stacked.y + stackedH + g, w, h: Math.max(0, stacked.y + stacked.h - (stacked.y + stackedH + g)) };
  // The error map gives the controls the width their widest row needs.
  const errSide = Math.max(0, Math.min(bottom.h - LABEL, w - g - DECODE_TOOLS_MIN_W));
  const err = fit({ x: m, y: bottom.y + LABEL, w: errSide, h: errSide }, aw, ah);
  return {
    image,
    panels: [
      { kind: 'image', rect: image, label: 'The image — click a block' },
      { kind: 'wipe', rect: wipe, label: wipeLabel, captionW: m + w - wipe.x, ...zoom },
      { kind: 'error', rect: { ...err, x: m }, label: errorCaption(errSide), captionW: errSide, ...zoom },
    ],
    slots: { resave: { x: m + errSide + g, y: bottom.y, w: Math.max(0, w - errSide - g), h: bottom.h } },
  };
}

/**
 * The stage's panels. Landscape: the image at the left (up to 45% of the
 * width), the stage's focus panels to its right. Portrait (narrower than
 * `PORTRAIT_BELOW`): the image on top (42% of the height), focus below. The
 * decode stage gives the image 28% in both, so its wipe is the largest panel
 * (`decodePortraitLayout` arranges its portrait stage).
 * The magnified windows of the subsample and decode stages are the viz's to
 * place (`zoom`), so the layout does not depend on the current block.
 * `decodeZoom` is the decode stage's zoom factor (one of `DECODE_ZOOMS`; 1
 * shows the whole picture). A canvas too small for anything gives empty panels.
 */
export function jpegLayout(
  stage: StageId,
  cssW: number,
  cssH: number,
  imgW: number,
  imgH: number,
  decodeZoom = 4,
): StageLayout {
  const m = MARGIN;
  if (!(cssW > 2 * m + 40 && cssH > 2 * m + LABEL + 40 && imgW > 0 && imgH > 0)) {
    return { image: ZERO, panels: [], slots: {} };
  }
  if (stage === 'overview') return overviewLayout(cssW, cssH, imgW, imgH);
  if (stage === 'decode' && cssW < PORTRAIT_BELOW) return decodePortraitLayout(cssW, cssH, imgW, imgH, decodeZoom);
  let imageArea: Rect;
  let focus: Rect;
  if (cssW >= PORTRAIT_BELOW) {
    const colW = Math.min(cssH - 2 * m - LABEL, (cssW - 3 * m) * (stage === 'decode' ? DECODE_IMAGE_SHARE : 0.45));
    imageArea = { x: m, y: m, w: colW, h: cssH - 2 * m };
    focus = { x: 2 * m + colW, y: m, w: cssW - 3 * m - colW, h: cssH - 2 * m };
  } else {
    const rowH = (cssH - 3 * m) * (stage === 'decode' ? DECODE_IMAGE_SHARE : 0.42);
    imageArea = { x: m, y: m, w: cssW - 2 * m, h: rowH };
    focus = { x: m, y: 2 * m + rowH, w: cssW - 2 * m, h: cssH - 3 * m - rowH };
  }
  let image = fit(belowLabel(imageArea), imgW, imgH);
  const panels: Panel[] = [
    { kind: stage === 'blocks' ? 'image_grid' : 'image', rect: image, label: 'The image — click a block' },
  ];
  const slots: Partial<Record<SlotName, Rect>> = {};
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
      const side = Math.min(ZOOM_WINDOW, imgW, imgH);
      const caption = `${side} × ${side} px around the block`;
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
      panels.push({ kind: 'plane_cb', rect: sq(cbFull), label: `Cb as measured — ${caption}`, zoom: ZOOM_WINDOW });
      panels.push({ kind: 'coded_cb', rect: sq(cbKept), label: 'Cb as kept', zoom: ZOOM_WINDOW });
      panels.push({ kind: 'plane_cr', rect: sq(crFull), label: `Cr as measured — ${caption}`, zoom: ZOOM_WINDOW });
      panels.push({ kind: 'coded_cr', rect: sq(crKept), label: 'Cr as kept', zoom: ZOOM_WINDOW });
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
      slots.charts = { x: below.x + rebuildSide + g, y: below.y - LABEL, w: Math.max(0, below.w - rebuildSide - g), h: below.h + LABEL };
      break;
    }
    case 'quantize': {
      const area = belowLabel(focus);
      const side = Math.max(0, Math.min((area.w - 2 * g) / 3, area.h * 0.42));
      const [c0, c1, c2] = columns({ x: area.x, y: area.y, w: area.w, h: side }, 3, g);
      panels.push({ kind: 'coeffs', rect: squareTop(c0, side), label: 'Before: the DCT' });
      const q = squareTop(c1, side);
      slots.qtable = { x: q.x, y: q.y - LABEL, w: q.w, h: q.h + LABEL };
      panels.push({ kind: 'quant', rect: squareTop(c2, side), label: 'After: rounded to whole steps' });
      const below = belowLabel({ x: area.x, y: area.y + side + g, w: area.w, h: area.y + area.h - (area.y + side + g) });
      const rebuildSide = Math.max(0, Math.min(below.h, (below.w - g) * 0.3));
      panels.push({ kind: 'dequant_rebuild', rect: { x: below.x, y: below.y, w: rebuildSide, h: rebuildSide }, label: 'What the decoder rebuilds' });
      // The chart starts clear of the rebuild panel's caption, which may be wider than the panel.
      const rdX = below.x + Math.max(rebuildSide, CAPTION_MIN) + g;
      slots.rd = { x: rdX, y: below.y - LABEL, w: Math.max(0, below.x + below.w - rdX), h: below.h + LABEL };
      break;
    }
    case 'zigzag': {
      const area = belowLabel(focus);
      const strip = Math.min(96, area.h * 0.3);
      const side = Math.max(0, Math.min(area.w, area.h - strip - g));
      const zig = squareTop({ x: area.x, y: area.y, w: area.w, h: side }, side);
      panels.push({ kind: 'zigzag', rect: zig, label: 'The rounded block, read in zigzag order' });
      slots.sequence = { x: area.x, y: zig.y + zig.h + g, w: area.w, h: Math.max(0, area.y + area.h - (zig.y + zig.h + g)) };
      break;
    }
    case 'rle': {
      const area = belowLabel(focus);
      const side = Math.max(0, Math.min(area.w * 0.34, area.h * 0.5));
      panels.push({ kind: 'quant', rect: { x: area.x, y: area.y, w: side, h: side }, label: 'The rounded block' });
      slots.tokens = { x: area.x + side + g, y: area.y - LABEL, w: Math.max(0, area.w - side - g), h: area.h + LABEL };
      break;
    }
    case 'huffman': {
      slots.huffman = { ...focus };
      break;
    }
    case 'decode': {
      // The wipe is the main panel: the full width and most of the height, a square window around the
      // block when zoomed (the error map shows the same window), the whole picture otherwise.
      const side = decodeWindow(decodeZoom, imgW, imgH);
      const [aw, ah] = side === null ? [imgW, imgH] : [1, 1];
      const zoom = side === null ? {} : { zoom: side };
      // The window's size is said under the zoom chips (DecodeTools), so the captions stay short enough for a phone.
      const wipeLabel = 'Decoded (left of the line) against the original';
      const errorLabel = 'What was lost, brightened';
      const area = belowLabel(focus);
      // Two arrangements; the one with the larger wipe wins. Beside: the wipe takes the full height (as wide as
      // leaves the column `DECODE_SIDE_MIN`), the error map and the controls one above the other in the column.
      const sideW = Math.max(0, Math.min(area.w - g - DECODE_SIDE_MIN, (area.h * aw) / ah));
      const sideH = (sideW * ah) / aw;
      // Below: the wipe across the top (64% of the height), the error map and the controls under it; the wipe gives
      // up some height so the controls' chart fits, down to half.
      let topH = Math.max(0, Math.min(area.h * WIPE_SHARE, (area.w * ah) / aw));
      const roomy = area.h - g - DECODE_TOOLS_ROOM;
      if (roomy >= area.h * 0.5) topH = Math.min(topH, roomy);
      // The scan picture steps back further where it would rival the wipe (a tall picture on a short stage).
      const lead = (wipeArea: number) => {
        image = shrinkTo(image, wipeArea * DECODE_IMAGE_MAX);
        panels[0] = { ...panels[0], rect: image };
      };
      if (sideW * sideH >= ((topH * aw) / ah) * topH) {
        const wipe = { x: area.x, y: area.y, w: sideW, h: sideH };
        // The column's error caption shares the wipe's caption band, so the wipe's runs only its own width.
        panels.push({ kind: 'wipe', rect: wipe, label: wipeLabel, captionW: sideW, ...zoom });
        const col = { x: area.x + sideW + g, w: area.w - sideW - g };
        let errH = Math.min(col.w, area.h - g - DECODE_TOOLS_ROOM);
        if (errH < DECODE_ERROR_MIN) errH = Math.max(0, Math.min(col.w, area.h - g - DECODE_TOOLS_FIT));
        const error = fit({ x: col.x, y: area.y, w: col.w, h: errH }, aw, ah);
        panels.push({ kind: 'error', rect: { ...error, x: col.x, y: area.y }, label: errorCaption(col.w), captionW: col.w, ...zoom });
        const top = area.y + error.h + g;
        slots.resave = { x: col.x, y: top, w: col.w, h: Math.max(0, area.y + area.h - top) };
        lead(wipe.w * wipe.h);
        break;
      }
      const wipe = fit({ x: area.x, y: area.y, w: area.w, h: topH }, aw, ah);
      lead(wipe.w * wipe.h);
      panels.push({ kind: 'wipe', rect: wipe, label: wipeLabel, captionW: area.x + area.w - wipe.x, ...zoom });
      const below = belowLabel({ x: area.x, y: area.y + topH + g, w: area.w, h: area.y + area.h - (area.y + topH + g) });
      const [l, r] = columns(below, 2, g);
      // At the left of its column, so its caption has the column's width.
      const error = fit(l, aw, ah);
      panels.push({ kind: 'error', rect: { ...error, x: l.x }, label: errorLabel, captionW: l.w, ...zoom });
      slots.resave = { x: r.x, y: r.y - LABEL, w: r.w, h: r.h + LABEL };
      break;
    }
    default:
      break;
  }
  return { image, panels, slots };
}

/**
 * What the viz is given before the first picture is in: a list that is not
 * empty (an empty list means "fit the image", which would show the viz's own
 * stand-in gradient) but whose only panel has no area, so nothing is drawn.
 */
export const BLANK_PANELS: Panel[] = [{ kind: 'image', rect: { x: 0, y: 0, w: 0, h: 0 }, label: '' }];

/** Panels as the viz config wants them: `[x, y, w, h]` in device pixels. */
export function toDevicePanels(
  panels: Panel[],
  dpr: number,
): {
  kind: PanelKind;
  rect: [number, number, number, number];
  crop: [number, number, number, number] | null;
  /** In image pixels, so not scaled by `dpr`. */
  zoom: number | null;
}[] {
  return panels.map((p) => ({
    kind: p.kind,
    rect: [p.rect.x * dpr, p.rect.y * dpr, p.rect.w * dpr, p.rect.h * dpr],
    crop: p.crop ?? null,
    zoom: p.zoom ?? null,
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
