#!/usr/bin/env python3
"""Run the plugin's tests without shipping them in the plugin.

The tests live in tools/tests/ and are not part of the installed plugin. This script copies
plugin/ to a scratch folder, puts tools/tests/ beside its hooks as tests/, writes
tests/book-files.ts from plugin/book/*.json (the test kit cannot read files), and runs
`claude plugin test` there. A preflight checks both shipped sprite inventories and PNG sizes.
The test run needs no sign-in and no network. The copy leaves out
.claude-plugin/types/ and tsconfig.json, which Claude Code writes itself.

    python3 tools/run-tests.py [--keep] [--claude PATH]

    --keep         leave the scratch folder in place and print its path (for debugging)
    --claude PATH  the claude binary (default: $CLAUDE_BIN, then ~/.local/bin/claude, then PATH)

The claude CLI runs with a throwaway HOME and config folder inside the scratch folder, so a test
run never reads or writes your own ~/.claude. The scratch folder is created with mkdtemp and is
the only thing this script ever removes: to the Trash where /usr/bin/trash exists (macOS), deleted
outright where it does not (Linux CI). Exit status: claude's own (0 pass, 1 fail), 2 for a setup
problem.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREFIX = 'claudesama-tests-'
TIMEOUT = 900


def find_claude(given):
    for candidate in (given, os.environ.get('CLAUDE_BIN'), os.path.expanduser('~/.local/bin/claude')):
        if candidate and os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    return shutil.which('claude')


def book_files(copy):
    """The kit cannot read files: hand the tests his book's words (plugin/book/*.json) as a module."""
    folder = os.path.join(copy, 'book')
    files = {}
    if os.path.isdir(folder):
        for name in sorted(os.listdir(folder)):
            if name.endswith('.json'):
                with open(os.path.join(folder, name), encoding='utf-8') as f:
                    files[name] = f.read()
    with open(os.path.join(copy, 'tests', 'book-files.ts'), 'w', encoding='utf-8') as out:
        out.write('// Written by the test runner from plugin/book/*.json.\n')
        out.write('export const BOOK_FILES: Record<string, string> = ' + json.dumps(files, ensure_ascii=False) + '\n')



def source_files(copy):
    """The kit cannot read source files; inventory the unmodified shipping hooks."""
    files = {}
    for folder, _, names in os.walk(os.path.join(copy, 'hooks')):
        for name in sorted(names):
            if name.endswith(('.ts', '.tsx')):
                path = os.path.join(folder, name)
                with open(path, encoding='utf-8') as source:
                    files[os.path.relpath(path, copy).replace(os.sep, '/')] = source.read()
    with open(os.path.join(copy, 'tests', 'plugin-sources.ts'), 'w', encoding='utf-8') as out:
        out.write('// Written from the shipping hooks before scratch-only root injection.\n')
        out.write('export const PLUGIN_SOURCES: Record<string, string> = ' + json.dumps(files, ensure_ascii=False) + '\n')


def windows_roots(copy, enabled):
    """Only the throwaway copy substitutes a root: the kit has no plugin-root mock."""
    tests = os.path.join(copy, 'tests')
    with open(os.path.join(tests, 'test-system.ts'), 'w', encoding='utf-8') as out:
        out.write('export const WINDOWS_ROOTS = ' + ('true' if enabled else 'false') + '\n')
    if not enabled:
        return
    selected = {'windows-roots.test.tsx', 'paths.test.tsx', 'book.test.tsx', 'book-review.test.tsx',
                'band.test.tsx', 'desktop-sprite.test.tsx'}
    for name in os.listdir(tests):
        if name.endswith('.test.tsx') and name not in selected:
            os.unlink(os.path.join(tests, name))
    root = json.dumps(r'C:\Users\windows\Claude-sama')
    for folder, _, names in os.walk(os.path.join(copy, 'hooks')):
        for name in names:
            if name.endswith(('.ts', '.tsx')):
                path = os.path.join(folder, name)
                with open(path, encoding='utf-8') as source:
                    text = source.read()
                # Expression substitution preserves engine calls, drawing and FS mocks.
                with open(path, 'w', encoding='utf-8') as out:
                    out.write(text.replace('$.plugin.root', root))


