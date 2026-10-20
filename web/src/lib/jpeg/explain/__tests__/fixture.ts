// A context for the explainer tests: the summary fixture's block (DCT
// [120, −20, −20, 0…], table all 16s) at quality 50, 4:2:0, optimized Huffman.
import { jpegInspectFixture, jpegSummaryFixture } from '../../../test/fakeViz';
import { readSegments, readTables } from '../../huffman';
import { readSummary } from '../../summary';
import { ZIGZAG, roundHalfAway } from '../quality';
import type { ExplainContext } from '../context';

/**
 * The summary fixture, with `quant` and `zigzag` made consistent with its DCT and table: round(dct / 16), halves away
 * from zero. Its samples carry a fraction, as the engine's do (colour conversion is not rounded), so a card that shows
 * one unrounded fails here.
 */
function summaryOf(component = 0) {
  const s = readSummary(jpegSummaryFixture)!;
  const sel = s.selected!;
  const quant = sel.dct.map((c, i) => roundHalfAway(c / sel.table[i]));
  const pixels = sel.pixels.map((p) => p + 0.383);
  const shifted = pixels.map((p) => p - 128);
  return { ...s, selected: { ...sel, component, pixels, shifted, quant, zigzag: ZIGZAG.map((i) => quant[i]) } };
}

/** A context whose selected block is in plane `component` (0 = Y, 1 = Cb, 2 = Cr); `overrides` apply on top. */
export function makeContext(overrides: Partial<ExplainContext> & { component?: number } = {}): ExplainContext {
  const { component, ...rest } = overrides;
  const side = 256;
  return {
    summary: summaryOf(component ?? 0),
    stage: 'dct',
    imageId: 'spring',
    image: { w: side, h: side, rgba: new Uint8Array(side * side * 4).fill(200) },
    decoded: new Uint8Array(side * side * 4).fill(198),
    quality: 50,
    subsampling: '420',
    huffman: 'optimized',
    customTables: null,
    speed: 1,
    playing: false,
    dctK: 64,
    wipe: 0.5,
    decodeZoom: 4,
    errorGain: 8,
    huffTables: readTables(jpegInspectFixture.huffman),
    segments: readSegments(jpegInspectFixture.segments),
    rd: [],
    otherBytes: null,
    resave: [],
    jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    ...rest,
  };
}
