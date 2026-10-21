//! The Windows calls behind presence_helper.rs (lane C, 10-16): the follower watches the presence folder with a
//! change notification and waits on nothing else but its deadline and the program that started it; a transaction
//! takes the same one-byte lock the pet takes (`.presence-flock`), and reads the plugin's two lines from a named pipe
//! only this user can write to. Every wait also watches the starting program, so a closed Claude Code never leaves a
//! helper behind holding the lock. Process facts are metadata only (presence_events::identity); no program file and
//! no other process's arguments are read.
use super::presence_events::{identity, Handle, Identity};
use crate::presence_helper::{self as protocol, Deadline, Journal, Verb, LIMIT, UNAVAILABLE};
use crate::Error;
use std::{
    ffi::c_void,
    fs::{self, OpenOptions},
    io::Write,
    os::windows::fs::{FileExt, MetadataExt, OpenOptionsExt},
    os::windows::io::AsRawHandle,
    time::{Duration, Instant},
};
use windows::{
    core::{HRESULT, HSTRING},
    Win32::{
        Foundation::*,
        Security::{EqualSid, GetTokenInformation, TokenUser, TOKEN_QUERY, TOKEN_USER},
        Storage::FileSystem::*,
        System::{IO::*, Pipes::*, Threading::*},
    },
};

/// The longest any single wait lasts: the plugin answers in milliseconds, so a transaction this slow has lost its
/// caller, and nothing may hold the lock for longer.
const WAIT_MS: u32 = 60_000;

pub fn run(verb: Verb) -> u8 {
    let result = match verb {
        Verb::Follow {
            folder,
            token,
            requests,
            deadline,
        } => follow(&folder, &token, &requests, deadline),
        Verb::Transaction {
            folder,
            token,
            remove,
        } => transaction(&folder, &token, &remove),
        Verb::FifoSend {
            token,
            server,
            nonce,
            text,
        } => fifo_send(&token, server, nonce, &text),
        Verb::DeadlineWrite {
            folder,
            token,
            line,
        } => deadline_write(&folder, &token, &line),
    };
    result.unwrap_or_else(|error| {
        eprintln!("presence: {error}");
        UNAVAILABLE
    })
}

fn win32(error: &windows::core::Error, code: WIN32_ERROR) -> bool {
    error.code() == HRESULT::from_win32(code.0)
}

/// This process and the program that started it (Claude Code), which must be older than this one: a younger
/// process under that number took the number over after the real one ended.
struct Host {
    me: Identity,
    pid: u32,
    host: Identity,
}
fn host() -> Result<Host, Error> {
    unsafe {
        let pid = GetCurrentProcessId();
        let me = identity(pid).ok_or("presence: no identity")?;
        let host = identity(me.parent).ok_or("presence: the starting program is gone")?;
        let birth = |identity: &Identity| identity.birth.trim_start_matches("windows:").parse::<u64>().ok();
        if birth(&host).zip(birth(&me)).is_none_or(|(host, me)| host > me) {
            return Err("presence: the starting program is gone".into());
        }
        Ok(Host { me, pid, host })
    }
}

enum Waited {
    Ready,
    HostGone,
}
unsafe fn wait(event: HANDLE, host: &Identity, milliseconds: u32) -> Result<Waited, Error> {
    match WaitForMultipleObjects(&[event, host.handle.0], false, milliseconds) {
        WAIT_OBJECT_0 => Ok(Waited::Ready),
        result if result.0 == WAIT_OBJECT_0.0 + 1 => Ok(Waited::HostGone),
        WAIT_TIMEOUT => Err("presence: wait timed out".into()),
        _ => Err(windows::core::Error::from_win32().into()),
    }
}

