# Showcase Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the web UI as a warm-paper showcase: a gallery home with three live previews, and lab pages with a labelled bezel, a framed dark stage with a progress "clock line", a legend, and the explanation as an article below.

**Architecture:** Svelte 5 (runes) app in `web/`, driven by the existing `viz-core` WASM engine. Shared design tokens in `app.css` (light + dark). Engine boot/loop/teardown is extracted into `useEngine.svelte.ts` so both `LabShell` (lab pages) and `LabTile` (home cards) use it. Labs feed the shell through snippets: `controls`, `legend`, `story`, `overlay`.

**Tech Stack:** Svelte 5, Vite 5, Vitest + @testing-library/svelte (jsdom), TypeScript. Fonts from Google Fonts. No Rust changes.

**Spec:** `docs/superpowers/specs/2026-09-28-showcase-redesign-design.md`

## Global Constraints

- Tokens exactly as the spec's table; every colour in a component comes from a `var(--…)`.
- Fonts: `IBM Plex Sans` 400/500/600, `IBM Plex Mono` 400/500; nothing heavier than 600.
- Radii: panels/cards 14px, buttons 9px, inputs 8px. Hairline `1px solid var(--line)`; panel shadow `0 1px 2px rgba(43,38,32,.06)`.
- No emoji in any `.svelte` file. Icons only via `Icon.svelte`.
- Every button has visible text, or (zoom −/+ only) an `aria-label` + `title`.
- Existing behaviour and URLs (`#/fourier?text=…&n=…`, `#/sorting?n=…`) unchanged.
- Run from `web/`: `npx vitest run` and `npm run check` must both pass before each commit. Rust untouched.
- Commit messages: conventional (`feat(web): …`), no attribution lines.
- The dev server for manual checks: `.claude/launch.json` → `web` (Vite picks a free port if 5173 is taken; the log prints it).

---

## File map

| File | Responsibility |
|---|---|
| `web/index.html` | Font links; inline pre-paint theme script |
| `web/src/app.css` | Tokens (light/dark), base typography, focus ring, motion |
| `web/src/lib/theme.ts` | Pure: `Theme` type, read/write/apply |
| `web/src/lib/router.ts`, `router.svelte.ts` | `'home'` route |
| `web/src/lib/components/Icon.svelte` | Inline outline icon set |
| `web/src/lib/components/ThemeToggle.svelte` | System → Light → Dark button |
| `web/src/lib/components/useEngine.svelte.ts` | Engine boot, rAF loop, resize, teardown |
| `web/src/lib/components/LabShell.svelte` | Title, bezel, clock line, stage, legend, story |
| `web/src/lib/components/LabTile.svelte` | Home card with a live engine + readout |
| `web/src/lib/components/Home.svelte` | Thesis + three tiles + footer |
| `web/src/App.svelte` | Bar (wordmark, tabs, Source, theme) + route switch |
| `web/src/lib/components/labs/*.svelte` | Each lab's snippets and copy |

---

### Task 1: Tokens, fonts, base styles

**Files:**
- Modify: `web/index.html`
- Modify: `web/src/app.css`
- Test: `web/src/lib/__tests__/tokens.test.ts`

**Interfaces:**
- Produces: CSS custom properties on `:root`: `--paper --card --line --stone --ink --accent --accent-deep --tint --stage --ring --nav-h --font-sans --font-mono --radius-panel --radius-button --radius-input --shadow-panel --shadow-lift`; class `.mono`; `html[data-theme]` switching.

- [ ] **Step 1: Write the failing test** (`web/src/lib/__tests__/tokens.test.ts`) — asserts the stylesheet declares both palettes and the font stack:

```ts
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
    expect(css).toMatch(/--paper:\s*#1E1B17/i);
    expect(css).toMatch(/--accent:\s*#D08A62/i);
  });
  it('uses Plex Sans for text and Plex Mono for numbers', () => {
    expect(css).toMatch(/--font-sans:\s*"IBM Plex Sans"/);
    expect(css).toMatch(/--font-mono:\s*"IBM Plex Mono"/);
    expect(css).toMatch(/\.mono\s*\{[^}]*font-family:\s*var\(--font-mono\)/);
  });
});
```

- [ ] **Step 2: Run it** — `cd web && npx vitest run src/lib/__tests__/tokens.test.ts` → FAIL (old tokens).

- [ ] **Step 3: Replace `web/src/app.css`** with:

```css
/* Design tokens — the spec's table. Light is the default; dark follows the OS
   unless <html data-theme="light">, and is forced by <html data-theme="dark">. */
:root {
  --paper: #FAF7F2;
  --card: #FFFFFF;
  --line: #E7E0D5;
  --stone: #6E655A;
  --ink: #2B2620;
  --accent: #A65A31;
  --accent-deep: #8A4722;
  --tint: #F4E6DC;
  --stage: #111111;
  --ring: #2B2620;

  --font-sans: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  --radius-panel: 14px;
  --radius-button: 9px;
  --radius-input: 8px;
  --shadow-panel: 0 1px 2px rgba(43, 38, 32, 0.06);
  --shadow-lift: 0 2px 6px rgba(43, 38, 32, 0.1);
  --nav-h: 56px;

  color-scheme: light;
  font-family: var(--font-sans);
  font-size: 16px;
  line-height: 1.55;
  background: var(--paper);
  color: var(--ink);
  -webkit-font-smoothing: antialiased;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --paper: #1E1B17;
    --card: #26221D;
    --line: #3A342C;
    --stone: #A79C8E;
    --ink: #EDE6DC;
    --accent: #D08A62;
    --accent-deep: #E8A27A;
    --tint: #33291F;
    --ring: #3A342C;
    --shadow-panel: 0 1px 2px rgba(0, 0, 0, 0.3);
    --shadow-lift: 0 2px 6px rgba(0, 0, 0, 0.4);
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --paper: #1E1B17;
  --card: #26221D;
  --line: #3A342C;
  --stone: #A79C8E;
  --ink: #EDE6DC;
  --accent: #D08A62;
  --accent-deep: #E8A27A;
  --tint: #33291F;
  --ring: #3A342C;
  --shadow-panel: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow-lift: 0 2px 6px rgba(0, 0, 0, 0.4);
  color-scheme: dark;
}

* { box-sizing: border-box; }
html, body, #app { height: 100%; margin: 0; }
body { background: var(--paper); color: var(--ink); }

h1, h2, h3 { font-weight: 600; line-height: 1.25; margin: 0; }
p { margin: 0; }
a { color: var(--accent-deep); }
button, input { font: inherit; color: inherit; }

.mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }

:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* Theme and route transitions are the only chrome motion. */
:root, body { transition: background-color 200ms ease-out, color 200ms ease-out; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; animation: none !important; }
}
```

