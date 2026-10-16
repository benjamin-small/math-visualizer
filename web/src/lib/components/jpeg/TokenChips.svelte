<script lang="ts">
  // The selected block as the encoder writes it: the DC value as a difference
  // from the previous block's, then the AC coefficients as (zeros skipped,
  // size) tokens with their amplitudes. Each chip shows the bits it becomes:
  // the Huffman code, then the amplitude bits.
  import type { Rect } from '../../jpeg/layout';
  import type { SelectedBlock } from '../../jpeg/summary';

  interface Props {
    rect: Rect;
    sel: SelectedBlock;
  }

  let { rect, sel }: Props = $props();

  /** What a token stands for, in words. */
  function label(t: SelectedBlock['tokens'][number]): string {
    if (t.size === 0 && t.run === 0) return 'EOB';
    if (t.size === 0 && t.run === 15) return 'ZRL';
    return `(${t.run}, ${t.size}) ${t.amp}`;
  }

  function title(t: SelectedBlock['tokens'][number]): string {
    if (t.size === 0 && t.run === 0) return 'End of block: every remaining coefficient is zero';
    if (t.size === 0 && t.run === 15) return 'Sixteen zeros in a row';
    return `Skip ${t.run} zero${t.run === 1 ? '' : 's'}, then ${t.amp} (needs ${t.size} bit${t.size === 1 ? '' : 's'})`;
  }

  const bitCount = $derived(sel.bits.length);
</script>

{#if rect.w > 120}
  <div class="tokens" style:left="{rect.x}px" style:top="{rect.y}px" style:width="{rect.w}px" style:height="{rect.h}px">
    <div class="head">64 numbers become {sel.tokens.length + 1} tokens and {bitCount} bits</div>
    <ul>
      <li class="chip dc" title="DC: this block's average, stored as the change from the previous block's ({sel.dcPrev})">
        <span class="what">DC {sel.dcDiff >= 0 ? '+' : ''}{sel.dcDiff}</span>
        <span class="bits mono"><span class="code">{sel.dcCode}</span><span class="amp">{sel.dcAmpBits}</span></span>
      </li>
      {#each sel.tokens as t, i (i)}
        <li class="chip" class:end={t.size === 0} title={title(t)}>
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
