//! Where the JPEG lab points the reader on the Decode stage: the luma block
//! where each classic artifact is worst, found by comparing the decoded
//! image with the original.
//!
//! - **Blocking**: compression added a step at the block's right or bottom
//!   border that the original didn't have.
//! - **Ringing**: a block with a hard edge in the original whose pixels moved
//!   the most (the cosine terms that were cut overshoot near edges).
//! - **Chroma bleed**: the block whose colour (Cb, Cr) moved the most.

use jpeg::color::rgb_to_ycbcr;
use jpeg::Rgb8Image;
use serde::Serialize;

/// A neighbour difference above this (in luma levels) counts as a hard edge.
pub const EDGE_STEP: f32 = 64.0;

/// Luma block coordinates `[bx, by]` of each artifact's worst block.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Hints {
    /// The block whose right or bottom border gained the largest mean step
    /// (luma block coordinates).
    pub blocking: [usize; 2],
    /// `None` when the picture has no hard edges at all.
    pub ringing: Option<[usize; 2]>,
    /// The block with the largest mean Cb + Cr error.
    pub bleed: [usize; 2],
}

fn ycc(img: &Rgb8Image, x: usize, y: usize) -> [f32; 3] {
    let i = (x + img.w * y) * 4;
    rgb_to_ycbcr(
        img.rgba[i] as f32,
        img.rgba[i + 1] as f32,
        img.rgba[i + 2] as f32,
    )
}

