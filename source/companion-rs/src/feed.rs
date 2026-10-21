use crate::motion::MotionModel;
use crate::protocol::{Presence, Requests};
use crate::reactions::{english_reactions, ReactionLines};
use serde_json::Value;
use std::collections::BTreeMap;
pub fn bundled_word(lang: &str, key: &str) -> Option<&'static str> {
    static WORDS: std::sync::OnceLock<Value> = std::sync::OnceLock::new();
    let words = WORDS.get_or_init(|| {
        serde_json::from_str(include_str!("../assets/words/feed.json")).expect("bundled feed words")
    });
    words
        .get(lang)
        .or_else(|| words.get("en"))?
        .get(key)?
        .as_str()
}

pub const FEED_LIMIT: usize = 256 * 1024;
pub const SESSION_LIFETIME: f64 = 12.0 * 3_600_000.0;
#[derive(Clone, Debug, PartialEq)]
pub struct Reply {
    pub text: String,
    pub at: f64,
}
#[derive(Clone, Debug, PartialEq)]
pub struct Notice {
    pub kind: String,
    pub text: String,
    pub at: f64,
}
/// The DM thread while Talk is on (the plugin's dm.ts; the owner's card of 10-17 late: one thread in the plugin and on
/// the pet, read or reply on either): her messages not seen yet, the newest that reached the closed thread for the
/// system's notification, the thread's newest messages, and lane B's words for the window.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Dm {
    pub unread: usize,
    pub notice: Option<DmNotice>,
    pub thread: Vec<DmLine>,
    /// The thread's name (more.talk.label: «DMs», «小窗»).
    pub label: String,
    /// The field's placeholder (more.talk.placeholder).
    pub placeholder: String,
    /// The person lets a new message notify (the bag's switch under DMs; on unless turned off).
    pub notify: bool,
}
#[derive(Clone, Debug, PartialEq)]
pub struct DmLine {
    /// The person's own message; hers otherwise.
    pub mine: bool,
    pub text: String,
}
#[derive(Clone, Debug, PartialEq)]
pub struct DmNotice {
    pub id: String,
    pub at: f64,
    pub title: String,
    pub body: String,
}
/// The newest messages the window keeps (the plugin sends at most this many, companion.ts COMPANION_DM_LINES).
pub const DM_LINES: usize = 20;
impl Dm {
    pub fn parse(v: &Value) -> Option<Self> {
        if !v.is_object() {
            return None;
        }
        let text = |v: &Value, key: &str, limit: usize| {
            v.get(key)
                .and_then(Value::as_str)
                .filter(|s| s.chars().count() <= limit && !s.contains('\0'))
                .map(str::to_owned)
        };
        let notice = v.get("notice").and_then(|n| {
            Some(DmNotice {
                id: text(n, "id", 64).filter(|id| !id.is_empty())?,
                at: n.get("at").and_then(Value::as_f64).filter(|at| at.is_finite() && *at > 0.)?,
                title: text(n, "title", 64).unwrap_or_default(),
                body: text(n, "body", 400).filter(|body| !body.trim().is_empty())?,
            })
        });
        let lines = v.get("thread").and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default();
        let thread = lines[lines.len().saturating_sub(DM_LINES)..]
            .iter()
            .filter_map(|line| {
                let side = line.get("side").and_then(Value::as_str)?;
                let text = text(line, "text", 1000).filter(|t| !t.trim().is_empty())?;
                matches!(side, "person" | "him").then(|| DmLine { mine: side == "person", text })
            })
            .collect();
        let words = v.get("words").cloned().unwrap_or(Value::Null);
        Some(Self {
            unread: v.get("unread").and_then(Value::as_u64).unwrap_or(0).min(999) as usize,
            notice,
            thread,
            label: text(&words, "label", 64).unwrap_or_default(),
            placeholder: text(&words, "placeholder", 128).unwrap_or_default(),
            notify: v.get("notify").and_then(Value::as_bool).unwrap_or(true),
        })
    }
}
#[derive(Clone, Debug, PartialEq)]
pub struct Record {
    pub quota: Option<crate::ui::Quota>,
    pub ribbon: Option<u8>,
    pub live_count: usize,
    /// The stick he keeps for the person, as the plugin shares it: when it was lit and when it ends.
    pub stick: Option<(f64, f64)>,
    pub helpers: Vec<crate::decor::Helper>,
    pub shed: Option<crate::decor::ShedEvent>,
    /// A visitor on him while he dozes, or just leaving (design VISITORS.md 3).
    pub visitor: Option<crate::decor::Visitor>,
    pub neighbours_enabled: bool,
    pub neighbours: Vec<crate::decor::NeighbourLight>,
    pub notices: bool,
    pub long_task: String,
    pub dm: Option<Dm>,
    pub busy_since: u64,
    pub session: String,
    pub presence: Option<Presence>,
    pub project: String,
    /// The session's folder, where New chat starts the terminal version (new_chat.rs); a plain local path or none.
    pub cwd: Option<String>,
    pub task: Option<String>,
    /// Where the task list is while it runs, in the plugin's words («task 3/7», c3 tasks.short); none otherwise.
    pub place: Option<String>,
    pub done: f64,
    pub wait_at: f64,
    pub reply: Option<Reply>,
    pub notice: Option<Notice>,
    pub ack: Option<String>,
    pub channel: bool,
    pub ended: bool,
    pub desktop: bool,
    pub at: f64,
    pub summon: f64,
    pub requests: Requests,
    pub mood: String,
    pub frame: String,
    /// The tool pose he holds (search, scroll, tea, ...): its name only.
    pub pose: Option<String>,
    /// Which of their two outfits they wear, A or B, when the plugin says.
    pub outfit: Option<String>,
    /// The pair from their sock drawer (a plain lowercase key), when it is not their own.
    pub socks: Option<String>,
    /// Claude's form when it is not Coco: "dake" or "maid" (claudie.rs).
    pub claudie: Option<String>,
    pub loop_frames: Option<[String; 2]>,
    pub every: Option<f64>,
    pub motion: MotionModel,
    pub rest: bool,
    pub said: Option<String>,
    pub slip: bool,
    pub context: Option<i64>,
    pub estimate: bool,
    pub lang: String,
    pub name: String,
    pub aside: String,
    pub words: BTreeMap<String, String>,
    pub reactions: ReactionLines,
    pub presence_recipes: Option<Value>,
}
impl Default for Record {
    fn default() -> Self {
        Self::resting()
    }
}
impl Record {
    pub fn resting() -> Self {
        Self {
            quota: None,
            ribbon: None,
            live_count: 1,
            stick: None,
            helpers: Vec::new(),
            shed: None,
            visitor: None,
            neighbours_enabled: false,
            neighbours: Vec::new(),
            notices: false,
            long_task: "off".into(),
            dm: None,
            busy_since: 0,
            session: String::new(),
            presence: None,
            project: String::new(),
            cwd: None,
            task: None,
            place: None,
            done: 0.0,
            wait_at: 0.0,
            reply: None,
            notice: None,
            ack: None,
            channel: false,
            ended: false,
            desktop: true,
            at: 0.0,
            summon: 0.0,
            requests: Requests::default(),
            mood: "idle".into(),
            frame: "idle-reading".into(),
            pose: None,
            outfit: None,
            socks: None,
            claudie: None,
            loop_frames: None,
            every: None,
            motion: MotionModel::default(),
            rest: true,
            said: None,
            slip: false,
            context: None,
            estimate: false,
            lang: "en".into(),
            name: "Coco".into(),
            aside: String::new(),
            words: default_words(),
            reactions: english_reactions(),
            presence_recipes: None,
        }
    }
    pub fn parse(bytes: &[u8]) -> Result<Self, &'static str> {
        if bytes.is_empty() || bytes.len() > FEED_LIMIT {
            return Err("invalid feed size");
        };
        let object: Value = serde_json::from_slice(bytes).map_err(|_| "invalid feed JSON")?;
        Self::from_value(&object)
    }
    pub fn from_value(v: &Value) -> Result<Self, &'static str> {
        if !v.is_object() {
            return Err("feed must be an object");
        };
        let session = v
            .get("session")
            .and_then(Value::as_str)
            .ok_or("missing session")?;
        let at = v
            .get("at")
            .and_then(Value::as_f64)
            .filter(|n| n.is_finite())
            .ok_or("invalid timestamp")?;
        if session.len() > 256 {
            return Err("session too long");
        };
        let mut r = Self::resting();
        r.session = session.into();
        r.at = at;
        let string = |key: &str| {
            v.get(key)
                .and_then(Value::as_str)
                .filter(|s| s.len() <= 8192)
                .map(str::to_owned)
        };
        let positive = |key: &str| {
            v.get(key)
                .and_then(Value::as_f64)
                .filter(|n| n.is_finite() && *n > 0.0)
                .unwrap_or(0.0)
        };
        let boolean =
            |key: &str, default: bool| v.get(key).and_then(Value::as_bool).unwrap_or(default);
        if let Some(presence) = v.get("presence") {
            r.presence = Presence::from_value(presence);
            r.presence_recipes = Some(presence.clone())
        }
        r.project = string("project").unwrap_or_default();
        r.cwd = string("cwd").filter(|folder| crate::new_chat::local_folder(folder));
        r.quota = v.get("quota").and_then(crate::ui::Quota::parse);
        r.ribbon = v
            .get("ribbon")
            .and_then(Value::as_u64)
            .filter(|n| *n < 256)
            .map(|n| n as u8);
        r.live_count = v.get("liveCount").and_then(Value::as_u64).unwrap_or(1) as usize;
        r.stick = v.get("stick").and_then(|stick| {
            let start = stick.get("startedAt")?.as_f64().filter(|n| n.is_finite())?;
            let end = stick.get("endsAt")?.as_f64().filter(|n| n.is_finite())?;
            (end > start && end - start <= 90. * 60_000.).then_some((start, end))
        });
        r.helpers = v
            .get("helpers")
            .and_then(|n| serde_json::from_value(n.clone()).ok())
            .unwrap_or_default();
        r.shed = v
            .get("shed")
            .and_then(|n| serde_json::from_value(n.clone()).ok());
        r.visitor = v
            .get("visitor")
            .and_then(|n| serde_json::from_value(n.clone()).ok());
        r.neighbours_enabled = boolean("neighbours", false);
        r.neighbours = v
            .get("neighbourLights")
            .and_then(|n| serde_json::from_value(n.clone()).ok())
            .unwrap_or_default();
        r.long_task = string("longTask").unwrap_or_else(|| "off".into());
        r.notices = match v.get("notices") {
            Some(Value::Bool(on)) => *on,
            Some(_) => {
                return Err(crate::os_metadata::approved_word(
                    "gaps.run.failed",
                    v.get("lang").and_then(Value::as_str).unwrap_or("en"),
                ))
            }
            None => r.long_task == "notify",
        };
        r.dm = v.get("dm").and_then(Dm::parse);
        r.busy_since = v.get("busySince").and_then(Value::as_u64).unwrap_or(0);
        r.task = string("task").filter(|s| !s.is_empty());
        r.place = string("place")
            .filter(|s| !s.is_empty() && s.chars().count() <= 40 && !s.chars().any(char::is_control));
        r.done = positive("done");
        r.wait_at = positive("waitAt");
        if let Some(reply) = v.get("reply") {
            if let (Some(text), Some(at)) = (
                reply.get("text").and_then(Value::as_str),
                reply.get("at").and_then(Value::as_f64),
            ) {
                if !text.is_empty() && text.len() <= 8192 && at.is_finite() && at > 0.0 {
                    r.reply = Some(Reply {
                        text: text.into(),
                        at,
                    })
                }
            }
        }
        if let Some(notice) = v.get("notice") {
            if let (Some(text), Some(at)) = (
                notice.get("text").and_then(Value::as_str),
                notice.get("at").and_then(Value::as_f64),
            ) {
                if !text.is_empty() && text.len() <= 8192 && at.is_finite() && at > 0.0 {
                    r.notice = Some(Notice {
                        kind: notice
                            .get("kind")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .into(),
                        text: text.into(),
                        at,
                    })
                }
            }
        }
        r.ack = string("ack");
        r.channel = boolean("channel", false);
        r.ended = boolean("ended", false);
        r.desktop = boolean("desktop", true);
        r.summon = positive("summon");
        r.requests = Requests::from_value(v);
        r.mood = string("mood").unwrap_or(r.mood);
        r.frame = string("frame").unwrap_or(r.frame);
        r.pose = v
            .get("pose")
            .and_then(|pose| pose.get("name"))
            .and_then(Value::as_str)
            .filter(|name| !name.is_empty() && name.len() <= 64)
            .map(str::to_owned);
        r.outfit = string("outfit").filter(|outfit| matches!(outfit.as_str(), "A" | "B"));
        r.socks = string("socks").filter(|pair| {
            (2..=24).contains(&pair.len()) && pair.bytes().all(|b| b.is_ascii_lowercase())
        });
        r.claudie = string("claudie").filter(|form| crate::claudie::FORMS.contains(&form.as_str()));
        if let (Some(loop_frames), Some(every)) = (
            v.get("loop").and_then(Value::as_array),
            v.get("every").and_then(Value::as_f64),
        ) {
            if loop_frames.len() == 2 && every.is_finite() && every >= 100.0 {
                if let (Some(a), Some(b)) = (loop_frames[0].as_str(), loop_frames[1].as_str()) {
                    if a.len() <= 64 && b.len() <= 64 {
                        r.loop_frames = Some([a.into(), b.into()]);
                        r.every = Some(every)
                    }
                }
            }
        }
        if let Some(model) = v
            .get("motion")
            .and_then(|m| serde_json::from_value::<MotionModel>(m.clone()).ok())
            .filter(MotionModel::valid)
        {
            r.motion = model
        }
        r.rest = boolean("rest", r.mood == "idle" || r.mood == "sleep");
        r.said = string("said").filter(|s| !s.is_empty());
        r.slip = boolean("slip", false);
        r.context = v.get("context").and_then(Value::as_i64);
        r.estimate = boolean("estimate", false);
        r.lang = string("lang").unwrap_or(r.lang);
        // Apply approved language defaults before explicit feed overrides.
        for key in default_words().keys() {
            if let Some(value) = bundled_word(&r.lang, key) {
                r.words.insert(key.clone(), value.into());
            }
        }
        r.name = string("name").unwrap_or_else(|| crate::ui::word(&r.lang, "tray.tip", 0));
        r.aside = string("aside").unwrap_or_default();
        for key in [
            "menu.backWindow",
            "menu.follow",
            "menu.stopFollow",
            "pick.help",
            "tray.tip",
            "tray.tipUnseen",
            "activity.close",
        ] {
            r.words.insert(key.into(), crate::ui::word(&r.lang, key, 0));
        }
        if let Some(reactions) = v.get("reactions").and_then(Value::as_object) {
            for (key, value) in reactions {
                if key.len() > 64 {
                    continue;
                }
                let Ok(lines) = serde_json::from_value::<Vec<String>>(value.clone()) else {
                    continue;
                };
                if !lines.is_empty() && lines.len() <= 128 && lines.iter().all(|s| s.len() <= 8192)
                {
                    r.reactions.insert(key.clone(), lines);
                }
            }
        }
        if let Some(words) = v.get("words").and_then(Value::as_object) {
            for (key, value) in words {
                if let Some(text) = value.as_str().filter(|s| s.len() <= 8192) {
                    if key.len() <= 128 {
                        r.words.insert(key.clone(), text.into());
                    }
                }
            }
        }
        for key in ["back", "opens"] {
            if let Some(text) = r.words.get(key).cloned() {
                r.words.insert(format!("{key}Template"), text.clone());
                r.words.insert(key.into(), text.replace("{app}", "Claude"));
            }
        }
        Ok(r)
    }
    pub fn app_word(&self, key: &str, app: &str) -> String {
        self.words
            .get(&format!("{key}Template"))
            .map(String::as_str)
            .unwrap_or(self.word(key))
            .replace("{app}", app)
    }
    pub fn has_default_words(&self) -> bool {
        static DEFAULTS: std::sync::OnceLock<BTreeMap<String, String>> = std::sync::OnceLock::new();
        self.words == *DEFAULTS.get_or_init(default_words)
    }
    pub fn word<'a>(&'a self, key: &'a str) -> &'a str {
        self.words.get(key).map(String::as_str).unwrap_or(key)
    }
    pub fn shared_line_until(&self) -> Option<f64> {
        let p = self.presence.as_ref()?;
        if self.said.is_some()
            && self.said == p.said
            && ["sleep", "wake", "clingy"].contains(&p.kind.as_str())
        {
            Some(p.at + 14_000.0)
        } else {
            None
        }
    }
    pub fn apply_presence(&self, p: &Presence, now: f64) -> Self {
        let mut shown = self.clone();
        shown.presence = Some(p.clone());
        if p.asleep {
            shown.mood = "sleep".into();
            shown.frame = "sleep".into();
            shown.loop_frames = None;
            shown.every = None;
            shown.rest = true;
            shown.slip = false;
            shown.said = None;
        } else if shown.mood == "sleep" {
            shown.mood = "idle".into();
            shown.frame = "idle-reading".into();
            shown.loop_frames = None;
            shown.every = None;
            shown.rest = true;
            shown.slip = false;
            shown.said = None;
        }
        if p.kind == "sleep" || p.kind == "wake" || p.kind == "clingy" && p.said.is_some() {
            if now >= p.at && now - p.at < 14_000.0 {
                shown.said = p.said.clone();
                shown.at = shown.at.max(p.at);
                shown.slip = false;
            } else if self.at <= p.at + 14_000.0 {
                shown.said = None;
                shown.slip = false;
            }
        }
        shown
    }
}
#[derive(Clone, Debug, PartialEq)]
pub struct ActivityRow {
    pub record: Record,
    pub state: String,
    pub unseen: bool,
    pub excerpt: Option<String>,
}
#[derive(Clone, Debug, Default)]
pub struct Sessions {
    pub seen_at: f64,
    pub claude_frontmost: bool,
    pub records: BTreeMap<String, Record>,
    newest: BTreeMap<String, f64>,
    finished_seen: BTreeMap<String, f64>,
    row_seen_at: BTreeMap<String, f64>,
    pub presence: Option<Presence>,
    pub latest_requests: Requests,
    pub latest_summon: f64,
}
impl Sessions {
    pub fn receive(&mut self, record: Record, now: f64) -> bool {
        self.prune(now);
        if !record.at.is_finite()
            || record.at
                < self
                    .newest
                    .get(&record.session)
                    .copied()
                    .unwrap_or(f64::NEG_INFINITY)
        {
            return false;
        }
        self.newest.insert(record.session.clone(), record.at);
        if let Some(p) = &record.presence {
            self.receive_presence(p.clone());
        }
        self.latest_summon = self.latest_summon.max(record.summon);
        self.latest_requests.merge(&record.requests);
        if record.ended || now - record.at >= SESSION_LIFETIME {
            self.records.remove(&record.session);
            self.finished_seen.remove(&record.session);
            self.row_seen_at.remove(&record.session);
        } else {
            if self.claude_frontmost {
                self.finished_seen
                    .entry(record.session.clone())
                    .and_modify(|n| *n = n.max(record.done))
                    .or_insert(record.done);
            }
            self.records.insert(record.session.clone(), record);
        }
        true
    }
    pub fn receive_presence(&mut self, incoming: Presence) {
        let accept = self.presence.as_ref().is_none_or(|held| {
            let same = incoming.event_id == held.event_id
                && incoming.kind == held.kind
                && incoming.asleep == held.asleep;
            let wake = held.asleep
                && !incoming.asleep
                && incoming.kind == "wake"
                && incoming.at >= held.at;
            incoming.seq > held.seq || incoming.seq == held.seq && (same || wake)
        });
        if accept {
            self.presence = Some(incoming)
        }
    }
    pub fn prune(&mut self, now: f64) {
        self.newest
            .retain(|_, stamp| now - *stamp < SESSION_LIFETIME);
        self.records
            .retain(|_, r| !r.ended && now - r.at < SESSION_LIFETIME);
        self.finished_seen
            .retain(|k, _| self.records.contains_key(k));
        self.row_seen_at.retain(|k, _| self.records.contains_key(k));
    }
    pub fn live(&self, now: f64) -> Vec<&Record> {
        let mut live: Vec<_> = self
            .records
            .values()
            .filter(|r| !r.ended && now - r.at < SESSION_LIFETIME)
            .collect();
        live.sort_by(|a, b| {
            b.at.total_cmp(&a.at)
                .then_with(|| a.session.cmp(&b.session))
        });
        live
    }
    pub fn shown(&self, now: f64) -> Record {
        let live = self.live(now);
        let desktops = live.iter().any(|r| r.desktop);
        let pool: Vec<_> = live
            .into_iter()
            .filter(|r| !desktops || r.desktop)
            .collect();
        let selected = pool
            .iter()
            .copied()
            .find(|r| !r.rest && now - r.at < 30.0 * 60_000.0)
            .or_else(|| pool.first().copied())
            .cloned()
            .unwrap_or_else(Record::resting);
        self.presence
            .as_ref()
            .map(|p| selected.apply_presence(p, now))
            .unwrap_or(selected)
    }
    pub fn set_claude_frontmost(&mut self, active: bool) {
        self.claude_frontmost = active;
        if active {
            for r in self.records.values() {
                self.finished_seen
                    .entry(r.session.clone())
                    .and_modify(|n| *n = n.max(r.done))
                    .or_insert(r.done);
            }
        }
    }
    pub fn open_activity(&mut self, now: f64) -> Vec<Record> {
        self.prune(now);
        let held = self
            .live(now)
            .into_iter()
            .filter(|r| r.reply.is_some() || r.notice.is_some())
            .cloned()
            .collect();
        self.seen_at = self.seen_at.max(now);
        for r in self.records.values() {
            self.finished_seen
                .entry(r.session.clone())
                .and_modify(|n| *n = n.max(r.done))
                .or_insert(r.done);
            self.row_seen_at
                .entry(r.session.clone())
                .and_modify(|n| *n = n.max(now))
                .or_insert(now);
        }
        held
    }
    pub fn mark_seen(&mut self, session: &str, now: f64) -> Option<Record> {
        self.prune(now);
        let r = self.records.get(session)?.clone();
        self.row_seen_at
            .entry(session.into())
            .and_modify(|n| *n = n.max(now))
            .or_insert(now);
        self.finished_seen
            .entry(session.into())
            .and_modify(|n| *n = n.max(r.done))
            .or_insert(r.done);
        Some(r)
    }
    pub fn forget(&mut self) {
        self.records.clear();
        self.newest.clear();
        self.finished_seen.clear();
        self.row_seen_at.clear();
        self.presence = None;
    }
    fn threshold(&self, r: &Record) -> f64 {
        self.seen_at
            .max(self.row_seen_at.get(&r.session).copied().unwrap_or(0.0))
    }
    fn unseen_finish(&self, r: &Record) -> bool {
        r.done
            > self
                .threshold(r)
                .max(self.finished_seen.get(&r.session).copied().unwrap_or(0.0))
    }
    fn unseen_notice(&self, r: &Record) -> bool {
        r.notice.as_ref().map(|n| n.at).unwrap_or(0.0) > self.threshold(r)
    }
    pub fn is_unseen(&self, r: &Record) -> bool {
        (["waiting", "question"].contains(&r.mood.as_str()) && r.wait_at > self.threshold(r))
            || self.unseen_finish(r)
            || self.unseen_notice(r)
    }
    pub fn unseen_count(&self, now: f64) -> usize {
        self.live(now)
            .into_iter()
            .filter(|r| self.is_unseen(r))
            .count()
    }
    pub fn rows(&self, now: f64) -> Vec<ActivityRow> {
        let mut live = self.live(now);
        live.sort_by(|a, b| {
            self.is_unseen(b)
                .cmp(&self.is_unseen(a))
                .then_with(|| b.at.total_cmp(&a.at))
                .then_with(|| a.session.cmp(&b.session))
        });
        live.into_iter()
            .take(6)
            .map(|r| {
                let state = if r.mood == "waiting" {
                    r.word("waitingOK").to_owned()
                } else if r.mood == "question" {
                    r.word("waitingAnswer").to_owned()
                } else if !r.rest && r.task.is_some() {
                    r.task.clone().unwrap()
                } else if self.unseen_notice(r) {
                    r.notice.as_ref().unwrap().text.clone()
                } else if r.done > 0.0 {
                    r.word("finished").into()
                } else {
                    r.word("ready").into()
                };
                let excerpt = r
                    .reply
                    .as_ref()
                    .filter(|reply| self.unseen_finish(r) && reply.at > self.threshold(r))
                    .map(|reply| reply.text.chars().take(140).collect());
                ActivityRow {
                    record: r.clone(),
                    state,
                    unseen: self.is_unseen(r),
                    excerpt,
                }
            })
            .collect()
    }
}
fn default_words() -> BTreeMap<String, String> {
    [
    ("pat","pat coco's head"),("hide","Hide for an hour"),("home","Put Coco back"),("quit","Quit Coco Pet"),("context","context"),("size","Size"),("tiny","Extra small"),("small","Small"),("medium","Medium"),("large","Large"),("larger","Larger"),
    ("followMenu","Let Coco follow the window…"),("offerTitle","May I follow your window?"),("offerBody","Then I can stand right beside it wherever you move it. macOS asks for your OK first. I only see where the window is, never what's in it."),("yes","Yes, follow it"),("later","Not now"),("waitTitle","Switch me on in System Settings"),("waitBody","Privacy & Security › Accessibility › Coco Pet. If macOS asks first, choose to open System Settings."),("open","Open System Settings"),("close","Close"),("thanks","thanks, i'll keep up with your window ✨"),
    ("thinking","thinking"),("reading","reading {file}"),("editing","editing {file}"),("running","running {cmd}"),("searching","searching"),("web","searching the web"),("helper","a helper is working"),("planning","planning"),("using","using {tool}"),("waitingOK","waiting for your OK"),("waitingAnswer","waiting for your answer"),
    ("activity","Activity"),("activityMenu","Activity…"),("empty","Nothing yet."),("ready","ready"),("finished","finished"),("placeholder","Tell Claude…"),("send","Send"),("sending","Sending…"),("unconfirmed","Not sure it arrived"),("retry","Retry"),("expired","Timed out"),("dictate","Dictate"),("newChat","New chat"),("newChatTerminal","Terminal"),("newChatDesktop","Claude app"),("newChatVSCode","VS Code"),("confirmClear","Clear this conversation in {project}?"),("clear","Clear"),("cancel","Cancel"),("badge","{n} new. Opens Activity."),("opens","Opens Claude."),("opensTemplate","Opens {app}."),("back","Back to Claude"),("backTemplate","Back to {app}"),("hideLines","Hide Coco's lines"),("showLines","Show Coco's lines"),("patMenu","Pat Coco's head"),("actions","Actions"),("actWave","Wave"),("actHug","Hug"),("actFlustered","Fluster"),("login","Open at login"),("hideMenu","Hide"),("hideHour","For an hour"),("hideUntil","Until I call Coco back")].into_iter().map(|(k,v)|(k.into(),v.into())).collect()
}
