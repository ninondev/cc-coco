//! New chat from the pet's Activity window (lane C, 10-16; his rule): Claude Code opens a new conversation in
//! whichever of its three faces this computer has. Only the terminal version: a terminal opens with Claude Code in
//! the chosen session's folder. Only the Claude app: its new session page. Only the VS Code extension: a new Claude
//! Code tab. More than one: the pet asks which. None: there is no New chat button.
//!
//! Each opens through the link its own maker documents (code.claude.com/docs: deep-links, vs-code, desktop):
//! `claude-cli://open?cwd=`, `vscode://anthropic.claude-code/open`, `claude://code/new`. Finding them reads only
//! what the system says handles those links (and, for VS Code, whether the extension's folder is there), when the
//! Activity opens; it runs no program, and nothing opens until the person presses the button.

/// `detect`, remembered for 30 seconds: the right-click menu asks each time it is built, and nothing asks on a timer.
pub fn detect_cached() -> Vec<Client> {
    use std::sync::Mutex;
    use std::time::{Duration, Instant};
    static CACHE: Mutex<Option<(Instant, Vec<Client>)>> = Mutex::new(None);
    let mut cache = CACHE.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some((at, found)) = cache.as_ref() {
        if at.elapsed() < Duration::from_secs(30) {
            return found.clone();
        }
    }
    let found = detect();
    *cache = Some((Instant::now(), found.clone()));
    found
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Client {
    Terminal,
    Desktop,
    VsCode,
}
impl Client {
    pub const ALL: [Client; 3] = [Client::Terminal, Client::Desktop, Client::VsCode];
    /// The link scheme the system must know.
    pub fn scheme(self) -> &'static str {
        match self {
            Client::Terminal => "claude-cli",
            Client::Desktop => "claude",
            Client::VsCode => "vscode",
        }
    }
    /// The feed word that names it in the chooser.
    pub fn word(self) -> &'static str {
        match self {
            Client::Terminal => "newChatTerminal",
            Client::Desktop => "newChatDesktop",
            Client::VsCode => "newChatVSCode",
        }
    }
    /// The link that opens a new conversation. The terminal one starts in `folder` when it is a plain local path,
    /// in the home folder otherwise (the CLI refuses network paths, `..` and hidden or direction characters).
    pub fn link(self, folder: Option<&str>) -> String {
        match self {
            Client::Terminal => match folder.filter(|folder| local_folder(folder)) {
                Some(folder) => format!("claude-cli://open?cwd={}", encode(folder)),
                None => "claude-cli://open".into(),
            },
            Client::Desktop => "claude://code/new".into(),
            Client::VsCode => "vscode://anthropic.claude-code/open".into(),
        }
    }
}

fn hidden(c: char) -> bool {
    c.is_control()
        || matches!(c, '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2060}'..='\u{2064}'
            | '\u{2066}'..='\u{2069}' | '\u{FEFF}')
}
/// An absolute folder on this computer: `/...` or `X:\...`, no network path, no `..` segment, nothing hidden.
pub fn local_folder(folder: &str) -> bool {
    let bytes = folder.as_bytes();
    let posix = folder.starts_with('/') && !folder.starts_with("//");
    let drive = bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && matches!(bytes[2], b'\\' | b'/');
    (posix || drive)
        && folder.len() <= 4096
        && !folder.split(['/', '\\']).any(|part| part == "..")
        && !folder.chars().any(hidden)
}
/// encodeURIComponent: everything but letters, digits and `-_.!~*'()` as UTF-8 percent escapes.
pub fn encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len() * 3);
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}
/// The VS Code extension is there: a folder `anthropic.claude-code-<version>` under the extensions folder.
pub fn has_extension(extensions: &std::path::Path) -> bool {
    std::fs::read_dir(extensions).is_ok_and(|entries| {
        entries.flatten().any(|entry| {
            entry.file_name().to_str().is_some_and(|name| name.starts_with("anthropic.claude-code-"))
                && entry.file_type().is_ok_and(|kind| kind.is_dir())
        })
    })
}

