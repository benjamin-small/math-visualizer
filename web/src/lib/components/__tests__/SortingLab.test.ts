import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import {
  installRafPolyfill,
  dispatchSpy,
  ruleActionSpy,
  updateRuleConfigSpy,
  updateVizConfigSpy,
  sortingSummaryFixture,
} from '../../test/fakeViz';
import { navigate } from '../../router.svelte';

installRafPolyfill();

// Mock the WASM loader so the lab shell mounts without instantiating WebGL.
// vi.mock is hoisted above the imports, so pull the shared fake in lazily.
vi.mock('../../wasm/loader', async () => {
  const { makeVizMock } = await import('../../test/fakeViz');
  return { loadVizCore: vi.fn(() => Promise.resolve(makeVizMock())) };
});

import App from '../../../App.svelte';

/** Render the sorting lab and wait until the shell has handed it the engine. */
async function renderLab(query = '') {
  navigate('sorting', query); // `route` is module-level state; pin it before each render
  const result = render(App);
  await vi.waitFor(() => expect(dispatchSpy).toHaveBeenCalledWith({ kind: 'Play' }));
  return result;
}

/** The action of the n-th `rule_action` call. */
function action(n: number) {
  return ruleActionSpy.mock.calls[n][0];
}

describe('SortingLab.svelte', () => {
  beforeEach(() => {
    dispatchSpy.mockClear();
    ruleActionSpy.mockClear();
    updateRuleConfigSpy.mockClear();
    updateVizConfigSpy.mockClear();
  });

  it('renders the 7 x 4 matrix: a header per algorithm and dataset, plus 28 cells', async () => {
    const { container, getByTitle } = await renderLab();
    expect(container.querySelectorAll('.hdr.row')).toHaveLength(7);
    expect(container.querySelectorAll('.hdr.col')).toHaveLength(4);
    expect(container.querySelectorAll('.cell')).toHaveLength(28);
    expect(getByTitle('Run row: Bubble sort')).toBeTruthy();
    expect(getByTitle('Run row: Heap sort')).toBeTruthy();
    expect(getByTitle('Run column: Random')).toBeTruthy();
    expect(getByTitle('Run column: Few unique')).toBeTruthy();
    // The lab replaces the shell's playback bar with its own toolbar.
    expect(container.querySelector('.iteration')).toBeNull();
    expect(container.querySelector('.zoom-controls')).toBeNull();
  });

  it('labels every cell with its algorithm, dataset and state', async () => {
    const { getByLabelText } = await renderLab();
    // The fixture reports 28 idle lanes.
    expect(getByLabelText('Bubble sort on Random: idle')).toBeTruthy();
    expect(getByLabelText('Heap sort on Few unique: idle')).toBeTruthy();
  });

  it('toggles a single lane when its cell is clicked', async () => {
    const { container } = await renderLab();
    await fireEvent.click(container.querySelectorAll('.cell')[5]);
    expect(ruleActionSpy).toHaveBeenCalledTimes(1);
    expect(action(0)).toEqual({ kind: 'toggle', lane: 5 });
  });

  it('runs a whole column from its header', async () => {
    const { getByTitle } = await renderLab();
    await fireEvent.click(getByTitle('Run column: Random'));
    expect(action(0)).toEqual({ kind: 'set_running', lanes: [0, 4, 8, 12, 16, 20, 24], running: true });
  });

  it('runs a whole row from its header', async () => {
    const { getByTitle } = await renderLab();
    await fireEvent.click(getByTitle('Run row: Insertion sort'));
    expect(action(0)).toEqual({ kind: 'set_running', lanes: [4, 5, 6, 7], running: true });
  });

  it('runs, pauses and resets every lane from the toolbar', async () => {
    const { getByText } = await renderLab();
    // The info panel mentions these by name too; pin to the toolbar buttons.
    const button = (label: string) => getByText(label, { selector: 'button' });
    await fireEvent.click(button('Run all'));
    const all = Array.from({ length: 28 }, (_, i) => i);
    expect(action(0)).toEqual({ kind: 'set_running', lanes: all, running: true });

    await fireEvent.click(button('Pause all'));
    expect(action(1)).toEqual({ kind: 'set_running', lanes: all, running: false });

    await fireEvent.click(button('Reset'));
    expect(action(2)).toEqual({ kind: 'reset_all' });
  });

  it('"Run all" always starts every lane, even when every lane already appears to be running', async () => {
    const { container, getByText } = await renderLab();
    const original = sortingSummaryFixture.lanes;
    sortingSummaryFixture.lanes = original.map((l) => ({ ...l, running: true }));
    try {
      await vi.waitFor(() => expect(container.querySelectorAll('.cell.running')).toHaveLength(28));
      ruleActionSpy.mockClear();
      const button = (label: string) => getByText(label, { selector: 'button' });
      await fireEvent.click(button('Run all'));
      const all = Array.from({ length: 28 }, (_, i) => i);
      expect(action(0)).toEqual({ kind: 'set_running', lanes: all, running: true });
    } finally {
      sortingSummaryFixture.lanes = original;
    }
  });

  it('reseeds and restarts the clock on New data', async () => {
    const { getByText } = await renderLab();
    dispatchSpy.mockClear();
    await fireEvent.click(getByText('New data', { selector: 'button' }));
    const kinds = dispatchSpy.mock.calls.map((c) => (c[0] as { kind: string }).kind);
    expect(kinds).toEqual(['SetSeed', 'Play']);
    const seed = (dispatchSpy.mock.calls[0][0] as { value: number }).value;
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
  });

  it('sets the ops-per-second clock and starts playing on ready', async () => {
    await renderLab();
    expect(dispatchSpy).toHaveBeenCalledWith({ kind: 'SetSpeed', value: 60 });
    const speedCall = dispatchSpy.mock.calls.findIndex((c) => (c[0] as { kind: string }).kind === 'SetSpeed');
    const playCall = dispatchSpy.mock.calls.findIndex((c) => (c[0] as { kind: string }).kind === 'Play');
    expect(dispatchSpy.mock.invocationCallOrder[playCall]).toBeGreaterThan(
      dispatchSpy.mock.invocationCallOrder[speedCall],
    );
  });

  it('pushes one cell rect per lane to the viz', async () => {
    await renderLab();
    await vi.waitFor(() => expect(updateVizConfigSpy).toHaveBeenCalled());
    const cfg = updateVizConfigSpy.mock.calls[0][0] as { cells: number[][] };
    expect(cfg.cells).toHaveLength(28);
    // jsdom reports every rect as 0x0 at (0,0) — assert the shape, not the values.
    for (const rect of cfg.cells) {
      expect(rect).toHaveLength(4);
      expect(rect.every((v) => Number.isInteger(v))).toBe(true);
    }
  });

  it('changing the speed retunes the engine clock', async () => {
    const { getByLabelText, container } = await renderLab();
    await fireEvent.input(getByLabelText('Speed'), { target: { value: '240' } });
    expect(dispatchSpy).toHaveBeenLastCalledWith({ kind: 'SetSpeed', value: 240 });
    expect(container.textContent).toContain('240 ops/s');
  });

  it('applies ?n= from the link to the array size and the size input', async () => {
    const { getByLabelText } = await renderLab('n=80');
    expect((getByLabelText('Array size') as HTMLInputElement).value).toBe('80');
    await vi.waitFor(() => expect(updateRuleConfigSpy).toHaveBeenCalled());
    expect(updateRuleConfigSpy).toHaveBeenCalledWith(expect.objectContaining({ size: 80 }));
  });

  it('pushes an edited size, clamps it, and keeps the URL shareable', async () => {
    const { getByLabelText } = await renderLab();
    expect(location.hash).toBe('#/sorting'); // the default size is omitted from the link
    expect(updateRuleConfigSpy).not.toHaveBeenCalled();

    const input = getByLabelText('Array size') as HTMLInputElement;
    await fireEvent.change(input, { target: { value: '120' } });
    expect(updateRuleConfigSpy).toHaveBeenLastCalledWith(expect.objectContaining({ size: 120 }));
    expect(dispatchSpy).toHaveBeenLastCalledWith({ kind: 'Play' });
    expect(location.hash).toBe('#/sorting?n=120');

    await fireEvent.change(input, { target: { value: '9999' } });
    expect(updateRuleConfigSpy).toHaveBeenLastCalledWith(expect.objectContaining({ size: 300 }));
    expect(location.hash).toBe('#/sorting?n=300');
  });

  it('does not re-push the config when a repeated out-of-range entry clamps to the same value', async () => {
    const { getByLabelText } = await renderLab();
    const input = getByLabelText('Array size') as HTMLInputElement;

    await fireEvent.change(input, { target: { value: '9999' } });
    expect(updateRuleConfigSpy).toHaveBeenCalledTimes(1);
    expect(input.value).toBe('300');

    await fireEvent.change(input, { target: { value: '99999' } });
    expect(updateRuleConfigSpy).toHaveBeenCalledTimes(1); // still clamps to 300 — no new push
    expect(input.value).toBe('300');
  });

  it('starts with sound off, the volume slider disabled, and no AudioContext needed', async () => {
    const { getByLabelText } = await renderLab();
    const mute = getByLabelText('Sound') as HTMLButtonElement;
    expect(mute.getAttribute('aria-pressed')).toBe('false');
    expect(mute.textContent).toBe('🔇');
    expect(mute.title).toBe('Turn sound on');
    expect((getByLabelText('Volume') as HTMLInputElement).disabled).toBe(true);
  });

  it('the speaker button toggles sound on and off and enables the volume slider', async () => {
    const { getByLabelText } = await renderLab();
    const mute = getByLabelText('Sound') as HTMLButtonElement;
    await fireEvent.click(mute);
    expect(mute.getAttribute('aria-pressed')).toBe('true');
    expect(mute.textContent).toBe('🔊');
    expect(mute.title).toBe('Turn sound off');
    const volume = getByLabelText('Volume') as HTMLInputElement;
    expect(volume.disabled).toBe(false);
    expect(volume.value).toBe('0.5');

    await fireEvent.input(volume, { target: { value: '0.8' } });
    expect(volume.value).toBe('0.8');

    await fireEvent.click(mute);
    expect(mute.getAttribute('aria-pressed')).toBe('false');
    expect(mute.textContent).toBe('🔇');
    expect(volume.disabled).toBe(true);
  });

  it('rewrites an out-of-range ?n= link to the clamped value', async () => {
    const { getByLabelText } = await renderLab('n=5');
    expect((getByLabelText('Array size') as HTMLInputElement).value).toBe('10');
    expect(location.hash).toBe('#/sorting?n=10');
  });
});
