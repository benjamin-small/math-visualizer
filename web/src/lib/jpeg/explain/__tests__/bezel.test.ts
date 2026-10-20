import { describe, expect, it } from 'vitest';
import { IMAGES } from '../../images';
import { STAGES } from '../../stages';
import { explain } from '../index';
import { rgbToYcbcr, saveFileName } from '../bezel';
import { makeContext } from './fixture';
import type { Explanation } from '../types';
import type { Target } from '../targets';

const card = (t: Target, ctx = makeContext()): Explanation => {
  const e = explain(t, ctx);
  expect(e).not.toBeNull();
  return e!;
};
const text = (e: Explanation) => [e.title, e.value, e.body, e.consequence].filter(Boolean).join(' | ');
const detailText = (e: Explanation) =>
  e.details.map((d) => (d.kind === 'text' ? d.text : d.kind === 'rows' ? d.rows.map((r) => r.join(' ')).join(' ') : '')).join(' ');

describe('bezel.quality', () => {
  it('says what the number does to the table', () => {
    const e = card({ id: 'bezel.quality' });
    expect(e.value).toBe('50');
    expect(e.body).toContain('every table entry is scaled by 100%');
    expect(card({ id: 'bezel.quality' }, makeContext({ quality: 20 })).body).toContain('250%');
  });

  it('counts the block patterns that survive, from the slider alone', () => {
    // The fixture block: F(0,0)=120, F(1,0)=F(2,0)=-20, rest 0; steps 16, 11, 10 at quality 50.
    expect(card({ id: 'bezel.quality' }).consequence).toContain('3 of 64');
    // At quality 10 the steps are 5x larger: 120/80 -> 2, -20/55 -> 0, -20/50 -> 0.
    expect(card({ id: 'bezel.quality' }, makeContext({ quality: 10 })).consequence).toContain('1 of 64');
  });

  it('says the slider is idle while custom tables are in use', () => {
    const custom: [number[], number[]] = [Array(64).fill(3), Array(64).fill(7)];
    const e = card({ id: 'bezel.quality' }, makeContext({ customTables: custom }));
    expect(text(e)).toMatch(/override/i);
    expect(e.consequence).toMatch(/Standard/);
  });

  it('unfolds to the scaling formula and the file at this quality', () => {
    const e = card({ id: 'bezel.quality' });
    expect(e.details.some((d) => d.kind === 'tex')).toBe(true);
    expect(detailText(e)).toContain('4.0 KB');
    expect(detailText(e)).toContain('36.5 dB');
  });

  it('uses other qualities from the cached curve only', () => {
    const rd = [
      { quality: 20, bytes: 2048, psnr: 30.2 },
      { quality: 90, bytes: 20480, psnr: 45.1 },
    ];
    const withRd = detailText(card({ id: 'bezel.quality' }, makeContext({ rd })));
    expect(withRd).toContain('2.0 KB');
    expect(withRd).toContain('45.1 dB');
    expect(detailText(card({ id: 'bezel.quality' }))).not.toContain('45.1 dB');
  });
});

