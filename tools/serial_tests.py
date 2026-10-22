"""Run engine files with isolated state and independent, measured CPU budgets."""
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import json
import math
import re
import shutil
import subprocess
import sys
import threading

from process_cpu import run as run_cpu
from kit_file_budgets import budget_for, unmeasured_files, CALIBRATION_CPU_CEILING_SECONDS

last_receipt = {}

# The engine stops a test file at 600 s of wall time. startup.test.tsx holds about 1,400 tests and outlasts that
# on a slower or loaded host, so it runs as batches: batch k of n takes every n-th test in registration order,
# each batch in its own command with its own share of the file's CPU budget. Every test still runs once.
FILE_BATCHES = {'startup.test.tsx': 5}
BATCH_ANCHOR = 'export const test: typeof engineTest = (name, ...rest) => {\n'


def _select_batch(copy, batch):
    wrapper = copy/'tests/cpu-testing.ts'
    text = wrapper.read_text() if wrapper.is_file() else ''
    if text.count(BATCH_ANCHOR) != 1:
        raise ValueError('a batched engine file needs the runner test wrapper')
    index, count = batch
    wrapper.write_text(text.replace(BATCH_ANCHOR, 'let batchRegistered = 0\n' + BATCH_ANCHOR +
                                    '  if (batchRegistered++ %% %d !== %d) return\n' % (count, index), 1))


def _text(value):
    return value.decode('utf-8', errors='replace') if isinstance(value, bytes) else value or ''


def file_workers(env):
    if env.get('COCO_TEST_SERIAL_FILES') == '1':
        return 1
    if 'COCO_TEST_FILE_WORKERS' in env:
        value = env['COCO_TEST_FILE_WORKERS']
        if value not in ('1', '2', '3', '4'):
            raise ValueError('COCO_TEST_FILE_WORKERS must be 1, 2, 3 or 4')
        return int(value)
    return 1


def _file_env(env, work):
    home, temporary = work/'home', work/'tmp'
    for folder in (home, home/'AppData/Roaming', home/'AppData/Local', home/'config', temporary):
        folder.mkdir(parents=True, exist_ok=True)
    return dict(env, HOME=str(home), USERPROFILE=str(home),
                APPDATA=str(home/'AppData/Roaming'), LOCALAPPDATA=str(home/'AppData/Local'),
                CLAUDE_CONFIG_DIR=str(home/'config'), TMPDIR=str(temporary), TMP=str(temporary), TEMP=str(temporary))


def _runtime_promise_root(copy):
    fixture = copy/'tests/promises-runtime-input.ts'
    if not fixture.is_file():
        return
    prefix = 'export const RUNTIME_PROMISE_INPUT = '
    lines = fixture.read_text().splitlines(keepends=True)
    exports = [index for index, line in enumerate(lines) if line.startswith(prefix)]
    if len(exports) != 1:
        raise ValueError('runtime promise fixture must have one generated input export')
    index = exports[0]
    value = json.loads(lines[index][len(prefix):])
    if not isinstance(value, dict) or not isinstance(value.get('pluginRoot'), str):
        raise ValueError('runtime promise fixture has no generated plugin root')
    value['pluginRoot'] = str(copy)
    lines[index] = prefix + json.dumps(value, ensure_ascii=False) + '\n'
    fixture.write_text(''.join(lines))


def _startup_test_root(copy):
    fixture = copy/'tests/test-system.ts'
    if not fixture.is_file():
        return
    lines = fixture.read_text().splitlines(keepends=True)
    windows_prefix = 'export const WINDOWS_ROOTS = '
    root_prefix = 'export const TEST_PLUGIN_ROOT = '
    windows = [line[len(windows_prefix):].strip() for line in lines if line.startswith(windows_prefix)]
    roots = [index for index, line in enumerate(lines) if line.startswith(root_prefix)]
    if len(windows) != 1 or windows[0] not in ('true', 'false') or len(roots) != 1:
        raise ValueError('startup fixture must have one boolean Windows flag and one generated root')
    index = roots[0]
    declared = json.loads(lines[index][len(root_prefix):])
    if not isinstance(declared, str):
        raise ValueError('startup fixture root must be a string')
    # Only the exact Windows mock root stays; a real root (any host) must follow the per-file copy.
    if windows[0] == 'false' or declared != r'C:\Users\windows\Coco':
        lines[index] = root_prefix + json.dumps(str(copy)) + '\n'
        fixture.write_text(''.join(lines))


