//! Plain data types shared by every stage.

use crate::error::{check_len, JpegError};

/// 64 samples or coefficients, row-major: index `x + 8 * y` (for
/// coefficients, `u + 8 * v`, u the horizontal frequency).
pub type Block = [f32; 64];
/// 64 quantized coefficients, row-major.
pub type QBlock = [i32; 64];
/// A quantization table, row-major (not zigzag).
pub type Table = [u16; 64];

/// One channel of samples, row-major.
#[derive(Debug, Clone, PartialEq)]
pub struct Plane {
    pub w: usize,
    pub h: usize,
    pub data: Vec<f32>,
}

impl Plane {
    /// A `w × h` plane of zeros.
    pub fn new(w: usize, h: usize) -> Self {
        Self {
            w,
            h,
            data: vec![0.0; w * h],
        }
    }

    /// The sample at `(x, y)`; panics when out of range.
    pub fn get(&self, x: usize, y: usize) -> f32 {
        self.data[x + self.w * y]
    }

    /// The sample at `(x, y)` with both coordinates clamped into the plane
    /// (edge replication).
    pub fn get_clamped(&self, x: isize, y: isize) -> f32 {
        let x = x.clamp(0, self.w as isize - 1) as usize;
        let y = y.clamp(0, self.h as isize - 1) as usize;
        self.get(x, y)
    }
}

/// An 8-bit RGBA image (alpha is carried but never encoded).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rgb8Image {
    pub w: usize,
    pub h: usize,
    pub rgba: Vec<u8>,
}

/// Largest width or height a baseline JPEG frame header can hold.
pub const MAX_DIMENSION: usize = 65_535;

impl Rgb8Image {
    /// Validates the size (1..=65535 each way) and that `rgba` holds exactly
    /// `w * h * 4` bytes.
    pub fn new(w: usize, h: usize, rgba: Vec<u8>) -> Result<Self, JpegError> {
        if w == 0 || h == 0 || w > MAX_DIMENSION || h > MAX_DIMENSION {
            return Err(JpegError::BadDimensions);
        }
        check_len(w * h * 4, rgba.len())?;
        Ok(Self { w, h, rgba })
    }
}

/// How much chroma resolution survives.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Subsampling {
    /// Full-resolution chroma.
    S444,
    /// Chroma halved horizontally.
    S422,
    /// Chroma halved both ways.
    S420,
}

impl Subsampling {
    /// The luma sampling factors `(h, v)`; chroma is always `(1, 1)`.
    pub fn factors(self) -> (usize, usize) {
        match self {
            Self::S444 => (1, 1),
            Self::S422 => (2, 1),
            Self::S420 => (2, 2),
        }
    }

    /// The mode for luma factors `(h, v)`, if baseline-supported here.
    pub fn from_factors(h: usize, v: usize) -> Option<Self> {
        match (h, v) {
            (1, 1) => Some(Self::S444),
            (2, 1) => Some(Self::S422),
            (2, 2) => Some(Self::S420),
            _ => None,
        }
    }
}

/// The three channels after the colour transform.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Component {
    Y,
    Cb,
    Cr,
}

impl Component {
    /// 0, 1, 2 in frame order.
    pub fn index(self) -> usize {
        self as usize
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rgb8image_checks_its_buffer() {
        assert!(Rgb8Image::new(2, 2, vec![0; 16]).is_ok());
        assert_eq!(
            Rgb8Image::new(2, 2, vec![0; 15]),
            Err(JpegError::BadLength {
                expected: 16,
                got: 15
            })
        );
        assert_eq!(Rgb8Image::new(0, 2, vec![]), Err(JpegError::BadDimensions));
    }

    #[test]
    fn plane_clamps_at_its_edges() {
        let p = Plane {
            w: 2,
            h: 2,
            data: vec![1.0, 2.0, 3.0, 4.0],
        };
        assert_eq!(p.get_clamped(-5, -5), 1.0);
        assert_eq!(p.get_clamped(9, 0), 2.0);
        assert_eq!(p.get_clamped(1, 9), 4.0);
    }

    #[test]
    fn subsampling_factors_round_trip() {
        for s in [Subsampling::S444, Subsampling::S422, Subsampling::S420] {
            let (h, v) = s.factors();
            assert_eq!(Subsampling::from_factors(h, v), Some(s));
        }
        assert_eq!(Subsampling::from_factors(1, 2), None);
    }
}
