#!/usr/bin/env python3
"""Script integration checks: fake HOME, compiler, processes and macOS operations only.

Run directly with python3 tools/tests/companion-script.test.py. No real app, TCC,
LaunchAgent, Trash or system application is touched. The kit runs TSX tests separately.
"""
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
LABEL = 'io.github.ninondev.claudesama-companion'
NAME = 'Claude-sama Companion'
EXE = 'claudesama-companion'
STUB = '''#!{python}
import json, os, pathlib, shutil, sys
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
with open(os.environ['STUB_LOG'], 'a') as log:
    log.write(json.dumps([name, *args]) + '\\n')
if name == 'uname':
    print(os.environ.get('FAKE_SYSTEM', 'Darwin'))
elif name == 'pgrep':
    sys.exit(1)
elif name == 'xcode-select':
    sys.exit(int(os.environ.get('FAKE_NO_TOOLS', '0')))
elif name == 'xcrun':
    if '--find' in args:
        if os.environ.get('FAKE_NO_SWIFTC'):
            sys.exit(1)
        print(str(pathlib.Path(sys.argv[0]).with_name('swiftc')))
    else:
        os.execv(str(pathlib.Path(sys.argv[0]).with_name('swiftc')), ['swiftc', *args[args.index('swiftc') + 1:]])
elif name == 'swiftc':
    if args == ['-version']:
        print(os.environ.get('FAKE_SWIFT', 'Apple Swift version 6.4 (swiftlang-test)'))
        sys.exit(int(os.environ.get('FAKE_VERSION_FAIL', '0')))
    if os.environ.get('FAKE_BUILD_FAIL'):
        sys.exit(1)
    out = pathlib.Path(args[args.index('-o') + 1])
    out.write_text('fake compiler output')
    out.chmod(0o755)
elif name == 'trash':
    source = pathlib.Path(args[0])
    home = pathlib.Path(os.environ['HOME'])
    assert source.is_relative_to(home), 'only fake HOME is permitted'
    dest = home / '.Trash' / source.name
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        dest = dest.with_name(dest.name + '-again')
    shutil.move(source, dest)
elif name == 'plutil':
    if 'CFBundleShortVersionString' in args:
        print('0.1.0')
    else:
        sys.exit(1)
elif name == 'tccutil':
    sys.exit(int(os.environ.get('FAKE_TCC_FAIL', '0')))
'''


