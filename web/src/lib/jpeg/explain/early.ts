// The early stages' cards: the colour cube, the planes and the axes slider;
// the full and coded colour planes and the "samples kept" figure; and the
// block's cells, its plane switch and the −128 shift. Everything is worked out
// from the context, never by encoding.
import type { RgbaImage } from '../images';
import type { SubsamplingId } from '../params';
import { chromaKept, samplesKept } from '../formulas';
import { rgbToYcbcr } from './bezel';
import { at, blockOf } from './block';
import type { ExplainContext } from './context';
import type { Target } from './targets';
import { percent, whole } from './text';
import type { Explanation } from './types';

const count = (n: number) => n.toLocaleString('en-US');

const MODES: readonly SubsamplingId[] = ['444', '422', '420'];

/** The chroma mode the numbers on the page come from: the encode in hand, else the setting. */
function modeOf(ctx: ExplainContext): SubsamplingId {
  const s = ctx.summary?.subsampling;
  return MODES.find((m) => m === s) ?? ctx.subsampling;
}

const MODE_NAME: Record<SubsamplingId, string> = { '444': '4:4:4', '422': '4:2:2', '420': '4:2:0' };

/** How many picture pixels one colour sample covers, across and down. */
function spread(mode: SubsamplingId): [number, number] {
  return mode === '444' ? [1, 1] : mode === '422' ? [2, 1] : [2, 2];
}

/** The picture's size in pixels: the loaded image, else what the summary says. */
function sizeOf(ctx: ExplainContext): { w: number; h: number } | null {
  if (ctx.image && ctx.image.w > 0 && ctx.image.h > 0) return { w: ctx.image.w, h: ctx.image.h };
  const s = ctx.summary;
  return s && s.width > 0 && s.height > 0 ? { w: s.width, h: s.height } : null;
}

const PLANE_NAME = ['Y', 'Cb', 'Cr'] as const;
const PLANE_LONG = ['brightness (Y)', 'blue-against-yellow colour (Cb)', 'red-against-green colour (Cr)'] as const;
const clamp255 = (v: number) => Math.min(255, Math.max(0, Math.round(v)));

/** The pixel's Y, Cb and Cr (0-255 whole numbers), or null off the picture. */
function planesAt(img: RgbaImage, x: number, y: number): { rgb: [number, number, number]; ycc: [number, number, number] } | null {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= img.w || y >= img.h) return null;
  const i = 4 * (y * img.w + x);
  const rgb: [number, number, number] = [img.rgba[i], img.rgba[i + 1], img.rgba[i + 2]];
  const ycc = rgbToYcbcr(...rgb).map(clamp255) as [number, number, number];
  return { rgb, ycc };
}

// --- The colour cube -------------------------------------------------------------

/** How far apart a pixel's red, green and blue may be and still count as "close to the grey diagonal". */
const NEAR_GREY = 16;

interface PictureColours {
  /** The share of sampled pixels close to the grey diagonal. */
  nearGrey: number;
  /** How many levels brightness, blue tint and red tint each span (largest minus smallest). */
  span: [number, number, number];
}

const cache = new WeakMap<RgbaImage, PictureColours>();

/** The picture's colour spread, from a sample of at most ~16,000 pixels (cached per picture). */
function coloursOf(img: RgbaImage): PictureColours | null {
  const hit = cache.get(img);
  if (hit) return hit;
  const total = img.w * img.h;
  if (total <= 0 || img.rgba.length < total * 4) return null;
  const stride = Math.max(1, Math.floor(total / 16384));
  let seen = 0;
  let grey = 0;
  const lo = [255, 255, 255];
  const hi = [0, 0, 0];
  for (let p = 0; p < total; p += stride) {
    const [r, g, b] = [img.rgba[4 * p], img.rgba[4 * p + 1], img.rgba[4 * p + 2]];
    seen++;
    if (Math.max(r, g, b) - Math.min(r, g, b) <= NEAR_GREY) grey++;
    const ycc = rgbToYcbcr(r, g, b);
    for (let c = 0; c < 3; c++) {
      lo[c] = Math.min(lo[c], ycc[c]);
      hi[c] = Math.max(hi[c], ycc[c]);
    }
  }
  const out: PictureColours = {
    nearGrey: grey / seen,
    span: [0, 1, 2].map((c) => Math.round(clamp255(hi[c]) - clamp255(lo[c]))) as [number, number, number],
  };
  cache.set(img, out);
  return out;
}

