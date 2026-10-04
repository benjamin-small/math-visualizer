import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import {
  installRafPolyfill,
  freeSpy,
  dispatchSpy,
  ruleActionSpy,
  updateRuleConfigSpy,
  sortingSummaryFixture,
  notesSummaryFixture,
} from '../../test/fakeViz';
import { tileReadout } from '../../notes/summary';

installRafPolyfill();

// Mock the WASM loader so the tiles mount without instantiating WebGL.
// vi.mock is hoisted above the imports, so pull the shared fake in lazily.
vi.mock('../../wasm/loader', async () => {
  const { makeVizMock } = await import('../../test/fakeViz');
  return { loadVizCore: vi.fn(() => Promise.resolve(makeVizMock())) };
});

// jsdom has no origin to fetch a font from.
vi.mock('../../fourier/textPath', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../fourier/textPath')>()),
  textToPath: vi.fn(async () => []),
}));

import Home from '../Home.svelte';
import { isFinished } from '../LabTile.svelte';

describe('Home', () => {
  beforeEach(() => {
    freeSpy.mockClear();
    dispatchSpy.mockClear();
    ruleActionSpy.mockClear();
    updateRuleConfigSpy.mockClear();
  });

  it('renders four live tiles that link to the labs and show a readout', async () => {
    const { container, getByRole } = render(Home);
    await vi.waitFor(() => expect(container.querySelectorAll('canvas')).toHaveLength(4));
    expect(getByRole('link', { name: /Sierpinski Pyramid/ }).getAttribute('href')).toBe('#/sierpinski');
    await vi.waitFor(() => expect(container.textContent).toMatch(/0 \/ 360 iterations/)); // fake engine snapshot
    expect(container.textContent).toMatch(/lanes running/);
    expect(dispatchSpy).toHaveBeenCalledWith({ kind: 'Play' });
    expect(ruleActionSpy).toHaveBeenCalledWith(expect.objectContaining({ kind: 'set_running', running: true }));
  });

  it('frees all four engines on unmount', async () => {
    const { unmount } = render(Home);
    // The canvases exist before the (async) loader resolves; the loader is
    // single-flight, so once one tile's setup has run (the Sierpinski, sorting
    // and notes tiles each dispatch one Play; the Fourier tile plays only once
    // its text path arrives, which the mock never delivers) all four engines
    // are constructed. Wait for all three Plays before tearing down.
    const plays = () => dispatchSpy.mock.calls.filter(([c]) => (c as { kind: string }).kind === 'Play');
    await vi.waitFor(() => expect(plays()).toHaveLength(3));
    unmount();
    expect(freeSpy).toHaveBeenCalledTimes(4);
  });

  it('keeps the sorting readout live: it follows the engine summary frame by frame', async () => {
    const original = sortingSummaryFixture.lanes;
    try {
      const { container } = render(Home);
      await vi.waitFor(() => expect(container.textContent).toMatch(/0 of 28 lanes running/));
      sortingSummaryFixture.lanes = original.map((l, i) => ({ ...l, running: i < 5 }));
      // The readout reads the summary, not the snapshot; it must still re-render on the frame clock.
      await vi.waitFor(() => expect(container.textContent).toMatch(/5 of 28 lanes running/));
    } finally {
      sortingSummaryFixture.lanes = original;
    }
  });

  it('marks a tile Done once its demo finishes (sorting: every lane sorted)', async () => {
    const original = { lanes: sortingSummaryFixture.lanes, all_done: sortingSummaryFixture.all_done };
    try {
      const { container } = render(Home);
      await vi.waitFor(() => expect(container.textContent).toMatch(/0 of 28 lanes running/));
      expect(container.querySelector('.done')).toBeNull();
      sortingSummaryFixture.lanes = original.lanes.map((l) => ({ ...l, running: false, done: true }));
      sortingSummaryFixture.all_done = true;
      await vi.waitFor(() => expect(container.textContent).toMatch(/28 of 28 lanes sorted/));
      // The sorting tile's clock line fills with lanes finished, not engine ticks.
      const clocks = [...container.querySelectorAll('.tile .clock')] as HTMLElement[];
      expect(clocks[2].style.width).toBe('100%');
      const done = container.querySelector('.done')!;
      expect(done.textContent).toContain('Done');
      expect(done.querySelector('svg')).toBeTruthy();
    } finally {
      sortingSummaryFixture.lanes = original.lanes;
      sortingSummaryFixture.all_done = original.all_done;
    }
  });

  it('opens with the four-machines thesis', () => {
    const { container } = render(Home);
    expect(container.querySelector('.thesis')?.textContent).toContain('Four small machines');
  });

  it('starts the notes tile on C4 + G4 at half a swing per second, then plays', async () => {
    render(Home);
    await vi.waitFor(() => expect(updateRuleConfigSpy).toHaveBeenCalledWith(expect.objectContaining({ notes: [60, 67] })));
    expect(dispatchSpy).toHaveBeenCalledWith({ kind: 'SetSpeed', value: 0.5 });
    // A rule-config push rewinds and pauses the engine, so the tile has to play after it, not before.
    const sent = dispatchSpy.mock.calls.map(([c]) => c as { kind: string; value?: number });
    const speed = sent.findIndex((c) => c.kind === 'SetSpeed' && c.value === 0.5);
    expect(sent[speed + 1]).toEqual({ kind: 'Play' });
    expect(updateRuleConfigSpy.mock.invocationCallOrder[0]).toBeLessThan(dispatchSpy.mock.invocationCallOrder[speed + 1]);
  });

  it('shows the notes readout from the engine summary', async () => {
    const { container } = render(Home);
    const readout = () => container.querySelectorAll('.tile')[3].querySelector('.readout')?.textContent;
    await vi.waitFor(() => expect(readout()).toBe(tileReadout(notesSummaryFixture)));
    expect(readout()).toBe('0.0 / 2 swings'); // the fixture is C4 + G4, not yet started
  });

  it("fills the notes tile's clock line with the share of the period swung", async () => {
    const original = notesSummaryFixture.phase;
    try {
      const { container } = render(Home);
      await vi.waitFor(() => expect(container.textContent).toContain('0.0 / 2 swings'));
      const clocks = [...container.querySelectorAll('.tile .clock')] as HTMLElement[];
      expect(clocks[3].style.width).toBe('0%');
      notesSummaryFixture.phase = 1; // half of the fixture's two-swing period
      // The engine's own clock never moves under the mock, so only the summary can fill the line.
      await vi.waitFor(() => expect(clocks[3].style.width).toBe('50%'));
      expect(container.textContent).toContain('1.0 / 2 swings');
    } finally {
      notesSummaryFixture.phase = original;
    }
  });

  it('marks the notes tile Done once its loop closes', async () => {
    const original = { phase: notesSummaryFixture.phase, closed: notesSummaryFixture.closed };
    try {
      const { container } = render(Home);
      await vi.waitFor(() => expect(container.textContent).toContain('0.0 / 2 swings'));
      expect(container.querySelector('.done')).toBeNull();
      notesSummaryFixture.phase = notesSummaryFixture.period;
      notesSummaryFixture.closed = true;
      await vi.waitFor(() => expect(container.textContent).toContain('2.0 / 2 swings'));
      const tile = container.querySelectorAll('.tile')[3];
      const done = tile.querySelector('.done')!;
      expect(done.textContent).toContain('Done');
      expect(done.querySelector('svg')).toBeTruthy();
      expect((tile.querySelector('.clock') as HTMLElement).style.width).toBe('100%');
      expect(container.querySelectorAll('.done')).toHaveLength(1); // no other tile finished
    } finally {
      notesSummaryFixture.phase = original.phase;
      notesSummaryFixture.closed = original.closed;
    }
  });

  it('isFinished: the clock reached the end of a real run', () => {
    const snap = { iteration: 0, sub_progress: 0, playing: false, speed: 1, seed: 0, max_iterations: 360 };
    expect(isFinished(snap)).toBe(false);
    expect(isFinished({ ...snap, iteration: 360 })).toBe(true);
    expect(isFinished({ ...snap, iteration: 400 })).toBe(true);
    expect(isFinished({ ...snap, iteration: 1, max_iterations: 1 })).toBe(false); // the empty pre-path Fourier state
  });

  it('runs the tile cleanup (the sorting resize listener) on unmount', async () => {
    const removed = vi.spyOn(window, 'removeEventListener');
    const { container, unmount } = render(Home);
    await vi.waitFor(() => expect(container.textContent).toMatch(/lanes running/));
    unmount();
    expect(removed.mock.calls.some(([type]) => type === 'resize')).toBe(true);
    removed.mockRestore();
  });

  it('pauses tiles when reduced motion is preferred', async () => {
    const mm = window.matchMedia;
    window.matchMedia = ((q: string) => ({
      matches: q.includes('reduce'),
      media: q,
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof matchMedia;
    try {
      const { container } = render(Home);
      await vi.waitFor(() => expect(container.querySelectorAll('canvas')).toHaveLength(4));
      await vi.waitFor(() => expect(dispatchSpy).toHaveBeenCalledWith({ kind: 'Pause' }));
      expect(container.textContent).toMatch(/Paused/);
    } finally {
      window.matchMedia = mm;
    }
  });
});
