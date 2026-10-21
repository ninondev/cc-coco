//! Presence uses process handles and overlapped locks, with one aggregate event.
//! All identity reads are OS metadata. No process-image file is ever opened.
use crate::{
    protocol::{PresenceClaim, PresenceSnapshot},
    Error,
};
use std::{collections::BTreeMap, ffi::c_void, path::Path, sync::Arc};
use windows::{
    core::{w, PCSTR, PWSTR},
    Win32::{
        Foundation::*,
        Storage::FileSystem::*,
        System::{LibraryLoader::*, Threading::*, IO::*},
    },
};
pub(crate) struct Handle(pub(crate) HANDLE);
unsafe impl Send for Handle {}
unsafe impl Sync for Handle {}
impl Drop for Handle {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}
struct Signal {
    event: Arc<Handle>,
}
unsafe extern "system" fn signaled(context: *mut c_void, _timeout: BOOLEAN) {
    let signal = &*(context as *const Signal);
    let _ = SetEvent(signal.event.0);
}
struct Wait {
    registration: HANDLE,
    _signal: Box<Signal>,
    _source: Arc<Handle>,
}
impl Wait {
    unsafe fn new(source: Arc<Handle>, event: Arc<Handle>) -> Result<Self, Error> {
        let signal = Box::new(Signal { event });
        let mut registration = HANDLE::default();
        RegisterWaitForSingleObject(
            &mut registration,
            source.0,
            Some(signaled),
            Some((&*signal as *const Signal).cast()),
            INFINITE,
            WT_EXECUTEONLYONCE,
        )?;
        Ok(Self {
            registration,
            _signal: signal,
            _source: source,
        })
    }
}
impl Drop for Wait {
    fn drop(&mut self) {
        unsafe {
            let _ = UnregisterWaitEx(self.registration, INVALID_HANDLE_VALUE);
        }
    }
}

#[repr(C)]
struct BasicInformation {
    exit_status: i32,
    peb: *mut c_void,
    affinity: usize,
    priority: i32,
    pid: usize,
    parent: usize,
}
type ProcessInformation = unsafe extern "system" fn(HANDLE, u32, *mut c_void, u32, *mut u32) -> i32;
pub(crate) struct Identity {
    pub(crate) birth: String,
    pub(crate) parent: u32,
    pub(crate) handle: Arc<Handle>,
    /// The program's path as the system records it (the presence helper's inventory lists it).
    pub(crate) image: String,
}
pub(crate) unsafe fn identity(pid: u32) -> Option<Identity> {
    if pid == 0 {
        return None;
    }
    let handle = Arc::new(Handle(
        OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
            false,
            pid,
        )
        .ok()?,
    ));
    if WaitForSingleObject(handle.0, 0) != WAIT_TIMEOUT {
        return None;
    }
    let (mut creation, mut exit, mut kernel, mut user) = (
        FILETIME::default(),
        FILETIME::default(),
        FILETIME::default(),
        FILETIME::default(),
    );
    GetProcessTimes(handle.0, &mut creation, &mut exit, &mut kernel, &mut user).ok()?;
    // The image metadata must exist, but the image at that path is never read.
    let mut image = [0u16; 32768];
    let mut length = image.len() as u32;
    QueryFullProcessImageNameW(
        handle.0,
        PROCESS_NAME_WIN32,
        PWSTR(image.as_mut_ptr()),
        &mut length,
    )
    .ok()?;
    if length == 0 {
        return None;
    }
    let query: GetProcessInformationAlias = GetModuleHandleW(w!("ntdll.dll"))
        .ok()
        .and_then(|module| GetProcAddress(module, PCSTR(b"NtQueryInformationProcess\0".as_ptr())))
        .map(|function| std::mem::transmute(function))?;
    let mut information = BasicInformation {
        exit_status: 0,
        peb: std::ptr::null_mut(),
        affinity: 0,
        priority: 0,
        pid: 0,
        parent: 0,
    };
    if query(
        handle.0,
        0,
        (&mut information as *mut BasicInformation).cast(),
        std::mem::size_of::<BasicInformation>() as u32,
        std::ptr::null_mut(),
    ) != 0
    {
        return None;
    }
    let birth = ((creation.dwHighDateTime as u64) << 32) | creation.dwLowDateTime as u64;
    Some(Identity {
        birth: format!("windows:{birth}"),
        parent: information.parent.try_into().ok()?,
        handle,
        image: String::from_utf16(&image[..length as usize]).ok()?,
    })
}
type GetProcessInformationAlias = ProcessInformation;
pub fn claim_alive(claim: &PresenceClaim) -> bool {
    unsafe {
        let Some(process) = identity(claim.pid) else {
            return false;
        };
        if process.birth != claim.birth {
            return false;
        }
        if let Some(host) = claim.host_pid {
            if process.parent != host
                || identity(host).map(|host| host.birth).as_ref() != claim.host_birth.as_ref()
            {
                return false;
            }
        }
        // Revalidate after host queries to close an exit/PID-reuse race.
        WaitForSingleObject(process.handle.0, 0) == WAIT_TIMEOUT
    }
}

