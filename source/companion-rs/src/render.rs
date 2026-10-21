use crate::Error;
use unicode_segmentation::UnicodeSegmentation;
pub const MIN_CANVAS_SCALE: f64 = 0.5;
pub const MAX_CANVAS_SCALE: f64 = 4.;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs::File,
    io::{BufRead, BufReader, Seek},
    path::{Component, Path, PathBuf},
    sync::Arc,
};

/// Native shapers normally offer a line break after each Hangul syllable. The
/// Korean copy uses whitespace-delimited words; zero-width joiners remove only
/// those internal break opportunities. Quota durations and date/time fields use
/// the same mapped guard. Source text stays intact.
pub fn guard_korean_words(text: &str, lang: &str) -> String {
    if lang.split('-').next() != Some("ko") && !is_quota_footer(text, lang) {
        return text.to_owned();
    }
    korean_word_guard(text, lang).text
}

pub(crate) struct KoreanWordGuard {
    pub text: String,
    /// UTF-8 positions in the guarded text for each original Unicode scalar and
    /// the end caret. Native bold prefixes and character geometry use this map.
    pub byte_offsets: Vec<usize>,
}
impl KoreanWordGuard {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    pub fn utf16_prefix(&self, source_scalars: usize) -> usize {
        let at = self.byte_offsets[source_scalars.min(self.byte_offsets.len() - 1)];
        self.text[..at].encode_utf16().count()
    }
    #[cfg(target_os = "linux")]
    pub fn scalar_prefix(&self, source_scalars: usize) -> usize {
        let at = self.byte_offsets[source_scalars.min(self.byte_offsets.len() - 1)];
        self.text[..at].chars().count()
    }
}
pub(crate) fn korean_word_guard(text: &str, lang: &str) -> KoreanWordGuard {
    let mut guarded = String::with_capacity(text.len());
    let mut offsets = Vec::with_capacity(text.chars().count() + 1);
    let footer = is_quota_footer(text, lang);
    let reset_ranges = if footer {
        let words = quota_guard_words();
        words.get(lang).unwrap_or(&words["en"])["resets"]
            .as_str()
            .and_then(|template| {
                let (before, after) = template.split_once("{time}")?;
                let start = reset_clause_start(text, lang, before)?;
                let moment = text[start..].strip_prefix(before)?.strip_suffix(after)?;
                let time_start = start + before.len();
                Some((
                    time_start,
                    time_start + moment.len(),
                    text.len() - after.len(),
                ))
            })
    } else {
        None
    };
    let mut korean_ranges = Vec::new();
    if lang.split('-').next() == Some("ko") {
        let mut begin = 0;
        for token in text.split_inclusive(char::is_whitespace) {
            let word = token.trim_end_matches(char::is_whitespace);
            if word.chars().any(is_hangul) {
                korean_ranges.push((begin, begin + word.len()));
            }
            begin += token.len();
        }
    }
    let duration_start = if footer {
        text.find("h ").and_then(|at| {
            let start = text[..at]
                .rfind(|c: char| !c.is_ascii_digit())
                .map_or(0, |i| i + 1);
            let end = text[at + 2..].find('m').map(|i| at + 3 + i)?;
            Some((start, end))
        })
    } else {
        None
    };
    for (at, grapheme) in text.grapheme_indices(true) {
        let c = grapheme.chars().next().expect("nonempty grapheme");
        let korean = korean_ranges
            .iter()
            .any(|(start, end)| at > *start && at < *end);
        let reset = reset_ranges.is_some_and(|(start, end, suffix)| {
            (at > start && at < end)
                || (at > suffix
                    && !c.is_whitespace()
                    && text[suffix..at].chars().all(|c| !c.is_whitespace()))
        });
        let duration = duration_start.is_some_and(|(start, end)| at > start && at < end);
        if korean || reset || duration {
            guarded.push('\u{2060}');
        }
        // Keep one caret mapping per original scalar, including the scalars
        // inside a conjunct, without inserting anything inside its grapheme.
        for c in grapheme.chars() {
            offsets.push(guarded.len());
            guarded.push(c);
        }
    }
    offsets.push(guarded.len());
    KoreanWordGuard {
        text: guarded,
        byte_offsets: offsets,
    }
}

/// Where the reset clause of a quota footer begins. A clause with a lead word is found by that word. One
/// without (hi, ja, ko, zh) follows the last join between clauses: the language's comma, or the line break that
/// took its place. A Hindi date holds the same comma, so only a join after a "used" or pace clause counts.
fn reset_clause_start(text: &str, lang: &str, before: &str) -> Option<usize> {
    if !before.is_empty() {
        return text.rfind(before);
    }
    let words = quota_guard_words();
    let used = words.get(lang).unwrap_or(&words["en"])["used"]
        .as_str()
        .unwrap_or("");
    let wide = crate::ui::word(lang, "quota.pace.wide", 0);
    let narrow = crate::ui::word(lang, "quota.pace.narrow", 0);
    let endings: Vec<&str> = [
        (used, "{percent}"),
        (wide.as_str(), "{t}"),
        (narrow.as_str(), "{t}"),
    ]
    .into_iter()
    .filter_map(|(template, slot)| template.split_once(slot).map(|(_, tail)| tail))
    .filter(|tail| !tail.is_empty())
    .collect();
    let joins: Vec<(usize, usize)> = text
        .match_indices(crate::ui::part_separator(lang))
        .chain(text.match_indices('\n'))
        .map(|(at, join)| (at, join.len()))
        .collect();
    let clause_start = |(at, len): &(usize, usize)| at + len;
    joins
        .iter()
        .filter(|(at, _)| endings.iter().any(|tail| text[..*at].ends_with(tail)))
        .map(clause_start)
        .max()
        .or_else(|| joins.iter().map(clause_start).max())
}

fn is_quota_footer(text: &str, lang: &str) -> bool {
    if !text.contains(crate::ui::part_separator(lang)) && !text.contains('\n') {
        return false;
    }
    let words = quota_guard_words();
    words.get(lang).unwrap_or(&words["en"])["kinds"]
        .as_object()
        .is_some_and(|kinds| {
            kinds
                .values()
                .filter_map(serde_json::Value::as_str)
                .any(|name| text.starts_with(name))
        })
}

fn quota_guard_words() -> &'static serde_json::Value {
    static WORDS: std::sync::OnceLock<serde_json::Value> = std::sync::OnceLock::new();
    WORDS.get_or_init(|| {
        serde_json::from_str(include_str!("../assets/words/quota.json")).expect("quota words")
    })
}

