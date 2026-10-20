import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import {
  installRafPolyfill,
  dispatchSpy,
  ruleActionSpy,
  updateRuleConfigWithImageSpy,
  updateVizConfigSpy,
  snapshotFixture,
  jpegSummaryFixture,
  jpegDecodeSpy,
} from '../../test/fakeViz';
import { navigate, route } from '../../router.svelte';
import { decodeUpload, loadPicture } from '../../jpeg/images';
import { cells, jpegLayout } from '../../jpeg/layout';
import { RD_PSNR_CAP } from '../../jpeg/rd';
import { TOUR_SEEN_KEY, resetTourSeen } from '../../jpeg/tour';
import type { StageId } from '../../jpeg/stages';

installRafPolyfill();

vi.mock('../../wasm/loader', async () => {
  const { makeVizMock } = await import('../../test/fakeViz');
  return { loadVizCore: vi.fn(() => Promise.resolve(makeVizMock())) };
});

// The real catalog, but every picture loads as a solid image of its catalog size (no network, no canvas).
vi.mock('../../jpeg/images', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../jpeg/images')>();
  return {
    ...real,
    loadPicture: vi.fn(async (id: string) => {
      const { w, h } = real.IMAGES.find((im) => im.id === id)?.file ?? { w: 256, h: 256 };
      return { w, h, rgba: new Uint8Array(w * h * 4).fill(128) };
    }),
    decodeUpload: vi.fn(real.decodeUpload),
    thumbnail: vi.fn(async (id: string) => `data:image/png;base64,${id}`),
  };
});

// App also imports the Fourier lab, which fetches a font; jsdom has no origin to fetch from.
vi.mock('../../fourier/textPath', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../fourier/textPath')>()),
  textToPath: vi.fn(async () => []),
}));

import App from '../../../App.svelte';

// jsdom lays nothing out; give the stage's canvas a desktop size so the lab
// has panels (and their controls) to show.
const size = (w: number, h: number) => ({
  configurable: true,
  get(this: HTMLElement) {
    return this.tagName === 'CANVAS' ? (w === 0 ? h : w) : 0;
  },
});
Object.defineProperty(HTMLElement.prototype, 'clientWidth', size(1134, 0));
Object.defineProperty(HTMLElement.prototype, 'clientHeight', size(0, 585));

type Config = {
  image_id: string;
  quality: number;
  subsampling: string;
  huffman: string;
  max_iterations: number;
  tables: [number[], number[]] | null;
};
type Push = [Config, number, number, Uint8Array];
const pushes = () => updateRuleConfigWithImageSpy.mock.calls as Push[];
const lastPush = () => pushes()[pushes().length - 1];
const kinds = () => dispatchSpy.mock.calls.map(([c]) => (c as { kind: string }).kind);
const lastViz = () => updateVizConfigSpy.mock.lastCall?.[0] as Record<string, unknown>;

async function renderLab(query = '') {
  navigate('jpeg', query);
  const result = render(App);
  await vi.waitFor(() => expect(pushes().length).toBeGreaterThan(0));
  return result;
}

