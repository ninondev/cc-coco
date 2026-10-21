//! Test bench: a throwaway CA, a local TLS server standing in for api.anthropic.com, a CONNECT
//! proxy that terminates TLS itself, and helpers that run talk-key with a clean environment.
//! Nothing here talks to the network beyond 127.0.0.1.

#![allow(dead_code)]

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
#[cfg(unix)]
use std::os::fd::{FromRawFd, OwnedFd};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use rcgen::{BasicConstraints, CertificateParams, CertifiedIssuer, DnType, IsCa, KeyPair, KeyUsagePurpose};
use rustls::pki_types::{PrivateKeyDer, PrivatePkcs8KeyDer};
use rustls::{ServerConfig, ServerConnection, StreamOwned};
use serde_json::Value;

pub const PROMPT: &str = "sk-ant-…: ";

pub fn bin() -> PathBuf {
    // option_env, because cargo sets these for integration tests and not for the example.
    let built: Option<&str> = option_env!("CARGO_BIN_EXE_talk-key");
    std::env::var_os("TALK_KEY_BIN")
        .map(PathBuf::from)
        .or(built.map(PathBuf::from))
        .unwrap_or_else(|| panic!("set TALK_KEY_BIN outside cargo test"))
}

/// A fresh directory under cargo's per-test scratch space.
pub fn scratch(name: &str) -> PathBuf {
    let base = option_env!("CARGO_TARGET_TMPDIR").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    let dir = base.join(format!("{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// A key-shaped canary that is never a real key: random enough to be unique in any file.
pub fn canary() -> String {
    let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
    let mut x = (t as u64) ^ ((std::process::id() as u64) << 32) ^ 0x9e37_79b9_7f4a_7c15;
    let mut tail = String::new();
    for _ in 0..32 {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        tail.push(b"abcdefghijklmnopqrstuvwxyz0123456789"[(x % 36) as usize] as char);
    }
    format!("sk-ant-api03-CANARY{tail}x7Qa")
}

pub struct Ca {
    pub pem: String,
    pub server: Arc<ServerConfig>,
}

pub fn ca() -> Ca {
    ca_for("api.anthropic.com")
}

/// A throwaway CA and a leaf for `host`.
pub fn ca_for(host: &str) -> Ca {
    let mut params = CertificateParams::new(Vec::<String>::new()).unwrap();
    params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    params.distinguished_name.push(DnType::CommonName, "talk-key test CA");
    params.key_usages = vec![KeyUsagePurpose::KeyCertSign, KeyUsagePurpose::DigitalSignature];
    let issuer = CertifiedIssuer::self_signed(params, KeyPair::generate().unwrap()).unwrap();
    let leaf_key = KeyPair::generate().unwrap();
    let leaf = CertificateParams::new(vec![host.to_string()]).unwrap().signed_by(&leaf_key, &*issuer).unwrap();
    let key = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(leaf_key.serialize_der()));
    let server = ServerConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_no_client_auth()
        .with_single_cert(vec![leaf.der().clone(), issuer.der().clone()], key)
        .unwrap();
    Ca { pem: issuer.pem(), server: Arc::new(server) }
}

#[derive(Clone, Debug, Default)]
pub struct Seen {
    pub method: String,
    pub path: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Seen {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(n, _)| n == name).map(|(_, v)| v.as_str())
    }
    pub fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap_or(Value::Null)
    }
}

pub type Answer = (u16, Vec<(String, String)>, String);
pub type Handler = Arc<dyn Fn(&Seen) -> Answer + Send + Sync>;

pub fn reply(text: &str) -> Handler {
    let body = serde_json::json!({
        "id": "msg_test", "type": "message", "role": "assistant", "model": "claude-haiku-5-5",
        "content": [{"type": "text", "text": text}], "stop_reason": "end_turn",
        "usage": {"input_tokens": 21, "output_tokens": 4}
    })
    .to_string();
    Arc::new(move |s: &Seen| {
        if s.method == "GET" { (200, vec![], r#"{"id":"claude-haiku-5-5","type":"model"}"#.into()) } else { (200, vec![], body.clone()) }
    })
}

pub fn status(code: u16, headers: &[(&str, &str)], body: &str) -> Handler {
    let headers: Vec<(String, String)> = headers.iter().map(|(a, b)| (a.to_string(), b.to_string())).collect();
    let body = body.to_string();
    Arc::new(move |_| (code, headers.clone(), body.clone()))
}

#[derive(Clone)]
pub struct Server {
    pub addr: SocketAddr,
    pub seen: Arc<Mutex<Vec<Seen>>>,
    pub connections: Arc<AtomicUsize>,
    pub handshakes: Arc<AtomicUsize>,
    /// CONNECT targets, proxy mode only.
    pub connects: Arc<Mutex<Vec<String>>>,
    /// Every byte the client sent, before any decryption.
    pub wire: Arc<Mutex<Vec<u8>>>,
    pub handler: Arc<Mutex<Handler>>,
}

impl Server {
    pub fn seen(&self) -> Vec<Seen> {
        self.seen.lock().unwrap().clone()
    }
    pub fn set(&self, h: Handler) {
        *self.handler.lock().unwrap() = h;
    }
    pub fn endpoint(&self) -> String {
        self.addr.to_string()
    }
    pub fn proxy_url(&self) -> String {
        format!("http://{}", self.addr)
    }
}

struct Tee {
    sock: TcpStream,
    wire: Arc<Mutex<Vec<u8>>>,
}

impl Read for Tee {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = self.sock.read(buf)?;
        self.wire.lock().unwrap().extend_from_slice(&buf[..n]);
        Ok(n)
    }
}

impl Write for Tee {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.sock.write(buf)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.sock.flush()
    }
}

