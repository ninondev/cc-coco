use coco_companion::{
    decor::{CompactPhase, ShedEvent},
    engine::Engine,
    feed::Record,
    render::Size,
    Options,
};
fn engine(size: Size) -> Engine {
    Engine::new(
        Options {
            folder: std::env::temp_dir()
                .join(format!("e2-r3-schedule-absent-{}", std::process::id())),
            presence_folder: None,
            assets: std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../assets"),
            size,
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
fn record() -> Record {
    let mut r = Record::resting();
    r.session = "r3-schedule".into();
    r.at = 1000.;
    r
}
#[test]
fn native_shed_holds_her_shell_pose_and_has_no_invisible_art_frames() {
    for size in [Size::Medium, Size::Large] {
        let mut e = engine(size);
        let mut r = record();
        r.shed = Some(ShedEvent {
            generation: 1,
            phase: CompactPhase::End,
            at: 1000,
        });
        e.preview_record(r, 1000);
        assert_eq!(
            e.next_deadline_ms(1000),
            Some(2600),
            "{size:?}: painted art-only fade must not wake native windows"
        );
        assert_eq!(e.next_deadline_ms(1700), Some(2600));
        let during = e.render_companion(1000, 1.);
        assert!(during.front_pages.is_none());
        let after = e.render_companion(2600, 1.);
        // Her own shell change is the pose; she keeps it (reduced motion draws no clip) and the
        // painted skin and pages are not drawn for her.
        assert!(after.front_pages.is_none());
        assert_eq!(e.coco_state().map(|s| s.1), Some("shell"));
        assert!(
            during.pixels == after.pixels,
            "the shell pose holds after the old painted pose would have returned"
        );
        assert_eq!(e.next_deadline_ms(2600), None);
    }
}
