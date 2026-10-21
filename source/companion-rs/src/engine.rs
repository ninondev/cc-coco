use crate::{
    coco::{self, Outfit},
    decor::{CompactPhase, DecorAssets, ShedSample, ShedTimeline},
    feed::{Record, Sessions},
    motion::{
        Cling, DragFace, LineFlip, LinePlacement, MotionKind, PixelLean, PlaceMode,
        PointerFade, PressTransform, Relocation, ScreenRect, SeededRandom, SettleRule, Squeeze,
        Timeline,
    },
    presence_store::PresenceStore,
    protocol::{ChannelRequest, PresenceProjection, RequestKind, RequestLog, Requests},
    reactions::{Reactor, TouchEvent},
    render::{Canvas, Face, Frames, Gesture, Image, Size, TextRun},
    shake::{self, Nap, ShakeDetector},
    Error, Options,
};
use serde_json::{json, Value};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::Path,
};

/// The poses of his painted frames that the touch sequences ask for (motion.rs touch_sequence), as the frames had
/// them before they stopped being loaded (DECISIONS 929); his old touch timing still reads these names.
const PAINTED_POSES: [&str; 13] = [
    "error", "flustered", "happy", "idle-reading", "refuse", "shiori-a", "sleep", "snake", "think-a", "waiting",
    "wave", "wild-a", "work-a",
];
/// Room above their head as a share of their picture's height, less the room his painted frame had: resting, their
/// feelers reach 26 of its 241 rows (the figure box the band's visitors use, register.tsx COCO_VISIT_PLACE),
/// his hair 4 of 128. The line and the task pill come down by this, to sit as close above them as above him.
const COCO_HEAD_DROP: f64 = 26. / 241. - 4. / 128.;

#[derive(Clone, Debug, PartialEq)]
pub enum Action {
    Login(bool),
    /// Whether screenshots, recordings and shared screens show the pet (owner 10-20: a switch, on by default).
    Capture(bool),
    Follow,
    Settings,
    Summon,
    /// The data folder is gone: the pet was uninstalled (setup.rs moves the folder to the trash).
    Quit,
}
#[derive(Clone)]
struct LiveReaction {
    key: String,
    start: u64,
    until: u64,
    from_face: Face,
    release: Option<u64>,
    release_from: Option<PressTransform>,
    native_sequence: bool,
    from_name: String,
}
#[derive(Clone, Copy)]
struct Wake {
    start: u64,
    drag: bool,
    held: bool,
    opening: Option<u64>,
}

