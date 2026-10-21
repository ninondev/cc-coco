#!/usr/bin/env python3
"""Absolute executable checks; every filesystem operation stays in a fresh dummy fixture."""
import os
from pathlib import Path
import plistlib
import re
import subprocess
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scratch import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[2]
FIXED_PATH = '/usr/bin:/bin:/usr/sbin:/sbin'

class IconExecutableSecurity(unittest.TestCase):
    def test_macos_and_icns_helper_pin_system_executables(self):
        expected = {
            'plugin/bin/icon-macos.sh': {'dirname','readlink','cat','rm','uname','xattr','grep','tr','cut','stat','cksum','osascript','mktemp','mkdir','sips','cp','sh'},
            'plugin/assets/icon/build-icns.sh': {'awk','osascript','wc','tr','cat'},
        }
        for name, commands in expected.items():
            source = (ROOT / name).read_text()
            self.assertIn('PATH=' + FIXED_PATH, source, name)
            self.assertIn('export PATH', source, name)
            for command in commands:
                absolute = ('/bin/' if command in {'sh','cat','rm','mkdir','cp'} else '/usr/bin/') + command
                self.assertIn(absolute, source, (name, command))
                # Ignore comments and single-quoted JXA programs; commands at shell starts/substitutions are fixed.
                shell = re.sub(r"(?:JXA_COMPARE|JXA_SMALL|JXA)='.*?\n'", '', source, flags=re.S)
                shell = '\n'.join(line for line in shell.splitlines() if not line.lstrip().startswith('#'))
                self.assertNotRegex(shell, r'(?:^|[;(]|\$\(|\|)\s*' + command + r'(?=\s|$)', (name, command))

    @unittest.skipUnless(sys.platform == 'darwin', 'macOS system executable boundary')
    def test_poisoned_path_cannot_substitute_macos_status_or_build_helper(self):
        with TemporaryDirectory(prefix='i1-icon-exec-', dir=os.environ.get('TMPDIR')) as directory:
            base = Path(directory).resolve(); home = base / 'home'; home.mkdir()
            poison = base / 'poison'; poison.mkdir(); touched = base / 'poison-executed'
            for name in ('sh','uname','dirname','readlink','xattr','osascript','sips','stat','cksum','awk','wc','tr','cat','cp','rm','mkdir','mktemp','grep','cut'):
                executable = poison / name
                executable.write_text('#!/bin/sh\nprintf attacked >> "' + str(touched) + '"\nexit 88\n')
                executable.chmod(0o755)
            app = base / 'UniqueDummy.app'; contents = app / 'Contents'; contents.mkdir(parents=True)
            (contents / 'MacOS').mkdir(); executable = contents / 'MacOS' / 'probe'
            executable.write_text('#!/bin/sh\nexit 0\n'); executable.chmod(0o755)
            (contents / 'Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier':'test.coco.path.' + base.name, 'CFBundleVersion':'1', 'CFBundleName':'UniqueDummy', 'CFBundleExecutable':'probe', 'CFBundlePackageType':'APPL'}))
            env = {'HOME':str(home), 'CLAUDE_CONFIG_DIR':str(base / 'config'), 'TMPDIR':str(base), 'PATH':str(poison), 'COCO_LANGUAGE':'en'}
            subprocess.run(['/usr/bin/codesign','--force','--sign','-','--timestamp=none',str(app)], env=env, check=True, capture_output=True)
            result = subprocess.run(['/bin/sh', str(ROOT / 'plugin/bin/icon-macos.sh'), 'status','--report','--restore-key','--app',str(app)], env=env, capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn('icon: stock\n', result.stdout)
            self.assertFalse(touched.exists())
            # A malformed custom resource reaches the real osascript decoder, fails closed, and never uses a PATH shim.
            (app / 'Icon\r').write_bytes(b'fixture')
            flag = bytes.fromhex('0000000000000000040000000000000000000000000000000000000000000000')
            subprocess.run(['/usr/bin/xattr','-wx','com.apple.FinderInfo',flag.hex(),str(app)], env=env, check=True, capture_output=True)
            result = subprocess.run(['/bin/sh', str(ROOT / 'plugin/bin/icon-macos.sh'), 'status','--report','--app',str(app)], env=env, capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
            self.assertEqual(result.stdout, 'icon: unknown\n')
            self.assertFalse(touched.exists())
            iconset = base / 'bad.iconset'; iconset.mkdir()
            result = subprocess.run(['/bin/sh', str(ROOT / 'plugin/assets/icon/build-icns.sh'), str(iconset), str(base / 'out.icns')], env=env, capture_output=True, text=True, timeout=30)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(touched.exists())

if __name__ == '__main__': unittest.main()
