//! Linux's existing Pango/HarfBuzz/fontconfig stack shapes the complete line. Loading the
//! native libraries on demand avoids a second font engine and does not start any process.
use std::{
    cell::RefCell,
    error::Error,
    ffi::{c_char, c_int, c_void, CString},
};

pub struct Library(*mut c_void);
impl Library {
    pub fn open(name: &str) -> Result<Self, Box<dyn Error>> {
        let name = CString::new(name)?;
        let handle = unsafe { libc::dlopen(name.as_ptr(), libc::RTLD_NOW | libc::RTLD_LOCAL) };
        if handle.is_null() {
            return Err(format!(
                "Required Linux library {} is unavailable",
                name.to_string_lossy()
            )
            .into());
        }
        Ok(Self(handle))
    }
    pub unsafe fn symbol<T: Copy>(&self, name: &str) -> Result<T, Box<dyn Error>> {
        let name = CString::new(name)?;
        let value = unsafe { libc::dlsym(self.0, name.as_ptr()) };
        if value.is_null() {
            return Err(format!(
                "Required native symbol {} is unavailable",
                name.to_string_lossy()
            )
            .into());
        }
        // Function pointers and dlsym pointers have the same representation on supported Linux ABIs.
        Ok(unsafe { std::mem::transmute_copy(&value) })
    }
}
// A Library is never dlclosed. GLib, GObject, Pango and Cairo register types and callbacks that
// outlive any handle, so unloading them when a thread-local cache drops crashes with SIGSEGV.
// The handles stay loaded until the process ends.

