// The Notes lab's view of the engine: the summary `rule_summary()` reports every
// frame, and the text the overlay and the home tile print from it. Pure and
// dependency-light (same style as lib/sorting/summary.ts).
import { MAX_NOTES } from './picker';
import { noteName } from './theory';

/** One note, as the engine reports it. */
export interface NoteSummary {
  midi: number;
  /** Swings per root swing as actually played: the just fraction in pure ratios, 2^(d/12) in piano tuning. */
  ratio: number;
  /** The just fraction of the interval from the root, in lowest terms. Reported in piano mode too; both null if the engine sent none. */
  num: number | null;
  den: number | null;
  /** Where the note's dot sits on its bar right now, in [-1, 1]. */
  displacement: number;
}

/** The whole scene. `notes` are in bar order: `[0]` is the root (left bar), then the top bar, then the right bar. */
export interface NotesSummary {
  /** Root swings so far, unreduced (so the piano figure keeps drifting instead of snapping back). */
  phase: number;
  /** Root swings after which a pure-ratio figure closes: the lcm of the just denominators. */
  period: number;
  /** `phase >= period`; once true it stays true while playing. */
  closed: boolean;
  just_intonation: boolean;
  notes: NoteSummary[];
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function readNote(raw: unknown): NoteSummary | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { midi, ratio, num, den, displacement } = raw as Record<string, unknown>;
  if (!isFiniteNumber(midi) || !isFiniteNumber(ratio) || !isFiniteNumber(displacement)) return null;
  // The fraction is both unset or both set, never one without the other. The
  // engine's `None` crosses wasm-bindgen as `undefined`, not `null`, so accept
  // either and normalise to null.
  if (num == null && den == null) return { midi, ratio, num: null, den: null, displacement };
  if (!isFiniteNumber(num) || !isFiniteNumber(den)) return null;
  return { midi, ratio, num, den, displacement };
}

/**
 * Validate the raw `engine.rule_summary()` value. Returns a fresh, normalised
 * summary, or `null` for null/undefined, another lab's summary, and any shape
 * that is not one to three well-formed notes.
 */
export function readSummary(raw: unknown): NotesSummary | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { phase, period, closed, just_intonation, notes } = raw as Record<string, unknown>;
  if (!isFiniteNumber(phase) || !isFiniteNumber(period)) return null;
  if (typeof closed !== 'boolean' || typeof just_intonation !== 'boolean') return null;
  if (!Array.isArray(notes) || notes.length > MAX_NOTES) return null;
  const out: NoteSummary[] = [];
  for (const n of notes) {
    const note = readNote(n);
    if (note === null) return null;
    out.push(note);
  }
  return { phase, period, closed, just_intonation, notes: out };
}

/** How many times the note swings in one period, `num * period / den`; null for a note without a fraction. */
export function swingCount(note: NoteSummary, period: number): number | null {
  if (note.num === null || note.den === null) return null;
  return (note.num * period) / note.den;
}

/** The note's swings per period as text: a whole number in pure ratios, else `period * ratio` to two decimals. */
function countText(note: NoteSummary, s: NotesSummary): string {
  const exact = s.just_intonation ? swingCount(note, s.period) : null;
  return exact !== null ? String(exact) : (s.period * note.ratio).toFixed(2);
}

/**
 * The label at a bar's end: pure ratios `'C ×2'`, piano tuning `'G ×3.00'` (the sign
 * is U+00D7). A lone note has no ratio to count against, so its label is just
 * the name.
 */
export function swingLabel(note: NoteSummary, s: NotesSummary): string {
  const name = noteName(note.midi);
  return s.notes.length === 1 ? name : `${name} ×${countText(note, s)}`;
}

/**
 * The ratio readout, the notes' swing counts side by side from the lowest
 * pitch up: `'2 : 3'`, `'4 : 5 : 6'`. Piano tuning shows period x ratio to two
 * decimals with the root (a whole number of swings by construction) bare:
 * `'4 : 5.04 : 5.99'`. Empty for a single note.
 */
export function ratioLabel(s: NotesSummary): string {
  if (s.notes.length < 2) return '';
  const root = s.notes[0];
  return [...s.notes]
    .sort((a, b) => a.midi - b.midi)
    .map((n) => (!s.just_intonation && n === root ? String(s.period) : countText(n, s)))
    .join(' : ');
}

/**
 * The home tile's foot line, `'1.3 / 2 swings'`. The tile keeps playing after
 * the loop closes, so the count stops at the period instead of growing for as
 * long as the page stays open.
 */
export function tileReadout(s: NotesSummary | null): string {
  if (s === null) return 'Tuning up';
  return `${Math.min(s.phase, s.period).toFixed(1)} / ${s.period} swings`;
}

/** The tile's clock-line fill in [0, 1]: the share of the period swung, full once the loop has closed. */
export function tileProgress(s: NotesSummary | null): number {
  if (s === null) return 0;
  return s.closed ? 1 : Math.min(1, s.phase / s.period);
}
