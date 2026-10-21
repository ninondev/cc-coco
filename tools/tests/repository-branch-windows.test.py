#!/usr/bin/env python3
"""Windows local fixture checks; host source checks do not prove Win32 behavior."""
import os
import json
from pathlib import Path
import re
import subprocess
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scratch import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = Path(os.environ.get('BRANCH_SCRIPT_FIXTURE_SOURCE', ROOT / 'plugin/bin/repository-branch.ps1'))

class SourceProtocol(unittest.TestCase):
    def test_static_native_reader_uses_pinned_nofollow_handles(self):
        source = SCRIPT.read_text()
        for required in ('CreateFileW', 'GetFileInformationByHandle', 'OpenReparse | BackupSemantics',
                         'ShareRead = 1', '(info.Attributes & Reparse) != 0', 'info.Links != 1',
                         'info.SizeLow > Limit', 'new byte[Limit + 1]', 'new UTF8Encoding(false, true)',
                         'streams.Add(stream)', 'foreach (var stream in streams) stream.Dispose()'):
            self.assertIn(required, source)
        for forbidden in ('ReadToEnd', 'ReadAllText', 'File.Read', 'Get-Content', 'Invoke-Expression',
                          'Start-Process', 'FILE_SHARE_DELETE =', 'System.Environment'):
            self.assertNotIn(forbidden, source)
        self.assertIn('const string prefix = "ref: refs/heads/"', source)
        self.assertIn('pin.DirectoryPath(common)', source)
        self.assertIn('if (!Equal(backlink, marker))', source)
        self.assertIn('if (!Equal(common, expected))', source)

    def test_every_open_binds_physical_parent_before_content_read(self):
        source = SCRIPT.read_text()
        self.assertIn('GetFinalPathNameByHandleW(handle, path, (uint)path.Capacity, 2)', source)
        self.assertIn('length == 0 || length >= path.Capacity', source)
        self.assertIn('Dictionary<string, string> directories', source)
        opened = source.split('public SafeFileHandle Open(', 1)[1].split('public void DirectoryPath(', 1)[0]
        self.assertIn('string physical = PhysicalPath(handle)', opened)
        self.assertIn('directories.TryGetValue(Path.GetDirectoryName(path), out parent)', opened)
        self.assertIn('!Equal(PhysicalParent(physical), parent)', opened)
        self.assertLess(opened.index('!Equal(PhysicalParent(physical), parent)'), opened.index('handles.Add(handle)'))
        text = source.split('public string Text(', 1)[1].split('public void Dispose()', 1)[0]
        self.assertLess(text.index('Open(path, false, false, out info)'), text.index('new FileStream(handle'))
        self.assertLess(text.index('new FileStream(handle'), text.index('stream.Read('))
        self.assertNotIn('QueryDosDevice', source)

