import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { TooltipController } from '../tooltip.svelte';
import type { RgbaImage } from '../../../jpeg/images';
import { loadPicture } from '../../../jpeg/images';

vi.mock('../../../wasm/loader', () => ({
  loadVizCore: vi.fn(() =>
    Promise.resolve({
      jpeg_encode_decode: (rgba: Uint8Array) => rgba,
      jpeg_encode_stats: () => ({ bytes: 4096, psnr: 32 }),
    }),
  ),
}));

// The real catalog, but every picture loads as a small solid image (no network, no canvas).
vi.mock('../../../jpeg/images', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../jpeg/images')>();
  return {
    ...real,
    loadPicture: vi.fn(async (_id: string) => ({ w: 16, h: 16, rgba: new Uint8Array(16 * 16 * 4).fill(90) })),
    decodeUpload: vi.fn(real.decodeUpload),
  };
});

// jsdom has no canvas: say so quietly, as a browser without 2D drawing would.
vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

import JpegTour from '../JpegTour.svelte';

const picture = (): RgbaImage => ({ w: 16, h: 16, rgba: new Uint8Array(16 * 16 * 4).fill(120) });

function mountTour(over: Record<string, unknown> = {}) {
  const onclose = vi.fn();
  const result = render(JpegTour, {
    imageId: 'spring',
    image: picture(),
    quality: 50,
    subsampling: '420',
    huffman: 'optimized',
    ctl: new TooltipController(),
    onclose,
    ...over,
  });
  return { onclose, ...result };
}

const dialog = () => screen.getByRole('dialog');
const next = () => screen.getByRole('button', { name: /^(Next|Start exploring)$/ });
const stripButtons = () => Array.from(document.querySelectorAll<HTMLButtonElement>('.tour-strip button'));
const current = () => document.querySelector('.tour-strip [aria-current="step"]')!.getAttribute('aria-label');
const stepLabel = () => document.querySelector('.tour-label')!.textContent;

/** A touch or mouse pointer event with the fields jsdom's missing PointerEvent would drop. */
function pointer(el: Element, type: 'pointerdown' | 'pointerup', pointerType: string, clientX: number, clientY = 0) {
  const ev = new MouseEvent(type, { bubbles: true, clientX, clientY });
  Object.defineProperty(ev, 'pointerType', { value: pointerType });
  el.dispatchEvent(ev);
}

beforeEach(() => {
  vi.mocked(loadPicture).mockClear();
});

