import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { makeContext } from '../../../jpeg/explain/__tests__/fixture';
import type { ExplainContext, Target } from '../../../jpeg/explain';
import TooltipHost from '../TooltipHost.svelte';
import { TOOLTIP_LIVE_ID, TooltipController, tooltip, type TooltipParams } from '../tooltip.svelte';

const T10: Target = { id: 'dct.coeff', u: 1, v: 0 };
const T20: Target = { id: 'dct.coeff', u: 2, v: 0 };
const VALUE_10 = 'F(1,0) = −20.0';

/** jsdom has no PointerEvent: a MouseEvent carrying a pointerType does the job. */
function ptr(type: string, init: { pointerType?: string; x?: number; y?: number; bubbles?: boolean } = {}): MouseEvent {
  const e = new MouseEvent(type, { bubbles: init.bubbles ?? true, cancelable: true, clientX: init.x ?? 40, clientY: init.y ?? 40 });
  Object.defineProperty(e, 'pointerType', { value: init.pointerType ?? 'mouse' });
  return e;
}

let ctl: TooltipController;
let ctx: ExplainContext;
let host: ReturnType<typeof render>;
let destroyers: (() => void)[] = [];

function target(params: Partial<TooltipParams> & Pick<TooltipParams, 'target'>, tag = 'button'): HTMLElement {
  const el = document.createElement(tag);
  el.textContent = 'target';
  if (tag !== 'button') el.tabIndex = 0;
  document.body.append(el);
  const action = tooltip(el, { ctl, ...params });
  destroyers.push(() => action?.destroy?.(), () => el.remove());
  return el;
}

/** Like `target`, but hands back the action so a test can update or destroy it. */
function mounted(params: Partial<TooltipParams> & Pick<TooltipParams, 'target'>, tag = 'button') {
  const el = document.createElement(tag);
  el.textContent = 'target';
  if (tag !== 'button') el.tabIndex = 0;
  document.body.append(el);
  const action = tooltip(el, { ctl, ...params }) as { update: (p: TooltipParams) => void; destroy: () => void };
  destroyers.push(() => el.remove());
  return { el, action };
}

const advance = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
  await tick();
};
const hoverCard = () => screen.queryByRole('tooltip');
const pinnedCard = () => screen.queryByTestId('tooltip-pinned');

beforeEach(async () => {
  vi.useFakeTimers();
  ctl = new TooltipController();
  ctx = makeContext();
  host = render(TooltipHost, { props: { ctl, ctx } });
  await tick();
});

afterEach(() => {
  destroyers.forEach((d) => d());
  destroyers = [];
  cleanup();
  vi.useRealTimers();
});

describe('hover', () => {
  it('shows the compact card after 150 ms of hover', async () => {
    const el = target({ target: T10 });
    el.dispatchEvent(ptr('pointerenter', { bubbles: false }));
    await advance(100);
    expect(hoverCard()).toBeNull();
    await advance(50);
    expect(hoverCard()!.textContent).toContain(VALUE_10);
  });

  it('keeps the card while moving across a gap within 150 ms', async () => {
    const a = target({ target: T10 });
    const b = target({ target: T20 });
    a.dispatchEvent(ptr('pointerenter', { bubbles: false }));
    await advance(150);
    expect(hoverCard()!.textContent).toContain(VALUE_10);
    a.dispatchEvent(ptr('pointerleave', { bubbles: false }));
    await advance(60);
    expect(hoverCard()!.textContent).toContain(VALUE_10);
    b.dispatchEvent(ptr('pointerenter', { bubbles: false }));
    await tick();
    expect(hoverCard()!.textContent).toContain('F(2,0) = −20.0');
    await advance(500);
    expect(hoverCard()!.textContent).toContain('F(2,0)');
  });

  it('hides the card 120 ms after the pointer leaves', async () => {
    const el = target({ target: T10 });
    el.dispatchEvent(ptr('pointerenter', { bubbles: false }));
    await advance(150);
    el.dispatchEvent(ptr('pointerleave', { bubbles: false }));
    await advance(100);
    expect(hoverCard()).not.toBeNull();
    await advance(30);
    expect(hoverCard()).toBeNull();
  });

  it('shows nothing when the pointer leaves before the delay', async () => {
    const el = target({ target: T10 });
    el.dispatchEvent(ptr('pointerenter', { bubbles: false }));
    await advance(100);
    el.dispatchEvent(ptr('pointerleave', { bubbles: false }));
    await advance(500);
    expect(hoverCard()).toBeNull();
  });

  it('asks a hit-test function which target is under the pointer, and nothing for null', async () => {
    let under: Target | null = T10;
    const el = target({ target: () => under });
    el.dispatchEvent(ptr('pointermove', { bubbles: false }));
    await advance(150);
    expect(hoverCard()!.textContent).toContain(VALUE_10);
    under = T20;
    el.dispatchEvent(ptr('pointermove', { bubbles: false }));
    await tick();
    expect(hoverCard()!.textContent).toContain('F(2,0)');
    under = null;
    el.dispatchEvent(ptr('pointermove', { bubbles: false }));
    await advance(130);
    expect(hoverCard()).toBeNull();
  });

  it('shows no hover card for a touch pointer', async () => {
    const el = target({ target: T10 });
    el.dispatchEvent(ptr('pointerenter', { pointerType: 'touch', bubbles: false }));
    await advance(300);
    expect(hoverCard()).toBeNull();
  });
});

