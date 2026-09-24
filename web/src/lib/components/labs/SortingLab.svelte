<script lang="ts">
  // The sorting matrix: 7 algorithms (rows) x 4 datasets (columns), all driven
  // by ONE engine. The rule keeps a lane per cell and applies one op per
  // running lane per tick, so the race is fair; this page is the controller
  // (per-lane/row/column/global actions) and the geometry source — the CSS
  // grid below is overlaid on the canvas and its cell rects are pushed to the
  // viz, which draws the bars underneath.
  import { onDestroy, untrack } from 'svelte';
  import LabShell from '../LabShell.svelte';
  import type { LabApi } from '../labApi.svelte';
  import { cmd } from '../../playback/commands';
  import { cellRects } from '../../sorting/layout';
  import { readSummary, laneIndex, ALGORITHMS, DATASETS, type SortingSummary } from '../../sorting/summary';
  import { allLanes, rowLanes, colLanes, laneState, shouldRun, LANE_GLYPH } from '../../sorting/lanes';
  import { SortingAudio } from '../../sorting/audio';
  import { route, replaceQuery } from '../../router.svelte';
  import { buildQuery } from '../../router';

  const DEFAULT_SIZE = 50, MIN_SIZE = 10, MAX_SIZE = 300, DEFAULT_SPEED = 60, MAX_SPEED = 1000;
  const rows = ALGORITHMS.length;
  const cols = DATASETS.length;
  const ALL_LANES = allLanes(rows, cols);
  const clamp = (n: number) => Math.min(Math.max(Math.floor(n), MIN_SIZE), MAX_SIZE);

  /**
   * Read the shareable-link param from a hash query: `n=…` (array size).
   * Returns the raw parsed value, unclamped, so a caller can tell an
   * out-of-range link apart from an already-canonical one.
   */
  function paramsOf(query: string) {
    const n = Math.floor(Number(new URLSearchParams(query).get('n')));
    return { size: Number.isFinite(n) && n > 0 ? n : undefined };
  }

  let size = $state(clamp(paramsOf(route.query).size ?? DEFAULT_SIZE));
  let speed = $state(DEFAULT_SPEED);
  /** Sonification: one voice per lane, off until the speaker button is clicked. */
  const audio = new SortingAudio();
  let muted = $state(audio.muted);
  let volume = $state(audio.volume);
  /** The engine's lane grid, re-read every frame (null until the engine is up). */
  let summary = $state<SortingSummary | null>(null);
  /** Query we last wrote (or consumed), so our own replaceQuery() doesn't re-trigger a push. */
  let appliedQuery = route.query;

  // $state so the summary effect below re-runs once the shell hands us the api.
  let api = $state<LabApi | null>(null);
  let cellEls = $state<HTMLButtonElement[]>([]);
  let overlayEl: HTMLDivElement | null = null;
  let ro: ResizeObserver | null = null;

  /** Keep the URL a shareable link to the current size (the default is omitted). */
  function syncUrl() {
    const q = buildQuery({ n: size === DEFAULT_SIZE ? undefined : String(size) });
    appliedQuery = q;
    replaceQuery(q);
  }

  // A pasted link / back-forward while on this page: adopt its size and re-seed.
  $effect(() => {
    const q = route.query;
    untrack(() => {
      if (q === appliedQuery) return;
      appliedQuery = q;
      const next = paramsOf(q).size ?? DEFAULT_SIZE;
      if (next !== size) applySize(next);
    });
  });

  // The shell replaces `snapshot` every frame; re-read the lane grid off that
  // clock and voice whatever moved.
  $effect(() => {
    const a = api;
    if (!a) return;
    void a.snapshot;
    // Hand the audio the raw value, not the `summary` state: reading state
    // this effect just wrote would make it re-run on its own write.
    const next = readSummary(a.readSummary());
    summary = next;
    audio.update(next);
  });

  /** Measure the cell buttons and hand the viz their device-pixel rects. */
  function pushCells() {
    const canvas = overlayEl?.closest('.canvas-wrap')?.querySelector('canvas');
    if (!api?.engine || !canvas) return;
    // The cell buttons are bound via `bind:this={cellEls[i]}` as the grid
    // renders; a resize/observer callback firing mid-render (or before the
    // first paint) can see a short or sparse array. Skip that frame rather
    // than measuring a bogus rect.
    if (cellEls.length !== rows * cols || cellEls.some((e) => !e)) return;
    api.patchVizConfig({
      cells: cellRects(
        cellEls.map((e) => e.getBoundingClientRect()),
        canvas.getBoundingClientRect(),
        window.devicePixelRatio || 1,
      ),
    });
  }

  function observeResize() {
    // jsdom has no ResizeObserver; the window listener is the fallback there
    // (and catches DPR changes when a window moves between displays).
    if (typeof ResizeObserver !== 'undefined' && overlayEl) {
      ro = new ResizeObserver(() => pushCells());
      ro.observe(overlayEl);
    }
    window.addEventListener('resize', pushCells);
  }

  function onReady(a: LabApi) {
    api = a;
    a.dispatch(cmd.setSpeed(speed));
    // A link with ?n= needs the rule config before the first frame; the push
    // leaves playback paused at 0, so Play always follows.
    if (size !== DEFAULT_SIZE) a.patchRuleConfig({ size });
    a.dispatch(cmd.play());
    // An out-of-range ?n= (e.g. ?n=5) was clamped into `size` above; rewrite
    // the link to the canonical value so a shared/reloaded link matches what
    // actually loaded.
    const linked = paramsOf(route.query).size;
    if (linked !== undefined && linked !== size) syncUrl();
    pushCells();
    observeResize();
  }

  onDestroy(() => {
    ro?.disconnect();
    ro = null;
    window.removeEventListener('resize', pushCells);
    audio.destroy();
  });

  const laneAt = (i: number) => summary?.lanes[i];
  const stateOf = (i: number) => laneState(laneAt(i));

  function toggleLane(i: number) {
    api?.ruleAction({ kind: 'toggle', lane: i });
  }

  /** Header ▶: run the group unless every lane in it is already running (then pause it). */
  function runGroup(lanes: number[]) {
    api?.ruleAction({ kind: 'set_running', lanes, running: shouldRun(summary, lanes) });
  }

  /** Toolbar "Run all": always starts every lane, never toggles to pause. */
  function runAll() {
    api?.ruleAction({ kind: 'set_running', lanes: ALL_LANES, running: true });
  }

  function pauseAll() {
    api?.ruleAction({ kind: 'set_running', lanes: ALL_LANES, running: false });
  }

  function resetAll() {
    api?.ruleAction({ kind: 'reset_all' });
  }

  /** SetSeed re-inits every lane's array and pauses the clock; restart it. */
  function newData() {
    api?.dispatch(cmd.setSeed(Math.floor(Math.random() * 2 ** 31)));
    api?.dispatch(cmd.play());
  }

  /** A rule-config push also resets playback to paused/0 — Play follows it too. */
  function applySize(n: number) {
    size = clamp(n);
    api?.patchRuleConfig({ size });
    api?.dispatch(cmd.play());
    syncUrl();
  }

  function onSize(e: Event) {
    const n = Number((e.target as HTMLInputElement).value);
    if (!Number.isFinite(n) || n <= 0) return;
    const next = clamp(n);
    (e.target as HTMLInputElement).value = String(next);
    if (next !== size) applySize(next);
  }

  function onSpeed(e: Event) {
    speed = Number((e.target as HTMLInputElement).value);
    api?.dispatch(cmd.setSpeed(speed));
  }

  /** The click is the user gesture that lets the browser start audio. */
  function toggleMute() {
    audio.setMuted(!muted);
    muted = audio.muted;
  }

  function onVolume(e: Event) {
    audio.setVolume(Number((e.target as HTMLInputElement).value));
    volume = audio.volume;
  }