pub struct Engine {
    pub options: Options,
    pub ui: crate::ui::UiState,
    settle: SettleRule,
    decor: Option<DecorAssets>,
    shed: ShedTimeline,
    native_shed_context: Option<(bool, f64, bool)>,
    native_ui_viewport: Option<crate::ui::Rect>,
    pointer_fade: PointerFade,
    cling: Cling,
    squeeze: Squeeze,
    geometry_until: u64,
    squeeze_room: f64,
    squeeze_horizontal: bool,
    squeeze_push_sign: f64,
    drag_face: DragFace,
    pixel_lean: PixelLean,
    line_flip: LineFlip,
    geometry_live: bool,
    squeeze_face: bool,
    relocation: Relocation,
    helpers_left: bool,
    neighbour_events: std::collections::BTreeMap<String, u64>,
    neighbour_glance_until: u64,
    pointer_glance_until: u64,
    last_pointer_glance: Option<u64>,
    pointer_over_sprite: bool,
    /// Coco's clips. There is no painted fallback any more (DECISIONS 929): without them he does not start.
    coco: coco::Player,
    /// Claudie's cells while the plugin says Claude's form is hers, and the forms that could not be read.
    claudie: Option<crate::claudie::Stills>,
    claudie_failed: Vec<(String, u64)>, // forms that could not be read, and when
    /// Shell changes seen since he started, and the newest one's generation: which outfit they wear
    /// when the plugin does not say.
    coco_flips: u32,
    coco_shed: Option<u64>,
    sessions: Sessions,
    shown: Record,
    rng: SeededRandom,
    reactor: Reactor,
    timeline: Option<Timeline>,
    timeline_start: u64,
    timeline_key: String,
    reaction: Option<LiveReaction>,
    wake: Option<Wake>,
    line: Option<(String, u64, u64)>,
    press: Option<u64>,
    press_from: PressTransform,
    press_repeat: bool,
    repeat_impulses: Vec<u64>,
    projection: PresenceProjection,
    presence_store: Option<PresenceStore>,
    local_awake_at: Option<u64>,
    shake: ShakeDetector,
    last_spin: Option<u64>,
    nap: Option<Nap>,
    requests: Requests,
    store: Value,
    actions: Vec<Action>,
    last_feed: Vec<u8>,
    notice_preference: Option<bool>,
    visible: bool,
    request_log: Option<RequestLog>,
    started: bool,
    /// When the DM thread was last reported read (open_dm, dm_read), and the last notice of hers posted.
    dm_read_at: u64,
    dm_notice: String,
}
impl Engine {
    pub fn new(mut options: Options, now: u64, seed: u32) -> Result<Self, Error> {
        let coco = coco::Player::load(&options.assets.join("coco")).or_else(|_| {
            coco::Player::load(
                &crate::paths::fallback_assets().join("coco"),
            )
        })?;
        let store = read_bounded(&options.folder.join("companion.json"), 512 * 1024)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .filter(Value::is_object)
            .unwrap_or_else(|| json!({}));
        #[cfg(any(windows, target_os = "linux"))]
        let store = {
            let mut store = store;
            crate::state::omit_away(&mut store);
            store
        };
        if let Some(class) = &options.follow_class {
            if !valid_follow_class(class) {
                return Err("invalid window class".into());
            }
        } else {
            options.follow_class = store
                .get("followClass")
                .and_then(Value::as_str)
                .filter(|class| valid_follow_class(class))
                .map(str::to_owned);
        }
        let request_log = if options.folder.is_dir() {
            Some(RequestLog::open(&options.folder, now as f64)?)
        } else {
            None
        };
        let presence_store = options.presence_folder.clone().map(PresenceStore::new);
        let mut engine = Self {
            ui: crate::ui::UiState::default(),
            settle: SettleRule::new(now),
            decor: DecorAssets::load(&options.assets)
                .or_else(|_| {
                    DecorAssets::load(&crate::paths::fallback_assets())
                })
                .ok(),
            shed: ShedTimeline::default(),
            native_shed_context: None,
            native_ui_viewport: None,
            pointer_fade: PointerFade::default(),
            cling: Cling::default(),
            squeeze: Squeeze::default(),
            geometry_until: 0,
            squeeze_room: 1.,
            squeeze_horizontal: false,
            squeeze_push_sign: 1.,
            drag_face: DragFace::default(),
            pixel_lean: PixelLean::default(),
            line_flip: LineFlip::default(),
            geometry_live: false,
            squeeze_face: false,
            relocation: Relocation::default(),
            helpers_left: false,
            neighbour_events: std::collections::BTreeMap::new(),
            neighbour_glance_until: 0,
            pointer_glance_until: 0,
            last_pointer_glance: None,
            pointer_over_sprite: false,
            options,
            coco,
            claudie: None,
            claudie_failed: Vec::new(),
            coco_flips: 0,
            coco_shed: None,
            sessions: Sessions::default(),
            shown: Record::resting(),
            rng: SeededRandom::new(seed),
            reactor: Reactor::default(),
            timeline: None,
            timeline_start: now,
            timeline_key: String::new(),
            reaction: None,
            wake: None,
            line: None,
            press: None,
            press_from: PressTransform {
                sx: 1.,
                sy: 1.,
                skew: 0.,
            },
            press_repeat: false,
            repeat_impulses: Vec::new(),
            projection: PresenceProjection::default(),
            presence_store,
            local_awake_at: None,
            shake: ShakeDetector::default(),
            last_spin: None,
            nap: None,
            requests: Requests::default(),
            store,
            actions: Vec::new(),
            last_feed: Vec::new(),
            notice_preference: None,
            visible: true,
            request_log,
            started: false,
            dm_read_at: 0,
            dm_notice: String::new(),
        };
        if let Some(size) = engine
            .store
            .get("size")
            .and_then(Value::as_str)
            .and_then(Size::parse)
        {
            engine.options.size = size;
        }
        engine.reload(now)?;
        Ok(engine)
    }
    pub fn notice_preference(&self, _now: u64) -> Option<bool> {
        self.notice_preference
    }
    pub fn set_visible(&mut self, visible: bool) {
        self.visible = visible;
    }
    pub fn is_hidden(&self, now: u64) -> bool {
        self.store
            .get("hiddenUntil")
            .and_then(Value::as_f64)
            .unwrap_or(0.)
            > now as f64 / 1000.
    }
    pub fn word(&self, key: &str) -> String {
        self.shown.words.get(key).cloned().unwrap_or_else(|| {
            match key {
                "pat" => "pat coco's head",
                "hide" => "Hide for an hour",
                "home" => "Put Coco back",
                "quit" => "Quit Coco Pet",
                "size" => "Size",
                "tiny" => "Extra small",
                "small" => "Small",
                "medium" => "Medium",
                "large" => "Large",
                "larger" => "Larger",
                "hideLines" => "Hide Coco's lines",
                "showLines" => "Show Coco's lines",
                "newChat" => "New chat",
                "newChatTerminal" => "Terminal",
                "newChatDesktop" => "Claude app",
                "newChatVSCode" => "VS Code",
                "patMenu" => "Pat Coco's head",
                "actWave" => "Wave",
                "actHug" => "Hug",
                "actFlustered" => "Fluster",
                "login" => "Open at login",
                "hideMenu" => "Hide",
                "hideUntil" => "Until I call Coco back",
                "activity" => "Activity",
                "close" => "Close",
                _ => key,
            }
            .to_owned()
        })
    }
    pub fn lines_hidden(&self) -> bool {
        self.store
            .get("linesHidden")
            .and_then(Value::as_bool)
            .unwrap_or(false)
    }
    pub fn hidden_until_ms(&self) -> u64 {
        (self
            .store
            .get("hiddenUntil")
            .and_then(Value::as_f64)
            .unwrap_or(0.)
            * 1000.) as u64
    }
    pub fn mark_running(&mut self, running: bool) -> Result<(), Error> {
        self.store["running"] = json!(running);
        self.save()?;
        self.started = running;
        Ok(())
    }
    pub fn session_lock_message(&mut self, message: u32, now: u64) -> Result<bool, Error> {
        let changed = crate::state::apply_windows_session_message(&mut self.store, message, now);
        if changed {
            self.save()?;
        }
        Ok(changed)
    }
    pub fn record_login_success(&mut self, on: bool) -> Result<(), Error> {
        self.store["login"] = json!(on);
        self.save()
    }
    pub fn preview_record(&mut self, record: Record, now: u64) {
        self.settle.event(now);
        self.sessions = Sessions::default();
        self.sessions.receive(record, now as f64);
        self.update_shown(now);
    }
    pub fn preview_add_record(&mut self, record: Record, now: u64) {
        self.sessions.receive(record, now as f64);
        self.update_shown(now);
    }
    pub fn sessions(&self) -> &Sessions {
        &self.sessions
    }
    pub fn motion_event(&mut self, now: u64) {
        self.settle.event(now);
    }
    pub fn relocate(
        &mut self,
        from: [f64; 2],
        to: [f64; 2],
        old_ledge: bool,
        new_ledge: bool,
        hidden_fraction: f64,
        now: u64,
    ) {
        self.relocation
            .start(from, to, old_ledge, new_ledge, hidden_fraction, now);
        self.settle.event(now);
    }
    pub fn placement_anchor(&self, now: u64) -> [f64; 2] {
        self.relocation
            .sample(now, self.options.size.height(), self.options.reduce_motion)
            .anchor
    }
    pub fn cancel_relocation(&mut self) {
        self.relocation = Relocation::default();
    }
    pub fn placement_moving(&self, now: u64) -> bool {
        self.relocation
            .next_deadline_reduced(now, self.options.reduce_motion)
            .is_some()
    }
    pub fn relocation_ducking(&self, now: u64) -> bool {
        self.relocation.ducking(now, self.options.reduce_motion)
    }
    pub fn retarget_relocation(&mut self, to: [f64; 2], new_ledge: bool, now: u64) -> bool {
        self.relocation
            .retarget(to, new_ledge, now, self.options.reduce_motion)
    }
    pub fn track_pop_anchor(&mut self, to: [f64; 2], now: u64) -> bool {
        self.relocation
            .track_pop_anchor(to, now, self.options.reduce_motion)
    }
    /// Native geometry in logical points: remaining width from the frame's right edge.
    pub fn set_native_shed_context(
        &mut self,
        on_ledge: bool,
        room_from_frame_right: f64,
        bottom_visible: bool,
    ) {
        if room_from_frame_right.is_finite() {
            self.native_shed_context = Some((on_ledge, room_from_frame_right, bottom_visible));
        }
    }
    pub fn clear_native_shed_context(&mut self) {
        self.native_shed_context = None;
    }
    pub fn set_ui_viewport(&mut self, visible: Option<crate::ui::Rect>) {
        self.native_ui_viewport = visible.filter(|r| {
            [r.x, r.y, r.width, r.height].iter().all(|n| n.is_finite())
                && r.width > 4.
                && r.height > 22.
        });
    }
    pub fn on_ledge(&self) -> bool {
        self.native_shed_context
            .map(|context| context.0)
            .unwrap_or_else(|| self.window_anchor().is_some())
    }
    pub fn set_speech_side(&mut self, side: crate::motion::LineSide) {
        match side {
            crate::motion::LineSide::Right => self.helpers_left = true,
            crate::motion::LineSide::Left => self.helpers_left = false,
            _ => {}
        }
    }
    /// A carry begins at `point` (logical points): the shake detector starts afresh.
    pub fn shake_begin(&mut self, point: [f64; 2], now: u64) {
        self.shake.reset();
        self.shake.feed(point, now);
    }
    /// One position of the carry; three swings of 20 points inside 800 ms spin him.
    pub fn shake_event(&mut self, point: [f64; 2], now: u64) {
        if self.shake.feed(point, now) {
            self.shake_now(now);
        }
    }
    pub fn shake_end(&mut self) {
        self.shake.reset();
    }
    pub fn geometry_begin(&mut self, point: [f64; 2], now: u64) {
        self.shake_begin(point, now);
        self.cling.begin(now as f64 / 1000., point);
        self.drag_face.begin(now);
        self.geometry_live = true;
        self.geometry_until = now + 1600;
        self.settle.event(now);
    }
    pub fn geometry_event(&mut self, point: [f64; 2], now: u64) {
        if !self.geometry_live || now >= self.geometry_until {
            self.drag_face.begin(now);
            self.geometry_live = true;
        }
        self.shake_event(point, now);
        self.cling.event(now as f64 / 1000., point);
        let speed = self.cling.shown(now as f64 / 1000., false);
        self.drag_face.speed(speed.vx.hypot(speed.vy), now);
        self.geometry_until = now + 1600;
        self.settle.event(now);
    }
    pub fn geometry_end(&mut self, now: u64) {
        self.shake_end();
        self.cling.release(now as f64 / 1000.);
        self.geometry_live = false;
        self.geometry_until = now + 1600;
    }
    /// Three swings of 20 points while he is held: he spins, dizzy, with a line from his `shaken`
    /// pool. A second shake inside 8 s only makes him hold his book tight until he is let go.
    fn shake_now(&mut self, now: u64) {
        if self.nap.is_some() || self.is_hidden(now) {
            return;
        }
        self.settle.event(now);
        let again = self
            .last_spin
            .is_some_and(|at| now.saturating_sub(at) < shake::AGAIN_MS);
        let key = if again { "hold-tight" } else { "spin" };
        let until = if again {
            now + 600_000
        } else {
            now + shake::spin_total_ms(self.options.reduce_motion)
        };
        self.reaction = Some(LiveReaction {
            key: key.into(),
            start: now,
            until,
            from_face: Face::Open,
            release: None,
            release_from: None,
            native_sequence: false,
            from_name: self.shown.frame.clone(),
        });
        if again {
            return;
        }
        self.last_spin = Some(now);
        if let Some(lines) = self.shown.reactions.get("shaken").filter(|l| !l.is_empty()) {
            let line = lines[(self.rng.next_f64() * lines.len() as f64) as usize % lines.len()].clone();
            let at = if self.options.reduce_motion {
                now
            } else {
                now + shake::SPIN_MS as u64
            };
            self.line = Some((line, at, until + 1_000));
        }
    }
    /// The system is going to sleep (the lid closed, or a menu choice): he naps at once, with
    /// nothing of his scheduled. Not when he is hidden.
    pub fn system_sleep(&mut self, now: u64) {
        if !self.visible || self.is_hidden(now) {
            return;
        }
        self.nap = Some(Nap::begin());
        self.reaction = None;
        self.line = None;
        self.wake = None;
        self.press = None;
        self.local_awake_at = None;
        self.settle.event(now);
    }
    /// The system woke. `locked`: the screen is locked, so he waits for the unlock.
    pub fn system_wake(&mut self, now: u64, locked: bool) {
        if let Some(nap) = &mut self.nap {
            nap.system_woke(now, locked);
        }
    }
    pub fn screen_unlocked(&mut self, now: u64) {
        if let Some(nap) = &mut self.nap {
            nap.unlocked(now);
        }
    }
    pub fn napping(&self) -> bool {
        self.nap.is_some()
    }
    pub fn squeeze_room(&mut self, room: f64, now: u64) {
        self.squeeze_contact(room, false, 1., now);
    }
    /// `push_sign` is in native screen coordinates, horizontal ±1, vertical positive downward.
    pub fn squeeze_contact(&mut self, room: f64, horizontal: bool, push_sign: f64, now: u64) {
        if !room.is_finite() || !push_sign.is_finite() {
            return;
        }
        self.squeeze_horizontal = horizontal;
        self.squeeze_push_sign = push_sign.signum();
        self.squeeze_room = room;
        let (s, _, _) = self.squeeze.update(now as f64 / 1000., room);
        if s < 0.96 {
            self.squeeze_face = true
        }
        if s >= 0.99 {
            self.squeeze_face = false
        }
        self.geometry_until = now + 1600;
    }
    pub fn line_placement(
        &mut self,
        sprite: ScreenRect,
        screen: ScreenRect,
        size: [f64; 2],
        mode: PlaceMode,
        overlay: Option<ScreenRect>,
        now: u64,
    ) -> Option<LinePlacement> {
        let placement = crate::motion::line_placement(
            sprite,
            screen,
            size,
            mode,
            self.line_flip.current_side(),
            overlay,
        )?;
        self.line_flip.change(placement, now);
        Some(placement)
    }
    pub fn line_flip_sample(&self, now: u64) -> crate::motion::FlipSample {
        self.line_flip.sample(now, self.options.reduce_motion)
    }
    pub fn line_opacity(&self, now: u64) -> f64 {
        self.pointer_fade.opacity(now)
    }
    /// The pointer is over his picture or not. When it comes onto him from the right he glances
    /// toward it for 450 ms, at most every two seconds; only the right-looking face is drawn here.
    pub fn pointer_over(&mut self, over: bool, from_right: bool, now: u64) {
        let came = over && !self.pointer_over_sprite;
        self.pointer_over_sprite = over;
        if !came
            || !from_right
            || self.shown.mood == "sleep"
            || self.press.is_some()
            || self.reaction.is_some()
            || self.wake.is_some()
            || self.nap.is_some()
            || self.is_hidden(now)
            || self
                .last_pointer_glance
                .is_some_and(|at| now.saturating_sub(at) < 2_000)
        {
            return;
        }
        self.last_pointer_glance = Some(now);
        self.pointer_glance_until = now + 450;
        self.settle.event(now);
    }
    /// True while the glance toward the pointer is on his face.
    pub fn pointer_glancing(&self, now: u64) -> bool {
        now < self.pointer_glance_until
    }
    /// Take the system's contrast request: the Linux portal's `contrast`, or a Windows contrast
    /// theme with its seven colours, and (Windows) the transparency-effects switch. Any of them
    /// makes his line's fade all or nothing.
    pub fn set_contrast(
        &mut self,
        high_contrast: bool,
        palette: Option<crate::contrast::SystemPalette>,
        transparency_off: bool,
        now: u64,
    ) {
        self.ui.high_contrast = high_contrast;
        self.ui.system_palette = palette;
        self.pointer_fade
            .set_solid(self.ui.look().solid_fade() || transparency_off, now);
    }
    pub fn pointer_near(&mut self, near: bool, now: u64) {
        self.pointer_distance(if near { 30. } else { f64::INFINITY }, false, now);
    }
    pub fn pointer_distance(&mut self, distance: f64, deliberate: bool, now: u64) {
        self.pointer_fade.update(distance, deliberate, now);
    }
    pub fn submit_ui_request(&mut self, request: ChannelRequest, now: u64) -> Result<(), Error> {
        if self.request_log.is_none() {
            self.request_log = Some(RequestLog::open(&self.options.folder, now as f64)?);
        }
        self.request_log
            .as_mut()
            .unwrap()
            .append(request, now as f64)?;
        self.settle.event(now);
        Ok(())
    }
    pub fn open_activity(&mut self, now: u64) -> Result<(), Error> {
        self.ui.open_activity(&self.sessions, now as f64);
        let held = self.sessions.open_activity(now as f64);
        for record in held {
            if record.channel {
                let id = format!(
                    "{:016x}",
                    now.wrapping_mul(6364136223846793005)
                        .wrapping_add(record.at as u64)
                );
                let request = ChannelRequest::new(
                    id,
                    record.session,
                    now as f64,
                    RequestKind::Seen,
                    None,
                    Some(now as f64),
                )?;
                self.submit_ui_request(request, now)?;
            }
        }
        self.ui.sync(&self.sessions, now as f64);
        self.settle.event(now);
        Ok(())
    }
    /// The Activity window on the DM thread (the plugin's dm.ts): from the badge, the menu, a notification or the
    /// window's own switch. Opening it reads her messages.
    pub fn open_dm(&mut self, now: u64) -> Result<(), Error> {
        self.open_activity(now)?;
        self.ui.open_dm(&self.sessions, now as f64);
        self.dm_read(now)
    }
    /// While the thread is on screen and something of hers is unread, the plugin hears it was read: once, then again
    /// five seconds on if the record still says unread.
    pub fn dm_read(&mut self, now: u64) -> Result<(), Error> {
        if !self.ui.dm_visible() || self.ui.dm_unread() == 0 || now < self.dm_read_at.saturating_add(5000) {
            return Ok(());
        }
        self.dm_read_at = now;
        let id = format!("{:016x}", now.wrapping_mul(6364136223846793005).wrapping_add(0xd5));
        let request = ChannelRequest::new(
            id,
            self.ui.chosen.session.clone(),
            now as f64,
            RequestKind::DmSeen,
            None,
            None,
        )?;
        self.submit_ui_request(request, now)
    }
    /// Her newest message that reached the closed thread, for the system's notification: each once, while it is
    /// fresh (two minutes), and not while the thread is on screen. The platform holds it while the screen is locked.
    pub fn take_dm_notice(&mut self, now: u64) -> Option<crate::feed::DmNotice> {
        let notice = self.ui.chosen.dm.as_ref()?.notice.clone()?;
        if notice.id == self.dm_notice || !(0. ..=120_000.).contains(&(now as f64 - notice.at)) {
            return None;
        }
        self.dm_notice = notice.id.clone();
        (!self.ui.dm_visible()).then_some(notice)
    }
    pub fn set_follow_wm_class(&mut self, instance: String, class: String) -> Result<(), Error> {
        if !valid_follow_class(&instance) || !valid_follow_class(&class) {
            return Err("invalid window class".into());
        }
        self.store["follow"] = json!({"wmClass":{"instance":instance,"class":class}});
        self.options.follow_class = Some(class);
        self.save()
    }
    pub fn clear_follow_wm_class(&mut self) -> Result<(), Error> {
        if let Some(o) = self.store.as_object_mut() {
            // The stop is kept, so Claude's own window is not followed again by default (follow_unchosen).
            o.insert("follow".into(), json!({"stopped": true}));
            o.remove("followClass");
        }
        self.options.follow_class = None;
        self.save()
    }
    /// Nothing about following was ever chosen here: no window picked, never stopped, never put down by hand. The
    /// Linux pet then stands by Claude's desktop app on X11 (platform/linux.rs), as the Mac pet stands by Claude's window.
    pub fn follow_unchosen(&self) -> bool {
        self.store.get("follow").is_none()
            && self.options.follow_class.is_none()
            && self.store.get("manual").is_none()
    }
    pub fn follow_wm_class(&self) -> Option<(String, String)> {
        let wm = &self.store["follow"]["wmClass"];
        let i = wm["instance"].as_str()?;
        let c = wm["class"].as_str()?;
        if !valid_follow_class(i) || !valid_follow_class(c) {
            return None;
        }
        Some((i.into(), c.into()))
    }
    pub fn record(&self) -> &Record {
        &self.shown
    }
    pub fn manual_position(&self) -> Option<(f64, f64)> {
        let m = self.store.get("manual")?;
        if m.get("anchor")?.as_str()? != "screen" {
            return None;
        }
        let (x, y) = (m.get("x")?.as_f64()?, m.get("y")?.as_f64()?);
        ((0.0..=1.).contains(&x) && (0.0..=1.).contains(&y)).then_some((x, y))
    }
    pub fn set_manual_position(&mut self, x: f64, y: f64) -> Result<(), Error> {
        if !x.is_finite() || !y.is_finite() {
            return Err("invalid position".into());
        }
        self.store["manual"] = json!({"anchor":"screen","x":x.clamp(0.,1.),"y":y.clamp(0.,1.)});
        self.save()
    }
    pub fn clear_manual_position(&mut self) -> Result<(), Error> {
        if let Some(o) = self.store.as_object_mut() {
            o.remove("manual");
        }
        self.save()
    }
    pub fn set_window_anchor(&mut self, corner: &str, dx: f64, dy: f64) -> Result<(), Error> {
        if !["topLeft", "topRight", "bottomLeft", "bottomRight"].contains(&corner)
            || !dx.is_finite()
            || !dy.is_finite()
            || dx.abs() > 4000.
            || dy.abs() > 4000.
        {
            return Err("invalid window anchor".into());
        }
        self.store["manual"] = json!({"anchor":"window","corner":corner,"dx":dx,"dy":dy});
        self.save()
    }
    pub fn window_anchor(&self) -> Option<(String, f64, f64)> {
        let m = self.store.get("manual")?;
        if m.get("anchor")?.as_str()? != "window" {
            return None;
        }
        Some((
            m.get("corner")?.as_str()?.to_owned(),
            m.get("dx")?.as_f64()?,
            m.get("dy")?.as_f64()?,
        ))
    }
    pub fn hide(&mut self, now: u64) {
        self.store["hiddenUntil"] = json!(now as f64 / 1000. + 3600.);
        let _ = self.save();
    }
    /// Hidden until the person calls it back (the tray icon, a summon, the book): no timer is set.
    pub fn hide_until_called(&mut self) {
        self.store["hiddenUntil"] = json!(4_102_444_800.0_f64); // 2100-01-01
        let _ = self.save();
    }
    pub fn login(&self) -> bool {
        self.store
            .get("login")
            .and_then(Value::as_bool)
            .unwrap_or(false)
    }
    /// Whether screenshots, recordings and shared screens show the pet: on until the book's switch turns it off.
    pub fn capture(&self) -> bool {
        self.store
            .get("capture")
            .and_then(Value::as_bool)
            .unwrap_or(true)
    }
    /// The same registration the book's switch asks for; the platform does it and reports back.
    pub fn toggle_login(&mut self) {
        let on = !self.login();
        self.actions.push(Action::Login(on));
    }
    pub fn toggle_lines(&mut self) -> Result<(), Error> {
        let hidden = self
            .store
            .get("linesHidden")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        self.store["linesHidden"] = json!(!hidden);
        self.save()
    }
    pub fn set_size(&mut self, size: Size) {
        self.ui.context.size = size;
        self.options.size = size;
        self.store["size"] = json!(size);
        let _ = self.save();
    }
    pub fn size(&self) -> Size {
        self.options.size
    }
    pub fn take_actions(&mut self) -> Vec<Action> {
        std::mem::take(&mut self.actions)
    }
    pub fn wave(&mut self, now: u64) {
        self.settle.event(now);
        self.store["hiddenUntil"] = json!(0);
        self.reaction = Some(LiveReaction {
            key: "wave".into(),
            start: now,
            until: now + 1500,
            from_face: Face::Open,
            release: None,
            release_from: None,
            native_sequence: false,
            from_name: self.shown.frame.clone(),
        });
        let _ = self.save();
    }
    pub fn reload(&mut self, now: u64) -> Result<(), Error> {
        if !self.options.folder.exists() {
            if !self.actions.contains(&Action::Quit) {
                self.actions.push(Action::Quit);
            }
            return Ok(());
        }
        if let Ok(bytes) = read_bounded(&self.options.folder.join("view.json"), 256 * 1024) {
            if bytes != self.last_feed {
                if let Ok(record) = Record::parse(&bytes) {
                    let value: Value = serde_json::from_slice(&bytes)?;
                    if let Some(recipes) = value.get("presence") {
                        self.projection.recipes(recipes);
                    }
                    if self.sessions.receive(record.clone(), now as f64) {
                        // The system's notifications are wanted for a long task or for her DMs (Windows keeps its
                        // notification shortcut while either is on).
                        self.notice_preference =
                            Some(record.notices || record.dm.as_ref().is_some_and(|dm| dm.notify));
                        self.settle.event(now);
                        self.requests.merge(&record.requests);
                        if let Some(ack) = &record.ack {
                            if let Some(log) = &mut self.request_log {
                                log.acknowledge(ack)?;
                            }
                        }
                        let answered = self.stamp("answered");
                        if record.summon > answered
                            && record.summon <= now as f64
                            && now as f64 - record.summon <= 15_000.
                        {
                            self.store["answered"] = json!(record.summon);
                            self.wave(now);
                            self.actions.push(Action::Summon);
                        }
                        self.apply_requests(now)?;
                    }
                    self.last_feed = bytes;
                }
            }
        }
        if let Some(store) = &mut self.presence_store {
            if let Some(snapshot) = store.refresh(now) {
                self.projection.receive(snapshot);
            }
        }
        self.update_shown(now);
        self.ui.sync(&self.sessions, now as f64);
        self.dm_read(now)?;
        Ok(())
    }
    fn stamp(&self, key: &str) -> f64 {
        self.store.get(key).and_then(Value::as_f64).unwrap_or(0.)
    }
    fn apply_requests(&mut self, now: u64) -> Result<(), Error> {
        let mut changed = false;
        if let Some(size) = &self.requests.size {
            if size.at > self.stamp("sizeAt") {
                let value = serde_json::to_value(size.to)?;
                if let Some(size) = value.as_str().and_then(Size::parse) {
                    self.options.size = size;
                }
                self.store["sizeAt"] = json!(size.at);
                changed = true;
            }
        }
        if let Some(login) = &self.requests.login {
            if login.at > self.stamp("loginAt")
                && (0.0..=60_000.).contains(&(now as f64 - login.at))
            {
                self.actions.push(Action::Login(login.on));
                self.store["loginAt"] = json!(login.at);
                changed = true;
            }
        }
        if let Some(capture) = &self.requests.capture {
            if capture.at > self.stamp("captureAt") {
                self.actions.push(Action::Capture(capture.on));
                self.store["capture"] = json!(capture.on);
                self.store["captureAt"] = json!(capture.at);
                changed = true;
            }
        }
        for (key, at, action) in [
            ("followAt", self.requests.follow, Action::Follow),
            ("settingsAt", self.requests.settings, Action::Settings),
        ] {
            if at > self.stamp(key) && (0.0..=15_000.).contains(&(now as f64 - at)) {
                self.actions.push(action);
                self.store[key] = json!(at);
                changed = true;
            }
        }
        if changed {
            self.save()?;
        }
        Ok(())
    }
    fn update_shown(&mut self, now: u64) {
        if let Some(mut p) = self.projection.presence(now as f64) {
            // While his stick burns he says nothing of his own: the sleep, wake and idle lines wait.
            if crate::stick::burning(self.shown.stick, now) {
                p.said = None;
            }
            self.sessions.receive_presence(p);
        }
        let was_asleep = self.shown.mood == "sleep";
        let previous_presence = self.shown.presence.as_ref().map(|p| p.seq);
        self.shown = self.sessions.shown(now as f64);
        if self.nap.is_some() {
            self.shown.mood = "sleep".into();
            self.shown.frame = "sleep".into();
            self.shown.said = None;
        }
        if self.shown.neighbours_enabled {
            // Only the end of a busy spell is said; the lantern alone shows that one is busy.
            for light in self
                .shown
                .neighbours
                .clone()
                .into_iter()
                .filter(|light| !light.partial && light.ended_at.is_some())
            {
                let event = light.ended_at.unwrap_or(light.at);
                let key = format!("{}:{}", self.shown.session, light.id);
                let seen = self.neighbour_events.get(&key).copied().unwrap_or(0);
                if event > seen {
                    self.neighbour_events.insert(key, event);
                    if now >= event && now - event < 14_000 {
                        self.neighbour_glance_until = now + 450;
                        if event.saturating_sub(light.at) >= 30_000
                            && self.current_line(now).is_none()
                        {
                            let line = crate::ui::word(&self.shown.lang, "neighbour.done", 0)
                                .replace("{agent}", &light.label);
                            self.line = Some((line, now, now + 14_000));
                        }
                    }
                }
            }
        }
        if self.shown.presence.as_ref().map(|p| p.seq) != previous_presence {
            self.settle.event(now);
        }
        if let Some(event) = self.shown.shed {
            self.shed.receive(event);
        }
        if was_asleep && self.wake.is_none() {
            if let Some(p) = &self.shown.presence {
                if p.kind == "wake" && !p.asleep && now as f64 >= p.at && (now as f64) < p.at + 450.
                {
                    self.wake = Some(Wake {
                        start: p.at as u64,
                        drag: false,
                        held: false,
                        opening: None,
                    });
                }
            }
        }
        if let Some(touch) = self.local_awake_at {
            if now < touch + crate::protocol::sleep_after(touch as f64) as u64
                && self.shown.mood == "sleep"
                && self
                    .shown
                    .presence
                    .as_ref()
                    .is_none_or(|p| p.at <= touch as f64)
            {
                self.shown.mood = "idle".into();
                self.shown.frame = "idle-reading".into();
                self.shown.said = None;
            }
        }
        let kind = MotionKind::from_mood(&self.shown.mood);
        let key = if self.options.reduce_motion || !self.visible || self.is_hidden(now) {
            String::new()
        } else if kind.is_some()
            && self.shown.loop_frames.is_some()
            && now as f64 - self.shown.at < 600_000.
        {
            format!(
                "{}:{}:{:?}",
                self.shown.session, self.shown.mood, self.shown.loop_frames
            )
        } else if self.shown.frame == "idle-reading"
            && ["idle", "clingy"].contains(&self.shown.mood.as_str())
        {
            format!("idle:{:?}", self.shown.motion)
        } else {
            String::new()
        };
        if key != self.timeline_key {
            self.timeline = if key.is_empty() {
                None
            } else if let Some(kind) = kind {
                Some(Timeline::looping(&self.shown.motion, kind, &mut self.rng))
            } else {
                Some(Timeline::idle(&self.shown.motion, true, &mut self.rng))
            };
            self.timeline_start = now;
            self.timeline_key = key;
        }
        self.update_coco(now);
    }
    /// Claudie's cells for the form the plugin names, read once; one that cannot be read leaves Coco drawn.
    fn wear_form(&mut self, now: u64) {
        let wanted = self.shown.claudie.clone();
        if self.claudie.as_ref().map(|s| s.form()) == wanted.as_deref() {
            return;
        }
        self.claudie = None;
        let Some(form) = wanted else { return };
        // A form that could not be read is tried again ten seconds on, not left on Coco until a restart.
        if self.claudie_failed.iter().any(|(failed, at)| *failed == form && now.saturating_sub(*at) < 10_000) {
            return;
        }
        self.claudie_failed.retain(|(failed, _)| *failed != form);
        let bundled = crate::paths::fallback_assets().join("../../assets/claudie");
        match crate::claudie::Stills::load(&self.options.assets.join("claudie"), &form)
            .or_else(|_| crate::claudie::Stills::load(&bundled, &form))
        {
            Ok(stills) => self.claudie = Some(stills),
            Err(_) => self.claudie_failed.push((form, now)),
        }
    }
    /// The pair of socks they wear from their drawer, None for their own (or when the player is not there).
    pub fn coco_socks(&self) -> Option<&str> {
        self.coco.worn()
    }
    /// The outfit they wear: the plugin's word, else A with a change for every compaction seen.
    fn coco_outfit(&self) -> Outfit {
        self.shown
            .outfit
            .as_deref()
            .and_then(Outfit::parse)
            .unwrap_or(if self.coco_flips % 2 == 1 {
                Outfit::B
            } else {
                Outfit::A
            })
    }
    fn coco_wanted(&self, now: u64) -> coco::Wanted {
        let shown = &self.shown;
        let reaction = self
            .reaction
            .as_ref()
            .filter(|r| now >= r.start && now < r.until);
        let key = reaction.map(|r| r.key.as_str());
        let touch = match key {
            Some("pat" | "hold") => Some(coco::Touch::Pat),
            Some("flustered" | "spin" | "hold-tight") => Some(coco::Touch::Burst),
            _ => None,
        };
        let mood = if key == Some("wave") {
            "wave"
        } else {
            shown.mood.as_str()
        };
        let working = matches!(shown.mood.as_str(), "think" | "work");
        let outfit = self.coco_outfit();
        // He packs while a compaction runs; the shell change plays through once when it ends.
        let shell_ms = self.coco.body_seconds(outfit.other(), "shell") * 1000.;
        let shed = shown.shed.and_then(|event| {
            let age = now.checked_sub(event.at)? as f64;
            match event.phase {
                CompactPhase::Begin if age < 600_000. => Some(event.phase),
                CompactPhase::End if age < shell_ms => Some(event.phase),
                _ => None,
            }
        });
        let input = coco::Input {
            mood,
            pose: shown.pose.as_deref(),
            touch,
            shed,
            act: None,
            night: coco::is_night(coco::local_hour(now), mood, working),
            working,
        };
        coco::wanted(&input, outfit, None)
    }
    fn update_coco(&mut self, now: u64) {
        if let Some(event) = self
            .shown
            .shed
            .filter(|event| event.phase == CompactPhase::End)
        {
            if self.coco_shed.is_none_or(|seen| event.generation > seen) {
                // A compaction already over when he starts says nothing of the outfit.
                let live = (now.saturating_sub(event.at) as f64) < 3000.;
                if self.coco_shed.is_some() || live {
                    self.coco_flips += 1;
                }
                self.coco_shed = Some(event.generation);
            }
        }
        let wanted = self.coco_wanted(now);
        let runs = self.coco_runs(now);
        let socks = self.shown.socks.clone();
        self.wear_form(now);
        // the pair from their sock drawer: one that cannot be read leaves their own pair on
        if self.coco.wear(socks.as_deref()).is_err() {
            let _ = self.coco.wear(None);
        }
        self.coco.update(&wanted, now, runs);
    }
    /// Whether they are drawn moving: as long as the other pictures are, and never in reduced motion. Asleep,
    /// carried, or when the next frame would fall outside the settle window, they stand in the pose their
    /// action settles into, so the last frame before the window closes is that pose.
    fn coco_runs(&self, now: u64) -> bool {
        let carried = self
            .reaction
            .as_ref()
            .is_some_and(|r| r.key == "drag" && now >= r.start && now < r.until);
        !self.options.reduce_motion
            && !carried
            && self.settle.moves(
                now + coco::FRAME_MS,
                self.motion_held(now),
                self.visible && !self.is_hidden(now),
                self.shown.mood == "sleep",
            )
    }
    fn coco_deadline(&self, now: u64) -> Option<u64> {
        self.coco_runs(now).then_some(now + coco::FRAME_MS)
    }
    fn coco_height(&self, scale: f64) -> usize {
        (self.options.size.height() * scale).round().max(1.) as usize
    }
    /// The drawn picture's size in device pixels.
    fn sprite_dimensions(&self, scale: f64) -> (usize, usize) {
        self.coco.dimensions(self.coco_height(scale))
    }
    fn coco_picture(&mut self, now: u64, scale: f64) -> Option<Image> {
        let (height, reduced) = (self.coco_height(scale), self.options.reduce_motion);
        let runs = self.coco_runs(now);
        let picture = self.coco.render(now, height, reduced, runs);
        // Claude's form set to Claudie: her still cell for the action Coco is playing, in Coco's canvas
        match (&self.claudie, self.coco.current()) {
            (Some(stills), Some((_, action, _))) => {
                let (width, height) = self.coco.dimensions(height);
                stills.render(action, width, height).or(picture)
            }
            _ => picture,
        }
    }
    /// The outfit and action they are playing, and what they settle into; None before their first update.
    pub fn coco_state(&self) -> Option<(Outfit, &'static str, &'static str)> {
        self.coco.current()
    }
    pub fn touch(&mut self, event: TouchEvent, now: u64) {
        self.settle.event(now);
        self.nap = None;
        let (from_name, from_face, from_gesture) = self.visual(now);
        let presentation = PressTransform {
            sx: from_gesture.sx,
            sy: from_gesture.sy,
            skew: from_gesture.skew,
        };
        let repeating = self
            .reaction
            .as_ref()
            .is_some_and(|r| r.key == "pat" && now < r.until);
        let press_start = self.press;
        let asleep = self.shown.mood == "sleep";
        if asleep && self.wake.is_none() {
            self.wake = Some(Wake {
                start: now,
                drag: event == TouchEvent::DragStart,
                held: event == TouchEvent::Press,
                opening: None,
            });
        }
        if let Some(wake) = &mut self.wake {
            if event == TouchEvent::DragStart {
                wake.drag = true;
            }
            if event == TouchEvent::LongPress {
                wake.held = true;
                wake.opening = Some(now);
            }
            if matches!(event, TouchEvent::Click { .. }) && now.saturating_sub(wake.start) >= 450 {
                wake.opening = Some(now);
            }
        }
        if event == TouchEvent::Press {
            self.press_from = presentation;
            self.press_repeat = repeating;
            self.press = Some(now);
        } else {
            self.press = None;
        }
        let r = self.reactor.react(
            event,
            now as f64 / 1000.,
            &self.shown.mood,
            &self.shown.reactions,
            self.rng.next_f64(),
        );
        if let Some(store) = &mut self.presence_store {
            match store.touch(now) {
                Ok(Some(snapshot)) => {
                    self.projection.receive(snapshot);
                }
                Ok(None) => {}
                Err(e) => {
                    if self.options.trace {
                        eprintln!("presence touch: {e}");
                    }
                }
            }
        }
        if asleep || self.wake.is_some() {
            self.local_awake_at = Some(now);
        }
        if asleep {
            // A failed shared transaction cannot make a local sleeping face ignore a touch.
            self.shown.mood = "idle".into();
            self.shown.frame = "idle-reading".into();
        }
        let mut start = now + r.delay_ms.ceil() as u64;
        if let Some(wake) = self.wake {
            if let Some(opening) = wake.opening {
                start = start.max(opening + 160);
            }
        }
        let face_start = if r.key == "pat" && self.wake.is_none() {
            press_start.unwrap_or(start)
        } else {
            start
        };
        if event != TouchEvent::Press {
            if repeating && r.key == "pat" && press_start.is_none() {
                self.repeat_impulses.push(now);
            }
            let duration = if r.key == "flustered" && r.hold >= 1.8 {
                1840
            } else {
                (r.hold * 1000.) as u64
            };
            let until = if press_start.is_some() && r.key == "pat" {
                face_start + 1400
            } else {
                start + duration
            };
            self.reaction = Some(LiveReaction {
                key: r.key,
                start: face_start,
                until,
                from_face,
                release: press_start.map(|_| now),
                release_from: press_start.map(|_| presentation),
                native_sequence: press_start.is_some(),
                from_name,
            });
        }
        if let Some(line) = r.line {
            self.line = Some((line, start, start + (r.line_hold * 1000.) as u64));
        }
    }
    pub fn render(&mut self, now: u64, scale: f64) -> Canvas {
        self.render_internal(now, scale, false, true)
    }
    pub fn render_companion(&mut self, now: u64, scale: f64) -> Canvas {
        self.ui.context.size = self.options.size;
        self.render_internal(now, scale, true, true)
    }
    pub fn render_companion_without_hover(&mut self, now: u64, scale: f64) -> Canvas {
        self.ui.context.size = self.options.size;
        self.render_internal(now, scale, true, false)
    }
    fn render_internal(
        &mut self,
        now: u64,
        scale: f64,
        companion: bool,
        compose_hover: bool,
    ) -> Canvas {
        self.advance(now);
        let scale = scale.clamp(
            crate::render::MIN_CANVAS_SCALE,
            crate::render::MAX_CANVAS_SCALE,
        );
        crate::ui::set_draw_scale(scale);
        if !companion && self.ui.surface() != crate::ui::Surface::Companion {
            return self.ui.render(scale);
        }
        let mut canvas = Canvas::blank(
            (320. * scale).round() as u32,
            ((160. + 1.32 * self.options.size.height()) * scale).round() as u32,
        );
        canvas.paper_dark = self.ui.dark;
        canvas.look = self.ui.look();
        canvas.overscan_bottom = (0.32 * self.options.size.height() * scale).round() as u32;
        if self.is_hidden(now) {
            return canvas;
        }
        // Their clips carry the press, the pat, the wake and the breath; only the geometry below moves them.
        let coco_image = self.coco_picture(now, scale);
        let smooth_art = coco_image.is_some() || !self.options.size.pixel();
        let mut gesture = Gesture::default();
        if now < self.geometry_until || self.squeeze_room < 1. {
            let cling = self.cling.shown(now as f64 / 1000., false);
            self.drag_face.speed(cling.vx.hypot(cling.vy), now);
            let (squeeze, push, other) = self.squeeze.update(now as f64 / 1000., self.squeeze_room);
            if squeeze < 0.96 {
                self.squeeze_face = true
            }
            if squeeze >= 0.99 {
                self.squeeze_face = false
            }
            if !self.options.reduce_motion {
                if !smooth_art {
                    let shift = self.pixel_lean.update(cling.lean);
                    gesture.dx = shift as f64
                        * (self.sprite_dimensions(scale).1 as f64 / 32.).floor();
                } else {
                    gesture.sy *= cling.sy
                        * if self.squeeze_horizontal {
                            other
                        } else {
                            squeeze
                        };
                    gesture.sx *= cling.sx
                        * if self.squeeze_horizontal {
                            squeeze
                        } else {
                            other
                        };
                    gesture.skew += cling.lean.to_radians().tan();
                }
            }
            let reduced = self.options.reduce_motion || !smooth_art;
            let pressure = if reduced {
                (1. - self.squeeze_room).max(0.)
            } else {
                push
            };
            if self.squeeze_horizontal {
                let width = self.sprite_dimensions(scale).0 as f64;
                gesture.dx += self.squeeze_push_sign
                    * (if reduced { 0. } else { (1. - squeeze) / 2. } + pressure)
                    * width;
            } else {
                gesture.dy +=
                    self.squeeze_push_sign * pressure * self.options.size.height() * scale;
            }
        }
        if self
            .relocation
            .next_deadline_reduced(now, self.options.reduce_motion)
            .is_some()
        {
            let p =
                self.relocation
                    .sample(now, self.options.size.height(), self.options.reduce_motion);
            gesture.dy += p.dy * scale;
            gesture.sy *= p.sy;
            gesture.opacity *= p.alpha;
        }
        if let Some(image) = &coco_image {
            canvas.frame_placement = None;
            Frames::draw_image(&mut canvas, image, scale, gesture, true);
            canvas.head_drop = (canvas.sprite_bounds.3 as f64 * COCO_HEAD_DROP).round();
        }
        if !self
            .store
            .get("linesHidden")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            if let Some(text) = self.current_line(now) {
                let task_line = self
                    .shown
                    .task
                    .as_ref()
                    .is_some_and(|task| text == self.project_task(task));
                if task_line && !self.ui.hover_visible {
                    let font = 12.;
                    let line = self.project_task(self.shown.task.as_deref().unwrap());
                    let width = (crate::ui::text_width(
                        &self.shown.project,
                        &self.shown.lang,
                        font,
                        true,
                        false,
                    ) + crate::ui::text_width(
                        line.strip_prefix(self.shown.project.as_str())
                            .unwrap_or(&line),
                        &self.shown.lang,
                        font,
                        false,
                        false,
                    ) + 32.)
                        .ceil()
                        .min(260.);
                    let (x, y, w, h) = canvas.sprite_bounds;
                    let y = y as f64 + canvas.head_drop;
                    let visible = self.native_ui_viewport.unwrap_or(crate::ui::Rect {
                        x: 0.,
                        y: 0.,
                        width: canvas.width as f64 / scale,
                        height: canvas.height as f64 / scale,
                    });
                    let b = crate::ui::pill_bounds(
                        crate::ui::Rect {
                            x: x as f64 / scale,
                            y: y / scale,
                            width: w as f64 / scale,
                            height: h as f64 / scale,
                        },
                        visible,
                        width,
                        22.,
                    );
                    if b.width > 32. {
                        canvas.task_pill(
                            TextRun {
                                text,
                                lang: self.shown.lang.clone(),
                                x: (b.x + 22.) * scale,
                                y: (b.y + 3.) * scale,
                                width: (b.width - 32.) * scale,
                                height: 17. * scale,
                                font_size: 12. * scale,
                                line_height: None,
                            },
                            self.shown.project.chars().count(),
                            scale,
                        );
                    }
                } else if !task_line {
                    let font = self.options.size.font_size();
                    let (width, height) = crate::ui::text_metrics(
                        &text,
                        &self.shown.lang,
                        font,
                        false,
                        false,
                        264.,
                        font * 1.6 * 5.,
                    );
                    let height = (height * scale).min(
                        (canvas.sprite_bounds.1 as f64 + canvas.head_drop - 28. * scale).max(1.),
                    );
                    let width = width * scale;
                    canvas.paper(
                        TextRun {
                            text,
                            lang: self.shown.lang.clone(),
                            x: (canvas.width as f64 - width) / 2.,
                            y: (canvas.sprite_bounds.1 as f64 + canvas.head_drop
                                - 20. * scale
                                - height)
                                .max(8. * scale),
                            width,
                            height,
                            font_size: font * scale,
                            line_height: None,
                        },
                        scale,
                    );
                }
                if self.shown.live_count >= 2 {
                    if let (Some(index), Some(decor), Some(pill)) = (
                        self.shown.ribbon,
                        self.decor.as_ref(),
                        canvas.bubble.as_ref(),
                    ) {
                        let x = pill.x + if canvas.bubble_is_task { -10. } else { 4. } * scale;
                        let y = pill.y - if canvas.bubble_is_task { 9. } else { 10. } * scale;
                        decor.ribbon(&mut canvas, index, x, y, 8, scale, self.ui.dark);
                    }
                }
            }
        }
        if let Some(decor) = &self.decor {
            decor.helpers_on_ledge(
                &mut canvas,
                &self.shown.helpers,
                now,
                self.options.size,
                scale,
                self.ui.dark,
                self.options.reduce_motion,
                self.helpers_left,
                self.on_ledge(),
            );
            decor.neighbours(
                &mut canvas,
                &self.shown.neighbours,
                now,
                self.options.size,
                scale,
                self.ui.dark,
                self.options.reduce_motion,
                self.helpers_left,
                self.shown.neighbours_enabled,
            );
            let canvas_room = (canvas.width as f64
                - canvas.sprite_bounds.0 as f64
                - canvas.sprite_bounds.2 as f64)
                / scale;
            let on_ledge = self.on_ledge();
            let (_, room_from_frame_right, bottom_visible) =
                self.native_shed_context
                    .unwrap_or((on_ledge, canvas_room, true));
            let room = room_from_frame_right + canvas.sprite_bounds.2 as f64 / scale
                - decor.shed_left(self.options.size, scale)
                - if on_ledge { 16. } else { 0. };
            // Their own shell change replaces the painted skin and pages, which were drawn for his frames.
            decor.shed(
                &mut canvas,
                &ShedSample::default(),
                self.options.size,
                scale,
                on_ledge,
                room,
                self.options.size.pixel() && bottom_visible,
            );
            if let Some(visitor) = &self.shown.visitor {
                // they are always Coco now (DECISIONS 929), so the visitor sits on their figure
                decor.visitor_on_coco(
                    &mut canvas,
                    visitor,
                    now,
                    self.shown.mood == "sleep",
                    self.options.size,
                    scale,
                    self.ui.dark,
                    self.options.reduce_motion,
                );
            }
        }
        self.paint_stick(&mut canvas, now, scale);
        self.ui.companion_frame = crate::ui::Rect {
            x: canvas.sprite_bounds.0 as f64 / scale,
            y: canvas.sprite_bounds.1 as f64 / scale,
            width: canvas.sprite_bounds.2 as f64 / scale,
            height: canvas.sprite_bounds.3 as f64 / scale,
        };
        let idle_height = self.coco_height(scale);
        let idle = self.coco.idle_geometry(idle_height, scale);
        if let Some(idle) = idle {
            let frame = self.ui.companion_frame;
            self.ui.set_idle_geometry(
                frame.y + idle.top / scale,
                (frame.x + idle.hair.0 / scale, frame.y + idle.hair.1 / scale),
            );
        }
        self.ui.visible_rect = self.native_ui_viewport.unwrap_or(crate::ui::Rect {
            x: 0.,
            y: 0.,
            width: canvas.width as f64 / scale,
            height: canvas.height as f64 / scale,
        });
        if compose_hover {
            self.ui.paint_hover(&mut canvas, scale);
        }
        self.ui.companion_line = canvas.bubble.as_ref().map(|run| run.text.clone());
        canvas
    }
    /// His stick, small, at the bottom right of his picture: his desk side, never beside his face.
    fn paint_stick(&self, canvas: &mut Canvas, now: u64, scale: f64) {
        let Some((start, end)) = self.shown.stick else {
            return;
        };
        let after = now.saturating_sub(end as u64);
        if (now as f64) < start || after >= crate::stick::END_MS {
            return;
        }
        let ended = (now as f64 >= end).then_some(after);
        let steps = crate::stick::burned(start, end, now);
        let image = crate::stick::image(steps, ended, self.ui.dark, self.ui.high_contrast);
        let pixel = (0.3 * self.options.size.height() / image.height as f64 * scale).max(1.);
        let (x, y, w, h) = canvas.sprite_bounds;
        let left = x as f64 + w as f64 - image.width as f64 * pixel * 1.4;
        let top = y as f64 + h as f64 - image.height as f64 * pixel;
        canvas.overlay(&image, left, top, pixel, 1., 0., None);
    }
    pub fn paint_pill_ribbon(&self, canvas: &mut Canvas, scale: f64) {
        if self.shown.live_count < 2 {
            return;
        }
        if let (Some(index), Some(decor), Some(pill)) = (
            self.shown.ribbon,
            self.decor.as_ref(),
            canvas.bubble.as_ref(),
        ) {
            let (x, y) = (
                pill.x + if canvas.bubble_is_task { -10. } else { 4. } * scale,
                pill.y - if canvas.bubble_is_task { 9. } else { 10. } * scale,
            );
            decor.ribbon(canvas, index, x, y, 8, scale, self.ui.dark);
        }
    }
    pub fn current_line(&self, now: u64) -> Option<String> {
        if let Some(w) = self.wake {
            if now < w.start + 220 {
                return None;
            }
        }
        // Its own lines (shaken, petted, woken, a neighbour done) are Coco's: Claudie and maid Claudie leave them
        // unsaid (owner 10-17); what the plugin sends is already theirs or nothing.
        if let Some((line, start, until)) = self.line.as_ref().filter(|_| self.shown.claudie.is_none()) {
            if now >= *start && now < *until {
                return Some(line.clone());
            }
        }
        let until = self
            .shown
            .shared_line_until()
            .unwrap_or(self.shown.at + 60_000.);
        if now as f64 >= self.shown.at && (now as f64) < until {
            if self.shown.said.is_some() {
                return self.shown.said.clone();
            }
        }
        if !self.shown.rest && now as f64 - self.shown.at < 600_000. {
            self.shown.task.as_ref().map(|task| self.project_task(task))
        } else {
            None
        }
    }
    /// The task as they show it, and while a task list runs where it is («task 3/7»), after the language's comma.
    fn project_task(&self, task: &str) -> String {
        let line = self.project_line(task);
        match &self.shown.place {
            Some(place) => format!("{line}{}{place}", crate::ui::part_separator(&self.shown.lang)),
            None => line,
        }
    }
    /// The project, then the task, put together the way the language's `companion.projectTask` says. Every
    /// template starts with {project}, so the bold prefix is the project.
    fn project_line(&self, task: &str) -> String {
        if self.shown.project.is_empty() {
            return task.to_owned();
        }
        let template = crate::ui::word(&self.shown.lang, "companion.projectTask", 0);
        let mut out = String::new();
        let mut rest = template.as_str();
        while let Some(at) = rest.find('{') {
            out.push_str(&rest[..at]);
            rest = &rest[at..];
            if let Some(tail) = rest.strip_prefix("{project}") {
                out.push_str(&self.shown.project);
                rest = tail;
            } else if let Some(tail) = rest.strip_prefix("{task}") {
                out.push_str(task);
                rest = tail;
            } else {
                out.push('{');
                rest = &rest[1..];
            }
        }
        out.push_str(rest);
        out
    }
    pub fn maintain(&mut self, now: u64) {
        self.advance(now);
    }
    fn advance(&mut self, now: u64) {
        if self.nap.is_some_and(|nap| nap.wake_at.is_some_and(|at| now >= at)) {
            // Back from the lid: the existing wake, one line from his wake pool, nothing else.
            self.nap = None;
            self.local_awake_at = Some(now);
            self.wake = Some(Wake {
                start: now,
                drag: false,
                held: false,
                opening: None,
            });
            if let Some(line) = self
                .projection
                .wake_line(&self.shown.lang, &format!("nap:{now}"))
                .filter(|_| !crate::stick::burning(self.shown.stick, now))
            {
                self.line = Some((line, now + 220, now + 220 + 2600));
            }
        }
        self.pointer_fade.advance(now);
        self.repeat_impulses
            .retain(|at| now < at.saturating_add(600));
        if self.reaction.as_ref().is_some_and(|r| now >= r.until) {
            self.reaction = None;
        }
        if self.line.as_ref().is_some_and(|(_, _, end)| now >= *end) {
            self.line = None;
        }
        if self.wake.is_some_and(|w| {
            if let Some(opening) = w.opening {
                now >= opening + 160
            } else {
                now >= w.start + 450 && (!w.held || self.press.is_none())
            }
        }) {
            self.wake = None;
        }
        if self
            .presence_store
            .as_ref()
            .and_then(PresenceStore::next_deadline)
            .is_some_and(|at| at <= now)
        {
            self.presence_event(now);
        }
        if let Some(log) = &mut self.request_log {
            let _ = log.cleanup(now as f64);
        }
        self.update_shown(now);
        self.ui.sync(&self.sessions, now as f64);
        self.ui.tick(now);
    }
    fn motion_held(&self, now: u64) -> bool {
        self.shed
            .sample(now, self.options.size, self.options.reduce_motion)
            .active
            || self.press.is_some()
            || self.wake.is_some()
            || self.reaction.as_ref().is_some_and(|r| now < r.until)
            || self.current_line(now).is_some()
            || !self.shown.rest
            || self.shown.loop_frames.is_some() && (now as f64) < self.shown.at + 600_000.
            || (now as f64)
                < self.shown.at
                    + match self.shown.mood.as_str() {
                        "happy" => 3000.,
                        "wave" | "flustered" => 2600.,
                        "error" => 12000.,
                        "refuse" => 20000.,
                        "snake" => 3600.,
                        _ => 0.,
                    }
    }
    fn animation_moves(&self, now: u64) -> bool {
        let held = self.motion_held(now);
        if !self.settle.moves(
            now,
            held,
            self.visible && !self.is_hidden(now),
            self.shown.mood == "sleep",
        ) {
            return false;
        }
        if held {
            return true;
        }
        let next = if let Some(track) = &self.timeline {
            self.timeline_start
                + track
                    .next_change_ms(now.saturating_sub(self.timeline_start) as f64)
                    .ceil() as u64
        } else {
            return false;
        };
        self.settle.filter_deadline(now, next, false).is_some()
    }
    /// Current prepared pose/face/transform; native renderers add placement geometry afterward.
    pub fn visual(&self, now: u64) -> (String, Face, Gesture) {
        let mut name = self.shown.frame.clone();
        let mut face = Face::Open;
        let mut gesture = Gesture::default();
        if self.animation_moves(now) {
            if let Some(t) = &self.timeline {
                if t.second_at(now.saturating_sub(self.timeline_start) as f64) {
                    if let Some(frames) = &self.shown.loop_frames {
                        name = frames[1].clone();
                    } else {
                        face = Face::Closed;
                    }
                } else if let Some(frames) = &self.shown.loop_frames {
                    name = frames[0].clone();
                }
            }
        }
        if let Some(w) = self.wake {
            let t = now.saturating_sub(w.start) as f64;
            if !self.options.reduce_motion {
                if t < 50. {
                    gesture.sy = 1. - 0.03 * ease(t / 50.);
                } else {
                    gesture.sy = 1. + spring(-0.03, t - 50., 0.5, 200., 10.);
                }
                gesture.sx = 1. + (1. - gesture.sy) * 0.3;
                name = if w.drag {
                    if t < 33. {
                        "sleep"
                    } else {
                        "error"
                    }
                } else if w.held && self.press.is_some() {
                    "sleep"
                } else if t < 33. {
                    "sleep"
                } else if t < 220. || (330. ..400.).contains(&t) {
                    "idle-blink"
                } else {
                    "idle-reading"
                }
                .into();
                // Approved wake cuts already contain their sleeping/blinking eyes.
                // Only half-lid entries apply a face patch to idle-reading.
                face = if name == "sleep" || name == "idle-blink" {
                    Face::Open
                } else if t < 220. {
                    Face::Closed
                } else if t < 330. {
                    Face::Half
                } else if t < 400. {
                    Face::Closed
                } else if t < 450. {
                    Face::Half
                } else {
                    Face::Open
                };
                if w.held && self.press.is_some() {
                    gesture.sy = 1. - 0.03 * ease(t / 200.);
                    face = Face::Open;
                }
                if let Some(opening) = w.opening {
                    face = if now < opening + 80 {
                        Face::Half
                    } else {
                        Face::Open
                    };
                    name = "idle-reading".into();
                    gesture.sy =
                        1. + spring(-0.03, now.saturating_sub(opening) as f64, 0.5, 200., 10.);
                }
                return (name, face, gesture);
            } else {
                name = "idle-reading".into();
            }
        }
        if let Some(r) = &self.reaction {
            if now >= r.start && now < r.until {
                gesture = Gesture::default();
                let t = now.saturating_sub(r.start) as f64;
                match r.key.as_str() {
                    "pat" => {
                        if name == "idle-blink" {
                            name = "idle-reading".into();
                        }
                        face = if t < 40. {
                            r.from_face
                        } else if t < 120. {
                            Face::Half
                        } else if t < 260. {
                            Face::Closed
                        } else if t < 1250. {
                            Face::Smile
                        } else if t < 1340. {
                            Face::Half
                        } else {
                            Face::Open
                        };
                        if !self.options.reduce_motion {
                            let press = if t < 260. {
                                -0.03 * ease(t / 260.)
                            } else if t < 1050. {
                                -0.03
                                    - 0.008
                                        * if !r.native_sequence && (520.0..=880.).contains(&t) {
                                            ((t - 520.) / 360. * std::f64::consts::PI).sin()
                                        } else {
                                            0.
                                        }
                            } else {
                                spring(-0.03, t - 1050., 0.5, 180., 13.)
                            };
                            let press = if let Some(release) = r.release {
                                let since = now.saturating_sub(release) as f64;
                                if since >= 600. {
                                    0.
                                } else {
                                    spring(
                                        -0.03 * ease(release.saturating_sub(r.start) as f64 / 260.),
                                        since,
                                        0.5,
                                        180.,
                                        13.,
                                    )
                                }
                            } else {
                                press
                            };
                            gesture.sy = 1. + press;
                            gesture.sx = 1. - press * 0.3;
                            gesture.skew = (1f64.to_radians()).tan()
                                * if let Some(release) = r.release {
                                    let since = now.saturating_sub(release) as f64;
                                    if since >= 600. {
                                        0.
                                    } else {
                                        spring(
                                            smooth(release.saturating_sub(r.start) as f64 / 320.),
                                            since,
                                            0.5,
                                            180.,
                                            13.,
                                        )
                                    }
                                } else if t < 320. {
                                    smooth(t / 320.)
                                } else if t < 1050. {
                                    1.
                                } else {
                                    spring(1., t - 1050., 0.5, 180., 13.)
                                };
                            if let (Some(release), Some(from)) = (r.release, r.release_from) {
                                let p = PressTransform::release(
                                    from,
                                    now.saturating_sub(release) as f64,
                                );
                                gesture.sx = p.sx;
                                gesture.sy = p.sy;
                                gesture.skew = p.skew;
                            }
                        }
                    }
                    "flustered" => {
                        name = if (402.0..1772.).contains(&t) {
                            "snake"
                        } else {
                            "idle-reading"
                        }
                        .into();
                        face = Face::Squeeze;
                        if !self.options.reduce_motion {
                            gesture.sy = 1.
                                + if t < 60. {
                                    -0.06 * ease(t / 60.)
                                } else {
                                    spring(-0.06, t - 60., 0.5, 260., 9.)
                                };
                            gesture.sx = 1. - (gesture.sy - 1.) * 0.5;
                            gesture.skew = shake(t).to_radians().tan();
                            for switch in [380., 1750.] {
                                let d = t - switch;
                                if (0.0..500.).contains(&d) {
                                    gesture.sy += dip(d);
                                    gesture.sx += -dip(d) * 0.3;
                                }
                            }
                        }
                    }
                    "hold" | "hold-tight" => name = "refuse".into(),
                    "spin" => {
                        let sample = if self.options.reduce_motion {
                            shake::SpinSample {
                                frame: "flustered",
                                sx: 1.,
                                skew: 0.,
                            }
                        } else {
                            shake::spin_sample(
                                t,
                                false,
                                false,
                            )
                        };
                        name = sample.frame.into();
                        face = Face::Squeeze;
                        gesture.sx = sample.sx;
                        gesture.skew = sample.skew;
                    }
                    "drag" => name = "error".into(),
                    "drop" => {
                        name = "idle-reading".into();
                        face = Face::Closed;
                        if !self.options.reduce_motion {
                            gesture.sy = 1. + spring(-0.07, t, 0.5, 260., 9.);
                            gesture.sx = 1. - (gesture.sy - 1.) * 0.3;
                        }
                    }
                    "wave" => {
                        name = "wave".into();
                        if !self.options.reduce_motion {
                            gesture.skew = 0.025 * (t / 110.).sin() * (-t / 600.).exp();
                        }
                    }
                    _ => name = self.shown.frame.clone(),
                }
                if r.native_sequence {
                    let (native_name, native_face) = crate::motion::touch_sequence(
                        &r.key,
                        &r.from_name,
                        t as u64,
                        self.options.reduce_motion,
                        |name| PAINTED_POSES.contains(&name),
                    );
                    name = native_name;
                    face = match native_face.as_str() {
                        "half" => Face::Half,
                        "closed" => Face::Closed,
                        "smile" => Face::Smile,
                        "squeeze" => Face::Squeeze,
                        _ => Face::Open,
                    };
                    if !self.options.reduce_motion {
                        match r.key.as_str() {
                            "pat" => {
                                gesture.sy *= crate::motion::pat_stroke(t);
                            }
                            "flustered" => {
                                let mut sy = 1. + dip(t) * 2.4;
                                let mut sx = 1. - dip(t) * 1.2;
                                for start in [325., 1695.] {
                                    if t >= start && t < start + 451. {
                                        let d = dip(t - start);
                                        sy += d;
                                        sx -= d * 0.3;
                                    }
                                }
                                gesture.sy = sy;
                                gesture.sx = sx;
                                gesture.skew = native_shake(t).tan();
                            }
                            "hold" => {
                                gesture.sy = 1. + dip(t);
                                gesture.sx = 1. - dip(t) * 0.3;
                            }
                            "drag" => {
                                gesture.sy = 1. + spring(-0.03, t, 0.5, 260., 9.);
                            }
                            "drop" => {
                                gesture.sy = 1. + spring(-0.07, t, 0.5, 260., 9.);
                                gesture.sx = 1. + spring(0.03, t, 0.5, 260., 9.);
                            }
                            "wave" | "thanks" => {
                                gesture.sy = 1. + dip(t);
                                gesture.sx = 1. - dip(t) * 0.3;
                                gesture.skew = 0.;
                            }
                            _ => {}
                        }
                    }
                }
            }
        }
        if let Some(start) = self.press {
            let t = now.saturating_sub(start) as f64;
            if !self.options.reduce_motion {
                let p = PressTransform::sample(self.press_from, t, self.press_repeat);
                gesture.sy = p.sy;
                gesture.sx = p.sx;
                gesture.skew = p.skew;
            }
            if name == "idle-reading" {
                face = if self.options.reduce_motion {
                    if t < 260. {
                        Face::Closed
                    } else if t < 1400. {
                        Face::Smile
                    } else {
                        Face::Open
                    }
                } else if t < 40. {
                    face
                } else if t < 120. {
                    Face::Half
                } else {
                    Face::Closed
                };
            }
        }
        if !self.options.reduce_motion {
            for at in &self.repeat_impulses {
                if now >= *at && now < at + 600 {
                    gesture.sy += PressTransform::impulse(now.saturating_sub(*at) as f64);
                }
            }
        }
        (name, face, gesture)
    }
    pub fn next_deadline_ms(&self, now: u64) -> Option<u64> {
        let mut deadlines = Vec::new();
        // Their clips are drawn by the frame ticks of coco_deadline (DECISIONS 929: no painted frames).
        if let Some(at) = self.ui.next_deadline(now) {
            deadlines.push(at);
        }
        if self.visible && !self.is_hidden(now) {
            if now < self.neighbour_glance_until {
                deadlines.push(self.neighbour_glance_until);
            }
            if now < self.pointer_glance_until {
                deadlines.push(self.pointer_glance_until);
            }
            if let Some(at) = self.drag_face.next_deadline(now) {
                deadlines.push(at);
            }
            if let Some(at) = self.line_flip.next_deadline(now) {
                deadlines.push(at);
            }
            if let Some(at) = self
                .relocation
                .next_deadline_reduced(now, self.options.reduce_motion)
            {
                deadlines.push(at);
            }
        }
        if self.visible
            && !self.is_hidden(now)
            && now < self.geometry_until
            && !self.options.reduce_motion
        {
            deadlines.push((now + 16).min(self.geometry_until));
        }
        if self.visible && !self.is_hidden(now) && self.current_line(now).is_some() {
            if let Some(at) = self.pointer_fade.next_deadline(now) {
                deadlines.push(at);
            }
        }
        if self.visible && !self.is_hidden(now) {
            if self.shown.neighbours_enabled {
                if let Some(at) = crate::decor::neighbours_next_deadline(
                    &self.shown.neighbours,
                    now,
                    self.options.size.pixel(),
                ) {
                    deadlines.push(at);
                }
            }
            if let Some(at) = self.shed.next_frame_deadline(now, self.options.size) {
                deadlines.push(at);
            }
            if let Some(at) = self.coco_deadline(now) {
                deadlines.push(at);
            }
            if let Some(at) = crate::decor::helpers_next_deadline(
                &self.shown.helpers,
                now,
                self.options.size,
                self.options.reduce_motion,
            ) {
                deadlines.push(at);
            }
            if let Some(at) = crate::decor::visitor_next_deadline(
                self.shown.visitor.as_ref(),
                now,
                self.shown.mood == "sleep",
                self.options.reduce_motion,
            ) {
                deadlines.push(at);
            }
        }
        if let Some(at) = self.nap.and_then(|nap| nap.wake_at) {
            deadlines.push(at);
        }
        if let Some(store) = &self.presence_store {
            if let Some(at) = store.next_deadline() {
                deadlines.push(at);
            }
        }
        if let Some(log) = &self.request_log {
            if let Some(at) = log.next_expiry() {
                deadlines.push(at.ceil() as u64);
            }
        }
        let hidden = self.hidden_until_ms();
        if hidden > now {
            deadlines.push(hidden);
            return deadlines.into_iter().filter(|at| *at > now).min();
        }
        if !self.visible {
            return deadlines.into_iter().filter(|at| *at > now).min();
        }
        if let Some(r) = &self.reaction {
            if now < r.start {
                deadlines.push(r.start);
            }
            if now < r.until {
                deadlines.push(r.until);
            }
        }
        if let Some(w) = self.wake {
            if let Some(opening) = w.opening {
                deadlines.push(opening + 160);
            } else if !w.held || self.press.is_none() {
                // his first line waits for the 220, and the wake ends at the 450
                for offset in [220, 450] {
                    deadlines.push(w.start + offset);
                }
            }
        }
        if let Some((_, start, end)) = &self.line {
            deadlines.extend([*start, *end]);
        }
        if self.shown.said.is_some() {
            deadlines.push(
                self.shown
                    .shared_line_until()
                    .unwrap_or(self.shown.at + 60_000.) as u64,
            );
        }
        if self.shown.loop_frames.is_some() || self.shown.task.is_some() {
            deadlines.push((self.shown.at + 600_000.) as u64);
        }
        deadlines.into_iter().filter(|at| *at > now).min()
    }
    #[cfg(target_os = "linux")]
    pub fn presence_descriptors(&self) -> Vec<i32> {
        self.presence_store
            .as_ref()
            .map(|store| store.descriptors())
            .unwrap_or_default()
    }
    #[cfg(windows)]
    pub fn windows_presence_handle(&self) -> Option<usize> {
        self.presence_store
            .as_ref()
            .and_then(|p| p.windows_event_handle())
    }
    pub fn presence_event(&mut self, now: u64) {
        if let Some(store) = &mut self.presence_store {
            match store.decide(now) {
                Ok(Some(s)) => {
                    self.projection.receive(s);
                }
                Ok(None) => {}
                Err(e) => {
                    if self.options.trace {
                        eprintln!("presence: {e}");
                    }
                }
            }
        }
    }
    fn save(&mut self) -> Result<(), Error> {
        if !self.options.folder.is_dir() {
            return Ok(());
        }
        #[cfg(target_os = "linux")]
        crate::state::omit_away(&mut self.store);
        if let Some(class) = self
            .options
            .follow_class
            .as_deref()
            .filter(|class| valid_follow_class(class))
        {
            self.store["followClass"] = json!(class);
        }
        self.store["pid"] = json!(std::process::id());
        self.store["version"] = json!(env!("CARGO_PKG_VERSION"));
        self.store["size"] = json!(self.options.size);
        self.store
            .as_object_mut()
            .expect("validated settings object")
            .entry("running")
            .or_insert(json!(true));
        // Linux has no way to keep a window out of screenshots, so its pet offers no switch.
        #[cfg(not(target_os = "linux"))]
        self.store
            .as_object_mut()
            .expect("validated settings object")
            .entry("capture")
            .or_insert(json!(true));
        atomic_write(
            &self.options.folder.join("companion.json"),
            &serde_json::to_vec_pretty(&self.store)?,
        )?;
        let keys = [
            "running",
            "accessibility",
            "hiddenUntil",
            "answered",
            "size",
            "sizeAt",
            "loginAt",
            "followAt",
            "login",
            "capture",
            "captureAt",
            "version",
            "away",
        ];
        let info: serde_json::Map<String, Value> = keys
            .into_iter()
            .filter_map(|key| {
                self.store
                    .get(key)
                    .cloned()
                    .map(|value| (key.to_owned(), value))
            })
            .collect();
        let mut bytes = serde_json::to_vec(
            &json!({"v":1,"kind":"companion-state","at":crate::epoch_ms(),"info":info}),
        )?;
        bytes.push(b'\n');
        if bytes.len() < 2048 {
            let mut options = OpenOptions::new();
            options.append(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
            }
            #[cfg(windows)]
            {
                use std::os::windows::fs::OpenOptionsExt;
                options.custom_flags(0x0020_0000);
            }
            if let Ok(mut file) = options.open(self.options.folder.join("requests.jsonl")) {
                crate::protocol::ensure_regular_handle(&file)?;
                file.write_all(&bytes)?;
            }
        }
        Ok(())
    }
}
impl Drop for Engine {
    fn drop(&mut self) {
        if self.started {
            self.store["running"] = json!(false);
            if let Err(error) = self.save() {
                if self.options.trace {
                    eprintln!("companion stop: {error}");
                }
            }
            self.started = false;
        }
    }
}

