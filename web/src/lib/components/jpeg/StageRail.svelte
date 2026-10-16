<script lang="ts">
  // The pipeline rail: nine numbered steps, the current one marked. Stages
  // not built yet stay visible but disabled, so the whole pipeline reads at a
  // glance.
  import { STAGES, type StageId } from '../../jpeg/stages';

  interface Props {
    /** The stage on screen. */
    current: StageId;
    /** Called with a ready stage's id when the reader picks it. */
    onselect: (id: StageId) => void;
  }

  let { current, onselect }: Props = $props();
</script>

<nav class="rail" aria-label="JPEG pipeline">
  <ol>
    {#each STAGES as s (s.id)}
      <li>
        <button
          class="step"
          class:current={s.id === current}
          aria-current={s.id === current ? 'step' : undefined}
          disabled={!s.ready}
          title={s.ready ? s.subtitle : `${s.subtitle} (coming soon)`}
          onclick={() => onselect(s.id)}
        >
          <span class="mark mono">{s.mark}</span>
          <span class="title">{s.title}</span>
        </button>
      </li>
    {/each}
  </ol>
</nav>

<style>
  .rail { width: 100%; }
  ol {
    display: flex;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
    overflow-x: auto;
  }
  li { flex: 1 0 auto; }
  .step {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 40px;
    padding: 0 10px;
    border: 1px solid transparent;
    border-radius: var(--radius-button);
    background: none;
    color: var(--stone);
    font-size: 14px;
    cursor: pointer;
    white-space: nowrap;
  }
  .step:hover:not(:disabled) { border-color: var(--line); color: var(--ink); }
  .step.current { border-color: var(--accent); color: var(--ink); background: var(--tint); }
  .step:disabled { cursor: default; opacity: 0.5; }
  .mark {
    display: inline-grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 1px solid var(--line);
    font-size: 12px;
    flex: none;
  }
  .current .mark { background: var(--accent); border-color: var(--accent); color: var(--paper); }
</style>
