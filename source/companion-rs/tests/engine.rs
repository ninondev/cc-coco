use coco_companion::{engine::Engine, reactions::TouchEvent, render::Size, Options};
use std::path::PathBuf;
struct Scratch {
    root: PathBuf,
}
impl Scratch {
    fn new() -> Self {
        use std::sync::atomic::{AtomicU64, Ordering};
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let root = std::env::temp_dir().join(format!(
            "companion-engine-{}-{}-{}",
            std::process::id(),
            coco_companion::epoch_ms(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(root.join("companion")).unwrap();
        Self { root }
    }
    fn options(&self) -> Options {
        Options {
            folder: self.root.join("companion"),
            presence_folder: Some(self.root.join("presence")),
            assets: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../assets"),
            size: Size::Medium,
            reduce_motion: false,
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
#[test]
fn no_session_quiet_deadlines_survive_hidden_window() {
    // He falls asleep 4 to 6 minutes after the quiet began, drawn from quietAt (DECISIONS 21:38, 10-06).
    let sleep = 1000 + coco_companion::protocol::sleep_after(1000.0) as u64;
    let scratch = Scratch::new();
    let mut engine = Engine::new(scratch.options(), 1000, 42).unwrap();
    engine.hide(1000);
    assert_eq!(engine.next_deadline_ms(1000), Some(151000));
    engine.render(151000, 1.0);
    assert_eq!(engine.next_deadline_ms(151000), Some(sleep));
    engine.render(sleep, 1.0);
    assert_eq!(engine.record().mood, "sleep");
}
#[test]
fn no_session_companion_starts_quiet_and_sleeps_at_shared_deadline() {
    // He falls asleep 4 to 6 minutes after the quiet began, drawn from quietAt (DECISIONS 21:38, 10-06).
    let sleep = 1000 + coco_companion::protocol::sleep_after(1000.0) as u64;
    let scratch = Scratch::new();
    let mut engine = Engine::new(scratch.options(), 1000, 42).unwrap();
    assert_eq!(engine.record().frame, "idle-reading");
    assert_eq!(engine.record().said, None);
    let initial = engine.render(1000, 1.0);
    assert!(initial.pixels.chunks_exact(4).any(|p| p[3] > 0));
    engine.render(sleep, 1.0);
    assert_eq!(engine.record().mood, "sleep");
    assert_eq!(engine.record().frame, "sleep");
}
#[cfg(unix)]
#[test]
fn touch_wake_survives_contended_shared_store_and_reload() {
    // He falls asleep 4 to 6 minutes after the quiet began, drawn from quietAt (DECISIONS 21:38, 10-06).
    let sleep = 1000 + coco_companion::protocol::sleep_after(1000.0) as u64;
    use std::os::fd::AsRawFd;
    let scratch = Scratch::new();
    let mut engine = Engine::new(scratch.options(), 1000, 42).unwrap();
    engine.render(sleep, 1.0);
    assert_eq!(engine.record().mood, "sleep");
    let lock = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(scratch.root.join("presence/.presence-flock"))
        .unwrap();
    assert_eq!(
        unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) },
        0
    );
    engine.touch(TouchEvent::Press, sleep + 1000);
    engine.render(sleep + 1100, 1.0);
    assert_eq!(engine.record().mood, "idle");
    engine.reload(sleep + 1101).unwrap();
    engine.render(sleep + 1102, 1.0);
    assert_eq!(engine.record().mood, "idle");
    unsafe {
        libc::flock(lock.as_raw_fd(), libc::LOCK_UN);
    }
    drop(lock);
    engine.reload(sleep + 1200).unwrap();
    assert_eq!(engine.record().mood, "idle");
    assert!(
        !coco_companion::presence_store::read_snapshot(&scratch.root.join("presence"))
            .unwrap()
            .asleep
    );
}
#[test]
fn long_press_wake_is_drawn_every_33_ms_and_ends_160_ms_after_the_opening() {
    // He falls asleep 4 to 6 minutes after the quiet began, drawn from quietAt (DECISIONS 21:38, 10-06).
    let sleep = 1000 + coco_companion::protocol::sleep_after(1000.0) as u64;
    let scratch = Scratch::new();
    let mut engine = Engine::new(scratch.options(), 1000, 42).unwrap();
    engine.render(sleep, 1.0);
    engine.touch(TouchEvent::Press, sleep + 1000);
    engine.render(sleep + 1550, 1.0);
    engine.touch(TouchEvent::LongPress, sleep + 1550);
    engine.render(sleep + 1629, 1.0);
    assert_eq!(engine.next_deadline_ms(sleep + 1629), Some(sleep + 1662));
    engine.render(sleep + 1709, 1.0);
    assert_eq!(engine.next_deadline_ms(sleep + 1709), Some(sleep + 1710));
}
#[test]
fn a_wake_from_another_surface_uses_the_same_initial_sleep_drawing() {
    // He falls asleep 4 to 6 minutes after the quiet began, drawn from quietAt (DECISIONS 21:38, 10-06).
    let sleep = 1000 + coco_companion::protocol::sleep_after(1000.0) as u64;
    let scratch = Scratch::new();
    let mut engine = Engine::new(scratch.options(), 1000, 42).unwrap();
    let asleep = engine.render(sleep, 1.0);
    assert_eq!(engine.record().mood, "sleep");
    let mut remote =
        coco_companion::presence_store::PresenceStore::new(scratch.root.join("presence"));
    remote.refresh(sleep);
    remote.touch(sleep + 1000).unwrap();
    engine.reload(sleep + 1000).unwrap();
    assert_eq!(engine.record().mood, "idle");
    let first = engine.render(sleep + 1000, 1.0);
    assert_eq!(first.pixels, asleep.pixels);
    let awake = engine.render(sleep + 1450, 1.0);
    assert_ne!(awake.pixels, asleep.pixels);
}
fn quiet_record(at: u64) -> coco_companion::feed::Record {
    let mut record = coco_companion::feed::Record::resting();
    record.session = "test".into();
    record.at = at as f64;
    record.reactions.clear();
    record
}
#[test]
fn static_drag_holds_without_frame_timer_or_hidden_idle_blinks() {
    let scratch = Scratch::new();
    let mut options = scratch.options();
    options.presence_folder = None;
    let mut engine = Engine::new(options, 1000, 42).unwrap();
    engine.preview_record(quiet_record(1000), 1000);
    engine.touch(TouchEvent::DragStart, 1000);
    let first = engine.render(1000, 1.0);
    let later = engine.render(2000, 1.0);
    assert_eq!(first.pixels, later.pixels);
    assert_eq!(engine.next_deadline_ms(2000), Some(601000));
}
#[test]
fn static_book_hold_only_schedules_its_expiry() {
    // Her clips play while motion is on (hood, petted); the still pose is the reduced-motion one. (The Option-click's
    // own still, Shiori peeking out, waits until after 1.0: his 10-16 card.)
    for (event, until) in [(TouchEvent::LongPress, 2600)] {
        let scratch = Scratch::new();
        let mut options = scratch.options();
        options.presence_folder = None;
        options.reduce_motion = true;
        let mut engine = Engine::new(options, 1000, 42).unwrap();
        engine.preview_record(quiet_record(1000), 1000);
        engine.touch(event, 1000);
        let first = engine.render(1000, 1.0);
        let later = engine.render(2000, 1.0);
        assert_eq!(first.pixels, later.pixels);
        assert_eq!(engine.next_deadline_ms(2000), Some(until));
    }
}
#[test]
fn reduced_motion_pat_is_one_pose_without_frame_ticks() {
    let scratch = Scratch::new();
    let mut options = scratch.options();
    options.presence_folder = None;
    options.reduce_motion = true;
    let mut engine = Engine::new(options, 1000, 42).unwrap();
    engine.preview_record(quiet_record(1000), 1000);
    let resting = engine.render(1000, 1.0);
    engine.touch(TouchEvent::Click { alternate: false }, 1000);
    // Her pat is one pose in reduced motion: it changes with the touch and holds until the hold is over.
    let patted = engine.render(1000, 1.0);
    assert_ne!(resting.pixels, patted.pixels);
    for at in [1040, 1120, 1260, 1349, 2250] {
        assert_eq!(patted.pixels, engine.render(at, 1.0).pixels, "{at}");
    }
    let after = engine.render(2400, 1.0);
    assert_eq!(resting.pixels, after.pixels);
    assert_eq!(engine.next_deadline_ms(2400), None);
}
#[test]
fn pat_is_drawn_every_33_ms_and_ends_with_its_hold() {
    let scratch = Scratch::new();
    let mut options = scratch.options();
    options.presence_folder = None;
    let mut engine = Engine::new(options, 1000, 42).unwrap();
    engine.preview_record(quiet_record(1000), 1000);
    engine.touch(TouchEvent::Click { alternate: false }, 1000);
    // her pat plays for the 1400 ms hold; the old face swaps (40, 120, 260, ...) are not scheduled for her
    for (at, next) in [
        (1039, 1072),
        (1119, 1152),
        (1259, 1292),
        (2349, 2382),
        (2380, 2400),
    ] {
        engine.render(at, 1.0);
        assert_eq!(engine.next_deadline_ms(at), Some(next));
    }
}
#[test]
fn malformed_scalar_settings_are_replaced_with_an_object_on_owned_save() {
    for contents in ["null", "true", "7", "\"text\"", "[]"] {
        let scratch = Scratch::new();
        let settings = scratch.root.join("companion/companion.json");
        std::fs::write(&settings, contents).unwrap();
        let mut engine = Engine::new(scratch.options(), 1000, 42).unwrap();
        engine.toggle_lines().unwrap();
        let settings: serde_json::Value =
            serde_json::from_slice(&std::fs::read(settings).unwrap()).unwrap();
        assert!(settings.is_object());
        assert_eq!(settings["linesHidden"], true);
        assert_eq!(settings["size"], "medium");
    }
}
#[test]
fn companion_state_appends_preserve_existing_requests_and_use_hook_units() {
    let scratch = Scratch::new();
    let path = scratch.root.join("companion/requests.jsonl");
    let at = coco_companion::epoch_ms();
    let request = coco_companion::protocol::ChannelRequest::new(
        "0123456789abcdef".into(),
        "session".into(),
        at as f64,
        coco_companion::protocol::RequestKind::Submit,
        Some("private text"),
        None,
    )
    .unwrap();
    let initial = request.line().unwrap();
    std::fs::write(&path, &initial).unwrap();
    #[cfg(unix)]
    let inode = {
        use std::os::unix::fs::MetadataExt;
        std::fs::metadata(&path).unwrap().ino()
    };
    let mut engine = Engine::new(scratch.options(), at, 42).unwrap();
    engine.hide(at);
    let bytes = std::fs::read(&path).unwrap();
    assert_eq!(&bytes[..initial.len()], initial.as_slice());
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        assert_eq!(std::fs::metadata(&path).unwrap().ino(), inode);
    }
    let line = bytes[initial.len()..].strip_suffix(b"\n").unwrap();
    assert!(line.len() < 2048);
    let state: serde_json::Value = serde_json::from_slice(line).unwrap();
    assert_eq!(state["v"], 1);
    assert_eq!(state["kind"], "companion-state");
    assert!(state["at"].as_u64().unwrap() >= at);
    assert_eq!(
        state["info"]["hiddenUntil"].as_f64().unwrap(),
        at as f64 / 1000.0 + 3600.0
    );
    assert_eq!(state["info"]["running"], true);
    assert_eq!(state["info"]["size"], "medium");
    assert!(!String::from_utf8_lossy(line).contains("private text"));
}
#[test]
fn running_state_is_published_at_start_and_stop_only_for_native_lifecycle() {
    let scratch = Scratch::new();
    let path = scratch.root.join("companion/companion.json");
    {
        let mut engine = Engine::new(scratch.options(), 1000, 42).unwrap();
        engine.mark_running(true).unwrap();
        let state: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(state["running"], true);
    }
    let stopped: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(stopped["running"], false);
    {
        let mut engine = Engine::new(scratch.options(), 1000, 42).unwrap();
        engine.toggle_lines().unwrap();
    }
    let untouched: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(untouched["running"], false);
    let log = std::fs::read(scratch.root.join("companion/requests.jsonl")).unwrap();
    let states: Vec<serde_json::Value> = log
        .split(|b| *b == b'\n')
        .filter_map(|b| serde_json::from_slice(b).ok())
        .collect();
    assert_eq!(states.len(), 1);
    assert_eq!(states[0]["info"]["running"], false);
}
#[test]
fn chosen_x11_window_class_survives_login_launch_and_rejects_bad_values() {
    let scratch = Scratch::new();
    let mut options = scratch.options();
    options.follow_class = Some("Terminal Example".into());
    {
        let mut engine = Engine::new(options, 1000, 42).unwrap();
        engine.mark_running(true).unwrap();
    }
    let restored = Engine::new(scratch.options(), 1000, 42).unwrap();
    assert_eq!(
        restored.options.follow_class.as_deref(),
        Some("Terminal Example")
    );
    drop(restored);
    for bad in [String::new(), "x".repeat(257), "bad\0class".into()] {
        std::fs::write(
            scratch.root.join("companion/companion.json"),
            serde_json::to_vec(&serde_json::json!({"followClass":bad})).unwrap(),
        )
        .unwrap();
        let restored = Engine::new(scratch.options(), 1000, 42).unwrap();
        assert!(restored.options.follow_class.is_none());
        drop(restored);
        let mut options = scratch.options();
        options.follow_class = Some(bad);
        assert!(Engine::new(options, 1000, 42).is_err());
    }
}
#[test]
fn hidden_maintenance_scrubs_expired_requests_and_advances_shared_sleep_without_drawing() {
    // He falls asleep 4 to 6 minutes after the quiet began, drawn from quietAt (DECISIONS 21:38, 10-06).
    let sleep = 1000 + coco_companion::protocol::sleep_after(1000.0) as u64;
    let scratch = Scratch::new();
    let path = scratch.root.join("companion/requests.jsonl");
    let request = coco_companion::protocol::ChannelRequest::new(
        "0123456789abcdef".into(),
        "session".into(),
        1000.0,
        coco_companion::protocol::RequestKind::Submit,
        Some("pending private request"),
        None,
    )
    .unwrap();
    let original = request.line().unwrap();
    std::fs::write(&path, &original).unwrap();
    let mut engine = Engine::new(scratch.options(), 1000, 42).unwrap();
    engine.hide(1000);
    engine.set_visible(false);
    assert_eq!(engine.next_deadline_ms(1000), Some(61001));
    let before = std::fs::read(&path).unwrap();
    engine.maintain(61001);
    let after = std::fs::read(&path).unwrap();
    assert_eq!(before.len(), after.len());
    assert!(after[..original.len() - 1].iter().all(|byte| *byte == b' '));
    assert_eq!(after[original.len() - 1], b'\n');
    assert_eq!(&after[original.len()..], &before[original.len()..]);
    assert!(engine.is_hidden(61001));
    assert_eq!(engine.next_deadline_ms(61001), Some(151000));
    engine.maintain(151000);
    assert_eq!(engine.next_deadline_ms(151000), Some(sleep));
    engine.maintain(sleep);
    assert_eq!(engine.record().mood, "sleep");
    assert!(engine.is_hidden(sleep));
    assert_eq!(engine.next_deadline_ms(sleep), Some(3601000));
}

#[test]
fn notice_preference_is_explicit_retained_and_changes_only_on_accepted_feed() {
    let scratch = Scratch::new();
    let view = scratch.options().folder.join("view.json");
    assert_eq!(
        Engine::new(scratch.options(), 1000, 42)
            .unwrap()
            .notice_preference(1000),
        None
    );
    std::fs::write(
        &view,
        br#"{"session":"a","at":1000,"notices":true,"longTask":"band"}"#,
    )
    .unwrap();
    let mut engine = Engine::new(scratch.options(), 1000, 42).unwrap();
    assert_eq!(engine.notice_preference(1000), Some(true));
    engine.reload(1_000_000).unwrap();
    assert_eq!(engine.notice_preference(1_000_000), Some(true));
    std::fs::write(
        &view,
        br#"{"session":"a","at":1000001,"notices":false,"longTask":"notify"}"#,
    )
    .unwrap();
    engine.reload(1_000_001).unwrap();
    assert_eq!(engine.notice_preference(1_000_001), Some(false));
    std::fs::write(
        &view,
        br#"{"session":"a","at":1000000,"notices":true,"longTask":"notify"}"#,
    )
    .unwrap();
    engine.reload(1_000_002).unwrap();
    assert_eq!(engine.notice_preference(1_000_002), Some(false));
}
#[test]
fn notice_preference_rejects_malformed_explicit_flag() {
    use coco_companion::feed::Record;
    assert!(
        Record::parse(br#"{"session":"a","at":1000,"notices":"yes","longTask":"notify"}"#).is_err()
    );
    assert!(
        !Record::parse(br#"{"session":"a","at":1000,"notices":false,"longTask":"notify"}"#)
            .unwrap()
            .notices
    );
    assert!(
        Record::parse(br#"{"session":"a","at":1000,"longTask":"notify"}"#)
            .unwrap()
            .notices
    );
}
#[test]
fn the_pet_quits_once_its_data_folder_is_taken_away() {
    // Uninstalling on Windows and Linux moves the data folder to the trash (setup.rs); a pet still running
    // then quits on its next look instead of writing the folder back.
    let scratch = Scratch::new();
    let mut engine = Engine::new(scratch.options(), 1000, 42).unwrap();
    engine.reload(1000).unwrap();
    assert!(engine.take_actions().is_empty());
    std::fs::remove_dir_all(scratch.root.join("companion")).unwrap();
    engine.reload(2000).unwrap();
    engine.reload(3000).unwrap();
    assert_eq!(
        engine.take_actions(),
        vec![coco_companion::engine::Action::Quit]
    );
    assert!(!scratch.root.join("companion").exists());
}
// Owner 10-20: screenshots, recordings and shared screens show the pet until the book's switch turns it off.
#[test]
fn capture_switch_is_on_by_default_and_follows_the_book() {
    use coco_companion::engine::Action;
    let scratch = Scratch::new();
    let view = scratch.options().folder.join("view.json");
    let settings = scratch.options().folder.join("companion.json");
    let mut engine = Engine::new(scratch.options(), 1000, 42).unwrap();
    engine.mark_running(true).unwrap();
    assert!(engine.capture());
    let saved: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&settings).unwrap()).unwrap();
    assert_eq!(saved["capture"], true);
    std::fs::write(
        &view,
        br#"{"session":"a","at":2000,"capture":{"on":false,"at":2000}}"#,
    )
    .unwrap();
    engine.reload(2001).unwrap();
    assert!(!engine.capture());
    assert!(engine.take_actions().contains(&Action::Capture(false)));
    let saved: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&settings).unwrap()).unwrap();
    assert_eq!(saved["capture"], false);
    assert_eq!(saved["captureAt"], 2000.0);
    engine.reload(2002).unwrap();
    assert!(!engine.take_actions().contains(&Action::Capture(false)));
}
