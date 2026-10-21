#!/usr/bin/env python3
"""Linux destination guards, using only isolated scratch desktop entries."""
import os
from pathlib import Path
import shutil
import signal
import shlex
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / 'plugin/bin/icon-linux.sh'


class LinuxIconSecurity(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='i1-linux-security-')
        self.base = Path(self.tmp.name).resolve()
        self.home = self.base / 'home'
        self.home.mkdir()
        self.data = self.home / 'data'
        self.apps = self.data / 'applications'
        self.apps.mkdir(parents=True)
        self.icon = self.data / 'coco/icons/coco.png'
        self.icon.parent.mkdir(parents=True)
        self.package = self.base / 'package/applications/claude.desktop'
        self.package.parent.mkdir(parents=True)
        self.package.write_text('[Desktop Entry]\nType=Application\nName=Claude\nExec=claude\nIcon=claude\n')
        self.target = self.apps / 'claude.desktop'
        self.consent = self.home / 'state/app-icon-consent'
        self.consent.parent.mkdir()
        self.consent.write_text('on\n')
        self.env = dict(HOME=str(self.home), TMPDIR=str(self.base),
                        XDG_DATA_HOME=str(self.data), XDG_DATA_DIRS=str(self.package.parent.parent),
                        COCO_ICON_CONSENT_FILE=str(self.consent), COCO_ALLOW_ANY_OS='1',
                        COCO_LANGUAGE='en', PATH='/usr/bin:/bin:/usr/sbin:/sbin')
        self.script = SCRIPT

    def tearDown(self):
        self.tmp.cleanup()

    def run_icon(self, action='apply', *args):
        child = subprocess.Popen(['/bin/sh', str(self.script), action, '--launcher', str(self.package), *args],
                                 env=self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 text=True, start_new_session=True)
        try:
            stdout, stderr = child.communicate(timeout=8)
        except subprocess.TimeoutExpired:
            # Only this test's own newly created process group is terminated.
            os.killpg(child.pid, signal.SIGKILL)
            stdout, stderr = child.communicate()
            self.fail('icon command timed out; own child group reaped: ' + stderr)
        return subprocess.CompletedProcess(child.args, child.returncode, stdout, stderr)

    def managed(self):
        self.target.write_text('# coco-icon-override: fixture\n' +
                               self.package.read_text().replace('Icon=claude', 'Icon=' + str(self.icon)))
        self.icon.write_bytes((ROOT / 'plugin/assets/icon/claude-tile-coco-512.png').read_bytes())

    def reject(self, action='apply', *args):
        r = self.run_icon(action, *args)
        self.assertNotEqual(r.returncode, 0, r.stdout + r.stderr)

    def outside(self):
        p = self.base / 'outside'
        p.mkdir()
        return p

    def test_anthropic_package_launcher_is_preferred_among_several(self):
        # Anthropic's Linux package (claude-desktop 2.42304.0) ships com.anthropic.Claude.desktop; with another
        # launcher that also looks like Claude, the official one is the one overridden.
        official = self.package.parent / 'com.anthropic.Claude.desktop'
        official.write_text('[Desktop Entry]\nName=Claude\nExec=claude-desktop %U\nIcon=claude-desktop\nType=Application\n'
                            'StartupWMClass=com.anthropic.Claude\n')
        r = subprocess.run(['/bin/sh', str(self.script), 'apply'], env=self.env, capture_output=True, text=True, timeout=8)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        written = self.apps / 'com.anthropic.Claude.desktop'
        self.assertTrue(written.is_file(), sorted(p.name for p in self.apps.iterdir()))
        self.assertFalse(self.target.exists())
        text = written.read_text()
        self.assertIn('Icon=' + str(self.data / 'coco/icons/coco.png'), text)
        self.assertIn('StartupWMClass=com.anthropic.Claude', text)

    def test_launcher_link_apply_refused_even_explicit_replace(self):
        outside = self.outside() / 'victim.desktop'
        outside.write_bytes(self.package.read_bytes())
        before = outside.read_bytes()
        self.target.symlink_to(outside)
        self.reject('apply', '--replace-custom')
        self.assertTrue(self.target.is_symlink())
        self.assertEqual(outside.read_bytes(), before)
        self.assertFalse(self.icon.exists())

    def test_dangling_launcher_link_refused(self):
        outside = self.outside() / 'absent'
        self.target.symlink_to(outside)
        self.reject()
        self.assertTrue(self.target.is_symlink())
        self.assertFalse(outside.exists())

    def test_icon_link_never_truncates_outside(self):
        outside = self.outside() / 'victim.png'
        outside.write_bytes(b'keep outside')
        self.icon.symlink_to(outside)
        self.reject()
        self.assertEqual(outside.read_bytes(), b'keep outside')
        self.assertFalse(self.target.exists())

    def test_linked_launcher_folder_refused(self):
        self.apps.rmdir()
        outside = self.outside()
        self.apps.symlink_to(outside, target_is_directory=True)
        self.reject()
        self.assertEqual(list(outside.iterdir()), [])
        self.assertFalse(self.icon.exists())

    def test_linked_icon_folder_refused_before_launcher_write(self):
        self.icon.parent.rmdir()
        outside = self.outside()
        self.icon.parent.symlink_to(outside, target_is_directory=True)
        self.reject()
        self.assertEqual(list(outside.iterdir()), [])
        self.assertFalse(self.target.exists())

    def test_linked_data_ancestor_refused(self):
        shutil.rmtree(self.data)
        outside = self.outside()
        self.data.symlink_to(outside, target_is_directory=True)
        self.reject()
        self.assertEqual(list(outside.iterdir()), [])

    def test_clear_linked_launcher_folder_refused(self):
        self.managed()
        outside = self.outside()
        shutil.move(str(self.target), outside / self.target.name)
        self.apps.rmdir()
        self.apps.symlink_to(outside, target_is_directory=True)
        before = (outside / self.target.name).read_bytes()
        self.reject('clear')
        self.assertEqual((outside / self.target.name).read_bytes(), before)
        self.assertTrue(self.icon.exists())

    def test_clear_linked_launcher_leaf_refused(self):
        self.managed()
        outside = self.outside() / 'victim.desktop'
        shutil.move(str(self.target), outside)
        self.target.symlink_to(outside)
        self.reject('clear')
        self.assertTrue(self.target.is_symlink())
        self.assertTrue(outside.exists())
        self.assertTrue(self.icon.exists())

    def test_restore_linked_launcher_refused(self):
        self.managed()
        outside = self.outside() / 'victim.desktop'
        shutil.move(str(self.target), outside)
        before = outside.read_bytes()
        self.target.symlink_to(outside)
        self.reject('clear', '--replace-custom')
        self.assertTrue(self.target.is_symlink())
        self.assertEqual(outside.read_bytes(), before)

    def test_regular_target_and_folder_required(self):
        self.target.mkdir()
        self.reject('apply', '--replace-custom')
        self.assertTrue(self.target.is_dir())
        self.target.rmdir()
        self.icon.parent.rmdir()
        self.icon.parent.write_bytes(b'not a folder')
        self.reject()
        self.assertFalse(self.target.exists())

    def test_fifo_target_refused_without_open(self):
        os.mkfifo(self.icon)
        self.reject()
        self.assertFalse(self.target.exists())

    def test_hardlinked_icon_refused_without_changing_peer(self):
        outside = self.outside() / 'victim.png'
        outside.write_bytes(b'keep outside')
        os.link(outside, self.icon)
        self.reject()
        self.assertEqual(outside.read_bytes(), b'keep outside')
        self.assertFalse(self.target.exists())

    def foreign_stat_seam(self, path):
        # No real chown is available in this sandbox. Only this copied script's
        # one path's UID metadata is synthetic; every other stat is the OS tool.
        plugin = self.base / 'plugin'
        (plugin / 'bin').mkdir(parents=True)
        shutil.copytree(ROOT / 'plugin/assets/icon', plugin / 'assets/icon')
        helper = self.base / 'foreign-stat'
        self.foreign_seen = self.base / 'foreign-stat-seen'
        helper.write_text('#!/bin/sh\nstyle=$1; format=$2; shift 2\n' +
                          'for path do\n' +
                          '  if [ "$path" = ' + shlex.quote(str(path)) + ' ]; then\n' +
                          "    printf '%s|%s\\n' \"$path\" \"$format\" >> " + shlex.quote(str(self.foreign_seen)) + '\n' +
                          '    case "$format" in\n' +
                          "      '%u:%h'|'%u:%l') printf '%s\\n' '4294967294:1'; continue ;;\n" +
                          "      '%u:%a'|'%u:%p'|'%u:%Lp') printf '%s\\n' '4294967294:755'; continue ;;\n" +
                          '    esac\n  fi\n' +
                          '  /usr/bin/stat "$style" "$format" "$path" || exit $?\n' +
                          'done\n')
        helper.chmod(0o755)
        source = SCRIPT.read_text()
        source = source.replace('/usr/bin/stat', str(helper))
        source = source.replace('$(stat ', '$(' + str(helper) + ' ')
        self.script = plugin / 'bin/icon-linux.sh'
        self.script.write_text(source)

    def test_foreign_leaf_uid_metadata_seam(self):
        self.managed()
        self.foreign_stat_seam(self.target)
        before = self.target.read_bytes(), self.icon.read_bytes()
        self.reject('apply', '--replace-custom')
        self.assertEqual(self.foreign_seen.read_text().splitlines(),
                         [str(self.target) + '|' + ('%u:%l' if sys.platform == 'darwin' else '%u:%h')])
        self.assertEqual((self.target.read_bytes(), self.icon.read_bytes()), before)
        self.reject('clear', '--replace-custom')
        self.assertEqual(len(self.foreign_seen.read_text().splitlines()), 2)
        self.assertEqual((self.target.read_bytes(), self.icon.read_bytes()), before)

    def test_foreign_folder_uid_metadata_seam(self):
        self.managed()
        self.foreign_stat_seam(self.apps)
        before = self.target.read_bytes(), self.icon.read_bytes()
        self.reject('apply', '--replace-custom')
        self.assertEqual(self.foreign_seen.read_text().splitlines(),
                         [str(self.apps) + '|' + ('%u:%p' if sys.platform == 'darwin' else '%u:%a')])
        self.assertEqual((self.target.read_bytes(), self.icon.read_bytes()), before)
        self.reject('clear')
        self.assertEqual(len(self.foreign_seen.read_text().splitlines()), 2)
        self.assertEqual((self.target.read_bytes(), self.icon.read_bytes()), before)

    def test_owned_unmanaged_launcher_is_not_silently_adopted(self):
        self.target.write_text(self.package.read_text().replace('Icon=claude', 'Icon=owner-picture'))
        before = self.target.read_bytes()
        self.reject()
        self.assertEqual(self.target.read_bytes(), before)
        self.assertFalse(self.icon.exists())

    def test_group_writable_owned_folder_is_refused(self):
        self.apps.chmod(0o775)
        self.reject()
        self.assertFalse(self.target.exists())
        self.assertFalse(self.icon.exists())

    def test_metadata_tool_failure_reports_unknown_without_mutation(self):
        plugin = self.base / 'fault-plugin'
        (plugin / 'bin').mkdir(parents=True)
        shutil.copytree(ROOT / 'plugin/assets/icon', plugin / 'assets/icon')
        helper = self.base / 'failed-tool'
        helper.write_text('#!/bin/sh\nexit 1\n')
        helper.chmod(0o755)
        for tool in ('id', 'stat'):
            source = SCRIPT.read_text().replace('/usr/bin/' + tool, str(helper))
            self.script = plugin / 'bin/icon-linux.sh'
            self.script.write_text(source)
            for action in ('apply', 'status', 'clear'):
                with self.subTest(tool=tool, action=action):
                    before = self.consent.read_bytes()
                    r = self.run_icon(action, '--report')
                    self.assertNotEqual(r.returncode, 0, r.stdout + r.stderr)
                    self.assertEqual(r.stdout, 'icon: unknown\n')
                    self.assertEqual(self.consent.read_bytes(), before)
                    self.assertFalse(self.icon.exists())
                    self.assertFalse(self.target.exists())

    @unittest.skipUnless(sys.platform == 'darwin', 'BSD stat sticky-mode regression')
    def test_real_root_sticky_ancestor_is_allowed_read_only(self):
        # /private/tmp is read only here; the harness itself stays in TMPDIR.
        source = SCRIPT.read_text().split('usage() {', 1)[0]
        self.script = self.base / 'sticky-guard.sh'
        self.script.write_text(source + '\ncheck_ancestors /private/tmp\n')
        r = self.run_icon('status')
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_incomplete_batch_metadata_refused(self):
        # Single-path calls pass through, so the earlier non-batched guard applies.
        # A batch loses exactly its final row; cardinality must fail closed.
        plugin = self.base / 'plugin'
        (plugin / 'bin').mkdir(parents=True)
        shutil.copytree(ROOT / 'plugin/assets/icon', plugin / 'assets/icon')
        helper = self.base / 'short-stat'
        helper.write_text('#!/bin/sh\n' +
                          'if [ "$#" -le 3 ]; then exec /usr/bin/stat "$@"; fi\n' +
                          'style=$1; format=$2; shift 2\ncount=0; total=$#\n' +
                          'for path do\n  count=$((count+1))\n' +
                          '  [ "$count" -lt "$total" ] || continue\n' +
                          '  /usr/bin/stat "$style" "$format" "$path" || exit $?\n' +
                          'done\n')
        helper.chmod(0o755)
        source = SCRIPT.read_text().replace('/usr/bin/stat', str(helper))
        self.script = plugin / 'bin/icon-linux.sh'
        self.script.write_text(source)
        self.reject()
        self.assertFalse(self.icon.exists())
        self.assertFalse(self.target.exists())

    def test_success_atomic_icon_replacement_keeps_owned_launcher(self):
        self.icon.write_bytes(b'old own copy')
        before = self.icon.stat().st_ino
        r = self.run_icon()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertNotEqual(before, self.icon.stat().st_ino)
        self.assertEqual(self.icon.read_bytes(), (ROOT / 'plugin/assets/icon/claude-tile-coco-512.png').read_bytes())
        self.assertEqual(self.target.stat().st_uid, os.getuid())
        self.assertEqual(list(self.apps.glob('.coco.*')), [])
        self.assertEqual(list(self.icon.parent.glob('.coco.*')), [])
        self.assertEqual(self.run_icon('clear').returncode, 0)
        self.assertFalse(self.icon.exists())
        self.assertFalse(self.target.exists())

    def test_choice_puts_that_picture_on_and_any_of_the_four_is_own(self):
        # DECISIONS 932, 935 to 937: four pictures; status knows each of them, and the earlier badge is legacy.
        r = self.run_icon('apply', '--choice', 'dake')
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(self.icon.read_bytes(), (ROOT / 'plugin/assets/icon/claude-tile-dake-512.png').read_bytes())
        for choice in ('coco', 'dake', 'keycap', 'ornament'):
            with self.subTest(choice=choice):
                s = self.run_icon('status', '--report', '--choice', choice)
                self.assertEqual(s.stdout, 'icon: own\n', s.stderr)
        self.icon.write_bytes((ROOT / 'plugin/assets/icon/claude-tile-512.png').read_bytes())
        self.assertEqual(self.run_icon('status', '--report').stdout, 'icon: legacy\n')

    def test_unknown_choice_is_refused_before_any_write(self):
        for choice in ('../coco', 'badge', '', 'coco/../dake'):
            with self.subTest(choice=choice):
                self.reject('apply', '--choice', choice)
                self.assertFalse(self.target.exists())
                self.assertFalse(self.icon.exists())

    def test_poisoned_path_not_executed(self):
        bad = self.base / 'poison'
        bad.mkdir()
        marker = self.base / 'executed'
        for name in ('cp', 'mv', 'chmod', 'mktemp', 'mkdir', 'stat', 'id', 'uname', 'awk', 'rm',
                     'update-desktop-database'):
            p = bad / name
            p.write_text('#!/bin/sh\nprintf poisoned >> ' + str(marker) + '\nexit 0\n')
            p.chmod(0o755)
        self.env['PATH'] = str(bad) + ':' + self.env['PATH']
        r = self.run_icon()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertFalse(marker.exists())


if __name__ == '__main__':
    unittest.main(verbosity=2)
