//! Cutting planes into 8×8 blocks and grouping blocks into MCUs (the unit
//! the scan walks).

use crate::error::JpegError;
use crate::image::{Block, Plane, Subsampling};

/// Grows a plane to the next multiple of `mw × mh` by repeating its last
/// column and row.
pub fn pad(p: &Plane, mw: usize, mh: usize) -> Plane {
    let (w, h) = (p.w.div_ceil(mw) * mw, p.h.div_ceil(mh) * mh);
    let mut out = Plane::new(w, h);
    for y in 0..h {
        for x in 0..w {
            out.data[x + w * y] = p.get_clamped(x as isize, y as isize);
        }
    }
    out
}

/// The top-left `w × h` of a plane.
pub fn crop(p: &Plane, w: usize, h: usize) -> Result<Plane, JpegError> {
    if w > p.w || h > p.h {
        return Err(JpegError::BadDimensions);
    }
    let mut out = Plane::new(w, h);
    for y in 0..h {
        out.data[w * y..w * (y + 1)].copy_from_slice(&p.data[p.w * y..p.w * y + w]);
    }
    Ok(out)
}

/// How many 8×8 blocks cover `w × h`: `(cols, rows)`.
pub fn block_grid(w: usize, h: usize) -> (usize, usize) {
    (w.div_ceil(8), h.div_ceil(8))
}

/// Cuts a plane whose sides are multiples of 8 into blocks, in raster order.
pub fn to_blocks(p: &Plane) -> Result<Vec<Block>, JpegError> {
    if !p.w.is_multiple_of(8) || !p.h.is_multiple_of(8) || p.w == 0 || p.h == 0 {
        return Err(JpegError::BadDimensions);
    }
    let (cols, rows) = block_grid(p.w, p.h);
    let mut out = Vec::with_capacity(cols * rows);
    for by in 0..rows {
        for bx in 0..cols {
            let mut b = [0.0; 64];
            for y in 0..8 {
                for x in 0..8 {
                    b[x + 8 * y] = p.get(bx * 8 + x, by * 8 + y);
                }
            }
            out.push(b);
        }
    }
    Ok(out)
}

/// Reassembles raster-order blocks into a `w × h` plane (multiples of 8).
pub fn from_blocks(blocks: &[Block], w: usize, h: usize) -> Result<Plane, JpegError> {
    if !w.is_multiple_of(8) || !h.is_multiple_of(8) {
        return Err(JpegError::BadDimensions);
    }
    let (cols, rows) = block_grid(w, h);
    crate::error::check_len(cols * rows, blocks.len())?;
    let mut out = Plane::new(w, h);
    for (i, b) in blocks.iter().enumerate() {
        let (bx, by) = (i % cols, i / cols);
        for y in 0..8 {
            for x in 0..8 {
                out.data[(bx * 8 + x) + w * (by * 8 + y)] = b[x + 8 * y];
            }
        }
    }
    Ok(out)
}

/// Centres samples on zero: `v − 128`.
pub fn level_shift(b: &Block) -> Block {
    b.map(|v| v - 128.0)
}

/// Undoes `level_shift`: `v + 128`.
pub fn unshift(b: &Block) -> Block {
    b.map(|v| v + 128.0)
}

/// One block's place in an MCU: which component, and its index in that
/// component's raster-order block list.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Unit {
    pub component: usize,
    pub block: usize,
}

/// The scan order of a frame.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McuLayout {
    /// MCUs across and down.
    pub cols: usize,
    pub rows: usize,
    /// MCU size in image pixels.
    pub mcu_w: usize,
    pub mcu_h: usize,
    /// Block grid `(cols, rows)` of each component's coded plane.
    pub grids: Vec<(usize, usize)>,
    /// For each MCU in scan order, its blocks in coding order.
    pub units: Vec<Vec<Unit>>,
}

/// The MCU layout for a `w × h` image with `components` (1 or 3).
/// Three components interleave: the luma blocks of an MCU (left-to-right,
/// top-to-bottom), then one Cb and one Cr block. One component has 8×8
/// MCUs of a single block, whatever `s` says.
pub fn mcu_layout(s: Subsampling, w: usize, h: usize, components: usize) -> McuLayout {
    let (fh, fv) = if components == 1 { (1, 1) } else { s.factors() };
    let (mcu_w, mcu_h) = (8 * fh, 8 * fv);
    let (cols, rows) = (w.div_ceil(mcu_w), h.div_ceil(mcu_h));
    let mut grids = vec![(cols * fh, rows * fv)];
    if components == 3 {
        grids.push((cols, rows));
        grids.push((cols, rows));
    }
    let mut units = Vec::with_capacity(cols * rows);
    for my in 0..rows {
        for mx in 0..cols {
            let mut mcu = Vec::with_capacity(fh * fv + 2);
            for dy in 0..fv {
                for dx in 0..fh {
                    let (bx, by) = (mx * fh + dx, my * fv + dy);
                    mcu.push(Unit {
                        component: 0,
                        block: bx + grids[0].0 * by,
                    });
                }
            }
            for c in 1..components {
                mcu.push(Unit {
                    component: c,
                    block: mx + cols * my,
                });
            }
            units.push(mcu);
        }
    }
    McuLayout {
        cols,
        rows,
        mcu_w,
        mcu_h,
        grids,
        units,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ramp(w: usize, h: usize) -> Plane {
        Plane {
            w,
            h,
            data: (0..w * h).map(|i| i as f32).collect(),
        }
    }

    #[test]
    fn pad_repeats_edges_and_crop_undoes_it() {
        let p = ramp(3, 2);
        let padded = pad(&p, 8, 8);
        assert_eq!((padded.w, padded.h), (8, 8));
        assert_eq!(padded.get(7, 7), p.get(2, 1));
        assert_eq!(crop(&padded, 3, 2).unwrap(), p);
        assert_eq!(crop(&p, 4, 2), Err(JpegError::BadDimensions));
    }

    #[test]
    fn blocks_round_trip_in_raster_order() {
        let p = ramp(16, 8);
        let blocks = to_blocks(&p).unwrap();
        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[1][0], 8.0); // second block starts at x = 8
        assert_eq!(from_blocks(&blocks, 16, 8).unwrap(), p);
        assert_eq!(to_blocks(&ramp(12, 8)), Err(JpegError::BadDimensions));
    }

    #[test]
    fn level_shift_round_trips() {
        let b = [200.0; 64];
        assert_eq!(level_shift(&b)[0], 72.0);
        assert_eq!(unshift(&level_shift(&b)), b);
    }

    #[test]
    fn s420_mcu_holds_four_luma_blocks_then_chroma() {
        let l = mcu_layout(Subsampling::S420, 32, 16, 3);
        assert_eq!((l.cols, l.rows, l.mcu_w, l.mcu_h), (2, 1, 16, 16));
        assert_eq!(l.grids, vec![(4, 2), (2, 1), (2, 1)]);
        let blocks: Vec<(usize, usize)> =
            l.units[1].iter().map(|u| (u.component, u.block)).collect();
        assert_eq!(blocks, vec![(0, 2), (0, 3), (0, 6), (0, 7), (1, 1), (2, 1)]);
    }

    #[test]
    fn grayscale_mcus_are_single_blocks() {
        let l = mcu_layout(Subsampling::S420, 17, 9, 1);
        assert_eq!((l.cols, l.rows), (3, 2));
        assert!(l.units.iter().all(|m| m.len() == 1));
    }
}