describe('JpegTour.svelte', () => {
  it('opens on step 1 with the strip and focus on Next', async () => {
    mountTour();
    expect(dialog().getAttribute('aria-modal')).toBe('true');
    expect(screen.getByRole('heading', { name: 'How a picture becomes a JPEG' })).toBeTruthy();
    expect(stripButtons()).toHaveLength(9);
    expect(current()).toBe('Step 1: Split brightness from colour');
    expect(document.querySelector('.tour-strip .jpg')!.textContent).toBe('file');
    expect(document.querySelectorAll('.tour-strip .lossy')).toHaveLength(2);
    expect(document.activeElement).toBe(next());
    expect(stepLabel()).toBe('Step 1 of 9');
  });

  it('moves with Next, Back, the strip and the arrow keys', async () => {
    mountTour();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    await fireEvent.click(next());
    expect(stepLabel()).toBe('Step 2 of 9 · loses detail');
    await fireEvent.keyDown(dialog(), { key: 'ArrowRight' });
    expect(stepLabel()).toBe('Step 3 of 9');
    await fireEvent.keyDown(dialog(), { key: 'ArrowLeft' });
    expect(stepLabel()).toBe('Step 2 of 9 · loses detail');
    await fireEvent.click(stripButtons()[4]);
    expect(stepLabel()).toBe('Step 5 of 9 · loses detail');
    expect(current()).toBe('Step 5: Round off fine detail');
    await fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(stepLabel()).toBe('Step 4 of 9');
  });

  it('does not move when the arrow is on the slider', async () => {
    mountTour();
    await fireEvent.click(stripButtons()[4]);
    const range = screen.getByRole('slider', { name: 'Quality' });
    await fireEvent.keyDown(range, { key: 'ArrowRight' });
    expect(stepLabel()).toContain('Step 5 of 9');
    await fireEvent.keyDown(dialog().querySelector('select')!, { key: 'ArrowLeft' });
    expect(stepLabel()).toContain('Step 5 of 9');
  });

  it('stops keys reaching the window', async () => {
    mountTour();
    const seen = vi.fn();
    window.addEventListener('keydown', seen);
    try {
      await fireEvent.keyDown(next(), { key: 'ArrowRight' });
      await fireEvent.keyDown(next(), { key: 'x' });
      expect(seen).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', seen);
    }
  });

  it('shows the slider only on step 5 and hands its quality over', async () => {
    const { onclose } = mountTour();
    expect(screen.queryByRole('slider', { name: 'Quality' })).toBeNull();
    await fireEvent.click(stripButtons()[4]);
    const range = screen.getByRole('slider', { name: 'Quality' }) as HTMLInputElement;
    expect(range.value).toBe('50');
    await fireEvent.input(range, { target: { value: '20' } });
    expect(document.querySelector('.tour-quality-value')!.textContent).toBe('20');
    await fireEvent.click(screen.getByRole('button', { name: 'Show me in the lab' }));
    expect(onclose).toHaveBeenCalledWith(expect.objectContaining({ stage: 'quantize', quality: 20, imageId: 'spring', image: expect.anything() }));
    await fireEvent.click(stripButtons()[5]);
    expect(screen.queryByRole('slider', { name: 'Quality' })).toBeNull();
  });

  it('reads Start exploring on the last step and lands on the overview', async () => {
    const { onclose } = mountTour();
    await fireEvent.click(stripButtons()[8]);
    expect(next().textContent).toBe('Start exploring');
    await fireEvent.click(next());
    expect(onclose).toHaveBeenCalledWith(expect.objectContaining({ stage: 'overview', quality: 50, imageId: 'spring' }));
  });

  it('keeps the hand-offs disabled until the picture is in, but Next still works', async () => {
    mountTour({ image: null });
    expect((screen.getByRole('button', { name: 'Show me in the lab' }) as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.click(next());
    expect(stepLabel()).toContain('Step 2 of 9');
    await fireEvent.click(stripButtons()[8]);
    expect((next() as HTMLButtonElement).disabled).toBe(true);
  });

  it('hands nothing over on Skip, Escape or the close button', async () => {
    for (const act of [
      () => fireEvent.click(screen.getByRole('button', { name: 'Skip the tour' })),
      () => fireEvent.keyDown(dialog(), { key: 'Escape' }),
      () => fireEvent.click(screen.getByRole('button', { name: 'Close the tour' })),
    ]) {
      const { onclose, unmount } = mountTour();
      await act();
      expect(onclose).toHaveBeenCalledTimes(1);
      expect(onclose).toHaveBeenCalledWith(null);
      unmount();
    }
  });

  it('wraps Tab inside the dialog', async () => {
    mountTour();
    const focusable = Array.from(dialog().querySelectorAll<HTMLElement>('button:not([disabled]), select, input:not([type="file"])'));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    last.focus();
    await fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    first.focus();
    await fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('changes the picture and hands the new one over', async () => {
    const { onclose } = mountTour();
    const select = screen.getByRole('combobox', { name: 'Tour picture' }) as HTMLSelectElement;
    expect(select.querySelectorAll('optgroup').length).toBeGreaterThan(1);
    await fireEvent.change(select, { target: { value: 'doge' } });
    expect(loadPicture).toHaveBeenCalledWith('doge');
    await waitFor(() => expect(select.value).toBe('doge'));
    await fireEvent.click(screen.getByRole('button', { name: 'Show me in the lab' }));
    expect(onclose).toHaveBeenCalledWith(expect.objectContaining({ imageId: 'doge', stage: 'color' }));
  });

  it('keeps the old picture and says why when a picture will not load', async () => {
    vi.mocked(loadPicture).mockRejectedValueOnce(new Error('Could not load the picture "Doge".'));
    const { onclose } = mountTour();
    const select = screen.getByRole('combobox', { name: 'Tour picture' }) as HTMLSelectElement;
    await fireEvent.change(select, { target: { value: 'doge' } });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Could not load the picture'));
    expect(select.value).toBe('spring');
    await fireEvent.click(screen.getByRole('button', { name: 'Show me in the lab' }));
    expect(onclose).toHaveBeenCalledWith(expect.objectContaining({ imageId: 'spring' }));
  });

  it('offers the uploaded picture as its own option', () => {
    mountTour({ imageId: 'upload' });
    const select = screen.getByRole('combobox', { name: 'Tour picture' }) as HTMLSelectElement;
    expect(select.value).toBe('upload');
    expect(Array.from(select.options).some((o) => o.textContent === 'Your picture')).toBe(true);
    expect(screen.getByRole('button', { name: 'Use your own picture' })).toBeTruthy();
  });

  it('swipes on touch, not with a mouse', async () => {
    mountTour();
    const panel = document.querySelector('.tour-panel')!;
    pointer(panel, 'pointerdown', 'mouse', 200);
    pointer(panel, 'pointerup', 'mouse', 140);
    await tick();
    expect(stepLabel()).toBe('Step 1 of 9');
    pointer(panel, 'pointerdown', 'touch', 200);
    pointer(panel, 'pointerup', 'touch', 140);
    await tick();
    expect(stepLabel()).toBe('Step 2 of 9 · loses detail');
    // A short or mostly vertical swipe does nothing; a right swipe goes back.
    pointer(panel, 'pointerdown', 'touch', 200, 0);
    pointer(panel, 'pointerup', 'touch', 170, 0);
    pointer(panel, 'pointerdown', 'touch', 200, 0);
    pointer(panel, 'pointerup', 'touch', 150, 90);
    await tick();
    expect(stepLabel()).toBe('Step 2 of 9 · loses detail');
    pointer(panel, 'pointerdown', 'touch', 100);
    pointer(panel, 'pointerup', 'touch', 170);
    await tick();
    expect(stepLabel()).toBe('Step 1 of 9');
  });

  it('asks the kit once and keeps one picture area while the steps change', async () => {
    const { loadVizCore } = await import('../../../wasm/loader');
    vi.mocked(loadVizCore).mockClear();
    mountTour();
    const figure = document.querySelector('figure.tour-visual');
    await fireEvent.click(next());
    await fireEvent.click(next());
    expect(document.querySelector('figure.tour-visual')).toBe(figure);
    expect(loadVizCore).toHaveBeenCalledTimes(1);
  });
});
