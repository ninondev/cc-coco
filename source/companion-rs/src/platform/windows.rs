//! Windows shell. The message queue and overlapped directory notifications are the only clocks.
//! UpdateLayeredWindow is the scheduled-frame fallback: no background render thread or polling.
#[path = "windows_accessibility.rs"]
mod native_accessibility;
#[path = "windows_composer.rs"]
mod native_composer;
#[path = "windows_measure.rs"]
mod native_measure;
#[path = "windows_menu.rs"]
mod native_menu;
#[path = "windows_tray.rs"]
mod native_tray;
pub(crate) use native_measure::measure_mixed;
pub(crate) fn measure_ui(
    text: &str,
    lang: &str,
    size: f64,
    bold: bool,
    sans: bool,
    width: f64,
    height: f64,
) -> (f64, f64) {
    native_measure::measure_ui(text, lang, size, bold, sans, width, height)
}
pub(crate) fn measure_ui_weight(
    text: &str,
    lang: &str,
    size: f64,
    weight: u16,
    sans: bool,
    width: f64,
    height: f64,
) -> (f64, f64) {
    if weight == 400 || weight == 600 {
        measure_ui(text, lang, size, weight == 600, sans, width, height)
    } else {
        native_measure::measure_ui_weight(text, lang, size, weight, sans, width, height)
    }
}
pub(crate) fn measure_ui_with_line_height(
    text: &str,
    lang: &str,
    size: f64,
    bold: bool,
    sans: bool,
    width: f64,
    height: f64,
    line_height: Option<f64>,
) -> (f64, f64) {
    native_measure::measure_ui_with_line_height(
        text,
        lang,
        size,
        bold,
        sans,
        width,
        height,
        line_height,
    )
}
#[path = "windows_locale.rs"]
mod native_locale;
pub(crate) use native_locale::moment_ui;
#[path = "windows_notice_shortcut.rs"]
mod native_notice_shortcut;
#[path = "windows_place.rs"]
mod native_place;
#[path = "windows_notice_state.rs"]
mod notice_gate;
#[path = "windows_presence.rs"]
pub(crate) mod presence_events;
#[path = "windows_presence_helper.rs"]
pub(crate) mod presence_helper;
use crate::{
    engine::{Action, Engine},
    epoch_ms,
    motion::{LineFlip, LineSide, PlaceMode, ScreenRect},
    reactions::TouchEvent,
    render::{Canvas, TextRun},
    ui::{Key, MenuAction, MenuContext, Surface, UiAction, UiPlatform},
    Error, Options,
};
use std::{
    cell::Cell,
    ffi::c_void,
    path::{Path, PathBuf},
    ptr,
    sync::atomic::{AtomicBool, AtomicIsize, Ordering},
};
use windows::{
    core::{w, Interface, HSTRING, PCSTR, PCWSTR, PROPVARIANT, PWSTR},
    Data::Xml::Dom::XmlDocument,
    Win32::{
        Foundation::*,
        Graphics::{
            Direct2D::{Common::*, *},
            DirectWrite::*,
            Dxgi::Common::*,
            Gdi::*,
        },
        Storage::FileSystem::*,
        System::{
            Com::{StructuredStorage::*, *},
            LibraryLoader::*,
            Registry::*,
            RemoteDesktop::*,
            SystemInformation::*,
            Threading::*,
            Variant::VT_LPWSTR,
            IO::*,
        },
        UI::{
            Accessibility::*,
            HiDpi::{
                DPI_AWARENESS_CONTEXT, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE,
                DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
            },
            Input::KeyboardAndMouse::*,
            Shell::{PropertiesSystem::*, *},
            WindowsAndMessaging::*,
        },
    },
    UI::Notifications::{ToastNotification, ToastNotificationManager},
};

const FRAME_TIMER: usize = 1;
const PRESS_TIMER: usize = 2;
const WINDOW_EVENT: u32 = WM_APP + 1;
const SUMMON_EVENT: u32 = WM_APP + 2;
const TRAY_EVENT: u32 = WM_APP + 3;
const NOTICE_ACTIVATE: u32 = WM_APP + 4;
const EDIT_FOCUS: u32 = WM_APP + 5;
const OWN_MOUSE_LEAVE: u32 = 0x02A3;
// Standard EDIT messages; every send below targets the private composer child.
const EM_GETSEL: u32 = 0x00B0;
const EM_SETSEL: u32 = 0x00B1;
const EM_LIMITTEXT: u32 = 0x00C5;
const APP_ID: &str = "Coco.Companion";
thread_local! {static IN_DISPATCH: Cell<bool> = const {Cell::new(false)};}
struct DispatchGuard;
impl DispatchGuard {
    fn enter() -> Option<Self> {
        IN_DISPATCH.with(|flag| if flag.replace(true) { None } else { Some(Self) })
    }
}
impl Drop for DispatchGuard {
    fn drop(&mut self) {
        IN_DISPATCH.with(|flag| flag.set(false));
    }
}

static EVENT_WINDOW: AtomicIsize = AtomicIsize::new(0);
static EDIT_DEFAULT_PROC: AtomicIsize = AtomicIsize::new(0);

fn wide(value: impl AsRef<std::ffi::OsStr>) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    value.as_ref().encode_wide().chain(Some(0)).collect()
}

/// RtlGetVersion is not affected by a process's compatibility manifest. Windows 10
/// before build 19041 must retain its ordinary sharing behaviour, not WDA_MONITOR.
unsafe fn windows_version() -> Option<(u32, u32)> {
    #[repr(C)]
    struct OsVersion {
        size: u32,
        major: u32,
        minor: u32,
        build: u32,
        platform: u32,
        service_pack: [u16; 128],
    }
    type Version = unsafe extern "system" fn(*mut OsVersion) -> i32;
    let Some(version) = GetModuleHandleW(w!("ntdll.dll"))
        .ok()
        .and_then(|module| GetProcAddress(module, PCSTR(b"RtlGetVersion\0".as_ptr())))
    else {
        return None;
    };
    let version: Version = std::mem::transmute(version);
    let mut info = OsVersion {
        size: std::mem::size_of::<OsVersion>() as u32,
        major: 0,
        minor: 0,
        build: 0,
        platform: 0,
        service_pack: [0; 128],
    };
    (version(&mut info) == 0).then_some((info.major, info.build))
}
/// Whether screenshots, recordings and shared screens show the pet (owner 10-20: a switch, on by default).
static CAPTURE_SHOWN: AtomicBool = AtomicBool::new(true);
unsafe fn sync_capture(window: HWND) {
    if windows_version().is_some_and(|(major, build)| major > 10 || (major == 10 && build >= 19041))
    {
        let affinity = if CAPTURE_SHOWN.load(Ordering::Relaxed) {
            WDA_NONE
        } else {
            WDA_EXCLUDEFROMCAPTURE
        };
        let _ = SetWindowDisplayAffinity(window, affinity);
    }
}
unsafe extern "system" fn sync_capture_each(window: HWND, _: LPARAM) -> BOOL {
    sync_capture(window);
    TRUE
}
/// The switch applied to every window the pet has open; windows made later read it as they are made.
unsafe fn set_capture(shown: bool) {
    CAPTURE_SHOWN.store(shown, Ordering::Relaxed);
    let _ = EnumThreadWindows(GetCurrentThreadId(), Some(sync_capture_each), LPARAM(0));
}

/// Optional Windows 10 1903+ exports; classic OS menu styling remains the fallback.
unsafe fn sync_native_menu_theme(module: &mut Option<SystemModule>) {
    if module.is_none() {
        if !windows_version()
            .is_some_and(|(major, build)| major > 10 || (major == 10 && build >= 18362))
        {
            return;
        }
        let Ok(loaded) = LoadLibraryExW(w!("uxtheme.dll"), None, LOAD_LIBRARY_SEARCH_SYSTEM32)
        else {
            return;
        };
        *module = Some(SystemModule(loaded));
    }
    // Preferred app mode lives in uxtheme; keep its module resident until State drops.
    let module = module.as_ref().unwrap();
    type PreferredMode = unsafe extern "system" fn(i32) -> i32;
    type Flush = unsafe extern "system" fn();
    if let Some(function) = GetProcAddress(module.0, PCSTR(135usize as *const u8)) {
        let preferred: PreferredMode = std::mem::transmute(function);
        preferred(1); // AllowDark follows the OS setting rather than forcing dark.
        if let Some(function) = GetProcAddress(module.0, PCSTR(136usize as *const u8)) {
            let flush: Flush = std::mem::transmute(function);
            flush();
        }
    }
}

/// Input age is sampled only at a task's quiet event. There is no idle polling timer.
unsafe fn idle_input_ms() -> Option<u64> {
    let mut input = LASTINPUTINFO {
        cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };
    GetLastInputInfo(&mut input).as_bool().then(|| {
        // LASTINPUTINFO is a wrapping DWORD; compare within that clock's domain.
        (GetTickCount64() as u32).wrapping_sub(input.dwTime) as u64
    })
}
unsafe fn initial_session_locked() -> Option<bool> {
    let mut buffer = PWSTR::null();
    let mut bytes = 0;
    WTSQuerySessionInformationW(
        HANDLE::default(),
        WTS_CURRENT_SESSION,
        WTSSessionInfoEx,
        &mut buffer,
        &mut bytes,
    )
    .ok()?;
    let locked = if bytes as usize >= std::mem::size_of::<WTSINFOEXW>() {
        let info = std::ptr::read_unaligned(buffer.0 as *const WTSINFOEXW);
        if info.Level == 1 {
            native_place::session_locked(info.Data.WTSInfoExLevel1.SessionFlags)
        } else {
            None
        }
    } else {
        None
    };
    WTSFreeMemory(buffer.0.cast());
    locked
}

/// Ownership transfers to the parent menu only after AppendMenuW succeeds.
struct Popup(HMENU);
impl Popup {
    unsafe fn new(rows: &[native_menu::Item]) -> Result<Self, Error> {
        let menu = Self(CreatePopupMenu()?);
        for row in rows {
            if row.separator {
                AppendMenuW(menu.0, MF_SEPARATOR, 0, PCWSTR::null())?;
                continue;
            }
            let label = wide(&row.label);
            let mut flags = MF_STRING;
            if !row.enabled {
                flags |= MF_GRAYED;
            }
            if row.checked {
                flags |= MF_CHECKED;
            }
            if row.children.is_empty() {
                AppendMenuW(menu.0, flags, row.command as usize, PCWSTR(label.as_ptr()))?;
            } else {
                let child = Self::new(&row.children)?;
                AppendMenuW(
                    menu.0,
                    flags | MF_POPUP,
                    child.0 .0 as usize,
                    PCWSTR(label.as_ptr()),
                )?;
                std::mem::forget(child);
            }
        }
        Ok(menu)
    }
}
impl Drop for Popup {
    fn drop(&mut self) {
        unsafe {
            let _ = DestroyMenu(self.0);
        }
    }
}

struct Tray {
    data: NOTIFYICONDATAW,
    icon: HICON,
    state: Option<(bool, usize)>,
    assets: PathBuf,
    tooltip: String,
    icon_key: Option<native_tray::IconKey>,
    dpi: u32,
    dpi_dirty: bool,
    window_dpi: Option<WindowDpi>,
    monitor_dpi: Option<MonitorDpi>,
}
impl Tray {
    unsafe fn new(
        hwnd: HWND,
        assets: &Path,
        dpi: &Dpi,
        record: &crate::feed::Record,
    ) -> Result<Self, Error> {
        let mut tray = Self {
            data: NOTIFYICONDATAW {
                cbSize: std::mem::size_of::<NOTIFYICONDATAW>() as u32,
                hWnd: hwnd,
                uID: 1,
                uCallbackMessage: TRAY_EVENT,
                uFlags: NIF_MESSAGE | NIF_ICON | NIF_TIP,
                ..Default::default()
            },
            icon: HICON::default(),
            state: None,
            assets: assets.into(),
            tooltip: String::new(),
            icon_key: None,
            dpi: 96,
            dpi_dirty: true,
            window_dpi: dpi.window,
            monitor_dpi: dpi.monitor,
        };
        tray.update(
            false,
            0,
            &crate::platform_words::initial_tray_tooltip(record),
        )?;
        Ok(tray)
    }
    unsafe fn update(&mut self, asleep: bool, unseen: usize, tooltip: &str) -> Result<(), Error> {
        if self.dpi_dirty {
            self.dpi = self.taskbar_dpi();
            self.dpi_dirty = false;
        }
        let icon_key = native_tray::icon_key(asleep, unseen, self.dpi);
        let key = (asleep, unseen);
        let old = self.state;
        if old == Some(key) && self.tooltip == tooltip && self.icon_key == Some(icon_key) {
            return Ok(());
        }
        if self.icon_key != Some(icon_key) {
            let name = icon_key.image;
            let path = wide(self.assets.join("icons").join(format!("tray-{name}.ico")));
            let icon = HICON(
                LoadImageW(
                    None,
                    PCWSTR(path.as_ptr()),
                    IMAGE_ICON,
                    icon_key.size as i32,
                    icon_key.size as i32,
                    LR_LOADFROMFILE,
                )?
                .0,
            );
            let previous = self.icon;
            self.icon = icon;
            self.data.hIcon = icon;
            self.icon_key = Some(icon_key);
            if !previous.0.is_null() {
                let _ = DestroyIcon(previous);
            }
        }
        self.data.szTip.fill(0);
        for (target, value) in self
            .data
            .szTip
            .iter_mut()
            .take(127)
            .zip(tooltip.encode_utf16())
        {
            *target = value;
        }
        if !Shell_NotifyIconW(if old.is_some() { NIM_MODIFY } else { NIM_ADD }, &self.data)
            .as_bool()
        {
            return Err(windows::core::Error::from_win32().into());
        }
        self.state = Some(key);
        self.tooltip = tooltip.into();
        Ok(())
    }
    unsafe fn explorer_restarted(&mut self) {
        self.dpi_dirty = true;
        let _ = Shell_NotifyIconW(NIM_ADD, &self.data);
    }
    unsafe fn taskbar_dpi(&self) -> u32 {
        let identity = NOTIFYICONIDENTIFIER {
            cbSize: std::mem::size_of::<NOTIFYICONIDENTIFIER>() as u32,
            hWnd: self.data.hWnd,
            uID: self.data.uID,
            ..Default::default()
        };
        if let (Ok(rect), Some(get)) = (Shell_NotifyIconGetRect(&identity), self.monitor_dpi) {
            let (mut x, mut y) = (0, 0);
            if get(
                MonitorFromRect(&rect, MONITOR_DEFAULTTONEAREST),
                0,
                &mut x,
                &mut y,
            )
            .is_ok()
                && x != 0
            {
                return x;
            }
        }
        let taskbar = FindWindowW(w!("Shell_TrayWnd"), None).unwrap_or(self.data.hWnd);
        if let Some(get) = self.window_dpi {
            let dpi = get(taskbar);
            if dpi != 0 {
                return dpi;
            }
        }
        let dc = GetDC(taskbar);
        let dpi = GetDeviceCaps(dc, LOGPIXELSX).max(96) as u32;
        let _ = ReleaseDC(taskbar, dc);
        dpi
    }
}
impl Drop for Tray {
    fn drop(&mut self) {
        unsafe {
            let _ = Shell_NotifyIconW(NIM_DELETE, &self.data);
            if !self.icon.0.is_null() {
                let _ = DestroyIcon(self.icon);
            }
        }
    }
}

/// Called by the Windows uninstaller before removing the companion folder.
/// Without our matching receipt this preserves the shortcut, including older versions.
pub fn uninstall_notice_shortcut(folder: &Path) -> Result<(), Error> {
    let mut shell = native_notice_shortcut::NoticeShortcut { folder };
    crate::windows_notice_shortcut::Lifecycle::default().uninstall(&mut shell)?;
    Ok(())
}

