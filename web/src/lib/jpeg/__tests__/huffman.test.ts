import { describe, it, expect } from 'vitest';
import { nodeXY, readSegments, readTables, readTree, symbolLabel, topCounts } from '../huffman';
import { jpegInspectFixture } from '../../test/fakeViz';

describe('huffman view data', () => {
  it('reads the four tables and the segments', () => {
    const t = readTables(jpegInspectFixture.huffman);
    expect(t.map((x) => x.name)).toEqual(['dc_luma', 'ac_luma', 'dc_chroma', 'ac_chroma']);
    expect(t[0]).toMatchObject({ vals: [0, 1], entropyBits: 32.5, actualBits: 80 });
    expect(t[0].codes[1]).toEqual({ symbol: 1, code: '01' });
    expect(t[0].counts).toEqual([
      [0, 30],
      [1, 10],
    ]);
    const s = readSegments(jpegInspectFixture.segments);
    expect(s.map((x) => x.kind)).toEqual(['Soi', 'Dqt', 'Sos', 'Eoi']);
    expect(s.reduce((n, x) => n + x.len, 0)).toBe(4096);
  });

  it('turns junk into empty lists and safe defaults', () => {
    expect(readTables(undefined)).toEqual([]);
    expect(readSegments({})).toEqual([]);
    expect(readTables([null, { name: 3 }])).toEqual([{ name: '', bits: [], vals: [], codes: [], counts: [], entropyBits: 0, actualBits: 0 }]);
    expect(readTree('x')).toEqual([]);
  });

  it('names symbols the way the reader thinks of them', () => {
    expect(symbolLabel('dc_luma', 5)).toBe('size 5');
    expect(symbolLabel('ac_luma', 0x00)).toBe('EOB');
    expect(symbolLabel('ac_chroma', 0xf0)).toBe('ZRL');
    expect(symbolLabel('ac_luma', 0x23)).toBe('2/3');
  });

  it('ranks counts most frequent first, ties by symbol, up to a limit', () => {
    expect(
      topCounts(
        [
          [4, 1],
          [2, 9],
          [1, 9],
          [7, 3],
        ],
        3,
      ),
    ).toEqual([
      [1, 9],
      [2, 9],
      [7, 3],
    ]);
  });

  it('places tree nodes by depth (down) and code as a binary fraction (across)', () => {
    expect(nodeXY('', 100, 40, 4)).toEqual([50, 0]);
    expect(nodeXY('0', 100, 40, 4)).toEqual([25, 10]);
    expect(nodeXY('11', 100, 40, 4)).toEqual([87.5, 20]);
    // Siblings sit either side of their parent.
    const [px] = nodeXY('01', 100, 40, 4);
    expect(nodeXY('010', 100, 40, 4)[0]).toBeLessThan(px);
    expect(nodeXY('011', 100, 40, 4)[0]).toBeGreaterThan(px);
  });
});
