import { describe, it, expect, vi } from 'vitest';
import {
  VOICE_LEVEL,
  AUDIBLE_FROM_HZ,
  AUDIBLE_FULL_HZ,
  audibility,
  voicePlan,
  NotesAudio,
  type NotesFrame,
} from '../audio';
import { param, makeStubContext } from '../../test/stubAudio';

describe('constants', () => {
  it('fade the sound in between 20 and 30 swings per second, at a combined level of 0.18', () => {
    expect(AUDIBLE_FROM_HZ).toBe(20);
    expect(AUDIBLE_FULL_HZ).toBe(30);
    expect(VOICE_LEVEL).toBe(0.18);
  });
});

describe('audibility', () => {
  it('is silent up to 20 swings per second, full from 30, and a straight fade between', () => {
    expect(audibility(10)).toBe(0);
    expect(audibility(20)).toBe(0);
    expect(audibility(25)).toBe(0.5);
    expect(audibility(30)).toBe(1);
    expect(audibility(400)).toBe(1);
  });

  it('is silent for a speed that is not a number', () => {
    expect(audibility(NaN)).toBe(0);
  });
});

describe('voicePlan', () => {
  it('gives each note a voice at speed x ratio, sharing the level between them', () => {
    expect(voicePlan(440, [1, 1.5], true, false)).toEqual([
      { freq: 440, gain: VOICE_LEVEL / 2 },
      { freq: 660, gain: VOICE_LEVEL / 2 },
    ]);
  });

  it('splits the level so any number of notes totals the same loudness', () => {
    for (const ratios of [[1], [1, 1.5], [1, 1.25, 1.5]]) {
      const plan = voicePlan(440, ratios, true, false);
      expect(plan).toHaveLength(ratios.length);
      expect(plan.reduce((total, v) => total + v.gain, 0)).toBeCloseTo(VOICE_LEVEL, 12);
    }
    expect(voicePlan(440, [1, 1.25, 1.5], true, false).map((v) => v.gain)).toEqual([
      VOICE_LEVEL / 3,
      VOICE_LEVEL / 3,
      VOICE_LEVEL / 3,
    ]);
  });

  it('is silent below the audible rate but still reports the pitch each voice would have', () => {
    expect(voicePlan(15, [1, 1.5], true, false)).toEqual([
      { freq: 15, gain: 0 },
      { freq: 22.5, gain: 0 },
    ]);
  });

  it('fades in across the audible threshold', () => {
    expect(voicePlan(25, [1], true, false)[0].gain).toBeCloseTo(VOICE_LEVEL * 0.5, 12);
  });

  it('is silent while paused, keeping the pitches', () => {
    expect(voicePlan(440, [1, 1.5], false, false)).toEqual([
      { freq: 440, gain: 0 },
      { freq: 660, gain: 0 },
    ]);
  });

  it('is silent while muted, keeping the pitches', () => {
    expect(voicePlan(440, [1, 1.5], true, true)).toEqual([
      { freq: 440, gain: 0 },
      { freq: 660, gain: 0 },
    ]);
  });

  it('has no voices for no notes', () => {
    expect(voicePlan(440, [], true, false)).toEqual([]);
  });
});

// ---- Web Audio wrapper, against a stub context ----------------------------

type StubGain = { gain: ReturnType<typeof param>; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> };
type Stub = ReturnType<typeof makeStubContext>;

/** Every gain node the wrapper has made, in creation order: the master first, then one per voice. */
function gainNodes(stub: Stub): StubGain[] {
  return (stub.raw.createGain.mock.results as { value: StubGain }[]).map((r) => r.value);
}

/** Per voice ever built, in creation order, the `setTargetAtTime` calls sent to its frequency and to its gain. */
function sent(stub: Stub) {
  const nodes = gainNodes(stub);
  return stub.oscillators.map((o, i) => ({
    freq: o.frequency.setTargetAtTime.mock.calls,
    gain: nodes[i + 1].gain.setTargetAtTime.mock.calls,
  }));
}

function frame(patch: Partial<NotesFrame> = {}): NotesFrame {
  return { playing: true, speedHz: 440, ratios: [1, 1.5], ...patch };
}

/** An unmuted NotesAudio over a fresh stub, as it is once the user has clicked Sound. */
function unmuted(volume?: number) {
  const stub = makeStubContext();
  const audio = new NotesAudio(() => stub.ctx, volume);
  audio.setMuted(false);
  return { stub, audio };
}

