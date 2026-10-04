import { describe, it, expect } from 'vitest';
import { parseHash, parseHashQuery, buildQuery, LAB_IDS } from '../router';

describe('parseHash', () => {
  it('maps #/fourier to fourier', () => {
    expect(parseHash('#/fourier')).toBe('fourier');
  });
  it('accepts the slash-less form', () => {
    expect(parseHash('#fourier')).toBe('fourier');
  });
  it('routes empty, bare, and unknown hashes to home', () => {
    for (const h of ['', '#', '#/', '#/nope', '#/nope?x=1']) expect(parseHash(h)).toBe('home');
  });
  it('maps #/sorting to sorting', () => {
    expect(parseHash('#/sorting')).toBe('sorting');
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
  it('splits a sorting link into its id and query', () => {
    expect(parseHash('#/sorting?n=80')).toBe('sorting');
    expect(parseHashQuery('#/sorting?n=80')).toBe('n=80');
  });
  it('splits a notes link into its id and query', () => {
    expect(parseHash('#/notes?n=60,67')).toBe('notes');
    expect(parseHashQuery('#/notes?n=60,67')).toBe('n=60,67');
  });
  it('buildQuery keeps commas raw, and a list still round-trips through URLSearchParams', () => {
    expect(buildQuery({ n: '60,67' })).toBe('n=60,67');
    expect(buildQuery({ n: '60,67', t: 'equal' })).toBe('n=60,67&t=equal');
    expect(new URLSearchParams(buildQuery({ n: '60,67' })).get('n')).toBe('60,67');
    // Only the encoded comma is restored: a literal "%2C" in a value stays escaped.
    expect(new URLSearchParams(buildQuery({ text: 'a,%2C' })).get('text')).toBe('a,%2C');
  });
  it('buildQuery omits undefined/empty values and encodes the rest', () => {
    expect(buildQuery({ text: 'HELLO WORLD', n: '12' })).toBe('text=HELLO+WORLD&n=12');
    expect(buildQuery({ text: undefined, n: '' })).toBe('');
    expect(new URLSearchParams(buildQuery({ text: 'a&b=c' })).get('text')).toBe('a&b=c');
  });
});