/// Starts a TLS server on 127.0.0.1. With `proxy`, each connection first answers a CONNECT
/// and then does TLS itself, as a hostile or inspecting proxy would.
pub fn serve(config: Arc<ServerConfig>, handler: Handler, proxy: bool) -> Server {
    serve_with(Some(config), handler, proxy)
}

/// A plain HTTP stand-in on 127.0.0.1, for a gateway at `http://127.0.0.1:<port>`.
pub fn serve_plain(handler: Handler) -> Server {
    serve_with(None, handler, false)
}

fn serve_with(config: Option<Arc<ServerConfig>>, handler: Handler, proxy: bool) -> Server {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let server = Server {
        addr: listener.local_addr().unwrap(),
        seen: Arc::default(),
        connections: Arc::default(),
        handshakes: Arc::default(),
        connects: Arc::default(),
        wire: Arc::default(),
        handler: Arc::new(Mutex::new(handler)),
    };
    let s = server.clone();
    std::thread::spawn(move || {
        for sock in listener.incoming().flatten() {
            let s = s.clone();
            let config = config.clone();
            std::thread::spawn(move || handle(sock, config, s, proxy));
        }
    });
    server
}

fn handle(mut sock: TcpStream, config: Option<Arc<ServerConfig>>, s: Server, proxy: bool) {
    s.connections.fetch_add(1, Ordering::SeqCst);
    let _ = sock.set_read_timeout(Some(Duration::from_secs(10)));
    if proxy {
        let mut head = Vec::new();
        let mut b = [0u8; 1];
        while !head.ends_with(b"\r\n\r\n") {
            match sock.read(&mut b) {
                Ok(1) => head.push(b[0]),
                _ => return,
            }
        }
        let line = String::from_utf8_lossy(&head).lines().next().unwrap_or("").to_string();
        s.connects.lock().unwrap().push(line.split_whitespace().nth(1).unwrap_or("").to_string());
        let _ = sock.write_all(b"HTTP/1.1 200 Connection established\r\n\r\n");
    }
    let tee = Tee { sock, wire: s.wire.clone() };
    match config {
        Some(config) => {
            let mut tls = StreamOwned::new(ServerConnection::new(config).unwrap(), tee);
            answer(&mut tls, &s);
            tls.conn.send_close_notify();
            let _ = tls.flush();
        }
        None => {
            let mut plain = tee;
            answer(&mut plain, &s);
        }
    }
}

/// Reads one request and writes the handler's answer, over TLS or plain TCP.
fn answer<S: Read + Write>(tls: &mut S, s: &Server) {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 8192];
    let head_end = loop {
        if let Some(p) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break p + 4;
        }
        match tls.read(&mut chunk) {
            Ok(0) | Err(_) => return,
            Ok(n) => {
                if buf.is_empty() {
                    s.handshakes.fetch_add(1, Ordering::SeqCst);
                }
                buf.extend_from_slice(&chunk[..n]);
            }
        }
    };
    let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
    let mut lines = head.split("\r\n");
    let mut first = lines.next().unwrap_or("").split_whitespace();
    let mut seen = Seen {
        method: first.next().unwrap_or("").into(),
        path: first.next().unwrap_or("").into(),
        ..Default::default()
    };
    for l in lines {
        if let Some((n, v)) = l.split_once(':') {
            seen.headers.push((n.trim().to_ascii_lowercase(), v.trim().to_string()));
        }
    }
    let len: usize = seen.header("content-length").and_then(|v| v.parse().ok()).unwrap_or(0);
    let mut body = buf.split_off(head_end);
    while body.len() < len {
        match tls.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(n) => body.extend_from_slice(&chunk[..n]),
        }
    }
    seen.body = body;
    let handler = s.handler.lock().unwrap().clone();
    let (code, headers, text) = handler(&seen);
    s.seen.lock().unwrap().push(seen);
    // Status 0: write `text` as the whole answer, for malformed replies.
    if code == 0 {
        let _ = tls.write_all(text.as_bytes());
        let _ = tls.flush();
        std::thread::sleep(Duration::from_millis(300));
        return;
    }
    let mut out = format!("HTTP/1.1 {code} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\n", text.len());
    for (n, v) in headers {
        out.push_str(&format!("{n}: {v}\r\n"));
    }
    out.push_str("connection: close\r\n\r\n");
    out.push_str(&text);
    let _ = tls.write_all(out.as_bytes());
    let _ = tls.flush();
}

