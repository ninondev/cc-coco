//! Offscreen preview text only. No NSApplication, windows, login integration or app-file access.
use crate::{
    render::{Canvas, TextRun},
    Error,
};
use std::{ffi::c_void, ptr};
type Ref = *const c_void;
#[repr(C)]
#[derive(Clone, Copy)]
struct Point {
    x: f64,
    y: f64,
}
#[repr(C)]
#[derive(Clone, Copy)]
struct Size {
    width: f64,
    height: f64,
}
#[repr(C)]
#[derive(Clone, Copy)]
struct Rect {
    origin: Point,
    size: Size,
}
#[repr(C)]
struct Range {
    location: isize,
    length: isize,
}
#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFStringCreateWithBytes(
        alloc: Ref,
        bytes: *const u8,
        len: isize,
        encoding: u32,
        external: u8,
    ) -> Ref;
    fn CFDictionaryCreate(
        alloc: Ref,
        keys: *const Ref,
        values: *const Ref,
        count: isize,
        key_callbacks: Ref,
        value_callbacks: Ref,
    ) -> Ref;
    fn CFAttributedStringCreate(alloc: Ref, string: Ref, attributes: Ref) -> Ref;
    fn CFAttributedStringCreateMutableCopy(alloc: Ref, max_length: isize, string: Ref) -> Ref;
    fn CFAttributedStringSetAttribute(string: Ref, range: Range, key: Ref, value: Ref);
    fn CFArrayGetCount(array: Ref) -> isize;
    fn CFArrayGetValueAtIndex(array: Ref, index: isize) -> Ref;
    fn CFRelease(value: Ref);
    static kCFTypeDictionaryKeyCallBacks: c_void;
    static kCFTypeDictionaryValueCallBacks: c_void;
}
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGColorSpaceCreateDeviceRGB() -> Ref;
    fn CGBitmapContextCreate(
        data: *mut c_void,
        width: usize,
        height: usize,
        bits: usize,
        stride: usize,
        space: Ref,
        info: u32,
    ) -> Ref;
    fn CGContextRelease(ctx: Ref);
    fn CGContextSetTextPosition(ctx: Ref, x: f64, y: f64);
    fn CGColorSpaceRelease(space: Ref);
    fn CGColorCreateGenericRGB(r: f64, g: f64, b: f64, a: f64) -> Ref;
    fn CGColorRelease(color: Ref);
    fn CGPathCreateMutable() -> Ref;
    fn CGPathAddRect(path: Ref, transform: Ref, rect: Rect);
    fn CGPathRelease(path: Ref);
}
#[link(name = "CoreText", kind = "framework")]
extern "C" {
    static kCTFontAttributeName: Ref;
    static kCTForegroundColorAttributeName: Ref;
    static kCTLanguageAttributeName: Ref;
    static kCTParagraphStyleAttributeName: Ref;
    fn CTParagraphStyleCreate(settings: *const ParagraphSetting, count: usize) -> Ref;
    fn CTFontCreateWithName(name: Ref, size: f64, transform: Ref) -> Ref;
    fn CTFramesetterCreateWithAttributedString(string: Ref) -> Ref;
    fn CTFramesetterSuggestFrameSizeWithConstraints(
        setter: Ref,
        range: Range,
        attributes: Ref,
        constraints: Size,
        fit_range: *mut Range,
    ) -> Size;
    fn CTFramesetterCreateFrame(setter: Ref, range: Range, path: Ref, attributes: Ref) -> Ref;
    fn CTFrameDraw(frame: Ref, context: Ref);
    fn CTFrameGetLines(frame: Ref) -> Ref;
    fn CTLineGetStringRange(line: Ref) -> Range;
    fn CTLineCreateWithAttributedString(string: Ref) -> Ref;
    fn CTLineCreateTruncatedLine(line: Ref, width: f64, kind: u32, token: Ref) -> Ref;
    fn CTLineDraw(line: Ref, context: Ref);
    fn CTLineGetTypographicBounds(
        line: Ref,
        ascent: *mut f64,
        descent: *mut f64,
        leading: *mut f64,
    ) -> f64;
    fn CTFontGetAscent(font: Ref) -> f64;
}
#[repr(C)]
struct ParagraphSetting {
    specifier: u32,
    value_size: usize,
    value: *const c_void,
}
fn paragraph_style(line_height: Option<f64>) -> Option<Owned> {
    let value = line_height.filter(|v| v.is_finite() && *v > 0.)?;
    let settings = [8, 9].map(|specifier| ParagraphSetting {
        specifier,
        value_size: std::mem::size_of::<f64>(),
        value: (&value as *const f64).cast(),
    });
    Some(Owned(unsafe {
        CTParagraphStyleCreate(settings.as_ptr(), settings.len())
    }))
}
struct Owned(Ref);
impl Drop for Owned {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                CFRelease(self.0);
            }
        }
    }
}
fn string(s: &str) -> Owned {
    Owned(unsafe {
        CFStringCreateWithBytes(ptr::null(), s.as_ptr(), s.len() as isize, 0x08000100, 0)
    })
}
pub fn paint(canvas: &mut Canvas) -> Result<(), Error> {
    if let Some(run) = canvas.bubble.clone() {
        paint_run(canvas, &run)?;
    }
    for (index, run) in canvas.texts.clone().iter().enumerate() {
        let (bold, color) = canvas
            .text_styles
            .get(index)
            .copied()
            .unwrap_or((false, [35, 27, 25, 255]));
        let prefix = canvas.text_prefixes.get(index).copied().unwrap_or(0);
        let saved = canvas.save_text_clip(index);
        paint_styled(
            canvas,
            run,
            bold,
            color,
            false,
            prefix,
            canvas.text_sans.get(index).copied().unwrap_or(false),
            canvas.text_middle.get(index).copied().unwrap_or(false),
        )?;
        canvas.restore_text_clip(saved);
    }
    Ok(())
}
pub fn paint_run(canvas: &mut Canvas, run: &TextRun) -> Result<(), Error> {
    let ink = canvas.bubble_ink();
    paint_styled(
        canvas,
        run,
        false,
        ink,
        !canvas.bubble_is_task,
        canvas.bubble_prefix,
        false,
        false,
    )
}
fn paint_styled(
    canvas: &mut Canvas,
    run: &TextRun,
    bold: bool,
    rgba: [u8; 4],
    fit: bool,
    prefix: usize,
    sans: bool,
    middle: bool,
) -> Result<(), Error> {
    unsafe {
        let font_name = string(if sans {
            if bold {
                "Helvetica-Bold"
            } else {
                "Helvetica"
            }
        } else if bold {
            "Georgia-Bold"
        } else {
            "Georgia"
        });
        let guarded = crate::render::korean_word_guard(&run.text, &run.lang);
        let text = string(&guarded.text);
        let lang = string(&run.lang);
        let font = Owned(CTFontCreateWithName(
            font_name.0,
            run.font_size,
            ptr::null(),
        ));
        let color = CGColorCreateGenericRGB(
            rgba[0] as f64 / 255.,
            rgba[1] as f64 / 255.,
            rgba[2] as f64 / 255.,
            rgba[3] as f64 / 255.,
        );
        let style = paragraph_style(run.line_height);
        let mut keys = vec![
            kCTFontAttributeName,
            kCTForegroundColorAttributeName,
            kCTLanguageAttributeName,
        ];
        let mut values = vec![font.0, color, lang.0];
        if let Some(style) = &style {
            keys.push(kCTParagraphStyleAttributeName);
            values.push(style.0);
        }
        let attributes = Owned(CFDictionaryCreate(
            ptr::null(),
            keys.as_ptr(),
            values.as_ptr(),
            keys.len() as isize,
            &kCFTypeDictionaryKeyCallBacks,
            &kCFTypeDictionaryValueCallBacks,
        ));
        let original = Owned(CFAttributedStringCreate(ptr::null(), text.0, attributes.0));
        let attributed = Owned(CFAttributedStringCreateMutableCopy(
            ptr::null(),
            0,
            original.0,
        ));
        if prefix > 0 {
            let name = string("Georgia-Bold");
            let bold = Owned(CTFontCreateWithName(name.0, run.font_size, ptr::null()));
            CFAttributedStringSetAttribute(
                attributed.0,
                Range {
                    location: 0,
                    length: guarded.utf16_prefix(prefix) as isize,
                },
                kCTFontAttributeName,
                bold.0,
            );
        }
        CGColorRelease(color);
        let setter = Owned(CTFramesetterCreateWithAttributedString(attributed.0));
        let measured = CTFramesetterSuggestFrameSizeWithConstraints(
            setter.0,
            Range {
                location: 0,
                length: 0,
            },
            ptr::null(),
            Size {
                width: run.width,
                height: 160. * canvas.width as f64 / 320.,
            },
            ptr::null_mut(),
        );
        if fit {
            canvas.fit_bubble(
                measured.width.min(run.width),
                measured.height,
                canvas.width as f64 / 320.,
            );
        }
        let run = if fit {
            canvas.bubble.clone().unwrap_or_else(|| run.clone())
        } else {
            run.clone()
        };
        let path = CGPathCreateMutable();
        CGPathAddRect(
            path,
            ptr::null(),
            Rect {
                origin: Point {
                    x: run.x,
                    y: canvas.height as f64 - run.y - run.height,
                },
                size: Size {
                    width: run.width,
                    height: run.height,
                },
            },
        );
        let frame = Owned(CTFramesetterCreateFrame(
            setter.0,
            Range {
                location: 0,
                length: 0,
            },
            path,
            ptr::null(),
        ));
        CGPathRelease(path);
        let space = CGColorSpaceCreateDeviceRGB();
        let context = CGBitmapContextCreate(
            canvas.pixels.as_mut_ptr().cast(),
            canvas.width as usize,
            canvas.height as usize,
            8,
            canvas.width as usize * 4,
            space,
            1 | (4 << 12),
        );
        CGColorSpaceRelease(space);
        if context.is_null() {
            return Err("could not make offscreen text context".into());
        }
        if !fit && run.height <= run.font_size * 1.6 {
            let line = Owned(CTLineCreateWithAttributedString(attributed.0));
            let dots = string("…");
            let token_attr = Owned(CFAttributedStringCreate(ptr::null(), dots.0, attributes.0));
            let token = Owned(CTLineCreateWithAttributedString(token_attr.0));
            let trimmed = Owned(CTLineCreateTruncatedLine(
                line.0,
                run.width,
                if middle { 2 } else { 1 },
                token.0,
            ));
            CGContextSetTextPosition(
                context,
                run.x,
                canvas.height as f64 - run.y - CTFontGetAscent(font.0),
            );
            CTLineDraw(
                if trimmed.0.is_null() {
                    line.0
                } else {
                    trimmed.0
                },
                context,
            );
        } else {
            CTFrameDraw(frame.0, context);
        }
        CGContextRelease(context);
        Ok(())
    }
}

