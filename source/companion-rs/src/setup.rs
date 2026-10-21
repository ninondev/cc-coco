//! What the plugin asks of the pet's own program on Windows and Linux (lane C, 10-16; DECISIONS 941): write a
//! file the plugin shares with the pet, put the pet in a folder of its own and start it there, start it again, and
//! take it away. macOS keeps companion-macos.sh and companion-control. Each command prints one word for the plugin.
//!
//! The pet runs from its own folder, never from the plugin's: the plugin's folder changes with every update, and
//! Windows cannot replace a program that is running. Install copies the program and its pictures there, once per
//! version (the fingerprint), stopping the pet first when it has to replace it.
use crate::Error;
use std::{
    fs,
    io::{self, Read, Write},
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Command {
    /// The plugin's bytes on stdin go into `<folder>/<name>`, staged and renamed, and only into a folder that
    /// is already there.
    WriteShared { folder: PathBuf, name: String },
    /// Copy the pet into its folder if this version is not there yet, make its data folder, start it; with
    /// `--login`, also start it at login.
    Install { login: bool },
    /// Start the installed pet (one already running answers with a wave).
    Start,
    /// Ask a running pet to quit.
    Stop,
    /// Stop it, take its login entry away, move its folder and its data folder to the trash.
    Uninstall,
}

pub fn command(args: &[String]) -> Option<Command> {
    match args {
        [verb, folder, name] if verb == "write-shared" => Some(Command::WriteShared {
            folder: folder.into(),
            name: name.clone(),
        }),
        [verb] if verb == "install" => Some(Command::Install { login: false }),
        [verb, flag] if verb == "install" && flag == "--login" => {
            Some(Command::Install { login: true })
        }
        [verb] if verb == "start" => Some(Command::Start),
        [verb] if verb == "stop" => Some(Command::Stop),
        [verb] if verb == "uninstall" => Some(Command::Uninstall),
        _ => None,
    }
}

/// The app icon the Linux autostart entry shows, carried in the Linux build and written beside the program.
#[cfg(target_os = "linux")]
pub const ICON: &str = "coco-256.png";
#[cfg(target_os = "linux")]
const ICON_PNG: &[u8] = include_bytes!("../assets/icons/coco-256.png");
pub const EXE: &str = if cfg!(windows) {
    "coco-companion.exe"
} else {
    "coco-companion"
};

/// A shared file's name: plain, short, never hidden, so the plugin cannot be steered into another folder.
pub fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && !name.starts_with('.')
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_'))
}

/// Where the pet lives: `$XDG_DATA_HOME/coco-pet` (else `~/.local/share/coco-pet`) on Linux,
/// `%LOCALAPPDATA%\Programs\Coco Pet` on Windows.
pub fn app_folder(
    windows: bool,
    home: &str,
    data_home: Option<&str>,
    local_app_data: Option<&str>,
) -> PathBuf {
    if windows {
        let base = local_app_data
            .filter(|v| crate::paths::windows_path(v))
            .map(str::to_owned)
            .unwrap_or_else(|| crate::paths::join_path(home, &["AppData", "Local"]));
        return crate::paths::join_path(&base, &["Programs", "Coco Pet"]).into();
    }
    let base = data_home
        .filter(|v| v.starts_with('/'))
        .map(str::to_owned)
        .unwrap_or_else(|| crate::paths::join_path(home, &[".local", "share"]));
    crate::paths::join_path(&base, &["coco-pet"]).into()
}

