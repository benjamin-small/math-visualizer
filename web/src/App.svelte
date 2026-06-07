<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { loadVizCore } from './lib/wasm/loader';
  import type { Engine } from 'viz-core';
  import { cmd, type PlaybackSnapshot } from './lib/playback/commands';

  let canvas: HTMLCanvasElement;
  let engine = $state<Engine | null>(null);
  let lastPointer: { x: number; y: number } | null = null;
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

  // Speed ramp: when play starts from iteration 0, linearly ramp speed from
  // its current value up to RAMP_TARGET over RAMP_DURATION_MS. Any manual
  // speed change, pause, or reset cancels the ramp.
  const RAMP_DURATION_MS = 10_000;
  const RAMP_TARGET = 240;
  let rampHandle = 0;
  let rampStartSpeed = 1;
  let rampStartMs = 0;

  function cancelRamp() {
    if (rampHandle !== 0) {
      cancelAnimationFrame(rampHandle);
      rampHandle = 0;
    }
  }

  function startRamp(fromSpeed: number) {
    cancelRamp();
    // Skip ramp if user already has speed at or above the target (e.g. they
    // cranked the slider, then reset + played — ramping DOWN would feel weird).
    if (fromSpeed >= RAMP_TARGET) return;
    rampStartSpeed = Math.max(fromSpeed, 0.01);  // log(0) would explode
    rampStartMs = performance.now();
    const tick = (now: number) => {
      if (rampHandle === 0) return;  // cancelled mid-tick
      const elapsed = now - rampStartMs;
      if (elapsed >= RAMP_DURATION_MS) {
        engine?.dispatch(cmd.setSpeed(RAMP_TARGET));
        rampHandle = 0;
        return;
      }
      // Exponential (perceptually-logarithmic) ramp:
      //   speed(t) = start * (target/start)^(t/duration)
      // Doubles every (duration * log(2) / log(target/start)) seconds, so the
      // ear/eye feel a constant rate of change rather than the linear shape's
      // huge early jump.
      const t = elapsed / RAMP_DURATION_MS;
      const speed = rampStartSpeed * Math.pow(RAMP_TARGET / rampStartSpeed, t);
      engine?.dispatch(cmd.setSpeed(speed));
      rampHandle = requestAnimationFrame(tick);
    };
    rampHandle = requestAnimationFrame(tick);
  }

  function onTogglePlay() {
    const wasPlaying = snapshot.playing;
    const wasAtStart = snapshot.iteration === 0;
    dispatch(cmd.togglePlay());
    if (wasPlaying) {
      // Just paused — kill any active ramp.
      cancelRamp();
    } else if (wasAtStart && snapshot.iteration < snapshot.max_iterations) {
      // Fresh play from the beginning — kick off the ramp.
      startRamp(snapshot.speed);
    }
  }

  function onSpeedInput(value: number) {
    cancelRamp();  // user took manual control
    dispatch(cmd.setSpeed(value));
  }

  function onReset() {
    cancelRamp();
    dispatch(cmd.reset());
  }

  function onStepBack() {
    cancelRamp();
    dispatch(cmd.stepBack());
  }

  function onStepForward() {
    cancelRamp();
    dispatch(cmd.stepForward());
  }

  // Zoom: simple geometric step on each +/- click. JS owns the level; the
  // viz clamps to [0.25, 20] in Rust so we don't need to repeat the bounds.
  const ZOOM_STEP = 1.25;
  let zoomLevel = $state(1.0);

  function zoomIn() {
    zoomLevel = Math.min(zoomLevel * ZOOM_STEP, 20);
    engine?.set_zoom(zoomLevel);
  }

  function zoomOut() {
    zoomLevel = Math.max(zoomLevel / ZOOM_STEP, 0.25);
    engine?.set_zoom(zoomLevel);
  }

  function zoomReset() {
    zoomLevel = 1.0;
    engine?.set_zoom(zoomLevel);
  }

  // Canvas pointer events — forward to the engine so the viz can drag-to-orbit.
  // Payload shapes mirror the Rust InputEvent enum (serde tag = "kind").
  function pointerEventCommon(e: PointerEvent) {
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      button: e.button,
      buttons: e.buttons,
    };
  }

  function onCanvasPointerDown(e: PointerEvent) {
    const target = e.currentTarget as HTMLCanvasElement;
    try {
      target.setPointerCapture(e.pointerId);
    } catch { /* capture unavailable — ignore */ }
    const c = pointerEventCommon(e);
    lastPointer = { x: c.x, y: c.y };
    engine?.forward_input({ kind: 'PointerDown', x: c.x, y: c.y, button: c.button });
  }

  function onCanvasPointerMove(e: PointerEvent) {
    const c = pointerEventCommon(e);
    const dx = lastPointer ? c.x - lastPointer.x : 0;
    const dy = lastPointer ? c.y - lastPointer.y : 0;
    lastPointer = { x: c.x, y: c.y };
    engine?.forward_input({
      kind: 'PointerMove',
      x: c.x,
      y: c.y,
      dx,
      dy,
      buttons: c.buttons,
    });
  }

  function onCanvasPointerUp(e: PointerEvent) {
    const c = pointerEventCommon(e);
    lastPointer = null;
    try {
      (e.currentTarget as HTMLCanvasElement).releasePointerCapture(e.pointerId);
    } catch { /* not captured — ignore */ }
    engine?.forward_input({ kind: 'PointerUp', x: c.x, y: c.y, button: c.button });
  }

  // Info drawer (mobile only — desktop always shows the panel inline)
  let infoOpen = $state(false);