@unittest.skipUnless(os.name == 'nt', 'requires Windows; source checks alone are not runtime acceptance')
class WindowsFixtures(unittest.TestCase):
    def setUp(self):
        self.scratch = TemporaryDirectory(prefix='s2-win-branch-')
        self.base = Path(self.scratch.name)
        self.repo = self.base / 'repository'; self.repo.mkdir()
        self.git = self.repo / '.git'; self.git.mkdir()
        (self.git / 'HEAD').write_text('ref: refs/heads/fixture-branch\n', encoding='utf-8')
        root = os.environ.get('SystemRoot', '')
        self.powershell = Path(root) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
        self.assertTrue(self.powershell.is_file())
        self.env = {'SystemRoot': root, 'HOME': str(self.base), 'USERPROFILE': str(self.base),
                    'TEMP': str(self.base), 'TMP': str(self.base),
                    'CLAUDE_CONFIG_DIR': str(self.base / 'config')}

    def tearDown(self):
        self.scratch.cleanup()

    def read(self, folder=None, script=None):
        return subprocess.run([str(self.powershell), '-NoProfile', '-NonInteractive', '-File',
                               str(script or SCRIPT), '-Cwd', str(folder or self.repo)],
                              env=self.env, capture_output=True, text=True, encoding='utf-8', timeout=30)

    def redirected_reader(self, requested, target):
        # Test-only copy replaces Win32 path resolution at exactly one owned path.
        # Real handles, metadata and physical-path queries remain unchanged. No
        # actual drive alias or process environment is modified by this fixture.
        source = SCRIPT.read_text()
        declaration = ('[DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]\n'
                       '    static extern SafeFileHandle CreateFileW(')
        self.assertEqual(source.count(declaration), 1)
        source = source.replace(declaration,
                                '[DllImport("kernel32.dll", EntryPoint="CreateFileW", CharSet=CharSet.Unicode, SetLastError=true)]\n'
                                '    static extern SafeFileHandle NativeCreateFileW(', 1)
        requested_cs, target_cs = json.dumps(str(requested)), json.dumps(str(target))
        shim = '''    static SafeFileHandle CreateFileW(string name, uint access, uint share, IntPtr security,
                                       uint creation, uint flags, IntPtr template) {
        if (String.Equals(name, %s, StringComparison.Ordinal)) name = %s;
        return NativeCreateFileW(name, access, share, security, creation, flags, template);
    }
''' % (requested_cs, target_cs)
        self.assertEqual(source.count('    sealed class Pinned : IDisposable {'), 1)
        source = source.replace('    sealed class Pinned : IDisposable {', shim + '    sealed class Pinned : IDisposable {', 1)
        reads = self.base / 'content-read-marker'
        read = 'int count = stream.Read(bytes, length, bytes.Length - length);'
        self.assertEqual(source.count(read), 1)
        source = source.replace(read,
                                'if (String.Equals(path, %s, StringComparison.Ordinal)) File.AppendAllText(%s, "read\\n");\n                    ' %
                                (requested_cs, json.dumps(str(reads))) + read, 1)
        fixture = self.base / 'redirected-reader.ps1'
        fixture.write_text(source, encoding='utf-8')
        return fixture, reads

    def refuse_redirect_without_content_read(self, requested, target):
        before = target.read_bytes() if target.is_file() else None
        baseline = self.read()
        self.assertEqual(baseline.returncode, 0, baseline.stdout + baseline.stderr)
        control, reads = self.redirected_reader(requested, requested)
        accepted = self.read(script=control)
        self.assertEqual(accepted.returncode, 0, accepted.stdout + accepted.stderr)
        self.assertEqual(accepted.stdout, baseline.stdout)
        if requested.is_file():
            self.assertTrue(reads.is_file(), 'fixture read instrumentation did not execute')
            reads.unlink()
        fixture, reads = self.redirected_reader(requested, target)
        result = self.read(script=fixture)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stdout, '')
        self.assertFalse(reads.exists(), 'redirected content was read before rejecting its physical parent')
        if before is not None: self.assertEqual(target.read_bytes(), before)

    def accept(self, branch='fixture-branch', folder=None):
        result = self.read(folder)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stdout.strip(), branch)

    def refuse(self, folder=None):
        result = self.read(folder)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stdout, '')

    def test_normal_repo_and_nested_folder(self):
        self.accept()
        nested = self.repo / 'src'; nested.mkdir(); self.accept(folder=nested)

    def test_unicode_branch(self):
        (self.git / 'HEAD').write_text('ref: refs/heads/中文-مرحبا\n', encoding='utf-8')
        self.accept('中文-مرحبا')
        nested = self.repo / '嵌套-مرحبا'; nested.mkdir()
        self.accept('中文-مرحبا', folder=nested)

    def test_rebound_head_refused_before_content_read(self):
        target = self.base / 'other-repository' / '.git' / 'HEAD'
        target.parent.mkdir(parents=True)
        target.write_text('ref: refs/heads/other-fixture\n', encoding='utf-8')
        self.refuse_redirect_without_content_read(self.git / 'HEAD', target)

    def test_rebound_directory_refused_before_content_read(self):
        target = self.base / 'other-repository' / '.git'
        target.mkdir(parents=True)
        (target / 'HEAD').write_text('ref: refs/heads/other-fixture\n', encoding='utf-8')
        self.refuse_redirect_without_content_read(self.git, target)
        self.assertEqual((target / 'HEAD').read_text(), 'ref: refs/heads/other-fixture\n')

    def test_rebound_gitdir_pointer_refused_before_content_read(self):
        real = self.repo / 'metadata'; self.git.rename(real)
        self.git.write_text('gitdir: metadata\n', encoding='utf-8')
        target = self.base / 'other-pointer'
        target.write_text('gitdir: metadata\n', encoding='utf-8')
        self.refuse_redirect_without_content_read(self.git, target)

    def test_rebound_registered_backlink_and_commondir_refused_before_content_read(self):
        (self.git / 'HEAD').unlink(); self.git.rmdir()
        common = self.base / 'main' / '.git'; registration = common / 'worktrees' / 'fixture'
        registration.mkdir(parents=True)
        (registration / 'HEAD').write_text('ref: refs/heads/registered\n', encoding='utf-8')
        (registration / 'gitdir').write_text(str(self.git) + '\n', encoding='utf-8')
        (registration / 'commondir').write_text('../..\n', encoding='utf-8')
        self.git.write_text('gitdir: ' + str(registration) + '\n', encoding='utf-8')
        self.accept('registered')
        for leaf in ('gitdir', 'commondir'):
            with self.subTest(leaf=leaf):
                target = self.base / ('other-' + leaf)
                target.write_bytes((registration / leaf).read_bytes())
                self.refuse_redirect_without_content_read(registration / leaf, target)

    def test_detached_tag_and_oversized_head_refused(self):
        for head in ('0123456789abcdef\n', 'ref: refs/tags/fixture\n', 'x' * 4097,
                     'ref: refs/heads/a..b\n', 'ref: refs/heads/spaced branch\n'):
            with self.subTest(head=head[:40]):
                (self.git / 'HEAD').write_text(head, encoding='utf-8'); self.refuse()

    def test_local_gitdir_pointer(self):
        real = self.repo / 'metadata'; self.git.rename(real)
        self.git.write_text('gitdir: metadata\n', encoding='utf-8'); self.accept()

    def test_external_pointer_requires_registered_backlink_and_commondir(self):
        (self.git / 'HEAD').unlink(); self.git.rmdir()
        common = self.base / 'main' / '.git'; registration = common / 'worktrees' / 'fixture'
        registration.mkdir(parents=True)
        (registration / 'HEAD').write_text('ref: refs/heads/registered\n', encoding='utf-8')
        (registration / 'gitdir').write_text(str(self.git) + '\n', encoding='utf-8')
        (registration / 'commondir').write_text('../..\n', encoding='utf-8')
        self.git.write_text('gitdir: ' + str(registration) + '\n', encoding='utf-8')
        self.accept('registered')
        (registration / 'gitdir').write_text(str(self.base / 'foreign' / '.git'), encoding='utf-8'); self.refuse()
        (registration / 'gitdir').write_text(str(self.git), encoding='utf-8')
        (registration / 'commondir').write_text(str(self.repo), encoding='utf-8'); self.refuse()

    def test_external_unregistered_pointer_refused(self):
        other = self.base / 'unregistered'; self.git.rename(other)
        self.git.write_text('gitdir: ' + str(other), encoding='utf-8'); self.refuse()

    def test_head_hardlink_refused_without_touching_fixture(self):
        head = self.git / 'HEAD'; head.unlink()
        target = self.base / 'target'; target.write_text('ref: refs/heads/outside\n', encoding='utf-8')
        os.link(target, head); self.refuse()
        self.assertEqual(target.read_text(), 'ref: refs/heads/outside\n')

    def test_directory_junction_refused_without_following_target(self):
        target = self.base / 'target'; self.git.rename(target)
        # mklink is a cmd builtin, invoked by an absolute system binary only.
        cmd = Path(self.env['SystemRoot']) / 'System32/cmd.exe'
        subprocess.run([str(cmd), '/d', '/c', 'mklink', '/J', str(self.git), str(target)],
                       env=self.env, capture_output=True, check=True, timeout=10)
        try: self.refuse()
        finally: os.rmdir(self.git)
        self.assertEqual((target / 'HEAD').read_text(), 'ref: refs/heads/fixture-branch\n')

if __name__ == '__main__':
    unittest.main(verbosity=2)
