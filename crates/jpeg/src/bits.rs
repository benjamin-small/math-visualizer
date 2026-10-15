//! Bit-level I/O for the entropy-coded scan, with JPEG's byte stuffing
//! (every 0xFF data byte is followed by 0x00 so it can't look like a marker).

use crate::error::JpegError;

/// A run of payload bits (stuffing excluded) inside the scan.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct BitSpan {
    pub start_bit: u64,
    pub len: u64,
}

/// MSB-first bit writer.
#[derive(Debug, Default, Clone)]
pub struct BitWriter {
    stuffed: Vec<u8>,
    payload: Vec<u8>,
    acc: u32,
    nbits: u32,
    total: u64,
}

impl BitWriter {
    pub fn new() -> Self {
        Self::default()
    }

    /// Appends the low `n` (≤ 16) bits of `bits`, most significant first.
    pub fn write(&mut self, bits: u32, n: u8) {
        debug_assert!(n <= 16);
        for i in (0..n).rev() {
            self.acc = (self.acc << 1) | ((bits >> i) & 1);
            self.nbits += 1;
            self.total += 1;
            if self.nbits == 8 {
                self.emit();
            }
        }
    }

    fn emit(&mut self) {
        let byte = self.acc as u8;
        self.payload.push(byte);
        self.stuffed.push(byte);
        if byte == 0xFF {
            self.stuffed.push(0x00);
        }
        self.acc = 0;
        self.nbits = 0;
    }

    /// Payload bits written so far.
    pub fn mark(&self) -> u64 {
        self.total
    }

    /// The bits written since `mark`.
    pub fn span_since(&self, mark: u64) -> BitSpan {
        BitSpan {
            start_bit: mark,
            len: self.total - mark,
        }
    }

    /// Pads the last byte with 1s (as the standard asks) and returns
    /// `(stuffed scan bytes, unstuffed payload bytes)`.
    pub fn finish(mut self) -> (Vec<u8>, Vec<u8>) {
        while self.nbits != 0 {
            self.acc = (self.acc << 1) | 1;
            self.nbits += 1;
            if self.nbits == 8 {
                self.emit();
            }
        }
        (self.stuffed, self.payload)
    }
}

/// The bits of `span` as a string of '0'/'1', read from unstuffed payload.
pub fn bit_string(payload: &[u8], span: BitSpan) -> String {
    (span.start_bit..span.start_bit + span.len)
        .map(|b| {
            let byte = payload.get((b / 8) as usize).copied().unwrap_or(0);
            if (byte >> (7 - b % 8)) & 1 == 1 {
                '1'
            } else {
                '0'
            }
        })
        .collect()
}

/// MSB-first bit reader over stuffed scan data. It stops at the first
/// marker: reading past it is `Truncated`.
#[derive(Debug, Clone)]
pub struct BitReader<'a> {
    data: &'a [u8],
    pos: usize,
    acc: u32,
    nbits: u32,
}

impl<'a> BitReader<'a> {
    pub fn new(data: &'a [u8]) -> Self {
        Self {
            data,
            pos: 0,
            acc: 0,
            nbits: 0,
        }
    }

    /// One bit.
    pub fn read_bit(&mut self) -> Result<u32, JpegError> {
        if self.nbits == 0 {
            let byte = *self.data.get(self.pos).ok_or(JpegError::Truncated)?;
            if byte == 0xFF {
                match self.data.get(self.pos + 1) {
                    Some(0x00) => self.pos += 2,
                    _ => return Err(JpegError::Truncated),
                }
            } else {
                self.pos += 1;
            }
            self.acc = byte as u32;
            self.nbits = 8;
        }
        self.nbits -= 1;
        Ok((self.acc >> self.nbits) & 1)
    }

    /// `n` (≤ 16) bits as an unsigned number.
    pub fn read_bits(&mut self, n: u8) -> Result<u32, JpegError> {
        let mut v = 0;
        for _ in 0..n {
            v = (v << 1) | self.read_bit()?;
        }
        Ok(v)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_msb_first_and_pads_with_ones() {
        let mut w = BitWriter::new();
        w.write(0b101, 3);
        let (bytes, payload) = w.finish();
        assert_eq!(bytes, vec![0b1011_1111]);
        assert_eq!(payload, bytes);
    }

    #[test]
    fn stuffs_ff_and_reader_unstuffs() {
        let mut w = BitWriter::new();
        w.write(0xFF, 8);
        w.write(0x12, 8);
        let (bytes, payload) = w.finish();
        assert_eq!(bytes, vec![0xFF, 0x00, 0x12]);
        assert_eq!(payload, vec![0xFF, 0x12]);
        let mut r = BitReader::new(&bytes);
        assert_eq!(r.read_bits(8).unwrap(), 0xFF);
        assert_eq!(r.read_bits(8).unwrap(), 0x12);
        assert_eq!(r.read_bit(), Err(JpegError::Truncated));
    }

    #[test]
    fn stops_at_a_marker() {
        let mut r = BitReader::new(&[0xFF, 0xD9]);
        assert_eq!(r.read_bit(), Err(JpegError::Truncated));
    }

    #[test]
    fn spans_and_bit_strings() {
        let mut w = BitWriter::new();
        w.write(0b11, 2);
        let m = w.mark();
        w.write(0b0110, 4);
        let span = w.span_since(m);
        assert_eq!(
            span,
            BitSpan {
                start_bit: 2,
                len: 4
            }
        );
        let (_, payload) = w.finish();
        assert_eq!(bit_string(&payload, span), "0110");
    }

    #[test]
    fn random_round_trip() {
        let mut w = BitWriter::new();
        let mut x = 12345u32;
        let mut written = Vec::new();
        for _ in 0..500 {
            x = x.wrapping_mul(1_103_515_245).wrapping_add(12_345);
            let n = (x % 16 + 1) as u8;
            let v = (x >> 8) & ((1 << n) - 1);
            w.write(v, n);
            written.push((v, n));
        }
        let (bytes, _) = w.finish();
        let mut r = BitReader::new(&bytes);
        for (v, n) in written {
            assert_eq!(r.read_bits(n).unwrap(), v);
        }
    }
}
