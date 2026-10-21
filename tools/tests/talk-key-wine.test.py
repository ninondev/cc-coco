#!/usr/bin/env python3
"""The key program's Windows checks that a Linux machine can run, under Wine (lane C, 10-17).

His card (10-17 evening): build talk-key for Windows in the cloud, test it in Wine, and say in the README that
it was not tried on Windows itself. Two parts: the crate's unit tests built for Windows and run by Wine,
Credential Manager's save, load and remove among them (under test names, never the program's own); and the
build the plugin ships for ordinary Windows computers, asked what it must refuse or answer without a key or a
network. The ARM build cannot run here (Wine runs only this machine's processor); it is checked by builds.json
and its bytes. No key, no dialog, no network: every case stops before a request.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
CRATE = ROOT / 'plugin/talk-key'
SHIPPED = ROOT / 'plugin/libexec/talk-key-windows-x86_64.exe'
WINE = shutil.which('wine64') or next((p for p in ('/usr/lib/wine/wine64',) if Path(p).is_file()), None)


@unittest.skipUnless(WINE and SHIPPED.is_file(), 'needs Wine and the shipped Windows build')
class TalkKeyWine(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='talk-key-wine-')
        cls.env = dict(os.environ, WINEPREFIX=os.path.join(cls.temp.name, 'prefix'), WINEDEBUG='-all')

    @classmethod
    def tearDownClass(cls):
        subprocess.run([str(Path(WINE).with_name('wineserver')), '-k'], env=cls.env, capture_output=True)
        cls.temp.cleanup()

    def run_shipped(self, *args, stdin=''):
        result = subprocess.run([WINE, str(SHIPPED), *args], input=stdin, env=self.env, cwd=self.temp.name,
                                capture_output=True, text=True, timeout=300)
        return result.returncode, json.loads(result.stdout.strip().split('\n')[-1])

    def test_unit_tests_under_wine(self):
        if not shutil.which('cargo') or not shutil.which('x86_64-w64-mingw32-gcc'):
            self.skipTest('needs cargo and the mingw linker')
        target = os.environ.get('CARGO_TARGET_DIR', os.path.join(self.temp.name, 'target'))
        result = subprocess.run(['cargo', 'test', '--locked', '--target', 'x86_64-pc-windows-gnu', '--target-dir', target, '--bins'],
                                cwd=CRATE, capture_output=True, text=True, timeout=1800,
                                env=dict(self.env, CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER='x86_64-w64-mingw32-gcc',
                                         CARGO_TARGET_X86_64_PC_WINDOWS_GNU_RUNNER=WINE))
        self.assertEqual(result.returncode, 0, result.stdout[-4000:] + result.stderr[-4000:])
        self.assertIn('store::windows::tests::a_record_goes_in_comes_back_the_same_and_goes_away ... ok', result.stdout)
        self.assertIn('store::windows::tests::something_else_under_the_name_is_refused ... ok', result.stdout)

    def test_the_shipped_build_answers_without_a_key(self):
        self.assertEqual(self.run_shipped('nonsense'), (1, {'kind': 'other', 'detail': 'usage'}))
        self.assertEqual(self.run_shipped('status'), (1, {'kind': 'computer', 'detail': 'missing'}))
        self.assertEqual(self.run_shipped('remove'), (0, {'kind': 'removed'}))
        code, reply = self.run_shipped('send', stdin=json.dumps({'messages': [{'role': 'user', 'content': 'hi'}]}))
        self.assertEqual((code, reply['kind'], reply['detail']), (1, 'computer', 'missing'))
        code, reply = self.run_shipped('send', stdin='not json')
        self.assertEqual((code, reply['kind'], reply['detail']), (1, 'other', 'input:json'))

    def test_the_shipped_build_refuses_before_any_key_is_read(self):
        # A pipe is not a terminal, so a key piped in is never read.
        self.assertEqual(self.run_shipped('add', stdin='sk-ant-api03-abcdefghijklmnopqrstuvwxyzx7Qa\n'),
                         (1, {'kind': 'other', 'detail': 'stdin-not-a-terminal'}))
        self.assertEqual(self.run_shipped('add', '--base', 'http://example.com'),
                         (1, {'kind': 'address', 'detail': 'url-http-not-loopback'}))
        self.assertEqual(self.run_shipped('add', '--model', 'x/y'), (1, {'kind': 'address', 'detail': 'model'}))
        # The address is checked before a dialog could open.
        self.assertEqual(self.run_shipped('add', '--dialog', '--title', 'T', '--text', 'X', '--save', 'S', '--cancel', 'C',
                                          '--base', 'https://gw.example.com:99999'),
                         (1, {'kind': 'address', 'detail': 'url-port'}))


if __name__ == '__main__':
    unittest.main()
