#!/usr/bin/env python3
"""File selection, inventory and byte-budget checks for public assembly."""
import argparse
import fnmatch
import json
import os
import stat
import sys
from functools import lru_cache
from pathlib import Path

sys.dont_write_bytecode = True

# Logical bytes of plugin/. The owner approved 64 MiB for 1.0 (DECISIONS line 997); remeasure before raising.
PLUGIN_BUDGET = 64 * 1024 * 1024
# The shipped builds, the only executables the tree may carry (the macOS libexec/talk-key is added at release).
RUNTIME_BINARIES = {
    'bin/presence-native', 'bin/presence-follow',
    'bin/presence-linux-x86_64', 'bin/presence-linux-aarch64',
    'bin/companion-control', 'bin/coco-state-macos-aarch64', 'bin/coco-state-macos-x86_64',
    'companion-rs/bin/coco-companion-linux-x86_64', 'companion-rs/bin/coco-companion-linux-aarch64',
    'companion-rs/bin/coco-companion-windows-x86_64.exe', 'companion-rs/bin/coco-companion-windows-aarch64.exe',
    'libexec/talk-key', 'libexec/talk-key-linux-x86_64', 'libexec/talk-key-linux-aarch64',
    'libexec/talk-key-windows-x86_64.exe', 'libexec/talk-key-windows-aarch64.exe',
}
FORBIDDEN_DIRS = {
    '.git', '.claude', 'evidence', 'sheets', 'sheet', 'previews', 'preview',
    'target', 'build', 'dist', 'node_modules', '__pycache__', '.cache',
    '.build', 'DerivedData', 'out', 'tmp', '.tmp', 'scratch', '.scratch', 'output',
    'persona', 'handoffs',
}
FORBIDDEN_FILES = {
    '.DS_Store', 'tsconfig.json', '.leak-patterns', 'leak-patterns.private',
    'SOURCES.json', 'zh-Hant-generation.json', 'motion2-provenance.json',
    'source.json', 'REPORT.md', 'book-files.ts', 'companion-source.ts', 'motion-data.ts', 'card-metrics-data.ts',
    'plugin-sources.ts', 'review-texts.ts', 'test-system.ts',
}
FORBIDDEN_GLOBS = (
    '.env', '.env.*', '*.log', '*.tmp', '*.bak', '*.swp', '*~', '*.actual.*',
    '*.exe', '*.dll', '*.dylib', '*.so', '*.o', '*.a', '*.app', '*.dmg',
    '*.zip', '*.tar', '*.gz', '*.tgz', '*.pyc', '*-sheet.*', '*-preview.*',
    'plugin-source-part-*.ts',
)
PLUGIN_FILES = {
    '.claude-plugin/plugin.json', 'LICENSE', 'ART-LICENSE.md', 'FONT-LICENSE.md', 'core-words.json',
    'companion/Info.plist', 'types/index.d.ts',
    'assets/frame-manifest.json', 'assets/companion-tuning.json', 'assets/neighbours.json', 'assets/prices.json',
    'assets/coco-room/layers.json', 'assets/shed/shed.json', 'assets/visitors/visitors.json',
    'bin/coco-state', 'bin/companion-macos.sh', 'bin/icon-macos.sh', 'bin/icon-linux.sh',
    'bin/companion-control.c', 'bin/repository-branch.ps1',
    'assets/icon/build-icns.sh', 'assets/icon/words.sh', 'assets/icon/png-compare.awk',
    'bin/presence.sh', 'bin/presence-native.c', 'bin/presence-linux.c',
    'companion-rs/assets/shed-cuts.json', 'companion-rs/bin/builds.json', 'libexec/builds.json',
}
# Hook folders: plugin/hooks holds the loaded modules (and m1-compiled), source/hooks their source.
HOOK_DIRS = {'hooks', 'hooks/algo', 'hooks/cards', 'hooks/cost', 'hooks/cost/core', 'hooks/cost/prices', 'hooks/cost/warm'}
HOOK_SUFFIXES = {'.ts', '.tsx', '.json', '.mjs', '.js'}
# Asset folders (and the folders below them) with the kinds of file each holds.
PET_ASSET = {'.png', '.ico', '.svg', '.json'}
ASSET_KINDS = {
    'assets/desktop': {'.png'}, 'assets/pixel': {'.png'}, 'assets/card': {'.png'}, 'assets/patches': {'.png'},
    'assets/stamps': {'.png'}, 'assets/icon': {'.png'}, 'assets/coco-room': {'.png'}, 'assets/claudie': {'.png'},
    'assets/shed': {'.png'}, 'assets/visitors': {'.png'}, 'assets/coco': {'.png', '.json'},
    'assets/zine': {'.jpg'}, 'assets/sound': {'.wav'},
    'companion-rs/assets/icons': PET_ASSET, 'companion-rs/assets/decor': PET_ASSET,
    'companion-rs/assets/pixel': PET_ASSET, 'companion-rs/assets/shed': PET_ASSET,
    'companion-rs/assets/visitors': PET_ASSET, 'companion-rs/assets/coco': {'.bin', '.json'},
}
# The pet reads these words while it runs; the words it compiles in stay with its source.
PLUGIN_WORDS = {'languages', 'quota'}
CRATE_WORDS = {'0.2', '0.3', '0.4', '1.0', 'feed'}
# source/: what the plugin never loads (the hooks source, the pet's crate, the own-key crate).
SOURCE_FILES = {
    'README.md',
    'companion-rs/Cargo.toml', 'companion-rs/Cargo.lock', 'companion-rs/build.rs',
    'companion-rs/tests/generate-motion-fixtures.mjs',
    'talk-key/Cargo.toml', 'talk-key/Cargo.lock', 'talk-key/README.md', 'talk-key/ci/release.sh',
}
SOURCE_RUST_DIRS = {
    'companion-rs/src', 'companion-rs/src/platform', 'companion-rs/src/coco', 'companion-rs/tests',
    'talk-key/src', 'talk-key/src/store', 'talk-key/examples', 'talk-key/tests', 'talk-key/tests/common',
}
PRIVATE_RUST_TESTS = {'r3_words.rs', 'r4_platform.rs', 'r6_platform.rs'}
# Crate tests that read private files stay private (the assembly leaves them out by these markers).
CRATE_PRIVATE_MARKERS = (b'handoffs/', b'evidence/', b'art/ref')
# docs/: the web demo that GitHub Pages serves, by folder.
DOCS_KINDS = {
    '.': {'.html', '.js', '.json', '.webp'}, 'art': {'.json', '.png'}, 'art/stamps': {'.png'},
    'book': {'.json'}, 'states': {'.json'}, 'words': {'.json'},
}
ROOT_FILES = {
    'LICENSE', 'ART-LICENSE.md', 'README.md', 'README.zh.md', 'README.ja.md',
    'LORE.md', 'LORE.zh.md', 'LORE.ja.md', 'CHANGELOG.md', '.gitignore', '.gitattributes',
    '.claude-plugin/marketplace.json', '.github/workflows/ci.yml', '.github/workflows/prices.yml',
    '.github/ISSUE_TEMPLATE/brand-concern.yml', '.github/ISSUE_TEMPLATE/config.yml',
    'scripts/assemble.sh', 'scripts/check.sh',
    'scripts/release-policy.py', 'scripts/public-tests.py',
    'skins/claude-ai/coco.user.css', 'docs/.nojekyll',
    'media/banner-2x1.png', 'media/demo.gif', 'media/demo.mp4', 'media/demo.png',
    'media/hero-fullbody.webp', 'media/social-preview.png',
}


