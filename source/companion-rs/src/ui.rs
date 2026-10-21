//! Shared, event-driven companion UI. Geometry comes from Activity.swift and SPEC 0.4 §6.
use crate::{
    feed::{ActivityRow, Record, Sessions},
    protocol::{request_decision, ChannelRequest, RequestDecision, RequestKind},
    render::{Canvas, Size, TextRun},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Surface {
    #[default]
    Companion,
    Activity,
    Menu,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum UiPlatform {
    #[default]
    Windows,
    X11,
    Wayland,
}
#[derive(Clone, Debug)]
pub struct MenuContext {
    pub platform: UiPlatform,
    pub back_app: String,
    pub back_available: bool,
    pub following: bool,
    pub lines_hidden: bool,
    pub size: Size,
    /// The faces of Claude Code this computer has (new_chat::detect), for the New chat rows.
    pub new_chat: Vec<crate::new_chat::Client>,
    /// Whether the pet starts at login; `None` leaves the switch out.
    pub login: Option<bool>,
}
impl Default for MenuContext {
    fn default() -> Self {
        Self {
            platform: UiPlatform::Windows,
            back_app: "Claude".into(),
            back_available: false,
            following: false,
            lines_hidden: false,
            size: Size::Large,
            new_chat: Vec::new(),
            login: None,
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MenuAction {
    Activity,
    /// The Activity window on the DM thread (the plugin's dm.ts).
    Dm,
    Back,
    ToggleLines,
    BeginFollow,
    StopFollow,
    Hide,
    /// Hidden until the person calls it back: no timer is set.
    HideUntilCalled,
    Home,
    SizeMenu,
    Size(Size),
    /// From the menu's play group: a pat, a wave, a hug, the same fluster three quick clicks bring.
    Pat,
    Wave,
    Hug,
    Fluster,
    /// New chat in this face of Claude Code (new_chat.rs), the terminal one in the shown session's folder.
    NewChat(crate::new_chat::Client),
    ToggleLogin,
    Quit,
}
#[derive(Clone, Debug)]
pub struct MenuRow {
    pub label: String,
    pub enabled: bool,
    pub action: Option<MenuAction>,
    pub separator: bool,
    /// A switch: `Some(on)` draws its state.
    pub checked: Option<bool>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Control {
    Row(String),
    Field,
    Target,
    Send,
    NewChat,
    Close,
    Menu(usize),
    Hover(usize),
    Badge,
    Submenu(usize),
    /// The Activity window's switch between the sessions and the DM thread.
    DmToggle,
    /// One message of the DM thread, read and never pressed.
    DmLine(usize),
}
#[derive(Clone, Debug)]
pub enum UiAction {
    Menu(MenuAction),
    Request(ChannelRequest),
    Close,
    SelectRow(String),
    /// Open a new conversation in this face of Claude Code (new_chat.rs), the terminal one in this folder.
    NewChat(crate::new_chat::Client, Option<String>),
}
#[derive(Clone, Copy, Debug)]
pub enum Key {
    Tab { shift: bool },
    Enter,
    Escape,
    Backspace,
    Delete,
    Left,
    Right,
    Home,
    End,
}
#[derive(Clone, Copy, Debug)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
impl Rect {
    pub fn contains(self, x: f64, y: f64) -> bool {
        x >= self.x && x < self.x + self.width && y >= self.y && y < self.y + self.height
    }
}
#[derive(Clone, Debug)]
pub struct Element {
    pub control: Control,
    pub label: String,
    pub bounds: Rect,
    pub enabled: bool,
}
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Quota {
    pub windows: Vec<QuotaWindow>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct QuotaWindow {
    pub kind: String,
    pub name: String,
    pub used: Option<f64>,
    pub reset: Option<f64>,
    pub pace: Option<String>,
    pub hot: bool,
}
impl Quota {
    pub fn parse(v: &Value) -> Option<Self> {
        let rates = v
            .get("rateLimits")
            .or_else(|| v.get("windows"))
            .and_then(Value::as_array)?;
        let mut seen = std::collections::BTreeSet::new();
        let windows = rates
            .iter()
            .filter_map(|w| {
                let kind = w.get("kind")?.as_str()?.to_owned();
                if !["five_hour", "seven_day"].contains(&kind.as_str())
                    || !seen.insert(kind.clone())
                {
                    return None;
                }
                let used = w
                    .get("percentUsed")
                    .or_else(|| w.get("usedPercentage"))
                    .and_then(Value::as_f64)
                    .filter(|n| n.is_finite())
                    .map(|n| n.clamp(0., 100.));
                Some(QuotaWindow {
                    name: w
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or(if kind == "five_hour" {
                            "5-hour"
                        } else {
                            "7-day"
                        })
                        .into(),
                    used,
                    reset: w
                        .get("resetsAt")
                        .or_else(|| w.get("resetAt"))
                        .and_then(crate::locale::parse_reset),
                    pace: w.get("pace").and_then(Value::as_str).map(str::to_owned),
                    hot: w.get("hot").and_then(Value::as_bool).unwrap_or_else(|| {
                        v.get("hot").and_then(Value::as_str) == Some(kind.as_str())
                    }),
                    kind,
                })
            })
            .collect::<Vec<_>>();
        (!windows.is_empty()).then_some(Self { windows })
    }
    pub fn narrow(&self, lang: &str) -> String {
        self.windows
            .iter()
            .map(|w| {
                format!(
                    "{} {}{}",
                    quota_word(lang, "narrow")
                        .get(&w.kind)
                        .and_then(Value::as_str)
                        .unwrap_or(&w.name),
                    w.used
                        .map(|v| if matches!(lang, "zh" | "zh-Hant") {
                            quota_word(lang, "narrowUsed")
                                .as_str()
                                .unwrap()
                                .replace("{p}", &format!("{:.0}", v.round()))
                        } else {
                            crate::locale::percent(v, lang)
                        })
                        .unwrap_or_else(|| "—".into()),
                    w.pace
                        .as_ref()
                        .filter(|_| w.hot)
                        .map(|s| format!(", {s}"))
                        .unwrap_or_default()
                )
            })
            .collect::<Vec<_>>()
            .join(part_separator(lang))
    }
    pub fn example() -> Self {
        Self {
            windows: vec![
                QuotaWindow {
                    kind: "five_hour".into(),
                    name: "5-hour".into(),
                    used: Some(62.),
                    reset: Some(1_791_236_400_000.),
                    pace: Some("out ~1h 5m".into()),
                    hot: true,
                },
                QuotaWindow {
                    kind: "seven_day".into(),
                    name: "7-day".into(),
                    used: Some(20.),
                    reset: Some(1_791_705_600_000.),
                    pace: None,
                    hot: false,
                },
            ],
        }
    }
}
impl QuotaWindow {
    pub fn display_name(&self, lang: &str) -> String {
        quota_word(lang, "kinds")
            .get(&self.kind)
            .and_then(Value::as_str)
            .unwrap_or(&self.name)
            .to_owned()
    }
    pub fn announcement(&self, lang: &str) -> String {
        self.announcement_parts(lang, self.pace.as_deref())
            .join(part_separator(lang))
    }
    /// The foot's clauses in order: window and used, the pace when it is hot, the reset.
    pub fn announcement_parts(&self, lang: &str, pace: Option<&str>) -> Vec<String> {
        let used = self
            .used
            .map(|n| {
                quota_word(lang, "used")
                    .as_str()
                    .unwrap_or("{percent}% used")
                    .replace("{percent}", &format!("{n:.0}"))
            })
            .unwrap_or_else(|| "—".into());
        let mut parts = vec![format!("{} {}", self.display_name(lang), used)];
        if let Some(pace) = pace.filter(|_| self.hot) {
            parts.push(pace.to_owned());
        }
        if let Some(reset) = self.reset {
            parts.push(
                quota_word(lang, "resets")
                    .as_str()
                    .unwrap_or("resets {time}")
                    .replace(
                        "{time}",
                        &moment_text(reset, crate::epoch_ms() as f64, lang),
                    ),
            );
        }
        parts
    }
}
/// What joins the clauses of a quota foot, a tray label or a row heading: the language's own comma.
/// The DM thread's bubbles (UiState::dm_bubbles): the text size, the widest bubble, the tallest thread, the insets,
/// and the gaps: between two messages from the same side, where the other side answers (and before the field).
const DM_TEXT: f64 = 12.5;
const DM_BUBBLE_WIDTH: f64 = 216.;
const DM_THREAD_HEIGHT: f64 = 300.;
const DM_PAD_X: f64 = 10.;
const DM_PAD_Y: f64 = 6.;
const DM_GAP_SAME: f64 = 3.;
const DM_GAP: f64 = 9.;
/// The unread dot's room on the Activity window's DM switch.
const DM_DOT_ROOM: f64 = 10.;
pub fn part_separator(lang: &str) -> &'static str {
    match lang {
        "zh" | "zh-Hant" => ",",
        "ja" => "、",
        _ => ", ",
    }
}
fn quota_word(lang: &str, key: &str) -> &'static Value {
    static WORDS: std::sync::OnceLock<Value> = std::sync::OnceLock::new();
    let words = WORDS.get_or_init(|| {
        serde_json::from_str(include_str!("../assets/words/quota.json"))
            .expect("approved quota words")
    });
    &words.get(lang).unwrap_or(&words["en"])[key]
}
pub fn word(lang: &str, key: &str, n: usize) -> String {
    static WORDS: std::sync::OnceLock<[Value; 4]> = std::sync::OnceLock::new();
    for v in WORDS.get_or_init(|| {
        [
            include_str!("../assets/words/1.0.json"),
            include_str!("../assets/words/0.4.json"),
            include_str!("../assets/words/0.3.json"),
            include_str!("../assets/words/0.2.json"),
        ]
        .map(|source| serde_json::from_str(source).expect("approved companion words"))
    }) {
        let Some(values) = v.get(key) else { continue };
        let value = values.get(lang).or_else(|| values.get("en"));
        if let Some(v) = value {
            let s = v.as_str().or_else(|| {
                v.get(if n == 1 { "one" } else { "other" })
                    .and_then(Value::as_str)
            });
            if let Some(s) = s {
                return s.replace("{n}", &n.to_string());
            }
        }
    }
    key.to_owned()
}
pub struct RowHeading {
    pub first: String,
    pub project_chars: usize,
    pub second: Option<String>,
}
pub fn menu_rows(record: &Record, context: &MenuContext) -> Vec<MenuRow> {
    let mut rows = Vec::new();
    let mut add = |rows: &mut Vec<MenuRow>, label: String, action: MenuAction| {
        rows.push(MenuRow {
            label,
            enabled: true,
            action: Some(action),
            separator: false,
            checked: None,
        });
    };
    let rule = |rows: &mut Vec<MenuRow>| {
        rows.push(MenuRow {
            label: String::new(),
            enabled: false,
            action: None,
            separator: true,
            checked: None,
        });
    };
    // Five groups, the Mac pet's order: what Claude is doing, playing with it, how it looks, where it lives, quit.
    if let Some(q) = &record.quota {
        add(&mut rows, q.narrow(&record.lang), MenuAction::Activity);
    }
    add(&mut rows, record.word("activity").into(), MenuAction::Activity);
    if let Some(dm) = record.dm.as_ref().filter(|dm| !dm.label.is_empty()) {
        add(&mut rows, dm.label.clone(), MenuAction::Dm);
    }
    // One face on this computer opens at once; more than one are named after the word.
    for face in &context.new_chat {
        let label = if context.new_chat.len() == 1 {
            record.word("newChat").to_owned()
        } else {
            format!("{}: {}", record.word("newChat"), record.word(face.word()))
        };
        add(&mut rows, label, MenuAction::NewChat(*face));
    }
    if context.back_available && context.platform != UiPlatform::Wayland {
        add(
            &mut rows,
            if context.platform == UiPlatform::X11 {
                word(&record.lang, "menu.backWindow", 0)
            } else {
                record.app_word("back", &context.back_app)
            },
            MenuAction::Back,
        );
    }
    rule(&mut rows);
    add(&mut rows, record.word("patMenu").into(), MenuAction::Pat);
    add(&mut rows, record.word("actWave").into(), MenuAction::Wave);
    add(&mut rows, record.word("actHug").into(), MenuAction::Hug);
    add(&mut rows, record.word("actFlustered").into(), MenuAction::Fluster);
    rule(&mut rows);
    add(&mut rows, record.word("size").into(), MenuAction::SizeMenu);
    add(
        &mut rows,
        record
            .word(if context.lines_hidden {
                "showLines"
            } else {
                "hideLines"
            })
            .into(),
        MenuAction::ToggleLines,
    );
    if context.platform == UiPlatform::X11 {
        add(
            &mut rows,
            word(&record.lang, "menu.follow", 0),
            MenuAction::BeginFollow,
        );
        if context.following {
            add(
                &mut rows,
                word(&record.lang, "menu.stopFollow", 0),
                MenuAction::StopFollow,
            );
        }
    }
    rule(&mut rows);
    // The flat list has no submenu for Hide: the hour keeps its own words, the other is named with the menu's.
    add(&mut rows, record.word("hide").into(), MenuAction::Hide);
    add(
        &mut rows,
        format!("{}: {}", record.word("hideMenu"), record.word("hideUntil")),
        MenuAction::HideUntilCalled,
    );
    add(&mut rows, record.word("home").into(), MenuAction::Home);
    if let Some(on) = context.login {
        rows.push(MenuRow {
            label: record.word("login").into(),
            enabled: true,
            action: Some(MenuAction::ToggleLogin),
            separator: false,
            checked: Some(on),
        });
    }
    rule(&mut rows);
    add(
        &mut rows,
        word(&record.lang, "menu.quit", 0),
        MenuAction::Quit,
    );
    rows
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TrayHead {
    Awake,
    Asleep,
    Unseen,
    AsleepUnseen,
}
#[derive(Clone, Debug)]
pub struct TrayState {
    pub state: TrayHead,
    pub unseen: usize,
    pub tooltip: String,
}
pub fn tray_state(s: &Sessions, now: f64) -> TrayState {
    let unseen = s.unseen_count(now);
    let record = s.shown(now);
    let asleep = s.presence.as_ref().is_some_and(|p| p.asleep) || record.mood == "sleep";
    TrayState {
        state: if unseen > 0 && asleep {
            TrayHead::AsleepUnseen
        } else if unseen > 0 {
            TrayHead::Unseen
        } else if s.presence.as_ref().is_some_and(|p| p.asleep) || record.mood == "sleep" {
            TrayHead::Asleep
        } else {
            TrayHead::Awake
        },
        unseen,
        tooltip: word(
            &record.lang,
            if unseen > 0 {
                "tray.tipUnseen"
            } else {
                "tray.tip"
            },
            unseen,
        ),
    }
}
#[derive(Clone, Debug)]
struct Pending {
    request: ChannelRequest,
    attempted: u64,
    phase: RequestDecision,
}
#[derive(Clone, Debug)]
pub struct UiState {
    surface: Surface,
    // Geometry is expressed in points, but native font shaping occurs at the
    // active display scale. Keep dimensions and accessibility on that same
    // measurement after the renderer selects its device scale.
    render_scale: std::cell::Cell<f64>,
    pub rows: Vec<ActivityRow>,
    pub sessions: Vec<Record>,
    pub chosen: Record,
    pub field: String,
    pub preedit: String,
    pub companion_line: Option<String>,
    pub preedit_cursor: usize,
    pub cursor: usize,
    /// Anchor and focus in Unicode scalar offsets, never UTF-8 byte offsets.
    pub selection: Option<(usize, usize)>,
    pub focus: Option<Control>,
    pub menu: Vec<MenuRow>,
    pub context: MenuContext,
    pub hover_visible: bool,
    pub hover_index: Option<usize>,
    pub hovered: Option<Control>,
    pub pressed: Option<Control>,
    pub session_apps: std::collections::BTreeMap<String, String>,
    pub companion_frame: Rect,
    idle_top: Option<f64>,
    hair_anchor: Option<(f64, f64)>,
    pub visible_rect: Rect,
    pub high_contrast: bool,
    /// The system's own colours, set only while a Windows contrast theme is on.
    pub system_palette: Option<crate::contrast::SystemPalette>,
    size_submenu: bool,
    hover_at: Option<u64>,
    leave_at: Option<u64>,
    pending: Option<Pending>,
    target_sessions: Option<Vec<String>>,
    /// The faces of Claude Code this computer has (new_chat.rs), set by the platform when the Activity opens: none
    /// means no New chat button.
    pub new_chat: Vec<crate::new_chat::Client>,
    /// More than one: the menu that asks which is open.
    new_chat_choices: Option<Vec<crate::new_chat::Client>>,
    serial: u64,
    pub dark: bool,
    pub unseen: usize,
    /// The Activity window shows the DM thread in place of the sessions.
    pub dm_open: bool,
}
impl Default for UiState {
    fn default() -> Self {
        Self {
            surface: Surface::Companion,
            render_scale: std::cell::Cell::new(1.),
            rows: vec![],
            sessions: vec![],
            chosen: Record::resting(),
            field: String::new(),
            preedit: String::new(),
            companion_line: None,
            preedit_cursor: 0,
            cursor: 0,
            selection: None,
            focus: None,
            menu: vec![],
            context: MenuContext::default(),
            hover_visible: false,
            hover_index: None,
            hovered: None,
            pressed: None,
            session_apps: Default::default(),
            companion_frame: Rect {
                x: 0.,
                y: 148.,
                width: 320.,
                height: 96.,
            },
            idle_top: None,
            hair_anchor: None,
            visible_rect: Rect {
                x: 0.,
                y: 0.,
                width: 320.,
                height: 256.,
            },
            high_contrast: false,
            system_palette: None,
            size_submenu: false,
            hover_at: None,
            leave_at: None,
            pending: None,
            target_sessions: None,
            new_chat: vec![],
            new_chat_choices: None,
            serial: 0,
            dark: false,
            unseen: 0,
            dm_open: false,
        }
    }
}
impl UiState {
    pub fn look(&self) -> crate::contrast::Look {
        crate::contrast::Look::new(self.high_contrast, self.system_palette)
    }
    /// Composition uses the field's existing glyph style and never changes the Send payload.
    pub fn display_field(&self) -> String {
        if self.preedit.is_empty()
            || self.focus != Some(Control::Field)
            || !self.enabled(&Control::Field)
        {
            return self.field.clone();
        }
        let at = self
            .field
            .char_indices()
            .nth(self.cursor)
            .map(|(i, _)| i)
            .unwrap_or(self.field.len());
        format!("{}{}{}", &self.field[..at], self.preedit, &self.field[at..])
    }
    pub fn request_status(&self) -> Option<&str> {
        let key = match self.pending.as_ref()?.phase {
            RequestDecision::Sending => "sending",
            RequestDecision::Unconfirmed => "unconfirmed",
            RequestDecision::Expired => "expired",
            _ => return None,
        };
        Some(self.chosen.word(key))
    }
    pub fn surface(&self) -> Surface {
        self.surface
    }
    /// The DM thread of the session the pet shows, while Talk is on there.
    pub fn dm(&self) -> Option<&crate::feed::Dm> {
        self.chosen.dm.as_ref()
    }
    /// Her messages not read yet.
    pub fn dm_unread(&self) -> usize {
        self.dm().map_or(0, |dm| dm.unread)
    }
    /// What the badge by her hair counts: Claude's replies not seen and her messages not read.
    pub fn badge_count(&self) -> usize {
        self.unseen + self.dm_unread()
    }
    /// The Activity window is open on the DM thread.
    pub fn dm_visible(&self) -> bool {
        self.surface == Surface::Activity && self.dm_open && self.dm().is_some()
    }
    /// The Activity window on the DM thread, the field focused where the person can write.
    pub fn open_dm(&mut self, s: &Sessions, now: f64) {
        self.open_activity(s, now);
        if self.dm().is_some() {
            self.dm_open = true;
            self.field.clear();
            self.cursor = 0;
            self.selection = None;
            self.pending = None;
            self.focus = Some(if self.enabled(&Control::Field) {
                Control::Field
            } else {
                Control::Close
            });
        }
    }
    pub fn open_activity(&mut self, s: &Sessions, now: f64) {
        self.dm_open = false;
        self.target_sessions = None;
        self.new_chat_choices = None;
        self.rows = s.rows(now);
        self.sessions = s.live(now).into_iter().cloned().collect();
        self.chosen = s.shown(now);
        self.surface = Surface::Activity;
        self.hover_visible = false;
        self.hover_at = None;
        self.leave_at = None;
        self.focus = Some(if self.chosen.channel {
            Control::Field
        } else {
            Control::Close
        });
    }
    pub fn sync(&mut self, s: &Sessions, now: f64) {
        self.unseen = s.unseen_count(now);
        let rows = s.rows(now);
        if self.surface == Surface::Activity || self.is_panel_menu() {
            self.rows = rows
                .into_iter()
                .map(|mut r| {
                    if let Some(old) = self.rows.iter().find(|old| {
                        old.record.session == r.record.session
                            && old.record.done == r.record.done
                            && old.record.wait_at == r.record.wait_at
                            && old.record.mood == r.record.mood
                            && old.record.task == r.record.task
                    }) {
                        r.unseen = old.unseen;
                        r.excerpt = r.excerpt.or_else(|| old.excerpt.clone());
                    }
                    r
                })
                .collect();
        } else {
            self.rows = rows;
        }
        self.sessions = s.live(now).into_iter().cloned().collect();
        if let Some(targets) = &self.target_sessions {
            for (index, row) in self.menu.iter_mut().enumerate() {
                row.enabled = targets.get(index).is_some_and(|session| {
                    self.sessions
                        .iter()
                        .any(|r| &r.session == session && r.channel)
                });
            }
        }
        if let Some(r) = self
            .sessions
            .iter()
            .find(|r| r.session == self.chosen.session)
        {
            self.chosen = r.clone()
        } else if self.surface == Surface::Activity || self.is_panel_menu() {
            self.chosen.channel = false
        } else {
            self.chosen = s.shown(now)
        }
        if let Some(p) = &mut self.pending {
            p.phase = request_decision(
                &p.request,
                p.attempted as f64,
                self.chosen.ack.as_deref(),
                now,
            );
            if p.phase == RequestDecision::Acknowledged {
                let dm = p.request.kind == RequestKind::Dm;
                self.field.clear();
                self.cursor = 0;
                self.selection = None;
                self.pending = None;
                // A chat goes on: the window shows the thread for her reply.
                if !dm {
                    self.close();
                } else if self.dm().is_some() {
                    self.dm_open = true;
                }
            }
        }
        if self.dm_open && self.dm().is_none() {
            self.dm_open = false;
        }
        self.tick(now as u64);
    }
    pub fn open_menu(&mut self, context: MenuContext, _now: u64) {
        self.preedit.clear();
        self.target_sessions = None;
        self.new_chat_choices = None;
        self.context = context;
        self.menu = menu_rows(&self.chosen, &self.context);
        self.surface = Surface::Menu;
        self.focus = None;
        self.size_submenu = false;
        self.hover_visible = false;
    }
    pub fn open_size_menu(&mut self, now: u64) {
        self.open_menu(self.context.clone(), now);
        self.size_submenu = true;
        self.focus = Some(Control::Submenu(
            Size::ALL
                .iter()
                .position(|s| *s == self.context.size)
                .unwrap(),
        ));
    }
    pub fn close(&mut self) {
        self.preedit.clear();
        self.target_sessions = None;
        self.new_chat_choices = None;
        self.surface = Surface::Companion;
        self.focus = None;
    }
    pub fn pointer(&mut self, inside: bool, now: u64) {
        if inside {
            self.leave_at = None;
            if !self.hover_visible && self.hover_at.is_none() {
                self.hover_at = Some(now + 350)
            }
        } else {
            self.hover_at = None;
            self.hover_index = None;
            if self.hover_visible {
                self.leave_at = Some(now + 300)
            }
        }
    }
    pub fn tick(&mut self, now: u64) {
        if self.hover_at.is_some_and(|at| now >= at) {
            self.hover_at = None;
            self.hover_visible = self.surface == Surface::Companion;
        }
        if self.leave_at.is_some_and(|at| now >= at) {
            self.leave_at = None;
            self.hover_visible = false;
        }
        if let Some(p) = &mut self.pending {
            p.phase = request_decision(
                &p.request,
                p.attempted as f64,
                self.chosen.ack.as_deref(),
                now as f64,
            )
        }
        self.reconcile_focus();
    }
    pub fn next_deadline(&self, now: u64) -> Option<u64> {
        [
            self.hover_at,
            self.leave_at,
            self.pending.as_ref().and_then(|p| match p.phase {
                RequestDecision::Sending => Some(p.attempted + 5000),
                RequestDecision::Unconfirmed => Some(p.request.at as u64 + 60_001),
                _ => None,
            }),
        ]
        .into_iter()
        .flatten()
        .filter(|n| *n > now)
        .min()
    }
    pub fn text(&mut self, text: &str) {
        if self.surface != Surface::Activity
            || self.focus != Some(Control::Field)
            || !self.enabled(&Control::Field)
        {
            return;
        }
        self.delete_selection();
        let clean = text
            .chars()
            .filter(|c| !c.is_control())
            .take(4000 - self.field.chars().count().min(4000))
            .collect::<String>();
        let byte = self
            .field
            .char_indices()
            .nth(self.cursor)
            .map(|(i, _)| i)
            .unwrap_or(self.field.len());
        self.field.insert_str(byte, &clean);
        self.cursor += clean.chars().count();
        if self.pending.as_ref().is_some_and(|p| {
            p.phase != RequestDecision::Sending
                && p.request.text.as_deref() != Some(self.field.trim())
        }) {
            self.pending = None
        }
    }
    pub fn set_text_selection(&mut self, start: usize, end: usize) -> bool {
        if self.surface != Surface::Activity
            || !self.enabled(&Control::Field)
            || start > self.field.chars().count()
            || end > self.field.chars().count()
        {
            return false;
        }
        self.preedit.clear();
        self.cursor = end;
        self.selection = (start != end).then_some((start, end));
        self.focus = Some(Control::Field);
        true
    }
    fn delete_selection(&mut self) -> bool {
        let Some((anchor, focus)) = self.selection.take() else {
            return false;
        };
        let start = anchor.min(focus);
        let end = anchor.max(focus);
        let n = self.field.chars().count();
        if start > n || end > n || start == end {
            return false;
        }
        let byte = |offset| {
            self.field
                .char_indices()
                .nth(offset)
                .map(|(i, _)| i)
                .unwrap_or(self.field.len())
        };
        self.field.replace_range(byte(start)..byte(end), "");
        self.cursor = start;
        self.pending = None;
        true
    }
    fn reconcile_focus(&mut self) {
        let Some(focus) = self.focus.as_ref() else {
            return;
        };
        let order = self.tab_order();
        if order.contains(focus) && self.enabled(focus) {
            return;
        }
        if self.surface == Surface::Activity {
            self.restore_activity_focus();
        } else {
            self.focus = order.into_iter().find(|control| self.enabled(control));
        }
    }
    pub fn tab_order(&self) -> Vec<Control> {
        match self.surface {
            Surface::Companion => {
                if self.hover_visible {
                    self.hover_indices()
                        .into_iter()
                        .map(Control::Hover)
                        .chain(
                            (self.badge_count() > 0 && self.badge_bounds().width > 0.)
                                .then_some(Control::Badge),
                        )
                        .collect()
                } else {
                    (self.badge_count() > 0)
                        .then_some(Control::Badge)
                        .into_iter()
                        .collect()
                }
            }
            Surface::Menu if self.size_submenu => (0..4).map(Control::Submenu).collect(),
            Surface::Menu => self
                .menu
                .iter()
                .enumerate()
                .filter(|(_, r)| r.enabled)
                .map(|(i, _)| Control::Menu(i))
                .collect(),
            Surface::Activity if self.dm_open => {
                let mut v = vec![];
                if self.chosen.channel {
                    v.push(Control::Field);
                    v.push(Control::Send)
                }
                v.push(Control::DmToggle);
                v.push(Control::Close);
                v
            }
            Surface::Activity => {
                let mut v = self
                    .rows
                    .iter()
                    .map(|r| Control::Row(r.record.session.clone()))
                    .collect::<Vec<_>>();
                if self.chosen.channel {
                    v.push(Control::Field);
                    if self.sessions.len() > 1 {
                        v.push(Control::Target)
                    }
                    v.push(Control::Send)
                }
                if self.dm().is_some() {
                    v.push(Control::DmToggle)
                }
                // New chat opens a new conversation elsewhere and never clears one (10-16; DECISIONS 04:2x, S1 2).
                if !self.new_chat.is_empty() {
                    v.push(Control::NewChat)
                }
                v.push(Control::Close);
                v
            }
        }
    }
    pub fn enabled(&self, c: &Control) -> bool {
        let sending = self
            .pending
            .as_ref()
            .is_some_and(|p| p.phase == RequestDecision::Sending);
        let expired = self
            .pending
            .as_ref()
            .is_some_and(|p| p.phase == RequestDecision::Expired);
        match c {
            Control::Send => self.chosen.channel && !sending && !expired,
            Control::Field | Control::Target => {
                self.chosen.channel
                    && !sending
            }
            Control::Hover(1) => {
                self.context.back_available && self.context.platform != UiPlatform::Wayland
            }
            Control::Menu(i) => self.menu.get(*i).is_some_and(|r| r.enabled),
            _ => true,
        }
    }
    pub fn key(&mut self, key: Key, now: u64) -> Option<UiAction> {
        match key {
            Key::Escape => {
                if self.size_submenu {
                    self.size_submenu = false;
                    self.focus = self
                        .menu
                        .iter()
                        .position(|r| r.action == Some(MenuAction::SizeMenu))
                        .map(Control::Menu);
                    return None;
                }
                if self.target_sessions.take().is_some() {
                    self.surface = Surface::Activity;
                    self.restore_activity_focus();
                    return None;
                }
                if self.new_chat_choices.take().is_some() {
                    self.surface = Surface::Activity;
                    self.focus = Some(Control::NewChat);
                    return None;
                }
                self.close();
                Some(UiAction::Close)
            }
            Key::Tab { shift } => {
                let order = self
                    .tab_order()
                    .into_iter()
                    .filter(|c| self.enabled(c))
                    .collect::<Vec<_>>();
                if !order.is_empty() {
                    let i = self
                        .focus
                        .as_ref()
                        .and_then(|c| order.iter().position(|v| v == c));
                    self.focus = Some(
                        order[match i {
                            Some(i) if shift => (i + order.len() - 1) % order.len(),
                            Some(i) => (i + 1) % order.len(),
                            None => 0,
                        }]
                        .clone(),
                    );
                }
                None
            }
            Key::Enter => self.activate(self.focus.clone().unwrap_or(Control::Close), now),
            Key::Left => {
                self.cursor = self
                    .selection
                    .take()
                    .map(|(a, b)| a.min(b))
                    .unwrap_or_else(|| self.cursor.saturating_sub(1));
                None
            }
            Key::Right => {
                self.cursor = self
                    .selection
                    .take()
                    .map(|(a, b)| a.max(b))
                    .unwrap_or_else(|| (self.cursor + 1).min(self.field.chars().count()));
                None
            }
            Key::Home => {
                self.selection = None;
                self.cursor = 0;
                None
            }
            Key::End => {
                self.selection = None;
                self.cursor = self.field.chars().count();
                None
            }
            Key::Backspace | Key::Delete => {
                if self.focus == Some(Control::Field) && self.enabled(&Control::Field) {
                    if self.delete_selection() {
                        return None;
                    }
                    let n = if matches!(key, Key::Backspace) {
                        self.cursor.saturating_sub(1)
                    } else {
                        self.cursor
                    };
                    if !matches!(key, Key::Backspace) || self.cursor > 0 {
                        if let Some((start, c)) = self.field.char_indices().nth(n) {
                            self.field.replace_range(start..start + c.len_utf8(), "");
                            self.cursor = n;
                            self.pending = None
                        }
                    }
                }
                None
            }
        }
    }
    pub fn activate(&mut self, c: Control, now: u64) -> Option<UiAction> {
        if !self.enabled(&c) {
            return None;
        }
        match c {
            Control::Close => {
                self.close();
                Some(UiAction::Close)
            }
            Control::Row(id) => {
                self.close();
                Some(UiAction::SelectRow(id))
            }
            Control::Field => self.activate(Control::Send, now),
            // His rule (10-16): the only face there is opens; with more than one the pet asks which.
            Control::NewChat => match self.new_chat.clone().as_slice() {
                [] => None,
                [only] => {
                    self.close();
                    Some(UiAction::NewChat(*only, self.chosen.cwd.clone()))
                }
                faces => {
                    self.preedit.clear();
                    self.target_sessions = None;
                    self.menu = faces
                        .iter()
                        .map(|face| MenuRow {
                            label: self.chosen.word(face.word()).into(),
                            enabled: true,
                            action: None,
                            separator: false,
                            checked: None,
                        })
                        .collect();
                    self.new_chat_choices = Some(faces.to_vec());
                    self.surface = Surface::Menu;
                    self.focus = Some(Control::Menu(0));
                    None
                }
            },
            Control::Target => {
                self.preedit.clear();
                self.target_sessions =
                    Some(self.sessions.iter().map(|r| r.session.clone()).collect());
                self.menu = self
                    .sessions
                    .iter()
                    .map(|r| MenuRow {
                        label: r.project.clone(),
                        enabled: r.channel,
                        action: None,
                        separator: false,
                        checked: None,
                    })
                    .collect();
                self.surface = Surface::Menu;
                self.focus = self
                    .sessions
                    .iter()
                    .position(|r| r.session == self.chosen.session && r.channel)
                    .map(Control::Menu)
                    .or_else(|| self.tab_order().first().cloned());
                None
            }
            Control::Send => {
                if self.field.trim().is_empty() {
                    return None;
                }
                // With her DM on, the box writes to her (the plugin's DM thread), in the thread or not (his call 10-20);
                // otherwise it is a note to the session.
                let kind = if self.dm_open || self.dm().is_some() {
                    RequestKind::Dm
                } else {
                    RequestKind::Submit
                };
                if let Some(p) = &mut self.pending {
                    if p.request.kind == kind
                        && p.phase == RequestDecision::Unconfirmed
                        && (!kind.written()
                            || p.request.text.as_deref() == Some(self.field.trim()))
                    {
                        p.attempted = now;
                        p.phase = RequestDecision::Sending;
                        return Some(UiAction::Request(p.request.clone()));
                    }
                }
                self.serial += 1;
                let id = format!("{:016x}{:08x}", now, self.serial);
                let request = ChannelRequest::new(
                    id,
                    self.chosen.session.clone(),
                    now as f64,
                    kind,
                    Some(&self.field),
                    None,
                )
                .ok()?;
                self.pending = Some(Pending {
                    request: request.clone(),
                    attempted: now,
                    phase: RequestDecision::Sending,
                });
                Some(UiAction::Request(request))
            }
            Control::Menu(i) => {
                if let Some(faces) = &self.new_chat_choices {
                    let face = *faces.get(i)?;
                    self.close();
                    return Some(UiAction::NewChat(face, self.chosen.cwd.clone()));
                }
                if let Some(targets) = &self.target_sessions {
                    let session = targets.get(i)?;
                    let record = self
                        .sessions
                        .iter()
                        .find(|r| &r.session == session && r.channel)?
                        .clone();
                    self.chosen = record;
                    self.pending = None;
                    self.target_sessions = None;
                    self.surface = Surface::Activity;
                    self.restore_activity_focus();
                    return None;
                }
                let action = self.menu.get(i)?.action.clone()?;
                if action == MenuAction::SizeMenu {
                    self.size_submenu = true;
                    self.focus = Some(Control::Submenu(
                        Size::ALL
                            .iter()
                            .position(|s| *s == self.context.size)
                            .unwrap(),
                    ));
                    None
                } else {
                    self.close();
                    Some(UiAction::Menu(action))
                }
            }
            // Her unread messages first: the badge opens the thread; Claude's replies after.
            Control::Badge => Some(UiAction::Menu(if self.dm_unread() > 0 {
                MenuAction::Dm
            } else {
                MenuAction::Activity
            })),
            Control::DmToggle => Some(UiAction::Menu(if self.dm_open {
                MenuAction::Activity
            } else {
                MenuAction::Dm
            })),
            Control::DmLine(_) => None,
            Control::Submenu(i) => {
                let size = *Size::ALL.get(i)?;
                self.close();
                Some(UiAction::Menu(MenuAction::Size(size)))
            }
            Control::Hover(i) => {
                let action = [
                    MenuAction::Activity,
                    MenuAction::Back,
                    MenuAction::ToggleLines,
                    MenuAction::Hide,
                    MenuAction::SizeMenu,
                ]
                .get(i)?
                .clone();
                Some(UiAction::Menu(action))
            }
        }
    }
    fn restore_activity_focus(&mut self) {
        let order = self.tab_order();
        self.focus = Some(
            [Control::Target, Control::Field, Control::Close]
                .into_iter()
                .find(|control| order.contains(control) && self.enabled(control))
                .unwrap_or(Control::Close),
        );
    }
    pub fn click(&mut self, x: f64, y: f64, now: u64) -> Option<UiAction> {
        if self.is_panel_menu()
            && !self
                .elements()
                .iter()
                .any(|e| matches!(e.control, Control::Menu(_)) && e.bounds.contains(x, y))
        {
            let new_chat = self.new_chat_choices.take().is_some();
            self.target_sessions = None;
            self.surface = Surface::Activity;
            if new_chat {
                self.focus = Some(Control::NewChat);
            } else {
                self.restore_activity_focus();
            }
            return None;
        }
        let element = self
            .elements()
            .into_iter()
            .rev()
            .find(|e| e.bounds.contains(x, y) && !matches!(e.control, Control::DmLine(_)))?;
        self.focus = Some(element.control.clone());
        if element.control == Control::Field {
            return None;
        }
        self.activate(element.control, now)
    }
    pub fn surface_inset(&self) -> f64 {
        match self.surface {
            Surface::Activity => 30.,
            Surface::Menu if self.is_panel_menu() => 30.,
            Surface::Menu => 8.,
            _ => 0.,
        }
    }
    pub fn is_target_menu(&self) -> bool {
        self.target_sessions.is_some()
    }
    /// A menu over the Activity panel: the session to send to, or which face opens a new chat.
    pub fn is_panel_menu(&self) -> bool {
        self.target_sessions.is_some() || self.new_chat_choices.is_some()
    }
    fn panel(&self) -> Self {
        let mut panel = self.clone();
        panel.surface = Surface::Activity;
        panel.target_sessions = None;
        panel.new_chat_choices = None;
        panel
    }
    fn new_chat_bounds(&self) -> Rect {
        self.panel()
            .content_elements()
            .into_iter()
            .find(|e| e.control == Control::NewChat)
            .map(|e| e.bounds)
            .unwrap_or(Rect {
                x: 200.,
                y: 12.,
                width: 60.,
                height: 22.,
            })
    }
    /// Where the panel menu hangs: under the target picker from its left edge, or under New chat ending at its
    /// right edge. Rows are 24 high with 8 below.
    fn panel_menu_rect(&self) -> Rect {
        let width = self.target_menu_width();
        let height = self.menu.len() as f64 * 24. + 8.;
        if self.new_chat_choices.is_some() {
            let button = self.new_chat_bounds();
            Rect {
                x: (button.x + button.width - width).max(12.),
                y: button.y + button.height + 4.,
                width,
                height,
            }
        } else {
            Rect {
                x: 12.,
                y: self.target_bounds().y + 28.,
                width,
                height,
            }
        }
    }
    /// A row's heading, "project, state". The state is the part that asks for him, so it is never cut: the project is
    /// shortened in the middle first, down to eight characters; only if the state still cannot fit does it take a
    /// second line, without its separator (OUTSIDE F2).
    pub fn row_heading(&self, row: &ActivityRow) -> RowHeading {
        let text_x = if self.sessions.len() > 1 { 41. } else { 24. };
        let time = moment_text(row.record.at, crate::epoch_ms() as f64, &row.record.lang);
        let room = 288. - text_width(&time, &row.record.lang, 12., false, false) - 6. - text_x;
        let lang = &row.record.lang;
        let sep = part_separator(lang);
        let both = |project: &str| {
            text_width(project, lang, 12.5, row.unseen, false)
                + text_width(&format!("{sep}{}", row.state), lang, 12.5, false, false)
        };
        let chars: Vec<char> = row.record.project.chars().collect();
        if both(&row.record.project) <= room {
            return RowHeading {
                first: format!("{}{sep}{}", row.record.project, row.state),
                project_chars: chars.len(),
                second: None,
            };
        }
        for keep in (8..chars.len()).rev() {
            let head = keep / 2 + keep % 2;
            let tail = keep - head;
            let shortened: String = chars[..head]
                .iter()
                .chain(std::iter::once(&'…'))
                .chain(chars[chars.len() - tail + 1..].iter())
                .collect();
            if both(&shortened) <= room {
                let project_chars = shortened.chars().count();
                return RowHeading {
                    first: format!("{shortened}{sep}{}", row.state),
                    project_chars,
                    second: None,
                };
            }
        }
        RowHeading {
            first: row.record.project.clone(),
            project_chars: chars.len(),
            second: Some(row.state.clone()),
        }
    }
    pub fn row_height(&self, row: &ActivityRow) -> f64 {
        self.row_height_with_excerpt(row)
            + if self.row_heading(row).second.is_some() {
                16.
            } else {
                0.
            }
    }
    fn row_height_with_excerpt(&self, row: &ActivityRow) -> f64 {
        row.excerpt
            .as_ref()
            .map(|s| {
                30. + 16.
                    * (text_metrics_with_line_height(
                        s,
                        &row.record.lang,
                        12.,
                        false,
                        false,
                        288. - if self.sessions.len() > 1 { 41. } else { 24. },
                        10000.,
                        excerpt_line_height(),
                    )
                    .1 / 16.)
                        .ceil()
                        .clamp(1., 2.)
                    + 2.
            })
            .unwrap_or(30.)
    }
    fn quota_foot_rows(&self) -> Vec<(String, f64)> {
        let scale = self.render_scale.get();
        self.chosen
            .quota
            .as_ref()
            .map(|quota| {
                quota
                    .windows
                    .iter()
                    .map(|window| {
                        let lang = &self.chosen.lang;
                        let prefix = window.display_name(lang).chars().count();
                        let measured = |text: &str| {
                            mixed_text_metrics(
                                text,
                                lang,
                                12.5 * scale,
                                QUOTA_TEXT_WIDTH * scale,
                                10000. * scale,
                                prefix,
                            )
                        };
                        let separator = part_separator(lang);
                        let mut parts = window.announcement_parts(lang, window.pace.as_deref());
                        let mut text = parts.join(separator);
                        if measured(&text).2 > 1 {
                            if let Some(pace) = window.pace.as_deref().filter(|_| window.hot) {
                                let wide = word(lang, "quota.pace.wide", 0);
                                let narrow = word(lang, "quota.pace.narrow", 0);
                                if let Some((before, after)) = wide.split_once("{t}") {
                                    if let Some(duration) = pace
                                        .strip_prefix(before)
                                        .and_then(|s| s.strip_suffix(after))
                                    {
                                        let shortened = narrow.replace("{t}", duration);
                                        let candidate_parts =
                                            window.announcement_parts(lang, Some(&shortened));
                                        let candidate = candidate_parts.join(separator);
                                        if measured(&candidate).2 < measured(&text).2 {
                                            text = candidate;
                                            parts = candidate_parts;
                                        }
                                    }
                                }
                            }
                        }
                        // Prefer a break between two clauses when it fits without adding lines.
                        let original_lines = measured(&text).2;
                        let joins = parts.len().saturating_sub(1).min(2);
                        let mut best_breaks = 0;
                        for mask in 1..(1usize << joins) {
                            let mut candidate = parts[0].clone();
                            for (index, part) in parts.iter().enumerate().skip(1) {
                                // The comma goes with the break: none is left hanging at a line's end.
                                let broken = index <= joins && mask & (1 << (index - 1)) != 0;
                                candidate.push_str(if broken { "\n" } else { separator });
                                candidate.push_str(part);
                            }
                            let breaks = mask.count_ones();
                            if breaks > best_breaks && measured(&candidate).2 <= original_lines {
                                text = candidate;
                                best_breaks = breaks;
                            }
                        }
                        let height = (measured(&text).1.ceil() / scale).max(QUOTA_ROW_MIN);
                        (text, height)
                    })
                    .collect()
            })
            .unwrap_or_default()
    }
    fn quota_foot_height(&self) -> f64 {
        let rows = self.quota_foot_rows();
        if rows.is_empty() {
            0.
        } else {
            8. + rows
                .iter()
                .map(|(_, height)| height + quota_row_gap(*height))
                .sum::<f64>()
        }
    }
    fn activity_body_bottom(&self) -> f64 {
        let mut bottom = self
            .content_elements()
            .iter()
            .filter(|element| !matches!(element.control, Control::Close | Control::NewChat | Control::DmToggle))
            .map(|element| element.bounds.y + element.bounds.height)
            .fold(39., f64::max);
        // The thread, then the field; never shorter than a row.
        if self.dm_open {
            return bottom.max(39. + 30.);
        }
        if self.rows.is_empty() {
            // The empty label is drawn at y=45 with the existing 20 pt text box.
            bottom = bottom.max(45. + 20.);
        }
        if self.request_status().is_some() {
            let y = 39.
                + self
                    .rows
                    .iter()
                    .map(|row| self.row_height(row))
                    .sum::<f64>()
                + if self.rows.is_empty() { 30. } else { 0. };
            bottom = bottom.max(y + 4. + 20.);
        }
        bottom
    }
    pub fn hover_indices(&self) -> Vec<usize> {
        (0..5)
            .filter(|i| {
                *i != 1
                    || (self.context.back_available && self.context.platform != UiPlatform::Wayland)
            })
            .collect()
    }
    pub fn hover_bounds(&self) -> Rect {
        let width = 4. + 28. * self.hover_indices().len() as f64;
        pill_bounds_at(
            self.companion_frame,
            self.visible_rect,
            width,
            32.,
            self.idle_top.unwrap_or(self.companion_frame.y) - 2.,
        )
    }
    pub fn set_idle_geometry(&mut self, top: f64, hair: (f64, f64)) {
        self.idle_top = Some(top);
        self.hair_anchor = Some(hair);
    }
    pub fn hover_button(&self, index: usize) -> Rect {
        let row = self.hover_bounds();
        let slot = self
            .hover_indices()
            .iter()
            .position(|i| *i == index)
            .unwrap_or(0);
        Rect {
            x: row.x + 4. + slot as f64 * 28.,
            y: row.y + 4.,
            width: 24.,
            height: 24.,
        }
    }
    pub fn hover_label_bounds(&self, index: usize) -> Option<Rect> {
        let e = self
            .content_elements()
            .into_iter()
            .find(|e| e.control == Control::Hover(index))?;
        let row = self.hover_bounds();
        let width = (text_width(&e.label, &self.chosen.lang, 12., false, false) + 16.)
            .min((self.visible_rect.width - 4.).max(1.));
        let above = row.y - 24.;
        let y = if above >= self.visible_rect.y + 2. {
            above
        } else {
            row.y + row.height + 4.
        };
        Some(Rect {
            x: (e.bounds.x + 12. - width / 2.).clamp(
                self.visible_rect.x + 2.,
                (self.visible_rect.x + self.visible_rect.width - width - 2.)
                    .max(self.visible_rect.x + 2.),
            ),
            y: y.clamp(
                self.visible_rect.y + 2.,
                (self.visible_rect.y + self.visible_rect.height - 22.)
                    .max(self.visible_rect.y + 2.),
            ),
            width,
            height: 20.,
        })
    }
    fn selected_hover_index(&self) -> Option<usize> {
        if !self.hover_visible || self.hover_bounds().width <= 0. {
            return None;
        }
        self.hover_index
            .or_else(|| match self.focus {
                Some(Control::Hover(i)) => Some(i),
                _ => None,
            })
            .filter(|i| self.hover_indices().contains(i))
    }
    /// The DM thread's newest messages that fit, oldest first, each with its bubble: hers on the left, the person's
    /// on the right, at most DM_BUBBLE_WIDTH wide, one side's run close together; the thread at most DM_THREAD_HEIGHT
    /// tall, older messages giving way.
    pub fn dm_bubbles(&self) -> Vec<(usize, Rect)> {
        let Some(dm) = self.dm() else {
            return vec![];
        };
        let gap = |a: bool, b: bool| if a == b { DM_GAP_SAME } else { DM_GAP };
        let mut sized: Vec<(usize, f64, f64, bool)> = vec![];
        let mut total = 0.;
        for (i, line) in dm.thread.iter().enumerate().rev() {
            let (w, h) = text_size(&line.text, &self.chosen.lang, DM_TEXT, DM_BUBBLE_WIDTH - 2. * DM_PAD_X);
            let width = (w.ceil() + 2. * DM_PAD_X).clamp(28., DM_BUBBLE_WIDTH);
            let height = (h.ceil().max(17.) + 2. * DM_PAD_Y).min(DM_THREAD_HEIGHT);
            let spacing = sized.last().map_or(0., |(_, _, _, below)| gap(*below, line.mine));
            if !sized.is_empty() && total + spacing + height > DM_THREAD_HEIGHT {
                break;
            }
            total += spacing + height;
            sized.push((i, width, height, line.mine));
        }
        let mut y = 39.;
        let mut above: Option<bool> = None;
        sized
            .into_iter()
            .rev()
            .map(|(i, width, height, mine)| {
                if let Some(above) = above {
                    y += gap(above, mine);
                }
                let bubble = Rect { x: if mine { 288. - width } else { 12. }, y, width, height };
                y += height;
                above = Some(mine);
                (i, bubble)
            })
            .collect()
    }
    pub fn badge_bounds(&self) -> Rect {
        if self.selected_hover_index().is_some() {
            return Rect {
                x: 0.,
                y: 0.,
                width: 0.,
                height: 0.,
            };
        }
        let label = if self.badge_count() >= 10 {
            "9+".into()
        } else {
            self.badge_count().to_string()
        };
        let width = (text_width(&label, &self.chosen.lang, 11.5, true, false) + 10.).max(20.);
        let (hair_x, hair_y) = self.hair_anchor.unwrap_or((
            self.companion_frame.x - 4. + width / 2.,
            self.companion_frame.y - 2. + 10.,
        ));
        let minimum_y = (self.visible_rect.y + 2.).max(if self.hover_visible {
            let pill = self.hover_bounds();
            pill.y + pill.height
        } else {
            self.visible_rect.y + 2.
        });
        let maximum_y = self.visible_rect.y + self.visible_rect.height - 22.;
        if self.visible_rect.width < width + 4. || minimum_y > maximum_y {
            return Rect {
                x: 0.,
                y: 0.,
                width: 0.,
                height: 0.,
            };
        }
        // The fixed-size seal belongs on the hair. The generic face proxy
        // includes upper hair at Tiny and would push this anchor into empty air.
        Rect {
            x: (hair_x - width / 2.).clamp(
                self.visible_rect.x + 2.,
                self.visible_rect.x + self.visible_rect.width - width - 2.,
            ),
            y: (hair_y - 10.).clamp(minimum_y, maximum_y),
            width,
            height: 20.,
        }
    }
    fn menu_width(&self) -> f64 {
        self.menu
            .iter()
            .filter(|r| !r.separator)
            .map(|r| {
                text_width(&r.label, &self.chosen.lang, 12., false, true)
                    + 32.
                    + if r.action == Some(MenuAction::SizeMenu) {
                        16.
                    } else {
                        0.
                    }
            })
            .fold(210., f64::max)
    }
    fn size_menu_width(&self) -> f64 {
        Size::ALL
            .into_iter()
            .map(|z| {
                text_width(
                    self.chosen.word(z.key()),
                    &self.chosen.lang,
                    12.,
                    false,
                    true,
                ) + 44.
            })
            .fold(100., f64::max)
    }
    fn size_submenu_y(&self) -> f64 {
        let mut y = 4.;
        for r in &self.menu {
            if r.action == Some(MenuAction::SizeMenu) {
                return y;
            }
            y += if r.separator { 9. } else { 26. };
        }
        y
    }
    fn target_bounds(&self) -> Rect {
        self.panel()
            .content_elements()
            .into_iter()
            .find(|e| e.control == Control::Target)
            .map(|e| e.bounds)
            .unwrap_or(Rect {
                x: 12.,
                y: 77.,
                width: 84.,
                height: 28.,
            })
    }
    fn target_menu_width(&self) -> f64 {
        self.menu
            .iter()
            .map(|r| text_width(&r.label, &self.chosen.lang, 12., true, false) + 24.)
            .fold(84., f64::max)
            .min(276.)
    }
    pub fn elements(&self) -> Vec<Element> {
        let d = self.surface_inset();
        self.content_elements()
            .into_iter()
            .map(|mut e| {
                e.bounds.x += d;
                e.bounds.y += d;
                e
            })
            .collect()
    }
    pub fn dimensions(&self) -> (f64, f64) {
        let (w, h) = self.content_dimensions();
        let d = self.surface_inset();
        (w + 2. * d, h + 2. * d)
    }
    pub fn render(&self, scale: f64) -> Canvas {
        self.render_scale.set(scale);
        set_draw_scale(scale);
        let inset = self.surface_inset();
        if self.is_panel_menu() {
            let panel = self.panel();
            let mut inner = panel.render(scale);
            let (w, h) = self.dimensions();
            let mut c = Canvas::blank((w * scale).ceil() as u32, (h * scale).ceil() as u32);
            c.look = self.look();
            blit(&mut c, &inner.pixels, inner.width, inner.height, 0, 0);
            move_texts(&mut c, &mut inner, 0.);
            let (pw, ph) = panel.content_dimensions();
            c.input_rect(
                (inset * scale) as i32,
                (inset * scale) as i32,
                (pw * scale) as u32,
                (ph * scale) as u32,
            );
            let hung = self.panel_menu_rect();
            let rect = Rect {
                x: hung.x + inset,
                y: hung.y + inset,
                ..hung
            };
            paper_shape(&mut c, rect, 6., [250, 238, 233, 255], scale, false);
            c.text_occlusion = Some((
                c.texts.len(),
                (
                    (rect.x * scale) as u32,
                    (rect.y * scale) as u32,
                    (rect.width * scale).ceil() as u32,
                    (rect.height * scale).ceil() as u32,
                ),
            ));
            c.input_rect(
                (rect.x * scale) as i32,
                (rect.y * scale) as i32,
                (rect.width * scale) as u32,
                (rect.height * scale) as u32,
            );
            for e in self
                .elements()
                .into_iter()
                .filter(|e| matches!(e.control, Control::Menu(_)))
            {
                if self.focus.as_ref() == Some(&e.control) {
                    rounded(&mut c, e.bounds, 3., [199, 87, 48, 31], scale);
                }
                let selected = if let Control::Menu(i) = e.control {
                    self.target_sessions
                        .as_ref()
                        .is_some_and(|targets| targets[i] == self.chosen.session)
                } else {
                    false
                };
                text(
                    &mut c,
                    &e.label,
                    e.bounds.x + 8.,
                    e.bounds.y + 4.,
                    e.bounds.width - 16.,
                    18.,
                    12.,
                    &self.chosen.lang,
                    scale,
                    selected,
                    [35, 27, 25, 255],
                );
            }
            return c;
        }
        let mut inner = self.render_content(scale);
        inner.look = self.look();
        if inset == 0. {
            return inner;
        }
        let (w, h) = self.dimensions();
        let mut c = Canvas::blank((w * scale).ceil() as u32, (h * scale).ceil() as u32);
        c.look = self.look();
        let activity = self.surface == Surface::Activity;
        let main = Rect {
            x: inset,
            y: inset,
            width: if activity { 300. } else { self.menu_width() },
            height: if activity {
                self.content_dimensions().1
            } else {
                self.root_menu_height()
            },
        };
        // A system look draws no shadow: it would be a tint of a colour that is not the system's.
        if c.look.shadow() {
            shadow(
                &mut c,
                main,
                if activity { 9. } else { 8. },
                scale,
                if activity { 10. } else { 2. },
                if activity { 30. } else { 8. },
                if activity { 0.25 } else { 0.18 },
            );
        }
        c.input_rect(
            (main.x * scale) as i32,
            (main.y * scale) as i32,
            (main.width * scale) as u32,
            (main.height * scale) as u32,
        );
        if self.size_submenu {
            let sub = Rect {
                x: inset + self.menu_width() + 4.,
                y: inset + self.size_submenu_y(),
                width: self.size_menu_width(),
                height: 104.,
            };
            if c.look.shadow() {
                shadow(&mut c, sub, 8., scale, 2., 8., 0.18);
            }
            c.input_rect(
                (sub.x * scale) as i32,
                (sub.y * scale) as i32,
                (sub.width * scale) as u32,
                (sub.height * scale) as u32,
            );
        }
        blit(
            &mut c,
            &inner.pixels,
            inner.width,
            inner.height,
            (inset * scale) as i32,
            (inset * scale) as i32,
        );
        move_texts(&mut c, &mut inner, inset * scale);
        c
    }
    fn root_menu_height(&self) -> f64 {
        8. + self
            .menu
            .iter()
            .map(|r| if r.separator { 9. } else { 26. })
            .sum::<f64>()
    }
    fn content_elements(&self) -> Vec<Element> {
        let mut v = vec![];
        let mut add = |control: Control, label: String, bounds: Rect| {
            let enabled = self.enabled(&control);
            v.push(Element {
                control,
                label,
                bounds,
                enabled,
            })
        };
        let r = |x, y, width, height| Rect {
            x,
            y,
            width,
            height,
        };
        match self.surface {
            Surface::Companion => {
                if self.hover_visible {
                    for i in self.hover_indices() {
                        let key = [
                            "activity",
                            "back",
                            if self.context.lines_hidden {
                                "showLines"
                            } else {
                                "hideLines"
                            },
                            "hide",
                            "size",
                        ][i];
                        add(
                            Control::Hover(i),
                            if i == 1 && self.context.platform == UiPlatform::X11 {
                                word(&self.chosen.lang, "menu.backWindow", 0)
                            } else {
                                self.chosen.app_word(key, &self.context.back_app)
                            },
                            self.hover_button(i),
                        );
                    }
                }
                if self.badge_count() > 0 && self.badge_bounds().width > 0. {
                    // Her messages first, as the badge opens the thread: the thread's name and how many.
                    let label = match self.dm().filter(|dm| dm.unread > 0) {
                        Some(dm) => [dm.label.clone(), self.badge_count().to_string()]
                            .join(part_separator(&self.chosen.lang)),
                        None => self
                            .chosen
                            .word("badge")
                            .replace("{n}", &self.unseen.to_string()),
                    };
                    add(Control::Badge, label, self.badge_bounds());
                }
            }
            Surface::Menu => {
                let panel_menu = self.is_panel_menu();
                if panel_menu {
                    v = self.panel().content_elements();
                    for e in &mut v {
                        e.enabled = false;
                    }
                }
                let hung = panel_menu.then(|| self.panel_menu_rect());
                let mut y = hung.map_or(4., |hung| hung.y);
                let width = hung.map_or_else(|| self.menu_width(), |hung| hung.width);
                let x = hung.map_or(0., |hung| hung.x);
                for (i, row) in self.menu.iter().enumerate() {
                    if row.separator {
                        y += 9.;
                    } else {
                        v.push(Element {
                            control: Control::Menu(i),
                            label: if row.checked == Some(true) {
                                format!("✓ {}", row.label)
                            } else {
                                row.label.clone()
                            },
                            enabled: row.enabled,
                            bounds: r(
                                x + 4.,
                                y,
                                width - 8.,
                                if panel_menu { 24. } else { 26. },
                            ),
                        });
                        y += if panel_menu { 24. } else { 26. };
                    }
                }
                if self.size_submenu {
                    for (i, size) in Size::ALL
                        .iter()
                        .enumerate()
                    {
                        v.push(Element {
                            control: Control::Submenu(i),
                            label: self.chosen.word(size.key()).into(),
                            enabled: true,
                            bounds: r(
                                width + 4.,
                                self.size_submenu_y() + i as f64 * 26.,
                                self.size_menu_width() - 8.,
                                26.,
                            ),
                        });
                    }
                }
            }
            Surface::Activity if self.dm_open => {
                let lang = &self.chosen.lang;
                let bubbles = self.dm_bubbles();
                if let Some(dm) = self.dm() {
                    for (i, bubble) in &bubbles {
                        let line = &dm.thread[*i];
                        // Hers are read with her name; the person's own as they wrote them.
                        let label = if line.mine {
                            line.text.clone()
                        } else {
                            format!("{}: {}", self.chosen.name, line.text)
                        };
                        add(Control::DmLine(*i), label, *bubble);
                    }
                }
                let mut y = bubbles.last().map_or(39., |(_, b)| b.y + b.height + DM_GAP) + 2.;
                if self.pending.is_some() {
                    y += 24.
                }
                if self.chosen.channel {
                    let placeholder = self.dm().map(|dm| dm.placeholder.clone()).unwrap_or_default();
                    add(Control::Field, placeholder, r(12., y, 238., 28.));
                    add(
                        Control::Send,
                        self.chosen
                            .word(
                                if self.pending.as_ref().is_some_and(|p| {
                                    matches!(
                                        p.phase,
                                        RequestDecision::Unconfirmed | RequestDecision::Expired
                                    )
                                }) {
                                    "retry"
                                } else {
                                    "send"
                                },
                            )
                            .into(),
                        r(260., y, 28., 28.),
                    );
                }
                let close = word(lang, "activity.close", 0);
                let close_width = text_width(&close, lang, 12.5, false, false) + 16.;
                let back = self.chosen.word("activity").to_string();
                let back_width = text_width(&back, lang, 12.5, false, false) + 16.;
                add(Control::DmToggle, back, r(288. - close_width - 4. - back_width, 12., back_width, 22.));
                add(Control::Close, close, r(288. - close_width, 12., close_width, 22.));
            }
            Surface::Activity => {
                let mut y = 39.;
                for row in &self.rows {
                    let height = self.row_height(row);
                    add(
                        Control::Row(row.record.session.clone()),
                        format!(
                            "{}, {}, {}{}{}",
                            row.record.project,
                            row.state,
                            sentence_part(&moment_text(
                                row.record.at,
                                crate::epoch_ms() as f64,
                                &row.record.lang
                            )),
                            row.excerpt
                                .as_ref()
                                .map(|s| sentence_part(s))
                                .unwrap_or_default(),
                            row.record.app_word(
                                "opens",
                                self.session_apps
                                    .get(&row.record.session)
                                    .map(String::as_str)
                                    .unwrap_or("Claude")
                            )
                        ),
                        r(12., y, 276., height),
                    );
                    y += height;
                }
                if self.rows.is_empty() {
                    y += 30.
                }
                if self.pending.is_some() {
                    y += 24.
                }
                if self.chosen.channel {
                    y += 8.;
                    let target = self.sessions.len() > 1;
                    // The picker names its project whole, up to 45 percent of the row, then a middle ellipsis;
                    // the field keeps the rest (BAND OUTSIDE F3).
                    let picker = if target {
                        (text_width(&self.chosen.project, &self.chosen.lang, 12., false, false)
                            + 32.)
                            .clamp(84., (264. * 0.45_f64).floor())
                    } else {
                        0.
                    };
                    let fw = if target { 232. - picker } else { 238. };
                    add(
                        Control::Field,
                        self.dm().map(|dm| dm.placeholder.clone()).unwrap_or_else(|| {
                            self.chosen
                                .word("placeholder")
                                .replace("{project}", &self.chosen.project)
                        }),
                        r(if target { 18. + picker } else { 12. }, y, fw, 28.),
                    );
                    if target {
                        add(
                            Control::Target,
                            self.chosen.project.clone(),
                            r(12., y, picker, 28.),
                        );
                    }
                    add(
                        Control::Send,
                        self.chosen
                            .word(
                                if self.pending.as_ref().is_some_and(|p| {
                                    matches!(
                                        p.phase,
                                        RequestDecision::Unconfirmed | RequestDecision::Expired
                                    )
                                }) {
                                    "retry"
                                } else {
                                    "send"
                                },
                            )
                            .into(),
                        r(260., y, 28., 28.),
                    );
                }
                let close = word(&self.chosen.lang, "activity.close", 0);
                let close_width = text_width(&close, &self.chosen.lang, 12.5, false, false) + 16.;
                let mut left = 288. - close_width;
                if !self.new_chat.is_empty() {
                    let label = self.chosen.word("newChat").to_string();
                    let width = text_width(&label, &self.chosen.lang, 12.5, false, false) + 16.;
                    left -= 4. + width;
                    add(Control::NewChat, label, r(left, 12., width, 22.));
                }
                // The DM thread's switch, with a dot while something of hers is unread (drawn in render_content).
                if let Some(dm) = self.dm() {
                    let width = text_width(&dm.label, &self.chosen.lang, 12.5, false, false)
                        + 16.
                        + if dm.unread > 0 { DM_DOT_ROOM } else { 0. };
                    left -= 4. + width;
                    let label = if dm.unread > 0 {
                        [dm.label.clone(), dm.unread.to_string()].join(part_separator(&self.chosen.lang))
                    } else {
                        dm.label.clone()
                    };
                    add(Control::DmToggle, label, r(left, 12., width, 22.));
                }
                add(Control::Close, close, r(288. - close_width, 12., close_width, 22.));
            }
        }
        v
    }
    fn content_dimensions(&self) -> (f64, f64) {
        match self.surface {
            Surface::Companion => (320., (160. + 1.32 * self.context.size.height()).round()),
            Surface::Menu if self.is_panel_menu() => {
                let (w, h) = self.panel().content_dimensions();
                let hung = self.panel_menu_rect();
                (w, h.max(hung.y + hung.height))
            }
            Surface::Menu => (
                self.menu_width()
                    + if self.size_submenu {
                        self.size_menu_width() + 4.
                    } else {
                        0.
                    },
                self.root_menu_height().max(if self.size_submenu {
                    self.size_submenu_y() + 104.
                } else {
                    0.
                }),
            ),
            // The DM thread leaves the quota foot to the sessions' view.
            Surface::Activity => (
                300.,
                self.activity_body_bottom()
                    + 12.
                    + if self.dm_open { 0. } else { self.quota_foot_height() },
            ),
        }
    }
    fn render_content(&self, scale: f64) -> Canvas {
        let (w, h) = self.content_dimensions();
        let mut c = Canvas::blank((w * scale).ceil() as u32, (h * scale).ceil() as u32);
        c.look = self.look();
        let look = self.look();
        let ink = look.ink(false);
        let paper = look.panel_fill(false);
        let full = Rect {
            x: 0.,
            y: 0.,
            width: w,
            height: h,
        };
        if self.surface == Surface::Menu {
            // (ground, text, edge, highlighted ground, highlighted text)
            let menu = look.menu(self.dark).unwrap_or(if self.dark {
                (
                    [44, 44, 44, 255],
                    [255, 255, 255, 255],
                    [69, 69, 69, 255],
                    [61, 61, 61, 255],
                    [255, 255, 255, 255],
                )
            } else {
                (
                    [249, 249, 249, 255],
                    [27, 27, 27, 255],
                    [224, 224, 224, 255],
                    [234, 234, 234, 255],
                    [27, 27, 27, 255],
                )
            });
            let root_width = self.menu_width();
            let root_rect = Rect {
                width: root_width,
                height: self.root_menu_height(),
                ..full
            };
            rounded(&mut c, root_rect, 8., menu.0, scale);
            outline(&mut c, root_rect, 8., 1., menu.2, scale);
            if self.size_submenu {
                let sub = Rect {
                    x: root_width + 4.,
                    y: self.size_submenu_y(),
                    width: self.size_menu_width(),
                    height: 104.,
                };
                rounded(&mut c, sub, 8., menu.0, scale);
                outline(&mut c, sub, 8., 1., menu.2, scale);
            }
            let mut y = 4.;
            for row in &self.menu {
                if row.separator {
                    rounded(
                        &mut c,
                        Rect {
                            x: 8.,
                            y: y + 4.,
                            width: root_width - 16.,
                            height: 1.,
                        },
                        0.,
                        menu.2,
                        scale,
                    );
                    y += 9.;
                } else {
                    y += 26.;
                }
            }
            for e in self.content_elements() {
                let highlighted = self.focus.as_ref() == Some(&e.control)
                    || self.hovered.as_ref() == Some(&e.control);
                if highlighted {
                    rounded(&mut c, e.bounds, 3., menu.3, scale);
                }
                let reading = matches!(e.control,Control::Menu(i) if self.menu[i].action==Some(MenuAction::Activity)&&self.chosen.quota.is_some()&&i==0);
                let color = if highlighted && !look.is_normal() {
                    menu.4
                } else if reading && look.is_normal() {
                    if self.dark {
                        [175, 175, 175, 255]
                    } else {
                        [111, 111, 111, 255]
                    }
                } else {
                    menu.1
                };
                let offset = if matches!(e.control, Control::Submenu(_)) {
                    24.
                } else {
                    12.
                };
                text(
                    &mut c,
                    &e.label,
                    e.bounds.x + offset,
                    e.bounds.y + 5.,
                    e.bounds.width - offset - 12.,
                    18.,
                    12.,
                    &self.chosen.lang,
                    scale,
                    false,
                    color,
                );
                *c.text_sans.last_mut().unwrap() = true;
                if matches!(e.control,Control::Menu(i) if self.menu[i].action==Some(MenuAction::SizeMenu))
                {
                    stroke_paths(
                        &mut c,
                        &[&[
                            (e.bounds.x + e.bounds.width - 12., e.bounds.y + 9.),
                            (e.bounds.x + e.bounds.width - 8., e.bounds.y + 13.),
                            (e.bounds.x + e.bounds.width - 12., e.bounds.y + 17.),
                        ]],
                        1.2,
                        color,
                        scale,
                    );
                }
                if let Control::Submenu(i) = e.control {
                    if Size::ALL[i] == self.context.size
                    {
                        stroke_paths(
                            &mut c,
                            &[&[
                                (e.bounds.x + 8., e.bounds.y + 13.),
                                (e.bounds.x + 11., e.bounds.y + 16.),
                                (e.bounds.x + 16., e.bounds.y + 10.),
                            ]],
                            1.2,
                            color,
                            scale,
                        );
                    }
                }
            }
            return c;
        }
        rounded(&mut c, full, 9., paper, scale);
        c.input_rect(0, 0, c.width, c.height);
        let mut band = Canvas::blank(c.width, c.height);
        rounded(
            &mut band,
            Rect { height: 3., ..full },
            0.,
            look.accent(),
            scale,
        );
        clip_rounded(&mut band, full, 9., scale);
        blit(&mut c, &band.pixels, band.width, band.height, 0, 0);
        // The DM thread is titled with her name, as a chat app names the person in it.
        text(
            &mut c,
            if self.dm_open {
                &self.chosen.name
            } else {
                self.chosen.word("activity")
            },
            27.,
            13.,
            self.content_elements()
                .iter()
                .filter(|e| matches!(e.control, Control::NewChat | Control::Close | Control::DmToggle))
                .map(|e| e.bounds.x - 33.)
                .fold(200_f64, f64::min),
            20.,
            14.,
            &self.chosen.lang,
            scale,
            true,
            ink,
        );
        spark(&mut c, 17., 21., scale);
        for e in self.content_elements() {
            let b = e.bounds;
            match &e.control {
                Control::Row(id) => {
                    let row = self.rows.iter().find(|r| &r.record.session == id).unwrap();
                    let row_ink = match look.palette() {
                        Some(p) if self.pressed.as_ref() == Some(&e.control) => {
                            rounded(&mut c, b, 0., p.highlight, scale);
                            p.highlight_text
                        }
                        _ => ink,
                    };
                    let (divider_height, divider) = look.divider(false);
                    rounded(
                        &mut c,
                        Rect {
                            height: divider_height,
                            ..b
                        },
                        0.,
                        divider,
                        scale,
                    );
                    let ribbons = self.sessions.len() > 1;
                    let (dot_x, text_x) = if ribbons { (26., 41.) } else { (12., 24.) };
                    if ribbons {
                        crate::decor::draw_ribbon(
                            &mut c,
                            row.record.ribbon.unwrap_or(0),
                            b.x,
                            b.y + 4.,
                            scale,
                            false,
                        );
                    }
                    rounded(
                        &mut c,
                        Rect {
                            x: dot_x,
                            y: b.y + 11.,
                            width: 7.,
                            height: 7.,
                        },
                        3.5,
                        look.row_dot(false, row.unseen),
                        scale,
                    );
                    if !row.unseen {
                        rounded(
                            &mut c,
                            Rect {
                                x: dot_x + 1.,
                                y: b.y + 12.,
                                width: 5.,
                                height: 5.,
                            },
                            2.5,
                            paper,
                            scale,
                        );
                    }
                    let time =
                        moment_text(row.record.at, crate::epoch_ms() as f64, &row.record.lang);
                    let tw = text_width(&time, &row.record.lang, 12., false, false);
                    let tx = 288. - tw;
                    let heading = self.row_heading(row);
                    text(
                        &mut c,
                        &heading.first,
                        text_x,
                        b.y + 6.,
                        (tx - 6. - text_x).max(1.),
                        18.,
                        12.5,
                        &row.record.lang,
                        scale,
                        false,
                        row_ink,
                    );
                    if row.unseen {
                        *c.text_prefixes.last_mut().unwrap() = heading.project_chars;
                    }
                    let second_line = heading.second.is_some();
                    if let Some(state) = &heading.second {
                        text(
                            &mut c,
                            state,
                            text_x,
                            b.y + 22.,
                            (tx - 6. - text_x).max(1.),
                            18.,
                            12.5,
                            &row.record.lang,
                            scale,
                            false,
                            ink,
                        );
                    }
                    text(
                        &mut c,
                        &time,
                        tx,
                        b.y + 6.,
                        tw,
                        18.,
                        12.,
                        &row.record.lang,
                        scale,
                        false,
                        row_ink,
                    );
                    if let Some(s) = &row.excerpt {
                        text(
                            &mut c,
                            s,
                            text_x,
                            b.y + 25. + if second_line { 16. } else { 0. },
                            288. - text_x,
                            b.height - 32. - if second_line { 16. } else { 0. },
                            12.,
                            &row.record.lang,
                            scale,
                            false,
                            row_ink,
                        );
                        if let Some(pitch) = excerpt_line_height() {
                            c.texts.last_mut().unwrap().line_height = Some(pitch * scale);
                        }
                    }
                }
                Control::Field => {
                    rounded(
                        &mut c,
                        b,
                        6.,
                        look.palette().map_or([255, 250, 247, 255], |p| p.window),
                        scale,
                    );
                    outline(&mut c, b, 6., 1., look.control_edge(false), scale);
                    let display = self.display_field();
                    text(
                        &mut c,
                        if display.is_empty() {
                            &e.label
                        } else {
                            &display
                        },
                        b.x + 6.,
                        b.y + 5.,
                        b.width - 12.,
                        20.,
                        12.5,
                        &self.chosen.lang,
                        scale,
                        false,
                        if display.is_empty() {
                            look.placeholder()
                        } else {
                            ink
                        },
                    );
                }
                Control::Target => {
                    let system = look.palette();
                    rounded(
                        &mut c,
                        b,
                        6.,
                        system.map_or(paper, |p| p.button_face),
                        scale,
                    );
                    outline(&mut c, b, 6., 1., look.control_edge(false), scale);
                    text(
                        &mut c,
                        &e.label,
                        b.x + 6.,
                        b.y + 5.,
                        b.width - 30.,
                        18.,
                        12.,
                        &self.chosen.lang,
                        scale,
                        false,
                        system.map_or([92, 42, 30, 255], |p| p.button_text),
                    );
                    *c.text_middle.last_mut().unwrap() = true;
                    let chevron = include_bytes!("../assets/icons/target-chevron.svg");
                    match system {
                        Some(p) => draw_svg_tinted(
                            &mut c,
                            chevron,
                            b.x + b.width - 18.,
                            b.y + 8.,
                            12.,
                            p.button_text,
                            scale,
                        ),
                        None => draw_svg(
                            &mut c,
                            chevron,
                            b.x + b.width - 18.,
                            b.y + 8.,
                            12.,
                            12.,
                            scale,
                        ),
                    }
                }
                Control::Send => {
                    let opacity = if self.pending.as_ref().is_some_and(|p| {
                        matches!(p.phase, RequestDecision::Sending | RequestDecision::Expired)
                    }) {
                        0.45
                    } else {
                        1.
                    };
                    let hovered = self.hovered.as_ref() == Some(&e.control);
                    let pressed = self.pressed.as_ref() == Some(&e.control);
                    match look.seal(hovered, pressed, opacity >= 1.) {
                        None => {
                            rounded(&mut c, b, 14., [158, 65, 35, (255. * opacity) as u8], scale);
                            draw_send(&mut c, b.x + 6., b.y + 6., 16., scale, opacity, None);
                        }
                        Some(seal) => {
                            let fill = seal.fill.unwrap_or(paper);
                            rounded(
                                &mut c,
                                b,
                                14.,
                                [fill[0], fill[1], fill[2], (255. * opacity) as u8],
                                scale,
                            );
                            if let Some((width, edge)) = seal.edge {
                                outline(&mut c, b, 14., width, edge, scale);
                            }
                            let tint = look.is_system().then_some(seal.text);
                            draw_send(&mut c, b.x + 6., b.y + 6., 16., scale, opacity, tint);
                        }
                    }
                }
                // Her messages on the left in the paper's own tint, the person's on the right in the send button's
                // colour; under a system look the window's colours and the highlight.
                Control::DmLine(i) => {
                    let mine = self.dm().and_then(|dm| dm.thread.get(*i)).is_some_and(|line| line.mine);
                    let (fill, words) = match (look.palette(), mine) {
                        (Some(p), true) => (p.highlight, p.highlight_text),
                        (Some(p), false) => (p.window, ink),
                        (None, true) => ([158, 65, 35, 255], [255, 250, 247, 255]),
                        (None, false) => ([242, 229, 219, 255], ink),
                    };
                    rounded(&mut c, b, 10., fill, scale);
                    if look.palette().is_some() && !mine {
                        outline(&mut c, b, 10., 1., look.control_edge(false), scale);
                    }
                    let text_of = self.dm().and_then(|dm| dm.thread.get(*i)).map(|line| line.text.as_str()).unwrap_or_default();
                    text(
                        &mut c,
                        text_of,
                        b.x + DM_PAD_X,
                        b.y + DM_PAD_Y,
                        b.width - 2. * DM_PAD_X,
                        b.height - 2. * DM_PAD_Y,
                        DM_TEXT,
                        &self.chosen.lang,
                        scale,
                        false,
                        words,
                    );
                }
                Control::DmToggle => {
                    let hovered = self.hovered.as_ref() == Some(&e.control);
                    let color = match look.quiet_button(false, hovered, true) {
                        Some(button) if look.is_system() => {
                            if let Some(fill) = button.fill {
                                rounded(&mut c, b, 6., fill, scale);
                            }
                            if let Some((width, edge)) = button.edge {
                                outline(&mut c, b, 6., width, edge, scale);
                            }
                            button.text
                        }
                        _ => ink,
                    };
                    // In the sessions' view the switch says the thread's name; in the thread, the way back.
                    let unread = !self.dm_open && self.dm_unread() > 0;
                    let label = if self.dm_open {
                        e.label.clone()
                    } else {
                        self.dm().map(|dm| dm.label.clone()).unwrap_or_default()
                    };
                    text(
                        &mut c,
                        &label,
                        b.x + 8.,
                        b.y + 4.,
                        b.width - 16. - if unread { DM_DOT_ROOM } else { 0. },
                        20.,
                        12.5,
                        &self.chosen.lang,
                        scale,
                        false,
                        color,
                    );
                    if unread {
                        rounded(
                            &mut c,
                            Rect {
                                x: b.x + b.width - 8. - 6.,
                                y: b.y + 8.,
                                width: 6.,
                                height: 6.,
                            },
                            3.,
                            look.accent(),
                            scale,
                        );
                    }
                }
                Control::Close | Control::NewChat if look.is_system() => {
                    let hovered = self.hovered.as_ref() == Some(&e.control);
                    let button = look.quiet_button(false, hovered, true).unwrap();
                    if let Some(fill) = button.fill {
                        rounded(&mut c, b, 6., fill, scale);
                    }
                    if let Some((width, edge)) = button.edge {
                        outline(&mut c, b, 6., width, edge, scale);
                    }
                    text(
                        &mut c,
                        &e.label,
                        b.x + 8.,
                        b.y + 4.,
                        b.width - 16.,
                        20.,
                        12.5,
                        &self.chosen.lang,
                        scale,
                        false,
                        button.text,
                    );
                }
                _ => text(
                    &mut c,
                    &e.label,
                    b.x + 8.,
                    b.y + 4.,
                    b.width - 16.,
                    20.,
                    12.5,
                    &self.chosen.lang,
                    scale,
                    false,
                    ink,
                ),
            }
            if self.focus.as_ref() == Some(&e.control) {
                focus_ring(&mut c, b, 6., look, false, scale);
            }
        }
        if self.rows.is_empty() && !self.dm_open {
            text(
                &mut c,
                self.chosen.word("empty"),
                12.,
                45.,
                276.,
                20.,
                12.5,
                &self.chosen.lang,
                scale,
                false,
                ink,
            );
        }
        if let Some(status) = self.request_status() {
            let y = if self.dm_open {
                self.dm_bubbles().last().map_or(39., |(_, b)| b.y + b.height + DM_GAP) + 2.
            } else {
                39. + self.rows.iter().map(|r| self.row_height(r)).sum::<f64>()
                    + if self.rows.is_empty() { 30. } else { 0. }
            };
            text(
                &mut c,
                status,
                12.,
                y + 4.,
                276.,
                20.,
                12.5,
                &self.chosen.lang,
                scale,
                false,
                ink,
            );
        }
        if let Some(q) = self.chosen.quota.as_ref().filter(|_| !self.dm_open) {
            let rows = self.quota_foot_rows();
            let top = self.activity_body_bottom() + 12.;
            let mut foot = Canvas::blank(c.width, c.height);
            rounded(
                &mut foot,
                Rect {
                    x: 0.,
                    y: top,
                    width: w,
                    height: h - top,
                },
                0.,
                look.foot_fill(),
                scale,
            );
            clip_rounded(&mut foot, full, 9., scale);
            blit(&mut c, &foot.pixels, foot.width, foot.height, 0, 0);
            let (hairline, hairline_color) = look.divider(false);
            rounded(
                &mut c,
                Rect {
                    x: 12.,
                    y: top,
                    width: 276.,
                    height: hairline,
                },
                0.,
                hairline_color,
                scale,
            );
            // The battery and the power bank, as on the band, at one point an art pixel, on the first line.
            let ground = look.foot_fill();
            let dark_ground = (ground[0] as u32 + ground[1] as u32 + ground[2] as u32) < 3 * 128;
            let mut y = top + 5.;
            for (window, (announcement, height)) in q.windows.iter().zip(rows) {
                if let Some(picture) = crate::quota_pixels::for_window(&window.kind, window.used) {
                    crate::quota_pixels::draw(&mut c, &picture, 12., y + 4., scale, dark_ground, look.quota_picture());
                }
                text(
                    &mut c,
                    &announcement,
                    QUOTA_TEXT_X,
                    y,
                    QUOTA_TEXT_WIDTH,
                    height,
                    12.5,
                    &self.chosen.lang,
                    scale,
                    false,
                    ink,
                );
                *c.text_prefixes.last_mut().unwrap() =
                    window.display_name(&self.chosen.lang).chars().count();
                y += height + quota_row_gap(height);
            }
        }
        let (edge_width, edge) = look.panel_edge(false);
        outline(&mut c, full, 9., edge_width, edge, scale);
        c
    }

    pub fn paint_hover(&self, c: &mut Canvas, scale: f64) {
        set_draw_scale(scale);
        c.paper_dark = self.dark;
        let look = self.look();
        c.look = look;
        if self.hover_visible && self.hover_bounds().width > 0. {
            let row = self.hover_bounds();
            // The hover row is the book's near-black cloth in both appearances (a contrast theme keeps the system's colours);
            // its icons are the light set, so the look is asked as on a dark panel.
            crate::shapes::cover_shape(c, row, 10., scale);
            for i in self.hover_indices() {
                let hovered = self.hover_index == Some(i) || self.focus == Some(Control::Hover(i));
                let b = self.hover_button(i);
                let button = look.icon_button(true, hovered);
                if let Some(fill) = button.and_then(|button| button.fill) {
                    rounded(c, b, 12., fill, scale);
                } else if hovered {
                    rounded(c, b, 6., [62, 40, 34, 255], scale);
                }
                let icon = match i {
                    0 => "activity",
                    1 => "back",
                    2 => {
                        if self.context.lines_hidden {
                            "lines-off"
                        } else {
                            "lines"
                        }
                    }
                    3 => "hide",
                    _ => "size",
                };
                let unseen = i == 0 && self.unseen > 0;
                match button.map(|button| button.text) {
                    None => {
                        c.paper_dark = true;
                        draw_icon(c, icon, hovered, unseen, b.x + 2., b.y + 2., 20., scale);
                        c.paper_dark = self.dark;
                    }
                    Some(glyph) => {
                        draw_icon_tinted(c, icon, glyph, b.x + 2., b.y + 2., 20., scale);
                        if let (true, Some((dot, ring))) = (unseen, look.bell_dot()) {
                            draw_bell_dot(c, dot, ring, b.x + 2., b.y + 2., 20., scale);
                        }
                    }
                }
                if self.focus == Some(Control::Hover(i)) {
                    focus_ring(c, b, 6., look, true, scale);
                }
                c.input_rect(
                    (b.x * scale) as i32,
                    (b.y * scale) as i32,
                    (24. * scale) as u32,
                    (24. * scale) as u32,
                );
            }
        }
        if self.badge_count() > 0 && self.badge_bounds().width > 0. {
            let b = self.badge_bounds();
            let badge = look.badge();
            rounded(
                c,
                b,
                10.,
                badge
                    .and_then(|badge| badge.fill)
                    .unwrap_or([158, 65, 35, 255]),
                scale,
            );
            let (ring_width, ring) = badge
                .and_then(|badge| badge.edge)
                .unwrap_or((1.5, [250, 238, 233, 255]));
            outline(c, b, 10., ring_width, ring, scale);
            let label = if self.badge_count() >= 10 {
                "9+".into()
            } else {
                self.badge_count().to_string()
            };
            let width = text_width(&label, &self.chosen.lang, 11.5, true, false);
            text(
                c,
                &label,
                b.x + (b.width - width) / 2.,
                b.y + 3.,
                width,
                17.,
                11.5,
                &self.chosen.lang,
                scale,
                true,
                badge.map_or([250, 238, 233, 255], |badge| badge.text),
            );
            c.input_rect(
                (b.x * scale) as i32,
                (b.y * scale) as i32,
                (b.width * scale) as u32,
                (b.height * scale) as u32,
            );
        }
        if let Some(i) = self.selected_hover_index() {
            if let Some(b) = self.hover_label_bounds(i) {
                let e = self
                    .content_elements()
                    .into_iter()
                    .find(|e| e.control == Control::Hover(i))
                    .unwrap();
                crate::shapes::cover_shape(c, b, 10., scale);
                text(
                    c,
                    &e.label,
                    b.x + 8.,
                    b.y + 3.,
                    b.width - 16.,
                    17.,
                    12.,
                    &self.chosen.lang,
                    scale,
                    false,
                    crate::shapes::cover_ink(c),
                );
            }
        }
    }
}
fn move_texts(c: &mut Canvas, inner: &mut Canvas, offset: f64) {
    for run in &mut inner.texts {
        run.x += offset;
        run.y += offset;
    }
    c.texts.append(&mut inner.texts);
    c.text_styles.append(&mut inner.text_styles);
    c.text_prefixes.append(&mut inner.text_prefixes);
    c.text_sans.append(&mut inner.text_sans);
    c.text_weights.append(&mut inner.text_weights);
    c.text_middle.append(&mut inner.text_middle);
}
fn screen(r: Rect) -> crate::motion::ScreenRect {
    crate::motion::ScreenRect {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
    }
}
fn avoid_face_rect(r: Rect, visible: Rect, frame: Rect) -> Option<Rect> {
    crate::motion::avoid_face(
        screen(r),
        screen(visible),
        crate::motion::face_keep_out(screen(frame)),
    )
    .map(|r| Rect {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
    })
}
pub fn pill_bounds(frame: Rect, visible: Rect, width: f64, height: f64) -> Rect {
    pill_bounds_at(frame, visible, width, height, frame.y + 4.)
}
fn pill_bounds_at(frame: Rect, visible: Rect, width: f64, height: f64, bottom: f64) -> Rect {
    let width = width.min((visible.width - 8.).max(1.));
    let height = height.min((visible.height - 4.).max(1.));
    let r = Rect {
        x: frame.x + (frame.width - width) / 2.,
        y: bottom - height,
        width,
        height,
    };
    avoid_face_rect(r, visible, frame).unwrap_or(Rect {
        x: 0.,
        y: 0.,
        width: 0.,
        height: 0.,
    })
}
/// Where a foot row's words start and how wide they run: after the 26-point battery (the 22-point power bank
/// lines up with it), up to the panel's 12-point margin.
const QUOTA_TEXT_X: f64 = 46.;
const QUOTA_TEXT_WIDTH: f64 = 242.;
/// A one-line foot row: the 12-point picture with 4 points above and below.
const QUOTA_ROW_MIN: f64 = 20.;
fn quota_row_gap(height: f64) -> f64 {
    if height > 32. {
        10.
    } else {
        2.
    }
}
pub fn mixed_text_metrics(
    text: &str,
    lang: &str,
    size: f64,
    width: f64,
    height: f64,
    prefix: usize,
) -> (f64, f64, usize) {
    #[cfg(target_os = "macos")]
    {
        crate::platform::macos_text::measure_mixed(
            &crate::render::TextRun {
                text: text.into(),
                lang: lang.into(),
                x: 0.,
                y: 0.,
                width,
                height,
                font_size: size,
                line_height: None,
            },
            prefix,
        )
    }
    #[cfg(target_os = "windows")]
    {
        crate::platform::windows::measure_mixed(text, lang, size, width, height, prefix)
    }
    #[cfg(target_os = "linux")]
    {
        crate::platform::linux::text::measure_mixed(text, lang, size, width, height, prefix)
    }
}
pub fn text_metrics(
    text: &str,
    lang: &str,
    size: f64,
    bold: bool,
    sans: bool,
    width: f64,
    height: f64,
) -> (f64, f64) {
    #[cfg(target_os = "macos")]
    {
        crate::platform::macos_text::measure_ui(text, lang, size, bold, sans, width, height)
    }
    #[cfg(target_os = "windows")]
    {
        crate::platform::windows::measure_ui_weight(
            text,
            lang,
            size,
            if bold { 600 } else { 400 },
            sans,
            width,
            height,
        )
    }
    #[cfg(target_os = "linux")]
    {
        crate::platform::linux::text::measure_ui_weight(
            text,
            lang,
            size,
            if bold { 600 } else { 400 },
            sans,
            width,
            height,
        )
    }
}
/// An activity row is built on a 16 point line: 30 + 16 per excerpt line + 2, and the excerpt box is the
/// row less 32. Fonts on Linux have taller line boxes than that. With Noto CJK, the family the companion asks
/// for first, a 12 point line is 18 points: a one-line excerpt then measured as two lines (a 64 point row
/// instead of 48) and a long one lost its second line, because two 18 point lines do not fit the 32 point
/// box. On Linux the excerpt is measured and painted on the 16 point pitch. macOS and Windows keep the
/// fonts' own line boxes, which already fit.
pub fn excerpt_line_height() -> Option<f64> {
    if cfg!(target_os = "linux") {
        Some(16.)
    } else {
        None
    }
}
pub fn text_metrics_with_line_height(
    text: &str,
    lang: &str,
    size: f64,
    bold: bool,
    sans: bool,
    width: f64,
    height: f64,
    line_height: Option<f64>,
) -> (f64, f64) {
    #[cfg(target_os = "macos")]
    {
        crate::platform::macos_text::measure_ui_with_line_height(
            text,
            lang,
            size,
            bold,
            sans,
            width,
            height,
            line_height,
        )
    }
    #[cfg(target_os = "windows")]
    {
        crate::platform::windows::measure_ui_with_line_height(
            text,
            lang,
            size,
            bold,
            sans,
            width,
            height,
            line_height,
        )
    }
    #[cfg(target_os = "linux")]
    {
        crate::platform::linux::text::measure_ui_with_line_height(
            text,
            lang,
            size,
            bold,
            sans,
            width,
            height,
            line_height,
        )
    }
}
thread_local! {
    static DRAW_SCALE: std::cell::Cell<f64> = const { std::cell::Cell::new(1.) };
}
/// The scale this thread draws at. Text is measured at the size it is drawn at: a hinted advance at 26 px is not twice the
/// one at 13 px, so a box sized from the 1x width and drawn at 2x cut its own words ("Cl..." for "Clear").
pub fn set_draw_scale(scale: f64) {
    DRAW_SCALE.with(|s| s.set(if scale.is_finite() { scale.clamp(0.5, 8.) } else { 1. }));
}
pub fn text_width(text: &str, lang: &str, size: f64, bold: bool, sans: bool) -> f64 {
    let scale = DRAW_SCALE.with(|s| s.get());
    text_metrics(text, lang, size * scale, bold, sans, 10000. * scale, 10000. * scale).0 / scale
}
/// Text wrapped at `width`: its width and height, measured at the scale it is drawn at, as text_width.
pub fn text_size(text: &str, lang: &str, size: f64, width: f64) -> (f64, f64) {
    let scale = DRAW_SCALE.with(|s| s.get());
    let (w, h) = text_metrics(text, lang, size * scale, false, false, width * scale, 10000. * scale);
    (w / scale, h / scale)
}

pub fn time_label(ms: f64) -> String {
    moment_text(ms, crate::epoch_ms() as f64, "en")
}
pub fn sentence_part(text: &str) -> String {
    let text = text.trim_end();
    let end = text
        .chars()
        .rev()
        .find(|c| !matches!(c, '\"' | '\'' | '”' | '’' | '」' | '』' | ')' | '）'));
    if end.is_some_and(|c| matches!(c, '.' | '!' | '?' | '。' | '！' | '？' | '…' | '।')) {
        format!("{text} ")
    } else {
        format!("{text}. ")
    }
}

pub fn moment_text(ms: f64, now: f64, lang: &str) -> String {
    crate::locale::moment(ms, now, lang)
}
pub use crate::shapes::{clip_rounded, outline, paper_shape, rounded, shadow, spark, stroke_paths};
pub fn text(
    c: &mut Canvas,
    s: &str,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    size: f64,
    lang: &str,
    scale: f64,
    bold: bool,
    color: [u8; 4],
) {
    c.texts.push(TextRun {
        text: s.into(),
        lang: lang.into(),
        x: x * scale,
        y: y * scale,
        width: w * scale,
        height: h * scale,
        font_size: size * scale,
        line_height: None,
    });
    c.text_styles.push((bold, color));
    c.text_prefixes.push(0);
    c.text_sans.push(false);
    c.text_weights.push(if bold { 600 } else { 400 });
    c.text_middle.push(false);
}
pub fn draw_icon(
    c: &mut Canvas,
    name: &str,
    hover: bool,
    unseen: bool,
    x: f64,
    y: f64,
    size: f64,
    scale: f64,
) {
    let name = format!(
        "hover-{name}{}{}",
        if hover { "-hover" } else { "" },
        if unseen { "-unseen" } else { "" }
    );
    let icons: &[(&str, &[u8])] = &[
        (
            "hover-activity-hover-unseen",
            include_bytes!("../assets/icons/hover-activity-hover-unseen.svg").as_slice(),
        ),
        (
            "hover-activity-hover",
            include_bytes!("../assets/icons/hover-activity-hover.svg").as_slice(),
        ),
        (
            "hover-activity-unseen",
            include_bytes!("../assets/icons/hover-activity-unseen.svg").as_slice(),
        ),
        (
            "hover-activity",
            include_bytes!("../assets/icons/hover-activity.svg").as_slice(),
        ),
        (
            "hover-back-hover",
            include_bytes!("../assets/icons/hover-back-hover.svg").as_slice(),
        ),
        (
            "hover-back",
            include_bytes!("../assets/icons/hover-back.svg").as_slice(),
        ),
        (
            "hover-hide-hover",
            include_bytes!("../assets/icons/hover-hide-hover.svg").as_slice(),
        ),
        (
            "hover-hide",
            include_bytes!("../assets/icons/hover-hide.svg").as_slice(),
        ),
        (
            "hover-lines-hover",
            include_bytes!("../assets/icons/hover-lines-hover.svg").as_slice(),
        ),
        (
            "hover-lines-off-hover",
            include_bytes!("../assets/icons/hover-lines-off-hover.svg").as_slice(),
        ),
        (
            "hover-lines-off",
            include_bytes!("../assets/icons/hover-lines-off.svg").as_slice(),
        ),
        (
            "hover-lines",
            include_bytes!("../assets/icons/hover-lines.svg").as_slice(),
        ),
        (
            "hover-size-hover",
            include_bytes!("../assets/icons/hover-size-hover.svg").as_slice(),
        ),
        (
            "hover-size",
            include_bytes!("../assets/icons/hover-size.svg").as_slice(),
        ),
    ];
    if let Some((_, b)) = icons.iter().find(|(n, _)| *n == name) {
        let bytes = if c.paper_dark {
            let source = String::from_utf8_lossy(b);
            if hover {
                source
                    .replace("#C75730", "#E07A55")
                    .replace("#c75730", "#E07A55")
                    .into_bytes()
            } else {
                source
                    .replace("#5C2A1E", "#FAEEE9")
                    .replace("#5c2a1e", "#FAEEE9")
                    .into_bytes()
            }
        } else {
            b.to_vec()
        };
        draw_svg(c, &bytes, x, y, size, size, scale)
    }
}
pub use crate::vectors::{draw_svg, vector_image};
pub fn blit(c: &mut Canvas, pixels: &[u8], w: u32, h: u32, x: i32, y: i32) {
    for sy in 0..h {
        for sx in 0..w {
            let (dx, dy) = (x + sx as i32, y + sy as i32);
            if dx < 0 || dy < 0 || dx >= c.width as i32 || dy >= c.height as i32 {
                continue;
            }
            let src = (sy * w + sx) as usize * 4;
            let dest = (dy as u32 * c.width + dx as u32) as usize * 4;
            let a = pixels[src + 3] as u32;
            for k in 0..4 {
                c.pixels[dest + k] = (pixels[src + k] as u32
                    + c.pixels[dest + k] as u32 * (255 - a) / 255)
                    .min(255) as u8;
            }
        }
    }
}

/// Draw a single-colour vector in another colour, keeping its coverage. The approved glyphs are
/// strokes of one colour, so recolouring the coverage is exact and works for any system colour.
pub fn draw_svg_tinted(
    c: &mut Canvas,
    bytes: &[u8],
    x: f64,
    y: f64,
    size: f64,
    color: [u8; 4],
    scale: f64,
) {
    let Ok(image) = vector_image(bytes, size, size, scale) else {
        return;
    };
    let mut pixels = image.pixels.clone();
    for p in pixels.chunks_exact_mut(4) {
        let a = p[3] as u32;
        p[0] = (color[0] as u32 * a / 255) as u8;
        p[1] = (color[1] as u32 * a / 255) as u8;
        p[2] = (color[2] as u32 * a / 255) as u8;
    }
    blit(
        c,
        &pixels,
        image.width as u32,
        image.height as u32,
        (x * scale).round() as i32,
        (y * scale).round() as i32,
    );
}
/// A hover-row glyph in one colour, without its bell dot.
pub fn draw_icon_tinted(
    c: &mut Canvas,
    name: &str,
    color: [u8; 4],
    x: f64,
    y: f64,
    size: f64,
    scale: f64,
) {
    let bytes: Option<&[u8]> = match name {
        "activity" => Some(include_bytes!("../assets/icons/hover-activity.svg")),
        "back" => Some(include_bytes!("../assets/icons/hover-back.svg")),
        "hide" => Some(include_bytes!("../assets/icons/hover-hide.svg")),
        "lines" => Some(include_bytes!("../assets/icons/hover-lines.svg")),
        "lines-off" => Some(include_bytes!("../assets/icons/hover-lines-off.svg")),
        "size" => Some(include_bytes!("../assets/icons/hover-size.svg")),
        _ => None,
    };
    if let Some(bytes) = bytes {
        draw_svg_tinted(c, bytes, x, y, size, color, scale);
    }
}
/// The unseen dot on the bell, where the icon's own SVG puts it, with a 1 pt ring of the ground
/// round it so it holds on a solid disc.
fn draw_bell_dot(
    c: &mut Canvas,
    dot: [u8; 4],
    ring: [u8; 4],
    x: f64,
    y: f64,
    size: f64,
    scale: f64,
) {
    let unit = size / 24.;
    let (cx, cy, r) = (x + 19.6 * unit, y + 5. * unit, 2.6 * unit);
    let disc = |color: [u8; 4], r: f64, c: &mut Canvas| {
        rounded(
            c,
            Rect {
                x: cx - r,
                y: cy - r,
                width: 2. * r,
                height: 2. * r,
            },
            r,
            color,
            scale,
        )
    };
    disc(ring, r + 1., c);
    disc(dot, r, c);
}
/// A keyboard focus ring in the look's own width and colour. A system look keeps one point of the
/// panel's colour between the control and the ring so the ring never merges with the control.
fn focus_ring(
    c: &mut Canvas,
    b: Rect,
    r: f64,
    look: crate::contrast::Look,
    dark: bool,
    scale: f64,
) {
    let (width, color, gap) = look.focus(dark);
    if gap > 0. {
        let grow = |by: f64| Rect {
            x: b.x - by,
            y: b.y - by,
            width: b.width + 2. * by,
            height: b.height + 2. * by,
        };
        outline(c, grow(gap), r + gap, gap, look.panel_fill(dark), scale);
        outline(c, grow(gap + width), r + gap + width, width, color, scale);
    } else {
        outline(c, b, r, width, color, scale);
    }
}
fn draw_send(
    c: &mut Canvas,
    x: f64,
    y: f64,
    size: f64,
    scale: f64,
    opacity: f64,
    tint: Option<[u8; 4]>,
) {
    let mut layer = Canvas::blank((size * scale).round() as u32, (size * scale).round() as u32);
    match tint {
        Some(color) => draw_svg_tinted(
            &mut layer,
            include_bytes!("../assets/icons/send-arrow.svg"),
            0.,
            0.,
            size,
            color,
            scale,
        ),
        None => draw_svg(
            &mut layer,
            include_bytes!("../assets/icons/send-arrow.svg"),
            0.,
            0.,
            size,
            size,
            scale,
        ),
    }
    for p in &mut layer.pixels {
        *p = (*p as f64 * opacity).round() as u8;
    }
    blit(
        c,
        &layer.pixels,
        layer.width,
        layer.height,
        (x * scale).round() as i32,
        (y * scale).round() as i32,
    );
}

