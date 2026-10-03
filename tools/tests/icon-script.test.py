#!/usr/bin/env python3
"""Icon report checks against copied scripts and temporary fixture applications only.

Every native icon/process utility is stubbed. Text/file utilities touch fixture paths only.
This verifies report/control flow, not real NSWorkspace rendering or Linux image decoding.
"""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
STUB = r'''#!PYTHON
import hashlib, json, os, pathlib, shutil, sys
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
base = pathlib.Path(os.environ['FIXTURE_ROOT'])
def fixture(path):
    value = pathlib.Path(path).resolve()
    assert value.is_relative_to(base), 'native stub may only inspect fixture paths'
    return value
with open(os.environ['STUB_LOG'], 'a') as log:
    log.write(json.dumps([name, *args]) + '\n')
if name == 'uname':
    print(os.environ['FAKE_SYSTEM'])
elif name == 'PlistBuddy':
    fixture(args[-1])
    print('fixture-version')
elif name == 'xattr':
    target = fixture(args[-1])
    if os.environ.get('FAKE_XATTR_FAIL'): sys.exit(1)
    flag = target / '.finderflag'
    if '-px' in args:
        if not flag.exists(): sys.exit(1)
        print('0000000000000000040000000000000000000000000000000000000000000000')
    elif flag.exists(): print('com.apple.FinderInfo')
elif name == 'osascript':
    values = args[args.index('-e') + 2:]
    if values[0] in ('apply', 'clear'):
        target = fixture(values[1])
        if os.environ.get('FAKE_APPLY_FAIL'):
            print('FAIL:fixture refusal')
        elif values[0] == 'apply':
            shutil.copyfile(fixture(values[2]), target / 'Icon\r')
            (target / '.finderflag').write_text('yes')
            print('OK')
        else:
            (target / 'Icon\r').unlink(missing_ok=True)
            (target / '.finderflag').unlink(missing_ok=True)
            print('OK')
    else:
        target, expected = map(fixture, values)
        if os.environ.get('FAKE_COMPARE'):
            print(os.environ['FAKE_COMPARE'])
        else:
            print('own' if (target / 'Icon\r').read_bytes() == expected.read_bytes() else 'custom')
elif name == 'sips':
    shutil.copyfile(fixture(args[3]), fixture(args[args.index('--out') + 1]))
elif name == 'iconutil':
    source = fixture(args[2]) / 'icon_512x512@2x.png'
    shutil.copyfile(source, fixture(args[args.index('-o') + 1]))
elif name in ('magick', 'convert'):
    if os.environ.get('FAKE_IMAGE_FAIL'): sys.exit(1)
    source = sys.stdin.buffer.read() if args[0] == '-' else fixture(args[0]).read_bytes()
    if args[-1] == 'info:':
        dimensions = '512x512' if source.startswith(b'512:') else '1024x1024'
        if source.startswith(b'512:'): source = source[4:]
        print(dimensions + ':' + hashlib.sha256(source).hexdigest())
    elif args[-1] == 'png:-':
        sys.stdout.buffer.write(b'512:' + source)
    else:
        fixture(args[-1]).write_bytes(b'512:' + source)
elif name == 'python3':
    # Import/image support deliberately absent. Never run Pillow or another native decoder.
    sys.exit(2)
elif name in ('killall', 'update-desktop-database'):
    pass
else:
    raise AssertionError('unexpected native utility ' + name)
'''