describe('wording', () => {
  const custom: [number[], number[]] = [Array(64).fill(3), Array(64).fill(7)];
  const everyCard = (ctx = makeContext()) =>
    (['bezel.save', 'readout.size', 'readout.ratio', 'readout.bpp', 'readout.psnr'] as const).map((id) => text(card({ id }, ctx)));

  it('never says "survive"', () => {
    expect(card({ id: 'bezel.quality' }).consequence).toContain('stay non-zero after rounding');
    expect(card({ id: 'rail.stage', stage: 'quantize' }).consequence).toContain('stay non-zero after rounding');
    expect(detailText(card({ id: 'bezel.quality' }))).not.toContain('survive');
  });

  it('does not double the "with" when the tables are the reader\'s own', () => {
    for (const t of everyCard(makeContext({ customTables: custom }))) expect(t).not.toMatch(/with your own tables with/i);
    expect(card({ id: 'bezel.save' }, makeContext({ customTables: custom })).consequence).toContain('With your own tables and 4:2:0 colour');
    expect(card({ id: 'readout.size' }).consequence).toContain('At quality 50 with 4:2:0 colour');
  });

  it('puts a comma after the quality when a clause follows', () => {
    for (const ctx of [makeContext(), makeContext({ customTables: custom })]) {
      const lines = [text(card({ id: 'bezel.reset' }, ctx)), text(card({ id: 'bezel.picture' }, ctx))].join(' ');
      expect(lines).not.toMatch(/(At quality \d+|With your own tables) (it|the)\b/);
    }
    expect(card({ id: 'bezel.reset' }).consequence).toContain('At quality 50, the file does not change.');
    expect(card({ id: 'bezel.picture' }).consequence).toContain('At quality 50, it compresses to');
  });

  it('says what quality 100 means, and that a step is never below 1', () => {
    const e = card({ id: 'bezel.quality' }, makeContext({ quality: 100 }));
    expect(e.body).toContain('scaled by 0%');
    expect(e.body).toContain('smallest possible, 1');
    expect(JSON.stringify(e.details)).toContain('never below');
  });

  it('offers no other-quality PSNR under custom tables', () => {
    const rd = [{ quality: 20, bytes: 2048, psnr: 27.5 }];
    expect(card({ id: 'readout.psnr' }, makeContext({ rd })).consequence).toContain('Quality 20 would give 27.5 dB');
    expect(card({ id: 'readout.psnr' }, makeContext({ rd, customTables: custom })).consequence).not.toContain('Quality 20');
  });
});

describe('bezel.chroma', () => {
  it.each([
    ['444', '100%'],
    ['422', '50%'],
    ['420', '25%'],
  ] as const)('at %s keeps %s of the colour detail', (subsampling, share) => {
    const e = card({ id: 'bezel.chroma' }, makeContext({ subsampling }));
    expect(e.body).toContain(`Keeps ${share} of the colour detail`);
    expect(e.body).toContain('brightness is kept in full');
  });

  it('counts the colour samples for this picture', () => {
    const e = card({ id: 'bezel.chroma' });
    expect(e.value).toBe('4:2:0');
    expect(e.consequence).toContain('16,384');
    expect(e.consequence).toContain('65,536');
    expect(detailText(e)).toContain('32,768'); // 4:2:2
  });
});

describe('options pointed at', () => {
  it('describes the chroma option under the pointer, and says how to switch', () => {
    const e = card({ id: 'bezel.chroma', mode: '444' });
    expect(e.value).toBe('4:4:4');
    expect(e.body).toContain('Keeps 100%');
    expect(e.consequence).toContain('65,536 per colour plane');
    expect(e.consequence).toContain('With 4:4:4, this 256 × 256 picture');
    expect(e.consequence).toContain('Click to switch');
    expect(card({ id: 'bezel.chroma', mode: '420' }).consequence).not.toContain('Click');
  });

  it('describes the Huffman option under the pointer', () => {
    const e = card({ id: 'bezel.huffman', mode: 'standard' }, makeContext({ otherBytes: 4608 }));
    expect(e.value).toBe('Standard');
    expect(e.consequence).toContain('the file would be 4.5 KB instead of 4.0 KB');
  });
});

describe('bezel.huffman', () => {
  it('names the mode and what it means', () => {
    expect(card({ id: 'bezel.huffman' }).body).toMatch(/own symbol counts/);
    expect(card({ id: 'bezel.huffman' }, makeContext({ huffman: 'standard' })).body).toMatch(/example tables from the standard/);
  });

  it('gives the size difference only when it is known', () => {
    expect(card({ id: 'bezel.huffman' }).consequence).toContain('4.0 KB');
    const e = card({ id: 'bezel.huffman' }, makeContext({ otherBytes: 4608 }));
    expect(e.consequence).toContain('512 B bigger');
    expect(card({ id: 'bezel.huffman' }, makeContext({ otherBytes: 3584 })).consequence).toContain('512 B smaller');
  });
});

