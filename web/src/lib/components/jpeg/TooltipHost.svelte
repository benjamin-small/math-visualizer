<script lang="ts">
  // Draws the JPEG lab's cards: the compact one for what the pointer or focus
  // is on, and the pinned one (compact plus, behind More, the details). It
  // owns Escape and outside-click dismissal and a hidden text element that
  // every target's aria-describedby points at.
  import { untrack } from 'svelte';
  import { explain, type Explanation, type ExplainContext } from '../../jpeg/explain';
  import Tex from '../Tex.svelte';
  import { placeCard, type Anchor } from './placeCard';
  import { TOOLTIP_LIVE_ID, basis, boxOf, type TooltipController } from './tooltip.svelte';

  interface Props {
    ctl: TooltipController;
    ctx: ExplainContext;
  }

  let { ctl, ctx }: Props = $props();

  let vw = $state(1024);
  let vh = $state(768);
  let hoverW = $state(0);
  let hoverH = $state(0);
  let pinW = $state(0);
  let pinH = $state(0);

  // The controller learns the context before anything reads it, so a pin made now gets the right scope.
  $effect.pre(() => {
    ctl.setContext(ctx);
  });

  const targetKey = (t: { id: string } | undefined | null) => (t ? JSON.stringify(t) : '');
  const hoverKey = $derived(targetKey(ctl.hovered?.target));
  const pinKey = $derived(targetKey(ctl.pinned?.target));

  // Re-explained whenever the context changes; position changes do not re-run it.
  const hoverCard = $derived.by<Explanation | null>(() => {
    void hoverKey;
    const h = untrack(() => ctl.hovered);
    return h ? explain(h.target, ctx) : null;
  });
  const pinCard = $derived.by<Explanation | null>(() => {
    void pinKey;
    const p = untrack(() => ctl.pinned);
    return p ? explain(p.target, ctx) : null;
  });

  // The pinned card is the same target's hover card made permanent, so the hover one steps aside.
  const showHover = $derived(hoverCard !== null && hoverKey !== pinKey);

  const hoverPos = $derived.by(() => {
    const h = ctl.hovered;
    if (!h) return { x: 0, y: 0 };
    const anchor: Anchor = h.rect && h.rect.width + h.rect.height > 0 ? { x: h.rect.left, y: h.rect.top, w: h.rect.width, h: h.rect.height } : { x: h.x, y: h.y };
    return placeCard(anchor, { w: hoverW || 320, h: hoverH || 110 }, { w: vw, h: vh });
  });
  const pinPos = $derived.by(() => {
    const p = ctl.pinned;
    if (!p) return { x: 0, y: 0 };
    const r = p.rect;
    const anchor: Anchor = r.width + r.height > 0 ? { x: r.left, y: r.top, w: r.width, h: r.height } : { x: r.left, y: r.top };
    return placeCard(anchor, { w: pinW || 320, h: pinH || 160 }, { w: vw, h: vh });
  });

  /** What a screen reader gets for a target: the shown card, as one run of text. */
  const liveText = $derived.by(() => {
    const e = showHover ? hoverCard : pinCard;
    if (!e) return '';
    return [e.title, e.value, e.body, e.consequence].filter(Boolean).join('. ');
  });

  function moreFromHover() {
    const h = ctl.hovered;
    if (!h) return;
    ctl.pin(h.target, h.rect ?? boxOf(h.x, h.y));
    ctl.unfold();
  }

  $effect(() => {
    const inCard = (e: Event) => e.target instanceof Element && e.target.closest('[data-tooltip-card]') !== null;
    // Dismissals never preventDefault or stop the event: the click that dismisses still does its job.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (ctl.pinned || ctl.hovered)) ctl.close();
    };
    const onDown = (e: PointerEvent) => {
      if (inCard(e)) return;
      ctl.unpin();
      if (e.pointerType === 'touch') ctl.close();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
    };
  });

  /** Report an element's size now and whenever it changes, so placement uses the real card. */
  function measure(node: HTMLElement, report: (w: number, h: number) => void) {
    const read = () => report(node.offsetWidth, node.offsetHeight);
    read();
    if (typeof ResizeObserver === 'undefined') return {};
    const ro = new ResizeObserver(read);
    ro.observe(node);
    return { destroy: () => ro.disconnect() };
  }

  function swatch(g: number): string {
    return `rgb(${g},${g},${g})`;
  }
</script>

<svelte:window bind:innerWidth={vw} bind:innerHeight={vh} />

