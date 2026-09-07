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
