//! The zigzag scan: reorder 64 coefficients from low to high frequency so
//! the zeros quantization made gather at the end.

use crate::image::QBlock;

/// `ZIGZAG[k]` is the row-major index of the k-th coefficient in scan order.
pub const ZIGZAG: [u8; 64] = [
    0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, //
    12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, //
    35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, //
    58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63, //
];

/// `UNZIGZAG[i]` is the scan position of row-major index `i`.
pub const UNZIGZAG: [u8; 64] = invert(&ZIGZAG);

const fn invert(order: &[u8; 64]) -> [u8; 64] {
    let mut out = [0u8; 64];
    let mut k = 0;
    while k < 64 {
        out[order[k] as usize] = k as u8;
        k += 1;
    }
    out
}

/// Row-major → scan order.
pub fn to_zigzag(q: &QBlock) -> [i32; 64] {
    ZIGZAG.map(|i| q[i as usize])
}

/// Scan order → row-major.
pub fn from_zigzag(z: &[i32; 64]) -> QBlock {
    let mut out = [0; 64];
    for (k, &i) in ZIGZAG.iter().enumerate() {
        out[i as usize] = z[k];
    }
    out
}

/// Row-major → scan order for a `[u16; 64]`, e.g. a quantization table.
pub fn to_zigzag_u16(t: &[u16; 64]) -> [u16; 64] {
    ZIGZAG.map(|i| t[i as usize])
}

/// Scan order → row-major for `u16` values.
pub fn from_zigzag_u16(z: &[u16; 64]) -> [u16; 64] {
    let mut out = [0; 64];
    for (k, &i) in ZIGZAG.iter().enumerate() {
        out[i as usize] = z[k];
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_a_permutation_and_inverse_matches() {
        let mut seen = [false; 64];
        for (k, &i) in ZIGZAG.iter().enumerate() {
            assert!(!seen[i as usize]);
            seen[i as usize] = true;
            assert_eq!(UNZIGZAG[i as usize] as usize, k);
        }
    }

    #[test]
    fn walks_neighbouring_cells() {
        for k in 1..64 {
            let (a, b) = (ZIGZAG[k - 1] as i32, ZIGZAG[k] as i32);
            let (dx, dy) = ((a % 8 - b % 8).abs(), (a / 8 - b / 8).abs());
            assert!(dx <= 1 && dy <= 1, "step {k}");
        }
    }

    #[test]
    fn round_trips() {
        let q: QBlock = std::array::from_fn(|i| i as i32 * 3 - 50);
        assert_eq!(from_zigzag(&to_zigzag(&q)), q);
        let t: [u16; 64] = std::array::from_fn(|i| i as u16);
        assert_eq!(from_zigzag_u16(&to_zigzag_u16(&t)), t);
        assert_eq!(to_zigzag(&q)[2], q[8]); // third in scan = row 1, col 0
    }
}
