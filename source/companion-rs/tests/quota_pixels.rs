//! The Activity foot's battery and power bank are the band's own pictures (lane C, 10-17): the rows ported in
//! src/quota_pixels.rs equal quota.ts's for every case in tests/fixtures/quota-pixels.json, and the foot draws
//! them in place of the 0.4 stick, unchanged under high contrast.
use coco_companion::{
    feed::{Record, Sessions},
    quota_pixels,
    ui::{Quota, UiState},
};

#[test]
fn the_rows_are_the_bands_rows() {
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("fixtures/quota-pixels.json")).unwrap();
    let cases = fixture["cases"].as_array().unwrap();
    assert!(cases.len() >= 30);
    for case in cases {
        let left = case["left"].as_f64().unwrap();
        let waiting = case["waiting"].as_bool().unwrap();
        let rows = |key: &str| -> Vec<String> {
            case[key].as_array().unwrap().iter().map(|r| r.as_str().unwrap().to_owned()).collect()
        };
        assert_eq!(quota_pixels::battery(left, waiting), rows("battery"), "battery {left}% {waiting}");
        assert_eq!(quota_pixels::bank(left, waiting), rows("bank"), "bank {left}% {waiting}");
    }
    // Every letter the rows use has its colour.
    for case in cases {
        for key in ["battery", "bank"] {
            for row in case[key].as_array().unwrap() {
                assert!(row.as_str().unwrap().chars().all(|ch| ch == '.' || quota_pixels::ink(ch).is_some()));
            }
        }
    }
}

#[test]
fn a_window_shows_what_is_left_and_a_spent_one_waits_under_the_bolt() {
    assert_eq!(quota_pixels::for_window("five_hour", Some(38.)), Some(quota_pixels::battery(62., false)));
    assert_eq!(quota_pixels::for_window("seven_day", Some(80.)), Some(quota_pixels::bank(20., false)));
    assert_eq!(quota_pixels::for_window("five_hour", Some(100.)), Some(quota_pixels::battery(0., true)));
    assert_eq!(quota_pixels::for_window("spend_limit", Some(10.)), None);
    assert_eq!(quota_pixels::for_window("five_hour", None), None);
}

fn activity(contrast: bool) -> UiState {
    let mut sessions = Sessions::default();
    for i in 0..2 {
        let mut r = Record::resting();
        r.session = format!("s{i}");
        r.project = format!("atlas{i}");
        r.channel = true;
        r.at = 1000. + i as f64;
        r.done = 1000. + i as f64;
        sessions.receive(r, 1001. + i as f64);
    }
    let mut ui = UiState::default();
    ui.open_activity(&sessions, 1010.);
    ui.chosen.quota = Some(Quota::example());
    ui.high_contrast = contrast;
    ui
}

fn count(canvas: &coco_companion::render::Canvas, color: [u8; 4]) -> usize {
    canvas.pixels.chunks_exact(4).filter(|p| *p == color).count()
}

#[test]
fn the_foot_draws_the_battery_and_the_power_bank_the_same_under_contrast() {
    let normal = activity(false).render(2.);
    let strong = activity(true).render(2.);
    // Quota::example: the 5-hour window 62 % used, the weekly 20 %. Every art pixel of the battery's blue bars and
    // of the power bank's charcoal body is there, two by two device pixels, and high contrast leaves them as they are.
    let battery = quota_pixels::battery(38., false);
    let bank = quota_pixels::bank(80., false);
    let cells = |ch: char| -> usize {
        battery.iter().chain(bank.iter()).map(|row| row.chars().filter(|c| *c == ch).count()).sum()
    };
    let bars = quota_pixels::ink('B').unwrap();
    let body = quota_pixels::ink('L').unwrap();
    assert!(cells('B') > 0 && cells('L') > 0);
    assert_eq!(count(&normal, bars), 4 * cells('B'), "battery bars");
    assert_eq!(count(&normal, body), 4 * cells('L'), "power bank body");
    assert_eq!(count(&normal, bars), count(&strong, bars));
    assert_eq!(count(&normal, body), count(&strong, body));
    // The 0.4 stick's wood and its reminder thread are gone.
    assert_eq!(count(&normal, [132, 109, 87, 255]), 0);
    assert_eq!(count(&strong, [142, 59, 34, 255]), 0);
}

#[test]
fn a_system_contrast_theme_draws_them_in_its_two_colours() {
    let ink = [255, 255, 0, 255];
    let paper = [0, 0, 0, 255];
    let mut c = coco_companion::render::Canvas::blank(52, 24);
    let rows = quota_pixels::battery(62., false);
    quota_pixels::draw(&mut c, &rows, 0., 0., 2., false, Some((ink, paper)));
    let painted: std::collections::BTreeSet<[u8; 4]> =
        c.pixels.chunks_exact(4).filter(|p| p[3] == 255).map(|p| [p[0], p[1], p[2], p[3]]).collect();
    assert_eq!(painted, [ink, paper].into_iter().collect());
    // What is left still reads: the three lit bars of 62 % are ink, the spent quarter is paper.
    let at = |x: usize, y: usize| -> [u8; 4] {
        let i = (y * 52 + x) * 4;
        [c.pixels[i], c.pixels[i + 1], c.pixels[i + 2], c.pixels[i + 3]]
    };
    assert_eq!(at(2 * 4, 2 * 7), ink, "first bar");
    assert_eq!(at(2 * 19, 2 * 4), paper, "the spent quarter's top");
}