fn is_hangul(c: char) -> bool {
    matches!(c as u32, 0x1100..=0x11ff | 0x3130..=0x318f | 0xa960..=0xa97f | 0xac00..=0xd7af | 0xd7b0..=0xd7ff)
}

/// Coordinates of one already-rasterized manifest frame. Authoring sheet
/// transforms are retained for provenance; applying them here would move twice.
#[derive(Clone, Debug, PartialEq)]
pub struct FramePlacement {
    pub name: String,
    pub parent: Option<String>,
    pub width: usize,
    pub height: usize,
    pub pixel: bool,
    pub overlay_offset_x: f64,
    pub source_offset: Arc<serde_json::Value>,
}

pub const NAMES: [&str; 16] = [
    "idle-reading",
    "idle-blink",
    "think-a",
    "think-b",
    "work-a",
    "work-b",
    "happy",
    "waiting",
    "error",
    "wild-a",
    "wild-b",
    "sleep",
    "refuse",
    "flustered",
    "wave",
    "snake",
];

/// Coco's size, the same three as the Mac pet: Medium 128, Large 186 (the default) and Larger 256 points,
/// all painted (owner 10-19: Windows and Linux move to the Mac's sizes). Settings and requests that still
/// name «tiny» or «small» read as Medium.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Size {
    Medium,
    #[default]
    Large,
    Larger,
}
impl Size {
    pub const ALL: [Self; 3] = [Self::Medium, Self::Large, Self::Larger];
    pub fn height(self) -> f64 {
        match self {
            Self::Medium => 128.,
            Self::Large => 186.,
            Self::Larger => 256.,
        }
    }
    pub fn font_size(self) -> f64 {
        match self {
            Self::Medium => 17.,
            Self::Large => 19.,
            Self::Larger => 21.,
        }
    }
    /// No size draws the pixel heads any more; their paths leave with the old frames, as on the Mac.
    pub fn pixel(self) -> bool {
        false
    }
    pub fn key(self) -> &'static str {
        match self {
            Self::Medium => "medium",
            Self::Large => "large",
            Self::Larger => "larger",
        }
    }
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "tiny" | "small" | "medium" => Some(Self::Medium),
            "large" => Some(Self::Large),
            "larger" => Some(Self::Larger),
            _ => None,
        }
    }
}

