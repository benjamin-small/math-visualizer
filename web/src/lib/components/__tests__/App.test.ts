import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';

globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 0)) as typeof requestAnimationFrame;
globalThis.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as typeof cancelAnimationFrame;

// Mock the WASM loader so App.svelte mounts without instantiating WebGL.
vi.mock('../../wasm/loader', () => ({
  loadVizCore: vi.fn(() =>
    Promise.resolve({
      Engine: class {
        constructor(_: string) {}
        frame(_now: number) {}
        dispatch(_cmd: unknown) {}
        snapshot() {
          return {
            iteration: 0,
            sub_progress: 0,
            playing: false,
            speed: 1.0,
            seed: 0,
            max_iterations: 360,
          };
        }
        rule_schema() { return {}; }
        viz_schema() { return {}; }
        rule_config() { return {}; }
        viz_config() { return {}; }
        update_rule_config(_: unknown) {}
        update_viz_config(_: unknown) {}
        capabilities() { return { supports_scrub: true, cheap_recompute: true, checkpoint_every: null }; }
        resize(_w: number, _h: number) {}
        forward_input(_ev: unknown) {}
        set_zoom(_z: number) {}
      },
    } as unknown as typeof import('viz-core'))
  ),
}));

import App from '../../../App.svelte';

describe('App.svelte', () => {
  it('mounts and renders the playback bar with iteration display', async () => {
    const { getByTitle, container } = render(App);
    expect(getByTitle('Play')).toBeTruthy();
    expect(getByTitle('Step forward')).toBeTruthy();
    expect(getByTitle('Step back')).toBeTruthy();
    expect(getByTitle('Reset to iteration 0')).toBeTruthy();
    // Wait for async frame loop to run and update snapshot
    await new Promise(r => setTimeout(r, 10));
    expect(container.textContent).toMatch(/0\s*\/\s*360/);
  });
});
