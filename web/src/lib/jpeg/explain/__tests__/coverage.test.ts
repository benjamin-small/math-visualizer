// The checklist: every target in the design's inventory is explained by a
// pure function, is registered by some component (or the hit-test), sounds
// like the rest of the lab, and replaces the native tooltips it used to have.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TARGET_IDS, explain, type Explanation, type Target } from '..';
import { STAGES, type StageId } from '../../stages';
import type { ExplainContext } from '../context';
import { makeContext } from './fixture';

/** One valid target for each id, with values the fixture context can answer. */
const SAMPLES: Record<Target['id'], Target> = {
  'bezel.picture': { id: 'bezel.picture' },
  'bezel.upload': { id: 'bezel.upload' },
  'bezel.quality': { id: 'bezel.quality' },
  'bezel.chroma': { id: 'bezel.chroma', mode: '422' },
  'bezel.huffman': { id: 'bezel.huffman', mode: 'standard' },
  'bezel.save': { id: 'bezel.save' },
  'bezel.speed': { id: 'bezel.speed' },
  'bezel.play': { id: 'bezel.play' },
  'bezel.reset': { id: 'bezel.reset' },
  'bezel.step': { id: 'bezel.step', dir: 'forward' },
  'bezel.position': { id: 'bezel.position' },
  'rail.stage': { id: 'rail.stage', stage: 'dct' },
  'readout.size': { id: 'readout.size' },
  'readout.ratio': { id: 'readout.ratio' },
  'readout.bpp': { id: 'readout.bpp' },
  'readout.psnr': { id: 'readout.psnr' },
  'chip.custom': { id: 'chip.custom' },
  'image.pixel': { id: 'image.pixel', x: 10, y: 20 },
  'overview.pixel': { id: 'overview.pixel', which: 'decoded', x: 3, y: 4 },
  'overview.sizes': { id: 'overview.sizes' },
  'overview.hist': { id: 'overview.hist', kind: 'diff', bin: 0 },
  'overview.entropy': { id: 'overview.entropy', kind: 'jpeg' },
  'gallery.tile': { id: 'gallery.tile', picture: 'doge' },
  'color.cube': { id: 'color.cube' },
  'color.axes': { id: 'color.axes' },
  'color.plane': { id: 'color.plane', plane: 1, x: 10, y: 20 },
  'subsample.plane': { id: 'subsample.plane', which: 'coded', plane: 2, x: 10, y: 20 },
  'subsample.kept': { id: 'subsample.kept' },
  'blocks.cell': { id: 'blocks.cell', x: 2, y: 3 },
  'blocks.component': { id: 'blocks.component' },
  'blocks.shift': { id: 'blocks.shift' },
  'dct.coeff': { id: 'dct.coeff', u: 2, v: 1 },
  'dct.atlas': { id: 'dct.atlas', u: 1, v: 2 },
  'dct.k': { id: 'dct.k' },
  'dct.energy': { id: 'dct.energy', k: 10 },
  'dct.cosines': { id: 'dct.cosines', chart: 'dct', i: 3 },
  'quantize.before': { id: 'quantize.before', u: 1, v: 0 },
  'quantize.table': { id: 'quantize.table', u: 1, v: 0 },
  'quantize.after': { id: 'quantize.after', u: 1, v: 0 },
  'quantize.editor': { id: 'quantize.editor', u: 1, v: 0 },
  'quantize.rebuild': { id: 'quantize.rebuild', x: 2, y: 2 },
  'quantize.rd': { id: 'quantize.rd', quality: 50 },
  'quantize.dot': { id: 'quantize.dot' },
  'zigzag.grid': { id: 'zigzag.grid', u: 1, v: 0 },
  'zigzag.seq': { id: 'zigzag.seq', k: 2 },
  'zigzag.last': { id: 'zigzag.last' },
  'rle.token': { id: 'rle.token', i: 0 },
  'rle.dc': { id: 'rle.dc' },
  'rle.bits': { id: 'rle.bits' },
  'huffman.tab': { id: 'huffman.tab', table: 0 },
  'huffman.cost': { id: 'huffman.cost', table: 0 },
  'huffman.bar': { id: 'huffman.bar', table: 0, symbol: 0 },
  'huffman.leaf': { id: 'huffman.leaf', table: 0, symbol: 0 },
  'huffman.bits': { id: 'huffman.bits', part: 0 },
  'huffman.segment': { id: 'huffman.segment', i: 0 },
  'decode.wipe': { id: 'decode.wipe', x: 3, y: 4 },
  'decode.error': { id: 'decode.error', x: 3, y: 4 },
  'decode.wipeSlider': { id: 'decode.wipeSlider' },
  'decode.gainSlider': { id: 'decode.gainSlider' },
  'decode.hint': { id: 'decode.hint', kind: 'blocking' },
  'decode.resave': { id: 'decode.resave', generation: 2 },
};

const sampleTarget = (id: Target['id']): Target => SAMPLES[id];

/** What a few cards need from the page before they have anything to say. */
const NEEDS: Partial<Record<Target['id'], Partial<ExplainContext>>> = {
  'chip.custom': { customTables: [Array<number>(64).fill(16), Array<number>(64).fill(17)] },
  'quantize.rd': { rd: [{ quality: 50, bytes: 5000, psnr: 33.2 }] },
  'decode.resave': { resave: [30, 28, 27] },
};