fn valid_follow_class(class: &str) -> bool {
    !class.is_empty() && class.chars().count() <= 256 && !class.contains('\0')
}
fn smooth(t: f64) -> f64 {
    let t = t.clamp(0., 1.);
    t * t * (3. - 2. * t)
}
fn ease(t: f64) -> f64 {
    let x = t.clamp(0., 1.);
    if x == 0. || x == 1. {
        return x;
    }
    let mut low = 0.;
    let mut high = 1.;
    for _ in 0..24 {
        let v = (low + high) / 2.;
        let bx = 0.6 * (1. - v) * v * v + v * v * v;
        if bx < x {
            low = v
        } else {
            high = v
        }
    }
    let v = (low + high) / 2.;
    3. * (1. - v) * v * v + v * v * v
}
fn dip(ms: f64) -> f64 {
    if ms < 55. {
        -0.025 * ease(ms / 55.)
    } else {
        spring(-0.025, ms - 55., 0.5, 220., 12.6)
    }
}
fn spring(x: f64, ms: f64, m: f64, k: f64, d: f64) -> f64 {
    let t = ms / 1000.;
    let alpha = d / (2. * m);
    let omega = (k / m - alpha * alpha).sqrt();
    x * (-alpha * t).exp() * ((omega * t).cos() + alpha / omega * (omega * t).sin())
}
fn shake(t: f64) -> f64 {
    let points = [
        (0., 0.),
        (70., -2.5),
        (140., 2.3),
        (210., -1.6),
        (280., 1.1),
        (350., -0.5),
        (420., 0.),
    ];
    for pair in points.windows(2) {
        if t >= pair[0].0 && t < pair[1].0 {
            let u = smooth((t - pair[0].0) / (pair[1].0 - pair[0].0));
            return pair[0].1 + (pair[1].1 - pair[0].1) * u;
        }
    }
    0.
}
fn native_shake(t: f64) -> f64 {
    let values = [0., -0.07, 0.07, -0.045, 0.045, 0.];
    if !(0.0..360.0).contains(&t) {
        return 0.;
    }
    let u = t / 360. * 5.;
    let i = u.floor() as usize;
    values[i] + (values[i + 1] - values[i]) * u.fract()
}

