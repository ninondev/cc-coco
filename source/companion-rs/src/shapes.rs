use crate::{render::Canvas, ui::Rect};
use tiny_skia::{FillRule, LineCap, LineJoin, Paint, Path, PathBuilder, Pixmap, Stroke, Transform};
pub(crate) fn path(b: Rect, r: f64, scale: f64) -> Option<Path> {
    let (x, y, w, h) = (
        b.x as f32 * scale as f32,
        b.y as f32 * scale as f32,
        b.width as f32 * scale as f32,
        b.height as f32 * scale as f32,
    );
    let r = (r as f32 * scale as f32).min(w / 2.).min(h / 2.).max(0.);
    if w <= 0. || h <= 0. {
        return None;
    }
    let k = 0.5522848 * r;
    let mut p = PathBuilder::new();
    p.move_to(x + r, y);
    p.line_to(x + w - r, y);
    p.cubic_to(x + w - r + k, y, x + w, y + r - k, x + w, y + r);
    p.line_to(x + w, y + h - r);
    p.cubic_to(x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h);
    p.line_to(x + r, y + h);
    p.cubic_to(x + r - k, y + h, x, y + h - r + k, x, y + h - r);
    p.line_to(x, y + r);
    p.cubic_to(x, y + r - k, x + r - k, y, x + r, y);
    p.close();
    p.finish()
}
fn paint(color: [u8; 4]) -> Paint<'static> {
    let mut p = Paint::default();
    p.set_color_rgba8(color[0], color[1], color[2], color[3]);
    p.anti_alias = true;
    p
}
pub fn rounded(c: &mut Canvas, b: Rect, r: f64, color: [u8; 4], scale: f64) {
    if let (Some(p), Some(mut pm)) = (path(b, r, scale), Pixmap::new(c.width, c.height)) {
        pm.fill_path(
            &p,
            &paint(color),
            FillRule::Winding,
            Transform::identity(),
            None,
        );
        crate::ui::blit(c, pm.data(), pm.width(), pm.height(), 0, 0);
    }
}
pub fn outline(c: &mut Canvas, b: Rect, r: f64, w: f64, color: [u8; 4], scale: f64) {
    let b = Rect {
        x: b.x + w / 2.,
        y: b.y + w / 2.,
        width: b.width - w,
        height: b.height - w,
    };
    if let (Some(p), Some(mut pm)) = (
        path(b, (r - w / 2.).max(0.), scale),
        Pixmap::new(c.width, c.height),
    ) {
        pm.stroke_path(
            &p,
            &paint(color),
            &Stroke {
                width: (w * scale) as f32,
                line_cap: LineCap::Round,
                line_join: LineJoin::Round,
                ..Default::default()
            },
            Transform::identity(),
            None,
        );
        crate::ui::blit(c, pm.data(), pm.width(), pm.height(), 0, 0);
    }
}
pub fn clip_rounded(c: &mut Canvas, b: Rect, r: f64, scale: f64) {
    if let (Some(p), Some(mut mask)) = (path(b, r, scale), Pixmap::new(c.width, c.height)) {
        mask.fill_path(
            &p,
            &paint([255; 4]),
            FillRule::Winding,
            Transform::identity(),
            None,
        );
        for (dst, src) in c
            .pixels
            .chunks_exact_mut(4)
            .zip(mask.data().chunks_exact(4))
        {
            for v in dst {
                *v = (*v as u32 * src[3] as u32 / 255) as u8;
            }
        }
    }
}
pub fn stroke_paths(
    c: &mut Canvas,
    paths: &[&[(f64, f64)]],
    width: f64,
    color: [u8; 4],
    scale: f64,
) {
    stroke_paths_with_cap(c, paths, width, color, scale, LineCap::Round);
}
pub fn stroke_paths_with_cap(
    c: &mut Canvas,
    paths: &[&[(f64, f64)]],
    width: f64,
    color: [u8; 4],
    scale: f64,
    cap: LineCap,
) {
    let Some(mut pm) = Pixmap::new(c.width, c.height) else {
        return;
    };
    stroke_pixmap(&mut pm, paths, width, color, 1., scale, cap);
    crate::ui::blit(c, pm.data(), pm.width(), pm.height(), 0, 0);
}
pub(crate) fn stroke_pixmap(
    pm: &mut Pixmap,
    paths: &[&[(f64, f64)]],
    width: f64,
    color: [u8; 4],
    opacity: f64,
    scale: f64,
    cap: LineCap,
) {
    if opacity != 1. {
        let Some(mut layer) = Pixmap::new(pm.width(), pm.height()) else {
            return;
        };
        stroke_pixmap(&mut layer, paths, width, color, 1., scale, cap);
        pm.draw_pixmap(
            0,
            0,
            layer.as_ref(),
            &tiny_skia::PixmapPaint {
                opacity: opacity as f32,
                ..Default::default()
            },
            Transform::identity(),
            None,
        );
        return;
    }
    for points in paths {
        let Some(&(x, y)) = points.first() else {
            continue;
        };
        let mut b = PathBuilder::new();
        b.move_to((x * scale) as f32, (y * scale) as f32);
        for &(x, y) in &points[1..] {
            b.line_to((x * scale) as f32, (y * scale) as f32);
        }
        if let Some(p) = b.finish() {
            let mut ink = paint(color);
            ink.set_color(
                tiny_skia::Color::from_rgba(
                    color[0] as f32 / 255.,
                    color[1] as f32 / 255.,
                    color[2] as f32 / 255.,
                    (color[3] as f64 / 255. * opacity) as f32,
                )
                .unwrap(),
            );
            pm.stroke_path(
                &p,
                &ink,
                &Stroke {
                    width: (width * scale) as f32,
                    line_cap: cap,
                    line_join: LineJoin::Round,
                    ..Default::default()
                },
                Transform::identity(),
                None,
            );
        }
    }
}