fn fnv(hash: &mut u64, bytes: &[u8]) {
    for byte in bytes {
        *hash ^= u64::from(*byte);
        *hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
}

/// Every regular file under `root`, by its path with forward slashes, in order. Links are left out.
fn tree(root: &Path) -> io::Result<Vec<(String, PathBuf)>> {
    let mut out = Vec::new();
    let mut stack = vec![(String::new(), root.to_owned())];
    while let Some((prefix, folder)) = stack.pop() {
        for entry in fs::read_dir(&folder)? {
            let entry = entry?;
            let kind = entry.file_type()?;
            let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            let relative = if prefix.is_empty() {
                name
            } else {
                format!("{prefix}/{name}")
            };
            if kind.is_dir() {
                stack.push((relative, entry.path()));
            } else if kind.is_file() {
                out.push((relative, entry.path()));
            }
        }
    }
    out.sort();
    Ok(out)
}

/// The pet's pictures: its own folder, and Claudie's from the plugin's shared assets beside it
/// (plugin/assets/claudie), which an installed pet reads as assets/claudie (engine.rs wear_form).
pub fn pictures(assets: &Path) -> io::Result<Vec<(String, PathBuf)>> {
    let mut out = tree(assets)?;
    let claudie = assets.join("..").join("..").join("assets").join("claudie");
    if claudie.is_dir() && !assets.join("claudie").exists() {
        out.extend(
            tree(&claudie)?
                .into_iter()
                .map(|(relative, path)| (format!("claudie/{relative}"), path)),
        );
        out.sort();
    }
    Ok(out)
}

/// Which version of the pet and its pictures this is: the program's bytes and every picture's path and bytes.
pub fn fingerprint(exe: &Path, assets: &Path) -> io::Result<String> {
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    fnv(&mut hash, &fs::read(exe)?);
    for (relative, path) in pictures(assets)? {
        fnv(&mut hash, relative.as_bytes());
        fnv(&mut hash, &[0]);
        fnv(&mut hash, &fs::read(path)?);
        fnv(&mut hash, &[0]);
    }
    Ok(format!("{hash:016x}"))
}

fn copy_pictures(from: &Path, to: &Path) -> io::Result<()> {
    fs::create_dir_all(to)?;
    for (relative, path) in pictures(from)? {
        let target = relative
            .split('/')
            .fold(to.to_owned(), |path, part| path.join(part));
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(&path, &target)?;
    }
    Ok(())
}

/// Whether `app` already holds this version.
pub fn installed(exe: &Path, assets: &Path, app: &Path) -> io::Result<bool> {
    let print = fingerprint(exe, assets)?;
    Ok(app.join("bin").join(EXE).is_file()
        && fs::read_to_string(app.join("fingerprint")).ok().as_deref() == Some(print.as_str()))
}

/// Copies the program and its pictures into `app` beside whatever is there, then swaps them in. Returns
/// whether anything changed. The pet must not be running from `app` when this replaces it.
pub fn install_files(exe: &Path, assets: &Path, app: &Path) -> io::Result<bool> {
    let print = fingerprint(exe, assets)?;
    if app.join("bin").join(EXE).is_file()
        && fs::read_to_string(app.join("fingerprint")).ok().as_deref() == Some(print.as_str())
    {
        return Ok(false);
    }
    fs::create_dir_all(app)?;
    let stage = app.join(format!(".stage-{}", std::process::id()));
    if stage.exists() {
        fs::remove_dir_all(&stage)?;
    }
    let done = (|| {
        fs::create_dir_all(stage.join("new").join("bin"))?;
        fs::copy(exe, stage.join("new").join("bin").join(EXE))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(
                stage.join("new").join("bin").join(EXE),
                fs::Permissions::from_mode(0o755),
            )?;
        }
        // Linux autostart entries name the icon beside the program (os_metadata.rs), so it goes in with it.
        #[cfg(target_os = "linux")]
        fs::write(stage.join("new").join("bin").join(ICON), ICON_PNG)?;
        copy_pictures(assets, &stage.join("new").join("assets"))?;
        fs::create_dir_all(stage.join("old"))?;
        for part in ["bin", "assets"] {
            if app.join(part).exists() {
                fs::rename(app.join(part), stage.join("old").join(part))?;
            }
            fs::rename(stage.join("new").join(part), app.join(part))?;
        }
        let mut file = fs::File::create(stage.join("fingerprint"))?;
        file.write_all(print.as_bytes())?;
        file.sync_all()?;
        fs::rename(stage.join("fingerprint"), app.join("fingerprint"))
    })();
    // The stage holds only this program's own copies: the new one if the swap failed, else the old one.
    let _ = fs::remove_dir_all(&stage);
    done.map(|_| true)
}