def forbidden(name):
    parts = Path(name).parts
    return (any(p.lower() in {d.lower() for d in FORBIDDEN_DIRS}
                or p.lower().startswith(('evidence-', 'evidence_', 'sheets-', 'previews-')) for p in parts)
            or parts[-1] in FORBIDDEN_FILES
            or any(fnmatch.fnmatchcase(parts[-1], g) for g in FORBIDDEN_GLOBS))


def hook_allowed(p, extra=()):
    return (p.parent.as_posix() in HOOK_DIRS or p.parent.as_posix() in extra) and p.suffix in HOOK_SUFFIXES


def plugin_allowed(name):
    # The shipped builds first: *.exe is otherwise a forbidden kind.
    if name in RUNTIME_BINARIES:
        return True
    if forbidden(name):
        return False
    p = Path(name)
    if name in PLUGIN_FILES:
        return True
    if name.startswith('hooks/'):
        return hook_allowed(p, ('hooks/m1-compiled',))
    if p.parent.as_posix() in {'book', 'themes'}:
        return p.suffix == '.json'
    if p.parent.as_posix() == 'output-styles':
        return p.suffix == '.md'
    if p.parent.as_posix() == 'companion/Sources':
        return p.suffix == '.swift'
    for folder, kinds in ASSET_KINDS.items():
        if name.startswith(folder + '/'):
            return p.suffix in kinds
    if p.parent.as_posix() == 'companion-rs/assets/words':
        return p.suffix == '.json' and p.stem in PLUGIN_WORDS
    return False


