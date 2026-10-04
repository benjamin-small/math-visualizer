<script lang="ts">
  // The Notes & Chords lab: pick one to three notes and each one swings a dot
  // on its own bar; two draw the loop of their interval, three a curve in a
  // turning cube. The engine counts the first note's swings, so its playback
  // speed is swings per second: this page owns that speed (its own transport,
  // a log slider and a "Real pitch" ramp up to the note's true frequency) and
  // voices the notes once they swing fast enough to hear. It is also the
  // geometry source: it lays the stage out, pushes the figure and strip
  // rectangles to the viz, and hangs the text labels over the canvas.
  import { onDestroy, untrack } from 'svelte';
  import LabShell from '../LabShell.svelte';
  import Icon from '../Icon.svelte';
  import type { LabApi } from '../labApi.svelte';
  import { cmd } from '../../playback/commands';
  import { PICKER_RANGE, NOTE_COLORS, midiToHz, noteLabel } from '../../notes/theory';
  import { MAX_NOTES, toggleNote, parseNotesParam, formatNotesParam } from '../../notes/picker';
  import { DEFAULT_SPEED_HZ, RAMP_MS, sliderToHz, hzToSlider, formatHz, rampSpeedAt } from '../../notes/speed';
  import { notesLayout, toDevice, labelAnchors } from '../../notes/layout';
  import { readSummary, swingLabel, ratioLabel, type NotesSummary } from '../../notes/summary';
  import { NotesAudio } from '../../notes/audio';
  import { route, replaceQuery } from '../../router.svelte';
  import { buildQuery } from '../../router';

  /** C4, middle C: from here every interval in the picker's octave is reachable upward. */
  const DEFAULT_NOTE = 60;

  /**
   * Read the shareable-link params from a hash query: `n=60,67` (the pick, cut
   * down to a legal one; undefined when nothing valid is left) and `t=equal`
   * (piano tuning).
   */
  function paramsOf(query: string): { notes?: number[]; equal: boolean } {
    const p = new URLSearchParams(query);
    return { notes: parseNotesParam(p.get('n')), equal: p.get('t') === 'equal' };
  }
  const linked = paramsOf(route.query);

  /** The pick in bar order: [0] is the root (left bar), then the top bar, then the right bar. */
  let notes = $state<number[]>(linked.notes ?? [DEFAULT_NOTE]);
  /** Pure ratios (just intonation) or piano tuning (equal temperament). */
  let just = $state(!linked.equal);
  /** The root's swings per second, which is the engine's playback speed. */
  let speedHz = $state(DEFAULT_SPEED_HZ);
  /** Sonification: one sine per note, off until the Sound button is clicked. */
  const audio = new NotesAudio();
  let muted = $state(audio.muted);
  let volume = $state(audio.volume);
  /** What the engine reported this frame (null until it is up). */
  let summary = $state<NotesSummary | null>(null);
  /** Where the figure and the strip sit on the stage, in CSS pixels; pushed to the viz as device pixels. */
  let layout = $state(notesLayout(0, 0));
  /** Query we last wrote (or consumed), so our own replaceQuery() doesn't re-trigger a push. */
  let appliedQuery = route.query;
  // $state so the per-frame effect below re-runs once the shell hands us the api.
  let api = $state<LabApi | null>(null);
  let overlayEl: HTMLDivElement | null = null;
  let ro: ResizeObserver | null = null;
  /** The running "Real pitch" ramp's rAF handle; 0 when none is running. */
  let rampHandle = 0;

  const rootMidi = $derived(notes[0]);
  const rootHz = $derived(midiToHz(rootMidi));
  const full = $derived(notes.length >= MAX_NOTES);
  const playing = $derived(api?.snapshot.playing ?? false);
  /** The overlay's label positions, from the same layout the viz was given. */
  const anchors = $derived(labelAnchors(layout.figure));

  /** The share link for the current pick and tuning, defaults omitted: `n=60,67&t=equal`. */
  function currentQuery(): string {
    const pick = $state.snapshot(notes);
    return buildQuery({
      n: pick.length === 1 && pick[0] === DEFAULT_NOTE ? undefined : formatNotesParam(pick),
      t: just ? undefined : 'equal',
    });
  }

  /** Keep the URL a shareable link to what is playing. */
  function syncUrl() {
    const q = currentQuery();
    appliedQuery = q;
    replaceQuery(q);
  }

  // A pasted link / back-forward while on this page: adopt its pick and tuning.
  $effect(() => {
    const q = route.query;
    untrack(() => {
      if (q === appliedQuery) return;
      appliedQuery = q;
      const p = paramsOf(q);
      const next = p.notes ?? [DEFAULT_NOTE];
      if (formatNotesParam(next) === formatNotesParam(notes) && p.equal === !just) return;
      if (next[0] !== notes[0]) cancelRamp(); // a new root: "Real pitch" was heading for the old one's frequency
      notes = next;
      just = !p.equal;
      applyConfig();
    });
  });

  /** One frequency ratio per note, in bar order (none before the engine reports). */
  const ratiosOf = (s: NotesSummary | null) => s?.notes.map((n) => n.ratio) ?? [];

  // The shell replaces `snapshot` every frame: re-read the summary off that
  // clock and voice the notes at the engine's actual speed.
  $effect(() => {
    const a = api;
    if (!a) return;
    const { playing: on, speed } = a.snapshot;
    // Hand the audio the parsed value, not the `summary` state: reading state
    // this effect just wrote would make it re-run on its own write.
    const next = readSummary(a.readSummary());
    summary = next;
    audio.update({ playing: on, speedHz: speed, ratios: ratiosOf(next) });
  });

  /**
   * The voices hold until the next update, and a hidden tab runs no frames, so
   * fade them out as the tab hides (playback keeps its phase). Once the tab is
   * shown again the frames voice the notes as before.
   */
  function onVisibility() {
    if (!document.hidden || !api) return;
    audio.update({ playing: false, speedHz: api.snapshot.speed, ratios: ratiosOf(summary) });
  }

  /**
   * Push the pick and the tuning, then keep the link in step. A rule-config
   * push rewinds playback paused at 0, so Play follows it.
   */
  function applyConfig() {
    api?.patchRuleConfig({ notes: $state.snapshot(notes), just_intonation: just });
    api?.dispatch(cmd.play());
    syncUrl();
  }

  function onChip(midi: number) {
    const current = $state.snapshot(notes);
    const next = toggleNote(current, midi);
    if (next === current) return; // refused: a fourth note, or the only one
    if (next[0] !== current[0]) cancelRamp(); // a new root: "Real pitch" was heading for the old one's frequency
    notes = [...next];
    applyConfig();
  }

  function setTuning(pure: boolean) {
    if (pure === just) return;
    just = pure;
    applyConfig();
  }

  function onTogglePlay() {
    cancelRamp();
    api?.dispatch(cmd.togglePlay());
  }

  function onRestart() {
    cancelRamp();
    api?.dispatch(cmd.reset());
    api?.dispatch(cmd.play());
  }

  function setSpeed(hz: number) {
    speedHz = hz;
    api?.dispatch(cmd.setSpeed(hz));
  }

  function onSpeedInput(e: Event) {
    cancelRamp(); // the user took the speed back
    setSpeed(sliderToHz(Number((e.target as HTMLInputElement).value)));
  }

  function cancelRamp() {
    if (rampHandle !== 0) {
      cancelAnimationFrame(rampHandle);
      rampHandle = 0;
    }
  }

  /**
   * "Real pitch": glide from the current speed to the root's true frequency
   * over RAMP_MS, exponentially so the pitch rises at an even musical rate
   * (the same curve as LabShell's start-up ramp). The clock is read inside
   * each tick, and the last tick lands exactly on the target.
   */
  function startRealPitch() {
    cancelRamp();
    const from = speedHz;
    const to = rootHz;
    const startMs = performance.now();
    const tick = () => {
      if (rampHandle === 0) return; // cancelled mid-tick
      const t = (performance.now() - startMs) / RAMP_MS;
      if (t >= 1) {
        rampHandle = 0;
        setSpeed(to);
        return;
      }
      setSpeed(rampSpeedAt(from, to, t));
      rampHandle = requestAnimationFrame(tick);
    };
    rampHandle = requestAnimationFrame(tick);
  }

  /** The click is the user gesture that lets the browser start audio. */
  function toggleMute() {
    audio.setMuted(!muted);
    muted = audio.muted;
  }

  function onVolume(e: Event) {
    audio.setVolume(Number((e.target as HTMLInputElement).value));
    volume = audio.volume;
  }

  /** Lay the stage out from the canvas's CSS size and hand the viz the two rects in device pixels. */
  function pushLayout() {
    const canvas = overlayEl?.closest('.stage')?.querySelector('canvas');
    if (!api?.engine || !canvas) return;
    const dpr = window.devicePixelRatio || 1;
    layout = notesLayout(canvas.clientWidth, canvas.clientHeight);
    api.patchVizConfig({ figure: toDevice(layout.figure, dpr), strip: toDevice(layout.strip, dpr) });
  }

  function observeResize() {
    // jsdom has no ResizeObserver; the window listener is the fallback there
    // (and catches DPR changes when a window moves between displays).
    if (typeof ResizeObserver !== 'undefined' && overlayEl) {
      ro = new ResizeObserver(() => pushLayout());
      ro.observe(overlayEl);
    }
    window.addEventListener('resize', pushLayout);
  }

  function onReady(a: LabApi) {
    api = a;
    a.dispatch(cmd.setSpeed(speedHz));
    // Push unconditionally (even C4 in pure ratios, the rule's own default) so
    // the engine plays exactly what the page shows. The push leaves playback
    // paused at 0, so Play follows.
    a.patchRuleConfig({ notes: $state.snapshot(notes), just_intonation: just });
    a.dispatch(cmd.play());
    // A link that had to be cleaned up (?n=abc, a fourth note, a note off the
    // picker) is rewritten to what actually loaded.
    if (route.query !== currentQuery()) syncUrl();
    pushLayout();
    observeResize();
    document.addEventListener('visibilitychange', onVisibility);
  }

  onDestroy(() => {
    cancelRamp();
    ro?.disconnect();
    ro = null;
    window.removeEventListener('resize', pushLayout);
    document.removeEventListener('visibilitychange', onVisibility);
    audio.destroy();
  });
