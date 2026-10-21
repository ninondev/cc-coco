//! Checks on a build without the test seams: `cargo test`, and again on the release binary with
//! TALK_KEY_BIN set (tools/tests/talk-key.test.py does both). Cases that reach the counter run
//! under `unshare -m` with a tmpfs over the home, so the account's real home is never written.
#![cfg(all(not(feature = "test-hooks"), target_os = "linux"))]

mod common;

use std::sync::atomic::Ordering;

use common::*;

/// SSL_CERT_FILE and SSL_CERT_DIR name a test CA, the test seams name a local server and home,
/// and HTTPS_PROXY names a proxy that answers CONNECT and then presents a certificate for
/// api.anthropic.com from that CA. The program must still dial api.anthropic.com through the
/// proxy, refuse the certificate, and send nothing the proxy can read.
#[test]
fn ssl_cert_file_and_the_seams_have_no_say() {
    if !needs_namespaces("ssl_cert_file_and_the_seams_have_no_say") {
        return;
    }
    let dir = scratch("release-tls");
    let ca = ca();
    let ca_file = dir.join("ca.pem");
    std::fs::write(&ca_file, &ca.pem).unwrap();
    let ca_dir = dir.join("certs");
    std::fs::create_dir_all(&ca_dir).unwrap();
    std::fs::write(ca_dir.join("ca.pem"), &ca.pem).unwrap();
    let seam_home = dir.join("seam-home");
    std::fs::create_dir_all(&seam_home).unwrap();

    let server = serve(ca.server.clone(), reply("must not be reached"), false);
    let proxy = serve(ca.server.clone(), reply("must not be decrypted"), true);
    let key = canary();
    let env = vec![
        ("SSL_CERT_FILE", ca_file.display().to_string()),
        ("SSL_CERT_DIR", ca_dir.display().to_string()),
        ("HTTPS_PROXY", proxy.proxy_url()),
        ("TALK_KEY_TEST_ENDPOINT", server.endpoint()),
        ("TALK_KEY_TEST_CA", ca_file.display().to_string()),
        ("TALK_KEY_TEST_HOME", seam_home.display().to_string()),
        ("TALK_KEY_TEST_SECRET_TOOL", "none".to_string()),
    ];
    let r = run_tty_with(&["add"], &env, &key, true, &mut |_| {});
    assert_eq!(r.json["kind"], "offline", "{} {}", r.stdout, r.stderr);
    assert!(r.json["detail"].as_str().unwrap_or("").starts_with("tls-"), "{}", r.stdout);
    assert!(!r.stdout.contains(&key) && !r.stderr.contains(&key) && !contains(&r.terminal, &key));

    assert_eq!(proxy.connects.lock().unwrap().clone(), vec!["api.anthropic.com:443".to_string()]);
    assert_eq!(proxy.handshakes.load(Ordering::SeqCst), 0, "the proxy decrypted something");
    assert!(proxy.seen().is_empty());
    assert!(!contains(&proxy.wire.lock().unwrap(), &key));
    assert_eq!(server.connections.load(Ordering::SeqCst), 0, "the endpoint seam moved the socket");
    assert_eq!(std::fs::read_dir(&seam_home).unwrap().count(), 0, "the home seam was used");
}

#[test]
fn add_refuses_a_piped_stdin() {
    let key = canary();
    let r = run(&["add"], &[], Some(format!("{key}\n").as_bytes()));
    assert_eq!((r.json["kind"].as_str(), r.json["detail"].as_str()), (Some("other"), Some("stdin-not-a-terminal")));
    assert!(!r.stdout.contains(&key) && !r.stderr.contains(&key));
}

