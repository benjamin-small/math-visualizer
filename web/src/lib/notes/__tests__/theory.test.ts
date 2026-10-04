import { describe, it, expect } from 'vitest';
import {
  NOTE_NAMES,
  noteName,
  noteLabel,
  midiToHz,
  JUST_RATIOS,
  justRatio,
  etRatio,
  NOTE_COLORS,
  PICKER_RANGE,
} from '../theory';

// Built from char codes so the check does not depend on how the glyphs were typed above.
const FLAT = String.fromCharCode(0x266d); // U+266D MUSIC FLAT SIGN
const SHARP = String.fromCharCode(0x266f); // U+266F MUSIC SHARP SIGN

describe('NOTE_NAMES', () => {
  it('names the twelve pitch classes from C, indexed by midi % 12', () => {
    expect(NOTE_NAMES).toHaveLength(12);
    expect(NOTE_NAMES).toEqual(['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']);
  });

  it('spells the black keys with the real flat and sharp glyphs, not b and #', () => {
    const flats = NOTE_NAMES.flatMap((n, i) => (n.includes(FLAT) ? [i] : []));
    const sharps = NOTE_NAMES.flatMap((n, i) => (n.includes(SHARP) ? [i] : []));
    expect(flats).toEqual([1, 3, 8, 10]);
    expect(sharps).toEqual([6]);
    expect(NOTE_NAMES.join('')).not.toMatch(/[b#]/);
  });
});

describe('noteName', () => {
  it('is the pitch class of a midi number', () => {
    expect(noteName(69)).toBe('A');
    expect(noteName(66)).toBe('F♯');
    expect(noteName(61)).toBe('D♭');
    expect(noteName(70)).toBe('B♭');
  });

  it('repeats every octave', () => {
    expect(noteName(60)).toBe('C');
    expect(noteName(72)).toBe('C');
    expect(noteName(127)).toBe('G');
    expect(noteName(-1)).toBe('B'); // never undefined, even below midi 0
  });
});

describe('noteLabel', () => {
  it('adds the octave, with middle C (midi 60) in octave 4', () => {
    expect(noteLabel(60)).toBe('C4');
    expect(noteLabel(72)).toBe('C5');
    expect(noteLabel(69)).toBe('A4');
    expect(noteLabel(61)).toBe('D♭4');
  });

  it('rolls the octave over at C, not at A', () => {
    expect(noteLabel(71)).toBe('B4');
    expect(noteLabel(59)).toBe('B3');
  });
});

describe('midiToHz', () => {
  it('is concert pitch: midi 69 is exactly 440 Hz', () => {
    expect(midiToHz(69)).toBe(440);
  });

  it('puts middle C near 262 Hz and C5 near 523 Hz', () => {
    expect(midiToHz(60)).toBeCloseTo(261.63, 2);
    expect(midiToHz(72)).toBeCloseTo(523.25, 2);
  });

  it('doubles every twelve semitones', () => {
    expect(midiToHz(81)).toBe(880);
    expect(midiToHz(57)).toBe(220);
  });
});

describe('JUST_RATIOS', () => {
  it('is the 5-limit table, one entry per semitone of the octave, in lowest terms', () => {
    const table = [[1, 1], [16, 15], [9, 8], [6, 5], [5, 4], [4, 3], [45, 32], [3, 2], [8, 5], [5, 3], [9, 5], [15, 8]];
    expect(JUST_RATIOS).toEqual(table.map(([num, den]) => ({ num, den })));
  });
});

describe('justRatio', () => {
  it('reads the table for the semitones inside one octave', () => {
    JUST_RATIOS.forEach((r, semitones) => expect(justRatio(semitones)).toEqual(r));
  });

  it.each([
    [12, 2, 1], // an octave
    [24, 4, 1],
    [19, 3, 1], // a fifth plus an octave: 3/2 x 2, reduced
    [14, 9, 4], // 9/8 x 2, reduced
    [7, 3, 2], // the perfect fifth
    [-7, 2, 3], // a fifth below
    [-12, 1, 2], // an octave below
    [-1, 15, 16], // a semitone below: 15/8 x 1/2
    [6, 45, 32], // the awkward tritone
    [1, 16, 15],
  ])('justRatio(%i) is %i/%i', (semitones, num, den) => {
    expect(justRatio(semitones)).toEqual({ num, den });
  });

  it('hands back a copy, so callers cannot corrupt the table', () => {
    const r = justRatio(7);
    r.num = 99;
    expect(JUST_RATIOS[7]).toEqual({ num: 3, den: 2 });
  });
});

describe('etRatio', () => {
  it('is 2^(semitones / 12): an octave is exactly 2', () => {
    expect(etRatio(0)).toBe(1);
    expect(etRatio(12)).toBe(2);
    expect(etRatio(-12)).toBe(0.5);
  });

  it('puts the equal-tempered fifth a hair under 3/2', () => {
    expect(etRatio(7)).toBeCloseTo(1.4983, 4);
    expect(etRatio(7)).toBeLessThan(3 / 2);
  });
});

describe('PICKER_RANGE', () => {
  it('is the thirteen semitones from C4 to C5, midi 60 through 72', () => {
    expect(PICKER_RANGE).toHaveLength(13);
    expect(PICKER_RANGE[0]).toBe(60);
    expect(PICKER_RANGE[12]).toBe(72);
    PICKER_RANGE.forEach((m, i) => expect(m).toBe(60 + i));
  });
});

describe('NOTE_COLORS', () => {
  it('copies the Rust viz defaults: amber, coral and mint bars, warm-white trail, cool-white sum', () => {
    expect(NOTE_COLORS.bars).toEqual(['#F2B23C', '#F0665C', '#6CC68E']);
    expect(NOTE_COLORS.trail).toBe('#F5E6CC');
    expect(NOTE_COLORS.sum).toBe('#E6E9EE');
  });

  it('are all #rrggbb', () => {
    for (const c of [...NOTE_COLORS.bars, NOTE_COLORS.trail, NOTE_COLORS.sum]) expect(c).toMatch(/^#[0-9A-F]{6}$/);
  });
});