describe('pinning', () => {
  it('pins on click for a non-acting target and keeps it on leave', async () => {
    const el = target({ target: T10 }, 'span');
    el.dispatchEvent(ptr('pointerenter', { bubbles: false }));
    await advance(150);
    el.click();
    await tick();
    expect(ctl.pinned?.target).toEqual(T10);
    expect(pinnedCard()!.textContent).toContain(VALUE_10);
    // The compact card steps aside for its own pinned twin.
    expect(hoverCard()).toBeNull();
    el.dispatchEvent(ptr('pointerleave', { bubbles: false }));
    await advance(1000);
    expect(pinnedCard()!.textContent).toContain(VALUE_10);
  });

  it('does not pin on the click that ends a drag, but pins a click that barely moved', async () => {
    const el = target({ target: T10 }, 'span');
    const click = (x: number, y: number) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y, detail: 1 }));
    // Press at (40, 40), drag 30 px, release: the click that follows ends a drag (an orbit, a scrub), not a request for a card.
    el.dispatchEvent(ptr('pointerdown', { x: 40, y: 40 }));
    el.dispatchEvent(ptr('pointermove', { x: 70, y: 40 }));
    el.dispatchEvent(ptr('pointerup', { x: 70, y: 40 }));
    click(70, 40);
    await tick();
    expect(ctl.pinned).toBeNull();
    // A press that moves 3 px is still a click.
    el.dispatchEvent(ptr('pointerdown', { x: 40, y: 40 }));
    el.dispatchEvent(ptr('pointerup', { x: 43, y: 40 }));
    click(43, 40);
    await tick();
    expect(ctl.pinned?.target).toEqual(T10);
  });

  it('allows a fingertip more drift than a mouse before a tap stops being a click', async () => {
    const el = target({ target: T10 }, 'span');
    const click = (x: number, y: number) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y, detail: 1 }));
    // A touch tap that drifts 8 px still pins.
    el.dispatchEvent(ptr('pointerdown', { pointerType: 'touch', x: 40, y: 40 }));
    el.dispatchEvent(ptr('pointerup', { pointerType: 'touch', x: 48, y: 40 }));
    click(48, 40);
    await tick();
    expect(ctl.pinned?.target).toEqual(T10);
    ctl.unpin();
    // A touch that drifts 20 px is a drag.
    el.dispatchEvent(ptr('pointerdown', { pointerType: 'touch', x: 40, y: 40 }));
    el.dispatchEvent(ptr('pointerup', { pointerType: 'touch', x: 60, y: 40 }));
    click(60, 40);
    await tick();
    expect(ctl.pinned).toBeNull();
    // A mouse press that drifts 8 px is a drag already.
    el.dispatchEvent(ptr('pointerdown', { x: 40, y: 40 }));
    el.dispatchEvent(ptr('pointerup', { x: 48, y: 40 }));
    click(48, 40);
    await tick();
    expect(ctl.pinned).toBeNull();
  });

  it('leaves Enter and ? on a nested target to the nested target', async () => {
    const outer = target({ target: T20 }, 'div');
    const inner = document.createElement('span');
    inner.tabIndex = 0;
    outer.append(inner);
    const action = tooltip(inner, { ctl, target: T10 });
    destroyers.push(() => action?.destroy?.());
    inner.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await tick();
    expect(ctl.pinned?.target).toEqual(T10); // the outer one did not pin its own card over it
    ctl.unpin();
    inner.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true, cancelable: true }));
    await tick();
    expect(ctl.pinned?.target).toEqual(T10);
    expect(ctl.pinned?.unfolded).toBe(true);
  });

  it('does not pin on click for an acting target; More unfolds it instead', async () => {
    const spy = vi.fn();
    const el = target({ target: T10, acts: true });
    el.addEventListener('click', spy);
    el.dispatchEvent(ptr('pointerenter', { bubbles: false }));
    await advance(150);
    el.click();
    await tick();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(ctl.pinned).toBeNull();
    screen.getByRole('button', { name: 'More' }).click();
    await tick();
    expect(ctl.pinned?.unfolded).toBe(true);
    expect(screen.getByTestId('tooltip-details')).toBeTruthy();
  });

  it('shows the details only after More on a pinned card', async () => {
    const el = target({ target: T10 }, 'span');
    el.click();
    await tick();
    expect(screen.queryByTestId('tooltip-details')).toBeNull();
    screen.getByRole('button', { name: 'More' }).click();
    await tick();
    const details = screen.getByTestId('tooltip-details');
    expect(details.querySelector('svg[role="img"]')!.querySelectorAll('rect').length).toBe(64);
    expect(details.textContent).toContain('Share of the block');
  });

  it('closes with the close button', async () => {
    target({ target: T10 }, 'span').click();
    await tick();
    screen.getByRole('button', { name: 'Close' }).click();
    await tick();
    expect(pinnedCard()).toBeNull();
  });

  it('Escape and outside clicks close the pin; the outside click still reaches its target', async () => {
    const el = target({ target: T10 }, 'span');
    const outside = document.createElement('button');
    const spy = vi.fn();
    outside.addEventListener('click', spy);
    document.body.append(outside);
    destroyers.push(() => outside.remove());

    el.click();
    await tick();
    expect(pinnedCard()).not.toBeNull();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick();
    expect(pinnedCard()).toBeNull();

    el.click();
    await tick();
    expect(pinnedCard()).not.toBeNull();
    const down = ptr('pointerdown');
    outside.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false);
    outside.click();
    await tick();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(pinnedCard()).toBeNull();
  });

  it('keeps the pin when the press is inside the card', async () => {
    target({ target: T10 }, 'span').click();
    await tick();
    pinnedCard()!.dispatchEvent(ptr('pointerdown'));
    await tick();
    expect(pinnedCard()).not.toBeNull();
  });

  it('allows one pin at a time', async () => {
    const a = target({ target: T10 }, 'span');
    const b = target({ target: T20 }, 'span');
    a.click();
    b.click();
    await tick();
    expect(ctl.pinned?.target).toEqual(T20);
    expect(screen.getAllByTestId('tooltip-pinned')).toHaveLength(1);
  });

  it('closes a pinned card when its scope changes, and re-explains it when only the numbers change', async () => {
    target({ target: T10 }, 'span').click();
    await tick();
    expect(pinnedCard()!.textContent).toContain('At quality 50');

    await host.rerender({ ctl, ctx: makeContext({ quality: 50, summary: { ...ctx.summary!, quality: 20 } }) });
    await tick();
    expect(pinnedCard()!.textContent).toContain('At quality 20');

    const sel = ctx.summary!.selected!;
    await host.rerender({ ctl, ctx: makeContext({ summary: { ...ctx.summary!, selected: { ...sel, bx: sel.bx + 1 } } }) });
    await tick();
    expect(ctl.pinned).toBeNull();
    expect(pinnedCard()).toBeNull();
  });

  it('closes a pinned card when the picture or the stage changes', async () => {
    target({ target: T10 }, 'span').click();
    await tick();
    await host.rerender({ ctl, ctx: makeContext({ imageId: 'upload' }) });
    expect(ctl.pinned).toBeNull();
    target({ target: T10 }, 'span').click();
    await tick();
    await host.rerender({ ctl, ctx: makeContext({ imageId: 'upload', stage: 'quantize' }) });
    expect(ctl.pinned).toBeNull();
  });
});