type Ptr = *mut c_void;
#[repr(C)]
#[derive(Default)]
struct PangoRect {
    x: c_int,
    y: c_int,
    width: c_int,
    height: c_int,
}
#[derive(Clone, PartialEq)]
struct Key {
    line: String,
    lang: String,
    font: u64,
    width: u64,
    height: u64,
    weight: u16,
    color: [u8; 4],
    prefix: usize,
    sans: bool,
    middle: bool,
    line_height: Option<u64>,
}
impl Key {
    fn new(line: &str, lang: &str, font: f64, width: f64, height: f64) -> Self {
        Self {
            line: line.into(),
            lang: lang.into(),
            font: font.to_bits(),
            width: width.to_bits(),
            height: height.to_bits(),
            weight: 400,
            color: [35, 27, 25, 255],
            prefix: 0,
            sans: false,
            middle: false,
            line_height: None,
        }
    }
}
struct Ink {
    key: Key,
    pixels: Vec<u8>,
    width: usize,
    height: usize,
    missing: usize,
}
struct LineHeight {
    absolute: unsafe extern "C" fn(c_int) -> Ptr,
    new: unsafe extern "C" fn() -> Ptr,
    get: unsafe extern "C" fn(Ptr) -> Ptr,
    copy: unsafe extern "C" fn(Ptr) -> Ptr,
    insert: unsafe extern "C" fn(Ptr, Ptr),
    set: unsafe extern "C" fn(Ptr, Ptr),
    unref: unsafe extern "C" fn(Ptr),
}
impl LineHeight {
    fn load(pango: &Library) -> Option<Self> {
        // Absolute line-height attributes are optional on older system Pango.
        unsafe {
            Some(Self {
                absolute: pango.symbol("pango_attr_line_height_new_absolute").ok()?,
                new: pango.symbol("pango_attr_list_new").ok()?,
                get: pango.symbol("pango_layout_get_attributes").ok()?,
                copy: pango.symbol("pango_attr_list_copy").ok()?,
                insert: pango.symbol("pango_attr_list_insert").ok()?,
                set: pango.symbol("pango_layout_set_attributes").ok()?,
                unref: pango.symbol("pango_attr_list_unref").ok()?,
            })
        }
    }
    fn apply(&self, layout: Ptr, line_height: Option<f64>) {
        let Some(height) =
            line_height.filter(|h| h.is_finite() && *h > 0. && *h * 1024. <= c_int::MAX as f64)
        else {
            return;
        };
        unsafe {
            let old = (self.get)(layout);
            let attrs = if old.is_null() {
                (self.new)()
            } else {
                (self.copy)(old)
            };
            if attrs.is_null() {
                return;
            }
            let attribute = (self.absolute)((height * 1024.).round() as c_int);
            if !attribute.is_null() {
                // Insert transfers ownership; copying preserves semibold prefix markup.
                (self.insert)(attrs, attribute);
                (self.set)(layout, attrs);
            }
            (self.unref)(attrs);
        }
    }
}
pub struct Text {
    cache: RefCell<Vec<Ink>>,
    metrics: RefCell<Option<(Key, (f64, f64))>>,
    line_height: Option<LineHeight>,
    _cairo: Library,
    _pango: Library,
    _pangocairo: Library,
    _gobject: Library,
    surface: unsafe extern "C" fn(*mut u8, c_int, c_int, c_int, c_int) -> Ptr,
    surface_destroy: unsafe extern "C" fn(Ptr),
    surface_flush: unsafe extern "C" fn(Ptr),
    create: unsafe extern "C" fn(Ptr) -> Ptr,
    destroy: unsafe extern "C" fn(Ptr),
    move_to: unsafe extern "C" fn(Ptr, f64, f64),
    source: unsafe extern "C" fn(Ptr, f64, f64, f64, f64),
    layout: unsafe extern "C" fn(Ptr) -> Ptr,
    show: unsafe extern "C" fn(Ptr, Ptr),
    text: unsafe extern "C" fn(Ptr, *const c_char, c_int),
    markup: unsafe extern "C" fn(Ptr, *const c_char, c_int),
    width: unsafe extern "C" fn(Ptr, c_int),
    height: unsafe extern "C" fn(Ptr, c_int),
    ellipsize: unsafe extern "C" fn(Ptr, c_int),
    line_count: unsafe extern "C" fn(Ptr) -> c_int,
    pixel_size: unsafe extern "C" fn(Ptr, *mut c_int, *mut c_int),
    index_position: unsafe extern "C" fn(Ptr, c_int, *mut PangoRect),
    cursor_position: unsafe extern "C" fn(Ptr, c_int, *mut PangoRect, *mut PangoRect),
    log_attributes: unsafe extern "C" fn(Ptr, *mut c_int) -> *const u32,
    wrap: unsafe extern "C" fn(Ptr, c_int),
    font: unsafe extern "C" fn(*const c_char) -> Ptr,
    font_size: unsafe extern "C" fn(Ptr, f64),
    font_weight: unsafe extern "C" fn(Ptr, c_int),
    set_font: unsafe extern "C" fn(Ptr, Ptr),
    free_font: unsafe extern "C" fn(Ptr),
    get_context: unsafe extern "C" fn(Ptr) -> Ptr,
    language: unsafe extern "C" fn(*const c_char) -> Ptr,
    set_language: unsafe extern "C" fn(Ptr, Ptr),
    unknown: unsafe extern "C" fn(Ptr) -> c_int,
    unref: unsafe extern "C" fn(Ptr),
}
fn font_description(lang: &str, sans: bool) -> CString {
    let family = if sans {
        "sans-serif"
    } else {
        crate::linux_model::serif_family(lang)
    };
    CString::new(family).unwrap()
}
thread_local! {
    static UI_TEXT: RefCell<Option<Text>> = const { RefCell::new(None) };
}
/// The drawn UI uses the same native Pango measurement and font selection as painting.
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
pub fn measure_ui_weight(
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
pub fn measure_ui_weight_with_line_height(
    text: &str,
    lang: &str,
    size: f64,
    weight: u16,
    sans: bool,
    width: f64,
    height: f64,
    line_height: Option<f64>,
) -> (f64, f64) {
    UI_TEXT.with(|cache| {
        let mut cache = cache.borrow_mut();
        if cache.is_none() {
            *cache = Some(Text::new().expect("Required Linux text engine is unavailable"));
        }
        cache
            .as_ref()
            .unwrap()
            .measure_weight_with_line_height(
                text,
                lang,
                size,
                width,
                height,
                weight,
                sans,
                false,
                line_height,
            )
            .expect("Required Linux text measurement failed")
    })
}
impl Text {
    pub fn new() -> Result<Self, Box<dyn Error>> {
        let cairo = Library::open("libcairo.so.2")?;
        let pango = Library::open("libpango-1.0.so.0")?;
        let pangocairo = Library::open("libpangocairo-1.0.so.0")?;
        let gobject = Library::open("libgobject-2.0.so.0")?;
        unsafe {
            Ok(Self {
                cache: RefCell::new(Vec::new()),
                metrics: RefCell::new(None),
                line_height: LineHeight::load(&pango),
                surface: cairo.symbol("cairo_image_surface_create_for_data")?,
                surface_destroy: cairo.symbol("cairo_surface_destroy")?,
                surface_flush: cairo.symbol("cairo_surface_flush")?,
                create: cairo.symbol("cairo_create")?,
                destroy: cairo.symbol("cairo_destroy")?,
                move_to: cairo.symbol("cairo_move_to")?,
                source: cairo.symbol("cairo_set_source_rgba")?,
                layout: pangocairo.symbol("pango_cairo_create_layout")?,
                show: pangocairo.symbol("pango_cairo_show_layout")?,
                text: pango.symbol("pango_layout_set_text")?,
                markup: pango.symbol("pango_layout_set_markup")?,
                width: pango.symbol("pango_layout_set_width")?,
                height: pango.symbol("pango_layout_set_height")?,
                ellipsize: pango.symbol("pango_layout_set_ellipsize")?,
                line_count: pango.symbol("pango_layout_get_line_count")?,
                pixel_size: pango.symbol("pango_layout_get_pixel_size")?,
                index_position: pango.symbol("pango_layout_index_to_pos")?,
                cursor_position: pango.symbol("pango_layout_get_cursor_pos")?,
                log_attributes: pango.symbol("pango_layout_get_log_attrs_readonly")?,
                wrap: pango.symbol("pango_layout_set_wrap")?,
                font: pango.symbol("pango_font_description_from_string")?,
                font_size: pango.symbol("pango_font_description_set_absolute_size")?,
                font_weight: pango.symbol("pango_font_description_set_weight")?,
                set_font: pango.symbol("pango_layout_set_font_description")?,
                free_font: pango.symbol("pango_font_description_free")?,
                get_context: pango.symbol("pango_layout_get_context")?,
                language: pango.symbol("pango_language_from_string")?,
                set_language: pango.symbol("pango_context_set_language")?,
                unknown: pango.symbol("pango_layout_get_unknown_glyphs_count")?,
                unref: gobject.symbol("g_object_unref")?,
                _cairo: cairo,
                _pango: pango,
                _pangocairo: pangocairo,
                _gobject: gobject,
            })
        }
    }

    /// Actual Pango scalar geometry, including the final insertion caret. Same layout as painting.
    pub fn character_rects(
        &self,
        line: &str,
        lang: &str,
        font_size: f64,
        max_width: f64,
        max_height: f64,
    ) -> Result<(Vec<(f64, f64, f64, f64)>, Vec<u32>), Box<dyn Error>> {
        let guarded = crate::render::korean_word_guard(line, lang);
        let bytes = CString::new(guarded.text.replace('\0', ""))?;
        let word_wrap = if lang.split('-').next() == Some("ko") {
            0
        } else {
            2
        };
        let language = CString::new(lang.replace('\0', ""))?;
        let family = CString::new(crate::linux_model::serif_family(lang))?;
        let mut pixel = [0u8; 4];
        unsafe {
            let surface = (self.surface)(pixel.as_mut_ptr(), 0, 1, 1, 4);
            let cr = (self.create)(surface);
            let layout = (self.layout)(cr);
            if layout.is_null() {
                (self.destroy)(cr);
                (self.surface_destroy)(surface);
                return Err("Cannot create Pango layout".into());
            }
            let font = (self.font)(family.as_ptr());
            (self.font_size)(font, font_size * 1024.);
            (self.set_font)(layout, font);
            (self.free_font)(font);
            (self.set_language)(
                (self.get_context)(layout),
                (self.language)(language.as_ptr()),
            );
            (self.text)(layout, bytes.as_ptr(), -1);
            (self.width)(layout, (max_width.max(1.) * 1024.) as i32);
            (self.height)(layout, (max_height.max(font_size) * 1024.) as i32);
            (self.ellipsize)(layout, 3);
            (self.wrap)(layout, word_wrap);
            let mut out = Vec::new();
            let source_length = guarded.byte_offsets.len() - 1;
            for (scalar, byte) in guarded.byte_offsets.iter().copied().enumerate() {
                let mut rect = PangoRect::default();
                if scalar == source_length {
                    (self.cursor_position)(layout, byte as i32, &mut rect, std::ptr::null_mut());
                } else {
                    (self.index_position)(layout, byte as i32, &mut rect);
                }
                let x = rect.x.min(rect.x.saturating_add(rect.width)) as f64 / 1024.;
                out.push((
                    x,
                    rect.y as f64 / 1024.,
                    rect.width.unsigned_abs() as f64 / 1024.,
                    rect.height as f64 / 1024.,
                ));
            }
            let mut count = 0;
            let attributes = (self.log_attributes)(layout, &mut count);
            let attrs = if attributes.is_null() || count <= 0 {
                vec![]
            } else {
                let native = std::slice::from_raw_parts(attributes, count as usize);
                (0..guarded.byte_offsets.len())
                    .map(|source_scalar| {
                        native
                            .get(guarded.scalar_prefix(source_scalar))
                            .copied()
                            .unwrap_or(0)
                    })
                    .collect()
            };
            (self.unref)(layout);
            (self.destroy)(cr);
            (self.surface_destroy)(surface);
            Ok((out, attrs))
        }
    }
    pub fn measure(
        &self,
        line: &str,
        lang: &str,
        font_size: f64,
        max_width: f64,
        max_height: f64,
    ) -> Result<(f64, f64), Box<dyn Error>> {
        self.measure_variant(
            line, lang, font_size, max_width, max_height, false, false, false,
        )
    }
    pub fn measure_variant(
        &self,
        line: &str,
        lang: &str,
        font_size: f64,
        max_width: f64,
        max_height: f64,
        bold: bool,
        sans: bool,
        middle: bool,
    ) -> Result<(f64, f64), Box<dyn Error>> {
        self.measure_weight(
            line,
            lang,
            font_size,
            max_width,
            max_height,
            if bold { 600 } else { 400 },
            sans,
            middle,
        )
    }
    pub fn measure_weight(
        &self,
        line: &str,
        lang: &str,
        font_size: f64,
        max_width: f64,
        max_height: f64,
        weight: u16,
        sans: bool,
        middle: bool,
    ) -> Result<(f64, f64), Box<dyn Error>> {
        self.measure_weight_with_line_height(
            line, lang, font_size, max_width, max_height, weight, sans, middle, None,
        )
    }
    pub fn measure_weight_with_line_height(
        &self,
        line: &str,
        lang: &str,
        font_size: f64,
        max_width: f64,
        max_height: f64,
        weight: u16,
        sans: bool,
        middle: bool,
        line_height: Option<f64>,
    ) -> Result<(f64, f64), Box<dyn Error>> {
        let mut key = Key::new(line, lang, font_size, max_width, max_height);
        key.weight = weight;
        key.sans = sans;
        key.middle = middle;
        key.line_height = line_height.map(f64::to_bits);
        if let Some((cached, value)) = &*self.metrics.borrow() {
            if cached == &key {
                return Ok(*value);
            }
        }
        let guarded = crate::render::guard_korean_words(line, lang);
        let line = CString::new(guarded.replace('\0', ""))?;
        let word_wrap = if lang.split('-').next() == Some("ko") {
            0
        } else {
            2
        };
        let family = font_description(lang, sans);
        let lang = CString::new(lang.replace('\0', ""))?;
        let mut pixel = [0u8; 4];
        unsafe {
            let surface = (self.surface)(pixel.as_mut_ptr(), 0, 1, 1, 4);
            let cr = (self.create)(surface);
            let layout = (self.layout)(cr);
            if layout.is_null() {
                (self.destroy)(cr);
                (self.surface_destroy)(surface);
                return Err("Cannot create Pango layout".into());
            }
            let font = (self.font)(family.as_ptr());
            (self.font_size)(font, font_size * 1024.);
            (self.font_weight)(font, weight as c_int);
            (self.set_font)(layout, font);
            (self.free_font)(font);
            (self.set_language)((self.get_context)(layout), (self.language)(lang.as_ptr()));
            (self.text)(layout, line.as_ptr(), -1);
            if let Some(api) = &self.line_height {
                api.apply(layout, line_height);
            }
            (self.width)(layout, (max_width.max(1.) * 1024.) as i32);
            (self.height)(layout, (max_height.max(font_size) * 1024.) as i32);
            (self.ellipsize)(layout, if middle { 2 } else { 3 });
            (self.wrap)(layout, word_wrap);
            let (mut w, mut h) = (0, 0);
            (self.pixel_size)(layout, &mut w, &mut h);
            (self.unref)(layout);
            (self.destroy)(cr);
            (self.surface_destroy)(surface);
            let value = (w as f64, h as f64);
            *self.metrics.borrow_mut() = Some((key, value));
            Ok(value)
        }
    }

    pub fn measure_mixed(
        &self,
        line: &str,
        lang: &str,
        font_size: f64,
        max_width: f64,
        max_height: f64,
        weight: u16,
        sans: bool,
        middle: bool,
        line_height: Option<f64>,
        prefix: usize,
    ) -> Result<(f64, f64, usize), Box<dyn Error>> {
        let guarded = crate::render::korean_word_guard(line, lang);
        let first = guarded
            .text
            .chars()
            .take(guarded.scalar_prefix(prefix))
            .collect::<String>();
        let rest = guarded
            .text
            .chars()
            .skip(guarded.scalar_prefix(prefix))
            .collect::<String>();
        let escape = |s: &str| {
            s.replace('&', "&amp;")
                .replace('<', "&lt;")
                .replace('>', "&gt;")
        };
        let line = CString::new(format!(
            "<span weight=\"600\">{}</span>{}",
            escape(&first),
            escape(&rest)
        ))?;
        let word_wrap = if lang.split('-').next() == Some("ko") {
            0
        } else {
            2
        };
        let family = font_description(lang, sans);
        let lang = CString::new(lang.replace('\0', ""))?;
        let mut pixel = [0u8; 4];
        unsafe {
            let surface = (self.surface)(pixel.as_mut_ptr(), 0, 1, 1, 4);
            let cr = (self.create)(surface);
            let layout = (self.layout)(cr);
            if layout.is_null() {
                (self.destroy)(cr);
                (self.surface_destroy)(surface);
                return Err("Cannot create Pango layout".into());
            }
            let font = (self.font)(family.as_ptr());
            (self.font_size)(font, font_size * 1024.);
            (self.font_weight)(font, weight as c_int);
            (self.set_font)(layout, font);
            (self.free_font)(font);
            (self.set_language)((self.get_context)(layout), (self.language)(lang.as_ptr()));
            (self.markup)(layout, line.as_ptr(), -1);
            if let Some(api) = &self.line_height {
                api.apply(layout, line_height);
            }
            (self.width)(layout, (max_width.max(1.) * 1024.) as i32);
            (self.height)(layout, (max_height.max(font_size) * 1024.) as i32);
            (self.ellipsize)(layout, if middle { 2 } else { 3 });
            (self.wrap)(layout, word_wrap);
            let (mut w, mut h) = (0, 0);
            (self.pixel_size)(layout, &mut w, &mut h);
            let count = (self.line_count)(layout) as usize;
            (self.unref)(layout);
            (self.destroy)(cr);
            (self.surface_destroy)(surface);
            let value = (w as f64, h as f64, count);
            Ok(value)
        }
    }

    /// Composite native shaped text onto the shared premultiplied RGBA scene. The return
    /// value is the number of unavailable glyphs, so missing script fonts cannot look like success.
    pub fn paint(
        &self,
        rgba: &mut [u8],
        width: u32,
        height: u32,
        line: &str,
        lang: &str,
        x: f64,
        y: f64,
        font_size: f64,
        max_width: f64,
        max_height: f64,
    ) -> Result<usize, Box<dyn Error>> {
        self.paint_styled(
            rgba,
            width,
            height,
            line,
            lang,
            x,
            y,
            font_size,
            max_width,
            max_height,
            false,
            [35, 27, 25, 255],
            0,
        )
    }

    pub fn paint_styled(
        &self,
        rgba: &mut [u8],
        width: u32,
        height: u32,
        line: &str,
        lang: &str,
        x: f64,
        y: f64,
        font_size: f64,
        max_width: f64,
        max_height: f64,
        bold: bool,
        color: [u8; 4],
        prefix: usize,
    ) -> Result<usize, Box<dyn Error>> {
        self.paint_variant(
            rgba, width, height, line, lang, x, y, font_size, max_width, max_height, bold, color,
            prefix, false, false,
        )
    }
    pub fn paint_variant(
        &self,
        rgba: &mut [u8],
        width: u32,
        height: u32,
        line: &str,
        lang: &str,
        x: f64,
        y: f64,
        font_size: f64,
        max_width: f64,
        max_height: f64,
        bold: bool,
        color: [u8; 4],
        prefix: usize,
        sans: bool,
        middle: bool,
    ) -> Result<usize, Box<dyn Error>> {
        self.paint_weight(
            rgba,
            width,
            height,
            line,
            lang,
            x,
            y,
            font_size,
            max_width,
            max_height,
            if bold { 600 } else { 400 },
            color,
            prefix,
            sans,
            middle,
        )
    }
    pub fn paint_weight(
        &self,
        rgba: &mut [u8],
        width: u32,
        height: u32,
        line: &str,
        lang: &str,
        x: f64,
        y: f64,
        font_size: f64,
        max_width: f64,
        max_height: f64,
        weight: u16,
        color: [u8; 4],
        prefix: usize,
        sans: bool,
        middle: bool,
    ) -> Result<usize, Box<dyn Error>> {
        self.paint_weight_with_line_height(
            rgba, width, height, line, lang, x, y, font_size, max_width, max_height, weight, color,
            prefix, sans, middle, None,
        )
    }
    pub fn paint_weight_with_line_height(
        &self,
        rgba: &mut [u8],
        width: u32,
        height: u32,
        line: &str,
        lang: &str,
        x: f64,
        y: f64,
        font_size: f64,
        max_width: f64,
        max_height: f64,
        weight: u16,
        color: [u8; 4],
        prefix: usize,
        sans: bool,
        middle: bool,
        line_height: Option<f64>,
    ) -> Result<usize, Box<dyn Error>> {
        if width == 0 || height == 0 || rgba.len() != width as usize * height as usize * 4 {
            return Err("Invalid Linux text surface".into());
        }
        let mut key = Key::new(line, lang, font_size, max_width, max_height);
        key.weight = weight;
        key.color = color;
        key.prefix = prefix;
        key.sans = sans;
        key.middle = middle;
        key.line_height = line_height.map(f64::to_bits);
        let mut cache = self.cache.borrow_mut();
        let position = if let Some(index) = cache.iter().position(|entry| entry.key == key) {
            index
        } else {
            let guarded = crate::render::korean_word_guard(line, lang);
            let prefix = guarded.scalar_prefix(prefix);
            let line = CString::new(guarded.text.replace('\0', ""))?;
            let word_wrap = if lang.split('-').next() == Some("ko") {
                0
            } else {
                2
            };
            let family = font_description(lang, sans);
            let lang = CString::new(lang.replace('\0', ""))?;
            let (w, h) = (
                (max_width.max(1.).ceil() + 2.) as usize,
                (max_height.max(font_size).ceil() + 2.) as usize,
            );
            if w > 4096 || h > 4096 {
                return Err("Linux text raster dimensions exceed limit".into());
            }
            let mut ink = vec![0u8; w * h * 4];
            let missing = unsafe {
                let surface = (self.surface)(ink.as_mut_ptr(), 0, w as i32, h as i32, w as i32 * 4);
                if surface.is_null() {
                    return Err("Cannot allocate Cairo text surface".into());
                }
                let cr = (self.create)(surface);
                if cr.is_null() {
                    (self.surface_destroy)(surface);
                    return Err("Cannot create Cairo text context".into());
                }
                let layout = (self.layout)(cr);
                if layout.is_null() {
                    (self.destroy)(cr);
                    (self.surface_destroy)(surface);
                    return Err("Cannot create Pango layout".into());
                }
                let font = (self.font)(family.as_ptr());
                (self.font_size)(font, font_size * 1024.);
                (self.font_weight)(font, weight as c_int);
                (self.set_font)(layout, font);
                (self.free_font)(font);
                (self.set_language)((self.get_context)(layout), (self.language)(lang.as_ptr()));
                if prefix > 0 {
                    let plain = line.to_str().unwrap_or("");
                    let first = plain.chars().take(prefix).collect::<String>();
                    let rest = plain.chars().skip(prefix).collect::<String>();
                    let escape = |s: &str| {
                        s.replace('&', "&amp;")
                            .replace('<', "&lt;")
                            .replace('>', "&gt;")
                    };
                    let marked = CString::new(format!(
                        "<span weight=\"600\">{}</span>{}",
                        escape(&first),
                        escape(&rest)
                    ))?;
                    (self.markup)(layout, marked.as_ptr(), -1);
                } else {
                    (self.text)(layout, line.as_ptr(), -1);
                }
                if let Some(api) = &self.line_height {
                    api.apply(layout, line_height);
                }
                (self.width)(layout, (max_width.max(1.) * 1024.) as i32);
                (self.height)(layout, (max_height.max(font_size) * 1024.) as i32);
                (self.ellipsize)(layout, if middle { 2 } else { 3 });
                (self.wrap)(layout, word_wrap);
                (self.move_to)(cr, 0., 0.);
                (self.source)(
                    cr,
                    color[0] as f64 / 255.,
                    color[1] as f64 / 255.,
                    color[2] as f64 / 255.,
                    color[3] as f64 / 255.,
                );
                (self.show)(cr, layout);
                let missing = (self.unknown)(layout).max(0) as usize;
                (self.surface_flush)(surface);
                (self.unref)(layout);
                (self.destroy)(cr);
                (self.surface_destroy)(surface);
                missing
            };
            if cache.len() >= 10 {
                cache.remove(0);
            }
            cache.push(Ink {
                key,
                pixels: ink,
                width: w,
                height: h,
                missing,
            });
            cache.len() - 1
        };
        let ink = &cache[position];
        let (left, top) = (x.floor() as i32, y.floor() as i32);
        for sy in 0..ink.height {
            let dy = top + sy as i32;
            if dy < 0 || dy >= height as i32 {
                continue;
            }
            for sx in 0..ink.width {
                let dx = left + sx as i32;
                if dx < 0 || dx >= width as i32 {
                    continue;
                }
                let src = &ink.pixels[(sy * ink.width + sx) * 4..][..4];
                let a = src[3] as u32;
                if a == 0 {
                    continue;
                }
                let dst = &mut rgba[(dy as usize * width as usize + dx as usize) * 4..][..4];
                let out_a = a + (dst[3] as u32 * (255 - a) + 127) / 255;
                for (channel, value) in [src[2], src[1], src[0]].into_iter().enumerate() {
                    dst[channel] = (value as u32 + (dst[channel] as u32 * (255 - a) + 127) / 255)
                        .min(255) as u8;
                }
                dst[3] = out_a as u8;
            }
        }
        Ok(ink.missing)
    }
}

/// Native ARGB32 presentation uses premultiplied alpha on both X11 and Wayland.
pub fn argb32(rgba: &[u8]) -> Vec<u8> {
    rgba.chunks_exact(4)
        .flat_map(|p| [p[2], p[1], p[0], p[3]])
        .collect()
}

pub fn measure_mixed(
    text: &str,
    lang: &str,
    size: f64,
    width: f64,
    height: f64,
    prefix: usize,
) -> (f64, f64, usize) {
    UI_TEXT.with(|cache| {
        let mut cache = cache.borrow_mut();
        if cache.is_none() {
            *cache = Some(Text::new().expect("Required Linux text engine unavailable"));
        }
        cache
            .as_ref()
            .unwrap()
            .measure_mixed(
                text, lang, size, width, height, 400, false, false, None, prefix,
            )
            .expect("Required mixed text measurement failed")
    })
}
