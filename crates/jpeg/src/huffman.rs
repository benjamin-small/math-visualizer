//! Huffman coding: frequent symbols get short codes. JPEG stores a table as
//! `bits` (how many codes of each length 1–16) plus `vals` (the symbols in
//! code order); the codes themselves follow canonically.

use crate::bits::{BitReader, BitWriter};
use crate::error::JpegError;

/// A Huffman table in DHT form.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct HuffSpec {
    /// `bits[i]` = number of codes of length `i + 1`.
    pub bits: [u8; 16],
    /// Symbols, shortest codes first.
    pub vals: Vec<u8>,
}

/// Encoder lookup: code and length per symbol (length 0 = no code).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HuffTable {
    /// The code bits, right-aligned in the low `len` bits.
    pub code: [u16; 256],
    /// Code length in bits.
    pub len: [u8; 256],
}

/// Decoder lookup (ITU T.81 F.2.2.3).
#[derive(Debug, Clone)]
pub struct HuffDecoder {
    mincode: [i32; 17],
    maxcode: [i32; 17],
    valptr: [usize; 17],
    vals: Vec<u8>,
}

/// Checks that `bits` and `vals` agree, every symbol appears once (else
/// `Corrupt("duplicate Huffman symbol")`), and the codes fit in 16 bits: it
/// refuses over-full tables (more codes of a length than the code space
/// leaves) and a table that fills the whole 16-bit code space, which would
/// use the reserved all-ones code.
fn validate(spec: &HuffSpec) -> Result<(), JpegError> {
    let total: usize = spec.bits.iter().map(|&b| b as usize).sum();
    crate::error::check_len(total, spec.vals.len())?;
    let mut seen = [false; 256];
    for &sym in &spec.vals {
        if std::mem::replace(&mut seen[sym as usize], true) {
            return Err(JpegError::Corrupt("duplicate Huffman symbol"));
        }
    }
    let mut code = 0u32;
    for (i, &n) in spec.bits.iter().enumerate() {
        code += n as u32;
        if code > 1 << (i + 1) || (i == 15 && code == 1 << 16) {
            return Err(JpegError::Corrupt("over-full Huffman table"));
        }
        code <<= 1;
    }
    Ok(())
}

/// Assigns canonical codes: within a length, consecutive integers; moving
/// to the next length, append a 0 bit.
pub fn canonical_codes(spec: &HuffSpec) -> Result<HuffTable, JpegError> {
    validate(spec)?;
    let mut t = HuffTable {
        code: [0; 256],
        len: [0; 256],
    };
    let mut code = 0u16;
    let mut k = 0;
    for len in 1..=16u8 {
        for _ in 0..spec.bits[len as usize - 1] {
            let sym = spec.vals[k] as usize;
            t.code[sym] = code;
            t.len[sym] = len;
            code += 1;
            k += 1;
        }
        code <<= 1;
    }
    Ok(t)
}

impl HuffDecoder {
    /// A decoder for `spec`, refusing the tables `canonical_codes` refuses.
    pub fn new(spec: &HuffSpec) -> Result<Self, JpegError> {
        validate(spec)?;
        let mut d = HuffDecoder {
            mincode: [0; 17],
            maxcode: [-1; 17],
            valptr: [0; 17],
            vals: spec.vals.clone(),
        };
        let (mut code, mut k) = (0i32, 0usize);
        for len in 1..=16 {
            let n = spec.bits[len - 1] as usize;
            if n > 0 {
                d.valptr[len] = k;
                d.mincode[len] = code;
                code += n as i32;
                k += n;
                d.maxcode[len] = code - 1;
            }
            code <<= 1;
        }
        Ok(d)
    }
}

/// Writes `sym`'s code; `BadHuffmanCode` if the table has none for it.
pub fn encode_symbol(w: &mut BitWriter, t: &HuffTable, sym: u8) -> Result<(), JpegError> {
    let len = t.len[sym as usize];
    if len == 0 {
        return Err(JpegError::BadHuffmanCode);
    }
    w.write(t.code[sym as usize] as u32, len);
    Ok(())
}