describe('touch', () => {
  it('long-press shows the card and swallows the click', async () => {
    const spy = vi.fn();
    const el = target({ target: T10, acts: true });
    el.addEventListener('click', spy);
    el.dispatchEvent(ptr('pointerdown', { pointerType: 'touch' }));
    await advance(500);
    expect(hoverCard()!.textContent).toContain(VALUE_10);
    el.dispatchEvent(ptr('pointerup', { pointerType: 'touch' }));
    el.click();
    await tick();
    expect(spy).not.toHaveBeenCalled();
    expect(hoverCard()).not.toBeNull();
    // The next, ordinary click goes through.
    el.dispatchEvent(ptr('pointerdown', { pointerType: 'touch' }));
    await advance(100);
    el.dispatchEvent(ptr('pointerup', { pointerType: 'touch' }));
    el.click();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('a short tap calls the click and shows no card', async () => {
    const spy = vi.fn();
    const el = target({ target: T10, acts: true });
    el.addEventListener('click', spy);
    el.dispatchEvent(ptr('pointerdown', { pointerType: 'touch' }));
    await advance(100);
    el.dispatchEvent(ptr('pointerup', { pointerType: 'touch' }));
    el.click();
    await advance(1000);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(hoverCard()).toBeNull();
  });

  it('a touch that drifts is not a long-press', async () => {
    const el = target({ target: T10, acts: true });
    el.dispatchEvent(ptr('pointerdown', { pointerType: 'touch', x: 10, y: 10 }));
    el.dispatchEvent(ptr('pointermove', { pointerType: 'touch', x: 60, y: 10 }));
    await advance(600);
    expect(hoverCard()).toBeNull();
  });

  it('tapping a non-acting target pins it', async () => {
    const el = target({ target: T10 }, 'span');
    el.dispatchEvent(ptr('pointerdown', { pointerType: 'touch' }));
    el.dispatchEvent(ptr('pointerup', { pointerType: 'touch' }));
    el.click();
    await tick();
    expect(pinnedCard()!.textContent).toContain(VALUE_10);
  });
});

describe('keyboard', () => {
  it('focus shows the compact card, Enter pins, ? unfolds', async () => {
    const el = target({ target: T10 }, 'span');
    el.focus();
    await tick();
    expect(hoverCard()!.textContent).toContain(VALUE_10);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await tick();
    expect(ctl.pinned?.unfolded).toBe(false);
    expect(pinnedCard()!.textContent).toContain(VALUE_10);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));
    await tick();
    expect(ctl.pinned?.unfolded).toBe(true);
    expect(screen.getByTestId('tooltip-details')).toBeTruthy();
  });

  it('Enter on a non-acting target is handled (default prevented, so it cannot reach the Close button the pin focuses); on an acting target it is left alone', async () => {
    const pins = target({ target: T10 }, 'span');
    pins.focus();
    const enter = () => new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    const a = enter();
    pins.dispatchEvent(a);
    expect(a.defaultPrevented).toBe(true);
    ctl.close();
    const acts = target({ target: T20, acts: true }, 'span');
    acts.focus();
    const b = enter();
    acts.dispatchEvent(b);
    expect(b.defaultPrevented).toBe(false);
  });

  it('Enter does not pin an acting target, but ? unfolds its card', async () => {
    const el = target({ target: T10, acts: true });
    el.focus();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(ctl.pinned).toBeNull();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));
    await tick();
    expect(ctl.pinned?.unfolded).toBe(true);
  });

  it('blur hides the focus card; Escape dismisses it', async () => {
    const el = target({ target: T10 }, 'span');
    el.focus();
    await tick();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick();
    expect(hoverCard()).toBeNull();
    el.focus();
    el.blur();
    await advance(130);
    expect(hoverCard()).toBeNull();
  });

  it("the target's accessible description is the compact text", async () => {
    const el = target({ target: T10 });
    expect(el.getAttribute('aria-describedby')).toBe(TOOLTIP_LIVE_ID);
    el.focus();
    await tick();
    const live = document.getElementById(TOOLTIP_LIVE_ID)!;
    expect(live.textContent).toContain(VALUE_10);
    expect(live.textContent).toContain('At quality 50, it rounds to');
    expect(live.textContent).not.toContain('..');
    expect(el.getAttribute('aria-describedby')).toBe(live.id);
  });
});

