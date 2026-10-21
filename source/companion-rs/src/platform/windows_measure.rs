//! Native UI measurements share the fonts and weights used by the Windows painter.
use super::wide;
use crate::Error;
use std::{cell::RefCell, collections::HashMap};
use windows::{
    core::PCWSTR,
    Win32::{Foundation::BOOL, Graphics::DirectWrite::*},
};
pub(super) fn family(
    fonts: &IDWriteFontCollection,
    lang: &str,
    sans: bool,
) -> Result<String, Error> {
    let requested = if sans {
        "Segoe UI"
    } else {
        match lang {
            "ja" => "Yu Mincho",
            "zh" | "zh-Hant" => "SimSun",
            "ko" => "Batang",
            "hi" => "Nirmala UI",
            _ => "Sitka Text",
        }
    };
    let name = wide(requested);
    let mut index = 0;
    let mut installed = BOOL(0);
    unsafe {
        fonts.FindFamilyName(PCWSTR(name.as_ptr()), &mut index, &mut installed)?;
    }
    Ok(if installed.as_bool() {
        requested
    } else if sans {
        "Arial"
    } else {
        "Georgia"
    }
    .into())
}
pub(super) unsafe fn apply_line_height(
    fonts: &IDWriteFontCollection,
    format: &IDWriteTextFormat,
    family: &str,
    size: f64,
    weight: u16,
    line_height: Option<f64>,
) -> Result<(), Error> {
    let Some(line_height) = line_height else {
        return Ok(());
    };
    if !line_height.is_finite() || line_height <= 0. {
        return Err("invalid native text line height".into());
    }
    let name = wide(family);
    let mut index = 0;
    let mut exists = BOOL(0);
    fonts.FindFamilyName(PCWSTR(name.as_ptr()), &mut index, &mut exists)?;
    if !exists.as_bool() {
        return Err("selected native text family unavailable".into());
    }
    let font = fonts.GetFontFamily(index)?.GetFirstMatchingFont(
        DWRITE_FONT_WEIGHT(weight as i32),
        DWRITE_FONT_STRETCH_NORMAL,
        DWRITE_FONT_STYLE_NORMAL,
    )?;
    let mut metrics = DWRITE_FONT_METRICS::default();
    font.GetMetrics(&mut metrics);
    if metrics.designUnitsPerEm == 0 {
        return Err("native text font has no em metrics".into());
    }
    let baseline = size * metrics.ascent as f64 / metrics.designUnitsPerEm as f64;
    format.SetLineSpacing(
        DWRITE_LINE_SPACING_METHOD_UNIFORM,
        line_height as f32,
        baseline as f32,
    )?;
    Ok(())
}
#[derive(Hash, PartialEq, Eq)]
struct Key {
    text: String,
    lang: String,
    family: String,
    size: u64,
    weight: u16,
    sans: bool,
    width: u64,
    height: u64,
    line_height: Option<u64>,
}
struct Metrics {
    write: IDWriteFactory,
    fonts: IDWriteFontCollection,
    cache: HashMap<Key, (f64, f64)>,
}
impl Metrics {
    unsafe fn new() -> Result<Self, Error> {
        let write: IDWriteFactory = DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED)?;
        let mut fonts = None;
        write.GetSystemFontCollection(&mut fonts, false)?;
        Ok(Self {
            write,
            fonts: fonts.ok_or("system font collection unavailable")?,
            cache: HashMap::new(),
        })
    }
    unsafe fn measure(
        &mut self,
        text: &str,
        lang: &str,
        size: f64,
        weight: u16,
        sans: bool,
        width: f64,
        height: f64,
        line_height: Option<f64>,
    ) -> Result<(f64, f64), Error> {
        let family = family(&self.fonts, lang, sans)?;
        let key = Key {
            text: text.into(),
            lang: lang.into(),
            family: family.clone(),
            size: size.to_bits(),
            weight,
            sans,
            width: width.to_bits(),
            height: height.to_bits(),
            line_height: line_height.map(f64::to_bits),
        };
        if let Some(value) = self.cache.get(&key) {
            return Ok(*value);
        }
        let family_name = family;
        let family = wide(&family_name);
        let language = wide(lang);
        let format = self.write.CreateTextFormat(
            PCWSTR(family.as_ptr()),
            None,
            DWRITE_FONT_WEIGHT(weight as i32),
            DWRITE_FONT_STYLE_NORMAL,
            DWRITE_FONT_STRETCH_NORMAL,
            size as f32,
            PCWSTR(language.as_ptr()),
        )?;
        apply_line_height(
            &self.fonts,
            &format,
            &family_name,
            size,
            weight,
            line_height,
        )?;
        format.SetWordWrapping(if lang.split('-').next() == Some("ko") {
            DWRITE_WORD_WRAPPING_WHOLE_WORD
        } else {
            DWRITE_WORD_WRAPPING_WRAP
        })?;
        if lang == "ar" {
            format.SetReadingDirection(DWRITE_READING_DIRECTION_RIGHT_TO_LEFT)?;
        }
        let guarded = crate::render::guard_korean_words(text, lang);
        let words = guarded.encode_utf16().collect::<Vec<_>>();
        let layout = self.write.CreateTextLayout(
            &words,
            &format,
            width.max(1.) as f32,
            height.max(1.) as f32,
        )?;
        let mut measured = DWRITE_TEXT_METRICS::default();
        layout.GetMetrics(&mut measured)?;
        let value = (
            measured.widthIncludingTrailingWhitespace as f64,
            measured.height as f64,
        );
        if self.cache.len() >= 256 {
            self.cache.clear();
        }
        self.cache.insert(key, value);
        Ok(value)
    }
    unsafe fn measure_mixed(
        &mut self,
        text: &str,
        lang: &str,
        size: f64,
        weight: u16,
        sans: bool,
        width: f64,
        height: f64,
        line_height: Option<f64>,
        prefix: usize,
    ) -> Result<(f64, f64, usize), Error> {
        let family = family(&self.fonts, lang, sans)?;
        let family_name = family;
        let family = wide(&family_name);
        let language = wide(lang);
        let format = self.write.CreateTextFormat(
            PCWSTR(family.as_ptr()),
            None,
            DWRITE_FONT_WEIGHT(weight as i32),
            DWRITE_FONT_STYLE_NORMAL,
            DWRITE_FONT_STRETCH_NORMAL,
            size as f32,
            PCWSTR(language.as_ptr()),
        )?;
        apply_line_height(
            &self.fonts,
            &format,
            &family_name,
            size,
            weight,
            line_height,
        )?;
        format.SetWordWrapping(if lang.split('-').next() == Some("ko") {
            DWRITE_WORD_WRAPPING_WHOLE_WORD
        } else {
            DWRITE_WORD_WRAPPING_WRAP
        })?;
        if lang == "ar" {
            format.SetReadingDirection(DWRITE_READING_DIRECTION_RIGHT_TO_LEFT)?;
        }
        let guarded = crate::render::korean_word_guard(text, lang);
        let words = guarded.text.encode_utf16().collect::<Vec<_>>();
        let layout = self.write.CreateTextLayout(
            &words,
            &format,
            width.max(1.) as f32,
            height.max(1.) as f32,
        )?;
        if prefix > 0 {
            layout.SetFontWeight(
                DWRITE_FONT_WEIGHT_SEMI_BOLD,
                DWRITE_TEXT_RANGE {
                    startPosition: 0,
                    length: guarded.utf16_prefix(prefix) as u32,
                },
            )?;
        }
        let mut measured = DWRITE_TEXT_METRICS::default();
        layout.GetMetrics(&mut measured)?;
        let value = (
            measured.widthIncludingTrailingWhitespace as f64,
            measured.height as f64,
            measured.lineCount as usize,
        );
        Ok(value)
    }
}
thread_local! {static METRICS:RefCell<Option<Metrics>>=const {RefCell::new(None)};}
pub(crate) fn measure_ui(
    text: &str,
    lang: &str,
    size: f64,
    bold: bool,
    sans: bool,
    width: f64,
    height: f64,
) -> (f64, f64) {
    measure_ui_weight(
        text,
        lang,
        size,
        if bold { 600 } else { 400 },
        sans,
        width,
        height,
    )
}
pub(crate) fn measure_ui_weight(
    text: &str,
    lang: &str,
    size: f64,
    weight: u16,
    sans: bool,
    width: f64,
    height: f64,
) -> (f64, f64) {
    measure_ui_weight_with_line_height(text, lang, size, weight, sans, width, height, None)
}
pub(crate) fn measure_ui_with_line_height(
    text: &str,
    lang: &str,
    size: f64,
    bold: bool,
    sans: bool,
    width: f64,
    height: f64,
    line_height: Option<f64>,
) -> (f64, f64) {
    measure_ui_weight_with_line_height(
        text,
        lang,
        size,
        if bold { 600 } else { 400 },
        sans,
        width,
        height,
        line_height,
    )
}
fn measure_ui_weight_with_line_height(
    text: &str,
    lang: &str,
    size: f64,
    weight: u16,
    sans: bool,
    width: f64,
    height: f64,
    line_height: Option<f64>,
) -> (f64, f64) {
    METRICS.with(|cell| unsafe {
        let mut slot = cell.borrow_mut();
        if slot.is_none() {
            *slot = Metrics::new().ok();
        }
        slot.as_mut()
            .and_then(|metrics| {
                metrics
                    .measure(text, lang, size, weight, sans, width, height, line_height)
                    .ok()
            })
            .unwrap_or((width.max(1.), height.max(1.)))
    })
}

pub(crate) fn measure_mixed(
    text: &str,
    lang: &str,
    size: f64,
    width: f64,
    height: f64,
    prefix: usize,
) -> (f64, f64, usize) {
    METRICS.with(|cell| unsafe {
        let mut slot = cell.borrow_mut();
        if slot.is_none() {
            *slot = Some(Metrics::new().expect("Required DirectWrite text engine unavailable"));
        }
        slot.as_mut()
            .unwrap()
            .measure_mixed(text, lang, size, 400, false, width, height, None, prefix)
            .expect("Required mixed text measurement failed")
    })
}
