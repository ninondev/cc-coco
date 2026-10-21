//! The companion's visitor (design VISITORS.md 3 and 5): painted sizes show it arriving and taking off,
//! the pixel sizes only cut, every kind sits on his frame, and nothing is drawn without its art.
use coco_companion::{
    decor::{DecorAssets, Visitor},
    engine::Engine,
    feed::Record,
    render::{Canvas, Size},
    Options,
};
use std::path::PathBuf;

const KINDS: [&str; 9] = [
    "plane",
    "bulb",
    "leaf",
    "snowman",
    "usb",
    "note",
    "ghost",
    "keycap",
    "cursor",
];

fn assets() -> DecorAssets {
    DecorAssets::load(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("assets")).unwrap()
}
fn visitor(kind: &str, at: u64) -> Visitor {
    Visitor {
        id: format!("v-{kind}"),
        kind: kind.into(),
        at,
        left_at: None,
        label: None,
    }
}
/// A canvas with his frame in the middle: the painted 151 x 128 frame at 0.75 px per frame pixel, or the pixel 35 x 32 at 2.
fn scene(size: Size) -> Canvas {
    let mut c = Canvas::blank(360, 320);
    let (w, h) = if size.pixel() { (70, 64) } else { (113, 96) };
    c.sprite_bounds = (100, 100, w, h);
    c
}
fn drawn(c: &Canvas) -> usize {
    c.pixels.chunks_exact(4).filter(|p| p[3] > 0).count()
}
fn inside(c: &Canvas, x: i32, y: i32, w: u32, h: u32, slack: i32) -> bool {
    c.pixels.chunks_exact(4).enumerate().all(|(i, p)| {
        if p[3] == 0 {
            return true;
        }
        let (px, py) = ((i % c.width as usize) as i32, (i / c.width as usize) as i32);
        px >= x - slack && px < x + w as i32 + slack && py >= y - slack && py < y + h as i32 + slack
    })
}

#[test]
fn every_kind_sits_on_his_frame_in_both_families() {
    let d = assets();
    for size in Size::ALL {
        for kind in KINDS {
            assert!(d.has_visitor(kind), "{kind} has its art");
            let mut c = scene(size);
            d.visitor(
                &mut c,
                &visitor(kind, 1000),
                5000,
                true,
                size,
                1.,
                false,
                false,
            );
            assert!(drawn(&c) > 20, "{kind} at {size:?} is drawn");
            let (x, y, w, h) = c.sprite_bounds;
            // The bulb and the ghost sit on his head and stick out by design; nothing strays far.
            assert!(
                inside(&c, x, y, w, h, 30),
                "{kind} at {size:?} stays near his frame"
            );
        }
    }
}

#[test]
fn the_dark_ground_variant_is_a_different_drawing() {
    let d = assets();
    for kind in KINDS {
        let (mut light, mut dark) = (scene(Size::Medium), scene(Size::Medium));
        d.visitor(
            &mut light,
            &visitor(kind, 1000),
            5000,
            true,
            Size::Medium,
            1.,
            false,
            false,
        );
        d.visitor(
            &mut dark,
            &visitor(kind, 1000),
            5000,
            true,
            Size::Medium,
            1.,
            true,
            false,
        );
        assert_ne!(
            light.pixels, dark.pixels,
            "{kind}: light and dark grounds differ"
        );
    }
}

#[test]
fn only_the_usb_light_carries_a_light_and_only_on_a_dark_ground() {
    let d = assets();
    let (mut light, mut dark) = (scene(Size::Medium), scene(Size::Medium));
    d.visitor(
        &mut light,
        &visitor("usb", 1000),
        5000,
        true,
        Size::Medium,
        1.,
        false,
        false,
    );
    d.visitor(
        &mut dark,
        &visitor("usb", 1000),
        5000,
        true,
        Size::Medium,
        1.,
        true,
        false,
    );
    assert!(
        drawn(&dark) > drawn(&light) * 2,
        "the glow is a wide soft disc, more than twice the stick itself"
    );
    let (mut a, mut b) = (scene(Size::Medium), scene(Size::Medium));
    d.visitor(
        &mut a,
        &visitor("plane", 1000),
        5000,
        true,
        Size::Medium,
        1.,
        true,
        false,
    );
    d.visitor(
        &mut b,
        &visitor("plane", 1000),
        5000,
        true,
        Size::Medium,
        1.,
        false,
        false,
    );
    assert!(drawn(&a).abs_diff(drawn(&b)) < 8);
}

#[test]
fn painted_sizes_arrive_and_take_off_but_pixel_sizes_only_cut() {
    let d = assets();
    let mut v = visitor("bulb", 1000);
    let at = |size: Size, now: u64, v: &Visitor, reduced: bool| {
        let mut c = scene(size);
        d.visitor(&mut c, v, now, true, size, 1., false, reduced);
        c
    };
    // Painted: before the arrival nothing, midway something fainter than at rest, then the same as at rest.
    assert_eq!(drawn(&at(Size::Large, 999, &v, false)), 0);
    let rest = at(Size::Large, 5000, &v, false);
    let mid = at(Size::Large, 1100, &v, false);
    assert_ne!(mid.pixels, rest.pixels);
    assert_eq!(
        at(Size::Large, 1360, &v, false).pixels.len(),
        rest.pixels.len()
    );
    assert_eq!(at(Size::Large, 1360, &v, false).pixels, rest.pixels);
    // Taking off.
    v.left_at = Some(6000);
    let leaving = at(Size::Large, 6200, &v, false);
    assert!(drawn(&leaving) > 0 && leaving.pixels != rest.pixels);
    assert_eq!(drawn(&at(Size::Large, 6450, &v, false)), 0);
}

