// The note picker's rules: up to three notes from the picker's octave, the
// first one picked being the root, plus the share-link spelling of a pick
// (`#/notes?n=60,67`). Pure, so the lab page only wires clicks to it.
import { PICKER_RANGE } from './theory';

export const MIN_NOTES = 0;
export const MAX_NOTES = 3;

/**
 * Click a chip: append a note that is not picked yet, remove one that is (the
 * last one too: an empty pick is allowed). A refusal (a fourth note, a midi
 * number the picker does not offer) returns the same array it was given, so
 * the caller can tell "nothing changed" with `===` and skip the engine push.
 */
export function toggleNote(notes: readonly number[], midi: number): readonly number[] {
  if (!PICKER_RANGE.includes(midi)) return notes;
  if (notes.includes(midi)) return notes.filter((n) => n !== midi);
  return notes.length < MAX_NOTES ? [...notes, midi] : notes;
}

/**
 * Whatever the URL (or anyone) hands us, cut down to a legal pick: integers
 * within the picker, each at most once (first occurrence wins), at most three.
 * May be empty; the caller supplies the default.
 */
export function sanitizeNotes(candidates: readonly number[]): number[] {
  const out: number[] = [];
  for (const c of candidates) {
    if (out.length === MAX_NOTES) break;
    if (PICKER_RANGE.includes(c) && !out.includes(c)) out.push(c);
  }
  return out;
}

/**
 * The `n` query parameter: comma-separated decimal midi numbers, `'60,67'` to
 * `[60, 67]`, or `'none'` for an empty pick. Tokens that are not plain digits
 * (Number() would also take `'0x3C'` and `'6e1'`) and numbers outside the
 * picker are dropped; `undefined` when nothing valid is left.
 */
export function parseNotesParam(raw: string | null): number[] | undefined {
  if (raw === null) return undefined;
  if (raw.trim() === 'none') return [];
  const numbers = raw.split(',').map((t) => {
    const token = t.trim();
    return /^\d+$/.test(token) ? Number(token) : NaN;
  });
  const notes = sanitizeNotes(numbers);
  return notes.length > 0 ? notes : undefined;
}

/** `[60, 67]` to `'60,67'` (the router keeps the commas raw); an empty pick is `'none'`. */
export function formatNotesParam(notes: readonly number[]): string {
  return notes.length === 0 ? 'none' : notes.join(',');
}