{#snippet compact(e: Explanation)}
  <div class="title">{e.title}</div>
  {#if e.value}<div class="value">{e.value}</div>{/if}
  <p class="body">{e.body}</p>
  {#if e.consequence}<p class="consequence">{e.consequence}</p>{/if}
{/snippet}

<div id={TOOLTIP_LIVE_ID} hidden>{liveText}</div>

{#if showHover && hoverCard}
  {@const e = hoverCard}
  <div
    class="card"
    role="tooltip"
    data-testid="tooltip-hover"
    data-tooltip-card
    style:left="{hoverPos.x}px"
    style:top="{hoverPos.y}px"
    use:measure={(w, h) => ((hoverW = w), (hoverH = h))}
    onpointerenter={() => ctl.hold()}
    onpointerleave={() => ctl.leave()}
  >
    {@render compact(e)}
    {#if e.details.length > 0}
      <button type="button" class="more" onclick={moreFromHover}>More</button>
    {/if}
  </div>
{/if}

{#if ctl.pinned && pinCard}
  {@const e = pinCard}
  {@const unfolded = ctl.pinned.unfolded}
  <div
    class="card pinned"
    role="dialog"
    aria-label={e.title}
    data-testid="tooltip-pinned"
    data-tooltip-card
    style:left="{pinPos.x}px"
    style:top="{pinPos.y}px"
    use:measure={(w, h) => ((pinW = w), (pinH = h))}
  >
    <button type="button" class="close" aria-label="Close" onclick={() => ctl.close()}>
      <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M1.5 1.5L8.5 8.5M8.5 1.5L1.5 8.5" /></svg>
    </button>
    {@render compact(e)}
    {#if e.details.length > 0 && !unfolded}
      <button type="button" class="more" onclick={() => ctl.unfold()}>More</button>
    {/if}
    {#if unfolded}
      <div class="details" data-testid="tooltip-details">
        {#each e.details as d, i (i)}
          {#if d.kind === 'text'}
            <p class="body">{d.text}</p>
          {:else if d.kind === 'tex'}
            <div class="tex"><Tex tex={d.tex} display={false} /></div>
          {:else if d.kind === 'rows'}
            <dl class="rows">
              {#each d.rows as [k, v] (k)}
                <dt>{k}</dt>
                <dd>{v}</dd>
              {/each}
            </dl>
          {:else}
            <svg class="pattern" viewBox="0 0 8 8" width="96" height="96" role="img" aria-label="Pattern ({d.u}, {d.v})" shape-rendering="crispEdges">
              {#each basis(d.u, d.v) as g, k (k)}
                <rect x={k % 8} y={Math.floor(k / 8)} width="1" height="1" fill={swatch(g)} />
              {/each}
            </svg>
          {/if}
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .card {
    --ink: #ececf2;
    position: fixed;
    z-index: 1000;
    box-sizing: border-box;
    max-width: 320px;
    padding: 10px 12px;
    background: #23232a;
    color: rgba(255, 255, 255, 0.92);
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
    font-size: 12.5px;
    line-height: 1.45;
    text-align: left;
  }
  .pinned {
    max-height: 50vh;
    overflow-y: auto;
    padding-right: 30px;
  }
  .title {
    font-weight: 600;
  }
  .value {
    margin-top: 2px;
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 12.5px;
    color: #fff;
  }
  p {
    margin: 6px 0 0;
  }
  .consequence {
    color: rgba(255, 255, 255, 0.62);
  }
  .more {
    margin-top: 8px;
    padding: 0;
    background: none;
    border: 0;
    color: #e8a27a;
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
  }
  .close {
    position: absolute;
    top: 6px;
    right: 6px;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    padding: 0;
    background: none;
    border: 0;
    border-radius: 4px;
    color: rgba(255, 255, 255, 0.7);
    cursor: pointer;
  }
  .close:hover {
    background: rgba(255, 255, 255, 0.1);
  }
  .close path {
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    fill: none;
  }
  .details {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid rgba(255, 255, 255, 0.12);
  }
  .rows {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 10px;
    margin: 6px 0 0;
  }
  .rows dt {
    color: rgba(255, 255, 255, 0.62);
  }
  .rows dd {
    margin: 0;
    font-family: var(--font-mono, ui-monospace, monospace);
    text-align: right;
  }
  .tex {
    margin-top: 6px;
  }
  .pattern {
    display: block;
    margin: 8px 0 0;
    border: 1px solid rgba(255, 255, 255, 0.18);
  }
</style>
