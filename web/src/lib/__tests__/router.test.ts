import { describe, it, expect } from 'vitest';
import { parseHash, parseHashQuery, buildQuery, DEFAULT_LAB, LAB_IDS } from '../router';

describe('parseHash', () => {
  it('maps #/fourier to fourier', () => {
    expect(parseHash('#/fourier')).toBe('fourier');
  });
  it('accepts the slash-less form', () => {
    expect(parseHash('#fourier')).toBe('fourier');
  });
  it('defaults empty, bare, and unknown hashes to sierpinski', () => {
    expect(parseHash('')).toBe(DEFAULT_LAB);
    expect(parseHash('#')).toBe(DEFAULT_LAB);
    expect(parseHash('#/')).toBe(DEFAULT_LAB);
    expect(parseHash('#/nope')).toBe(DEFAULT_LAB);
  });
  it('ignores trailing path/query segments', () => {
    expect(parseHash('#/fourier/extra')).toBe('fourier');
    expect(parseHash('#/fourier?x=1')).toBe('fourier');
  });
  it('every LAB_ID round-trips', () => {
    for (const id of LAB_IDS) expect(parseHash(`#/${id}`)).toBe(id);
  });
});

describe('parseHashQuery / buildQuery', () => {
  it('extracts the query part of a hash route', () => {
    expect(parseHashQuery('#/fourier?text=HI&n=5')).toBe('text=HI&n=5');
    expect(parseHashQuery('#/fourier')).toBe('');
    expect(parseHashQuery('')).toBe('');
  });
  it('route id parsing ignores the query', () => {
    expect(parseHash('#/fourier?text=HI')).toBe('fourier');
  });
  it('buildQuery omits undefined/empty values and encodes the rest', () => {
    expect(buildQuery({ text: 'HELLO WORLD', n: '12' })).toBe('text=HELLO+WORLD&n=12');
    expect(buildQuery({ text: undefined, n: '' })).toBe('');
    expect(new URLSearchParams(buildQuery({ text: 'a&b=c' })).get('text')).toBe('a&b=c');
  });
});
