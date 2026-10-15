//! The 2D DCT-II: every 8×8 block is a weighted sum of 64 cosine patterns.
//! Plus the 1D transforms behind the "why cosines?" comparison.

use std::f64::consts::PI;
use std::sync::OnceLock;

use crate::image::Block;
use crate::zigzag::ZIGZAG;

/// `t[u][x] = ½·C(u)·cos((2x + 1)uπ / 16)`, `C(0) = 1/√2`, else 1. Rows are
/// orthonormal, so the same table runs the transform both ways.
pub fn cos_table() -> &'static [[f32; 8]; 8] {
    static TABLE: OnceLock<[[f32; 8]; 8]> = OnceLock::new();
    TABLE.get_or_init(|| {
        let mut t = [[0.0; 8]; 8];
        for (u, row) in t.iter_mut().enumerate() {
            let cu = if u == 0 { 1.0 / 2f64.sqrt() } else { 1.0 };
            for (x, v) in row.iter_mut().enumerate() {
                *v = (0.5 * cu * ((2 * x + 1) as f64 * u as f64 * PI / 16.0).cos()) as f32;
            }
        }
        t
    })
}

/// Forward DCT: `F(u, v) = ¼·C(u)·C(v)·Σx Σy f(x, y)·cos(…u…)·cos(…v…)`.
pub fn fdct(b: &Block) -> Block {
    let t = cos_table();
    let mut rows = [0.0f32; 64]; // rows[u + 8y] = Σx t[u][x]·f(x, y)
    for y in 0..8 {
        for u in 0..8 {
            rows[u + 8 * y] = (0..8).map(|x| t[u][x] * b[x + 8 * y]).sum();
        }
    }
    let mut out = [0.0f32; 64];
    for v in 0..8 {
        for u in 0..8 {
            out[u + 8 * v] = (0..8).map(|y| t[v][y] * rows[u + 8 * y]).sum();
        }
    }
    out
}

/// Inverse DCT: `f(x, y) = Σu Σv t[u][x]·t[v][y]·F(u, v)`.
pub fn idct(c: &Block) -> Block {
    let t = cos_table();
    let mut cols = [0.0f32; 64]; // cols[u + 8y] = Σv t[v][y]·F(u, v)
    for y in 0..8 {
        for u in 0..8 {
            cols[u + 8 * y] = (0..8).map(|v| t[v][y] * c[u + 8 * v]).sum();
        }
    }
    let mut out = [0.0f32; 64];
    for y in 0..8 {
        for x in 0..8 {
            out[x + 8 * y] = (0..8).map(|u| t[u][x] * cols[u + 8 * y]).sum();
        }
    }
    out
}

/// The pattern coefficient `(u, v)` contributes per unit of weight: the
/// inverse DCT of a block with a single 1 at `(u, v)`.
pub fn basis(u: usize, v: usize) -> Block {
    let t = cos_table();
    let mut out = [0.0; 64];
    for y in 0..8 {
        for x in 0..8 {
            out[x + 8 * y] = t[u][x] * t[v][y];
        }
    }
    out
}

/// The block rebuilt from only its first `k` coefficients in zigzag order
/// (`k = 0` → all zeros, `k ≥ 64` → the full inverse).
pub fn idct_partial(c: &Block, k: usize) -> Block {
    let mut kept = [0.0; 64];
    for &i in ZIGZAG.iter().take(k) {
        kept[i as usize] = c[i as usize];
    }
    idct(&kept)
}

/// Sum of squares — preserved by the (orthonormal) DCT.
pub fn energy(b: &[f32]) -> f32 {
    b.iter().map(|v| v * v).sum()
}

/// Orthonormal 1D DCT-II of any length.
pub fn dct_1d(x: &[f32]) -> Vec<f32> {
    let n = x.len() as f64;
    (0..x.len())
        .map(|k| {
            let ck = if k == 0 {
                (1.0 / n).sqrt()
            } else {
                (2.0 / n).sqrt()
            };
            let s: f64 = x
                .iter()
                .enumerate()
                .map(|(i, &v)| v as f64 * (PI * (2 * i + 1) as f64 * k as f64 / (2.0 * n)).cos())
                .sum();
            (ck * s) as f32
        })
        .collect()
}

/// Inverse of `dct_1d`.
pub fn idct_1d(c: &[f32]) -> Vec<f32> {
    let n = c.len() as f64;
    (0..c.len())
        .map(|i| {
            let s: f64 = c
                .iter()
                .enumerate()
                .map(|(k, &v)| {
                    let ck = if k == 0 {
                        (1.0 / n).sqrt()
                    } else {
                        (2.0 / n).sqrt()
                    };
                    ck * v as f64 * (PI * (2 * i + 1) as f64 * k as f64 / (2.0 * n)).cos()
                })
                .sum();
            s as f32
        })
        .collect()
}

/// Unitary 1D DFT (`1/√N` scaling, so energy matches `dct_1d`'s), as
/// `[re, im]` pairs.
pub fn dft_1d(x: &[f32]) -> Vec<[f32; 2]> {
    let n = x.len() as f64;
    (0..x.len())
        .map(|k| {
            let (mut re, mut im) = (0.0f64, 0.0f64);
            for (i, &v) in x.iter().enumerate() {
                let a = -2.0 * PI * k as f64 * i as f64 / n;
                re += v as f64 * a.cos();
                im += v as f64 * a.sin();
            }
            [(re / n.sqrt()) as f32, (im / n.sqrt()) as f32]
        })
        .collect()
}