#[test]
fn reduced_motion_changes_opacity_only_over_200ms() {
    let d = assets();
    let v = Visitor {
        left_at: Some(6000),
        ..visitor("leaf", 1000)
    };
    let shot = |now: u64, reduced: bool| {
        let mut c = scene(Size::Medium);
        d.visitor(&mut c, &v, now, true, Size::Medium, 1., false, reduced);
        c
    };
    let bounds = |c: &Canvas| {
        let mut rows = c
            .pixels
            .chunks_exact(c.width as usize * 4)
            .enumerate()
            .filter(|(_, r)| r.chunks_exact(4).any(|p| p[3] > 0))
            .map(|(y, _)| y);
        let first = rows.next().unwrap();
        (first, rows.last().unwrap_or(first))
    };
    // Same rows at every instant (nothing moves), fading in and out.
    let (rest, early, late) = (shot(3000, true), shot(1050, true), shot(6100, true));
    assert_eq!(bounds(&rest), bounds(&early));
    assert_eq!(bounds(&rest), bounds(&late));
    assert_eq!(shot(1200, true).pixels, rest.pixels);
    assert_eq!(drawn(&shot(6200, true)), 0);
    // Under motion the visitor rises while it leaves.
    assert!(bounds(&shot(6200, false)).0 < bounds(&rest).0);
}

#[test]
fn nothing_is_drawn_without_art_or_when_he_is_awake() {
    let d = assets();
    let mut c = scene(Size::Medium);
    d.visitor(
        &mut c,
        &visitor("owl", 1000),
        5000,
        true,
        Size::Medium,
        1.,
        false,
        false,
    );
    d.visitor(
        &mut c,
        &visitor("../plane", 1000),
        5000,
        true,
        Size::Medium,
        1.,
        false,
        false,
    );
    d.visitor(
        &mut c,
        &visitor("plane", 1000),
        5000,
        false,
        Size::Medium,
        1.,
        false,
        false,
    );
    assert_eq!(drawn(&c), 0);
    // A visitor that has left still takes off after he is awake.
    let gone = Visitor {
        left_at: Some(5000),
        ..visitor("plane", 1000)
    };
    d.visitor(&mut c, &gone, 5100, false, Size::Medium, 1., false, false);
    assert!(drawn(&c) > 0);
}