describe('the cards sit in the body', () => {
  it('portals the hover and pinned cards to the end of <body>, and takes them away again', async () => {
    const el = target({ target: T10 });
    el.dispatchEvent(ptr('pointerenter', { bubbles: false }));
    await advance(150);
    expect(hoverCard()!.parentElement).toBe(document.body);
    el.click();
    await tick();
    expect(pinnedCard()!.parentElement).toBe(document.body);
    ctl.close();
    await tick();
    expect(pinnedCard()).toBeNull();
    expect(hoverCard()).toBeNull();
  });
});

describe('hover ownership', () => {
  it('destroying the action while its card shows hides the card after 120 ms', async () => {
    const { el, action } = mounted({ target: T10 });
    el.dispatchEvent(ptr('pointerenter', { bubbles: false }));
    await advance(150);
    expect(hoverCard()).not.toBeNull();
    action.destroy();
    el.remove();
    await advance(100);
    expect(hoverCard()).not.toBeNull();
    await advance(30);
    expect(hoverCard()).toBeNull();
  });

  it('destroying the action cancels its pending hover', async () => {
    const { el, action } = mounted({ target: T10 });
    el.dispatchEvent(ptr('pointerenter', { bubbles: false }));
    await advance(50);
    action.destroy();
    await advance(500);
    expect(hoverCard()).toBeNull();
  });

  it('updating the target while it shows shows the new target', async () => {
    const { el, action } = mounted({ target: T10 });
    el.dispatchEvent(ptr('pointerenter', { bubbles: false }));
    await advance(150);
    action.update({ ctl, target: T20 });
    await tick();
    expect(hoverCard()!.textContent).toContain('F(2,0)');
    expect(hoverCard()!.textContent).not.toContain('F(1,0)');
  });

  it('updating to a hit-test function hides the old target card', async () => {
    const { el, action } = mounted({ target: T10 });
    el.dispatchEvent(ptr('pointerenter', { bubbles: false }));
    await advance(150);
    action.update({ ctl, target: () => null });
    await tick();
    expect(hoverCard()).toBeNull();
  });

  it('updating a node that does not own the card leaves it alone', async () => {
    const a = mounted({ target: T10 });
    const b = mounted({ target: T20 });
    a.el.dispatchEvent(ptr('pointerenter', { bubbles: false }));
    await advance(150);
    b.action.update({ ctl, target: { id: 'dct.coeff', u: 3, v: 0 } });
    await tick();
    expect(hoverCard()!.textContent).toContain('F(1,0)');
  });

  it("blurring A while the pointer hovers B leaves B's card", async () => {
    const a = mounted({ target: T10 }, 'span');
    const b = mounted({ target: T20 }, 'span');
    a.el.focus();
    await tick();
    b.el.dispatchEvent(ptr('pointerenter', { bubbles: false }));
    await tick();
    expect(hoverCard()!.textContent).toContain('F(2,0)');
    a.el.blur();
    await advance(500);
    expect(hoverCard()!.textContent).toContain('F(2,0)');
  });

  it('the controller can be disposed: timers stop, and unmounting the host disposes it', async () => {
    const el = target({ target: T10 });
    el.dispatchEvent(ptr('pointerenter', { bubbles: false }));
    await advance(50);
    ctl.dispose();
    await advance(500);
    expect(ctl.hovered).toBeNull();

    el.dispatchEvent(ptr('pointerenter', { bubbles: false }));
    await advance(150);
    expect(ctl.hovered).not.toBeNull();
    el.dispatchEvent(ptr('pointerleave', { bubbles: false }));
    host.unmount();
    await advance(500);
    expect(ctl.hovered).toBeNull();
  });

  it('ignores a touch pointer leaving the hover card', async () => {
    const el = target({ target: T10 });
    el.dispatchEvent(ptr('pointerenter', { bubbles: false }));
    await advance(150);
    const card = hoverCard()!;
    card.dispatchEvent(ptr('pointerenter', { bubbles: false }));
    card.dispatchEvent(ptr('pointerleave', { pointerType: 'touch', bubbles: false }));
    await advance(500);
    expect(hoverCard()).not.toBeNull();
    card.dispatchEvent(ptr('pointerleave', { bubbles: false }));
    await advance(130);
    expect(hoverCard()).toBeNull();
  });
});

