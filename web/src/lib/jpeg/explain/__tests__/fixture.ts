// A context for the explainer tests: the summary fixture's block (DCT
// [120, −20, −20, 0…], table all 16s) at quality 50, 4:2:0, optimized Huffman.
import { jpegInspectFixture, jpegSummaryFixture } from '../../../test/fakeViz';
import { readSegments, readTables } from '../../huffman';
import { readSummary } from '../../summary';
import type { ExplainContext } from '../context';

export function makeContext(overrides: Partial<ExplainContext> = {}): ExplainContext {
  const side = 256;
  return {
    summary: readSummary(jpegSummaryFixture),
    stage: 'dct',
    imageId: 'spring',
    image: { w: side, h: side, rgba: new Uint8Array(side * side * 4).fill(200) },
    decoded: new Uint8Array(side * side * 4).fill(198),
    quality: 50,
    subsampling: '420',
    huffman: 'optimized',
    customTables: null,
    speed: 1,
    dctK: 64,
    wipe: 0.5,
    errorGain: 8,
    huffTables: readTables(jpegInspectFixture.huffman),
    segments: readSegments(jpegInspectFixture.segments),
    rd: [],
    otherBytes: null,
    resave: [],
    jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    ...overrides,
  };
}
