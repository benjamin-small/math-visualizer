<script lang="ts">
  // The overview's numbers: how big the file is against the raw pixels (two
  // bars to scale), then three byte histograms read left to right as a story.
  // Raw pixel bytes already look random; neighbour differences pile up near 0,
  // which is where the pattern hides; the JPEG file looks random again, but
  // there are far fewer bytes of it. Each histogram carries its Shannon
  // entropy in bits per byte. The pictures themselves are drawn by the viz.
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

  /** The bar heights of a histogram, scaled so the tallest bin fills `H`. */
  function bars(hist: Uint32Array): number[] {
    let top = 1;
    for (const c of hist) if (c > top) top = c;
    return Array.from(hist, (c) => (c / top) * H);
  }
</script>

{#if rect.w > 160 && rect.h > 80}
  <div class="overview" style:left="{rect.x}px" style:top="{rect.y}px" style:width="{rect.w}px" style:height="{rect.h}px">
    <div class="sizes" aria-label="File size against the raw pixels">
      <div class="size">
        <span class="bar raw" style:width="100%"></span>
        <span class="what">Raw pixels <span class="mono">{formatBytes(rawBytes)}</span></span>
      </div>
      <div class="size">
        {#if jpeg}
          <span class="bar file" style:width="{jpegShare * 100}%"></span>
          <span class="what">JPEG <span class="mono">{formatBytes(jpegBytes)}</span> <span class="mono ratio">{ratio}</span></span>
        {:else}
          <span class="what">JPEG: encoding</span>
        {/if}
      </div>
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

    <p class="caption">
      At quality {quality} the file is {jpeg ? `${((100 * jpegBytes) / rawBytes).toFixed(1)}%` : 'a fraction'} of the raw size. Move the Quality slider and watch the
      right-hand picture and the last histogram change.
    </p>
    {#if credit}
      <p class="credit">
        {#if credit.url}<a href={credit.url} target="_blank" rel="noopener noreferrer">{credit.title}</a>{:else}{credit.title}{/if}
        · {credit.author} · {credit.licence}
      </p>
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
  .sizes { display: flex; flex-direction: column; gap: 4px; }
  .size { position: relative; height: 18px; border-radius: 3px; overflow: hidden; }
  .bar { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 3px; }
  .bar.raw { background: rgba(255, 255, 255, 0.16); }
  .bar.file { background: var(--accent); opacity: 0.85; }
  .what { position: relative; padding-left: 8px; line-height: 18px; white-space: nowrap; color: #fff; }
  .ratio { margin-left: 6px; color: #fff; }

  .charts { display: flex; flex: 1 1 0; min-height: 0; gap: 14px; }
  figure { display: flex; flex-direction: column; flex: 1 1 0; min-width: 0; margin: 0; gap: 2px; }
  figcaption { display: flex; flex-wrap: wrap; justify-content: space-between; column-gap: 8px; white-space: nowrap; }
  .name { color: rgba(255, 255, 255, 0.9); }
  svg { display: block; flex: 1 1 0; min-height: 24px; width: 100%; }
  rect { fill: rgba(255, 255, 255, 0.55); }
  rect.accent { fill: var(--accent); }
  .axis { display: flex; justify-content: space-between; font-size: 10px; color: rgba(255, 255, 255, 0.45); }

  .caption, .credit { margin: 0; line-height: 1.4; }
  .credit { font-size: 11px; color: rgba(255, 255, 255, 0.55); }
  .credit a { color: inherit; text-decoration: underline; }
</style>
