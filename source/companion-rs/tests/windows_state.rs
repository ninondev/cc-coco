#[path = "../src/platform/windows_notice_state.rs"]
mod gate;
use gate::{Candidate, NoticeGate};
mod motion {
    pub use coco_companion::motion::{PlaceMode, ScreenRect};
}
#[path = "../src/platform/windows_place.rs"]
mod placement;
mod ui {
    pub use coco_companion::ui::*;
}
mod feed {
    pub use coco_companion::feed::Record;
}
mod render {
    pub use coco_companion::render::Size;
}
#[path = "../src/platform/windows_composer.rs"]
mod composer;
#[path = "../src/platform/windows_menu.rs"]
mod native_menu;
#[path = "../src/platform/windows_tray.rs"]
mod native_tray;
#[path = "../src/platform/windows_text.rs"]
mod text_range;
fn candidate(done: u64) -> Candidate {
    Candidate {
        session: "a".into(),
        done,
        busy_since: 1,
        enabled: true,
        quiet: true,
        waiting: false,
    }
}
#[test]
fn notice_baseline_never_replays_a_finished_task() {
    let mut gate = NoticeGate::default();
    assert!(!gate.observe(&candidate(200_000), 200_000, || panic!(
        "baseline samples no input"
    )));
    assert!(!gate.observe(&candidate(200_000), 210_000, || panic!(
        "duplicate samples no input"
    )));
}
#[test]
fn notice_requires_long_quiet_approved_task_and_samples_away_once() {
    let mut gate = NoticeGate::default();
    gate.observe(&candidate(0), 1, || false);
    let mut busy = candidate(130_000);
    busy.quiet = false;
    assert!(!gate.observe(&busy, 130_000, || panic!("still running")));
    let mut quiet = busy.clone();
    quiet.quiet = true;
    assert!(gate.observe(&quiet, 130_000, || true));
    assert!(!gate.observe(&quiet, 130_001, || panic!("duplicate")));
    let mut disabled = candidate(800_000);
    disabled.enabled = false;
    assert!(!gate.observe(&disabled, 800_000, || panic!("disabled")));
    let mut waiting = candidate(900_000);
    waiting.waiting = true;
    assert!(!gate.observe(&waiting, 900_000, || panic!("permission task")));
    let mut short = candidate(910_000);
    short.busy_since = 900_000;
    assert!(!gate.observe(&short, 910_000, || panic!("short task")));
}
#[test]
fn notice_throttle_is_per_session_and_present_task_is_consumed() {
    let mut gate = NoticeGate::default();
    gate.observe(&candidate(0), 1, || false);
    assert!(gate.observe(&candidate(130_000), 130_000, || true));
    assert!(!gate.observe(&candidate(260_000), 260_000, || panic!("throttled")));
    let mut other = candidate(0);
    other.session = "b".into();
    gate.observe(&other, 260_000, || false);
    other.done = 270_000;
    assert!(gate.observe(&other, 270_000, || true));
    assert!(!gate.observe(&candidate(750_000), 750_000, || false));
    assert!(!gate.observe(&candidate(750_000), 760_000, || panic!(
        "returning later cannot replay"
    )));
    assert!(gate.observe(&candidate(880_000), 880_000, || true));
}

