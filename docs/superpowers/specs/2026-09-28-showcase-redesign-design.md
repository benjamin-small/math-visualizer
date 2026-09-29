# Showcase Redesign ("Specimens in frames") — Design

**Date:** 2026-09-28
**Status:** Approved for implementation
**Scope:** web/ only. No engine (Rust) changes.

## Summary

Turn the site from a dark, sidebar-driven tool into a curated showcase: a
gallery home page with three live previews, and a lab page per
visualization where the WebGL canvas is mounted as a framed dark "stage" on
warm paper, with a labelled control bezel above it and the explanation as
a readable article below. Everything follows the user's taste rules
(`~/.claude/skills/ui-critic/taste.md`): warm neutrals, one sans family with
calm heading sizes, rounded hairline panels, outline icons, subtle motion,
dark mode that follows the OS.

The signature element is the **clock line**: a 2px terracotta hairline along
the join between bezel and stage that fills with the engine's progress
(`iteration / max_iterations`). Every lab is a counter on one clock, so the
device is true to the content and doubles as the playback progress bar.

## Goals

1. A home page that presents the three labs as a collection, with each
   card running the real engine live.
2. Lab pages where the stage is the first thing seen, controls are labelled
   and discoverable, and the explanation reads as an article below.
3. One token system (light + dark) shared by every component.
4. No regressions in lab behaviour, URLs (`#/fourier?text=…`, `#/sorting?n=`),
   or tests.

## Non-goals

- Changing any visualization's rendering, palette or clear colour (the stage
  stays `#111`).
- A high-contrast theme (welcome later; not now).
- Persisting anything beyond the theme choice.
- Touching the Rust crate.

## Tokens

Defined on `:root` in `web/src/app.css`; the dark set applies under
`prefers-color-scheme: dark` unless `data-theme="light"`, and always under
`data-theme="dark"`.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--paper` | `#FAF7F2` | `#1E1B17` | page background |
| `--card` | `#FFFFFF` | `#26221D` | bezel, cards, inputs |
| `--line` | `#E7E0D5` | `#3A342C` | hairlines |
| `--stone` | `#6E655A` | `#A79C8E` | secondary text (passes 4.5:1 on paper) |
| `--ink` | `#2B2620` | `#EDE6DC` | text |
| `--accent` | `#A65A31` | `#D08A62` | clock line, active tab, links, primary button, focus ring |
| `--accent-deep` | `#8A4722` | `#E8A27A` | hover |
| `--tint` | `#F4E6DC` | `#33291F` | callout background |
| `--stage` | `#111111` | `#111111` | canvas surround (matches GL clear) |
| `--ring` | `#2B2620` | `#3A342C` | 1px inset ring around the stage |

Type: `IBM Plex Sans` 400/500/600 (body, UI, headings), `IBM Plex Mono`
400/500 (every live number: readouts, card foots, inputs holding numbers).
Loaded from Google Fonts in `index.html` with `display=swap`; system-ui
fallback. Sizes: body 16/1.55; lab title 26/600; section h2 20/600; h3
16/600; card title 18/600; UI 14–15. Nothing heavier than 600.

Shape: panels and cards 14px radius, hairline + `0 1px 2px rgba(43,38,32,.06)`
shadow; buttons 9px, inputs 8px. Stage corners 0 inside the frame (the frame
clips at 14px).

Icons: `Icon.svelte`, inline SVG, 1.75 stroke, round caps, `currentColor`.
Set: `play`, `pause`, `skip-back`, `skip-forward`, `rotate-ccw`, `volume`,
`volume-off`, `copy`, `check`, `zoom-in`, `zoom-out`, `sun`, `moon`,
`monitor`, `github`. No emoji anywhere in the UI.

## Routes

`web/src/lib/router.ts`: `RouteId = 'home' | LabId`. `parseHash`: empty,
`#`, `#/` → `'home'`; a known lab id → that lab; unknown → `'home'`.
`DEFAULT_LAB` is removed; existing callers that need a lab default use
`'home'`. `route.id` may now be `'home'`; `navigate('home')` works.

## Home page (`Home.svelte`)

```
┌─────────────────────────────────────────────────────────────┐
│ Math Visualizer                             Source   Theme  │  bar
├─────────────────────────────────────────────────────────────┤
│ Three small machines for looking at math.                   │  thesis (22/500)
│ Each one runs in Rust, compiled to WebAssembly and drawn    │  lede (stone)
│ with WebGL, live in this tab. Press play, then read how it  │
│ works.                                                      │
│ ┌────────────┐ ┌────────────┐ ┌────────────┐                │
│ │ live stage │ │ live stage │ │ live stage │  4:3, clock    │
│ ├────────────┤ ├────────────┤ ├────────────┤  line on top   │
│ │ Title      │ │ Title      │ │ Title      │                │
│ │ one-liner  │ │ one-liner  │ │ one-liner  │                │
│ │ mono  Open │ │ mono  Open │ │ mono  Open │                │
│ └────────────┘ └────────────┘ └────────────┘                │
│ Rust → WebAssembly → WebGL2 · Svelte          Benjamin Small│  footer
└─────────────────────────────────────────────────────────────┘
```

