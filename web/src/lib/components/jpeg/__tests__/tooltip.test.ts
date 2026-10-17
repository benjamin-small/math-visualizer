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
    expect(live.textContent).toContain('At quality 50 it rounds to');
    expect(el.getAttribute('aria-describedby')).toBe(live.id);
  });
});