def skip_engine_files(plugin):
    """copytree filter: leave out the files Claude Code writes into a plugin it loads from a folder
    (.claude-plugin/types/ and tsconfig.json; it writes them again in the scratch copy), plus
    editor and Python leftovers."""
    engine = {os.path.normpath(os.path.join(plugin, 'tsconfig.json')),
              os.path.normpath(os.path.join(plugin, '.claude-plugin', 'types'))}

    def ignore(folder, names):
        return [n for n in names if n in ('.DS_Store', '__pycache__') or os.path.normpath(os.path.join(folder, n)) in engine]
    return ignore


def remove_scratch(scratch):
    """Remove the scratch folder this run created, and only that.

    On a Mac it goes to the Trash (/usr/bin/trash, macOS 15 and later); where that tool does not
    exist, such as a Linux CI runner, the folder is deleted outright."""
    if not (os.path.basename(scratch).startswith(PREFIX) and os.path.isdir(scratch) and not os.path.islink(scratch)):
        return
    trash = '/usr/bin/trash'
    if os.access(trash, os.X_OK):
        done = subprocess.run([trash, scratch], capture_output=True)
        if done.returncode != 0:
            sys.stderr.write('run-tests.py: could not move %s to the Trash; left in place\n' % scratch)
        return
    shutil.rmtree(scratch, ignore_errors=True)


def main():
    parser = argparse.ArgumentParser(description="Run the plugin's tests in a scratch copy.")
    parser.add_argument('--windows-roots', action='store_true', help='run representative tests with simulated Windows engine roots')
    parser.add_argument('--plugin-source', help=argparse.SUPPRESS)
    parser.add_argument('--keep', action='store_true', help='keep the scratch folder and print its path')
    parser.add_argument('--claude', help='path to the claude binary')
    args = parser.parse_args()

    # Asset assertions need real files; the engine test kit uses fixture PNGs instead.
    preflight = subprocess.run([sys.executable, os.path.join(ROOT, 'tools', 'tests', 'desktop-sprite.test.py')],
                               cwd=ROOT, timeout=30)
    if preflight.returncode != 0:
        return preflight.returncode

    claude = find_claude(args.claude)
    if not claude:
        sys.stderr.write('run-tests.py: claude CLI not found (set CLAUDE_BIN or --claude, or install Claude Code)\n')
        return 2
    plugin = os.path.abspath(args.plugin_source) if args.plugin_source else os.path.join(ROOT, 'plugin')
    tests = os.path.join(ROOT, 'tools', 'tests')
    for folder in (plugin, tests):
        if not os.path.isdir(folder):
            sys.stderr.write('run-tests.py: missing folder %s\n' % folder)
            return 2

    scratch = tempfile.mkdtemp(prefix=PREFIX)
    try:
        copy = os.path.join(scratch, 'plugin')
        shutil.copytree(plugin, copy, ignore=skip_engine_files(plugin))
        shutil.copytree(tests, os.path.join(copy, 'tests'), ignore=shutil.ignore_patterns('.DS_Store', '__pycache__', 'book-files.ts'))
        book_files(copy)
        source_files(copy)
        windows_roots(copy, args.windows_roots)

        home = os.path.join(scratch, 'home')
        os.makedirs(home)
        roaming = os.path.join(home, 'AppData', 'Roaming')
        local = os.path.join(home, 'AppData', 'Local')
        os.makedirs(roaming)
        os.makedirs(local)
        env = dict(os.environ, HOME=home, USERPROFILE=home, APPDATA=roaming, LOCALAPPDATA=local,
                   CLAUDE_CONFIG_DIR=os.path.join(home, '.claude'), DISABLE_AUTOUPDATER='1',
                   CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC='1')
        version = subprocess.run([claude, '--version'], capture_output=True, text=True, env=env, cwd=scratch)
        sys.stdout.write('claude CLI: %s\n' % (version.stdout.strip() or 'unknown'))
        sys.stdout.flush()
        try:
            run = subprocess.run([claude, 'plugin', 'test', copy], env=env, cwd=scratch, timeout=TIMEOUT)
        except subprocess.TimeoutExpired:
            sys.stderr.write('run-tests.py: claude plugin test took longer than %d s and was stopped\n' % TIMEOUT)
            return 1
        return run.returncode
    finally:
        if args.keep:
            sys.stdout.write('scratch folder kept: %s\n' % scratch)
        else:
            remove_scratch(scratch)


if __name__ == '__main__':
    sys.exit(main())
