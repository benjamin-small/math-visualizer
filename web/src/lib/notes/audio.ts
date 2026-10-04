// Sonification of the Notes lab. The engine's playback speed is the root note's
// swings per second, so once the swings pass about twenty a second the motion
// is a pitch: each note then sounds at speed x ratio. `voicePlan` is the pure
// part (what every note's voice should be doing this frame); `NotesAudio` is
// the thin Web Audio wrapper that voices it: one persistent sine oscillator
// per note behind its own gain, then a master gain and a compressor.
import { clamp01, defaultContextFactory, type AudioContextFactory, type AudioContextLike } from '../audio/context';

/** The loudness all voices share; each of n notes gets VOICE_LEVEL / n, so a chord is no louder than one note. */
export const VOICE_LEVEL = 0.18;
/** Below this many swings per second the motion is too slow to hear as a tone. */
export const AUDIBLE_FROM_HZ = 20;
/** From here up the tone is at full level; between the two it fades in. */
export const AUDIBLE_FULL_HZ = 30;

/** How much of the tone to let through at this swing rate: 0 up to 20 Hz, 1 from 30 Hz, a straight fade between. */
export function audibility(speedHz: number): number {
  return clamp01((speedHz - AUDIBLE_FROM_HZ) / (AUDIBLE_FULL_HZ - AUDIBLE_FROM_HZ));
}

/** What one voice's oscillator should be doing: its pitch in Hz and its gain. */
export interface VoiceTarget {
  freq: number;
  gain: number;
}

/** What the page hands `NotesAudio.update` every frame. */
export interface NotesFrame {
  playing: boolean;
  /** The root note's swings per second: the engine's playback speed. */
  speedHz: number;
  /** One frequency ratio to the root per note, in bar order. */
  ratios: readonly number[];
}

/**
 * The voices for a frame, one per ratio. Each sounds at `speedHz * ratio`; the
 * gain is the shared level split evenly, faded in by `audibility`, and 0 while
 * paused or muted. The pitch is always reported, so a voice that is silent
 * (slow, paused, muted) is already at the right pitch when it comes in.
 */
export function voicePlan(speedHz: number, ratios: readonly number[], playing: boolean, muted: boolean): VoiceTarget[] {
  if (ratios.length === 0) return [];
  const gain = playing && !muted ? (VOICE_LEVEL / ratios.length) * audibility(speedHz) : 0;
  return ratios.map((ratio) => ({ freq: speedHz * ratio, gain }));
}

/** AudioParam time constants, in seconds: a pitch settles in a few tens of ms, a gain a little slower. */
const FREQ_TAU = 0.01;
const GAIN_TAU = 0.02;

interface Voice {
  osc: OscillatorNode;
  gain: GainNode;
  /** What was last sent to this voice's pitch and gain (null before the first send), so `update` only touches a param whose target moved. */
  freq: number | null;
  level: number | null;
}

/**
 * Voices the notes. Starts muted; `setMuted(false)` from a user gesture creates
 * (and resumes) the context, which autoplay policy requires. Call `update()`
 * once per frame and `destroy()` on unmount.
 */
export class NotesAudio {
  private ctx: AudioContextLike | null = null;
  private master: GainNode | null = null;
  private voices: Voice[] = [];
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
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this._volume ** 2, this.ctx.currentTime, GAIN_TAU);
  }

  /** Unmuting from a click/tap is what brings the context up; muting silences the voices at once. */
  setMuted(muted: boolean): void {
    this._muted = muted;
    if (!muted) {
      this.ensureContext();
      if (this.ctx?.state === 'suspended') void this.ctx.resume();
    } else {
      this.silenceAll();
    }
  }

  /**
   * Voice one frame. Does nothing until the context exists (so a muted page
   * never touches the browser's audio). Rebuilds the voices when the number of
   * notes changes, then sends each voice's pitch and gain only if it differs
   * from what that voice was last sent.
   */
  update(frame: NotesFrame): void {
    if (!this.ctx || !this.master) return;
    if (this.voices.length !== frame.ratios.length) this.buildVoices(frame.ratios.length);
    const now = this.ctx.currentTime;
    voicePlan(frame.speedHz, frame.ratios, frame.playing, this._muted).forEach((target, i) => {
      const v = this.voices[i];
      if (target.freq !== v.freq) {
        v.osc.frequency.setTargetAtTime(target.freq, now, FREQ_TAU);
        v.freq = target.freq;
      }
      this.setLevel(v, target.gain, now);
    });
  }

  destroy(): void {
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

  /** Replace every voice with `n` fresh ones: silent sines, with nothing sent to them yet. */
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
      this.voices.push({ osc, gain, freq: null, level: null });
    }
  }

  private setLevel(v: Voice, level: number, now: number): void {
    if (level === v.level) return;
    v.gain.gain.setTargetAtTime(level, now, GAIN_TAU);
    v.level = level;
  }

  private silenceAll(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const v of this.voices) this.setLevel(v, 0, now);
  }
}