function cube(ctx: ExplainContext): Explanation {
  const size = sizeOf(ctx);
  const colours = ctx.image ? coloursOf(ctx.image) : null;
  return {
    title: 'The colour cube',
    value: size ? `${count(size.w * size.h)} pixels, one point each` : 'One point per pixel',
    body:
      'Every pixel of this picture is a point, placed by how much red, green and blue it has. The grey diagonal runs from black in one corner to white in the opposite one: a pixel on it has equal red, green and blue, so it has no colour at all.',
    consequence: colours
      ? `${percent(colours.nearGrey)} of this picture's pixels sit close to the grey diagonal; the further a point is from it, the more colour it carries.`
      : 'The further a point is from the grey diagonal, the more colour it carries.',
    details: [
      {
        kind: 'text',
        text: 'JPEG does not store red, green and blue. It stores brightness (how far along the grey diagonal a pixel is) and two colour differences (how far it sits off the diagonal, towards blue or yellow, and towards red or green). The next steps treat those three separately.',
      },
      {
        kind: 'rows',
        rows: [
          ['Brightness (Y)', '0.299 R + 0.587 G + 0.114 B'],
          ['Blue tint (Cb)', '128 − 0.169 R − 0.331 G + 0.5 B'],
          ['Red tint (Cr)', '128 + 0.5 R − 0.419 G − 0.081 B'],
        ],
      },
    ],
  };
}

function axes(ctx: ExplainContext): Explanation {
  const colours = ctx.image ? coloursOf(ctx.image) : null;
  return {
    title: 'The axes slider',
    value: 'Red, green, blue axes to brightness and colour axes',
    body:
      'Slide it to turn the cube from the red, green and blue axes into the brightness and colour-difference axes that JPEG stores. The grey diagonal stands upright as the brightness axis, and colour spreads out around it.',
    consequence: colours
      ? `In this picture brightness spans ${colours.span[0]} levels, the blue tint ${colours.span[1]} and the red tint ${colours.span[2]}.`
      : undefined,
    acts: true,
    details: [
      {
        kind: 'text',
        text: 'The points never move on the picture itself: only the way they are measured changes. Colour differences usually vary less than brightness, which is why JPEG can keep less of them in the next step.',
      },
    ],
  };
}

// --- The planes ---------------------------------------------------------------------

const PLANE_MEANING = [
  'How bright this pixel is, ignoring its colour: 0 is black and 255 is white.',
  'How blue or yellow this pixel is: 128 is neutral, higher is bluer and lower is yellower.',
  'How red or green this pixel is: 128 is neutral, higher is redder and lower is greener.',
] as const;

function colourPlane(plane: number, x: number, y: number, ctx: ExplainContext): Explanation | null {
  if (!ctx.image || (plane !== 0 && plane !== 1 && plane !== 2)) return null;
  const p = planesAt(ctx.image, x, y);
  if (!p) return null;
  const mode = modeOf(ctx);
  const [fh, fv] = spread(mode);
  const share = plane === 0 ? 'Brightness is always kept for every pixel.' : fh * fv === 1
    ? 'At 4:4:4 every pixel keeps its own colour value.'
    : `At ${MODE_NAME[mode]} the next step keeps one value for every ${fh * fv} pixels (${fh} × ${fv}).`;
  return {
    title: `${PLANE_LONG[plane].replace(/^./, (c) => c.toUpperCase())} at pixel (${x}, ${y})`,
    value: `${PLANE_NAME[plane]} = ${p.ycc[plane]}`,
    body: PLANE_MEANING[plane],
    consequence: share,
    details: [
      { kind: 'text', text: 'JPEG measures these three planes from the pixel\'s red, green and blue, and then treats each plane on its own.' },
      {
        kind: 'rows',
        rows: [
          ['Red, green, blue', p.rgb.join(', ')],
          ['Brightness (Y)', String(p.ycc[0])],
          ['Blue tint (Cb)', String(p.ycc[1])],
          ['Red tint (Cr)', String(p.ycc[2])],
        ],
      },
    ],
  };
}

