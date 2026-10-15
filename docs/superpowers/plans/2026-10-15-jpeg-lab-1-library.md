# JPEG Lab, Plan 1: the `jpeg` library, the kit and the browser oracle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship slice 1 of the JPEG lab: a dependency-free Rust crate `crates/jpeg` with every baseline JPEG stage as a pure function plus its inverse, a JFIF encoder/decoder composed from them, three generated test images and stateless WASM bindings ("the kit") in `viz-core`, and a browser test proving Chrome decodes our files the way our decoder does.

**Architecture:** `crates/jpeg` has no dependencies and no `web-sys`, so every module is unit-tested natively. `viz-core` depends on it by path and adds two modules: `jpeg_images` (the generated built-ins) and `jpeg_kit` (`#[wasm_bindgen]` free functions over typed arrays). No engine, rule, visualization or UI changes in this plan; those are Plans 2–4, written after this lands so they build on the real API.

**Tech Stack:** Rust 2021 (stable), wasm-bindgen 0.2, serde + serde-wasm-bindgen (already in `viz-core`), wasm-bindgen-test + wasm-bindgen-futures in headless Chrome.

**Spec:** `docs/superpowers/specs/2026-10-15-jpeg-lab-design.md` (Part 1, the kit half of Part 2, the Testing section, Delivery item 1).

**Provenance:** every code block below was compiled and run before this plan was written (a throwaway prototype, then a copy of this repo): 77 `jpeg` tests, 265 `viz-core` tests, `fmt`/`clippy` clean for the new code, and in headless Chrome 155 the 33 existing browser tests plus the 6 kit tests and the oracle. If a step's expected output differs, stop and investigate rather than editing the test to pass.

## Global Constraints

- Branch: `jpeg-library` (the spec and this plan are already committed there). `main` is PR-only; push and open the PR only in Task 13.
- Validation (AGENTS.md): `cargo fmt --all --check`, `cargo clippy --all-targets --all-features`, `cargo test --all-features`. Browser: `wasm-pack test --chrome --headless --chromedriver=/private/tmp/claude-501/-Users-bsmall-dev-math-visualizer/9f5e6f00-2b13-4952-8009-b31a54f0fe14/scratchpad/chromedriver-155/chromedriver-mac-arm64/chromedriver crates/viz-core` (Chrome 155; the `--chromedriver=` flag must come **before** the crate path; never run it alongside another cargo build). If that chromedriver path is missing, download the build matching `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --version` from Chrome for Testing (`https://storage.googleapis.com/chrome-for-testing-public/<version>/mac-arm64/chromedriver-mac-arm64.zip`) into the session scratchpad.
- `crates/jpeg` has **no dependencies** (not even dev-dependencies). No new test crates anywhere; randomized tests use inline xorshift/LCG loops or `rules::rng::splitmix64`.
- Clippy: the new code must add **zero** warnings. The 7 existing warnings in `sierpinski_*.rs` are out of scope.
- Every `pub` item gets a doc comment; comment density like the neighbouring code. Conventional commits: `feat(jpeg): …`, `test(jpeg): …`, `docs: …`.
- Numbers fixed by the spec: JFIF full-range BT.601 colour matrices; Annex K tables K.1–K.6; IJG quality scaling (`q < 50 → 5000/q`, else `200 − 2q`, entries clamped 1–255, quality clamped 1–100); Huffman codes ≤ 16 bits with the all-ones code reserved; oracle tolerance per channel **max ≤ 3, mean ≤ 0.5** (measured: max 3, mean ≤ 0.37).
- Deliberate refinements of the spec, recorded in the spec's amendment note in this branch: `JpegError` gains `Corrupt(&'static str)`; `level_shift`/`unshift` return a new block (pure) instead of mutating; `Decoded` is `{ image, planes }` (the encoder's `Trace` already holds every intermediate); `Segment` gains `header_len`; the decoder clamps each IDCT sample to 0–255 before upsampling and colour conversion (as libjpeg does; without it the oracle's max error was 23); `decode` refuses frames over 16 MP; the kit refuses amplitudes beyond ±32767; `web/src/lib/jpeg/kit.ts` is deferred to Plan 2, where its first consumer lands.

## Review Focus

1. **Tiny or thin uploads (1×1, 1×40, 40×1, 2×3) in every subsampling** must encode and decode back to the same size, not panic in padding or MCU maths → Task 10 `tiny_and_thin_images_round_trip`.
2. **A solid-colour image** gives each Huffman table a single symbol; both optimized and standard tables must round-trip it exactly → Task 10 `a_flat_image_needs_one_symbol_per_table`.
3. **Corrupted or hostile bytes** (random byte flips anywhere after the frame header; a 65535×65535 frame header) must yield `Ok` or `Err`, never a panic or a multi-gigabyte allocation → Task 10 `corrupt_bytes_after_the_frame_header_never_panic`, `oversized_frames_are_refused_before_allocating`.
4. **Quality extremes 1 and 100 with the standard tables** (coefficients reach size 10/11) must still find a code for every symbol → Task 10 `quality_extremes_encode_with_either_table_set`.
5. **Out-of-range numbers from JavaScript** (amplitude ±40000 or `i32::MIN`, quality 0 or 255, a NaN coefficient) must become a `JsError` or be clamped, never a shift-overflow panic in WASM → Task 12 `out_of_range_numbers_are_refused_or_clamped`.

## File structure

| File | Responsibility |
|---|---|
| `Cargo.toml` (modify) | Add `crates/jpeg` to the workspace members |
| `crates/jpeg/Cargo.toml` | Package `jpeg`, no dependencies |
| `crates/jpeg/src/lib.rs` | Module list and re-exports |
| `crates/jpeg/src/error.rs` | `JpegError`, `check_len` |
| `crates/jpeg/src/image.rs` | `Block`, `QBlock`, `Table`, `Plane`, `Rgb8Image`, `Subsampling`, `Component` |
| `crates/jpeg/src/color.rs` | RGB ↔ YCbCr, plane split/merge |
| `crates/jpeg/src/sampling.rs` | Chroma downsample / upsample (nearest, fancy) |
| `crates/jpeg/src/blocks.rs` | Pad/crop, 8×8 blocks, level shift, MCU layout |
| `crates/jpeg/src/zigzag.rs` | Zigzag order and its inverse |
| `crates/jpeg/src/dct.rs` | 2D DCT/IDCT, basis patterns, partial rebuild, 1D DCT/DFT, extensions |
| `crates/jpeg/src/test_data.rs` | Test-only fixture: the Wikipedia example block |
| `crates/jpeg/src/quant.rs` | Annex K tables, IJG scaling, quantize/dequantize |
| `crates/jpeg/src/rle.rs` | Size categories, amplitude bits, DC difference, AC tokens |
| `crates/jpeg/src/bits.rs` | Bit writer/reader with byte stuffing and bit spans |
| `crates/jpeg/src/huffman.rs` | DHT-form tables, canonical codes, optimal lengths, code tree, standard tables |
| `crates/jpeg/src/jfif.rs` | Marker segments: write and list |
| `crates/jpeg/src/metrics.rs` | MSE, PSNR, error plane, entropy bound |
| `crates/jpeg/src/codec.rs` | `encode` (with `Trace`) and `decode` |
| `crates/viz-core/Cargo.toml` (modify) | Depend on `jpeg`; dev-deps for the oracle |
| `crates/viz-core/src/lib.rs` (modify) | `pub mod jpeg_images; pub mod jpeg_kit;` |
| `crates/viz-core/src/jpeg_images.rs` | Generated built-ins: `gradient`, `text`, `bars` |
| `crates/viz-core/src/jpeg_kit.rs` | `#[wasm_bindgen]` free functions over the crate |
| `crates/viz-core/tests/jpeg_kit.rs` | Browser tests for the kit |
| `crates/viz-core/tests/jpeg_oracle.rs` | Browser-decoder oracle |
| `README.md`, `docs/testing.md` (modify) | Layout, test commands and counts |

---

## Task 1: The crate, its error type and plain data types

**Files:**
- Modify: `Cargo.toml` (workspace `members`)
- Create: `crates/jpeg/Cargo.toml`, `crates/jpeg/src/lib.rs`, `crates/jpeg/src/error.rs`, `crates/jpeg/src/image.rs`

**Interfaces:**
- Produces: `jpeg::JpegError` (`BadLength { expected, got }`, `BadDimensions`, `Truncated`, `BadMarker(u8)`, `BadHuffmanCode`, `Corrupt(&'static str)`, `Unsupported(&'static str)`; `Display` + `std::error::Error`); `jpeg::error::check_len(expected, got) -> Result<(), JpegError>`; `Block = [f32; 64]`, `QBlock = [i32; 64]`, `Table = [u16; 64]` (all row-major, index `x + 8y`); `Plane { w, h, data: Vec<f32> }` with `new`, `get`, `get_clamped(isize, isize)`; `Rgb8Image { w, h, rgba: Vec<u8> }` with `new(w, h, rgba) -> Result` (1–65535 each way, `rgba.len() == w·h·4`); `MAX_DIMENSION = 65_535`; `Subsampling::{S444, S422, S420}` with `factors() -> (h, v)` and `from_factors`; `Component::{Y, Cb, Cr}` with `index()`.

- [ ] **Step 1: Register the crate.** In the root `Cargo.toml` change `members = ["crates/viz-core"]` to `members = ["crates/jpeg", "crates/viz-core"]`. Create `crates/jpeg/Cargo.toml`:

```toml
[package]
name = "jpeg"
version = "0.1.0"
edition.workspace = true
license.workspace = true
```

Create `crates/jpeg/src/lib.rs`:

```rust
//! The parts of baseline JPEG, one pure function per stage, each with its
//! inverse. `codec` composes them into a JFIF encoder and decoder; everything
//! else is usable on its own for small experiments (one block, one table, one
//! Huffman code).

pub mod error;
pub mod image;

pub use error::JpegError;
pub use image::{Block, Component, Plane, QBlock, Rgb8Image, Subsampling, Table};
```

Create `crates/jpeg/src/error.rs` (no tests of its own; every later module exercises it):

```rust
//! The one error type every fallible function in the crate returns.

use std::fmt;

/// Why a JPEG operation refused its input.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum JpegError {
    /// A slice had the wrong number of elements.
    BadLength { expected: usize, got: usize },
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
```

- [ ] **Step 2: Write the failing tests.** Create `crates/jpeg/src/image.rs` containing only:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rgb8image_checks_its_buffer() {
        assert!(Rgb8Image::new(2, 2, vec![0; 16]).is_ok());
        assert_eq!(
            Rgb8Image::new(2, 2, vec![0; 15]),
            Err(JpegError::BadLength {
                expected: 16,
                got: 15
            })
        );
        assert_eq!(Rgb8Image::new(0, 2, vec![]), Err(JpegError::BadDimensions));
    }

    #[test]
    fn plane_clamps_at_its_edges() {
        let p = Plane {
            w: 2,
            h: 2,
            data: vec![1.0, 2.0, 3.0, 4.0],
        };
        assert_eq!(p.get_clamped(-5, -5), 1.0);
        assert_eq!(p.get_clamped(9, 0), 2.0);
        assert_eq!(p.get_clamped(1, 9), 4.0);
    }

    #[test]
    fn subsampling_factors_round_trip() {
        for s in [Subsampling::S444, Subsampling::S422, Subsampling::S420] {
            let (h, v) = s.factors();
            assert_eq!(Subsampling::from_factors(h, v), Some(s));
        }
        assert_eq!(Subsampling::from_factors(1, 2), None);
    }
}
```

- [ ] **Step 3: Run them to see them fail.**

Run: `cargo test -p jpeg -- image::`
Expected: FAIL to compile (`cannot find type Rgb8Image` etc.).

- [ ] **Step 4: Implement.** Above the test module in `crates/jpeg/src/image.rs`:

```rust
//! Plain data types shared by every stage.

use crate::error::{check_len, JpegError};

/// 64 samples or coefficients, row-major: index `x + 8 * y` (for
/// coefficients, `u + 8 * v`, u the horizontal frequency).
pub type Block = [f32; 64];
/// 64 quantized coefficients, row-major.
pub type QBlock = [i32; 64];
/// A quantization table, row-major (not zigzag).
pub type Table = [u16; 64];

/// One channel of samples, row-major.
#[derive(Debug, Clone, PartialEq)]
pub struct Plane {
    pub w: usize,
    pub h: usize,
    pub data: Vec<f32>,
}

impl Plane {
    /// A `w × h` plane of zeros.
    pub fn new(w: usize, h: usize) -> Self {
        Self {
            w,
            h,
            data: vec![0.0; w * h],
        }
    }

    /// The sample at `(x, y)`; panics when out of range.
    pub fn get(&self, x: usize, y: usize) -> f32 {
        self.data[x + self.w * y]
    }

    /// The sample at `(x, y)` with both coordinates clamped into the plane
    /// (edge replication).
    pub fn get_clamped(&self, x: isize, y: isize) -> f32 {
        let x = x.clamp(0, self.w as isize - 1) as usize;
        let y = y.clamp(0, self.h as isize - 1) as usize;
        self.get(x, y)
    }
}

/// An 8-bit RGBA image (alpha is carried but never encoded).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rgb8Image {
    pub w: usize,
    pub h: usize,
    pub rgba: Vec<u8>,
}

/// Largest width or height a baseline JPEG frame header can hold.
pub const MAX_DIMENSION: usize = 65_535;

impl Rgb8Image {
    /// Validates the size (1..=65535 each way) and that `rgba` holds exactly
    /// `w * h * 4` bytes.
    pub fn new(w: usize, h: usize, rgba: Vec<u8>) -> Result<Self, JpegError> {
        if w == 0 || h == 0 || w > MAX_DIMENSION || h > MAX_DIMENSION {
            return Err(JpegError::BadDimensions);
        }
        check_len(w * h * 4, rgba.len())?;
        Ok(Self { w, h, rgba })
    }
}

/// How much chroma resolution survives.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Subsampling {
    /// Full-resolution chroma.
    S444,
    /// Chroma halved horizontally.
    S422,
    /// Chroma halved both ways.
    S420,
}

impl Subsampling {
    /// The luma sampling factors `(h, v)`; chroma is always `(1, 1)`.
    pub fn factors(self) -> (usize, usize) {
        match self {
            Self::S444 => (1, 1),
            Self::S422 => (2, 1),
            Self::S420 => (2, 2),
        }
    }

    /// The mode for luma factors `(h, v)`, if baseline-supported here.
    pub fn from_factors(h: usize, v: usize) -> Option<Self> {
        match (h, v) {
            (1, 1) => Some(Self::S444),
            (2, 1) => Some(Self::S422),
            (2, 2) => Some(Self::S420),
            _ => None,
        }
    }
}

/// The three channels after the colour transform.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Component {
    Y,
    Cb,
    Cr,
}

