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
    time::{Duration, Instant, SystemTime},
};
use windows::{
    core::{HRESULT, HSTRING},
    Win32::{
        Foundation::*,
        Security::{
            EqualSid, GetKernelObjectSecurity, GetSecurityDescriptorOwner, GetTokenInformation, TokenUser,
            OWNER_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, PSID, TOKEN_QUERY, TOKEN_USER,
        },
        Storage::FileSystem::*,
        System::{Pipes::*, Threading::*, IO::*},
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
        Verb::Transaction { folder, token, remove } => transaction(&folder, &token, &remove),
        Verb::FifoSend {
            token,
            server,
            nonce,
            text,
        } => fifo_send(&token, server, nonce, &text),
        Verb::DeadlineWrite { folder, token, line } => deadline_write(&folder, &token, &line),
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

// BEGIN portable session lifecycle (also compiled by tests/check_windows_presence_lifecycle.py).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SessionKind {
    Registration,
    Marker,
    Deadline,
}
fn session_name(name: &str) -> Option<(SessionKind, &str)> {
    for (kind, prefix, suffix) in [
        (SessionKind::Registration, ".presence-registration-", ""),
        (SessionKind::Marker, ".presence-follow-", ".jsonl"),
        (SessionKind::Deadline, ".presence-deadline-", ".jsonl"),
    ] {
        if let Some(token) = name.strip_prefix(prefix).and_then(|s| s.strip_suffix(suffix)) {
            if protocol::valid_token(token, 128) {
                return Some((kind, token));
            }
        }
    }
    None
}
fn session_receipt(bytes: &[u8], token: &str) -> Option<(u32, u64)> {
    let text = std::str::from_utf8(bytes).ok()?.strip_suffix('\n')?;
    let fields: Vec<_> = text.split('\t').collect();
    let digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    if fields.len() != 6
        || text.contains(['\r', '\n'])
        || fields[5] != token
        || !digits(fields[0])
        || !digits(fields[1])
        || fields[3] != "0"
        || !protocol::listed_executable(fields[4])
    {
        return None;
    }
    let pid = fields[0].parse::<u32>().ok().filter(|pid| *pid > 0)?;
    fields[1].parse::<u32>().ok()?;
    let birth = fields[2].strip_prefix("windows:")?;
    if !digits(birth) {
        return None;
    }
    Some((pid, birth.parse().ok()?))
}

// The registration is removed before either companion file. Capture file handles before calling this,
// so a new session using the same token cannot have its replacement files removed by an old cleanup.
fn remove_session_files<T>(registration: T, marker: Option<T>, deadline: Option<T>, mut remove: impl FnMut(T) -> bool) {
    if remove(registration) {
        for file in [marker, deadline].into_iter().flatten() {
            remove(file);
        }
    }
}

fn registered_write<R: Eq, W, E>(
    mut registration: impl FnMut() -> Option<R>,
    publish: impl FnOnce() -> Result<W, E>,
    discard: impl FnOnce(W),
) -> Result<(), E> {
    let Some(before) = registration() else {
        return Ok(());
    };
    let written = publish()?;
    if registration().as_ref() != Some(&before) {
        discard(written);
    }
    Ok(())
}
// END portable session lifecycle.

struct SessionFile(fs::File);
impl SessionFile {
    fn open(path: &str, users: &Users) -> Result<Self, Error> {
        let file = OpenOptions::new()
            .access_mode(GENERIC_READ.0 | DELETE.0)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0)
            .open(path)?;
        Self::checked(file, users)
    }
    fn create(path: &str, users: &Users) -> Result<Self, Error> {
        let file = OpenOptions::new()
            .write(true)
            .access_mode(GENERIC_READ.0 | GENERIC_WRITE.0 | DELETE.0)
            .create_new(true)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0)
            .open(path)?;
        Self::checked(file, users)
    }
    fn checked(file: fs::File, users: &Users) -> Result<Self, Error> {
        let metadata = file.metadata()?;
        let mut info = BY_HANDLE_FILE_INFORMATION::default();
        unsafe { GetFileInformationByHandle(HANDLE(file.as_raw_handle()), &mut info)? };
        if !metadata.is_file()
            || info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0
            || info.nNumberOfLinks != 1
            || !users.owns(HANDLE(file.as_raw_handle()))
        {
            return Err("presence session file must be plain, owned and have one link".into());
        }
        Ok(Self(file))
    }
    fn id(&self) -> Result<(u32, u64, u64), Error> {
        let mut info = BY_HANDLE_FILE_INFORMATION::default();
        unsafe { GetFileInformationByHandle(HANDLE(self.0.as_raw_handle()), &mut info)? };
        Ok((
            info.dwVolumeSerialNumber,
            ((info.nFileIndexHigh as u64) << 32) | info.nFileIndexLow as u64,
            ((info.ftCreationTime.dwHighDateTime as u64) << 32) | info.ftCreationTime.dwLowDateTime as u64,
        ))
    }
    fn read(&self) -> Option<Vec<u8>> {
        let size = self.0.metadata().ok()?.len();
        if size == 0 || size > 8191 {
            return None;
        }
        read_at(&self.0, 0, size as usize).ok()
    }
    fn remove(self) -> bool {
        // Delete this handle's file, never a replacement at its former path.
        let mut info = BY_HANDLE_FILE_INFORMATION::default();
        let handle = HANDLE(self.0.as_raw_handle());
        unsafe {
            if GetFileInformationByHandle(handle, &mut info).is_err() || info.nNumberOfLinks != 1 {
                return false;
            }
            let disposition = FILE_DISPOSITION_INFO {
                DeleteFile: true.into(),
            };
            SetFileInformationByHandle(
                handle,
                FileDispositionInfo,
                (&disposition as *const FILE_DISPOSITION_INFO).cast(),
                std::mem::size_of::<FILE_DISPOSITION_INFO>() as u32,
            )
            .is_ok()
        }
    }
}