describe('JpegLab.svelte', () => {
  beforeEach(() => {
    localStorage.setItem(TOUR_SEEN_KEY, '1'); // the tour has its own describe below
    dispatchSpy.mockClear();
    ruleActionSpy.mockClear();
    updateRuleConfigWithImageSpy.mockClear();
    updateVizConfigSpy.mockClear();
  });

  it('encodes a picture as a typed array and waits at its current block, scanning four blocks a second', async () => {
    await renderLab('img=gradient');
    const [cfg, w, h, rgba] = lastPush();
    expect(cfg).toEqual({ image_id: 'gradient', quality: 50, subsampling: '420', huffman: 'optimized', max_iterations: 256, tables: null });
    expect([w, h, rgba.length]).toEqual([256, 256, 256 * 256 * 4]);
    expect(kinds()).not.toContain('Play');
    expect(dispatchSpy).toHaveBeenCalledWith({ kind: 'SetSpeed', value: 4 });
  });

  it('does not play on open, on a new picture or on an upload', async () => {
    const { container, getByLabelText } = await renderLab();
    expect(kinds()).not.toContain('Play');
    // The encoder's default block, luma (21, 17) at 4:2:0, is in MCU 138: the scan waits just after it.
    expect(dispatchSpy).toHaveBeenCalledWith({ kind: 'JumpTo', iteration: 139 });
    await fireEvent.change(getByLabelText('Picture'), { target: { value: 'doge' } });
    await vi.waitFor(() => expect(lastPush()[0].image_id).toBe('doge'));
    vi.mocked(decodeUpload).mockImplementationOnce(async () => ({ w: 64, h: 48, rgba: new Uint8Array(64 * 48 * 4).fill(90) }));
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await fireEvent.change(input, { target: { files: [new File(['x'], 'x.png', { type: 'image/png' })] } });
    await vi.waitFor(() => expect(lastPush()[0].image_id).toBe('upload'));
    expect(kinds()).not.toContain('Play');
  });

  it('opens the spring overview by default', async () => {
    const { container } = await renderLab();
    const [cfg, w, h] = pushes()[0];
    expect([cfg.image_id, w, h]).toEqual(['spring', 256, 256]);
    expect(route.query).toBe('');
    await vi.waitFor(() => {
      const panels = (lastViz().panels as { kind: string }[]).map((p) => p.kind);
      expect(panels).toContain('original');
      expect(panels).toContain('decoded');
    });
    const stats = await vi.waitFor(() => {
      const el = container.querySelector('.overview');
      expect(el).toBeTruthy();
      return el!.textContent!;
    });
    for (const heading of ['Raw bytes', 'Neighbour differences', 'JPEG file']) expect(stats).toContain(heading);
    expect(stats.match(/bits \/ byte/g)).toHaveLength(3);
    expect(stats).toContain(' : 1');
    expect(stats).toContain('Grand Prismatic Spring, Yellowstone');
    expect(container.querySelector('.overview a')?.getAttribute('href')).toContain('commons.wikimedia.org');
    expect(container.querySelector('.stage-card h2')?.textContent).toContain('Overview');
    const gallery = container.querySelector('.gallery')!;
    expect(gallery.querySelectorAll('button[aria-pressed]')).toHaveLength(11);
    expect(gallery.querySelectorAll('button')).toHaveLength(12);
    expect(gallery.querySelector('button[aria-pressed="true"]')?.textContent).toContain('Grand Prismatic Spring');
  });

  it('still opens an old gradient link', async () => {
    const { container } = await renderLab('img=gradient&stage=dct&b=12,7');
    expect(lastPush()[0].image_id).toBe('gradient');
    await vi.waitFor(() =>
      expect(ruleActionSpy).toHaveBeenCalledWith({ kind: 'select_block', component: 0, bx: 12, by: 7 }),
    );
    expect(route.query).toBe('img=gradient&stage=dct&b=12,7');
    expect(container.querySelector('.stage-card h2')?.textContent).toContain('DCT');
  });

  it('changes picture from the Huffman stage', async () => {
    const { container, getByLabelText } = await renderLab('stage=huffman');
    await fireEvent.change(getByLabelText('Picture'), { target: { value: 'doge' } });
    await vi.waitFor(() => expect(lastPush()[0].image_id).toBe('doge'));
    expect(lastPush().slice(1, 3)).toEqual([272, 320]);
    expect(container.querySelector('.stage-card h2')?.textContent).toContain('Huffman');
    expect(route.query).toBe('img=doge&stage=huffman');
  });

  it('clamps a shared block to the honest-work grid', async () => {
    await renderLab('img=honest-work&stage=blocks&b=50,50');
    await vi.waitFor(() =>
      expect(ruleActionSpy).toHaveBeenCalledWith({ kind: 'select_block', component: 0, bx: 39, by: 25 }),
    );
    expect(route.query).toContain('b=39,25');
  });

  it('keeps the current picture when a bundled one fails to load', async () => {
    const { getByLabelText, findByRole } = await renderLab();
    const before = pushes().length;
    vi.mocked(loadPicture).mockImplementationOnce(() => Promise.reject(new Error('Could not load the picture "Doge" (the server answered 404).')));
    const select = getByLabelText('Picture') as HTMLSelectElement;
    await fireEvent.change(select, { target: { value: 'doge' } });
    expect((await findByRole('alert')).textContent).toContain('the server answered 404');
    expect(pushes().length).toBe(before);
    expect(select.value).toBe('spring');
  });

  it('falls back to the gradient, with the alert, when the very first picture cannot load', async () => {
    vi.mocked(loadPicture).mockImplementationOnce(() =>
      Promise.reject(new Error('Could not load the picture "Grand Prismatic Spring" (the server answered 404).')),
    );
    const { getByLabelText, findByRole, container } = await renderLab('b=3,4');
    expect(lastPush()[0].image_id).toBe('gradient');
    expect((await findByRole('alert')).textContent).toContain('the server answered 404');
    expect((getByLabelText('Picture') as HTMLSelectElement).value).toBe('gradient');
    // On the overview the alert is the first row of its stats, where it hides nothing.
    expect(container.querySelector('.overview [role="alert"]')).toBeTruthy();
    expect(container.querySelector('.error')).toBeNull();
  });

  it('keeps the link the reader opened when the first picture falls back to the gradient', async () => {
    vi.mocked(loadPicture).mockImplementationOnce(() => Promise.reject(new Error('offline')));
    await renderLab('img=shuttle&q=30&b=3,4');
    expect(lastPush()[0].image_id).toBe('gradient');
    await new Promise((r) => setTimeout(r, 30));
    // The lost picture stays named in the address, so a reload (or a forward) can try it again.
    expect(route.query).toBe('img=shuttle&q=30&b=3,4');
  });

  it('writes img=gradient into the link for an uploaded picture', async () => {
    const { container, getByLabelText } = await renderLab('img=shuttle');
    vi.mocked(decodeUpload).mockImplementationOnce(async () => ({ w: 64, h: 48, rgba: new Uint8Array(64 * 48 * 4).fill(90) }));
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await fireEvent.change(input, { target: { files: [new File(['x'], 'x.png', { type: 'image/png' })] } });
    await vi.waitFor(() => expect(lastPush()[0].image_id).toBe('upload'));
    expect(lastPush().slice(1, 3)).toEqual([64, 48]);
    expect((getByLabelText('Picture') as HTMLSelectElement).value).toBe('upload');
    // The link cannot carry the pixels; it names the gradient, not the default spring a bare link would open.
    expect(route.query).toBe('img=gradient');
    await fireEvent.change(getByLabelText('Quality'));
    expect(route.query).toBe('img=gradient');
  });

  it('shows the picture credit in the overview story, whatever the stage has room for', async () => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', size(343, 0));
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', size(0, 300));
    try {
      const { container } = await renderLab();
      await vi.waitFor(() => expect(container.querySelector('.stage-card')).toBeTruthy());
      const credit = container.querySelector('.stage-card .credit')!;
      expect(credit.textContent).toContain('Grand Prismatic Spring, Yellowstone');
      expect(credit.textContent).toContain('Jim Peaco, National Park Service');
      expect(credit.textContent).toContain('Public domain');
      expect(credit.querySelector('a')?.getAttribute('href')).toContain('commons.wikimedia.org');
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', size(1134, 0));
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', size(0, 585));
    }
  });

  it('shows no credit for a generated picture, and none off the overview', async () => {
    const { container } = await renderLab('img=text');
    await vi.waitFor(() => expect(container.querySelector('.stage-card')).toBeTruthy());
    expect(container.querySelector('.stage-card .credit')).toBeNull();
    const spring = await renderLab('img=spring&stage=color');
    expect(spring.container.querySelector('.stage-card .credit')).toBeNull();
  });

  it('draws nothing and shows no readout until the first picture is in', async () => {
    let release!: () => void;
    vi.mocked(loadPicture).mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve({ w: 256, h: 256, rgba: new Uint8Array(256 * 256 * 4).fill(128) }))),
    );
    navigate('jpeg', '');
    const { container } = render(App);
    // The engine is up but the picture is not: the viz must not fall back to its built-in gradient.
    await vi.waitFor(() => expect(updateVizConfigSpy).toHaveBeenCalled());
    const panels = lastViz().panels as { kind: string; rect: number[] }[];
    expect(panels.length).toBeGreaterThan(0); // an empty list means "fit the image" to the viz
    expect(panels.every((p) => p.rect[2] === 0 || p.rect[3] === 0)).toBe(true);
    expect(pushes()).toHaveLength(0);
    expect(container.querySelector('.stats')).toBeNull();
    release();
    await vi.waitFor(() => expect(container.querySelector('.stats')?.textContent).toContain('4.0 KB'));
    const drawn = (lastViz().panels as { kind: string; rect: number[] }[]).filter((p) => p.rect[2] > 0 && p.rect[3] > 0).map((p) => p.kind);
    expect(drawn).toEqual(expect.arrayContaining(['original', 'decoded']));
  });

  it('starts the first picture before the engine is ready', async () => {
    const calls = vi.mocked(loadPicture).mock.calls.length;
    navigate('jpeg', 'img=shuttle');
    render(App);
    // Synchronously after mount: the fetch has begun, while the WASM module is still loading.
    expect(vi.mocked(loadPicture).mock.calls.slice(calls)).toEqual([['shuttle']]);
    await vi.waitFor(() => expect(pushes().length).toBeGreaterThan(0));
    expect(vi.mocked(loadPicture).mock.calls.slice(calls)).toEqual([['shuttle']]);
  });

  it('has no block-picking area on the overview, and the how-it-works tip says where clicking applies', async () => {
    const { container, getByRole, queryByRole } = await renderLab();
    expect(queryByRole('button', { name: /Pick a block/ })).toBeNull();
    expect(container.textContent).toContain('On stages 1');
    await fireEvent.click(getByRole('button', { name: 'Step 1: Color' }));
    expect(getByRole('button', { name: /Pick a block/ })).toBeTruthy();
  });

  it("gives Reducible's JPEG video a shout-out in How it works, opening in a new tab", async () => {
    const { container, getByRole } = await renderLab();
    expect(container.textContent).toContain('A shout-out to Reducible');
    const link = getByRole('link', { name: 'The Unreasonable Effectiveness of JPEG' });
    expect(link.getAttribute('href')).toBe('https://www.youtube.com/watch?v=0me3guauqOU&t=1711s');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('picks a picture from the gallery', async () => {
    const { getByRole } = await renderLab();
    await fireEvent.click(getByRole('button', { name: 'Made of cosines' }));
    await vi.waitFor(() => expect(lastPush()[0].image_id).toBe('cosines'));
    expect(route.query).toBe('img=cosines');
  });

  it('steps from the overview into the pipeline', async () => {
    const { getByRole, container } = await renderLab();
    await fireEvent.click(getByRole('button', { name: 'Step 1: Color' }));
    expect(route.query).toBe('stage=color');
    expect(container.querySelector('.stage-card h2')?.textContent).toContain('Color');
    await fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(route.query).toBe('');
    expect(container.querySelector('.stage-card h2')?.textContent).toContain('Overview');
  });

  it('shows the readout from the summary', async () => {
    const { container } = await renderLab();
    await vi.waitFor(() => expect(container.querySelector('.stats')?.textContent).toContain('4.0 KB'));
    expect(container.querySelector('.stats')?.textContent).toContain('36.5 dB');
  });

  it('re-encodes on a quality change and puts the scan back where it was', async () => {
    const { getByLabelText } = await renderLab();
    dispatchSpy.mockClear();
    await fireEvent.input(getByLabelText('Quality'), { target: { value: '20' } });
    await vi.waitFor(() => expect(lastPush()[0].quality).toBe(20));
    // The fake snapshot sits at 0 of 360 and paused: nothing to restore, no Play.
    expect(kinds()).not.toContain('Play');
    // The URL is written when the slider is released, not on every input.
    expect(route.query).not.toContain('q=20');
    await fireEvent.change(getByLabelText('Quality'));
    expect(route.query).toContain('q=20');
  });

  it('coalesces a drag of the quality slider into one encode per frame', async () => {
    const { getByLabelText } = await renderLab();
    const before = pushes().length;
    for (const v of ['20', '30', '40']) await fireEvent.input(getByLabelText('Quality'), { target: { value: v } });
    await vi.waitFor(() => expect(lastPush()[0].quality).toBe(40));
    await new Promise((r) => setTimeout(r, 30));
    expect(pushes().length).toBe(before + 1);
  });

  it("a settings change returns the scan to the current block's step", async () => {
    Object.assign(snapshotFixture, { iteration: 139, max_iterations: 256, playing: true });
    try {
      const { getByLabelText, container } = await renderLab();
      await vi.waitFor(() => expect(container.querySelector('.readout')?.textContent).toContain('139'));
      dispatchSpy.mockClear();
      // The current block is luma (21, 17); at 4:4:4 every block is its own MCU, row-major on a 32-block row.
      await fireEvent.click(getByLabelText('4:4:4'));
      expect(lastPush()[0].max_iterations).toBe(1024);
      expect(dispatchSpy.mock.calls.map(([c]) => c)).toEqual([{ kind: 'JumpTo', iteration: 17 * 32 + 21 + 1 }, { kind: 'Play' }]);
      // Paused, a quality change jumps again and does not play.
      snapshotFixture.playing = false;
      await vi.waitFor(() => expect(container.querySelectorAll('.transport button')[2].textContent).toContain('Play'));
      dispatchSpy.mockClear();
      await fireEvent.input(getByLabelText('Quality'), { target: { value: '20' } });
      await vi.waitFor(() => expect(lastPush()[0].quality).toBe(20));
      expect(dispatchSpy).toHaveBeenCalledWith({ kind: 'JumpTo', iteration: 566 });
      expect(kinds()).not.toContain('Play');
    } finally {
      Object.assign(snapshotFixture, { iteration: 0, max_iterations: 360, playing: false });
    }
  });

  it('counts MCUs for the chosen subsampling', async () => {
    const { getByLabelText } = await renderLab();
    await fireEvent.click(getByLabelText('4:4:4'));
    expect(lastPush()[0]).toMatchObject({ subsampling: '444', max_iterations: 1024 });
    expect(route.query).toContain('s=444');
  });

  it('loads a shared link and rewrites junk to what loaded', async () => {
    await renderLab('img=text&q=999&s=422&h=std&stage=nope');
    expect(lastPush()[0]).toEqual({ image_id: 'text', quality: 100, subsampling: '422', huffman: 'standard', max_iterations: 512, tables: null });
    expect(route.query).toBe('img=text&q=100&s=422&h=std');
  });

  it('moves between ready stages with the rail and the arrow keys', async () => {
    const { getByRole, container } = await renderLab('stage=color');
    expect(getByRole('button', { name: /Color/ }).getAttribute('aria-current')).toBe('step');
    expect((getByRole('button', { name: /Huffman/ }) as HTMLButtonElement).disabled).toBe(false);
    await fireEvent.click(getByRole('button', { name: /DCT/ }));
    expect(route.query).toBe('stage=dct');
    await fireEvent.keyDown(window, { key: 'ArrowLeft' }); // a key on the window itself (no element target)
    expect(route.query).toBe('stage=blocks');
    // Keys typed into a control are the control's.
    const quality = container.querySelector('input[aria-label="Quality"]')!;
    await fireEvent.keyDown(quality, { key: 'ArrowLeft' });
    expect(route.query).toBe('stage=blocks');
    expect(container.querySelector('.stage-card h2')?.textContent).toContain('Blocks');
  });

  it('selects the plane to follow on the blocks stage', async () => {
    const { getByRole } = await renderLab('stage=blocks');
    ruleActionSpy.mockClear();
    await fireEvent.click(getByRole('button', { name: 'Cb' }));
    // The summary's luma block (21, 17) is the anchor; 4:2:0 halves it for chroma.
    expect(ruleActionSpy).toHaveBeenLastCalledWith({ kind: 'select_block', component: 1, bx: 10, by: 8 });
  });

  it('turns the cube and sets k through the viz config', async () => {
    const { getByLabelText } = await renderLab('stage=color');
    await vi.waitFor(() => expect(getByLabelText('RGB axes to YCbCr axes')).toBeTruthy());
    await fireEvent.input(getByLabelText('RGB axes to YCbCr axes'), { target: { value: '1' } });
    expect(lastViz().cube_mix).toBe(1);
  });

  it('keeps the current image and says why when an upload cannot be read', async () => {
    const { container, findByRole } = await renderLab();
    const before = pushes().length;
    vi.stubGlobal('createImageBitmap', vi.fn(() => Promise.reject(new Error('nope'))));
    try {
      const input = container.querySelector('input[type="file"]') as HTMLInputElement;
      await fireEvent.change(input, { target: { files: [new File(['x'], 'x.txt', { type: 'text/plain' })] } });
      expect((await findByRole('alert')).textContent).toContain('not an image');
      expect(pushes().length).toBe(before);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('saves the encoded bytes as a .jpg', async () => {
    const { getByRole } = await renderLab('q=75&s=444');
    const create = vi.fn(() => 'blob:x');
    const revoke = vi.fn();
    const saved = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      await fireEvent.click(getByRole('button', { name: /Save .jpg/ }));
      expect(create).toHaveBeenCalledOnce();
      expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('jpeg-lab-q75-444.jpg');
      // Revoked after the click has had its tick, not before.
      expect(revoke).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:x'));
    } finally {
      click.mockRestore();
      Object.assign(URL, { createObjectURL: saved.create, revokeObjectURL: saved.revoke });
    }
  });

  it('shows 0% captured at k = 0', async () => {
    const { getByLabelText, container } = await renderLab('stage=dct');
    await vi.waitFor(() => expect(container.querySelector('figcaption')?.textContent).toContain('at k = 64'));
    await fireEvent.input(getByLabelText('Patterns kept'), { target: { value: '0' } });
    await vi.waitFor(() => expect(container.querySelector('figcaption')?.textContent).toMatch(/ 0% at k = 0/));
  });

  it('goes back to the luma plane when another image is chosen', async () => {
    const { getByRole, getByLabelText } = await renderLab('stage=blocks');
    await fireEvent.click(getByRole('button', { name: 'Cb' }));
    expect(getByRole('button', { name: 'Cb' }).getAttribute('aria-pressed')).toBe('true');
    await fireEvent.change(getByLabelText('Picture'), { target: { value: 'text' } });
    await vi.waitFor(() => expect(lastPush()[0].image_id).toBe('text'));
    await vi.waitFor(() => expect(getByRole('button', { name: 'Y' }).getAttribute('aria-pressed')).toBe('true'));
  });

  it('moves the selected block with the arrow keys on the image, without changing stage', async () => {
    const { getByRole } = await renderLab('stage=blocks');
    const pick = getByRole('button', { name: /Pick a block/ });
    ruleActionSpy.mockClear();
    await fireEvent.keyDown(pick, { key: 'ArrowRight' });
    // The summary's luma block is (21, 17); one block right.
    expect(ruleActionSpy).toHaveBeenLastCalledWith({ kind: 'select_block', component: 0, bx: 22, by: 17 });
    expect(route.query).toBe('stage=blocks&b=22,17');
    await fireEvent.keyDown(pick, { key: 'ArrowDown' });
    expect(ruleActionSpy).toHaveBeenLastCalledWith({ kind: 'select_block', component: 0, bx: 22, by: 18 });
  });

  it('restores the block of a shared link and keeps it in the URL', async () => {
    await renderLab('stage=blocks&b=12,7');
    await vi.waitFor(() =>
      expect(ruleActionSpy).toHaveBeenCalledWith({ kind: 'select_block', component: 0, bx: 12, by: 7 }),
    );
    expect(route.query).toContain('b=12,7');
  });

  it('clamps a shared block that is off the grid to the last block', async () => {
    await renderLab('stage=blocks&b=50,50');
    await vi.waitFor(() =>
      expect(ruleActionSpy).toHaveBeenCalledWith({ kind: 'select_block', component: 0, bx: 31, by: 31 }),
    );
    expect(route.query).toContain('b=31,31');
    expect(route.query).not.toContain('b=50');
  });

  it('follows a tap on the coefficients with the formula (touch has no hover)', async () => {
    const { container } = await renderLab('stage=dct');
    const area = await vi.waitFor(() => {
      const a = container.querySelector('.hover-area');
      expect(a).toBeTruthy();
      return a!;
    });
    const el = area as HTMLElement;
    const at = { clientX: parseFloat(el.style.left) + 6, clientY: parseFloat(el.style.top) + 6 };
    // jsdom has no PointerEvent; a MouseEvent of that type carries the coordinates.
    await fireEvent(area, new MouseEvent('pointerdown', { ...at, bubbles: true }));
    await vi.waitFor(() => expect(updateVizConfigSpy.mock.calls.some(([c]) => (c as { hover?: unknown }).hover != null)).toBe(true));
  });

  it('keeps a tapped coefficient when a touch pointer leaves, and clears it when the mouse leaves', async () => {
    const { container } = await renderLab('stage=quantize');
    const area = (await vi.waitFor(() => {
      const a = container.querySelector('.hover-area');
      expect(a).toBeTruthy();
      return a!;
    })) as HTMLElement;
    const at = { clientX: parseFloat(area.style.left) + 6, clientY: parseFloat(area.style.top) + 6 };
    const hoverCalls = () => updateVizConfigSpy.mock.calls.map(([c]) => c as { hover?: unknown }).filter((c) => 'hover' in c);
    await fireEvent(area, new MouseEvent('pointerdown', { ...at, bubbles: true }));
    await vi.waitFor(() => expect(hoverCalls().at(-1)!.hover).not.toBeNull());
    // A finger lifting fires pointerleave right after pointerup: the tap must stay.
    const touchLeave = new MouseEvent('pointerleave');
    Object.defineProperty(touchLeave, 'pointerType', { value: 'touch' });
    await fireEvent(area, touchLeave);
    expect(hoverCalls().at(-1)!.hover).not.toBeNull();
    // A mouse (or an event with no pointer type, as in jsdom) leaving clears it.
    await fireEvent(area, new MouseEvent('pointerleave'));
    expect(hoverCalls().at(-1)!.hover).toBeNull();
  });

  it('leaves arrow keys with a modifier to the browser', async () => {
    await renderLab('stage=dct');
    await fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true });
    await fireEvent.keyDown(window, { key: 'ArrowLeft', metaKey: true });
    expect(route.query).toBe('stage=dct');
  });

  it('keeps the current image and says why when a built-in cannot be made', async () => {
    const { getByLabelText, findByRole } = await renderLab();
    const before = pushes().length;
    vi.mocked(loadPicture).mockImplementationOnce(() => Promise.reject(new Error('wasm down')));
    await fireEvent.change(getByLabelText('Picture'), { target: { value: 'bars' } });
    expect((await findByRole('alert')).textContent).toContain('wasm down');
    expect(pushes().length).toBe(before);
  });

  it('applies an edited Q table to the selected plane and goes back to the standard tables', async () => {
    const { getByLabelText, getByRole, container } = await renderLab('stage=quantize');
    const cell = await vi.waitFor(() => getByLabelText('Q(1, 0)') as HTMLInputElement);
    await fireEvent.change(cell, { target: { value: '99' } });
    await fireEvent.click(getByRole('button', { name: 'Apply to image' }));
    const [luma, chroma] = lastPush()[0].tables!;
    expect(luma[1]).toBe(99);
    expect(luma.filter((v) => v !== 16)).toEqual([99]);
    // The chroma plane keeps the table the encoder was using.
    expect(chroma.every((v) => v === 17)).toBe(true);
    await fireEvent.click(within(container.querySelector('.qtable') as HTMLElement).getByRole('button', { name: 'Standard' }));
    expect(lastPush()[0].tables).toBeNull();
  });

  it('replaces only the chroma table when a chroma block is selected', async () => {
    const saved = jpegSummaryFixture.selected.component;
    jpegSummaryFixture.selected.component = 1;
    try {
      const { getByLabelText, getByRole } = await renderLab('stage=quantize');
      const cell = await vi.waitFor(() => getByLabelText('Q(1, 0)') as HTMLInputElement);
      await fireEvent.change(cell, { target: { value: '99' } });
      await fireEvent.click(getByRole('button', { name: 'Apply to image' }));
      const [luma, chroma] = lastPush()[0].tables!;
      // The luma table keeps what the encoder was using (16s in the fake); chroma takes the edit.
      expect(luma.every((v) => v === 16)).toBe(true);
      expect(chroma[1]).toBe(99);
      expect(chroma.filter((v) => v !== 16)).toEqual([99]);
    } finally {
      jpegSummaryFixture.selected.component = saved;
    }
  });

  it('shows a custom-tables chip on every stage, with a way back to the standard tables', async () => {
    const { getByLabelText, getByRole, container } = await renderLab('stage=quantize');
    expect(container.querySelector('.custom-chip')).toBeNull();
    const cell = await vi.waitFor(() => getByLabelText('Q(1, 0)') as HTMLInputElement);
    await fireEvent.change(cell, { target: { value: '99' } });
    await fireEvent.click(getByRole('button', { name: 'Apply to image' }));
    // Away from the Quantize stage, the Quality slider still is not what sizes the file: say so.
    await fireEvent.click(getByRole('button', { name: /DCT/ }));
    const chip = container.querySelector('.custom-chip') as HTMLElement;
    expect(chip.textContent).toContain('Custom Q tables');
    await fireEvent.click(within(chip).getByRole('button', { name: 'Standard' }));
    expect(lastPush()[0].tables).toBeNull();
    expect(container.querySelector('.custom-chip')).toBeNull();
  });

  it('disables Re-save while custom tables are in use and says to press Standard first', async () => {
    const { getByLabelText, getByRole, container } = await renderLab('stage=quantize');
    const cell = await vi.waitFor(() => getByLabelText('Q(1, 0)') as HTMLInputElement);
    await fireEvent.change(cell, { target: { value: '99' } });
    await fireEvent.click(getByRole('button', { name: 'Apply to image' }));
    await fireEvent.click(getByRole('button', { name: /Decode/ }));
    const resave = (await vi.waitFor(() => getByRole('button', { name: /Re-save/ }))) as HTMLButtonElement;
    expect(resave.disabled).toBe(true);
    expect(container.querySelector('.resave')?.textContent).toContain('Re-save uses the quality-scaled tables, so press Standard first.');
    await fireEvent.click(within(container.querySelector('.custom-chip') as HTMLElement).getByRole('button', { name: 'Standard' }));
    await vi.waitFor(() => expect((getByRole('button', { name: /Re-save/ }) as HTMLButtonElement).disabled).toBe(false));
    expect(container.querySelector('.resave')?.textContent).not.toContain('press Standard first');
  });

  it('names the saved file custom while custom tables are in use', async () => {
    const { getByLabelText, getByRole } = await renderLab('stage=quantize&s=444');
    const cell = await vi.waitFor(() => getByLabelText('Q(1, 0)') as HTMLInputElement);
    await fireEvent.change(cell, { target: { value: '99' } });
    await fireEvent.click(getByRole('button', { name: 'Apply to image' }));
    const saved = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      await fireEvent.click(getByRole('button', { name: /Save .jpg/ }));
      expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('jpeg-lab-custom-444.jpg');
      await vi.waitFor(() => expect(revoke).toHaveBeenCalled());
    } finally {
      click.mockRestore();
      Object.assign(URL, { createObjectURL: saved.create, revokeObjectURL: saved.revoke });
    }
  });

  it('draws the rate–distortion curve from the kit', async () => {
    const { container } = await renderLab('stage=quantize');
    await vi.waitFor(() => expect(container.querySelector('.rd polyline')?.getAttribute('points')?.split(' ').length).toBe(100), {
      timeout: 3000,
    });
    expect(container.querySelector('.rd figcaption')?.textContent).not.toContain('of 100');
  });

  it('lights the zigzag cells the viz path has reached', async () => {
    const { container } = await renderLab('stage=zigzag');
    await vi.waitFor(() => expect(container.querySelectorAll('.seq li.lit')).toHaveLength(10));
    expect(container.querySelector('.strip .head')?.textContent).toContain('#1 of 64');
    expect(container.querySelectorAll('.seq li.tail')).toHaveLength(63);
  });

  it('says "All 64 are zero" instead of "#0 of 64" for a block that rounds to nothing', async () => {
    const saved = jpegSummaryFixture.selected.zigzag;
    jpegSummaryFixture.selected.zigzag = saved.map(() => 0);
    try {
      const { container } = await renderLab('stage=zigzag');
      await vi.waitFor(() => expect(container.querySelector('.strip .head')?.textContent).toContain('All 64 are zero'));
      expect(container.querySelector('.strip .head')?.textContent).not.toContain('#0');
      expect(document.querySelector('.stage-card')?.textContent).toContain('all 64 are zero');
    } finally {
      jpegSummaryFixture.selected.zigzag = saved;
    }
  });

  it('spells out the selected block as tokens and their bits', async () => {
    const { container } = await renderLab('stage=rle');
    const chips = await vi.waitFor(() => {
      const c = container.querySelectorAll('.tokens li');
      expect(c).toHaveLength(2);
      return c;
    });
    expect(chips[0].textContent).toContain('DC +2');
    expect(chips[0].textContent).toContain('01110');
    expect(chips[1].textContent).toContain('EOB');
    expect(container.querySelector('.tokens .head')?.textContent).toContain('2 tokens and 9 bits');
  });

  it('shows the Huffman tables, the block bits, the file and what the other tables would cost', async () => {
    const { container, getByRole } = await renderLab('stage=huffman');
    await vi.waitFor(() => expect(container.querySelectorAll('[role="tab"]')).toHaveLength(4));
    expect(getByRole('tab', { name: 'AC · luma' }).getAttribute('aria-selected')).toBe('true');
    await vi.waitFor(() => expect(container.querySelector('p.stat')?.textContent).toContain('5000'));
    expect(container.querySelector('p.stat')?.textContent).toContain('With standard tables');
    expect(container.querySelector('.huff .bits')?.textContent).toBe('011101010');
    expect(container.querySelectorAll('.file .seg')).toHaveLength(4);
    await vi.waitFor(() => expect(container.querySelectorAll('circle.leaf')).toHaveLength(2));
  });

  it('jumps to the artifact hints, sets the wipe and error gain, and re-saves twenty times', async () => {
    const { getByRole, container } = await renderLab('stage=decode');
    await vi.waitFor(() => getByRole('button', { name: 'Ringing' }));
    ruleActionSpy.mockClear();
    await fireEvent.click(getByRole('button', { name: 'Ringing' }));
    expect(ruleActionSpy).toHaveBeenLastCalledWith({ kind: 'select_block', component: 0, bx: 5, by: 6 });
    expect(route.query).toContain('b=5,6');
    // The visible label is the accessible name (WCAG 2.5.3).
    await fireEvent.input(getByRole('slider', { name: 'Wipe' }), { target: { value: '0.25' } });
    expect(lastViz().wipe).toBe(0.25);
    await fireEvent.input(getByRole('slider', { name: /^Error ×/ }), { target: { value: '9' } });
    expect(lastViz().error_gain).toBe(9);
    await fireEvent.click(getByRole('button', { name: /Re-save/ }));
    await vi.waitFor(() => expect(container.querySelector('.resave')?.textContent).toContain('gen 20'), { timeout: 3000 });
    // Each fake generation drifts one level further, so generation 20 is off by 20 in every channel.
    expect(container.querySelector('.resave')?.textContent).toContain(`${(20 * Math.log10(255 / 20)).toFixed(2)} dB`);
  });

  it('keeps an unapplied Q-table edit while the scan ticks', async () => {
    const { getByLabelText, getByRole } = await renderLab('stage=quantize');
    const cell = await vi.waitFor(() => getByLabelText('Q(1, 0)') as HTMLInputElement);
    await fireEvent.input(cell, { target: { value: '99' } });
    expect((getByRole('button', { name: 'Apply to image' }) as HTMLButtonElement).disabled).toBe(false);
    Object.assign(snapshotFixture, { iteration: 128, max_iterations: 256 });
    try {
      // Wait for the page to read the new tick (it re-reads the summary on the same change).
      await vi.waitFor(() => expect(document.querySelector('.readout')?.textContent).toContain('128'));
      await new Promise((r) => setTimeout(r, 30));
      expect((getByLabelText('Q(1, 0)') as HTMLInputElement).value).toBe('99');
      expect((getByRole('button', { name: 'Apply to image' }) as HTMLButtonElement).disabled).toBe(false);
    } finally {
      Object.assign(snapshotFixture, { iteration: 0, max_iterations: 360, playing: false });
    }
  });

  it('disables the Ringing hint when the picture has no hard edges', async () => {
    const saved = jpegSummaryFixture.hints;
    (jpegSummaryFixture as { hints: unknown }).hints = { blocking: [3, 4], ringing: undefined, bleed: [7, 8] };
    try {
      const { getByRole } = await renderLab('stage=decode');
      const ringing = (await vi.waitFor(() => getByRole('button', { name: 'Ringing' }))) as HTMLButtonElement;
      // It stays focusable and hoverable (a disabled button gets no pointer or keys), so its card can say why.
      expect(ringing.getAttribute('aria-disabled')).toBe('true');
      expect(ringing.hasAttribute('title')).toBe(false);
      ruleActionSpy.mockClear();
      await fireEvent.click(ringing);
      expect(ruleActionSpy).not.toHaveBeenCalled();
      ringing.focus();
      await vi.waitFor(() => expect(document.querySelector('[data-testid="tooltip-hover"]')?.textContent).toContain('no hard edges'));
      // The reason is on screen too, not only in a tooltip (touch has none).
      expect(document.querySelector('.hints')?.textContent).toContain('No hard edges here, so nothing rings.');
      expect(getByRole('button', { name: 'Blocking' }).getAttribute('aria-disabled')).toBeNull();
    } finally {
      jpegSummaryFixture.hints = saved;
    }
  });

  it('keeps the Decode controls on a short laptop stage', async () => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', size(800, 0));
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', size(0, 420));
    try {
      const { getByRole } = await renderLab('stage=decode');
      await vi.waitFor(() => getByRole('slider', { name: 'Wipe' }));
      expect(getByRole('button', { name: /Re-save/ })).toBeTruthy();
      expect(getByRole('button', { name: 'Blocking' })).toBeTruthy();
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', size(1134, 0));
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', size(0, 585));
    }
  });
});

