//! Coco on the desktop companion: their clips (assets/coco/band-A.json and band-B.json, pictures 256 px
//! tall) played into a pixmap. Which action to play, how it is joined to the drawing before it and how
//! tracks are sampled follow plugin/hooks-source/coco-motion.ts; the composition order of one element
//! (final clip, opacity and translate, local clip, rotate, scale, image) follows its svgOf().
use crate::{
    decor::CompactPhase,
    render::{IdleGeometry, Image},
    Error,
};
use serde::Deserialize;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
};
use tiny_skia::{
    FillRule, FilterQuality, IntSize, Mask, PathBuilder, Pixmap, PixmapPaint, Rect, Transform,
};

pub type Key = &'static str;
pub const ACTIONS: [Key; 33] = [
    "idle", "wait", "think", "watch", "petted", "hood", "hello", "peek", "doze", "night", "pack",
    "serious", "shell", "work", "done", "search", "read", "lookup", "plan", "run", "coffee",
    "helper", "praised", "pass", "firsttry", "out", "error", "wild", "fixed", "teapot", "breath",
    "nap", "catch",
];
/// The companion's frame rate while an action or a loop moves.
pub const FRAME_MS: u64 = 33;
/// A blink cycle is one minute; the same for every drawing, so a blink shows only on the frame that is drawn.
const BLINK_CYCLE: f64 = 61.;
/// Open clip edges are written as +-1e4; a smaller number does the same on any canvas.
const OPEN_EDGE: f64 = 2000.;
const SINK_CUT: Entry = Entry {
    kind: EntryKind::Sink,
    depth: 0.045,
    h: 8.,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Outfit {
    A,
    B,
}
impl Outfit {
    pub fn other(self) -> Self {
        match self {
            Self::A => Self::B,
            Self::B => Self::A,
        }
    }
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "A" => Some(Self::A),
            "B" => Some(Self::B),
            _ => None,
        }
    }
    fn index(self) -> usize {
        self as usize
    }
}

// ---------------------------------------------------------------- which action

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Touch {
    Poke,
    Pat,
    Burst,
    Wink,
}
#[derive(Clone, Copy, Debug, Default)]
pub struct Input<'a> {
    pub mood: &'a str,
    pub pose: Option<&'a str>,
    pub touch: Option<Touch>,
    pub shed: Option<CompactPhase>,
    pub act: Option<Key>,
    pub night: bool,
    pub working: bool,
}
fn pose_action(pose: &str) -> Option<Key> {
    Some(match pose {
        "search" => "search",
        "scroll" => "read",
        "spyglass" => "lookup",
        "plan" => "plan",
        "run" => "run",
        "helper" => "helper",
        "tea" => "coffee",
        "cheer" => "fixed",
        "waiting" => "wait",
        "look-up" => "watch",
        _ => return None,
    })
}
fn mood_action(mood: &str) -> Option<Key> {
    Some(match mood {
        "idle" => "idle",
        "think" => "think",
        "work" => "work",
        "happy" => "done",
        "waiting" | "question" => "wait",
        "error" => "error",
        "wild" => "wild",
        "refuse" => "teapot",
        "flustered" => "praised",
        "wave" => "hello",
        "snake" | "peek" => "peek",
        "omen" => "run",
        _ => return None,
    })
}
/// A touch first, then an explicit moment, the shell change, a tool pose, then the mood.
pub fn action(input: &Input) -> Key {
    if input.touch == Some(Touch::Burst) {
        return "hood";
    }
    if input.touch.is_some() {
        return "petted";
    }
    if let Some(act) = input.act {
        return act;
    }
    match input.shed {
        Some(CompactPhase::Begin) => return "pack",
        Some(CompactPhase::End) => return "shell",
        _ => {}
    }
    if let Some(pose) = input.pose.and_then(pose_action) {
        return pose;
    }
    if input.mood == "sleep" {
        return if input.night { "night" } else { "nap" };
    }
    mood_action(input.mood).unwrap_or(if input.working { "think" } else { "idle" })
}
/// What Coco settles into after an action played once.
pub fn base(input: &Input) -> Key {
    if input.mood == "sleep" {
        return if input.night { "night" } else { "nap" };
    }
    if matches!(input.mood, "waiting" | "question") {
        return "wait";
    }
    if input.working {
        return if input.mood == "work" {
            "work"
        } else {
            "think"
        };
    }
    "idle"
}
/// Late evening and the small hours, while Coco is not working: the lamp is on.
pub fn is_night(hour: Option<u32>, mood: &str, working: bool) -> bool {
    hour.is_some_and(|h| !(5..23).contains(&h)) && !working && matches!(mood, "idle" | "sleep")
}
/// The wall clock's hour where the person is, if the system says.
#[cfg(unix)]
pub fn local_hour(epoch_ms: u64) -> Option<u32> {
    unsafe {
        let seconds = (epoch_ms / 1000) as libc::time_t;
        let mut parts: libc::tm = std::mem::zeroed();
        if libc::localtime_r(&seconds, &mut parts).is_null() {
            return None;
        }
        Some(parts.tm_hour as u32)
    }
}
/// The engine's clock is the wall clock; GetLocalTime reads the same one in local time.
#[cfg(windows)]
pub fn local_hour(_epoch_ms: u64) -> Option<u32> {
    Some(unsafe { windows::Win32::System::SystemInformation::GetLocalTime() }.wHour as u32)
}
#[cfg(not(any(unix, windows)))]
pub fn local_hour(_epoch_ms: u64) -> Option<u32> {
    None
}

