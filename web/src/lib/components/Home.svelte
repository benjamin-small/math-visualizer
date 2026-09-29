<script lang="ts">
  // The gallery: thesis, lede, three live lab tiles, and a footer line.
  import { cmd } from '../playback/commands';
  import { readSummary } from '../sorting/summary';
  import { allLanes } from '../sorting/lanes';
  import type { LabApi } from './labApi.svelte';
  import LabTile from './LabTile.svelte';

  const fmt = (n: number) => n.toLocaleString('en-US');

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
      setup: (api: LabApi) => api.dispatch(cmd.play()),
      readout: (api: LabApi) => `${fmt(api.snapshot.iteration)} / ${fmt(api.snapshot.max_iterations)}`,
    },
    {
      lab: 'sorting' as const,
      title: 'Sorting Algorithms',
      thesis: 'Seven algorithms race four datasets on one clock, so you see the work each one does.',
      setup: (api: LabApi) => {
        api.dispatch(cmd.setSpeed(60));
        api.dispatch(cmd.play());
        api.ruleAction({ kind: 'set_running', lanes: allLanes(7, 4), running: true });
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
