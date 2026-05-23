import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';

globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 0)) as typeof requestAnimationFrame;
globalThis.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as typeof cancelAnimationFrame;

// Mock the WASM loader so App.svelte mounts without trying to instantiate WebGL.
vi.mock('../../wasm/loader', () => ({
  loadVizCore: vi.fn(() =>
    Promise.resolve({
      Engine: class {
        constructor(_: string) {}
        frame() {}
        set_clear_color(_r: number, _g: number, _b: number, _a: number) {}
        resize(_w: number, _h: number) {}
      },
    } as unknown as typeof import('viz-core'))
  ),
}));

import App from '../../../App.svelte';

describe('App.svelte', () => {
  it('mounts and renders the heading', () => {
    const { getByText } = render(App);
    expect(getByText('Clear color')).toBeTruthy();
  });
});
