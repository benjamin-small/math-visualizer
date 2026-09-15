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
import LabShellHost from '../../test/LabShellHost.svelte';

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

describe('LabShell extension points', () => {
  it('defaults preserve the playback bar and zoom controls', async () => {
    const { getByTitle, queryByTitle } = render(LabShellHost);
    await vi.waitFor(() => expect(queryByTitle('Play')).toBeTruthy());
    expect(getByTitle('Play')).toBeTruthy();
    expect(getByTitle('Reset to iteration 0')).toBeTruthy();
    expect(getByTitle('Zoom in')).toBeTruthy();
  });

  it('playback={false} hides the reset/step/play/speed controls', async () => {
    const { container, queryByTitle } = render(LabShellHost, { props: { playback: false } });
    await vi.waitFor(() => expect(container.querySelector('.playback-bar')).toBeTruthy());
    expect(queryByTitle('Play')).toBeNull();
    expect(queryByTitle('Reset to iteration 0')).toBeNull();
    expect(queryByTitle('Step forward')).toBeNull();
    expect(queryByTitle('Step back')).toBeNull();
    expect(container.querySelector('.speed')).toBeNull();
    expect(container.querySelector('.iteration')).toBeNull();
  });

  it('zoom={false} hides the zoom controls', async () => {
    const { container, queryByTitle } = render(LabShellHost, { props: { zoom: false } });
    await vi.waitFor(() => expect(container.querySelector('.canvas-wrap')).toBeTruthy());
    expect(queryByTitle('Zoom in')).toBeNull();
    expect(queryByTitle('Zoom out')).toBeNull();
    expect(container.querySelector('.zoom-controls')).toBeNull();
  });

  it('renders overlay snippet content inside .canvas-wrap, after the canvas', async () => {
    const { container, findByTestId } = render(LabShellHost, { props: { showOverlay: true } });
    const overlay = await findByTestId('overlay-content');
    const wrap = container.querySelector('.canvas-wrap');
    expect(wrap).toBeTruthy();
    expect(wrap?.contains(overlay)).toBe(true);
    const canvas = wrap?.querySelector('canvas');
    expect(canvas).toBeTruthy();
    // overlay div must come after the canvas in DOM order
    expect(
      canvas!.compareDocumentPosition(overlay) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('omits the overlay div entirely when no overlay snippet is passed', async () => {
    const { container } = render(LabShellHost);
    await vi.waitFor(() => expect(container.querySelector('.canvas-wrap')).toBeTruthy());
    expect(container.querySelector('.overlay')).toBeNull();
  });
});
