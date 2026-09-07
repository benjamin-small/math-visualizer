<script lang="ts">
  import LabShell from '../LabShell.svelte';
  import type { LabApi } from '../labApi.svelte';

  function onMaxIterationsChange(api: LabApi, e: Event) {
    const n = Math.floor(Number((e.target as HTMLInputElement).value));
    if (Number.isFinite(n) && n >= 1) api.patchRuleConfig({ max_iterations: n });
  }
</script>

<LabShell labId="sierpinski" speedRamp={{ target: 240, durationMs: 10_000 }}>
  {#snippet info()}
    <h2>Sierpinski Pyramid</h2>
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
    <h3>What you're seeing</h3>
    <ul>
      <li><span class="swatch corner"></span> Tetrahedron corners (anchors)</li>
      <li><span class="swatch highlight"></span> Highlighted corner (chosen this iteration)</li>
      <li><span class="swatch guide"></span> Guide line from current position to the chosen corner</li>
      <li><span class="swatch current"></span> In-flight dot, moving toward the halfway point</li>
      <li><span class="swatch trail"></span> Trail of permanent dots (color-tinted per corner)</li>
    </ul>
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
    <p class="tip">
      The first ~20 dots are hidden — the chaos orbit converges onto the
      Sierpinski set at rate <em>(1/2)<sup>n</sup></em>, so very early
      dots can sit in regions that get "carved out" only at deeper levels.
      By ~iteration 20 the dot is in a sub-tetrahedron smaller than a pixel
      and everything past that traces the true attractor.
    </p>
  {/snippet}

  {#snippet controls(api: LabApi)}
    <label class="iterations">
      Iterations
      <input
        type="number"
        min="1"
        max="200000"
        step="1"
        value={api.snapshot.max_iterations}
        onchange={(e) => onMaxIterationsChange(api, e)}
      />
    </label>
  {/snippet}
</LabShell>

<style>
  /* Rendered inside LabShell's .playback-bar via the `controls` snippet;
     snippet markup carries this component's scope, so the rules live here. */
  .iterations {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: #bbb;
  }
  .iterations input {
    background: #2a2a2f;
    color: #eee;
    border: 1px solid #3a3a40;
    border-radius: 4px;
    padding: 0.25rem 0.4rem;
    width: 5rem;
    font-variant-numeric: tabular-nums;
  }
</style>