describe('the pinned card', () => {
  it('keeps the Close button outside the scrolling part', async () => {
    target({ target: T10 }, 'span').click();
    await tick();
    screen.getByRole('button', { name: 'More' }).click();
    await tick();
    const card = pinnedCard()!;
    const scroller = card.querySelector('.scroll')!;
    const close = screen.getByRole('button', { name: 'Close' });
    expect(scroller).toBeTruthy();
    expect(scroller.contains(close)).toBe(false);
    expect(scroller.contains(screen.getByTestId('tooltip-details'))).toBe(true);
    expect(card.getAttribute('aria-modal')).toBe('false');
    expect(card.getAttribute('aria-label')).toBeTruthy();
  });

  it('moves focus into the card on a keyboard pin and back to the target on close', async () => {
    const el = target({ target: T10 }, 'span');
    el.focus();
    await tick();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await tick();
    const card = pinnedCard()!;
    expect(card.contains(document.activeElement)).toBe(true);
    expect(document.activeElement!.tagName).toBe('BUTTON');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick();
    expect(pinnedCard()).toBeNull();
    expect(document.activeElement).toBe(el);
  });

  it('Escape after the reader tabbed out of the pinned card leaves focus where it went', async () => {
    const el = target({ target: T10 }, 'span');
    const elsewhere = document.createElement('button');
    document.body.append(elsewhere);
    destroyers.push(() => elsewhere.remove());
    el.focus();
    await tick();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await tick();
    expect(pinnedCard()!.contains(document.activeElement)).toBe(true);
    elsewhere.focus(); // Tab out of the card
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick();
    expect(pinnedCard()).toBeNull();
    expect(document.activeElement).toBe(elsewhere);
  });

  it('Escape still gives focus back when it has fallen to the page body', async () => {
    const el = target({ target: T10 }, 'span');
    el.focus();
    await tick();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await tick();
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick();
    expect(document.activeElement).toBe(el);
  });

  it('returns focus to the target when the Close button is used', async () => {
    const el = target({ target: T10 }, 'span');
    el.focus();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));
    await tick();
    expect(ctl.pinned?.unfolded).toBe(true);
    expect(pinnedCard()!.contains(document.activeElement)).toBe(true);
    screen.getByRole('button', { name: 'Close' }).click();
    await tick();
    expect(document.activeElement).toBe(el);
  });

  it('does not steal focus on a pointer pin', async () => {
    const el = target({ target: T10 }, 'span');
    el.focus();
    el.dispatchEvent(ptr('pointerdown'));
    el.click();
    await tick();
    expect(pinnedCard()).not.toBeNull();
    expect(pinnedCard()!.contains(document.activeElement)).toBe(false);
    expect(document.activeElement).toBe(el);
  });
});

