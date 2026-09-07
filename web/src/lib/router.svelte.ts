// Reactive hash router. `route.id` is a $state field on an exported object
// (a reassigned `let` export is not allowed for runes) — mutate `route.id`,
// never reassign `route`.
import { parseHash, type LabId } from './router';

const initialHash = typeof location !== 'undefined' ? location.hash : '';

export const route = $state<{ id: LabId }>({ id: parseHash(initialHash) });

/** Navigate programmatically. Updates the hash (so the URL is bookmarkable) and the reactive route. */
export function navigate(id: LabId) {
  if (typeof location !== 'undefined') location.hash = `#/${id}`;
  route.id = id;
}

let installed = false;

/** Idempotent. Call once from App's onMount so back/forward + manual hash edits update `route`. */
export function installRouter() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('hashchange', () => {
    route.id = parseHash(location.hash);
  });
}
