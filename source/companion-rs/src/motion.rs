use serde::{Deserialize, Serialize};

/// Pet.swift's picture-layer [1, strokeY / pressY, 1] keyframes, starting at 520 ms.
pub fn pat_stroke(ms: f64) -> f64 {
    if !(520.0..880.0).contains(&ms) {
        return 1.;
    }
    let low = 0.962 / 0.970;
    let u = (ms - 520.) / 180.;
    if u <= 1. {
        1. * (1. - u) + low * u
    } else {
        low * (2. - u) + (u - 1.)
    }
}

/// Platform fallback for compositor-free motion. Maintenance deadlines are separate.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SettleRule {
    pub last_event: u64,
}

/// CompanionRig's local pointer bands. Restoring is delayed, approaching is immediate.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord)]
pub enum PointerBand {
    #[default]
    Far,
    Near,
    Over,
}
impl PointerBand {
    /// Under a contrast request or reduced transparency the fade is all or nothing: his line stays
    /// whole while the pointer is near and steps out of the way only while it is on the line.
    fn alpha(self, solid: bool) -> f64 {
        match (self, solid) {
            (Self::Far, _) | (Self::Near, true) => 1.,
            (Self::Near, false) => 0.45,
            (Self::Over, true) => 0.,
            (Self::Over, false) => 0.12,
        }
    }
}
#[derive(Clone, Debug)]
pub struct PointerFade {
    band: PointerBand,
    wanted: PointerBand,
    restore_at: Option<u64>,
    from: f64,
    changed_at: u64,
    duration: u64,
    solid: bool,
}

/// Transform component continuation used by the reference's press/release animations.
#[derive(Clone, Copy, Debug)]
pub struct PressTransform {
    pub sx: f64,
    pub sy: f64,
    pub skew: f64,
}
impl PressTransform {
    pub fn sample(from: Self, ms: f64, repeat: bool) -> Self {
        let p = crate::decor::curve([0., 0., 0.2, 1.], ms / 260.);
        let lean = crate::decor::curve([0.37, 0., 0.63, 1.], ms / 320.);
        let first_y = from.sy * 0.997 + if repeat { -0.01 } else { 0. };
        Self {
            sx: from.sx + (1.009 - from.sx) * p,
            sy: first_y + (0.970 - first_y) * p,
            skew: from.skew + (1f64.to_radians().tan() - from.skew) * lean,
        }
    }
    pub fn release(from: Self, ms: f64) -> Self {
        Self {
            sx: 1. + crate::decor::spring(from.sx - 1., ms, 0.5, 180., 13.),
            sy: 1. + crate::decor::spring(from.sy - 1., ms, 0.5, 180., 13.),
            skew: crate::decor::spring(from.skew, ms, 0.5, 180., 13.),
        }
    }
    pub fn impulse(ms: f64) -> f64 {
        crate::decor::spring(-0.01, ms, 0.5, 260., 9.)
    }
}

