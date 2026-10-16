<script lang="ts">
  // The overview's numbers: how big the file is against the raw pixels (two
  // bars to scale), then three byte histograms read left to right as a story.
  // Raw pixel bytes already look random; neighbour differences pile up near 0,
  // which is where the pattern hides; the JPEG file looks random again, but
  // there are far fewer bytes of it. Each histogram carries its Shannon
  // entropy in bits per byte. The pictures themselves are drawn by the viz.
  //
  // The slot has a fixed size, so the parts are budgeted against it: the sizes
  // and the three histograms always show, the credit is next, and the caption
  // goes first when the slot is too short. Wide slots put the histograms side
  // by side; narrow ones (phones) stack them, one per row.
  import type { Rect } from '../../jpeg/layout';
  import type { Credit, RgbaImage } from '../../jpeg/images';
  import { entropyBits, histogram, neighbourDiffs, rgbSamples } from '../../jpeg/bytes';
  import { formatBytes } from '../../jpeg/summary';

  interface Props {
    /** The slot the overview fills, in CSS pixels, canvas-local. */
    rect: Rect;
    /** The picture on screen. */
    image: RgbaImage;
    /** The encoded file, or null before the first encode. */
    jpeg: Uint8Array | null;
    /** The quality setting the file was made at. */
    quality: number;
    /** Who made the picture, for a bundled one. */
    credit?: Credit;
  }

  let { rect, image, jpeg, quality, credit }: Props = $props();

  /** Height of a histogram's drawing, in viewBox units; the bars scale to the tallest bin. */
  const H = 100;
  /** Below this slot width the histograms stack, one per row. */
  const NARROW = 520;
  /** Gap between the parts, and the sizes block's height (two bars and the gap between them). */
  const GAP = 8;
  const SIZES = 40;
  /** The least the histograms need: three stacked rows, or one row of side-by-side figures (heading, chart, axis). */
  const STACKED = 3 * 44 + 2 * 6;
  const SIDE_BY_SIDE = 92;
  /** Line height and average glyph width (px) of the small text, for estimating how many lines it takes. */
  const LINE = 17;
  const CHAR = 6.2;

  // The pixel histograms only move with the picture; the file's only with the file.
  const raw = $derived(histogram(rgbSamples(image.rgba)));
  const diffs = $derived(histogram(neighbourDiffs(image.rgba, image.w, image.h)));
  const file = $derived(jpeg ? histogram(jpeg) : null);

  const rawBytes = $derived(image.w * image.h * 3);
  const jpegBytes = $derived(jpeg?.length ?? 0);
  const ratio = $derived(jpegBytes > 0 ? `${(rawBytes / jpegBytes).toFixed(1)} : 1` : '');
  /** The JPEG bar's width as a share of the raw bar's, never thinner than a sliver. */
  const jpegShare = $derived(jpegBytes > 0 ? Math.max(0.004, Math.min(1, jpegBytes / rawBytes)) : 0);

  const charts = $derived([
    { key: 'raw', name: 'Raw bytes', hist: raw, accent: false },
    { key: 'diff', name: 'Neighbour differences', hist: diffs, accent: false },
    { key: 'jpeg', name: 'JPEG file', hist: file, accent: true },
  ]);

  const caption = $derived(
    `At quality ${quality} the file is ${jpeg ? `${((100 * jpegBytes) / rawBytes).toFixed(1)}%` : 'a fraction'} of the raw size. ` +
      'Small negative differences wrap round to 255, so the middle histogram peaks at both edges.',
  );
  const creditText = $derived(credit ? `${credit.title} · ${credit.author} · ${credit.licence}` : '');

  const narrow = $derived(rect.w < NARROW);
  /** Height of `text` set across the slot, estimated from its length. */
  const textH = (text: string, px: number) => Math.ceil((text.length * px) / Math.max(1, rect.w)) * LINE;
  const baseH = $derived(SIZES + GAP + (narrow ? STACKED : SIDE_BY_SIDE));
  const creditH = $derived(creditText ? GAP + textH(creditText, CHAR * 0.92) : 0);
  const captionH = $derived(GAP + textH(caption, CHAR));
  const showCredit = $derived(creditText !== '' && rect.h >= baseH + creditH);
  const showCaption = $derived(rect.h >= baseH + (showCredit ? creditH : 0) + captionH);

  /** The bar heights of a histogram, scaled so the tallest bin fills `H`. */
  function bars(hist: Uint32Array): number[] {
    let top = 1;
    for (const c of hist) if (c > top) top = c;
    return Array.from(hist, (c) => (c / top) * H);
  }
