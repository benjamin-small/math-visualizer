// The Decode stage's cards: a pixel of the wipe and of the error map, the Wipe
// and Error sliders, the zoom chips, the three hint buttons and the points of
// the re-save chart. The decoded pixels are the ones the page decoded once per encode;
// nothing here decodes or encodes.
import { decodeWindow, zoomWindow } from '../layout';
import { lumaAnchorOf, type SubsamplingId } from '../params';
import type { Hints } from '../summary';
import { GLOSS, rgbToYcbcr, settings } from './bezel';
import type { ExplainContext } from './context';
import type { Target } from './targets';
import { db, delta, percent, plural, ratio } from './text';
import type { Detail, Explanation } from './types';

const PENDING = "The JPEG's pixels are still being decoded, so there is nothing to compare yet.";

/** The decoded RGBA, when it is the same size as the picture. */
function copyOf(ctx: ExplainContext): Uint8Array | null {
  const img = ctx.image;
  return img && ctx.decoded && ctx.decoded.length === img.rgba.length ? ctx.decoded : null;
}

/** The image pixel's offset into the RGBA array, or null for a point outside the picture. */
function offsetOf(ctx: ExplainContext, x: number, y: number): number | null {
  const img = ctx.image;
  if (!img || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= img.w || y >= img.h) return null;
  return 4 * (y * img.w + x);
}

const rgbText = (v: ArrayLike<number>, i: number) => `${v[i]}, ${v[i + 1]}, ${v[i + 2]}`;

/**
 * The part of the picture the wipe shows, `[x, y, w, h]` in image pixels: the window around the current block when
 * zoomed (placed as the viz places it), else the whole picture. The wipe line is a share of this.
 */
function shownOf(ctx: ExplainContext): [number, number, number, number] | null {
  const img = ctx.image;
  if (!img) return null;
  const side = decodeWindow(ctx.decodeZoom, img.w, img.h);
  const sel = ctx.summary?.selected;
  if (side === null || !sel) return [0, 0, img.w, img.h];
  // The viz anchors the window through the encoded picture's subsampling, which trails the lab's own during a re-encode.
  const s = ctx.summary?.subsampling;
  const sub: SubsamplingId = s === '444' || s === '422' || s === '420' ? s : ctx.subsampling;
  return zoomWindow(lumaAnchorOf(sel, sub), img.w, img.h, side);
}

/** What the wipe line splits, in words. */
const shownWords = (ctx: ExplainContext) => (ctx.decodeZoom > 1 ? 'the magnified view' : 'the picture');

// --- Wipe and error pixels --------------------------------------------------------

function wipeCard(x: number, y: number, ctx: ExplainContext): Explanation | null {
  const i = offsetOf(ctx, x, y);
  if (i === null) return null;
  const o = ctx.image!.rgba;
  const d = copyOf(ctx);
  const [sx, , sw] = shownOf(ctx)!;
  const decodedSide = (x + 0.5 - sx) / sw < ctx.wipe;
  const line = `The line is at ${percent(ctx.wipe)}: the left ${percent(ctx.wipe)} of ${shownWords(ctx)} shows the JPEG's copy, the rest the original.`;
  const details: Detail[] = [
    {
      kind: 'text',
      text: 'Drag on the picture or slide the Wipe control to move the line. Left of it is the picture after JPEG; right of it is the original. A pixel that looks the same on both sides was kept well. A click on the picture moves the line rather than pinning this card; hover a pixel, or use the keyboard, to read it.',
    },
  ];
  if (!d) {
    return {
      title: `Pixel (${x}, ${y}) in the wipe`,
      value: `Original ${rgbText(o, i)}`,
      body: PENDING,
      consequence: line,
      details,
    };
  }
  const g = Math.max(Math.abs(o[i] - d[i]), Math.abs(o[i + 1] - d[i + 1]), Math.abs(o[i + 2] - d[i + 2]));
  details.push({ kind: 'rows', rows: [['Original', `RGB ${rgbText(o, i)}`], ['After JPEG', `RGB ${rgbText(d, i)}`], ['Change (red, green, blue)', [0, 1, 2].map((c) => delta(d[i + c] - o[i + c])).join(', ')]] });
  return {
    title: `Pixel (${x}, ${y}) in the wipe`,
    value: `Decoded ${rgbText(d, i)}; original ${rgbText(o, i)}`,
    body: `This pixel is on the ${decodedSide ? 'decoded' : 'original'} side of the line, so ${decodedSide ? "the picture shows JPEG's copy" : 'the picture shows the original'} here. The two differ by ${plural(g, 'level')} at most.`,
    consequence: `${line} ${settings(ctx)}, this pixel moved by ${g} of the 255 levels.`,
    details,
  };
}

