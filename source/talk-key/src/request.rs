//! The one request shape `send` will make. Everything a caller could vary is checked here,
//! before the key is read or a send is counted.

use serde_json::{Map, Value, json};
use unicode_normalization::UnicodeNormalization;

use crate::endpoint::Record;
use crate::out::{Fail, Kind};

/// A talk reply has no cap of its own (owner 10-17: 「单条放开」). Left out, it may take what the stored model allows,
/// as api.anthropic.com's models entry for it says, up to the 64,000 Claude Code allows one whole (not streamed)
/// reply; where that cannot be read, Claude Code's own 1,024 for a request that names none. A caller may still name
/// a cap up to the 64,000.
pub const WHOLE_REPLY_TOKENS: u64 = 64_000;
pub const DEFAULT_TOKENS: u64 = 1_024;
/// Talk's notes on a long chat (`"kind": "compact"`, talk-alive §4): one summary, up to 1,000 tokens.
pub const COMPACT_MAX_TOKENS: u64 = 1_000;
pub const CAP: usize = 100_000;
/// Identity block and framing, added once per call (TALK-KEY §2).
pub const FRAMING: usize = 2_000;
pub const MAX_MESSAGES: usize = 64;
/// Far above the cap; anything longer is over it whatever it holds.
pub const STDIN_LIMIT: usize = 2 * 1024 * 1024;

/// Bytes are at least tokens for a byte-level tokenizer; the NFKC form covers one that
/// normalises first (U+FDFA grows from 3 bytes to 33).
pub fn estimate(text: &str) -> usize {
    let nfkc: usize = text.nfkc().map(char::len_utf8).sum();
    text.len().max(nfkc)
}

fn bad(what: &str) -> Fail {
    Fail::new(Kind::Other, format!("input:{what}"))
}

/// The caller's request, checked for everything that needs no stored record.
pub struct Draft {
    system: Option<String>,
    messages: Vec<Value>,
    max_tokens: Option<u64>,
    model: Option<String>,
    host: Option<String>,
}

/// Checks the caller's JSON before anything is counted or read.
///
/// Input: `{ "system"?: string, "messages": [{ "role", "content": string }], "max_tokens"?: n,
/// "model"?: string, "host"?: string, "kind"?: "talk" | "compact" }`. Any other field is refused, which keeps
/// out temperature, thinking, tools, cache_control, a base URL and content blocks. `model` and `host` are never
/// used: when given, they must name the stored ones (`body`), so a caller learns nothing it could change. `kind`
/// only sets the token ceiling (a compact names its cap, up to 1,000; a talk send may leave it out, see
/// WHOLE_REPLY_TOKENS) and is never sent.
pub fn draft(input: &[u8]) -> Result<Draft, Fail> {
    if input.len() > STDIN_LIMIT {
        return Err(Fail::new(Kind::Cap, "stdin-over-limit"));
    }
    let v: Value = serde_json::from_slice(input).map_err(|_| bad("json"))?;
    let obj = v.as_object().ok_or_else(|| bad("json"))?;
    for k in obj.keys() {
        if !matches!(k.as_str(), "system" | "messages" | "max_tokens" | "model" | "host" | "kind") {
            return Err(bad(&format!("field:{}", short(k))));
        }
    }
    let named = |k: &str| -> Result<Option<String>, Fail> {
        match obj.get(k) {
            None => Ok(None),
            Some(Value::String(s)) => Ok(Some(s.clone())),
            Some(_) => Err(bad(k)),
        }
    };
    let (model, host) = (named("model")?, named("host")?);
    let (ceiling, named_cap) = match obj.get("kind") {
        None => (WHOLE_REPLY_TOKENS, false),
        Some(Value::String(k)) if k == "talk" => (WHOLE_REPLY_TOKENS, false),
        Some(Value::String(k)) if k == "compact" => (COMPACT_MAX_TOKENS, true),
        Some(_) => return Err(bad("kind")),
    };
    let max_tokens = match obj.get("max_tokens") {
        None if !named_cap => None,
        given => Some(given.and_then(Value::as_u64).ok_or_else(|| bad("max_tokens"))?),
    };
    if max_tokens.is_some_and(|n| n == 0 || n > ceiling) {
        return Err(bad("max_tokens"));
    }

    let mut total = FRAMING;
    let system = match obj.get("system") {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) => {
            total += estimate(s);
            if s.is_empty() { None } else { Some(s.clone()) }
        }
        Some(_) => return Err(bad("system")),
    };

    let list = obj.get("messages").and_then(Value::as_array).ok_or_else(|| bad("messages"))?;
    if list.is_empty() || list.len() > MAX_MESSAGES {
        return Err(bad("messages"));
    }
    let mut messages = Vec::with_capacity(list.len());
    for (i, m) in list.iter().enumerate() {
        let m = m.as_object().ok_or_else(|| bad("message"))?;
        if m.keys().any(|k| k != "role" && k != "content") {
            return Err(bad("message-field"));
        }
        let want = if i % 2 == 0 { "user" } else { "assistant" };
        if m.get("role").and_then(Value::as_str) != Some(want) {
            return Err(bad("role-order"));
        }
        let content = m.get("content").and_then(Value::as_str).ok_or_else(|| bad("content"))?;
        if content.trim().is_empty() {
            return Err(bad("content"));
        }
        total += estimate(content);
        messages.push(json!({ "role": want, "content": content }));
    }
    // Ending on the person's turn means no assistant prefill.
    if list.len() % 2 == 0 {
        return Err(bad("prefill"));
    }
    if total > CAP {
        return Err(Fail::new(Kind::Cap, format!("estimate:{total}")));
    }

    Ok(Draft { system, messages, max_tokens, model, host })
}

