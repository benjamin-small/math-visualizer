import { describe, it, expect } from 'vitest';
import {
  readSummary,
  swingCount,
  swingLabel,
  ratioLabel,
  tileReadout,
  tileProgress,
  type NoteSummary,
  type NotesSummary,
} from '../summary';
import { notesSummaryFixture, sortingSummaryFixture, ruleSummaryFixture } from '../../test/fakeViz';

const TIMES = String.fromCharCode(0xd7); // U+00D7 MULTIPLICATION SIGN, not the letter x

function note(patch: Partial<NoteSummary> = {}): NoteSummary {
  return { midi: 60, ratio: 1, num: 1, den: 1, displacement: 0, ...patch };
}

const C = note();
const E = note({ midi: 64, ratio: 5 / 4, num: 5, den: 4 });
const G = note({ midi: 67, ratio: 3 / 2, num: 3, den: 2 });

function summary(patch: Partial<NotesSummary> = {}): NotesSummary {
  return { phase: 1.3, period: 2, closed: false, just_intonation: true, notes: [C, G], ...patch };
}

/** The fixture's first note with some fields overridden, wrapped as a raw one-note summary. */
function rawWithNote(patch: Record<string, unknown>) {
  return { ...notesSummaryFixture, notes: [{ ...notesSummaryFixture.notes[0], ...patch }] };
}

describe('readSummary', () => {
  it('accepts the engine shape and returns a fresh copy', () => {
    const s = readSummary(notesSummaryFixture);
    expect(s).toEqual(notesSummaryFixture);
    expect(s).not.toBe(notesSummaryFixture);
    expect(s!.notes).not.toBe(notesSummaryFixture.notes);
    expect(s!.notes[0]).not.toBe(notesSummaryFixture.notes[0]);
  });

  it('drops fields it does not know, and keeps the notes in bar order', () => {
    const raw = { ...notesSummaryFixture, extra: 1, notes: [{ ...G, extra: 2 }, { ...C, extra: 3 }] };
    const s = readSummary(raw);
    expect(s?.notes).toEqual([G, C]);
    expect(s).not.toHaveProperty('extra');
  });

  it('accepts up to three notes, an empty pick included, and no more', () => {
    for (const notes of [[], [C], [C, G], [C, E, G]]) {
      expect(readSummary({ ...notesSummaryFixture, notes })?.notes).toHaveLength(notes.length);
    }
    expect(readSummary({ ...notesSummaryFixture, notes: [C, E, G, note({ midi: 72, ratio: 2, num: 2, den: 1 })] })).toBeNull();
  });

  it('rejects null, undefined and non-objects', () => {
    expect(readSummary(null)).toBeNull();
    expect(readSummary(undefined)).toBeNull();
    expect(readSummary(42)).toBeNull();
    expect(readSummary('notes')).toBeNull();
    expect(readSummary([])).toBeNull();
  });

  it('rejects another lab\'s summary', () => {
    expect(readSummary(sortingSummaryFixture)).toBeNull();
    expect(readSummary(ruleSummaryFixture)).toBeNull();
  });

  it('rejects a bad phase, period, closed or just_intonation', () => {
    expect(readSummary({ ...notesSummaryFixture, phase: NaN })).toBeNull();
    expect(readSummary({ ...notesSummaryFixture, phase: Infinity })).toBeNull();
    expect(readSummary({ ...notesSummaryFixture, phase: '1' })).toBeNull();
    expect(readSummary({ ...notesSummaryFixture, period: '2' })).toBeNull();
    expect(readSummary({ ...notesSummaryFixture, closed: 'no' })).toBeNull();
    expect(readSummary({ ...notesSummaryFixture, just_intonation: 1 })).toBeNull();
    const { just_intonation: _j, ...noTuning } = notesSummaryFixture;
    expect(readSummary(noTuning)).toBeNull();
    const { phase: _p, ...noPhase } = notesSummaryFixture;
    expect(readSummary(noPhase)).toBeNull();
  });

  it('rejects malformed notes', () => {
    expect(readSummary({ ...notesSummaryFixture, notes: null })).toBeNull();
    expect(readSummary({ ...notesSummaryFixture, notes: 'C G' })).toBeNull();
    expect(readSummary({ ...notesSummaryFixture, notes: [null] })).toBeNull();
    expect(readSummary(rawWithNote({ ratio: 'x' }))).toBeNull();
    expect(readSummary(rawWithNote({ ratio: NaN }))).toBeNull();
    expect(readSummary(rawWithNote({ midi: '60' }))).toBeNull();
    expect(readSummary(rawWithNote({ displacement: undefined }))).toBeNull();
  });

  it('normalises a missing fraction to null, whether Rust sent null, undefined or nothing', () => {
    // wasm-bindgen hands an `Option::None` over as `undefined`, not `null`.
    const none = { midi: 60, ratio: 1, num: null, den: null, displacement: 0 };
    expect(readSummary(rawWithNote({ num: null, den: null }))?.notes[0]).toEqual(none);
    expect(readSummary(rawWithNote({ num: undefined, den: undefined }))?.notes[0]).toEqual(none);
    const { num: _n, den: _d, ...bare } = notesSummaryFixture.notes[0];
    expect(readSummary({ ...notesSummaryFixture, notes: [bare] })?.notes[0]).toEqual(none);
  });

  it('rejects a half-set fraction, and one that is not a number', () => {
    expect(readSummary(rawWithNote({ num: 1, den: undefined }))).toBeNull();
    expect(readSummary(rawWithNote({ num: undefined, den: 2 }))).toBeNull();
    expect(readSummary(rawWithNote({ num: 3, den: null }))).toBeNull();
    expect(readSummary(rawWithNote({ num: null, den: 2 }))).toBeNull();
    expect(readSummary(rawWithNote({ num: 'x', den: 2 }))).toBeNull();
    expect(readSummary(rawWithNote({ num: 3, den: NaN }))).toBeNull();
  });
});

