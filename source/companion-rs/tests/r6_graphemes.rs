#![cfg(target_os = "macos")]
use coco_companion::{languages, locale, render::guard_korean_words};
use std::{ffi::c_void, ptr};
type Ref = *const c_void;
#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFStringCreateWithBytes(alloc: Ref, bytes: *const u8, len: isize, encoding: u32, external: u8) -> Ref;
    fn CFDictionaryCreate(alloc: Ref, keys: *const Ref, values: *const Ref, count: isize, key_callbacks: Ref, value_callbacks: Ref) -> Ref;
    fn CFAttributedStringCreate(alloc: Ref, string: Ref, attributes: Ref) -> Ref;
    fn CFRelease(value: Ref);
    static kCFTypeDictionaryKeyCallBacks: c_void;
    static kCFTypeDictionaryValueCallBacks: c_void;
}
#[link(name = "CoreText", kind = "framework")]
extern "C" {
    static kCTFontAttributeName: Ref;
    static kCTLanguageAttributeName: Ref;
    fn CTFontCreateWithName(name: Ref, size: f64, transform: Ref) -> Ref;
    fn CTLineCreateWithAttributedString(string: Ref) -> Ref;
    fn CTLineGetTypographicBounds(line: Ref, ascent: *mut f64, descent: *mut f64, leading: *mut f64) -> f64;
}

// Shape directly with CoreText so the reference never passes through the UI's
// guard, wrapping, or measurement helpers. Width and vertical bounds include
// native fallback glyphs, including dotted-circle substitutions.
fn native_unwrapped_bounds(text: &str, lang: &str, size: f64) -> [f64; 4] {
    unsafe {
        let string = |text: &str| CFStringCreateWithBytes(ptr::null(), text.as_ptr(), text.len() as isize, 0x08000100, 0);
        let name = string("Georgia");
        let font = CTFontCreateWithName(name, size, ptr::null());
        let language = string(lang);
        let source = string(text);
        let keys = [kCTFontAttributeName, kCTLanguageAttributeName];
        let values = [font, language];
        let attrs = CFDictionaryCreate(ptr::null(), keys.as_ptr(), values.as_ptr(), 2, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
        let attributed = CFAttributedStringCreate(ptr::null(), source, attrs);
        let line = CTLineCreateWithAttributedString(attributed);
        let (mut ascent, mut descent, mut leading) = (0., 0., 0.);
        let width = CTLineGetTypographicBounds(line, &mut ascent, &mut descent, &mut leading);
        for value in [line, attributed, attrs, source, language, font, name] { CFRelease(value); }
        [width, ascent, descent, leading]
    }
}

fn native_clause_pixels(text: &str, lang: &str) -> Vec<u8> {
    use coco_companion::{platform::macos_text, render::{Canvas, TextRun}};
    let mut canvas = Canvas::blank(2000, 120);
    canvas.texts.push(TextRun {
        text: text.into(), lang: lang.into(), x: 8., y: 8., width: 1984., height: 100., font_size: 25., line_height: None,
    });
    macos_text::paint(&mut canvas).unwrap();
    canvas.pixels
}

/// The tail of a guarded text that holds the last `source_bytes` bytes of the text it came from.
fn guarded_suffix(guarded: &str, source_bytes: usize) -> &str {
    let mut left = source_bytes;
    for (at, c) in guarded.char_indices().rev() {
        if c == '\u{2060}' {
            continue;
        }
        left = left.saturating_sub(c.len_utf8());
        if left == 0 {
            return &guarded[at..];
        }
    }
    guarded
}

#[test]
fn quota_guards_preserve_actual_coretext_shaping_of_regional_dates_and_joined_marks() {
    let words: serde_json::Value = serde_json::from_str(include_str!("../assets/words/quota.json")).unwrap();
    let now = coco_companion::epoch_ms() as f64;
    for lang in languages::codes() {
        let name = words[lang]["kinds"]["five_hour"].as_str().unwrap();
        let reset = words[lang]["resets"].as_str().unwrap();
        let mut dates = vec![locale::moment(now + 400. * 86_400_000., now, lang)];
        if lang == "hi" {
            // Date abbreviations, dependent vowels, and a conjunct all occur in
            // the protected field. The text is shaping input, not product copy.
            dates.extend(["7 अक्टू॰ 2027, 14:40".into(), "क्षि त्र्य स्त्री किं कु कृ".into()]);
        }
        if lang == "ko" { dates.push("한글 14:40".into()); }
        for date in dates {
            let separator = coco_companion::ui::part_separator(lang);
            let clause = reset.replace("{time}", &date);
            let source = format!("{name} 91%{separator}1h 5m{separator}{clause}");
            let guarded = guard_korean_words(&source, lang);
            assert_eq!(guarded.replace('\u{2060}', ""), source);
            if lang == "hi" {
                let source_clause = clause.as_str();
                let guarded_clause = guarded_suffix(&guarded, clause.len());
                let actual_pixels = native_clause_pixels(guarded_clause, lang);
                let expected_pixels = native_clause_pixels(source_clause, lang);
                let changed_channels = actual_pixels.iter().zip(&expected_pixels).filter(|(a, b)| a != b).count();
                assert_eq!(changed_channels, 0, "Hindi native date/conjunct pixels changed: {date}");
            }
            for size in [12.5, 25.] {
                let expected = native_unwrapped_bounds(&source, lang, size);
                let actual = native_unwrapped_bounds(&guarded, lang, size);
                for (index, (actual, expected)) in actual.into_iter().zip(expected).enumerate() {
                    assert!((actual - expected).abs() < 0.01, "{lang}@{size}: native bound {index} changed {expected} -> {actual}: {date}");
                }
            }
        }
    }
}
