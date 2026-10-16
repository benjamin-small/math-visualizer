// Where the lab's pictures come from: the generated built-ins (made in Rust
// by the kit, so the engine, the tests and the page all see the same pixels)
// and the reader's own uploads, decoded by the browser and scaled down to fit
// `MAX_SIDE`.
import { loadVizCore } from '../wasm/loader';
import type { ImageId } from './params';

/** RGBA pixels, 4 bytes each, top row first. */
export interface RgbaImage {
  /** Width in pixels. */
  w: number;
  /** Height in pixels. */
  h: number;
  /** `w × h × 4` bytes, row-major. */
  rgba: Uint8Array;
}

/** Side of the built-ins. */
export const BUILTIN_SIDE = 256;
/** Uploads are scaled down so neither side exceeds this. */
export const MAX_SIDE = 512;

/** The built-in pictures the lab offers, in picker order, with the line shown on hover. */
export const IMAGES: readonly { id: ImageId; label: string; title: string }[] = [
  { id: 'gradient', label: 'Gradient', title: 'A smooth sky: low quality shows blocks' },
  { id: 'text', label: 'Text', title: 'Hard black-on-white edges: low quality rings' },
  { id: 'bars', label: 'Bars', title: 'Saturated colour: subsampling bleeds' },
];

/** A generated built-in at `BUILTIN_SIDE²`. */
export async function loadBuiltin(id: ImageId): Promise<RgbaImage> {
  const viz = await loadVizCore();
  return { w: BUILTIN_SIDE, h: BUILTIN_SIDE, rgba: viz.jpeg_builtin_image(id, BUILTIN_SIDE, BUILTIN_SIDE) };
}

/** The size an `w × h` upload is scaled to: unchanged when it fits, else shrunk to fit `max` keeping its shape. */
export function fitWithin(w: number, h: number, max = MAX_SIDE): { w: number; h: number } {
  if (!(w > 0 && h > 0)) return { w: 0, h: 0 };
  const s = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

/**
 * Decode an uploaded file with the browser and scale it to fit `MAX_SIDE`.
 * Rejects (with a reader-facing message) when the file is not an image the
 * browser can open.
 */
export async function decodeUpload(file: Blob): Promise<RgbaImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('That file is not an image this browser can open.');
  }
  const { w, h } = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    bitmap.close();
    throw new Error('This browser cannot read image pixels.');
  }
  // JPEG has no alpha: paint white first so transparent areas are not black.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const data = ctx.getImageData(0, 0, w, h).data;
  return { w, h, rgba: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
}
