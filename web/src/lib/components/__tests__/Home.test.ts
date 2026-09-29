import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import { installRafPolyfill, freeSpy, dispatchSpy, ruleActionSpy } from '../../test/fakeViz';

installRafPolyfill();

// Mock the WASM loader so the tiles mount without instantiating WebGL.
// vi.mock is hoisted above the imports, so pull the shared fake in lazily.
vi.mock('../../wasm/loader', async () => {
  const { makeVizMock } = await import('../../test/fakeViz');
  return { loadVizCore: vi.fn(() => Promise.resolve(makeVizMock())) };
});

// jsdom has no origin to fetch a font from.
vi.mock('../../fourier/textPath', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../fourier/textPath')>()),
  textToPath: vi.fn(async () => []),
}));

import Home from '../Home.svelte';

describe('Home', () => {
  beforeEach(() => {
    freeSpy.mockClear();
    dispatchSpy.mockClear();
    ruleActionSpy.mockClear();
  });

  it('renders three live tiles that link to the labs and show a readout', async () => {
    const { container, getByRole } = render(Home);
    await vi.waitFor(() => expect(container.querySelectorAll('canvas')).toHaveLength(3));
    expect(getByRole('link', { name: /Sierpinski Pyramid/ }).getAttribute('href')).toBe('#/sierpinski');
    await vi.waitFor(() => expect(container.textContent).toMatch(/0 \/ 360 iterations/)); // fake engine snapshot
    expect(container.textContent).toMatch(/lanes running/);
    expect(dispatchSpy).toHaveBeenCalledWith({ kind: 'Play' });
    expect(ruleActionSpy).toHaveBeenCalledWith(expect.objectContaining({ kind: 'set_running', running: true }));
  });

  it('frees all three engines on unmount', async () => {
    const { unmount } = render(Home);
    // The canvases exist before the (async) loader resolves; wait until every
    // tile's setup has run (each dispatches exactly one Play) so all three
    // engines are actually constructed before we tear them down.
    const plays = () => dispatchSpy.mock.calls.filter(([c]) => (c as { kind: string }).kind === 'Play');
    await vi.waitFor(() => expect(plays()).toHaveLength(3));
    unmount();
    expect(freeSpy).toHaveBeenCalledTimes(3);
  });

  it('pauses tiles when reduced motion is preferred', async () => {
    const mm = window.matchMedia;
    window.matchMedia = ((q: string) => ({
      matches: q.includes('reduce'),
      media: q,
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof matchMedia;
    try {
      const { container } = render(Home);
      await vi.waitFor(() => expect(container.querySelectorAll('canvas')).toHaveLength(3));
      await vi.waitFor(() => expect(dispatchSpy).toHaveBeenCalledWith({ kind: 'Pause' }));
      expect(container.textContent).toMatch(/Paused/);
    } finally {
      window.matchMedia = mm;
    }
  });
});
