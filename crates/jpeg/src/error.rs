//! The one error type every fallible function in the crate returns.

use std::fmt;

/// Why a JPEG operation refused its input.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum JpegError {
    /// A slice had the wrong number of elements.
    BadLength {
        /// How many elements were required.
        expected: usize,
        /// How many were given.
        got: usize,
    },
    /// Width/height are zero, too large, or disagree between inputs.
    BadDimensions,
    /// The byte stream ended early.
    Truncated,
    /// A marker byte was missing or unexpected where it appeared.
    BadMarker(u8),
    /// A bit pattern matched no code in the active Huffman table, or a
    /// symbol has no code.
    BadHuffmanCode,
    /// Structurally valid input whose contents make no sense (a run past
    /// coefficient 63, an over-full Huffman table).
    Corrupt(&'static str),
    /// A valid JPEG feature this crate does not implement.
    Unsupported(&'static str),
}

impl fmt::Display for JpegError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::BadLength { expected, got } => {
                write!(f, "expected {expected} values, got {got}")
            }
            Self::BadDimensions => write!(f, "bad image dimensions"),
            Self::Truncated => write!(f, "data ended early"),
            Self::BadMarker(m) => write!(f, "unexpected marker 0x{m:02X}"),
            Self::BadHuffmanCode => write!(f, "invalid Huffman code"),
            Self::Corrupt(what) => write!(f, "corrupt data: {what}"),
            Self::Unsupported(what) => write!(f, "unsupported JPEG feature: {what}"),
        }
    }
}

impl std::error::Error for JpegError {}

/// `Err(BadLength)` unless `got == expected`.
pub fn check_len(expected: usize, got: usize) -> Result<(), JpegError> {
    if expected == got {
        Ok(())
    } else {
        Err(JpegError::BadLength { expected, got })
    }
}