/// `x` repeated `reps` times — what the DFT silently assumes.
pub fn extend_periodic(x: &[f32], reps: usize) -> Vec<f32> {
    x.iter().copied().cycle().take(x.len() * reps).collect()
}

/// `x`, reversed `x`, `x`, … `reps` times — what the DCT assumes.
pub fn extend_mirrored(x: &[f32], reps: usize) -> Vec<f32> {
    let mut out = Vec::with_capacity(x.len() * reps);
    for r in 0..reps {
        if r % 2 == 0 {
            out.extend_from_slice(x);
        } else {
            out.extend(x.iter().rev());
        }
    }
    out
}

/// How many of the largest terms (by energy) it takes to reach `frac` of
/// the total energy. `energies` are per-term energies (squared magnitudes).
pub fn terms_for_energy(energies: &[f32], frac: f32) -> usize {
    let total: f32 = energies.iter().sum();
    if total <= 0.0 {
        return 0;
    }
    let mut sorted = energies.to_vec();
    sorted.sort_by(|a, b| b.total_cmp(a));
    let mut acc = 0.0;
    for (i, e) in sorted.iter().enumerate() {
        acc += e;
        if acc >= frac * total {
            return i + 1;
        }
    }
    sorted.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shifted() -> Block {
        crate::test_data::wiki_shifted()
    }

    #[test]
    fn matches_the_published_coefficients() {
        let f = fdct(&shifted());
        // Wikipedia's G matrix: row = v (vertical frequency), column = u.
        let expected_row0 = [-415.38, -30.19, -61.20, 27.24, 56.12, -20.10, -2.39, 0.46];
        let expected_col0 = [-415.38, 4.47, -46.83, -48.53, 12.12, -7.73, -1.03, -0.17];
        for u in 0..8 {
            assert!((f[u] - expected_row0[u]).abs() < 0.01, "u={u}: {}", f[u]);
        }
        for v in 0..8 {
            assert!(
                (f[8 * v] - expected_col0[v]).abs() < 0.01,
                "v={v}: {}",
                f[8 * v]
            );
        }
    }

    #[test]
    fn idct_inverts_fdct() {
        let b = shifted();
        let back = idct(&fdct(&b));
        for i in 0..64 {
            assert!((back[i] - b[i]).abs() < 1e-3);
        }
    }

    #[test]
    fn energy_is_preserved() {
        let b = shifted();
        assert!((energy(&fdct(&b)) / energy(&b) - 1.0).abs() < 1e-5);
    }

    #[test]
    fn basis_patterns_are_orthonormal() {
        for a in 0..64 {
            for b in 0..64 {
                let (pa, pb) = (basis(a % 8, a / 8), basis(b % 8, b / 8));
                let dot: f32 = pa.iter().zip(pb.iter()).map(|(x, y)| x * y).sum();
                let want = if a == b { 1.0 } else { 0.0 };
                assert!((dot - want).abs() < 1e-5, "{a},{b}: {dot}");
            }
        }
    }

    #[test]
    fn dc_basis_is_flat() {
        assert!(basis(0, 0).iter().all(|&v| (v - 0.125).abs() < 1e-6));
    }

    #[test]
    fn partial_rebuild_runs_from_nothing_to_everything() {
        let c = fdct(&shifted());
        assert!(idct_partial(&c, 0).iter().all(|&v| v == 0.0));
        let full = idct(&c);
        let all = idct_partial(&c, 64);
        for i in 0..64 {
            assert!((full[i] - all[i]).abs() < 1e-4);
        }
        // DC alone is the block mean.
        let mean = shifted().iter().sum::<f32>() / 64.0;
        assert!((idct_partial(&c, 1)[0] - mean).abs() < 1e-3);
    }

    #[test]
    fn one_dimensional_transforms_round_trip_and_keep_energy() {
        let x = [3.0, 1.0, 4.0, 1.0, 5.0, 9.0, 2.0, 6.0];
        let back = idct_1d(&dct_1d(&x));
        for i in 0..8 {
            assert!((back[i] - x[i]).abs() < 1e-4);
        }
        let e: f32 = dft_1d(&x).iter().map(|[r, i]| r * r + i * i).sum();
        assert!((e / energy(&x) - 1.0).abs() < 1e-5);
    }

    #[test]
    fn a_ramp_needs_fewer_cosine_terms_than_fourier_terms() {
        let ramp: Vec<f32> = (0..8).map(|i| i as f32 * 10.0).collect();
        let dct_e: Vec<f32> = dct_1d(&ramp).iter().map(|c| c * c).collect();
        let dft_e: Vec<f32> = dft_1d(&ramp).iter().map(|[r, i]| r * r + i * i).collect();
        assert!(terms_for_energy(&dct_e, 0.99) < terms_for_energy(&dft_e, 0.99));
    }

    #[test]
    fn extensions_repeat_or_mirror() {
        assert_eq!(extend_periodic(&[1.0, 2.0], 2), vec![1.0, 2.0, 1.0, 2.0]);
        assert_eq!(
            extend_mirrored(&[1.0, 2.0], 3),
            vec![1.0, 2.0, 2.0, 1.0, 1.0, 2.0]
        );
        assert_eq!(terms_for_energy(&[0.0, 0.0], 0.95), 0);
    }
}
