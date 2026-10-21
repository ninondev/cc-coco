use std::io::Write;
use std::sync::Mutex;

use serde_json::{Map, Value, json};

/// What the plugin gets back. Kinds only: the plugin maps them to its own words.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Invalid,
    Credit,
    Rate,
    Busy,
    Offline,
    Model,
    Refusal,
    Daily,
    Cap,
    Other,
    /// Keychain denied, keyring locked, key missing, or a store helper that will not run.
    Computer,
    /// `add` only: the text is not a key the endpoint takes (on Anthropic's host, an sk-ant- key).
    Format,
    /// `add` only: the dialog was cancelled or the terminal read was interrupted.
    Cancelled,
    /// `add` only: the base URL or the model breaks the rules (endpoint.rs).
    Address,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Invalid => "invalid",
            Kind::Credit => "credit",
            Kind::Rate => "rate",
            Kind::Busy => "busy",
            Kind::Offline => "offline",
            Kind::Model => "model",
            Kind::Refusal => "refusal",
            Kind::Daily => "daily",
            Kind::Cap => "cap",
            Kind::Other => "other",
            Kind::Computer => "computer",
            Kind::Format => "format",
            Kind::Cancelled => "cancelled",
            Kind::Address => "address",
        }
    }
}

/// A failure with a short machine detail. `detail` never holds key material.
#[derive(Debug)]
pub struct Fail {
    pub kind: Kind,
    pub detail: String,
    pub status: Option<u16>,
    pub retry_after: Option<u64>,
}

impl Fail {
    pub fn new(kind: Kind, detail: impl Into<String>) -> Self {
        Fail { kind, detail: detail.into(), status: None, retry_after: None }
    }
}

/// One answer per run: whichever of main and the deadline watchdog writes first wins.
static ANSWERED: Mutex<bool> = Mutex::new(false);

/// A closed or broken stdout is ignored rather than turned into a panic, which would abort.
fn emit(obj: Map<String, Value>) {
    let mut done = ANSWERED.lock().unwrap_or_else(|e| e.into_inner());
    if *done {
        return;
    }
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{}", Value::Object(obj));
    let _ = out.flush();
    *done = true;
}

pub fn print_ok(kind: &str, fields: Map<String, Value>) -> i32 {
    let mut obj = Map::new();
    obj.insert("kind".into(), json!(kind));
    obj.extend(fields);
    emit(obj);
    0
}

fn fail_object(command: &str, fail: &Fail) -> Map<String, Value> {
    let mut obj = Map::new();
    if command == "send" {
        obj.insert("text".into(), Value::Null);
        obj.insert("usage".into(), Value::Null);
    }
    obj.insert("kind".into(), json!(fail.kind.as_str()));
    obj.insert("detail".into(), json!(fail.detail));
    if let Some(s) = fail.status {
        obj.insert("status".into(), json!(s));
    }
    if let Some(s) = fail.retry_after {
        obj.insert("retry_after".into(), json!(s));
    }
    obj
}

pub fn print_fail(command: &str, fail: &Fail) -> i32 {
    emit(fail_object(command, fail));
    1
}

/// The deadline watchdog's answer, then exit. Holding the lock through exit keeps main from
/// writing after it; if main has already answered, main's own exit stands.
pub fn print_fail_and_exit(command: &str, fail: &Fail) {
    let done = ANSWERED.lock().unwrap_or_else(|e| e.into_inner());
    if !*done {
        let mut out = std::io::stdout().lock();
        let _ = writeln!(out, "{}", Value::Object(fail_object(command, fail)));
        let _ = out.flush();
        std::process::exit(1);
    }
}
