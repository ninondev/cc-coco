//! Native placement geometry, translated from the approved Swift Place rules.
use crate::motion::{PlaceMode, ScreenRect};

#[derive(Clone, Copy, Debug)]
pub struct Placement {
    pub frame: ScreenRect,
    pub mode: PlaceMode,
    pub room: f64,
    pub horizontal: bool,
    pub push_sign: f64,
}
fn bounded(value: f64, low: f64, high: f64) -> f64 {
    value.clamp(low, high.max(low))
}
fn contains(area: ScreenRect, frame: ScreenRect) -> bool {
    frame.x >= area.x
        && frame.y >= area.y
        && frame.right() <= area.right()
        && frame.bottom() <= area.bottom()
}
pub fn supported_image(path: &str) -> bool {
    path.rsplit(['\\', '/']).next().is_some_and(|name| {
        name.eq_ignore_ascii_case("Claude.exe") || name.eq_ignore_ascii_case("Code.exe")
    })
}
pub fn session_locked(flags: i32) -> Option<bool> {
    match flags {
        0 => Some(true),
        1 => Some(false),
        _ => None,
    }
}
pub fn host_clip(
    mode: PlaceMode,
    host: Option<ScreenRect>,
    origin: [f64; 2],
    size: [f64; 2],
) -> Option<ScreenRect> {
    if mode != PlaceMode::Ledge {
        return None;
    }
    let host = host?;
    let local = ScreenRect {
        x: host.x - origin[0],
        y: host.y - origin[1],
        width: host.width,
        height: host.height,
    };
    let clip = local.intersection(ScreenRect {
        x: 0.,
        y: 0.,
        width: size[0],
        height: size[1],
    });
    (clip.width > 0. && clip.height > 0.).then_some(clip)
}
/// A failed optional HUD stays behind the host for this continuous eligible interval.
#[derive(Default)]
pub struct FrontPageGate {
    failed: bool,
}
impl FrontPageGate {
    pub fn may_present(&mut self, eligible: bool) -> bool {
        if !eligible {
            self.failed = false;
        }
        eligible && !self.failed
    }
    pub fn failed(&mut self) {
        self.failed = true;
    }
}
/// Preserve the page-only layer solely where the main ledge layer is occluded.
/// Coordinates are native canvas pixels; the original page canvas is unchanged.
pub fn front_page_mask(
    width: u32,
    height: u32,
    pixels: &[u8],
    clip: ScreenRect,
) -> Option<Vec<u8>> {
    let len = (width as usize)
        .checked_mul(height as usize)?
        .checked_mul(4)?;
    if pixels.len() != len
        || width == 0
        || height == 0
        || ![clip.x, clip.y, clip.width, clip.height]
            .into_iter()
            .all(f64::is_finite)
        || clip.width <= 0.
        || clip.height <= 0.
    {
        return None;
    }
    let mut out = vec![0; len];
    let mut visible = false;
    for (index, pixel) in pixels.chunks_exact(4).enumerate() {
        let x = (index % width as usize) as f64;
        let y = (index / width as usize) as f64;
        if pixel[3] != 0 && x >= clip.x && x < clip.right() && y >= clip.y && y < clip.bottom() {
            out[index * 4..index * 4 + 4].copy_from_slice(pixel);
            visible = true;
        }
    }
    visible.then_some(out)
}
fn contact(
    mut place: Placement,
    area: ScreenRect,
    screen: ScreenRect,
    target: Option<ScreenRect>,
) -> Placement {
    place.room = 1.;
    place.horizontal = false;
    place.push_sign = 1.;
    if let Some(window) = target {
        match place.mode {
            PlaceMode::Ledge => {
                place.room = (place.frame.bottom() - area.y - 2.) / place.frame.height.max(1.)
            }
            PlaceMode::BesideRight => {
                place.horizontal = true;
                place.room = if window.right() + 10. <= screen.right() - 2. - place.frame.width {
                    10.
                } else {
                    (screen.right() - window.right() - 2. - 4.) / place.frame.width.max(1.)
                };
            }
            PlaceMode::BesideLeft => {
                place.horizontal = true;
                place.push_sign = -1.;
                place.room = if window.x - 10. - place.frame.width >= screen.x + 2. {
                    10.
                } else {
                    (window.x - screen.x - 2. - 4.) / place.frame.width.max(1.)
                };
            }
            _ => {}
        }
    }
    place
}
pub fn place(
    area: ScreenRect,
    screen: ScreenRect,
    target: Option<ScreenRect>,
    size: [f64; 2],
    previous: Option<Placement>,
    live: bool,
    manual: Option<ScreenRect>,
) -> Placement {
    let (w, h) = (size[0], size[1]);
    let frame = |x, y| ScreenRect {
        x,
        y,
        width: w,
        height: h,
    };
    let make = |mode, frame| {
        contact(
            Placement {
                frame,
                mode,
                room: 1.,
                horizontal: false,
                push_sign: 1.,
            },
            area,
            screen,
            target,
        )
    };
    let free = || {
        let old = previous
            .map(|p| p.frame)
            .unwrap_or(frame(area.right() - w - 12., area.bottom() - h - 12.));
        make(
            PlaceMode::Free,
            frame(
                bounded(old.x, area.x, area.right() - w),
                bounded(old.y, area.y, area.bottom() - h),
            ),
        )
    };
    if let Some(manual) = manual {
        return make(PlaceMode::Manual, manual);
    }
    let Some(window) = target else {
        return make(
            PlaceMode::Corner,
            frame(area.right() - w - 12., area.bottom() - h - 12.),
        );
    };
    let fills = window.x <= area.x + 24.
        && window.right() >= area.right() - 24.
        && window.y <= area.y + 24.
        && window.bottom() >= area.bottom() - 24.;
    if fills && !live {
        return free();
    }
    if let Some(old) = previous {
        let retained = match old.mode {
            PlaceMode::Ledge => {
                let (low, high) = (window.x + 18., window.right() - 18. - w);
                let desired = bounded(window.right() - 64. - w, low, high);
                let (sl, sh) = (low.max(screen.x + 4.), high.min(screen.right() - 4. - w));
                Some(make(
                    old.mode,
                    frame(
                        if sl <= sh {
                            bounded(desired, sl, sh)
                        } else {
                            desired
                        },
                        window.y - h + (h * 0.05).round(),
                    ),
                ))
            }
            PlaceMode::BesideRight | PlaceMode::BesideLeft => {
                let x = if old.mode == PlaceMode::BesideRight {
                    (window.right() + 10.).min(screen.right() - 2. - w)
                } else {
                    (window.x - 10. - w).max(screen.x + 2.)
                };
                Some(make(
                    old.mode,
                    frame(
                        x,
                        bounded(
                            window.bottom().min(area.bottom()) - h,
                            area.y,
                            window.bottom().min(area.bottom()) - h,
                        ),
                    ),
                ))
            }
            PlaceMode::Below => Some(make(
                old.mode,
                frame(
                    bounded(
                        window.right() - 24. - w,
                        window.x.max(screen.x) + 8.,
                        window.right().min(screen.right()) - 8. - w,
                    ),
                    window.bottom() + 4.,
                ),
            )),
            PlaceMode::Free => Some(free()),
            _ => None,
        };
        if let Some(retained) = retained {
            let fits = match old.mode {
                PlaceMode::Ledge => {
                    retained.room >= 1.
                        && retained.frame.x >= screen.x
                        && retained.frame.right() <= screen.right()
                        && w + 36. <= window.width
                }
                PlaceMode::BesideRight | PlaceMode::BesideLeft => {
                    retained.room >= 1. && contains(area, retained.frame)
                }
                PlaceMode::Below => {
                    screen.bottom() - window.bottom() - 4. >= h * 0.75
                        && retained.frame.x >= screen.x
                        && retained.frame.right() <= screen.right()
                }
                _ => contains(area, retained.frame),
            };
            if live || fits {
                return retained;
            }
        }
    }
    let sink = (h * 0.05).round();
    let was_ledge = previous.is_some_and(|p| p.mode == PlaceMode::Ledge);
    if window.y - area.y >= h - sink + if was_ledge { 2. } else { 6. } {
        return make(
            PlaceMode::Ledge,
            frame(
                bounded(
                    window.right() - 64. - w,
                    window.x + 18.,
                    window.right() - 18. - w,
                ),
                window.y - h + sink,
            ),
        );
    }
    if area.right() - window.right() >= w + 20. || window.x - area.x >= w + 20. {
        let right = area.right() - window.right() >= w + 20.;
        return make(
            if right {
                PlaceMode::BesideRight
            } else {
                PlaceMode::BesideLeft
            },
            frame(
                if right {
                    window.right() + 10.
                } else {
                    window.x - 10. - w
                },
                bounded(
                    window.bottom().min(area.bottom()) - h,
                    area.y,
                    window.bottom().min(area.bottom()) - h,
                ),
            ),
        );
    }
    if screen.bottom() - window.bottom() - 4. >= h * 0.75 {
        return make(
            PlaceMode::Below,
            frame(
                bounded(
                    window.right() - 24. - w,
                    window.x.max(screen.x) + 8.,
                    window.right().min(screen.right()) - 8. - w,
                ),
                window.bottom() + 4.,
            ),
        );
    }
    free()
}
