//! Runs a helper (secret-tool, a password dialog) whose stdout may hold the key. Stdout goes into
//! one buffer allocated once, so no reallocation leaves copies of the key in freed memory.

use std::io::{Read, Write};
use std::process::{Command, ExitStatus, Stdio};

use crate::secret::wipe;

/// Far above any key; whatever is past it is read and dropped so the helper is never blocked.
const STDOUT_CAP: usize = 4096;

pub struct Output {
    pub status: ExitStatus,
    pub stdout: Vec<u8>,
    pub stderr: String,
}

pub fn run(cmd: &mut Command, input: Option<&[u8]>) -> std::io::Result<Output> {
    let mut child = cmd
        .stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    if let (Some(data), Some(mut stdin)) = (input, child.stdin.take()) {
        let written = stdin.write_all(data);
        drop(stdin);
        if let Err(e) = written {
            let _ = child.kill();
            let _ = child.wait();
            return Err(e);
        }
    }
    let mut err_pipe = child.stderr.take().expect("stderr is piped");
    let err_reader = std::thread::Builder::new().stack_size(crate::deadline::STACK).spawn(move || {
        let mut text = Vec::new();
        let _ = err_pipe.read_to_end(&mut text);
        text
    })?;
    let mut out = Vec::with_capacity(STDOUT_CAP);
    let mut chunk = [0u8; 512];
    let mut pipe = child.stdout.take().expect("stdout is piped");
    loop {
        match pipe.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                let room = STDOUT_CAP - out.len();
                out.extend_from_slice(&chunk[..n.min(room)]);
            }
        }
    }
    wipe(&mut chunk);
    let status = child.wait()?;
    let stderr = String::from_utf8_lossy(&err_reader.join().unwrap_or_default()).into_owned();
    Ok(Output { status, stdout: out, stderr })
}
