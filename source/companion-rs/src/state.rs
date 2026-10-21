//! Companion-owned lock metadata consumed by the cache keep-warm lock check.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const WTS_SESSION_LOCK: u32 = 7;
pub const WTS_SESSION_UNLOCK: u32 = 8;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AwayState {
    Locked,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Away {
    pub state: Option<AwayState>,
    /// Wall-clock milliseconds since the Unix epoch, matching the hook contract.
    pub since: u64,
}

/// Returns true only for an observed lock-state transition. Other WTS messages and duplicate
/// lock/unlock events neither rewrite companion.json nor refresh the transition timestamp.
pub fn apply_windows_session_message(store: &mut Value, message: u32, now: u64) -> bool {
    let state = match message {
        WTS_SESSION_LOCK => Some(AwayState::Locked),
        WTS_SESSION_UNLOCK => None,
        _ => return false,
    };
    let Some(object) = store.as_object_mut() else {
        return false;
    };
    if object
        .get("away")
        .and_then(|v| serde_json::from_value::<Away>(v.clone()).ok())
        .is_some_and(|away| away.state == state)
    {
        return false;
    }
    object.insert("away".into(), json!(Away { state, since: now }));
    true
}

/// Linux obtains its lock signal directly through logind, rather than retaining another
/// platform's saved signal. Also clears a Windows process's inherited signal before observing WTS.
pub fn omit_away(store: &mut Value) -> bool {
    store
        .as_object_mut()
        .is_some_and(|object| object.remove("away").is_some())
}
