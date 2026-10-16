import { afterAll, beforeAll, describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import Overview from '../jpeg/Overview.svelte';
import { IMAGES } from '../../jpeg/images';

const image = { w: 64, h: 64, rgba: Uint8Array.from({ length: 64 * 64 * 4 }, (_, i) => (i * 7) & 255) };
const jpeg = Uint8Array.from({ length: 900 }, (_, i) => (i * 31) & 255);
const credit = IMAGES.find((im) => im.id === 'spring')!.credit;

const show = (w: number, h: number) =>
  render(Overview, { rect: { x: 16, y: 200, w, h }, image, jpeg, quality: 50, credit }).container;

describe('Overview.svelte', () => {
  it('shows the sizes, the three histograms, the caption and the credit on a desktop slot', () => {
    const c = show(1102, 216);
    const text = c.textContent!;
    for (const part of ['Raw bytes', 'Neighbour differences', 'JPEG file', 'Raw pixels', '12.0 KB', ' : 1', 'wrap round to 255', 'Jim Peaco']) {
      expect(text).toContain(part);
    }
    expect(c.querySelectorAll('svg')).toHaveLength(3);
    expect(c.querySelector('.overview')?.classList.contains('narrow')).toBe(false);
    expect(c.querySelector('[role="group"]')?.getAttribute('aria-label')).toContain('File size');
  });

  it('keeps the labels beside the size bars, never inside them', () => {
    const c = show(1102, 216);
    for (const bar of c.querySelectorAll('.bar')) expect(bar.textContent).toBe('');
    expect(c.querySelector('.bar.file')).toBeTruthy();
  });

  it('stacks the histograms on a narrow slot', () => {
    expect(show(311, 302).querySelector('.overview')?.classList.contains('narrow')).toBe(true);
  });

  it('shows messages as the first row of the stats', () => {
    const c = render(Overview, { rect: { x: 0, y: 0, w: 600, h: 260 }, image, jpeg, quality: 50, errors: ['Could not load the picture "Doge".'] }).container;
    const alert = c.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('Could not load');
    expect(c.querySelector('.overview')!.firstElementChild).toBe(alert);
  });
});

// jsdom does no layout, so stand in for it: the content is 50 px of charts, 50 for the sizes, 60 for the caption and 40 for the credit.
describe('Overview.svelte text budget', () => {
  const saved = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
  let slot = 200;
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get(this: HTMLElement) {
        if (!this.classList.contains('overview')) return 0;
        return 50 + (this.querySelector('.sizes') ? 50 : 0) + (this.querySelector('.caption') ? 60 : 0) + (this.querySelector('.credit') ? 40 : 0);
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('overview') ? slot : 0;
      },
    });
  });
  afterAll(() => {
    if (saved) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', saved);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollHeight;
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
  });

  it('keeps the text while it fits, then drops the caption, the credit and the size bars in that order', async () => {
    slot = 200;
    const full = show(311, 302);
    await vi.waitFor(() => expect(full.querySelector('.caption') && full.querySelector('.credit')).toBeTruthy());
    slot = 150;
    const noCaption = show(311, 302);
    await vi.waitFor(() => expect(noCaption.querySelector('.caption')).toBeNull());
    expect(noCaption.querySelector('.credit')).toBeTruthy();
    slot = 120;
    const bare = show(311, 302);
    await vi.waitFor(() => expect(bare.querySelector('.credit')).toBeNull());
    expect(bare.querySelector('.caption')).toBeNull();
    expect(bare.querySelectorAll('svg')).toHaveLength(3);
    expect(bare.querySelector('.sizes')).toBeTruthy();
    slot = 70;
    const charts = show(311, 302);
    await vi.waitFor(() => expect(charts.querySelector('.sizes')).toBeNull());
    expect(charts.querySelectorAll('svg')).toHaveLength(3);
  });
});