def _run_file(claude, plugin, scratch, env, relative, index, budget, cancel_event, keep, *, hook_target=None, batch=None):
    work = Path(scratch)/('engine-file-%04d' % index + ('-batch-%d' % batch[0] if batch else ''))
    stdout = stderr = ''
    expired = False
    failure = None
    file_cpu = None
    returncode = 1
    try:
        work.mkdir()
        copy = work/'plugin'
        source_tests = Path(plugin)/'tests'
        def inactive(folder, names):
            try:
                selected_folder = relative.parent == Path(folder).relative_to(source_tests)
            except ValueError:
                return []
            return [name for name in names if name.endswith(('.test.ts', '.test.tsx'))
                    and not (selected_folder and name == relative.name)]
        shutil.copytree(plugin, copy, ignore=inactive)
        _runtime_promise_root(copy)
        _startup_test_root(copy)
        if batch is not None:
            _select_batch(copy, batch)
        if hook_target is not None:
            (copy/'tests/hook-event-target.ts').write_text(
                'export const HOOK_EVENT_TARGET = ' + json.dumps(hook_target) + ' as const\n')
        pid_file = work/'hook-event-engine.pid'
        helper = copy/'tests/native-hook-cpu.py'
        if helper.is_file():
            config = {'helper': str(helper), 'pidFile': str(pid_file), 'python': '/usr/bin/python3'}
            (copy/'tests/native-hook-config.ts').write_text(
                'export const NATIVE_HOOK_CPU = ' + json.dumps(config) + ' as const\n')
        kwargs = dict(env=_file_env(env, work), cwd=work, cpu_limit=budget, capture_output=True, text=True,
                      owned_pid_file=pid_file)
        if cancel_event is not None:
            kwargs['cancel_event'] = cancel_event
        result = run_cpu([claude, 'plugin', 'test', str(copy)], **kwargs)
        stdout, stderr = result.stdout, result.stderr
        file_cpu = getattr(result, 'cpu_seconds', None)
        returncode = result.returncode
    except subprocess.TimeoutExpired as error:
        stdout, stderr = error.stdout, error.stderr
        file_cpu = getattr(error, 'cpu_seconds', None)
        expired = True
    except (OSError, ValueError) as error:
        # A failed file setup or command does not drop the remaining inventory.
        failure = str(error)
    finally:
        if work.exists() and not keep:
            try:
                shutil.rmtree(work)
            except OSError as error:
                cleanup_failure = 'scratch cleanup failed: ' + str(error)
                failure = failure + '; ' + cleanup_failure if failure else cleanup_failure
    return {'stdout': _text(stdout), 'stderr': _text(stderr), 'cpuSeconds': file_cpu,
            'deadlineInterrupted': expired, 'returncode': returncode, 'commandFailure': failure}


