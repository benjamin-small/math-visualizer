<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { loadVizCore } from './lib/wasm/loader';
  import type { Engine } from 'viz-core';

  let canvas: HTMLCanvasElement;
  let engine = $state<Engine | null>(null);
  let r = $state(0.1);
  let g = $state(0.1);
  let b = $state(0.15);
  let a = $state(1.0);
  let rafId = 0;

  onMount(async () => {
    const viz = await loadVizCore();
    engine = new viz.Engine('viz-canvas');
    sizeCanvas();  // must run after engine assignment so engine.resize() fires
    engine.set_clear_color(r, g, b, a);

    const loop = () => {
      engine?.frame();
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

  $effect(() => {
    engine?.set_clear_color(r, g, b, a);
  });
</script>

<div class="layout">
  <canvas id="viz-canvas" bind:this={canvas}></canvas>
  <aside class="panel">
    <h2>Clear color</h2>
    <label>R <input type="range" min="0" max="1" step="0.01" bind:value={r} /> {r.toFixed(2)}</label>
    <label>G <input type="range" min="0" max="1" step="0.01" bind:value={g} /> {g.toFixed(2)}</label>
    <label>B <input type="range" min="0" max="1" step="0.01" bind:value={b} /> {b.toFixed(2)}</label>
    <label>A <input type="range" min="0" max="1" step="0.01" bind:value={a} /> {a.toFixed(2)}</label>
  </aside>
</div>

<style>
  .layout {
    display: grid;
    grid-template-columns: 1fr 280px;
    height: 100vh;
  }
  canvas {
    width: 100%;
    height: 100%;
    display: block;
  }
  .panel {
    background: #1c1c1f;
    padding: 1rem;
    border-left: 1px solid #2a2a2f;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  label {
    display: grid;
    grid-template-columns: 1.5rem 1fr 3rem;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
  }
</style>