class IconReports(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory(prefix='claudesama-icon-', dir='/private/tmp')
        self.base = Path(self.scratch.name)
        self.plugin = self.base / 'plugin'
        self.bin = self.base / 'bin'
        self.bin.mkdir()
        for name in ('uname', 'PlistBuddy', 'xattr', 'osascript', 'sips', 'iconutil',
                     'magick', 'convert', 'python3', 'killall', 'update-desktop-database'):
            path = self.bin / name
            path.write_text(STUB.replace('PYTHON', sys.executable, 1))
            path.chmod(0o755)
        (self.plugin / 'bin').mkdir(parents=True)
        for name in ('icon-macos.sh', 'icon-linux.sh'):
            source = (ROOT / 'plugin/bin' / name).read_text()
            # Keep the native absolute utility inside the same stub boundary too.
            source = source.replace('/usr/libexec/PlistBuddy', str(self.bin / 'PlistBuddy'))
            (self.plugin / 'bin' / name).write_text(source)
        self.asset = self.plugin / 'assets/icon/claude-sama-1024.png'
        self.asset.parent.mkdir(parents=True)
        self.asset.write_bytes(b'fixture Claude-sama artwork')
        self.home = self.base / 'home with spaces'
        self.home.mkdir()
        self.app = self.home / 'Claude.app'
        (self.app / 'Contents').mkdir(parents=True)
        (self.app / 'Contents/Info.plist').write_text('fixture plist')
        self.data = self.home / '.local/share'
        self.user_apps = self.data / 'applications'
        self.user_apps.mkdir(parents=True)
        self.system_data = self.base / 'system'
        self.system_apps = self.system_data / 'applications'
        self.system_apps.mkdir(parents=True)
        self.launcher = self.system_apps / 'claude.desktop'
        self.launcher.write_text('[Desktop Entry]\nType=Application\nName=Claude\nExec=claude\nIcon=claude\n')
        self.override = self.user_apps / self.launcher.name
        self.copy = self.data / 'claude-sama/icons/claude-sama.png'
        self.log = self.base / 'calls.jsonl'
        self.log.touch()
        self.env = dict(os.environ, HOME=str(self.home), TMPDIR=str(self.base),
                        PATH=str(self.bin) + ':/usr/bin:/bin', FIXTURE_ROOT=str(self.base),
                        STUB_LOG=str(self.log), XDG_DATA_HOME=str(self.data),
                        XDG_DATA_DIRS=str(self.system_data))

    def tearDown(self):
        self.scratch.cleanup()

    def run_script(self, system, *args, **env):
        name = 'icon-macos.sh' if system == 'Darwin' else 'icon-linux.sh'
        extra = ['--app', str(self.app)] if system == 'Darwin' else ['--launcher', self.launcher.name]
        result = subprocess.run(['/bin/sh', str(self.plugin / 'bin' / name), *args, *extra],
                                env=dict(self.env, FAKE_SYSTEM=system, **env),
                                capture_output=True, text=True, timeout=30)
        self.assertNotIn('syntax error', result.stderr)
        return result

    def assert_report(self, result, state, code=0):
        self.assertEqual(result.returncode, code, result.stdout + result.stderr)
        self.assertEqual(result.stdout, 'icon: ' + state + '\n')

    def own_mac(self, artwork=None):
        (self.app / 'Icon\r').write_bytes(artwork or self.asset.read_bytes())
        (self.app / '.finderflag').write_text('yes')

    def own_linux(self):
        self.copy.parent.mkdir(parents=True, exist_ok=True)
        self.copy.write_bytes(self.asset.read_bytes())
        self.override.write_text('# claude-sama-icon-override: old installation\n' +
                                 self.launcher.read_text().replace('Icon=claude', 'Icon=' + str(self.copy)))

    def test_mac_stock(self):
        self.assert_report(self.run_script('Darwin', 'status', '--report'), 'stock')

    def test_jxa_source_has_valid_javascript_syntax_without_execution(self):
        node = shutil.which('node')
        if not node:
            self.skipTest('node is unavailable for static JavaScript parsing')
        source = (ROOT / 'plugin/bin/icon-macos.sh').read_text()
        for variable in ('JXA', 'JXA_COMPARE'):
            match = re.search(variable + r"='([\s\S]*?)\n'", source)
            self.assertIsNotNone(match)
            script = self.base / (variable + '.js')
            script.write_text(match[1])
            result = subprocess.run([node, '--check', str(script)], capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_mac_existing_own_without_receipt(self):
        self.own_mac()
        self.assert_report(self.run_script('Darwin', 'status', '--report'), 'own')

    def test_mac_another_custom(self):
        self.own_mac(b'another image')
        self.assert_report(self.run_script('Darwin', 'status', '--report'), 'custom')

    def test_mac_inconsistent_markers_unknown(self):
        (self.app / 'Icon\r').write_text('orphan icon')
        self.assert_report(self.run_script('Darwin', 'status', '--report'), 'unknown', 1)

    def test_mac_denied_read_and_render_unknown(self):
        self.assert_report(self.run_script('Darwin', 'status', '--report', FAKE_XATTR_FAIL='1'), 'unknown', 1)
        self.own_mac()
        self.assert_report(self.run_script('Darwin', 'status', '--report', FAKE_COMPARE='unknown'), 'unknown', 1)

    def test_mac_apply_and_clear(self):
        self.assert_report(self.run_script('Darwin', 'apply', '--report'), 'own')
        self.assert_report(self.run_script('Darwin', 'clear', '--report'), 'stock')

    def test_mac_apply_failure(self):
        self.assert_report(self.run_script('Darwin', 'apply', '--report', FAKE_APPLY_FAIL='1'), 'unknown', 1)
        self.assertFalse((self.app / 'Icon\r').exists())

    def test_mac_dry_run_does_not_claim_install(self):
        self.assert_report(self.run_script('Darwin', 'apply', '--dry-run', '--report'), 'stock')
        self.assertFalse((self.app / 'Icon\r').exists())

    def test_human_output_remains_default(self):
        result = self.run_script('Darwin', 'status')
        self.assertEqual(result.returncode, 0)
        self.assertIn('State:', result.stdout)
        self.assertNotIn('icon:', result.stdout)

    def test_linux_packaged_stock(self):
        self.assert_report(self.run_script('Linux', 'status', '--report'), 'stock')

    def test_linux_existing_own_without_receipt(self):
        self.own_linux()
        self.assert_report(self.run_script('Linux', 'status', '--report'), 'own')

    def test_linux_user_override_custom_and_apply_refused(self):
        self.override.write_text(self.launcher.read_text().replace('Icon=claude', 'Icon=user-picture'))
        before = self.override.read_bytes()
        self.assert_report(self.run_script('Linux', 'status', '--report'), 'custom')
        self.assert_report(self.run_script('Linux', 'apply', '--report'), 'unknown', 2)
        self.assertEqual(self.override.read_bytes(), before)

    def test_linux_edited_marked_override_preserved(self):
        self.own_linux()
        self.override.write_text(self.override.read_text().replace(str(self.copy), 'user-picture'))
        before = self.override.read_bytes()
        self.assert_report(self.run_script('Linux', 'status', '--report'), 'custom')
        self.assert_report(self.run_script('Linux', 'clear', '--report'), 'custom', 1)
        self.assertEqual(self.override.read_bytes(), before)
        self.assertTrue(self.copy.exists())

    def test_linux_modified_copy_not_own(self):
        self.own_linux()
        self.copy.write_text('another image')
        self.assert_report(self.run_script('Linux', 'status', '--report'), 'custom')

    def test_linux_unverifiable_copy_unknown(self):
        self.own_linux()
        self.copy.write_text('resized fixture')
        self.assert_report(self.run_script('Linux', 'status', '--report', FAKE_IMAGE_FAIL='1'), 'unknown', 1)

    def test_linux_missing_copy_unknown(self):
        self.own_linux()
        self.copy.unlink()
        self.assert_report(self.run_script('Linux', 'status', '--report'), 'unknown', 1)

    def test_linux_apply_scaled_copy_and_clear(self):
        self.assert_report(self.run_script('Linux', 'apply', '--report'), 'own')
        self.assertTrue(self.copy.read_bytes().startswith(b'512:'))
        self.assert_report(self.run_script('Linux', 'clear', '--report'), 'stock')
        self.assertFalse(self.override.exists())

    def test_linux_dry_run(self):
        self.assert_report(self.run_script('Linux', 'apply', '--dry-run', '--report'), 'stock')
        self.assertFalse(self.override.exists())
        self.assertFalse(self.copy.exists())

    def test_linux_explicit_replace_and_restore_preserve_user_fields(self):
        user = '# owner comment\n[Desktop Entry]\nType=Application\nName=Claude owner\nExec=claude --owner\nIcon=owner-picture\nActions=owner;\n\n[Desktop Action owner]\nName=Owner\nIcon=action-icon\nExec=owner-command\n'
        self.override.write_text(user)
        applied_result = self.run_script('Linux', 'apply', '--replace-custom', '--report')
        self.assert_report(applied_result, 'own')
        self.assertIn('clear --replace-custom', applied_result.stderr)
        applied = self.override.read_text()
        self.assertIn('Name=Claude owner\nExec=claude --owner\n', applied)
        self.assertIn('Icon=action-icon\nExec=owner-command\n', applied)
        self.assertIn('# owner comment\n', applied)
        self.assert_report(self.run_script('Linux', 'clear', '--replace-custom', '--report'), 'stock')
        self.assertEqual(self.override.read_text(), user.replace('Icon=owner-picture', 'Icon=claude'))
        self.assertFalse(self.copy.exists())

    def test_linux_explicit_replace_edited_managed_override(self):
        self.own_linux()
        user = self.override.read_text().replace(str(self.copy), 'owner-picture').replace('Exec=claude\n', 'Exec=claude --owner\n')
        self.override.write_text(user)
        self.assert_report(self.run_script('Linux', 'apply', '--replace-custom', '--report'), 'own')
        self.assertIn('Exec=claude --owner\n', self.override.read_text())
        self.assert_report(self.run_script('Linux', 'clear', '--replace-custom', '--report'), 'stock')
        restored = self.override.read_text()
        self.assertIn('Exec=claude --owner\n', restored)
        self.assertIn('Icon=claude\n', restored)
        self.assertNotIn('claude-sama-icon-', restored)

    def test_linux_default_clear_preserves_explicitly_adopted_launcher(self):
        self.override.write_text(self.launcher.read_text().replace('Name=Claude', 'Name=Claude owner'))
        self.assert_report(self.run_script('Linux', 'apply', '--replace-custom', '--report'), 'own')
        before = self.override.read_bytes()
        self.assert_report(self.run_script('Linux', 'clear', '--report'), 'own', 1)
        self.assertEqual(self.override.read_bytes(), before)

    def test_linux_explicit_clear_custom_without_apply(self):
        user = self.launcher.read_text().replace('Icon=claude', 'Icon=owner-picture').replace('Exec=claude\n', 'Exec=claude --owner\n')
        self.override.write_text(user)
        self.assert_report(self.run_script('Linux', 'clear', '--replace-custom', '--report'), 'stock')
        self.assertEqual(self.override.read_text(), user.replace('Icon=owner-picture', 'Icon=claude'))

    def test_linux_no_packaged_original_preserves_custom_and_managed(self):
        self.override.write_text(self.launcher.read_text().replace('Icon=claude', 'Icon=owner-picture'))
        self.launcher.unlink()
        before = self.override.read_bytes()
        self.copy.parent.mkdir(parents=True, exist_ok=True)
        self.copy.write_text('previous managed picture')
        previous_copy = self.copy.read_bytes()
        self.assert_report(self.run_script('Linux', 'clear', '--replace-custom', '--report'), 'custom', 1)
        self.assertEqual(self.override.read_bytes(), before)
        self.assertEqual(self.copy.read_bytes(), previous_copy)
        self.assert_report(self.run_script('Linux', 'apply', '--replace-custom', '--report'), 'unknown', 2)
        self.assertEqual(self.override.read_bytes(), before)
        self.own_linux_without_package()
        before = self.override.read_bytes()
        self.assert_report(self.run_script('Linux', 'clear', '--replace-custom', '--report'), 'own', 1)
        self.assertEqual(self.override.read_bytes(), before)
        self.assertTrue(self.copy.exists())

    def own_linux_without_package(self):
        self.copy.parent.mkdir(parents=True, exist_ok=True)
        self.copy.write_bytes(self.asset.read_bytes())
        self.override.write_text('# claude-sama-icon-override: fixture\n[Desktop Entry]\nType=Application\nName=Claude\nExec=claude\nIcon=' + str(self.copy) + '\n')

    def test_invalid_argument_reports_unknown_once(self):
        for system in ('Darwin', 'Linux'):
            with self.subTest(system=system):
                self.assert_report(self.run_script(system, 'status', '--report', '--invalid'), 'unknown', 2)


if __name__ == '__main__':
    unittest.main(verbosity=2)
