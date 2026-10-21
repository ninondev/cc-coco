#!/usr/bin/env python3
"""Run legacy-compatible sleeping-input checks; compile every library source, never app main."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scratch import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--baseline', type=Path, help='frozen companion folder or its Sources directory')
parser.add_argument('--screen-safe', action='store_true', help='suppress presentation; no window is shown or system input injected')
parser.add_argument('--appearance', choices=('light', 'dark', 'both'), default='both')
args = parser.parse_args()
source = args.baseline or ROOT / 'plugin/companion'
source = source / 'Sources' if (source / 'Sources').is_dir() else source
with TemporaryDirectory(prefix='b3-awake-common-') as work:
    scratch = Path(work)
    env = dict(os.environ, HOME=work, CLAUDE_CONFIG_DIR=str(scratch / 'config'))
    frozen = scratch / 'Sources'
    frozen.mkdir()
    originals = sorted(path for path in source.glob('*.swift') if path.name != 'main.swift')
    if not originals:
        raise SystemExit('No companion library sources found')
    for path in originals:
        shutil.copy2(path, frozen / path.name)
    shutil.copy2(ROOT / 'tools/tests/companion-awake-common/main.swift', scratch / 'main.swift')
    binary = scratch / 'console-checks'
    command = ['swiftc', '-O', '-swift-version', '5', '-module-cache-path', str(scratch / 'cache'),
               *map(str, sorted(frozen.glob('*.swift'))), str(scratch / 'main.swift'), '-o', str(binary)]
    if args.screen_safe:
        command[1:1] = ['-D', 'SCREEN_SAFE']
    print('Frozen library source count:', len(originals), flush=True)
    compiled = subprocess.run(command, env=env, capture_output=True, text=True)
    print(compiled.stdout, end='')
    print(compiled.stderr, end='')
    print('Compile exit:', compiled.returncode, flush=True)
    if compiled.returncode:
        raise SystemExit(compiled.returncode)
    failures = 0
    for appearance in (('light', 'dark') if args.appearance == 'both' else (args.appearance,)):
        print('Appearance:', appearance, flush=True)
        result = subprocess.run([str(binary), str(ROOT / 'plugin/assets'), work], env=dict(env, COMPANION_TEST_APPEARANCE=appearance), cwd=work)
        print('Console check exit:', result.returncode, flush=True)
        failures = failures or result.returncode
    raise SystemExit(failures)
