//! One stick on his desk side, drawn in code: a dish, a stick that burns down in one-pixel
//! steps, an ember in his vermilion and a thin wisp. No file, no timer of its own.
use crate::render::Image;

pub const STEPS: usize = 42;
const WIDTH: usize = 7;
const HEIGHT: usize = 52;
/// How long after the end the picture lingers: the ember out, the last wisp.
pub const END_MS: u64 = 2_000;

/// Steps burned, 0 at the lighting to 42 at the end.
pub fn burned(start: f64, end: f64, now: u64) -> usize {
    if !(end > start) {
        return STEPS;
    }
    (((now as f64 - start) / (end - start)).clamp(0., 1.) * STEPS as f64).floor() as usize
}

/// Whether the stick is burning at `now`.
pub fn burning(stick: Option<(f64, f64)>, now: u64) -> bool {
    stick.is_some_and(|(start, end)| now as f64 >= start && (now as f64) < end)
}

/// The stick as an image, `steps` burned. `ended` is how long ago it burned out, if it has.
pub fn image(steps: usize, ended: Option<u64>, dark: bool, high_contrast: bool) -> Image {
    let wood: [u8; 3] = if dark { [0xC0, 0xA9, 0x8E] } else { [0x84, 0x6D, 0x57] };
    let ember: [u8; 3] = if dark { [0xE5, 0x56, 0x2E] } else { [0xC7, 0x57, 0x30] };
    let smoke: [u8; 3] = if dark { [0xC5, 0xBE, 0xB1] } else { [0x6B, 0x66, 0x5F] };
    let mut pixels = vec![0u8; WIDTH * HEIGHT * 4];
    let mut put = |x: usize, y: usize, rgb: [u8; 3], alpha: f64| {
        if x < WIDTH && y < HEIGHT {
            let at = (y * WIDTH + x) * 4;
            for i in 0..3 {
                pixels[at + i] = (rgb[i] as f64 * alpha).round() as u8;
            }
            pixels[at + 3] = (255. * alpha).round() as u8;
        }
    };
    for x in 1..6 {
        put(x, HEIGHT - 1, wood, 1.);
    }
    for x in 2..5 {
        put(x, HEIGHT - 2, wood, 1.);
    }
    let base = HEIGHT - 3;
    let left = STEPS.saturating_sub(steps.min(STEPS));
    let wisp = if high_contrast { 1. } else { 0.7 };
    if let Some(ago) = ended {
        // The ember goes out in 800 ms; a last wisp rises and thins for the next 1.2 s.
        if ago < 800 {
            put(3, base, ember, 1. - ago as f64 / 800.);
        } else if ago < END_MS {
            let rise = ((ago - 800) as f64 / 1200. * 6.).floor() as usize;
            put(3, base.saturating_sub(rise), smoke, wisp * (1. - (ago - 800) as f64 / 1200.));
        }
    } else {
        for row in 0..left {
            put(3, base - row, wood, 1.);
        }
        let top = base - left.saturating_sub(1);
        if left > 0 {
            put(3, top.saturating_sub(1), ember, 1.);
            put(4, top.saturating_sub(3), smoke, wisp);
        }
    }
    Image {
        width: WIDTH,
        height: HEIGHT,
        pixels,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn burns_in_forty_two_steps() {
        assert_eq!(burned(0., 25. * 60_000., 0), 0);
        assert_eq!(burned(0., 25. * 60_000., 12 * 60_000 + 30_000), 21);
        assert_eq!(burned(0., 25. * 60_000., 25 * 60_000), STEPS);
        assert_eq!(burned(5., 4., 10), STEPS);
    }
    #[test]
    fn only_burns_between_its_times() {
        assert!(burning(Some((10., 20.)), 10));
        assert!(!burning(Some((10., 20.)), 20));
        assert!(!burning(None, 15));
    }
    #[test]
    fn the_stick_shortens_and_ends_with_its_ember() {
        let count = |image: &Image| (0..image.height).filter(|y| image.pixels[(y * image.width + 3) * 4 + 3] > 0).count();
        assert!(count(&image(0, None, false, false)) > count(&image(30, None, false, false)));
        assert!(count(&image(42, None, false, false)) <= 3);
        let ember_alpha = |image: &Image| image.pixels[((HEIGHT - 3) * image.width + 3) * 4 + 3];
        assert_eq!(ember_alpha(&image(42, Some(0), false, false)), 255);
        assert_eq!(ember_alpha(&image(42, Some(799), false, false)), 0);
    }
}
