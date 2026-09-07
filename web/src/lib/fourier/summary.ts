// Pure TeX helpers for the Fourier lab's "The formula" panel. The engine's
// `rule_summary()` hands us the DFT terms (amplitude-descending, ≤ 64) after
// each config push; these functions turn them into KaTeX source. No KaTeX
// dependency here so they stay cheap to unit-test.

export type FourierTerm = { freq: number; amp: number; phase: number };

export type FourierSummary = {
  origin: [number, number];
  total_terms: number;
  terms: FourierTerm[];
};

/** The general epicycle series: one rotating circle per term, chained tip-to-tail. */
export const GENERAL_TEX =
  String.raw`z(t) = c_0 + \sum_{k} A_k\, e^{\,i\left(2\pi f_k\, t + \varphi_k\right)}`;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Validate the raw `engine.rule_summary()` value. Returns a fresh, normalized
 * summary, or `null` for null/undefined, non-Fourier labs, malformed shapes,
 * and summaries with zero terms (nothing to expand).
 */
export function readSummary(raw: unknown): FourierSummary | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { origin, total_terms, terms } = raw as Record<string, unknown>;
  if (!Array.isArray(origin) || origin.length !== 2) return null;
  if (!isFiniteNumber(origin[0]) || !isFiniteNumber(origin[1])) return null;
  if (!isFiniteNumber(total_terms)) return null;
  if (!Array.isArray(terms) || terms.length === 0) return null;
  const out: FourierTerm[] = [];
  for (const t of terms) {
    if (typeof t !== 'object' || t === null) return null;
    const { freq, amp, phase } = t as Record<string, unknown>;
    if (!isFiniteNumber(freq) || !isFiniteNumber(amp) || !isFiniteNumber(phase)) return null;
    out.push({ freq, amp, phase });
  }
  return { origin: [origin[0], origin[1]], total_terms, terms: out };
}

/** `+` / `-` with the magnitude, so "0.87" → "+ 0.87" and "-1.31" → "- 1.31" (no "-0.00"). */
function signed(v: number, digits: number): string {
  const mag = Math.abs(v).toFixed(digits);
  const neg = v < 0 && Number(mag) !== 0;
  return `${neg ? '-' : '+'} ${mag}`;
}

/** One term as `A e^{i(2π·f t ± φ)}`: amp to 3 s.f., phase to 2 d.p., negative freq in parentheses. */
export function termTex(t: FourierTerm): string {
  const amp = t.amp.toPrecision(3);
  const freq = t.freq < 0 ? `(${t.freq})` : `${t.freq}`;
  const [sign, phase] = signed(t.phase, 2).split(' ');
  return String.raw`${amp}\, e^{\,i(2\pi\cdot ${freq}\, t \,${sign}\, ${phase})}`;
}

/**
 * The live expansion: an `aligned` block whose first line is the origin
 * (constant term) and whose next lines are the top `shown` terms. Lines are
 * separated by `\\`, so the block has min(shown, terms.length) + 1 lines.
 */
export function expansionTex(s: FourierSummary, shown: number): string {
  const [ox, oy] = s.origin;
  const [oySign, oyMag] = signed(oy, 3).split(' ');
  const lines = [String.raw`z(t) \approx\ & (${ox.toFixed(3)} ${oySign} ${oyMag}\,i)`];
  for (const t of s.terms.slice(0, Math.max(0, shown))) {
    lines.push(String.raw`& +\, ${termTex(t)}`);
  }
  return String.raw`\begin{aligned}` + '\n' + lines.join(' \\\\\n') + '\n' + String.raw`\end{aligned}`;
}

/** How many terms the expansion leaves out (0 when everything fits). */
export function remainingTerms(s: FourierSummary, shown: number): number {
  return Math.max(0, s.total_terms - shown);
}
