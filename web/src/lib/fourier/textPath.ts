import { loadFont } from './font';
import { buildLoop, flattenCommands, normalize, resampleClosed, type PathCommand, type PathPoint } from './geometry';

export type TextToPathOptions = {
  /** Number of output samples, uniformly spaced by arc length. */
  samples?: number;
  /** Font size in font units used for layout; the result is normalized anyway. */
  fontSize?: number;
  /** Fixed subdivisions per Bézier segment when flattening glyph outlines. */
  steps?: number;
};

/**
 * Turn `text` into one closed, arc-length-uniform, pen-tagged loop in normalized y-up
 * coordinates (bbox centered at the origin, `max(width, height) / 2 === 1`).
 * Blank text, or text with no drawable outline, yields `[]`.
 */
export async function textToPath(text: string, opts: TextToPathOptions = {}): Promise<PathPoint[]> {
  const { samples = 2000, fontSize = 100, steps = 16 } = opts;
  if (!text.trim()) return [];

  const font = await loadFont();
  const cmds = font.getPath(text, 0, 0, fontSize).commands as PathCommand[];
  const contours = flattenCommands(cmds, steps);
  if (contours.length === 0) return [];

  return normalize(resampleClosed(buildLoop(contours), samples));
}
