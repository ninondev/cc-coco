#!/usr/bin/env python3
"""Measure shipping mouse-down up to its first committed transform; no screen/input use."""
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
parser.add_argument('--before', type=Path, help='Frozen B3 companion folder')
parser.add_argument('--appearance', choices=('light', 'dark', 'both'), default='both')
args = parser.parse_args()
with TemporaryDirectory(prefix='b3-touch-latency-') as directory:
    work = Path(directory)
    env = dict(os.environ, HOME=directory, CLAUDE_CONFIG_DIR=str(work / 'config'))
    sources = work / 'Sources'
    sources.mkdir()
    for path in sorted(((args.before or ROOT / 'plugin/companion') / 'Sources').glob('*.swift')):
        if path.name != 'main.swift':
            shutil.copy2(path, sources / path.name)
    # Add the same clock-only probe to each copied generation at the actual first-frame commit.
    # Fail if the seam changes; no production source contains this fixture callback.
    path = sources / 'Pet.swift'
    source = path.read_text()
    property_anchor = '    var pointerPosition: () -> NSPoint = { NSEvent.mouseLocation }'
    commit_anchor = 'CATransaction.begin(); CATransaction.setDisableActions(true); picture.transform = first; CATransaction.commit()'
    if source.count(property_anchor) != 1 or source.count(commit_anchor) != 1:
        raise SystemExit('Shipping first-frame measurement seam changed')
    source = source.replace(property_anchor, property_anchor + '\n    var fixtureFirstFrame: () -> Void = {}')
    source = source.replace(commit_anchor, commit_anchor + '; fixtureFirstFrame()')
    path.write_text(source)
    shutil.copy2(ROOT / 'tools/tests/companion-touch-latency/main.swift', work / 'main.swift')
    binary = work / 'fixture'
    command = ['swiftc', '-O', '-swift-version', '5', '-module-cache-path', str(work / 'cache')]
    if not args.before:
        command += ['-D', 'B3B']
    subprocess.run(command + [*map(str, sorted(sources.glob('*.swift'))), str(work / 'main.swift'), '-o', str(binary)], env=env, check=True)
    failures = 0
    for appearance in (('light', 'dark') if args.appearance == 'both' else (args.appearance,)):
        print('Appearance:', appearance, flush=True)
        result = subprocess.run([str(binary), str(ROOT / 'plugin/assets'), str(work)], env=dict(env, COMPANION_TEST_APPEARANCE=appearance), cwd=work)
        failures = failures or result.returncode
    raise SystemExit(failures)
