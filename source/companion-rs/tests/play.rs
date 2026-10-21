// Play on the companion: shake and spin, the lid nap, and his stick.
use coco_companion::{
    engine::Engine,
    feed::Record,
    render::Size,
    shake::{spin_sample, Nap, ShakeDetector, HALF_TURNS, SPIN_MS},
    stick, Options,
};
use serde_json::json;
use std::path::PathBuf;

struct Scratch {
    root: PathBuf,
}
impl Scratch {
    fn new() -> Self {
        use std::sync::atomic::{AtomicU64, Ordering};
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let root = std::env::temp_dir().join(format!(
            "companion-play-{}-{}-{}",
            std::process::id(),
            coco_companion::epoch_ms(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(root.join("companion")).unwrap();
        Self { root }
    }
    fn options(&self, reduce_motion: bool) -> Options {
        Options {
            folder: self.root.join("companion"),
            presence_folder: Some(self.root.join("presence")),
            assets: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../assets"),
            size: Size::Medium,
            reduce_motion,
            follow_class: None,
            trace: false,
            login: false,
        }
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn zigzag(detector: &mut ShakeDetector, swing: f64, steps: usize, gap: u64, start: u64) -> Option<usize> {
    let mut x = 0.0;
    detector.feed([x, 0.0], start);
    for step in 1..=steps {
        x = if step % 2 == 1 { swing } else { 0.0 };
        if detector.feed([x, 0.0], start + step as u64 * gap) {
            return Some(step);
        }
    }
    None
}

#[test]
fn three_swings_of_twenty_points_inside_800_ms_are_a_shake_once_per_carry() {
    let mut detector = ShakeDetector::default();
    // The first swing sets the direction; reversals three, four and five of the zigzag count.
    assert_eq!(zigzag(&mut detector, 25.0, 6, 100, 1000), Some(4));
    assert!(!detector.feed([25.0, 0.0], 2000), "once per carry");
    detector.reset();
    assert_eq!(zigzag(&mut detector, 25.0, 6, 100, 5000), Some(4));
}

#[test]
fn a_drag_that_only_travels_or_swings_too_small_or_too_slowly_is_not_a_shake() {
    let mut travel = ShakeDetector::default();
    assert!((0..200).all(|i| !travel.feed([i as f64 * 5.0, i as f64], 1000 + i * 10)));
    let mut small = ShakeDetector::default();
    assert_eq!(zigzag(&mut small, 15.0, 40, 50, 1000), None);
    let mut slow = ShakeDetector::default();
    assert_eq!(zigzag(&mut slow, 25.0, 12, 600, 1000), None);
    let mut two = ShakeDetector::default();
    assert_eq!(zigzag(&mut two, 25.0, 3, 100, 1000), None);
}

#[test]
fn a_shake_on_the_vertical_axis_counts_too() {
    let mut detector = ShakeDetector::default();
    detector.feed([0.0, 0.0], 0);
    let fired = (1..=6).any(|i| detector.feed([3.0, if i % 2 == 1 { 30.0 } else { 0.0 }], i * 90));
    assert!(fired);
}

#[test]
fn the_spin_is_four_half_turns_that_narrow_to_an_edge_and_end_on_his_front() {
    assert_eq!(HALF_TURNS.iter().sum::<f64>(), SPIN_MS);
    let mut start = 0.0;
    let mut previous_back = false;
    for (index, length) in HALF_TURNS.iter().enumerate() {
        let edge = spin_sample(start + length / 2.0 - 0.001, true, true);
        assert!(edge.sx < 0.07, "half-turn {index} narrows to an edge: {}", edge.sx);
        let before = spin_sample(start + length * 0.1, true, true);
        let after = spin_sample(start + length * 0.9, true, true);
        assert!(before.sx > 0.6 && after.sx > 0.6);
        assert_ne!(before.frame, after.frame, "the picture changes at the edge");
        assert_eq!(before.frame == "spin-back", previous_back);
        previous_back = after.frame == "spin-back";
        start += length;
    }
    assert_eq!(spin_sample(SPIN_MS + 1.0, true, true).frame, "dizzy");
    assert_eq!(spin_sample(10.0, false, false).frame, "flustered", "flustered stands in until the back is drawn");
    assert_eq!(spin_sample(SPIN_MS - 1.0, false, false).frame, "flustered");
}

#[test]
fn the_dizzy_sway_is_three_slowing_tilts_of_3_5_2_and_1_degrees() {
    let largest = |from: f64, to: f64| {
        (0..200)
            .map(|i| spin_sample(SPIN_MS + from + (to - from) * i as f64 / 200.0, false, false).skew.abs())
            .fold(0.0, f64::max)
    };
    let third = 1300.0 / 3.0;
    let (a, b, c) = (largest(0.0, third), largest(third, 2.0 * third), largest(2.0 * third, 3.0 * third));
    assert!((a - 3.5f64.to_radians().tan()).abs() < 5e-4);
    assert!((b - 2.0f64.to_radians().tan()).abs() < 5e-4);
    assert!((c - 1.0f64.to_radians().tan()).abs() < 5e-4);
}

fn shaken_record() -> Record {
    let mut record = Record::resting();
    record.reactions.insert("shaken".into(), vec!["dizzy".into()]);
    record
}
fn shake(engine: &mut Engine, now: u64) {
    engine.geometry_begin([0.0, 0.0], now);
    for step in 1..=6u64 {
        let x = if step % 2 == 1 { 25.0 } else { 0.0 };
        engine.geometry_event([x, 0.0], now + step * 100);
    }
}

#[test]
fn a_shake_spins_him_then_he_is_dizzy_with_a_line_from_the_shaken_pool() {
    let scratch = Scratch::new();
    let mut engine = Engine::new(scratch.options(false), 1000, 42).unwrap();
    engine.preview_record(shaken_record(), 1000);
    shake(&mut engine, 2000);
    let began = 2000 + 400;
    let narrow = (0..200).map(|i| engine.visual(began + 5 + i * 5).2.sx).fold(1.0, f64::min);
    assert!(narrow < 0.1, "he narrows to an edge during the spin: {narrow}");
    assert_eq!(engine.visual(began + 5).0, "flustered");
    assert_eq!(engine.current_line(began + 500), None, "the line waits for the dizzy beat");
    assert_eq!(engine.current_line(began + 1100).as_deref(), Some("dizzy"));
    assert!(engine.visual(began + 1100).2.skew.abs() > 0.0);
    assert_eq!(engine.visual(began + 2400).0, "idle-reading", "the spin is over");
    // Nothing is pending long after it ends.
    assert!(engine.render(began + 8000, 1.0).width > 0);
}

#[test]
fn a_second_shake_inside_eight_seconds_only_holds_his_book_tight() {
    let scratch = Scratch::new();
    let mut engine = Engine::new(scratch.options(false), 1000, 42).unwrap();
    engine.preview_record(shaken_record(), 1000);
    shake(&mut engine, 2000);
    engine.geometry_end(3000);
    shake(&mut engine, 5000);
    let (name, _, gesture) = engine.visual(5700);
    assert_eq!(name, "refuse");
    assert_eq!(gesture.sx, 1.0);
    assert_eq!(engine.current_line(5700), None);
    // He holds it until he is let go.
    assert_eq!(engine.visual(20_000).0, "refuse");
    // Eight seconds later a shake spins him again.
    engine.geometry_end(21_000);
    shake(&mut engine, 30_000);
    assert_eq!(engine.visual(30_405).0, "flustered");
}

#[test]
fn with_reduce_motion_there_is_no_spin_only_the_flustered_cut_and_the_line() {
    let scratch = Scratch::new();
    let mut engine = Engine::new(scratch.options(true), 1000, 42).unwrap();
    engine.preview_record(shaken_record(), 1000);
    shake(&mut engine, 2000);
    let began = 2400;
    for offset in [5, 100, 300, 800, 1100] {
        let (name, _, gesture) = engine.visual(began + offset);
        assert_eq!(name, "flustered");
        assert_eq!(gesture.sx, 1.0);
        assert_eq!(gesture.skew, 0.0);
    }
    assert_eq!(engine.current_line(began + 10).as_deref(), Some("dizzy"));
}

#[test]
fn the_lid_naps_him_at_once_and_wakes_him_two_seconds_after_the_system_when_unlocked() {
    let scratch = Scratch::new();
    let mut engine = Engine::new(scratch.options(false), 1000, 42).unwrap();
    engine.render(2000, 1.0);
    assert_eq!(engine.record().mood, "idle");
    engine.system_sleep(5000);
    engine.render(5001, 1.0);
    assert!(engine.napping());
    assert_eq!(engine.record().mood, "sleep");
    assert_eq!(engine.record().frame, "sleep");
    engine.render(60_000, 1.0);
    assert_eq!(engine.record().mood, "sleep", "asleep for as long as the lid is down");
    engine.system_wake(100_000, false);
    engine.render(103_199, 1.0);
    assert!(engine.napping());
    assert_eq!(engine.next_deadline_ms(103_199), Some(103_200));
    engine.render(103_200, 1.0);
    assert!(!engine.napping());
    assert_eq!(engine.record().mood, "idle");
}

#[test]
fn a_locked_screen_keeps_him_asleep_until_the_unlock_and_then_one_second_and_a_fifth() {
    let scratch = Scratch::new();
    let mut engine = Engine::new(scratch.options(false), 1000, 42).unwrap();
    engine.system_sleep(5000);
    engine.system_wake(10_000, true);
    engine.render(500_000, 1.0);
    assert!(engine.napping());
    engine.screen_unlocked(500_000);
    engine.render(501_199, 1.0);
    assert!(engine.napping());
    engine.render(501_200, 1.0);
    assert!(!engine.napping());
    assert_eq!(engine.record().mood, "idle");
}

#[test]
fn a_touch_wakes_him_from_the_nap_and_a_hidden_companion_does_not_nap() {
    let scratch = Scratch::new();
    let mut engine = Engine::new(scratch.options(false), 1000, 42).unwrap();
    engine.system_sleep(5000);
    engine.touch(coco_companion::reactions::TouchEvent::Press, 6000);
    assert!(!engine.napping());
    let mut hidden = Engine::new(scratch.options(false), 1000, 43).unwrap();
    hidden.hide(1500);
    hidden.system_sleep(2000);
    assert!(!hidden.napping());
    let mut nap = Nap::begin();
    nap.unlocked(5);
    assert_eq!(nap.wake_at, None, "an unlock before the system woke wakes nothing");
}

#[test]
fn the_feed_carries_his_stick_and_ignores_a_bad_one() {
    let parse = |stick: serde_json::Value| {
        Record::from_value(&json!({"session": "s", "at": 1.0, "stick": stick})).unwrap().stick
    };
    assert_eq!(parse(json!({"startedAt": 10.0, "endsAt": 1510.0})), Some((10.0, 1510.0)));
    assert_eq!(parse(json!({"startedAt": 10.0, "endsAt": 5.0})), None);
    assert_eq!(parse(json!({"startedAt": 0.0, "endsAt": 100.0 * 60_000.0})), None);
    assert_eq!(parse(json!("soon")), None);
    assert_eq!(Record::from_value(&json!({"session": "s", "at": 1.0})).unwrap().stick, None);
}

#[test]
fn his_stick_is_drawn_while_it_burns_and_a_moment_after_and_then_it_is_gone() {
    let scratch = Scratch::new();
    let mut engine = Engine::new(scratch.options(false), 1000, 42).unwrap();
    let plain = engine.render(10_000, 1.0).pixels;
    let mut lit = Record::resting();
    lit.stick = Some((5_000.0, 10_000.0 + 60_000.0));
    engine.preview_record(lit.clone(), 10_000);
    assert_ne!(engine.render(10_000, 1.0).pixels, plain, "the stick is on the canvas");
    // After the end and its two seconds the canvas is as it was.
    let mut ended = Record::resting();
    ended.stick = Some((5_000.0, 6_000.0));
    engine.preview_record(ended, 10_000);
    assert!(!stick::burning(Some((5_000.0, 6_000.0)), 10_000));
    assert_eq!(engine.render(10_000, 1.0).pixels, plain);
}

#[test]
fn the_pointer_coming_onto_him_from_the_right_gives_one_glance_at_most_every_two_seconds() {
    let scratch = Scratch::new();
    let mut engine = Engine::new(scratch.options(false), 1000, 42).unwrap();
    engine.render(2000, 1.0);
    // From the left there is no left-looking face to draw here, so nothing happens.
    engine.pointer_over(true, false, 2000);
    assert!(!engine.pointer_glancing(2100));
    engine.pointer_over(false, false, 2100);
    // From the right he glances for 450 ms, then looks ahead again.
    engine.pointer_over(true, true, 3000);
    assert!(engine.pointer_glancing(3100));
    assert!(engine.next_deadline_ms(3100).is_some_and(|at| at <= 3450));
    assert!(engine.render(3100, 1.0).pixels.iter().any(|byte| *byte != 0));
    assert!(!engine.pointer_glancing(3450));
    // A second arrival inside two seconds of the last glance does nothing.
    engine.pointer_over(false, false, 3700);
    engine.pointer_over(true, true, 4000);
    assert!(!engine.pointer_glancing(4100));
    // Past two seconds he glances again.
    engine.pointer_over(false, false, 4200);
    engine.pointer_over(true, true, 5100);
    assert!(engine.pointer_glancing(5200));
    // And once more after another gap.
    engine.pointer_over(false, false, 5300);
    engine.pointer_over(true, true, 8000);
    assert!(engine.pointer_glancing(8100));
}
