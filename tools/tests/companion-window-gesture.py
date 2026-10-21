#!/usr/bin/env python3
"""Exercise the shipping gesture class and native event-order fixture without any windows."""
from pathlib import Path
import hashlib
import os
import subprocess
import tempfile
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scratch import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[2]
production = (ROOT / 'plugin/companion/Sources/Claude.swift').read_text()
native = (ROOT / 'tools/tests/companion-native/main.swift').read_text()
gesture = production.split('// Where the Claude desktop app')[0]
fixture = native.split('@MainActor\nfunc windowDragChecks', 1)[1].split('@MainActor\nfunc followupChecks', 1)[0]
fixture = '@MainActor\nfunc windowDragChecks' + fixture
print('Production gesture SHA256:', hashlib.sha256(gesture.encode()).hexdigest(), flush=True)
print('Native fixture SHA256:', hashlib.sha256(fixture.encode()).hexdigest(), flush=True)
with TemporaryDirectory(prefix='b3c-window-gesture-', dir=os.environ.get('TMPDIR')) as directory:
    work = Path(directory)
    (work / 'WindowDragEvents.swift').write_text(gesture)
    (work / 'main.swift').write_text('import AppKit\n' + fixture + '''
var checks = 0, failures = 0
MainActor.assumeIsolated {
    windowDragChecks { valid, label in
        checks += 1
        if !valid { failures += 1; print("FAIL: \\(label)") }
    }
}
print("window gesture: \\(checks) checks, \\(failures) failures")
exit(failures == 0 ? 0 : 1)
''')
    env = dict(os.environ, HOME=str(work), CLAUDE_CONFIG_DIR=str(work / 'config'))
    binary = work / 'check'
    subprocess.run(['swiftc', '-O', '-swift-version', '5', '-module-cache-path', str(work / 'cache'),
                    str(work / 'WindowDragEvents.swift'), str(work / 'main.swift'), '-o', str(binary)],
                   env=env, check=True)
    for appearance in ['light', 'dark']:
        print('Appearance:', appearance, flush=True)
        result = subprocess.run([str(binary)], env=dict(env, COMPANION_APPEARANCE=appearance), cwd=work)
        if result.returncode:
            raise SystemExit(result.returncode)
