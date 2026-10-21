//! The seam and release-path suites need Linux: a pty, a stand-in secret-tool and `unshare -m`.
//! Elsewhere this one test says so, and the macOS and Windows checks are in handoffs/cloud/MAC-QUEUE.md.
#![cfg(not(target_os = "linux"))]

#[test]
fn the_linux_suites_are_skipped_here() {
    eprintln!("SKIPPED with_hooks and release_path: they need Linux (pty, stand-in secret-tool, unshare -m); see MAC-QUEUE.md");
}