/// Offscreen measurement uses the same CoreText font, language and fallback as painting.
pub fn measure_ui(
    text: &str,
    lang: &str,
    size: f64,
    bold: bool,
    sans: bool,
    width: f64,
    height: f64,
) -> (f64, f64) {
    measure_ui_with_line_height(text, lang, size, bold, sans, width, height, None)
}
pub fn measure_ui_with_line_height(
    text: &str,
    lang: &str,
    size: f64,
    bold: bool,
    sans: bool,
    width: f64,
    height: f64,
    line_height: Option<f64>,
) -> (f64, f64) {
    unsafe {
        let name = string(if sans {
            if bold {
                "Helvetica-Bold"
            } else {
                "Helvetica"
            }
        } else if bold {
            "Georgia-Bold"
        } else {
            "Georgia"
        });
        let font = Owned(CTFontCreateWithName(name.0, size, ptr::null()));
        let guarded = crate::render::guard_korean_words(text, lang);
        let text = string(&guarded);
        let lang = string(lang);
        let style = paragraph_style(line_height);
        let mut keys = vec![kCTFontAttributeName, kCTLanguageAttributeName];
        let mut vals = vec![font.0, lang.0];
        if let Some(style) = &style {
            keys.push(kCTParagraphStyleAttributeName);
            vals.push(style.0);
        }
        let dict = Owned(CFDictionaryCreate(
            ptr::null(),
            keys.as_ptr(),
            vals.as_ptr(),
            keys.len() as isize,
            &kCFTypeDictionaryKeyCallBacks,
            &kCFTypeDictionaryValueCallBacks,
        ));
        let attr = Owned(CFAttributedStringCreate(ptr::null(), text.0, dict.0));
        if width >= 9999. {
            let line = Owned(CTLineCreateWithAttributedString(attr.0));
            let mut a = 0.;
            let mut d = 0.;
            let mut l = 0.;
            let w = CTLineGetTypographicBounds(line.0, &mut a, &mut d, &mut l);
            return (w.ceil(), (a + d + l).ceil());
        }
        let setter = Owned(CTFramesetterCreateWithAttributedString(attr.0));
        let result = CTFramesetterSuggestFrameSizeWithConstraints(
            setter.0,
            Range {
                location: 0,
                length: 0,
            },
            ptr::null(),
            Size { width, height },
            ptr::null_mut(),
        );
        (result.width.ceil(), result.height.ceil())
    }
}

