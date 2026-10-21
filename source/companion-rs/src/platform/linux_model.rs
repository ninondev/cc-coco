//! Display-independent X11 picking. Its interface deliberately has no window title
//! or application-content operation; the only identity is the two WM_CLASS strings.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WmClass {
    pub instance: String,
    pub class: String,
}
pub fn serif_family(lang: &str) -> &'static str {
    if matches!(lang, "zh-Hant" | "zh-TW" | "zh_TW") {
        return "Noto Serif, Noto Serif CJK TC, Noto Serif Devanagari";
    }
    match lang.split(['-', '_']).next().unwrap_or("en") {
        "ja" => "Noto Serif, Noto Serif CJK JP, Noto Serif Devanagari",
        "ko" => "Noto Serif, Noto Serif CJK KR, Noto Serif Devanagari",
        _ => "Noto Serif, Noto Serif CJK SC, Noto Serif Devanagari",
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}
pub trait PickDisplay {
    fn begin(&mut self) -> bool;
    fn candidate(&mut self, x: i32, y: i32) -> Option<(u64, Rect)>;
    fn is_companion(&self, window: u64) -> bool;
    fn wm_class(&mut self, window: u64) -> Option<WmClass>;
    fn outline(&mut self, bounds: Option<Rect>);
    fn tooltip(&mut self, point: Option<(i32, i32)>);
    fn end(&mut self);
}
#[derive(Default)]
pub struct PickTooltipState {
    point: Option<(i32, i32)>,
    scale: f64,
}
impl PickTooltipState {
    pub fn update(&mut self, point: Option<(i32, i32)>, scale: f64) {
        self.point = point;
        self.scale = scale;
    }
    pub fn scale_changed(&mut self, scale: f64) -> Option<(i32, i32)> {
        if self.scale == scale {
            return None;
        }
        self.scale = scale;
        self.point
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum X11EventRoute {
    RefreshScale,
    Pick,
    Normal,
}
pub fn x11_event_route(kind: i32, resource_property: bool, picking: bool) -> X11EventRoute {
    if kind == 28 && resource_property {
        X11EventRoute::RefreshScale
    } else if picking {
        X11EventRoute::Pick
    } else {
        X11EventRoute::Normal
    }
}
pub fn x11_physical_dpi(width_pixels: u32, width_mm: i32) -> f64 {
    if width_mm > 0 { width_pixels as f64 * 25.4 / width_mm as f64 } else { 96. }
}
pub fn x11_display_scale(resources: &str, fallback_dpi: f64) -> f64 {
    let usable_scale = |dpi: f64| {
        let scale = dpi / 96.;
        (scale.is_finite() && (crate::render::MIN_CANVAS_SCALE..=crate::render::MAX_CANVAS_SCALE).contains(&scale))
            .then_some(scale)
    };
    let dpi = resources.lines().find_map(|line| {
        let (key, value) = line.split_once(':')?;
        (key.trim() == "Xft.dpi").then(|| value.trim().parse::<f64>().ok()).flatten()
    });
    dpi.and_then(usable_scale).or_else(|| usable_scale(fallback_dpi)).unwrap_or(1.)
}

pub fn pick_tooltip_metrics(text: &str, lang: &str, scale: f64) -> (f64, f64) {
    let (width, height) = crate::ui::text_metrics(
        text,
        lang,
        13. * scale,
        false,
        false,
        10000. * scale,
        10000. * scale,
    );
    (width / scale, height / scale)
}

pub fn pick_tooltip(
    text: &str,
    lang: &str,
    width: f64,
    height: f64,
    scale: f64,
) -> crate::render::Canvas {
    pick_tooltip_look(text, lang, width, height, scale, crate::contrast::Look::Normal)
}
/// The same tooltip under a look: his paper's solid ink edge when the portal asks for contrast.
pub fn pick_tooltip_look(
    text: &str,
    lang: &str,
    width: f64,
    height: f64,
    scale: f64,
    look: crate::contrast::Look,
) -> crate::render::Canvas {
    // English's short cancellation clause must stay on the same line as its help.
    // Fit the original approved text rather than substituting shorter copy.
    let (width, height) = if lang == "en" {
        let intrinsic = pick_tooltip_metrics(text, lang, scale);
        (width.max(intrinsic.0), height.max(intrinsic.1))
    } else {
        (width, height)
    };
    let mut canvas = crate::render::Canvas::blank(
        ((width + 16.) * scale).ceil() as u32,
        ((height + 12.) * scale).ceil() as u32,
    );
    canvas.look = look;
    canvas.paper(
        crate::render::TextRun {
            text: text.into(),
            lang: lang.into(),
            x: 8. * scale,
            y: 6. * scale,
            width: width * scale,
            height: height * scale,
            font_size: 13. * scale,
            line_height: None,
        },
        scale,
    );
    // Keep the measured tooltip layout fixed when platform text painters run.
    canvas.bubble_is_task = true;
    // ...but it sits on paper, so its words keep the paper's dark ink, not the task pill's light one (944813fb).
    canvas.bubble_paper_ink = true;
    canvas
}
/// The X11 frame under the portal's `contrast`: a 2 px black line inside a 2 px white line, 9 px
/// round corners, so one of the two holds against any window.
pub fn outline_pixels_contrast(width: u32, height: u32) -> Vec<u8> {
    let mut canvas = crate::render::Canvas::blank(width, height);
    let frame = |grow: f64| crate::ui::Rect {
        x: grow,
        y: grow,
        width: width as f64 - 2. * grow,
        height: height as f64 - 2. * grow,
    };
    crate::ui::outline(&mut canvas, frame(0.), 9., 2., crate::contrast::PICK_OUTER, 1.);
    crate::ui::outline(&mut canvas, frame(2.), 7., 2., crate::contrast::PICK_INNER, 1.);
    canvas.pixels
}
/// The decided X11 frame: 2 px #C75730, 9 px round corners, no fill.
pub fn outline_pixels(width: u32, height: u32) -> Vec<u8> {
    let mut canvas = crate::render::Canvas::blank(width, height);
    crate::ui::outline(
        &mut canvas,
        crate::ui::Rect {
            x: 0.,
            y: 0.,
            width: width as f64,
            height: height as f64,
        },
        9.,
        2.,
        [199, 87, 48, 255],
        1.,
    );
    canvas.pixels
}
#[path = "windows_notice_state.rs"]
mod native_notice;
pub use native_notice::{Candidate, NoticeGate};
#[derive(Default)]
pub struct TrayRegistration {
    connected: bool,
    owner: String,
}
impl TrayRegistration {
    pub fn connected(&mut self) -> bool {
        let fresh = !self.connected;
        self.connected = true;
        fresh
    }
    pub fn disconnected(&mut self) {
        self.connected = false;
        self.owner.clear();
    }
    pub fn owner_changed(&mut self, owner: &str) -> bool {
        if !self.connected {
            return false;
        }
        let register = !owner.is_empty() && self.owner != owner;
        self.owner = owner.into();
        register
    }
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Area {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
impl Area {
    pub const fn new(x: f64, y: f64, width: f64, height: f64) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }
    pub fn right(self) -> f64 {
        self.x + self.width
    }
    pub fn bottom(self) -> f64 {
        self.y + self.height
    }
    pub fn intersection(self, other: Self) -> Option<Self> {
        let x = self.x.max(other.x);
        let y = self.y.max(other.y);
        let w = self.right().min(other.right()) - x;
        let h = self.bottom().min(other.bottom()) - y;
        (w > 0. && h > 0.).then(|| Self::new(x, y, w, h))
    }
    fn contains(self, other: Self) -> bool {
        other.x >= self.x
            && other.y >= self.y
            && other.right() <= self.right()
            && other.bottom() <= self.bottom()
    }
}
pub fn monitor_for(window: Area, monitors: &[(Area, bool)], fallback: Area) -> Area {
    let centre = [window.x + window.width / 2., window.y + window.height / 2.];
    monitors
        .iter()
        .max_by(|(a, pa), (b, pb)| {
            let score = |r: Area| {
                let overlap = window.intersection(r).map_or(0., |r| r.width * r.height);
                let dx = centre[0] - centre[0].clamp(r.x, r.right());
                let dy = centre[1] - centre[1].clamp(r.y, r.bottom());
                (overlap, -dx.hypot(dy))
            };
            let sa = score(*a);
            let sb = score(*b);
            sa.0.total_cmp(&sb.0)
                .then_with(|| sa.1.total_cmp(&sb.1))
                .then_with(|| pa.cmp(pb))
        })
        .map_or(fallback, |(r, _)| *r)
}
pub fn visible_area(screen: Area, workarea: Option<Area>) -> Area {
    workarea
        .and_then(|w| screen.intersection(w))
        .unwrap_or(screen)
}
pub fn host_clip(host: Area, origin: [f64; 2], size: [f64; 2]) -> Option<Area> {
    Area::new(
        host.x - origin[0],
        host.y - origin[1],
        host.width,
        host.height,
    )
    .intersection(Area::new(0., 0., size[0], size[1]))
}
/// A native front layer contains only page pixels already occluded by the host.
/// No allocation or native surface is needed when the intersection is transparent.
pub fn front_page_pixels(pages: &[u8], width: u32, height: u32, clip: Area) -> Option<Vec<u8>> {
    let length = (width as usize)
        .checked_mul(height as usize)?
        .checked_mul(4)?;
    if pages.len() != length {
        return None;
    }
    let clip = clip.intersection(Area::new(0., 0., width as f64, height as f64))?;
    let (left, top) = (clip.x.floor() as u32, clip.y.floor() as u32);
    let (right, bottom) = (clip.right().ceil() as u32, clip.bottom().ceil() as u32);
    let mut pixels = None;
    for y in top..bottom {
        for x in left..right {
            let at = (y as usize * width as usize + x as usize) * 4;
            if pages[at + 3] != 0 {
                let target = pixels.get_or_insert_with(|| vec![0; length]);
                target[at..at + 4].copy_from_slice(&pages[at..at + 4]);
            }
        }
    }
    pixels
}
#[derive(Default)]
pub struct FrontPageGate {
    failed: bool,
}
impl FrontPageGate {
    pub fn ready(&mut self, visible: bool) -> bool {
        if !visible {
            self.failed = false;
            false
        } else {
            !self.failed
        }
    }
    pub fn failed(&mut self) {
        self.failed = true;
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FollowMode {
    Ledge,
    BesideRight,
    BesideLeft,
    Below,
    Free,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FollowPlacement {
    pub mode: FollowMode,
    pub frame: Area,
    pub window: Area,
    pub gesture_start: Option<Area>,
    pub room: f64,
    pub horizontal: bool,
    pub push: f64,
    pub hidden: f64,
}
/// Place.swift automaticSpot/spot/contact, converted exactly from Cocoa to screen-top-left coordinates.
pub fn follow_spot(
    window: Area,
    size: [f64; 2],
    screen: Area,
    visible: Area,
    previous: Option<FollowPlacement>,
    live: bool,
) -> FollowPlacement {
    let [w, h] = size;
    let clamp = |v: f64, lo: f64, hi: f64| v.max(lo).min(hi.max(lo));
    // Keep Cocoa's low>high behavior before converting the frame origin to top-left.
    let beside_y = || {
        -clamp(
            -window.bottom().min(visible.bottom()),
            -visible.bottom(),
            -window.y.max(visible.y) - h,
        ) - h
    };
    let free = Area::new(
        screen.x,
        visible.y,
        screen.width,
        screen.bottom() - visible.y,
    );
    let fills = window.x <= visible.x + 24.
        && window.right() >= visible.right() - 24.
        && window.y <= visible.y + 24.
        && window.bottom() >= visible.bottom() - 24.;
    let make = |mode, frame| FollowPlacement {
        mode,
        frame,
        window,
        gesture_start: None,
        room: 1.,
        horizontal: false,
        push: 0.,
        hidden: 0.,
    };
    let free_frame = || {
        let origin = previous
            .filter(|p| free.intersection(p.frame).is_some())
            .map(|p| p.frame)
            .unwrap_or(Area::new(
                visible.right() - w - 12.,
                visible.bottom() - h - 12.,
                w,
                h,
            ));
        Area::new(
            clamp(origin.x, free.x, free.right() - w),
            clamp(origin.y, free.y, free.bottom() - h),
            w,
            h,
        )
    };
    let automatic = || {
        if fills {
            return make(FollowMode::Free, free_frame());
        }
        let sink = (h * 0.05).round();
        let was_ledge = previous.is_some_and(|p| p.mode == FollowMode::Ledge);
        if window.y - visible.y >= h - sink + 2. + if was_ledge { 0. } else { 4. } {
            return make(
                FollowMode::Ledge,
                Area::new(
                    clamp(
                        window.right() - 64. - w,
                        window.x + 18.,
                        window.right() - 18. - w,
                    ),
                    window.y + sink - h,
                    w,
                    h,
                ),
            );
        }
        let right = visible.right() - window.right();
        let left = window.x - visible.x;
        let beside_y = beside_y();
        if right >= w + 20. {
            return make(
                FollowMode::BesideRight,
                Area::new(window.right() + 10., beside_y, w, h),
            );
        }
        if left >= w + 20. {
            return make(
                FollowMode::BesideLeft,
                Area::new(window.x - 10. - w, beside_y, w, h),
            );
        }
        if screen.bottom() - window.bottom() - 4. >= h * 0.75 {
            return make(
                FollowMode::Below,
                Area::new(
                    clamp(
                        window.right() - 24. - w,
                        window.x.max(screen.x) + 8.,
                        window.right().min(screen.right()) - 8. - w,
                    ),
                    window.bottom() + 4.,
                    w,
                    h,
                ),
            );
        }
        make(FollowMode::Free, free_frame())
    };
    let contact = |mut out: FollowPlacement| {
        match out.mode {
            FollowMode::Ledge => {
                out.room = (out.frame.bottom() - visible.y - 2.) / h.max(1.);
                out.push = 1.;
            }
            FollowMode::BesideRight => {
                out.horizontal = true;
                out.push = 1.;
                out.room = if window.right() + 10. <= screen.right() - 2. - w {
                    10.
                } else {
                    (screen.right() - window.right() - 2. - 4.) / w.max(1.)
                };
            }
            FollowMode::BesideLeft => {
                out.horizontal = true;
                out.push = -1.;
                out.room = if window.x - 10. - w >= screen.x + 2. {
                    10.
                } else {
                    (window.x - screen.x - 2. - 4.) / w.max(1.)
                };
            }
            FollowMode::Below => {
                out.hidden = out.gesture_start.map_or(0., |start| {
                    (window.bottom() - start.bottom()).max(0.) / h.max(1.)
                });
            }
            _ => {}
        }
        out
    };
    let Some(old) = previous else {
        return contact(automatic());
    };
    if !live && fills {
        return contact(automatic());
    }
    let mut out = make(old.mode, old.frame);
    out.gesture_start = if live {
        old.gesture_start.or(Some(old.window))
    } else {
        old.gesture_start
    };
    out.frame = match old.mode {
        FollowMode::Ledge => {
            let low = window.x + 18.;
            let high = window.right() - 18. - w;
            let desired = clamp(window.right() - 64. - w, low, high);
            let slo = low.max(screen.x + 4.);
            let shi = high.min(screen.right() - 4. - w);
            Area::new(
                if slo <= shi {
                    clamp(desired, slo, shi)
                } else {
                    desired
                },
                window.y + (h * 0.05).round() - h,
                w,
                h,
            )
        }
        FollowMode::BesideRight => Area::new(
            (window.right() + 10.).min(screen.right() - 2. - w),
            beside_y(),
            w,
            h,
        ),
        FollowMode::BesideLeft => {
            Area::new((window.x - 10. - w).max(screen.x + 2.), beside_y(), w, h)
        }
        FollowMode::Below => Area::new(
            clamp(
                window.right() - 24. - w,
                window.x.max(screen.x) + 8.,
                window.right().min(screen.right()) - 8. - w,
            ),
            window.bottom() + 4.,
            w,
            h,
        ),
        FollowMode::Free => free_frame(),
    };
    out = contact(out);
    if live {
        return out;
    }
    let fits = match out.mode {
        FollowMode::Ledge => {
            out.room >= 1.
                && out.frame.x >= screen.x
                && out.frame.right() <= screen.right()
                && w + 36. <= window.width
        }
        FollowMode::BesideRight | FollowMode::BesideLeft => {
            out.room >= 1. && free.contains(out.frame)
        }
        FollowMode::Below => {
            out.hidden <= 0.25
                && screen.bottom() - window.bottom() - 4. >= h * 0.75
                && out.frame.x >= screen.x
                && out.frame.right() <= screen.right()
        }
        FollowMode::Free => free.contains(out.frame),
    };
    if fits {
        out.gesture_start = None;
        out
    } else {
        contact(automatic())
    }
}
#[derive(Default)]
pub struct Pick {
    active: bool,
    candidate: Option<u64>,
}
#[derive(Default)]
pub struct Notices {
    seen: std::collections::BTreeMap<String, u64>,
    sent: std::collections::BTreeMap<String, u64>,
}
#[derive(Default)]
pub struct ImeBatch {
    pub commit: Option<String>,
    pub preedit: Option<String>,
    pub preedit_cursor: usize,
    pub delete: (u32, u32),
    pub composing: bool,
}
#[derive(Default)]
pub struct NoticeIds {
    pending: std::collections::BTreeMap<u32, String>,
    owned: std::collections::BTreeMap<u32, String>,
}
impl NoticeIds {
    pub fn closed(&mut self, id: u32) {
        self.owned.remove(&id);
    }
    pub fn request(&mut self, serial: u32, session: &str) {
        if serial != 0 {
            self.pending.insert(serial, session.into());
        }
    }
    pub fn reply(&mut self, serial: u32, id: u32) {
        if let Some(session) = self.pending.remove(&serial) {
            if id != 0 {
                self.owned.insert(id, session);
            }
        }
    }
    pub fn activate(&mut self, id: u32, action: &str) -> Option<String> {
        if action == "default" {
            self.owned.remove(&id)
        } else {
            None
        }
    }
}
impl ImeBatch {
    pub fn done(
        &mut self,
        field: &str,
        cursor: usize,
        expected: u32,
        received: u32,
    ) -> Option<(String, usize)> {
        let commit = self.commit.take();
        let preedit = self.preedit.take();
        let delete = std::mem::take(&mut self.delete);
        if expected != received {
            return None;
        }
        if commit.is_none() && preedit.is_none() && delete == (0, 0) {
            return None;
        }
        if let Some(preedit) = preedit {
            self.composing = !preedit.is_empty();
        } else if commit.is_some() {
            self.composing = false;
        }
        let at = field
            .char_indices()
            .nth(cursor)
            .map(|(i, _)| i)
            .unwrap_or(field.len());
        let begin = at.saturating_sub(delete.0 as usize);
        let end = at.saturating_add(delete.1 as usize).min(field.len());
        let before = field.get(..begin)?;
        let after = field.get(end..)?;
        let committed = commit.unwrap_or_default();
        let cursor = before
            .chars()
            .chain(committed.chars())
            .filter(|c| !c.is_control())
            .take(4000)
            .count();
        let field = before
            .chars()
            .chain(committed.chars())
            .chain(after.chars())
            .filter(|c| !c.is_control())
            .take(4000)
            .collect();
        Some((field, cursor))
    }
}
impl Notices {
    pub fn needs_away_read(
        &self,
        session: &str,
        start: u64,
        done: u64,
        waiting: bool,
        enabled: bool,
    ) -> bool {
        start > 0
            && done > self.seen.get(session).copied().unwrap_or(0)
            && done.saturating_sub(start) >= 120_000
            && !waiting
            && enabled
    }
    pub fn completed(
        &mut self,
        session: &str,
        start: u64,
        done: u64,
        waiting: bool,
        enabled: bool,
        away: bool,
    ) -> bool {
        if done == 0 || done <= self.seen.get(session).copied().unwrap_or(0) {
            return false;
        }
        self.seen.insert(session.into(), done);
        if start == 0 || done.saturating_sub(start) < 120_000 || waiting || !enabled || !away {
            return false;
        }
        if self
            .sent
            .get(session)
            .is_some_and(|last| done.saturating_sub(*last) < 600_000)
        {
            return false;
        }
        self.sent.insert(session.into(), done);
        true
    }
}
impl Pick {
    pub fn active(&self) -> bool {
        self.active
    }
    pub fn begin(&mut self, display: &mut impl PickDisplay) -> bool {
        self.cancel(display);
        self.active = display.begin();
        self.active
    }
    pub fn motion(&mut self, display: &mut impl PickDisplay, x: i32, y: i32) {
        if !self.active {
            return;
        }
        let candidate = display
            .candidate(x, y)
            .filter(|(w, _)| !display.is_companion(*w));
        self.candidate = candidate.map(|(w, _)| w);
        display.outline(candidate.map(|(_, r)| r));
        display.tooltip(Some((x, y)));
    }
    pub fn click(&mut self, display: &mut impl PickDisplay, x: i32, y: i32) -> Option<WmClass> {
        if !self.active {
            return None;
        }
        self.motion(display, x, y);
        let selected = self
            .candidate
            .and_then(|w| display.wm_class(w))
            .filter(|c| {
                !c.instance.is_empty()
                    && !c.class.is_empty()
                    && !c
                        .instance
                        .chars()
                        .chain(c.class.chars())
                        .any(char::is_control)
            });
        self.cancel(display);
        selected
    }
    pub fn cancel(&mut self, display: &mut impl PickDisplay) {
        if !self.active {
            return;
        }
        display.outline(None);
        display.tooltip(None);
        display.end();
        self.active = false;
        self.candidate = None;
    }
}
/// Desktop appearance changes only when the portal supplies a setting event.
#[derive(Default)]
pub struct Appearance {
    dark: bool,
    contrast: bool,
}
impl Appearance {
    pub fn setting(&mut self, namespace: &str, key: &str, value: u32) -> Option<(bool, bool)> {
        if namespace != "org.freedesktop.appearance" {
            return None;
        }
        let old = (self.dark, self.contrast);
        match key {
            "color-scheme" => self.dark = value == 1,
            "contrast" => self.contrast = value == 1,
            _ => return None,
        }
        (old != (self.dark, self.contrast)).then_some((self.dark, self.contrast))
    }
    pub fn reset(&mut self) -> Option<(bool, bool)> {
        let changed = self.dark || self.contrast;
        *self = Self::default();
        changed.then_some((false, false))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn portal_appearance_is_event_only_and_keeps_contrast_separate_from_scheme() {
        let mut appearance = Appearance::default();
        assert_eq!(appearance.setting("org.example", "color-scheme", 1), None);
        assert_eq!(
            appearance.setting("org.freedesktop.appearance", "color-scheme", 1),
            Some((true, false))
        );
        assert_eq!(
            appearance.setting("org.freedesktop.appearance", "color-scheme", 1),
            None
        );
        assert_eq!(
            appearance.setting("org.freedesktop.appearance", "contrast", 1),
            Some((true, true))
        );
        assert_eq!(
            appearance.setting("org.freedesktop.appearance", "color-scheme", 2),
            Some((false, true))
        );
        assert_eq!(
            appearance.setting("org.freedesktop.appearance", "contrast", 0),
            Some((false, false))
        );
        assert_eq!(
            appearance.setting("org.freedesktop.appearance", "unknown", 1),
            None
        );
        assert_eq!(appearance.reset(), None);
        assert_eq!(
            appearance.setting("org.freedesktop.appearance", "contrast", 1),
            Some((false, true))
        );
        assert_eq!(appearance.reset(), Some((false, false)));
        assert_eq!(appearance.reset(), None);
    }
    #[test]
    fn cjk_serif_fallback_matches_session_script_including_region_tags() {
        assert!(serif_family("ja-JP").contains("CJK JP"));
        assert!(!serif_family("ja").contains("CJK SC"));
        assert!(serif_family("ko-KR").contains("CJK KR"));
        assert!(!serif_family("ko").contains("CJK SC"));
        assert!(serif_family("zh-CN").contains("CJK SC"));
        assert!(serif_family("hi").contains("Noto Serif Devanagari"));
        assert_eq!(serif_family("en"), serif_family("de"));
    }
    #[test]
    fn front_page_failure_is_once_per_visible_interval_and_retries_next_shed() {
        let mut gate = FrontPageGate::default();
        assert!(gate.ready(true));
        gate.failed();
        for _ in 0..60 {
            assert!(!gate.ready(true));
        }
        assert!(!gate.ready(false));
        assert!(gate.ready(true));
    }
    #[test]
    fn front_pages_copy_only_visible_host_intersection_and_preserve_page_alpha() {
        let mut pages = vec![0; 4 * 3 * 4];
        pages[4..8].copy_from_slice(&[100, 90, 80, 170]);
        pages[24..28].copy_from_slice(&[110, 95, 85, 200]);
        let clipped = front_page_pixels(&pages, 4, 3, Area::new(2., 1., 2., 2.)).unwrap();
        assert_eq!(&clipped[24..28], &[110, 95, 85, 200]);
        assert_eq!(clipped.iter().filter(|v| **v != 0).count(), 4);
        assert_eq!(&pages[4..8], &[100, 90, 80, 170]);
    }
    #[test]
    fn front_pages_absent_outside_host_or_at_transparent_end_do_not_show_overlay() {
        let mut pages = vec![0; 4 * 3 * 4];
        pages[4..8].copy_from_slice(&[100, 90, 80, 170]);
        assert!(front_page_pixels(&pages, 4, 3, Area::new(2., 1., 2., 2.)).is_none());
        assert!(front_page_pixels(&[0; 48], 4, 3, Area::new(0., 0., 4., 3.)).is_none());
        assert!(front_page_pixels(&pages, 4, 3, Area::new(10., 10., 2., 2.)).is_none());
    }
    #[test]
    fn ledge_clip_keeps_above_edge_and_outside_host_decorations() {
        let clip = host_clip(Area::new(100., 200., 500., 400.), [80., 100.], [300., 240.]).unwrap();
        assert_eq!(clip, Area::new(20., 100., 280., 140.));
        assert!(!clip.contains(Area::new(0., 110., 8., 8.)));
        assert!(!clip.contains(Area::new(40., 80., 8., 8.)));
        assert!(clip.contains(Area::new(40., 120., 8., 8.)));
    }
    #[test]
    fn retained_beside_y_matches_cocoa_clamp_when_window_leaves_workarea() {
        let screen = Area::new(0., 0., 1000., 800.);
        let old = follow_spot(
            Area::new(100., 40., 600., 700.),
            [100., 100.],
            screen,
            screen,
            None,
            false,
        );
        let out = follow_spot(
            Area::new(100., 770., 600., 20.),
            [100., 100.],
            screen,
            screen,
            Some(old),
            true,
        );
        assert_eq!(out.mode, FollowMode::BesideRight);
        assert_eq!(out.frame.y, 700.);
    }
    #[test]
    fn tray_owner_restart_reregisters_once_and_socket_event_recovers() {
        let mut registration = TrayRegistration::default();
        assert!(registration.connected());
        assert!(!registration.connected());
        assert!(registration.owner_changed(":1.8"));
        assert!(!registration.owner_changed(":1.8"));
        assert!(!registration.owner_changed(""));
        assert!(registration.owner_changed(":1.9"));
        registration.disconnected();
        assert!(!registration.owner_changed(":1.10"));
        assert!(registration.connected());
        assert!(registration.owner_changed(":1.10"));
    }
    #[test]
    fn monitor_uses_window_intersection_and_desktop_workarea() {
        let monitors = [
            (Area::new(-1280., 0., 1280., 1024.), false),
            (Area::new(0., 0., 1920., 1080.), true),
        ];
        let screen = monitor_for(Area::new(-900., 100., 400., 600.), &monitors, monitors[1].0);
        assert_eq!(screen, monitors[0].0);
        assert_eq!(
            visible_area(screen, Some(Area::new(-1280., 28., 3200., 1024.))),
            Area::new(-1280., 28., 1280., 996.)
        );
        assert_eq!(
            visible_area(screen, Some(Area::new(0., 0., 1920., 1080.))),
            screen
        );
    }
    #[test]
    fn follow_retains_side_through_squeeze_and_fitting_release() {
        let screen = Area::new(0., 0., 1000., 800.);
        let w = Area::new(100., 40., 600., 700.);
        let previous = follow_spot(w, [100., 100.], screen, screen, None, false);
        assert_eq!(previous.mode, FollowMode::BesideRight);
        let squeezed = follow_spot(
            Area::new(100., 40., 870., 700.),
            [100., 100.],
            screen,
            screen,
            Some(previous),
            true,
        );
        assert_eq!(squeezed.mode, FollowMode::BesideRight);
        assert_eq!(squeezed.frame.x, 898.);
        assert!(squeezed.room < 1.);
        let fits_again = follow_spot(
            Area::new(100., 200., 600., 500.),
            [100., 100.],
            screen,
            screen,
            Some(squeezed),
            false,
        );
        assert_eq!(fits_again.mode, FollowMode::BesideRight);
        assert_eq!(fits_again.frame.x, 710.);
    }
    #[test]
    fn ime_commit_preserves_single_line_limit_and_filtered_cursor() {
        let mut batch = ImeBatch {
            commit: Some(format!("\n{}\t", "字".repeat(5000))),
            ..Default::default()
        };
        let (field, cursor) = batch.done("a", 1, 1, 1).unwrap();
        assert_eq!(field.chars().count(), 4000);
        assert!(!field.chars().any(char::is_control));
        assert_eq!(cursor, 4000);
    }
    #[test]
    fn ime_commit_without_preedit_event_releases_raw_keyboard() {
        let mut batch = ImeBatch {
            composing: true,
            commit: Some("字".into()),
            ..Default::default()
        };
        assert_eq!(batch.done("", 0, 1, 1), Some(("字".into(), 1)));
        assert!(!batch.composing);
    }
    #[test]
    fn native_notice_baselines_history_and_defers_until_quiet() {
        let mut gate = NoticeGate::default();
        let mut c = Candidate {
            session: "s".into(),
            done: 120_001,
            busy_since: 1,
            enabled: true,
            quiet: true,
            waiting: false,
        };
        assert!(!gate.observe(&c, 120_001, || panic!("historical completion read idle")));
        c.done = 240_001;
        c.quiet = false;
        assert!(!gate.observe(&c, 240_001, || panic!("working helper read idle")));
        c.quiet = true;
        assert!(gate.observe(&c, 240_002, || true));
        c.done = 840_003;
        c.enabled = false;
        assert!(!gate.observe(&c, 840_003, || panic!("notice disabled read idle")));
    }
    #[test]
    fn notice_actions_only_accept_ids_issued_for_our_requests_once() {
        let mut n = NoticeIds::default();
        n.request(4, "session");
        n.reply(77, 7);
        assert_eq!(n.activate(7, "default"), None);
        n.reply(4, 8);
        assert_eq!(n.activate(8, "other"), None);
        assert_eq!(n.activate(8, "default"), Some("session".into()));
        assert_eq!(n.activate(8, "default"), None);
    }
    #[test]
    fn ime_batches_preedit_without_inserting_it_and_commits_unicode_once() {
        let mut b = ImeBatch {
            preedit: Some("拼音".into()),
            ..Default::default()
        };
        assert_eq!(b.done("hi", 2, 1, 1), Some(("hi".into(), 2)));
        assert!(b.composing);
        b.preedit = Some(String::new());
        b.commit = Some("你好".into());
        assert_eq!(b.done("hi", 2, 2, 2), Some(("hi你好".into(), 4)));
        assert!(!b.composing);
        assert_eq!(b.done("hi你好", 4, 2, 2), None);
    }
    #[test]
    fn ime_delete_uses_utf8_bytes_and_stale_batches_do_not_edit_the_field() {
        let mut b = ImeBatch {
            delete: (3, 3),
            commit: Some("好".into()),
            ..Default::default()
        };
        assert_eq!(b.done("a你我z", 2, 4, 4), Some(("a好z".into(), 2)));
        b.commit = Some("old".into());
        assert_eq!(b.done("a好z", 2, 5, 4), None);
        assert_eq!(b.done("a好z", 2, 5, 5), None);
    }
    #[derive(Default)]
    struct Fake {
        begun: bool,
        ended: usize,
        own: bool,
        missing: bool,
        outline: Option<Rect>,
        tip: Option<(i32, i32)>,
        reads: usize,
    }
    impl PickDisplay for Fake {
        fn begin(&mut self) -> bool {
            self.begun = true;
            true
        }
        fn candidate(&mut self, _: i32, _: i32) -> Option<(u64, Rect)> {
            Some((
                7,
                Rect {
                    x: 10,
                    y: 20,
                    width: 300,
                    height: 200,
                },
            ))
        }
        fn is_companion(&self, _: u64) -> bool {
            self.own
        }
        fn wm_class(&mut self, _: u64) -> Option<WmClass> {
            self.reads += 1;
            if self.missing {
                None
            } else {
                Some(WmClass {
                    instance: "code".into(),
                    class: "Code".into(),
                })
            }
        }
        fn outline(&mut self, r: Option<Rect>) {
            self.outline = r;
        }
        fn tooltip(&mut self, p: Option<(i32, i32)>) {
            self.tip = p;
        }
        fn end(&mut self) {
            self.ended += 1;
        }
    }
    #[test]
    fn pick_tracks_outline_and_help_without_reading_identity() {
        let mut d = Fake::default();
        let mut p = Pick::default();
        assert!(p.begin(&mut d));
        p.motion(&mut d, 5, 6);
        assert_eq!(
            d.outline,
            Some(Rect {
                x: 10,
                y: 20,
                width: 300,
                height: 200
            })
        );
        assert_eq!(d.tip, Some((5, 6)));
        assert_eq!(d.reads, 0);
    }
    #[test]
    fn pick_stores_both_class_strings_and_releases_every_surface() {
        let mut d = Fake::default();
        let mut p = Pick::default();
        p.begin(&mut d);
        assert_eq!(
            p.click(&mut d, 5, 6),
            Some(WmClass {
                instance: "code".into(),
                class: "Code".into()
            })
        );
        assert!(!p.active());
        assert_eq!(d.ended, 1);
        assert_eq!(d.outline, None);
        assert_eq!(d.tip, None);
    }
    #[test]
    fn pick_own_window_cancels_without_class_read() {
        let mut d = Fake {
            own: true,
            ..Default::default()
        };
        let mut p = Pick::default();
        p.begin(&mut d);
        assert_eq!(p.click(&mut d, 5, 6), None);
        assert_eq!(d.reads, 0);
        assert_eq!(d.ended, 1);
    }
    #[test]
    fn escape_cancels_and_repeated_cancel_does_not_ungrab_twice() {
        let mut d = Fake::default();
        let mut p = Pick::default();
        p.begin(&mut d);
        p.motion(&mut d, 1, 2);
        p.cancel(&mut d);
        p.cancel(&mut d);
        assert_eq!(d.ended, 1);
        assert!(!p.active());
        assert_eq!(d.outline, None);
    }
    #[test]
    fn missing_class_does_not_follow_a_title_or_leave_pick_running() {
        let mut d = Fake {
            missing: true,
            ..Default::default()
        };
        let mut p = Pick::default();
        p.begin(&mut d);
        assert_eq!(p.click(&mut d, 1, 2), None);
        assert_eq!(d.reads, 1);
        assert_eq!(d.ended, 1);
    }
    #[test]
    fn notice_requires_long_away_opt_in_and_nonwaiting_completion() {
        let mut n = Notices::default();
        assert!(!n.completed("s", 1, 120000, false, true, true));
        assert!(n.completed("s", 1, 120001, false, true, true));
        assert!(!n.completed("s", 1, 120001, false, true, true));
        for (session, waiting, enabled, away) in [
            ("wait", true, true, true),
            ("off", false, false, true),
            ("present", false, true, false),
        ] {
            assert!(!n.completed(session, 1, 120001, waiting, enabled, away));
        }
    }
    #[test]
    fn notice_per_session_ten_minute_limit_does_not_block_other_sessions() {
        let mut n = Notices::default();
        assert!(n.completed("s", 1, 120001, false, true, true));
        assert!(!n.completed("s", 120002, 240002, false, true, true));
        assert!(n.completed("other", 120002, 240002, false, true, true));
        assert!(n.completed("s", 600001, 720001, false, true, true));
    }
}