#[test]
fn the_record_reads_a_visitor_and_ignores_a_broken_one() {
    let parse = |extra: &str| {
        Record::parse(
            format!(r#"{{"v":1,"session":"s","at":1000,"mood":"sleep"{extra}}}"#).as_bytes(),
        )
    };
    let ok =
        parse(r#","visitor":{"id":"7","kind":"plane","at":1000,"label":"A plane sits with him"}"#)
            .unwrap();
    let v = ok.visitor.expect("a visitor");
    assert_eq!((v.kind.as_str(), v.at, v.left_at), ("plane", 1000, None));
    assert_eq!(v.label.as_deref(), Some("A plane sits with him"));
    let left = parse(r#","visitor":{"id":"7","kind":"plane","at":1000,"leftAt":2000}"#).unwrap();
    assert_eq!(left.visitor.unwrap().left_at, Some(2000));
    assert!(parse(r#","visitor":{"kind":3}"#).unwrap().visitor.is_none());
    assert!(parse("").unwrap().visitor.is_none());
}

#[test]
fn a_resting_visitor_costs_no_timer_and_a_move_ticks_by_frame() {
    let v = visitor("note", 1000);
    let painted = |now| v.next_deadline(now, true, false, false);
    assert_eq!(painted(500), Some(1000));
    assert_eq!(painted(1000), Some(1016));
    assert_eq!(
        painted(1355),
        Some(1360),
        "the last tick lands on the end of the arrival"
    );
    assert_eq!(painted(1360), None, "sitting needs no timer");
    assert_eq!(
        v.next_deadline(1000, true, true, false),
        None,
        "the pixel visitor is a cut"
    );
    let left = Visitor {
        left_at: Some(5000),
        ..v
    };
    assert_eq!(left.next_deadline(4000, true, false, false), Some(5000));
    assert_eq!(left.next_deadline(5000, false, false, false), Some(5016));
    assert_eq!(left.next_deadline(5450, false, false, false), None);
    assert_eq!(
        left.next_deadline(5000, false, true, false),
        None,
        "the pixel visitor's leaving is a cut"
    );
}

struct Scratch(PathBuf);
impl Scratch {
    fn new() -> Self {
        use std::sync::atomic::{AtomicU64, Ordering};
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let root = std::env::temp_dir().join(format!(
            "companion-visitors-{}-{}-{}",
            std::process::id(),
            coco_companion::epoch_ms(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(root.join("companion")).unwrap();
        Self(root)
    }
    fn options(&self, size: Size) -> Options {
        Options {
            folder: self.0.join("companion"),
            presence_folder: None,
            assets: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../assets"),
            size,
            reduce_motion: false,
            follow_class: None,
            trace: false,
            login: false,
        }
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
fn sleeping(visitor: Option<Visitor>) -> Record {
    let mut record = Record::resting();
    record.session = "test".into();
    record.at = 1000.;
    record.mood = "sleep".into();
    record.frame = "sleep".into();
    record.reactions.clear();
    record.visitor = visitor;
    record
}

#[test]
fn the_engine_draws_him_with_and_without_the_visitor_on_both_families() {
    for size in Size::ALL {
        let (bare, with) = {
            let scratch = Scratch::new();
            let mut engine = Engine::new(scratch.options(size), 1000, 42).unwrap();
            engine.preview_record(sleeping(None), 1000);
            let bare = engine.render(9000, 1.0);
            engine.preview_record(sleeping(Some(visitor("ghost", 1000))), 1000);
            (bare, engine.render(9000, 1.0))
        };
        assert_eq!((bare.width, bare.height), (with.width, with.height));
        assert_ne!(bare.pixels, with.pixels, "{size:?}: the visitor shows");
    }
}

#[test]
fn the_engine_ticks_while_a_visitor_moves_and_then_holds_still() {
    let scratch = Scratch::new();
    let mut engine = Engine::new(scratch.options(Size::Medium), 1000, 42).unwrap();
    engine.preview_record(sleeping(Some(visitor("keycap", 8000))), 8000);
    engine.render(8100, 1.0);
    assert_eq!(engine.next_deadline_ms(8100), Some(8116));
    engine.render(8400, 1.0);
    let after = engine.next_deadline_ms(8400);
    assert!(
        after.is_none_or(|at| at > 8416),
        "a sitting visitor leaves no frame timer: {after:?}"
    );
}

#[test]
fn the_accessibility_tree_names_a_sitting_visitor_only_while_it_sits() {
    let ui = coco_companion::ui::UiState::default();
    let labels = |record: &Record| {
        coco_companion::accessibility::tree(&ui, record)
            .nodes
            .iter()
            .filter_map(|(_, node)| node.label().map(str::to_owned))
            .collect::<Vec<_>>()
    };
    let phrase = "A plane sits with him";
    let mut record = sleeping(Some(Visitor {
        label: Some(phrase.into()),
        ..visitor("plane", 1000)
    }));
    assert_eq!(labels(&record).iter().filter(|l| *l == phrase).count(), 1);
    // The phrase arrives with the art and the words; without it nothing is announced.
    record.visitor.as_mut().unwrap().label = None;
    assert!(!labels(&record).iter().any(|l| l.contains("plane")));
    record.visitor.as_mut().unwrap().label = Some(phrase.into());
    record.visitor.as_mut().unwrap().left_at = Some(2000);
    assert!(!labels(&record).iter().any(|l| l == phrase), "it has left");
    record.visitor.as_mut().unwrap().left_at = None;
    record.mood = "idle".into();
    assert!(!labels(&record).iter().any(|l| l == phrase), "he is awake");
}

/// A canvas with Coco's 234 x 241 picture at one pixel per canvas unit.
fn coco_scene() -> Canvas {
    let mut c = Canvas::blank(440, 380);
    c.sprite_bounds = (80, 60, 234, 241);
    c
}
fn left_edge(c: &Canvas) -> usize {
    c.pixels
        .chunks_exact(4)
        .enumerate()
        .filter(|(_, p)| p[3] > 0)
        .map(|(i, _)| i % c.width as usize)
        .min()
        .unwrap_or(usize::MAX)
}

#[test]
fn on_coco_every_kind_sits_on_their_figure_the_same_at_every_size() {
    let d = assets();
    for kind in KINDS {
        let mut drawn_at = Vec::new();
        for size in Size::ALL {
            let mut c = coco_scene();
            d.visitor_on_coco(
                &mut c,
                &visitor(kind, 1000),
                5000,
                true,
                size,
                1.,
                false,
                false,
            );
            assert!(drawn(&c) > 20, "{kind} at {size:?} is drawn on Coco");
            if kind == "note" {
                // the note moves across to the mug's right wall
                assert!(
                    left_edge(&c) >= 80 + 150,
                    "the note sits right of their figure"
                );
            } else {
                // his old frame (0,0)-(151,128) lands at (16.4,32)-(235.4,217.6) of their canvas
                assert!(
                    inside(&c, 80 + 16, 60 + 32, 220, 186, 30),
                    "{kind} at {size:?} stays near their figure"
                );
            }
            drawn_at.push(c.pixels);
        }
        assert_eq!(
            drawn_at[0], drawn_at[1],
            "{kind}: on Coco the small sizes draw the painted visitor too"
        );
    }
}
