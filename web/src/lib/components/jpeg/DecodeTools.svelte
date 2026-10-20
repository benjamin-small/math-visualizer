<script lang="ts">
  // The Decode stage's controls and its generation-loss chart: the wipe
  // between decoded and original, how far the wipe and the error map are
  // magnified around the current block, the error map's brightness, buttons that
  // jump to where blocking, ringing and colour bleed are worst, and "Re-save"
  // — decode, encode again with the same settings, repeat — plotting how far
  // each generation has drifted from the original.
  import { onDestroy } from 'svelte';
  import { loadVizCore } from '../../wasm/loader';
  import { DECODE_TOOLS, DECODE_ZOOMS, type Rect } from '../../jpeg/layout';
  import type { RgbaImage } from '../../jpeg/images';
  import type { Hints } from '../../jpeg/summary';
  import { psnrOf } from '../../jpeg/math';
  import type { Target } from '../../jpeg/explain';
  import { tooltip, type TooltipController } from './tooltip.svelte';

  interface Props {
    rect: Rect;
    image: RgbaImage;
    quality: number;
    subsampling: string;
    huffman: string;
    hints: Hints | null;
    /** True while custom quantization tables are in use (Re-save cannot use them). */
    custom: boolean;
    wipe: number;
    /** The zoom factor in use (one of `DECODE_ZOOMS`; 1 is the whole picture). */
    zoom: number;
    gain: number;
    onwipe: (v: number) => void;
    /** Choose a zoom factor. */
    onzoom: (f: number) => void;
    ongain: (v: number) => void;
    /** Select a luma block (from a hint). */
    onpick: (block: [number, number]) => void;
    /** The page's cards: the sliders, the hint buttons and the chart's points explain themselves. */
    ctl: TooltipController;
    /** PSNR per re-save generation (generation 1 is the first save); the page's cards read it. */
    history?: number[];
  }

  let { rect, image, quality, subsampling, huffman, hints, custom, wipe, zoom, gain, onwipe, onzoom, ongain, onpick, ctl, history = $bindable([]) }: Props = $props();

  /** Generations re-saved per click. */
  const GENERATIONS = 20;
  let running = $state(false);
  let frame = 0;

  // A new picture or new settings start a fresh history.
  $effect(() => {
    void [image, quality, subsampling, huffman];
    cancelAnimationFrame(frame);
    running = false;
    history = [];
  });
  onDestroy(() => cancelAnimationFrame(frame));

  async function resave() {
    if (running) return;
    let viz: Awaited<ReturnType<typeof loadVizCore>>;
    try {
      viz = await loadVizCore();
    } catch {
      running = false;
      return;
    }
    running = true;
    history = [];
    let current = image.rgba;
    const step = () => {
      if (!running) return;
      try {
        current = viz.jpeg_encode_decode(current, image.w, image.h, quality, subsampling, huffman);
        history = [...history, psnrOf(image.rgba, current)];
      } catch {
        running = false;
        return;
      }
      if (history.length < GENERATIONS) frame = requestAnimationFrame(step);
      else running = false;
    };
    frame = requestAnimationFrame(step);
  }

  const W = $derived(Math.max(0, rect.w - 8));
  // The rows above the chart (the sliders, the zoom chips, the hints and Re-save) take `DECODE_TOOLS`.
  const H = $derived(Math.max(0, rect.h - DECODE_TOOLS));
  const finite = $derived(history.filter((v) => Number.isFinite(v)));
  const top = $derived(Math.max(10, ...finite) + 2);
  const bottom = $derived(Math.max(0, Math.min(...(finite.length ? finite : [top - 10])) - 2));
  /** Where each generation sits on the chart, in the chart's own pixels. */
  const spots = $derived(
    history.map((v, i) => ({
      x: (i / (GENERATIONS - 1)) * W,
      y: Number.isFinite(v) ? H - ((v - bottom) / Math.max(1, top - bottom)) * H : 0,
    })),
  );
  const points = $derived(spots.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '));

  let chart = $state<SVGSVGElement | null>(null);
  /** The generation the keyboard has reached; null until it moves (it then starts at the latest). */
  let rove = $state<number | null>(null);
  const roveGeneration = $derived(Math.min(history.length, Math.max(1, rove ?? history.length)));
  /** How close, in pixels, the pointer must be to a generation's point. */
  const REACH = 16;

  /** The generation whose point is nearest the pointer, within reach. */
  function nearestGeneration(e: MouseEvent): Target | null {
    if (!chart || spots.length === 0) return null;
    const box = chart.getBoundingClientRect();
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;
    let best = -1;
    let bestD = REACH;
    spots.forEach((p, i) => {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) {
        best = i;
        bestD = d;
      }
    });
    return best < 0 ? null : { id: 'decode.resave', generation: best + 1 };
  }
  const keyGeneration = (): Target | null => (history.length ? { id: 'decode.resave', generation: roveGeneration } : null);

  /** Left and right walk the generations (shift: five); the chart's card follows. */
  function onChartKey(e: KeyboardEvent) {
    if (e.altKey || e.metaKey || e.ctrlKey || history.length === 0) return;
    const to = e.key === 'Home' ? 1 : e.key === 'End' ? history.length : null;
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (to === null && step === 0) return;
    e.preventDefault(); // not also a stage switch
    rove = to ?? Math.min(history.length, Math.max(1, roveGeneration + step * (e.shiftKey ? 5 : 1)));
  }
