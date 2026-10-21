use crate::{
    protocol::{PresenceClaim, PresenceSnapshot, PRESENCE_LIMIT},
    Error,
};
#[cfg(target_os = "linux")]
use std::collections::BTreeMap;
#[cfg(target_os = "linux")]
use std::os::fd::OwnedFd;
#[cfg(unix)]
use std::os::{fd::AsRawFd, unix::fs::OpenOptionsExt};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

pub struct PresenceStore {
    pub folder: PathBuf,
    pub snapshot: Option<PresenceSnapshot>,
    pending_touch: Option<u64>,
    pending_decision: bool,
    pending_line: Option<Vec<u8>>,
    #[cfg(target_os = "linux")]
    hosts: BTreeMap<u32, (String, OwnedFd)>,
    #[cfg(target_os = "linux")]
    boot: Option<String>,
    #[cfg(target_os = "linux")]
    lock_event: Option<std::sync::Arc<OwnedFd>>,
    #[cfg(target_os = "linux")]
    lock_wait: std::sync::Arc<std::sync::atomic::AtomicBool>,
    #[cfg(windows)]
    windows_events: Option<crate::platform::windows::presence_events::Events>,
    pub last_error: Option<String>,
}
impl PresenceStore {
    pub fn new(folder: PathBuf) -> Self {
        Self {
            folder,
            snapshot: None,
            pending_touch: None,
            pending_decision: false,
            pending_line: None,
            #[cfg(target_os = "linux")]
            hosts: BTreeMap::new(),
            #[cfg(target_os = "linux")]
            boot: None,
            #[cfg(target_os = "linux")]
            lock_event: None,
            #[cfg(target_os = "linux")]
            lock_wait: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
            #[cfg(windows)]
            windows_events: None,
            last_error: None,
        }
    }
    pub fn refresh(&mut self, now_ms: u64) -> Option<PresenceSnapshot> {
        #[cfg(any(target_os = "linux", windows))]
        {
            self.drain_lock_event();
        }
        if let Some(snapshot) = read_snapshot(&self.folder) {
            if self
                .snapshot
                .as_ref()
                .is_none_or(|old| snapshot.seq >= old.seq)
            {
                self.snapshot = Some(snapshot)
            }
        }
        #[cfg(any(target_os = "linux", windows))]
        {
            self.watch_claims();
        }
        let deadline = self.next_deadline().is_some_and(|at| at <= now_ms);
        if self.snapshot.is_none()
            || self.pending_touch.is_some()
            || self.pending_decision
            || self.pending_line.is_some()
            || deadline
        {
            match self.transact(now_ms) {
                Ok(s) => {
                    self.last_error = None;
                    if let Some(s) = s {
                        self.snapshot = Some(s)
                    }
                }
                Err(error) => self.last_error = Some(error.to_string()),
            }
        }
        #[cfg(any(target_os = "linux", windows))]
        {
            self.watch_claims();
        }
        self.apply_pending_wake();
        self.snapshot.clone()
    }
    fn apply_pending_wake(&mut self) {
        if let (Some(at), Some(snapshot)) = (self.pending_touch, self.snapshot.as_mut()) {
            if snapshot.asleep {
                let seq = snapshot.seq;
                snapshot.wake_on_touch(at as f64);
                snapshot.seq = seq;
            }
        }
    }
    pub fn touch(&mut self, now_ms: u64) -> Result<Option<PresenceSnapshot>, Error> {
        self.pending_touch = Some(self.pending_touch.unwrap_or(0).max(now_ms));
        if self.snapshot.is_none() {
            self.snapshot = read_snapshot(&self.folder)
        }
        let result = match self.transact(now_ms) {
            Ok(result) => result,
            Err(error) => {
                self.apply_pending_wake();
                return Err(error);
            }
        };
        if let Some(snapshot) = result {
            self.snapshot = Some(snapshot)
        }
        self.apply_pending_wake();
        #[cfg(any(target_os = "linux", windows))]
        {
            self.watch_claims();
        }
        Ok(self.snapshot.clone())
    }
    pub fn decide(&mut self, now_ms: u64) -> Result<Option<PresenceSnapshot>, Error> {
        self.pending_decision = true;
        #[cfg(any(target_os = "linux", windows))]
        {
            self.drain_lock_event();
        }
        let result = self.transact(now_ms)?;
        if let Some(snapshot) = result {
            self.snapshot = Some(snapshot)
        }
        #[cfg(any(target_os = "linux", windows))]
        {
            self.watch_claims();
        }
        Ok(self.snapshot.clone())
    }
    pub fn next_deadline(&self) -> Option<u64> {
        let s = self.snapshot.as_ref()?;
        let (sleep, clingy) = s.deadlines();
        [sleep, clingy]
            .into_iter()
            .flatten()
            .map(|d| d.ceil() as u64)
            .min()
    }
    #[cfg(target_os = "linux")]
    pub fn descriptors(&self) -> Vec<i32> {
        self.hosts
            .values()
            .map(|(_, fd)| fd.as_raw_fd())
            .chain(self.lock_event.iter().map(|fd| fd.as_raw_fd()))
            .collect()
    }
    fn transact(&mut self, now_ms: u64) -> Result<Option<PresenceSnapshot>, Error> {
        ensure_folder(&self.folder)?;
        #[cfg(unix)]
        let Some(_lock) = PresenceLock::acquire(&self.folder)?
        else {
            #[cfg(target_os = "linux")]
            {
                self.wait_for_lock()?;
            }
            return Ok(None);
        };
        #[cfg(windows)]
        let Some(_lock) = crate::platform::windows::acquire_presence_lock(&self.folder)?
        else {
            self.wait_for_lock()?;
            return Ok(None);
        };
        #[cfg(not(any(unix, windows)))]
        return Err("presence locking unsupported".into());
        let mut snapshot =
            read_snapshot(&self.folder).unwrap_or_else(|| PresenceSnapshot::initial(now_ms as f64));
        if let Some(bytes) = self.pending_line.take() {
            if snapshot.line()? == bytes {
                if let Err(error) = append_journal(&self.folder, &bytes) {
                    self.pending_line = Some(bytes);
                    return Err(error);
                }
            }
        }
        let old = snapshot.clone();
        let boot = self.boot_id();
        let mut modified =
            snapshot.decide(now_ms as f64, |claim| claim_alive(claim, boot.as_deref()));
        if let Some(at) = self.pending_touch {
            snapshot.seq = old.seq;
            modified = snapshot.wake_on_touch(at as f64) || modified;
        }
        // One transaction has one monotonically increasing sequence even when a touch and
        // a quiet deadline coincide. SharedPresence.reducePresence increments only once.
        if modified {
            snapshot.seq = old.seq + 1;
            let bytes = snapshot.line()?;
            if bytes.len() > PRESENCE_LIMIT {
                return Err("presence capacity".into());
            }
            crate::engine::atomic_write(&self.folder.join("snapshot.json"), &bytes)?;
            self.pending_line = Some(bytes.clone());
            self.pending_touch = None;
            append_journal(&self.folder, &bytes)?;
            self.pending_line = None;
        }
        self.pending_touch = None;
        self.pending_decision = false;
        Ok(Some(snapshot))
    }
    #[cfg(target_os = "linux")]
    fn drain_lock_event(&self) {
        if let Some(fd) = &self.lock_event {
            let mut value = 0u64;
            unsafe {
                libc::read(fd.as_raw_fd(), (&mut value as *mut u64).cast(), 8);
            }
        }
    }
    #[cfg(windows)]
    fn drain_lock_event(&mut self) {
        if let Some(events) = self.windows_events.as_mut() {
            events.drain();
        }
    }
    #[cfg(windows)]
    fn wait_for_lock(&mut self) -> Result<(), Error> {
        if self.windows_events.is_none() {
            self.windows_events = Some(crate::platform::windows::presence_events::Events::new()?);
        }
        self.windows_events
            .as_mut()
            .unwrap()
            .wait_lock(&self.folder)
    }
    #[cfg(windows)]
    pub fn windows_event_handle(&self) -> Option<usize> {
        self.windows_events.as_ref().map(|events| events.handle())
    }
    #[cfg(windows)]
    fn watch_claims(&mut self) {
        if self.windows_events.is_none() {
            match crate::platform::windows::presence_events::Events::new() {
                Ok(events) => self.windows_events = Some(events),
                Err(error) => {
                    self.last_error = Some(error.to_string());
                    return;
                }
            }
        }
        match self
            .windows_events
            .as_mut()
            .unwrap()
            .watch(self.snapshot.as_ref())
        {
            Ok(expired) => {
                self.pending_decision |= expired;
            }
            Err(error) => {
                self.last_error = Some(error.to_string());
            }
        }
    }
    #[cfg(target_os = "linux")]
    fn wait_for_lock(&mut self) -> Result<(), Error> {
        use std::os::fd::FromRawFd;
        use std::sync::atomic::Ordering;
        if self.lock_wait.swap(true, Ordering::AcqRel) {
            return Ok(());
        }
        if self.lock_event.is_none() {
            let fd = unsafe { libc::eventfd(0, libc::EFD_CLOEXEC | libc::EFD_NONBLOCK) };
            if fd < 0 {
                self.lock_wait.store(false, Ordering::Release);
                return Err(std::io::Error::last_os_error().into());
            }
            self.lock_event = Some(std::sync::Arc::new(unsafe { OwnedFd::from_raw_fd(fd) }));
        }
        let event = self.lock_event.as_ref().unwrap().clone();
        let waiting = self.lock_wait.clone();
        let path = self.folder.join(".presence-flock");
        let result = std::thread::Builder::new()
            .name("presence-lock".into())
            .stack_size(64 * 1024)
            .spawn(move || {
                if let Ok(file) = OpenOptions::new()
                    .read(true)
                    .write(true)
                    .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
                    .open(path)
                {
                    let mut acquired;
                    loop {
                        acquired = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) };
                        if acquired == 0
                            || std::io::Error::last_os_error().raw_os_error() != Some(libc::EINTR)
                        {
                            break;
                        }
                    }
                    if acquired == 0 {
                        unsafe {
                            libc::flock(file.as_raw_fd(), libc::LOCK_UN);
                        }
                    }
                }
                waiting.store(false, Ordering::Release);
                let ready = 1u64;
                unsafe {
                    libc::write(event.as_raw_fd(), (&ready as *const u64).cast(), 8);
                }
            });
        if let Err(error) = result {
            self.lock_wait.store(false, Ordering::Release);
            return Err(error.into());
        }
        Ok(())
    }
    fn boot_id(&mut self) -> Option<String> {
        #[cfg(target_os = "linux")]
        {
            if self.boot.is_none() {
                self.boot = read_kernel(Path::new("/proc/sys/kernel/random/boot_id"), 128)
                    .ok()
                    .and_then(|bytes| String::from_utf8(bytes).ok())
                    .map(|s| s.trim().into())
            }
            self.boot.clone()
        }
        #[cfg(not(target_os = "linux"))]
        {
            None
        }
    }
    #[cfg(target_os = "linux")]
    fn watch_claims(&mut self) {
        let boot = self.boot_id();
        let mut wanted = BTreeMap::new();
        let mut expired = false;
        if let Some(snapshot) = &self.snapshot {
            for claim in snapshot.claims.values() {
                if !claim_alive(claim, boot.as_deref()) {
                    expired = true;
                    continue;
                }
                wanted.insert(claim.pid, claim.birth.clone());
                if let (Some(pid), Some(birth)) = (claim.host_pid, &claim.host_birth) {
                    wanted.insert(pid, birth.clone());
                }
            }
        }
        self.hosts
            .retain(|pid, (birth, _)| wanted.get(pid) == Some(birth));
        for (pid, birth) in wanted {
            if self.hosts.contains_key(&pid) {
                continue;
            }
            let fd = unsafe { libc::syscall(libc::SYS_pidfd_open, pid, 0) } as i32;
            if fd >= 0 {
                use std::os::fd::FromRawFd;
                self.hosts
                    .insert(pid, (birth, unsafe { OwnedFd::from_raw_fd(fd) }));
            } else if std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH) {
                expired = true;
            } else {
                self.last_error = Some("pidfd process events unavailable".into());
            }
        }
        // The event loop calls decide for pidfd readability. Rechecking identities after
        // registration closes an exit/PID-reuse race without a recurring timer.
        if let Some(snapshot) = &self.snapshot {
            if snapshot
                .claims
                .values()
                .any(|c| !claim_alive(c, boot.as_deref()))
            {
                expired = true
            }
        }
        if expired {
            self.pending_decision = true;
        }
    }
}
fn append_journal(folder: &Path, bytes: &[u8]) -> Result<(), Error> {
    let path = folder.join("presence.jsonl");
    if fs::symlink_metadata(&path).is_ok_and(|m| !m.file_type().is_file()) {
        return Err("not a regular presence journal".into());
    }
    if fs::metadata(&path)
        .map(|m| m.len() as usize + bytes.len() > PRESENCE_LIMIT)
        .unwrap_or(false)
    {
        crate::engine::atomic_write(&path, bytes)?
    } else {
        let mut options = OpenOptions::new();
        options.append(true).create(true);
        #[cfg(unix)]
        {
            options
                .mode(0o600)
                .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            options.custom_flags(0x0020_0000);
        }
        let mut log = options.open(&path)?;
        crate::protocol::ensure_regular_handle(&log)?;
        if !log.metadata()?.is_file() {
            return Err("not a regular presence journal".into());
        }
        log.write_all(bytes)?;
    }
    Ok(())
}
fn ensure_folder(folder: &Path) -> Result<(), Error> {
    fs::create_dir_all(folder)?;
    if !fs::symlink_metadata(folder)?.file_type().is_dir() {
        return Err("not a companion presence directory".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(folder, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}
fn read_file(path: &Path, limit: usize) -> std::io::Result<Vec<u8>> {
    if !fs::symlink_metadata(path)?.file_type().is_file() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "not a regular presence file",
        ));
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x0020_0000);
    }
    let file = options.open(path)?;
    crate::protocol::ensure_regular_handle(&file)?;
    if !file.metadata()?.is_file() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "not a regular presence file",
        ));
    }
    let mut bytes = Vec::new();
    file.take(limit as u64 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > limit {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "presence exceeds limit",
        ));
    }
    Ok(bytes)
}
pub fn read_snapshot(folder: &Path) -> Option<PresenceSnapshot> {
    if let Some(snapshot) = read_file(&folder.join("snapshot.json"), PRESENCE_LIMIT)
        .ok()
        .and_then(|b| PresenceSnapshot::parse(&b))
    {
        return Some(snapshot);
    }
    let bytes = read_file(&folder.join("presence.jsonl"), PRESENCE_LIMIT).ok()?;
    bytes
        .split(|b| *b == b'\n')
        .rev()
        .find_map(PresenceSnapshot::parse)
}
#[cfg(unix)]
struct PresenceLock {
    fd: std::fs::File,
}
#[cfg(unix)]
impl PresenceLock {
    fn acquire(folder: &Path) -> Result<Option<Self>, Error> {
        let fd = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(folder.join(".presence-flock"))?;
        if !fd.metadata()?.is_file() {
            return Err("not a regular presence lock".into());
        }
        if unsafe { libc::flock(fd.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
            let error = std::io::Error::last_os_error();
            if error.kind() == std::io::ErrorKind::WouldBlock {
                return Ok(None);
            }
            return Err(error.into());
        }
        use std::os::unix::fs::FileExt;
        let lock = Self { fd };
        lock.fd.set_len(0)?;
        let owner = format!("{}\nnative\n", std::process::id());
        lock.fd.write_all_at(owner.as_bytes(), 0)?;
        Ok(Some(lock))
    }
}
#[cfg(unix)]
impl Drop for PresenceLock {
    fn drop(&mut self) {
        unsafe {
            libc::flock(self.fd.as_raw_fd(), libc::LOCK_UN);
            libc::futimens(self.fd.as_raw_fd(), std::ptr::null());
        }
    }
}
#[cfg(target_os = "linux")]
fn read_kernel(path: &Path, limit: usize) -> std::io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    std::fs::File::open(path)?
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > limit {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "kernel identity exceeds limit",
        ));
    }
    Ok(bytes)
}
#[cfg(target_os = "linux")]
fn process_identity(pid: u32, boot: &str) -> Option<(String, u32)> {
    let data = read_kernel(Path::new(&format!("/proc/{pid}/stat")), 8192).ok()?;
    let stat = std::str::from_utf8(&data).ok()?;
    let (first, _) = stat.split_once(' ')?;
    if first.parse::<u32>().ok()? != pid {
        return None;
    }
    let end = stat.rfind(')')?;
    let fields: Vec<&str> = stat[end + 1..].split_whitespace().collect();
    if fields.len() < 20 || ["Z", "X", "x"].contains(&fields[0]) {
        return None;
    }
    let parent = fields[1].parse::<u32>().ok()?;
    let start = fields[19].parse::<u64>().ok()?;
    Some((format!("linux:{boot}:{start}"), parent))
}
#[cfg(target_os = "linux")]
fn claim_alive(claim: &PresenceClaim, boot: Option<&str>) -> bool {
    let Some(boot) = boot else { return false };
    let Some((birth, parent)) = process_identity(claim.pid, boot) else {
        return false;
    };
    if birth != claim.birth {
        return false;
    }
    if let Some(host) = claim.host_pid {
        if parent != host
            || process_identity(host, boot).map(|v| v.0).as_ref() != claim.host_birth.as_ref()
        {
            return false;
        }
    }
    let Some(args) = read_kernel(
        Path::new(&format!("/proc/{}/cmdline", claim.pid)),
        1024 * 1024,
    )
    .ok() else {
        return false;
    };
    let marker = format!("/.presence-follow-{}.jsonl", claim.owner);
    if !args
        .split(|b| *b == 0)
        .any(|arg| arg.ends_with(marker.as_bytes()))
    {
        return false;
    }
    process_identity(claim.pid, boot).is_some_and(|(verify, p)| verify == birth && p == parent)
}
#[cfg(windows)]
fn claim_alive(claim: &PresenceClaim, _boot: Option<&str>) -> bool {
    crate::platform::windows::presence_events::claim_alive(claim)
}
#[cfg(not(any(target_os = "linux", windows)))]
fn claim_alive(_claim: &PresenceClaim, _boot: Option<&str>) -> bool {
    true
}
