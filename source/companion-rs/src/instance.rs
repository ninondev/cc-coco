//! A permanent lock inode prevents a second Linux window without a polling process.
use std::{
    fs::{File, OpenOptions},
    io,
    os::{fd::AsRawFd, unix::fs::OpenOptionsExt},
    path::Path,
};

pub struct InstanceGuard(File);
impl InstanceGuard {
    pub fn acquire(folder: &Path) -> io::Result<Option<Self>> {
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(folder.join(".companion-instance"))?;
        if !file.metadata()?.is_file() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "companion instance lock is not a regular file",
            ));
        }
        if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } == 0 {
            return Ok(Some(Self(file)));
        }
        let error = io::Error::last_os_error();
        if error.kind() == io::ErrorKind::WouldBlock {
            Ok(None)
        } else {
            Err(error)
        }
    }
}
impl Drop for InstanceGuard {
    fn drop(&mut self) {
        unsafe {
            libc::flock(self.0.as_raw_fd(), libc::LOCK_UN);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exclusive_inode_is_reusable_after_owner_exits() {
        let folder = std::env::temp_dir().join(format!(
            "companion-instance-{}-{}",
            std::process::id(),
            crate::epoch_ms()
        ));
        std::fs::create_dir_all(&folder).unwrap();
        let owner = InstanceGuard::acquire(&folder).unwrap().unwrap();
        assert!(InstanceGuard::acquire(&folder).unwrap().is_none());
        drop(owner);
        assert!(InstanceGuard::acquire(&folder).unwrap().is_some());
        std::fs::remove_file(folder.join(".companion-instance")).unwrap();
        std::fs::remove_dir(folder).unwrap();
    }
}
