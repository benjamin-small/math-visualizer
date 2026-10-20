// The overview's cards: a pixel before and after JPEG, the size blocks, the three
// byte histograms (one card per bar) and their bits-per-byte figures. The
// counts come from `bytes.ts`, worked out on demand the first time a card needs
// them and cached per picture and per file, so pointing at a bar costs nothing
// after that. Nothing here encodes.
import { blockSize, entropyBits, formatBlock, histogram, neighbourDiffs, rgbSamples } from '../bytes';
import { formatBytes } from '../summary';
import { settings } from './bezel';
import type { ExplainContext } from './context';
import type { Target } from './targets';
import { delta, percent, plural } from './text';
import type { Detail, Explanation } from './types';

type Kind = 'raw' | 'diff' | 'jpeg';

const count = (n: number) => n.toLocaleString('en-US');

/** One histogram, with the bytes it was counted from and its bits per byte. */
interface Counts {
  bins: Uint32Array;
  total: number;
  bits: number;
}

const pixelCache = new WeakMap<Uint8Array, { w: number; h: number; raw: Counts; diff: Counts }>();
const fileCache = new WeakMap<Uint8Array, Counts>();

const countsOf = (bins: Uint32Array, total: number): Counts => ({ bins, total, bits: entropyBits(bins) });

/** The histogram of a kind for this picture or file, or null when there is nothing to count yet. */
function countsFor(kind: Kind, ctx: ExplainContext): Counts | null {
  if (kind === 'jpeg') {
    const file = ctx.jpeg;
    if (!file || file.length === 0) return null;
    let c = fileCache.get(file);
    if (!c) {
      c = countsOf(histogram(file), file.length);
      fileCache.set(file, c);
    }
    return c;
  }
  const img = ctx.image;
  if (!img || !(img.w > 0 && img.h > 0) || img.rgba.length < img.w * img.h * 4) return null;
  let c = pixelCache.get(img.rgba);
  if (!c || c.w !== img.w || c.h !== img.h) {
    const total = img.w * img.h * 3;
    c = {
      w: img.w,
      h: img.h,
      raw: countsOf(histogram(rgbSamples(img.rgba)), total),
      diff: countsOf(histogram(neighbourDiffs(img.rgba, img.w, img.h)), total),
    };
    pixelCache.set(img.rgba, c);
  }
  return c[kind];
}

/** How much a perfect coder could still squeeze out: "almost no room left", or how much smaller it could get. */
function room(bits: number): string {
  const save = 1 - bits / 8;
  if (save < 0.05) return 'almost no room left to squeeze';
  return `${save < 0.3 ? 'some' : 'plenty of'} room to squeeze, up to ${percent(save)} smaller`;
}

const KIND_NAME: Record<Kind, string> = { raw: 'Raw bytes', diff: 'Neighbour differences', jpeg: 'JPEG file' };

/** The picture's size in pixels: the loaded image, else what the summary says. */
function sizeOf(ctx: ExplainContext): { w: number; h: number } | null {
  if (ctx.image && ctx.image.w > 0 && ctx.image.h > 0) return { w: ctx.image.w, h: ctx.image.h };
  const s = ctx.summary;
  return s && s.width > 0 && s.height > 0 ? { w: s.width, h: s.height } : null;
}

// --- Pixels --------------------------------------------------------------------------

const rgbText = (v: ArrayLike<number>, i: number) => `${v[i]}, ${v[i + 1]}, ${v[i + 2]}`;

/** How far apart two pixels are: the largest change in red, green or blue. */
const gap = (a: ArrayLike<number>, b: ArrayLike<number>, i: number) =>
  Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));

function pixelCard(which: 'original' | 'decoded', x: number, y: number, ctx: ExplainContext): Explanation | null {
  const img = ctx.image;
  if (!img || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= img.w || y >= img.h) return null;
  const i = 4 * (y * img.w + x);
  const d = ctx.decoded && ctx.decoded.length === img.rgba.length ? ctx.decoded : null;
  const o = img.rgba;
  const orig = rgbText(o, i);
  const where = `Pixel (${x}, ${y})`;
  const rows: [string, string][] = [['Original', `RGB ${orig}`]];
  if (d) {
    rows.push(['After JPEG', `RGB ${rgbText(d, i)}`], ['Change (red, green, blue)', [0, 1, 2].map((c) => delta(d[i + c] - o[i + c])).join(', ')]);
  }
  rows.push(['Block', `(${Math.floor(x / 8)}, ${Math.floor(y / 8)})`]);
  const details: Detail[] = [
    {
      kind: 'text',
      text: 'The two pictures hold the same pixels. The one on the right has been saved as a JPEG and opened again, so any difference between them is what compression changed. Each colour channel runs from 0 to 255.',
    },
    { kind: 'rows', rows },
  ];
  if (which === 'original') {
    return {
      title: `${where}, before JPEG`,
      value: `RGB ${orig}`,
      body: 'The colour of this pixel in the original picture, as amounts of red, green and blue from 0 to 255.',
      consequence: d ? `After JPEG it comes back as ${rgbText(d, i)}${gap(o, d, i) === 0 ? ': an exact match.' : `, ${gap(o, d, i)} ${gap(o, d, i) === 1 ? 'level' : 'levels'} away at most.`}` : 'The copy appears here once the JPEG has been decoded.',
      details,
    };
  }
  if (!d) {
    return {
      title: `${where}, after JPEG`,
      body: "The JPEG's pixels are still being decoded, so there is nothing to compare yet.",
      consequence: `The original pixel here is RGB ${orig}.`,
      details,
    };
  }
  const g = gap(o, d, i);
  return {
    title: `${where}, after JPEG`,
    value: `RGB ${rgbText(d, i)}`,
    body: `What a viewer shows here once the JPEG is opened. The original pixel was RGB ${orig}: a difference of ${plural(g, 'level')} in the colour that moved most.`,
    consequence: `${settings(ctx)}, this pixel moved by ${g} of the 255 levels. Lower quality or less colour detail moves pixels further.`,
    details,
  };
}

