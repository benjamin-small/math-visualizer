<script lang="ts">
  import LabShell from '../LabShell.svelte';
  import type { LabApi } from '../labApi.svelte';

  function onMaxIterationsChange(api: LabApi, e: Event) {
    const n = Math.floor(Number((e.target as HTMLInputElement).value));
    if (Number.isFinite(n) && n >= 1) api.patchRuleConfig({ max_iterations: n });
  }
</script>

<LabShell
  labId="sierpinski"
  title="Sierpinski Pyramid"
  thesis="Pick a corner, move halfway toward it, drop a dot. Repeat fifty thousand times and a tetrahedron of tetrahedra appears."
  speedRamp={{ target: 240, durationMs: 10_000 }}
>
  {#snippet controls(api: LabApi)}
    <label class="field">
      Iterations
      <input
        type="number"
        min="1"
        max="200000"
        step="1"
        value={api.snapshot.max_iterations}
        onchange={(e) => onMaxIterationsChange(api, e)}
        aria-label="Iterations"
      />
    </label>
  {/snippet}

  {#snippet legend()}
    <span class="item"><i class="swatch corner"></i>Corners</span>
    <span class="item"><i class="swatch highlight"></i>Chosen corner</span>
    <span class="item"><i class="swatch guide"></i>Guide line</span>
    <span class="item"><i class="swatch current"></i>In-flight dot</span>
    <span class="item"><i class="swatch trail"></i>Trail</span>
  {/snippet}

  {#snippet story()}
    <h2>How it works</h2>
    <p>
      Four tetrahedron corners in 3D, plus a deterministic random starting
      point somewhere inside. Each iteration:
    </p>
    <ol>
      <li>Pick one of the four corners uniformly at random.</li>
      <li>Move halfway from the current position toward that corner.</li>
      <li>Drop a permanent dot at the new position, tinted with the
        chosen corner's color.</li>
    </ol>
    <p>
      After a few thousand iterations the dots converge on the
      <strong>Sierpinski tetrahedron</strong> — a 3D fractal attractor with
      four self-similar sub-pyramids nested inside. Because each dot inherits
      the color of the corner it moved toward, the four sub-pyramids paint
      themselves in distinct hues.
    </p>
    <p class="tip">
      The pyramid turntables on its own so you can see the structure from
      every angle. <em>Click and drag the canvas</em> to grab the camera
      and rotate it yourself — horizontal drag spins the azimuth, vertical
      drag tilts the elevation.
    </p>
    <p class="tip">
      Slow down to <em>1 iter/sec</em> to study each step; crank to
      <em>240</em> to race through 10k+ iterations and watch the four
      sub-pyramids resolve.
    </p>
    <h3>Why the first dots are hidden</h3>
    <p>
      The first ~20 dots are hidden — the chaos orbit converges onto the
      Sierpinski set at rate <em>(1/2)<sup>n</sup></em>, so very early
      dots can sit in regions that get "carved out" only at deeper levels.
      By ~iteration 20 the dot is in a sub-tetrahedron smaller than a pixel
      and everything past that traces the true attractor.
    </p>
  {/snippet}
</LabShell>

<style>
  /* Snippet markup carries this component's scope, so these rules reach the
     elements LabShell renders inside its bezel and legend. The shell provides
     the base .field, .swatch (10px dot) and .tip styling. */
  .field input {
    width: 90px;
  }

  /* Legend swatches: the only literal colours in this file, because they
     must match the colours the viz paints on the stage. */
  i.swatch.corner { background: #d9d9e0; }
  i.swatch.highlight { background: #fad94d; }
  i.swatch.guide {
    width: 14px;
    height: 2px;
    border-radius: 0;
    background: linear-gradient(90deg, transparent 0, #f2bf59 30%, #f2bf59 70%, transparent 100%);
  }
  i.swatch.current { background: #f28c5a; }
  i.swatch.trail { background: #a6daf2; }
</style>