/// Reads one symbol bit by bit.
pub fn decode_symbol(r: &mut BitReader, d: &HuffDecoder) -> Result<u8, JpegError> {
    let mut code = 0i32;
    for len in 1..=16 {
        code = (code << 1) | r.read_bit()? as i32;
        if code <= d.maxcode[len] {
            return Ok(d.vals[d.valptr[len] + (code - d.mincode[len]) as usize]);
        }
    }
    Err(JpegError::BadHuffmanCode)
}

/// A histogram of byte symbols.
pub fn count_frequencies(symbols: impl IntoIterator<Item = u8>) -> [u32; 256] {
    let mut f = [0; 256];
    for s in symbols {
        f[s as usize] += 1;
    }
    f
}

/// The optimal table for a histogram, limited to 16-bit codes with no
/// all-ones code (ITU T.81 Annex K.2, as in libjpeg). Symbols with zero
/// frequency get no code; an all-zero histogram gives an empty table.
pub fn optimal_lengths(freq: &[u32; 256]) -> HuffSpec {
    if freq.iter().all(|&f| f == 0) {
        return HuffSpec::default();
    }
    let mut f: Vec<u64> = freq.iter().map(|&v| v as u64).collect();
    f.push(1); // symbol 256 reserves the all-ones code
    let mut codesize = [0usize; 257];
    let mut others = [-1i32; 257];
    loop {
        // Smallest non-zero frequency, ties to the larger symbol.
        let mut c1: i32 = -1;
        let mut v = u64::MAX;
        for (i, &fi) in f.iter().enumerate() {
            if fi != 0 && fi <= v {
                v = fi;
                c1 = i as i32;
            }
        }
        let mut c2: i32 = -1;
        let mut v = u64::MAX;
        for (i, &fi) in f.iter().enumerate() {
            if fi != 0 && fi <= v && i as i32 != c1 {
                v = fi;
                c2 = i as i32;
            }
        }
        if c2 < 0 {
            break;
        }
        let (mut a, mut b) = (c1 as usize, c2 as usize);
        f[a] += f[b];
        f[b] = 0;
        codesize[a] += 1;
        while others[a] >= 0 {
            a = others[a] as usize;
            codesize[a] += 1;
        }
        others[a] = c2;
        codesize[b] += 1;
        while others[b] >= 0 {
            b = others[b] as usize;
            codesize[b] += 1;
        }
    }
    let mut bits = [0u32; 33];
    for &cs in codesize.iter().filter(|&&cs| cs > 0) {
        bits[cs] += 1;
    }
    for i in (17..=32).rev() {
        while bits[i] > 0 {
            let mut j = i - 2;
            while bits[j] == 0 {
                j -= 1;
            }
            bits[i] -= 2;
            bits[i - 1] += 1;
            bits[j + 1] += 2;
            bits[j] -= 1;
        }
    }
    let mut i = 16;
    while bits[i] == 0 {
        i -= 1;
    }
    bits[i] -= 1; // drop the reserved symbol's code
    let mut spec = HuffSpec::default();
    for (slot, &n) in spec.bits.iter_mut().zip(&bits[1..=16]) {
        *slot = n as u8;
    }
    for len in 1..=32 {
        for (sym, &cs) in codesize.iter().enumerate().take(256) {
            if cs == len {
                spec.vals.push(sym as u8);
            }
        }
    }
    spec
}

/// One node of the code tree, for drawing: the root is depth 0, code 0.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TreeNode {
    /// Bits from the root (the root is 0).
    pub depth: u8,
    /// The `depth` bits leading here.
    pub code: u16,
    /// Present on leaves.
    pub symbol: Option<u8>,
}

