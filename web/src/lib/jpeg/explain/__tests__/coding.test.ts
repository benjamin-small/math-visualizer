import { describe, expect, it } from 'vitest';
import { explain } from '..';
import { bitParts } from '../coding';
import { makeContext } from './fixture';

/** The summary fixture as the lab's own tests see it: only the DC stays non-zero after rounding. */
function dcOnly(over = {}) {
  const ctx = makeContext(over);
  const sel = ctx.summary!.selected!;
  sel.quant = sel.quant.map((_, i) => (i === 0 ? 8 : 0));
  sel.zigzag = sel.zigzag.map((_, i) => (i === 0 ? 8 : 0));
  return ctx;
}

const all = (e: NonNullable<ReturnType<typeof explain>>) => [e.title, e.value, e.body, e.consequence].join(' | ');

describe('Zigzag cards', () => {
  it('gives a sequence cell its position and value', () => {
    const e = explain({ id: 'zigzag.seq', k: 0 }, dcOnly({ stage: 'zigzag' }))!;
    expect(e.body).toContain('#1 of 64');
    expect(e.value).toBe('8');
    expect(e.consequence).toContain('stays non-zero after rounding');
  });

  it('says a late cell is in the zero tail', () => {
    const e = explain({ id: 'zigzag.seq', k: 5 }, dcOnly({ stage: 'zigzag' }))!;
    expect(e.value).toBe('0');
    expect(e.consequence).toContain('in the zero tail');
    expect(e.consequence).toContain('#2');
    expect(explain({ id: 'zigzag.seq', k: 64 }, makeContext())).toBeNull();
  });

  it('gives a grid cell its zigzag position', () => {
    const e = explain({ id: 'zigzag.grid', u: 1, v: 0 }, dcOnly({ stage: 'zigzag' }))!;
    expect(e.value).toBe('#2 of 64');
    expect(e.consequence).toBe('At quality 50 this one rounds to 0, and it sits in the zero tail.');
    expect(explain({ id: 'zigzag.grid', u: 0, v: 0 }, makeContext())!.value).toBe('#1 of 64');
  });

  it('names the last non-zero number and the tail after it', () => {
    const e = explain({ id: 'zigzag.last' }, dcOnly({ stage: 'zigzag' }))!;
    expect(e.value).toBe('#1 of 64');
    expect(e.consequence).toBe('At quality 50 63 numbers after it are zero and dropped from the file.');
  });
});

describe('Run-length cards', () => {
  it('explains the end-of-block token and shows its bits', () => {
    const e = explain({ id: 'rle.token', i: 0 }, makeContext({ stage: 'rle' }))!;
    expect(e.body).toContain('every remaining number is zero');
    expect(e.consequence).toContain('1010');
    expect(e.consequence).toContain('4 bits');
    expect(explain({ id: 'rle.token', i: 1 }, makeContext())).toBeNull();
  });

  it('spells out a run token with its place in the scan', () => {
    const ctx = makeContext({ stage: 'rle' });
    ctx.summary!.selected!.tokens = [
      { run: 0, size: 1, amp: -1, symbol: 0x01, code: '00', ampBits: '0' },
      { run: 2, size: 2, amp: 3, symbol: 0x22, code: '1101', ampBits: '11' },
      { run: 0, size: 0, amp: 0, symbol: 0, code: '1010', ampBits: '' },
    ];
    const e = explain({ id: 'rle.token', i: 1 }, ctx)!;
    expect(e.value).toBe('Skip 2 zeros, then 3 (needs 2 bits)');
    expect(e.consequence).toBe('Written as 6 bits: the optimized code 1101, then 11.');
    const place = e.details.flatMap((d) => (d.kind === 'rows' ? d.rows : [])).find(([k]) => k === 'Place in the scan')!;
    expect(place[1]).toBe('#5 of 64, pattern (1, 1)'); // 1 + (0+1) + 2 zeros skipped = index 4
    expect(explain({ id: 'rle.token', i: 0 }, ctx)!.value).toBe('Skip 0 zeros, then −1 (needs 1 bit)');
  });

  it('does not print a place for a token that runs past the block', () => {
    const ctx = makeContext({ stage: 'rle' });
    ctx.summary!.selected!.tokens = [{ run: 14, size: 1, amp: 1, symbol: 0xe1, code: '1', ampBits: '1' }, { run: 14, size: 1, amp: 1, symbol: 0xe1, code: '1', ampBits: '1' }, { run: 14, size: 1, amp: 1, symbol: 0xe1, code: '1', ampBits: '1' }, { run: 14, size: 1, amp: 1, symbol: 0xe1, code: '1', ampBits: '1' }, { run: 14, size: 1, amp: 1, symbol: 0xe1, code: '1', ampBits: '1' }];
    const e = explain({ id: 'rle.token', i: 4 }, ctx)!;
    const rows = e.details.flatMap((d) => (d.kind === 'rows' ? d.rows : []));
    expect(rows.map(([k]) => k)).not.toContain('Place in the scan');
    expect(JSON.stringify(e)).not.toContain('NaN');
    expect(e.body).toContain('their count goes inside the token\'s code');
    expect(e.body).not.toContain('cost nothing');
  });

  it('explains the DC change', () => {
    const e = explain({ id: 'rle.dc' }, makeContext({ stage: 'rle' }))!;
    expect(e.value).toBe('8 − 6 = 2');
    expect(e.consequence).toBe('A change of 2 needs 2 bits: the optimized code 011, then 10.');
  });

  it('counts the bits of the block', () => {
    const e = explain({ id: 'rle.bits' }, makeContext({ stage: 'rle' }))!;
    expect(e.value).toBe('2 tokens, 9 bits');
    expect(e.consequence).toContain('9 bits instead of the 512');
  });
});

