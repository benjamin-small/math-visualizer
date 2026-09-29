<script lang="ts">
  // The lab page: title and thesis, then the frame — a bezel of labelled
  // controls above a dark stage that hosts the WebGL canvas — then the
  // legend and the story. The engine lifecycle lives in useEngine; this
  // component owns playback UI, the speed ramp, zoom, and pointer forwarding.
  import { onMount, onDestroy, untrack, type Snippet } from 'svelte';
  import type { LabId } from '../router';
  import { cmd } from '../playback/commands';
  import type { LabApi } from './labApi.svelte';
  import { useEngine } from './useEngine.svelte';
  import Icon from './Icon.svelte';

  interface Props {
    labId: LabId;
    title: string;
    /** One sentence under the title. */
    thesis: string;
    /** Extra bezel controls, rendered after the playback buttons and readout. */
    controls?: Snippet<[LabApi]>;
    /** Swatch + label items rendered in a row under the frame. */
    legend?: Snippet;
    /** The explanation, rendered as an article below the legend. */
    story?: Snippet;
    /** Extra DOM overlaid on the canvas (e.g. a grid of cells). */
    overlay?: Snippet<[LabApi]>;
    /** Called once the engine is constructed and the frame loop is running. */
    onReady?: (api: LabApi) => void;
    /** Speed to dispatch right after construction (skipped when 1, the engine default). */
    initialSpeed?: number;
    /** When set, the first Play from iteration 0 ramps speed exponentially up to `target` over `durationMs`. */
    speedRamp?: { target: number; durationMs: number };
    /** Show the reset/step/play buttons, readout, clock line and speed slider (default true). */
    playback?: boolean;
    /** Show the zoom cluster in the bezel (default true). */
    zoom?: boolean;
  }

  let {
    labId,
    title,
    thesis,
    controls,
    legend,
    story,
    overlay,
    onReady,
    initialSpeed,
    speedRamp,
    playback = true,
    zoom = true,
  }: Props = $props();

  // The engine is created once for this component's lifetime; later prop
  // changes are not meant to re-create it.
  const engine = untrack(() => useEngine(labId, { initialSpeed, onReady }));
  const api = engine.api;

  let canvas: HTMLCanvasElement;
  // Per-pointerId anchor so simultaneous touches (or a mouse + a touch)
  // don't share a single lastPointer and produce delta = (finger 2) − (finger 1).
  const lastPointer: Map<number, { x: number; y: number }> = new Map();

  onMount(() => {
    void engine.start(canvas);
  });

  onDestroy(() => {
    cancelRamp();
    engine.destroy();
  });

  const fmt = (n: number) => n.toLocaleString('en-US');
  const progressPct = $derived(
    api.snapshot.max_iterations > 0 ? Math.min(100, (100 * api.snapshot.iteration) / api.snapshot.max_iterations) : 0,
  );

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
    rampStartSpeed = Math.max(fromSpeed, 0.01); // log(0) would explode
    rampStartMs = performance.now();
    const tick = (now: number) => {
      if (rampHandle === 0) return; // cancelled mid-tick
      const elapsed = now - rampStartMs;
      if (elapsed >= durationMs) {
        api.dispatch(cmd.setSpeed(target));
        rampHandle = 0;
        return;
      }
      // Exponential (perceptually-logarithmic) ramp:
      //   speed(t) = start * (target/start)^(t/duration)
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
      cancelRamp();
    } else if (wasAtStart && api.snapshot.iteration < api.snapshot.max_iterations) {
      startRamp(api.snapshot.speed);
    }
  }

  function onSpeedInput(value: number) {
    cancelRamp(); // user took manual control
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
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, button: e.button, buttons: e.buttons };
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
    } catch {
      /* capture unavailable — ignore */
    }
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
    safeForwardInput({ kind: 'PointerMove', x: c.x, y: c.y, dx, dy, buttons: c.buttons });
  }

  function onCanvasPointerUp(e: PointerEvent) {
    const c = pointerEventCommon(e);
    lastPointer.delete(e.pointerId);
    try {
      (e.currentTarget as HTMLCanvasElement).releasePointerCapture(e.pointerId);
    } catch {
      /* not captured — ignore */
    }
    safeForwardInput({ kind: 'PointerUp', x: c.x, y: c.y, button: c.button });
  }
