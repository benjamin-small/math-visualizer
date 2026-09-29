<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import LabShell from '../LabShell.svelte';
  import FormulaPanel from '../FormulaPanel.svelte';
  import Icon from '../Icon.svelte';
  import type { LabApi } from '../labApi.svelte';
  import { cmd } from '../../playback/commands';
  import { textToPath, samplesFor, packPath } from '../../fourier/textPath';
  import { readSummary, type FourierSummary } from '../../fourier/summary';
  import { route, replaceQuery } from '../../router.svelte';
  import { buildQuery } from '../../router';

  const DEFAULT_TEXT = 'POIETIC TECH';
  /** Pen steps per full trace — the ink resolution, independent of the DFT sample count. */
  const TRACE_STEPS = 2000;
  const MAX_EPICYCLES = 50_000;
  const DEBOUNCE_MS = 150;
  const DEFAULT_EPICYCLES = 2000;
  const MAX_TEXT = 40;

  /** Read the shareable-link params from a hash query: `text=…` and `n=…` (epicycles). */
  function paramsOf(query: string) {
    const p = new URLSearchParams(query);
    const t = p.get('text');
    const n = Math.floor(Number(p.get('n')));
    return {
      text: t !== null && t.trim() !== '' ? t.slice(0, MAX_TEXT) : undefined,
      epicycles: Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_EPICYCLES) : undefined,
    };
  }
  const initialParams = paramsOf(route.query);

  let text = $state(initialParams.text ?? DEFAULT_TEXT);
  let epicycles = $state(initialParams.epicycles ?? DEFAULT_EPICYCLES);
  /** Query we last wrote (or consumed), so our own replaceQuery() doesn't re-trigger a push. */
  let appliedQuery = route.query;
  let copied = $state(false);

  /** Keep the URL a shareable link to the current message (defaults are omitted). */
  function syncUrl() {
    const q = buildQuery({
      text: text === DEFAULT_TEXT ? undefined : text,
      n: epicycles === DEFAULT_EPICYCLES ? undefined : String(epicycles),
    });
    appliedQuery = q;
    replaceQuery(q);
  }

  // A pasted link / back-forward while on this page: adopt its params and redraw.
  $effect(() => {
    const q = route.query;
    untrack(() => {
      if (q === appliedQuery) return;
      appliedQuery = q;
      const p = paramsOf(q);
      const nextText = p.text ?? DEFAULT_TEXT;
      const nextN = p.epicycles ?? DEFAULT_EPICYCLES;
      if (nextText !== text || nextN !== epicycles) {
        text = nextText;
        epicycles = nextN;
        void push();
      }
    });
  });

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(location.href);
      copied = true;
      window.setTimeout(() => { copied = false; }, 1500);
    } catch (err) {
      console.warn('copy link failed:', err);
    }
  }
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
   * Text to path to engine. Runs on ready, on (debounced) text edits, and on
   * epicycle changes — one code path so every route re-derives the same way.
   * update_rule_config resets playback to iteration 0 *paused*, so we follow
   * it with Play to start the trace.
   */
  async function push() {
    clearTimeout(timer);
    const my = ++gen;
    let path: Awaited<ReturnType<typeof textToPath>>;
    try {
      path = await textToPath(text, { samples: samplesFor(epicycles) });
    } catch (err) {
      console.warn('textToPath failed:', err);
      return;
    }
    if (my !== gen || !api?.engine) return; // superseded, or shell torn down / not ready yet
    empty = path.length === 0;
    syncUrl();
    if (empty) {
      summary = null;
      return;
    }
    const { xy, pen } = packPath(path);
    api.setRuleConfigWithPath({ epicycles, max_iterations: Math.min(path.length, TRACE_STEPS) }, xy, pen);
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

<LabShell
  labId="fourier"
  title="Fourier Epicycles"
  thesis="Your words, redrawn by a chain of spinning circles."
  initialSpeed={120}
  {onReady}
>
  {#snippet controls()}
    <label class="field">
      Text
      <input
        class="text"
        type="text"
        bind:value={text}
        oninput={schedulePush}
        placeholder="Type something"
        aria-label="Text to trace"
        maxlength="40"
      />
    </label>
    <label class="field">
      Epicycles
      <input
        type="number"
        min="1"
        max={MAX_EPICYCLES}
        step="1"
        value={epicycles}
        onchange={onEpicycles}
        aria-label="Epicycles"
      />
    </label>
    <button class="btn" type="button" onclick={copyLink} title="Copy a link to this message">
      <Icon name={copied ? 'check' : 'copy'} />{copied ? 'Copied' : 'Copy link'}
    </button>
    {#if empty}<span class="hint">Nothing to draw. Type some letters.</span>{/if}
  {/snippet}

  {#snippet legend()}
    <span class="item"><i class="swatch ring"></i>Rings</span>
    <span class="item"><i class="swatch arm"></i>Arms</span>
    <span class="item"><i class="swatch pen"></i>Pen</span>
    <span class="item"><i class="swatch ink"></i>Ink</span>
  {/snippet}

  {#snippet story()}
    <h2>How it works</h2>
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
    <FormulaPanel {summary} />
    <p class="tip">
      <em>Type your own text</em> in the bezel above. More epicycles means
      sharper letters; fewer gives a smoother caricature — try <em>20</em>.
    </p>
    <p class="tip">
      The straight hops between letters are pen-up: the circles still travel
      them, they just don't leave ink.
    </p>
    <p class="tip">
      Once the trace completes the circles and arms disappear, leaving the
      text. Hit <em>Reset</em>, then <em>Play</em> to watch it draw again.
    </p>
  {/snippet}
</LabShell>

<style>
  /* The bezel extras render inside LabShell via the `controls` snippet.
     The shell supplies the shared `.field` / `.btn` look (as :global rules);
     snippet markup carries this component's scope, so sizing lives here. */
  .field input.text {
    width: 16rem;
    font-family: var(--font-sans);
  }
  .field input[type='number'] {
    width: 6rem;
  }
  .hint {
    color: var(--stone);
    font-size: 13px;
  }

  /* Legend swatches. The shell's `.legend :global(.swatch)` supplies the
     base dot (size, shape, flex-shrink); the element prefix outranks it so
     the per-kind rules below win. Colours mirror the viz defaults in
     crates/viz-core/src/visualizations/fourier_epicycles.rs. */
  i.swatch.ring {
    background: transparent;
    border: 2px solid rgba(140, 153, 191, 0.9);
    box-sizing: border-box;
  }
  i.swatch.arm {
    width: 14px;
    height: 2px;
    border-radius: 0;
    background: #8f8fa3;
  }
  i.swatch.pen { background: #fa9959; }
  i.swatch.ink { background: #a6d9f2; }
</style>
