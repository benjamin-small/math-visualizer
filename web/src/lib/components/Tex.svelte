<script lang="ts">
  // One displayed formula. KaTeX (~280 KB) loads lazily on first use, so a
  // page that never shows a formula never pays for it; until it arrives the
  // TeX source shows as code. Callers interpolate only numbers into `tex`,
  // so the rendered HTML is safe to inject with {@html}.
  import { onMount } from 'svelte';

  interface Props {
    /** The TeX source; only numbers may be interpolated into it. */
    tex: string;
    /** Display (block) math; inline when false. */
    display?: boolean;
  }

  let { tex, display = true }: Props = $props();

  type RenderToString = (tex: string, options?: object) => string;
  let render = $state<RenderToString | null>(null);

  onMount(() => {
    let alive = true;
    void (async () => {
      try {
        const [{ default: katex }] = await Promise.all([import('katex'), import('katex/dist/katex.min.css')]);
        if (alive) render = katex.renderToString;
      } catch (err) {
        console.warn('KaTeX failed to load:', err);
      }
    })();
    return () => {
      alive = false;
    };
  });
</script>

<div class="tex" class:inline={!display}>
  {#if render}
    {@html render(tex, { displayMode: display, throwOnError: false })}
  {:else}
    <code>{tex}</code>
  {/if}
</div>

<style>
  .tex {
    overflow-x: auto;
    font-size: 0.85em;
    color: var(--ink);
  }
  .tex.inline {
    display: inline-block;
  }
  .tex :global(.katex-display) {
    margin: 0.4em 0;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 0.2em 0;
  }
  code {
    display: block;
    white-space: pre-wrap;
    font-size: 0.8em;
    opacity: 0.7;
  }
</style>
