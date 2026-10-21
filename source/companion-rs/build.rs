use std::{env, fs, path::PathBuf, process::Command};
#[allow(dead_code)]
#[path = "src/os_metadata.rs"]
mod os_metadata;

fn main() {
    bake_vectors();
    println!("cargo:rerun-if-changed=../.claude-plugin/plugin.json");
    println!("cargo:rerun-if-changed=assets/icons/app.ico");
    println!("cargo:rerun-if-changed=assets/words/1.0.json");
    println!("cargo:rerun-if-changed=src/os_metadata.rs");
    let manifest = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap());
    let plugin = fs::read_to_string(manifest.join("../.claude-plugin/plugin.json"))
        .expect("plugin version metadata");
    // The release source of truth is plugin.json. No second version lives in the resource.
    let version = plugin
        .split('"')
        .collect::<Vec<_>>()
        .windows(4)
        .find(|parts| parts[0] == "version" && parts[1].trim() == ":")
        .map(|parts| parts[2])
        .expect("plugin version");
    let components: Vec<u16> = version
        .split('.')
        .map(|part| part.parse().expect("numeric plugin version"))
        .collect();
    assert!(
        (1..=4).contains(&components.len()),
        "version must have at most four numeric components"
    );
    let mut tuple = [0u16; 4];
    tuple[..components.len()].copy_from_slice(&components);
    println!("cargo:rustc-env=COCO_PLUGIN_VERSION={version}");
    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }
    let out = PathBuf::from(env::var_os("OUT_DIR").unwrap());
    let resource = out.join("coco-version.rc");
    let icon = manifest
        .join("assets/icons/app.ico")
        .to_string_lossy()
        .replace('\\', "/");
    fs::write(
        &resource,
        os_metadata::windows_version_resource(version, tuple, &icon),
    )
    .expect("write version resource");
    // Cross builds (tools/build-companion-bins.py on Linux) compile the same resource with the
    // MinGW or zig tools, so the shipped programs carry the icon and version too.
    if !env::var("HOST").unwrap().contains("-windows-") {
        cross_resource(&out, &resource);
        return;
    }
    // Cross-target cargo check never links an executable. Real MSVC release builds must
    // compile the VERSIONINFO on the Windows runner, and fail if the SDK is unavailable.
    // A Windows ARM64 runner may use an x64 Rust host toolchain. The .res is
    // architecture-independent, so both Windows host architectures must embed it.
    let compiled = out.join("coco-version.res");
    let status = Command::new("rc.exe")
        .arg("/nologo")
        .arg("/fo")
        .arg(&compiled)
        .arg(&resource)
        .status()
        .expect("Windows SDK rc.exe must be on PATH");
    assert!(
        status.success(),
        "Windows version resource compilation failed"
    );
    println!(
        "cargo:rustc-link-arg-bin=coco-companion={}",
        compiled.display()
    );
}

/// The resource for a Windows program built on another system: GNU targets link a COFF object
/// from MinGW's windres (COCO_WINDRES), gnullvm targets (cargo zigbuild) a .res from `zig rc`
/// (COCO_ZIG_BIN, else zig on PATH). A missing tool
/// skips the resource with a warning unless COCO_WINDOWS_RESOURCE=required, as the release
/// script sets it.
fn cross_resource(out: &std::path::Path, resource: &std::path::Path) {
    println!("cargo:rerun-if-env-changed=COCO_WINDOWS_RESOURCE");
    println!("cargo:rerun-if-env-changed=COCO_WINDRES");
    println!("cargo:rerun-if-env-changed=COCO_ZIG_BIN");
    let required = env::var("COCO_WINDOWS_RESOURCE").as_deref() == Ok("required");
    // gnullvm targets say env "gnu" too; their ABI is "llvm".
    let llvm = env::var("CARGO_CFG_TARGET_ABI").as_deref() == Ok("llvm");
    let (compiled, mut command) = if !llvm {
        let windres = env::var("COCO_WINDRES").unwrap_or_else(|_| {
            format!("{}-w64-mingw32-windres", env::var("CARGO_CFG_TARGET_ARCH").unwrap())
        });
        let compiled = out.join("coco-version.o");
        let mut command = Command::new(windres);
        command.arg("-O").arg("coff").arg("-i").arg(resource).arg("-o").arg(&compiled);
        (compiled, command)
    } else {
        let compiled = out.join("coco-version.res");
        let mut command = Command::new(env::var("COCO_ZIG_BIN").unwrap_or_else(|_| "zig".into()));
        command.arg("rc").arg("/fo").arg(&compiled).arg("--").arg(resource);
        (compiled, command)
    };
    match command.status() {
        Ok(status) if status.success() => println!(
            "cargo:rustc-link-arg-bin=coco-companion={}",
            compiled.display()
        ),
        result => {
            assert!(!required, "Windows resource compilation failed: {result:?}");
            println!("cargo:warning=no Windows resource compiler; the program has no icon or version");
        }
    }
}

