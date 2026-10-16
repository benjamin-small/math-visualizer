// The JPEG lab's pipeline: nine stages from pixels to bits and back. The rail
// shows all of them; a stage is `ready` once its screen exists (the rest are
// shown, disabled, so the whole pipeline is visible from the start).

/** A pipeline stage's id, as written in the link and used by the rail. */
export type StageId =
  | 'color'
  | 'subsample'
  | 'blocks'
  | 'dct'
  | 'quantize'
  | 'zigzag'
  | 'rle'
  | 'huffman'
  | 'decode';

/** A stage as the rail and the story card describe it. */
export interface StageInfo {
  /** The stage's id. */
  id: StageId;
  /** What the rail prints in the step's circle: 1–8, then ↺ for decode. */
  mark: string;
  /** Name on the rail and the story card. */
  title: string;
  /** One line under the title. */
  subtitle: string;
  /** Whether the stage has a screen yet (the rest show disabled on the rail). */
  ready: boolean;
}

/** All nine stages in pipeline order. */
export const STAGES: readonly StageInfo[] = [
  { id: 'color', mark: '1', title: 'Color', subtitle: 'RGB turns into brightness + two colour differences', ready: true },
  { id: 'subsample', mark: '2', title: 'Subsample', subtitle: 'Keep less colour than brightness', ready: true },
  { id: 'blocks', mark: '3', title: 'Blocks', subtitle: 'Cut each plane into 8 × 8 tiles', ready: true },
  { id: 'dct', mark: '4', title: 'DCT', subtitle: 'Rewrite a tile as 64 cosine patterns', ready: true },
  { id: 'quantize', mark: '5', title: 'Quantize', subtitle: 'Round the patterns coarsely', ready: true },
  { id: 'zigzag', mark: '6', title: 'Zigzag', subtitle: 'Low frequencies first', ready: true },
  { id: 'rle', mark: '7', title: 'Run-length', subtitle: 'Count the zeros', ready: true },
  { id: 'huffman', mark: '8', title: 'Huffman', subtitle: 'Short codes for common symbols', ready: true },
  { id: 'decode', mark: '↺', title: 'Decode', subtitle: 'Undo it all and compare', ready: true },
];

/** The stage a link without `stage=` opens on. */
export const DEFAULT_STAGE: StageId = 'color';

/** Whether `s` names a stage (ready or not). */
export function isStageId(s: unknown): s is StageId {
  return typeof s === 'string' && STAGES.some((st) => st.id === s);
}

/** A stage the page can show: the id if it is ready, else the default. */
export function readyStage(s: unknown): StageId {
  return isStageId(s) && STAGES.find((st) => st.id === s)!.ready ? s : DEFAULT_STAGE;
}

/** The ready stage `delta` steps away (±1 for the arrow keys), stopping at the ends. */
export function stepStage(current: StageId, delta: number): StageId {
  const ready = STAGES.filter((s) => s.ready).map((s) => s.id);
  const i = ready.indexOf(current);
  if (i === -1) return ready[0];
  return ready[Math.max(0, Math.min(ready.length - 1, i + delta))];
}
