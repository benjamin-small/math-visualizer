import { describe, it, expect, vi } from 'vitest';
import { pitchOf, planAudio, SortingAudio, BASE_HZ, OCTAVES, TONE_LEVEL, type AudioContextLike } from '../audio';
import type { LaneSummary, SortingSummary } from '../summary';

function lane(patch: Partial<LaneSummary> = {}): LaneSummary {
  return {
    algorithm: 'bubble',
    dataset: 'random',
    compares: 0,
    writes: 0,
    cursor: 0,
    total: 100,
    running: false,
    done: false,
    size: 50,
    last_kind: null,
    last_value: null,
    ...patch,
  };
}

function grid(lanes: LaneSummary[]): SortingSummary {
  return { rows: 1, cols: lanes.length, tick: 0, all_done: lanes.every((l) => l.done), lanes };
}

describe('pitchOf', () => {
  it('maps the 1..=size value range onto OCTAVES octaves above BASE_HZ, log-spaced', () => {
    expect(pitchOf(1, 50)).toBe(BASE_HZ);
    expect(pitchOf(50, 50)).toBeCloseTo(BASE_HZ * 2 ** OCTAVES);
    // The midpoint of a 3-octave span is 1.5 octaves up.
    expect(pitchOf(50.5, 100)).toBeCloseTo(BASE_HZ * 2 ** 1.5);
    // Adjacent top values are distinct notes, not both clamped to the ceiling.
    expect(pitchOf(9, 10)).toBeLessThan(pitchOf(10, 10));
  });

  it('clamps out-of-range values and pins the base note for a degenerate size', () => {
    expect(pitchOf(0, 50)).toBe(BASE_HZ);
    expect(pitchOf(-5, 50)).toBe(BASE_HZ);
    expect(pitchOf(500, 50)).toBeCloseTo(BASE_HZ * 2 ** OCTAVES);
    expect(pitchOf(1, 1)).toBe(BASE_HZ);
    expect(pitchOf(3, 0)).toBe(BASE_HZ);
  });
});

describe('planAudio', () => {
  it('rests every stopped lane when nothing has moved', () => {
    const s = grid([lane(), lane()]);
    expect(planAudio(s, s)).toEqual([
      { kind: 'rest', lane: 0 },
      { kind: 'rest', lane: 1 },
    ]);
  });

  it('leaves a running lane alone between ops, so its last blip rings out', () => {
    const s = grid([lane({ running: true, cursor: 5, last_kind: 'compare', last_value: 3 })]);
    expect(planAudio(s, s)).toEqual([]);
  });

  it('rests a lane the moment it is paused', () => {
    const on = grid([lane({ running: true, cursor: 5, last_kind: 'compare', last_value: 3 })]);
    const off = grid([lane({ running: false, cursor: 5, last_kind: 'compare', last_value: 3 })]);
    expect(planAudio(on, off)).toEqual([{ kind: 'rest', lane: 0 }]);
  });

  it('treats a cursor going backwards (reset, restart, resize) as a rest with no chime', () => {
    const late = grid([lane({ running: true, cursor: 80, last_kind: 'write', last_value: 9 })]);
    const rewound = grid([lane({ running: false, cursor: 0 })]);
    expect(planAudio(late, rewound)).toEqual([{ kind: 'rest', lane: 0 }]);
    const finished = grid([lane({ done: true, cursor: 100, last_kind: 'write', last_value: 9 })]);
    expect(planAudio(finished, rewound)).toEqual([{ kind: 'rest', lane: 0 }]);
  });

  it('voices a lane whose cursor advanced, at the pitch of the value it touched', () => {
    const before = grid([lane({ running: true, cursor: 3, last_kind: 'compare', last_value: 10 })]);
    const after = grid([lane({ running: true, cursor: 4, last_kind: 'write', last_value: 49 })]);
    expect(planAudio(before, after)).toEqual([
      { kind: 'tone', lane: 0, touch: 'write', freq: pitchOf(49, 50) },
    ]);
  });

  it('treats a missing previous frame as "any progress counts"', () => {
    const s = grid([
      lane({ running: true, cursor: 1, last_kind: 'compare', last_value: 1 }),
      lane({ running: true, cursor: 0 }),
    ]);
    expect(planAudio(null, s)).toEqual([
      { kind: 'tone', lane: 0, touch: 'compare', freq: BASE_HZ },
    ]);
  });

  it('stays silent for a lane that reports progress but no last op', () => {
    const s = grid([lane({ running: true, cursor: 5 })]);
    expect(planAudio(null, s)).toEqual([]);
  });

  it('chimes once when a lane flips to done, alongside its final tone', () => {
    const before = grid([lane({ running: true, cursor: 99, last_kind: 'compare', last_value: 1 })]);
    const after = grid([lane({ running: false, done: true, cursor: 100, last_kind: 'write', last_value: 2 })]);
    expect(planAudio(before, after)).toEqual([
      { kind: 'tone', lane: 0, touch: 'write', freq: pitchOf(2, 50) },
      { kind: 'chime', lane: 0 },
    ]);
    // Still done next frame: no second chime, no tone, and the stopped lane rests.
    expect(planAudio(after, after)).toEqual([{ kind: 'rest', lane: 0 }]);
  });

  it('does not chime for a lane that was already done on the first frame it sees', () => {
    const s = grid([lane({ done: true, cursor: 100, last_kind: 'write', last_value: 2 })]);
    expect(planAudio(null, s)).toEqual([{ kind: 'tone', lane: 0, touch: 'write', freq: pitchOf(2, 50) }]);
  });

  it('rests every previously known lane when the summary goes away', () => {
    const s = grid([lane(), lane(), lane()]);
    expect(planAudio(s, null)).toEqual([
      { kind: 'rest', lane: 0 },
      { kind: 'rest', lane: 1 },
      { kind: 'rest', lane: 2 },
    ]);
    expect(planAudio(null, null)).toEqual([]);
  });
});

