<script lang="ts">
  // The guided tour of the JPEG lab: a dialog that walks nine steps from pixels to a file, with
  // the reader's own picture. It never blocks the lab behind it. It owns every key typed inside
  // it (the lab's window handler must not see them), traps Tab, and hands the picture and
  // quality back only through "Show me in the lab" and "Start exploring".
  import { onMount, untrack } from 'svelte';
  import { GROUP_LABELS, IMAGES, decodeUpload, loadPicture, type PictureGroup, type RgbaImage } from '../../jpeg/images';
  import type { HuffmanId, ImageId, SubsamplingId } from '../../jpeg/params';
  import { TOUR_STEPS, type TourHandoff } from '../../jpeg/tour';
  import { loadVizCore, type VizCore } from '../../wasm/loader';
  import TourVisual from './TourVisual.svelte';
  import { tooltip, type TooltipController } from './tooltip.svelte';

  interface Props {
    /** The lab's picture: a gallery id, or 'upload'. */
    imageId: ImageId | 'upload';
    /** The lab's picture pixels, or null while they load. Used until the reader picks another inside the tour. */
    image: RgbaImage | null;
    /** The lab's quality: where the slider starts. */
    quality: number;
    /** The lab's colour sharing. */
    subsampling: SubsamplingId;
    /** The lab's Huffman setting. */
    huffman: HuffmanId;
    /** The lab's card controller, so the tour's cards show above the dialog. */
    ctl: TooltipController;
    /** Called once when the tour ends: with what to carry into the lab, or null to change nothing. */
    onclose: (handoff: TourHandoff | null) => void;
  }

  let { imageId, image, quality, subsampling, huffman, ctl, onclose }: Props = $props();

  const GROUPS = Object.keys(GROUP_LABELS) as PictureGroup[];
  const LAST = TOUR_STEPS.length - 1;

  let index = $state(0);
  const step = $derived(TOUR_STEPS[index]);

  /** The slider's value; the tour's own, so dragging it never moves the lab's quality. */
  let q = $state(untrack(() => quality));

  /** The picture chosen inside the tour, when it differs from the lab's. */
  let picked = $state.raw<{ id: ImageId | 'upload'; image: RgbaImage } | null>(null);
  const shownId = $derived(picked?.id ?? imageId);
  const shownImage = $derived(picked?.image ?? image);
  /** Why the last picture could not be loaded. */
  let pictureError = $state('');
  /** True while a picture is being fetched or decoded: the hand-offs would carry the old one. */
  let loading = $state(false);
  /** True when the encoder kit could not be loaded. */
  let kitFailed = $state(false);
  /** The hand-off buttons wait for a picture, and for a pending pick to land. */
  const handoffBlocked = $derived(!shownImage || loading);
  /** Each load takes a ticket; only the latest is applied. */
  let ticket = 0;

  let viz = $state.raw<VizCore | null>(null);
  let dialogEl: HTMLElement | null = null;
  let nextBtn: HTMLButtonElement | null = null;
  let pictureSelect: HTMLSelectElement | null = null;
  let fileInput: HTMLInputElement | null = null;

  onMount(() => {
    let alive = true;
    loadVizCore().then(
      (core) => {
        if (alive) viz = core;
      },
      () => {
        if (alive) kitFailed = true;
      },
    );
    nextBtn?.focus();
    return () => {
      alive = false;
      ticket++;
    };
  });

  const go = (to: number) => {
    index = Math.min(LAST, Math.max(0, to));
  };

  function handoff(stage: TourHandoff['stage']) {
    const img = shownImage;
    if (!img || loading) return;
    onclose({ stage, imageId: shownId, image: img, quality: q });
  }

  function onNext() {
    if (index < LAST) go(index + 1);
    else handoff('overview');
  }

  async function load(get: () => Promise<RgbaImage>, id: ImageId | 'upload') {
    const mine = ++ticket;
    loading = true;
    try {
      const img = await get();
      if (mine !== ticket) return;
      picked = { id, image: img };
      pictureError = '';
      loading = false;
    } catch (err) {
      if (mine !== ticket) return;
      loading = false;
      pictureError = err instanceof Error ? err.message : 'That picture could not be loaded.';
      // The select shows what the reader chose; put it back on the picture in use.
      if (pictureSelect) pictureSelect.value = shownId;
    }
  }

  function onPicture(e: Event) {
    const id = (e.currentTarget as HTMLSelectElement).value;
    if (id === shownId || id === 'upload') {
      // Back to the picture in use: whatever was still loading is no longer wanted.
      ticket++;
      loading = false;
      pictureError = '';
      return;
    }
    void load(() => loadPicture(id as ImageId), id as ImageId);
  }

  function onUpload(file: File | null | undefined) {
    if (!file) return;
    void load(() => decodeUpload(file), 'upload');
  }

  // When the focused control goes away (Back on step 1, Next on the last step while a picture loads),
  // focus moves to a stable control in the dialog, so keys keep reaching the dialog's own listener.
  $effect(() => {
    void index;
    void handoffBlocked;
    const root = dialogEl;
    if (!root) return;
    const at = document.activeElement as HTMLElement | null;
    const lost =
      !at ||
      !root.contains(at) ||
      (at as HTMLButtonElement).disabled === true ||
      (at.closest('[aria-hidden="true"]') !== null && at !== root);
    if (lost) (nextBtn && !nextBtn.disabled ? nextBtn : root).focus();
  });

  /** The dialog's controls in tab order. */
  function focusables(): HTMLElement[] {
    if (!dialogEl) return [];
    return Array.from(
      dialogEl.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled]), input:not([disabled]):not([type="file"])'),
    );
  }

  /** Keys typed in the dialog belong to the dialog: none reaches the lab's window handler. */
  function keys(node: HTMLElement) {
    const stop = (e: Event) => e.stopPropagation();
    const onKeyDown = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        onclose(null);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const tag = (e.target as Element | null)?.tagName;
        if (tag === 'INPUT' || tag === 'SELECT') return;
        e.preventDefault();
        go(index + (e.key === 'ArrowRight' ? 1 : -1));
      } else if (e.key === 'Tab') {
        const list = focusables();
        if (list.length === 0) return;
        const first = list[0];
        const last = list[list.length - 1];
        const at = document.activeElement;
        if (e.shiftKey && (at === first || !list.includes(at as HTMLElement))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (at === last || !list.includes(at as HTMLElement))) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    node.addEventListener('keydown', onKeyDown);
    node.addEventListener('keyup', stop);
    node.addEventListener('keypress', stop);
    return {
      destroy() {
        node.removeEventListener('keydown', onKeyDown);
        node.removeEventListener('keyup', stop);
        node.removeEventListener('keypress', stop);
      },
    };
  }

  // A clicked backdrop keeps focus where it was, so keys still land in the dialog.
  function keepFocus(e: PointerEvent) {
    if (e.target === e.currentTarget) e.preventDefault();
  }

  /** Where a touch began, for the swipe. */
  let swipe: { x: number; y: number } | null = null;
  const SWIPE_MIN = 40;

  function swipeStart(e: PointerEvent) {
    swipe = null;
    if (e.pointerType === 'mouse') return;
    // A finger dragging the slider is not a swipe.
    if ((e.target as Element | null)?.closest('input, select')) return;
    swipe = { x: e.clientX, y: e.clientY };
  }

  function swipeEnd(e: PointerEvent) {
    const from = swipe;
    swipe = null;
    if (!from || e.pointerType === 'mouse') return;
    const dx = e.clientX - from.x;
    const dy = e.clientY - from.y;
    if (Math.abs(dx) > SWIPE_MIN && Math.abs(dx) > Math.abs(dy)) go(index + (dx < 0 ? 1 : -1));
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="tour-backdrop" onpointerdown={keepFocus}>
  <div
    class="tour-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="tour-title"
    tabindex="-1"
    bind:this={dialogEl}
    use:keys
  >
    <header class="head">
      <div>
        <h2 id="tour-title">How a picture becomes a JPEG</h2>
        <p class="lede">JPEG throws away what your eye won't miss, then packs what's left tightly.</p>
      </div>
      <button class="close" type="button" aria-label="Close the tour" onclick={() => onclose(null)}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
        </svg>
      </button>
    </header>

    <div class="pick" aria-busy={loading ? 'true' : 'false'}>
      <select
        aria-label="Tour picture"
        value={shownId}
        onchange={onPicture}
        bind:this={pictureSelect}
        aria-busy={loading ? 'true' : 'false'}
      >
        {#each GROUPS as group (group)}
          <optgroup label={GROUP_LABELS[group]}>
            {#each IMAGES.filter((im) => im.group === group) as im (im.id)}
              <option value={im.id}>{im.label}</option>
            {/each}
          </optgroup>
        {/each}
        {#if shownId === 'upload'}<option value="upload">Your picture</option>{/if}
      </select>
      <button class="text-btn" type="button" onclick={() => fileInput?.click()}>Use your own picture</button>
      <input
        class="file"
        type="file"
        accept="image/*"
        tabindex="-1"
        aria-hidden="true"
        bind:this={fileInput}
        onchange={(e) => {
          const input = e.currentTarget as HTMLInputElement;
          onUpload(input.files?.[0]);
          input.value = '';
        }}
      />
      {#if loading}<span class="pic-loading" role="status">Loading the picture</span>{/if}
      {#if pictureError}<p class="pic-error" role="alert">{pictureError}</p>{/if}
    </div>
    {#if kitFailed}
      <p class="kit-note" role="status">The pictures couldn't load, but the steps still read fine.</p>
    {/if}

    <ol class="tour-strip">
      {#each TOUR_STEPS as s, i (s.id)}
        <li>
          <button
            type="button"
            class:lossy={s.lossy}
            class:current={i === index}
            aria-label={`Step ${s.n}: ${s.heading}`}
            aria-current={i === index ? 'step' : undefined}
            onclick={() => go(i)}
            use:tooltip={{ ctl, target: { id: 'tour.step', step: s.id }, acts: true }}
          >
            <span class="num" aria-hidden="true">{s.n}</span>
            <span class="txt" aria-hidden="true">{s.heading}</span>
          </button>
        </li>
      {/each}
      <li class="jpg">file</li>
    </ol>

    <section class="tour-panel" onpointerdown={swipeStart} onpointerup={swipeEnd} onpointercancel={() => (swipe = null)}>
      <p class="tour-label">Step {step.n} of {TOUR_STEPS.length}{#if step.lossy}<span class="loses">{" · loses detail"}</span>{/if}</p>
      <h3>{step.heading}</h3>
      <p class="line">{step.line}</p>
      <div class="visual">
        <TourVisual step={step.id} image={shownImage} quality={q} {subsampling} {huffman} {viz} />
      </div>
      {#if step.id === 'round'}
        <label class="quality">
          Quality
          <input
            type="range"
            min="1"
            max="100"
            step="1"
            value={q}
            aria-label="Quality"
            oninput={(e) => (q = Math.min(100, Math.max(1, Math.round(Number((e.currentTarget as HTMLInputElement).value) || 1))))}
            use:tooltip={{ ctl, target: { id: 'tour.quality', quality: q }, acts: true }}
          />
          <span class="tour-quality-value">{q}</span>
        </label>
      {/if}
      <div class="progress" aria-hidden="true">
        {#each TOUR_STEPS as s, i (s.id)}<span class:done={i <= index}></span>{/each}
      </div>
    </section>

    <footer class="actions">
      <button class="text-btn" type="button" onclick={() => onclose(null)}>Skip the tour</button>
      <span class="spacer"></span>
      <!-- Always in the layout, so the buttons do not jump; hidden and out of the tab order on step 1. -->
      <button
        class="btn"
        type="button"
        disabled={index === 0}
        aria-hidden={index === 0 ? 'true' : undefined}
        style:visibility={index === 0 ? 'hidden' : undefined}
        onclick={() => go(index - 1)}>Back</button
      >
      <button class="btn" type="button" disabled={handoffBlocked} onclick={() => handoff(step.stage)}>Show me in the lab</button>
      <button class="btn primary" type="button" bind:this={nextBtn} disabled={index === LAST && handoffBlocked} onclick={onNext}>
        {index === LAST ? 'Start exploring' : 'Next'}
      </button>
    </footer>
  </div>
</div>

<style>
  .tour-backdrop {
    position: fixed;
    inset: 0;
    z-index: 900;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 12px;
    background: rgba(8, 10, 14, 0.66);
  }
  .tour-dialog {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 14px;
    width: min(760px, 100%);
    max-height: 100%;
    overflow-x: hidden;
    overflow-y: auto;
    padding: 20px 22px;
    border: 1px solid var(--line);
    border-radius: var(--radius-panel);
    background: var(--card);
    color: var(--ink);
    box-shadow: var(--shadow-lift);
  }
  .tour-dialog:focus { outline: none; }
  .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  h2 { margin: 0; font-size: 20px; font-weight: 600; }
  .lede { margin: 4px 0 0; color: var(--stone); font-size: 14px; }
  .close {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: 1px solid var(--line);
    border-radius: var(--radius-button);
    background: transparent;
    color: var(--stone);
    cursor: pointer;
  }
  .close:hover { color: var(--ink); border-color: var(--stone); }

  .pick { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
  .pick select {
    height: 34px;
    max-width: 100%;
    padding: 0 10px;
    border: 1px solid var(--line);
    border-radius: var(--radius-button);
    background: var(--paper);
    color: var(--ink);
    font-size: 14px;
  }
  .file { display: none; }
  .pic-loading { color: var(--stone); font-size: 13px; }
  .kit-note { margin: 0; color: var(--stone); font-size: 13px; }
  .pic-error { flex-basis: 100%; margin: 0; color: var(--accent-deep); font-size: 13px; }

  /* The strip: nine steps, then the file. Arrows between the boxes are drawn with borders. */
  .tour-strip { display: flex; align-items: stretch; gap: 14px; margin: 0; padding: 0; list-style: none; }
  .tour-strip li { position: relative; display: flex; flex: 1 1 0; min-width: 0; }
  .tour-strip li:not(:last-child)::after {
    content: '';
    position: absolute;
    top: 50%;
    right: -11px;
    width: 0;
    height: 0;
    margin-top: -4px;
    border-top: 4px solid transparent;
    border-bottom: 4px solid transparent;
    border-left: 6px solid var(--line);
    pointer-events: none;
  }
  .tour-strip button {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    width: 100%;
    min-width: 0;
    padding: 6px 3px;
    border: 1px solid var(--line);
    border-radius: var(--radius-button);
    background: var(--paper);
    color: var(--stone);
    font: inherit;
    font-size: 11px;
    line-height: 1.2;
    text-align: center;
    cursor: pointer;
  }
  .tour-strip button:hover { border-color: var(--stone); color: var(--ink); }
  .tour-strip button.current { outline: 2px solid var(--accent); outline-offset: 1px; color: var(--ink); background: var(--tint); }
  .tour-strip button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .tour-strip button.lossy { border-bottom: 3px solid var(--accent); }
  .num { font-family: var(--font-mono); font-size: 13px; color: var(--ink); }
  .txt { overflow-wrap: anywhere; hyphens: auto; }
  .tour-strip .jpg {
    flex: 0 0 auto;
    align-items: center;
    padding: 0 10px;
    border: 1px dashed var(--line);
    border-radius: var(--radius-button);
    color: var(--stone);
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .tour-strip .jpg::before { content: '.jpg'; margin-right: 4px; color: var(--ink); }

  .tour-panel { display: flex; flex-direction: column; gap: 8px; min-width: 0; touch-action: pan-y; }
  .tour-label { margin: 0; color: var(--stone); font-size: 13px; }
  .loses { color: var(--accent); font-weight: 600; }
  h3 { margin: 0; font-size: 18px; font-weight: 600; }
  .line { margin: 0; font-size: 15px; line-height: 1.45; }
  .visual { min-width: 0; margin-top: 4px; }
  .quality { display: flex; align-items: center; gap: 10px; font-size: 14px; color: var(--stone); }
  .quality input { flex: 1 1 auto; min-width: 0; max-width: 320px; }
  .tour-quality-value { width: 3ch; font-family: var(--font-mono); text-align: right; color: var(--ink); }
  .progress { display: flex; gap: 4px; margin-top: 4px; }
  .progress span { flex: 1 1 0; height: 4px; border-radius: 2px; background: var(--line); }
  .progress span.done { background: var(--accent); }

  .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .spacer { flex: 1 1 auto; }
  .btn, .text-btn {
    height: 36px;
    padding: 0 14px;
    border-radius: var(--radius-button);
    font: inherit;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
  }
  .btn { border: 1px solid var(--line); background: var(--paper); color: var(--ink); }
  .btn:hover:not(:disabled) { border-color: var(--stone); }
  .btn.primary { border-color: var(--accent); background: var(--accent); color: var(--paper); }
  .btn.primary:hover:not(:disabled) { background: var(--accent-deep); border-color: var(--accent-deep); }
  .btn:disabled { opacity: 0.5; cursor: default; }
  .text-btn { border: 0; background: transparent; color: var(--stone); padding: 0 6px; text-decoration: underline; }
  .text-btn:hover { color: var(--ink); }
  button:focus-visible, select:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  /* Narrow dialogs: the strip is a row of dots, so the headings never break mid-word. */
  @media (max-width: 759.98px) {
    .tour-strip { gap: 10px; justify-content: center; }
    .tour-strip li { flex: 0 0 auto; }
    .tour-strip li:not(:last-child)::after { display: none; }
    .tour-strip button { position: relative; width: 14px; height: 14px; padding: 0; border-radius: 50%; }
    /* The look stays 14 px; the touch target grows to 24 px. */
    .tour-strip button::before { content: ''; position: absolute; inset: -5px; }
    .tour-strip button.lossy { border-bottom-width: 1px; border-color: var(--accent); }
    .tour-strip button.current { background: var(--accent); outline-offset: 2px; }
    .tour-strip .jpg { display: none; }
    .num, .txt { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  }

  /* Phones: the picture sits above the words, nothing scrolls sideways. */
  @media (max-width: 599.98px) {
    .tour-dialog { padding: 16px 14px; gap: 12px; }
    .tour-panel { gap: 8px; }
    .visual { order: -1; }
    .actions .spacer { flex-basis: 100%; height: 0; }
    .actions { justify-content: flex-end; }
  }
</style>
