// Pure hash-route parsing. Kept free of runes/DOM so it's trivially testable;
// the reactive `route` object lives in router.svelte.ts.

export type LabId = 'sierpinski' | 'fourier';

export const LAB_IDS: readonly LabId[] = ['sierpinski', 'fourier'];
export const DEFAULT_LAB: LabId = 'sierpinski';

/** `#/fourier` → 'fourier'; anything else (empty, unknown, `#/`) → 'sierpinski'. */
export function parseHash(hash: string): LabId {
  const id = hash.replace(/^#\/?/, '').split(/[/?#]/)[0];
  return (LAB_IDS as readonly string[]).includes(id) ? (id as LabId) : DEFAULT_LAB;
}

/** The query part of a hash route: `#/fourier?text=HI&n=5` → 'text=HI&n=5' ('' when absent). */
export function parseHashQuery(hash: string): string {
  const i = hash.indexOf('?');
  return i === -1 ? '' : hash.slice(i + 1);
}

/** Serialize params to a query string, omitting undefined/empty values. */
export function buildQuery(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, v);
  return q.toString();
}