pub struct Run {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
    pub json: Value,
    /// What the terminal showed, for the TTY runs.
    pub terminal: Vec<u8>,
}

/// Whether this machine can give a test its own mount namespace, and why not. The tests that
/// need one skip with that reason instead of failing (macOS, containers without CAP_SYS_ADMIN).
#[cfg(unix)]
pub fn namespaces() -> Result<(), String> {
    let mut c = Command::new("/usr/bin/unshare");
    if unsafe { libc::geteuid() } != 0 {
        c.arg("-r");
    }
    match c.args(["-m", "/bin/true"]).stdout(Stdio::null()).stderr(Stdio::piped()).output() {
        Ok(out) if out.status.success() => Ok(()),
        Ok(out) => Err(format!("unshare -m is refused here: {}", String::from_utf8_lossy(&out.stderr).trim())),
        Err(e) => Err(format!("unshare is missing: {e}")),
    }
}

/// Prints the skip line the runner reports, and says whether to go on.
#[cfg(unix)]
pub fn needs_namespaces(test: &str) -> bool {
    match namespaces() {
        Ok(()) => true,
        Err(why) => {
            eprintln!("SKIPPED {test}: {why}");
            false
        }
    }
}

/// The account database's home for uid 0, which is the uid talk-key sees inside `unshare`.
#[cfg(unix)]
fn root_home() -> String {
    let pw = unsafe { libc::getpwuid(0) };
    assert!(!pw.is_null());
    unsafe { std::ffi::CStr::from_ptr((*pw).pw_dir) }.to_string_lossy().into_owned()
}

fn base(args: &[&str], env: &[(&str, String)]) -> Command {
    base_with(args, env, false)
}

/// With `isolate`, the binary runs in its own mount namespace with a tmpfs over the home it
/// reads from the account database, so a build without the seams never writes the real home.
fn base_with(args: &[&str], env: &[(&str, String)], isolate: bool) -> Command {
    let mut c = if isolate {
        #[cfg(unix)]
        {
            let mut c = Command::new("/usr/bin/unshare");
            if unsafe { libc::geteuid() } != 0 {
                c.arg("-r");
            }
            c.args(["-m", "/bin/sh", "-c", r#"mount -t tmpfs tmpfs "$1" && shift && exec "$@""#, "sh"]).arg(root_home()).arg(bin());
            c
        }
        #[cfg(not(unix))]
        unreachable!()
    } else {
        Command::new(bin())
    };
    c.args(args).env_clear().env("PATH", "/usr/bin:/bin").env("TZ", "UTC");
    for (k, v) in env {
        c.env(k, v);
    }
    c
}

fn finish(out: std::process::Output, terminal: Vec<u8>) -> Run {
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    let json = stdout.lines().last().and_then(|l| serde_json::from_str(l).ok()).unwrap_or(Value::Null);
    Run { code: out.status.code().unwrap_or(-1), stdout, stderr: String::from_utf8_lossy(&out.stderr).to_string(), json, terminal }
}

pub fn run(args: &[&str], env: &[(&str, String)], stdin: Option<&[u8]>) -> Run {
    let mut child = base(args, env)
        .stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    if let Some(data) = stdin {
        let mut pipe = child.stdin.take().unwrap();
        let data = data.to_vec();
        std::thread::spawn(move || {
            let _ = pipe.write_all(&data);
        });
    }
    finish(child.wait_with_output().unwrap(), Vec::new())
}

/// Runs with stdin on a pseudo-terminal and types `line` once the prompt shows.
#[cfg(unix)]
pub fn run_tty(args: &[&str], env: &[(&str, String)], line: &str) -> Run {
    run_tty_with(args, env, line, false, &mut |_| {})
}

/// As `run_tty`; `inspect` gets the pid while the program waits at its prompt.
#[cfg(unix)]
pub fn run_tty_with(args: &[&str], env: &[(&str, String)], line: &str, isolate: bool, inspect: &mut dyn FnMut(u32)) -> Run {
    let (mut master, mut slave) = (0, 0);
    // macOS declares termios and winsize *mut, glibc *const; a null *mut coerces to either.
    let rc = unsafe { libc::openpty(&mut master, &mut slave, std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut()) };
    assert_eq!(rc, 0, "openpty");
    let slave = unsafe { OwnedFd::from_raw_fd(slave) };
    let mut master = unsafe { std::fs::File::from_raw_fd(master) };
    let mut child =
        base_with(args, env, isolate).stdin(Stdio::from(slave)).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
    let mut stderr = child.stderr.take().unwrap();
    let mut err = Vec::new();
    let mut b = [0u8; 1];
    while !String::from_utf8_lossy(&err).contains(PROMPT) {
        match stderr.read(&mut b) {
            Ok(1) => err.push(b[0]),
            _ => break,
        }
    }
    inspect(child.id());
    master.write_all(format!("{line}\n").as_bytes()).unwrap();
    let reader = std::thread::spawn(move || {
        let mut rest = Vec::new();
        let _ = stderr.read_to_end(&mut rest);
        rest
    });
    let out = child.wait_with_output().unwrap();
    err.extend(reader.join().unwrap());
    let fd = std::os::fd::AsRawFd::as_raw_fd(&master);
    unsafe { libc::fcntl(fd, libc::F_SETFL, libc::fcntl(fd, libc::F_GETFL) | libc::O_NONBLOCK) };
    let mut terminal = Vec::new();
    let mut chunk = [0u8; 4096];
    while let Ok(n) = master.read(&mut chunk) {
        if n == 0 {
            break;
        }
        terminal.extend_from_slice(&chunk[..n]);
    }
    let mut r = finish(out, terminal);
    r.stderr = String::from_utf8_lossy(&err).to_string();
    r
}

/// Every file under `dir` whose bytes contain `needle`.
pub fn files_containing(dir: &Path, needle: &str) -> Vec<PathBuf> {
    let mut hits = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&d) else { continue };
        for e in entries.flatten() {
            let p = e.path();
            if p.is_dir() {
                stack.push(p);
            } else if std::fs::read(&p).map(|b| b.windows(needle.len()).any(|w| w == needle.as_bytes())).unwrap_or(false) {
                hits.push(p);
            }
        }
    }
    hits
}

