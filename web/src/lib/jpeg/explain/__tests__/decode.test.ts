import { describe, expect, it } from 'vitest';
import { explain } from '..';
import { makeContext } from './fixture';

const ctx = (o = {}) => makeContext({ stage: 'decode', ...o });
const text = (e: NonNullable<ReturnType<typeof explain>>) => [e.title, e.value, e.body, e.consequence].join(' ');

describe('Decode cards', () => {
  it('shows the error before it is brightened, in levels', () => {
    const e = explain({ id: 'decode.error', x: 0, y: 0 }, ctx())!;
    expect(e.value).toBe('2 levels');
    expect(e.body).toContain('before the map brightens it');
    expect(e.consequence).toContain('× 8');
    expect(e.consequence).toContain('16 of 255');
  });

  it('shows the average of the three channel differences, as the map draws it', () => {
    const decoded = new Uint8Array(256 * 256 * 4).fill(200);
    decoded.set([203, 200, 190, 255], 0);
    const e = explain({ id: 'decode.error', x: 0, y: 0 }, ctx({ decoded }))!;
    expect(e.value).toBe('4 levels'); // (3 + 0 + 10) / 3 = 4.33
    expect(e.body).toContain('On average');
    expect(e.body).toContain('red 3, green 0, blue 10');
    expect(explain({ id: 'decode.error', x: 1, y: 0 }, ctx({ decoded }))!.value).toBe('0 levels');
  });

  it('draws the average at the gain, in the warm tint the viz uses', () => {
    const image = { w: 256, h: 256, rgba: new Uint8Array(256 * 256 * 4).fill(100) };
    const decoded = new Uint8Array(256 * 256 * 4).fill(100);
    decoded.set([110, 100, 101, 255], 0);
    const e = explain({ id: 'decode.error', x: 0, y: 0 }, ctx({ image, decoded, errorGain: 4 }))!;
    expect(e.value).toBe('4 levels'); // (10 + 0 + 1) / 3 = 3.67
    expect(e.consequence).toContain('drawn at 16 of 255');
    expect(e.consequence).toContain('strongest tint');
    const rows = JSON.stringify(e.details);
    expect(rows).toContain('(e, 0.55e, 0.25e) × gain');
    expect(rows).toContain('16, 8, 4'); // round(3.67), round(3.67 × 0.55), round(3.67 × 0.25), each times 4
    expect(rows).toContain('Largest single difference');
  });

  it('rounds as the viz does: the unrounded mean times the tint, stored whole, then the gain', () => {
    const image = { w: 256, h: 256, rgba: new Uint8Array(256 * 256 * 4).fill(100) };
    const decoded = new Uint8Array(256 * 256 * 4).fill(100);
    decoded.set([103, 105, 101, 255], 0); // differences 3, 5, 1: the mean is 3
    const e = explain({ id: 'decode.error', x: 0, y: 0 }, ctx({ image, decoded, errorGain: 8 }))!;
    expect(e.value).toBe('3 levels');
    expect(JSON.stringify(e.details)).toContain('24, 16, 8'); // 3 -> 24; round(1.65) = 2 -> 16; round(0.75) = 1 -> 8
    expect(e.consequence).toContain('drawn at 24 of 255');
  });

  it('says the copy is still being decoded rather than guess the error', () => {
    const e = explain({ id: 'decode.error', x: 0, y: 0 }, ctx({ decoded: null }))!;
    expect(e.body).toContain('still being decoded');
    expect(e.value).toBeUndefined();
    expect(e.consequence).toContain('× 8');
    expect(explain({ id: 'decode.error', x: 999, y: 0 }, ctx())).toBeNull();
  });

  it('shows both pixels of the wipe and which side of the line it is on', () => {
    const left = explain({ id: 'decode.wipe', x: 10, y: 0 }, ctx())!;
    expect(left.value).toBe('Decoded 198, 198, 198; original 200, 200, 200');
    expect(left.body).toContain('decoded side');
    const right = explain({ id: 'decode.wipe', x: 200, y: 0 }, ctx())!;
    expect(right.body).toContain('original side');
    expect(left.consequence).toContain('50%');
    expect(explain({ id: 'decode.wipe', x: 10, y: 0 }, ctx({ decoded: null }))!.body).toContain('still being decoded');
  });

  it('explains the two sliders with their numbers', () => {
    const wipe = explain({ id: 'decode.wipeSlider' }, ctx({ wipe: 0.25 }))!;
    expect(wipe.acts).toBe(true);
    expect(wipe.value).toBe('25% decoded');
    expect(wipe.consequence).toContain('left 25%');
    const gain = explain({ id: 'decode.gainSlider' }, ctx({ errorGain: 8 }))!;
    expect(gain.acts).toBe(true);
    expect(gain.value).toBe('× 8');
    expect(gain.consequence).toContain('average error of 32 levels or more');
    expect(gain.consequence).toContain('full strength');
    expect(gain.consequence).not.toContain('white');
  });

  it('says which block a hint picks and why', () => {
    const e = explain({ id: 'decode.hint', kind: 'blocking' }, ctx())!;
    expect(e.acts).toBe(true);
    expect(e.value).toBe('Block (3, 4)');
    expect(e.body).toContain('borders');
    expect(e.consequence).toContain('Click to follow it');
    expect(explain({ id: 'decode.hint', kind: 'bleed' }, ctx())!.value).toBe('Block (7, 8)');
  });

  it('scores a hint from the decoded pixels when it has them', () => {
    // A flat 200 against a flat 198: no border step, a luma error of 2 and no colour error.
    const ring = explain({ id: 'decode.hint', kind: 'ringing' }, ctx())!;
    expect(ring.consequence).toContain('moved by 2.0 levels on average');
    const block = explain({ id: 'decode.hint', kind: 'blocking' }, ctx())!;
    expect(block.consequence).toContain('0.0 levels');
    expect(explain({ id: 'decode.hint', kind: 'ringing' }, ctx({ decoded: null }))!.consequence).not.toContain('on average');
  });

  it('says the picture has no hard edges when ringing has no block', () => {
    const base = ctx();
    const e = explain({ id: 'decode.hint', kind: 'ringing' }, { ...base, summary: { ...base.summary!, hints: { blocking: [3, 4], ringing: null, bleed: [7, 8] } } })!;
    expect(e.acts).toBe(true);
    expect(e.body).toContain('no hard edges');
    expect(e.consequence).toContain('64');
    expect(e.value).toBeUndefined();
    expect(explain({ id: 'decode.hint', kind: 'bleed' }, { ...base, summary: { ...base.summary!, hints: null } })).toBeNull();
  });

  it('gives a re-save generation and its distance from the first save', () => {
    const e = explain({ id: 'decode.resave', generation: 3 }, ctx({ resave: [30, 28, 27] }))!;
    expect(e.value).toBe('Generation 3: 27.0 dB');
    expect(e.body).toContain('(higher is closer)');
    expect(e.consequence).toContain('3.0 dB lower than the first save (30.0 dB)');
    const first = explain({ id: 'decode.resave', generation: 1 }, ctx({ resave: [30, 28, 27] }))!;
    expect(first.consequence).toContain('first save');
    const same = explain({ id: 'decode.resave', generation: 2 }, ctx({ resave: [30, 30, 30] }))!;
    expect(same.consequence).toContain('almost nothing');
    expect(explain({ id: 'decode.resave', generation: 4 }, ctx({ resave: [30, 28, 27] }))).toBeNull();
    expect(first.body).toContain('opening the picture once with');
    expect(e.body).toContain('opening the picture 3 times in a row with');
    expect(explain({ id: 'decode.resave', generation: 1 }, ctx({ resave: [Infinity] }))!.value).toBe('Generation 1: ∞ dB');
  });

  it('never leaves a card without a number or a setting', () => {
    for (const t of [{ id: 'decode.wipeSlider' }, { id: 'decode.gainSlider' }] as const) {
      expect(text(explain(t, ctx())!)).toMatch(/\d/);
    }
  });
});