</script>

<LabShell
  labId="notes"
  title="Notes &amp; Chords"
  thesis="Every note is a vibration; two or three at once draw the shape of their interval."
  playback={false}
  zoom={false}
  {onReady}
>
  {#snippet overlay()}
    <!-- Text over the canvas, placed from the layout the viz was given: each
         note's swing count at its bar's end, and the ratio under the figure. -->
    <div class="marks" bind:this={overlayEl}>
      {#if summary}
        {#each summary.notes as note, i}
          <span
            class="note-label mono"
            class:beside={i === 1}
            style:left="{anchors.bars[i].x}px"
            style:top="{anchors.bars[i].y}px"
            style:color={NOTE_COLORS.bars[i]}
          >{swingLabel(note, summary)}</span>
        {/each}
        {#if summary.notes.length > 1}
          <span class="ratio mono" style:left="{anchors.ratio.x}px" style:top="{anchors.ratio.y}px">{ratioLabel(summary)}</span>
        {/if}
      {/if}
    </div>
  {/snippet}

  {#snippet controls()}
    <div class="group">
      <button class="btn primary" onclick={onTogglePlay}>
        <Icon name={playing ? 'pause' : 'play'} />{playing ? 'Pause' : 'Play'}
      </button>
      <button class="btn" onclick={onRestart} title="Back to the first swing, and play"><Icon name="rotate-ccw" />Restart</button>
    </div>
    <label class="speed">
      <span class="name">Swings per second</span>
      <input type="range" min="0" max="1" step="0.001" value={hzToSlider(speedHz)} oninput={onSpeedInput} aria-label="Swings per second" />
      <span class="value mono">{formatHz(speedHz)}</span>
    </label>
    <button class="btn" onclick={startRealPitch} title="Speed up to {formatHz(rootHz)}, the real pitch of {noteLabel(rootMidi)}">Real pitch</button>
    <div class="group tuning" role="group" aria-label="Tuning">
      <button class="btn" aria-pressed={just} onclick={() => setTuning(true)} title="Whole-number ratios: the loop closes">Pure ratios</button>
      <button class="btn" aria-pressed={!just} onclick={() => setTuning(false)} title="Equal steps, as a piano is tuned: every ratio is rounded a little, so the shape drifts">Piano</button>
    </div>
    <div class="group picker" role="group" aria-label="Notes">
      {#each PICKER_RANGE as midi (midi)}
        {@const order = notes.indexOf(midi)}
        {@const selected = order !== -1}
        <button
          class="btn chip"
          aria-pressed={selected}
          aria-disabled={!selected && full}
          title={!selected && full ? 'Pick up to three notes' : undefined}
          style:--note-color={selected ? NOTE_COLORS.bars[order] : undefined}
          onclick={() => onChip(midi)}
        >{noteLabel(midi)}{#if selected}<span class="badge mono" aria-hidden="true">{order + 1}</span>{/if}</button>
      {/each}
    </div>
    <div class="sound group">
      <button
        class="btn mute"
        onclick={toggleMute}
        aria-pressed={!muted}
        aria-label="Sound"
        title={muted ? 'Turn sound on' : 'Turn sound off'}
      ><Icon name={muted ? 'volume-off' : 'volume'} />Sound</button>
      <input type="range" min="0" max="1" step="0.01" value={volume} oninput={onVolume} disabled={muted} aria-label="Volume" />
    </div>
  {/snippet}

  {#snippet legend()}
    <span class="item"><i class="swatch" style:background={NOTE_COLORS.bars[0]}></i>Note 1 (left bar)</span>
    <span class="item"><i class="swatch" style:background={NOTE_COLORS.bars[1]}></i>Note 2 (top bar)</span>
    <span class="item"><i class="swatch" style:background={NOTE_COLORS.bars[2]}></i>Note 3 (right bar)</span>
    <span class="item"><i class="swatch" style:background={NOTE_COLORS.trail}></i>Trail</span>
    <span class="item"><i class="swatch" style:background={NOTE_COLORS.sum}></i>Sum line</span>
  {/snippet}

  {#snippet story()}
    <h2>How it works</h2>
    <p>
      Every note is a vibration: something swinging back and forth the same number of times every second. Here each note
      swings a dot along its own bar, and the dot is where that vibration is <em>right now</em>.
    </p>
    <p>
      Two notes drive one pen: the first moves it up and down, the second left and right, and the pen draws the path they
      make together. C and G swing in the ratio <strong>2 : 3</strong> — two swings of C for every three of G (musicians
      name that interval the other way round, a 3:2 fifth) — so after two swings of C the pen is back where it started and
      the loop closes. The strip next to the figure draws the same swings over time: one wave per note, and the brighter
      line is their sum, the wave your ear actually receives.
    </p>
    <p>
      Speed the swings up past about twenty a second and your eyes lose track of them, but your ears pick them up: the
      motion becomes a pitch. 262 swings a second is middle C.
    </p>
    <p>
      Simple ratios draw simple shapes, and simple shapes are what we hear as harmony: the closer a pair is to small whole
      numbers, the smoother it sounds. A piano is tuned so that every step between neighbouring keys is the same size,
      which rounds every ratio off a little, so its shapes never quite sit still.
    </p>
    <p class="tip">
      <em>Pick up to three notes</em> from C4 to C5. The first one you pick is the root: it swings on the left bar, and the
      speed counts its swings. A third note adds depth, and the curve turns inside a cube; drag the cube to look around it.
    </p>
    <p class="tip">
      <em>Swings per second</em> runs from one swing every four seconds to a thousand a second. <em>Real pitch</em> glides
      to the root's true frequency (262 a second for C4) over a couple of seconds; moving the slider or pressing
      <em>Play</em> or <em>Restart</em> stops the glide where it is.
    </p>
    <p class="tip">
      <em>Pure ratios</em> tunes the notes to whole-number ratios, so the loop closes. <em>Piano</em> tunes them the way a
      piano is tuned: C, E and G swing 4 : 5 : 6 in pure ratios but 4 : 5.04 : 5.99 on a piano, and the figure slowly
      drifts.
    </p>
    <p class="tip">
      <em>Sound</em> plays the notes once they swing fast enough to hear, fading in from about twenty swings a second. The
      slider beside it sets the volume.
    </p>
    <p class="tip">
      The link in the address bar always holds this setup, ready to share: <em>?n=60,67</em> lists the notes as MIDI
      numbers (60 is middle C) and <em>&amp;t=equal</em> means piano tuning.
    </p>
  {/snippet}
</LabShell>

<style>
  /* The marks are text only, so like the shell's overlay wrapper they let
     pointer events through: a drag has to reach the canvas (with three
     notes it turns the cube). */
  .marks {
    /* The stage is dark in both themes, so the labels keep one light-on-dark
       look (like the sorting lab's cell badges) instead of the paper tokens. */
    --label-ink: rgba(232, 225, 216, 0.92);
    --label-bg: rgba(17, 17, 17, 0.72);
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .note-label, .ratio {
    position: absolute;
    font-size: 12px;
    line-height: 1;
    padding: 3px 6px;
    border-radius: 4px;
    color: var(--label-ink);
    background: var(--label-bg);
    white-space: nowrap;
  }
  /* A bar's bottom end hangs its label just below it; the top bar's right end, just to its right. */
  .note-label { transform: translate(-50%, 4px); }
  .note-label.beside { transform: translate(6px, -50%); }
  /* The ratio sits centred in the figure's bottom gutter, which has no bar. */
  .ratio { font-size: 13px; transform: translate(-50%, -50%); }

  /* Bezel bits, rendered into LabShell's bezel via `controls`. The shell's
     base `.bezel :global(.btn)` compiles three classes deep, so every button
     override below is at least four and wins whatever the stylesheet order. */
  .speed, .sound { display: flex; align-items: center; gap: 8px; color: var(--stone); font-size: 14px; white-space: nowrap; }
  .speed input { width: 140px; accent-color: var(--accent); }
  .speed .value { width: 8ch; text-align: right; color: var(--ink); }
  .sound input { width: 6rem; accent-color: var(--accent); }
  .sound input:disabled { opacity: 0.4; }
  .btn.mute[aria-pressed="true"] { border-color: var(--accent); color: var(--accent-deep); }
  .tuning .btn[aria-pressed="true"] { border-color: var(--accent); background: var(--tint); color: var(--accent-deep); }

  /* The note picker. A picked chip wears its bar's colour on the border and
     on its order badge, a dark pill, so the colour is never text on paper. */
  .picker .btn.chip { position: relative; min-width: 3.25rem; justify-content: center; padding: 0 10px; }
  .btn.chip[aria-pressed="true"] { border-color: var(--note-color); box-shadow: inset 0 0 0 1px var(--note-color); }
  /* A full picker marks the other chips unavailable rather than disabling
     them, so they stay focusable and their hint reachable; onChip refuses a
     fourth note. */
  .btn.chip[aria-disabled="true"] { opacity: 0.45; cursor: not-allowed; }
  .chip .badge {
    position: absolute;
    top: -7px;
    right: -7px;
    display: grid;
    place-items: center;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 8px;
    font-size: 11px;
    line-height: 1;
    background: var(--stage);
    color: var(--note-color);
  }

  /* Legend swatches: the shell supplies the dot. A ring of the stage colour
     shows each colour as it looks on the canvas (the trail and the sum are
     near-white, which would vanish on paper). */
  i.swatch { box-shadow: 0 0 0 2px var(--stage); }

  @media (max-width: 480px) {
    /* The bezel stacks, and a row is as wide as its widest item's unwrapped
       content: give the long speed label its own line, so the slider and
       the readout share the next one instead of overflowing the frame. */
    .speed { flex-wrap: wrap; row-gap: 6px; }
    .speed .name { flex-basis: 100%; }
  }
</style>
