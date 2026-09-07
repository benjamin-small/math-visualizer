// Text → closed, pen-tagged path for the Fourier lab.
//
// Outlines are gathered PER GLYPH (charToGlyph → glyph.getPath) rather than via
// font.getPath(text): the latter runs opentype.js's shaping pass, which throws
// on GSUB lookups it doesn't implement (Space Mono's chained contextual
// substitutions, for one). We don't need ligatures to trace letters; kerning is
// applied from the kern/GPOS pair table so proportional fonts still look right.
import type * as opentype from 'opentype.js';
import { loadFont } from './font';
import { buildLoop, flattenCommands, normalize, resampleClosed, type PathCommand, type PathPoint } from './geometry';

export type TextToPathOptions = {
  /** Total samples in the closed loop (uniform arc length). Default 2000. */
  samples?: number;
  /** Font size used for glyph outlines before normalization. Default 100. */
  fontSize?: number;
  /** Bézier subdivision steps in flattenCommands. Default 16. */
  steps?: number;
  /** Inject a parsed font (tests / tooling); defaults to the bundled font via loadFont(). */
  font?: opentype.Font;
};

/** Concatenated outline commands for `text`, advancing by each glyph's width (+ kerning). */
export function glyphOutlineCommands(font: opentype.Font, text: string, fontSize: number): PathCommand[] {
  const scale = fontSize / font.unitsPerEm;
  const out: PathCommand[] = [];
  let x = 0;
  let prev: opentype.Glyph | null = null;
  for (const ch of text) {
    const glyph = font.charToGlyph(ch);
    if (prev) x += font.getKerningValue(prev, glyph) * scale;
    const path = glyph.getPath(x, 0, fontSize);
    out.push(...(path.commands as PathCommand[]));
    x += (glyph.advanceWidth ?? 0) * scale;
    prev = glyph;
  }
  return out;
}

export async function textToPath(text: string, opts: TextToPathOptions = {}): Promise<PathPoint[]> {
  const { samples = 2000, fontSize = 100, steps = 16 } = opts;
  if (!text.trim()) return [];
  const font = opts.font ?? (await loadFont());
  const contours = flattenCommands(glyphOutlineCommands(font, text, fontSize), steps);
  if (contours.length === 0) return [];
  return normalize(resampleClosed(buildLoop(contours), samples));
}
