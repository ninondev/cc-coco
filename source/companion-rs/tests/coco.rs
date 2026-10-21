use coco_companion::{
    claudie,
    coco::{self, Outfit},
    decor::{CompactPhase, ShedEvent},
    engine::Engine,
    feed::Record,
    reactions::TouchEvent,
    render::Size,
    Options,
};
use std::path::PathBuf;

struct Scratch {
    root: PathBuf,
}
impl Scratch {
    fn new() -> Self {
        use std::sync::atomic::{AtomicU64, Ordering};
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let root = std::env::temp_dir().join(format!(
            "companion-coco-{}-{}-{}",
            std::process::id(),
            coco_companion::epoch_ms(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(root.join("companion")).unwrap();
        Self { root }
    }
    fn engine(&self, size: Size, reduce_motion: bool, now: u64) -> Engine {
        let options = Options {
            folder: self.root.join("companion"),
            presence_folder: None,
            assets: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../assets"),
            size,
            reduce_motion,
            follow_class: None,
            trace: false,
            login: false,
        };
        Engine::new(options, now, 42).unwrap()
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}
fn record(mood: &str, at: u64) -> Record {
    let mut r = Record::resting();
    r.session = "coco".into();
    r.at = at as f64;
    r.mood = mood.into();
    r.rest = matches!(mood, "idle" | "sleep");
    r.reactions.clear();
    r
}
fn shed(generation: u64, phase: CompactPhase, at: u64) -> Option<ShedEvent> {
    Some(ShedEvent {
        generation,
        phase,
        at,
    })
}
/// The engine plays what it is shown: render once, then ask which action she is in.
fn state(engine: &mut Engine, now: u64) -> (Outfit, &'static str, &'static str) {
    engine.render_companion(now, 1.);
    engine.coco_state().expect("her clips are loaded")
}
fn ink(canvas: &coco_companion::render::Canvas) -> u64 {
    canvas.pixels.chunks_exact(4).map(|p| p[3] as u64).sum()
}
/// Show the engine a record at a later time and say what she plays.
fn show(engine: &mut Engine, at: &mut u64, mut r: Record) -> (Outfit, &'static str, &'static str) {
    *at += 20_000;
    r.at = *at as f64;
    engine.preview_record(r, *at);
    state(engine, *at)
}

#[test]
fn she_is_drawn_at_the_companions_size_and_scale() {
    for (size, height) in [
        (Size::Medium, 128.),
        (Size::Large, 186.),
        (Size::Larger, 256.),
    ] {
        for scale in [1., 2.] {
            let scratch = Scratch::new();
            let mut engine = scratch.engine(size, false, 1000);
            let canvas = engine.render_companion(1000, scale);
            let h = height * scale;
            let w = (h * 234. / 241. - 1e-9).ceil();
            assert_eq!(
                (canvas.sprite_bounds.2, canvas.sprite_bounds.3),
                (w as u32, h as u32),
                "{size:?} at {scale}x"
            );
            assert!(ink(&canvas) > 0);
            let (x, y, bw, bh) = canvas.sprite_bounds;
            let hits = (y..y + bh as i32)
                .flat_map(|row| (x..x + bw as i32).map(move |col| (col, row)))
                .filter(|(col, row)| canvas.hit_test(*col, *row))
                .count();
            assert!(
                hits > 100,
                "{size:?} at {scale}x: she is where the window listens"
            );
            assert_eq!(engine.coco_state(), Some((Outfit::A, "idle", "idle")));
        }
    }
}
#[test]
fn what_the_feed_says_decides_what_she_plays() {
    let scratch = Scratch::new();
    let mut engine = scratch.engine(Size::Medium, false, 1000);
    let mut at = 1000;
    for (mood, action, base) in [
        ("think", "think", "think"),
        ("work", "work", "work"),
        ("happy", "done", "idle"),
        ("waiting", "wait", "wait"),
        ("question", "wait", "wait"),
        ("error", "error", "idle"),
        ("wild", "wild", "idle"),
        ("refuse", "teapot", "idle"),
        ("flustered", "praised", "idle"),
        ("wave", "hello", "idle"),
        ("snake", "peek", "idle"),
        ("idle", "idle", "idle"),
    ] {
        let mut r = record(mood, 0);
        r.rest = mood == "idle";
        let (outfit, got, settles) = show(&mut engine, &mut at, r);
        assert_eq!((outfit, got, settles), (Outfit::A, action, base), "{mood}");
    }
    for (pose, action) in [
        ("search", "search"),
        ("scroll", "read"),
        ("spyglass", "lookup"),
        ("plan", "plan"),
        ("run", "run"),
        ("helper", "helper"),
        ("tea", "coffee"),
        ("cheer", "fixed"),
        ("waiting", "wait"),
        ("look-up", "watch"),
    ] {
        let mut r = record("work", 0);
        r.pose = Some(pose.into());
        let (_, got, settles) = show(&mut engine, &mut at, r);
        assert_eq!((got, settles), (action, "work"), "{pose}");
    }
    // a pose he has no clip for changes nothing
    let mut r = record("idle", 0);
    r.pose = Some("glance".into());
    assert_eq!(show(&mut engine, &mut at, r).1, "idle");
    // asleep: the nap on the shut laptop, or the night lamp
    let (_, got, settles) = show(&mut engine, &mut at, record("sleep", 0));
    assert!(["nap", "night"].contains(&got) && got == settles, "{got}");
}
#[test]
fn the_outfit_the_plugin_names_is_the_one_she_wears() {
    let scratch = Scratch::new();
    let mut engine = scratch.engine(Size::Medium, false, 1000);
    let mut r = record("think", 1000);
    r.rest = false;
    r.outfit = Some("B".into());
    engine.preview_record(r, 1000);
    assert_eq!(state(&mut engine, 1000), (Outfit::B, "think", "think"));
    assert_eq!(
        Record::parse(br#"{"session":"s","at":1,"outfit":"B"}"#)
            .unwrap()
            .outfit
            .as_deref(),
        Some("B")
    );
    assert_eq!(
        Record::parse(br#"{"session":"s","at":1,"outfit":"C"}"#)
            .unwrap()
            .outfit,
        None
    );
    let parsed =
        Record::parse(br#"{"session":"s","at":1,"pose":{"name":"scroll","aside":"x"}}"#).unwrap();
    assert_eq!(parsed.pose.as_deref(), Some("scroll"));
    assert_eq!(
        Record::parse(br#"{"session":"s","at":1}"#).unwrap().pose,
        None
    );
}
#[test]
fn the_pair_of_socks_the_plugin_names_is_the_one_she_wears() {
    assert_eq!(
        Record::parse(br#"{"session":"s","at":1,"socks":"goodgirl"}"#)
            .unwrap()
            .socks
            .as_deref(),
        Some("goodgirl")
    );
    for bad in [r#""../band""#, r#""Matcha""#, r#""x""#, "3"] {
        let text = format!(r#"{{"session":"s","at":1,"socks":{bad}}}"#);
        assert_eq!(Record::parse(text.as_bytes()).unwrap().socks, None, "{bad}");
    }
    // in the engine: a pair it can read goes on, one it cannot leaves her own on
    let scratch = Scratch::new();
    let mut engine = scratch.engine(Size::Medium, false, 1000);
    let mut r = record("idle", 1000);
    r.socks = Some("matcha".into());
    engine.preview_record(r, 1000);
    let _ = state(&mut engine, 1000);
    assert_eq!(engine.coco_socks(), Some("matcha"));
    let mut r = record("idle", 2000);
    r.socks = Some("nosuchpair".into());
    engine.preview_record(r, 2000);
    let _ = state(&mut engine, 2000);
    assert_eq!(engine.coco_socks(), None);
}
#[test]
fn claudes_form_draws_claudies_cell_in_cocos_canvas_and_coco_otherwise() {
    // DECISIONS 927, 943: the feed names Claudie or maid Claudie; anything else leaves Coco
    for (text, want) in [(r#""dake""#, Some("dake")), (r#""maid""#, Some("maid")), (r#""coco""#, None), (r#""../dake""#, None)] {
        let line = format!(r#"{{"session":"s","at":1,"claudie":{text}}}"#);
        assert_eq!(Record::parse(line.as_bytes()).unwrap().claudie.as_deref(), want, "{text}");
    }
    // both forms' sixteen cells read, and every one of Coco's actions has one of them
    let cells = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../assets/claudie");
    for form in claudie::FORMS {
        let stills = claudie::Stills::load(&cells, form).unwrap();
        for action in coco::ACTIONS {
            assert!((1..=16).contains(&claudie::cell(form, action)), "{form} {action}");
            let image = stills.render(action, 117, 120).unwrap();
            assert_eq!((image.width, image.height), (117, 120));
            assert!(image.pixels.chunks_exact(4).any(|p| p[3] > 0), "{form} {action}");
        }
    }
    // in the engine: her picture is another one while the form is Claudie's, and Coco's again after
    let scratch = Scratch::new();
    let mut engine = scratch.engine(Size::Medium, true, 1000);
    engine.preview_record(record("idle", 1000), 1000);
    let coco = engine.render_companion(1000, 1.).pixels;
    let mut r = record("idle", 2000);
    r.claudie = Some("dake".into());
    engine.preview_record(r, 2000);
    let dake = engine.render_companion(2000, 1.).pixels;
    engine.preview_record(record("idle", 3000), 3000);
    let back = engine.render_companion(3000, 1.).pixels;
    assert_ne!(coco, dake);
    assert_eq!(coco, back);
}
// owner 10-17: in Claudie's form the pet's own lines (a pat, a shake, a wake) are Coco's and go unsaid
#[test]
fn claudies_form_leaves_the_pets_own_lines_unsaid() {
    let scratch = Scratch::new();
    let click = TouchEvent::Click { alternate: false };
    let mut coco = scratch.engine(Size::Medium, true, 1000);
    let mut r = Record::resting();
    r.session = "coco".into();
    r.at = 1000.;
    coco.preview_record(r.clone(), 1000);
    coco.touch(click, 5000);
    assert!(coco.current_line(5300).is_some(), "Coco answers a pat");
    let mut dake = scratch.engine(Size::Medium, true, 1000);
    r.claudie = Some("dake".into());
    dake.preview_record(r, 1000);
    dake.touch(click, 5000);
    assert_eq!(dake.current_line(5300), None);
}
#[test]
fn a_touch_pats_her_and_three_quick_ones_pull_the_hood() {
    let scratch = Scratch::new();
    let mut engine = scratch.engine(Size::Medium, false, 1000);
    let click = TouchEvent::Click { alternate: false };
    engine.touch(click, 5000);
    assert_eq!(state(&mut engine, 5100).1, "petted");
    // the pat is over after its hold; she settles into what she was doing
    assert_eq!(state(&mut engine, 7000).1, "idle");
    engine.touch(click, 20_000);
    engine.touch(click, 20_200);
    engine.touch(click, 20_400);
    assert_eq!(state(&mut engine, 20_500).1, "hood");
    // an Option-click is a plain click until after 1.0 (his 10-16 card): a pat
    let scratch = Scratch::new();
    let mut engine = scratch.engine(Size::Medium, false, 1000);
    engine.touch(TouchEvent::Click { alternate: true }, 5000);
    assert_eq!(state(&mut engine, 5100).1, "petted");
    // the greeting
    let scratch = Scratch::new();
    let mut engine = scratch.engine(Size::Medium, false, 1000);
    engine.wave(2000);
    assert_eq!(state(&mut engine, 2100).1, "hello");
}
#[test]
fn he_packs_while_the_conversation_is_compacted_and_wears_the_other_outfit_after() {
    let scratch = Scratch::new();
    let mut engine = scratch.engine(Size::Medium, false, 1000);
    let mut r = record("think", 10_000);
    r.rest = false;
    r.shed = shed(1, CompactPhase::Begin, 10_000);
    engine.preview_record(r, 10_000);
    assert_eq!(state(&mut engine, 11_000), (Outfit::A, "pack", "think"));
    // the end: the shell change plays in the outfit she leaves and ends in the other one's base
    let mut r = record("think", 20_000);
    r.rest = false;
    r.shed = shed(1, CompactPhase::End, 20_000);
    engine.preview_record(r.clone(), 20_000);
    assert_eq!(state(&mut engine, 20_100), (Outfit::A, "shell", "think"));
    // once it has played, she keeps that picture, and the next thing she does is in the new outfit
    assert_eq!(state(&mut engine, 24_000), (Outfit::A, "shell", "think"));
    let mut next = record("work", 30_000);
    next.rest = false;
    next.shed = r.shed;
    engine.preview_record(next, 30_000);
    assert_eq!(state(&mut engine, 30_100), (Outfit::B, "work", "work"));
    // the next compaction brings the first outfit back
    let mut r = record("think", 60_000);
    r.rest = false;
    r.shed = shed(2, CompactPhase::End, 60_000);
    engine.preview_record(r, 60_000);
    assert_eq!(state(&mut engine, 60_100), (Outfit::B, "shell", "think"));
    let mut next = record("work", 70_000);
    next.rest = false;
    next.shed = shed(2, CompactPhase::End, 60_000);
    engine.preview_record(next, 70_000);
    assert_eq!(state(&mut engine, 70_100), (Outfit::A, "work", "work"));
}
#[test]
fn a_compaction_that_ended_before_he_started_does_not_change_her_outfit() {
    let scratch = Scratch::new();
    let mut engine = scratch.engine(Size::Medium, false, 900_000);
    let mut r = record("think", 900_000);
    r.rest = false;
    r.shed = shed(5, CompactPhase::End, 100_000);
    engine.preview_record(r, 900_000);
    assert_eq!(state(&mut engine, 900_100), (Outfit::A, "think", "think"));
    // a skipped compaction is no change either
    let mut r = record("think", 910_000);
    r.rest = false;
    r.shed = shed(6, CompactPhase::Skip, 910_000);
    engine.preview_record(r, 910_000);
    assert_eq!(state(&mut engine, 910_100), (Outfit::A, "think", "think"));
}
#[test]
fn frames_come_every_33_ms_while_she_moves_and_stop_when_she_holds_still() {
    let scratch = Scratch::new();
    let mut engine = scratch.engine(Size::Medium, false, 1000);
    // her first action is playing: a frame every 33 ms
    for now in [1000, 1500, 3000] {
        engine.render_companion(now, 1.);
        assert_eq!(engine.next_deadline_ms(now), Some(now + 33), "{now}");
    }
    // a minute and more with nothing happening: the loop settles and nothing wakes the window for her
    let late = 1000 + 61_000 + 10_000;
    engine.render_companion(late, 1.);
    let next = engine.next_deadline_ms(late);
    assert!(next.is_none_or(|at| at > late + 1000), "{next:?}");
    // while he works the loop goes on, minutes after the last event (the work is a held state)
    let mut r = record("work", late);
    r.rest = false;
    engine.preview_record(r, late);
    let at = late + 200_000;
    engine.render_companion(at, 1.);
    assert_eq!(engine.next_deadline_ms(at), Some(at + 33));
}
#[test]
fn asleep_or_carried_she_stands_still_and_no_frames_are_scheduled_for_her() {
    let scratch = Scratch::new();
    let mut engine = scratch.engine(Size::Medium, false, 1000);
    engine.preview_record(record("sleep", 1000), 1000);
    let first = engine.render_companion(1000, 1.);
    let later = engine.render_companion(1500, 1.);
    assert_eq!(first.pixels, later.pixels);
    assert_eq!(engine.next_deadline_ms(1500), None);
    // carried: the drag holds her in the pose she was in until it is over
    let scratch = Scratch::new();
    let mut engine = scratch.engine(Size::Medium, false, 1000);
    engine.preview_record(record("idle", 1000), 1000);
    engine.touch(TouchEvent::DragStart, 1000);
    let first = engine.render_companion(1000, 1.);
    let later = engine.render_companion(2000, 1.);
    assert_eq!(first.pixels, later.pixels);
    assert_eq!(engine.next_deadline_ms(2000), Some(601_000));
}
#[test]
fn reduced_motion_is_one_still_and_no_frames() {
    let scratch = Scratch::new();
    let mut engine = scratch.engine(Size::Medium, true, 1000);
    let first = engine.render_companion(1000, 1.);
    let later = engine.render_companion(2500, 1.);
    assert_eq!(first.pixels, later.pixels);
    assert!(ink(&first) > 0);
    let next = engine.next_deadline_ms(1000);
    assert!(next.is_none_or(|at| at > 5000), "{next:?}");
    // the pose still follows the state
    let mut r = record("happy", 3000);
    r.rest = false;
    engine.preview_record(r, 3000);
    let happy = engine.render_companion(3100, 1.);
    assert_ne!(happy.pixels, first.pixels);
    assert_eq!(
        engine.coco_state().map(|s| s.1),
        Some("done"),
        "reduced motion changes the pose, not the clock"
    );
    // with motion the same engine draws something different a moment later
    let scratch = Scratch::new();
    let mut engine = scratch.engine(Size::Medium, false, 1000);
    let a = engine.render_companion(1000, 1.);
    let b = engine.render_companion(1500, 1.);
    assert_ne!(a.pixels, b.pixels);
}
#[test]
fn his_words_and_the_hover_still_draw_with_her() {
    let scratch = Scratch::new();
    let mut engine = scratch.engine(Size::Medium, false, 1000);
    let mut r = record("idle", 1000);
    r.said = Some("hello there".into());
    engine.preview_record(r, 1000);
    let canvas = engine.render_companion(1100, 1.);
    assert!(canvas.bubble.is_some(), "his line is a bubble above her");
    let line = canvas.bubble.as_ref().unwrap();
    assert!(
        line.y + line.height <= canvas.sprite_bounds.1 as f64,
        "the line sits above her picture"
    );
}
#[test]
fn her_breathing_halves_meet_without_a_see_through_row() {
    // resting, her picture is two halves split at the mug's rim that breathe apart; where they meet, every
    // pixel solid just above and just below is solid on the line too, at each of the companion's sizes
    use coco_companion::coco::{Player, Wanted};
    let folder = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("assets/coco");
    for outfit in [Outfit::A, Outfit::B] {
        for height in [128usize, 192, 256] {
            for now in [500u64, 1500, 2600] {
                let mut player = Player::load(&folder).unwrap();
                player.update(
                    &Wanted {
                        outfit,
                        action: "idle",
                        base: "idle",
                        act: None,
                    },
                    0,
                    true,
                );
                let image = player.render(now, height, false, true).unwrap();
                let alpha = |x: usize, y: usize| image.pixels[(y * image.width + x) * 4 + 3];
                let seam = (155. / 241. * height as f64).round() as usize;
                for y in seam - 1..=seam + 1 {
                    let thin = (0..image.width)
                        .filter(|&x| {
                            alpha(x, y - 3) == 255 && alpha(x, y + 3) == 255 && alpha(x, y) < 240
                        })
                        .count();
                    assert_eq!(
                        thin, 0,
                        "{outfit:?} at {height} px, {now} ms: row {y} shows through"
                    );
                }
            }
        }
    }
}
