// The Notes lab's speed control. The engine's playback speed is the root
// note's swings per second, so the slider covers a wide range (0.25 Hz, one
// swing every four seconds, up to 1000 Hz, a tone) on a log scale: every
// octave of speed gets the same slice of travel.
import { clamp01 } from '../audio/context';

export const MIN_HZ = 0.25;
export const MAX_HZ = 1000;
/** How long the "Real pitch" button takes to speed up to the note's frequency. */
export const RAMP_MS = 2500;
/** Slow enough to watch one swing at a time. */
export const DEFAULT_SPEED_HZ = 0.5;

/** The ratio between the slowest and fastest speed: the slider's log range. */
const SPAN = MAX_HZ / MIN_HZ;

/** Never ramp up from nothing: a start of 0 would make the ratio infinite. */
const RAMP_FLOOR_HZ = 0.01;

/** Slider position in [0, 1] to swings per second, log-spaced; positions outside the slider clamp. */
export function sliderToHz(t: number): number {
  return MIN_HZ * SPAN ** clamp01(t);
}

/** Swings per second back to a slider position, clamped to [0, 1]. */
export function hzToSlider(hz: number): number {
  return clamp01(Math.log(hz / MIN_HZ) / Math.log(SPAN));
}

/** The mono readout: two decimals below 10 Hz, one below 100, none above. */
export function formatHz(hz: number): string {
  const decimals = hz < 10 ? 2 : hz < 100 ? 1 : 0;
  return `${hz.toFixed(decimals)} Hz`;
}

/**
 * The speed `t` (clamped to [0, 1]) of the way through a ramp from `from` to
 * `to`. Exponential, so the pitch rises at an even musical rate and the ramp
 * does not spend all its time in the top octave; `from` is floored at 0.01.
 */
export function rampSpeedAt(from: number, to: number, t: number): number {
  const start = Math.max(from, RAMP_FLOOR_HZ);
  return start * (to / start) ** clamp01(t);
}
