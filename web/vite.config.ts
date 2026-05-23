import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

// GitHub Pages serves the site at https://<user>.github.io/math-visualizer/,
// so production builds need their asset URLs prefixed. The CI workflow sets
// BASE_PATH=/math-visualizer/; local `vite dev` and `vite build` leave it
// unset and the site resolves at root.
const base = process.env.BASE_PATH || '/';

export default defineConfig({
  base,
  plugins: [svelte(), wasm(), topLevelAwait()],
  optimizeDeps: {
    exclude: ['viz-core'],
  },
  server: {
    // viz-core's WASM lives at ../crates/viz-core/pkg/, outside the web
    // workspace root. Vite refuses to serve it via /@fs/ unless we allow
    // the parent. Production builds bundle the wasm into dist/, so this
    // only matters for `vite dev`.
    fs: {
      allow: ['..'],
    },
  },
});