describe('Huffman cards', () => {
  const h = (over = {}) => makeContext({ stage: 'huffman', ...over });

  it('reads a histogram bar with its code', () => {
    const e = explain({ id: 'huffman.bar', table: 1, symbol: 0 }, h())!;
    expect(e.body).toContain('appears 30 times');
    expect(e.body).toContain('its code is 00 (2 bits)');
    expect(e.consequence).toBe('30 × 2 = 60 bits: 75% of this table\'s code bits.');
    expect(explain({ id: 'huffman.bar', table: 1, symbol: 9 }, h())).toBeNull();
    expect(explain({ id: 'huffman.bar', table: 9, symbol: 0 }, h())).toBeNull();
  });

  it('reads a tree leaf', () => {
    const e = explain({ id: 'huffman.leaf', table: 1, symbol: 1 }, h())!;
    expect(e.value).toBe('0/1 = 01');
    expect(e.body).toContain('left, right');
    expect(e.consequence).toContain('10 times');
  });

  it('prices the codes against the limit', () => {
    const e = explain({ id: 'huffman.cost', table: 0 }, h())!;
    expect(e.value).toBe('80 bits against 32.5');
    expect(e.consequence).toContain('146.2% over');
    expect(e.consequence).toContain('built from this picture\'s own counts');
    const std = explain({ id: 'huffman.cost', table: 0 }, h({ huffman: 'standard', otherBytes: 3000 }))!;
    expect(std.consequence).toContain('With optimized tables the whole file would be 3,000 bytes instead of 4,096');
  });

  it('says what a table tab holds', () => {
    const e = explain({ id: 'huffman.tab', table: 3 }, h())!;
    expect(e.acts).toBe(true);
    expect(e.title).toBe('AC · chroma');
    expect(e.body).toContain('colour block');
    expect(e.consequence).toContain('2 of its symbols, 40 times in all');
  });

  it('says which token a run of bits belongs to', () => {
    const sel = h().summary!.selected!;
    expect(bitParts(sel).map((p) => p.text)).toEqual(['011', '10', '1010']);
    const dcCode = explain({ id: 'huffman.bits', part: 0 }, h())!;
    expect(dcCode.value).toBe('011');
    expect(dcCode.consequence).toBe('Bits 100-102 of the scan: part 1 of 3, in this block\'s 9 bits.');
    const dcAmp = explain({ id: 'huffman.bits', part: 1 }, h())!;
    expect(dcAmp.body).toContain('10 means 2');
    const eob = explain({ id: 'huffman.bits', part: 2 }, h())!;
    expect(eob.title).toBe('Bits: the code for end of block');
    expect(explain({ id: 'huffman.bits', part: 3 }, h())).toBeNull();
  });

  it('says what a file segment holds and its size', () => {
    const e = explain({ id: 'huffman.segment', i: 2 }, h())!;
    expect(e.value).toContain('the scan: 3,958 bytes');
    expect(e.consequence).toBe('3,958 of the file\'s 4,096 bytes: 97%.');
    expect(explain({ id: 'huffman.segment', i: 9 }, h())).toBeNull();
    expect(all(explain({ id: 'huffman.segment', i: 1 }, h())!)).toContain('step sizes (quantization tables)');
  });

  it('never prints a broken value', () => {
    const ctx = h();
    for (const t of [
      { id: 'zigzag.last' },
      { id: 'rle.dc' },
      { id: 'huffman.tab', table: 0 },
      { id: 'huffman.cost', table: 1 },
      { id: 'huffman.leaf', table: 0, symbol: 0 },
    ] as const) {
      expect(all(explain(t, ctx)!), t.id).not.toMatch(/undefined|NaN|\[object/);
    }
  });
});
