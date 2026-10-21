use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
pub const PRESENCE_LIMIT: usize = 256 * 1024;
pub const REQUEST_LIMIT: usize = 8192;
pub const REQUEST_LIFETIME: f64 = 60_000.0;
pub fn sleep_after(quiet_at: f64) -> f64 {
    let stamp = quiet_at as u64;
    let mut hash = (stamp as u32) ^ ((stamp >> 32) as u32);
    hash = (hash ^ (hash >> 16)).wrapping_mul(0x85ebca6b);
    hash = (hash ^ (hash >> 13)).wrapping_mul(0xc2b2ae35);
    hash ^= hash >> 16;
    (240_000 + (hash as u64) * 120_000 / 0x1_0000_0000) as f64
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Size {
    /// Requests from before 10-19 may still name «tiny» or «small»; the pet reads them as Medium.
    Tiny,
    Small,
    Medium,
    Large,
    Larger,
}
impl Size {
    pub fn height(self) -> u32 {
        match self {
            Self::Tiny | Self::Small | Self::Medium => 128,
            Self::Large => 186,
            Self::Larger => 256,
        }
    }
    pub fn font_size(self) -> f64 {
        match self {
            Self::Tiny | Self::Small | Self::Medium => 17.0,
            Self::Large => 19.0,
            Self::Larger => 21.0,
        }
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SizePick {
    pub to: Size,
    pub at: f64,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LoginPick {
    pub on: bool,
    pub at: f64,
}
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Requests {
    pub follow: f64,
    pub settings: f64,
    pub size: Option<SizePick>,
    pub login: Option<LoginPick>,
    /// Whether screenshots, recordings and shared screens show the pet, in the login switch's shape (owner 10-20).
    pub capture: Option<LoginPick>,
}
impl Requests {
    pub fn from_value(v: &Value) -> Self {
        let stamp = |key: &str| {
            v.get(key)
                .and_then(Value::as_f64)
                .filter(|n| n.is_finite() && *n > 0.0)
                .unwrap_or(0.0)
        };
        let size = v
            .get("size")
            .and_then(|s| serde_json::from_value::<SizePick>(s.clone()).ok())
            .filter(|s| s.at.is_finite() && s.at > 0.0);
        let login = v
            .get("login")
            .and_then(|s| serde_json::from_value::<LoginPick>(s.clone()).ok())
            .filter(|s| s.at.is_finite() && s.at > 0.0);
        let capture = v
            .get("capture")
            .and_then(|s| serde_json::from_value::<LoginPick>(s.clone()).ok())
            .filter(|s| s.at.is_finite() && s.at > 0.0);
        Self {
            follow: stamp("follow"),
            settings: stamp("settings"),
            size,
            login,
            capture,
        }
    }
    pub fn merge(&mut self, other: &Self) {
        self.follow = self.follow.max(other.follow);
        self.settings = self.settings.max(other.settings);
        if other.size.as_ref().map(|s| s.at).unwrap_or(0.0)
            > self.size.as_ref().map(|s| s.at).unwrap_or(0.0)
        {
            self.size = other.size.clone()
        }
        if other.login.as_ref().map(|s| s.at).unwrap_or(0.0)
            > self.login.as_ref().map(|s| s.at).unwrap_or(0.0)
        {
            self.login = other.login.clone()
        }
        if other.capture.as_ref().map(|s| s.at).unwrap_or(0.0)
            > self.capture.as_ref().map(|s| s.at).unwrap_or(0.0)
        {
            self.capture = other.capture.clone()
        }
    }
    pub fn wants(at: f64, answered: f64, launch: bool, now: f64) -> bool {
        at.is_finite()
            && at > 0.0
            && at > answered
            && (!launch || (0.0..=15_000.0).contains(&(now - at)))
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RequestKind {
    Submit,
    Seen,
    /// The person's message in the pet's DM window: it goes into the plugin's DM thread (channel.ts).
    Dm,
    /// The DM thread was read in the pet's DM window.
    #[serde(rename = "dmSeen")]
    DmSeen,
}
impl RequestKind {
    /// The kinds that carry the person's text.
    pub fn written(self) -> bool {
        matches!(self, Self::Submit | Self::Dm)
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ChannelRequest {
    pub v: u32,
    pub id: String,
    pub session: String,
    pub at: f64,
    pub kind: RequestKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upto: Option<f64>,
}
impl ChannelRequest {
    pub fn new(
        id: String,
        session: String,
        at: f64,
        kind: RequestKind,
        text: Option<&str>,
        upto: Option<f64>,
    ) -> Result<Self, &'static str> {
        let text = if kind.written() {
            text.map(|s| s.trim().to_owned())
        } else {
            None
        };
        let request = Self {
            v: 1,
            id,
            session,
            at,
            kind,
            text,
            upto: if kind == RequestKind::Seen {
                upto
            } else {
                None
            },
        };
        if !request.valid() {
            return Err("invalid request");
        };
        request.line()?;
        Ok(request)
    }
    pub fn valid(&self) -> bool {
        self.v == 1
            && (16..=32).contains(&self.id.len())
            && self.id.bytes().all(|c| c.is_ascii_hexdigit())
            && !self.session.is_empty()
            && self.session.len() <= 256
            && self.at.is_finite()
            && self.at > 0.0
            && (!self.kind.written()
                || self.text.as_ref().is_some_and(|s| {
                    (1..=4000).contains(&s.trim().chars().count()) && !s.contains('\0')
                }))
            && (self.kind != RequestKind::Seen
                || self.upto.is_some_and(|n| n.is_finite() && n >= 0.0))
    }
    pub fn parse(line: &[u8]) -> Option<Self> {
        if line.len() > REQUEST_LIMIT {
            return None;
        };
        let r: Self = serde_json::from_slice(line).ok()?;
        r.valid().then_some(r)
    }
    pub fn line(&self) -> Result<Vec<u8>, &'static str> {
        if !self.valid() {
            return Err("invalid request");
        };
        let mut bytes = serde_json::to_vec(self).map_err(|_| "invalid request")?;
        bytes.push(b'\n');
        if bytes.len() > REQUEST_LIMIT {
            return Err("invalid request");
        };
        Ok(bytes)
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RequestDecision {
    Sending,
    Acknowledged,
    Unconfirmed,
    Expired,
}
pub fn request_decision(
    request: &ChannelRequest,
    attempted_at: f64,
    ack: Option<&str>,
    now: f64,
) -> RequestDecision {
    if ack == Some(request.id.as_str()) {
        RequestDecision::Acknowledged
    } else if (now - request.at).abs() > REQUEST_LIFETIME {
        RequestDecision::Expired
    } else if now - attempted_at >= 5000.0 {
        RequestDecision::Unconfirmed
    } else {
        RequestDecision::Sending
    }
}
/// Redaction preserves byte positions for existing event readers.
pub struct RequestLog {
    pub path: PathBuf,
    outstanding: BTreeMap<String, ChannelRequest>,
    offsets: BTreeMap<String, Vec<(u64, usize)>>,
}
impl RequestLog {
    pub fn open(folder: &Path, now: f64) -> std::io::Result<Self> {
        if !now.is_finite() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "invalid clock",
            ));
        }
        std::fs::create_dir_all(folder)?;
        if !std::fs::symlink_metadata(folder)?.file_type().is_dir() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "not a companion directory",
            ));
        }
        let path = folder.join("requests.jsonl");
        let mut options = std::fs::OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options
                .mode(0o600)
                .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            options.custom_flags(0x0020_0000);
        }
        let mut file = options.open(&path)?;
        ensure_regular_handle(&file)?;
        if !std::fs::symlink_metadata(&path)?.file_type().is_file()
            || !file.metadata()?.file_type().is_file()
        {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "not a regular request log",
            ));
        }
        options.write(false).create(false);
        let mut reader = options.open(&path)?;
        ensure_regular_handle(&reader)?;
        let mut log = Self {
            path,
            outstanding: BTreeMap::new(),
            offsets: BTreeMap::new(),
        };
        let mut start = 0u64;
        let mut end = 0u64;
        let mut line = Vec::with_capacity(REQUEST_LIMIT);
        let mut oversized = false;
        let mut buffer = [0u8; 16 * 1024];
        loop {
            let count = reader.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            for byte in &buffer[..count] {
                if *byte == b'\n' {
                    let parsed = if oversized {
                        None
                    } else {
                        ChannelRequest::parse(&line)
                            .filter(|r| (now - r.at).abs() <= REQUEST_LIFETIME)
                    };
                    if let Some(request) = parsed {
                        log.offsets
                            .entry(request.id.clone())
                            .or_default()
                            .push((start, (end - start) as usize));
                        log.outstanding.insert(request.id.clone(), request);
                    } else {
                        redact(&mut file, start, (end - start) as usize)?;
                    }
                    start = end + 1;
                    line.clear();
                    oversized = false;
                } else if !oversized {
                    if line.len() < REQUEST_LIMIT {
                        line.push(*byte)
                    } else {
                        line.clear();
                        oversized = true
                    }
                }
                end += 1;
            }
        }
        if start < end {
            redact(&mut file, start, (end - start) as usize)?;
            file.seek(SeekFrom::End(0))?;
            file.write_all(b"\n")?;
        }
        Ok(log)
    }
    pub fn append(&mut self, request: ChannelRequest, now: f64) -> std::io::Result<()> {
        self.cleanup(now)?;
        let bytes = request
            .line()
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidInput, e))?;
        let mut file = open_request_file(&self.path, true)?;
        let start = file.metadata()?.len();
        file.write_all(&bytes)?;
        self.offsets
            .entry(request.id.clone())
            .or_default()
            .push((start, bytes.len() - 1));
        self.outstanding.insert(request.id.clone(), request);
        Ok(())
    }
    pub fn acknowledge(&mut self, id: &str) -> std::io::Result<bool> {
        if !self.outstanding.contains_key(id) {
            return Ok(false);
        }
        let mut file = open_request_file(&self.path, false)?;
        for (offset, len) in self.offsets.get(id).into_iter().flatten() {
            redact(&mut file, *offset, *len)?;
        }
        self.offsets.remove(id);
        self.outstanding.remove(id);
        Ok(true)
    }
    pub fn cleanup(&mut self, now: f64) -> std::io::Result<usize> {
        if !now.is_finite() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "invalid clock",
            ));
        }
        let ids: Vec<String> = self
            .outstanding
            .values()
            .filter(|r| (now - r.at).abs() > REQUEST_LIFETIME)
            .map(|r| r.id.clone())
            .collect();
        for id in &ids {
            self.acknowledge(id)?;
        }
        Ok(ids.len())
    }
    pub fn next_expiry(&self) -> Option<f64> {
        self.outstanding
            .values()
            .map(|r| r.at + REQUEST_LIFETIME + 1.0)
            .min_by(f64::total_cmp)
    }
    pub fn outstanding(
        &self,
        session: &str,
        kind: RequestKind,
        text: Option<&str>,
    ) -> Option<&ChannelRequest> {
        self.outstanding
            .values()
            .filter(|r| {
                r.session == session
                    && r.kind == kind
                    && (!kind.written() || r.text.as_deref() == text.map(str::trim))
            })
            .max_by(|a, b| a.at.total_cmp(&b.at))
    }
    pub fn retry(&mut self, request: &ChannelRequest, now: f64) -> std::io::Result<()> {
        if (now - request.at).abs() > REQUEST_LIFETIME
            || self.outstanding.get(&request.id) != Some(request)
        {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "request not outstanding",
            ));
        };
        self.append(request.clone(), now)
    }
}
fn open_request_file(path: &Path, append: bool) -> std::io::Result<std::fs::File> {
    if !std::fs::symlink_metadata(path)?.file_type().is_file() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "not a regular request log",
        ));
    }
    let mut options = std::fs::OpenOptions::new();
    options.write(true).append(append);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x0020_0000);
    }
    let file = options.open(path)?;
    ensure_regular_handle(&file)?;
    if !file.metadata()?.file_type().is_file() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "not a regular request log",
        ));
    }
    Ok(file)
}
#[cfg(windows)]
pub(crate) fn ensure_regular_handle(file: &std::fs::File) -> std::io::Result<()> {
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::{
        Foundation::HANDLE,
        Storage::FileSystem::{
            GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION, FILE_ATTRIBUTE_DIRECTORY,
            FILE_ATTRIBUTE_REPARSE_POINT,
        },
    };
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    unsafe { GetFileInformationByHandle(HANDLE(file.as_raw_handle()), &mut info) }.map_err(
        |_| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "invalid companion file handle",
            )
        },
    )?;
    if info.dwFileAttributes & (FILE_ATTRIBUTE_REPARSE_POINT.0 | FILE_ATTRIBUTE_DIRECTORY.0) != 0 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "not a regular companion file",
        ));
    }
    Ok(())
}
#[cfg(not(windows))]
pub(crate) fn ensure_regular_handle(file: &std::fs::File) -> std::io::Result<()> {
    if file.metadata()?.is_file() {
        Ok(())
    } else {
        Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "not a regular companion file",
        ))
    }
}
fn redact(file: &mut std::fs::File, offset: u64, len: usize) -> std::io::Result<()> {
    file.seek(SeekFrom::Start(offset))?;
    let spaces = [b' '; 16 * 1024];
    let mut left = len;
    while left > 0 {
        let count = left.min(spaces.len());
        file.write_all(&spaces[..count])?;
        left -= count;
    }
    Ok(())
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PresenceEvent {
    pub kind: String,
    pub id: String,
    pub at: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lang: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresenceSnapshot {
    pub v: u32,
    pub seq: u64,
    pub quiet_at: f64,
    pub asleep: bool,
    pub clingy: bool,
    pub busy: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lang: Option<String>,
    pub event: PresenceEvent,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sleep_event: Option<PresenceEvent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wake_event: Option<PresenceEvent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub clingy_event: Option<PresenceEvent>,
    #[serde(default)]
    pub claims: BTreeMap<String, PresenceClaim>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresenceClaim {
    pub session: String,
    pub owner: String,
    pub pid: u32,
    pub birth: String,
    pub busy: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host_pid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host_birth: Option<String>,
}
fn epoch(n: f64) -> bool {
    n.is_finite() && (0.0..=8.64e15).contains(&n)
}
impl PresenceEvent {
    fn valid(&self) -> bool {
        let parts: Vec<&str> = self.id.split(':').collect();
        ["initial", "activity", "expired", "sleep", "wake", "clingy"].contains(&self.kind.as_str())
            && self.id.len() <= 96
            && parts.len() == 3
            && parts[0].bytes().all(|c| c.is_ascii_lowercase())
            && parts[1..]
                .iter()
                .all(|s| !s.is_empty() && s.bytes().all(|c| c.is_ascii_digit()))
            && epoch(self.at)
            && self
                .lang
                .as_ref()
                .is_none_or(|s| crate::languages::is_supported(s))
    }
}
impl PresenceSnapshot {
    pub fn parse(bytes: &[u8]) -> Option<Self> {
        if bytes.len() > PRESENCE_LIMIT {
            return None;
        };
        let snapshot: Self = serde_json::from_slice(bytes).ok()?;
        snapshot.valid().then_some(snapshot)
    }
    pub fn valid(&self) -> bool {
        self.v == 1
            && self.seq <= 9_007_199_254_740_991
            && epoch(self.quiet_at)
            && self.event.valid()
            && [&self.sleep_event, &self.wake_event, &self.clingy_event]
                .into_iter()
                .all(|e| e.as_ref().is_none_or(PresenceEvent::valid))
            && self
                .lang
                .as_ref()
                .is_none_or(|s| crate::languages::is_supported(s))
            && self.claims.len() <= 1024
            && self.claims.iter().all(|(key, c)| {
                key.len() <= 256
                    && c.pid > 0
                    && c.birth.len() <= 128
                    && c.session.len() <= 256
                    && (1..=64).contains(&c.owner.len())
                    && c.owner
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
                    && c.host_pid.is_none_or(|p| p > 0)
                    && c.host_birth.as_ref().is_none_or(|b| b.len() <= 128)
            })
    }
    pub fn initial(now: f64) -> Self {
        Self {
            v: 1,
            seq: 0,
            quiet_at: now,
            asleep: false,
            clingy: false,
            busy: false,
            lang: Some("en".into()),
            event: PresenceEvent {
                kind: "initial".into(),
                id: format!("initial:0:{}", now as u64),
                at: now,
                lang: Some("en".into()),
            },
            sleep_event: None,
            wake_event: None,
            clingy_event: None,
            claims: BTreeMap::new(),
        }
    }
    fn set_event(&mut self, kind: &str, at: f64) {
        let event = PresenceEvent {
            kind: kind.into(),
            id: format!("{}:{}:{}", kind, self.seq + 1, at as u64),
            at,
            lang: self.lang.clone(),
        };
        self.event = event.clone();
        match kind {
            "sleep" => self.sleep_event = Some(event),
            "wake" => self.wake_event = Some(event),
            "clingy" => self.clingy_event = Some(event),
            _ => (),
        }
    }
    pub fn deadlines(&self) -> (Option<f64>, Option<f64>) {
        if self.busy || self.asleep {
            (None, None)
        } else {
            (
                Some(self.quiet_at + sleep_after(self.quiet_at)),
                (!self.clingy).then_some(self.quiet_at + 150_000.0),
            )
        }
    }
    /// Kernel identity validation is supplied by the platform event layer.
    pub fn decide(&mut self, now: f64, alive: impl Fn(&PresenceClaim) -> bool) -> bool {
        let before = self.clone();
        let was_busy = self.claims.values().any(|c| c.busy);
        self.claims.retain(|_, c| alive(c));
        let busy = self.claims.values().any(|c| c.busy);
        if was_busy && !busy {
            self.quiet_at = now;
            self.clingy = false;
            self.set_event("expired", now)
        }
        self.busy = busy;
        if !busy {
            if !self.clingy && now - self.quiet_at >= 150_000.0 {
                self.clingy = true;
                self.set_event("clingy", self.quiet_at + 150_000.0)
            }
            let delay = sleep_after(self.quiet_at);
            if !self.asleep && now - self.quiet_at >= delay {
                self.asleep = true;
                self.set_event("sleep", self.quiet_at + delay)
            }
        }
        if *self != before || self.seq == 0 {
            self.seq += 1;
            true
        } else {
            false
        }
    }
    pub fn wake_on_touch(&mut self, now: f64) -> bool {
        let before = self.clone();
        let old = self.quiet_at;
        let now = now.max(old);
        self.quiet_at = now;
        self.clingy = false;
        if self.asleep {
            self.asleep = false;
            self.set_event("wake", now);
            self.event.id = format!("wake:0:{}", old as u64);
            self.event.lang = self
                .sleep_event
                .as_ref()
                .and_then(|e| e.lang.clone())
                .or(self.lang.clone());
            self.wake_event = Some(self.event.clone());
        } else {
            self.set_event("activity", now)
        }
        if *self != before {
            self.seq += 1;
            true
        } else {
            false
        }
    }
    pub fn line(&self) -> Result<Vec<u8>, serde_json::Error> {
        let mut line = serde_json::to_vec(self)?;
        line.push(b'\n');
        Ok(line)
    }
}
#[derive(Clone, Debug, PartialEq)]
pub struct Presence {
    pub seq: u64,
    pub asleep: bool,
    pub kind: String,
    pub event_id: String,
    pub at: f64,
    pub said: Option<String>,
}
impl Presence {
    pub fn from_value(v: &Value) -> Option<Self> {
        let seq = v.get("seq")?.as_f64()?;
        if !seq.is_finite() || seq < 0.0 || seq > 9_007_199_254_740_991.0 || seq.fract() != 0.0 {
            return None;
        };
        let asleep = v.get("asleep")?.as_bool()?;
        let event = v.get("event")?;
        let kind = event.get("kind")?.as_str()?;
        let event_id = event.get("id")?.as_str()?;
        let at = event.get("at")?.as_f64()?;
        if kind.is_empty()
            || kind.len() > 64
            || event_id.is_empty()
            || event_id.len() > 256
            || !epoch(at)
        {
            return None;
        };
        let said = v.get("said").and_then(Value::as_str).map(str::to_owned);
        if said.as_ref().is_some_and(|s| s.len() > 8192) {
            return None;
        };
        Some(Self {
            seq: seq as u64,
            asleep,
            kind: kind.into(),
            event_id: event_id.into(),
            at,
            said,
        })
    }
    pub fn value(&self) -> Value {
        json!({"seq":self.seq,"asleep":self.asleep,"event":{"kind":self.kind,"id":self.event_id,"at":self.at},"said":self.said})
    }
}
#[derive(Clone, Debug, Default)]
pub struct PresenceProjection {
    pub snapshot: Option<PresenceSnapshot>,
    lines: BTreeMap<String, BTreeMap<String, Vec<String>>>,
    affection: String,
}
impl PresenceProjection {
    pub fn recipes(&mut self, v: &Value) {
        if let Some(a) = v.get("affection").and_then(Value::as_str) {
            if ["warm", "clingy"].contains(&a) {
                self.affection = a.into()
            }
        }
        if let Some(languages) = v.get("lines").and_then(Value::as_object) {
            if languages.len() > 16 {
                return;
            }
            for (lang, keys) in languages {
                if lang.len() > 16 {
                    continue;
                }
                let Ok(keys) =
                    serde_json::from_value::<BTreeMap<String, Vec<String>>>(keys.clone())
                else {
                    continue;
                };
                if keys.len() <= 3
                    && keys.values().all(|v| {
                        !v.is_empty() && v.len() <= 128 && v.iter().all(|s| s.len() <= 8192)
                    })
                {
                    self.lines.insert(lang.clone(), keys);
                }
            }
        }
    }
    /// One line from his wake pool in `lang`, chosen by a seed (the nap's own, not a presence event).
    pub fn wake_line(&self, lang: &str, seed: &str) -> Option<String> {
        let choices = self
            .lines
            .get(lang)
            .and_then(|k| k.get("wake"))
            .or_else(|| self.lines.get("en").and_then(|k| k.get("wake")))?;
        if choices.is_empty() {
            return None;
        }
        let mut hash = 2_166_136_261u32;
        for unit in seed.encode_utf16() {
            hash = (hash ^ u32::from(unit)).wrapping_mul(16_777_619)
        }
        Some(choices[hash as usize % choices.len()].clone())
    }
    pub fn receive(&mut self, snapshot: PresenceSnapshot) -> bool {
        if !snapshot.valid()
            || self
                .snapshot
                .as_ref()
                .is_some_and(|old| snapshot.seq < old.seq)
        {
            return false;
        }
        self.snapshot = Some(snapshot);
        true
    }
    pub fn presence(&self, now: f64) -> Option<Presence> {
        let s = self.snapshot.as_ref()?;
        let wake = s
            .wake_event
            .as_ref()
            .or_else(|| (s.event.kind == "wake").then_some(&s.event));
        let event = if s.asleep {
            s.sleep_event.as_ref().unwrap_or(&s.event)
        } else if let Some(wake) = wake.filter(|e| now < e.at + 14_000.0) {
            wake
        } else if s.clingy {
            s.clingy_event.as_ref().unwrap_or(&s.event)
        } else {
            &s.event
        };
        let key = match event.kind.as_str() {
            "sleep" => "sleep",
            "wake" => "wake",
            "clingy" if self.affection == "clingy" => "idle",
            _ => "",
        };
        let lang = event.lang.as_deref().or(s.lang.as_deref()).unwrap_or("en");
        let choices = self
            .lines
            .get(lang)
            .and_then(|k| k.get(key))
            .or_else(|| self.lines.get("en").and_then(|k| k.get(key)));
        let said = if now >= event.at && now < event.at + 14_000.0 {
            choices.filter(|c| !c.is_empty()).map(|c| {
                let mut hash = 2_166_136_261u32;
                for unit in event.id.encode_utf16() {
                    hash = (hash ^ u32::from(unit)).wrapping_mul(16_777_619)
                }
                c[hash as usize % c.len()].clone()
            })
        } else {
            None
        };
        Some(Presence {
            seq: s.seq,
            asleep: s.asleep,
            kind: event.kind.clone(),
            event_id: event.id.clone(),
            at: event.at,
            said,
        })
    }
}
