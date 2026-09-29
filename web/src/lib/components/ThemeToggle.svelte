<script lang="ts">
  // Cycles System → Light → Dark. The click is what changes the page; the
  // pre-paint script in index.html applies the saved value on load.
  import Icon from './Icon.svelte';
  import { readTheme, applyTheme, nextTheme, type Theme } from '../theme';

  let theme = $state<Theme>(readTheme());
  const LABEL: Record<Theme, string> = { system: 'System', light: 'Light', dark: 'Dark' };
  const ICON: Record<Theme, 'monitor' | 'sun' | 'moon'> = { system: 'monitor', light: 'sun', dark: 'moon' };

  function cycle() {
    theme = nextTheme(theme);
    applyTheme(theme);
  }
</script>

<button class="theme" onclick={cycle} aria-label="Theme" title="Theme: {LABEL[theme]} (click to change)">
  <Icon name={ICON[theme]} />{LABEL[theme]}
</button>

<style>
  .theme {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--radius-button);
    padding: 6px 10px;
    color: var(--stone);
    cursor: pointer;
    font-size: 15px;
  }
  .theme:hover { color: var(--ink); border-color: var(--line); }
</style>
