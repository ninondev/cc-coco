use std::{
    env, fs,
    io::Write,
    path::{Path, PathBuf},
    process::{self, Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};
type Result<T> = std::result::Result<T, String>;
struct Scratch(PathBuf);
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn command(command: &mut Command) -> Result<Vec<u8>> {
    let result = command.output().map_err(|e| e.to_string())?;
    if !result.status.success() {
        return Err(format!(
            "command failed: {}{}",
            String::from_utf8_lossy(&result.stdout),
            String::from_utf8_lossy(&result.stderr)
        ));
    }
    Ok(result.stdout)
}
fn digest(bytes: &[u8]) -> Result<String> {
    let mut child = Command::new("shasum")
        .args(["-a", "256"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    child
        .stdin
        .take()
        .ok_or("digest input")?
        .write_all(bytes)
        .map_err(|e| e.to_string())?;
    let result = child.wait_with_output().map_err(|e| e.to_string())?;
    let value = String::from_utf8(result.stdout)
        .map_err(|e| e.to_string())?
        .split_whitespace()
        .next()
        .ok_or("digest output")?
        .to_owned();
    if !result.status.success()
        || value.len() != 64
        || !value.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("digest failed".into());
    }
    Ok(value)
}
fn add_input(bytes: &mut Vec<u8>, name: &str, content: &[u8]) {
    bytes.extend_from_slice(&(name.len() as u64).to_le_bytes());
    bytes.extend_from_slice(name.as_bytes());
    bytes.extend_from_slice(&(content.len() as u64).to_le_bytes());
    bytes.extend_from_slice(content);
}
fn snapshot(root: &Path, paths: &mut std::collections::BTreeMap<PathBuf, Vec<u8>>) -> Result<()> {
    for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.is_dir() {
            snapshot(&path, paths)?;
        } else if ["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"]
            .contains(&path.extension().and_then(|s| s.to_str()).unwrap_or(""))
        {
            paths.insert(path.clone(), fs::read(path).map_err(|e| e.to_string())?);
        }
    }
    Ok(())
}
fn compiler(given: Option<PathBuf>) -> Result<PathBuf> {
    if let Some(path) = given.or_else(|| env::var_os("COCO_TYPESCRIPT").map(PathBuf::from)) {
        return fs::canonicalize(path).map_err(|e| e.to_string());
    }
    let cache =
        PathBuf::from(env::var_os("HOME").ok_or("HOME is required")?).join(".bun/install/cache");
    let mut paths = fs::read_dir(cache)
        .map_err(|_| "TypeScript compiler not found; use --typescript PATH")?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .map_or(false, |n| n.to_string_lossy().starts_with("typescript@5."))
        })
        .map(|p| p.join("lib/typescript.js"))
        .filter(|p| p.is_file())
        .collect::<Vec<_>>();
    paths.sort();
    paths
        .pop()
        .ok_or("TypeScript compiler not found; use --typescript PATH".into())
}
fn run() -> Result<()> {
    let tool = Path::new(env!("CARGO_MANIFEST_DIR"));
    let repo = tool.parent().and_then(Path::parent).ok_or("repo root")?;
    let mut plugin = repo.join("plugin");
    let mut output = None;
    let mut receipt = None;
    let mut typescript = None;
    let mut check = false;
    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--check" => check = true,
            "--plugin" => plugin = PathBuf::from(args.next().ok_or("--plugin requires a path")?),
            "--output" => {
                output = Some(PathBuf::from(
                    args.next().ok_or("--output requires a path")?,
                ))
            }
            "--receipt" => {
                receipt = Some(PathBuf::from(
                    args.next().ok_or("--receipt requires a path")?,
                ))
            }
            "--typescript" => {
                typescript = Some(PathBuf::from(
                    args.next().ok_or("--typescript requires a path")?,
                ))
            }
            _ => return Err(format!("unknown argument: {arg}")),
        }
    }
    let plugin = fs::canonicalize(plugin).map_err(|e| e.to_string())?;
    let output = output.unwrap_or_else(|| plugin.join("hooks/hooks-bundle.js"));
    let compiler = compiler(typescript)?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let scratch =
        Scratch(env::temp_dir().join(format!("moe-hooks-bundle-{}-{stamp}", process::id())));
    fs::create_dir(&scratch.0).map_err(|e| e.to_string())?;
    let raw = scratch.0.join("hooks.js");
    let meta = scratch.0.join("graph.json");
    let reference = scratch.0.join("reference.js");
    let inputs = scratch.0.join("inputs.txt");
    let report = scratch.0.join("normalizations.json");
    let mut before = std::collections::BTreeMap::new();
    snapshot(&plugin.join("hooks"), &mut before)?;
    for (file, whitespace) in [(&reference, false), (&raw, true)] {
        let mut build = Command::new("bun");
        build.current_dir(&plugin).args([
            "--no-env-file", "build", "--target=browser", "--format=esm",
            "--external=claude-code", "--keep-names", "--jsx-runtime=classic",
            "--jsx-factory=h", "--jsx-fragment=Fragment",
        ]);
        if whitespace { build.arg("--minify-whitespace"); }
        build.arg(format!("--outfile={}", file.display()))
            .arg(format!("--metafile={}", meta.display()))
            .arg("hooks/register.tsx");
        command(&mut build)?;
    }
    command(
        Command::new("bun")
            .current_dir(&plugin)
            .arg("--no-env-file")
            .arg(tool.join("normalize.ts"))
            .arg(&raw)
            .arg(&compiler)
            .arg(&meta)
            .arg(&inputs)
            .arg(&report)
            .arg(&reference),
    )?;
    let mut digest_input = Vec::new();
    for path in fs::read_to_string(&inputs)
        .map_err(|e| e.to_string())?
        .lines()
    {
        let file = plugin.join(path);
        let bytes = before
            .get(&file)
            .ok_or("graph input was absent before build")?;
        if *bytes != fs::read(file).map_err(|e| e.to_string())? {
            return Err("graph changed during build".into());
        }
        add_input(&mut digest_input, path, bytes);
    }
    for path in ["Cargo.toml", "src/main.rs", "normalize.ts"] {
        add_input(
            &mut digest_input,
            &format!("generator/{path}"),
            &fs::read(tool.join(path)).map_err(|e| e.to_string())?,
        );
    }
    add_input(
        &mut digest_input,
        "bun-version",
        &command(Command::new("bun").arg("--version"))?,
    );
    add_input(
        &mut digest_input,
        "typescript-compiler",
        &fs::read(compiler).map_err(|e| e.to_string())?,
    );
    let input_sha = digest(&digest_input)?;
    let body = fs::read_to_string(raw).map_err(|e| e.to_string())?;
    let bundle = format!(
        "// Generated by tools/hooks-bundle. Do not edit.\n// Input SHA256: {input_sha}\n{body}"
    );
    if bundle.len() >= 1_048_576 {
        return Err(format!(
            "bundle exceeds module limit: {} bytes",
            bundle.len()
        ));
    }
    if check {
        if fs::read(&output).map_err(|e| e.to_string())? != bundle.as_bytes() {
            return Err(format!("{} is stale", output.display()));
        }
    } else {
        fs::write(&output, bundle.as_bytes()).map_err(|e| e.to_string())?;
    }
    if let Some(path) = receipt {
        fs::copy(report, path).map_err(|e| e.to_string())?;
    }
    println!(
        "{}: {} bytes; Input SHA256: {input_sha}",
        if check { "clean" } else { "generated" },
        bundle.len()
    );
    Ok(())
}
fn main() {
    if let Err(error) = run() {
        eprintln!("hooks-bundle: {error}");
        process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sha256_known_vector() {
        assert_eq!(
            digest(b"abc").unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
    #[test]
    fn input_boundaries_are_unambiguous() {
        let mut a = Vec::new();
        let mut b = Vec::new();
        add_input(&mut a, "a", b"bc");
        add_input(&mut b, "ab", b"c");
        assert_ne!(a, b);
    }
}
