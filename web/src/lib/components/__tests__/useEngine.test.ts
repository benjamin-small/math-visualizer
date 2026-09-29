import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installRafPolyfill, freeSpy, dispatchSpy } from '../../test/fakeViz';

installRafPolyfill();

vi.mock('../../wasm/loader', async () => {
  const { makeVizMock } = await import('../../test/fakeViz');
  return { loadVizCore: vi.fn(() => Promise.resolve(makeVizMock())) };
});

import { useEngine } from '../useEngine.svelte';

describe('useEngine', () => {
  beforeEach(() => {
    freeSpy.mockClear();
    dispatchSpy.mockClear();
  });

  it('boots an engine on the canvas, applies the initial speed, reports ready, and frees on destroy', async () => {
    const canvas = document.createElement('canvas');
    canvas.id = 'c1';
    const onReady = vi.fn();
    const h = useEngine('sierpinski', { initialSpeed: 120, onReady });
    await h.start(canvas);
    expect(h.api.engine).toBeTruthy();
    expect(dispatchSpy).toHaveBeenCalledWith({ kind: 'SetSpeed', value: 120 });
    expect(onReady).toHaveBeenCalledWith(h.api);
    await vi.waitFor(() => expect(h.api.snapshot.max_iterations).toBe(360)); // the fake reports 360
    h.destroy();
    expect(h.api.engine).toBeNull();
    expect(freeSpy).toHaveBeenCalledTimes(1);
    h.destroy(); // idempotent
    expect(freeSpy).toHaveBeenCalledTimes(1);
  });

  it('skips the SetSpeed dispatch for the engine default of 1', async () => {
    const canvas = document.createElement('canvas');
    canvas.id = 'c3';
    const h = useEngine('sierpinski', { initialSpeed: 1 });
    await h.start(canvas);
    expect(dispatchSpy).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'SetSpeed' }));
    h.destroy();
  });

  it('does not construct an engine if destroyed while the module loads', async () => {
    const canvas = document.createElement('canvas');
    canvas.id = 'c2';
    const h = useEngine('fourier');
    const p = h.start(canvas);
    h.destroy();
    await p;
    expect(h.api.engine).toBeNull();
    expect(freeSpy).not.toHaveBeenCalled();
  });
});
