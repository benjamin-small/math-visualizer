import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import TourVisual from '../TourVisual.svelte';
import type { TourStepId } from '../../../jpeg/tour';
import type { RgbaImage } from '../../../jpeg/images';
import type { VizCore } from '../../../wasm/loader';

/** A 16 × 16 colour test picture whose bottom-right tile holds a hard vertical edge, so that tile stands out. */
function testImage(): RgbaImage {
  const w = 16;
  const h = 16;
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const edge = x >= 8 && y >= 8;
      const bright = x >= 12;
      rgba[i] = edge ? (bright ? 240 : 10) : 20 + x * 8;
      rgba[i + 1] = edge ? (bright ? 200 : 30) : 90 + y * 4;
      rgba[i + 2] = edge ? (bright ? 60 : 160) : 200 - x * 6;
      rgba[i + 3] = 255;
    }
  }
  return { w, h, rgba };
}

function stubViz(stats: (q: number) => { bytes: number; psnr: number } = () => ({ bytes: 4096, psnr: 32 })) {
  const decode = vi.fn((rgba: Uint8Array, _w?: number, _h?: number, _q?: number) => rgba);
  const encodeStats = vi.fn((_rgba: Uint8Array, _w: number, _h: number, q: number) => stats(q));
  return { viz: { jpeg_encode_decode: decode, jpeg_encode_stats: encodeStats } as unknown as VizCore, decode, encodeStats };
}

/** One animation frame: each encode waits for one before it starts. */
const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** Let the encodes asked for so far run and land: a frame each, then their promises and Svelte's updates. */
const settle = async () => {
  for (let f = 0; f < 3; f++) {
    await frame();
    for (let i = 0; i < 4; i++) {
      await Promise.resolve();
      await tick();
    }
  }
};

const caption = (c: HTMLElement) => c.querySelector('figcaption')!.textContent;

/** A flat grey picture of any size. */
const flat = (w: number, h: number): RgbaImage => ({ w, h, rgba: new Uint8Array(w * h * 4).fill(120) });

// jsdom has no canvas: say so quietly, as a browser without 2D drawing would.
vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

const base = { image: testImage(), quality: 50, subsampling: '420' as const, huffman: 'optimized' as const };

