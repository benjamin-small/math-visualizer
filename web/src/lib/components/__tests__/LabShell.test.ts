import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { installRafPolyfill, freeSpy } from '../../test/fakeViz';
import { navigate } from '../../router.svelte';

installRafPolyfill();

vi.mock('../../wasm/loader', async () => {
  const { makeVizMock } = await import('../../test/fakeViz');
  return { loadVizCore: vi.fn(() => Promise.resolve(makeVizMock())) };
});

// The Fourier lab fetches a font on mount; jsdom has no origin to fetch from.
vi.mock('../../fourier/textPath', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../fourier/textPath')>()), // keep pure helpers (samplesFor) real
 textToPath: vi.fn(async () => []) }));

import App from '../../../App.svelte';

/** Render the app and wait for the engine (constructed after the async WASM load; the fake reports 360). */
async function renderWithEngine() {
  const result = render(App);
  await vi.waitFor(() => expect(result.container.textContent).toMatch(/360/));
  return result;
}

describe('LabShell teardown', () => {
  beforeEach(() => {
    freeSpy.mockClear();
    navigate('sierpinski'); // `route` is module-level state; reset between tests
  });

  it('frees the engine when the shell is unmounted', async () => {
    const { unmount } = await renderWithEngine();
    expect(freeSpy).not.toHaveBeenCalled();
    unmount();
    expect(freeSpy).toHaveBeenCalledTimes(1);
  });

  it('tears down the shell (and frees the engine) on a route switch', async () => {
    const { getByLabelText } = await renderWithEngine();
    navigate('fourier');
    await tick();
    // The Fourier lab's text input only exists once the Sierpinski shell is gone.
    expect(getByLabelText('Text to trace')).toBeTruthy();
    expect(freeSpy).toHaveBeenCalledTimes(1);
  });
});
