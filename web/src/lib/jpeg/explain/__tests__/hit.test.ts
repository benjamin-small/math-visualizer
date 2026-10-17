import { describe, expect, it } from 'vitest';
import { cells, jpegLayout } from '../../layout';
import type { StageId } from '../../stages';
import { canvasTarget, cellTarget } from '../hit';

const layoutOf = (stage: StageId) => jpegLayout(stage, 1134, 585, 256, 256, [10, 10]);
const IMG = { w: 256, h: 256 };
const dpr = () => window.devicePixelRatio || 1;
const rectOf = (stage: StageId, kind: string) => layoutOf(stage).panels.find((p) => p.kind === kind)!.rect;
const centre = (r: { x: number; y: number; w: number; h: number }) => [r.x + r.w / 2, r.y + r.h / 2] as const;

describe('canvasTarget', () => {
  it('maps the centre of a coefficient cell to that coefficient', () => {
    const cell = cells(rectOf('dct', 'coeffs'), dpr())[2 + 8 * 1];
    const [x, y] = centre(cell);
    expect(canvasTarget(layoutOf('dct'), 'dct', IMG, x, y, null)).toEqual({ id: 'dct.coeff', u: 2, v: 1 });
  });

  it('gives a point in the gap between two cells to one of them, never to nothing', () => {
    const boxes = cells(rectOf('dct', 'coeffs'), dpr());
    const left = boxes[2 + 8];
    const right = boxes[3 + 8];
    expect(right.x).toBeGreaterThan(left.x + left.w); // there is a gap
    const x = (left.x + left.w + right.x) / 2;
    const t = canvasTarget(layoutOf('dct'), 'dct', IMG, x, left.y + left.h / 2, null);
    expect(t).not.toBeNull();
    expect([2, 3]).toContain((t as { u: number }).u);
    expect((t as { v: number }).v).toBe(1);
  });

  it('keeps every point of the panel on some cell, edges included', () => {
    const r = rectOf('dct', 'coeffs');
    expect(canvasTarget(layoutOf('dct'), 'dct', IMG, r.x, r.y, null)).toEqual({ id: 'dct.coeff', u: 0, v: 0 });
    expect(canvasTarget(layoutOf('dct'), 'dct', IMG, r.x + r.w - 0.01, r.y + r.h - 0.01, null)).toEqual({ id: 'dct.coeff', u: 7, v: 7 });
  });

  it('maps the image centre on the DCT stage to its pixel', () => {
    const [x, y] = centre(layoutOf('dct').image);
    const t = canvasTarget(layoutOf('dct'), 'dct', IMG, x, y, null) as { id: string; x: number; y: number };
    expect(t.id).toBe('image.pixel');
    expect(Math.abs(t.x - 128)).toBeLessThanOrEqual(1);
    expect(Math.abs(t.y - 128)).toBeLessThanOrEqual(1);
  });

  it('maps the Quantize panels: before, after and the decoder rebuild', () => {
    const layout = layoutOf('quantize');
    const quant = cells(rectOf('quantize', 'quant'), dpr())[0];
    expect(canvasTarget(layout, 'quantize', IMG, ...centre(quant), null)).toEqual({ id: 'quantize.after', u: 0, v: 0 });
    const coeffs = cells(rectOf('quantize', 'coeffs'), dpr())[1];
    expect(canvasTarget(layout, 'quantize', IMG, ...centre(coeffs), null)).toEqual({ id: 'quantize.before', u: 1, v: 0 });
    const rebuild = cells(rectOf('quantize', 'dequant_rebuild'), dpr())[8 * 3 + 5];
    expect(canvasTarget(layout, 'quantize', IMG, ...centre(rebuild), null)).toEqual({ id: 'quantize.rebuild', x: 5, y: 3 });
  });

  it('maps the atlas and the DCT rebuild picture', () => {
    const layout = layoutOf('dct');
    const atlas = cells(rectOf('dct', 'atlas'), dpr())[7];
    expect(canvasTarget(layout, 'dct', IMG, ...centre(atlas), null)).toEqual({ id: 'dct.atlas', u: 7, v: 0 });
    expect(canvasTarget(layout, 'dct', IMG, ...centre(rectOf('dct', 'rebuild')), null)).toEqual({ id: 'dct.k' });
  });

  it('maps the overview panels to the original or the decoded pixel', () => {
    const layout = layoutOf('overview');
    const t = canvasTarget(layout, 'overview', IMG, ...centre(rectOf('overview', 'decoded')), null) as {
      id: string;
      which: string;
      x: number;
    };
    expect([t.id, t.which]).toEqual(['overview.pixel', 'decoded']);
    expect(Math.abs(t.x - 128)).toBeLessThanOrEqual(1);
    const o = canvasTarget(layout, 'overview', IMG, ...centre(rectOf('overview', 'original')), null);
    expect(o).toMatchObject({ id: 'overview.pixel', which: 'original' });
  });

  it('maps every other panel kind to the card the brief names', () => {
    const at = (stage: StageId, kind: string) => canvasTarget(layoutOf(stage), stage, IMG, ...centre(rectOf(stage, kind)), null);
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

  it('reads a magnified colour plane through its crop', () => {
    const layout = layoutOf('subsample');
    const panel = layout.panels.find((p) => p.kind === 'plane_cb')!;
    const crop = panel.crop!;
    const t = canvasTarget(layout, 'subsample', IMG, panel.rect.x + 0.01, panel.rect.y + 0.01, null) as { x: number; y: number };
    expect([t.x, t.y]).toEqual([crop[0], crop[1]]);
    const end = canvasTarget(layout, 'subsample', IMG, panel.rect.x + panel.rect.w - 0.01, panel.rect.y + panel.rect.h - 0.01, null) as {
      x: number;
      y: number;
    };
    expect([end.x, end.y]).toEqual([crop[0] + crop[2] - 1, crop[1] + crop[3] - 1]);
  });

  it('gives null outside every panel', () => {
    expect(canvasTarget(layoutOf('dct'), 'dct', IMG, 2, 2, null)).toBeNull();
    expect(canvasTarget(layoutOf('dct'), 'dct', IMG, 5000, 5000, null)).toBeNull();
  });
});

describe('cellTarget', () => {
  it('is null for a panel that carries no card on that stage', () => {
    expect(cellTarget('rle', 'quant', 0, 0)).toBeNull();
    expect(cellTarget('zigzag', 'quant', 3, 4)).toEqual({ id: 'zigzag.grid', u: 3, v: 4 });
  });
});