</script>

<LabShell labId="sorting" playback={false} zoom={false} {onReady}>
  {#snippet overlay()}
    <div
      class="grid"
      bind:this={overlayEl}
      style="grid-template-columns: var(--rowhdr, auto) repeat({cols}, minmax(0, 1fr)); grid-template-rows: auto repeat({rows}, minmax(0, 1fr))"
    >
      <div></div><!-- empty top-left corner -->
      {#each DATASETS as ds, c (ds.id)}
        <button class="hdr col" onclick={() => runGroup(colLanes(c, rows, cols))} title="Run column: {ds.label}">{ds.label} ▶</button>
      {/each}
      {#each ALGORITHMS as alg, r (alg.id)}
        <button class="hdr row" onclick={() => runGroup(rowLanes(r, cols))} title="Run row: {alg.label}">{alg.label} <small>{alg.complexity}</small> ▶</button>
        {#each DATASETS as ds, c (ds.id)}
          {@const i = laneIndex(r, c, cols)}
          <button
            class="cell"
            class:running={stateOf(i) === 'running'}
            class:done={stateOf(i) === 'done'}
            bind:this={cellEls[i]}
            onclick={() => toggleLane(i)}
            aria-label="{alg.label} on {ds.label}: {stateOf(i)}"
          >
            <span class="glyph">{LANE_GLYPH[stateOf(i)]}</span>
            <span class="badge">{laneAt(i)?.compares ?? 0} cmp · {laneAt(i)?.writes ?? 0} wr</span>
          </button>
        {/each}
      {/each}
    </div>
  {/snippet}

  {#snippet controls()}
    <button onclick={runAll} title="Start every lane">Run all</button>
    <button onclick={pauseAll} title="Pause every lane">Pause all</button>
    <button onclick={resetAll} title="Send every lane back to its unsorted array">Reset</button>
    <button onclick={newData} title="Reshuffle every dataset">New data</button>
    <label class="size">
      Size
      <input type="number" min={MIN_SIZE} max={MAX_SIZE} step="1" value={size} onchange={onSize} aria-label="Array size" />
    </label>
    <label class="speed">
      Speed
      <input type="range" min="1" max={MAX_SPEED} step="1" value={speed} oninput={onSpeed} aria-label="Speed" />
      <span class="value">{speed} ops/s</span>
    </label>
    <div class="sound">
      <button
        class="mute"
        onclick={toggleMute}
        aria-pressed={!muted}
        aria-label="Sound"
        title={muted ? 'Turn sound on' : 'Turn sound off'}
      >{muted ? '🔇' : '🔊'}</button>
      <input type="range" min="0" max="1" step="0.01" value={volume} oninput={onVolume} disabled={muted} aria-label="Volume" />
    </div>
  {/snippet}

  {#snippet info()}
    <h2>Sorting Algorithms</h2>
    <p>
      Twenty-eight sorters race at once: every row is an algorithm, every column the array it starts from. All of them share
      <strong>one clock</strong> — each tick, every running panel performs exactly one <em>compare</em> or one <em>write</em>,
      so the bars you watch are a live count of the work each algorithm actually does.
    </p>
    <h3>What you're seeing</h3>
    <ul>
      <li><span class="swatch bar"></span> Bars — one per array slot, height ∝ value</li>
      <li><span class="swatch compare"></span> The two slots being compared</li>
      <li><span class="swatch write"></span> The slot just written</li>
      <li><span class="swatch sorted"></span> A finished lane</li>
    </ul>
    <h3>The four datasets</h3>
    <p>
      <em>Random</em> is the textbook case. <em>Nearly sorted</em> flatters insertion sort (and bubble sort's early exit): a
      handful of elements are out of place, so the inner loops barely run. <em>Reversed</em> is bubble and insertion sort's
      worst case — every pair is out of order — while selection sort plods along at the same cost as ever. <em>Few unique</em>
      is a handful of repeated values, which piles equal keys against the pivot and is where a naive quicksort partition
      shows its seams.
    </p>
    <h3>The algorithms</h3>
    <ul class="algos">
      <li><em>Bubble sort</em> — swap neighbours until a pass makes none. O(n²).</li>
      <li><em>Insertion sort</em> — grow a sorted prefix, sliding each new value back into place. O(n²), superb on nearly sorted input.</li>
      <li><em>Selection sort</em> — find the smallest remaining value, put it next. O(n²) compares whatever the input.</li>
      <li><em>Shell sort</em> — insertion sort on a shrinking gap sequence. ~O(n^1.3).</li>
      <li><em>Merge sort</em> — split, sort halves, merge. O(n log n), unfazed by the input.</li>
      <li><em>Quick sort</em> — middle pivot, Hoare partition, recurse. O(n log n) typical.</li>
      <li><em>Heap sort</em> — build a heap, then pop the max n times. O(n log n).</li>
    </ul>
    <p class="tip">
      <em>Click a panel</em> to start it, pause it, or (once finished) run it
      again. The <em>▶</em> on a row or column header runs that whole group,
      and <em>Run all</em> starts the full race.
    </p>
    <p class="tip">
      <em>New data</em> reseeds every column — all seven algorithms in a
      column always face the same array, which is what makes the race fair.
      <em>Size</em> changes the array length (10–300) and is shareable: it
      lands in the link as <em>?n=</em>.
    </p>
    <p class="tip">
      <em>🔊</em> turns on sound: every running panel hums the value it just
      touched — low for small, high for large, brighter on a write than on a
      compare — and rings a chime when it finishes. The slider sets the volume.
    </p>
  {/snippet}
</LabShell>

<style>
  /* The grid sits on top of the canvas: it only catches clicks on the header
     and cell buttons, and the cells themselves are transparent — the bars are
     drawn by GL in exactly these rectangles. */
  .grid {
    display: grid;
    width: 100%;
    height: 100%;
    gap: 2px;
    padding: 0.5rem;
    pointer-events: none;
  }
  .grid :global(button) { pointer-events: auto; }
  .hdr {
    background: rgba(28, 28, 31, 0.72);
    backdrop-filter: blur(2px);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 0.75rem;
    padding: 0.25rem 0.45rem;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .hdr:hover { color: var(--text-strong); background: rgba(42, 42, 47, 0.85); }
  .hdr.row { text-align: left; }
  .hdr small { color: #7f7f8a; margin-left: 0.3rem; font-size: 0.68rem; }
  .cell {
    position: relative;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 0;
    cursor: pointer;
    min-height: 0;
    min-width: 0;
  }
  .cell:hover { border-color: #4a4a55; }
  .cell.running { background: rgba(250, 153, 89, 0.07); }
  .cell.done { background: rgba(166, 217, 242, 0.07); }
  .glyph { position: absolute; top: 2px; right: 4px; font-size: 0.7rem; line-height: 1; color: #8f8f9a; }
  .cell.done .glyph { color: #a6d9f2; }
  .badge {
    position: absolute;
    bottom: 2px;
    left: 4px;
    font-size: 0.62rem;
    line-height: 1;
    color: #7f7f8a;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  /* Toolbar bits, rendered into LabShell's .playback-bar via `controls`. */
  .size input {
    background: #2a2a2f;
    color: #eee;
    border: 1px solid #3a3a40;
    border-radius: 4px;
    padding: 0.25rem 0.4rem;
    width: 5rem;
    font-variant-numeric: tabular-nums;
  }
  .size, .speed, .sound { display: flex; align-items: center; gap: 0.5rem; color: #bbb; }
  .speed { margin-left: auto; }
  .speed .value { font-variant-numeric: tabular-nums; width: 5rem; text-align: right; }
  .sound input { width: 6rem; }
  .sound input:disabled { opacity: 0.4; }
  .mute[aria-pressed="true"] { border-color: #6f8fc9; }

  /* Legend swatches — the shell supplies the base dot; `span` outranks it. */
  span.swatch.bar { background: #8c99bf; }
  span.swatch.compare { background: #fad94d; }
  span.swatch.write { background: #fa9959; }
  span.swatch.sorted { background: #a6d9f2; }

  @media (max-width: 768px) {
    .grid { gap: 1px; padding: 0.25rem; --rowhdr: 5.5rem; }
    .hdr { font-size: 0.7rem; padding: 0.2rem 0.3rem; }
    .hdr.row { font-size: 0.62rem; }
    .hdr small, .badge { display: none; }
    .speed { margin-left: 0; }
    .sound input { width: 5rem; }
  }
</style>