fn ensure_folder(folder: &str) -> Result<(), Error> {
    fs::create_dir_all(folder)?;
    let metadata = fs::symlink_metadata(folder)?;
    if !metadata.is_dir() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0 {
        return Err("presence folder must be a plain folder".into());
    }
    Ok(())
}
/// A plain file in the folder, opened so others can still read, write, rename and delete it; a link is refused.
fn open_plain(path: &str, write: bool, create: bool) -> std::io::Result<fs::File> {
    let file = OpenOptions::new()
        .read(true)
        .write(write)
        .create(create)
        .truncate(false)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0)
        .open(path)?;
    let metadata = file.metadata()?;
    if !metadata.is_file() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0 {
        return Err(std::io::Error::other("presence file must be a plain file"));
    }
    Ok(file)
}
fn file_id(file: &fs::File) -> Result<(u32, u64, u64), Error> {
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    unsafe { GetFileInformationByHandle(HANDLE(file.as_raw_handle()), &mut info)? };
    Ok((
        info.dwVolumeSerialNumber,
        ((info.nFileIndexHigh as u64) << 32) | info.nFileIndexLow as u64,
        ((info.nFileSizeHigh as u64) << 32) | info.nFileSizeLow as u64,
    ))
}
fn read_at(file: &fs::File, offset: u64, length: usize) -> std::io::Result<Vec<u8>> {
    let mut bytes = vec![0; length];
    let mut done = 0;
    while done < length {
        match file.seek_read(&mut bytes[done..], offset + done as u64)? {
            0 => break,
            n => done += n,
        }
    }
    bytes.truncate(done);
    Ok(bytes)
}
/// A whole small file, or nothing when it is missing, a link or larger than `limit`.
fn read_small(path: &str, limit: usize) -> Option<Vec<u8>> {
    let file = open_plain(path, false, false).ok()?;
    let size = file.metadata().ok()?.len();
    if size > limit as u64 {
        return None;
    }
    read_at(&file, 0, size as usize).ok()
}
/// Write a stage file and rename it over the target; a reader holding the target for a moment is waited out.
fn replace(target: &str, stage: &str, bytes: &[u8]) -> Result<(), Error> {
    {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0)
            .open(stage)?;
        if let Err(error) = file.write_all(bytes) {
            drop(file);
            let _ = fs::remove_file(stage);
            return Err(error.into());
        }
    }
    let (from, to) = (HSTRING::from(stage), HSTRING::from(target));
    for attempt in 0.. {
        match unsafe { MoveFileExW(&from, &to, MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) } {
            Ok(()) => return Ok(()),
            Err(error)
                if attempt < 100
                    && (win32(&error, ERROR_SHARING_VIOLATION) || win32(&error, ERROR_ACCESS_DENIED)) =>
            {
                std::thread::sleep(Duration::from_millis(10));
            }
            Err(error) => {
                let _ = fs::remove_file(stage);
                return Err(error.into());
            }
        }
    }
    unreachable!()
}
fn remove(path: &str) {
    let _ = fs::remove_file(path);
}
/// A random number from the system's generator (the one std seeds its hash maps with).
fn random() -> u64 {
    use std::hash::{BuildHasher, Hasher};
    let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
    hasher.write_u64(crate::epoch_ms());
    hasher.finish()
}

struct Out(std::io::Stdout);
impl Out {
    fn send(&mut self, bytes: &[u8]) -> Result<(), Error> {
        let mut out = self.0.lock();
        out.write_all(bytes)?;
        out.flush()?;
        Ok(())
    }
}

// ---- follow ----

