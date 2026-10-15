//! Baseline JFIF encode and decode, composed from the other modules. The
//! encoder keeps every intermediate in a `Trace` so each stage can be shown.

use crate::bits::{bit_string, BitReader, BitSpan, BitWriter};
use crate::blocks::{from_blocks, level_shift, mcu_layout, pad, to_blocks, unshift, McuLayout};
use crate::color::{merge_planes, split_planes, to_u8};
use crate::dct::{fdct, idct};
use crate::error::JpegError;
use crate::huffman::{
    canonical_codes, decode_symbol, encode_symbol, optimal_lengths, std_ac_chroma, std_ac_luma,
    std_dc_chroma, std_dc_luma, HuffDecoder, HuffSpec,
};
use crate::image::{Block, Plane, QBlock, Rgb8Image, Subsampling, Table};
use crate::jfif::{parse_segments, write_segments, Frame, FrameComponent, Segment, SegmentKind};
use crate::quant::{dequantize, quantize, scale_table, STD_CHROMA, STD_LUMA};
use crate::rle::{
    ac_symbols, amplitude_bits, dc_diff, from_amplitude_bits, size_category, AcToken,
};
use crate::sampling::{downsample, upsample, Upsample};
use crate::zigzag::{from_zigzag, from_zigzag_u16, to_zigzag};

/// Which Huffman tables the encoder writes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HuffmanMode {
    /// Built from this image's own symbol counts (Annex K.2).
    Optimized,
    /// The example tables from Annex K.3.
    Standard,
}

/// Encoder settings.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Options {
    /// 1–100 (clamped), scaling the standard tables.
    pub quality: u8,
    pub subsampling: Subsampling,
    pub huffman: HuffmanMode,
    /// `[luma, chroma]` tables used as-is instead of the scaled standard ones.
    pub tables: Option<[Table; 2]>,
    /// Encode the Y plane only.
    pub grayscale: bool,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            quality: 50,
            subsampling: Subsampling::S420,
            huffman: HuffmanMode::Optimized,
            tables: None,
            grayscale: false,
        }
    }
}

/// One coded block.
#[derive(Debug, Clone, PartialEq)]
pub struct BlockTrace {
    /// The DCT of the level-shifted samples.
    pub dct: Block,
    pub quant: QBlock,
    /// DC of the previous block in this component (0 for the first).
    pub dc_prev: i32,
    pub dc_diff: i32,
    pub tokens: Vec<AcToken>,
    /// This block's bits in the unstuffed scan payload.
    pub bits: BitSpan,
    /// Index of the MCU holding it.
    pub mcu: usize,
}

/// Table slots in `Trace::huffman` / `Trace::frequencies`.
pub const DC_LUMA: usize = 0;
pub const AC_LUMA: usize = 1;
pub const DC_CHROMA: usize = 2;
pub const AC_CHROMA: usize = 3;

/// Every intermediate of one encode.
#[derive(Debug, Clone)]
pub struct Trace {
    pub width: usize,
    pub height: usize,
    pub options: Options,
    /// Full-resolution Y, Cb, Cr (Y only for grayscale).
    pub planes: Vec<Plane>,
    /// The padded (and, for chroma, subsampled) planes cut into blocks.
    pub coded: Vec<Plane>,
    pub layout: McuLayout,
    /// `[luma, chroma]` quantization tables, row-major.
    pub tables: [Table; 2],
    /// Indexed by `DC_LUMA`, `AC_LUMA`, `DC_CHROMA`, `AC_CHROMA`.
    pub huffman: [HuffSpec; 4],
    pub frequencies: [[u32; 256]; 4],
    /// Per component, its blocks in raster order of `layout.grids[c]`.
    pub blocks: Vec<Vec<BlockTrace>>,
    /// Each MCU's bits in the payload, in scan order.
    pub mcu_bits: Vec<BitSpan>,
    /// The scan before byte stuffing.
    pub payload: Vec<u8>,
    pub segments: Vec<Segment>,
}

