//! High contrast on the Windows and Linux companion (design/1.0/HIGH-CONTRAST.md sections 2.3, 3).
//! Everything here runs on the painters and pure rules; no window, portal or registry is read.
use coco_companion::{
    contrast::{contrast_ratio, Look, SystemPalette},
    feed::{Record, Sessions},
    motion::PointerFade,
    render::Canvas,
    ui::*,
};
use std::collections::BTreeSet;

const INK: [u8; 4] = [35, 27, 25, 255];
const CREAM: [u8; 4] = [250, 238, 233, 255];

/// Stand-in contrast themes: a black one and a pale one with its own highlight. They only exercise
/// the rules; a real theme is whatever `GetSysColor` returns.
fn night() -> SystemPalette {
    SystemPalette {
        window: [0, 0, 0, 255],
        window_text: [255, 255, 255, 255],
        highlight: [26, 235, 255, 255],
        highlight_text: [0, 0, 0, 255],
        button_face: [0, 0, 0, 255],
        button_text: [255, 255, 255, 255],
        gray_text: [63, 242, 63, 255],
    }
}
fn pale() -> SystemPalette {
    SystemPalette {
        window: [255, 250, 239, 255],
        window_text: [32, 32, 32, 255],
        highlight: [117, 0, 0, 255],
        highlight_text: [255, 255, 255, 255],
        button_face: [255, 250, 239, 255],
        button_text: [32, 32, 32, 255],
        gray_text: [51, 51, 51, 255],
    }
}
fn palette_colours(p: SystemPalette) -> Vec<[u8; 4]> {
    vec![
        p.window,
        p.window_text,
        p.highlight,
        p.highlight_text,
        p.button_face,
        p.button_text,
        p.gray_text,
    ]
}

fn sessions(count: usize) -> Sessions {
    let mut s = Sessions::default();
    for i in 0..count {
        let mut r = Record::resting();
        r.session = format!("s{i}");
        r.project = format!("atlas{i}");
        r.channel = true;
        r.at = 1000. + i as f64;
        r.done = 1000. + i as f64;
        s.receive(r, 1001. + i as f64);
    }
    s
}
fn activity(high_contrast: bool, palette: Option<SystemPalette>) -> UiState {
    activity_of(2, high_contrast, palette)
}
fn activity_of(count: usize, high_contrast: bool, palette: Option<SystemPalette>) -> UiState {
    let mut ui = UiState::default();
    ui.open_activity(&sessions(count), 1010.);
    ui.chosen.quota = Some(Quota::example());
    ui.high_contrast = high_contrast;
    ui.system_palette = palette;
    ui
}
fn pixels(c: &Canvas) -> impl Iterator<Item = [u8; 4]> + '_ {
    c.pixels.chunks_exact(4).map(|p| [p[0], p[1], p[2], p[3]])
}
fn count(c: &Canvas, colour: [u8; 4]) -> usize {
    pixels(c).filter(|p| *p == colour).count()
}
fn at(c: &Canvas, x: f64, y: f64, scale: f64) -> [u8; 4] {
    let i = ((y * scale) as usize * c.width as usize + (x * scale) as usize) * 4;
    [
        c.pixels[i],
        c.pixels[i + 1],
        c.pixels[i + 2],
        c.pixels[i + 3],
    ]
}
/// Is this opaque pixel one palette colour, or a blend of up to three of them (anti-aliasing
/// where two edges meet)? Blends are tried finely for two colours and on a 1/32 grid for three.
fn from_palette(pixel: [u8; 4], colours: &[[u8; 4]]) -> bool {
    let near = |mix: [f64; 3], tolerance: f64| {
        (0..3).all(|ch| (mix[ch] - pixel[ch] as f64).abs() <= tolerance)
    };
    let n = colours.len();
    for a in 0..n {
        for b in a..n {
            for k in 0..=255 {
                let t = k as f64 / 255.;
                let mix = [0, 1, 2]
                    .map(|ch| colours[a][ch] as f64 * (1. - t) + colours[b][ch] as f64 * t);
                if near(mix, 1.5) {
                    return true;
                }
            }
        }
    }
    for a in 0..n {
        for b in a..n {
            for c in b..n {
                for i in 0..=32 {
                    for j in 0..=(32 - i) {
                        let (wa, wb, wc) =
                            (i as f64 / 32., j as f64 / 32., (32 - i - j) as f64 / 32.);
                        let mix = [0, 1, 2].map(|ch| {
                            colours[a][ch] as f64 * wa
                                + colours[b][ch] as f64 * wb
                                + colours[c][ch] as f64 * wc
                        });
                        if near(mix, 4.5) {
                            return true;
                        }
                    }
                }
            }
        }
    }
    false
}