describe('swingCount', () => {
  it('is how many swings the note makes in one period: num * period / den', () => {
    expect(swingCount(C, 2)).toBe(2);
    expect(swingCount(G, 2)).toBe(3);
    expect(swingCount(E, 4)).toBe(5);
    expect(swingCount(G, 4)).toBe(6);
  });

  it('is null for a note without a fraction', () => {
    expect(swingCount(note({ num: null, den: null }), 2)).toBeNull();
  });
});

describe('swingLabel', () => {
  it('names the note and counts its swings per period in pure ratios', () => {
    const s = summary();
    expect(swingLabel(C, s)).toBe('C ×2');
    expect(swingLabel(G, s)).toBe('G ×3');
  });

  it('spells a black key with its real flat glyph', () => {
    const dFlat = note({ midi: 61, ratio: 16 / 15, num: 16, den: 15 });
    expect(swingLabel(dFlat, summary({ period: 15, notes: [C, dFlat] }))).toBe('D♭ ×16');
  });

  it('multiplies with U+00D7, not the letter x', () => {
    const label = swingLabel(C, summary());
    expect(label).toContain(TIMES);
    expect(label).not.toMatch(/x/);
  });

  it('shows period x ratio to two decimals in piano tuning, where nothing divides evenly', () => {
    const piano = summary({ just_intonation: false, notes: [C, note({ midi: 67, ratio: 1.4983, num: 3, den: 2 })] });
    expect(swingLabel(piano.notes[1], piano)).toBe('G ×3.00');
    expect(swingLabel(piano.notes[0], piano)).toBe('C ×2.00');
    const wide = summary({ just_intonation: false, period: 4, notes: [C, note({ midi: 64, ratio: 1.2599, num: 5, den: 4 })] });
    expect(swingLabel(wide.notes[1], wide)).toBe('E ×5.04');
  });

  it('falls back to period x ratio when a pure-ratio note has no fraction to count with', () => {
    const noFraction = note({ midi: 67, ratio: 1.5, num: null, den: null });
    expect(swingLabel(noFraction, summary({ notes: [C, noFraction] }))).toBe('G ×3.00');
  });

  it('is just the note name for a lone note, in either tuning, since "C ×1" says nothing', () => {
    for (const just_intonation of [true, false]) {
      expect(swingLabel(C, summary({ just_intonation, period: 1, notes: [C] }))).toBe('C');
      expect(swingLabel(note({ midi: 67 }), summary({ just_intonation, period: 1, notes: [note({ midi: 67 })] }))).toBe('G');
    }
    const dFlat = note({ midi: 61 });
    expect(swingLabel(dFlat, summary({ period: 1, notes: [dFlat] }))).toBe('D♭');
    expect(swingLabel(C, summary({ period: 1, notes: [C] }))).not.toContain(TIMES);
  });

  it('keeps the swing count for every note once there are two or more', () => {
    const triad = summary({ period: 4, notes: [C, E, G] });
    expect([C, E, G].map((n) => swingLabel(n, triad))).toEqual(['C ×4', 'E ×5', 'G ×6']);
    const piano = summary({
      just_intonation: false,
      period: 4,
      notes: [C, note({ midi: 64, ratio: 1.2599 }), note({ midi: 67, ratio: 1.4983 })],
    });
    expect(piano.notes.map((n) => swingLabel(n, piano))).toEqual(['C ×4.00', 'E ×5.04', 'G ×5.99']);
  });
});

