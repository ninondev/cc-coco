pub mod claudie;
pub mod coco;
pub mod engine;
pub mod feed;
pub mod languages;
#[cfg(unix)]
pub mod instance;
pub mod motion;
pub mod paths;
pub mod platform_words;
pub mod os_metadata;
pub mod platform;
pub mod new_chat;
pub mod presence_helper;
pub mod presence_store;
pub mod preview;
#[cfg(target_os = "macos")]
mod preview_r2;
#[cfg(target_os = "macos")]
pub mod preview_r3;
#[cfg(target_os = "macos")]
mod preview_r4;
#[cfg(target_os = "macos")]
mod preview_r5;
#[cfg(target_os = "macos")]
mod preview_r6;
pub mod protocol;
pub mod quota_pixels;
pub mod reactions;
pub mod setup;
pub mod render;
pub mod shake;
pub mod state;
pub mod stick;

pub type Error = Box<dyn std::error::Error>;

#[derive(Clone, Debug)]
pub struct Options {
    pub folder: std::path::PathBuf,
    pub presence_folder: Option<std::path::PathBuf>,
    pub assets: std::path::PathBuf,
    pub size: render::Size,
    pub reduce_motion: bool,
    pub follow_class: Option<String>,
    pub trace: bool,
    pub login: bool,
}

pub fn epoch_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(feature = "a11y")]
pub mod accessibility;
pub mod contrast;
pub mod decor;
#[cfg(not(target_os = "linux"))]
#[path = "platform/linux_a11y.rs"]
pub mod linux_a11y_model;
#[path = "platform/linux_menu.rs"]
pub mod linux_menu;
#[path = "platform/linux_model.rs"]
pub mod linux_model;
pub mod locale;
pub mod shapes;
pub mod ui;
pub mod vectors;
#[cfg(target_os = "linux")]
pub use platform::linux::a11y_model as linux_a11y_model;

#[cfg(unix)]
pub mod autostart_file;
pub mod windows_notice_shortcut;