describe('bezel.speed', () => {
  it('scans the picture in a number of seconds', () => {
    const e = card({ id: 'bezel.speed' }, makeContext({ speed: 64 }));
    expect(e.body).toContain('64 steps per second');
    expect(e.body).toContain('scans in 4 s');
  });

  it('says what a step is, from the current colour setting', () => {
    expect(card({ id: 'bezel.speed' }).consequence).toContain('16 × 16-pixel patch at 4:2:0');
    expect(card({ id: 'bezel.speed' }, makeContext({ subsampling: '444' })).consequence).toContain('8 × 8-pixel patch at 4:4:4');
    expect(card({ id: 'bezel.speed' }, makeContext({ subsampling: '422' })).consequence).toContain('16 × 8-pixel patch at 4:2:2');
    expect(text(card({ id: 'bezel.speed' }))).not.toMatch(/blocks/);
  });

  it('keeps one decimal for short scans', () => {
    expect(card({ id: 'bezel.speed' }, makeContext({ speed: 100 })).body).toContain('scans in 2.6 s');
  });
});

describe('the transport controls and the position readout', () => {
  const play = { id: 'bezel.play' } as const;
  const reset = { id: 'bezel.reset' } as const;
  const back = { id: 'bezel.step', dir: 'back' } as const;
  const forward = { id: 'bezel.step', dir: 'forward' } as const;
  const position = { id: 'bezel.position' } as const;
  /** A context with `n` of `total` steps scanned. */
  const withScan = (n: number, total: number) => {
    const s = makeContext().summary!;
    return makeContext({ summary: { ...s, n, total } });
  };

  it('Play says what playing does to the scan and where it is', () => {
    const e = card(play, makeContext({ speed: 64 }));
    expect(e.acts).toBe(true);
    expect(e.title).toBe('Play the scan');
    expect(e.value).toBe('Paused at step 64 of 256');
    expect(e.consequence).toContain('16 × 16-pixel patch at 4:2:0');
    expect(e.consequence).toContain('3 s'); // 192 steps left at 64 a second
  });

  it('turns into Pause while the scan runs', () => {
    const e = card(play, makeContext({ playing: true }));
    expect(e.title).toBe('Pause the scan');
    expect(e.value).toBe('Playing: step 64 of 256');
    expect(e.body).toMatch(/stays/);
  });

  it('says so at the end of the scan', () => {
    const e = card(play, withScan(256, 256));
    expect(e.body).toBe('The scan has reached the last block.');
    expect(e.consequence).not.toMatch(/NaN|Infinity/);
  });

  it('Reset rewinds the scan and leaves the picture encoded', () => {
    const e = card(reset);
    expect(e.acts).toBe(true);
    expect(e.body).toMatch(/rewinds the scan to the first block/i);
    expect(e.body).toMatch(/stays encoded/);
    expect(e.consequence).toContain('step 64 of 256');
    expect(card(reset, withScan(1, 256)).consequence).toBe('The scan is already at the first block.');
  });

  it('Back and Forward move one step, which is one patch', () => {
    const b = card(back);
    const f = card(forward);
    expect(b.acts && f.acts).toBe(true);
    expect(b.title).toBe('Step back');
    expect(f.title).toBe('Step forward');
    expect(b.body).toContain('one step');
    expect(b.body).toContain('16 × 16-pixel patch at 4:2:0');
    expect(b.consequence).toContain('step 63 of 256');
    expect(f.consequence).toContain('step 65 of 256');
    expect(card(back, makeContext({ subsampling: '444' })).body).toContain('8 × 8-pixel patch at 4:4:4');
  });

  it('Back and Forward say when there is nowhere to go', () => {
    expect(card(back, withScan(1, 256)).consequence).toBe('The scan is already at the first block.');
    expect(card(forward, withScan(256, 256)).consequence).toBe('The scan has reached the last block. Reset to scan again.');
  });

  it('says the overview has no scan to play', () => {
    const overview = makeContext({ stage: 'overview' });
    for (const t of [play, reset, back, forward]) {
      expect(card(t, overview).consequence).toBe(
        'The overview shows the whole picture at once, so the scan has nothing to show here. Pick a stage to follow it one block at a time.',
      );
    }
  });

  it('keeps Pause honest while the scan runs behind the overview', () => {
    const e = card(play, makeContext({ stage: 'overview', playing: true }));
    expect(e.title).toBe('Pause the scan');
    expect(e.consequence).toBe('The scan keeps running behind the overview. Pause stops it where it is.');
    expect(e.consequence).not.toContain('nothing to show');
  });

  it('keeps the live readout and details on the overview', () => {
    const overview = makeContext({ stage: 'overview' });
    for (const t of [play, reset, back, forward]) {
      const e = card(t, overview);
      expect(e.value).toMatch(/step 64 of 256/i);
      expect(e.details.length).toBeGreaterThan(0);
    }
  });

  it('treats step 1 as the start, and step 0 too', () => {
    expect(card(back, withScan(0, 256)).consequence).toBe('The scan is already at the first block.');
    expect(card(reset, withScan(0, 256)).consequence).toBe('The scan is already at the first block.');
    expect(card(back, withScan(2, 256)).consequence).toBe('From step 2 to step 1 of 256.');
    expect(card(reset, withScan(2, 256)).consequence).not.toContain('already');
  });

  it('says Reset at the end', () => {
    const end = withScan(256, 256);
    expect(card(play, end).consequence).toBe('All 256 steps are done. Reset to scan again.');
    expect(card(forward, end).consequence).toBe('The scan has reached the last block. Reset to scan again.');
  });

  it('says the panels follow the scan', () => {
    const e = card(play, withScan(64, 256));
    expect(e.body).toContain('the panels follow each block as it is scanned');
    expect(e.body).toBe(
      'Plays the scan: the lab walks across the picture one step at a time, in the order the file is written, and the panels follow each block as it is scanned.',
    );
  });

  it('the readout explains "n of total steps scanned"', () => {
    const e = card(position);
    expect(e.acts).toBeFalsy();
    expect(e.value).toBe('64 of 256 steps');
    expect(e.body).toContain('64 of 256 steps scanned');
    expect(e.consequence).toContain('25%');
    expect(e.consequence).toContain('16 × 16-pixel patch at 4:2:0');
  });

  it('keep to steps, not blocks, and say nothing wrong before the first encode', () => {
    for (const t of [play, reset, back, forward, position]) {
      expect(text(card(t))).not.toMatch(/blocks|iteration|MCU/);
      const none = explain(t, makeContext({ summary: null }));
      expect(none === null || !JSON.stringify(none).match(/NaN|undefined/)).toBe(true);
    }
  });
});

