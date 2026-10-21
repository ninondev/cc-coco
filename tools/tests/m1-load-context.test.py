"""Regression tests for isolated before/after measurement contexts; never launch Bun."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest
from unittest import mock

SOURCE = Path(__file__).resolve().parents[1] / 'measure-hooks-load.py'
spec = importlib.util.spec_from_file_location('m1_load_context', SOURCE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class MeasurePairContextTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='m1-load-context-test-')
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.sdk = self.base / 'captured-sdk' / '.claude-plugin' / 'types'
        self.sdk.mkdir(parents=True)
        (self.sdk / 'support.ts').write_text('export type TinySdk = { ok: true }\n')
        self.before_root = self._plugin('before', 'before-runtime', original_sdk=True)
        self.after_root = self._plugin('after', 'after-runtime', original_sdk=False)
        self.before_entry = self.before_root / 'hooks' / 'register.tsx'
        self.after_entry = self.after_root / 'hooks' / 'register.tsx'
        self.before_bytes = self.before_entry.read_bytes()
        self.after_bytes = self.after_entry.read_bytes()
        self.before_helper_bytes = (self.before_root / 'hooks/runtime-helper.mjs').read_bytes()
        self.before_snapshot = self._runtime_snapshot(self.before_root)
        self.after_snapshot = self._runtime_snapshot(self.after_root)
        self.cache_base = self.base / 'candidate-scratch'
        self.cache_base.mkdir()

    def _plugin(self, name, marker, original_sdk):
        root = self.base / name / 'plugin'
        (root / '.claude-plugin').mkdir(parents=True)
        (root / '.claude-plugin' / 'plugin.json').write_text('{"name":"fixture"}\n')
        (root / 'hooks').mkdir()
        (root / 'hooks' / 'register.tsx').write_text(f'export const fixture = {json.dumps(marker)}\n')
        (root / 'hooks' / 'runtime-helper.mjs').write_text(f'export const helper = {json.dumps(marker)}\n')
        if original_sdk:
            dest = root / '.claude-plugin' / 'types'
            dest.mkdir()
            (dest / 'wrong.ts').write_text('export type Wrong = never\n')
        return root

    @staticmethod
    def _runtime_snapshot(root):
        suffixes = {'.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'}
        return {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                for p in sorted(root.rglob('*'))
                if p.is_file() and p.suffix in suffixes
                and not p.relative_to(root).as_posix().startswith('.claude-plugin/types/')}

    def test_pair_uses_byte_preserved_siblings_common_cwd_and_empty_unique_caches(self):
        calls = []
        expected_runtime = {
            'before': {'register.tsx': self.before_bytes,
                       'runtime-helper.mjs': (self.before_root / 'hooks/runtime-helper.mjs').read_bytes()},
            'after': {'register.tsx': self.after_bytes,
                      'runtime-helper.mjs': (self.after_root / 'hooks/runtime-helper.mjs').read_bytes()},
        }

        def fake_run(argv, **kwargs):
            self.assertEqual(argv[0], '/fixture/bin/bun')
            driver = Path(argv[-1])
            match = re.search(r'await import\((".*?")\);', driver.read_text())
            self.assertIsNotNone(match)
            imported = Path(json.loads(match.group(1)))
            label = 'before' if imported.parents[2].name == 'before' else 'after'
            clone_root = imported.parents[1]
            self.assertEqual(imported.read_bytes(), expected_runtime[label]['register.tsx'])
            self.assertEqual((clone_root / 'hooks/runtime-helper.mjs').read_bytes(),
                             expected_runtime[label]['runtime-helper.mjs'])
            self.assertEqual(kwargs['cwd'], str(driver.parent))
            self.assertEqual(driver.parent.parent.resolve(), self.cache_base.resolve())
            cache = Path(kwargs['env']['BUN_RUNTIME_TRANSPILER_CACHE_PATH'])
            self.assertTrue(cache.is_dir())
            self.assertEqual(list(cache.iterdir()), [])
            (cache / 'poison.ts').write_text('poison\n')
            support = clone_root / '.claude-plugin' / 'types'
            support_bytes = (support / 'support.ts').read_bytes()
            self.assertEqual(support_bytes, (self.sdk / 'support.ts').read_bytes())
            self.assertFalse((support / 'wrong.ts').exists())
            calls.append((label, driver, cache, kwargs['cwd'], clone_root, support_bytes))
            return subprocess.CompletedProcess(argv, 0, stdout='{"wallMs":1.0,"cpuMs":0.5}\n', stderr='')

        self.assertTrue((self.before_root / '.claude-plugin/types').exists())
        self.assertFalse((self.after_root / '.claude-plugin/types').exists())
        with mock.patch.dict(os.environ, {'TMPDIR': str(self.cache_base)}), \
             mock.patch.object(module.shutil, 'which', return_value='/fixture/bin/bun'), \
             mock.patch.object(module.subprocess, 'run', side_effect=fake_run):
            result = module.measure_pair(self.before_entry, self.after_entry, 3, sdk_support=self.sdk)

        self.assertEqual([call[0] for call in calls], ['before', 'after', 'after', 'before', 'before', 'after'])
        self.assertEqual(len({call[2] for call in calls}), 6)
        self.assertEqual(len({call[3] for call in calls}), 1)
        self.assertEqual(result['before']['runs'], 3)
        self.assertEqual(result['after']['runs'], 3)
        self.assertEqual(self._runtime_snapshot(self.before_root), self.before_snapshot)
        self.assertEqual(self._runtime_snapshot(self.after_root), self.after_snapshot)
        self.assertEqual(self.before_entry.read_bytes(), self.before_bytes)
        self.assertEqual(self.after_entry.read_bytes(), self.after_bytes)
        clone_roots = {call[4] for call in calls}
        self.assertEqual(len(clone_roots), 2)
        self.assertEqual({root.parents[1].resolve() for root in clone_roots},
                         {Path(call[3]).resolve() for call in calls})
        self.assertTrue(all(call[5] == (self.sdk / 'support.ts').read_bytes() for call in calls))
        self.assertTrue(all(not call[1].exists() and not call[2].exists() for call in calls))
        self.assertEqual(list(self.cache_base.glob('moe-hooks-load-*')), [])

    def test_runtime_dependency_change_during_copy_is_rejected(self):
        changed_file = self.before_root / 'hooks/runtime-helper.mjs'
        with tempfile.TemporaryDirectory(prefix='m1-load-copy-', dir=self.cache_base) as folder:
            original_copytree = module.shutil.copytree
            changed = False

            def copy_then_change(src, dst, *args, **kwargs):
                nonlocal changed
                result = original_copytree(src, dst, *args, **kwargs)
                if Path(src).resolve() == self.before_root.resolve() and not changed:
                    changed_file.write_text('export const helper = "changed during copy"\n')
                    changed = True
                return result

            with mock.patch.object(module.shutil, 'copytree', side_effect=copy_then_change):
                with self.assertRaisesRegex(ValueError, 'Runtime source changed while normalizing'):
                    module.normalized_module(self.before_entry, folder, 'before', self.sdk)
            self.assertTrue(changed)
            self.assertNotEqual(changed_file.read_bytes(), self.before_helper_bytes)

    def test_runtime_symlink_is_rejected(self):
        link = self.before_root / 'hooks/runtime-link.ts'
        link.symlink_to(self.before_entry)
        with tempfile.TemporaryDirectory(prefix='m1-load-link-', dir=self.cache_base) as folder:
            with self.assertRaisesRegex(ValueError, 'refuses source symlinks'):
                module.normalized_module(self.before_entry, folder, 'before', self.sdk)
        link.unlink()


if __name__ == '__main__':
    unittest.main(verbosity=2)