fn session_folder(folder: &str, users: &Users) -> Result<fs::File, Error> {
    let file = OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ.0 | FILE_SHARE_WRITE.0)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS.0 | FILE_FLAG_OPEN_REPARSE_POINT.0)
        .open(folder)?;
    let metadata = file.metadata()?;
    if !metadata.is_dir()
        || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0
        || !users.owns(HANDLE(file.as_raw_handle()))
    {
        return Err("presence session folder must be plain and owned".into());
    }
    Ok(file)
}

fn session_gone(pid: u32, birth: u64) -> bool {
    unsafe {
        let process = match OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE, false, pid) {
            Ok(process) => Handle(process),
            Err(error) => return win32(&error, ERROR_INVALID_PARAMETER),
        };
        match WaitForSingleObject(process.0, 0) {
            WAIT_OBJECT_0 => true,
            WAIT_TIMEOUT => {
                let (mut created, mut exit, mut kernel, mut user) = (
                    FILETIME::default(),
                    FILETIME::default(),
                    FILETIME::default(),
                    FILETIME::default(),
                );
                GetProcessTimes(process.0, &mut created, &mut exit, &mut kernel, &mut user).is_ok()
                    && (((created.dwHighDateTime as u64) << 32) | created.dwLowDateTime as u64) != birth
            }
            _ => false,
        }
    }
}

fn session_remove(folder: &str, token: &str, registration: SessionFile, users: &Users) {
    let Ok(id) = registration.id() else {
        return;
    };
    let marker = SessionFile::open(&protocol::follow_marker(folder, token), users).ok();
    let deadline = SessionFile::open(&protocol::deadline_file(folder, token), users).ok();
    if SessionFile::open(&protocol::registration_file(folder, token), users)
        .ok()
        .and_then(|file| file.id().ok())
        != Some(id)
    {
        return;
    }
    remove_session_files(registration, marker, deadline, SessionFile::remove);
}

fn registration_absent(folder: &str, token: &str) -> bool {
    fs::symlink_metadata(protocol::registration_file(folder, token))
        .is_err_and(|error| error.kind() == std::io::ErrorKind::NotFound)
}

fn sweep(folder: &str, users: &Users) {
    let Ok(_directory) = session_folder(folder, users) else {
        return;
    };
    let Ok(entries) = fs::read_dir(folder) else {
        return;
    };
    let names: Vec<_> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| session_name(name).is_some())
        .take(4096)
        .collect();
    for name in &names {
        let Some((SessionKind::Registration, token)) = session_name(name) else {
            continue;
        };
        let Ok(registration) = SessionFile::open(&protocol::join(folder, name), users) else {
            continue;
        };
        let Some((pid, birth)) = registration.read().and_then(|bytes| session_receipt(&bytes, token)) else {
            continue;
        };
        if session_gone(pid, birth) {
            session_remove(folder, token, registration, users);
        }
    }
    for name in &names {
        let Some((kind, token)) = session_name(name) else {
            continue;
        };
        if kind == SessionKind::Registration || !registration_absent(folder, token) {
            continue;
        }
        let Ok(file) = SessionFile::open(&protocol::join(folder, name), users) else {
            continue;
        };
        let old = file
            .0
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|mtime| SystemTime::now().duration_since(mtime).ok())
            .is_some_and(|age| age >= Duration::from_secs(60));
        if old && registration_absent(folder, token) {
            file.remove();
        }
    }
}

struct FollowerFiles<'a> {
    folder: &'a str,
    token: &'a str,
    users: &'a Users,
    registration: Option<(u32, u64, u64)>,
    marker: Option<(u32, u64, u64)>,
}
impl Drop for FollowerFiles<'_> {
    fn drop(&mut self) {
        let Some(id) = self.registration else {
            return;
        };
        let Ok(registration) = SessionFile::open(&protocol::registration_file(self.folder, self.token), self.users)
        else {
            return;
        };
        if registration.id().ok() != Some(id) {
            return;
        }
        let marker = SessionFile::open(&protocol::follow_marker(self.folder, self.token), self.users)
            .ok()
            .filter(|file| self.marker.is_some() && file.id().ok() == self.marker);
        let deadline = SessionFile::open(&protocol::deadline_file(self.folder, self.token), self.users).ok();
        if SessionFile::open(&protocol::registration_file(self.folder, self.token), self.users)
            .ok()
            .and_then(|file| file.id().ok())
            != Some(id)
        {
            return;
        }
        remove_session_files(registration, marker, deadline, SessionFile::remove);
    }
}

