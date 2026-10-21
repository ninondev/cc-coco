#!/usr/bin/env python3
"""Console-only Swift library checks; never starts the production companion."""
from pathlib import Path
import argparse
import os, shutil, subprocess, tempfile
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scratch import TemporaryDirectory
ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--before', type=Path, help='Frozen B3 companion folder for cache/manifest fail-before')
parser.add_argument('--cache-only', action='store_true', help='Manifest and image-cache checks only')
parser.add_argument('--appearance', choices=['light','dark','both'], default='both', help='Run isolated explicit appearance processes')
args = parser.parse_args()
with TemporaryDirectory(prefix='b3-data-') as work:
    work = Path(work)
    env = dict(os.environ, HOME=str(work), CLAUDE_CONFIG_DIR=str(work / 'config'))
    sources = sorted(p for p in ((args.before or ROOT / 'plugin/companion') / 'Sources').glob('*.swift') if p.name != 'main.swift')
    snapshot = work / 'Sources'; snapshot.mkdir()
    for p in sources: shutil.copy2(p, snapshot / p.name)
    shutil.copy2(ROOT / 'tools/tests/companion-b3/main.swift', work / 'main.swift')
    binary = work / 'check'
    command = ['swiftc','-O','-swift-version','5','-module-cache-path',str(work / 'cache')]
    if not args.before: command += ['-D','B3B']
    subprocess.run(command + [*map(str,sorted(snapshot.glob('*.swift'))),str(work / 'main.swift'),'-o',str(binary)],env=env,check=True)
    appearances = ['light','dark'] if args.appearance == 'both' else [args.appearance]
    for appearance in appearances:
        scratch = work / appearance; scratch.mkdir()
        print('B3 appearance:',appearance,flush=True)
        result = subprocess.run([str(binary),str(ROOT / 'plugin/assets'),str(scratch)] + (['--cache-only'] if args.cache_only else []),
                                env=dict(env, COMPANION_APPEARANCE=appearance),cwd=scratch)
        if result.returncode: raise SystemExit(result.returncode)
