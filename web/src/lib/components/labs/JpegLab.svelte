<script lang="ts">
  // The JPEG lab: one image followed through the compression pipeline, one
  // stage at a time. The engine encodes the image (Rust `jpeg` crate) and its
  // clock walks the scan MCU by MCU; this page owns the settings, the stage
  // rail and the layout. The scan and the selected block are one current
  // block: the rule keeps the selection on the MCU just scanned, and a pick
  // (click, key, hint) pauses the scan and jumps it to the picked block's MCU.
  // Settings re-encode through a rule-config push (which rewinds the engine),
  // after which the page puts the scan back on the current block.
  import { onDestroy, tick, untrack } from 'svelte';
  import LabShell from '../LabShell.svelte';
  import Icon from '../Icon.svelte';
  import Tex from '../Tex.svelte';
  import StageRail from '../jpeg/StageRail.svelte';
  import CellNumbers from '../jpeg/CellNumbers.svelte';
  import DctCharts from '../jpeg/DctCharts.svelte';
  import QTable from '../jpeg/QTable.svelte';
  import RdChart from '../jpeg/RdChart.svelte';
  import ZigzagStrip from '../jpeg/ZigzagStrip.svelte';
  import TokenChips from '../jpeg/TokenChips.svelte';
  import HuffmanView from '../jpeg/HuffmanView.svelte';
  import DecodeTools from '../jpeg/DecodeTools.svelte';
  import Overview from '../jpeg/Overview.svelte';
  import Gallery from '../jpeg/Gallery.svelte';
  import JpegTour from '../jpeg/JpegTour.svelte';
  import TooltipHost from '../jpeg/TooltipHost.svelte';
  import { TooltipController, tooltip } from '../jpeg/tooltip.svelte';
  import type { LabApi } from '../labApi.svelte';
  import { cmd } from '../../playback/commands';
  import { route, replaceQuery } from '../../router.svelte';
  import { STAGES, stepStage, type StageId } from '../../jpeg/stages';
  import {
    buildParams,
    clampQuality,
    lumaAnchorOf,
    mcuCount,
    mcuIndexOf,
    parseParams,
    type HuffmanId,
    type ImageId,
    type SubsamplingId,
  } from '../../jpeg/params';
  import { GROUP_LABELS, IMAGES, decodeUpload, loadPicture, type PictureGroup, type RgbaImage } from '../../jpeg/images';
  import { BLANK_PANELS, CAPTION_MIN, blockAt, cellAt, cells, jpegLayout, toDevicePanels, type Panel, type Rect, type StageLayout } from '../../jpeg/layout';
  import type { ExplainContext, Target } from '../../jpeg/explain';
  import { saveFileName } from '../../jpeg/explain/bezel';
  import { canvasTarget, cellTarget } from '../../jpeg/explain/hit';
  import { cachedCurve, rdKey } from '../../jpeg/rd';
  import { isLabPicture, markTourSeen, tourSeen, type TourHandoff } from '../../jpeg/tour';
  import { readSummary, readoutOf, type JpegSummary } from '../../jpeg/summary';
  import { NOTICE, stageTex } from '../../jpeg/formulas';
  import { readSegments, readTables, type HuffTableView, type SegmentView } from '../../jpeg/huffman';
  import { loadVizCore } from '../../wasm/loader';

  /** MCUs scanned per second by default: the 256² gradient (256 MCUs) scans in about a minute, slowly enough to follow. */
  const DEFAULT_SPEED = 4;
  /** The zigzag path's growth in cells a second while paused (mirrors `default_zigzag_speed` in the viz); 0 while playing shows it whole. */
  const ZIGZAG_SPEED = 24;
  /** Why the transport is off on the overview, which has no single block. */
  const OVERVIEW_TRANSPORT_OFF = 'The overview shows the whole picture at once. Pick a stage to follow the scan one block at a time.';
  /** The decoded copy is made this long after the last encode, so a quality drag decodes once. */
  const DECODE_DELAY_MS = 120;

  const linked = parseParams(route.query);
  // The first picture starts loading now, not when the engine is ready, so the fetch overlaps the WASM load.
  const firstPicture = loadPicture(linked.img);
  firstPicture.catch(() => {}); // the failure is handled where it is awaited (the gradient fallback)
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
  /** Decode stage: the decoded share of the comparison, and the error map's brightness. */
  let wipe = $state(0.5);
  let errorGain = $state(4);
  /** Custom quantization tables `[luma, chroma]`, row-major; null = scaled from the quality. */
  let customTables = $state.raw<[number[], number[]] | null>(null);
  /** Huffman stage: the rule's four tables and the file's segments, read once per encode. */
  let huffTables = $state.raw<HuffTableView[]>([]);
  let segments = $state.raw<SegmentView[]>([]);
  /** The file size with the other Huffman mode (null while unknown or with custom tables). */
  let otherBytes = $state<number | null>(null);
  /** Names the picture in the R–D cache: the image id, or one tag per upload. */
  let imageTag = $state('spring');
  let uploads = 0;
  /** Zigzag stage: how many cells the viz's scan path has reached. */
  let zigReached = $state(0);

  /** Roving cell of the coefficient grids: the pattern the arrow keys have reached. */
  let rove = $state<[number, number]>([0, 0]);
  /** Bumped when the R–D sweep adds points, so the cards see them. */
  let rdTick = $state(0);
  /** PSNR after each Decode re-save generation; the Decode panel keeps it, the cards read it. */
  let resave = $state.raw<number[]>([]);

  let image = $state<RgbaImage | null>(null);
  /** The JPEG file decoded to RGBA, once per encode (null until it arrives): the cards read it, hovering never decodes. */
  let decoded = $state.raw<Uint8Array | null>(null);
  /** The encoded file, for the overview's size bars and histogram (null until the first encode). */
  let jpegBytes = $state.raw<Uint8Array | null>(null);
  /** Why the last picture could not be loaded (the current image stays). */
  let loadError = $state<string | null>(null);
  let summary = $state<JpegSummary | null>(null);
  let layout = $state<StageLayout>({ image: { x: 0, y: 0, w: 0, h: 0 }, panels: [], slots: {} });
  let api = $state<LabApi | null>(null);
  let appliedQuery = route.query;
  let overlayEl: HTMLDivElement | null = null;
  let fileInput: HTMLInputElement | null = null;
  let pictureSelect: HTMLSelectElement | null = null;
  let ro: ResizeObserver | null = null;
  /** The encoder's default block (the luma block with the most AC energy), read back at each encode. */
  let defaultBlock: [number, number] | null = null;
  /** The scan step the current block was last checked against (-1 until the first picture is in). */
  let followedAt = -1;
  /** Whether the scan was playing at the last look, so only a change of it acts. */
  let lastPlaying = false;
  /** Each picture load takes a ticket; only the latest one is applied when it arrives. */
  let loadTicket = 0;
  /** The animation frame a quality drag has scheduled its encode on (0 = none). */
  let qualityFrame = 0;
  /** The cards: what is hovered and what is pinned, for every target on the page. */
  const ctl = new TooltipController();
  /** The guided tour is open: on the first visit it opens by itself, and the header button opens it again. */
  let tourOpen = $state(!tourSeen());
  let howButton: HTMLButtonElement | null = null;
  /** The tour handed a picture over before the engine was ready: the link's own picture must not replace it. */
  let handedOff = false;
  /** Hit-tests the canvas for the stage (set once the engine is ready). */
  let stageCards: ReturnType<typeof tooltip> | undefined;
  /** The shell's own controls (transport buttons, position readout, speed slider): the shell owns them, so they get their cards here once the page is up. */
  let shellCards: ReturnType<typeof tooltip>[] = [];

  const stageInfo = $derived(STAGES.find((s) => s.id === stage)!);
  // Until the first picture is in, the summary is the engine's own stand-in gradient: show none of it.
  const readout = $derived(image && summary ? readoutOf(summary) : null);
  /** Who made the picture in use, when it is a bundled one. */
  const credit = $derived(IMAGES.find((im) => im.id === imageId)?.credit);
  const GROUPS = Object.keys(GROUP_LABELS) as PictureGroup[];
  /** The overview is on screen with its stats slot (it then shows the messages itself). */
  const overviewShown = $derived(stage === 'overview' && !!image && (layout.slots.stats?.w ?? 0) > 160 && (layout.slots.stats?.h ?? 0) > 80);
  /** What went wrong, for the messages. */
  const alerts = $derived([loadError, summary?.error ? `This image could not be encoded: ${summary.error}` : null].filter((m): m is string => !!m));
  const panel = (kind: Panel['kind']) => layout.panels.find((p) => p.kind === kind)?.rect;

  function currentQuery(): string {
    return buildParams({
      // A share link cannot carry an uploaded picture, so it names the generated gradient outright
      // (written even though it is not the default: a link with no `img=` opens the spring).
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
      // A link always opens paused on its block (the encoder's default with none): a new picture or new settings
      // rewind the engine and nothing plays it on again.
      if (p.img !== imageId) void chooseImage(p.img, p.block);
      else if (encodeChanged) encode(true, false);
      else {
        if (anchor) selectAnchor();
        else selectDefault(); // the rule may still sit on a chroma block of the last link
        jumpToAnchor();
        if (currentQuery() !== q) syncUrl(); // the block was off the grid and has been clamped
      }
      pushLayout();
    });
  });

  // The shell replaces `snapshot` every frame; the summary only moves with the scan cursor.
  const iteration = $derived(api?.snapshot.iteration ?? 0);
  $effect(() => {
    const n = iteration;
    const a = api;
    if (!a || !image) return;
    summary = readSummary(a.readSummary());
    untrack(() => {
      // Only a scan move is followed: a new picture or the first look at the clock moves nothing.
      if (n === followedAt) return;
      if (followedAt >= 0) followScan();
      followedAt = n;
    });
  });

  /**
   * The rule has moved the selection with the scan: make it the current block.
   * Runs once per scan step, so it never pushes viz config (that would restart
   * the viz's clock) and writes the link only while paused (a step, or Back).
   */
  function followScan() {
    const s = summary?.selected;
    if (!s || !image) return;
    const at = anchor ?? defaultBlock;
    const [fh, fv] = planeFactors(component);
    if (at && s.component === component && s.bx === Math.floor(at[0] / fh) && s.by === Math.floor(at[1] / fv)) return;
    anchor = lumaAnchorOf(s, subsampling);
    component = s.component;
    if (!api?.snapshot.playing) syncUrl();
  }

  // Play and Pause. While the scan plays the zigzag path is drawn whole (animating it would restart it on
  // every step); paused, it grows again. A pause, the engine's own at the end included, writes the link.
  const playing = $derived(api?.snapshot.playing ?? false);
  $effect(() => {
    const p = playing;
    untrack(() => {
      if (p === lastPlaying) return;
      lastPlaying = p;
      api?.patchVizConfig({ zigzag_speed: p ? 0 : ZIGZAG_SPEED });
      if (!p && image) syncUrl();
    });
  });

  // The viz animates the zigzag path itself; read how far it has got each frame.
  $effect(() => {
    if (stage !== 'zigzag') return; // other stages must not subscribe to the per-frame snapshot
    void api?.snapshot;
    const a = api;
    if (!a) return;
    const r = a.readVizReadout() as { zigzag?: unknown } | null;
    zigReached = typeof r?.zigzag === 'number' ? Math.min(64, Math.ceil(r.zigzag)) : 64;
  });

  // The Huffman stage reads the tables and segments once per encode.
  const version = $derived(summary?.version ?? -1);
  $effect(() => {
    void version;
    const engine = api?.engine;
    if (stage !== 'huffman' || !engine) return;
    huffTables = readTables(engine.rule_inspect('huffman'));
    segments = readSegments(engine.rule_inspect('segments'));
  });

  // The finished file and its decoded copy, read once per encode (a new picture is a new encode too).
  // The overview draws from the file; the cards read the decoded pixels.
  // The decode waits for the encodes to settle, so a quality drag decodes once, after it, not once per frame.
  $effect(() => {
    void version;
    const engine = api?.engine;
    if (version < 0 || !engine) return;
    const bytes = engine.rule_bytes() ?? null;
    jpegBytes = bytes;
    decoded = null;
    if (!bytes) return;
    let alive = true;
    const timer = setTimeout(() => {
      loadVizCore()
        .then((v) => {
          if (!alive) return;
          try {
            decoded = v.jpeg_decode(bytes);
          } catch {
            decoded = null;
          }
        })
        .catch(() => {});
    }, DECODE_DELAY_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  });

  // ...and what the other Huffman mode would cost (the kit encodes with quality-scaled tables only).
  // Runs once per encode (`version`), not once per setting that fed it.
  $effect(() => {
    void version;
    const img = image; // a new picture is a new encode; quality, subsampling and mode are read untracked
    const on = stage === 'huffman' && !customTables;
    otherBytes = null;
    if (!on || !img) return;
    const { q, s, other } = untrack(() => ({
      q: quality,
      s: subsampling,
      other: huffman === 'optimized' ? 'standard' : 'optimized',
    }));
    let alive = true;
    loadVizCore()
      .then((v) => {
        if (!alive) return;
        try {
          otherBytes = (v.jpeg_encode_stats(img.rgba, img.w, img.h, q, s, other) as { bytes: number }).bytes;
        } catch {
          otherBytes = null;
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
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
    const [fh, fv] = planeFactors(component);
    api.ruleAction({ kind: 'select_block', component, bx: Math.floor(anchor[0] / fh), by: Math.floor(anchor[1] / fv) });
    summary = readSummary(api.readSummary());
  }

  /** With no block picked, put the rule's selection back on the encoder's default (a luma block), so the scan follows the luma plane. */
  function selectDefault() {
    if (!api || !defaultBlock) return;
    component = 0;
    api.ruleAction({ kind: 'select_block', component: 0, bx: defaultBlock[0], by: defaultBlock[1] });
    summary = readSummary(api.readSummary());
  }

  /** How many luma blocks one block of plane `c` spans, across and down. */
  function planeFactors(c: number): [number, number] {
    return c === 0 || subsampling === '444' ? [1, 1] : subsampling === '422' ? [2, 1] : [2, 2];
  }

  /** Put the scan just after the current block's MCU (`anchor`, else the encoder's default), so the panels show it. */
  function jumpToAnchor() {
    const at = anchor ?? defaultBlock;
    if (!api || !image || !at) return;
    api.dispatch(cmd.jumpTo(mcuIndexOf(at, subsampling, image.w) + 1));
  }

  /**
   * Re-encode with the current settings. The push rewinds the engine to 0,
   * paused; put the scan back on the current block, in the new MCU grid, and
   * with `resume`, play on if it was playing. Nothing here starts a scan that
   * was not playing: a new picture waits at its block until Play.
   */
  function encode(writeUrl = true, resume = true) {
    if (qualityFrame) {
      cancelAnimationFrame(qualityFrame);
      qualityFrame = 0;
    }
    const a = api;
    const img = image;
    if (!a?.engine || !img) return;
    const wasPlaying = a.snapshot.playing;
    const max = mcuCount(img.w, img.h, subsampling);
    a.setRuleConfigWithImage(
      { image_id: imageId, quality, subsampling, huffman, max_iterations: max, tables: customTables },
      img.w,
      img.h,
      img.rgba,
    );
    // The push leaves the rule on the encoder's default block: keep it, whether or not a block is picked, so a later link with none can return to it.
    const fresh = readSummary(a.readSummary());
    defaultBlock = fresh?.selected ? lumaAnchorOf(fresh.selected, subsampling) : null;
    selectAnchor();
    summary = readSummary(a.readSummary());
    jumpToAnchor();
    if (resume && wasPlaying) a.dispatch(cmd.play());
    summary = readSummary(a.readSummary());
    if (writeUrl) syncUrl();
  }

  /**
   * Make `load()`'s picture the current one. Only the latest request is applied
   * (a slow decode must not overwrite a newer choice); a failure leaves the
   * current image in place and says why. `block` is the luma block to select
   * once it is in (a shared link names one); otherwise the encoder's default.
   * With no picture yet (the first load failed, say offline) the generated
   * gradient stands in, so the lab still opens, with the error shown; the
   * address keeps naming the picture that was asked for, so reloading (or
   * sharing the link on) tries it again. Resolves true for that fallback.
   */
  async function loadImage(load: () => Promise<RgbaImage>, id: ImageId | 'upload', block?: [number, number]): Promise<boolean> {
    const ticket = ++loadTicket;
    let img: RgbaImage;
    let message: string | null = null;
    let fellBack = false;
    try {
      img = await load();
    } catch (err) {
      if (ticket !== loadTicket) return false;
      message = err instanceof Error ? err.message : 'That picture could not be loaded.';
      if (image) {
        loadError = message;
        // The select shows the option the reader chose; put it back on the picture in use.
        if (pictureSelect) pictureSelect.value = imageId;
        return false;
      }
      try {
        img = await loadPicture('gradient');
      } catch {
        loadError = message;
        return false;
      }
      if (ticket !== loadTicket) return false;
      id = 'gradient';
      block = undefined;
      fellBack = true;
    }
    if (ticket !== loadTicket) return false;
    loadError = message;
    image = img;
    imageId = id;
    imageTag = id === 'upload' ? `upload-${++uploads}` : id;
    anchor = block ?? null;
    component = 0;
    encode(!fellBack, false);
    pushLayout();
    return fellBack;
  }

  const chooseImage = (id: ImageId, block?: [number, number]) => loadImage(() => loadPicture(id), id, block);

  async function onUpload(file: File | null | undefined) {
    if (!file) return;
    await loadImage(() => decodeUpload(file), 'upload');
  }

  function onPicture(e: Event) {
    const id = (e.currentTarget as HTMLSelectElement).value;
    if (id === imageId || id === 'upload') return;
    void chooseImage(id as ImageId);
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

  /** A mouse leaving the area clears the hover; a finger lifting also fires `pointerleave`, and must not undo its tap. */
  function onHoverLeave(e: PointerEvent) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    clearHover();
  }

  function setComponent(c: number) {
    component = c;
    if (!anchor && summary?.selected) anchor = [summary.selected.bx, summary.selected.by];
    selectAnchor();
  }

  /**
   * The one way the reader picks a block (a click, the arrow keys, a Decode hint):
   * luma block `b`, shown from plane `c`, becomes the current block, and the
   * scan pauses just after its MCU, so the blocks before it show as scanned.
   */
  function pick(b: [number, number], c = component) {
    if (!api || !image) return;
    anchor = clampBlock(b);
    component = c;
    selectAnchor();
    api.dispatch(cmd.pause());
    api.dispatch(cmd.jumpTo(mcuIndexOf(anchor, subsampling, image.w) + 1));
    syncUrl();
  }

  /** A click on the image picks the luma block under the pointer. */
  function onImageClick(e: MouseEvent) {
    // A keyboard "click" has no pointer position; the arrow keys pick blocks instead.
    if (!image || e.detail === 0) return;
    const box = (e.currentTarget as HTMLElement).parentElement!.getBoundingClientRect();
    const b = blockAt(e.clientX - box.left, e.clientY - box.top, layout.image, image.w, image.h);
    if (b) pick(b);
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
    pick([bx + d[0], by + d[1]]);
  }

  /** Outline pattern `uv` in the atlas and the coefficients (null for none), and let the formula follow it. */
  function setHover(uv: [number, number] | null) {
    // Only the DCT and Quantize panels draw a hover outline; elsewhere a config push would reset the viz clock for nothing.
    if (stage !== 'dct' && stage !== 'quantize') return;
    if (uv?.[0] === hover?.[0] && uv?.[1] === hover?.[1]) return;
    hover = uv;
    api?.patchVizConfig({ hover: uv });
  }

  /** Pointer over the atlas or the coefficients: outline that pattern in both. */
  function onCellHover(e: PointerEvent, rect: Rect) {
    const box = (e.currentTarget as HTMLElement).parentElement!.getBoundingClientRect();
    setHover(cellAt(e.clientX - box.left, e.clientY - box.top, rect));
  }

  /** The card for whatever is on the canvas under a pointer event (CSS pixels from the overlay's corner). */
  function hitTarget(e: MouseEvent): Target | null {
    if (!image || !overlayEl) return null;
    const box = overlayEl.getBoundingClientRect();
    // The viz draws the zoom from the encoded picture's subsampling, which trails the lab's own during a re-encode.
    const s = summary?.subsampling;
    const encoded = s === '444' || s === '422' || s === '420' ? s : subsampling;
    return canvasTarget(layout, stage, image, e.clientX - box.left, e.clientY - box.top, sel, encoded);
  }

  /** For the keyboard: the card of the first pixel of the block being followed. */
  function followedPixel(): Target | null {
    if (!image) return null;
    const [bx, by] = anchor ?? (sel && sel.component === 0 ? [sel.bx, sel.by] : [0, 0]);
    return { id: 'image.pixel', x: Math.min(image.w - 1, bx * 8), y: Math.min(image.h - 1, by * 8) };
  }

  /** The colour and subsample panels that carry a card but are not cell grids. */
  const COLOUR_PANELS: ReadonlySet<Panel['kind']> = new Set(['cube', 'plane_y', 'plane_cb', 'plane_cr', 'coded_cb', 'coded_cr']);

  /** For the keyboard: the card of a colour panel, about the block being followed. */
  function panelKey(kind: Panel['kind']): Target | null {
    if (kind === 'cube') return { id: 'color.cube' };
    const f = followedPixel();
    if (!f || f.id !== 'image.pixel') return null;
    const { x, y } = f;
    switch (kind) {
      case 'plane_y':
        return stage === 'color' ? { id: 'color.plane', plane: 0, x, y } : null;
      case 'plane_cb':
      case 'plane_cr': {
        const plane = kind === 'plane_cb' ? 1 : 2;
        return stage === 'color' ? { id: 'color.plane', plane, x, y } : { id: 'subsample.plane', which: 'full', plane, x, y };
      }
      case 'coded_cb':
      case 'coded_cr':
        return { id: 'subsample.plane', which: 'coded', plane: kind === 'coded_cb' ? 1 : 2, x, y };
      case 'original':
      case 'decoded':
        return { id: 'overview.pixel', which: kind, x, y };
      case 'wipe':
        return { id: 'decode.wipe', x, y };
      case 'error':
        return { id: 'decode.error', x, y };
      default:
        return null;
    }
  }

  /** The before-and-after pictures of the overview and the comparison panels of Decode: the pointer is hit-tested on the canvas; these give the keyboard a way in. */
  const COMPARE_PANELS: ReadonlySet<Panel['kind']> = new Set(['original', 'decoded', 'wipe', 'error']);

  /** The stage's own listener: only the bare canvas is hit-tested here; overlay elements carry their own cards. */
  const canvasHit = (e: MouseEvent): Target | null => (e.target instanceof HTMLCanvasElement ? hitTarget(e) : null);

  const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

  /** The arrow keys move the roving cell of a coefficient grid; the hover outline follows, and the grid's action shows the cell's card. */
  function onGridKey(e: KeyboardEvent) {
    if (e.altKey || e.metaKey || e.ctrlKey) return;
    const d = ARROWS[e.key];
    if (!d) return;
    e.preventDefault(); // not also a stage switch or a page scroll
    rove = [Math.min(7, Math.max(0, rove[0] + d[0])), Math.min(7, Math.max(0, rove[1] + d[1]))];
    setHover(rove);
  }

  /** Keyboard focus lights the roving cell's pattern as the pointer does (a mouse press has just lit its own cell). */
  function onGridFocus(e: FocusEvent) {
    let keyboard = true;
    try {
      keyboard = (e.currentTarget as HTMLElement).matches(':focus-visible');
    } catch {
      // an engine without :focus-visible: treat the focus as the keyboard's
    }
    if (keyboard) setHover(rove);
  }

  function onGridBlur() {
    clearHover();
  }

  function onCubeMix(e: Event) {
    cubeMix = Number((e.target as HTMLInputElement).value);
    api?.patchVizConfig({ cube_mix: cubeMix });
  }

  function onK(e: Event) {
    dctK = Number((e.target as HTMLInputElement).value);
    api?.patchVizConfig({ dct_k: dctK });
  }

  /** Use `table` for the selected block's plane (the other plane keeps the table it had) and re-encode. */
  function applyTable(table: number[]) {
    const cur = (api?.engine?.rule_inspect('tables') ?? null) as { luma?: number[]; chroma?: number[] } | null;
    const next: [number[], number[]] = [customTables?.[0] ?? cur?.luma ?? table, customTables?.[1] ?? cur?.chroma ?? table];
    next[sel && sel.component > 0 ? 1 : 0] = table;
    customTables = next;
    encode();
  }

  function standardTables() {
    if (!customTables) return;
    customTables = null;
    encode();
  }

  function onWipe(v: number) {
    wipe = v;
    api?.patchVizConfig({ wipe });
  }

  function onGain(v: number) {
    errorGain = v;
    api?.patchVizConfig({ error_gain: errorGain });
  }

  /** Follow the luma block a Decode hint points at. */
  function pickBlock(b: [number, number]) {
    pick(b, 0);
  }

  function saveJpeg() {
    const bytes = api?.engine?.rule_bytes();
    if (!bytes) return;
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = saveFileName(customTables, subsampling, quality);
    a.click();
    // Revoke after the browser has started the download, not in the same tick as the click.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  /** The left and right arrow keys step through the ready stages, unless a form control has the keys. */
  function onKey(e: KeyboardEvent) {
    if (tourOpen) return; // the tour owns the keys while it is open
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (e.altKey || e.metaKey || e.ctrlKey || e.defaultPrevented) return;
    const t = e.target;
    if (t instanceof Element && t.closest('input, select, textarea, [contenteditable="true"], [contenteditable=""]')) return;
    setStage(stepStage(stage, e.key === 'ArrowRight' ? 1 : -1));
  }

  /**
   * The tour has ended. `h` is what "Show me in the lab" and "Start exploring" carry over; null (skip,
   * Escape, close) changes nothing. The tour's picture is the lab's own unless the reader picked another
   * in the tour, and an upload reaches the lab only here.
   */
  async function onTourClose(h: TourHandoff | null) {
    markTourSeen();
    tourOpen = false;
    if (h) {
      quality = h.quality;
      // The lab's own picture (its upload too, or its gallery picture picked again in the tour) is
      // only encoded again, so its block and scan stay.
      if (!isLabPicture(h, imageId, image)) {
        if (!api) handedOff = true;
        await loadImage(() => Promise.resolve(h.image), h.imageId); // waits at its block, like any new picture
      } else {
        encode();
      }
      setStage(h.stage);
    }
    await tick();
    howButton?.focus();
  }

  /** Lay the stage out from the canvas's CSS size and hand the viz its panels in device pixels. */
  function pushLayout() {
    const canvas = overlayEl?.closest('.stage')?.querySelector('canvas');
    if (!api?.engine || !canvas || !image) return;
    const dpr = window.devicePixelRatio || 1;
    layout = jpegLayout(stage, canvas.clientWidth, canvas.clientHeight, image.w, image.h);
    api.patchVizConfig({ panels: toDevicePanels(layout.panels, dpr), cube_mix: cubeMix, dct_k: dctK, hover, wipe, error_gain: errorGain });
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
    if (stageEl) stageCards = tooltip(stageEl, { ctl, target: canvasHit });
    const lab = overlayEl?.closest('.lab');
    // The transport row is Reset, Back, Play / Pause, Forward, in that order.
    const [reset, back, play, forward] = [...(lab?.querySelectorAll<HTMLElement>('.transport button') ?? [])];
    const readout = lab?.querySelector<HTMLElement>('.readout');
    const shell: [HTMLElement | null | undefined, Target, boolean][] = [
      [reset, { id: 'bezel.reset' }, true],
      [back, { id: 'bezel.step', dir: 'back' }, true],
      [play, { id: 'bezel.play' }, true],
      [forward, { id: 'bezel.step', dir: 'forward' }, true],
      [readout, { id: 'bezel.position' }, false],
      [lab?.querySelector<HTMLElement>('.speed input'), { id: 'bezel.speed' }, true],
    ];
    for (const [el, target, acts] of shell) {
      if (!el) continue;
      if (!acts) el.tabIndex = 0; // a readout is not focusable by itself
      shellCards.push(tooltip(el, { ctl, target, acts }));
    }
    // Until the first picture is in, draw nothing (the viz would otherwise show its own stand-in gradient).
    a.patchVizConfig({ panels: toDevicePanels(BLANK_PANELS, 1) });
    if (handedOff) {
      // The tour handed a picture over while the engine was loading: encode that one (if it is
      // still being read, its own load encodes it when it lands). Like any new picture, it waits for Play.
      encode(true, false);
      pushLayout();
      return;
    }
    const fellBack = await loadImage(() => firstPicture, linked.img, linked.block);
    // Rewrite junk in the link to what loaded, but not a link whose picture could not be had.
    if (!fellBack && route.query !== currentQuery()) syncUrl();
  }

  onDestroy(() => {
    ro?.disconnect();
    ro = null;
    if (qualityFrame) cancelAnimationFrame(qualityFrame);
    const stageEl = overlayEl?.closest('.stage') as HTMLElement | null;
    stageEl?.removeEventListener('dragover', onDragOver);
    stageEl?.removeEventListener('drop', onDrop);
    stageCards?.destroy?.();
    for (const card of shellCards) card?.destroy?.();
    shellCards = [];
    window.removeEventListener('resize', pushLayout);
    window.removeEventListener('keydown', onKey);
  });

  const sel = $derived(summary?.selected ?? null);
  const speed = $derived(api?.snapshot.speed ?? DEFAULT_SPEED);
  /** Everything a card may read. Cards never encode or decode: the decoded pixels are the ones above. */
  const explainCtx = $derived.by<ExplainContext>(() => {
    void rdTick;
    return {
      summary,
      stage,
      imageId,
      image,
      decoded,
      quality,
      subsampling,
      huffman,
      customTables,
      speed,
      playing: api?.snapshot.playing ?? false,
      dctK,
      wipe,
      errorGain,
      huffTables,
      segments,
      rd: [...cachedCurve(rdKey(imageTag, subsampling, huffman))],
      otherBytes,
      resave,
      jpeg: jpegBytes,
    };
  });
  /** Dark numbers on light cells. */
  const sampleShade = (v: number) => (v > 150 ? 'dark' : 'light') as 'dark' | 'light';
</script>

<LabShell
  labId="jpeg"
  title="JPEG Compression"
  thesis="Follow one picture, and one 8 × 8 block of it, from pixels to bits and back."
  zoom={false}
  nativeTitles={false}
  firstStep={1}
  transportOff={stage === 'overview' ? OVERVIEW_TRANSPORT_OFF : null}
  {onReady}
>
  {#snippet headerAction()}
    <button
      class="btn how"
      type="button"
      bind:this={howButton}
      onclick={() => (tourOpen = true)}
      use:tooltip={{ ctl, target: { id: 'tour.open' }, acts: true }}>How JPEG works</button
    >
  {/snippet}

  {#snippet controls()}
    <div class="group">
      <span class="name">Picture</span>
      <select
        class="picture"
        aria-label="Picture"
        value={imageId}
        onchange={onPicture}
        bind:this={pictureSelect}
        use:tooltip={{ ctl, target: { id: 'bezel.picture' }, acts: true }}
      >
        {#each GROUPS as group (group)}
          <optgroup label={GROUP_LABELS[group]}>
            {#each IMAGES.filter((im) => im.group === group) as im (im.id)}
              <option value={im.id}>{im.label}</option>
            {/each}
          </optgroup>
        {/each}
        {#if imageId === 'upload'}<option value="upload">Uploaded picture</option>{/if}
      </select>
      <button class="btn" onclick={() => fileInput?.click()} use:tooltip={{ ctl, target: { id: 'bezel.upload' }, acts: true }}>
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
      <input
        type="range"
        min="1"
        max="100"
        step="1"
        value={quality}
        oninput={onQuality}
        onchange={syncUrl}
        aria-label="Quality"
        use:tooltip={{ ctl, target: { id: 'bezel.quality' }, acts: true }}
      />
      <span class="mono value">{quality}</span>
    </label>
    <div class="group" role="radiogroup" aria-labelledby="jpeg-sub-name">
      <span class="name" id="jpeg-sub-name">Chroma</span>
      {#each [['444', '4:4:4'], ['422', '4:2:2'], ['420', '4:2:0']] as [id, label] (id)}
        <label class="btn pill">
          <input
            type="radio"
            name="jpeg-sub"
            value={id}
            checked={subsampling === id}
            onchange={() => setSubsampling(id as SubsamplingId)}
            use:tooltip={{ ctl, target: { id: 'bezel.chroma', mode: id as SubsamplingId }, acts: true }}
          />{label}
        </label>
      {/each}
    </div>
    <div class="group" role="radiogroup" aria-labelledby="jpeg-huff-name">
      <span class="name" id="jpeg-huff-name">Huffman</span>
      <label class="btn pill">
        <input
          type="radio"
          name="jpeg-huff"
          value="optimized"
          checked={huffman === 'optimized'}
          onchange={() => setHuffman('optimized')}
          use:tooltip={{ ctl, target: { id: 'bezel.huffman', mode: 'optimized' }, acts: true }}
        />Optimized
      </label>
      <label class="btn pill">
        <input
          type="radio"
          name="jpeg-huff"
          value="standard"
          checked={huffman === 'standard'}
          onchange={() => setHuffman('standard')}
          use:tooltip={{ ctl, target: { id: 'bezel.huffman', mode: 'standard' }, acts: true }}
        />Standard
      </label>
    </div>
    <button class="btn" onclick={saveJpeg} disabled={!summary?.bytes} use:tooltip={{ ctl, target: { id: 'bezel.save' }, acts: true }}>
      <Icon name="download" />Save .jpg
    </button>
    <div class="row">
      <StageRail current={stage} onselect={setStage} {ctl} />
    </div>
    {#if readout}
      <div class="row stats" aria-live="off">
        {#if customTables}
          <span class="custom-chip">
            <!-- A label that is only text: focusable so the keyboard can reach its card; a click pins it. -->
            <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
            <span class="chip-label" tabindex="0" use:tooltip={{ ctl, target: { id: 'chip.custom' } }}>Custom Q tables</span>
            <button class="chip" onclick={standardTables} use:tooltip={{ ctl, target: { id: 'chip.custom' }, acts: true }}>Standard</button>
          </span>
        {/if}
        <!-- The four figures only explain themselves: focusable, and a click pins the card. -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <span class="stat" tabindex="0" use:tooltip={{ ctl, target: { id: 'readout.size' } }}><span class="mono">{readout.size}</span> of {readout.of}</span>
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <span class="stat" tabindex="0" use:tooltip={{ ctl, target: { id: 'readout.ratio' } }}><span class="mono">{readout.ratio}</span></span>
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <span class="stat" tabindex="0" use:tooltip={{ ctl, target: { id: 'readout.bpp' } }}><span class="mono">{readout.bpp}</span> bits / pixel</span>
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <span class="stat" tabindex="0" use:tooltip={{ ctl, target: { id: 'readout.psnr' } }}>PSNR <span class="mono">{readout.psnr}</span></span>
      </div>
    {/if}
  {/snippet}

  {#snippet overlay()}
    <!-- A coefficient grid: pointer hovers and clicks give cards, and the arrow keys rove from cell to cell. -->
    {#snippet cellGrid(kind: Panel['kind'], r: Rect)}
      {@const mark = cells(r, window.devicePixelRatio || 1)[rove[0] + 8 * rove[1]]}
      <!-- A roving-cell group: focusable so the keyboard can explore the numbers; its cards come from the tooltip action. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <div
        class="hover-area"
        role="group"
        tabindex="0"
        aria-label="{layout.panels.find((p) => p.kind === kind)?.label}. The arrow keys move between cells."
        style:left="{r.x}px"
        style:top="{r.y}px"
        style:width="{r.w}px"
        style:height="{r.h}px"
        onpointermove={(e) => onCellHover(e, r)}
        onpointerdown={(e) => onCellHover(e, r)}
        onpointerleave={onHoverLeave}
        onkeydown={onGridKey}
        onfocus={onGridFocus}
        onblur={onGridBlur}
        use:tooltip={{ ctl, target: hitTarget, keyTarget: () => cellTarget(stage, kind, rove[0], rove[1]) }}
      >
        <span class="rove" style:left="{mark.x - r.x}px" style:top="{mark.y - r.y}px" style:width="{mark.w}px" style:height="{mark.h}px"></span>
      </div>
    {/snippet}

    <div class="marks" bind:this={overlayEl}>
      {#each layout.panels as p (p.kind)}
        <span class="caption" style:left="{p.rect.x}px" style:top="{p.rect.y - 20}px" style:max-width="{Math.max(p.rect.w, CAPTION_MIN)}px">{p.label}</span>
      {/each}
      {#if layout.image.w > 0 && stage !== 'overview'}
        <button
          class="hit"
          aria-label="Pick a block: click it, or use the arrow keys to move the selected block"
          style:left="{layout.image.x}px"
          style:top="{layout.image.y}px"
          style:width="{layout.image.w}px"
          style:height="{layout.image.h}px"
          onclick={onImageClick}
          onkeydown={onImageKey}
          use:tooltip={{ ctl, target: hitTarget, acts: true, keyTarget: followedPixel }}
        ></button>
      {/if}

      {#if stage === 'color' || stage === 'subsample'}
        {#each layout.panels.filter((p) => COLOUR_PANELS.has(p.kind)) as p (p.kind)}
          <!-- Keyboard only: focusable so the keys can reach the panel's card; the pointer passes through to the canvas (which hit-tests it, and orbits the cube). -->
          <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
          <div
            class="hover-area"
            role="img"
            tabindex="0"
            aria-label={p.label}
            style:left="{p.rect.x}px"
            style:top="{p.rect.y}px"
            style:width="{p.rect.w}px"
            style:height="{p.rect.h}px"
            style:pointer-events="none"
            use:tooltip={{ ctl, target: hitTarget, keyTarget: () => panelKey(p.kind) }}
          ></div>
        {/each}
      {/if}

      {#if stage === 'overview' || stage === 'decode'}
        {#each layout.panels.filter((p) => COMPARE_PANELS.has(p.kind)) as p (p.kind)}
          <!-- Keyboard only: focusable so the keys can reach the picture's card; the pointer passes through to the canvas, which hit-tests it. -->
          <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
          <div
            class="hover-area"
            role="img"
            tabindex="0"
            aria-label={p.label}
            style:left="{p.rect.x}px"
            style:top="{p.rect.y}px"
            style:width="{p.rect.w}px"
            style:height="{p.rect.h}px"
            style:pointer-events="none"
            use:tooltip={{ ctl, target: hitTarget, keyTarget: () => panelKey(p.kind) }}
          ></div>
        {/each}
      {/if}

      {#if stage === 'overview' && layout.slots.stats && image}
        <Overview rect={layout.slots.stats} {image} jpeg={jpegBytes} {quality} custom={customTables !== null} {credit} errors={alerts} {ctl} />
      {/if}

      {#if stage === 'color' && panel('cube')}
        {@const r = panel('cube')!}
        <label class="ctl" style:left="{r.x}px" style:top="{r.y + r.h - 34}px" style:width="{r.w}px">
          <span>RGB axes</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={cubeMix}
            oninput={onCubeMix}
            aria-label="RGB axes to YCbCr axes"
            use:tooltip={{ ctl, target: { id: 'color.axes' }, acts: true }}
          />
          <span>YCbCr axes</span>
        </label>
      {/if}

      {#if stage === 'blocks' && panel('block') && sel}
        {@const r = panel('block')!}
        {@render cellGrid('block', r)}
        <CellNumbers rect={r} values={showShifted ? sel.shifted : sel.pixels} shade={(v) => sampleShade(showShifted ? v + 128 : v)} />
        <div class="ctl tools" style:left="{r.x}px" style:top="{r.y + r.h + 10}px">
          {#each ['Y', 'Cb', 'Cr'] as name, c (name)}
            <button
              class="chip"
              aria-pressed={component === c}
              onclick={() => setComponent(c)}
              use:tooltip={{ ctl, target: { id: 'blocks.component' }, acts: true }}>{name}</button
            >
          {/each}
          <button
            class="chip"
            aria-pressed={showShifted}
            onclick={() => (showShifted = !showShifted)}
            use:tooltip={{ ctl, target: { id: 'blocks.shift' }, acts: true }}>− 128</button
          >
        </div>
      {/if}

      {#if stage === 'dct' && sel}
        {#each ['atlas', 'coeffs'] as kind (kind)}
          {@const r = panel(kind as Panel['kind'])}
          {#if r}
            {@render cellGrid(kind as Panel['kind'], r)}
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
        <DctCharts rect={layout.slots.charts ?? { x: 0, y: 0, w: 0, h: 0 }} dct={sel.dct} shifted={sel.shifted} k={dctK} {ctl} />
      {/if}

      {#if stage === 'quantize' && sel}
        {#each ['coeffs', 'quant'] as kind (kind)}
          {@const r = panel(kind as Panel['kind'])}
          {#if r}
            {@render cellGrid(kind as Panel['kind'], r)}
            <CellNumbers rect={r} values={kind === 'coeffs' ? sel.dct : sel.quant} minCell={20} />
          {/if}
        {/each}
        {#if layout.slots.qtable}
          <QTable
            rect={layout.slots.qtable}
            table={sel.table}
            which={sel.component === 0 ? 'Luma' : 'Chroma'}
            custom={customTables !== null}
            {ctl}
            onapply={applyTable}
            onstandard={standardTables}
          />
        {/if}
        {#if layout.slots.rd && image}
          <RdChart
            rect={layout.slots.rd}
            {image}
            {imageTag}
            {subsampling}
            {huffman}
            current={{ bytes: summary?.bytes ?? 0, psnr: summary?.psnr ?? null, quality: summary?.quality ?? quality }}
            {ctl}
            onsweep={() => rdTick++}
          />
        {/if}
      {/if}

      {#if stage === 'zigzag' && sel}
        {#if panel('zigzag')}
          {@render cellGrid('zigzag', panel('zigzag')!)}
          <CellNumbers rect={panel('zigzag')!} values={sel.quant} />
        {/if}
        {#if layout.slots.sequence}
          <ZigzagStrip rect={layout.slots.sequence} zigzag={sel.zigzag} reached={zigReached} {ctl} />
        {/if}
      {/if}

      {#if stage === 'rle' && sel}
        {#if panel('quant')}
          <CellNumbers rect={panel('quant')!} values={sel.quant} minCell={20} />
        {/if}
        {#if layout.slots.tokens}
          <TokenChips rect={layout.slots.tokens} {sel} {ctl} />
        {/if}
      {/if}

      {#if stage === 'huffman' && layout.slots.huffman}
        <HuffmanView
          rect={layout.slots.huffman}
          tables={huffTables}
          {segments}
          {sel}
          {otherBytes}
          bytes={summary?.bytes ?? 0}
          {huffman}
          {ctl}
        />
      {/if}

      {#if stage === 'decode' && layout.slots.resave && image}
        <DecodeTools
          rect={layout.slots.resave}
          {image}
          {quality}
          {subsampling}
          {huffman}
          hints={summary?.hints ?? null}
          custom={customTables !== null}
          {wipe}
          gain={errorGain}
          onwipe={onWipe}
          ongain={onGain}
          onpick={pickBlock}
          {ctl}
          bind:history={resave}
        />
      {/if}

      <!-- On the overview the messages are the first row of its stats, where they hide nothing. -->
      {#if !overviewShown}
        {#if loadError}
          <p class="error" role="alert">{loadError}</p>
        {/if}
        {#if summary?.error}
          <p class="error" role="alert">This image could not be encoded: {summary.error}</p>
        {/if}
      {/if}
    </div>
  {/snippet}

  {#snippet story()}
    <!-- The tour and the cards move themselves to the end of <body>, clear of the lab's stacking and story styles, so the page header never covers them. -->
    {#if tourOpen}
      <JpegTour {imageId} {image} {quality} {subsampling} {huffman} {ctl} onclose={onTourClose} />
    {/if}
    <TooltipHost {ctl} ctx={explainCtx} />
    <section class="stage-card" aria-live="polite">
      <h2><span class="mark">{stageInfo.mark}</span> {stageInfo.title}</h2>
      <p class="sub">{stageInfo.subtitle}</p>
      {#each stageTex(stage, summary, hover) as tex, ti}
        {#if stage === 'subsample' && ti === 1}
          <!-- The "samples kept" figure explains itself. -->
          <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
          <div class="kept" tabindex="0" use:tooltip={{ ctl, target: { id: 'subsample.kept' } }}><Tex {tex} /></div>
        {:else}
          <Tex {tex} />
        {/if}
      {/each}
      <p class="tip">{NOTICE[stage]}</p>
      {#if stage === 'overview' && credit}
        <!-- The overview's own credit line gives way on a short stage; this one is always there. -->
        <p class="credit">
          {#if credit.url}<a href={credit.url} target="_blank" rel="noopener noreferrer">{credit.title}</a>{:else}{credit.title}{/if}
          · {credit.author} · {credit.licence}
        </p>
      {/if}
      {#if stage === 'overview'}
        <button class="step-btn" onclick={() => setStage('color')}>Step 1: Color</button>
      {/if}
    </section>

    {#if stage === 'overview'}
      <h2>Pictures</h2>
      <Gallery current={imageId} onpick={(id) => void chooseImage(id)} onupload={() => fileInput?.click()} {ctl} />
    {/if}

    <h2>How it works</h2>
    <p>
      A JPEG file is the picture written as a recipe, not as pixels. The encoder turns colours into
      brightness and two colour differences, keeps less of the colour, cuts each plane into 8 × 8 blocks,
      rewrites every block as a weighted sum of 64 cosine patterns, rounds those weights coarsely, and
      packs what is left into as few bits as it can.
    </p>
    <p class="tip">
      On stages 1–9, Play runs the scan block by block: the picture fills in as it would arrive over a slow connection,
      and the panels follow each block as it is scanned. Clicking a block on the picture, or moving with the arrow keys
      there, puts the scan on that block. The left and right arrow keys elsewhere move between stages, the overview
      included.
    </p>
    <p class="shoutout">
      A shout-out to Reducible, whose video
      <a href="https://www.youtube.com/watch?v=0me3guauqOU&t=1711s" target="_blank" rel="noopener noreferrer"
        >The Unreasonable Effectiveness of JPEG</a
      > walks through these same steps with beautiful animations. Well worth a watch.
    </p>
  {/snippet}
</LabShell>

<style>
  .file { display: none; }
  .quality input { width: 140px; }
  .quality .value { width: 3ch; text-align: right; color: var(--ink); }
  .name { color: var(--stone); font-size: 14px; }
  .picture {
    height: 36px;
    max-width: 220px;
    padding: 0 10px;
    border: 1px solid var(--line);
    border-radius: var(--radius-button);
    background: var(--paper);
    color: var(--ink);
    font-size: 14px;
    font-weight: 500;
  }
  .picture:hover { border-color: var(--stone); }
  /* Radio inputs drawn as pills, as in the Notes lab. */
  .pill { position: relative; }
  .pill input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
  .pill:has(input:checked) { border-color: var(--accent); background: var(--tint); }
  .pill:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
  /* The rail and the readout each take a whole row, after the shell's speed slider. */
  .row { flex-basis: 100%; min-width: 0; max-width: 100%; order: 1; }
  .stats { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 22px; }
  .custom-chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 0 4px 0 10px;
    border: 1px solid var(--accent);
    border-radius: 999px;
    background: var(--tint);
    font-size: 13px;
  }
  .custom-chip .chip { height: 24px; border-color: var(--stone); background: transparent; color: var(--ink); }

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
  .kept:focus-visible { outline: 1px dashed var(--accent); outline-offset: 2px; }
  .hover-area:focus-visible { outline: 1px dashed var(--accent); outline-offset: 2px; }
  /* The cell the arrow keys are on; shown only while the grid has the keyboard. */
  .rove { display: none; position: absolute; box-sizing: border-box; border: 2px solid var(--accent); pointer-events: none; }
  .hover-area:focus-visible .rove { display: block; }
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
  .credit { margin: 0 0 16px; color: var(--stone); font-size: 14px; }
  .credit a { color: inherit; text-decoration: underline; }
  .shoutout a { color: inherit; text-decoration: underline; }
  .step-btn {
    height: 40px;
    padding: 0 18px;
    border: 1px solid var(--accent);
    border-radius: var(--radius-button);
    background: var(--accent);
    color: var(--paper);
    font-size: 15px;
    font-weight: 500;
    cursor: pointer;
  }
  .step-btn:hover { background: var(--accent-deep); border-color: var(--accent-deep); }
  .step-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