/// Exact cuts of TouchSequence.swift for the native Press → release lifecycle.
pub fn touch_sequence(
    key: &str,
    base: &str,
    ms: u64,
    reduced: bool,
    available: impl Fn(&str) -> bool,
) -> (String, String) {
    let pose = |name: &str| {
        if available(name) {
            name.to_owned()
        } else {
            base.to_owned()
        }
    };
    match key {
        "pat" => (
            base.to_owned(),
            if reduced {
                if ms < 260 {
                    "closed"
                } else if ms < 1400 {
                    "smile"
                } else {
                    "open"
                }
            } else if ms < 40 {
                "open"
            } else if ms < 120 {
                "half"
            } else if ms < 260 {
                "closed"
            } else if ms < 1250 {
                "smile"
            } else if ms < 1340 {
                "half"
            } else {
                "open"
            }
            .into(),
        ),
        "flustered" => {
            let name = if ms < 55 {
                base.to_owned()
            } else if ms < 380 {
                pose("flustered")
            } else if ms < 480 || !available("shiori-b") {
                pose("shiori-a")
            } else {
                pose("shiori-b")
            };
            if ms >= 1750 {
                (base.to_owned(), "squeeze".into())
            } else {
                (name, "open".into())
            }
        }
        "drag" => (
            if ms < 33 {
                base.to_owned()
            } else if ms < 180 {
                pose("error")
            } else {
                pose("refuse")
            },
            "open".into(),
        ),
        "hold" => (
            if ms < 55 {
                base.to_owned()
            } else {
                pose("refuse")
            },
            "open".into(),
        ),
        "drop" => (
            base.to_owned(),
            if (55..1000).contains(&ms) {
                "closed"
            } else {
                "open"
            }
            .into(),
        ),
        "wave" | "thanks" => (
            if ms < 55 {
                base.to_owned()
            } else {
                pose(if key == "wave" { "wave" } else { "happy" })
            },
            "open".into(),
        ),
        _ => (base.to_owned(), "open".into()),
    }
}
impl Default for PointerFade {
    fn default() -> Self {
        Self {
            band: PointerBand::Far,
            wanted: PointerBand::Far,
            restore_at: None,
            from: 1.,
            changed_at: 0,
            duration: 0,
            solid: false,
        }
    }
}
impl PointerFade {
    /// Switch between the soft fade and the all-or-nothing fade. The timings stay.
    pub fn set_solid(&mut self, solid: bool, now: u64) {
        if self.solid != solid {
            self.from = self.opacity(now);
            self.solid = solid;
            self.changed_at = now;
            self.duration = 90;
        }
    }
    pub fn update(&mut self, distance: f64, deliberate: bool, now: u64) {
        let mut next = if distance <= 8. || self.band == PointerBand::Over && distance <= 20. {
            PointerBand::Over
        } else if distance <= 40. || self.band != PointerBand::Far && distance <= 52. {
            PointerBand::Near
        } else {
            PointerBand::Far
        };
        let quick = deliberate && next == PointerBand::Near;
        if quick {
            next = PointerBand::Far;
        }
        self.wanted = next;
        if next > self.band || quick && next < self.band {
            self.change(next, now);
            self.restore_at = None;
        } else if next < self.band {
            self.restore_at.get_or_insert(now + 250);
            self.advance(now);
        } else {
            self.restore_at = None;
        }
    }
    fn change(&mut self, band: PointerBand, now: u64) {
        self.from = self.opacity(now);
        self.duration = if band > self.band { 90 } else { 240 };
        self.changed_at = now;
        self.band = band;
    }
    pub fn advance(&mut self, now: u64) {
        if let Some(at) = self.restore_at.filter(|at| now >= *at) {
            self.change(self.wanted, at);
            self.restore_at = None;
        }
    }
    pub fn opacity(&self, now: u64) -> f64 {
        let t = if self.duration == 0 {
            1.
        } else {
            now.saturating_sub(self.changed_at) as f64 / self.duration as f64
        };
        let points = if self.band.alpha(self.solid) < self.from {
            [0., 0., 0.2, 1.]
        } else {
            [0.37, 0., 0.63, 1.]
        };
        self.from + (self.band.alpha(self.solid) - self.from) * crate::decor::curve(points, t)
    }
    pub fn band(&self) -> PointerBand {
        self.band
    }
    pub fn next_deadline(&self, now: u64) -> Option<u64> {
        let animation = (now < self.changed_at + self.duration)
            .then_some((now + 16).min(self.changed_at + self.duration));
        animation
            .into_iter()
            .chain(self.restore_at.filter(|at| *at > now))
            .min()
    }
}
impl SettleRule {
    pub const WINDOW_MS: u64 = 60_000;
    pub fn new(now: u64) -> Self {
        Self { last_event: now }
    }
    pub fn event(&mut self, now: u64) {
        self.last_event = self.last_event.max(now);
    }
    pub fn moves(&self, now: u64, held: bool, visible: bool, asleep: bool) -> bool {
        visible && !asleep && (held || now < self.last_event.saturating_add(Self::WINDOW_MS))
    }
    pub fn filter_deadline(&self, now: u64, next: u64, held: bool) -> Option<u64> {
        (next > now && (held || next < self.last_event.saturating_add(Self::WINDOW_MS)))
            .then_some(next)
    }
}

