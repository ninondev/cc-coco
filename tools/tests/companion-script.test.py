#!/usr/bin/env python3
"""Script integration checks: fake HOME, compiler, processes and macOS operations only.

Run directly with python3 tools/tests/companion-script.test.py. No real app, TCC,
LaunchAgent, Trash or system application is touched. The kit runs TSX tests separately.
"""
import json
import hashlib
import importlib.util
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scratch import TemporaryDirectory

ROOT = Path(os.environ.get('COCO_PROMISES_ROOT', Path(__file__).resolve().parents[2]))
SOURCE = Path(os.environ.get('COMPANION_SCRIPT_FIXTURE_SOURCE', ROOT / 'plugin/bin/companion-macos.sh'))
LABEL = 'io.github.ninondev.coco-companion'
NAME = 'Coco Pet'
EXE = 'coco-companion'
STUB = '''#!{python}
import json, os, pathlib, plistlib, shutil, sys
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
with open(os.environ['STUB_LOG'], 'a') as log:
    log.write(json.dumps([name, *args]) + '\\n')
if name == 'uname':
    print(os.environ.get('FAKE_SYSTEM', 'Darwin'))
elif name == 'ps':
    print('1024')
elif name == 'footprint':
    print('phys_footprint: 1 MB')
elif name == 'pgrep':
    sys.exit(1)
elif name == 'companion-control':
    running = pathlib.Path(os.environ['STUB_LOG']).with_name('running')
    if args[0] == 'list':
        if running.exists(): print('4242')
        sys.exit(0)
    if args[0] == 'stop':
        if os.environ.get('FAKE_STOP_FAIL'): sys.exit(1)
        running.unlink(missing_ok=True)
        sys.exit(0)
    native = pathlib.Path(sys.argv[0]).with_name('companion-control-native')
    os.execv(str(native), [str(native), *args])
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
    try:
        with open(args[-1], 'rb') as stream: value = plistlib.load(stream)
        print(value[args[args.index('-extract') + 1]])
    except (OSError, ValueError, KeyError):
        if args[1] == 'pid' and pathlib.Path(os.environ['STUB_LOG']).with_name('running').exists():
            print('4242')
        else: sys.exit(1)
elif name == 'codesign':
    if '--verify' in args:
        if os.environ.get('FAKE_VERIFY_FAIL'): sys.exit(1)
        if os.environ.get('FAKE_STAGE_VERIFY_FAIL') and '.coco-companion.' in args[-1]: sys.exit(1)
elif name == 'security':
    assert args == ['delete-identity', '-c', 'Coco Pet Local Signing'], 'only legacy uninstall is allowed'
elif name == 'ditto':
    if os.environ.get('FAKE_COPY_FAIL'):
        pathlib.Path(args[1]).mkdir()
        sys.exit(1)
    shutil.copytree(args[0], args[1])
    if os.environ.get('FAKE_COPY_CORRUPT'):
        (pathlib.Path(args[1]) / 'Contents/Resources/build.txt').write_text('corrupt')
elif name == 'mv':
    if os.environ.get('FAKE_REPLACE_FAIL') and '.coco-companion.' in args[0] and args[0].endswith('/Coco Pet.app'):
        sys.exit(1)
    shutil.move(*args)
elif name == 'open' or (name == 'launchctl' and args[0] == 'bootstrap'):
    pathlib.Path(os.environ['STUB_LOG']).with_name('running').touch()
elif name == 'tccutil':
    sys.exit(int(os.environ.get('FAKE_TCC_FAIL', '0')))
'''


