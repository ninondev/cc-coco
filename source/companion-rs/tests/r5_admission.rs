use coco_companion::{
    feed::Record,
    protocol::{PresenceProjection, PresenceSnapshot},
};
use serde_json::json;

#[test]
fn traditional_chinese_presence_is_admitted_at_snapshot_and_event_seams() {
    for event_only in [false, true] {
        let mut snapshot = PresenceSnapshot::initial(1000.0);
        if !event_only {
            snapshot.lang = Some("zh-Hant".into());
        }
        snapshot.event.lang = Some("zh-Hant".into());
        assert!(
            snapshot.valid(),
            "zh-Hant must be a supported presence language"
        );
        assert!(PresenceSnapshot::parse(&serde_json::to_vec(&snapshot).unwrap()).is_some());
    }
    let mut snapshot = PresenceSnapshot::initial(1000.0);
    let mut event = snapshot.event.clone();
    event.lang = Some("zh-Hant".into());
    snapshot.sleep_event = Some(event.clone());
    snapshot.wake_event = Some(event.clone());
    snapshot.clingy_event = Some(event);
    assert!(
        snapshot.valid(),
        "optional presence events share language admission"
    );
}

#[test]
fn traditional_chinese_feed_and_presence_recipes_are_preserved() {
    let record = Record::from_value(&json!({"session":"r5", "at":1000, "lang":"zh-Hant"})).unwrap();
    assert_eq!(record.lang, "zh-Hant");
    let mut projection = PresenceProjection::default();
    projection.recipes(
        &json!({"lines":{"zh-Hant":{"sleep":["r5-traditional"]},"en":{"sleep":["r5-english"]}}}),
    );
    let mut snapshot = PresenceSnapshot::initial(1000.0);
    snapshot.lang = Some("zh-Hant".into());
    snapshot.asleep = true;
    snapshot.event.kind = "sleep".into();
    snapshot.event.id = "sleep:1:1000".into();
    snapshot.event.lang = Some("zh-Hant".into());
    assert!(projection.receive(snapshot));
    assert_eq!(
        projection.presence(1001.0).unwrap().said.as_deref(),
        Some("r5-traditional")
    );
}

#[test]
fn feed_keeps_bounded_forward_producer_language_tags() {
    let record =
        Record::from_value(&json!({"session":"r5", "at":1000, "lang":"future-Latn"})).unwrap();
    assert_eq!(record.lang, "future-Latn");
}

#[test]
fn presence_still_rejects_unknown_language_tags() {
    let mut snapshot = PresenceSnapshot::initial(1000.0);
    snapshot.lang = Some("future-Latn".into());
    assert!(!snapshot.valid());
    snapshot.lang = Some("en".into());
    snapshot.event.lang = Some("future-Latn".into());
    assert!(!snapshot.valid());
}