fn read_bounded(path: &Path, limit: usize) -> std::io::Result<Vec<u8>> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.file_type().is_file() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "not a regular companion file",
        ));
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x0020_0000);
    }
    let file = options.open(path)?;
    crate::protocol::ensure_regular_handle(&file)?;
    let mut bytes = Vec::new();
    file.take(limit as u64 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > limit {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "companion file exceeds limit",
        ));
    }
    Ok(bytes)
}
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), Error> {
    let temp = path.with_file_name(format!(
        ".companion-{}-{}.tmp",
        std::process::id(),
        crate::epoch_ms()
    ));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
    }
    let mut file = options.open(&temp)?;
    let written = file.write_all(bytes);
    drop(file);
    if let Err(error) = written {
        let _ = fs::remove_file(&temp);
        return Err(error.into());
    }
    #[cfg(not(windows))]
    let result = fs::rename(&temp, path).map_err(|e| -> Error { Box::new(e) });
    #[cfg(windows)]
    let result = {
        use std::os::windows::ffi::OsStrExt;
        use windows::{
            core::PCWSTR,
            Win32::Storage::FileSystem::{
                MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
            },
        };
        let a: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
        let b: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        unsafe {
            MoveFileExW(
                PCWSTR(a.as_ptr()),
                PCWSTR(b.as_ptr()),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        }
        .map_err(|e| -> Error { Box::new(e) })
    };
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}
