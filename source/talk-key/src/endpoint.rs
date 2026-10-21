//! Where the key may be sent, and with which model (TALK-KEY «Changed 10-10, the owner»). `add` takes
//! both from the person and stores them in one record with the key; `send` never takes them from its
//! input, so a caller of `send` cannot point the key anywhere else.

use crate::out::{Fail, Kind};
use crate::secret::Secret;

pub const ANTHROPIC: &str = "api.anthropic.com";
pub const DEFAULT_BASE: &str = "https://api.anthropic.com";
pub const DEFAULT_MODEL: &str = "claude-haiku-5-5";
const RECORD_HEADER: &[u8] = b"talk-key-record 1";

/// A parsed base URL: https to any host, or http to the loopback names only.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Endpoint {
    pub https: bool,
    pub host: String,
    pub port: u16,
    /// Path before `/v1/...`, empty or starting with `/`, never ending with one.
    pub prefix: String,
}

fn address(detail: &str) -> Fail {
    Fail::new(Kind::Address, detail)
}

const LOOPBACK: [&str; 3] = ["127.0.0.1", "::1", "localhost"];

impl Endpoint {
    pub fn parse(raw: &str) -> Result<Endpoint, Fail> {
        if raw.len() > 512 || !raw.bytes().all(|b| (0x21..=0x7e).contains(&b)) {
            return Err(address("url-characters"));
        }
        let (https, rest) = if let Some(r) = raw.strip_prefix("https://") {
            (true, r)
        } else if let Some(r) = raw.strip_prefix("http://") {
            (false, r)
        } else {
            return Err(address("url-scheme"));
        };
        if rest.contains(['?', '#']) {
            return Err(address("url-query"));
        }
        let (authority, path) = match rest.find('/') {
            Some(i) => (&rest[..i], &rest[i..]),
            None => (rest, ""),
        };
        if authority.contains('@') {
            return Err(address("url-userinfo"));
        }
        let (host, port) = if let Some(v6) = authority.strip_prefix('[') {
            let (h, after) = v6.split_once(']').ok_or_else(|| address("url-host"))?;
            (h.to_string(), after.strip_prefix(':'))
        } else {
            match authority.rsplit_once(':') {
                Some((h, p)) => (h.to_string(), Some(p)),
                None => (authority.to_string(), None),
            }
        };
        let host = host.to_ascii_lowercase();
        let name_ok = !host.is_empty()
            && host.len() <= 253
            && (host.contains(':') && host.chars().all(|c| c.is_ascii_hexdigit() || c == ':')
                || host.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.') && !host.starts_with(['.', '-']));
        if !name_ok {
            return Err(address("url-host"));
        }
        if !https && !LOOPBACK.contains(&host.as_str()) {
            return Err(address("url-http-not-loopback"));
        }
        let port = match port {
            Some(p) => p.parse::<u16>().ok().filter(|p| *p > 0).ok_or_else(|| address("url-port"))?,
            None if https => 443,
            None => 80,
        };
        let prefix = path.trim_end_matches('/').to_string();
        if prefix.split('/').any(|seg| seg == "." || seg == "..") || prefix.contains("//") {
            return Err(address("url-path"));
        }
        if !prefix.bytes().all(|b| b.is_ascii_alphanumeric() || b"/-._~".contains(&b)) {
            return Err(address("url-path"));
        }
        Ok(Endpoint { https, host, port, prefix })
    }

    pub fn is_anthropic(&self) -> bool {
        self.https && self.host == ANTHROPIC && self.port == 443 && self.prefix.is_empty()
    }

    /// The Host header and the CONNECT target.
    pub fn authority(&self) -> String {
        let host = if self.host.contains(':') { format!("[{}]", self.host) } else { self.host.clone() };
        let default = if self.https { 443 } else { 80 };
        if self.port == default { host } else { format!("{host}:{}", self.port) }
    }

    pub fn base(&self) -> String {
        format!("{}://{}{}", if self.https { "https" } else { "http" }, self.authority(), self.prefix)
    }
}

/// Model ids as providers spell them: `claude-haiku-5-5`, `us.anthropic.claude-…`, `vendor/model:tag`.
pub fn check_model(model: &str, endpoint: &Endpoint) -> Result<(), Fail> {
    let ok = !model.is_empty()
        && model.len() <= 200
        && model.bytes().all(|b| b.is_ascii_alphanumeric() || b"._:/@+-".contains(&b))
        && !(endpoint.is_anthropic() && model.contains('/'));
    if ok { Ok(()) } else { Err(address("model")) }
}

/// The key, its endpoint and its model, as kept together in the store.
pub struct Record {
    pub key: Secret,
    pub endpoint: Endpoint,
    pub model: String,
}

impl Record {
    pub fn encode(&self) -> Secret {
        let (base, model) = (self.endpoint.base(), &self.model);
        let mut out = Vec::with_capacity(RECORD_HEADER.len() + base.len() + model.len() + self.key.as_bytes().len() + 3);
        out.extend_from_slice(RECORD_HEADER);
        out.push(b'\n');
        out.extend_from_slice(base.as_bytes());
        out.push(b'\n');
        out.extend_from_slice(model.as_bytes());
        out.push(b'\n');
        out.extend_from_slice(self.key.as_bytes());
        Secret::from_vec(out)
    }

