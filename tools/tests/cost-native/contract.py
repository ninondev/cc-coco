#!/usr/bin/env python3
"""Run native CostRuntime checks and require assertion failures on broken copies."""
import argparse
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
MUTATIONS = {
    'W3': ('this.running || !this.visible', 'this.running || false'),
    'W4': ('this.baseline = c.turnBaseline(this.last)', 'this.baseline = { c0: null, window: null }'),
    'W6': ('settingsTtl: this.deps.settings.promptCacheTtl', 'settingsTtl: undefined'),
    'W9': ('return estimateOtherModel(model,', 'return 0; // return estimateOtherModel(model,'),
}

def run(root, promise):
    name = 'other-maker.test.ts' if promise == 'W9' else 'runtime.test.ts'
    return subprocess.run(['bun', '--no-env-file', 'test', str(root / 'tools/tests/cost-native' / name), '-t', f'^{promise} '], cwd=root, capture_output=True, text=True, timeout=45)

def summary(result):
    text = result.stdout + result.stderr
    print(text)
    return text

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('promise', choices=sorted(MUTATIONS))
    p.add_argument('--red', action='store_true')
    args = p.parse_args()
    green = run(ROOT, args.promise)
    text = summary(green)
    if green.returncode or not re.search(r'\b[1-9]\d* pass', text):
        return green.returncode or 1
    if not args.red:
        return 0
    with tempfile.TemporaryDirectory(prefix='k1-cost-native-red-') as temp:
        copy = Path(temp)
        shutil.copytree(ROOT / 'plugin/hooks/cost', copy / 'plugin/hooks/cost')
        (copy / 'plugin/assets').mkdir(parents=True)
        shutil.copy2(ROOT / 'plugin/assets/prices.json', copy / 'plugin/assets/prices.json')
        (copy / 'tools/tests/cost-native').mkdir(parents=True)
        shutil.copy2(ROOT / 'tools/tests/cost-native/runtime.test.ts', copy / 'tools/tests/cost-native/runtime.test.ts')
        shutil.copy2(ROOT / 'tools/tests/cost-native/other-maker.test.ts', copy / 'tools/tests/cost-native/other-maker.test.ts')
        source = copy / 'plugin/hooks/cost/runtime.ts'
        old, replacement = MUTATIONS[args.promise]
        content = source.read_text()
        if content.count(old) != 1:
            raise RuntimeError('controlled mutation target is missing or ambiguous')
        source.write_text(content.replace(old, replacement, 1))
        red = run(copy, args.promise)
        text = summary(red)
        assertion = f'(fail) {args.promise} ' in text and 'error: expect(received)' in text and re.search(r'\b[1-9]\d* fail', text)
        if red.returncode == 0 or not assertion or 'Unhandled error' in text:
            raise RuntimeError('broken source did not fail a promise assertion')
        print(f'{args.promise}: controlled source copy failed assertions (exit {red.returncode}); restored source was green')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
