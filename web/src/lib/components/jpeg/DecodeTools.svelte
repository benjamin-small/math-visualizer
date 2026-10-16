<script lang="ts">
  // The Decode stage's controls and its generation-loss chart: the wipe
  // between decoded and original, the error map's brightness, buttons that
  // jump to where blocking, ringing and colour bleed are worst, and "Re-save"
  // — decode, encode again with the same settings, repeat — plotting how far
  // each generation has drifted from the original.
  import { onDestroy } from 'svelte';
  import { loadVizCore } from '../../wasm/loader';
  import type { Rect } from '../../jpeg/layout';
  import type { RgbaImage } from '../../jpeg/images';
  import type { Hints } from '../../jpeg/summary';
  import { psnrOf } from '../../jpeg/math';

  interface Props {
    rect: Rect;
    image: RgbaImage;
    quality: number;
    subsampling: string;
    huffman: string;
    hints: Hints | null;
    wipe: number;
    gain: number;
    onwipe: (v: number) => void;
    ongain: (v: number) => void;
    /** Select a luma block (from a hint). */
    onpick: (block: [number, number]) => void;
  }

  let { rect, image, quality, subsampling, huffman, hints, wipe, gain, onwipe, ongain, onpick }: Props = $props();

  /** Generations re-saved per click. */
  const GENERATIONS = 20;
  /** PSNR per generation (generation 1 is the first save). */
  let history = $state<number[]>([]);
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
  const H = $derived(Math.max(0, rect.h - 150));
  const finite = $derived(history.filter((v) => Number.isFinite(v)));
  const top = $derived(Math.max(10, ...finite) + 2);
  const bottom = $derived(Math.max(0, Math.min(...(finite.length ? finite : [top - 10])) - 2));
  const points = $derived(
    history
      .map((v, i) => {
        const y = Number.isFinite(v) ? H - ((v - bottom) / Math.max(1, top - bottom)) * H : 0;
        return `${((i / (GENERATIONS - 1)) * W).toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' '),
  );
</script>

{#if rect.w > 120 && rect.h > 60}
  <div class="tools" style:left="{rect.x}px" style:top="{rect.y}px" style:width="{rect.w}px" style:height="{rect.h}px">
    <label class="ctl">
      <span>Wipe</span>
      <input type="range" min="0" max="1" step="0.01" value={wipe} oninput={(e) => onwipe(Number((e.currentTarget as HTMLInputElement).value))} aria-label="Decoded share of the comparison" />
    </label>
    <label class="ctl">
      <span>Error × <span class="mono">{gain}</span></span>
      <input type="range" min="1" max="16" step="1" value={gain} oninput={(e) => ongain(Number((e.currentTarget as HTMLInputElement).value))} aria-label="Error brightness" />
    </label>
    {#if hints}
      <div class="hints" role="group" aria-label="Jump to an artifact">
        <button class="chip" onclick={() => onpick(hints.blocking)} title="The block whose borders compression stepped most">Blocking</button>
        <button class="chip" disabled={!hints.ringing} onclick={() => hints.ringing && onpick(hints.ringing)} title={hints.ringing ? 'The block with a hard edge that moved most' : 'This picture has no hard edges to ring'}>Ringing</button>
        <button class="chip" onclick={() => onpick(hints.bleed)} title="The block whose colour moved most">Colour bleed</button>
      </div>
    {/if}
    <div class="resave">
      <button class="chip" onclick={() => void resave()} disabled={running}>{running ? `Re-saving… ${history.length}` : `Re-save ×${GENERATIONS}`}</button>
      {#if history.length}
        <span>gen {history.length}: <span class="mono">{Number.isFinite(history[history.length - 1]) ? history[history.length - 1].toFixed(2) : '∞'} dB</span></span>
      {/if}
    </div>
    {#if H > 40}
      <svg width={W} height={H} aria-label="PSNR per generation">
        <line class="axis" x1="0" y1={H} x2={W} y2={H} />
        <polyline class="curve" points={points} />
      </svg>
    {/if}
  </div>
{/if}

<style>
  .tools { position: absolute; display: flex; flex-direction: column; gap: 8px; color: rgba(255, 255, 255, 0.8); font-size: 12px; pointer-events: auto; overflow: auto; }
  .ctl { display: flex; align-items: center; gap: 8px; }
  .ctl > span { width: 70px; flex: none; }
  .ctl input { flex: 1; accent-color: var(--accent); }
  .hints, .resave { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
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
  .chip:disabled { opacity: 0.45; cursor: default; }
  svg { display: block; overflow: visible; margin-left: 4px; }
  .axis { stroke: rgba(255, 255, 255, 0.25); }
  .curve { fill: none; stroke: #e27a52; stroke-width: 1.5; }
</style>
