// The controls along the top and the picture choices: the bezel's Picture,
// Upload, Quality, Chroma, Huffman, Save and Speed; the readout's four figures
// and the custom-tables chip; the stage rail; the gallery tiles; and a pixel of
// the stage image. Everything is worked out from the context, never by encoding.
import { BUILTIN_SIDE, GROUP_LABELS, IMAGES } from '../images';
import { mcuSize, type HuffmanId, type ImageId, type SubsamplingId } from '../params';
import { STAGES, type StageId } from '../stages';
import { formatBytes, readoutOf } from '../summary';
import { blockOf, planeWord, survivors, type BlockView } from './block';
import type { ExplainContext } from './context';
import { STD_CHROMA, STD_LUMA, roundHalfAway, scaleFactor, scaleTable } from './quality';
import type { Target } from './targets';
import { db, percent, plural, ratio } from './text';
import type { Detail, Explanation } from './types';

/** Said once per card, after the first dB figure. */
const GLOSS = ' (higher is closer)';

const MODES: Record<SubsamplingId, { name: string; share: number }> = {
  '444': { name: '4:4:4', share: 1 },
  '422': { name: '4:2:2', share: 0.5 },
  '420': { name: '4:2:0', share: 0.25 },
};

const count = (n: number) => n.toLocaleString('en-US');

/** `7.5`, `48`: one decimal, none when it is a whole number. */
const oneDecimal = (x: number) => x.toFixed(1).replace(/\.0$/, '');

/** The picture's size in pixels: the loaded image, else what the summary says. */
function sizeOf(ctx: ExplainContext): { w: number; h: number } | null {
  if (ctx.image && ctx.image.w > 0 && ctx.image.h > 0) return { w: ctx.image.w, h: ctx.image.h };
  const s = ctx.summary;
  return s && s.width > 0 && s.height > 0 ? { w: s.width, h: s.height } : null;
}

/** How many samples one colour plane holds under `mode`. */
function planeSamples(w: number, h: number, mode: SubsamplingId): number {
  return mode === '444' ? w * h : mode === '422' ? Math.ceil(w / 2) * h : Math.ceil(w / 2) * Math.ceil(h / 2);
}

/** The settings the encode in hand was made with: "At quality 50", or "With your own tables". */
function lead(ctx: ExplainContext): string {
  return ctx.customTables ? 'With your own tables' : `At quality ${ctx.summary?.quality ?? ctx.quality}`;
}

/** The file name Save .jpg gives (the page uses this too). */
export function saveFileName(customTables: unknown, subsampling: SubsamplingId, quality: number): string {
  return customTables ? `jpeg-lab-custom-${subsampling}.jpg` : `jpeg-lab-q${quality}-${subsampling}.jpg`;
}

// --- Quality ---------------------------------------------------------------

/** How many of the block's 64 patterns round to something other than zero at `quality`, from the standard tables. */
function survivorsAt(b: BlockView, quality: number): number {
  const table = scaleTable(b.sel.component === 0 ? STD_LUMA : STD_CHROMA, quality);
  return b.sel.dct.filter((c, i) => roundHalfAway(c / table[i]) !== 0).length;
}

/** The file at `quality`: this encode's own figures, else a cached curve point; null when neither is known. */
function knownAt(ctx: ExplainContext, quality: number): { bytes: number; psnr: number | null } | null {
  const s = ctx.summary;
  if (s && s.quality === quality && !ctx.customTables) return { bytes: s.bytes, psnr: s.psnr };
  const p = ctx.rd.find((r) => r.quality === quality);
  return p ? { bytes: p.bytes, psnr: Number.isFinite(p.psnr) ? p.psnr : null } : null;
}