fn xml_escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
fn duration(ms: u64, lang: &str) -> String {
    let s = ms / 1000;
    let (index, numbers) = if s < 60 {
        (0, vec![s])
    } else if s < 600 {
        (1, vec![s / 60, s % 60])
    } else if s < 3600 {
        (2, vec![s / 60])
    } else if s < 86_400 {
        (3, vec![s / 3600, s % 3600 / 60])
    } else {
        (4, vec![s / 86_400, s % 86_400 / 3600])
    };
    let words: serde_json::Value =
        serde_json::from_str(include_str!("../../assets/words/0.2.json")).unwrap();
    let formats = words["durations"]
        .get(lang)
        .or_else(|| words["durations"].get("en"));
    let format = formats
        .and_then(|formats| formats.get(index))
        .and_then(serde_json::Value::as_str)
        .unwrap_or("12m");
    let mut out = String::new();
    let mut digits = false;
    let mut n = 0;
    for c in format.chars() {
        if c.is_ascii_digit() {
            if !digits {
                out.push_str(&numbers.get(n).copied().unwrap_or(0).to_string());
                n += 1;
            }
            digits = true;
        } else {
            digits = false;
            out.push(c);
        }
    }
    out
}
struct NoticeService {
    shortcut: crate::windows_notice_shortcut::Lifecycle,
    gate: notice_gate::NoticeGate,
    retained: Vec<ToastNotification>,
}
impl NoticeService {
    fn new() -> Self {
        Self {
            shortcut: crate::windows_notice_shortcut::Lifecycle::default(),
            gate: notice_gate::NoticeGate::default(),
            retained: Vec::new(),
        }
    }
    unsafe fn post(
        &mut self,
        body: &str,
        name: &str,
        project: &str,
        receiver: HWND,
        target: Option<HWND>,
    ) -> Result<(), Error> {
        self.post_opening(body, name, project, receiver, target, false)
    }
    /// A notification whose click opens `target`'s window, the Activity window, or with `dm` her DM thread.
    unsafe fn post_opening(
        &mut self,
        body: &str,
        name: &str,
        project: &str,
        receiver: HWND,
        target: Option<HWND>,
        dm: bool,
    ) -> Result<(), Error> {
        let document = XmlDocument::new()?;
        document.LoadXml(&HSTRING::from(format!(
            "<toast><visual><binding template=\"ToastGeneric\"><text>{}</text><text>{}</text></binding></visual><audio silent=\"true\"/></toast>", xml_escape(name), xml_escape(body))))?;
        let toast = ToastNotification::CreateToastNotification(&document)?;
        // Tags/groups are bounded to 16 UTF-16 characters by the Windows API.
        let group: String = project.chars().take(16).collect();
        toast.SetGroup(&HSTRING::from(group))?;
        let receiver = receiver.0 as usize;
        let target = target.map(|window| window.0 as usize).unwrap_or(0);
        toast.Activated(&windows::Foundation::TypedEventHandler::new(move |_, _| {
            let _ = PostMessageW(
                HWND(receiver as *mut c_void),
                NOTICE_ACTIVATE,
                WPARAM(target),
                LPARAM(dm as isize),
            );
            Ok(())
        }))?;
        ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(APP_ID))?
            .Show(&toast)?;
        self.retained.push(toast);
        // Event handlers stay alive through the notification's useful lifetime.
        if self.retained.len() > 64 {
            self.retained.remove(0);
        }
        Ok(())
    }
}

type SetDpiContext = unsafe extern "system" fn(DPI_AWARENESS_CONTEXT) -> BOOL;
type WindowDpi = unsafe extern "system" fn(HWND) -> u32;
type ProcessDpi = unsafe extern "system" fn(i32) -> windows::core::HRESULT;
type MonitorDpi =
    unsafe extern "system" fn(HMONITOR, i32, *mut u32, *mut u32) -> windows::core::HRESULT;
struct SystemModule(HMODULE);
impl Drop for SystemModule {
    fn drop(&mut self) {
        unsafe {
            let _ = FreeLibrary(self.0);
        }
    }
}
/// Win10 1507/1511 have per-monitor v1 but lack the later user32 entry points.
/// Optional functions are resolved by name, so they never become required PE imports.
struct Dpi {
    window: Option<WindowDpi>,
    monitor: Option<MonitorDpi>,
    _shcore: Option<SystemModule>,
}
impl Dpi {
    unsafe fn initialize() -> Self {
        let user32 = GetModuleHandleW(w!("user32.dll")).ok();
        let context: Option<SetDpiContext> = user32
            .and_then(|module| {
                GetProcAddress(module, PCSTR(b"SetProcessDpiAwarenessContext\0".as_ptr()))
            })
            .map(|function| std::mem::transmute(function));
        let window: Option<WindowDpi> = user32
            .and_then(|module| GetProcAddress(module, PCSTR(b"GetDpiForWindow\0".as_ptr())))
            .map(|function| std::mem::transmute(function));
        let shcore = LoadLibraryExW(w!("shcore.dll"), None, LOAD_LIBRARY_SEARCH_SYSTEM32)
            .ok()
            .map(SystemModule);
        let process: Option<ProcessDpi> = shcore
            .as_ref()
            .and_then(|module| {
                GetProcAddress(module.0, PCSTR(b"SetProcessDpiAwareness\0".as_ptr()))
            })
            .map(|function| std::mem::transmute(function));
        let monitor: Option<MonitorDpi> = shcore
            .as_ref()
            .and_then(|module| GetProcAddress(module.0, PCSTR(b"GetDpiForMonitor\0".as_ptr())))
            .map(|function| std::mem::transmute(function));
        // V2 where supported; the older per-monitor context or shcore v1 otherwise. A
        // pre-existing manifest context is retained if Windows refuses a second selection.
        let aware = context.is_some_and(|set| {
            set(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2).as_bool()
                || set(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE).as_bool()
        });
        if !aware && !process.is_some_and(|set| set(2).is_ok()) {
            let _ = SetProcessDPIAware();
        }
        Self {
            window,
            monitor,
            _shcore: shcore,
        }
    }
    unsafe fn for_window(&self, window: HWND) -> u32 {
        if let Some(get) = self.window {
            let dpi = get(window);
            if dpi != 0 {
                return dpi;
            }
        }
        if let Some(get) = self.monitor {
            let mut x = 0;
            let mut y = 0;
            if get(
                MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST),
                0,
                &mut x,
                &mut y,
            )
            .is_ok()
                && x != 0
            {
                return x;
            }
        }
        let dc = GetDC(window);
        if dc.is_invalid() {
            return 96;
        }
        let dpi = GetDeviceCaps(dc, LOGPIXELSX).max(96) as u32;
        let _ = ReleaseDC(window, dc);
        dpi
    }
}

struct OwnedHandle(HANDLE);
impl Drop for OwnedHandle {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

/// The buffer and OVERLAPPED stay at fixed addresses until cancellation has completed.
struct DirectoryWatch {
    directory: OwnedHandle,
    event: OwnedHandle,
    overlapped: Box<OVERLAPPED>,
    buffer: Box<[u8; 16_384]>,
    path: PathBuf,
}
impl DirectoryWatch {
    unsafe fn open(path: &Path) -> Result<Self, Error> {
        let name = wide(path);
        let directory = OwnedHandle(CreateFileW(
            PCWSTR(name.as_ptr()),
            FILE_LIST_DIRECTORY.0,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            None,
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OVERLAPPED,
            None,
        )?);
        let event = OwnedHandle(CreateEventW(None, true, false, None)?);
        let mut result = Self {
            directory,
            event,
            overlapped: Box::default(),
            buffer: Box::new([0; 16_384]),
            path: path.into(),
        };
        result.arm()?;
        Ok(result)
    }
    unsafe fn arm(&mut self) -> Result<(), Error> {
        ResetEvent(self.event.0)?;
        *self.overlapped = OVERLAPPED::default();
        self.overlapped.hEvent = self.event.0;
        ReadDirectoryChangesW(
            self.directory.0,
            self.buffer.as_mut_ptr().cast(),
            self.buffer.len() as u32,
            false,
            FILE_NOTIFY_CHANGE_FILE_NAME
                | FILE_NOTIFY_CHANGE_DIR_NAME
                | FILE_NOTIFY_CHANGE_LAST_WRITE
                | FILE_NOTIFY_CHANGE_SIZE,
            None,
            Some(&mut *self.overlapped),
            None,
        )?;
        Ok(())
    }
    unsafe fn consume(&mut self) -> Result<(), Error> {
        let mut transferred = 0;
        GetOverlappedResult(self.directory.0, &*self.overlapped, &mut transferred, false)?;
        // Read the authoritative files after every event, including an overflow (0 bytes).
        self.arm()
    }
}
impl Drop for DirectoryWatch {
    fn drop(&mut self) {
        unsafe {
            let _ = CancelIoEx(self.directory.0, Some(&*self.overlapped));
            let mut transferred = 0;
            let _ =
                GetOverlappedResult(self.directory.0, &*self.overlapped, &mut transferred, true);
        }
    }
}

/// Watch a missing folder's nearest existing ancestor. Always watch a parent as well,
/// because Windows can report a watched directory's deletion as an I/O cancellation.
unsafe fn rebuild_watches(targets: &[PathBuf], trace: bool) -> Result<Vec<DirectoryWatch>, Error> {
    let mut wanted = Vec::new();
    for target in targets {
        wanted.push(target.as_path());
        if let Some(parent) = target.parent() {
            wanted.push(parent);
        }
    }
    let mut watches: Vec<DirectoryWatch> = Vec::new();
    let mut failure = None;
    for start in wanted {
        let mut path = Some(start);
        while let Some(candidate) = path {
            if candidate.is_dir() {
                if watches.iter().any(|watch| watch.path == candidate) {
                    break;
                }
                match DirectoryWatch::open(candidate) {
                    Ok(watch) => {
                        watches.push(watch);
                        break;
                    }
                    Err(error) => {
                        if trace {
                            eprintln!(
                                "directory watch unavailable: {}: {error}",
                                candidate.display()
                            );
                        }
                        failure = Some(error);
                    }
                }
            }
            path = candidate.parent();
        }
    }
    if watches.is_empty() {
        return Err(
            failure.unwrap_or_else(|| "No companion directory ancestor can be watched".into())
        );
    }
    Ok(watches)
}

struct Dib {
    dc: HDC,
    bitmap: HBITMAP,
    previous: HGDIOBJ,
    data: *mut u8,
    width: u32,
    height: u32,
}
impl Dib {
    unsafe fn new(width: u32, height: u32) -> Result<Self, Error> {
        let dc = CreateCompatibleDC(None);
        if dc.is_invalid() {
            return Err(windows::core::Error::from_win32().into());
        }
        let info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width as i32,
                biHeight: -(height as i32),
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut bits = ptr::null_mut();
        let bitmap = match CreateDIBSection(dc, &info, DIB_RGB_COLORS, &mut bits, None, 0) {
            Ok(bitmap) => bitmap,
            Err(error) => {
                let _ = DeleteDC(dc);
                return Err(error.into());
            }
        };
        let previous = SelectObject(dc, bitmap);
        Ok(Self {
            dc,
            bitmap,
            previous,
            data: bits.cast(),
            width,
            height,
        })
    }
    unsafe fn bytes(&mut self) -> &mut [u8] {
        std::slice::from_raw_parts_mut(self.data, (self.width * self.height * 4) as usize)
    }
}
impl Drop for Dib {
    fn drop(&mut self) {
        unsafe {
            SelectObject(self.dc, self.previous);
            let _ = DeleteObject(self.bitmap);
            let _ = DeleteDC(self.dc);
        }
    }
}

struct FrontPages {
    window: HWND,
    dib: Dib,
}
impl FrontPages {
    unsafe fn new(owner: HWND, width: u32, height: u32) -> Result<Self, Error> {
        let dib = Dib::new(width, height)?;
        let instance = GetModuleHandleW(None)?;
        let window = CreateWindowExW(
            WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT,
            w!("CocoRustFrontPages"),
            w!(""),
            WS_POPUP,
            0,
            0,
            width as i32,
            height as i32,
            owner,
            None,
            instance,
            None,
        )?;
        sync_capture(window);
        Ok(Self { window, dib })
    }
}
impl Drop for FrontPages {
    fn drop(&mut self) {
        unsafe {
            let _ = DestroyWindow(self.window);
        }
    }
}
unsafe extern "system" fn front_pages_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match message {
        WM_NCHITTEST => LRESULT(HTTRANSPARENT as isize),
        WM_MOUSEACTIVATE => LRESULT(MA_NOACTIVATE as isize),
        WM_GETOBJECT => LRESULT(0),
        _ => DefWindowProcW(hwnd, message, wparam, lparam),
    }
}