def _parse_file(relative, outcome, budget, measure):
    stdout, stderr = outcome['stdout'], outcome['stderr']
    sys.stdout.write(stdout)
    sys.stderr.write(stderr)
    expired = outcome['deadlineInterrupted']
    file_cpu = outcome['cpuSeconds']
    cpu_valid = type(file_cpu) in (int, float) and math.isfinite(file_cpu) and file_cpu >= 0
    if not cpu_valid:
        sys.stderr.write('run-tests.py: invalid CPU receipt for %s: %r; expected finite nonnegative seconds\n' % (relative, file_cpu))
        file_cpu = None
    budget_exceeded = expired or (not measure and cpu_valid and file_cpu > budget)
    status = outcome['returncode'] or int(budget_exceeded or not cpu_valid)
    if budget_exceeded:
        sys.stderr.write('run-tests.py: %s measured %s CPU s; budget %g CPU s exceeded\n' %
                         (relative, '%g' % file_cpu if file_cpu is not None else 'unavailable', budget))
    if outcome['commandFailure']:
        sys.stderr.write('run-tests.py: engine file command failed for %s: %s\n' % (relative, outcome['commandFailure']))
    receipt = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', stdout + '\n' + stderr)
    network_rows = []
    for value in re.findall(r'(?m)^P1_FULL_SUITE_NETWORK (.*)$', receipt):
        try:
            row = json.loads(value)
            if not (isinstance(row, dict) and isinstance(row.get('test'), str) and row['test']
                    and type(row.get('calls')) is int and row['calls'] >= 0):
                raise ValueError('invalid test name or call count')
            network_rows.append(row)
        except (ValueError, TypeError):
            sys.stderr.write('run-tests.py: invalid network guard receipt for %s\n' % relative)
            status = status or 1
    file_network_calls = sum(row['calls'] for row in network_rows)
    pass_count = re.findall(r'(?m)^\s*(\d+) pass\s*$', receipt)
    fail_count = re.findall(r'(?m)^\s*(\d+) fail\s*$', receipt)
    skip_count = re.findall(r'(?m)^\s*(\d+) skip\s*$', receipt)
    file_skipped = int(skip_count[-1]) if skip_count else 0
    synthetic = bool(re.search(r'(?m)^\(fail\) the file did not load\s*$', receipt))
    file_passed = file_failed = 0
    report_complete = bool(pass_count and fail_count and not expired and not synthetic and cpu_valid)
    infrastructure_failure = bool(expired or synthetic or outcome['commandFailure'] or not cpu_valid)
    if infrastructure_failure:
        status = status or 1
    if pass_count and fail_count and not synthetic:
        file_passed, file_failed = int(pass_count[-1]), int(fail_count[-1])
        executed = file_passed + file_failed
        if file_failed:
            status = status or 1
        if not expired and len(network_rows) != executed:
            sys.stderr.write('run-tests.py: network guard coverage incomplete for %s: %d receipts for %d executed tests\n' %
                             (relative, len(network_rows), executed))
            status = status or 1
        if executed == 0 and file_skipped == 0:
            sys.stderr.write('run-tests.py: network guard has no executed or skipped tests for %s\n' % relative)
            status = status or 1
    elif not synthetic:
        sys.stderr.write('run-tests.py: missing pass/fail receipt for %s\n' % relative)
        status = status or 1
    if file_network_calls:
        sys.stderr.write('run-tests.py: network guard detected %d calls in %s\n' % (file_network_calls, relative))
        status = status or 1
    row = {'file': relative.as_posix(), 'cpuSeconds': file_cpu, 'cpuReceiptValid': cpu_valid, 'budgetSeconds': budget,
           'budgetExceeded': budget_exceeded, 'budgetEnforced': not measure,
           'deadlineInterrupted': expired, 'reportComplete': report_complete,
           'syntheticFileFailure': synthetic, 'passed': file_passed, 'failed': file_failed,
           'skipped': file_skipped, 'networkGuardTests': len(network_rows),
           'networkCalls': file_network_calls, 'infrastructureFailure': infrastructure_failure}
    if outcome['commandFailure']:
        row['commandFailure'] = outcome['commandFailure']
    return status, row


