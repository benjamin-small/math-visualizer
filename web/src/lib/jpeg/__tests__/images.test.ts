import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('draws the thumbnail of a generated picture on a canvas', async () => {
    const putImageData = vi.fn();
    const createImageData = vi.fn((w: number, h: number) => ({
      width: w,
      height: h,
      data: new Uint8ClampedArray(w * h * 4),
    }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      createImageData,
      putImageData,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AAAA');
    expect(await thumbnail('noise', 32)).toBe('data:image/png;base64,AAAA');
    expect(putImageData).toHaveBeenCalledTimes(1);
    const img = putImageData.mock.calls[0][0] as { width: number; height: number };
    expect([img.width, img.height]).toEqual([32, 32]);
  });
});
