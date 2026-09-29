import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import ThemeToggle from '../ThemeToggle.svelte';

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('ThemeToggle', () => {
  it('shows the current theme word and cycles on click', async () => {
    const { getByLabelText } = render(ThemeToggle);
    const b = getByLabelText(/^Theme:/);
    expect(b.textContent).toContain('System');
    await fireEvent.click(b);
    expect(b.textContent).toContain('Light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    await fireEvent.click(b);
    expect(b.textContent).toContain('Dark');
    await fireEvent.click(b);
    expect(b.textContent).toContain('System');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
  it('renders an svg icon, not text glyphs', () => {
    const { getByLabelText } = render(ThemeToggle);
    expect(getByLabelText(/^Theme:/).querySelector('svg')).toBeTruthy();
  });
});