describe('bezel.save and bezel.upload', () => {
  it('names the file and its size', () => {
    const e = card({ id: 'bezel.save' });
    expect(e.value).toBe('jpeg-lab-q50-420.jpg');
    expect(e.body).toContain('4.0 KB');
    expect(e.body).toMatch(/any image viewer/);
    expect(card({ id: 'bezel.save' }, makeContext({ customTables: [Array(64).fill(1), Array(64).fill(1)] })).value).toBe('jpeg-lab-custom-420.jpg');
    expect(saveFileName(null, '422', 80)).toBe('jpeg-lab-q80-422.jpg');
  });

  it('says what happens to an uploaded picture', () => {
    const e = card({ id: 'bezel.upload' });
    expect(e.body).toContain('512 px');
    expect(e.body).toMatch(/never leaves your browser/);
    expect(e.consequence).toContain('quality 50');
    expect(e.acts).toBe(true);
  });
});

describe('bezel.picture and gallery.tile', () => {
  it('gives the catalog line and the size of the picture in use', () => {
    const e = card({ id: 'bezel.picture' }, makeContext({ imageId: 'doge', image: { w: 272, h: 320, rgba: new Uint8Array(272 * 320 * 4) } }));
    expect(e.title).toBe('Doge');
    expect(e.body).toContain(IMAGES.find((im) => im.id === 'doge')!.title);
    expect(e.value).toContain('272 × 320');
    expect(detailText(e)).toContain('Euterpia');
    expect(e.acts).toBe(true);
  });

  it('gives a tile the catalog title and the picture size, whichever picture is in use', () => {
    const e = card({ id: 'gallery.tile', picture: 'doge' });
    expect(e.body).toContain(IMAGES.find((im) => im.id === 'doge')!.title);
    expect(e.value).toContain('272 × 320');
    expect(e.consequence).toMatch(/Click/);
    expect(card({ id: 'gallery.tile', picture: 'gradient' }).value).toContain('256 × 256');
  });

  it('says a tile is the picture in use', () => {
    const e = card({ id: 'gallery.tile', picture: 'spring' });
    expect(e.consequence).toContain('in use');
    expect(e.consequence).toContain('4.0 KB');
  });

  it('explains the Upload tile as the upload button', () => {
    expect(card({ id: 'gallery.tile', picture: 'upload' }).body).toContain('512 px');
  });

  it('explains an uploaded picture', () => {
    const e = card({ id: 'bezel.picture' }, makeContext({ imageId: 'upload', image: { w: 300, h: 200, rgba: new Uint8Array(300 * 200 * 4) } }));
    expect(e.value).toContain('300 × 200');
    expect(e.body).toMatch(/your own/i);
  });
});

