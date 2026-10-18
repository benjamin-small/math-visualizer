import { describe, expect, it } from 'vitest';
import { explain } from '..';
import { makeContext } from './fixture';

describe('Tour cards', () => {
  it('says which step this is and what the lab calls it', () => {
    const e = explain({ id: 'tour.step', step: 'round' }, makeContext({ stage: 'overview' }))!;
    expect(e.title).toBe('Round off fine detail');
    expect(e.value).toBe('Step 5 of 9');
    expect(e.consequence).toContain('Loses detail');
    expect(e.consequence).toContain('step 5, Quantize');
    expect(e.acts).toBe(true);
  });

  it('says nothing is lost on a lossless step', () => {
    const e = explain({ id: 'tour.step', step: 'line' }, makeContext({ stage: 'overview' }))!;
    expect(e.consequence).toContain('Nothing is lost here.');
  });

  it('shows the slider value and, when it is high, what that keeps', () => {
    const low = explain({ id: 'tour.quality', quality: 30 }, makeContext({ stage: 'overview' }))!;
    expect(low.value).toBe('30');
    expect(low.consequence).toBe('Lower means a smaller file and softer edges.');
    const high = explain({ id: 'tour.quality', quality: 95 }, makeContext({ stage: 'overview' }))!;
    expect(high.consequence).toContain('Higher keeps more detail.');
    expect(low.acts).toBe(true);
  });

  it('describes the lab button that opens the tour', () => {
    const e = explain({ id: 'tour.open' }, makeContext({ stage: 'overview' }))!;
    expect(e.title).toBe('How JPEG works');
    expect(e.value).toBe('9 steps');
    expect(e.acts).toBe(true);
  });
});