struct Watched {
    name: String,
    id: Option<(u32, u64)>,
    offset: u64,
    requests: bool,
}
impl Watched {
    fn new(name: String, requests: bool) -> Self {
        Self {
            name,
            id: None,
            offset: 0,
            requests,
        }
    }
    /// presence-linux.c follow_read: the new whole lines under a `==> name <==` header; a replaced file starts over.
    fn read(&mut self, initial: bool, out: &mut Vec<u8>) -> Result<(), Error> {
        let Ok(file) = open_plain(&self.name, false, false) else {
            return Ok(());
        };
        let (volume, index, size) = file_id(&file)?;
        if self.id != Some((volume, index)) {
            self.id = Some((volume, index));
            self.offset = 0;
            if self.requests {
                out.extend_from_slice(format!("\nREQUEST-GENERATION\t{volume}\t{index}\n").as_bytes());
            }
            if initial && size > 0 {
                let start = size.saturating_sub(LIMIT as u64);
                let bytes = read_at(&file, start, (size - start) as usize)?;
                self.offset = protocol::first_offset(&bytes, start);
            }
        }
        if size < self.offset {
            self.offset = 0;
        }
        if size - self.offset > LIMIT as u64 {
            self.offset = size - LIMIT as u64;
        }
        let want = (size - self.offset) as usize;
        if want == 0 {
            return Ok(());
        }
        let bytes = read_at(&file, self.offset, want)?;
        let whole = protocol::whole_lines(&bytes);
        if whole > 0 {
            out.extend_from_slice(format!("\n==> {} <==\n", self.name).as_bytes());
            out.extend_from_slice(&bytes[..whole]);
            self.offset += whole as u64;
        } else if bytes.len() == LIMIT {
            self.offset = size;
        }
        Ok(())
    }
}

struct Notice(HANDLE);
impl Drop for Notice {
    fn drop(&mut self) {
        unsafe {
            let _ = FindCloseChangeNotification(self.0);
        }
    }
}
fn notice(folder: &str) -> Result<Notice, Error> {
    let filter = FILE_NOTIFY_CHANGE_FILE_NAME
        | FILE_NOTIFY_CHANGE_DIR_NAME
        | FILE_NOTIFY_CHANGE_SIZE
        | FILE_NOTIFY_CHANGE_LAST_WRITE;
    Ok(Notice(unsafe { FindFirstChangeNotificationW(&HSTRING::from(folder), false, filter)? }))
}
fn parent_folder(path: &str) -> Option<&str> {
    path.rfind(['\\', '/']).map(|n| &path[..n])
}

fn follow(folder: &str, token: &str, requests: &str, deadline_on: bool) -> Result<u8, Error> {
    let host = host()?;
    ensure_folder(folder)?;
    let journal = protocol::join(folder, "presence.jsonl");
    let snapshot = protocol::join(folder, "snapshot.json");
    drop(open_plain(&journal, true, true)?);
    drop(open_plain(&snapshot, true, true)?);
    let marker = protocol::follow_marker(folder, token);
    let deadline_path = protocol::deadline_file(folder, token);
    // The registration says who this follower is; a transaction lists a process under a token only when this file
    // holds exactly what the system says about that process.
    let record = protocol::receipt(host.pid, host.me.parent, &host.me.birth, 0, &host.me.image, token);
    for (path, text) in [
        (protocol::registration_file(folder, token), record),
        (marker.clone(), format!("READY\t{token}\n")),
    ] {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0)
            .open(path)?;
        file.write_all(text.as_bytes())?;
    }
    let mut watches = vec![notice(folder)?];
    if let Some(parent) = parent_folder(requests).filter(|parent| !requests.is_empty() && *parent != folder) {
        watches.push(notice(parent)?);
    }
    let mut followed = vec![Watched::new(journal, false), Watched::new(snapshot, false)];
    if !requests.is_empty() {
        followed.push(Watched::new(requests.into(), true));
    }
    let mut out = Out(std::io::stdout());
    let mut text = format!("FOLLOW\t{}{}\n", host.pid, if deadline_on { "\tDEADLINE1" } else { "" }).into_bytes();
    for file in &mut followed {
        file.read(true, &mut text)?;
    }
    text.extend_from_slice(format!("\n==> {marker} <==\nREADY\t{token}\n").as_bytes());
    out.send(&text)?;
    let mut deadline = Deadline::default();
    loop {
        if deadline_on {
            deadline.read(read_small(&deadline_path, 63).as_deref());
            if let Some((generation, at)) = deadline.due(crate::epoch_ms()) {
                // Read again right before sending: a newer wait may have replaced this one meanwhile.
                deadline.read(read_small(&deadline_path, 63).as_deref());
                if deadline.due(crate::epoch_ms()) == Some((generation, at)) {
                    out.send(format!("\n==> {deadline_path} <==\nDEADLINE\t{generation}\t{at}\n").as_bytes())?;
                    deadline.fire();
                }
            }
        }
        let timeout = deadline
            .remaining(crate::epoch_ms())
            .map_or(INFINITE, |ms| ms.min(u32::MAX as u64 - 1) as u32);
        let mut handles: Vec<HANDLE> = watches.iter().map(|watch| watch.0).collect();
        handles.push(host.host.handle.0);
        let result = unsafe { WaitForMultipleObjects(&handles, false, timeout) };
        if result == WAIT_TIMEOUT {
            continue;
        }
        let index = result.0.wrapping_sub(WAIT_OBJECT_0.0) as usize;
        if index == watches.len() {
            return Ok(0);
        }
        if index > watches.len() {
            return Err(windows::core::Error::from_win32().into());
        }
        // Ask for the next change before reading, so a change made while reading is not lost.
        unsafe { FindNextChangeNotification(watches[index].0)? };
        let mut text = Vec::new();
        for file in &mut followed {
            file.read(false, &mut text)?;
        }
        if !text.is_empty() {
            out.send(&text)?;
        }
    }
}