pub fn spark(c: &mut Canvas, x: f64, y: f64, scale: f64) {
    let accent = c.look.accent();
    spark_color(c, x, y, scale, accent);
}
pub fn spark_color(c: &mut Canvas, x: f64, y: f64, scale: f64, color: [u8; 4]) {
    let mut lines = Vec::new();
    for theta in [0., 45., 90., 135.] {
        let a = theta * std::f64::consts::PI / 180.;
        let (dx, dy) = (4.5 * a.cos(), 4.5 * a.sin());
        lines.push([(x - dx, y - dy), (x + dx, y + dy)]);
    }
    let refs = lines.iter().map(|l| l.as_slice()).collect::<Vec<_>>();
    stroke_paths(c, &refs, 1.5, color, scale);
}
pub fn shadow(c: &mut Canvas, b: Rect, r: f64, scale: f64, dy: f64, blur: f64, opacity: f64) {
    let Some(mut mask) = Pixmap::new(c.width, c.height) else {
        return;
    };
    let shifted = Rect { y: b.y + dy, ..b };
    let Some(p) = path(shifted, r, scale) else {
        return;
    };
    mask.fill_path(
        &p,
        &paint([255; 4]),
        FillRule::Winding,
        Transform::identity(),
        None,
    );
    let sigma = (blur * scale / 2.).max(0.5);
    let radius = (sigma * 3.).ceil() as i32;
    let mut kernel = (-radius..=radius)
        .map(|i| (-(i as f64).powi(2) / (2. * sigma * sigma)).exp())
        .collect::<Vec<_>>();
    let sum = kernel.iter().sum::<f64>();
    for k in &mut kernel {
        *k /= sum;
    }
    let (w, h) = (c.width as usize, c.height as usize);
    let mut temp = vec![0f32; w * h];
    let x0 = ((b.x * scale - radius as f64).floor().max(0.) as usize).min(w);
    let x1 = (((b.x + b.width) * scale + radius as f64).ceil().max(0.) as usize).min(w);
    let y0 = (((b.y + dy) * scale - radius as f64).floor().max(0.) as usize).min(h);
    let y1 = (((b.y + dy + b.height) * scale + radius as f64)
        .ceil()
        .max(0.) as usize)
        .min(h);
    for y in y0..y1 {
        for x in x0..x1 {
            let mut a = 0.;
            for (i, k) in kernel.iter().enumerate() {
                let sx = x as i32 + i as i32 - radius;
                if sx >= 0 && (sx as usize) < w {
                    a += mask.data()[(y * w + sx as usize) * 4 + 3] as f64 * k;
                }
            }
            temp[y * w + x] = a as f32;
        }
    }
    for y in y0..y1 {
        for x in x0..x1 {
            let mut a = 0.;
            for (i, k) in kernel.iter().enumerate() {
                let sy = y as i32 + i as i32 - radius;
                if sy >= 0 && (sy as usize) < h {
                    a += temp[sy as usize * w + x] as f64 * k;
                }
            }
            let a = (a * opacity).round() as u32;
            let p = &mut c.pixels[(y * w + x) * 4..][..4];
            for v in p.iter_mut().take(3) {
                *v = (*v as u32 * (255 - a) / 255) as u8;
            }
            p[3] = (a + p[3] as u32 * (255 - a) / 255) as u8;
        }
    }
}
/// The book's near-black cloth (#1A1918), for what he carries: the task pill, the hover row and its label. On a dark
/// desktop a faint edge (the cloth's text colour at 16 percent) keeps its shape against the wallpaper; with high
/// contrast the edge is solid.
pub const COVER: [u8; 4] = [26, 25, 24, 255];
pub const COVER_INK: [u8; 4] = [239, 237, 231, 255];
/// The cover's ink: the cloth's light ink, or the system's own text colour in a Windows contrast theme.
pub fn cover_ink(c: &Canvas) -> [u8; 4] {
    if c.look.is_system() { c.look.ink(false) } else { COVER_INK }
}
/// His cover under the task pill and the hover row. A Windows contrast theme keeps the system's own colours (the panel
/// as before); his strengthened paper gets a solid edge in the cloth's ink; a dark desktop gets the faint edge.
pub fn cover_shape(c: &mut Canvas, b: Rect, r: f64, scale: f64) {
    if c.look.is_system() {
        let fill = c.look.panel_fill(c.paper_dark);
        paper_shape(c, b, r, fill, scale, false);
        return;
    }
    shadow(c, b, r, scale, 2., 8., 0.18);
    rounded(c, b, r, COVER, scale);
    if matches!(c.look, crate::contrast::Look::Paper) {
        outline(c, b, r, 1., COVER_INK, scale);
    } else if c.paper_dark {
        outline(c, b, r, 1., [COVER_INK[0], COVER_INK[1], COVER_INK[2], 41], scale);
    }
}
pub fn paper_shape(c: &mut Canvas, b: Rect, r: f64, color: [u8; 4], scale: f64, activity: bool) {
    if c.look.shadow() {
        shadow(
            c,
            b,
            r,
            scale,
            if activity { 10. } else { 2. },
            if activity { 30. } else { 8. },
            if activity { 0.25 } else { 0.18 },
        );
    }
    let color = c.look.palette().map_or(color, |p| p.window);
    rounded(c, b, r, color, scale);
    let (width, edge) = c.look.panel_edge(c.paper_dark);
    outline(c, b, r, width, edge, scale);
}
