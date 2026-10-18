<script lang="ts">
  // One tour step's picture. Most steps are worked out from the picture alone (split the
  // brightness from the colour, share colour, cut into tiles, describe a tile as waves, line
  // the numbers up, count the zeros); three need the real encoder (round, codes, open). The
  // encoder is asked through `latestOnly`, so a burst of quality changes ends on the last
  // value, and its result is kept so moving between those three steps doesn't encode again.
  import { untrack } from 'svelte';
  import type { RgbaImage } from '../../jpeg/images';
  import type { HuffmanId, SubsamplingId } from '../../jpeg/params';
  import { formatBytes } from '../../jpeg/summary';
  import { latestOnly, type TourStepId } from '../../jpeg/tour';
  import {
    brightnessImage,
    busiestTile,
    colourImage,
    countZeros,
    fdct8,
    shareColour,
    strongestPatterns,
    tileLuma,
    tileNumbers,
  } from '../../jpeg/tourPictures';
  import type { VizCore } from '../../wasm/loader';

  interface Props {
    /** Which step's picture to draw. */
    step: TourStepId;
    /** The picture the tour is about, or null while it loads. */
    image: RgbaImage | null;
    /** The quality setting the tour shows. */
    quality: number;
    /** The colour sharing the tour encodes with. */
    subsampling: SubsamplingId;
    /** The code tables the tour encodes with. */
    huffman: HuffmanId;
    /** The encoder, or null while it loads. */
    viz: VizCore | null;
  }

  let { step, image, quality, subsampling, huffman, viz }: Props = $props();

  /** One picture on a canvas: the pixels, how much to enlarge them, and anything drawn over them. */
  interface Pic {
    label?: string;
    aria: string;
    img: RgbaImage;
    scale: number;
    pixelated?: boolean;
    overlay?: (ctx: CanvasRenderingContext2D, scale: number) => void;
  }

  /** What one encode gave: the settings it was for, the picture opened again and the file size. */
  interface Encoded {
    image: RgbaImage;
    quality: number;
    subsampling: SubsamplingId;
    huffman: HuffmanId;
    viz: VizCore;
    rgba: Uint8Array;
    bytes: number;
  }

  /** The signed whole number as people write it: a real minus sign. */
  const num = (n: number) => (n < 0 ? `−${-n}` : `${n}`);
  /** An 8 × 8 grey picture from `f(i)` for each of its 64 cells. */
  const grey = (cells: readonly unknown[], f: (i: number) => number): RgbaImage => ({ w: 8, h: 8, rgba: greyPixels(cells.length, f) });
  function greyPixels(n: number, f: (i: number) => number): Uint8Array {
    const rgba = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const g = Math.min(255, Math.max(0, Math.round(f(i))));
      rgba.set([g, g, g, 255], i * 4);
    }
    return rgba;
  }

  /** The wave pattern (u across, v down) over 8 × 8, as grey. */
  function waveImage(u: number, v: number): RgbaImage {
    const values = Array.from({ length: 64 }, (_, i) => {
      const x = i % 8;
      const y = Math.floor(i / 8);
      return Math.cos(((2 * x + 1) * u * Math.PI) / 16) * Math.cos(((2 * y + 1) * v * Math.PI) / 16);
    });
    return grey(values, (i) => 128 + 127 * values[i]);
  }

  // ---- the encoder, for round, codes and open ----

  type Settings = Pick<Encoded, 'image' | 'quality' | 'subsampling' | 'huffman'>;
  const NEEDS_KIT: readonly TourStepId[] = ['round', 'codes', 'open'];
  /** The last encode that arrived. Raw state: the picture must stay the object it was. */
  let encoded = $state.raw<Encoded | null>(null);
  /** The settings of the newest request that failed, if nothing newer has been asked since. */
  let failedJob = $state.raw<Settings | null>(null);
  /** The settings of the newest request, so a step change doesn't ask twice. */
  let requested: Settings | null = null;

  const sameSettings = (a: Settings, b: Settings) =>
    a.image === b.image && a.quality === b.quality && a.subsampling === b.subsampling && a.huffman === b.huffman;

  const encode = latestOnly(
    async (job: Settings & { viz: VizCore }): Promise<Encoded> => {
      try {
        const { viz: kit, image: img, quality: q, subsampling: s, huffman: h } = job;
        // The kit is synchronous; going through a promise keeps a burst of requests collapsible.
        const rgba = await Promise.resolve().then(() => kit.jpeg_encode_decode(img.rgba, img.w, img.h, q, s, h));
        const stats = await Promise.resolve().then(
          () => kit.jpeg_encode_stats(img.rgba, img.w, img.h, q, s, h) as { bytes: number; psnr: number },
        );
        return { image: img, quality: q, subsampling: s, huffman: h, viz: kit, rgba, bytes: stats.bytes };
      } catch (e) {
        // Only the newest request's failure matters; the next change (or step) tries again.
        if (requested && sameSettings(requested, job)) {
          requested = null;
          failedJob = { image: job.image, quality: job.quality, subsampling: job.subsampling, huffman: job.huffman };
        }
        throw e;
      }
    },
    (result) => {
      encoded = result;
    },
  );

  $effect(() => {
    if (!NEEDS_KIT.includes(step) || !image || !viz) return;
    const job = { image, quality, subsampling, huffman };
    untrack(() => {
      if (requested && sameSettings(requested, job)) return;
      if (encoded && encoded.viz === viz && sameSettings(encoded, job)) return;
      requested = job;
      encode({ ...job, viz });
    });
  });

  /** The newest encode for this picture and kit: shown (with its own settings) until a newer one lands. */
  const shown = $derived(encoded && image && viz && encoded.image === image && encoded.viz === viz ? encoded : null);
  /** The picture on show is for older settings than the sliders; a newer one is on its way. */
  const stale = $derived(!!shown && !sameSettings(shown, { image: shown.image, quality, subsampling, huffman }));
  /** The newest request failed. */
  const failed = $derived(
    !!failedJob && !!image && sameSettings(failedJob, { image, quality, subsampling, huffman }),
  );

  const needsKit = $derived(NEEDS_KIT.includes(step));
  /** Waiting for the picture, or (on an encoder step) for the first result: later changes keep the last result on show. */
  const busy = $derived(!image || (needsKit && !failed && (!viz || !shown)));
  const broken = $derived(needsKit && failed && !!viz);

  // ---- what each step works out from the picture ----

  const tile = $derived<[number, number] | null>(image ? busiestTile(image) : null);

  /** The picture drawn enlarged so the 8-pixel grid shows; the busiest tile is outlined. */
  const tilesPic = $derived.by<Pic | null>(() => {
    if (step !== 'tiles' || !image || !tile) return null;
    const [bx, by] = tile;
    const img = image;
    const scale = Math.max(1, Math.floor(480 / Math.max(img.w, img.h)));
    return {
      aria: `The picture cut into 8 by 8 pixel tiles; the busiest tile is outlined, column ${bx + 1}, row ${by + 1}`,
      img,
      scale,
      overlay: (ctx, s) => {
        const step8 = 8 * s;
        ctx.beginPath();
        for (let x = step8; x < img.w * s; x += step8) {
          ctx.moveTo(x + 0.5, 0);
          ctx.lineTo(x + 0.5, img.h * s);
        }
        for (let y = step8; y < img.h * s; y += step8) {
          ctx.moveTo(0, y + 0.5);
          ctx.lineTo(img.w * s, y + 0.5);
        }
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.stroke();
        const w = Math.min(img.w - bx * 8, 8) * s;
        const h = Math.min(img.h - by * 8, 8) * s;
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#ffd43b';
        ctx.strokeRect(bx * step8 + 1.5, by * step8 + 1.5, w - 3, h - 3);
      },
    };
  });

  /** The pictures drawn side by side for the steps that compare two. */
  const pics = $derived.by<Pic[]>(() => {
    if (!image) return [];
    const img = image;
    switch (step) {
      case 'split':
        return [
          { label: 'Brightness', aria: 'The picture as brightness alone', img: brightnessImage(img), scale: 1 },
          { label: 'Colour', aria: 'The picture as colour alone', img: colourImage(img), scale: 1 },
        ];
      case 'share':
        return [
          { label: 'Before', aria: 'The picture before colour is shared', img, scale: 1 },
          { label: 'Colour shared', aria: 'The picture with colour shared over 4 by 4 pixels', img: shareColour(img, 4), scale: 1 },
        ];
      case 'tiles':
        return tilesPic ? [tilesPic] : [];
      case 'round':
        return shown
          ? [
              { label: 'Before', aria: 'The picture before rounding', img, scale: 1 },
              { label: 'After', aria: `The picture after rounding at quality ${shown.quality}`, img: { w: img.w, h: img.h, rgba: shown.rgba }, scale: 1 },
            ]
          : [];
      case 'open':
        return shown
          ? [
              { label: 'Original', aria: 'The original picture', img, scale: 1 },
              { label: 'Opened JPEG', aria: `The JPEG opened again, made at quality ${shown.quality}`, img: { w: img.w, h: img.h, rgba: shown.rgba }, scale: 1 },
            ]
          : [];
      default:
        return [];
    }
  });

  /** The busiest tile as grey, its four strongest waves and their amounts. */
  const waves = $derived.by(() => {
    if (step !== 'waves' || !image || !tile) return null;
    const luma = tileLuma(image, tile[0], tile[1]);
    const patterns = strongestPatterns(fdct8(luma.map((v) => v - 128)), 4);
    return {
      zoom: { aria: 'The busiest tile, enlarged', img: grey(luma, (i) => luma[i]), scale: 1, pixelated: true } satisfies Pic,
      waves: patterns.map((p) => {
        const amount = Math.round(p.amount);
        return {
          amount: num(amount),
          pic: {
            aria: `A wave pattern, ${p.u} across and ${p.v} down, in an amount of ${num(amount)}`,
            img: waveImage(p.u, p.v),
            scale: 1,
            pixelated: true,
          } satisfies Pic,
        };
      }),
    };
  });

  /** The busiest tile's numbers at this quality, and where its zeros begin. */
  const line = $derived.by(() => {
    if ((step !== 'line' && step !== 'count') || !image || !tile) return null;
    const numbers = tileNumbers(image, tile[0], tile[1], quality);
    let last = 0;
    for (let i = 1; i < numbers.length; i++) if (numbers[i] !== 0) last = i;
    return { numbers, last, counted: countZeros(numbers) };
  });

  const lineCaption = $derived(
    line
      ? `${line.last + 1} ${line.last === 0 ? 'number' : 'numbers'}, then ${63 - line.last} ${63 - line.last === 1 ? 'zero' : 'zeros'}`
      : '',
  );

  const rawBytes = $derived(image ? image.w * image.h * 3 : 0);
  /** The longer of the two bars is the full width. */
  const barScale = $derived(Math.max(rawBytes, shown?.bytes ?? 0, 1));
  const share = (n: number) => `${Math.max(0.5, (100 * n) / barScale)}%`;

  /** Draw a picture into its canvas (nothing to draw on where canvas drawing is missing). */
  function paint(node: HTMLCanvasElement, pic: Pic) {
    const draw = (p: Pic) => {
      const ctx = node.getContext('2d');
      if (!ctx) return;
      const src = document.createElement('canvas');
      src.width = p.img.w;
      src.height = p.img.h;
      const sctx = src.getContext('2d');
      if (!sctx) return;
      sctx.putImageData(new ImageData(new Uint8ClampedArray(p.img.rgba), p.img.w, p.img.h), 0, 0);
      ctx.clearRect(0, 0, node.width, node.height);
      ctx.imageSmoothingEnabled = !p.pixelated && p.scale === 1;
      ctx.drawImage(src, 0, 0, p.img.w * p.scale, p.img.h * p.scale);
      p.overlay?.(ctx, p.scale);
    };
    draw(pic);
    return { update: draw };
  }