function qualityCard(ctx: ExplainContext): Explanation {
  const q = ctx.quality;
  const s = scaleFactor(q);
  const custom = ctx.customTables !== null;
  const b = blockOf(ctx);
  const details: Detail[] = [
    {
      kind: 'text',
      text: 'Quality is one number from 1 to 100 that makes the table of rounding steps bigger or smaller. At 50 the steps are the standard ones; lower numbers scale every step up, higher numbers scale it down.',
    },
    { kind: 'tex', tex: q < 50 ? `s = \\left\\lfloor \\frac{5000}{${q}} \\right\\rfloor = ${s}` : `s = 200 - 2 \\cdot ${q} = ${s}` },
    { kind: 'tex', tex: `\\text{step} = \\left\\lfloor \\frac{\\text{standard step} \\cdot ${s} + 50}{100} \\right\\rfloor` },
  ];
  const rows: [string, string][] = [];
  for (const at of [q, ...[20, 90].filter((a) => a !== q)]) {
    const known = knownAt(ctx, at);
    const parts = [`entries ${scaleFactor(at)}%`];
    if (b) parts.push(`${survivorsAt(b, at)} of 64 patterns survive here`);
    if (known) parts.push(`${formatBytes(known.bytes)}, ${db(known.psnr)}`);
    rows.push([`Quality ${at}`, parts.join('; ')]);
  }
  details.push({ kind: 'rows', rows });
  if (custom) {
    details.push({ kind: 'text', text: 'Your own tables are in use, so the figures above show what the slider would do, not what the picture now has.' });
  }
  return {
    title: 'Quality',
    value: String(q),
    body: custom
      ? `Your own tables override quality, so this slider changes nothing until you go back. On the standard tables, ${q} would scale every table entry by ${s}%.`
      : `At quality ${q} every table entry is scaled by ${s}%. Lower means bigger steps, so more numbers round to zero.`,
    consequence: custom
      ? 'Press Standard in the chip beside the readout to give the slider its job back.'
      : b
        ? `In the block you are following, ${survivorsAt(b, q)} of 64 patterns survive the rounding at quality ${q}.`
        : `The steps are ${ratio(s / 100)} times the standard ones.`,
    acts: true,
    details,
  };
}

// --- Chroma and Huffman ------------------------------------------------------

function chromaCard(ctx: ExplainContext, pointed: SubsamplingId | undefined): Explanation {
  const sub = pointed ?? ctx.subsampling;
  const mode = MODES[sub];
  const inUse = sub === ctx.subsampling;
  const dims = sizeOf(ctx);
  const full = dims ? dims.w * dims.h : 0;
  const details: Detail[] = [
    {
      kind: 'text',
      text: 'The eye notices detail in brightness much more than in colour, so JPEG can keep the two colour planes at a lower resolution. 4:4:4 keeps them in full, 4:2:2 halves them across, 4:2:0 halves them across and down.',
    },
  ];
  if (dims) {
    details.push({
      kind: 'rows',
      rows: (Object.keys(MODES) as SubsamplingId[]).map((m) => [
        `${MODES[m].name} (${percent(MODES[m].share)})`,
        `${count(planeSamples(dims.w, dims.h, m))} samples per colour plane`,
      ]),
    });
  }
  let consequence = 'Brightness is kept in full whichever you pick.';
  if (dims) {
    const kept = sub === '444' ? `keeps every colour sample: ${count(full)} per colour plane` : `stores ${count(planeSamples(dims.w, dims.h, sub))} samples per colour plane instead of ${count(full)}`;
    consequence = `${inUse ? 'This' : `With ${mode.name}, this`} ${dims.w} × ${dims.h} picture ${kept}.${inUse ? '' : ' Click to switch.'}`;
  }
  return {
    title: 'Colour detail',
    value: mode.name,
    body: `Keeps ${percent(mode.share)} of the colour detail; brightness is kept in full.`,
    consequence,
    acts: true,
    details,
  };
}

