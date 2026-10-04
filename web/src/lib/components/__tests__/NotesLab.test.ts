import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import {
  installRafPolyfill,
  dispatchSpy,
  updateRuleConfigSpy,
  updateVizConfigSpy,
  notesSummaryFixture,
} from '../../test/fakeViz';
import { navigate } from '../../router.svelte';
import { PICKER_RANGE, midiToHz, noteLabel } from '../../notes/theory';
import { formatHz, sliderToHz } from '../../notes/speed';
import { NotesAudio } from '../../notes/audio';
import { labelAnchors, notesLayout, toDevice } from '../../notes/layout';
import { ratioLabel, swingLabel } from '../../notes/summary';

installRafPolyfill();

// Mock the WASM loader so the lab shell mounts without instantiating WebGL.
// vi.mock is hoisted above the imports, so pull the shared fake in lazily.
vi.mock('../../wasm/loader', async () => {
  const { makeVizMock } = await import('../../test/fakeViz');
  return { loadVizCore: vi.fn(() => Promise.resolve(makeVizMock())) };
});

// App also imports the Fourier lab, which fetches a font; jsdom has no origin to fetch from.
vi.mock('../../fourier/textPath', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../fourier/textPath')>()),
  textToPath: vi.fn(async () => []),
}));

import App from '../../../App.svelte';

/** Render the notes lab and wait until the shell has handed it the engine (its first Play). */
async function renderLab(query = '') {
  navigate('notes', query); // `route` is module-level state; pin it before each render
  const result = render(App);
  await vi.waitFor(() => expect(dispatchSpy).toHaveBeenCalledWith({ kind: 'Play' }));
  return result;
}

type Dispatched = { kind: string; value?: number };
type RuleConfig = { notes: number[]; just_intonation: boolean };

/** The kinds of every command dispatched since the spy was last cleared. */
const kinds = () => dispatchSpy.mock.calls.map(([c]) => (c as Dispatched).kind);
/** The last rule config the lab pushed. */
const lastPush = () => updateRuleConfigSpy.mock.lastCall?.[0] as RuleConfig;
/** Every speed dispatched (SetSpeed values), oldest first. */
const speeds = () =>
  dispatchSpy.mock.calls.map(([c]) => c as Dispatched).filter((c) => c.kind === 'SetSpeed').map((c) => c.value);
/** The bezel's speed readout. */
const readout = (container: HTMLElement) => container.querySelector('.speed .value')?.textContent;

