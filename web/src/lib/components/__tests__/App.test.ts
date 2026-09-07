import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { installRafPolyfill } from '../../test/fakeViz';

installRafPolyfill();

// Mock the WASM loader so the lab shell mounts without instantiating WebGL.
// vi.mock is hoisted above the imports, so pull the shared fake in lazily.
vi.mock('../../wasm/loader', async () => {
  const { makeVizMock } = await import('../../test/fakeViz');
  return { loadVizCore: vi.fn(() => Promise.resolve(makeVizMock())) };
});

import App from '../../../App.svelte';

describe('App.svelte', () => {
  it('mounts and renders the playback bar with iteration display', async () => {
    const { getByTitle, container } = render(App);
    expect(getByTitle('Play')).toBeTruthy();
    expect(getByTitle('Step forward')).toBeTruthy();
    expect(getByTitle('Step back')).toBeTruthy();
    expect(getByTitle('Reset to iteration 0')).toBeTruthy();
    // Wait for async frame loop to run and update snapshot
    await new Promise(r => setTimeout(r, 10));
    expect(container.textContent).toMatch(/0\s*\/\s*360/);
  });

  it('renders the nav with both lab links', () => {
    const { getByText } = render(App);
    // The info panel also carries an <h2>Sierpinski Pyramid</h2>; pin to the link.
    expect(getByText('Sierpinski Pyramid', { selector: 'a' })).toBeTruthy();
    expect(getByText('Fourier Epicycles')).toBeTruthy();
  });
});