impl Trace {
    /// The coded samples (0–255, before the level shift) of block
    /// `(bx, by)` of component `c`.
    pub fn pixels(&self, c: usize, bx: usize, by: usize) -> Option<Block> {
        let p = self.coded.get(c)?;
        if (bx + 1) * 8 > p.w || (by + 1) * 8 > p.h {
            return None;
        }
        Some(std::array::from_fn(|i| {
            p.get(bx * 8 + i % 8, by * 8 + i / 8)
        }))
    }

    /// The trace of block `(bx, by)` of component `c`.
    pub fn block(&self, c: usize, bx: usize, by: usize) -> Option<&BlockTrace> {
        let (cols, rows) = *self.layout.grids.get(c)?;
        if bx >= cols || by >= rows {
            return None;
        }
        self.blocks[c].get(bx + cols * by)
    }

    /// A span's bits as '0'/'1'.
    pub fn bit_string(&self, span: BitSpan) -> String {
        bit_string(&self.payload, span)
    }
}

/// The file and how it was made.
#[derive(Debug, Clone)]
pub struct Encoded {
    pub bytes: Vec<u8>,
    pub trace: Trace,
}

/// The `(DC, AC)` Huffman slots for component `c`.
fn slots(c: usize) -> (usize, usize) {
    if c == 0 {
        (DC_LUMA, AC_LUMA)
    } else {
        (DC_CHROMA, AC_CHROMA)
    }
}

