use std::{
    ffi::{CString, OsStr},
    fs::File,
    io::{self, Write},
    os::{
        fd::{AsRawFd, FromRawFd, OwnedFd},
        unix::ffi::OsStrExt,
    },
    path::{Component, Path},
};

fn name(value: &OsStr) -> io::Result<CString> {
    CString::new(value.as_bytes()).map_err(|_| io::ErrorKind::InvalidInput.into())
}

fn descriptor(result: libc::c_int) -> io::Result<OwnedFd> {
    if result < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(unsafe { OwnedFd::from_raw_fd(result) })
    }
}

fn inspect(fd: &OwnedFd) -> io::Result<libc::stat> {
    let mut st = std::mem::MaybeUninit::uninit();
    if unsafe { libc::fstat(fd.as_raw_fd(), st.as_mut_ptr()) } < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(unsafe { st.assume_init() })
}

fn directory_safe(fd: &OwnedFd, private: bool) -> io::Result<()> {
    let st = inspect(fd)?;
    let uid = unsafe { libc::geteuid() };
    let sticky_root = st.st_uid == 0 && st.st_mode & libc::S_ISVTX != 0;
    if st.st_mode & libc::S_IFMT != libc::S_IFDIR
        || (st.st_uid != uid && st.st_uid != 0)
        || (st.st_mode & 0o022 != 0 && !sticky_root)
        || (private && (st.st_uid != uid || st.st_mode & 0o077 != 0))
    {
        return Err(io::ErrorKind::PermissionDenied.into());
    }
    Ok(())
}

fn folder(path: &Path, create: bool) -> io::Result<OwnedFd> {
    if !path.is_absolute() {
        return Err(io::ErrorKind::InvalidInput.into());
    }
    let root = CString::new("/").unwrap();
    let mut fd = descriptor(unsafe {
        libc::open(
            root.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    })?;
    directory_safe(&fd, false)?;
    for component in path.components() {
        let value = match component {
            Component::RootDir => continue,
            Component::Normal(value) => name(value)?,
            _ => return Err(io::ErrorKind::InvalidInput.into()),
        };
        let flags = libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC;
        let result = unsafe { libc::openat(fd.as_raw_fd(), value.as_ptr(), flags) };
        let next =
            if create && result < 0 && io::Error::last_os_error().kind() == io::ErrorKind::NotFound
            {
                if unsafe { libc::mkdirat(fd.as_raw_fd(), value.as_ptr(), 0o700) } < 0
                    && io::Error::last_os_error().kind() != io::ErrorKind::AlreadyExists
                {
                    return Err(io::Error::last_os_error());
                }
                descriptor(unsafe { libc::openat(fd.as_raw_fd(), value.as_ptr(), flags) })?
            } else {
                descriptor(result)?
            };
        directory_safe(&next, false)?;
        fd = next;
    }
    if inspect(&fd)?.st_uid != unsafe { libc::geteuid() } {
        return Err(io::ErrorKind::PermissionDenied.into());
    }
    Ok(fd)
}

fn destination_safe(parent: &OwnedFd, leaf: &CString) -> io::Result<()> {
    let mut st = std::mem::MaybeUninit::uninit();
    if unsafe {
        libc::fstatat(
            parent.as_raw_fd(),
            leaf.as_ptr(),
            st.as_mut_ptr(),
            libc::AT_SYMLINK_NOFOLLOW,
        )
    } < 0
    {
        let e = io::Error::last_os_error();
        return if e.kind() == io::ErrorKind::NotFound {
            Ok(())
        } else {
            Err(e)
        };
    }
    let st = unsafe { st.assume_init() };
    if st.st_mode & libc::S_IFMT != libc::S_IFREG
        || st.st_uid != unsafe { libc::geteuid() }
        || st.st_nlink != 1
    {
        return Err(io::ErrorKind::PermissionDenied.into());
    }
    Ok(())
}

pub fn remove(path: &Path) -> io::Result<()> {
    let parent = match folder(path.parent().ok_or(io::ErrorKind::InvalidInput)?, false) {
        Ok(parent) => parent,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e),
    };
    let leaf = name(path.file_name().ok_or(io::ErrorKind::InvalidInput)?)?;
    destination_safe(&parent, &leaf)?;
    if unsafe { libc::unlinkat(parent.as_raw_fd(), leaf.as_ptr(), 0) } < 0 {
        let e = io::Error::last_os_error();
        if e.kind() != io::ErrorKind::NotFound {
            return Err(e);
        }
    }
    Ok(())
}

struct Stage<'a> {
    parent: &'a OwnedFd,
    directory: CString,
    fd: OwnedFd,
}
impl Drop for Stage<'_> {
    fn drop(&mut self) {
        unsafe {
            libc::unlinkat(self.fd.as_raw_fd(), c"entry".as_ptr(), 0);
            libc::unlinkat(
                self.parent.as_raw_fd(),
                self.directory.as_ptr(),
                libc::AT_REMOVEDIR,
            );
        }
    }
}

pub fn write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    write_in(path, bytes, true)
}

