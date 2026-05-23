<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { loadVizCore } from './lib/wasm/loader';
  import type { Engine } from 'viz-core';
  import { cmd, type PlaybackSnapshot } from './lib/playback/commands';

  let canvas: HTMLCanvasElement;
  let engine = $state<Engine | null>(null);
  let snapshot = $state<PlaybackSnapshot>({
    iteration: 0,
    sub_progress: 0,
    playing: false,
    speed: 1.0,
    seed: 0,
    max_iterations: 1,
  });
  let rafId = 0;

  onMount(async () => {
    const viz = await loadVizCore();
    engine = new viz.Engine('viz-canvas');
    sizeCanvas();

    const loop = (now: number) => {
      if (engine) {
        engine.frame(now);
        snapshot = engine.snapshot() as PlaybackSnapshot;
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);

    window.addEventListener('resize', sizeCanvas);
  });

  onDestroy(() => {
    cancelAnimationFrame(rafId);
    window.removeEventListener('resize', sizeCanvas);
  });

  function sizeCanvas() {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    engine?.resize(canvas.width, canvas.height);
  }

  function dispatch(c: ReturnType<typeof cmd[keyof typeof cmd]>) {
    engine?.dispatch(c);
  }

  function updateMaxIterations(n: number) {
    if (!engine || !Number.isFinite(n) || n < 1) return;
    try {
      engine.update_rule_config({ max_iterations: Math.floor(n) });
    } catch (err) {
      console.warn('update_rule_config failed:', err);
    }
  }
</script>

<div class="layout">
  <canvas id="viz-canvas" bind:this={canvas}></canvas>

  <footer class="playback-bar">
    <button onclick={() => dispatch(cmd.reset())} title="Reset to iteration 0">↺</button>
    <button onclick={() => dispatch(cmd.stepBack())} title="Step back">◀</button>
    <button
      onclick={() => dispatch(cmd.togglePlay())}
      title={snapshot.playing ? 'Pause' : 'Play'}
    >{snapshot.playing ? '⏸' : '▶'}</button>
    <button onclick={() => dispatch(cmd.stepForward())} title="Step forward">▶▶</button>

    <span class="iteration">
      {snapshot.iteration} / {snapshot.max_iterations}
      <span class="sub">{snapshot.sub_progress.toFixed(2)}</span>
    </span>

    <label class="iterations">
      Iterations
      <input
        type="number"
        min="1"
        max="10000"
        step="1"
        value={snapshot.max_iterations}
        onchange={(e) => updateMaxIterations(Number((e.target as HTMLInputElement).value))}
      />
    </label>

    <label class="speed">
      Speed
      <input
        type="range"
        min="0.25"
        max="60"
        step="0.25"
        value={snapshot.speed}
        oninput={(e) => dispatch(cmd.setSpeed(Number((e.target as HTMLInputElement).value)))}
      />
      <span class="value">{snapshot.speed.toFixed(1)}</span>
    </label>
  </footer>
</div>

<style>
  .layout {
    display: grid;
    grid-template-rows: 1fr auto;
    height: 100vh;
  }
  canvas {
    width: 100%;
    height: 100%;
    display: block;
  }
  .playback-bar {
    background: #1c1c1f;
    border-top: 1px solid #2a2a2f;
    padding: 0.5rem 1rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-size: 0.9rem;
  }
  .playback-bar button {
    background: #2a2a2f;
    color: #eee;
    border: 1px solid #3a3a40;
    border-radius: 4px;
    padding: 0.35rem 0.7rem;
    font-size: 1rem;
    cursor: pointer;
  }
  .playback-bar button:hover {
    background: #34343a;
  }
  .iteration {
    font-variant-numeric: tabular-nums;
    color: #bbb;
    min-width: 8rem;
  }
  .iteration .sub {
    color: #666;
    margin-left: 0.5rem;
  }
  .iterations {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: #bbb;
  }
  .iterations input {
    background: #2a2a2f;
    color: #eee;
    border: 1px solid #3a3a40;
    border-radius: 4px;
    padding: 0.25rem 0.4rem;
    width: 5rem;
    font-variant-numeric: tabular-nums;
  }
  .speed {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-left: auto;
    color: #bbb;
  }
  .speed .value {
    font-variant-numeric: tabular-nums;
    width: 2.5rem;
    text-align: right;
  }
</style>
