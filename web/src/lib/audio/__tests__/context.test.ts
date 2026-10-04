import { describe, it, expect, afterEach, vi } from 'vitest';
import { defaultContextFactory, clamp01 } from '../context';

describe('defaultContextFactory', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is null where the browser has no AudioContext (jsdom)', () => {
    expect(defaultContextFactory()).toBeNull();
  });

  it('builds the browser AudioContext when there is one', () => {
    class FakeAudioContext {}
    vi.stubGlobal('AudioContext', FakeAudioContext);
    expect(defaultContextFactory()).toBeInstanceOf(FakeAudioContext);
  });

  it('falls back to the prefixed webkitAudioContext of old WebKit', () => {
    class FakeWebkitAudioContext {}
    vi.stubGlobal('webkitAudioContext', FakeWebkitAudioContext);
    expect(defaultContextFactory()).toBeInstanceOf(FakeWebkitAudioContext);
  });

  it('prefers the standard constructor when both exist', () => {
    class Standard {}
    class Prefixed {}
    vi.stubGlobal('AudioContext', Standard);
    vi.stubGlobal('webkitAudioContext', Prefixed);
    expect(defaultContextFactory()).toBeInstanceOf(Standard);
  });

  it('leaves no stubbed constructor behind once the globals are restored', () => {
    vi.stubGlobal('AudioContext', class {});
    vi.unstubAllGlobals();
    expect(defaultContextFactory()).toBeNull();
  });
});

describe('clamp01', () => {
  it('passes values inside [0, 1] through', () => {
    expect(clamp01(0.3)).toBe(0.3);
    expect(clamp01(0)).toBe(0);
    expect(clamp01(1)).toBe(1);
  });

  it('clamps out-of-range values to the ends', () => {
    expect(clamp01(1.7)).toBe(1);
    expect(clamp01(-1)).toBe(0);
  });

  it('turns NaN (and other non-finite input) into 0', () => {
    expect(clamp01(NaN)).toBe(0);
    expect(clamp01(Infinity)).toBe(0);
    expect(clamp01(-Infinity)).toBe(0);
  });
});
