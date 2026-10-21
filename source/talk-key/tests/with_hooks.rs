//! TALK-KEY §6 checks that need the test seams: run with `cargo test --features test-hooks`.
//! The binary dials a local server through TALK_KEY_TEST_ENDPOINT and trusts only the
//! throwaway CA; SNI and the Host header stay api.anthropic.com.
#![cfg(all(feature = "test-hooks", target_os = "linux"))]

mod common;

use std::cell::Cell;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;

use common::*;
use serde_json::json;

struct Bench {
    dir: PathBuf,
    home: PathBuf,
    ca_file: PathBuf,
    ca: Ca,
    server: Server,
    tool: Option<PathBuf>,
    now: Cell<i64>,
}

/// 2026-10-10 08:00 UTC; the tests run with TZ=UTC so the local day is fixed.
const MORNING: i64 = 1_791_590_400 + 8 * 3600;

impl Bench {
    fn new(name: &str, keyring: bool) -> Bench {
        let dir = scratch(name);
        let home = dir.join("home");
        std::fs::create_dir_all(&home).unwrap();
        let ca = ca();
        let ca_file = dir.join("ca.pem");
        std::fs::write(&ca_file, &ca.pem).unwrap();
        let server = serve(ca.server.clone(), reply("Hello from the stand-in."), false);
        let tool = keyring.then(|| {
            let t = dir.join("tool");
            std::fs::create_dir_all(&t).unwrap();
            fake_secret_tool(&t)
        });
        Bench { dir, home, ca_file, ca, server, tool, now: Cell::new(MORNING) }
    }

    fn env(&self) -> Vec<(&'static str, String)> {
        vec![
            ("TALK_KEY_TEST_ENDPOINT", self.server.endpoint()),
            ("TALK_KEY_TEST_CA", self.ca_file.display().to_string()),
            ("TALK_KEY_TEST_HOME", self.home.display().to_string()),
            ("TALK_KEY_TEST_SECRET_TOOL", self.tool.as_ref().map_or("none".into(), |t| t.display().to_string())),
            ("TALK_KEY_TEST_NOW", self.now.get().to_string()),
        ]
    }