impl Draft {
    /// A talk send that names no cap: the stored model's own limit is asked for first (`model_limit`).
    pub fn open_cap(&self) -> bool {
        self.max_tokens.is_none()
    }
    /// An input naming another model or host is refused, before anything is asked of the network.
    pub fn bound(&self, rec: &Record) -> Result<(), Fail> {
        if self.model.as_deref().is_some_and(|m| m != rec.model) {
            return Err(bad("model"));
        }
        if self.host.as_deref().is_some_and(|h| !h.eq_ignore_ascii_case(&rec.endpoint.host) && !h.eq_ignore_ascii_case(&rec.endpoint.authority())) {
            return Err(bad("host"));
        }
        Ok(())
    }
}

/// The stored model's output limit from its models entry (`max_tokens`), when the answer has one.
pub fn model_limit(entry: &[u8]) -> Option<u64> {
    let v: Value = serde_json::from_slice(entry).ok()?;
    v.get("max_tokens").and_then(Value::as_u64).filter(|n| *n > 0)
}

/// The body for the stored endpoint and model. An input naming another model or host is refused.
/// Only api.anthropic.com gets `thinking: disabled`; other hosts get the minimal body. A send that names no cap
/// takes `limit` (the model's own, read by `send`) up to WHOLE_REPLY_TOKENS, or DEFAULT_TOKENS without one.
pub fn body(d: Draft, rec: &Record, limit: Option<u64>) -> Result<Vec<u8>, Fail> {
    d.bound(rec)?;
    let mut body = Map::new();
    body.insert("model".into(), json!(rec.model));
    let max_tokens = d.max_tokens.unwrap_or_else(|| limit.map_or(DEFAULT_TOKENS, |n| n.min(WHOLE_REPLY_TOKENS)));
    body.insert("max_tokens".into(), json!(max_tokens));
    if let Some(s) = d.system {
        body.insert("system".into(), json!(s));
    }
    body.insert("messages".into(), Value::Array(d.messages));
    if rec.endpoint.is_anthropic() {
        body.insert("thinking".into(), json!({ "type": "disabled" }));
    }
    Ok(serde_json::to_vec(&Value::Object(body)).expect("serialising a JSON value"))
}

fn short(s: &str) -> String {
    s.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_').take(32).collect()
}

