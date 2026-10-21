#!/usr/bin/env python3
"""Run W2/W9 and verify their assertions reject controlled broken source copies."""
import argparse
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]

def run(root, promise):
    files = ['runtime.test.ts', 's16-response.test.ts'] if promise == 'W2' else ['parse.test.ts', 'date-regression.test.ts', 'generator.test.ts', 'tier.test.ts']
    return subprocess.run(['bun', '--no-env-file', 'test', '--no-install', '--max-concurrency', '4', *[str(root / 'tools/tests/cc-prices' / f) for f in files]], cwd=root, capture_output=True, text=True, timeout=45)

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('promise', choices=['W2', 'W9'])
    p.add_argument('--red', action='store_true')
    args = p.parse_args()
    green = run(ROOT, args.promise)
    print(green.stdout + green.stderr)
    if green.returncode:
        return green.returncode
    if not args.red:
        return 0
    mutations = [
        ('opening-latch', 'plugin/hooks/cost/prices/runtime.ts', 'if (opened) return', 'if (false) return'),
        ('other-response-bytes', 'plugin/hooks/cost/prices/load.ts', 'if (!otherResponseWithinLimit(text))', 'if (false)'),
    ] if args.promise == 'W2' else [
        ('ratio-guard', 'plugin/hooks/cost/prices/page.ts', 'const ok =', 'const ok = true ||'),
        ('release-age', 'tools/build-prices.py', 'if (last - first).days > 14:', 'if False:'),
        ('tier-split', 'plugin/hooks/cost/prices/ids.ts', 'promptTokens > row.over.above', 'false'),
    ]
    for name, path, old, new in mutations:
        with tempfile.TemporaryDirectory(prefix='k1-prices-red-') as temp:
            copy = Path(temp)
            for folder in ['plugin/hooks/cost/prices', 'tools/tests/cc-prices']:
                shutil.copytree(ROOT / folder, copy / folder)
            (copy / 'tools').mkdir(exist_ok=True)
            shutil.copy2(ROOT / 'tools/build-prices.py', copy / 'tools/build-prices.py')
            (copy / 'plugin/assets').mkdir(parents=True)
            shutil.copy2(ROOT / 'plugin/assets/prices.json', copy / 'plugin/assets/prices.json')
            source = copy / path
            content = source.read_text()
            if old not in content:
                raise RuntimeError(f'{name}: mutation target absent')
            source.write_text(content.replace(old, new, 1))
            result = run(copy, args.promise)
            print(f'{args.promise} {name}: exit {result.returncode} (expected nonzero)')
            print(result.stdout + result.stderr)
            if result.returncode == 0:
                return 1
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
