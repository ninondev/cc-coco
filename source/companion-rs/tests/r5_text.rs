use coco_companion::locale;
#[cfg(target_os = "macos")]
use coco_companion::{
    feed::{Record, Sessions},
    ui::UiState,
};
#[cfg(target_os = "macos")]
use serde_json::json;

#[test]
fn traditional_moments_use_taiwan_chinese_date_and_clock_conventions() {
    let noon = 946_728_000_000.;
    // Same instant means same local day in every host timezone; cover every hour
    // so the assertion does not depend on whether noon UTC is morning locally.
    let clocks: Vec<_> = (0..24)
        .map(|hour| {
            let ms = noon + hour as f64 * 3_600_000.;
            locale::moment(ms, ms, "zh-Hant")
        })
        .collect();
    assert!(clocks.iter().any(|v| v.contains("上午")), "{clocks:?}");
    assert!(clocks.iter().any(|v| v.contains("下午")), "{clocks:?}");
    let same_year = locale::moment(noon, noon + 150. * 86_400_000., "zh-Hant");
    assert!(
        same_year.contains('月') && same_year.contains('日') && !same_year.contains("2000"),
        "{same_year}"
    );
    let date = locale::moment(noon, noon + 400. * 86_400_000., "zh-Hant");
    assert!(
        date.contains("2000年") && date.contains('月') && date.contains('日'),
        "{date}"
    );
    assert_eq!(locale::percent(62., "zh-Hant"), "62%");
}

#[test]
fn traditional_linux_font_fallback_uses_taiwan_glyph_forms() {
    let family = coco_companion::linux_model::serif_family("zh-Hant");
    assert!(family.contains("CJK TC"), "{family}");
    assert!(!family.contains("CJK SC"), "{family}");
}

#[cfg(target_os = "macos")]
#[test]
fn traditional_coretext_wraps_preserve_chinese_punctuation_at_all_fifteen_quarter_scales() {
    use coco_companion::{platform::macos_text::wrapped_lines, render::TextRun};
    let text = "（國語）這裡有繁體字，閱讀時需要完整的標點。『小克』繼續讀書，直到下一頁。";
    for step in 2..=16 {
        let scale = step as f64 / 4.;
        for width in [80., 128., 256.] {
            let run = TextRun {
                text: text.into(),
                lang: "zh-Hant".into(),
                x: 0.,
                y: 0.,
                width: width * scale,
                height: 10000. * scale,
                font_size: 12.5 * scale,
                line_height: None,
            };
            let lines = wrapped_lines(&run, false, 0);
            assert!(lines.len() > 1);
            assert_eq!(lines.concat(), text);
            for line in &lines {
                assert!(
                    !"，。！？；：）』」】".contains(line.chars().next().unwrap()),
                    "{scale}/{width}: {lines:?}"
                );
                assert!(
                    !"（『「【".contains(line.chars().last().unwrap()),
                    "{scale}/{width}: {lines:?}"
                );
            }
        }
    }
}

#[cfg(target_os = "macos")]
#[test]
fn traditional_n1_quota_footer_keeps_every_native_line_inside_at_all_fifteen_quarter_scales() {
    use coco_companion::platform::macos_text::{measure_ui, wrapped_lines};
    let record = Record::parse(&serde_json::to_vec(&json!({
        "session":"traditional-foot", "project":"quota-fixture", "at":1000, "lang":"zh-Hant",
        "quota":{"rateLimits":[{"kind":"five_hour","percentUsed":62,"resetsAt":946_728_000_000.}]}
    })).unwrap()).unwrap();
    assert_eq!(record.lang, "zh-Hant");
    let mut sessions = Sessions::default();
    sessions.receive(record, 1001.);
    let mut ui = UiState::default();
    ui.open_activity(&sessions, 1001.);
    for step in 2..=16 {
        let scale = step as f64 / 4.;
        let canvas = ui.render(scale);
        let feet: Vec<_> = canvas
            .texts
            .iter()
            .enumerate()
            .filter(|(_, r)| r.font_size == 12.5 * scale && r.text.contains("62"))
            .collect();
        assert!(!feet.is_empty(), "missing quota foot at {scale}");
        for (index, run) in feet {
            assert_eq!(run.lang, "zh-Hant");
            assert!(run.text.contains("5小時"), "{}", run.text);
            let lines = wrapped_lines(run, false, canvas.text_prefixes[index]);
            assert_eq!(lines.concat(), run.text);
            let (_, height) = measure_ui(
                &run.text,
                &run.lang,
                run.font_size,
                false,
                false,
                run.width,
                10000. * scale,
            );
            assert!(
                height <= run.height + 1.,
                "{scale}: {height} > {}",
                run.height
            );
            assert!(
                run.y + run.height <= canvas.height as f64,
                "{scale}: footer out of canvas"
            );
        }
    }
}
