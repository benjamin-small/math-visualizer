//! RGB ↔ YCbCr (JFIF full-range BT.601): a 3×3 linear map plus an offset
//! that turns the colour cube so its grey diagonal becomes the Y axis.

use crate::error::JpegError;
use crate::image::{Plane, Rgb8Image};

/// Rows give Y, Cb, Cr as weights of (R, G, B).
pub const RGB_TO_YCBCR: [[f32; 3]; 3] = [
    [0.299, 0.587, 0.114],
    [-0.168_736, -0.331_264, 0.5],
    [0.5, -0.418_688, -0.081_312],
];
/// Added after the matrix so Cb and Cr sit around 128.
pub const YCBCR_OFFSET: [f32; 3] = [0.0, 128.0, 128.0];
/// Rows give R, G, B as weights of (Y, Cb − 128, Cr − 128).
pub const YCBCR_TO_RGB: [[f32; 3]; 3] = [
    [1.0, 0.0, 1.402],
    [1.0, -0.344_136, -0.714_136],
    [1.0, 1.772, 0.0],
];

/// One pixel forward. Inputs and outputs are 0–255 floats (unclamped).
pub fn rgb_to_ycbcr(r: f32, g: f32, b: f32) -> [f32; 3] {
    let m = RGB_TO_YCBCR;
    [
        m[0][0] * r + m[0][1] * g + m[0][2] * b + YCBCR_OFFSET[0],
        m[1][0] * r + m[1][1] * g + m[1][2] * b + YCBCR_OFFSET[1],
        m[2][0] * r + m[2][1] * g + m[2][2] * b + YCBCR_OFFSET[2],
    ]
}

/// One pixel back (unclamped).
pub fn ycbcr_to_rgb(y: f32, cb: f32, cr: f32) -> [f32; 3] {
    let m = YCBCR_TO_RGB;
    let (cb, cr) = (cb - 128.0, cr - 128.0);
    [
        m[0][0] * y + m[0][1] * cb + m[0][2] * cr,
        m[1][0] * y + m[1][1] * cb + m[1][2] * cr,
        m[2][0] * y + m[2][1] * cb + m[2][2] * cr,
    ]
}

/// The Y, Cb and Cr planes of an image.
pub fn split_planes(img: &Rgb8Image) -> [Plane; 3] {
    let mut out = [
        Plane::new(img.w, img.h),
        Plane::new(img.w, img.h),
        Plane::new(img.w, img.h),
    ];
    for (i, px) in img.rgba.chunks_exact(4).enumerate() {
        let ycc = rgb_to_ycbcr(px[0] as f32, px[1] as f32, px[2] as f32);
        for c in 0..3 {
            out[c].data[i] = ycc[c];
        }
    }
    out
}

/// Rebuilds an opaque image from full-size Y, Cb, Cr planes, rounding and
/// clamping each channel to 0–255.
pub fn merge_planes(planes: &[Plane; 3]) -> Result<Rgb8Image, JpegError> {
    let (w, h) = (planes[0].w, planes[0].h);
    if planes.iter().any(|p| p.w != w || p.h != h) {
        return Err(JpegError::BadDimensions);
    }
    let mut rgba = Vec::with_capacity(w * h * 4);
    for i in 0..w * h {
        let rgb = ycbcr_to_rgb(planes[0].data[i], planes[1].data[i], planes[2].data[i]);
        rgba.extend(rgb.iter().map(|&v| to_u8(v)));
        rgba.push(255);
    }
    Rgb8Image::new(w, h, rgba)
}

/// Rounds and clamps a sample to a byte.
pub fn to_u8(v: f32) -> u8 {
    v.round().clamp(0.0, 255.0) as u8
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grey_has_neutral_chroma() {
        let [y, cb, cr] = rgb_to_ycbcr(100.0, 100.0, 100.0);
        assert!((y - 100.0).abs() < 1e-3);
        assert!((cb - 128.0).abs() < 1e-3);
        assert!((cr - 128.0).abs() < 1e-3);
    }

    #[test]
    fn pixels_round_trip_within_one_level() {
        for r in (0..=255).step_by(15) {
            for g in (0..=255).step_by(15) {
                for b in (0..=255).step_by(15) {
                    let [y, cb, cr] = rgb_to_ycbcr(r as f32, g as f32, b as f32);
                    let back = ycbcr_to_rgb(y, cb, cr);
                    for (orig, got) in [r, g, b].iter().zip(back) {
                        assert!((*orig as f32 - got).abs() < 0.01, "{r},{g},{b}");
                    }
                }
            }
        }
    }

    #[test]
    fn planes_round_trip_an_image() {
        let rgba: Vec<u8> = (0..4 * 3 * 2).map(|i| (i * 37 % 256) as u8).collect();
        let mut img = Rgb8Image::new(3, 2, rgba).unwrap();
        for px in img.rgba.chunks_exact_mut(4) {
            px[3] = 255;
        }
        assert_eq!(merge_planes(&split_planes(&img)).unwrap(), img);
    }

    #[test]
    fn merge_rejects_mismatched_planes() {
        let planes = [Plane::new(2, 2), Plane::new(2, 2), Plane::new(1, 2)];
        assert_eq!(merge_planes(&planes), Err(JpegError::BadDimensions));
    }
}