// ---- transaction ----

struct Event(Handle);
impl Event {
    fn new() -> Result<Self, Error> {
        Ok(Self(Handle(unsafe { CreateEventW(None, true, false, None)? })))
    }
    fn overlapped(&self) -> Box<OVERLAPPED> {
        unsafe {
            let _ = ResetEvent(self.0 .0);
        }
        Box::new(OVERLAPPED {
            hEvent: self.0 .0,
            ..Default::default()
        })
    }
}

struct Locked {
    file: fs::File,
    overlapped: Box<OVERLAPPED>,
}
impl Drop for Locked {
    fn drop(&mut self) {
        unsafe {
            let _ = UnlockFileEx(HANDLE(self.file.as_raw_handle()), 0, 1, 0, &mut *self.overlapped);
        }
    }
}
/// The pet's lock (platform::windows::acquire_presence_lock): the first byte of `.presence-flock`, exclusive. While
/// someone else holds it (for milliseconds), it is tried again every 15 ms, and each pause is also a wait on the host,
/// so a closed Claude Code ends the wait at once. A lock request that waits in the system instead (overlapped) is
/// not used: Wine never finishes one, and the cloud tests this helper under Wine.
fn lock(folder: &str, host: &Identity) -> Result<Option<Locked>, Error> {
    let file = open_plain(&protocol::join(folder, ".presence-flock"), true, true)?;
    let handle = HANDLE(file.as_raw_handle());
    let started = Instant::now();
    loop {
        let mut overlapped = OVERLAPPED::default();
        match unsafe {
            LockFileEx(
                handle,
                LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY,
                0,
                1,
                0,
                &mut overlapped,
            )
        } {
            Ok(()) => {
                return Ok(Some(Locked {
                    file,
                    overlapped: Box::new(OVERLAPPED::default()),
                }))
            }
            Err(error) if win32(&error, ERROR_LOCK_VIOLATION) => {}
            Err(error) => return Err(error.into()),
        }
        if started.elapsed() > Duration::from_millis(WAIT_MS as u64) {
            return Err("presence: lock wait timed out".into());
        }
        if unsafe { WaitForSingleObject(host.handle.0, 15) } == WAIT_OBJECT_0 {
            return Ok(None);
        }
    }
}

