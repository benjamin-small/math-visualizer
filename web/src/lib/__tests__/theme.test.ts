import { describe, it, expect, beforeEach } from 'vitest';
import { readTheme, applyTheme, nextTheme } from '../theme';

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('theme', () => {
  it('defaults to system and cycles system → light → dark → system', () => {
    expect(readTheme()).toBe('system');
    expect(nextTheme('system')).toBe('light');
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('system');
  });
  it('applies light/dark as data-theme and persists; system clears both', () => {
    applyTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem('theme')).toBe('dark');
    expect(readTheme()).toBe('dark');
    applyTheme('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(window.localStorage.getItem('theme')).toBeNull();
  });
  it('ignores garbage in storage', () => {
    window.localStorage.setItem('theme', 'purple');
    expect(readTheme()).toBe('system');
  });
});
