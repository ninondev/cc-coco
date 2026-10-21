use std::io;

pub trait Shell {
    fn create_owned(&mut self) -> io::Result<()>;
    fn remove_owned(&mut self) -> io::Result<()>;
}

#[derive(Default)]
pub struct Lifecycle {
    enabled: Option<bool>,
}
impl Lifecycle {
    pub fn sync(&mut self, notices: bool, shell: &mut impl Shell) -> io::Result<()> {
        if self.enabled != Some(notices) {
            if notices {
                shell.create_owned()?;
            } else {
                shell.remove_owned()?;
            }
            self.enabled = Some(notices);
        }
        Ok(())
    }
    pub fn uninstall(&mut self, shell: &mut impl Shell) -> io::Result<()> {
        shell.remove_owned()?;
        self.enabled = Some(false);
        Ok(())
    }
}

pub fn owns_bytes<T: PartialEq + ?Sized>(
    expected_executable: &T,
    receipt_executable: &T,
    receipt: &[u8],
    bytes: &[u8],
    reparse: bool,
) -> bool {
    !reparse && expected_executable == receipt_executable && !receipt.is_empty() && receipt == bytes
}

#[cfg(test)]
mod tests {
    use super::*;
    #[derive(Default)]
    struct FakeShell {
        present: bool,
        owned: bool,
        tampered: bool,
        reparse: bool,
        creates: usize,
        removes: usize,
    }
    impl Shell for FakeShell {
        fn create_owned(&mut self) -> io::Result<()> {
            if !self.present {
                self.present = true;
                self.owned = true;
                self.creates += 1;
            }
            Ok(())
        }
        fn remove_owned(&mut self) -> io::Result<()> {
            if self.present && self.owned && !self.tampered && !self.reparse {
                self.present = false;
                self.removes += 1;
            }
            Ok(())
        }
    }
    #[test]
    fn ownership_binds_executable_complete_bytes_and_regular_handle() {
        assert!(owns_bytes("own.exe", "own.exe", b"link", b"link", false));
        assert!(!owns_bytes(
            "own.exe",
            "foreign.exe",
            b"link",
            b"link",
            false
        ));
        assert!(!owns_bytes(
            "own.exe",
            "own.exe",
            b"link",
            b"tampered",
            false
        ));
        assert!(!owns_bytes("own.exe", "own.exe", b"link", b"link", true));
        assert!(!owns_bytes("own.exe", "own.exe", b"", b"", false));
    }
    #[test]
    fn settings_on_creates_and_off_removes_without_a_toast() {
        let mut life = Lifecycle::default();
        let mut shell = FakeShell::default();
        life.sync(false, &mut shell).unwrap();
        assert_eq!(shell.creates, 0);
        life.sync(true, &mut shell).unwrap();
        assert!(shell.present);
        life.sync(true, &mut shell).unwrap();
        assert_eq!(shell.creates, 1);
        life.sync(false, &mut shell).unwrap();
        assert!(!shell.present);
        assert_eq!(shell.removes, 1);
    }
    #[test]
    fn uninstall_removes_owned_shortcut_in_fresh_process() {
        let mut shell = FakeShell {
            present: true,
            owned: true,
            ..Default::default()
        };
        Lifecycle::default().uninstall(&mut shell).unwrap();
        assert!(!shell.present);
    }
    #[test]
    fn off_removes_owned_shortcut_in_fresh_process() {
        let mut shell = FakeShell {
            present: true,
            owned: true,
            ..Default::default()
        };
        Lifecycle::default().sync(false, &mut shell).unwrap();
        assert!(!shell.present);
    }
    #[test]
    fn preserves_foreign_tampered_and_reparse_shortcuts() {
        for (owned, tampered, reparse) in [
            (false, false, false),
            (true, true, false),
            (true, false, true),
        ] {
            let mut shell = FakeShell {
                present: true,
                owned,
                tampered,
                reparse,
                ..Default::default()
            };
            let mut life = Lifecycle::default();
            life.sync(true, &mut shell).unwrap();
            life.sync(false, &mut shell).unwrap();
            life.uninstall(&mut shell).unwrap();
            assert!(shell.present);
            assert_eq!(shell.removes, 0);
        }
    }
}