struct Pipe {
    handle: Handle,
    event: Event,
    connected: bool,
    pending: Vec<u8>,
}
impl Pipe {
    /// Inbound only, one instance, never shared with a pipe someone else made first, no remote clients. Its default
    /// security lets only this user and the system write to it.
    fn new(name: &str) -> Result<Self, Error> {
        let handle = unsafe {
            CreateNamedPipeW(
                &HSTRING::from(name),
                PIPE_ACCESS_INBOUND | FILE_FLAG_FIRST_PIPE_INSTANCE | FILE_FLAG_OVERLAPPED,
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
                1,
                0,
                65536,
                0,
                None,
            )
        };
        if handle.is_invalid() {
            return Err(windows::core::Error::from_win32().into());
        }
        Ok(Self {
            handle: Handle(handle),
            event: Event::new()?,
            connected: false,
            pending: Vec::new(),
        })
    }
    /// One overlapped call, finished or abandoned before its buffer goes away. None: the host is gone.
    unsafe fn complete(
        &self,
        started: windows::core::Result<()>,
        overlapped: &OVERLAPPED,
        host: &Identity,
    ) -> Result<Option<windows::core::Result<u32>>, Error> {
        if let Err(error) = &started {
            if !win32(error, ERROR_IO_PENDING) {
                return Ok(Some(Err(error.clone())));
            }
            let waited = wait(self.event.0 .0, host, WAIT_MS);
            if !matches!(waited, Ok(Waited::Ready)) {
                let _ = CancelIoEx(self.handle.0, Some(overlapped));
                let mut moved = 0;
                let _ = GetOverlappedResult(self.handle.0, overlapped, &mut moved, true);
                return match waited? {
                    Waited::HostGone => Ok(None),
                    Waited::Ready => unreachable!(),
                };
            }
        }
        let mut moved = 0;
        Ok(Some(GetOverlappedResult(self.handle.0, overlapped, &mut moved, true).map(|()| moved)))
    }
    fn read_line(&mut self, host: &Identity) -> Result<Option<String>, Error> {
        loop {
            if let Some(end) = self.pending.iter().position(|b| *b == b'\n') {
                let line: Vec<u8> = self.pending.drain(..=end).collect();
                return Ok(Some(String::from_utf8(line[..end].to_vec())?));
            }
            if self.pending.len() >= LIMIT {
                return Err("presence line too long".into());
            }
            unsafe {
                if !self.connected {
                    let overlapped = self.event.overlapped();
                    let started = ConnectNamedPipe(self.handle.0, Some(&*overlapped as *const _ as *mut _));
                    let connected = match started {
                        Err(error) if win32(&error, ERROR_PIPE_CONNECTED) => Some(Ok(0)),
                        started => self.complete(started, &overlapped, host)?,
                    };
                    match connected {
                        None => return Ok(None),
                        Some(result) => {
                            result?;
                        }
                    }
                    self.connected = true;
                }
                let mut buffer = vec![0u8; 16384];
                let overlapped = self.event.overlapped();
                let started = ReadFile(
                    self.handle.0,
                    Some(&mut buffer),
                    None,
                    Some(&*overlapped as *const _ as *mut _),
                );
                match self.complete(started, &overlapped, host)? {
                    None => return Ok(None),
                    Some(Ok(moved)) => self.pending.extend_from_slice(&buffer[..moved as usize]),
                    // The sender wrote its piece and left: the next piece comes on a new connection.
                    Some(Err(error)) if win32(&error, ERROR_BROKEN_PIPE) => {
                        let _ = DisconnectNamedPipe(self.handle.0);
                        self.connected = false;
                    }
                    Some(Err(error)) => return Err(error.into()),
                }
            }
        }
    }
}