def source_allowed(name):
    if forbidden(name):
        return False
    p = Path(name)
    if name in SOURCE_FILES:
        return True
    if name.startswith('hooks/'):
        return hook_allowed(p)
    if p.parent.as_posix() in SOURCE_RUST_DIRS:
        return p.suffix == '.rs' and p.name not in PRIVATE_RUST_TESTS
    if p.parent.as_posix() == 'companion-rs/tests/fixtures':
        return p.suffix == '.json'
    if p.parent.as_posix() == 'companion-rs/assets/words':
        return p.suffix == '.json' and p.stem in CRATE_WORDS
    return False


def docs_allowed(name):
    if forbidden(name):
        return False
    p = Path(name)
    return p.suffix in DOCS_KINDS.get(p.parent.as_posix(), ())


@lru_cache(maxsize=1)
def test_policy():
    from importlib.util import spec_from_file_location, module_from_spec
    spec = spec_from_file_location('public_tests', Path(__file__).with_name('public-tests.py'))
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def tools_allowed(name):
    if forbidden(name):
        return False
    module = test_policy()
    p = Path(name)
    if name in module.PUBLIC_TOOL_FILES or name in module.GENERATED_TOOL_FILES:
        return True
    if p.parts[0] in module.PUBLIC_TOOL_DIRS:
        return p.suffix in module.PUBLIC_TOOL_DIRS[p.parts[0]]
    if p.parts[0] != 'tests' or any(fnmatch.fnmatchcase(p.name, g) for g in module.EXCLUDED_TESTS):
        return False
    if name in module.TEST_DATA:
        return True
    if len(p.parts) == 2 or p.parts[1] in module.PUBLIC_TEST_DIRS:
        return p.suffix in module.TEST_SUFFIXES
    return False


def private_reader(name, data):
    # A public test that reads private sources, by the assembly's markers.
    if name.startswith('tools/tests/'):
        return any(m in data for m in test_policy().PRIVATE_SOURCE_MARKERS)
    if name.startswith('source/companion-rs/tests/'):
        return any(m in data for m in CRATE_PRIVATE_MARKERS)
    return False


def allowed(name):
    if name in ROOT_FILES:
        return True
    if name.startswith('plugin/'):
        return plugin_allowed(name[7:])
    if name.startswith('source/'):
        return source_allowed(name[7:])
    if name.startswith('docs/'):
        return docs_allowed(name[5:])
    if name.startswith('tools/'):
        return tools_allowed(name[6:])
    return False


def walk_error(error):
    raise error


def inventory(root):
    rows = []
    for folder, dirs, names in os.walk(root, followlinks=False, onerror=walk_error):
        if Path(folder) == root:
            dirs[:] = [d for d in dirs if d != '.git']
        dirs.sort()
        names.sort()
        for name in dirs + names:
            p = Path(folder) / name
            s = p.lstat()
            if stat.S_ISLNK(s.st_mode):
                raise ValueError('symlink is not a public input: ' + str(p))
            if not (stat.S_ISDIR(s.st_mode) or stat.S_ISREG(s.st_mode)):
                raise ValueError('non-regular public input: ' + str(p))
            if stat.S_ISREG(s.st_mode):
                rows.append({'path': p.relative_to(root).as_posix(), 'bytes': s.st_size})
    return rows