#[test]
fn supported_hosts_use_only_exact_case_insensitive_image_basenames() {
    assert!(placement::supported_image(
        "C:\\Program Files\\Claude\\ClAuDe.ExE"
    ));
    assert!(placement::supported_image(
        "C:\\Program Files\\VS Code\\CODE.exe"
    ));
    for other in [
        "C:\\Claude.exe\\notepad.exe",
        "Claude.exe.old",
        "VSCode.exe",
        "claude",
    ] {
        assert!(!placement::supported_image(other));
    }
}
#[test]
fn placement_retains_and_squeezes_live_ledge_then_relocates_after_release() {
    use motion::{PlaceMode, ScreenRect};
    let screen = ScreenRect {
        x: 0.,
        y: 0.,
        width: 1000.,
        height: 800.,
    };
    let window = ScreenRect {
        x: 100.,
        y: 200.,
        width: 600.,
        height: 400.,
    };
    let first = placement::place(
        screen,
        screen,
        Some(window),
        [100., 100.],
        None,
        false,
        None,
    );
    assert_eq!(first.mode, PlaceMode::Ledge);
    assert_eq!((first.frame.x, first.frame.y), (536., 105.));
    let squeezed = ScreenRect { y: 40., ..window };
    let live = placement::place(
        screen,
        screen,
        Some(squeezed),
        [100., 100.],
        Some(first),
        true,
        None,
    );
    assert_eq!(live.mode, PlaceMode::Ledge);
    assert_eq!(live.room, 0.43);
    assert!(!live.horizontal);
    let released = placement::place(
        screen,
        screen,
        Some(squeezed),
        [100., 100.],
        Some(live),
        false,
        None,
    );
    assert_eq!(released.mode, PlaceMode::BesideRight);
    assert_eq!(released.frame.x, 710.);
    let no_host = placement::place(
        screen,
        screen,
        None,
        [100., 100.],
        Some(released),
        false,
        None,
    );
    assert_eq!(no_host.mode, PlaceMode::Corner);
    assert_eq!((no_host.frame.x, no_host.frame.y), (888., 688.));
}
#[test]
fn placement_retains_horizontal_contact_and_pressure_direction() {
    use motion::{PlaceMode, ScreenRect};
    let screen = ScreenRect {
        x: 0.,
        y: 0.,
        width: 1000.,
        height: 800.,
    };
    let window = ScreenRect {
        x: 100.,
        y: 40.,
        width: 600.,
        height: 400.,
    };
    let first = placement::place(
        screen,
        screen,
        Some(window),
        [100., 100.],
        None,
        false,
        None,
    );
    assert_eq!(first.mode, PlaceMode::BesideRight);
    let enlarged = ScreenRect {
        width: 840.,
        ..window
    };
    let live = placement::place(
        screen,
        screen,
        Some(enlarged),
        [100., 100.],
        Some(first),
        true,
        None,
    );
    assert_eq!(live.mode, PlaceMode::BesideRight);
    assert!(live.horizontal);
    assert_eq!(live.push_sign, 1.);
    assert_eq!(live.room, 0.54);
    assert_eq!(live.frame.x, 898.);
    let released = placement::place(
        screen,
        screen,
        Some(enlarged),
        [100., 100.],
        Some(live),
        false,
        None,
    );
    assert_eq!(released.mode, PlaceMode::Below);
    assert_eq!(released.frame.y, 444.);
}
#[test]
fn owned_edit_focus_after_tab_away_preserves_and_reconciles_input() {
    use coco_companion::feed::{Record, Sessions};
    let mut sessions = Sessions::default();
    let mut record = Record::resting();
    record.session = "a".into();
    record.channel = true;
    record.at = 1000.;
    sessions.receive(record, 1001.);
    let mut ui = ui::UiState::default();
    ui.open_activity(&sessions, 1001.);
    ui.text("before");
    ui.focus = Some(ui::Control::Send);
    composer::reconcile(&mut ui, "after 🦊", 7, true);
    assert_eq!(ui.focus, Some(ui::Control::Field));
    assert_eq!(ui.field, "after 🦊");
    assert_eq!(ui.cursor, 7);
    composer::reconcile(&mut ui, "foreign", 0, false);
    assert_eq!(ui.field, "after 🦊");
    composer::reconcile_selection(&mut ui, "after 🦊", 7, 2, true);
    assert_eq!(ui.selection, Some((7, 2)));
    assert_eq!(ui.cursor, 2);
    composer::reconcile(&mut ui, "aZb", 2, true);
    assert_eq!(ui.field, "aZb");
    assert_eq!(ui.selection, None);
}
#[test]
fn initial_wts_lock_flags_are_not_assumed_unlocked() {
    assert_eq!(placement::session_locked(0), Some(true));
    assert_eq!(placement::session_locked(1), Some(false));
    assert_eq!(placement::session_locked(-1), None);
}
#[test]
fn ledge_host_occlusion_uses_only_existing_rectangle_geometry() {
    use motion::{PlaceMode, ScreenRect};
    let host = ScreenRect {
        x: 100.,
        y: 200.,
        width: 600.,
        height: 400.,
    };
    let clip =
        placement::host_clip(PlaceMode::Ledge, Some(host), [500., 105.], [320., 300.]).unwrap();
    assert_eq!(
        (clip.x, clip.y, clip.width, clip.height),
        (0., 95., 200., 205.)
    );
    assert!(placement::host_clip(
        PlaceMode::BesideRight,
        Some(host),
        [710., 340.],
        [320., 300.]
    )
    .is_none());
    assert!(placement::host_clip(PlaceMode::Ledge, None, [500., 105.], [320., 300.]).is_none());
}
#[test]
fn text_range_preserves_utf16_surrogates_and_caret_endpoint_rules() {
    use text_range::{Span, Unit};
    let text = "a🦊b";
    assert_eq!(text_range::scalar_to_utf16(text, 2), 3);
    assert_eq!(text_range::utf16_to_scalar(text, 3), 2);
    let mut span = Span::new(text, 1, 3);
    assert_eq!(span.text(text, -1), "🦊");
    assert_eq!(span.text(text, 1), "");
    assert_eq!(span.move_endpoint(text, true, Unit::Character, 1), 1);
    assert_eq!((span.start, span.end), (3, 3));
    assert_eq!(span.move_endpoint(text, false, Unit::Character, -2), -2);
    assert_eq!((span.start, span.end), (0, 0));
    assert_eq!(span.move_by(text, Unit::Character, 99), 3);
    assert_eq!((span.start, span.end), (4, 4));
    assert_eq!(span.move_by(text, Unit::Character, -1), -1);
    assert_eq!((span.start, span.end), (3, 3));
}
#[test]
fn text_range_word_document_find_and_clone_are_independent() {
    use text_range::{Span, Unit};
    let text = "One two 🦊";
    let mut span = Span::new(text, 1, 1);
    span.expand(text, Unit::Word);
    assert_eq!(span.text(text, -1), "One ");
    assert_eq!(span.move_by(text, Unit::Word, 1), 1);
    assert_eq!(span.text(text, -1), "two ");
    let mut cloned = span;
    cloned.expand(text, Unit::Document);
    assert_eq!(span.text(text, -1), "two ");
    let found = cloned.find(text, "TWO", false, true).unwrap();
    assert_eq!(found.text(text, -1), "two");
    assert!(cloned.find(text, "absent", false, true).is_none());
}
#[test]
fn retained_text_range_normalizes_after_the_composer_changes() {
    use text_range::Span;
    let old = Span::new("a🦊b", 1, 3);
    assert_eq!(
        old.find("🦊bc", "🦊", false, false),
        Some(Span { start: 0, end: 2 })
    );
    assert_eq!(
        old.find("🦊bc", "", false, false),
        Some(Span { start: 0, end: 0 })
    );
    let changed = Span::new("İ", 0, 1)
        .find("İ", "i\u{307}", false, true)
        .unwrap();
    assert_eq!(changed, Span { start: 0, end: 1 });
}
#[test]
fn visible_text_range_keeps_the_last_non_bmp_character() {
    use text_range::Span;
    assert_eq!(Span::visible("a🦊", 0, 1), Span { start: 0, end: 3 });
    assert_eq!(Span::visible("", 0, 0), Span { start: 0, end: 0 });
    assert_eq!(Span::visible("🦊b", 1, 2), Span { start: 0, end: 3 });
    assert_eq!(Span::visible("אבגד", 3, 0), Span { start: 0, end: 4 });
}
#[test]
fn text_geometry_hull_handles_rtl_mixed_direction_and_clipping() {
    assert_eq!(
        text_range::visible_extent(&[(60, 40), (40, 20)], 0, 80),
        Some((20, 60))
    );
    assert_eq!(
        text_range::visible_extent(&[(0, 12), (60, 40), (40, 20)], 8, 50),
        Some((8, 50))
    );
    assert_eq!(text_range::visible_extent(&[(-20, -10)], 0, 80), None);
    assert_eq!(text_range::visible_extent(&[], 0, 80), None);
    assert_eq!(
        text_range::visible_spans(&[(0, 1, 60, 40), (1, 2, 100, 120), (2, 4, 20, 0)], 0, 80),
        vec![
            text_range::Span { start: 0, end: 1 },
            text_range::Span { start: 2, end: 4 }
        ]
    );
}
#[test]
fn front_pages_restore_only_visible_host_intersection_pixels() {
    use motion::ScreenRect;
    let source = [
        10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 11, 21, 31, 41, 51, 61, 71, 81, 91, 101,
        111, 121,
    ];
    let original = source;
    let clip = ScreenRect {
        x: 1.,
        y: 0.,
        width: 2.,
        height: 1.,
    };
    let masked = placement::front_page_mask(3, 2, &source, clip).unwrap();
    assert_eq!(&masked[..4], &[0; 4]);
    assert_eq!(&masked[4..12], &source[4..12]);
    assert_eq!(&masked[12..], &[0; 12]);
    assert_eq!(source, original);
}
#[test]
fn front_pages_have_no_layer_when_intersection_is_clear_or_outside() {
    use motion::ScreenRect;
    let outside = ScreenRect {
        x: 3.,
        y: 0.,
        width: 1.,
        height: 1.,
    };
    let inside = ScreenRect {
        x: 0.,
        y: 0.,
        width: 1.,
        height: 1.,
    };
    assert!(placement::front_page_mask(1, 1, &[1, 2, 3, 255], outside).is_none());
    assert!(placement::front_page_mask(1, 1, &[0; 4], inside).is_none());
    assert!(placement::front_page_mask(1, 1, &[0; 3], inside).is_none());
}
#[test]
fn failed_front_page_interval_falls_back_without_retries_and_next_interval_recovers() {
    let mut gate = placement::FrontPageGate::default();
    assert!(gate.may_present(true));
    gate.failed();
    assert!(!gate.may_present(true));
    assert!(!gate.may_present(true));
    assert!(!gate.may_present(false));
    assert!(gate.may_present(true));
    assert!(gate.may_present(true));
    gate.failed();
    assert!(!gate.may_present(false));
    assert!(!gate.may_present(false));
    assert!(gate.may_present(true));
}
#[test]
fn system_menu_has_enabled_reading_and_checked_size_submenu_without_default_command() {
    use coco_companion::{
        feed::Record,
        render::Size,
        ui::{MenuAction, MenuContext, Quota},
    };
    let mut record = Record::resting();
    record.quota =
        Quota::parse(&serde_json::json!({"windows":[{"kind":"five_hour","percentUsed":50}]}));
    let context = MenuContext {
        size: Size::Medium,
        ..Default::default()
    };
    let rows = native_menu::plan(&record, &context);
    assert_eq!(rows[0].action, Some(MenuAction::Activity));
    assert!(rows[0].enabled);
    assert_eq!(rows[1].action, Some(MenuAction::Activity));
    let submenu = rows.iter().find(|r| !r.children.is_empty()).unwrap();
    assert_eq!(submenu.children.len(), 3);
    assert_eq!(submenu.children.iter().filter(|r| r.checked).count(), 1);
    assert_eq!(
        submenu.children.iter().find(|r| r.checked).unwrap().action,
        Some(MenuAction::Size(Size::Medium))
    );
    assert_eq!(native_menu::selection(&rows, 0), None);
    assert_eq!(
        native_menu::selection(&rows, rows[0].command),
        Some(MenuAction::Activity)
    );
    for item in &submenu.children {
        assert_eq!(native_menu::selection(&rows, item.command), item.action);
    }
    assert_eq!(native_menu::selection(&rows, 999), None);
    let mut disabled = rows.clone();
    disabled
        .iter_mut()
        .find(|row| !row.children.is_empty())
        .unwrap()
        .enabled = false;
    assert_eq!(native_menu::selection(&disabled, 100), None);
    for current in Size::ALL {
        let sizes = native_menu::sizes(&record, current);
        assert_eq!(sizes.iter().filter(|row| row.checked).count(), 1);
        assert_eq!(
            sizes.iter().find(|row| row.checked).unwrap().action,
            Some(MenuAction::Size(current))
        );
    }
}
#[test]
fn system_menu_back_names_only_exact_os_host_images_and_disappears_without_host() {
    use coco_companion::{
        feed::Record,
        ui::{MenuAction, MenuContext},
    };
    let mut record = Record::resting();
    let context = MenuContext::default();
    assert!(!native_menu::plan(&record, &context)
        .iter()
        .any(|row| row.action == Some(MenuAction::Back)));
    record.words.insert("back".into(), "Back to {app}".into());
    let available = MenuContext {
        back_available: true,
        back_app: "Visual Studio Code".into(),
        ..Default::default()
    };
    assert_eq!(
        native_menu::plan(&record, &available)
            .into_iter()
            .find(|row| row.action == Some(MenuAction::Back))
            .unwrap()
            .label,
        "Back to Visual Studio Code"
    );
    assert_eq!(
        native_menu::app_from_image(r"C:\Program Files\VS Code\cOdE.ExE"),
        Some("Visual Studio Code")
    );
    assert_eq!(
        native_menu::app_from_image(r"C:\Users\x\Claude.exe"),
        Some("Claude")
    );
    assert_eq!(native_menu::app_from_image("Claude.exe.bak"), None);
    assert_eq!(native_menu::app_from_image("Other.exe"), None);
}
#[test]
fn tray_sleep_and_unseen_are_independent_and_dpi_is_part_of_icon_reload_key() {
    let awake = native_tray::icon_key(false, 0, 96);
    assert_eq!(awake.image, "awake");
    assert_eq!(awake.size, 16);
    assert_eq!(native_tray::icon_key(true, 2, 96).image, "asleep-unseen");
    assert_eq!(native_tray::icon_key(true, 0, 96).image, "asleep");
    assert_eq!(native_tray::icon_key(false, 2, 96).image, "unseen");
    assert_eq!(
        native_tray::icon_key(false, 1, 96),
        native_tray::icon_key(false, 99, 96)
    );
    assert_ne!(
        native_tray::icon_key(false, 1, 96),
        native_tray::icon_key(false, 1, 168)
    );
    for (dpi, size) in [
        (96, 16),
        (120, 20),
        (144, 24),
        (168, 28),
        (192, 32),
        (216, 36),
        (240, 40),
        (288, 48),
        (384, 64),
    ] {
        assert_eq!(native_tray::icon_key(false, 0, dpi).size, size);
    }
}

