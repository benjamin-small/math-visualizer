// The guided tour of the JPEG lab: the nine steps it walks through (words only; the
// dialog builds the pictures), the one-time "seen" flag, the plain-words check the tests
// hold the copy to, and `latestOnly`, which keeps a slow encode from delivering a stale result.
import type { RgbaImage } from './images';
import type { ImageId } from './params';
import type { StageId } from './stages';

/** A tour step's id. */
export type TourStepId = 'split' | 'share' | 'tiles' | 'waves' | 'round' | 'line' | 'count' | 'codes' | 'open';

/** One step of the tour: where it sits in the pipeline and what it says. */
export interface TourStep {
  /** The step's id. */
  id: TourStepId;
  /** Its number, from 1. */
  n: number;
  /** The pipeline stage it explains, and where "Open in the lab" goes. */
  stage: StageId;
  /** Whether the step throws information away. */
  lossy: boolean;
  /** The step's title, in sentence case. */
  heading: string;
  /** The strip's label for the step: one or two plain words. */
  short: string;
  /** The line shown with the picture: at most two sentences. */
  line: string;
  /** The "why it matters" card: one sentence. */
  card: string;
}

/** The nine steps, in pipeline order. × is U+00D7, as elsewhere in the lab. */
export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'split',
    n: 1,
    stage: 'color',
    lossy: false,
    heading: 'Split brightness from colour',
    short: 'Split',
    line: 'Your eye notices brightness far more than colour.',
    card: 'Brightness carries the shapes, so colour can be stored more roughly without you noticing.',
  },
  {
    id: 'share',
    n: 2,
    stage: 'subsample',
    lossy: true,
    heading: 'Shrink the colour',
    short: 'Shrink colour',
    line: 'Neighbouring pixels share one colour, and you barely notice.',
    card: 'Each 2 × 2 square of pixels keeps one shared colour, so only a quarter of the colour is stored.',
  },
  {
    id: 'tiles',
    n: 3,
    stage: 'blocks',
    lossy: false,
    heading: 'Cut into tiles',
    short: 'Tiles',
    line: 'The picture is cut into 8 × 8 squares.',
    card: 'From here on each tile is handled on its own, which is why a heavily squeezed JPEG looks blocky.',
  },
  {
    id: 'waves',
    n: 4,
    stage: 'dct',
    lossy: false,
    heading: 'Describe each tile as waves',
    short: 'Waves',
    line: 'Smooth tiles need a few waves; busy ones need many.',
    card: 'Any 8 × 8 tile can be rebuilt by mixing 64 standard wave patterns in different amounts.',
  },
  {
    id: 'round',
    n: 5,
    stage: 'quantize',
    lossy: true,
    heading: 'Round off fine detail',
    short: 'Round off',
    line: 'Faint waves round to zero. This is the big saving.',
    card: 'Lower quality rounds harder: a smaller file, but softer edges and visible tiles.',
  },
  {
    id: 'line',
    n: 6,
    stage: 'zigzag',
    lossy: false,
    heading: 'Line the numbers up',
    short: 'Line up',
    line: 'The zeros end up together at the end.',
    card: 'Reading a tile from its smooth waves to its busy ones puts the zeros last.',
  },
  {
    id: 'count',
    n: 7,
    stage: 'rle',
    lossy: false,
    heading: 'Count the zeros',
    short: 'Count zeros',
    line: '"Five zeros, then a 3" is shorter than writing them all out.',
    card: 'A long run of zeros costs almost nothing once it is counted instead of written.',
  },
  {
    id: 'codes',
    n: 8,
    stage: 'huffman',
    lossy: false,
    heading: 'Short codes for common things',
    short: 'Short codes',
    line: 'Like Morse code, the most common things get the shortest codes.',
    card: 'Frequent patterns get short codes and rare ones long codes, so the total shrinks.',
  },
  {
    id: 'open',
    n: 9,
    stage: 'decode',
    lossy: false,
    heading: 'Open it again',
    short: 'Open',
    line: 'Your viewer undoes every step to show the picture.',
    card: 'Nothing is lost here; what was rounded off in steps 2 and 5 stays gone.',
  },
];

/** The localStorage key that remembers the tour has been offered. */
export const TOUR_SEEN_KEY = 'jpeg-tour-seen';

/** Set when the tour was closed while storage was blocked: it then stays closed for this page view. */
let seenWithoutStorage = false;

/**
 * Whether the tour has been seen before. Storage that is missing or blocked counts as not seen,
 * unless the tour was already closed in this page view.
 */
export function tourSeen(): boolean {
  try {
    return localStorage.getItem(TOUR_SEEN_KEY) === '1';
  } catch {
    return seenWithoutStorage;
  }
}

/** Remember that the tour has been seen; with storage missing or blocked, only for this page view. */
export function markTourSeen(): void {
  try {
    localStorage.setItem(TOUR_SEEN_KEY, '1');
  } catch {
    // Storage is blocked: remember it in memory, so going to another lab and back doesn't reopen it.
    seenWithoutStorage = true;
  }
}

/** Words the tour's own text must not use (whole words, any case). */
export const TOUR_JARGON = /\b(dct|quantiz\w*|chroma\w*|huffman|coefficients?|luma|ycbcr|mcu)\b/i;

/** How many sentences `text` holds: runs of `.`, `!` or `?` that end a word (a decimal point does not count). */
export function sentenceCount(text: string): number {
  return (text.match(/[.!?]+(?=["')\]]*(?:\s|$))/g) ?? []).length;
}

/** What the dialog hands to the lab when "Open in the lab" is pressed. */
export interface TourHandoff {
  /** The stage to open. */
  stage: StageId;
  /** The picture the tour was showing. */
  imageId: ImageId | 'upload';
  /** Its pixels, so an upload survives the hand-off. */
  image: RgbaImage;
  /** The quality the tour was showing. */
  quality: number;
}

/**
 * Wrap an async job so only one runs at a time and only the newest request's result is
 * delivered. A call while one is running replaces any waiting call; when a run settles its
 * result is delivered only if nothing is waiting, then the waiting call starts. A rejected or
 * throwing run, or a throwing `deliver`, is dropped and later calls carry on.
 */
export function latestOnly<A, R>(
  run: (arg: A) => Promise<R>,
  deliver: (result: R, arg: A) => void,
): (arg: A) => void {
  let running = false;
  let pending: { arg: A } | null = null;

  const start = (arg: A): void => {
    running = true;
    let job: Promise<R>;
    try {
      job = run(arg);
    } catch (e) {
      job = Promise.reject(e);
    }
    void job
      .then(
        (result) => {
          if (pending === null) deliver(result, arg);
        },
        () => {
          // A failed run is simply dropped.
        },
      )
      .catch(() => {
        // A throwing `deliver` must not stop later calls.
      })
      .then(() => {
        running = false;
        const next = pending;
        pending = null;
        if (next) start(next.arg);
      });
  };

  return (arg: A) => {
    if (running) pending = { arg };
    else start(arg);
  };
}
