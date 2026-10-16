<script lang="ts">
  // The quantization table the selected block was divided by, as 64 editable
  // cells. Edits stay local until "Apply to image" sends them (as this
  // plane's table) for a re-encode; "Standard" goes back to the
  // quality-scaled tables.
  import type { Rect } from '../../jpeg/layout';

  interface Props {
    /** Where the table goes (its heading included). */
    rect: Rect;
    /** The table in use for the selected block's plane, row-major. */
    table: readonly number[];
    /** "Luma" or "chroma": which table the selected plane uses. */
    which: string;
    /** True while custom tables are in use. */
    custom: boolean;
    /** Send an edited table for a re-encode. */
    onapply: (table: number[]) => void;
    /** Drop custom tables (back to quality scaling). */
    onstandard: () => void;
  }

  let { rect, table, which, custom, onapply, onstandard }: Props = $props();

  /** Local edits, reset whenever the table in use changes. */
  let draft = $state<number[]>([]);
  $effect(() => {
    draft = [...table];
  });
  const dirty = $derived(draft.some((v, i) => v !== table[i]));

  /** A cell's value: a whole number in 1–255 (the last valid one when the input is junk). */
  function setCell(i: number, raw: string) {
    const v = Math.round(Number(raw));
    if (Number.isFinite(v)) draft[i] = Math.min(255, Math.max(1, v));
  }
</script>

{#if rect.w > 120}
  <div class="qtable" style:left="{rect.x}px" style:top="{rect.y}px" style:width="{rect.w}px" style:height="{rect.h}px">
    <div class="head">
      <span>Q table ({which}){custom ? ' — custom' : ''}</span>
    </div>
    <div class="grid" role="group" aria-label="Quantization table, {which}">
      {#each draft as v, i}
        <input
          class="mono"
          type="number"
          min="1"
          max="255"
          value={v}
          aria-label="Q({i % 8}, {Math.floor(i / 8)})"
          onchange={(e) => setCell(i, (e.currentTarget as HTMLInputElement).value)}
        />
      {/each}
    </div>
    <div class="actions">
      <button class="chip" disabled={!dirty} onclick={() => onapply([...draft])}>Apply to image</button>
      <button class="chip" disabled={!custom} onclick={onstandard}>Standard</button>
    </div>
  </div>
{/if}

<style>
  .qtable { position: absolute; display: flex; flex-direction: column; gap: 6px; pointer-events: auto; }
  .head { font-size: 12px; color: rgba(255, 255, 255, 0.72); height: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .grid { flex: 1; display: grid; grid-template-columns: repeat(8, 1fr); grid-auto-rows: 1fr; gap: 2px; min-height: 0; }
  input {
    width: 100%;
    min-width: 0;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.9);
    font-size: 11px;
    text-align: center;
    -moz-appearance: textfield;
    appearance: textfield;
  }
  input::-webkit-inner-spin-button { display: none; }
  input:focus { outline: 1px solid var(--accent); }
  .actions { display: flex; gap: 6px; }
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
  .chip:disabled { opacity: 0.4; cursor: default; }
</style>