// ---- Web Audio wrapper, against a stub context ----------------------------

function param(value = 0) {
  return {
    value,
    setValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  };
}

function makeStubContext() {
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

describe('SortingAudio', () => {
  it('starts muted and does not touch the browser until unmuted', () => {
    const factory = vi.fn(() => makeStubContext().ctx);
    const audio = new SortingAudio(factory);
    expect(audio.muted).toBe(true);
    expect(audio.supported).toBe(false);
    audio.update(grid([lane({ running: true, cursor: 1, last_kind: 'write', last_value: 3 })]));
    expect(factory).not.toHaveBeenCalled();
  });

  it('unmuting creates and resumes the context; muting again silences the voices', () => {
    const stub = makeStubContext();
    const audio = new SortingAudio(() => stub.ctx);
    audio.setMuted(false);
    expect(audio.supported).toBe(true);
    expect(stub.raw.resume).toHaveBeenCalledTimes(1);
    expect(stub.raw.createDynamicsCompressor).toHaveBeenCalledTimes(1);

    audio.update(grid([lane({ running: true, cursor: 1, last_kind: 'write', last_value: 3 })]));
    expect(stub.oscillators).toHaveLength(1); // one voice per lane
    const voice = stub.oscillators[0];
    expect(voice.start).toHaveBeenCalledTimes(1);
    expect(voice.type).toBe('triangle'); // writes use the brighter wave
    expect(voice.frequency.setTargetAtTime).toHaveBeenCalledWith(pitchOf(3, 50), 1, expect.any(Number));

    audio.setMuted(true);
    // The voice's gain was driven to 0 when muting.
    const gains = (stub.raw.createGain.mock.results as { value: { gain: ReturnType<typeof param> } }[]).map((r) => r.value.gain);
    const voiceGain = gains[1]; // gains[0] is the master
    expect(voiceGain.setTargetAtTime).toHaveBeenLastCalledWith(0, 1, expect.any(Number));
  });

  it('keeps the frame diff going while muted, so unmuting does not replay old progress', () => {
    const stub = makeStubContext();
    const audio = new SortingAudio(() => stub.ctx);
    const moving = grid([lane({ running: true, cursor: 5, last_kind: 'compare', last_value: 3 })]);
    audio.update(moving); // muted: remembered, not voiced
    audio.setMuted(false);
    audio.update(moving); // same cursor as last frame → a rest, not a tone
    expect(stub.oscillators[0].frequency.setTargetAtTime).not.toHaveBeenCalled();
  });

  it('plays a throwaway chime oscillator when a lane finishes', () => {
    const stub = makeStubContext();
    const audio = new SortingAudio(() => stub.ctx);
    audio.setMuted(false);
    audio.update(grid([lane({ running: true, cursor: 99, last_kind: 'compare', last_value: 1 })]));
    expect(stub.oscillators).toHaveLength(1);
    audio.update(grid([lane({ done: true, cursor: 100, last_kind: 'write', last_value: 2 })]));
    expect(stub.oscillators).toHaveLength(2);
    const chime = stub.oscillators[1];
    expect(chime.start).toHaveBeenCalledWith(1);
    expect(chime.stop).toHaveBeenCalledWith(1.5);
    expect(chime.frequency.setValueAtTime).toHaveBeenCalledWith(880, 1);
    // The throwaway nodes unhook themselves once the chime has played out.
    expect(chime.onended).toEqual(expect.any(Function));
    chime.onended!();
    expect(chime.disconnect).toHaveBeenCalledTimes(1);
  });

  it('applies volume on a squared curve and clamps it', () => {
    const stub = makeStubContext();
    const audio = new SortingAudio(() => stub.ctx, 0.5);
    audio.setMuted(false);
    const master = (stub.raw.createGain.mock.results[0] as { value: { gain: ReturnType<typeof param> } }).value.gain;
    expect(master.value).toBeCloseTo(0.25);
    audio.setVolume(1.7);
    expect(audio.volume).toBe(1);
    expect(master.setTargetAtTime).toHaveBeenLastCalledWith(1, 1, expect.any(Number));
    audio.setVolume(NaN);
    expect(audio.volume).toBe(0);
  });

  it('reports unsupported (and stays quiet) when the browser has no AudioContext', () => {
    const audio = new SortingAudio(() => null);
    audio.setMuted(false);
    expect(audio.supported).toBe(false);
    expect(() => audio.update(grid([lane({ running: true, cursor: 1, last_kind: 'write', last_value: 3 })]))).not.toThrow();
  });

  it('destroy stops every voice and closes the context', () => {
    const stub = makeStubContext();
    const audio = new SortingAudio(() => stub.ctx);
    audio.setMuted(false);
    audio.update(grid([lane({ running: true, cursor: 1, last_kind: 'write', last_value: 3 }), lane()]));
    audio.destroy();
    expect(stub.oscillators.every((o) => o.stop.mock.calls.length === 1)).toBe(true);
    expect(stub.raw.close).toHaveBeenCalledTimes(1);
    expect(audio.supported).toBe(false);
  });

  it('exposes the per-kind levels the tone envelope uses', () => {
    expect(TONE_LEVEL.write).toBeGreaterThan(TONE_LEVEL.compare);
  });
});
