// What an explainer returns: a compact card (title, value, body, consequence)
// and, behind "More", a list of detail blocks the card component renders.

/** One block of a card's unfolded part. */
export type Detail =
  | { kind: 'text'; text: string }
  | { kind: 'tex'; tex: string }
  | { kind: 'rows'; rows: [string, string][] }
  | { kind: 'pattern'; u: number; v: number };

/** A card's content, as plain data (the card component only lays it out). */
export interface Explanation {
  title: string;
  /** The actual value, e.g. `F(2,1) = −34.2`. */
  value?: string;
  /** What it means, in plain words. */
  body: string;
  /** What the current settings do to it. */
  consequence?: string;
  /** The unfolded part, behind "More". */
  details: Detail[];
  /** True for targets whose click does a job (their card unfolds only through "More"). */
  acts?: boolean;
}
