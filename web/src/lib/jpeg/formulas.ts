// Each stage's formula (TeX) with live numbers for the selected block, and a
// one-line "notice" for the reader. Only numbers are interpolated into TeX.
import type { StageId } from './stages';
import type { JpegSummary } from './summary';

const COMPONENT = ['Y', 'C_b', 'C_r'];

const fmt = (v: number, digits = 0) => (Math.abs(v) < 1e-9 ? '0' : v.toFixed(digits));

/** The overview's formula: Shannon entropy of a byte histogram, in bits per byte (8 means no better than random). */
export const ENTROPY_TEX = String.raw`H = -\sum_{b=0}^{255} p_b \log_2 p_b \;\text{bits per byte}`;

/** The Color stage's formula: RGB to YCbCr as the standard matrix plus offset (static; no per-pixel RGB is available). */
export const COLOR_TEX = String.raw`\begin{bmatrix} Y \\ C_b \\ C_r \end{bmatrix} =
\begin{bmatrix} 0.299 & 0.587 & 0.114 \\ -0.1687 & -0.3313 & 0.5 \\ 0.5 & -0.4187 & -0.0813 \end{bmatrix}
\begin{bmatrix} R \\ G \\ B \end{bmatrix} + \begin{bmatrix} 0 \\ 128 \\ 128 \end{bmatrix}`;

/** The 8 × 8 forward DCT as written in the JPEG standard. */
export const DCT_TEX = String.raw`F(u,v) = \tfrac14\, C(u)\, C(v) \sum_{x=0}^{7} \sum_{y=0}^{7} f(x,y)\, \cos\frac{(2x+1)u\pi}{16}\, \cos\frac{(2y+1)v\pi}{16}`;

/** The Quantize stage's formula: divide by the table entry and round; the table is the base table scaled by the quality `q`. */
export const QUANT_TEX = String.raw`F_Q(u,v) = \operatorname{round}\!\left(\frac{F(u,v)}{Q(u,v)}\right),\qquad Q = \left\lfloor \frac{Q_{\text{base}}\cdot s + 50}{100} \right\rfloor,\; s = \begin{cases} 5000/q & q < 50 \\ 200 - 2q & q \ge 50 \end{cases}`;

/** The Run-length stage's formula: a value's size category, and a token as (zero run, size) followed by that many amplitude bits. */
export const SIZE_TEX = String.raw`\text{size}(v) = \lceil \log_2(|v| + 1) \rceil,\qquad \text{token} = (\text{run of zeros},\ \text{size})\ \text{then size bits of } v`;

/** The Huffman stage's formula: a symbol's ideal code length is −log₂ of its probability, so the scan needs at least the entropy sum. */
export const CODE_TEX = String.raw`\text{code length}(x) \approx -\log_2 p(x),\qquad \text{bits} \ge \sum_x n_x \log_2 \frac{N}{n_x}`;

/** The Decode stage's formula: PSNR from the mean squared error over all colour samples. */
export const PSNR_TEX = String.raw`\text{MSE} = \frac{1}{3wh}\sum (\hat I - I)^2,\qquad \text{PSNR} = 10 \log_{10} \frac{255^2}{\text{MSE}}`;

/** Zigzag index of the last non-zero value (−1 when all are zero). */
export function lastNonZero(zigzag: readonly number[]): number {
  for (let k = zigzag.length - 1; k >= 0; k--) if (zigzag[k] !== 0) return k;
  return -1;
}

/** Share of the chroma samples a mode keeps (each of Cb and Cr). */
export function chromaKept(subsampling: string | null): number {
  return subsampling === '444' ? 1 : subsampling === '422' ? 0.5 : 0.25;
}

/** Share of all samples (Y + Cb + Cr) a mode keeps. */
export function samplesKept(subsampling: string | null): number {
  return (1 + 2 * chromaKept(subsampling)) / 3;
}

