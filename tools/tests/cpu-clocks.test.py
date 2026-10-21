#!/usr/bin/env python3
"""Default fixture timing clocks cannot regress to scheduling-sensitive wall limits."""
import importlib.util
import concurrent.futures
import os
import threading
import tempfile
import json
from pathlib import Path
import shutil
import subprocess
import sys
import unittest
from unittest.mock import Mock
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools'))
from swift_cpu_fixtures import transform
import fixture_cpu
from process_cpu import run

class CpuClocks(unittest.TestCase):
    def test_cpu_stage_retains_script_sibling_import_precedence_and_arguments(self):
        with tempfile.TemporaryDirectory(prefix='g1-script-import-') as folder:
            work = Path(folder)
            scripts = work/'scripts'
            cwd = work/'cwd'
            scripts.mkdir(); cwd.mkdir()
            (scripts/'owned_sibling.py').write_text("VALUE = 'script sibling'\n")
            (cwd/'owned_sibling.py').write_text("VALUE = 'cwd shadow'\n")
            entry = scripts/'entry.py'
            entry.write_text("import owned_sibling, sys\nassert owned_sibling.VALUE == 'script sibling'\nassert sys.argv[1:] == ['kept-argument']\nprint('sibling parity')\n")
            for argv in ([sys.executable, str(entry), 'kept-argument'],
                         [sys.executable, str(ROOT/'tools/cpu_stage.py'), str(entry), 'kept-argument']):
                result = subprocess.run(argv, cwd=cwd, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout, 'sibling parity\n')
            mutant = work/'mutant'
            mutant.mkdir()
            for name in ('cpu_stage.py', 'process_cpu.py', 'swift_cpu_fixtures.py'):
                shutil.copy2(ROOT/'tools'/name, mutant/name)
            target = mutant/'cpu_stage.py'
            source = target.read_text()
            parity = '    sys.path.insert(0, str(Path(script).resolve().parent))\n'
            self.assertEqual(source.count(parity), 1)
            target.write_text(source.replace(parity, '', 1))
            rejected = subprocess.run([sys.executable, str(target), str(entry), 'kept-argument'],
                                      cwd=cwd, capture_output=True, text=True)
            self.assertNotEqual(rejected.returncode, 0)

    def test_explicit_native_wall_cap_is_independent_of_cpu_budget(self):
        for cancelled in (None, threading.Event()):
            with self.subTest(cancellation_enabled=cancelled is not None), self.assertRaises(subprocess.TimeoutExpired) as caught:
                run([sys.executable, '-c', 'import time; time.sleep(10)'], cpu_limit=2,
                    wall_limit=.05, cancel_event=cancelled, capture_output=True, text=True)
            self.assertEqual(caught.exception.timeout, .05)
            self.assertGreaterEqual(caught.exception.cpu_seconds, 0)
            self.assertLess(caught.exception.cpu_seconds, 2, 'idle wall expiry must not be charged as CPU expiry')

    def test_swift_limits_and_elapsed_metrics_use_cpu_without_changing_record_clock(self):
        original='''let now = Date().timeIntervalSince1970 * 1000
let start = DispatchTime.now().uptimeNanoseconds
let end = Date().addingTimeInterval(1)
while !ready && Date() < end { RunLoop.current.run(until: min(end, Date().addingTimeInterval(0.005))) }
let elapsed = DispatchTime.now().uptimeNanoseconds - start
'''
        value=transform(original)
        self.assertIn('let now = Date().timeIntervalSince1970 * 1000',value)
        self.assertIn('let end = p1CpuSeconds() + (1)',value)
        self.assertIn('p1CpuSeconds() < end',value)
        self.assertNotIn('DispatchTime.now().uptimeNanoseconds',value)
        self.assertNotIn('min(end,',value)

    def test_native_fixture_finite_failure_budget_uses_cpu(self):
        value=transform('DispatchQueue.main.asyncAfter(deadline: .now() + 5, execute: timeout)')
        self.assertEqual(value,'p1ScheduleCpuBudget(5, work: timeout)')

    def test_presence_failure_budgets_use_cpu_without_changing_record_clock(self):
        source=(ROOT/'tools/tests/presence-real.ts').read_text()
        adapter=(ROOT/'tools/tests/presence-node-io.ts').read_text()
        self.assertIn('const now = Date.now()',source)
        self.assertIn('options.now?.() ?? Date.now()',adapter)
        self.assertIn('setTimeout(callback,ms)',adapter)
        self.assertNotRegex(source,r'assert\.ok\(performance\.now\(')
        self.assertNotRegex(source,r'setTimeout\([^;]*reject')
        self.assertIn('scheduleCpuBudget(5000,',source)
        self.assertIn('scheduleCpuBudget(1000,',source)
        bun=shutil.which('bun')
        if not bun:
            self.skipTest('Bun is required to exercise the presence CPU budget helper')
        program='''import {strict as assert} from 'node:assert'
import {cpuMilliseconds, scheduleCpuBudget} from %s
const original = process.cpuUsage
try {
  process.cpuUsage = () => ({user: 1200, system: 800})
  assert.equal(cpuMilliseconds(), 2)
} finally { process.cpuUsage = original }
let cpu = 0, fired = 0
const callbacks = []
const schedule = callback => { callbacks.push(callback); return () => {} }
const tick = () => { const callback = callbacks.shift(); assert.ok(callback); callback() }
scheduleCpuBudget(1000, () => fired++, () => cpu, schedule)
// Poll wakeups can arrive arbitrarily late without consuming this process's CPU budget.
for (let n = 0; n < 100; n++) tick()
assert.equal(fired, 0)
cpu = 999; tick(); assert.equal(fired, 0)
cpu = 1000; tick(); assert.equal(fired, 1); assert.equal(callbacks.length, 0)
const cancel = scheduleCpuBudget(1, () => fired++, () => cpu, schedule)
cancel(); cpu = 9000; tick(); assert.equal(fired, 1)
''' % json.dumps(str(ROOT/'tools/tests/process-cpu.ts'))
        result=run([bun,'--no-env-file','-e',program],cwd=ROOT,capture_output=True,text=True,cpu_limit=10)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)

    def test_python_fixture_readiness_uses_cpu_budget(self):
        source=(ROOT/'tools/tests/scratch-cleanup.test.py').read_text()
        self.assertIn('wait_for_cpu(ready.exists, cpu_limit=5)',source)
        self.assertNotIn('time.monotonic()',source)
        pause=Mock()
        self.assertTrue(fixture_cpu.wait_for(Mock(side_effect=[False,False,True]),cpu_limit=.5,
                                           clock=Mock(side_effect=[10,10,10]),pause=pause))
        self.assertEqual(pause.call_count,2)
        pause.reset_mock()
        self.assertFalse(fixture_cpu.wait_for(lambda:False,cpu_limit=.5,
                                            clock=Mock(side_effect=[10,10.6]),pause=pause))
        pause.assert_not_called()

    def test_python_fixture_pipe_wakeups_do_not_fail_before_cpu_budget(self):
        source=(ROOT/'tools/tests/scratch-cleanup.test.py').read_text()
        self.assertNotRegex(source,r'child\.(?:communicate|wait)\(timeout=')
        child=Mock(args=['fixture'])
        child.communicate.side_effect=[subprocess.TimeoutExpired(child.args,.05),
                                       subprocess.TimeoutExpired(child.args,.05),('output','error')]
        try:
            result=fixture_cpu.communicate(child,cpu_limit=.5,clock=Mock(side_effect=[10,10,10,10.1]))
        except subprocess.TimeoutExpired as error:
            self.fail('wall poll was treated as a failure: '+str(error))
        self.assertEqual(result,('output','error'))
        self.assertEqual(child.communicate.call_count,3)
        child.communicate.side_effect=subprocess.TimeoutExpired(child.args,.05)
        with self.assertRaises(subprocess.TimeoutExpired) as caught:
            fixture_cpu.communicate(child,cpu_limit=.5,clock=Mock(side_effect=[20,21]))
        self.assertEqual(caught.exception.timeout,.5)
        child.communicate.side_effect=None
        child.communicate.return_value=('completed output','completed error')
        with self.assertRaises(subprocess.TimeoutExpired) as caught:
            fixture_cpu.communicate(child,cpu_limit=.5,clock=Mock(side_effect=[30,31]))
        self.assertEqual(caught.exception.output,'completed output')

    @unittest.skipUnless(os.name == 'posix', 'wait4 child-local CPU accounting')
    def test_concurrent_children_do_not_charge_another_commands_cpu(self):
        program = 'import time; start=time.process_time();\nwhile time.process_time()-start < .15: pass'
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as workers:
            busy = workers.submit(run, [sys.executable, '-c', program], cpu_limit=2, capture_output=True, text=True)
            idle = workers.submit(run, [sys.executable, '-c', 'import time; time.sleep(.35)'], cpu_limit=.10, capture_output=True, text=True)
            busy_result, idle_result = busy.result(), idle.result()
        self.assertEqual(busy_result.returncode, 0)
        self.assertEqual(idle_result.returncode, 0)
        self.assertGreater(busy_result.cpu_seconds, .13)
        self.assertLess(idle_result.cpu_seconds, .10, 'sleeping command must not inherit CPU from the concurrently completed busy command')

    @unittest.skipUnless(os.name == 'posix', 'wait4 includes reaped descendant CPU')
    def test_command_cpu_includes_its_waited_descendant(self):
        child = 'import time; start=time.process_time();\nwhile time.process_time()-start < .15: pass'
        parent = 'import subprocess,sys; subprocess.run([sys.executable, "-c", '+repr(child)+'], check=True)'
        result = run([sys.executable, '-c', parent], cpu_limit=2, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0)
        self.assertGreater(result.cpu_seconds, .13, 'the CLI allowance must include descendants it reaps')

    @unittest.skipUnless(os.name == 'posix', 'POSIX owned engine PID before exec')
    def test_owned_pid_marker_matches_actual_exec_command_in_scratch(self):
        for budget in (2, None):
            with self.subTest(budget=budget), tempfile.TemporaryDirectory(prefix='cpu-owned-pid-') as name:
                root = Path(name)
                marker = root/'engine.pid'
                program = 'import os; print(os.getpid())'
                result = run([sys.executable, '-c', program], cpu_limit=budget, cwd=root,
                             owned_pid_file=marker, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(json.loads(marker.read_text()), {'marker': 'p1-owned-engine-pid', 'pid': int(result.stdout.strip())})
                self.assertNotEqual(int(result.stdout.strip()), os.getpid())
                self.assertEqual([path.name for path in root.iterdir()], ['engine.pid'], 'atomic-write intermediates must clean')

    @unittest.skipUnless(os.name == 'posix', 'POSIX owned PID scratch boundary')
    def test_owned_pid_marker_rejects_outside_scratch_and_existing_paths(self):
        with tempfile.TemporaryDirectory(prefix='cpu-pid-boundary-') as name:
            root = Path(name)
            work = root/'scratch'; work.mkdir()
            outside = root/'owner.txt'; outside.write_text('owner data')
            existing = work/'already.pid'; existing.write_text('keep existing')
            symlink = work/'link.pid'; symlink.symlink_to(outside)
            for marker in (outside, existing, symlink):
                with self.subTest(marker=marker.name), self.assertRaises(ValueError):
                    run([sys.executable, '-c', 'raise RuntimeError("must not launch")'], cpu_limit=2,
                        cwd=work, owned_pid_file=marker, capture_output=True, text=True)
            self.assertEqual(outside.read_text(), 'owner data')
            self.assertEqual(existing.read_text(), 'keep existing')
            self.assertTrue(symlink.is_symlink())

    @unittest.skipUnless(os.name == 'posix', 'POSIX owned child cancellation')
    def test_command_cancellation_reaps_child_and_preserves_output(self):
        cancelled = threading.Event()
        timer = threading.Timer(.10, cancelled.set)
        timer.start()
        try:
            with self.assertRaises(InterruptedError):
                run([sys.executable, '-c', 'import time; print("started", flush=True); time.sleep(60)'],
                    cpu_limit=2, cancel_event=cancelled, capture_output=True, text=True)
        finally:
            timer.cancel()

    @unittest.skipUnless(os.name == 'posix', 'POSIX command-local CPU expiration')
    def test_cpu_expiration_attaches_measured_command_cpu(self):
        with self.assertRaises(subprocess.TimeoutExpired) as caught:
            run([sys.executable, '-c', 'import time; print("owned output", flush=True); start=time.process_time();\nwhile time.process_time()-start < .10: pass'],
                cpu_limit=.02, capture_output=True, text=True)
        self.assertGreater(caught.exception.cpu_seconds, .02)
        self.assertIn('owned output', caught.exception.output)

if __name__=='__main__': unittest.main()
