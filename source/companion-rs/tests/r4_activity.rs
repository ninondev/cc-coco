use coco_companion::{
    feed::{ActivityRow, Record, Sessions},
    ui::{mixed_text_metrics, word, Control, Quota, UiState},
};

fn activity(lang: &str) -> UiState {
    let mut ui = UiState::default();
    ui.open_activity(&Sessions::default(), 1001.);
    ui.chosen.lang = lang.into();
    ui.chosen.quota = Some(Quota::example());
    ui
}

#[test]
fn activity_foot_keeps_every_measured_line_in_all_languages_and_scales() {
    for lang in coco_companion::languages::codes() {
        let mut ui = activity(lang);
        let q = ui.chosen.quota.as_mut().unwrap();
        // An opaque producer pace must be retained even if it cannot use an approved
        // narrow template. This also exercises more than two lines without relying
        // on one platform's exact font fallback.
        q.windows[0].pace = Some("pace-fixture ".repeat(18));
        for scale in [1., 2.] {
            let canvas = ui.render(scale);
            let q = ui.chosen.quota.as_ref().unwrap();
            let runs = q
                .windows
                .iter()
                .map(|window| {
                    let expected = window.announcement(lang);
                    canvas
                        .texts
                        .iter()
                        .find(|run| {
                            run.text
                                .replace('\n', coco_companion::ui::part_separator(lang))
                                == expected
                        })
                        .expect("complete foot text")
                })
                .collect::<Vec<_>>();
            for run in &runs {
                let prefix = q
                    .windows
                    .iter()
                    .find(|window| run.text.starts_with(&window.display_name(lang)))
                    .unwrap()
                    .display_name(lang)
                    .chars()
                    .count();
                let needed = mixed_text_metrics(
                    &run.text,
                    lang,
                    run.font_size,
                    run.width,
                    10000. * scale,
                    prefix,
                )
                .1;
                assert!(
                    run.height >= needed,
                    "retained lines: {lang} at {scale}x: {} < {needed}",
                    run.height
                );
                assert!(
                    run.y + run.height <= canvas.height as f64 - ui.surface_inset() * scale,
                    "foot remains inside the paper: {lang}"
                );
            }
            assert!(
                runs[1].y >= runs[0].y + runs[0].height + 2. * scale,
                "measured rows cannot overlap: {lang}"
            );
        }
    }
}

#[test]
fn activity_foot_shortens_only_the_approved_pace_before_growing() {
    for lang in coco_companion::languages::codes() {
        let mut ui = activity(lang);
        let duration = "duration-fixture ".repeat(8);
        let wide = word(lang, "quota.pace.wide", 0).replace("{t}", &duration);
        let narrow = word(lang, "quota.pace.narrow", 0).replace("{t}", &duration);
        ui.chosen.quota.as_mut().unwrap().windows[0].pace = Some(wide.clone());
        let canvas = ui.render(1.);
        let first = &ui.chosen.quota.as_ref().unwrap().windows[0];
        let source = first.announcement(lang);
        let candidate = source.replace(&wide, &narrow);
        let prefix = first.display_name(lang).chars().count();
        // The foot's words run 242 points, after the battery (ui.rs QUOTA_TEXT_WIDTH).
        let measure = |text: &str| mixed_text_metrics(text, lang, 12.5, 242., 10000., prefix);
        let expected = if measure(&candidate).2 < measure(&source).2 {
            candidate
        } else {
            source
        };
        let run = canvas
            .texts
            .iter()
            .find(|run| {
                run.text
                    .replace('\n', coco_companion::ui::part_separator(lang))
                    == expected
            })
            .expect("approved narrow pace keeps duration, quota name, used and reset");
        let needed = measure(&run.text).1;
        assert!(run.height >= needed, "remaining complete lines: {lang}");
    }
}

#[test]
fn activity_empty_line_reserves_height_and_twelve_point_gap_before_foot() {
    for lang in coco_companion::languages::codes() {
        let ui = activity(lang);
        let canvas = ui.render(1.);
        let empty = canvas
            .texts
            .iter()
            .find(|run| run.text == ui.chosen.word("empty"))
            .unwrap();
        let first = &ui.chosen.quota.as_ref().unwrap().windows[0];
        let foot = canvas
            .texts
            .iter()
            .find(|run| {
                run.text
                    .replace('\n', coco_companion::ui::part_separator(lang))
                    == first.announcement(lang)
            })
            .unwrap();
        assert_eq!(
            foot.y - 5. - (empty.y + empty.height),
            12.,
            "empty/foot gap: {lang}"
        );
    }
}

#[test]
fn activity_accessible_row_reads_excerpt_before_open_action() {
    let mut ui = activity("en");
    let record = Record {
        session: "unseen-row".into(),
        project: "fixture".into(),
        ..Record::resting()
    };
    ui.rows.push(ActivityRow {
        record: record.clone(),
        state: "finished".into(),
        unseen: true,
        excerpt: Some("excerpt-fixture".into()),
    });
    let control = Control::Row(record.session.clone());
    let elements = ui.elements();
    let element = elements
        .iter()
        .find(|element| element.control == control)
        .unwrap();
    assert!(
        element.label.find("excerpt-fixture").unwrap()
            < element.label.find("Opens Claude.").unwrap()
    );
    #[cfg(feature = "a11y")]
    {
        let tree = coco_companion::accessibility::tree(&ui, &ui.chosen);
        let node = &tree
            .nodes
            .iter()
            .find(|(id, _)| *id == coco_companion::accessibility::id(&control))
            .unwrap()
            .1;
        assert_ne!(
            node.state_description(),
            Some(word("en", "tray.tipUnseen", 1).as_str()),
            "a row state cannot announce a tray tooltip"
        );
    }
}

#[cfg(feature = "a11y")]
#[test]
fn unseen_rows_have_their_own_approved_localized_state() {
    for lang in coco_companion::languages::codes() {
        let mut ui = activity(lang);
        let record = Record {
            session: "unseen-row".into(),
            ..Record::resting()
        };
        ui.rows.push(ActivityRow {
            record: record.clone(),
            state: "finished".into(),
            unseen: true,
            excerpt: None,
        });
        let control = Control::Row(record.session.clone());
        let tree = coco_companion::accessibility::tree(&ui, &ui.chosen);
        let node = &tree
            .nodes
            .iter()
            .find(|(id, _)| *id == coco_companion::accessibility::id(&control))
            .unwrap()
            .1;
        assert_eq!(
            node.state_description(),
            Some(word(lang, "companion.a11y.unseen", 0).as_str()),
            "row state: {lang}"
        );
    }
}
