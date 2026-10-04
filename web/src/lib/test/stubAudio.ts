// A stub AudioContext for the Web Audio wrappers' tests (SortingAudio, NotesAudio).
// Every node method is a `vi.fn()`, so tests assert on exactly which AudioParams
// were driven, with what values, and when. `createGain` hands back `{ gain }`
// nodes in creation order, so a wrapper's master gain is the first one.
import { vi } from 'vitest';
import type { AudioContextLike } from '../audio/context';

export function param(value = 0) {
  return {
    value,
    setValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  };
}

export function makeStubContext() {
  const oscillators: ReturnType<typeof makeOsc>[] = [];
  function makeOsc() {
    return {
      type: 'sine',
      frequency: param(440),
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null as null | (() => void),
    };
  }
  const ctx = {
    currentTime: 1,
    state: 'suspended' as AudioContextState,
    destination: {} as AudioDestinationNode,
    resume: vi.fn(async () => { ctx.state = 'running'; }),
    close: vi.fn(async () => { ctx.state = 'closed'; }),
    createOscillator: vi.fn(() => { const o = makeOsc(); oscillators.push(o); return o; }),
    createGain: vi.fn(() => ({ gain: param(1), connect: vi.fn(), disconnect: vi.fn() })),
    createDynamicsCompressor: vi.fn(() => ({ connect: vi.fn() })),
  };
  return { ctx: ctx as unknown as AudioContextLike, raw: ctx, oscillators };
}
