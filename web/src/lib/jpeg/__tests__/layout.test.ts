import { describe, it, expect } from 'vitest';
import {
  CAPTION_MIN,
  DECODE_TOOLS,
  DECODE_ZOOMS,
  LABEL,
  MARGIN,
  PORTRAIT_BELOW,
  TOOLS,
  ZOOM_WINDOW,
  blockAt,
  cellAt,
  cells,
  decodeWindow,
  fit,
  BLANK_PANELS,
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
        const l = jpegLayout(stage, w, h, 256, 256);
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

  it('zooms the subsample stage around the selection, not a fixed crop', () => {
    const l = jpegLayout('subsample', 900, 600, 256, 256);
    const planes = l.panels.filter((p) => p.kind.startsWith('plane_') || p.kind.startsWith('coded_'));
    expect(planes).toHaveLength(4);
    for (const p of planes) {
      expect(p.zoom).toBe(ZOOM_WINDOW);
      expect(p.crop).toBeUndefined();
    }
    expect(toDevicePanels(planes, 2)[0]).toMatchObject({ zoom: ZOOM_WINDOW, crop: null });
  });

  it('captions the subsample zoom with the side it shows, clipped to a small picture', () => {
    const label = (w: number, h: number) => jpegLayout('subsample', 1134, 585, w, h).panels.find((p) => p.kind === 'plane_cb')!.label;
    expect(label(256, 256)).toBe('Cb as measured — 32 × 32 px around the block');
    expect(label(20, 12)).toBe('Cb as measured — 12 × 12 px around the block');
  });

  it('gives each new stage its panels and slots', () => {
    const kinds = (st: StageId) => jpegLayout(st, 1134, 585, 256, 256).panels.map((p) => p.kind);
    const slots = (st: StageId) => Object.keys(jpegLayout(st, 1134, 585, 256, 256).slots).sort();
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

  it('makes the wipe the decode stage\'s main panel, magnified 4× around the block by default', () => {
    for (const [w, h] of [
      [1134, 585],
      [343, 520],
      [800, 420],
    ]) {
      const l = jpegLayout('decode', w, h, 256, 256);
      const wipe = l.panels.find((p) => p.kind === 'wipe')!;
      const error = l.panels.find((p) => p.kind === 'error')!;
      expect(wipe.zoom).toBe(64);
      expect(error.zoom).toBe(64);
      expect(wipe.rect.w).toBeCloseTo(wipe.rect.h);
      expect(error.rect.w).toBeCloseTo(error.rect.h);
      expect(wipe.rect.w).toBeGreaterThan(error.rect.w);
      // The largest of the stage's own panels (the scan picture at the left is every stage's).
      const area = (r: Rect) => r.w * r.h;
      for (const p of l.panels.filter((q) => q.kind !== 'image')) expect(area(wipe.rect)).toBeGreaterThanOrEqual(area(p.rect));
      // It spans the focus area's width or about 64% of its height, whichever is less.
      expect(error.rect.y).toBeGreaterThan(wipe.rect.y + wipe.rect.h);
      // The window's size is said once, under the zoom chips, not in the captions (a phone cut them off).
      expect(wipe.label).toBe('Decoded (left of the line) against the original');
      expect(error.label).toBe('What was lost, brightened');
      expect(toDevicePanels([wipe], 2)[0].zoom).toBe(64);
    }
    // The wide stage gives the wipe the focus area's height share.
    const wide = jpegLayout('decode', 1134, 585, 256, 256).panels.find((p) => p.kind === 'wipe')!.rect;
    expect(wide.h).toBeCloseTo((585 - 2 * MARGIN - LABEL) * 0.64);
    // So does a phone, whose controls scroll in their slot.
    const phone = jpegLayout('decode', 375, 812, 256, 256);
    const focusH = 812 - 3 * MARGIN - (812 - 3 * MARGIN) * 0.28;
    expect(phone.panels.find((p) => p.kind === 'wipe')!.rect.h).toBeCloseTo((focusH - LABEL) * 0.64);
  });

  it('keeps room for the re-save chart beside or below the wipe on a desktop, at every zoom', () => {
    for (const [w, h] of [
      [1134, 585],
      [1024, 768],
      [1280, 640],
    ]) {
      for (const [iw, ih] of [
        [256, 256],
        [320, 203],
      ]) {
        for (const f of DECODE_ZOOMS) {
          const l = jpegLayout('decode', w, h, iw, ih, f);
          const wipe = l.panels.find((p) => p.kind === 'wipe')!.rect;
          expect(l.slots.resave!.h, `${w}×${h}, ${iw}×${ih} at ${f}×`).toBeGreaterThanOrEqual(DECODE_TOOLS + 48);
          // Never less than half the height for the wipe, unless the focus area's width is what limits it.
          const focusW = w - 3 * MARGIN - Math.min(h - 2 * MARGIN - LABEL, (w - 3 * MARGIN) * 0.45);
          expect(wipe.h > 0.5 * (h - 2 * MARGIN - LABEL) || Math.abs(wipe.w - focusW) < 1e-6).toBe(true);
        }
      }
    }
  });

  it('lets the decode captions run past their panels where nothing else is, so the window size reads', () => {
    for (const [w, h] of [
      [1134, 585],
      [1024, 768],
      [375, 812],
      [343, 520],
    ]) {
      for (const f of DECODE_ZOOMS) {
        const l = jpegLayout('decode', w, h, 256, 256, f);
        const wipe = l.panels.find((p) => p.kind === 'wipe')!;
        const error = l.panels.find((p) => p.kind === 'error')!;
        // The wipe's caption may run to the right edge of the focus area.
        expect(wipe.rect.x + wipe.captionW!).toBeCloseTo(w - MARGIN);
        expect(error.captionW!).toBeGreaterThanOrEqual(error.rect.w);
        // Neither runs into the controls or another panel.
        for (const p of [wipe, error]) {
          const band = { x: p.rect.x, y: p.rect.y - LABEL, w: Math.max(p.captionW!, CAPTION_MIN), h: LABEL };
          expect(overlap(band, l.slots.resave!), `${w}×${h} ${p.kind} at ${f}×`).toBe(false);
          for (const q of l.panels) expect(overlap(band, q.rect)).toBe(false);
        }
      }
    }
  });

  it('gives the scan picture less room on the decode stage, so the wipe is the largest panel of all', () => {
    for (const [w, h] of [
      [1024, 768],
      [1134, 585],
      [800, 420],
      [375, 812],
      [343, 520],
    ]) {
      const l = jpegLayout('decode', w, h, 256, 256);
      const wipe = l.panels.find((p) => p.kind === 'wipe')!.rect;
      for (const p of l.panels.filter((q) => q.kind !== 'wipe')) {
        expect(wipe.w * wipe.h, `${w}×${h}: wipe against ${p.kind}`).toBeGreaterThan(p.rect.w * p.rect.h);
      }
    }
    // Landscape: 28% of the width (still capped by the height); portrait: 28% of the height.
    expect(jpegLayout('decode', 1024, 768, 256, 256).image.w).toBeCloseTo((1024 - 3 * MARGIN) * 0.28);
    expect(jpegLayout('decode', 375, 812, 256, 256).image.h).toBeCloseTo((812 - 3 * MARGIN) * 0.28 - LABEL);
  });

  it('keeps the scan picture as it was on every other stage', () => {
    expect(jpegLayout('dct', 1024, 768, 256, 256).image.w).toBeCloseTo((1024 - 3 * MARGIN) * 0.45);
    expect(jpegLayout('quantize', 375, 812, 256, 256).image.h).toBeCloseTo((812 - 3 * MARGIN) * 0.42 - LABEL);
  });

  it('puts the controls beside a square wipe that leaves room at its right', () => {
    const l = jpegLayout('decode', 1134, 585, 256, 256);
    const wipe = l.panels.find((p) => p.kind === 'wipe')!.rect;
    const error = l.panels.find((p) => p.kind === 'error')!.rect;
    const slot = l.slots.resave!;
    expect(slot.x).toBeGreaterThanOrEqual(wipe.x + wipe.w + MARGIN - 1e-6);
    expect(slot.y).toBeLessThanOrEqual(wipe.y);
    expect(error.x).toBeCloseTo(wipe.x);
  });

  it('zooms the decode stage by the factor asked for, or shows the whole picture', () => {
    const at = (f: number, w = 256, h = 256) => jpegLayout('decode', 1134, 585, w, h, f).panels;
    const of = (ps: ReturnType<typeof at>, kind: string) => ps.find((p) => p.kind === kind)!;
    expect(of(at(8), 'wipe').zoom).toBe(32);
    expect(of(at(8), 'error').zoom).toBe(32);
    for (const f of DECODE_ZOOMS) {
      expect(of(at(f), 'wipe').label).toBe('Decoded (left of the line) against the original');
      expect(of(at(f), 'error').label).toBe('What was lost, brightened');
    }
    const whole = at(1, 320, 203);
    const wipe = of(whole, 'wipe');
    const error = of(whole, 'error');
    expect('zoom' in wipe).toBe(false);
    expect('zoom' in error).toBe(false);
    expect(wipe.label).toBe('Decoded (left of the line) against the original');
    expect(error.label).toBe('What was lost, brightened');
    // The whole picture keeps its aspect.
    expect(wipe.rect.w / wipe.rect.h).toBeCloseTo(320 / 203);
    expect(error.rect.w / error.rect.h).toBeCloseTo(320 / 203);
    expect(DECODE_ZOOMS).toEqual([1, 2, 4, 8]);
  });

  it('sizes the decode window from the picture\'s shorter side', () => {
    expect(decodeWindow(4, 256, 256)).toBe(64);
    expect(decodeWindow(8, 320, 240)).toBe(30);
    expect(decodeWindow(1, 320, 240)).toBeNull();
    // Never smaller than one block.
    expect(decodeWindow(8, 40, 30)).toBe(8);
  });

  it('starts the R–D chart clear of the rebuild caption on a phone', () => {
    const l = jpegLayout('quantize', 343, 520, 256, 256);
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
    expect(p).toEqual({ kind: 'plane_cb', rect: [2, 4, 6, 8], crop: [0, 0, 8, 8], zoom: null });
    const [plain] = toDevicePanels([{ kind: 'image', rect: { x: 0, y: 0, w: 1, h: 1 }, label: '' }], 1);
    expect(plain.crop).toBeNull();
    expect(plain.zoom).toBeNull();
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
    // Any side, as the decode stage's zoom asks: the same rule as the viz's `zoom_window`.
    expect(zoomWindow([0, 0], 256, 256, 64)).toEqual([0, 0, 64, 64]);
    expect(zoomWindow([10, 10], 256, 256, 64)).toEqual([52, 52, 64, 64]);
    expect(zoomWindow([31, 31], 256, 256, 64)).toEqual([192, 192, 64, 64]);
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

describe('BLANK_PANELS', () => {
  it('is a non-empty list of zero-size panels (an empty list makes the viz fit the image)', () => {
    const device = toDevicePanels(BLANK_PANELS, 2);
    expect(device.length).toBeGreaterThan(0);
    for (const p of device) expect(p.rect[2] * p.rect[3]).toBe(0);
  });
});
