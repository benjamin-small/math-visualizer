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