- Three `LabTile.svelte` cards in a 3-column grid (1 column under 768px).
  The whole card is a link to `#/<lab>`. Hover: shadow lifts one step
  (`0 2px 6px`), title colour → accent-deep. Focus ring on the card.
- Each tile boots its lab's engine on its own small canvas via the shared
  `useEngine` helper, dispatches the lab's demo settings (Sierpinski: speed
  120 + play; Fourier: default text, epicycles 300, play; Sorting: run all
  at 60 ops/s), and shows one live mono readout in the foot:
  - Sierpinski: `7,206 / 50,000 iterations`
  - Fourier: `300 circles · 616 / 2,000`
  - Sorting: `12 of 28 lanes running` (from `rule_summary`)
- When `prefers-reduced-motion: reduce`, tiles dispatch pause after the
  first frame and show a "Paused" mono note instead of the ticking readout.
- When the page is hidden (`document.hidden`) tiles pause; on visible they
  resume (only if they were playing). Tiles free their engine on destroy.
- Copy: titles as today; one-liners:
  - Sierpinski Pyramid — "A random walk toward four corners paints a 3D
    fractal, one dot at a time."
  - Fourier Epicycles — "Type anything; a chain of spinning circles draws it
    back."
  - Sorting Algorithms — "Seven algorithms race four datasets on one clock,
    so you see the work each one does."

## App bar (`App.svelte`)

Single 56px bar on every route: wordmark (link to `#/`), then on lab routes
the three lab tabs (15px, stone; active = ink with a 2px accent underline),
then right-aligned `Source` (github icon + text, links to the repo) and the
theme toggle. On the home route the tabs are hidden (the cards are the
navigation). Under 768px the tabs collapse to a `<select>`-free horizontal
scroll row (no hamburger).

Theme toggle (`ThemeToggle.svelte`): a labelled button cycling
System → Light → Dark (icon monitor/sun/moon + the word), persisted in
`localStorage['theme']`, applied as `data-theme` on `<html>` before first
paint (inline script in `index.html` reads storage to avoid a flash). Read
and write wrapped in try/catch.

## Lab page (`LabShell.svelte`)

```
 Title (26/600)
 Thesis line (stone, one sentence)
 ┌───────────────────────────────────────────────────────────┐
 │ [↺ Reset] [⏮ Back] [▶ Play] [⏭ Forward]  7,206 / 50,000  │ bezel (card)
 │                              …lab controls…  Zoom [−][+]  │
 ├═══════════════════════════════════════════════════════════┤ clock line
 │                                                           │
 │                        STAGE (#111)                       │ 65vh, min 420px
 │                                                           │
 └───────────────────────────────────────────────────────────┘
 ● Corners  ● Chosen corner  — Guide line  ● In-flight  ● Trail   legend
 
 How it works                                                    story
 …article, 68ch measure…
```

- Props: `labId`, `title`, `thesis`, `playback` (default true), `zoom`
  (default true), snippets `controls` (extra bezel items, receives `LabApi`),
  `legend`, `story`, `overlay` (unchanged), `onReady`, `initialSpeed`,
  `speedRamp` (unchanged).
- Bezel: flex, wraps. Playback buttons are `<button>`s with an `Icon` and a
  text label: `Reset`, `Back`, `Play`/`Pause` (primary style, accent fill,
  white text), `Forward`. The iteration readout is mono 15px, the "/ max"
  part in stone. Then `{@render controls}`. Then, when `zoom`, a `Zoom`
  cluster: text label "Zoom", `[−]` and `[+]` icon buttons with `aria-label`s
  and `title`s, the mono level (`1.00×`), and a `Reset` text button shown
  only when the level ≠ 1. This replaces the floating on-canvas cluster.
  The shell's Speed slider (when `playback`) sits last, `margin-left: auto`.
- Clock line: a 2px `--accent` bar at the top edge of the stage, width =
  `iteration / max_iterations` (0 when max is 0). Sorting sets
  `playback={false}`, so its shell shows no clock line — the sorting bezel
  shows its own readouts instead (see below).
- Stage: `position: relative`, `height: clamp(420px, 65vh, 820px)`, `#111`,
  inset 1px `--ring`, the canvas filling it, `overlay` rendered on top.
  Pointer handling unchanged.
- Legend: `{@render legend}` inside a flex row under the frame; the shell
  supplies `.swatch` base styling as today (`:global`).
