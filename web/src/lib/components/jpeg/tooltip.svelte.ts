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

/** The id of the host's hidden element holding the shown card's compact text. */
export const TOOLTIP_LIVE_ID = 'jpeg-tooltip-live';

const keyOf = (t: Target): string => JSON.stringify(t);

export interface Hovered {
  target: Target;
  x: number;
  y: number;
  /** The target's own box, when it has one (focus, long-press); `More` pins against it. */
  rect?: DOMRect;
}

export interface Pinned {
  target: Target;
  rect: DOMRect;
  unfolded: boolean;
  /** `scopeKey` when pinned; a different one later closes the pin. */
  scope: string;
}

/** A rectangle for a point or an element box (jsdom and old engines may lack `DOMRect`). */
export function boxOf(x: number, y: number, w = 0, h = 0): DOMRect {
  if (typeof DOMRect !== 'undefined') return new DOMRect(x, y, w, h);
  return { x, y, width: w, height: h, left: x, top: y, right: x + w, bottom: y + h, toJSON: () => ({}) } as DOMRect;
}

export class TooltipController {
  /** The compact card being shown for a pointer or focus, if any. */
  hovered = $state<Hovered | null>(null);
  /** The one pinned card, if any. */
  pinned = $state<Pinned | null>(null);

  #ctx: ExplainContext | null = null;
  #showTimer: ReturnType<typeof setTimeout> | undefined;
  #leaveTimer: ReturnType<typeof setTimeout> | undefined;

  /** Show the card for `t` after the hover delay, or at once while a card is already showing. */
  hover(t: Target, x: number, y: number, rect?: DOMRect): void {
    clearTimeout(this.#leaveTimer);
    const open = this.hovered;
    if (open) {
      // The card stays where it first appeared while the pointer moves within one target.
      if (keyOf(open.target) !== keyOf(t)) this.hovered = { target: t, x, y, rect };
      clearTimeout(this.#showTimer);
      return;
    }
    clearTimeout(this.#showTimer);
    this.#showTimer = setTimeout(() => {
      this.hovered = { target: t, x, y, rect };
    }, HOVER_DELAY_MS);
  }

  /** Show the card for `t` now (keyboard focus, long-press). */
  showNow(t: Target, x: number, y: number, rect?: DOMRect): void {
    clearTimeout(this.#showTimer);
    clearTimeout(this.#leaveTimer);
    this.hovered = { target: t, x, y, rect };
  }

  /** The pointer left its target: hide the card shortly, unless another hover (or the card itself) takes over. */
  leave(): void {
    clearTimeout(this.#showTimer);
    clearTimeout(this.#leaveTimer);
    if (!this.hovered) return;
    this.#leaveTimer = setTimeout(() => {
      this.hovered = null;
    }, LEAVE_DELAY_MS);
  }

  /** The pointer is on the card: keep it. */
  hold(): void {
    clearTimeout(this.#leaveTimer);
  }

  /** Pin the card for `t` next to `rect`; one pin at a time. Pinning what is pinned already keeps its fold. */
  pin(t: Target, rect: DOMRect): void {
    const cur = this.pinned;
    if (cur && keyOf(cur.target) === keyOf(t)) {
      this.pinned = { ...cur, rect };
      return;
    }
    this.pinned = { target: t, rect, unfolded: false, scope: this.#ctx ? scopeKey(t, this.#ctx) : '' };
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
    clearTimeout(this.#showTimer);
    clearTimeout(this.#leaveTimer);
    this.pinned = null;
    this.hovered = null;
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
  target: Target | ((e: PointerEvent) => Target | null);
  /** True for controls whose click does a job: they never pin on click and unfold only through More. */
  acts?: boolean;
}

/** Register an element as a card target. */
export const tooltip: Action<HTMLElement | SVGElement, TooltipParams> = (node, initial) => {
  let params = initial;
  let pressTimer: ReturnType<typeof setTimeout> | undefined;
  let press: { x: number; y: number } | null = null;
  let swallowClick = false;
  let pointerDown = false;

  node.setAttribute('aria-describedby', TOOLTIP_LIVE_ID);

  const resolve = (e: PointerEvent): Target | null => (typeof params.target === 'function' ? params.target(e) : params.target);
  const staticTarget = (): Target | null => (typeof params.target === 'function' ? null : params.target);
  const isTouch = (e: Event) => (e as PointerEvent).pointerType === 'touch';
  const elementBox = () => node.getBoundingClientRect();
  const cancelPress = () => {
    clearTimeout(pressTimer);
    pressTimer = undefined;
    press = null;
  };

  const onHover = (e: PointerEvent) => {
    if (isTouch(e)) return; // touch gets its card from a tap (pin) or a long-press
    const t = resolve(e);
    if (t) params.ctl.hover(t, e.clientX, e.clientY);
    else params.ctl.leave();
  };
  const onLeave = (e: PointerEvent) => {
    if (isTouch(e)) return;
    params.ctl.leave();
  };

  const onPointerDown = (e: PointerEvent) => {
    pointerDown = true;
    swallowClick = false;
    if (!isTouch(e) || !params.acts) return;
    const t = resolve(e);
    if (!t) return;
    press = { x: e.clientX, y: e.clientY };
    pressTimer = setTimeout(() => {
      pressTimer = undefined;
      swallowClick = true;
      params.ctl.showNow(t, e.clientX, e.clientY, elementBox());
    }, LONG_PRESS_MS);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > LONG_PRESS_SLOP) cancelPress();
    onHover(e);
  };
  const onPointerEnd = () => {
    pointerDown = false;
    cancelPress();
  };

  // Capture phase, so a swallowed click never reaches the element's own handlers.
  const onClick = (e: MouseEvent) => {
    if (swallowClick) {
      swallowClick = false;
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (params.acts) return;
    const t = resolve(e as PointerEvent);
    if (!t) return;
    // A real pointer click pins beside the pointer (a canvas box is the whole canvas); a keyboard click beside the element.
    params.ctl.pin(t, e.detail > 0 ? boxOf(e.clientX, e.clientY) : elementBox());
  };

  const onContextMenu = (e: Event) => {
    if (pressTimer !== undefined || swallowClick) e.preventDefault();
  };

  const onFocus = () => {
    if (pointerDown) return; // a mouse press focuses too; the hover card is enough there
    const t = staticTarget();
    if (!t) return;
    const r = elementBox();
    params.ctl.showNow(t, r.left, r.bottom, r);
  };
  const onBlur = () => params.ctl.leave();

  const onKeyDown = (e: KeyboardEvent) => {
    pointerDown = false;
    const t = staticTarget();
    if (!t) return;
    if (e.key === 'Enter' && !params.acts) {
      params.ctl.pin(t, elementBox());
    } else if (e.key === '?') {
      params.ctl.pin(t, elementBox());
      params.ctl.unfold();
    }
  };

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
      params = next;
    },
    destroy() {
      cancelPress();
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
      node.removeAttribute('aria-describedby');
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
