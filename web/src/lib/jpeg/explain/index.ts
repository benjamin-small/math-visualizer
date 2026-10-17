// The explainers' front door: one function from a target and the page's
// context to a card, or null when there is nothing to say yet.
import { explainBezel } from './bezel';
import { explainCoding } from './coding';
import type { ExplainContext } from './context';
import { explainDct } from './dct';
import { explainEarly } from './early';
import { explainQuantize } from './quantize';
import type { Target } from './targets';
import type { Explanation } from './types';

export type { ExplainContext } from './context';
export { scopeKey, TARGET_IDS, type Target } from './targets';
export type { Detail, Explanation } from './types';

/** The card for `t`. Explainers read the context only and never encode. An id no module owns gives null. */
export function explain(t: Target, ctx: ExplainContext): Explanation | null {
  const stage = t.id.slice(0, t.id.indexOf('.'));
  switch (stage) {
    case 'bezel':
    case 'rail':
    case 'readout':
    case 'chip':
    case 'gallery':
    case 'image':
      return explainBezel(t, ctx);
    case 'color':
    case 'subsample':
    case 'blocks':
      return explainEarly(t, ctx);
    case 'zigzag':
    case 'rle':
    case 'huffman':
      return explainCoding(t, ctx);
    case 'dct':
      return explainDct(t, ctx);
    case 'quantize':
      return explainQuantize(t, ctx);
    default:
      return null;
  }
}
