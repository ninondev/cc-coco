use std::collections::BTreeMap;
pub type ReactionLines = BTreeMap<String, Vec<String>>;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TouchEvent {
    Press,
    Click { alternate: bool },
    DragStart,
    Drop,
    LongPress,
    /// From the menu's Actions: the fluster three quick clicks bring.
    Burst,
}
#[derive(Clone, Debug, PartialEq)]
pub struct Reaction {
    pub key: String,
    pub frame: String,
    pub hold: f64,
    pub line: Option<String>,
    pub line_hold: f64,
    pub wakes: bool,
    pub delay_ms: f64,
    pub started_at: f64,
}
#[derive(Clone, Debug)]
pub struct Reactor {
    pub clicks: Vec<f64>,
    last_key: Option<String>,
    last_line: Option<String>,
    last_line_at: f64,
    last_by_key: BTreeMap<String, String>,
    wake_started: Option<f64>,
}
impl Default for Reactor {
    fn default() -> Self {
        Self {
            clicks: Vec::new(),
            last_key: None,
            last_line: None,
            last_line_at: f64::NEG_INFINITY,
            last_by_key: BTreeMap::new(),
            wake_started: None,
        }
    }
}
impl Reactor {
    pub const CLICK_WINDOW: f64 = 1.5;
    pub const FLUSTER_AT: usize = 3;
    pub const LINE_GAP: f64 = 1.2;
    pub fn react(
        &mut self,
        event: TouchEvent,
        now: f64,
        mood: &str,
        lines: &ReactionLines,
        random: f64,
    ) -> Reaction {
        let wakes = mood == "sleep";
        if wakes && self.wake_started.is_none() {
            self.wake_started = Some(now)
        }
        let wake_left = self
            .wake_started
            .map(|start| (450.0 - (now - start) * 1000.0).max(0.0))
            .unwrap_or(0.0);
        if wake_left == 0.0 {
            self.wake_started = None
        }
        let (key, frame, mut hold): (&str, &str, f64) = match event {
            TouchEvent::Press => ("press", "idle-blink", 0.55),
            // An Option-click is a click: its own reaction (Shiori peeking out) waits until after 1.0 (his 10-16 card).
            TouchEvent::Click { .. } => {
                self.clicks.retain(|t| now - *t < Self::CLICK_WINDOW);
                self.clicks.push(now);
                if self.clicks.len() >= Self::FLUSTER_AT {
                    ("flustered", "flustered", 1.8)
                } else {
                    ("pat", "happy", 1.4)
                }
            }
            TouchEvent::DragStart => ("drag", "error", 600.0),
            TouchEvent::Drop => ("drop", "idle-blink", 1.0),
            TouchEvent::LongPress => ("hold", "refuse", 1.6),
            TouchEvent::Burst => ("flustered", "flustered", 1.8),
        };
        let urgent = ["waiting", "question", "wild", "error"].contains(&mood);
        let line_hold = if urgent { 2.0 } else { 2.6 };
        if urgent && key != "drag" {
            hold = hold.min(0.9)
        }
        let mut line = None;
        if key != "press"
            && !(self.last_key.as_deref() == Some(key) && now - self.last_line_at < Self::LINE_GAP)
        {
            if let Some(options) = lines.get(key) {
                let last_ending = self.last_line.as_deref().map(Self::ending);
                let mut pool: Vec<&String> = options
                    .iter()
                    .filter(|s| {
                        Some(s.as_str()) != self.last_by_key.get(key).map(String::as_str)
                            && Some(s.as_str()) != self.last_line.as_deref()
                            && Some(Self::ending(s)) != last_ending
                    })
                    .collect();
                if pool.is_empty() {
                    pool = options
                        .iter()
                        .filter(|s| Some(s.as_str()) != self.last_line.as_deref())
                        .collect()
                }
                if !pool.is_empty() {
                    let pick =
                        pool[((random * pool.len() as f64) as usize).min(pool.len() - 1)].clone();
                    self.last_by_key.insert(key.into(), pick.clone());
                    self.last_line = Some(pick.clone());
                    self.last_line_at = now;
                    line = Some(pick);
                }
            }
        }
        if key != "press" {
            self.last_key = Some(key.into())
        }
        let delay_ms = if wakes && event == TouchEvent::DragStart {
            33.0
        } else if event == TouchEvent::Press {
            0.0
        } else {
            wake_left
        };
        Reaction {
            key: key.into(),
            frame: frame.into(),
            hold,
            line,
            line_hold,
            wakes,
            delay_ms,
            started_at: now,
        }
    }
    pub fn ending(line: &str) -> String {
        let chars: Vec<char> = line.chars().collect();
        if chars.is_empty() {
            return String::new();
        }
        let start = if matches!(chars.last(), Some(')' | '）'))
            && chars.iter().any(|c| matches!(c, '(' | '（'))
        {
            chars.iter().rposition(|c| matches!(c, '(' | '（')).unwrap()
        } else {
            chars
                .iter()
                .rposition(|c| *c == '\n' || *c == ' ' || is_cjk(*c))
                .map(|n| n + 1)
                .unwrap_or(0)
        };
        let face: String = chars[start..]
            .iter()
            .filter(|c| !"()（） ".contains(**c))
            .collect();
        if face.is_empty() {
            chars.last().unwrap().to_string()
        } else {
            face
        }
    }
}
fn is_cjk(c: char) -> bool {
    matches!(c as u32,0x2E80..=0x9FFF|0xAC00..=0xD7AF|0xF900..=0xFAFF|0xFF01..=0xFF60)
}
pub fn english_reactions() -> ReactionLines {
    [
        (
            "pat",
            vec![
                "more pats. that's an order ✨",
                "antennae up (*´ω`*)",
                "the keycap clip's crooked now >_<",
                "(hides in the hood) ˘ᵕ˘",
                "purrr 🐱",
            ],
        ),
        (
            "flustered",
            vec![
                "too fast >_<",
                "stop poking (//ω//)",
                "i'm not a button (>д<)",
                "combo broken 💦",
                "my antennae are tangled @_@",
                "spam detected 🚫",
            ],
        ),
        (
            "drag",
            vec![
                "we're flying ✈️",
                "where to o.o",
                "mind the hoodie (⊙_⊙)",
                "liftoff ✨",
                "don't drop me >~<",
            ],
        ),
        (
            "drop",
            vec![
                "safe landing 🛬",
                "(zips the hoodie back up) u_u",
                "that was fun ^_^",
                "nice spot 🌿",
                "plop ☁️",
            ],
        ),
        (
            "hold",
            vec![
                "squish >_<",
                "i'm tiny, you know (´･ω･`)",
                "let me go (T_T)",
                "the laptop's getting squished 💻",
            ],
        ),
    ]
    .into_iter()
    .map(|(key, lines)| {
        (
            key.to_owned(),
            lines.into_iter().map(str::to_owned).collect(),
        )
    })
    .collect()
}