/// Text, usage and kind from a 200 answer.
pub fn read_reply(body: &[u8]) -> Result<(String, Value), Fail> {
    let v: Value = serde_json::from_slice(body).map_err(|_| Fail::new(Kind::Other, "reply-json"))?;
    if v.get("stop_reason").and_then(Value::as_str) == Some("refusal") {
        return Err(Fail::new(Kind::Refusal, "stop_reason"));
    }
    let mut text = String::new();
    if let Some(blocks) = v.get("content").and_then(Value::as_array) {
        for b in blocks {
            if b.get("type").and_then(Value::as_str) == Some("text")
                && let Some(t) = b.get("text").and_then(Value::as_str) {
                    text.push_str(t);
                }
        }
    }
    let mut usage = Map::new();
    if let Some(u) = v.get("usage").and_then(Value::as_object) {
        for k in ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"] {
            if let Some(n) = u.get(k).and_then(Value::as_u64) {
                usage.insert(k.into(), json!(n));
            }
        }
    }
    Ok((text, Value::Object(usage)))
}

/// Maps an HTTP status to the design's failure lines (TALK-KEY §3 «Failures»).
pub fn fail_for_status(status: u16, body: &[u8], retry_after: Option<u64>) -> Fail {
    let mut f = match status {
        401 => Fail::new(Kind::Invalid, "status"),
        402 => Fail::new(Kind::Credit, "status"),
        // Anthropic answers a spent balance with a 400 that says so.
        400 if mentions_credit(body) => Fail::new(Kind::Credit, "status-400-credit"),
        403 | 404 => Fail::new(Kind::Model, "status"),
        429 => {
            let mut f = Fail::new(Kind::Rate, "status");
            f.retry_after = retry_after;
            f
        }
        500 | 502 | 503 | 504 | 529 => Fail::new(Kind::Busy, "status"),
        _ => Fail::new(Kind::Other, "status"),
    };
    f.status = Some(status);
    f
}