</script>

<article class="lab">
  <h1>{title}</h1>
  <p class="thesis">{thesis}</p>

  <div class="frame">
    <div class="bezel">
      {#if playback}
        <button class="btn" onclick={onReset} title="Back to iteration 0"><Icon name="rotate-ccw" />Reset</button>
        <button class="btn" onclick={onStepBack} title="Step back one iteration"><Icon name="skip-back" />Back</button>
        <button class="btn primary" onclick={onTogglePlay}>
          <Icon name={api.snapshot.playing ? 'pause' : 'play'} />{api.snapshot.playing ? 'Pause' : 'Play'}
        </button>
        <button class="btn" onclick={onStepForward} title="Step forward one iteration"><Icon name="skip-forward" />Forward</button>
        <span class="readout mono">{fmt(api.snapshot.iteration)} <span class="of">/ {fmt(api.snapshot.max_iterations)}</span></span>
      {/if}

      {@render controls?.(api)}

      {#if zoom}
        <div class="zoom">
          <span class="label">Zoom</span>
          <button class="btn icon" onclick={zoomOut} aria-label="Zoom out" title="Zoom out"><Icon name="zoom-out" /></button>
          <span class="level mono">{zoomLevel.toFixed(2)}×</span>
          <button class="btn icon" onclick={zoomIn} aria-label="Zoom in" title="Zoom in"><Icon name="zoom-in" /></button>
          {#if zoomLevel !== 1}<button class="btn quiet" onclick={zoomReset}>Reset zoom</button>{/if}
        </div>
      {/if}

      {#if playback}
        <label class="speed">
          Speed
          <input
            type="range"
            min="0.25"
            max="360"
            step="0.25"
            value={api.snapshot.speed}
            oninput={(e) => onSpeedInput(Number((e.target as HTMLInputElement).value))}
            aria-label="Speed"
          />
          <span class="value mono">{api.snapshot.speed.toFixed(1)}</span>
        </label>
      {/if}
    </div>

    <div class="stage">
      {#if playback}<div class="clock" style="width: {progressPct}%"></div>{/if}
      <canvas
        id="viz-canvas-{labId}"
        bind:this={canvas}
        onpointerdown={onCanvasPointerDown}
        onpointermove={onCanvasPointerMove}
        onpointerup={onCanvasPointerUp}
        onpointercancel={onCanvasPointerUp}
      ></canvas>
      {#if overlay}
        <div class="overlay">
          {@render overlay(api)}
        </div>
      {/if}
    </div>
  </div>

  {#if legend}
    <div class="legend">
      {@render legend()}
    </div>
  {/if}

  {#if story}
    <section class="story">
      {@render story()}
    </section>
  {/if}
</article>

<style>
  .lab {
    max-width: 1200px;
    margin: 0 auto;
    padding: 40px 32px 64px;
    animation: fade 200ms ease-out;
  }
  @keyframes fade {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  h1 { font-size: 26px; }
  .thesis { color: var(--stone); max-width: 60ch; margin: 6px 0 20px; }

  .frame {
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: var(--radius-panel);
    box-shadow: var(--shadow-panel);
    overflow: hidden;
  }
  .bezel {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 10px;
    padding: 12px 16px;
  }
  /* One .btn base for the shell's own buttons and the labs' bezel extras
     (snippet content renders in this tree, so the base is :global). The
     variants below must come AFTER it: same specificity, order decides. */
  .bezel :global(.btn) { display: inline-flex; align-items: center; gap: 7px; height: 36px; padding: 0 12px; border: 1px solid var(--line); border-radius: var(--radius-button); background: var(--paper); color: var(--ink); font-size: 14px; font-weight: 500; cursor: pointer; white-space: nowrap; }
  .bezel :global(.btn:hover) { border-color: var(--stone); }
  .bezel :global(.btn.primary) { background: var(--accent); border-color: var(--accent); color: #fff; }
  .bezel :global(.btn.primary:hover) { background: var(--accent-deep); border-color: var(--accent-deep); }
  .bezel :global(.btn.icon) { padding: 0 9px; }
  .bezel :global(.btn.quiet) { background: none; border-color: transparent; color: var(--accent-deep); }
  .readout { font-size: 15px; margin-left: 6px; white-space: nowrap; }
  .readout .of { color: var(--stone); }

  .bezel :global(.field) { display: inline-flex; align-items: center; gap: 8px; color: var(--stone); font-size: 14px; white-space: nowrap; }
  .bezel :global(.field input) { height: 34px; border: 1px solid var(--line); border-radius: var(--radius-input); background: var(--card); color: var(--ink); padding: 0 10px; font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 14px; }
  .bezel :global(.field input[type="text"]) { font-family: var(--font-sans); }
  .bezel :global(.stat) { display: inline-flex; align-items: baseline; gap: 6px; color: var(--stone); font-size: 14px; white-space: nowrap; }
  .bezel :global(.stat .mono) { color: var(--ink); font-size: 15px; }
  .bezel :global(input[type="range"]) { accent-color: var(--accent); }

  .zoom { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; color: var(--stone); font-size: 14px; }
  .zoom .level { min-width: 4.5ch; text-align: center; color: var(--ink); }
  .speed { display: inline-flex; align-items: center; gap: 8px; color: var(--stone); font-size: 14px; }
  .speed input { accent-color: var(--accent); width: 140px; }
  .speed .value { width: 4.5ch; text-align: right; color: var(--ink); }

  .stage {
    position: relative;
    height: clamp(420px, 65vh, 820px);
    background: var(--stage);
    box-shadow: inset 0 0 0 1px var(--ring);
    overflow: hidden;
  }
  .clock {
    position: absolute;
    left: 0;
    top: 0;
    height: 2px;
    background: var(--accent);
    z-index: 2;
    transition: width 120ms linear;
  }
  canvas { width: 100%; height: 100%; display: block; touch-action: none; }
  .overlay { position: absolute; inset: 0; z-index: 1; }

  .legend { display: flex; flex-wrap: wrap; gap: 8px 22px; padding: 14px 4px 0; font-size: 14px; color: var(--stone); }
  .legend :global(.item) { display: inline-flex; align-items: center; gap: 8px; }
  .legend :global(.swatch) { display: inline-block; width: 10px; height: 10px; border-radius: 50%; flex: none; }

  .story { max-width: 68ch; margin-top: 44px; }
  .story :global(h2) { font-size: 20px; margin: 0 0 10px; }
  .story :global(h3) { font-size: 16px; margin: 28px 0 8px; }
  .story :global(p), .story :global(li) { margin: 0 0 10px; }
  .story :global(ol), .story :global(ul) { margin: 0 0 10px; padding-left: 22px; }
  .story :global(.tip) {
    border-left: 2px solid var(--accent);
    background: var(--tint);
    padding: 10px 14px;
    border-radius: 0 8px 8px 0;
    color: var(--stone);
    margin: 18px 0;
  }
  .story :global(em) { font-style: normal; font-weight: 500; color: var(--ink); }
  .story :global(strong) { color: var(--ink); }

  @media (max-width: 768px) {
    .lab { padding: 20px 16px 48px; }
    .bezel { justify-content: center; }
    .stage { height: clamp(300px, 55vh, 520px); }
    .zoom { margin-left: 0; }
    .speed input { width: 120px; }
  }
</style>