class ScriptChecks(unittest.TestCase):
    def setUp(self):
        self.scratch = TemporaryDirectory(prefix='coco-script-', dir=os.environ.get('TMPDIR', '/private/tmp'))
        self.base = Path(self.scratch.name).resolve()
        # Special XML characters exercise the executable path, not just a plain fixture path.
        self.home = self.base / 'home & <test> "owner" \'name\''
        self.home.mkdir()
        self.plugin = self.base / 'plugin'
        self.script = self.plugin / 'bin' / 'companion-macos.sh'
        self.script.parent.mkdir(parents=True)
        shutil.copyfile(SOURCE, self.script)
        for name, text in {
            'companion/Info.plist': (ROOT / 'plugin/companion/Info.plist').read_text(),
            'companion/Sources/main.swift': '// fake source',
            'assets/desktop/01-idle-reading.png': 'fake painted frame',
            'assets/pixel/01-idle-reading.png': 'fake pixel frame',
            'assets/icon/coco-1024.png': 'fake icon',
            'assets/icon/coco-16.png': 'fake small icon',
            'assets/icon/coco-32.png': 'fake small retina icon',
            'assets/icon/build-icns.sh': '#!/bin/sh\n: > "$2"\n',
            'assets/frame-manifest.json': '{}\n',
            'assets/companion-tuning.json': '{}\n',
            'assets/neighbours.json': '{}\n',
            'assets/patches/fixture/00.png': 'fake patch',
            '.claude-plugin/plugin.json': '{"version": "0.1.0"}',
        }.items():
            path = self.plugin / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)
        self.stub_bin = self.base / 'bin'
        self.stub_bin.mkdir()
        for name in ('uname', 'pgrep', 'open', 'launchctl', 'tccutil', 'xcode-select',
                     'softwareupdate', 'xcrun', 'swiftc', 'codesign', 'sips', 'iconutil',
                     'plutil', 'sleep', 'trash', 'security', 'ditto', 'mv', 'ps', 'footprint'):
            path = self.stub_bin / name
            path.write_text(STUB.format(python=sys.executable))
            path.chmod(0o755)
        # Production always uses trusted absolute paths. Rewrite only this private
        # fixture copy to use the fake operations; PATH never selects an authority.
        source = self.script.read_text()
        for name in ('uname', 'open', 'launchctl', 'tccutil', 'xcode-select', 'xcrun',
                     'codesign', 'sips', 'iconutil', 'plutil', 'sleep', 'trash', 'security', 'ditto', 'mv', 'ps', 'footprint'):
            source = re.sub(r'(?<![\w/])(?:/usr/bin/|/bin/)' + re.escape(name) + r'\b',
                            lambda _: '"' + str(self.stub_bin / name) + '"', source)
        self.script.write_text(source)
        native = Path(os.environ.get('S2_COMPANION_CONTROL', ROOT / 'plugin/bin/companion-control'))
        self.assertTrue(native.is_file(), 'build the companion-control fixture helper first')
        shutil.copyfile(native, self.script.parent / 'companion-control-native')
        (self.script.parent / 'companion-control-native').chmod(0o755)
        control = self.script.parent / 'companion-control'
        control.write_text(STUB.format(python=sys.executable)); control.chmod(0o755)
        self.log = self.base / 'calls.jsonl'
        self.log.touch()
        self.poison_bin = self.base / 'poison'; self.poison_bin.mkdir()
        for fixture in self.stub_bin.iterdir():
            poison = self.poison_bin / fixture.name
            poison.write_text('#!' + sys.executable + '\nimport json, os, sys\n'
                              + "with open(os.environ['STUB_LOG'], 'a') as log: log.write(json.dumps(['poison', "
                              + repr(fixture.name) + ']) + \"\\n\")\n'
                              + 'os.execv(' + repr(str(fixture)) + ', [' + repr(str(fixture)) + ', *sys.argv[1:]])\n')
            poison.chmod(0o755)
        self.env = dict(HOME=str(self.home), TMPDIR=str(self.base),
                        PATH=str(self.poison_bin) + ':/usr/bin:/bin', STUB_LOG=str(self.log),
                        CLAUDE_CONFIG_DIR=str(self.base / 'config'))
        self.app = self.home / 'Applications' / (NAME + '.app')
        self.agent = self.home / 'Library/LaunchAgents' / (LABEL + '.plist')
        self.packaged = self.script.parent / (NAME + '.app')
        self.make_package()

    def make_package(self):
        contents = self.packaged / 'Contents'
        (contents / 'MacOS').mkdir(parents=True, exist_ok=True)
        (contents / 'Resources').mkdir(exist_ok=True)
        executable = contents / 'MacOS' / EXE
        executable.write_text('packaged universal executable')
        executable.chmod(0o755)
        (contents / 'Info.plist').write_bytes(plistlib.dumps(dict(
            CFBundleIdentifier=LABEL, CFBundleExecutable=EXE,
            CFBundleVersion='0.1.0', CFBundleShortVersionString='0.1.0')))
        (contents / 'Resources/build.txt').write_text('a' * 64 + '\n')
        (contents / 'Resources/frame.bin').write_bytes(b'packaged picture')

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

    def assert_no_build_or_keychain(self):
        for name in ('swiftc', 'xcrun', 'xcode-select', 'security'):
            self.assertEqual(self.calls(name), [], name)
        self.assertTrue(all('--verify' in call for call in self.calls('codesign')))

    def test_prebuilt_without_compiler_or_keychain(self):
        self.assert_report(self.run_script('install', '--login', '--report', FAKE_NO_TOOLS='1'), 'ok', 0)
        self.assertEqual((self.app / 'Contents/MacOS' / EXE).read_text(), 'packaged universal executable')
        self.assertEqual(self.installed_hash(), 'a' * 64)
        self.assert_no_build_or_keychain()

    def test_missing_package_never_falls_back_to_source(self):
        self.packaged.rename(self.packaged.with_suffix('.missing'))
        result = self.run_script('install', '--report')
        self.assert_report(result, 'failed', 2)
        self.assertIn('complete macOS package', result.stderr)
        self.assertFalse(self.app.exists())
        self.assert_no_build_or_keychain()

    def test_identical_package_keeps_inode_without_stopping(self):
        self.assert_report(self.run_script('install', '--login', '--report'), 'ok', 0)
        inode = self.app.stat().st_ino
        self.log.write_text('')
        self.assert_report(self.run_script('install', '--login', '--report'), 'ok', 0)
        self.assertEqual(self.app.stat().st_ino, inode)
        self.assertEqual(self.calls('ditto'), [])
        self.assertEqual(self.calls('trash'), [])
        self.assertFalse(any(call[1] == 'stop' for call in self.calls('companion-control')))
        self.assert_no_build_or_keychain()

    def test_identical_package_starts_a_stopped_login_app(self):
        self.assert_report(self.run_script('install', '--login', '--report'), 'ok', 0)
        inode = self.app.stat().st_ino
        self.log.with_name('running').unlink()
        self.log.write_text('')
        self.assert_report(self.run_script('install', '--login', '--report'), 'ok', 0)
        self.assertEqual(self.app.stat().st_ino, inode)
        self.assertEqual(self.calls('open'), [['open', '-g', str(self.app)]])
        self.assertEqual(self.calls('ditto'), [])

    def test_changed_package_version_replaces_app(self):
        self.assert_report(self.run_script('install', '--login', '--report'), 'ok', 0)
        plist = self.packaged / 'Contents/Info.plist'
        info = plistlib.loads(plist.read_bytes())
        info['CFBundleVersion'] = info['CFBundleShortVersionString'] = '0.1.1'
        plist.write_bytes(plistlib.dumps(info))
        self.assert_report(self.run_script('install', '--login', '--report'), 'ok', 0)
        self.assertEqual(plistlib.loads((self.app / 'Contents/Info.plist').read_bytes())['CFBundleVersion'], '0.1.1')
        self.assert_no_build_or_keychain()

    def test_changed_resource_replaces_even_with_same_receipt_and_version(self):
        self.assert_report(self.run_script('install', '--login', '--report'), 'ok', 0)
        inode = self.app.stat().st_ino
        (self.packaged / 'Contents/Resources/frame.bin').write_bytes(b'new picture')
        self.log.write_text('')
        self.assert_report(self.run_script('install', '--login', '--report'), 'ok', 0)
        self.assertNotEqual(self.app.stat().st_ino, inode)
        self.assertEqual((self.app / 'Contents/Resources/frame.bin').read_bytes(), b'new picture')
        calls = self.calls()
        staged_check = next(i for i, c in enumerate(calls) if c[0] == 'codesign' and '.coco-companion.' in c[-1])
        stopped = next(i for i, c in enumerate(calls) if c[:2] == ['companion-control', 'stop'])
        self.assertLess(staged_check, stopped)
        self.assertEqual((self.home / '.Trash/previous.app/Contents/Resources/frame.bin').read_bytes(), b'packaged picture')
        self.assert_no_build_or_keychain()

    def test_bad_package_or_failed_staging_leaves_app_running_untouched(self):
        self.assert_report(self.run_script('install', '--login', '--report'), 'ok', 0)
        inode = self.app.stat().st_ino
        (self.packaged / 'Contents/Resources/frame.bin').write_bytes(b'new picture')
        for failure in ('FAKE_VERIFY_FAIL', 'FAKE_COPY_FAIL', 'FAKE_STAGE_VERIFY_FAIL', 'FAKE_COPY_CORRUPT'):
            with self.subTest(failure=failure):
                self.log.write_text('')
                result = self.run_script('install', '--login', '--report', **{failure: '1'})
                self.assert_report(result, 'failed', 2)
                self.assertEqual(self.app.stat().st_ino, inode)
                self.assertFalse(any(c[1] == 'stop' for c in self.calls('companion-control')))
                self.assertEqual(self.calls('trash'), [])
                self.assert_no_build_or_keychain()

    def test_failed_replacement_restores_previous_app(self):
        self.assert_report(self.run_script('install', '--login', '--report'), 'ok', 0)
        inode = self.app.stat().st_ino
        (self.packaged / 'Contents/Resources/frame.bin').write_bytes(b'new picture')
        self.assert_report(self.run_script('install', '--login', '--report', FAKE_REPLACE_FAIL='1'), 'failed', 2)
        self.assertEqual(self.app.stat().st_ino, inode)
        self.assertEqual((self.app / 'Contents/Resources/frame.bin').read_bytes(), b'packaged picture')
        self.assertEqual(list(self.app.parent.glob('.coco-companion.*')), [])

    def test_package_symlink_refused_before_install(self):
        (self.packaged / 'Contents/Resources/link').symlink_to(self.base / 'outside')
        self.assert_report(self.run_script('install', '--report'), 'failed', 2)
        self.assertFalse(self.app.exists())
        self.assert_no_build_or_keychain()

    def test_explicit_developer_build_uses_adhoc_only(self):
        self.packaged.rename(self.packaged.with_suffix('.missing'))
        self.assert_report(self.run_script('install', '--developer-build', '--login', '--report'), 'ok', 0)
        self.assertEqual((self.app / 'Contents/MacOS' / EXE).read_text(), 'fake compiler output')
        self.assertEqual(self.calls('security'), [])
        self.assertTrue(all(call[call.index('--sign') + 1] == '-' for call in self.calls('codesign')))

    def test_missing_tools(self):
        result = self.run_script('install', '--developer-build', '--report', FAKE_NO_TOOLS='1')
        self.assert_report(result, 'no-tools', 3)
        self.assertIn('xcode-select --install', result.stderr)
        self.assertEqual(self.calls('swiftc'), [])
        self.assertFalse(self.app.exists())

    def test_missing_selected_swiftc(self):
        self.assert_report(self.run_script('install', '--developer-build', '--report', FAKE_NO_SWIFTC='1'), 'no-tools', 3)

    def test_swift_58_fails_before_build(self):
        result = self.run_script('install', '--developer-build', '--report', FAKE_SWIFT='Apple Swift version 5.8.1 (swiftlang-test)')
        self.assert_report(result, 'old-tools', 4)
        self.assertIn('Xcode 15', result.stderr)
        self.assertIn('Software Update', result.stderr)
        self.assertEqual(self.calls('swiftc'), [['swiftc', '-version']])
        self.assertFalse(self.app.exists())

    def test_swift_59_passes(self):
        self.assert_report(self.run_script('install', '--developer-build', '--login', '--report', FAKE_SWIFT='Apple Swift version 5.9.2 (swiftlang-test)'), 'ok', 0)
        self.assertTrue(self.app.exists())
        self.assertEqual(self.calls('tccutil'), [])

    def test_swift_64_passes(self):
        self.assert_report(self.run_script('install', '--developer-build', '--login', '--report', FAKE_SWIFT='Swift version 6.4 (swiftlang-test)'), 'ok', 0)
        compile_calls = [args for args in self.calls('swiftc') if args[1:] != ['-version']]
        self.assertEqual(len(compile_calls), 1)
        args = compile_calls[0]
        self.assertEqual(args[args.index('-swift-version') + 1], '5')

    def test_data_folder_private_on_install_and_reinstall(self):
        folder = self.home / 'Library/Application Support/Coco'
        self.assert_report(self.run_script('install', '--login', '--report'), 'ok', 0)
        self.assertEqual(folder.stat().st_mode & 0o777, 0o700)
        folder.chmod(0o755)
        self.assert_report(self.run_script('install', '--login', '--report'), 'ok', 0)
        self.assertEqual(folder.stat().st_mode & 0o777, 0o700)

    def test_unreadable_version_fails_clearly(self):
        result = self.run_script('install', '--developer-build', '--report', FAKE_SWIFT='unknown compiler text')
        self.assert_report(result, 'old-tools', 4)
        self.assertIn("could not read swiftc's version", result.stderr)
        self.assertIn('Swift 5.9 or newer', result.stderr)

    def test_failed_version_command(self):
        result = self.run_script('install', '--developer-build', '--report', FAKE_VERSION_FAIL='1')
        self.assert_report(result, 'old-tools', 4)
        self.assertIn("could not read swiftc's version", result.stderr)

    def test_compile_failure(self):
        self.assert_report(self.run_script('install', '--developer-build', '--report', FAKE_BUILD_FAIL='1'), 'failed', 2)
        self.assertFalse(self.app.exists())

    def test_hash_includes_icon_and_script_and_reuses_same_build(self):
        self.assert_report(self.run_script('install', '--developer-build', '--login', '--report'), 'ok', 0)
        first = self.installed_hash()
        self.assert_report(self.run_script('install', '--developer-build', '--login', '--report'), 'ok', 0)
        self.assertEqual(first, self.installed_hash())
        self.assertEqual(len([call for call in self.calls('swiftc') if '-o' in call]), 1)
        icon = self.plugin / 'assets/icon/coco-1024.png'
        icon.write_text('changed fake icon')
        self.assert_report(self.run_script('install', '--developer-build', '--login', '--report'), 'ok', 0)
        second = self.installed_hash()
        self.assertNotEqual(first, second)
        self.script.write_text(self.script.read_text() + '\n# changed script fixture\n')
        self.assert_report(self.run_script('install', '--developer-build', '--login', '--report'), 'ok', 0)
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
        self.assertEqual(self.calls('security'), [['security', 'delete-identity', '-c', 'Coco Pet Local Signing']])
        self.assertIn('Reset its own Accessibility entry', result.stdout)
        self.assertFalse(self.agent.exists())
        self.assertFalse(self.app.exists())
        self.assertEqual(self.calls('open'), [])
        self.assertEqual(self.calls('pgrep'), [])
        identity = [str(self.app / 'Contents/MacOS' / EXE), str(self.home / 'Library/Application Support/Coco' / (NAME + '.app') / 'Contents/MacOS' / EXE)]
        probes = self.calls('companion-control')
        self.assertTrue(any(call[1] == 'list' for call in probes))
        self.assertTrue(all(call[2:] == identity for call in probes if call[1] in ('list', 'stop')))

    def test_E3_uninstall_moves_settings_and_app_to_fixture_trash(self):
        self.assert_report(self.run_script('install', '--login', '--report'), 'ok', 0)
        folder = self.home / 'Library/Application Support/Coco'
        (folder / 'settings.json').write_text('{"ownerFixture":"keep this content"}')
        (folder / 'view.json').write_text('{"fixture":"local excerpt"}')
        result = self.run_script('uninstall', '--report')
        self.assert_report(result, 'ok', 0)
        self.assertFalse(folder.exists())
        self.assertEqual((self.home / '.Trash/Coco/settings.json').read_text(), '{"ownerFixture":"keep this content"}')
        self.assertEqual((self.home / '.Trash/Coco/view.json').read_text(), '{"fixture":"local excerpt"}')
        self.assertTrue((self.home / '.Trash' / (NAME + '.app')).is_dir())
        self.assertEqual(sum(call == ['trash', str(self.app)] for call in self.calls('trash')), 1)
        self.assertEqual(sum(call == ['trash', str(folder)] for call in self.calls('trash')), 1)

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


    def test_agent_symlink_refused_without_touching_target(self):
        self.agent.parent.mkdir(parents=True)
        outside = self.base / 'outside-agent'; outside.write_text('outside fixture')
        self.agent.symlink_to(outside)
        result = self.run_script('install', '--login', '--report')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(outside.read_text(), 'outside fixture')
        self.assertTrue(self.agent.is_symlink())
        self.assertEqual([call for call in self.calls('launchctl') if call[1] == 'bootstrap'], [])

    def test_agent_hardlink_refused_without_touching_target(self):
        self.agent.parent.mkdir(parents=True)
        outside = self.base / 'outside-agent'; outside.write_text('outside fixture')
        os.link(outside, self.agent)
        result = self.run_script('install', '--login', '--report')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(outside.read_text(), 'outside fixture')
        self.assertEqual(self.agent.stat().st_ino, outside.stat().st_ino)

    def test_launchagent_directory_link_refused(self):
        self.agent.parent.parent.mkdir(parents=True)
        outside = self.base / 'outside-agents'; outside.mkdir()
        self.agent.parent.symlink_to(outside, target_is_directory=True)
        result = self.run_script('install', '--login', '--report')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(list(outside.iterdir()), [])

    def test_data_directory_link_refused(self):
        folder = self.home / 'Library/Application Support/Coco'
        folder.parent.mkdir(parents=True)
        outside = self.base / 'outside-data'; outside.mkdir(mode=0o755)
        folder.symlink_to(outside, target_is_directory=True)
        result = self.run_script('install', '--login', '--report')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(list(outside.iterdir()), [])
        self.assertEqual(outside.stat().st_mode & 0o777, 0o755)

    def test_poisoned_path_never_selects_management_programs(self):
        result = self.run_script('status')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.calls('pgrep'), [])
        self.assertEqual(self.calls('poison'), [])
        self.assertIn('PATH=/usr/bin:/bin:/usr/sbin:/sbin', SOURCE.read_text())
        self.assertIn('/usr/bin/uname -s', SOURCE.read_text())
        self.assertTrue(any(call[0] == 'companion-control' for call in self.calls()))


