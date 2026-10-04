import { describe, it, expect } from 'vitest';
import {
  MIN_NOTES,
  MAX_NOTES,
  toggleNote,
  sanitizeNotes,
  parseNotesParam,
  formatNotesParam,
} from '../picker';

describe('limits', () => {
  it('allows one to three notes', () => {
    expect(MIN_NOTES).toBe(1);
    expect(MAX_NOTES).toBe(3);
  });
});

describe('toggleNote', () => {
  it('appends a note that is not picked yet, after the others', () => {
    expect(toggleNote([60], 64)).toEqual([60, 64]);
    expect(toggleNote([67, 60], 64)).toEqual([67, 60, 64]); // the first pick stays the root
  });

  it('removes a note that is already picked, keeping the order of the rest', () => {
    expect(toggleNote([60, 64, 67], 64)).toEqual([60, 67]);
    expect(toggleNote([67, 60, 64], 60)).toEqual([67, 64]);
    expect(toggleNote([60, 64], 60)).toEqual([64]);
  });

  it('refuses a fourth note, handing back the very same array', () => {
    const three = [60, 64, 67];
    expect(toggleNote(three, 69)).toBe(three);
  });

  it('refuses to remove the only note, handing back the very same array', () => {
    const one = [60];
    expect(toggleNote(one, 60)).toBe(one);
  });

  it('refuses a midi number outside the picker, handing back the very same array', () => {
    const one = [60];
    expect(toggleNote(one, 59)).toBe(one);
    expect(toggleNote(one, 73)).toBe(one);
    expect(toggleNote(one, 61.5)).toBe(one);
    expect(toggleNote(one, NaN)).toBe(one);
  });

  it('never mutates its input', () => {
    const notes = Object.freeze([60, 64]);
    expect(() => toggleNote(notes, 67)).not.toThrow();
    expect(() => toggleNote(notes, 64)).not.toThrow();
    expect(notes).toEqual([60, 64]);
  });
});

describe('sanitizeNotes', () => {
  it('keeps integers within the picker, drops duplicates (first wins) and stops at three', () => {
    expect(sanitizeNotes([60, 60, 67, 999, 61.5, NaN, 72, 64])).toEqual([60, 67, 72]);
  });

  it('keeps the order it is given', () => {
    expect(sanitizeNotes([72, 60, 64])).toEqual([72, 60, 64]);
  });

  it('may come back empty', () => {
    expect(sanitizeNotes([])).toEqual([]);
    expect(sanitizeNotes([999, 59, 73])).toEqual([]);
  });

  it('returns a fresh array', () => {
    const input = [60, 64];
    expect(sanitizeNotes(input)).not.toBe(input);
  });
});

describe('parseNotesParam', () => {
  it('reads comma-separated midi numbers', () => {
    expect(parseNotesParam('60,67')).toEqual([60, 67]);
    expect(parseNotesParam('60')).toEqual([60]);
    expect(parseNotesParam(' 60 , 67 ')).toEqual([60, 67]);
  });

  it('drops the numbers the picker does not offer and keeps the rest', () => {
    expect(parseNotesParam('69,76,81')).toEqual([69]);
    expect(parseNotesParam('60,abc,64')).toEqual([60, 64]);
    expect(parseNotesParam('60,61,62,63')).toEqual([60, 61, 62]);
    expect(parseNotesParam('64,64,60')).toEqual([64, 60]);
  });

  it('is undefined when nothing valid is left', () => {
    expect(parseNotesParam('abc')).toBeUndefined();
    expect(parseNotesParam('')).toBeUndefined();
    expect(parseNotesParam(null)).toBeUndefined();
    expect(parseNotesParam(',,')).toBeUndefined();
    expect(parseNotesParam('76,81')).toBeUndefined();
  });

  it('accepts plain decimal integers only, not the other spellings Number() would take', () => {
    expect(parseNotesParam('0x3C')).toBeUndefined();
    expect(parseNotesParam('6e1')).toBeUndefined();
    expect(parseNotesParam('60.5')).toBeUndefined();
    expect(parseNotesParam('+60')).toBeUndefined();
    expect(parseNotesParam('-60')).toBeUndefined();
  });
});

describe('formatNotesParam', () => {
  it('joins the midi numbers with commas', () => {
    expect(formatNotesParam([60, 67])).toBe('60,67');
    expect(formatNotesParam([60])).toBe('60');
    expect(formatNotesParam([72, 60, 64])).toBe('72,60,64');
  });

  it('round-trips through parseNotesParam', () => {
    expect(parseNotesParam(formatNotesParam([67, 60, 64]))).toEqual([67, 60, 64]);
  });
});