/// What the state wants Coco to play: the outfit whose data holds the action (the shell change plays in
/// the outfit they are leaving), the action, what it settles into, and the clock of a one-off moment.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Wanted {
    pub outfit: Outfit,
    pub action: Key,
    pub base: Key,
    pub act: Option<u64>,
}
/// `outfit` is the one Coco wears now; `act_at` is when the moment in `input.act` happened.
pub fn wanted(input: &Input, outfit: Outfit, act_at: Option<u64>) -> Wanted {
    let action = action(input);
    let playing = if action == "shell" {
        outfit.other()
    } else {
        outfit
    };
    Wanted {
        outfit: playing,
        action,
        base: base(input),
        act: act_at.filter(|_| input.act == Some(action)),
    }
}

// ---------------------------------------------------------------- data

/// [[t s, value...], ...], linear in between; a single key is constant.
#[derive(Clone, Debug, Deserialize)]
#[serde(try_from = "Vec<Vec<f64>>")]
struct Track {
    keys: Vec<[f64; 3]>,
    width: usize,
}
impl TryFrom<Vec<Vec<f64>>> for Track {
    type Error = &'static str;
    fn try_from(rows: Vec<Vec<f64>>) -> Result<Self, Self::Error> {
        let width = rows
            .first()
            .map(|row| row.len().saturating_sub(1))
            .filter(|n| (1..=2).contains(n))
            .ok_or("track keys need a time and one or two values")?;
        let mut keys = Vec::with_capacity(rows.len());
        for row in rows {
            if row.len() != width + 1 || row.iter().any(|v| !v.is_finite()) {
                return Err("track keys differ in width");
            }
            keys.push([row[0], row[1], row.get(2).copied().unwrap_or(0.)]);
        }
        if keys.windows(2).any(|pair| pair[1][0] < pair[0][0]) {
            return Err("track keys run backwards");
        }
        Ok(Self { keys, width })
    }
}
impl Track {
    fn still(values: &[f64]) -> Self {
        Self {
            keys: vec![[0., values[0], values.get(1).copied().unwrap_or(0.)]],
            width: values.len(),
        }
    }
    fn first(&self) -> [f64; 2] {
        [self.keys[0][1], self.keys[0][2]]
    }
    /// The value at t seconds: held before the first key and after the last.
    fn sample(&self, t: f64) -> [f64; 2] {
        let keys = &self.keys;
        if keys.len() == 1 || t <= keys[0][0] {
            return self.first();
        }
        for i in 1..keys.len() {
            let b = keys[i];
            if t <= b[0] {
                let a = keys[i - 1];
                let u = (t - a[0]) / (b[0] - a[0]).max(1e-9);
                return [a[1] + u * (b[1] - a[1]), a[2] + u * (b[2] - a[2])];
            }
        }
        let last = keys[keys.len() - 1];
        [last[1], last[2]]
    }
}

#[derive(Clone, Debug, Deserialize)]
struct Element {
    src: String,
    origin: [f64; 2],
    clip_local: Option<[f64; 4]>,
    clip_final: Option<[f64; 4]>,
    a: Track,
    t: Track,
    r: Track,
    s: Track,
}
#[derive(Clone, Debug, Deserialize)]
struct Part {
    seconds: f64,
    elements: Vec<Element>,
}
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum EntryKind {
    Sink,
    Hop,
    Cut,
}
#[derive(Clone, Copy, Debug, Deserialize)]
struct Entry {
    kind: EntryKind,
    depth: f64,
    h: f64,
}
#[derive(Deserialize)]
struct RawAction {
    entry: Entry,
    body: Part,
    #[serde(rename = "loop")]
    looped: Option<Part>,
}
#[derive(Deserialize)]
struct RawEyes {
    #[serde(rename = "box")]
    area: [f64; 4],
    half: String,
    closed: String,
}
#[derive(Deserialize)]
struct RawPatch {
    #[serde(rename = "box")]
    area: [f64; 4],
    img: String,
}
/// assets/coco/socks-<outfit>-<pair>.json: for each picture, the pixels a pair from their sock drawer changes.
#[derive(Deserialize)]
struct RawSocks {
    outfit: String,
    pair: String,
    socks: HashMap<String, RawPatch>,
}
#[derive(Deserialize)]
struct RawBand {
    outfit: String,
    canvas: [f64; 2],
    sink: f64,
    hop: [f64; 2],
    actions: HashMap<String, RawAction>,
    images: HashMap<String, String>,
    #[serde(default)]
    eyes: HashMap<String, RawEyes>,
}
struct Action {
    entry: Entry,
    body: Arc<Part>,
    looped: Option<Arc<Part>>,
}
struct Band {
    canvas: [f64; 2],
    sink: f64,
    hop: [f64; 2],
    actions: HashMap<String, Action>,
}

fn base64(text: &str) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(text.len() / 4 * 3);
    let (mut bits, mut count) = (0u32, 0);
    for c in text.bytes() {
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' => break,
            b'\n' | b'\r' | b' ' => continue,
            _ => return None,
        };
        bits = bits << 6 | v as u32;
        count += 6;
        if count >= 8 {
            count -= 8;
            out.push((bits >> count) as u8);
            bits &= (1 << count) - 1;
        }
    }
    Some(out)
}

/// The PNG bytes behind a picture's text: `@offset:length` into the file's sidecar (X.bin beside X.json, written by
/// tools/art/coco-band-build.py: a quarter smaller than base64), or base64 in data written before it.
fn picture(text: &str, sidecar: &[u8]) -> Option<Vec<u8>> {
    let Some(at) = text.strip_prefix('@') else {
        return base64(text);
    };
    let (offset, length) = at.split_once(':')?;
    let (offset, length): (usize, usize) = (offset.parse().ok()?, length.parse().ok()?);
    sidecar.get(offset..offset.checked_add(length)?).map(<[u8]>::to_vec)
}
/// The sidecar of a band or sock file, empty when there is none.
fn sidecar(json: &Path) -> Result<Vec<u8>, Error> {
    let path = json.with_extension("bin");
    match std::fs::metadata(&path) {
        Ok(meta) if meta.len() > 16 * 1024 * 1024 => Err("coco pictures exceed 16 MiB".into()),
        Ok(_) => Ok(std::fs::read(&path)?),
        Err(_) => Ok(Vec::new()),
    }
}