/// The ones this computer has, in a fixed order. `handles` says whether the system knows a link scheme.
pub fn available(handles: impl Fn(&str) -> bool, extension: bool) -> Vec<Client> {
    Client::ALL
        .into_iter()
        .filter(|client| handles(client.scheme()) && (*client != Client::VsCode || extension))
        .collect()
}

#[cfg(windows)]
pub fn detect() -> Vec<Client> {
    use windows::{
        core::{HSTRING, PWSTR},
        Win32::UI::Shell::{AssocQueryStringW, ASSOCF_INIT_IGNOREUNKNOWN, ASSOCF_IS_PROTOCOL, ASSOCSTR_COMMAND},
    };
    let handles = |scheme: &str| {
        let mut buffer = [0u16; 1024];
        let mut length = buffer.len() as u32;
        unsafe {
            AssocQueryStringW(
                ASSOCF_IS_PROTOCOL | ASSOCF_INIT_IGNOREUNKNOWN,
                ASSOCSTR_COMMAND,
                &HSTRING::from(scheme),
                &HSTRING::from("open"),
                PWSTR(buffer.as_mut_ptr()),
                &mut length,
            )
            .is_ok()
        }
    };
    let extension = std::env::var_os("USERPROFILE")
        .map(|profile| std::path::Path::new(&profile).join(".vscode").join("extensions"))
        .is_some_and(|folder| has_extension(&folder));
    available(handles, extension)
}

#[cfg(windows)]
pub fn open(client: Client, folder: Option<&str>) -> Result<(), crate::Error> {
    use windows::{
        core::{w, HSTRING, PCWSTR},
        Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL},
    };
    let link = HSTRING::from(client.link(folder));
    let result = unsafe { ShellExecuteW(None, w!("open"), &link, PCWSTR::null(), PCWSTR::null(), SW_SHOWNORMAL) };
    // ShellExecute reports success as a value above 32.
    if result.0 as usize <= 32 {
        return Err(format!("new chat: the link did not open ({})", result.0 as usize).into());
    }
    Ok(())
}

/// Links open through xdg-open (xdg-utils, on every desktop); without it nothing is offered.
#[cfg(target_os = "linux")]
const XDG_OPEN: &str = "/usr/bin/xdg-open";

/// Linux, without running anything: the terminal version's own handler file (deep-links docs), the VS Code
/// extension's folder, and for the Claude app a desktop entry the system lists for `claude:` links.
#[cfg(target_os = "linux")]
pub fn detect() -> Vec<Client> {
    use std::path::{Path, PathBuf};
    if !Path::new(XDG_OPEN).is_file() {
        return vec![];
    }
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let data = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .or_else(|| home.as_ref().map(|home| home.join(".local/share")));
    let terminal = data
        .as_ref()
        .is_some_and(|data| data.join("applications/claude-code-url-handler.desktop").is_file());
    let desktop = data
        .iter()
        .map(|data| data.join("applications/mimeinfo.cache"))
        .chain([PathBuf::from("/usr/share/applications/mimeinfo.cache")])
        .any(|cache| lists_scheme(&cache, "claude"));
    let extension = home
        .as_ref()
        .is_some_and(|home| has_extension(&home.join(".vscode/extensions")));
    available(
        |scheme| match scheme {
            "claude-cli" => terminal,
            "claude" => desktop,
            _ => true,
        },
        extension,
    )
}
/// Whether a desktop database names a program for `<scheme>:` links (`x-scheme-handler/<scheme>=one.desktop;`).
pub fn lists_scheme(cache: &std::path::Path, scheme: &str) -> bool {
    let wanted = format!("x-scheme-handler/{scheme}=");
    std::fs::read(cache).is_ok_and(|bytes| {
        bytes.len() <= 4 << 20
            && String::from_utf8_lossy(&bytes).lines().any(|line| {
                line.strip_prefix(&wanted).is_some_and(|programs| !programs.trim().trim_matches(';').is_empty())
            })
    })
}