- Story: `{@render story}` inside `<section class="story">` with the 68ch
  measure and the heading/paragraph/list/callout styles (moved from the old
  `.info :global(...)` rules). Callouts (`.tip`) become a 2px accent left
  rule on `--tint`, stone text, `em` in ink 500.
- The mobile info drawer, `info-toggle` and `info-backdrop` are removed.
- Under 768px: bezel items wrap and centre, stage height `clamp(300px, 55vh,
  520px)`, story full width with 16px gutters.

### Per-lab

- **Sierpinski**: thesis "Pick a corner, move halfway toward it, drop a dot.
  Repeat fifty thousand times and a tetrahedron of tetrahedra appears."
  Controls: `Iterations` number input. Legend: 5 items. Story: current copy,
  reflowed under "How it works" + "Why the first dots are hidden".
- **Fourier**: thesis "Your words, redrawn by a chain of spinning circles."
  Controls: text field (with a visible label "Text"), `Epicycles` number,
  `Copy link` button (copy icon → check icon + "Copied" for 1.5s), the empty
  hint. Legend: 4 items. Story: current copy + `FormulaPanel` under
  "The formula".
- **Sorting**: thesis "Seven algorithms, four starting arrays, one clock."
  `playback={false} zoom={false}`. Controls: `Run all`, `Pause all`, `Reset`,
  `New data` (text buttons), `Size` input, then two mono readouts
  `running / 28` and `done / 28` labelled "Running" and "Done", then `Speed`
  slider, then `Sound`: a button with the volume/volume-off icon and the
  text "Sound" (`aria-pressed` for state, fixed `aria-label="Sound"`), plus
  the volume slider (disabled while muted). Legend: 4 items. Story: current
  copy. The grid overlay keeps its dark treatment but headers use
  `rgba(38,34,29,.85)` with `--line`-coloured borders and Plex Mono badges.

## Engine helper (`useEngine.svelte.ts`)

Extracted from LabShell so tiles and shells share one code path:

```ts
export function useEngine(labId: LabId, getCanvas: () => HTMLCanvasElement | null,
  opts: { onReady?: (api: LabApi) => void; initialSpeed?: number }): {
  api: LabApi;      // engine + per-frame snapshot ($state)
  destroy(): void;  // cancel rAF, free engine (null the handle first)
  sizeCanvas(): void;
}
```

It owns: `loadVizCore()` (single-flight), `new viz.Engine(canvasId, labId)`,
the rAF loop assigning `api.snapshot`, `sizeCanvas` on mount and on
`resize`, and teardown. LabShell keeps the speed-ramp, zoom and pointer code.
`LabTile` uses it with `initialSpeed` and its own `onReady`.

## Motion

- Route change: the lab/home root fades in over 200ms ease-out (CSS
  animation on mount). Theme change: `color`/`background-color` transition
  200ms on `:root` and panels.
- Card hover: shadow and title colour, 150ms.
- `prefers-reduced-motion: reduce` disables the fades and pauses tiles.

## Files

- `web/index.html` — fonts, theme pre-paint script.
- `web/src/app.css` — tokens (light/dark), base type, focus ring, motion.
- `web/src/App.svelte` — bar with tabs, Source, ThemeToggle; home route.
- `web/src/lib/router.ts`, `router.svelte.ts` — `'home'`.
- `web/src/lib/components/Icon.svelte`, `ThemeToggle.svelte`, `Home.svelte`,
  `LabTile.svelte`, `useEngine.svelte.ts`.
- `web/src/lib/components/LabShell.svelte` — rebuilt per above.
- `web/src/lib/components/labs/*.svelte` — new snippets, copy, icons.
- `web/src/lib/components/FormulaPanel.svelte` — colours from tokens.
- `README.md`, `docs/testing.md` — screenshots/description, counts.

## Tests

- `router.test.ts`: `''`, `'#'`, `'#/'`, `'#/nope'` → `'home'`; labs
  unchanged.
- `App.test.ts`: home route renders three tiles; tabs hidden on home, shown
  on a lab route with the active one marked; theme toggle cycles and writes
  `data-theme`.
- `Home.test.ts` / `LabTile.test.ts`: three engines constructed with the
  right lab ids, three `free()` on unmount, readout text per lab from the
  fake summaries, reduced-motion pauses.
- `LabShell.test.ts`: bezel buttons have text labels; zoom cluster present /
  absent; clock line width tracks the snapshot; legend and story snippets
  render; no `.info-toggle`.
- `SortingLab.test.ts`: existing + `Sound` button uses an `<svg>` not text
  emoji; readouts show `0 / 28`.
- A repo-wide test asserting no emoji code points in `web/src/**/*.svelte`.
- Existing Fourier/Sorting behaviour tests keep passing.

## Verification

Dev server at desktop and 375px: home cards live, each lab page, theme
toggle, sorting sound; then deploy and repeat on the live site; finish with
a ui-critic review of the live home and one lab page.
