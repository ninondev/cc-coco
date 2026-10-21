//! One hard deadline per command, under the plugin's 30 s kill, so the plugin always hears a
//! kind from us. A watchdog thread answers for the command and exits if it is still running
//! then, wherever it is stuck (a proxy, a TLS peer, secret-tool, a Keychain prompt).

use std::sync::OnceLock;
use std::sync::atomic::{AtomicU8, Ordering};
use std::time::{Duration, Instant};

use crate::hooks;
use crate::out::{self, Fail, Kind};

pub const TOTAL: Duration = Duration::from_secs(25);
/// Sockets are shut this long before the command's deadline, so a stuck read fails as
/// `offline` through the normal path and the watchdog rarely has to speak.
const SOCKET_MARGIN: Duration = Duration::from_secs(1);
/// An explicit stack size, so spawning never consults RUST_MIN_STACK.
pub const STACK: usize = 256 * 1024;

static AT: OnceLock<Instant> = OnceLock::new();
/// 0 until a command enters a phase: still checking its own input.
static PHASE: AtomicU8 = AtomicU8::new(0);

#[derive(Clone, Copy)]
pub enum Phase {
    Store = 1,
    Network = 2,
}

pub fn enter(p: Phase) {
    PHASE.store(p as u8, Ordering::SeqCst);
}

fn total() -> Duration {
    hooks::deadline_ms().and_then(|v| v.parse().ok()).map(Duration::from_millis).unwrap_or(TOTAL)
}

/// Starts the clock for `command`. `add` calls it after the person has typed or pasted the
/// key, because no deadline can be put on a person.
pub fn start(command: &'static str) {
    let at = *AT.get_or_init(|| Instant::now() + total());
    let _ = std::thread::Builder::new().stack_size(STACK).spawn(move || {
        std::thread::sleep(at.saturating_duration_since(Instant::now()));
        let kind = match PHASE.load(Ordering::SeqCst) {
            1 => Kind::Computer,
            2 => Kind::Offline,
            _ => Kind::Other,
        };
        out::print_fail_and_exit(command, &Fail::new(kind, "deadline"));
    });
}

pub fn at() -> Instant {
    *AT.get_or_init(|| Instant::now() + total())
}

/// Fixed the first time it is asked, so it means the same instant before and after it passes.
pub fn for_sockets() -> Instant {
    static SOCKETS: OnceLock<Instant> = OnceLock::new();
    *SOCKETS.get_or_init(|| {
        let at = at();
        at.checked_sub(SOCKET_MARGIN).filter(|s| *s > Instant::now()).unwrap_or(at)
    })
}

/// True once the socket deadline has passed, so a read cut by `guard` reads as a timeout.
pub fn sockets_cut() -> bool {
    Instant::now() >= for_sockets()
}

/// Shuts `sock` down at the socket deadline, which fails any read or write still waiting on it.
pub fn guard(sock: &std::net::TcpStream) {
    let Ok(s) = sock.try_clone() else { return };
    let at = for_sockets();
    let _ = std::thread::Builder::new().stack_size(STACK).spawn(move || {
        std::thread::sleep(at.saturating_duration_since(Instant::now()));
        let _ = s.shutdown(std::net::Shutdown::Both);
    });
}
