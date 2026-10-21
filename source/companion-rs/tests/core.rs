use coco_companion::{
    feed::{Record, Sessions},
    motion::{MotionCycle, MotionKind, MotionModel, SeededRandom, Timeline},
    paths::{
        companion_folder, join_path, presence_folder, same_path, windows_path, Platform, PlatformPaths,
    },
    protocol::{
        request_decision, sleep_after, ChannelRequest, Presence, PresenceProjection, PresenceSnapshot,
        RequestDecision, RequestKind, RequestLog, Requests,
    },
    reactions::{english_reactions, Reactor, TouchEvent},
};
use serde_json::{json, Value};
fn near(a: f64, b: f64) {
    assert!(
        (a - b).abs() <= 1e-8_f64.max(b.abs() * 3e-14),
        "{a:.17} != {b:.17}"
    )
}
fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/motion.json")).unwrap()
}
#[test]
fn typescript_motion_model_is_identical() {
    assert_eq!(
        MotionModel::default(),
        serde_json::from_value::<MotionModel>(fixture()["model"].clone()).unwrap()
    )
}
#[test]
fn typescript_xorshift_and_log_normal_samplers_match() {
    let model = MotionModel::default();
    for s in fixture()["samples"].as_array().unwrap() {
        let seed = s["seed"].as_u64().unwrap() as u32;
        let mut rng = SeededRandom::new(seed);
        for expected in s["randoms"].as_array().unwrap() {
            assert_eq!(rng.next_f64(), expected.as_f64().unwrap())
        }
        let mut rng = SeededRandom::new(seed);
        for expected in s["randomWords"].as_array().unwrap() {
            assert_eq!(
                rng.next_f64(),
                expected.as_u64().unwrap() as f64 / 4_294_967_296.0
            )
        }
        let mut rng = SeededRandom::new(seed);
        for expected in s["holds"].as_array().unwrap() {
            near(
                model.blink.interval.sample(&mut rng),
                expected.as_f64().unwrap(),
            )
        }
        let mut rng = SeededRandom::new(seed);
        for b in s["blinks"].as_array().unwrap() {
            near(
                model.blink.interval.sample(&mut rng),
                b["interval"].as_f64().unwrap(),
            );
            near(
                model.blink.shut.sample(&mut rng),
                b["shut"].as_f64().unwrap(),
            );
            near(
                model.blink.double_gap.sample(&mut rng),
                b["gap"].as_f64().unwrap(),
            );
            assert_eq!(model.blink_double(&mut rng), b["double"].as_bool().unwrap());
            let actual = model.gaze_blink_delay(&mut rng);
            if let Some(expected) = b["gaze"].as_f64() {
                near(actual.unwrap(), expected)
            } else {
                assert!(actual.is_none())
            }
        }
    }
}
#[test]
fn typescript_motion_cycles_and_full_schedules_match() {
    let model = MotionModel::default();
    for s in fixture()["samples"].as_array().unwrap() {
        let seed = s["seed"].as_u64().unwrap() as u32;
        for (name, kind) in [
            ("think", MotionKind::Think),
            ("work", MotionKind::Work),
            ("wild", MotionKind::Wild),
        ] {
            let mut rng = SeededRandom::new(seed);
            let mut cycle = MotionCycle::new(kind, &model, &mut rng);
            for e in s["cycles"][name].as_array().unwrap() {
                near(cycle.next(&mut rng), e.as_f64().unwrap())
            }
            compare_timeline(
                &Timeline::looping(&model, kind, &mut SeededRandom::new(seed)),
                &s["timelines"][name],
            );
        }
        for (name, gaze) in [("idle", false), ("gaze", true)] {
            compare_timeline(
                &Timeline::idle(&model, gaze, &mut SeededRandom::new(seed)),
                &s["timelines"][name],
            );
        }
    }
}
fn compare_timeline(actual: &Timeline, expected: &Value) {
    near(
        actual.duration_ms,
        expected["duration_ms"].as_f64().unwrap(),
    );
    let changes = expected["changes"].as_array().unwrap();
    assert_eq!(actual.changes.len(), changes.len());
    for ((at, second), e) in actual.changes.iter().zip(changes) {
        near(*at, e[0].as_f64().unwrap());
        assert_eq!(*second, e[1].as_bool().unwrap());
    }
    assert_eq!(actual.second_at(actual.duration_ms), actual.second_at(0.0));
    assert!(actual.next_change_ms(actual.duration_ms) > actual.duration_ms)
}
#[test]
fn invalid_motion_falls_back_without_poisoning_feed() {
    let mut value = json!({"session":"s","at":1,"motion":serde_json::to_value(MotionModel::default()).unwrap()});
    value["motion"]["workBurst"]["min"] = json!(0);
    assert_eq!(
        Record::from_value(&value).unwrap().motion,
        MotionModel::default()
    );
    assert!(
        !serde_json::from_value::<MotionModel>(value["motion"].clone())
            .unwrap()
            .valid()
    )
}
#[test]
fn truncated_or_oversized_feed_cannot_replace_valid_session() {
    let mut sessions = Sessions::default();
    let r =
        Record::parse(br#"{"session":"a","at":100,"mood":"work","frame":"work-a","rest":false}"#)
            .unwrap();
    assert!(sessions.receive(r.clone(), 100.0));
    assert!(Record::parse(br#"{"session":"a","at":101,"said":"partial"#).is_err());
    assert!(Record::parse(&vec![b' '; 262145]).is_err());
    assert_eq!(sessions.shown(100.0), r)
}
fn record(session: &str, at: f64, desktop: bool, rest: bool) -> Record {
    let mut r = Record::resting();
    r.session = session.into();
    r.at = at;
    r.desktop = desktop;
    r.rest = rest;
    r
}
#[test]
fn sessions_choose_active_desktop_and_ignore_late_writes() {
    let mut s = Sessions::default();
    s.receive(record("cli", 300.0, false, false), 300.0);
    s.receive(record("desktop-work", 100.0, true, false), 300.0);
    s.receive(record("desktop-idle", 200.0, true, true), 300.0);
    assert_eq!(s.shown(300.0).session, "desktop-work");
    assert!(!s.receive(record("desktop-work", 90.0, true, true), 300.0));
    let mut ended = record("desktop-work", 400.0, true, false);
    ended.ended = true;
    s.receive(ended, 400.0);
    assert!(!s.receive(record("desktop-work", 350.0, true, false), 400.0));
    assert_eq!(s.shown(400.0).session, "desktop-idle")
}
#[test]
fn active_session_ages_out_and_ties_are_stable() {
    let mut s = Sessions::default();
    s.receive(record("z", 1.0, true, false), 1.0);
    s.receive(record("a", 1.0, true, false), 1.0);
    assert_eq!(s.shown(2.0).session, "a");
    s.receive(record("idle", 1_800_002.0, true, true), 1_800_002.0);
    assert_eq!(s.shown(1_800_002.0).session, "idle");
    assert_eq!(s.shown(45_000_003.0).session, "")
}
fn presence(seq: u64, asleep: bool, kind: &str, at: f64) -> Presence {
    Presence {
        seq,
        asleep,
        kind: kind.into(),
        event_id: format!("{kind}:{seq}:{}", at as u64),
        at,
        said: Some("shared line".into()),
    }
}
#[test]
fn global_presence_wake_is_monotone_and_cannot_replay_expired_line() {
    let mut s = Sessions::default();
    let mut r = record("a", 1.0, true, true);
    r.mood = "sleep".into();
    r.frame = "sleep".into();
    r.said = Some("old line".into());
    s.receive(r, 1.0);
    s.receive_presence(presence(5, true, "sleep", 100.0));
    assert_eq!(s.shown(101.0).mood, "sleep");
    s.receive_presence(presence(5, false, "wake", 200.0));
    assert_eq!(s.shown(201.0).mood, "idle");
    s.receive_presence(presence(4, true, "sleep", 202.0));
    assert_eq!(s.shown(201.0).mood, "idle");
    assert_eq!(s.shown(14_200.0).said, None)
}
#[test]
fn newer_session_line_survives_old_presence_event() {
    let r =
        Record::from_value(&json!({"session":"a","at":16000,"said":"new session speech"})).unwrap();
    assert_eq!(
        r.apply_presence(&presence(3, false, "wake", 1000.0), 16001.0)
            .said
            .as_deref(),
        Some("new session speech")
    )
}
#[test]
fn requests_keep_independent_clocks() {
    let mut a = Requests::from_value(
        &json!({"follow":10,"size":{"to":"larger","at":20},"login":{"on":true,"at":30},"capture":{"on":false,"at":40}}),
    );
    a.merge(&Requests::from_value(
        &json!({"follow":11,"size":{"to":"large","at":19},"login":{"on":false,"at":31},"capture":{"on":true,"at":39}}),
    ));
    assert_eq!(a.follow, 11.0);
    assert_eq!(a.size.unwrap().to.height(), 256);
    assert!(!a.login.unwrap().on);
    assert!(!a.capture.unwrap().on);
    assert!(Requests::wants(1.0, 0.0, true, 15001.0));
    assert!(!Requests::wants(1.0, 0.0, true, 15002.0));
    assert!(!Requests::wants(2.0, 0.0, true, 1.0))
}
#[test]
fn reactions_preserve_lines_and_count_click_window() {
    let lines = english_reactions();
    let mut r = Reactor::default();
    let first = r.react(
        TouchEvent::Click { alternate: false },
        0.0,
        "idle",
        &lines,
        0.0,
    );
    assert_eq!(first.key, "pat");
    assert!(first.line.is_some());
    assert!(r
        .react(
            TouchEvent::Click { alternate: false },
            0.2,
            "idle",
            &lines,
            0.0
        )
        .line
        .is_none());
    let burst = r.react(
        TouchEvent::Click { alternate: false },
        0.4,
        "idle",
        &lines,
        0.0,
    );
    assert_eq!(burst.key, "flustered");
    assert_eq!(burst.frame, "flustered");
    assert_ne!(burst.line, first.line);
    assert_eq!(
        r.react(
            TouchEvent::Click { alternate: false },
            2.0,
            "waiting",
            &lines,
            0.0
        )
        .hold,
        0.9
    );
    assert_eq!(
        r.react(
            TouchEvent::Click { alternate: true },
            2.1,
            "idle",
            &lines,
            0.0
        )
        .key,
        "pat"
    )
}
#[test]
fn all_touch_routes_wake_and_burst_waits_for_open_eyes() {
    let lines = english_reactions();
    for event in [
        TouchEvent::Press,
        TouchEvent::Click { alternate: false },
        TouchEvent::Click { alternate: true },
        TouchEvent::DragStart,
        TouchEvent::Drop,
        TouchEvent::LongPress,
    ] {
        let mut r = Reactor::default();
        let reaction = r.react(event, 1.0, "sleep", &lines, 0.0);
        assert!(reaction.wakes);
        assert!(reaction.delay_ms <= 450.0);
        if event == TouchEvent::DragStart {
            assert_eq!(reaction.delay_ms, 33.0)
        }
    }
    let mut r = Reactor::default();
    r.react(
        TouchEvent::Click { alternate: false },
        1.0,
        "sleep",
        &lines,
        0.0,
    );
    r.react(
        TouchEvent::Click { alternate: false },
        1.1,
        "idle",
        &lines,
        0.0,
    );
    let third = r.react(
        TouchEvent::Click { alternate: false },
        1.2,
        "idle",
        &lines,
        0.0,
    );
    assert_eq!(third.key, "flustered");
    near(third.delay_ms, 250.0)
}
#[test]
fn drag_drop_hold_and_endings_match_swift() {
    let mut r = Reactor::default();
    let lines = english_reactions();
    assert_eq!(
        r.react(TouchEvent::DragStart, 0.0, "error", &lines, 0.0)
            .hold,
        600.0
    );
    assert_eq!(
        r.react(TouchEvent::Drop, 1.0, "idle", &lines, 0.0).frame,
        "idle-blink"
    );
    assert_eq!(
        r.react(TouchEvent::LongPress, 2.0, "idle", &lines, 0.0)
            .frame,
        "refuse"
    );
    assert_eq!(Reactor::ending("hi (>_<)"), Reactor::ending("hi\n>_<"));
    assert_eq!(Reactor::ending("嘿嘿🌸"), "🌸");
    assert_eq!(Reactor::ending("hello ( ˘ᵕ˘ )"), "˘ᵕ˘")
}
#[test]
fn paths_match_typescript_on_all_platforms() {
    // The pet's folder in each system's usual place (his card of 10-18; pet-program.ts petDataFolder).
    let w = PlatformPaths::new(Platform::Windows, "C:\\Users\\friend", None, None);
    assert_eq!(w.feed, "C:\\Users\\friend\\AppData\\Roaming\\Coco\\view.json");
    assert_eq!(
        PlatformPaths::new(
            Platform::Windows,
            "C:\\Users\\friend",
            None,
            Some("D:\\Profiles\\friend\\Roaming")
        )
        .settings,
        "D:\\Profiles\\friend\\Roaming\\Coco\\companion.json"
    );
    assert_eq!(
        companion_folder(Platform::Windows, "C:\\Users\\friend", Some("relative")),
        "C:\\Users\\friend\\AppData\\Roaming\\Coco"
    );
    let l = PlatformPaths::new(
        Platform::Linux,
        "/home/friend",
        Some("/run/user/123/state"),
        None,
    );
    assert_eq!(l.feed, "/home/friend/.config/coco-pet/view.json");
    assert_eq!(
        l.snapshot,
        "/run/user/123/state/coco/native-v2/snapshot.json"
    );
    assert_eq!(l.settings, "/home/friend/.config/coco-pet/companion.json");
    // Never ~/.config/coco itself, which holds the line library and the talk key; a relative XDG_CONFIG_HOME is ignored.
    assert_eq!(
        companion_folder(Platform::Linux, "/home/friend", Some("/xdg/config")),
        "/xdg/config/coco-pet"
    );
    assert_eq!(
        companion_folder(Platform::Linux, "/home/friend", Some("relative")),
        "/home/friend/.config/coco-pet"
    );
    assert_eq!(
        PlatformPaths::new(Platform::MacOS, "/Users/friend", None, Some("/xdg/config")).companion,
        "/Users/friend/Library/Application Support/Coco"
    );
    assert_eq!(
        presence_folder("/home/friend", false, Some("relative")),
        "/home/friend/.local/state/coco"
    );
    assert_eq!(
        PlatformPaths::new(Platform::MacOS, "/Users/friend", None, None).presence,
        "/Users/friend/Library/Application Support/Coco-presence/native-v2"
    );
    assert_eq!(
        join_path("C:/Users/Friend/", &["/Library/", "Application Support"]),
        "C:\\Users\\Friend\\Library\\Application Support"
    );
    assert!(same_path("C:\\Users\\Friend\\", "c:/users/friend"));
    assert!(!same_path("/home/Friend", "/home/friend"));
    assert!(windows_path("\\\\server\\share"));
    assert_eq!(join_path("/", &["one"]), "/one")
}
#[test]
fn request_format_bounds_and_timeout_edges() {
    let request = ChannelRequest::new(
        "0123456789abcdef".into(),
        "session".into(),
        1000.0,
        RequestKind::Submit,
        Some("  hi नमस्ते  "),
        None,
    )
    .unwrap();
    assert_eq!(request.text.as_deref(), Some("hi नमस्ते"));
    assert_eq!(
        ChannelRequest::parse(&request.line().unwrap()).unwrap(),
        request
    );
    assert_eq!(
        request_decision(&request, 1000.0, None, 5999.0),
        RequestDecision::Sending
    );
    assert_eq!(
        request_decision(&request, 1000.0, None, 6000.0),
        RequestDecision::Unconfirmed
    );
    assert_eq!(
        request_decision(&request, 1000.0, None, 61000.0),
        RequestDecision::Unconfirmed
    );
    assert_eq!(
        request_decision(&request, 1000.0, None, 61001.0),
        RequestDecision::Expired
    );
    assert_eq!(
        request_decision(&request, 1000.0, Some(&request.id), 61001.0),
        RequestDecision::Acknowledged
    );
    assert!(ChannelRequest::new(
        "0123456789abcdef".into(),
        "s".into(),
        1.0,
        RequestKind::Submit,
        Some("a\0b"),
        None
    )
    .is_err())
}
#[test]
fn cross_session_clear_is_not_a_request_kind_and_legacy_records_are_scrubbed() {
    let line = br#"{"v":1,"id":"0123456789abcdef","session":"s","at":1000,"kind":"clear"}"#;
    assert!(serde_json::from_slice::<RequestKind>(br#""clear""#).is_err());
    assert!(ChannelRequest::parse(line).is_none());
    let folder = std::env::temp_dir().join(format!(
        "companion-legacy-clear-test-{}-{}",
        std::process::id(), coco_companion::epoch_ms()
    ));
    std::fs::create_dir(&folder).unwrap();
    let file = folder.join("requests.jsonl");
    let mut original = line.to_vec();
    original.push(b'\n');
    std::fs::write(&file, &original).unwrap();
    let log = RequestLog::open(&folder, 1000.0).unwrap();
    let scrubbed = std::fs::read(&log.path).unwrap();
    assert_eq!(scrubbed.len(), original.len());
    assert!(scrubbed.iter().all(|b| matches!(b, b' ' | b'\n')));
    assert!(log.next_expiry().is_none());
    std::fs::remove_dir_all(folder).unwrap();
}
#[test]
fn request_redaction_preserves_inode_offsets_and_partial_line() {
    let folder = std::env::temp_dir().join(format!(
        "companion-request-test-{}-{}",
        std::process::id(),
        coco_companion::epoch_ms()
    ));
    std::fs::create_dir(&folder).unwrap();
    std::fs::write(folder.join("requests.jsonl"), b"broken").unwrap();
    let mut log = RequestLog::open(&folder, 1.0).unwrap();
    assert_eq!(std::fs::read(&log.path).unwrap(), b"      \n");
    let request = ChannelRequest::new(
        "0123456789abcdef".into(),
        "s".into(),
        1.0,
        RequestKind::Submit,
        Some("secret text"),
        None,
    )
    .unwrap();
    log.append(request.clone(), 1.0).unwrap();
    log.retry(&request, 2.0).unwrap();
    let before = std::fs::read(&log.path).unwrap();
    log.acknowledge(&request.id).unwrap();
    let after = std::fs::read(&log.path).unwrap();
    assert_eq!(before.len(), after.len());
    assert_eq!(
        before.iter().filter(|b| **b == b'\n').count(),
        after.iter().filter(|b| **b == b'\n').count()
    );
    assert!(after.iter().all(|b| matches!(b, b' ' | b'\n')));
    std::fs::remove_dir_all(folder).unwrap()
}
#[test]
fn shared_presence_deadlines_and_touch_wake_follow_format() {
    // He falls asleep 4 to 6 minutes after the quiet began, drawn from quietAt (DECISIONS 21:38, 10-06).
    let sleep = 1000.0 + sleep_after(1000.0);
    let mut s = PresenceSnapshot::initial(1000.0);
    assert!(s.decide(1000.0, |_| true));
    assert_eq!(s.deadlines(), (Some(sleep), Some(151000.0)));
    assert!(s.decide(151000.0, |_| true));
    assert_eq!(s.event.kind, "clingy");
    assert!(s.decide(sleep, |_| true));
    assert!(s.asleep);
    assert_eq!(s.deadlines(), (None, None));
    assert!(s.wake_on_touch(sleep + 1000.0));
    assert!(!s.asleep);
    assert_eq!(s.event.id, "wake:0:1000");
    assert_eq!(PresenceSnapshot::parse(&s.line().unwrap()).unwrap(), s)
}
#[test]
fn presence_projection_selects_deterministic_language_and_expires() {
    // He falls asleep 4 to 6 minutes after the quiet began, drawn from quietAt (DECISIONS 21:38, 10-06).
    let sleep = 1000.0 + sleep_after(1000.0);
    let mut s = PresenceSnapshot::initial(1000.0);
    s.decide(sleep, |_| true);
    let mut p = PresenceProjection::default();
    p.recipes(&json!({"affection":"clingy","lines":{"en":{"sleep":["sleep one","sleep two"],"wake":["wake line"],"idle":["miss line"]}}}));
    assert!(p.receive(s.clone()));
    let first = p.presence(sleep + 1.0).unwrap();
    assert!(first.said.is_some());
    assert_eq!(first, p.presence(sleep + 1.0).unwrap());
    assert!(p.presence(sleep + 14000.0).unwrap().said.is_none());
    s.wake_on_touch(sleep + 15000.0);
    p.receive(s);
    assert_eq!(
        p.presence(sleep + 15001.0).unwrap().said.as_deref(),
        Some("wake line")
    )
}
#[test]
fn activity_seen_state_uses_session_clocks() {
    let mut s = Sessions::default();
    let mut r = record("s", 100.0, true, true);
    r.done = 100.0;
    r.reply = Some(coco_companion::feed::Reply {
        text: "reply".into(),
        at: 100.0,
    });
    s.receive(r, 100.0);
    assert_eq!(s.unseen_count(100.0), 1);
    assert_eq!(s.rows(100.0)[0].excerpt.as_deref(), Some("reply"));
    assert_eq!(s.open_activity(101.0).len(), 1);
    assert_eq!(s.unseen_count(101.0), 0)
}
fn scratch(label: &str) -> std::path::PathBuf {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    std::env::temp_dir().join(format!(
        "companion-{label}-{}-{}-{}",
        std::process::id(),
        coco_companion::epoch_ms(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ))
}
#[test]
fn native_presence_store_initializes_without_a_session_and_sleeps() {
    // He falls asleep 4 to 6 minutes after the quiet began, drawn from quietAt (DECISIONS 21:38, 10-06).
    let sleep = 1000 + sleep_after(1000.0) as u64;
    use coco_companion::presence_store::PresenceStore;
    let folder = scratch("presence");
    let mut store = PresenceStore::new(folder.clone());
    let initial = store.refresh(1000).unwrap();
    assert_eq!(initial.seq, 1);
    assert_eq!(store.next_deadline(), Some(151000));
    assert_eq!(store.decide(151000).unwrap().unwrap().event.kind, "clingy");
    assert_eq!(store.decide(sleep).unwrap().unwrap().event.kind, "sleep");
    let wake = store.touch(sleep + 1000).unwrap().unwrap();
    assert!(!wake.asleep);
    assert_eq!(wake.event.id, "wake:0:1000");
    assert_eq!(wake.event.at, (sleep + 1000) as f64);
    assert_eq!(
        coco_companion::presence_store::read_snapshot(&folder).unwrap(),
        wake
    );
    std::fs::remove_dir_all(folder).unwrap()
}
#[test]
fn native_presence_store_retains_last_valid_state_on_partial_snapshot() {
    use coco_companion::presence_store::{read_snapshot, PresenceStore};
    let folder = scratch("partial");
    let mut store = PresenceStore::new(folder.clone());
    let first = store.refresh(1000).unwrap();
    std::fs::write(folder.join("snapshot.json"), b"{partial").unwrap();
    assert_eq!(read_snapshot(&folder).unwrap(), first);
    assert_eq!(store.refresh(2000).unwrap(), first);
    std::fs::remove_dir_all(folder).unwrap()
}
#[cfg(unix)]
#[test]
fn native_presence_contention_keeps_local_wake_and_commits_when_unlocked() {
    // He falls asleep 4 to 6 minutes after the quiet began, drawn from quietAt (DECISIONS 21:38, 10-06).
    let sleep = 1000 + sleep_after(1000.0) as u64;
    use coco_companion::presence_store::PresenceStore;
    use std::os::fd::AsRawFd;
    let folder = scratch("contention");
    let mut store = PresenceStore::new(folder.clone());
    store.refresh(1000);
    let sleeping = store.decide(sleep).unwrap().unwrap();
    let lock = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(folder.join(".presence-flock"))
        .unwrap();
    assert_eq!(
        unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) },
        0
    );
    let local = store.touch(sleep + 1000).unwrap().unwrap();
    assert!(!local.asleep);
    assert_eq!(local.seq, sleeping.seq);
    assert!(
        coco_companion::presence_store::read_snapshot(&folder)
            .unwrap()
            .asleep
    );
    unsafe {
        libc::flock(lock.as_raw_fd(), libc::LOCK_UN);
    }
    drop(lock);
    let committed = store.refresh(sleep + 1001).unwrap();
    assert!(!committed.asleep);
    assert_eq!(committed.event.at, (sleep + 1000) as f64);
    assert_eq!(committed.event.id, "wake:0:1000");
    assert_eq!(committed.seq, sleeping.seq + 1);
    std::fs::remove_dir_all(folder).unwrap()
}
#[cfg(unix)]
#[test]
fn request_and_presence_files_reject_symlinks() {
    use coco_companion::presence_store::PresenceStore;
    use std::os::unix::fs::symlink;
    let folder = scratch("symlink");
    std::fs::create_dir(&folder).unwrap();
    let other = folder.join("other");
    std::fs::write(&other, b"sensitive content").unwrap();
    symlink(&other, folder.join("requests.jsonl")).unwrap();
    assert!(RequestLog::open(&folder, 1.0).is_err());
    assert_eq!(std::fs::read(&other).unwrap(), b"sensitive content");
    symlink(&other, folder.join(".presence-flock")).unwrap();
    let mut store = PresenceStore::new(folder.clone());
    assert!(store.refresh(1).is_none());
    assert_eq!(std::fs::read(&other).unwrap(), b"sensitive content");
    std::fs::remove_dir_all(folder).unwrap()
}
#[cfg(unix)]
#[test]
fn snapshot_to_journal_failure_is_repaired_without_a_second_wake() {
    use coco_companion::presence_store::{read_snapshot, PresenceStore};
    use std::os::unix::fs::symlink;
    let folder = scratch("repair");
    let mut store = PresenceStore::new(folder.clone());
    store.refresh(1000);
    let sleep = store.decide(241000).unwrap().unwrap();
    let journal = folder.join("presence.jsonl");
    std::fs::remove_file(&journal).unwrap();
    let other = folder.join("other");
    std::fs::write(&other, b"sensitive").unwrap();
    symlink(&other, &journal).unwrap();
    assert!(store.touch(242000).is_err());
    let committed = read_snapshot(&folder).unwrap();
    assert!(!committed.asleep);
    assert_eq!(committed.seq, sleep.seq + 1);
    std::fs::remove_file(&journal).unwrap();
    let repaired = store.refresh(242001).unwrap();
    assert_eq!(repaired, committed);
    let log = std::fs::read(&journal).unwrap();
    assert_eq!(PresenceSnapshot::parse(&log).unwrap(), committed);
    assert_eq!(std::fs::read(&other).unwrap(), b"sensitive");
    std::fs::remove_dir_all(folder).unwrap()
}
#[test]
fn oversized_request_lines_are_scrubbed_with_bounded_chunks() {
    let folder = scratch("oversized");
    std::fs::create_dir(&folder).unwrap();
    let mut input = vec![b'x'; 1024 * 1024];
    input.push(b'\n');
    std::fs::write(folder.join("requests.jsonl"), &input).unwrap();
    let log = RequestLog::open(&folder, 1.0).unwrap();
    let output = std::fs::read(log.path).unwrap();
    assert_eq!(input.len(), output.len());
    assert!(output[..output.len() - 1].iter().all(|b| *b == b' '));
    assert_eq!(output.last(), Some(&b'\n'));
    std::fs::remove_dir_all(folder).unwrap()
}

#[test]
fn pathological_motion_cannot_allocate_an_unbounded_schedule() {
    let mut model = MotionModel::default();
    model.think = coco_companion::motion::Hold {
        median: f64::from_bits(1),
        sigma: 0.0,
        min: f64::from_bits(1),
        max: f64::from_bits(1),
    };
    assert!(model.valid());
    let timeline = Timeline::looping(&model, MotionKind::Think, &mut SeededRandom::new(1));
    assert!(timeline.changes.len() <= 65537);
    assert_eq!(timeline.duration_ms, model.sequence_ms);
}

#[test]
fn touch_presence_clock_does_not_move_backward() {
    let mut s = PresenceSnapshot::initial(1000.0);
    s.asleep = true;
    assert!(s.wake_on_touch(900.0));
    assert_eq!(s.quiet_at, 1000.0);
    assert_eq!(s.event.at, 1000.0);
    assert_eq!(s.event.id, "wake:0:1000");
}
