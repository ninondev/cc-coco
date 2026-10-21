#!/usr/bin/env python3
"""Console-only tests of production B3 helpers; no application or permission request."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scratch import TemporaryDirectory
ROOT = Path(__file__).resolve().parents[2]
def main():
    with TemporaryDirectory(prefix='b3-window-') as folder:
        return run(Path(folder).resolve())

def run(scratch):
    env = dict(os.environ, HOME=str(scratch), CLAUDE_CONFIG_DIR=str(scratch / 'config'))
    sources = ROOT / 'plugin/companion/Sources'
    # Freeze exact shipping class, without Claude/FollowPermission and their app dependencies.
    drag = (sources / 'Claude.swift').read_text().split('// Where the Claude desktop app')[0]
    (scratch / 'WindowDragEvents.swift').write_text(drag)
    for name in ['WindowManners.swift', 'Health.swift', 'PointerMonitor.swift', 'SecureFiles.swift']:
        shutil.copy2(sources / name, scratch / name)
    shutil.copy2(ROOT / 'tools/tests/companion-window/main.swift', scratch / 'main.swift')
    binary = scratch / 'check'
    compile_result = subprocess.run(['swiftc', '-O', '-swift-version', '5', '-module-cache-path', str(scratch / 'cache'), *map(str, sorted(scratch.glob('*.swift'))), '-o', str(binary)], env=env, capture_output=True, text=True)
    print(compile_result.stdout + compile_result.stderr, end='')
    if compile_result.returncode:
        return compile_result.returncode
    run = subprocess.run([str(binary), str(scratch)], env=env, capture_output=True, text=True)
    print(run.stdout + run.stderr, end='')
    print('scratch:', scratch)
    # Logs outside this driver retain the evidence; generated build fixtures are discarded.
    return run.returncode
if __name__ == '__main__': raise SystemExit(main())
