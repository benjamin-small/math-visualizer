<script lang="ts">
  // The DCT stage's two charts, drawn in the room the layout leaves beside the
  // rebuild panel: how fast the block's energy is captured in zigzag order
  // (with the k slider's position), and "why cosines?" — the block's busiest row or column
  // extended the way the DFT assumes (repeated: a jump at every seam) and the
  // way the DCT assumes (mirrored: smooth), with how many terms each needs for
  // 95% of the row's energy. The transforms come from the Rust kit.
  import { onMount } from 'svelte';
  import { loadVizCore, type VizCore } from '../../wasm/loader';
  import type { Rect } from '../../jpeg/layout';
  import { busiestLine, cumulativeEnergy, mirrored, periodic, termsFor } from '../../jpeg/math';

  interface Props {
    /** The room the charts fill, in CSS pixels. */
    rect: Rect;
    /** The selected block's DCT and shifted samples, row-major. */
    dct: readonly number[];
    shifted: readonly number[];
    /** How many patterns the k slider keeps (0–64). */
    k: number;
  }

  let { rect, dct, shifted, k }: Props = $props();

  let kit = $state<VizCore | null>(null);
  onMount(() => {
    let alive = true;
    void loadVizCore().then((v) => {
      if (alive) kit = v;
    });
    return () => {
      alive = false;
    };
  });

  const order = $derived(kit ? Array.from(kit.jpeg_zigzag_order()) : []);
  const energy = $derived(order.length === 64 ? cumulativeEnergy(dct, order) : []);
  const lineInfo = $derived(busiestLine(shifted));
  const row = $derived(lineInfo.values);
  const dctTerms = $derived.by(() => {
    if (!kit) return 0;
    return termsFor(Array.from(kit.jpeg_dct_1d(new Float32Array(row))).map((c) => c * c), 0.95);
  });
  const dftTerms = $derived.by(() => {
    if (!kit) return 0;
    const z = Array.from(kit.jpeg_dft_1d(new Float32Array(row)));
    const e: number[] = [];
    for (let i = 0; i < z.length; i += 2) e.push(z[i] * z[i] + z[i + 1] * z[i + 1]);
    return termsFor(e, 0.95);
  });

  const half = $derived(Math.max(0, (rect.h - 16) / 2));
  const W = $derived(Math.max(0, rect.w));

  /** Polyline points for `ys` (in `[lo, hi]`) across a `w × h` box. */
  function line(ys: readonly number[], w: number, h: number, lo: number, hi: number): string {
    const span = hi - lo || 1;
    return ys
      .map((y, i) => `${((i / Math.max(1, ys.length - 1)) * w).toFixed(1)},${(h - ((y - lo) / span) * h).toFixed(1)}`)
      .join(' ');
  }
  const lo = $derived(Math.min(...row, 0) - 8);
  const hi = $derived(Math.max(...row, 0) + 8);
</script>

{#if rect.w > 80 && rect.h > 120}
  <div class="charts" style:left="{rect.x}px" style:top="{rect.y}px" style:width="{rect.w}px" style:height="{rect.h}px">
    <figure>
      <figcaption>Energy captured, zigzag order — {energy.length && k > 0 ? Math.round((energy[k - 1] ?? 0) * 100) : 0}% at k = {k}</figcaption>
      <svg width={W} height={half - 20} aria-hidden="true">
        <polyline class="curve" points={line(energy, W, half - 24, 0, 1)} />
        {#if k > 0}
          <line class="k" x1={((k - 1) / 63) * W} x2={((k - 1) / 63) * W} y1="0" y2={half - 24} />
        {/if}
      </svg>
    </figure>
    <figure>
      <figcaption>Why cosines? {lineInfo.axis === 'row' ? 'Row' : 'Column'} {lineInfo.index + 1}: repeated (DFT) needs {dftTerms} terms, mirrored (DCT) {dctTerms}, for 95%</figcaption>
      <svg width={W} height={half - 20} aria-hidden="true">
        <polyline class="dft" points={line(periodic(row, 3), W, (half - 24) / 2 - 4, lo, hi)} />
        <g transform="translate(0 {(half - 24) / 2 + 4})">
          <polyline class="dct" points={line(mirrored(row, 3), W, (half - 24) / 2 - 4, lo, hi)} />
        </g>
      </svg>
    </figure>
  </div>
{/if}

<style>
  .charts { position: absolute; display: grid; grid-template-rows: 1fr 1fr; gap: 16px; color: rgba(255, 255, 255, 0.72); }
  figure { margin: 0; }
  figcaption { font-size: 12px; margin-bottom: 6px; }
  svg { display: block; overflow: visible; }
  polyline { fill: none; stroke-width: 1.5; }
  .curve { stroke: #e27a52; }
  .k { stroke: rgba(255, 255, 255, 0.5); stroke-dasharray: 3 3; }
  .dft { stroke: #6ea0f0; }
  .dct { stroke: #e27a52; }
</style>
