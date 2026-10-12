import { describe, it, expect } from 'vitest';
import { CHORDS, chordOn, chordById, isChordId } from '../chords';
import { PICKER_RANGE } from '../theory';

describe('CHORDS', () => {
  it('lists the six triads in picker order, each three notes from the root up', () => {
    expect(CHORDS.map((c) => c.id)).toEqual(['major', 'minor', 'diminished', 'augmented', 'sus2', 'sus4']);
    expect(CHORDS.map((c) => c.label)).toEqual(['Major', 'Minor', 'Diminished', 'Augmented', 'Sus2', 'Sus4']);
    for (const c of CHORDS) {
      expect(c.steps).toHaveLength(3);
      expect(c.steps[0]).toBe(0);
    }
  });

  it('spells each triad in semitones above its root', () => {
    expect(chordById('major').steps).toEqual([0, 4, 7]);
    expect(chordById('minor').steps).toEqual([0, 3, 7]);
    expect(chordById('diminished').steps).toEqual([0, 3, 6]);
    expect(chordById('augmented').steps).toEqual([0, 4, 8]);
    expect(chordById('sus2').steps).toEqual([0, 2, 7]);
    expect(chordById('sus4').steps).toEqual([0, 5, 7]);
  });
});

describe('isChordId', () => {
  it('accepts the six ids and nothing else', () => {
    for (const c of CHORDS) expect(isChordId(c.id)).toBe(true);
    for (const bad of ['', 'Major', 'dom7', 'notes', null]) expect(isChordId(bad)).toBe(false);
  });
});

describe('chordOn', () => {
  it('builds the chord upward from the root, root first', () => {
    expect(chordOn(60, 'major')).toEqual([60, 64, 67]);
    expect(chordOn(57, 'minor')).toEqual([57, 60, 64]);
    expect(chordOn(48, 'augmented')).toEqual([48, 52, 56]);
  });

  it('refuses a chord that would run past the top of the picker', () => {
    const top = PICKER_RANGE[PICKER_RANGE.length - 1];
    expect(chordOn(top - 7, 'major')).toEqual([top - 7, top - 3, top]); // F5 major ends on C6
    expect(chordOn(top - 6, 'major')).toBeUndefined();
    expect(chordOn(top - 8, 'augmented')).toEqual([top - 8, top - 4, top]);
    expect(chordOn(top - 7, 'augmented')).toBeUndefined();
  });

  it('refuses a root the picker does not offer', () => {
    expect(chordOn(PICKER_RANGE[0] - 1, 'major')).toBeUndefined();
    expect(chordOn(60.5, 'major')).toBeUndefined();
  });
});
