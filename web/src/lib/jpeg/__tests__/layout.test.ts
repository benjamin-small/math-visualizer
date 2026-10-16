import { describe, it, expect } from 'vitest';
import {
  LABEL,
  MARGIN,
  PORTRAIT_BELOW,
  TOOLS,
  blockAt,
  cellAt,
  cells,
  fit,
  jpegLayout,
  toDevicePanels,
  zoomWindow,
  type Rect,
} from '../layout';
import type { StageId } from '../stages';

const inside = (r: Rect, w: number, h: number) => r.x >= 0 && r.y >= 0 && r.x + r.w <= w + 1e-6 && r.y + r.h <= h + 1e-6;
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('jpegLayout', () => {
  const stages: StageId[] = ['color', 'subsample', 'blocks', 'dct'];

  for (const [w, h] of [
    [1134, 585],
    [343, 520],
    [800, 420],
  ]) {
    for (const stage of stages) {
      it(`keeps every ${stage} panel on a ${w}×${h} stage, captions included, without overlaps`, () => {
        const l = jpegLayout(stage, w, h, 256, 256, [10, 10]);
        expect(l.panels.length).toBeGreaterThan(1);
        for (const p of l.panels) {
          expect(p.rect.w).toBeGreaterThan(0);
          expect(inside({ ...p.rect, y: p.rect.y - LABEL, h: p.rect.h + LABEL }, w, h)).toBe(true);
        }
        for (let i = 0; i < l.panels.length; i++)
          for (let j = i + 1; j < l.panels.length; j++) expect(overlap(l.panels[i].rect, l.panels[j].rect)).toBe(false);
      });
    }
  }

  it('puts the image at the left on a wide stage and on top on a narrow one', () => {
    const wide = jpegLayout('color', 1134, 585, 256, 256);
    expect(wide.image.x).toBe(MARGIN);
    const cube = wide.panels.find((p) => p.kind === 'cube')!.rect;
    expect(cube.x).toBeGreaterThan(wide.image.x + wide.image.w);
    const narrow = jpegLayout('color', PORTRAIT_BELOW - 1, 700, 256, 256);
    const cube2 = narrow.panels.find((p) => p.kind === 'cube')!.rect;
    expect(cube2.y).toBeGreaterThan(narrow.image.y + narrow.image.h);
  });

  it('keeps the image square for a square picture and draws the grid only on the blocks stage', () => {
    const l = jpegLayout('blocks', 1134, 585, 256, 256);
    expect(l.image.w).toBeCloseTo(l.image.h);
    expect(l.panels[0].kind).toBe('image_grid');
    expect(jpegLayout('dct', 1134, 585, 256, 256).panels[0].kind).toBe('image');
  });

  it('leaves room under the block and the rebuild panel for their controls', () => {
    const h = 585;
    const block = jpegLayout('blocks', 1134, h, 256, 256).panels.find((p) => p.kind === 'block')!.rect;
    expect(block.y + block.h + TOOLS).toBeLessThanOrEqual(h);
    const rebuild = jpegLayout('dct', 1134, h, 256, 256).panels.find((p) => p.kind === 'rebuild')!.rect;
    expect(rebuild.y + rebuild.h + TOOLS).toBeLessThanOrEqual(h);
  });

  it('magnifies the same window around the block in all four subsample panels', () => {
    const l = jpegLayout('subsample', 1134, 585, 256, 256, [21, 17]);
    const crops = l.panels.filter((p) => p.crop).map((p) => p.crop);
    expect(crops).toHaveLength(4);
    expect(new Set(crops.map((c) => c!.join()))).toEqual(new Set(['156,124,32,32']));
  });

  it('gives a stage too small for anything no panels', () => {
    expect(jpegLayout('dct', 30, 30, 256, 256).panels).toEqual([]);
    expect(jpegLayout('dct', 800, 600, 0, 0).panels).toEqual([]);
  });

  it('hands the viz device pixels and the crop', () => {
    const [p] = toDevicePanels([{ kind: 'plane_cb', rect: { x: 1, y: 2, w: 3, h: 4 }, label: '', crop: [0, 0, 8, 8] }], 2);
    expect(p).toEqual({ kind: 'plane_cb', rect: [2, 4, 6, 8], crop: [0, 0, 8, 8] });
    expect(toDevicePanels([{ kind: 'image', rect: { x: 0, y: 0, w: 1, h: 1 }, label: '' }], 1)[0].crop).toBeNull();
  });
});

describe('geometry helpers', () => {
  it('fits an aspect ratio inside a rect, centred', () => {
    expect(fit({ x: 0, y: 0, w: 200, h: 100 }, 1, 1)).toEqual({ x: 50, y: 0, w: 100, h: 100 });
    expect(fit({ x: 0, y: 0, w: 0, h: 100 }, 1, 1).w).toBe(0);
  });

  it('keeps the zoom window inside the image', () => {
    expect(zoomWindow([0, 0], 256, 256)).toEqual([0, 0, 32, 32]);
    expect(zoomWindow([31, 31], 256, 256)).toEqual([224, 224, 32, 32]);
    expect(zoomWindow([1, 1], 20, 12)).toEqual([6, 0, 12, 12]); // centred on x = 12, side clipped to the 12 px height
  });

  it('finds the luma block under a click', () => {
    const img = { x: 10, y: 10, w: 512, h: 512 };
    expect(blockAt(10, 10, img, 256, 256)).toEqual([0, 0]);
    expect(blockAt(10 + 511, 10 + 511, img, 256, 256)).toEqual([31, 31]);
    expect(blockAt(9, 10, img, 256, 256)).toBeNull();
    expect(blockAt(10 + 512, 10, img, 256, 256)).toBeNull();
  });

  it('lays out 64 cells like the viz and finds the cell under the pointer', () => {
    const c = cells({ x: 0, y: 0, w: 160, h: 160 }, 1);
    expect(c).toHaveLength(64);
    expect(c[0]).toEqual({ x: 0, y: 0, w: 19.125, h: 19.125 });
    expect(c[63].x + c[63].w).toBeCloseTo(160);
    expect(cellAt(0, 0, { x: 0, y: 0, w: 80, h: 80 })).toEqual([0, 0]);
    expect(cellAt(79.9, 15, { x: 0, y: 0, w: 80, h: 80 })).toEqual([7, 1]);
    expect(cellAt(80, 15, { x: 0, y: 0, w: 80, h: 80 })).toBeNull();
  });
});
