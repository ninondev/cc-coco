#!/usr/bin/env python3
"""Fixture-only neighbours checks: no application launch or owner session reads."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scratch import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[2]


def process(command, env, scratch):
    """Keep execution failures and output in the receipt instead of aborting."""
    started = time.monotonic()
    record = {'command': command, 'exitCode': None, 'stdout': '', 'stderr': '',
              'state': 'not-started'}
    try:
        result = subprocess.run(command, env=env, cwd=scratch, capture_output=True,
                                text=True, encoding='utf-8', errors='replace', timeout=120)
        record.update(exitCode=result.returncode, stdout=result.stdout,
                      stderr=result.stderr, state='signaled' if result.returncode < 0 else 'exited')
        if result.returncode < 0:
            record['signal'] = -result.returncode
    except subprocess.TimeoutExpired as error:
        def text(value):
            return value.decode('utf-8', errors='replace') if isinstance(value, bytes) else value or ''
        record.update(stdout=text(error.stdout), stderr=text(error.stderr), state='timed-out',
                      error='process exceeded 120 seconds')
    except OSError as error:
        record['error'] = str(error)
    record['durationSeconds'] = time.monotonic() - started
    print(record['stdout'], end='', flush=True)
    print(record['stderr'], end='', file=sys.stderr, flush=True)
    if record.get('error'):
        print('FAIL:', record['error'], file=sys.stderr, flush=True)
    return record


def read_native(path, fixture):
    errors = []
    try:
        native = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, UnicodeError, ValueError) as error:
        return None, [f'native report unavailable or invalid: {error}']
    if not isinstance(native, dict):
        return native, ['native report must be an object']
    if native.get('status') == 'running':
        journal = Path(str(path) + '.checks.jsonl')
        recovered = []
        incomplete_tail = False
        recovery_errors = []
        try:
            with journal.open('rb') as handle:
                for index, line in enumerate(handle):
                    if not line.endswith(b'\n'):
                        incomplete_tail = True
                        break
                    try:
                        check = json.loads(line.decode('utf-8'))
                    except (UnicodeError, ValueError) as error:
                        recovery_errors.append(f'invalid journal record {index}: {error}')
                        break
                    if not isinstance(check, dict):
                        recovery_errors.append(f'journal record {index} must be an object')
                        break
                    recovered.append(check)
        except OSError as error:
            recovery_errors.append(f'check journal unavailable: {error}')
        if recovered:
            native['checkpointSummary'] = native.get('summary')
            native['checks'] = recovered
            measurements = recovered[-1].get('measurements')
            measurements = measurements if isinstance(measurements, dict) else {}
            summary = native.get('summary')
            native['summary'] = dict(summary if isinstance(summary, dict) else {},
                                     checks=len(recovered),
                                     failures=sum(check.get('passed') is False for check in recovered),
                                     bytesRead=measurements.get('bytesRead'),
                                     writes=measurements.get('writes'))
            native['events'] = []
            for check in recovered:
                values = check.get('measurements')
                events = values.get('eventsSincePreviousCheck') if isinstance(values, dict) else None
                if isinstance(events, list):
                    native['events'].extend(events)
        native['journalRecovery'] = {'path': str(journal), 'checksRecovered': len(recovered),
                                     'ignoredIncompleteTail': incomplete_tail,
                                     'errors': recovery_errors}
        errors.extend(recovery_errors)
    if native.get('schemaVersion') != 1:
        errors.append('native report schemaVersion must be 1')
    if native.get('fixture') != fixture:
        errors.append(f'native report fixture must be {fixture}')
    if native.get('status') not in ('passed', 'failed', 'blocked'):
        errors.append('native report status must be passed, failed, or blocked')
    checks = native.get('checks')
    if not isinstance(checks, list):
        errors.append('native report checks must be an array')
    else:
        for index, check in enumerate(checks):
            if not isinstance(check, dict) or not all(key in check for key in ('id', 'name', 'passed', 'measurements')):
                errors.append(f'native check {index} is missing required fields')
            elif not isinstance(check['passed'], bool) or not isinstance(check['measurements'], dict):
                errors.append(f'native check {index} has invalid passed or measurements')
        if native.get('status') == 'passed' and (not checks or any(
                not isinstance(check, dict) or check.get('passed') is not True for check in checks)):
            errors.append('passed native report must contain passing checks')
        if native.get('status') != 'failed' and any(
                isinstance(check, dict) and check.get('passed') is False for check in checks):
            errors.append('a failed native check requires failed status')
    if not isinstance(native.get('summary'), dict):
        errors.append('native report summary must be an object')
    return native, errors


def run_fixture(binary, scratch, config, fixture, env):
    folder = scratch / fixture
    folder.mkdir()
    native_path = folder / 'native-report.json'
    command = [str(binary), str(folder), str(config), '--report', str(native_path)]
    if fixture != 'default':
        command.append('--' + fixture)
    result = process(command, env, folder)
    result['fixture'] = fixture
    native, errors = read_native(native_path, fixture)
    result['nativeReport'] = native
    native_status = native.get('status') if isinstance(native, dict) else None
    code = result['exitCode']
    if code == 0 and native_status != 'passed':
        errors.append('exit 0 requires a passed native report')
    elif fixture == 'real-fsevents' and code == 77:
        if native_status != 'blocked':
            errors.append('real FSEvents exit 77 requires a blocked native report')
    elif code != 0 and native_status != 'failed':
        errors.append('unsuccessful execution requires a failed native report')
    if result.get('error'):
        errors.append(result['error'])
    result['errors'] = errors
    result['status'] = 'failed' if errors else native_status
    print(f'Fixture {fixture}: {result["status"]}; exit {code}', flush=True)
    return result


def run(scratch, report):
    env = dict(os.environ, HOME=str(scratch / 'home'),
               CLAUDE_CONFIG_DIR=str(scratch / 'claude-config'), TMPDIR=str(scratch))
    Path(env['HOME']).mkdir()
    Path(env['CLAUDE_CONFIG_DIR']).mkdir()
    sources = scratch / 'sources'
    sources.mkdir()
    inputs = (ROOT / 'plugin/companion/Sources/Neighbours.swift',
              ROOT / 'plugin/companion/Sources/SecureFiles.swift',
              ROOT / 'tools/tests/companion-neighbours-native/main.swift',
              ROOT / 'plugin/assets/neighbours.json',
              ROOT / 'tools/tests/companion-neighbours-native/captured-events.swift')
    snapshots = {}
    for source in inputs:
        data = source.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        report['sourceHashes'][str(source.relative_to(ROOT))] = digest
        snapshot = sources / source.name
        snapshot.write_bytes(data)
        snapshots[source.name] = snapshot
    report['sourceHashes']['tools/tests/companion-neighbours.py'] = hashlib.sha256(
        Path(__file__).read_bytes()).hexdigest()
    report['sourceSHA256'] = report['sourceHashes']['plugin/companion/Sources/Neighbours.swift']
    print('Neighbours source SHA256:', report['sourceSHA256'], flush=True)
    binary = scratch / 'checks'
    compiled = process(['swiftc', '-O', '-swift-version', '5', '-D', 'NEIGHBOURS_FIXTURE',
                        '-module-cache-path', str(scratch / 'cache'),
                        str(snapshots['Neighbours.swift']), str(snapshots['SecureFiles.swift']),
                        str(snapshots['captured-events.swift']), str(snapshots['main.swift']), '-o', str(binary)], env, scratch)
    report['compiler'] = compiled
    if compiled['exitCode'] != 0:
        report['errors'].append('native fixture compilation failed')
        return
    # Every fixture gets its own roots. A failure must not hide independent real delivery evidence.
    for fixture in report['requestedFixtures']:
        try:
            report['fixtures'].append(run_fixture(binary, scratch, snapshots['neighbours.json'], fixture, env))
        except (OSError, ValueError) as error:
            report['fixtures'].append({'fixture': fixture, 'status': 'failed', 'state': 'not-started',
                                       'exitCode': None, 'stdout': '', 'stderr': '', 'nativeReport': None,
                                       'errors': [f'fixture setup failed: {error}']})


def finish(report, require_fsevents):
    for fixture in report['fixtures']:
        native = fixture.get('nativeReport')
        if isinstance(native, dict):
            checks = native.get('checks', [])
            if isinstance(checks, list):
                report['checks'].extend(dict(check, fixture=fixture['fixture'])
                                        for check in checks if isinstance(check, dict))
            report['measurements'][fixture['fixture']] = native.get('summary')
    failed = bool(report['errors']) or any(item['status'] == 'failed' for item in report['fixtures'])
    blocked = any(item['status'] == 'blocked' for item in report['fixtures'])
    report['status'] = 'failed' if failed else 'blocked' if blocked else 'passed'
    report['overallResult'] = report['status']
    report['exitCode'] = 1 if failed else 77 if blocked and require_fsevents else 0
    report['summary'] = {
        'requestedFixtures': len(report['requestedFixtures']), 'executedFixtures': len(report['fixtures']),
        'checks': len(report['checks']),
        'passedChecks': sum(check.get('passed') is True for check in report['checks']),
        'failedChecks': sum(check.get('passed') is False for check in report['checks']),
    }
    if blocked:
        print('BLOCKED: real FSEvents unavailable; explicit fixture assertions are not real delivery evidence', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report', type=Path, help='write aggregate JSON evidence, including failures')
    parser.add_argument('--require-fsevents', action='store_true', help='exit 77 when real FSEvents is blocked')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--malformed-probe', action='store_true', help='run only the malformed-prefix probe')
    mode.add_argument('--event-replay', action='store_true', help='run only the captured-event regression fixture')
    options = parser.parse_args()
    report = {'schemaVersion': 1, 'sourceSHA256': None, 'sourceHashes': {},
              'requestedFixtures': ['malformed-probe'] if options.malformed_probe else
                                   ['event-replay'] if options.event_replay else
                                   ['default', 'real-fsevents', 'malformed-probe', 'event-replay'],
              'compiler': None, 'fixtures': [], 'checks': [], 'measurements': {}, 'errors': []}
    started = time.monotonic()
    try:
        with TemporaryDirectory(prefix='b3-neighbours-', dir=os.environ.get('TMPDIR')) as directory:
            run(Path(directory).resolve(), report)
    except (OSError, ValueError) as error:
        report['errors'].append(f'runner setup failed: {error}')
        print('FAIL:', report['errors'][-1], file=sys.stderr, flush=True)
    finish(report, options.require_fsevents)
    report['durationSeconds'] = time.monotonic() - started
    if options.report:
        try:
            options.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        except OSError as error:
            print(f'FAIL: cannot write aggregate report: {error}', file=sys.stderr, flush=True)
            return 1
    return report['exitCode']


if __name__ == '__main__':
    raise SystemExit(main())