describe('NotesAudio', () => {
  it('starts muted and does not touch the browser until unmuted', () => {
    const factory = vi.fn(() => makeStubContext().ctx);
    const audio = new NotesAudio(factory);
    expect(audio.muted).toBe(true);
    expect(audio.supported).toBe(false);
    audio.update(frame());
    expect(factory).not.toHaveBeenCalled();
    expect(audio.supported).toBe(false);
  });

  it('unmuting creates and resumes the context, once, behind a master gain and a compressor', () => {
    const stub = makeStubContext();
    const factory = vi.fn(() => stub.ctx);
    const audio = new NotesAudio(factory);
    audio.setMuted(false);
    expect(audio.muted).toBe(false);
    expect(audio.supported).toBe(true);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(stub.raw.resume).toHaveBeenCalledTimes(1);
    expect(stub.raw.createDynamicsCompressor).toHaveBeenCalledTimes(1);

    const master = gainNodes(stub)[0];
    const compressor = (stub.raw.createDynamicsCompressor.mock.results[0] as { value: { connect: ReturnType<typeof vi.fn> } }).value;
    expect(master.connect).toHaveBeenCalledWith(compressor);
    expect(compressor.connect).toHaveBeenCalledWith(stub.raw.destination);

    // Muting and unmuting again reuses the same context.
    audio.setMuted(true);
    audio.setMuted(false);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(stub.raw.createDynamicsCompressor).toHaveBeenCalledTimes(1);
    expect(stub.raw.resume).toHaveBeenCalledTimes(1);
  });

  it('builds one silent sine oscillator per note, each behind its own gain into the master', () => {
    const { stub, audio } = unmuted();
    audio.update(frame());
    expect(stub.oscillators).toHaveLength(2);
    const nodes = gainNodes(stub);
    expect(nodes).toHaveLength(3); // master + two voices
    stub.oscillators.forEach((o, i) => {
      expect(o.type).toBe('sine');
      expect(o.start).toHaveBeenCalledTimes(1);
      expect(o.stop).not.toHaveBeenCalled();
      expect(o.connect).toHaveBeenCalledWith(nodes[i + 1]);
      expect(nodes[i + 1].connect).toHaveBeenCalledWith(nodes[0]);
      expect(nodes[i + 1].gain.value).toBe(0); // starts silent
    });
  });

  it('sends each voice its planned pitch and gain, gliding on a short time constant', () => {
    const { stub, audio } = unmuted();
    audio.update(frame());
    const [low, high] = stub.oscillators;
    const [, lowGain, highGain] = gainNodes(stub);
    expect(low.frequency.setTargetAtTime).toHaveBeenCalledTimes(1);
    expect(low.frequency.setTargetAtTime).toHaveBeenCalledWith(440, 1, 0.01);
    expect(high.frequency.setTargetAtTime).toHaveBeenCalledWith(660, 1, 0.01);
    expect(lowGain.gain.setTargetAtTime).toHaveBeenCalledTimes(1);
    expect(lowGain.gain.setTargetAtTime).toHaveBeenCalledWith(VOICE_LEVEL / 2, 1, 0.02);
    expect(highGain.gain.setTargetAtTime).toHaveBeenCalledWith(VOICE_LEVEL / 2, 1, 0.02);
  });

  it('adds no calls for a frame that changes nothing', () => {
    const { stub, audio } = unmuted();
    audio.update(frame());
    const before = JSON.stringify(sent(stub));
    audio.update(frame());
    audio.update(frame());
    expect(JSON.stringify(sent(stub))).toBe(before);
    expect(stub.oscillators).toHaveLength(2);
  });

  it('touches only the param whose target changed', () => {
    const { stub, audio } = unmuted();
    audio.update(frame());
    // A speed change moves the pitches but not the (already full) audibility.
    audio.update(frame({ speedHz: 441 }));
    let calls = sent(stub);
    expect(calls.map((c) => c.freq.length)).toEqual([2, 2]);
    expect(calls.map((c) => c.gain.length)).toEqual([1, 1]);
    expect(stub.oscillators[1].frequency.setTargetAtTime).toHaveBeenLastCalledWith(441 * 1.5, 1, 0.01);
    // Pausing silences the gains but leaves the pitches alone.
    audio.update(frame({ speedHz: 441, playing: false }));
    calls = sent(stub);
    expect(calls.map((c) => c.freq.length)).toEqual([2, 2]);
    expect(calls.map((c) => c.gain.length)).toEqual([2, 2]);
    expect(gainNodes(stub)[1].gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 1, 0.02);
  });

  it('follows the speed below the audible rate without making a sound', () => {
    const { stub, audio } = unmuted();
    audio.update(frame({ speedHz: 15 }));
    expect(stub.oscillators[0].frequency.setTargetAtTime).toHaveBeenLastCalledWith(15, 1, 0.01);
    expect(stub.oscillators[1].frequency.setTargetAtTime).toHaveBeenLastCalledWith(22.5, 1, 0.01);
    for (const c of sent(stub)) expect(c.gain.every((args) => args[0] === 0)).toBe(true);
    // Speeding up past the threshold brings the voices in.
    audio.update(frame({ speedHz: 440 }));
    expect(gainNodes(stub)[1].gain.setTargetAtTime).toHaveBeenLastCalledWith(VOICE_LEVEL / 2, 1, 0.02);
  });

  it('rebuilds the voices when the number of notes changes, stopping the old ones', () => {
    const { stub, audio } = unmuted();
    audio.update(frame());
    audio.update(frame({ ratios: [1, 1.25, 1.5] }));
    expect(stub.oscillators).toHaveLength(5);
    const [old0, old1, ...fresh] = stub.oscillators;
    expect(old0.stop).toHaveBeenCalledTimes(1);
    expect(old1.stop).toHaveBeenCalledTimes(1);
    for (const o of fresh) {
      expect(o.type).toBe('sine');
      expect(o.start).toHaveBeenCalledTimes(1);
      expect(o.stop).not.toHaveBeenCalled();
    }
    // New voices are sent their targets even where they equal the old voices' last values.
    expect(fresh[0].frequency.setTargetAtTime).toHaveBeenCalledWith(440, 1, 0.01);
    expect(fresh[1].frequency.setTargetAtTime).toHaveBeenCalledWith(550, 1, 0.01);
    expect(fresh[2].frequency.setTargetAtTime).toHaveBeenCalledWith(660, 1, 0.01);
    expect(gainNodes(stub)[3].gain.setTargetAtTime).toHaveBeenCalledWith(VOICE_LEVEL / 3, 1, 0.02);

    // And back down to two, then to none.
    audio.update(frame());
    expect(stub.oscillators).toHaveLength(7);
    expect(fresh.every((o) => o.stop.mock.calls.length === 1)).toBe(true);
    audio.update(frame({ ratios: [] }));
    expect(stub.oscillators).toHaveLength(7);
    expect(stub.oscillators.slice(5).every((o) => o.stop.mock.calls.length === 1)).toBe(true);
  });

  it('muting drives every voice to silence at once, and the frames that follow stay quiet', () => {
    const { stub, audio } = unmuted();
    audio.update(frame());
    audio.setMuted(true);
    const [, ...voices] = gainNodes(stub);
    for (const v of voices) expect(v.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 1, 0.02);

    const before = JSON.stringify(sent(stub));
    audio.update(frame()); // still playing, still fast: but muted
    expect(JSON.stringify(sent(stub))).toBe(before);

    audio.setMuted(false);
    audio.update(frame());
    for (const v of voices) expect(v.gain.setTargetAtTime).toHaveBeenLastCalledWith(VOICE_LEVEL / 2, 1, 0.02);
  });

  it('applies volume on a squared curve and clamps it', () => {
    const { stub, audio } = unmuted(0.5);
    const master = gainNodes(stub)[0].gain;
    expect(master.value).toBeCloseTo(0.25);
    audio.setVolume(1.7);
    expect(audio.volume).toBe(1);
    expect(master.setTargetAtTime).toHaveBeenLastCalledWith(1, 1, expect.any(Number));
    audio.setVolume(0.6);
    expect(master.setTargetAtTime).toHaveBeenLastCalledWith(0.6 ** 2, 1, expect.any(Number));
    audio.setVolume(NaN);
    expect(audio.volume).toBe(0);
  });

  it('defaults to half volume and clamps the volume it is built with', () => {
    expect(new NotesAudio(() => null).volume).toBe(0.5);
    expect(new NotesAudio(() => null, 3).volume).toBe(1);
    expect(new NotesAudio(() => null, -1).volume).toBe(0);
  });

  it('remembers a volume set before the context exists', () => {
    const stub = makeStubContext();
    const audio = new NotesAudio(() => stub.ctx);
    audio.setVolume(0.8);
    audio.setMuted(false);
    expect(gainNodes(stub)[0].gain.value).toBeCloseTo(0.64);
  });

  it('reports unsupported, and stays quiet, when the browser has no AudioContext', () => {
    const audio = new NotesAudio(() => null);
    audio.setMuted(false);
    expect(audio.supported).toBe(false);
    expect(() => audio.update(frame())).not.toThrow();
    expect(() => audio.setVolume(0.3)).not.toThrow();
    expect(() => audio.setMuted(true)).not.toThrow();
    expect(() => audio.destroy()).not.toThrow();
  });

  it('destroy stops every live voice, once, and closes the context', () => {
    const { stub, audio } = unmuted();
    audio.update(frame());
    audio.update(frame({ ratios: [1, 1.25, 1.5] })); // the first two were stopped by the rebuild
    audio.destroy();
    expect(stub.oscillators).toHaveLength(5);
    expect(stub.oscillators.every((o) => o.stop.mock.calls.length === 1)).toBe(true);
    expect(stub.raw.close).toHaveBeenCalledTimes(1);
    expect(audio.supported).toBe(false);

    // Safe to call again, and later frames go nowhere.
    audio.destroy();
    expect(() => audio.update(frame())).not.toThrow();
    expect(stub.raw.close).toHaveBeenCalledTimes(1);
    expect(stub.oscillators).toHaveLength(5);
  });

  it('destroy is harmless before the context was ever created', () => {
    const audio = new NotesAudio(() => makeStubContext().ctx);
    expect(() => audio.destroy()).not.toThrow();
  });
});
