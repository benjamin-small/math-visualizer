// Engine lifecycle shared by LabShell (lab pages) and LabTile (home cards):
// load the WASM module once, construct the engine on a canvas, run the rAF
// frame loop that publishes `api.snapshot`, size the canvas to its CSS box on
// mount and on window resize, and free everything on destroy. Callers own
// the canvas element and decide when to start.
import { loadVizCore } from '../wasm/loader';
import type { LabId } from '../router';
import { cmd, type PlaybackSnapshot } from '../playback/commands';
import { LabApi } from './labApi.svelte';

export interface EngineOptions {
  /** Called once the engine is constructed and the frame loop is running. */
  onReady?: (api: LabApi) => void;
  /** Speed to dispatch right after construction (skipped when 1, the engine default). */
  initialSpeed?: number;
}

export interface EngineHandle {
  /** Live engine handle plus the per-frame playback snapshot ($state). */
  api: LabApi;
  /** Load the module and boot the engine on `canvas`. Safe to call once. */
  start(canvas: HTMLCanvasElement): Promise<void>;
  /** Match the canvas's pixel size to its CSS box and tell the engine. */
  sizeCanvas(): void;
  /** Stop the loop and free the engine. Idempotent. */
  destroy(): void;
}

export function useEngine(labId: LabId, opts: EngineOptions = {}): EngineHandle {
  const api = new LabApi();
  let canvas: HTMLCanvasElement | null = null;
  let destroyed = false;
  let rafId = 0;

  function sizeCanvas() {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    api.engine?.resize(canvas.width, canvas.height);
  }

  async function start(el: HTMLCanvasElement) {
    canvas = el;
    const viz = await loadVizCore();
    if (destroyed) return; // unmounted while the WASM loaded
    const engine = new viz.Engine(el.id, labId);
    api.engine = engine;
    sizeCanvas();
    if (opts.initialSpeed !== undefined && opts.initialSpeed !== 1) engine.dispatch(cmd.setSpeed(opts.initialSpeed));

    const loop = (now: number) => {
      const e = api.engine;
      if (!e) return;
      e.frame(now);
      api.snapshot = e.snapshot() as PlaybackSnapshot;
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    window.addEventListener('resize', sizeCanvas);
    opts.onReady?.(api);
  }

  function destroy() {
    destroyed = true;
    cancelAnimationFrame(rafId);
    window.removeEventListener('resize', sizeCanvas);
    // Null the handle BEFORE freeing so the rAF loop and any late handler
    // bail instead of touching a freed WASM object.
    const e = api.engine;
    api.engine = null;
    e?.free();
  }

  return { api, start, sizeCanvas, destroy };
}
