"""Exact original startup registrations split below the CLI's output cap."""
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import time

INVENTORY = Path(__file__).with_name('fixtures') / 'm1-startup-batch-inventory.json'
IMPORT = "import { describe, expect, mock, test } from 'claude-code/testing'"
SHIM_IMPORT = "import { describe, expect, mock } from 'claude-code/testing'\nimport { test } from './m1-startup-batch-test'"
SHIM_NAME = 'm1-startup-batch-test.ts'
PREFIX = 'band startup regression > '


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def name_input_sha(path, relative):
    # run-tests.py seeds only motion now; the omen's own random seam in mood.ts went with the omen (owner 10-15).
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def batches(plugin, fixture):
    """Refuse fixture/runtime drift before choosing a single original case."""
    plugin, fixture = Path(plugin), Path(fixture)
    inventory = json.loads(INVENTORY.read_text())
    if sha(fixture) != inventory['fixtureSHA256']:
        raise RuntimeError('Startup exact original fixture changed; re-review its inventory')
    for relative, digest in inventory['runtimeSourceSHA256'].items():
        if name_input_sha(plugin / relative, relative) != digest:
            raise RuntimeError('Startup approved name input changed: ' + relative)
    source = fixture.read_text()
    if source.count(IMPORT) != 1 or SHIM_IMPORT in source:
        raise RuntimeError('Startup reversible test import anchor changed')
    systems = (plugin / 'tests/test-system.ts').read_text()
    roots = re.findall(r'export const WINDOWS_ROOTS\s*=\s*(true|false)\b', systems)
    if len(roots) != 1:
        raise RuntimeError('Startup Windows-root fixture flag must be explicit')
    general = inventory['generalNames']
    if roots[0] == 'true':
        general = [inventory['windowsNativeName'] if name == inventory['normalNativeName'] else name
                   for name in general]
    result = [('general', general)]
    for lang, count in inventory['localeLineCounts'].items():
        result.append((lang, [PREFIX + f'{lang}: approved line {index} survives the activation restore and first band render'
                              for index in range(count)]))
    names = [name for _, selected in result for name in selected]
    if len(result) != 14 or len(names) != 1412 or len(set(names)) != 1412:
        raise RuntimeError('Startup batches must partition exactly 1412 unique original names')
    return result


def adapted_fixture(original):
    source = original.decode('utf-8')
    if source.count(IMPORT) != 1:
        raise RuntimeError('Startup reversible test import anchor changed')
    adapted = source.replace(IMPORT, SHIM_IMPORT, 1).encode()
    if adapted.decode().replace(SHIM_IMPORT, IMPORT, 1).encode() != original:
        raise RuntimeError('Startup original fixture bytes cannot be restored')
    return adapted


def registrar(label, selected, all_names):
    """Forward the original name/options/body tuple without wrapping the body."""
    raw = lambda name: name.removeprefix(PREFIX)
    selected_raw, all_raw = [raw(n) for n in selected], [raw(n) for n in all_names]
    return ("import { test as sdkTest } from 'claude-code/testing'\n"
            'const selected=new Set<string>(' + json.dumps(selected_raw) + ')\n'
            'const allowed=new Set<string>(' + json.dumps(all_raw) + ')\n'
            'const last=' + json.dumps(all_raw[-1]) + '\n'
            'const batch=' + json.dumps(label) + '\n'
            'const seen=new Set<string>(), admitted=new Set<string>()\n'
            'export const test:typeof sdkTest=(name,...rest)=>{\n'
            " if(!allowed.has(name)||seen.has(name))throw new Error('Startup registration inventory changed')\n"
            ' seen.add(name)\n'
            ' if(selected.has(name)){admitted.add(name);sdkTest(name,...rest)}\n'
            ' if(name===last){\n'
            "  if(seen.size!==allowed.size||admitted.size!==selected.size)throw new Error('Startup registration inventory incomplete')\n"
            "  console.log('M1_STARTUP_BATCH_REGISTERED '+JSON.stringify({batch,total:seen.size,selected:admitted.size}))\n"
            ' }\n'
            '}\n')


