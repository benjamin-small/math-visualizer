import { describe, it, expect } from 'vitest';
import {
  CAPTION_MIN,
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
  const stages: StageId[] = ['overview', 'color', 'subsample', 'blocks', 'dct', 'quantize', 'zigzag', 'rle', 'huffman', 'decode'];

  for (const [w, h] of [
    [1134, 585],
    [343, 520],
    [800, 420],
  ]) {
    for (const stage of stages) {
      it(`keeps every ${stage} panel on a ${w}×${h} stage, captions included, without overlaps`, () => {
        const l = jpegLayout(stage, w, h, 256, 256, [10, 10]);
        // Every stage has the image plus at least one panel or slot of its own.
        expect(l.panels.length + Object.keys(l.slots).length).toBeGreaterThan(1);
        for (const p of l.panels) {
          expect(p.rect.w).toBeGreaterThan(0);
          expect(inside({ ...p.rect, y: p.rect.y - LABEL, h: p.rect.h + LABEL }, w, h)).toBe(true);
        }
        for (let i = 0; i < l.panels.length; i++)
          for (let j = i + 1; j < l.panels.length; j++) expect(overlap(l.panels[i].rect, l.panels[j].rect)).toBe(false);
        // Slots (DOM tools) stay on the stage and off the GL panels.
        for (const r of Object.values(l.slots)) {
          expect(inside(r!, w, h)).toBe(true);
          for (const p of l.panels) expect(overlap(r!, p.rect)).toBe(false);
        }
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

  it('gives each new stage its panels and slots', () => {
    const kinds = (st: StageId) => jpegLayout(st, 1134, 585, 256, 256, [10, 10]).panels.map((p) => p.kind);
    const slots = (st: StageId) => Object.keys(jpegLayout(st, 1134, 585, 256, 256, [10, 10]).slots).sort();
    expect(kinds('quantize')).toEqual(['image', 'coeffs', 'quant', 'dequant_rebuild']);
    expect(slots('quantize')).toEqual(['qtable', 'rd']);
    expect(kinds('zigzag')).toEqual(['image', 'zigzag']);
    expect(slots('zigzag')).toEqual(['sequence']);
    expect(kinds('rle')).toEqual(['image', 'quant']);
    expect(slots('rle')).toEqual(['tokens']);
    expect(kinds('huffman')).toEqual(['image']);
    expect(slots('huffman')).toEqual(['huffman']);
    expect(kinds('decode')).toEqual(['image', 'wipe', 'error']);
    expect(slots('decode')).toEqual(['resave']);
    expect(slots('dct')).toEqual(['charts']);
  });

  it('starts the R–D chart clear of the rebuild caption on a phone', () => {
    const l = jpegLayout('quantize', 343, 520, 256, 256, [10, 10]);
    const rebuild = l.panels.find((p) => p.kind === 'dequant_rebuild')!.rect;
    expect(rebuild.w).toBeLessThan(CAPTION_MIN);
    expect(l.slots.rd!.x).toBeGreaterThanOrEqual(rebuild.x + CAPTION_MIN);
  });

  it('overview places original and decoded side by side above the stats slot', () => {
    const l = jpegLayout('overview', 1134, 585, 256, 256);
    const original = l.panels.find((p) => p.kind === 'original')!;
    const decoded = l.panels.find((p) => p.kind === 'decoded')!;
    expect(original.label).toBe('Original');
    expect(decoded.label).toBe('After JPEG');
    expect(decoded.rect.h).toBeCloseTo(original.rect.h);
    expect(decoded.rect.x).toBeGreaterThan(original.rect.x + original.rect.w);
    expect(l.slots.stats!.y).toBeGreaterThanOrEqual(original.rect.y + original.rect.h);
    expect(l.image).toEqual(original.rect);
    // The phone keeps the same structure.
    const phone = jpegLayout('overview', 343, 520, 256, 256);
    const o2 = phone.panels.find((p) => p.kind === 'original')!.rect;
    const d2 = phone.panels.find((p) => p.kind === 'decoded')!.rect;
    expect(d2.x).toBeGreaterThan(o2.x + o2.w);
    expect(phone.slots.stats!.y).toBeGreaterThanOrEqual(o2.y + o2.h);
  });

  it('overview gives a phone room for its statistics instead of padding the picture band', () => {
    const l = jpegLayout('overview', 343, 520, 256, 256);
    expect(l.slots.stats!.h).toBeGreaterThanOrEqual(280);
    // The band is as tall as the pictures need (caption included), no taller.
    const original = l.panels.find((p) => p.kind === 'original')!.rect;
    expect(l.slots.stats!.y).toBeLessThanOrEqual(original.y + original.h + MARGIN + 1);
  });

  it('overview keeps its desktop panels at 58% of the height', () => {
    const l = jpegLayout('overview', 1134, 585, 256, 256);
    const expected = (585 - 2 * MARGIN) * 0.58 - LABEL;
    for (const kind of ['original', 'decoded']) {
      const r = l.panels.find((p) => p.kind === kind)!.rect;
      expect(Math.abs(r.h - expected)).toBeLessThan(2);
      expect(Math.abs(r.w - expected)).toBeLessThan(2);
    }
  });

  it('overview fits a non-square picture without distortion', () => {
    const l = jpegLayout('overview', 1134, 585, 320, 203);
    for (const kind of ['original', 'decoded']) {
      const r = l.panels.find((p) => p.kind === kind)!.rect;
      expect(Math.abs(r.w / r.h / (320 / 203) - 1)).toBeLessThan(0.01);
    }
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
