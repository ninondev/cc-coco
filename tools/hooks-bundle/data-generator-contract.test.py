"""Exact source/public data controls; invoke the real lightweight word generator."""
from contextlib import redirect_stdout
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
from hooks_source import hook_generated_outputs

# O6's window-note generator was cut (10-09); the gaps word generator is the live lightweight one with the same pairing.
SPEC = importlib.util.spec_from_file_location('gaps_word_generator', TOOLS / 'build-mod-gaps-words.py')
DRIVER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DRIVER)


class DataGeneratorContract(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='m1-data-generator-control-', dir=os.environ['TMPDIR'])
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        for name in ['plugin/hooks-source', 'plugin/hooks', 'handoffs/program', 'tools/tests']:
            (self.root / name).mkdir(parents=True)
        self.approved = {'gaps.fixture.title': {'en': 'fixture title', 'zh': 'fixture zh', 'zh-Hant': 'fixture title 13'},
                         'gaps.fixture.self': {'en': 'fixture self', 'zh': 'fixture self zh', 'zh-Hant': 'fixture self 13'}}
        (self.root / 'handoffs/program/words-1.0.i18n.json').write_text(json.dumps(self.approved))
        (self.root / 'plugin/core-words.json').write_text(json.dumps({'en': {}, 'zh': {}, 'zh-Hant': {}}))
        self.canonical = self.root / 'plugin/hooks-source/gaps-text.json'
        self.public = self.root / 'plugin/hooks/gaps-text.json'

    def invoke(self, check=False):
        argv = ['build-mod-gaps-words.py'] + (['--check'] if check else [])
        out = io.StringIO()
        with patch.object(DRIVER, 'ROOT', self.root), patch.object(sys, 'argv', argv), redirect_stdout(out):
            code = DRIVER.main()
        if code:
            raise SystemExit(out.getvalue())

    def prepare(self):
        self.invoke()
        self.invoke(True)

    def test_write_and_check_both_copies_use_exact_approved_bytes(self):
        self.prepare()
        words = {key.removeprefix('gaps.'): value for key, value in self.approved.items()}
        expected = (json.dumps(words, ensure_ascii=False, separators=(',', ':')) + '\n').encode()
        self.assertEqual(self.canonical.read_bytes(), expected)
        self.assertEqual(self.public.read_bytes(), expected)
        self.assertIn('zh-Hant', json.loads(self.canonical.read_bytes())['fixture.title'])

    def test_canonical_drift_fails_without_repair_even_when_public_is_correct(self):
        self.prepare()
        defect = b'{"stale":"canonical fixture"}\n'
        self.canonical.write_bytes(defect)
        expected_public = self.public.read_bytes()
        with self.assertRaisesRegex(SystemExit, 'hooks-source/gaps-text.json drift'):
            self.invoke(True)
        self.assertEqual(self.canonical.read_bytes(), defect)
        self.assertEqual(self.public.read_bytes(), expected_public)

    def test_public_drift_fails_without_repair_even_when_canonical_is_correct(self):
        self.prepare()
        defect = b'{"stale":"public fixture"}\n'
        self.public.write_bytes(defect)
        expected_canonical = self.canonical.read_bytes()
        with self.assertRaisesRegex(SystemExit, 'plugin/hooks/gaps-text.json drift'):
            self.invoke(True)
        self.assertEqual(self.public.read_bytes(), defect)
        self.assertEqual(self.canonical.read_bytes(), expected_canonical)

    def test_missing_canonical_copy_fails_without_creation(self):
        self.prepare()
        self.canonical.unlink()
        with self.assertRaisesRegex(SystemExit, 'hooks-source/gaps-text.json drift'):
            self.invoke(True)
        self.assertFalse(self.canonical.exists())

    def test_semantically_equal_crlf_bytes_are_rejected(self):
        self.prepare()
        changed = self.canonical.read_bytes().replace(b'\n', b'\r\n')
        self.canonical.write_bytes(changed)
        with self.assertRaisesRegex(SystemExit, 'hooks-source/gaps-text.json drift'):
            self.invoke(True)
        self.assertEqual(self.canonical.read_bytes(), changed)

    def test_mjs_pairs_exact_bytes_and_leaves_typescript_and_other_assets_unmapped(self):
        binary = b'export const fixture = "exact\\nbytes";\n'
        public = self.root / 'plugin/hooks/algo-core.mjs'
        ts = self.root / 'plugin/hooks/presence.ts'
        outside = self.root / 'plugin/assets/fixture.json'
        result = hook_generated_outputs({public: binary, ts: 'export const fixture=1\n', outside: '{}\n'})
        self.assertEqual(list(result), [self.root / 'plugin/hooks-source/algo-core.mjs', public, ts, outside])
        self.assertEqual(result[self.root / 'plugin/hooks-source/algo-core.mjs'], binary)
        self.assertEqual(result[public], binary)

    def test_conflicting_explicit_canonical_output_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Conflicting generated bytes'):
            hook_generated_outputs({self.public: 'new\n', self.canonical: 'old\n'})


if __name__ == '__main__':
    unittest.main()