</script>

<div class="layout" class:info-open={infoOpen}>
  <aside class="info" class:open={infoOpen}>
    <h2>Sierpinski Pyramid</h2>
    <p>
      Four tetrahedron corners in 3D, plus a deterministic random starting
      point somewhere inside. Each iteration:
    </p>
    <ol>
      <li>Pick one of the four corners uniformly at random.</li>
      <li>Move halfway from the current position toward that corner.</li>
      <li>Drop a permanent dot at the new position, tinted with the
        chosen corner's color.</li>
    </ol>
    <p>
      After a few thousand iterations the dots converge on the
      <strong>Sierpinski tetrahedron</strong> — a 3D fractal attractor with
      four self-similar sub-pyramids nested inside. Because each dot inherits
      the color of the corner it moved toward, the four sub-pyramids paint
      themselves in distinct hues.
    </p>
    <h3>What you're seeing</h3>
    <ul>
      <li><span class="swatch corner"></span> Tetrahedron corners (anchors)</li>
      <li><span class="swatch highlight"></span> Highlighted corner (chosen this iteration)</li>
      <li><span class="swatch guide"></span> Guide line from current position to the chosen corner</li>
      <li><span class="swatch current"></span> In-flight dot, moving toward the halfway point</li>
      <li><span class="swatch trail"></span> Trail of permanent dots (color-tinted per corner)</li>
    </ul>
    <p class="tip">
      The pyramid turntables on its own so you can see the structure from
      every angle. <em>Click and drag the canvas</em> to grab the camera
      and rotate it yourself — horizontal drag spins the azimuth, vertical
      drag tilts the elevation.
    </p>
    <p class="tip">
      Slow down to <em>1 iter/sec</em> to study each step; crank to
      <em>240</em> to race through 10k+ iterations and watch the four
      sub-pyramids resolve.
    </p>
    <p class="tip">
      The first ~20 dots are hidden — the chaos orbit converges onto the
      Sierpinski set at rate <em>(1/2)<sup>n</sup></em>, so very early
      dots can sit in regions that get "carved out" only at deeper levels.
      By ~iteration 20 the dot is in a sub-tetrahedron smaller than a pixel
      and everything past that traces the true attractor.
    </p>
  </aside>

  <div class="canvas-wrap">
    <canvas
      id="viz-canvas"
      bind:this={canvas}
      onpointerdown={onCanvasPointerDown}
      onpointermove={onCanvasPointerMove}
      onpointerup={onCanvasPointerUp}
      onpointercancel={onCanvasPointerUp}
      onpointerleave={onCanvasPointerUp}
    ></canvas>
    <div class="zoom-controls">
      <button onclick={zoomIn} title="Zoom in">+</button>
      <button onclick={zoomOut} title="Zoom out">−</button>
      <button onclick={zoomReset} title="Reset zoom" disabled={zoomLevel === 1.0}>⌖</button>
      <span class="zoom-readout">{zoomLevel.toFixed(2)}×</span>
    </div>
    <button
      class="info-toggle"
      onclick={() => (infoOpen = !infoOpen)}
      title={infoOpen ? 'Hide description' : 'Show description'}
      aria-label={infoOpen ? 'Hide description' : 'Show description'}
    >{infoOpen ? '✕' : 'ⓘ'}</button>
    {#if infoOpen}
      <button
        class="info-backdrop"
        onclick={() => (infoOpen = false)}
        aria-label="Close description"
      ></button>
    {/if}
  </div>

  <footer class="playback-bar">
    <button onclick={onReset} title="Reset to iteration 0">↺</button>
    <button onclick={onStepBack} title="Step back">◀</button>
    <button
      onclick={onTogglePlay}
      title={snapshot.playing ? 'Pause' : 'Play'}
    >{snapshot.playing ? '⏸' : '▶'}</button>
    <button onclick={onStepForward} title="Step forward">▶▶</button>

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
        max="360"
        step="0.25"
        value={snapshot.speed}
        oninput={(e) => onSpeedInput(Number((e.target as HTMLInputElement).value))}
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
      "info bar";
    height: 100vh;
    height: 100dvh;  /* dynamic vh so mobile address bars don't clip */
  }
  /* Hide the info-toggle button on desktop — info panel is always visible. */
  .info-toggle, .info-backdrop {
    display: none;
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
  .canvas-wrap {
    grid-area: canvas;
    position: relative;
    overflow: hidden;
  }
  canvas {
    width: 100%;
    height: 100%;
    display: block;
    touch-action: none;
  }
  .zoom-controls {
    position: absolute;
    top: 0.75rem;
    left: 0.75rem;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.25rem;
    background: rgba(28, 28, 31, 0.75);
    backdrop-filter: blur(4px);
    border: 1px solid #2a2a2f;
    border-radius: 6px;
    padding: 0.35rem;
  }
  .zoom-controls button {
    background: #2a2a2f;
    color: #eee;
    border: 1px solid #3a3a40;
    border-radius: 4px;
    width: 2rem;
    height: 2rem;
    font-size: 1.05rem;
    line-height: 1;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .zoom-controls button:hover:not(:disabled) {
    background: #34343a;
  }
  .zoom-controls button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .zoom-readout {
    font-size: 0.7rem;
    color: #aaa;
    font-variant-numeric: tabular-nums;
    text-align: center;
    padding-top: 0.15rem;
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

  /* ===== Mobile ===== */
  @media (max-width: 768px) {
    /* Canvas + playback bar fill the viewport. Info panel becomes a
       slide-in drawer triggered by the info-toggle button. */
    .layout {
      grid-template-columns: 1fr;
      grid-template-rows: 1fr auto;
      grid-template-areas:
        "canvas"
        "bar";
    }
    .info {
      position: fixed;
      top: 0;
      left: 0;
      width: min(320px, 88vw);
      height: 100dvh;
      transform: translateX(-100%);
      transition: transform 0.22s ease;
      z-index: 30;
      box-shadow: 0 0 24px rgba(0, 0, 0, 0.55);
    }
    .info.open {
      transform: translateX(0);
    }
    .info-toggle {
      display: inline-flex;
      position: absolute;
      top: 0.75rem;
      right: 0.75rem;
      z-index: 31;
      align-items: center;
      justify-content: center;
      background: rgba(28, 28, 31, 0.85);
      backdrop-filter: blur(4px);
      color: #eee;
      border: 1px solid #2a2a2f;
      border-radius: 6px;
      width: 2.25rem;
      height: 2.25rem;
      font-size: 1.05rem;
      cursor: pointer;
      padding: 0;
    }
    .info-backdrop {
      display: block;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.45);
      border: none;
      cursor: pointer;
      z-index: 29;
    }
    /* Let the playback bar wrap to multiple rows; align center so it
       balances vertically when items wrap. */
    .playback-bar {
      flex-wrap: wrap;
      justify-content: center;
      row-gap: 0.5rem;
    }
    .speed {
      margin-left: 0;          /* no more push-to-right with wrapping */
      flex-basis: 100%;        /* speed slider takes its own row */
      justify-content: center;
    }
    .speed input {
      flex: 1;                 /* stretch the slider on narrow screens */
      max-width: 18rem;
    }
    .iteration {
      min-width: 0;            /* allow shrinking */
    }
    /* Slightly smaller zoom panel on tight screens. */
    .zoom-controls button {
      width: 1.75rem;
      height: 1.75rem;
      font-size: 0.95rem;
    }
  }
</style>