fn check_part(part: &Part, images: &HashMap<String, String>) -> Result<(), Error> {
    if !(part.seconds.is_finite() && part.seconds > 0.) {
        return Err("coco part without a length".into());
    }
    for e in &part.elements {
        if !images.contains_key(&e.src) {
            return Err(format!("coco data lacks {}", e.src).into());
        }
        if [e.a.width, e.r.width, e.t.width, e.s.width] != [1, 1, 2, 2] {
            return Err("coco track of the wrong width".into());
        }
    }
    Ok(())
}
fn read_band(path: &Path, outfit: Outfit, bank: &mut Bank) -> Result<Band, Error> {
    if std::fs::metadata(path)?.len() > 16 * 1024 * 1024 {
        return Err("coco data exceeds 16 MiB".into());
    }
    let raw: RawBand = serde_json::from_slice(&std::fs::read(path)?)?;
    if Outfit::parse(&raw.outfit) != Some(outfit) {
        return Err("coco data is for the other outfit".into());
    }
    let pictures = sidecar(path)?;
    let finite = |values: &[f64]| values.iter().all(|v| v.is_finite() && *v > 0.);
    if !finite(&raw.canvas) || !raw.sink.is_finite() || !raw.hop.iter().all(|v| v.is_finite()) {
        return Err("invalid coco canvas".into());
    }
    let mut actions = HashMap::new();
    for key in ACTIONS {
        let action = raw
            .actions
            .get(key)
            .ok_or_else(|| format!("coco data lacks {key}"))?;
        check_part(&action.body, &raw.images)?;
        if let Some(part) = &action.looped {
            check_part(part, &raw.images)?;
        }
    }
    for (key, action) in raw.actions {
        actions.insert(
            key,
            Action {
                entry: action.entry,
                body: Arc::new(action.body),
                looped: action.looped.map(Arc::new),
            },
        );
    }
    for (src, text) in raw.images {
        let png = picture(&text, &pictures).ok_or("coco picture is unreadable")?;
        bank.slots.entry(src).or_insert_with(|| Slot::new(png));
    }
    for (src, eyes) in raw.eyes {
        let (half, closed) = (picture(&eyes.half, &pictures), picture(&eyes.closed, &pictures));
        if let (Some(half), Some(closed)) = (half, closed) {
            bank.slots
                .entry(format!("{src}#half"))
                .or_insert_with(|| Slot::new(half));
            bank.slots
                .entry(format!("{src}#closed"))
                .or_insert_with(|| Slot::new(closed));
            bank.eyes.entry(src).or_insert(eyes.area);
        }
    }
    Ok(Band {
        canvas: raw.canvas,
        sink: raw.sink,
        hop: raw.hop,
        actions,
    })
}

// ---------------------------------------------------------------- pictures

/// A picture trimmed to the rows and columns that hold ink (and a margin of clear pixels), placed at
/// (x, y) of the whole picture, which is `width` by `height`. Most of a picture is clear, and an
/// element draws the whole of it.
struct Trimmed {
    pixmap: Pixmap,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}
impl Trimmed {
    fn of(image: &Image) -> Option<Self> {
        const MARGIN: usize = 2;
        let (w, h) = (image.width, image.height);
        let ink = |x: usize, y: usize| image.pixels[(y * w + x) * 4 + 3] != 0;
        let rows: Vec<usize> = (0..h).filter(|y| (0..w).any(|x| ink(x, *y))).collect();
        let (top, bottom) = (
            *rows.first().unwrap_or(&0),
            rows.last().map_or(0, |y| y + 1),
        );
        let mut cols = (0..w).filter(|x| (top..bottom).any(|y| ink(*x, y)));
        let left = cols.clone().next().unwrap_or(0);
        let right = cols.next_back().map_or(0, |x| x + 1);
        // a picture with no ink is one clear pixel
        let (x0, y0, x1, y1) = if right > left && bottom > top {
            (
                left.saturating_sub(MARGIN),
                top.saturating_sub(MARGIN),
                (right + MARGIN).min(w),
                (bottom + MARGIN).min(h),
            )
        } else {
            (0, 0, 1, 1)
        };
        let mut pixels = Vec::with_capacity((x1 - x0) * (y1 - y0) * 4);
        for y in y0..y1 {
            pixels.extend_from_slice(&image.pixels[(y * w + x0) * 4..(y * w + x1) * 4]);
        }
        Some(Self {
            pixmap: Pixmap::from_vec(
                pixels,
                IntSize::from_wh((x1 - x0) as u32, (y1 - y0) as u32)?,
            )?,
            x: x0 as i32,
            y: y0 as i32,
            width: w as u32,
            height: h as u32,
        })
    }
}
/// One picture of the files: decoded when first drawn, and once more at the size it is drawn at when
/// that is clearly smaller than the picture (exact area coverage, as the painted frames are).
struct Slot {
    png: Vec<u8>,
    original: Option<Option<Trimmed>>,
    scaled: Option<(usize, Trimmed)>,
}
impl Slot {
    fn new(png: Vec<u8>) -> Self {
        Self {
            png,
            original: None,
            scaled: None,
        }
    }
    fn ensure(&mut self, height: usize) {
        let png = &self.png;
        let original = self.original.get_or_insert_with(|| {
            Image::from_png(png)
                .ok()
                .and_then(|image| Trimmed::of(&image))
        });
        let Some(original) = original else { return };
        let height = height.max(1);
        if (height as f64) < original.height as f64 * 0.95
            && self.scaled.as_ref().is_none_or(|(h, _)| *h != height)
        {
            self.scaled = Image::from_png(png)
                .ok()
                .and_then(|image| Trimmed::of(&image.resample(height)))
                .map(|trimmed| (height, trimmed));
        }
    }
    fn picture(&self, height: usize) -> Option<&Trimmed> {
        match &self.scaled {
            Some((h, trimmed)) if *h == height.max(1) => Some(trimmed),
            _ => self.original.as_ref()?.as_ref(),
        }
    }
}
#[derive(Default)]
struct Bank {
    slots: HashMap<String, Slot>,
    eyes: HashMap<String, [f64; 4]>,
    /// where each picture's patch for the worn pair of socks sits (its pixels are the `<src>#socks` slot)
    socks: HashMap<String, [f64; 4]>,
    height: usize,
}
impl Bank {
    /// The size Coco is drawn at changed: the pictures made for the old one go.
    fn drawn_at(&mut self, height: usize) {
        if self.height != height {
            self.height = height;
            for slot in self.slots.values_mut() {
                slot.scaled = None;
            }
        }
    }
}

