import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { installRafPolyfill, updateRuleConfigSpy } from '../../test/fakeViz';
import { navigate } from '../../router.svelte';

installRafPolyfill();

// Mock the WASM loader so the lab shell mounts without instantiating WebGL.
// vi.mock is hoisted above the imports, so pull the shared fake in lazily.
vi.mock('../../wasm/loader', async () => {
  const { makeVizMock } = await import('../../test/fakeViz');
  return { loadVizCore: vi.fn(() => Promise.resolve(makeVizMock())) };
});

// The Fourier lab fetches a font on mount; jsdom has no origin to fetch from.
vi.mock('../../fourier/textPath', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../fourier/textPath')>()),
  textToPath: vi.fn(async () => []),
}));

import App from '../../../App.svelte';

/** Render the app on the Sierpinski route and wait for the engine to be constructed. */
async function renderLab() {
  navigate('sierpinski');
  const result = render(App);
  await vi.waitFor(() => expect(result.container.querySelector('canvas')).toBeTruthy());
  // The readout shows the fake engine's max (360) once the frame loop has run.
  await vi.waitFor(() => expect(result.container.textContent).toMatch(/360/));
  return result;
}

describe('SierpinskiLab', () => {
  beforeEach(() => {
    updateRuleConfigSpy.mockClear();
  });

  it('renders the thesis, the Iterations control, five legend items and the story', async () => {
    const { container, getByLabelText, getByText } = await renderLab();
    expect(getByText(/tetrahedron of tetrahedra/)).toBeTruthy();
    expect(getByLabelText('Iterations')).toBeTruthy();
    expect(container.querySelectorAll('.legend .swatch')).toHaveLength(5);
    expect(container.querySelector('.story h2')?.textContent).toBe('How it works');
    expect(container.querySelector('.story h3')?.textContent).toBe('Why the first dots are hidden');
    expect(container.querySelector('.info-toggle')).toBeNull();
  });

  it('pushes a new max_iterations to the engine when the Iterations field changes', async () => {
    const { getByLabelText } = await renderLab();
    const input = getByLabelText('Iterations') as HTMLInputElement;
    await fireEvent.change(input, { target: { value: '1234' } });
    expect(updateRuleConfigSpy).toHaveBeenCalledWith(expect.objectContaining({ max_iterations: 1234 }));
  });

  it('gives each legend swatch its own colour class', async () => {
    const { container } = await renderLab();
    const classes = [...container.querySelectorAll('.legend .swatch')].map((el) => el.classList[1]);
    expect(classes).toEqual(['corner', 'highlight', 'guide', 'current', 'trail']);
  });
});