describe('readout', () => {
  it('compares the file with the raw pixels', () => {
    const e = card({ id: 'readout.size' });
    expect(e.value).toBe('4.0 KB of 192.0 KB');
    expect(e.consequence).toContain('quality 50');
  });

  it('gives the ratio as a share of the raw size', () => {
    const e = card({ id: 'readout.ratio' });
    expect(e.body).toContain('48.0 times the space');
    expect(e.value).toBe('48.0 : 1');
    // One format for the ratio on every card: the readout's one decimal.
    expect(text(card({ id: 'bezel.picture' }))).toContain('48.0 times smaller');
  });

  it('says what a pixel costs', () => {
    const e = card({ id: 'readout.bpp' });
    expect(e.value).toBe('0.50 bits per pixel');
    expect(e.body).toContain('24 bits');
  });

  it('says you cannot see the difference above 40 dB', () => {
    const e = card({ id: 'readout.psnr' }, makeContext({ summary: { ...makeContext().summary!, psnr: 44.5 } }));
    expect(e.value).toBe('44.5 dB');
    expect(e.body).toContain("can't see the difference");
  });

  it('says the damage is obvious below 25 dB', () => {
    const e = card({ id: 'readout.psnr' }, makeContext({ summary: { ...makeContext().summary!, psnr: 22 } }));
    expect(e.body).toContain('obvious');
    expect(e.body).toContain('higher is closer');
  });

  it('says a perfect copy is perfect', () => {
    const e = card({ id: 'readout.psnr' }, makeContext({ summary: { ...makeContext().summary!, psnr: null } }));
    expect(e.value).toBe('∞ dB');
    expect(e.body).toMatch(/identical/);
  });

  it('has nothing to say before the first encode', () => {
    expect(explain({ id: 'readout.psnr' }, makeContext({ summary: null }))).toBeNull();
  });
});

describe('chip.custom', () => {
  const custom: [number[], number[]] = [Array(64).fill(3), Array(64).fill(7)];

  it('says the edited tables override quality, and how to go back', () => {
    const e = card({ id: 'chip.custom' }, makeContext({ customTables: custom }));
    expect(e.body).toContain('override quality');
    expect(e.consequence).toContain('Standard');
    expect(e.consequence).toContain('quality 50');
    expect(e.value).toBe('Brightness steps 3, colour steps 7');
    expect(e.acts).toBeUndefined();
  });

  it('gives a range only when the steps differ', () => {
    const ramp = Array.from({ length: 64 }, (_, i) => i + 1);
    expect(card({ id: 'chip.custom' }, makeContext({ customTables: [ramp, Array(64).fill(7)] })).value).toBe('Brightness steps 1 to 64, colour steps 7');
  });

  it('still answers when the tables are standard', () => {
    expect(card({ id: 'chip.custom' }).body).toContain('quality 50');
  });
});

