//! Where `add` gets the key: a terminal or the system's own password dialog, which a person
//! types into. The TTY rule refuses a plain pipe; it is a speed bump, not a lock, because
//! `script(1)` can give a pipe a terminal. The dialog's words come from the plugin through argv.

use std::io::{IsTerminal, Write};
use std::process::Command;

use crate::child;
use crate::hooks;
use crate::out::{Fail, Kind};
use crate::endpoint::Endpoint;
use crate::secret::{Secret, parse_key_for, wipe};

pub struct Words {
    pub title: String,
    pub text: String,
    pub save: String,
    pub cancel: String,
}

/// No sentence of ours: only the key's own prefix as the prompt, on stderr.
const TTY_PROMPT: &str = "sk-ant-…: ";
const LINE_LIMIT: usize = 1024;

/// Checked before anything is counted or read, so a plain pipe touches nothing.
pub fn ensure_terminal() -> Result<(), Fail> {
    if std::io::stdin().is_terminal() { Ok(()) } else { Err(Fail::new(Kind::Other, "stdin-not-a-terminal")) }
}

pub fn from_terminal(ep: &Endpoint) -> Result<Secret, Fail> {
    ensure_terminal()?;
    let raw = read_hidden_line()?;
    let _ = writeln!(std::io::stderr());
    parse_key_for(raw, ep)
}

#[cfg(unix)]
fn read_hidden_line() -> Result<Vec<u8>, Fail> {
    let fd = libc::STDIN_FILENO;
    let mut saved: libc::termios = unsafe { std::mem::zeroed() };
    if unsafe { libc::tcgetattr(fd, &mut saved) } != 0 {
        return Err(Fail::new(Kind::Other, "stdin-not-a-terminal"));
    }
    let mut quiet = saved;
    // ISIG off turns Ctrl-C into a byte we see, so the echo setting is always restored.
    quiet.c_lflag &= !(libc::ECHO | libc::ISIG);
    quiet.c_lflag |= libc::ICANON;
    // If echo cannot be turned off, the key would show as it is typed: refuse instead.
    let mut now_set: libc::termios = unsafe { std::mem::zeroed() };
    let quiet_ok = unsafe { libc::tcsetattr(fd, libc::TCSAFLUSH, &quiet) } == 0
        && unsafe { libc::tcgetattr(fd, &mut now_set) } == 0
        && now_set.c_lflag & libc::ECHO == 0;
    if !quiet_ok {
        unsafe { libc::tcsetattr(fd, libc::TCSANOW, &saved) };
        return Err(Fail::new(Kind::Computer, "terminal-echo"));
    }
    // The prompt follows the flush, so whatever is typed after it is kept.
    let _ = write!(std::io::stderr(), "{TTY_PROMPT}");
    let mut line = Vec::with_capacity(LINE_LIMIT);
    let mut byte = 0u8;
    let result = loop {
        let n = unsafe { libc::read(fd, (&mut byte as *mut u8).cast(), 1) };
        if n <= 0 || byte == 0x03 || byte == 0x04 {
            break Err(Fail::new(Kind::Cancelled, "terminal"));
        }
        if byte == b'\n' || byte == b'\r' {
            break Ok(());
        }
        if line.len() >= LINE_LIMIT {
            break Err(Fail::new(Kind::Format, "not-an-api-key"));
        }
        line.push(byte);
    };
    unsafe { libc::tcsetattr(fd, libc::TCSAFLUSH, &saved) };
    match result {
        Ok(()) => Ok(line),
        Err(f) => {
            wipe(&mut line);
            Err(f)
        }
    }
}