#[cfg(target_os = "linux")]
pub fn open(client: Client, folder: Option<&str>) -> Result<(), crate::Error> {
    use std::os::unix::process::CommandExt;
    use std::process::{Command, Stdio};
    // Its own session, so the opened program never belongs to the pet.
    let mut command = Command::new(XDG_OPEN);
    command
        .arg(client.link(folder))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    unsafe {
        command.pre_exec(|| {
            libc::setsid();
            Ok(())
        });
    }
    command.spawn()?;
    Ok(())
}

#[cfg(not(any(windows, target_os = "linux")))]
pub fn detect() -> Vec<Client> {
    Vec::new()
}
#[cfg(not(any(windows, target_os = "linux")))]
pub fn open(_client: Client, _folder: Option<&str>) -> Result<(), crate::Error> {
    Err("new chat: the Mac pet opens these itself".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_face_opens_through_its_own_documented_link() {
        assert_eq!(Client::Desktop.link(Some("/home/pat/shop")), "claude://code/new");
        assert_eq!(Client::VsCode.link(None), "vscode://anthropic.claude-code/open");
        assert_eq!(
            Client::Terminal.link(Some("/home/pat/my shop")),
            "claude-cli://open?cwd=%2Fhome%2Fpat%2Fmy%20shop"
        );
        assert_eq!(
            Client::Terminal.link(Some(r"C:\Users\pat\小克")),
            "claude-cli://open?cwd=C%3A%5CUsers%5Cpat%5C%E5%B0%8F%E5%85%8B"
        );
        // Anything the CLI would refuse starts in the home folder instead.
        for folder in [r"\\server\share\x", "//server/x", "relative/x", "/home/pat/../root", "/home/\u{202E}x", ""] {
            assert_eq!(Client::Terminal.link(Some(folder)), "claude-cli://open", "{folder:?}");
        }
        assert_eq!(Client::Terminal.link(None), "claude-cli://open");
    }

    #[test]
    fn only_the_faces_this_computer_has_are_offered_in_a_fixed_order() {
        let all = |_: &str| true;
        assert_eq!(available(all, true), vec![Client::Terminal, Client::Desktop, Client::VsCode]);
        // VS Code without the extension is not Claude Code.
        assert_eq!(available(all, false), vec![Client::Terminal, Client::Desktop]);
        assert_eq!(available(|scheme| scheme == "claude-cli", true), vec![Client::Terminal]);
        assert_eq!(available(|scheme| scheme == "claude", true), vec![Client::Desktop]);
        assert_eq!(available(|scheme| scheme == "vscode", true), vec![Client::VsCode]);
        assert_eq!(available(|_| false, true), vec![]);
    }

    #[test]
    fn a_desktop_database_lists_the_claude_app_only_by_its_own_scheme() {
        let root = std::env::temp_dir().join(format!("coco-new-chat-cache-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let cache = root.join("mimeinfo.cache");
        std::fs::write(&cache, "[MIME Cache]\nx-scheme-handler/claude-cli=claude-code-url-handler.desktop;\nx-scheme-handler/vscode=code-url-handler.desktop;\n").unwrap();
        assert!(!lists_scheme(&cache, "claude"));
        assert!(lists_scheme(&cache, "claude-cli"));
        std::fs::write(&cache, "[MIME Cache]\nx-scheme-handler/claude=;\n").unwrap();
        assert!(!lists_scheme(&cache, "claude"));
        std::fs::write(&cache, "[MIME Cache]\nx-scheme-handler/claude=claude-desktop.desktop;\n").unwrap();
        assert!(lists_scheme(&cache, "claude"));
        assert!(!lists_scheme(&root.join("missing"), "claude"));
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn the_extension_is_its_own_versioned_folder() {
        let root = std::env::temp_dir().join(format!("coco-new-chat-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("ms-python.python-2026.1.0")).unwrap();
        assert!(!has_extension(&root));
        std::fs::write(root.join("anthropic.claude-code-2.1.0"), b"not a folder").unwrap();
        assert!(!has_extension(&root));
        std::fs::create_dir_all(root.join("anthropic.claude-code-2.1.289-linux-x64")).unwrap();
        assert!(has_extension(&root));
        assert!(!has_extension(&root.join("missing")));
        std::fs::remove_dir_all(&root).unwrap();
    }
}
