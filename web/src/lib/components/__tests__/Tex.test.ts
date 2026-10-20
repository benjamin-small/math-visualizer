import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import Tex from '../Tex.svelte';
import { MSE_TEX } from '../../jpeg/formulas';

// KaTeX is real here; jsdom does no layout, so stand in for it: the display
// formula is `need` pixels wide, in a box `have` pixels wide.
describe('Tex.svelte fit', () => {
  let need = 300;
  const have = 400;
  const saved = {
    scrollWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth'),
    clientWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth'),
  };
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('katex-display') ? need : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('katex-display') ? have : 0;
      },
    });
  });
  afterAll(() => {
    for (const [k, d] of Object.entries(saved)) {
      if (d) Object.defineProperty(HTMLElement.prototype, k, d);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[k];
    }
  });

  const show = async (display = true) => {
    const { container } = render(Tex, { tex: MSE_TEX, display });
    await expect.poll(() => container.querySelectorAll('.katex').length).toBe(1);
    return container.querySelector<HTMLElement>('.tex')!;
  };

  it('leaves a formula that fits at full size', async () => {
    need = 300;
    const box = await show();
    expect(box.style.getPropertyValue('--fit')).toBe('');
  });

  it('scales a formula that is too wide down until it fits', async () => {
    need = 500;
    const box = await show();
    await expect.poll(() => box.style.getPropertyValue('--fit')).toBe('0.8');
  });

  it('stops at 70% and lets the box scroll beyond that', async () => {
    need = 1000;
    const box = await show();
    await expect.poll(() => box.style.getPropertyValue('--fit')).toBe('0.7');
  });

  it('leaves inline formulas alone', async () => {
    need = 500;
    const box = await show(false);
    expect(box.style.getPropertyValue('--fit')).toBe('');
  });
});