// --- Subsampling ----------------------------------------------------------------------

/** The Cb or Cr values of the group of pixels that share one colour sample with `(x, y)`, clipped to the picture. */
function groupOf(img: RgbaImage, plane: 1 | 2, x: number, y: number, mode: SubsamplingId): number[] {
  const [fh, fv] = spread(mode);
  const [x0, y0] = [Math.floor(x / fh) * fh, Math.floor(y / fv) * fv];
  const out: number[] = [];
  for (let j = y0; j < Math.min(img.h, y0 + fv); j++) {
    for (let i = x0; i < Math.min(img.w, x0 + fh); i++) {
      const p = planesAt(img, i, j);
      if (p) out.push(rgbToYcbcr(...p.rgb)[plane]);
    }
  }
  return out;
}

function subsamplePlane(which: 'full' | 'coded', plane: number, x: number, y: number, ctx: ExplainContext): Explanation | null {
  if (!ctx.image || (plane !== 1 && plane !== 2) || (which !== 'full' && which !== 'coded')) return null;
  const own = planesAt(ctx.image, x, y);
  if (!own) return null;
  const mode = modeOf(ctx);
  const [fh, fv] = spread(mode);
  const group = groupOf(ctx.image, plane, x, y, mode);
  const mean = clamp255(group.reduce((s, v) => s + v, 0) / Math.max(1, group.length));
  const name = PLANE_NAME[plane];
  const exact = fh * fv === 1;
  const shape = `${fh} × ${fv}`;
  if (which === 'full') {
    return {
      title: `${name} as measured, pixel (${x}, ${y})`,
      value: `${name} = ${own.ycc[plane]}`,
      body: exact
        ? 'The colour measured at this pixel. At 4:4:4 nothing is shared, so it is kept exactly.'
        : `The colour measured at this pixel. It will be averaged with ${group.length - 1} neighbour${group.length === 2 ? '' : 's'} (${shape}) into one shared value.`,
      consequence: exact
        ? 'Nothing is averaged at 4:4:4, so the coded plane looks the same.'
        : `At ${MODE_NAME[mode]} this pixel's ${own.ycc[plane]} becomes ${mean}, the average of its ${group.length} samples.`,
      details: [
        { kind: 'text', text: 'Eyes notice sharp changes in brightness far more than in colour, so JPEG measures colour at every pixel and then keeps fewer values of it. Brightness is never shared this way.' },
      ],
    };
  }
  const spreadOut = Math.round(Math.max(...group) - Math.min(...group));
  return {
    title: `${name} as kept, pixel (${x}, ${y})`,
    value: `${name} = ${mean}`,
    body: exact
      ? 'The colour kept at this pixel. At 4:4:4 nothing is shared, so it is the measured value.'
      : `One colour value, averaged from ${group.length} samples (${shape}) of the full plane, shared by all ${group.length} pixels.`,
    consequence: exact
      ? 'Nothing is averaged at 4:4:4, so the coded plane looks the same.'
      : spreadOut === 0
        ? `At ${MODE_NAME[mode]} these ${group.length} samples were already equal, so nothing is lost here.`
        : `At ${MODE_NAME[mode]} the ${group.length} samples differed by up to ${spreadOut} levels; that difference is gone.`,
    details: [
      { kind: 'text', text: 'These are the values the encoder actually uses for this plane. The decoder spreads each one back over its pixels, so fine colour detail is blurred while brightness stays sharp.' },
      { kind: 'rows', rows: [['Samples averaged', String(group.length)], ['Square', shape], ['Result', String(mean)]] },
    ],
  };
}

