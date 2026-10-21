#![cfg(target_os = "macos")]
use coco_companion::{
    feed::{Record, Sessions},
    platform::macos_text::wrapped_lines,
    ui::{word, UiState},
};
use serde_json::json;

fn footer(lang: &str, scale: f64) -> (UiState, coco_companion::render::Canvas) {
    let now = coco_companion::epoch_ms() as f64;
    let record = Record::parse(
        &serde_json::to_vec(&json!({
            "session":"r6-footer", "project":"quota-fixture", "at":now, "lang":lang,
            "quota":{"rateLimits":[
                {"kind":"five_hour","percentUsed":91,"resetsAt":now + 3_900_000.},
                {"kind":"seven_day","percentUsed":62,"resetsAt":now + 86_400_000.}
            ]}
        }))
        .unwrap(),
    )
    .unwrap();
    let mut sessions = Sessions::default();
    sessions.receive(record, now);
    let mut ui = UiState::default();
    ui.open_activity(&sessions, now);
    let first = &mut ui.chosen.quota.as_mut().unwrap().windows[0];
    first.hot = true;
    first.pace = Some(word(lang, "quota.pace.wide", 0).replace("{t}", "1h 5m"));
    let canvas = ui.render(scale);
    (ui, canvas)
}

#[test]
fn wrapped_tall_footer_rows_gain_eight_points_of_separation() {
    for lang in coco_companion::languages::codes() {
        for scale in [1., 2.] {
            let (ui, canvas) = footer(lang, scale);
            let rows: Vec<_> = canvas
                .texts
                .iter()
                .filter(|r| {
                    r.font_size == 12.5 * scale
                        && ui
                            .chosen
                            .quota
                            .as_ref()
                            .unwrap()
                            .windows
                            .iter()
                            .any(|w| r.text.starts_with(&w.display_name(lang)))
                })
                .collect();
            assert_eq!(rows.len(), 2, "{lang}");
            let first = rows[0];
            let gap = (rows[1].y - first.y - first.height) / scale;
            assert!(
                (gap - if first.height / scale > 32. { 10. } else { 2. }).abs() < 0.1,
                "{lang}@{scale}: row height {} gap {gap}",
                first.height / scale
            );
        }
    }
}

#[test]
fn footer_narrowing_requires_fewer_actual_mixed_weight_lines_and_keeps_tokens_whole() {
    for lang in coco_companion::languages::codes() {
        eprintln!("regional footer scale sweep: {lang}");
        for step in 2..=16 {
            let scale = step as f64 / 4.;
            let (ui, canvas) = footer(lang, scale);
            let (index, run) = canvas
                .texts
                .iter()
                .enumerate()
                .find(|(_, r)| {
                    r.font_size == 12.5 * scale
                        && r.text.starts_with(
                            &ui.chosen.quota.as_ref().unwrap().windows[0].display_name(lang),
                        )
                })
                .unwrap();
            let prefix = canvas.text_prefixes[index];
            let lines = wrapped_lines(run, false, prefix);
            let mut wide = run.clone();
            wide.text = ui.chosen.quota.as_ref().unwrap().windows[0].announcement(lang);
            wide.height = 10000. * scale;
            let wide_lines = wrapped_lines(&wide, false, prefix);
            // A clause break takes its comma with it (ui.rs quota_foot_rows), so only other words count as narrowing.
            let separator = coco_companion::ui::part_separator(lang);
            if run.text.replace('\n', separator) != wide.text {
                assert!(
                    lines.len() < wide_lines.len(),
                    "{lang}@{scale}: {:?} vs {:?}",
                    lines,
                    wide_lines
                );
            }
            assert!(
                lines.iter().any(|line| line.contains("1h 5m")),
                "{lang}@{scale}: {lines:?}"
            );
            assert!(
                !lines.iter().any(|line| line.trim() == "置"),
                "{lang}@{scale}: {lines:?}"
            );
            let window = &ui.chosen.quota.as_ref().unwrap().windows[0];
            let reset_clause = window
                .announcement_parts(lang, window.pace.as_deref())
                .pop()
                .unwrap();
            let quota_words: serde_json::Value =
                serde_json::from_str(include_str!("../assets/words/quota.json")).unwrap();
            let template = quota_words[lang]["resets"].as_str().unwrap();
            let (before, after) = template.split_once("{time}").unwrap();
            let date = reset_clause
                .strip_prefix(before)
                .unwrap()
                .strip_suffix(after)
                .unwrap();
            assert!(
                lines.iter().any(|line| line.contains(date)),
                "{lang}@{scale}: date split: {lines:?}"
            );
            let name = ui.chosen.quota.as_ref().unwrap().windows[0].display_name(lang);
            for line in &lines {
                let line = line.trim_end();
                let split = if line.starts_with(&name) {
                    name.len()
                } else {
                    0
                };
                let measure = |text: &str, bold: bool| {
                    coco_companion::platform::macos_text::measure_ui(
                        text,
                        lang,
                        12.5 * scale,
                        bold,
                        false,
                        100000. * scale,
                        10000. * scale,
                    )
                    .0
                };
                let width = measure(&line[..split], true) + measure(&line[split..], false);
                assert!(
                    width <= run.width + 1.,
                    "{lang}@{scale}: {width} > {}: {line}",
                    run.width
                );
            }
        }
    }
}