#[derive(Clone, Debug)]
pub struct TextRun {
    pub text: String,
    pub lang: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub font_size: f64,
    pub line_height: Option<f64>,
}
#[derive(Clone)]
pub struct Canvas {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u8>,
    pub bubble: Option<TextRun>,
    pub bubble_is_task: bool,
    /// A fixed-layout label on ordinary paper (the X11 picker's tooltip): laid out like the task pill, inked like paper.
    pub bubble_paper_ink: bool,
    pub bubble_prefix: usize,
    pub texts: Vec<TextRun>,
    pub text_styles: Vec<(bool, [u8; 4])>,
    pub text_prefixes: Vec<usize>,
    pub text_sans: Vec<bool>,
    pub text_weights: Vec<u16>,
    pub text_occlusion: Option<(usize, (u32, u32, u32, u32))>,
    pub text_middle: Vec<bool>,
    pub paper_dark: bool,
    pub look: crate::contrast::Look,
    /// Falling pages only, in this canvas's local coordinates. Native surfaces
    /// show this transparent layer solely over the host's occluded intersection.
    pub front_pages: Option<Box<Canvas>>,
    pub sprite_bounds: (i32, i32, u32, u32),
    /// How far below the top of the picture the line and the task pill are measured from, in device pixels:
    /// their picture has more room above their head than his painted frame had, so they come down by the difference.
    pub head_drop: f64,
    pub frame_placement: Option<FramePlacement>,
    pub overscan_bottom: u32,
    hit: Vec<u8>,
    silhouette_rows: Option<Vec<Option<(u32, u32)>>>,
}
impl Canvas {
    /// The ink of the text on the bubble: his line follows the appearance (paper, or the dark paper at night); the task
    /// pill is the book's near-black cloth in both, so its text is the cloth's light ink.
    pub fn bubble_ink(&self) -> [u8; 4] {
        if self.bubble_is_task && !self.bubble_paper_ink {
            crate::shapes::cover_ink(self)
        } else {
            self.look.ink(self.paper_dark)
        }
    }
    /// A point in the selected manifest frame's own canonical source grid.
    pub fn frame_point(&self, x: f64, y: f64) -> (f64, f64) {
        let (w, h) = self
            .frame_placement
            .as_ref()
            .map(|p| (p.width as f64, p.height as f64))
            .unwrap_or((self.sprite_bounds.2 as f64, self.sprite_bounds.3 as f64));
        self.frame_grid_point(x, y, w, h)
    }
    /// Shipped companion cuts have their own per-device frame_image grid.
    pub fn frame_grid_point(&self, x: f64, y: f64, width: f64, height: f64) -> (f64, f64) {
        (
            self.sprite_bounds.0 as f64 + x * self.sprite_bounds.2 as f64 / width.max(1.),
            self.sprite_bounds.1 as f64 + y * self.sprite_bounds.3 as f64 / height.max(1.),
        )
    }
    /// Old painted overlay coordinates are registered exactly once; pixel art
    /// keeps its approved 35×32 grid and receives no painted translation.
    pub fn legacy_painted_point(&self, x: f64, y: f64) -> (f64, f64) {
        let offset = self
            .frame_placement
            .as_ref()
            .filter(|p| !p.pixel)
            .map_or(0., |p| p.overlay_offset_x);
        self.frame_point(x + offset, y)
    }
    /// Composite a premultiplied decoration without adding it to the input silhouette.
    pub fn overlay(
        &mut self,
        image: &Image,
        x: f64,
        y: f64,
        scale: f64,
        opacity: f64,
        degrees: f64,
        clip: Option<(f64, f64, f64, f64)>,
    ) {
        self.overlay_axes(image, x, y, scale, scale, opacity, degrees, clip);
    }
    pub fn overlay_axes(
        &mut self,
        image: &Image,
        x: f64,
        y: f64,
        scale_x: f64,
        scale_y: f64,
        opacity: f64,
        degrees: f64,
        clip: Option<(f64, f64, f64, f64)>,
    ) {
        if opacity <= 0. || scale_x <= 0. || scale_y <= 0. {
            return;
        }
        let w = image.width as f64 * scale_x;
        let h = image.height as f64 * scale_y;
        let angle = degrees.to_radians();
        let (c, s) = (angle.cos(), angle.sin());
        let (cx, cy) = (x + w / 2., y + h / 2.);
        let radius = (w * w + h * h).sqrt() / 2.;
        for yy in (cy - radius).floor().max(0.) as u32
            ..(cy + radius).ceil().min(self.height as f64).max(0.) as u32
        {
            for xx in (cx - radius).floor().max(0.) as u32
                ..(cx + radius).ceil().min(self.width as f64).max(0.) as u32
            {
                let (px, py) = (xx as f64 + 0.5, yy as f64 + 0.5);
                if clip.is_some_and(|(a, b, c, d)| px < a || py < b || px >= a + c || py >= b + d) {
                    continue;
                }
                let dx = px - cx;
                let dy = py - cy;
                let sx = (dx * c + dy * s + w / 2.) / scale_x;
                let sy = (-dx * s + dy * c + h / 2.) / scale_y;
                if sx < 0. || sy < 0. || sx >= image.width as f64 || sy >= image.height as f64 {
                    continue;
                }
                let src = (sy.floor() as usize * image.width + sx.floor() as usize) * 4;
                let dst = (yy as usize * self.width as usize + xx as usize) * 4;
                let alpha = image.pixels[src + 3] as f64 / 255. * opacity.clamp(0., 1.);
                for i in 0..4 {
                    self.pixels[dst + i] = (image.pixels[src + i] as f64 * opacity
                        + self.pixels[dst + i] as f64 * (1. - alpha))
                        .round()
                        .clamp(0., 255.) as u8;
                }
            }
        }
    }
    pub fn blank(width: u32, height: u32) -> Self {
        Self {
            width,
            height,
            pixels: vec![0; width as usize * height as usize * 4],
            bubble: None,
            bubble_is_task: false,
            bubble_paper_ink: false,
            bubble_prefix: 0,
            texts: vec![],
            text_styles: vec![],
            text_prefixes: vec![],
            text_sans: vec![],
            text_weights: vec![],
            text_occlusion: None,
            text_middle: vec![],
            paper_dark: false,
            look: crate::contrast::Look::Normal,
            front_pages: None,
            sprite_bounds: (0, 0, 0, 0),
            head_drop: 0.,
            frame_placement: None,
            overscan_bottom: 0,
            hit: vec![0; width as usize * height as usize],
            silhouette_rows: None,
        }
    }
    pub fn save_text_clip(&self, index: usize) -> Option<((u32, u32, u32, u32), Vec<u8>)> {
        let (until, (x, y, w, h)) = self.text_occlusion?;
        if index >= until {
            return None;
        }
        let (x, y) = (x.min(self.width), y.min(self.height));
        let (w, h) = (w.min(self.width - x), h.min(self.height - y));
        let mut pixels = Vec::with_capacity((w * h * 4) as usize);
        for yy in y..y + h {
            let a = ((yy * self.width + x) * 4) as usize;
            pixels.extend_from_slice(&self.pixels[a..a + w as usize * 4]);
        }
        Some(((x, y, w, h), pixels))
    }
    pub fn restore_text_clip(&mut self, saved: Option<((u32, u32, u32, u32), Vec<u8>)>) {
        if let Some(((x, y, w, h), pixels)) = saved {
            for yy in 0..h {
                let a = (((y + yy) * self.width + x) * 4) as usize;
                let src = (yy * w * 4) as usize;
                self.pixels[a..a + w as usize * 4]
                    .copy_from_slice(&pixels[src..src + w as usize * 4]);
            }
        }
    }
    /// Sprite-only alpha extents are captured once during this frame's draw, before paper or decor.
    pub fn sprite_silhouette_edge(&self, top: f64, bottom: f64, left: bool) -> Option<f64> {
        let a = top.floor().max(0.) as usize;
        let b = (bottom.ceil().max(0.) as usize).min(self.height as usize);
        if let Some(rows) = &self.silhouette_rows {
            let it = rows
                .get(a.min(rows.len())..b.max(a.min(rows.len())).min(rows.len()))?
                .iter()
                .flatten();
            if left {
                it.map(|(x, _)| *x).min().map(|x| x as f64)
            } else {
                it.map(|(_, x)| *x).max().map(|x| x as f64)
            }
        } else {
            let (x, y, w, h) = self.sprite_bounds;
            let mut result = None;
            for yy in a.max(y.max(0) as usize)..b.min((y + h as i32).max(0) as usize) {
                for xx in x.max(0)..(x + w as i32).min(self.width as i32) {
                    if self.hit_test(xx, yy as i32) {
                        let edge = if left { xx as f64 } else { xx as f64 + 1. };
                        result = Some(result.map_or(edge, |old: f64| {
                            if left {
                                old.min(edge)
                            } else {
                                old.max(edge)
                            }
                        }));
                    }
                }
            }
            result
        }
    }
    pub fn hit_test(&self, x: i32, y: i32) -> bool {
        x >= 0
            && y >= 0
            && x < self.width as i32
            && y < self.height as i32
            && self.hit[(y as u32 * self.width + x as u32) as usize] != 0
    }
    pub fn input_rect(&mut self, x: i32, y: i32, w: u32, h: u32) {
        for yy in y.max(0) as u32..(y as i64 + h as i64).clamp(0, self.height as i64) as u32 {
            for xx in x.max(0) as u32..(x as i64 + w as i64).clamp(0, self.width as i64) as u32 {
                self.hit[(yy * self.width + xx) as usize] = 255;
            }
        }
    }
    pub fn straight_rgba(&self) -> Vec<u8> {
        let mut bytes = self.pixels.clone();
        for p in bytes.chunks_exact_mut(4) {
            if p[3] > 0 {
                for i in 0..3 {
                    p[i] = ((p[i] as u32 * 255 + p[3] as u32 / 2) / p[3] as u32).min(255) as u8;
                }
            }
        }
        bytes
    }
    pub fn fit_bubble(&mut self, width: f64, height: f64, scale: f64) {
        if self.bubble_is_task {
            return;
        }
        let Some(mut run) = self.bubble.clone() else {
            return;
        };
        let x0 = (run.x - 20. * scale).floor().max(0.) as u32;
        let y0 = (run.y - 14. * scale).floor().max(0.) as u32;
        let x1 = (run.x + run.width + 20. * scale)
            .ceil()
            .min(self.width as f64) as u32;
        let y1 = (run.y + run.height + 18. * scale)
            .ceil()
            .min(self.height as f64) as u32;
        for y in y0..y1 {
            for x in x0..x1 {
                let i = (y * self.width + x) as usize;
                if self.hit[i] == 0 {
                    self.pixels[i * 4..i * 4 + 4].fill(0);
                }
            }
        }
        run.width = width.ceil().clamp(1., 264. * scale);
        run.height = height.ceil().clamp(
            1.,
            (self.sprite_bounds.1 as f64 + self.head_drop - 28. * scale).max(1.),
        );
        run.x = (self.width as f64 - run.width) / 2.;
        run.y = (self.sprite_bounds.1 as f64 + self.head_drop - run.height - 20. * scale)
            .max(8. * scale);
        self.paper(run, scale);
    }
    pub fn task_pill(&mut self, run: TextRun, prefix: usize, scale: f64) {
        let b = crate::ui::Rect {
            x: (run.x - 22. * scale) / scale,
            y: (run.y - 3. * scale) / scale,
            width: (run.width + 32. * scale) / scale,
            height: 22.,
        };
        crate::shapes::cover_shape(self, b, 10., scale);
        // His crest on the cloth is the lighter vermilion (shu-light, 6.4 to 1); a contrast theme keeps its accent.
        let crest = if self.look.is_system() { self.look.accent() } else { [239, 122, 104, 255] };
        crate::shapes::spark_color(self, b.x + 12.5, b.y + 11., scale, crest);
        self.bubble = Some(run);
        self.bubble_is_task = true;
        self.bubble_paper_ink = false;
        self.bubble_prefix = prefix;
    }
    pub fn paper(&mut self, run: TextRun, scale: f64) {
        self.bubble_is_task = false;
        self.bubble_paper_ink = false;
        self.bubble_prefix = 0;
        let (x, y, w, h, r) = (
            run.x - 8. * scale,
            run.y - 4. * scale,
            run.width + 16. * scale,
            run.height + 8. * scale,
            7. * scale,
        );
        crate::ui::paper_shape(
            self,
            crate::ui::Rect {
                x: x / scale,
                y: y / scale,
                width: w / scale,
                height: h / scale,
            },
            r / scale,
            self.look.panel_fill(self.paper_dark),
            scale,
            false,
        );
        self.bubble = Some(run);
    }
}

