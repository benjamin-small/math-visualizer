<script lang="ts">
  // One displayed formula. KaTeX (~280 KB) loads lazily on first use, so a
  // page that never shows a formula never pays for it; until it arrives the
  // TeX source shows as code. Callers interpolate only numbers into `tex`,
  // so the rendered HTML is safe to inject with {@html}. A display formula
  // wider than its box (a phone) is set smaller until it fits, down to 70%;
  // past that the box scrolls sideways as the last resort.
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

  /** The smallest a display formula is set to make it fit: about 70% of full size. */
  const FLOOR = 0.7;
  let box = $state<HTMLDivElement | null>(null);

  /** Measures the formula at full size and, when it is wider than the box, sets the scale that fits it. */
  function fit(el: HTMLDivElement) {
    el.style.removeProperty('--fit');
    const wide = display ? el.querySelector<HTMLElement>('.katex-display') : null;
    if (!wide) return;
    const need = wide.scrollWidth;
    const have = wide.clientWidth;
    if (!(have > 0) || need <= have + 1) return;
    el.style.setProperty('--fit', String(Math.max(FLOOR, Math.floor((have / need) * 100) / 100)));
  }

  // After each render, and again when the box is resized or KaTeX's fonts arrive (both change the widths).
  $effect(() => {
    void [render, tex, display];
    const el = box;
    if (!el) return;
    fit(el);
    const refit = () => fit(el);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(refit);
    ro?.observe(el);
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    fonts?.addEventListener?.('loadingdone', refit);
    return () => {
      ro?.disconnect();
      fonts?.removeEventListener?.('loadingdone', refit);
    };
  });

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

<div class="tex" class:inline={!display} bind:this={box}>
  {#if render}
    {@html render(tex, { displayMode: display, throwOnError: false })}
  {:else}
    <code>{tex}</code>
  {/if}
</div>

<style>
  .tex {
    overflow-x: auto;
    font-size: calc(0.85em * var(--fit, 1));
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