/// Only refusals that come before the counter: naming another model or host is refused after the
/// record is read (with_hooks.rs, the binding test), which this suite never reaches.
#[test]
fn send_refuses_a_base_url_a_size_or_a_field() {
    let m = serde_json::json!([{"role": "user", "content": "hi"}]);
    for (input, want) in [
        (serde_json::json!({"messages": m, "max_tokens": 200, "base_url": "https://evil.example"}), "input:field:base_url"),
        (serde_json::json!({"messages": m, "max_tokens": 200, "endpoint": "https://evil.example"}), "input:field:endpoint"),
        (serde_json::json!({"messages": m, "max_tokens": 200, "model": 7}), "input:model"),
        (serde_json::json!({"messages": m, "max_tokens": 64_001}), "input:max_tokens"),
        (serde_json::json!({"messages": m, "kind": "compact"}), "input:max_tokens"),
    ] {
        let r = run(&["send"], &[], Some(input.to_string().as_bytes()));
        assert_eq!(r.json["detail"], want);
    }
    let big = "a".repeat(120_000);
    let r = run(&["send"], &[], Some(&send_input(&big)));
    assert_eq!(r.json["kind"], "cap");
}

/// The seams' names, the CA variables, the other proxy variables and the engine's key variable
/// are nowhere in the binary, so no code path can read them.
#[test]
fn the_binary_names_no_other_variable() {
    let bytes = std::fs::read(bin()).unwrap();
    for name in [
        "TALK_KEY_TEST", "SSL_CERT_FILE", "SSL_CERT_DIR", "ANTHROPIC_API_KEY", "ALL_PROXY", "all_proxy", "HTTP_PROXY",
        "http_proxy", "SSLKEYLOGFILE",
    ] {
        assert!(!contains(&bytes, name), "{name} is in the binary");
    }
    for name in ["HTTPS_PROXY", "https_proxy", "NO_PROXY", "no_proxy", "api.anthropic.com", "claude-haiku-5-5"] {
        assert!(contains(&bytes, name), "{name} is missing");
    }
}

/// A closed stdout is ignored, not a panic: under `panic = "abort"` that was SIGABRT and a core.
#[test]
fn a_closed_stdout_is_not_an_abort() {
    use std::os::fd::{FromRawFd, OwnedFd};
    use std::os::unix::process::ExitStatusExt;
    let mut fds = [0; 2];
    assert_eq!(unsafe { libc::pipe(fds.as_mut_ptr()) }, 0);
    let write_end = unsafe { OwnedFd::from_raw_fd(fds[1]) };
    unsafe { libc::close(fds[0]) };
    let status = std::process::Command::new(bin())
        .arg("send")
        .env_clear()
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::from(write_end))
        .stderr(std::process::Stdio::null())
        .status()
        .unwrap();
    assert_eq!((status.signal(), status.code()), (None, Some(1)));
}

/// While the key could be in memory, the program runs with a core limit of zero.
#[test]
fn no_core_file_while_the_key_is_in_memory() {
    if !needs_namespaces("no_core_file_while_the_key_is_in_memory") {
        return;
    }
    // Give the child a non-zero limit to inherit, so a zero in it is the program's own doing.
    let mut lim = libc::rlimit { rlim_cur: 0, rlim_max: 0 };
    unsafe { libc::getrlimit(libc::RLIMIT_CORE, &mut lim) };
    let raised = libc::rlimit { rlim_cur: 1 << 20, rlim_max: lim.rlim_max.max(1 << 20) };
    if unsafe { libc::setrlimit(libc::RLIMIT_CORE, &raised) } != 0 {
        lim.rlim_cur = lim.rlim_max;
        unsafe { libc::setrlimit(libc::RLIMIT_CORE, &lim) };
    }
    unsafe { libc::getrlimit(libc::RLIMIT_CORE, &mut lim) };
    assert!(lim.rlim_cur > 0, "cannot give the child a core limit to drop");
    let mut limits = String::new();
    let r = run_tty_with(&["add"], &[], "hello", true, &mut |pid| {
        limits = std::fs::read_to_string(format!("/proc/{pid}/limits")).unwrap_or_default();
    });
    assert_eq!(r.json["kind"], "format", "{}", r.stdout);
    let line = limits.lines().find(|l| l.starts_with("Max core file size")).unwrap_or("");
    assert_eq!(line.split_whitespace().skip(4).take(2).collect::<Vec<_>>(), ["0", "0"], "{line}");
}