function errorCard(x: number, y: number, ctx: ExplainContext): Explanation | null {
  const i = offsetOf(ctx, x, y);
  if (i === null) return null;
  const o = ctx.image!.rgba;
  const d = copyOf(ctx);
  const gain = ctx.errorGain;
  const brighten = `The map brightens every error × ${ratio(gain)} so small ones can be seen.`;
  const details: Detail[] = [
    {
      kind: 'text',
      text: "The error map is black where the decoded pixel matches the original and brighter the further apart they are. It shows the average of the red, green and blue differences as a warm tint, multiplied by the Error control's number and capped at 255 in each of its three colours.",
    },
  ];
  if (!d) {
    return {
      title: `Pixel (${x}, ${y}) in the error map`,
      body: PENDING,
      consequence: `${brighten} It will show here once the copy is ready.`,
      details,
    };
  }
  const err = [0, 1, 2].map((c) => Math.abs(d[i + c] - o[i + c]));
  // What the viz draws: the unrounded mean of the three differences, as (e, 0.55 e, 0.25 e) each stored as a whole
  // number, and only then multiplied by the gain. The value line shows the mean rounded.
  const mean = (err[0] + err[1] + err[2]) / 3;
  const e = Math.round(mean);
  const tint = [1, 0.55, 0.25].map((k) => Math.min(255, Math.round(Math.round(mean * k) * gain)));
  details.push({
    kind: 'rows',
    rows: [
      ['Difference (red, green, blue)', err.join(', ')],
      ['Average, e', `${e}`],
      ['Largest single difference', `${Math.max(...err)}`],
      ['Drawn as (e, 0.55e, 0.25e) × gain', tint.join(', ')],
    ],
  });
  return {
    title: `Pixel (${x}, ${y}) in the error map`,
    value: plural(e, 'level'),
    body: `On average the red, green and blue of this pixel moved ${plural(e, 'level')} when the picture was saved as a JPEG and opened again, before the map brightens it: red ${err[0]}, green ${err[1]}, blue ${err[2]} (on the 0-255 scale).`,
    consequence: `${brighten} Here it is drawn at ${tint[0]} of 255 in the strongest tint (red-orange).`,
    details,
  };
}

// --- Sliders ---------------------------------------------------------------------------

function wipeSliderCard(ctx: ExplainContext): Explanation {
  const share = percent(ctx.wipe);
  const s = ctx.summary;
  return {
    title: 'Wipe',
    value: `${share} decoded`,
    body: 'Slides the line that splits the comparison picture: the JPEG copy on its left, the original on its right. You can also drag the line on the picture.',
    consequence: `At ${share} the left ${share} of ${shownWords(ctx)} is the copy.${s ? ` ${settings(ctx)}, it is ${db(s.psnr)} from the original${GLOSS}.` : ''}`,
    acts: true,
    details: [
      { kind: 'text', text: 'Drag the line across an edge or a smooth patch and watch for the spot where the two sides stop matching. Blocks, ripples near edges and smeared colour are the usual places.' },
    ],
  };
}

function gainSliderCard(ctx: ExplainContext): Explanation {
  const gain = ctx.errorGain;
  const full = gain > 0 ? Math.ceil(255 / gain) : null;
  return {
    title: 'Error brightening',
    value: `× ${ratio(gain)}`,
    body: "Brightens the error map. Most errors are only a few levels out of 255, which would look black, so each one is multiplied by this number before it is drawn as a warm tint.",
    consequence: `At × ${ratio(gain)} an error of 2 levels is drawn as ${Math.min(255, Math.round(2 * gain))} of 255${full !== null ? `, and an average error of ${full} levels or more is drawn at full strength (red-orange)` : ''}.`,
    acts: true,
    details: [{ kind: 'text', text: 'The picture itself is not changed; only the map is brightened. Raise it to hunt for faint errors, lower it to compare how big the large ones really are.' }],
  };
}