describe('keyTarget', () => {
  it('shows the key target for a hit-tested element on focus, and pins it on Enter', async () => {
    const el = target({ target: () => null, keyTarget: () => T20 }, 'span');
    el.focus();
    await tick();
    expect(hoverCard()!.textContent).toContain('F(2,0) = −20.0');
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await tick();
    expect(ctl.pinned?.target).toEqual(T20);
  });

  const arrow = (key = 'ArrowRight') => new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });

  it('an arrow key on a focused roving node shows the card for the cell it moved to', async () => {
    let cell: Target = T10;
    const grid = target({ target: () => null, keyTarget: () => cell }, 'span');
    grid.focus();
    await tick();
    expect(hoverCard()!.textContent).toContain('F(1,0)');
    cell = T20; // the owner's own key handler moves its state; the action then re-reads keyTarget
    grid.dispatchEvent(arrow());
    await advance(0);
    expect(hoverCard()!.textContent).toContain('F(2,0)');
    cell = { id: 'dct.coeff', u: 2, v: 1 };
    grid.dispatchEvent(arrow('ArrowDown'));
    await advance(0);
    expect(hoverCard()!.textContent).toContain('F(2,1)');
  });

  it("reads the cell after a handler delegated to the document has moved it (Svelte's onkeydown)", async () => {
    let cell: Target = T10;
    const grid = target({ target: () => null, keyTarget: () => cell }, 'span');
    const move = () => (cell = T20);
    document.addEventListener('keydown', move);
    destroyers.push(() => document.removeEventListener('keydown', move));
    grid.focus();
    await tick();
    grid.dispatchEvent(arrow());
    await advance(0);
    expect(hoverCard()!.textContent).toContain('F(2,0)');
  });

  it("the grid's refreshed card is its own: another node's pointer leaving does not hide it", async () => {
    let cell: Target = T10;
    const grid = target({ target: () => null, keyTarget: () => cell }, 'span');
    const other = mounted({ target: T20 }, 'span');
    grid.focus();
    await tick();
    other.el.dispatchEvent(ptr('pointerenter', { bubbles: false })); // a pointer on another node takes the card
    await tick();
    expect(hoverCard()!.textContent).toContain('F(2,0)');
    cell = { id: 'dct.coeff', u: 3, v: 0 };
    grid.dispatchEvent(arrow());
    await advance(0);
    expect(hoverCard()!.textContent).toContain('F(3,0)');
    other.el.dispatchEvent(ptr('pointerleave', { bubbles: false }));
    await advance(500);
    expect(hoverCard()!.textContent).toContain('F(3,0)');
  });

  it('an arrow key shows the card again for a focused node whose card was hidden, but Escape and Tab do not', async () => {
    let cell: Target = T10;
    const grid = target({ target: () => null, keyTarget: () => cell }, 'span');
    grid.focus();
    await tick();
    grid.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await advance(0);
    expect(hoverCard()).toBeNull();
    grid.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    await advance(0);
    expect(hoverCard()).toBeNull();
    cell = T20;
    grid.dispatchEvent(arrow());
    await advance(0);
    expect(hoverCard()!.textContent).toContain('F(2,0)');
  });

  it('hides the card when the moved-to cell has none', async () => {
    let cell: Target | null = T10;
    const grid = target({ target: () => null, keyTarget: () => cell }, 'span');
    grid.focus();
    await tick();
    cell = null;
    grid.dispatchEvent(arrow());
    await advance(0);
    expect(hoverCard()).toBeNull();
  });

  it('shows nothing on focus for a hit-tested element without one, or when it returns null', async () => {
    const a = target({ target: () => T10 }, 'span');
    a.focus();
    await tick();
    expect(hoverCard()).toBeNull();
    const b = target({ target: () => T10, keyTarget: () => null }, 'span');
    b.focus();
    await tick();
    expect(hoverCard()).toBeNull();
  });
});

