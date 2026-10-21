#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Platform {
    Windows,
    Linux,
    MacOS,
}
pub fn windows_path(path: &str) -> bool {
    let b = path.as_bytes();
    (b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && matches!(b[2], b'/' | b'\\'))
        || (b.len() >= 2 && matches!(b[0], b'/' | b'\\') && matches!(b[1], b'/' | b'\\'))
}
pub fn join_path(root: &str, parts: &[&str]) -> String {
    let windows = windows_path(root);
    let separator = if windows { '\\' } else { '/' };
    let normalize = |s: &str| {
        if windows {
            s.replace('/', "\\")
        } else {
            s.to_owned()
        }
    };
    let trim = |c: char| c == '/' || windows && c == '\\';
    let base = normalize(root.trim_end_matches(trim));
    let tail: Vec<String> = parts
        .iter()
        .map(|p| normalize(p.trim_matches(trim)))
        .filter(|p| !p.is_empty())
        .collect();
    if tail.is_empty() {
        return normalize(root);
    }
    format!(
        "{}{}{}",
        base,
        if root.is_empty() {
            String::new()
        } else {
            separator.to_string()
        },
        tail.join(&separator.to_string())
    )
}
pub fn same_path(a: &str, b: &str) -> bool {
    let windows = windows_path(a) || windows_path(b);
    let key = |s: &str| {
        let normalized = if windows {
            s.replace('\\', "/").to_lowercase()
        } else {
            s.to_owned()
        };
        let trimmed = normalized.trim_end_matches('/');
        if trimmed.is_empty() {
            "/".to_owned()
        } else {
            trimmed.to_owned()
        }
    };
    key(a) == key(b)
}
pub fn home_path<'a>(home: Option<&'a str>, profile: Option<&'a str>) -> Option<&'a str> {
    home.filter(|v| !v.is_empty())
        .or(profile.filter(|v| !v.is_empty()))
}
pub fn presence_folder(home: &str, macos: bool, state_home: Option<&str>) -> String {
    if macos {
        join_path(
            home,
            &["Library", "Application Support", "Coco-presence"],
        )
    } else {
        let state = state_home
            .filter(|s| s.starts_with('/'))
            .map(str::to_owned)
            .unwrap_or_else(|| join_path(home, &[".local", "state"]));
        join_path(&state, &["coco"])
    }
}
/// The pet's own folder, which `install` creates and `uninstall` moves to the trash: its settings, the mod's feed and
/// its requests. `~/Library/Application Support/Coco` on macOS; `%APPDATA%\Coco` on Windows; `$XDG_CONFIG_HOME/coco-pet`,
/// else `~/.config/coco-pet`, on Linux, since `~/.config/coco` holds the plugin's line library and talk key (his card of
/// 10-18; the plugin's pet-program.ts petDataFolder). `config_home` is `APPDATA` on Windows, `XDG_CONFIG_HOME` on Linux.
pub fn companion_folder(platform: Platform, home: &str, config_home: Option<&str>) -> String {
    match platform {
        Platform::MacOS => join_path(home, &["Library", "Application Support", "Coco"]),
        Platform::Windows => {
            let roaming = config_home
                .filter(|v| windows_path(v))
                .map(str::to_owned)
                .unwrap_or_else(|| join_path(home, &["AppData", "Roaming"]));
            join_path(&roaming, &["Coco"])
        }
        Platform::Linux => {
            let config = config_home
                .filter(|v| v.starts_with('/'))
                .map(str::to_owned)
                .unwrap_or_else(|| join_path(home, &[".config"]));
            join_path(&config, &["coco-pet"])
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PlatformPaths {
    pub companion: String,
    pub feed: String,
    pub requests: String,
    pub presence: String,
    pub snapshot: String,
    pub presence_log: String,
    pub settings: String,
}
impl PlatformPaths {
    pub fn new(
        platform: Platform,
        home: &str,
        state_home: Option<&str>,
        config_home: Option<&str>,
    ) -> Self {
        let companion = companion_folder(platform, home, config_home);
        let base = presence_folder(home, platform == Platform::MacOS, state_home);
        let presence = if platform == Platform::Windows {
            base
        } else {
            join_path(&base, &["native-v2"])
        };
        Self {
            feed: join_path(&companion, &["view.json"]),
            requests: join_path(&companion, &["requests.jsonl"]),
            snapshot: join_path(&presence, &["snapshot.json"]),
            presence_log: join_path(&presence, &["presence.jsonl"]),
            settings: join_path(&companion, &["companion.json"]),
            companion,
            presence,
        }
    }
    pub fn from_environment(platform: Platform) -> Result<Self, &'static str> {
        let home = std::env::var("HOME").ok();
        let profile = std::env::var("USERPROFILE").ok();
        let home = home_path(home.as_deref(), profile.as_deref()).ok_or("home is unavailable")?;
        let state = std::env::var("XDG_STATE_HOME").ok();
        let config = std::env::var(if platform == Platform::Windows {
            "APPDATA"
        } else {
            "XDG_CONFIG_HOME"
        })
        .ok();
        Ok(Self::new(platform, home, state.as_deref(), config.as_deref()))
    }
}

/// Where the pet's pictures are when the folder it was given lacks them: the source tree in a development
/// build, beside the program in a release build, so a shipped program carries no build machine path (the
/// four builds ship in the plugin, lane C 10-16).
pub fn fallback_assets() -> std::path::PathBuf {
    #[cfg(debug_assertions)]
    return std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("assets");
    #[cfg(not(debug_assertions))]
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent()?.parent().map(|p| p.join("assets")))
        .unwrap_or_default()
}
