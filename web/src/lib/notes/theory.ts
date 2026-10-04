// Music theory for the Notes & Chords lab: note names, pitch, the ratios of an
// interval in just intonation and in equal temperament, and the colours the
// UI shares with the Rust viz. Pure and dependency-free. The flat and sharp
// glyphs live here and nowhere else (a repo test keeps symbol glyphs out of
// the .svelte files).

/** The twelve pitch classes from C, indexed by `midi % 12`. */
export const NOTE_NAMES: readonly string[] = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

/** Pitch class (0..11) of a midi number; the double modulo keeps negatives in range. */
function pitchClass(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

/** `69` → `'A'`: the note's name without its octave. */
export function noteName(midi: number): string {
  return NOTE_NAMES[pitchClass(midi)];
}

/** `60` → `'C4'`: name plus octave, with middle C (midi 60) in octave 4. */
export function noteLabel(midi: number): string {
  return `${noteName(midi)}${Math.floor(midi / 12) - 1}`;
}

/** Concert pitch: midi 69 is 440 Hz, and every twelve semitones doubles it. */
export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/**
 * The 5-limit just-intonation ratio of each semitone interval within an octave
 * (unison to major seventh), in lowest terms. A hand-kept mirror of the Rust
 * table in `crates/viz-core/src/rules/notes.rs`; keep both in sync.
 */
export const JUST_RATIOS: readonly { num: number; den: number }[] = [
  { num: 1, den: 1 },
  { num: 16, den: 15 },
  { num: 9, den: 8 },
  { num: 6, den: 5 },
  { num: 5, den: 4 },
  { num: 4, den: 3 },
  { num: 45, den: 32 },
  { num: 3, den: 2 },
  { num: 8, den: 5 },
  { num: 5, den: 3 },
  { num: 9, den: 5 },
  { num: 15, den: 8 },
];

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * The just ratio of an interval of `semitones` (negative = downward), as a
 * reduced fraction. Octaves wrap the way the Rust side does: the semitones
 * reduce into one octave for the table lookup and each octave left over
 * doubles or halves the result, so 12 is 2/1, 19 is 3/1 and -7 is 2/3.
 */
export function justRatio(semitones: number): { num: number; den: number } {
  const octaves = Math.floor(semitones / 12);
  const base = JUST_RATIOS[semitones - 12 * octaves];
  const num = base.num * 2 ** Math.max(octaves, 0);
  const den = base.den * 2 ** Math.max(-octaves, 0);
  const g = gcd(num, den);
  return { num: num / g, den: den / g };
}

/** Equal temperament, the piano's tuning: every semitone is the same 2^(1/12) step. */
export function etRatio(semitones: number): number {
  return 2 ** (semitones / 12);
}

/** The picker's chips: one octave, C4 to C5 (midi 60 through 72). */
export const PICKER_RANGE: readonly number[] = Array.from({ length: 13 }, (_, i) => 60 + i);

/**
 * The viz colours as hex, for the legend, chips and overlay labels. The Rust
 * visualization's defaults are the source of truth; these copy them.
 */
export const NOTE_COLORS: { bars: readonly [string, string, string]; trail: string; sum: string } = {
  bars: ['#F2B23C', '#F0665C', '#6CC68E'],
  trail: '#F5E6CC',
  sum: '#E6E9EE',
};
