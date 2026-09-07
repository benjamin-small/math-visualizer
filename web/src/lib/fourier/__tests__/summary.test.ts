import { describe, expect, it } from 'vitest';
import {
  GENERAL_TEX,
  expansionTex,
  readSummary,
  remainingTerms,
  termTex,
  type FourierSummary,
} from '../summary';

const summary: FourierSummary = {
  origin: [0.1, -0.05],
  total_terms: 2000,
  terms: [
    { freq: 1, amp: 0.5, phase: 0.1 },
    { freq: -1, amp: 0.25, phase: -0.2 },
    { freq: 2, amp: 0.125, phase: 0 },
  ],
};

describe('GENERAL_TEX', () => {
  it('is the epicycle series with a constant term and a sum over k', () => {
    expect(GENERAL_TEX).toContain('c_0');
    expect(GENERAL_TEX).toContain('\\sum_{k}');
    expect(GENERAL_TEX).toContain('\\varphi_k');
  });
});

describe('termTex', () => {
  it('formats a positive-frequency, positive-phase term', () => {
    expect(termTex({ freq: 1, amp: 0.41234, phase: 0.874 })).toBe(
      '0.412\\, e^{\\,i(2\\pi\\cdot 1\\, t \\,+\\, 0.87)}',
    );
  });

  it('parenthesizes negative frequencies and writes negative phases with an explicit minus', () => {
    expect(termTex({ freq: -1, amp: 0.205, phase: -1.314 })).toBe(
      '0.205\\, e^{\\,i(2\\pi\\cdot (-1)\\, t \\,-\\, 1.31)}',
    );
  });

  it('never prints a signed zero phase', () => {
    expect(termTex({ freq: 2, amp: 0.125, phase: -0.001 })).toContain('\\,+\\, 0.00)');
    expect(termTex({ freq: 2, amp: 0.125, phase: 0 })).toContain('\\,+\\, 0.00)');
  });
});

describe('expansionTex', () => {
  const lineCount = (tex: string) => tex.split('\\\\').length;

  it('has min(shown, terms) + 1 lines (origin line + one per term)', () => {
    expect(lineCount(expansionTex(summary, 2))).toBe(3);
    expect(lineCount(expansionTex(summary, 8))).toBe(4);
    expect(lineCount(expansionTex(summary, 0))).toBe(1);
  });

  it('starts with the origin as a complex constant and wraps in aligned', () => {
    const tex = expansionTex(summary, 3);
    expect(tex.startsWith('\\begin{aligned}')).toBe(true);
    expect(tex.endsWith('\\end{aligned}')).toBe(true);
    expect(tex).toContain('z(t) \\approx\\ & (0.100 - 0.050\\,i)');
    expect(tex).toContain('& +\\, 0.500\\, e^{\\,i(2\\pi\\cdot 1\\, t \\,+\\, 0.10)}');
    expect(tex).toContain('& +\\, 0.250\\, e^{\\,i(2\\pi\\cdot (-1)\\, t \\,-\\, 0.20)}');
  });
});

describe('remainingTerms', () => {
  it('is total minus shown, clamped at zero', () => {
    expect(remainingTerms(summary, 8)).toBe(1992);
    expect(remainingTerms({ ...summary, total_terms: 3 }, 8)).toBe(0);
  });
});

describe('readSummary', () => {
  it('rejects null, undefined, empty objects, and zero-term summaries', () => {
    expect(readSummary(null)).toBeNull();
    expect(readSummary(undefined)).toBeNull();
    expect(readSummary({})).toBeNull();
    expect(readSummary({ origin: [0, 0], total_terms: 0, terms: [] })).toBeNull();
    expect(readSummary('garbage')).toBeNull();
    expect(readSummary(42)).toBeNull();
  });

  it('rejects malformed origins and terms', () => {
    expect(readSummary({ origin: [0], total_terms: 1, terms: [{ freq: 1, amp: 1, phase: 0 }] })).toBeNull();
    expect(readSummary({ origin: [0, NaN], total_terms: 1, terms: [{ freq: 1, amp: 1, phase: 0 }] })).toBeNull();
    expect(readSummary({ origin: [0, 0], total_terms: 1, terms: [{ freq: '1', amp: 1, phase: 0 }] })).toBeNull();
    expect(readSummary({ origin: [0, 0], total_terms: 1, terms: [null] })).toBeNull();
  });

  it('accepts a valid summary and returns a normalized copy', () => {
    const raw = {
      origin: [0.1, -0.05],
      total_terms: 2000,
      terms: [{ freq: 1, amp: 0.5, phase: 0.1, extra: 'ignored' }],
    };
    const s = readSummary(raw);
    expect(s).toEqual({ origin: [0.1, -0.05], total_terms: 2000, terms: [{ freq: 1, amp: 0.5, phase: 0.1 }] });
    expect(s).not.toBe(raw);
    expect(s!.terms).not.toBe(raw.terms);
  });
});