/** The context for a target's card: the fixture on its stage, plus whatever that card needs. */
const contextFor = (id: Target['id']) => makeContext({ stage: stageFor(id), ...NEEDS[id] });

/** The stage whose page carries a target. */
function stageFor(id: Target['id']): StageId {
  const area = id.slice(0, id.indexOf('.'));
  switch (area) {
    case 'overview':
    case 'gallery':
    case 'bezel':
    case 'readout':
    case 'rail':
    case 'chip':
    case 'image':
      return 'overview';
    case 'color':
    case 'subsample':
    case 'blocks':
    case 'dct':
    case 'quantize':
    case 'zigzag':
    case 'rle':
    case 'huffman':
    case 'decode':
      return area;
    default:
      throw new Error(`no stage for ${id}`);
  }
}

/** What a target says on the card itself, without the unfolded part. */
const compact = (e: Explanation) => [e.title, e.value, e.body, e.consequence].filter(Boolean).join(' ');

const lib = join(__dirname, '..', '..', '..');
const componentsDir = join(lib, 'components');

function svelteFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name);
    return d.isDirectory() ? (d.name === '__tests__' ? [] : svelteFiles(p)) : d.name.endsWith('.svelte') ? [p] : [];
  });
}

const read = (p: string) => readFileSync(p, 'utf8');

describe('card coverage', () => {
  it('lists every id once', () => {
    expect(new Set(TARGET_IDS).size).toBe(TARGET_IDS.length);
    expect(Object.keys(SAMPLES).sort()).toEqual([...TARGET_IDS].sort());
  });

  it.each(TARGET_IDS)('explains %s', (id) => {
    const t = sampleTarget(id);
    expect(t.id).toBe(id);
    const e = explain(t, contextFor(id));
    expect(e, `${id} has no card`).not.toBeNull();
    expect(e!.title.length).toBeGreaterThan(0);
    expect(e!.body.length).toBeGreaterThan(0);
    // The reader gets a live number or a consequence of the current settings.
    const live = [e!.value, e!.consequence].filter((s): s is string => !!s && s.trim().length > 0);
    expect(live.length, `${id} has neither a value nor a consequence`).toBeGreaterThan(0);
    expect(live.join(' '), `${id}: no number or setting`).toMatch(/\d|quality|chroma|Huffman|table|picture/i);
  });

  it.each(TARGET_IDS)('keeps to the lab voice in %s', (id) => {
    const e = explain(sampleTarget(id), contextFor(id))!;
    const all = [compact(e), JSON.stringify(e.details)].join(' ');
    expect(all).not.toMatch(/surviv/i); // "stay non-zero after rounding"
    expect(all).not.toMatch(/\bcolor\b/i); // British spelling: colour
    expect(compact(e)).not.toMatch(/\bMCU\b/); // jargon waits for the unfolded part
  });

  it.each(STAGES.map((st) => st.id))('keeps to the lab voice on the rail card for the %s stage', (stage) => {
    const e = explain({ id: 'rail.stage', stage }, makeContext({ stage: 'overview' }))!;
    const all = [compact(e), JSON.stringify(e.details)].join(' ');
    expect(all).not.toMatch(/surviv/i);
    expect(all).not.toMatch(/\bcolor\b/i);
    expect(all).not.toMatch(/\bColor\b/);
    expect(compact(e)).not.toMatch(/\bMCU\b/);
  });

  it.each(TARGET_IDS)('opens %s in plain words', (id) => {
    const e = explain(sampleTarget(id), contextFor(id))!;
    const jargon = /coefficient|quantiz|entropy/i;
    // The heading and the value are the first thing read: no jargon at all.
    expect([e.title, e.value ?? ''].join(' | ')).not.toMatch(jargon);
    // In the first sentence of the body a jargon word may come only after the plain words that explain it.
    const first = e.body.split(/(?<=[.!?])\s/)[0];
    const at = first.search(jargon);
    if (at >= 0) expect(at, `${id}: "${first}" opens with jargon`).toBeGreaterThanOrEqual(40);
  });

  it('registers every id in a component or the hit-test', () => {
    const sources = [...svelteFiles(componentsDir), join(lib, 'jpeg', 'explain', 'hit.ts')].map(read);
    const missing = TARGET_IDS.filter((id) => !sources.some((s) => new RegExp(`['"\`]${id.replace('.', '\\.')}['"\`]`).test(s)));
    expect(missing).toEqual([]);
  });

  it('leaves no native tooltip in the lab', () => {
    const files = [...svelteFiles(join(componentsDir, 'jpeg')), join(componentsDir, 'labs', 'JpegLab.svelte')];
    expect(files.length).toBeGreaterThan(5);
    const found: string[] = [];
    for (const file of files) {
      const src = read(file);
      // A `title=` on a component (LabShell's page title) is a prop; on an element it is a native tooltip.
      const tags = [...src.matchAll(/<([A-Za-z][\w:.-]*)/g)];
      for (const m of src.matchAll(/[\s]title=/g)) {
        const tag = [...tags].filter((t) => t.index! < m.index!).pop()?.[1] ?? '';
        if (!/^[A-Z]/.test(tag)) found.push(`${file}: <${tag} title=>`);
      }
      if (/<title[\s>]/.test(src)) found.push(`${file}: <title>`);
    }
    expect(found).toEqual([]);
  });
});
