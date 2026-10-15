//! Quantization: divide each coefficient by its table entry and round.
//! This is where most of JPEG's loss happens.

use crate::image::{Block, QBlock, Table};

/// ITU T.81 Annex K, Table K.1 (luminance), row-major.
pub const STD_LUMA: Table = [
    16, 11, 10, 16, 24, 40, 51, 61, //
    12, 12, 14, 19, 26, 58, 60, 55, //
    14, 13, 16, 24, 40, 57, 69, 56, //
    14, 17, 22, 29, 51, 87, 80, 62, //
    18, 22, 37, 56, 68, 109, 103, 77, //
    24, 35, 55, 64, 81, 104, 113, 92, //
    49, 64, 78, 87, 103, 121, 120, 101, //
    72, 92, 95, 98, 112, 100, 103, 99, //
];

/// ITU T.81 Annex K, Table K.2 (chrominance), row-major.
pub const STD_CHROMA: Table = [
    17, 18, 24, 47, 99, 99, 99, 99, //
    18, 21, 26, 66, 99, 99, 99, 99, //
    24, 26, 56, 99, 99, 99, 99, 99, //
    47, 66, 99, 99, 99, 99, 99, 99, //
    99, 99, 99, 99, 99, 99, 99, 99, //
    99, 99, 99, 99, 99, 99, 99, 99, //
    99, 99, 99, 99, 99, 99, 99, 99, //
    99, 99, 99, 99, 99, 99, 99, 99, //
];

/// The IJG quality scaling: quality (clamped to 1–100) → percentage
/// `s = 5000 / q` below 50, `200 − 2q` from 50; each entry becomes
/// `(base·s + 50) / 100` clamped to 1–255. Quality 50 returns `base`.
pub fn scale_table(base: &Table, quality: u8) -> Table {
    let q = quality.clamp(1, 100) as u32;
    let s = if q < 50 { 5000 / q } else { 200 - 2 * q };
    base.map(|b| ((b as u32 * s + 50) / 100).clamp(1, 255) as u16)
}

/// `round(F / Q)`, halves away from zero.
pub fn quantize(c: &Block, t: &Table) -> QBlock {
    let mut out = [0; 64];
    for i in 0..64 {
        out[i] = (c[i] / t[i] as f32).round() as i32;
    }
    out
}

/// `q · Q` — the coefficients the decoder sees.
pub fn dequantize(q: &QBlock, t: &Table) -> Block {
    let mut out = [0.0; 64];
    for i in 0..64 {
        out[i] = (q[i] * t[i] as i32) as f32;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dct::fdct;

    #[test]
    fn quality_50_is_the_base_table() {
        assert_eq!(scale_table(&STD_LUMA, 50), STD_LUMA);
    }

    #[test]
    fn scaling_clamps_to_one_through_255() {
        assert!(scale_table(&STD_LUMA, 100).iter().all(|&v| v == 1));
        assert!(scale_table(&STD_LUMA, 1)
            .iter()
            .all(|&v| v == 255 || v >= 160));
        assert_eq!(scale_table(&STD_LUMA, 0), scale_table(&STD_LUMA, 1));
        assert_eq!(scale_table(&STD_LUMA, 75)[0], 8); // 16 · 50 / 100
    }

    #[test]
    fn rounds_half_away_from_zero() {
        let mut c = [0.0; 64];
        c[0] = 8.0;
        c[1] = -16.5;
        let t = [16; 64];
        let q = quantize(&c, &t);
        assert_eq!((q[0], q[1]), (1, -1));
        assert_eq!(dequantize(&q, &t)[1], -16.0);
    }

    #[test]
    fn matches_the_published_quantized_block() {
        let shifted = crate::test_data::wiki_shifted();
        let q = quantize(&fdct(&shifted), &STD_LUMA);
        let expected: QBlock = [
            -26, -3, -6, 2, 2, -1, 0, 0, //
            0, -2, -4, 1, 1, 0, 0, 0, //
            -3, 1, 5, -1, -1, 0, 0, 0, //
            -3, 1, 2, -1, 0, 0, 0, 0, //
            1, 0, 0, 0, 0, 0, 0, 0, //
            0, 0, 0, 0, 0, 0, 0, 0, //
            0, 0, 0, 0, 0, 0, 0, 0, //
            0, 0, 0, 0, 0, 0, 0, 0, //
        ];
        assert_eq!(q, expected);
    }
}
