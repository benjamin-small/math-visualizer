import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the WASM module so the test stays pure-JS — no real WebGL context required.
const initMock = vi.fn(async () => undefined);

class FakeEngine {
  constructor(_id: string) {}
  frame() {}
  set_clear_color(_r: number, _g: number, _b: number, _a: number) {}
  resize(_w: number, _h: number) {}
}

vi.mock('viz-core', () => ({
  default: initMock,
  Engine: FakeEngine,
}));

describe('loadVizCore', () => {
  beforeEach(() => {
    initMock.mockClear();
    // Re-import the loader fresh per test to reset the module-level cache.
    vi.resetModules();
  });

  it('calls init exactly once across multiple parallel loads', async () => {
    const { loadVizCore } = await import('../loader');
    const [a, b, c] = await Promise.all([loadVizCore(), loadVizCore(), loadVizCore()]);
    expect(initMock).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('returns the wasm module exports', async () => {
    const { loadVizCore } = await import('../loader');
    const viz = await loadVizCore();
    expect(viz.Engine).toBe(FakeEngine);
  });
});
