// Everything in the JPEG lab that can carry a card, named by a stable id. The
// inventory in the design maps one line to one id; `TARGET_IDS` lists them all
// so a coverage test can check each is registered and explained.
import type { ImageId } from '../params';
import type { StageId } from '../stages';
import type { ExplainContext } from './context';

export type Target =
  | { id: 'bezel.picture' | 'bezel.upload' | 'bezel.quality' | 'bezel.chroma' | 'bezel.huffman' | 'bezel.save' | 'bezel.speed' }
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
  | { id: 'decode.hint'; kind: 'blocking' | 'ringing' | 'bleed' }
  | { id: 'decode.resave'; generation: number };

/** Every target id, once. */
export const TARGET_IDS: readonly Target['id'][] = [
  'bezel.picture',
  'bezel.upload',
  'bezel.quality',
  'bezel.chroma',
  'bezel.huffman',
  'bezel.save',
  'bezel.speed',
  'rail.stage',
  'readout.size',
  'readout.ratio',
  'readout.bpp',
  'readout.psnr',
  'chip.custom',
  'image.pixel',
  'overview.pixel',
  'overview.sizes',
  'overview.hist',
  'overview.entropy',
  'gallery.tile',
  'color.cube',
  'color.axes',
  'color.plane',
  'subsample.plane',
  'subsample.kept',
  'blocks.cell',
  'blocks.component',
  'blocks.shift',
  'dct.coeff',
  'dct.atlas',
  'dct.k',
  'dct.energy',
  'dct.cosines',
  'quantize.before',
  'quantize.table',
  'quantize.after',
  'quantize.editor',
  'quantize.rebuild',
  'quantize.rd',
  'quantize.dot',
  'zigzag.grid',
  'zigzag.seq',
  'zigzag.last',
  'rle.token',
  'rle.dc',
  'rle.bits',
  'huffman.tab',
  'huffman.cost',
  'huffman.bar',
  'huffman.leaf',
  'huffman.bits',
  'huffman.segment',
  'decode.wipe',
  'decode.error',
  'decode.wipeSlider',
  'decode.gainSlider',
  'decode.hint',
  'decode.resave',
];

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