fn bake_vectors() {
    let manifest = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap());
    let out = PathBuf::from(env::var_os("OUT_DIR").unwrap());
    let dir = out.join("vectors");
    fs::create_dir_all(&dir).unwrap();
    let mut entries = Vec::new();
    for folder in ["icons", "decor"] {
        let mut paths = fs::read_dir(manifest.join("assets").join(folder))
            .unwrap()
            .map(|p| p.unwrap().path())
            .filter(|p| p.extension().is_some_and(|e| e == "svg"))
            .collect::<Vec<_>>();
        paths.sort();
        for path in paths {
            println!("cargo:rerun-if-changed={}", path.display());
            let name = path.file_stem().unwrap().to_str().unwrap();
            let bytes = fs::read(&path).unwrap();
            let mut sources = vec![bytes.clone()];
            if name.starts_with("hover-") {
                sources.push(
                    String::from_utf8_lossy(&bytes)
                        .replace("#5C2A1E", "#FAEEE9")
                        .replace("#5c2a1e", "#FAEEE9")
                        .into_bytes(),
                );
                sources.push(
                    String::from_utf8_lossy(&bytes)
                        .replace("#C75730", "#E07A55")
                        .replace("#c75730", "#E07A55")
                        .into_bytes(),
                );
            }
            let sizes: Vec<(f32, f32)> = if name.starts_with("hover-") {
                vec![(20., 20.)]
            } else if name == "send-arrow" {
                vec![(16., 16.)]
            } else if name == "new-chat" {
                vec![(14., 14.)]
            } else if name == "target-chevron" {
                vec![(12., 12.)]
            } else if name.starts_with("ribbon-") {
                vec![(if name.ends_with("-6") { 6. } else { 8. }, 22.)]
            } else if name.starts_with("scroll-") {
                vec![(10., 20.), (40. / 3., 80. / 3.)]
            } else if name.starts_with("bundle-") {
                vec![(17., 20.), (68. / 3., 80. / 3.)]
            } else if name.starts_with("lantern-") {
                vec![(18.24, 25.92), (24.32, 34.56)]
            } else {
                let t =
                    resvg::usvg::Tree::from_data(&bytes, &resvg::usvg::Options::default()).unwrap();
                vec![(t.size().width(), t.size().height())]
            };
            for source in sources {
                let hash = source.iter().fold(0xcbf29ce484222325u64, |h, b| {
                    (h ^ *b as u64).wrapping_mul(0x100000001b3)
                });
                let tree = resvg::usvg::Tree::from_data(&source, &resvg::usvg::Options::default())
                    .unwrap();
                for (w, h) in &sizes {
                    for percent in (100..=300).step_by(25) {
                        let scale = percent as f32 / 100.;
                        let (dw, dh) = ((w * scale).round() as u32, (h * scale).round() as u32);
                        let file = dir.join(format!("{hash:016x}-{dw}-{dh}.png"));
                        if !file.exists() {
                            let mut pm = resvg::tiny_skia::Pixmap::new(dw, dh).unwrap();
                            resvg::render(
                                &tree,
                                resvg::tiny_skia::Transform::from_scale(
                                    dw as f32 / tree.size().width(),
                                    dh as f32 / tree.size().height(),
                                ),
                                &mut pm.as_mut(),
                            );
                            pm.save_png(&file).unwrap();
                        }
                        entries.push(format!(
                            "({hash}u64,{dw},{dh},include_bytes!({:?}).as_slice())",
                            file.to_string_lossy()
                        ));
                    }
                }
            }
        }
    }
    entries.sort();
    entries.dedup();
    fs::write(
        out.join("vector_catalog.rs"),
        format!(
            "static BAKED:&[(u64,u32,u32,&[u8])]=&[{}];",
            entries.join(",\n")
        ),
    )
    .unwrap();
}