fn mentions_credit(body: &[u8]) -> bool {
    serde_json::from_slice::<Value>(body)
        .ok()
        .and_then(|v| v.pointer("/error/message").and_then(Value::as_str).map(str::to_ascii_lowercase))
        .is_some_and(|m| m.contains("credit balance"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(base: &str, model: &str, key: &str) -> Record {
        let endpoint = crate::endpoint::Endpoint::parse(base).unwrap();
        let key = crate::secret::parse_key_for(key.as_bytes().to_vec(), &endpoint).unwrap();
        Record { key, endpoint, model: model.into() }
    }

    fn anthropic() -> Record {
        record("https://api.anthropic.com", "claude-haiku-5-5", "sk-ant-api03-abcdefghijklmnopqrstuvwxyzx7Qa")
    }

    fn body_for(v: Value, rec: &Record) -> Result<Value, Fail> {
        super::body(draft(v.to_string().as_bytes())?, rec, None).map(|b| serde_json::from_slice(&b).unwrap())
    }

    fn body(v: Value) -> Result<Value, Fail> {
        body_for(v, &anthropic())
    }

    fn detail(v: Value) -> String {
        body(v).unwrap_err().detail
    }

    #[test]
    fn builds_the_fixed_request() {
        let b = body(json!({"system": "persona", "messages": [{"role": "user", "content": "hi"}], "max_tokens": 200})).unwrap();
        assert_eq!(b["model"], "claude-haiku-5-5");
        assert_eq!(b["max_tokens"], 200);
        assert_eq!(b["thinking"], json!({"type": "disabled"}));
        assert!(b.get("temperature").is_none());
        assert_eq!(b.as_object().unwrap().len(), 5);
    }

    #[test]
    fn refuses_other_host_model_and_size() {
        let m = json!([{"role": "user", "content": "hi"}]);
        assert_eq!(detail(json!({"messages": m, "max_tokens": 200, "host": "evil.example"})), "input:host");
        assert_eq!(detail(json!({"messages": m, "max_tokens": 200, "model": "claude-opus-5-5"})), "input:model");
        assert_eq!(detail(json!({"messages": m, "max_tokens": 64_001})), "input:max_tokens");
        assert_eq!(detail(json!({"messages": m, "max_tokens": 0})), "input:max_tokens");
        assert_eq!(detail(json!({"messages": m, "max_tokens": "400"})), "input:max_tokens");
        assert_eq!(detail(json!({"messages": m, "max_tokens": 200, "temperature": 1})), "input:field:temperature");
        assert_eq!(detail(json!({"messages": m, "max_tokens": 200, "thinking": {"type": "enabled"}})), "input:field:thinking");
        assert_eq!(detail(json!({"messages": m, "max_tokens": 200, "url": "https://x"})), "input:field:url");
        let blocks = json!([{"role": "user", "content": [{"type": "text", "text": "hi", "cache_control": {"type": "ephemeral"}}]}]);
        assert_eq!(detail(json!({"messages": blocks, "max_tokens": 200})), "input:content");
        let prefill = json!([{"role": "user", "content": "hi"}, {"role": "assistant", "content": "Sure"}]);
        assert_eq!(detail(json!({"messages": prefill, "max_tokens": 200})), "input:prefill");
        let order = json!([{"role": "assistant", "content": "hi"}]);
        assert_eq!(detail(json!({"messages": order, "max_tokens": 200})), "input:role-order");
    }

    #[test]
    fn a_compact_may_ask_for_up_to_a_thousand_tokens_and_the_kind_is_never_sent() {
        let m = json!([{"role": "user", "content": "the chat so far"}]);
        let b = body(json!({"system": "notes", "messages": m, "max_tokens": 1000, "kind": "compact"})).unwrap();
        assert_eq!(b["max_tokens"], 1000);
        assert!(b.get("kind").is_none());
        assert_eq!(b.as_object().unwrap().len(), 5);
        assert_eq!(detail(json!({"messages": m, "max_tokens": 1001, "kind": "compact"})), "input:max_tokens");
        // a compact must name its cap
        assert_eq!(detail(json!({"messages": m, "kind": "compact"})), "input:max_tokens");
        // a talk send has no cap of its own (owner 10-17), up to Claude Code's 64,000 for one whole reply
        assert_eq!(body(json!({"messages": m, "max_tokens": 64_000, "kind": "talk"})).unwrap()["max_tokens"], 64_000);
        assert_eq!(detail(json!({"messages": m, "max_tokens": 64_001, "kind": "talk"})), "input:max_tokens");
        assert_eq!(detail(json!({"messages": m, "max_tokens": 200, "kind": "summary"})), "input:kind");
        assert_eq!(detail(json!({"messages": m, "max_tokens": 200, "kind": 1})), "input:kind");
    }

    #[test]
    fn a_talk_send_naming_no_cap_takes_the_models_own_limit_or_claude_codes_default() {
        let m = json!([{"role": "user", "content": "hi"}]);
        let open = |limit: Option<u64>| -> Value {
            let d = draft(json!({"messages": m, "kind": "talk"}).to_string().as_bytes()).unwrap();
            assert!(d.open_cap());
            serde_json::from_slice(&super::body(d, &anthropic(), limit).unwrap()).unwrap()
        };
        assert_eq!(open(Some(8_192))["max_tokens"], 8_192);
        assert_eq!(open(Some(128_000))["max_tokens"], 64_000);
        assert_eq!(open(None)["max_tokens"], 1_024);
        assert!(!draft(json!({"messages": m, "max_tokens": 300}).to_string().as_bytes()).unwrap().open_cap());
        assert_eq!(super::model_limit(br#"{"id":"claude-haiku-5-5","max_tokens":64000}"#), Some(64_000));
        for entry in [&br#"{"id":"x"}"#[..], br#"{"max_tokens":0}"#, br#"{"max_tokens":"lots"}"#, b"not json"] {
            assert_eq!(super::model_limit(entry), None);
        }
    }

    #[test]
    fn the_endpoint_is_bound_to_the_stored_record() {
        let gw = record("http://127.0.0.1:8080", "gateway-model-1", "gw-key-12345678");
        let m = json!([{"role": "user", "content": "hi"}]);
        // Another host's minimal body: no thinking, the stored model.
        let b = body_for(json!({"system": "p", "messages": m, "max_tokens": 50}), &gw).unwrap();
        assert_eq!(b, json!({"model": "gateway-model-1", "max_tokens": 50, "system": "p", "messages": [{"role": "user", "content": "hi"}]}));
        // Naming the stored ones is allowed, naming any other is refused.
        assert!(body_for(json!({"messages": m, "max_tokens": 50, "model": "gateway-model-1", "host": "127.0.0.1"}), &gw).is_ok());
        assert_eq!(body_for(json!({"messages": m, "max_tokens": 50, "model": "claude-haiku-5-5"}), &gw).unwrap_err().detail, "input:model");
        assert_eq!(body_for(json!({"messages": m, "max_tokens": 50, "host": "api.anthropic.com"}), &gw).unwrap_err().detail, "input:host");
        assert_eq!(body_for(json!({"messages": m, "max_tokens": 50, "base_url": "http://evil.example"}), &gw).unwrap_err().detail, "input:field:base_url");
        assert_eq!(body_for(json!({"messages": m, "max_tokens": 50, "model": 7}), &gw).unwrap_err().detail, "input:model");
    }

    #[test]
    fn the_cap_counts_bytes_and_nfkc() {
        let under = "a".repeat(CAP - FRAMING);
        assert!(body(json!({"messages": [{"role": "user", "content": under}], "max_tokens": 10})).is_ok());
        let over = "a".repeat(CAP - FRAMING + 1);
        let f = body(json!({"messages": [{"role": "user", "content": over}], "max_tokens": 10})).unwrap_err();
        assert_eq!(f.kind, Kind::Cap);
        // 3 bytes each, 33 after NFKC: 2,970 of them are 98,010 by NFKC but only 8,910 by bytes.
        let wide = "\u{FDFA}".repeat(2_970);
        assert_eq!(estimate(&wide), 98_010);
        let f = body(json!({"messages": [{"role": "user", "content": wide}], "max_tokens": 10})).unwrap_err();
        assert_eq!(f.kind, Kind::Cap);
        assert_eq!(estimate("你好"), 6);
    }

    #[test]
    fn statuses_map_to_kinds() {
        let k = |s, b: &str| fail_for_status(s, b.as_bytes(), None).kind;
        assert_eq!(k(401, ""), Kind::Invalid);
        assert_eq!(k(402, ""), Kind::Credit);
        assert_eq!(k(400, r#"{"error":{"message":"Your credit balance is too low"}}"#), Kind::Credit);
        assert_eq!(k(400, r#"{"error":{"message":"bad"}}"#), Kind::Other);
        assert_eq!(k(403, ""), Kind::Model);
        assert_eq!(k(404, ""), Kind::Model);
        assert_eq!(k(429, ""), Kind::Rate);
        assert_eq!(k(500, ""), Kind::Busy);
        assert_eq!(k(529, ""), Kind::Busy);
        assert_eq!(k(413, ""), Kind::Other);
        assert_eq!(fail_for_status(413, b"", None).status, Some(413));
        assert_eq!(fail_for_status(429, b"", Some(7)).retry_after, Some(7));
    }

    #[test]
    fn reads_text_usage_and_refusal() {
        let (t, u) = read_reply(br#"{"content":[{"type":"text","text":"Hello"}],"stop_reason":"end_turn","usage":{"input_tokens":12,"output_tokens":3}}"#).unwrap();
        assert_eq!(t, "Hello");
        assert_eq!(u, json!({"input_tokens": 12, "output_tokens": 3}));
        let f = read_reply(br#"{"content":[],"stop_reason":"refusal","usage":{}}"#).unwrap_err();
        assert_eq!(f.kind, Kind::Refusal);
    }
}
