// Each stage's formula (TeX) with live numbers for the selected block, and a
// one-line "notice" for the reader. Only numbers are interpolated into TeX.
import type { StageId } from './stages';
import type { JpegSummary } from './summary';

const COMPONENT = ['Y', 'C_b', 'C_r'];

const fmt = (v: number, digits = 0) => (Math.abs(v) < 1e-9 ? '0' : v.toFixed(digits));

export const COLOR_TEX = String.raw`\begin{bmatrix} Y \\ C_b \\ C_r \end{bmatrix} =
\begin{bmatrix} 0.299 & 0.587 & 0.114 \\ -0.1687 & -0.3313 & 0.5 \\ 0.5 & -0.4187 & -0.0813 \end{bmatrix}
\begin{bmatrix} R \\ G \\ B \end{bmatrix} + \begin{bmatrix} 0 \\ 128 \\ 128 \end{bmatrix}`;

export const DCT_TEX = String.raw`F(u,v) = \tfrac14\, C(u)\, C(v) \sum_{x=0}^{7} \sum_{y=0}^{7} f(x,y)\, \cos\frac{(2x+1)u\pi}{16}\, \cos\frac{(2y+1)v\pi}{16}`;

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
    default:
      return [];
  }
}

/** What to look for on each stage. */
export const NOTICE: Record<StageId, string> = {
  color:
    'Y looks like the picture itself; Cb and Cr are flat and soft. Turn the cube: the grey diagonal becomes the Y axis, and most pixels huddle close to it.',
  subsample:
    'Half the data is gone in 4:2:0, and you can barely tell — the eye resolves brightness far more finely than colour.',
  blocks:
    'From here on the image is a pile of independent 8 × 8 problems, 64 numbers each. Click anywhere on the image to follow a different block.',
  dct:
    'A handful of low-frequency patterns carry almost all the energy. Slide k up from 0 and watch the block appear long before all 64 terms are in.',
  quantize: '',
  zigzag: '',
  rle: '',
  huffman: '',
  decode: '',
};