pub fn contains(hay: &[u8], needle: &str) -> bool {
    hay.windows(needle.len()).any(|w| w == needle.as_bytes())
}

#[cfg(unix)]
pub fn write_exec(path: &Path, text: &str) {
    use std::os::unix::fs::PermissionsExt;
    std::fs::write(path, text).unwrap();
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
}

/// A stand-in secret-tool that logs its argv and environment and keeps the secret in a file
/// beside itself, so a test can see what reached it and how.
#[cfg(unix)]
pub fn fake_secret_tool(dir: &Path) -> PathBuf {
    let p = dir.join("secret-tool");
    write_exec(
        &p,
        r#"#!/bin/sh
d=$(dirname "$0")
printf '%s\n' "$*" >> "$d/argv.log"
env >> "$d/env.log"
if [ -f "$d/nobus" ]; then echo "secret-tool: Cannot autolaunch D-Bus without X11 \$DISPLAY" >&2; exit 1; fi
case "$1" in
  store) cat > "$d/keyring.bin" ;;
  lookup) if [ -f "$d/keyring.bin" ]; then cat "$d/keyring.bin"; else exit 1; fi ;;
  clear) rm -f "$d/keyring.bin" ;;
esac
"#,
    );
    p
}

pub fn send_input(text: &str) -> Vec<u8> {
    serde_json::json!({"system": "You are Coco.", "messages": [{"role": "user", "content": text}], "max_tokens": 200})
        .to_string()
        .into_bytes()
}

/// A proxy that reads the CONNECT and then answers one byte a second.
pub fn slow_proxy() -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    std::thread::spawn(move || {
        for mut sock in listener.incoming().flatten() {
            std::thread::spawn(move || {
                let mut head = Vec::new();
                let mut b = [0u8; 1];
                while !head.ends_with(b"\r\n\r\n") {
                    match sock.read(&mut b) {
                        Ok(1) => head.push(b[0]),
                        _ => return,
                    }
                }
                for byte in b"HTTP/1.1 200 Connection established\r\n\r\n" {
                    if sock.write_all(&[*byte]).is_err() {
                        return;
                    }
                    std::thread::sleep(Duration::from_secs(1));
                }
            });
        }
    });
    addr
}

/// A server that accepts and then sends one byte a second, never a whole TLS record.
pub fn dribbler() -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    std::thread::spawn(move || {
        for mut sock in listener.incoming().flatten() {
            std::thread::spawn(move || {
                for _ in 0..30 {
                    if sock.write_all(&[0x16]).is_err() {
                        return;
                    }
                    std::thread::sleep(Duration::from_secs(1));
                }
            });
        }
    });
    addr
}
