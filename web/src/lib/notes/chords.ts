// Chord mode for the note picker: the six triads and five sevenths, and the one rule that turns
// a pressed chip into a whole chord. Pure, so the lab page only wires the
// select and the chips to it.
import { PICKER_RANGE } from './theory';

export type ChordId =
  | 'major' | 'minor' | 'diminished' | 'augmented' | 'sus2' | 'sus4'
  | 'dom7' | 'maj7' | 'min7' | 'halfdim7' | 'dim7';

/** A chord: its share-link id, its name in the picker, its row, and its notes in semitones above the root. */
export type Chord = { id: ChordId; label: string; group: 'triad' | 'seventh'; steps: readonly number[] };

/** Triads fill three bars and sevenths all four: root left, then top, right and bottom. */
export const CHORDS: readonly Chord[] = [
  { id: 'major', label: 'Major', group: 'triad', steps: [0, 4, 7] },
  { id: 'minor', label: 'Minor', group: 'triad', steps: [0, 3, 7] },
  { id: 'diminished', label: 'Diminished', group: 'triad', steps: [0, 3, 6] },
  { id: 'augmented', label: 'Augmented', group: 'triad', steps: [0, 4, 8] },
  { id: 'sus2', label: 'Sus2', group: 'triad', steps: [0, 2, 7] },
  { id: 'sus4', label: 'Sus4', group: 'triad', steps: [0, 5, 7] },
  { id: 'dom7', label: 'Dom7', group: 'seventh', steps: [0, 4, 7, 10] },
  { id: 'maj7', label: 'Maj7', group: 'seventh', steps: [0, 4, 7, 11] },
  { id: 'min7', label: 'Min7', group: 'seventh', steps: [0, 3, 7, 10] },
  { id: 'halfdim7', label: 'Half-dim7', group: 'seventh', steps: [0, 3, 6, 10] },
  { id: 'dim7', label: 'Dim7', group: 'seventh', steps: [0, 3, 6, 9] },
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