function huffmanCard(ctx: ExplainContext, pointed: HuffmanId | undefined): Explanation {
  const mode = pointed ?? ctx.huffman;
  const optimized = mode === 'optimized';
  const inUse = mode === ctx.huffman;
  const s = ctx.summary;
  const other = optimized ? 'standard' : 'optimized';
  let consequence: string;
  if (!s) consequence = 'Encode a picture to see its size.';
  else if (!inUse) {
    consequence =
      ctx.otherBytes != null
        ? `Click to switch to it: the file would be ${formatBytes(ctx.otherBytes)} instead of ${formatBytes(s.bytes)}.`
        : `Click to switch to it. The file is ${formatBytes(s.bytes)} with the ${other} tables now.`;
  } else if (ctx.otherBytes != null) {
    const d = ctx.otherBytes - s.bytes;
    consequence =
      d === 0
        ? `The ${other} tables would give the same ${formatBytes(s.bytes)}.`
        : `Switching to the ${other} tables would make the file ${formatBytes(Math.abs(d))} ${d > 0 ? 'bigger' : 'smaller'} (${formatBytes(s.bytes)} to ${formatBytes(ctx.otherBytes)}).`;
  } else {
    consequence = `The file is ${formatBytes(s.bytes)} now. Open the Huffman stage to see what the ${other} tables would cost.`;
  }
  return {
    title: 'Huffman codes',
    value: optimized ? 'Optimized' : 'Standard',
    body: optimized
      ? "Codes built from this picture's own symbol counts: the symbols that occur most get the shortest codes."
      : 'The example tables from the standard: the same codes for every picture, made for typical photos.',
    consequence,
    acts: true,
    details: [
      {
        kind: 'text',
        text: "After rounding, the picture is a long list of symbols. Huffman coding gives short codes to common symbols and long codes to rare ones. Optimized counts this picture's own symbols first, which costs a little time and saves bytes; Standard uses a fixed table so the file needs no counting.",
      },
    ],
  };
}

// --- Save, upload, speed -----------------------------------------------------

function saveCard(ctx: ExplainContext): Explanation {
  const name = saveFileName(ctx.customTables, ctx.subsampling, ctx.quality);
  const bytes = ctx.summary?.bytes;
  return {
    title: 'Save the JPEG',
    value: name,
    body: bytes
      ? `Saves the file the lab just made: ${formatBytes(bytes)}, a real JPEG that opens in any image viewer.`
      : 'Saves the JPEG the lab makes, a real file that opens in any image viewer.',
    consequence: `${lead(ctx)} with ${MODES[ctx.subsampling].name} colour the file is called ${name}.`,
    acts: true,
    details: [
      { kind: 'text', text: 'These are the exact bytes the lab encoded and the Decode stage reads back. Nothing is uploaded: the file is made in your browser and handed to your downloads.' },
    ],
  };
}

function uploadCard(ctx: ExplainContext): Explanation {
  return {
    title: 'Use your own picture',
    value: 'Up to 512 px',
    body: 'Pick an image from your device, or drop one on the stage. It is scaled to fit 512 px and never leaves your browser.',
    consequence: `Your settings stay (quality ${ctx.quality}, ${MODES[ctx.subsampling].name} colour) and the lab encodes it at once.`,
    acts: true,
    details: [
      { kind: 'text', text: 'The browser opens the file and the lab shrinks it if either side is over 512 px. Transparent areas turn white, because JPEG has no transparency.' },
    ],
  };
}

/** `4`, `2.6`, `23`: seconds for people. */
function seconds(t: number): string {
  return t >= 10 ? String(Math.round(t)) : oneDecimal(t);
}

