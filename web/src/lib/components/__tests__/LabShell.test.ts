import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
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

describe('LabShell layout', () => {
  it('renders title, thesis, labelled playback buttons and the readout', async () => {
    const { getByRole, getByText, container } = render(LabShellHost);
    await vi.waitFor(() => expect(container.textContent).toMatch(/360/)); // engine up
    expect(getByRole('heading', { level: 1 }).textContent).toBe('Test lab');
    expect(getByText('A thesis.')).toBeTruthy();
    for (const label of ['Reset', 'Back', 'Play', 'Forward']) expect(getByRole('button', { name: label })).toBeTruthy();
    expect(container.querySelector('.readout')).toBeTruthy();
    expect(container.querySelector('.info-toggle')).toBeNull();
    expect(container.querySelector('.playback-bar')).toBeNull();
  });

  it('fills the clock line with playback progress', async () => {
    const { container } = render(LabShellHost);
    await vi.waitFor(() => expect(container.textContent).toMatch(/360/));
    const clock = container.querySelector('.clock') as HTMLElement;
    expect(clock).toBeTruthy();
    expect(clock.style.width).toBe('0%');
  });

  it('playback={false} hides the playback buttons, readout, speed and clock line', async () => {
    const { container, queryByRole } = render(LabShellHost, { props: { playback: false } });
    await vi.waitFor(() => expect(container.querySelector('canvas')).toBeTruthy());
    expect(queryByRole('button', { name: 'Play' })).toBeNull();
    expect(queryByRole('button', { name: 'Reset' })).toBeNull();
    expect(container.querySelector('.readout')).toBeNull();
    expect(container.querySelector('.speed')).toBeNull();
    expect(container.querySelector('.clock')).toBeNull();
  });

  it('zoom cluster is labelled, shows the level, and zoom={false} removes it', async () => {
    const a = render(LabShellHost);
    await vi.waitFor(() => expect(a.container.querySelector('canvas')).toBeTruthy());
    expect(a.getByRole('button', { name: 'Zoom in' })).toBeTruthy();
    expect(a.getByRole('button', { name: 'Zoom out' })).toBeTruthy();
    expect(a.container.querySelector('.zoom .level')?.textContent).toBe('1.00×');
    expect(a.queryByRole('button', { name: 'Reset zoom' })).toBeNull();
    await fireEvent.click(a.getByRole('button', { name: 'Zoom in' }));
    expect(a.container.querySelector('.zoom .level')?.textContent).toBe('1.25×');
    expect(a.getByRole('button', { name: 'Reset zoom' })).toBeTruthy();
    a.unmount();
    const b = render(LabShellHost, { props: { zoom: false } });
    await vi.waitFor(() => expect(b.container.querySelector('canvas')).toBeTruthy());
    expect(b.container.querySelector('.zoom')).toBeNull();
  });

  it('renders legend and story snippets in their sections', async () => {
    const { container } = render(LabShellHost);
    await vi.waitFor(() => expect(container.querySelector('canvas')).toBeTruthy());
    expect(container.querySelector('.legend')?.textContent).toContain('Legend item');
    expect(container.querySelector('.story')?.textContent).toContain('Story text');
  });

  it('renders overlay snippet content inside .stage, after the canvas', async () => {
    const { container, findByTestId } = render(LabShellHost, { props: { showOverlay: true } });
    const overlay = await findByTestId('overlay-content');
    const stage = container.querySelector('.stage');
    expect(stage).toBeTruthy();
    expect(stage?.contains(overlay)).toBe(true);
    const canvas = stage?.querySelector('canvas');
    expect(canvas).toBeTruthy();
    expect(canvas!.compareDocumentPosition(overlay) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('omits the overlay div entirely when no overlay snippet is passed', async () => {
    const { container } = render(LabShellHost);
    await vi.waitFor(() => expect(container.querySelector('canvas')).toBeTruthy());
    expect(container.querySelector('.overlay')).toBeNull();
  });
});
