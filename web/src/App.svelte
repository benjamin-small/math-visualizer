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
  <aside class="info">
    <h2>Sierpinski Chaos Game</h2>
    <p>
      Three triangle corners, plus a deterministic random starting point
      somewhere inside. Each iteration:
    </p>
    <ol>
      <li>Pick one of the three corners uniformly at random.</li>
      <li>Move halfway from the current position toward that corner.</li>
      <li>Drop a permanent dot at the new position.</li>
    </ol>
    <p>
      After a few thousand iterations the dots converge on the
      <strong>Sierpinski triangle</strong> — a fractal attractor with three
      self-similar copies of itself nested inside.
    </p>
    <h3>What you're seeing</h3>
    <ul>
      <li><span class="swatch corner"></span> Triangle corners (anchors)</li>
      <li><span class="swatch highlight"></span> Highlighted corner (chosen this iteration)</li>
      <li><span class="swatch guide"></span> Guide line from current position to the chosen corner</li>
      <li><span class="swatch current"></span> In-flight dot, moving toward the halfway point</li>
      <li><span class="swatch trail"></span> Trail of permanent dots</li>
    </ul>
    <p class="tip">
      Slow down to <em>1 iter/sec</em> to study each step; crank to
      <em>240</em> to race through 10k+ iterations and watch the pattern
      resolve.
    </p>
  </aside>

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
        max="200000"
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
        max="240"
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
    grid-template-columns: 320px 1fr;
    grid-template-rows: 1fr auto;
    grid-template-areas:
      "info canvas"
      "bar  bar";
    height: 100vh;
  }
  .info {
    grid-area: info;
    background: #14141a;
    border-right: 1px solid #2a2a2f;
    padding: 1.25rem 1.25rem 1rem;
    overflow-y: auto;
    color: #c9c9d0;
    font-size: 0.85rem;
    line-height: 1.5;
  }
  .info h2 {
    margin: 0 0 0.75rem;
    color: #f0f0f5;
    font-size: 1.05rem;
    font-weight: 600;
  }
  .info h3 {
    margin: 1.25rem 0 0.5rem;
    color: #f0f0f5;
    font-size: 0.85rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .info p { margin: 0 0 0.75rem; }
  .info ol, .info ul {
    margin: 0 0 0.75rem;
    padding-left: 1.25rem;
  }
  .info li { margin-bottom: 0.35rem; }
  .info ul { list-style: none; padding-left: 0; }
  .info ul li {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }
  .info .tip {
    margin-top: 1rem;
    padding: 0.6rem 0.75rem;
    background: #1c1c24;
    border-left: 2px solid #4a4a55;
    border-radius: 2px;
    font-size: 0.8rem;
    color: #a0a0aa;
  }
  .info em { color: #d5d5db; font-style: normal; font-weight: 500; }
  .info strong { color: #f0f0f5; }
  .swatch {
    display: inline-block;
    width: 0.85rem;
    height: 0.85rem;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .swatch.corner    { background: #d9d9e0; }
  .swatch.highlight { background: #fad94d; }
  .swatch.guide     { background: linear-gradient(90deg, transparent 0, #f2bf59 30%, #f2bf59 70%, transparent 100%); border-radius: 0; height: 2px; align-self: center; }
  .swatch.current   { background: #f28c5a; }
  .swatch.trail     { background: #a6daf2; }
  canvas {
    grid-area: canvas;
    width: 100%;
    height: 100%;
    display: block;
  }
  .playback-bar {
    grid-area: bar;
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