/// The same staged write into a folder that must already be there: the plugin's shared files go only
/// where the pet's install made the folder, so an uninstalled pet stays uninstalled (setup.rs).
pub fn write_existing(path: &Path, bytes: &[u8]) -> io::Result<()> {
    write_in(path, bytes, false)
}

fn write_in(path: &Path, bytes: &[u8], create: bool) -> io::Result<()> {
    let parent = folder(path.parent().ok_or(io::ErrorKind::InvalidInput)?, create)?;
    let leaf = name(path.file_name().ok_or(io::ErrorKind::InvalidInput)?)?;
    destination_safe(&parent, &leaf)?;
    static ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let mut collisions = 0;
    let stage = loop {
        let id = ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let directory = CString::new(format!(
            ".coco-companion.{}.{}.tmp",
            std::process::id(),
            id
        ))
        .unwrap();
        if unsafe { libc::mkdirat(parent.as_raw_fd(), directory.as_ptr(), 0o700) } < 0 {
            let e = io::Error::last_os_error();
            if e.kind() == io::ErrorKind::AlreadyExists {
                collisions += 1;
                if collisions < 128 {
                    continue;
                }
            }
            return Err(e);
        }
        let fd = match descriptor(unsafe {
            libc::openat(
                parent.as_raw_fd(),
                directory.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        }) {
            Ok(fd) => fd,
            Err(e) => {
                unsafe {
                    libc::unlinkat(parent.as_raw_fd(), directory.as_ptr(), libc::AT_REMOVEDIR);
                }
                return Err(e);
            }
        };
        let stage = Stage {
            parent: &parent,
            directory,
            fd,
        };
        directory_safe(&stage.fd, true)?;
        break stage;
    };
    let fd = descriptor(unsafe {
        libc::openat(
            stage.fd.as_raw_fd(),
            c"entry".as_ptr(),
            libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0o600,
        )
    })?;
    let st = inspect(&fd)?;
    if st.st_uid != unsafe { libc::geteuid() }
        || st.st_mode & libc::S_IFMT != libc::S_IFREG
        || st.st_nlink != 1
    {
        return Err(io::ErrorKind::PermissionDenied.into());
    }
    let mut file = File::from(fd);
    file.write_all(bytes)?;
    file.sync_all()?;
    destination_safe(&parent, &leaf)?;
    if unsafe {
        libc::renameat(
            stage.fd.as_raw_fd(),
            c"entry".as_ptr(),
            parent.as_raw_fd(),
            leaf.as_ptr(),
        )
    } < 0
    {
        return Err(io::Error::last_os_error());
    }
    if unsafe { libc::fsync(parent.as_raw_fd()) } < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::{symlink, PermissionsExt};
    struct Scratch(std::path::PathBuf);
    impl Scratch {
        fn new() -> Self {
            static ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            let p = std::fs::canonicalize(std::env::temp_dir())
                .unwrap()
                .join(format!(
                    "autostart-file-{}-{}",
                    std::process::id(),
                    ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
                ));
            std::fs::create_dir(&p).unwrap();
            std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o700)).unwrap();
            Self(p)
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            std::fs::remove_dir_all(&self.0).unwrap();
        }
    }
    #[test]
    fn predictable_temporary_symlink_cannot_overwrite() {
        let s = Scratch::new();
        let victim = s.0.join("victim");
        std::fs::write(&victim, b"before").unwrap();
        symlink(
            &victim,
            s.0.join(format!(".coco-companion.{}.tmp", std::process::id())),
        )
        .unwrap();
        let _ = write(&s.0.join("entry"), b"after");
        assert_eq!(std::fs::read(&victim).unwrap(), b"before");
    }
    #[test]
    fn symlink_ancestor_is_rejected() {
        let s = Scratch::new();
        let outside = s.0.join("outside");
        std::fs::create_dir(&outside).unwrap();
        symlink(&outside, s.0.join("alias")).unwrap();
        assert!(write(&s.0.join("alias/entry"), b"after").is_err());
        assert!(!outside.join("entry").exists());
    }
    #[test]
    fn linked_destination_is_rejected() {
        let s = Scratch::new();
        let victim = s.0.join("victim");
        std::fs::write(&victim, b"before").unwrap();
        let entry = s.0.join("entry");
        std::fs::hard_link(&victim, &entry).unwrap();
        assert!(write(&entry, b"after").is_err());
        assert_eq!(std::fs::read(&victim).unwrap(), b"before");
    }
    #[test]
    fn writable_parent_is_rejected() {
        let s = Scratch::new();
        std::fs::set_permissions(&s.0, std::fs::Permissions::from_mode(0o777)).unwrap();
        assert!(write(&s.0.join("entry"), b"after").is_err());
        assert!(!s.0.join("entry").exists());
    }
    #[test]
    fn replacement_is_complete_and_private() {
        let s = Scratch::new();
        let entry = s.0.join("entry");
        write(&entry, b"before").unwrap();
        write(&entry, b"after").unwrap();
        assert_eq!(std::fs::read(&entry).unwrap(), b"after");
        assert_eq!(
            std::fs::metadata(&entry).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
}
