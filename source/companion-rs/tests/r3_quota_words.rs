use coco_companion::{
    feed::{Record, Sessions},
    ui::{moment_text, UiState},
};
use serde_json::{json, Value};

fn approved_book(lang: &str) -> Value {
    let source = include_str!("../../hooks-source/book-text.ts");
    let marker = format!("read(\"{lang}\",");
    let start = source.find(&marker).expect("approved locale") + marker.len();
    let encoded = serde_json::Deserializer::from_str(&source[start..])
        .into_iter::<Value>()
        .next()
        .expect("approved JSON argument")
        .expect("approved quoted JSON");
    serde_json::from_str(encoded.as_str().expect("approved quoted dictionary"))
        .expect("approved book dictionary")
}

#[test]
fn numeric_quota_reset_uses_book_moment_in_all_twelve_activity_feet_and_accesskit_labels() {
    // A numeric noon-UTC reading from 2000 remains an other-year moment, independent of
    // today's local date. Compare the complete approved template, not merely "resets".
    let reset = 946_728_000_000.;
    for lang in coco_companion::languages::codes() {
        let record = Record::parse(
            serde_json::to_vec(&json!({
                "session":"quota-contract", "project":"quota-fixture", "at":1000,
                "lang":lang,
                "quota":{"rateLimits":[{"kind":"five_hour","percentUsed":62,"resetsAt":reset}]}
            }))
            .unwrap()
            .as_slice(),
        )
        .unwrap();
        let book = approved_book(lang);
        let foot = &book["offerings"];
        let separator = coco_companion::ui::part_separator(lang);
        let expected = format!(
            "{} {}{separator}{}",
            foot["kinds"]["five_hour"].as_str().unwrap(),
            foot["used"].as_str().unwrap().replace("{percent}", "62"),
            foot["resets"].as_str().unwrap().replace(
                "{time}",
                &moment_text(reset, coco_companion::epoch_ms() as f64, lang),
            ),
        );
        let window = &record.quota.as_ref().unwrap().windows[0];
        assert_eq!(window.reset, Some(reset), "numeric reading: {lang}");
        assert_eq!(window.announcement(lang), expected, "announcement: {lang}");
        assert!(!expected.contains('{') && !expected.contains('}'), "{lang}");
        let mut sessions = Sessions::default();
        sessions.receive(record, 1001.);
        let mut ui = UiState::default();
        ui.open_activity(&sessions, 1001.);
        let canvas = ui.render(1.);
        assert!(
            canvas
                .texts
                .iter()
                // A foot that wraps breaks between its clauses and drops the comma with the break (OUTSIDE F6).
                .any(|run| run.text.replace('\n', separator) == expected),
            "Activity foot: {lang}"
        );
        #[cfg(feature = "a11y")]
        {
            let tree = coco_companion::accessibility::tree(&ui, &ui.chosen);
            assert!(
                tree.nodes.iter().any(|(id, node)| {
                    *id == accesskit::NodeId(10) && node.label() == Some(expected.as_str())
                }),
                "AccessKit foot: {lang}"
            );
        }
    }
}
