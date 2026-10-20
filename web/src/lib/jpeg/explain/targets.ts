// Everything in the JPEG lab that can carry a card, named by a stable id. The
// inventory in the design maps one line to one id; `TARGET_IDS` lists them all
// so a coverage test can check each is registered and explained.
import type { HuffmanId, ImageId, SubsamplingId } from '../params';
import type { StageId } from '../stages';
import type { TourStepId } from '../tour';
import type { ExplainContext } from './context';

export type Target =
  | { id: 'bezel.picture' | 'bezel.upload' | 'bezel.quality' | 'bezel.save' | 'bezel.speed' }
  /** The shell's transport buttons and its "n / total" readout. */
  | { id: 'bezel.play' | 'bezel.reset' | 'bezel.position' }
  | { id: 'bezel.step'; dir: 'back' | 'forward' }
  /** `mode` is the option being pointed at; without it, the one in use. */
  | { id: 'bezel.chroma'; mode?: SubsamplingId }
  | { id: 'bezel.huffman'; mode?: HuffmanId }
  | { id: 'rail.stage'; stage: StageId }
  | { id: 'readout.size' | 'readout.ratio' | 'readout.bpp' | 'readout.psnr' | 'chip.custom' }
  | { id: 'image.pixel'; x: number; y: number }
  | { id: 'overview.pixel'; which: 'original' | 'decoded'; x: number; y: number }
  | { id: 'overview.sizes' }
  | { id: 'overview.hist'; kind: 'raw' | 'diff' | 'jpeg'; bin: number }
  | { id: 'overview.entropy'; kind: 'raw' | 'diff' | 'jpeg' }
  | { id: 'gallery.tile'; picture: ImageId | 'upload' }
  | { id: 'color.cube' | 'color.axes' }
  | { id: 'color.plane'; plane: 0 | 1 | 2; x: number; y: number }
  | { id: 'subsample.plane'; which: 'full' | 'coded'; plane: 1 | 2; x: number; y: number }
  | { id: 'subsample.kept' }
  | { id: 'blocks.cell'; x: number; y: number }
  | { id: 'blocks.component' | 'blocks.shift' }
  | { id: 'dct.coeff' | 'dct.atlas'; u: number; v: number }
  | { id: 'dct.k' }
  | { id: 'dct.energy'; k: number }
  | { id: 'dct.cosines'; chart: string; i: number }
  | { id: 'quantize.before' | 'quantize.table' | 'quantize.after' | 'quantize.editor'; u: number; v: number }
  | { id: 'quantize.rebuild'; x: number; y: number }
  | { id: 'quantize.rd'; quality: number }
  | { id: 'quantize.dot' }
  | { id: 'zigzag.grid'; u: number; v: number }
  | { id: 'zigzag.seq'; k: number }
  | { id: 'zigzag.last' }
  | { id: 'rle.token'; i: number }
  | { id: 'rle.dc' | 'rle.bits' }
  | { id: 'huffman.tab' | 'huffman.cost'; table: number }
  | { id: 'huffman.bar' | 'huffman.leaf'; table: number; symbol: number }
  | { id: 'huffman.bits'; part: number }
  | { id: 'huffman.segment'; i: number }
  | { id: 'decode.wipe' | 'decode.error'; x: number; y: number }
  | { id: 'decode.wipeSlider' | 'decode.gainSlider' }
  /** A chip of the decode stage's zoom control: `factor` is the one pointed at (1 = the whole picture). */
  | { id: 'decode.zoom'; factor: number }
  | { id: 'decode.hint'; kind: 'blocking' | 'ringing' | 'bleed' }
  | { id: 'decode.resave'; generation: number }
  /** The guided tour: a step on its strip, its quality slider, and the lab's button that opens it. */
  | { id: 'tour.step'; step: TourStepId }
  | { id: 'tour.quality'; quality: number }
  | { id: 'tour.open' };

/** Every target id, once. A `Record` over the union's ids, so a missing or extra id is a type error. */
const ID_SET: Record<Target['id'], true> = {
  'bezel.picture': true,
  'bezel.upload': true,
  'bezel.quality': true,
  'bezel.chroma': true,
  'bezel.huffman': true,
  'bezel.save': true,
  'bezel.speed': true,
  'bezel.play': true,
  'bezel.reset': true,
  'bezel.step': true,
  'bezel.position': true,
  'rail.stage': true,
  'readout.size': true,
  'readout.ratio': true,
  'readout.bpp': true,
  'readout.psnr': true,
  'chip.custom': true,
  'image.pixel': true,
  'overview.pixel': true,
  'overview.sizes': true,
  'overview.hist': true,
  'overview.entropy': true,
  'gallery.tile': true,
  'color.cube': true,
  'color.axes': true,
  'color.plane': true,
  'subsample.plane': true,
  'subsample.kept': true,
  'blocks.cell': true,
  'blocks.component': true,
  'blocks.shift': true,
  'dct.coeff': true,
  'dct.atlas': true,
  'dct.k': true,
  'dct.energy': true,
  'dct.cosines': true,
  'quantize.before': true,
  'quantize.table': true,
  'quantize.after': true,
  'quantize.editor': true,
  'quantize.rebuild': true,
  'quantize.rd': true,
  'quantize.dot': true,
  'zigzag.grid': true,
  'zigzag.seq': true,
  'zigzag.last': true,
  'rle.token': true,
  'rle.dc': true,
  'rle.bits': true,
  'huffman.tab': true,
  'huffman.cost': true,
  'huffman.bar': true,
  'huffman.leaf': true,
  'huffman.bits': true,
  'huffman.segment': true,
  'decode.wipe': true,
  'decode.error': true,
  'decode.wipeSlider': true,
  'decode.gainSlider': true,
  'decode.zoom': true,
  'decode.hint': true,
  'decode.resave': true,
  'tour.step': true,
  'tour.quality': true,
  'tour.open': true,
};

/** Every target id, once. */
export const TARGET_IDS: readonly Target['id'][] = Object.keys(ID_SET) as Target['id'][];

/**
 * What a pinned card is about: the picture, the stage, and the selected
 * block with its plane. A pinned card closes when this changes, rather than
 * show numbers for something no longer on screen. The target does not
 * matter: two targets in the same scope share a key.
 */
export function scopeKey(_t: Target, ctx: ExplainContext): string {
  const sel = ctx.summary?.selected;
  const block = sel ? `${sel.component}:${sel.bx},${sel.by}` : 'none';
  return `${ctx.imageId}|${ctx.stage}|${block}`;
}
