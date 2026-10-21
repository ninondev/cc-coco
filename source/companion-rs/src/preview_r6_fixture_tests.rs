#[cfg(test)]
mod r6_fixture_tests {
    use super::*;
    use crate::feed::ActivityRow;
    #[test]
    fn localized_fixture_rows_and_pace_use_the_language_dictionary() {
        let now = crate::epoch_ms() as f64;
        let mut base = UiState::default();
        let mut record = Record::resting();
        record.session = "fixture".into();
        record.project = "atlas/plugin".into();
        record.at = now - 1_000.;
        record.done = record.at;
        record.quota = Some(ui::Quota::example());
        base.chosen = record.clone();
        base.rows.push(ActivityRow {
            record: record.clone(),
            state: record.word("finished").into(),
            unseen: true,
            excerpt: None,
        });
        let feed: serde_json::Value =
            serde_json::from_str(include_str!("../assets/words/feed.json")).unwrap();
        for lang in crate::languages::codes() {
            let fixture = localized(&base, lang);
            let row = &fixture.rows[0];
            assert_eq!(
                row.state,
                feed[lang]["finished"].as_str().unwrap(),
                "{lang}"
            );
            assert_eq!(row.record.project, "atlas/plugin");
            assert!((now - row.record.at).abs() < 60_000.);
            assert_eq!(
                fixture.chosen.quota.as_ref().unwrap().windows[0]
                    .pace
                    .as_deref(),
                Some(
                    ui::word(lang, "quota.pace.wide", 0)
                        .replace("{t}", "1h 5m")
                        .as_str()
                ),
                "{lang}"
            );
        }
    }
}