impl Component {
    /// 0, 1, 2 in frame order.
    pub fn index(self) -> usize {
        self as usize
    }
}
```

- [ ] **Step 5: Run them to see them pass.**

Run: `cargo test -p jpeg -- image::`
Expected: PASS, 3 tests.

- [ ] **Step 6: Lint and commit.**

```bash
cargo fmt --all && cargo clippy -p jpeg --all-targets 2>&1 | grep -c '^warning'   # expect 0
git add Cargo.toml crates/jpeg
git commit -m "feat(jpeg): new crate with its error and image types"
```

---

## Task 2: Colour transform and chroma subsampling

**Files:**
- Create: `crates/jpeg/src/color.rs`, `crates/jpeg/src/sampling.rs`
- Modify: `crates/jpeg/src/lib.rs`

**Interfaces:**
- Consumes: `Plane`, `Rgb8Image`, `Subsampling`, `JpegError` (Task 1).
- Produces: `color::{RGB_TO_YCBCR, YCBCR_OFFSET, YCBCR_TO_RGB}` (`[[f32; 3]; 3]` / `[f32; 3]`), `rgb_to_ycbcr(r, g, b) -> [f32; 3]`, `ycbcr_to_rgb(y, cb, cr) -> [f32; 3]` (unclamped), `split_planes(&Rgb8Image) -> [Plane; 3]`, `merge_planes(&[Plane; 3]) -> Result<Rgb8Image, JpegError>` (rounds, clamps, alpha 255), `to_u8(f32) -> u8`; `sampling::Upsample::{Nearest, Fancy}`, `downsample(&Plane, Subsampling) -> Plane` (box average, output `ceil(w/h) × ceil(h/v)`), `upsample(&Plane, Subsampling, Upsample, w, h) -> Plane`.

- [ ] **Step 1: Write the failing tests.** Add `pub mod color;`, `pub mod sampling;` to `crates/jpeg/src/lib.rs` (keep the list alphabetical). Then create each file below containing only its test module:

`crates/jpeg/src/color.rs`:

```rust
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
```

`crates/jpeg/src/sampling.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn ramp(w: usize, h: usize) -> Plane {
        Plane {
            w,
            h,
            data: (0..w * h).map(|i| i as f32).collect(),
        }
    }

    #[test]
    fn downsample_averages_tiles() {
        let p = ramp(4, 2); // rows 0 1 2 3 / 4 5 6 7
        let d = downsample(&p, Subsampling::S420);
        assert_eq!((d.w, d.h), (2, 1));
        assert_eq!(d.data, vec![2.5, 4.5]);
        let d = downsample(&p, Subsampling::S422);
        assert_eq!((d.w, d.h), (2, 2));
        assert_eq!(d.data, vec![0.5, 2.5, 4.5, 6.5]);
        assert_eq!(downsample(&p, Subsampling::S444), p);
    }

    #[test]
    fn downsample_rounds_odd_sizes_up() {
        let d = downsample(&ramp(3, 3), Subsampling::S420);
        assert_eq!((d.w, d.h), (2, 2));
    }

    #[test]
    fn upsampling_a_flat_plane_stays_flat() {
        let flat = Plane {
            w: 4,
            h: 4,
            data: vec![7.0; 16],
        };
        for mode in [Upsample::Nearest, Upsample::Fancy] {
            let u = upsample(&flat, Subsampling::S420, mode, 8, 8);
            assert!(u.data.iter().all(|&v| (v - 7.0).abs() < 1e-6));
        }
    }

    #[test]
    fn fancy_blends_toward_the_nearer_sample() {
        let p = Plane {
            w: 2,
            h: 1,
            data: vec![0.0, 100.0],
        };
        let u = upsample(&p, Subsampling::S422, Upsample::Fancy, 4, 1);
        assert_eq!(u.data, vec![0.0, 25.0, 75.0, 100.0]);
        let n = upsample(&p, Subsampling::S422, Upsample::Nearest, 4, 1);
        assert_eq!(n.data, vec![0.0, 0.0, 100.0, 100.0]);
    }
}
```

- [ ] **Step 2: Run the tests to see them fail.**

Run: `cargo test -p jpeg -- color:: sampling::`
Expected: FAIL to compile (`cannot find function …` / `cannot find type …` for the items the tests use).

- [ ] **Step 3: Implement.** Put this above the test module in each file:

`crates/jpeg/src/color.rs` (above `#[cfg(test)]`):

```rust
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
```

`crates/jpeg/src/sampling.rs` (above `#[cfg(test)]`):

```rust
//! Chroma subsampling: average away colour resolution the eye barely
//! misses, and bring it back for display.

use crate::image::{Plane, Subsampling};

/// How a subsampled plane is stretched back to full size.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Upsample {
    /// Each sample becomes an `h × v` tile — shows the blocks.
    Nearest,
    /// libjpeg's "fancy" triangle filter (¾ nearer sample + ¼ farther one,
    /// per doubled axis), which browsers use; the decoder uses this.
    Fancy,
}

/// Box-averages `h × v` tiles (the luma factors of `s`). Output size is
/// `ceil(w / h) × ceil(h / v)`; tiles past the edge reuse edge samples.
pub fn downsample(p: &Plane, s: Subsampling) -> Plane {
    let (fh, fv) = s.factors();
    let (ow, oh) = (p.w.div_ceil(fh), p.h.div_ceil(fv));
    let mut out = Plane::new(ow, oh);
    let n = (fh * fv) as f32;
    for oy in 0..oh {
        for ox in 0..ow {
            let mut sum = 0.0;
            for dy in 0..fv {
                for dx in 0..fh {
                    sum += p.get_clamped((ox * fh + dx) as isize, (oy * fv + dy) as isize);
                }
            }
            out.data[ox + ow * oy] = sum / n;
        }
    }
    out
}

/// Stretches a plane subsampled with `s` back to `w × h`.
pub fn upsample(p: &Plane, s: Subsampling, mode: Upsample, w: usize, h: usize) -> Plane {
    let (fh, fv) = s.factors();
    match mode {
        Upsample::Nearest => {
            let mut out = Plane::new(w, h);
            for y in 0..h {
                for x in 0..w {
                    out.data[x + w * y] = p.get_clamped((x / fh) as isize, (y / fv) as isize);
                }
            }
            out
        }
        Upsample::Fancy => {
            let wide = if fh == 2 {
                triangle_x(p, w)
            } else {
                resize_x(p, w)
            };
            if fv == 2 {
                triangle_y(&wide, h)
            } else {
                resize_y(&wide, h)
            }
        }
    }
}

/// Doubles width: output 2i = ¾·in[i] + ¼·in[i−1], 2i+1 = ¾·in[i] + ¼·in[i+1].
fn triangle_x(p: &Plane, w: usize) -> Plane {
    let mut out = Plane::new(w, p.h);
    for y in 0..p.h {
        for x in 0..w {
            let i = (x / 2) as isize;
            let far = if x % 2 == 0 { i - 1 } else { i + 1 };
            out.data[x + w * y] =
                0.75 * p.get_clamped(i, y as isize) + 0.25 * p.get_clamped(far, y as isize);
        }
    }
    out
}

/// Doubles height the same way as `triangle_x`.
fn triangle_y(p: &Plane, h: usize) -> Plane {
    let mut out = Plane::new(p.w, h);
    for y in 0..h {
        let i = (y / 2) as isize;
        let far = if y % 2 == 0 { i - 1 } else { i + 1 };
        for x in 0..p.w {
            out.data[x + p.w * y] =
                0.75 * p.get_clamped(x as isize, i) + 0.25 * p.get_clamped(x as isize, far);
        }
    }
    out
}

/// Crops or edge-extends to width `w` without scaling.
fn resize_x(p: &Plane, w: usize) -> Plane {
    let mut out = Plane::new(w, p.h);
    for y in 0..p.h {
        for x in 0..w {
            out.data[x + w * y] = p.get_clamped(x as isize, y as isize);
        }
    }
    out
}

/// Crops or edge-extends to height `h` without scaling.
fn resize_y(p: &Plane, h: usize) -> Plane {
    let mut out = Plane::new(p.w, h);
    for y in 0..h {
        for x in 0..p.w {
            out.data[x + p.w * y] = p.get_clamped(x as isize, y as isize);
        }
    }
    out
}
```

- [ ] **Step 4: Run the tests to see them pass.**

Run: `cargo test -p jpeg -- color:: sampling::`
Expected: PASS, 8 tests.

- [ ] **Step 5: Lint and commit.**

```bash
cargo fmt --all && cargo clippy -p jpeg --all-targets 2>&1 | grep -c '^warning'   # expect 0
git add Cargo.toml crates/jpeg
git commit -m "feat(jpeg): colour transform and chroma subsampling"
```

---

## Task 3: Blocks, padding and the MCU layout

**Files:**
- Create: `crates/jpeg/src/blocks.rs`
- Modify: `crates/jpeg/src/lib.rs`

