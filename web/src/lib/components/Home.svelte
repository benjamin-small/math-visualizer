<script lang="ts">
  // The gallery: thesis, lede, three live lab tiles, and a footer line.
  import { cmd } from '../playback/commands';
  import { readSummary } from '../sorting/summary';
  import { allLanes } from '../sorting/lanes';
  import { cellRects } from '../sorting/layout';
  import { textToPath, samplesFor, packPath } from '../fourier/textPath';
  import type { LabApi } from './labApi.svelte';
  import LabTile from './LabTile.svelte';

  const fmt = (n: number) => n.toLocaleString('en-US');

  /** The Fourier demo: the lab's default message with a modest circle count. */
  const FOURIER_TEXT = 'POIETIC TECH';
  const FOURIER_EPICYCLES = 300;
  const FOURIER_TRACE_STEPS = 2000;

  /** The sorting engine only draws inside cells it is given; lay a 7 x 4 grid over the tile. */
  const SORT_ROWS = 7;
  const SORT_COLS = 4;
  function sortingCells(canvas: HTMLCanvasElement) {
    const dpr = window.devicePixelRatio || 1;
    const box = canvas.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return null; // collapsed or not laid out yet
    const pad = 6;
    const gap = 3;
    const w = (box.width - 2 * pad - (SORT_COLS - 1) * gap) / SORT_COLS;
    const h = (box.height - 2 * pad - (SORT_ROWS - 1) * gap) / SORT_ROWS;
    const cells = [];
    for (let r = 0; r < SORT_ROWS; r++) {
      for (let c = 0; c < SORT_COLS; c++) {
        cells.push({ left: box.left + pad + c * (w + gap), top: box.top + pad + r * (h + gap), width: w, height: h });
      }
    }
    return cellRects(cells, box, dpr);
  }

  const tiles = [
    {
      lab: 'sierpinski' as const,
      title: 'Sierpinski Pyramid',
      thesis: 'A random walk toward four corners paints a 3D fractal, one dot at a time.',
      setup: (api: LabApi) => {
        api.dispatch(cmd.setSpeed(120));
        api.dispatch(cmd.play());
      },
      readout: (api: LabApi) => `${fmt(api.snapshot.iteration)} / ${fmt(api.snapshot.max_iterations)} iterations`,
    },
    {
      lab: 'fourier' as const,
      title: 'Fourier Epicycles',
      thesis: 'Type anything; a chain of spinning circles draws it back.',
      setup: (api: LabApi) => {
        // The engine has no path until one is pushed; trace the default message.
        void (async () => {
          try {
            const path = await textToPath(FOURIER_TEXT, { samples: samplesFor(FOURIER_EPICYCLES) });
            if (!api.engine || path.length === 0) return; // tile torn down while the font loaded
            const { xy, pen } = packPath(path);
            api.setRuleConfigWithPath(
              { epicycles: FOURIER_EPICYCLES, max_iterations: Math.min(path.length, FOURIER_TRACE_STEPS) },
              xy,
              pen,
            );
            api.dispatch(cmd.play());
          } catch (err) {
            console.warn('home tile: textToPath failed:', err);
          }
        })();
      },
      readout: (api: LabApi) =>
        api.snapshot.max_iterations > 1
          ? `${fmt(FOURIER_EPICYCLES)} circles, ${fmt(api.snapshot.iteration)} / ${fmt(api.snapshot.max_iterations)}`
          : 'Loading the font',
    },
    {
      lab: 'sorting' as const,
      title: 'Sorting Algorithms',
      thesis: 'Seven algorithms race four datasets on one clock, so you see the work each one does.',
      setup: (api: LabApi, canvas: HTMLCanvasElement) => {
        const pushCells = () => {
          const cells = sortingCells(canvas);
          if (cells) api.patchVizConfig({ cells });
        };
        pushCells();
        window.addEventListener('resize', pushCells);
        api.dispatch(cmd.setSpeed(60));
        api.dispatch(cmd.play());
        api.ruleAction({ kind: 'set_running', lanes: allLanes(SORT_ROWS, SORT_COLS), running: true });
        return () => window.removeEventListener('resize', pushCells);
      },
      readout: (api: LabApi) => {
        const s = readSummary(api.readSummary());
        const n = s?.lanes.filter((l) => l.running).length ?? 0;
        return `${n} of 28 lanes running`;
      },
    },
  ];
</script>

<section class="home">
  <p class="thesis">Three small machines for looking at math.</p>
  <p class="lede">
    Each one runs in Rust, compiled to WebAssembly and drawn with WebGL, live in this tab. Press play, then read how
    it works.
  </p>
  <div class="cards">
    {#each tiles as t (t.lab)}
      <LabTile lab={t.lab} title={t.title} thesis={t.thesis} setup={t.setup} readout={t.readout} />
    {/each}
  </div>
  <footer class="foot">
    <span>Rust to WebAssembly to WebGL2, with Svelte</span>
    <span>Benjamin Small</span>
  </footer>
</section>

<style>
  .home {
    max-width: 1200px;
    margin: 0 auto;
    padding: 48px 32px 56px;
    animation: fade 200ms ease-out;
  }
  @keyframes fade {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  .thesis { font-size: 22px; font-weight: 500; max-width: 34ch; line-height: 1.3; }
  .lede { color: var(--stone); max-width: 56ch; margin: 10px 0 36px; }
  .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }
  .foot { display: flex; gap: 24px; margin-top: 44px; color: var(--stone); font-size: 14px; }

  @media (max-width: 900px) {
    .cards { grid-template-columns: 1fr; }
  }
  @media (max-width: 768px) {
    .home { padding: 28px 16px 40px; }
  }
</style>