#[derive(Clone, Copy)]
struct Affine {
    a: f64,
    b: f64,
    c: f64,
    d: f64,
    e: f64,
    f: f64,
}
impl Affine {
    const IDENTITY: Self = Self::scale(1., 1.);
    const fn scale(x: f64, y: f64) -> Self {
        Self {
            a: x,
            b: 0.,
            c: 0.,
            d: y,
            e: 0.,
            f: 0.,
        }
    }
    const fn translate(x: f64, y: f64) -> Self {
        Self {
            e: x,
            f: y,
            ..Self::IDENTITY
        }
    }
    fn rotate(degrees: f64) -> Self {
        let (sin, cos) = degrees.to_radians().sin_cos();
        Self {
            a: cos,
            b: sin,
            c: -sin,
            d: cos,
            e: 0.,
            f: 0.,
        }
    }
    /// This, with `inner` applied to a point first.
    fn then(self, inner: Self) -> Self {
        Self {
            a: self.a * inner.a + self.c * inner.b,
            b: self.b * inner.a + self.d * inner.b,
            c: self.a * inner.c + self.c * inner.d,
            d: self.b * inner.c + self.d * inner.d,
            e: self.a * inner.e + self.c * inner.f + self.e,
            f: self.b * inner.e + self.d * inner.f + self.f,
        }
    }
    /// The same transform, taken about the point (x, y).
    fn about(self, x: f64, y: f64) -> Self {
        Self::translate(x, y)
            .then(self)
            .then(Self::translate(-x, -y))
    }
    fn transform(self) -> Transform {
        Transform::from_row(
            self.a as f32,
            self.b as f32,
            self.c as f32,
            self.d as f32,
            self.e as f32,
            self.f as f32,
        )
    }
}

fn clip_path(rect: [f64; 4]) -> Option<tiny_skia::Path> {
    let edge = |v: f64| v.clamp(-OPEN_EDGE, OPEN_EDGE) as f32;
    Rect::from_ltrb(edge(rect[0]), edge(rect[1]), edge(rect[2]), edge(rect[3]))
        .map(PathBuilder::from_rect)
}
/// A local clip that splits their picture at one height (the two halves breathe apart) reaches one device pixel
/// past the line, so the two halves' anti-aliased edges overlap instead of leaving a see-through row between them.
fn overlap_split(rect: [f64; 4], space: Affine) -> [f64; 4] {
    let open = |v: f64| v.abs() >= 9999.;
    if !(open(rect[0]) && open(rect[2])) || open(rect[1]) == open(rect[3]) {
        return rect;
    }
    let pixel = 1. / (space.c * space.c + space.d * space.d).sqrt().max(1e-6);
    let mut out = rect;
    if open(out[1]) {
        out[3] += pixel;
    } else {
        out[1] -= pixel;
    }
    out
}
/// The final clip (canvas units) and the local clip (moved with the element) as one mask; an empty clip
/// draws nothing.
fn clip_mask(width: u32, height: u32, clips: [(Option<[f64; 4]>, Affine); 2]) -> Option<Mask> {
    let mut mask: Option<Mask> = None;
    for (index, (clip, space)) in clips.into_iter().enumerate() {
        let Some(rect) = clip.filter(|r| !r.iter().all(|v| v.abs() >= 9999.)) else {
            continue;
        };
        let rect = if index == 1 {
            overlap_split(rect, space)
        } else {
            rect
        };
        match (mask.as_mut(), clip_path(rect)) {
            (None, Some(path)) => {
                let mut fresh = Mask::new(width, height)?;
                fresh.fill_path(&path, FillRule::Winding, true, space.transform());
                mask = Some(fresh);
            }
            (Some(held), Some(path)) => {
                held.intersect_path(&path, FillRule::Winding, true, space.transform())
            }
            (None, None) => mask = Some(Mask::new(width, height)?),
            (Some(held), None) => held.clear(),
        }
    }
    mask
}

// ---------------------------------------------------------------- playing

#[derive(Clone, Debug)]
struct Segment {
    part: Arc<Part>,
    looping: bool,
}
impl Segment {
    fn once(part: Part) -> Self {
        Self {
            part: Arc::new(part),
            looping: false,
        }
    }
}