#[derive(Clone)]
pub struct Image {
    pub width: usize,
    pub height: usize,
    pub pixels: Vec<u8>,
}
impl Image {
    pub fn load(path: &Path) -> Result<Self, Error> {
        Self::decode(BufReader::new(File::open(path)?))
    }
    pub fn from_png(bytes: &[u8]) -> Result<Self, Error> {
        Self::decode(std::io::Cursor::new(bytes))
    }
    fn decode<R: BufRead + Seek>(source: R) -> Result<Self, Error> {
        let mut decoder = png::Decoder::new(source);
        decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
        let mut reader = decoder.read_info()?;
        if reader.info().width > 4096 || reader.info().height > 4096 {
            return Err("frame dimensions exceed limit".into());
        }
        let mut buffer = vec![
            0;
            reader
                .output_buffer_size()
                .ok_or("frame output size exceeds address space")?
        ];
        let info = reader.next_frame(&mut buffer)?;
        let mut pixels = Vec::with_capacity(info.width as usize * info.height as usize * 4);
        match info.color_type {
            png::ColorType::Rgba => pixels.extend_from_slice(&buffer[..info.buffer_size()]),
            png::ColorType::Rgb => {
                for p in buffer[..info.buffer_size()].chunks_exact(3) {
                    pixels.extend_from_slice(&[p[0], p[1], p[2], 255]);
                }
            }
            png::ColorType::GrayscaleAlpha => {
                for p in buffer[..info.buffer_size()].chunks_exact(2) {
                    pixels.extend_from_slice(&[p[0], p[0], p[0], p[1]]);
                }
            }
            png::ColorType::Grayscale => {
                for p in &buffer[..info.buffer_size()] {
                    pixels.extend_from_slice(&[*p, *p, *p, 255]);
                }
            }
            _ => return Err("unsupported frame color type".into()),
        }
        for p in pixels.chunks_exact_mut(4) {
            for i in 0..3 {
                p[i] = ((p[i] as u16 * p[3] as u16 + 127) / 255) as u8;
            }
        }
        Ok(Self {
            width: info.width as usize,
            height: info.height as usize,
            pixels,
        })
    }
    /// Exact source-area coverage on one uniform grid, matching Frames.swift.
    pub fn resample(&self, out_height: usize) -> Self {
        let step = self.height as f64 / out_height as f64;
        let out_width = (self.width as f64 / step - 1e-9).ceil() as usize;
        let mut pixels = vec![0; out_width * out_height * 4];
        for y in 0..out_height {
            for x in 0..out_width {
                let (x0, x1, y0, y1) = (
                    x as f64 * step,
                    (x + 1) as f64 * step,
                    y as f64 * step,
                    (y + 1) as f64 * step,
                );
                let mut sum = [0f64; 4];
                for sy in y0.floor() as usize..(y1.ceil() as usize).min(self.height) {
                    let wy = (y1.min((sy + 1) as f64) - y0.max(sy as f64)) / step;
                    for sx in x0.floor() as usize..(x1.ceil() as usize).min(self.width) {
                        let weight = wy * (x1.min((sx + 1) as f64) - x0.max(sx as f64)) / step;
                        let o = (sy * self.width + sx) * 4;
                        for c in 0..4 {
                            sum[c] += self.pixels[o + c] as f64 * weight;
                        }
                    }
                }
                let o = (y * out_width + x) * 4;
                for c in 0..4 {
                    pixels[o + c] = sum[c].round().clamp(0., 255.) as u8;
                }
            }
        }
        Self {
            width: out_width,
            height: out_height,
            pixels,
        }
    }
    pub fn patch_at(&mut self, patch: &Image, x: usize, y: usize, opacity: f64) {
        for yy in 0..patch.height {
            for xx in 0..patch.width {
                if x + xx >= self.width || y + yy >= self.height {
                    continue;
                }
                let a = (yy * patch.width + xx) * 4;
                let b = ((y + yy) * self.width + x + xx) * 4;
                let alpha = patch.pixels[a + 3] as f64 / 255. * opacity;
                for c in 0..4 {
                    self.pixels[b + c] = (patch.pixels[a + c] as f64 * opacity
                        + self.pixels[b + c] as f64 * (1. - alpha))
                        .round()
                        .clamp(0., 255.) as u8;
                }
            }
        }
    }
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Face {
    #[default]
    Open,
    Half,
    Closed,
    Smile,
    Squeeze,
}
#[derive(Clone, Copy, Debug)]
pub struct Gesture {
    pub dx: f64,
    pub dy: f64,
    pub opacity: f64,
    pub sy: f64,
    pub sx: f64,
    pub skew: f64,
}
impl Default for Gesture {
    fn default() -> Self {
        Self {
            dx: 0.,
            dy: 0.,
            opacity: 1.,
            sy: 1.,
            sx: 1.,
            skew: 0.,
        }
    }
}

/// Idle sprite ink in the cached device image's own coordinates.
#[derive(Clone, Copy, Debug)]
pub struct IdleGeometry {
    pub top: f64,
    pub hair: (f64, f64),
}
impl IdleGeometry {
    pub fn measure(image: &Image, scale: f64) -> Option<Self> {
        let row_left =
            |y: usize| (0..image.width).find(|x| image.pixels[(y * image.width + x) * 4 + 3] > 0);
        let top = (0..image.height).find(|y| row_left(*y).is_some())?;
        let anchor_row = (top + (20. * scale / 2.).floor() as usize).min(image.height - 1);
        let (hair_y, hair_x) = (anchor_row..image.height)
            .find_map(|y| row_left(y).map(|x| (y, x)))
            .or_else(|| row_left(top).map(|x| (top, x)))?;
        Some(Self {
            top: top as f64,
            hair: (hair_x as f64 + 0.5, hair_y as f64 + 0.5),
        })
    }
}

pub struct Frames {
    originals: HashMap<String, Image>,
    scaled: HashMap<String, Image>,
    patches: HashMap<String, (Arc<Image>, usize, usize)>,
    parents: HashMap<String, String>,
    offsets: HashMap<String, Arc<serde_json::Value>>,
    tools: HashSet<String>,
    overlay_offset_x: f64,
    size: Size,
    scale: f64,
    idle_geometry: Option<(Size, f64, IdleGeometry)>,
}
impl Frames {
    pub fn has_frame(&self, name: &str, size: Size) -> bool {
        self.originals.contains_key(&format!(
            "{}/{name}",
            if size.pixel() { "pixel" } else { "desktop" }
        ))
    }
    pub fn load(assets: &Path) -> Result<Self, Error> {
        let mut out = Self {
            originals: HashMap::new(),
            scaled: HashMap::new(),
            patches: HashMap::new(),
            parents: HashMap::new(),
            offsets: HashMap::new(),
            tools: HashSet::new(),
            overlay_offset_x: 0.,
            size: Size::Medium,
            scale: 0.,
            idle_geometry: None,
        };
        for kind in ["desktop", "pixel"] {
            for (index, name) in NAMES.iter().enumerate() {
                let image = Image::load(
                    &assets
                        .join(kind)
                        .join(format!("{:02}-{name}.png", index + 1)),
                )?;
                out.insert_image(format!("{kind}/{name}"), image)?;
            }
        }
        let path = assets.join("frame-manifest.json");
        if path.exists() {
            out.load_manifest(assets, &path, false)?;
        }
        out.load_supplement(assets, assets)?;
        Ok(out)
    }
    /// Development keeps companion-owned cuts separate; release packaging merges
    /// both asset roots. This path never modifies the primary band's manifest.
    pub fn load_with_supplement(assets: &Path, companion_assets: &Path) -> Result<Self, Error> {
        let mut out = Self::load(assets)?;
        if companion_assets != assets {
            out.load_supplement(assets, companion_assets)?;
        }
        Ok(out)
    }
    fn insert_image(&mut self, key: String, image: Image) -> Result<(), Error> {
        let allocated = self
            .originals
            .values()
            .map(|i| i.pixels.len())
            .sum::<usize>()
            - self.originals.get(&key).map_or(0, |i| i.pixels.len())
            + image.pixels.len();
        if allocated > 64 * 1024 * 1024 {
            return Err("frame assets exceed 64 MiB".into());
        }
        self.originals.insert(key, image);
        Ok(())
    }
    fn load_supplement(&mut self, source: &Path, companion: &Path) -> Result<(), Error> {
        let path = companion.join("shed-cuts.json");
        if !path.exists() {
            return Ok(());
        }
        let m = read_manifest(&path)?;
        let donor = m["source"].as_str().ok_or("shed source missing")?;
        let expected = u64::from_str_radix(
            m["source_fnv64"]
                .as_str()
                .ok_or("shed source checksum missing")?,
            16,
        )?;
        let bytes = std::fs::read(asset_path(source, donor)?)?;
        let actual = bytes.iter().fold(0xcbf29ce484222325u64, |a, b| {
            (a ^ *b as u64).wrapping_mul(0x100000001b3)
        });
        // Stale cuts are optional: retain snake, rather than put an old silhouette
        // over a newly installed source frame.
        if actual != expected {
            return Ok(());
        }
        let pixel = &self.originals["pixel/snake"];
        if m["pixel_size"] != serde_json::json!([pixel.width, pixel.height])
            || m["registration"]["frame_overlay_offset_x"].as_f64() != Some(self.overlay_offset_x)
        {
            return Err("shed cut registration differs from source manifest".into());
        }
        self.load_manifest(companion, &path, true)
    }
    fn load_manifest(&mut self, root: &Path, path: &Path, supplement: bool) -> Result<(), Error> {
        let m = read_manifest(path)?;
        let version = m["version"]
            .as_u64()
            .ok_or("frame manifest version missing")?;
        if !(1..=2).contains(&version) {
            return Err("unsupported frame manifest version".into());
        }
        let entries = m["frames"]
            .as_array()
            .ok_or("frame manifest entries missing")?;
        if entries.is_empty() || entries.len() > 256 {
            return Err("frame manifest entry limit".into());
        }
        if !supplement {
            let offset = m["registration"]["frame_overlay_offset_x"]
                .as_f64()
                .unwrap_or(0.);
            if !offset.is_finite() || !(0.0..=4096.).contains(&offset) {
                return Err("invalid frame overlay offset".into());
            }
            self.overlay_offset_x = offset;
        }
        let mut names = HashSet::new();
        for f in entries {
            let name = f["name"]
                .as_str()
                .filter(|s| frame_identity(s))
                .ok_or("invalid frame identity")?;
            if !names.insert(name) {
                return Err("duplicate frame identity".into());
            }
            if supplement && !matches!(name, "shed-a" | "shed-b" | "shed-c") {
                return Err("unexpected companion frame".into());
            }
            if let Some(base) = f["base"].as_str() {
                if !frame_identity(base) {
                    return Err("invalid parent frame".into());
                }
                self.parents.insert(name.into(), base.into());
            }
            self.offsets
                .insert(name.into(), Arc::new(f["offset"].clone()));
            if f["tool"].as_bool() == Some(true) || f["kind"].as_str() == Some("tool") {
                self.tools.insert(name.into());
            }
            let filename = f["filename"].as_str().ok_or("frame filename missing")?;
            for kind in if supplement {
                &(["pixel"][..])
            } else {
                &(["desktop", "pixel"][..])
            } {
                let relative = format!("{kind}/{filename}");
                if !root.join(&relative).exists() {
                    continue;
                }
                let image = Image::load(&asset_path(root, &relative)?)?;
                let dimensions = &m[format!("{kind}_size")];
                if let Some(v) = dimensions.as_array() {
                    if v.len() != 2
                        || v[0].as_u64() != Some(image.width as u64)
                        || v[1].as_u64() != Some(image.height as u64)
                    {
                        return Err("frame canvas differs from manifest".into());
                    }
                }
                self.insert_image(format!("{kind}/{name}"), image)?;
            }
        }
        for start in self.parents.keys() {
            let mut seen = HashSet::new();
            let mut name = start.as_str();
            while let Some(base) = self.parents.get(name) {
                if base == name {
                    break;
                }
                if !seen.insert(name) {
                    return Err("cyclic frame ancestry".into());
                }
                if !self.offsets.contains_key(base) {
                    return Err("unknown parent frame".into());
                }
                name = base;
            }
        }
        if let Some(entries) = m["patches"].as_array() {
            if entries.len() > 256 {
                return Err("frame patch limit".into());
            }
            for entry in entries {
                let base = entry["base"]
                    .as_str()
                    .filter(|s| frame_identity(s))
                    .ok_or("invalid patch base")?;
                let name = entry["name"]
                    .as_str()
                    .filter(|s| frame_identity(s))
                    .ok_or("invalid patch name")?;
                for kind in ["desktop", "pixel"] {
                    let v = &entry[kind];
                    if !v.is_object() {
                        continue;
                    }
                    let filename = v["filename"].as_str().ok_or("patch filename missing")?;
                    let image = Image::load(&asset_path(root, filename)?)?;
                    let (x, y) = (
                        v["x"].as_u64().ok_or("invalid patch x")? as usize,
                        v["y"].as_u64().ok_or("invalid patch y")? as usize,
                    );
                    let original = self
                        .originals
                        .get(&format!("{kind}/{base}"))
                        .ok_or("patch base missing")?;
                    if v["width"].as_u64() != Some(image.width as u64)
                        || v["height"].as_u64() != Some(image.height as u64)
                        || x.checked_add(image.width)
                            .is_none_or(|right| right > original.width)
                        || y.checked_add(image.height)
                            .is_none_or(|bottom| bottom > original.height)
                    {
                        return Err("patch outside registered frame".into());
                    }
                    let allocated = self
                        .originals
                        .values()
                        .map(|i| i.pixels.len())
                        .sum::<usize>()
                        + self
                            .patches
                            .values()
                            .map(|(i, _, _)| i.pixels.len())
                            .sum::<usize>()
                        + 2 * image.pixels.len();
                    if allocated > 64 * 1024 * 1024 {
                        return Err("frame and patch assets exceed 64 MiB".into());
                    }
                    let image = Arc::new(image);
                    if let Some(face) = entry["face"].as_str() {
                        if !frame_identity(face) {
                            return Err("invalid patch face".into());
                        }
                        self.patches
                            .entry(format!("{kind}/{base}/{face}"))
                            .or_insert_with(|| (image.clone(), x, y));
                    }
                    self.patches
                        .insert(format!("{kind}/{base}/{name}"), (image, x, y));
                }
            }
        }
        Ok(())
    }
    fn resolve_name(&self, name: &str, size: Size) -> String {
        let kind = if size.pixel() { "pixel" } else { "desktop" };
        let mut current = name;
        let mut seen = HashSet::new();
        while seen.insert(current) {
            if self.originals.contains_key(&format!("{kind}/{current}")) {
                return current.into();
            }
            let Some(parent) = self.parents.get(current) else {
                break;
            };
            current = parent;
        }
        if size.pixel() && matches!(name, "shed-a" | "shed-b" | "shed-c") {
            "snake".into()
        } else {
            "idle-reading".into()
        }
    }
    pub fn placement(&self, name: &str, size: Size) -> Option<FramePlacement> {
        let name = self.resolve_name(name, size);
        let image = self.originals.get(&format!(
            "{}/{name}",
            if size.pixel() { "pixel" } else { "desktop" }
        ))?;
        Some(FramePlacement {
            parent: self.parents.get(&name).cloned(),
            source_offset: self.offsets.get(&name).cloned().unwrap_or_default(),
            width: image.width,
            height: image.height,
            pixel: size.pixel(),
            overlay_offset_x: self.overlay_offset_x,
            name,
        })
    }
    pub fn patch_parent(&self, name: &str, face: &str, size: Size) -> Option<String> {
        let kind = if size.pixel() { "pixel" } else { "desktop" };
        let face = if face == "half-lid" { "half" } else { face };
        let resolved = self.resolve_name(name, size);
        let mut current = resolved.as_str();
        let mut seen = HashSet::new();
        let original = self.originals.get(&format!("{kind}/{current}"))?;
        while seen.insert(current) {
            if let Some((patch, x, y)) = self.patches.get(&format!("{kind}/{current}/{face}")) {
                if x + patch.width <= original.width && y + patch.height <= original.height {
                    return Some(current.into());
                }
            }
            if self.tools.contains(&resolved) {
                break;
            }
            let Some(base) = self.parents.get(current) else {
                break;
            };
            current = base;
        }
        None
    }
    fn patch(&self, name: &str, face: &str, size: Size) -> Option<&(Arc<Image>, usize, usize)> {
        let parent = self.patch_parent(name, face, size)?;
        let face = if face == "half-lid" { "half" } else { face };
        self.patches.get(&format!(
            "{}/{parent}/{face}",
            if size.pixel() { "pixel" } else { "desktop" }
        ))
    }
    pub fn dimensions(&self, size: Size, scale: f64) -> (usize, usize) {
        let kind = if size.pixel() { "pixel" } else { "desktop" };
        let source = &self.originals[&format!("{kind}/idle-reading")];
        let h = self.height(size, scale);
        (
            (source.width as f64 * h as f64 / source.height as f64 - 1e-9).ceil() as usize,
            h,
        )
    }
    /// Measure the shipped idle pixels once per size and display scale. The
    /// badge's centre sits on the upper hair, half its existing 20 pt height
    /// below the first ink row; source placement has already been applied.
    pub fn idle_geometry(&mut self, size: Size, scale: f64) -> Option<IdleGeometry> {
        if let Some((cached_size, cached_scale, geometry)) = self.idle_geometry {
            if cached_size == size && cached_scale == scale {
                return Some(geometry);
            }
        }
        let image = self.image("idle-reading", Face::Open, size, scale);
        let geometry = IdleGeometry::measure(image, scale)?;
        self.idle_geometry = Some((size, scale, geometry));
        Some(geometry)
    }
    fn height(&self, size: Size, scale: f64) -> usize {
        (size.height() * scale).round().max(1.) as usize
    }
    fn image(&mut self, name: &str, face: Face, size: Size, scale: f64) -> &Image {
        if self.size != size || self.scale != scale {
            self.scaled.clear();
            self.size = size;
            self.scale = scale;
        }
        let kind = if size.pixel() { "pixel" } else { "desktop" };
        let name = self.resolve_name(name, size);
        let key = format!("{name}/{face:?}");
        if !self.scaled.contains_key(&key) {
            let source = self
                .originals
                .get(&format!("{kind}/{name}"))
                .unwrap_or(&self.originals[&format!("{kind}/idle-reading")]);
            let mut source = source.clone();
            let face_key = match face {
                Face::Half => "half",
                Face::Closed => "blink",
                Face::Smile => "smile",
                Face::Squeeze => "squeeze",
                Face::Open => "open",
            };
            if face != Face::Open {
                if let Some((patch, x, y)) = self.patch(&name, face_key, size) {
                    source.patch_at(patch, *x, *y, 1.);
                }
            }
            self.scaled
                .insert(key.clone(), source.resample(self.height(size, scale)));
        }
        &self.scaled[&key]
    }
    pub fn draw_layers(
        &mut self,
        canvas: &mut Canvas,
        name: &str,
        size: Size,
        scale: f64,
        gesture: Gesture,
        layers: &[(&str, f64)],
    ) {
        canvas.frame_placement = self.placement(name, size);
        let kind = if size.pixel() { "pixel" } else { "desktop" };
        let name = self.resolve_name(name, size);
        let Some(base) = self.originals.get(&format!("{kind}/{name}")) else {
            self.draw(canvas, &name, Face::Open, size, scale, gesture);
            return;
        };
        let mut image = base.clone();
        for (face, opacity) in layers {
            if let Some((patch, x, y)) = self.patch(&name, face, size) {
                image.patch_at(patch, *x, *y, *opacity);
            }
        }
        let scaled = image.resample(self.height(size, scale));
        Self::draw_image(canvas, &scaled, scale, gesture, !size.pixel());
    }
    pub fn draw(
        &mut self,
        canvas: &mut Canvas,
        name: &str,
        face: Face,
        size: Size,
        scale: f64,
        gesture: Gesture,
    ) {
        canvas.frame_placement = self.placement(name, size);
        let image = self.image(name, face, size, scale);
        Self::draw_image(canvas, image, scale, gesture, !size.pixel());
    }
    /// A short swap between aligned premultiplied layers. Pose anchors remain at the bottom.
    #[allow(clippy::too_many_arguments)]
    pub fn draw_transition(
        &mut self,
        canvas: &mut Canvas,
        name: &str,
        face: Face,
        size: Size,
        scale: f64,
        gesture: Gesture,
        from_name: &str,
        from_face: Face,
        progress: f64,
    ) {
        if progress >= 1. {
            self.draw(canvas, name, face, size, scale, gesture);
            return;
        }
        if progress <= 0. {
            self.draw(canvas, from_name, from_face, size, scale, gesture);
            return;
        }
        canvas.frame_placement = self.placement(name, size);
        let from = self.image(from_name, from_face, size, scale).clone();
        let to = self.image(name, face, size, scale);
        let mixed = Self::mix(&from, to, progress);
        Self::draw_image(canvas, &mixed, scale, gesture, !size.pixel());
    }
    fn mix(from: &Image, to: &Image, progress: f64) -> Image {
        let (width, height) = (from.width.max(to.width), from.height.max(to.height));
        let mut pixels = vec![0u8; width * height * 4];
        let progress = progress.clamp(0., 1.);
        for y in 0..height {
            for x in 0..width {
                for (image, weight) in [(from, 1. - progress), (to, progress)] {
                    let xx = x as isize - (width as isize - image.width as isize) / 2;
                    let yy = y as isize - (height as isize - image.height as isize);
                    if xx < 0 || yy < 0 || xx >= image.width as isize || yy >= image.height as isize
                    {
                        continue;
                    }
                    let src = (yy as usize * image.width + xx as usize) * 4;
                    let out = (y * width + x) * 4;
                    for c in 0..4 {
                        pixels[out + c] = pixels[out + c]
                            .saturating_add((image.pixels[src + c] as f64 * weight).round() as u8);
                    }
                }
            }
        }
        Image {
            width,
            height,
            pixels,
        }
    }
    pub(crate) fn draw_image(
        canvas: &mut Canvas,
        image: &Image,
        scale: f64,
        gesture: Gesture,
        painted: bool,
    ) {
        let (w, h) = (image.width as f64, image.height as f64);
        let cx = canvas.width as f64 / 2. + gesture.dx;
        let bottom =
            canvas.height as f64 - 12. * scale - canvas.overscan_bottom as f64 + gesture.dy;
        let sy = gesture.sy.clamp(0.7, 1.1);
        let sx = gesture.sx.clamp(0.85, 1.15);
        let skew = gesture.skew;
        let left = (cx - w * sx / 2. - h * skew.abs() - 4. * scale)
            .floor()
            .max(0.) as usize;
        let right = (cx + w * sx / 2. + h * skew.abs() + 4. * scale)
            .ceil()
            .min(canvas.width as f64) as usize;
        let top = (bottom - h * sy).floor().max(0.) as usize;
        canvas.sprite_bounds = (
            (canvas.width as f64 / 2. - w / 2.).floor() as i32,
            (canvas.height as f64 - 12. * scale - canvas.overscan_bottom as f64 - h).floor() as i32,
            w as u32,
            h as u32,
        );
        for y in top..bottom.ceil().min(canvas.height as f64) as usize {
            let yy = (y as f64 + 0.5 - bottom) / sy + h;
            if !(0.0..h).contains(&yy) {
                continue;
            }
            for x in left..right {
                let xx = (x as f64 + 0.5 - cx - (y as f64 + 0.5 - bottom) * skew) / sx + w / 2.;
                if !(0.0..w).contains(&xx) {
                    continue;
                }
                let src = (yy.floor() as usize * image.width + xx.floor() as usize) * 4;
                let dest = (y * canvas.width as usize + x) * 4;
                if painted && (gesture.sx != 1. || gesture.sy != 1. || gesture.skew != 0.) {
                    let (fx, fy) = (xx - 0.5, yy - 0.5);
                    let (ix, iy) = (fx.floor() as isize, fy.floor() as isize);
                    let (wx, wy) = (fx - ix as f64, fy - iy as f64);
                    let mut pixel = [0f64; 4];
                    for (dx, dy, weight) in [
                        (0, 0, (1. - wx) * (1. - wy)),
                        (1, 0, wx * (1. - wy)),
                        (0, 1, (1. - wx) * wy),
                        (1, 1, wx * wy),
                    ] {
                        let (sx, sy) = (ix + dx, iy + dy);
                        if sx < 0
                            || sy < 0
                            || sx >= image.width as isize
                            || sy >= image.height as isize
                        {
                            continue;
                        }
                        let at = (sy as usize * image.width + sx as usize) * 4;
                        for c in 0..4 {
                            pixel[c] += image.pixels[at + c] as f64 * weight;
                        }
                    }
                    for c in 0..4 {
                        canvas.pixels[dest + c] = pixel[c].round().clamp(0., 255.) as u8;
                    }
                } else {
                    canvas.pixels[dest..dest + 4].copy_from_slice(&image.pixels[src..src + 4]);
                }
                if gesture.opacity < 1. {
                    for c in 0..4 {
                        canvas.pixels[dest + c] = (canvas.pixels[dest + c] as f64
                            * gesture.opacity.max(0.))
                        .round() as u8;
                    }
                }
                canvas.hit[y * canvas.width as usize + x] = image.pixels[src + 3];
            }
        }
        let mut rows = vec![None; canvas.height as usize];
        for y in top..bottom.ceil().min(canvas.height as f64) as usize {
            for x in left..right {
                if canvas.pixels[(y * canvas.width as usize + x) * 4 + 3] > 0 {
                    rows[y] = Some(
                        rows[y].map_or((x as u32, x as u32 + 1), |(a, b): (u32, u32)| {
                            (a.min(x as u32), b.max(x as u32 + 1))
                        }),
                    );
                }
            }
        }
        canvas.silhouette_rows = Some(rows);
        // Transform overscan is visual only; the click silhouette stays at rest.
        canvas.hit.fill(0);
        let (rest_x, rest_y, _, _) = canvas.sprite_bounds;
        for yy in 0..image.height {
            for xx in 0..image.width {
                let (x, y) = (rest_x + xx as i32, rest_y + yy as i32);
                if x >= 0 && y >= 0 && x < canvas.width as i32 && y < canvas.height as i32 {
                    canvas.hit[y as usize * canvas.width as usize + x as usize] =
                        image.pixels[(yy * image.width + xx) * 4 + 3];
                }
            }
        }
    }
}

fn read_manifest(path: &Path) -> Result<serde_json::Value, Error> {
    if std::fs::metadata(path)?.len() > 2 * 1024 * 1024 {
        return Err("frame manifest exceeds 2 MiB".into());
    }
    let bytes = std::fs::read(path)?;
    if bytes.len() > 2 * 1024 * 1024 {
        return Err("frame manifest exceeds 2 MiB".into());
    }
    Ok(serde_json::from_slice(&bytes)?)
}
fn frame_identity(name: &str) -> bool {
    !name.is_empty()
        && name.len() < 128
        && !name.chars().any(|c| c.is_control() || ":/@\\".contains(c))
}
fn asset_path(root: &Path, relative: &str) -> Result<PathBuf, Error> {
    let path = Path::new(relative);
    if relative.is_empty()
        || relative.len() >= 256
        || relative.contains('\\')
        || relative.contains('\0')
        || path
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err("invalid frame asset path".into());
    }
    let canonical = root.join(path).canonicalize()?;
    if !canonical.starts_with(root.canonicalize()?) {
        return Err("frame asset escapes owned root".into());
    }
    Ok(canonical)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unknown_feed_frames_share_one_cache_entry() {
        let mut frames = Frames {
            originals: HashMap::from([(
                "desktop/idle-reading".into(),
                Image {
                    width: 1,
                    height: 1,
                    pixels: vec![255, 255, 255, 255],
                },
            )]),
            scaled: HashMap::new(),
            patches: HashMap::new(),
            parents: HashMap::new(),
            offsets: HashMap::new(),
            tools: HashSet::new(),
            overlay_offset_x: 0.,
            size: Size::Medium,
            scale: 0.,
            idle_geometry: None,
        };
        for i in 0..100 {
            let image = frames.image(&format!("unknown-{i}"), Face::Open, Size::Medium, 1.);
            assert_eq!(image.height, 128);
        }
        assert_eq!(frames.scaled.len(), 1);
    }
    #[test]
    fn coverage_preserves_premultiplied_edges() {
        let i = Image {
            width: 2,
            height: 1,
            pixels: vec![255, 0, 0, 255, 0, 0, 0, 0],
        };
        let o = i.resample(2);
        assert_eq!(o.width, 4);
        assert_eq!(&o.pixels[..4], &[255, 0, 0, 255]);
        assert_eq!(&o.pixels[8..12], &[0, 0, 0, 0]);
    }
    #[test]
    fn premultiplied_swap_and_bottom_anchor() {
        let a = Image {
            width: 1,
            height: 1,
            pixels: vec![120, 0, 0, 120],
        };
        let b = Image {
            width: 1,
            height: 2,
            pixels: vec![0, 80, 0, 80, 0, 0, 200, 200],
        };
        let c = Frames::mix(&a, &b, 0.5);
        assert_eq!(c.pixels, vec![0, 40, 0, 40, 60, 0, 100, 160]);
        for p in c.pixels.chunks_exact(4) {
            assert!(p[..3].iter().all(|v| *v <= p[3]));
        }
    }
    #[test]
    fn size_and_alpha_hit() {
        assert_eq!(Size::Medium.height(), 128.);
        assert_eq!(Size::Large.height(), 186.);
        assert_eq!(Size::Larger.height(), 256.);
        assert_eq!(Size::parse("tiny"), Some(Size::Medium));
        assert_eq!(Size::parse("small"), Some(Size::Medium));
        assert_eq!(Size::default(), Size::Large);
        let c = Canvas::blank(5, 5);
        assert!(!c.hit_test(-1, 0));
        assert!(!c.hit_test(2, 2));
    }
}
