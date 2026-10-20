// Byte statistics for the overview: what the pixels look like as raw bytes,
// before and after taking neighbour differences, and how many bits per byte
// an ideal entropy coder would need for them.

/** The RGB bytes of RGBA pixels: every 4th byte (alpha) dropped. */
export function rgbSamples(rgba: Uint8Array): Uint8Array {
  const n = Math.floor(rgba.length / 4);
  const out = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    out[i * 3] = rgba[i * 4];
    out[i * 3 + 1] = rgba[i * 4 + 1];
    out[i * 3 + 2] = rgba[i * 4 + 2];
  }
  return out;
}

/**
 * Each RGB sample minus the same channel of its left neighbour, mod 256. The
 * first column subtracts 0. The result has `w × h × 3` bytes.
 */
export function neighbourDiffs(rgba: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      for (let c = 0; c < 3; c++) {
        const left = x === 0 ? 0 : rgba[(p - 1) * 4 + c];
        out[p * 3 + c] = (rgba[p * 4 + c] - left) & 0xff;
      }
    }
  }
  return out;
}

/** How many times each byte value occurs: 256 bins. */
export function histogram(bytes: Uint8Array): Uint32Array {
  const bins = new Uint32Array(256);
  for (let i = 0; i < bytes.length; i++) bins[bytes[i]]++;
  return bins;
}

/** Shannon entropy of a histogram in bits per byte (0 when it is empty). */
export function entropyBits(hist: Uint32Array): number {
  let total = 0;
  for (const c of hist) total += c;
  if (total === 0) return 0;
  let bits = 0;
  for (const c of hist) {
    if (c > 0) bits -= (c / total) * Math.log2(c / total);
  }
  return bits;
}

// The overview draws both sizes as blocks of memory: equal cells of a whole
// power-of-two number of bytes, the same for the raw pixels and the file.

/** The smallest power-of-two block (in bytes, at least 1) that lays `rawBytes` out in at most `maxBlocks` blocks. */
export function blockSize(rawBytes: number, maxBlocks: number): number {
  let block = 1;
  while (block * Math.max(1, maxBlocks) < rawBytes) block *= 2;
  return block;
}

/** How many whole blocks `bytes` fills, and the share (0 to 1) of the next one. */
export function blockFill(bytes: number, block: number): { full: number; part: number } {
  if (!(bytes > 0) || !(block > 0)) return { full: 0, part: 0 };
  const full = Math.floor(bytes / block);
  return { full, part: (bytes - full * block) / block };
}

/** A block's size in whole units, as the overview's legend says it: 512 B, 4 KB. */
export function formatBlock(block: number): string {
  return block < 1024 ? `${block} B` : `${block / 1024} KB`;
}
