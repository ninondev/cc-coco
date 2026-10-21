#!/usr/bin/env python3
"""Activity's quota foot without AppKit (plugin/companion/Sources/QuotaPixels.swift): the battery and power bank rows
equal quota.ts's (the fixture tools/tests/quota-pixels.test.tsx checks), the windows parse as the Rust pet reads them,
and the words and moments come out as the Rust pet writes them. Needs only swiftc and Foundation, so it runs on a
Mac and on Linux."""
from pathlib import Path
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
swiftc = shutil.which('swiftc')
if not swiftc:
    print('SKIPPED companion-quota: swiftc required')
    sys.exit(0)
with tempfile.TemporaryDirectory(prefix='companion-quota-', dir=os.environ.get('TMPDIR')) as name:
    scratch = Path(name)
    binary = scratch / 'check'
    subprocess.run([swiftc, '-O', '-swift-version', '5', '-module-cache-path', str(scratch / 'cache'),
                    str(ROOT / 'plugin/companion/Sources/QuotaPixels.swift'),
                    str(ROOT / 'tools/tests/companion-quota/main.swift'), '-o', str(binary)], cwd=scratch, check=True)
    words = ROOT / 'plugin/companion-rs/assets/words'
    result = subprocess.run([str(binary), str(ROOT / 'plugin/companion-rs/tests/fixtures/quota-pixels.json'),
                             str(words / 'quota.json'), str(words / 'languages.json')], cwd=scratch)
    sys.exit(result.returncode)