/// The three hints, or `None` when the images differ in size or are empty.
pub fn find_hints(orig: &Rgb8Image, dec: &Rgb8Image) -> Option<Hints> {
    if orig.w != dec.w || orig.h != dec.h || orig.w == 0 || orig.h == 0 {
        return None;
    }
    let (w, h) = (orig.w, orig.h);
    let (cols, rows) = (w.div_ceil(8), h.div_ceil(8));
    let o: Vec<[f32; 3]> = (0..w * h).map(|i| ycc(orig, i % w, i / w)).collect();
    let d: Vec<[f32; 3]> = (0..w * h).map(|i| ycc(dec, i % w, i / w)).collect();
    let at = |v: &Vec<[f32; 3]>, x: usize, y: usize, c: usize| v[x + w * y][c];

    let mut blocking = ([0, 0], -1.0f32);
    let mut ringing: ([usize; 2], f32) = ([0, 0], -1.0);
    let mut bleed = ([0, 0], -1.0f32);
    for by in 0..rows {
        for bx in 0..cols {
            let (x0, y0) = (bx * 8, by * 8);
            let (x1, y1) = ((x0 + 8).min(w), (y0 + 8).min(h));

            // Blocking: the step compression added across the right or the
            // bottom border (decoded step minus original step), averaged per
            // border so blocks at the image's edge aren't favoured.
            let border = |pairs: &mut dyn Iterator<Item = ((usize, usize), (usize, usize))>| {
                let (mut step, mut n) = (0.0f32, 0usize);
                for ((ax, ay), (bx2, by2)) in pairs {
                    let dd = at(&d, bx2, by2, 0) - at(&d, ax, ay, 0);
                    let od = at(&o, bx2, by2, 0) - at(&o, ax, ay, 0);
                    step += (dd - od).abs();
                    n += 1;
                }
                if n == 0 {
                    0.0
                } else {
                    step / n as f32
                }
            };
            let right = if x1 < w {
                border(&mut (y0..y1).map(|y| ((x1 - 1, y), (x1, y))))
            } else {
                0.0
            };
            let bottom = if y1 < h {
                border(&mut (x0..x1).map(|x| ((x, y1 - 1), (x, y1))))
            } else {
                0.0
            };
            if (x1 < w || y1 < h) && right.max(bottom) > blocking.1 {
                blocking = ([bx, by], right.max(bottom));
            }

            // Per-block errors and edge strength.
            let (mut lum_err, mut chroma_err, mut edge) = (0.0f32, 0.0f32, 0.0f32);
            let n = ((x1 - x0) * (y1 - y0)) as f32;
            for y in y0..y1 {
                for x in x0..x1 {
                    lum_err += (at(&d, x, y, 0) - at(&o, x, y, 0)).abs();
                    chroma_err += (at(&d, x, y, 1) - at(&o, x, y, 1)).abs()
                        + (at(&d, x, y, 2) - at(&o, x, y, 2)).abs();
                    if x + 1 < x1 {
                        edge = edge.max((at(&o, x + 1, y, 0) - at(&o, x, y, 0)).abs());
                    }
                    if y + 1 < y1 {
                        edge = edge.max((at(&o, x, y + 1, 0) - at(&o, x, y, 0)).abs());
                    }
                }
            }
            if edge > EDGE_STEP && lum_err / n > ringing.1 {
                ringing = ([bx, by], lum_err / n);
            }
            if chroma_err / n > bleed.1 {
                bleed = ([bx, by], chroma_err / n);
            }
        }
    }
    Some(Hints {
        blocking: blocking.0,
        ringing: (ringing.1 >= 0.0).then_some(ringing.0),
        bleed: bleed.0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn img(w: usize, h: usize, f: impl Fn(usize, usize) -> [u8; 3]) -> Rgb8Image {
        let mut rgba = Vec::with_capacity(w * h * 4);
        for y in 0..h {
            for x in 0..w {
                rgba.extend(f(x, y));
                rgba.push(255);
            }
        }
        Rgb8Image::new(w, h, rgba).unwrap()
    }

    #[test]
    fn blocking_finds_the_step_compression_added() {
        // One block row, so every block's bottom border is the image's edge
        // and only right borders can score. The decoded copy jumps at x = 16,
        // the right border of block (1, 0); no other border changed.
        let orig = img(32, 8, |_, _| [100, 100, 100]);
        let dec = img(32, 8, |x, _| {
            if x >= 16 {
                [130, 130, 130]
            } else {
                [100, 100, 100]
            }
        });
        let h = find_hints(&orig, &dec).unwrap();
        assert_eq!(h.blocking, [1, 0]);
    }

    #[test]
    fn a_step_the_original_already_had_is_not_blocking() {
        let step = |x: usize, _y: usize| {
            if x >= 16 {
                [200, 200, 200]
            } else {
                [50, 50, 50]
            }
        };
        let orig = img(32, 8, step);
        let dec = img(32, 8, step);
        let h = find_hints(&orig, &dec).unwrap();
        // Nothing changed anywhere: every score ties at 0, the first block wins.
        assert_eq!(h.blocking, [0, 0]);
    }

    #[test]
    fn ringing_only_counts_blocks_with_a_hard_edge() {
        // A hard edge in block (2, 0); the decoded copy wobbles there and,
        // more strongly, in the flat block (0, 0).
        let orig = img(
            24,
            8,
            |x, _| if x >= 20 { [255, 255, 255] } else { [0, 0, 0] },
        );
        let dec = img(24, 8, |x, y| {
            if x < 8 {
                [40, 40, 40]
            } else if x >= 20 {
                [255, 255, 255]
            } else if x >= 16 && (x + y) % 2 == 0 {
                [20, 20, 20]
            } else {
                [0, 0, 0]
            }
        });
        let h = find_hints(&orig, &dec).unwrap();
        assert_eq!(h.ringing, Some([2, 0]));
        let flat = img(16, 8, |_, _| [10, 10, 10]);
        assert_eq!(find_hints(&flat, &flat).unwrap().ringing, None);
    }

    #[test]
    fn bleed_finds_the_colour_change() {
        let orig = img(16, 16, |_, _| [200, 50, 50]);
        let dec = img(16, 16, |x, y| {
            if x >= 8 && y >= 8 {
                [120, 90, 110]
            } else {
                [200, 50, 50]
            }
        });
        assert_eq!(find_hints(&orig, &dec).unwrap().bleed, [1, 1]);
    }

    #[test]
    fn mismatched_or_odd_sizes() {
        let a = img(8, 8, |_, _| [0, 0, 0]);
        let b = img(9, 8, |_, _| [0, 0, 0]);
        assert_eq!(find_hints(&a, &b), None);
        let odd = img(13, 5, |x, _| [x as u8 * 10, 0, 0]);
        assert!(find_hints(&odd, &odd).is_some());
    }

    #[test]
    fn a_single_block_has_no_border_to_score() {
        let orig = img(8, 8, |_, _| [100, 100, 100]);
        let dec = img(8, 8, |_, _| [130, 130, 130]);
        // One block and no neighbour: nothing scores, so the first block stays.
        assert_eq!(find_hints(&orig, &dec).unwrap().blocking, [0, 0]);
    }

    #[test]
    fn an_empty_image_has_no_hints() {
        // `Rgb8Image::new` rejects zero sizes, but the fields are public.
        let empty = Rgb8Image {
            w: 0,
            h: 0,
            rgba: Vec::new(),
        };
        assert_eq!(find_hints(&empty, &empty), None);
    }
}
