#!/usr/bin/env python3
"""Check Activity focus, native button dismissal, draft retention, and keyboard entry."""
from pathlib import Path
import os
import subprocess
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scratch import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[2]
with TemporaryDirectory(prefix='companion-activity-focus-', dir=os.environ.get('TMPDIR', '/private/tmp')) as folder:
    scratch = Path(folder)
    sources = [str(p) for p in sorted((ROOT / 'plugin/companion/Sources').glob('*.swift')) if p.name != 'main.swift']
    binary = scratch / 'check'
    subprocess.run(['swiftc', '-j', '4', '-O', '-swift-version', '5', '-module-cache-path', str(scratch / 'cache'),
                    *sources, str(ROOT / 'tools/tests/companion-activity-focus/main.swift'), '-o', str(binary)], check=True)
    subprocess.run([str(binary)], check=True, timeout=30)
