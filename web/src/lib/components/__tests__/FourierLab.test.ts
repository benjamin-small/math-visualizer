import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { installRafPolyfill, dispatchSpy, updateRuleConfigSpy } from '../../test/fakeViz';
import { navigate } from '../../router.svelte';

installRafPolyfill();

// Mock the WASM loader so the lab shell mounts without instantiating WebGL.
// vi.mock is hoisted above the imports, so pull the shared fake in lazily.
vi.mock('../../wasm/loader', async () => {
  const { makeVizMock } = await import('../../test/fakeViz');
  return { loadVizCore: vi.fn(() => Promise.resolve(makeVizMock())) };
});

// Mock the font-backed text→path pipeline: three points for any non-blank
// text, `[]` for blank (mirroring the real contract).
vi.mock('../../fourier/textPath', () => ({
  textToPath: vi.fn(async (t: string) =>
    t.trim()
      ? [
          { x: 1, y: 0, pen: true },
          { x: 0, y: 1, pen: true },
          { x: -1, y: 0, pen: false },
        ]
      : [],
  ),
}));

import App from '../../../App.svelte';

describe('FourierLab.svelte', () => {
  beforeEach(() => {
    dispatchSpy.mockClear();
    updateRuleConfigSpy.mockClear();
    navigate('fourier'); // `route` is module-level state; pin it before each render
  });

  it('pushes the default text as a rule config on ready, then dispatches Play', async () => {
    render(App);
    await vi.waitFor(() => expect(updateRuleConfigSpy).toHaveBeenCalled());

    expect(updateRuleConfigSpy).toHaveBeenCalledTimes(1);
    const cfg = updateRuleConfigSpy.mock.calls[0][0] as {
      path: unknown[];
      epicycles: number;
      max_iterations: number;
    };
    expect(cfg.path).toHaveLength(3);
    expect(cfg.epicycles).toBe(250);
    expect(cfg.max_iterations).toBe(3);

    // Play must follow the config push (update_rule_config resets to paused/0).
    expect(dispatchSpy).toHaveBeenCalledWith({ kind: 'Play' });
    const playCall = dispatchSpy.mock.calls.findIndex((c) => (c[0] as { kind: string }).kind === 'Play');
    expect(dispatchSpy.mock.invocationCallOrder[playCall]).toBeGreaterThan(
      updateRuleConfigSpy.mock.invocationCallOrder[0],
    );
  });

  it('shows a hint (and pushes nothing) when the text is cleared', async () => {
    const { getByLabelText, getByText, queryByText } = render(App);
    await vi.waitFor(() => expect(updateRuleConfigSpy).toHaveBeenCalledTimes(1));

    const input = getByLabelText('Text to trace') as HTMLInputElement;
    expect(input.value).toBe('poetic tech');
    expect(queryByText(/Nothing to draw/)).toBeNull();

    await fireEvent.input(input, { target: { value: '' } });
    // The push is debounced (150ms); waitFor polls past it.
    await vi.waitFor(() => expect(getByText(/Nothing to draw/)).toBeTruthy());
    expect(updateRuleConfigSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps the nav and swaps the lab when routing back to Sierpinski', async () => {
    const { getByText, getByLabelText, queryByLabelText } = render(App);
    expect(getByText('Sierpinski Pyramid', { selector: 'a' })).toBeTruthy();
    expect(getByLabelText('Text to trace')).toBeTruthy();

    navigate('sierpinski');
    await tick();
    expect(queryByLabelText('Text to trace')).toBeNull();
    expect(getByText('Sierpinski Pyramid', { selector: 'h2' })).toBeTruthy();
  });
});