fn read_input(limit: usize) -> io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    io::stdin()
        .lock()
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > limit {
        return Err(io::ErrorKind::InvalidData.into());
    }
    Ok(bytes)
}

/// A whole new file in an existing folder, staged and renamed so a reader sees the old file or the new one.
pub fn write_shared(folder: &Path, name: &str, bytes: &[u8]) -> io::Result<()> {
    if !valid_name(name) {
        return Err(io::ErrorKind::InvalidInput.into());
    }
    #[cfg(unix)]
    {
        crate::autostart_file::write_existing(&folder.join(name), bytes)
    }
    #[cfg(not(unix))]
    {
        let meta = fs::symlink_metadata(folder)?;
        if !meta.is_dir() || meta.file_type().is_symlink() {
            return Err(io::ErrorKind::PermissionDenied.into());
        }
        let target = folder.join(name);
        if let Ok(meta) = fs::symlink_metadata(&target) {
            if !meta.is_file() || meta.file_type().is_symlink() {
                return Err(io::ErrorKind::PermissionDenied.into());
            }
        }
        let stage = folder.join(format!(".{name}.{}.tmp", std::process::id()));
        let written = (|| {
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&stage)?;
            file.write_all(bytes)?;
            file.sync_all()?;
            drop(file);
            // The pet may be reading the old file this instant; its reads share delete, so a retry is enough.
            let mut tries = 0;
            loop {
                match fs::rename(&stage, &target) {
                    Ok(()) => return Ok(()),
                    Err(e) if tries < 5 => {
                        tries += 1;
                        let _ = e;
                        std::thread::sleep(std::time::Duration::from_millis(20));
                    }
                    Err(e) => return Err(e),
                }
            }
        })();
        if written.is_err() {
            let _ = fs::remove_file(&stage);
        }
        written
    }
}

#[cfg(unix)]
fn percent(path: &Path) -> String {
    let raw = path.to_string_lossy();
    let mut out = String::new();
    for byte in raw.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'-' | b'_' | b'.' | b'~') {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// Moves `path` into the freedesktop trash under `trash` (`files/` and `info/`), the way a file manager does,
/// so it can be put back. Returns false when there was nothing to move. Never deletes.
#[cfg(unix)]
pub fn trash_into(path: &Path, trash: &Path, deleted: &str) -> io::Result<bool> {
    use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
    if fs::symlink_metadata(path).is_err() {
        return Ok(false);
    }
    for part in ["files", "info"] {
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(trash.join(part))?;
    }
    let base = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or(io::ErrorKind::InvalidInput)?;
    for n in 1..1000 {
        let name = if n == 1 {
            base.to_owned()
        } else {
            format!("{base} {n}")
        };
        let info = trash.join("info").join(format!("{name}.trashinfo"));
        let mut file = match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&info)
        {
            Ok(file) => file,
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        };
        if trash.join("files").join(&name).exists() {
            drop(file);
            let _ = fs::remove_file(&info);
            continue;
        }
        file.write_all(
            format!(
                "[Trash Info]\nPath={}\nDeletionDate={deleted}\n",
                percent(path)
            )
            .as_bytes(),
        )?;
        file.sync_all()?;
        if let Err(e) = fs::rename(path, trash.join("files").join(&name)) {
            let _ = fs::remove_file(&info);
            return Err(e);
        }
        return Ok(true);
    }
    Err(io::ErrorKind::AlreadyExists.into())
}

