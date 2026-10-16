// The JPEG rule's per-frame summary, parsed defensively: wasm-bindgen hands
// Rust's `None` over as `undefined`, so every optional field is checked with
// `== null` (null or undefined), never `=== null`.

/** One run-length token of a block's AC coefficients. */
export interface AcToken {
  /** Zeros before the coefficient (0–15). */
  run: number;
  /** Bits needed for `amp` (0 for ZRL and EOB). */
  size: number;
  /** The coefficient value (0 for ZRL and EOB). */
  amp: number;
  /** The Huffman symbol, `run << 4 | size`. */
  symbol: number;
  /** The symbol's Huffman code as 0s and 1s. */
  code: string;
  /** The amplitude bits that follow the code (empty for ZRL and EOB). */
  ampBits: string;
}

/** Luma block `[bx, by]` where each compression artifact is worst. */
export interface Hints {
  blocking: [number, number];
  /** Null when the picture has no hard edges. */
  ringing: [number, number] | null;
  bleed: [number, number];
}

/** The block the stages follow, with every intermediate form of it. */
export interface SelectedBlock {
  /** 0 = Y, 1 = Cb, 2 = Cr. */
  component: number;
  /** Block column in that component's grid. */
  bx: number;
  /** Block row in that component's grid. */
  by: number;
  /** Index of the MCU the block belongs to (its place in the scan). */
  mcu: number;
  /** The 64 coded samples (0–255), row-major. */
  pixels: number[];
  /** `pixels − 128`. */
  shifted: number[];
  /** The 64 DCT coefficients, row-major (index `u + 8v`). */
  dct: number[];
  /** The quantized coefficients, row-major. */
  quant: number[];
  /** The quantization table in use, row-major. */
  table: number[];
  /** The quantized coefficients in zigzag order. */
  zigzag: number[];
  /** The quantized DC of the previous block of this component (0 for the first). */
  dcPrev: number;
  /** This block's quantized DC minus `dcPrev`: the value that gets coded. */
  dcDiff: number;
  /** Bits needed for `dcDiff` (the DC Huffman symbol). */
  dcSize: number;
  /** The DC symbol's Huffman code as 0s and 1s. */
  dcCode: string;
  /** The amplitude bits of `dcDiff`. */
  dcAmpBits: string;
  /** The AC coefficients as run/size tokens (ending with EOB unless the last coefficient is non-zero). */
  tokens: AcToken[];
  /** `[start bit, length]` of this block's bits in the entropy-coded payload. */
  bitSpan: [number, number];
  /** This block's bits, as a string of 0s and 1s. */
  bits: string;
}

/** The rule's per-frame summary: the encode's totals, the scan position and the selected block. */
export interface JpegSummary {
  /** Changes on every re-encode. */
  version: number;
  /** MCUs scanned so far. */
  n: number;
  /** MCUs in the image. */
  total: number;
  /** Image width in pixels. */
  width: number;
  /** Image height in pixels. */
  height: number;
  /** Size of the JPEG file. */
  bytes: number;
  /** Size of the same image as raw RGB. */
  rawBytes: number;
  /** Payload bits written for the MCUs scanned so far. */
  bitsSoFar: number;
  /** Payload bits of the whole scan. */
  payloadBits: number;
  /** Shannon's bound for the scan's symbols: the fewest bits any code could spend on them. */
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
  /** Where each artifact is worst; null when the encode failed. */
  hints: Hints | null;
  /** Why the encode failed, or null. */
  error: string | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const pair = (v: unknown): [number, number] | null => {
  const p = Array.isArray(v) ? v : [];
  return p.length === 2 && p.every((x) => typeof x === 'number') ? [p[0], p[1]] : null;
};

function readHints(v: unknown): Hints | null {
  if (!isObj(v)) return null;
  const blocking = pair(v.blocking);
  const bleed = pair(v.bleed);
  return blocking && bleed ? { blocking, ringing: pair(v.ringing), bleed } : null;
}

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
    dcSize: num(v.dc_size),
    dcCode: str(v.dc_code),
    dcAmpBits: str(v.dc_amp_bits),
    tokens: Array.isArray(v.tokens)
      ? v.tokens.filter(isObj).map((t) => ({
          run: num(t.run),
          size: num(t.size),
          amp: num(t.amp),
          symbol: num(t.symbol),
          code: str(t.code),
          ampBits: str(t.amp_bits),
        }))
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
    hints: readHints(raw.hints),
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