- [ ] **Step 4: Update `web/index.html`** head — fonts and pre-paint theme:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Math Visualizer</title>
    <script>
      // Apply the saved theme before first paint so there is no flash.
      try {
        var t = localStorage.getItem('theme');
        if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
      } catch (e) {}
    </script>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 5: Run** the token test → PASS. Run the full suite — LabShell/App tests may still pass since they don't read colours. `npm run check` → 0 errors.

- [ ] **Step 6: Commit** — `git add web/index.html web/src/app.css web/src/lib/__tests__/tokens.test.ts && git commit -m "feat(web): warm paper design tokens, Plex fonts, OS-following dark mode"`

---

### Task 2: Theme helper and toggle

**Files:**
- Create: `web/src/lib/theme.ts`, `web/src/lib/components/ThemeToggle.svelte`
- Test: `web/src/lib/__tests__/theme.test.ts`, `web/src/lib/components/__tests__/ThemeToggle.test.ts`

**Interfaces:**
- Produces: `type Theme = 'system' | 'light' | 'dark'`; `readTheme(): Theme`; `applyTheme(t: Theme): void` (sets/removes `data-theme` on `document.documentElement` and persists); `nextTheme(t: Theme): Theme` (system→light→dark→system); `<ThemeToggle />` — a `<button aria-label="Theme">` showing an icon + the current word ("System"/"Light"/"Dark").

- [ ] **Step 1: Tests**

`web/src/lib/__tests__/theme.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { readTheme, applyTheme, nextTheme } from '../theme';

beforeEach(() => { localStorage.clear(); document.documentElement.removeAttribute('data-theme'); });

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
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(readTheme()).toBe('dark');
    applyTheme('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem('theme')).toBeNull();
  });
  it('ignores garbage in storage', () => {
    localStorage.setItem('theme', 'purple');
    expect(readTheme()).toBe('system');
  });
});
```

`web/src/lib/components/__tests__/ThemeToggle.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import ThemeToggle from '../ThemeToggle.svelte';

beforeEach(() => { localStorage.clear(); document.documentElement.removeAttribute('data-theme'); });

describe('ThemeToggle', () => {
  it('shows the current theme word and cycles on click', async () => {
    const { getByLabelText } = render(ThemeToggle);
    const b = getByLabelText('Theme');
    expect(b.textContent).toContain('System');
    await fireEvent.click(b);
    expect(b.textContent).toContain('Light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    await fireEvent.click(b);
    expect(b.textContent).toContain('Dark');
    await fireEvent.click(b);
    expect(b.textContent).toContain('System');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
  it('renders an svg icon, not text glyphs', () => {
    const { getByLabelText } = render(ThemeToggle);
    expect(getByLabelText('Theme').querySelector('svg')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run** → FAIL (modules missing).

- [ ] **Step 3: Implement `web/src/lib/theme.ts`**

```ts
// Theme preference: 'system' follows the OS (no data-theme attribute);
// 'light'/'dark' force it. Storage access is wrapped: private windows and
// blocked storage must not break the page.
export type Theme = 'system' | 'light' | 'dark';

const KEY = 'theme';

