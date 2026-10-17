<script lang="ts">
  // The overview's numbers: how big the file is against the raw pixels (two
  // bars to scale), then three byte histograms read left to right as a story.
  // Raw pixel bytes already look random; neighbour differences pile up near 0,
  // which is where the pattern hides; the JPEG file looks random again, but
  // there are far fewer bytes of it. Each histogram carries its Shannon
  // entropy in bits per byte. The pictures themselves are drawn by the viz.
  //
  // The slot has a fixed size. The sizes and the three histograms always show,
  // each histogram keeping a minimum height of its own; the credit and the
  // caption are laid out too, then measured: if they push the content past the
  // slot, the caption is dropped first, then the credit, then the size bars. Wide slots put the
  // histograms side by side; narrow ones (phones) stack them, one per row.
  import { tick, untrack } from 'svelte';
  import type { Rect } from '../../jpeg/layout';
  import type { Credit, RgbaImage } from '../../jpeg/images';
  import { entropyBits, histogram, neighbourDiffs, rgbSamples } from '../../jpeg/bytes';
  import { formatBytes } from '../../jpeg/summary';
  import type { Target } from '../../jpeg/explain';
  import { tooltip, type TooltipController } from './tooltip.svelte';

  interface Props {
    /** The slot the overview fills, in CSS pixels, canvas-local. */
    rect: Rect;
    /** The picture on screen. */
    image: RgbaImage;
    /** The encoded file, or null before the first encode. */
    jpeg: Uint8Array | null;
    /** The quality setting the file was made at. */
    quality: number;
    /** Custom quantization tables are in use, so the quality setting no longer sizes the file. */
    custom?: boolean;
    /** Who made the picture, for a bundled one. */
    credit?: Credit;
    /** Messages to show at the top (a picture that would not load, an encode that failed). */
    errors?: string[];
    /** The page's cards: the size bars, each histogram bar and the entropy figures explain themselves. */
    ctl: TooltipController;
  }

  let { rect, image, jpeg, quality, custom = false, credit, errors = [], ctl }: Props = $props();

  /** Height of a histogram's drawing, in viewBox units; the bars scale to the tallest bin. */
  const H = 100;
  /** Below this slot width the histograms stack, one per row. */
  const NARROW = 520;
  // The pixel histograms only move with the picture; the file's only with the file.
  const raw = $derived(histogram(rgbSamples(image.rgba)));
  const diffs = $derived(histogram(neighbourDiffs(image.rgba, image.w, image.h)));
  const file = $derived(jpeg ? histogram(jpeg) : null);

  const rawBytes = $derived(image.w * image.h * 3);
  const jpegBytes = $derived(jpeg?.length ?? 0);
  const ratio = $derived(jpegBytes > 0 ? `${(rawBytes / jpegBytes).toFixed(1)} : 1` : '');
  /** The JPEG bar's width as a share of the raw bar's, never thinner than a sliver. */
  const jpegShare = $derived(jpegBytes > 0 ? Math.max(0.004, Math.min(1, jpegBytes / rawBytes)) : 0);

  const charts = $derived<{ key: Key; name: string; hist: Uint32Array | null; accent: boolean }[]>([
    { key: 'raw', name: 'Raw bytes', hist: raw, accent: false },
    { key: 'diff', name: 'Neighbour differences', hist: diffs, accent: false },
    { key: 'jpeg', name: 'JPEG file', hist: file, accent: true },
  ]);

  const caption = $derived(
    `${custom ? 'With custom tables' : `At quality ${quality}`} the file is ${jpeg ? `${((100 * jpegBytes) / rawBytes).toFixed(1)}%` : 'a fraction'} of the raw size. ` +
      'Small negative differences wrap round to 255, so the middle histogram can peak at both edges.',
  );
  const creditText = $derived(credit ? `${credit.title} · ${credit.author} · ${credit.licence}` : '');

  const narrow = $derived(rect.w < NARROW);

  let box = $state<HTMLDivElement | null>(null);
  let showCredit = $state(true);
  let showCaption = $state(true);
  let showSizes = $state(true);

  // Lay everything out, then drop what does not fit (caption first, then credit).
  $effect(() => {
    void [rect.w, rect.h, narrow, caption, creditText, errors.length];
    const el = box;
    if (!el) return;
    let alive = true;
    untrack(() => {
      showCredit = true;
      showCaption = true;
      showSizes = true;
      void (async () => {
        await tick();
        const over = () => el.scrollHeight > el.clientHeight + 1;
        if (alive && over()) {
          showCaption = false;
          await tick();
        }
        if (alive && over()) {
          showCredit = false;
          await tick();
        }
        if (alive && over()) showSizes = false; // last resort, on a very short slot with a message showing
      })();
    });
    return () => {
      alive = false;
    };
  });

  type Key = 'raw' | 'diff' | 'jpeg';
  /** The bin the pointer is over, and the one the arrow keys have reached (null until they move), per histogram. */
  let over = $state<Record<Key, number | null>>({ raw: null, diff: null, jpeg: null });
  let rove = $state<Record<Key, number | null>>({ raw: null, diff: null, jpeg: null });

  /** The byte value under a pointer event on a histogram: its width is the 256 values. */
  function binAt(e: MouseEvent): number | null {
    const box = (e.currentTarget as Element).getBoundingClientRect();
    if (!(box.width > 0)) return null;
    return Math.min(255, Math.max(0, Math.floor(((e.clientX - box.left) / box.width) * 256)));
  }

  /** The tallest bin: where the keyboard starts. */
  function peak(hist: Uint32Array): number {
    let best = 0;
    for (let i = 1; i < hist.length; i++) if (hist[i] > hist[best]) best = i;
    return best;
  }

  const pointed = (key: Key, hist: Uint32Array | null) => (e: MouseEvent): Target | null => {
    const bin = hist ? binAt(e) : null;
    return bin === null ? null : { id: 'overview.hist', kind: key, bin };
  };
  const keyed = (key: Key, hist: Uint32Array | null) => (): Target | null =>
    hist ? { id: 'overview.hist', kind: key, bin: rove[key] ?? peak(hist) } : null;

  /** Left and right walk the byte values (shift or page keys: sixteen at a time); the chart's card follows. */
  function onBinKey(e: KeyboardEvent, key: Key, hist: Uint32Array | null) {
    if (!hist || e.altKey || e.metaKey || e.ctrlKey) return;
    const here = rove[key] ?? peak(hist);
    const jump: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, PageUp: -16, PageDown: 16 };
    let next: number;
    if (e.key in jump) next = here + jump[e.key] * (e.shiftKey && Math.abs(jump[e.key]) === 1 ? 16 : 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = 255;
    else return;
    e.preventDefault(); // not also a stage switch or a page scroll
    rove[key] = Math.min(255, Math.max(0, next));
  }

  /** The bar heights of a histogram, scaled so the tallest bin fills `H`. */
  function bars(hist: Uint32Array): number[] {
    let top = 1;
    for (const c of hist) if (c > top) top = c;
    return Array.from(hist, (c) => (c / top) * H);
  }
