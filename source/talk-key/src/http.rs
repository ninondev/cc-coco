//! One request to the stored endpoint over HTTP/1.1, by hand on rustls (plain TCP only for http on
//! loopback, which endpoint.rs alone allows). Written out so that
//! the only environment read is the proxy pair (HTTPS_PROXY and NO_PROXY, or their lowercase
//! forms), there are no redirects, and nothing is sent before the TLS handshake has finished.

use std::io::{self, Read, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::time::{Duration, Instant};

use rustls::pki_types::ServerName;
use rustls::{ClientConnection, StreamOwned};

use crate::deadline;
use crate::hooks;
use crate::out::{Fail, Kind};
use crate::endpoint::Endpoint;
use crate::secret::{Secret, wipe};
use crate::trust;

const CONNECT_EACH: Duration = Duration::from_secs(10);
const HEAD_LIMIT: usize = 64 * 1024;
const BODY_LIMIT: usize = 4 * 1024 * 1024;

pub struct Reply {
    pub status: u16,
    pub retry_after: Option<u64>,
    pub body: Vec<u8>,
}

fn offline(detail: impl Into<String>) -> Fail {
    Fail::new(Kind::Offline, detail)
}

fn io_fail(e: &io::Error) -> Fail {
    if let Some(inner) = e.get_ref()
        && let Some(tls) = inner.downcast_ref::<rustls::Error>() {
            return offline(format!("tls-{}", tls_short(tls)));
        }
    match e.kind() {
        io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock => offline("timeout"),
        io::ErrorKind::ConnectionRefused => offline("refused"),
        io::ErrorKind::ConnectionReset | io::ErrorKind::ConnectionAborted => offline("reset"),
        _ => offline("network"),
    }
}

fn tls_short(e: &rustls::Error) -> &'static str {
    match e {
        rustls::Error::InvalidCertificate(_) => "certificate",
        rustls::Error::AlertReceived(_) => "alert",
        rustls::Error::NoCertificatesPresented => "no-certificate",
        _ => "handshake",
    }
}

fn remaining(deadline: Instant) -> Result<Duration, Fail> {
    let left = deadline.saturating_duration_since(Instant::now());
    if left.is_zero() { Err(offline("timeout")) } else { Ok(left) }
}

fn arm(sock: &TcpStream, deadline: Instant) -> Result<(), Fail> {
    let left = remaining(deadline)?;
    sock.set_read_timeout(Some(left)).map_err(|e| io_fail(&e))?;
    sock.set_write_timeout(Some(left)).map_err(|e| io_fail(&e))
}

/// Plain http goes to this computer only: a name like `localhost` is kept to the loopback addresses it resolves to, so
/// a resolver that answers with another address never gets the key in the clear (K2, lane C 10-17).
fn loopback_only(addrs: Vec<SocketAddr>) -> Result<Vec<SocketAddr>, Fail> {
    let kept: Vec<_> = addrs.into_iter().filter(|a| a.ip().is_loopback()).collect();
    if kept.is_empty() { Err(Fail::new(Kind::Address, "url-http-not-loopback")) } else { Ok(kept) }
}

fn dial(host: &str, port: u16, deadline: Instant, plain: bool) -> Result<TcpStream, Fail> {
    let mut addrs: Vec<_> = (host, port).to_socket_addrs().map_err(|_| offline("dns"))?.collect();
    if addrs.is_empty() {
        return Err(offline("dns"));
    }
    if plain {
        addrs = loopback_only(addrs)?;
    }
    let mut last = offline("network");
    for addr in addrs {
        let wait = remaining(deadline)?.min(CONNECT_EACH);
        match TcpStream::connect_timeout(&addr, wait) {
            Ok(s) => {
                let _ = s.set_nodelay(true);
                deadline::guard(&s);
                return Ok(s);
            }
            Err(e) => last = io_fail(&e),
        }
    }
    Err(last)
}

struct Proxy {
    host: String,
    port: u16,
    auth: Option<String>,
}

