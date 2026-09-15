// Handle a lab receives from LabShell: the live engine plus the per-frame
// playback snapshot. Class fields declared with $state in a .svelte.ts module
// are the Svelte 5 pattern for reactive class state — a template reading
// `api.snapshot.iteration` re-renders when the rAF loop assigns a new snapshot.
import type { Engine } from 'viz-core';
import type { Command, PlaybackSnapshot } from '../playback/commands';

export class LabApi {
  engine = $state<Engine | null>(null);
  snapshot = $state<PlaybackSnapshot>({
    iteration: 0,
    sub_progress: 0,
    playing: false,
    speed: 1,
    seed: 0,
    max_iterations: 1,
  });

  dispatch(c: Command) {
    this.engine?.dispatch(c);
  }

  /** Merge a partial rule config into the current one (the engine replaces the whole object). */
  patchRuleConfig(patch: object) {
    const cur = (this.engine?.rule_config() ?? {}) as object;
    this.setRuleConfig({ ...cur, ...patch });
  }

  /**
   * Replace the rule config with scalar fields as JSON plus the path as typed
   * arrays — zero-copy across the WASM boundary, so a 65k-point path costs no
   * JSON. Only rules that accept a path (the Fourier lab) support this.
   */
  setRuleConfigWithPath(cfg: object, xy: Float32Array, pen: Uint8Array) {
    try {
      this.engine?.update_rule_config_with_path(cfg, xy, pen);
    } catch (err) {
      console.warn('update_rule_config_with_path failed:', err);
    }
  }

  /** Replace the rule config wholesale (use this when the config is large, e.g. a 2000-point path). */
  setRuleConfig(cfg: object) {
    try {
      this.engine?.update_rule_config(cfg);
    } catch (err) {
      console.warn('update_rule_config failed:', err);
    }
  }

  /** Merge a partial viz config into the current one (the engine replaces the whole object). */
  patchVizConfig(patch: object) {
    const cur = (this.engine?.viz_config() ?? {}) as object;
    try {
      this.engine?.update_viz_config({ ...cur, ...patch });
    } catch (err) {
      console.warn('update_viz_config failed:', err);
    }
  }

  /** Send a rule-defined action (e.g. a sorting lab's "start lane" or "pause all"). Returns false if the rule rejects it. */
  ruleAction(action: object): boolean {
    try {
      return this.engine?.rule_action(action) ?? false;
    } catch (err) {
      console.warn('rule_action failed:', err);
      return false;
    }
  }

  /** Read the rule's summary snapshot (shape is rule-specific; the caller knows what to expect). */
  readSummary(): unknown {
    return this.engine?.rule_summary() ?? null;
  }
}