/// DirectWrite chooses script-specific fonts through the system fallback collection. Direct2D
/// rasterizes that shaped layout into a premultiplied text layer, then we composite it ourselves.
struct TextRenderer {
    write: IDWriteFactory,
    fonts: IDWriteFontCollection,
    target: ID2D1DCRenderTarget,
    layer: Option<Dib>,
    last: Option<(
        String,
        String,
        u32,
        u32,
        (u64, Option<u64>),
        u16,
        [u8; 4],
        usize,
        bool,
        bool,
        bool,
        bool,
    )>,
    style: (bool, [u8; 4]),
    prefix: usize,
    measurement: Option<(String, String, u64, u64, u64, Option<u64>, (f64, f64))>,
    sans: bool,
    middle: bool,
    bubble: bool,
    weight: u16,
    nowrap: bool,
}
impl TextRenderer {
    unsafe fn new() -> Result<Self, Error> {
        let write: IDWriteFactory = DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED)?;
        let mut fonts = None;
        write.GetSystemFontCollection(&mut fonts, false)?;
        let factory: ID2D1Factory = D2D1CreateFactory(D2D1_FACTORY_TYPE_SINGLE_THREADED, None)?;
        let target = factory.CreateDCRenderTarget(&D2D1_RENDER_TARGET_PROPERTIES {
            r#type: D2D1_RENDER_TARGET_TYPE_SOFTWARE,
            pixelFormat: D2D1_PIXEL_FORMAT {
                format: DXGI_FORMAT_B8G8R8A8_UNORM,
                alphaMode: D2D1_ALPHA_MODE_PREMULTIPLIED,
            },
            dpiX: 96.0,
            dpiY: 96.0,
            usage: D2D1_RENDER_TARGET_USAGE_NONE,
            minLevel: D2D1_FEATURE_LEVEL_DEFAULT,
        })?;
        target.SetTextAntialiasMode(D2D1_TEXT_ANTIALIAS_MODE_GRAYSCALE);
        Ok(Self {
            write,
            fonts: fonts.ok_or("Windows system font collection unavailable")?,
            target,
            layer: None,
            last: None,
            style: (false, [35, 27, 25, 255]),
            prefix: 0,
            measurement: None,
            sans: false,
            middle: false,
            bubble: false,
            weight: 400,
            nowrap: false,
        })
    }
    unsafe fn layout(
        &self,
        text: &TextRun,
        width: f32,
        height: f32,
    ) -> Result<IDWriteTextLayout, Error> {
        let lang = wide(&text.lang);
        let family_name = native_measure::family(&self.fonts, &text.lang, self.sans)?;
        let family = wide(&family_name);
        let format = self.write.CreateTextFormat(
            PCWSTR(family.as_ptr()),
            None,
            DWRITE_FONT_WEIGHT(self.weight as i32),
            DWRITE_FONT_STYLE_NORMAL,
            DWRITE_FONT_STRETCH_NORMAL,
            text.font_size as f32,
            PCWSTR(lang.as_ptr()),
        )?;
        native_measure::apply_line_height(
            &self.fonts,
            &format,
            &family_name,
            text.font_size,
            self.weight,
            text.line_height,
        )?;
        format.SetWordWrapping(if self.middle || self.nowrap {
            DWRITE_WORD_WRAPPING_NO_WRAP
        } else if text.lang.split('-').next() == Some("ko") {
            DWRITE_WORD_WRAPPING_WHOLE_WORD
        } else {
            DWRITE_WORD_WRAPPING_WRAP
        })?;
        if text.lang == "ar" {
            format.SetReadingDirection(DWRITE_READING_DIRECTION_RIGHT_TO_LEFT)?;
        }
        let ellipsis = self.write.CreateEllipsisTrimmingSign(&format)?;
        format.SetTrimming(
            &DWRITE_TRIMMING {
                granularity: DWRITE_TRIMMING_GRANULARITY_CHARACTER,
                delimiter: 0,
                delimiterCount: 0,
            },
            &ellipsis,
        )?;
        let guarded = crate::render::korean_word_guard(&text.text, &text.lang);
        let mut words: Vec<u16> = guarded.text.encode_utf16().collect();
        if self.middle && !words.is_empty() {
            let full = self
                .write
                .CreateTextLayout(&words, &format, 1_000_000., height.max(1.))?;
            let mut metrics = DWRITE_TEXT_METRICS::default();
            full.GetMetrics(&mut metrics)?;
            if metrics.widthIncludingTrailingWhitespace > width {
                let mut count = 0;
                let _ = full.GetClusterMetrics(None, &mut count);
                if count > 32_768 {
                    return Err("native text cluster count exceeds bound".into());
                }
                let mut clusters = vec![DWRITE_CLUSTER_METRICS::default(); count as usize];
                full.GetClusterMetrics(Some(&mut clusters), &mut count)?;
                let mut boundaries = vec![0usize];
                for cluster in &clusters {
                    boundaries.push(boundaries.last().unwrap() + cluster.length as usize);
                }
                let make = |keep: usize| {
                    let left = boundaries[keep.div_ceil(2)];
                    let right = boundaries[clusters.len() - keep / 2];
                    words[..left]
                        .iter()
                        .copied()
                        .chain([0x2026])
                        .chain(words[right..].iter().copied())
                        .collect::<Vec<_>>()
                };
                let (mut low, mut high) = (0, clusters.len());
                while low < high {
                    let keep = (low + high).div_ceil(2);
                    let candidate = make(keep);
                    let candidate = self.write.CreateTextLayout(
                        &candidate,
                        &format,
                        1_000_000.,
                        height.max(1.),
                    )?;
                    candidate.GetMetrics(&mut metrics)?;
                    if metrics.widthIncludingTrailingWhitespace <= width {
                        low = keep;
                    } else {
                        high = keep - 1;
                    }
                }
                words = make(low);
            }
        }
        let layout = self
            .write
            .CreateTextLayout(&words, &format, width.max(1.), height.max(1.))?;
        if self.prefix > 0 {
            let length = guarded.utf16_prefix(self.prefix) as u32;
            layout.SetFontWeight(
                DWRITE_FONT_WEIGHT_SEMI_BOLD,
                DWRITE_TEXT_RANGE {
                    startPosition: 0,
                    length,
                },
            )?;
        }
        Ok(layout)
    }
    /// Shape against native fallback fonts before choosing the bubble height. Five complete
    /// native lines are the maximum; an ellipsis represents overflow rather than half a glyph.
    unsafe fn measure(&mut self, text: &TextRun) -> Result<(f64, f64), Error> {
        let key = (
            text.text.clone(),
            text.lang.clone(),
            text.font_size.to_bits(),
            text.width.to_bits(),
            text.height.to_bits(),
            text.line_height.map(f64::to_bits),
        );
        if let Some((words, lang, font, width, height, line_height, result)) = &self.measurement {
            if (words, lang, *font, *width, *height, *line_height)
                == (&key.0, &key.1, key.2, key.3, key.4, key.5)
            {
                return Ok(*result);
            }
        }
        let padding = (text.font_size * 2. / 15.).max(1.);
        let layout = self.layout(text, (text.width - 2. * padding).max(1.) as f32, 50_000.)?;
        let mut metrics = DWRITE_TEXT_METRICS::default();
        layout.GetMetrics(&mut metrics)?;
        let mut count = 0;
        let _ = layout.GetLineMetrics(None, &mut count);
        if count > 8192 {
            return Err("native text line count exceeds bound".into());
        }
        let mut lines = vec![DWRITE_LINE_METRICS::default(); count as usize];
        if count > 0 {
            layout.GetLineMetrics(Some(&mut lines), &mut count)?;
        }
        let native_height = if lines.is_empty() {
            text.font_size * 2.
        } else {
            let budget = (text.height - 2. * padding).max(text.font_size);
            let mut used = 0.;
            for line in lines.iter().take(5) {
                let height = line.height as f64;
                if used > 0. && used + height > budget {
                    break;
                }
                used += height;
            }
            used
        };
        let result = (
            (metrics.widthIncludingTrailingWhitespace as f64 + 2. * padding)
                .ceil()
                .clamp(1., text.width.max(1.)),
            (native_height + 2. * padding).ceil().max(1.),
        );
        self.measurement = Some((key.0, key.1, key.2, key.3, key.4, key.5, result));
        Ok(result)
    }
    unsafe fn draw(&mut self, canvas: &mut Canvas, text: &TextRun) -> Result<(), Error> {
        let width = text.width.ceil().max(1.0) as u32;
        let height = text.height.ceil().max(1.0) as u32;
        if self
            .layer
            .as_ref()
            .is_none_or(|v| v.width != width || v.height != height)
        {
            self.layer = Some(Dib::new(width, height)?)
        }
        let signature = (
            text.text.clone(),
            text.lang.clone(),
            width,
            height,
            (text.font_size.to_bits(), text.line_height.map(f64::to_bits)),
            self.weight,
            self.style.1,
            self.prefix,
            self.sans,
            self.middle,
            self.bubble,
            self.nowrap,
        );
        if self.last.as_ref() != Some(&signature) {
            let padding = if self.bubble {
                (text.font_size * 2. / 15.).max(1.) as f32
            } else {
                0.
            };
            let layout = self.layout(
                text,
                (width as f32 - 2. * padding).max(1.),
                (height as f32 - 2. * padding).max(1.),
            )?;
            let layer = self.layer.as_mut().unwrap();
            layer.bytes().fill(0);
            self.target.BindDC(
                layer.dc,
                &RECT {
                    left: 0,
                    top: 0,
                    right: width as i32,
                    bottom: height as i32,
                },
            )?;
            let brush = self.target.CreateSolidColorBrush(
                &D2D1_COLOR_F {
                    r: self.style.1[0] as f32 / 255.0,
                    g: self.style.1[1] as f32 / 255.0,
                    b: self.style.1[2] as f32 / 255.0,
                    a: self.style.1[3] as f32 / 255.0,
                },
                None,
            )?;
            self.target.BeginDraw();
            self.target.Clear(Some(&D2D1_COLOR_F {
                r: 0.0,
                g: 0.0,
                b: 0.0,
                a: 0.0,
            }));
            self.target.DrawTextLayout(
                D2D_POINT_2F {
                    x: padding,
                    y: padding,
                },
                &layout,
                &brush,
                D2D1_DRAW_TEXT_OPTIONS_CLIP,
            );
            self.target.EndDraw(None, None)?;
            self.last = Some(signature);
        }
        let layer = self.layer.as_mut().unwrap();
        let left = text.x.round() as i32;
        let top = text.y.round() as i32;
        for y in 0..height as i32 {
            for x in 0..width as i32 {
                let dx = left + x;
                let dy = top + y;
                if dx < 0 || dy < 0 || dx >= canvas.width as i32 || dy >= canvas.height as i32 {
                    continue;
                }
                let src = ((y as u32 * width + x as u32) * 4) as usize;
                let dst = ((dy as u32 * canvas.width + dx as u32) * 4) as usize;
                let layer = layer.bytes();
                let alpha = layer[src + 3] as u16;
                let remain = 255 - alpha;
                for (output, input) in [(0, 2), (1, 1), (2, 0), (3, 3)] {
                    canvas.pixels[dst + output] = (layer[src + input] as u16
                        + (canvas.pixels[dst + output] as u16 * remain + 127) / 255)
                        .min(255) as u8;
                }
            }
        }
        Ok(())
    }
}