**Interfaces:**
- Consumes: `Plane`, `Block`, `Subsampling`, `JpegError`, `check_len` (Task 1).
- Produces: `blocks::pad(&Plane, mw, mh) -> Plane` (edge replication up to multiples), `crop(&Plane, w, h) -> Result<Plane>`, `block_grid(w, h) -> (cols, rows)`, `to_blocks(&Plane) -> Result<Vec<Block>>` (sides multiples of 8, raster order), `from_blocks(&[Block], w, h) -> Result<Plane>`, `level_shift(&Block) -> Block` (−128), `unshift(&Block) -> Block`; `Unit { component, block }`; `McuLayout { cols, rows, mcu_w, mcu_h, grids: Vec<(usize, usize)>, units: Vec<Vec<Unit>> }`; `mcu_layout(Subsampling, w, h, components) -> McuLayout` (3 components: the MCU's luma blocks left-to-right, top-to-bottom, then one Cb, one Cr; 1 component: one block per 8×8 MCU).

- [ ] **Step 1: Write the failing tests.** Add `pub mod blocks;` to `crates/jpeg/src/lib.rs` (keep the list alphabetical). Then create each file below containing only its test module:

`crates/jpeg/src/blocks.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn ramp(w: usize, h: usize) -> Plane {
        Plane {
            w,
            h,
            data: (0..w * h).map(|i| i as f32).collect(),
        }
    }

    #[test]
    fn pad_repeats_edges_and_crop_undoes_it() {
        let p = ramp(3, 2);
        let padded = pad(&p, 8, 8);
        assert_eq!((padded.w, padded.h), (8, 8));
        assert_eq!(padded.get(7, 7), p.get(2, 1));
        assert_eq!(crop(&padded, 3, 2).unwrap(), p);
        assert_eq!(crop(&p, 4, 2), Err(JpegError::BadDimensions));
    }

    #[test]
    fn blocks_round_trip_in_raster_order() {
        let p = ramp(16, 8);
        let blocks = to_blocks(&p).unwrap();
        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[1][0], 8.0); // second block starts at x = 8
        assert_eq!(from_blocks(&blocks, 16, 8).unwrap(), p);
        assert_eq!(to_blocks(&ramp(12, 8)), Err(JpegError::BadDimensions));
    }

    #[test]
    fn level_shift_round_trips() {
        let b = [200.0; 64];
        assert_eq!(level_shift(&b)[0], 72.0);
        assert_eq!(unshift(&level_shift(&b)), b);
    }

    #[test]
    fn s420_mcu_holds_four_luma_blocks_then_chroma() {
        let l = mcu_layout(Subsampling::S420, 32, 16, 3);
        assert_eq!((l.cols, l.rows, l.mcu_w, l.mcu_h), (2, 1, 16, 16));
        assert_eq!(l.grids, vec![(4, 2), (2, 1), (2, 1)]);
        let blocks: Vec<(usize, usize)> =
            l.units[1].iter().map(|u| (u.component, u.block)).collect();
        assert_eq!(blocks, vec![(0, 2), (0, 3), (0, 6), (0, 7), (1, 1), (2, 1)]);
    }

    #[test]
    fn grayscale_mcus_are_single_blocks() {
        let l = mcu_layout(Subsampling::S420, 17, 9, 1);
        assert_eq!((l.cols, l.rows), (3, 2));
        assert!(l.units.iter().all(|m| m.len() == 1));
    }
}
```

- [ ] **Step 2: Run the tests to see them fail.**

Run: `cargo test -p jpeg -- blocks::`
Expected: FAIL to compile (`cannot find function …` / `cannot find type …` for the items the tests use).

- [ ] **Step 3: Implement.** Put this above the test module in each file:

`crates/jpeg/src/blocks.rs` (above `#[cfg(test)]`):

```rust
//! Cutting planes into 8×8 blocks and grouping blocks into MCUs (the unit
//! the scan walks).

use crate::error::JpegError;
use crate::image::{Block, Plane, Subsampling};

/// Grows a plane to the next multiple of `mw × mh` by repeating its last
/// column and row.
pub fn pad(p: &Plane, mw: usize, mh: usize) -> Plane {
    let (w, h) = (p.w.div_ceil(mw) * mw, p.h.div_ceil(mh) * mh);
    let mut out = Plane::new(w, h);
    for y in 0..h {
        for x in 0..w {
            out.data[x + w * y] = p.get_clamped(x as isize, y as isize);
        }
    }
    out
}

/// The top-left `w × h` of a plane.
pub fn crop(p: &Plane, w: usize, h: usize) -> Result<Plane, JpegError> {
    if w > p.w || h > p.h {
        return Err(JpegError::BadDimensions);
    }
    let mut out = Plane::new(w, h);
    for y in 0..h {
        out.data[w * y..w * (y + 1)].copy_from_slice(&p.data[p.w * y..p.w * y + w]);
    }
    Ok(out)
}

/// How many 8×8 blocks cover `w × h`: `(cols, rows)`.
pub fn block_grid(w: usize, h: usize) -> (usize, usize) {
    (w.div_ceil(8), h.div_ceil(8))
}

/// Cuts a plane whose sides are multiples of 8 into blocks, in raster order.
pub fn to_blocks(p: &Plane) -> Result<Vec<Block>, JpegError> {
    if !p.w.is_multiple_of(8) || !p.h.is_multiple_of(8) || p.w == 0 || p.h == 0 {
        return Err(JpegError::BadDimensions);
    }
    let (cols, rows) = block_grid(p.w, p.h);
    let mut out = Vec::with_capacity(cols * rows);
    for by in 0..rows {
        for bx in 0..cols {
            let mut b = [0.0; 64];
            for y in 0..8 {
                for x in 0..8 {
                    b[x + 8 * y] = p.get(bx * 8 + x, by * 8 + y);
                }
            }
            out.push(b);
        }
    }
    Ok(out)
}

/// Reassembles raster-order blocks into a `w × h` plane (multiples of 8).
pub fn from_blocks(blocks: &[Block], w: usize, h: usize) -> Result<Plane, JpegError> {
    if !w.is_multiple_of(8) || !h.is_multiple_of(8) {
        return Err(JpegError::BadDimensions);
    }
    let (cols, rows) = block_grid(w, h);
    crate::error::check_len(cols * rows, blocks.len())?;
    let mut out = Plane::new(w, h);
    for (i, b) in blocks.iter().enumerate() {
        let (bx, by) = (i % cols, i / cols);
        for y in 0..8 {
            for x in 0..8 {
                out.data[(bx * 8 + x) + w * (by * 8 + y)] = b[x + 8 * y];
            }
        }
    }
    Ok(out)
}

/// Centres samples on zero: `v − 128`.
pub fn level_shift(b: &Block) -> Block {
    b.map(|v| v - 128.0)
}

/// Undoes `level_shift`: `v + 128`.
pub fn unshift(b: &Block) -> Block {
    b.map(|v| v + 128.0)
}

/// One block's place in an MCU: which component, and its index in that
/// component's raster-order block list.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Unit {
    pub component: usize,
    pub block: usize,
}

/// The scan order of a frame.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McuLayout {
    /// MCUs across and down.
    pub cols: usize,
    pub rows: usize,
    /// MCU size in image pixels.
    pub mcu_w: usize,
    pub mcu_h: usize,
    /// Block grid `(cols, rows)` of each component's coded plane.
    pub grids: Vec<(usize, usize)>,
    /// For each MCU in scan order, its blocks in coding order.
    pub units: Vec<Vec<Unit>>,
}

/// The MCU layout for a `w × h` image with `components` (1 or 3).
/// Three components interleave: the luma blocks of an MCU (left-to-right,
/// top-to-bottom), then one Cb and one Cr block. One component has 8×8
/// MCUs of a single block, whatever `s` says.
pub fn mcu_layout(s: Subsampling, w: usize, h: usize, components: usize) -> McuLayout {
    let (fh, fv) = if components == 1 { (1, 1) } else { s.factors() };
    let (mcu_w, mcu_h) = (8 * fh, 8 * fv);
    let (cols, rows) = (w.div_ceil(mcu_w), h.div_ceil(mcu_h));
    let mut grids = vec![(cols * fh, rows * fv)];
    if components == 3 {
        grids.push((cols, rows));
        grids.push((cols, rows));
    }
    let mut units = Vec::with_capacity(cols * rows);
    for my in 0..rows {
        for mx in 0..cols {
            let mut mcu = Vec::with_capacity(fh * fv + 2);
            for dy in 0..fv {
                for dx in 0..fh {
                    let (bx, by) = (mx * fh + dx, my * fv + dy);
                    mcu.push(Unit {
                        component: 0,
                        block: bx + grids[0].0 * by,
                    });
                }
            }
            for c in 1..components {
                mcu.push(Unit {
                    component: c,
                    block: mx + cols * my,
                });
            }
            units.push(mcu);
        }
    }
    McuLayout {
        cols,
        rows,
        mcu_w,
        mcu_h,
        grids,
        units,
    }
}
```

- [ ] **Step 4: Run the tests to see them pass.**

Run: `cargo test -p jpeg -- blocks::`
Expected: PASS, 5 tests.

- [ ] **Step 5: Lint and commit.**

```bash
cargo fmt --all && cargo clippy -p jpeg --all-targets 2>&1 | grep -c '^warning'   # expect 0
git add Cargo.toml crates/jpeg
git commit -m "feat(jpeg): blocks, padding and MCU layout"
```

---

## Task 4: Zigzag order and the DCT

The DCT tests pin the Wikipedia "JPEG" example block's published coefficients (first row −415.38, −30.19, −61.20, 27.24, 56.12, −20.10, −2.39, 0.46; first column −415.38, 4.47, −46.83, −48.53, 12.12, −7.73, −1.03, −0.17, both ±0.01). Wikipedia prints that matrix with rows = vertical frequency v and columns = u, which is exactly our row-major `u + 8v` layout.

**Files:**
- Create: `crates/jpeg/src/zigzag.rs`, `crates/jpeg/src/dct.rs`, `crates/jpeg/src/test_data.rs`
- Modify: `crates/jpeg/src/lib.rs`

**Interfaces:**
- Consumes: `Block`, `QBlock` (Task 1).
- Produces: `zigzag::{ZIGZAG, UNZIGZAG}: [u8; 64]` (`ZIGZAG[k]` = row-major index of scan position k), `to_zigzag(&QBlock) -> [i32; 64]`, `from_zigzag(&[i32; 64]) -> QBlock`, `to_zigzag_u16` / `from_zigzag_u16` for `[u16; 64]`; `dct::cos_table() -> &'static [[f32; 8]; 8]`, `fdct(&Block) -> Block`, `idct(&Block) -> Block` (orthonormal), `basis(u, v) -> Block`, `idct_partial(&Block, k) -> Block`, `energy(&[f32]) -> f32`, `dct_1d` / `idct_1d(&[f32]) -> Vec<f32>`, `dft_1d(&[f32]) -> Vec<[f32; 2]>` (unitary), `extend_periodic(&[f32], reps)`, `extend_mirrored(&[f32], reps)`, `terms_for_energy(&[f32], frac) -> usize`; test-only `crate::test_data::{WIKI_BLOCK, wiki_shifted()}`.

- [ ] **Step 1: Add the shared test fixture.** Add `pub mod dct;` and `pub mod zigzag;` to `crates/jpeg/src/lib.rs`, plus, after the `pub mod` list:

```rust
#[cfg(test)]
mod test_data;
```

Create `crates/jpeg/src/test_data.rs`:

```rust
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
```

- [ ] **Step 2: Write the failing tests.** Create `crates/jpeg/src/zigzag.rs` containing only:

```rust
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
```

and `crates/jpeg/src/dct.rs` containing only:

```rust
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
```

- [ ] **Step 3: Run them to see them fail.**

Run: `cargo test -p jpeg -- zigzag:: dct::`
Expected: FAIL to compile.

- [ ] **Step 4: Implement.** Above the test module in `crates/jpeg/src/zigzag.rs`:

```rust
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

/// Row-major → scan order for any per-coefficient values (tables included).
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
```

Above the test module in `crates/jpeg/src/dct.rs`:

```rust
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
```

- [ ] **Step 5: Run them to see them pass.**

Run: `cargo test -p jpeg -- zigzag:: dct::`
Expected: PASS, 12 tests (including `matches_the_published_coefficients`).

- [ ] **Step 6: Lint and commit.**

```bash
cargo fmt --all && cargo clippy -p jpeg --all-targets 2>&1 | grep -c '^warning'   # expect 0
git add crates/jpeg
git commit -m "feat(jpeg): zigzag order and the 2D DCT with its basis patterns"
```

---

## Task 5: Quantization

The published quantized block (`−26 −3 −6 2 2 −1 …`) is the golden test.


**Files:**
- Create: `crates/jpeg/src/quant.rs`
- Modify: `crates/jpeg/src/lib.rs`

**Interfaces:**
- Consumes: `Block`, `QBlock`, `Table` (Task 1); `dct::fdct`, `test_data::wiki_shifted` (Task 4, tests only).
- Produces: `quant::{STD_LUMA, STD_CHROMA}: Table` (Annex K.1/K.2, row-major), `scale_table(&Table, quality: u8) -> Table`, `quantize(&Block, &Table) -> QBlock` (round half away from zero), `dequantize(&QBlock, &Table) -> Block`.

- [ ] **Step 1: Write the failing tests.** Add `pub mod quant;` to `crates/jpeg/src/lib.rs` (keep the list alphabetical). Then create each file below containing only its test module:

`crates/jpeg/src/quant.rs`:

```rust
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
```

- [ ] **Step 2: Run the tests to see them fail.**

Run: `cargo test -p jpeg -- quant::`
Expected: FAIL to compile (`cannot find function …` / `cannot find type …` for the items the tests use).

- [ ] **Step 3: Implement.** Put this above the test module in each file:

`crates/jpeg/src/quant.rs` (above `#[cfg(test)]`):

```rust
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
```

- [ ] **Step 4: Run the tests to see them pass.**

Run: `cargo test -p jpeg -- quant::`
Expected: PASS, 4 tests.

- [ ] **Step 5: Lint and commit.**

```bash
cargo fmt --all && cargo clippy -p jpeg --all-targets 2>&1 | grep -c '^warning'   # expect 0
git add Cargo.toml crates/jpeg
git commit -m "feat(jpeg): quantization tables, quality scaling and rounding"
```

---

## Task 6: Run-length coding

**Files:**
- Create: `crates/jpeg/src/rle.rs`
- Modify: `crates/jpeg/src/lib.rs`

**Interfaces:**
- Consumes: `JpegError` (Task 1).
- Produces: `rle::size_category(i32) -> u8`, `amplitude_bits(i32) -> (u16, u8)` (for |v| ≤ 32767), `from_amplitude_bits(u16, u8) -> i32`, `dc_diff(prev, dc)`, `dc_undiff(prev, diff)`, `AcToken { run: u8, size: u8, amp: i32 }` with `symbol() -> u8` (`run << 4 | size`), consts `ZRL` (15, 0) and `EOB` (0, 0), `ac_symbols(&[i32; 64]) -> Vec<AcToken>` (coefficients 1..64; no EOB when the last coefficient is non-zero), `ac_expand(dc, &[AcToken]) -> Result<[i32; 64], JpegError>` (`Corrupt` past coefficient 63).

- [ ] **Step 1: Write the failing tests.** Add `pub mod rle;` to `crates/jpeg/src/lib.rs` (keep the list alphabetical). Then create each file below containing only its test module:

`crates/jpeg/src/rle.rs`:

```rust
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
```

- [ ] **Step 2: Run the tests to see them fail.**

Run: `cargo test -p jpeg -- rle::`
Expected: FAIL to compile (`cannot find function …` / `cannot find type …` for the items the tests use).

- [ ] **Step 3: Implement.** Put this above the test module in each file:

`crates/jpeg/src/rle.rs` (above `#[cfg(test)]`):

```rust
//! Run-length coding: DC as a difference from the previous block, AC as
//! (zero-run, size) symbols each followed by `size` amplitude bits.

use crate::error::JpegError;

/// Bits needed for `|v|`: 0 for 0, 1 for ±1, 2 for ±2..3, … 11 for ±1024..2047.
pub fn size_category(v: i32) -> u8 {
    (32 - v.unsigned_abs().leading_zeros()) as u8
}

/// The `size` low bits that encode `v`: `v` itself when positive,
/// `v − 1` (one's complement) when negative. Returns `(bits, size)`.
pub fn amplitude_bits(v: i32) -> (u16, u8) {
    let size = size_category(v);
    let bits = if v >= 0 { v } else { v + (1 << size) - 1 };
    (bits as u16, size)
}

/// Inverse of `amplitude_bits`.
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
    pub run: u8,
    pub size: u8,
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
```

- [ ] **Step 4: Run the tests to see them pass.**

Run: `cargo test -p jpeg -- rle::`
Expected: PASS, 7 tests.

- [ ] **Step 5: Lint and commit.**

```bash
cargo fmt --all && cargo clippy -p jpeg --all-targets 2>&1 | grep -c '^warning'   # expect 0
git add Cargo.toml crates/jpeg
git commit -m "feat(jpeg): DC differences and AC run-length tokens"
```

---

## Task 7: Bit I/O with byte stuffing

**Files:**
- Create: `crates/jpeg/src/bits.rs`
- Modify: `crates/jpeg/src/lib.rs`

**Interfaces:**
- Consumes: `JpegError` (Task 1).
- Produces: `bits::BitSpan { start_bit: u64, len: u64 }` (payload bits, stuffing excluded); `BitWriter` with `new`, `write(bits: u32, n: u8)` (n ≤ 16, MSB first), `mark() -> u64`, `span_since(u64) -> BitSpan`, `finish(self) -> (stuffed: Vec<u8>, payload: Vec<u8>)` (pads with 1s); `bit_string(&[u8], BitSpan) -> String`; `BitReader<'a>` with `new(&[u8])`, `read_bit() -> Result<u32>`, `read_bits(n: u8) -> Result<u32>` (`Truncated` at the end or at a marker).

- [ ] **Step 1: Write the failing tests.** Add `pub mod bits;` to `crates/jpeg/src/lib.rs` (keep the list alphabetical). Then create each file below containing only its test module:

`crates/jpeg/src/bits.rs`:

```rust
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
```

- [ ] **Step 2: Run the tests to see them fail.**

Run: `cargo test -p jpeg -- bits::`
Expected: FAIL to compile (`cannot find function …` / `cannot find type …` for the items the tests use).

- [ ] **Step 3: Implement.** Put this above the test module in each file:

`crates/jpeg/src/bits.rs` (above `#[cfg(test)]`):

```rust
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
```

- [ ] **Step 4: Run the tests to see them pass.**

Run: `cargo test -p jpeg -- bits::`
Expected: PASS, 5 tests.

- [ ] **Step 5: Lint and commit.**

```bash
cargo fmt --all && cargo clippy -p jpeg --all-targets 2>&1 | grep -c '^warning'   # expect 0
git add Cargo.toml crates/jpeg
git commit -m "feat(jpeg): bit writer and reader with byte stuffing"
```

---

## Task 8: Huffman tables

Golden values: luminance DC category 0 → `00`, 11 → `111111110`; luminance AC 0x01 → `00`, EOB → `1010`, ZRL → `11111111001`, 0xFA → `1111111111111110`.


**Files:**
- Create: `crates/jpeg/src/huffman.rs`
- Modify: `crates/jpeg/src/lib.rs`

**Interfaces:**
- Consumes: `BitWriter`, `BitReader` (Task 7); `JpegError`, `check_len` (Task 1).
- Produces: `huffman::HuffSpec { bits: [u8; 16], vals: Vec<u8> }` (DHT form, `Default` = empty); `HuffTable { code: [u16; 256], len: [u8; 256] }`; `HuffDecoder::new(&HuffSpec) -> Result<HuffDecoder>`; `canonical_codes(&HuffSpec) -> Result<HuffTable>` (`BadLength` if counts and symbols disagree, `Corrupt` if over-full); `encode_symbol(&mut BitWriter, &HuffTable, u8) -> Result<()>` (`BadHuffmanCode` for a symbol with no code); `decode_symbol(&mut BitReader, &HuffDecoder) -> Result<u8>`; `count_frequencies(impl IntoIterator<Item = u8>) -> [u32; 256]`; `optimal_lengths(&[u32; 256]) -> HuffSpec` (Annex K.2); `TreeNode { depth: u8, code: u16, symbol: Option<u8> }`; `tree(&HuffSpec) -> Result<Vec<TreeNode>>` (root, internal nodes and leaves sorted by depth then code); `std_dc_luma()`, `std_dc_chroma()`, `std_ac_luma()`, `std_ac_chroma()` (Annex K.3–K.6).

- [ ] **Step 1: Write the failing tests.** Add `pub mod huffman;` to `crates/jpeg/src/lib.rs` (keep the list alphabetical). Then create each file below containing only its test module:

`crates/jpeg/src/huffman.rs`:

```rust
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
```

- [ ] **Step 2: Run the tests to see them fail.**

Run: `cargo test -p jpeg -- huffman::`
Expected: FAIL to compile (`cannot find function …` / `cannot find type …` for the items the tests use).

- [ ] **Step 3: Implement.** Put this above the test module in each file:

`crates/jpeg/src/huffman.rs` (above `#[cfg(test)]`):

```rust
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
    pub code: [u16; 256],
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

/// Checks that `bits` and `vals` agree and the codes fit in 16 bits.
fn validate(spec: &HuffSpec) -> Result<(), JpegError> {
    let total: usize = spec.bits.iter().map(|&b| b as usize).sum();
    crate::error::check_len(total, spec.vals.len())?;
    let mut code = 0u32;
    for (i, &n) in spec.bits.iter().enumerate() {
        code += n as u32;
        if code > 1 << (i + 1) {
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
```

- [ ] **Step 4: Run the tests to see them pass.**

Run: `cargo test -p jpeg -- huffman::`
Expected: PASS, 8 tests.

- [ ] **Step 5: Lint and commit.**

```bash
cargo fmt --all && cargo clippy -p jpeg --all-targets 2>&1 | grep -c '^warning'   # expect 0
git add Cargo.toml crates/jpeg
git commit -m "feat(jpeg): canonical and optimal Huffman tables with the code tree"
```

---

## Task 9: JFIF segments

**Files:**
- Create: `crates/jpeg/src/jfif.rs`
- Modify: `crates/jpeg/src/lib.rs`

**Interfaces:**
- Consumes: `HuffSpec` (Task 8); `to_zigzag_u16` (Task 4); `Table`, `JpegError` (Task 1).
- Produces: `jfif::FrameComponent { id, h, v, tq, td, ta }` (all `u8`); `Frame<'a> { width: u16, height: u16, components, qtables: Vec<(u8, Table)>, htables: Vec<(class, id, &HuffSpec)>, scan: &[u8] }`; `SegmentKind::{Soi, App0, AppN, Dqt, Sof0, SofOther, Dht, Dri, Sos, Com, Eoi, Other}`; `Segment { marker, kind, offset, header_len, len }` with `payload(&bytes)` and `scan(&bytes)`; `write_segments(&Frame) -> Vec<u8>` (SOI, APP0 "JFIF" 1.01, one DQT, SOF0, one DHT, SOS, scan, EOI); `parse_segments(&[u8]) -> Result<Vec<Segment>>` (SOS `len` runs to the next marker that is not stuffing or RSTn).

- [ ] **Step 1: Write the failing tests.** Add `pub mod jfif;` to `crates/jpeg/src/lib.rs` (keep the list alphabetical). Then create each file below containing only its test module:

`crates/jpeg/src/jfif.rs`:

```rust
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
```

- [ ] **Step 2: Run the tests to see them fail.**

Run: `cargo test -p jpeg -- jfif::`
Expected: FAIL to compile (`cannot find function …` / `cannot find type …` for the items the tests use).

- [ ] **Step 3: Implement.** Put this above the test module in each file:

`crates/jpeg/src/jfif.rs` (above `#[cfg(test)]`):

```rust
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
```

- [ ] **Step 4: Run the tests to see them pass.**

Run: `cargo test -p jpeg -- jfif::`
Expected: PASS, 4 tests.

- [ ] **Step 5: Lint and commit.**

```bash
cargo fmt --all && cargo clippy -p jpeg --all-targets 2>&1 | grep -c '^warning'   # expect 0
git add Cargo.toml crates/jpeg
git commit -m "feat(jpeg): write and list JFIF marker segments"
```

---

## Task 10: Metrics, the encoder and the decoder

The codec tests include all four `jpeg`-side Review Focus cases (tiny/thin images, flat images, quality extremes, corrupt and oversized input) and `decoded_samples_are_whole_bytes_before_colour_conversion`, which pins the libjpeg-style clamp the browser oracle depends on.


**Files:**
- Create: `crates/jpeg/src/metrics.rs`, `crates/jpeg/src/codec.rs`
- Modify: `crates/jpeg/src/lib.rs`

**Interfaces:**
- Consumes: every earlier task.
- Produces: `metrics::mse`, `psnr` (`f64`, `INFINITY` when identical), `error_plane(a, b) -> Result<Plane>`, `entropy_bits(&[u32]) -> f64`; `codec::HuffmanMode::{Optimized, Standard}`; `Options { quality: u8, subsampling, huffman, tables: Option<[Table; 2]>, grayscale: bool }` (`Default`: 50, S420, Optimized, None, false); `BlockTrace { dct, quant, dc_prev, dc_diff, tokens, bits: BitSpan, mcu }`; consts `DC_LUMA = 0, AC_LUMA = 1, DC_CHROMA = 2, AC_CHROMA = 3`; `Trace { width, height, options, planes, coded, layout, tables: [Table; 2], huffman: [HuffSpec; 4], frequencies: [[u32; 256]; 4], blocks: Vec<Vec<BlockTrace>>, mcu_bits: Vec<BitSpan>, payload: Vec<u8>, segments: Vec<Segment> }` with `pixels(c, bx, by) -> Option<Block>`, `block(c, bx, by) -> Option<&BlockTrace>`, `bit_string(BitSpan) -> String`; `Encoded { bytes, trace }`; `encode(&Rgb8Image, &Options) -> Result<Encoded>`; `Decoded { image, planes }`; `decode(&[u8]) -> Result<Decoded>`; `MAX_DECODE_PIXELS = 1 << 24`. Plan 2's rule and summary read `Trace` exactly as named here.

- [ ] **Step 1: Write the failing tests.** Add `pub mod metrics;`, `pub mod codec;` to `crates/jpeg/src/lib.rs` (keep the list alphabetical). Then create each file below containing only its test module:

`crates/jpeg/src/metrics.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn img(v: u8) -> Rgb8Image {
        Rgb8Image::new(2, 1, vec![v, v, v, 255, v, v, v, 255]).unwrap()
    }

    #[test]
    fn identical_images_have_infinite_psnr() {
        assert_eq!(mse(&img(10), &img(10)).unwrap(), 0.0);
        assert!(psnr(&img(10), &img(10)).unwrap().is_infinite());
    }

    #[test]
    fn psnr_of_a_known_error() {
        // Every channel off by 1 → MSE 1 → 48.13 dB.
        let p = psnr(&img(10), &img(11)).unwrap();
        assert!((p - 48.1308).abs() < 1e-3);
        assert_eq!(
            error_plane(&img(10), &img(13)).unwrap().data,
            vec![3.0, 3.0]
        );
    }

    #[test]
    fn size_mismatch_is_an_error() {
        let other = Rgb8Image::new(1, 1, vec![0; 4]).unwrap();
        assert_eq!(mse(&img(0), &other), Err(JpegError::BadDimensions));
    }

    #[test]
    fn entropy_of_simple_histograms() {
        assert_eq!(entropy_bits(&[4, 0, 0]), 0.0);
        assert!((entropy_bits(&[1, 1, 1, 1]) - 8.0).abs() < 1e-9); // 4 × 2 bits
        assert_eq!(entropy_bits(&[]), 0.0);
    }
}
```

`crates/jpeg/src/codec.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::metrics::psnr;

    /// A smooth gradient with a sharp-edged bar and a colour patch.
    fn test_image(w: usize, h: usize) -> Rgb8Image {
        let mut rgba = Vec::with_capacity(w * h * 4);
        for y in 0..h {
            for x in 0..w {
                let (fx, fy) = (x as f32 / w as f32, y as f32 / h as f32);
                let mut px = [
                    (40.0 + 180.0 * fx) as u8,
                    (60.0 + 150.0 * fy) as u8,
                    (200.0 - 120.0 * fx * fy) as u8,
                ];
                if x > w / 3 && x < w / 3 + 4 {
                    px = [10, 10, 10];
                }
                if y > h * 2 / 3 && x > w / 2 {
                    px = [230, 30, 40];
                }
                rgba.extend(px);
                rgba.push(255);
            }
        }
        Rgb8Image::new(w, h, rgba).unwrap()
    }

    /// Gentle gradients only: every subsampling should keep it well.
    fn smooth_image(w: usize, h: usize) -> Rgb8Image {
        let mut rgba = Vec::with_capacity(w * h * 4);
        for y in 0..h {
            for x in 0..w {
                let (fx, fy) = (x as f32 / w as f32, y as f32 / h as f32);
                rgba.extend([
                    (60.0 + 120.0 * fx) as u8,
                    (80.0 + 100.0 * fy) as u8,
                    (150.0 - 60.0 * fx * fy) as u8,
                    255,
                ]);
            }
        }
        Rgb8Image::new(w, h, rgba).unwrap()
    }

    fn opts(quality: u8, subsampling: Subsampling) -> Options {
        Options {
            quality,
            subsampling,
            ..Options::default()
        }
    }

    #[test]
    fn psnr_rises_with_quality() {
        let img = test_image(64, 48);
        let mut last = 0.0;
        for q in [10, 30, 50, 70, 90] {
            let e = encode(&img, &opts(q, Subsampling::S420)).unwrap();
            let p = psnr(&img, &decode(&e.bytes).unwrap().image).unwrap();
            assert!(p >= last, "q{q}: {p} < {last}");
            last = p;
        }
    }

    #[test]
    fn quality_100_full_chroma_is_near_lossless() {
        let img = test_image(64, 48);
        let e = encode(&img, &opts(100, Subsampling::S444)).unwrap();
        let p = psnr(&img, &decode(&e.bytes).unwrap().image).unwrap();
        assert!(p > 45.0, "{p}");
    }

    #[test]
    fn every_subsampling_and_odd_sizes_round_trip() {
        for s in [Subsampling::S444, Subsampling::S422, Subsampling::S420] {
            for (w, h) in [(17, 9), (8, 8), (33, 20)] {
                let img = smooth_image(w, h);
                let e = encode(&img, &opts(75, s)).unwrap();
                let d = decode(&e.bytes).unwrap();
                assert_eq!((d.image.w, d.image.h), (w, h));
                assert!(psnr(&img, &d.image).unwrap() > 35.0, "{s:?} {w}x{h}");
            }
        }
    }

    #[test]
    fn grayscale_round_trips() {
        let img = test_image(20, 12);
        let o = Options {
            grayscale: true,
            ..opts(90, Subsampling::S420)
        };
        let e = encode(&img, &o).unwrap();
        let d = decode(&e.bytes).unwrap();
        assert_eq!(d.planes.len(), 1);
        let px = &d.image.rgba[..4];
        assert!(px[0] == px[1] && px[1] == px[2]);
    }

    #[test]
    fn segments_come_in_baseline_order() {
        let e = encode(&test_image(16, 16), &Options::default()).unwrap();
        let kinds: Vec<SegmentKind> = e.trace.segments.iter().map(|s| s.kind).collect();
        use SegmentKind::*;
        assert_eq!(kinds, vec![Soi, App0, Dqt, Sof0, Dht, Sos, Eoi]);
    }

    #[test]
    fn optimized_tables_are_never_larger_than_standard() {
        let img = test_image(64, 64);
        let opt = encode(&img, &opts(50, Subsampling::S420)).unwrap();
        let std = encode(
            &img,
            &Options {
                huffman: HuffmanMode::Standard,
                ..opts(50, Subsampling::S420)
            },
        )
        .unwrap();
        assert!(opt.bytes.len() <= std.bytes.len());
        assert!(decode(&std.bytes).is_ok());
    }

    #[test]
    fn trace_spans_tile_the_payload() {
        let e = encode(&test_image(40, 24), &opts(50, Subsampling::S420)).unwrap();
        let t = &e.trace;
        let mut next = 0;
        for span in &t.mcu_bits {
            assert_eq!(span.start_bit, next);
            next += span.len;
        }
        let total: u64 = t.blocks.iter().flatten().map(|b| b.bits.len).sum();
        assert_eq!(total, next);
        assert!(t.payload.len() as u64 * 8 >= next);
        assert_eq!(t.layout.units.len(), t.mcu_bits.len());
        for (c, blocks) in t.blocks.iter().enumerate() {
            let (cols, rows) = t.layout.grids[c];
            assert_eq!(blocks.len(), cols * rows);
        }
    }

    #[test]
    fn trace_exposes_each_stage_of_a_block() {
        let e = encode(&test_image(32, 32), &opts(50, Subsampling::S420)).unwrap();
        let t = &e.trace;
        let px = t.pixels(0, 1, 1).unwrap();
        let b = t.block(0, 1, 1).unwrap();
        let dct = fdct(&level_shift(&px));
        assert_eq!(b.dct, dct);
        assert_eq!(b.quant, quantize(&dct, &t.tables[0]));
        assert_eq!(b.tokens, ac_symbols(&to_zigzag(&b.quant)));
        assert_eq!(t.bit_string(b.bits).len() as u64, b.bits.len);
        assert!(t.block(0, 4, 0).is_none());
        assert!(t.pixels(1, 2, 0).is_none()); // chroma is 16×16 here
    }

    #[test]
    fn dc_prediction_chains_within_a_component() {
        let e = encode(&test_image(32, 16), &opts(50, Subsampling::S444)).unwrap();
        let y = &e.trace.blocks[0];
        assert_eq!(y[0].dc_prev, 0);
        assert_eq!(y[1].dc_prev, y[0].quant[0]);
        assert_eq!(y[1].dc_diff, y[1].quant[0] - y[0].quant[0]);
    }

    #[test]
    fn custom_tables_are_used_as_given() {
        let tables = [[1u16; 64], [255u16; 64]];
        let o = Options {
            tables: Some(tables),
            ..Options::default()
        };
        let e = encode(&test_image(16, 16), &o).unwrap();
        assert_eq!(e.trace.tables, tables);
        assert!(decode(&e.bytes).is_ok());
    }

    #[test]
    fn decoded_samples_are_whole_bytes_before_colour_conversion() {
        // Low quality on hard edges makes the IDCT overshoot 0–255; the
        // decoder must clamp each sample (as libjpeg does) before converting.
        let e = encode(&test_image(32, 32), &opts(5, Subsampling::S444)).unwrap();
        let d = decode(&e.bytes).unwrap();
        for p in &d.planes {
            assert!(p
                .data
                .iter()
                .all(|&v| (0.0..=255.0).contains(&v) && v.fract() == 0.0));
        }
    }

    #[test]
    fn tiny_and_thin_images_round_trip() {
        for s in [Subsampling::S444, Subsampling::S422, Subsampling::S420] {
            for (w, h) in [(1, 1), (1, 40), (40, 1), (2, 3)] {
                let img = smooth_image(w, h);
                let e = encode(&img, &opts(90, s)).unwrap();
                let d = decode(&e.bytes).unwrap();
                assert_eq!((d.image.w, d.image.h), (w, h), "{s:?}");
            }
        }
    }

    #[test]
    fn a_flat_image_needs_one_symbol_per_table() {
        let img = Rgb8Image::new(16, 16, [90, 90, 90, 255].repeat(256)).unwrap();
        for huffman in [HuffmanMode::Optimized, HuffmanMode::Standard] {
            let o = Options {
                huffman,
                ..Options::default()
            };
            let e = encode(&img, &o).unwrap();
            assert_eq!(decode(&e.bytes).unwrap().image, img, "{huffman:?}");
        }
    }

    #[test]
    fn quality_extremes_encode_with_either_table_set() {
        let img = test_image(48, 32);
        for q in [1, 100] {
            for huffman in [HuffmanMode::Optimized, HuffmanMode::Standard] {
                let o = Options {
                    huffman,
                    ..opts(q, Subsampling::S444)
                };
                let e = encode(&img, &o).unwrap();
                assert!(decode(&e.bytes).is_ok(), "q{q} {huffman:?}");
            }
        }
    }

    #[test]
    fn corrupt_bytes_after_the_frame_header_never_panic() {
        let e = encode(&test_image(40, 24), &Options::default()).unwrap();
        let sof = e
            .trace
            .segments
            .iter()
            .find(|s| s.kind == SegmentKind::Sof0)
            .unwrap();
        let start = sof.offset + sof.len;
        let mut x = 0x2545_F491_u64;
        for _ in 0..2000 {
            let mut bytes = e.bytes.clone();
            for _ in 0..3 {
                x ^= x << 13;
                x ^= x >> 7;
                x ^= x << 17;
                let i = start + (x as usize) % (bytes.len() - start);
                bytes[i] = (x >> 32) as u8;
            }
            let _ = decode(&bytes); // Ok or Err, never a panic
        }
    }

    #[test]
    fn oversized_frames_are_refused_before_allocating() {
        let mut e = encode(&test_image(16, 16), &Options::default())
            .unwrap()
            .bytes;
        let segs = parse_segments(&e).unwrap();
        let sof = segs.iter().find(|s| s.kind == SegmentKind::Sof0).unwrap();
        // height and width = 65535
        e[sof.offset + 5..sof.offset + 9].copy_from_slice(&[0xFF, 0xFF, 0xFF, 0xFF]);
        assert_eq!(
            decode(&e).err(),
            Some(JpegError::Unsupported("image larger than 16 megapixels"))
        );
    }

    #[test]
    fn malformed_input_is_rejected_not_panicked_on() {
        let e = encode(&test_image(16, 16), &Options::default()).unwrap();
        let cut = &e.bytes[..e.bytes.len() / 2];
        assert_eq!(decode(cut).err(), Some(JpegError::Truncated));
        let mut prog = e.bytes.clone();
        let sof = e
            .trace
            .segments
            .iter()
            .find(|s| s.kind == SegmentKind::Sof0)
            .unwrap();
        prog[sof.offset + 1] = 0xC2;
        assert_eq!(
            decode(&prog).err(),
            Some(JpegError::Unsupported("progressive"))
        );
        assert!(decode(&[0xFF, 0xD8, 0xFF, 0xD9]).is_err());
        assert!(decode(&[]).is_err());
        // Garbage scan data must fail cleanly.
        let mut junk = e.bytes.clone();
        let sos = e
            .trace
            .segments
            .iter()
            .find(|s| s.kind == SegmentKind::Sos)
            .unwrap();
        for b in &mut junk[sos.offset + sos.header_len..sos.offset + sos.len] {
            *b = 0xFE;
        }
        let _ = decode(&junk); // any Result is fine; it must not panic
    }
}
```

- [ ] **Step 2: Run the tests to see them fail.**

Run: `cargo test -p jpeg -- metrics:: codec::`
Expected: FAIL to compile (`cannot find function …` / `cannot find type …` for the items the tests use).

- [ ] **Step 3: Implement.** Put this above the test module in each file:

`crates/jpeg/src/metrics.rs` (above `#[cfg(test)]`):

```rust
//! How much was lost, and how close the bits came to the entropy limit.

use crate::error::JpegError;
use crate::image::{Plane, Rgb8Image};

fn same_size(a: &Rgb8Image, b: &Rgb8Image) -> Result<(), JpegError> {
    if a.w != b.w || a.h != b.h {
        return Err(JpegError::BadDimensions);
    }
    Ok(())
}

/// Mean squared error over the R, G and B channels.
pub fn mse(a: &Rgb8Image, b: &Rgb8Image) -> Result<f64, JpegError> {
    same_size(a, b)?;
    let mut sum = 0.0f64;
    for (pa, pb) in a.rgba.chunks_exact(4).zip(b.rgba.chunks_exact(4)) {
        for c in 0..3 {
            let d = pa[c] as f64 - pb[c] as f64;
            sum += d * d;
        }
    }
    Ok(sum / (a.w * a.h * 3) as f64)
}

/// `10·log10(255² / MSE)` in dB; `f64::INFINITY` for identical images.
pub fn psnr(a: &Rgb8Image, b: &Rgb8Image) -> Result<f64, JpegError> {
    let m = mse(a, b)?;
    Ok(if m == 0.0 {
        f64::INFINITY
    } else {
        10.0 * (255.0 * 255.0 / m).log10()
    })
}

/// Per pixel, the mean absolute difference over R, G, B.
pub fn error_plane(a: &Rgb8Image, b: &Rgb8Image) -> Result<Plane, JpegError> {
    same_size(a, b)?;
    let mut p = Plane::new(a.w, a.h);
    for (i, (pa, pb)) in a
        .rgba
        .chunks_exact(4)
        .zip(b.rgba.chunks_exact(4))
        .enumerate()
    {
        p.data[i] = (0..3)
            .map(|c| (pa[c] as f32 - pb[c] as f32).abs())
            .sum::<f32>()
            / 3.0;
    }
    Ok(p)
}

/// Shannon's bound: the fewest bits any code could spend on symbols with
/// this histogram, `Σ f·log2(N / f)`.
pub fn entropy_bits(freq: &[u32]) -> f64 {
    let n: f64 = freq.iter().map(|&f| f as f64).sum();
    freq.iter()
        .filter(|&&f| f > 0)
        .map(|&f| f as f64 * (n / f as f64).log2())
        .sum()
}
```

`crates/jpeg/src/codec.rs` (above `#[cfg(test)]`):

```rust
//! Baseline JFIF encode and decode, composed from the other modules. The
//! encoder keeps every intermediate in a `Trace` so each stage can be shown.

use crate::bits::{bit_string, BitReader, BitSpan, BitWriter};
use crate::blocks::{from_blocks, level_shift, mcu_layout, pad, to_blocks, unshift, McuLayout};
use crate::color::{merge_planes, split_planes, to_u8};
use crate::dct::{fdct, idct};
use crate::error::JpegError;
use crate::huffman::{
    canonical_codes, decode_symbol, encode_symbol, optimal_lengths, std_ac_chroma, std_ac_luma,
    std_dc_chroma, std_dc_luma, HuffDecoder, HuffSpec,
};
use crate::image::{Block, Plane, QBlock, Rgb8Image, Subsampling, Table};
use crate::jfif::{parse_segments, write_segments, Frame, FrameComponent, Segment, SegmentKind};
use crate::quant::{dequantize, quantize, scale_table, STD_CHROMA, STD_LUMA};
use crate::rle::{
    ac_symbols, amplitude_bits, dc_diff, from_amplitude_bits, size_category, AcToken,
};
use crate::sampling::{downsample, upsample, Upsample};
use crate::zigzag::{from_zigzag, from_zigzag_u16, to_zigzag};

/// Which Huffman tables the encoder writes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HuffmanMode {
    /// Built from this image's own symbol counts (Annex K.2).
    Optimized,
    /// The example tables from Annex K.3.
    Standard,
}

/// Encoder settings.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Options {
    /// 1–100 (clamped), scaling the standard tables.
    pub quality: u8,
    pub subsampling: Subsampling,
    pub huffman: HuffmanMode,
    /// `[luma, chroma]` tables used as-is instead of the scaled standard ones.
    pub tables: Option<[Table; 2]>,
    /// Encode the Y plane only.
    pub grayscale: bool,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            quality: 50,
            subsampling: Subsampling::S420,
            huffman: HuffmanMode::Optimized,
            tables: None,
            grayscale: false,
        }
    }
}

/// One coded block.
#[derive(Debug, Clone, PartialEq)]
pub struct BlockTrace {
    /// The DCT of the level-shifted samples.
    pub dct: Block,
    pub quant: QBlock,
    /// DC of the previous block in this component (0 for the first).
    pub dc_prev: i32,
    pub dc_diff: i32,
    pub tokens: Vec<AcToken>,
    /// This block's bits in the unstuffed scan payload.
    pub bits: BitSpan,
    /// Index of the MCU holding it.
    pub mcu: usize,
}

/// Table slots in `Trace::huffman` / `Trace::frequencies`.
pub const DC_LUMA: usize = 0;
pub const AC_LUMA: usize = 1;
pub const DC_CHROMA: usize = 2;
pub const AC_CHROMA: usize = 3;

/// Every intermediate of one encode.
#[derive(Debug, Clone)]
pub struct Trace {
    pub width: usize,
    pub height: usize,
    pub options: Options,
    /// Full-resolution Y, Cb, Cr (Y only for grayscale).
    pub planes: Vec<Plane>,
    /// The padded (and, for chroma, subsampled) planes cut into blocks.
    pub coded: Vec<Plane>,
    pub layout: McuLayout,
    /// `[luma, chroma]` quantization tables, row-major.
    pub tables: [Table; 2],
    /// Indexed by `DC_LUMA`, `AC_LUMA`, `DC_CHROMA`, `AC_CHROMA`.
    pub huffman: [HuffSpec; 4],
    pub frequencies: [[u32; 256]; 4],
    /// Per component, its blocks in raster order of `layout.grids[c]`.
    pub blocks: Vec<Vec<BlockTrace>>,
    /// Each MCU's bits in the payload, in scan order.
    pub mcu_bits: Vec<BitSpan>,
    /// The scan before byte stuffing.
    pub payload: Vec<u8>,
    pub segments: Vec<Segment>,
}

impl Trace {
    /// The coded samples (0–255, before the level shift) of block
    /// `(bx, by)` of component `c`.
    pub fn pixels(&self, c: usize, bx: usize, by: usize) -> Option<Block> {
        let p = self.coded.get(c)?;
        if (bx + 1) * 8 > p.w || (by + 1) * 8 > p.h {
            return None;
        }
        Some(std::array::from_fn(|i| {
            p.get(bx * 8 + i % 8, by * 8 + i / 8)
        }))
    }

    /// The trace of block `(bx, by)` of component `c`.
    pub fn block(&self, c: usize, bx: usize, by: usize) -> Option<&BlockTrace> {
        let (cols, rows) = *self.layout.grids.get(c)?;
        if bx >= cols || by >= rows {
            return None;
        }
        self.blocks[c].get(bx + cols * by)
    }

    /// A span's bits as '0'/'1'.
    pub fn bit_string(&self, span: BitSpan) -> String {
        bit_string(&self.payload, span)
    }
}

/// The file and how it was made.
#[derive(Debug, Clone)]
pub struct Encoded {
    pub bytes: Vec<u8>,
    pub trace: Trace,
}

/// The `(DC, AC)` Huffman slots for component `c`.
fn slots(c: usize) -> (usize, usize) {
    if c == 0 {
        (DC_LUMA, AC_LUMA)
    } else {
        (DC_CHROMA, AC_CHROMA)
    }
}

/// Encodes `img` as a baseline JFIF file.
pub fn encode(img: &Rgb8Image, opts: &Options) -> Result<Encoded, JpegError> {
    let ncomp = if opts.grayscale { 1 } else { 3 };
    let layout = mcu_layout(opts.subsampling, img.w, img.h, ncomp);
    let planes: Vec<Plane> = split_planes(img).into_iter().take(ncomp).collect();
    let coded: Vec<Plane> = planes
        .iter()
        .enumerate()
        .map(|(c, p)| {
            let padded = pad(p, layout.mcu_w, layout.mcu_h);
            if c == 0 {
                padded
            } else {
                downsample(&padded, opts.subsampling)
            }
        })
        .collect();
    let tables = opts.tables.unwrap_or([
        scale_table(&STD_LUMA, opts.quality),
        scale_table(&STD_CHROMA, opts.quality),
    ]);

    // Transform and quantize every block.
    let mut blocks: Vec<Vec<BlockTrace>> = Vec::with_capacity(ncomp);
    for (c, plane) in coded.iter().enumerate() {
        let table = &tables[(c > 0) as usize];
        let traces = to_blocks(plane)?
            .iter()
            .map(|b| {
                let dct = fdct(&level_shift(b));
                BlockTrace {
                    dct,
                    quant: quantize(&dct, table),
                    dc_prev: 0,
                    dc_diff: 0,
                    tokens: Vec::new(),
                    bits: BitSpan::default(),
                    mcu: 0,
                }
            })
            .collect();
        blocks.push(traces);
    }

    // Walk the scan: DC differences, AC tokens, symbol counts.
    let mut frequencies = [[0u32; 256]; 4];
    let mut pred = vec![0i32; ncomp];
    for (m, mcu) in layout.units.iter().enumerate() {
        for u in mcu {
            let b = &mut blocks[u.component][u.block];
            let dc = b.quant[0];
            b.dc_prev = pred[u.component];
            b.dc_diff = dc_diff(pred[u.component], dc);
            pred[u.component] = dc;
            b.tokens = ac_symbols(&to_zigzag(&b.quant));
            b.mcu = m;
            let (dc_slot, ac_slot) = slots(u.component);
            frequencies[dc_slot][size_category(b.dc_diff) as usize] += 1;
            for t in &b.tokens {
                frequencies[ac_slot][t.symbol() as usize] += 1;
            }
        }
    }

    let huffman: [HuffSpec; 4] = match opts.huffman {
        HuffmanMode::Optimized => std::array::from_fn(|slot| optimal_lengths(&frequencies[slot])),
        HuffmanMode::Standard => [
            std_dc_luma(),
            std_ac_luma(),
            std_dc_chroma(),
            std_ac_chroma(),
        ],
    };
    let codes = [
        canonical_codes(&huffman[0])?,
        canonical_codes(&huffman[1])?,
        canonical_codes(&huffman[2])?,
        canonical_codes(&huffman[3])?,
    ];

    // Write the bits.
    let mut w = BitWriter::new();
    let mut mcu_bits = Vec::with_capacity(layout.units.len());
    for mcu in &layout.units {
        let mcu_mark = w.mark();
        for u in mcu {
            let b = &mut blocks[u.component][u.block];
            let (dc_slot, ac_slot) = slots(u.component);
            let mark = w.mark();
            let (bits, size) = amplitude_bits(b.dc_diff);
            encode_symbol(&mut w, &codes[dc_slot], size)?;
            w.write(bits as u32, size);
            for t in &b.tokens {
                encode_symbol(&mut w, &codes[ac_slot], t.symbol())?;
                let (bits, size) = amplitude_bits(t.amp);
                w.write(bits as u32, size);
            }
            b.bits = w.span_since(mark);
        }
        mcu_bits.push(w.span_since(mcu_mark));
    }
    let (scan, payload) = w.finish();

    let (fh, fv) = if ncomp == 1 {
        (1, 1)
    } else {
        opts.subsampling.factors()
    };
    let mut components = vec![FrameComponent {
        id: 1,
        h: fh as u8,
        v: fv as u8,
        tq: 0,
        td: 0,
        ta: 0,
    }];
    let mut qtables = vec![(0, tables[0])];
    let mut htables = vec![(0, 0, &huffman[DC_LUMA]), (1, 0, &huffman[AC_LUMA])];
    if ncomp == 3 {
        for id in [2, 3] {
            components.push(FrameComponent {
                id,
                h: 1,
                v: 1,
                tq: 1,
                td: 1,
                ta: 1,
            });
        }
        qtables.push((1, tables[1]));
        htables.push((0, 1, &huffman[DC_CHROMA]));
        htables.push((1, 1, &huffman[AC_CHROMA]));
    }
    let bytes = write_segments(&Frame {
        width: img.w as u16,
        height: img.h as u16,
        components,
        qtables,
        htables,
        scan: &scan,
    });
    let segments = parse_segments(&bytes)?;
    Ok(Encoded {
        bytes,
        trace: Trace {
            width: img.w,
            height: img.h,
            options: *opts,
            planes,
            coded,
            layout,
            tables,
            huffman,
            frequencies,
            blocks,
            mcu_bits,
            payload,
            segments,
        },
    })
}

/// A decoded image and its full-resolution Y, Cb, Cr planes (Y only for
/// grayscale).
#[derive(Debug, Clone)]
pub struct Decoded {
    pub image: Rgb8Image,
    pub planes: Vec<Plane>,
}

fn byte(p: &[u8], i: usize) -> Result<u8, JpegError> {
    p.get(i).copied().ok_or(JpegError::Truncated)
}

/// `(frame component index, DC table id, AC table id)` for one scan component.
type ScanComponent = (usize, usize, usize);

/// Largest frame `decode` accepts (4096 × 4096), so a hostile header can't
/// ask for gigabytes.
pub const MAX_DECODE_PIXELS: usize = 1 << 24;

struct FrameInfo {
    width: usize,
    height: usize,
    /// `(id, h, v, tq)`
    comps: Vec<(u8, usize, usize, usize)>,
}

/// Decodes a baseline, Huffman-coded, 8-bit JFIF file with one interleaved
/// scan (what `encode` writes, and most ordinary JPEGs without restarts).
pub fn decode(bytes: &[u8]) -> Result<Decoded, JpegError> {
    let segs = parse_segments(bytes)?;
    let mut qt: [Option<Table>; 4] = [None; 4];
    let mut ht: [[Option<HuffSpec>; 4]; 2] = Default::default();
    let mut frame: Option<FrameInfo> = None;
    let mut scan: Option<(Vec<ScanComponent>, &[u8])> = None;
    for s in &segs {
        let p = s.payload(bytes);
        match s.kind {
            SegmentKind::Dqt => {
                let mut i = 0;
                while i < p.len() {
                    let pq_tq = p[i];
                    if pq_tq >> 4 != 0 {
                        return Err(JpegError::Unsupported("16-bit quantization tables"));
                    }
                    let id = (pq_tq & 15) as usize;
                    if id > 3 {
                        return Err(JpegError::Corrupt("quantization table id"));
                    }
                    let raw = p.get(i + 1..i + 65).ok_or(JpegError::Truncated)?;
                    let z: [u16; 64] = std::array::from_fn(|k| raw[k] as u16);
                    qt[id] = Some(from_zigzag_u16(&z));
                    i += 65;
                }
            }
            SegmentKind::Dht => {
                let mut i = 0;
                while i < p.len() {
                    let (class, id) = ((p[i] >> 4) as usize, (p[i] & 15) as usize);
                    if class > 1 || id > 3 {
                        return Err(JpegError::Corrupt("Huffman table id"));
                    }
                    let counts = p.get(i + 1..i + 17).ok_or(JpegError::Truncated)?;
                    let mut bits = [0u8; 16];
                    bits.copy_from_slice(counts);
                    let n: usize = bits.iter().map(|&b| b as usize).sum();
                    let vals = p.get(i + 17..i + 17 + n).ok_or(JpegError::Truncated)?;
                    ht[class][id] = Some(HuffSpec {
                        bits,
                        vals: vals.to_vec(),
                    });
                    i += 17 + n;
                }
            }
            SegmentKind::Sof0 => {
                if byte(p, 0)? != 8 {
                    return Err(JpegError::Unsupported("12-bit samples"));
                }
                let height = ((byte(p, 1)? as usize) << 8) | byte(p, 2)? as usize;
                let width = ((byte(p, 3)? as usize) << 8) | byte(p, 4)? as usize;
                if width == 0 || height == 0 {
                    return Err(JpegError::Unsupported("height defined later (DNL)"));
                }
                if width * height > MAX_DECODE_PIXELS {
                    return Err(JpegError::Unsupported("image larger than 16 megapixels"));
                }
                let nc = byte(p, 5)? as usize;
                if nc != 1 && nc != 3 {
                    return Err(JpegError::Unsupported("component count"));
                }
                let mut comps = Vec::with_capacity(nc);
                for c in 0..nc {
                    let hv = byte(p, 7 + 3 * c)?;
                    let tq = byte(p, 8 + 3 * c)? as usize;
                    if tq > 3 {
                        return Err(JpegError::Corrupt("quantization table id"));
                    }
                    comps.push((
                        byte(p, 6 + 3 * c)?,
                        (hv >> 4) as usize,
                        (hv & 15) as usize,
                        tq,
                    ));
                }
                frame = Some(FrameInfo {
                    width,
                    height,
                    comps,
                });
            }
            SegmentKind::SofOther => {
                return Err(JpegError::Unsupported(match s.marker {
                    0xC2 | 0xC6 => "progressive",
                    0xC9..=0xCF => "arithmetic coding",
                    _ => "non-baseline frame",
                }))
            }
            SegmentKind::Dri if (byte(p, 0)? != 0 || byte(p, 1)? != 0) => {
                return Err(JpegError::Unsupported("restart intervals"));
            }
            SegmentKind::Sos => {
                if scan.is_some() {
                    return Err(JpegError::Unsupported("multiple scans"));
                }
                let f = frame.as_ref().ok_or(JpegError::BadMarker(0xDA))?;
                let ns = byte(p, 0)? as usize;
                if ns != f.comps.len() {
                    return Err(JpegError::Unsupported("multiple scans"));
                }
                let mut sel = Vec::with_capacity(ns);
                for k in 0..ns {
                    let id = byte(p, 1 + 2 * k)?;
                    let tables = byte(p, 2 + 2 * k)?;
                    let c = f
                        .comps
                        .iter()
                        .position(|cc| cc.0 == id)
                        .ok_or(JpegError::Corrupt("scan component id"))?;
                    sel.push((c, (tables >> 4) as usize, (tables & 15) as usize));
                }
                let tail = p.get(1 + 2 * ns..4 + 2 * ns).ok_or(JpegError::Truncated)?;
                if tail != [0, 63, 0] {
                    return Err(JpegError::Unsupported("spectral selection"));
                }
                sel.sort_by_key(|t| t.0);
                scan = Some((sel, s.scan(bytes)));
            }
            _ => {}
        }
    }
    let f = frame.ok_or(JpegError::Corrupt("no frame header"))?;
    let (sel, data) = scan.ok_or(JpegError::Corrupt("no scan"))?;
    let nc = f.comps.len();
    let s = if nc == 1 {
        Subsampling::S444
    } else {
        if f.comps[1..].iter().any(|c| (c.1, c.2) != (1, 1)) {
            return Err(JpegError::Unsupported("sampling factors"));
        }
        Subsampling::from_factors(f.comps[0].1, f.comps[0].2)
            .ok_or(JpegError::Unsupported("sampling factors"))?
    };
    let layout = mcu_layout(s, f.width, f.height, nc);

    let mut dec = Vec::with_capacity(nc);
    for &(c, td, ta) in &sel {
        let table = qt[f.comps[c].3].ok_or(JpegError::Corrupt("missing quantization table"))?;
        let dc = ht[0]
            .get(td)
            .and_then(|t| t.as_ref())
            .ok_or(JpegError::Corrupt("missing Huffman table"))?;
        let ac = ht[1]
            .get(ta)
            .and_then(|t| t.as_ref())
            .ok_or(JpegError::Corrupt("missing Huffman table"))?;
        dec.push((table, HuffDecoder::new(dc)?, HuffDecoder::new(ac)?));
    }

    let mut out: Vec<Vec<Block>> = layout
        .grids
        .iter()
        .map(|&(cols, rows)| vec![[0.0; 64]; cols * rows])
        .collect();
    let mut pred = vec![0i32; nc];
    let mut r = BitReader::new(data);
    for mcu in &layout.units {
        for u in mcu {
            let (table, dcd, acd) = &dec[u.component];
            let size = decode_symbol(&mut r, dcd)?;
            if size > 11 {
                return Err(JpegError::Corrupt("DC size"));
            }
            let diff = from_amplitude_bits(r.read_bits(size)? as u16, size);
            pred[u.component] += diff;
            let mut z = [0i32; 64];
            z[0] = pred[u.component];
            let mut k = 1;
            while k < 64 {
                let rs = decode_symbol(&mut r, acd)?;
                let (run, size) = ((rs >> 4) as usize, rs & 15);
                if size == 0 {
                    if run == 15 {
                        k += 16;
                        continue;
                    }
                    break;
                }
                k += run;
                if k > 63 {
                    return Err(JpegError::Corrupt("zero run past coefficient 63"));
                }
                z[k] = from_amplitude_bits(r.read_bits(size)? as u16, size);
                k += 1;
            }
            // Each decoded sample is an 8-bit value: round and clamp before
            // upsampling and colour conversion, as libjpeg (and browsers) do.
            out[u.component][u.block] = unshift(&idct(&dequantize(&from_zigzag(&z), table)))
                .map(|v| v.round().clamp(0.0, 255.0));
        }
    }

    let (pw, ph) = (layout.grids[0].0 * 8, layout.grids[0].1 * 8);
    let mut planes = Vec::with_capacity(nc);
    for (c, blocks) in out.iter().enumerate() {
        let (cols, rows) = layout.grids[c];
        let coded = from_blocks(blocks, cols * 8, rows * 8)?;
        let full = if c == 0 {
            coded
        } else {
            upsample(&coded, s, Upsample::Fancy, pw, ph)
        };
        planes.push(crate::blocks::crop(&full, f.width, f.height)?);
    }
    let image = if nc == 3 {
        merge_planes(&[planes[0].clone(), planes[1].clone(), planes[2].clone()])?
    } else {
        let rgba = planes[0]
            .data
            .iter()
            .flat_map(|&y| {
                let v = to_u8(y);
                [v, v, v, 255]
            })
            .collect();
        Rgb8Image::new(f.width, f.height, rgba)?
    };
    Ok(Decoded { image, planes })
}
```

- [ ] **Step 4: Run the tests to see them pass.**

Run: `cargo test -p jpeg -- metrics:: codec::`
Expected: PASS, 21 tests.

- [ ] **Step 5: Lint and commit.**

```bash
cargo fmt --all && cargo clippy -p jpeg --all-targets 2>&1 | grep -c '^warning'   # expect 0
git add Cargo.toml crates/jpeg
git commit -m "feat(jpeg): baseline JFIF encoder with a full trace, and a decoder"
```

---

## Task 11: Generated built-in images in `viz-core`

**Files:**
- Modify: `crates/viz-core/Cargo.toml` (add `jpeg = { path = "../jpeg" }` as the first `[dependencies]` entry), `crates/viz-core/src/lib.rs` (add `pub mod jpeg_images;` after `pub mod engine;`)
- Create: `crates/viz-core/src/jpeg_images.rs`

**Interfaces:**
- Consumes: `jpeg::Rgb8Image` (Task 1); `crate::rules::rng::splitmix64` (existing).
- Produces: `viz_core::jpeg_images::GENERATED_IMAGES: &[&str] = ["gradient", "text", "bars"]`; `builtin_image(id: &str, w: usize, h: usize) -> Option<Rgb8Image>` (deterministic; `None` for an unknown id or a zero size). Plan 2's rule encodes `builtin_image("gradient", 256, 256)` when no pixels were pushed.

- [ ] **Step 1: Write the failing tests.** Make the two edits above, then create `crates/viz-core/src/jpeg_images.rs` containing only:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn max_neighbour_step(img: &Rgb8Image) -> u8 {
        let mut m = 0;
        for y in 0..img.h {
            for x in 1..img.w {
                let (a, b) = ((x - 1 + img.w * y) * 4, (x + img.w * y) * 4);
                for c in 0..3 {
                    m = m.max(img.rgba[a + c].abs_diff(img.rgba[b + c]));
                }
            }
        }
        m
    }

    #[test]
    fn every_id_generates_the_requested_size() {
        for id in GENERATED_IMAGES {
            let img = builtin_image(id, 37, 21).unwrap();
            assert_eq!((img.w, img.h, img.rgba.len()), (37, 21, 37 * 21 * 4));
            assert_eq!(builtin_image(id, 37, 21).unwrap(), img); // deterministic
        }
        assert!(builtin_image("nope", 8, 8).is_none());
        assert!(builtin_image("text", 0, 8).is_none());
    }

    #[test]
    fn each_image_has_its_character() {
        let g = builtin_image("gradient", 256, 256).unwrap();
        assert!(max_neighbour_step(&g) < 12, "gradient is smooth");
        let t = builtin_image("text", 256, 256).unwrap();
        assert!(max_neighbour_step(&t) > 200, "text has hard edges");
        let b = builtin_image("bars", 256, 256).unwrap();
        let saturated = b
            .rgba
            .chunks_exact(4)
            .filter(|p| p[..3].iter().max().unwrap() - p[..3].iter().min().unwrap() > 200)
            .count();
        assert!(saturated > 256 * 64, "bars are colourful");
    }
}
```

- [ ] **Step 2: Run them to see them fail.**

Run: `cargo test -p viz-core jpeg_images::`
Expected: FAIL to compile (`cannot find function builtin_image`).

- [ ] **Step 3: Implement.** Above the test module:

```rust
//! Built-in test images for the JPEG lab, generated in code so they need no
//! assets: each one is chosen to provoke one artifact.

