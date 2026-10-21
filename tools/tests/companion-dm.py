#!/usr/bin/env python3
"""The Mac pet's DM thread without AppKit (plugin/companion/Sources/DmThread.swift): the record's dm reads as the Rust
pet reads it, her notices are taken once while fresh, and the bubbles lay out as the Rust pet's. Needs only swiftc and
Foundation, so it runs on a Mac and on Linux."""
from pathlib import Path
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
swiftc = shutil.which('swiftc')
if not swiftc:
    print('SKIPPED companion-dm: swiftc required')
    sys.exit(0)
with tempfile.TemporaryDirectory(prefix='companion-dm-', dir=os.environ.get('TMPDIR')) as name:
    scratch = Path(name)
    binary = scratch / 'check'
    subprocess.run([swiftc, '-O', '-swift-version', '5', '-module-cache-path', str(scratch / 'cache'),
                    str(ROOT / 'plugin/companion/Sources/DmThread.swift'),
                    str(ROOT / 'tools/tests/companion-dm/main.swift'), '-o', str(binary)], cwd=scratch, check=True)
    sys.exit(subprocess.run([str(binary)], cwd=scratch).returncode)
