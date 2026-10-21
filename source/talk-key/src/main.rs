//! talk-key: keeps one API key, with the endpoint and model it is for, in the system's store and
//! sends Talk's and Explain's calls with it, so the plugin, the chat and the logs never hold the key
//! (design/1.0/TALK-KEY.md §3 and «Changed 10-10, the owner»).
//!
//!   talk-key add [--base URL] [--model M]
//!                                read the key from this terminal (a plain pipe is refused)
//!   talk-key add --dialog --title T --text X --save S --cancel C [--base URL] [--model M]
//!                                ask through the system's password dialog
//!   talk-key remove
//!   talk-key send                JSON on stdin, `{ text, usage, kind }` on stdout
//!   talk-key status              check the saved key again (the «Check again» press)
//!
//! Every command prints one JSON line with a `kind` and exits 0 when it worked, 1 when not.

#[cfg(all(feature = "test-hooks", not(debug_assertions)))]
compile_error!("the test-hooks feature is for debug test builds only; release builds keep the host fixed");

mod child;
mod counter;
mod deadline;
mod endpoint;
mod hooks;
mod http;
mod input;
mod out;
mod paths;
mod request;
mod secret;
mod store;
mod trust;

use std::io::Read;

use serde_json::{Map, Value, json};

use deadline::Phase;
use endpoint::{Endpoint, Record};
use out::{Fail, Kind, print_fail, print_ok};

/// The save check, which costs no tokens. On api.anthropic.com `GET /v1/models/{model}`; elsewhere
/// `GET {base}/v1/models`, and a 404 or 405 there keeps the key as «saved, not checked yet».
fn check(rec: &Record) -> Result<&'static str, Fail> {
    let path = if rec.endpoint.is_anthropic() { format!("/v1/models/{}", rec.model) } else { "/v1/models".to_string() };
    let reply = http::call(&rec.endpoint, "GET", &path, &rec.key, None)?;
    match reply.status {
        200 => Ok("works"),
        404 | 405 if !rec.endpoint.is_anthropic() => Ok("saved"),
        status => Err(request::fail_for_status(status, &reply.body, reply.retry_after)),
    }
}

/// What the row may show: never the key, only its last four, where it is kept and where it goes.
fn described(rec: &Record, place: Option<&str>) -> Map<String, Value> {
    let mut m = Map::new();
    m.insert("last4".into(), json!(rec.key.last4()));
    if let Some(p) = place {
        m.insert("store".into(), json!(p));
    }
    m.insert("host".into(), json!(rec.endpoint.authority()));
    m.insert("model".into(), json!(rec.model));
    m
}

struct AddArgs {
    words: Option<input::Words>,
    base: String,
    model: String,
}

fn add_args(args: &[String]) -> Result<AddArgs, Fail> {
    let usage = || Fail::new(Kind::Other, "usage");
    let mut a = AddArgs { words: None, base: endpoint::DEFAULT_BASE.into(), model: endpoint::DEFAULT_MODEL.into() };
    let mut w = input::Words { title: String::new(), text: String::new(), save: String::new(), cancel: String::new() };
    let mut dialog = false;
    let mut it = args.iter();
    while let Some(flag) = it.next() {
        if flag == "--dialog" {
            dialog = true;
            continue;
        }
        let slot = match flag.as_str() {
            "--title" => &mut w.title,
            "--text" => &mut w.text,
            "--save" => &mut w.save,
            "--cancel" => &mut w.cancel,
            "--base" => &mut a.base,
            "--model" => &mut a.model,
            _ => return Err(usage()),
        };
        *slot = it.next().cloned().ok_or_else(usage)?;
    }
    let any_words = !(w.title.is_empty() && w.text.is_empty() && w.save.is_empty() && w.cancel.is_empty());
    if dialog {
        if w.title.is_empty() || w.text.is_empty() || w.save.is_empty() || w.cancel.is_empty() {
            return Err(usage());
        }
        a.words = Some(w);
    } else if any_words {
        return Err(usage());
    }
    Ok(a)
}

