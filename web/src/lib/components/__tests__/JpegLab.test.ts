import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, within } from '@testing-library/svelte';
import {
  installRafPolyfill,
  dispatchSpy,
  ruleActionSpy,
  updateRuleConfigWithImageSpy,
  updateVizConfigSpy,
  snapshotFixture,
  jpegSummaryFixture,
} from '../../test/fakeViz';
import { navigate, route } from '../../router.svelte';
import { loadPicture } from '../../jpeg/images';

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
    dispatchSpy.mockClear();
    ruleActionSpy.mockClear();
    updateRuleConfigWithImageSpy.mockClear();
    updateVizConfigSpy.mockClear();
  });

  it('encodes a picture as a typed array and plays the scan', async () => {
    await renderLab('img=gradient');
    const [cfg, w, h, rgba] = lastPush();
    expect(cfg).toEqual({ image_id: 'gradient', quality: 50, subsampling: '420', huffman: 'optimized', max_iterations: 256, tables: null });
    expect([w, h, rgba.length]).toEqual([256, 256, 256 * 256 * 4]);
    expect(kinds()).toContain('Play');
    expect(dispatchSpy).toHaveBeenCalledWith({ kind: 'SetSpeed', value: 64 });
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
    // The shared link now names what is on screen, and the block that belonged to the lost picture is not carried over.
    expect(route.query).toBe('img=gradient');
    // On the overview the alert sits at the top, clear of the credit and the axes.
    expect(container.querySelector('.error')?.classList.contains('top')).toBe(true);
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

  it('restores the scan share and keeps playing after a settings change', async () => {
    Object.assign(snapshotFixture, { iteration: 128, max_iterations: 256, playing: true });
    try {
      const { getByLabelText, container } = await renderLab();
      await vi.waitFor(() => expect(container.querySelector('.readout')?.textContent).toContain('128'));
      dispatchSpy.mockClear();
      await fireEvent.click(getByLabelText('4:4:4'));
      expect(lastPush()[0].max_iterations).toBe(1024);
      expect(dispatchSpy).toHaveBeenCalledWith({ kind: 'JumpTo', iteration: 512 });
      expect(kinds()).toContain('Play');
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
    const { getByRole } = await renderLab();
    const pick = getByRole('button', { name: /Pick a block/ });
    ruleActionSpy.mockClear();
    await fireEvent.keyDown(pick, { key: 'ArrowRight' });
    // The summary's luma block is (21, 17); one block right.
    expect(ruleActionSpy).toHaveBeenLastCalledWith({ kind: 'select_block', component: 0, bx: 22, by: 17 });
    expect(route.query).toContain('b=22,17');
    expect(route.query).not.toContain('stage=');
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
      expect(ringing.disabled).toBe(true);
      expect(ringing.title).toContain('no hard edges');
      // The reason is on screen too, not only in a tooltip (touch has none).
      expect(document.querySelector('.hints')?.textContent).toContain('No hard edges here, so nothing rings.');
      expect((getByRole('button', { name: 'Blocking' }) as HTMLButtonElement).disabled).toBe(false);
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
