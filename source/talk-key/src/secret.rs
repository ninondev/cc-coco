use std::fmt;

use crate::out::{Fail, Kind};

/// The key in memory. Never printed; the bytes are zeroed on drop.
pub struct Secret(Vec<u8>);

impl Secret {
    pub fn from_vec(bytes: Vec<u8>) -> Secret {
        Secret(bytes)
    }

    pub fn as_str(&self) -> &str {
        std::str::from_utf8(&self.0).unwrap_or("")
    }

    pub fn as_bytes(&self) -> &[u8] {
        &self.0
    }

    pub fn last4(&self) -> String {
        let s = self.as_str();
        s[s.len().saturating_sub(4)..].to_string()
    }
}

impl Drop for Secret {
    fn drop(&mut self) {
        wipe(&mut self.0);
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Secret(..)")
    }
}

pub fn wipe(buf: &mut [u8]) {
    for b in buf.iter_mut() {
        // Volatile so the optimiser keeps the store for memory that is about to be freed.
        unsafe { std::ptr::write_volatile(b, 0) };
    }
}

/// The key rule for an endpoint: an Anthropic key for api.anthropic.com; elsewhere printable ASCII with no
/// spaces, 8 to 512 characters, as other providers' keys have no shared shape.
pub fn parse_key_for(raw: Vec<u8>, endpoint: &crate::endpoint::Endpoint) -> Result<Secret, Fail> {
    if endpoint.is_anthropic() {
        return parse_key(raw);
    }
    let mut raw = raw;
    let trimmed = {
        let s = std::str::from_utf8(&raw).unwrap_or("").trim_matches(|c: char| c == '\n' || c == '\r' || c == ' ' || c == '\t');
        s.as_bytes().to_vec()
    };
    wipe(&mut raw);
    let key = Secret(trimmed);
    let b = key.as_bytes();
    if b.len() < 8 || b.len() > 512 || !b.iter().all(|c| (0x21..=0x7e).contains(c)) {
        return Err(Fail::new(Kind::Format, "not-a-key"));
    }
    Ok(key)
}

/// Accepts Anthropic keys of any kind the API may hand out (`sk-ant-api03-…`, `sk-ant-usr…`), shaped as
/// `sk-ant-` and a run of letters, digits, `-` and `_`; whether it works is Anthropic's answer to the save
/// check (owner 10-19). Admin keys and OAuth tokens are refused by their prefixes so the detail can say which.
pub fn parse_key(mut raw: Vec<u8>) -> Result<Secret, Fail> {
    let trimmed: Vec<u8> = {
        let s = std::str::from_utf8(&raw).unwrap_or("").trim();
        s.as_bytes().to_vec()
    };
    wipe(&mut raw);
    let key = Secret(trimmed);
    let s = key.as_str();
    if s.starts_with("sk-ant-admin") {
        return Err(Fail::new(Kind::Format, "admin-key"));
    }
    if s.starts_with("sk-ant-oat") || s.starts_with("sk-ant-ort") {
        return Err(Fail::new(Kind::Format, "oauth-token"));
    }
    let Some(rest) = s.strip_prefix("sk-ant-") else {
        return Err(Fail::new(Kind::Format, "not-an-api-key"));
    };
    let b = rest.as_bytes();
    let shaped = b.len() >= 24
        && b.len() <= 300
        && b[0].is_ascii_alphanumeric()
        && b.iter().all(|c| c.is_ascii_alphanumeric() || *c == b'-' || *c == b'_');
    if !shaped {
        return Err(Fail::new(Kind::Format, "not-an-api-key"));
    }
    Ok(key)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kind(s: &str) -> Result<String, &'static str> {
        parse_key(s.as_bytes().to_vec()).map(|k| k.last4()).map_err(|f| match f.detail.as_str() {
            "admin-key" => "admin",
            "oauth-token" => "oauth",
            _ => "shape",
        })
    }

    #[test]
    fn other_hosts_take_printable_keys_of_8_to_512() {
        let g = crate::endpoint::Endpoint::parse("https://gateway.example.com").unwrap();
        let k = |s: &str| parse_key_for(s.as_bytes().to_vec(), &g).map(|k| k.as_str().to_string()).map_err(|f| f.detail);
        assert_eq!(k(" gw-KEY_123.~!\n"), Ok("gw-KEY_123.~!".into()));
        assert_eq!(k("1234567"), Err("not-a-key".into()));
        assert_eq!(k(&"x".repeat(512)), Ok("x".repeat(512)));
        assert_eq!(k(&"x".repeat(513)), Err("not-a-key".into()));
        assert_eq!(k("has a space"), Err("not-a-key".into()));
        assert_eq!(k("tab\tinside1"), Err("not-a-key".into()));
        assert_eq!(k("clé-12345678"), Err("not-a-key".into()));
        // On Anthropic's host the old rule holds.
        let a = crate::endpoint::Endpoint::parse("https://api.anthropic.com").unwrap();
        assert!(parse_key_for(b"gw-key-12345678".to_vec(), &a).is_err());
    }

    #[test]
    fn accepts_anthropic_keys_but_admin_keys_and_tokens() {
        assert_eq!(kind("  sk-ant-api03-abcdefghijklmnopqrstuvwxyzx7Qa\n"), Ok("x7Qa".into()));
        assert_eq!(kind("sk-ant-usr01-abcdefghijklmnopqrstuvwxyzx7Qb"), Ok("x7Qb".into()));
        assert_eq!(kind("sk-ant-usrabcdefghijklmnopqrstuvwxyzx7Qc"), Ok("x7Qc".into()));
        assert_eq!(kind("sk-ant-admin01-abcdefghijklmnopqrstuvwxyz"), Err("admin"));
        assert_eq!(kind("sk-ant-oat01-abcdefghijklmnopqrstuvwxyz"), Err("oauth"));
        assert_eq!(kind("sk-ant-ort01-abcdefghijklmnopqrstuvwxyz"), Err("oauth"));
        assert_eq!(kind("sk-ant-api03-short"), Err("shape"));
        assert_eq!(kind("sk-ant-api03-has space inside the key text"), Err("shape"));
        assert_eq!(kind("sk-proj-abcdefghijklmnopqrstuvwxyz"), Err("shape"));
        assert_eq!(kind("sk-ant--abcdefghijklmnopqrstuvwxyz"), Err("shape"));
        assert_eq!(kind("sk-ant-usr01-abc.defghijklmnopqrstuvwxyz"), Err("shape"));
        assert_eq!(kind(""), Err("shape"));
    }
}