    /// A record, or a bare key from before 10-10 (then the defaults). Every rule is checked again.
    pub fn decode(stored: &Secret) -> Result<Record, Fail> {
        let bad = || Fail::new(Kind::Computer, "stored-value-not-a-key");
        let bytes = stored.as_bytes();
        let (base, model, key) = if bytes.starts_with(RECORD_HEADER) && bytes.get(RECORD_HEADER.len()) == Some(&b'\n') {
            let mut parts = bytes[RECORD_HEADER.len() + 1..].splitn(3, |b| *b == b'\n');
            let base = std::str::from_utf8(parts.next().ok_or_else(bad)?).map_err(|_| bad())?;
            let model = std::str::from_utf8(parts.next().ok_or_else(bad)?).map_err(|_| bad())?;
            (base.to_string(), model.to_string(), parts.next().ok_or_else(bad)?.to_vec())
        } else {
            (DEFAULT_BASE.to_string(), DEFAULT_MODEL.to_string(), bytes.to_vec())
        };
        let endpoint = Endpoint::parse(&base).map_err(|_| bad())?;
        check_model(&model, &endpoint).map_err(|_| bad())?;
        let key = crate::secret::parse_key_for(key, &endpoint).map_err(|_| bad())?;
        Ok(Record { key, endpoint, model })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn detail(raw: &str) -> String {
        Endpoint::parse(raw).err().map(|f| f.detail).unwrap_or_else(|| "ok".into())
    }

    #[test]
    fn the_url_rules() {
        for ok in [
            "https://api.anthropic.com",
            "https://api.anthropic.com/",
            "https://gateway.example.com:8443/anthropic",
            "http://127.0.0.1:8080",
            "http://[::1]:9000",
            "http://localhost:4000/v",
            "https://10.0.0.5",
        ] {
            assert_eq!(detail(ok), "ok", "{ok}");
        }
        for (bad, why) in [
            ("http://gateway.example.com", "url-http-not-loopback"),
            ("http://127.0.0.2:80", "url-http-not-loopback"),
            ("ftp://api.anthropic.com", "url-scheme"),
            ("api.anthropic.com", "url-scheme"),
            ("https://user:pass@gateway.example.com", "url-userinfo"),
            ("https://gateway.example.com/?x=1", "url-query"),
            ("https://gateway.example.com/#top", "url-query"),
            ("https://", "url-host"),
            ("https://gate way.example.com", "url-characters"),
            ("https://gåteway.example.com", "url-characters"),
            ("https://gateway.example.com:0", "url-port"),
            ("https://gateway.example.com:99999", "url-port"),
            ("https://gateway.example.com/a/../b", "url-path"),
            ("https://gateway.example.com/%2e%2e", "url-path"),
        ] {
            assert_eq!(detail(bad), why, "{bad}");
        }
        let e = Endpoint::parse("https://API.Anthropic.com/").unwrap();
        assert!(e.is_anthropic());
        assert_eq!(e.base(), "https://api.anthropic.com");
        let g = Endpoint::parse("https://gateway.example.com:8443/anthropic/").unwrap();
        assert!(!g.is_anthropic());
        assert_eq!((g.authority().as_str(), g.prefix.as_str()), ("gateway.example.com:8443", "/anthropic"));
        assert!(!Endpoint::parse("https://api.anthropic.com:8443").unwrap().is_anthropic());
        assert!(!Endpoint::parse("https://api.anthropic.com/proxy").unwrap().is_anthropic());
    }

    #[test]
    fn models() {
        let a = Endpoint::parse(DEFAULT_BASE).unwrap();
        let g = Endpoint::parse("https://gateway.example.com").unwrap();
        assert!(check_model("claude-haiku-5-5", &a).is_ok());
        assert!(check_model("vendor/model:latest", &a).is_err());
        assert!(check_model("vendor/model:latest", &g).is_ok());
        assert!(check_model("bad model", &g).is_err());
        assert!(check_model("", &g).is_err());
    }

    #[test]
    fn records_round_trip_and_old_keys_get_the_defaults() {
        let g = Endpoint::parse("http://127.0.0.1:8080/v").unwrap();
        let rec = Record { key: crate::secret::parse_key_for(b"gw-key-12345678".to_vec(), &g).unwrap(), endpoint: g.clone(), model: "m-1".into() };
        let back = Record::decode(&rec.encode()).unwrap();
        assert_eq!((back.endpoint, back.model.as_str(), back.key.as_str()), (g, "m-1", "gw-key-12345678"));
        let old = Secret::from_vec(b"sk-ant-api03-abcdefghijklmnopqrstuvwxyzx7Qa".to_vec());
        let back = Record::decode(&old).unwrap();
        assert!(back.endpoint.is_anthropic());
        assert_eq!(back.model, DEFAULT_MODEL);
        // A record whose key breaks its host's rule is refused, as is a bare non-Anthropic key.
        assert!(Record::decode(&Secret::from_vec(b"talk-key-record 1\nhttps://api.anthropic.com\nclaude-haiku-5-5\ngw-key-12345678".to_vec())).is_err());
        assert!(Record::decode(&Secret::from_vec(b"gw-key-12345678".to_vec())).is_err());
    }
}