</script>

{#if rect.w > 120 && rect.h > 60}
  <div class="tools" style:left="{rect.x}px" style:top="{rect.y}px" style:width="{rect.w}px" style:height="{rect.h}px">
    <label class="ctl">
      <span>Wipe</span>
      <input type="range" min="0" max="1" step="0.01" value={wipe} oninput={(e) => onwipe(Number((e.currentTarget as HTMLInputElement).value))} use:tooltip={{ ctl, target: { id: 'decode.wipeSlider' }, acts: true }} />
    </label>
    <div class="zoom" role="group" aria-label="Zoom">
      {#each DECODE_ZOOMS as f (f)}
        <button class="chip" aria-pressed={zoom === f} onclick={() => onzoom(f)} use:tooltip={{ ctl, target: { id: 'decode.zoom', factor: f }, acts: true }}
          >{f === 1 ? 'Whole picture' : `${f}×`}</button
        >
      {/each}
    </div>
    <label class="ctl">
      <span>Error × <span class="mono">{gain}</span></span>
      <input type="range" min="1" max="16" step="1" value={gain} oninput={(e) => ongain(Number((e.currentTarget as HTMLInputElement).value))} use:tooltip={{ ctl, target: { id: 'decode.gainSlider' }, acts: true }} />
    </label>
    {#if hints}
      <div class="hints" role="group" aria-label="Jump to an artifact">
        <button class="chip" onclick={() => onpick(hints.blocking)} use:tooltip={{ ctl, target: { id: 'decode.hint', kind: 'blocking' }, acts: true }}>Blocking</button>
        <!-- Not disabled: a disabled button gets no pointer or focus, so its card (why there is nothing to ring) could not show. -->
        <button
          class="chip"
          aria-disabled={hints.ringing ? undefined : 'true'}
          onclick={() => hints.ringing && onpick(hints.ringing)}
          use:tooltip={{ ctl, target: { id: 'decode.hint', kind: 'ringing' }, acts: true }}>Ringing</button
        >
        <button class="chip" onclick={() => onpick(hints.bleed)} use:tooltip={{ ctl, target: { id: 'decode.hint', kind: 'bleed' }, acts: true }}>Colour bleed</button>
        {#if !hints.ringing}
          <span class="note">No hard edges here, so nothing rings.</span>
        {/if}
      </div>
    {/if}
    <div class="resave">
      <button class="chip" onclick={() => void resave()} disabled={running || custom}>{running ? `Re-saving… ${history.length}` : `Re-save ×${GENERATIONS}`}</button>
      {#if custom}
        <span class="note">Re-save uses the quality-scaled tables, so press Standard first.</span>
      {/if}
      {#if history.length}
        <span>gen {history.length}: <span class="mono">{Number.isFinite(history[history.length - 1]) ? history[history.length - 1].toFixed(2) : '∞'} dB</span></span>
      {/if}
    </div>
    {#if H > 40}
      <!-- A focusable chart: the arrow keys walk the generations, and its action shows each one's card. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <svg
        bind:this={chart}
        width={W}
        height={H}
        role="group"
        aria-roledescription="chart"
        tabindex={history.length ? 0 : -1}
        aria-label="PSNR per generation. The arrow keys walk the generations."
        onkeydown={onChartKey}
        onblur={() => (rove = null)}
        use:tooltip={{ ctl, target: nearestGeneration, keyTarget: keyGeneration }}
      >
        <line class="axis" x1="0" y1={H} x2={W} y2={H} />
        <polyline class="curve" points={points} />
        {#each spots as p, i (i)}
          <circle class="spot" class:rove={rove !== null && i + 1 === roveGeneration} cx={p.x} cy={p.y} r="3" />
        {/each}
      </svg>
    {/if}
  </div>
{/if}

<style>
  .tools { position: absolute; display: flex; flex-direction: column; gap: 8px; color: rgba(255, 255, 255, 0.8); font-size: 12px; pointer-events: auto; overflow: auto; }
  .ctl { display: flex; align-items: center; gap: 8px; }
  .ctl > span { width: 70px; flex: none; }
  .ctl input { flex: 1; accent-color: var(--accent); }
  .zoom, .hints, .resave { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .chip {
    height: 26px;
    padding: 0 10px;
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.35);
    color: rgba(255, 255, 255, 0.85);
    font-size: 12px;
    cursor: pointer;
  }
  .chip:disabled, .chip[aria-disabled='true'] { opacity: 0.45; cursor: default; }
  .chip[aria-pressed='true'] { border-color: var(--accent); color: #fff; }
  .note { color: rgba(255, 255, 255, 0.6); }
  svg { display: block; overflow: visible; margin-left: 4px; }
  svg:focus-visible { outline: 1px dashed var(--accent); outline-offset: 2px; }
  .axis { stroke: rgba(255, 255, 255, 0.25); }
  .curve { fill: none; stroke: #e27a52; stroke-width: 1.5; }
  .spot { fill: #e27a52; pointer-events: none; }
  .spot.rove { fill: #fff; stroke: #e27a52; stroke-width: 2; }
</style>
