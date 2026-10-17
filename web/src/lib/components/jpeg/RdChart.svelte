<script lang="ts">
  // The rate–distortion curve for the current picture and settings: file
  // size against PSNR for every quality from 1 to 100, with a dot where the
  // slider is. The sweep runs through the kit a few encodes per frame (as many as fit in a short time budget) and is
  // cached, so returning to a picture is instant.
  import { onDestroy } from 'svelte';
  import { loadVizCore } from '../../wasm/loader';
  import type { Rect } from '../../jpeg/layout';
  import type { RgbaImage } from '../../jpeg/images';
  import { RD_PSNR_CAP, addPoint, cachedCurve, missing, rdKey, rdPolyline, sweepFrame, type RdPoint } from '../../jpeg/rd';
  import type { Target } from '../../jpeg/explain';
  import { tooltip, type TooltipController } from './tooltip.svelte';

  interface Props {
    rect: Rect;
    image: RgbaImage;
    /** Identifies the picture for the cache (the image id, or a tag per upload). */
    imageTag: string;
    subsampling: string;
    huffman: string;
    /** The current encode: where the dot goes, and the quality it was made at. */
    current: { bytes: number; psnr: number | null; quality: number };
    /** The page's cards: the curve's points and the dot explain themselves. */
    ctl: TooltipController;
    /** Called when the sweep has added points (the cards read them from the cache). */
    onsweep?: () => void;
  }

  let { rect, image, imageTag, subsampling, huffman, current, ctl, onsweep }: Props = $props();

  let points = $state<RdPoint[]>([]);
  let frame = 0;

  // (Re)start the sweep whenever the picture or the settings change.
  $effect(() => {
    const key = rdKey(imageTag, subsampling, huffman);
    const img = image;
    points = [...cachedCurve(key)];
    cancelAnimationFrame(frame);
    let alive = true;
    loadVizCore().then((viz) => {
      if (!alive) return;
      const step = () => {
        if (!alive) return;
        sweepFrame(missing(key), (q) => {
          try {
            const s = viz.jpeg_encode_stats(img.rgba, img.w, img.h, q, subsampling, huffman) as { bytes: number; psnr: number };
            addPoint(key, { quality: q, bytes: s.bytes, psnr: s.psnr });
          } catch {
            addPoint(key, { quality: q, bytes: 0, psnr: 0 });
          }
        });
        points = [...cachedCurve(key)];
        onsweep?.();
        if (missing(key).length > 0) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    }).catch(() => {});
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
    };
  });
  onDestroy(() => cancelAnimationFrame(frame));

  const W = $derived(Math.max(0, rect.w - 8));
  const H = $derived(Math.max(0, rect.h - 40));
  const maxBytes = $derived(Math.max(1, ...points.map((p) => p.bytes), current.bytes));
  const dot = $derived({
    x: (current.bytes / maxBytes) * W,
    y: H - (Math.min(current.psnr ?? RD_PSNR_CAP, RD_PSNR_CAP) / RD_PSNR_CAP) * H,
  });

  /** A point's place in the chart, in the svg's own pixels (the same maths as the polyline). */
  const placeOf = (p: RdPoint) => ({
    x: (p.bytes / maxBytes) * W,
    y: H - (Math.min(p.psnr, RD_PSNR_CAP) / RD_PSNR_CAP) * H,
  });

  /** The pointer may be this far (svg pixels) from a curve point and still mean it. */
  const REACH = 24;

  /** The curve point nearest the pointer, or null when none is within reach (the dot has its own card). */
  function nearestQuality(e: MouseEvent): Target | null {
    if (e.target instanceof Element && e.target.closest('.dot-hit')) return null;
    const box = (e.currentTarget as Element).getBoundingClientRect();
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;
    let best: RdPoint | null = null;
    let bestD = REACH;
    for (const p of points) {
      const at = placeOf(p);
      const d = Math.hypot(at.x - x, at.y - y);
      if (d < bestD) {
        best = p;
        bestD = d;
      }
    }
    return best ? { id: 'quantize.rd', quality: best.quality } : null;
  }

  /** The quality the keyboard has reached on the curve; null until it moves (it then starts at the encode in hand). */
  let rove = $state<number | null>(null);
  const roveQuality = $derived(rove ?? Math.min(100, Math.max(1, Math.round(current.quality))));
  const keyTarget = (): Target => ({ id: 'quantize.rd', quality: roveQuality });

  /** Left and right walk the curve one quality at a time (shift: ten); the card follows. */
  function onKey(e: KeyboardEvent) {
    if (e.altKey || e.metaKey || e.ctrlKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault(); // not also a stage switch
    const step = (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 10 : 1);
    rove = Math.min(100, Math.max(1, roveQuality + step)); // the chart's action shows the new quality's card
  }
</script>

{#if rect.w > 120 && rect.h > 90}
  <figure class="rd" style:left="{rect.x}px" style:top="{rect.y}px" style:width="{rect.w}px" style:height="{rect.h}px">
    <figcaption>Size against quality, q = 1…100 {points.length < 100 ? `(${points.length} of 100)` : ''}</figcaption>
    <!-- The curve is a focusable chart: the arrow keys walk its qualities, and its action shows each one's card. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <svg
      width={W}
      height={H}
      role="group"
      aria-roledescription="chart"
      tabindex="0"
      aria-label="Rate–distortion curve. The arrow keys walk the qualities."
      onkeydown={onKey}
      onblur={() => (rove = null)}
      use:tooltip={{ ctl, target: nearestQuality, keyTarget }}
    >
      <line class="axis" x1="0" y1={H} x2={W} y2={H} />
      <line class="axis" x1="0" y1="0" x2="0" y2={H} />
      <polyline class="curve" points={rdPolyline(points, W, H, maxBytes)} />
      <circle class="dot" cx={dot.x} cy={dot.y} r="4" />
      <!-- A roomier, invisible target around the dot, so it can be pointed at and tabbed to (focus is how the keyboard reads its card). -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <circle
        class="dot-hit"
        cx={dot.x}
        cy={dot.y}
        r="10"
        role="img"
        tabindex="0"
        aria-label="Where you are now"
        use:tooltip={{ ctl, target: { id: 'quantize.dot' } }}
      />
    </svg>
    <div class="axes"><span>0</span><span>file size</span><span>{Math.round(maxBytes / 1024)} KB</span></div>
  </figure>
{/if}

<style>
  .rd { position: absolute; margin: 0; color: rgba(255, 255, 255, 0.72); font-size: 12px; }
  figcaption { height: 18px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  svg { display: block; overflow: visible; margin-left: 4px; pointer-events: auto; }
  .axis { stroke: rgba(255, 255, 255, 0.25); }
  .curve { fill: none; stroke: #e27a52; stroke-width: 1.5; }
  .dot { fill: #fff; stroke: #e27a52; stroke-width: 2; pointer-events: none; }
  .dot-hit { fill: transparent; stroke: none; }
  svg:focus-visible, .dot-hit:focus-visible { outline: 1px dashed var(--accent); outline-offset: 2px; }
  .axes { display: flex; justify-content: space-between; font-size: 11px; margin-top: 2px; }
</style>