def sdk_receipt(output, selected, exit_code, timed_out=False):
    """A capped receipt or nonassertion failure never qualifies as completion."""
    text = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', output)
    rows = list(re.finditer(r'^\((pass|fail)\) (.*?) \[', text, re.M))
    passed = [row.group(2) for row in rows if row.group(1) == 'pass']
    failed = [row.group(2) for row in rows if row.group(1) == 'fail']
    ordinary = {}
    for index, row in enumerate(rows):
        if row.group(1) == 'fail':
            end = rows[index + 1].start() if index + 1 < len(rows) else len(text)
            ordinary[row.group(2)] = bool(re.search(r'\bAssertionError\b[^\n]*expect\(received\)', text[row.end():end]))
    pass_totals = re.findall(r'(?m)^\s*(\d+) pass\s*$', text)
    fail_totals = re.findall(r'(?m)^\s*(\d+) fail\s*$', text)
    exact = Counter(passed + failed) == Counter(selected)
    summaries = (len(pass_totals) == len(fail_totals) == 1
                 and int(pass_totals[0]) == len(passed) and int(fail_totals[0]) == len(failed))
    scanner = bool(re.search(r'(?im)hooks module did not load|^\s*(?:HookRegistrationError|HooksRegistrationError|ScannerError|StaticScanError):|^\s*(?:Error|HooksError):[^\n]*(?:module registration|hook(?:s)? registration|scanner)[^\n]*(?:failed|rejected|error)', text))
    accepted = exact and summaries and not timed_out and not scanner and exit_code == 0 and not failed
    return {'accepted': accepted, 'exactUniqueInventory': exact, 'completeNumericSummary': summaries,
            'passedTests': passed, 'failedTests': failed, 'ordinaryAssertionFailures': ordinary,
            'missingTests': sorted(set(selected) - set(passed + failed)),
            'unexpectedTests': sorted(set(passed + failed) - set(selected)),
            'duplicateTests': sorted(name for name, count in Counter(passed + failed).items() if count > 1),
            'scannerRejected': scanner, 'exitCode': exit_code, 'timedOut': timed_out}


def run_startup(claude, plugin, scratch, env, deadline, first_remaining, timeout):
    """All fourteen SDK subprocesses spend the original shared serial budget."""
    plugin = Path(plugin)
    active = plugin / 'tests/startup.test.tsx'
    shim = active.with_name(SHIM_NAME)
    original = active.read_bytes()
    plans = batches(plugin, active)
    all_names = [name for _, names in plans for name in names]
    if shim.exists():
        raise RuntimeError('Startup scratch registrar path is already occupied')
    passed = failed = completed = status = 0
    observed = []
    accepted = True
    expired = False
    try:
        adapted = adapted_fixture(original)
        active.write_bytes(adapted)
        for index, (label, selected) in enumerate(plans):
            remaining = first_remaining if index == 0 else deadline - time.monotonic()
            if remaining <= 0:
                sys.stderr.write('run-tests.py: shared %d s deadline expired before startup batch %s\n' % (timeout, label))
                expired = True
                status = 1
                break
            shim_source = registrar(label, selected, all_names)
            shim.write_text(shim_source)
            sys.stdout.write('serial startup batch %s: %d original cases\n' % (label, len(selected)))
            sys.stdout.flush()
            try:
                result = subprocess.run([claude, 'plugin', 'test', str(plugin)], env=env,
                                        cwd=scratch, timeout=remaining, capture_output=True, text=True)
                stdout, stderr = result.stdout, result.stderr
                code = result.returncode
            except subprocess.TimeoutExpired as error:
                stdout, stderr = error.stdout, error.stderr
                code = 124
                expired = True
                sys.stderr.write('run-tests.py: shared %d s deadline stopped startup batch %s\n' % (timeout, label))
            decode = lambda value: value.decode('utf-8', errors='replace') if isinstance(value, bytes) else value or ''
            stdout, stderr = decode(stdout), decode(stderr)
            sys.stdout.write(stdout)
            sys.stderr.write(stderr)
            row = sdk_receipt(stdout + '\n' + stderr, selected, code, expired)
            row['fixtureAndRegistrarUnchanged'] = active.read_bytes() == adapted and shim.read_text() == shim_source
            row['accepted'] = row['accepted'] and row['fixtureAndRegistrarUnchanged']
            completed += 1
            observed.extend(row['passedTests'] + row['failedTests'])
            passed += len(row['passedTests'])
            failed += len(row['failedTests'])
            accepted = accepted and row['accepted']
            status = status or code or (0 if row['accepted'] else 1)
            summary = {key: value for key, value in row.items() if key not in {'passedTests', 'failedTests'}}
            summary.update(batch=label, expectedCases=len(selected), observedCases=len(row['passedTests'])+len(row['failedTests']))
            sys.stdout.write('M1_STARTUP_BATCH_RECEIPT ' + json.dumps(summary) + '\n')
            if expired:
                break
        exact = Counter(observed) == Counter(all_names)
        complete = exact and accepted and completed == 14
        sys.stdout.write('M1_STARTUP_COMPLETE ' + json.dumps({'accepted': complete, 'exact1412UniqueNames': exact,
            'expectedCases': 1412, 'observedCases': len(observed), 'completedBatches': completed,
            'expectedBatches': 14, 'originalFixtureSHA256': hashlib.sha256(original).hexdigest(),
            'sharedDeadlineSeconds': timeout}) + '\n')
        return {'status': status or (0 if complete else 1), 'passed': passed, 'failed': failed, 'expired': expired}
    finally:
        active.write_bytes(original)
        if shim.exists(): shim.unlink()