/// Local time as the trash spec writes it, `2026-10-16T03:30:00`.
#[cfg(unix)]
fn local_now() -> String {
    unsafe {
        let now = libc::time(std::ptr::null_mut());
        let mut tm: libc::tm = std::mem::zeroed();
        libc::localtime_r(&now, &mut tm);
        format!(
            "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}",
            tm.tm_year + 1900,
            tm.tm_mon + 1,
            tm.tm_mday,
            tm.tm_hour,
            tm.tm_min,
            tm.tm_sec
        )
    }
}

#[cfg(windows)]
fn trash(path: &Path) -> io::Result<bool> {
    use std::os::windows::ffi::OsStrExt;
    use windows::Win32::UI::Shell::{
        SHFileOperationW, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOERRORUI, FOF_SILENT, FO_DELETE,
        SHFILEOPSTRUCTW,
    };
    if fs::symlink_metadata(path).is_err() {
        return Ok(false);
    }
    // Two NULs end the list of one path.
    let mut from: Vec<u16> = path.as_os_str().encode_wide().collect();
    from.extend([0, 0]);
    let mut operation = SHFILEOPSTRUCTW {
        wFunc: FO_DELETE,
        pFrom: windows::core::PCWSTR(from.as_ptr()),
        fFlags: (FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI).0 as u16,
        ..Default::default()
    };
    let result = unsafe { SHFileOperationW(&mut operation) };
    if result != 0 || operation.fAnyOperationsAborted.as_bool() {
        return Err(io::Error::other("the recycle bin refused"));
    }
    Ok(true)
}

#[cfg(target_os = "linux")]
fn trash(path: &Path) -> io::Result<bool> {
    let home = std::env::var("HOME").map_err(|_| io::Error::from(io::ErrorKind::NotFound))?;
    let data = std::env::var("XDG_DATA_HOME").ok();
    let base = data
        .filter(|v| v.starts_with('/'))
        .unwrap_or_else(|| crate::paths::join_path(&home, &[".local", "share"]));
    trash_into(path, &Path::new(&base).join("Trash"), &local_now())
}

/// Asks a running pet to quit and waits for it, up to five seconds. Returns whether one was running.
#[cfg(windows)]
fn stop_running(_data: &Path) -> bool {
    use windows::Win32::{
        Foundation::{CloseHandle, LPARAM, WPARAM},
        System::Threading::{OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE},
        UI::WindowsAndMessaging::{FindWindowW, GetWindowThreadProcessId, PostMessageW, WM_CLOSE},
    };
    unsafe {
        let Ok(window) = FindWindowW(windows::core::w!("CocoRustCompanion"), None) else {
            return false;
        };
        let mut pid = 0u32;
        GetWindowThreadProcessId(window, Some(&mut pid));
        let process = OpenProcess(PROCESS_SYNCHRONIZE, false, pid).ok();
        let _ = PostMessageW(window, WM_CLOSE, WPARAM(0), LPARAM(0));
        if let Some(process) = process {
            WaitForSingleObject(process, 5000);
            let _ = CloseHandle(process);
        }
        true
    }
}

