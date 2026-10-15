//! How much was lost, and how close the bits came to the entropy limit.

use crate::error::JpegError;
use crate::image::{Plane, Rgb8Image};

fn same_size(a: &Rgb8Image, b: &Rgb8Image) -> Result<(), JpegError> {
    if a.w != b.w || a.h != b.h {
        return Err(JpegError::BadDimensions);
    }
    Ok(())
}

/// Mean squared error over the R, G and B channels.
pub fn mse(a: &Rgb8Image, b: &Rgb8Image) -> Result<f64, JpegError> {
    same_size(a, b)?;
    let mut sum = 0.0f64;
    for (pa, pb) in a.rgba.chunks_exact(4).zip(b.rgba.chunks_exact(4)) {
        for c in 0..3 {
            let d = pa[c] as f64 - pb[c] as f64;
            sum += d * d;
        }
    }
    Ok(sum / (a.w * a.h * 3) as f64)
}

/// `10·log10(255² / MSE)` in dB; `f64::INFINITY` for identical images.
pub fn psnr(a: &Rgb8Image, b: &Rgb8Image) -> Result<f64, JpegError> {
    let m = mse(a, b)?;
    Ok(if m == 0.0 {
        f64::INFINITY
    } else {
        10.0 * (255.0 * 255.0 / m).log10()
    })
}

/// Per pixel, the mean absolute difference over R, G, B.
pub fn error_plane(a: &Rgb8Image, b: &Rgb8Image) -> Result<Plane, JpegError> {
    same_size(a, b)?;
    let mut p = Plane::new(a.w, a.h);
    for (i, (pa, pb)) in a
        .rgba
        .chunks_exact(4)
        .zip(b.rgba.chunks_exact(4))
        .enumerate()
    {
        p.data[i] = (0..3)
            .map(|c| (pa[c] as f32 - pb[c] as f32).abs())
            .sum::<f32>()
            / 3.0;
    }
    Ok(p)
}

/// Shannon's bound: the fewest bits any code could spend on symbols with
/// this histogram, `Σ f·log2(N / f)`.
pub fn entropy_bits(freq: &[u32]) -> f64 {
    let n: f64 = freq.iter().map(|&f| f as f64).sum();
    freq.iter()
        .filter(|&&f| f > 0)
        .map(|&f| f as f64 * (n / f as f64).log2())
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn img(v: u8) -> Rgb8Image {
        Rgb8Image::new(2, 1, vec![v, v, v, 255, v, v, v, 255]).unwrap()
    }

    #[test]
    fn identical_images_have_infinite_psnr() {
        assert_eq!(mse(&img(10), &img(10)).unwrap(), 0.0);
        assert!(psnr(&img(10), &img(10)).unwrap().is_infinite());
    }

    #[test]
    fn psnr_of_a_known_error() {
        // Every channel off by 1 → MSE 1 → 48.13 dB.
        let p = psnr(&img(10), &img(11)).unwrap();
        assert!((p - 48.1308).abs() < 1e-3);
        assert_eq!(
            error_plane(&img(10), &img(13)).unwrap().data,
            vec![3.0, 3.0]
        );
    }

    #[test]
    fn size_mismatch_is_an_error() {
        let other = Rgb8Image::new(1, 1, vec![0; 4]).unwrap();
        assert_eq!(mse(&img(0), &other), Err(JpegError::BadDimensions));
    }

    #[test]
    fn entropy_of_simple_histograms() {
        assert_eq!(entropy_bits(&[4, 0, 0]), 0.0);
        assert!((entropy_bits(&[1, 1, 1, 1]) - 8.0).abs() < 1e-9); // 4 × 2 bits
        assert_eq!(entropy_bits(&[]), 0.0);
    }
}
