<script lang="ts">
  // One home-page card: a lab running live on a small stage, with the
  // title, a one-line thesis and a single mono readout. The whole card is a
  // link to the lab. Engine lifecycle comes from useEngine; this component
  // owns the reduced-motion pause and the hidden-tab pause/resume.
  import { onMount, onDestroy, untrack } from 'svelte';
  import type { LabId } from '../router';
  import { cmd } from '../playback/commands';
  import type { LabApi } from './labApi.svelte';
  import { useEngine } from './useEngine.svelte';

  interface Props {
    lab: LabId;
    title: string;
    thesis: string;
    /** The live foot line; reads `api.snapshot` so it re-renders each frame. */
    readout: (api: LabApi) => string;
    /**
     * Demo settings applied once the engine is ready. Gets the canvas too, for
     * labs that need its size; may return a cleanup run on destroy.
     */
    setup: (api: LabApi, canvas: HTMLCanvasElement) => void | (() => void);
  }

  let { lab, title, thesis, readout, setup }: Props = $props();

  let canvas: HTMLCanvasElement;
  let paused = $state(false);
  let hiddenPaused = false;
  let cleanup: (() => void) | void;
  /** The foot line, re-evaluated every frame whatever the readout reads. */
  const line = $derived.by(() => {
    void api.snapshot;
    return paused ? 'Paused' : readout(api);
  });

  function onVis() {
    if (document.hidden) {
      if (api.snapshot.playing) {
        api.dispatch(cmd.pause());
        hiddenPaused = true;
      }
    } else if (hiddenPaused) {
      api.dispatch(cmd.play());
      hiddenPaused = false;
    }
  }

  function onReady(api: LabApi) {
    cleanup = setup(api, canvas);
    const reduce =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      api.dispatch(cmd.pause());
      paused = true;
    }
    document.addEventListener('visibilitychange', onVis);
  }

  // The engine is created once for this component's lifetime.
  const engine = untrack(() => useEngine(lab, { onReady }));
  const api = engine.api;

  onMount(() => {
    void engine.start(canvas);
  });

  onDestroy(() => {
    cleanup?.();
    document.removeEventListener('visibilitychange', onVis);
    engine.destroy();
  });

  const progressPct = $derived(
    api.snapshot.max_iterations > 0 ? Math.min(100, (100 * api.snapshot.iteration) / api.snapshot.max_iterations) : 0,
  );
</script>

<a class="tile" href="#/{lab}" aria-label={title}>
  <div class="stage">
    <div class="clock" style="width: {progressPct}%"></div>
    <canvas id="tile-canvas-{lab}" bind:this={canvas}></canvas>
  </div>
  <div class="body">
    <h2>{title}</h2>
    <p>{thesis}</p>
    <div class="foot">
      <span class="readout mono">{line}</span>
      <span class="open">Open</span>
    </div>
  </div>
</a>

<style>
  .tile {
    display: flex;
    flex-direction: column;
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: var(--radius-panel);
    box-shadow: var(--shadow-panel);
    overflow: hidden;
    color: inherit;
    text-decoration: none;
    transition: box-shadow 150ms ease-out;
  }
  .tile:hover { box-shadow: var(--shadow-lift); }
  .tile:hover h2 { color: var(--accent-deep); }

  .stage {
    position: relative;
    aspect-ratio: 4 / 3;
    background: var(--stage);
    box-shadow: inset 0 0 0 1px var(--ring);
  }
  canvas { width: 100%; height: 100%; display: block; }
  .clock {
    position: absolute;
    top: 0;
    left: 0;
    height: 2px;
    background: var(--accent);
    z-index: 1;
  }

  .body {
    padding: 16px 18px 18px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
  }
  h2 { font-size: 18px; transition: color 150ms; }
  p { color: var(--stone); font-size: 15px; }
  .foot {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: auto;
    padding-top: 14px;
    font-size: 13px;
  }
  .readout { color: var(--stone); }
  .open { color: var(--accent-deep); font-weight: 500; }
</style>
