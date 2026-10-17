<script lang="ts">
  // The selected block as the encoder writes it: the DC value as a difference
  // from the previous block's, then the AC coefficients as (zeros skipped,
  // size) tokens with their amplitudes. Each chip shows the bits it becomes:
  // the Huffman code, then the amplitude bits.
  import type { Rect } from '../../jpeg/layout';
  import type { SelectedBlock } from '../../jpeg/summary';
  import { tooltip, type TooltipController } from './tooltip.svelte';

  interface Props {
    rect: Rect;
    sel: SelectedBlock;
    /** The page's cards: the bit count and each chip explain themselves. */
    ctl: TooltipController;
  }

  let { rect, sel, ctl }: Props = $props();

  /** What a token stands for, in words. */
  function label(t: SelectedBlock['tokens'][number]): string {
    if (t.size === 0 && t.run === 0) return 'EOB';
    if (t.size === 0 && t.run === 15) return 'ZRL';
    return `(${t.run}, ${t.size}) ${t.amp}`;
  }

  const bitCount = $derived(sel.bits.length);
</script>

{#if rect.w > 120}
  <div class="tokens" style:left="{rect.x}px" style:top="{rect.y}px" style:width="{rect.w}px" style:height="{rect.h}px">
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="head" tabindex="0" use:tooltip={{ ctl, target: { id: 'rle.bits' } }}>64 numbers become {sel.tokens.length + 1} tokens and {bitCount} bits</div>
    <ul>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <li class="chip dc" tabindex="0" use:tooltip={{ ctl, target: { id: 'rle.dc' } }}>
        <span class="what">DC {sel.dcDiff >= 0 ? '+' : ''}{sel.dcDiff}</span>
        <span class="bits mono"><span class="code">{sel.dcCode}</span><span class="amp">{sel.dcAmpBits}</span></span>
      </li>
      {#each sel.tokens as t, i (i)}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
        <li class="chip" class:end={t.size === 0} tabindex="0" use:tooltip={{ ctl, target: { id: 'rle.token', i } }}>
          <span class="what">{label(t)}</span>
          <span class="bits mono"><span class="code">{t.code}</span><span class="amp">{t.ampBits}</span></span>
        </li>
      {/each}
    </ul>
    <div class="key"><span class="sw code"></span>Huffman code <span class="sw amp"></span>amplitude bits</div>
  </div>
{/if}

<style>
  .tokens { position: absolute; display: flex; flex-direction: column; gap: 8px; overflow: auto; color: rgba(255, 255, 255, 0.72); font-size: 12px; pointer-events: auto; }
  .head { white-space: nowrap; }
  .head:focus-visible, .chip:focus-visible { outline: 1px dashed var(--accent); outline-offset: 2px; }
  ul { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }
  .chip {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 4px 8px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.3);
  }
  .chip.dc { border-color: var(--accent); }
  .chip.end { border-style: dashed; }
  .what { color: rgba(255, 255, 255, 0.9); white-space: nowrap; }
  .bits { font-size: 11px; letter-spacing: 0.5px; word-break: break-all; }
  .code { color: #e9a07c; }
  .amp { color: #8fb7f2; }
  .key { display: flex; align-items: center; gap: 6px; font-size: 11px; }
  .sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; }
  .sw.code { background: #e9a07c; }
  .sw.amp { background: #8fb7f2; }
</style>
