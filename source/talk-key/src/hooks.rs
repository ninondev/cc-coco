//! Test seams. Without the `test-hooks` feature each one is `None` and its variable's name is
//! not even in the binary, so a release build reads none of them and cannot move the host.

macro_rules! seam {
    ($(#[$doc:meta])* $name:ident, $var:literal) => {
        $(#[$doc])*
        #[cfg(feature = "test-hooks")]
        pub fn $name() -> Option<String> {
            std::env::var($var).ok().filter(|v| !v.is_empty())
        }
        #[cfg(not(feature = "test-hooks"))]
        pub fn $name() -> Option<String> {
            None
        }
    };
}

seam!(
    /// Socket address to dial instead of api.anthropic.com:443. SNI and Host stay api.anthropic.com.
    endpoint, "TALK_KEY_TEST_ENDPOINT"
);
seam!(
    /// PEM file that replaces the system trust roots.
    ca_file, "TALK_KEY_TEST_CA"
);
seam!(
    /// Directory used in place of the account's home directory.
    home, "TALK_KEY_TEST_HOME"
);
seam!(
    /// Path of a stand-in password dialog program.
    dialog, "TALK_KEY_TEST_DIALOG"
);
seam!(
    /// Unix seconds used as "now" by the send limits.
    now_text, "TALK_KEY_TEST_NOW"
);
seam!(
    /// Milliseconds for the command deadline in place of 25 s.
    deadline_ms, "TALK_KEY_TEST_DEADLINE_MS"
);

/// Path of a stand-in secret-tool, or "none" to act as if it is not installed.
#[cfg(all(unix, not(target_os = "macos")))]
pub fn secret_tool() -> Option<String> {
    #[cfg(feature = "test-hooks")]
    return std::env::var("TALK_KEY_TEST_SECRET_TOOL").ok().filter(|v| !v.is_empty());
    #[cfg(not(feature = "test-hooks"))]
    None
}

pub fn now() -> Option<i64> {
    now_text().and_then(|v| v.parse().ok())
}