/// One picture on the companion: an action, the clock it started at, and the drawing it left (joined with a dip).
/// once: played through and then into the base even if the action has a loop of its own (a moment, not a state).
#[derive(Clone, Debug)]
pub struct Play {
    pub outfit: Outfit,
    pub action: Key,
    pub base: Key,
    pub at: u64,
    pub once: bool,
    from: Vec<Element>,
    segments: Vec<Segment>,
}
impl Play {
    /// How long before the last (looping) segment begins.
    fn finite_seconds(&self) -> f64 {
        let mut total = 0.;
        for (i, seg) in self.segments.iter().enumerate() {
            if !(seg.looping && i + 1 == self.segments.len()) {
                total += seg.part.seconds;
            }
        }
        total
    }
}

/// The segment playing t seconds in, and how far into it.
fn locate(list: &[Segment], t: f64) -> Option<(usize, f64)> {
    let mut start = 0.;
    for (i, seg) in list.iter().enumerate() {
        let last = i + 1 == list.len();
        if t < start + seg.part.seconds || last {
            let mut u = t - start;
            if seg.looping && last {
                u = u.rem_euclid(seg.part.seconds);
            }
            return Some((i, u.clamp(0., seg.part.seconds)));
        }
        start += seg.part.seconds;
    }
    None
}
/// The elements drawn at t seconds into a list of segments, frozen at their values then.
fn drawn_at(list: &[Segment], t: f64) -> Vec<Element> {
    let Some((i, u)) = locate(list, t) else {
        return Vec::new();
    };
    list[i]
        .part
        .elements
        .iter()
        .filter_map(|e| {
            let a = e.a.sample(u)[0];
            (a >= 0.01).then(|| Element {
                src: e.src.clone(),
                origin: e.origin,
                clip_local: e.clip_local,
                clip_final: e.clip_final,
                a: Track::still(&[a]),
                t: Track::still(&e.t.sample(u)),
                r: Track::still(&[e.r.sample(u)[0]]),
                s: Track::still(&e.s.sample(u)),
            })
        })
        .collect()
}
fn ease(u: f64) -> f64 {
    let x = u.clamp(0., 1.);
    x * x * (3. - 2. * x)
}
/// The dip (or the crouch and rise) on the drawing they leave, before the swap.
fn join(from: &[Element], entry: &Entry, data: &Band) -> Part {
    let hop = entry.kind == EntryKind::Hop;
    let seconds = if hop {
        data.hop[0] + data.hop[1]
    } else {
        data.sink
    };
    const STEPS: usize = 8;
    let elements = from
        .iter()
        .map(|e| {
            let a = e.a.first()[0];
            let [tx, ty] = e.t.first();
            let [sx, sy] = e.s.first();
            let top = e.clip_local.is_some_and(|c| c[3] < 1e4);
            let bottom = e.clip_local.is_some_and(|c| c[1] > -1e4);
            let (mut t, mut s) = (Vec::new(), Vec::new());
            for k in 0..=STEPS {
                let at = seconds * k as f64 / STEPS as f64;
                let (mut px, mut py): (f64, f64);
                let mut dy = 0.;
                if hop {
                    let [crouch, rise] = data.hop;
                    if at <= crouch {
                        py = 1. - 0.05 * ease(at / crouch);
                        px = 1. + 0.5 * (1. - py);
                    } else {
                        let u = ease((at - crouch) / rise);
                        py = 1. + 0.04 * u;
                        px = 1. - 0.02 * u;
                        dy = -entry.h * u;
                    }
                } else {
                    py = 1. - entry.depth * ease(at / seconds);
                    px = 1. + 0.5 * (1. - py);
                }
                if bottom {
                    px = 1.;
                    py = 1.;
                } else if top {
                    px = 1.;
                }
                t.push([at, tx, ty + dy]);
                s.push([at, sx * px, sy * py]);
            }
            Element {
                src: e.src.clone(),
                origin: e.origin,
                clip_local: e.clip_local,
                clip_final: e.clip_final,
                a: Track {
                    keys: vec![[0., a, 0.], [seconds, a, 0.]],
                    width: 1,
                },
                t: Track { keys: t, width: 2 },
                r: e.r.clone(),
                s: Track { keys: s, width: 2 },
            }
        })
        .collect();
    Part { seconds, elements }
}

/// Blinks while Coco holds still, timed like a person's (a median of 5 s, most between 2 and 12, now and
/// then a double blink). Half shut 33 ms, shut 130 ms, half open 50 ms.
pub fn blink_times() -> Vec<f64> {
    let mut seed = 7u32;
    let mut random = move || {
        seed ^= seed << 13;
        seed ^= seed >> 17;
        seed ^= seed << 5;
        seed as f64 / 4294967296.
    };
    let (mut t, mut out) = (2.2, Vec::new());
    while t < BLINK_CYCLE - 1. {
        out.push(t);
        if random() < 1. / 12. && t + 0.6 < BLINK_CYCLE - 1. {
            out.push(t + 0.26 + 0.04 * random());
        }
        let normal =
            (-2. * random().max(1e-9).ln()).sqrt() * (2. * std::f64::consts::PI * random()).cos();
        t += (5. * (0.54 * normal).exp()).clamp(2., 12.);
    }
    out
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Lids {
    Open,
    Half,
    Closed,
}
fn lids_at(blinks: &[f64], cycle_seconds: f64) -> Lids {
    let t = cycle_seconds.rem_euclid(BLINK_CYCLE);
    let Some(&b) = blinks.iter().rev().find(|b| **b <= t) else {
        return Lids::Open;
    };
    let since = t - b;
    if since < 0.033 || (0.163..0.213).contains(&since) {
        Lids::Half
    } else if (0.033..0.163).contains(&since) {
        Lids::Closed
    } else {
        Lids::Open
    }
}

struct Pose<'a> {
    e: &'a Element,
    a: f64,
    t: [f64; 2],
    r: f64,
    s: [f64; 2],
}
fn poses(elements: &[Element], u: f64) -> Vec<Pose<'_>> {
    elements
        .iter()
        .map(|e| Pose {
            e,
            a: e.a.sample(u)[0],
            t: e.t.sample(u),
            r: e.r.sample(u)[0],
            s: e.s.sample(u),
        })
        .collect()
}