export function readTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(t: Theme): void {
  const root = document.documentElement;
  if (t === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', t);
  try {
    if (t === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch { /* storage unavailable — the attribute still applied */ }
}

export function nextTheme(t: Theme): Theme {
  return t === 'system' ? 'light' : t === 'light' ? 'dark' : 'system';
}
```

- [ ] **Step 4: Implement `ThemeToggle.svelte`** (uses `Icon` from Task 3 — do Task 3 first if running alone, or inline the three SVGs):

```svelte
<script lang="ts">
  import Icon from './Icon.svelte';
  import { readTheme, applyTheme, nextTheme, type Theme } from '../theme';

  let theme = $state<Theme>(readTheme());
  const LABEL: Record<Theme, string> = { system: 'System', light: 'Light', dark: 'Dark' };
  const ICON: Record<Theme, 'monitor' | 'sun' | 'moon'> = { system: 'monitor', light: 'sun', dark: 'moon' };

  function cycle() {
    theme = nextTheme(theme);
    applyTheme(theme);
  }
</script>

<button class="theme" onclick={cycle} aria-label="Theme" title="Theme: {LABEL[theme]} (click to change)">
  <Icon name={ICON[theme]} />{LABEL[theme]}
</button>

<style>
  .theme {
    display: inline-flex; align-items: center; gap: 6px;
    background: none; border: 1px solid transparent; border-radius: var(--radius-button);
    padding: 6px 10px; color: var(--stone); cursor: pointer; font-size: 15px;
  }
  .theme:hover { color: var(--ink); border-color: var(--line); }
</style>
```

- [ ] **Step 5: Run** both tests → PASS. `npm run check` clean.
- [ ] **Step 6: Commit** — `feat(web): theme helper and System/Light/Dark toggle`

---

### Task 3: Icon component and the no-emoji guard

**Files:**
- Create: `web/src/lib/components/Icon.svelte`
- Test: `web/src/lib/components/__tests__/Icon.test.ts`, `web/src/lib/__tests__/no-emoji.test.ts`

**Interfaces:**
- Produces: `<Icon name={IconName} size?={number} />` where `IconName = 'play' | 'pause' | 'skip-back' | 'skip-forward' | 'rotate-ccw' | 'volume' | 'volume-off' | 'copy' | 'check' | 'zoom-in' | 'zoom-out' | 'sun' | 'moon' | 'monitor' | 'github'`. Renders `<svg aria-hidden="true" class="icon">` with `stroke: currentColor`, `fill: none`, `stroke-width: 1.75`.

- [ ] **Step 1: Tests**

`Icon.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import Icon, { ICON_NAMES } from '../Icon.svelte';

describe('Icon', () => {
  it('renders every name as an aria-hidden outline svg', () => {
    for (const name of ICON_NAMES) {
      const { container, unmount } = render(Icon, { props: { name } });
      const svg = container.querySelector('svg')!;
      expect(svg, name).toBeTruthy();
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.getAttribute('fill')).toBe('none');
      expect(svg.querySelector('path, circle, rect, polygon, line')).toBeTruthy();
      unmount();
    }
  });
});
```

`no-emoji.test.ts`:
```ts
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

// Emoji presentation + the misc symbols/dingbats blocks the old UI used (▶ ⏸ ↺ ✓ 🔊).
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{23E9}-\u{23FA}]/u;

describe('UI copy', () => {
  it('uses no emoji or symbol glyphs in components (icons come from Icon.svelte)', () => {
    const offenders = walk(resolve(__dirname, '../components'))
      .filter((f) => EMOJI.test(readFileSync(f, 'utf8')))
      .map((f) => f.replace(/.*\/web\//, 'web/'));
    expect(offenders).toEqual([]);
  });
});
```
Note: `→` (U+2192) and `·` are allowed in copy only outside components; the sorting lab's `▶`/`⏸`/`✓` lane glyphs must move to `Icon` (Task 10) for this test to pass. Until then this test fails — that is expected; it goes green at the end of Task 10.

- [ ] **Step 2: Implement `Icon.svelte`**

```svelte
<script lang="ts" module>
  export const ICON_NAMES = [
    'play', 'pause', 'skip-back', 'skip-forward', 'rotate-ccw', 'volume', 'volume-off',
    'copy', 'check', 'zoom-in', 'zoom-out', 'sun', 'moon', 'monitor', 'github',
  ] as const;
  export type IconName = (typeof ICON_NAMES)[number];

  // Lucide-style 24×24 outline paths.
  const PATHS: Record<IconName, string> = {
    play: '<polygon points="6 3 20 12 6 21 6 3"/>',
    pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
    'skip-back': '<polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/>',
    'skip-forward': '<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/>',
    'rotate-ccw': '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    volume: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a9 9 0 0 1 0 14"/>',
    'volume-off': '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    'zoom-in': '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>',
    'zoom-out': '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/><line x1="8" y1="11" x2="14" y2="11"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4 1.4-1.4"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
    github: '<path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.9a3.4 3.4 0 0 0-.9-2.6c3.1-.3 6.4-1.5 6.4-7A5.4 5.4 0 0 0 20 4.8 5 5 0 0 0 19.9 1S18.7.7 16 2.5a13.4 13.4 0 0 0-7 0C6.3.7 5.1 1 5.1 1A5 5 0 0 0 5 4.8a5.4 5.4 0 0 0-1.5 3.8c0 5.4 3.3 6.6 6.4 7a3.4 3.4 0 0 0-.9 2.6V23"/>',
  };
</script>

<script lang="ts">
  interface Props { name: IconName; size?: number }
  let { name, size = 16 }: Props = $props();
</script>

<!-- Paths are a static, trusted table above — never user content. -->
<svg class="icon" aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">{@html PATHS[name]}</svg>

<style>
  .icon { display: inline-block; vertical-align: -3px; flex: none; }
</style>
```

- [ ] **Step 3: Run** `Icon.test.ts` → PASS; `no-emoji.test.ts` → FAIL (expected until Task 10). `npm run check` clean.
- [ ] **Step 4: Commit** — `feat(web): outline Icon component and no-emoji guard`

---

### Task 4: Router gains the home route

**Files:**
- Modify: `web/src/lib/router.ts`, `web/src/lib/router.svelte.ts`
- Test: `web/src/lib/__tests__/router.test.ts` (extend the existing file if present; otherwise create)

**Interfaces:**
- Produces: `type RouteId = 'home' | LabId`; `parseHash(hash): RouteId` (`''`, `'#'`, `'#/'`, unknown → `'home'`); `route.id: RouteId`; `navigate(id: RouteId, query?)`; `hashFor('home', '')` → `'#/'`. `LabId`, `LAB_IDS` unchanged. Remove `DEFAULT_LAB`.

- [ ] **Step 1: Tests** (add to the router test file):

```ts
it('routes the root and unknown hashes to home', () => {
  for (const h of ['', '#', '#/', '#/nope', '#/nope?x=1']) expect(parseHash(h)).toBe('home');
});
it('still routes known labs', () => {
  expect(parseHash('#/fourier?text=HI')).toBe('fourier');
  expect(parseHash('#/sorting')).toBe('sorting');
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**: in `router.ts` add `export type RouteId = 'home' | LabId;`, change `parseHash` to return `'home'` for anything not in `LAB_IDS`, delete `DEFAULT_LAB`. In `router.svelte.ts` type `route.id` and `navigate` as `RouteId`; `hashFor` returns `'#/'` for `'home'` (plus `?query` if any). Fix every import of `DEFAULT_LAB` (grep). Any test that asserted the old default (`''` → `'sierpinski'`) is updated to `'home'`.
- [ ] **Step 4: Run** all tests + check → PASS (App tests that expect a lab at `''` will be fixed in Task 7; if they fail now, mark them `.todo` with a note and restore in Task 7).
- [ ] **Step 5: Commit** — `feat(web): home route`

---

### Task 5: Extract `useEngine`

**Files:**
- Create: `web/src/lib/components/useEngine.svelte.ts`
- Modify: `web/src/lib/components/LabShell.svelte` (use the helper; no visual change yet)
- Test: `web/src/lib/components/__tests__/useEngine.test.ts`

**Interfaces:**
- Produces:
```ts
export interface EngineHandle { api: LabApi; start(canvas: HTMLCanvasElement): Promise<void>; destroy(): void; sizeCanvas(): void }
export function useEngine(labId: LabId, opts?: { initialSpeed?: number; onReady?: (api: LabApi) => void }): EngineHandle
```
`start(canvas)`: `await loadVizCore()`; bail if destroyed; `new viz.Engine(canvas.id, labId)`; `api.engine = engine`; `sizeCanvas()`; dispatch `SetSpeed` if `initialSpeed !== undefined && !== 1`; begin the rAF loop (`engine.frame(now); api.snapshot = engine.snapshot()`); add `resize` listener; call `onReady(api)`. `destroy()`: set destroyed, cancel rAF, remove listener, `const e = api.engine; api.engine = null; e?.free()`.

- [ ] **Step 1: Test** (uses the existing fake in `web/src/lib/test/fakeViz.ts`):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installRafPolyfill, freeSpy, dispatchSpy } from '../../test/fakeViz';
installRafPolyfill();
vi.mock('../../wasm/loader', async () => {
  const { makeVizMock } = await import('../../test/fakeViz');
  return { loadVizCore: vi.fn(() => Promise.resolve(makeVizMock())) };
});
import { useEngine } from '../useEngine.svelte';

describe('useEngine', () => {
  beforeEach(() => { freeSpy.mockClear(); dispatchSpy.mockClear(); });
  it('boots an engine on the canvas, applies the initial speed, reports ready, and frees on destroy', async () => {
    const canvas = document.createElement('canvas'); canvas.id = 'c1';
    const onReady = vi.fn();
    const h = useEngine('sierpinski', { initialSpeed: 120, onReady });
    await h.start(canvas);
    expect(h.api.engine).toBeTruthy();
    expect(dispatchSpy).toHaveBeenCalledWith({ kind: 'SetSpeed', value: 120 });
    expect(onReady).toHaveBeenCalledWith(h.api);
    await vi.waitFor(() => expect(h.api.snapshot.max_iterations).toBe(360)); // the fake reports 360
    h.destroy();
    expect(h.api.engine).toBeNull();
    expect(freeSpy).toHaveBeenCalledTimes(1);
  });
  it('does not construct an engine if destroyed while the module loads', async () => {
    const canvas = document.createElement('canvas'); canvas.id = 'c2';
    const h = useEngine('fourier');
    const p = h.start(canvas);
    h.destroy();
    await p;
    expect(h.api.engine).toBeNull();
    expect(freeSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** the helper by moving the `onMount`/`onDestroy` engine code out of `LabShell.svelte` (keep `LabApi`, the loop body, `sizeCanvas` as today). Then make `LabShell` call `const engine = useEngine(labId, { initialSpeed, onReady })`, `onMount(() => engine.start(canvas))`, `onDestroy(() => { cancelRamp(); engine.destroy(); })`, and use `engine.api` everywhere it used `api`.
- [ ] **Step 4: Run** all tests → PASS (LabShell teardown tests must still pass). `npm run check` clean.
- [ ] **Step 5: Commit** — `refactor(web): extract engine boot/loop/teardown into useEngine`

---

### Task 6: Rebuild `LabShell`

**Files:**
- Modify: `web/src/lib/components/LabShell.svelte`, `web/src/lib/test/LabShellHost.svelte`
- Test: `web/src/lib/components/__tests__/LabShell.test.ts`

**Interfaces:**
- Consumes: `useEngine`, `Icon`.
- Produces: props `labId: LabId; title: string; thesis: string; playback?: boolean (true); zoom?: boolean (true); initialSpeed?; speedRamp?; onReady?; controls?: Snippet<[LabApi]>; legend?: Snippet; story?: Snippet; overlay?: Snippet<[LabApi]>`. DOM: `<article class="lab">` → `<h1>` → `<p class="thesis">` → `<div class="frame">` containing `<div class="bezel">` and `<div class="stage">` (with `<div class="clock" style="width:…%">` when `playback`, the `<canvas id="viz-canvas-{labId}">`, `.overlay`) → `<div class="legend">` → `<section class="story">`. Bezel buttons carry text: `Reset`, `Back`, `Play`/`Pause`, `Forward`; readout `<span class="readout mono">`; zoom cluster `<div class="zoom">` with `Zoom` label, buttons `aria-label="Zoom out"` / `"Zoom in"`, `<span class="level mono">1.00×</span>`, and a `Reset zoom` text button only when level ≠ 1. The `.info`, `.info-toggle`, `.info-backdrop`, `.playback-bar`, `.zoom-controls` classes are gone.

- [ ] **Step 1: Update tests.** In `LabShell.test.ts` replace the old extension-point tests with:

```ts
describe('LabShell layout', () => {
  it('renders title, thesis, labelled playback buttons and the readout', async () => {
    const { getByRole, getByText, container } = render(LabShellHost);
    await vi.waitFor(() => expect(container.querySelector('canvas')).toBeTruthy());
    expect(getByRole('heading', { level: 1 }).textContent).toBe('Test lab');
    expect(getByText('A thesis.')).toBeTruthy();
    for (const label of ['Reset', 'Back', 'Play', 'Forward']) expect(getByRole('button', { name: label })).toBeTruthy();
    expect(container.querySelector('.readout')).toBeTruthy();
    expect(container.querySelector('.info-toggle')).toBeNull();
  });
  it('fills the clock line with playback progress', async () => {
    const { container } = render(LabShellHost);
    await vi.waitFor(() => expect(container.textContent).toMatch(/360/)); // engine up
    const clock = container.querySelector('.clock') as HTMLElement;
    expect(clock).toBeTruthy();
    expect(clock.style.width).toBe('0%');
  });
  it('playback={false} hides the playback buttons, readout and clock line', async () => {
    const { container, queryByRole } = render(LabShellHost, { props: { playback: false } });
    await vi.waitFor(() => expect(container.querySelector('canvas')).toBeTruthy());
    expect(queryByRole('button', { name: 'Play' })).toBeNull();
    expect(container.querySelector('.readout')).toBeNull();
    expect(container.querySelector('.clock')).toBeNull();
  });
  it('zoom cluster is labelled and zoom={false} removes it', async () => {
    const a = render(LabShellHost);
    await vi.waitFor(() => expect(a.container.querySelector('canvas')).toBeTruthy());
    expect(a.getByRole('button', { name: 'Zoom in' })).toBeTruthy();
    expect(a.container.querySelector('.zoom .level')?.textContent).toBe('1.00×');
    a.unmount();
    const b = render(LabShellHost, { props: { zoom: false } });
    await vi.waitFor(() => expect(b.container.querySelector('canvas')).toBeTruthy());
    expect(b.container.querySelector('.zoom')).toBeNull();
  });
  it('renders legend and story snippets in their sections', async () => {
    const { container } = render(LabShellHost);
    await vi.waitFor(() => expect(container.querySelector('canvas')).toBeTruthy());
    expect(container.querySelector('.legend')?.textContent).toContain('Legend item');
    expect(container.querySelector('.story')?.textContent).toContain('Story text');
  });
});
```
Keep the existing teardown and overlay tests (overlay still renders inside `.stage`; update its `.canvas-wrap` selector to `.stage`). Update `LabShellHost.svelte` to pass `title="Test lab" thesis="A thesis."` and render `legend` (`<span>Legend item</span>`) and `story` (`<p>Story text</p>`) snippets.

- [ ] **Step 2: Run** → FAIL. **Step 3: Rewrite `LabShell.svelte`** markup:

```svelte
<article class="lab">
  <h1>{title}</h1>
  <p class="thesis">{thesis}</p>
  <div class="frame">
    <div class="bezel">
      {#if playback}
        <button class="btn" onclick={onReset}><Icon name="rotate-ccw" />Reset</button>
        <button class="btn" onclick={onStepBack}><Icon name="skip-back" />Back</button>
        <button class="btn primary" onclick={onTogglePlay}>
          <Icon name={api.snapshot.playing ? 'pause' : 'play'} />{api.snapshot.playing ? 'Pause' : 'Play'}
        </button>
        <button class="btn" onclick={onStepForward}><Icon name="skip-forward" />Forward</button>
        <span class="readout mono">{fmt(api.snapshot.iteration)} <span class="of">/ {fmt(api.snapshot.max_iterations)}</span></span>
      {/if}
      {@render controls?.(api)}
      {#if zoom}
        <div class="zoom">
          <span class="label">Zoom</span>
          <button class="btn icon" onclick={zoomOut} aria-label="Zoom out" title="Zoom out"><Icon name="zoom-out" /></button>
          <span class="level mono">{zoomLevel.toFixed(2)}×</span>
          <button class="btn icon" onclick={zoomIn} aria-label="Zoom in" title="Zoom in"><Icon name="zoom-in" /></button>
          {#if zoomLevel !== 1}<button class="btn quiet" onclick={zoomReset}>Reset zoom</button>{/if}
        </div>
      {/if}
      {#if playback}
        <label class="speed">Speed
          <input type="range" min="0.25" max="360" step="0.25" value={api.snapshot.speed} oninput={(e) => onSpeedInput(Number((e.target as HTMLInputElement).value))} aria-label="Speed" />
          <span class="value mono">{api.snapshot.speed.toFixed(1)}</span>
        </label>
      {/if}
    </div>
    <div class="stage">
      {#if playback}<div class="clock" style="width: {progressPct}%"></div>{/if}
      <canvas id="viz-canvas-{labId}" bind:this={canvas} onpointerdown={…} onpointermove={…} onpointerup={…} onpointercancel={…}></canvas>
      {#if overlay}<div class="overlay">{@render overlay(api)}</div>{/if}
    </div>
  </div>
  {#if legend}<div class="legend">{@render legend()}</div>{/if}
  {#if story}<section class="story">{@render story()}</section>{/if}
</article>
```
with `const fmt = (n: number) => n.toLocaleString('en-US');` and `const progressPct = $derived(api.snapshot.max_iterations > 0 ? Math.min(100, (100 * api.snapshot.iteration) / api.snapshot.max_iterations) : 0);`. Keep the ramp, zoom and pointer handlers as they are. Styles (all from tokens):

```css
.lab { max-width: 1200px; margin: 0 auto; padding: 40px 32px 64px; animation: fade 200ms ease-out; }
@keyframes fade { from { opacity: 0 } to { opacity: 1 } }
h1 { font-size: 26px; }
.thesis { color: var(--stone); max-width: 60ch; margin: 6px 0 20px; }
.frame { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius-panel); box-shadow: var(--shadow-panel); overflow: hidden; }
.bezel { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; padding: 12px 16px; }
.btn { display: inline-flex; align-items: center; gap: 7px; height: 36px; padding: 0 12px; border: 1px solid var(--line); border-radius: var(--radius-button); background: var(--paper); color: var(--ink); font-size: 14px; font-weight: 500; cursor: pointer; }
.btn:hover { border-color: var(--stone); }
.btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.btn.primary:hover { background: var(--accent-deep); border-color: var(--accent-deep); }
.btn.icon { padding: 0 9px; }
.btn.quiet { background: none; border-color: transparent; color: var(--accent-deep); }
.readout { font-size: 15px; margin-left: 6px; } .readout .of { color: var(--stone); }
.zoom { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; color: var(--stone); font-size: 14px; }
.zoom .level { min-width: 4.5ch; text-align: center; color: var(--ink); }
.speed { display: inline-flex; align-items: center; gap: 8px; color: var(--stone); font-size: 14px; }
.speed input { accent-color: var(--accent); width: 140px; } .speed .value { width: 4ch; text-align: right; color: var(--ink); }
.stage { position: relative; height: clamp(420px, 65vh, 820px); background: var(--stage); box-shadow: inset 0 0 0 1px var(--ring); overflow: hidden; }
.clock { position: absolute; left: 0; top: 0; height: 2px; background: var(--accent); z-index: 2; transition: width 120ms linear; }
canvas { width: 100%; height: 100%; display: block; touch-action: none; }
.overlay { position: absolute; inset: 0; z-index: 1; }
.legend { display: flex; flex-wrap: wrap; gap: 8px 22px; padding: 14px 4px 0; font-size: 14px; color: var(--stone); }
.legend :global(li), .legend :global(span.item) { display: inline-flex; align-items: center; gap: 8px; list-style: none; }
.legend :global(.swatch) { display: inline-block; width: 10px; height: 10px; border-radius: 50%; flex: none; }
.story { max-width: 68ch; margin-top: 44px; }
.story :global(h2) { font-size: 20px; margin: 0 0 10px; } .story :global(h3) { font-size: 16px; margin: 28px 0 8px; }
.story :global(p), .story :global(li) { margin: 0 0 10px; } .story :global(ol) { padding-left: 22px; }
.story :global(.tip) { border-left: 2px solid var(--accent); background: var(--tint); padding: 10px 14px; border-radius: 0 8px 8px 0; color: var(--stone); margin: 18px 0; }
.story :global(em) { font-style: normal; font-weight: 500; color: var(--ink); } .story :global(strong) { color: var(--ink); }
@media (max-width: 768px) { .lab { padding: 20px 16px 48px; } .bezel { justify-content: center; } .stage { height: clamp(300px, 55vh, 520px); } .zoom { margin-left: 0; } .speed input { width: 120px; } }
```
Move the legacy `.info :global(.swatch.corner)` etc. colour rules into the labs' own `<style>` blocks (Task 8–10) — the shell only provides the base dot.

- [ ] **Step 4: Run** → PASS; check clean. The three labs will fail to compile until Tasks 8–10 update their snippet names; to keep the build green, in this task rename each lab's `{#snippet info()}` to `{#snippet story()}` and pass `title`/`thesis` props (copy from the spec's per-lab section) with no other changes — they get their full treatment in Tasks 8–10.
- [ ] **Step 5: Commit** — `feat(web): LabShell as bezel + framed stage + clock line + story`

---

### Task 7: App bar, home route, Source and theme

**Files:**
- Modify: `web/src/App.svelte`
- Create: `web/src/lib/components/Home.svelte` (placeholder: thesis + three plain links; Task 11 fills it)
- Test: `web/src/lib/components/__tests__/App.test.ts`

**Interfaces:**
- Consumes: `route`, `navigate`, `ThemeToggle`, `Icon`, `Home`.
- Produces: `<header class="bar">` with `<a class="wordmark" href="#/">Math Visualizer</a>`, `<nav class="tabs">` (only when `route.id !== 'home'`) holding the three lab links with `aria-current="page"` on the active one, `<a class="source" href="https://github.com/benjamin-small/math-visualizer">` with github icon + "Source", and `<ThemeToggle />`.

- [ ] **Step 1: Tests** (replace `App.test.ts` contents; keep the loader mock and raf polyfill pattern from the other tests):

```ts
it('opens on the home page with three lab links and no tabs', async () => {
  navigate('home');
  const { container, getByRole } = render(App);
  expect(container.querySelector('.tabs')).toBeNull();
  expect(getByRole('link', { name: /Sierpinski Pyramid/ })).toBeTruthy();
  expect(getByRole('link', { name: /Fourier Epicycles/ })).toBeTruthy();
  expect(getByRole('link', { name: /Sorting Algorithms/ })).toBeTruthy();
  expect(getByRole('link', { name: /Source/ }).getAttribute('href')).toContain('github.com');
  expect(getByRole('button', { name: 'Theme' })).toBeTruthy();
});
it('shows the lab tabs on a lab route with the active one marked', async () => {
  navigate('fourier');
  const { container } = render(App);
  const active = container.querySelector('.tabs a[aria-current="page"]');
  expect(active?.textContent).toBe('Fourier Epicycles');
  expect(container.querySelectorAll('.tabs a')).toHaveLength(3);
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** `App.svelte`:

```svelte
<div class="app">
  <header class="bar">
    <a class="wordmark" href="#/">Math Visualizer</a>
    {#if route.id !== 'home'}
      <nav class="tabs" aria-label="Labs">
        <a href="#/sierpinski" aria-current={route.id === 'sierpinski' ? 'page' : undefined}>Sierpinski Pyramid</a>
        <a href="#/fourier" aria-current={route.id === 'fourier' ? 'page' : undefined}>Fourier Epicycles</a>
        <a href="#/sorting" aria-current={route.id === 'sorting' ? 'page' : undefined}>Sorting Algorithms</a>
      </nav>
    {/if}
    <a class="source" href="https://github.com/benjamin-small/math-visualizer" rel="noopener"><Icon name="github" />Source</a>
    <ThemeToggle />
  </header>
  <main>
    {#if route.id === 'home'}<Home />
    {:else if route.id === 'fourier'}<FourierLab />
    {:else if route.id === 'sorting'}<SortingLab />
    {:else}<SierpinskiLab />{/if}
  </main>
</div>
```
Styles: `.app { min-height: 100dvh; display: flex; flex-direction: column; }`, `.bar { position: sticky; top: 0; z-index: 10; height: var(--nav-h); display: flex; align-items: center; gap: 20px; padding: 0 32px; background: var(--paper); border-bottom: 1px solid var(--line); }`, `.wordmark { font-weight: 600; color: var(--ink); text-decoration: none; margin-right: auto; }`, `.tabs { display: flex; gap: 18px; overflow-x: auto; }`, `.tabs a { color: var(--stone); text-decoration: none; font-size: 15px; padding: 4px 0; white-space: nowrap; }`, `.tabs a[aria-current="page"] { color: var(--ink); box-shadow: inset 0 -2px 0 var(--accent); }`, `.source { display: inline-flex; align-items: center; gap: 6px; color: var(--stone); text-decoration: none; font-size: 15px; }`, `main { flex: 1; }`, mobile: `.bar { padding: 0 16px; gap: 12px; }`, `.source span-text hidden under 480px` (keep the icon + `aria-label="Source"`).
The placeholder `Home.svelte` renders `<section class="home"><p class="thesis">Three small machines for looking at math.</p><ul><li><a href="#/sierpinski">Sierpinski Pyramid</a></li>…</ul></section>`.
Note: the old fixed `100dvh` grid with an internal scrolling shell is gone — the page scrolls normally now.

- [ ] **Step 4: Run** all → PASS; check clean. **Step 5: Commit** — `feat(web): app bar with lab tabs, Source link, theme toggle; home route`

---

### Task 8: Sierpinski lab (reference implementation)

**Files:**
- Modify: `web/src/lib/components/labs/SierpinskiLab.svelte`
- Test: existing tests + `web/src/lib/components/__tests__/SierpinskiLab.test.ts` (create):

```ts
it('renders thesis, Iterations control, five legend items and the story', async () => {
  navigate('sierpinski');
  const { container, getByLabelText, getByText } = render(App);
  await vi.waitFor(() => expect(container.querySelector('canvas')).toBeTruthy());
  expect(getByText(/tetrahedron of tetrahedra/)).toBeTruthy();
  expect(getByLabelText('Iterations')).toBeTruthy();
  expect(container.querySelectorAll('.legend .swatch')).toHaveLength(5);
  expect(container.querySelector('.story h2')?.textContent).toBe('How it works');
});
```

- [ ] Implement: `<LabShell labId="sierpinski" title="Sierpinski Pyramid" thesis="Pick a corner, move halfway toward it, drop a dot. Repeat fifty thousand times and a tetrahedron of tetrahedra appears." speedRamp={…} {onReady}>` with `controls` (the Iterations number input, labelled via `<label>Iterations <input …></label>` with `aria-label="Iterations"`), `legend` (five `<span class="item"><i class="swatch corner"></i>Corners</span>` … using the existing swatch colours moved into this file's `<style>` as `.swatch.corner { background: #d9d9e0 }` etc.), and `story` (the current prose under `<h2>How it works</h2>` + `<h3>Why the first dots are hidden</h3>`, tips as `<p class="tip">`; replace `Reset ↺` / `▶` mentions with the words Reset and Play). Input styling: `.field input { height: 34px; width: 90px; border: 1px solid var(--line); border-radius: var(--radius-input); background: var(--card); padding: 0 10px; }` + `.mono`.
- [ ] Run, check, commit — `feat(web): Sierpinski lab on the new shell`

---

### Task 9: Fourier lab

**Files:** `web/src/lib/components/labs/FourierLab.svelte`, `web/src/lib/components/FormulaPanel.svelte`, tests `FourierLab.test.ts` (existing must pass; add one for the labelled text field and the Copy link icon swap).

- [ ] Implement: `title="Fourier Epicycles" thesis="Your words, redrawn by a chain of spinning circles."`. Controls: `<label class="field">Text <input … aria-label="Text to trace"></label>` (keep the aria-label the tests use), `<label class="field">Epicycles <input type="number"…></label>`, `<button class="btn"><Icon name={copied ? 'check' : 'copy'} />{copied ? 'Copied' : 'Copy link'}</button>`, the empty hint as `<span class="hint">`. Legend: 4 items with the ring/arm/pen/ink swatches (ring is an outlined circle: `border: 2px solid #8c99bf; background: transparent`; arm is a 14×2 bar). Story: current copy with `<h2>How it works</h2>`, the ordered list, `<h3>The formula</h3><FormulaPanel {summary} />`, tips. FormulaPanel: replace hard-coded greys with `var(--stone)`/`var(--ink)`/`var(--card)`; KaTeX output inherits `color`.
- [ ] Test addition:
```ts
it('labels the text field and swaps the copy icon after copying', async () => {
  const { getByLabelText, getByRole } = await renderLab();
  expect(getByLabelText('Text to trace')).toBeTruthy();
  const btn = getByRole('button', { name: /Copy link/ });
  expect(btn.querySelector('svg')).toBeTruthy();
});
```
- [ ] Run, check, commit — `feat(web): Fourier lab on the new shell`

---

### Task 10: Sorting lab

**Files:** `web/src/lib/components/labs/SortingLab.svelte`, `web/src/lib/sorting/lanes.ts` (glyph → icon name), tests `SortingLab.test.ts`, `lanes.test.ts`.

- [ ] Implement: `title="Sorting Algorithms" thesis="Seven algorithms, four starting arrays, one clock." playback={false} zoom={false}`. Controls in this order: `Run all`, `Pause all`, `Reset`, `New data` (`.btn`), `<label class="field">Size <input type="number" aria-label="Array size"></label>`, two readouts `<span class="stat"><span class="k">Running</span> <span class="mono">{running} / 28</span></span>` and the same for `Done` (counts from `summary.lanes`), `<label class="speed">Speed <input type="range" aria-label="Speed"> <span class="mono">{speed} ops/s</span></label>`, then `<button class="btn" aria-pressed={!muted} aria-label="Sound" title=…><Icon name={muted ? 'volume-off' : 'volume'} />Sound</button>` + `<input type="range" aria-label="Volume" disabled={muted}>`. Legend: 4 items. Story: current copy under `<h2>How it works</h2>`, `<h3>The four datasets</h3>`, `<h3>The algorithms</h3>`, tips (replace `▶` mentions with "the play control on a row or column header", `🔊` with "Sound"). Grid overlay: replace `LANE_GLYPH` text with `<Icon name={LANE_ICON[stateOf(i)]} size={12} />` where `LANE_ICON: Record<LaneState, IconName> = { idle: 'play', running: 'pause', done: 'check' }` (export from `lanes.ts`; update `lanes.test.ts` accordingly; remove `LANE_GLYPH`); header buttons show `{ds.label} <Icon name="play" size={11} />`; header background `rgba(38,34,29,.85)`, border `var(--line)`, badges `.mono`.
- [ ] Tests: update existing ones for labels (`getByLabelText('Sound')` stays valid), add:
```ts
it('shows running and done counts and an svg speaker icon', async () => {
  const { container, getByLabelText } = await renderLab();
  expect(container.textContent).toMatch(/Running\s*0 \/ 28/);
  expect(container.textContent).toMatch(/Done\s*0 \/ 28/);
  expect(getByLabelText('Sound').querySelector('svg')).toBeTruthy();
});
```
- [ ] Run **all** tests including `no-emoji.test.ts` → PASS now. Check clean. Commit — `feat(web): Sorting lab on the new shell, icon lane glyphs`

---

### Task 11: Home page with live tiles

**Files:**
- Create: `web/src/lib/components/LabTile.svelte`
- Modify: `web/src/lib/components/Home.svelte`
- Test: `web/src/lib/components/__tests__/Home.test.ts`

**Interfaces:**
- Consumes: `useEngine`, `readSummary` (sorting), `cmd`.
- Produces: `<LabTile lab={LabId} title thesis readout={(api: LabApi) => string} setup={(api: LabApi) => void} />` rendering `<a class="tile" href="#/{lab}">` → `<div class="stage"><div class="clock" style=…></div><canvas id="tile-canvas-{lab}"></canvas></div>` → `<div class="body"><h2>{title}</h2><p>{thesis}</p><div class="foot"><span class="mono readout">{readout(api)}</span><span class="open">Open</span></div></div>`.

- [ ] **Step 1: Test**
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import { installRafPolyfill, freeSpy, dispatchSpy, ruleActionSpy } from '../../test/fakeViz';
installRafPolyfill();
vi.mock('../../wasm/loader', async () => {
  const { makeVizMock } = await import('../../test/fakeViz');
  return { loadVizCore: vi.fn(() => Promise.resolve(makeVizMock())) };
});
vi.mock('../../fourier/textPath', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../fourier/textPath')>()), textToPath: vi.fn(async () => []) }));
import Home from '../Home.svelte';

describe('Home', () => {
  beforeEach(() => { freeSpy.mockClear(); dispatchSpy.mockClear(); ruleActionSpy.mockClear(); });
  it('renders three live tiles that link to the labs and show a readout', async () => {
    const { container, getByRole } = render(Home);
    await vi.waitFor(() => expect(container.querySelectorAll('canvas')).toHaveLength(3));
    expect(getByRole('link', { name: /Sierpinski Pyramid/ }).getAttribute('href')).toBe('#/sierpinski');
    await vi.waitFor(() => expect(container.textContent).toMatch(/0 \/ 360 iterations/)); // fake engine snapshot
    expect(container.textContent).toMatch(/lanes running/);
    expect(dispatchSpy).toHaveBeenCalledWith({ kind: 'Play' });
    expect(ruleActionSpy).toHaveBeenCalledWith(expect.objectContaining({ kind: 'set_running', running: true }));
  });
  it('frees all three engines on unmount', async () => {
    const { container, unmount } = render(Home);
    await vi.waitFor(() => expect(container.querySelectorAll('canvas')).toHaveLength(3));
    unmount();
    expect(freeSpy).toHaveBeenCalledTimes(3);
  });
  it('pauses tiles when reduced motion is preferred', async () => {
    const mm = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia;
    try {
      const { container } = render(Home);
      await vi.waitFor(() => expect(container.querySelectorAll('canvas')).toHaveLength(3));
      await vi.waitFor(() => expect(dispatchSpy).toHaveBeenCalledWith({ kind: 'Pause' }));
      expect(container.textContent).toMatch(/Paused/);
    } finally { window.matchMedia = mm; }
  });
});
```
jsdom has no `matchMedia` by default: `LabTile` must guard `typeof window.matchMedia === 'function'`.

- [ ] **Step 2: Implement `LabTile.svelte`**: `useEngine(lab, { onReady })`; `onMount(() => handle.start(canvas))`; `onDestroy(() => { document.removeEventListener('visibilitychange', onVis); handle.destroy(); })`. In `onReady`: `setup(api)`; if reduced motion → `api.dispatch(cmd.pause()); paused = true`. `onVis`: hidden → `dispatch(pause)` if it was playing; visible → `dispatch(play)` if we paused it. Progress for the clock line from `api.snapshot`. Styles: `.tile { display: flex; flex-direction: column; background: var(--card); border: 1px solid var(--line); border-radius: var(--radius-panel); box-shadow: var(--shadow-panel); overflow: hidden; color: inherit; text-decoration: none; transition: box-shadow 150ms ease-out; } .tile:hover { box-shadow: var(--shadow-lift); } .tile:hover h2 { color: var(--accent-deep); } .stage { position: relative; aspect-ratio: 4 / 3; background: var(--stage); box-shadow: inset 0 0 0 1px var(--ring); } canvas { width: 100%; height: 100%; display: block; } .clock { position: absolute; top: 0; left: 0; height: 2px; background: var(--accent); } .body { padding: 16px 18px 18px; display: flex; flex-direction: column; gap: 6px; flex: 1; } h2 { font-size: 18px; transition: color 150ms; } p { color: var(--stone); font-size: 15px; } .foot { display: flex; justify-content: space-between; margin-top: auto; padding-top: 14px; font-size: 13px; } .readout { color: var(--stone); } .open { color: var(--accent-deep); font-weight: 500; }`.
- [ ] **Step 3: Implement `Home.svelte`**: thesis (`22px/500`), lede (stone, 56ch), `.cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }` (1 column ≤ 768px), footer (`Rust → WebAssembly → WebGL2 · Svelte` and the author name). Tiles:
  - sierpinski: `setup: (api) => { api.dispatch(cmd.setSpeed(120)); api.dispatch(cmd.play()); }`, `readout: (api) => \`${fmt(api.snapshot.iteration)} / ${fmt(api.snapshot.max_iterations)} iterations\``
  - fourier: `setup: (api) => api.dispatch(cmd.play())` (the engine's default text/epicycles are used; do not run `textToPath` here), `readout: (api) => \`${fmt(api.snapshot.iteration)} / ${fmt(api.snapshot.max_iterations)}\``
  - sorting: `setup: (api) => { api.dispatch(cmd.setSpeed(60)); api.dispatch(cmd.play()); api.ruleAction({ kind: 'set_running', lanes: allLanes(7, 4), running: true }); }`, `readout: (api) => { const s = readSummary(api.readSummary()); const n = s?.lanes.filter((l) => l.running).length ?? 0; return \`${n} of 28 lanes running\`; }`
  When the reduced-motion flag is on, the readout is replaced by the word `Paused`.
- [ ] **Step 4: Run** all → PASS; check clean. **Step 5: Commit** — `feat(web): gallery home with three live lab tiles`

---

### Task 12: Docs, counts, final verification

- [ ] Update `README.md`: the "Status" block describes the home page and the lab layout (bezel, stage, clock line, story); remove mentions of the sidebar/drawer; mention the theme toggle; update the tree (`Home.svelte`, `LabTile.svelte`, `Icon.svelte`, `ThemeToggle.svelte`, `useEngine.svelte.ts`, `theme.ts`).
- [ ] Update `docs/testing.md` counts: run `cargo test --all-features` (sum of `test result` lines) and `cd web && npm run coverage`; write the numbers and today's date.
- [ ] Manual: dev server, home + three labs at desktop and 375px, theme cycle, sorting sound; console clean.
- [ ] Commit — `docs: showcase redesign in README and testing counts`
