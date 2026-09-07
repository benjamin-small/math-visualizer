import { describe, it, expect } from 'vitest';
import { parseHash, DEFAULT_LAB, LAB_IDS } from '../router';

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