use jpeg::Rgb8Image;

use crate::rules::rng::splitmix64;

/// Ids accepted by `builtin_image`, in picker order.
pub const GENERATED_IMAGES: &[&str] = &["gradient", "text", "bars"];

/// The generated image `id` at `w × h`, or `None` for an unknown id or a
/// zero size.
pub fn builtin_image(id: &str, w: usize, h: usize) -> Option<Rgb8Image> {
    if w == 0 || h == 0 {
        return None;
    }
    let pixel: fn(usize, usize, usize, usize) -> [u8; 3] = match id {
        "gradient" => gradient_px,
        "text" => text_px,
        "bars" => bars_px,
        _ => return None,
    };
    let mut rgba = Vec::with_capacity(w * h * 4);
    for y in 0..h {
        for x in 0..w {
            rgba.extend(pixel(x, y, w, h));
            rgba.push(255);
        }
    }
    Rgb8Image::new(w, h, rgba).ok()
}

fn lerp3(a: [f32; 3], b: [f32; 3], t: f32) -> [f32; 3] {
    [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
    ]
}

fn to_px(c: [f32; 3]) -> [u8; 3] {
    c.map(|v| v.round().clamp(0.0, 255.0) as u8)
}

/// A dusk sky: deep blue to warm horizon with a soft sun. No edges at all,
/// so low quality shows nothing but blocking.
fn gradient_px(x: usize, y: usize, w: usize, h: usize) -> [u8; 3] {
    let (fx, fy) = (x as f32 / w as f32, y as f32 / h as f32);
    let t = fy * fy * (3.0 - 2.0 * fy); // smoothstep
    let mut c = lerp3([28.0, 52.0, 128.0], [242.0, 168.0, 108.0], t);
    c = lerp3(c, [200.0, 120.0, 150.0], 0.25 * fx * (1.0 - fy));
    let (dx, dy) = (fx - 0.68, fy - 0.62);
    let glow = (-(dx * dx + dy * dy) / 0.01).exp();
    to_px(lerp3(c, [255.0, 238.0, 205.0], glow))
}