struct Press {
    pointer: POINT,
    origin: POINT,
    alternate: bool,
    dragged: bool,
    held: bool,
}
#[derive(Clone, Copy)]
enum Manual {
    Screen { fx: f64, fy: f64 },
    Window { corner: u8, dx: i32, dy: i32 },
}
struct State {
    engine: Engine,
    options: Options,
    hwnd: HWND,
    speech: HWND,
    ui_window: HWND,
    edit: HWND,
    edit_font: HFONT,
    edit_font_scale: f64,
    edit_font_family: String,
    edit_text: String,
    edit_selection: (usize, usize),
    edit_brush: HBRUSH,
    ui_dib: Option<Dib>,
    ui_position: POINT,
    ui_canvas: Option<Canvas>,
    surrogate: Option<u16>,
    previous_focus: HWND,
    tray: Option<Tray>,
    menu_theme: Option<SystemModule>,
    explorer_message: u32,
    notices: NoticeService,
    locked: bool,
    accessibility: Option<native_accessibility::Bridge>,
    speech_flip: LineFlip,
    speech_alpha: f64,
    ui_flip: LineFlip,
    speech_dib: Option<Dib>,
    front_pages: Option<FrontPages>,
    front_page_gate: native_place::FrontPageGate,
    speech_position: POINT,
    canvas: Option<Canvas>,
    dib: Option<Dib>,
    text: TextRenderer,
    press: Option<Press>,
    follow: Option<HWND>,
    back_app: String,
    manual: Option<Manual>,
    position: POINT,
    scale: f64,
    failure: Option<String>,
    location_hook: Option<LocationHook>,
    drawing: bool,
    closed: bool,
    placed: bool,
    was_ledge: bool,
    place_mode: PlaceMode,
    geometry_live: bool,
    previous_target: Option<RECT>,
    relocation: bool,
    pending_placement: bool,
    departure_host: Option<RECT>,
    arrival_contact: Option<native_place::Placement>,
    contact_room: f64,
    active: bool,
}
impl State {
    fn fail(&mut self, error: impl std::fmt::Display) {
        self.failure = Some(error.to_string());
        unsafe { PostQuitMessage(1) }
    }
    unsafe fn draw(&mut self) -> Result<(), Error> {
        if self.drawing {
            return Ok(());
        }
        self.drawing = true;
        let result = self.draw_inner();
        self.drawing = false;
        result
    }
    unsafe fn draw_inner(&mut self) -> Result<(), Error> {
        if self.closed {
            return Ok(());
        }
        let now = epoch_ms();
        if self.relocation && !self.engine.relocation_ducking(now) {
            if let Some(contact) = self.arrival_contact.take() {
                self.engine.squeeze_contact(
                    contact.room,
                    contact.horizontal,
                    contact.push_sign,
                    now,
                );
                self.contact_room = contact.room;
            }
        }
        if self.relocation && !self.engine.placement_moving(now) {
            self.relocation = false;
            if std::mem::take(&mut self.pending_placement) {
                self.place();
            }
        }
        self.engine.ui.tick(now);
        self.engine.ui.context.back_available = self.follow.is_some();
        self.engine.ui.context.back_app = self.back_app.clone();
        self.engine.ui.context.following = self.follow.is_some();
        self.engine.ui.context.lines_hidden = self.engine.lines_hidden();
        self.engine.ui.context.size = self.engine.options.size;
        self.sync_tray(now)?;
        let hidden = self.engine.is_hidden(now);
        self.engine.set_visible(!hidden);
        let _ = ShowWindow(self.hwnd, if hidden { SW_HIDE } else { SW_SHOWNOACTIVATE });
        if hidden {
            self.front_pages = None;
            self.front_page_gate.may_present(false);
            // Privacy expiry and shared quiet deadlines survive a hidden native window.
            self.engine.maintain(now);
            self.draw_ui(now)?;
            self.sync_accessibility();
            let _ = ShowWindow(self.speech, SW_HIDE);
            self.arm(now);
            return Ok(());
        }
        let previous_side = self
            .speech_flip
            .sample(now, self.options.reduce_motion)
            .placement
            .map(|p| p.side)
            .unwrap_or(LineSide::Above);
        self.engine.set_speech_side(previous_side);
        self.sync_shed_context();
        let mut canvas = self.fitted_companion(now)?;
        self.draw_ui(now)?;
        self.sync_accessibility();
        if self
            .dib
            .as_ref()
            .is_none_or(|d| d.width != canvas.width || d.height != canvas.height)
        {
            self.dib = Some(Dib::new(canvas.width, canvas.height)?);
            self.speech_dib = Some(Dib::new(canvas.width, canvas.height)?);
            self.speech_position = POINT {
                x: i32::MIN,
                y: i32::MIN,
            };
            self.canvas = Some(canvas.clone());
            self.place();
        }
        let mut speech_origin = self.speech_origin(&canvas, now);
        let actual_side = self
            .speech_flip
            .sample(now, self.options.reduce_motion)
            .placement
            .map(|p| p.side)
            .unwrap_or(previous_side);
        if actual_side != previous_side {
            self.engine.set_speech_side(actual_side);
            canvas = self.fitted_companion(now)?;
            speech_origin = self.speech_origin(&canvas, now);
        }
        let speech_alpha = self.speech_alpha * self.engine.line_opacity(now);
        let speech_bounds = canvas.bubble.as_ref().map(|run| {
            if canvas.bubble_is_task {
                return (
                    (run.x - 30. * self.scale).floor() as i32,
                    (run.y - 10. * self.scale).floor() as i32,
                    (run.width + 48. * self.scale).ceil() as i32,
                    (39. * self.scale).ceil() as i32,
                );
            }
            (
                (run.x - 16. * self.scale).floor() as i32,
                (run.y - 10. * self.scale).floor() as i32,
                (run.width + 32. * self.scale).ceil() as i32,
                (run.height + 24. * self.scale).ceil() as i32,
            )
        });
        let shown_position = self.presentation_origin(now);
        let occluding = if self.press.as_ref().is_some_and(|p| p.dragged) {
            None
        } else if self.relocation && self.engine.relocation_ducking(now) {
            self.departure_host
        } else if self.place_mode == PlaceMode::Ledge {
            self.follow_rect()
        } else {
            None
        };
        let host = occluding.map(|r| ScreenRect {
            x: r.left as f64,
            y: r.top as f64,
            width: (r.right - r.left) as f64,
            height: (r.bottom - r.top) as f64,
        });
        let clip = native_place::host_clip(
            PlaceMode::Ledge,
            host,
            [shown_position.x as f64, shown_position.y as f64],
            [canvas.width as f64, canvas.height as f64],
        );
        // The optional foreground HUD may fail without taking away the companion.
        if self
            .draw_front_pages(&canvas, clip, shown_position)
            .is_err()
        {
            self.front_page_gate.failed();
            self.front_pages = None;
        }
        let dib = self.dib.as_mut().unwrap();
        let speech = self.speech_dib.as_mut().unwrap();
        let mut speech_changed =
            self.speech_position.x != speech_origin.x || self.speech_position.y != speech_origin.y;
        for (index, ((source, target), words)) in canvas
            .pixels
            .chunks_exact(4)
            .zip(dib.bytes().chunks_exact_mut(4))
            .zip(speech.bytes().chunks_exact_mut(4))
            .enumerate()
        {
            let pixel = [source[2], source[1], source[0], source[3]];
            let x = (index % canvas.width as usize) as i32;
            let y = (index / canvas.width as usize) as i32;
            let is_speech = speech_bounds.is_some_and(|(left, top, width, height)| {
                x >= left && x < left + width && y >= top && y < top + height
            });
            let occluded = clip.is_some_and(|clip| {
                (x as f64) >= clip.x
                    && (x as f64) < clip.right()
                    && (y as f64) >= clip.y
                    && (y as f64) < clip.bottom()
            });
            target.copy_from_slice(if is_speech || occluded {
                &[0; 4]
            } else {
                &pixel
            });
            let text_pixel = if is_speech {
                pixel.map(|value| (value as f64 * speech_alpha).round() as u8)
            } else {
                [0; 4]
            };
            if words != text_pixel {
                speech_changed = true;
                words.copy_from_slice(&text_pixel);
            }
        }
        if let Some(clip) = clip {
            for y in
                clip.y.floor().max(0.) as u32..clip.bottom().ceil().min(canvas.height as f64) as u32
            {
                for x in clip.x.floor().max(0.) as u32
                    ..clip.right().ceil().min(canvas.width as f64) as u32
                {
                    let index = (y * canvas.width + x) as usize * 4;
                    canvas.pixels[index..index + 4].fill(0);
                }
            }
        }
        let size = SIZE {
            cx: canvas.width as i32,
            cy: canvas.height as i32,
        };
        let blend = BLENDFUNCTION {
            BlendOp: AC_SRC_OVER as u8,
            BlendFlags: 0,
            SourceConstantAlpha: 255,
            AlphaFormat: AC_SRC_ALPHA as u8,
        };
        UpdateLayeredWindow(
            self.hwnd,
            None,
            Some(&shown_position),
            Some(&size),
            dib.dc,
            Some(&POINT { x: 0, y: 0 }),
            COLORREF(0),
            Some(&blend),
            ULW_ALPHA,
        )?;
        if !self.speech.0.is_null() {
            if canvas.bubble.is_some() {
                if speech_changed {
                    UpdateLayeredWindow(
                        self.speech,
                        None,
                        Some(&speech_origin),
                        Some(&size),
                        speech.dc,
                        Some(&POINT { x: 0, y: 0 }),
                        COLORREF(0),
                        Some(&blend),
                        ULW_ALPHA,
                    )?;
                    self.speech_position = speech_origin;
                }
                let _ = ShowWindow(self.speech, SW_SHOWNOACTIVATE);
            } else {
                let _ = ShowWindow(self.speech, SW_HIDE);
            }
        }
        self.canvas = Some(canvas);
        self.arm(now);
        Ok(())
    }
    unsafe fn draw_front_pages(
        &mut self,
        canvas: &Canvas,
        clip: Option<ScreenRect>,
        origin: POINT,
    ) -> Result<(), Error> {
        let pages = canvas
            .front_pages
            .as_deref()
            .filter(|pages| pages.width == canvas.width && pages.height == canvas.height);
        let host_visible = self
            .follow
            .is_some_and(|host| IsWindowVisible(host).as_bool());
        let masked = if self.options.reduce_motion || !host_visible || self.follow_rect().is_none()
        {
            None
        } else {
            pages.zip(clip).and_then(|(pages, clip)| {
                native_place::front_page_mask(pages.width, pages.height, &pages.pixels, clip)
            })
        };
        if !self.front_page_gate.may_present(masked.is_some()) {
            self.front_pages = None;
            return Ok(());
        }
        let pixels = masked.unwrap();
        if self.front_pages.as_ref().is_none_or(|layer| {
            layer.dib.width != canvas.width || layer.dib.height != canvas.height
        }) {
            self.front_pages = None;
            self.front_pages = Some(FrontPages::new(self.hwnd, canvas.width, canvas.height)?);
        }
        let layer = self.front_pages.as_mut().unwrap();
        for (source, target) in pixels
            .chunks_exact(4)
            .zip(layer.dib.bytes().chunks_exact_mut(4))
        {
            target.copy_from_slice(&[source[2], source[1], source[0], source[3]]);
        }
        let size = SIZE {
            cx: canvas.width as i32,
            cy: canvas.height as i32,
        };
        let blend = BLENDFUNCTION {
            BlendOp: AC_SRC_OVER as u8,
            BlendFlags: 0,
            SourceConstantAlpha: 255,
            AlphaFormat: AC_SRC_ALPHA as u8,
        };
        UpdateLayeredWindow(
            layer.window,
            None,
            Some(&origin),
            Some(&size),
            layer.dib.dc,
            Some(&POINT { x: 0, y: 0 }),
            COLORREF(0),
            Some(&blend),
            ULW_ALPHA,
        )?;
        let _ = ShowWindow(layer.window, SW_SHOWNOACTIVATE);
        Ok(())
    }
    unsafe fn sync_tray(&mut self, now: u64) -> Result<(), Error> {
        let state = crate::ui::tray_state(self.engine.sessions(), now as f64);
        let asleep = matches!(
            state.state,
            crate::ui::TrayHead::Asleep | crate::ui::TrayHead::AsleepUnseen
        );
        if let Some(tray) = self.tray.as_mut() {
            tray.update(asleep, state.unseen, &state.tooltip)?;
        }
        Ok(())
    }
    unsafe fn fitted_companion(&mut self, now: u64) -> Result<Canvas, Error> {
        let area = self.work_area();
        let origin = self.presentation_origin(now);
        self.engine.set_ui_viewport(Some(crate::ui::Rect {
            x: (area.left - origin.x) as f64 / self.scale,
            y: (area.top - origin.y) as f64 / self.scale,
            width: (area.right - area.left) as f64 / self.scale,
            height: (area.bottom - area.top) as f64 / self.scale,
        }));
        let mut canvas = self.engine.render_companion(now, self.scale);
        if let Some(mut text) = canvas.bubble.clone() {
            self.text.style = (false, canvas.bubble_ink());
            self.text.prefix = canvas.bubble_prefix;
            self.text.sans = false;
            self.text.middle = false;
            self.text.bubble = !canvas.bubble_is_task;
            self.text.weight = 400;
            self.text.nowrap = canvas.bubble_is_task;
            if !canvas.bubble_is_task {
                // Fit complete native shaped lines, then repaint the ribbon on the fitted paper.
                if self.engine.record().live_count >= 2 && self.engine.record().ribbon.is_some() {
                    let (x, y) = (
                        (text.x + 4. * self.scale).floor() as i32,
                        (text.y - 10. * self.scale).floor() as i32,
                    );
                    for yy in
                        y.max(0)..(y + (22. * self.scale).ceil() as i32).min(canvas.height as i32)
                    {
                        for xx in
                            x.max(0)..(x + (8. * self.scale).ceil() as i32).min(canvas.width as i32)
                        {
                            if !canvas.hit_test(xx, yy) {
                                let index = (yy as usize * canvas.width as usize + xx as usize) * 4;
                                canvas.pixels[index..index + 4].fill(0);
                            }
                        }
                    }
                }
                text.height = (canvas.sprite_bounds.1 as f64 - 28. * self.scale).max(1.);
                let (width, height) = self.text.measure(&text)?;
                canvas.fit_bubble(width, height, self.scale);
                self.engine.paint_pill_ribbon(&mut canvas, self.scale);
            }
            if let Some(fitted) = canvas.bubble.clone() {
                self.text.draw(&mut canvas, &fitted)?;
            }
        }
        for (index, run) in canvas.texts.clone().iter().enumerate() {
            self.text.style = canvas
                .text_styles
                .get(index)
                .copied()
                .unwrap_or((false, [35, 27, 25, 255]));
            self.text.prefix = canvas.text_prefixes.get(index).copied().unwrap_or(0);
            self.text.sans = canvas.text_sans.get(index).copied().unwrap_or(false);
            self.text.middle = canvas.text_middle.get(index).copied().unwrap_or(false);
            self.text.bubble = false;
            self.text.nowrap = false;
            self.text.weight = canvas
                .text_weights
                .get(index)
                .copied()
                .unwrap_or(if self.text.style.0 { 600 } else { 400 });
            self.text.draw(&mut canvas, run)?;
        }
        Ok(canvas)
    }
    unsafe fn sync_accessibility(&self) {
        if let Some(accessibility) = self.accessibility.as_ref() {
            accessibility.set_window(
                if self.engine.ui.surface() == Surface::Companion {
                    self.hwnd
                } else {
                    self.ui_window
                },
                self.scale,
            );
            accessibility.update(crate::accessibility::tree(
                &self.engine.ui,
                self.engine.record(),
            ));
        }
    }
    unsafe fn draw_ui(&mut self, _now: u64) -> Result<(), Error> {
        if self.ui_window.0.is_null() {
            return Ok(());
        }
        if self.engine.ui.surface() == Surface::Companion {
            let _ = ShowWindow(self.ui_window, SW_HIDE);
            return Ok(());
        }
        let activity_title = crate::platform_words::activity_title(&self.engine.ui.chosen)
            .encode_utf16()
            .chain(Some(0))
            .collect::<Vec<_>>();
        let _ = SetWindowTextW(self.ui_window, PCWSTR(activity_title.as_ptr()));
        let mut canvas = self.engine.ui.render(self.scale);
        for (index, run) in canvas.texts.clone().iter().enumerate() {
            self.text.style = canvas
                .text_styles
                .get(index)
                .copied()
                .unwrap_or((false, [35, 27, 25, 255]));
            self.text.prefix = canvas.text_prefixes.get(index).copied().unwrap_or(0);
            self.text.sans = canvas.text_sans.get(index).copied().unwrap_or(false);
            self.text.middle = canvas.text_middle.get(index).copied().unwrap_or(false);
            self.text.bubble = false;
            self.text.nowrap = false;
            self.text.weight = canvas
                .text_weights
                .get(index)
                .copied()
                .unwrap_or(if self.text.style.0 { 600 } else { 400 });
            let saved = canvas.save_text_clip(index);
            self.text.draw(&mut canvas, run)?;
            canvas.restore_text_clip(saved);
        }
        if self
            .ui_dib
            .as_ref()
            .is_none_or(|dib| dib.width != canvas.width || dib.height != canvas.height)
        {
            self.ui_dib = Some(Dib::new(canvas.width, canvas.height)?);
        }
        let area = self.work_area();
        let visible = ScreenRect {
            x: area.left as f64 / self.scale,
            y: area.top as f64 / self.scale,
            width: (area.right - area.left) as f64 / self.scale,
            height: (area.bottom - area.top) as f64 / self.scale,
        };
        let Some(placement) = crate::motion::line_placement(
            self.placement_sprite(),
            visible,
            [
                canvas.width as f64 / self.scale,
                canvas.height as f64 / self.scale,
            ],
            self.placement_mode(),
            self.ui_flip.current_side(),
            None,
        ) else {
            let _ = ShowWindow(self.ui_window, SW_HIDE);
            return Ok(());
        };
        self.ui_flip.change(placement, _now);
        let sample = self.ui_flip.sample(_now, self.options.reduce_motion);
        let placement = sample.placement.unwrap_or(placement);
        let (dx, dy) = match placement.side {
            LineSide::Above => (0., sample.slide),
            LineSide::Below => (0., -sample.slide),
            LineSide::Left => (sample.slide, 0.),
            LineSide::Right => (-sample.slide, 0.),
        };
        let dib = self.ui_dib.as_mut().unwrap();
        for (source, target) in canvas
            .pixels
            .chunks_exact(4)
            .zip(dib.bytes().chunks_exact_mut(4))
        {
            target.copy_from_slice(&[source[2], source[1], source[0], source[3]]);
        }
        self.ui_position = POINT {
            x: ((placement.frame.x + dx) * self.scale).round() as i32,
            y: ((placement.frame.y + dy) * self.scale).round() as i32,
        };
        UpdateLayeredWindow(
            self.ui_window,
            None,
            Some(&self.ui_position),
            Some(&SIZE {
                cx: canvas.width as i32,
                cy: canvas.height as i32,
            }),
            dib.dc,
            Some(&POINT::default()),
            COLORREF(0),
            Some(&BLENDFUNCTION {
                BlendOp: AC_SRC_OVER as u8,
                BlendFlags: 0,
                SourceConstantAlpha: (255. * sample.alpha).round() as u8,
                AlphaFormat: AC_SRC_ALPHA as u8,
            }),
            ULW_ALPHA,
        )?;
        self.ui_canvas = Some(canvas);
        let _ = ShowWindow(self.ui_window, SW_SHOWNOACTIVATE);
        self.sync_edit()?;
        Ok(())
    }
    unsafe fn sync_edit(&mut self) -> Result<(), Error> {
        let field = self
            .engine
            .ui
            .elements()
            .into_iter()
            .find(|element| element.control == crate::ui::Control::Field);
        let Some(field) = field else {
            let _ = ShowWindow(self.edit, SW_HIDE);
            return Ok(());
        };
        if self.engine.ui.surface() != Surface::Activity {
            let _ = ShowWindow(self.edit, SW_HIDE);
            return Ok(());
        }
        let b = field.bounds;
        SetWindowPos(
            self.edit,
            HWND_TOP,
            ((b.x + 4.) * self.scale).round() as i32,
            ((b.y + 2.) * self.scale).round() as i32,
            ((b.width - 8.) * self.scale).round() as i32,
            ((b.height - 4.) * self.scale).round() as i32,
            SWP_NOACTIVATE,
        )?;
        let family = native_measure::family(&self.text.fonts, &self.engine.ui.chosen.lang, false)?;
        if self.edit_font_scale != self.scale || self.edit_font_family != family {
            let mut font = LOGFONTW {
                lfHeight: -(12. * self.scale).round() as i32,
                lfWeight: 400,
                ..Default::default()
            };
            for (target, value) in font.lfFaceName.iter_mut().zip(family.encode_utf16()) {
                *target = value;
            }
            let font = CreateFontIndirectW(&font);
            if !font.0.is_null() {
                SendMessageW(self.edit, WM_SETFONT, WPARAM(font.0 as usize), LPARAM(0));
                if !self.edit_font.0.is_null() {
                    let _ = DeleteObject(self.edit_font);
                }
                self.edit_font = font;
                self.edit_font_scale = self.scale;
                self.edit_font_family = family;
            }
        }
        if self.edit_text != self.engine.ui.field {
            let text = wide(&self.engine.ui.field);
            SendMessageW(
                self.edit,
                WM_SETTEXT,
                WPARAM(0),
                LPARAM(text.as_ptr() as isize),
            );
            let offset = self
                .engine
                .ui
                .field
                .chars()
                .take(self.engine.ui.cursor)
                .map(char::len_utf16)
                .sum::<usize>();
            SendMessageW(
                self.edit,
                EM_SETSEL,
                WPARAM(offset),
                LPARAM(offset as isize),
            );
            self.edit_text = self.engine.ui.field.clone();
            self.edit_selection = (usize::MAX, usize::MAX);
        }
        let selected = self
            .engine
            .ui
            .selection
            .unwrap_or((self.engine.ui.cursor, self.engine.ui.cursor));
        if selected != self.edit_selection {
            let utf16 = |offset| {
                self.engine
                    .ui
                    .field
                    .chars()
                    .take(offset)
                    .map(char::len_utf16)
                    .sum::<usize>()
            };
            SendMessageW(
                self.edit,
                EM_SETSEL,
                WPARAM(utf16(selected.0)),
                LPARAM(utf16(selected.1) as isize),
            );
            self.edit_selection = selected;
        }
        let placeholder = wide(&field.label);
        // EM_SETCUEBANNER: the native EDIT provides TSF/IME, clipboard, selection
        // and Win+H input while the shared Canvas retains the approved border.
        SendMessageW(
            self.edit,
            0x1501,
            WPARAM(1),
            LPARAM(placeholder.as_ptr() as isize),
        );
        let _ = EnableWindow(self.edit, field.enabled);
        let _ = ShowWindow(self.edit, SW_SHOWNOACTIVATE);
        Ok(())
    }
    unsafe fn edit_changed(&mut self) {
        // Only our private composer HWND is queried, never a discovery target.
        let mut text = [0u16; 8001];
        let n = SendMessageW(
            self.edit,
            WM_GETTEXT,
            WPARAM(text.len()),
            LPARAM(text.as_mut_ptr() as isize),
        )
        .0
        .max(0) as usize;
        let words = String::from_utf16_lossy(&text[..n.min(8000)]);
        let (mut begin, mut end) = (0u32, 0u32);
        SendMessageW(
            self.edit,
            EM_GETSEL,
            WPARAM((&mut begin as *mut u32) as usize),
            LPARAM((&mut end as *mut u32) as isize),
        );
        let scalar = |offset: u32| {
            char::decode_utf16(text[..(offset as usize).min(n).min(8000)].iter().copied()).count()
        };
        let (mut anchor, mut focus) = (begin, end);
        let mut gui = GUITHREADINFO {
            cbSize: std::mem::size_of::<GUITHREADINFO>() as u32,
            ..Default::default()
        };
        if begin != end
            && GetGUIThreadInfo(GetCurrentThreadId(), &mut gui).is_ok()
            && gui.hwndCaret == self.edit
        {
            let point = gui.rcCaret.left as i16 as u16 as u32
                | ((gui.rcCaret.top as i16 as u16 as u32) << 16);
            let active = SendMessageW(self.edit, 0x00D7, WPARAM(0), LPARAM(point as isize)).0
                as u32
                & 0xffff;
            if active <= begin {
                (anchor, focus) = (end, begin);
            }
        }
        let selected = (scalar(anchor), scalar(focus));
        if selected.0 == selected.1 {
            native_composer::reconcile(
                &mut self.engine.ui,
                &words,
                selected.1,
                GetFocus() == self.edit,
            );
        } else {
            native_composer::reconcile_selection(
                &mut self.engine.ui,
                &words,
                selected.0,
                selected.1,
                GetFocus() == self.edit,
            );
        }
        self.edit_selection = selected;
        self.edit_text = words;
    }
    unsafe fn focus_ui(&mut self) {
        let field = self.engine.ui.surface() == Surface::Activity
            && self.engine.ui.focus == Some(crate::ui::Control::Field);
        let _ = SetFocus(if field { self.edit } else { self.ui_window });
    }
    /// The Activity window on her DM thread (the plugin's dm.ts).
    unsafe fn open_dm(&mut self, now: u64) -> Result<(), Error> {
        self.open_activity(now)?;
        self.engine.open_dm(now)?;
        self.draw_ui(now)?;
        self.focus_ui();
        Ok(())
    }
    unsafe fn open_activity(&mut self, now: u64) -> Result<(), Error> {
        if self.engine.ui.surface() == Surface::Companion {
            self.previous_focus = GetForegroundWindow();
        }
        self.engine.open_activity(now)?;
        self.engine.ui.new_chat = crate::new_chat::detect();
        self.sync_session_apps(now);
        self.draw_ui(now)?;
        let _ = SetForegroundWindow(self.ui_window);
        self.focus_ui();
        Ok(())
    }
    unsafe fn sync_notices(&mut self, now: u64) -> Result<(), Error> {
        let records = self
            .engine
            .sessions()
            .live(now as f64)
            .into_iter()
            .cloned()
            .collect::<Vec<_>>();
        if let Some(on) = self.engine.notice_preference(now) {
            let mut shell = native_notice_shortcut::NoticeShortcut {
                folder: &self.options.folder,
            };
            self.notices.shortcut.sync(on, &mut shell)?;
        }
        for record in records {
            let candidate = notice_gate::Candidate {
                session: record.session.clone(),
                done: record.done as u64,
                busy_since: record.busy_since,
                enabled: self.engine.notice_preference(now) == Some(true)
                    && record.notices
                    && record.long_task == "notify",
                quiet: record.rest
                    && !record
                        .helpers
                        .iter()
                        .any(|helper| helper.outcome == crate::decor::HelperOutcome::Working),
                waiting: ["waiting", "question"].contains(&record.mood.as_str()),
            };
            let locked = self.locked;
            let mut target = self.follow;
            let folder = self.options.presence_folder.as_deref();
            let fallback = self.follow;
            if self.notices.gate.observe(&candidate, now, || {
                target = Self::session_window_in(folder, &record.session).or(fallback);
                locked
                    || idle_input_ms().is_some_and(|idle| idle >= 60_000)
                    || target.is_some_and(|target| {
                        let mut target_pid = 0;
                        let mut foreground_pid = 0;
                        GetWindowThreadProcessId(target, Some(&mut target_pid));
                        GetWindowThreadProcessId(GetForegroundWindow(), Some(&mut foreground_pid));
                        target_pid != 0 && foreground_pid != target_pid
                    })
            }) {
                let body = crate::ui::word(&record.lang, "long.notify", 0)
                    .replace("{folder}", &record.project)
                    .replace(
                        "{duration}",
                        &duration(
                            candidate.done.saturating_sub(candidate.busy_since),
                            &record.lang,
                        ),
                    );
                self.notices
                    .post(&body, &record.name, &record.project, self.hwnd, target)?;
            }
        }
        // Her DM that reached the closed thread (the plugin's dm.ts): a toast whose click opens the thread, never while
        // the screen is locked (the owner's card of 10-17 late).
        if let Some(notice) = self.engine.take_dm_notice(now) {
            if !self.locked && self.engine.notice_preference(now) == Some(true) {
                self.notices
                    .post_opening(&notice.body, &notice.title, "dm", self.hwnd, None, true)?;
            }
        }
        Ok(())
    }
    unsafe fn ui_action(&mut self, action: UiAction, now: u64) -> Result<(), Error> {
        match action {
            UiAction::Request(request) => self.engine.submit_ui_request(request, now)?,
            UiAction::SelectRow(session) => {
                if let Some(window) = self
                    .session_window(&session)
                    .or(self.follow)
                    .or_else(|| find_claude_window())
                {
                    let _ = SetForegroundWindow(window);
                }
            }
            UiAction::Close => {
                let _ = ShowWindow(self.ui_window, SW_HIDE);
                if !self.previous_focus.0.is_null() {
                    let _ = SetForegroundWindow(self.previous_focus);
                }
            }
            // The new conversation takes the focus; nothing to show if the system cannot open the link.
            UiAction::NewChat(face, folder) => {
                let _ = ShowWindow(self.ui_window, SW_HIDE);
                let _ = crate::new_chat::open(face, folder.as_deref());
            }
            UiAction::Menu(action) => match action {
                MenuAction::Activity => self.open_activity(now)?,
                MenuAction::Dm => self.open_dm(now)?,
                MenuAction::Back => {
                    if let Some(window) = self.follow {
                        let _ = SetForegroundWindow(window);
                    }
                }
                MenuAction::ToggleLines => self.engine.toggle_lines()?,
                MenuAction::Hide => self.engine.hide(now),
                MenuAction::HideUntilCalled => self.engine.hide_until_called(),
                MenuAction::Pat => self
                    .engine
                    .touch(TouchEvent::Click { alternate: false }, now),
                MenuAction::Wave => self.engine.wave(now),
                MenuAction::Hug => self.engine.touch(TouchEvent::LongPress, now),
                MenuAction::Fluster => self.engine.touch(TouchEvent::Burst, now),
                MenuAction::ToggleLogin => self.engine.toggle_login(),
                MenuAction::NewChat(face) => {
                    let _ = crate::new_chat::open(face, self.engine.record().cwd.as_deref());
                }
                MenuAction::Home => {
                    self.manual = None;
                    self.engine.clear_manual_position()?;
                    self.engine.wave(now);
                    self.place();
                }
                MenuAction::Size(size) => self.engine.set_size(size),
                MenuAction::SizeMenu => self.size_menu()?,
                MenuAction::Quit => {
                    self.closed = true;
                    let _ = DestroyWindow(self.hwnd);
                }
                MenuAction::BeginFollow | MenuAction::StopFollow => {}
            },
        }
        Ok(())
    }
    unsafe fn arm(&mut self, now: u64) {
        let _ = KillTimer(self.hwnd, FRAME_TIMER);
        let ui = (self.engine.ui.surface() != Surface::Companion)
            .then(|| self.ui_flip.next_deadline(now))
            .flatten();
        let speech = self
            .canvas
            .as_ref()
            .is_some_and(|canvas| canvas.bubble.is_some())
            .then(|| self.speech_flip.next_deadline(now))
            .flatten();
        if let Some(deadline) = [self.engine.next_deadline_ms(now), ui, speech]
            .into_iter()
            .flatten()
            .min()
        {
            SetTimer(
                self.hwnd,
                FRAME_TIMER,
                deadline.saturating_sub(now).clamp(1, u32::MAX as u64) as u32,
                None,
            );
        }
    }
    unsafe fn work_area(&self) -> RECT {
        let monitor = MonitorFromWindow(self.follow.unwrap_or(self.hwnd), MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if GetMonitorInfoW(monitor, &mut info).as_bool() {
            info.rcWork
        } else {
            RECT {
                left: 0,
                top: 0,
                right: 1920,
                bottom: 1080,
            }
        }
    }
    unsafe fn screen_area(&self) -> RECT {
        let monitor = MonitorFromWindow(self.follow.unwrap_or(self.hwnd), MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if GetMonitorInfoW(monitor, &mut info).as_bool() {
            info.rcMonitor
        } else {
            self.work_area()
        }
    }
    fn sprite_bounds(&self) -> (i32, i32, i32, i32) {
        self.canvas
            .as_ref()
            .map(|c| {
                let (x, y, w, h) = c.sprite_bounds;
                (x, y, w as i32, h as i32)
            })
            .unwrap_or((109, 148, 103, 96))
    }
    fn placement_sprite(&self) -> ScreenRect {
        let (x, y, width, height) = self.sprite_bounds();
        ScreenRect {
            x: (self.position.x + x) as f64 / self.scale,
            y: (self.position.y + y) as f64 / self.scale,
            width: width as f64 / self.scale,
            height: height as f64 / self.scale,
        }
    }
    unsafe fn sync_shed_context(&mut self) {
        let sprite = self.placement_sprite();
        let screen = self.screen_area();
        let host = self.follow_rect();
        let carrying = self.press.as_ref().is_some_and(|press| press.dragged);
        let ledge = self.place_mode == PlaceMode::Ledge && !carrying && host.is_some();
        let right = if ledge {
            host.unwrap().right.min(screen.right)
        } else {
            screen.right
        };
        let bottom_visible = if ledge {
            let edge = host.unwrap().top;
            edge >= screen.top && edge <= screen.bottom
        } else {
            sprite.bottom() <= screen.bottom as f64 / self.scale
        };
        self.engine.set_native_shed_context(
            ledge,
            right as f64 / self.scale - sprite.right(),
            bottom_visible,
        );
    }
    fn presentation_origin(&self, now: u64) -> POINT {
        if !self.relocation || self.press.is_some() {
            return self.position;
        }
        let anchor = self.engine.placement_anchor(now);
        let (sx, sy, width, height) = self.sprite_bounds();
        POINT {
            x: (anchor[0] * self.scale).round() as i32 - width / 2 - sx,
            y: (-anchor[1] * self.scale).round() as i32 - height - sy,
        }
    }
    unsafe fn session_window(&self, session: &str) -> Option<HWND> {
        Self::session_window_in(self.options.presence_folder.as_deref(), session)
    }
    unsafe fn session_window_in(folder: Option<&Path>, session: &str) -> Option<HWND> {
        // The snapshot belongs to our protocol. Only the kernel supplies host identity.
        let snapshot = crate::presence_store::read_snapshot(folder?)?;
        let claim = snapshot
            .claims
            .values()
            .find(|claim| claim.session == session && presence_events::claim_alive(claim))?;
        find_process_window(claim.host_pid?)
    }
    unsafe fn placement_mode(&self) -> PlaceMode {
        if self.press.as_ref().is_some_and(|press| press.dragged) {
            return PlaceMode::Carried;
        }
        if self.manual.is_some() {
            return PlaceMode::Manual;
        }
        if self.placed {
            return self.place_mode;
        }
        if let Some(target) = self.follow_rect() {
            let sprite = self.placement_sprite();
            if sprite.x * self.scale >= target.right as f64 {
                return PlaceMode::BesideRight;
            }
            if sprite.right() * self.scale <= target.left as f64 {
                return PlaceMode::BesideLeft;
            }
            if sprite.y * self.scale >= target.bottom as f64 {
                return PlaceMode::Below;
            }
            return PlaceMode::Free;
        }
        PlaceMode::Corner
    }
    unsafe fn dimensions(&self) -> (i32, i32) {
        let (_, _, w, h) = self.sprite_bounds();
        (w, h)
    }
    unsafe fn clamp(&self, point: POINT) -> POINT {
        let area = self.work_area();
        let (sx, sy, w, h) = self.sprite_bounds();
        POINT {
            x: (point.x + sx).clamp(area.left, (area.right - w).max(area.left)) - sx,
            y: (point.y + sy).clamp(area.top, (area.bottom - h).max(area.top)) - sy,
        }
    }
    unsafe fn speech_origin(&mut self, canvas: &Canvas, now: u64) -> POINT {
        let Some(run) = canvas.bubble.as_ref() else {
            return self.position;
        };
        let area = self.work_area();
        let sc = self.scale;
        if canvas.bubble_is_task {
            let sprite = self.placement_sprite();
            let visible = ScreenRect {
                x: area.left as f64 / sc,
                y: area.top as f64 / sc,
                width: (area.right - area.left) as f64 / sc,
                height: (area.bottom - area.top) as f64 / sc,
            };
            let width = run.width / sc + 32.;
            // Place.swift bubbleFrame: shared lane, four points into the transparent frame.
            let frame = ScreenRect {
                x: if self.placement_mode() == PlaceMode::Below {
                    sprite.x - 6. - width
                } else {
                    sprite.x + (sprite.width - width) / 2.
                },
                y: if self.placement_mode() == PlaceMode::Below {
                    sprite.y + 4.
                } else {
                    sprite.y - 18.
                },
                width,
                height: 22.,
            };
            let Some(frame) =
                crate::motion::avoid_face(frame, visible, crate::motion::face_keep_out(sprite))
            else {
                self.speech_alpha = 0.;
                return self.position;
            };
            self.speech_alpha = 1.;
            return POINT {
                x: (frame.x * sc).round() as i32 - (run.x - 22. * sc).floor() as i32,
                y: (frame.y * sc).round() as i32 - (run.y - 3. * sc).floor() as i32,
            };
        }
        let (x, y, w, h) = (
            (run.x - 8. * sc).floor() as i32,
            (run.y - 4. * sc).floor() as i32,
            (run.width + 16. * sc).ceil() as i32,
            (run.height + 8. * sc).ceil() as i32,
        );
        let visible = ScreenRect {
            x: area.left as f64 / sc,
            y: area.top as f64 / sc,
            width: (area.right - area.left) as f64 / sc,
            height: (area.bottom - area.top) as f64 / sc,
        };
        let Some(placement) = crate::motion::line_placement(
            self.placement_sprite(),
            visible,
            [w as f64 / sc, h as f64 / sc],
            self.placement_mode(),
            self.speech_flip.current_side(),
            None,
        ) else {
            self.speech_alpha = 0.;
            return self.position;
        };
        self.speech_flip.change(placement, now);
        let sample = self.speech_flip.sample(now, self.options.reduce_motion);
        self.speech_alpha = sample.alpha;
        let placement = sample.placement.unwrap_or(placement);
        let (dx, dy) = match placement.side {
            LineSide::Above => (0., sample.slide),
            LineSide::Below => (0., -sample.slide),
            LineSide::Left => (sample.slide, 0.),
            LineSide::Right => (-sample.slide, 0.),
        };
        POINT {
            x: ((placement.frame.x + dx) * sc).round() as i32 - x,
            y: ((placement.frame.y + dy) * sc).round() as i32 - y,
        }
    }
    unsafe fn follow_rect(&self) -> Option<RECT> {
        let mut rect = RECT::default();
        self.follow
            .filter(|h| !IsIconic(*h).as_bool() && GetWindowRect(*h, &mut rect).is_ok())
            .map(|_| rect)
    }
    unsafe fn place(&mut self) {
        if self.press.as_ref().is_some_and(|p| p.dragged) {
            return;
        }
        let now = epoch_ms();
        let ducking = self.relocation && self.engine.relocation_ducking(now);
        let area = self.work_area();
        let screen = self.screen_area();
        let (sx, sy, width, height) = self.sprite_bounds();
        let target = self.follow_rect();
        let sc = self.scale;
        let logical = |r: RECT| ScreenRect {
            x: r.left as f64 / sc,
            y: r.top as f64 / sc,
            width: (r.right - r.left) as f64 / sc,
            height: (r.bottom - r.top) as f64 / sc,
        };
        let before = self.placement_sprite();
        let previous = self.placed.then_some(native_place::Placement {
            frame: before,
            mode: self.place_mode,
            room: self.contact_room,
            horizontal: false,
            push_sign: 1.,
        });
        let manual = match self.manual {
            Some(Manual::Screen { fx, fy }) => Some(ScreenRect {
                x: (area.left as f64 + (area.right - area.left - width).max(0) as f64 * fx) / sc,
                y: (area.top as f64 + (area.bottom - area.top - height).max(0) as f64 * fy) / sc,
                width: width as f64 / sc,
                height: height as f64 / sc,
            }),
            Some(Manual::Window { corner, dx, dy }) => target.map(|target| {
                let corner = window_corner(target, corner);
                let origin = self.clamp(POINT {
                    x: corner.x + dx - sx,
                    y: corner.y + dy - sy,
                });
                ScreenRect {
                    x: (origin.x + sx) as f64 / sc,
                    y: (origin.y + sy) as f64 / sc,
                    width: width as f64 / sc,
                    height: height as f64 / sc,
                }
            }),
            _ => None,
        };
        let placement = native_place::place(
            logical(area),
            logical(screen),
            target.map(logical),
            [width as f64 / sc, height as f64 / sc],
            previous,
            self.geometry_live,
            manual,
        );
        let origin = POINT {
            x: (placement.frame.x * sc).round() as i32 - sx,
            y: (placement.frame.y * sc).round() as i32 - sy,
        };
        let moved = origin.x != self.position.x || origin.y != self.position.y;
        let old_mode = self.place_mode;
        let from = [before.x + before.width / 2., -before.bottom()];
        let to = [
            placement.frame.x + placement.frame.width / 2.,
            -placement.frame.bottom(),
        ];
        if ducking
            && self
                .engine
                .retarget_relocation(to, placement.mode == PlaceMode::Ledge, now)
        {
            self.position = origin;
            self.place_mode = placement.mode;
            self.previous_target = target;
            self.pending_placement = false;
            self.arrival_contact = Some(placement);
            return;
        }
        if self.relocation && self.engine.track_pop_anchor(to, now) {
            if moved {
                if !self.geometry_live {
                    self.engine.geometry_begin(from, now);
                }
                self.engine.geometry_event(to, now);
                if !self.geometry_live {
                    self.engine.geometry_end(now);
                }
            }
            self.position = origin;
            self.place_mode = placement.mode;
            self.previous_target = target;
            self.pending_placement = false;
            if self.contact_room != placement.room || old_mode != placement.mode {
                self.engine.squeeze_contact(
                    placement.room,
                    placement.horizontal,
                    placement.push_sign,
                    now,
                );
                self.contact_room = placement.room;
            }
            return;
        }
        if self.placed && moved && self.press.is_none() {
            if !self.geometry_live
                && (old_mode != placement.mode || (from[0] - to[0]).hypot(from[1] - to[1]) > 24.)
            {
                let covered = self
                    .previous_target
                    .map(logical)
                    .map(|window| {
                        let overlap = before.intersection(window);
                        overlap.width * overlap.height / (before.width * before.height).max(1.)
                    })
                    .unwrap_or(0.);
                self.engine.relocate(
                    from,
                    to,
                    old_mode == PlaceMode::Ledge,
                    placement.mode == PlaceMode::Ledge,
                    covered,
                    now,
                );
                self.relocation = true;
                self.departure_host = if old_mode == PlaceMode::Ledge {
                    self.previous_target
                } else {
                    None
                };
            } else {
                if !self.geometry_live {
                    self.engine.geometry_begin(from, now);
                }
                self.engine.geometry_event(to, now);
                if !self.geometry_live {
                    self.engine.geometry_end(now);
                }
                self.relocation = false;
            }
        }
        if self.relocation && self.engine.relocation_ducking(now) {
            self.arrival_contact = Some(placement);
        } else if self.contact_room != placement.room || old_mode != placement.mode {
            self.engine.squeeze_contact(
                placement.room,
                placement.horizontal,
                placement.push_sign,
                now,
            );
            self.contact_room = placement.room;
        }
        self.position = origin;
        self.placed = true;
        self.was_ledge = placement.mode == PlaceMode::Ledge;
        self.place_mode = placement.mode;
        self.previous_target = target;
        let shown = self.presentation_origin(now);
        let _ = SetWindowPos(
            self.hwnd,
            HWND_TOPMOST,
            shown.x,
            shown.y,
            0,
            0,
            SWP_NOSIZE | SWP_NOACTIVATE,
        );
    }
    unsafe fn dropped(&mut self) {
        let area = self.work_area();
        let (width, height) = self.dimensions();
        let (sx, sy, _, _) = self.sprite_bounds();
        let point = POINT {
            x: self.position.x + sx,
            y: self.position.y + sy,
        };
        self.manual = if let Some(rect) = self.follow_rect().filter(|r| {
            point.x + width >= r.left - 48
                && point.x <= r.right + 48
                && point.y + height >= r.top - 48
                && point.y <= r.bottom + 48
        }) {
            let centre = POINT {
                x: point.x + width / 2,
                y: point.y + height / 2,
            };
            let corner = (0..4u8)
                .min_by_key(|c| {
                    let p = window_corner(rect, *c);
                    (p.x - centre.x) as i64 * (p.x - centre.x) as i64
                        + (p.y - centre.y) as i64 * (p.y - centre.y) as i64
                })
                .unwrap();
            let p = window_corner(rect, corner);
            Some(Manual::Window {
                corner,
                dx: point.x - p.x,
                dy: point.y - p.y,
            })
        } else {
            Some(Manual::Screen {
                fx: (point.x - area.left) as f64 / (area.right - area.left - width).max(1) as f64,
                fy: (point.y - area.top) as f64 / (area.bottom - area.top - height).max(1) as f64,
            })
        };
        let fx = (point.x - area.left) as f64 / (area.right - area.left - width).max(1) as f64;
        let fy = (point.y - area.top) as f64 / (area.bottom - area.top - height).max(1) as f64;
        let result = match self.manual {
            Some(Manual::Window { corner, dx, dy }) => self.engine.set_window_anchor(
                ["topLeft", "topRight", "bottomLeft", "bottomRight"][corner as usize],
                dx as f64 / self.scale,
                dy as f64 / self.scale,
            ),
            _ => self
                .engine
                .set_manual_position(fx.clamp(0.0, 1.0), fy.clamp(0.0, 1.0)),
        };
        if let Err(error) = result {
            self.fail(error)
        }
    }
    unsafe fn refresh_location_hook(&mut self) -> Result<(), Error> {
        let pid = self
            .follow
            .map(|window| {
                let mut pid = 0;
                GetWindowThreadProcessId(window, Some(&mut pid));
                pid
            })
            .unwrap_or(0);
        if self
            .location_hook
            .as_ref()
            .map(|hook| hook.pid)
            .unwrap_or(0)
            == pid
        {
            return Ok(());
        }
        self.location_hook = None;
        if pid != 0 {
            let handle = SetWinEventHook(
                EVENT_OBJECT_LOCATIONCHANGE,
                EVENT_OBJECT_LOCATIONCHANGE,
                None,
                Some(event_proc),
                pid,
                0,
                WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
            );
            if handle.0.is_null() {
                return Err(windows::core::Error::from_win32().into());
            }
            let gesture = SetWinEventHook(
                EVENT_SYSTEM_MOVESIZESTART,
                EVENT_SYSTEM_MOVESIZEEND,
                None,
                Some(event_proc),
                pid,
                0,
                WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
            );
            if gesture.0.is_null() {
                let _ = UnhookWinEvent(handle);
                return Err(windows::core::Error::from_win32().into());
            }
            self.location_hook = Some(LocationHook {
                handle,
                gesture,
                pid,
            });
        }
        Ok(())
    }
    unsafe fn window_event(&mut self, event: u32, window: HWND) {
        let now = epoch_ms();
        if event == EVENT_SYSTEM_MOVESIZESTART {
            if Some(window) == self.follow {
                self.position = self.presentation_origin(now);
                self.geometry_live = true;
                self.relocation = false;
                self.pending_placement = false;
                self.arrival_contact = None;
                self.engine.cancel_relocation();
                let sprite = self.placement_sprite();
                self.engine
                    .geometry_begin([sprite.x + sprite.width / 2., -sprite.bottom()], now);
            }
            return;
        }
        if event == EVENT_SYSTEM_MOVESIZEEND {
            if Some(window) == self.follow {
                self.geometry_live = false;
                self.engine.geometry_end(now);
                self.place();
            }
            return;
        }
        if event == EVENT_OBJECT_LOCATIONCHANGE && Some(window) != self.follow {
            return;
        }
        if (event == EVENT_OBJECT_SHOW
            || event == EVENT_OBJECT_HIDE
            || event == EVENT_OBJECT_DESTROY)
            && Some(window) != self.follow
            && !is_claude(window)
        {
            return;
        }
        let previous = self.follow;
        if event != EVENT_OBJECT_LOCATIONCHANGE {
            self.follow = find_claude_window();
        }
        if previous != self.follow {
            self.sync_back_app();
            if self.geometry_live {
                self.engine.geometry_end(now);
            }
            self.geometry_live = false;
            if let Err(error) = self.refresh_location_hook() {
                self.fail(error)
            }
        }
        let active = self.follow == Some(GetForegroundWindow());
        if (previous != self.follow && self.follow.is_some()) || (!self.active && active) {
            self.engine.wave(epoch_ms());
        }
        self.active = active;
        self.place();
    }
    unsafe fn menu(&mut self) -> Result<(), Error> {
        self.sync_back_app();
        let rows = native_menu::plan(
            self.engine.record(),
            &MenuContext {
                platform: UiPlatform::Windows,
                back_available: self.follow.is_some(),
                back_app: self.back_app.clone(),
                following: self.follow.is_some(),
                lines_hidden: self.engine.lines_hidden(),
                size: self.engine.options.size, new_chat: crate::new_chat::detect_cached(), login: Some(self.engine.login()) },
        );
        self.popup(&rows)
    }
    unsafe fn size_menu(&mut self) -> Result<(), Error> {
        self.popup(&native_menu::sizes(
            self.engine.record(),
            self.engine.options.size,
        ))
    }
    unsafe fn popup(&mut self, rows: &[native_menu::Item]) -> Result<(), Error> {
        let menu = Popup::new(rows)?;
        let previous = GetForegroundWindow();
        let mut point = POINT::default();
        if GetCursorPos(&mut point).is_err() {
            point = self.position;
        }
        let _ = SetForegroundWindow(self.hwnd);
        // No SetMenuDefaultItem or preselection: Windows owns navigation and its native tree.
        let command = TrackPopupMenuEx(
            menu.0,
            (TPM_RETURNCMD | TPM_NONOTIFY | TPM_RIGHTBUTTON).0,
            point.x,
            point.y,
            self.hwnd,
            None,
        )
        .0 as u32;
        let _ = PostMessageW(self.hwnd, WM_NULL, WPARAM(0), LPARAM(0));
        if let Some(action) = native_menu::selection(rows, command) {
            let activity_from_companion = matches!(action, MenuAction::Activity | MenuAction::Dm)
                && self.engine.ui.surface() == Surface::Companion;
            let keep_focus = !matches!(
                action,
                MenuAction::Activity | MenuAction::Dm | MenuAction::Back | MenuAction::Quit
            );
            self.ui_action(UiAction::Menu(action), epoch_ms())?;
            if activity_from_companion {
                self.previous_focus = previous;
            }
            if keep_focus && !previous.0.is_null() {
                let _ = SetForegroundWindow(previous);
                if previous == self.ui_window || previous == self.edit {
                    self.focus_ui();
                }
            }
        } else if !previous.0.is_null() {
            let _ = SetForegroundWindow(previous);
            if previous == self.ui_window || previous == self.edit {
                self.focus_ui();
            }
        }
        Ok(())
    }
    unsafe fn sync_back_app(&mut self) {
        self.back_app = self
            .follow
            .and_then(|window| process_image(window))
            .and_then(|image| native_menu::app_from_image(&image).map(str::to_owned))
            .unwrap_or_else(|| "Claude".into());
    }
    unsafe fn sync_appearance(&mut self) {
        sync_native_menu_theme(&mut self.menu_theme);
        let mut light = 1u32;
        let mut length = std::mem::size_of::<u32>() as u32;
        let _ = RegGetValueW(
            HKEY_CURRENT_USER,
            w!("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize"),
            w!("AppsUseLightTheme"),
            RRF_RT_REG_DWORD,
            None,
            Some((&mut light as *mut u32).cast()),
            Some(&mut length),
        );
        self.engine.ui.dark = light == 0;
        let mut contrast = HIGHCONTRASTW {
            cbSize: std::mem::size_of::<HIGHCONTRASTW>() as u32,
            ..Default::default()
        };
        let high_contrast = SystemParametersInfoW(
            SPI_GETHIGHCONTRAST,
            contrast.cbSize,
            Some((&mut contrast as *mut HIGHCONTRASTW).cast()),
            SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        )
        .is_ok()
            && (contrast.dwFlags & HCF_HIGHCONTRASTON).0 != 0;
        // Never hard-coded: people edit these themes. Read again on every change.
        let palette = high_contrast.then(|| {
            crate::contrast::SystemPalette::from_colorrefs([
                GetSysColor(COLOR_WINDOW),
                GetSysColor(COLOR_WINDOWTEXT),
                GetSysColor(COLOR_HIGHLIGHT),
                GetSysColor(COLOR_HIGHLIGHTTEXT),
                GetSysColor(COLOR_BTNFACE),
                GetSysColor(COLOR_BTNTEXT),
                GetSysColor(COLOR_GRAYTEXT),
            ])
        });
        // Settings, Personalization, Colors, Transparency effects.
        let mut transparency = 1u32;
        let mut transparency_length = std::mem::size_of::<u32>() as u32;
        let _ = RegGetValueW(
            HKEY_CURRENT_USER,
            w!("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize"),
            w!("EnableTransparency"),
            RRF_RT_REG_DWORD,
            None,
            Some((&mut transparency as *mut u32).cast()),
            Some(&mut transparency_length),
        );
        self.engine
            .set_contrast(high_contrast, palette, transparency == 0, epoch_ms());
    }
    unsafe fn sync_session_apps(&mut self, now: u64) {
        let sessions = self
            .engine
            .sessions()
            .live(now as f64)
            .into_iter()
            .map(|record| record.session.clone())
            .collect::<Vec<_>>();
        let mut apps = std::collections::BTreeMap::new();
        for session in sessions {
            if let Some(app) = self
                .session_window(&session)
                .and_then(|window| process_image(window))
                .and_then(|image| native_menu::app_from_image(&image).map(str::to_owned))
            {
                apps.insert(session, app);
            }
        }
        self.engine.ui.session_apps = apps;
    }
    unsafe fn actions(&mut self) -> Result<(), Error> {
        for action in self.engine.take_actions() {
            match action {
                Action::Login(on) => {
                    set_login(on)?;
                    self.engine.record_login_success(on)?;
                }
                Action::Capture(on) => set_capture(on),
                Action::Follow => {
                    self.manual = None;
                    self.engine.clear_manual_position()?;
                    self.follow = find_claude_window();
                    self.sync_back_app();
                    self.refresh_location_hook()?;
                    self.place();
                }
                Action::Summon => {
                    self.engine.wave(epoch_ms());
                    let _ = ShowWindow(self.hwnd, SW_SHOWNOACTIVATE);
                }
                Action::Settings => {
                    self.menu()?;
                }
                Action::Quit => {
                    self.closed = true;
                    let _ = DestroyWindow(self.hwnd);
                }
            }
        }
        Ok(())
    }
}
impl Drop for State {
    fn drop(&mut self) {
        self.front_pages = None;
        unsafe {
            if !self.edit_font.0.is_null() {
                let _ = DeleteObject(self.edit_font);
            }
            if !self.edit_brush.0.is_null() {
                let _ = DeleteObject(self.edit_brush);
            }
        }
    }
}
fn window_corner(rect: RECT, corner: u8) -> POINT {
    POINT {
        x: if corner == 0 || corner == 2 {
            rect.left
        } else {
            rect.right
        },
        y: if corner < 2 { rect.top } else { rect.bottom },
    }
}
unsafe extern "system" fn edit_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if message == WM_SETFOCUS {
        if let Ok(parent) = GetParent(hwnd) {
            let _ = PostMessageW(parent, EDIT_FOCUS, WPARAM(0), LPARAM(hwnd.0 as isize));
        }
    }
    if message == WM_KEYDOWN && [VK_TAB.0, VK_RETURN.0, VK_ESCAPE.0].contains(&(wparam.0 as u16)) {
        if let Ok(parent) = GetParent(hwnd) {
            let _ = PostMessageW(parent, message, wparam, lparam);
        }
        return LRESULT(0);
    }
    if message == WM_KEYDOWN
        && wparam.0 == 0x41
        && (GetKeyState(VK_CONTROL.0 as i32) as u16 & 0x8000) != 0
    {
        SendMessageW(hwnd, EM_SETSEL, WPARAM(0), LPARAM(-1));
        return LRESULT(0);
    }
    if message == WM_CHAR && [9, 13, 27].contains(&wparam.0) {
        return LRESULT(0);
    }
    if message == WM_GETOBJECT && lparam.0 as i32 == UiaRootObjectId {
        let pointer = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut State;
        if !pointer.is_null() {
            if let Some(_guard) = DispatchGuard::enter() {
                let state = &*pointer;
                if let Some(bridge) = state.accessibility.as_ref() {
                    return bridge.get_object_for_node(
                        hwnd,
                        wparam,
                        lparam,
                        crate::accessibility::id(&crate::ui::Control::Field),
                    );
                }
            }
        }
        return LRESULT(0);
    }
    let original: WNDPROC = std::mem::transmute(EDIT_DEFAULT_PROC.load(Ordering::Relaxed));
    let result = CallWindowProcW(original, hwnd, message, wparam, lparam);
    if matches!(message, WM_KEYUP | WM_LBUTTONUP | WM_CHAR) {
        if let Ok(parent) = GetParent(hwnd) {
            let _ = PostMessageW(
                parent,
                native_accessibility::SELECTION_MESSAGE,
                WPARAM(0),
                LPARAM(hwnd.0 as isize),
            );
        }
    }
    result
}

unsafe extern "system" fn ui_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if message == WM_NCCREATE {
        let creation = &*(lparam.0 as *const CREATESTRUCTW);
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, creation.lpCreateParams as isize);
    }
    let pointer = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut State;
    if pointer.is_null() {
        return DefWindowProcW(hwnd, message, wparam, lparam);
    }
    let Some(_dispatch) = DispatchGuard::enter() else {
        return DefWindowProcW(hwnd, message, wparam, lparam);
    };
    let state = &mut *pointer;
    let now = epoch_ms();
    let action = match message {
        WM_GETOBJECT if lparam.0 as i32 == UiaRootObjectId => {
            if let Some(accessibility) = state.accessibility.as_ref() {
                return accessibility.get_object(hwnd, wparam, lparam);
            }
            return LRESULT(0);
        }
        native_accessibility::ACTION_MESSAGE => {
            let request = *Box::from_raw(lparam.0 as *mut accesskit::ActionRequest);
            crate::accessibility::action(&mut state.engine.ui, request, now)
        }
        WM_NCHITTEST => {
            let mut point = POINT {
                x: lparam.0 as i16 as i32,
                y: (lparam.0 >> 16) as i16 as i32,
            };
            let _ = ScreenToClient(hwnd, &mut point);
            return LRESULT(
                if state
                    .ui_canvas
                    .as_ref()
                    .is_some_and(|canvas| canvas.hit_test(point.x, point.y))
                {
                    HTCLIENT as isize
                } else {
                    HTTRANSPARENT as isize
                },
            );
        }
        WM_KEYDOWN => {
            let key = match wparam.0 as u16 {
                0x09 => Some(Key::Tab {
                    shift: (GetKeyState(VK_SHIFT.0 as i32) as u16 & 0x8000) != 0,
                }),
                0x0D => Some(Key::Enter),
                0x1B => Some(Key::Escape),
                0x08 => Some(Key::Backspace),
                0x2E => Some(Key::Delete),
                0x25 => Some(Key::Left),
                0x27 => Some(Key::Right),
                0x24 => Some(Key::Home),
                0x23 => Some(Key::End),
                _ => None,
            };
            if let Some(key) = key {
                state.engine.ui.key(key, now)
            } else {
                return DefWindowProcW(hwnd, message, wparam, lparam);
            }
        }
        WM_CHAR => {
            let unit = wparam.0 as u16;
            if (0xD800..=0xDBFF).contains(&unit) {
                state.surrogate = Some(unit);
            } else {
                let scalar = if let Some(high) = state.surrogate.take() {
                    if (0xDC00..=0xDFFF).contains(&unit) {
                        Some(0x10000 + (((high - 0xD800) as u32) << 10) + (unit - 0xDC00) as u32)
                    } else {
                        Some(unit as u32)
                    }
                } else {
                    Some(unit as u32)
                };
                if let Some(character) = scalar.and_then(char::from_u32).filter(|c| !c.is_control())
                {
                    state.engine.ui.text(&character.to_string());
                }
            }
            None
        }
        WM_LBUTTONDOWN => {
            state.engine.ui.pressed = native_composer::pointer(
                &mut state.engine.ui,
                lparam.0 as i16 as f64 / state.scale,
                (lparam.0 >> 16) as i16 as f64 / state.scale,
            );
            SetCapture(hwnd);
            None
        }
        WM_LBUTTONUP => {
            state.engine.ui.pressed = None;
            let _ = ReleaseCapture();
            state.engine.ui.click(
                lparam.0 as i16 as f64 / state.scale,
                (lparam.0 >> 16) as i16 as f64 / state.scale,
                now,
            )
        }
        WM_CAPTURECHANGED => {
            state.engine.ui.pressed = None;
            None
        }
        WM_CLOSE => state.engine.ui.key(Key::Escape, now),
        WM_KILLFOCUS => {
            if HWND(wparam.0 as *mut c_void) != state.hwnd
                && HWND(wparam.0 as *mut c_void) != state.edit
            {
                let _ = state.engine.ui.key(Key::Escape, now);
            }
            None
        }
        WM_MOUSEMOVE => {
            native_composer::pointer(
                &mut state.engine.ui,
                lparam.0 as i16 as f64 / state.scale,
                (lparam.0 >> 16) as i16 as f64 / state.scale,
            );
            state.engine.pointer_near(true, now);
            let mut tracking = TRACKMOUSEEVENT {
                cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32,
                dwFlags: TME_LEAVE,
                hwndTrack: hwnd,
                dwHoverTime: 0,
            };
            let _ = TrackMouseEvent(&mut tracking);
            None
        }
        EDIT_FOCUS if lparam.0 == state.edit.0 as isize && GetFocus() == state.edit => {
            state.engine.ui.focus = Some(crate::ui::Control::Field);
            None
        }
        native_accessibility::SELECTION_MESSAGE if lparam.0 == state.edit.0 as isize => {
            state.edit_changed();
            None
        }
        WM_COMMAND
            if lparam.0 == state.edit.0 as isize
                && ((wparam.0 >> 16) & 0xffff) == EN_CHANGE as usize =>
        {
            state.edit_changed();
            None
        }
        WM_CTLCOLOREDIT | WM_CTLCOLORSTATIC if lparam.0 == state.edit.0 as isize => {
            let dc = HDC(wparam.0 as *mut c_void);
            SetTextColor(dc, COLORREF(0x00191B23));
            SetBkColor(dc, COLORREF(0x00E9EEFA));
            return LRESULT(state.edit_brush.0 as isize);
        }
        OWN_MOUSE_LEAVE => {
            state.engine.ui.hovered = None;
            state.engine.ui.hover_index = None;
            state.engine.pointer_near(false, now);
            None
        }
        WM_PAINT => {
            let _ = ValidateRect(hwnd, None);
            None
        }
        _ => return DefWindowProcW(hwnd, message, wparam, lparam),
    };
    if let Some(action) = action {
        if let Err(error) = state.ui_action(action, now) {
            state.fail(error);
        }
    }
    if state.engine.ui.surface() != Surface::Companion
        && (message == WM_KEYDOWN
            || message == WM_LBUTTONUP
            || message == native_accessibility::ACTION_MESSAGE)
    {
        state.focus_ui();
    }
    if let Err(error) = state.draw() {
        state.fail(error);
    }
    LRESULT(0)
}

