// Small wording helpers shared by the explainers.
import { roundHalfAway } from './quality';

/** A number with a real minus sign (U+2212) and a fixed number of decimals; never "−0.0". */
export function signed(x: number, digits = 1): string {
  const s = Math.abs(x) < 0.5 * 10 ** -digits ? (0).toFixed(digits) : Math.abs(x).toFixed(digits);
  return x < 0 && Number(s) !== 0 ? `−${s}` : s;
}

/** A whole number with a real minus sign. */
export function whole(x: number): string {
  const r = roundHalfAway(x);
  return r < 0 ? `−${-r}` : String(r);
}

/** A ratio with up to two decimals and no trailing zeros: `7.5`, `−1.25`, `3`. */
export function ratio(x: number): string {
  const s = signed(x, 2);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

/** `+3`, `−2`, `0`: a signed whole-number difference. */
export function delta(x: number): string {
  const r = roundHalfAway(x);
  return r > 0 ? `+${r}` : whole(r);
}

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'];

/** `one`, `two`, … `seven`. */
export function word(n: number): string {
  return WORDS[n] ?? String(n);
}

/** `1 bit`, `2 bits`. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** dB for people: `33.2 dB`, `∞ dB` for a perfect copy. */
export function db(psnr: number | null): string {
  return psnr == null || !Number.isFinite(psnr) ? '∞ dB' : `${psnr.toFixed(1)} dB`;
}

/** Percentage with no decimals, never "100%" for something short of everything. */
export function percent(share: number): string {
  const p = share * 100;
  if (p >= 99.5 && p < 100) return '99%';
  if (p > 0 && p < 0.5) return '<1%';
  return `${Math.round(p)}%`;
}