struct LockWait {
    file: std::fs::File,
    overlapped: Box<OVERLAPPED>,
    event: Arc<Handle>,
    wait: Option<Wait>,
}
impl LockWait {
    unsafe fn new(folder: &Path, event: Arc<Handle>) -> Result<Self, Error> {
        use std::os::windows::{fs::OpenOptionsExt, io::AsRawHandle};
        let file = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0 | FILE_FLAG_OVERLAPPED.0)
            .open(folder.join(".presence-flock"))?;
        let handle = HANDLE(file.as_raw_handle());
        let mut info = BY_HANDLE_FILE_INFORMATION::default();
        GetFileInformationByHandle(handle, &mut info)?;
        if info.dwFileAttributes & (FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_DIRECTORY).0 != 0
        {
            return Err("presence lock must be regular".into());
        }
        let completion = Arc::new(Handle(CreateEventW(None, true, false, None)?));
        let mut overlapped = Box::new(OVERLAPPED {
            hEvent: completion.0,
            ..Default::default()
        });
        match LockFileEx(handle, LOCKFILE_EXCLUSIVE_LOCK, 0, 1, 0, &mut *overlapped) {
            Ok(()) => {
                SetEvent(completion.0)?;
            }
            Err(error)
                if error.code() == windows::core::HRESULT::from_win32(ERROR_IO_PENDING.0) => {}
            Err(error) => return Err(error.into()),
        }
        let wait = Some(Wait::new(completion.clone(), event)?);
        Ok(Self {
            file,
            overlapped,
            event: completion,
            wait,
        })
    }
    fn ready(&self) -> bool {
        unsafe { WaitForSingleObject(self.event.0, 0) == WAIT_OBJECT_0 }
    }
}
impl Drop for LockWait {
    fn drop(&mut self) {
        use std::os::windows::io::AsRawHandle;
        self.wait.take();
        unsafe {
            let handle = HANDLE(self.file.as_raw_handle());
            let _ = CancelIoEx(handle, Some(&*self.overlapped));
            let mut bytes = 0;
            if GetOverlappedResult(handle, &*self.overlapped, &mut bytes, true).is_ok() {
                let _ = UnlockFileEx(handle, 0, 1, 0, &mut *self.overlapped);
            }
        }
    }
}
pub struct Events {
    event: Arc<Handle>,
    hosts: BTreeMap<u32, (String, Wait)>,
    lock: Option<LockWait>,
    expired_keys: Vec<String>,
}
impl Events {
    pub fn new() -> Result<Self, Error> {
        unsafe {
            Ok(Self {
                event: Arc::new(Handle(CreateEventW(None, true, false, None)?)),
                hosts: BTreeMap::new(),
                lock: None,
                expired_keys: Vec::new(),
            })
        }
    }
    pub fn handle(&self) -> usize {
        self.event.0 .0 as usize
    }
    pub fn drain(&mut self) {
        unsafe {
            let _ = ResetEvent(self.event.0);
        }
        if self.lock.as_ref().is_some_and(LockWait::ready) {
            self.lock.take();
        }
    }
    pub fn wait_lock(&mut self, folder: &Path) -> Result<(), Error> {
        if self.lock.is_none() {
            self.lock = Some(unsafe { LockWait::new(folder, self.event.clone())? });
        }
        Ok(())
    }
    pub fn watch(&mut self, snapshot: Option<&PresenceSnapshot>) -> Result<bool, Error> {
        let mut wanted = BTreeMap::new();
        let mut expired = false;
        if let Some(snapshot) = snapshot {
            for claim in snapshot.claims.values() {
                if !claim_alive(claim) {
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
            let Some(identity) = (unsafe { identity(pid) }) else {
                expired = true;
                continue;
            };
            if identity.birth != birth {
                expired = true;
                continue;
            }
            let wait = unsafe { Wait::new(identity.handle, self.event.clone())? };
            self.hosts.insert(pid, (birth, wait));
        }
        let expired_keys = snapshot
            .map(|snapshot| {
                snapshot
                    .claims
                    .iter()
                    .filter(|(_, claim)| !claim_alive(claim))
                    .map(|(owner, _)| owner.clone())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        if !expired_keys.is_empty() {
            expired = true;
        }
        if !expired_keys.is_empty() && expired_keys != self.expired_keys {
            unsafe {
                SetEvent(self.event.0)?;
            }
        }
        self.expired_keys = expired_keys;
        Ok(expired)
    }
}
