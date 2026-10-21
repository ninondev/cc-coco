//! Whom the Linux pet stands by (lane C, 10-17 late, A's ask): on X11, Claude's desktop app until the person picks
//! another window, stops following, or puts her down by hand; each of those choices is kept across restarts.
use coco_companion::{engine::Engine, render::Size, Options};
use std::path::PathBuf;

struct Scratch {
    root: PathBuf,
}
impl Scratch {
    fn new() -> Self {
        use std::sync::atomic::{AtomicU64, Ordering};
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let root = std::env::temp_dir().join(format!(
            "companion-follow-{}-{}-{}",
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
            presence_folder: None,
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
fn claude_is_followed_until_the_person_chooses_and_their_choice_is_kept() {
    let scratch = Scratch::new();
    let fresh = Engine::new(scratch.options(), 1_000, 1).unwrap();
    assert!(fresh.follow_unchosen());
    drop(fresh);

    // Picking a window is a choice; so is stopping, which is remembered past a restart.
    let mut engine = Engine::new(scratch.options(), 2_000, 2).unwrap();
    engine.set_follow_wm_class("kitty".into(), "kitty".into()).unwrap();
    assert!(!engine.follow_unchosen());
    engine.clear_follow_wm_class().unwrap();
    assert!(engine.follow_wm_class().is_none());
    drop(engine);
    let restarted = Engine::new(scratch.options(), 3_000, 3).unwrap();
    assert!(!restarted.follow_unchosen());
    assert!(restarted.follow_wm_class().is_none());

    // Put down by hand somewhere on the screen: she stays there instead.
    let other = Scratch::new();
    let mut moved = Engine::new(other.options(), 1_000, 4).unwrap();
    moved.set_manual_position(0.4, 0.6).unwrap();
    drop(moved);
    assert!(!Engine::new(other.options(), 2_000, 5).unwrap().follow_unchosen());

    // A class given on the command line is the person's (or the plugin's) choice too.
    let given = Scratch::new();
    let options = Options { follow_class: Some("com.example.Editor".into()), ..given.options() };
    assert!(!Engine::new(options, 1_000, 6).unwrap().follow_unchosen());
}
