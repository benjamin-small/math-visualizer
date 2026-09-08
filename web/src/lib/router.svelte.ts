// Reactive hash router. `route` is an exported $state object (a reassigned
// `let` export is not allowed for runes) — mutate its fields, never reassign it.
//   route.id    — which lab ('#/fourier' → 'fourier')
//   route.query — the query part of the hash ('#/fourier?text=HI' → 'text=HI')
import { parseHash, parseHashQuery, type LabId } from './router';

const initialHash = typeof location !== 'undefined' ? location.hash : '';

export const route = $state<{ id: LabId; query: string }>({
  id: parseHash(initialHash),
  query: parseHashQuery(initialHash),
});

function hashFor(id: LabId, query: string): string {
  return query ? `#/${id}?${query}` : `#/${id}`;
}

/** Navigate programmatically (adds a history entry). Updates the hash and the reactive route. */
export function navigate(id: LabId, query = '') {
  if (typeof location !== 'undefined') location.hash = hashFor(id, query);
  route.id = id;
  route.query = query;
}

/**
 * Rewrite the current route's query in place — no history entry, and
 * history.replaceState fires no hashchange — so a lab can keep the URL in
 * sync with its live state (a shareable link) without re-triggering itself.
 */
export function replaceQuery(query: string) {
  if (typeof history !== 'undefined' && typeof location !== 'undefined') {
    history.replaceState(history.state, '', `${location.pathname}${location.search}${hashFor(route.id, query)}`);
  }
  route.query = query;
}

let installed = false;

/** Idempotent. Call once from App's onMount so back/forward + manual hash edits update `route`. */
export function installRouter() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('hashchange', () => {
    route.id = parseHash(location.hash);
    route.query = parseHashQuery(location.hash);
  });
}