pub struct Player {
    bands: [Band; 2],
    bank: Bank,
    /// the folder the bands came from, which holds the sock files too, and the pair Coco wears from them
    folder: PathBuf,
    worn: Option<String>,
    blinks: Vec<f64>,
    play: Option<Play>,
    /// Whether the last picture was drawn moving: what a new action leaves is that picture.
    runs: bool,
    idle: Option<(usize, f64, Option<IdleGeometry>)>,
}
impl Player {
    /// `folder` holds band-A.json and band-B.json.
    pub fn load(folder: &Path) -> Result<Self, Error> {
        let mut bank = Bank::default();
        let a = read_band(&folder.join("band-A.json"), Outfit::A, &mut bank)?;
        let b = read_band(&folder.join("band-B.json"), Outfit::B, &mut bank)?;
        let mut player = Self::with(a, b, bank);
        player.folder = folder.to_path_buf();
        Ok(player)
    }
    /// The pair of socks Coco wears: None is their own (drawn in the pictures), else both outfits' patches are
    /// read from socks-A-<pair>.json and socks-B-<pair>.json. A pair that fails to read leaves their own on.
    pub fn wear(&mut self, pair: Option<&str>) -> Result<(), Error> {
        if self.worn.as_deref() == pair {
            return Ok(());
        }
        self.bank.slots.retain(|key, _| !key.ends_with("#socks"));
        self.bank.socks.clear();
        self.worn = None;
        let Some(pair) = pair else { return Ok(()) };
        if !(2..=24).contains(&pair.len()) || !pair.bytes().all(|b| b.is_ascii_lowercase()) {
            return Err("invalid sock pair".into());
        }
        let mut patches = Vec::new();
        for outfit in [Outfit::A, Outfit::B] {
            let letter = if outfit == Outfit::A { "A" } else { "B" };
            let path = self.folder.join(format!("socks-{letter}-{pair}.json"));
            if std::fs::metadata(&path)?.len() > 16 * 1024 * 1024 {
                return Err("sock data exceeds 16 MiB".into());
            }
            let raw: RawSocks = serde_json::from_slice(&std::fs::read(&path)?)?;
            if Outfit::parse(&raw.outfit) != Some(outfit) || raw.pair != pair {
                return Err("sock data is for another outfit or pair".into());
            }
            let pictures = sidecar(&path)?;
            for (src, patch) in raw.socks {
                if !patch.area.iter().all(|v| v.is_finite()) {
                    return Err("invalid sock patch".into());
                }
                let png = picture(&patch.img, &pictures).ok_or("sock patch is unreadable")?;
                patches.push((src, patch.area, png));
            }
        }
        for (src, area, png) in patches {
            self.bank.socks.entry(src.clone()).or_insert(area);
            self.bank.slots.entry(format!("{src}#socks")).or_insert_with(|| Slot::new(png));
        }
        self.worn = Some(pair.to_owned());
        Ok(())
    }
    pub fn worn(&self) -> Option<&str> {
        self.worn.as_deref()
    }
    fn with(a: Band, b: Band, bank: Bank) -> Self {
        Self {
            bands: [a, b],
            bank,
            folder: PathBuf::new(),
            worn: None,
            blinks: blink_times(),
            play: None,
            runs: true,
            idle: None,
        }
    }
    pub fn current(&self) -> Option<(Outfit, Key, Key)> {
        self.play.as_ref().map(|p| (p.outfit, p.action, p.base))
    }
    /// How long an action plays before it holds or hands over to its base.
    pub fn body_seconds(&self, outfit: Outfit, action: Key) -> f64 {
        self.bands[outfit.index()]
            .actions
            .get(action)
            .map_or(0., |a| a.body.seconds)
    }
    /// The canvas the pictures are drawn on, in the data's own units (width, height).
    pub fn canvas(&self) -> (f64, f64) {
        let [w, h] = self.bands[0].canvas;
        (w, h)
    }
    /// The size of the picture drawn `height` pixels tall.
    pub fn dimensions(&self, height: usize) -> (usize, usize) {
        let (w, h) = self.canvas();
        let height = height.max(1);
        (
            ((height as f64 * w / h - 1e-9).ceil() as usize).max(1),
            height,
        )
    }

    fn segments(
        &self,
        outfit: Outfit,
        action: Key,
        base: Key,
        once: bool,
        from: &[Element],
    ) -> Vec<Segment> {
        let data = &self.bands[outfit.index()];
        let Some(act) = data.actions.get(action) else {
            return Vec::new();
        };
        let mut out = Vec::new();
        if !from.is_empty() && act.entry.kind != EntryKind::Cut {
            out.push(Segment::once(join(from, &act.entry, data)));
        }
        out.push(Segment {
            part: act.body.clone(),
            looping: false,
        });
        if let Some(part) = act.looped.as_ref().filter(|_| !once) {
            out.push(Segment {
                part: part.clone(),
                looping: true,
            });
        } else {
            // played once, then into the base; the shell change ends in the other hoodie, so its base is that one's
            let next = if action == "shell" {
                &self.bands[outfit.other().index()]
            } else {
                data
            };
            let to = next
                .actions
                .get(base)
                .or_else(|| next.actions.get("idle"))
                .unwrap();
            let end = drawn_at(
                &[Segment {
                    part: act.body.clone(),
                    looping: false,
                }],
                act.body.seconds - 1e-3,
            );
            if !end.is_empty() {
                let entry = if to.entry.kind == EntryKind::Cut {
                    SINK_CUT
                } else {
                    to.entry
                };
                out.push(Segment::once(join(&end, &entry, next)));
            }
            out.push(Segment {
                part: to.looped.clone().unwrap_or_else(|| to.body.clone()),
                looping: true,
            });
        }
        out
    }
    fn elapsed(play: &Play, now: u64) -> f64 {
        now.saturating_sub(play.at) as f64 / 1000.
    }
    /// The time into the play that is on screen. When nothing moves Coco stands in the pose the play
    /// settles into: the start of its last loop.
    fn shown_seconds(play: &Play, now: u64, runs: bool) -> f64 {
        if runs {
            Self::elapsed(play, now)
        } else {
            play.finite_seconds()
        }
    }
    /// The drawing on screen at `now`, frozen.
    fn drawn(&self, play: &Play, now: u64, runs: bool) -> Vec<Element> {
        drawn_at(&play.segments, Self::shown_seconds(play, now, runs))
    }

