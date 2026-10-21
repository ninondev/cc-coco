use coco_companion::{
    decor::{DecorAssets, NeighbourLight},
    engine::Engine,
    render::{Canvas, Face, Frames, Gesture, Size},
    ui::Control,
    Options,
};
use std::path::PathBuf;

fn assets() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../assets")
}

struct Scratch(PathBuf);
impl Scratch {
    fn new() -> Self {
        use std::sync::atomic::{AtomicU64, Ordering};
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let root = std::env::temp_dir().join(format!(
            "companion-r4-geometry-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(root.join("companion")).unwrap();
        Self(root)
    }
    fn engine(&self) -> Engine {
        Engine::new(
            Options {
                folder: self.0.join("companion"),
                presence_folder: Some(self.0.join("presence")),
                assets: assets(),
                size: Size::Medium,
                reduce_motion: true,
                follow_class: None,
                trace: false,
                login: false,
            },
            1000,
            42,
        )
        .unwrap()
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Her idle pose at rest: the reduced-motion engine's first draw holds nothing else, so its canvas is it.
fn idle_canvas(companion: &Canvas) -> Canvas {
    companion.clone()
}

fn alpha(c: &Canvas, x: u32, y: u32) -> u8 {
    c.pixels[((y * c.width + x) * 4 + 3) as usize]
}

fn rect(r: coco_companion::ui::Rect) -> (f64, f64, f64, f64) {
    (r.x, r.y, r.width, r.height)
}

#[test]
fn hover_pill_clears_actual_idle_ink_by_two_points_at_every_size_and_scale() {
    let scratch = Scratch::new();
    let mut engine = scratch.engine();
    for size in Size::ALL {
        engine.set_size(size);
        for scale in [1., 1.25, 2., 3.] {
            let companion = engine.render_companion_without_hover(1000, scale);
            let idle = idle_canvas(&companion);
            let top = (0..idle.height)
                .find(|y| (0..idle.width).any(|x| alpha(&idle, x, *y) > 0))
                .unwrap() as f64 / scale;
            engine.ui.hover_visible = true;
            let pill = engine.ui.hover_bounds();
            assert!(
                (top - pill.y - pill.height - 2.).abs() < 1e-6,
                "{size:?} {scale}: idle top {top}, pill {pill:?}"
            );
            for e in engine.ui.elements() {
                if matches!(e.control, Control::Hover(_)) {
                    assert_eq!(e.bounds.y, pill.y + 4.);
                    assert!(e.bounds.y + e.bounds.height <= pill.y + pill.height);
                }
            }
        }
    }
}

#[test]
fn unseen_badge_center_touches_idle_hair_and_stays_below_the_hover_pill() {
    let scratch = Scratch::new();
    let mut engine = scratch.engine();
    for size in Size::ALL {
        engine.set_size(size);
        for scale in [1., 1.25, 2., 3.] {
            let companion = engine.render_companion_without_hover(1000, scale);
            let idle = idle_canvas(&companion);
            for unseen in [1, 9, 10] {
                engine.ui.unseen = unseen;
                engine.ui.hover_visible = false;
                let resting = engine.ui.badge_bounds();
                engine.ui.hover_visible = true;
                let badge = engine.ui.badge_bounds();
                let pill = engine.ui.hover_bounds();
                let x = ((badge.x + badge.width / 2.) * scale).floor() as u32;
                let y = ((badge.y + badge.height / 2.) * scale).floor() as u32;
                assert!(alpha(&idle, x, y) > 0, "{size:?} {scale}: {badge:?} floats off his hair");
                assert!(badge.y >= pill.y + pill.height, "badge {badge:?} covers pill {pill:?}");
                assert_eq!(rect(resting), rect(badge));
                let live = engine.ui.elements().into_iter().find(|e| e.control == Control::Badge).unwrap();
                assert_eq!(rect(live.bounds), rect(badge));
            }
        }
    }
}

fn lantern_columns(c: &Canvas) -> Vec<(u32, u32)> {
    let mut spans = Vec::new();
    let mut start = None;
    for x in 0..=c.width {
        let ink = x < c.width && (0..c.height).any(|y| alpha(c, x, y) > 0);
        match (start, ink) {
            (None, true) => start = Some(x),
            (Some(a), false) => {
                spans.push((a, x));
                start = None;
            }
            _ => {}
        }
    }
    spans
}

#[test]
fn one_lantern_stands_beside_him_however_many_neighbours_are_busy() {
    let decor = DecorAssets::load(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("assets")).unwrap();
    let lights = (0..3).map(|i| NeighbourLight {
        id: i.to_string(), busy: true, at: 0, ..Default::default()
    }).collect::<Vec<_>>();
    for left in [false, true] {
        for scale in [1_f64, 2.] {
            let mut c = Canvas::blank((720. * scale) as u32, (420. * scale) as u32);
            c.sprite_bounds = ((280. * scale) as i32, (180. * scale) as i32,
                (114. * scale) as u32, (96. * scale) as u32);
            c.input_rect((320. * scale) as i32, (180. * scale) as i32,
                (30. * scale) as u32, (96. * scale) as u32);
            decor.neighbours(&mut c, &lights, 1000, Size::Medium, scale, false, true, left, true);
            let spans = lantern_columns(&c);
            assert_eq!(spans.len(), 1, "{left} {scale}: {spans:?}");
            let (start, end) = spans[0];
            if left {
                assert!(end as f64 <= 320. * scale, "{left} {scale}: {spans:?} overlaps him");
            } else {
                assert!(start as f64 >= 350. * scale, "{left} {scale}: {spans:?} overlaps him");
            }
        }
    }
}

#[test]
fn shipped_frame_draws_one_lantern_on_both_sides() {
    let decor = DecorAssets::load(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("assets")).unwrap();
    let mut frames = Frames::load(&assets()).unwrap();
    let lights = (0..3).map(|i| NeighbourLight {
        id: i.to_string(), busy: true, at: 0, ..Default::default()
    }).collect::<Vec<_>>();
    for size in Size::ALL {
        for scale in [1_f64, 2.] {
            for left in [false, true] {
                let mut c = Canvas::blank((720. * scale) as u32, (420. * scale) as u32);
                frames.draw(&mut c, "idle-reading", Face::Open, size, scale, Gesture::default());
                c.pixels.fill(0);
                decor.neighbours(&mut c, &lights, 1000, size, scale, false, true, left, true);
                let spans = lantern_columns(&c);
                assert_eq!(spans.len(), 1, "{size:?} {scale} {left}: {spans:?}");
            }
        }
    }
}
