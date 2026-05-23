<script lang="ts">
  import { onMount } from 'svelte';
  import { loadVizCore } from './lib/wasm/loader';

  let status = $state('Loading WASM…');

  onMount(async () => {
    const viz = await loadVizCore();
    const sum = viz.add(2, 3);
    status = `WASM loaded. add(2, 3) = ${sum}`;
  });
</script>

<main>
  <h1>Math Visualizer</h1>
  <p>{status}</p>
</main>

<style>
  main { padding: 2rem; }
</style>
