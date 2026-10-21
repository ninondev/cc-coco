use coco_companion::{
    feed::{Record, Sessions},
    render::Canvas,
    ui::*,
};
fn activity() -> UiState {
    let mut s = Sessions::default();
    let mut r = Record::resting();
    r.session = "r2".into();
    r.project = "project".into();
    r.channel = true;
    r.at = 1000.;
    r.done = 1000.;
    s.receive(r, 1001.);
    let mut u = UiState::default();
    u.open_activity(&s, 1001.);
    u
}
#[test]
fn send_is_a_full_strength_28_point_circle_even_when_blank() {
    let u = activity();
    let b = u
        .elements()
        .into_iter()
        .find(|e| e.control == Control::Send)
        .unwrap()
        .bounds;
    assert_eq!((b.x, b.width, b.height), (290., 28., 28.));
    let c = u.render(1.);
    let i = ((b.y as u32 + 14) * c.width + 295) as usize * 4;
    assert_eq!(&c.pixels[i..i + 4], &[158, 65, 35, 255]);
}
#[test]
fn close_word_is_measured_in_german() {
    let mut u = activity();
    u.chosen.lang = "de".into();
    let e = u
        .elements()
        .into_iter()
        .find(|e| e.control == Control::Close)
        .unwrap();
    assert!(e.bounds.width > 60., "{}", e.bounds.width);
    assert_eq!(e.bounds.x + e.bounds.width, 318.);
}
#[test]
fn x11_follow_remains_available_while_following() {
    let u = activity();
    let rows = menu_rows(
        &u.chosen,
        &MenuContext {
            platform: UiPlatform::X11,
            following: true,
            back_available: true,
            ..Default::default()
        },
    );
    assert!(rows
        .iter()
        .any(|r| r.action == Some(MenuAction::BeginFollow)));
    assert!(rows
        .iter()
        .any(|r| r.action == Some(MenuAction::StopFollow)));
}
#[test]
fn menu_opens_without_a_highlight_and_reading_opens_activity() {
    let mut u = activity();
    u.chosen.quota = Some(Quota::example());
    u.open_menu(Default::default(), 0);
    assert_eq!(u.focus, None);
    assert_eq!(u.menu[0].action, Some(MenuAction::Activity));
    assert!(u.menu[0].enabled);
}
#[test]
fn unavailable_back_is_absent_from_hover_tree() {
    let mut u = activity();
    u.close();
    u.hover_visible = true;
    u.context.platform = UiPlatform::Wayland;
    assert_eq!(u.elements().len(), 4);
    assert!(!u.tab_order().contains(&Control::Hover(1)));
}
#[test]
fn one_line_excerpt_uses_48_points() {
    let mut u = activity();
    u.rows[0].excerpt = Some("one line".into());
    let b = u
        .elements()
        .into_iter()
        .find(|e| matches!(e.control, Control::Row(_)))
        .unwrap()
        .bounds;
    assert_eq!(b.height, 48.);
}
// The excerpt box is the row less 32 points: two lines of 16. Linux fonts have taller line boxes than 16 points
// (Noto CJK: 18 at 12 points), so there the excerpt is painted on the 16 point pitch, or its second line is dropped.
#[cfg(target_os = "linux")]
#[test]
fn long_excerpt_keeps_both_lines_in_its_box_whatever_the_font() {
    let mut u = activity();
    let excerpt = "this excerpt is long enough that it has to wrap onto a second line in the activity row of the companion";
    u.rows[0].excerpt = Some(excerpt.into());
    let row = u
        .elements()
        .into_iter()
        .find(|e| matches!(e.control, Control::Row(_)))
        .unwrap()
        .bounds;
    assert_eq!(row.height, 64.);
    let c = u.render(1.);
    let run = c.texts.iter().find(|r| r.text == excerpt).unwrap();
    assert_eq!(run.line_height, Some(16.));
    assert_eq!(run.height, 32.);
    let shown = text_metrics_with_line_height(
        excerpt,
        "en",
        12.,
        false,
        false,
        run.width,
        run.height,
        run.line_height,
    )
    .1;
    assert_eq!(shown, 32., "both lines fit the 32 point box");
}
#[test]
fn target_list_overlays_the_activity_paper() {
    let mut u = activity();
    let mut r = u.chosen.clone();
    r.session = "other".into();
    u.sessions.push(r);
    let before = u.dimensions();
    u.activate(Control::Target, 1002);
    assert_eq!(u.dimensions().0, before.0);
    assert!(u.dimensions().1 >= before.1);
    assert!(u.elements().iter().any(|e| e.control == Control::Close));
}
#[test]
fn shapes_have_partial_coverage() {
    let mut c = Canvas::blank(40, 40);
    rounded(
        &mut c,
        Rect {
            x: 2.,
            y: 2.,
            width: 25.,
            height: 25.,
        },
        9.,
        [250, 238, 233, 255],
        1.,
    );
    assert!(c.pixels.chunks_exact(4).any(|p| p[3] > 0 && p[3] < 255));
}
#[test]
fn quota_accepts_iso_reset_and_missing_pace() {
    let q=Quota::parse(&serde_json::json!({"windows":[{"kind":"five_hour","resetsAt":"2026-10-05T21:30:00Z","percentUsed":0}]})).unwrap();
    assert_eq!(q.windows[0].reset, Some(1791235800000.));
    assert_eq!(q.windows[0].pace, None);
}
#[test]
fn narrow_quota_names_follow_the_language() {
    let q = Quota::example();
    let s = q.narrow("zh");
    assert!(!s.contains("5-hour"));
    assert!(!s.contains("7-day"));
}
#[test]
fn back_app_slots_are_filled() {
    let mut u = activity();
    u.chosen.words.insert("back".into(), "Back to {app}".into());
    u.chosen.words.insert("opens".into(), "Opens {app}.".into());
    u.context.back_available = true;
    let rows = menu_rows(&u.chosen, &u.context);
    assert!(!rows.iter().any(|r| r.label.contains("{app}")));
    assert!(!u.elements().iter().any(|e| e.label.contains("{app}")));
}
#[test]
fn quit_uses_its_own_word() {
    let mut u = activity();
    u.chosen.lang = "ja".into();
    let rows = menu_rows(&u.chosen, &Default::default());
    // the app is called Coco Pet since the rename round (DECISIONS 911); feed.json carries the word
    assert_eq!(rows.last().unwrap().label, "Coco Petを終了");
}