    /// A new play. The same action keeps its clock. An action played once goes on into its base by itself,
    /// so the base it was going to coming back keeps that picture (played through, then held); any other
    /// state, or a new moment, starts now from whatever was drawn.
    fn next(&self, previous: Option<Play>, want: &Wanted, now: u64, runs: bool) -> Play {
        let once = want.act.is_some();
        if let Some(prev) = &previous {
            if prev.outfit == want.outfit
                && prev.action == want.action
                && if once {
                    prev.once && Some(prev.at) == want.act
                } else {
                    !prev.once
                }
            {
                if prev.base == want.base {
                    return previous.unwrap();
                }
                let mut rebased = previous.unwrap();
                rebased.base = want.base;
                rebased.segments = self.segments(
                    rebased.outfit,
                    rebased.action,
                    rebased.base,
                    rebased.once,
                    &rebased.from,
                );
                return rebased;
            }
            let was = self.bands[prev.outfit.index()].actions.get(prev.action);
            if was.is_some_and(|w| prev.once || w.looped.is_none())
                && !once
                && want.action == prev.base
            {
                let into = if prev.action == "shell" {
                    prev.outfit.other()
                } else {
                    prev.outfit
                };
                if want.outfit == into {
                    return previous.unwrap();
                }
            }
        }
        let from = previous
            .as_ref()
            .map(|p| self.drawn(p, now, runs))
            .unwrap_or_default();
        let at = want.act.map_or(now, |act| now.min(act));
        let segments = self.segments(want.outfit, want.action, want.base, once, &from);
        Play {
            outfit: want.outfit,
            action: want.action,
            base: want.base,
            at,
            once,
            from,
            segments,
        }
    }
    /// What Coco plays from `now` on. `runs`: whether they move; when they do not (asleep, carried) they
    /// stand in the pose their action settles into.
    pub fn update(&mut self, want: &Wanted, now: u64, runs: bool) {
        let previous = self.play.take();
        // what they leave is what was on screen, which the flag of the picture before this one decided
        self.play = Some(self.next(previous, want, now, self.runs));
        self.runs = runs;
    }

    /// The pose Coco is drawn in when nothing moves: the loop's first, or the body's last.
    fn still(&self, outfit: Outfit, action: Key) -> Vec<Element> {
        let Some(act) = self.bands[outfit.index()].actions.get(action) else {
            return Vec::new();
        };
        let part = act.looped.as_ref().unwrap_or(&act.body);
        let at = if act.looped.is_some() {
            0.
        } else {
            part.seconds - 1e-3
        };
        drawn_at(
            &[Segment {
                part: part.clone(),
                looping: false,
            }],
            at,
        )
    }
    /// Coco's idle pose in their first outfit, measured the way the painted idle frame is.
    pub fn idle_geometry(&mut self, height: usize, scale: f64) -> Option<IdleGeometry> {
        if let Some((h, s, geometry)) = self.idle {
            if h == height && s == scale {
                return geometry;
            }
        }
        let elements = self.still(Outfit::A, "idle");
        let geometry = Self::paint(
            &mut self.bank,
            &self.bands[0],
            &poses(&elements, 0.),
            height,
            Lids::Open,
        )
        .map(|p| Image {
            width: p.width() as usize,
            height: p.height() as usize,
            pixels: p.take(),
        })
        .and_then(|image| IdleGeometry::measure(&image, scale));
        self.idle = Some((height, scale, geometry));
        geometry
    }

    /// The picture for `now`, `height` pixels tall (premultiplied RGBA, as the painted frames are).
    /// Reduced motion: only the pose, drawn still.
    pub fn render(&mut self, now: u64, height: usize, reduced: bool, runs: bool) -> Option<Image> {
        let play = self.play.as_ref()?;
        let band = &self.bands[play.outfit.index()];
        let pixmap = if reduced {
            let elements = self.still(play.outfit, play.action);
            Self::paint(
                &mut self.bank,
                band,
                &poses(&elements, 0.),
                height,
                Lids::Open,
            )
        } else {
            let (index, u) = locate(&play.segments, Self::shown_seconds(play, now, runs))?;
            let segment = &play.segments[index];
            let blinking = segment.looping && index + 1 == play.segments.len() && runs;
            let lids = if blinking {
                lids_at(&self.blinks, Self::elapsed(play, now))
            } else {
                Lids::Open
            };
            Self::paint(
                &mut self.bank,
                band,
                &poses(&segment.part.elements, u),
                height,
                lids,
            )
        }?;
        Some(Image {
            width: pixmap.width() as usize,
            height: pixmap.height() as usize,
            pixels: pixmap.take(),
        })
    }
    fn paint(
        bank: &mut Bank,
        band: &Band,
        poses: &[Pose],
        height: usize,
        lids: Lids,
    ) -> Option<Pixmap> {
        let [cw, ch] = band.canvas;
        let height = height.max(1);
        let width = ((height as f64 * cw / ch - 1e-9).ceil() as usize).max(1);
        let mut out = Pixmap::new(width as u32, height as u32)?;
        bank.drawn_at(height);
        let k = height as f64 / ch;
        for pose in poses {
            if pose.a > 0.001 {
                draw_pose(&mut out, bank, band, pose, k, lids);
            }
        }
        Some(out)
    }
}

