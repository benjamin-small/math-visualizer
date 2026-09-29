import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.svelte')) out.push(p);
  }
  return out;
}

// Emoji presentation plus the misc-symbols/dingbats/arrows blocks the old UI
// used for glyph buttons (▶ ⏸ ↺ ✓ 🔊). Icons come from Icon.svelte instead.
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{23E9}-\u{23FA}]/u;

describe('UI copy', () => {
  it('uses no emoji or symbol glyphs in components (icons come from Icon.svelte)', () => {
    const offenders = walk(resolve(__dirname, '../components'))
      .filter((f) => EMOJI.test(readFileSync(f, 'utf8')))
      .map((f) => f.replace(/.*\/web\//, 'web/'));
    expect(offenders).toEqual([]);
  });
});
