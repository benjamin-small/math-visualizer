// Everything an explainer may read: the page's own state and data. Explainers
// never encode, so a card costs nothing to show.
import type { HuffTableView, SegmentView } from '../huffman';
import type { RgbaImage } from '../images';
import type { HuffmanId, ImageId, SubsamplingId } from '../params';
import type { RdPoint } from '../rd';
import type { StageId } from '../stages';
import type { JpegSummary } from '../summary';

export interface ExplainContext {
  /** The latest encode's summary (null before the first one). */
  summary: JpegSummary | null;
  stage: StageId;
  imageId: ImageId | 'upload';
  /** The picture as the lab loaded it. */
  image: RgbaImage | null;
  /** The decoded copy's RGBA, decoded once per encode (null until it arrives). */
  decoded: Uint8Array | null;
  quality: number;
  subsampling: SubsamplingId;
  huffman: HuffmanId;
  /** The reader's edited `[luma, chroma]` tables, or null when quality decides. */
  customTables: [number[], number[]] | null;
  /** Scan steps per second. */
  speed: number;
  /** True while the scan is playing. */
  playing: boolean;
  /** How many DCT patterns the k slider keeps (0-64). */
  dctK: number;
  /** The decode wipe position (0-1). */
  wipe: number;
  /** The error map's brightening. */
  errorGain: number;
  huffTables: HuffTableView[];
  segments: SegmentView[];
  /** Cached rate-distortion points for this picture and settings (possibly empty). */
  rd: RdPoint[];
  /** The file size at the other Huffman mode, when known. */
  otherBytes: number | null;
  /** PSNR after each re-save generation. */
  resave: number[];
  /** The current JPEG file. */
  jpeg: Uint8Array | null;
}