function speedCard(ctx: ExplainContext): Explanation {
  const s = ctx.summary;
  const n = ratio(ctx.speed);
  const secs = s && s.total > 0 && ctx.speed > 0 ? seconds(s.total / ctx.speed) : null;
  const mcu = s?.mcu ?? [...mcuSize(ctx.subsampling), 0, 0];
  return {
    title: 'Scan speed',
    value: `${n} per second`,
    body: secs ? `${n} blocks per second: the whole picture scans in ${secs} s.` : `${n} blocks per second.`,
    consequence: s
      ? `${count(s.n)} of ${count(s.total)} blocks scanned so far. This only sets how fast the replay runs; the file never changes.`
      : 'This only sets how fast the replay runs; the file never changes.',
    acts: true,
    details: [
      {
        kind: 'text',
        text: `The scan replays the way the file is written. Each step is one MCU, the smallest unit the file is written in: a ${mcu[0]} × ${mcu[1]} pixel square with this colour setting, holding the brightness blocks and the colour blocks for those pixels.`,
      },
    ],
  };
}

// --- Pictures ----------------------------------------------------------------

/** The line about the picture in use: what the settings make of it. */
function inUse(ctx: ExplainContext): string | null {
  const s = ctx.summary;
  if (!s) return null;
  return `${lead(ctx)} it compresses to ${formatBytes(s.bytes)} (${oneDecimal(s.rawBytes / Math.max(1, s.bytes))} times smaller than the raw pixels).`;
}

function ownPicture(ctx: ExplainContext): Explanation {
  const dims = sizeOf(ctx);
  return {
    title: 'Your own picture',
    value: dims ? `${dims.w} × ${dims.h} px` : undefined,
    body: 'A picture from your own files, scaled to fit 512 px. It never leaves your browser.',
    consequence: inUse(ctx) ?? 'Pick a gallery picture to compare.',
    acts: true,
    details: dims
      ? [
          { kind: 'rows', rows: [['Size', `${dims.w} × ${dims.h} px`], ['As raw pixels', `${formatBytes(dims.w * dims.h * 3)} (three bytes each)`]] },
          { kind: 'text', text: 'A share link cannot carry your picture, so it names the gradient instead.' },
        ]
      : [],
  };
}

/** A gallery picture, as the Picture select (the one in use) or a gallery tile (any). */
function pictureCard(id: ImageId | 'upload', ctx: ExplainContext, tile: boolean): Explanation | null {
  if (id === 'upload') return tile ? uploadCard(ctx) : ownPicture(ctx);
  const im = IMAGES.find((p) => p.id === id);
  if (!im) return null;
  const current = ctx.imageId === id;
  const dims = current && ctx.image ? { w: ctx.image.w, h: ctx.image.h } : (im.file ?? { w: BUILTIN_SIDE, h: BUILTIN_SIDE });
  const raw = dims.w * dims.h * 3;
  const rows: [string, string][] = [
    ['Size', `${dims.w} × ${dims.h} px`],
    ['As raw pixels', `${formatBytes(raw)} (${count(raw)} bytes)`],
    ['Group', GROUP_LABELS[im.group]],
  ];
  if (im.credit) rows.push(['Credit', `${im.credit.title} by ${im.credit.author} (${im.credit.licence})`]);
  const now = inUse(ctx);
  let consequence: string;
  if (tile && !current) consequence = `Click to switch to it. Your settings stay (quality ${ctx.quality}, ${MODES[ctx.subsampling].name} colour).`;
  else if (now) consequence = tile ? `The picture in use. ${now}` : now;
  else consequence = 'The picture in use.';
  return {
    title: im.label,
    value: `${dims.w} × ${dims.h} px`,
    body: `${im.title}.`,
    consequence,
    acts: true,
    details: [
      { kind: 'rows', rows },
      { kind: 'text', text: im.file ? 'A bundled picture, loaded when you choose it.' : 'Drawn by the lab itself, pixel by pixel, so it needs no file.' },
    ],
  };
}

// --- Readout -----------------------------------------------------------------