</script>

{#if rect.w > 160 && rect.h > 80}
  <div class="overview" class:narrow bind:this={box} style:left="{rect.x}px" style:top="{rect.y}px" style:width="{rect.w}px" style:height="{rect.h}px">
    {#each errors as message (message)}
      <p class="alert" role="alert">{message}</p>
    {/each}
    {#if showSizes}
    <!-- The two bars explain themselves together: focusable, and a click pins the card. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="sizes" role="group" tabindex="0" aria-label="File size against the raw pixels" use:tooltip={{ ctl, target: { id: 'overview.sizes' } }}>
      <div class="track"><span class="bar raw" style:width="100%"></span></div>
      <span class="what">Raw pixels <span class="mono">{formatBytes(rawBytes)}</span></span>
      <div class="track">{#if jpeg}<span class="bar file" style:width="{jpegShare * 100}%"></span>{/if}</div>
      <span class="what">
        {#if jpeg}JPEG <span class="mono">{formatBytes(jpegBytes)}</span> <span class="mono ratio">{ratio}</span>{:else}JPEG: encoding{/if}
      </span>
    </div>
    {/if}

    <div class="charts">
      {#each charts as c (c.key)}
        <figure>
          <figcaption>
            <span class="name">{c.name}</span>
            {#if c.hist}
              <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
              <span class="entropy" tabindex="0" use:tooltip={{ ctl, target: { id: 'overview.entropy', kind: c.key } }}><span class="mono">{entropyBits(c.hist).toFixed(2)}</span> bits / byte</span>
            {/if}
          </figcaption>
          <div class="plot">
            <!-- A focusable chart: the pointer's x is the byte value, and the arrow keys walk the values. -->
            <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
            <svg
              viewBox="0 0 256 {H}"
              preserveAspectRatio="none"
              role="group"
              aria-roledescription="chart"
              tabindex={c.hist ? 0 : -1}
              aria-label="{c.name}: how often each byte value occurs. The arrow keys move between values."
              onpointermove={(e) => (over[c.key] = c.hist ? binAt(e) : null)}
              onpointerleave={() => (over[c.key] = null)}
              onkeydown={(e) => onBinKey(e, c.key, c.hist)}
              onblur={() => (rove[c.key] = null)}
              use:tooltip={{ ctl, target: pointed(c.key, c.hist), keyTarget: keyed(c.key, c.hist) }}
            >
              {#if c.hist}
                {#each bars(c.hist) as h, i (i)}
                  {#if h > 0}<rect class:accent={c.accent} x={i} y={H - h} width="1" height={h} />{/if}
                {/each}
                {@const mark = over[c.key] ?? rove[c.key]}
                {#if mark !== null}<rect class="mark" x={mark} y="0" width="1" height={H} />{/if}
              {/if}
            </svg>
          </div>
          <div class="axis mono"><span>0</span><span>byte value</span><span>255</span></div>
        </figure>
      {/each}
    </div>

    {#if showCredit && credit}
      <p class="credit">
        {#if credit.url}<a href={credit.url} target="_blank" rel="noopener noreferrer">{credit.title}</a>{:else}{credit.title}{/if}
        · {credit.author} · {credit.licence}
      </p>
    {/if}
    {#if showCaption}
      <p class="caption">{caption}</p>
    {/if}
  </div>
{/if}

<style>
  .overview {
    position: absolute;
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow: hidden;
    color: rgba(255, 255, 255, 0.72);
    font-size: 12px;
    pointer-events: auto;
  }

  /* Bars to scale on the left; each label sits in its own column beside its bar, never inside it. */
  .sizes { display: grid; grid-template-columns: 1fr max-content; align-items: center; gap: 4px 10px; flex: none; }
  .track { height: 18px; }
  .bar { display: block; height: 100%; border-radius: 3px; }
  .bar.raw { background: rgba(255, 255, 255, 0.22); }
  .bar.file { background: var(--accent); opacity: 0.9; }
  .what { color: #fff; white-space: nowrap; line-height: 18px; }
  .ratio { margin-left: 4px; }

  /* The charts never shrink below their own minimum (the overflow check drops the text instead), so nothing overlaps. */
  .charts { display: flex; flex: 1 1 auto; gap: 14px; min-height: 92px; }
  figure { display: flex; flex-direction: column; flex: 1 1 0; min-width: 0; margin: 0; gap: 2px; }
  figcaption { display: flex; flex-wrap: wrap; justify-content: space-between; column-gap: 8px; line-height: 16px; }
  .name { color: rgba(255, 255, 255, 0.9); }
  /* The drawing is taken out of the flow, so its aspect ratio cannot decide the row's height. */
  .plot { position: relative; flex: 1 1 0; min-height: 30px; min-width: 0; }
  svg { position: absolute; inset: 0; width: 100%; height: 100%; }
  rect { fill: rgba(255, 255, 255, 0.55); }
  rect.accent { fill: var(--accent); }
  /* The byte value being pointed at or reached by the keys: a pale column over the bars. */
  rect.mark { fill: #fff; opacity: 0.35; pointer-events: none; }
  svg:focus-visible, .sizes:focus-visible, .entropy:focus-visible { outline: 1px dashed var(--accent); outline-offset: 2px; }
  .axis { display: flex; justify-content: space-between; font-size: 10px; line-height: 12px; color: rgba(255, 255, 255, 0.45); }

  /* Stacked on a phone: the heading at the left of each row (up to three lines), the chart and its axis at the right. */
  .narrow .charts { flex-direction: column; gap: 6px; min-height: 156px; }
  .narrow figure {
    display: grid;
    grid-template-columns: 112px minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) auto;
    column-gap: 8px;
    row-gap: 0;
    flex: 1 1 0;
    min-height: 48px;
  }
  .narrow figcaption { grid-row: 1 / 3; flex-direction: column; justify-content: flex-start; }
  .narrow .plot { grid-column: 2; grid-row: 1; min-height: 0; }
  .narrow .axis { grid-column: 2; grid-row: 2; }

  .alert { margin: 0; padding: 4px 8px; flex: none; border-radius: 6px; background: rgba(0, 0, 0, 0.6); color: #ffb4a0; line-height: 1.35; }
  .caption, .credit { margin: 0; line-height: 1.4; flex: none; }
  .credit { font-size: 11px; color: rgba(255, 255, 255, 0.55); }
  .credit a { color: inherit; text-decoration: underline; }
</style>