/// Encodes `img` as a baseline JFIF file.
pub fn encode(img: &Rgb8Image, opts: &Options) -> Result<Encoded, JpegError> {
    let ncomp = if opts.grayscale { 1 } else { 3 };
    let layout = mcu_layout(opts.subsampling, img.w, img.h, ncomp);
    let planes: Vec<Plane> = split_planes(img).into_iter().take(ncomp).collect();
    let coded: Vec<Plane> = planes
        .iter()
        .enumerate()
        .map(|(c, p)| {
            let padded = pad(p, layout.mcu_w, layout.mcu_h);
            if c == 0 {
                padded
            } else {
                downsample(&padded, opts.subsampling)
            }
        })
        .collect();
    let tables = opts.tables.unwrap_or([
        scale_table(&STD_LUMA, opts.quality),
        scale_table(&STD_CHROMA, opts.quality),
    ]);

    // Transform and quantize every block.
    let mut blocks: Vec<Vec<BlockTrace>> = Vec::with_capacity(ncomp);
    for (c, plane) in coded.iter().enumerate() {
        let table = &tables[(c > 0) as usize];
        let traces = to_blocks(plane)?
            .iter()
            .map(|b| {
                let dct = fdct(&level_shift(b));
                BlockTrace {
                    dct,
                    quant: quantize(&dct, table),
                    dc_prev: 0,
                    dc_diff: 0,
                    tokens: Vec::new(),
                    bits: BitSpan::default(),
                    mcu: 0,
                }
            })
            .collect();
        blocks.push(traces);
    }

    // Walk the scan: DC differences, AC tokens, symbol counts.
    let mut frequencies = [[0u32; 256]; 4];
    let mut pred = vec![0i32; ncomp];
    for (m, mcu) in layout.units.iter().enumerate() {
        for u in mcu {
            let b = &mut blocks[u.component][u.block];
            let dc = b.quant[0];
            b.dc_prev = pred[u.component];
            b.dc_diff = dc_diff(pred[u.component], dc);
            pred[u.component] = dc;
            b.tokens = ac_symbols(&to_zigzag(&b.quant));
            b.mcu = m;
            let (dc_slot, ac_slot) = slots(u.component);
            frequencies[dc_slot][size_category(b.dc_diff) as usize] += 1;
            for t in &b.tokens {
                frequencies[ac_slot][t.symbol() as usize] += 1;
            }
        }
    }

    let huffman: [HuffSpec; 4] = match opts.huffman {
        HuffmanMode::Optimized => std::array::from_fn(|slot| optimal_lengths(&frequencies[slot])),
        HuffmanMode::Standard => [
            std_dc_luma(),
            std_ac_luma(),
            std_dc_chroma(),
            std_ac_chroma(),
        ],
    };
    let codes = [
        canonical_codes(&huffman[0])?,
        canonical_codes(&huffman[1])?,
        canonical_codes(&huffman[2])?,
        canonical_codes(&huffman[3])?,
    ];

    // Write the bits.
    let mut w = BitWriter::new();
    let mut mcu_bits = Vec::with_capacity(layout.units.len());
    for mcu in &layout.units {
        let mcu_mark = w.mark();
        for u in mcu {
            let b = &mut blocks[u.component][u.block];
            let (dc_slot, ac_slot) = slots(u.component);
            let mark = w.mark();
            let (bits, size) = amplitude_bits(b.dc_diff);
            encode_symbol(&mut w, &codes[dc_slot], size)?;
            w.write(bits as u32, size);
            for t in &b.tokens {
                encode_symbol(&mut w, &codes[ac_slot], t.symbol())?;
                let (bits, size) = amplitude_bits(t.amp);
                w.write(bits as u32, size);
            }
            b.bits = w.span_since(mark);
        }
        mcu_bits.push(w.span_since(mcu_mark));
    }
    let (scan, payload) = w.finish();

    let (fh, fv) = if ncomp == 1 {
        (1, 1)
    } else {
        opts.subsampling.factors()
    };
    let mut components = vec![FrameComponent {
        id: 1,
        h: fh as u8,
        v: fv as u8,
        tq: 0,
        td: 0,
        ta: 0,
    }];
    let mut qtables = vec![(0, tables[0])];
    let mut htables = vec![(0, 0, &huffman[DC_LUMA]), (1, 0, &huffman[AC_LUMA])];
    if ncomp == 3 {
        for id in [2, 3] {
            components.push(FrameComponent {
                id,
                h: 1,
                v: 1,
                tq: 1,
                td: 1,
                ta: 1,
            });
        }
        qtables.push((1, tables[1]));
        htables.push((0, 1, &huffman[DC_CHROMA]));
        htables.push((1, 1, &huffman[AC_CHROMA]));
    }
    let bytes = write_segments(&Frame {
        width: img.w as u16,
        height: img.h as u16,
        components,
        qtables,
        htables,
        scan: &scan,
    });
    let segments = parse_segments(&bytes)?;
    Ok(Encoded {
        bytes,
        trace: Trace {
            width: img.w,
            height: img.h,
            options: *opts,
            planes,
            coded,
            layout,
            tables,
            huffman,
            frequencies,
            blocks,
            mcu_bits,
            payload,
            segments,
        },
    })
}

/// A decoded image and its full-resolution Y, Cb, Cr planes (Y only for
/// grayscale).
#[derive(Debug, Clone)]
pub struct Decoded {
    pub image: Rgb8Image,
    pub planes: Vec<Plane>,
}

fn byte(p: &[u8], i: usize) -> Result<u8, JpegError> {
    p.get(i).copied().ok_or(JpegError::Truncated)
}

/// `(frame component index, DC table id, AC table id)` for one scan component.
type ScanComponent = (usize, usize, usize);

/// Largest frame `decode` accepts (4096 × 4096), so a hostile header can't
/// ask for gigabytes.
pub const MAX_DECODE_PIXELS: usize = 1 << 24;

struct FrameInfo {
    width: usize,
    height: usize,
    /// `(id, h, v, tq)`
    comps: Vec<(u8, usize, usize, usize)>,
}