#[cfg(windows)]
fn read_hidden_line() -> Result<Vec<u8>, Fail> {
    use windows_sys::Win32::System::Console::{
        ENABLE_ECHO_INPUT, ENABLE_PROCESSED_INPUT, GetConsoleMode, GetStdHandle, ReadConsoleW, STD_INPUT_HANDLE,
        SetConsoleMode,
    };
    let h = unsafe { GetStdHandle(STD_INPUT_HANDLE) };
    let mut saved = 0;
    if unsafe { GetConsoleMode(h, &mut saved) } == 0 {
        return Err(Fail::new(Kind::Other, "stdin-not-a-terminal"));
    }
    if unsafe { SetConsoleMode(h, saved & !(ENABLE_ECHO_INPUT | ENABLE_PROCESSED_INPUT)) } == 0 {
        return Err(Fail::new(Kind::Computer, "terminal-echo"));
    }
    let _ = write!(std::io::stderr(), "{TTY_PROMPT}");
    let mut line: Vec<u16> = Vec::with_capacity(LINE_LIMIT);
    let mut unit = 0u16;
    let result = loop {
        let mut got = 0u32;
        let ok = unsafe { ReadConsoleW(h, (&mut unit as *mut u16).cast(), 1, &mut got, std::ptr::null()) };
        if ok == 0 || got == 0 || unit == 0x03 || unit == 0x1a {
            break Err(Fail::new(Kind::Cancelled, "terminal"));
        }
        if unit == b'\r' as u16 || unit == b'\n' as u16 {
            break Ok(());
        }
        if line.len() >= LINE_LIMIT {
            break Err(Fail::new(Kind::Format, "not-an-api-key"));
        }
        line.push(unit);
    };
    unsafe { SetConsoleMode(h, saved) };
    let out = result.map(|()| String::from_utf16_lossy(&line).into_bytes());
    for u in line.iter_mut() {
        unsafe { std::ptr::write_volatile(u, 0) };
    }
    out
}

/// Runs a dialog program and takes the key from its stdout.
fn run_dialog<S: AsRef<std::ffi::OsStr>>(program: &str, args: &[S], ep: &Endpoint) -> Result<Secret, Fail> {
    let out = child::run(Command::new(program).args(args), None).map_err(|_| Fail::new(Kind::Computer, "no-dialog"))?;
    if out.status.success() {
        return parse_key_for(out.stdout, ep);
    }
    let mut stdout = out.stdout;
    wipe(&mut stdout);
    let err = out.stderr.to_ascii_lowercase();
    if err.contains("display") {
        Err(Fail::new(Kind::Computer, "no-display"))
    } else if out.status.code() == Some(1) {
        Err(Fail::new(Kind::Cancelled, "dialog"))
    } else {
        Err(Fail::new(Kind::Computer, "dialog-failed"))
    }
}

/// `--name=value` forms, so a word that starts with a dash is never read as an option.
fn zenity_args(w: &Words) -> Vec<String> {
    vec![
        "--entry".into(),
        "--hide-text".into(),
        format!("--title={}", w.title),
        format!("--text={}", w.text),
        format!("--ok-label={}", w.save),
        format!("--cancel-label={}", w.cancel),
    ]
}

/// The dialog's words: the caller's, and where the key will go when that is not api.anthropic.com and the caller's words
/// do not already name the host, so whoever opens the dialog cannot leave the destination out (K2, lane C 10-17).
pub fn shown_text(text: &str, ep: &Endpoint) -> String {
    if ep.is_anthropic() || text.to_ascii_lowercase().contains(&ep.host) { text.to_string() } else { format!("{text}\n\n{}", ep.base()) }
}

pub fn from_dialog(w: &Words, ep: &Endpoint) -> Result<Secret, Fail> {
    let shown = Words { title: w.title.clone(), text: shown_text(&w.text, ep), save: w.save.clone(), cancel: w.cancel.clone() };
    let w = &shown;
    if let Some(p) = hooks::dialog() {
        return run_dialog(&p, &zenity_args(w), ep);
    }
    os_dialog(w, ep)
}

#[cfg(target_os = "macos")]
fn os_dialog(w: &Words, ep: &Endpoint) -> Result<Secret, Fail> {
    // The words arrive as argv items, so nothing of theirs is parsed as AppleScript.
    const SCRIPT: &str = "on run argv\n\
        set r to display dialog (item 2 of argv) with title (item 1 of argv) default answer \"\" with hidden answer \
        buttons {item 4 of argv, item 3 of argv} default button 2 cancel button 1\n\
        return text returned of r\n\
        end run";
    run_dialog("/usr/bin/osascript", &["-e", SCRIPT, w.title.as_str(), w.text.as_str(), w.save.as_str(), w.cancel.as_str()], ep)
}

#[cfg(all(unix, not(target_os = "macos")))]
fn os_dialog(w: &Words, ep: &Endpoint) -> Result<Secret, Fail> {
    for zenity in ["/usr/bin/zenity", "/bin/zenity"] {
        if std::path::Path::new(zenity).is_file() {
            return run_dialog(zenity, &zenity_args(w), ep);
        }
    }
    for kdialog in ["/usr/bin/kdialog", "/bin/kdialog"] {
        if std::path::Path::new(kdialog).is_file() {
            return run_dialog(kdialog, &["--title", w.title.as_str(), "--password", w.text.as_str()], ep);
        }
    }
    Err(Fail::new(Kind::Computer, "no-dialog"))
}