function sizeCard(ctx: ExplainContext): Explanation | null {
  const s = ctx.summary;
  if (!s) return null;
  const r = readoutOf(s);
  return {
    title: 'File size',
    value: `${r.size} of ${r.of}`,
    body: `The JPEG file takes ${r.size}. The same picture as raw pixels (three bytes each) would take ${r.of}.`,
    consequence: `${lead(ctx)} with ${MODES[ctx.subsampling].name} colour, the file is ${percent(s.bytes / Math.max(1, s.rawBytes))} of the raw size.`,
    details: [
      { kind: 'rows', rows: [['File', `${count(s.bytes)} bytes`], ['Raw pixels', `${count(s.rawBytes)} bytes`], ['Picture', `${s.width} × ${s.height} px`]] },
      { kind: 'text', text: 'Raw pixels spend 24 bits (3 bytes) on every pixel. The file spends only what the coded blocks, tables and headers need.' },
    ],
  };
}

function ratioCard(ctx: ExplainContext): Explanation | null {
  const s = ctx.summary;
  if (!s || s.bytes <= 0) return null;
  const r = readoutOf(s);
  const times = oneDecimal(s.rawBytes / s.bytes);
  return {
    title: 'Compression ratio',
    value: r.ratio,
    body: `The file is 1/${times} of the raw size: the raw pixels take ${times} times the space.`,
    consequence: `${lead(ctx)} with ${MODES[ctx.subsampling].name} colour. Lower quality makes this number bigger and the picture rougher.`,
    details: [
      { kind: 'rows', rows: [['Raw pixels', `${count(s.rawBytes)} bytes`], ['File', `${count(s.bytes)} bytes`], ['Raw ÷ file', r.ratio]] },
    ],
  };
}

function bppCard(ctx: ExplainContext): Explanation | null {
  const s = ctx.summary;
  if (!s) return null;
  const px = Math.max(1, s.width * s.height);
  const bpp = readoutOf(s).bpp;
  const raw = (8 * s.rawBytes) / px;
  return {
    title: 'Bits per pixel',
    value: `${bpp} bits per pixel`,
    body: `What one pixel costs on average in this file. Raw pixels cost ${oneDecimal(raw)} bits each.`,
    consequence: `${lead(ctx)} with ${MODES[ctx.subsampling].name} colour, each pixel averages ${bpp} bits.`,
    details: [
      { kind: 'rows', rows: [['File bits', count(8 * s.bytes)], ['Pixels', count(px)], ['Bits per pixel', bpp]] },
      { kind: 'text', text: 'Flat areas cost almost nothing and busy ones cost a lot, so this is an average over the whole picture.' },
    ],
  };
}

/** What a PSNR means, in plain words. */
function psnrWords(psnr: number | null): string {
  if (psnr == null || !Number.isFinite(psnr)) return 'A perfect copy: every pixel is identical to the original.';
  const at = db(psnr);
  if (psnr >= 40) return `At ${at} you can't see the difference between the copy and the original.`;
  if (psnr >= 30) return `At ${at} it is a close copy: any difference is small and you have to look hard to find it.`;
  if (psnr >= 25) return `At ${at} the differences show if you look for them, mostly on edges and fine detail.`;
  return `At ${at} the damage is obvious: blocks, smearing or colour shifts are easy to see.`;
}