</script>

{#snippet canvasOf(p: Pic)}
  <canvas
    aria-label={p.aria}
    class:pixelated={p.pixelated}
    width={p.img.w * p.scale}
    height={p.img.h * p.scale}
    use:paint={p}
  ></canvas>
{/snippet}

<figure class="tour-visual" class:stale={needsKit && stale} data-step={step} aria-busy={busy ? 'true' : 'false'}>
  {#if busy}
    <p class="busy">Getting the picture ready</p>
  {:else if broken}
    <p class="busy">Couldn't make this picture.</p>
  {:else if step === 'waves' && waves}
    <div class="wave-row">
      <div class="pic zoom">{@render canvasOf(waves.zoom)}</div>
      {#each waves.waves as w, i (i)}
        <span class="plus" aria-hidden="true">+</span>
        <div class="wave">
          <div class="pic small">{@render canvasOf(w.pic)}</div>
          <span class="amount">{w.amount}</span>
        </div>
      {/each}
    </div>
    <figcaption>Four of the waves that make this tile.</figcaption>
  {:else if step === 'line' && line}
    <div class="strip" role="img" aria-label="The numbers for the busiest tile, in order">
      {#each line.numbers as n, i (i)}
        <span class="cell" class:dim={i > line.last}>{num(n)}</span>
      {/each}
    </div>
    <figcaption>{lineCaption}</figcaption>
  {:else if step === 'count' && line}
    <div class="chips">
      <span class="chip first">{num(line.counted.first)}</span>
      {#each line.counted.runs as r, i (i)}
        <span class="chip">{r.zeros > 0 ? `0 × ${r.zeros}, ${num(r.value)}` : num(r.value)}</span>
      {/each}
      {#if line.counted.end}
        <span class="chip end">end</span>
      {/if}
    </div>
  {:else if step === 'codes' && shown}
    <div class="bars">
      <div class="bar-row">
        <span class="what">Raw pixels</span>
        <span class="track"><span class="bar raw" style:width={share(rawBytes)}></span></span>
        <span class="size mono">{formatBytes(rawBytes)}</span>
      </div>
      <div class="bar-row">
        <span class="what">JPEG file</span>
        <span class="track"><span class="bar file" style:width={share(shown.bytes)}></span></span>
        <span class="size mono">{formatBytes(shown.bytes)}</span>
      </div>
    </div>
    {#if shown.bytes > 0}
      <figcaption>{(rawBytes / shown.bytes).toFixed(1)} times smaller</figcaption>
    {/if}
  {:else}
    <div class="panels">
      {#each pics as p, i (i)}
        <div class="pic" class:wide={pics.length === 1}>
          {@render canvasOf(p)}
          {#if p.label}<span class="label">{p.label}</span>{/if}
        </div>
      {/each}
    </div>
    {#if step === 'share'}
      <figcaption>Exaggerated: colour shared over 4 × 4 pixels (JPEG uses 2 × 2).</figcaption>
    {:else if step === 'round' && shown}
      <figcaption>Quality {shown.quality} · {formatBytes(shown.bytes)}</figcaption>
    {:else if step === 'open' && shown}
      <figcaption>{formatBytes(Math.max(0, rawBytes - shown.bytes))} saved</figcaption>
    {/if}
  {/if}
</figure>

<style>
  .tour-visual {
    margin: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    color: var(--ink);
    font-size: 13px;
  }
  .busy { margin: 0; padding: 32px 0; color: var(--stone); }
  .stale .panels, .stale .bars { opacity: 0.6; transition: opacity 0.15s; }
  figcaption { color: var(--stone); text-align: center; line-height: 1.4; }

  .panels, .wave-row { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 12px; width: 100%; }
  .pic { display: flex; flex-direction: column; align-items: center; gap: 4px; flex: 1 1 140px; max-width: 280px; min-width: 0; }
  .pic.wide { max-width: 480px; }
  .label { color: var(--stone); font-size: 12px; }
  canvas { display: block; width: 100%; height: auto; border: 1px solid var(--line); border-radius: 4px; background: var(--paper); }
  canvas.pixelated { image-rendering: pixelated; }

  .wave-row { flex-wrap: nowrap; gap: 8px; }
  .wave-row .zoom { flex: 0 1 120px; }
  .wave { display: flex; flex-direction: column; align-items: center; gap: 2px; flex: 0 1 56px; min-width: 0; }
  .wave .small { flex: none; width: 100%; }
  .plus { color: var(--stone); font-size: 18px; flex: none; }
  .amount { font-family: var(--font-mono); font-variant-numeric: tabular-nums; color: var(--ink); }

  .strip { display: grid; grid-template-columns: repeat(16, minmax(0, 1fr)); gap: 2px; width: 100%; max-width: 560px; }
  .cell {
    padding: 4px 0;
    text-align: center;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: 11px;
    background: var(--tint);
    border-radius: 3px;
  }
  .cell.dim { background: transparent; color: var(--stone); opacity: 0.45; }

  .chips { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; }
  .chip {
    padding: 4px 9px;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    background: var(--tint);
    border: 1px solid var(--line);
    border-radius: 999px;
  }
  .chip.end { background: transparent; color: var(--stone); border-style: dashed; }

  .bars { display: flex; flex-direction: column; gap: 8px; width: 100%; max-width: 480px; }
  .bar-row { display: grid; grid-template-columns: 76px 1fr max-content; align-items: center; gap: 8px; }
  .what { color: var(--stone); }
  .track { display: block; height: 18px; }
  .bar { display: block; height: 100%; border-radius: 3px; }
  .bar.raw { background: var(--line); }
  .bar.file { background: var(--accent); }
  .size { text-align: right; }
</style>
