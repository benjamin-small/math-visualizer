//! The file around the scan: marker segments (SOI, APP0, DQT, SOF0, DHT,
//! SOS, EOI) written and listed.

use crate::error::JpegError;
use crate::huffman::HuffSpec;
use crate::image::Table;
use crate::zigzag::to_zigzag_u16;

/// One frame component as SOF0 declares it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FrameComponent {
    pub id: u8,
    pub h: u8,
    pub v: u8,
    /// Quantization table id.
    pub tq: u8,
    /// DC and AC Huffman table ids used in the scan.
    pub td: u8,
    pub ta: u8,
}

/// Everything `write_segments` needs.
#[derive(Debug, Clone)]
pub struct Frame<'a> {
    pub width: u16,
    pub height: u16,
    pub components: Vec<FrameComponent>,
    /// `(id, table)`, tables row-major (written in zigzag order).
    pub qtables: Vec<(u8, Table)>,
    /// `(class, id, spec)`: class 0 = DC, 1 = AC.
    pub htables: Vec<(u8, u8, &'a HuffSpec)>,
    /// Stuffed entropy-coded scan bytes.
    pub scan: &'a [u8],
}

/// What a segment is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SegmentKind {
    Soi,
    App0,
    AppN,
    Dqt,
    Sof0,
    /// Any other start-of-frame (progressive, arithmetic, lossless, …).
    SofOther,
    Dht,
    Dri,
    Sos,
    Com,
    Eoi,
    Other,
}

/// A segment's place in the file. `header_len` covers the marker and the
/// declared segment; `len` adds the scan data for SOS.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Segment {
    pub marker: u8,
    pub kind: SegmentKind,
    pub offset: usize,
    pub header_len: usize,
    pub len: usize,
}

impl Segment {
    /// The segment's contents after its length field.
    pub fn payload<'a>(&self, bytes: &'a [u8]) -> &'a [u8] {
        if self.header_len <= 4 {
            return &[];
        }
        &bytes[self.offset + 4..self.offset + self.header_len]
    }

    /// The entropy-coded bytes following an SOS header (empty otherwise).
    pub fn scan<'a>(&self, bytes: &'a [u8]) -> &'a [u8] {
        &bytes[self.offset + self.header_len..self.offset + self.len]
    }
}

fn kind_of(marker: u8) -> SegmentKind {
    match marker {
        0xD8 => SegmentKind::Soi,
        0xD9 => SegmentKind::Eoi,
        0xE0 => SegmentKind::App0,
        0xE1..=0xEF => SegmentKind::AppN,
        0xDB => SegmentKind::Dqt,
        0xC0 => SegmentKind::Sof0,
        0xC4 => SegmentKind::Dht,
        0xC1..=0xCF if marker != 0xC8 && marker != 0xCC => SegmentKind::SofOther,
        0xDD => SegmentKind::Dri,
        0xDA => SegmentKind::Sos,
        0xFE => SegmentKind::Com,
        _ => SegmentKind::Other,
    }
}

fn push_segment(out: &mut Vec<u8>, marker: u8, body: &[u8]) {
    out.extend([0xFF, marker]);
    out.extend(((body.len() + 2) as u16).to_be_bytes());
    out.extend_from_slice(body);
}

/// A complete baseline JFIF file.
pub fn write_segments(f: &Frame) -> Vec<u8> {
    let mut out = vec![0xFF, 0xD8];
    // APP0: "JFIF\0", version 1.01, no units, 1:1 density, no thumbnail.
    push_segment(
        &mut out,
        0xE0,
        &[b'J', b'F', b'I', b'F', 0, 1, 1, 0, 0, 1, 0, 1, 0, 0],
    );
    let mut dqt = Vec::new();
    for (id, t) in &f.qtables {
        dqt.push(*id); // 8-bit precision
        dqt.extend(to_zigzag_u16(t).iter().map(|&v| v as u8));
    }
    push_segment(&mut out, 0xDB, &dqt);
    let mut sof = vec![8];
    sof.extend(f.height.to_be_bytes());
    sof.extend(f.width.to_be_bytes());
    sof.push(f.components.len() as u8);
    for c in &f.components {
        sof.extend([c.id, (c.h << 4) | c.v, c.tq]);
    }
    push_segment(&mut out, 0xC0, &sof);
    let mut dht = Vec::new();
    for (class, id, spec) in &f.htables {
        dht.push((class << 4) | id);
        dht.extend_from_slice(&spec.bits);
        dht.extend_from_slice(&spec.vals);
    }
    push_segment(&mut out, 0xC4, &dht);
    let mut sos = vec![f.components.len() as u8];
    for c in &f.components {
        sos.extend([c.id, (c.td << 4) | c.ta]);
    }
    sos.extend([0, 63, 0]);
    push_segment(&mut out, 0xDA, &sos);
    out.extend_from_slice(f.scan);
    out.extend([0xFF, 0xD9]);
    out
}