function psnrCard(ctx: ExplainContext): Explanation | null {
  const s = ctx.summary;
  if (!s) return null;
  const finite = s.psnr != null && Number.isFinite(s.psnr);
  const alt = ctx.quality > 20 ? 20 : 90;
  const p = ctx.rd.find((r) => r.quality === alt);
  const details: Detail[] = [
    { kind: 'text', text: 'PSNR (peak signal-to-noise ratio) compares the decoded copy with the original, sample by sample. It is measured on a logarithmic scale, so every 10 dB is ten times less average squared error.' },
    { kind: 'tex', tex: '\\mathrm{PSNR} = 10 \\log_{10} \\frac{255^2}{\\mathrm{MSE}}' },
  ];
  const rows: [string, string][] = [];
  if (finite) rows.push(['Average squared error (MSE)', ((255 * 255) / 10 ** (s.psnr! / 10)).toFixed(2)]);
  rows.push(['Above 40 dB', "you can't see the difference"], ['30 to 40 dB', 'a close copy'], ['25 to 30 dB', 'visible on a close look'], ['Below 25 dB', 'obvious']);
  details.push({ kind: 'rows', rows });
  return {
    title: 'PSNR',
    value: db(s.psnr),
    body: `How close the JPEG copy is to the original${GLOSS}. ${psnrWords(s.psnr)}`,
    consequence: p
      ? `${lead(ctx)} with ${MODES[ctx.subsampling].name} colour. Quality ${alt} would give ${db(Number.isFinite(p.psnr) ? p.psnr : null)} at ${formatBytes(p.bytes)}.`
      : `${lead(ctx)} with ${MODES[ctx.subsampling].name} colour. Raising quality pushes this up; lowering it pulls it down.`,
    details,
  };
}

function customCard(ctx: ExplainContext): Explanation {
  const t = ctx.customTables;
  if (!t) {
    return {
      title: 'Custom tables',
      body: `Not in use: the rounding steps are scaled from quality ${ctx.quality}. Editing a cell of the table on the Quantize stage makes your own tables, which override quality.`,
      consequence: 'Apply an edit on the Quantize stage to try it.',
      details: [],
    };
  }
  const span = (a: number[]) => `${Math.min(...a)} to ${Math.max(...a)}`;
  return {
    title: 'Custom tables',
    value: `Luma steps ${span(t[0])}`,
    body: 'You edited the table of rounding steps, so your tables override quality: moving the slider changes nothing until you go back.',
    consequence: `Press Standard to go back to the tables scaled from quality ${ctx.quality}.`,
    details: [
      {
        kind: 'rows',
        rows: [['Brightness table steps', span(t[0])], ['Colour table steps', span(t[1])]],
      },
      { kind: 'text', text: 'Each cell of a table is how coarsely one pattern is rounded. The Quality slider scales the standard tables; your edited ones are used as they are.' },
    ],
  };
}

// --- The stage rail ------------------------------------------------------------