function zoomCard(factor: number, ctx: ExplainContext): Explanation | null {
  if (!Number.isInteger(factor) || factor < 1) return null;
  const img = ctx.image;
  const side = img ? decodeWindow(factor, img.w, img.h) : null;
  const zoomed = factor > 1;
  const label = (f: number) => {
    const s = img ? decodeWindow(f, img.w, img.h) : null;
    return f > 1 ? (s === null ? `${f}×` : `${f}×: ${s} × ${s} px around the block`) : 'Whole picture';
  };
  return {
    title: 'Zoom',
    value: label(factor),
    body: 'Magnifies the before-and-after and the error map around the current block, so a difference of a level or two shows.',
    consequence: zoomed
      ? 'Play walks the window across the picture with the scan; the hints jump it to where each artifact is worst.'
      : 'The whole picture fits the panel, so single pixels are too small to compare.',
    acts: true,
    details: [
      {
        kind: 'text',
        text: `${zoomed && side !== null && img ? `At ${factor}× the window is the picture's shorter side (${Math.min(img.w, img.h)} px) over ${factor}, ${side} px across. ` : ''}Each pixel of the picture is drawn as a crisp square, so a step of one level between neighbours shows as an edge. The wipe line stays at the same share of the panel at every zoom.`,
      },
      { kind: 'rows', rows: [['In use now', label(ctx.decodeZoom)]] },
    ],
  };
}

// --- Hints ------------------------------------------------------------------------------

/** Luma, blue tint and red tint of the pixel at `i`. */
const ycc = (v: ArrayLike<number>, i: number) => rgbToYcbcr(v[i], v[i + 1], v[i + 2]);

/**
 * The same score the engine picked the block by, said in levels: the jump its border gained, how far its pixels
 * moved, or how far its colour moved. Null while the copy is not there.
 */
function scoreOf(kind: 'blocking' | 'ringing' | 'bleed', [bx, by]: [number, number], ctx: ExplainContext): string | null {
  const img = ctx.image;
  const d = copyOf(ctx);
  if (!img || !d) return null;
  const o = img.rgba;
  const { w, h } = img;
  const [x0, y0] = [bx * 8, by * 8];
  const [x1, y1] = [Math.min(x0 + 8, w), Math.min(y0 + 8, h)];
  if (x0 >= w || y0 >= h) return null;
  const px = (x: number, y: number) => 4 * (y * w + x);
  if (kind === 'blocking') {
    // The step compression added across the block's right and bottom borders, each averaged on its own.
    const step = (ax: number, ay: number, bx2: number, by2: number) =>
      Math.abs(ycc(d, px(bx2, by2))[0] - ycc(d, px(ax, ay))[0] - (ycc(o, px(bx2, by2))[0] - ycc(o, px(ax, ay))[0]));
    let right = 0;
    let bottom = 0;
    if (x1 < w) {
      for (let y = y0; y < y1; y++) right += step(x1 - 1, y, x1, y);
      right /= y1 - y0;
    }
    if (y1 < h) {
      for (let x = x0; x < x1; x++) bottom += step(x, y1 - 1, x, y1);
      bottom /= x1 - x0;
    }
    return `its right or bottom border gains a jump of ${Math.max(right, bottom).toFixed(1)} levels that the original did not have`;
  }
  let sum = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const a = ycc(o, px(x, y));
      const b = ycc(d, px(x, y));
      sum += kind === 'ringing' ? Math.abs(b[0] - a[0]) : Math.abs(b[1] - a[1]) + Math.abs(b[2] - a[2]);
    }
  }
  const mean = (sum / ((x1 - x0) * (y1 - y0))).toFixed(1);
  return kind === 'ringing' ? `its pixels moved by ${mean} levels on average` : `its colour moved by ${mean} levels on average (blue and red tint added together)`;
}