</script>

{#if rect.w > 160 && rect.h > 80}
  <div class="overview" class:narrow style:left="{rect.x}px" style:top="{rect.y}px" style:width="{rect.w}px" style:height="{rect.h}px">
    <div class="sizes" role="group" aria-label="File size against the raw pixels">
      <div class="track"><span class="bar raw" style:width="100%"></span></div>
      <span class="what">Raw pixels <span class="mono">{formatBytes(rawBytes)}</span></span>
      <div class="track">{#if jpeg}<span class="bar file" style:width="{jpegShare * 100}%"></span>{/if}</div>
      <span class="what">
        {#if jpeg}JPEG <span class="mono">{formatBytes(jpegBytes)}</span> <span class="mono ratio">{ratio}</span>{:else}JPEG: encoding{/if}
      </span>
    </div>

    <div class="charts">
      {#each charts as c (c.key)}
        <figure>
          <figcaption>
            <span class="name">{c.name}</span>
            {#if c.hist}
              <span class="entropy"><span class="mono">{entropyBits(c.hist).toFixed(2)}</span> bits / byte</span>
            {/if}
          </figcaption>
          <svg viewBox="0 0 256 {H}" preserveAspectRatio="none" role="img" aria-label="{c.name}: how often each byte value occurs">
            {#if c.hist}
              {#each bars(c.hist) as h, i (i)}
                {#if h > 0}<rect class:accent={c.accent} x={i} y={H - h} width="1" height={h} />{/if}
              {/each}
            {/if}
          </svg>
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

  /* Side by side on a wide slot; the figures share the height the sizes and text leave. */
  .charts { display: flex; flex: 1 1 auto; gap: 14px; min-height: 0; overflow: hidden; }
  figure { display: flex; flex-direction: column; flex: 1 1 0; min-width: 0; margin: 0; gap: 2px; }
  figcaption { display: flex; flex-wrap: wrap; justify-content: space-between; column-gap: 8px; }
  .name { color: rgba(255, 255, 255, 0.9); }
  svg { display: block; flex: 1 1 0; min-height: 30px; width: 100%; }
  rect { fill: rgba(255, 255, 255, 0.55); }
  rect.accent { fill: var(--accent); }
  .axis { display: flex; justify-content: space-between; font-size: 10px; line-height: 12px; color: rgba(255, 255, 255, 0.45); }

  /* Stacked on a phone: the heading at the left of each row, the chart and its axis at the right. */
  .narrow .charts { flex-direction: column; gap: 6px; }
  .narrow figure {
    display: grid;
    grid-template-columns: 112px 1fr;
    grid-template-rows: 1fr auto;
    column-gap: 8px;
    row-gap: 0;
    flex: 1 1 0;
    min-height: 44px;
  }
  .narrow figcaption { grid-row: 1 / 3; flex-direction: column; justify-content: flex-start; }
  .narrow svg { grid-column: 2; grid-row: 1; min-height: 30px; }
  .narrow .axis { grid-column: 2; grid-row: 2; }

  .caption, .credit { margin: 0; line-height: 1.4; flex: none; }
  .credit { font-size: 11px; color: rgba(255, 255, 255, 0.55); }
  .credit a { color: inherit; text-decoration: underline; }
</style>
