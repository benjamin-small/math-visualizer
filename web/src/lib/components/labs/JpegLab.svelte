<script lang="ts">
  // The JPEG lab: one image followed through the compression pipeline, one
  // stage at a time. The engine encodes the image (Rust `jpeg` crate) and its
  // clock walks the scan MCU by MCU; this page owns the settings, the stage
  // rail and the layout. Settings re-encode through a rule-config push (which
  // rewinds the engine), after which the page puts the scan back where it was.
  // The selected block is view state and moves through a rule action.
  import { onDestroy, untrack } from 'svelte';
  import LabShell from '../LabShell.svelte';
  import Icon from '../Icon.svelte';
  import Tex from '../Tex.svelte';
  import StageRail from '../jpeg/StageRail.svelte';
  import CellNumbers from '../jpeg/CellNumbers.svelte';
  import DctCharts from '../jpeg/DctCharts.svelte';
  import type { LabApi } from '../labApi.svelte';
  import { cmd } from '../../playback/commands';
  import { route, replaceQuery } from '../../router.svelte';
  import { STAGES, stepStage, type StageId } from '../../jpeg/stages';
  import {
    buildParams,
    clampQuality,
    mcuCount,
    parseParams,
    type HuffmanId,
    type ImageId,
    type SubsamplingId,
  } from '../../jpeg/params';
  import { IMAGES, decodeUpload, loadBuiltin, type RgbaImage } from '../../jpeg/images';
  import { blockAt, cellAt, jpegLayout, toDevicePanels, type Panel, type StageLayout } from '../../jpeg/layout';
  import { readSummary, readoutOf, type JpegSummary } from '../../jpeg/summary';
  import { NOTICE, stageTex } from '../../jpeg/formulas';

  /** MCUs scanned per second by default: the 256² gradient (256 MCUs) scans in four seconds. */
  const DEFAULT_SPEED = 64;

  const linked = parseParams(route.query);
  let imageId = $state<ImageId | 'upload'>(linked.img);
  let quality = $state(linked.quality);
  let subsampling = $state<SubsamplingId>(linked.subsampling);
  let huffman = $state<HuffmanId>(linked.huffman);
  let stage = $state<StageId>(linked.stage);
  /** The block every stage follows, in luma block coordinates, and which plane to show it from. */
  let anchor = $state<[number, number] | null>(linked.block ?? null);
  let component = $state(0);
  /** Stage controls. */
  let cubeMix = $state(0);
  let dctK = $state(64);
  let hover = $state<[number, number] | null>(null);
  let showShifted = $state(true);

  let image = $state<RgbaImage | null>(null);
  /** Why the last picture could not be loaded (the current image stays). */
  let loadError = $state<string | null>(null);
  let summary = $state<JpegSummary | null>(null);
  let layout = $state<StageLayout>({ image: { x: 0, y: 0, w: 0, h: 0 }, panels: [], extra: { x: 0, y: 0, w: 0, h: 0 } });
  let api = $state<LabApi | null>(null);
  let appliedQuery = route.query;
  let overlayEl: HTMLDivElement | null = null;
  let fileInput: HTMLInputElement | null = null;
  let imageGroup: HTMLDivElement | null = null;
  let ro: ResizeObserver | null = null;
  /** True until the first encode has started playing. */
  let first = true;
  /** Each picture load takes a ticket; only the latest one is applied when it arrives. */
  let loadTicket = 0;
  /** The animation frame a quality drag has scheduled its encode on (0 = none). */
  let qualityFrame = 0;

  const stageInfo = $derived(STAGES.find((s) => s.id === stage)!);
  const readout = $derived(summary ? readoutOf(summary) : null);
  const panel = (kind: Panel['kind']) => layout.panels.find((p) => p.kind === kind)?.rect;

  function currentQuery(): string {
    return buildParams({
      img: imageId === 'upload' ? 'gradient' : imageId,
      quality,
      subsampling,
      huffman,
      stage,
      block: anchor ?? undefined,
    });
  }

  function syncUrl() {
    const q = currentQuery();
    appliedQuery = q;
    replaceQuery(q);
  }

  // A pasted link or back/forward while on this page.
  $effect(() => {
    const q = route.query;
    untrack(() => {
      if (q === appliedQuery) return;
      appliedQuery = q;
      const p = parseParams(q);
      stage = p.stage;
      anchor = p.block ?? null;
      if (!p.block) component = 0;
      const encodeChanged = p.quality !== quality || p.subsampling !== subsampling || p.huffman !== huffman;
      quality = p.quality;
      subsampling = p.subsampling;
      huffman = p.huffman;
      if (p.img !== imageId) void chooseImage(p.img, p.block);
      else if (encodeChanged) encode();
      else {
        selectAnchor();
        if (currentQuery() !== q) syncUrl(); // the block was off the grid and has been clamped
      }
      pushLayout();
    });
  });

  // The shell replaces `snapshot` every frame; the summary only moves with the scan cursor.
  const iteration = $derived(api?.snapshot.iteration ?? 0);
  $effect(() => {
    void iteration;
    const a = api;
    if (!a) return;
    summary = readSummary(a.readSummary());
  });

  /** `b` limited to the current image's luma block grid (the engine refuses blocks outside it). */
  function clampBlock(b: [number, number]): [number, number] {
    if (!image) return b;
    const cols = Math.ceil(image.w / 8);
    const rows = Math.ceil(image.h / 8);
    return [Math.min(cols - 1, Math.max(0, b[0])), Math.min(rows - 1, Math.max(0, b[1]))];
  }

  /**
   * Send the selection to the engine (the anchor scaled into the chosen
   * plane's block grid). An anchor off the grid is pulled onto it first, so
   * the engine, the zoom window and the link all name the same block.
   */
  function selectAnchor() {
    if (!api || !anchor) return;
    anchor = clampBlock(anchor);
    const [fh, fv] = component === 0 ? [1, 1] : subsampling === '444' ? [1, 1] : subsampling === '422' ? [2, 1] : [2, 2];
    api.ruleAction({ kind: 'select_block', component, bx: Math.floor(anchor[0] / fh), by: Math.floor(anchor[1] / fv) });
    summary = readSummary(api.readSummary());
  }

  /**
   * Re-encode with the current settings. The push rewinds the engine to 0,
   * paused; put the scan back at the same share of the image and resume if it
   * was playing (the very first encode starts playing from 0).
   */
  function encode(writeUrl = true) {
    if (qualityFrame) {
      cancelAnimationFrame(qualityFrame);
      qualityFrame = 0;
    }
    const a = api;
    const img = image;
    if (!a?.engine || !img) return;
    const snap = a.snapshot;
    const share = snap.max_iterations > 0 ? snap.iteration / snap.max_iterations : 0;
    const wasPlaying = snap.playing;
    const max = mcuCount(img.w, img.h, subsampling);
    a.setRuleConfigWithImage(
      { image_id: imageId, quality, subsampling, huffman, max_iterations: max },
      img.w,
      img.h,
      img.rgba,
    );
    if (first) {
      first = false;
      a.dispatch(cmd.play());
    } else {
      const at = Math.round(share * max);
      if (at > 0) a.dispatch(cmd.jumpTo(at));
      if (wasPlaying) a.dispatch(cmd.play());
    }
    selectAnchor();
    summary = readSummary(a.readSummary());
    if (writeUrl) syncUrl();
  }

  /**
   * Make `load()`'s picture the current one. Only the latest request is applied
   * (a slow decode must not overwrite a newer choice); a failure leaves the
   * current image in place and says why. `block` is the luma block to select
   * once it is in (a shared link names one); otherwise the encoder's default.
   */
  async function loadImage(load: () => Promise<RgbaImage>, id: ImageId | 'upload', block?: [number, number]) {
    const ticket = ++loadTicket;
    let img: RgbaImage;
    try {
      img = await load();
    } catch (err) {
      if (ticket !== loadTicket) return;
      loadError = err instanceof Error ? err.message : 'That picture could not be loaded.';
      // The radio the reader clicked is checked in the page; put it back on the image in use.
      for (const r of imageGroup?.querySelectorAll<HTMLInputElement>('input[name="jpeg-image"]') ?? []) {
        r.checked = r.value === imageId;
      }
      return;
    }
    if (ticket !== loadTicket) return;
    loadError = null;
    image = img;
    imageId = id;
    anchor = block ?? null;
    component = 0;
    first = true;
    encode();
    pushLayout();
  }

  const chooseImage = (id: ImageId, block?: [number, number]) => loadImage(() => loadBuiltin(id), id, block);

  async function onUpload(file: File | null | undefined) {
    if (!file) return;
    await loadImage(() => decodeUpload(file), 'upload');
  }

  function onQuality(e: Event) {
    quality = clampQuality((e.target as HTMLInputElement).value);
    // A drag fires an input per pixel: encode once per frame, and write the URL when it is let go.
    if (!qualityFrame) {
      qualityFrame = requestAnimationFrame(() => {
        qualityFrame = 0;
        encode(false);
      });
    }
  }

  function setSubsampling(s: SubsamplingId) {
    if (s === subsampling) return;
    subsampling = s;
    encode();
  }

  function setHuffman(h: HuffmanId) {
    if (h === huffman) return;
    huffman = h;
    encode();
  }

  function setStage(s: StageId) {
    if (s === stage) return;
    stage = s;
    clearHover();
    pushLayout();
    syncUrl();
  }

  function clearHover() {
    if (hover === null) return;
    hover = null;
    api?.patchVizConfig({ hover: null });
  }

  function setComponent(c: number) {
    component = c;
    if (!anchor && summary?.selected) anchor = [summary.selected.bx, summary.selected.by];
    selectAnchor();
  }

  /** A click on the image picks the luma block under the pointer. */
  function onImageClick(e: MouseEvent) {
    // A keyboard "click" has no pointer position; the arrow keys pick blocks instead.
    if (!image || e.detail === 0) return;
    const box = (e.currentTarget as HTMLElement).parentElement!.getBoundingClientRect();
    const b = blockAt(e.clientX - box.left, e.clientY - box.top, layout.image, image.w, image.h);
    if (!b) return;
    anchor = b;
    selectAnchor();
    pushLayout();
    syncUrl();
  }

  /** The arrow keys on the image move the selected luma block one step, within the grid. */
  function onImageKey(e: KeyboardEvent) {
    if (!image || e.altKey || e.metaKey || e.ctrlKey) return;
    const step: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const d = step[e.key];
    if (!d) return;
    e.preventDefault();
    e.stopPropagation(); // not also a stage switch
    const sel = summary?.selected;
    const [bx, by] = anchor ?? (sel && sel.component === 0 ? [sel.bx, sel.by] : [0, 0]);
    anchor = clampBlock([bx + d[0], by + d[1]]);
    selectAnchor();
    pushLayout();
    syncUrl();
  }

  /** Pointer over the atlas or the coefficients: outline that pattern in both. */
  function onCellHover(e: PointerEvent, rect: { x: number; y: number; w: number; h: number }) {
    const box = (e.currentTarget as HTMLElement).parentElement!.getBoundingClientRect();
    const uv = cellAt(e.clientX - box.left, e.clientY - box.top, rect);
    if (uv?.[0] === hover?.[0] && uv?.[1] === hover?.[1]) return;
    hover = uv;
    api?.patchVizConfig({ hover: uv });
  }

  function onCubeMix(e: Event) {
    cubeMix = Number((e.target as HTMLInputElement).value);
    api?.patchVizConfig({ cube_mix: cubeMix });
  }

  function onK(e: Event) {
    dctK = Number((e.target as HTMLInputElement).value);
    api?.patchVizConfig({ dct_k: dctK });
  }

  function saveJpeg() {
    const bytes = api?.engine?.rule_bytes();
    if (!bytes) return;
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `jpeg-lab-q${quality}-${subsampling}.jpg`;
    a.click();
    // Revoke after the browser has started the download, not in the same tick as the click.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  /** The left and right arrow keys step through the ready stages, unless a form control has the keys. */
  function onKey(e: KeyboardEvent) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (e.altKey || e.metaKey || e.ctrlKey || e.defaultPrevented) return;
    const t = e.target;
    if (t instanceof Element && t.closest('input, select, textarea, [contenteditable="true"], [contenteditable=""]')) return;
    setStage(stepStage(stage, e.key === 'ArrowRight' ? 1 : -1));
  }

  /** Lay the stage out from the canvas's CSS size and hand the viz its panels in device pixels. */
  function pushLayout() {
    const canvas = overlayEl?.closest('.stage')?.querySelector('canvas');
    if (!api?.engine || !canvas || !image) return;
    const dpr = window.devicePixelRatio || 1;
    const sel = summary?.selected;
    const block = anchor ?? (sel && sel.component === 0 ? ([sel.bx, sel.by] as [number, number]) : undefined);
    layout = jpegLayout(stage, canvas.clientWidth, canvas.clientHeight, image.w, image.h, block);
    api.patchVizConfig({ panels: toDevicePanels(layout.panels, dpr), cube_mix: cubeMix, dct_k: dctK, hover });
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    void onUpload(e.dataTransfer?.files?.[0]);
  }
  const onDragOver = (e: DragEvent) => e.preventDefault();

  async function onReady(a: LabApi) {
    api = a;
    a.dispatch(cmd.setSpeed(DEFAULT_SPEED));
    const stageEl = overlayEl?.closest('.stage') as HTMLElement | null;
    stageEl?.addEventListener('dragover', onDragOver);
    stageEl?.addEventListener('drop', onDrop);
    if (typeof ResizeObserver !== 'undefined' && overlayEl) {
      ro = new ResizeObserver(() => pushLayout());
      ro.observe(overlayEl);
    }
    window.addEventListener('resize', pushLayout);
    window.addEventListener('keydown', onKey);
    const start = imageId === 'upload' ? 'gradient' : imageId;
    await loadImage(() => loadBuiltin(start), start, linked.block);
    if (route.query !== currentQuery()) syncUrl();
  }

  onDestroy(() => {
    ro?.disconnect();
    ro = null;
    if (qualityFrame) cancelAnimationFrame(qualityFrame);
    const stageEl = overlayEl?.closest('.stage') as HTMLElement | null;
    stageEl?.removeEventListener('dragover', onDragOver);
    stageEl?.removeEventListener('drop', onDrop);
    window.removeEventListener('resize', pushLayout);
    window.removeEventListener('keydown', onKey);
  });

  const sel = $derived(summary?.selected ?? null);
  /** Dark numbers on light cells. */
  const sampleShade = (v: number) => (v > 150 ? 'dark' : 'light') as 'dark' | 'light';
