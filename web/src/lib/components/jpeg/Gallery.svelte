<script lang="ts">
  // The picture gallery: every picture as a thumbnail, grouped by kind, with
  // Upload as the last tile. Bundled pictures are their own (lazily loaded)
  // PNGs scaled by CSS; generated ones are drawn from the kit's pixels.
  import { onMount } from 'svelte';
  import Icon from '../Icon.svelte';
  import { GROUP_LABELS, IMAGES, thumbnail, type PictureGroup } from '../../jpeg/images';
  import type { ImageId } from '../../jpeg/params';
  import { tooltip, type TooltipController } from './tooltip.svelte';

  interface Props {
    /** The picture in use (or an upload). */
    current: ImageId | 'upload';
    /** Called with the picture the reader picked. */
    onpick: (id: ImageId) => void;
    /** Called when the reader wants to use their own picture. */
    onupload: () => void;
    /** The page's cards: each tile explains its picture. */
    ctl: TooltipController;
  }

  let { current, onpick, onupload, ctl }: Props = $props();

  const GROUPS = Object.keys(GROUP_LABELS) as PictureGroup[];
  /** Thumbnail side in CSS pixels; drawn at this size for generated pictures. */
  const SIDE = 64;

  /** Thumbnail URLs by picture id, filled in as they are made. */
  let urls = $state<Partial<Record<ImageId, string>>>({});

  onMount(() => {
    let alive = true;
    for (const im of IMAGES) {
      thumbnail(im.id, SIDE)
        .then((url) => {
          if (alive) urls[im.id] = url;
        })
        .catch(() => {}); // a tile without a thumbnail still works: its label is the button
    }
    return () => {
      alive = false;
    };
  });
</script>

<div class="gallery">
  {#each GROUPS as group (group)}
    <section aria-label={GROUP_LABELS[group]}>
      <h3>{GROUP_LABELS[group]}</h3>
      <ul>
        {#each IMAGES.filter((im) => im.group === group) as im (im.id)}
          <li>
            <button
              class="tile"
              aria-pressed={current === im.id}
              onclick={() => onpick(im.id)}
              use:tooltip={{ ctl, target: { id: 'gallery.tile', picture: im.id }, acts: true }}
            >
              <span class="thumb">
                {#if urls[im.id]}
                  <img src={urls[im.id]} alt="" width={SIDE} height={SIDE} loading={im.file ? 'lazy' : undefined} />
                {/if}
              </span>
              <span class="label">{im.label}</span>
            </button>
          </li>
        {/each}
        {#if group === 'tests'}
          <li>
            <button class="tile" onclick={onupload} use:tooltip={{ ctl, target: { id: 'gallery.tile', picture: 'upload' }, acts: true }}>
              <span class="thumb"><Icon name="upload" /></span>
              <span class="label">Upload</span>
            </button>
          </li>
        {/if}
      </ul>
    </section>
  {/each}
</div>

<style>
  /* One row of tiles per group, stacked tightly (a group wraps only when the column is narrower than its tiles). */
  .gallery { display: flex; flex-direction: column; gap: 10px; margin: 4px 0 28px; }
  section { min-width: 0; }
  /* Prefixed with .gallery so they outrank the story column's :global(h3), :global(ul) and :global(li) margins. */
  .gallery h3 { margin: 0 0 4px; font-size: 13px; font-weight: 500; color: var(--stone); }
  .gallery ul { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; padding: 0; list-style: none; }
  .gallery li { margin: 0; }
  .tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    width: 84px;
    padding: 6px 4px 5px;
    border: 1px solid var(--line);
    border-radius: var(--radius-button);
    background: none;
    color: var(--ink);
    font-size: 12px;
    line-height: 1.25;
    cursor: pointer;
  }
  .tile:hover { border-color: var(--stone); }
  .tile[aria-pressed='true'] { border-color: var(--accent); background: var(--tint); }
  .tile:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .thumb {
    display: grid;
    place-items: center;
    width: 64px;
    height: 64px;
    overflow: hidden;
    border-radius: 4px;
    background: var(--line);
    color: var(--stone);
  }
  img { display: block; width: 64px; height: 64px; object-fit: cover; }
  .label { text-align: center; overflow-wrap: anywhere; }
</style>
