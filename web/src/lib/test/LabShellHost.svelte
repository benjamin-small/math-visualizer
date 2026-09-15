<script lang="ts">
  // Test-only host so LabShell.test.ts can exercise the playback/zoom/overlay
  // extension points directly, without a real lab (or a router entry for a
  // lab id that doesn't exist yet).
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

<LabShell labId="sierpinski" {playback} {zoom} overlay={showOverlay ? overlayContent : undefined}>
  {#snippet info()}
    <h2>Test lab</h2>
  {/snippet}
</LabShell>
