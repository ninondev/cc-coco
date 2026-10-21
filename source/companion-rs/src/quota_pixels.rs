//! The quota pictures in the Activity foot (lane C, 10-17): the laptop's battery for the 5-hour window and the
//! power bank for the weekly one, as on the band (the owner's 10-14 card, DECISIONS 889; CANON: the pet's quota
//! is the battery and the power bank too). The rows are plugin/hooks-source/quota.ts's `quotaBatteryRows` and
//! `quotaBankRows`, one character an art pixel, ported line for line; tests/quota_pixels.rs checks them against
//! tests/fixtures/quota-pixels.json, which tools/tests/quota-pixels.test.tsx checks against quota.ts.

use crate::render::Canvas;

const BOLT: [&str; 8] = ["...##", "..##.", ".##..", "#####", "..##.", ".##..", "##...", "#...."];

fn quarter_fill(left: f64, k: usize) -> f64 {
    ((left - 25. * k as f64) / 25.).clamp(0., 1.)
}

fn bolt_over(g: &mut [Vec<char>], x0: usize, y0: usize) {
    for (j, row) in BOLT.iter().enumerate() {
        let row: Vec<char> = row.chars().collect();
        for (i, ch) in row.iter().enumerate() {
            if *ch == '#' {
                g[y0 + j][x0 + i] = if row.get(i + 1) == Some(&'#') { 'Y' } else { 'y' };
            }
        }
    }
}

fn rows(g: Vec<Vec<char>>) -> Vec<String> {
    g.into_iter().map(|row| row.into_iter().collect()).collect()
}

/// The 5-hour battery's rows: `left` is the percent remaining.
pub fn battery(left: f64, waiting: bool) -> Vec<String> {
    let (w, h) = (26, 12);
    let mut g = vec![vec!['.'; w]; h];
    for y in 0..h {
        for x in 0..24 {
            let (dx, dy) = (x.min(23 - x), y.min(h - 1 - y));
            if dx == 0 && dy == 0 {
                continue;
            }
            g[y][x] = if dx == 0 || dy == 0 {
                'O'
            } else if y == 1 || x == 1 {
                'h'
            } else if y == h - 2 || x == 22 {
                's'
            } else {
                'i'
            };
        }
    }
    for row in g.iter_mut().take(9).skip(3) {
        row[24] = 'O';
    }
    for (y, row) in g.iter_mut().enumerate().take(8).skip(4) {
        row[25] = 'O';
        row[24] = if y < 6 { 'M' } else { 'N' };
    }
    let low = left <= 25.;
    let (top, mid, bot) = if low { ('r', 'R', 'q') } else { ('b', 'B', 'c') };
    for k in 0..4 {
        let f = quarter_fill(left, k);
        let filled_rows = if f > 0. { ((6. * f).round() as usize).max(1) } else { 0 };
        for (y, row) in g.iter_mut().enumerate().take(9).skip(3) {
            for cell in row.iter_mut().take(6 + 5 * k).skip(3 + 5 * k) {
                *cell = if y >= 9 - filled_rows {
                    if y == 9 - filled_rows {
                        top
                    } else if y == 8 {
                        bot
                    } else {
                        mid
                    }
                } else if y == 3 {
                    'e'
                } else {
                    'E'
                };
            }
        }
    }
    if waiting {
        bolt_over(&mut g, 10, 2);
    }
    rows(g)
}

/// The weekly power bank's rows: a light is lit when its quarter is two thirds there, half lit from a third, and
/// the first light is never dark while anything is left.
pub fn bank(left: f64, waiting: bool) -> Vec<String> {
    let (w, h) = (22, 12);
    let mut g = vec![vec!['.'; w]; h];
    for y in 0..h {
        for x in 0..w {
            let (dx, dy) = (x.min(w - 1 - x), y.min(h - 1 - y));
            if dx + dy < 2 {
                continue;
            }
            g[y][x] = if dx == 0 || dy == 0 || dx + dy == 2 {
                'O'
            } else if dy == 1 {
                if y < h / 2 { 'l' } else { 'k' }
            } else {
                'L'
            };
        }
    }
    for row in g.iter_mut().take(h - 2).skip(2) {
        if row[1] == 'L' {
            row[1] = 'l';
        }
    }
    for row in g.iter_mut().take(8).skip(4) {
        row[2] = 'M';
    }
    g[5][2] = 'Z';
    g[6][2] = 'Z';
    let low = left <= 25.;
    for k in 0..4 {
        let (f, x0) = (quarter_fill(left, k), 6 + 4 * k);
        let shown = f >= 1. / 3. || (k == 0 && left > 0.);
        let full = f >= 2. / 3.;
        for row in g.iter_mut().take(7).skip(4) {
            for cell in row.iter_mut().take(x0 + 3).skip(x0) {
                *cell = match (shown, full, low) {
                    (false, _, _) => 'D',
                    (true, true, true) => 'R',
                    (true, true, false) => 'G',
                    (true, false, true) => 'q',
                    (true, false, false) => 'B',
                };
            }
        }
        if shown && full {
            let glint = if low { 'r' } else { 'g' };
            g[5][x0 + 1] = glint;
            g[4][x0] = glint;
        }
    }
    if waiting {
        bolt_over(&mut g, 9, 2);
    }
    rows(g)
}