#[test]
fn native_hover_uses_control_identity_after_back_is_omitted_and_badge_is_inserted() {
    use coco_companion::ui::{Control, UiState};
    let mut ui = UiState::default();
    ui.hover_visible = true;
    ui.unseen = 2;
    ui.context.back_available = false;
    let lines = ui
        .elements()
        .into_iter()
        .find(|e| e.control == Control::Hover(2))
        .unwrap();
    assert_eq!(
        composer::pointer(&mut ui, lines.bounds.x + 12., lines.bounds.y + 12.),
        Some(Control::Hover(2))
    );
    assert_eq!(ui.hover_index, Some(2));
    assert!(!ui.elements().iter().any(|e| e.control == Control::Badge));
    assert_eq!(composer::pointer(&mut ui, -100., -100.), None);
    assert_eq!(ui.hover_index, None);
    let badge = ui
        .elements()
        .into_iter()
        .find(|e| e.control == Control::Badge)
        .unwrap();
    assert_eq!(
        composer::pointer(&mut ui, badge.bounds.x + 1., badge.bounds.y + 1.),
        Some(Control::Badge)
    );
    assert_eq!(ui.hover_index, None);
    assert_eq!(ui.hovered, Some(Control::Badge));
    assert_eq!(composer::pointer(&mut ui, -100., -100.), None);
    assert_eq!(ui.hovered, None);
}