#[test]
fn the_normal_look_draws_no_solid_ink() {
    let c = activity(false, None).render(2.);
    assert_eq!(Look::new(false, None), Look::Normal);
    assert_eq!(count(&c, INK), 0, "a faint edge and hairlines only");
}

#[test]
fn his_paper_gets_a_solid_one_point_ink_edge_and_full_ink_hairlines() {
    let strong = activity(true, None).render(2.);
    assert!(
        count(&strong, INK) > 1500,
        "edge ring and hairlines are solid ink"
    );
    // The normal 16 % wash and its 30 point shadow are gone from the edge: the panel's own edge
    // pixel is ink, not a faint blend.
    let ui = activity(true, None);
    let inset = ui.surface_inset();
    assert_eq!(at(&strong, inset + 150., inset + 0.25, 2.), INK);
}

#[test]
fn paper_focus_ring_is_ink_and_not_vermilion() {
    let mut normal = activity(false, None);
    normal.focus = Some(Control::Field);
    let mut strong = activity(true, None);
    strong.focus = Some(Control::Field);
    let (a, b) = (normal.render(2.), strong.render(2.));
    let vermilion = [199, 87, 48, 255];
    assert!(
        count(&a, vermilion) > count(&b, vermilion),
        "the ring was vermilion"
    );
}

#[test]
fn seals_are_the_darker_pair_and_their_hover_adds_no_ring() {
    let look = Look::Paper;
    let rest = look.seal(false, false, true).unwrap();
    let hover = look.seal(true, false, true).unwrap();
    let pressed = look.seal(false, true, true).unwrap();
    assert_eq!(rest.fill, Some([118, 48, 26, 255]));
    assert_eq!(pressed.fill, Some([92, 36, 18, 255]));
    assert_eq!(
        hover, rest,
        "hover keeps the rest colour, with no inner ring"
    );
    assert!(rest.edge.is_none() && hover.edge.is_none());
    let twice = |ratio: f64| (ratio * 100.).round() / 100.;
    assert!(twice(contrast_ratio(rest.fill.unwrap(), CREAM)) >= 8.37);
    assert!(twice(contrast_ratio(pressed.fill.unwrap(), CREAM)) >= 10.76);
}

#[test]
fn hovered_icon_buttons_invert_and_the_placeholder_is_darker() {
    let look = Look::Paper;
    let light = look.icon_button(false, true).unwrap();
    assert_eq!(light.fill, Some(look.ink(false)));
    assert_eq!(light.text, look.panel_fill(false));
    assert!(contrast_ratio(light.fill.unwrap(), light.text) >= 14.8);
    let dark = look.icon_button(true, true).unwrap();
    assert_eq!(dark.fill, Some(look.ink(true)));
    assert_eq!(dark.text, look.panel_fill(true));
    assert!(contrast_ratio(dark.fill.unwrap(), dark.text) >= 13.6);
    assert!(
        look.icon_button(false, false).is_none(),
        "at rest the glyph keeps its own colour"
    );
    assert!(contrast_ratio(look.placeholder(), [255, 250, 247, 255]) >= 7.5);
    assert_eq!(Look::Normal.icon_button(false, true), None);
}

#[test]
fn paper_hover_row_shows_a_solid_ink_disc_under_the_hovered_glyph() {
    let hovering = |high_contrast: bool| {
        let mut ui = activity(high_contrast, None);
        ui.close();
        ui.unseen = 1;
        ui.hover_visible = true;
        ui.hover_index = Some(0);
        ui
    };
    let ui = hovering(true);
    let scale = 2.;
    let mut c = Canvas::blank(1280, 960);
    ui.paint_hover(&mut c, scale);
    let b = ui.hover_button(0);
    // The row is the book's near-black cloth in his strengthened paper too, so the hovered glyph inverts to a cream disc.
    let mut ink = 0;
    for dy in 0..24 {
        for dx in 0..24 {
            if at(&c, b.x + dx as f64 + 0.5, b.y + dy as f64 + 0.5, scale) == CREAM {
                ink += 1;
            }
        }
    }
    assert!(
        ink > 200,
        "the disc under the hovered glyph is solid: {ink} of 576"
    );
    let normal = hovering(false);
    let mut n = Canvas::blank(1280, 960);
    normal.paint_hover(&mut n, scale);
    assert_eq!(count(&n, INK), 0);
}