unsafe extern "system" fn window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if message == WM_NCCREATE {
        let creation = &*(lparam.0 as *const CREATESTRUCTW);
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, creation.lpCreateParams as isize);
    }
    let pointer = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut State;
    if pointer.is_null() {
        return DefWindowProcW(hwnd, message, wparam, lparam);
    }
    // Native APIs can synchronously send messages. Never form a second mutable reference to
    // engine state while a draw, move, capture change or native popup is still on the stack.
    let Some(_dispatch) = DispatchGuard::enter() else {
        if message == WM_NCHITTEST {
            return LRESULT(HTTRANSPARENT as isize);
        }
        if message == WM_TIMER {
            return LRESULT(0);
        }
        if message == WM_DPICHANGED
            || message == WM_DISPLAYCHANGE
            || message == WM_SETTINGCHANGE
            || message == WM_SYSCOLORCHANGE
            || message == WINDOW_EVENT
            || message == SUMMON_EVENT
        {
            let _ = PostMessageW(hwnd, message, wparam, lparam);
            return LRESULT(0);
        }
        if message == WM_DESTROY {
            PostQuitMessage(0);
            return LRESULT(0);
        }
        return DefWindowProcW(hwnd, message, wparam, lparam);
    };
    let state = &mut *pointer;
    state.hwnd = hwnd;
    if message == state.explorer_message {
        if let Some(tray) = state.tray.as_mut() {
            tray.explorer_restarted();
        }
        if let Err(error) = state.draw() {
            state.fail(error);
        }
        return LRESULT(0);
    }
    match message {
        WM_GETOBJECT
            if lparam.0 as i32 == UiaRootObjectId
                && state.engine.ui.surface() == Surface::Companion =>
        {
            if let Some(accessibility) = state.accessibility.as_ref() {
                return accessibility.get_object(hwnd, wparam, lparam);
            }
            return LRESULT(0);
        }
        native_accessibility::ACTION_MESSAGE => {
            let request = *Box::from_raw(lparam.0 as *mut accesskit::ActionRequest);
            if let Some(action) =
                crate::accessibility::action(&mut state.engine.ui, request, epoch_ms())
            {
                if let Err(error) = state.ui_action(action, epoch_ms()) {
                    state.fail(error);
                }
            }
        }
        WM_NCHITTEST => {
            let mut point = POINT {
                x: lparam.0 as i16 as i32,
                y: (lparam.0 >> 16) as i16 as i32,
            };
            let _ = ScreenToClient(hwnd, &mut point);
            return LRESULT(
                if state.canvas.as_ref().is_some_and(|c| {
                    c.hit_test(point.x, point.y)
                        && c.pixels
                            [(point.y as usize * c.width as usize + point.x as usize) * 4 + 3]
                            > 0
                }) {
                    HTCLIENT as isize
                } else {
                    HTTRANSPARENT as isize
                },
            );
        }
        WM_MOUSEACTIVATE => return LRESULT(MA_NOACTIVATE as isize),
        WM_RBUTTONUP | WM_CONTEXTMENU => {
            if let Err(error) = state.menu() {
                state.fail(error)
            }
        }
        WM_LBUTTONDOWN => {
            let x = lparam.0 as i16 as f64 / state.scale;
            let y = (lparam.0 >> 16) as i16 as f64 / state.scale;
            if state
                .engine
                .ui
                .elements()
                .iter()
                .any(|element| element.bounds.contains(x, y))
            {
                return LRESULT(0);
            }
            let mut pointer = POINT::default();
            let _ = GetCursorPos(&mut pointer);
            state.position = state.presentation_origin(epoch_ms());
            state.relocation = false;
            state.pending_placement = false;
            state.arrival_contact = None;
            state.engine.cancel_relocation();
            state.press = Some(Press {
                pointer,
                origin: state.position,
                alternate: (GetKeyState(0x12) as u16 & 0x8000) != 0,
                dragged: false,
                held: false,
            });
            SetCapture(hwnd);
            SetTimer(hwnd, PRESS_TIMER, 550, None);
            state.engine.pointer_distance(0., true, epoch_ms());
            state.engine.touch(TouchEvent::Press, epoch_ms());
        }
        WM_MOUSEMOVE => {
            state.engine.ui.pointer(true, epoch_ms());
            let x = lparam.0 as i16 as f64 / state.scale;
            let y = (lparam.0 >> 16) as i16 as f64 / state.scale;
            let (sx, sy, width, height) = state.sprite_bounds();
            let left = sx as f64 / state.scale;
            let top = sy as f64 / state.scale;
            let dx = (left - x)
                .max(0.)
                .max(x - (left + width as f64 / state.scale));
            let dy = (top - y)
                .max(0.)
                .max(y - (top + height as f64 / state.scale));
            state
                .engine
                .pointer_distance(dx.hypot(dy), state.press.is_some(), epoch_ms());
            state.engine.pointer_over(
                dx == 0. && dy == 0.,
                x > left + width as f64 / state.scale / 2.,
                epoch_ms(),
            );
            native_composer::pointer(&mut state.engine.ui, x, y);
            let mut tracking = TRACKMOUSEEVENT {
                cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32,
                dwFlags: TME_LEAVE,
                hwndTrack: hwnd,
                dwHoverTime: 0,
            };
            let _ = TrackMouseEvent(&mut tracking);
            if let Some(press) = state.press.as_mut() {
                let mut pointer = POINT::default();
                let _ = GetCursorPos(&mut pointer);
                let dx = pointer.x - press.pointer.x;
                let dy = pointer.y - press.pointer.y;
                if !press.dragged && (dx * dx + dy * dy) as f64 >= (3.0 * state.scale).powi(2) {
                    press.dragged = true;
                    let _ = KillTimer(hwnd, PRESS_TIMER);
                    state.engine.touch(TouchEvent::DragStart, epoch_ms());
                    state.engine.shake_begin(
                        [pointer.x as f64 / state.scale, pointer.y as f64 / state.scale],
                        epoch_ms(),
                    );
                }
                if press.dragged {
                    let point = POINT {
                        x: press.origin.x + dx,
                        y: press.origin.y + dy,
                    };
                    state.position = state.clamp(point);
                    state.engine.shake_event(
                        [pointer.x as f64 / state.scale, pointer.y as f64 / state.scale],
                        epoch_ms(),
                    );
                }
            }
        }
        OWN_MOUSE_LEAVE => {
            state.engine.pointer_over(false, false, epoch_ms());
            state.engine.pointer_near(false, epoch_ms());
            state.engine.ui.pointer(false, epoch_ms());
            state.engine.ui.hovered = None;
            state.engine.ui.hover_index = None;
        }
        WM_LBUTTONUP => {
            let x = lparam.0 as i16 as f64 / state.scale;
            let y = (lparam.0 >> 16) as i16 as f64 / state.scale;
            if state.press.is_none() {
                if let Some(action) = state.engine.ui.click(x, y, epoch_ms()) {
                    if let Err(error) = state.ui_action(action, epoch_ms()) {
                        state.fail(error);
                    }
                }
            }
            let _ = KillTimer(hwnd, PRESS_TIMER);
            let press = state.press.take();
            let _ = ReleaseCapture();
            if let Some(press) = press {
                if press.dragged {
                    state.dropped();
                    state.engine.shake_end();
                    state.engine.touch(TouchEvent::Drop, epoch_ms())
                } else if !press.held {
                    let x = lparam.0 as i16 as f64 / state.scale;
                    let y = (lparam.0 >> 16) as i16 as f64 / state.scale;
                    if let Some(action) = state.engine.ui.click(x, y, epoch_ms()) {
                        if let Err(error) = state.ui_action(action, epoch_ms()) {
                            state.fail(error);
                        }
                    } else {
                        state.engine.touch(
                            TouchEvent::Click {
                                alternate: press.alternate,
                            },
                            epoch_ms(),
                        )
                    }
                }
            }
        }
        WM_CAPTURECHANGED => {
            let _ = KillTimer(hwnd, PRESS_TIMER);
            if let Some(press) = state.press.take() {
                if press.dragged {
                    state.dropped();
                    state.engine.shake_end();
                    state.engine.touch(TouchEvent::Drop, epoch_ms())
                }
            }
        }
        WM_TIMER if wparam.0 == PRESS_TIMER => {
            let _ = KillTimer(hwnd, PRESS_TIMER);
            if let Some(press) = state.press.as_mut() {
                if !press.dragged {
                    press.held = true;
                    state.engine.touch(TouchEvent::LongPress, epoch_ms())
                }
            }
        }
        WM_TIMER if wparam.0 == FRAME_TIMER => {
            let _ = KillTimer(hwnd, FRAME_TIMER);
        }
        SUMMON_EVENT => {
            state.engine.wave(epoch_ms());
            let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        }
        TRAY_EVENT => match lparam.0 as u32 {
            WM_LBUTTONUP | WM_LBUTTONDBLCLK => {
                if let Err(error) = state.open_activity(epoch_ms()) {
                    state.fail(error);
                }
            }
            WM_RBUTTONUP | WM_CONTEXTMENU => {
                if let Err(error) = state.menu() {
                    state.fail(error);
                }
            }
            _ => {}
        },
        NOTICE_ACTIVATE => {
            if wparam.0 != 0 {
                let _ = SetForegroundWindow(HWND(wparam.0 as *mut c_void));
            } else if lparam.0 == 1 {
                if let Err(error) = state.open_dm(epoch_ms()) {
                    state.fail(error);
                }
            } else if let Err(error) = state.open_activity(epoch_ms()) {
                state.fail(error);
            }
        }
        // The lid: PBT_APMSUSPEND (4) puts him to sleep, PBT_APMRESUMEAUTOMATIC (0x12) is the system back.
        0x0218 => match wparam.0 as u32 {
            0x0004 => state.engine.system_sleep(epoch_ms()),
            0x0012 => state.engine.system_wake(epoch_ms(), state.locked),
            _ => {}
        },
        WM_WTSSESSION_CHANGE => {
            let event = wparam.0 as u32;
            if event == WTS_SESSION_UNLOCK {
                state.engine.screen_unlocked(epoch_ms());
            }
            if event == WTS_SESSION_LOCK || event == WTS_SESSION_UNLOCK {
                state.locked = event == WTS_SESSION_LOCK;
                if let Err(error) = state.engine.session_lock_message(event, epoch_ms()) {
                    state.fail(error);
                }
            }
        }
        WINDOW_EVENT => state.window_event(wparam.0 as u32, HWND(lparam.0 as *mut c_void)),
        WM_DPICHANGED => {
            if let Some(tray) = state.tray.as_mut() {
                tray.dpi_dirty = true;
            }
            let old_scale = state.scale;
            state.scale = ((wparam.0 & 0xffff) as f64 / 96.0).max(0.5);
            if let Some(Manual::Window { dx, dy, .. }) = &mut state.manual {
                *dx = (*dx as f64 / old_scale * state.scale).round() as i32;
                *dy = (*dy as f64 / old_scale * state.scale).round() as i32;
            }
            state.dib = None;
            state.place();
        }
        WM_DISPLAYCHANGE | WM_SETTINGCHANGE | WM_SYSCOLORCHANGE => {
            if let Some(tray) = state.tray.as_mut() {
                tray.dpi_dirty = true;
            }
            // One re-read per change, no timer. A contrast theme changes its colours with
            // WM_SYSCOLORCHANGE as well as WM_SETTINGCHANGE (SPI_SETHIGHCONTRAST).
            if message == WM_SETTINGCHANGE || message == WM_SYSCOLORCHANGE {
                state.sync_appearance();
            }
            state.place();
        }
        WM_PAINT => {
            let _ = ValidateRect(hwnd, None);
        }
        WM_CLOSE => {
            let _ = DestroyWindow(hwnd);
            return LRESULT(0);
        }
        WM_DESTROY => {
            PostQuitMessage(0);
            return LRESULT(0);
        }
        _ => return DefWindowProcW(hwnd, message, wparam, lparam),
    }
    if let Err(error) = state.draw() {
        state.fail(error)
    }
    LRESULT(0)
}