describe('NotesLab.svelte', () => {
  beforeEach(() => {
    dispatchSpy.mockClear();
    updateRuleConfigSpy.mockClear();
    updateVizConfigSpy.mockClear();
  });

  /** A picker chip, found by its visible name (`C4`, `E4`, ...). */
  function chipFor(getByRole: (role: string, opts: { name: string }) => HTMLElement, midi: number) {
    return getByRole('button', { name: noteLabel(midi) }) as HTMLButtonElement;
  }
  /** The order badge on a chip (1, 2 or 3), or undefined when the chip is not picked. */
  const badge = (chip: HTMLElement) => chip.querySelector('.badge')?.textContent;

  describe('shell', () => {
    it('mounts with its own transport and a 13-note picker with C4 picked, and no shell playback or zoom', async () => {
      const { container, getByRole } = await renderLab();
      expect(getByRole('heading', { level: 1 }).textContent).toBe('Notes & Chords');
      expect(container.querySelector('.readout')).toBeNull();
      expect(container.querySelector('.clock')).toBeNull();
      expect(container.querySelector('.zoom')).toBeNull();
      for (const name of ['Play', 'Restart']) expect(getByRole('button', { name }).querySelector('svg')).toBeTruthy();

      // One chip per note, C4 to C5 in order, each named by its note.
      const chips = [...container.querySelectorAll<HTMLButtonElement>('.chip')];
      expect(chips).toHaveLength(13);
      expect(PICKER_RANGE.map((midi) => chips.indexOf(chipFor(getByRole, midi)))).toEqual(PICKER_RANGE.map((_, i) => i));
      expect(chipFor(getByRole, 60).getAttribute('aria-pressed')).toBe('true');
      expect(chips.filter((c) => c.getAttribute('aria-pressed') === 'false')).toHaveLength(12);
    });

    it('on ready sets 0.5 swings per second and pushes C4 in pure ratios, then plays', async () => {
      await renderLab();
      expect(updateRuleConfigSpy).toHaveBeenCalledTimes(1);
      expect(updateRuleConfigSpy).toHaveBeenCalledWith(expect.objectContaining({ notes: [60], just_intonation: true }));
      expect(dispatchSpy).toHaveBeenCalledWith({ kind: 'SetSpeed', value: 0.5 });
      expect(kinds().indexOf('SetSpeed')).toBeLessThan(kinds().indexOf('Play'));
      // The push rewinds playback paused at 0, so Play has to come after it.
      const play = kinds().indexOf('Play');
      expect(dispatchSpy.mock.invocationCallOrder[play]).toBeGreaterThan(updateRuleConfigSpy.mock.invocationCallOrder[0]);
    });
  });

  describe('picker', () => {
    it('picking a note pushes the new pick, then plays, and numbers the chip', async () => {
      const { getByRole } = await renderLab();
      dispatchSpy.mockClear();
      await fireEvent.click(chipFor(getByRole, 64));
      expect(lastPush()).toEqual(expect.objectContaining({ notes: [60, 64] }));
      expect(kinds()).toEqual(['Play']);
      expect(dispatchSpy.mock.invocationCallOrder[0]).toBeGreaterThan(updateRuleConfigSpy.mock.invocationCallOrder.at(-1)!);
      expect(chipFor(getByRole, 64).getAttribute('aria-pressed')).toBe('true');
      expect(badge(chipFor(getByRole, 60))).toBe('1');
      expect(badge(chipFor(getByRole, 64))).toBe('2');
    });

    it('stops at three notes: every other chip is disabled with a hint, and a click on one pushes nothing', async () => {
      const { container, getByRole } = await renderLab();
      await fireEvent.click(chipFor(getByRole, 64));
      await fireEvent.click(chipFor(getByRole, 67));
      expect(lastPush()).toEqual(expect.objectContaining({ notes: [60, 64, 67] }));

      const unpicked = [...container.querySelectorAll<HTMLButtonElement>('.chip[aria-pressed="false"]')];
      expect(unpicked).toHaveLength(10);
      for (const chip of unpicked) {
        expect(chip.disabled).toBe(true);
        expect(chip.title).toBe('Pick up to three notes');
      }
      for (const midi of [60, 64, 67]) expect(chipFor(getByRole, midi).disabled).toBe(false);

      updateRuleConfigSpy.mockClear();
      dispatchSpy.mockClear();
      await fireEvent.click(chipFor(getByRole, 62));
      expect(updateRuleConfigSpy).not.toHaveBeenCalled();
      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it('deselecting the first note makes the next one the root', async () => {
      const { getByRole } = await renderLab();
      await fireEvent.click(chipFor(getByRole, 64));
      await fireEvent.click(chipFor(getByRole, 67));
      await fireEvent.click(chipFor(getByRole, 60));
      expect(lastPush()).toEqual(expect.objectContaining({ notes: [64, 67] }));
      expect(chipFor(getByRole, 60).getAttribute('aria-pressed')).toBe('false');
      expect(badge(chipFor(getByRole, 60))).toBeUndefined();
      expect(badge(chipFor(getByRole, 64))).toBe('1');
      expect(badge(chipFor(getByRole, 67))).toBe('2');
    });

    it('clicking the only picked note keeps it and pushes nothing', async () => {
      const { getByRole } = await renderLab();
      await fireEvent.click(chipFor(getByRole, 60));
      expect(chipFor(getByRole, 60).getAttribute('aria-pressed')).toBe('true');
      expect(updateRuleConfigSpy).toHaveBeenCalledTimes(1); // the on-ready push only
    });
  });

  describe('transport', () => {
    it('Play toggles playback; Restart rewinds, then plays', async () => {
      const { getByRole } = await renderLab();
      dispatchSpy.mockClear();
      await fireEvent.click(getByRole('button', { name: 'Play' }));
      expect(kinds()).toEqual(['TogglePlay']);

      dispatchSpy.mockClear();
      await fireEvent.click(getByRole('button', { name: 'Restart' }));
      expect(kinds()).toEqual(['Reset', 'Play']);
    });
  });

  describe('tuning', () => {
    it('switches between pure ratios and piano tuning, pushing only on a change', async () => {
      const { getByRole } = await renderLab();
      const pure = getByRole('button', { name: 'Pure ratios' });
      const piano = getByRole('button', { name: 'Piano' });
      expect(pure.getAttribute('aria-pressed')).toBe('true');
      expect(piano.getAttribute('aria-pressed')).toBe('false');

      updateRuleConfigSpy.mockClear();
      dispatchSpy.mockClear();
      await fireEvent.click(piano);
      expect(lastPush()).toEqual(expect.objectContaining({ notes: [60], just_intonation: false }));
      expect(kinds()).toEqual(['Play']);
      expect(pure.getAttribute('aria-pressed')).toBe('false');
      expect(piano.getAttribute('aria-pressed')).toBe('true');

      updateRuleConfigSpy.mockClear();
      dispatchSpy.mockClear();
      await fireEvent.click(piano);
      expect(updateRuleConfigSpy).not.toHaveBeenCalled();
      expect(dispatchSpy).not.toHaveBeenCalled();
    });
  });

  describe('speed', () => {
    it('starts at 0.5 swings per second and the slider sets the speed on a log scale', async () => {
      const { container, getByLabelText } = await renderLab();
      expect(readout(container)).toBe(formatHz(0.5));
      await fireEvent.input(getByLabelText('Swings per second'), { target: { value: '0.5' } });
      expect(speeds().at(-1)).toBeCloseTo(sliderToHz(0.5));
      expect(readout(container)).toBe(formatHz(sliderToHz(0.5)));
    });
  });

  describe('Real pitch', () => {
    it('ramps the speed up to the real frequency of the first note', async () => {
      const { container, getByRole } = await renderLab();
      const button = getByRole('button', { name: 'Real pitch' });
      expect(button.title).toBe(`Speed up to ${formatHz(midiToHz(60))}, the real pitch of ${noteLabel(60)}`);
      // The ramp starts at t = 0; every later frame is well past its 2.5 s.
      const now = vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValue(10_000);
      try {
        await fireEvent.click(button);
        await vi.waitFor(() => expect(speeds().at(-1)).toBeCloseTo(midiToHz(60), 1));
        expect(readout(container)).toBe('262 Hz');
      } finally {
        now.mockRestore();
      }
    });

    it('aims for the first note of a shared link', async () => {
      const { container, getByRole } = await renderLab('n=69');
      const button = getByRole('button', { name: 'Real pitch' });
      expect(button.title).toBe(`Speed up to ${formatHz(440)}, the real pitch of ${noteLabel(69)}`);
      const now = vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValue(10_000);
      try {
        await fireEvent.click(button);
        await vi.waitFor(() => expect(speeds().at(-1)).toBeCloseTo(440, 1));
        expect(readout(container)).toBe('440 Hz');
      } finally {
        now.mockRestore();
      }
    });

    /** Start a ramp that never advances (the clock stays at 0) and wait until it is ticking. */
    async function startStuckRamp(getByRole: (role: string, opts: { name: string }) => HTMLElement) {
      const now = vi.spyOn(performance, 'now').mockReturnValue(0);
      const before = speeds().length;
      await fireEvent.click(getByRole('button', { name: 'Real pitch' }));
      await vi.waitFor(() => expect(speeds().length).toBeGreaterThan(before + 1));
      return now;
    }

    /** Whether the ramp is still dispatching speeds a few frames from now. */
    async function stillRamping() {
      const before = speeds().length;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return speeds().length > before;
    }

    it('stops when the slider moves', async () => {
      const { getByRole, getByLabelText } = await renderLab();
      const now = await startStuckRamp(getByRole);
      try {
        await fireEvent.input(getByLabelText('Swings per second'), { target: { value: '0.25' } });
        expect(await stillRamping()).toBe(false);
        expect(speeds().at(-1)).toBeCloseTo(sliderToHz(0.25));
      } finally {
        now.mockRestore();
      }
    });

    it.each(['Play', 'Restart'])('stops on %s', async (name) => {
      const { getByRole } = await renderLab();
      const now = await startStuckRamp(getByRole);
      try {
        await fireEvent.click(getByRole('button', { name }));
        expect(await stillRamping()).toBe(false);
      } finally {
        now.mockRestore();
      }
    });

    it('keeps going when a note is added, and stops when the root changes', async () => {
      const { getByRole } = await renderLab();
      const now = await startStuckRamp(getByRole);
      try {
        await fireEvent.click(chipFor(getByRole, 67)); // C4 stays the root
        expect(await stillRamping()).toBe(true);
        await fireEvent.click(chipFor(getByRole, 60)); // G4 becomes the root: the old target is stale
        expect(await stillRamping()).toBe(false);
      } finally {
        now.mockRestore();
      }
    });
  });

  describe('sound', () => {
    it('starts with sound off, the volume slider disabled, and no AudioContext needed', async () => {
      const { getByLabelText } = await renderLab();
      const mute = getByLabelText('Sound') as HTMLButtonElement;
      expect(mute.getAttribute('aria-pressed')).toBe('false');
      expect(mute.querySelector('svg')).toBeTruthy();
      expect(mute.textContent).toBe('Sound');
      expect(mute.title).toBe('Turn sound on');
      expect((getByLabelText('Volume') as HTMLInputElement).disabled).toBe(true);
    });

    it('the Sound button toggles sound on and off and enables the volume slider', async () => {
      const { getByLabelText } = await renderLab();
      const mute = getByLabelText('Sound') as HTMLButtonElement;
      const iconMarkup = () => mute.querySelector('svg')?.innerHTML ?? '';
      const offIcon = iconMarkup();
      await fireEvent.click(mute);
      expect(mute.getAttribute('aria-pressed')).toBe('true');
      expect(iconMarkup()).not.toBe(offIcon); // the volume icon swaps in for volume-off
      expect(mute.title).toBe('Turn sound off');
      const volume = getByLabelText('Volume') as HTMLInputElement;
      expect(volume.disabled).toBe(false);
      expect(volume.value).toBe('0.5');

      await fireEvent.input(volume, { target: { value: '0.8' } });
      expect(volume.value).toBe('0.8');

      await fireEvent.click(mute);
      expect(mute.getAttribute('aria-pressed')).toBe('false');
      expect(iconMarkup()).toBe(offIcon);
      expect(volume.disabled).toBe(true);
    });

    it('silences the voices when the tab is hidden, without pausing playback', async () => {
      // A hidden tab runs no frames, so the voices would hold their last chord.
      const update = vi.spyOn(NotesAudio.prototype, 'update');
      let hidden = false;
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      try {
        await renderLab();
        // The frame loop calls update() too, but only between macrotasks: a call
        // made synchronously inside dispatchEvent can only come from the handler.
        update.mockClear();
        dispatchSpy.mockClear();
        document.dispatchEvent(new Event('visibilitychange'));
        expect(update).not.toHaveBeenCalled(); // shown again: the frames take over

        hidden = true;
        document.dispatchEvent(new Event('visibilitychange'));
        expect(update).toHaveBeenCalledTimes(1);
        // The fake engine runs at speed 1; the fixture is C4 + G4.
        expect(update).toHaveBeenLastCalledWith({ playing: false, speedHz: 1, ratios: [1, 1.5] });
        expect(dispatchSpy).not.toHaveBeenCalled(); // the figure keeps its phase
      } finally {
        Reflect.deleteProperty(document, 'hidden');
        update.mockRestore();
      }
    });
  });

  describe('layout and overlay', () => {
    it('pushes the figure and strip rects to the viz in device pixels', async () => {
      await renderLab();
      await vi.waitFor(() => expect(updateVizConfigSpy).toHaveBeenCalled());
      const cfg = updateVizConfigSpy.mock.calls[0][0] as { figure: number[]; strip: number[] };
      // jsdom lays nothing out (every size is 0): assert the shape, not the values.
      for (const rect of [cfg.figure, cfg.strip]) {
        expect(rect).toHaveLength(4);
        expect(rect.every((v) => Number.isInteger(v))).toBe(true);
      }
    });

    it('hangs the labels on the same figure it pushes to the viz', async () => {
      // Give the canvas a size so the layout has real numbers (jsdom's DPR is 1).
      const width = vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(800);
      const height = vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(400);
      try {
        const { container } = await renderLab();
        const { figure, strip } = notesLayout(800, 400);
        await vi.waitFor(() => expect(container.querySelectorAll('.note-label')).toHaveLength(2));
        expect(updateVizConfigSpy).toHaveBeenLastCalledWith(
          expect.objectContaining({ figure: toDevice(figure, 1), strip: toDevice(strip, 1) }),
        );
        const anchors = labelAnchors(figure);
        const px = (el: Element | null, side: 'left' | 'top') => parseFloat((el as HTMLElement).style[side]);
        container.querySelectorAll('.note-label').forEach((label, i) => {
          expect(px(label, 'left')).toBeCloseTo(anchors.bars[i].x);
          expect(px(label, 'top')).toBeCloseTo(anchors.bars[i].y);
        });
        expect(px(container.querySelector('.ratio'), 'left')).toBeCloseTo(anchors.ratio.x);
        expect(px(container.querySelector('.ratio'), 'top')).toBeCloseTo(anchors.ratio.y);
      } finally {
        width.mockRestore();
        height.mockRestore();
      }
    });

    it('labels each bar with its swing count and the figure with the ratio', async () => {
      const { container } = await renderLab();
      await vi.waitFor(() => expect(container.querySelectorAll('.note-label')).toHaveLength(2));
      const labels = [...container.querySelectorAll('.note-label')].map((e) => e.textContent);
      expect(labels).toEqual(notesSummaryFixture.notes.map((n) => swingLabel(n, notesSummaryFixture)));
      expect(container.querySelector('.ratio')?.textContent).toBe(ratioLabel(notesSummaryFixture)); // '2 : 3'
    });

    it('drops the ratio for a single note', async () => {
      const original = notesSummaryFixture.notes;
      notesSummaryFixture.notes = original.slice(0, 1);
      try {
        const { container } = await renderLab();
        await vi.waitFor(() => expect(container.querySelectorAll('.note-label')).toHaveLength(1));
        expect(container.querySelector('.ratio')).toBeNull();
      } finally {
        notesSummaryFixture.notes = original;
      }
    });
  });

  describe('share link', () => {
    it('loads the pick from ?n= and keeps the link as it is', async () => {
      const { getByRole } = await renderLab('n=60,67');
      expect(updateRuleConfigSpy).toHaveBeenCalledWith(expect.objectContaining({ notes: [60, 67], just_intonation: true }));
      expect(badge(chipFor(getByRole, 60))).toBe('1');
      expect(badge(chipFor(getByRole, 67))).toBe('2');
      expect(location.hash).toBe('#/notes?n=60,67');
    });

    it('loads piano tuning from &t=equal', async () => {
      const { getByRole } = await renderLab('n=60,67&t=equal');
      expect(updateRuleConfigSpy).toHaveBeenCalledWith(expect.objectContaining({ notes: [60, 67], just_intonation: false }));
      expect(getByRole('button', { name: 'Piano' }).getAttribute('aria-pressed')).toBe('true');
      expect(location.hash).toBe('#/notes?n=60,67&t=equal');
    });

    it.each([
      ['n=abc', '#/notes', [60]],
      ['n=60,61,62,63', '#/notes?n=60,61,62', [60, 61, 62]],
      ['n=69,76,81', '#/notes?n=69', [69]],
    ])('rewrites ?%s to the pick that loaded (%s)', async (query, hash, notes) => {
      await renderLab(query);
      expect(updateRuleConfigSpy).toHaveBeenCalledWith(expect.objectContaining({ notes }));
      expect(location.hash).toBe(hash);
    });

    it('keeps the link in step with the pick, and adds t=equal only in piano tuning', async () => {
      const { getByRole } = await renderLab();
      expect(location.hash).toBe('#/notes');
      await fireEvent.click(chipFor(getByRole, 67));
      expect(location.hash).toBe('#/notes?n=60,67');
      await fireEvent.click(getByRole('button', { name: 'Piano' }));
      expect(location.hash).toBe('#/notes?n=60,67&t=equal');
      await fireEvent.click(getByRole('button', { name: 'Pure ratios' }));
      expect(location.hash).toBe('#/notes?n=60,67');
      await fireEvent.click(chipFor(getByRole, 67));
      expect(location.hash).toBe('#/notes');
    });

    it('adopts a link opened while the lab is showing', async () => {
      const { getByRole } = await renderLab();
      updateRuleConfigSpy.mockClear();
      dispatchSpy.mockClear();
      navigate('notes', 'n=62,69&t=equal');
      await vi.waitFor(() =>
        expect(updateRuleConfigSpy).toHaveBeenCalledWith(expect.objectContaining({ notes: [62, 69], just_intonation: false })),
      );
      expect(kinds()).toEqual(['Play']);
      expect(badge(chipFor(getByRole, 62))).toBe('1');
      expect(badge(chipFor(getByRole, 69))).toBe('2');
      expect(getByRole('button', { name: 'Piano' }).getAttribute('aria-pressed')).toBe('true');
    });
  });

  describe('legend and story', () => {
    it('has a swatch for each note, the trail and the sum, and a story with tips', async () => {
      const { container, getByRole } = await renderLab();
      expect(container.querySelectorAll('.legend .swatch')).toHaveLength(5);
      expect(getByRole('heading', { level: 2, name: 'How it works' })).toBeTruthy();
      expect(container.querySelectorAll('.story .tip').length).toBeGreaterThan(0);
    });
  });
});
