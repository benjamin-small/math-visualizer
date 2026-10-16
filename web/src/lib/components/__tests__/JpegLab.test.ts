import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import {
  installRafPolyfill,
  dispatchSpy,
  ruleActionSpy,
  updateRuleConfigWithImageSpy,
  updateVizConfigSpy,
  snapshotFixture,
} from '../../test/fakeViz';
import { navigate, route } from '../../router.svelte';
import { loadVizCore } from '../../wasm/loader';

installRafPolyfill();

vi.mock('../../wasm/loader', async () => {
  const { makeVizMock } = await import('../../test/fakeViz');
  return { loadVizCore: vi.fn(() => Promise.resolve(makeVizMock())) };
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

type Push = [{ image_id: string; quality: number; subsampling: string; huffman: string; max_iterations: number }, number, number, Uint8Array];
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

  it('encodes the default gradient as a typed array and plays the scan', async () => {
    await renderLab();
    const [cfg, w, h, rgba] = lastPush();
    expect(cfg).toEqual({ image_id: 'gradient', quality: 50, subsampling: '420', huffman: 'optimized', max_iterations: 256 });
    expect([w, h, rgba.length]).toEqual([256, 256, 256 * 256 * 4]);
    expect(kinds()).toContain('Play');
    expect(dispatchSpy).toHaveBeenCalledWith({ kind: 'SetSpeed', value: 64 });
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
    await renderLab('img=text&q=999&s=422&h=std&stage=huffman');
    expect(lastPush()[0]).toEqual({ image_id: 'text', quality: 100, subsampling: '422', huffman: 'standard', max_iterations: 512 });
    expect(route.query).toBe('img=text&q=100&s=422&h=std');
  });

  it('moves between ready stages with the rail and the arrow keys', async () => {
    const { getByRole, container } = await renderLab();
    expect(getByRole('button', { name: /Color/ }).getAttribute('aria-current')).toBe('step');
    expect((getByRole('button', { name: /Huffman/ }) as HTMLButtonElement).disabled).toBe(true);
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
    const { getByLabelText } = await renderLab();
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
    await fireEvent.click(getByLabelText('Text'));
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

  it('leaves arrow keys with a modifier to the browser', async () => {
    await renderLab('stage=dct');
    await fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true });
    await fireEvent.keyDown(window, { key: 'ArrowLeft', metaKey: true });
    expect(route.query).toBe('stage=dct');
  });

  it('keeps the current image and says why when a built-in cannot be made', async () => {
    const { getByLabelText, findByRole } = await renderLab();
    const before = pushes().length;
    vi.mocked(loadVizCore).mockImplementationOnce(() => Promise.reject(new Error('wasm down')));
    try {
      await fireEvent.click(getByLabelText('Bars'));
      expect((await findByRole('alert')).textContent).toContain('wasm down');
      expect(pushes().length).toBe(before);
    } finally {
      vi.mocked(loadVizCore).mockClear();
    }
  });
});
