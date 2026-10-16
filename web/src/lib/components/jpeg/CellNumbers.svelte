<script lang="ts">
  // 64 numbers printed over an 8 × 8 panel the viz draws, one per cell, on the
  // same cell geometry (`layout.cells`). Hidden when the cells are too small
  // to hold a number legibly.
  import { cells, type Rect } from '../../jpeg/layout';

  interface Props {
    /** The 8 × 8 panel the numbers sit on, in CSS pixels. */
    rect: Rect;
    /** The 64 numbers, row-major. */
    values: readonly number[];
    /** Digits after the point. */
    digits?: number;
    /** Text colour: dark on light cells, light on dark ones. */
    shade?: (v: number) => 'dark' | 'light';
  }

  let { rect, values, digits = 0, shade = () => 'light' }: Props = $props();

  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const boxes = $derived(cells(rect, dpr));
  /** Below this cell width the numbers would overlap. */
  const MIN_CELL = 26;
  const show = $derived(boxes.length > 0 && boxes[0].w >= MIN_CELL);
  const fontPx = $derived(Math.max(9, Math.min(14, (boxes[0]?.w ?? 0) * 0.3)));
  const fmt = (v: number) => {
    const s = v.toFixed(digits);
    return s === '-0' || s === '-0.0' ? s.slice(1) : s;
  };
</script>

{#if show}
  {#each boxes as b, i}
    <span
      class="num mono {shade(values[i] ?? 0)}"
      style:left="{b.x}px"
      style:top="{b.y}px"
      style:width="{b.w}px"
      style:height="{b.h}px"
      style:font-size="{fontPx}px"
    >{fmt(values[i] ?? 0)}</span>
  {/each}
{/if}

<style>
  .num {
    position: absolute;
    display: grid;
    place-items: center;
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }
  .light { color: rgba(255, 255, 255, 0.9); text-shadow: 0 0 2px rgba(0, 0, 0, 0.6); }
  .dark { color: rgba(0, 0, 0, 0.8); text-shadow: 0 0 2px rgba(255, 255, 255, 0.5); }
</style>
