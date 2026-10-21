//! The key's one home per OS. `save` and `load` also say which store answered, so the
//! settings row can name where the key is kept.

#[cfg(all(unix, not(target_os = "macos")))]
mod linux;
#[cfg(all(unix, not(target_os = "macos")))]
pub use linux::{load, remove, save};

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::{load, remove, save};

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::{load, remove, save};

use crate::out::{Fail, Kind};
use crate::secret::Secret;

/// A stored value that is not a record any more (edited by hand, or another program's item) is refused
/// here; the record itself is read by endpoint::Record::decode.
pub(crate) fn stored(bytes: Vec<u8>) -> Result<Secret, Fail> {
    let value = Secret::from_vec(bytes);
    crate::endpoint::Record::decode(&value).map(|_| value)
}

pub(crate) fn missing() -> Fail {
    Fail::new(Kind::Computer, "missing")
}
