//! Event-only 0.3 decoration timelines. Coordinates are the approved shipped-art coordinates.
use crate::{
    render::{Canvas, Image, Size},
    Error,
};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::Path};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CompactPhase {
    Begin,
    End,
    Skip,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ShedEvent {
    pub generation: u64,
    pub phase: CompactPhase,
    pub at: u64,
}
#[derive(Clone, Debug, Default)]
pub struct ShedTimeline {
    event: Option<ShedEvent>,
}
#[derive(Clone, Debug, PartialEq)]
pub struct FallingPage {
    pub index: usize,
    pub dx: f64,
    pub dy: f64,
    pub degrees: f64,
    pub opacity: f64,
}
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ShedSample {
    pub active: bool,
    pub held: bool,
    pub frame: Option<&'static str>,
    pub reveal: f64,
    pub lying_opacity: f64,
    pub pages_cell_opacity: f64,
    pub pages: Vec<FallingPage>,
}
impl ShedTimeline {
    pub fn receive(&mut self, event: ShedEvent) {
        if self.event.is_none_or(|old| {
            event.generation > old.generation
                || event.generation == old.generation && event.at >= old.at
        }) {
            self.event = Some(event);
        }
    }
    pub fn sample(&self, now: u64, size: Size, reduced: bool) -> ShedSample {
        let Some(event) = self.event else {
            return ShedSample::default();
        };
        if now < event.at || event.phase == CompactPhase::Skip {
            return ShedSample::default();
        }
        if event.phase == CompactPhase::Begin {
            return ShedSample {
                active: true,
                held: true,
                frame: Some("snake"),
                ..Default::default()
            };
        }
        let t = now.saturating_sub(event.at) as f64;
        if t >= 1600. {
            return ShedSample::default();
        }
        let mut s = ShedSample {
            active: true,
            frame: Some("snake"),
            ..Default::default()
        };
        if size.pixel() {
            s.frame = Some(if t < 160. {
                "shed-a"
            } else if t < 360. {
                "shed-b"
            } else if t < 960. {
                "shed-c"
            } else {
                "snake"
            });
            return s;
        }
        if reduced {
            s.reveal = 1.;
            s.lying_opacity = (1. - ((t - 600.) / 200.).clamp(0., 1.)).clamp(0., 1.);
            return s;
        }
        s.reveal = curve([0., 0., 0.2, 1.], t / 250.);
        s.lying_opacity = 1. - ((t - 460.) / 60.).clamp(0., 1.);
        s.pages_cell_opacity =
            ((t - 400.) / 120.).clamp(0., 1.) * (1. - ((t - 520.) / 350.).clamp(0., 1.));
        // Every size is at least the old Large, so the pages fall like Large's (the Mac draws Large's shed for all three).
        let (fall, amplitude) = (40., 8.);
        for (index, (start, duration, drift)) in
            [(520., 900., -1.), (620., 960., 0.6), (740., 860., 1.4)]
                .into_iter()
                .enumerate()
        {
            let u = (t - start) / duration;
            if !(0.0..1.).contains(&u) {
                continue;
            }
            s.pages.push(FallingPage {
                index,
                dx: drift * amplitude * ((1.4 * std::f64::consts::PI * u).sin() + 0.8 * u),
                dy: fall * u.powf(1.6),
                degrees: if drift < 0. {
                    -(12. + 30. * u)
                } else {
                    12. + 30. * u
                },
                opacity: ((t - start) / 80.).min(1.) * (1. - ((u - 0.6) / 0.4).clamp(0., 1.)),
            });
        }
        s
    }
    pub fn next_deadline(&self, now: u64, reduced: bool) -> Option<u64> {
        let e = self.event?;
        if e.phase != CompactPhase::End || now >= e.at.saturating_add(1600) {
            return None;
        }
        let offsets: &[u64] = if reduced {
            &[600, 800, 1600]
        } else {
            &[
                160, 250, 360, 400, 460, 520, 620, 740, 870, 960, 1420, 1580, 1600,
            ]
        };
        let edge = offsets
            .iter()
            .map(|n| e.at.saturating_add(*n))
            .find(|at| *at > now);
        let moving = if reduced {
            now >= e.at + 600 && now < e.at + 800
        } else {
            now < e.at + 1600
        };
        edge.into_iter().chain(moving.then_some(now + 16)).min()
    }
    /// Runtime frame-only schedule. Painted skin/page animation is currently
    /// preview-only; pixel cuts retain their approved durations at every motion
    /// setting. The selected pose still has to return at 1600 ms.
    pub fn next_frame_deadline(&self, now: u64, size: Size) -> Option<u64> {
        let event = self.event?;
        if event.phase == CompactPhase::Skip {
            return None;
        }
        if now < event.at {
            return Some(event.at);
        }
        if event.phase != CompactPhase::End {
            return None;
        }
        let cuts: &[u64] = if size.pixel() {
            &[160, 360, 960, 1600]
        } else {
            &[1600]
        };
        cuts.iter()
            .map(|offset| event.at.saturating_add(*offset))
            .find(|deadline| *deadline > now)
    }
}

pub fn curve(c: [f64; 4], u: f64) -> f64 {
    let u = u.clamp(0., 1.);
    if u == 0. || u == 1. {
        return u;
    }
    let (mut lo, mut hi) = (0., 1.);
    for _ in 0..24 {
        let t = (lo + hi) / 2.;
        let x = 3. * (1. - t) * (1. - t) * t * c[0] + 3. * (1. - t) * t * t * c[2] + t * t * t;
        if x < u {
            lo = t
        } else {
            hi = t
        }
    }
    let t = (lo + hi) / 2.;
    3. * (1. - t) * (1. - t) * t * c[1] + 3. * (1. - t) * t * t * c[3] + t * t * t
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HelperOutcome {
    #[default]
    Working,
    Done,
    Failed,
    Stopped,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Helper {
    pub id: String,
    pub parent: Option<String>,
    pub at: u64,
    pub ended_at: Option<u64>,
    pub outcome: HelperOutcome,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ScrollSample {
    pub opacity: f64,
    pub dy: f64,
    pub sy: f64,
    pub degrees: f64,
}
impl Helper {
    pub fn pixel_sample(&self, now: u64, delay: u64) -> ScrollSample {
        ScrollSample {
            opacity: if now >= self.at.saturating_add(delay) && self.visible(now) {
                1.
            } else {
                0.
            },
            dy: 0.,
            sy: 1.,
            degrees: 0.,
        }
    }
    pub fn pixel_next_deadline(&self, now: u64, delay: u64) -> Option<u64> {
        let arrive = self.at.saturating_add(delay);
        let leave = self.ended_at.map(|at| {
            at.saturating_add(if self.outcome == HelperOutcome::Done {
                260
            } else {
                500
            })
        });
        [Some(arrive), leave]
            .into_iter()
            .flatten()
            .filter(|at| *at > now)
            .min()
    }
    pub fn sample(&self, now: u64, arrival_delay: u64, reduced: bool) -> ScrollSample {
        if let Some(end) = self.ended_at {
            let t = now.saturating_sub(end) as f64;
            if self.outcome == HelperOutcome::Done {
                let u = curve([0.4, 0., 1., 1.], t / 260.);
                return ScrollSample {
                    opacity: 1. - u,
                    dy: if reduced { 0. } else { -6. * u },
                    sy: 1.,
                    degrees: 0.,
                };
            }
            let tilt = curve([0.4, 0., 1., 1.], t / 300.);
            return ScrollSample {
                opacity: 1. - ((t - 300.) / 200.).clamp(0., 1.),
                dy: 0.,
                sy: 1.,
                degrees: if reduced { 0. } else { 70. * tilt },
            };
        }
        let start = self.at.saturating_add(arrival_delay);
        if now < start {
            return ScrollSample {
                opacity: 0.,
                dy: if reduced { 0. } else { -6. },
                sy: 1.,
                degrees: 0.,
            };
        }
        let t = (now - start) as f64;
        let u = curve([0., 0., 0.2, 1.], t / 200.);
        let sy = if reduced || t < 200. {
            1.
        } else {
            1. + spring(-0.08, t - 200., 0.5, 260., 9.)
        };
        ScrollSample {
            opacity: u,
            dy: if reduced { 0. } else { -6. * (1. - u) },
            sy,
            degrees: 0.,
        }
    }
    pub fn visible(&self, now: u64) -> bool {
        self.parent.is_none()
            && self.ended_at.is_none_or(|at| {
                now < at
                    + if self.outcome == HelperOutcome::Done {
                        260
                    } else {
                        500
                    }
            })
    }
    pub fn next_deadline(&self, now: u64, delay: u64, reduced: bool) -> Option<u64> {
        let end = if let Some(at) = self.ended_at {
            at + if self.outcome == HelperOutcome::Done {
                260
            } else {
                500
            }
        } else {
            self.at + delay + if reduced { 200 } else { 900 }
        };
        if now >= end {
            None
        } else if now < self.at + delay && self.ended_at.is_none() {
            Some(self.at + delay)
        } else {
            Some((now + 16).min(end))
        }
    }
}
pub fn spring(x: f64, ms: f64, m: f64, k: f64, d: f64) -> f64 {
    let a = d / (2. * m);
    let w = (k / m - a * a).sqrt();
    let t = ms / 1000.;
    x * (-a * t).exp() * ((w * t).cos() + a / w * (w * t).sin())
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NeighbourLight {
    pub id: String,
    pub label: String,
    pub busy: bool,
    pub partial: bool,
    pub at: u64,
    pub ended_at: Option<u64>,
}
impl NeighbourLight {
    pub fn pixel_visible(&self, now: u64) -> bool {
        !self.partial
            && now >= self.at
            && (self.busy && self.ended_at.is_none()
                || self
                    .ended_at
                    .is_some_and(|end| now < end.saturating_add(550)))
    }
    pub fn pixel_sample(&self, now: u64) -> (f64, f64, f64) {
        if !self.pixel_visible(now) {
            return (0., 0., 0.);
        }
        (
            1.,
            0.,
            if self
                .ended_at
                .is_some_and(|end| now >= end.saturating_add(200))
            {
                0.
            } else {
                1.
            },
        )
    }
    pub fn pixel_next_deadline(&self, now: u64) -> Option<u64> {
        if self.partial {
            return None;
        }
        if now < self.at {
            return Some(self.at);
        }
        let end = self.ended_at?;
        [end.saturating_add(200), end.saturating_add(550)]
            .into_iter()
            .filter(|at| *at > now)
            .min()
    }
    pub fn visible(&self, now: u64) -> bool {
        !self.partial
            && now >= self.at
            && (self.busy && self.ended_at.is_none()
                || self
                    .ended_at
                    .is_some_and(|end| now < end.saturating_add(700)))
    }
    pub fn next_deadline(&self, now: u64) -> Option<u64> {
        if self.partial || !self.visible(now) {
            return None;
        }
        let end = self
            .ended_at
            .map(|at| at.saturating_add(700))
            .unwrap_or(self.at.saturating_add(240));
        (now < end)
            .then_some((now + 16).min(end))
            .into_iter()
            .chain(self.ended_at.map(|at| at + 400).filter(|at| *at > now))
            .min()
    }
    pub fn sample(&self, now: u64, reduced: bool) -> (f64, f64, f64) {
        if self.partial {
            return (0., 0., 0.);
        }
        if let Some(end) = self.ended_at {
            let t = now.saturating_sub(end) as f64;
            return (
                1. - ((t - 400.) / 300.).clamp(0., 1.),
                0.,
                1. - (t / 400.).clamp(0., 1.),
            );
        }
        if !self.busy {
            return (0., 0., 0.);
        }
        let u = curve([0., 0., 0.2, 1.], now.saturating_sub(self.at) as f64 / 240.);
        (u, if reduced { 0. } else { 4. * (1. - u) }, 1.)
    }
}

// Painting and scheduling must use the same visible list and arrival ordinal.
pub(crate) fn visible_helpers(helpers: &[Helper], now: u64) -> Vec<&Helper> {
    helpers
        .iter()
        .filter(|helper| helper.visible(now))
        .collect()
}
pub(crate) fn helper_slots(visible_count: usize) -> usize {
    if visible_count >= 5 {
        3
    } else {
        visible_count
    }
}
pub(crate) fn helpers_next_deadline(
    helpers: &[Helper],
    now: u64,
    size: Size,
    reduced: bool,
) -> Option<u64> {
    let visible = visible_helpers(helpers, now);
    let slots = helper_slots(visible.len());
    let individual = visible
        .iter()
        .take(slots)
        .enumerate()
        .filter_map(|(i, helper)| {
            if size.pixel() {
                helper.pixel_next_deadline(now, i as u64 * 260)
            } else {
                helper.next_deadline(now, i as u64 * 260, reduced)
            }
        })
        .min();
    // A bundled scroll that is not drawn needs no departure animation. Only
    // the expiration that crosses from >=5 to four scrolls changes the pixels.
    let membership = if visible.len() >= 5 {
        let mut expirations: Vec<_> = visible
            .iter()
            .filter_map(|helper| {
                helper.ended_at.map(|at| {
                    at.saturating_add(if helper.outcome == HelperOutcome::Done {
                        260
                    } else {
                        500
                    })
                })
            })
            .filter(|at| *at > now)
            .collect();
        expirations.sort_unstable();
        expirations.get(visible.len() - 5).copied()
    } else {
        None
    };
    individual.into_iter().chain(membership).min()
}
pub(crate) fn selected_neighbours(
    lights: &[NeighbourLight],
    now: u64,
    pixel: bool,
) -> Vec<&NeighbourLight> {
    let mut selected: Vec<_> = lights
        .iter()
        .filter(|light| {
            if pixel {
                light.pixel_visible(now)
            } else {
                light.visible(now)
            }
        })
        .collect();
    selected.sort_by(|a, b| b.at.cmp(&a.at).then_with(|| a.id.cmp(&b.id)));
    selected.truncate(1);
    selected
}
pub(crate) fn neighbours_next_deadline(
    lights: &[NeighbourLight],
    now: u64,
    pixel: bool,
) -> Option<u64> {
    let visible = selected_neighbours(lights, now, pixel)
        .into_iter()
        .filter_map(|light| {
            if pixel {
                light.pixel_next_deadline(now)
            } else {
                light.next_deadline(now)
            }
        })
        .min();
    // A future supplied event becomes the newest eligible lantern at its time.
    // Before that point there are no pixels to animate.
    let future = lights
        .iter()
        .filter(|light| {
            light.at > now
                && if pixel {
                    light.pixel_visible(light.at)
                } else {
                    light.visible(light.at)
                }
        })
        .map(|light| light.at)
        .min();
    visible.into_iter().chain(future).min()
}

/// A visitor on him while he dozes, as the shared record carries it. Painted sizes show it arriving and
/// taking off in a fraction of a second; the pixel sizes only cut (design VISITORS.md 3 and 5.2).
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Visitor {
    pub id: String,
    pub kind: String,
    pub at: u64,
    pub left_at: Option<u64>,
    pub label: Option<String>,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct VisitorSample {
    pub opacity: f64,
    /// CSS pixels, down is positive.
    pub dy: f64,
}
const VISIT_ARRIVE_MS: u64 = 360;
const VISIT_LEAVE_MS: u64 = 450;
const VISIT_FADE_MS: u64 = 200;
impl Visitor {
    fn arrive_ms(pixel: bool, reduced: bool) -> u64 {
        if pixel {
            0
        } else if reduced {
            VISIT_FADE_MS
        } else {
            VISIT_ARRIVE_MS
        }
    }
    fn leave_ms(pixel: bool, reduced: bool) -> u64 {
        if pixel {
            0
        } else if reduced {
            VISIT_FADE_MS
        } else {
            VISIT_LEAVE_MS
        }
    }
    /// What is drawn at `now`; None when nothing is. A visitor with no `left_at` only shows while he sleeps.
    pub fn sample(
        &self,
        now: u64,
        asleep: bool,
        pixel: bool,
        reduced: bool,
    ) -> Option<VisitorSample> {
        if now < self.at || (self.left_at.is_none() && !asleep) {
            return None;
        }
        if let Some(left) = self.left_at {
            if now >= left {
                let u = (now - left) as f64 / Self::leave_ms(pixel, reduced).max(1) as f64;
                if pixel || u >= 1. {
                    return None;
                }
                return Some(VisitorSample {
                    opacity: 1. - u,
                    dy: if reduced { 0. } else { -16. * u * u },
                });
            }
        }
        let arrive = Self::arrive_ms(pixel, reduced);
        let u = if arrive == 0 {
            1.
        } else {
            ((now - self.at) as f64 / arrive as f64).min(1.)
        };
        let ease = 1. - (1. - u) * (1. - u);
        Some(VisitorSample {
            opacity: if reduced { u } else { ease },
            dy: if reduced { 0. } else { -12. * (1. - ease) },
        })
    }
    /// The next moment the picture changes: its arrival, each frame of a move, its leaving, and the end of that.
    pub fn next_deadline(&self, now: u64, asleep: bool, pixel: bool, reduced: bool) -> Option<u64> {
        let frame = now + 16;
        if now < self.at {
            return Some(self.at);
        }
        if let Some(left) = self.left_at {
            if now < left {
                return Some(left);
            }
            return self.sample(now, asleep, pixel, reduced).map(|_| frame);
        }
        if !asleep {
            return None;
        }
        let end = self.at + Self::arrive_ms(pixel, reduced);
        (now < end).then_some(frame.min(end))
    }
}
/// They are always Coco now, and a visitor on Coco moves as on the painted sizes (`visitor_on_coco`).
pub(crate) fn visitor_next_deadline(
    visitor: Option<&Visitor>,
    now: u64,
    asleep: bool,
    reduced: bool,
) -> Option<u64> {
    visitor.and_then(|v| v.next_deadline(now, asleep, false, reduced))
}
/// One kind's sprites and anchors, from assets/visitors/ (made by tools/build-visitor-art.py).
struct VisitorArt {
    light: Image,
    dark: Image,
    w: f64,
    h: f64,
    pixel: (f64, f64),
    band: (f64, f64, f64),
    /// The USB light's round light: its radius, one image per ground and where its centre sits on the sprite.
    glow: Option<VisitorGlow>,
}
struct VisitorGlow {
    band: (f64, Image),
    pixel: (f64, Image),
    centre: (f64, f64),
}

pub struct DecorAssets {
    images: BTreeMap<String, Image>,
    spec: serde_json::Value,
    vectors: BTreeMap<String, Vec<u8>>,
    visitors: BTreeMap<String, VisitorArt>,
}
/// Every file is optional: a kind that cannot be read is simply never drawn.
fn load_visitors(folder: &Path) -> BTreeMap<String, VisitorArt> {
    let mut found = BTreeMap::new();
    let Ok(bytes) = std::fs::read(folder.join("visitors.json")) else {
        return found;
    };
    let Ok(manifest) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return found;
    };
    let Some(kinds) = manifest.get("kinds").and_then(serde_json::Value::as_object) else {
        return found;
    };
    let pair = |value: &serde_json::Value, key: &str| -> Option<(f64, f64)> {
        let a = value.get(key)?.as_array()?;
        Some((a.first()?.as_f64()?, a.get(1)?.as_f64()?))
    };
    for (kind, entry) in kinds {
        if kind.is_empty() || !kind.chars().all(|c| c.is_ascii_lowercase()) {
            continue;
        }
        let (Some(w), Some(h), Some(pixel), Some(band)) = (
            entry.get("w").and_then(serde_json::Value::as_f64),
            entry.get("h").and_then(serde_json::Value::as_f64),
            pair(entry, "pixel"),
            entry.get("band").and_then(|b| {
                let a = b.as_array()?;
                Some((
                    a.first()?.as_f64()?,
                    a.get(1)?.as_f64()?,
                    a.get(2)?.as_f64()?,
                ))
            }),
        ) else {
            continue;
        };
        let (Ok(light), Ok(dark)) = (
            Image::load(&folder.join(format!("{kind}-light.png"))),
            Image::load(&folder.join(format!("{kind}-dark.png"))),
        ) else {
            continue;
        };
        if band.2 <= 0. {
            continue;
        }
        let glow = entry.get("glow").and_then(|g| {
            let load = |which: &str| -> Option<(f64, Image)> {
                let spec = g.get(which)?;
                let file = spec.get("file")?.as_str()?;
                if file.contains('/') || file.contains("..") {
                    return None;
                }
                Some((
                    spec.get("r")?.as_f64()?,
                    Image::load(&folder.join(file)).ok()?,
                ))
            };
            Some(VisitorGlow {
                band: load("band")?,
                pixel: load("pixel")?,
                centre: pair(g, "centre")?,
            })
        });
        found.insert(
            kind.clone(),
            VisitorArt {
                light,
                dark,
                w,
                h,
                pixel,
                band,
                glow,
            },
        );
    }
    found
}

impl DecorAssets {
    pub fn load(root: &Path) -> Result<Self, Error> {
        let mut images = BTreeMap::new();
        let spec: serde_json::Value =
            serde_json::from_slice(&std::fs::read(root.join("shed/shed.json"))?)?;
        for size in ["medium", "large"] {
            for scale in [1, 2] {
                for piece in ["lying", "pages", "page"] {
                    let name = format!("companion-{size}@{scale}x-{piece}.png");
                    images.insert(name.clone(), Image::load(&root.join("shed").join(name))?);
                }
            }
        }
        images.insert(
            "scroll-tiny.png".into(),
            Image::load(&root.join("decor/scroll-tiny.png"))?,
        );
        for name in [
            "lantern-pixel-lit.png",
            "lantern-pixel-unlit.png",
            "bundle-pixel.png",
        ] {
            images.insert(name.into(), Image::load(&root.join("decor").join(name))?);
        }
        let mut vectors = BTreeMap::new();
        for entry in std::fs::read_dir(root.join("decor"))? {
            let entry = entry?;
            if entry.path().extension().is_some_and(|ext| ext == "svg") {
                vectors.insert(
                    entry
                        .file_name()
                        .to_string_lossy()
                        .trim_end_matches(".svg")
                        .into(),
                    std::fs::read(entry.path())?,
                );
            }
        }
        Ok(Self {
            images,
            spec,
            vectors,
            visitors: load_visitors(&root.join("visitors")),
        })
    }
    pub fn ribbon(
        &self,
        canvas: &mut Canvas,
        index: u8,
        x: f64,
        y: f64,
        width: u8,
        scale: f64,
        dark: bool,
    ) {
        let name = format!(
            "ribbon-{}-{}-{width}",
            if dark { "dark" } else { "light" },
            index % 14
        );
        if let Some(bytes) = self.vectors.get(&name) {
            if let Ok(image) = crate::ui::vector_image(bytes, width as f64, 22., scale) {
                canvas.overlay(&image, x, y, 1., 1., 0., None);
            }
        }
    }
    pub(crate) fn shed_left(&self, _size: Size, scale: f64) -> f64 {
        let name = "large";
        let device_scale = if scale >= 1.5 { 2 } else { 1 };
        self.spec["companion"][name][format!("{device_scale}x")]["lying"]["dx"]
            .as_f64()
            .unwrap()
            / device_scale as f64
    }
    pub fn shed(
        &self,
        canvas: &mut Canvas,
        sample: &ShedSample,
        size: Size,
        scale: f64,
        on_ledge: bool,
        room: f64,
        bottom_visible: bool,
    ) {
        canvas.front_pages = None;
        if size.pixel() || !sample.active || !bottom_visible {
            return;
        }
        let name = "large";
        let device_scale = if scale >= 1.5 { 2 } else { 1 };
        let spec = &self.spec["companion"][name][format!("{device_scale}x")];
        let natural = spec["lying"]["width"].as_f64().unwrap() / device_scale as f64;
        let shrink = (room / natural).min(1.);
        if shrink < 0.6 {
            return;
        }
        let (x, y) = canvas.frame_point(0., 0.);
        let grid = &spec["frame_image"];
        let (grid_width, grid_height) = (grid[0].as_f64().unwrap(), grid[1].as_f64().unwrap());
        let factor = canvas.sprite_bounds.3 as f64 / grid_height;
        let point = |canvas: &Canvas, px: f64, py: f64| {
            canvas.frame_grid_point(px, py, grid_width, grid_height)
        };
        let left = point(canvas, spec["lying"]["dx"].as_f64().unwrap(), 0.).0 - x;
        let dy_key = if on_ledge {
            "dy_on_ledge"
        } else {
            "dy_elsewhere"
        };
        for (piece, opacity) in [
            ("lying", sample.lying_opacity),
            ("pages", sample.pages_cell_opacity),
        ] {
            let meta = &spec[piece];
            let (registered_x, registered_y) = point(
                canvas,
                meta["dx"].as_f64().unwrap(),
                meta[dy_key].as_f64().unwrap(),
            );
            let (dx, dy) = (registered_x - x, registered_y - y);
            let image = &self.images[&format!("companion-{name}@{device_scale}x-{piece}.png")];
            let reveal_x = canvas
                .frame_grid_point(
                    self.spec["companion"]["reveal_from_frame_x"]
                        .as_f64()
                        .unwrap(),
                    0.,
                    self.spec["frame"]["size"][0].as_f64().unwrap(),
                    self.spec["frame"]["size"][1].as_f64().unwrap(),
                )
                .0
                - x;
            let clip = if sample.reveal < 1. {
                Some((
                    x + reveal_x,
                    y + dy,
                    (left + image.width as f64 * factor - reveal_x).max(0.) * sample.reveal,
                    image.height as f64 * factor,
                ))
            } else {
                None
            };
            canvas.overlay(
                image,
                x + left + (dx - left) * shrink,
                y + dy,
                factor * shrink,
                opacity,
                0.,
                clip,
            );
        }
        let pt = &self.spec["companion"][name]["pt"];
        let elsewhere = if on_ledge {
            0.
        } else {
            spec["lying"]["dy_elsewhere"].as_f64().unwrap()
                - spec["lying"]["dy_on_ledge"].as_f64().unwrap()
        };
        let page = &self.images[&format!("companion-{name}@{device_scale}x-page.png")];
        let (width, height) = (canvas.width, canvas.height);
        let mut front_pages: Option<Canvas> = None;
        for p in &sample.pages {
            let start = &spec["page_starts"][p.index];
            let (registered_x, registered_y) = point(
                canvas,
                start[0].as_f64().unwrap(),
                start[1].as_f64().unwrap() + elsewhere,
            );
            let (px, py) = (registered_x - x, registered_y - y);
            let _ = pt;
            let page_x = x + left + (px - left) * shrink + p.dx * scale * shrink
                - page.width as f64 * factor * shrink / 2.;
            let page_y = y + py + p.dy * scale - page.height as f64 * factor * shrink / 2.;
            let page_scale = factor * shrink;
            canvas.overlay(page, page_x, page_y, page_scale, p.opacity, p.degrees, None);
            if p.opacity > 0. {
                front_pages
                    .get_or_insert_with(|| Canvas::blank(width, height))
                    .overlay(page, page_x, page_y, page_scale, p.opacity, p.degrees, None);
            }
        }
        canvas.front_pages = front_pages
            .filter(|pages| pages.pixels.chunks_exact(4).any(|pixel| pixel[3] != 0))
            .map(Box::new);
    }
    /// The visitor on him, at the band's anchors (painted sizes) or on his pixel head (cuts only).
    /// It is as big next to him as in the band: an art pixel is as many frame pixels as the band uses.
    #[allow(clippy::too_many_arguments)]
    pub fn visitor(
        &self,
        canvas: &mut Canvas,
        visitor: &Visitor,
        now: u64,
        asleep: bool,
        size: Size,
        scale: f64,
        dark: bool,
        reduced: bool,
    ) {
        self.draw_visitor(
            canvas, visitor, now, asleep, size, scale, dark, reduced, false,
        );
    }
    /// The visitor on Coco, whose 234 x 241 canvas fills the sprite bounds: the painted art at every size, the
    /// old figure box (10,4)-(146,127) moved onto theirs (42,26)-(217,228) and the note onto the mug's right wall,
    /// as the band places them (register.tsx COCO_VISIT_PLACE, COCO_NOTE_PLACE).
    #[allow(clippy::too_many_arguments)]
    pub fn visitor_on_coco(
        &self,
        canvas: &mut Canvas,
        visitor: &Visitor,
        now: u64,
        asleep: bool,
        size: Size,
        scale: f64,
        dark: bool,
        reduced: bool,
    ) {
        self.draw_visitor(
            canvas, visitor, now, asleep, size, scale, dark, reduced, true,
        );
    }
    #[allow(clippy::too_many_arguments)]
    fn draw_visitor(
        &self,
        canvas: &mut Canvas,
        visitor: &Visitor,
        now: u64,
        asleep: bool,
        size: Size,
        scale: f64,
        dark: bool,
        reduced: bool,
        coco: bool,
    ) {
        let pixel = size.pixel() && !coco;
        let (Some(art), Some(sample)) = (
            self.visitors.get(visitor.kind.as_str()),
            visitor.sample(now, asleep, pixel, reduced),
        ) else {
            return;
        };
        // His frames: the painted band frame is 151 x 128, the pixel one 35 x 32; Coco's canvas is 234 x 241.
        let (grid_w, grid_h) = if coco {
            (234., 241.)
        } else if pixel {
            (35., 32.)
        } else {
            (151., 128.)
        };
        let (ox, oy, ok) = match (coco, visitor.kind.as_str()) {
            (false, _) => (0., 0., 1.),
            (true, "note") => (166.4, 32., 1.45),
            (true, _) => (16.4, 32., 1.45),
        };
        let (x, y, k) = if pixel {
            (art.pixel.0, art.pixel.1, 1.)
        } else {
            art.band
        };
        let (x0, y0) = canvas.frame_grid_point(ox + x * ok, oy + y * ok, grid_w, grid_h);
        let (x1, y1) = canvas.frame_grid_point(
            ox + (x + art.w * k) * ok,
            oy + (y + art.h * k) * ok,
            grid_w,
            grid_h,
        );
        let (sx, sy) = ((x1 - x0) / art.w, (y1 - y0) / art.h);
        let shift = sample.dy * scale;
        let place = |v: f64| if pixel { v.round() } else { v };
        if let Some(glow) = art.glow.as_ref().filter(|_| dark) {
            let (r, image) = if pixel { &glow.pixel } else { &glow.band };
            // One glow pixel is one frame pixel; the sprite's art pixel is k of them.
            let unit = sy / k;
            canvas.overlay(
                image,
                place(x0 + glow.centre.0 * sx - r * unit),
                place(y0 + glow.centre.1 * sy - r * unit + shift),
                unit,
                sample.opacity,
                0.,
                None,
            );
        }
        canvas.overlay_axes(
            if dark { &art.dark } else { &art.light },
            place(x0),
            place(y0 + shift),
            sx,
            sy,
            sample.opacity,
            0.,
            None,
        );
    }
    pub fn has_visitor(&self, kind: &str) -> bool {
        self.visitors.contains_key(kind)
    }
    pub fn helpers(
        &self,
        canvas: &mut Canvas,
        helpers: &[Helper],
        now: u64,
        size: Size,
        scale: f64,
        dark: bool,
        reduced: bool,
        left: bool,
    ) {
        self.helpers_on_ledge(
            canvas, helpers, now, size, scale, dark, reduced, left, false,
        );
    }
    #[allow(clippy::too_many_arguments)]
    pub fn helpers_on_ledge(
        &self,
        canvas: &mut Canvas,
        helpers: &[Helper],
        now: u64,
        size: Size,
        scale: f64,
        dark: bool,
        reduced: bool,
        left: bool,
        on_ledge: bool,
    ) {
        let visible = visible_helpers(helpers, now);
        let bundle = visible.len() >= 5;
        let shown = helper_slots(visible.len());
        let h = size.height() / 96.;
        let (_, _, w, height) = canvas.sprite_bounds;
        let (x, y) = canvas.frame_point(0., 0.);
        let art = (height as f64 / 32.).floor().max(1.);
        let bottom = y + height as f64 - if on_ledge { height as f64 * 0.05 } else { 0. };
        let piece_height = if size.pixel() {
            10. * art
        } else {
            20. * h * scale
        };
        let edge = canvas
            .sprite_silhouette_edge(bottom - piece_height, bottom, left)
            .unwrap_or(if left { x } else { x + w as f64 });
        let gap = if size.pixel() { 3. * art } else { 6. * scale };
        let pitch = if size.pixel() {
            7. * art
        } else {
            14. * h * scale
        };
        for (i, helper) in visible.iter().take(shown).enumerate() {
            let sample = if size.pixel() {
                helper.pixel_sample(now, i as u64 * 260)
            } else {
                helper.sample(now, i as u64 * 260, reduced)
            };
            let image = if size.pixel() {
                std::sync::Arc::new(self.images["scroll-tiny.png"].clone())
            } else {
                let bytes = &self.vectors[if dark { "scroll-dark" } else { "scroll-light" }];
                let Ok(image) = crate::ui::vector_image(bytes, 10. * h, 20. * h, scale) else {
                    continue;
                };
                image
            };
            let ratio = if size.pixel() { art } else { 1. };
            let width = image.width as f64 * ratio;
            let px = if left {
                edge - gap - i as f64 * pitch - width
            } else {
                edge + gap + i as f64 * pitch
            };
            let py = bottom - image.height as f64 * ratio * sample.sy + sample.dy * scale;
            canvas.overlay_axes(
                &image,
                if size.pixel() { px.round() } else { px },
                if size.pixel() { py.round() } else { py },
                ratio,
                ratio * sample.sy,
                sample.opacity,
                sample.degrees,
                None,
            );
        }
        if bundle {
            let image = if size.pixel() {
                std::sync::Arc::new(self.images["bundle-pixel.png"].clone())
            } else {
                let bytes = &self.vectors[if dark { "bundle-dark" } else { "bundle-light" }];
                let Ok(image) = crate::ui::vector_image(bytes, 17. * h, 20. * h, scale) else {
                    return;
                };
                image
            };
            let ratio = if size.pixel() { art } else { 1. };
            let width = image.width as f64 * ratio;
            let px = if left {
                edge - gap - 3. * pitch - width
            } else {
                edge + gap + 3. * pitch
            };
            canvas.overlay(
                &image,
                if size.pixel() { px.round() } else { px },
                if size.pixel() {
                    (bottom - image.height as f64 * ratio).round()
                } else {
                    bottom - image.height as f64 * ratio
                },
                ratio,
                1.,
                0.,
                None,
            );
        }
    }
    /// Approved lanterns, supplied opt-in snapshots only; no neighbour application reads.
    #[allow(clippy::too_many_arguments)]
    pub fn neighbours(
        &self,
        canvas: &mut Canvas,
        lights: &[NeighbourLight],
        now: u64,
        size: Size,
        scale: f64,
        dark: bool,
        reduced: bool,
        left: bool,
        enabled: bool,
    ) {
        if !enabled {
            return;
        }
        let shown = selected_neighbours(lights, now, size.pixel());
        let Some(light) = shown.first() else {
            return;
        };
        let (_, _, w, h) = canvas.sprite_bounds;
        let (x, y) = canvas.frame_point(0., 0.);
        let art = (h as f64 / 32.).floor().max(1.);
        let width = if size.pixel() { 7. * art } else { 0.19 * h as f64 };
        let height = if size.pixel() { 10. * art } else { 0.27 * h as f64 };
        let base_y = if size.pixel() {
            canvas.frame_grid_point(0., 15., 35., 32.).1
        } else {
            y + 0.32 * h as f64
        };
        // The arrival rise never changes where the lantern stands beside him.
        let edge = canvas.sprite_silhouette_edge(base_y, base_y + height, left);
        if size.pixel() && edge.is_none() {
            return;
        }
        let edge = edge.unwrap_or(if left { x } else { x + w as f64 });
        let gap = if size.pixel() { 3. * art } else { 6. * scale };
        let (opacity, dy, lit) = if size.pixel() {
            light.pixel_sample(now)
        } else {
            light.sample(now, reduced)
        };
        let py = if size.pixel() {
            canvas.frame_grid_point(0., 15., 35., 32.).1
        } else {
            y + 0.32 * h as f64 + dy * scale
        };
        let px = if left { edge - gap - width } else { edge + gap };
        if size.pixel() {
            let image = &self.images[if lit > 0. {
                "lantern-pixel-lit.png"
            } else {
                "lantern-pixel-unlit.png"
            }];
            canvas.overlay(image, px.round(), py.round(), art, opacity, 0., None);
            return;
        }
        let theme = if dark { "dark" } else { "light" };
        let Ok(off) = crate::ui::vector_image(
            &self.vectors[&format!("lantern-{theme}-unlit")],
            width / scale,
            height / scale,
            scale,
        ) else {
            return;
        };
        let Ok(on) = crate::ui::vector_image(
            &self.vectors[&format!("lantern-{theme}-lit")],
            width / scale,
            height / scale,
            scale,
        ) else {
            return;
        };
        let blended;
        let image = if lit <= 0. {
            &*off
        } else if lit >= 1. {
            &*on
        } else {
            blended = Image {
                width: on.width,
                height: on.height,
                pixels: off
                    .pixels
                    .iter()
                    .zip(&on.pixels)
                    .map(|(a, b)| (*a as f64 * (1. - lit) + *b as f64 * lit).round() as u8)
                    .collect(),
            };
            &blended
        };
        canvas.overlay(image, px, py, 1., opacity, 0., None);
    }
}

pub fn helper_x(
    x: f64,
    width: f64,
    scroll_width: f64,
    index: usize,
    height_factor: f64,
    scale: f64,
    left: bool,
) -> f64 {
    let gap = 6. * scale + index as f64 * 14. * height_factor * scale;
    if left {
        x - gap - scroll_width
    } else {
        x + width + gap
    }
}
/// The Activity row's approved 6 x 22 pt ribbon, generated from pieces.py.
pub fn draw_ribbon(canvas: &mut Canvas, index: u8, x: f64, y: f64, scale: f64, dark: bool) {
    const SVG: [[&[u8]; 14]; 2] = [
        [
            include_bytes!("../assets/decor/ribbon-light-0-6.svg"),
            include_bytes!("../assets/decor/ribbon-light-1-6.svg"),
            include_bytes!("../assets/decor/ribbon-light-2-6.svg"),
            include_bytes!("../assets/decor/ribbon-light-3-6.svg"),
            include_bytes!("../assets/decor/ribbon-light-4-6.svg"),
            include_bytes!("../assets/decor/ribbon-light-5-6.svg"),
            include_bytes!("../assets/decor/ribbon-light-6-6.svg"),
            include_bytes!("../assets/decor/ribbon-light-7-6.svg"),
            include_bytes!("../assets/decor/ribbon-light-8-6.svg"),
            include_bytes!("../assets/decor/ribbon-light-9-6.svg"),
            include_bytes!("../assets/decor/ribbon-light-10-6.svg"),
            include_bytes!("../assets/decor/ribbon-light-11-6.svg"),
            include_bytes!("../assets/decor/ribbon-light-12-6.svg"),
            include_bytes!("../assets/decor/ribbon-light-13-6.svg"),
        ],
        [
            include_bytes!("../assets/decor/ribbon-dark-0-6.svg"),
            include_bytes!("../assets/decor/ribbon-dark-1-6.svg"),
            include_bytes!("../assets/decor/ribbon-dark-2-6.svg"),
            include_bytes!("../assets/decor/ribbon-dark-3-6.svg"),
            include_bytes!("../assets/decor/ribbon-dark-4-6.svg"),
            include_bytes!("../assets/decor/ribbon-dark-5-6.svg"),
            include_bytes!("../assets/decor/ribbon-dark-6-6.svg"),
            include_bytes!("../assets/decor/ribbon-dark-7-6.svg"),
            include_bytes!("../assets/decor/ribbon-dark-8-6.svg"),
            include_bytes!("../assets/decor/ribbon-dark-9-6.svg"),
            include_bytes!("../assets/decor/ribbon-dark-10-6.svg"),
            include_bytes!("../assets/decor/ribbon-dark-11-6.svg"),
            include_bytes!("../assets/decor/ribbon-dark-12-6.svg"),
            include_bytes!("../assets/decor/ribbon-dark-13-6.svg"),
        ],
    ];
    if let Ok(image) =
        crate::ui::vector_image(SVG[usize::from(dark)][index as usize % 14], 6., 22., scale)
    {
        canvas.overlay(&image, x * scale, y * scale, 1., 1., 0., None);
    }
}