#[cfg(target_os = "linux")]
fn stop_running(data: &Path) -> bool {
    let Some(pid) = fs::read(data.join("companion.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .and_then(|value| value.get("pid").and_then(serde_json::Value::as_u64))
        .filter(|pid| *pid > 1 && *pid <= i32::MAX as u64)
    else {
        return false;
    };
    // Only a pet: the number may belong to another program by now.
    let ours = fs::read_link(format!("/proc/{pid}/exe"))
        .ok()
        .and_then(|exe| exe.file_name().map(|n| n.to_string_lossy().into_owned()))
        .is_some_and(|name| name.starts_with(EXE));
    if !ours {
        return false;
    }
    let pid = pid as libc::pid_t;
    unsafe { libc::kill(pid, libc::SIGTERM) };
    for _ in 0..100 {
        if unsafe { libc::kill(pid, 0) } != 0 {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    true
}

/// Starts the installed pet on its own, apart from the plugin's process, with nothing to say back.
#[cfg(any(windows, target_os = "linux"))]
fn start(app: &Path) -> io::Result<()> {
    let exe = app.join("bin").join(EXE);
    let spawn = |breakaway: bool| {
        let mut command = std::process::Command::new(&exe);
        command
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            // DETACHED_PROCESS, CREATE_NEW_PROCESS_GROUP, and CREATE_BREAKAWAY_FROM_JOB when the job allows it.
            command.creation_flags(0x8 | 0x200 | if breakaway { 0x0100_0000 } else { 0 });
        }
        #[cfg(target_os = "linux")]
        {
            use std::os::unix::process::CommandExt;
            let _ = breakaway;
            unsafe {
                command.pre_exec(|| {
                    libc::setsid();
                    Ok(())
                });
            }
        }
        command.spawn().map(drop)
    };
    spawn(true).or_else(|_| spawn(false))
}

#[cfg(windows)]
fn remember_login(exe: &Path) -> Result<(), Error> {
    unsafe { crate::platform::windows::set_login_for(true, exe) }
}

#[cfg(target_os = "linux")]
fn remember_login(exe: &Path) -> Result<(), Error> {
    crate::platform::linux::set_login_for(true, exe)
}

#[cfg(windows)]
fn forget_login() -> Result<(), Error> {
    unsafe { crate::platform::windows::set_login(false) }
}

#[cfg(target_os = "linux")]
fn forget_login() -> Result<(), Error> {
    crate::platform::linux::set_login(false)
}

/// Runs a command and returns the word the plugin reads.
#[cfg(any(windows, target_os = "linux"))]
pub fn run(
    command: Command,
    data: &Path,
    exe: &Path,
    assets: &Path,
) -> Result<&'static str, Error> {
    let windows = cfg!(windows);
    let home = crate::paths::home_path(
        std::env::var("HOME").ok().as_deref(),
        std::env::var("USERPROFILE").ok().as_deref(),
    )
    .map(str::to_owned)
    .ok_or("home is unavailable")?;
    let app = app_folder(
        windows,
        &home,
        std::env::var("XDG_DATA_HOME").ok().as_deref(),
        std::env::var("LOCALAPPDATA").ok().as_deref(),
    );
    match command {
        Command::WriteShared { folder, name } => {
            let bytes = read_input(crate::feed::FEED_LIMIT)?;
            write_shared(&folder, &name, &bytes)?;
            Ok("written")
        }
        Command::Install { login } => {
            let word = if installed(exe, assets, &app)? {
                "same"
            } else {
                stop_running(data);
                install_files(exe, assets, &app)?;
                "installed"
            };
            fs::create_dir_all(data)?;
            if login {
                remember_login(&app.join("bin").join(EXE))?;
            }
            start(&app)?;
            Ok(word)
        }
        Command::Start => {
            if !app.join("bin").join(EXE).is_file() || !data.is_dir() {
                return Ok("absent");
            }
            start(&app)?;
            Ok("started")
        }
        Command::Stop => Ok(if stop_running(data) {
            "stopped"
        } else {
            "absent"
        }),
        Command::Uninstall => {
            stop_running(data);
            let _ = forget_login();
            // The data folder goes first: a pet started meanwhile quits when it is gone.
            let data_gone = trash(data);
            let app_gone = trash(&app);
            match (data_gone, app_gone) {
                (Ok(_), Ok(_)) => Ok("removed"),
                _ => Ok("kept"),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Scratch(PathBuf);
    impl Scratch {
        fn new() -> Self {
            static ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            let id = ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            // The shared-file writer walks the real path without following links; macOS's TMPDIR sits under /var, a link.
            let path = std::env::temp_dir().canonicalize().unwrap().join(format!(
                "coco-setup-{}-{}-{id}",
                std::process::id(),
                crate::epoch_ms()
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn commands_and_names_are_strict() {
        let args = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(
            command(&args(&["write-shared", "/x", "view.json"])),
            Some(Command::WriteShared {
                folder: "/x".into(),
                name: "view.json".into()
            })
        );
        assert_eq!(
            command(&args(&["install"])),
            Some(Command::Install { login: false })
        );
        assert_eq!(
            command(&args(&["install", "--login"])),
            Some(Command::Install { login: true })
        );
        assert_eq!(command(&args(&["stop"])), Some(Command::Stop));
        assert_eq!(command(&args(&["install", "extra"])), None);
        assert_eq!(command(&args(&["--login"])), None);
        assert!(valid_name("view.json"));
        for bad in ["", ".view.json", "../view.json", "a/b", "a\\b", "view json"] {
            assert!(!valid_name(bad), "{bad}");
        }
    }

    #[test]
    fn the_pet_lives_in_a_folder_of_its_own() {
        assert_eq!(
            app_folder(false, "/home/a", None, None),
            PathBuf::from("/home/a/.local/share/coco-pet")
        );
        assert_eq!(
            app_folder(false, "/home/a", Some("/data"), None),
            PathBuf::from("/data/coco-pet")
        );
        assert_eq!(
            app_folder(false, "/home/a", Some("relative"), None),
            PathBuf::from("/home/a/.local/share/coco-pet")
        );
        assert_eq!(
            app_folder(
                true,
                "C:\\Users\\a",
                Some("/ignored"),
                Some("C:\\Users\\a\\AppData\\Local")
            ),
            PathBuf::from("C:\\Users\\a\\AppData\\Local\\Programs\\Coco Pet")
        );
        assert_eq!(
            app_folder(true, "C:\\Users\\a", None, None),
            PathBuf::from("C:\\Users\\a\\AppData\\Local\\Programs\\Coco Pet")
        );
    }

    #[test]
    fn shared_files_go_only_into_a_folder_that_is_there() {
        let scratch = Scratch::new();
        let folder = scratch.0.join("Coco");
        assert!(write_shared(&folder, "view.json", b"{}").is_err());
        assert!(!folder.exists());
        fs::create_dir(&folder).unwrap();
        write_shared(&folder, "view.json", b"{\"a\":1}\n").unwrap();
        write_shared(&folder, "view.json", b"{\"a\":2}\n").unwrap();
        assert_eq!(fs::read(folder.join("view.json")).unwrap(), b"{\"a\":2}\n");
        assert!(write_shared(&folder, "../escape", b"x").is_err());
        assert_eq!(fs::read_dir(&folder).unwrap().count(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn a_linked_shared_file_is_refused() {
        let scratch = Scratch::new();
        let folder = scratch.0.join("Coco");
        fs::create_dir(&folder).unwrap();
        fs::write(scratch.0.join("elsewhere"), b"keep").unwrap();
        std::os::unix::fs::symlink(scratch.0.join("elsewhere"), folder.join("view.json")).unwrap();
        assert!(write_shared(&folder, "view.json", b"{}").is_err());
        assert_eq!(fs::read(scratch.0.join("elsewhere")).unwrap(), b"keep");
    }

    #[test]
    fn install_copies_once_per_version_and_swaps_the_old_one_out() {
        let scratch = Scratch::new();
        let exe = scratch.0.join("plugin-exe");
        let assets = scratch.0.join("assets");
        fs::create_dir_all(assets.join("coco")).unwrap();
        fs::write(&exe, b"program 1").unwrap();
        fs::write(assets.join("coco").join("band-A.json"), b"A").unwrap();
        fs::write(assets.join("words.json"), b"w").unwrap();
        let app = scratch.0.join("coco-pet");
        assert!(!installed(&exe, &assets, &app).unwrap());
        assert!(install_files(&exe, &assets, &app).unwrap());
        assert_eq!(fs::read(app.join("bin").join(EXE)).unwrap(), b"program 1");
        // on Linux the autostart icon sits beside the program, where the autostart entry names it
        #[cfg(target_os = "linux")]
        assert_eq!(fs::read(app.join("bin").join(ICON)).unwrap(), ICON_PNG);
        assert_eq!(
            fs::read(app.join("assets").join("coco").join("band-A.json")).unwrap(),
            b"A"
        );
        assert!(installed(&exe, &assets, &app).unwrap());
        assert!(!install_files(&exe, &assets, &app).unwrap());
        // a new picture is a new version; the old copy goes and no stage is left behind
        fs::write(assets.join("coco").join("band-A.json"), b"A2").unwrap();
        assert!(!installed(&exe, &assets, &app).unwrap());
        assert!(install_files(&exe, &assets, &app).unwrap());
        assert_eq!(
            fs::read(app.join("assets").join("coco").join("band-A.json")).unwrap(),
            b"A2"
        );
        let mut names: Vec<_> = fs::read_dir(&app)
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        names.sort();
        assert_eq!(names, ["assets", "bin", "fingerprint"]);
    }

    #[test]
    fn claudies_pictures_from_the_plugin_come_along() {
        // shipped as plugin/companion-rs/assets beside plugin/assets/claudie
        let scratch = Scratch::new();
        let plugin = scratch.0.join("plugin");
        let assets = plugin.join("companion-rs").join("assets");
        fs::create_dir_all(assets.join("coco")).unwrap();
        fs::write(assets.join("coco").join("band-A.json"), b"A").unwrap();
        fs::create_dir_all(plugin.join("assets").join("claudie").join("dake")).unwrap();
        fs::write(
            plugin
                .join("assets")
                .join("claudie")
                .join("dake")
                .join("01.png"),
            b"png",
        )
        .unwrap();
        let exe = scratch.0.join("exe");
        fs::write(&exe, b"program").unwrap();
        let app = scratch.0.join("coco-pet");
        assert!(install_files(&exe, &assets, &app).unwrap());
        assert_eq!(
            fs::read(
                app.join("assets")
                    .join("claudie")
                    .join("dake")
                    .join("01.png")
            )
            .unwrap(),
            b"png"
        );
        // a new picture of hers is a new version
        fs::write(
            plugin
                .join("assets")
                .join("claudie")
                .join("dake")
                .join("01.png"),
            b"png2",
        )
        .unwrap();
        assert!(!installed(&exe, &assets, &app).unwrap());
    }

    #[cfg(unix)]
    #[test]
    fn uninstall_moves_folders_into_the_trash_where_they_can_be_put_back() {
        let scratch = Scratch::new();
        let trash = scratch.0.join("Trash");
        // The Linux pet's folder (paths.rs companion_folder), under a home whose name has a space.
        let data = scratch.0.join("my home").join(".config").join("coco-pet");
        fs::create_dir_all(&data).unwrap();
        fs::write(data.join("companion.json"), b"{}").unwrap();
        assert!(trash_into(&data, &trash, "2026-10-16T03:30:00").unwrap());
        assert!(!data.exists());
        assert_eq!(
            fs::read(trash.join("files").join("coco-pet").join("companion.json")).unwrap(),
            b"{}"
        );
        let info = fs::read_to_string(trash.join("info").join("coco-pet.trashinfo")).unwrap();
        assert!(info.starts_with("[Trash Info]\nPath=/"));
        assert!(info.contains("/my%20home/.config/coco-pet\n"));
        assert!(info.ends_with("DeletionDate=2026-10-16T03:30:00\n"));
        // a second one with the same name gets its own number; nothing there moves nothing
        fs::create_dir_all(&data).unwrap();
        assert!(trash_into(&data, &trash, "2026-10-16T03:31:00").unwrap());
        assert!(trash.join("files").join("coco-pet 2").is_dir());
        assert!(trash.join("info").join("coco-pet 2.trashinfo").is_file());
        assert!(!trash_into(&data, &trash, "2026-10-16T03:32:00").unwrap());
    }
}
