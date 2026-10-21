use coco_companion::{
    engine::{atomic_write, Engine},
    state::{apply_windows_session_message, omit_away, WTS_SESSION_LOCK, WTS_SESSION_UNLOCK},
    Options,
};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

struct Folder(PathBuf);
impl Folder {
    fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "companion-r3-away-{}-{}-{}",
            std::process::id(),
            coco_companion::epoch_ms(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
    fn state(&self) -> PathBuf {
        self.0.join("companion.json")
    }
}
impl Drop for Folder {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}
fn read(path: &Path) -> Value {
    serde_json::from_slice(&fs::read(path).unwrap()).unwrap()
}
fn dispatch(path: &Path, state: &mut Value, message: u32, now: u64) -> bool {
    let changed = apply_windows_session_message(state, message, now);
    if changed {
        atomic_write(path, &serde_json::to_vec_pretty(state).unwrap()).unwrap();
    }
    changed
}
fn options(folder: &Folder) -> Options {
    Options {
        folder: folder.0.clone(),
        presence_folder: None,
        assets: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../assets"),
        size: coco_companion::render::Size::Medium,
        reduce_motion: true,
        follow_class: None,
        trace: false,
        login: false,
    }
}

#[test]
fn windows_lock_and_unlock_messages_round_trip_companion_json() {
    let folder = Folder::new();
    let mut state =
        json!({"size":"medium","running":true,"manual":{"anchor":"screen","x":0.2,"y":0.3}});
    assert!(dispatch(
        &folder.state(),
        &mut state,
        WTS_SESSION_LOCK,
        1_791_280_000_123
    ));
    let locked = read(&folder.state());
    assert_eq!(
        locked["away"],
        json!({"state":"locked","since":1_791_280_000_123u64})
    );
    assert_eq!(locked["manual"], json!({"anchor":"screen","x":0.2,"y":0.3}));
    assert!(dispatch(
        &folder.state(),
        &mut state,
        WTS_SESSION_UNLOCK,
        1_791_280_020_456
    ));
    let unlocked = read(&folder.state());
    assert_eq!(
        unlocked["away"],
        json!({"state":null,"since":1_791_280_020_456u64})
    );
    assert_eq!(unlocked["size"], "medium");
    assert_eq!(unlocked["running"], true);
}

#[test]
fn duplicate_and_unrelated_wts_messages_preserve_the_changed_timestamp() {
    let folder = Folder::new();
    let mut state = json!({});
    assert!(dispatch(
        &folder.state(),
        &mut state,
        WTS_SESSION_UNLOCK,
        1000
    ));
    let original = fs::read(folder.state()).unwrap();
    assert!(!dispatch(
        &folder.state(),
        &mut state,
        WTS_SESSION_UNLOCK,
        2000
    ));
    assert!(!dispatch(&folder.state(), &mut state, 5, 3000)); // WTS_SESSION_LOGON.
    assert_eq!(fs::read(folder.state()).unwrap(), original);
    assert_eq!(
        read(&folder.state())["away"],
        json!({"state":null,"since":1000})
    );
    assert!(dispatch(
        &folder.state(),
        &mut state,
        WTS_SESSION_LOCK,
        4000
    ));
    assert!(!dispatch(
        &folder.state(),
        &mut state,
        WTS_SESSION_LOCK,
        5000
    ));
    assert_eq!(
        read(&folder.state())["away"],
        json!({"state":"locked","since":4000})
    );
}

#[test]
fn linux_omits_inherited_away_without_losing_settings() {
    let folder = Folder::new();
    let mut state = json!({"away":{"state":"locked","since":1000},"size":"small","login":false});
    assert!(omit_away(&mut state));
    atomic_write(&folder.state(), &serde_json::to_vec_pretty(&state).unwrap()).unwrap();
    let restored = read(&folder.state());
    assert!(!restored.as_object().unwrap().contains_key("away"));
    assert_eq!(restored["size"], "small");
    assert_eq!(restored["login"], false);
    assert!(!omit_away(&mut state));
}

#[cfg(not(target_os = "linux"))]
#[test]
fn engine_persists_wts_messages_and_broadcasts_the_same_away_payload() {
    let folder = Folder::new();
    let mut engine = Engine::new(options(&folder), 1000, 42).unwrap();
    engine.mark_running(true).unwrap();
    assert!(engine.session_lock_message(WTS_SESSION_LOCK, 1100).unwrap());
    assert_eq!(
        read(&folder.state())["away"],
        json!({"state":"locked","since":1100})
    );
    assert!(engine
        .session_lock_message(WTS_SESSION_UNLOCK, 1500)
        .unwrap());
    assert_eq!(
        read(&folder.state())["away"],
        json!({"state":null,"since":1500})
    );
    engine.record_login_success(false).unwrap();
    assert_eq!(
        read(&folder.state())["away"],
        json!({"state":null,"since":1500})
    );
    let events = fs::read_to_string(folder.0.join("requests.jsonl")).unwrap();
    let states = events
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter(|event| event["kind"] == "companion-state")
        .collect::<Vec<_>>();
    assert!(states
        .iter()
        .any(|event| event["info"]["away"] == json!({"state":"locked","since":1100})));
    assert_eq!(
        states.last().unwrap()["info"]["away"],
        json!({"state":null,"since":1500})
    );
    drop(engine);
}

#[cfg(target_os = "linux")]
#[test]
fn linux_engine_never_rewrites_an_inherited_windows_away_signal() {
    let folder = Folder::new();
    atomic_write(
        &folder.state(),
        br#"{"away":{"state":"locked","since":1000},"size":"small"}"#,
    )
    .unwrap();
    let mut engine = Engine::new(options(&folder), 2000, 42).unwrap();
    engine.mark_running(true).unwrap();
    assert!(!read(&folder.state())
        .as_object()
        .unwrap()
        .contains_key("away"));
    engine.record_login_success(false).unwrap();
    assert!(!read(&folder.state())
        .as_object()
        .unwrap()
        .contains_key("away"));
    drop(engine);
}