/// Black strokes on white: a grid of blocky pseudo-glyphs, a ring and a
/// one-pixel diagonal. Sharp edges everywhere, so quantization rings.
fn text_px(x: usize, y: usize, w: usize, h: usize) -> [u8; 3] {
    const INK: [u8; 3] = [20, 20, 24];
    const PAPER: [u8; 3] = [246, 244, 238];
    let (cw, ch, margin) = (14usize, 22usize, 6usize);
    let split = h * 3 / 4;
    if y < split {
        if x < margin || y < margin {
            return PAPER;
        }
        let (lx, ly) = ((x - margin) % cw, (y - margin) % ch);
        let (cx, cy) = ((x - margin) / cw, (y - margin) / ch);
        if !(2..12).contains(&lx) || !(3..19).contains(&ly) {
            return PAPER;
        }
        let bits = splitmix64((cx as u64) * 131 + (cy as u64) * 7919) | 1;
        let on = |bit: u32| (bits >> bit) & 1 == 1;
        let diag = ((lx as i32 - 2) * 16 / 9 - (ly as i32 - 3)).abs() < 2;
        let ink = (on(0) && lx < 4)
            || (on(1) && lx >= 10)
            || (on(2) && ly < 5)
            || (on(3) && (10..12).contains(&ly))
            || (on(4) && ly >= 17)
            || (on(5) && diag);
        return if ink { INK } else { PAPER };
    }
    let (cx, cy) = (w as f32 * 0.3, (split + h) as f32 / 2.0);
    let r = ((x as f32 - cx).powi(2) + (y as f32 - cy).powi(2)).sqrt();
    let ring_r = (h - split) as f32 * 0.35;
    let ring = (r - ring_r).abs() < 1.5;
    let line = x > w / 2 && (x - w / 2) == (y - split) % (w / 2).max(1);
    if ring || line {
        INK
    } else {
        PAPER
    }
}

