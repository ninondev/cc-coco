use super::*;
use crate::windows_notice_shortcut::{owns_bytes, Shell};
use std::{
    fs::{File, OpenOptions},
    io::{self, Read, Write},
    os::windows::{fs::OpenOptionsExt, io::AsRawHandle},
};

#[derive(serde::Serialize, serde::Deserialize)]
struct Receipt {
    executable: Vec<u16>,
    shortcut: PathBuf,
    bytes: Vec<u8>,
}

pub(super) struct NoticeShortcut<'a> {
    pub folder: &'a Path,
}
fn invalid() -> io::Error {
    io::ErrorKind::PermissionDenied.into()
}
fn native_error(error: impl std::error::Error) -> io::Error {
    io::Error::other(error.to_string())
}
unsafe fn location() -> io::Result<PathBuf> {
    let folder =
        SHGetKnownFolderPath(&FOLDERID_Programs, KF_FLAG_DEFAULT, None).map_err(native_error)?;
    let value = folder.to_string();
    CoTaskMemFree(Some(folder.0.cast()));
    Ok(PathBuf::from(value.map_err(native_error)?)
        .join(format!("{}.lnk", crate::platform_words::OS_DISCOVERY_NAME)))
}
fn protected(path: &Path, delete: bool) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options
        .read(true)
        .share_mode(0)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0);
    if delete {
        options.access_mode(GENERIC_READ.0 | DELETE.0);
    }
    let file = options.open(path)?;
    regular(&file)?;
    Ok(file)
}
fn regular(file: &File) -> io::Result<()> {
    crate::protocol::ensure_regular_handle(file)?;
    let mut information = BY_HANDLE_FILE_INFORMATION::default();
    unsafe { GetFileInformationByHandle(HANDLE(file.as_raw_handle()), &mut information) }
        .map_err(native_error)?;
    if information.nNumberOfLinks != 1 {
        return Err(invalid());
    }
    Ok(())
}