def run_serial(claude, plugin, scratch, env, timeout=None, *, workers=None, measure=False, keep=False):
    global last_receipt
    last_receipt = {}
    keep = keep or env.get('COCO_KEEP_SCRATCH') == '1'
    tests = Path(plugin)/'tests'
    inventory = sorted(p.relative_to(tests) for p in tests.rglob('*')
                       if p.is_file() and p.name.endswith(('.test.ts', '.test.tsx')))
    if not inventory:
        sys.stderr.write('run-tests.py: serial engine inventory is empty\n')
        return 2
    workers = file_workers(env) if workers is None else workers
    if type(workers) is not int or not 1 <= workers <= 4:
        raise ValueError('engine file workers must be an integer from 1 to 4')
    unknown = unmeasured_files([file.as_posix() for file in inventory])
    if unknown:
        label = 'engine files without measured CPU baseline (calibration)' if measure else 'engine files using new-file CPU floor'
        sys.stdout.write('%s: %s\n' % (label, ', '.join(unknown)))
    # timeout is retained as an API compatibility argument, never a stage deadline.
    budgets = {file: CALIBRATION_CPU_CEILING_SECONDS if measure else budget_for(file.as_posix()) for file in inventory}
    # A run already narrowed to named tests (--test-name) runs each file whole: a batch could hold none of them.
    wrapper = tests/'cpu-testing.ts'
    named = wrapper.is_file() and 'new Set<string>([])' not in wrapper.read_text()
    batches = {file: 1 if named else FILE_BATCHES.get(file.as_posix(), 1) for file in inventory}
    attempted = set()
    file_results = {}
    status = 0
    cancelled = threading.Event() if workers > 1 else None
    prefix = 'serial' if workers == 1 else '%d-worker' % workers
    def execute(index, relative):
        if cancelled is not None and cancelled.is_set():
            raise InterruptedError('engine file dispatch cancelled')
        attempted.add(relative)
        count = batches[relative]
        if count == 1:
            return _run_file(claude, plugin, scratch, env, relative, index, budgets[relative], cancelled, keep)
        share = math.ceil(budgets[relative] / count)
        return [_run_file(claude, plugin, scratch, env, relative, index, share, cancelled, keep, batch=(k, count)) for k in range(count)]
    def record(relative, outcome):
        nonlocal status
        if isinstance(outcome, list):
            share = math.ceil(budgets[relative] / len(outcome))
            parts = []
            for k, part in enumerate(outcome):
                part_status, part_row = _parse_file(Path('%s [batch %d/%d]' % (relative.as_posix(), k + 1, len(outcome))), part, share, measure)
                status = status or part_status
                parts.append(part_row)
            cpu = [part['cpuSeconds'] for part in parts]
            file_results[relative] = {
                'file': relative.as_posix(), 'cpuSeconds': sum(cpu) if all(type(c) in (int, float) for c in cpu) else None,
                'cpuReceiptValid': all(part['cpuReceiptValid'] for part in parts), 'budgetSeconds': budgets[relative],
                **{key: any(part[key] for part in parts) for key in ('budgetExceeded', 'deadlineInterrupted', 'syntheticFileFailure', 'infrastructureFailure')},
                'budgetEnforced': not measure, 'reportComplete': all(part['reportComplete'] for part in parts),
                **{key: sum(part[key] for part in parts) for key in ('passed', 'failed', 'skipped', 'networkGuardTests', 'networkCalls')},
                'batches': parts}
            return
        file_status, row = _parse_file(relative, outcome, budgets[relative], measure)
        status = status or file_status
        file_results[relative] = row
    try:
        if workers == 1:
            for index, relative in enumerate(inventory, 1):
                sys.stdout.write('%s engine file %d/%d: %s\n' % (prefix, index, len(inventory), relative))
                sys.stdout.flush()
                record(relative, execute(index, relative))
        else:
            with ThreadPoolExecutor(max_workers=workers) as pool:
                futures = {}
                try:
                    for index, relative in enumerate(inventory, 1):
                        futures[pool.submit(execute, index, relative)] = relative
                    for future in as_completed(futures):
                        relative = futures[future]
                        sys.stdout.write('%s engine file %d/%d: %s\n' % (prefix, inventory.index(relative)+1, len(inventory), relative))
                        record(relative, future.result())
                except BaseException:
                    cancelled.set()
                    for future in futures:
                        future.cancel()
                    raise
    finally:
        rows = [file_results[file] for file in inventory if file in file_results]
        passed = sum(row['passed'] for row in rows)
        failed = sum(row['failed'] for row in rows)
        network_calls = sum(row['networkCalls'] for row in rows)
        network_tests = sum(row['networkGuardTests'] for row in rows)
        network_files = sum(bool(row['networkGuardTests']) for row in rows)
        infrastructure_failures = sum(row['infrastructureFailure'] for row in rows)
        last_receipt = {'passed': passed, 'failed': failed, 'skippedTests': sum(row['skipped'] for row in rows),
                        'filesAttempted': len(attempted), 'filesTotal': len(inventory), 'workers': workers,
                        'networkCalls': network_calls, 'networkGuardTests': network_tests, 'networkGuardFiles': network_files,
                        'filesCompleted': sum(row['reportComplete'] for row in rows),
                        'infrastructureFailures': infrastructure_failures, 'fileResults': rows,
                        'cpuSeconds': sum(row['cpuSeconds'] or 0 for row in rows),
                        'invalidCpuFiles': [row['file'] for row in rows if not row['cpuReceiptValid']],
                        'totalCpuInformational': True, 'calibration': measure, 'unmeasuredFiles': unknown,
                        'unattemptedFiles': [file.as_posix() for file in inventory if file not in attempted]}
        sys.stdout.write('%s engine aggregate: %d pass, %d fail; %d/%d files\n' %
                         (prefix, passed, failed, len(attempted), len(inventory)))
        sys.stdout.write('%s engine network guard: %d calls across %d test bodies; %d/%d files\n' %
                         (prefix, network_calls, network_tests, network_files, len(inventory)))
        sys.stdout.write('%s engine CPU total (informational): %g CPU s; invalid CPU receipts: %s\n' %
                         (prefix, last_receipt['cpuSeconds'], ', '.join(last_receipt['invalidCpuFiles']) or 'none'))
        if infrastructure_failures:
            sys.stdout.write('%s engine infrastructure failures: %d; body reports incomplete; unattempted: %s\n' %
                             (prefix, infrastructure_failures, ', '.join(last_receipt['unattemptedFiles']) or 'none'))
        sys.stdout.flush()
    return status