/** How many samples one colour plane holds under `mode`. */
function planeSamples(w: number, h: number, mode: SubsamplingId): number {
  const [fh, fv] = spread(mode);
  return Math.ceil(w / fh) * Math.ceil(h / fv);
}

function kept(ctx: ExplainContext): Explanation {
  const mode = modeOf(ctx);
  const share = samplesKept(mode);
  const chroma = chromaKept(mode);
  const size = sizeOf(ctx);
  let consequence = `At ${MODE_NAME[mode]} each colour plane keeps ${percent(chroma)} of its samples.`;
  const rows: [string, string][] = [];
  if (size) {
    const full = size.w * size.h;
    const colour = planeSamples(size.w, size.h, mode);
    consequence = `At ${MODE_NAME[mode]}, ${count(full + 2 * colour)} of this picture's ${count(3 * full)} samples are stored.`;
    rows.push(['Brightness (Y)', `${count(full)} of ${count(full)}`], ['Blue tint (Cb)', `${count(colour)} of ${count(full)}`], ['Red tint (Cr)', `${count(colour)} of ${count(full)}`]);
  }
  return {
    title: 'Samples kept',
    value: `${percent(share)} of all samples`,
    body: `The share of the picture's numbers that are still stored after this step. Brightness keeps every sample; each of the two colour planes keeps ${percent(chroma)}.`,
    consequence,
    details: [
      { kind: 'text', text: 'A sample is one number for one pixel in one plane. A colour picture starts with three per pixel. Dropping most of the colour ones costs little to the eye and saves a large share of the data before any block is even cut.' },
      ...(rows.length ? [{ kind: 'rows' as const, rows }] : []),
    ],
  };
}

// --- Blocks -------------------------------------------------------------------------------

/** The picture pixels a block of `component` at `(bx, by)` covers, as `[x0, y0, x1, y1]` (inclusive), clipped to the picture. */
function coverage(component: number, bx: number, by: number, ctx: ExplainContext): [number, number, number, number] {
  const [fh, fv] = component === 0 ? [1, 1] : spread(modeOf(ctx));
  const size = sizeOf(ctx);
  const [x1, y1] = [(bx + 1) * 8 * fh - 1, (by + 1) * 8 * fv - 1];
  const [x0, y0] = [bx * 8 * fh, by * 8 * fv];
  // Clipped to the picture, unless the block starts outside it (a stale summary).
  return [x0, y0, size && x0 < size.w ? Math.min(size.w - 1, x1) : x1, size && y0 < size.h ? Math.min(size.h - 1, y1) : y1];
}

function blockCell(x: number, y: number, ctx: ExplainContext): Explanation | null {
  const b = blockOf(ctx);
  if (!b || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x > 7 || y < 0 || y > 7) return null;
  const { sel } = b;
  const i = at(x, y);
  const v = sel.pixels[i];
  const shifted = sel.shifted.length === 64 ? sel.shifted[i] : v - 128;
  const plane = PLANE_NAME[sel.component] ?? 'Y';
  const [fh, fv] = sel.component === 0 ? [1, 1] : spread(modeOf(ctx));
  const [px, py] = [sel.bx * 8 * fh + x * fh, sel.by * 8 * fv + y * fv];
  const where = fh * fv === 1 ? `picture pixel (${px}, ${py})` : `the ${fh} × ${fv} picture pixels from (${px}, ${py})`;
  const [x0, y0, x1, y1] = coverage(sel.component, sel.bx, sel.by, ctx);
  const meaning =
    sel.component === 0
      ? `One brightness sample, from 0 (black) to 255 (white).`
      : `One ${sel.component === 1 ? 'blue-against-yellow' : 'red-against-green'} colour sample, where 128 is neutral.`;
  return {
    title: `${plane} sample at column ${x + 1}, row ${y + 1}`,
    value: String(v),
    body: `${meaning} It sits in block (${sel.bx}, ${sel.by}) of the ${plane} plane: ${where}.`,
    consequence: `The DCT wants values centred on zero, so 128 comes off every sample: ${v} −128 → ${whole(shifted)}.`,
    details: [
      { kind: 'text', text: 'A block is an 8 × 8 tile of one plane. Everything from here on happens to one block at a time.' },
      {
        kind: 'rows',
        rows: [
          ['Plane', plane],
          ['Block', `(${sel.bx}, ${sel.by})`],
          ['Block covers', `x ${x0}-${x1}, y ${y0}-${y1} of the picture`],
          ['Sample', String(v)],
          ['After the −128 shift', whole(shifted)],
        ],
      },
    ],
  };
}