/// The token user of a process, compared with this one's: an inventory lists only this user's processes.
struct Users {
    own: Vec<u64>,
}
unsafe fn token_user(process: HANDLE) -> Option<Vec<u64>> {
    let mut token = HANDLE::default();
    OpenProcessToken(process, TOKEN_QUERY, &mut token).ok()?;
    let token = Handle(token);
    let mut length = 0;
    let _ = GetTokenInformation(token.0, TokenUser, None, 0, &mut length);
    if length == 0 || length > 4096 {
        return None;
    }
    let mut buffer = vec![0u64; (length as usize).div_ceil(8)];
    GetTokenInformation(
        token.0,
        TokenUser,
        Some(buffer.as_mut_ptr().cast::<c_void>()),
        length,
        &mut length,
    )
    .ok()?;
    Some(buffer)
}
impl Users {
    fn new() -> Result<Self, Error> {
        Ok(Self {
            own: unsafe { token_user(GetCurrentProcess()) }.ok_or("presence: no user")?,
        })
    }
    fn same(&self, process: HANDLE) -> bool {
        unsafe {
            let Some(other) = token_user(process) else {
                return false;
            };
            let sid = |buffer: &Vec<u64>| (*(buffer.as_ptr().cast::<TOKEN_USER>())).User.Sid;
            EqualSid(sid(&self.own), sid(&other)).is_ok()
        }
    }
}

/// presence-linux.c inventory: one PID line per live process of this user, bound to its token when its
/// registration file says exactly what the system says.
fn inventory(folder: &str, pids: &[(u32, String)], users: &Users) -> Vec<u8> {
    let mut out = Vec::new();
    for (pid, token) in pids {
        let Some(process) = (unsafe { identity(*pid) }) else {
            continue;
        };
        if !protocol::listed_executable(&process.image) || !users.same(process.handle.0) {
            continue;
        }
        let bound = !token.is_empty()
            && read_small(&protocol::registration_file(folder, token), 8191).is_some_and(|text| {
                text == protocol::receipt(*pid, process.parent, &process.birth, 0, &process.image, token).as_bytes()
            });
        // The process must still be the same one after all of that.
        let again = unsafe { identity(*pid) };
        if again.is_none_or(|again| again.birth != process.birth || again.parent != process.parent) {
            continue;
        }
        let token = if bound { token.as_str() } else { "" };
        out.extend_from_slice(b"PID\t");
        out.extend_from_slice(
            protocol::receipt(*pid, process.parent, &process.birth, 0, &process.image, token).as_bytes(),
        );
    }
    out
}

struct Work(String);
impl Drop for Work {
    fn drop(&mut self) {
        for leaf in ["snapshot", "journal", "owner"] {
            remove(&protocol::join(&self.0, leaf));
        }
        let _ = fs::remove_dir(&self.0);
    }
}

