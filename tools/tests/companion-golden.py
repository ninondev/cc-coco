#!/usr/bin/env python3
"""Compare the shipping Swift model to the immutable approved motion trajectories; no app launch."""
from pathlib import Path
import argparse
import json
import os
import shutil
import subprocess
import tempfile
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scratch import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--appearance', choices=['light', 'dark', 'both'], default='both')
args = parser.parse_args()
fixture = ROOT / 'tools/tests/companion-golden'
approved = json.loads((fixture / 'tuning.json').read_text())
shipping = json.loads((ROOT / 'plugin/assets/companion-tuning.json').read_text())['motion']
if shipping != approved:
    raise SystemExit('shipping motion tuning differs from approved122 values/comments')
print('approved tuning:122 values plus123 unchanged metadata entries', flush=True)
with TemporaryDirectory(prefix='b3c-golden-', dir=os.environ.get('TMPDIR')) as work:
    scratch = Path(work)
    env = dict(os.environ, HOME=str(scratch), CLAUDE_CONFIG_DIR=str(scratch / 'config'))
    sources = ROOT / 'plugin/companion/Sources'
    for name in ['WindowManners.swift', 'Tuning.swift', 'CompanionPhysics.swift', 'PointerMonitor.swift']:
        shutil.copy2(sources / name, scratch / name)
    shutil.copy2(fixture / 'main.swift', scratch / 'main.swift')
    binary = scratch / 'check'
    subprocess.run(['swiftc', '-O', '-swift-version', '5', '-module-cache-path', str(scratch / 'cache'), *map(str, sorted(scratch.glob('*.swift'))), '-o', str(binary)], env=env, check=True)
    appearances = ['light', 'dark'] if args.appearance == 'both' else [args.appearance]
    for appearance in appearances:
        subprocess.run([str(binary), str(fixture), str(ROOT / 'plugin/assets'), str(scratch), appearance], env=env, cwd=scratch, check=True)