/// The picture for a window, as the band draws it: what is left of the window, and a spent one empty under the
/// bolt. Only the 5-hour and weekly windows have one.
pub fn for_window(kind: &str, used: Option<f64>) -> Option<Vec<String>> {
    let left = (100. - used?).max(0.);
    match kind {
        "five_hour" => Some(battery(left, left <= 0.)),
        "seven_day" => Some(bank(left, left <= 0.)),
        _ => None,
    }
}

/// quota.ts QUOTA_INK, the same colours by the same letters.
pub fn ink(ch: char) -> Option<[u8; 4]> {
    let hex: u32 = match ch {
        'O' => 0x5C2A1E,
        'h' => 0xFFFDF8,
        'i' => 0xF4ECE4,
        's' => 0xE0D1C6,
        'M' => 0xF2EEEA,
        'N' => 0xC9C2BC,
        'Z' => 0x2E2E35,
        'b' => 0x79B6E6,
        'B' => 0x3A86C8,
        'c' => 0x2A6399,
        'r' => 0xF2A587,
        'R' => 0xD97757,
        'q' => 0xAE5539,
        'e' => 0xA99282,
        'E' => 0xCBB8AA,
        'Y' => 0xD97757,
        'y' => 0xAE5539,
        'l' => 0x6A6A74,
        'L' => 0x45454D,
        'k' => 0x2E2E35,
        'D' => 0x222227,
        'g' => 0xF4FBFF,
        'G' => 0x79B6E6,
        _ => return None,
    };
    Some([(hex >> 16) as u8, (hex >> 8) as u8, hex as u8, 255])
}

/// quota.ts OUTLINE_ON_DARK: the outline on the picture's edge on a dark ground, as the pixel family lightens it.
pub const OUTLINE_ON_DARK: [u8; 4] = [0xA0, 0x7B, 0x6A, 255];

/// Under a system contrast theme the pictures take the system's two colours: the outline, the battery's cap, the
/// power bank's port, what is left and the bolt in its ink; the body and what is spent in its paper.
pub fn system_ink(ch: char) -> bool {
    matches!(ch, 'O' | 'M' | 'N' | 'Z' | 'b' | 'B' | 'c' | 'r' | 'R' | 'q' | 'G' | 'g' | 'Y' | 'y')
}

/// Draws `rows` with its top left at (`x`, `y`) points, one point an art pixel. `dark_ground` lightens the
/// outline where it meets the outside, as the band does on a dark ground; `system` is a contrast theme's
/// `(ink, paper)`.
pub fn draw(c: &mut Canvas, rows: &[String], x: f64, y: f64, scale: f64, dark_ground: bool, system: Option<([u8; 4], [u8; 4])>) {
    let grid: Vec<Vec<char>> = rows.iter().map(|row| row.chars().collect()).collect();
    let at = |gx: isize, gy: isize| -> char {
        if gy < 0 || gx < 0 {
            return '.';
        }
        grid.get(gy as usize).and_then(|row| row.get(gx as usize)).copied().unwrap_or('.')
    };
    for (gy, row) in grid.iter().enumerate() {
        for (gx, ch) in row.iter().enumerate() {
            let Some(mut color) = ink(*ch) else {
                continue;
            };
            if let Some((system_ink_colour, paper)) = system {
                fill_cell(c, x + gx as f64, y + gy as f64, scale, if system_ink(*ch) { system_ink_colour } else { paper });
                continue;
            }
            let (ix, iy) = (gx as isize, gy as isize);
            let outer = *ch == 'O'
                && [(1, 0), (-1, 0), (0, 1), (0, -1)].iter().any(|(dx, dy)| at(ix + dx, iy + dy) == '.');
            if outer && dark_ground {
                color = OUTLINE_ON_DARK;
            }
            fill_cell(c, x + gx as f64, y + gy as f64, scale, color);
        }
    }
}

/// One art pixel, snapped to device pixels so neighbouring cells meet without a seam.
fn fill_cell(c: &mut Canvas, x: f64, y: f64, scale: f64, color: [u8; 4]) {
    let (x0, y0) = ((x * scale).round() as i64, (y * scale).round() as i64);
    let (x1, y1) = (((x + 1.) * scale).round() as i64, ((y + 1.) * scale).round() as i64);
    for py in y0.max(0)..y1.min(c.height as i64) {
        for px in x0.max(0)..x1.min(c.width as i64) {
            let i = ((py as u32 * c.width + px as u32) * 4) as usize;
            c.pixels[i..i + 4].copy_from_slice(&color);
        }
    }
}