#[test]
fn native_footer_prefers_clause_boundaries_without_adding_lines() {
    for lang in coco_companion::languages::codes() {
        let (ui, canvas) = footer(lang, 1.);
        let window = &ui.chosen.quota.as_ref().unwrap().windows[0];
        let name = window.display_name(lang);
        let (index, run) = canvas
            .texts
            .iter()
            .enumerate()
            .find(|(_, r)| r.font_size == 12.5 && r.text.starts_with(&name))
            .unwrap();
        let prefix = canvas.text_prefixes[index];
        let separator = coco_companion::ui::part_separator(lang);
        let parts = window.announcement_parts(lang, window.pace.as_deref());
        let mut source = run.clone();
        source.text = parts.join(separator);
        source.height = 10000.;
        let original_count = wrapped_lines(&source, false, prefix).len();
        let shown = wrapped_lines(run, false, prefix).len();
        assert!(shown <= original_count);
        // The narrow pace already saved a line (zh: «剩1h 5m» for «1h 5m后没电»), so no clause break is wanted.
        if shown < original_count {
            continue;
        }
        for join in 1..parts.len().min(3) {
            let mut preferred = source.clone();
            preferred.text =
                parts
                    .iter()
                    .enumerate()
                    .fold(String::new(), |mut text, (index, part)| {
                        if index > 0 {
                            text.push_str(if index == join { "\n" } else { separator });
                        }
                        text.push_str(part);
                        text
                    });
            if wrapped_lines(&preferred, false, prefix).len() <= original_count {
                assert!(
                    run.text.contains('\n'),
                    "{lang}: missed fitting clause boundary: {}",
                    run.text
                );
            }
        }
    }
}

