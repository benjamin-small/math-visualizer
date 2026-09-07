import * as opentype from 'opentype.js';

/** Bundled font (SIL OFL), served from `web/public/fonts/`. */
export const FONT_FILE = 'fonts/SpaceGrotesk.ttf';

let fontPromise: Promise<opentype.Font> | null = null;

/**
 * Load and parse the bundled font. Memoized: concurrent and repeated callers share one fetch.
 * Fetches relative to `BASE_URL` so it works at `/`, in vitest, and under the GitHub Pages base
 * path. A failed load clears the memo so a later call can retry.
 */
export function loadFont(): Promise<opentype.Font> {
  fontPromise ??= fetch(`${import.meta.env.BASE_URL}${FONT_FILE}`)
    .then((r) => {
      if (!r.ok) throw new Error(`font ${r.status}`);
      return r.arrayBuffer();
    })
    .then((buf) => opentype.parse(buf))
    .catch((err: unknown) => {
      fontPromise = null;
      throw err;
    });
  return fontPromise;
}
