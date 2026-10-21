//! Shake and spin, from the carry's own pointer events. No timer: the detector reads the
//! positions the drag already reports, and the spin is a pure function of time.

/// How far one swing must reach to count as a reversal, in points.
pub const SWING: f64 = 20.0;
/// Three reversals inside this window are a shake.
pub const WINDOW_MS: u64 = 800;
pub const REVERSALS: usize = 3;
/// A second shake inside this time does not spin him again; he holds his book tight.
pub const AGAIN_MS: u64 = 8_000;
/// Four half-turns of the spin, slowing, and the dizzy sway after them.
pub const HALF_TURNS: [f64; 4] = [200.0, 220.0, 260.0, 320.0];
pub const SPIN_MS: f64 = 1000.0;
pub const DIZZY_MS: f64 = 1300.0;
/// With Reduce Motion: a cut to the flustered face for this long, and the line.
pub const STILL_MS: u64 = 1_200;

#[derive(Clone, Copy, Debug, Default)]
struct Axis {
    extreme: f64,
    dir: i8,
    seen: bool,
}

#[derive(Clone, Debug, Default)]
pub struct ShakeDetector {
    axes: [Axis; 2],
    reversals: [Vec<u64>; 2],
    fired: bool,
}

impl ShakeDetector {
    pub fn reset(&mut self) {
        *self = Self::default();
    }
    /// One pointer position of the carry. True once per carry, when the shake is complete.
    pub fn feed(&mut self, point: [f64; 2], now: u64) -> bool {
        if self.fired || !point[0].is_finite() || !point[1].is_finite() {
            return false;
        }
        for axis in 0..2 {
            let value = point[axis];
            let state = &mut self.axes[axis];
            if !state.seen {
                *state = Axis {
                    extreme: value,
                    dir: 0,
                    seen: true,
                };
                continue;
            }
            let moved = value - state.extreme;
            if state.dir == 0 {
                if moved.abs() >= SWING {
                    state.dir = if moved > 0.0 { 1 } else { -1 };
                    state.extreme = value;
                }
                continue;
            }
            if moved * f64::from(state.dir) > 0.0 {
                state.extreme = value;
            } else if moved.abs() >= SWING {
                state.dir = -state.dir;
                state.extreme = value;
                let times = &mut self.reversals[axis];
                times.push(now);
                times.retain(|at| now.saturating_sub(*at) <= WINDOW_MS);
                if times.len() >= REVERSALS {
                    self.fired = true;
                    return true;
                }
            }
        }
        false
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct SpinSample {
    pub frame: &'static str,
    pub sx: f64,
    /// tan of the sway angle: the picture's skew stands for a few degrees of tilt.
    pub skew: f64,
}

fn ease_in(t: f64) -> f64 {
    t * t
}
fn ease_out(t: f64) -> f64 {
    1.0 - (1.0 - t) * (1.0 - t)
}

/// The spin and the dizzy sway at `t` ms after the shake. Never a mirrored front: the bow stays
/// on its own side, so the picture only narrows to an edge and widens as his back (or, until the
/// back is drawn, his flustered face again). `back` and `dizzy` name frames that exist.
pub fn spin_sample(t: f64, back: bool, dizzy: bool) -> SpinSample {
    let front = "flustered";
    let behind = if back { "spin-back" } else { front };
    let end = if dizzy { "dizzy" } else { front };
    if t < SPIN_MS {
        let mut start = 0.0;
        for (index, length) in HALF_TURNS.iter().enumerate() {
            if t < start + length {
                let u = (t - start) / length;
                let (sx, past_edge) = if u < 0.5 {
                    (1.0 - 0.94 * ease_in(u * 2.0), false)
                } else {
                    (0.06 + 0.94 * ease_out(u * 2.0 - 1.0), true)
                };
                let showing_back = (index % 2 == 0) == past_edge;
                return SpinSample {
                    frame: if showing_back { behind } else { front },
                    sx,
                    skew: 0.0,
                };
            }
            start += length;
        }
    }
    let d = (t - SPIN_MS).max(0.0);
    // Sways of 3.5, 2 and 1 degrees, each a slow half cycle, the existing flustered sway's shape.
    let third = DIZZY_MS / 3.0;
    let (amplitude, local) = if d < third {
        (3.5, d)
    } else if d < 2.0 * third {
        (2.0, d - third)
    } else {
        (1.0, d - 2.0 * third)
    };
    let angle: f64 = amplitude * (local / third * std::f64::consts::TAU).sin();
    SpinSample {
        frame: end,
        sx: 1.0,
        skew: angle.to_radians().tan(),
    }
}

/// How long the whole spin lasts, spin and dizzy together.
pub fn spin_total_ms(reduce_motion: bool) -> u64 {
    if reduce_motion {
        STILL_MS
    } else {
        (SPIN_MS + DIZZY_MS) as u64
    }
}

/// The lid: asleep from the system's sleep notice until he is back (the unlock, or two seconds
/// after the system woke when the screen was never locked), then 1.2 s more asleep, then the wake.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Nap {
    pub woke_at: Option<u64>,
    pub locked: bool,
    pub wake_at: Option<u64>,
}

pub const NAP_SETTLE_MS: u64 = 2_000;
pub const NAP_HOLD_MS: u64 = 1_200;

impl Nap {
    pub fn begin() -> Self {
        Self {
            woke_at: None,
            locked: false,
            wake_at: None,
        }
    }
    /// The system woke. A locked screen waits for the unlock; otherwise he wakes after two seconds and the hold.
    pub fn system_woke(&mut self, now: u64, locked: bool) {
        self.woke_at = Some(now);
        self.locked = locked;
        self.wake_at = if locked {
            None
        } else {
            Some(now + NAP_SETTLE_MS + NAP_HOLD_MS)
        };
    }
    pub fn unlocked(&mut self, now: u64) {
        if self.woke_at.is_some() && self.locked {
            self.locked = false;
            self.wake_at = Some(now + NAP_HOLD_MS);
        }
    }
}