/** What happens at `stage`, in one plain sentence, and a line about this picture and these settings. */
function stageLines(stage: StageId, ctx: ExplainContext): { body: string; consequence: string } {
  const s = ctx.summary;
  const b = blockOf(ctx);
  const dims = sizeOf(ctx);
  const mode = MODES[ctx.subsampling];
  switch (stage) {
    case 'overview':
      return {
        body: 'Everything at a glance: the original, the JPEG copy, how much smaller the file is and what was lost.',
        consequence: s
          ? `${lead(ctx)}: ${formatBytes(s.bytes)} instead of ${formatBytes(s.rawBytes)}, at ${db(s.psnr)}.`
          : `Settings: quality ${ctx.quality}, ${mode.name} colour.`,
      };
    case 'color':
      return {
        body: "Each pixel's red, green and blue are rewritten as one brightness value and two colour differences, so the next steps can treat them separately.",
        consequence: dims ? `All ${count(dims.w * dims.h)} pixels of this ${dims.w} × ${dims.h} picture are converted.` : 'Every pixel is converted.',
      };
    case 'subsample':
      return {
        body: 'The eye notices detail in brightness more than in colour, so the two colour planes are kept at a lower resolution.',
        consequence: dims
          ? `${mode.name} keeps ${percent(mode.share)} of the colour detail: ${count(planeSamples(dims.w, dims.h, ctx.subsampling))} samples per colour plane instead of ${count(dims.w * dims.h)}.`
          : `${mode.name} keeps ${percent(mode.share)} of the colour detail.`,
      };
    case 'blocks': {
      const g = s?.grids[0];
      return {
        body: 'Each plane is cut into 8 × 8 tiles, and every later step works on one tile at a time.',
        consequence: g && g[0] > 0 ? `This picture has ${g[0]} × ${g[1]} brightness blocks (${count(g[0] * g[1])} in all).` : 'Every plane is cut into 8 × 8 tiles.',
      };
    }
    case 'dct':
      return {
        body: 'Each tile is rewritten as a weighted sum of 64 cosine patterns, from flat to finely striped.',
        consequence: b
          ? `You are following the ${planeWord(b.sel.component)} block (${b.sel.bx}, ${b.sel.by}): its 64 samples become 64 pattern amounts.`
          : 'Click the picture to follow one block.',
      };
    case 'quantize':
      return {
        body: 'Each pattern amount is divided by a step from a table and rounded to a whole number. This is the step where detail is thrown away.',
        consequence: b ? `${lead(ctx)}: ${survivors(b)} of this block's 64 patterns survive the rounding.` : `${lead(ctx)}.`,
      };
    case 'zigzag': {
      const zz = b?.sel.zigzag ?? [];
      const last = zz.reduce((acc, v, i) => (v !== 0 ? i : acc), -1);
      return {
        body: 'The 64 rounded numbers are read in a zigzag from flat to fine, so the zeros that rounding made end up together at the end.',
        consequence:
          zz.length !== 64
            ? 'The zeros end up together at the end.'
            : last < 0
              ? 'In this block every number is zero.'
              : `In this block the last non-zero number is #${last + 1} of 64, so ${plural(63 - last, 'zero')} follow it.`,
      };
    }
    case 'rle': {
      const n = b?.sel.tokens.length;
      return {
        body: 'Runs of zeros are replaced by a count, so a long stretch of nothing costs a few bits.',
        consequence: n != null ? `This block is written as ${plural(n, 'token')}, each a run of zeros and the number after it.` : 'Each token is a run of zeros and the number after it.',
      };
    }
    case 'huffman':
      return {
        body: 'The symbols that occur most get short codes and the rare ones get long codes, so the whole picture takes fewer bits.',
        consequence: s
          ? `With ${ctx.huffman} codes, the codes alone take ${count(s.codeBits)} bits; no code could do better than ${count(Math.round(s.entropyBits))}.`
          : `${ctx.huffman === 'optimized' ? 'Optimized' : 'Standard'} codes are in use.`,
      };
    case 'decode':
      return {
        body: 'Undo it all: read the file back into pixels and compare it with the original.',
        consequence: s ? `The copy scores ${db(s.psnr)}${GLOSS}.` : 'Compare the copy with the original.',
      };
  }
}

function railCard(stage: StageId, ctx: ExplainContext): Explanation | null {
  const info = STAGES.find((x) => x.id === stage);
  if (!info) return null;
  const { body, consequence } = stageLines(stage, ctx);
  const here = ctx.stage === stage;
  return {
    title: /^[1-8]$/.test(info.mark) ? `Step ${info.mark}: ${info.title}` : info.title,
    body,
    consequence: `${here ? 'You are here. ' : ''}${consequence}`,
    acts: true,
    details: [
      { kind: 'text', text: `${info.subtitle}.${info.ready ? '' : ' Coming soon.'} Click to go there, or use the left and right arrow keys to walk the pipeline.` },
    ],
  };
}

// --- A pixel of the stage image ---------------------------------------------------

/** BT.601 full-range (JFIF) RGB to YCbCr, as `jpeg::color::rgb_to_ycbcr` does it: unrounded 0-255 values. */
export function rgbToYcbcr(r: number, g: number, b: number): [number, number, number] {
  return [
    0.299 * r + 0.587 * g + 0.114 * b,
    128 - 0.168736 * r - 0.331264 * g + 0.5 * b,
    128 + 0.5 * r - 0.418688 * g - 0.081312 * b,
  ];
}

const clamp255 = (v: number) => Math.min(255, Math.max(0, Math.round(v)));

