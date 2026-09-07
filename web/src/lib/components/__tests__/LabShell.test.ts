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
    const { container } = await renderWithEngine();
    navigate('fourier');
    await tick();
    expect(container.textContent).toContain('Fourier Epicycle Lab');
    expect(freeSpy).toHaveBeenCalledTimes(1);
  });
});
