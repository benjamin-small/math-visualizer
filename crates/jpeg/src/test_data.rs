//! Shared fixtures for the unit tests.

/// The 8×8 example block from Wikipedia's "JPEG" article (rows are y,
/// columns x), before the −128 level shift.
pub const WIKI_BLOCK: [f32; 64] = [
    52., 55., 61., 66., 70., 61., 64., 73., //
    63., 59., 55., 90., 109., 85., 69., 72., //
    62., 59., 68., 113., 144., 104., 66., 73., //
    63., 58., 71., 122., 154., 106., 70., 69., //
    67., 61., 68., 104., 126., 88., 68., 70., //
    79., 65., 60., 70., 77., 68., 58., 75., //
    85., 71., 64., 59., 55., 61., 65., 83., //
    87., 79., 69., 68., 65., 76., 78., 94., //
];

/// `WIKI_BLOCK` after the level shift.
pub fn wiki_shifted() -> [f32; 64] {
    WIKI_BLOCK.map(|v| v - 128.0)
}
