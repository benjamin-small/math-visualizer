<script lang="ts">
  import { onMount } from 'svelte';
  import { route, installRouter } from './lib/router.svelte';
  import Icon from './lib/components/Icon.svelte';
  import ThemeToggle from './lib/components/ThemeToggle.svelte';
  import Home from './lib/components/Home.svelte';
  import SierpinskiLab from './lib/components/labs/SierpinskiLab.svelte';
  import FourierLab from './lib/components/labs/FourierLab.svelte';
  import SortingLab from './lib/components/labs/SortingLab.svelte';

  onMount(installRouter);
</script>

<div class="app">
  <header class="bar">
    <a class="wordmark" href="#/">Math Visualizer</a>
    {#if route.id !== 'home'}
      <nav class="tabs" aria-label="Labs">
        <a href="#/sierpinski" aria-current={route.id === 'sierpinski' ? 'page' : undefined}>Sierpinski <span class="rest">Pyramid</span></a>
        <a href="#/fourier" aria-current={route.id === 'fourier' ? 'page' : undefined}>Fourier <span class="rest">Epicycles</span></a>
        <a href="#/sorting" aria-current={route.id === 'sorting' ? 'page' : undefined}>Sorting <span class="rest">Algorithms</span></a>
      </nav>
    {/if}
    <a class="source" href="https://github.com/benjamin-small/math-visualizer" rel="noopener" aria-label="Source">
      <Icon name="github" /><span class="text">Source</span>
    </a>
    <ThemeToggle />
  </header>
  <!-- Distinct components per branch: switching destroys the old lab (and its
       engine) synchronously before the new canvas exists. -->
  <main>
    {#if route.id === 'home'}
      <Home />
    {:else if route.id === 'fourier'}
      <FourierLab />
    {:else if route.id === 'sorting'}
      <SortingLab />
    {:else}
      <SierpinskiLab />
    {/if}
  </main>
</div>

<style>
  .app { min-height: 100dvh; display: flex; flex-direction: column; }
  .bar {
    position: sticky;
    top: 0;
    z-index: 10;
    height: var(--nav-h);
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 0 32px;
    background: var(--paper);
    border-bottom: 1px solid var(--line);
  }
  .wordmark { font-weight: 600; color: var(--ink); text-decoration: none; margin-right: auto; white-space: nowrap; }
  .tabs { display: flex; gap: 18px; overflow-x: auto; }
  .tabs a { color: var(--stone); text-decoration: none; font-size: 15px; padding: 4px 0; white-space: nowrap; }
  .tabs a:hover { color: var(--ink); }
  .tabs a[aria-current="page"] { color: var(--ink); box-shadow: inset 0 -2px 0 var(--accent); }
  .source { display: inline-flex; align-items: center; gap: 6px; color: var(--stone); text-decoration: none; font-size: 15px; }
  .source:hover { color: var(--ink); }
  main { flex: 1; }

  @media (max-width: 768px) {
    /* The tabs take their own row under the wordmark so nothing is clipped;
       the row scrolls sideways if it still overflows. */
    .bar { flex-wrap: wrap; height: auto; min-height: var(--nav-h); padding: 0 16px; gap: 0 12px; }
    .wordmark { line-height: var(--nav-h); }
    .source, .bar :global(.theme) { line-height: var(--nav-h); }
    .tabs {
      order: 10;
      flex-basis: 100%;
      gap: 16px;
      padding: 0 0 10px;
      margin: 0 -16px;
      padding-left: 16px;
      padding-right: 16px;
      scrollbar-width: none;
    }
    .tabs::-webkit-scrollbar { display: none; }
    .tabs a { font-size: 14px; }
  }
  @media (max-width: 480px) {
    .source .text { display: none; }
    .bar :global(.theme .word) { display: none; }
    /* Short lab names fit without scrolling; icon-only header controls get a 44px hit area. */
    .tabs .rest { display: none; }
    .tabs { gap: 20px; }
    .source, .bar :global(.theme) { min-width: 44px; min-height: 44px; justify-content: center; padding: 0 6px; }
  }
</style>
