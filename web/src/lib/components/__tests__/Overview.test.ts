import { afterAll, beforeAll, describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import Overview from '../jpeg/Overview.svelte';
import { IMAGES } from '../../jpeg/images';
import { TooltipController } from '../jpeg/tooltip.svelte';
import { blockFill } from '../../jpeg/bytes';

const image = { w: 64, h: 64, rgba: Uint8Array.from({ length: 64 * 64 * 4 }, (_, i) => (i * 7) & 255) };
const jpeg = Uint8Array.from({ length: 900 }, (_, i) => (i * 31) & 255);
const credit = IMAGES.find((im) => im.id === 'spring')!.credit;

const show = (w: number, h: number) =>
  render(Overview, { rect: { x: 16, y: 200, w, h }, image, jpeg, quality: 50, credit, ctl: new TooltipController() }).container;

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

  it('hedges the claim about the middle histogram, and says custom tables when they are in use', () => {
    const plain = show(1102, 216).textContent!;
    expect(plain).toContain('At quality 50 the file is');
    expect(plain).toContain('can peak at both edges');
    expect(plain).not.toContain('peaks at both edges');
    const custom = render(Overview, { rect: { x: 0, y: 0, w: 1102, h: 216 }, image, jpeg, quality: 50, custom: true, credit, ctl: new TooltipController() }).container.textContent!;
    expect(custom).toContain('With custom tables the file is');
    expect(custom).not.toContain('At quality');
  });

  it('keeps the labels beside the size rows, never inside them', () => {
    const c = show(1102, 216);
    const rows = c.querySelectorAll('.blocks');
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.textContent!.trim()).toBe('');
    expect(c.querySelector('.blocks.file')).toBeTruthy();
  });

  it('draws the sizes as blocks of memory in a card of their own', () => {
    // 64 × 64 pixels are 12,288 raw bytes: at most 64 blocks makes each 256 B, 48 of them.
    // The 900-byte file fills 3 of those and half of a fourth.
    const c = show(1102, 216);
    const card = c.querySelector('.sizes')!;
    expect(card.getAttribute('role')).toBe('group');
    expect(card.getAttribute('tabindex')).toBe('0');
    expect(card.querySelector('.heading')?.textContent).toBe('File size');
    expect(card.querySelector('.legend')?.textContent).toBe('Each block is 256 B');
    const { full, part } = blockFill(900, 256);
    expect(card.querySelectorAll('.blocks.raw .cell')).toHaveLength(48);
    expect(card.querySelectorAll('.blocks.raw .cell.full')).toHaveLength(48);
    expect(card.querySelectorAll('.blocks.file .cell.full')).toHaveLength(full);
    const last = card.querySelectorAll<HTMLElement>('.blocks.file .cell.part');
    expect(last).toHaveLength(1);
    expect(parseFloat(last[0].querySelector<HTMLElement>('.fill')!.style.width)).toBeCloseTo(part * 100, 1);
    // Both rows lay their blocks on the same grid, so a block is the same size in each.
    const raw = card.querySelector<HTMLElement>('.blocks.raw')!;
    const file = card.querySelector<HTMLElement>('.blocks.file')!;
    expect(raw.style.getPropertyValue('--n')).toBe('48');
    expect(file.style.getPropertyValue('--n')).toBe('48');
  });

  it('draws fewer, bigger blocks on a narrow slot', () => {
    const card = show(311, 302).querySelector('.sizes')!;
    expect(card.querySelector('.legend')?.textContent).toBe('Each block is 512 B');
    expect(card.querySelectorAll('.blocks.raw .cell')).toHaveLength(24);
    expect(card.querySelectorAll('.blocks.file .cell.full')).toHaveLength(blockFill(900, 512).full);
  });

  it('still shows a sliver for a file smaller than one block', () => {
    const c = render(Overview, { rect: { x: 0, y: 0, w: 1102, h: 216 }, image, jpeg: new Uint8Array(20), quality: 50, ctl: new TooltipController() }).container;
    expect(c.querySelectorAll('.blocks.file .cell.full')).toHaveLength(0);
    const fill = c.querySelector<HTMLElement>('.blocks.file .cell.part .fill')!;
    expect(parseFloat(fill.style.width)).toBeGreaterThan(0);
  });

  it('stacks the histograms on a narrow slot', () => {
    expect(show(311, 302).querySelector('.overview')?.classList.contains('narrow')).toBe(true);
  });

  it('shows messages as the first row of the stats', () => {
    const c = render(Overview, { rect: { x: 0, y: 0, w: 600, h: 260 }, image, jpeg, quality: 50, errors: ['Could not load the picture "Doge".'], ctl: new TooltipController() }).container;
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