/// The uppercase name wins when both are set; the two spellings mean the same thing.
fn either(upper: &str, lower: &str) -> Option<String> {
    std::env::var(upper).ok().or_else(|| std::env::var(lower).ok())
}

/// HTTPS_PROXY as `http://[user:pass@]host[:port]` or `host:port`. Other schemes are refused
/// rather than ignored, so a proxy the person set up is never silently bypassed.
fn proxy_from_env(host: &str) -> Result<Option<Proxy>, Fail> {
    let Some(raw) = either("HTTPS_PROXY", "https_proxy").filter(|v| !v.trim().is_empty()) else {
        return Ok(None);
    };
    if bypasses_proxy(&either("NO_PROXY", "no_proxy").unwrap_or_default(), host) {
        return Ok(None);
    }
    parse_proxy(raw.trim()).map(Some)
}

fn has_control(s: &str) -> bool {
    s.bytes().any(|b| b < 0x20 || b == 0x7f)
}

fn parse_proxy(raw: &str) -> Result<Proxy, Fail> {
    let bad = || offline("proxy-url");
    if has_control(raw) {
        return Err(bad());
    }
    let rest = match raw.split_once("://") {
        Some((scheme, rest)) if scheme.eq_ignore_ascii_case("http") => rest,
        Some(_) => return Err(offline("proxy-scheme")),
        None => raw,
    };
    let authority = rest.split('/').next().unwrap_or("");
    let (userinfo, hostport) = match authority.rsplit_once('@') {
        Some((u, h)) => (Some(u), h),
        None => (None, authority),
    };
    let (host, port) = if let Some(v6) = hostport.strip_prefix('[') {
        let (h, after) = v6.split_once(']').ok_or_else(bad)?;
        (h.to_string(), after.strip_prefix(':'))
    } else {
        match hostport.rsplit_once(':') {
            Some((h, p)) => (h.to_string(), Some(p)),
            None => (hostport.to_string(), None),
        }
    };
    if host.is_empty() {
        return Err(bad());
    }
    // curl's default proxy port.
    let port = match port {
        Some(p) => p.parse().map_err(|_| bad())?,
        None => 1080,
    };
    let auth = match userinfo {
        None => None,
        Some(u) => {
            let (user, pass) = u.split_once(':').unwrap_or((u, ""));
            let plain = format!("{}:{}", percent_decode(user), percent_decode(pass));
            // A decoded CR or LF would end the header and start another.
            if has_control(&plain) {
                return Err(bad());
            }
            Some(format!("Basic {}", base64(plain.as_bytes())))
        }
    };
    Ok(Proxy { host, port, auth })
}