fn protect_ancestors(paths: &[&Path]) -> io::Result<Vec<File>> {
    let mut directories = Vec::new();
    let mut held = std::collections::BTreeSet::new();
    for path in paths {
        let absolute = if path.is_absolute() {
            path.to_path_buf()
        } else {
            std::env::current_dir()?.join(path)
        };
        for directory in absolute.ancestors().collect::<Vec<_>>().into_iter().rev() {
            if !held.insert(directory.to_path_buf()) {
                continue;
            }
            let file = OpenOptions::new()
                .read(true)
                .access_mode(FILE_READ_ATTRIBUTES.0)
                .share_mode(FILE_SHARE_READ.0)
                .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0 | FILE_FLAG_BACKUP_SEMANTICS.0)
                .open(directory)?;
            let mut information = BY_HANDLE_FILE_INFORMATION::default();
            unsafe { GetFileInformationByHandle(HANDLE(file.as_raw_handle()), &mut information) }
                .map_err(native_error)?;
            if information.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0
                || information.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY.0 == 0
            {
                return Err(invalid());
            }
            directories.push(file);
        }
    }
    Ok(directories)
}
fn bounded(file: &File, limit: usize) -> io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    file.take(limit as u64 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > limit {
        return Err(invalid());
    }
    Ok(bytes)
}
fn delete_handle(file: &File) -> io::Result<()> {
    let disposition = FILE_DISPOSITION_INFO {
        DeleteFile: BOOLEAN(1),
    };
    unsafe {
        SetFileInformationByHandle(
            HANDLE(file.as_raw_handle()),
            FileDispositionInfo,
            (&disposition as *const FILE_DISPOSITION_INFO).cast(),
            std::mem::size_of_val(&disposition) as u32,
        )
    }
    .map_err(native_error)
}
impl NoticeShortcut<'_> {
    fn receipt_path(&self) -> PathBuf {
        self.folder.join("notice-shortcut.json")
    }
    fn receipt(&self) -> io::Result<(File, Receipt)> {
        let file = protected(&self.receipt_path(), true)?;
        let receipt = serde_json::from_slice(&bounded(&file, 512 * 1024)?).map_err(native_error)?;
        Ok((file, receipt))
    }
    fn generated(&self) -> io::Result<Vec<u8>> {
        // Serialize in memory; the Shell serializer never opens a temporary pathname.
        unsafe {
            let link: IShellLinkW =
                CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).map_err(native_error)?;
            let executable = wide(std::env::current_exe()?);
            link.SetPath(PCWSTR(executable.as_ptr()))
                .map_err(native_error)?;
            link.SetIconLocation(PCWSTR(executable.as_ptr()), 0)
                .map_err(native_error)?;
            link.SetArguments(w!("--login")).map_err(native_error)?;
            let properties: IPropertyStore = link.cast().map_err(native_error)?;
            let app_id = PROPERTYKEY {
                fmtid: windows::core::GUID::from_u128(0x9f4c2855_9f79_4b39_a8d0_e1d42de1d5f3),
                pid: 5,
            };
            let mut id = PROPVARIANT::default();
            PropVariantChangeType(
                &mut id,
                &PROPVARIANT::from(APP_ID),
                PVCHF_DEFAULT,
                VT_LPWSTR,
            )
            .map_err(native_error)?;
            properties.SetValue(&app_id, &id).map_err(native_error)?;
            properties.Commit().map_err(native_error)?;
            let persistence: IPersistStream = link.cast().map_err(native_error)?;
            let stream = CreateStreamOnHGlobal(None, true).map_err(native_error)?;
            persistence.Save(&stream, true).map_err(native_error)?;
            let mut stat = STATSTG::default();
            stream
                .Stat(&mut stat, STATFLAG_NONAME)
                .map_err(native_error)?;
            if stat.cbSize == 0 || stat.cbSize > 64 * 1024 {
                return Err(invalid());
            }
            stream
                .Seek(0, STREAM_SEEK_SET, None)
                .map_err(native_error)?;
            let mut bytes = vec![0; stat.cbSize as usize];
            let mut read = 0;
            stream
                .Read(
                    bytes.as_mut_ptr().cast(),
                    bytes.len() as u32,
                    Some(&mut read),
                )
                .ok()
                .map_err(native_error)?;
            if read as usize != bytes.len() {
                return Err(invalid());
            }
            Ok(bytes)
        }
    }
}
impl Shell for NoticeShortcut<'_> {
    fn create_owned(&mut self) -> io::Result<()> {
        let shortcut = unsafe { location()? };
        let _ancestors = protect_ancestors(&[self.folder, shortcut.parent().ok_or_else(invalid)?])?;
        let executable = wide(std::env::current_exe()?);
        let (_receipt_handle, receipt) = match self.receipt() {
            Ok((held, receipt)) => {
                if receipt.executable != executable
                    || receipt.shortcut != shortcut
                    || receipt.bytes.is_empty()
                {
                    return Err(invalid());
                }
                (held, receipt)
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                // An unsigned legacy shortcut or a foreign file is never replaced.
                match std::fs::symlink_metadata(&shortcut) {
                    Ok(_) => return Err(invalid()),
                    Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                    Err(error) => return Err(error),
                }
                let receipt = Receipt {
                    executable: executable.clone(),
                    shortcut: shortcut.clone(),
                    bytes: self.generated()?,
                };
                let bytes = serde_json::to_vec(&receipt).map_err(native_error)?;
                let mut file = OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .share_mode(0)
                    .access_mode(GENERIC_READ.0 | GENERIC_WRITE.0 | DELETE.0)
                    .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0)
                    .open(self.receipt_path())?;
                regular(&file)?;
                if let Err(error) = file.write_all(&bytes).and_then(|_| file.sync_all()) {
                    let _ = delete_handle(&file);
                    return Err(error);
                }
                (file, receipt)
            }
            Err(error) => return Err(error),
        };
        match protected(&shortcut, false) {
            Ok(file) => {
                if !owns_bytes(
                    &executable,
                    &receipt.executable,
                    &receipt.bytes,
                    &bounded(&file, 64 * 1024)?,
                    false,
                ) {
                    return Err(invalid());
                }
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                // Denying share access keeps the shell from reading a partly written link.
                let mut file = OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .share_mode(0)
                    .access_mode(GENERIC_READ.0 | GENERIC_WRITE.0 | DELETE.0)
                    .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0)
                    .open(&shortcut)?;
                regular(&file)?;
                if let Err(error) = file.write_all(&receipt.bytes).and_then(|_| file.sync_all()) {
                    let _ = delete_handle(&file);
                    return Err(error);
                }
            }
            Err(error) => return Err(error),
        }
        unsafe { SetCurrentProcessExplicitAppUserModelID(w!("Coco.Companion")) }
            .map_err(native_error)
    }
    fn remove_owned(&mut self) -> io::Result<()> {
        let shortcut = unsafe { location()? };
        let _ancestors = protect_ancestors(&[self.folder, shortcut.parent().ok_or_else(invalid)?])?;
        let (receipt_handle, receipt) = match self.receipt() {
            Ok(receipt) => receipt,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(error),
        };
        if receipt.shortcut != shortcut {
            return Ok(());
        }
        let executable = wide(std::env::current_exe()?);
        if receipt.executable != executable || receipt.bytes.is_empty() {
            return Ok(());
        }
        let file = match protected(&shortcut, true) {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return delete_handle(&receipt_handle)
            }
            Err(error) => return Err(error),
        };
        if owns_bytes(
            &executable,
            &receipt.executable,
            &receipt.bytes,
            &bounded(&file, 64 * 1024)?,
            false,
        ) {
            // Delete this checked handle; a path replacement cannot redirect the removal.
            delete_handle(&file)?;
            delete_handle(&receipt_handle)?;
        }
        Ok(())
    }
}