#[cfg(test)]
mod tests;

/// One element: the final clip, then opacity and translate, the local clip, rotate, scale, the picture.
fn draw_pose(out: &mut Pixmap, bank: &mut Bank, band: &Band, pose: &Pose, k: f64, lids: Lids) {
    let [cw, ch] = band.canvas;
    let (width, height) = (out.width(), out.height());
    let e = pose.e;
    // their lids, on a frame they hold in a loop, inside the part of the frame that holds their eyes
    let eyes = (lids != Lids::Open)
        .then(|| bank.eyes.get(&e.src).copied())
        .flatten()
        .filter(|b| {
            !e.clip_local
                .is_some_and(|c| c[1] > b[1] || c[3] < b[1] + b[3])
        });
    let patch_key = eyes.map(|_| {
        format!(
            "{}#{}",
            e.src,
            if lids == Lids::Half { "half" } else { "closed" }
        )
    });
    let patch_height = eyes.map_or(1, |b| ((b[3] * k).round() as usize).max(1));
    // the worn pair of socks, over the drawn ones, moved with the picture
    let socks = bank.socks.get(&e.src).copied();
    let socks_key = format!("{}#socks", e.src);
    let socks_height = socks.map_or(1, |b| ((b[3] * k).round() as usize).max(1));
    if let Some(slot) = bank.slots.get_mut(&e.src) {
        slot.ensure(height as usize);
    }
    if let Some(slot) = patch_key.as_ref().and_then(|key| bank.slots.get_mut(key)) {
        slot.ensure(patch_height);
    }
    if socks.is_some() {
        if let Some(slot) = bank.slots.get_mut(&socks_key) {
            slot.ensure(socks_height);
        }
    }
    let Some(sprite) = bank
        .slots
        .get(&e.src)
        .and_then(|s| s.picture(height as usize))
    else {
        return;
    };
    let patch = patch_key
        .as_ref()
        .and_then(|key| bank.slots.get(key)?.picture(patch_height))
        .zip(eyes);
    let canvas = Affine::scale(k, k);
    let moved = canvas.then(Affine::translate(pose.t[0], pose.t[1]));
    let [ox, oy] = e.origin;
    let placed = moved
        .then(Affine::rotate(pose.r).about(ox, oy))
        .then(Affine::scale(pose.s[0], pose.s[1]).about(ox, oy));
    let image = placed.then(Affine::scale(
        cw / sprite.width as f64,
        ch / sprite.height as f64,
    ));
    let lids_at = patch.map(|(p, b)| {
        placed
            .then(Affine::translate(b[0], b[1]))
            .then(Affine::scale(b[2] / p.width as f64, b[3] / p.height as f64))
    });
    let socks_patch = socks
        .and_then(|b| Some((bank.slots.get(&socks_key)?.picture(socks_height)?, b)))
        .map(|(p, b)| {
            let at = placed
                .then(Affine::translate(b[0], b[1]))
                .then(Affine::scale(b[2] / p.width as f64, b[3] / p.height as f64));
            (p, at)
        });
    // the trimmed picture goes where it sits in the whole one
    let draw =
        |target: &mut Pixmap, picture: &Trimmed, at: Affine, opacity: f64, mask: Option<&Mask>| {
            let paint = PixmapPaint {
                opacity: opacity as f32,
                quality: FilterQuality::Bilinear,
                ..PixmapPaint::default()
            };
            target.draw_pixmap(
                picture.x,
                picture.y,
                picture.pixmap.as_ref(),
                &paint,
                at.transform(),
                mask,
            );
        };
    let opacity = pose.a.min(1.);
    if opacity < 0.999 && (patch.is_some() || socks_patch.is_some()) {
        // opacity belongs to the whole group, their socks and lids included
        let Some(mut group) = Pixmap::new(width, height) else {
            return;
        };
        let local = clip_mask(width, height, [(None, canvas), (e.clip_local, moved)]);
        draw(&mut group, sprite, image, 1., local.as_ref());
        if let Some((socks, at)) = socks_patch {
            draw(&mut group, socks, at, 1., local.as_ref());
        }
        if let (Some((patch, _)), Some(at)) = (patch, lids_at) {
            draw(&mut group, patch, at, 1., local.as_ref());
        }
        let outer = clip_mask(width, height, [(e.clip_final, canvas), (None, moved)]);
        let paint = PixmapPaint {
            opacity: opacity as f32,
            quality: FilterQuality::Bilinear,
            ..PixmapPaint::default()
        };
        out.draw_pixmap(
            0,
            0,
            group.as_ref(),
            &paint,
            Transform::identity(),
            outer.as_ref(),
        );
        return;
    }
    let mask = clip_mask(
        width,
        height,
        [(e.clip_final, canvas), (e.clip_local, moved)],
    );
    draw(out, sprite, image, opacity, mask.as_ref());
    if let Some((socks, at)) = socks_patch {
        draw(out, socks, at, opacity, mask.as_ref());
    }
    if let (Some((patch, _)), Some(at)) = (patch, lids_at) {
        draw(out, patch, at, opacity, mask.as_ref());
    }
}
