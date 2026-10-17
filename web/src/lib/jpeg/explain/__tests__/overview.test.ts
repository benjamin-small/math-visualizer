import { describe, expect, it } from 'vitest';
import { explain } from '..';
import { makeContext } from './fixture';

const ctx = (o = {}) => makeContext({ stage: 'overview', ...o });
const text = (e: NonNullable<ReturnType<typeof explain>>) => [e.title, e.value, e.body, e.consequence].join(' ');

describe('Overview cards', () => {
  it('counts the raw bytes at a value', () => {
    const e = explain({ id: 'overview.hist', kind: 'raw', bin: 200 }, ctx())!;
    expect(e.value).toBe('196,608 bytes');
    expect(e.body).toContain('100% of all 196,608');
    expect(e.consequence).toContain('0.00 of 8 bits');
    const none = explain({ id: 'overview.hist', kind: 'raw', bin: 7 }, ctx())!;
    expect(none.value).toBe('0 bytes');
  });

  it('counts the samples that differ from their left neighbour by a step', () => {
    const e = explain({ id: 'overview.hist', kind: 'diff', bin: 0 }, ctx())!;
    expect(e.value).toBe('195,840 samples');
    expect(e.body).toContain('differ from their left neighbour by 0');
    expect(e.consequence).toContain('99%');
    // Bin 200 is a wrapped step: 200 - 256 = -56 (the first column compares with 0).
    const wrapped = explain({ id: 'overview.hist', kind: 'diff', bin: 200 }, ctx())!;
    expect(wrapped.value).toBe('768 samples');
    expect(wrapped.body).toContain('by −56');
    expect(wrapped.body).toContain('a step down of 56 levels');
    expect(explain({ id: 'overview.hist', kind: 'diff', bin: 3 }, ctx())!.body).toContain('by +3');
  });

  it('counts the bytes of the file at a value', () => {
    const e = explain({ id: 'overview.hist', kind: 'jpeg', bin: 255 }, ctx())!;
    expect(e.value).toBe('2 bytes');
    expect(e.body).toContain('2 bytes of the file have the value 255');
    expect(explain({ id: 'overview.hist', kind: 'jpeg', bin: 1 }, ctx({ jpeg: null }))).toBeNull();
    expect(explain({ id: 'overview.hist', kind: 'raw', bin: 256 }, ctx())).toBeNull();
    expect(explain({ id: 'overview.hist', kind: 'raw', bin: 1.5 }, ctx())).toBeNull();
    expect(explain({ id: 'overview.hist', kind: 'raw', bin: 1 }, ctx({ image: null }))).toBeNull();
  });

  it('says how much room there is left to squeeze', () => {
    const jpeg = explain({ id: 'overview.entropy', kind: 'jpeg' }, ctx())!;
    expect(jpeg.value).toBe('1.50 bits per byte');
    expect(jpeg.consequence).toContain('room to squeeze');
    expect(explain({ id: 'overview.entropy', kind: 'raw' }, ctx())!.consequence).toContain('up to 100% smaller');
    const even = Uint8Array.from({ length: 1024 }, (_, i) => i & 255);
    expect(explain({ id: 'overview.entropy', kind: 'jpeg' }, ctx({ jpeg: even }))!.consequence).toContain('almost no room left to squeeze');
    expect(explain({ id: 'overview.entropy', kind: 'jpeg' }, ctx({ jpeg: null }))).toBeNull();
  });

  it('keeps the jargon for the unfolded part', () => {
    const e = explain({ id: 'overview.entropy', kind: 'diff' }, ctx())!;
    expect(text(e)).not.toMatch(/entropy/i);
    expect(JSON.stringify(e.details)).toMatch(/entropy/i);
  });

  it('puts the file against the raw pixels', () => {
    const e = explain({ id: 'overview.sizes' }, ctx())!;
    expect(e.value).toBe('4 B of 192.0 KB');
    expect(e.consequence).toContain('At quality 50 with 4:2:0 colour');
    expect(e.consequence).toContain('49152.0 : 1');
    const early = explain({ id: 'overview.sizes' }, ctx({ jpeg: null, summary: null }))!;
    expect(early.body).toContain('still being made');
    expect(early.consequence).toContain('192.0 KB');
  });

  it('shows a pixel before and after JPEG, and the difference', () => {
    const orig = explain({ id: 'overview.pixel', which: 'original', x: 0, y: 0 }, ctx())!;
    expect(orig.value).toBe('RGB 200, 200, 200');
    expect(orig.consequence).toContain('198, 198, 198');
    const dec = explain({ id: 'overview.pixel', which: 'decoded', x: 0, y: 0 }, ctx())!;
    expect(dec.value).toBe('RGB 198, 198, 198');
    expect(dec.body).toContain('200, 200, 200');
    expect(dec.body).toContain('a difference of 2');
    expect(explain({ id: 'overview.pixel', which: 'decoded', x: 256, y: 0 }, ctx())).toBeNull();
  });

  it('says the copy is still being decoded rather than guess', () => {
    const dec = explain({ id: 'overview.pixel', which: 'decoded', x: 0, y: 0 }, ctx({ decoded: null }))!;
    expect(dec.body).toContain('still being decoded');
    expect(text(dec)).not.toContain('198');
    expect(dec.consequence).toContain('200, 200, 200');
    expect(explain({ id: 'overview.pixel', which: 'original', x: 0, y: 0 }, ctx({ decoded: null }))!.value).toBe('RGB 200, 200, 200');
  });
});
