// The JPEG lab's cards: one controller holds what is hovered and what is
// pinned, and the `tooltip` action registers an element (or a hit-tested
// canvas) as a target. `TooltipHost.svelte` draws the cards.
import type { Action } from 'svelte/action';
import { scopeKey, type ExplainContext, type Target } from '../../jpeg/explain';

/** How long the pointer must rest on a target before its card shows. */
export const HOVER_DELAY_MS = 150;
/** How long a card lingers after the pointer leaves, so a 2 px gap does not flicker. */
export const LEAVE_DELAY_MS = 120;
/** How long a touch must hold an acting target to show its card. */
export const LONG_PRESS_MS = 500;
/** How far a touch may drift before it stops being a long-press. */
const LONG_PRESS_SLOP = 10;
/** How far a press may move and still count as a click: further is a drag, and a drag's closing click pins nothing. */
const DRAG_SLOP = 4;
/** The same for a finger, which is blunter than a mouse. */
const TOUCH_DRAG_SLOP = 12;

/** The id of the host's hidden element holding the shown card's compact text. */
export const TOOLTIP_LIVE_ID = 'jpeg-tooltip-live';

const keyOf = (t: Target): string => JSON.stringify(t);

export interface Hovered {
  target: Target;
  x: number;
  y: number;
  /** The target's own box, when it has one (focus, long-press); `More` pins against it. */
  rect?: DOMRect;
  /** The action instance that showed it: only the owner may hide or retarget it. */
  owner?: object;
}

export interface Pinned {
  target: Target;
  rect: DOMRect;
  unfolded: boolean;
  /** `scopeKey` when pinned; a different one later closes the pin. */
  scope: string;
  /** The element that pinned it from the keyboard: focus returns there on close. */
  returnTo?: HTMLElement | SVGElement;
  /** True until the host has moved focus into the card (a keyboard pin). */
  focusCard: boolean;
}

/** A rectangle for a point or an element box (jsdom and old engines may lack `DOMRect`). */
export function boxOf(x: number, y: number, w = 0, h = 0): DOMRect {
  if (typeof DOMRect !== 'undefined') return new DOMRect(x, y, w, h);
  return { x, y, width: w, height: h, left: x, top: y, right: x + w, bottom: y + h, toJSON: () => ({}) } as DOMRect;
}

export class TooltipController {
  /** The compact card being shown for a pointer or focus, if any. */
  hovered = $state.raw<Hovered | null>(null);
  /** The one pinned card, if any. */
  pinned = $state.raw<Pinned | null>(null);

  #ctx: ExplainContext | null = null;
  #showTimer: ReturnType<typeof setTimeout> | undefined;
  #leaveTimer: ReturnType<typeof setTimeout> | undefined;
  /** Who the pending (not yet shown) hover belongs to. */
  #pendingOwner: object | undefined;

  /** Show the card for `t` after the hover delay, or at once while a card is already showing. */
  hover(t: Target, x: number, y: number, rect?: DOMRect, owner?: object): void {
    clearTimeout(this.#leaveTimer);
    clearTimeout(this.#showTimer);
    const open = this.hovered;
    if (open) {
      // The card stays where it first appeared while the pointer moves within one target.
      if (keyOf(open.target) !== keyOf(t)) this.hovered = { target: t, x, y, rect, owner };
      else if (open.owner !== owner) this.hovered = { ...open, owner };
      this.#pendingOwner = undefined;
      return;
    }
    this.#pendingOwner = owner;
    this.#showTimer = setTimeout(() => {
      this.#pendingOwner = undefined;
      this.hovered = { target: t, x, y, rect, owner };
    }, HOVER_DELAY_MS);
  }

