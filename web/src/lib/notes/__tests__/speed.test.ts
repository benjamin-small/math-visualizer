import { describe, it, expect } from 'vitest';
import {
  MIN_HZ,
  MAX_HZ,
  RAMP_MS,
  DEFAULT_SPEED_HZ,
  sliderToHz,
  hzToSlider,
  formatHz,
  rampSpeedAt,
} from '../speed';

describe('constants', () => {
  it('span 0.25 to 1000 swings per second, start at 0.5, and ramp over two and a half seconds', () => {
    expect(MIN_HZ).toBe(0.25);
    expect(MAX_HZ).toBe(1000);
    expect(DEFAULT_SPEED_HZ).toBe(0.5);
    expect(RAMP_MS).toBe(2500);
  });
});

describe('sliderToHz', () => {
  it('runs log-spaced from MIN_HZ at 0 to MAX_HZ at 1', () => {
    expect(sliderToHz(0)).toBe(0.25);
    expect(sliderToHz(1)).toBe(1000);
    // The midpoint of a log scale is the geometric mean of the ends.
    expect(sliderToHz(0.5)).toBeCloseTo(15.81, 2);
    expect(sliderToHz(0.5)).toBeCloseTo(Math.sqrt(MIN_HZ * MAX_HZ), 10);
  });

  it('clamps a slider value outside [0, 1] to the ends', () => {
    expect(sliderToHz(2)).toBe(1000);
    expect(sliderToHz(-1)).toBe(0.25);
  });

  it('rises with the slider', () => {
    let last = 0;
    for (const t of [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1]) {
      expect(sliderToHz(t)).toBeGreaterThan(last);
      last = sliderToHz(t);
    }
  });

  it('puts the default speed inside the slider, not at an end', () => {
    expect(hzToSlider(DEFAULT_SPEED_HZ)).toBeGreaterThan(0);
    expect(hzToSlider(DEFAULT_SPEED_HZ)).toBeLessThan(0.2);
  });
});

describe('hzToSlider', () => {
  it.each([0, 0.25, 0.5, 0.75, 1])('inverts sliderToHz at %f', (t) => {
    expect(hzToSlider(sliderToHz(t))).toBeCloseTo(t, 10);
  });

  it('clamps rates outside the slider to its ends', () => {
    expect(hzToSlider(0.1)).toBe(0);
    expect(hzToSlider(5000)).toBe(1);
    expect(hzToSlider(MIN_HZ)).toBe(0);
    expect(hzToSlider(MAX_HZ)).toBe(1);
  });
});

describe('formatHz', () => {
  it('shows two decimals below 10 Hz, one below 100 Hz, none above', () => {
    expect(formatHz(0.5)).toBe('0.50 Hz');
    expect(formatHz(0.25)).toBe('0.25 Hz');
    expect(formatHz(15.81)).toBe('15.8 Hz');
    expect(formatHz(261.63)).toBe('262 Hz');
    expect(formatHz(440)).toBe('440 Hz');
    expect(formatHz(1000)).toBe('1000 Hz');
  });

  it('switches precision exactly at 10 and 100', () => {
    expect(formatHz(9.99)).toBe('9.99 Hz');
    expect(formatHz(10)).toBe('10.0 Hz');
    expect(formatHz(99.9)).toBe('99.9 Hz');
    expect(formatHz(100)).toBe('100 Hz');
  });
});

describe('rampSpeedAt', () => {
  it('starts at `from` and ends at `to`', () => {
    expect(rampSpeedAt(0.5, 440, 0)).toBe(0.5);
    expect(rampSpeedAt(0.5, 440, 1)).toBe(440);
  });

  it('moves exponentially: the halfway point is the geometric mean', () => {
    expect(rampSpeedAt(0.5, 440, 0.5)).toBeCloseTo(Math.sqrt(0.5 * 440), 10);
  });

  it('multiplies by the same factor over equal time steps', () => {
    const a = rampSpeedAt(2, 500, 0);
    const b = rampSpeedAt(2, 500, 0.25);
    const c = rampSpeedAt(2, 500, 0.5);
    expect(c / b).toBeCloseTo(b / a, 10);
  });

  it('runs downward just as well', () => {
    expect(rampSpeedAt(440, 0.5, 0)).toBe(440);
    expect(rampSpeedAt(440, 0.5, 1)).toBe(0.5);
    expect(rampSpeedAt(440, 0.5, 0.5)).toBeCloseTo(Math.sqrt(440 * 0.5), 10);
  });

  it('clamps t to [0, 1]', () => {
    expect(rampSpeedAt(0.5, 440, 2)).toBe(440);
    expect(rampSpeedAt(0.5, 440, -1)).toBe(0.5);
  });

  it('floors `from` at 0.01, so a zero start gives a finite ramp instead of NaN', () => {
    expect(rampSpeedAt(0, 440, 0)).toBe(0.01);
    expect(Number.isFinite(rampSpeedAt(0, 440, 0.5))).toBe(true);
    expect(rampSpeedAt(0, 440, 1)).toBe(440);
  });
});
