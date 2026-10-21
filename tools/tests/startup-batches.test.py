"""Source-preserving startup batching and rejection controls; no SDK launch."""
import contextlib
import io
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import startup_batches as module

ROOT = Path(__file__).resolve().parents[2]


class StartupBatchControls(unittest.TestCase):
    def fixture(self, windows=False):
        owned = tempfile.TemporaryDirectory(prefix='m1-startup-batch-control-', dir=os.environ.get('TMPDIR'))
        self.addCleanup(owned.cleanup)
        plugin = Path(owned.name) / 'plugin'
        (plugin / 'tests').mkdir(parents=True)
        inventory = json.loads(module.INVENTORY.read_text())
        for relative in inventory['runtimeSourceSHA256']:
            target = plugin / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / 'plugin' / relative, target)
        fixture = plugin / 'tests/startup.test.tsx'
        shutil.copyfile(ROOT / 'tools/tests/startup.test.tsx', fixture)
        (fixture.parent / 'test-system.ts').write_text('export const WINDOWS_ROOTS = ' + str(windows).lower() + '\n')
        return Path(owned.name), plugin, fixture

    def output(self, names, failed=()):
        return ''.join('(fail) '+name+' [1ms]\nAssertionError: expect(received).toBe(expected)\n' if name in failed
                       else '(pass) '+name+' [1ms]\n' for name in names) + f' {len(names)-len(failed)} pass\n {len(failed)} fail\n'

    def test_exact14_partition_preserves_all1412_names_and_windows_case(self):
        _, plugin, fixture = self.fixture()
        normal = module.batches(plugin, fixture)
        _, windows, windows_fixture = self.fixture(True)
        windows_plans = module.batches(windows, windows_fixture)
        names = [name for _, selected in normal for name in selected]
        self.assertEqual(len(normal), 14)
        self.assertEqual(len(names), 1412)
        self.assertEqual(len(set(names)), 1412)
        self.assertEqual(len(normal[0][1]), 36)
        self.assertEqual(sum(len(selected) for _, selected in normal[1:]), 1376)
        self.assertEqual(normal[1:], windows_plans[1:])
        self.assertEqual(len(set(normal[0][1]) ^ set(windows_plans[0][1])), 2)

    def test_fixture_adaptation_reverses_to_every_original_byte(self):
        original = (ROOT / 'tools/tests/startup.test.tsx').read_bytes()
        adapted = module.adapted_fixture(original)
        self.assertEqual(adapted.decode().replace(module.SHIM_IMPORT, module.IMPORT, 1).encode(), original)
        self.assertEqual(original.count(b'timeoutMs'), adapted.count(b'timeoutMs'))
        self.assertEqual(original.count(b'expect('), adapted.count(b'expect('))

    def test_name_source_drift_is_rejected(self):
        _, plugin, fixture = self.fixture()
        source = plugin / 'hooks-source/lines.ts'
        source.write_bytes(source.read_bytes() + b'\n// diagnostic drift\n')
        with self.assertRaisesRegex(RuntimeError, 'name input changed'):
            module.batches(plugin, fixture)

    def test_runner_seed_leaves_the_name_inputs_alone_and_every_drift_rejects(self):
        _, plugin, fixture = self.fixture()
        original_plans = module.batches(plugin, fixture)
        mood = plugin / 'hooks-source/mood.ts'
        original = mood.read_bytes()
        # Since M1 motion.ts is a facade; the runner seeds the RNG in motion.source.ts, so both are needed.
        for name in ('motion.ts', 'motion.source.ts'):
            shutil.copyfile(ROOT / 'plugin/hooks-source' / name, plugin / 'hooks-source' / name)
        spec = importlib.util.spec_from_file_location('startup_seed_contract_runner', ROOT / 'tools/run-tests.py')
        runner = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(runner)
        runner.seed_runtime_motion(str(plugin))
        # Only motion is seeded: the omen's own random seam in mood.ts went with the omen (owner 10-15).
        self.assertEqual(mood.read_bytes(), original)
        self.assertEqual(module.batches(plugin, fixture), original_plans)
        prefix = b"import { seededRandom } from './motion'\n"
        for drift in [original + b'\n// original drift\n', prefix + original]:
            mood.write_bytes(drift)
            with self.assertRaisesRegex(RuntimeError, 'name input changed'):
                module.batches(plugin, fixture)

    def test_zero_exit_truncation_duplicates_unknown_names_and_summary_loss_reject(self):
        names = ['first', 'second']
        good = self.output(names)
        self.assertTrue(module.sdk_receipt(good, names, 0)['accepted'])
        for output in [self.output(names[:1]), self.output(['first', 'first']), self.output(['first', 'unknown']), good.split(' 2 pass')[0], good.replace(' 2 pass', ' 1 pass')]:
            self.assertFalse(module.sdk_receipt(output, names, 0)['accepted'])

    def test_failures_timeouts_scanner_and_nonzero_exit_are_not_acceptance(self):
        names = ['first', 'second']
        ordinary = module.sdk_receipt(self.output(names, failed=['second']), names, 1)
        self.assertFalse(ordinary['accepted'])
        self.assertEqual(ordinary['failedTests'], ['second'])
        self.assertTrue(ordinary['ordinaryAssertionFailures']['second'])
        for output, code, timeout in [(self.output(names), 1, False), (self.output(names), 0, True), ('ScannerError: rejected\n'+self.output(names), 0, False)]:
            self.assertFalse(module.sdk_receipt(output, names, code, timeout)['accepted'])

    def test_actual_scheduler_forwards_original_registration_and_restores_fixture(self):
        scratch, plugin, fixture = self.fixture()
        original = fixture.read_bytes()
        plans = module.batches(plugin, fixture)
        waits = []
        def sdk(argv, **kwargs):
            index = len(waits)
            waits.append(kwargs['timeout'])
            self.assertEqual(argv, ['/fixture/claude', 'plugin', 'test', str(plugin)])
            self.assertEqual(fixture.read_bytes(), module.adapted_fixture(original))
            shim = (fixture.parent / module.SHIM_NAME).read_text()
            self.assertIn('sdkTest(name,...rest)', shim)
            self.assertNotIn('async', shim)
            return subprocess.CompletedProcess(argv, 0, self.output(plans[index][1]), '')
        with patch.object(module.subprocess, 'run', side_effect=sdk), patch.object(module.time, 'monotonic', side_effect=range(101, 114)), contextlib.redirect_stdout(io.StringIO()):
            row = module.run_startup('/fixture/claude', plugin, scratch, {'HOME':'/fixture/home'}, 1900, 1800, 1800)
        self.assertEqual(row, {'status':0,'passed':1412,'failed':0,'expired':False})
        self.assertEqual(waits, [1800, *range(1799, 1786, -1)])
        self.assertEqual(fixture.read_bytes(), original)
        self.assertFalse((fixture.parent / module.SHIM_NAME).exists())

    def test_timeout_spends_no_new_deadline_and_restores_exact_original_fixture(self):
        scratch, plugin, fixture = self.fixture()
        original = fixture.read_bytes()
        with patch.object(module.subprocess, 'run', side_effect=subprocess.TimeoutExpired(['/fixture/claude'], 1800, output='')), contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            row = module.run_startup('/fixture/claude', plugin, scratch, {}, 1900, 1800, 1800)
        self.assertEqual(row['status'], 124)
        self.assertTrue(row['expired'])
        self.assertEqual(row['passed'], 0)
        self.assertEqual(fixture.read_bytes(), original)
        self.assertFalse((fixture.parent / module.SHIM_NAME).exists())


if __name__ == '__main__':
    unittest.main(verbosity=2)