// --- Sizes -------------------------------------------------------------------------------

/** How many blocks some bytes fill, as the card says it: 48, 2.5, or less than one. */
function blocksOf(bytes: number, block: number): string {
  const n = bytes / block;
  if (n < 1) return 'less than one';
  return n >= 10 ? String(Math.round(n)) : String(Number(n.toFixed(1)));
}

function sizesCard(ctx: ExplainContext, drawn?: number): Explanation | null {
  const dims = sizeOf(ctx);
  if (!dims) return null;
  const raw = dims.w * dims.h * 3;
  const file = ctx.jpeg?.length ?? ctx.summary?.bytes ?? 0;
  const rawText = `${dims.w} × ${dims.h} pixels, 3 bytes each`;
  // The block the overview drew; a card opened without one counts as the wide overview does.
  const block = drawn && drawn > 0 ? drawn : blockSize(raw, 64);
  const each = `Each block is ${formatBlock(block)}`;
  if (file <= 0) {
    return {
      title: 'File size against the raw pixels',
      value: `${formatBytes(raw)} raw`,
      body: `The long row of blocks is the picture as raw pixels: ${rawText}. The JPEG is still being made.`,
      consequence: `${each}: the ${formatBytes(raw)} of raw pixels fill ${blocksOf(raw, block)}. The JPEG's row appears below it, in blocks of the same size.`,
      details: [{ kind: 'text', text: 'Raw pixels store every colour of every pixel. A JPEG keeps only what the eye is most likely to notice, so its row is much shorter.' }],
    };
  }
  const ratio = raw / file;
  return {
    title: 'File size against the raw pixels',
    value: `${formatBytes(file)} of ${formatBytes(raw)}`,
    body: `The long row of blocks is the picture as raw pixels (${rawText}). The short row is the JPEG file, in blocks of the same size.`,
    consequence: `${settings(ctx)}, the file is ${percent(file / raw)} of the raw size: ${ratio.toFixed(1)} : 1. ${each}: the raw pixels fill ${blocksOf(raw, block)}, the file ${blocksOf(file, block)}.`,
    details: [
      {
        kind: 'text',
        text: 'Lower quality or less colour detail makes the short row shorter, and the copy less like the original. Both rows are exact byte counts; the last block of each is filled only as far as the bytes go.',
      },
      {
        kind: 'rows',
        rows: [
          ['Raw pixels', `${count(raw)} bytes`],
          ['JPEG file', `${count(file)} bytes`],
          ['Each block', `${count(block)} bytes`],
          ['Cost per pixel', `${((file * 8) / (dims.w * dims.h)).toFixed(2)} bits, against 24 raw`],
        ],
      },
    ],
  };
}

// --- Histograms ---------------------------------------------------------------------------

/** The step a neighbour-difference bin stands for: bins above 127 are negative steps that wrapped round. */
const stepOf = (bin: number) => (bin < 128 ? bin : bin - 256);

const SHAPE: Record<Kind, string> = {
  raw: 'This chart counts how often each byte value occurs in the raw pixels. A few tall bars mean a few values are common, and a coder can give those short codes; an even spread leaves little to gain.',
  diff: 'Each sample here is its value minus the same colour of the pixel to its left, so a smooth area gives differences near 0 and the bars pile up there. Steps below 0 wrap round to the top of the range: −1 is stored as 255, −2 as 254 and so on, so the chart can peak at both 0 and 255. The first column has no left neighbour and is compared with 0.',
  jpeg: 'These are the bytes of the saved file. Good compression leaves them spread almost evenly, with no pattern left to exploit, which is why this chart looks flat.',
};

