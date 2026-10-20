import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { installRafPolyfill, freeSpy, dispatchSpy, snapshotFixture } from '../../test/fakeViz';
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
  it('renders a header action beside the title', async () => {
    const { getByRole, container } = render(LabShellHost, { props: { showHeaderAction: true } });
    const row = container.querySelector('.title-row')!;
    expect(row).toBeTruthy();
    const heading = getByRole('heading', { level: 1 });
    const action = getByRole('button', { name: 'Header action' });
    expect(row.contains(heading)).toBe(true);
    expect(row.contains(action)).toBe(true);
    expect(heading.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await vi.waitFor(() => expect(container.textContent).toMatch(/360/)); // engine up, so teardown is clean
  });

  it('renders title, thesis, labelled playback buttons and the readout', async () => {
    const { getByRole, getByText, container } = render(LabShellHost);
    await vi.waitFor(() => expect(container.textContent).toMatch(/360/)); // engine up
    expect(getByRole('heading', { level: 1 }).textContent).toBe('Test lab');
    expect(getByText('A thesis.')).toBeTruthy();
    for (const label of ['Reset', 'Back', 'Play', 'Forward']) expect(getByRole('button', { name: label })).toBeTruthy();
    expect(container.querySelector('.readout')).toBeTruthy();
    expect(container.querySelector('.info-toggle')).toBeNull();
    expect(container.querySelector('.title-row button')).toBeNull(); // no header action unless one is given
    expect(container.querySelector('.playback-bar')).toBeNull();
  });

  it('keeps its native tooltips unless a lab turns them off', async () => {
    snapshotFixture.iteration = 10; // mid-run, so no button is disabled (a disabled one carries its reason as its title)
    try {
      const on = render(LabShellHost);
      await vi.waitFor(() => expect(on.container.textContent).toMatch(/360/));
      expect(on.getByRole('button', { name: 'Reset' }).getAttribute('title')).toBe('Back to the start');
      expect(on.container.querySelector('.readout')?.getAttribute('title')).toBe('Iteration / total');
      on.unmount();
      const off = render(LabShellHost, { props: { nativeTitles: false } });
      await vi.waitFor(() => expect(off.container.textContent).toMatch(/360/));
      expect(off.container.querySelectorAll('[title]')).toHaveLength(0);
    } finally {
      snapshotFixture.iteration = 0;
    }
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

describe('LabShell transport', () => {
  afterEach(() => {
    Object.assign(snapshotFixture, { iteration: 0, max_iterations: 360, playing: false });
  });

  /** Wait for the engine and its first frame (the fake reports 360 as the total). */
  async function waitForEngine(container: HTMLElement) {
    await vi.waitFor(() => expect(container.textContent).toMatch(/360/));
  }

  it('disables Back and Reset at the start, and says why', async () => {
    snapshotFixture.iteration = 0;
    const { getByRole, container } = render(LabShellHost);
    await waitForEngine(container);
    for (const name of [/Reset/, /Back/]) {
      const b = getByRole('button', { name });
      expect(b.getAttribute('aria-disabled')).toBe('true');
      expect(b.getAttribute('title')).toBe('Already at the start.');
    }
    dispatchSpy.mockClear();
    await fireEvent.click(getByRole('button', { name: /Back/ }));
    await fireEvent.click(getByRole('button', { name: /Reset/ }));
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('disables Play and Forward at the end, and says why', async () => {
    snapshotFixture.iteration = 360; // max_iterations
    const { getByRole, container } = render(LabShellHost);
    await waitForEngine(container);
    for (const name of [/Play/, /Forward/]) {
      const b = getByRole('button', { name });
      expect(b.getAttribute('aria-disabled')).toBe('true');
      expect(b.getAttribute('title')).toBe('At the end: Reset to run it again.');
    }
    dispatchSpy.mockClear();
    await fireEvent.click(getByRole('button', { name: /Play/ }));
    await fireEvent.click(getByRole('button', { name: /Forward/ }));
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('keeps Pause available while playing', async () => {
    Object.assign(snapshotFixture, { iteration: 360, playing: true });
    const { getByRole, container } = render(LabShellHost);
    await waitForEngine(container);
    const pause = getByRole('button', { name: /Pause/ });
    expect(pause.getAttribute('aria-disabled')).toBeNull();
    expect(pause.hasAttribute('title')).toBe(false);
    dispatchSpy.mockClear();
    await fireEvent.click(pause);
    expect(dispatchSpy).toHaveBeenCalledWith({ kind: 'TogglePlay' });
  });

  it('leaves every button live mid-run, with the usual titles', async () => {
    snapshotFixture.iteration = 10;
    const { getByRole, container } = render(LabShellHost);
    await waitForEngine(container);
    for (const name of [/Reset/, /Back/, /Play/, /Forward/]) {
      expect(getByRole('button', { name }).getAttribute('aria-disabled')).toBeNull();
    }
    expect(getByRole('button', { name: /Reset/ }).getAttribute('title')).toBe('Back to the start');
    expect(getByRole('button', { name: /Back/ }).getAttribute('title')).toBe('Step back one iteration');
    expect(getByRole('button', { name: /Play/ }).hasAttribute('title')).toBe(false);
  });

  it("treats the lab's first step as the start, and Reset goes there", async () => {
    snapshotFixture.iteration = 1;
    const { getByRole, container } = render(LabShellHost, { props: { firstStep: 1 } });
    await waitForEngine(container);
    expect(getByRole('button', { name: /Back/ }).getAttribute('aria-disabled')).toBe('true');
    snapshotFixture.iteration = 2;
    await vi.waitFor(() => expect(getByRole('button', { name: /Back/ }).getAttribute('aria-disabled')).toBeNull());
    dispatchSpy.mockClear();
    await fireEvent.click(getByRole('button', { name: /Reset/ }));
    expect(dispatchSpy.mock.calls.map((c) => c[0])).toEqual([{ kind: 'Reset' }, { kind: 'JumpTo', iteration: 1 }]);
  });

  it('disables Back and Reset below the first step too', async () => {
    snapshotFixture.iteration = 0;
    const { getByRole, container } = render(LabShellHost, { props: { firstStep: 1 } });
    await waitForEngine(container);
    for (const name of [/Reset/, /Back/]) expect(getByRole('button', { name }).getAttribute('aria-disabled')).toBe('true');
    dispatchSpy.mockClear();
    await fireEvent.click(getByRole('button', { name: /Back/ }));
    await fireEvent.click(getByRole('button', { name: /Reset/ }));
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('ramps the speed on a Play from the first step, not only from iteration 0', async () => {
    snapshotFixture.iteration = 1;
    const { getByRole, container } = render(LabShellHost, { props: { firstStep: 1, speedRamp: { target: 4, durationMs: 60_000 } } });
    await waitForEngine(container);
    dispatchSpy.mockClear();
    await fireEvent.click(getByRole('button', { name: /Play/ }));
    // The ramp's first rAF tick sets the speed (the polyfill's clock is 0, so the value itself is not the point).
    await vi.waitFor(() => expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ kind: 'SetSpeed' })));
  });

  it('does not ramp a Play from past the first step', async () => {
    snapshotFixture.iteration = 2;
    const { getByRole, container } = render(LabShellHost, { props: { firstStep: 1, speedRamp: { target: 4, durationMs: 60_000 } } });
    await waitForEngine(container);
    dispatchSpy.mockClear();
    await fireEvent.click(getByRole('button', { name: /Play/ }));
    await new Promise((r) => setTimeout(r, 20));
    expect(dispatchSpy.mock.calls.map((c) => (c[0] as { kind: string }).kind)).toEqual(['TogglePlay']);
  });

  it('turns the whole transport off with its reason', async () => {
    snapshotFixture.iteration = 10;
    const { getByRole, container } = render(LabShellHost, { props: { transportOff: 'Pick a stage first.' } });
    await waitForEngine(container);
    dispatchSpy.mockClear();
    for (const name of [/Reset/, /Back/, /Play/, /Forward/]) {
      const b = getByRole('button', { name });
      expect(b.getAttribute('aria-disabled')).toBe('true');
      expect(b.getAttribute('title')).toBe('Pick a stage first.');
      await fireEvent.click(b);
    }
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('keeps Pause live while playing even when the transport is off', async () => {
    Object.assign(snapshotFixture, { iteration: 10, playing: true });
    const { getByRole, container } = render(LabShellHost, { props: { transportOff: 'Pick a stage first.' } });
    await waitForEngine(container);
    const pause = getByRole('button', { name: /Pause/ });
    expect(pause.getAttribute('aria-disabled')).toBeNull();
    dispatchSpy.mockClear();
    await fireEvent.click(pause);
    expect(dispatchSpy).toHaveBeenCalledWith({ kind: 'TogglePlay' });
  });

  it('marks buttons disabled without native titles when the lab draws its own cards', async () => {
    snapshotFixture.iteration = 0;
    const { getByRole, container } = render(LabShellHost, { props: { nativeTitles: false } });
    await waitForEngine(container);
    const back = getByRole('button', { name: /Back/ });
    expect(back.getAttribute('aria-disabled')).toBe('true');
    expect(back.hasAttribute('title')).toBe(false);
  });

  it('keeps disabled buttons focusable and in DOM order', async () => {
    snapshotFixture.iteration = 0;
    const { container } = render(LabShellHost, { props: { transportOff: 'Off.' } });
    await waitForEngine(container);
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('.transport button')];
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Reset', 'Back', 'Play', 'Forward']);
    for (const b of buttons) expect(b.disabled).toBe(false);
  });
});
