<script lang="ts">
  import { onDestroy } from 'svelte';
  import LabShell from '../LabShell.svelte';
  import FormulaPanel from '../FormulaPanel.svelte';
  import type { LabApi } from '../labApi.svelte';
  import { cmd } from '../../playback/commands';
  import { textToPath } from '../../fourier/textPath';
  import { readSummary, type FourierSummary } from '../../fourier/summary';

  const DEFAULT_TEXT = 'poetic tech';
  const SAMPLES = 2000;
  const MAX_EPICYCLES = 2000;
  const DEBOUNCE_MS = 150;

  let text = $state(DEFAULT_TEXT);
  let epicycles = $state(2000);
  /** True when the current text produced no drawable path (blank, or no outline). */
  let empty = $state(false);
  /** The DFT terms behind the current trace, read from the engine after each config push (null when nothing is drawn). */
  let summary = $state<FourierSummary | null>(null);
  // Plain (never read in markup): the shell hands us its LabApi in onReady.
  let api: LabApi | null = null;
  // Generation counter: a push that finishes after a newer one started is discarded.
  let gen = 0;
  let timer = 0;

  /**
   * Text → path → engine. Runs on ready, on (debounced) text edits, and on
   * epicycle changes — one code path so every route re-derives the same way.
   * update_rule_config resets playback to iteration 0 *paused*, so we follow
   * it with Play to start the trace.
   */
  async function push() {
    clearTimeout(timer);
    const my = ++gen;
    let path: Awaited<ReturnType<typeof textToPath>>;
    try {
      path = await textToPath(text, { samples: SAMPLES });
    } catch (err) {
      console.warn('textToPath failed:', err);
      return;
    }
    if (my !== gen || !api?.engine) return; // superseded, or shell torn down / not ready yet
    empty = path.length === 0;
    if (empty) {
      summary = null;
      return;
    }
    api.setRuleConfig({ path, epicycles, max_iterations: path.length });
    summary = readEngineSummary(api);
    api.dispatch(cmd.play());
  }

  /**
   * `rule_summary()` is cheap but not free, so it's read here — once per
   * config push — never per frame. Older engines (and test fakes) may lack it.
   */
  function readEngineSummary(a: LabApi): FourierSummary | null {
    try {
      return readSummary(a.engine?.rule_summary?.());
    } catch (err) {
      console.warn('rule_summary failed:', err);
      return null;
    }
  }

  function schedulePush() {
    clearTimeout(timer);
    timer = window.setTimeout(() => { void push(); }, DEBOUNCE_MS);
  }

  function onEpicycles(e: Event) {
    const n = Math.floor(Number((e.target as HTMLInputElement).value));
    if (!Number.isFinite(n) || n < 1) return;
    epicycles = Math.min(n, MAX_EPICYCLES);
    void push();
  }

  function onReady(a: LabApi) {
    api = a;
    void push();
  }

  onDestroy(() => {
    gen++;
    clearTimeout(timer);
  });
</script>

<LabShell labId="fourier" initialSpeed={360} {onReady}>
  {#snippet info()}
    <h2>Fourier Epicycles</h2>
    <p>
      The outline of the text is turned into one closed path (the pen lifts
      between letters). That path's <strong>discrete Fourier transform</strong>
      gives a list of rotating circles — each with a fixed radius (amplitude),
      speed (frequency), and starting angle (phase).
    </p>
    <ol>
      <li>Chain the circles tip-to-tail, biggest first.</li>
      <li>Advance time — every circle rotates by its own frequency.</li>
      <li>The chain's tip is the pen; where the pen is down, it leaves ink.</li>
    </ol>
    <p>One full playthrough traces the text once.</p>
    <h3>What you're seeing</h3>
    <ul>
      <li><span class="swatch ring"></span> Rings — the epicycles</li>
      <li><span class="swatch arm"></span> Arms — center-to-center links</li>
      <li><span class="swatch pen"></span> Pen — the moving tip</li>
      <li><span class="swatch ink"></span> Ink — the traced text</li>
    </ul>
    <FormulaPanel {summary} />
    <p class="tip">
      <em>Type your own text</em> in the bar below. More epicycles means
      sharper letters; fewer gives a smoother caricature — try <em>20</em>.
    </p>
    <p class="tip">
      The straight hops between letters are pen-up: the circles still travel
      them, they just don't leave ink.
    </p>
    <p class="tip">
      Once the trace completes the circles and arms disappear, leaving the
      text. Hit <em>Reset ↺</em> then <em>▶</em> to watch it draw again.
    </p>
  {/snippet}

  {#snippet controls()}
    <input
      class="text"
      type="text"
      bind:value={text}
      oninput={schedulePush}
      placeholder="Type something…"
      aria-label="Text to trace"
      maxlength="40"
    />
    <label class="epicycles">
      Epicycles
      <input
        type="number"
        min="1"
        max={MAX_EPICYCLES}
        step="1"
        value={epicycles}
        onchange={onEpicycles}
        title="Epicycles"
      />
    </label>
    {#if empty}<span class="hint">Nothing to draw — type some letters.</span>{/if}
  {/snippet}
</LabShell>

<style>
  /* Rendered inside LabShell's .playback-bar via the `controls` snippet;
     snippet markup carries this component's scope, so the rules live here.
     Inputs match the shell's buttons and Sierpinski's Iterations field. */
  .text,
  .epicycles input {
    background: #2a2a2f;
    color: #eee;
    border: 1px solid #3a3a40;
    border-radius: 4px;
    padding: 0.25rem 0.4rem;
  }
  .text {
    width: 11rem;
  }
  .epicycles {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: #bbb;
  }
  .epicycles input {
    width: 5rem;
    font-variant-numeric: tabular-nums;
  }
  .hint {
    color: #a0a0aa;
    font-size: 0.8rem;
  }

  /* Legend swatches. The shell's `.info :global(.swatch)` supplies the base
     dot (size, shape, flex-shrink); the `span` prefix outranks it so the
     per-kind rules below win. Colors mirror the viz defaults in
     crates/viz-core/src/visualizations/fourier_epicycles.rs. */
  span.swatch.ring {
    background: transparent;
    border: 2px solid rgba(140, 153, 191, 0.9);
    box-sizing: border-box;
  }
  span.swatch.arm {
    background: #d9d9e6;
    border-radius: 0;
    height: 2px;
  }
  span.swatch.pen { background: #fa9959; }
  span.swatch.ink { background: #a6d9f2; }
</style>