def manifest(root):
    rows = inventory(root)
    groups = {}
    for row in rows:
        parts = row['path'].split('/')
        key = '/'.join(parts[:2]) if len(parts) > 2 else (parts[0] if len(parts) > 1 else '(root)')
        group = groups.setdefault(key, {'files': 0, 'bytes': 0})
        group['files'] += 1
        group['bytes'] += row['bytes']
    return {'files': len(rows), 'bytes': sum(r['bytes'] for r in rows),
            'folders': dict(sorted(groups.items())),
            'largest30': sorted(rows, key=lambda r: (-r['bytes'], r['path']))[:30],
            'manifest': rows}


def check(root):
    errors = []
    rows = inventory(root)
    for folder, dirs, _ in os.walk(root, onerror=walk_error):
        if Path(folder) == root:
            dirs[:] = [d for d in dirs if d != '.git']
        for d in dirs:
            p = Path(folder) / d
            if forbidden(p.relative_to(root).as_posix()):
                errors.append('excluded directory: ' + str(p.relative_to(root)))
    included_dirs = {'.git'}
    for row in rows:
        if allowed(row['path']):
            included_dirs.update(p.as_posix() for p in Path(row['path']).parents if p.as_posix() != '.')
    for folder, dirs, _ in os.walk(root, onerror=walk_error):
        if Path(folder) == root:
            dirs[:] = [d for d in dirs if d != '.git']
        for d in dirs:
            relative = (Path(folder)/d).relative_to(root).as_posix()
            if relative not in included_dirs:
                errors.append('not included directory: ' + relative)
    size = 0
    for row in rows:
        name = row['path']
        if not allowed(name):
            errors.append('not included: ' + name)
        if name.startswith('plugin/'):
            size += row['bytes']
        with (root / name).open('rb') as source:
            data = source.read()
        if private_reader(name, data):
            errors.append('reads private sources: ' + name)
        head = data[:4]
        # Only the shipped builds may be executables.
        executable = head[:2] == b'MZ' or head == b'\x7fELF' or head in {
            b'\xfe\xed\xfa\xce', b'\xce\xfa\xed\xfe', b'\xfe\xed\xfa\xcf',
            b'\xcf\xfa\xed\xfe', b'\xca\xfe\xba\xbe', b'\xbe\xba\xfe\xca',
        }
        if executable and name not in {'plugin/' + n for n in RUNTIME_BINARIES}:
            errors.append('local executable: ' + name)
    print(f'plugin budget: {size} / {PLUGIN_BUDGET} bytes')
    if size > PLUGIN_BUDGET:
        errors.append('plugin size budget exceeded')
    for error in errors[:40]:
        print(error, file=sys.stderr)
    return bool(errors)


def filters(kind, source, output):
    if kind == 'plugin':
        select = plugin_allowed
    else:
        # Generated kit inputs are written by public-tests.py, never copied from the private tree.
        generated = set(test_policy().GENERATED_TOOL_FILES)
        def select(name):
            return (tools_allowed(name) and name not in generated
                    and not private_reader('tools/' + name, (source / name).read_bytes()))
    selected = [r['path'] for r in inventory(source) if select(r['path'])]
    parents = set()
    for name in selected:
        parents.update(p.as_posix() for p in Path(name).parents if p.as_posix() != '.')
    lines = ['+ /' + d + '/' for d in sorted(parents, key=lambda n: (n.count('/'), n))]
    lines.extend('+ /' + n for n in selected)
    lines.append('- *')
    output.write_text('\n'.join(lines) + '\n')
    print(f'{kind}: selected {len(selected)} files')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    p = sub.add_parser('filters')
    p.add_argument('kind', choices=['plugin', 'tools'])
    p.add_argument('source', type=Path)
    p.add_argument('output', type=Path)
    for action in ('manifest', 'check'):
        p = sub.add_parser(action)
        p.add_argument('root', type=Path)
    args = parser.parse_args()
    try:
        if args.action == 'filters':
            filters(args.kind, args.source, args.output)
        elif args.action == 'manifest':
            print(json.dumps(manifest(args.root), indent=2, ensure_ascii=False))
        else:
            return int(check(args.root))
    except (OSError, ValueError, ImportError) as error:
        print('release policy failed: ' + str(error), file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