// One current block: the scan and the selection are one position, which Play, Back, Forward, clicks,
// keys, hints and links all move. The fake engine does not follow the scan itself, so these tests move
// the summary's selection and the snapshot's clock by hand, as the rule and the engine would.
describe('JpegLab.svelte current block', () => {
  const savedSel = { component: jpegSummaryFixture.selected.component, bx: jpegSummaryFixture.selected.bx, by: jpegSummaryFixture.selected.by };

  beforeEach(() => {
    localStorage.setItem(TOUR_SEEN_KEY, '1');
    dispatchSpy.mockClear();
    ruleActionSpy.mockClear();
    updateRuleConfigWithImageSpy.mockClear();
    updateVizConfigSpy.mockClear();
  });

  afterEach(() => {
    Object.assign(jpegSummaryFixture.selected, savedSel);
    Object.assign(snapshotFixture, { iteration: 0, max_iterations: 360, playing: false });
  });

  /** Wait until the shell shows the clock at step `n`. */
  const atStep = (n: number) =>
    vi.waitFor(() => expect(document.querySelector('.readout')?.textContent?.startsWith(`${n} `)).toBe(true));
  /** Move the fake engine one scan step, its selection on luma block `(bx, by)`, as the rule does. */
  async function scanTo(n: number, bx: number, by: number) {
    Object.assign(jpegSummaryFixture.selected, { component: 0, bx, by });
    snapshotFixture.iteration = n;
    await atStep(n);
    await new Promise((r) => setTimeout(r, 10));
  }
  const zigzagPatches = () =>
    updateVizConfigSpy.mock.calls.map(([c]) => c as { zigzag_speed?: number }).filter((c) => c.zigzag_speed !== undefined);

  it('a click on the picture pauses the scan and jumps it there', async () => {
    const { findByRole } = await renderLab('stage=dct');
    const pick = await findByRole('button', { name: /Pick a block/ });
    const image = jpegLayout('dct', 1134, 585, 256, 256).image;
    ruleActionSpy.mockClear();
    dispatchSpy.mockClear();
    const at = { clientX: image.x + ((2 * 8 + 4) / 256) * image.w, clientY: image.y + ((3 * 8 + 4) / 256) * image.h };
    await fireEvent(pick, new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, ...at }));
    const select = ruleActionSpy.mock.calls.findIndex(([a]) => (a as { kind: string }).kind === 'select_block');
    expect(ruleActionSpy.mock.calls[select][0]).toEqual({ kind: 'select_block', component: 0, bx: 2, by: 3 });
    const pause = kinds().indexOf('Pause');
    const jump = kinds().indexOf('JumpTo');
    // MCU (1, 1) of a 16-MCU row: step 18 has scanned it.
    expect(dispatchSpy.mock.calls[jump][0]).toEqual({ kind: 'JumpTo', iteration: 18 });
    const order = (spy: typeof dispatchSpy, i: number) => spy.mock.invocationCallOrder[i];
    expect(order(ruleActionSpy, select)).toBeLessThan(order(dispatchSpy, pause));
    expect(order(dispatchSpy, pause)).toBeLessThan(order(dispatchSpy, jump));
    expect(route.query).toBe('stage=dct&b=2,3');
  });

  it('the panels and the link follow the scan while it is paused', async () => {
    await renderLab('stage=dct');
    await scanTo(5, 8, 0);
    await vi.waitFor(() => expect(route.query).toContain('b=8,0'));
  });

  it('following the scan while playing pushes no viz config and writes no link', async () => {
    await renderLab('stage=dct');
    snapshotFixture.playing = true;
    await vi.waitFor(() => expect(zigzagPatches()).toEqual([{ zigzag_speed: 0 }]));
    updateVizConfigSpy.mockClear();
    const before = route.query;
    await scanTo(5, 8, 0);
    await scanTo(6, 10, 0);
    await scanTo(7, 12, 0);
    expect(updateVizConfigSpy).not.toHaveBeenCalled();
    expect(route.query).toBe(before);
    snapshotFixture.playing = false;
    await vi.waitFor(() => expect(route.query).toContain('b=12,0'));
  });

  it("a shared block off the grid opens the scan at the clamped block's step", async () => {
    await renderLab('stage=blocks&b=999,999');
    await vi.waitFor(() => expect(ruleActionSpy).toHaveBeenCalledWith({ kind: 'select_block', component: 0, bx: 31, by: 31 }));
    // Luma (31, 31) is in the last MCU of 256.
    expect(dispatchSpy).toHaveBeenCalledWith({ kind: 'JumpTo', iteration: 256 });
    expect(kinds()).not.toContain('Play');
  });

  it('a link pasted while the lab is open puts the scan on its block', async () => {
    await renderLab('stage=dct');
    dispatchSpy.mockClear();
    navigate('jpeg', 'stage=dct&b=2,3');
    await vi.waitFor(() => expect(ruleActionSpy).toHaveBeenCalledWith({ kind: 'select_block', component: 0, bx: 2, by: 3 }));
    expect(dispatchSpy).toHaveBeenCalledWith({ kind: 'JumpTo', iteration: 18 });
    expect(kinds()).not.toContain('Play');
  });

  it('a link pasted with other settings opens paused on its block, even while the scan was playing', async () => {
    Object.assign(snapshotFixture, { iteration: 64, max_iterations: 256, playing: true });
    await renderLab('stage=dct');
    await atStep(64);
    dispatchSpy.mockClear();
    navigate('jpeg', 'stage=dct&q=20&b=2,3');
    await vi.waitFor(() => expect(lastPush()[0].quality).toBe(20));
    // MCU (1, 1) of a 16-MCU row: step 18 has scanned it. The re-encode rewinds the engine, and nothing plays it on.
    expect(dispatchSpy).toHaveBeenCalledWith({ kind: 'JumpTo', iteration: 18 });
    expect(kinds()).not.toContain('Play');
  });

  it('a link with no block, opened from a chroma plane, goes back to the encoder\'s luma block', async () => {
    const { getByRole } = await renderLab('stage=blocks&b=2,3');
    await fireEvent.click(getByRole('button', { name: 'Cb' }));
    expect(ruleActionSpy).toHaveBeenLastCalledWith({ kind: 'select_block', component: 1, bx: 1, by: 1 });
    ruleActionSpy.mockClear();
    dispatchSpy.mockClear();
    navigate('jpeg', 'stage=blocks');
    // The summary's default is luma (21, 17), in MCU 138; the rule must not stay on chroma for the next step to follow.
    await vi.waitFor(() => expect(ruleActionSpy).toHaveBeenCalledWith({ kind: 'select_block', component: 0, bx: 21, by: 17 }));
    expect(dispatchSpy).toHaveBeenCalledWith({ kind: 'JumpTo', iteration: 139 });
    expect(kinds()).not.toContain('Play');
  });

  it('turns Reset and Back off at the first step and Play and Forward off at the end', async () => {
    Object.assign(snapshotFixture, { iteration: 1, max_iterations: 256, playing: false });
    const { container } = await renderLab('stage=dct');
    await atStep(1);
    const transport = within(container.querySelector<HTMLElement>('.transport')!);
    const off = (name: RegExp) => transport.getByRole('button', { name }).getAttribute('aria-disabled');
    // The lab's first step is 1 (the scan waits just after a block), so Reset and Back have nowhere to go.
    expect([off(/Reset/), off(/Back/), off(/Play/), off(/Forward/)]).toEqual(['true', 'true', null, null]);
    snapshotFixture.iteration = 256;
    await atStep(256);
    expect([off(/Reset/), off(/Back/), off(/Play/), off(/Forward/)]).toEqual([null, null, 'true', 'true']);
  });

  it('switches the transport off on the overview and on at a stage', async () => {
    snapshotFixture.iteration = 64; // mid-scan, so nothing is off for being at the start or the end
    const { container, getByRole } = await renderLab(); // opens on the overview
    await atStep(64);
    const transport = () => within(container.querySelector<HTMLElement>('.transport')!);
    for (const name of [/Reset/, /Back/, /Play/, /Forward/]) expect(transport().getByRole('button', { name }).getAttribute('aria-disabled')).toBe('true');
    dispatchSpy.mockClear();
    await fireEvent.click(transport().getByRole('button', { name: /Play/ }));
    expect(dispatchSpy).not.toHaveBeenCalled();
    await fireEvent.click(getByRole('button', { name: 'Step 1: Color' }));
    for (const name of [/Reset/, /Back/, /Play/, /Forward/]) expect(transport().getByRole('button', { name }).getAttribute('aria-disabled')).toBeNull();
  });

  it('shows the zigzag path whole while the scan plays', async () => {
    await renderLab('stage=zigzag');
    await new Promise((r) => setTimeout(r, 10));
    expect(zigzagPatches()).toEqual([]); // not on mount
    snapshotFixture.playing = true;
    await vi.waitFor(() => expect(updateVizConfigSpy).toHaveBeenCalledWith(expect.objectContaining({ zigzag_speed: 0 })));
    snapshotFixture.playing = false;
    await vi.waitFor(() => expect(updateVizConfigSpy).toHaveBeenLastCalledWith(expect.objectContaining({ zigzag_speed: 24 })));
  });
});