</script>

<LabShell
  labId="jpeg"
  title="JPEG Compression"
  thesis="Follow one picture, and one 8 × 8 block of it, from pixels to bits and back."
  zoom={false}
  {onReady}
>
  {#snippet controls()}
    <div class="group" role="radiogroup" aria-labelledby="jpeg-image-name" bind:this={imageGroup}>
      <span class="name" id="jpeg-image-name">Image</span>
      {#each IMAGES as im (im.id)}
        <label class="btn pill" title={im.title}>
          <input type="radio" name="jpeg-image" value={im.id} checked={imageId === im.id} onchange={() => void chooseImage(im.id)} />{im.label}
        </label>
      {/each}
      <button class="btn" onclick={() => fileInput?.click()} title="Use your own picture (scaled to fit 512 px); or drop one on the stage">
        <Icon name="upload" />Upload
      </button>
      <input
        class="file"
        type="file"
        accept="image/*"
        bind:this={fileInput}
        onchange={(e) => void onUpload((e.currentTarget as HTMLInputElement).files?.[0])}
      />
    </div>
    <label class="field quality">
      Quality
      <input type="range" min="1" max="100" step="1" value={quality} oninput={onQuality} onchange={syncUrl} aria-label="Quality" />
      <span class="mono value">{quality}</span>
    </label>
    <div class="group" role="radiogroup" aria-labelledby="jpeg-sub-name">
      <span class="name" id="jpeg-sub-name">Chroma</span>
      {#each [['444', '4:4:4'], ['422', '4:2:2'], ['420', '4:2:0']] as [id, label] (id)}
        <label class="btn pill">
          <input type="radio" name="jpeg-sub" value={id} checked={subsampling === id} onchange={() => setSubsampling(id as SubsamplingId)} />{label}
        </label>
      {/each}
    </div>
    <div class="group" role="radiogroup" aria-labelledby="jpeg-huff-name">
      <span class="name" id="jpeg-huff-name">Huffman</span>
      <label class="btn pill" title="Code lengths built from this image's own symbol counts">
        <input type="radio" name="jpeg-huff" value="optimized" checked={huffman === 'optimized'} onchange={() => setHuffman('optimized')} />Optimized
      </label>
      <label class="btn pill" title="The example tables from the JPEG standard">
        <input type="radio" name="jpeg-huff" value="standard" checked={huffman === 'standard'} onchange={() => setHuffman('standard')} />Standard
      </label>
    </div>
    <button class="btn" onclick={saveJpeg} disabled={!summary?.bytes}><Icon name="download" />Save .jpg</button>
    <div class="row">
      <StageRail current={stage} onselect={setStage} />
    </div>
    {#if readout}
      <div class="row stats" aria-live="off">
        <span class="stat"><span class="mono">{readout.size}</span> of {readout.of}</span>
        <span class="stat"><span class="mono">{readout.ratio}</span></span>
        <span class="stat"><span class="mono">{readout.bpp}</span> bits / pixel</span>
        <span class="stat">PSNR <span class="mono">{readout.psnr}</span></span>
      </div>
    {/if}
  {/snippet}

  {#snippet overlay()}
    <div class="marks" bind:this={overlayEl}>
      {#each layout.panels as p (p.kind)}
        <span class="caption" style:left="{p.rect.x}px" style:top="{p.rect.y - 20}px" style:max-width="{Math.max(p.rect.w, 120)}px">{p.label}</span>
      {/each}
      {#if layout.image.w > 0}
        <button
          class="hit"
          aria-label="Pick a block: click it, or use the arrow keys to move the selected block"
          style:left="{layout.image.x}px"
          style:top="{layout.image.y}px"
          style:width="{layout.image.w}px"
          style:height="{layout.image.h}px"
          onclick={onImageClick}
          onkeydown={onImageKey}
        ></button>
      {/if}

      {#if stage === 'color' && panel('cube')}
        {@const r = panel('cube')!}
        <label class="ctl" style:left="{r.x}px" style:top="{r.y + r.h - 34}px" style:width="{r.w}px">
          <span>RGB axes</span>
          <input type="range" min="0" max="1" step="0.01" value={cubeMix} oninput={onCubeMix} aria-label="RGB axes to YCbCr axes" />
          <span>YCbCr axes</span>
        </label>
      {/if}

      {#if stage === 'blocks' && panel('block') && sel}
        {@const r = panel('block')!}
        <CellNumbers rect={r} values={showShifted ? sel.shifted : sel.pixels} shade={(v) => sampleShade(showShifted ? v + 128 : v)} />
        <div class="ctl tools" style:left="{r.x}px" style:top="{r.y + r.h + 10}px">
          {#each ['Y', 'Cb', 'Cr'] as name, c (name)}
            <button class="chip" aria-pressed={component === c} onclick={() => setComponent(c)}>{name}</button>
          {/each}
          <button class="chip" aria-pressed={showShifted} onclick={() => (showShifted = !showShifted)} title="Centre the samples on zero">− 128</button>
        </div>
      {/if}

      {#if stage === 'dct' && sel}
        {#each ['atlas', 'coeffs'] as kind (kind)}
          {@const r = panel(kind as Panel['kind'])}
          {#if r}
            <div
              class="hover-area"
              role="presentation"
              style:left="{r.x}px"
              style:top="{r.y}px"
              style:width="{r.w}px"
              style:height="{r.h}px"
              onpointermove={(e) => onCellHover(e, r)}
              onpointerdown={(e) => onCellHover(e, r)}
              onpointerleave={clearHover}
            ></div>
          {/if}
        {/each}
        {#if panel('coeffs')}
          <CellNumbers rect={panel('coeffs')!} values={sel.dct} />
        {/if}
        {#if panel('rebuild')}
          {@const r = panel('rebuild')!}
          <label class="ctl" style:left="{r.x}px" style:top="{r.y + r.h + 8}px" style:width="{Math.max(r.w, 200)}px">
            <span>k = <span class="mono">{dctK}</span></span>
            <input type="range" min="0" max="64" step="1" value={dctK} oninput={onK} aria-label="Patterns kept" />
          </label>
        {/if}
        <DctCharts rect={layout.extra} dct={sel.dct} shifted={sel.shifted} k={dctK} />
      {/if}

      {#if loadError}
        <p class="error" role="alert">{loadError}</p>
      {/if}
      {#if summary?.error}
        <p class="error" role="alert">This image could not be encoded: {summary.error}</p>
      {/if}
    </div>
  {/snippet}

  {#snippet story()}
    <section class="stage-card" aria-live="polite">
      <h2><span class="mark">{stageInfo.mark}</span> {stageInfo.title}</h2>
      <p class="sub">{stageInfo.subtitle}</p>
      {#each stageTex(stage, summary, hover) as tex}
        <Tex {tex} />
      {/each}
      <p class="tip">{NOTICE[stage]}</p>
    </section>

    <h2>How it works</h2>
    <p>
      A JPEG file is the picture written as a recipe, not as pixels. The encoder turns colours into
      brightness and two colour differences, keeps less of the colour, cuts each plane into 8 × 8 blocks,
      rewrites every block as a weighted sum of 64 cosine patterns, rounds those weights coarsely, and
      packs what is left into as few bits as it can.
    </p>
    <p class="tip">
      Play runs the scan block by block: the image fills in as it would arrive over a slow connection.
      Click anywhere on the image to follow that block through every stage, and use the left and right arrow keys to move
      between stages.
    </p>
  {/snippet}
</LabShell>

<style>
  .file { display: none; }
  .quality input { width: 140px; }
  .quality .value { width: 3ch; text-align: right; color: var(--ink); }
  .name { color: var(--stone); font-size: 14px; }
  /* Radio inputs drawn as pills, as in the Notes lab. */
  .pill input { position: absolute; opacity: 0; pointer-events: none; }
  .pill:has(input:checked) { border-color: var(--accent); background: var(--tint); }
  .pill:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
  /* The rail and the readout each take a whole row, after the shell's speed slider. */
  .row { flex-basis: 100%; min-width: 0; max-width: 100%; order: 1; }
  .stats { display: flex; flex-wrap: wrap; gap: 6px 22px; }

  .marks { position: absolute; inset: 0; }
  .caption {
    position: absolute;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.72);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hit { position: absolute; padding: 0; border: 0; background: none; cursor: crosshair; pointer-events: auto; }
  .hover-area { position: absolute; pointer-events: auto; }
  .ctl {
    position: absolute;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.8);
    pointer-events: auto;
  }
  .ctl input { flex: 1; accent-color: var(--accent); }
  .tools { gap: 6px; }
  .chip {
    height: 28px;
    padding: 0 10px;
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.35);
    color: rgba(255, 255, 255, 0.85);
    font-size: 12px;
    cursor: pointer;
  }
  .chip[aria-pressed='true'] { border-color: var(--accent); color: #fff; }
  .error {
    position: absolute;
    left: 16px;
    bottom: 8px;
    margin: 0;
    padding: 6px 10px;
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.6);
    color: #ffb4a0;
    font-size: 13px;
    pointer-events: auto;
  }
  .stage-card { margin-bottom: 36px; }
  .stage-card h2 { display: flex; align-items: center; gap: 10px; }
  .stage-card .mark {
    display: inline-grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--paper);
    font-size: 14px;
  }
  .sub { color: var(--stone); margin-top: -4px; }
</style>