unsafe extern "system" fn event_proc(
    _hook: HWINEVENTHOOK,
    event: u32,
    window: HWND,
    object: i32,
    child: i32,
    _thread: u32,
    _time: u32,
) {
    if object != 0 || child != 0 || window.0.is_null() {
        return;
    }
    let receiver = HWND(EVENT_WINDOW.load(Ordering::Relaxed) as *mut c_void);
    if !receiver.0.is_null() {
        let _ = PostMessageW(
            receiver,
            WINDOW_EVENT,
            WPARAM(event as usize),
            LPARAM(window.0 as isize),
        );
    }
}
unsafe fn is_claude(window: HWND) -> bool {
    if !IsWindowVisible(window).as_bool()
        || IsIconic(window).as_bool()
        || GetWindow(window, GW_OWNER).is_ok_and(|h| !h.0.is_null())
    {
        return false;
    }
    process_image(window).is_some_and(|image| native_place::supported_image(&image))
}
/// OS process-image metadata only. Never open an application's image file or read its windows.
unsafe fn process_image(window: HWND) -> Option<String> {
    let mut pid = 0;
    GetWindowThreadProcessId(window, Some(&mut pid));
    let Ok(process) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
        return None;
    };
    let process = OwnedHandle(process);
    let mut image = [0u16; 32768];
    let mut length = image.len() as u32;
    if QueryFullProcessImageNameW(
        process.0,
        PROCESS_NAME_WIN32,
        PWSTR(image.as_mut_ptr()),
        &mut length,
    )
    .is_err()
    {
        return None;
    }
    Some(String::from_utf16_lossy(&image[..length as usize]))
}
unsafe fn find_process_window(pid: u32) -> Option<HWND> {
    struct Find {
        pid: u32,
        window: Option<HWND>,
    }
    unsafe extern "system" fn visit(window: HWND, data: LPARAM) -> BOOL {
        let find = &mut *(data.0 as *mut Find);
        let mut pid = 0;
        GetWindowThreadProcessId(window, Some(&mut pid));
        if pid == find.pid
            && IsWindowVisible(window).as_bool()
            && !IsIconic(window).as_bool()
            && GetWindow(window, GW_OWNER).is_ok_and(|owner| owner.0.is_null())
        {
            find.window = Some(window);
            return BOOL(0);
        }
        BOOL(1)
    }
    let front = GetForegroundWindow();
    let mut front_pid = 0;
    GetWindowThreadProcessId(front, Some(&mut front_pid));
    if front_pid == pid && IsWindowVisible(front).as_bool() && !IsIconic(front).as_bool() {
        return Some(front);
    }
    let mut find = Find { pid, window: None };
    let _ = EnumWindows(Some(visit), LPARAM((&mut find as *mut Find) as isize));
    find.window
}
unsafe extern "system" fn enum_claude(window: HWND, data: LPARAM) -> BOOL {
    if is_claude(window) {
        *(data.0 as *mut Option<HWND>) = Some(window);
        BOOL(0)
    } else {
        BOOL(1)
    }
}
unsafe fn find_claude_window() -> Option<HWND> {
    let front = GetForegroundWindow();
    if is_claude(front) {
        return Some(front);
    }
    let mut found = None;
    let _ = EnumWindows(
        Some(enum_claude),
        LPARAM((&mut found as *mut Option<HWND>) as isize),
    );
    found
}