#[test]
fn regional_dates_remain_whole_and_inside_footer_width_at_all_quarter_scales() {
    let quota_words: serde_json::Value =
        serde_json::from_str(include_str!("../assets/words/quota.json")).unwrap();
    for lang in coco_companion::languages::codes() {
        let (mut ui, _) = footer(lang, 1.);
        ui.chosen.quota.as_mut().unwrap().windows[1].reset =
            Some(coco_companion::epoch_ms() as f64 + 400. * 86_400_000.);
        eprintln!("regional footer scale sweep: {lang}");
        for step in 2..=16 {
            let scale = step as f64 / 4.;
            let canvas = ui.render(scale);
            let window = &ui.chosen.quota.as_ref().unwrap().windows[1];
            let name = window.display_name(lang);
            let (index, run) = canvas
                .texts
                .iter()
                .enumerate()
                .find(|(_, r)| r.font_size == 12.5 * scale && r.text.starts_with(&name))
                .unwrap();
            let lines = wrapped_lines(run, false, canvas.text_prefixes[index]);
            let reset = window
                .announcement_parts(lang, window.pace.as_deref())
                .pop()
                .unwrap();
            let reset = reset.as_str();
            let (before, after) = quota_words[lang]["resets"]
                .as_str()
                .unwrap()
                .split_once("{time}")
                .unwrap();
            let date = reset
                .strip_prefix(before)
                .unwrap()
                .strip_suffix(after)
                .unwrap();
            assert!(
                lines.iter().any(|line| line.contains(date)),
                "{lang}@{scale}: {date}: {lines:?}"
            );
            for line in &lines {
                let line = line.trim_end();
                let split = if line.starts_with(&name) {
                    name.len()
                } else {
                    0
                };
                let measure = |text: &str, bold: bool| {
                    coco_companion::platform::macos_text::measure_ui(
                        text,
                        lang,
                        12.5 * scale,
                        bold,
                        false,
                        100000. * scale,
                        10000. * scale,
                    )
                    .0
                };
                let width = measure(&line[..split], true) + measure(&line[split..], false);
                assert!(
                    width <= run.width + 1.,
                    "{lang}@{scale}: {width} > {}: {line}",
                    run.width
                );
            }
        }
    }
}

#[test]
fn wrapped_footer_ink_has_more_space_between_rows_than_within_them() {
    fn bands(
        canvas: &coco_companion::render::Canvas,
        run: &coco_companion::render::TextRun,
        scale: f64,
    ) -> Vec<(u32, u32)> {
        let mut bands: Vec<(u32, u32)> = Vec::new();
        for y in run.y.floor() as u32..((run.y + run.height).ceil() as u32).min(canvas.height) {
            let ink = (run.x.ceil() as u32..((run.x + run.width).floor() as u32).min(canvas.width))
                .any(|x| {
                    let p = ((y * canvas.width + x) * 4) as usize;
                    canvas.pixels[p] < 160
                        && canvas.pixels[p + 1] < 160
                        && canvas.pixels[p + 2] < 160
                });
            if ink {
                if let Some(last) = bands
                    .last_mut()
                    .filter(|last| y - last.1 <= (2. * scale).ceil() as u32 + 1)
                {
                    last.1 = y;
                } else {
                    bands.push((y, y));
                }
            }
        }
        bands
    }
    for lang in coco_companion::languages::codes() {
        for scale in [1., 2.] {
            let (ui, mut canvas) = footer(lang, scale);
            let rows = canvas
                .texts
                .iter()
                .filter(|r| {
                    r.font_size == 12.5 * scale
                        && ui
                            .chosen
                            .quota
                            .as_ref()
                            .unwrap()
                            .windows
                            .iter()
                            .any(|w| r.text.starts_with(&w.display_name(lang)))
                })
                .cloned()
                .collect::<Vec<_>>();
            assert_eq!(rows.len(), 2);
            if rows[0].height / scale <= 32. {
                continue;
            }
            coco_companion::platform::macos_text::paint(&mut canvas).unwrap();
            let a = bands(&canvas, &rows[0], scale);
            let b = bands(&canvas, &rows[1], scale);
            assert!(
                !a.is_empty() && !b.is_empty(),
                "{lang}: actual text ink required"
            );
            let inside = a
                .windows(2)
                .chain(b.windows(2))
                .map(|pair| pair[1].0 - pair[0].1 - 1)
                .max()
                .unwrap_or(0);
            let between = b[0].0 - a.last().unwrap().1 - 1;
            assert!(
                between > inside,
                "{lang}@{scale}: between={between} inside={inside} bands={a:?}/{b:?}"
            );
        }
    }
}
