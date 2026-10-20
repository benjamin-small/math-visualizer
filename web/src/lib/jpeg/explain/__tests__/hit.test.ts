import { describe, expect, it } from 'vitest';
import type { SubsamplingId } from '../../params';
import { cells, jpegLayout } from '../../layout';
import type { StageId } from '../../stages';
import type { SelectedBlock } from '../../summary';
import { canvasTarget, cellTarget } from '../hit';

const layoutOf = (stage: StageId) => jpegLayout(stage, 1134, 585, 256, 256);
const IMG = { w: 256, h: 256 };
const dpr = () => window.devicePixelRatio || 1;
const rectOf = (stage: StageId, kind: string) => layoutOf(stage).panels.find((p) => p.kind === kind)!.rect;
const centre = (r: { x: number; y: number; w: number; h: number }) => [r.x + r.w / 2, r.y + r.h / 2] as const;

describe('canvasTarget', () => {
  it('maps the centre of a coefficient cell to that coefficient', () => {
    const cell = cells(rectOf('dct', 'coeffs'), dpr())[2 + 8 * 1];
    const [x, y] = centre(cell);
    expect(canvasTarget(layoutOf('dct'), 'dct', IMG, x, y, null, '420')).toEqual({ id: 'dct.coeff', u: 2, v: 1 });
  });

  it('gives a point in the gap between two cells to one of them, never to nothing', () => {
    const boxes = cells(rectOf('dct', 'coeffs'), dpr());
    const left = boxes[2 + 8];
    const right = boxes[3 + 8];
    expect(right.x).toBeGreaterThan(left.x + left.w); // there is a gap
    const x = (left.x + left.w + right.x) / 2;
    const t = canvasTarget(layoutOf('dct'), 'dct', IMG, x, left.y + left.h / 2, null, '420');
    expect(t).not.toBeNull();
    expect([2, 3]).toContain((t as { u: number }).u);
    expect((t as { v: number }).v).toBe(1);
  });

  it('keeps every point of the panel on some cell, edges included', () => {
    const r = rectOf('dct', 'coeffs');
    expect(canvasTarget(layoutOf('dct'), 'dct', IMG, r.x, r.y, null, '420')).toEqual({ id: 'dct.coeff', u: 0, v: 0 });
    expect(canvasTarget(layoutOf('dct'), 'dct', IMG, r.x + r.w - 0.01, r.y + r.h - 0.01, null, '420')).toEqual({ id: 'dct.coeff', u: 7, v: 7 });
  });

  it('maps the image centre on the DCT stage to its pixel', () => {
    const [x, y] = centre(layoutOf('dct').image);
    const t = canvasTarget(layoutOf('dct'), 'dct', IMG, x, y, null, '420') as { id: string; x: number; y: number };
    expect(t.id).toBe('image.pixel');
    expect(Math.abs(t.x - 128)).toBeLessThanOrEqual(1);
    expect(Math.abs(t.y - 128)).toBeLessThanOrEqual(1);
  });

  it('maps the Quantize panels: before, after and the decoder rebuild', () => {
    const layout = layoutOf('quantize');
    const quant = cells(rectOf('quantize', 'quant'), dpr())[0];
    expect(canvasTarget(layout, 'quantize', IMG, ...centre(quant), null, '420')).toEqual({ id: 'quantize.after', u: 0, v: 0 });
    const coeffs = cells(rectOf('quantize', 'coeffs'), dpr())[1];
    expect(canvasTarget(layout, 'quantize', IMG, ...centre(coeffs), null, '420')).toEqual({ id: 'quantize.before', u: 1, v: 0 });
    const rebuild = cells(rectOf('quantize', 'dequant_rebuild'), dpr())[8 * 3 + 5];
    expect(canvasTarget(layout, 'quantize', IMG, ...centre(rebuild), null, '420')).toEqual({ id: 'quantize.rebuild', x: 5, y: 3 });
  });

  it('maps the atlas and the DCT rebuild picture', () => {
    const layout = layoutOf('dct');
    const atlas = cells(rectOf('dct', 'atlas'), dpr())[7];
    expect(canvasTarget(layout, 'dct', IMG, ...centre(atlas), null, '420')).toEqual({ id: 'dct.atlas', u: 7, v: 0 });
    expect(canvasTarget(layout, 'dct', IMG, ...centre(rectOf('dct', 'rebuild')), null, '420')).toEqual({ id: 'dct.k' });
  });

  it('maps the overview panels to the original or the decoded pixel', () => {
    const layout = layoutOf('overview');
    const t = canvasTarget(layout, 'overview', IMG, ...centre(rectOf('overview', 'decoded')), null, '420') as {
      id: string;
      which: string;
      x: number;
    };
    expect([t.id, t.which]).toEqual(['overview.pixel', 'decoded']);
    expect(Math.abs(t.x - 128)).toBeLessThanOrEqual(1);
    const o = canvasTarget(layout, 'overview', IMG, ...centre(rectOf('overview', 'original')), null, '420');
    expect(o).toMatchObject({ id: 'overview.pixel', which: 'original' });
  });

  it('maps every other panel kind to the card the brief names', () => {
    const at = (stage: StageId, kind: string) => canvasTarget(layoutOf(stage), stage, IMG, ...centre(rectOf(stage, kind)), null, '420');
    expect(at('color', 'cube')).toEqual({ id: 'color.cube' });
    expect(at('color', 'plane_cb')).toMatchObject({ id: 'color.plane', plane: 1 });
    expect(at('color', 'plane_y')).toMatchObject({ id: 'color.plane', plane: 0 });
    expect(at('subsample', 'plane_cr')).toMatchObject({ id: 'subsample.plane', which: 'full', plane: 2 });
    expect(at('subsample', 'coded_cb')).toMatchObject({ id: 'subsample.plane', which: 'coded', plane: 1 });
    expect(at('blocks', 'block')).toMatchObject({ id: 'blocks.cell' });
    expect(at('blocks', 'image_grid')).toMatchObject({ id: 'image.pixel' });
    expect(at('zigzag', 'zigzag')).toMatchObject({ id: 'zigzag.grid' });
    expect(at('decode', 'wipe')).toMatchObject({ id: 'decode.wipe' });
    expect(at('decode', 'error')).toMatchObject({ id: 'decode.error' });
  });

  it('reads a pixel under a zoomed panel through the selection\'s window', () => {
    const layout = layoutOf('subsample');
    const panel = layout.panels.find((p) => p.kind === 'plane_cb')!;
    // A chroma block (3, 2) at 4:2:0 anchors at luma block (6, 4): the window is zoomWindow([6, 4], 256, 256) = [36, 20, 32, 32].
    const sel = { component: 1, bx: 3, by: 2 } as SelectedBlock;
    const at = (x: number, y: number, s: SelectedBlock | null = sel, sub: SubsamplingId = '420') =>
      canvasTarget(layout, 'subsample', IMG, x, y, s, sub) as { x: number; y: number };
    const start = at(panel.rect.x + 0.01, panel.rect.y + 0.01);
    expect([start.x, start.y]).toEqual([36, 20]);
    const end = at(panel.rect.x + panel.rect.w - 0.01, panel.rect.y + panel.rect.h - 0.01);
    expect([end.x, end.y]).toEqual([36 + 31, 20 + 31]);
    // 4:4:4 has no chroma-to-luma scaling: the same block anchors at (3, 2), window [12, 4, 32, 32].
    const flat = at(panel.rect.x + 0.01, panel.rect.y + 0.01, sel, '444');
    expect([flat.x, flat.y]).toEqual([12, 4]);
  });

  it('reads the decode stage\'s wipe and error map through a window of their own side', () => {
    const layout = layoutOf('decode'); // 4×: a 64-pixel window
    const sel = { component: 0, bx: 10, by: 10 } as SelectedBlock;
    for (const kind of ['wipe', 'error']) {
      const r = rectOf('decode', kind);
      // Luma block (10, 10) centres at 84: the window is [52, 52, 64, 64].
      const start = canvasTarget(layout, 'decode', IMG, r.x + 0.01, r.y + 0.01, sel, '420') as { x: number; y: number };
      expect([start.x, start.y]).toEqual([52, 52]);
      const end = canvasTarget(layout, 'decode', IMG, r.x + r.w - 0.01, r.y + r.h - 0.01, sel, '420') as { x: number; y: number };
      expect([end.x, end.y]).toEqual([52 + 63, 52 + 63]);
    }
  });

  it('reads a zoomed panel as the whole picture while no block is selected', () => {
    const layout = layoutOf('subsample');
    const panel = layout.panels.find((p) => p.kind === 'coded_cr')!;
    const end = canvasTarget(layout, 'subsample', IMG, panel.rect.x + panel.rect.w - 0.01, panel.rect.y + panel.rect.h - 0.01, null, '420') as {
      x: number;
      y: number;
    };
    expect([end.x, end.y]).toEqual([255, 255]);
  });

  it('gives null outside every panel', () => {
    expect(canvasTarget(layoutOf('dct'), 'dct', IMG, 2, 2, null, '420')).toBeNull();
    expect(canvasTarget(layoutOf('dct'), 'dct', IMG, 5000, 5000, null, '420')).toBeNull();
  });
});

describe('cellTarget', () => {
  it('is null for a panel that carries no card on that stage', () => {
    expect(cellTarget('rle', 'quant', 0, 0)).toBeNull();
    expect(cellTarget('zigzag', 'quant', 3, 4)).toEqual({ id: 'zigzag.grid', u: 3, v: 4 });
  });
});
