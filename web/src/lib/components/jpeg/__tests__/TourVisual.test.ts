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
  const decode = vi.fn((rgba: Uint8Array) => rgba);
  const encodeStats = vi.fn((_rgba: Uint8Array, _w: number, _h: number, q: number) => stats(q));
  return { viz: { jpeg_encode_decode: decode, jpeg_encode_stats: encodeStats } as unknown as VizCore, decode, encodeStats };
}

const settle = async () => {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
    await tick();
  }
};

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
    expect(container.querySelector('figcaption')!.textContent).toBe('Quality 50 · 4.0 KB');
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
    expect(container.querySelector('figcaption')!.textContent).toBe('576 B saved');
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
    const cap = container.querySelector('figcaption')!.textContent!;
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
    expect(container.querySelector('figcaption')!.textContent).toBe('Quality 50 · 5.0 KB');

    await rerender({ step: 'round', ...base, viz, quality: 30 });
    await settle();
    expect(decode).toHaveBeenCalledTimes(2);
    expect(root().getAttribute('aria-busy')).toBe('false');
    expect(container.textContent).not.toContain('Getting the picture ready');
    expect(container.querySelectorAll('canvas')).toHaveLength(2);
    expect(container.querySelector('figcaption')!.textContent).toBe('Quality 50 · 5.0 KB');

    waiting[1]();
    await settle();
    expect(container.querySelector('figcaption')!.textContent).toBe('Quality 30 · 3.0 KB');
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
    expect(container.querySelector('figcaption')!.textContent).toBe('Quality 60 · 4.0 KB');
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
      // 16 × 16 is enlarged so the 8-pixel grid lines stay crisp.
      expect(Number(container.querySelector('canvas')!.getAttribute('width'))).toBe(16 * 30);
    } finally {
      spy.mockReturnValue(null);
      vi.unstubAllGlobals();
    }
  });
});
