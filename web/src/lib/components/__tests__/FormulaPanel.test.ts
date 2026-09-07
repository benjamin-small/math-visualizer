import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import FormulaPanel from '../FormulaPanel.svelte';
import { ruleSummaryFixture } from '../../test/fakeViz';

// KaTeX is real here: renderToString is pure JS, so jsdom typesets it fine.
// The CSS side of the dynamic import resolves to an empty module under vitest.

describe('FormulaPanel.svelte', () => {
  it('typesets the general formula and the expansion, with a "more terms" tail', async () => {
    const { container } = render(FormulaPanel, { summary: ruleSummaryFixture, shown: 2 });

    // Never empty while KaTeX loads: the raw TeX sits in <code>.
    expect(container.textContent).toContain('The formula');
    expect(container.textContent).toContain('c_0');

    await expect.poll(() => container.querySelectorAll('.katex').length).toBe(2);
    expect(container.querySelector('code')).toBeNull();
    // Both blocks are in display mode inside a scrollable wrapper.
    expect(container.querySelectorAll('.tex .katex-display')).toHaveLength(2);
    // total 2000, shown 2 → 1,998 left.
    expect(container.textContent).toContain('1,998 more terms');
    expect(container.textContent).not.toContain('Type some text');
  });

  it('shows only the general formula plus a hint when there is no summary', async () => {
    const { container } = render(FormulaPanel, { summary: null });

    expect(container.textContent).toContain('Type some text');
    await expect.poll(() => container.querySelectorAll('.katex').length).toBe(1);
    expect(container.textContent).not.toContain('more terms');
  });

  it('omits the tail when every term is shown', async () => {
    const { container } = render(FormulaPanel, {
      summary: { ...ruleSummaryFixture, total_terms: 3 },
      shown: 8,
    });
    await expect.poll(() => container.querySelectorAll('.katex').length).toBe(2);
    expect(container.textContent).not.toContain('more terms');
  });
});
