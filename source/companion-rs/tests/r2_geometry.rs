use coco_companion::{
    feed::{Record, Sessions},
    render::{Canvas, TextRun},
    ui::*,
};
fn activity() -> UiState {
    let mut r = Record::resting();
    r.session = "geometry".into();
    r.project = "project".into();
    r.channel = true;
    r.done = 1000.;
    r.at = 1000.;
    r.quota = Some(Quota::example());
    let mut s = Sessions::default();
    s.receive(r, 1001.);
    let mut u = UiState::default();
    u.open_activity(&s, 1001.);
    u
}
fn rgba(c: &Canvas, x: u32, y: u32) -> [u8; 4] {
    c.pixels[((y * c.width + x) * 4) as usize..][..4]
        .try_into()
        .unwrap()
}
#[test]
fn hover_labels_measure_five_scripts_and_follow_each_button() {
    for lang in ["zh", "ja", "ko", "de", "hi"] {
        let mut u = activity();
        u.close();
        u.unseen = 0;
        u.chosen.lang = lang.into();
        u.hover_visible = true;
        u.context.back_available = true;
        for i in 0..5 {
            let e = u
                .elements()
                .into_iter()
                .find(|e| e.control == Control::Hover(i))
                .unwrap();
            let b = u.hover_label_bounds(i).unwrap();
            assert!((b.width - text_width(&e.label, lang, 12., false, false) - 16.).abs() < 0.01);
            assert_eq!(b.height, 20.);
            assert!((b.x + b.width / 2. - (e.bounds.x + 12.)).abs() < 0.01);
        }
    }
}
#[test]
fn label_flips_below_and_clamps_to_screen() {
    let mut u = activity();
    u.close();
    u.unseen = 0;
    u.hover_visible = true;
    u.companion_frame = Rect {
        x: 105.,
        y: 25.,
        width: 110.,
        height: 96.,
    };
    u.visible_rect = Rect {
        x: 0.,
        y: 0.,
        width: 320.,
        height: 288.,
    };
    let row = u.hover_bounds();
    let b = u.hover_label_bounds(0).unwrap();
    assert_eq!(b.y, row.y + row.height + 4.);
    u.visible_rect.x = 120.;
    u.visible_rect.width = 200.;
    let b = u.hover_label_bounds(0).unwrap();
    assert!(b.x >= 122. && b.x + b.width <= 318.);
}
#[test]
fn hover_bottom_is_four_points_inside_frame_and_back_omission_shrinks_it() {
    // Historical test name retained; R4 replaces the old four-point rule with
    // a two-point clearance above the measured idle ink (frame top fallback).
    let mut u = activity();
    u.close();
    u.unseen = 0;
    u.hover_visible = true;
    u.context.back_available = true;
    let b = u.hover_bounds();
    assert_eq!(b.width, 144.);
    assert_eq!(b.y + b.height, u.companion_frame.y - 2.);
    u.context.back_available = false;
    assert_eq!(u.hover_bounds().width, 116.);
}
#[test]
fn dark_hover_wash_and_hovered_icon_use_the_new_approved_colour() {
    let mut u = activity();
    u.close();
    u.unseen = 0;
    u.hover_visible = true;
    u.context.back_available = true;
    u.dark = true;
    u.hover_index = Some(4);
    let b = u.hover_button(4);
    let mut c = Canvas::blank(320, 288);
    u.paint_hover(&mut c, 1.);
    assert_eq!(
        rgba(&c, b.x as u32 + 12, b.y as u32 + 22),
        [62, 40, 34, 255]
    );
    assert!(c.pixels.chunks_exact(4).any(|p| p == [224, 122, 85, 255]));
    let row = u.hover_bounds();
    // OUTSIDE 10-09: the hover row is the book's near-black cloth (#1A1918) in both appearances.
    assert_eq!(
        rgba(&c, row.x as u32 + 70, row.y as u32 + 30),
        [26, 25, 24, 255]
    );
}
#[test]
fn paper_band_and_quota_foot_respect_nine_point_corners() {
    let u = activity();
    let c = u.render(2.);
    for (x, y) in [
        (60, 60),
        (659, 60),
        (60, c.height - 61),
        (659, c.height - 61),
    ] {
        assert!(rgba(&c, x, y)[3] < 255);
    }
    assert_eq!(rgba(&c, 360, 62), [199, 87, 48, 255]);
    assert_eq!(rgba(&c, 360, c.height - 64), [245, 228, 220, 255]);
}
#[test]
fn field_border_is_visible_at_rest_and_focus_is_vermilion() {
    let mut u = activity();
    u.focus = Some(Control::Close);
    let b = u
        .elements()
        .into_iter()
        .find(|e| e.control == Control::Field)
        .unwrap()
        .bounds;
    let c = u.render(2.);
    let edge = rgba(&c, (b.x * 2.) as u32, (b.y * 2. + 14.) as u32);
    assert_eq!(&edge[..3], &[142, 132, 129]);
    u.focus = Some(Control::Field);
    let c = u.render(2.);
    let edge = rgba(&c, (b.x * 2.) as u32, (b.y * 2. + 14.) as u32);
    assert_eq!(&edge[..3], &[199, 87, 48]);
}
#[test]
fn rows_reserve_six_points_before_the_measured_right_aligned_clock() {
    let mut u = activity();
    u.rows[0].record.at = 1000.;
    let c = u.render(1.);
    let time = moment_text(1000., coco_companion::epoch_ms() as f64, "en");
    let i = c.texts.iter().position(|r| r.text == time).unwrap();
    let clock = &c.texts[i];
    assert!((clock.x + clock.width - 318.).abs() < 0.01);
    let heading = &c.texts[i - 1];
    assert!((heading.x + heading.width + 6. - clock.x).abs() < 0.01);
}
#[test]
fn ribbon_rows_leave_eight_points_before_dot_and_text() {
    let mut u = activity();
    let mut r = u.chosen.clone();
    r.session = "two".into();
    u.sessions.push(r);
    let c = u.render(1.);
    let row = u
        .elements()
        .into_iter()
        .find(|e| matches!(e.control, Control::Row(_)))
        .unwrap();
    assert_eq!(
        rgba(&c, 59, (row.bounds.y + 14.) as u32),
        [158, 65, 35, 255]
    );
    let heading = c
        .texts
        .iter()
        .find(|t| t.text.starts_with("project, "))
        .unwrap();
    assert_eq!(heading.x, 71.);
}
#[test]
fn two_line_excerpt_uses_sixty_four_points() {
    let mut u = activity();
    u.rows[0].excerpt=Some("A measured excerpt whose words fill the first line and continue along the second narrow line.".into());
    assert_eq!(u.row_height(&u.rows[0]), 64.);
}
#[test]
fn drawn_menu_uses_system_sans_and_enabled_contrasting_quota() {
    let mut u = activity();
    u.dark = true;
    u.open_menu(Default::default(), 0);
    let c = u.render(1.);
    assert!(c.text_sans.iter().all(|s| *s));
    assert_eq!(c.text_styles[0].1, [175, 175, 175, 255]);
    assert!(u.menu[0].enabled);
    assert!(u.dimensions().0 >= 226.);
}
#[test]
fn badge_visual_caps_at_nine_plus_but_accessible_count_stays_exact() {
    let mut u = activity();
    u.close();
    u.hover_visible = false;
    u.unseen = 10;
    let b = u.badge_bounds();
    assert_eq!(b.height, 20.);
    assert!(b.width >= 20.);
    let mut c = Canvas::blank(320, 288);
    u.paint_hover(&mut c, 1.);
    assert!(c
        .texts
        .iter()
        .any(|r| r.text == "9+" && r.font_size == 11.5));
    let e = u
        .elements()
        .into_iter()
        .find(|e| e.control == Control::Badge)
        .unwrap();
    assert!(e.label.contains("10"));
    assert!(matches!(
        u.activate(Control::Badge, 0),
        Some(UiAction::Menu(MenuAction::Activity))
    ));
}
#[test]
fn task_pill_is_twenty_two_points_tall_with_semibold_project_and_no_reflow() {
    let mut c = Canvas::blank(320, 288);
    c.paper_dark = true;
    c.task_pill(
        TextRun {
            text: "project: working".into(),
            lang: "en".into(),
            x: 100.,
            y: 131.,
            width: 140.,
            height: 17.,
            font_size: 12.,
            line_height: None,
        },
        7,
        1.,
    );
    assert!(c.bubble_is_task);
    assert_eq!(c.bubble_prefix, 7);
    let before = c.pixels.clone();
    c.fit_bubble(15., 90., 1.);
    assert_eq!(c.pixels, before);
    // OUTSIDE 10-09: the task pill is the same near-black cloth in both appearances.
    assert_eq!(rgba(&c, 165, 130), [26, 25, 24, 255]);
}
#[test]
fn device_size_vector_cache_reuses_exact_raster() {
    let a = vector_image(
        include_bytes!("../assets/decor/scroll-light.svg"),
        10.,
        20.,
        2.,
    )
    .unwrap();
    let b = vector_image(
        include_bytes!("../assets/decor/scroll-light.svg"),
        10.,
        20.,
        2.,
    )
    .unwrap();
    assert_eq!((a.width, a.height), (20, 40));
    assert!(std::sync::Arc::ptr_eq(&a, &b));
}
#[test]
fn reset_strings_reject_bad_dates_offsets_and_overflow_without_panicking() {
    use coco_companion::locale::parse_reset;
    let a = parse_reset(&serde_json::json!("2026-10-05T23:30:00+02:00"));
    let b = parse_reset(&serde_json::json!(1791235800000_f64));
    assert_eq!(a, b);
    for s in [
        "2026-02-30T12:00:00Z",
        "2026-10-05T23:30:00+99:00",
        "9223372036854775807-12-31T00:00:00Z",
        "2026-10-05T24:00:00Z",
        "2026-10-05T21:30:NaNZ",
    ] {
        assert_eq!(parse_reset(&serde_json::json!(s)), None, "{s}");
    }
}
#[test]
fn moment_keeps_other_day_and_year_and_chinese_japanese_joining() {
    let now = 1791235800000.;
    for lang in ["en", "zh", "ja", "ko", "de", "hi"] {
        let today = moment_text(now, now, lang);
        let other = moment_text(now - 86400000., now, lang);
        let year = moment_text(now - 370. * 86400000., now, lang);
        assert_ne!(today, other);
        assert!(year.contains("2025"), "{lang}: {year}");
        if matches!(lang, "zh" | "ja") {
            assert!(!other.contains("日 "), "{other}");
        }
    }
}