/// Only called for a fresh, explicit Login action read from the plugin request channel.
/// --login means a launch context and never registers anything.
pub(crate) unsafe fn set_login(on: bool) -> Result<(), Error> {
    set_login_for(on, &std::env::current_exe()?)
}

/// The same login entry for a given program: setup.rs registers the installed pet, not the plugin's copy.
pub(crate) unsafe fn set_login_for(on: bool, executable: &std::path::Path) -> Result<(), Error> {
    let mut key = HKEY::default();
    RegCreateKeyExW(
        HKEY_CURRENT_USER,
        w!("Software\\Microsoft\\Windows\\CurrentVersion\\Run"),
        0,
        None,
        REG_OPTION_NON_VOLATILE,
        KEY_SET_VALUE,
        None,
        &mut key,
        None,
    )
    .ok()?;
    let result = if on {
        let command = wide(format!("\"{}\" --login", executable.display()));
        let bytes = std::slice::from_raw_parts(command.as_ptr().cast::<u8>(), command.len() * 2);
        RegSetValueExW(key, w!("Coco"), 0, REG_SZ, Some(bytes)).ok()
    } else {
        let status = RegDeleteValueW(key, w!("Coco"));
        if status == ERROR_FILE_NOT_FOUND {
            Ok(())
        } else {
            status.ok()
        }
    };
    let _ = RegCloseKey(key);
    result.map_err(Into::into)
}

