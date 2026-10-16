import { describe, it, expect } from 'vitest';
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

  it('stacks the histograms on a phone and still has room for the caption and the credit', () => {
    const c = show(311, 302);
    expect(c.querySelector('.overview')?.classList.contains('narrow')).toBe(true);
    expect(c.querySelector('.caption')).toBeTruthy();
    expect(c.querySelector('.credit')).toBeTruthy();
  });

  it('drops the caption first, then the credit, as the slot gets shorter', () => {
    const noCaption = show(311, 250);
    expect(noCaption.querySelector('.caption')).toBeNull();
    expect(noCaption.querySelector('.credit')).toBeTruthy();
    const bare = show(311, 205);
    expect(bare.querySelector('.caption')).toBeNull();
    expect(bare.querySelector('.credit')).toBeNull();
    expect(bare.querySelectorAll('svg')).toHaveLength(3);
  });
});