/// Saturated colour bars over a hue wheel. Strong chroma edges, so 4:2:0
/// subsampling visibly bleeds colour.
fn bars_px(x: usize, y: usize, w: usize, h: usize) -> [u8; 3] {
    const BARS: [[u8; 3]; 8] = [
        [235, 235, 235],
        [235, 235, 16],
        [16, 235, 235],
        [16, 235, 16],
        [235, 16, 235],
        [235, 16, 16],
        [16, 16, 235],
        [16, 16, 16],
    ];
    if y < h / 2 {
        return BARS[(x * 8 / w).min(7)];
    }
    let (cx, cy) = (w as f32 / 2.0, h as f32 * 0.75);
    let (dx, dy) = (x as f32 - cx, y as f32 - cy);
    let radius = (h as f32 / 4.0).min(w as f32 / 2.0) * 0.95;
    let r = (dx * dx + dy * dy).sqrt() / radius;
    if r > 1.0 {
        return [128, 128, 128];
    }
    let hue = (dy.atan2(dx) / std::f32::consts::TAU + 1.0).fract() * 6.0;
    let sector = hue.floor() as u32 % 6;
    let f = hue.fract();
    let (s, v) = (r, 1.0f32);
    let (p, q, t) = (v * (1.0 - s), v * (1.0 - s * f), v * (1.0 - s * (1.0 - f)));
    let rgb = match sector {
        0 => [v, t, p],
        1 => [q, v, p],
        2 => [p, v, t],
        3 => [p, q, v],
        4 => [t, p, v],
        _ => [v, p, q],
    };
    to_px(rgb.map(|c| c * 255.0))
}
```

- [ ] **Step 4: Run them to see them pass.**

Run: `cargo test -p viz-core jpeg_images::`
Expected: PASS, 2 tests.

- [ ] **Step 5: Lint and commit.**

```bash
cargo fmt --all && cargo clippy --all-targets --all-features 2>&1 | grep -c '^warning'   # expect 7 (all pre-existing, in sierpinski_*.rs)
git add crates/viz-core/Cargo.toml crates/viz-core/src/lib.rs crates/viz-core/src/jpeg_images.rs Cargo.lock
git commit -m "feat(jpeg): generated gradient, text and bars test images"
```

---

## Task 12: The kit (stateless WASM bindings)

**Files:**
- Modify: `crates/viz-core/src/lib.rs` (add `pub mod jpeg_kit;` after `pub mod jpeg_images;`), `crates/viz-core/Cargo.toml` (dev-dependencies, Step 1)
- Create: `crates/viz-core/src/jpeg_kit.rs`, `crates/viz-core/tests/jpeg_kit.rs`

**Interfaces:**
- Consumes: the whole `jpeg` crate; `builtin_image` (Task 11); `serde`, `serde-wasm-bindgen`, `wasm-bindgen` (existing deps).
- Produces (JS names = Rust names; typed arrays in and out; every fallible one returns `Result<_, JsError>`): `jpeg_fdct`, `jpeg_idct`, `jpeg_idct_partial(coeffs, k)`, `jpeg_basis(u, v)`, `jpeg_dct_1d`, `jpeg_idct_1d`, `jpeg_dft_1d` (interleaved re/im), `jpeg_quantize(coeffs, table) -> Int32Array`, `jpeg_dequantize`, `jpeg_scale_table(base, quality)`, `jpeg_std_table(chroma)`, `jpeg_to_zigzag`, `jpeg_from_zigzag`, `jpeg_zigzag_order() -> Uint8Array`, `jpeg_ac_symbols(zz) -> [{run, size, amp, symbol, bits}]`, `jpeg_size_category(v)`, `jpeg_amplitude_bits(v) -> [bits, size]`, `jpeg_optimal_lengths(freq[256]) -> {bits, vals}`, `jpeg_huffman_tree(bits[16], vals) -> [{depth, code, symbol}]` (code as a '0'/'1' string), `jpeg_rgb_to_ycbcr(r, g, b)`, `jpeg_builtin_image(id, w, h) -> Uint8Array`, `jpeg_encode_stats(rgba, w, h, quality, subsampling, huffman) -> {bytes, psnr}`, `jpeg_encode_decode(...) -> Uint8Array`; Rust-side `parse_options(quality, "444"|"422"|"420", "optimized"|"standard") -> Result<Options, String>`. Plan 2's `web/src/lib/jpeg/kit.ts` wraps exactly these.

- [ ] **Step 1: Add the browser-test dependencies.** In `crates/viz-core/Cargo.toml`, replace the `[dev-dependencies]` section with:

```toml
[dev-dependencies]
wasm-bindgen-test = "0.3"
wasm-bindgen-futures = "0.4"