function histCard(kind: Kind, bin: number, ctx: ExplainContext): Explanation | null {
  if (!Number.isInteger(bin) || bin < 0 || bin > 255) return null;
  const c = countsFor(kind, ctx);
  if (!c) return null;
  const n = c.bins[bin];
  const share = percent(n / c.total);
  const bits = c.bits.toFixed(2);
  let title: string;
  let body: string;
  let consequence: string;
  if (kind === 'raw') {
    title = `Raw bytes: value ${bin}`;
    body = `${count(n)} bytes in the raw pixels have the value ${bin}: ${share} of all ${count(c.total)}. Each pixel is three bytes (red, green, blue), each from 0 to 255.`;
    consequence = `On average a byte here needs ${bits} of 8 bits, so just counting values leaves ${room(c.bits)}.`;
  } else if (kind === 'diff') {
    const step = stepOf(bin);
    const move = step === 0 ? 'the same value as the sample beside them' : `a step ${step > 0 ? 'up' : 'down'} of ${plural(Math.abs(step), 'level')}`;
    title = `Neighbour difference: ${delta(step)}`;
    body = `${count(n)} samples differ from their left neighbour by ${delta(step)}: ${move}. That is ${share} of all ${count(c.total)}.${
      bin > 127 ? ' Mostly these are small steps down, but the first column, which is compared with 0, also lands in the high bins.' : ''
    }`;
    let near = 0;
    for (let b = -4; b <= 4; b++) near += c.bins[(b + 256) & 255];
    const nearShare = near / c.total;
    consequence = `Steps of 4 levels or less, either way, make up ${percent(nearShare)} of the samples. ${
      nearShare >= 0.5
        ? 'Most samples sit next to a nearly equal neighbour, which is the pattern compression feeds on.'
        : 'This picture has a lot of fine detail, so fewer samples sit next to a near-equal neighbour.'
    }`;
  } else {
    title = `File bytes: value ${bin}`;
    body = `${count(n)} bytes of the file have the value ${bin}: ${share} of its ${count(c.total)} bytes.`;
    consequence =
      c.bits >= 7
        ? `The file's bytes average ${bits} of 8 bits, spread almost evenly: the pattern has been squeezed out.`
        : `The file's bytes average ${bits} of 8 bits, so they are still uneven: ${room(c.bits)}.`;
  }
  const details: Detail[] = [
    { kind: 'text', text: SHAPE[kind] },
    {
      kind: 'rows',
      rows: [
        [kind === 'diff' ? 'Step' : 'Value', kind === 'diff' ? delta(stepOf(bin)) : String(bin)],
        ['Count', count(n)],
        ['Share', share],
        ['Bits per byte, whole chart', bits],
      ],
    },
    { kind: 'text', text: 'The bits per byte is the Shannon entropy of the chart: the average number of bits an ideal coder would need per byte if it knew only how often each value occurs.' },
    { kind: 'tex', tex: `H = -\\sum_{v} p_v \\log_2 p_v = ${bits}\\ \\text{bits per byte}` },
  ];
  if (kind === 'jpeg' && bin === 255) {
    details.push({ kind: 'text', text: 'Byte 255 is special in a JPEG: inside the coded data every 255 is followed by a 0, so it cannot be mistaken for the start of a marker.' });
  }
  return { title, value: `${count(n)} ${kind === 'diff' ? 'samples' : 'bytes'}`, body, consequence, details };
}

function entropyCard(kind: Kind, ctx: ExplainContext): Explanation | null {
  const c = countsFor(kind, ctx);
  if (!c) return null;
  const bits = c.bits.toFixed(2);
  const what = kind === 'raw' ? 'the raw pixel bytes' : kind === 'diff' ? 'the neighbour differences' : 'the bytes of the file';
  const after = kind === 'raw' ? 'Counting values alone leaves' : kind === 'diff' ? 'Taking neighbour differences first leaves' : 'The file has';
  return {
    title: `${KIND_NAME[kind]}: bits per byte`,
    value: `${bits} bits per byte`,
    body: `The fewest bits per byte an ideal coder could manage for ${what} if it knew only how often each value occurs, out of 8 for a plain byte.`,
    consequence: `${after} ${room(c.bits)}${kind === 'jpeg' && c.bits >= 7 ? ': it has already been compressed' : ''}.`,
    details: [
      { kind: 'text', text: SHAPE[kind] },
      { kind: 'text', text: 'The figure is the Shannon entropy of the chart above it. It ignores the order of the bytes, so a coder that also uses their neighbours can do better still.' },
      { kind: 'tex', tex: `H = -\\sum_{v} p_v \\log_2 p_v = ${bits}\\ \\text{bits per byte}` },
      { kind: 'rows', rows: [['Bytes counted', count(c.total)], ['Coded at this figure', `${count(Math.round((c.total * c.bits) / 8))} bytes`]] },
    ],
  };
}

/** The card for a target of the overview; null for an id this module does not own. */
export function explainOverview(t: Target, ctx: ExplainContext): Explanation | null {
  switch (t.id) {
    case 'overview.pixel':
      return pixelCard(t.which, t.x, t.y, ctx);
    case 'overview.sizes':
      return sizesCard(ctx, t.block);
    case 'overview.hist':
      return histCard(t.kind, t.bin, ctx);
    case 'overview.entropy':
      return entropyCard(t.kind, ctx);
    default:
      return null;
  }
}
