#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]
#[cfg(any(target_os = "windows", target_os = "linux"))]
use coco_companion::engine::Engine;
use coco_companion::{
    epoch_ms,
    paths::{Platform, PlatformPaths},
    render::Size,
    Error, Options,
};
use std::path::PathBuf;
fn main() {
    if let Err(error) = run() {
        eprintln!("companion: {error}");
        std::process::exit(1);
    }
}
fn run() -> Result<(), Error> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    // The shared presence on Windows (presence_helper.rs): what bin/presence.sh does on macOS and Linux.
    if args.first().map(String::as_str) == Some("presence") {
        std::process::exit(coco_companion::presence_helper::main(&args[1..]) as i32);
    }
    #[cfg(target_os = "windows")]
    let platform = Platform::Windows;
    #[cfg(target_os = "linux")]
    let platform = Platform::Linux;
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    let platform = Platform::MacOS;
    let paths = PlatformPaths::from_environment(platform)?;
    let exe = std::env::current_exe()?;
    let assets = exe
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.join("assets"))
        .filter(|p| p.is_dir())
        .unwrap_or_else(|| coco_companion::paths::fallback_assets().join("../../assets"));
    // What the plugin asks of the program itself (setup.rs): it reads the pictures beside the program it was
    // shipped as, never the build machine's.
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    if let Some(command) = coco_companion::setup::command(&args) {
        let shipped = exe
            .parent()
            .and_then(|p| p.parent())
            .map(|p| p.join("assets"))
            .filter(|p| p.join("coco").is_dir())
            .ok_or("the pictures are not beside the program")?;
        let word = coco_companion::setup::run(
            command,
            std::path::Path::new(&paths.companion),
            &exe,
            &shipped,
        )?;
        println!("{word}");
        return Ok(());
    }
    let mut options = Options {
        folder: paths.companion.into(),
        presence_folder: Some(paths.presence.into()),
        assets,
        size: Size::Large,
        reduce_motion: false,
        follow_class: None,
        trace: false,
        login: false,
    };
    #[cfg(target_os = "windows")]
    let mut uninstall_notice_shortcut = false;
    let mut preview = None;
    let mut preview_e2 = None;
    let mut probe = None;
    let mut seconds = 60;
    let mut seed = (epoch_ms() as u32) ^ std::process::id();
    let mut i = 0;
    while i < args.len() {
        let a = &args[i];
        match a.as_str() {
            "--folder" | "--presence-folder" | "--assets" | "--frames" | "--size"
            | "--follow-class" | "--preview" | "--preview-e2" | "--probe" | "--seconds"
            | "--seed" => {
                i += 1;
                let value = args.get(i).ok_or("option requires a value")?;
                match a.as_str() {
                    "--folder" => options.folder = value.into(),
                    "--presence-folder" => options.presence_folder = Some(value.into()),
                    "--assets" | "--frames" => options.assets = value.into(),
                    "--size" => {
                        options.size = Size::parse(value).ok_or("unknown companion size")?
                    }
                    "--follow-class" => options.follow_class = Some(value.clone()),
                    "--preview" => preview = Some(PathBuf::from(value)),
                    "--preview-e2" => preview_e2 = Some(PathBuf::from(value)),
                    "--probe" => probe = Some(value.clone()),
                    "--seconds" => seconds = value.parse()?,
                    "--seed" => seed = value.parse()?,
                    _ => {}
                }
            }
            "--reduce-motion" => options.reduce_motion = true,
            "--trace" => options.trace = true,
            "--login" => options.login = true,
            #[cfg(target_os = "windows")]
            "--uninstall-notice-shortcut" => uninstall_notice_shortcut = true,
            "--help" => {
                println!("Coco Pet\n--folder PATH  --presence-folder PATH  --assets PATH\n--size medium|large|larger  --reduce-motion  --trace\n--follow-class WM_CLASS (X11)  --login (launch context only)\nMac preview: --preview OUTPUT; probe: --probe quiet|idle|work|reaction --seconds 60");
                return Ok(());
            }
            _ => return Err(format!("unknown option: {a}").into()),
        }
        i += 1;
    }
    #[cfg(target_os = "windows")]
    if uninstall_notice_shortcut {
        return coco_companion::platform::windows::uninstall_notice_shortcut(&options.folder);
    }
    if let Some(mode) = probe {
        if !["quiet", "idle", "work", "reaction"].contains(&mode.as_str()) {
            return Err("unknown probe mode".into());
        }
        return coco_companion::preview::probe(options, &mode, seconds);
    }
    #[cfg(target_os = "macos")]
    if let Some(path) = preview_e2 {
        return coco_companion::preview::e2(options, &path);
    }
    #[cfg(not(target_os = "macos"))]
    if preview_e2.is_some() {
        return Err("offscreen review previews are enabled only on macOS".into());
    }
    #[cfg(target_os = "macos")]
    if let Some(path) = preview {
        return coco_companion::preview::run(options, &path);
    }
    #[cfg(not(target_os = "macos"))]
    if preview.is_some() {
        return Err("offscreen review previews are enabled only on macOS".into());
    }
    #[cfg(target_os = "macos")]
    {
        let _ = (options, seed, exe);
        return Err("this host build only renders previews; use --preview or --probe".into());
    }
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    {
        std::fs::create_dir_all(&options.folder)?;
        #[cfg(target_os = "linux")]
        let _instance =
            match coco_companion::instance::InstanceGuard::acquire(&options.folder)? {
                Some(guard) => guard,
                None => return Ok(()),
            };
        if let Some(presence) = &options.presence_folder {
            std::fs::create_dir_all(presence)?;
        }
        let mut engine = Engine::new(options.clone(), epoch_ms(), seed)?;
        if !options.login {
            engine.wave(epoch_ms());
        }
        #[cfg(target_os = "linux")]
        engine.mark_running(true)?;
        let options = engine.options.clone();
        #[cfg(target_os = "windows")]
        return coco_companion::platform::windows::run(engine, options);
        #[cfg(target_os = "linux")]
        return coco_companion::platform::linux::run(engine, options);
    }
}
