// The explainers' front door: one function from a target and the page's
// context to a card, or null when there is nothing to say yet.
import type { ExplainContext } from './context';
import { explainDct } from './dct';
import { explainQuantize } from './quantize';
import type { Target } from './targets';
import type { Explanation } from './types';

export type { ExplainContext } from './context';
export { scopeKey, TARGET_IDS, type Target } from './targets';
export type { Detail, Explanation } from './types';

/** The card for `t`. Explainers read the context only and never encode. Ids whose module is not written yet give null. */
export function explain(t: Target, ctx: ExplainContext): Explanation | null {
  const stage = t.id.slice(0, t.id.indexOf('.'));
  switch (stage) {
    case 'dct':
      return explainDct(t, ctx);
    case 'quantize':
      return explainQuantize(t, ctx);
    default:
      return null;
  }
}