/// Lists a file's segments up to and including EOI.
pub fn parse_segments(bytes: &[u8]) -> Result<Vec<Segment>, JpegError> {
    if bytes.len() < 2 || bytes[0] != 0xFF || bytes[1] != 0xD8 {
        return Err(JpegError::BadMarker(*bytes.get(1).unwrap_or(&0)));
    }
    let mut segs = vec![Segment {
        marker: 0xD8,
        kind: SegmentKind::Soi,
        offset: 0,
        header_len: 2,
        len: 2,
    }];
    let mut pos = 2;
    loop {
        if *bytes.get(pos).ok_or(JpegError::Truncated)? != 0xFF {
            return Err(JpegError::BadMarker(bytes[pos]));
        }
        let mut m = pos + 1;
        while *bytes.get(m).ok_or(JpegError::Truncated)? == 0xFF {
            m += 1; // fill bytes
        }
        let marker = bytes[m];
        let offset = m - 1;
        if marker == 0xD9 {
            segs.push(Segment {
                marker,
                kind: SegmentKind::Eoi,
                offset,
                header_len: 2,
                len: 2,
            });
            return Ok(segs);
        }
        let hi = *bytes.get(m + 1).ok_or(JpegError::Truncated)? as usize;
        let lo = *bytes.get(m + 2).ok_or(JpegError::Truncated)? as usize;
        let header_len = 2 + ((hi << 8) | lo);
        if offset + header_len > bytes.len() || header_len < 4 {
            return Err(JpegError::Truncated);
        }
        let mut len = header_len;
        if marker == 0xDA {
            // Scan data runs to the next marker that is not stuffing or RSTn.
            let mut p = offset + header_len;
            loop {
                let b = *bytes.get(p).ok_or(JpegError::Truncated)?;
                if b == 0xFF {
                    let n = *bytes.get(p + 1).ok_or(JpegError::Truncated)?;
                    if n != 0x00 && !(0xD0..=0xD7).contains(&n) {
                        break;
                    }
                    p += 2;
                } else {
                    p += 1;
                }
            }
            len = p - offset;
        }
        segs.push(Segment {
            marker,
            kind: kind_of(marker),
            offset,
            header_len,
            len,
        });
        pos = offset + len;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::huffman::std_dc_luma;

    fn tiny() -> Vec<u8> {
        let dc = std_dc_luma();
        write_segments(&Frame {
            width: 8,
            height: 8,
            components: vec![FrameComponent {
                id: 1,
                h: 1,
                v: 1,
                tq: 0,
                td: 0,
                ta: 0,
            }],
            qtables: vec![(0, [1; 64])],
            htables: vec![(0, 0, &dc), (1, 0, &dc)],
            scan: &[0x12, 0xFF, 0x00, 0x34],
        })
    }

    #[test]
    fn writes_segments_in_baseline_order() {
        let bytes = tiny();
        let kinds: Vec<SegmentKind> = parse_segments(&bytes)
            .unwrap()
            .iter()
            .map(|s| s.kind)
            .collect();
        use SegmentKind::*;
        assert_eq!(kinds, vec![Soi, App0, Dqt, Sof0, Dht, Sos, Eoi]);
        assert_eq!(&bytes[6..11], b"JFIF\0");
    }

    #[test]
    fn sos_segment_owns_its_scan_data() {
        let bytes = tiny();
        let segs = parse_segments(&bytes).unwrap();
        let sos = segs.iter().find(|s| s.kind == SegmentKind::Sos).unwrap();
        assert_eq!(sos.scan(&bytes), &[0x12, 0xFF, 0x00, 0x34]);
        assert_eq!(sos.payload(&bytes), &[1, 1, 0, 0, 63, 0]);
        let sof = segs.iter().find(|s| s.kind == SegmentKind::Sof0).unwrap();
        assert_eq!(sof.payload(&bytes), &[8, 0, 8, 0, 8, 1, 1, 0x11, 0]);
    }

    #[test]
    fn rejects_missing_soi_and_truncation() {
        assert_eq!(parse_segments(&[0x00, 0x00]), Err(JpegError::BadMarker(0)));
        let bytes = tiny();
        assert_eq!(
            parse_segments(&bytes[..bytes.len() - 2]),
            Err(JpegError::Truncated)
        );
        assert_eq!(parse_segments(&bytes[..10]), Err(JpegError::Truncated));
    }

    #[test]
    fn marks_progressive_frames() {
        assert_eq!(kind_of(0xC2), SegmentKind::SofOther);
        assert_eq!(kind_of(0xC4), SegmentKind::Dht);
        assert_eq!(kind_of(0xC8), SegmentKind::Other);
    }
}
