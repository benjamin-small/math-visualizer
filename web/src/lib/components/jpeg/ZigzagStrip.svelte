<script lang="ts">
  // The 64 rounded coefficients in zigzag order, as one sequence: the ones the
  // scan path has reached are lit, and the run of zeros after the last
  // non-zero value is marked as the tail the next stage throws away.
  import type { Rect } from '../../jpeg/layout';
  import { lastNonZero } from '../../jpeg/formulas';

  interface Props {
    rect: Rect;
    /** The block's quantized values in zigzag order. */
    zigzag: readonly number[];
    /** How many cells the path has reached (0–64). */
    reached: number;
  }

  let { rect, zigzag, reached }: Props = $props();

  const last = $derived(lastNonZero(zigzag));
</script>

{#if rect.w > 120 && rect.h > 40}
  <div class="strip" style:left="{rect.x}px" style:top="{rect.y}px" style:width="{rect.w}px" style:height="{rect.h}px">
    <div class="head">Last non-zero: <span class="mono">#{last + 1}</span> of 64 — then {63 - last} zeros</div>
    <ol class="seq mono" aria-label="Coefficients in zigzag order">
      {#each zigzag as v, k}
        <li class:lit={k < reached} class:tail={k > last}>{v}</li>
      {/each}
    </ol>
  </div>
{/if}

<style>
  .strip { position: absolute; display: flex; flex-direction: column; gap: 6px; color: rgba(255, 255, 255, 0.72); font-size: 12px; }
  .head { white-space: nowrap; }
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