describe('TourVisual.svelte', () => {
  it('shows a loading state until the picture and the kit are ready', async () => {
    const { container } = render(TourVisual, { step: 'round', image: null, quality: 50, subsampling: '420', huffman: 'optimized', viz: null });
    expect(container.querySelector('.tour-visual')!.getAttribute('aria-busy')).toBe('true');
    expect(container.textContent).toContain('Getting the picture ready');
  });

  it('is a figure that names its step', () => {
    const { container } = render(TourVisual, { step: 'split', ...base, viz: null });
    const root = container.querySelector('figure.tour-visual')!;
    expect(root.getAttribute('data-step')).toBe('split');
  });

  it.each(['split', 'share', 'tiles', 'waves', 'line', 'count'] as TourStepId[])('draws %s without the kit', (step) => {
    const { container } = render(TourVisual, { step, ...base, viz: null });
    expect(container.querySelector('.tour-visual')!.getAttribute('aria-busy')).toBe('false');
    expect(container.querySelectorAll('canvas, .chip, .cell').length).toBeGreaterThan(0);
    expect(container.textContent).not.toContain('Getting the picture ready');
  });

  it('labels every canvas', () => {
    for (const step of ['split', 'share', 'tiles', 'waves'] as TourStepId[]) {
      const { container, unmount } = render(TourVisual, { step, ...base, viz: null });
      for (const c of container.querySelectorAll('canvas')) expect(c.getAttribute('aria-label')).toBeTruthy();
      unmount();
    }
  });

  it('labels the brightness and colour halves', () => {
    const { container } = render(TourVisual, { step: 'split', ...base, viz: null });
    expect(container.textContent).toContain('Brightness');
    expect(container.textContent).toContain('Colour');
    expect(container.querySelectorAll('canvas')).toHaveLength(2);
  });

  it('labels the exaggerated colour sharing', () => {
    const { container } = render(TourVisual, { step: 'share', ...base, viz: null });
    const cap = container.querySelector('figcaption')!.textContent!;
    expect(cap).toContain('Exaggerated');
    expect(cap).toContain('4 × 4');
    expect(container.textContent).toContain('Before');
    expect(container.textContent).toContain('Colour shared');
  });

  it('draws the zoomed tile and four waves with rounded amounts', () => {
    const { container } = render(TourVisual, { step: 'waves', ...base, viz: null });
    expect(container.querySelector('figcaption')!.textContent).toContain('Four of the waves that make this tile.');
    expect(container.querySelectorAll('canvas')).toHaveLength(5);
    expect(container.querySelectorAll('.wave')).toHaveLength(4);
    for (const amt of container.querySelectorAll('.wave .amount')) expect(amt.textContent).toMatch(/^−?\d+$/);
    expect(container.textContent).toContain('+');
  });

  it('dims the zero tail and counts the zeros', () => {
    const line = render(TourVisual, { step: 'line', ...base, viz: null });
    expect(line.container.querySelectorAll('.cell')).toHaveLength(64);
    expect(line.container.querySelectorAll('.cell.dim').length).toBeGreaterThan(0);
    expect(line.container.querySelector('figcaption')!.textContent).toMatch(/\d+ numbers?, then \d+ zeros?/);
    line.unmount();
    const count = render(TourVisual, { step: 'count', ...base, viz: null });
    const chips = [...count.container.querySelectorAll('.chip')].map((c) => c.textContent);
    expect(chips.length).toBeGreaterThan(1);
    expect(chips).toContain('end');
  });

  it('encodes once for round, codes and open at the same settings', async () => {
    const { viz, decode, encodeStats } = stubViz();
    const props = { ...base, viz };
    const { container, rerender } = render(TourVisual, { step: 'round', ...props });
    expect(container.querySelector('.tour-visual')!.getAttribute('aria-busy')).toBe('true');
    await settle();
    expect(container.querySelector('.tour-visual')!.getAttribute('aria-busy')).toBe('false');
    expect(caption(container)).toBe('Zoomed in · Quality 50 · 4.0 KB');
    expect(container.textContent).toContain('Before');
    expect(container.textContent).toContain('After');

    await rerender({ step: 'codes', ...props });
    await settle();
    expect(container.textContent).toContain('times smaller');
    expect(container.textContent).toContain('768 B');

    await rerender({ step: 'open', ...props });
    await settle();
    expect(container.textContent).toContain('saved');
    expect(container.textContent).toContain('Original');
    expect(container.textContent).toContain('Opened JPEG');

    expect(decode).toHaveBeenCalledTimes(1);
    expect(encodeStats).toHaveBeenCalledTimes(1);
  });

  it('works out the ratio and the bytes saved from the file size', async () => {
    const { viz } = stubViz(() => ({ bytes: 192, psnr: 40 }));
    const props = { ...base, viz };
    const { container, rerender } = render(TourVisual, { step: 'codes', ...props });
    await settle();
    expect(container.querySelector('figcaption')!.textContent).toBe('4.0 times smaller');
    await rerender({ step: 'open', ...props });
    await settle();
    expect(caption(container)).toBe('Zoomed in · 576 B saved');
  });

  it('encodes again when the settings change', async () => {
    const { viz, decode } = stubViz();
    const { rerender } = render(TourVisual, { step: 'round', ...base, viz });
    await settle();
    await rerender({ step: 'round', ...base, viz, quality: 30 });
    await settle();
    expect(decode).toHaveBeenCalledTimes(2);
  });

  it('ends on the last quality after a burst of changes, one encode at a time', async () => {
    // Each decode waits to be resolved by hand, so the runs finish when the test says.
    const waiting: { q: number; done: () => void }[] = [];
    let inFlight = 0;
    let worst = 0;
    const decode = vi.fn((rgba: Uint8Array, _w: number, _h: number, q: number) => {
      inFlight++;
      worst = Math.max(worst, inFlight);
      return new Promise<Uint8Array>((resolve) => {
        waiting.push({
          q,
          done: () => {
            inFlight--;
            resolve(rgba);
          },
        });
      });
    });
    const viz = {
      jpeg_encode_decode: decode,
      jpeg_encode_stats: vi.fn((_r: Uint8Array, _w: number, _h: number, q: number) => ({ bytes: 100 * q, psnr: 30 })),
    } as unknown as VizCore;
    const { container, rerender } = render(TourVisual, { step: 'round', ...base, viz, quality: 50 });
    await settle();
    for (const q of [40, 30, 20]) await rerender({ step: 'round', ...base, viz, quality: q });
    await settle();
    expect(decode).toHaveBeenCalledTimes(1);
    expect(waiting.map((w) => w.q)).toEqual([50]);

    // The first run ends, but a newer request is waiting, so its result is not shown.
    waiting[0].done();
    await settle();
    expect(container.textContent).not.toContain('Quality 50');
    expect(decode).toHaveBeenCalledTimes(2);
    expect(waiting.map((w) => w.q)).toEqual([50, 20]);

    waiting[1].done();
    await settle();
    const cap = caption(container)!;
    expect(cap).toContain('Quality 20');
    expect(cap).toContain('2.0 KB');
    expect(container.textContent).not.toContain('Quality 50');
    expect(worst).toBe(1);
  });

  it('keeps the last picture and its caption on show while a new one is made', async () => {
    const waiting: (() => void)[] = [];
    const decode = vi.fn(
      (rgba: Uint8Array) =>
        new Promise<Uint8Array>((resolve) => {
          waiting.push(() => resolve(rgba));
        }),
    );
    const viz = {
      jpeg_encode_decode: decode,
      jpeg_encode_stats: vi.fn((_r: Uint8Array, _w: number, _h: number, q: number) => ({ bytes: 1024 * (q / 10), psnr: 30 })),
    } as unknown as VizCore;
    const { container, rerender } = render(TourVisual, { step: 'round', ...base, viz, quality: 50 });
    const root = () => container.querySelector('.tour-visual')!;
    await settle();
    expect(root().getAttribute('aria-busy')).toBe('true');
    waiting[0]();
    await settle();
    expect(root().getAttribute('aria-busy')).toBe('false');
    expect(caption(container)).toBe('Zoomed in · Quality 50 · 5.0 KB');

    await rerender({ step: 'round', ...base, viz, quality: 30 });
    await settle();
    expect(decode).toHaveBeenCalledTimes(2);
    expect(root().getAttribute('aria-busy')).toBe('false');
    expect(container.textContent).not.toContain('Getting the picture ready');
    expect(container.querySelectorAll('canvas')).toHaveLength(2);
    expect(caption(container)).toBe('Zoomed in · Quality 50 · 5.0 KB');

    waiting[1]();
    await settle();
    expect(caption(container)).toBe('Zoomed in · Quality 30 · 3.0 KB');
    expect(root().getAttribute('aria-busy')).toBe('false');
  });

  it('says so when the picture cannot be made, and tries again on the next change', async () => {
    let fail = true;
    const decode = vi.fn((rgba: Uint8Array) => {
      if (fail) throw new Error('boom');
      return rgba;
    });
    const viz = {
      jpeg_encode_decode: decode,
      jpeg_encode_stats: vi.fn(() => ({ bytes: 4096, psnr: 32 })),
    } as unknown as VizCore;
    const { container, rerender } = render(TourVisual, { step: 'round', ...base, viz });
    await settle();
    const root = container.querySelector('.tour-visual')!;
    expect(root.getAttribute('aria-busy')).toBe('false');
    expect(container.textContent).toContain("Couldn't make this picture.");
    expect(container.textContent).not.toContain('Getting the picture ready');

    fail = false;
    await rerender({ step: 'round', ...base, viz, quality: 60 });
    await settle();
    expect(container.textContent).not.toContain("Couldn't make this picture.");
    expect(caption(container)).toBe('Zoomed in · Quality 60 · 4.0 KB');
  });

  it.each(['round', 'codes', 'open'] as TourStepId[])('%s is busy while the kit is missing', (step) => {
    const { container } = render(TourVisual, { step, ...base, viz: null });
    expect(container.querySelector('.tour-visual')!.getAttribute('aria-busy')).toBe('true');
    expect(container.textContent).toContain('Getting the picture ready');
  });

  it.each(['codes', 'open'] as TourStepId[])('%s is no longer busy once its result arrives', async (step) => {
    const { viz } = stubViz();
    const { container } = render(TourVisual, { step, ...base, viz });
    expect(container.querySelector('.tour-visual')!.getAttribute('aria-busy')).toBe('true');
    await settle();
    expect(container.querySelector('.tour-visual')!.getAttribute('aria-busy')).toBe('false');
    expect(container.querySelector('figcaption')).toBeTruthy();
  });

  it('paints the picture, and the grid over it, when the canvas can draw', () => {
    const calls: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (t, k: string) => (k in t ? t[k] : (...a: unknown[]) => void calls.push(`${k}:${a.length}`)),
      set: (t, k: string, v) => ((t[k] = v), true),
    });
    class FakeImageData {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number,
      ) {}
    }
    vi.stubGlobal('ImageData', FakeImageData);
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    try {
      const { container } = render(TourVisual, { step: 'tiles', ...base, viz: null });
      expect(calls.some((c) => c.startsWith('putImageData'))).toBe(true);
      expect(calls.some((c) => c.startsWith('drawImage'))).toBe(true);
      expect(calls.some((c) => c.startsWith('strokeRect'))).toBe(true);
      // 16 × 16 is smaller than the crop, so all of it is shown, enlarged by a whole number so the grid stays crisp.
      expect(Number(container.querySelector('canvas')!.getAttribute('width'))).toBe(16 * 12);
    } finally {
      spy.mockReturnValue(null);
      vi.unstubAllGlobals();
    }
  });

  it('zooms in on the tiles around the busiest one, at a whole-number scale', () => {
    const { container } = render(TourVisual, { step: 'tiles', ...base, image: flat(256, 256), viz: null });
    const canvas = container.querySelector('canvas')!;
    // 9 × 5 tiles (72 × 40 pixels), enlarged five times.
    expect([canvas.getAttribute('width'), canvas.getAttribute('height')]).toEqual(['360', '200']);
    expect(canvas.classList.contains('pixelated')).toBe(true);
    expect(caption(container)).toBe('Zoomed in: each square is one 8 × 8 tile.');
  });

  it.each([
    ['round', 'Before', 'After'],
    ['open', 'Original', 'Opened JPEG'],
  ] as const)('shows the same zoomed-in crop before and after on %s', async (step, before, after) => {
    const { viz } = stubViz();
    const { container } = render(TourVisual, { step, ...base, image: flat(256, 256), viz });
    await settle();
    const canvases = [...container.querySelectorAll('canvas')];
    expect(canvases).toHaveLength(2);
    // 5 × 5 tiles (40 × 40 pixels), enlarged five times, drawn without smoothing.
    for (const c of canvases) {
      expect([c.getAttribute('width'), c.getAttribute('height')]).toEqual(['200', '200']);
      expect(c.classList.contains('pixelated')).toBe(true);
    }
    expect(container.textContent).toContain(before);
    expect(container.textContent).toContain(after);
    expect(caption(container)).toMatch(/^Zoomed in · /);
  });

  it('enlarges a tiny picture by a whole number on every picture step', async () => {
    const { viz } = stubViz();
    for (const step of ['split', 'share', 'tiles', 'round', 'open'] as TourStepId[]) {
      const { container, unmount } = render(TourVisual, { step, ...base, image: flat(5, 3), viz });
      await settle();
      const canvases = [...container.querySelectorAll('canvas')];
      expect(canvases.length).toBeGreaterThan(0);
      for (const c of canvases) {
        const w = Number(c.getAttribute('width'));
        const h = Number(c.getAttribute('height'));
        expect(w % 5).toBe(0);
        expect(h % 3).toBe(0);
        expect(w / 5).toBe(h / 3);
        expect(w).toBeGreaterThan(5);
      }
      unmount();
    }
  });

  it.each(['round', 'codes', 'open'] as TourStepId[])('%s says it could not make the picture when the kit failed', (step) => {
    const { container } = render(TourVisual, { step, ...base, viz: null, kitFailed: true });
    expect(container.querySelector('.tour-visual')!.getAttribute('aria-busy')).toBe('false');
    expect(container.textContent).toContain("Couldn't make this picture.");
    expect(container.textContent).not.toContain('Getting the picture ready');
  });

  it('still draws the steps that need no kit when the kit failed', () => {
    const { container } = render(TourVisual, { step: 'tiles', ...base, viz: null, kitFailed: true });
    expect(container.querySelectorAll('canvas')).toHaveLength(1);
    expect(container.textContent).not.toContain("Couldn't make this picture.");
  });

  it('collapses a drag on a synchronous kit to the newest quality', async () => {
    // The real kit answers synchronously, so only waiting a frame lets the drag's inputs replace each other.
    const { viz, decode } = stubViz((q) => ({ bytes: 100 * q, psnr: 30 }));
    const { container, rerender } = render(TourVisual, { step: 'round', ...base, viz, quality: 50 });
    for (const q of [45, 40, 35, 30, 25, 20]) await rerender({ step: 'round', ...base, viz, quality: q });
    await settle();
    // The first request was already running; every later one but the newest was replaced while it waited.
    expect(decode.mock.calls.map((c) => c[3])).toEqual([50, 20]);
    expect(caption(container)).toBe('Zoomed in · Quality 20 · 2.0 KB');
  });

  it('still encodes when the page draws no frames', async () => {
    // A hidden or occluded page may never run animation frames; the encode must not wait for ever.
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(() => 0);
    try {
      const { viz, decode } = stubViz();
      const { container } = render(TourVisual, { step: 'round', ...base, viz });
      await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(1), { timeout: 500 });
      await vi.waitFor(() => expect(caption(container)).toBe('Zoomed in · Quality 50 · 4.0 KB'));
    } finally {
      raf.mockRestore();
    }
  });

  it('keeps the drawing when a canvas is reused for a picture of another size', async () => {
    // A canvas is cleared whenever its size changes, so the size must be set before the picture is drawn.
    class FakeImageData {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number,
      ) {}
    }
    vi.stubGlobal('ImageData', FakeImageData);
    const drawnAt = new Map<HTMLCanvasElement, number>();
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      const canvas = this;
      return new Proxy({} as Record<string, unknown>, {
        get: (t, k: string) =>
          k in t ? t[k] : (..._a: unknown[]) => (k === 'drawImage' ? void drawnAt.set(canvas, canvas.width) : undefined),
        set: (t, k: string, v) => ((t[k] = v), true),
      }) as unknown as CanvasRenderingContext2D;
    } as unknown as typeof HTMLCanvasElement.prototype.getContext);
    try {
      const props = { ...base, image: flat(256, 256), viz: null };
      const { container, rerender } = render(TourVisual, { step: 'split', ...props });
      const first = container.querySelector('canvas')!;
      expect(first.width).toBe(256);
      await rerender({ step: 'tiles', ...props });
      await tick();
      const canvas = container.querySelector('canvas')!;
      expect(canvas.width).toBe(360);
      expect(drawnAt.get(canvas)).toBe(360);
    } finally {
      spy.mockReturnValue(null);
      vi.unstubAllGlobals();
    }
  });
});