const HINT_BODY: Record<'blocking' | 'ringing' | 'bleed', string> = {
  blocking: 'The 8 × 8 block whose borders compression stepped the most: its right or bottom edge gained a jump in brightness that the original did not have.',
  ringing: 'The block with a hard edge in the original whose pixels moved the most. Rounding away fine detail leaves ripples beside sharp edges.',
  bleed: 'The block whose colour moved the most. Colour is kept in less detail than brightness, so strong colour edges smear.',
};

function hintCard(kind: 'blocking' | 'ringing' | 'bleed', ctx: ExplainContext): Explanation | null {
  const hints: Hints | null = ctx.summary?.hints ?? null;
  if (!hints) return null;
  const block = hints[kind];
  const title = kind === 'bleed' ? 'Colour bleed' : kind === 'blocking' ? 'Blocking' : 'Ringing';
  if (!block) {
    return {
      title,
      body: 'This picture has no hard edges, so there is no block where ringing shows.',
      consequence: 'Ringing needs a sharp edge: a jump of more than 64 levels between neighbouring pixels. None was found.',
      acts: true,
      details: [{ kind: 'text', text: HINT_BODY.ringing }],
    };
  }
  const [bx, by] = block;
  const score = scoreOf(kind, block, ctx);
  return {
    title,
    value: `Block (${bx}, ${by})`,
    body: HINT_BODY[kind],
    consequence: score ? `${settings(ctx)}, ${score}. Click to follow it.` : 'Click to follow it through every stage; there is no score until the copy is decoded.',
    acts: true,
    details: [
      { kind: 'text', text: 'The lab compares the decoded picture with the original block by block and points at the one where this artifact is worst. Following it shows what happened to that block at every stage.' },
      { kind: 'rows', rows: [['Block', `(${bx}, ${by})`], ['Pixels', `x ${bx * 8}-${bx * 8 + 7}, y ${by * 8}-${by * 8 + 7}`]] },
    ],
  };
}

// --- Re-save chart ------------------------------------------------------------------------

function resaveCard(generation: number, ctx: ExplainContext): Explanation | null {
  const history = ctx.resave;
  if (!Number.isInteger(generation) || generation < 1 || generation > history.length) return null;
  const psnr = history[generation - 1];
  const first = history[0];
  const gap = psnr - first;
  const finite = Number.isFinite(psnr) && Number.isFinite(first);
  let consequence: string;
  if (generation === 1) {
    consequence = `This is the first save, ${db(psnr)}: every later generation is measured against it.`;
  } else if (!finite) {
    consequence = `The first save was ${db(first)}.`;
  } else if (Math.abs(gap) < 0.05) {
    consequence = `The same as after the first save (${db(first)}): saving again at these settings changed almost nothing.`;
  } else {
    consequence = `${Math.abs(gap).toFixed(1)} dB ${gap < 0 ? 'lower' : 'higher'} than the first save (${db(first)}).`;
  }
  return {
    title: `Re-save generation ${generation}`,
    value: `Generation ${generation}: ${db(psnr)}`,
    body: `After saving and opening the picture ${generation === 1 ? 'once' : `${generation} times in a row`} with the same settings, the copy is ${db(psnr)} from the original${GLOSS}.`,
    consequence,
    details: [
      { kind: 'text', text: 'Each generation decodes the last file and encodes the result again at the same quality and chroma mode. Losses can pile up, though a picture often settles because it is already made of values the table can represent.' },
      { kind: 'rows', rows: [['Generation', String(generation)], ['Closeness (PSNR)', db(psnr)], ['First save', db(first)]] },
    ],
  };
}

/** The card for a target of the Decode stage; null for an id this module does not own. */
export function explainDecode(t: Target, ctx: ExplainContext): Explanation | null {
  switch (t.id) {
    case 'decode.wipe':
      return wipeCard(t.x, t.y, ctx);
    case 'decode.error':
      return errorCard(t.x, t.y, ctx);
    case 'decode.wipeSlider':
      return wipeSliderCard(ctx);
    case 'decode.gainSlider':
      return gainSliderCard(ctx);
    case 'decode.zoom':
      return zoomCard(t.factor, ctx);
    case 'decode.hint':
      return hintCard(t.kind, ctx);
    case 'decode.resave':
      return resaveCard(t.generation, ctx);
    default:
      return null;
  }
}
