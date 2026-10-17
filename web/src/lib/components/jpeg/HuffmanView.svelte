<script lang="ts">
  // The Huffman stage: pick one of the four tables to see how often each
  // symbol occurs, the code tree that serves them (short codes high up), and
  // what the codes cost against Shannon's bound; below, the selected block's
  // bits coloured by part and the whole file as a bar of its segments.
  import { onMount } from 'svelte';
  import { bitParts } from '../../jpeg/explain/coding';
  import { tooltip, type TooltipController } from './tooltip.svelte';
  import { loadVizCore, type VizCore } from '../../wasm/loader';
  import type { Rect } from '../../jpeg/layout';
  import type { SelectedBlock } from '../../jpeg/summary';
  import {
    TABLE_LABELS,
    nodeXY,
    readTree,
    symbolLabel,
    topCounts,
    type HuffTableView,
    type SegmentView,
  } from '../../jpeg/huffman';

  interface Props {
    rect: Rect;
    tables: HuffTableView[];
    segments: SegmentView[];
    sel: SelectedBlock | null;
    /** File size with the other Huffman mode, when known (for the comparison line). */
    otherBytes: number | null;
    bytes: number;
    huffman: string;
    /** The page's cards: every part of this view explains itself. */
    ctl: TooltipController;
  }

  let { rect, tables, segments, sel, otherBytes, bytes, huffman, ctl }: Props = $props();

  let kit = $state<VizCore | null>(null);
  onMount(() => {
    let alive = true;
    void loadVizCore()
      .then((v) => {
        if (alive) kit = v;
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  });

  let tab = $state(1); // AC · luma: the biggest table
  const table = $derived(tables[tab] ?? null);
  const bars = $derived(table ? topCounts(table.counts, 24) : []);
  const maxCount = $derived(Math.max(1, ...bars.map((b) => b[1])));
  const tree = $derived.by(() => {
    if (!table || !kit) return [];
    try {
      return readTree(kit.jpeg_huffman_tree(new Uint8Array(table.bits), new Uint8Array(table.vals)));
    } catch {
      return [];
    }
  });
  const leaves = $derived(tree.filter((n) => n.symbol != null));
  const maxDepth = $derived(Math.max(1, ...tree.map((n) => n.depth)));
  const fileBytes = $derived(Math.max(1, segments.reduce((s, g) => s + g.len, 0)));

  /** The selected block's bits split by part, in file order (the same list the cards index into). */
  const parts = $derived(sel ? bitParts(sel) : []);

  /** Arrow keys move along a row of focusable marks (`selector` within the same svg); only one is in the tab order. */
  function walk(e: KeyboardEvent, selector: string) {
    if (e.altKey || e.metaKey || e.ctrlKey) return;
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (d === 0) return;
    e.preventDefault();
    e.stopPropagation(); // not also a stage switch
    const row = [...(e.currentTarget as Element).closest('svg, .bits')!.querySelectorAll<SVGElement | HTMLElement>(selector)];
    row[row.indexOf(e.currentTarget as SVGElement) + d]?.focus();
  }
  /** Which bar and which leaf the Tab key reaches (by index). */
  let barRove = $state(0);
  let leafRove = $state(0);
  let partRove = $state(0);

  const W = $derived(Math.max(0, rect.w));
  const chartH = $derived(Math.max(0, Math.min(220, rect.h - 190)));
  const half = $derived(Math.max(0, W / 2 - 8));
  /** Bar width; symbol names go under the bars when they fit. */
  const bw = $derived(half / Math.max(1, bars.length));
  /** Room under the bars for the symbol names. */
  const LABELS = 14;
</script>

{#if rect.w > 200 && rect.h > 220}
  <div class="huff" style:left="{rect.x}px" style:top="{rect.y}px" style:width="{rect.w}px" style:height="{rect.h}px">
    <div class="tabs" role="tablist" aria-label="Huffman tables">
      {#each tables as t, i (t.name)}
        <button
          role="tab"
          class="chip"
          aria-selected={i === tab}
          onclick={() => (tab = i)}
          use:tooltip={{ ctl, target: { id: 'huffman.tab', table: i }, acts: true }}
        >{TABLE_LABELS[t.name] ?? t.name}</button>
      {/each}
    </div>

    {#if table}
      <div class="row">
        <figure>
          <figcaption>How often each symbol occurs (top {bars.length})</figcaption>
          <svg width={half} height={chartH} aria-label="Symbol counts">
            {#each bars as [symbol, count], i}
              {@const h = (count / maxCount) * (chartH - LABELS - 4)}
              <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
              <g
                class="col"
                role="img"
                aria-label="{symbolLabel(table.name, symbol)}: {count} times"
                tabindex={i === Math.min(barRove, bars.length - 1) ? 0 : -1}
                onfocus={() => (barRove = i)}
                onkeydown={(e) => walk(e, '.col')}
                use:tooltip={{ ctl, target: { id: 'huffman.bar', table: tab, symbol } }}
              >
                <rect class="slot" x={i * bw} y="0" width={Math.max(1, bw)} height={chartH - LABELS} />
                <rect class="bar" x={i * bw + 1} y={chartH - LABELS - h} width={Math.max(1, bw - 2)} height={h} />
              </g>
              {#if bw >= 28}
                <text class="sym" x={i * bw + bw / 2} y={chartH - 2}>{symbolLabel(table.name, symbol).replace('size ', '')}</text>
              {/if}
            {/each}
          </svg>
        </figure>
        <figure>
          <figcaption>The code tree (left = 0, right = 1)</figcaption>
          <svg width={half} height={chartH} aria-label="Code tree">
            {#each tree as n (n.depth + ':' + n.code)}
              {#if n.depth > 0}
                {@const [x, y] = nodeXY(n.code, half, chartH - 6, maxDepth)}
                {@const [px, py] = nodeXY(n.code.slice(0, -1), half, chartH - 6, maxDepth)}
                <line class="edge" x1={px} y1={py + 3} x2={x} y2={y + 3} />
              {/if}
            {/each}
            {#each leaves as n, li (n.code)}
              {@const [x, y] = nodeXY(n.code, half, chartH - 6, maxDepth)}
              <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
              <circle
                class="leaf"
                cx={x}
                cy={y + 3}
                r="2.5"
                role="img"
                aria-label="{symbolLabel(table.name, n.symbol ?? 0)} = {n.code}"
                tabindex={li === Math.min(leafRove, leaves.length - 1) ? 0 : -1}
                onfocus={() => (leafRove = li)}
                onkeydown={(e) => walk(e, '.leaf')}
                use:tooltip={{ ctl, target: { id: 'huffman.leaf', table: tab, symbol: n.symbol ?? 0 } }}
              />
            {/each}
          </svg>
        </figure>
      </div>
      <p class="stat">
        <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
        <span class="cost" tabindex="0" use:tooltip={{ ctl, target: { id: 'huffman.cost', table: tab } }}>
          This table: <span class="mono">{Math.round(table.actualBits)}</span> bits of codes against
          <span class="mono">{Math.round(table.entropyBits)}</span> at the entropy limit
          ({table.entropyBits > 0 ? ((100 * table.actualBits) / table.entropyBits - 100).toFixed(1) : '0.0'}% over).
        </span>
        {#if otherBytes != null}
          With {huffman === 'optimized' ? 'standard' : 'optimized'} tables the file would be
          <span class="mono">{otherBytes}</span> bytes instead of <span class="mono">{bytes}</span>.
        {/if}
      </p>
    {/if}

    {#if sel}
      <div class="bits mono" aria-label="The selected block's bits">
        {#each parts as p, i (i)}<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions --><span
            class={p.kind}
            role="img"
            aria-label="{p.kind === 'code' ? 'Code' : 'Value'} bits {p.text}"
            tabindex={i === Math.min(partRove, parts.length - 1) ? 0 : -1}
            onfocus={() => (partRove = i)}
            onkeydown={(e) => walk(e, 'span')}
            use:tooltip={{ ctl, target: { id: 'huffman.bits', part: i } }}>{p.text}</span>{/each}
      </div>
    {/if}

    {#if segments.length}
      <div class="file" aria-label="The file's segments">
        {#each segments as s, i (s.offset)}
          <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
          <span
            class="seg"
            class:scan={s.kind === 'Sos'}
            style:flex-grow={Math.max(s.len / fileBytes, 0.02)}
            tabindex="0"
            use:tooltip={{ ctl, target: { id: 'huffman.segment', i } }}>{s.kind}</span>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .huff { position: absolute; display: flex; flex-direction: column; gap: 8px; color: rgba(255, 255, 255, 0.72); font-size: 12px; pointer-events: auto; overflow: hidden; }
  .tabs { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip {
    height: 26px;
    padding: 0 10px;
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.35);
    color: rgba(255, 255, 255, 0.85);
    font-size: 12px;
    cursor: pointer;
  }
  .chip[aria-selected='true'] { border-color: var(--accent); color: #fff; }
  .row { display: flex; gap: 16px; }
  figure { margin: 0; }
  figcaption { margin-bottom: 4px; white-space: nowrap; }
  svg { display: block; overflow: visible; }
  .bar { fill: #e27a52; pointer-events: none; }
  .slot { fill: transparent; }
  .col { cursor: default; }
  .col:focus { outline: none; }
  .col:focus-visible .slot { stroke: var(--accent); stroke-dasharray: 3 2; }
  .cost:focus-visible, .seg:focus-visible, .bits span:focus-visible { outline: 1px dashed var(--accent); outline-offset: 2px; }
  .sym { fill: rgba(255, 255, 255, 0.6); font-size: 10px; text-anchor: middle; }
  .edge { stroke: rgba(255, 255, 255, 0.25); }
  .leaf { fill: #8fb7f2; stroke: transparent; stroke-width: 10px; paint-order: stroke; }
  .leaf:focus { outline: none; }
  .leaf:focus-visible { stroke: var(--accent); stroke-width: 2px; }
  .stat { margin: 0; line-height: 1.5; }
  .bits { font-size: 11px; line-height: 1.5; word-break: break-all; max-height: 4.5em; overflow: auto; }
  .bits .code { color: #e9a07c; }
  .bits .amp { color: #8fb7f2; }
  .file { display: flex; height: 22px; gap: 1px; }
  .seg {
    flex-basis: 0;
    min-width: 2px;
    overflow: hidden;
    padding: 0 3px;
    background: rgba(255, 255, 255, 0.12);
    font-size: 10px;
    line-height: 22px;
    white-space: nowrap;
  }
  .seg.scan { background: rgba(226, 122, 82, 0.45); color: #fff; }
</style>
