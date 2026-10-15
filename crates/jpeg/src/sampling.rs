//! Chroma subsampling: average away colour resolution the eye barely
//! misses, and bring it back for display.

use crate::image::{Plane, Subsampling};

/// How a subsampled plane is stretched back to full size.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Upsample {
    /// Each sample becomes an `h × v` tile — shows the blocks.
    Nearest,
    /// libjpeg's "fancy" triangle filter (¾ nearer sample + ¼ farther one,
    /// per doubled axis), which browsers use; the decoder uses this.
    Fancy,
}

/// Box-averages `h × v` tiles (the luma factors of `s`). Output size is
/// `ceil(w / h) × ceil(h / v)`; tiles past the edge reuse edge samples.
pub fn downsample(p: &Plane, s: Subsampling) -> Plane {
    let (fh, fv) = s.factors();
    let (ow, oh) = (p.w.div_ceil(fh), p.h.div_ceil(fv));
    let mut out = Plane::new(ow, oh);
    let n = (fh * fv) as f32;
    for oy in 0..oh {
        for ox in 0..ow {
            let mut sum = 0.0;
            for dy in 0..fv {
                for dx in 0..fh {
                    sum += p.get_clamped((ox * fh + dx) as isize, (oy * fv + dy) as isize);
                }
            }
            out.data[ox + ow * oy] = sum / n;
        }
    }
    out
}

/// Stretches a plane subsampled with `s` back to `w × h`.
pub fn upsample(p: &Plane, s: Subsampling, mode: Upsample, w: usize, h: usize) -> Plane {
    let (fh, fv) = s.factors();
    match mode {
        Upsample::Nearest => {
            let mut out = Plane::new(w, h);
            for y in 0..h {
                for x in 0..w {
                    out.data[x + w * y] = p.get_clamped((x / fh) as isize, (y / fv) as isize);
                }
            }
            out
        }
        Upsample::Fancy => {
            let wide = if fh == 2 {
                triangle_x(p, w)
            } else {
                resize_x(p, w)
            };
            if fv == 2 {
                triangle_y(&wide, h)
            } else {
                resize_y(&wide, h)
            }
        }
    }
}

/// Doubles width: output 2i = ¾·in[i] + ¼·in[i−1], 2i+1 = ¾·in[i] + ¼·in[i+1].
fn triangle_x(p: &Plane, w: usize) -> Plane {
    let mut out = Plane::new(w, p.h);
    for y in 0..p.h {
        for x in 0..w {
            let i = (x / 2) as isize;
            let far = if x % 2 == 0 { i - 1 } else { i + 1 };
            out.data[x + w * y] =
                0.75 * p.get_clamped(i, y as isize) + 0.25 * p.get_clamped(far, y as isize);
        }
    }
    out
}

/// Doubles height the same way as `triangle_x`.
fn triangle_y(p: &Plane, h: usize) -> Plane {
    let mut out = Plane::new(p.w, h);
    for y in 0..h {
        let i = (y / 2) as isize;
        let far = if y % 2 == 0 { i - 1 } else { i + 1 };
        for x in 0..p.w {
            out.data[x + p.w * y] =
                0.75 * p.get_clamped(x as isize, i) + 0.25 * p.get_clamped(x as isize, far);
        }
    }
    out
}

/// Crops or edge-extends to width `w` without scaling.
fn resize_x(p: &Plane, w: usize) -> Plane {
    let mut out = Plane::new(w, p.h);
    for y in 0..p.h {
        for x in 0..w {
            out.data[x + w * y] = p.get_clamped(x as isize, y as isize);
        }
    }
    out
}

/// Crops or edge-extends to height `h` without scaling.
fn resize_y(p: &Plane, h: usize) -> Plane {
    let mut out = Plane::new(p.w, h);
    for y in 0..h {
        for x in 0..p.w {
            out.data[x + p.w * y] = p.get_clamped(x as isize, y as isize);
        }
    }
    out
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
    fn downsample_averages_tiles() {
        let p = ramp(4, 2); // rows 0 1 2 3 / 4 5 6 7
        let d = downsample(&p, Subsampling::S420);
        assert_eq!((d.w, d.h), (2, 1));
        assert_eq!(d.data, vec![2.5, 4.5]);
        let d = downsample(&p, Subsampling::S422);
        assert_eq!((d.w, d.h), (2, 2));
        assert_eq!(d.data, vec![0.5, 2.5, 4.5, 6.5]);
        assert_eq!(downsample(&p, Subsampling::S444), p);
    }

    #[test]
    fn downsample_rounds_odd_sizes_up() {
        let d = downsample(&ramp(3, 3), Subsampling::S420);
        assert_eq!((d.w, d.h), (2, 2));
    }

    #[test]
    fn upsampling_a_flat_plane_stays_flat() {
        let flat = Plane {
            w: 4,
            h: 4,
            data: vec![7.0; 16],
        };
        for mode in [Upsample::Nearest, Upsample::Fancy] {
            let u = upsample(&flat, Subsampling::S420, mode, 8, 8);
            assert!(u.data.iter().all(|&v| (v - 7.0).abs() < 1e-6));
        }
    }

    #[test]
    fn fancy_blends_toward_the_nearer_sample() {
        let p = Plane {
            w: 2,
            h: 1,
            data: vec![0.0, 100.0],
        };
        let u = upsample(&p, Subsampling::S422, Upsample::Fancy, 4, 1);
        assert_eq!(u.data, vec![0.0, 25.0, 75.0, 100.0]);
        let n = upsample(&p, Subsampling::S422, Upsample::Nearest, 4, 1);
        assert_eq!(n.data, vec![0.0, 0.0, 100.0, 100.0]);
    }
}
