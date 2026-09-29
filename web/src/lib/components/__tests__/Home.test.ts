import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import { installRafPolyfill, freeSpy, dispatchSpy, ruleActionSpy, sortingSummaryFixture } from '../../test/fakeViz';

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
    // The canvases exist before the (async) loader resolves; the loader is
    // single-flight, so once one tile's setup has run (the Sierpinski and
    // sorting tiles each dispatch one Play; the Fourier tile plays only once
    // its text path arrives, which the mock never delivers) all three engines
    // are constructed. Wait for both Plays before tearing down.
    const plays = () => dispatchSpy.mock.calls.filter(([c]) => (c as { kind: string }).kind === 'Play');
    await vi.waitFor(() => expect(plays()).toHaveLength(2));
    unmount();
    expect(freeSpy).toHaveBeenCalledTimes(3);
  });

  it('keeps the sorting readout live: it follows the engine summary frame by frame', async () => {
    const original = sortingSummaryFixture.lanes;
    try {
      const { container } = render(Home);
      await vi.waitFor(() => expect(container.textContent).toMatch(/0 of 28 lanes running/));
      sortingSummaryFixture.lanes = original.map((l, i) => ({ ...l, running: i < 5 }));
      // The readout reads the summary, not the snapshot; it must still re-render on the frame clock.
      await vi.waitFor(() => expect(container.textContent).toMatch(/5 of 28 lanes running/));
    } finally {
      sortingSummaryFixture.lanes = original;
    }
  });

  it('runs the tile cleanup (the sorting resize listener) on unmount', async () => {
    const removed = vi.spyOn(window, 'removeEventListener');
    const { container, unmount } = render(Home);
    await vi.waitFor(() => expect(container.textContent).toMatch(/lanes running/));
    unmount();
    expect(removed.mock.calls.some(([type]) => type === 'resize')).toBe(true);
    removed.mockRestore();
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
