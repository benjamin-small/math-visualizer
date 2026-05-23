import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
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
