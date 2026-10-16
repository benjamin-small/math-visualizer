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

  interface Props {
    rect: Rect;
    image: RgbaImage;
    /** Identifies the picture for the cache (the image id, or a tag per upload). */
    imageTag: string;
    subsampling: string;
    huffman: string;
    /** The current encode: where the dot goes. */
    current: { bytes: number; psnr: number | null };
  }

  let { rect, image, imageTag, subsampling, huffman, current }: Props = $props();

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
</script>

{#if rect.w > 120 && rect.h > 90}
  <figure class="rd" style:left="{rect.x}px" style:top="{rect.y}px" style:width="{rect.w}px" style:height="{rect.h}px">
    <figcaption>Size against quality, q = 1…100 {points.length < 100 ? `(${points.length} of 100)` : ''}</figcaption>
    <svg width={W} height={H} aria-label="Rate–distortion curve">
      <line class="axis" x1="0" y1={H} x2={W} y2={H} />
      <line class="axis" x1="0" y1="0" x2="0" y2={H} />
      <polyline class="curve" points={rdPolyline(points, W, H, maxBytes)} />
      <circle class="dot" cx={dot.x} cy={dot.y} r="4" />
    </svg>
    <div class="axes"><span>0</span><span>file size</span><span>{Math.round(maxBytes / 1024)} KB</span></div>
  </figure>
{/if}

<style>
  .rd { position: absolute; margin: 0; color: rgba(255, 255, 255, 0.72); font-size: 12px; }
  figcaption { height: 18px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  svg { display: block; overflow: visible; margin-left: 4px; }
  .axis { stroke: rgba(255, 255, 255, 0.25); }
  .curve { fill: none; stroke: #e27a52; stroke-width: 1.5; }
  .dot { fill: #fff; stroke: #e27a52; stroke-width: 2; }
  .axes { display: flex; justify-content: space-between; font-size: 11px; margin-top: 2px; }
</style>
