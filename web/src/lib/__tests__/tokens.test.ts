import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, '../../app.css'), 'utf8');

describe('design tokens', () => {
  it('declares the light palette on :root', () => {
    for (const [name, value] of [
      ['--paper', '#FAF7F2'], ['--card', '#FFFFFF'], ['--line', '#E7E0D5'], ['--stone', '#6E655A'],
      ['--ink', '#2B2620'], ['--accent', '#A65A31'], ['--accent-deep', '#8A4722'], ['--tint', '#F4E6DC'],
      ['--stage', '#111111'], ['--ring', '#2B2620'],
    ]) expect(css).toMatch(new RegExp(`${name}:\\s*${value}`, 'i'));
  });
  it('declares the dark palette for both the OS and the explicit switch', () => {
    expect(css).toMatch(/prefers-color-scheme:\s*dark/);
    expect(css).toMatch(/:root:not\(\[data-theme="light"\]\)/);
    expect(css).toMatch(/:root\[data-theme="dark"\]/);
    expect(css).toMatch(/--paper:\s*#14171C/i);
    expect(css).toMatch(/--card:\s*#1C2027/i);
    expect(css).not.toMatch(/#1E1B17/i); // the warm charcoal is gone
    expect(css).toMatch(/--accent:\s*#D08A62/i);
  });
  it('keeps primary-button text on the paper token so it passes contrast in both themes', () => {
    const shell = readFileSync(resolve(__dirname, '../components/LabShell.svelte'), 'utf8');
    expect(shell).toMatch(/\.btn\.primary\)\s*\{[^}]*color:\s*var\(--paper\)/);
    expect(shell).not.toMatch(/\.btn\.primary\)\s*\{[^}]*color:\s*#fff/);
  });

  it('uses Plex Sans for text and Plex Mono for numbers', () => {
    expect(css).toMatch(/--font-sans:\s*"IBM Plex Sans"/);
    expect(css).toMatch(/--font-mono:\s*"IBM Plex Mono"/);
    expect(css).toMatch(/\.mono\s*\{[^}]*font-family:\s*var\(--font-mono\)/);
  });
});
