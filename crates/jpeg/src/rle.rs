//! Run-length coding: DC as a difference from the previous block, AC as
//! (zero-run, size) symbols each followed by `size` amplitude bits.

use crate::error::JpegError;

/// Bits needed for `|v|`: 0 for 0, 1 for ±1, 2 for ±2..3, … 11 for ±1024..2047.
pub fn size_category(v: i32) -> u8 {
    (32 - v.unsigned_abs().leading_zeros()) as u8
}

/// The `size` low bits that encode `v`: `v` itself when positive,
/// `v − 1` (one's complement) when negative. Returns `(bits, size)`.
/// Precondition: `|v| ≤ 32767` (size ≤ 15), so the bits fit a `u16`.
pub fn amplitude_bits(v: i32) -> (u16, u8) {
    let size = size_category(v);
    let bits = if v >= 0 { v } else { v + (1 << size) - 1 };
    (bits as u16, size)
}

/// Inverse of `amplitude_bits`. `size` must be at most 15 (so `|v| ≤ 32767`).
pub fn from_amplitude_bits(bits: u16, size: u8) -> i32 {
    if size == 0 {
        return 0;
    }
    let bits = bits as i32;
    if bits < 1 << (size - 1) {
        bits - (1 << size) + 1
    } else {
        bits
    }
}

/// What the DC coefficient is stored as: its change from the previous
/// block's DC in the same component.
pub fn dc_diff(prev: i32, dc: i32) -> i32 {
    dc - prev
}

/// Inverse of `dc_diff`.
pub fn dc_undiff(prev: i32, diff: i32) -> i32 {
    prev + diff
}

/// One AC token: `run` zeros, then a non-zero coefficient `amp` needing
/// `size` bits. `ZRL` (16 zeros) and `EOB` (all remaining are zero) have
/// `size` 0.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AcToken {
    /// Zeros before the coefficient (0–15).
    pub run: u8,
    /// Bits needed for `amp` (0 for ZRL and EOB).
    pub size: u8,
    /// The coefficient value (0 for ZRL and EOB).
    pub amp: i32,
}

/// Sixteen zeros in a row.
pub const ZRL: AcToken = AcToken {
    run: 15,
    size: 0,
    amp: 0,
};
/// End of block: every remaining coefficient is zero.
pub const EOB: AcToken = AcToken {
    run: 0,
    size: 0,
    amp: 0,
};

impl AcToken {
    /// The byte the Huffman coder sees: `run << 4 | size`.
    pub fn symbol(&self) -> u8 {
        (self.run << 4) | self.size
    }
}

/// Tokens for coefficients 1..64 of a zigzag-ordered block.
pub fn ac_symbols(z: &[i32; 64]) -> Vec<AcToken> {
    let mut out = Vec::new();
    let mut run = 0u8;
    for &v in &z[1..] {
        if v == 0 {
            run += 1;
            continue;
        }
        while run > 15 {
            out.push(ZRL);
            run -= 16;
        }
        out.push(AcToken {
            run,
            size: size_category(v),
            amp: v,
        });
        run = 0;
    }
    if run > 0 {
        out.push(EOB);
    }
    out
}

/// Rebuilds a zigzag-ordered block from its DC value and AC tokens.
pub fn ac_expand(dc: i32, tokens: &[AcToken]) -> Result<[i32; 64], JpegError> {
    let mut z = [0; 64];
    z[0] = dc;
    let mut k = 1usize;
    for t in tokens {
        if *t == EOB {
            return Ok(z);
        }
        if *t == ZRL {
            k += 16;
            if k > 64 {
                return Err(JpegError::Corrupt("zero run past coefficient 63"));
            }
            continue;
        }
        k += t.run as usize;
        if k > 63 {
            return Err(JpegError::Corrupt("zero run past coefficient 63"));
        }
        z[k] = t.amp;
        k += 1;
    }
    Ok(z)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn size_categories() {
        assert_eq!(size_category(0), 0);
        assert_eq!(size_category(1), 1);
        assert_eq!(size_category(-1), 1);
        assert_eq!(size_category(-3), 2);
        assert_eq!(size_category(4), 3);
        assert_eq!(size_category(-2047), 11);
    }

    #[test]
    fn amplitude_bits_round_trip() {
        assert_eq!(amplitude_bits(5), (0b101, 3));
        assert_eq!(amplitude_bits(-5), (0b010, 3));
        assert_eq!(amplitude_bits(-1), (0, 1));
        for v in -2047..=2047 {
            let (b, s) = amplitude_bits(v);
            assert_eq!(from_amplitude_bits(b, s), v);
        }
    }

    #[test]
    fn dc_difference_round_trips() {
        assert_eq!(dc_diff(-26, -30), -4);
        assert_eq!(dc_undiff(-26, -4), -30);
    }

    #[test]
    fn tokens_for_the_published_block() {
        // Zigzag of Wikipedia's quantized block: −26 −3 0 −3 −2 −6 2 −4 1 −3
        // 1 1 5 1 2 −1 1 −1 2 0 0 0 0 0 −1 −1 then zeros.
        let mut z = [0; 64];
        let head = [
            -26, -3, 0, -3, -2, -6, 2, -4, 1, -3, 1, 1, 5, 1, 2, -1, 1, -1, 2, 0, 0, 0, 0, 0, -1,
            -1,
        ];
        z[..head.len()].copy_from_slice(&head);
        let t = ac_symbols(&z);
        assert_eq!(
            t[0],
            AcToken {
                run: 0,
                size: 2,
                amp: -3
            }
        );
        assert_eq!(
            t[1],
            AcToken {
                run: 1,
                size: 2,
                amp: -3
            }
        );
        assert_eq!(
            t[t.len() - 2],
            AcToken {
                run: 0,
                size: 1,
                amp: -1
            }
        );
        assert_eq!(
            t[t.len() - 3],
            AcToken {
                run: 5,
                size: 1,
                amp: -1
            }
        );
        assert_eq!(*t.last().unwrap(), EOB);
        assert_eq!(ac_expand(-26, &t).unwrap(), z);
    }

    #[test]
    fn long_runs_use_zrl_and_a_full_block_has_no_eob() {
        let mut z = [0; 64];
        z[40] = 7;
        let t = ac_symbols(&z);
        assert_eq!(
            t,
            vec![
                ZRL,
                ZRL,
                AcToken {
                    run: 7,
                    size: 3,
                    amp: 7
                },
                EOB
            ]
        );
        assert_eq!(ac_expand(0, &t).unwrap(), z);
        let full: [i32; 64] = [1; 64];
        let t = ac_symbols(&full);
        assert_eq!(t.len(), 63);
        assert_ne!(*t.last().unwrap(), EOB);
        assert_eq!(ac_expand(1, &t).unwrap(), full);
        assert_eq!(ac_symbols(&[0; 64]), vec![EOB]);
    }

    #[test]
    fn expanding_past_63_is_corrupt() {
        let t = [
            ZRL,
            ZRL,
            ZRL,
            ZRL,
            AcToken {
                run: 0,
                size: 1,
                amp: 1,
            },
        ];
        assert!(matches!(ac_expand(0, &t), Err(JpegError::Corrupt(_))));
    }

    #[test]
    fn symbols_pack_run_and_size() {
        assert_eq!(ZRL.symbol(), 0xF0);
        assert_eq!(EOB.symbol(), 0x00);
        assert_eq!(
            AcToken {
                run: 2,
                size: 3,
                amp: 5
            }
            .symbol(),
            0x23
        );
    }
}
