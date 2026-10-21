//! Windows: a generic credential in Credential Manager, persisted for this machine.
//! Checked in the cloud under Wine (the test below, tools/tests/talk-key-wine.test.py); on Windows itself, MAC-QUEUE.

use windows_sys::Win32::Foundation::{ERROR_NOT_FOUND, GetLastError};
use windows_sys::Win32::Security::Credentials::{
    CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC, CREDENTIALW, CredDeleteW, CredFree, CredReadW, CredWriteW,
};

use super::{missing, stored};
use crate::out::{Fail, Kind};
use crate::secret::{Secret, wipe};

const TARGET: &str = "coco/talk-key";
const USER: &str = "talk-key";

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn last_error(op: &str) -> Fail {
    let code = unsafe { GetLastError() };
    if code == ERROR_NOT_FOUND { missing() } else { Fail::new(Kind::Computer, format!("credential-{op}-{code}")) }
}

pub fn save(key: &Secret) -> Result<&'static str, Fail> {
    save_as(TARGET, key)
}

pub fn load() -> Result<(Secret, &'static str), Fail> {
    load_from(TARGET)
}

pub fn remove() -> Result<(), Fail> {
    remove_from(TARGET)
}

fn save_as(name: &str, key: &Secret) -> Result<&'static str, Fail> {
    let mut target = wide(name);
    let mut user = wide(USER);
    let mut blob = key.as_bytes().to_vec();
    let cred = CREDENTIALW {
        Type: CRED_TYPE_GENERIC,
        TargetName: target.as_mut_ptr(),
        CredentialBlobSize: blob.len() as u32,
        CredentialBlob: blob.as_mut_ptr(),
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        UserName: user.as_mut_ptr(),
        ..Default::default()
    };
    let ok = unsafe { CredWriteW(&cred, 0) } != 0;
    let fail = if ok { None } else { Some(last_error("write")) };
    wipe(&mut blob);
    match fail {
        None => Ok("credential-manager"),
        Some(f) => Err(f),
    }
}

fn load_from(name: &str) -> Result<(Secret, &'static str), Fail> {
    let target = wide(name);
    let mut p: *mut CREDENTIALW = std::ptr::null_mut();
    if unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut p) } == 0 || p.is_null() {
        return Err(last_error("read"));
    }
    let bytes = unsafe {
        let c = &*p;
        let v = std::slice::from_raw_parts(c.CredentialBlob, c.CredentialBlobSize as usize).to_vec();
        wipe(std::slice::from_raw_parts_mut(c.CredentialBlob, c.CredentialBlobSize as usize));
        CredFree(p as *const _);
        v
    };
    Ok((stored(bytes)?, "credential-manager"))
}

fn remove_from(name: &str) -> Result<(), Fail> {
    let target = wide(name);
    if unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) } == 0 {
        let f = last_error("delete");
        if f.detail != "missing" {
            return Err(f);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::endpoint::{Endpoint, Record};

    // Each test its own credential name: a run on a real Windows account never touches a saved key, and the
    // tests, which run at once, never touch each other's.

    const ROUND_TRIP: &str = "coco/talk-key-test-round-trip";
    const NOT_A_KEY: &str = "coco/talk-key-test-not-a-key";

    #[test]
    fn a_record_goes_in_comes_back_the_same_and_goes_away() {
        let _ = remove_from(ROUND_TRIP);
        assert_eq!(load_from(ROUND_TRIP).err().map(|f| f.detail), Some("missing".to_string()));
        let ep = Endpoint::parse(crate::endpoint::DEFAULT_BASE).unwrap();
        let key = crate::secret::parse_key_for(b"sk-ant-api03-WINEcredentialabcdefghijklmnx7Qa".to_vec(), &ep).unwrap();
        let rec = Record { key, endpoint: ep, model: crate::endpoint::DEFAULT_MODEL.into() };
        assert_eq!(save_as(ROUND_TRIP, &rec.encode()).unwrap(), "credential-manager");
        let (back, place) = load_from(ROUND_TRIP).unwrap();
        assert_eq!(place, "credential-manager");
        let back = Record::decode(&back).unwrap();
        assert_eq!((back.key.as_str(), back.model.as_str()), (rec.key.as_str(), rec.model.as_str()));
        assert_eq!(back.endpoint, rec.endpoint);
        // A second save replaces the first.
        let other = Record { key: crate::secret::parse_key_for(b"sk-ant-api03-WINEsecondkeyabcdefghijklmnopqZ9z".to_vec(), &rec.endpoint).unwrap(), endpoint: rec.endpoint.clone(), model: rec.model.clone() };
        save_as(ROUND_TRIP, &other.encode()).unwrap();
        assert_eq!(Record::decode(&load_from(ROUND_TRIP).unwrap().0).unwrap().key.last4(), "qZ9z");
        remove_from(ROUND_TRIP).unwrap();
        assert_eq!(load_from(ROUND_TRIP).err().map(|f| f.detail), Some("missing".to_string()));
        // Removing what is not there is not a failure.
        remove_from(ROUND_TRIP).unwrap();
    }

    #[test]
    fn something_else_under_the_name_is_refused() {
        let _ = remove_from(NOT_A_KEY);
        save_as(NOT_A_KEY, &Secret::from_vec(b"not a key at all".to_vec())).unwrap();
        assert_eq!(load_from(NOT_A_KEY).err().map(|f| f.detail), Some("stored-value-not-a-key".to_string()));
        remove_from(NOT_A_KEY).unwrap();
    }
}