// The cards (hover, pin, keyboard) on the DCT and Quantize stages. The fake engine's summary follows each push, as
// the real one does: a new version, and the quality that was asked for.
describe('JpegLab.svelte cards', () => {
  const saved = { quality: jpegSummaryFixture.quality, version: jpegSummaryFixture.version };

  beforeEach(() => {
    localStorage.setItem(TOUR_SEEN_KEY, '1');
    dispatchSpy.mockClear();
    ruleActionSpy.mockClear();
    updateRuleConfigWithImageSpy.mockReset();
    updateRuleConfigWithImageSpy.mockImplementation((cfg: Config) => {
      jpegSummaryFixture.version += 1;
      jpegSummaryFixture.quality = cfg.quality;
    });
    updateVizConfigSpy.mockClear();
    jpegDecodeSpy.mockClear();
  });

  afterEach(() => {
    updateRuleConfigWithImageSpy.mockReset();
    Object.assign(jpegSummaryFixture, saved);
  });

  /** jsdom has no PointerEvent: a MouseEvent of that type carries the coordinates (relative to the overlay, which sits at 0, 0). */
  const ptr = (type: string, x: number, y: number, init: MouseEventInit = {}) =>
    new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, ...init });

  const layoutOf = (stage: StageId) => jpegLayout(stage, 1134, 585, 256, 256);
  /** The centre of cell `(u, v)` of a stage's panel. */
  function centreOf(stage: StageId, kind: string, u: number, v: number) {
    const rect = layoutOf(stage).panels.find((p) => p.kind === kind)!.rect;
    const c = cells(rect, 1)[u + 8 * v];
    return { x: c.x + c.w / 2, y: c.y + c.h / 2 };
  }
  /** The hover area laid over a stage's panel. */
  const areaOf = (container: HTMLElement, stage: StageId, kind: string) =>
    vi.waitFor(() => {
      const rect = layoutOf(stage).panels.find((p) => p.kind === kind)!.rect;
      const a = [...container.querySelectorAll<HTMLElement>('.hover-area')].find(
        (el) => Math.abs(parseFloat(el.style.left) - rect.x) < 0.01 && Math.abs(parseFloat(el.style.top) - rect.y) < 0.01,
      );
      expect(a).toBeTruthy();
      return a!;
    });

  it('explains a DCT coefficient on hover', async () => {
    const { container, queryByTestId, findByTestId } = await renderLab('stage=dct');
    const area = await areaOf(container, 'dct', 'coeffs');
    const c = centreOf('dct', 'coeffs', 1, 0);
    await fireEvent(area, ptr('pointermove', c.x, c.y));
    expect(queryByTestId('tooltip-hover')).toBeNull(); // the card waits 150 ms
    const card = await findByTestId('tooltip-hover');
    expect(card.textContent).toContain('F(1,0)');
    expect(card.textContent).toContain('rounds to');
  });

  it('pins a quantize cell on click and unfolds the details', async () => {
    const { container, findByTestId, getByRole } = await renderLab('stage=quantize');
    const area = await areaOf(container, 'quantize', 'quant');
    const c = centreOf('quantize', 'quant', 1, 0);
    await fireEvent(area, ptr('click', c.x, c.y, { detail: 1 }));
    const pinned = await findByTestId('tooltip-pinned');
    expect(pinned.textContent).toContain('Pattern (1, 0), rounded');
    expect(pinned.querySelector('[data-testid="tooltip-details"]')).toBeNull();
    await fireEvent.click(getByRole('button', { name: 'More' }));
    expect((await findByTestId('tooltip-details')).textContent).toContain('Decoder multiplies back');
  });

  it('updates a pinned quantize card as quality changes', async () => {
    const { container, findByTestId, getByLabelText, getByTestId } = await renderLab('stage=quantize');
    const area = await areaOf(container, 'quantize', 'quant');
    const c = centreOf('quantize', 'quant', 1, 0);
    const pushed = pushes().length;
    await fireEvent(area, ptr('click', c.x, c.y, { detail: 1 }));
    expect((await findByTestId('tooltip-pinned')).textContent).toContain('quality 50');
    expect(pushes().length).toBe(pushed); // a card never encodes
    await fireEvent.input(getByLabelText('Quality'), { target: { value: '20' } });
    await vi.waitFor(() => expect(pushes().length).toBe(pushed + 1)); // only the encode the slider itself causes
    await vi.waitFor(() => expect(getByTestId('tooltip-pinned').textContent).toContain('quality 20'));
    expect(pushes().length).toBe(pushed + 1);
  });

  it('decodes the current file once per encode', async () => {
    const { container, findByTestId, getByLabelText } = await renderLab('stage=dct');
    await vi.waitFor(() => expect(jpegDecodeSpy).toHaveBeenCalledTimes(1), { timeout: 2000 }); // the decode waits for the encodes to settle
    expect(Array.from(jpegDecodeSpy.mock.calls[0][0] as Uint8Array)).toEqual([0xff, 0xd8, 0xff, 0xd9]);
    // Hovering, and a card appearing, decode nothing.
    const area = await areaOf(container, 'dct', 'coeffs');
    for (const u of [1, 2, 3]) {
      const c = centreOf('dct', 'coeffs', u, 0);
      await fireEvent(area, ptr('pointermove', c.x, c.y));
    }
    await findByTestId('tooltip-hover');
    await new Promise((r) => setTimeout(r, 50));
    expect(jpegDecodeSpy).toHaveBeenCalledTimes(1);
    await fireEvent.input(getByLabelText('Quality'), { target: { value: '20' } });
    await vi.waitFor(() => expect(jpegDecodeSpy).toHaveBeenCalledTimes(2), { timeout: 2000 });
  });

  it('decodes once after a quality drag, not once per frame', async () => {
    const { getByLabelText } = await renderLab('stage=dct');
    await vi.waitFor(() => expect(jpegDecodeSpy).toHaveBeenCalledTimes(1), { timeout: 2000 });
    const before = pushes().length;
    for (const v of ['20', '30', '40']) {
      await fireEvent.input(getByLabelText('Quality'), { target: { value: v } });
      await new Promise((r) => setTimeout(r, 20)); // a frame each, well inside the settling time
    }
    await vi.waitFor(() => expect(pushes().length).toBeGreaterThan(before + 1));
    await vi.waitFor(() => expect(jpegDecodeSpy).toHaveBeenCalledTimes(2), { timeout: 2000 });
    await new Promise((r) => setTimeout(r, 300));
    expect(jpegDecodeSpy).toHaveBeenCalledTimes(2);
  });

  it('an acting target keeps its click', async () => {
    const { findByRole, queryByTestId } = await renderLab('stage=dct');
    const pick = await findByRole('button', { name: /Pick a block/ });
    const image = layoutOf('dct').image;
    ruleActionSpy.mockClear();
    await fireEvent(pick, ptr('click', image.x + image.w / 2, image.y + image.h / 2, { detail: 1 }));
    expect(ruleActionSpy).toHaveBeenCalledWith({ kind: 'select_block', component: 0, bx: 16, by: 16 });
    expect(queryByTestId('tooltip-pinned')).toBeNull(); // the image picks a block; it does not pin a card
  });

  it('explains a rebuilt sample of the Quantize stage from the canvas', async () => {
    const { container, findByTestId } = await renderLab('stage=quantize');
    await vi.waitFor(() => expect(container.querySelector('.hover-area')).toBeTruthy());
    const canvas = container.querySelector('canvas')!;
    const c = centreOf('quantize', 'dequant_rebuild', 3, 2);
    await fireEvent(canvas, ptr('pointermove', c.x, c.y));
    expect((await findByTestId('tooltip-hover')).textContent).toContain('Rebuilt sample (3, 2)');
  });

  it('lets the keyboard step through the coefficients', async () => {
    const { getByLabelText, findByTestId } = await renderLab('stage=dct');
    const grid = await vi.waitFor(() => getByLabelText(/How much of each this block uses/) as HTMLElement);
    expect(grid.tabIndex).toBe(0);
    expect(grid.getAttribute('role')).toBe('group');
    updateVizConfigSpy.mockClear();
    grid.focus();
    // Keyboard focus lights the roving cell's pattern, as the pointer does.
    await vi.waitFor(() => expect(lastViz().hover).toEqual([0, 0]));
    await fireEvent.keyDown(grid, { key: 'ArrowRight' });
    await vi.waitFor(() => expect(lastViz().hover).toEqual([1, 0]));
    await fireEvent.keyDown(grid, { key: 'ArrowLeft' });
    expect((await findByTestId('tooltip-hover')).textContent).toContain('F(0,0)');
    await fireEvent.keyDown(grid, { key: 'ArrowRight' });
    await vi.waitFor(() => expect(document.querySelector('[data-testid="tooltip-hover"]')!.textContent).toContain('F(1,0)'));
    expect(route.query).toBe('stage=dct'); // the arrow moved a cell; it did not change stage
    await fireEvent.keyDown(grid, { key: 'ArrowDown' });
    await vi.waitFor(() => expect(document.querySelector('[data-testid="tooltip-hover"]')!.textContent).toContain('F(1,1)'));
    await fireEvent.keyDown(grid, { key: 'Enter' });
    expect((await findByTestId('tooltip-pinned')).textContent).toContain('F(1,1)');
  });

  it('explains a Q-table cell when it is focused, and keeps typing for itself', async () => {
    const { getByLabelText, findByTestId } = await renderLab('stage=quantize');
    const cell = await vi.waitFor(() => getByLabelText('Q(1, 0)') as HTMLInputElement);
    cell.focus();
    const card = await findByTestId('tooltip-hover');
    expect(card.textContent).toContain('Edit step (1, 0)');
    await fireEvent.keyDown(cell, { key: 'Enter' });
    expect(document.querySelector('[data-testid="tooltip-pinned"]')).toBeNull(); // an input acts: no pin
  });

  describe('the colour, block and coding stages', () => {
    it('explains a token chip on the run-length stage', async () => {
      const { container, findByTestId } = await renderLab('stage=rle');
      const chips = await vi.waitFor(() => {
        const c = container.querySelectorAll<HTMLElement>('.tokens li');
        expect(c).toHaveLength(2);
        return c;
      });
      expect(chips[1].querySelector('title')).toBeNull();
      expect(chips[1].hasAttribute('title')).toBe(false);
      await fireEvent(chips[1], ptr('pointermove', 0, 0));
      const card = await findByTestId('tooltip-hover');
      expect(card.textContent).toContain('every remaining number is zero');
      expect(card.textContent).toContain('1010');
    });

    it('explains the DC chip and the bit count', async () => {
      const { container, findByTestId } = await renderLab('stage=rle');
      const dc = await vi.waitFor(() => {
        const el = container.querySelector<HTMLElement>('.tokens li.dc');
        expect(el).toBeTruthy();
        return el!;
      });
      await fireEvent(dc, ptr('pointermove', 0, 0));
      expect((await findByTestId('tooltip-hover')).textContent).toContain('8 − 6 = 2');
      await fireEvent(container.querySelector('.tokens .head')!, ptr('pointermove', 0, 0));
      await vi.waitFor(() => expect(document.querySelector('[data-testid="tooltip-hover"]')!.textContent).toContain('2 tokens, 9 bits'));
    });

    it('explains a zigzag cell, the last non-zero figure and the grid', async () => {
      const { container, findByTestId } = await renderLab('stage=zigzag');
      const cells = await vi.waitFor(() => {
        const c = container.querySelectorAll<HTMLElement>('.seq li');
        expect(c).toHaveLength(64);
        return c;
      });
      await fireEvent(cells[5], ptr('pointermove', 0, 0));
      expect((await findByTestId('tooltip-hover')).textContent).toContain('in the zero tail');
      await fireEvent(container.querySelector('.strip .head')!, ptr('pointermove', 0, 0));
      await vi.waitFor(() => expect(document.querySelector('[data-testid="tooltip-hover"]')!.textContent).toContain('#1 of 64'));
      const area = await areaOf(container, 'zigzag', 'zigzag');
      const c = centreOf('zigzag', 'zigzag', 1, 0);
      await fireEvent(area, ptr('pointermove', c.x, c.y));
      await vi.waitFor(() => expect(document.querySelector('[data-testid="tooltip-hover"]')!.textContent).toContain('#2 of 64'));
    });

    it('reaches a sequence cell from the keyboard, one stop for the whole strip', async () => {
      const { container, findByTestId } = await renderLab('stage=zigzag');
      const cells = await vi.waitFor(() => {
        const c = container.querySelectorAll<HTMLElement>('.seq li');
        expect(c).toHaveLength(64);
        return c;
      });
      expect([...cells].filter((c) => c.tabIndex === 0)).toHaveLength(1);
      cells[0].focus();
      expect((await findByTestId('tooltip-hover')).textContent).toContain('#1 of 64');
      await fireEvent.keyDown(cells[0], { key: 'ArrowRight' });
      expect(document.activeElement).toBe(cells[1]);
    });

    it('makes the token chips one tab stop, walked with the arrow keys', async () => {
      const { container, findByTestId } = await renderLab('stage=rle');
      const chips = await vi.waitFor(() => {
        const c = container.querySelectorAll<HTMLElement>('.tokens li.chip');
        expect(c.length).toBeGreaterThanOrEqual(2);
        return [...c];
      });
      expect(chips.filter((c) => c.tabIndex === 0)).toHaveLength(1);
      chips[0].focus();
      expect((await findByTestId('tooltip-hover')).textContent).toContain('8 − 6 = 2');
      await fireEvent.keyDown(chips[0], { key: 'ArrowRight' });
      expect(document.activeElement).toBe(chips[1]);
      await vi.waitFor(() => expect(document.querySelector('[data-testid="tooltip-hover"]')!.textContent).toContain('zero'));
      expect(chips.filter((c) => c.tabIndex === 0)).toEqual([chips[1]]); // the stop follows the focus
      await fireEvent.keyDown(chips[1], { key: 'ArrowLeft' });
      expect(document.activeElement).toBe(chips[0]);
      expect(route.query).toBe('stage=rle'); // the arrows are not also a stage switch
    });

    it('makes the file segments one tab stop, walked with the arrow keys', async () => {
      const { container, findByTestId } = await renderLab('stage=huffman');
      const segs = await vi.waitFor(() => {
        const c = container.querySelectorAll<HTMLElement>('.file .seg');
        expect(c.length).toBeGreaterThanOrEqual(2);
        return [...c];
      });
      expect(segs.filter((c) => c.tabIndex === 0)).toHaveLength(1);
      segs[0].focus();
      await findByTestId('tooltip-hover');
      await fireEvent.keyDown(segs[0], { key: 'ArrowRight' });
      expect(document.activeElement).toBe(segs[1]);
      expect(segs.filter((c) => c.tabIndex === 0)).toEqual([segs[1]]);
      expect(route.query).toBe('stage=huffman');
    });

    it('explains a block cell from the canvas panel', async () => {
      const { container, findByTestId } = await renderLab('stage=blocks');
      const area = await areaOf(container, 'blocks', 'block');
      const c = centreOf('blocks', 'block', 0, 0);
      await fireEvent(area, ptr('pointermove', c.x, c.y));
      const card = await findByTestId('tooltip-hover');
      expect(card.textContent).toContain('100');
      expect(card.textContent).toContain('−128 → −28');
    });

    it('explains the plane switch and the shift, and both keep their click', async () => {
      const { container, findByTestId, getByRole } = await renderLab('stage=blocks');
      const cb = await vi.waitFor(() => getByRole('button', { name: 'Cb' }));
      expect(cb.hasAttribute('title')).toBe(false);
      await fireEvent(cb, ptr('pointermove', 0, 0));
      expect((await findByTestId('tooltip-hover')).textContent).toContain('block (21, 17)');
      const shift = getByRole('button', { name: '− 128' });
      expect(shift.hasAttribute('title')).toBe(false);
      await fireEvent(shift, ptr('pointermove', 0, 0));
      await vi.waitFor(() => expect(document.querySelector('[data-testid="tooltip-hover"]')!.textContent).toContain('−128 on every sample'));
      expect(shift.getAttribute('aria-pressed')).toBe('true'); // the shift is shown to begin with
      await fireEvent.click(shift);
      await vi.waitFor(() => expect(shift.getAttribute('aria-pressed')).toBe('false'));
      expect(container.querySelector('[data-testid="tooltip-pinned"]')).toBeNull();
    });

    it('explains the colour cube, a plane and the axes slider', async () => {
      const { container, findByTestId, getByLabelText } = await renderLab('stage=color');
      const areas = await vi.waitFor(() => {
        const a = container.querySelectorAll<HTMLElement>('.hover-area');
        expect(a).toHaveLength(4);
        return [...a];
      });
      const rectOf = (kind: string) => layoutOf('color').panels.find((p) => p.kind === kind)!.rect;
      const at = (kind: string) => ({ x: rectOf(kind).x + rectOf(kind).w / 2, y: rectOf(kind).y + rectOf(kind).h / 2 });
      const area = (kind: string) => areas.find((a) => Math.abs(parseFloat(a.style.left) - rectOf(kind).x) < 0.01 && Math.abs(parseFloat(a.style.top) - rectOf(kind).y) < 0.01)!;
      await fireEvent(area('cube'), ptr('pointermove', at('cube').x, at('cube').y));
      expect((await findByTestId('tooltip-hover')).textContent).toContain('grey diagonal');
      await fireEvent(area('plane_cb'), ptr('pointermove', at('plane_cb').x, at('plane_cb').y));
      await vi.waitFor(() => expect(document.querySelector('[data-testid="tooltip-hover"]')!.textContent).toMatch(/Cb = \d+/));
      await fireEvent(getByLabelText('RGB axes to YCbCr axes'), ptr('pointermove', 0, 0));
      await vi.waitFor(() => expect(document.querySelector('[data-testid="tooltip-hover"]')!.textContent).toContain('brightness and colour-difference axes'));
    });

    it('leaves the pointer to the canvas on the colour panels, so the cube can still be dragged', async () => {
      for (const stage of ['color', 'subsample'] as const) {
        const { container, findByTestId, unmount } = await renderLab(`stage=${stage}`);
        const areas = await vi.waitFor(() => {
          const a = container.querySelectorAll<HTMLElement>('.hover-area');
          expect(a.length).toBeGreaterThanOrEqual(stage === 'color' ? 4 : 4);
          return [...a];
        });
        for (const a of areas) expect(a.style.pointerEvents, stage).toBe('none');
        expect(areas.every((a) => a.tabIndex === 0)).toBe(true); // still reachable from the keyboard
        if (stage === 'color') {
          const r = layoutOf('color').panels.find((p) => p.kind === 'cube')!.rect;
          await fireEvent(container.querySelector('canvas')!, ptr('pointermove', r.x + r.w / 2, r.y + r.h / 2));
          expect((await findByTestId('tooltip-hover')).textContent).toContain('grey diagonal');
        }
        unmount();
      }
    });

    it('does not push a viz config for hover on the blocks and zigzag grids', async () => {
      for (const [stage, kind] of [['blocks', 'block'], ['zigzag', 'zigzag']] as const) {
        const { container, findByTestId, unmount } = await renderLab(`stage=${stage}`);
        const area = await areaOf(container, stage, kind);
        await vi.waitFor(() => expect(updateVizConfigSpy).toHaveBeenCalled());
        updateVizConfigSpy.mockClear();
        const c = centreOf(stage, kind, 3, 2);
        await fireEvent(area, ptr('pointermove', c.x, c.y));
        await findByTestId('tooltip-hover'); // the card still comes
        expect(updateVizConfigSpy).not.toHaveBeenCalled();
        unmount();
      }
    });

    it('keeps the axes slider\'s ? to one action', async () => {
      const { container, getByLabelText } = await renderLab('stage=color');
      const input = await vi.waitFor(() => getByLabelText('RGB axes to YCbCr axes'));
      expect(input.closest('label')!.getAttribute('aria-describedby')).toBeNull();
      expect(input.getAttribute('aria-describedby')).toBeTruthy();
      void container;
    });

    it('explains the samples-kept figure', async () => {
      const { container, findByTestId } = await renderLab('stage=subsample');
      const kept = await vi.waitFor(() => {
        const el = container.ownerDocument.querySelector<HTMLElement>('.stage-card .kept');
        expect(el).toBeTruthy();
        return el!;
      });
      await fireEvent(kept, ptr('pointermove', 0, 0));
      expect((await findByTestId('tooltip-hover')).textContent).toContain('50% of all samples');
    });

    it('explains the Huffman tabs, bars, leaves, cost line, bits and segments', async () => {
      const { container, findByTestId, getByRole } = await renderLab('stage=huffman');
      await vi.waitFor(() => expect(container.querySelectorAll('[role="tab"]')).toHaveLength(4));
      await vi.waitFor(() => expect(container.querySelectorAll('circle.leaf')).toHaveLength(2));
      expect(container.querySelector('.huff title')).toBeNull();
      expect(container.querySelector('.huff [title]')).toBeNull();
      await fireEvent(container.querySelector('.huff .col')!, ptr('pointermove', 0, 0));
      const bar = await findByTestId('tooltip-hover');
      expect(bar.textContent).toContain('appears 30 times');
      expect(bar.textContent).toContain('its code is 00 (2 bits)');
      await fireEvent(container.querySelector('circle.leaf')!, ptr('pointermove', 0, 0));
      await vi.waitFor(() => expect((document.querySelector('[data-testid="tooltip-hover"]') as HTMLElement).textContent).toContain('EOB = 00'));
      await fireEvent(container.querySelector('.huff .cost')!, ptr('pointermove', 0, 0));
      await vi.waitFor(() => expect(document.querySelector('[data-testid="tooltip-hover"]')!.textContent).toContain('80 bits against 32.5'));
      await fireEvent(container.querySelector('.huff .bits span')!, ptr('pointermove', 0, 0));
      await vi.waitFor(() => expect(document.querySelector('[data-testid="tooltip-hover"]')!.textContent).toContain('Bits 100-102'));
      const tab = getByRole('tab', { name: 'DC · luma' });
      await fireEvent(tab, ptr('pointermove', 0, 0));
      await vi.waitFor(() => expect(document.querySelector('[data-testid="tooltip-hover"]')!.textContent).toContain('DC · luma'));
      await fireEvent.click(tab);
      expect(tab.getAttribute('aria-selected')).toBe('true'); // an acting target keeps its click
      expect(container.querySelector('[data-testid="tooltip-pinned"]')).toBeNull();
    });

    it('pins a file segment on click', async () => {
      const { container, findByTestId } = await renderLab('stage=huffman');
      const segs = await vi.waitFor(() => {
        const s = container.querySelectorAll<HTMLElement>('.file .seg');
        expect(s).toHaveLength(4);
        return s;
      });
      await fireEvent(segs[2], ptr('click', 5, 5, { detail: 1 }));
      expect((await findByTestId('tooltip-pinned')).textContent).toContain('the scan: 3,958 bytes');
    });
  });

  describe('the bezel, readout, rail and pictures', () => {
    /** A touch pointer event (jsdom has none): a MouseEvent that says it is a finger. */
    const touch = (type: string, x = 5, y = 5) => {
      const e = ptr(type, x, y);
      Object.defineProperty(e, 'pointerType', { value: 'touch' });
      return e;
    };
    const enter = (el: Element) => fireEvent(el, new MouseEvent('pointerenter', { clientX: 5, clientY: 5 }));
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

    it('explains the quality slider in context', async () => {
      const { getByLabelText, findByTestId, getByTestId } = await renderLab();
      const slider = await vi.waitFor(() => getByLabelText('Quality') as HTMLInputElement);
      slider.focus();
      const card = await findByTestId('tooltip-hover');
      expect(card.textContent).toContain('50');
      expect(card.textContent).toContain('100%');
      await fireEvent.input(slider, { target: { value: '20' } });
      await vi.waitFor(() => expect(getByTestId('tooltip-hover').textContent).toContain('250%'));
    });

    it('? on the focused Quality slider unfolds its card to the formula', async () => {
      const { getByLabelText, findByTestId } = await renderLab();
      const slider = await vi.waitFor(() => getByLabelText('Quality') as HTMLInputElement);
      slider.focus();
      await findByTestId('tooltip-hover');
      await fireEvent.keyDown(slider, { key: '?' });
      const pinned = await findByTestId('tooltip-pinned');
      const details = await findByTestId('tooltip-details');
      expect(pinned.textContent).toContain('Quality');
      expect(details.textContent).toContain('Quality 20');
      expect(details.querySelector('.katex, [class*="tex"], annotation')).not.toBeNull();
    });

    it('the stage rail keeps its click; a long-press explains it', async () => {
      const { getByRole, findByTestId } = await renderLab('stage=color');
      const button = getByRole('button', { name: /Zigzag/ });
      await fireEvent(button, touch('pointerdown'));
      await wait(600);
      expect((await findByTestId('tooltip-hover')).textContent).toContain('Step 6: Zigzag');
      await fireEvent(button, touch('pointerup'));
      await fireEvent.click(button); // the click that ends the long-press is swallowed
      expect(route.query).toBe('stage=color');
      // An ordinary tap still switches.
      await fireEvent(button, touch('pointerdown'));
      await fireEvent(button, touch('pointerup'));
      await fireEvent.click(button);
      expect(route.query).toBe('stage=zigzag');
    });

    it('a long-press on the stage image shows the pixel card and does not pick a block', async () => {
      const { findByRole, findByTestId } = await renderLab('stage=dct');
      const pick = await findByRole('button', { name: /Pick a block/ });
      const image = layoutOf('dct').image;
      const [x, y] = [image.x + 2, image.y + 2];
      ruleActionSpy.mockClear();
      await fireEvent(pick, touch('pointerdown', x, y));
      await wait(600);
      const card = await findByTestId('tooltip-hover');
      expect(card.textContent).toContain('Pixel (');
      expect(card.textContent).toContain('RGB 128, 128, 128');
      expect(card.textContent).toContain('follow this block');
      await fireEvent(pick, touch('pointerup', x, y));
      await fireEvent(pick, ptr('click', x, y, { detail: 1 }));
      expect(ruleActionSpy).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'select_block' }));
    });

    it('explains each readout figure and pins it on click', async () => {
      const { container, findByTestId } = await renderLab();
      const stats = await vi.waitFor(() => {
        const found = [...container.querySelectorAll<HTMLElement>('.stats .stat')];
        expect(found).toHaveLength(4);
        return found;
      });
      expect(stats.every((el) => el.tabIndex === 0)).toBe(true);
      await enter(stats[0]);
      expect((await findByTestId('tooltip-hover')).textContent).toContain('4.0 KB of 192.0 KB');
      await fireEvent(stats[3], ptr('click', 5, 5, { detail: 1 }));
      const pinned = await findByTestId('tooltip-pinned');
      expect(pinned.textContent).toContain('36.5 dB');
      expect(pinned.textContent).toContain('higher is closer');
    });

    it('explains each chroma and Huffman option, in its own words', async () => {
      const { getByLabelText, findByTestId, getByTestId } = await renderLab();
      const radio = await vi.waitFor(() => getByLabelText('4:4:4') as HTMLInputElement);
      radio.focus();
      expect((await findByTestId('tooltip-hover')).textContent).toContain('Keeps 100% of the colour detail');
      (getByLabelText('Standard') as HTMLInputElement).focus();
      await vi.waitFor(() => expect(getByTestId('tooltip-hover').textContent).toContain('example tables from the standard'));
    });

    it('explains the shell\'s speed slider', async () => {
      const { container, findByTestId } = await renderLab();
      const slider = await vi.waitFor(() => {
        const el = container.querySelector<HTMLInputElement>('.speed input');
        expect(el?.getAttribute('aria-describedby')).toContain('jpeg-tooltip-live');
        return el!;
      });
      slider.focus();
      expect((await findByTestId('tooltip-hover')).textContent).toContain('per second');
    });

    it('explains the transport buttons and the position readout, and leaves them no native tooltip', async () => {
      const { container, findByTestId, getByTestId } = await renderLab();
      const buttons = await vi.waitFor(() => {
        const found = [...container.querySelectorAll<HTMLButtonElement>('.transport button')];
        expect(found).toHaveLength(4);
        expect(found.every((b) => b.getAttribute('aria-describedby')?.includes('jpeg-tooltip-live'))).toBe(true);
        return found;
      });
      const [reset, back, play, forward] = buttons;
      await enter(play);
      expect((await findByTestId('tooltip-hover')).textContent).toContain('Play the scan'); // the fake engine's snapshot is not playing
      await enter(reset);
      await vi.waitFor(() => expect(getByTestId('tooltip-hover').textContent).toContain('Back to the start'));
      await enter(back);
      await vi.waitFor(() => expect(getByTestId('tooltip-hover').textContent).toContain('Step back'));
      await enter(forward);
      await vi.waitFor(() => expect(getByTestId('tooltip-hover').textContent).toContain('Step forward'));
      const readout = container.querySelector<HTMLElement>('.readout')!;
      expect(readout.tabIndex).toBe(0);
      readout.focus();
      await vi.waitFor(() => expect(getByTestId('tooltip-hover').textContent).toContain('steps scanned'));
      for (const el of [...buttons, readout]) expect(el.hasAttribute('title')).toBe(false);
    });

    it('keeps the transport buttons clicking', async () => {
      snapshotFixture.iteration = 10; // mid-scan: at the first step the shell disables Reset
      try {
        const { container } = await renderLab('stage=dct'); // the overview switches the transport off
        const [reset, , , forward] = await vi.waitFor(() => {
          const found = [...container.querySelectorAll<HTMLButtonElement>('.transport button')];
          expect(found).toHaveLength(4);
          return found;
        });
        dispatchSpy.mockClear();
        await fireEvent.click(reset);
        await fireEvent.click(forward);
        expect(kinds()).toEqual(expect.arrayContaining(['Reset', 'StepForward']));
      } finally {
        snapshotFixture.iteration = 0;
      }
    });

    it('renders no native tooltip anywhere, the shell included', async () => {
      const { container } = await renderLab();
      await vi.waitFor(() => expect(container.querySelector('.transport button')).toBeTruthy());
      // The lab itself (the app's theme toggle sits outside it).
      const lab = container.querySelector('article.lab')!;
      expect(lab.querySelectorAll('[title]')).toHaveLength(0);
      expect(lab.querySelectorAll('svg title')).toHaveLength(0);
    });

    it('explains Save, Upload and the Picture select', async () => {
      const { getByRole, getAllByRole, getByLabelText, findByTestId, getByTestId } = await renderLab();
      await enter(getByRole('button', { name: /Save \.jpg/ }));
      expect((await findByTestId('tooltip-hover')).textContent).toContain('jpeg-lab-q50-420.jpg');
      await enter(getAllByRole('button', { name: /Upload/ })[0]); // the bezel's; the gallery has a tile of the same name
      await vi.waitFor(() => expect(getByTestId('tooltip-hover').textContent).toContain('never leaves your browser'));
      await enter(getByLabelText('Picture'));
      await vi.waitFor(() => expect(getByTestId('tooltip-hover').textContent).toContain('Vivid colour'));
    });

    it('explains a gallery tile on the overview', async () => {
      const { getByRole, findByTestId } = await renderLab();
      await enter(getByRole('button', { name: 'Doge' }));
      const card = await findByTestId('tooltip-hover');
      expect(card.textContent).toContain('A meme that has been re-saved too often');
      expect(card.textContent).toContain('272 × 320');
    });

    it('explains the custom-tables chip, and Standard still goes back', async () => {
      const { getByLabelText, getByRole, container, findByTestId } = await renderLab('stage=quantize');
      const cell = await vi.waitFor(() => getByLabelText('Q(1, 0)') as HTMLInputElement);
      await fireEvent.change(cell, { target: { value: '99' } });
      await fireEvent.click(getByRole('button', { name: 'Apply to image' }));
      const label = container.querySelector<HTMLElement>('.chip-label')!;
      label.focus();
      expect((await findByTestId('tooltip-hover')).textContent).toContain('override quality');
      await fireEvent.click(within(container.querySelector('.custom-chip') as HTMLElement).getByRole('button', { name: 'Standard' }));
      expect(lastPush()[0].tables).toBeNull();
    });

    it('leaves no native tooltip on anything that has a card', async () => {
      const { container } = await renderLab();
      await vi.waitFor(() => expect(container.querySelector('.stats .stat')).toBeTruthy());
      expect(container.querySelectorAll('[aria-describedby~="jpeg-tooltip-live"][title]')).toHaveLength(0);
      expect(container.querySelectorAll('.bezel option[title], .bezel .stats [title], .gallery [title], nav[aria-label="JPEG pipeline"] [title]')).toHaveLength(0);
    });
  });

  describe('the rate–distortion curve', () => {
    /** Where quality `q` sits in the chart's own pixels once the whole sweep is in (the fake sizes: 1000 + 40 q bytes, 20 + q / 5 dB). */
    function pointAt(q: number) {
      const slot = layoutOf('quantize').slots.rd!;
      const W = slot.w - 8;
      const H = slot.h - 40;
      const maxBytes = Math.max(1000 + 40 * 100, jpegSummaryFixture.bytes);
      return { x: ((1000 + 40 * q) / maxBytes) * W, y: H - (Math.min(20 + q / 5, RD_PSNR_CAP) / RD_PSNR_CAP) * H, W, H, maxBytes };
    }
    async function chart() {
      const r = await renderLab('stage=quantize');
      await vi.waitFor(() => expect(r.container.querySelector('.rd figcaption')?.textContent).not.toContain('of 100'), { timeout: 3000 });
      return { ...r, svg: r.container.querySelector('.rd svg') as SVGElement };
    }

    it('explains the nearest curve point under the pointer', async () => {
      const { svg, findByTestId } = await chart();
      const p = pointAt(30);
      await fireEvent(svg, ptr('pointermove', p.x + 1, p.y - 1));
      expect((await findByTestId('tooltip-hover')).textContent).toContain('Quality 30');
    });

    it('explains the dot as where you are now', async () => {
      const { svg, findByTestId } = await chart();
      const hit = svg.querySelector('.dot-hit')!;
      await fireEvent(hit, ptr('pointermove', 0, 0));
      expect((await findByTestId('tooltip-hover')).textContent).toContain('You are here');
    });

    it('Enter on the dot pins the dot, not the curve behind it', async () => {
      const { svg, findByTestId } = await chart();
      const hit = svg.querySelector<SVGElement>('.dot-hit')!;
      hit.focus();
      await fireEvent.keyDown(hit, { key: 'Enter' });
      const pinned = await findByTestId('tooltip-pinned');
      expect(pinned.textContent).toContain('You are here');
      expect(pinned.textContent).not.toContain('Quality 50');
    });

    it('arrow keys on the dot leave the curve where it is', async () => {
      const { svg, findByTestId, getByTestId } = await chart();
      const hit = svg.querySelector<SVGElement>('.dot-hit')!;
      hit.focus();
      expect((await findByTestId('tooltip-hover')).textContent).toContain('You are here');
      const query = route.query;
      await fireEvent.keyDown(hit, { key: 'ArrowRight' });
      await fireEvent.keyDown(hit, { key: 'ArrowLeft' });
      await new Promise((r) => setTimeout(r, 30));
      // The arrows on the dot neither walk the pipeline nor move the curve.
      expect(route.query).toBe(query);
      expect(route.query).toBe('stage=quantize');
      // The curve has not roved: focusing it starts at the quality in hand, 50.
      (svg as unknown as HTMLElement).focus();
      await vi.waitFor(() => expect(getByTestId('tooltip-hover').textContent).toContain('Quality 50'));
    });

    it('lets the keyboard walk the curve from the current quality', async () => {
      const { svg, findByTestId } = await chart();
      expect(svg.getAttribute('role')).toBe('group');
      expect(svg.getAttribute('aria-roledescription')).toBe('chart');
      (svg as unknown as HTMLElement).focus();
      expect((await findByTestId('tooltip-hover')).textContent).toContain('Quality 50');
      await fireEvent.keyDown(svg, { key: 'ArrowRight' });
      await vi.waitFor(() => expect(document.querySelector('[data-testid="tooltip-hover"]')!.textContent).toContain('Quality 51'));
      expect(route.query).toBe('stage=quantize');
    });
  });

  describe('the overview and decode stages', () => {
    /** jsdom lays nothing out: give an element a box. */
    function boxed(el: Element, left: number, top: number, width: number, height: number) {
      el.getBoundingClientRect = () => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
    }
    const hoverText = () => document.querySelector('[data-testid="tooltip-hover"]')?.textContent ?? '';
    const decodeLanded = () => vi.waitFor(() => expect(jpegDecodeSpy).toHaveBeenCalled(), { timeout: 2000 });

    it('explains a pixel before and after JPEG from the canvas', async () => {
      const { container, findByTestId } = await renderLab();
      await vi.waitFor(() => expect(container.querySelector('.overview')).toBeTruthy());
      const canvas = container.querySelector('canvas')!;
      const panels = layoutOf('overview').panels;
      const [orig, dec] = ['original', 'decoded'].map((k) => panels.find((p) => p.kind === k)!.rect);
      await fireEvent(canvas, ptr('pointermove', orig.x + orig.w / 2, orig.y + orig.h / 2));
      const before = await findByTestId('tooltip-hover');
      expect(before.textContent).toContain('before JPEG');
      expect(before.textContent).toContain('RGB 128, 128, 128');
      await decodeLanded();
      await fireEvent(canvas, ptr('pointermove', dec.x + dec.w / 2, dec.y + dec.h / 2));
      await vi.waitFor(() => expect(hoverText()).toContain('after JPEG'));
      // The fake decode is black, so this pixel is 128 levels from the grey original.
      await vi.waitFor(() => expect(hoverText()).toContain('a difference of 128'));
    });

    it('explains a histogram bar from the pointer, and pins it on a click', async () => {
      const { container, findByTestId, getByRole } = await renderLab();
      const svgs = await vi.waitFor(() => {
        const all = container.querySelectorAll<SVGElement>('.overview .plot svg');
        expect(all).toHaveLength(3);
        return [...all];
      });
      boxed(svgs[0], 0, 0, 256, 50);
      boxed(svgs[1], 0, 0, 256, 50);
      await fireEvent(svgs[0], ptr('pointermove', 128.5, 10));
      const raw = await findByTestId('tooltip-hover');
      expect(raw.textContent).toContain('Raw bytes: value 128');
      expect(raw.textContent).toContain('100% of all');
      await fireEvent(svgs[1], ptr('pointermove', 0.5, 10));
      await vi.waitFor(() => expect(hoverText()).toContain('differ from their left neighbour by 0'));
      await fireEvent(svgs[1], ptr('click', 0.5, 10, { detail: 1 }));
      const pinned = await findByTestId('tooltip-pinned');
      expect(pinned.textContent).toContain('Neighbour difference: 0');
      await fireEvent.click(getByRole('button', { name: 'More' }));
      expect(pinned.ownerDocument.querySelector('[data-testid="tooltip-details"]')?.textContent).toContain('wrap');
    });

    it('lets the keyboard walk a histogram without changing the stage', async () => {
      const { container } = await renderLab();
      const svg = await vi.waitFor(() => {
        const el = container.querySelector<SVGElement>('.overview .plot svg');
        expect(el).toBeTruthy();
        return el!;
      });
      expect(svg.getAttribute('role')).toBe('group');
      (svg as unknown as HTMLElement).focus();
      await vi.waitFor(() => expect(hoverText()).toContain('Raw bytes: value 128')); // the tallest bar
      await fireEvent.keyDown(svg, { key: 'ArrowRight' });
      await vi.waitFor(() => expect(hoverText()).toContain('Raw bytes: value 129'));
      await fireEvent.keyDown(svg, { key: 'Home' });
      await vi.waitFor(() => expect(hoverText()).toContain('Raw bytes: value 0'));
      expect(route.query).toBe('');
    });

    it('explains the size bars and the bits-per-byte figures', async () => {
      const { container } = await renderLab();
      const sizes = await vi.waitFor(() => {
        const el = container.querySelector<HTMLElement>('.overview .sizes');
        expect(el).toBeTruthy();
        return el!;
      });
      sizes.focus();
      await vi.waitFor(() => expect(hoverText()).toContain('File size against the raw pixels'));
      const figure = container.querySelectorAll<HTMLElement>('.overview .entropy')[2];
      figure.focus();
      await vi.waitFor(() => expect(hoverText()).toContain('JPEG file: bits per byte'));
      expect(hoverText()).toMatch(/room/);
    });

    it('explains the error map pixel in levels before brightening', async () => {
      const { container } = await renderLab('stage=decode');
      await vi.waitFor(() => expect(container.querySelector('.tools')).toBeTruthy());
      await decodeLanded();
      const canvas = container.querySelector('canvas')!;
      const r = layoutOf('decode').panels.find((p) => p.kind === 'error')!.rect;
      await fireEvent(canvas, ptr('pointermove', r.x + r.w / 2, r.y + r.h / 2));
      await vi.waitFor(() => expect(hoverText()).toContain('128 levels'));
      expect(hoverText()).toContain('before the map brightens it');
      const w = layoutOf('decode').panels.find((p) => p.kind === 'wipe')!.rect;
      await fireEvent(canvas, ptr('pointermove', w.x + 2, w.y + w.h / 2));
      await vi.waitFor(() => expect(hoverText()).toContain('in the wipe'));
    });

    it('explains the sliders and the hint buttons, which keep their jobs', async () => {
      const { getByRole } = await renderLab('stage=decode');
      const wipe = await vi.waitFor(() => getByRole('slider', { name: 'Wipe' }));
      wipe.focus();
      await vi.waitFor(() => expect(hoverText()).toContain('50% decoded'));
      expect(wipe.hasAttribute('title')).toBe(false);
      getByRole('slider', { name: /^Error ×/ }).focus();
      await vi.waitFor(() => expect(hoverText()).toContain('full strength'));
      const blocking = getByRole('button', { name: 'Blocking' });
      expect(blocking.hasAttribute('title')).toBe(false);
      await fireEvent(blocking, ptr('pointermove', 0, 0));
      await vi.waitFor(() => expect(hoverText()).toContain('Block (3, 4)'));
      ruleActionSpy.mockClear();
      await fireEvent.click(blocking);
      expect(ruleActionSpy).toHaveBeenCalledWith({ kind: 'select_block', component: 0, bx: 3, by: 4 });
      expect(document.querySelector('[data-testid="tooltip-pinned"]')).toBeNull();
    });

    it('puts the Wipe, Error and Speed cards on their inputs alone, so a slider is one target', async () => {
      const { container, getByRole } = await renderLab('stage=decode');
      const wipe = await vi.waitFor(() => getByRole('slider', { name: 'Wipe' }));
      const gain = getByRole('slider', { name: /^Error ×/ });
      const speed = getByRole('slider', { name: 'Speed' });
      for (const input of [wipe, gain, speed]) {
        expect(input.getAttribute('aria-describedby')).toContain('jpeg-tooltip-live');
        expect(input.parentElement!.hasAttribute('aria-describedby')).toBe(false);
      }
      expect(container.querySelectorAll('label[aria-describedby]')).toHaveLength(0);
      // Enter on a slider is no request to pin anything.
      wipe.focus();
      await fireEvent.keyDown(wipe, { key: 'Enter' });
      expect(document.querySelector('[data-testid="tooltip-pinned"]')).toBeNull();
    });

    it('explains the two charts of the DCT stage and the Q-table steps', async () => {
      const dct = await renderLab('stage=dct');
      const charts = await vi.waitFor(() => {
        const all = dct.container.querySelectorAll<SVGElement>('.charts svg');
        expect(all).toHaveLength(2);
        return [...all];
      });
      (charts[0] as unknown as HTMLElement).focus();
      await vi.waitFor(() => expect(hoverText()).toMatch(/First \d+ patterns?/));
      (charts[1] as unknown as HTMLElement).focus();
      await vi.waitFor(() => expect(hoverText()).toContain('Repeated copy'));
      await fireEvent.keyDown(charts[1], { key: 'ArrowDown' });
      await vi.waitFor(() => expect(hoverText()).toContain('Mirrored copy'));
      dct.unmount();

      const quant = await renderLab('stage=quantize');
      const cell = await vi.waitFor(() => quant.getByLabelText('Q(1, 0)') as HTMLInputElement);
      await fireEvent(cell, ptr('pointermove', 0, 0));
      await vi.waitFor(() => expect(hoverText()).toContain('Table step (1, 0)'));
      cell.focus();
      await vi.waitFor(() => expect(hoverText()).toContain('Edit step (1, 0)'));
      // While the cell is being edited, the pointer cannot flip its card back to the table's.
      await fireEvent(cell, ptr('pointermove', 1, 1));
      await fireEvent(cell, ptr('pointermove', 2, 2));
      await new Promise((r) => setTimeout(r, 200));
      expect(hoverText()).toContain('Edit step (1, 0)');
      // Other cells, not being edited, keep the table card.
      const other = quant.getByLabelText('Q(2, 0)');
      await fireEvent(other, ptr('pointermove', 0, 0));
      await vi.waitFor(() => expect(hoverText()).toContain('Table step (2, 0)'));
      // Leaving the cell (blur) gives the pointer back its table card.
      cell.blur();
      await fireEvent(cell, ptr('pointermove', 3, 3));
      await vi.waitFor(() => expect(hoverText()).toContain('Table step (1, 0)'));
    });

    it('explains the generations of the re-save chart', async () => {
      const { container, getByRole } = await renderLab('stage=decode');
      await fireEvent.click(await vi.waitFor(() => getByRole('button', { name: /Re-save/ })));
      await vi.waitFor(() => expect(container.querySelector('.resave')?.textContent).toContain('gen 20'), { timeout: 3000 });
      const svg = container.querySelector<SVGElement>('.tools svg')!;
      expect(svg.getAttribute('role')).toBe('group');
      (svg as unknown as HTMLElement).focus();
      await vi.waitFor(() => expect(hoverText()).toContain('Generation 20'));
      await fireEvent.keyDown(svg, { key: 'ArrowLeft' });
      await vi.waitFor(() => expect(hoverText()).toContain('Generation 19'));
      expect(hoverText()).toContain('dB');
    });
  });
});