/// Every node of the code tree (internal and leaf), sorted by depth then
/// code.
pub fn tree(spec: &HuffSpec) -> Result<Vec<TreeNode>, JpegError> {
    let table = canonical_codes(spec)?;
    let mut nodes = vec![TreeNode {
        depth: 0,
        code: 0,
        symbol: None,
    }];
    let mut internal = std::collections::BTreeSet::new();
    for &sym in &spec.vals {
        let (code, len) = (table.code[sym as usize], table.len[sym as usize]);
        nodes.push(TreeNode {
            depth: len,
            code,
            symbol: Some(sym),
        });
        for d in 1..len {
            internal.insert((d, code >> (len - d)));
        }
    }
    nodes.extend(internal.into_iter().map(|(depth, code)| TreeNode {
        depth,
        code,
        symbol: None,
    }));
    nodes.sort_by_key(|n| (n.depth, n.code));
    Ok(nodes)
}

fn spec(bits: [u8; 16], vals: &[u8]) -> HuffSpec {
    HuffSpec {
        bits,
        vals: vals.to_vec(),
    }
}

/// ITU T.81 Table K.3: luminance DC.
pub fn std_dc_luma() -> HuffSpec {
    spec(
        [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0],
        &[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    )
}

/// ITU T.81 Table K.4: chrominance DC.
pub fn std_dc_chroma() -> HuffSpec {
    spec(
        [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0],
        &[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    )
}

/// ITU T.81 Table K.5: luminance AC.
pub fn std_ac_luma() -> HuffSpec {
    spec(
        [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d],
        &[
            0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51,
            0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1,
            0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18,
            0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39,
            0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57,
            0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75,
            0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92,
            0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
            0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3,
            0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8,
            0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2,
            0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
        ],
    )
}

/// ITU T.81 Table K.6: chrominance AC.
pub fn std_ac_chroma() -> HuffSpec {
    spec(
        [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77],
        &[
            0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07,
            0x61, 0x71, 0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09,
            0x23, 0x33, 0x52, 0xf0, 0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25,
            0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38,
            0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56,
            0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74,
            0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
            0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5,
            0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba,
            0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6,
            0xd7, 0xd8, 0xd9, 0xda, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2,
            0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
        ],
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn code_of(t: &HuffTable, sym: u8) -> String {
        let (c, l) = (t.code[sym as usize], t.len[sym as usize]);
        format!("{:0width$b}", c, width = l as usize)
    }

    #[test]
    fn standard_luma_codes_match_the_published_tables() {
        let dc = canonical_codes(&std_dc_luma()).unwrap();
        assert_eq!(code_of(&dc, 0), "00");
        assert_eq!(code_of(&dc, 1), "010");
        assert_eq!(code_of(&dc, 5), "110");
        assert_eq!(code_of(&dc, 11), "111111110");
        let ac = canonical_codes(&std_ac_luma()).unwrap();
        assert_eq!(code_of(&ac, 0x01), "00");
        assert_eq!(code_of(&ac, 0x00), "1010"); // EOB
        assert_eq!(code_of(&ac, 0xF0), "11111111001"); // ZRL
        assert_eq!(code_of(&ac, 0xFA), "1111111111111110");
    }

    #[test]
    fn every_standard_table_is_valid_with_162_or_12_symbols() {
        for (s, n) in [
            (std_dc_luma(), 12),
            (std_dc_chroma(), 12),
            (std_ac_luma(), 162),
            (std_ac_chroma(), 162),
        ] {
            assert_eq!(s.vals.len(), n);
            assert!(canonical_codes(&s).is_ok());
        }
    }

    fn kraft(spec: &HuffSpec) -> f64 {
        spec.bits
            .iter()
            .enumerate()
            .map(|(i, &n)| n as f64 / 2f64.powi(i as i32 + 1))
            .sum()
    }

    #[test]
    fn optimal_codes_follow_frequency_and_stay_legal() {
        let mut f = [0u32; 256];
        f[0] = 1000;
        f[1] = 500;
        f[2] = 250;
        f[3] = 10;
        f[200] = 1;
        let spec = optimal_lengths(&f);
        let t = canonical_codes(&spec).unwrap();
        assert!(t.len[0] <= t.len[1] && t.len[1] <= t.len[2] && t.len[2] <= t.len[3]);
        assert!(kraft(&spec) < 1.0); // the all-ones code stays unused
        assert_eq!(spec.vals.len(), 5);
    }

    #[test]
    fn skewed_histograms_are_capped_at_16_bits() {
        let mut f = [0u32; 256];
        let mut v = 1u32;
        for item in f.iter_mut().take(30) {
            *item = v;
            v = v.saturating_mul(2);
        }
        let spec = optimal_lengths(&f);
        assert_eq!(spec.vals.len(), 30);
        assert!(kraft(&spec) < 1.0);
        assert!(canonical_codes(&spec).is_ok());
    }

    #[test]
    fn edge_case_histograms() {
        assert_eq!(optimal_lengths(&[0; 256]), HuffSpec::default());
        let mut f = [0u32; 256];
        f[7] = 3;
        let spec = optimal_lengths(&f);
        assert_eq!(spec.vals, vec![7]);
        assert_eq!(spec.bits[0], 1);
    }

    #[test]
    fn encode_then_decode_round_trips() {
        let spec = std_ac_chroma();
        let (t, d) = (
            canonical_codes(&spec).unwrap(),
            HuffDecoder::new(&spec).unwrap(),
        );
        let mut w = BitWriter::new();
        for &s in &spec.vals {
            encode_symbol(&mut w, &t, s).unwrap();
        }
        assert_eq!(
            encode_symbol(&mut w, &t, 0x0B),
            Err(JpegError::BadHuffmanCode)
        );
        let (bytes, _) = w.finish();
        let mut r = BitReader::new(&bytes);
        for &s in &spec.vals {
            assert_eq!(decode_symbol(&mut r, &d).unwrap(), s);
        }
    }

    #[test]
    fn rejects_inconsistent_tables() {
        let bad = spec([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], &[1, 2]);
        assert!(matches!(
            canonical_codes(&bad),
            Err(JpegError::BadLength { .. })
        ));
        let over = spec([3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], &[1, 2, 3]);
        assert!(matches!(canonical_codes(&over), Err(JpegError::Corrupt(_))));
    }

    #[test]
    fn rejects_a_table_that_uses_the_all_ones_code() {
        // One code at each length 1..=15 and two at length 16: together they
        // fill all 65536 sixteen-bit codes, including the reserved all-ones one.
        let full = HuffSpec {
            bits: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2],
            vals: (0..17).collect(),
        };
        assert!(matches!(canonical_codes(&full), Err(JpegError::Corrupt(_))));
        assert!(matches!(
            HuffDecoder::new(&full),
            Err(JpegError::Corrupt(_))
        ));
        assert!(matches!(tree(&full), Err(JpegError::Corrupt(_))));
    }

    #[test]
    fn rejects_duplicate_symbols() {
        let dup = spec([0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], &[5, 5]);
        let expected = Err(JpegError::Corrupt("duplicate Huffman symbol"));
        assert_eq!(canonical_codes(&dup).map(|_| ()), expected);
        assert_eq!(HuffDecoder::new(&dup).map(|_| ()), expected);
        assert_eq!(tree(&dup).map(|_| ()), expected);
    }

    #[test]
    fn tree_lists_root_internal_nodes_and_leaves() {
        let nodes = tree(&std_dc_luma()).unwrap();
        assert_eq!(
            nodes[0],
            TreeNode {
                depth: 0,
                code: 0,
                symbol: None
            }
        );
        let leaves = nodes.iter().filter(|n| n.symbol.is_some()).count();
        assert_eq!(leaves, 12);
        assert!(nodes.contains(&TreeNode {
            depth: 2,
            code: 0,
            symbol: Some(0)
        }));
        assert!(nodes.contains(&TreeNode {
            depth: 1,
            code: 0,
            symbol: None
        }));
    }
}