describe('stale flags', () => {
  const abortedLongPress = async (el: HTMLElement) => {
    el.dispatchEvent(ptr('pointerdown', { pointerType: 'touch' }));
    await advance(500);
    el.dispatchEvent(ptr('pointerup', { pointerType: 'touch' }));
  };

  it('a keyboard click after an aborted long-press is not swallowed', async () => {
    const spy = vi.fn();
    const el = target({ target: T10, acts: true });
    el.addEventListener('click', spy);
    await abortedLongPress(el);
    await advance(450);
    el.click();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('any key press clears a swallow that never met its click', async () => {
    const spy = vi.fn();
    const el = target({ target: T10, acts: true });
    el.addEventListener('click', spy);
    await abortedLongPress(el);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    el.click();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('a mouse leaving clears a swallow', async () => {
    const spy = vi.fn();
    const el = target({ target: T10, acts: true });
    el.addEventListener('click', spy);
    el.dispatchEvent(ptr('pointerdown', { pointerType: 'touch' }));
    await advance(500);
    el.dispatchEvent(ptr('pointerleave', { pointerType: 'mouse', bubbles: false }));
    el.click();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('the click that follows a touch pointerleave is still swallowed', async () => {
    const spy = vi.fn();
    const el = target({ target: T10, acts: true });
    el.addEventListener('click', spy);
    await abortedLongPress(el);
    el.dispatchEvent(ptr('pointerleave', { pointerType: 'touch', bubbles: false }));
    el.click();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('aria-describedby', () => {
  it("adds the host's id to a component's own value and removes only that token", () => {
    const el = document.createElement('button');
    el.setAttribute('aria-describedby', 'mine other');
    document.body.append(el);
    const action = tooltip(el, { ctl, target: T10 })!;
    expect(el.getAttribute('aria-describedby')!.split(' ')).toEqual(['mine', 'other', TOOLTIP_LIVE_ID]);
    action.destroy!();
    expect(el.getAttribute('aria-describedby')).toBe('mine other');
    el.remove();
  });

  it('removes the attribute when the host id was the only token', () => {
    const el = document.createElement('button');
    document.body.append(el);
    const action = tooltip(el, { ctl, target: T10 })!;
    expect(el.getAttribute('aria-describedby')).toBe(TOOLTIP_LIVE_ID);
    action.destroy!();
    expect(el.hasAttribute('aria-describedby')).toBe(false);
    el.remove();
  });
});

describe('? on form controls', () => {
  const question = (el: HTMLElement) => {
    const e = new KeyboardEvent('keydown', { key: '?', bubbles: true, cancelable: true });
    el.dispatchEvent(e);
    return e;
  };

  it.each([['range'], ['radio'], ['checkbox']])('unfolds the card from a %s input', async (type) => {
    const input = document.createElement('input');
    input.type = type;
    document.body.append(input);
    const action = tooltip(input, { ctl, target: T10, acts: true })!;
    destroyers.push(() => action.destroy!(), () => input.remove());
    question(input);
    await tick();
    expect(ctl.pinned?.unfolded).toBe(true);
  });

  it('unfolds the card from a select', async () => {
    const select = document.createElement('select');
    document.body.append(select);
    const action = tooltip(select, { ctl, target: T10, acts: true })!;
    destroyers.push(() => action.destroy!(), () => select.remove());
    question(select);
    await tick();
    expect(ctl.pinned?.unfolded).toBe(true);
  });

  it.each([[''], ['text'], ['search'], ['number'], ['email'], ['password']])('still types ? into a text-like input (type "%s")', async (type) => {
    const input = document.createElement('input');
    if (type) input.type = type;
    document.body.append(input);
    const action = tooltip(input, { ctl, target: T10, acts: true })!;
    destroyers.push(() => action.destroy!(), () => input.remove());
    question(input);
    await tick();
    expect(ctl.pinned).toBeNull();
  });

  it('still types ? into a textarea', async () => {
    const area = document.createElement('textarea');
    document.body.append(area);
    const action = tooltip(area, { ctl, target: T10, acts: true })!;
    destroyers.push(() => action.destroy!(), () => area.remove());
    question(area);
    await tick();
    expect(ctl.pinned).toBeNull();
  });
});

describe('small things', () => {
  it('ignores ? typed into a text field inside a target', async () => {
    const el = target({ target: T10 }, 'div');
    const input = document.createElement('input');
    el.append(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));
    await tick();
    expect(ctl.pinned).toBeNull();
  });
});
