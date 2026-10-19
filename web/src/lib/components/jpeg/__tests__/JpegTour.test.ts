import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { TooltipController, boxOf } from '../tooltip.svelte';
import type { RgbaImage } from '../../../jpeg/images';
import { decodeUpload, loadPicture } from '../../../jpeg/images';

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
import { TOUR_STEPS } from '../../../jpeg/tour';

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

/** A promise settled from outside, for loads that must stay pending. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const handoffButton = () => screen.getByRole('button', { name: 'Show me in the lab' }) as HTMLButtonElement;

beforeEach(() => {
  vi.mocked(loadPicture).mockClear();
  vi.mocked(decodeUpload).mockClear();
});

describe('JpegTour.svelte', () => {
  it('opens on step 1 with the strip and focus on Next', async () => {
    mountTour();
    expect(dialog().getAttribute('aria-modal')).toBe('true');
    expect(screen.getByRole('heading', { name: 'How a picture becomes a JPEG' })).toBeTruthy();
    expect(stripButtons()).toHaveLength(9);
    expect(current()).toBe('Step 1: Split brightness from colour');
    expect(stripButtons().map((b) => b.querySelector('.txt')!.textContent)).toEqual([
      'Split',
      'Shrink colour',
      'Tiles',
      'Waves',
      'Round off',
      'Line up',
      'Count zeros',
      'Short codes',
      'Open',
    ]);
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
    expect(current()).toBe('Step 5: Round off fine detail, loses detail');
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
    const load = deferred<RgbaImage>();
    vi.mocked(loadPicture).mockReturnValueOnce(load.promise);
    await fireEvent.change(select, { target: { value: 'doge' } });
    expect(loadPicture).toHaveBeenCalledWith('doge');
    // Until it lands the hand-offs would carry the old picture, so they wait.
    expect(handoffButton().disabled).toBe(true);
    load.resolve(picture());
    await waitFor(() => expect(handoffButton().disabled).toBe(false));
    await fireEvent.click(handoffButton());
    expect(onclose).toHaveBeenCalledWith(expect.objectContaining({ imageId: 'doge', stage: 'color' }));
  });

  it('ignores a slow pick that was abandoned for the picture in use', async () => {
    const { onclose } = mountTour();
    const select = screen.getByRole('combobox', { name: 'Tour picture' }) as HTMLSelectElement;
    const late = deferred<RgbaImage>();
    vi.mocked(loadPicture).mockReturnValueOnce(late.promise);
    await fireEvent.change(select, { target: { value: 'doge' } });
    expect(handoffButton().disabled).toBe(true);
    expect(select.getAttribute('aria-busy')).toBe('true');
    // The reader changes their mind and goes back to the picture in use.
    await fireEvent.change(select, { target: { value: 'spring' } });
    expect(handoffButton().disabled).toBe(false);
    expect(select.getAttribute('aria-busy')).toBe('false');
    late.resolve(picture());
    await Promise.resolve();
    await tick();
    expect(select.value).toBe('spring');
    await fireEvent.click(handoffButton());
    expect(onclose).toHaveBeenCalledWith(expect.objectContaining({ imageId: 'spring' }));
  });

  it('goes back to the lab\'s own pixels when the lab\'s picture is picked again', async () => {
    const lab = picture();
    const { onclose } = mountTour({ image: lab });
    const select = screen.getByRole('combobox', { name: 'Tour picture' }) as HTMLSelectElement;
    await fireEvent.change(select, { target: { value: 'doge' } });
    await waitFor(() => expect(handoffButton().disabled).toBe(false));
    await fireEvent.change(select, { target: { value: 'spring' } });
    // Not fetched again: the lab already has it.
    expect(loadPicture).toHaveBeenCalledTimes(1);
    expect(handoffButton().disabled).toBe(false);
    expect(select.value).toBe('spring');
    await fireEvent.click(handoffButton());
    expect(onclose.mock.lastCall![0]).toMatchObject({ imageId: 'spring' });
    expect(onclose.mock.lastCall![0].image).toBe(lab);
  });

  it('applies an upload and hands it over as the uploaded picture', async () => {
    const { onclose } = mountTour();
    const uploaded: RgbaImage = { w: 8, h: 8, rgba: new Uint8Array(8 * 8 * 4).fill(30) };
    vi.mocked(decodeUpload).mockResolvedValueOnce(uploaded);
    const input = dialog().querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'mine.png', { type: 'image/png' });
    await fireEvent.change(input, { target: { files: [file] } });
    expect(decodeUpload).toHaveBeenCalledWith(file);
    const select = screen.getByRole('combobox', { name: 'Tour picture' }) as HTMLSelectElement;
    await waitFor(() => expect(Array.from(select.options).some((o) => o.textContent === 'Your picture')).toBe(true));
    expect(select.value).toBe('upload');
    await fireEvent.click(handoffButton());
    expect(onclose).toHaveBeenCalledWith(expect.objectContaining({ imageId: 'upload', image: uploaded }));
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

  it('needs more than 40 px to swipe', async () => {
    mountTour();
    const panel = document.querySelector('.tour-panel')!;
    pointer(panel, 'pointerdown', 'touch', 200);
    pointer(panel, 'pointerup', 'touch', 160);
    await tick();
    expect(stepLabel()).toBe('Step 1 of 9');
    pointer(panel, 'pointerdown', 'touch', 200);
    pointer(panel, 'pointerup', 'touch', 159);
    await tick();
    expect(stepLabel()).toBe('Step 2 of 9 · loses detail');
  });

  it('keeps focus in the dialog when Back goes away on step 1', async () => {
    const { onclose } = mountTour();
    await fireEvent.click(next());
    const back = screen.getByRole('button', { name: 'Back' }) as HTMLButtonElement;
    back.focus();
    await fireEvent.click(back);
    await tick();
    expect(stepLabel()).toBe('Step 1 of 9');
    expect(dialog().contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(document.body);
    expect((document.activeElement as HTMLButtonElement).disabled).not.toBe(true);
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    // The dialog still owns the keys: Escape reaches it, not the page behind.
    await fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(onclose).toHaveBeenCalledWith(null);
  });

  it('keeps focus in the dialog when Start exploring is disabled by a pending pick', async () => {
    mountTour();
    await fireEvent.click(stripButtons()[8]);
    next().focus();
    vi.mocked(loadPicture).mockReturnValueOnce(deferred<RgbaImage>().promise);
    await fireEvent.change(screen.getByRole('combobox', { name: 'Tour picture' }), { target: { value: 'doge' } });
    await tick();
    expect((next() as HTMLButtonElement).disabled).toBe(true);
    expect(dialog().contains(document.activeElement)).toBe(true);
    expect((document.activeElement as HTMLButtonElement).disabled).not.toBe(true);
  });

  it('says so, in one line, when the kit cannot load', async () => {
    const { loadVizCore } = await import('../../../wasm/loader');
    vi.mocked(loadVizCore).mockRejectedValueOnce(new Error('no wasm'));
    mountTour();
    await waitFor(() => expect(screen.getByText("Some pictures couldn't load, but the steps still read fine.")).toBeTruthy());
    // The encoder's steps say so too, instead of waiting for ever.
    await fireEvent.click(stripButtons()[4]);
    const figure = document.querySelector('figure.tour-visual')!;
    expect(figure.textContent).toContain("Couldn't make this picture.");
    expect(figure.getAttribute('aria-busy')).toBe('false');
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

  it('lives at the end of the page body and leaves nothing behind when it closes', () => {
    // Something else portalled to the body (a card, say) must outlive the tour.
    const card = document.createElement('div');
    card.className = 'other-portal';
    document.body.append(card);
    const { unmount } = mountTour();
    const backdrop = document.querySelector('.tour-backdrop')!;
    expect(backdrop.parentElement).toBe(document.body);
    expect(backdrop.contains(dialog())).toBe(true);
    unmount();
    expect(document.querySelector('.tour-backdrop')).toBeNull();
    expect(card.isConnected).toBe(true);
    card.remove();
  });

  it('names the lossy steps on the strip', () => {
    mountTour();
    expect(stripButtons().map((b) => b.getAttribute('aria-label'))).toEqual([
      'Step 1: Split brightness from colour',
      'Step 2: Shrink the colour, loses detail',
      'Step 3: Cut into tiles',
      'Step 4: Describe each tile as waves',
      'Step 5: Round off fine detail, loses detail',
      'Step 6: Line the numbers up',
      'Step 7: Count the zeros',
      'Step 8: Short codes for common things',
      'Step 9: Open it again',
    ]);
  });

  it('announces each step politely, apart from the slider and the captions', async () => {
    mountTour();
    const live = dialog().querySelector('[aria-live="polite"]')!;
    expect(live.getAttribute('aria-atomic')).toBe('true');
    expect(live.textContent).toContain('Step 1 of 9');
    expect(live.textContent).toContain('Split brightness from colour');
    expect(live.textContent).toContain('Your eye notices brightness far more than colour.');
    await fireEvent.click(next());
    expect(live.textContent).toContain('Step 2 of 9');
    expect(live.textContent).toContain('Shrink the colour');
    expect(live.textContent).toContain('Neighbouring pixels share one colour');
    await fireEvent.click(stripButtons()[4]);
    expect(live.contains(document.querySelector('figure.tour-visual'))).toBe(false);
    expect(live.contains(screen.getByRole('slider', { name: 'Quality' }))).toBe(false);
  });

  it('closes a showing card on the first Escape and the tour on the second', async () => {
    const ctl = new TooltipController();
    const { onclose } = mountTour({ ctl });
    ctl.showNow({ id: 'tour.step', step: 'tiles' }, 10, 10, boxOf(10, 10, 20, 20));
    await fireEvent.keyDown(dialog(), { key: 'Escape' });
    expect(onclose).not.toHaveBeenCalled();
    expect(ctl.hovered).toBeNull();
    ctl.pin({ id: 'tour.step', step: 'waves' }, boxOf(10, 10, 20, 20));
    await fireEvent.keyDown(dialog(), { key: 'Escape' });
    expect(onclose).not.toHaveBeenCalled();
    expect(ctl.pinned).toBeNull();
    await fireEvent.keyDown(dialog(), { key: 'Escape' });
    expect(onclose).toHaveBeenCalledWith(null);
  });

  it('closes the card that was showing when it opens', () => {
    const ctl = new TooltipController();
    ctl.showNow({ id: 'tour.open' }, 10, 10, boxOf(10, 10, 20, 20));
    ctl.pin({ id: 'tour.open' }, boxOf(10, 10, 20, 20));
    mountTour({ ctl });
    expect(ctl.hovered).toBeNull();
    expect(ctl.pinned).toBeNull();
  });

  it('moves focus without scrolling, and starts each step scrolled to the top', async () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    try {
      mountTour();
      expect(document.activeElement).toBe(next());
      const calls = focus.mock.calls.filter((_, i) => focus.mock.contexts[i] === next());
      expect(calls.length).toBeGreaterThan(0);
      for (const c of calls) expect(c[0]).toEqual({ preventScroll: true });
      // Focus lost to a control that went away comes back without scrolling, too.
      await fireEvent.click(next());
      const back = screen.getByRole('button', { name: 'Back' });
      back.focus();
      focus.mockClear();
      await fireEvent.click(back);
      await tick();
      expect(focus).toHaveBeenCalled();
      for (const c of focus.mock.calls) expect(c[0]).toEqual({ preventScroll: true });
    } finally {
      focus.mockRestore();
    }
    const body = dialog().querySelector<HTMLElement>('.tour-body')!;
    body.scrollTop = 120;
    await fireEvent.click(next());
    expect(body.scrollTop).toBe(0);
  });

  it('keeps room for the longest words and the slider on every step, so the buttons never move', async () => {
    mountTour();
    const words = dialog().querySelector('.tour-words')!;
    // Every step's words sit in the same place, unseen and unread, beside the live one.
    const sizers = [...words.querySelectorAll('.tour-text.sizer')];
    expect(sizers.map((el) => el.querySelector('h3')!.textContent)).toEqual(TOUR_STEPS.map((s) => s.heading));
    expect(sizers.map((el) => el.querySelector('.line')!.textContent)).toEqual(TOUR_STEPS.map((s) => s.line));
    for (const el of sizers) {
      expect(el.getAttribute('aria-hidden')).toBe('true');
      expect(el.hasAttribute('aria-live')).toBe(false);
    }
    expect(words.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
    // Only the live step's heading is a heading anyone can reach.
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Split brightness from colour']);
    // The slider's row is there on every step, empty but for step 5.
    for (let i = 0; i < TOUR_STEPS.length; i++) {
      await fireEvent.click(stripButtons()[i]);
      const row = dialog().querySelectorAll('.quality-row');
      expect(row).toHaveLength(1);
      expect(row[0].querySelector('input') !== null).toBe(i === 4);
    }
  });

  it('keeps the buttons out of the scrolling content', () => {
    mountTour();
    const body = dialog().querySelector('.tour-body')!;
    const footer = dialog().querySelector('footer.actions')!;
    expect(body.contains(footer)).toBe(false);
    expect(footer.parentElement).toBe(dialog());
    for (const part of ['.tour-strip', '.tour-panel', '.pick']) expect(body.querySelector(part)).toBeTruthy();
    // The step label sits with its heading, in one block.
    const label = dialog().querySelector('.tour-label')!;
    expect(label.parentElement).toBe(dialog().querySelector('h3')!.parentElement);
  });

  it('clears the last picture error when a new picture starts loading', async () => {
    vi.mocked(loadPicture).mockRejectedValueOnce(new Error('Could not load the picture "Doge".'));
    mountTour();
    const select = screen.getByRole('combobox', { name: 'Tour picture' }) as HTMLSelectElement;
    await fireEvent.change(select, { target: { value: 'doge' } });
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    vi.mocked(loadPicture).mockReturnValueOnce(deferred<RgbaImage>().promise);
    await fireEvent.change(select, { target: { value: 'shuttle' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
