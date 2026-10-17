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
  import type { Target } from '../../jpeg/explain';
  import { tooltip, type TooltipController } from './tooltip.svelte';

  interface Props {
    /** The room the charts fill, in CSS pixels. */
    rect: Rect;
    /** The selected block's DCT and shifted samples, row-major. */
    dct: readonly number[];
    shifted: readonly number[];
    /** How many patterns the k slider keeps (0–64). */
    k: number;
    /** The page's cards: the energy curve and the "why cosines" chart explain their points. */
    ctl: TooltipController;
  }

  let { rect, dct, shifted, k, ctl }: Props = $props();

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

  // Cards. The energy curve has one point per pattern (the x axis runs k = 1..64); the cosines chart has 24 points
  // (three copies of the row of eight) on each of its two curves, repeated above and mirrored below.
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
  /** The pattern count under the pointer, 1-64. */
  function energyAt(e: MouseEvent): Target | null {
    const box = (e.currentTarget as Element).getBoundingClientRect();
    return box.width > 0 ? { id: 'dct.energy', k: clamp(Math.round(((e.clientX - box.left) / box.width) * 63) + 1, 1, 64) } : null;
  }
  /** The curve and point under the pointer: the upper half of the chart is the repeated row, the lower half the mirrored. */
  function cosinesAt(e: MouseEvent): Target | null {
    const box = (e.currentTarget as Element).getBoundingClientRect();
    if (!(box.width > 0 && box.height > 0)) return null;
    return {
      id: 'dct.cosines',
      chart: e.clientY - box.top < box.height / 2 ? 'repeated' : 'mirrored',
      i: clamp(Math.round(((e.clientX - box.left) / box.width) * 23), 0, 23),
    };
  }

  /** Where the arrow keys have reached on each chart (null until they move: the k slider's pattern, the first point). */
  let energyKey = $state<number | null>(null);
  let cosKey = $state<{ chart: 'repeated' | 'mirrored'; i: number } | null>(null);
  const energyK = $derived(clamp(energyKey ?? (k > 0 ? k : 1), 1, 64));
  const cosNow = $derived(cosKey ?? { chart: 'repeated' as const, i: 0 });

  function onEnergyKey(e: KeyboardEvent) {
    if (e.altKey || e.metaKey || e.ctrlKey) return;
    const to = e.key === 'Home' ? 1 : e.key === 'End' ? 64 : null;
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (to === null && step === 0) return;
    e.preventDefault(); // not also a stage switch
    energyKey = to ?? clamp(energyK + step * (e.shiftKey ? 8 : 1), 1, 64);
  }
  function onCosinesKey(e: KeyboardEvent) {
    if (e.altKey || e.metaKey || e.ctrlKey) return;
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    const flip = e.key === 'ArrowUp' || e.key === 'ArrowDown';
    if (step === 0 && !flip) return;
    e.preventDefault();
    cosKey = flip
      ? { chart: cosNow.chart === 'repeated' ? 'mirrored' : 'repeated', i: cosNow.i }
      : { chart: cosNow.chart, i: clamp(cosNow.i + step * (e.shiftKey ? 8 : 1), 0, 23) };
  }
</script>

{#if rect.w > 80 && rect.h > 120}
  <div class="charts" style:left="{rect.x}px" style:top="{rect.y}px" style:width="{rect.w}px" style:height="{rect.h}px">
    <figure>
      <figcaption>Energy captured, zigzag order — {energy.length && k > 0 ? Math.round((energy[k - 1] ?? 0) * 100) : 0}% at k = {k}</figcaption>
      <!-- A focusable chart: the arrow keys walk the pattern counts, and its action shows each one's card. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <svg
        width={W}
        height={half - 20}
        role="group"
        aria-roledescription="chart"
        tabindex="0"
        aria-label="Energy captured in zigzag order. The arrow keys move between pattern counts."
        onkeydown={onEnergyKey}
        onblur={() => (energyKey = null)}
        use:tooltip={{ ctl, target: energyAt, keyTarget: () => ({ id: 'dct.energy', k: energyK }) }}
      >
        <polyline class="curve" points={line(energy, W, half - 24, 0, 1)} />
        {#if energyKey !== null}
          <line class="reach" x1={((energyK - 1) / 63) * W} x2={((energyK - 1) / 63) * W} y1="0" y2={half - 24} />
        {/if}
        {#if k > 0}
          <line class="k" x1={((k - 1) / 63) * W} x2={((k - 1) / 63) * W} y1="0" y2={half - 24} />
        {/if}
      </svg>
    </figure>
    <figure>
      <figcaption>Why cosines? {lineInfo.axis === 'row' ? 'Row' : 'Column'} {lineInfo.index + 1}: repeated (DFT) needs {dftTerms} terms, mirrored (DCT) {dctTerms}, for 95%</figcaption>
      <!-- A focusable chart: left and right walk the points, up and down switch curve. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <svg
        width={W}
        height={half - 20}
        role="group"
        aria-roledescription="chart"
        tabindex="0"
        aria-label="The row repeated and mirrored. The arrow keys move between points and curves."
        onkeydown={onCosinesKey}
        onblur={() => (cosKey = null)}
        use:tooltip={{ ctl, target: cosinesAt, keyTarget: () => ({ id: 'dct.cosines', chart: cosNow.chart, i: cosNow.i }) }}
      >
        <polyline class="dft" points={line(periodic(row, 3), W, (half - 24) / 2 - 4, lo, hi)} />
        <g transform="translate(0 {(half - 24) / 2 + 4})">
          <polyline class="dct" points={line(mirrored(row, 3), W, (half - 24) / 2 - 4, lo, hi)} />
        </g>
      </svg>
    </figure>
  </div>
{/if}

<style>
  .charts { position: absolute; pointer-events: auto; display: grid; grid-template-rows: 1fr 1fr; gap: 16px; color: rgba(255, 255, 255, 0.72); }
  figure { margin: 0; }
  figcaption { font-size: 12px; margin-bottom: 6px; }
  svg { display: block; overflow: visible; }
  svg:focus-visible { outline: 1px dashed var(--accent); outline-offset: 2px; }
  polyline { fill: none; stroke-width: 1.5; }
  .curve { stroke: #e27a52; }
  .k { stroke: rgba(255, 255, 255, 0.5); stroke-dasharray: 3 3; }
  .reach { stroke: #fff; stroke-width: 2; opacity: 0.6; }
  .dft { stroke: #6ea0f0; }
  .dct { stroke: #e27a52; }
</style>