fn bypasses_proxy(list: &str, host: &str) -> bool {
    list.split(',').any(|entry| {
        let mut e = entry.trim().to_ascii_lowercase();
        if e == "*" {
            return true;
        }
        if let Some((name, port)) = e.rsplit_once(':')
            && port.chars().all(|c| c.is_ascii_digit()) && !name.contains(']') {
                if port != "443" {
                    return false;
                }
                e = name.to_string();
            }
        let e = e.trim_start_matches('*').trim_start_matches('.');
        !e.is_empty() && (host == e || host.ends_with(&format!(".{e}")))
    })
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            let hex = |c: u8| (c as char).to_digit(16);
            if let (Some(h), Some(l)) = (hex(b[i + 1]), hex(b[i + 2])) {
                out.push((h * 16 + l) as u8);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn base64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for c in data.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

fn tunnel(proxy: &Proxy, ep: &Endpoint, deadline: Instant) -> Result<TcpStream, Fail> {
    let mut sock = dial(&proxy.host, proxy.port, deadline, false).map_err(|f| offline(format!("proxy-{}", f.detail)))?;
    arm(&sock, deadline)?;
    let target = if ep.host.contains(':') { format!("[{}]:{}", ep.host, ep.port) } else { format!("{}:{}", ep.host, ep.port) };
    let mut req = format!("CONNECT {target} HTTP/1.1\r\nHost: {target}\r\n");
    if let Some(a) = &proxy.auth {
        req.push_str(&format!("Proxy-Authorization: {a}\r\n"));
    }
    req.push_str("\r\n");
    sock.write_all(req.as_bytes()).map_err(|e| io_fail(&e))?;
    // Byte by byte, so nothing past the proxy's answer is consumed.
    let mut head = Vec::new();
    let mut byte = [0u8; 1];
    while !head.ends_with(b"\r\n\r\n") {
        if head.len() > HEAD_LIMIT {
            return Err(offline("proxy-answer"));
        }
        arm(&sock, deadline)?;
        match sock.read(&mut byte) {
            Ok(0) => return Err(offline("proxy-closed")),
            Ok(_) => head.push(byte[0]),
            Err(e) => return Err(io_fail(&e)),
        }
    }
    let status = status_of(&head).ok_or_else(|| offline("proxy-answer"))?;
    if status != 200 {
        return Err(offline(format!("proxy-{status}")));
    }
    Ok(sock)
}

fn status_of(head: &[u8]) -> Option<u16> {
    let line = head.split(|b| *b == b'\n').next()?;
    let line = std::str::from_utf8(line).ok()?;
    let mut parts = line.split_whitespace();
    if !parts.next()?.starts_with("HTTP/1.") {
        return None;
    }
    parts.next()?.parse().ok()
}

fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

type Tls = StreamOwned<ClientConnection, TcpStream>;

/// TLS everywhere but http on loopback.
enum Conn {
    Tls(Box<Tls>),
    Plain(TcpStream),
}

impl Conn {
    fn sock(&self) -> &TcpStream {
        match self {
            Conn::Tls(t) => &t.sock,
            Conn::Plain(s) => s,
        }
    }
}

impl Read for Conn {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        match self {
            Conn::Tls(t) => t.read(buf),
            Conn::Plain(s) => s.read(buf),
        }
    }
}

impl Write for Conn {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        match self {
            Conn::Tls(t) => t.write(buf),
            Conn::Plain(s) => s.write(buf),
        }
    }
    fn flush(&mut self) -> io::Result<()> {
        match self {
            Conn::Tls(t) => t.flush(),
            Conn::Plain(s) => s.flush(),
        }
    }
}

fn read_some(s: &mut Conn, deadline: Instant, buf: &mut [u8]) -> Result<usize, Fail> {
    arm(s.sock(), deadline)?;
    match s.read(buf) {
        Ok(n) => Ok(n),
        // Servers often close without close_notify; framing decides whether the body is whole.
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => Ok(0),
        Err(e) => Err(io_fail(&e)),
    }
}

enum Framing {
    Length(usize),
    Chunked,
    UntilClose,
}

/// Decodes a complete chunked body, or None if more bytes are needed.
fn dechunk(data: &[u8]) -> Result<Option<Vec<u8>>, Fail> {
    let mut out = Vec::new();
    let mut i = 0;
    loop {
        let Some(nl) = find(&data[i..], b"\r\n") else { return Ok(None) };
        let line = std::str::from_utf8(&data[i..i + nl]).map_err(|_| Fail::new(Kind::Other, "reply-chunk"))?;
        let size_hex = line.split(';').next().unwrap_or("").trim();
        let size = usize::from_str_radix(size_hex, 16).map_err(|_| Fail::new(Kind::Other, "reply-chunk"))?;
        // Refused before any arithmetic, so a size near usize::MAX cannot wrap an index.
        if size > BODY_LIMIT || out.len() + size > BODY_LIMIT {
            return Err(Fail::new(Kind::Other, "reply-too-large"));
        }
        i += nl + 2;
        if size == 0 {
            return Ok(Some(out));
        }
        let end = i.checked_add(size).and_then(|e| e.checked_add(2)).ok_or_else(|| Fail::new(Kind::Other, "reply-chunk"))?;
        if data.len() < end {
            return Ok(None);
        }
        out.extend_from_slice(&data[i..i + size]);
        i = end;
    }
}