describe('the guided tour', () => {
  /** Spies this describe makes, restored one by one (a blanket restore would also reset the file's mocks). */
  let spies: { mockRestore: () => void }[] = [];
  beforeEach(() => {
    // jsdom has no canvas: the tour's pictures draw nothing, quietly.
    spies = [vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)];
    localStorage.removeItem(TOUR_SEEN_KEY);
    dispatchSpy.mockClear();
    updateRuleConfigWithImageSpy.mockClear();
    updateVizConfigSpy.mockClear();
  });
  afterEach(() => {
    for (const spy of spies) spy.mockRestore();
    // A test that closed the tour with storage refusing it leaves the in-memory "seen" behind.
    resetTourSeen();
    localStorage.setItem(TOUR_SEEN_KEY, '1');
  });

  const TITLE = 'How a picture becomes a JPEG';
  const dialogOf = (r: { queryByRole: (role: string, o: { name: string }) => HTMLElement | null }) => r.queryByRole('dialog', { name: TITLE });
  const key = (el: Element, k: string) => fireEvent.keyDown(el, { key: k });

  it('opens by itself on the first visit and not again', async () => {
    const first = await renderLab();
    const dialog = await vi.waitFor(() => first.getByRole('dialog', { name: TITLE }));
    await key(dialog, 'Escape');
    await vi.waitFor(() => expect(dialogOf(first)).toBeNull());
    expect(localStorage.getItem(TOUR_SEEN_KEY)).toBe('1');
    first.unmount();
    const again = await renderLab();
    expect(dialogOf(again)).toBeNull();
  });

  it('reopens from the How JPEG works button and returns focus to it', async () => {
    localStorage.setItem(TOUR_SEEN_KEY, '1');
    const r = await renderLab();
    expect(dialogOf(r)).toBeNull();
    const button = r.getByRole('button', { name: 'How JPEG works' });
    await fireEvent.click(button);
    const dialog = await vi.waitFor(() => r.getByRole('dialog', { name: TITLE }));
    await key(dialog, 'Escape');
    await vi.waitFor(() => expect(dialogOf(r)).toBeNull());
    await vi.waitFor(() => expect(document.activeElement).toBe(button));
  });

  it('Show me in the lab carries the picture and quality', async () => {
    const r = await renderLab();
    const dialog = await vi.waitFor(() => r.getByRole('dialog', { name: TITLE }));
    await fireEvent.click(within(dialog).getByRole('button', { name: /^Step 5:/ }));
    await fireEvent.input(within(dialog).getByLabelText('Quality'), { target: { value: '20' } });
    const show = within(dialog).getByRole('button', { name: 'Show me in the lab' }) as HTMLButtonElement;
    await vi.waitFor(() => expect(show.disabled).toBe(false)); // the lab's picture is in
    await fireEvent.click(show);
    await vi.waitFor(() => expect(dialogOf(r)).toBeNull());
    await vi.waitFor(() => expect(lastPush()[0].quality).toBe(20));
    const q = new URLSearchParams(route.query);
    expect(q.get('stage')).toBe('quantize');
    expect(q.get('q')).toBe('20');
    expect(q.get('img')).toBeNull(); // still the spring
    expect(lastPush()[0].image_id).toBe('spring');
    expect(localStorage.getItem(TOUR_SEEN_KEY)).toBe('1');
    await vi.waitFor(() => expect(document.activeElement).toBe(r.getByRole('button', { name: 'How JPEG works' })));
  });

  it('Show me in the lab loads a picture chosen inside the tour', async () => {
    const r = await renderLab();
    const dialog = await vi.waitFor(() => r.getByRole('dialog', { name: TITLE }));
    const pick = within(dialog).getByLabelText('Tour picture') as HTMLSelectElement;
    await fireEvent.change(pick, { target: { value: 'gradient' } });
    const show = within(dialog).getByRole('button', { name: 'Show me in the lab' }) as HTMLButtonElement;
    await vi.waitFor(() => expect(pick.value).toBe('gradient'));
    await fireEvent.click(show);
    await vi.waitFor(() => expect(lastPush()[0].image_id).toBe('gradient'));
    expect(new URLSearchParams(route.query).get('img')).toBe('gradient');
    expect(kinds()).not.toContain('Play'); // a hand-off waits at its block, like any new picture
  });

  it('picking the lab\'s own picture again in the tour keeps the lab\'s block', async () => {
    const r = await renderLab('stage=blocks&b=12,7');
    const dialog = await vi.waitFor(() => r.getByRole('dialog', { name: TITLE }));
    const show = within(dialog).getByRole('button', { name: 'Show me in the lab' }) as HTMLButtonElement;
    await vi.waitFor(() => expect(show.disabled).toBe(false)); // the lab's picture is in
    const pick = within(dialog).getByLabelText('Tour picture') as HTMLSelectElement;
    await fireEvent.change(pick, { target: { value: 'gradient' } });
    await vi.waitFor(() => expect(show.disabled).toBe(false));
    await fireEvent.change(pick, { target: { value: 'spring' } });
    expect(show.disabled).toBe(false);
    const springLoads = () => vi.mocked(loadPicture).mock.calls.filter(([id]) => id === 'spring').length;
    const loadsBefore = springLoads();
    ruleActionSpy.mockClear();
    await fireEvent.click(show);
    await vi.waitFor(() => expect(dialogOf(r)).toBeNull());
    await vi.waitFor(() => expect(route.query).toContain('stage=color'));
    // Not fetched again, and still on the block the link chose.
    expect(springLoads()).toBe(loadsBefore);
    expect(route.query).toContain('b=12,7');
    expect(lastPush()[0].image_id).toBe('spring');
    await vi.waitFor(() =>
      expect(ruleActionSpy).toHaveBeenCalledWith({ kind: 'select_block', component: 0, bx: 12, by: 7 }),
    );
  });

  it('Escape leaves the lab as it was', async () => {
    const r = await renderLab();
    const before = route.query;
    const pushesBefore = pushes().length;
    const dialog = await vi.waitFor(() => r.getByRole('dialog', { name: TITLE }));
    await fireEvent.click(within(dialog).getByRole('button', { name: /^Step 5:/ }));
    await fireEvent.input(within(dialog).getByLabelText('Quality'), { target: { value: '20' } });
    await key(dialog, 'Escape');
    await vi.waitFor(() => expect(dialogOf(r)).toBeNull());
    expect(lastPush()[0].quality).toBe(50);
    expect(lastPush()[0].image_id).toBe('spring');
    expect(pushes().length).toBe(pushesBefore);
    expect(route.query).toBe(before);
    expect((r.getByLabelText('Quality') as HTMLInputElement).value).toBe('50');
  });

  it('keys in the tour stay in the tour', async () => {
    const r = await renderLab();
    const dialog = await vi.waitFor(() => r.getByRole('dialog', { name: TITLE }));
    const before = route.query;
    await key(dialog, 'ArrowRight');
    await key(dialog, 'ArrowRight');
    expect(route.query).toBe(before);
    expect(route.query).not.toContain('stage=');
    // Even an arrow aimed at the page behind the dialog is left alone while the tour is open.
    await key(document.body, 'ArrowRight');
    expect(route.query).toBe(before);
    // ... and the lab hears the arrows again once it is closed.
    await key(dialog, 'Escape');
    await vi.waitFor(() => expect(dialogOf(r)).toBeNull());
    await key(document.body, 'ArrowRight');
    expect(route.query).toContain('stage=');
  });

  it('still opens when storage throws', async () => {
    const blocked = () => {
      throw new Error('blocked');
    };
    // jsdom's storage is either the real Storage or the setup polyfill's plain object; spy on whichever answers.
    const store = window.localStorage;
    const target = store instanceof Storage ? Storage.prototype : store;
    const getItem = vi.spyOn(target, 'getItem').mockImplementation(blocked);
    const setItem = vi.spyOn(target, 'setItem').mockImplementation(blocked);
    spies.push(getItem, setItem);
    const r = await renderLab();
    const dialog = await vi.waitFor(() => r.getByRole('dialog', { name: TITLE }));
    await key(dialog, 'Escape');
    await vi.waitFor(() => expect(dialogOf(r)).toBeNull());
    // The blocked storage really was asked (and the tour carried on regardless).
    expect(getItem).toHaveBeenCalled();
    expect(setItem).toHaveBeenCalled();
    // Another lab and back, in the same page view: the tour stays closed.
    navigate('fourier', '');
    await vi.waitFor(() => expect(r.queryByRole('button', { name: 'How JPEG works' })).toBeNull());
    navigate('jpeg', '');
    await vi.waitFor(() => r.getByRole('button', { name: 'How JPEG works' }));
    await tick();
    expect(dialogOf(r)).toBeNull();
  });

  it('stays closed after another lab and back when storage is full', async () => {
    // Full storage reads fine but refuses to write.
    const store = window.localStorage;
    const target = store instanceof Storage ? Storage.prototype : store;
    const setItem = vi.spyOn(target, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    spies.push(setItem);
    const r = await renderLab();
    const dialog = await vi.waitFor(() => r.getByRole('dialog', { name: TITLE }));
    await key(dialog, 'Escape');
    await vi.waitFor(() => expect(dialogOf(r)).toBeNull());
    expect(setItem).toHaveBeenCalled();
    expect(localStorage.getItem(TOUR_SEEN_KEY)).toBeNull();
    navigate('fourier', '');
    await vi.waitFor(() => expect(r.queryByRole('button', { name: 'How JPEG works' })).toBeNull());
    navigate('jpeg', '');
    await vi.waitFor(() => r.getByRole('button', { name: 'How JPEG works' }));
    await tick();
    expect(dialogOf(r)).toBeNull();
  });

  it('draws over the page from the end of the body, and leaves the cards working when it closes', async () => {
    const r = await renderLab();
    const dialog = await vi.waitFor(() => r.getByRole('dialog', { name: TITLE }));
    const backdrop = dialog.closest('.tour-backdrop')!;
    expect(backdrop.parentElement).toBe(document.body);
    expect(r.container.querySelector('.story .tour-backdrop')).toBeNull();
    await key(dialog, 'Escape');
    await vi.waitFor(() => expect(dialogOf(r)).toBeNull());
    expect(document.querySelector('.tour-backdrop')).toBeNull();
    // Focus is back on "How JPEG works", and its card still shows, from the body too.
    const button = r.getByRole('button', { name: 'How JPEG works' });
    await vi.waitFor(() => expect(document.activeElement).toBe(button));
    const card = await vi.waitFor(() => {
      const el = document.querySelector('[data-testid="tooltip-hover"]');
      expect(el).toBeTruthy();
      return el!;
    });
    expect(card.parentElement).toBe(document.body);
    expect(card.textContent).toContain('How JPEG works');
  });

  it('closes the How JPEG works card when the tour opens', async () => {
    localStorage.setItem(TOUR_SEEN_KEY, '1');
    const r = await renderLab();
    const button = r.getByRole('button', { name: 'How JPEG works' });
    button.focus();
    await vi.waitFor(() => expect(document.querySelector('[data-testid="tooltip-hover"]')).toBeTruthy());
    await fireEvent.click(button);
    await vi.waitFor(() => r.getByRole('dialog', { name: TITLE }));
    await tick();
    expect(document.querySelector('[data-testid="tooltip-hover"]')).toBeNull();
  });

  it('keeps a hand-off made before the lab is ready', async () => {
    const { loadVizCore } = await import('../../wasm/loader');
    const { makeVizMock } = await import('../../test/fakeViz');
    let release!: () => void;
    const ready = new Promise<void>((resolve) => (release = resolve));
    vi.mocked(loadVizCore).mockImplementation(() => ready.then(() => makeVizMock()));
    try {
      navigate('jpeg', '');
      const r = render(App);
      // On a first visit the tour opens before the engine; the reader picks a picture and hands it over.
      const dialog = await vi.waitFor(() => r.getByRole('dialog', { name: TITLE }));
      const pick = within(dialog).getByLabelText('Tour picture') as HTMLSelectElement;
      await fireEvent.change(pick, { target: { value: 'gradient' } });
      const show = within(dialog).getByRole('button', { name: 'Show me in the lab' }) as HTMLButtonElement;
      await vi.waitFor(() => expect(show.disabled).toBe(false));
      await fireEvent.click(show);
      await vi.waitFor(() => expect(dialogOf(r)).toBeNull());
      expect(pushes()).toHaveLength(0);
      release();
      await vi.waitFor(() => expect(pushes().length).toBeGreaterThan(0));
      await new Promise((done) => setTimeout(done, 30));
      // The link's own picture (the spring) does not replace the one handed over.
      expect(pushes().map((p) => p[0].image_id)).toEqual(['gradient']);
      const q = new URLSearchParams(route.query);
      expect(q.get('img')).toBe('gradient');
      expect(q.get('stage')).toBe('color');
    } finally {
      vi.mocked(loadVizCore).mockImplementation(() => Promise.resolve(makeVizMock()));
    }
  });

  it("Show me in the lab keeps the lab's own upload, and its block, as they are", async () => {
    localStorage.setItem(TOUR_SEEN_KEY, '1');
    const r = await renderLab('stage=blocks');
    vi.mocked(decodeUpload).mockImplementationOnce(async () => ({ w: 64, h: 48, rgba: new Uint8Array(64 * 48 * 4).fill(90) }));
    const input = r.container.querySelector('input[type="file"]') as HTMLInputElement;
    await fireEvent.change(input, { target: { files: [new File(['x'], 'x.png', { type: 'image/png' })] } });
    await vi.waitFor(() => expect(lastPush()[0].image_id).toBe('upload'));
    // Pick a block, so a reload (which forgets it) would show.
    await fireEvent.keyDown(await vi.waitFor(() => r.getByRole('button', { name: /Pick a block/ })), { key: 'ArrowLeft' });
    const block = new URLSearchParams(route.query).get('b');
    expect(block).toBeTruthy();
    const decodes = vi.mocked(decodeUpload).mock.calls.length;
    await fireEvent.click(r.getByRole('button', { name: 'How JPEG works' }));
    const dialog = await vi.waitFor(() => r.getByRole('dialog', { name: TITLE }));
    const show = within(dialog).getByRole('button', { name: 'Show me in the lab' }) as HTMLButtonElement;
    await fireEvent.click(show);
    await vi.waitFor(() => expect(dialogOf(r)).toBeNull());
    await vi.waitFor(() => expect(new URLSearchParams(route.query).get('stage')).toBe('color'));
    expect(lastPush()[0].image_id).toBe('upload');
    expect(new URLSearchParams(route.query).get('b')).toBe(block);
    expect(vi.mocked(decodeUpload).mock.calls.length).toBe(decodes);
  });
});