describe('the run-length rail card counts tokens as the stage does', () => {
  it('counts the change in the average as one, like the stage head and the bits card', () => {
    // The fixture block has one AC token; the DC change makes two, as "64 numbers become 2 tokens" says.
    const rail = card({ id: 'rail.stage', stage: 'rle' });
    expect(rail.consequence).toContain('written as 2 tokens');
    expect(rail.consequence).toContain("the change in the block's average plus 1 token, a run of zeros and the number after it");
    expect(card({ id: 'rle.bits' }).details.map((d) => (d.kind === 'rows' ? d.rows.map((r) => r.join(' ')).join(' ') : '')).join(' ')).toContain('Tokens (the DC change counts as one) 2');
  });

  it('says "each" once there are several', () => {
    const base = makeContext();
    const sel = base.summary!.selected!;
    const three = { ...base, summary: { ...base.summary!, selected: { ...sel, tokens: [sel.tokens[0], sel.tokens[0], sel.tokens[0]] } } };
    expect(card({ id: 'rail.stage', stage: 'rle' }, three).consequence).toContain('written as 4 tokens');
    expect(card({ id: 'rail.stage', stage: 'rle' }, three).consequence).toContain('plus 3 tokens, each a run of zeros and the number after it');
  });
});

describe('rail.stage', () => {
  it('explains every stage, with its own words', () => {
    const seen = new Set<string>();
    for (const s of STAGES) {
      const e = card({ id: 'rail.stage', stage: s.id });
      expect(e.title).toContain(s.title.replace('Color', 'Colour'));
      expect(e.acts).toBe(true);
      expect(e.consequence).toBeTruthy();
      seen.add(e.body);
    }
    expect(seen.size).toBe(STAGES.length);
  });

  it('mentions short codes for Huffman', () => {
    expect(card({ id: 'rail.stage', stage: 'huffman' }).body).toMatch(/short codes/);
  });

  it('marks the stage you are on', () => {
    expect(text(card({ id: 'rail.stage', stage: 'dct' }))).toContain('You are here');
    expect(text(card({ id: 'rail.stage', stage: 'quantize' }))).not.toContain('You are here');
  });

  it('reads the picture for its numbers', () => {
    expect(card({ id: 'rail.stage', stage: 'subsample' }).consequence).toContain('16,384');
    expect(card({ id: 'rail.stage', stage: 'blocks' }).consequence).toContain('32 × 32');
  });
});

describe('image.pixel', () => {
  it('gives the pixel colour, its block and the click', () => {
    const e = card({ id: 'image.pixel', x: 0, y: 0 });
    expect(e.value).toBe('RGB 200, 200, 200');
    expect(e.body).toContain('block (0, 0)');
    expect(e.consequence).toContain('follow this block');
    expect(e.acts).toBe(true);
  });

  it('puts the pixel in its block', () => {
    expect(card({ id: 'image.pixel', x: 171, y: 140 }).body).toContain('block (21, 17)');
  });

  it('says how much of its colour is shared', () => {
    expect(card({ id: 'image.pixel', x: 3, y: 3 }).consequence).toContain('2 × 2');
    expect(card({ id: 'image.pixel', x: 3, y: 3 }, makeContext({ subsampling: '444' })).consequence).toContain('exactly');
  });

  it('knows when the block is already the one being followed', () => {
    expect(card({ id: 'image.pixel', x: 171, y: 140 }).consequence).toMatch(/already/);
  });

  it('is silent for a pixel outside the picture or before the picture is in', () => {
    expect(explain({ id: 'image.pixel', x: 256, y: 0 }, makeContext())).toBeNull();
    expect(explain({ id: 'image.pixel', x: 0, y: 0 }, makeContext({ image: null }))).toBeNull();
  });

  it('shows the decoded copy in the details', () => {
    expect(detailText(card({ id: 'image.pixel', x: 0, y: 0 }))).toContain('198, 198, 198');
  });

  it('converts colour as the encoder does (JFIF full-range BT.601)', () => {
    const [yg, cbg, crg] = rgbToYcbcr(200, 200, 200);
    expect(yg).toBeCloseTo(200, 6);
    expect(cbg).toBeCloseTo(128, 6);
    expect(crg).toBeCloseTo(128, 6);
    const [y, cb, cr] = rgbToYcbcr(255, 0, 0);
    expect(y).toBeCloseTo(76.245, 3);
    expect(cb).toBeCloseTo(85.0, 1);
    expect(cr).toBeCloseTo(255.5, 1);
    const [yb, cbb, crb] = rgbToYcbcr(0, 0, 255);
    expect(yb).toBeCloseTo(29.07, 2);
    expect(cbb).toBeCloseTo(255.5, 1);
    expect(crb).toBeCloseTo(107.27, 2);
  });
});
