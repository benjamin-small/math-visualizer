import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { installRafPolyfill, dispatchSpy, updateRuleConfigWithPathSpy } from '../../test/fakeViz';
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
vi.mock('../../fourier/textPath', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../fourier/textPath')>()), // keep pure helpers (samplesFor) real

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
import { textToPath } from '../../fourier/textPath';

describe('FourierLab.svelte', () => {
  beforeEach(() => {
    dispatchSpy.mockClear();
    updateRuleConfigWithPathSpy.mockClear();
    navigate('fourier'); // `route` is module-level state; pin it before each render
  });

  it('pushes the default text as a rule config on ready, then dispatches Play', async () => {
    render(App);
    await vi.waitFor(() => expect(updateRuleConfigWithPathSpy).toHaveBeenCalled());

    expect(updateRuleConfigWithPathSpy).toHaveBeenCalledTimes(1);
    const cfg = updateRuleConfigWithPathSpy.mock.calls[0][0] as {
      path: unknown[];
      epicycles: number;
      max_iterations: number;
    };
    expect(updateRuleConfigWithPathSpy.mock.calls[0][1]).toBeInstanceOf(Float32Array);
    expect(updateRuleConfigWithPathSpy.mock.calls[0][1]).toHaveLength(6); // 3 points × (x, y)
    expect(updateRuleConfigWithPathSpy.mock.calls[0][2]).toEqual(new Uint8Array([1, 1, 0]));
    expect(cfg.epicycles).toBe(2000);
    expect(cfg.max_iterations).toBe(3);

    // Play must follow the config push (update_rule_config resets to paused/0).
    expect(dispatchSpy).toHaveBeenCalledWith({ kind: 'Play' });
    const playCall = dispatchSpy.mock.calls.findIndex((c) => (c[0] as { kind: string }).kind === 'Play');
    expect(dispatchSpy.mock.invocationCallOrder[playCall]).toBeGreaterThan(
      updateRuleConfigWithPathSpy.mock.invocationCallOrder[0],
    );
  });

  it('typesets the series for the pushed text, with the count of terms it leaves out', async () => {
    const { container, getByText } = render(App);
    await vi.waitFor(() => expect(updateRuleConfigWithPathSpy).toHaveBeenCalledTimes(1));

    expect(getByText('The formula', { selector: 'h3' })).toBeTruthy();
    // The fake's rule_summary() reports 2000 terms; the panel expands the top 8.
    await vi.waitFor(() => expect(container.textContent).toContain('1,992 more terms'));
    expect(container.textContent).not.toContain('Type some text');
    // KaTeX arrives via a dynamic import and typesets both blocks.
    await vi.waitFor(() => expect(container.querySelectorAll('.info .katex')).toHaveLength(2));
  });

  it('drops the expansion (keeping the general formula) when the text is cleared', async () => {
    const { container, getByLabelText } = render(App);
    await vi.waitFor(() => expect(container.textContent).toContain('1,992 more terms'));

    await fireEvent.input(getByLabelText('Text to trace'), { target: { value: '' } });
    await vi.waitFor(() => expect(container.textContent).toContain('Type some text'));
    expect(container.textContent).not.toContain('more terms');
    expect(container.textContent).toContain('The formula');
  });

  it('shows a hint (and pushes nothing) when the text is cleared', async () => {
    const { getByLabelText, getByText, queryByText } = render(App);
    await vi.waitFor(() => expect(updateRuleConfigWithPathSpy).toHaveBeenCalledTimes(1));

    const input = getByLabelText('Text to trace') as HTMLInputElement;
    expect(input.value).toBe('POIETIC TECH');
    expect(queryByText(/Nothing to draw/)).toBeNull();

    await fireEvent.input(input, { target: { value: '' } });
    // The push is debounced (150ms); waitFor polls past it.
    await vi.waitFor(() => expect(getByText(/Nothing to draw/)).toBeTruthy());
    expect(updateRuleConfigWithPathSpy).toHaveBeenCalledTimes(1);
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

describe('FourierLab.svelte — shareable link params', () => {
  beforeEach(() => {
    dispatchSpy.mockClear();
    updateRuleConfigWithPathSpy.mockClear();
  });

  it('reads text and n from the hash query and uses them for the first push', async () => {
    navigate('fourier', 'text=HELLO&n=12');
    const { getByLabelText } = render(App);
    await vi.waitFor(() => expect(updateRuleConfigWithPathSpy).toHaveBeenCalled());
    const cfg = updateRuleConfigWithPathSpy.mock.calls[0][0] as { epicycles: number };
    expect(cfg.epicycles).toBe(12);
    expect((getByLabelText('Text to trace') as HTMLInputElement).value).toBe('HELLO');
  });

  it('accepts up to 50,000 epicycles from the link and requests a matching sample count', async () => {
    navigate('fourier', 'n=50000');
    render(App);
    await vi.waitFor(() => expect(updateRuleConfigWithPathSpy).toHaveBeenCalled());
    const cfg = updateRuleConfigWithPathSpy.mock.calls[0][0] as { epicycles: number; max_iterations: number };
    expect(cfg.epicycles).toBe(50_000);
    expect(cfg.max_iterations).toBe(3); // min(path.length, TRACE_STEPS) with the 3-point mock
    expect(textToPath).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ samples: 65_536 }));
  });

  it('keeps the URL in sync as the text changes and offers a copy-link button', async () => {
    navigate('fourier');
    const { getByLabelText, getByTitle } = render(App);
    await vi.waitFor(() => expect(updateRuleConfigWithPathSpy).toHaveBeenCalledTimes(1));
    expect(location.hash).toBe('#/fourier'); // defaults are omitted from the link

    const input = getByLabelText('Text to trace') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'ABC' } });
    await vi.waitFor(() => expect(updateRuleConfigWithPathSpy).toHaveBeenCalledTimes(2));
    expect(location.hash).toBe('#/fourier?text=ABC');
    expect(getByTitle('Copy a link to this message')).toBeTruthy();
  });
});