#[cfg(windows)]
fn os_dialog(w: &Words, ep: &Endpoint) -> Result<Secret, Fail> {
    use windows_sys::Win32::Foundation::{ERROR_CANCELLED, ERROR_SUCCESS};
    use windows_sys::Win32::Security::Credentials::{
        CRED_PACK_GENERIC_CREDENTIALS, CREDUI_INFOW, CREDUIWIN_GENERIC, CredUIPromptForWindowsCredentialsW,
        CredUnPackAuthenticationBufferW,
    };
    use windows_sys::Win32::System::Com::CoTaskMemFree;

    let wide = |s: &str| -> Vec<u16> { s.encode_utf16().chain(std::iter::once(0)).collect() };
    let caption = wide(&w.title);
    let message = wide(&w.text);
    let info = CREDUI_INFOW {
        cbSize: std::mem::size_of::<CREDUI_INFOW>() as u32,
        pszCaptionText: caption.as_ptr(),
        pszMessageText: message.as_ptr(),
        ..Default::default()
    };
    let mut package = 0u32;
    let mut buf: *mut core::ffi::c_void = std::ptr::null_mut();
    let mut buf_len = 0u32;
    let rc = unsafe {
        CredUIPromptForWindowsCredentialsW(
            &info,
            0,
            &mut package,
            std::ptr::null(),
            0,
            &mut buf,
            &mut buf_len,
            std::ptr::null_mut(),
            CREDUIWIN_GENERIC,
        )
    };
    if rc == ERROR_CANCELLED {
        return Err(Fail::new(Kind::Cancelled, "dialog"));
    }
    if rc != ERROR_SUCCESS || buf.is_null() {
        return Err(Fail::new(Kind::Computer, format!("dialog-{rc}")));
    }
    let mut user = vec![0u16; 514];
    let mut domain = vec![0u16; 338];
    let mut pass = vec![0u16; 1024];
    let mut pass_len = 0u32;
    // Unverified which flag a CREDUIWIN_GENERIC buffer wants; the generic one first, then none.
    let ok = [CRED_PACK_GENERIC_CREDENTIALS, 0].into_iter().any(|flags| {
        let mut user_len = user.len() as u32;
        let mut domain_len = domain.len() as u32;
        pass_len = pass.len() as u32;
        unsafe {
            CredUnPackAuthenticationBufferW(
                flags,
                buf,
                buf_len,
                user.as_mut_ptr(),
                &mut user_len,
                domain.as_mut_ptr(),
                &mut domain_len,
                pass.as_mut_ptr(),
                &mut pass_len,
            ) != 0
        }
    });
    unsafe {
        let bytes = std::slice::from_raw_parts_mut(buf.cast::<u8>(), buf_len as usize);
        wipe(bytes);
        CoTaskMemFree(buf as *const _);
    }
    let n = pass.iter().position(|u| *u == 0).unwrap_or(pass.len()).min(pass_len as usize);
    let raw = String::from_utf16_lossy(&pass[..n]).into_bytes();
    // The user field too: a person may paste the key there.
    for u in pass.iter_mut().chain(user.iter_mut()).chain(domain.iter_mut()) {
        unsafe { std::ptr::write_volatile(u, 0) };
    }
    if !ok {
        return Err(Fail::new(Kind::Computer, "dialog-unpack"));
    }
    parse_key_for(raw, ep)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_dialog_names_a_destination_that_is_not_anthropic() {
        let anthropic = Endpoint::parse("https://api.anthropic.com").unwrap();
        let gateway = Endpoint::parse("https://Gateway.example.com:8443/anthropic").unwrap();
        assert_eq!(shown_text("Paste your key.", &anthropic), "Paste your key.");
        assert_eq!(shown_text("Paste your key.", &gateway), "Paste your key.\n\nhttps://gateway.example.com:8443/anthropic");
        // the plugin's own words already say where (more.key.dialog.textAt), so nothing is added
        assert_eq!(shown_text("Your key for GATEWAY.example.com", &gateway), "Your key for GATEWAY.example.com");
    }
}