#[test]
fn x11_pick_frame_has_coverage_antialiasing_without_a_fill() {
    let p = coco_companion::linux_model::outline_pixels(304, 204);
    assert!(p.chunks_exact(4).any(|p| p[3] > 0 && p[3] < 255));
    assert_eq!(p[(102 * 304 + 152) * 4 + 3], 0);
    assert_eq!(&p[152 * 4..152 * 4 + 4], &[199, 87, 48, 255]);
}

#[test]
fn size_submenu_word_boxes_fit_measured_labels_in_six_languages() {
    let words: serde_json::Value =
        serde_json::from_str(include_str!("../assets/words/feed.json")).unwrap();
    for lang in ["en", "zh", "ja", "ko", "de", "hi"] {
        let mut ui = activity();
        ui.chosen.lang = lang.into();
        for (key, value) in words[lang].as_object().unwrap() {
            ui.chosen
                .words
                .insert(key.clone(), value.as_str().unwrap().into());
        }
        ui.open_size_menu(0);
        let canvas = ui.render(1.);
        for e in ui
            .elements()
            .into_iter()
            .filter(|e| matches!(e.control, Control::Submenu(_)))
        {
            let run = canvas.texts.iter().find(|t| t.text == e.label).unwrap();
            let measured = text_width(&run.text, lang, 12., false, true);
            assert!(
                run.width + 0.01 >= measured,
                "{lang} {}: {} < {}",
                run.text,
                run.width,
                measured
            );
        }
    }
}

