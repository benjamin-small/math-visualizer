<script lang="ts">
  import { onMount } from 'svelte';
  import { route, installRouter } from './lib/router.svelte';
  import SierpinskiLab from './lib/components/labs/SierpinskiLab.svelte';
  import FourierLab from './lib/components/labs/FourierLab.svelte';

  onMount(installRouter);
</script>

<div class="app">
  <nav class="topnav">
    <span class="brand">Math Visualizer</span>
    <a href="#/sierpinski" class:active={route.id === 'sierpinski'}>Sierpinski Pyramid</a>
    <a href="#/fourier" class:active={route.id === 'fourier'}>Fourier Epicycles</a>
  </nav>
  <!-- Distinct components per branch: switching destroys the old lab (and its
       LabShell → engine.free()) synchronously before the new canvas exists. -->
  {#if route.id === 'fourier'}
    <FourierLab />
  {:else}
    <SierpinskiLab />
  {/if}
</div>

<style>
  .app {
    display: grid;
    grid-template-rows: var(--nav-h) 1fr;
    height: 100vh;
    height: 100dvh;  /* dynamic vh so mobile address bars don't clip */
  }
  .topnav {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0 1rem;
    background: var(--bar);
    border-bottom: 1px solid var(--border);
    font-size: 0.9rem;
  }
  .brand {
    color: var(--text-strong);
    font-weight: 600;
    margin-right: 0.5rem;
  }
  .topnav a {
    color: var(--text);
    text-decoration: none;
    padding: 0.35rem 0.6rem;
    border-radius: 4px;
  }
  .topnav a.active {
    background: #2a2a2f;
    color: var(--text-strong);
  }
  .topnav a:hover {
    color: var(--text-strong);
  }
</style>
