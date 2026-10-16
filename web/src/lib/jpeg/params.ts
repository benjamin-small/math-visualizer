// The JPEG lab's settings and its share link:
//   #/jpeg?img=text&q=30&s=444&h=std&stage=dct&b=12,7
// Defaults are omitted from the link, and anything malformed falls back to its
// default rather than failing the page.
import { buildQuery } from '../router';
import { DEFAULT_STAGE, readyStage, type StageId } from './stages';

export type ImageId = 'gradient' | 'text' | 'bars';
export type SubsamplingId = '444' | '422' | '420';
export type HuffmanId = 'optimized' | 'standard';

export const IMAGE_IDS: readonly ImageId[] = ['gradient', 'text', 'bars'];

export interface JpegParams {
  img: ImageId;
  /** 1–100. */
  quality: number;
  subsampling: SubsamplingId;
  huffman: HuffmanId;
  stage: StageId;
  /** The selected luma block `[bx, by]`; undefined → the encoder's default (the centre). */
  block?: [number, number];
}

export const DEFAULTS: JpegParams = {
  img: 'gradient',
  quality: 50,
  subsampling: '420',
  huffman: 'optimized',
  stage: DEFAULT_STAGE,
};

/** Quality from a link or a slider: a whole number in 1–100 (50 when unreadable). */
export function clampQuality(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return DEFAULTS.quality;
  return Math.min(100, Math.max(1, Math.round(n)));
}

export function parseParams(query: string): JpegParams {
  const p = new URLSearchParams(query);
  const img = p.get('img');
  const s = p.get('s');
  const block = p
    .get('b')
    ?.split(',')
    .map((v) => Number(v));
  return {
    img: (IMAGE_IDS as readonly string[]).includes(img ?? '') ? (img as ImageId) : DEFAULTS.img,
    quality: p.has('q') ? clampQuality(p.get('q')) : DEFAULTS.quality,
    subsampling: s === '444' || s === '422' || s === '420' ? s : DEFAULTS.subsampling,
    huffman: p.get('h') === 'std' ? 'standard' : 'optimized',
    stage: readyStage(p.get('stage')),
    block:
      block && block.length === 2 && block.every((v) => Number.isInteger(v) && v >= 0)
        ? [block[0], block[1]]
        : undefined,
  };
}

export function buildParams(p: JpegParams): string {
  return buildQuery({
    img: p.img === DEFAULTS.img ? undefined : p.img,
    q: p.quality === DEFAULTS.quality ? undefined : String(p.quality),
    s: p.subsampling === DEFAULTS.subsampling ? undefined : p.subsampling,
    h: p.huffman === 'standard' ? 'std' : undefined,
    stage: p.stage === DEFAULTS.stage ? undefined : p.stage,
    b: p.block ? p.block.join(',') : undefined,
  });
}

/** MCU size in pixels for a subsampling mode. */
export function mcuSize(s: SubsamplingId): [number, number] {
  return s === '444' ? [8, 8] : s === '422' ? [16, 8] : [16, 16];
}

/** How many MCUs a `w × h` image has — the engine clock's length. */
export function mcuCount(w: number, h: number, s: SubsamplingId): number {
  const [mw, mh] = mcuSize(s);
  return Math.ceil(w / mw) * Math.ceil(h / mh);
}