    fn with(&self, extra: &[(&'static str, String)]) -> Vec<(&'static str, String)> {
        let mut e = self.env();
        for (k, v) in extra {
            e.retain(|(n, _)| n != k);
            e.push((k, v.clone()));
        }
        e
    }

    /// Key checks are braked to one a second, so each one moves the clock on.
    fn tick(&self) {
        self.now.set(self.now.get() + 2);
    }

    fn add(&self, key: &str) -> Run {
        self.tick();
        run_tty(&["add"], &self.env(), key)
    }

    fn status(&self) -> Run {
        self.tick();
        run(&["status"], &self.env(), None)
    }

    fn send(&self, text: &str) -> Run {
        run(&["send"], &self.env(), Some(&send_input(text)))
    }

    fn tool_dir(&self) -> Option<PathBuf> {
        self.tool.as_ref().map(|t| t.parent().unwrap().to_path_buf())
    }

    fn key_file(&self) -> PathBuf {
        self.home.join(".config/coco/talk-key")
    }
}

fn kind(r: &Run) -> &str {
    r.json["kind"].as_str().unwrap_or("")
}

fn assert_clean(r: &Run, key: &str) {
    assert!(!r.stdout.contains(key), "key in stdout: {}", r.stdout);
    assert!(!r.stderr.contains(key), "key in stderr");
    assert!(!contains(&r.terminal, key), "key echoed on the terminal");
}

fn read(p: &Path) -> String {
    std::fs::read_to_string(p).unwrap_or_default()
}

#[test]
fn canary_through_the_keyring_add_send_remove() {
    let b = Bench::new("keyring", true);
    let key = canary();

    let r = b.add(&key);
    assert_eq!(kind(&r), "works", "{} {}", r.stdout, r.stderr);
    assert_eq!(r.json["last4"], "x7Qa");
    assert_eq!(r.json["store"], "secret-service");
    assert_clean(&r, &key);
    let check = &b.server.seen()[0];
    assert_eq!((check.method.as_str(), check.path.as_str()), ("GET", "/v1/models/claude-haiku-5-5"));
    assert_eq!(check.header("x-api-key"), Some(key.as_str()));

    let r = b.send("hello");
    assert_eq!(kind(&r), "ok", "{}", r.stdout);
    assert_eq!(r.json["text"], "Hello from the stand-in.");
    assert_eq!(r.json["usage"], json!({"input_tokens": 21, "output_tokens": 4}));
    assert_eq!(r.json["count"], json!({"minute": 1, "day": 1}));
    assert_clean(&r, &key);

    let sent = &b.server.seen()[1];
    assert_eq!((sent.method.as_str(), sent.path.as_str()), ("POST", "/v1/messages"));
    assert_eq!(sent.header("host"), Some("api.anthropic.com"));
    assert_eq!(sent.header("x-api-key"), Some(key.as_str()));
    assert_eq!(sent.header("anthropic-version"), Some("2023-06-01"));
    assert_eq!(sent.header("authorization"), None);
    assert!(!contains(&sent.body, &key) && !sent.path.contains(&key));
    let body = sent.json();
    assert_eq!(body["model"], "claude-haiku-5-5");
    assert_eq!(body["max_tokens"], 200);
    assert_eq!(body["thinking"], json!({"type": "disabled"}));
    for absent in ["temperature", "top_p", "tools", "stream"] {
        assert!(body.get(absent).is_none(), "{absent}");
    }
    assert!(!body.to_string().contains("cache_control"));
    assert_eq!(body["messages"].as_array().unwrap().last().unwrap()["role"], "user");

    let tool = b.tool_dir().unwrap();
    // The key reached the stand-in keyring over stdin only: never in its argv or environment.
    assert!(!read(&tool.join("argv.log")).contains(&key));
    assert!(!read(&tool.join("env.log")).contains(&key));
    assert!(read(&tool.join("argv.log")).contains("store --label=Coco talk-key service coco account talk-key"));
    // The store holds the key with its endpoint and model, as one record.
    assert_eq!(read(&tool.join("keyring.bin")), format!("talk-key-record 1\nhttps://api.anthropic.com\nclaude-haiku-5-5\n{key}"));
    assert!(files_containing(&b.home, &key).is_empty(), "{:?}", files_containing(&b.home, &key));
    assert!(!b.key_file().exists());

    let r = run(&["remove"], &b.env(), None);
    assert_eq!(kind(&r), "removed");
    assert_clean(&r, &key);
    assert!(files_containing(&b.dir, &key).is_empty(), "{:?}", files_containing(&b.dir, &key));
    let r = b.send("again");
    assert_eq!((kind(&r), r.json["detail"].as_str()), ("computer", Some("missing")));
}

#[test]
fn canary_through_the_file_fallback_add_send_remove() {
    let b = Bench::new("file", false);
    let key = canary();
    let r = b.add(&key);
    assert_eq!(kind(&r), "works", "{} {}", r.stdout, r.stderr);
    assert_eq!(r.json["store"], "file");
    assert_clean(&r, &key);

    let meta = std::fs::metadata(b.key_file()).unwrap();
    assert_eq!(meta.permissions().mode() & 0o777, 0o600);
    let dir_mode = std::fs::metadata(b.key_file().parent().unwrap()).unwrap().permissions().mode() & 0o777;
    assert_eq!(dir_mode, 0o700);
    assert_eq!(files_containing(&b.home, &key), vec![b.key_file()]);

    // A loosened mode is tightened again before the key is read.
    std::fs::set_permissions(b.key_file(), std::fs::Permissions::from_mode(0o644)).unwrap();
    let r = b.send("hello");
    assert_eq!(kind(&r), "ok", "{}", r.stdout);
    assert_clean(&r, &key);
    assert_eq!(std::fs::metadata(b.key_file()).unwrap().permissions().mode() & 0o777, 0o600);
    assert_eq!(files_containing(&b.home, &key), vec![b.key_file()]);

    let r = run(&["remove"], &b.env(), None);
    assert_eq!(kind(&r), "removed");
    assert!(!b.key_file().exists());
    assert!(files_containing(&b.dir, &key).is_empty());
}

#[test]
fn add_refuses_a_piped_stdin() {
    let b = Bench::new("pipe", true);
    let key = canary();
    let r = run(&["add"], &b.env(), Some(format!("{key}\n").as_bytes()));
    assert_eq!((kind(&r), r.json["detail"].as_str(), r.code), ("other", Some("stdin-not-a-terminal"), 1));
    assert_clean(&r, &key);
    assert_eq!(b.server.connections.load(Ordering::SeqCst), 0);
    assert!(files_containing(&b.dir, &key).is_empty());
    assert!(!b.tool_dir().unwrap().join("argv.log").exists());
}

#[test]
fn add_refuses_admin_keys_oauth_tokens_and_other_text() {
    let b = Bench::new("format", true);
    for (text, detail) in [
        ("sk-ant-admin01-abcdefghijklmnopqrstuvwxyz0123", "admin-key"),
        ("sk-ant-oat01-abcdefghijklmnopqrstuvwxyz0123", "oauth-token"),
        ("sk-ant-ort01-abcdefghijklmnopqrstuvwxyz0123", "oauth-token"),
        ("hello there", "not-an-api-key"),
    ] {
        let r = b.add(text);
        assert_eq!((kind(&r), r.json["detail"].as_str()), ("format", Some(detail)), "{text}");
        assert!(!contains(&r.terminal, text));
    }
    assert_eq!(b.server.connections.load(Ordering::SeqCst), 0);
    assert!(!b.tool_dir().unwrap().join("argv.log").exists());
}

#[test]
fn a_key_anthropic_refuses_is_not_kept() {
    let b = Bench::new("refused", false);
    b.server.set(status(401, &[], r#"{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}"#));
    let key = canary();
    let r = b.add(&key);
    assert_eq!((kind(&r), r.json["status"].as_u64()), ("invalid", Some(401)));
    assert!(!b.key_file().exists());
    assert!(files_containing(&b.dir, &key).is_empty());
}

#[test]
fn add_through_the_dialog_takes_the_words_from_argv() {
    let b = Bench::new("dialog", false);
    let key = canary();
    std::fs::write(b.dir.join("answer"), format!("{key}\n")).unwrap();
    let dialog = b.dir.join("dialog");
    write_exec(&dialog, "#!/bin/sh\nd=$(dirname \"$0\")\nprintf '%s\\n' \"$@\" > \"$d/dialog-argv.log\"\ncat \"$d/answer\"\n");
    let env = || {
        b.tick();
        b.with(&[("TALK_KEY_TEST_DIALOG", dialog.display().to_string())])
    };
    let args = ["add", "--dialog", "--title", "T-title", "--text", "T-text", "--save", "T-save", "--cancel", "T-cancel"];
    let r = run(&args, &env(), None);
    assert_eq!(kind(&r), "works", "{}", r.stdout);
    assert_clean(&r, &key);
    let argv = read(&b.dir.join("dialog-argv.log"));
    assert_eq!(argv, "--entry\n--hide-text\n--title=T-title\n--text=T-text\n--ok-label=T-save\n--cancel-label=T-cancel\n");

    // a caller pointing the key elsewhere cannot leave the destination out of the dialog
    let elsewhere = ["add", "--dialog", "--title", "T-title", "--text", "T-text", "--save", "T-save", "--cancel", "T-cancel", "--base", "http://127.0.0.1:9"];
    let _ = run(&elsewhere, &env(), None);
    assert!(read(&b.dir.join("dialog-argv.log")).contains("--text=T-text\n\nhttp://127.0.0.1:9\n"));

    write_exec(&dialog, "#!/bin/sh\nexit 1\n");
    let r = run(&args, &env(), None);
    assert_eq!(kind(&r), "cancelled");
    let r = run(&["add", "--dialog", "--title", "only"], &env(), None);
    assert_eq!((kind(&r), r.json["detail"].as_str()), ("other", Some("usage")));
}

#[test]
fn send_refuses_sizes_and_fields_before_anything_else() {
    let b = Bench::new("refuse", true);
    let key = canary();
    assert_eq!(kind(&b.add(&key)), "works");
    let before = b.server.seen().len();
    let log_before = read(&b.tool_dir().unwrap().join("argv.log"));
    let m = json!([{"role": "user", "content": "hi"}]);
    let big = "字".repeat(33_000);
    let cases = [
        (json!({"messages": m, "max_tokens": 64_001}), "other", "input:max_tokens"),
        (json!({"messages": m, "max_tokens": 200, "endpoint": "https://evil.example"}), "other", "input:field:endpoint"),
        (json!({"messages": m, "max_tokens": 200, "temperature": 0.5}), "other", "input:field:temperature"),
        (json!({"messages": m, "max_tokens": 200, "base_url": "https://evil.example"}), "other", "input:field:base_url"),
        (json!({"messages": [{"role": "user", "content": big}], "max_tokens": 200}), "cap", ""),
    ];
    for (input, want, detail) in cases {
        let r = run(&["send"], &b.env(), Some(input.to_string().as_bytes()));
        assert_eq!(kind(&r), want, "{}", r.stdout);
        if !detail.is_empty() {
            assert_eq!(r.json["detail"], detail);
        }
        assert_eq!((r.json["text"].is_null(), r.json["usage"].is_null()), (true, true));
    }
    let huge = vec![b'a'; 3 * 1024 * 1024];
    let r = run(&["send"], &b.env(), Some(&huge));
    assert_eq!(kind(&r), "cap");
    // Nothing reached the server, nothing was counted, and the store was never asked.
    assert_eq!(b.server.seen().len(), before);
    let counts = read(&b.home.join(".config/coco/talk-key-sends"));
    assert!(!counts.lines().any(|l| l.starts_with("t ")), "{counts}");
    assert_eq!(read(&b.tool_dir().unwrap().join("argv.log")), log_before);
}

#[test]
fn statuses_and_refusals_come_back_as_kinds() {
    let b = Bench::new("kinds", false);
    let key = canary();
    assert_eq!(kind(&b.add(&key)), "works");
    let refusal = r#"{"content":[],"stop_reason":"refusal","usage":{"input_tokens":5,"output_tokens":0}}"#;
    let credit = r#"{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}"#;
    let cases: Vec<(Handler, &str, Option<u64>)> = vec![
        (status(401, &[], "{}"), "invalid", Some(401)),
        (status(402, &[], "{}"), "credit", Some(402)),
        (status(400, &[], credit), "credit", Some(400)),
        (status(403, &[], "{}"), "model", Some(403)),
        (status(404, &[], "{}"), "model", Some(404)),
        (status(429, &[("retry-after", "17")], "{}"), "rate", Some(429)),
        (status(500, &[], "{}"), "busy", Some(500)),
        (status(529, &[], "{}"), "busy", Some(529)),
        (status(413, &[], "{}"), "other", Some(413)),
        (status(200, &[], refusal), "refusal", None),
    ];
    for (i, (h, want, code)) in cases.into_iter().enumerate() {
        b.server.set(h);
        let env = b.with(&[("TALK_KEY_TEST_NOW", (MORNING + 61 * i as i64).to_string())]);
        let r = run(&["send"], &env, Some(&send_input("hi")));
        assert_eq!(kind(&r), want, "{}", r.stdout);
        assert_eq!(r.json["status"].as_u64(), code);
        if want == "rate" {
            assert_eq!(r.json["retry_after"], 17);
        }
        assert_clean(&r, &key);
    }
}

#[test]
fn a_compact_sends_up_to_a_thousand_tokens_counts_like_any_send_and_never_names_its_kind() {
    let b = Bench::new("compact", false);
    let key = canary();
    assert_eq!(kind(&b.add(&key)), "works");
    let input = json!({"system": "Write short notes.", "messages": [{"role": "user", "content": "person: hi\nhim: hello"}], "max_tokens": 1000, "kind": "compact"});
    let r = run(&["send"], &b.env(), Some(input.to_string().as_bytes()));
    assert_eq!(kind(&r), "ok", "{}", r.stdout);
    assert_eq!(r.json["count"], json!({"minute": 1, "day": 1}));
    assert_clean(&r, &key);
    let body = b.server.seen().last().unwrap().json();
    assert_eq!(body["max_tokens"], 1000);
    assert!(body.get("kind").is_none());
    // a talk send has no cap of its own now (owner 10-17); past Claude Code's 64,000 nothing is sent or counted
    let over = json!({"messages": [{"role": "user", "content": "hi"}], "max_tokens": 64_001, "kind": "talk"});
    let before = b.server.seen().len();
    assert_eq!(run(&["send"], &b.env(), Some(over.to_string().as_bytes())).json["detail"], "input:max_tokens");
    assert_eq!(b.server.seen().len(), before);
}

/// Owner 10-17 「单条放开」: a talk send naming no cap asks the stored model's models entry for its own limit
/// first and takes it; without one there, Claude Code's own 1,024.
#[test]
fn a_talk_send_naming_no_cap_takes_the_models_own_limit() {
    let b = Bench::new("open-cap", false);
    let key = canary();
    assert_eq!(kind(&b.add(&key)), "works");
    let input = json!({"system": "You are Coco.", "messages": [{"role": "user", "content": "hi"}], "kind": "talk"});
    let before = b.server.seen().len();
    let r = run(&["send"], &b.env(), Some(input.to_string().as_bytes()));
    assert_eq!(kind(&r), "ok", "{}", r.stdout);
    assert_clean(&r, &key);
    let seen = b.server.seen()[before..].to_vec();
    assert_eq!(seen.iter().map(|s| (s.method.as_str(), s.path.as_str())).collect::<Vec<_>>(), vec![("GET", "/v1/models/claude-haiku-5-5"), ("POST", "/v1/messages")]);
    assert_eq!(seen[1].json()["max_tokens"], 1_024);
    // the entry names the model's limit: that is the cap
    let text = reply("hello");
    *b.server.handler.lock().unwrap() = Arc::new(move |s: &Seen| if s.method == "GET" { (200, vec![], r#"{"id":"claude-haiku-5-5","type":"model","max_tokens":32000}"#.into()) } else { text(s) });
    let r = run(&["send"], &b.env(), Some(input.to_string().as_bytes()));
    assert_eq!(kind(&r), "ok", "{}", r.stdout);
    assert_eq!(b.server.seen().last().unwrap().json()["max_tokens"], 32_000);
    assert_eq!(r.json["count"], json!({"minute": 2, "day": 2}));
}

#[test]
fn six_a_minute() {
    let b = Bench::new("minute", false);
    assert_eq!(kind(&b.add(&canary())), "works");
    for i in 1..=6 {
        b.now.set(MORNING + i);
        let r = b.send("hi");
        assert_eq!((kind(&r), r.json["count"]["minute"].as_u64()), ("ok", Some(i as u64)));
    }
    b.now.set(MORNING + 10);
    let r = b.send("hi");
    assert_eq!((kind(&r), r.json["detail"].as_str()), ("rate", Some("local-minute-limit")));
    assert_eq!(r.json["retry_after"], 51);
    b.now.set(MORNING + 61);
    let r = b.send("hi");
    assert_eq!((kind(&r), r.json["count"]["minute"].as_u64()), ("ok", Some(6)));
    assert_eq!(b.server.seen().iter().filter(|s| s.method == "POST").count(), 7);
}

#[test]
fn another_program_sends_400_times() {
    let b = Bench::new("day", false);
    assert_eq!(kind(&b.add(&canary())), "works");
    // Spaced 12 s apart, every send is inside the minute limit; the day limit stops it at 300.
    let mut kinds = std::collections::BTreeMap::new();
    let mut last_ok = 0;
    for i in 0..400 {
        b.now.set(MORNING + 12 * i);
        let r = b.send("hi");
        *kinds.entry(kind(&r).to_string()).or_insert(0) += 1;
        if kind(&r) == "ok" {
            last_ok = r.json["count"]["day"].as_u64().unwrap();
        }
    }
    assert_eq!(kinds.get("ok"), Some(&300));
    assert_eq!(kinds.get("daily"), Some(&100));
    assert_eq!(last_ok, 300);
    assert_eq!(b.server.seen().iter().filter(|s| s.method == "POST").count(), 300);
    // A burst at one instant gets 6 through, then the minute limit.
    b.now.set(MORNING + 86_400);
    let mut burst = Vec::new();
    for _ in 0..10 {
        burst.push(kind(&b.send("hi")).to_string());
    }
    assert_eq!(burst, [vec!["ok"; 6], vec!["rate"; 4]].concat());
}

#[test]
fn only_the_proxy_pair_is_read() {
    let b = Bench::new("proxyvars", false);
    let key = canary();
    assert_eq!(kind(&b.add(&key)), "works");
    let trap = serve(b.ca.server.clone(), reply("trap"), true);
    let env = b.with(&[
        ("ALL_PROXY", trap.proxy_url()),
        ("HTTP_PROXY", trap.proxy_url()),
        ("http_proxy", trap.proxy_url()),
        ("all_proxy", trap.proxy_url()),
        ("SSL_CERT_FILE", "/nonexistent".into()),
        ("ANTHROPIC_API_KEY", "sk-ant-api03-ENVIRONMENTKEYxxxxxxxxxxxxxxxxxxxx".into()),
    ]);
    let r = run(&["send"], &env, Some(&send_input("hi")));
    assert_eq!(kind(&r), "ok", "{}", r.stdout);
    assert_eq!(trap.connections.load(Ordering::SeqCst), 0);
    assert_eq!(b.server.seen().last().unwrap().header("x-api-key"), Some(key.as_str()));
}

#[test]
fn https_proxy_is_used_and_no_proxy_bypasses_it() {
    let b = Bench::new("proxy", false);
    let key = canary();
    assert_eq!(kind(&b.add(&key)), "works");
    let proxy = serve(b.ca.server.clone(), reply("through the proxy"), true);
    b.now.set(b.now.get() + 61);
    let r = run(&["send"], &b.with(&[("HTTPS_PROXY", proxy.proxy_url())]), Some(&send_input("hi")));
    assert_eq!((kind(&r), r.json["text"].as_str()), ("ok", Some("through the proxy")));
    assert_eq!(proxy.connects.lock().unwrap().clone(), vec!["api.anthropic.com:443".to_string()]);
    // The proxy only saw ciphertext: the key is not on its wire.
    assert!(!contains(&proxy.wire.lock().unwrap(), &key));

    b.now.set(b.now.get() + 61);
    let env = b.with(&[("HTTPS_PROXY", proxy.proxy_url()), ("NO_PROXY", "localhost,.anthropic.com".into())]);
    let r = run(&["send"], &env, Some(&send_input("hi")));
    assert_eq!((kind(&r), r.json["text"].as_str()), ("ok", Some("Hello from the stand-in.")));
    assert_eq!(proxy.connections.load(Ordering::SeqCst), 1);

    let r = run(&["send"], &b.with(&[("HTTPS_PROXY", "socks5://127.0.0.1:1".into())]), Some(&send_input("hi")));
    assert_eq!((kind(&r), r.json["detail"].as_str()), ("offline", Some("proxy-scheme")));
}

#[test]
fn computer_side_and_network_failures() {
    let b = Bench::new("computer", false);
    let r = b.send("hi");
    assert_eq!((kind(&r), r.json["detail"].as_str()), ("computer", Some("missing")));
    let r = b.status();
    assert_eq!((kind(&r), r.json["detail"].as_str()), ("computer", Some("missing")));

    let key = canary();
    assert_eq!(kind(&b.add(&key)), "works");
    let r = b.status();
    assert_eq!((kind(&r), r.json["last4"].as_str()), ("works", Some("x7Qa")));

    let closed = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap();
    let env = b.with(&[("TALK_KEY_TEST_ENDPOINT", closed.to_string()), ("TALK_KEY_TEST_NOW", (MORNING + 61).to_string())]);
    let r = run(&["send"], &env, Some(&send_input("hi")));
    assert_eq!((kind(&r), r.json["detail"].as_str()), ("offline", Some("refused")));

    // A store value that is not a key any more is a computer-side failure, not a send.
    std::fs::write(b.key_file(), "not a key").unwrap();
    let env = b.with(&[("TALK_KEY_TEST_NOW", (MORNING + 122).to_string())]);
    let r = run(&["send"], &env, Some(&send_input("hi")));
    assert_eq!((kind(&r), r.json["detail"].as_str()), ("computer", Some("stored-value-not-a-key")));

    let r = run(&["frobnicate"], &b.env(), None);
    assert_eq!((kind(&r), r.code), ("other", 1));
}

// Fixes from the security review (tk-review/review.md); each mirrors the reviewer's proof.

const KEY_A: &str = "sk-ant-api03-CANARYoldkeyabcdefghijklmnopAAAA";
const KEY_B: &str = "sk-ant-api03-CANARYnewkeyabcdefghijklmnopBBBB";
const KEY_C: &str = "sk-ant-api03-CANARYthirdkeyabcdefghijklmnCCCC";

/// S1, p3: with the session bus out of reach, `remove` never says a plain "removed".
#[test]
fn remove_with_the_keyring_unreachable_says_so() {
    let b = Bench::new("s1-remove", true);
    let tool = b.tool_dir().unwrap();
    std::fs::write(tool.join("keyring.bin"), KEY_A).unwrap();
    std::fs::write(tool.join("nobus"), "").unwrap();
    let r = run(&["remove"], &b.env(), None);
    assert_eq!((kind(&r), r.json["detail"].as_str()), ("computer", Some("keyring-unreachable")));
    // The tombstone keeps key A from being used once the bus is back, until a remove clears it.
    std::fs::remove_file(tool.join("nobus")).unwrap();
    let r = b.send("hi");
    assert_eq!((kind(&r), r.json["detail"].as_str()), ("computer", Some("missing")));
    assert_eq!(b.server.connections.load(Ordering::SeqCst), 0);
    let r = run(&["remove"], &b.env(), None);
    assert_eq!(kind(&r), "removed");
    assert!(!tool.join("keyring.bin").exists() && !b.key_file().exists());
    // Without the bus and with no file, a send cannot claim "missing" either.
    std::fs::write(tool.join("nobus"), "").unwrap();
    b.now.set(b.now.get() + 61);
    let r = b.send("hi");
    assert_eq!((kind(&r), r.json["detail"].as_str()), ("computer", Some("keyring-unreachable")));
}

/// S1, p3b: a Replace that lands in the file is the key used once the bus is back, and the next
/// Replace with the bus up moves it back to the keyring.
#[test]
fn a_replace_in_the_file_is_not_shadowed_by_the_keyring() {
    let b = Bench::new("s1-replace", true);
    let tool = b.tool_dir().unwrap();
    std::fs::write(tool.join("keyring.bin"), KEY_A).unwrap();
    std::fs::write(tool.join("nobus"), "").unwrap();
    let r = b.add(KEY_B);
    assert_eq!((kind(&r), r.json["store"].as_str(), r.json["last4"].as_str()), ("works", Some("file"), Some("BBBB")));
    std::fs::remove_file(tool.join("nobus")).unwrap();
    let r = b.send("hi");
    assert_eq!(kind(&r), "ok", "{}", r.stdout);
    assert_eq!(b.server.seen().last().unwrap().header("x-api-key"), Some(KEY_B));

    let r = b.add(KEY_C);
    assert_eq!((kind(&r), r.json["store"].as_str()), ("works", Some("secret-service")));
    assert!(!b.key_file().exists());
    b.now.set(b.now.get() + 61);
    assert_eq!(kind(&b.send("hi")), "ok");
    assert_eq!(b.server.seen().last().unwrap().header("x-api-key"), Some(KEY_C));
}

/// S3, p2: six sends while the clock was a year ahead do not lock sends out afterwards.
#[test]
fn a_clock_that_was_ahead_does_not_lock_talk_out() {
    let b = Bench::new("s3", false);
    for i in 1..=6 {
        b.now.set(MORNING + 365 * 86_400 + i);
        b.send("hi");
    }
    for later in [0, 86_400, 30 * 86_400] {
        b.now.set(MORNING + later);
        let r = b.send("hi");
        assert_eq!((kind(&r), r.json["detail"].as_str()), ("computer", Some("missing")), "{later}: {}", r.stdout);
    }
}

/// S4, p1: a TZ that flips the local date back and forth does not reset the day.
#[test]
fn a_flipping_tz_does_not_reset_the_day() {
    let b = Bench::new("s4", false);
    // 12:00 UTC: the 10th in Etc/GMT+12, the 11th in Etc/GMT-14. Without a key each send is
    // counted and then stops at "missing", so no request is made.
    let noon = 1_791_633_600;
    let (mut counted, mut daily) = (0, 0);
    for i in 0..400 {
        let tz = if i % 2 == 0 { "Etc/GMT-14" } else { "Etc/GMT+12" };
        let env = b.with(&[("TZ", tz.into()), ("TALK_KEY_TEST_NOW", (noon + 11 * i).to_string())]);
        let r = run(&["send"], &env, Some(&send_input("hi")));
        match kind(&r) {
            "computer" => counted += 1,
            "daily" => daily += 1,
            other => panic!("{other}: {}", r.stdout),
        }
    }
    assert_eq!((counted, daily), (300, 100));
}

/// Nits 2 and 3, p9: the counter is never opened through a symlink, and our folder is 0700.
#[test]
fn the_counter_is_not_followed_and_the_folder_is_tightened() {
    let b = Bench::new("nit23", false);
    let dir = b.home.join(".config/coco");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).unwrap();
    let other = b.home.join("other-file");
    std::fs::write(&other, "precious line 1\nprecious line 2\n").unwrap();
    std::os::unix::fs::symlink(&other, dir.join("talk-key-sends")).unwrap();
    let r = b.send("hi");
    assert_eq!((kind(&r), r.json["detail"].as_str()), ("computer", Some("count-open")));
    assert_eq!(read(&other), "precious line 1\nprecious line 2\n");
    assert_eq!(std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777, 0o700);

    if unsafe { libc::geteuid() } == 0 {
        let c = std::ffi::CString::new(dir.to_str().unwrap()).unwrap();
        assert_eq!(unsafe { libc::chown(c.as_ptr(), 65534, 65534) }, 0);
        let r = b.send("hi");
        assert_eq!((kind(&r), r.json["detail"].as_str()), ("computer", Some("dir-not-ours")));
    }
}

/// S5, p7 and p7b: a proxy or TLS peer that sends one byte a second is cut at the deadline.
#[test]
fn slow_peers_meet_the_deadline() {
    let b = Bench::new("s5", false);
    assert_eq!(kind(&b.add(&canary())), "works");
    let proxy = slow_proxy();
    let dribble = dribbler();
    let cases = [
        ("HTTPS_PROXY", format!("http://{proxy}")),
        ("TALK_KEY_TEST_ENDPOINT", dribble.to_string()),
    ];
    for (i, (name, value)) in cases.into_iter().enumerate() {
        b.now.set(MORNING + 100 + 61 * i as i64);
        let env = b.with(&[(name, value), ("TALK_KEY_TEST_DEADLINE_MS", "3000".into())]);
        let start = std::time::Instant::now();
        let r = run(&["send"], &env, Some(&send_input("hi")));
        let took = start.elapsed();
        assert_eq!((kind(&r), r.json["detail"].as_str()), ("offline", Some("timeout")), "{name}: {}", r.stdout);
        assert!(took < std::time::Duration::from_millis(4500), "{name}: {took:?}");
    }
}

/// S5: wherever the command is stuck, the watchdog answers before the plugin's kill.
#[test]
fn a_stuck_keyring_gets_an_answer_at_the_deadline() {
    let b = Bench::new("s5-stuck", true);
    write_exec(b.tool.as_ref().unwrap(), "#!/bin/sh\nsleep 5\n");
    let env = b.with(&[("TALK_KEY_TEST_DEADLINE_MS", "1500".into())]);
    let start = std::time::Instant::now();
    let r = run(&["send"], &env, Some(&send_input("hi")));
    assert_eq!((kind(&r), r.json["detail"].as_str(), r.code), ("computer", Some("deadline"), 1), "{}", r.stdout);
    assert!(start.elapsed() < std::time::Duration::from_millis(3000), "{:?}", start.elapsed());
    assert_eq!(r.stdout.lines().count(), 1);
}

/// S6, p4: a chunk size of ffffffffffffffff is refused, not an overflow or a slice panic.
#[test]
fn a_huge_chunk_size_is_refused() {
    let b = Bench::new("s6", false);
    assert_eq!(kind(&b.add(&canary())), "works");
    b.server.set(status(0, &[], "HTTP/1.1 200 OK\r\ntransfer-encoding: chunked\r\n\r\nffffffffffffffff\r\nab"));
    let r = b.send("hi");
    assert_eq!((kind(&r), r.json["detail"].as_str(), r.code), ("other", Some("reply-too-large"), 1), "{} {}", r.stdout, r.stderr);
}

/// Nit 5: one key check a second and 30 an hour, for `status` and `add` alike.
#[test]
fn key_checks_are_braked() {
    let b = Bench::new("nit5", false);
    let r = run(&["status"], &b.env(), None);
    assert_eq!(r.json["detail"], "missing");
    let r = run(&["status"], &b.env(), None);
    assert_eq!((kind(&r), r.json["detail"].as_str(), r.json["retry_after"].as_u64()), ("rate", Some("local-check-second"), Some(1)));
    for _ in 1..30 {
        assert_eq!(b.status().json["detail"], "missing");
    }
    let r = b.status();
    assert_eq!((kind(&r), r.json["detail"].as_str()), ("rate", Some("local-check-hour")));
    assert_eq!(r.json["retry_after"], 3600 - 60);
    let r = b.add(&canary());
    assert_eq!((kind(&r), r.json["detail"].as_str()), ("rate", Some("local-check-hour")));
    assert_eq!(b.server.connections.load(Ordering::SeqCst), 0);
}

/// Nit 6: the lowercase spellings work too, and the uppercase one wins when both are set.
#[test]
fn lowercase_proxy_variables_with_uppercase_winning() {
    let b = Bench::new("nit6", false);
    assert_eq!(kind(&b.add(&canary())), "works");
    let upper = serve(b.ca.server.clone(), reply("upper"), true);
    let lower = serve(b.ca.server.clone(), reply("lower"), true);
    let sends: [(&[(&'static str, String)], &str); 3] = [
        (&[("https_proxy", lower.proxy_url())], "lower"),
        (&[("https_proxy", lower.proxy_url()), ("HTTPS_PROXY", upper.proxy_url())], "upper"),
        (&[("HTTPS_PROXY", upper.proxy_url()), ("no_proxy", ".anthropic.com".into())], "Hello from the stand-in."),
    ];
    for (i, (extra, want)) in sends.into_iter().enumerate() {
        b.now.set(MORNING + 100 + 61 * i as i64);
        let r = run(&["send"], &b.with(extra), Some(&send_input("hi")));
        assert_eq!(r.json["text"], want, "{}", r.stdout);
    }
    assert_eq!((upper.connections.load(Ordering::SeqCst), lower.connections.load(Ordering::SeqCst)), (1, 1));
}

// TALK-KEY «Changed 10-10, the owner»: any model on any provider that speaks the Anthropic Messages API,
// with the endpoint bound to the key.

const GW_KEY: &str = "gw-CANARY-key-0123456789";

fn gateway_reply(models: u16) -> Handler {
    let body = serde_json::json!({
        "content": [{"type": "text", "text": "from the gateway"}], "stop_reason": "end_turn",
        "usage": {"input_tokens": 9, "output_tokens": 3}
    })
    .to_string();
    std::sync::Arc::new(move |s: &Seen| {
        if s.method == "GET" { (models, vec![], "{}".into()) } else { (200, vec![], body.clone()) }
    })
}

fn add_at(b: &Bench, base: &str, model: &str, key: &str) -> Run {
    b.tick();
    run_tty(&["add", "--base", base, "--model", model], &b.env(), key)
}

#[test]
fn a_gateway_gets_the_minimal_body_and_the_stored_model() {
    let b = Bench::new("gateway", true);
    let gw = serve_plain(gateway_reply(404));
    let base = format!("http://127.0.0.1:{}/anthropic", gw.addr.port());
    let r = add_at(&b, &base, "gateway-model-1", GW_KEY);
    // The save check is GET {base}/v1/models; a 404 keeps the key «saved, not checked yet».
    assert_eq!((kind(&r), r.json["last4"].as_str()), ("saved", Some("6789")), "{} {}", r.stdout, r.stderr);
    assert_eq!((r.json["host"].as_str(), r.json["model"].as_str()), (Some(format!("127.0.0.1:{}", gw.addr.port()).as_str()), Some("gateway-model-1")));
    assert_clean(&r, GW_KEY);
    let check = &gw.seen()[0];
    assert_eq!((check.method.as_str(), check.path.as_str()), ("GET", "/anthropic/v1/models"));
    assert_eq!(check.header("x-api-key"), Some(GW_KEY));
    let tool = b.tool_dir().unwrap();
    assert_eq!(read(&tool.join("keyring.bin")), format!("talk-key-record 1\n{base}\ngateway-model-1\n{GW_KEY}"));

    let r = b.send("hello");
    assert_eq!((kind(&r), r.json["text"].as_str(), r.json["model"].as_str()), ("ok", Some("from the gateway"), Some("gateway-model-1")), "{}", r.stdout);
    assert_clean(&r, GW_KEY);
    let sent = gw.seen()[1].clone();
    assert_eq!((sent.method.as_str(), sent.path.as_str()), ("POST", "/anthropic/v1/messages"));
    assert_eq!(sent.header("host"), Some(format!("127.0.0.1:{}", gw.addr.port()).as_str()));
    assert_eq!(sent.header("anthropic-version"), Some("2023-06-01"));
    assert_eq!(sent.json(), json!({"model": "gateway-model-1", "max_tokens": 200, "system": "You are Coco.", "messages": [{"role": "user", "content": "hello"}]}));
    // The Anthropic stand-in never saw any of it.
    assert_eq!(b.server.connections.load(Ordering::SeqCst), 0);
}

#[test]
fn send_cannot_name_another_model_or_host() {
    let b = Bench::new("binding", true);
    let gw = serve_plain(gateway_reply(200));
    let base = format!("http://127.0.0.1:{}", gw.addr.port());
    assert_eq!(kind(&add_at(&b, &base, "gateway-model-1", GW_KEY)), "works");
    let m = json!([{"role": "user", "content": "hi"}]);
    for (i, (input, detail)) in [
        (json!({"messages": m, "max_tokens": 50, "model": "claude-opus-5-5"}), "input:model"),
        (json!({"messages": m, "max_tokens": 50, "host": "api.anthropic.com"}), "input:host"),
        (json!({"messages": m, "max_tokens": 50, "base_url": "https://evil.example"}), "input:field:base_url"),
    ]
    .into_iter()
    .enumerate()
    {
        b.now.set(MORNING + 100 + 61 * i as i64);
        let r = run(&["send"], &b.env(), Some(input.to_string().as_bytes()));
        assert_eq!((kind(&r), r.json["detail"].as_str()), ("other", Some(detail)));
    }
    assert_eq!(gw.seen().iter().filter(|s| s.method == "POST").count(), 0);
    assert_eq!(b.server.connections.load(Ordering::SeqCst), 0);
    // Naming the stored model and host is allowed and changes nothing.
    b.now.set(MORNING + 1000);
    let named = json!({"messages": m, "max_tokens": 50, "model": "gateway-model-1", "host": "127.0.0.1"});
    let r = run(&["send"], &b.env(), Some(named.to_string().as_bytes()));
    assert_eq!(kind(&r), "ok", "{}", r.stdout);
}

#[test]
fn the_url_rules_and_the_key_rules_per_host() {
    let b = Bench::new("rules", true);
    for (base, detail) in [
        ("http://gateway.example.com", "url-http-not-loopback"),
        ("https://user:pass@gateway.example.com", "url-userinfo"),
        ("https://gateway.example.com/v?x=1", "url-query"),
        ("https://gateway.example.com/#f", "url-query"),
        ("ftp://gateway.example.com", "url-scheme"),
    ] {
        let r = run(&["add", "--base", base], &b.env(), None);
        assert_eq!((kind(&r), r.json["detail"].as_str()), ("address", Some(detail)), "{base}");
    }
    let r = run(&["add", "--model", "bad model"], &b.env(), None);
    assert_eq!((kind(&r), r.json["detail"].as_str()), ("address", Some("model")));
    // Anthropic's host still wants an sk-ant- key; another host takes printable ASCII of 8 to 512.
    let r = b.add(GW_KEY);
    assert_eq!((kind(&r), r.json["detail"].as_str()), ("format", Some("not-an-api-key")));
    let gw = serve_plain(gateway_reply(405));
    let base = format!("http://127.0.0.1:{}", gw.addr.port());
    assert_eq!(kind(&add_at(&b, &base, "m", "short")), "format");
    assert_eq!(kind(&add_at(&b, &base, "m", "has a space in it")), "format");
    assert_eq!(kind(&add_at(&b, &base, "m", &"k".repeat(513))), "format");
    let r = add_at(&b, &base, "m", &"k".repeat(512));
    assert_eq!(kind(&r), "saved", "{}", r.stdout);
    assert!(b.server.connections.load(Ordering::SeqCst) == 0);
}

#[test]
fn a_refused_key_at_a_gateway_is_not_kept_and_redirects_are_never_followed() {
    let b = Bench::new("gw-refused", true);
    let gw = serve_plain(status(401, &[], "{}"));
    let base = format!("http://127.0.0.1:{}", gw.addr.port());
    let r = add_at(&b, &base, "m", GW_KEY);
    assert_eq!((kind(&r), r.json["status"].as_u64()), ("invalid", Some(401)));
    assert!(!b.tool_dir().unwrap().join("keyring.bin").exists());
    gw.set(status(307, &[("location", "http://127.0.0.1:1/elsewhere")], "{}"));
    let r = add_at(&b, &base, "m", GW_KEY);
    assert_eq!((kind(&r), r.json["status"].as_u64()), ("other", Some(307)));
    assert_eq!(gw.seen().len(), 2);
}

#[test]
fn an_https_gateway_is_verified_by_its_own_name_and_http_is_never_proxied() {
    let b = Bench::new("gw-tls", true);
    let ca = ca_for("gateway.test");
    let ca_file = b.dir.join("gw-ca.pem");
    std::fs::write(&ca_file, &ca.pem).unwrap();
    let gw = serve(ca.server.clone(), gateway_reply(200), false);
    let env = b.with(&[("TALK_KEY_TEST_ENDPOINT", gw.endpoint()), ("TALK_KEY_TEST_CA", ca_file.display().to_string())]);
    b.tick();
    let r = run_tty(&["add", "--base", "https://gateway.test:8443/v", "--model", "gw-1"], &env, GW_KEY);
    assert_eq!((kind(&r), r.json["host"].as_str()), ("works", Some("gateway.test:8443")), "{} {}", r.stdout, r.stderr);
    assert_eq!(gw.seen()[0].header("host"), Some("gateway.test:8443"));
    assert_eq!(gw.seen()[0].path, "/v/v1/models");
    // The Anthropic CA does not vouch for gateway.test.
    let wrong = b.with(&[("TALK_KEY_TEST_ENDPOINT", gw.endpoint())]);
    b.tick();
    let r = run_tty(&["add", "--base", "https://gateway.test:8443/v", "--model", "gw-1"], &wrong, GW_KEY);
    assert_eq!(kind(&r), "offline");
    // http on loopback never goes through HTTPS_PROXY.
    let plain = serve_plain(gateway_reply(200));
    let trap = serve(b.ca.server.clone(), reply("trap"), true);
    let env = b.with(&[("HTTPS_PROXY", trap.proxy_url())]);
    b.tick();
    let r = run_tty(&["add", "--base", &format!("http://127.0.0.1:{}", plain.addr.port()), "--model", "m"], &env, GW_KEY);
    assert_eq!(kind(&r), "works", "{}", r.stdout);
    assert_eq!(trap.connections.load(Ordering::SeqCst), 0);
}
