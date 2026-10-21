#!/usr/bin/env python3
"""Run W1/W7/W8 and reject controlled broken copies. Run W8 inside the heavy lane."""
import argparse
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
WARM = 'plugin/hooks/cost/warm/'
RUNTIME = 'plugin/hooks/cost/warm-runtime.ts'


def run(root, promise):
    files = {
        'W1': ['runtime.test.ts'],
        'W7': ['runtime.test.ts', 'keeper-arm.test.ts', 'keeper-stops.test.ts',
               'keeper-rereads.test.ts', 'keeper-return.test.ts', 'lock.test.ts',
               'vendor-regressions.test.ts'],
        'W8': ['sim.test.ts'],
    }[promise]
    return subprocess.run(['bun', '--no-env-file', 'test', *[
        str(root / 'tools/tests/cc-warm' / file) for file in files]],
        cwd=root, capture_output=True, text=True, timeout=120)


def mutations(promise):
    if promise == 'W1':
        return [('default-on', RUNTIME,
                 "enabled = record(await deps.store.get('more')).warm === true && !closed && !heldOff()",
                 'enabled = true && !closed && !heldOff()')]
    if promise == 'W8':
        return [('budget-ignored-in-simulation', WARM + 'sim.ts', 'if (spent + k > delta) break', 'if (false) break')]
    return [
        ('off', WARM + 'keeper.ts', 'if (!switchOn()) {', 'if (false) {'),
        ('turn-timer', WARM + 'keeper.ts', "if (state === 'armed') {\n      clearTimer()", "if (false) {\n      clearTimer()"),
        ('newest', WARM + 'keeper.ts', 'if (!isNewest()) {', 'if (false) {'),
        ('sleep', WARM + 'keeper.ts', 'if (t >= warmUntil - SLEEP_GUARD_MS) {', 'if (false) {'),
        ('screen-lock', WARM + 'keeper.ts', "if (lock === 'locked') {", 'if (false) {'),
        ('duration-cap', WARM + 'keeper.ts', 'if (t + TTL_MS[ttl] > pauseStart + cap) {', 'if (false) {'),
        ('budget', WARM + 'keeper.ts', 'if (spent + k > delta) {', 'if (false) {'),
        ('plan-window', WARM + 'keeper.ts', 'if (w !== null && w >= WINDOW_STOP_PERCENT) {', 'if (false) {'),
        ('reset', WARM + 'keeper.ts', 'if (resetFlag) {', 'if (false) {'),
        ('fork-error', WARM + 'keeper.ts', 'if (!succeeded || usage === null) {', 'if (false) {'),
        ('fork-hit-share', WARM + 'keeper.ts', 'if (usage.cacheRead < HIT_SHARE * prefix) {', 'if (false) {'),
        ('fork-output', WARM + 'keeper.ts', 'if (usage.output > MAX_REREAD_OUTPUT) {', 'if (false) {'),
        ('one-computer-fork', RUNTIME, 'if (inFlight.has(machine)) return { ok: false }', 'if (false) return { ok: false }'),
        ('cold-return-hold', RUNTIME, 'if (verdict.notHeld) {', 'if (false) {'),
    ]


def summary(result):
    output = result.stdout + result.stderr
    rows = re.findall(r'^\s*(?:\d+ (?:pass|fail|expect\(\) calls)|Ran \d+ tests.*)$', output, re.MULTILINE)
    return '; '.join(row.strip() for row in rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('promise', choices=['W1', 'W7', 'W8'])
    parser.add_argument('--red', action='store_true')
    args = parser.parse_args()
    green = run(ROOT, args.promise)
    print(f'{args.promise} green: exit {green.returncode}; {summary(green)}')
    if green.returncode:
        print(green.stdout + green.stderr)
        return green.returncode
    if not args.red:
        return 0
    for name, path, old, new in mutations(args.promise):
        with tempfile.TemporaryDirectory(prefix='k1-warm-red-') as temp:
            copy = Path(temp)
            for folder in ['plugin/hooks/cost/warm', 'tools/tests/cc-warm']:
                shutil.copytree(ROOT / folder, copy / folder)
            shutil.copy2(ROOT / RUNTIME, copy / RUNTIME)
            source = copy / path
            content = source.read_text()
            if content.count(old) == 0:
                raise RuntimeError(f'{name}: mutation target absent')
            source.write_text(content.replace(old, new, 1))
            result = run(copy, args.promise)
            print(f'{args.promise} {name}: exit {result.returncode} (expected nonzero); {summary(result)}')
            # A broken module that does not compile is not evidence that the
            # behavioral assertion works. Bun's summary must include failures.
            if result.returncode == 0 or ' fail' not in result.stdout + result.stderr:
                print(result.stdout + result.stderr)
                return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