class ScriptChecks(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory(prefix='claudesama-script-', dir=os.environ.get('TMPDIR', '/private/tmp'))
        self.base = Path(self.scratch.name)
        # Special XML characters exercise the executable path, not just a plain fixture path.
        self.home = self.base / 'home & <test> "owner" \'name\''
        self.home.mkdir()
        self.plugin = self.base / 'plugin'
        self.script = self.plugin / 'bin' / 'companion-macos.sh'
        self.script.parent.mkdir(parents=True)
        shutil.copyfile(ROOT / 'plugin/bin/companion-macos.sh', self.script)
        for name, text in {
            'companion/Info.plist': '<plist><dict><key>Version</key><string>@VERSION@</string></dict></plist>',
            'companion/Sources/main.swift': '// fake source',
            'assets/desktop/01-idle-reading.png': 'fake painted frame',
            'assets/pixel/01-idle-reading.png': 'fake pixel frame',
            'assets/icon/claude-sama-1024.png': 'fake icon',
            '.claude-plugin/plugin.json': '{"version": "0.1.0"}',
        }.items():
            path = self.plugin / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)
        self.stub_bin = self.base / 'bin'
        self.stub_bin.mkdir()
        for name in ('uname', 'pgrep', 'open', 'launchctl', 'tccutil', 'xcode-select',
                     'softwareupdate', 'xcrun', 'swiftc', 'codesign', 'sips', 'iconutil',
                     'plutil', 'sleep', 'trash'):
            path = self.stub_bin / name
            path.write_text(STUB.format(python=sys.executable))
            path.chmod(0o755)
        self.log = self.base / 'calls.jsonl'
        self.log.touch()
        self.env = dict(os.environ, HOME=str(self.home), TMPDIR=str(self.base),
                        PATH=str(self.stub_bin) + ':/usr/bin:/bin', STUB_LOG=str(self.log))
        self.app = self.home / 'Applications' / (NAME + '.app')
        self.agent = self.home / 'Library/LaunchAgents' / (LABEL + '.plist')

    def tearDown(self):
        self.scratch.cleanup()

    def run_script(self, *args, **env):
        result = subprocess.run(['/bin/sh', str(self.script), *args], env=dict(self.env, **env),
                                capture_output=True, text=True, timeout=30)
        self.assertNotIn('syntax error', result.stderr)
        return result

    def calls(self, name=None):
        calls = [json.loads(line) for line in self.log.read_text().splitlines()]
        return [call for call in calls if name is None or call[0] == name]

    def installed_hash(self):
        return (self.app / 'Contents/Resources/build.txt').read_text().strip()

    def assert_report(self, result, status, code):
        self.assertEqual(result.returncode, code, result.stdout + result.stderr)
        self.assertEqual(result.stdout.splitlines()[-1], 'result: ' + status)
        self.assertEqual(sum(line.startswith('result:') for line in result.stdout.splitlines()), 1)

    def test_missing_tools(self):
        result = self.run_script('install', '--report', FAKE_NO_TOOLS='1')
        self.assert_report(result, 'no-tools', 3)
        self.assertIn('xcode-select --install', result.stderr)
        self.assertEqual(self.calls('swiftc'), [])
        self.assertFalse(self.app.exists())

    def test_missing_selected_swiftc(self):
        self.assert_report(self.run_script('install', '--report', FAKE_NO_SWIFTC='1'), 'no-tools', 3)

    def test_swift_58_fails_before_build(self):
        result = self.run_script('install', '--report', FAKE_SWIFT='Apple Swift version 5.8.1 (swiftlang-test)')
        self.assert_report(result, 'old-tools', 4)
        self.assertIn('Xcode 15', result.stderr)
        self.assertIn('Software Update', result.stderr)
        self.assertEqual(self.calls('swiftc'), [['swiftc', '-version']])
        self.assertFalse(self.app.exists())

    def test_swift_59_passes(self):
        self.assert_report(self.run_script('install', '--login', '--report', FAKE_SWIFT='Apple Swift version 5.9.2 (swiftlang-test)'), 'ok', 0)
        self.assertTrue(self.app.exists())
        self.assertEqual(self.calls('tccutil'), [])

    def test_swift_64_passes(self):
        self.assert_report(self.run_script('install', '--login', '--report', FAKE_SWIFT='Swift version 6.4 (swiftlang-test)'), 'ok', 0)
        compile_calls = [args for args in self.calls('swiftc') if args[1:] != ['-version']]
        self.assertEqual(len(compile_calls), 1)
        args = compile_calls[0]
        self.assertEqual(args[args.index('-swift-version') + 1], '5')

    def test_data_folder_private_on_install_and_reinstall(self):
        folder = self.home / 'Library/Application Support/Claude-sama'
        self.assert_report(self.run_script('install', '--login', '--report'), 'ok', 0)
        self.assertEqual(folder.stat().st_mode & 0o777, 0o700)
        folder.chmod(0o755)
        self.assert_report(self.run_script('install', '--login', '--report'), 'ok', 0)
        self.assertEqual(folder.stat().st_mode & 0o777, 0o700)

    def test_unreadable_version_fails_clearly(self):
        result = self.run_script('install', '--report', FAKE_SWIFT='unknown compiler text')
        self.assert_report(result, 'old-tools', 4)
        self.assertIn("could not read swiftc's version", result.stderr)
        self.assertIn('Swift 5.9 or newer', result.stderr)

    def test_failed_version_command(self):
        result = self.run_script('install', '--report', FAKE_VERSION_FAIL='1')
        self.assert_report(result, 'old-tools', 4)
        self.assertIn("could not read swiftc's version", result.stderr)

    def test_compile_failure(self):
        self.assert_report(self.run_script('install', '--report', FAKE_BUILD_FAIL='1'), 'failed', 2)
        self.assertFalse(self.app.exists())

    def test_hash_includes_icon_and_script_and_reuses_same_build(self):
        self.assert_report(self.run_script('install', '--login', '--report'), 'ok', 0)
        first = self.installed_hash()
        self.assert_report(self.run_script('install', '--login', '--report'), 'ok', 0)
        self.assertEqual(first, self.installed_hash())
        self.assertEqual(len([call for call in self.calls('swiftc') if '-o' in call]), 1)
        icon = self.plugin / 'assets/icon/claude-sama-1024.png'
        icon.write_text('changed fake icon')
        self.assert_report(self.run_script('install', '--login', '--report'), 'ok', 0)
        second = self.installed_hash()
        self.assertNotEqual(first, second)
        self.script.write_text(self.script.read_text() + '\n# changed script fixture\n')
        self.assert_report(self.run_script('install', '--login', '--report'), 'ok', 0)
        self.assertNotEqual(second, self.installed_hash())

    def test_plist_content(self):
        self.assert_report(self.run_script('install', '--login', '--report'), 'ok', 0)
        text = self.agent.read_text()
        self.assertTrue(text.endswith('</plist>\n'))
        self.assertIn('&amp;', text)
        self.assertIn('&lt;test&gt;', text)
        self.assertIn('&quot;owner&quot;', text)
        self.assertIn('&apos;name&apos;', text)
        self.assertEqual(plistlib.loads(text.encode()), {
            'Label': LABEL,
            'ProgramArguments': [str(self.app / 'Contents/MacOS' / EXE), '--login'],
            'RunAtLoad': True, 'KeepAlive': False, 'ProcessType': 'Interactive',
            'LimitLoadToSessionType': 'Aqua', 'AssociatedBundleIdentifiers': [LABEL],
        })

    def test_uninstall_resets_only_own_label(self):
        self.assert_report(self.run_script('install', '--login', '--report'), 'ok', 0)
        result = self.run_script('uninstall', '--report')
        self.assert_report(result, 'ok', 0)
        self.assertEqual(self.calls('tccutil'), [['tccutil', 'reset', 'Accessibility', LABEL]])
        self.assertIn('Reset its own Accessibility entry', result.stdout)
        self.assertFalse(self.agent.exists())
        self.assertFalse(self.app.exists())
        self.assertEqual(self.calls('open'), [])
        self.assertTrue(all(call[1:] == ['-f', NAME + '.app/Contents/MacOS/' + EXE] for call in self.calls('pgrep')))

    def test_reset_failure_is_failed(self):
        result = self.run_script('uninstall', '--report', FAKE_TCC_FAIL='1')
        self.assert_report(result, 'failed', 1)
        self.assertIn('could not reset its Accessibility entry', result.stderr)

    def test_not_mac(self):
        self.assert_report(self.run_script('status', '--report', FAKE_SYSTEM='Linux'), 'not-mac', 2)
        self.assertEqual(self.calls('pgrep'), [])

    def test_no_prompt_is_accepted_as_noop(self):
        result = self.run_script('install', '--login', '--no-prompt', '--report')
        self.assert_report(result, 'ok', 0)
        self.assertFalse(any('--no-prompt' in call for call in self.calls()))

    def test_default_human_output_has_no_report(self):
        result = self.run_script('status')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn('result:', result.stdout)
        self.assertIn('Installed:      no', result.stdout)


if __name__ == '__main__':
    unittest.main(verbosity=2)
