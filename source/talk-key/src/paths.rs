//! Where our own files live. The home directory comes from the account database, not $HOME,
//! because the program reads no environment besides HTTPS_PROXY and NO_PROXY.

use std::path::PathBuf;

use crate::hooks;
use crate::out::{Fail, Kind};

fn no_home() -> Fail {
    Fail::new(Kind::Computer, "no-home")
}

#[cfg(unix)]
fn home() -> Result<PathBuf, Fail> {
    if let Some(h) = hooks::home() {
        return Ok(PathBuf::from(h));
    }
    use std::ffi::CStr;
    use std::os::unix::ffi::OsStrExt;
    let mut buf = vec![0 as libc::c_char; 16 * 1024];
    let mut pw: libc::passwd = unsafe { std::mem::zeroed() };
    let mut result: *mut libc::passwd = std::ptr::null_mut();
    let rc = unsafe { libc::getpwuid_r(libc::getuid(), &mut pw, buf.as_mut_ptr(), buf.len(), &mut result) };
    if rc != 0 || result.is_null() || pw.pw_dir.is_null() {
        return Err(no_home());
    }
    let dir = unsafe { CStr::from_ptr(pw.pw_dir) };
    let path = PathBuf::from(std::ffi::OsStr::from_bytes(dir.to_bytes()));
    if path.as_os_str().is_empty() { Err(no_home()) } else { Ok(path) }
}

/// Our directory: ~/.config/coco on Linux, ~/Library/Application Support/coco
/// on macOS, %LOCALAPPDATA%\coco on Windows (found through the shell, not the variable).
pub fn our_dir() -> Result<PathBuf, Fail> {
    #[cfg(target_os = "macos")]
    let dir = home()?.join("Library").join("Application Support").join("coco");
    #[cfg(all(unix, not(target_os = "macos")))]
    let dir = home()?.join(".config").join("coco");
    #[cfg(windows)]
    let dir = windows_local_app_data()?.join("coco");
    ensure_dir(&dir)?;
    Ok(dir)
}

/// Created 0700 when missing. An existing folder must be ours; if its mode lets anyone else in,
/// it is tightened to 0700.
#[cfg(unix)]
fn ensure_dir(dir: &std::path::Path) -> Result<(), Fail> {
    use std::os::unix::fs::{DirBuilderExt, MetadataExt, PermissionsExt};
    if !dir.exists() {
        std::fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(dir)
            .map_err(|_| Fail::new(Kind::Computer, "dir-create"))?;
    }
    let meta = std::fs::metadata(dir).map_err(|_| Fail::new(Kind::Computer, "dir-create"))?;
    if !meta.is_dir() || meta.uid() != unsafe { libc::getuid() } {
        return Err(Fail::new(Kind::Computer, "dir-not-ours"));
    }
    if meta.mode() & 0o077 != 0 {
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))
            .map_err(|_| Fail::new(Kind::Computer, "dir-mode"))?;
    }
    Ok(())
}

#[cfg(windows)]
fn ensure_dir(dir: &std::path::Path) -> Result<(), Fail> {
    std::fs::create_dir_all(dir).map_err(|_| Fail::new(Kind::Computer, "dir-create"))
}

#[cfg(windows)]
fn windows_local_app_data() -> Result<PathBuf, Fail> {
    if let Some(h) = hooks::home() {
        return Ok(PathBuf::from(h));
    }
    use std::os::windows::ffi::OsStringExt;
    use windows_sys::Win32::System::Com::CoTaskMemFree;
    use windows_sys::Win32::UI::Shell::{FOLDERID_LocalAppData, SHGetKnownFolderPath};
    let mut p: windows_sys::core::PWSTR = std::ptr::null_mut();
    let hr = unsafe { SHGetKnownFolderPath(&FOLDERID_LocalAppData, 0, std::ptr::null_mut(), &mut p) };
    if hr != 0 || p.is_null() {
        if !p.is_null() {
            unsafe { CoTaskMemFree(p as *const _) };
        }
        return Err(no_home());
    }
    let mut len = 0;
    while unsafe { *p.add(len) } != 0 {
        len += 1;
    }
    let wide = unsafe { std::slice::from_raw_parts(p, len) };
    let path = PathBuf::from(std::ffi::OsString::from_wide(wide));
    unsafe { CoTaskMemFree(p as *const _) };
    Ok(path)
}
