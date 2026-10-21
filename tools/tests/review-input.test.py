#!/usr/bin/env python3
"""Owned test inputs; no application read or process inspection."""
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
cli = argparse.ArgumentParser(add_help=False)
cli.add_argument('--source', type=Path, default=ROOT / 'tools/run-tests.py')
args, rest = cli.parse_known_args()
module = ast.parse(args.source.read_text())
function = next(node for node in module.body if isinstance(node, ast.FunctionDef) and node.name == 'review_texts')
code = compile(ast.Module(body=[function], type_ignores=[]), str(args.source), 'exec')
FIXTURE = (ROOT / 'tools/test-data/observed-review-texts.ts').read_bytes()
PIN = '9291628ec17bd347ad7dc7f8e7d86f0e8b849156819363376355e97f4cd1a94b'
assert hashlib.sha256(FIXTURE).hexdigest() == PIN

class OwnedReviewInput(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory(prefix='m1-owned-review-', dir=os.environ.get('TMPDIR'))
        self.addCleanup(self.scratch.cleanup)
        self.base = Path(self.scratch.name).resolve()
        self.root = self.base / 'worktree'
        self.root.mkdir()
        self.copy = self.base / 'copy'
        (self.copy / 'tests').mkdir(parents=True)
        self.retained = self.root / 'tools/test-data/observed-review-texts.ts'
        self.retained.parent.mkdir(parents=True)
        self.retained.write_bytes(FIXTURE)
        self.out = self.copy / 'tests/review-texts.ts'
        namespace = {'ROOT': str(self.root), 'Path': Path, 'os': os, 'json': json}
        exec(code, namespace)
        self.read = lambda: namespace['review_texts'](str(self.copy))
        self.external = self.base / 'synthetic-external'
        self.external.mkdir()
        (self.external / 'README.zh.md').write_text('UNOWNED_SYNTHETIC_INPUT')
        (self.root / 'coco').symlink_to(self.external, target_is_directory=True)

    def test_owned_branch_readme_is_authoritative(self):
        (self.root / 'README.zh.md').write_text('OWNED_SYNTHETIC_INPUT')
        self.assertIs(self.read(), True)
        self.assertIn('OWNED_SYNTHETIC_INPUT', self.out.read_text())

    def test_legacy_cross_worktree_link_is_not_read(self):
        result = self.read()
        self.assertEqual(hashlib.sha256(self.out.read_bytes()).hexdigest(), PIN)
        self.assertIs(result, False)

    def test_retained_fixture_remains_non_authoritative(self):
        self.assertIs(self.read(), False)

    def test_linked_branch_readme_is_not_authoritative(self):
        (self.root / 'README.zh.md').symlink_to(self.external / 'README.zh.md')
        self.assertIs(self.read(), False)
        self.assertEqual(hashlib.sha256(self.out.read_bytes()).hexdigest(), PIN)

    def test_tampered_retained_input_is_rejected(self):
        self.retained.write_bytes(FIXTURE + b'\n')
        with self.assertRaisesRegex(RuntimeError, 'differs'):
            self.read()

    def test_linked_retained_input_is_rejected(self):
        self.retained.unlink()
        self.retained.symlink_to(self.external / 'README.zh.md')
        with self.assertRaisesRegex(RuntimeError, 'missing'):
            self.read()

    def test_linked_retained_parent_is_rejected(self):
        self.retained.unlink()
        self.retained.parent.rmdir()
        self.retained.parent.symlink_to(self.external, target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, 'missing'):
            self.read()

    def test_missing_all_owned_inputs_fails_closed(self):
        self.retained.unlink()
        with self.assertRaisesRegex(RuntimeError, 'missing'):
            self.read()

if __name__ == '__main__':
    unittest.main(argv=[__file__, *rest])
