<script lang="ts">
  // "The formula" section of the Fourier info panel: the general epicycle
  // series, then the live expansion for the current text (top `shown` DFT
  // terms with real numbers). KaTeX (~280 KB) is imported lazily here so it
  // loads only on the Fourier page. Numbers are the only interpolated content,
  // so the rendered HTML is safe to inject with {@html}.
  import { onMount } from 'svelte';
  import {
    GENERAL_TEX,
    expansionTex,
    remainingTerms,
    type FourierSummary,
  } from '../fourier/summary';

  interface Props {
    summary: FourierSummary | null;
    /** How many of the largest terms to expand (the engine hands us ≤ 64). */
    shown?: number;
  }

  let { summary, shown = 8 }: Props = $props();

  type RenderToString = (tex: string, options?: object) => string;
  let katexRender = $state<RenderToString | null>(null);

  onMount(() => {
    let alive = true;
    void (async () => {
      try {
        const [{ default: katex }] = await Promise.all([
          import('katex'),
          import('katex/dist/katex.min.css'),
        ]);
        if (alive) katexRender = katex.renderToString;
      } catch (err) {
        console.warn('KaTeX failed to load:', err);
      }
    })();
    return () => {
      alive = false; // unmounted before the import resolved — don't touch state
    };
  });

  const expansion = $derived(summary ? expansionTex(summary, shown) : null);
  const more = $derived(summary ? remainingTerms(summary, shown) : 0);

  function render(tex: string): string {
    return katexRender!(tex, { displayMode: true, throwOnError: false });
  }
</script>

{#snippet tex(source: string)}
  <div class="tex">
    {#if katexRender}
      {@html render(source)}
    {:else}
      <code>{source}</code>
    {/if}
  </div>
{/snippet}

<h3>The formula</h3>
{@render tex(GENERAL_TEX)}
<p>
  Each term is one circle: <em>A<sub>k</sub></em> its radius, <em>f<sub>k</sub></em> how
  many turns it makes per trace, <em>φ<sub>k</sub></em> its starting angle. The pen is
  <em>z(t)</em> as <em>t</em> runs from 0 to 1.
</p>
{#if expansion}
  {@render tex(expansion)}
  {#if more > 0}
    <p class="tail">… + {more.toLocaleString('en-US')} more terms</p>
  {/if}
{:else}
  <p class="hint">Type some text to see its terms.</p>
{/if}

<style>
  /* A wide `aligned` block scrolls inside the 320px panel instead of
     overflowing it. KaTeX sets no color of its own, so the strong text
     token is inherited by the rendered math. */
  .tex {
    overflow-x: auto;
    font-size: 0.85em;
    color: var(--text-strong);
  }
  .tex :global(.katex-display) {
    margin: 0.5em 0;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 0.2em 0;
  }
  .tex code {
    display: block;
    white-space: pre;
    font-size: 0.8em;
    opacity: 0.7;
  }
  .tail {
    color: #a0a0aa;
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
  }
  .hint {
    color: #a0a0aa;
    font-size: 0.8rem;
  }
  sub {
    font-size: 0.75em;
  }
</style>
