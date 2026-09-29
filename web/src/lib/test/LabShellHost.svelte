<script lang="ts">
  // Test-only host so LabShell.test.ts can exercise the shell's extension
  // points directly, without a real lab.
  import LabShell from '../components/LabShell.svelte';
  import type { LabApi } from '../components/labApi.svelte';

  interface Props {
    playback?: boolean;
    zoom?: boolean;
    showOverlay?: boolean;
  }

  let { playback, zoom, showOverlay = false }: Props = $props();
</script>

{#snippet overlayContent(api: LabApi)}
  <div data-testid="overlay-content">overlay {api.snapshot.iteration}</div>
{/snippet}

<LabShell labId="sierpinski" title="Test lab" thesis="A thesis." {playback} {zoom} overlay={showOverlay ? overlayContent : undefined}>
  {#snippet legend()}
    <span class="item"><i class="swatch"></i>Legend item</span>
  {/snippet}
  {#snippet story()}
    <h2>How it works</h2>
    <p>Story text</p>
  {/snippet}
</LabShell>