class HelpersOnlyChecks(unittest.TestCase):
    """Execute only pure text helpers; never execute the management script."""
    def test_plist_helpers(self):
        source = SOURCE.read_text()
        xml = re.search(r'^xml_text\(\) \{[^\n]+\}', source, re.M).group()
        agent = re.search(r'^agent_text\(\) \{.*?^\}', source, re.M | re.S).group()
        with TemporaryDirectory(prefix='companion-helpers-') as directory:
            binary = str(Path(directory) / 'A & <test> "owner" \'name\'')
            env = dict(PATH='/usr/bin:/bin:/usr/sbin:/sbin', HOME=directory, CLAUDE_CONFIG_DIR=str(Path(directory) / 'config'),
                       BIN=binary, LABEL=LABEL)
            result = subprocess.run(['/bin/sh', '-c', xml + '\n' + agent + '\nagent_text'],
                                    env=env, capture_output=True, text=True, check=True)
            self.assertEqual(plistlib.loads(result.stdout.encode()), {
                'Label': LABEL, 'ProgramArguments': [binary, '--login'],
                'RunAtLoad': True, 'KeepAlive': False, 'ProcessType': 'Interactive',
                'LimitLoadToSessionType': 'Aqua', 'AssociatedBundleIdentifiers': [LABEL],
            })

    def test_management_syntax_only(self):
        result = subprocess.run(['/bin/sh', '-n', str(ROOT / 'plugin/bin/companion-macos.sh')],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)


