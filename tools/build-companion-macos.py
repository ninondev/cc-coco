#!/usr/bin/env python3
"""Build a universal macOS 13 Coco Pet.app in a NEW caller-owned scratch directory.

Run through zcode/heavy.sh with --output /absolute/new-directory. The directory
must not exist. Its Coco Pet.app is signed ad hoc for local verification only;
release signing belongs to the release owner. No installation, launch, Keychain,
notarization or network operation is performed. build-receipt.json records
relative input paths, hashes, compiler and SDK versions, without timestamps or
machine paths. build.txt is that receipt's SHA-256. Intermediate files stay in
the supplied scratch directory for inspection.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
LABEL = 'io.github.ninondev.coco-companion'
ARCHES = ('arm64', 'x86_64')


def run(*args: str | Path, cwd: Path = ROOT, env: dict | None = None) -> str:
    result = subprocess.run([str(arg) for arg in args], cwd=cwd, env=env,
                            text=True, stdout=subprocess.PIPE, check=True)
    return result.stdout.strip()


def sha(path: Path) -> str:
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def build(output: Path) -> Path:
    if not output.is_absolute():
        raise ValueError('--output must be an absolute, new scratch directory')
    if output.exists() or output.is_symlink():
        raise ValueError('--output already exists; choose a new scratch directory')
    if sys.platform != 'darwin':
        raise ValueError('this builder needs macOS and the Xcode Command Line Tools')
    output.mkdir(mode=0o700, parents=False)
    output = output.resolve()
    work = output / 'build'
    work.mkdir()
    app = output / 'Coco Pet.app'
    resources = app / 'Contents/Resources'
    binary = app / 'Contents/MacOS/coco-companion'
    resources.mkdir(parents=True)
    binary.parent.mkdir()
    plugin = ROOT / 'plugin'
    inputs: dict[str, str] = {}

    def remember(path: Path) -> None:
        if path.is_symlink() or not path.is_file():
            raise ValueError(f'expected a regular build input: {path.relative_to(ROOT)}')
        inputs[path.relative_to(ROOT).as_posix()] = sha(path)

    def copy(path: Path, destination: Path) -> None:
        remember(path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, destination)
        if sha(destination) != inputs[path.relative_to(ROOT).as_posix()]:
            raise ValueError('a build input changed during copying; rebuild in a new directory')

    def group(folder: Path, pattern: str, target: str) -> None:
        for path in sorted(folder.glob(pattern)):
            copy(path, resources / target / path.relative_to(folder))

    version_file = plugin / '.claude-plugin/plugin.json'
    remember(version_file)
    version = json.loads(version_file.read_text())['version']
    plist_source = plugin / 'companion/Info.plist'
    remember(plist_source)
    info = plistlib.loads(plist_source.read_bytes().replace(b'@VERSION@', version.encode()))
    if info['CFBundleIdentifier'] != LABEL:
        raise ValueError('unexpected companion bundle identifier')
    info['LSMinimumSystemVersion'] = '13.0'
    (app / 'Contents/Info.plist').write_bytes(plistlib.dumps(info, sort_keys=False))
    sources = sorted((plugin / 'companion/Sources').glob('*.swift'))
    if not sources:
        raise ValueError('no companion Swift sources')
    for source in sources:
        remember(source)
    for folder, target in [('desktop', 'frames'), ('pixel', 'pixel')]:
        if not (plugin / 'assets' / folder / '01-idle-reading.png').is_file():
            raise ValueError(f'missing {folder} frames')
        group(plugin / 'assets' / folder, '*.png', target)
    for name in ('frame-manifest.json', 'companion-tuning.json', 'neighbours.json'):
        copy(plugin / 'assets' / name, resources / name)
    for path in sorted((plugin / 'assets/patches').rglob('*')):
        if path.is_file():
            copy(path, resources / 'patches' / path.relative_to(plugin / 'assets/patches'))
    for name in ('shed', 'visitors'):
        folder = plugin / 'assets' / name
        if folder.is_dir():
            group(folder, '*.png', name)
            copy(folder / (name + '.json'), resources / name / (name + '.json'))
    coco = plugin / 'companion-rs/assets/coco'
    if (coco / 'band-A.json').is_file() and (coco / 'band-B.json').is_file():
        for pattern in ('*.json', '*.bin'):
            group(coco, pattern, 'coco')
    words = plugin / 'companion-rs/assets/words'
    if all((words / name).is_file() for name in ('quota.json', 'languages.json')):
        for name in ('quota.json', 'languages.json'):
            copy(words / name, resources / 'words' / name)
    for form in ('dake', 'maid'):
        group(plugin / 'assets/claudie' / form, '*.png', 'claudie/' + form)

    env = dict(os.environ, PATH='/usr/bin:/bin:/usr/sbin:/sbin', TMPDIR=str(work),
               CLANG_MODULE_CACHE_PATH=str(work / 'clang-cache'))
    icon = plugin / 'assets/icon/coco-1024.png'
    remember(icon)
    iconset = work / 'AppIcon.iconset'
    iconset.mkdir()
    for px in (16, 32, 128, 256, 512):
        for scale, suffix in ((1, ''), (2, '@2x')):
            run('/usr/bin/sips', '-z', str(px * scale), str(px * scale), icon,
                '--out', iconset / f'icon_{px}x{px}{suffix}.png', env=env)
    for source, target in [('coco-16.png', 'icon_16x16.png'),
                           ('coco-32.png', 'icon_16x16@2x.png'),
                           ('coco-32.png', 'icon_32x32.png')]:
        copy(plugin / 'assets/icon' / source, iconset / target)
    icon_builder = plugin / 'assets/icon/build-icns.sh'
    remember(icon_builder)
    run('/bin/sh', icon_builder, iconset, resources / 'AppIcon.icns', env=env)

    sdk = run('/usr/bin/xcrun', '--sdk', 'macosx', '--show-sdk-path', env=env)
    compiler = run('/usr/bin/xcrun', '--sdk', 'macosx', 'swiftc', '-version', env=env)
    sdk_version = run('/usr/bin/xcrun', '--sdk', 'macosx', '--show-sdk-version', env=env)
    remember(Path(__file__).resolve())
    receipt = {'schema': 1, 'version': version, 'architectures': list(ARCHES),
               'minimumMacOS': '13.0', 'compiler': compiler, 'sdk': sdk_version,
               'inputs': dict(sorted(inputs.items()))}
    receipt_bytes = (json.dumps(receipt, sort_keys=True, indent=2) + '\n').encode()
    (resources / 'build-receipt.json').write_bytes(receipt_bytes)
    (resources / 'build.txt').write_text(hashlib.sha256(receipt_bytes).hexdigest() + '\n')
    for arch in ARCHES:
        print(f'Building {arch} for macOS 13.0', flush=True)
        run('/usr/bin/xcrun', '--sdk', 'macosx', 'swiftc', '-O', '-swift-version', '5',
            '-j', '1', '-module-name', 'CocoPet', '-target', f'{arch}-apple-macos13.0',
            '-sdk', sdk, '-module-cache-path', work / ('cache-' + arch),
            '-debug-prefix-map', f'{ROOT}=/coco', '-file-prefix-map', f'{ROOT}=/coco',
            '-debug-prefix-map', f'{output}=/coco-build', '-file-prefix-map', f'{output}=/coco-build',
            '-o', work / arch, *[source.relative_to(ROOT) for source in sources], env=env)
        run('/usr/bin/strip', '-S', '-x', work / arch, env=env)
    run('/usr/bin/lipo', '-create', *[work / arch for arch in ARCHES], '-output', binary, env=env)
    for name, digest in inputs.items():
        if sha(ROOT / name) != digest:
            raise ValueError(f'build input changed during compilation: {name}; rebuild in a new directory')
    payload = binary.read_bytes()
    if any(marker in payload for marker in (b'/Users/', Path.home().name.encode(), str(ROOT).encode(), str(output).encode())):
        raise ValueError('binary contains a local user path; do not release this build')
    run('/usr/bin/codesign', '--force', '--sign', '-', '--identifier', LABEL, app, env=env)
    run('/usr/bin/codesign', '--verify', '--deep', '--strict', app, env=env)
    arches = run('/usr/bin/lipo', '-archs', binary, env=env).split()
    if len(arches) != len(ARCHES) or set(arches) != set(ARCHES):
        raise ValueError(f'expected arm64 and x86_64, got {arches}')
    print(json.dumps({'app': str(app), 'architectures': list(ARCHES), 'minimumMacOS': '13.0',
                      'build': hashlib.sha256(receipt_bytes).hexdigest(),
                      'binarySha256': sha(binary), 'signing': 'adhoc'}, sort_keys=True))
    return app


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        build(args.output)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f'build-companion-macos: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