/// The base URL and the model are checked first, then the terminal, then the brake (before any
/// dialog, so a loop cannot raise a stream of password boxes), then the key.
fn add(args: &[String]) -> Result<i32, Fail> {
    let a = add_args(args)?;
    let ep = Endpoint::parse(&a.base)?;
    endpoint::check_model(&a.model, &ep)?;
    if a.words.is_none() {
        input::ensure_terminal()?;
    }
    counter::take_check()?;
    let key = match &a.words {
        None => input::from_terminal(&ep)?,
        Some(w) => input::from_dialog(w, &ep)?,
    };
    let rec = Record { key, endpoint: ep, model: a.model };
    deadline::start("add");
    deadline::enter(Phase::Network);
    let kind = check(&rec)?;
    deadline::enter(Phase::Store);
    let place = store::save(&rec.encode())?;
    Ok(print_ok(kind, described(&rec, Some(place))))
}

fn status() -> Result<i32, Fail> {
    deadline::start("status");
    counter::take_check()?;
    deadline::enter(Phase::Store);
    let (stored, place) = store::load()?;
    let rec = Record::decode(&stored)?;
    deadline::enter(Phase::Network);
    let kind = check(&rec)?;
    Ok(print_ok(kind, described(&rec, Some(place))))
}

fn remove() -> Result<i32, Fail> {
    deadline::start("remove");
    deadline::enter(Phase::Store);
    store::remove()?;
    Ok(print_ok("removed", Map::new()))
}

/// The input is checked and counted before the record is read, so bad or over-limit input never
/// touches the store (and never raises a Keychain prompt). An input naming another model or host
/// is refused once the record is read, after it was counted. A send that times out stays counted:
/// the request may have reached the provider, and nothing retries it.
fn send() -> Result<i32, Fail> {
    deadline::start("send");
    let mut input = Vec::new();
    std::io::stdin()
        .take(request::STDIN_LIMIT as u64 + 1)
        .read_to_end(&mut input)
        .map_err(|_| Fail::new(Kind::Other, "stdin"))?;
    let draft = request::draft(&input)?;
    let counts = counter::take()?;
    deadline::enter(Phase::Store);
    let (stored, _) = store::load()?;
    let rec = Record::decode(&stored)?;
    draft.bound(&rec)?;
    deadline::enter(Phase::Network);
    // A talk send naming no cap takes the stored model's own limit, read from its models entry on
    // api.anthropic.com alone (the model is in the path only there, where `/` is refused); no answer is no limit.
    let limit = if draft.open_cap() && rec.endpoint.is_anthropic() {
        http::call(&rec.endpoint, "GET", &format!("/v1/models/{}", rec.model), &rec.key, None)
            .ok()
            .filter(|r| r.status == 200)
            .and_then(|r| request::model_limit(&r.body))
    } else {
        None
    };
    let body = request::body(draft, &rec, limit)?;
    let reply = http::call(&rec.endpoint, "POST", "/v1/messages", &rec.key, Some(&body))?;
    if reply.status != 200 {
        return Err(request::fail_for_status(reply.status, &reply.body, reply.retry_after));
    }
    let (text, usage) = request::read_reply(&reply.body)?;
    let mut m = described(&rec, None);
    m.remove("last4");
    m.insert("text".into(), Value::String(text));
    m.insert("usage".into(), usage);
    m.insert("count".into(), json!({ "minute": counts.minute, "day": counts.day }));
    Ok(print_ok("ok", m))
}

/// No core file and, on Linux, no same-user ptrace or /proc/pid/mem: the key is in memory.
#[cfg(unix)]
fn harden() {
    let zero = libc::rlimit { rlim_cur: 0, rlim_max: 0 };
    unsafe { libc::setrlimit(libc::RLIMIT_CORE, &zero) };
    #[cfg(target_os = "linux")]
    unsafe {
        libc::prctl(libc::PR_SET_DUMPABLE, 0, 0, 0, 0)
    };
}

#[cfg(not(unix))]
fn harden() {}

fn main() {
    harden();
    let args: Vec<String> = std::env::args().skip(1).collect();
    let command = args.first().cloned().unwrap_or_default();
    let rest = args.get(1..).unwrap_or(&[]);
    let result = match command.as_str() {
        "add" => add(rest),
        "remove" if rest.is_empty() => remove(),
        "send" if rest.is_empty() => send(),
        "status" if rest.is_empty() => status(),
        _ => Err(Fail::new(Kind::Other, "usage")),
    };
    let code = match result {
        Ok(code) => code,
        Err(f) => print_fail(&command, &f),
    };
    std::process::exit(code);
}
