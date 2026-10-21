#!/usr/bin/env python3
"""Owner removal contract; synthetic Foundation journal and source-boundary checks."""
import argparse
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--activity-source', type=Path, default=ROOT / 'plugin/companion/Sources/Activity.swift')
parser.add_argument('--request-source', type=Path, default=ROOT / 'plugin/companion/Sources/RequestChannel.swift')
parser.add_argument('--rust-source', type=Path, default=ROOT / 'plugin/companion-rs/src/protocol.rs')
mode = parser.add_mutually_exclusive_group()
mode.add_argument('--source-only', action='store_true')
mode.add_argument('--protocol-only', action='store_true')
args = parser.parse_args()

class NativeClearRemoval(unittest.TestCase):
    def test_activity_has_no_clear_confirmation_controls(self):
        # New chat came back on 10-16 (owner 10-14); Clear and its confirmation stay gone
        source = args.activity_source.read_text()
        self.assertNotRegex(source, r'\b(?:let|var)\s+(?:clear|cancel|question)\b')
        self.assertNotIn('words.confirmClear', source)

    def test_activity_has_no_clear_emitter_or_retry(self):
        source = args.activity_source.read_text()
        self.assertNotRegex(source, r'\bsend\s*\(\s*\.clear\s*\)')
        self.assertNotRegex(source, r'\b(?:kind|retryKind)\s*==\s*\.clear\b')
        self.assertNotIn('view.clear.pressed', source)
        self.assertIn('view.send.pressed = { [weak self] in self?.submit() }', source)

    def test_swift_request_kind_rejects_clear(self):
        source = args.request_source.read_text()
        body = re.search(r'enum RequestKind: String\s*\{([^}]+)\}', source)
        self.assertIsNotNone(body)
        self.assertNotRegex(body.group(1), r'\bclear\b')
        self.assertRegex(body.group(1), r'\bsubmit\b')
        self.assertRegex(body.group(1), r'\bseen\b')

    def test_rust_request_kind_rejects_clear(self):
        source = args.rust_source.read_text()
        body = re.search(r'pub enum RequestKind\s*\{([^}]+)\}', source)
        self.assertIsNotNone(body)
        self.assertNotRegex(body.group(1), r'\bClear\b')
        self.assertRegex(body.group(1), r'\bSubmit\b')
        self.assertRegex(body.group(1), r'\bSeen\b')

def protocol():
    compiler = shutil.which('swiftc')
    if not compiler:
        print('native-clear-protocol: swiftc unavailable; required check not completed', file=sys.stderr)
        return 2
    with tempfile.TemporaryDirectory(prefix='m1-native-clear-', dir=os.environ.get('TMPDIR')) as folder:
        scratch = Path(folder).resolve()
        source = scratch / 'RequestChannel.swift'
        shutil.copyfile(args.request_source, source)
        secure = scratch / 'SecureFiles.swift'  # the request journal opens its files through SecureDirectory
        shutil.copyfile(args.request_source.parent / 'SecureFiles.swift', secure)
        main = scratch / 'main.swift'
        shutil.copyfile(ROOT / 'tools/tests/native-clear-protocol/main.swift', main)
        home = scratch / 'home'; home.mkdir()
        env = dict(os.environ, HOME=str(home), CLAUDE_CONFIG_DIR=str(home / 'config'), TMPDIR=str(scratch))
        binary = scratch / 'checks'
        compiled = subprocess.run([compiler, '-j', '4', '-swift-version', '5', '-module-cache-path', str(scratch / 'cache'),
                                   str(source), str(secure), str(main), '-o', str(binary)], env=env, cwd=scratch, timeout=120)
        if compiled.returncode:
            return compiled.returncode
        journal = scratch / 'journal'; journal.mkdir()
        return subprocess.run([str(binary), str(journal)], env=env, cwd=scratch, timeout=30).returncode

if __name__ == '__main__':
    if not args.protocol_only:
        result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(NativeClearRemoval))
        if not result.wasSuccessful():
            raise SystemExit(1)
    raise SystemExit(0 if args.source_only else protocol())
