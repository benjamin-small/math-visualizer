<script lang="ts">
  // The 64 rounded coefficients in zigzag order, as one sequence: the ones the
  // scan path has reached are lit, and the run of zeros after the last
  // non-zero value is marked as the tail the next stage throws away.
  import type { Rect } from '../../jpeg/layout';
  import { lastNonZero } from '../../jpeg/formulas';
  import { tooltip, type TooltipController } from './tooltip.svelte';

  interface Props {
    rect: Rect;
    /** The block's quantized values in zigzag order. */
    zigzag: readonly number[];
    /** How many cells the path has reached (0–64). */
    reached: number;
    /** The page's cards: the figure and each cell explain themselves. */
    ctl: TooltipController;
  }

  let { rect, zigzag, reached, ctl }: Props = $props();

  const last = $derived(lastNonZero(zigzag));

  /** The one cell the Tab key reaches; the arrow keys move it along the sequence. */
  let rove = $state(0);

  function onCellKey(e: KeyboardEvent, k: number) {
    if (e.altKey || e.metaKey || e.ctrlKey) return;
    const to = e.key === 'ArrowRight' ? k + 1 : e.key === 'ArrowLeft' ? k - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? zigzag.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    e.stopPropagation(); // not also a stage switch
    const next = (e.currentTarget as HTMLElement).parentElement?.children[Math.min(zigzag.length - 1, Math.max(0, to))];
    if (next instanceof HTMLElement) next.focus();
  }
</script>

{#if rect.w > 120 && rect.h > 40}
  <div class="strip" style:left="{rect.x}px" style:top="{rect.y}px" style:width="{rect.w}px" style:height="{rect.h}px">
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="head" tabindex="0" use:tooltip={{ ctl, target: { id: 'zigzag.last' } }}>
      {#if last < 0}All 64 are zero{:else}Last non-zero: <span class="mono">#{last + 1}</span> of 64 — then {63 - last} zeros{/if}
    </div>
    <ol class="seq mono" aria-label="Coefficients in zigzag order">
      {#each zigzag as v, k}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
        <li
          class:lit={k < reached}
          class:tail={k > last}
          tabindex={k === rove ? 0 : -1}
          onfocus={() => (rove = k)}
          onkeydown={(e) => onCellKey(e, k)}
          use:tooltip={{ ctl, target: { id: 'zigzag.seq', k } }}
        >{v}</li>
      {/each}
    </ol>
  </div>
{/if}

<style>
  .strip { position: absolute; display: flex; flex-direction: column; gap: 6px; color: rgba(255, 255, 255, 0.72); font-size: 12px; overflow: auto; pointer-events: auto; }
  .head { white-space: nowrap; }
  .head:focus-visible, li:focus-visible { outline: 1px dashed var(--accent); outline-offset: 2px; }
  .seq { display: flex; flex-wrap: wrap; gap: 2px; margin: 0; padding: 0; list-style: none; }
  li {
    min-width: 26px;
    padding: 2px 0;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.05);
    text-align: center;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.45);
  }
  li.lit { background: rgba(226, 122, 82, 0.35); color: #fff; }
  li.tail { opacity: 0.45; text-decoration: line-through; text-decoration-color: rgba(255, 255, 255, 0.3); }
</style>
