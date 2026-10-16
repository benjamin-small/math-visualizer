//! Built-in test images for the JPEG lab, generated in code so they need no
//! assets: each one is chosen to provoke one artifact.

use std::f32::consts::PI;

use jpeg::Rgb8Image;

use crate::rules::rng::splitmix64;

/// Ids accepted by `builtin_image`, in picker order.
pub const GENERATED_IMAGES: &[&str] = &[
    "gradient",
    "text",
    "bars",
    "cosines",
    "cosines-shifted",
    "noise",
];

/// Largest width or height `builtin_image` will generate (guards against
/// enormous allocations requested from JavaScript).
pub const MAX_BUILTIN_SIDE: usize = 4096;

/// The generated image `id` at `w × h`, or `None` for an unknown id, a zero
/// size, or a side above `MAX_BUILTIN_SIDE`.
pub fn builtin_image(id: &str, w: usize, h: usize) -> Option<Rgb8Image> {
    if w == 0 || h == 0 || w > MAX_BUILTIN_SIDE || h > MAX_BUILTIN_SIDE {
        return None;
    }
    let pixel: fn(usize, usize, usize, usize) -> [u8; 3] = match id {
        "gradient" => gradient_px,
        "text" => text_px,
        "bars" => bars_px,
        "cosines" => cosines_px,
        "cosines-shifted" => cosines_shifted_px,
        "noise" => noise_px,
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
/// repeating sawtooth diagonal. Sharp edges everywhere, so quantization rings.
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

/// A quilt of the 64 DCT basis patterns, one per 8×8 block, on a constant teal
/// tint: block `(bx, by)` carries frequency `(bx % 8, by % 8)`. Every block is
/// exactly one cosine the transform has a coefficient for, so it codes to one
/// or two numbers and the whole picture compresses almost perfectly.
fn cosines_px(x: usize, y: usize, _w: usize, _h: usize) -> [u8; 3] {
    let (u, v) = ((x / 8) % 8, (y / 8) % 8);
    let c = |k: usize, n: usize| (PI * (2 * n + 1) as f32 * k as f32 / 16.0).cos();
    let l = 128.0 + 90.0 * c(u, x % 8) * c(v, y % 8);
    to_px([l - 40.0, l + 10.0, l + 25.0])
}

/// The same cosines slid 4 pixels right and down, so every 8×8 block straddles
/// four patterns. The picture is as simple to describe as before, but no block
/// is a single cosine any more, so it costs several times the bytes. The
/// transform only rewards what lines up with its grid.
fn cosines_shifted_px(x: usize, y: usize, w: usize, h: usize) -> [u8; 3] {
    cosines_px(x + 4, y + 4, w, h)
}

/// Seeded random bytes in every channel. There is no structure to find, so
/// compression can only shrink it by destroying it: the file stays large and
/// the decoded picture is a poor copy of the original.
fn noise_px(x: usize, y: usize, w: usize, _h: usize) -> [u8; 3] {
    let r = splitmix64(0x4A50_4547 ^ (y * w + x) as u64);
    [r as u8, (r >> 8) as u8, (r >> 16) as u8]
}

#[cfg(test)]
mod tests {
    use super::*;
    use jpeg::blocks::level_shift;
    use jpeg::codec::{decode, encode, HuffmanMode, Options};
    use jpeg::color::rgb_to_ycbcr;
    use jpeg::dct::fdct;
    use jpeg::metrics::psnr;
    use jpeg::quant::{quantize, scale_table, STD_LUMA};
    use jpeg::Subsampling;

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
        assert!(builtin_image("gradient", MAX_BUILTIN_SIDE + 1, 8).is_none());
        assert!(builtin_image("gradient", 8, MAX_BUILTIN_SIDE + 1).is_none());
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

    fn baseline() -> Options {
        Options {
            quality: 50,
            subsampling: Subsampling::S420,
            huffman: HuffmanMode::Optimized,
            ..Options::default()
        }
    }

    fn file_bytes(img: &Rgb8Image, quality: u8) -> usize {
        let opts = Options {
            quality,
            ..baseline()
        };
        encode(img, &opts).unwrap().bytes.len()
    }

    /// Shannon entropy of the byte values, in bits per byte.
    fn entropy(bytes: &[u8]) -> f64 {
        let mut freq = [0u32; 256];
        for &b in bytes {
            freq[b as usize] += 1;
        }
        let n = bytes.len() as f64;
        freq.iter()
            .filter(|&&f| f > 0)
            .map(|&f| {
                let p = f as f64 / n;
                -p * p.log2()
            })
            .sum()
    }

    #[test]
    fn the_generated_list_names_every_picture() {
        assert_eq!(
            GENERATED_IMAGES,
            [
                "gradient",
                "text",
                "bars",
                "cosines",
                "cosines-shifted",
                "noise"
            ]
        );
        for id in GENERATED_IMAGES {
            assert!(builtin_image(id, 16, 16).is_some(), "{id}");
        }
    }

    #[test]
    fn every_cosine_block_quantizes_to_at_most_two_numbers() {
        let img = builtin_image("cosines", 256, 256).unwrap();
        let table = scale_table(&STD_LUMA, 50);
        for by in 0..32 {
            for bx in 0..32 {
                let mut luma = [0.0f32; 64];
                for j in 0..8 {
                    for i in 0..8 {
                        let o = ((bx * 8 + i) + img.w * (by * 8 + j)) * 4;
                        let [r, g, b] = [0, 1, 2].map(|c| img.rgba[o + c] as f32);
                        luma[i + 8 * j] = rgb_to_ycbcr(r, g, b)[0];
                    }
                }
                let q = quantize(&fdct(&level_shift(&luma)), &table);
                let nonzero = q.iter().filter(|&&v| v != 0).count();
                assert!(
                    nonzero <= 2,
                    "block ({bx}, {by}) has {nonzero} non-zero values"
                );
                let (u, v) = (bx % 8, by % 8);
                if (u, v) != (0, 0) {
                    assert_ne!(
                        q[u + 8 * v],
                        0,
                        "block ({bx}, {by}) lost its (u, v) = ({u}, {v}) value"
                    );
                }
            }
        }
    }

    #[test]
    fn shifting_the_cosines_by_four_pixels_costs_at_least_five_times_the_bytes() {
        let aligned = file_bytes(&builtin_image("cosines", 256, 256).unwrap(), 50);
        let shifted = file_bytes(&builtin_image("cosines-shifted", 256, 256).unwrap(), 50);
        assert!(shifted >= 5 * aligned, "{shifted} vs {aligned}");
    }

    #[test]
    fn noise_is_seeded_and_does_not_survive_compression() {
        let noise = builtin_image("noise", 256, 256).unwrap();
        assert_eq!(noise, builtin_image("noise", 256, 256).unwrap());
        let samples: Vec<u8> = noise
            .rgba
            .chunks_exact(4)
            .flat_map(|p| [p[0], p[1], p[2]])
            .collect();
        let h = entropy(&samples);
        assert!(h > 7.99, "entropy {h}");
        for quality in [50u8, 90, 100] {
            let opts = Options {
                quality,
                ..baseline()
            };
            let bytes = encode(&noise, &opts).unwrap().bytes;
            let back = decode(&bytes).unwrap().image;
            let db = psnr(&noise, &back).unwrap();
            assert!(db < 15.0, "q{quality}: {db} dB");
        }
    }
}
