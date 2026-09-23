// Sonification of the sorting matrix. `planAudio` is the pure part: it diffs
// two consecutive summaries into per-lane events (a tone for a lane that just
// did work, a chime for one that just finished, a rest for one that fell
// silent). `SortingAudio` is the thin Web Audio wrapper that voices those
// events: one persistent oscillator per lane, retriggered every frame the
// lane advanced, behind a master gain and a compressor so 28 voices at once
// stay listenable.
import type { SortingSummary, TouchKind } from './summary';

/** Lowest tone (value 0) and how many octaves the value range spans above it. */
export const BASE_HZ = 110;
export const OCTAVES = 3;

/** Per-voice peak gain by op kind — writes ring a little louder than compares. */
export const TONE_LEVEL: Record<TouchKind, number> = { compare: 0.05, write: 0.09 };

export type AudioEvent =
  | { kind: 'tone'; lane: number; touch: TouchKind; freq: number }
  | { kind: 'chime'; lane: number }
  | { kind: 'rest'; lane: number };

/**
 * Value → pitch, log-spaced so every octave covers the same share of the
 * array: value 0 is `BASE_HZ`, value `size - 1` is `OCTAVES` above it.
 * Values are clamped into range, and a degenerate size pins the base note.
 */
export function pitchOf(value: number, size: number): number {
  if (!(size > 1)) return BASE_HZ;
  const t = Math.min(Math.max(value, 0), size - 1) / (size - 1);
  return BASE_HZ * 2 ** (OCTAVES * t);
}

/**
 * Events to voice for the frame that moved `prev` to `next`. Per lane:
 * a `chime` when it just finished, a `tone` when it is running and its cursor
 * advanced since `prev` (with `prev === null` meaning "any progress at all"),
 * else a `rest`. A lane that finished this frame gets both its final tone
 * and the chime. A null `next` rests every lane `prev` had.
 */
export function planAudio(prev: SortingSummary | null, next: SortingSummary | null): AudioEvent[] {
  const events: AudioEvent[] = [];
  if (next === null) {
    prev?.lanes.forEach((_, lane) => events.push({ kind: 'rest', lane }));
    return events;
  }
  next.lanes.forEach((l, lane) => {
    const before = prev?.lanes[lane];
    const advanced = l.cursor > (before?.cursor ?? 0);
    if (advanced && l.last_kind !== null && l.last_value !== null) {
      events.push({ kind: 'tone', lane, touch: l.last_kind, freq: pitchOf(l.last_value, l.size) });
    } else {
      events.push({ kind: 'rest', lane });
    }
    if (l.done && before !== undefined && !before.done) events.push({ kind: 'chime', lane });
  });
  return events;
}

/** The slice of AudioContext the wrapper uses — lets tests hand in a stub. */
export type AudioContextLike = Pick<
  AudioContext,
  'currentTime' | 'destination' | 'state' | 'resume' | 'close' | 'createOscillator' | 'createGain' | 'createDynamicsCompressor'
>;

export type AudioContextFactory = () => AudioContextLike | null;

/** The browser's AudioContext, or null where there is none (jsdom, old WebKit). */
export const defaultContextFactory: AudioContextFactory = () => {
  const Ctor =
    (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ??
    (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return Ctor ? new Ctor() : null;
};

interface Voice {
  osc: OscillatorNode;
  gain: GainNode;
  sounding: boolean;
}

/**
 * Voices the matrix. Starts muted; `setMuted(false)` from a user gesture
 * creates (and resumes) the context, which autoplay policy requires. Call
 * `update()` once per frame with the latest summary and `destroy()` on
 * unmount.
 */
export class SortingAudio {
  private ctx: AudioContextLike | null = null;
  private master: GainNode | null = null;
  private voices: Voice[] = [];
  private prev: SortingSummary | null = null;
  private _muted = true;
  private _volume: number;

  constructor(
    private readonly createContext: AudioContextFactory = defaultContextFactory,
    volume = 0.5,
  ) {
    this._volume = clamp01(volume);
  }

  get muted(): boolean {
    return this._muted;
  }

  get volume(): number {
    return this._volume;
  }

  /** True once the browser has handed us a context — false where audio is unsupported. */
  get supported(): boolean {
    return this.ctx !== null;
  }

  /** Master volume in [0, 1], applied on a squared curve so the slider feels linear. */
  setVolume(v: number): void {
    this._volume = clamp01(v);
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this._volume ** 2, this.ctx.currentTime, 0.02);
  }

  /** Unmuting from a click/tap is what brings the context up. */
  setMuted(muted: boolean): void {
    this._muted = muted;
    if (!muted) {
      this.ensureContext();
      if (this.ctx?.state === 'suspended') void this.ctx.resume();
    } else {
      this.silenceAll();
    }
  }

  /** Voice the frame that moved from the last summary to `summary`. */
  update(summary: SortingSummary | null): void {
    const events = planAudio(this.prev, summary);
    this.prev = summary;
    if (this._muted || !this.ctx || !this.master) return;
    if (summary && this.voices.length !== summary.lanes.length) this.buildVoices(summary.lanes.length);
    const now = this.ctx.currentTime;
    for (const ev of events) {
      if (ev.kind === 'tone') this.tone(ev.lane, ev.touch, ev.freq, now);
      else if (ev.kind === 'chime') this.chime(now);
      else this.rest(ev.lane, now);
    }
  }

  destroy(): void {
    this.silenceAll();
    for (const v of this.voices) v.osc.stop();
    this.voices = [];
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
  }

  private ensureContext(): void {
    if (this.ctx) return;
    const ctx = this.createContext();
    if (!ctx) return;
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = this._volume ** 2;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp);
    comp.connect(ctx.destination);
    this.master = master;
  }

  private buildVoices(n: number): void {
    if (!this.ctx || !this.master) return;
    for (const v of this.voices) v.osc.stop();
    this.voices = [];
    for (let i = 0; i < n; i++) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      osc.type = 'sine';
      osc.connect(gain);
      gain.connect(this.master);
      osc.start();
      this.voices.push({ osc, gain, sounding: false });
    }
  }

  /** A short blip: slide to the pitch, snap the gain up, let it fall away. */
  private tone(lane: number, touch: TouchKind, freq: number, now: number): void {
    const v = this.voices[lane];
    if (!v) return;
    v.osc.type = touch === 'write' ? 'triangle' : 'sine';
    v.osc.frequency.setTargetAtTime(freq, now, 0.004);
    v.gain.gain.cancelScheduledValues(now);
    v.gain.gain.setTargetAtTime(TONE_LEVEL[touch], now, 0.005);
    v.gain.gain.setTargetAtTime(0, now + 0.04, 0.03);
    v.sounding = true;
  }

  private rest(lane: number, now: number): void {
    const v = this.voices[lane];
    if (!v || !v.sounding) return;
    v.gain.gain.cancelScheduledValues(now);
    v.gain.gain.setTargetAtTime(0, now, 0.01);
    v.sounding = false;
  }

  /** A finished lane: a rising two-note ding on a throwaway oscillator. */
  private chime(now: number): void {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.setValueAtTime(1320, now + 0.09);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.5);
  }

  private silenceAll(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (let i = 0; i < this.voices.length; i++) this.rest(i, now);
  }
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : 0;
}
