<script lang="ts">
  import { onMount, onDestroy, type Snippet } from 'svelte';
  import { loadVizCore } from '../wasm/loader';
  import type { LabId } from '../router';
  import { cmd, type PlaybackSnapshot } from '../playback/commands';
  import { LabApi } from './labApi.svelte';

  interface Props {
    labId: LabId;
    /** Left-hand description panel (becomes a slide-in drawer under 768px). */
    info: Snippet;
    /** Extra playback-bar controls, rendered between the iteration readout and the Speed slider. */
    controls?: Snippet<[LabApi]>;
    /** Called once the engine is constructed and the frame loop is running. */
    onReady?: (api: LabApi) => void;
    /** Speed to dispatch right after construction (skipped when 1, the engine default). */
    initialSpeed?: number;
    /** When set, the first Play from iteration 0 ramps speed exponentially up to `target` over `durationMs`. */
    speedRamp?: { target: number; durationMs: number };
  }

  let { labId, info, controls, onReady, initialSpeed, speedRamp }: Props = $props();

  const api = new LabApi();

  let canvas: HTMLCanvasElement;
  // Per-pointerId anchor so simultaneous touches (or a mouse + a touch)
  // don't share a single lastPointer and produce delta = (finger 2) − (finger 1).
  const lastPointer: Map<number, { x: number; y: number }> = new Map();
  let destroyed = false;
  let rafId = 0;

  onMount(async () => {
    const viz = await loadVizCore();
    if (destroyed) return; // route changed while the WASM loaded
    const engine = new viz.Engine(`viz-canvas-${labId}`, labId);
    api.engine = engine;
    sizeCanvas();
    if (initialSpeed !== undefined && initialSpeed !== 1) engine.dispatch(cmd.setSpeed(initialSpeed));

    const loop = (now: number) => {
      const e = api.engine;
      if (!e) return;
      e.frame(now);
      api.snapshot = e.snapshot() as PlaybackSnapshot;
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);

    window.addEventListener('resize', sizeCanvas);
    onReady?.(api);
  });

  onDestroy(() => {
    destroyed = true;
    cancelAnimationFrame(rafId);
    cancelRamp();
    window.removeEventListener('resize', sizeCanvas);
    // Null the handle BEFORE freeing so the rAF loop and any late handler
    // bail instead of touching a freed WASM object. The Rust side implements
    // Drop for its GL resources, so free() is what actually releases them.
    const e = api.engine;
    api.engine = null;
    e?.free();
  });

  function sizeCanvas() {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    api.engine?.resize(canvas.width, canvas.height);
  }

  // Speed ramp: when play starts from iteration 0, ramp speed from its current
  // value up to speedRamp.target over speedRamp.durationMs. Any manual speed
  // change, pause, reset, or step cancels the ramp. No-op unless the lab opted
  // in via the `speedRamp` prop.
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
    if (!speedRamp) return;
    const { target, durationMs } = speedRamp;
    // Skip ramp if user already has speed at or above the target (e.g. they
    // cranked the slider, then reset + played — ramping DOWN would feel weird).
    if (fromSpeed >= target) return;
    rampStartSpeed = Math.max(fromSpeed, 0.01);  // log(0) would explode
    rampStartMs = performance.now();
    const tick = (now: number) => {
      if (rampHandle === 0) return;  // cancelled mid-tick
      const elapsed = now - rampStartMs;
      if (elapsed >= durationMs) {
        api.dispatch(cmd.setSpeed(target));
        rampHandle = 0;
        return;
      }
      // Exponential (perceptually-logarithmic) ramp:
      //   speed(t) = start * (target/start)^(t/duration)
      // Doubles every (duration * log(2) / log(target/start)) seconds, so the
      // ear/eye feel a constant rate of change rather than the linear shape's
      // huge early jump.
      const t = elapsed / durationMs;
      const speed = rampStartSpeed * Math.pow(target / rampStartSpeed, t);
      api.dispatch(cmd.setSpeed(speed));
      rampHandle = requestAnimationFrame(tick);
    };
    rampHandle = requestAnimationFrame(tick);
  }

  function onTogglePlay() {
    const wasPlaying = api.snapshot.playing;
    const wasAtStart = api.snapshot.iteration === 0;
    api.dispatch(cmd.togglePlay());
    if (wasPlaying) {
      // Just paused — kill any active ramp.
      cancelRamp();
    } else if (wasAtStart && api.snapshot.iteration < api.snapshot.max_iterations) {
      // Fresh play from the beginning — kick off the ramp.
      startRamp(api.snapshot.speed);
    }
  }

  function onSpeedInput(value: number) {
    cancelRamp();  // user took manual control
    api.dispatch(cmd.setSpeed(value));
  }

  function onReset() {
    cancelRamp();
    api.dispatch(cmd.reset());
  }

  function onStepBack() {
    cancelRamp();
    api.dispatch(cmd.stepBack());
  }

  function onStepForward() {
    cancelRamp();
    api.dispatch(cmd.stepForward());
  }

  // Zoom: simple geometric step on each +/- click. JS owns the level; the
  // viz clamps to [0.25, 20] in Rust so we don't need to repeat the bounds.
  const ZOOM_STEP = 1.25;
  let zoomLevel = $state(1.0);

  function zoomIn() {
    zoomLevel = Math.min(zoomLevel * ZOOM_STEP, 20);
    api.engine?.set_zoom(zoomLevel);
  }

  function zoomOut() {
    zoomLevel = Math.max(zoomLevel / ZOOM_STEP, 0.25);
    api.engine?.set_zoom(zoomLevel);
  }

  function zoomReset() {
    zoomLevel = 1.0;
    api.engine?.set_zoom(zoomLevel);
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

  // forward_input throws if serde_wasm_bindgen rejects the payload (e.g.
  // a future enum-shape drift). Surface it as a console warning instead
  // of an unhandled exception so the handler keeps a clean state.
  function safeForwardInput(payload: unknown) {
    try {
      api.engine?.forward_input(payload);
    } catch (err) {
      console.warn('engine.forward_input failed:', err, payload);
    }
  }

  function onCanvasPointerDown(e: PointerEvent) {
    const target = e.currentTarget as HTMLCanvasElement;
    try {
      target.setPointerCapture(e.pointerId);
    } catch { /* capture unavailable — ignore */ }
    const c = pointerEventCommon(e);
    lastPointer.set(e.pointerId, { x: c.x, y: c.y });
    safeForwardInput({ kind: 'PointerDown', x: c.x, y: c.y, button: c.button });
  }

  function onCanvasPointerMove(e: PointerEvent) {
    const c = pointerEventCommon(e);
    const prev = lastPointer.get(e.pointerId);
    const dx = prev ? c.x - prev.x : 0;
    const dy = prev ? c.y - prev.y : 0;
    lastPointer.set(e.pointerId, { x: c.x, y: c.y });
    safeForwardInput({
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
    lastPointer.delete(e.pointerId);
    try {
      (e.currentTarget as HTMLCanvasElement).releasePointerCapture(e.pointerId);
    } catch { /* not captured — ignore */ }
    safeForwardInput({ kind: 'PointerUp', x: c.x, y: c.y, button: c.button });
  }

  // Info drawer (mobile only — desktop always shows the panel inline)
  let infoOpen = $state(false);
</script>

<div class="layout" class:info-open={infoOpen}>
  <aside class="info" class:open={infoOpen}>
    {@render info()}
  </aside>

  <div class="canvas-wrap">
    <canvas
      id="viz-canvas-{labId}"
      bind:this={canvas}
      onpointerdown={onCanvasPointerDown}
      onpointermove={onCanvasPointerMove}
      onpointerup={onCanvasPointerUp}
      onpointercancel={onCanvasPointerUp}
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
      title={api.snapshot.playing ? 'Pause' : 'Play'}
    >{api.snapshot.playing ? '⏸' : '▶'}</button>
    <button onclick={onStepForward} title="Step forward">▶▶</button>

    <span class="iteration">
      {api.snapshot.iteration} / {api.snapshot.max_iterations}
      <span class="sub">{api.snapshot.sub_progress.toFixed(2)}</span>
    </span>

    {@render controls?.(api)}

    <label class="speed">
      Speed
      <input
        type="range"
        min="0.25"
        max="360"
        step="0.25"
        value={api.snapshot.speed}
        oninput={(e) => onSpeedInput(Number((e.target as HTMLInputElement).value))}
      />
      <span class="value">{api.snapshot.speed.toFixed(1)}</span>
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
    height: 100%;     /* the app grid owns 100dvh; we fill our row */
    min-height: 0;
  }
  /* Hide the info-toggle button on desktop — info panel is always visible. */
  .info-toggle, .info-backdrop {
    display: none;
  }
  .info {
    grid-area: info;
    background: var(--panel);
    border-right: 1px solid var(--border);
    padding: 1.25rem 1.25rem 1rem;
    overflow-y: auto;
    color: var(--text);
    font-size: 0.85rem;
    line-height: 1.5;
  }
  /* The panel body is a snippet rendered from the calling lab component, so
     its elements carry THAT component's scope hash, not ours. Everything
     under .info therefore has to be :global()-scoped to reach it. */
  .info :global(h2) {
    margin: 0 0 0.75rem;
    color: var(--text-strong);
    font-size: 1.05rem;
    font-weight: 600;
  }
  .info :global(h3) {
    margin: 1.25rem 0 0.5rem;
    color: var(--text-strong);
    font-size: 0.85rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .info :global(p) { margin: 0 0 0.75rem; }
  .info :global(ol), .info :global(ul) {
    margin: 0 0 0.75rem;
    padding-left: 1.25rem;
  }
  .info :global(li) { margin-bottom: 0.35rem; }
  .info :global(ul) { list-style: none; padding-left: 0; }
  .info :global(ul li) {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }
  .info :global(.tip) {
    margin-top: 1rem;
    padding: 0.6rem 0.75rem;
    background: var(--tip-bg);
    border-left: 2px solid #4a4a55;
    border-radius: 2px;
    font-size: 0.8rem;
    color: #a0a0aa;
  }
  .info :global(em) { color: #d5d5db; font-style: normal; font-weight: 500; }
  .info :global(strong) { color: var(--text-strong); }
  .info :global(.swatch) {
    display: inline-block;
    width: 0.85rem;
    height: 0.85rem;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .info :global(.swatch.corner)    { background: #d9d9e0; }
  .info :global(.swatch.highlight) { background: #fad94d; }
  .info :global(.swatch.guide)     { background: linear-gradient(90deg, transparent 0, #f2bf59 30%, #f2bf59 70%, transparent 100%); border-radius: 0; height: 2px; align-self: center; }
  .info :global(.swatch.current)   { background: #f28c5a; }
  .info :global(.swatch.trail)     { background: #a6daf2; }
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
    border: 1px solid var(--border);
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
    background: var(--bar);
    border-top: 1px solid var(--border);
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
      top: var(--nav-h);                       /* sit under the app nav */
      left: 0;
      width: min(320px, 88vw);
      height: calc(100dvh - var(--nav-h));
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
      border: 1px solid var(--border);
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
      top: var(--nav-h);
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