/// Decodes a baseline, Huffman-coded, 8-bit JFIF file with one interleaved
/// scan (what `encode` writes, and most ordinary JPEGs without restarts).
pub fn decode(bytes: &[u8]) -> Result<Decoded, JpegError> {
    let segs = parse_segments(bytes)?;
    let mut qt: [Option<Table>; 4] = [None; 4];
    let mut ht: [[Option<HuffSpec>; 4]; 2] = Default::default();
    let mut frame: Option<FrameInfo> = None;
    let mut scan: Option<(Vec<ScanComponent>, &[u8])> = None;
    for s in &segs {
        let p = s.payload(bytes);
        match s.kind {
            SegmentKind::Dqt => {
                let mut i = 0;
                while i < p.len() {
                    let pq_tq = p[i];
                    if pq_tq >> 4 != 0 {
                        return Err(JpegError::Unsupported("16-bit quantization tables"));
                    }
                    let id = (pq_tq & 15) as usize;
                    if id > 3 {
                        return Err(JpegError::Corrupt("quantization table id"));
                    }
                    let raw = p.get(i + 1..i + 65).ok_or(JpegError::Truncated)?;
                    let z: [u16; 64] = std::array::from_fn(|k| raw[k] as u16);
                    qt[id] = Some(from_zigzag_u16(&z));
                    i += 65;
                }
            }
            SegmentKind::Dht => {
                let mut i = 0;
                while i < p.len() {
                    let (class, id) = ((p[i] >> 4) as usize, (p[i] & 15) as usize);
                    if class > 1 || id > 3 {
                        return Err(JpegError::Corrupt("Huffman table id"));
                    }
                    let counts = p.get(i + 1..i + 17).ok_or(JpegError::Truncated)?;
                    let mut bits = [0u8; 16];
                    bits.copy_from_slice(counts);
                    let n: usize = bits.iter().map(|&b| b as usize).sum();
                    let vals = p.get(i + 17..i + 17 + n).ok_or(JpegError::Truncated)?;
                    ht[class][id] = Some(HuffSpec {
                        bits,
                        vals: vals.to_vec(),
                    });
                    i += 17 + n;
                }
            }
            SegmentKind::Sof0 => {
                if byte(p, 0)? != 8 {
                    return Err(JpegError::Unsupported("12-bit samples"));
                }
                let height = ((byte(p, 1)? as usize) << 8) | byte(p, 2)? as usize;
                let width = ((byte(p, 3)? as usize) << 8) | byte(p, 4)? as usize;
                if width == 0 || height == 0 {
                    return Err(JpegError::Unsupported("height defined later (DNL)"));
                }
                if width * height > MAX_DECODE_PIXELS {
                    return Err(JpegError::Unsupported("image larger than 16 megapixels"));
                }
                let nc = byte(p, 5)? as usize;
                if nc != 1 && nc != 3 {
                    return Err(JpegError::Unsupported("component count"));
                }
                let mut comps = Vec::with_capacity(nc);
                for c in 0..nc {
                    let hv = byte(p, 7 + 3 * c)?;
                    let tq = byte(p, 8 + 3 * c)? as usize;
                    if tq > 3 {
                        return Err(JpegError::Corrupt("quantization table id"));
                    }
                    comps.push((
                        byte(p, 6 + 3 * c)?,
                        (hv >> 4) as usize,
                        (hv & 15) as usize,
                        tq,
                    ));
                }
                frame = Some(FrameInfo {
                    width,
                    height,
                    comps,
                });
            }
            SegmentKind::SofOther => {
                return Err(JpegError::Unsupported(match s.marker {
                    0xC2 | 0xC6 => "progressive",
                    0xC9..=0xCF => "arithmetic coding",
                    _ => "non-baseline frame",
                }))
            }
            SegmentKind::Dri if (byte(p, 0)? != 0 || byte(p, 1)? != 0) => {
                return Err(JpegError::Unsupported("restart intervals"));
            }
            SegmentKind::Sos => {
                if scan.is_some() {
                    return Err(JpegError::Unsupported("multiple scans"));
                }
                let f = frame.as_ref().ok_or(JpegError::BadMarker(0xDA))?;
                let ns = byte(p, 0)? as usize;
                if ns != f.comps.len() {
                    return Err(JpegError::Unsupported("multiple scans"));
                }
                let mut sel = Vec::with_capacity(ns);
                for k in 0..ns {
                    let id = byte(p, 1 + 2 * k)?;
                    let tables = byte(p, 2 + 2 * k)?;
                    let c = f
                        .comps
                        .iter()
                        .position(|cc| cc.0 == id)
                        .ok_or(JpegError::Corrupt("scan component id"))?;
                    sel.push((c, (tables >> 4) as usize, (tables & 15) as usize));
                }
                let tail = p.get(1 + 2 * ns..4 + 2 * ns).ok_or(JpegError::Truncated)?;
                if tail != [0, 63, 0] {
                    return Err(JpegError::Unsupported("spectral selection"));
                }
                sel.sort_by_key(|t| t.0);
                scan = Some((sel, s.scan(bytes)));
            }
            _ => {}
        }
    }
    let f = frame.ok_or(JpegError::Corrupt("no frame header"))?;
    let (sel, data) = scan.ok_or(JpegError::Corrupt("no scan"))?;
    let nc = f.comps.len();
    let s = if nc == 1 {
        Subsampling::S444
    } else {
        if f.comps[1..].iter().any(|c| (c.1, c.2) != (1, 1)) {
            return Err(JpegError::Unsupported("sampling factors"));
        }
        Subsampling::from_factors(f.comps[0].1, f.comps[0].2)
            .ok_or(JpegError::Unsupported("sampling factors"))?
    };
    let layout = mcu_layout(s, f.width, f.height, nc);

    let mut dec = Vec::with_capacity(nc);
    for &(c, td, ta) in &sel {
        let table = qt[f.comps[c].3].ok_or(JpegError::Corrupt("missing quantization table"))?;
        let dc = ht[0]
            .get(td)
            .and_then(|t| t.as_ref())
            .ok_or(JpegError::Corrupt("missing Huffman table"))?;
        let ac = ht[1]
            .get(ta)
            .and_then(|t| t.as_ref())
            .ok_or(JpegError::Corrupt("missing Huffman table"))?;
        dec.push((table, HuffDecoder::new(dc)?, HuffDecoder::new(ac)?));
    }

    let mut out: Vec<Vec<Block>> = layout
        .grids
        .iter()
        .map(|&(cols, rows)| vec![[0.0; 64]; cols * rows])
        .collect();
    let mut pred = vec![0i32; nc];
    let mut r = BitReader::new(data);
    for mcu in &layout.units {
        for u in mcu {
            let (table, dcd, acd) = &dec[u.component];
            let size = decode_symbol(&mut r, dcd)?;
            if size > 11 {
                return Err(JpegError::Corrupt("DC size"));
            }
            let diff = from_amplitude_bits(r.read_bits(size)? as u16, size);
            pred[u.component] += diff;
            let mut z = [0i32; 64];
            z[0] = pred[u.component];
            let mut k = 1;
            while k < 64 {
                let rs = decode_symbol(&mut r, acd)?;
                let (run, size) = ((rs >> 4) as usize, rs & 15);
                if size == 0 {
                    if run == 15 {
                        k += 16;
                        continue;
                    }
                    break;
                }
                k += run;
                if k > 63 {
                    return Err(JpegError::Corrupt("zero run past coefficient 63"));
                }
                z[k] = from_amplitude_bits(r.read_bits(size)? as u16, size);
                k += 1;
            }
            // Each decoded sample is an 8-bit value: round and clamp before
            // upsampling and colour conversion, as libjpeg (and browsers) do.
            out[u.component][u.block] = unshift(&idct(&dequantize(&from_zigzag(&z), table)))
                .map(|v| v.round().clamp(0.0, 255.0));
        }
    }

    let (pw, ph) = (layout.grids[0].0 * 8, layout.grids[0].1 * 8);
    let mut planes = Vec::with_capacity(nc);
    for (c, blocks) in out.iter().enumerate() {
        let (cols, rows) = layout.grids[c];
        let coded = from_blocks(blocks, cols * 8, rows * 8)?;
        let full = if c == 0 {
            coded
        } else {
            upsample(&coded, s, Upsample::Fancy, pw, ph)
        };
        planes.push(crate::blocks::crop(&full, f.width, f.height)?);
    }
    let image = if nc == 3 {
        merge_planes(&[planes[0].clone(), planes[1].clone(), planes[2].clone()])?
    } else {
        let rgba = planes[0]
            .data
            .iter()
            .flat_map(|&y| {
                let v = to_u8(y);
                [v, v, v, 255]
            })
            .collect();
        Rgb8Image::new(f.width, f.height, rgba)?
    };
    Ok(Decoded { image, planes })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::metrics::psnr;

    /// A smooth gradient with a sharp-edged bar and a colour patch.
    fn test_image(w: usize, h: usize) -> Rgb8Image {
        let mut rgba = Vec::with_capacity(w * h * 4);
        for y in 0..h {
            for x in 0..w {
                let (fx, fy) = (x as f32 / w as f32, y as f32 / h as f32);
                let mut px = [
                    (40.0 + 180.0 * fx) as u8,
                    (60.0 + 150.0 * fy) as u8,
                    (200.0 - 120.0 * fx * fy) as u8,
                ];
                if x > w / 3 && x < w / 3 + 4 {
                    px = [10, 10, 10];
                }
                if y > h * 2 / 3 && x > w / 2 {
                    px = [230, 30, 40];
                }
                rgba.extend(px);
                rgba.push(255);
            }
        }
        Rgb8Image::new(w, h, rgba).unwrap()
    }

    /// Gentle gradients only: every subsampling should keep it well.
    fn smooth_image(w: usize, h: usize) -> Rgb8Image {
        let mut rgba = Vec::with_capacity(w * h * 4);
        for y in 0..h {
            for x in 0..w {
                let (fx, fy) = (x as f32 / w as f32, y as f32 / h as f32);
                rgba.extend([
                    (60.0 + 120.0 * fx) as u8,
                    (80.0 + 100.0 * fy) as u8,
                    (150.0 - 60.0 * fx * fy) as u8,
                    255,
                ]);
            }
        }
        Rgb8Image::new(w, h, rgba).unwrap()
    }

    fn opts(quality: u8, subsampling: Subsampling) -> Options {
        Options {
            quality,
            subsampling,
            ..Options::default()
        }
    }

    #[test]
    fn psnr_rises_with_quality() {
        let img = test_image(64, 48);
        let mut last = 0.0;
        for q in [10, 30, 50, 70, 90] {
            let e = encode(&img, &opts(q, Subsampling::S420)).unwrap();
            let p = psnr(&img, &decode(&e.bytes).unwrap().image).unwrap();
            assert!(p >= last, "q{q}: {p} < {last}");
            last = p;
        }
    }

    #[test]
    fn quality_100_full_chroma_is_near_lossless() {
        let img = test_image(64, 48);
        let e = encode(&img, &opts(100, Subsampling::S444)).unwrap();
        let p = psnr(&img, &decode(&e.bytes).unwrap().image).unwrap();
        assert!(p > 45.0, "{p}");
    }

    #[test]
    fn every_subsampling_and_odd_sizes_round_trip() {
        for s in [Subsampling::S444, Subsampling::S422, Subsampling::S420] {
            for (w, h) in [(17, 9), (8, 8), (33, 20)] {
                let img = smooth_image(w, h);
                let e = encode(&img, &opts(75, s)).unwrap();
                let d = decode(&e.bytes).unwrap();
                assert_eq!((d.image.w, d.image.h), (w, h));
                assert!(psnr(&img, &d.image).unwrap() > 35.0, "{s:?} {w}x{h}");
            }
        }
    }

    #[test]
    fn grayscale_round_trips() {
        let img = test_image(20, 12);
        let o = Options {
            grayscale: true,
            ..opts(90, Subsampling::S420)
        };
        let e = encode(&img, &o).unwrap();
        let d = decode(&e.bytes).unwrap();
        assert_eq!(d.planes.len(), 1);
        let px = &d.image.rgba[..4];
        assert!(px[0] == px[1] && px[1] == px[2]);
    }

    #[test]
    fn segments_come_in_baseline_order() {
        let e = encode(&test_image(16, 16), &Options::default()).unwrap();
        let kinds: Vec<SegmentKind> = e.trace.segments.iter().map(|s| s.kind).collect();
        use SegmentKind::*;
        assert_eq!(kinds, vec![Soi, App0, Dqt, Sof0, Dht, Sos, Eoi]);
    }

    #[test]
    fn optimized_tables_are_never_larger_than_standard() {
        let img = test_image(64, 64);
        let opt = encode(&img, &opts(50, Subsampling::S420)).unwrap();
        let std = encode(
            &img,
            &Options {
                huffman: HuffmanMode::Standard,
                ..opts(50, Subsampling::S420)
            },
        )
        .unwrap();
        assert!(opt.bytes.len() <= std.bytes.len());
        assert!(decode(&std.bytes).is_ok());
    }

    #[test]
    fn trace_spans_tile_the_payload() {
        let e = encode(&test_image(40, 24), &opts(50, Subsampling::S420)).unwrap();
        let t = &e.trace;
        let mut next = 0;
        for span in &t.mcu_bits {
            assert_eq!(span.start_bit, next);
            next += span.len;
        }
        let total: u64 = t.blocks.iter().flatten().map(|b| b.bits.len).sum();
        assert_eq!(total, next);
        assert!(t.payload.len() as u64 * 8 >= next);
        assert_eq!(t.layout.units.len(), t.mcu_bits.len());
        for (c, blocks) in t.blocks.iter().enumerate() {
            let (cols, rows) = t.layout.grids[c];
            assert_eq!(blocks.len(), cols * rows);
        }
    }

    #[test]
    fn trace_exposes_each_stage_of_a_block() {
        let e = encode(&test_image(32, 32), &opts(50, Subsampling::S420)).unwrap();
        let t = &e.trace;
        let px = t.pixels(0, 1, 1).unwrap();
        let b = t.block(0, 1, 1).unwrap();
        let dct = fdct(&level_shift(&px));
        assert_eq!(b.dct, dct);
        assert_eq!(b.quant, quantize(&dct, &t.tables[0]));
        assert_eq!(b.tokens, ac_symbols(&to_zigzag(&b.quant)));
        assert_eq!(t.bit_string(b.bits).len() as u64, b.bits.len);
        assert!(t.block(0, 4, 0).is_none());
        assert!(t.pixels(1, 2, 0).is_none()); // chroma is 16×16 here
    }

    #[test]
    fn dc_prediction_chains_within_a_component() {
        let e = encode(&test_image(32, 16), &opts(50, Subsampling::S444)).unwrap();
        let y = &e.trace.blocks[0];
        assert_eq!(y[0].dc_prev, 0);
        assert_eq!(y[1].dc_prev, y[0].quant[0]);
        assert_eq!(y[1].dc_diff, y[1].quant[0] - y[0].quant[0]);
    }

    #[test]
    fn custom_tables_are_used_as_given() {
        let tables = [[1u16; 64], [255u16; 64]];
        let o = Options {
            tables: Some(tables),
            ..Options::default()
        };
        let e = encode(&test_image(16, 16), &o).unwrap();
        assert_eq!(e.trace.tables, tables);
        assert!(decode(&e.bytes).is_ok());
    }

    #[test]
    fn decoded_samples_are_whole_bytes_before_colour_conversion() {
        // Low quality on hard edges makes the IDCT overshoot 0–255; the
        // decoder must clamp each sample (as libjpeg does) before converting.
        let e = encode(&test_image(32, 32), &opts(5, Subsampling::S444)).unwrap();
        let d = decode(&e.bytes).unwrap();
        for p in &d.planes {
            assert!(p
                .data
                .iter()
                .all(|&v| (0.0..=255.0).contains(&v) && v.fract() == 0.0));
        }
    }

    #[test]
    fn tiny_and_thin_images_round_trip() {
        for s in [Subsampling::S444, Subsampling::S422, Subsampling::S420] {
            for (w, h) in [(1, 1), (1, 40), (40, 1), (2, 3)] {
                let img = smooth_image(w, h);
                let e = encode(&img, &opts(90, s)).unwrap();
                let d = decode(&e.bytes).unwrap();
                assert_eq!((d.image.w, d.image.h), (w, h), "{s:?}");
            }
        }
    }

    #[test]
    fn a_flat_image_needs_one_symbol_per_table() {
        let img = Rgb8Image::new(16, 16, [90, 90, 90, 255].repeat(256)).unwrap();
        for huffman in [HuffmanMode::Optimized, HuffmanMode::Standard] {
            let o = Options {
                huffman,
                ..Options::default()
            };
            let e = encode(&img, &o).unwrap();
            assert_eq!(decode(&e.bytes).unwrap().image, img, "{huffman:?}");
        }
    }

    #[test]
    fn quality_extremes_encode_with_either_table_set() {
        let img = test_image(48, 32);
        for q in [1, 100] {
            for huffman in [HuffmanMode::Optimized, HuffmanMode::Standard] {
                let o = Options {
                    huffman,
                    ..opts(q, Subsampling::S444)
                };
                let e = encode(&img, &o).unwrap();
                assert!(decode(&e.bytes).is_ok(), "q{q} {huffman:?}");
            }
        }
    }

    #[test]
    fn corrupt_bytes_after_the_frame_header_never_panic() {
        let e = encode(&test_image(40, 24), &Options::default()).unwrap();
        let sof = e
            .trace
            .segments
            .iter()
            .find(|s| s.kind == SegmentKind::Sof0)
            .unwrap();
        let start = sof.offset + sof.len;
        let mut x = 0x2545_F491_u64;
        for _ in 0..2000 {
            let mut bytes = e.bytes.clone();
            for _ in 0..3 {
                x ^= x << 13;
                x ^= x >> 7;
                x ^= x << 17;
                let i = start + (x as usize) % (bytes.len() - start);
                bytes[i] = (x >> 32) as u8;
            }
            let _ = decode(&bytes); // Ok or Err, never a panic
        }
    }

    #[test]
    fn oversized_frames_are_refused_before_allocating() {
        let mut e = encode(&test_image(16, 16), &Options::default())
            .unwrap()
            .bytes;
        let segs = parse_segments(&e).unwrap();
        let sof = segs.iter().find(|s| s.kind == SegmentKind::Sof0).unwrap();
        // height and width = 65535
        e[sof.offset + 5..sof.offset + 9].copy_from_slice(&[0xFF, 0xFF, 0xFF, 0xFF]);
        assert_eq!(
            decode(&e).err(),
            Some(JpegError::Unsupported("image larger than 16 megapixels"))
        );
    }

    #[test]
    fn malformed_input_is_rejected_not_panicked_on() {
        let e = encode(&test_image(16, 16), &Options::default()).unwrap();
        let cut = &e.bytes[..e.bytes.len() / 2];
        assert_eq!(decode(cut).err(), Some(JpegError::Truncated));
        let mut prog = e.bytes.clone();
        let sof = e
            .trace
            .segments
            .iter()
            .find(|s| s.kind == SegmentKind::Sof0)
            .unwrap();
        prog[sof.offset + 1] = 0xC2;
        assert_eq!(
            decode(&prog).err(),
            Some(JpegError::Unsupported("progressive"))
        );
        assert!(decode(&[0xFF, 0xD8, 0xFF, 0xD9]).is_err());
        assert!(decode(&[]).is_err());
        // Garbage scan data must fail cleanly.
        let mut junk = e.bytes.clone();
        let sos = e
            .trace
            .segments
            .iter()
            .find(|s| s.kind == SegmentKind::Sos)
            .unwrap();
        for b in &mut junk[sos.offset + sos.header_len..sos.offset + sos.len] {
            *b = 0xFE;
        }
        let _ = decode(&junk); // any Result is fine; it must not panic
    }
}
