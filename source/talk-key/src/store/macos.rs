//! macOS: a generic password in the login keychain. SecKeychainAddGenericPassword with no
//! initial access gives the item an access list whose only trusted application is the caller,
//! so other programs get a Keychain prompt. Never compiled in the cloud (MAC-QUEUE).

use security_framework::base::Error;
use security_framework::os::macos::keychain::SecKeychain;
use security_framework::passwords::delete_generic_password;

use super::{missing, stored};
use crate::out::{Fail, Kind};
use crate::secret::Secret;

const SERVICE: &str = "coco talk-key";
const ACCOUNT: &str = "talk-key";

const ITEM_NOT_FOUND: i32 = -25300;
const USER_CANCELED: i32 = -128;
const AUTH_FAILED: i32 = -25293;
const INTERACTION_NOT_ALLOWED: i32 = -25308;

fn map(e: Error) -> Fail {
    match e.code() {
        ITEM_NOT_FOUND => missing(),
        USER_CANCELED | AUTH_FAILED => Fail::new(Kind::Computer, "keychain-denied"),
        INTERACTION_NOT_ALLOWED => Fail::new(Kind::Computer, "keychain-locked"),
        c => Fail::new(Kind::Computer, format!("keychain-{c}")),
    }
}

/// Deletes through SecItemDelete, which returns its status (SecKeychainItemDelete's is lost
/// in security-framework), and reads nothing to do it. A missing item is not an error.
fn delete() -> Result<(), Fail> {
    match delete_generic_password(SERVICE, ACCOUNT) {
        Ok(()) => Ok(()),
        Err(e) if e.code() == ITEM_NOT_FOUND => Ok(()),
        Err(e) => Err(map(e)),
    }
}

pub fn save(key: &Secret) -> Result<&'static str, Fail> {
    let kc = SecKeychain::default().map_err(map)?;
    // Delete and add, rather than modify, so the item always gets a fresh access list.
    delete()?;
    kc.add_generic_password(SERVICE, ACCOUNT, key.as_bytes()).map_err(map)?;
    Ok("keychain")
}

pub fn load() -> Result<(Secret, &'static str), Fail> {
    let kc = SecKeychain::default().map_err(map)?;
    let (pw, _) = kc.find_generic_password(SERVICE, ACCOUNT).map_err(map)?;
    let bytes = pw.to_vec();
    // The framework's buffer is freed when `pw` drops; zero it first.
    unsafe {
        let p = pw.as_ptr() as *mut u8;
        for i in 0..pw.len() {
            std::ptr::write_volatile(p.add(i), 0);
        }
    }
    drop(pw);
    Ok((stored(bytes)?, "keychain"))
}

pub fn remove() -> Result<(), Fail> {
    delete()
}