function component(ctx: ExplainContext): Explanation | null {
  const b = blockOf(ctx);
  if (!b) return null;
  const { sel } = b;
  const c = Math.min(2, Math.max(0, sel.component));
  const grid = ctx.summary?.grids[c];
  const [x0, y0, x1, y1] = coverage(c, sel.bx, sel.by, ctx);
  const covers = `It covers x ${x0}-${x1}, y ${y0}-${y1} of the picture.`;
  return {
    title: 'Which plane to follow',
    value: `${PLANE_NAME[c]} plane, block (${sel.bx}, ${sel.by})`,
    body: 'JPEG keeps brightness (Y) and two colour differences (Cb and Cr) as separate planes, and cuts each into 8 × 8 blocks. These buttons choose which plane\'s block you are looking at.',
    consequence: grid
      ? `Showing ${PLANE_LONG[c]}: ${grid[0]} × ${grid[1]} blocks in this plane. ${covers}`
      : `Showing ${PLANE_LONG[c]}. ${covers}`,
    acts: true,
    details: [
      {
        kind: 'text',
        text: 'The colour planes can have fewer blocks than the brightness plane, because the colour was shared between pixels in the step before. Picking one keeps the same part of the picture.',
      },
    ],
  };
}

function shift(ctx: ExplainContext): Explanation | null {
  const b = blockOf(ctx);
  if (!b) return null;
  const { pixels } = b.sel;
  const [lo, hi] = [Math.min(...pixels), Math.max(...pixels)];
  const mean = Math.round(pixels.reduce((s, v) => s + v, 0) / pixels.length);
  return {
    title: 'The −128 shift',
    value: '−128 on every sample',
    body: 'Samples run from 0 to 255, but the DCT works best on numbers centred on zero. So 128 is taken off every sample: black becomes −128, mid-grey 0 and white 127.',
    consequence: `This block runs from ${lo} to ${hi} (average ${mean}); after the shift it runs from ${whole(lo - 128)} to ${whole(hi - 128)} (average ${whole(mean - 128)}). The button flips the grid between the two.`,
    acts: true,
    details: [
      {
        kind: 'text',
        text: 'The shift changes only the average of the block, not its detail. The decoder adds 128 back at the very end.',
      },
    ],
  };
}

/** The card for a target of the colour, subsample or blocks stage; null for an id this module does not own. */
export function explainEarly(t: Target, ctx: ExplainContext): Explanation | null {
  switch (t.id) {
    case 'color.cube':
      return cube(ctx);
    case 'color.axes':
      return axes(ctx);
    case 'color.plane':
      return colourPlane(t.plane, t.x, t.y, ctx);
    case 'subsample.plane':
      return subsamplePlane(t.which, t.plane, t.x, t.y, ctx);
    case 'subsample.kept':
      return kept(ctx);
    case 'blocks.cell':
      return blockCell(t.x, t.y, ctx);
    case 'blocks.component':
      return component(ctx);
    case 'blocks.shift':
      return shift(ctx);
    default:
      return null;
  }
}
