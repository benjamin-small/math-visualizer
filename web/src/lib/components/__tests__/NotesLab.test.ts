import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import {
  installRafPolyfill,
  dispatchSpy,
  updateRuleConfigSpy,
  updateVizConfigSpy,
  notesSummaryFixture,
  notesVizReadout,
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
/** The last viz config the lab pushed. */
const lastViz = () => updateVizConfigSpy.mock.lastCall?.[0] as Record<string, unknown>;
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
  /** The order badge on a chip (1 to 4), or undefined when the chip is not picked. */
  const badge = (chip: HTMLElement) => chip.querySelector('.badge')?.textContent;

  describe('shell', () => {
    it('mounts with its own transport and a 36-note picker with C4 picked, and no shell playback or zoom', async () => {
      const { container, getByRole } = await renderLab();
      expect(getByRole('heading', { level: 1 }).textContent).toBe('Notes & Chords');
      expect(container.querySelector('.readout')).toBeNull();
      expect(container.querySelector('.clock')).toBeNull();
      expect(container.querySelector('.zoom')).toBeNull();
      for (const name of ['Play', 'Reset']) expect(getByRole('button', { name }).querySelector('svg')).toBeTruthy();

      // One chip per note, C3 to B5 in order, each named by its note.
      const chips = [...container.querySelectorAll<HTMLButtonElement>('.chip')];
      expect(chips).toHaveLength(36);
      expect(PICKER_RANGE.map((midi) => chips.indexOf(chipFor(getByRole, midi)))).toEqual(PICKER_RANGE.map((_, i) => i));
      expect(chipFor(getByRole, 60).getAttribute('aria-pressed')).toBe('true');
      expect(chips.filter((c) => c.getAttribute('aria-pressed') === 'false')).toHaveLength(35);

      // The picker breaks its rows at the octave: C3 to B3, C4 to B4, then C5 to B5.
      const breaks = container.querySelectorAll('.picker .octave-break');
      expect(breaks).toHaveLength(2);
      expect(breaks[0].nextElementSibling).toBe(chipFor(getByRole, 60));
      expect(breaks[1].nextElementSibling).toBe(chipFor(getByRole, 72));
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

    it('stops at four notes: every other chip is marked unavailable with a hint but stays focusable, and a click on one pushes nothing', async () => {
      const { container, getByRole } = await renderLab();
      for (const midi of [64, 67, 70]) await fireEvent.click(chipFor(getByRole, midi));
      expect(lastPush()).toEqual(expect.objectContaining({ notes: [60, 64, 67, 70] }));

      const unpicked = [...container.querySelectorAll<HTMLButtonElement>('.chip[aria-pressed="false"]')];
      expect(unpicked).toHaveLength(32);
      for (const chip of unpicked) {
        expect(chip.getAttribute('aria-disabled')).toBe('true');
        expect(chip.disabled).toBe(false); // still in the tab order, so the hint can be reached
        expect(chip.title).toBe('Pick up to four notes');
      }
      for (const midi of [60, 64, 67, 70]) expect(chipFor(getByRole, midi).getAttribute('aria-disabled')).not.toBe('true');

      updateRuleConfigSpy.mockClear();
      dispatchSpy.mockClear();
      await fireEvent.click(chipFor(getByRole, 62));
      expect(updateRuleConfigSpy).not.toHaveBeenCalled();
      expect(dispatchSpy).not.toHaveBeenCalled();
      expect(chipFor(getByRole, 62).getAttribute('aria-pressed')).toBe('false');
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

    it('deselecting the only note leaves an empty pick: nothing to play, Real pitch disabled, a prompt on the stage', async () => {
      const { container, getByRole } = await renderLab();
      await fireEvent.click(chipFor(getByRole, 60));
      expect(chipFor(getByRole, 60).getAttribute('aria-pressed')).toBe('false');
      expect(updateRuleConfigSpy).toHaveBeenLastCalledWith(expect.objectContaining({ notes: [] }));
      const realPitch = getByRole('button', { name: 'Real pitch' }) as HTMLButtonElement;
      expect(realPitch.disabled).toBe(true);
      expect(realPitch.title).toBe('Pick a note first');
      expect(container.querySelector('.marks .prompt')?.textContent).toBe('Pick a note to start.');
      expect(location.hash).toBe('#/notes?n=none');

      await fireEvent.click(chipFor(getByRole, 64)); // picking again starts over with that note as the root
      expect(updateRuleConfigSpy).toHaveBeenLastCalledWith(expect.objectContaining({ notes: [64] }));
      expect(container.querySelector('.marks .prompt')).toBeNull();
      expect(realPitch.disabled).toBe(false);
    });
  });

  describe('transport', () => {
    it('Play toggles playback; Reset puts the settings back to one note, pure ratios and a slow swing, then plays', async () => {
      const { container, getByRole, getByLabelText } = await renderLab();
      dispatchSpy.mockClear();
      await fireEvent.click(getByRole('button', { name: 'Play' }));
      expect(kinds()).toEqual(['TogglePlay']);

      await fireEvent.click(chipFor(getByRole, 67));
      await fireEvent.click(getByRole('button', { name: 'Piano' }));
      await fireEvent.input(getByLabelText('Swings per second'), { target: { value: '0.9' } });
      dispatchSpy.mockClear();
      updateRuleConfigSpy.mockClear();
      await fireEvent.click(getByRole('button', { name: 'Reset' }));
      expect(updateRuleConfigSpy).toHaveBeenCalledWith(expect.objectContaining({ notes: [60], just_intonation: true }));
      expect(kinds()).toEqual(['SetSpeed', 'Play']);
      expect(speeds().at(-1)).toBe(0.5);
      expect(chipFor(getByRole, 60).getAttribute('aria-pressed')).toBe('true');
      expect(chipFor(getByRole, 67).getAttribute('aria-pressed')).toBe('false');
      expect(getByRole('button', { name: 'Piano' }).getAttribute('aria-pressed')).toBe('false');
      expect(readout(container)).toBe(formatHz(0.5));
      expect(location.hash).toBe('#/notes');
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

    describe('follows the root, so a new root sounds at its own pitch', () => {
      const step = (from: number, to: number) => midiToHz(to) / midiToHz(from);

      it('scales the speed by the new root over the old one when the root changes', async () => {
        const { container, getByRole, getByLabelText } = await renderLab();
        await fireEvent.input(getByLabelText('Swings per second'), { target: { value: '0.7' } });
        const hz = sliderToHz(0.7);
        dispatchSpy.mockClear();
        await fireEvent.click(chipFor(getByRole, 64)); // C4 stays the root
        expect(speeds()).toEqual([]);
        await fireEvent.click(chipFor(getByRole, 60)); // E4 becomes the root
        expect(speeds().at(-1)).toBeCloseTo(hz * step(60, 64));
        expect(readout(container)).toBe(formatHz(hz * step(60, 64)));
      });

      it('in chord mode, moving the chord up a step raises the speed a step', async () => {
        const { getByRole, getByLabelText } = await renderLab('c=major');
        await fireEvent.input(getByLabelText('Swings per second'), { target: { value: '0.7' } });
        await fireEvent.click(chipFor(getByRole, 62)); // C major to D major
        expect(lastPush()).toEqual(expect.objectContaining({ notes: [62, 66, 69] }));
        expect(speeds().at(-1)).toBeCloseTo(sliderToHz(0.7) * step(60, 62));
      });

      it('stays within the slider: a root change at the top speed holds at the top', async () => {
        const { getByRole, getByLabelText } = await renderLab('c=major');
        await fireEvent.input(getByLabelText('Swings per second'), { target: { value: '1' } });
        await fireEvent.click(chipFor(getByRole, 72));
        expect(speeds().at(-1)).toBe(sliderToHz(1));
      });

      it('leaves the speed alone when the pick empties or a note joins an empty pick', async () => {
        const { getByRole } = await renderLab('c=major');
        dispatchSpy.mockClear();
        await fireEvent.click(chipFor(getByRole, 60)); // clears the chord
        await fireEvent.click(chipFor(getByRole, 62)); // a fresh chord: there is no old root to follow
        expect(speeds()).toEqual([]);
      });

      it('follows a link opened while the lab is showing', async () => {
        const { getByLabelText } = await renderLab();
        await fireEvent.input(getByLabelText('Swings per second'), { target: { value: '0.7' } });
        navigate('notes', 'n=67');
        await vi.waitFor(() => expect(speeds().at(-1)).toBeCloseTo(sliderToHz(0.7) * step(60, 67)));
      });
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

    it.each(['Play', 'Reset'])('stops on %s', async (name) => {
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

    it('says the notes are still too slow to hear until the speed passes about 30 swings a second', async () => {
      const { container, getByLabelText, getByRole } = await renderLab();
      expect(container.querySelector('.sound .hint')).toBeNull(); // nothing to say while sound is off
      await fireEvent.click(getByLabelText('Sound'));
      expect(container.querySelector('.sound .hint')?.textContent).toContain('Too slow to hear yet');
      const now = vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValue(10_000);
      try {
        await fireEvent.click(getByRole('button', { name: 'Real pitch' }));
        await vi.waitFor(() => expect(container.querySelector('.sound .hint')).toBeNull());
      } finally {
        now.mockRestore();
      }
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

    it('stops listening for the tab hiding once the lab is gone', async () => {
      const update = vi.spyOn(NotesAudio.prototype, 'update');
      let hidden = false;
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      try {
        const { container } = await renderLab();
        // While the lab is up, hiding the tab reaches the voices (the call is synchronous, so it is the handler's).
        hidden = true;
        update.mockClear();
        document.dispatchEvent(new Event('visibilitychange'));
        expect(update).toHaveBeenCalledTimes(1);
        hidden = false;

        navigate('home'); // leaving the lab unmounts it
        await vi.waitFor(() => expect(container.querySelector('.picker')).toBeNull());
        update.mockClear();
        hidden = true;
        document.dispatchEvent(new Event('visibilitychange'));
        expect(update).not.toHaveBeenCalled();
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
        const anchors = labelAnchors(figure, strip);
        const px = (el: Element | null, side: 'left' | 'top') => parseFloat((el as HTMLElement).style[side]);
        container.querySelectorAll('.note-label').forEach((label, i) => {
          expect(px(label, 'left')).toBeCloseTo(anchors.bars[i].x);
          expect(px(label, 'top')).toBeCloseTo(anchors.bars[i].y);
        });
        expect(px(container.querySelector('.ratio'), 'left')).toBeCloseTo(anchors.ratio.x);
        expect(px(container.querySelector('.ratio'), 'top')).toBeCloseTo(anchors.ratio.y);
        expect(container.querySelector('.ratio')?.classList.contains('corner')).toBe(anchors.ratioInCorner);
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

    it('labels four bars and hangs the ratio in the strip corner', async () => {
      // The fixture summary has two notes; give it four for this read.
      const saved = notesSummaryFixture.notes;
      notesSummaryFixture.notes = [...saved, saved[0], saved[1]].slice(0, 4);
      try {
        const { container } = await renderLab('n=60,64,67,70');
        await vi.waitFor(() => expect(container.querySelectorAll('.note-label')).toHaveLength(4));
        const beside = container.querySelectorAll('.note-label.beside');
        expect(beside).toHaveLength(1);
        expect(container.querySelectorAll('.note-label')[1]).toBe(beside[0]);
      } finally {
        notesSummaryFixture.notes = saved;
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
      ['n=none', '#/notes?n=none', []],
      ['n=60,61,62,63', '#/notes?n=60,61,62,63', [60, 61, 62, 63]],
      ['n=60,64,67,70,72', '#/notes?n=60,64,67,70', [60, 64, 67, 70]],
      ['n=69,85,90', '#/notes?n=69', [69]],
      ['n=47,48,60', '#/notes?n=48,60', [48, 60]],
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
      // The root moved from C4 to D4, so the speed follows it a step up before the push plays.
      expect(kinds()).toEqual(['SetSpeed', 'Play']);
      expect(speeds()[0]).toBeCloseTo(0.5 * (midiToHz(62) / midiToHz(60)));
      expect(badge(chipFor(getByRole, 62))).toBe('1');
      expect(badge(chipFor(getByRole, 69))).toBe('2');
      expect(getByRole('button', { name: 'Piano' }).getAttribute('aria-pressed')).toBe('true');
    });

    it('keeps a linked chord mode and its notes as given: links are not re-voiced', async () => {
      await renderLab('n=60,64,67&c=dom7');
      expect(updateRuleConfigSpy).toHaveBeenCalledWith(expect.objectContaining({ notes: [60, 64, 67] }));
      expect(location.hash).toBe('#/notes?n=60,64,67&c=dom7');
    });
  });

  describe('chord mode', () => {
    type Get = (role: string, opts: { name: string }) => HTMLElement;
    /** The Pick radio group's choices: Single notes, then the six triads and the five sevenths. */
    const radios = (getByRole: Get) =>
      [...getByRole('radiogroup', { name: 'Pick' }).querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    /** The label of the choice that is on. */
    const picked = (getByRole: Get) => radios(getByRole).find((r) => r.checked)?.closest('label')?.textContent?.trim();
    const choose = (getByRole: Get, name: string) => fireEvent.click(getByRole('radio', { name }));

    it('starts on single notes and offers the six triads and five sevenths as radio buttons', async () => {
      const { getByRole, getByText } = await renderLab();
      expect(picked(getByRole)).toBe('Single notes');
      expect(radios(getByRole).map((r) => r.closest('label')?.textContent?.trim())).toEqual([
        'Single notes', 'Major', 'Minor', 'Diminished', 'Augmented', 'Sus2', 'Sus4',
        'Dom7', 'Maj7', 'Min7', 'Half-dim7', 'Dim7',
      ]);
      // One group: a shared name, so the arrow keys move between them.
      expect(new Set(radios(getByRole).map((r) => r.name)).size).toBe(1);
      expect(getByText('Sevenths')).toBeTruthy();
    });

    it('a seventh builds four notes on the pressed root', async () => {
      const { getByRole } = await renderLab();
      await choose(getByRole, 'Dom7');
      expect(lastPush()).toEqual(expect.objectContaining({ notes: [60, 64, 67, 70] }));
      expect(badge(chipFor(getByRole, 70))).toBe('4');
      await fireEvent.click(chipFor(getByRole, 62));
      expect(lastPush()).toEqual(expect.objectContaining({ notes: [62, 66, 69, 72] }));
      expect(location.hash).toBe('#/notes?n=62,66,69,72&c=dom7');
    });

    it('greys out a root whose seventh would pass B5', async () => {
      const { getByRole } = await renderLab();
      await choose(getByRole, 'Maj7');
      expect(chipFor(getByRole, 72).getAttribute('aria-disabled')).not.toBe('true');
      expect(chipFor(getByRole, 73).getAttribute('aria-disabled')).toBe('true');
    });

    it('choosing a chord builds it on the current root, then plays', async () => {
      const { getByRole } = await renderLab();
      updateRuleConfigSpy.mockClear();
      dispatchSpy.mockClear();
      await choose(getByRole, 'Major');
      expect(lastPush()).toEqual(expect.objectContaining({ notes: [60, 64, 67] }));
      expect(kinds()).toEqual(['Play']);
      expect(badge(chipFor(getByRole, 64))).toBe('2');
      expect(badge(chipFor(getByRole, 67))).toBe('3');
      expect(location.hash).toBe('#/notes?n=60,64,67&c=major');
    });

    it('a chip press replaces the pick with that chord; changing the chord re-voices the same root', async () => {
      const { getByRole } = await renderLab();
      await choose(getByRole, 'Minor');
      await fireEvent.click(chipFor(getByRole, 57)); // A3 minor
      expect(lastPush()).toEqual(expect.objectContaining({ notes: [57, 60, 64] }));
      // No full-pick lock-out in chord mode: every chip stays available.
      expect(chipFor(getByRole, 50).getAttribute('aria-disabled')).not.toBe('true');
      await fireEvent.click(chipFor(getByRole, 50)); // D3 minor
      expect(lastPush()).toEqual(expect.objectContaining({ notes: [50, 53, 57] }));
      await choose(getByRole, 'Sus4');
      expect(lastPush()).toEqual(expect.objectContaining({ notes: [50, 55, 57] }));
      expect(location.hash).toBe('#/notes?n=50,55,57&c=sus4');
    });

    it('pressing the root again clears the chord', async () => {
      const { getByRole } = await renderLab();
      await choose(getByRole, 'Major');
      await fireEvent.click(chipFor(getByRole, 60));
      expect(lastPush()).toEqual(expect.objectContaining({ notes: [] }));
      expect(location.hash).toBe('#/notes?n=none&c=major');
    });

    it('marks the roots whose chord would run past B5 unavailable, with a hint, and refuses them', async () => {
      const { getByRole } = await renderLab();
      await choose(getByRole, 'Major');
      const e5 = chipFor(getByRole, 76);
      const f5 = chipFor(getByRole, 77);
      expect(e5.getAttribute('aria-disabled')).not.toBe('true');
      expect(f5.getAttribute('aria-disabled')).toBe('true');
      expect(f5.title).toBe(`Major on ${noteLabel(77)} runs past B5`);
      updateRuleConfigSpy.mockClear();
      await fireEvent.click(f5);
      expect(updateRuleConfigSpy).not.toHaveBeenCalled();
    });

    it('back to single notes keeps the chord to edit one note at a time', async () => {
      const { getByRole } = await renderLab();
      await choose(getByRole, 'Major');
      updateRuleConfigSpy.mockClear();
      await choose(getByRole, 'Single notes');
      expect(updateRuleConfigSpy).not.toHaveBeenCalled();
      expect(location.hash).toBe('#/notes?n=60,64,67');
      await fireEvent.click(chipFor(getByRole, 64));
      expect(lastPush()).toEqual(expect.objectContaining({ notes: [60, 67] }));
    });

    it('loads chord mode from a link, keeping its notes as given, and Reset goes back to single notes', async () => {
      const { getByRole } = await renderLab('n=60,67&c=minor');
      expect(updateRuleConfigSpy).toHaveBeenCalledWith(expect.objectContaining({ notes: [60, 67] }));
      expect(picked(getByRole)).toBe('Minor');
      expect(location.hash).toBe('#/notes?n=60,67&c=minor');
      await fireEvent.click(getByRole('button', { name: 'Reset' }));
      expect(picked(getByRole)).toBe('Single notes');
      expect(location.hash).toBe('#/notes');
    });

    it('drops a chord id it does not know', async () => {
      const { getByRole } = await renderLab('n=60&c=dom9');
      expect(picked(getByRole)).toBe('Single notes');
      expect(location.hash).toBe('#/notes');
    });

    it('adopts a chord from a link opened while the lab is showing', async () => {
      const { getByRole } = await renderLab();
      navigate('notes', 'c=augmented');
      await vi.waitFor(() => expect(picked(getByRole)).toBe('Augmented'));
    });
  });

  describe('4D turn', () => {
    const turnButton = (getByRole: (r: string, o: { name: string }) => HTMLElement) =>
      getByRole('button', { name: 'Turn' });

    it('shows its controls only with four notes', async () => {
      const { queryByLabelText, getByRole } = await renderLab('n=60,64,67');
      expect(queryByLabelText('4D turn')).toBeNull();
      await fireEvent.click(chipFor(getByRole, 70));
      expect(queryByLabelText('4D turn')).not.toBeNull();
      expect(turnButton(getByRole).getAttribute('aria-pressed')).toBe('true');
    });

    it('the slider follows the viz while turning', async () => {
      const { getByLabelText, container } = await renderLab('n=60,64,67,70');
      notesVizReadout.angle_4d = Math.PI / 2;
      try {
        await vi.waitFor(() => expect((getByLabelText('4D turn') as HTMLInputElement).value).toBe('90'));
        expect(container.querySelector('.turn-4d .value')?.textContent).toBe('90°');
      } finally {
        notesVizReadout.angle_4d = 0;
      }
    });

    it('grabbing the slider holds the turn at that angle; Turn resumes it', async () => {
      const { getByLabelText, getByRole } = await renderLab('n=60,64,67,70');
      updateVizConfigSpy.mockClear();
      await fireEvent.input(getByLabelText('4D turn'), { target: { value: '45' } });
      expect(lastViz()).toEqual(expect.objectContaining({ turn_4d: false }));
      expect(lastViz().angle_4d as number).toBeCloseTo(Math.PI / 4);
      expect(turnButton(getByRole).getAttribute('aria-pressed')).toBe('false');
      await fireEvent.click(turnButton(getByRole));
      expect(lastViz()).toEqual(expect.objectContaining({ turn_4d: true }));
      expect(turnButton(getByRole).getAttribute('aria-pressed')).toBe('true');
    });

    it('pressing Turn while turning holds at the mirrored angle', async () => {
      const { getByLabelText, getByRole } = await renderLab('n=60,64,67,70');
      notesVizReadout.angle_4d = Math.PI / 3;
      try {
        await vi.waitFor(() => expect((getByLabelText('4D turn') as HTMLInputElement).value).toBe('60'));
        updateVizConfigSpy.mockClear();
        await fireEvent.click(turnButton(getByRole));
        expect(lastViz()).toEqual(expect.objectContaining({ turn_4d: false }));
        expect(lastViz().angle_4d as number).toBeCloseTo(Math.PI / 3);
        expect(turnButton(getByRole).getAttribute('aria-pressed')).toBe('false');
      } finally {
        notesVizReadout.angle_4d = 0;
      }
    });

    it('hides the 4D controls below four notes and keeps the held angle', async () => {
      const { getByLabelText, queryByLabelText, getByRole } = await renderLab('n=60,64,67,70');
      await fireEvent.input(getByLabelText('4D turn'), { target: { value: '30' } });
      await fireEvent.click(chipFor(getByRole, 70));
      expect(queryByLabelText('4D turn')).toBeNull();
      await fireEvent.click(chipFor(getByRole, 70));
      expect((getByLabelText('4D turn') as HTMLInputElement).value).toBe('30');
    });

    it('Reset turns it on again from 0', async () => {
      const { getByRole } = await renderLab('n=60,64,67,70');
      await fireEvent.click(turnButton(getByRole)); // hold
      updateVizConfigSpy.mockClear();
      await fireEvent.click(getByRole('button', { name: 'Reset' }));
      const pushes = updateVizConfigSpy.mock.calls.map(([c]) => c as Record<string, unknown>);
      expect(pushes).toContainEqual(expect.objectContaining({ turn_4d: false, angle_4d: 0 }));
      expect(pushes.at(-1)).toEqual(expect.objectContaining({ turn_4d: true }));
    });
  });

  describe('legend and story', () => {
    it('has a swatch for each note, the trail and the sum, and a story with tips', async () => {
      const { container, getByRole } = await renderLab();
      expect(container.querySelectorAll('.legend .swatch')).toHaveLength(6);
      expect(getByRole('heading', { level: 2, name: 'How it works' })).toBeTruthy();
      expect(container.querySelectorAll('.story .tip').length).toBeGreaterThan(0);
    });
  });
});