/// Inspect the actual offscreen CoreText frame used by the preview painter. This
/// is a test seam for line-boundary acceptance, without launching a native app.
pub fn measure_mixed(run: &TextRun, prefix: usize) -> (f64, f64, usize) {
    mixed_frame(run, false, prefix).1
}
pub fn wrapped_lines(run: &TextRun, bold: bool, prefix: usize) -> Vec<String> {
    mixed_frame(run, bold, prefix).0
}
fn mixed_frame(run: &TextRun, bold: bool, prefix: usize) -> (Vec<String>, (f64, f64, usize)) {
    unsafe {
        let guarded = crate::render::korean_word_guard(&run.text, &run.lang);
        let text = string(&guarded.text);
        let lang = string(&run.lang);
        let name = string(if bold { "Georgia-Bold" } else { "Georgia" });
        let font = Owned(CTFontCreateWithName(name.0, run.font_size, ptr::null()));
        let style = paragraph_style(run.line_height);
        let mut keys = vec![kCTFontAttributeName, kCTLanguageAttributeName];
        let mut values = vec![font.0, lang.0];
        if let Some(style) = &style {
            keys.push(kCTParagraphStyleAttributeName);
            values.push(style.0);
        }
        let attributes = Owned(CFDictionaryCreate(
            ptr::null(),
            keys.as_ptr(),
            values.as_ptr(),
            keys.len() as isize,
            &kCFTypeDictionaryKeyCallBacks,
            &kCFTypeDictionaryValueCallBacks,
        ));
        let original = Owned(CFAttributedStringCreate(ptr::null(), text.0, attributes.0));
        let attributed = Owned(CFAttributedStringCreateMutableCopy(
            ptr::null(),
            0,
            original.0,
        ));
        if prefix > 0 {
            let name = string("Georgia-Bold");
            let font = Owned(CTFontCreateWithName(name.0, run.font_size, ptr::null()));
            CFAttributedStringSetAttribute(
                attributed.0,
                Range {
                    location: 0,
                    length: guarded.utf16_prefix(prefix) as isize,
                },
                kCTFontAttributeName,
                font.0,
            );
        }
        let setter = Owned(CTFramesetterCreateWithAttributedString(attributed.0));
        let measured = CTFramesetterSuggestFrameSizeWithConstraints(
            setter.0,
            Range {
                location: 0,
                length: 0,
            },
            ptr::null(),
            Size {
                width: run.width,
                height: run.height,
            },
            ptr::null_mut(),
        );
        let path = CGPathCreateMutable();
        CGPathAddRect(
            path,
            ptr::null(),
            Rect {
                origin: Point { x: 0., y: 0. },
                size: Size {
                    width: run.width,
                    height: run.height,
                },
            },
        );
        let frame = Owned(CTFramesetterCreateFrame(
            setter.0,
            Range {
                location: 0,
                length: 0,
            },
            path,
            ptr::null(),
        ));
        CGPathRelease(path);
        let lines = CTFrameGetLines(frame.0);
        let units = guarded.text.encode_utf16().collect::<Vec<_>>();
        let count = CFArrayGetCount(lines) as usize;
        let strings = (0..CFArrayGetCount(lines))
            .map(|index| {
                let range = CTLineGetStringRange(CFArrayGetValueAtIndex(lines, index));
                let start = range.location as usize;
                let end = start + range.length as usize;
                String::from_utf16(&units[start..end])
                    .expect("CoreText scalar line boundary")
                    .replace('\u{2060}', "")
            })
            .collect();
        (
            strings,
            (measured.width.ceil(), measured.height.ceil(), count),
        )
    }
}