fn follow(folder: &str, token: &str, requests: &str, deadline_on: bool) -> Result<u8, Error> {
    let host = host()?;
    ensure_folder(folder)?;
    let users = Users::new()?;
    let _directory = session_folder(folder, &users)?;
    sweep(folder, &users);
    let journal = protocol::join(folder, "presence.jsonl");
    let snapshot = protocol::join(folder, "snapshot.json");
    drop(open_plain(&journal, true, true)?);
    drop(open_plain(&snapshot, true, true)?);
    let marker = protocol::follow_marker(folder, token);
    let deadline_path = protocol::deadline_file(folder, token);
    // The registration says who this follower is; a transaction lists a process under a token only when this file
    // holds exactly what the system says about that process.
    let record = protocol::receipt(host.pid, host.me.parent, &host.me.birth, 0, &host.me.image, token);
    let mut own = FollowerFiles {
        folder,
        token,
        users: &users,
        registration: None,
        marker: None,
    };
    {
        let mut file = SessionFile::create(&protocol::registration_file(folder, token), &users)?;
        own.registration = Some(file.id()?);
        file.0.write_all(record.as_bytes())?;
    }
    {
        let mut file = SessionFile::create(&marker, &users)?;
        own.marker = Some(file.id()?);
        file.0.write_all(format!("READY\t{token}\n").as_bytes())?;
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
        Ok(Some(
            GetOverlappedResult(self.handle.0, overlapped, &mut moved, true).map(|()| moved),
        ))
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
    fn owns(&self, file: HANDLE) -> bool {
        unsafe {
            let mut length = 0;
            let _ = GetKernelObjectSecurity(
                file,
                OWNER_SECURITY_INFORMATION.0,
                PSECURITY_DESCRIPTOR::default(),
                0,
                &mut length,
            );
            if length == 0 || length > 65536 {
                return false;
            }
            let mut descriptor = vec![0u64; (length as usize).div_ceil(8)];
            let descriptor = PSECURITY_DESCRIPTOR(descriptor.as_mut_ptr().cast());
            if GetKernelObjectSecurity(file, OWNER_SECURITY_INFORMATION.0, descriptor, length, &mut length).is_err() {
                return false;
            }
            let mut owner = PSID::default();
            let mut defaulted = BOOL::default();
            if GetSecurityDescriptorOwner(descriptor, &mut owner, &mut defaulted).is_err() {
                return false;
            }
            let own = (*(self.own.as_ptr().cast::<TOKEN_USER>())).User.Sid;
            EqualSid(own, owner).is_ok()
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
    text.extend(protocol::tagged(
        &read_small(&snapshot, LIMIT).unwrap_or_default(),
        "STATE\t",
    ));
    text.extend(protocol::tagged(
        &read_small(&journal, LIMIT).unwrap_or_default(),
        "LOG\t",
    ));
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
        replace(
            &snapshot,
            &protocol::join(&work.0, "snapshot"),
            format!("{commit}\n").as_bytes(),
        )?;
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
        let _directory = session_folder(folder, &users)?;
        if let Ok(registration) = SessionFile::open(&protocol::registration_file(folder, leaving), &users) {
            session_remove(folder, leaving, registration, &users);
        }
        sweep(folder, &users);
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
    let users = Users::new()?;
    let _directory = session_folder(folder, &users)?;
    let registration = protocol::registration_file(folder, token);
    let target = protocol::deadline_file(folder, token);
    let stage = format!("{target}.{}-{}.stage", std::process::id(), random());
    registered_write(
        || {
            SessionFile::open(&registration, &users)
                .ok()
                .and_then(|file| file.id().ok())
        },
        || -> Result<SessionFile, Error> {
            let mut file = SessionFile::create(&stage, &users)?;
            let result = (|| -> Result<(), Error> {
                file.0.write_all(line.as_bytes())?;
                if !fs::symlink_metadata(&target).is_err_and(|error| error.kind() == std::io::ErrorKind::NotFound) {
                    SessionFile::open(&target, &users)?;
                }
                unsafe {
                    MoveFileExW(
                        &HSTRING::from(&stage),
                        &HSTRING::from(&target),
                        MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
                    )?;
                }
                Ok(())
            })();
            if let Err(error) = result {
                file.remove();
                return Err(error);
            }
            Ok(file)
        },
        |file| {
            file.remove();
        },
    )?;
    Ok(0)
}

#[cfg(test)]
#[path = "../../tests/support/windows_presence_lifecycle.rs"]
mod lifecycle_tests;