#[test]
fn system_colours_only_for_every_chrome_pixel() {
    for palette in [night(), pale()] {
        let colours = palette_colours(palette);
        let mut states: Vec<UiState> = Vec::new();
        let mut base = activity_of(1, true, Some(palette));
        base.field = String::new();
        states.push(base.clone());
        let mut typed = base.clone();
        typed.text("a question");
        typed.focus = Some(Control::Send);
        typed.hovered = Some(Control::Send);
        states.push(typed);
        let mut pressed = base.clone();
        pressed.hovered = Some(Control::Close);
        pressed.pressed = Some(Control::Close);
        states.push(pressed);
        let mut row = base.clone();
        row.pressed = Some(Control::Row("s0".into()));
        row.focus = Some(Control::Row("s0".into()));
        states.push(row);
        for ui in states {
            let c = ui.render(2.);
            let mut seen = BTreeSet::new();
            for p in pixels(&c).filter(|p| p[3] == 255) {
                seen.insert(p);
            }
            assert!(!seen.is_empty());
            for p in seen {
                assert!(
                    from_palette(p, &colours),
                    "{p:?} is not one of the system's colours (or a blend of two): {:?}",
                    palette
                );
            }
        }
    }
}

#[test]
fn the_palette_check_would_catch_his_own_colours() {
    // Control: the normal look's cream, vermilion and ink are not a black contrast theme's colours.
    let colours = palette_colours(night());
    let c = activity_of(1, false, None).render(2.);
    assert!(pixels(&c)
        .filter(|p| p[3] == 255)
        .any(|p| !from_palette(p, &colours)));
}

#[test]
fn system_look_edges_are_two_points_with_no_shadow() {
    let palette = night();
    let ui = activity(true, Some(palette));
    let c = ui.render(1.);
    let inset = ui.surface_inset();
    // The edge of the panel itself: two points of the window text colour.
    for dy in [0., 1.] {
        assert_eq!(
            at(&c, inset + 150., inset + dy + 0.5, 1.),
            palette.window_text,
            "top edge {dy}"
        );
    }
    assert_eq!(
        at(&c, inset + 150., inset + 3.5, 1.),
        palette.window,
        "inside the edge and below Activity's 3 pt top band (ink in this look)"
    );
    // No shadow outside it: everything beyond the panel stays transparent.
    assert_eq!(at(&c, inset + 150., inset - 4., 1.)[3], 0);
    assert_eq!(at(&c, inset - 4., inset + 100., 1.)[3], 0);
}

#[test]
fn seals_and_buttons_follow_the_system_pairs() {
    let p = night();
    let look = Look::System(p);
    let rest = look.seal(false, false, true).unwrap();
    assert_eq!(
        (rest.fill, rest.text),
        (Some(p.highlight), p.highlight_text)
    );
    let hover = look.seal(true, false, true).unwrap();
    assert_eq!(
        (hover.fill, hover.text, hover.edge),
        (Some(p.highlight_text), p.highlight, Some((2., p.highlight)))
    );
    let disabled = look.seal(false, false, false).unwrap();
    assert_eq!(
        (disabled.fill, disabled.text, disabled.edge),
        (Some(p.button_face), p.gray_text, Some((1., p.gray_text)))
    );
    let quiet = look.quiet_button(false, false, true).unwrap();
    assert_eq!(
        (quiet.fill, quiet.text, quiet.edge),
        (
            Some(p.button_face),
            p.button_text,
            Some((1., p.button_text))
        )
    );
    let hovered = look.quiet_button(false, true, true).unwrap();
    assert_eq!(
        (hovered.fill, hovered.text),
        (Some(p.highlight), p.highlight_text)
    );
    let (width, ring, gap) = look.focus(false);
    assert_eq!((width, ring, gap), (2., p.window_text, 1.));
    assert_eq!(look.panel_edge(false), (2., p.window_text));
    assert!(!look.shadow());
}

#[test]
fn a_win32_colorref_is_blue_green_red() {
    assert_eq!(
        SystemPalette::from_colorref(0x0040_2010),
        [0x10, 0x20, 0x40, 255]
    );
    let p = SystemPalette::from_colorrefs([0x00FF_FFFF, 0, 1, 2, 3, 4, 5]);
    assert_eq!(p.window, [255, 255, 255, 255]);
    assert_eq!(p.window_text, [0, 0, 0, 255]);
    assert_eq!(p.gray_text, [5, 0, 0, 255]);
}

