//! Linux: the Secret Service through secret-tool (the key goes over its stdin, never argv),
//! else ~/.config/coco/talk-key at 0600.

use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::PathBuf;
use std::process::Command;

use super::{missing, stored};
use crate::child;
use crate::hooks;
use crate::out::{Fail, Kind};
use crate::paths;
use crate::secret::{Secret, wipe};

const ATTRS: [&str; 4] = ["service", "coco", "account", "talk-key"];
const LABEL: &str = "--label=Coco talk-key";
const FILE: &str = "talk-key";
/// Left in the file by a `remove` that could not reach the keyring: no key until the next save,
/// even if the keyring still holds one.
const TOMBSTONE: &[u8] = b"removed\n";
/// Fixed places, because PATH is environment and we read none besides the proxy pair.
const TOOL_PATHS: [&str; 3] = ["/usr/bin/secret-tool", "/bin/secret-tool", "/usr/local/bin/secret-tool"];

fn tool() -> Option<PathBuf> {
    match hooks::secret_tool() {
        Some(p) if p == "none" => None,
        Some(p) => Some(PathBuf::from(p)),
        None => TOOL_PATHS.iter().map(PathBuf::from).find(|p| p.is_file()),
    }
}

enum Tool {
    Done(Vec<u8>),
    NotFound,
    /// The bus answers but no keyring service is installed: nothing can be stored there.
    NoService,
    /// No session bus here (or the helper will not start): the keyring may hold a key we can't see.
    Unreachable,
    Failed(&'static str),
}

fn run(tool: &PathBuf, args: &[&str], input: Option<&[u8]>) -> Tool {
    let Ok(mut out) = child::run(Command::new(tool).args(args), input) else { return Tool::Unreachable };
    if out.status.success() {
        return Tool::Done(std::mem::take(&mut out.stdout));
    }
    wipe(&mut out.stdout);
    let err = out.stderr.to_ascii_lowercase();
    let any = |marks: &[&str]| marks.iter().any(|m| err.contains(m));
    if any(&["cannot autolaunch", "could not connect", "failed to connect", "unable to autolaunch", "dbus_session_bus_address"]) {
        Tool::Unreachable
    } else if any(&["not provided by any .service", "serviceunknown", "org.freedesktop.secrets", "no such interface"]) {
        Tool::NoService
    } else if err.trim().is_empty() {
        Tool::NotFound
    } else if err.contains("lock") {
        Tool::Failed("keyring-locked")
    } else if err.contains("dismiss") || err.contains("cancel") || err.contains("denied") {
        Tool::Failed("keyring-denied")
    } else {
        Tool::Failed("keyring-error")
    }
}

fn unreachable() -> Fail {
    Fail::new(Kind::Computer, "keyring-unreachable")
}

fn file_path() -> Result<PathBuf, Fail> {
    Ok(paths::our_dir()?.join(FILE))
}

fn file_save(key: &Secret) -> Result<(), Fail> {
    file_write(key.as_bytes())
}

fn file_write(content: &[u8]) -> Result<(), Fail> {
    let path = file_path()?;
    let tmp = path.with_file_name(format!(".{FILE}.{}.tmp", std::process::id()));
    let _ = fs::remove_file(&tmp);
    let written = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&tmp)
        .and_then(|mut f| f.write_all(content).and_then(|_| f.sync_all()))
        .and_then(|_| fs::rename(&tmp, &path));
    if written.is_err() {
        let _ = fs::remove_file(&tmp);
        return Err(Fail::new(Kind::Computer, "file-write"));
    }
    Ok(())
}

enum InFile {
    Key(Secret),
    Removed,
    Absent,
}

fn file_load() -> Result<InFile, Fail> {
    let path = file_path()?;
    let Ok(meta) = fs::symlink_metadata(&path) else { return Ok(InFile::Absent) };
    if !meta.is_file() || meta.uid() != unsafe { libc::getuid() } {
        return Err(Fail::new(Kind::Computer, "file-not-ours"));
    }
    if meta.mode() & 0o077 != 0 {
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).map_err(|_| Fail::new(Kind::Computer, "file-mode"))?;
    }
    if meta.len() > 4096 {
        return Err(Fail::new(Kind::Computer, "stored-value-not-a-key"));
    }
    // Room for the whole file up front, so reading it never reallocates.
    let mut bytes = Vec::with_capacity(meta.len() as usize + 64);
    OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(&path)
        .and_then(|mut f| f.read_to_end(&mut bytes))
        .map_err(|_| Fail::new(Kind::Computer, "file-read"))?;
    if bytes == TOMBSTONE {
        return Ok(InFile::Removed);
    }
    stored(bytes).map(InFile::Key)
}

fn file_remove() -> Result<(), Fail> {
    let path = file_path()?;
    let Ok(meta) = fs::symlink_metadata(&path) else { return Ok(()) };
    if meta.is_file()
        && let Ok(mut f) = OpenOptions::new().write(true).custom_flags(libc::O_NOFOLLOW).open(&path) {
            let _ = f.write_all(&vec![0u8; meta.len() as usize]).and_then(|_| f.sync_all());
        }
    fs::remove_file(&path).map_err(|_| Fail::new(Kind::Computer, "file-remove"))
}

/// A keyring save removes the file; a file save tries to clear the keyring entry. Either way the
/// file exists only when the last save went there, which is why `load` reads it first.
pub fn save(key: &Secret) -> Result<&'static str, Fail> {
    let tool = tool();
    if let Some(t) = &tool {
        let mut args = vec!["store", LABEL];
        args.extend(ATTRS);
        match run(t, &args, Some(key.as_bytes())) {
            Tool::Done(_) => {
                file_remove()?;
                return Ok("secret-service");
            }
            Tool::NoService | Tool::NotFound | Tool::Unreachable => {}
            Tool::Failed(d) => return Err(Fail::new(Kind::Computer, d)),
        }
    }
    file_save(key)?;
    if let Some(t) = &tool {
        let mut args = vec!["clear"];
        args.extend(ATTRS);
        let _ = run(t, &args, None);
    }
    Ok("file")
}

pub fn load() -> Result<(Secret, &'static str), Fail> {
    match file_load()? {
        InFile::Key(k) => return Ok((k, "file")),
        InFile::Removed => return Err(missing()),
        InFile::Absent => {}
    }
    let Some(t) = tool() else { return Err(missing()) };
    let mut args = vec!["lookup"];
    args.extend(ATTRS);
    match run(&t, &args, None) {
        Tool::Done(out) if !out.iter().all(u8::is_ascii_whitespace) => Ok((stored(out)?, "secret-service")),
        Tool::Done(mut out) => {
            wipe(&mut out);
            Err(missing())
        }
        Tool::NoService | Tool::NotFound => Err(missing()),
        Tool::Unreachable => Err(unreachable()),
        Tool::Failed(d) => Err(Fail::new(Kind::Computer, d)),
    }
}

/// Never a plain "removed" while the keyring could still hold the key; then a tombstone keeps
/// that key from being used until the keyring can be cleared.
pub fn remove() -> Result<(), Fail> {
    let mut keyring = Ok(());
    if let Some(t) = tool() {
        let mut args = vec!["clear"];
        args.extend(ATTRS);
        keyring = match run(&t, &args, None) {
            Tool::Done(_) | Tool::NotFound | Tool::NoService => Ok(()),
            Tool::Unreachable => Err(unreachable()),
            Tool::Failed(d) => Err(Fail::new(Kind::Computer, d)),
        };
    }
    file_remove()?;
    if keyring.is_err() {
        file_write(TOMBSTONE)?;
    }
    keyring
}
