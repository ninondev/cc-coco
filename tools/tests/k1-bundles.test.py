#!/usr/bin/env python3
"""Verify both generated modules and reject changed canonical source copies."""
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from hooks_source import hook_directory

ROOT = Path(__file__).resolve().parents[2]
# The canonical cost source: plugin/hooks-source here, source/hooks in the public tree.
HOOKS = hook_directory(ROOT / 'plugin').relative_to(ROOT)

def check(root, script):
    return subprocess.run(['python3', str(root / 'tools' / script), '--check'],
                          cwd=root, capture_output=True, text=True, timeout=45)

def main():
    scripts = ('build-cost-units.py', 'build-cost-runtime.py')
    for script in scripts:
        result = check(ROOT, script)
        print(f'{script} shipping: exit {result.returncode}')
        if result.returncode:
            print(result.stdout + result.stderr)
            return result.returncode
    with tempfile.TemporaryDirectory(prefix='k1-bundles-red-') as folder:
        copy = Path(folder)
        shutil.copytree(ROOT / HOOKS / 'cost', copy / HOOKS / 'cost')
        (copy / 'tools').mkdir()
        for name in (*scripts, 'cost-units-entry.ts', 'hooks_source.py'):
            shutil.copy2(ROOT / 'tools' / name, copy / 'tools' / name)
        for script in scripts:
            result = check(copy, script)
            if result.returncode:
                raise RuntimeError('Bundle is not deterministic across scratch roots: ' + result.stdout + result.stderr)
        for script, relative in zip(scripts, ('core/index.ts', 'runtime.ts')):
            source = copy / HOOKS / 'cost' / relative
            original = source.read_text()
            source.write_text(original + '\n// Controlled stale source fixture.\n')
            result = check(copy, script)
            source.write_text(original)
            if result.returncode != 1 or 'is stale' not in result.stdout:
                raise RuntimeError('Changed canonical source was not rejected: ' + result.stdout + result.stderr)
            print(f'{script} controlled changed-source copy: exit 1; stale artifact rejected')
    print('2 shipping checks green; 2 changed-source copies red; 2 scratch-root parity checks green')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
