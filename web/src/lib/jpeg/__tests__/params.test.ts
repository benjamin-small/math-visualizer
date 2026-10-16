import { describe, it, expect } from 'vitest';
import { DEFAULTS, buildParams, clampQuality, mcuCount, mcuSize, parseParams } from '../params';
import { STAGES, readyStage, stepStage } from '../stages';

describe('params', () => {
  it('reads an empty link as the defaults and writes the defaults as an empty link', () => {
    expect(parseParams('')).toEqual(DEFAULTS);
    expect(buildParams(DEFAULTS)).toBe('');
  });

  it('round-trips every field', () => {
    const p = { img: 'text', quality: 30, subsampling: '444', huffman: 'standard', stage: 'dct', block: [12, 7] } as const;
    const q = buildParams({ ...p, block: [12, 7] });
    expect(q).toBe('img=text&q=30&s=444&h=std&stage=dct&b=12,7');
    expect(parseParams(q)).toEqual({ ...p, block: [12, 7] });
  });

  it('falls back field by field on junk', () => {
    const p = parseParams('img=photo&q=abc&s=411&h=fast&stage=nope&b=1,-2');
    expect(p).toEqual(DEFAULTS);
    expect(parseParams('b=1,2,3').block).toBeUndefined();
    expect(parseParams('b=1.5,2').block).toBeUndefined();
  });

  it('clamps quality to whole numbers 1–100', () => {
    expect(clampQuality(0)).toBe(1);
    expect(clampQuality(250)).toBe(100);
    expect(clampQuality('49.6')).toBe(50);
    expect(clampQuality(NaN)).toBe(50);
    expect(parseParams('q=0').quality).toBe(1);
  });

  it('counts MCUs like the encoder', () => {
    expect(mcuSize('444')).toEqual([8, 8]);
    expect(mcuSize('422')).toEqual([16, 8]);
    expect(mcuCount(256, 256, '420')).toBe(256);
    expect(mcuCount(256, 256, '444')).toBe(1024);
    expect(mcuCount(99, 61, '420')).toBe(28);
    expect(mcuCount(1, 1, '422')).toBe(1);
  });
});

describe('stages', () => {
  it('lists nine stages, the first four ready', () => {
    expect(STAGES.map((s) => s.id)).toEqual(['color', 'subsample', 'blocks', 'dct', 'quantize', 'zigzag', 'rle', 'huffman', 'decode']);
    expect(STAGES.filter((s) => s.ready).map((s) => s.id)).toEqual(['color', 'subsample', 'blocks', 'dct']);
  });

  it('only lands on ready stages', () => {
    expect(readyStage('dct')).toBe('dct');
    expect(readyStage('huffman')).toBe('color');
    expect(readyStage(undefined)).toBe('color');
    expect(stepStage('color', -1)).toBe('color');
    expect(stepStage('blocks', 1)).toBe('dct');
    expect(stepStage('dct', 1)).toBe('dct');
    expect(stepStage('quantize', 1)).toBe('color');
  });
});