class BuildOnlyChecks(unittest.TestCase):
    """Exercise assembly and its receipt with fake tools; never compile or launch."""

    def test_reproducible_receipt_resources_and_universal_commands(self):
        spec = importlib.util.spec_from_file_location('mac_pet_builder', ROOT / 'tools/build-companion-macos.py')
        builder = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(builder)
        calls = []

        def fake_run(*args, **kwargs):
            args = [str(arg) for arg in args]
            calls.append(args)
            if args[0] == '/usr/bin/sips':
                Path(args[-1]).write_bytes(b'icon')
            elif args[0] == '/bin/sh':
                Path(args[-1]).write_bytes(b'icns')
            elif '--show-sdk-path' in args:
                return '/SDK'
            elif '--show-sdk-version' in args:
                return '27.2'
            elif '-version' in args:
                return 'Apple Swift version fixture'
            elif 'swiftc' in args:
                out = Path(args[args.index('-o') + 1])
                out.write_bytes(('binary ' + args[args.index('-target') + 1]).encode())
                out.chmod(0o755)
            elif args[:2] == ['/usr/bin/lipo', '-create']:
                Path(args[-1]).write_bytes(b'universal fixture')
            elif args[:2] == ['/usr/bin/lipo', '-archs']:
                return 'x86_64 arm64'
            return ''

        with TemporaryDirectory(prefix='coco-builder-') as directory, patch.object(builder, 'run', fake_run):
            first = builder.build(Path(directory) / 'first')
            second = builder.build(Path(directory) / 'another-path')
            receipts = [(app / 'Contents/Resources/build-receipt.json').read_bytes() for app in (first, second)]
            self.assertEqual(receipts[0], receipts[1])
            self.assertNotIn(str(directory).encode(), receipts[0])
            self.assertEqual((first / 'Contents/Resources/build.txt').read_text().strip(), hashlib.sha256(receipts[0]).hexdigest())
            for source, target in [('assets/desktop/01-idle-reading.png', 'frames/01-idle-reading.png'),
                                   ('assets/frame-manifest.json', 'frame-manifest.json'),
                                   ('companion-rs/assets/words/quota.json', 'words/quota.json')]:
                self.assertEqual((ROOT / 'plugin' / source).read_bytes(), (first / 'Contents/Resources' / target).read_bytes())
            compiles = [args for args in calls if 'swiftc' in args and '-o' in args]
            self.assertEqual([args[args.index('-target') + 1] for args in compiles], ['arm64-apple-macos13.0', 'x86_64-apple-macos13.0'] * 2)
            self.assertTrue(all('-file-prefix-map' in args for args in compiles))
            checks = [args for args in calls if '-archs' in args]
            self.assertEqual(len(checks), 2)
            self.assertFalse(any(args[0] in ('/usr/bin/open', '/usr/bin/security') for args in calls))
            before = list(calls)
            with self.assertRaisesRegex(ValueError, 'already exists'):
                builder.build(Path(directory) / 'first')
            self.assertEqual(calls, before)
            def missing_arch(*args, **kwargs):
                return 'arm64' if '-archs' in args else fake_run(*args, **kwargs)
            with patch.object(builder, 'run', missing_arch), self.assertRaisesRegex(ValueError, 'expected arm64 and x86_64'):
                builder.build(Path(directory) / 'missing-arch')


if __name__ == '__main__':
    if '--helpers-only' in sys.argv:
        print('Helpers only: install/uninstall/status integration cases were not run.', flush=True)
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(HelpersOnlyChecks)
        result = unittest.TextTestRunner(verbosity=2).run(suite)
        raise SystemExit(0 if result.wasSuccessful() else 1)
    unittest.main(verbosity=2)