fn transaction(folder: &str, token: &str, leaving: &str) -> Result<u8, Error> {
    let host = host()?;
    ensure_folder(folder)?;
    let work = protocol::work_folder(folder, token);
    fs::create_dir(&work)?;
    let work = Work(work);
    let nonce = random();
    let mut pipe = Pipe::new(&protocol::pipe_name(token, nonce))?;
    let users = Users::new()?;
    let Some(locked) = lock(folder, &host.host)? else {
        return Ok(0);
    };
    replace(
        &protocol::join(folder, ".presence-flock-owner"),
        &protocol::join(&work.0, "owner"),
        format!("{}\n{token}\n", host.pid).as_bytes(),
    )?;
    let journal = protocol::join(folder, "presence.jsonl");
    let snapshot = protocol::join(folder, "snapshot.json");
    drop(open_plain(&journal, true, true)?);
    let mut out = Out(std::io::stdout());
    let mut text = format!(
        "PRESENCE\t{}\t{}\t{}\t{nonce}\n",
        host.me.parent,
        protocol::commit_path(folder, token),
        host.pid
    )
    .into_bytes();
    text.extend(protocol::tagged(&read_small(&snapshot, LIMIT).unwrap_or_default(), "STATE\t"));
    text.extend(protocol::tagged(&read_small(&journal, LIMIT).unwrap_or_default(), "LOG\t"));
    text.extend_from_slice(b"INSPECT\n");
    out.send(&text)?;
    let Some(pids) = pipe.read_line(&host.host)? else {
        return Ok(0);
    };
    let pids = protocol::parse_pids(&pids).map_err(|_| "presence: bad process list")?;
    let mut text = inventory(folder, &pids, &users);
    text.extend_from_slice(b"READY\n");
    out.send(&text)?;
    let Some(commit) = pipe.read_line(&host.host)? else {
        return Ok(0);
    };
    if commit != "-" {
        replace(&snapshot, &protocol::join(&work.0, "snapshot"), format!("{commit}\n").as_bytes())?;
        let file = open_plain(&journal, true, true)?;
        let size = file.metadata()?.len();
        let whole = size == 0 || read_at(&file, size - 1, 1)?.first() == Some(&b'\n');
        match protocol::journal(size, whole, &commit) {
            Journal::Append(bytes) => {
                drop(file);
                let mut file = OpenOptions::new()
                    .append(true)
                    .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0)
                    .open(&journal)?;
                file.write_all(&bytes)?;
            }
            Journal::Restart(bytes) => {
                drop(file);
                replace(&journal, &protocol::join(&work.0, "journal"), &bytes)?;
            }
        }
    }
    if !leaving.is_empty() {
        remove(&protocol::follow_marker(folder, leaving));
        remove(&protocol::deadline_file(folder, leaving));
        remove(&protocol::registration_file(folder, leaving));
    }
    drop(locked);
    drop(pipe);
    drop(work);
    out.send(b"COMMITTED\n")?;
    Ok(0)
}

// ---- fifo-send and deadline-write ----

fn fifo_send(token: &str, server: u32, nonce: u64, text: &str) -> Result<u8, Error> {
    // A transaction that stops reading cannot keep its sender waiting: five seconds, as on Linux.
    std::thread::spawn(|| {
        std::thread::sleep(Duration::from_secs(5));
        std::process::exit(UNAVAILABLE as i32);
    });
    let name = HSTRING::from(protocol::pipe_name(token, nonce));
    let started = Instant::now();
    let handle = loop {
        match unsafe {
            CreateFileW(
                &name,
                GENERIC_WRITE.0,
                FILE_SHARE_MODE(0),
                None,
                OPEN_EXISTING,
                SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION,
                None,
            )
        } {
            Ok(handle) => break Handle(handle),
            Err(error) if win32(&error, ERROR_PIPE_BUSY) => {
                let left = 5000u128.saturating_sub(started.elapsed().as_millis());
                if left == 0 {
                    return Ok(UNAVAILABLE);
                }
                let _ = unsafe { WaitNamedPipeW(&name, left as u32) };
            }
            Err(_) => return Ok(UNAVAILABLE),
        }
    };
    let mut pid = 0;
    unsafe { GetNamedPipeServerProcessId(handle.0, &mut pid)? };
    if pid != server {
        return Ok(UNAVAILABLE);
    }
    let mut sent = 0;
    while sent < text.len() {
        let mut moved = 0;
        unsafe { WriteFile(handle.0, Some(&text.as_bytes()[sent..]), Some(&mut moved), None)? };
        if moved == 0 {
            return Ok(UNAVAILABLE);
        }
        sent += moved as usize;
    }
    // Returns once the transaction has read every byte, so the next piece cannot overtake this one.
    unsafe { FlushFileBuffers(handle.0)? };
    Ok(0)
}

fn deadline_write(folder: &str, token: &str, line: &str) -> Result<u8, Error> {
    if !fs::symlink_metadata(folder).is_ok_and(|metadata| metadata.is_dir()) {
        return Ok(UNAVAILABLE);
    }
    let target = protocol::deadline_file(folder, token);
    let stage = format!("{target}.{}-{}.stage", std::process::id(), random());
    replace(&target, &stage, line.as_bytes())?;
    Ok(0)
}