#[test]
fn blank_send_remains_in_tab_order_but_never_creates_a_request() {
    let mut u = activity();
    assert!(u.enabled(&Control::Send));
    u.focus = Some(Control::Field);
    u.key(Key::Tab { shift: false }, 0);
    assert_eq!(u.focus, Some(Control::Send));
    assert!(u.activate(Control::Send, 0).is_none());
    assert!(u.request_status().is_none());
}
#[test]
fn size_popup_has_its_own_paper_and_all_three_rows_fit() {
    let mut u = activity();
    u.open_menu(Default::default(), 0);
    let i = u
        .menu
        .iter()
        .position(|r| r.action == Some(MenuAction::SizeMenu))
        .unwrap();
    u.activate(Control::Menu(i), 0);
    let c = u.render(1.);
    let elems = u.elements();
    let first = elems
        .iter()
        .find(|e| e.control == Control::Submenu(0))
        .unwrap();
    let last = elems
        .iter()
        .find(|e| e.control == Control::Submenu(2))
        .unwrap();
    assert!(last.bounds.y + last.bounds.height <= c.height as f64 - 8.);
    assert!(!c.hit_test(first.bounds.x as i32 + 2, 9));
}
#[test]
fn target_popup_has_occlusion_and_only_popup_controls_are_enabled() {
    let mut u = activity();
    for i in 0..8 {
        let mut r = u.chosen.clone();
        r.session = format!("other{i}");
        u.sessions.push(r);
    }
    u.activate(Control::Target, 0);
    let c = u.render(1.);
    assert!(c.text_occlusion.is_some());
    assert!(u
        .elements()
        .iter()
        .filter(|e| !matches!(e.control, Control::Menu(_)))
        .all(|e| !e.enabled));
    let rect = c.text_occlusion.unwrap().1;
    assert!(!c.hit_test((rect.0 + rect.2 + 4) as i32, (c.height - 40) as i32));
}
#[test]
fn clicking_outside_target_popup_dismisses_it_without_losing_draft() {
    let mut u = activity();
    u.text("draft");
    let mut r = u.chosen.clone();
    r.session = "other".into();
    u.sessions.push(r);
    u.activate(Control::Target, 0);
    let b = u
        .elements()
        .into_iter()
        .find(|e| e.control == Control::Field)
        .unwrap()
        .bounds;
    u.click(b.x + 2., b.y + 2., 0);
    assert_eq!(u.surface(), Surface::Activity);
    assert_eq!(u.field, "draft");
    assert_eq!(u.focus, Some(Control::Target));
}