#[test]
fn the_pointer_fade_is_all_or_nothing_once_asked() {
    let mut soft = PointerFade::default();
    soft.update(30., false, 0);
    assert!((soft.opacity(1000) - 0.45).abs() < 1e-9);
    soft.update(4., false, 1000);
    assert!((soft.opacity(2000) - 0.12).abs() < 1e-9);

    let mut solid = PointerFade::default();
    solid.set_solid(true, 0);
    solid.update(30., false, 0);
    assert!((solid.opacity(1000) - 1.).abs() < 1e-9, "near stays whole");
    solid.update(4., false, 1000);
    assert!(
        solid.opacity(2000).abs() < 1e-9,
        "over steps out of the way"
    );
    // The timings stay: 90 ms down, 240 ms back after the 250 ms dwell.
    solid.update(f64::INFINITY, false, 3000);
    assert!(solid.opacity(3100).abs() < 1e-9);
    solid.advance(3250);
    assert!((solid.opacity(3250 + 240) - 1.).abs() < 1e-9);
}

#[test]
fn the_engine_switches_the_fade_with_the_system_request() {
    use coco_companion::{engine::Engine, render::Size, Options};
    let options = Options {
        folder: std::env::temp_dir().join("e2-contrast-no-feed"),
        presence_folder: None,
        assets: std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../assets"),
        size: Size::Medium,
        reduce_motion: true,
        follow_class: None,
        trace: false,
        login: false,
    };
    let mut e = Engine::new(options, 1000, 42).unwrap();
    e.pointer_distance(30., false, 1000);
    assert!((e.line_opacity(3000) - 0.45).abs() < 1e-9);
    e.set_contrast(true, None, false, 3000);
    e.pointer_distance(30., false, 3000);
    assert!(
        (e.line_opacity(6000) - 1.).abs() < 1e-9,
        "contrast: near is whole"
    );
    e.set_contrast(false, None, true, 6000);
    e.pointer_distance(4., false, 6000);
    assert!(
        e.line_opacity(9000).abs() < 1e-9,
        "transparency effects off: over is gone"
    );
    e.set_contrast(false, None, false, 9000);
    e.pointer_distance(4., false, 9000);
    assert!((e.line_opacity(12000) - 0.12).abs() < 1e-9);
}

#[test]
fn the_drawn_menu_is_black_on_white_or_the_inverse() {
    let open = |look_on: bool, dark: bool| {
        let mut ui = UiState::default();
        ui.open_activity(&sessions(1), 1010.);
        ui.dark = dark;
        ui.high_contrast = look_on;
        ui.open_menu(MenuContext::default(), 1000);
        ui.render(1.)
    };
    let white = [255, 255, 255, 255];
    let black = [0, 0, 0, 255];
    let light = open(true, false);
    assert!(count(&light, white) > 500 && count(&light, black) > 100);
    let dark = open(true, true);
    assert!(count(&dark, black) > 500 && count(&dark, white) > 100);
    assert_eq!(count(&open(false, false), black), 0);
    assert_eq!(contrast_ratio(white, black), 21.);
}

#[test]
fn the_x11_pick_frame_is_two_tones() {
    let pixels = coco_companion::linux_model::outline_pixels_contrast(60, 40);
    let at = |x: usize, y: usize| {
        let i = (y * 60 + x) * 4;
        [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]]
    };
    for y in [0, 1] {
        assert_eq!(at(30, y), [255, 255, 255, 255], "outer line, row {y}");
    }
    for y in [2, 3] {
        assert_eq!(at(30, y), [0, 0, 0, 255], "inner line, row {y}");
    }
    assert_eq!(at(30, 4)[3], 0, "nothing fills the window inside");
    assert_eq!(at(30, 20)[3], 0);
    let normal = coco_companion::linux_model::outline_pixels(60, 40);
    assert_ne!(normal, pixels);
}

#[test]
fn the_pick_tooltip_takes_his_papers_solid_edge() {
    let normal =
        coco_companion::linux_model::pick_tooltip("pick a window", "en", 120., 18., 1.);
    let strong = coco_companion::linux_model::pick_tooltip_look(
        "pick a window",
        "en",
        120.,
        18.,
        1.,
        Look::Paper,
    );
    assert_eq!(count(&normal, INK), 0);
    assert!(count(&strong, INK) > 100);
}

// The 0.4 stick in the foot became the band's battery and power bank (lane C, 10-17): tests/quota_pixels.rs
// checks them, unchanged under contrast like his other pictures (section 5).
