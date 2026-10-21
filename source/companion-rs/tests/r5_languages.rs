use coco_companion::languages;

#[test]
fn shared_inventory_matches_generated_records_in_order() {
    let generated: serde_json::Value =
        serde_json::from_str(include_str!("../assets/words/languages.json")).unwrap();
    let expected: Vec<_> = generated
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["code"].as_str().unwrap())
        .collect();
    assert_eq!(languages::codes().collect::<Vec<_>>(), expected);
    assert_eq!(languages::all().len(), expected.len());
    for language in languages::all() {
        assert!(languages::is_supported(&language.code));
        assert_eq!(languages::locale(&language.code), language.locale);
        assert_eq!(languages::native_name(&language.code), language.native);
        assert_eq!(languages::english_name(&language.code), language.english);
    }
}

#[test]
fn native_names_and_unknown_locale_fallback_use_language_metadata() {
    assert_eq!(languages::locale("zh-Hant"), "zh-TW");
    assert_eq!(languages::native_name("zh-Hant"), "國語");
    assert_eq!(languages::english_name("zh-Hant"), "Chinese (Traditional)");
    assert_eq!(languages::native_name("ja"), "日本語");
    assert!(!languages::is_supported("future-Latn"));
    assert_eq!(languages::locale("future-Latn"), languages::locale("en"));
    assert_eq!(
        languages::native_name("future-Latn"),
        languages::native_name("en")
    );
}
