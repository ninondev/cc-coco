#!/usr/bin/env python3
"""Check that every copy of the plugin's version agrees with plugin/.claude-plugin/plugin.json."""
import json
import re
import sys
from pathlib import Path

sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parent.parent
# Three numbers, or four when the last one counts small fixes (CHANGELOG.md).
VERSION = re.compile(r'\d+\.\d+\.\d+(?:\.\d+)?')
CONSTANT = re.compile(r'^export const PLUGIN_VERSION = "([^"]*)"$', re.M)
BUILT = re.compile(r'\b(PLUGIN_VERSION\d*)\s*=\s*"([^"]*)"')
RELEASE = re.compile(r'^## \[(?!Unreleased\])([^\]]+)\]', re.M)


def read(name):
    return (ROOT/name).read_text(encoding='utf-8')


def copies():
    """Each place the version is written, with what it holds (None when it is not there)."""
    plugins = json.loads(read('.claude-plugin/marketplace.json')).get('plugins', [])
    yield '.claude-plugin/marketplace.json', next((p.get('version') for p in plugins if p.get('name') == 'coco'), None)
    for name in ('source/hooks/plugin-version.ts', 'source/hooks/book-text.ts'):
        found = CONSTANT.search(read(name))
        yield name, found[1] if found else None
    latest = RELEASE.search(read('CHANGELOG.md'))
    yield 'CHANGELOG.md (latest release heading)', latest[1] if latest else None


def main():
    version = json.loads(read('plugin/.claude-plugin/plugin.json')).get('version')
    if not isinstance(version, str) or not VERSION.fullmatch(version):
        print(f'check-version: plugin.json has no usable version: {version!r}', file=sys.stderr)
        return 1
    wrong = [f'{name}: {found!r}' for name, found in copies() if found != version]
    # The loaded hooks are built from source/hooks; a stale build still carries the old number.
    # The bundler numbers a second copy of the name (PLUGIN_VERSION2), and each copy must agree.
    found = False
    for path in sorted((ROOT/'plugin/hooks/m1-compiled').glob('*.js')):
        for name, built in BUILT.findall(path.read_text(encoding='utf-8')):
            found = True
            if built != version:
                wrong.append(f'plugin/hooks/m1-compiled/{path.name} ({name}): {built!r} (rebuild with tools/build-hooks-graph.py)')
    if not found:
        wrong.append('plugin/hooks/m1-compiled: no module carries it (rebuild with tools/build-hooks-graph.py)')
    for line in wrong:
        print(f'check-version: expected {version}, {line}', file=sys.stderr)
    if not wrong:
        print(f'check-version: {version} everywhere')
    return 1 if wrong else 0


if __name__ == '__main__':
    sys.exit(main())
