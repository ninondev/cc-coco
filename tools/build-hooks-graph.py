#!/usr/bin/env python3
"""Generate the static hook graph.

The source is the canonical hooks-source directory; the output is an existing
plugin copy. --check rebuilds in scratch and compares every owned output byte.
No compiler is installed or downloaded. Pass an existing --typescript file.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent
HELPER = ROOT / "tools/hooks-bundle/split-graph.ts"
GROUPS = ROOT / "tools/hooks-bundle/split-groups.json"
COMPILED = "hooks/m1-compiled"


def digest(path: Path) -> dict[str, str | int]:
    data = path.read_bytes()
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def mirror_file(root: Path, relative: str, *, missing: bool = False) -> None:
    """Check only this owned logical root and its descendants, without following links."""
    parts = relative.split("/")
    if not parts or any(part in {"", ".", ".."} for part in parts) or Path(relative).is_absolute():
        raise ValueError("Invalid canonical mirror path: " + relative)
    current = root
    if not stat.S_ISDIR(current.lstat().st_mode):
        raise ValueError("Canonical mirror root is not a regular directory: " + str(root))
    for index, part in enumerate(parts):
        current = current / part
        try:
            mode = current.lstat().st_mode
        except FileNotFoundError:
            if missing:
                return
            raise
        expected = stat.S_ISREG if index == len(parts) - 1 else stat.S_ISDIR
        if not expected(mode):
            raise ValueError("Canonical mirror requires regular paths: " + str(current))


def owned_paths(plugin: Path) -> set[str]:
    manifest = plugin / COMPILED / "manifest.json"
    if not manifest.exists():
        return set()
    value = json.loads(manifest.read_text())
    result = set(value["ownedPaths"])
    for name in result:
        path = Path(name)
        if path.is_absolute() or ".." in path.parts or not name.startswith("hooks/"):
            raise ValueError("Invalid generated ownership path: " + name)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT / "plugin/hooks-source")
    parser.add_argument("--output", type=Path, default=ROOT / "plugin")
    cached = os.environ.get("COCO_TYPESCRIPT") or next(iter(sorted(Path.home().glob(".bun/install/cache/typescript@5.*/lib/typescript.js"))), None)
    parser.add_argument("--typescript", type=Path, default=Path(cached) if cached else None, required=cached is None)
    parser.add_argument("--bun", default=shutil.which("bun"))
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--fixture-module", action="append", default=[],
                        help="scratch-only test instrumentation module bundled in the presence group")
    args = parser.parse_args()
    source, output = args.source.resolve(), args.output.resolve()
    if not source.is_dir() or not (source / "register.tsx").is_file():
        parser.error("--source must contain canonical register.tsx")
    if not output.is_dir() or not (output / "hooks").is_dir():
        parser.error("--output must be an existing plugin copy")
    if not args.typescript.is_file() or not args.bun:
        parser.error("Existing --typescript compiler and Bun executable required")
    if source == output / "hooks" and owned_paths(output):
        parser.error("Generated public hooks cannot be reused as canonical source")
    groups = json.loads(GROUPS.read_text())
    if list(groups) != ["motion_stills", "pages", "companion", "presence"]:
        raise ValueError("The four reviewed groups must remain fixed")
    if args.fixture_module:
        if output == ROOT / "plugin":
            parser.error("--fixture-module is for scratch test copies only")
        for name in args.fixture_module:
            if "/" in name or not name.endswith(".ts") or not (source / name).is_file():
                parser.error("fixture module must be a top-level source file: " + name)
            groups["presence"].append("hooks/" + name)
    inputs = [name for paths in groups.values() for name in paths]
    if len(inputs) != len(set(inputs)) or "hooks/touch-client.ts" in inputs:
        raise ValueError("Grouped source duplicated or standalone Client bundled")
    inputs += ["hooks/register.tsx", "hooks/touch-client.ts"]
    canonical_mirrors = []
    bundled_scripts = []
    for path in source.rglob("*"):
        if path.is_symlink():
            raise ValueError("Canonical mirror discovery refuses source links: " + str(path))
        relative = path.relative_to(source).as_posix()
        name = "hooks/" + relative
        if path.suffix == ".js":
            # Generated runtime JavaScript (the D1 modules, and main's cost/units.js and cost/runtime.js) is a
            # bundled input, never a mirror.
            mirror_file(source, relative)
            bundled_scripts.append(name)
            continue
        if path.suffix not in {".ts", ".tsx"} or name in inputs:
            continue
        mirror_file(source, relative)
        mirror_file(output, name, missing=True)
        canonical_mirrors.append(name)
    canonical_mirrors.sort()
    inputs += sorted(name for name in bundled_scripts if name not in inputs) + canonical_mirrors
    identities = {name: digest(source / name.removeprefix("hooks/")) for name in inputs}
    before_owned = owned_paths(output)
    output_source = output / "hooks-source"
    if not output_source.exists() and output == ROOT / "plugin":
        parser.error("Create the canonical hooks-source before production generation")
    if not output_source.exists() and args.check:
        print("missing: hooks-source", file=sys.stderr)
        return 1
    if output_source.exists():
        for name, identity in identities.items():
            path = output_source / name.removeprefix("hooks/")
            if not path.is_file() or digest(path) != identity:
                parser.error("Output canonical copy differs from --source: " + name)

    with tempfile.TemporaryDirectory(prefix="hooks-graph-", dir=os.environ.get("TMPDIR")) as temp:
        work = Path(temp)
        plugin = work / "plugin"
        for name in canonical_mirrors:
            mirror_file(source, name.removeprefix("hooks/"))
            mirror_file(output, name, missing=True)
        shutil.copytree(output, plugin, symlinks=True)
        # Only scratch is reconstructed. The output's canonical source stays untouched.
        shutil.rmtree(plugin / "hooks")
        shutil.copytree(source, plugin / "hooks", symlinks=True)
        canonical = plugin / "hooks-source"
        if canonical.exists():
            shutil.rmtree(canonical)
        shutil.copytree(source, canonical, symlinks=True)
        authored = work / "authored/plugin/hooks"
        authored.parent.mkdir(parents=True)
        shutil.copytree(source, authored, symlinks=True)
        (work / "manifest.json").write_text(json.dumps({
            "sourcePlugin": str(source.parent),
            "sourceInputs": identities,
            "groups": groups,
            "canonicalMirrors": canonical_mirrors,
            "policy": "Fixed four-group static graph; original standalone Client; live public APIs",
        }, indent=2) + "\n")
        result = subprocess.run([
            args.bun, "--no-env-file", str(HELPER), "--work", str(work),
            "--typescript", str(args.typescript.resolve()),
        ], cwd=work, check=False)
        if result.returncode:
            compile_log = work / "compile.log"
            if compile_log.exists():
                sys.stderr.write(compile_log.read_text())
            return result.returncode

        # Recheck canonical bytes after compiler execution, before any publication.
        for name, identity in identities.items():
            if name in canonical_mirrors:
                mirror_file(source, name.removeprefix("hooks/"))
            if digest(source / name.removeprefix("hooks/")) != identity:
                raise ValueError("Canonical source changed while building: " + name)
        generated_owned = owned_paths(plugin)
        if not generated_owned:
            raise ValueError("Compiler produced no generated inventory")
        for name in canonical_mirrors:
            mirror_file(output, name, missing=True)
            mirror_file(plugin, name)
        missing = sorted(name for name in generated_owned if not (output / name).is_file())
        changed = sorted(name for name in generated_owned
                         if (output / name).is_file()
                         and (output / name).read_bytes() != (plugin / name).read_bytes())
        stale = set(before_owned - generated_owned)
        compiled = output / COMPILED
        if compiled.exists():
            # Owned paths are written with forward slashes; Windows' own separator would make every file stale.
            stale.update(path.relative_to(output).as_posix() for path in compiled.rglob("*")
                         if path.is_file() and path.relative_to(output).as_posix() not in generated_owned)
        if args.check:
            for kind, names in (("missing", missing), ("changed", changed), ("stale", sorted(stale))):
                for name in names:
                    print(kind + ": " + name, file=sys.stderr)
            if missing or changed or stale:
                return 1
            print("Hook graph matches canonical source: " + str(len(generated_owned)) + " files")
            return 0

        # Only previous generator-owned files can be removed automatically.
        unowned_stale = stale - before_owned
        if unowned_stale:
            raise ValueError("Unowned stale compiled files: " + ", ".join(sorted(unowned_stale)))
        if not output_source.exists():
            # A throwaway plugin receives its retained source for strict checks.
            # Production must establish this canonical directory explicitly first.
            shutil.copytree(source, output_source, symlinks=True)
        for name in sorted(stale):
            (output / name).unlink(missing_ok=True)
        for name in sorted(generated_owned):
            target = output / name
            if name in canonical_mirrors:
                mirror_file(output, name, missing=True)
                mirror_file(plugin, name)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes((plugin / name).read_bytes())
        print("Generated hook graph: " + str(len(generated_owned)) + " files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