fn read_reply(s: &mut Conn, deadline: Instant) -> Result<Reply, Fail> {
    let mut buf = Vec::new();
    let mut chunk = vec![0u8; 16 * 1024];
    let head_end = loop {
        if let Some(p) = find(&buf, b"\r\n\r\n") {
            break p + 4;
        }
        if buf.len() > HEAD_LIMIT {
            return Err(Fail::new(Kind::Other, "reply-head"));
        }
        let n = read_some(s, deadline, &mut chunk)?;
        if n == 0 {
            return Err(offline("closed"));
        }
        buf.extend_from_slice(&chunk[..n]);
    };
    let head = String::from_utf8_lossy(&buf[..head_end]).into_owned();
    let status = status_of(head.as_bytes()).ok_or_else(|| Fail::new(Kind::Other, "reply-head"))?;
    let mut framing = Framing::UntilClose;
    let mut retry_after = None;
    for line in head.split("\r\n").skip(1) {
        let Some((name, value)) = line.split_once(':') else { continue };
        let value = value.trim();
        match name.trim().to_ascii_lowercase().as_str() {
            "content-length" => {
                if let Ok(n) = value.parse()
                    && !matches!(framing, Framing::Chunked) {
                        framing = Framing::Length(n);
                    }
            }
            "transfer-encoding" if value.to_ascii_lowercase().contains("chunked") => framing = Framing::Chunked,
            "retry-after" => retry_after = value.parse().ok(),
            _ => {}
        }
    }
    let mut body = buf.split_off(head_end);
    loop {
        match framing {
            Framing::Length(n) if body.len() >= n => {
                body.truncate(n);
                break;
            }
            Framing::Chunked => {
                if let Some(done) = dechunk(&body)? {
                    body = done;
                    break;
                }
            }
            _ => {}
        }
        if body.len() > BODY_LIMIT {
            return Err(Fail::new(Kind::Other, "reply-too-large"));
        }
        let n = read_some(s, deadline, &mut chunk)?;
        if n == 0 {
            if matches!(framing, Framing::UntilClose) {
                break;
            }
            return Err(offline("truncated"));
        }
        body.extend_from_slice(&chunk[..n]);
    }
    Ok(Reply { status, retry_after, body })
}

/// Sends `method {prefix}{path}` to the stored endpoint with the key and returns the raw answer.
/// Redirects are answers like any other: never followed.
pub fn call(ep: &Endpoint, method: &str, path: &str, key: &Secret, body: Option<&[u8]>) -> Result<Reply, Fail> {
    exchange(ep, method, path, key, body).map_err(|f| {
        if f.kind == Kind::Offline && deadline::sockets_cut() { offline("timeout") } else { f }
    })
}