/** The formula for `stage`, with the selected block's numbers where the stage has them. */
export function stageTex(stage: StageId, s: JpegSummary | null, hover: [number, number] | null): string[] {
  const sel = s?.selected ?? null;
  switch (stage) {
    case 'overview':
      return [ENTROPY_TEX];
    case 'color':
      return [COLOR_TEX];
    case 'subsample': {
      const keep = chromaKept(s?.subsampling ?? null);
      const avg =
        s?.subsampling === '444'
          ? String.raw`C'(i,j) = C(i,j)`
          : s?.subsampling === '422'
            ? String.raw`C'(i,j) = \tfrac12\,[\,C(2i,j) + C(2i{+}1,j)\,]`
            : String.raw`C'(i,j) = \tfrac14\,[\,C(2i,2j) + C(2i{+}1,2j) + C(2i,2j{+}1) + C(2i{+}1,2j{+}1)\,]`;
      return [avg, String.raw`\text{chroma kept} = ${Math.round(keep * 100)}\%,\quad \text{all samples kept} = ${Math.round(samplesKept(s?.subsampling ?? null) * 100)}\%`];
    }
    case 'blocks': {
      if (!sel) return [String.raw`f(x,y) = \text{sample}(x,y) - 128`];
      const c = COMPONENT[sel.component] ?? 'Y';
      return [String.raw`f(0,0) = ${c}(0,0) - 128 = ${fmt(sel.pixels[0])} - 128 = ${fmt(sel.shifted[0])}`];
    }
    case 'dct': {
      if (!sel) return [DCT_TEX];
      const [u, v] = hover ?? [0, 0];
      const val = sel.dct[u + 8 * v];
      const cu = u === 0 ? String.raw`\tfrac{1}{\sqrt2}` : '1';
      const cv = v === 0 ? String.raw`\tfrac{1}{\sqrt2}` : '1';
      return [DCT_TEX, String.raw`F(${u},${v}) = \tfrac14 \cdot ${cu} \cdot ${cv} \sum \sum f(x,y)\cos\cdots = ${fmt(val, 1)}`];
    }
    case 'quantize': {
      if (!sel) return [QUANT_TEX];
      const [u, v] = hover ?? [0, 0];
      const i = u + 8 * v;
      return [
        QUANT_TEX,
        String.raw`F_Q(${u},${v}) = \operatorname{round}\!\left(\frac{${fmt(sel.dct[i], 1)}}{${fmt(sel.table[i])}}\right) = ${fmt(sel.quant[i])}`,
      ];
    }
    case 'zigzag': {
      if (!sel) return [];
      const last = lastNonZero(sel.zigzag);
      return [
        String.raw`\text{scan order: } (0,0),\,(1,0),\,(0,1),\,(0,2),\,(1,1),\,(2,0),\,\ldots,\,(7,7)`,
        last < 0
          ? String.raw`\text{all 64 are zero}`
          : String.raw`\text{last non-zero} = \#${last + 1}\text{ of }64,\quad ${63 - last}\text{ zeros follow}`,
      ];
    }
    case 'rle': {
      if (!sel) return [SIZE_TEX];
      return [
        SIZE_TEX,
        String.raw`\Delta DC = ${fmt(sel.quant[0])} - (${fmt(sel.dcPrev)}) = ${fmt(sel.dcDiff)},\quad \text{size} = ${sel.dcSize}`,
      ];
    }
    case 'huffman': {
      if (!s) return [CODE_TEX];
      // The codes alone are bounded by the entropy; the payload adds each value's amplitude bits.
      const codes = Math.round(s.codeBits);
      const payload = Math.round(s.payloadBits);
      return [
        CODE_TEX,
        String.raw`\text{codes: } ${codes}\text{ bits} \ge ${Math.round(s.entropyBits)}\text{ bits (Shannon bound)},\quad ${codes} + ${payload - codes}\text{ amplitude bits} = ${payload}\text{ bits written}`,
      ];
    }
    case 'decode': {
      if (!s) return [PSNR_TEX];
      const psnr = s.psnr == null ? String.raw`\infty` : String.raw`${fmt(s.psnr, 1)}\text{ dB}`;
      return [PSNR_TEX, String.raw`\text{PSNR} = ${psnr}`];
    }
    default:
      return [];
  }
}

/** What to look for on each stage. */
export const NOTICE: Record<StageId, string> = {
  overview:
    'Raw pixel bytes look almost random, so the first histogram tells you little. Subtract each sample from its left neighbour and the pattern gives itself away: the differences pile up near zero. The JPEG file looks random again, which is what good compression leaves behind, but there are far fewer bytes of it.',
  color:
    'Y looks like the picture itself; Cb and Cr are flat and soft. Turn the cube: the grey diagonal becomes the Y axis, and most pixels huddle close to it.',
  subsample:
    'Half the data is gone in 4:2:0, and you can barely tell — the eye resolves brightness far more finely than colour.',
  blocks:
    'From here on the image is a pile of independent 8 × 8 problems, 64 numbers each. Click anywhere on the image to follow a different block.',
  dct:
    'A handful of low-frequency patterns carry almost all the energy. Slide k up from 0 and watch the block appear long before all 64 terms are in.',
  quantize:
    'Most of the loss happens here: each coefficient is divided by its table entry and rounded. The high-frequency corner has big entries, so it rounds to zero first. Edit a cell and apply it to see the whole image respond.',
  zigzag:
    'Reading the grid along the zigzag puts the low frequencies first, so the zeros the rounding made gather into one long tail at the end.',
  rle:
    'Sixty-four numbers become a handful of tokens: each says how many zeros to skip and how big the next number is, and one end-of-block token stands for the whole tail of zeros.',
  huffman:
    'Common symbols get short codes and rare ones long codes, so the file comes close to the entropy limit. Switch between optimized and standard tables to see what tailoring the codes to this image saves.',
  decode:
    'Undo every step and compare. Blocking, ringing and colour bleed are each the fingerprint of a step you have already seen; the hints jump to where each is worst.',
};
