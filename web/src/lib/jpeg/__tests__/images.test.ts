import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadVizCore } from '../../wasm/loader';
import { IMAGE_IDS } from '../params';
import { GROUP_LABELS, IMAGES, loadPicture, pictureUrl, thumbnail } from '../images';

vi.mock('../../wasm/loader', async () => {
  const { makeVizMock } = await import('../../test/fakeViz');
  return { loadVizCore: vi.fn(() => Promise.resolve(makeVizMock())) };
});

const BUNDLED = ['spring', 'shuttle', 'doge', 'honest-work', 'cartoon'];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('picture catalog', () => {
  it('lists the eleven pictures in gallery order and groups', () => {
    expect(IMAGES.map((i) => i.id)).toEqual([...IMAGE_IDS]);
    expect(IMAGE_IDS).toEqual([
      'spring',
      'shuttle',
      'doge',
      'honest-work',
      'cartoon',
      'cosines',
      'cosines-shifted',
      'noise',
      'gradient',
      'text',
      'bars',
    ]);
    const count = (g: string) => IMAGES.filter((i) => i.group === g).length;
    expect([count('photos'), count('memes'), count('maths'), count('tests')]).toEqual([2, 3, 3, 3]);
    expect(IMAGES.map((i) => i.group)).toEqual([
      ...Array(2).fill('photos'),
      ...Array(3).fill('memes'),
      ...Array(3).fill('maths'),
      ...Array(3).fill('tests'),
    ]);
    expect(GROUP_LABELS).toEqual({ photos: 'Photos', memes: 'Memes', maths: 'Maths', tests: 'Artifact tests' });
    for (const im of IMAGES) {
      expect(im.label).not.toBe('');
      expect(im.title).not.toBe('');
    }
  });

  it('has a credit for every bundled picture and none for generated ones', () => {
    for (const im of IMAGES) {
      if (BUNDLED.includes(im.id)) {
        expect(im.file, im.id).toBeDefined();
        expect(im.credit?.title, im.id).toBeTruthy();
        expect(im.credit?.author, im.id).toBeTruthy();
        expect(im.credit?.licence, im.id).toBeTruthy();
      } else {
        expect(im.file, im.id).toBeUndefined();
        expect(im.credit, im.id).toBeUndefined();
      }
    }
    expect(IMAGES.find((i) => i.id === 'cartoon')?.credit?.url).toBeUndefined();
    expect(IMAGES.find((i) => i.id === 'spring')?.credit).toEqual({
      title: 'Grand Prismatic Spring, Yellowstone',
      author: 'Jim Peaco, National Park Service',
      licence: 'Public domain',
      url: 'https://commons.wikimedia.org/wiki/File:Grand_prismatic_spring.jpg',
    });
  });

  it('builds picture URLs from BASE_URL', () => {
    vi.stubEnv('BASE_URL', '/math-visualizer/');
    expect(pictureUrl('spring')).toBe('/math-visualizer/jpeg/spring.png');
  });

  it('ships every bundled picture at its catalog size and under 150 KB', () => {
    for (const im of IMAGES.filter((i) => i.file)) {
      const path = resolve(__dirname, '../../../../public/jpeg', `${im.id}.png`);
      expect(statSync(path).size, im.id).toBeLessThanOrEqual(150_000);
      const png = readFileSync(path);
      expect(png.readUInt32BE(16), `${im.id} width`).toBe(im.file!.w);
      expect(png.readUInt32BE(20), `${im.id} height`).toBe(im.file!.h);
    }
    expect(IMAGES.filter((i) => i.file).map((i) => i.id)).toEqual(BUNDLED);
  });

  it('rejects a bundled picture that cannot be fetched', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 404 })));
    await expect(loadPicture('spring')).rejects.toThrow(/Grand Prismatic Spring/);
  });

  it('loads a generated picture through the kit', async () => {
    const im = await loadPicture('cosines');
    expect([im.w, im.h, im.rgba.length]).toEqual([256, 256, 256 * 256 * 4]);
  });

  it('uses the file itself as the thumbnail of a bundled picture', async () => {
    vi.stubEnv('BASE_URL', '/math-visualizer/');
    expect(await thumbnail('doge', 64)).toBe('/math-visualizer/jpeg/doge.png');
  });

  /** Run `thumbnail(id, side)` against a recording canvas; returns the source and output canvases' contexts. */
  async function drawThumbnail(id: Parameters<typeof thumbnail>[0], side: number) {
    const builtin = vi.fn((_id: string, w: number, h: number) => new Uint8Array(w * h * 4));
    vi.mocked(loadVizCore).mockResolvedValueOnce({ jpeg_builtin_image: builtin } as never);
    const drawn: { canvas: HTMLCanvasElement; ctx: Record<string, ReturnType<typeof vi.fn>> }[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      const ctx = {
        createImageData: vi.fn((w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) })),
        putImageData: vi.fn(),
        drawImage: vi.fn(),
        imageSmoothingEnabled: false,
        imageSmoothingQuality: 'low',
      };
      drawn.push({ canvas: this, ctx: ctx as never });
      return ctx as unknown as CanvasRenderingContext2D;
    } as never);
    const toDataURL = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AAAA');
    expect(await thumbnail(id, side)).toBe('data:image/png;base64,AAAA');
    // The kit is asked for the picture the reader gets, not one at thumbnail size.
    expect(builtin).toHaveBeenCalledWith(id, 256, 256);
    const source = drawn.find((d) => d.canvas.width === 256);
    const out = drawn.find((d) => d.canvas.width === side);
    expect(source?.ctx.putImageData).toHaveBeenCalledTimes(1);
    expect(out?.canvas.height).toBe(side);
    expect(toDataURL.mock.contexts[0]).toBe(out?.canvas);
    return { source, out };
  }

  it('draws a smooth generated thumbnail by scaling the full-size picture', async () => {
    const { source, out } = await drawThumbnail('gradient', 32);
    expect(out?.ctx.drawImage).toHaveBeenCalledWith(source?.canvas, 0, 0, 32, 32);
    expect(out?.ctx.imageSmoothingEnabled).toBe(true);
  });

  it('cuts a pattern thumbnail 1:1 from the centre instead of scaling it', async () => {
    const { source, out } = await drawThumbnail('cosines-shifted', 64);
    expect(out?.ctx.drawImage).toHaveBeenCalledWith(source?.canvas, 96, 96, 64, 64, 0, 0, 64, 64);
    expect(out?.ctx.imageSmoothingEnabled).toBe(false);
  });

  it('labels the noise picture "Pure noise"', () => {
    expect(IMAGES.find((i) => i.id === 'noise')?.label).toBe('Pure noise');
  });

  it('makes a generated thumbnail once per picture and size, however often the gallery opens', async () => {
    await drawThumbnail('bars', 40);
    const loads = vi.mocked(loadVizCore).mock.calls.length;
    // The second visit is answered from memory: the kit is not asked again and nothing is drawn.
    expect(await thumbnail('bars', 40)).toBe('data:image/png;base64,AAAA');
    expect(vi.mocked(loadVizCore).mock.calls.length).toBe(loads);
    // Another size is another thumbnail.
    await drawThumbnail('bars', 48);
    expect(vi.mocked(loadVizCore).mock.calls.length).toBe(loads + 1);
  });

  it('does not cache a thumbnail that failed to draw', async () => {
    vi.mocked(loadVizCore).mockRejectedValueOnce(new Error('wasm down'));
    await expect(thumbnail('cosines', 24)).rejects.toThrow('wasm down');
    await drawThumbnail('cosines', 24);
  });

  it('crops the fine-pattern pictures and scales the smooth ones', () => {
    const crop = IMAGES.filter((i) => i.thumb === 'crop').map((i) => i.id);
    expect(crop).toEqual(['cosines', 'cosines-shifted', 'noise', 'text']);
    expect(IMAGES.filter((i) => i.thumb === 'scale').map((i) => i.id)).toEqual(['gradient', 'bars']);
    // Bundled pictures use their own file and need neither.
    expect(IMAGES.filter((i) => i.file && i.thumb)).toEqual([]);
  });

  it('says so when a bundled picture arrives but is not a readable image', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, blob: () => Promise.resolve(new Blob(['<html>'])) })));
    vi.stubGlobal('createImageBitmap', vi.fn(() => Promise.reject(new Error('bad'))));
    await expect(loadPicture('doge')).rejects.toThrow('Could not load the picture "Doge" (the file is not a readable image).');
  });
});