  /** Show the card for `t` now (keyboard focus, long-press). */
  showNow(t: Target, x: number, y: number, rect?: DOMRect, owner?: object): void {
    clearTimeout(this.#showTimer);
    clearTimeout(this.#leaveTimer);
    this.#pendingOwner = undefined;
    this.hovered = { target: t, x, y, rect, owner };
  }

  /**
   * Hide the card shortly, unless another hover (or the card itself) takes over.
   * With an `owner`, only that owner's own card (or pending hover) is affected.
   */
  leave(owner?: object): void {
    if (owner !== undefined) {
      const ownsShown = this.hovered?.owner === owner;
      const ownsPending = this.#pendingOwner === owner;
      if (!ownsShown && !ownsPending) return;
      if (ownsPending) {
        clearTimeout(this.#showTimer);
        this.#pendingOwner = undefined;
      }
      if (!ownsShown) return;
    } else {
      clearTimeout(this.#showTimer);
      this.#pendingOwner = undefined;
    }
    clearTimeout(this.#leaveTimer);
    if (!this.hovered) return;
    this.#leaveTimer = setTimeout(() => {
      this.hovered = null;
    }, LEAVE_DELAY_MS);
  }

  /** An owner's target changed: refresh its card to the new target, or hide it (`null`). Other owners' cards are untouched. */
  retarget(owner: object, t: Target | null): void {
    const h = this.hovered;
    if (this.#pendingOwner === owner) {
      clearTimeout(this.#showTimer);
      this.#pendingOwner = undefined;
    }
    if (!h || h.owner !== owner) return;
    clearTimeout(this.#leaveTimer);
    this.hovered = t ? { ...h, target: t } : null;
  }

  /** The pointer is on the card: keep it. */
  hold(): void {
    clearTimeout(this.#leaveTimer);
  }

  /**
   * Pin the card for `t` next to `rect`; one pin at a time. Pinning what is
   * pinned already keeps its fold. `returnTo` marks a keyboard pin: focus
   * moves into the card, and back to that element when the pin closes.
   */
  pin(t: Target, rect: DOMRect, returnTo?: HTMLElement | SVGElement): void {
    const cur = this.pinned;
    if (cur && keyOf(cur.target) === keyOf(t)) {
      this.pinned = { ...cur, rect, ...(returnTo ? { returnTo, focusCard: true } : {}) };
      return;
    }
    this.pinned = {
      target: t,
      rect,
      unfolded: false,
      scope: this.#ctx ? scopeKey(t, this.#ctx) : '',
      returnTo,
      focusCard: returnTo !== undefined,
    };
  }

  /** The host moved focus into the pinned card. */
  focusDone(): void {
    if (this.pinned?.focusCard) this.pinned = { ...this.pinned, focusCard: false };
  }

  /** Show the pinned card's details. */
  unfold(): void {
    if (this.pinned && !this.pinned.unfolded) this.pinned = { ...this.pinned, unfolded: true };
  }

  /** Drop the pin only (a click elsewhere). */
  unpin(): void {
    this.pinned = null;
  }

  /** Drop the pin and any compact card. */
  close(): void {
    this.dispose();
  }

  /** Stop every timer and drop both cards (also what the host does when it goes away). */
  dispose(): void {
    clearTimeout(this.#showTimer);
    clearTimeout(this.#leaveTimer);
    this.#pendingOwner = undefined;
    this.hovered = null;
    this.pinned = null;
  }

  /** The page's state changed: a pinned card about something no longer on screen closes; the host re-explains the rest. */
  setContext(ctx: ExplainContext): void {
    this.#ctx = ctx;
    const p = this.pinned;
    if (p && scopeKey(p.target, ctx) !== p.scope) this.pinned = null;
  }
}

export interface TooltipParams {
  ctl: TooltipController;
  /** What this element explains; a function hit-tests a canvas and may return null (nothing there). */
  target: Target | ((e: MouseEvent) => Target | null);
  /** True for controls whose click does a job: they never pin on click and unfold only through More. */
  acts?: boolean;
  /** For a hit-tested `target`: what keyboard focus, Enter and ? explain (e.g. a roving cell); null for nothing. */
  keyTarget?: () => Target | null;
}

/** How long after a touch ends a swallowed click may still arrive. */
const SWALLOW_MS = 400;

/** Input types where typing is text entry (an input with no type is text). */
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number']);

/** True where typing `?` is text entry, not a request for a card: not a slider, radio, checkbox or select, which have no text to type. */
function isTextEntry(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA') return true;
  return el instanceof HTMLInputElement && TEXT_INPUT_TYPES.has((el.getAttribute('type') ?? 'text').toLowerCase());
}

const targetKeyOf = (p: TooltipParams): string => (typeof p.target === 'function' ? 'fn' : keyOf(p.target));

/** Register an element as a card target. */
export const tooltip: Action<HTMLElement | SVGElement, TooltipParams> = (node, initial) => {
  let params = initial;
  /** This instance's identity: only it may hide or retarget the card it showed. */
  const owner = {};
  let pressTimer: ReturnType<typeof setTimeout> | undefined;
  let swallowTimer: ReturnType<typeof setTimeout> | undefined;
  let press: { x: number; y: number } | null = null;
  let swallowClick = false;
  let pointerDown = false;
  /** Where the last press began, to tell a click from the end of a drag. */
  let downAt: { x: number; y: number; slop: number } | null = null;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;

  const resolve = (e: MouseEvent): Target | null => (typeof params.target === 'function' ? params.target(e) : params.target);
  /** The target for focus and keys: a hit-tested element has none unless its owner names one. */
  const keyed = (): Target | null => (typeof params.target === 'function' ? (params.keyTarget?.() ?? null) : params.target);
  const isTouch = (e: Event) => (e as PointerEvent).pointerType === 'touch';
  const elementBox = () => node.getBoundingClientRect();
  const cancelPress = () => {
    clearTimeout(pressTimer);
    pressTimer = undefined;
    press = null;
  };
  const clearSwallow = () => {
    clearTimeout(swallowTimer);
    swallowTimer = undefined;
    swallowClick = false;
  };

  const onHover = (e: PointerEvent) => {
    if (isTouch(e)) return; // touch gets its card from a tap (pin) or a long-press
    const t = resolve(e);
    if (t) params.ctl.hover(t, e.clientX, e.clientY, undefined, owner);
    else params.ctl.leave(owner);
  };
  const onLeave = (e: PointerEvent) => {
    // A touch's pointerleave comes before its click, so it must not cancel a swallow.
    if (isTouch(e)) return;
    pointerDown = false;
    clearSwallow();
    params.ctl.leave(owner);
  };

  const onPointerDown = (e: PointerEvent) => {
    pointerDown = true;
    downAt = { x: e.clientX, y: e.clientY, slop: isTouch(e) ? TOUCH_DRAG_SLOP : DRAG_SLOP };
    clearSwallow();
    if (!isTouch(e) || !params.acts) return;
    const t = resolve(e);
    if (!t) return;
    press = { x: e.clientX, y: e.clientY };
    pressTimer = setTimeout(() => {
      pressTimer = undefined;
      swallowClick = true;
      params.ctl.showNow(t, e.clientX, e.clientY, elementBox(), owner);
    }, LONG_PRESS_MS);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > LONG_PRESS_SLOP) cancelPress();
    onHover(e);
  };
  const onPointerEnd = () => {
    pointerDown = false;
    cancelPress();
    // A click that follows a long-press comes at once; if none does, stop waiting for it.
    if (swallowClick) {
      clearTimeout(swallowTimer);
      swallowTimer = setTimeout(clearSwallow, SWALLOW_MS);
    }
  };

  // Capture phase, so a swallowed click never reaches the element's own handlers.
  const onClick = (e: MouseEvent) => {
    if (swallowClick) {
      clearSwallow();
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (params.acts) return;
    // The click that ends a drag (orbiting the cube, scrubbing a slider) is not a request for a card.
    const from = downAt;
    downAt = null;
    if (from && e.detail > 0 && Math.hypot(e.clientX - from.x, e.clientY - from.y) > from.slop) return;
    const t = resolve(e);
    if (!t) return;
    // A real pointer click pins beside the pointer (a canvas box is the whole canvas); a keyboard click beside the element.
    params.ctl.pin(t, e.detail > 0 ? boxOf(e.clientX, e.clientY) : elementBox());
  };

  const onContextMenu = (e: Event) => {
    if (pressTimer !== undefined || swallowClick) e.preventDefault();
  };

  const onFocus = () => {
    if (pointerDown) return; // a mouse press focuses too; the hover card is enough there
    const t = keyed();
    if (!t) return;
    const r = elementBox();
    params.ctl.showNow(t, r.left, r.bottom, r, owner);
  };
  const onBlur = () => params.ctl.leave(owner);

  /**
   * A hit-tested node with a `keyTarget` (a roving cell): after a key that may have moved it, show the card for
   * where it is now, as this node's own card. Runs on a timer, after the owner's own key handler (which Svelte
   * delegates to the document, so it runs after this node's listeners) has moved its state.
   * Only when this node owns the shown card, or the key is a navigation key on the focused node (the keyboard
   * takes over a card some other node's pointer put up).
   */
  const refreshKeyed = (key: string) => {
    if (typeof params.target !== 'function' || !params.keyTarget) return;
    if (key === 'Escape' || key === 'Enter' || key === '?' || key === 'Tab') return;
    const own = params.ctl.hovered?.owner === owner;
    if (!own && !(document.activeElement === node && /^(Arrow|Home$|End$|Page)/.test(key))) return;
    const t = params.keyTarget();
    if (!t) {
      if (own) params.ctl.retarget(owner, null);
      return;
    }
    const open = params.ctl.hovered;
    if (own && open && keyOf(open.target) === keyOf(t)) return;
    const r = elementBox();
    params.ctl.showNow(t, r.left, r.bottom, r, owner);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    pointerDown = false;
    clearSwallow();
    // A key typed in something nested inside this node (a dot on a chart, a slider in a label) belongs to that.
    if (e.target !== node) return;
    const key = e.key;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refreshKeyed(key), 0);
    if (e.key !== 'Enter' && e.key !== '?') return;
    if (e.key === '?' && isTextEntry(e.target)) return;
    const t = keyed();
    if (!t) return;
    if (e.key === 'Enter') {
      if (!params.acts) {
        // The pin moves focus onto the card's Close button; the Enter must not carry on there and close it.
        e.preventDefault();
        params.ctl.pin(t, elementBox(), node);
      }
    } else {
      params.ctl.pin(t, elementBox(), node);
      params.ctl.unfold();
    }
  };

  const tokens = (node.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
  if (!tokens.includes(TOOLTIP_LIVE_ID)) node.setAttribute('aria-describedby', [...tokens, TOOLTIP_LIVE_ID].join(' '));

  node.addEventListener('pointerenter', onHover as EventListener);
  node.addEventListener('pointermove', onPointerMove as EventListener);
  node.addEventListener('pointerleave', onLeave as EventListener);
  node.addEventListener('pointerdown', onPointerDown as EventListener);
  node.addEventListener('pointerup', onPointerEnd);
  node.addEventListener('pointercancel', onPointerEnd);
  node.addEventListener('click', onClick as EventListener, true);
  node.addEventListener('contextmenu', onContextMenu);
  node.addEventListener('focus', onFocus);
  node.addEventListener('blur', onBlur);
  node.addEventListener('keydown', onKeyDown as EventListener);

  return {
    update(next) {
      const was = targetKeyOf(params);
      params = next;
      if (targetKeyOf(next) === was) return;
      // A different target: a card this node showed follows it (a hit-tested one waits for the next move).
      params.ctl.retarget(owner, typeof next.target === 'function' ? null : next.target);
    },
    destroy() {
      clearTimeout(refreshTimer);
      cancelPress();
      clearSwallow();
      // No pointerleave comes for a node removed under the pointer, so release its card here.
      params.ctl.leave(owner);
      node.removeEventListener('pointerenter', onHover as EventListener);
      node.removeEventListener('pointermove', onPointerMove as EventListener);
      node.removeEventListener('pointerleave', onLeave as EventListener);
      node.removeEventListener('pointerdown', onPointerDown as EventListener);
      node.removeEventListener('pointerup', onPointerEnd);
      node.removeEventListener('pointercancel', onPointerEnd);
      node.removeEventListener('click', onClick as EventListener, true);
      node.removeEventListener('contextmenu', onContextMenu);
      node.removeEventListener('focus', onFocus);
      node.removeEventListener('blur', onBlur);
      node.removeEventListener('keydown', onKeyDown as EventListener);
      const rest = (node.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((t) => t && t !== TOOLTIP_LIVE_ID);
      if (rest.length > 0) node.setAttribute('aria-describedby', rest.join(' '));
      else node.removeAttribute('aria-describedby');
    },
  };
};

/**
 * The 8 x 8 DCT basis pattern (u across, v down) as row-major gray levels
 * 0-255, for the pattern detail's picture. Pattern (0, 0) is mid-gray.
 */
export function basis(u: number, v: number): number[] {
  const out: number[] = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const c = Math.cos(((2 * x + 1) * u * Math.PI) / 16) * Math.cos(((2 * y + 1) * v * Math.PI) / 16);
      out.push(Math.round(127.5 + 127.5 * c));
    }
  }
  return out;
}
