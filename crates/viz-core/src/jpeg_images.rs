//! Built-in test images for the JPEG lab, generated in code so they need no
//! assets: each one is chosen to provoke one artifact.

use jpeg::Rgb8Image;

use crate::rules::rng::splitmix64;

/// Ids accepted by `builtin_image`, in picker order.
pub const GENERATED_IMAGES: &[&str] = &["gradient", "text", "bars"];

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
}
