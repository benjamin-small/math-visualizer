import { describe, it, expect } from 'vitest';
import { CHORDS, chordOn, chordById, isChordId } from '../chords';
import { PICKER_RANGE } from '../theory';

describe('CHORDS', () => {
  it('lists the six triads, then the five sevenths', () => {
    expect(CHORDS.map((c) => c.id)).toEqual([
      'major', 'minor', 'diminished', 'augmented', 'sus2', 'sus4',
      'dom7', 'maj7', 'min7', 'halfdim7', 'dim7',
    ]);
    expect(CHORDS.map((c) => c.label)).toEqual([
      'Major', 'Minor', 'Diminished', 'Augmented', 'Sus2', 'Sus4',
      'Dom7', 'Maj7', 'Min7', 'Half-dim7', 'Dim7',
    ]);
    for (const c of CHORDS) {
      expect(c.steps[0]).toBe(0);
      expect(c.steps).toHaveLength(c.group === 'triad' ? 3 : 4);
    }
    expect(CHORDS.filter((c) => c.group === 'seventh')).toHaveLength(5);
  });

  it('spells each triad in semitones above its root', () => {
    expect(chordById('major').steps).toEqual([0, 4, 7]);
    expect(chordById('minor').steps).toEqual([0, 3, 7]);
    expect(chordById('diminished').steps).toEqual([0, 3, 6]);
    expect(chordById('augmented').steps).toEqual([0, 4, 8]);
    expect(chordById('sus2').steps).toEqual([0, 2, 7]);
    expect(chordById('sus4').steps).toEqual([0, 5, 7]);
  });

  it('spells each seventh in semitones above its root', () => {
    expect(chordById('dom7').steps).toEqual([0, 4, 7, 10]);
    expect(chordById('maj7').steps).toEqual([0, 4, 7, 11]);
    expect(chordById('min7').steps).toEqual([0, 3, 7, 10]);
    expect(chordById('halfdim7').steps).toEqual([0, 3, 6, 10]);
    expect(chordById('dim7').steps).toEqual([0, 3, 6, 9]);
  });
});

describe('isChordId', () => {
  it('accepts the eleven ids and nothing else', () => {
    for (const c of CHORDS) expect(isChordId(c.id)).toBe(true);
    for (const bad of ['', 'Major', 'dom9', 'notes', null]) expect(isChordId(bad)).toBe(false);
  });
});

describe('chordOn', () => {
  it('builds the chord upward from the root, root first', () => {
    expect(chordOn(60, 'major')).toEqual([60, 64, 67]);
    expect(chordOn(57, 'minor')).toEqual([57, 60, 64]);
    expect(chordOn(48, 'augmented')).toEqual([48, 52, 56]);
  });

  it('builds a seventh as four notes, and refuses one that would pass the top', () => {
    expect(chordOn(60, 'dom7')).toEqual([60, 64, 67, 70]);
    expect(chordOn(72, 'maj7')).toEqual([72, 76, 79, 83]); // C5 Maj7 ends on B5
    expect(chordOn(73, 'maj7')).toBeUndefined();
  });

  it('refuses a chord that would run past the top of the picker', () => {
    const top = PICKER_RANGE[PICKER_RANGE.length - 1];
    expect(chordOn(top - 7, 'major')).toEqual([top - 7, top - 3, top]); // the highest major chord ends on the top note
    expect(chordOn(top - 6, 'major')).toBeUndefined();
    expect(chordOn(top - 8, 'augmented')).toEqual([top - 8, top - 4, top]);
    expect(chordOn(top - 7, 'augmented')).toBeUndefined();
  });

  it('refuses a root the picker does not offer', () => {
    expect(chordOn(PICKER_RANGE[0] - 1, 'major')).toBeUndefined();
    expect(chordOn(60.5, 'major')).toBeUndefined();
  });
});