struct WindowGuard(HWND);
impl Drop for WindowGuard {
    fn drop(&mut self) {
        unsafe {
            SetWindowLongPtrW(self.0, GWLP_USERDATA, 0);
            let _ = DestroyWindow(self.0);
        }
    }
}
struct LocationHook {
    handle: HWINEVENTHOOK,
    gesture: HWINEVENTHOOK,
    pid: u32,
}
impl Drop for LocationHook {
    fn drop(&mut self) {
        unsafe {
            let _ = UnhookWinEvent(self.handle);
            let _ = UnhookWinEvent(self.gesture);
        }
    }
}
struct Hooks(Vec<HWINEVENTHOOK>);
impl Drop for Hooks {
    fn drop(&mut self) {
        unsafe {
            for hook in &self.0 {
                let _ = UnhookWinEvent(*hook);
            }
            EVENT_WINDOW.store(0, Ordering::Relaxed);
        }
    }
}

pub fn run(engine: Engine, options: Options) -> Result<(), Error> {
    unsafe {
        let dpi = Dpi::initialize();
        CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()?;
        let result = run_inner(engine, options, &dpi);
        CoUninitialize();
        result
    }
}
unsafe fn run_inner(mut engine: Engine, options: Options, dpi: &Dpi) -> Result<(), Error> {
    if let Ok(existing) = FindWindowW(w!("CocoRustCompanion"), None) {
        if !options.login {
            let _ = PostMessageW(existing, SUMMON_EVENT, WPARAM(0), LPARAM(0));
        }
        return Ok(());
    }
    engine.mark_running(true)?;
    let instance = GetModuleHandleW(None)?;
    let class = WNDCLASSW {
        lpfnWndProc: Some(window_proc),
        hInstance: HINSTANCE(instance.0),
        lpszClassName: w!("CocoRustCompanion"),
        hCursor: LoadCursorW(None, IDC_ARROW)?,
        ..Default::default()
    };
    if RegisterClassW(&class) == 0 {
        return Err(windows::core::Error::from_win32().into());
    }
    let front_class = WNDCLASSW {
        lpfnWndProc: Some(front_pages_proc),
        hInstance: HINSTANCE(instance.0),
        lpszClassName: w!("CocoRustFrontPages"),
        ..Default::default()
    };
    // This optional class failing leaves the approved behind-edge fallback available.
    let _ = RegisterClassW(&front_class);
    let mut state = Box::new(State {
        engine,
        options,
        hwnd: HWND::default(),
        speech: HWND::default(),
        ui_window: HWND::default(),
        edit: HWND::default(),
        edit_font: HFONT::default(),
        edit_font_scale: 0.,
        edit_font_family: String::new(),
        edit_text: String::new(),
        edit_selection: (0, 0),
        edit_brush: CreateSolidBrush(COLORREF(0x00E9EEFA)),
        ui_dib: None,
        ui_position: POINT::default(),
        ui_canvas: None,
        surrogate: None,
        previous_focus: HWND::default(),
        tray: None,
        menu_theme: None,
        explorer_message: RegisterWindowMessageW(w!("TaskbarCreated")),
        notices: NoticeService::new(),
        locked: false,
        accessibility: None,
        speech_flip: LineFlip::default(),
        speech_alpha: 1.,
        ui_flip: LineFlip::default(),
        speech_dib: None,
        front_pages: None,
        front_page_gate: native_place::FrontPageGate::default(),
        speech_position: POINT::default(),
        canvas: None,
        dib: None,
        text: TextRenderer::new()?,
        press: None,
        follow: find_claude_window(),
        back_app: "Claude".into(),
        manual: None,
        position: POINT::default(),
        scale: 1.0,
        failure: None,
        location_hook: None,
        drawing: false,
        closed: false,
        placed: false,
        was_ledge: false,
        place_mode: PlaceMode::Corner,
        geometry_live: false,
        previous_target: None,
        relocation: false,
        pending_placement: false,
        departure_host: None,
        arrival_contact: None,
        contact_room: 1.,
        active: false,
    });
    CAPTURE_SHOWN.store(state.engine.capture(), Ordering::Relaxed);
    let hwnd = CreateWindowExW(
        WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
        w!("CocoRustCompanion"),
        w!("Coco Pet"),
        WS_POPUP,
        0,
        0,
        1,
        1,
        None,
        None,
        instance,
        Some((&mut *state as *mut State).cast()),
    )?;
    let _window = WindowGuard(hwnd);
    sync_capture(hwnd);
    let session_registered = WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION).is_ok();
    // One startup observation after registering avoids a missed transition between the query and
    // registration. Unknown/failed observation leaves the cache lock signal absent; no polling.
    if let Some(locked) = initial_session_locked() {
        state.locked = locked;
        if session_registered {
            state.engine.session_lock_message(
                if locked {
                    WTS_SESSION_LOCK
                } else {
                    WTS_SESSION_UNLOCK
                },
                epoch_ms(),
            )?;
        }
    }
    struct SessionWatch(HWND);
    impl Drop for SessionWatch {
        fn drop(&mut self) {
            unsafe {
                let _ = WTSUnRegisterSessionNotification(self.0);
            }
        }
    }
    let _session_watch = SessionWatch(hwnd);
    let ui_class = WNDCLASSW {
        lpfnWndProc: Some(ui_proc),
        lpszClassName: w!("CocoRustActivity"),
        ..class
    };
    if RegisterClassW(&ui_class) == 0 {
        return Err(windows::core::Error::from_win32().into());
    }
    let activity_title = crate::platform_words::activity_title(state.engine.record())
        .encode_utf16()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let ui_window = CreateWindowExW(
        WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_TOOLWINDOW,
        w!("CocoRustActivity"),
        PCWSTR(activity_title.as_ptr()),
        WS_POPUP,
        0,
        0,
        1,
        1,
        None,
        None,
        instance,
        Some((&mut *state as *mut State).cast()),
    )?;
    state.ui_window = ui_window;
    let edit = CreateWindowExW(
        WS_EX_NOPARENTNOTIFY,
        w!("EDIT"),
        w!(""),
        WS_CHILD | WINDOW_STYLE(ES_LEFT as u32 | ES_AUTOHSCROLL as u32),
        0,
        0,
        1,
        1,
        ui_window,
        None,
        instance,
        None,
    )?;
    state.edit = edit;
    SetWindowLongPtrW(edit, GWLP_USERDATA, (&mut *state as *mut State) as isize);
    let previous = SetWindowLongPtrW(edit, GWLP_WNDPROC, edit_proc as *const () as isize);
    EDIT_DEFAULT_PROC.store(previous, Ordering::Relaxed);
    SendMessageW(edit, EM_LIMITTEXT, WPARAM(8000), LPARAM(0));
    state.accessibility = Some(native_accessibility::Bridge::new(
        hwnd,
        crate::accessibility::tree(&state.engine.ui, state.engine.record()),
    ));
    state.accessibility.as_ref().unwrap().set_edit(edit);
    let _ui_window = WindowGuard(ui_window);
    sync_capture(ui_window);
    let assets = if state.options.assets.join("icons").is_dir() {
        state.options.assets.clone()
    } else {
        crate::paths::fallback_assets()
    };
    state.sync_back_app();
    state.sync_appearance();
    state.tray = Some(Tray::new(hwnd, &assets, dpi, state.engine.record())?);
    let speech_class = WNDCLASSW {
        lpszClassName: w!("CocoRustSpeech"),
        ..class
    };
    if RegisterClassW(&speech_class) == 0 {
        return Err(windows::core::Error::from_win32().into());
    }
    let speech = CreateWindowExW(
        WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT,
        w!("CocoRustSpeech"),
        w!(""),
        WS_POPUP,
        0,
        0,
        1,
        1,
        None,
        None,
        instance,
        None,
    )?;
    state.speech = speech;
    sync_capture(speech);
    let _speech_window = WindowGuard(speech);
    state.manual = state
        .engine
        .manual_position()
        .map(|(fx, fy)| Manual::Screen { fx, fy });
    state.scale = dpi.for_window(hwnd).max(96) as f64 / 96.0;
    if let Some((corner, dx, dy)) = state.engine.window_anchor() {
        if let Some(index) = ["topLeft", "topRight", "bottomLeft", "bottomRight"]
            .iter()
            .position(|c| *c == corner)
        {
            state.manual = Some(Manual::Window {
                corner: index as u8,
                dx: (dx * state.scale).round() as i32,
                dy: (dy * state.scale).round() as i32,
            });
        }
    }
    {
        let _dispatch = DispatchGuard::enter();
        state.draw()?;
        state.place();
        state.draw()?;
    }
    EVENT_WINDOW.store(hwnd.0 as isize, Ordering::Relaxed);
    let flags = WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS;
    let hooks = Hooks(vec![
        SetWinEventHook(
            EVENT_SYSTEM_FOREGROUND,
            EVENT_SYSTEM_FOREGROUND,
            None,
            Some(event_proc),
            0,
            0,
            flags,
        ),
        SetWinEventHook(
            EVENT_OBJECT_DESTROY,
            EVENT_OBJECT_HIDE,
            None,
            Some(event_proc),
            0,
            0,
            flags,
        ),
    ]);
    if hooks.0.iter().any(|hook| hook.0.is_null()) {
        let _ = DestroyWindow(hwnd);
        return Err(windows::core::Error::from_win32().into());
    }
    state.refresh_location_hook()?;
    let mut targets = vec![state.options.folder.clone()];
    if let Some(presence) = state.options.presence_folder.as_ref() {
        targets.push(presence.clone());
    }
    let mut watches = rebuild_watches(&targets, state.options.trace)?;
    // Arm notifications before the first authoritative reload; a startup rename cannot fall
    // into the gap between Engine construction and native watcher registration.
    {
        let _dispatch = DispatchGuard::enter();
        state.engine.reload(epoch_ms())?;
        if let Err(error) = state.sync_notices(epoch_ms()) {
            if state.options.trace {
                eprintln!("Windows notice unavailable: {error}");
            }
        }
        state.actions()?;
        state.place();
        state.draw()?;
    }
    loop {
        let mut handles: Vec<HANDLE> = watches.iter().map(|watch| watch.event.0).collect();
        let presence_index = state.engine.windows_presence_handle().map(|handle| {
            let index = handles.len();
            handles.push(HANDLE(handle as *mut c_void));
            index
        });
        let wake =
            MsgWaitForMultipleObjectsEx(Some(&handles), INFINITE, QS_ALLINPUT, MWMO_INPUTAVAILABLE);
        if wake == WAIT_FAILED {
            let _ = DestroyWindow(hwnd);
            return Err(windows::core::Error::from_win32().into());
        }
        let index = wake.0.wrapping_sub(WAIT_OBJECT_0.0) as usize;
        if index < watches.len() {
            if let Err(error) = watches[index].consume() {
                if state.options.trace {
                    eprintln!("directory watch changed: {error}");
                }
            }
            // New handles are armed before old ones are cancelled. Reopening after a parent
            // event distinguishes a replacement directory from a same-path, deleted handle.
            let replacement = rebuild_watches(&targets, state.options.trace)?;
            watches = replacement;
            {
                let _dispatch = DispatchGuard::enter();
                state.engine.reload(epoch_ms())?;
                if state.engine.ui.surface() == Surface::Activity {
                    state.sync_session_apps(epoch_ms());
                }
                if let Err(error) = state.sync_notices(epoch_ms()) {
                    if state.options.trace {
                        eprintln!("Windows notice unavailable: {error}");
                    }
                }
                state.actions()?;
                state.place();
                state.draw()?;
            }
        } else if Some(index) == presence_index {
            let _dispatch = DispatchGuard::enter();
            state.engine.presence_event(epoch_ms());
            if state.engine.ui.surface() == Surface::Activity {
                state.sync_session_apps(epoch_ms());
            }
            state.actions()?;
            state.place();
            state.draw()?;
        }
        let mut message = MSG::default();
        while PeekMessageW(&mut message, None, 0, 0, PM_REMOVE).as_bool() {
            if message.message == WM_QUIT {
                return match state.failure.take() {
                    Some(failure) => Err(failure.into()),
                    None => Ok(()),
                };
            }
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }
}

/// A nonblocking native guard for the common snapshot/journal transaction.
/// Windows has no active plugin presence producer yet; the on-disk lock name is retained.
pub struct PresenceLock {
    file: std::fs::File,
    overlapped: OVERLAPPED,
}
impl Drop for PresenceLock {
    fn drop(&mut self) {
        use std::os::windows::io::AsRawHandle;
        unsafe {
            let _ = UnlockFileEx(
                HANDLE(self.file.as_raw_handle()),
                0,
                1,
                0,
                &mut self.overlapped,
            );
        }
    }
}
pub fn acquire_presence_lock(folder: &Path) -> Result<Option<PresenceLock>, Error> {
    use std::os::windows::{fs::OpenOptionsExt, io::AsRawHandle};
    let file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0)
        .open(folder.join(".presence-flock"))?;
    let handle = HANDLE(file.as_raw_handle());
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    unsafe {
        GetFileInformationByHandle(handle, &mut info)?;
    }
    if info.dwFileAttributes & (FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_DIRECTORY).0 != 0 {
        return Err("presence lock must be a regular file".into());
    }
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
        Ok(()) => Ok(Some(PresenceLock { file, overlapped })),
        Err(error)
            if error.code() == windows::core::HRESULT::from_win32(ERROR_LOCK_VIOLATION.0) =>
        {
            Ok(None)
        }
        Err(error) => Err(error.into()),
    }
}