# Browser-decoder oracle (tests/jpeg_oracle.rs) only.
[dev-dependencies.web-sys]
version = "0.3"
features = [
    "Blob",
    "BlobPropertyBag",
    "ColorSpaceConversion",
    "ImageBitmap",
    "ImageBitmapOptions",
    "ImageData",
    "OffscreenCanvas",
    "OffscreenCanvasRenderingContext2d",
    "PremultiplyAlpha",
]
```

- [ ] **Step 2: Write the failing tests.** Create `crates/viz-core/src/jpeg_kit.rs` containing only its native test:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_option_strings() {
        let o = parse_options(75, "422", "standard").unwrap();
        assert_eq!(o.quality, 75);
        assert_eq!(o.subsampling, Subsampling::S422);
        assert_eq!(o.huffman, HuffmanMode::Standard);
        assert!(parse_options(75, "411", "standard").is_err());
        assert!(parse_options(75, "420", "fast").is_err());
    }
}
```

and `crates/viz-core/tests/jpeg_kit.rs`:

```rust
//! The kit's bindings behave like the crate and refuse bad input.

use viz_core::jpeg_kit::*;
use wasm_bindgen::JsValue;
use wasm_bindgen_test::*;

wasm_bindgen_test_configure!(run_in_browser);

fn get(v: &JsValue, key: &str) -> JsValue {
    js_sys::Reflect::get(v, &JsValue::from_str(key)).unwrap()
}

#[wasm_bindgen_test]
fn dct_round_trips_through_the_boundary() {
    let block: Vec<f32> = (0..64).map(|i| (i % 9) as f32 * 7.0 - 30.0).collect();
    let back = jpeg_idct(&jpeg_fdct(&block).unwrap()).unwrap();
    for (a, b) in block.iter().zip(&back) {
        assert!((a - b).abs() < 1e-3);
    }
    assert_eq!(
        jpeg_idct_partial(&jpeg_fdct(&block).unwrap(), 0).unwrap(),
        vec![0.0; 64]
    );
    assert!(jpeg_basis(8, 0).is_err());
}

#[wasm_bindgen_test]
fn wrong_lengths_are_errors_not_panics() {
    assert!(jpeg_fdct(&[0.0; 63]).is_err());
    assert!(jpeg_quantize(&[0.0; 64], &[1; 10]).is_err());
    assert!(jpeg_to_zigzag(&[0; 65]).is_err());
    assert!(jpeg_optimal_lengths(&[1; 255]).is_err());
    assert!(jpeg_huffman_tree(&[0; 15], &[]).is_err());
    assert!(jpeg_encode_stats(&[0; 15], 2, 2, 50, "420", "optimized").is_err());
    assert!(jpeg_encode_stats(&[0; 16], 2, 2, 50, "411", "optimized").is_err());
    assert!(jpeg_builtin_image("nope", 8, 8).is_err());
}

#[wasm_bindgen_test]
fn tables_and_quantization() {
    let luma = jpeg_std_table(false);
    assert_eq!(luma[0], 16);
    assert_eq!(jpeg_scale_table(&luma, 50).unwrap(), luma);
    let mut c = vec![0.0f32; 64];
    c[0] = -415.38;
    let q = jpeg_quantize(&c, &luma).unwrap();
    assert_eq!(q[0], -26);
    assert_eq!(jpeg_dequantize(&q, &luma).unwrap()[0], -416.0);
    assert_eq!(jpeg_zigzag_order()[2], 8);
}

#[wasm_bindgen_test]
fn tokens_and_trees_cross_as_plain_objects() {
    let mut z = vec![0i32; 64];
    z[0] = 5;
    z[3] = -2;
    let tokens = jpeg_ac_symbols(&z).unwrap();
    let arr = js_sys::Array::from(&tokens);
    assert_eq!(arr.length(), 2); // (2, 2, −2) then EOB
    let first = arr.get(0);
    assert_eq!(get(&first, "run").as_f64(), Some(2.0));
    assert_eq!(get(&first, "symbol").as_f64(), Some(0x22 as f64));
    assert_eq!(get(&first, "bits").as_string().unwrap(), "01");

    let mut freq = vec![0u32; 256];
    freq[0] = 10;
    freq[1] = 5;
    freq[2] = 1;
    let spec = jpeg_optimal_lengths(&freq).unwrap();
    let bits: Vec<u8> = serde_wasm_bindgen::from_value(get(&spec, "bits")).unwrap();
    let vals: Vec<u8> = serde_wasm_bindgen::from_value(get(&spec, "vals")).unwrap();
    assert_eq!(vals, vec![0, 1, 2]);
    let nodes = js_sys::Array::from(&jpeg_huffman_tree(&bits, &vals).unwrap());
    assert_eq!(get(&nodes.get(0), "code").as_string().unwrap(), "");
    assert!(get(&nodes.get(0), "symbol").is_null() || get(&nodes.get(0), "symbol").is_undefined());
}

#[wasm_bindgen_test]
fn whole_image_helpers() {
    let rgba = jpeg_builtin_image("gradient", 32, 32).unwrap();
    assert_eq!(rgba.len(), 32 * 32 * 4);
    let low = jpeg_encode_stats(&rgba, 32, 32, 10, "420", "optimized").unwrap();
    let high = jpeg_encode_stats(&rgba, 32, 32, 90, "420", "optimized").unwrap();
    let (lb, hb) = (
        get(&low, "bytes").as_f64().unwrap(),
        get(&high, "bytes").as_f64().unwrap(),
    );
    let (lp, hp) = (
        get(&low, "psnr").as_f64().unwrap(),
        get(&high, "psnr").as_f64().unwrap(),
    );
    assert!(lb < hb && lp < hp);
    let once = jpeg_encode_decode(&rgba, 32, 32, 50, "420", "standard").unwrap();
    assert_eq!(once.len(), rgba.len());
    let ycc = jpeg_rgb_to_ycbcr(255.0, 255.0, 255.0);
    assert!((ycc[0] - 255.0).abs() < 0.01);
}

#[wasm_bindgen_test]
fn out_of_range_numbers_are_refused_or_clamped() {
    assert!(jpeg_amplitude_bits(40_000).is_err());
    assert!(jpeg_amplitude_bits(i32::MIN).is_err());
    assert_eq!(jpeg_amplitude_bits(-5).unwrap(), vec![2, 3]);
    let mut z = vec![0i32; 64];
    z[1] = -40_000;
    assert!(jpeg_ac_symbols(&z).is_err());
    let luma = jpeg_std_table(false);
    assert_eq!(
        jpeg_scale_table(&luma, 0).unwrap(),
        jpeg_scale_table(&luma, 1).unwrap()
    );
    assert_eq!(jpeg_scale_table(&luma, 255).unwrap(), vec![1; 64]);
    let mut c = vec![0.0f32; 64];
    c[5] = f32::NAN;
    assert_eq!(jpeg_quantize(&c, &luma).unwrap()[5], 0);
    let rgba = jpeg_builtin_image("text", 16, 16).unwrap();
    assert!(jpeg_encode_stats(&rgba, 16, 16, 0, "444", "standard").is_ok());
}
```

- [ ] **Step 3: Run the native test to see it fail.**

Run: `cargo test -p viz-core jpeg_kit::`
Expected: FAIL to compile (`cannot find function parse_options`).

- [ ] **Step 4: Implement.** Above the test module in `crates/viz-core/src/jpeg_kit.rs`:

