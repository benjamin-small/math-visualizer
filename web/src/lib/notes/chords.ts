// Chord mode for the note picker: the six triads, and the one rule that turns
// a pressed chip into a whole chord. Pure, so the lab page only wires the
// select and the chips to it.
import { PICKER_RANGE } from './theory';

export type ChordId = 'major' | 'minor' | 'diminished' | 'augmented' | 'sus2' | 'sus4';

/** A triad: its share-link id, its name in the picker, and its notes in semitones above the root. */
export type Chord = { id: ChordId; label: string; steps: readonly [number, number, number] };

/** Three notes each, so a chord fills the lab's three bars: root left, then top, then right. */
export const CHORDS: readonly Chord[] = [
  { id: 'major', label: 'Major', steps: [0, 4, 7] },
  { id: 'minor', label: 'Minor', steps: [0, 3, 7] },
  { id: 'diminished', label: 'Diminished', steps: [0, 3, 6] },
  { id: 'augmented', label: 'Augmented', steps: [0, 4, 8] },
  { id: 'sus2', label: 'Sus2', steps: [0, 2, 7] },
  { id: 'sus4', label: 'Sus4', steps: [0, 5, 7] },
];

export function isChordId(value: unknown): value is ChordId {
  return CHORDS.some((c) => c.id === value);
}

export function chordById(id: ChordId): Chord {
  return CHORDS.find((c) => c.id === id)!;
}

/**
 * The chord built upward from `root`, root first, or undefined when the root
 * is not on the picker or the chord would run past its top note.
 */
export function chordOn(root: number, id: ChordId): number[] | undefined {
  const notes = chordById(id).steps.map((s) => root + s);
  return notes.every((n) => PICKER_RANGE.includes(n)) ? notes : undefined;
}