#[derive(Clone, Debug)]
pub struct SeededRandom {
    value: u32,
}
impl SeededRandom {
    pub fn new(seed: u32) -> Self {
        Self {
            value: if seed == 0 { 1 } else { seed },
        }
    }
    pub fn next_f64(&mut self) -> f64 {
        self.value ^= self.value << 13;
        self.value ^= self.value >> 17;
        self.value ^= self.value << 5;
        f64::from(self.value) / 4_294_967_296.0
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Hold {
    pub median: f64,
    pub sigma: f64,
    pub min: f64,
    pub max: f64,
}
impl Hold {
    pub fn sample(&self, rng: &mut SeededRandom) -> f64 {
        let normal = (-2.0 * rng.next_f64().max(f64::from_bits(1)).ln()).sqrt()
            * (2.0 * std::f64::consts::PI * rng.next_f64()).cos();
        (self.median * (self.sigma * normal).exp()).clamp(self.min, self.max)
    }
    fn valid(&self) -> bool {
        self.median.is_finite()
            && self.sigma.is_finite()
            && self.min.is_finite()
            && self.max.is_finite()
            && self.min > 0.0
            && self.max >= self.min
            && (self.min..=self.max).contains(&self.median)
            && (0.0..=2.0).contains(&self.sigma)
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Blink {
    pub interval: Hold,
    pub shut: Hold,
    pub double_chance: f64,
    pub double_gap: Hold,
    pub gaze_chance: f64,
    pub gaze_delay: Hold,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Burst {
    pub min: u32,
    pub max: u32,
    pub pause: Hold,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MotionModel {
    pub version: u32,
    pub sequence_ms: f64,
    pub blink: Blink,
    pub think: Hold,
    pub work: Hold,
    pub wild: Hold,
    pub work_burst: Burst,
}
impl Default for MotionModel {
    fn default() -> Self {
        serde_json::from_str(DEFAULT_JSON).expect("constant motion model")
    }
}
impl MotionModel {
    pub fn valid(&self) -> bool {
        self.version == 1
            && (180_000.0..=600_000.0).contains(&self.sequence_ms)
            && [
                self.blink.interval,
                self.blink.shut,
                self.blink.double_gap,
                self.blink.gaze_delay,
                self.think,
                self.work,
                self.wild,
                self.work_burst.pause,
            ]
            .iter()
            .all(Hold::valid)
            && (0.0..=1.0).contains(&self.blink.double_chance)
            && (0.0..=1.0).contains(&self.blink.gaze_chance)
            && self.work_burst.min >= 1
            && self.work_burst.max <= 20
            && self.work_burst.min <= self.work_burst.max
    }
    pub fn gaze_blink_delay(&self, rng: &mut SeededRandom) -> Option<f64> {
        if rng.next_f64() < self.blink.gaze_chance {
            Some(self.blink.gaze_delay.sample(rng))
        } else {
            None
        }
    }
    pub fn blink_double(&self, rng: &mut SeededRandom) -> bool {
        rng.next_f64() < self.blink.double_chance
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MotionKind {
    Think,
    Work,
    Wild,
}
impl MotionKind {
    pub fn from_mood(mood: &str) -> Option<Self> {
        match mood {
            "think" => Some(Self::Think),
            "work" => Some(Self::Work),
            "wild" => Some(Self::Wild),
            _ => None,
        }
    }
}
#[derive(Clone, Debug)]
pub struct MotionCycle {
    kind: MotionKind,
    model: MotionModel,
    changes: u32,
    left: u32,
}
impl MotionCycle {
    pub fn new(kind: MotionKind, model: &MotionModel, rng: &mut SeededRandom) -> Self {
        let left = if kind == MotionKind::Work {
            Self::burst(model, rng)
        } else {
            0
        };
        Self {
            kind,
            model: model.clone(),
            changes: 0,
            left,
        }
    }
    fn burst(model: &MotionModel, rng: &mut SeededRandom) -> u32 {
        model.work_burst.min
            + (rng.next_f64() * f64::from(model.work_burst.max - model.work_burst.min + 1)).floor()
                as u32
    }
    pub fn next(&mut self, rng: &mut SeededRandom) -> f64 {
        if self.kind == MotionKind::Work {
            let old = self.changes;
            self.changes += 1;
            if old >= self.left {
                self.changes = 0;
                self.left = Self::burst(&self.model, rng);
                return self.model.work_burst.pause.sample(rng);
            }
        }
        match self.kind {
            MotionKind::Think => self.model.think,
            MotionKind::Work => self.model.work,
            MotionKind::Wild => self.model.wild,
        }
        .sample(rng)
    }
}
#[derive(Clone, Debug, PartialEq)]
pub struct Timeline {
    pub changes: Vec<(f64, bool)>,
    pub duration_ms: f64,
}
impl Timeline {
    pub fn looping(model: &MotionModel, kind: MotionKind, rng: &mut SeededRandom) -> Self {
        let mut cycle = MotionCycle::new(kind, model, rng);
        let mut changes = vec![(0.0, false)];
        let mut time = 0.0;
        let mut second = false;
        loop {
            let next = time + cycle.next(rng);
            if !next.is_finite() || next <= time || changes.len() >= 65_536 {
                time = model.sequence_ms;
                break;
            }
            time = next;
            if time >= model.sequence_ms {
                break;
            }
            second = !second;
            changes.push((time, second));
        }
        changes.push((time, second));
        Self {
            changes,
            duration_ms: time,
        }
    }
    pub fn idle(model: &MotionModel, gaze: bool, rng: &mut SeededRandom) -> Self {
        let mut changes = vec![(0.0, false)];
        let mut time = if gaze && rng.next_f64() < model.blink.gaze_chance {
            model.blink.gaze_delay.sample(rng)
        } else {
            model.blink.interval.sample(rng)
        };
        while time < model.sequence_ms {
            if changes.len() >= 65_532 {
                time = model.sequence_ms;
                break;
            }
            let previous = time;
            changes.push((time, true));
            time += model.blink.shut.sample(rng);
            changes.push((time, false));
            if model.blink_double(rng) {
                time += model.blink.double_gap.sample(rng);
                changes.push((time, true));
                time += model.blink.shut.sample(rng);
                changes.push((time, false));
            }
            time += model.blink.interval.sample(rng);
            if !time.is_finite() || time <= previous {
                time = model.sequence_ms;
                break;
            }
        }
        changes.push((time, false));
        Self {
            changes,
            duration_ms: time,
        }
    }
    pub fn second_at(&self, elapsed_ms: f64) -> bool {
        let t = elapsed_ms.rem_euclid(self.duration_ms);
        self.changes
            .iter()
            .take_while(|(at, _)| *at <= t)
            .last()
            .map(|(_, second)| *second)
            .unwrap_or(false)
    }
    pub fn next_change_ms(&self, elapsed_ms: f64) -> f64 {
        let cycles = (elapsed_ms / self.duration_ms).floor();
        let t = elapsed_ms.rem_euclid(self.duration_ms);
        let next = self
            .changes
            .iter()
            .find(|(at, _)| *at > t)
            .map(|(at, _)| *at)
            .unwrap_or(self.duration_ms);
        cycles * self.duration_ms + next
    }
}
pub const DEFAULT_JSON: &str = r#"{"version":1,"sequenceMs":180000,"blink":{"interval":{"median":5000,"sigma":0.54,"min":1200,"max":20000},"shut":{"median":130,"sigma":0.12,"min":100,"max":160},"doubleChance":0.08333333333333333,"doubleGap":{"median":210,"sigma":0.22,"min":150,"max":300},"gazeChance":0.5,"gazeDelay":{"median":245,"sigma":0.3,"min":150,"max":400}},"think":{"median":1400,"sigma":0.36,"min":800,"max":2600},"work":{"median":330,"sigma":0.25,"min":220,"max":500},"wild":{"median":200,"sigma":0.3,"min":120,"max":320},"workBurst":{"min":3,"max":8,"pause":{"median":1265,"sigma":0.28,"min":800,"max":2000}}}"#;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ClingSample {
    pub lean: f64,
    pub sx: f64,
    pub sy: f64,
    pub vx: f64,
    pub vy: f64,
}
#[derive(Clone, Debug)]
pub struct Cling {
    state: [f64; 6],
    anchor: Option<[f64; 2]>,
    last: Option<f64>,
    geometry: Option<f64>,
    input: [f64; 2],
    mean_interval: f64,
    released: bool,
}
impl Default for Cling {
    fn default() -> Self {
        Self {
            state: [0., 0., 0., 0., 1., 0.],
            anchor: None,
            last: None,
            geometry: None,
            input: [0., 0.],
            mean_interval: 1. / 60.,
            released: false,
        }
    }
}
impl Cling {
    pub fn begin(&mut self, time: f64, point: [f64; 2]) {
        if !time.is_finite() || point.iter().any(|x| !x.is_finite()) {
            return;
        }
        if let Some(last) = self.last {
            self.state = if time - last >= 1.6 {
                [0., 0., 0., 0., 1., 0.]
            } else {
                integrate(self.state, [0., 0.], (time - last).max(0.))
            }
        }
        self.last = Some(time);
        self.geometry = Some(time);
        self.anchor = Some(point);
        self.input = [0., 0.];
        self.released = false;
    }
    pub fn event(&mut self, time: f64, point: [f64; 2]) {
        if !time.is_finite() || point.iter().any(|x| !x.is_finite()) {
            return;
        }
        let (Some(last), Some(old)) = (self.last, self.anchor) else {
            self.begin(time, point);
            return;
        };
        let dt = time - self.geometry.unwrap_or(last);
        if dt < 0. || time < last {
            return;
        }
        let d = dt.max(1. / 480.);
        let velocity = [(point[0] - old[0]) / d, (point[1] - old[1]) / d];
        if velocity.iter().any(|x| !x.is_finite()) {
            return;
        }
        self.state = integrate(self.state, velocity, time - last);
        self.last = Some(time);
        self.geometry = Some(time);
        self.anchor = Some(point);
        self.input = velocity;
        self.released = false;
        if dt < 0.1 {
            self.mean_interval += 0.2 * (dt - self.mean_interval)
        }
    }
    fn continued(&self, seconds: f64, released: bool) -> [f64; 6] {
        let hold = if released || self.released {
            0.
        } else {
            seconds.min((1.5 * self.mean_interval).clamp(0.012, 0.05))
        };
        let held = integrate(self.state, self.input, hold);
        integrate(held, [0., 0.], seconds - hold)
    }
    pub fn release(&mut self, time: f64) {
        if !time.is_finite() {
            return;
        }
        if let Some(last) = self.last {
            self.state = self.continued((time - last).max(0.), false);
            self.last = Some(last.max(time));
            self.input = [0., 0.];
            self.released = true;
        }
    }
    pub fn shown(&self, time: f64, released: bool) -> ClingSample {
        let y = if let Some(last) = self.last {
            self.continued((time - last).max(0.), released)
        } else {
            [0., 0., 0., 0., 1., 0.]
        };
        let sy = y[4].clamp(0.955, 1.03);
        ClingSample {
            lean: 7. * (y[2] / 7.).tanh(),
            sx: 1. + 0.3 * (1. - sy),
            sy,
            vx: y[0],
            vy: y[1],
        }
    }
    pub fn next_deadline(&self, now: f64) -> Option<f64> {
        let last = self.last?;
        if now >= last + 1.6 {
            None
        } else {
            Some((now + 1. / 60.).min(last + 1.6))
        }
    }
}
fn derivative(y: [f64; 6], input: [f64; 2]) -> [f64; 6] {
    let dvx = (input[0] - y[0]) / 0.035;
    let dvy = (input[1] - y[1]) / 0.035;
    let target = -5. * (y[0] / 2200.).tanh();
    [
        dvx,
        dvy,
        y[3],
        220. * (target - y[2]) - 8.4 * y[3],
        y[5],
        520. * (1. - y[4]) - 18. * y[5] - 0.0015 * dvy,
    ]
}
fn integrate(mut y: [f64; 6], input: [f64; 2], seconds: f64) -> [f64; 6] {
    if seconds <= 0. {
        return y;
    }
    let dt = seconds.min(10.);
    let steps = (dt / 0.002).ceil().max(1.) as usize;
    let h = dt / steps as f64;
    for _ in 0..steps {
        let a = derivative(y, input);
        let b = derivative(std::array::from_fn(|i| y[i] + a[i] * h / 2.), input);
        let c = derivative(std::array::from_fn(|i| y[i] + b[i] * h / 2.), input);
        let d = derivative(std::array::from_fn(|i| y[i] + c[i] * h), input);
        for i in 0..6 {
            y[i] += (a[i] + 2. * b[i] + 2. * c[i] + d[i]) * h / 6.;
        }
    }
    y
}
#[derive(Clone, Debug)]
pub struct Squeeze {
    pub scale: f64,
    pub velocity: f64,
    last: Option<f64>,
}
impl Default for Squeeze {
    fn default() -> Self {
        Self {
            scale: 1.,
            velocity: 0.,
            last: None,
        }
    }
}
impl Squeeze {
    pub fn update(&mut self, time: f64, room: f64) -> (f64, f64, f64) {
        if !time.is_finite() || !room.is_finite() {
            return (self.scale, 0., 1.);
        }
        if let Some(last) = self.last {
            if time > last && (self.scale != 1. || self.velocity != 0.) {
                let (x, v) = spring_state(self.scale - 1., self.velocity, time - last);
                self.scale = 1. + x;
                self.velocity = v;
            }
        }
        self.last = Some(time);
        if room < self.scale {
            self.scale = room.max(0.78);
            self.velocity = 0.;
        }
        let shown = self.scale.max(0.78);
        (shown, (0.78 - room).max(0.), 1. + 0.5 * (1. - shown))
    }
}
fn spring_state(x: f64, v: f64, time: f64) -> (f64, f64) {
    let a = 9.;
    let w = (520. - 81f64).sqrt();
    let b = (v + a * x) / w;
    let shape = x * (w * time).cos() + b * (w * time).sin();
    let e = (-a * time).exp();
    (
        e * shape,
        e * (-a * shape - x * w * (w * time).sin() + b * w * (w * time).cos()),
    )
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PlaceSample {
    pub dy: f64,
    pub sy: f64,
    pub alpha: f64,
}
pub fn place_duck(ms: f64, height: f64, ledge: bool, reduced: bool) -> PlaceSample {
    if reduced {
        return PlaceSample {
            dy: 0.,
            sy: 1.,
            alpha: 1. - crate::decor::curve([0.4, 0., 1., 1.], ms / 100.),
        };
    }
    let duration = if ledge { 130. } else { 110. };
    PlaceSample {
        dy: -(if ledge { 1. } else { 0.3 })
            * height
            * crate::decor::curve([0.4, 0., 1., 1.], ms / duration),
        sy: 1.,
        alpha: if ledge {
            if ms < duration {
                1.
            } else {
                0.
            }
        } else if ms <= 50. {
            1.
        } else {
            (1. - (ms - 50.) / (duration - 50.)).max(0.)
        },
    }
}
pub fn place_pop(ms: f64, height: f64, ledge: bool, reduced: bool) -> PlaceSample {
    if reduced {
        return PlaceSample {
            dy: 0.,
            sy: 1.,
            alpha: crate::decor::curve([0., 0., 0.2, 1.], ms / 160.),
        };
    }
    let rise = if ledge { 170. } else { 130. };
    let alpha = if ledge { 1. } else { (ms / 70.).clamp(0., 1.) };
    if ms < rise {
        let u = crate::decor::curve([0.15, 0.85, 0.35, 1.], ms / rise);
        return PlaceSample {
            dy: -(if ledge { 1. } else { 0.3 }) * height * (1. - u),
            sy: 1. + (if ledge { 0.04 } else { 0.03 }) * (1. - u),
            alpha,
        };
    }
    let squash = if ledge { 0.97 } else { 0.975 };
    let elapsed = ms - rise;
    PlaceSample {
        dy: 0.,
        sy: if elapsed < 40. {
            1. - (1. - squash) * crate::decor::curve([0., 0., 0.2, 1.], elapsed / 40.)
        } else {
            1. + spring_state(squash - 1., 0., (elapsed - 40.) / 1000.).0
        },
        alpha,
    }
}

#[derive(Clone, Debug, Default)]
pub struct DragFace {
    on: Option<u64>,
    stop: Option<u64>,
    last_ride: Option<u64>,
    rides: u32,
}
impl DragFace {
    pub fn begin(&mut self, now: u64) {
        self.rides = if self
            .last_ride
            .is_some_and(|at| now.saturating_sub(at) <= 30_000)
        {
            self.rides + 1
        } else {
            1
        };
        self.last_ride = Some(now);
        self.on = None;
        self.stop = None;
    }
    pub fn speed(&mut self, speed: f64, now: u64) {
        if self.on.is_none() && speed >= 1200. {
            self.on = Some(now)
        }
        if self.on.is_some() {
            if speed < 300. {
                self.stop.get_or_insert(now);
            } else {
                self.stop = None;
            }
        }
    }
    pub fn face(&self, now: u64) -> Option<&'static str> {
        let on = self.on?;
        let open = self.stop.map(|s| (s + 220).max(on + 300));
        if now < on {
            return None;
        }
        if let Some(open) = open {
            if now >= open {
                return (now >= open + 350 && now < open + 480).then_some("blink");
            }
        }
        Some(if self.rides >= 3 { "smile" } else { "squeeze" })
    }
    pub fn next_deadline(&self, now: u64) -> Option<u64> {
        let on = self.on?;
        let stop = self.stop?;
        let open = (stop + 220).max(on + 300);
        [open, open + 350, open + 480]
            .into_iter()
            .filter(|at| *at > now)
            .min()
    }
}
#[derive(Clone, Copy, Debug, Default)]
pub struct PixelLean {
    shift: i32,
}
impl PixelLean {
    pub fn update(&mut self, lean: f64) -> i32 {
        while self.shift < 2 && lean > (self.shift as f64 + 0.5) * 2.5 + 0.4 {
            self.shift += 1
        }
        while self.shift > -2 && lean < (self.shift as f64 - 0.5) * 2.5 - 0.4 {
            self.shift -= 1
        }
        self.shift
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct ScreenRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
impl ScreenRect {
    pub fn right(self) -> f64 {
        self.x + self.width
    }
    pub fn bottom(self) -> f64 {
        self.y + self.height
    }
    pub fn inset(self, margin: f64) -> Self {
        Self {
            x: self.x + margin,
            y: self.y + margin,
            width: (self.width - 2. * margin).max(0.),
            height: (self.height - 2. * margin).max(0.),
        }
    }
    pub fn contains(self, r: Self) -> bool {
        r.x >= self.x && r.y >= self.y && r.right() <= self.right() && r.bottom() <= self.bottom()
    }
    pub fn intersects(self, r: Self) -> bool {
        self.x < r.right() && self.right() > r.x && self.y < r.bottom() && self.bottom() > r.y
    }
    pub fn intersection(self, r: Self) -> Self {
        let x = self.x.max(r.x);
        let y = self.y.max(r.y);
        Self {
            x,
            y,
            width: (self.right().min(r.right()) - x).max(0.),
            height: (self.bottom().min(r.bottom()) - y).max(0.),
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LineSide {
    Above,
    Below,
    Left,
    Right,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PlaceMode {
    Ledge,
    BesideRight,
    BesideLeft,
    Below,
    Free,
    Manual,
    Carried,
    Corner,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LinePlacement {
    pub frame: ScreenRect,
    pub side: LineSide,
}
pub fn face_keep_out(sprite: ScreenRect) -> ScreenRect {
    ScreenRect {
        x: sprite.x + 0.263 * sprite.width,
        y: sprite.y + (1. - 0.453) * sprite.height,
        width: (0.745 - 0.263) * sprite.width,
        height: (0.453 - 0.187) * sprite.height,
    }
}
fn line_candidate(sprite: ScreenRect, size: [f64; 2], side: LineSide) -> ScreenRect {
    let (w, h) = (size[0], size[1]);
    let (x, y) = match side {
        LineSide::Above => (sprite.x + (sprite.width - w) / 2., sprite.y - 6. - h),
        LineSide::Below => (sprite.x + (sprite.width - w) / 2., sprite.bottom() + 6.),
        LineSide::Left => (sprite.x - 6. - w, sprite.y + (sprite.height - h) / 2.),
        LineSide::Right => (sprite.right() + 6., sprite.y + (sprite.height - h) / 2.),
    };
    ScreenRect {
        x,
        y,
        width: w,
        height: h,
    }
}
fn line_sides(mode: PlaceMode) -> Vec<LineSide> {
    use LineSide::*;
    match mode {
        PlaceMode::Ledge => vec![Left, Right, Above],
        PlaceMode::BesideRight | PlaceMode::Corner => vec![Above, Below, Right],
        PlaceMode::BesideLeft => vec![Above, Below, Left],
        PlaceMode::Below => vec![Left, Right],
        _ => vec![Above, Below, Left, Right],
    }
}
pub fn avoid_face(frame: ScreenRect, visible: ScreenRect, face: ScreenRect) -> Option<ScreenRect> {
    let area = visible.inset(4.);
    if area.width < frame.width || area.height < frame.height {
        return None;
    }
    let mut base = frame;
    base.x = base.x.clamp(area.x, area.right() - base.width);
    base.y = base.y.clamp(area.y, area.bottom() - base.height);
    if !base.intersects(face) {
        return Some(base);
    }
    let candidates = [
        ScreenRect {
            x: face.x - base.width,
            ..base
        },
        ScreenRect {
            x: face.right(),
            ..base
        },
        ScreenRect {
            y: face.y - base.height,
            ..base
        },
        ScreenRect {
            y: face.bottom(),
            ..base
        },
    ];
    candidates
        .into_iter()
        .filter(|r| area.contains(*r) && !r.intersects(face))
        .min_by(|a, b| {
            ((a.x - base.x).hypot(a.y - base.y)).total_cmp(&(b.x - base.x).hypot(b.y - base.y))
        })
}
pub fn line_placement(
    sprite: ScreenRect,
    visible: ScreenRect,
    size: [f64; 2],
    mode: PlaceMode,
    current: Option<LineSide>,
    overlay: Option<ScreenRect>,
) -> Option<LinePlacement> {
    let sides = line_sides(mode);
    let face = face_keep_out(sprite);
    let fits = |side, spare| {
        let r = line_candidate(sprite, size, side);
        visible.inset(spare).contains(r)
            && !r.intersects(face)
            && overlay.is_none_or(|o| !o.intersects(r))
    };
    if let Some(side) = current {
        if let Some(rank) = sides.iter().position(|s| *s == side) {
            if fits(side, 4.) {
                let selected = sides[..rank]
                    .iter()
                    .copied()
                    .find(|s| fits(*s, 12.))
                    .unwrap_or(side);
                return Some(LinePlacement {
                    frame: line_candidate(sprite, size, selected),
                    side: selected,
                });
            }
        }
    }
    if let Some(side) = sides.iter().copied().find(|s| fits(*s, 4.)) {
        return Some(LinePlacement {
            frame: line_candidate(sprite, size, side),
            side,
        });
    }
    let room = |side| match side {
        LineSide::Left => sprite.x - visible.x,
        LineSide::Right => visible.right() - sprite.right(),
        LineSide::Above => sprite.y - visible.y,
        LineSide::Below => visible.bottom() - sprite.bottom(),
    };
    let mut sorted = sides;
    sorted.sort_by(|a, b| room(*b).total_cmp(&room(*a)));
    for side in sorted {
        if let Some(frame) = avoid_face(line_candidate(sprite, size, side), visible, face) {
            if overlay.is_none_or(|o| !o.intersects(frame)) {
                return Some(LinePlacement { frame, side });
            }
        }
    }
    None
}
pub fn line_width_limit(
    sprite: ScreenRect,
    visible: ScreenRect,
    size: [f64; 2],
    mode: PlaceMode,
    overlay: Option<ScreenRect>,
) -> f64 {
    let face = face_keep_out(sprite);
    if line_sides(mode).iter().any(|s| {
        let r = line_candidate(sprite, size, *s);
        visible.inset(4.).contains(r)
            && !r.intersects(face)
            && overlay.is_none_or(|o| !o.intersects(r))
    }) {
        size[0]
    } else {
        size[0].min(140.).min((visible.width - 8.).max(1.))
    }
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FlipSample {
    pub placement: Option<LinePlacement>,
    pub alpha: f64,
    pub slide: f64,
}
#[derive(Clone, Debug, Default)]
pub struct LineFlip {
    current: Option<LinePlacement>,
    previous: Option<LinePlacement>,
    at: Option<u64>,
}
impl LineFlip {
    pub fn change(&mut self, to: LinePlacement, now: u64) {
        if self.current.is_none() {
            self.current = Some(to);
            return;
        }
        if self.current.is_some_and(|p| p.side == to.side) {
            self.current = Some(to);
            return;
        }
        self.previous = self.current;
        self.current = Some(to);
        self.at = Some(now);
    }
    pub fn current_side(&self) -> Option<LineSide> {
        self.current.map(|p| p.side)
    }
    pub fn sample(&self, now: u64, reduced: bool) -> FlipSample {
        let t = self.at.map(|at| now.saturating_sub(at)).unwrap_or(190);
        if t < 70 {
            FlipSample {
                placement: self.previous,
                alpha: 1. - crate::decor::curve([0.4, 0., 1., 1.], t as f64 / 70.),
                slide: 0.,
            }
        } else {
            let u = crate::decor::curve([0., 0., 0.2, 1.], (t - 70) as f64 / 120.);
            FlipSample {
                placement: self.current,
                alpha: u,
                slide: if reduced { 0. } else { 6. * (1. - u) },
            }
        }
    }
    pub fn next_deadline(&self, now: u64) -> Option<u64> {
        let at = self.at?;
        if now >= at + 190 {
            None
        } else {
            Some((now + 16).min(if now < at + 70 { at + 70 } else { at + 190 }))
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RelocationSample {
    pub anchor: [f64; 2],
    pub dy: f64,
    pub sy: f64,
    pub alpha: f64,
}
#[derive(Clone, Debug, Default)]
pub struct Relocation {
    from: [f64; 2],
    to: [f64; 2],
    old_ledge: bool,
    new_ledge: bool,
    at: Option<u64>,
    skip_duck: bool,
}
impl Relocation {
    pub fn start(
        &mut self,
        from: [f64; 2],
        to: [f64; 2],
        old_ledge: bool,
        new_ledge: bool,
        hidden_fraction: f64,
        now: u64,
    ) {
        self.from = from;
        self.to = to;
        self.old_ledge = old_ledge;
        self.new_ledge = new_ledge;
        self.at = Some(now);
        self.skip_duck = hidden_fraction >= 0.9;
    }
    fn duck_ms(&self, reduced: bool) -> u64 {
        if self.skip_duck {
            0
        } else if reduced {
            100
        } else if self.old_ledge {
            130
        } else {
            110
        }
    }
    pub fn ducking(&self, now: u64, reduced: bool) -> bool {
        self.at
            .is_some_and(|at| now.saturating_sub(at) < self.duck_ms(reduced))
    }
    /// A destination change during the duck keeps its original start and presentation.
    pub fn retarget(&mut self, to: [f64; 2], new_ledge: bool, now: u64, reduced: bool) -> bool {
        if !self.ducking(now, reduced) || !to.iter().all(|value| value.is_finite()) {
            return false;
        }
        self.to = to;
        self.new_ledge = new_ledge;
        true
    }
    /// A live host move during the pop changes only its anchor, preserving the pop clock.
    pub fn track_pop_anchor(&mut self, to: [f64; 2], now: u64, reduced: bool) -> bool {
        if self.ducking(now, reduced)
            || self.next_deadline_reduced(now, reduced).is_none()
            || !to.iter().all(|value| value.is_finite())
        {
            return false;
        }
        self.to = to;
        true
    }
    pub fn sample(&self, now: u64, height: f64, reduced: bool) -> RelocationSample {
        let t = self.at.map(|at| now.saturating_sub(at)).unwrap_or(u64::MAX);
        let duck = self.duck_ms(reduced);
        if t < duck {
            let value = place_duck(t as f64, height, self.old_ledge, reduced);
            return RelocationSample {
                anchor: self.from,
                dy: -value.dy,
                sy: value.sy,
                alpha: value.alpha,
            };
        }
        let pop = t.saturating_sub(duck);
        let total = if reduced {
            160
        } else if self.new_ledge {
            546
        } else {
            492
        };
        if pop >= total {
            return RelocationSample {
                anchor: self.to,
                dy: 0.,
                sy: 1.,
                alpha: 1.,
            };
        }
        let value = place_pop(pop as f64, height, self.new_ledge, reduced);
        RelocationSample {
            anchor: self.to,
            dy: -value.dy,
            sy: value.sy,
            alpha: value.alpha,
        }
    }
    pub fn next_deadline(&self, now: u64) -> Option<u64> {
        self.next_deadline_reduced(now, false)
    }
    pub fn next_deadline_reduced(&self, now: u64, reduced: bool) -> Option<u64> {
        let at = self.at?;
        let duck = self.duck_ms(reduced);
        let pop = if reduced {
            160
        } else if self.new_ledge {
            546
        } else {
            492
        };
        if now >= at + duck + pop {
            None
        } else {
            Some((now + 16).min(if now < at + duck {
                at + duck
            } else {
                at + duck + pop
            }))
        }
    }
}