```rust
//! "The kit": stateless WASM bindings for the `jpeg` crate's parts, so the
//! UI can run one stage on one block without touching the engine. Inputs
//! are typed arrays; every function checks lengths and returns a `JsError`
//! instead of panicking.

use jpeg::codec::{decode, encode, HuffmanMode, Options};
use jpeg::error::check_len;
use jpeg::huffman::{optimal_lengths, tree, HuffSpec};
use jpeg::{dct, metrics, quant, rle, zigzag, JpegError, Rgb8Image, Subsampling};
use serde::Serialize;
use wasm_bindgen::prelude::*;

use crate::jpeg_images::builtin_image;

fn js(e: JpegError) -> JsError {
    JsError::new(&e.to_string())
}

fn block(v: &[f32]) -> Result<[f32; 64], JsError> {
    check_len(64, v.len()).map_err(js)?;
    Ok(std::array::from_fn(|i| v[i]))
}

fn qblock(v: &[i32]) -> Result<[i32; 64], JsError> {
    check_len(64, v.len()).map_err(js)?;
    Ok(std::array::from_fn(|i| v[i]))
}

fn table(v: &[u16]) -> Result<[u16; 64], JsError> {
    check_len(64, v.len()).map_err(js)?;
    Ok(std::array::from_fn(|i| v[i]))
}

/// Largest amplitude the run-length helpers accept (sizes stay ≤ 15).
const MAX_AMPLITUDE: i32 = 32_767;

fn amplitudes(z: &[i32]) -> Result<[i32; 64], JsError> {
    let z = qblock(z)?;
    if z.iter().any(|v| v.unsigned_abs() > MAX_AMPLITUDE as u32) {
        return Err(JsError::new("values must be within ±32767"));
    }
    Ok(z)
}

fn to_js<T: Serialize>(v: &T) -> Result<JsValue, JsError> {
    serde_wasm_bindgen::to_value(v).map_err(|e| JsError::new(&e.to_string()))
}

/// Forward 2D DCT of 64 level-shifted samples.
#[wasm_bindgen]
pub fn jpeg_fdct(samples: &[f32]) -> Result<Vec<f32>, JsError> {
    Ok(dct::fdct(&block(samples)?).to_vec())
}

/// Inverse 2D DCT of 64 coefficients.
#[wasm_bindgen]
pub fn jpeg_idct(coeffs: &[f32]) -> Result<Vec<f32>, JsError> {
    Ok(dct::idct(&block(coeffs)?).to_vec())
}

/// The block rebuilt from its first `k` zigzag coefficients.
#[wasm_bindgen]
pub fn jpeg_idct_partial(coeffs: &[f32], k: usize) -> Result<Vec<f32>, JsError> {
    Ok(dct::idct_partial(&block(coeffs)?, k).to_vec())
}

/// Basis pattern `(u, v)`, each 0–7.
#[wasm_bindgen]
pub fn jpeg_basis(u: usize, v: usize) -> Result<Vec<f32>, JsError> {
    if u > 7 || v > 7 {
        return Err(JsError::new("u and v must be 0–7"));
    }
    Ok(dct::basis(u, v).to_vec())
}

/// Orthonormal 1D DCT-II of any length.
#[wasm_bindgen]
pub fn jpeg_dct_1d(x: &[f32]) -> Vec<f32> {
    dct::dct_1d(x)
}

/// Inverse of `jpeg_dct_1d`.
#[wasm_bindgen]
pub fn jpeg_idct_1d(c: &[f32]) -> Vec<f32> {
    dct::idct_1d(c)
}

/// Unitary 1D DFT, interleaved `[re0, im0, re1, im1, …]`.
#[wasm_bindgen]
pub fn jpeg_dft_1d(x: &[f32]) -> Vec<f32> {
    dct::dft_1d(x).into_iter().flatten().collect()
}

/// `round(F / Q)` for 64 coefficients and a row-major table.
#[wasm_bindgen]
pub fn jpeg_quantize(coeffs: &[f32], q_table: &[u16]) -> Result<Vec<i32>, JsError> {
    Ok(quant::quantize(&block(coeffs)?, &table(q_table)?).to_vec())
}

/// `q · Q` for 64 quantized values and a row-major table.
#[wasm_bindgen]
pub fn jpeg_dequantize(q: &[i32], q_table: &[u16]) -> Result<Vec<f32>, JsError> {
    Ok(quant::dequantize(&qblock(q)?, &table(q_table)?).to_vec())
}

/// A table scaled to `quality` (IJG formula).
#[wasm_bindgen]
pub fn jpeg_scale_table(base: &[u16], quality: u8) -> Result<Vec<u16>, JsError> {
    Ok(quant::scale_table(&table(base)?, quality).to_vec())
}

/// The Annex K luminance (`chroma = false`) or chrominance table.
#[wasm_bindgen]
pub fn jpeg_std_table(chroma: bool) -> Vec<u16> {
    if chroma {
        quant::STD_CHROMA
    } else {
        quant::STD_LUMA
    }
    .to_vec()
}

/// Row-major → zigzag order.
#[wasm_bindgen]
pub fn jpeg_to_zigzag(q: &[i32]) -> Result<Vec<i32>, JsError> {
    Ok(zigzag::to_zigzag(&qblock(q)?).to_vec())
}

/// Zigzag → row-major order.
#[wasm_bindgen]
pub fn jpeg_from_zigzag(z: &[i32]) -> Result<Vec<i32>, JsError> {
    Ok(zigzag::from_zigzag(&qblock(z)?).to_vec())
}

/// `ZIGZAG[k]` = row-major index of scan position `k`.
#[wasm_bindgen]
pub fn jpeg_zigzag_order() -> Vec<u8> {
    zigzag::ZIGZAG.to_vec()
}

#[derive(Serialize)]
struct TokenJs {
    run: u8,
    size: u8,
    amp: i32,
    symbol: u8,
    /// Amplitude bits as '0'/'1' (empty for ZRL/EOB).
    bits: String,
}

/// AC tokens of a zigzag-ordered block: `[{ run, size, amp, symbol, bits }]`.
#[wasm_bindgen]
pub fn jpeg_ac_symbols(z: &[i32]) -> Result<JsValue, JsError> {
    let tokens: Vec<TokenJs> = rle::ac_symbols(&amplitudes(z)?)
        .iter()
        .map(|t| {
            let (bits, size) = rle::amplitude_bits(t.amp);
            TokenJs {
                run: t.run,
                size: t.size,
                amp: t.amp,
                symbol: t.symbol(),
                bits: if size == 0 {
                    String::new()
                } else {
                    format!("{:0width$b}", bits, width = size as usize)
                },
            }
        })
        .collect();
    to_js(&tokens)
}

/// Bits needed for `|v|`.
#[wasm_bindgen]
pub fn jpeg_size_category(v: i32) -> u8 {
    rle::size_category(v)
}

/// `[bits, size]` encoding `v` (|v| ≤ 32767).
#[wasm_bindgen]
pub fn jpeg_amplitude_bits(v: i32) -> Result<Vec<u32>, JsError> {
    if v.unsigned_abs() > MAX_AMPLITUDE as u32 {
        return Err(JsError::new("values must be within ±32767"));
    }
    let (bits, size) = rle::amplitude_bits(v);
    Ok(vec![bits as u32, size as u32])
}

#[derive(Serialize)]
struct SpecJs {
    bits: Vec<u8>,
    vals: Vec<u8>,
}

/// The optimal Huffman table for a 256-entry histogram: `{ bits, vals }`.
#[wasm_bindgen]
pub fn jpeg_optimal_lengths(freq: &[u32]) -> Result<JsValue, JsError> {
    check_len(256, freq.len()).map_err(js)?;
    let spec = optimal_lengths(&std::array::from_fn(|i| freq[i]));
    to_js(&SpecJs {
        bits: spec.bits.to_vec(),
        vals: spec.vals,
    })
}

#[derive(Serialize)]
struct NodeJs {
    depth: u8,
    code: String,
    symbol: Option<u8>,
}

/// Every node of a table's code tree: `[{ depth, code, symbol }]` with
/// `code` as '0'/'1' (empty for the root) and `symbol` on leaves only.
#[wasm_bindgen]
pub fn jpeg_huffman_tree(bits: &[u8], vals: &[u8]) -> Result<JsValue, JsError> {
    check_len(16, bits.len()).map_err(js)?;
    let spec = HuffSpec {
        bits: std::array::from_fn(|i| bits[i]),
        vals: vals.to_vec(),
    };
    let nodes: Vec<NodeJs> = tree(&spec)
        .map_err(js)?
        .into_iter()
        .map(|n| NodeJs {
            depth: n.depth,
            code: if n.depth == 0 {
                String::new()
            } else {
                format!("{:0width$b}", n.code, width = n.depth as usize)
            },
            symbol: n.symbol,
        })
        .collect();
    to_js(&nodes)
}

/// `[Y, Cb, Cr]` of one RGB pixel.
#[wasm_bindgen]
pub fn jpeg_rgb_to_ycbcr(r: f32, g: f32, b: f32) -> Vec<f32> {
    jpeg::color::rgb_to_ycbcr(r, g, b).to_vec()
}

/// A generated built-in image (`gradient`, `text`, `bars`) as RGBA bytes.
#[wasm_bindgen]
pub fn jpeg_builtin_image(id: &str, w: usize, h: usize) -> Result<Vec<u8>, JsError> {
    builtin_image(id, w, h)
        .map(|img| img.rgba)
        .ok_or_else(|| JsError::new(&format!("no built-in image {id:?} at {w}×{h}")))
}

/// Parses the lab's option strings: subsampling "444" | "422" | "420",
/// huffman "optimized" | "standard".
pub fn parse_options(quality: u8, subsampling: &str, huffman: &str) -> Result<Options, String> {
    let subsampling = match subsampling {
        "444" => Subsampling::S444,
        "422" => Subsampling::S422,
        "420" => Subsampling::S420,
        other => return Err(format!("unknown subsampling {other:?}")),
    };
    let huffman = match huffman {
        "optimized" => HuffmanMode::Optimized,
        "standard" => HuffmanMode::Standard,
        other => return Err(format!("unknown huffman mode {other:?}")),
    };
    Ok(Options {
        quality,
        subsampling,
        huffman,
        ..Options::default()
    })
}

fn round_trip(
    rgba: &[u8],
    w: usize,
    h: usize,
    quality: u8,
    subsampling: &str,
    huffman: &str,
) -> Result<(Rgb8Image, usize, Rgb8Image), JsError> {
    let opts = parse_options(quality, subsampling, huffman).map_err(|e| JsError::new(&e))?;
    let img = Rgb8Image::new(w, h, rgba.to_vec()).map_err(js)?;
    let bytes = encode(&img, &opts).map_err(js)?.bytes;
    let back = decode(&bytes).map_err(js)?.image;
    Ok((img, bytes.len(), back))
}

#[derive(Serialize)]
struct StatsJs {
    bytes: usize,
    psnr: f64,
}

/// Encode then decode: `{ bytes, psnr }` (psnr is `Infinity` for a perfect
/// copy). Used for the rate–distortion sweep.
#[wasm_bindgen]
pub fn jpeg_encode_stats(
    rgba: &[u8],
    w: usize,
    h: usize,
    quality: u8,
    subsampling: &str,
    huffman: &str,
) -> Result<JsValue, JsError> {
    let (img, bytes, back) = round_trip(rgba, w, h, quality, subsampling, huffman)?;
    let psnr = metrics::psnr(&img, &back).map_err(js)?;
    to_js(&StatsJs { bytes, psnr })
}

/// Encode then decode, returning the decoded RGBA (one generation of
/// generation loss).
#[wasm_bindgen]
pub fn jpeg_encode_decode(
    rgba: &[u8],
    w: usize,
    h: usize,
    quality: u8,
    subsampling: &str,
    huffman: &str,
) -> Result<Vec<u8>, JsError> {
    Ok(round_trip(rgba, w, h, quality, subsampling, huffman)?
        .2
        .rgba)
}
```

- [ ] **Step 5: Run the tests to see them pass.**

Run: `cargo test -p viz-core jpeg_kit::`
Expected: PASS, 1 test.

Run: `wasm-pack test --chrome --headless --chromedriver=/private/tmp/claude-501/-Users-bsmall-dev-math-visualizer/9f5e6f00-2b13-4952-8009-b31a54f0fe14/scratchpad/chromedriver-155/chromedriver-mac-arm64/chromedriver crates/viz-core`
Expected: `tests/jpeg_kit.rs` → 6 passed; `tests/wasm.rs` → 33 passed (`tests/jpeg_oracle.rs` does not exist yet).

- [ ] **Step 6: Lint and commit.**

```bash
cargo fmt --all && cargo clippy --all-targets --all-features 2>&1 | grep -c '^warning'   # expect 7 (pre-existing)
git add crates/viz-core Cargo.lock
git commit -m "feat(jpeg): stateless WASM kit over the library's parts"
```

---

## Task 13: The browser-decoder oracle, docs and the PR

**Files:**
- Create: `crates/viz-core/tests/jpeg_oracle.rs`
- Modify: `README.md` (Testing, Project layout), `docs/testing.md`

**Interfaces:**
- Consumes: `jpeg::codec::{encode, decode, Options}`, `jpeg::Subsampling` (Task 10); `builtin_image` (Task 11); the web-sys dev features (Task 12).

- [ ] **Step 1: Write the oracle test.** Create `crates/viz-core/tests/jpeg_oracle.rs`:

```rust
//! Our encoder's bytes, decoded by the browser, must match our decoder.

use jpeg::codec::{decode, encode, Options};
use jpeg::Subsampling;
use viz_core::jpeg_images::builtin_image;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::JsFuture;
use wasm_bindgen_test::*;
use web_sys::{
    Blob, BlobPropertyBag, ColorSpaceConversion, ImageBitmap, ImageBitmapOptions, OffscreenCanvas,
    OffscreenCanvasRenderingContext2d, PremultiplyAlpha,
};

wasm_bindgen_test_configure!(run_in_browser);

async fn browser_decode(bytes: &[u8], w: u32, h: u32) -> Vec<u8> {
    let parts = js_sys::Array::of1(&js_sys::Uint8Array::from(bytes));
    let props = BlobPropertyBag::new();
    props.set_type("image/jpeg");
    let blob = Blob::new_with_u8_array_sequence_and_options(&parts, &props).unwrap();
    let opts = ImageBitmapOptions::new();
    opts.set_color_space_conversion(ColorSpaceConversion::None);
    opts.set_premultiply_alpha(PremultiplyAlpha::None);
    let promise = web_sys::window()
        .unwrap()
        .create_image_bitmap_with_blob_and_image_bitmap_options(&blob, &opts)
        .unwrap();
    let bitmap: ImageBitmap = JsFuture::from(promise).await.unwrap().dyn_into().unwrap();
    assert_eq!((bitmap.width(), bitmap.height()), (w, h));
    let canvas = OffscreenCanvas::new(w, h).unwrap();
    let ctx: OffscreenCanvasRenderingContext2d = canvas
        .get_context("2d")
        .unwrap()
        .unwrap()
        .dyn_into()
        .unwrap();
    ctx.draw_image_with_image_bitmap(&bitmap, 0.0, 0.0).unwrap();
    ctx.get_image_data(0.0, 0.0, w as f64, h as f64)
        .unwrap()
        .data()
        .0
}

/// Our bytes decoded by the browser vs our own decoder: per channel, at
/// most 3 levels apart anywhere and 0.5 on average. (Measured on Chrome 155:
/// max 3, mean ≤ 0.37; the gap is libjpeg's integer IDCT, upsampling and
/// colour conversion vs our float ones.)
#[wasm_bindgen_test]
async fn browser_agrees_with_our_decoder() {
    for id in ["gradient", "text", "bars"] {
        for (w, h) in [(128usize, 128usize), (99, 61)] {
            let img = builtin_image(id, w, h).unwrap();
            for s in [Subsampling::S444, Subsampling::S422, Subsampling::S420] {
                for q in [10u8, 50, 90] {
                    let o = Options {
                        quality: q,
                        subsampling: s,
                        ..Options::default()
                    };
                    let e = encode(&img, &o).unwrap();
                    let ours = decode(&e.bytes).unwrap().image.rgba;
                    let theirs = browser_decode(&e.bytes, w as u32, h as u32).await;
                    let (mut max, mut sum, mut n) = (0u8, 0u64, 0u64);
                    for (a, b) in ours.chunks_exact(4).zip(theirs.chunks_exact(4)) {
                        for c in 0..3 {
                            let d = a[c].abs_diff(b[c]);
                            max = max.max(d);
                            sum += d as u64;
                            n += 1;
                        }
                    }
                    let mean = sum as f64 / n as f64;
                    let case = format!("{id} {w}x{h} {s:?} q{q}");
                    assert!(max <= 3, "{case}: max {max}");
                    assert!(mean <= 0.5, "{case}: mean {mean}");
                }
            }
        }
    }
}
```

- [ ] **Step 2: Run it.**

Run: `wasm-pack test --chrome --headless --chromedriver=/private/tmp/claude-501/-Users-bsmall-dev-math-visualizer/9f5e6f00-2b13-4952-8009-b31a54f0fe14/scratchpad/chromedriver-155/chromedriver-mac-arm64/chromedriver crates/viz-core`
Expected: `jpeg_oracle.rs` → 1 passed (about 1 s); `jpeg_kit.rs` → 6 passed; `wasm.rs` → 33 passed. The oracle passes at once because Task 10 already clamps decoded samples. To see what it guards, temporarily delete the `.map(|v| v.round().clamp(0.0, 255.0))` in `codec::decode`: the oracle must fail (max ≈ 20 on `bars`/`text`) and `decoded_samples_are_whole_bytes_before_colour_conversion` must fail natively. Restore the line.

- [ ] **Step 3: Update the docs.** In `README.md`, under `## Testing`, make the browser comment read `# WASM browser tests (headless Chrome) — flag must precede the path; includes the JPEG kit and browser-decoder oracle`. Under `## Project layout`, add above the `crates/viz-core/` line:

```
├── crates/jpeg/                      # Pure-Rust baseline JPEG, one module per stage (no deps)
│   └── src/                          # color, sampling, blocks, dct, quant, zigzag, rle,
│                                     # huffman, bits, jfif, codec (encode + trace, decode), metrics
```

and inside `crates/viz-core/src/`, after the `lib.rs` line:

```
│   │   ├── jpeg_images.rs            # Generated JPEG lab test images (gradient, text, bars)
│   │   ├── jpeg_kit.rs               # Stateless wasm-bindgen wrappers over the jpeg crate
```

and replace the `└── tests/wasm.rs` line with:

```
│   └── tests/                        # Browser tests: wasm.rs (engine), jpeg_kit.rs, jpeg_oracle.rs
```

In `docs/testing.md`, replace the second paragraph's first sentence with: "The Rust suite currently contains 342 passing tests: 77 in the dependency-free `jpeg` crate (every stage's round trip and invariants, the published Wikipedia DCT and quantization values, the Annex K Huffman codes, and encoder/decoder end-to-end cases including corrupt and hostile input) and 265 in `viz-core`." Replace "currently contains 33 passing tests" with "currently contains 40 passing tests (33 engine smoke tests, 6 JPEG kit tests, and the JPEG browser-decoder oracle, which checks that Chrome decodes our encoder's files to within 3 levels per channel of our own decoder)".

- [ ] **Step 4: Full validation.**

```bash
cargo fmt --all --check
cargo clippy --all-targets --all-features 2>&1 | grep -c '^warning'   # expect 7 (pre-existing)
cargo test --all-features 2>&1 | grep 'test result: ok. [1-9]'        # 77 (jpeg) and 265 (viz-core)
wasm-pack test --chrome --headless --chromedriver=/private/tmp/claude-501/-Users-bsmall-dev-math-visualizer/9f5e6f00-2b13-4952-8009-b31a54f0fe14/scratchpad/chromedriver-155/chromedriver-mac-arm64/chromedriver crates/viz-core
wasm-pack build crates/viz-core --target web --out-dir pkg             # web build still links (+~74 KB wasm)
```

- [ ] **Step 5: Commit, push and open the PR.**

```bash
git add crates/viz-core/tests/jpeg_oracle.rs README.md docs/testing.md
git commit -m "test(jpeg): the browser decoder agrees with ours; docs for the jpeg crate"
git fetch origin && git rebase origin/main
git push -u origin jpeg-library
gh pr create --title "feat(jpeg): a granular JPEG library, its WASM kit and a browser-decoder oracle" --body "Slice 1 of the JPEG lab (spec: docs/superpowers/specs/2026-10-15-jpeg-lab-design.md, plan: docs/superpowers/plans/2026-10-15-jpeg-lab-1-library.md). Adds crates/jpeg (every baseline stage as a pure function with its inverse, plus a traced JFIF encoder and a decoder), generated test images and stateless WASM bindings in viz-core, and a headless-Chrome test that decodes our files with the browser and compares against our decoder (max 3 levels per channel). No UI changes."
```

If `.github/CODEOWNERS` reappears after the rebase (the repository-keeper bot), delete it in its own commit and tell the user.