describe('ratioLabel', () => {
  it('joins the swing counts with " : " in pure ratios', () => {
    expect(ratioLabel(summary())).toBe('2 : 3');
    expect(ratioLabel(summary({ period: 4, notes: [C, E, G] }))).toBe('4 : 5 : 6');
  });

  it('lists the notes by ascending pitch, whatever order they were picked in', () => {
    // E is the root (first pick); C sits a major third below it, a 4/5 ratio.
    const lowC = note({ midi: 60, ratio: 4 / 5, num: 4, den: 5 });
    const rootE = note({ midi: 64, ratio: 1, num: 1, den: 1 });
    expect(ratioLabel(summary({ period: 5, notes: [rootE, lowC] }))).toBe('4 : 5');
    // G is the root with C a fifth below it: 2/3.
    const fifthBelow = note({ midi: 60, ratio: 2 / 3, num: 2, den: 3 });
    const rootG = note({ midi: 67, ratio: 1, num: 1, den: 1 });
    expect(ratioLabel(summary({ period: 3, notes: [rootG, fifthBelow] }))).toBe('2 : 3');
  });

  it('does not reorder the summary it was given', () => {
    const lowC = note({ midi: 60, ratio: 4 / 5, num: 4, den: 5 });
    const rootE = note({ midi: 64 });
    const s = summary({ period: 5, notes: [rootE, lowC] });
    ratioLabel(s);
    expect(s.notes.map((n) => n.midi)).toEqual([64, 60]);
  });

  it('shows period x ratio to two decimals in piano tuning, with the root bare', () => {
    const triad = summary({
      just_intonation: false,
      period: 4,
      notes: [C, note({ midi: 64, ratio: 1.2599 }), note({ midi: 67, ratio: 1.4983 })],
    });
    expect(ratioLabel(triad)).toBe('4 : 5.04 : 5.99');
  });

  it('keeps the root bare even when it is not the lowest note', () => {
    const rootE = note({ midi: 64, ratio: 1 });
    const lowC = note({ midi: 60, ratio: 0.7937, num: 4, den: 5 });
    expect(ratioLabel(summary({ just_intonation: false, period: 5, notes: [rootE, lowC] }))).toBe('3.97 : 5');
  });

  it('is empty for a single note, which has no ratio to show', () => {
    expect(ratioLabel(summary({ notes: [C] }))).toBe('');
    expect(ratioLabel(summary({ just_intonation: false, notes: [C] }))).toBe('');
  });
});

describe('tileReadout', () => {
  it('reads swings so far over swings to close the loop', () => {
    expect(tileReadout(summary({ phase: 1.3, period: 2 }))).toBe('1.3 / 2 swings');
    expect(tileReadout(notesSummaryFixture)).toBe('0.0 / 2 swings');
    expect(tileReadout(summary({ phase: 3.46, period: 4 }))).toBe('3.5 / 4 swings');
  });

  it('says it is tuning up before the first summary', () => {
    expect(tileReadout(null)).toBe('Tuning up');
  });

  it('stops counting at the period once the loop has closed, since the tile keeps playing', () => {
    expect(tileReadout(summary({ phase: 2, period: 2, closed: true }))).toBe('2.0 / 2 swings');
    expect(tileReadout(summary({ phase: 183.7, period: 2, closed: true }))).toBe('2.0 / 2 swings');
  });
});

describe('tileProgress', () => {
  it('is the share of the period swung so far', () => {
    expect(tileProgress(summary({ phase: 1.3, period: 2 }))).toBeCloseTo(0.65, 10);
    expect(tileProgress(notesSummaryFixture)).toBe(0);
  });

  it('is 1 once the loop has closed, whatever the phase says', () => {
    expect(tileProgress(summary({ phase: 2, period: 2, closed: true }))).toBe(1);
    expect(tileProgress(summary({ phase: 0.5, period: 2, closed: true }))).toBe(1);
  });

  it('never exceeds 1', () => {
    expect(tileProgress(summary({ phase: 5, period: 2, closed: false }))).toBe(1);
  });

  it('is 0 before the first summary', () => {
    expect(tileProgress(null)).toBe(0);
  });
});
