// The Web Audio plumbing the sorting and notes labs share: the slice of
// AudioContext they use (so tests can hand in a stub), the factory that makes
// one, and the 0..1 clamp both apply to volume.

/** The slice of AudioContext the wrappers use — lets tests hand in a stub. */
export type AudioContextLike = Pick<
  AudioContext,
  'currentTime' | 'destination' | 'state' | 'resume' | 'close' | 'createOscillator' | 'createGain' | 'createDynamicsCompressor'
>;

export type AudioContextFactory = () => AudioContextLike | null;

/** The browser's AudioContext, or null where there is none (jsdom, old WebKit). */
export const defaultContextFactory: AudioContextFactory = () => {
  const g = globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  return Ctor ? new Ctor() : null;
};

/** `v` limited to [0, 1]; NaN and the infinities become 0. */
export function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : 0;
}