fn exchange(ep: &Endpoint, method: &str, path: &str, key: &Secret, body: Option<&[u8]>) -> Result<Reply, Fail> {
    let deadline = deadline::for_sockets();
    let mut conn = if !ep.https {
        // http is loopback only (endpoint.rs): never through a proxy, never TLS.
        Conn::Plain(dial(&ep.host, ep.port, deadline, true)?)
    } else {
        let config = trust::client_config()?;
        let sock = match proxy_from_env(&ep.host)? {
            Some(p) => tunnel(&p, ep, deadline)?,
            None => match hooks::endpoint() {
                Some(addr) => {
                    let (h, p) = addr.rsplit_once(':').ok_or_else(|| offline("endpoint"))?;
                    dial(h, p.parse().map_err(|_| offline("endpoint"))?, deadline, false)?
                }
                None => dial(&ep.host, ep.port, deadline, false)?,
            },
        };
        let name = ServerName::try_from(ep.host.clone()).map_err(|_| offline("tls-name"))?;
        let conn = ClientConnection::new(config, name).map_err(|_| offline("tls-config"))?;
        let mut tls = StreamOwned::new(conn, sock);
        while tls.conn.is_handshaking() {
            arm(&tls.sock, deadline)?;
            tls.conn.complete_io(&mut tls.sock).map_err(|e| io_fail(&e))?;
        }
        Conn::Tls(Box::new(tls))
    };

    let mut req = Vec::with_capacity(512 + body.map_or(0, <[u8]>::len));
    req.extend_from_slice(format!("{method} {}{path} HTTP/1.1\r\nHost: {}\r\nx-api-key: ", ep.prefix, ep.authority()).as_bytes());
    req.extend_from_slice(key.as_bytes());
    req.extend_from_slice(
        b"\r\nanthropic-version: 2023-06-01\r\nuser-agent: talk-key/0.1\r\naccept: application/json\r\nconnection: close\r\n",
    );
    if let Some(b) = body {
        req.extend_from_slice(format!("content-type: application/json\r\ncontent-length: {}\r\n\r\n", b.len()).as_bytes());
        req.extend_from_slice(b);
    } else {
        req.extend_from_slice(b"\r\n");
    }
    arm(conn.sock(), deadline)?;
    let sent = conn.write_all(&req).and_then(|_| conn.flush());
    wipe(&mut req);
    sent.map_err(|e| io_fail(&e))?;
    read_reply(&mut conn, deadline)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_http_keeps_only_loopback_addresses() {
        let a = |s: &str| s.parse::<SocketAddr>().unwrap();
        assert_eq!(loopback_only(vec![a("127.0.0.1:8080"), a("10.0.0.5:8080"), a("[::1]:8080")]).unwrap(), vec![a("127.0.0.1:8080"), a("[::1]:8080")]);
        let f = loopback_only(vec![a("93.184.216.34:80"), a("[2001:db8::1]:80")]).unwrap_err();
        assert_eq!((f.kind, f.detail.as_str()), (Kind::Address, "url-http-not-loopback"));
    }

    #[test]
    fn parses_proxy_values() {
        let p = parse_proxy("http://u%40x:p%3Aw@proxy.local:3128/").unwrap();
        assert_eq!((p.host.as_str(), p.port), ("proxy.local", 3128));
        assert_eq!(p.auth.as_deref(), Some(format!("Basic {}", base64(b"u@x:p:w")).as_str()));
        let p = parse_proxy("10.0.0.1:8080").unwrap();
        assert_eq!((p.host.as_str(), p.port, p.auth.is_none()), ("10.0.0.1", 8080, true));
        let p = parse_proxy("http://[::1]:9000").unwrap();
        assert_eq!((p.host.as_str(), p.port), ("::1", 9000));
        assert_eq!(parse_proxy("socks5://h:1").err().map(|f| f.detail), Some("proxy-scheme".into()));
        assert_eq!(parse_proxy("http://h").unwrap().port, 1080);
        assert_eq!(parse_proxy("http://u:p%0d%0aX-Evil:%201@h:1").err().map(|f| f.detail), Some("proxy-url".into()));
        assert_eq!(parse_proxy("http://h:1\r\nX: y").err().map(|f| f.detail), Some("proxy-url".into()));
    }

    #[test]
    fn bypass_entries() {
        for yes in ["*", "api.anthropic.com", ".anthropic.com", "*.anthropic.com", "anthropic.com", "x, ANTHROPIC.COM", "anthropic.com:443"] {
            assert!(bypasses_proxy(yes, "api.anthropic.com"), "{yes}");
        }
        for no in ["", "localhost", "example.com", "thropic.com", "anthropic.com:8443", "api.anthropic.com.evil"] {
            assert!(!bypasses_proxy(no, "api.anthropic.com"), "{no}");
        }
    }

    #[test]
    fn base64_and_chunks() {
        assert_eq!(base64(b"Aladdin:open sesame"), "QWxhZGRpbjpvcGVuIHNlc2FtZQ==");
        assert_eq!(base64(b"ab"), "YWI=");
        assert_eq!(dechunk(b"5\r\nhello\r\n6;x=y\r\n world\r\n0\r\n\r\n").unwrap(), Some(b"hello world".to_vec()));
        assert_eq!(dechunk(b"5\r\nhel").unwrap(), None);
        assert_eq!(dechunk(b"ffffffffffffffff\r\nab").unwrap_err().detail, "reply-too-large");
        assert_eq!(dechunk(b"400001\r\nab").unwrap_err().detail, "reply-too-large");
        assert_eq!(status_of(b"HTTP/1.1 429 Too Many\r\n"), Some(429));
    }
}
