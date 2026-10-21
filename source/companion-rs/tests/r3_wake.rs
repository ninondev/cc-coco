use coco_companion::{
    engine::Engine,
    reactions::TouchEvent,
    render::{Face, Size},
    Options,
};
use std::path::PathBuf;

struct Scratch(PathBuf);
impl Scratch {
    fn new() -> Self {
        use std::sync::atomic::{AtomicU64, Ordering};
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "companion-r3-wake-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(path.join("companion")).unwrap();
        Self(path)
    }
    fn options(&self, size: Size) -> Options {
        Options {
            folder: self.0.join("companion"),
            presence_folder: Some(self.0.join("presence")),
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

#[test]
fn remote_wake_uses_literal_approved_sleep_and_blink_cuts() {
    // He falls asleep 4 to 6 minutes after the quiet began, drawn from quietAt (DECISIONS 21:38, 10-06).
    let sleep = 1000 + coco_companion::protocol::sleep_after(1000.0) as u64;
    for size in Size::ALL {
        let scratch = Scratch::new();
        let mut engine = Engine::new(scratch.options(size), 1000, 42).unwrap();
        engine.render(sleep, 1.);
        let mut remote =
            coco_companion::presence_store::PresenceStore::new(scratch.0.join("presence"));
        remote.refresh(sleep);
        remote.touch(sleep + 1000).unwrap();
        engine.reload(sleep + 1000).unwrap();
        for (elapsed, expected_name, expected_face) in [
            (0, "sleep", Face::Open),
            (32, "sleep", Face::Open),
            (33, "idle-blink", Face::Open),
            (219, "idle-blink", Face::Open),
            (220, "idle-reading", Face::Half),
            (329, "idle-reading", Face::Half),
            (330, "idle-blink", Face::Open),
            (399, "idle-blink", Face::Open),
            (400, "idle-reading", Face::Half),
            (449, "idle-reading", Face::Half),
            (450, "idle-reading", Face::Open),
        ] {
            let (name, face, _) = engine.visual(sleep + 1000 + elapsed);
            assert_eq!(
                (name.as_str(), face),
                (expected_name, expected_face),
                "{size:?} wake at{elapsed}"
            );
        }
    }
}

#[test]
fn held_wake_retains_literal_sleep_until_opening_cuts() {
    // He falls asleep 4 to 6 minutes after the quiet began, drawn from quietAt (DECISIONS 21:38, 10-06).
    let sleep = 1000 + coco_companion::protocol::sleep_after(1000.0) as u64;
    let scratch = Scratch::new();
    let mut engine = Engine::new(scratch.options(Size::Medium), 1000, 42).unwrap();
    engine.render(sleep, 1.);
    engine.touch(TouchEvent::Press, sleep + 1000);
    for elapsed in [0, 33, 220, 549] {
        let (name, face, _) = engine.visual(sleep + 1000 + elapsed);
        assert_eq!((name.as_str(), face), ("sleep", Face::Open));
    }
    engine.touch(TouchEvent::LongPress, sleep + 1550);
    for (elapsed, expected_face) in [(0, Face::Half), (79, Face::Half), (80, Face::Open)] {
        let (name, face, _) = engine.visual(sleep + 1550 + elapsed);
        assert_eq!((name.as_str(), face), ("idle-reading", expected_face));
    }
}
