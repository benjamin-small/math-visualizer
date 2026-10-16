// The JPEG rule's per-frame summary, parsed defensively: wasm-bindgen hands
// Rust's `None` over as `undefined`, so every optional field is checked with
// `== null` (null or undefined), never `=== null`.

export interface AcToken {
  run: number;
  size: number;
  amp: number;
  symbol: number;
}

export interface SelectedBlock {
  /** 0 = Y, 1 = Cb, 2 = Cr. */
  component: number;
  bx: number;
  by: number;
  mcu: number;
  /** The 64 coded samples (0–255), row-major. */
  pixels: number[];
  /** `pixels − 128`. */
  shifted: number[];
  dct: number[];
  quant: number[];
  table: number[];
  zigzag: number[];
  dcPrev: number;
  dcDiff: number;
  tokens: AcToken[];
  bitSpan: [number, number];
  bits: string;
}

export interface JpegSummary {
  version: number;
  n: number;
  total: number;
  width: number;
  height: number;
  bytes: number;
  rawBytes: number;
  bitsSoFar: number;
  payloadBits: number;
  entropyBits: number;
  /** dB; null for a perfect copy. */
  psnr: number | null;
  quality: number | null;
  subsampling: string | null;
  /** `[mcu_w, mcu_h, cols, rows]`. */
  mcu: [number, number, number, number] | null;
  /** Block grid `[cols, rows]` per component. */
  grids: [number, number][];
  selected: SelectedBlock | null;
  error: string | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const nums = (v: unknown): number[] => (Array.isArray(v) ? v.map((x) => num(x)) : []);

function readSelected(v: unknown): SelectedBlock | null {
  if (!isObj(v)) return null;
  const pixels = nums(v.pixels);
  if (pixels.length !== 64) return null;
  const span = nums(v.bit_span);
  return {
    component: num(v.component),
    bx: num(v.bx),
    by: num(v.by),
    mcu: num(v.mcu),
    pixels,
    shifted: nums(v.shifted),
    dct: nums(v.dct),
    quant: nums(v.quant),
    table: nums(v.table),
    zigzag: nums(v.zigzag),
    dcPrev: num(v.dc_prev),
    dcDiff: num(v.dc_diff),
    tokens: Array.isArray(v.tokens)
      ? v.tokens.filter(isObj).map((t) => ({ run: num(t.run), size: num(t.size), amp: num(t.amp), symbol: num(t.symbol) }))
      : [],
    bitSpan: [num(span[0]), num(span[1])],
    bits: typeof v.bits === 'string' ? v.bits : '',
  };
}

/** Parse what `engine.rule_summary()` returned; null when it isn't a JPEG summary. */
export function readSummary(raw: unknown): JpegSummary | null {
  if (!isObj(raw) || typeof raw.total !== 'number') return null;
  const mcu = nums(raw.mcu);
  return {
    version: num(raw.version),
    n: num(raw.n),
    total: num(raw.total),
    width: num(raw.width),
    height: num(raw.height),
    bytes: num(raw.bytes),
    rawBytes: num(raw.raw_bytes),
    bitsSoFar: num(raw.bits_so_far),
    payloadBits: num(raw.payload_bits),
    entropyBits: num(raw.entropy_bits),
    psnr: raw.psnr == null ? null : num(raw.psnr),
    quality: raw.quality == null ? null : num(raw.quality),
    subsampling: typeof raw.subsampling === 'string' ? raw.subsampling : null,
    mcu: mcu.length === 4 ? [mcu[0], mcu[1], mcu[2], mcu[3]] : null,
    grids: Array.isArray(raw.grids)
      ? raw.grids.map((g) => {
          const [c, r] = nums(g);
          return [num(c), num(r)] as [number, number];
        })
      : [],
    selected: readSelected(raw.selected),
    error: typeof raw.error === 'string' ? raw.error : null,
  };
}

/** `18.4 KB` / `512 B`: bytes for people. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${Math.round(n)} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}

/** The readout strip's figures: size, ratio, bits per pixel, PSNR. */
export function readoutOf(s: JpegSummary): { size: string; of: string; ratio: string; bpp: string; psnr: string } {
  const px = Math.max(1, s.width * s.height);
  return {
    size: formatBytes(s.bytes),
    of: formatBytes(s.rawBytes),
    ratio: s.bytes > 0 ? `${(s.rawBytes / s.bytes).toFixed(1)} : 1` : '–',
    bpp: ((8 * s.bytes) / px).toFixed(2),
    psnr: s.psnr == null ? '∞ dB' : `${s.psnr.toFixed(1)} dB`,
  };
}
