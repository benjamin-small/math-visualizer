import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import { installRafPolyfill } from '../../test/fakeViz';
import { navigate } from '../../router.svelte';

installRafPolyfill();

// Mock the WASM loader so the lab shell mounts without instantiating WebGL.
// vi.mock is hoisted above the imports, so pull the shared fake in lazily.
vi.mock('../../wasm/loader', async () => {
  const { makeVizMock } = await import('../../test/fakeViz');
  return { loadVizCore: vi.fn(() => Promise.resolve(makeVizMock())) };
});

// The Fourier lab fetches a font on mount; jsdom has no origin to fetch from.
vi.mock('../../fourier/textPath', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../fourier/textPath')>()),
  textToPath: vi.fn(async () => []),
}));

import App from '../../../App.svelte';

describe('App.svelte', () => {
  beforeEach(() => navigate('home'));

  it('opens on the home page with a link per lab, the Source link and the theme toggle, and no tabs', () => {
    const { container, getByRole } = render(App);
    expect(container.querySelector('.tabs')).toBeNull();
    expect(getByRole('link', { name: /Sierpinski Pyramid/ }).getAttribute('href')).toBe('#/sierpinski');
    expect(getByRole('link', { name: /Fourier Epicycles/ }).getAttribute('href')).toBe('#/fourier');
    expect(getByRole('link', { name: /Sorting Algorithms/ }).getAttribute('href')).toBe('#/sorting');
    expect(getByRole('link', { name: 'Source' }).getAttribute('href')).toContain('github.com/benjamin-small/math-visualizer');
    expect(getByRole('button', { name: /^Theme:/ })).toBeTruthy();
    expect(getByRole('link', { name: 'Math Visualizer' }).getAttribute('href')).toBe('#/');
  });

  it('shows the lab tabs on a lab route with the active one marked', async () => {
    navigate('fourier');
    const { container } = render(App);
    await vi.waitFor(() => expect(container.querySelector('canvas')).toBeTruthy());
    expect(container.querySelectorAll('.tabs a')).toHaveLength(3);
    expect(container.querySelector('.tabs a[aria-current="page"]')?.textContent).toBe('Fourier Epicycles');
  });

  it('mounts a lab with its labelled playback buttons and the iteration readout', async () => {
    navigate('sierpinski');
    const { getByRole, container } = render(App);
    await vi.waitFor(() => expect(container.textContent).toMatch(/0\s*\/\s*360/)); // fake engine snapshot
    for (const label of ['Reset', 'Back', 'Play', 'Forward']) expect(getByRole('button', { name: label })).toBeTruthy();
  });
});
