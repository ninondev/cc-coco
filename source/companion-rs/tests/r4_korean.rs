use coco_companion::render::guard_korean_words;

#[test]
fn korean_guard_preserves_spaces_words_newlines_and_non_korean_text() {
    let original = "초기화 전에\n5시간 한도";
    let guarded = guard_korean_words(original, "ko");
    assert_eq!(guarded.replace('\u{2060}', ""), original);
    assert_eq!(guarded.split_whitespace().count(), original.split_whitespace().count());
    assert!(guarded.contains("초\u{2060}기\u{2060}화"));
    assert!(guarded.contains("\n5\u{2060}시\u{2060}간"));
    for lang in ["zh", "ja", "en"] {
        assert_eq!(guard_korean_words(original, lang), original);
    }
}

#[cfg(target_os = "macos")]
#[test]
fn korean_native_foot_lines_break_only_at_spaces() {
    use coco_companion::{platform::macos_text::wrapped_lines, render::TextRun};
    // All pieces fit individually in the actual 242 pt foot width. Repeated
    // approved quota words expose partial Hangul fills at different line edges.
    // The result comes from CoreText's actual frame line ranges, not from counting
    // inserted guards or comparing an otherwise-equivalent total text height.
    for repeats in 1..=8 {
        let text = format!("5시간 한도 62% 사용, {}10월 6일 오후 8:18에 초기화", "1시간 5분 남았어, ".repeat(repeats));
        let run = TextRun {
            text: text.clone(), lang: "ko".into(), x: 0., y: 0., width: 242., height: 10000.,
            font_size: 12.5, line_height: None,
        };
        let lines = wrapped_lines(&run, false, "5시간 한도".chars().count());
        assert!(lines.len() >= 2, "fixture must wrap at the real foot width");
        assert_eq!(lines.concat(), text, "line ranges retain all source text");
        let mut byte = 0;
        for line in lines.iter().take(lines.len() - 1) {
            byte += line.len();
            let before = text[..byte].chars().next_back().unwrap();
            let after = text[byte..].chars().next().unwrap();
            assert!(before.is_whitespace() || after.is_whitespace(),
                "Korean word was split at actual line edge: {line:?} | {:?}", &text[byte..]);
        }
    }
}