/** The colour sharing under each chroma mode, said about one pixel. */
const SHARING: Record<SubsamplingId, string> = {
  '444': 'At 4:4:4 its colour is kept exactly.',
  '422': 'At 4:2:2 its colour is averaged with the pixel beside it.',
  '420': 'At 4:2:0 its colour is averaged with the pixels in its 2 × 2 square.',
};

function pixelCard(x: number, y: number, ctx: ExplainContext): Explanation | null {
  const img = ctx.image;
  if (!img || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= img.w || y >= img.h) return null;
  const i = 4 * (y * img.w + x);
  const [r, g, b] = [img.rgba[i], img.rgba[i + 1], img.rgba[i + 2]];
  const [Y, cb, cr] = rgbToYcbcr(r, g, b).map(clamp255);
  const [bx, by] = [Math.floor(x / 8), Math.floor(y / 8)];
  const sel = ctx.summary?.selected;
  const [fh, fv] = ctx.subsampling === '444' ? [1, 1] : ctx.subsampling === '422' ? [2, 1] : [2, 2];
  const following = sel && (sel.component === 0 ? sel.bx === bx && sel.by === by : sel.bx === Math.floor(bx / fh) && sel.by === Math.floor(by / fv));
  const rows: [string, string][] = [
    ['Red, green, blue', `${r}, ${g}, ${b}`],
    ['Brightness (Y)', String(Y)],
    ['Blue tint (Cb)', String(cb)],
    ['Red tint (Cr)', String(cr)],
    ['Block', `(${bx}, ${by}) of the ${Math.ceil(img.w / 8)} × ${Math.ceil(img.h / 8)} grid`],
  ];
  const d = ctx.decoded;
  if (d && d.length === img.rgba.length) rows.push(['After JPEG', `${d[i]}, ${d[i + 1]}, ${d[i + 2]}`]);
  return {
    title: `Pixel (${x}, ${y})`,
    value: `RGB ${r}, ${g}, ${b}`,
    body: `As JPEG sees it: brightness ${Y}, blue tint ${cb}, red tint ${cr} (128 is neutral). It sits in block (${bx}, ${by}).`,
    consequence: `${following ? 'You are already following this block.' : 'Click to follow this block through every stage.'} ${SHARING[ctx.subsampling]}`,
    acts: true,
    details: [
      { kind: 'text', text: 'JPEG does not store red, green and blue. It stores brightness (Y) and two colour differences (Cb and Cr), worked out with the full-range BT.601 weights, and a block is the 8 × 8 tile this pixel belongs to.' },
      { kind: 'rows', rows },
    ],
  };
}

/** The card for a target of the bezel, readout, rail, gallery or stage image; null for an id this module does not own. */
export function explainBezel(t: Target, ctx: ExplainContext): Explanation | null {
  switch (t.id) {
    case 'bezel.picture':
      return pictureCard(ctx.imageId, ctx, false);
    case 'bezel.upload':
      return uploadCard(ctx);
    case 'bezel.quality':
      return qualityCard(ctx);
    case 'bezel.chroma':
      return chromaCard(ctx, t.mode);
    case 'bezel.huffman':
      return huffmanCard(ctx, t.mode);
    case 'bezel.save':
      return saveCard(ctx);
    case 'bezel.speed':
      return speedCard(ctx);
    case 'rail.stage':
      return railCard(t.stage, ctx);
    case 'readout.size':
      return sizeCard(ctx);
    case 'readout.ratio':
      return ratioCard(ctx);
    case 'readout.bpp':
      return bppCard(ctx);
    case 'readout.psnr':
      return psnrCard(ctx);
    case 'chip.custom':
      return customCard(ctx);
    case 'gallery.tile':
      return pictureCard(t.picture, ctx, true);
    case 'image.pixel':
      return pixelCard(t.x, t.y, ctx);
    default:
      return null;
  }
}
