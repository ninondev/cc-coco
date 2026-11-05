#!/usr/bin/env python3
"""Measure a console library fixture, not the production companion process."""
from pathlib import Path
import argparse
import os
import shutil
import subprocess
import tempfile
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scratch import TemporaryDirectory
import runpy
fixture_helpers = runpy.run_path(str(Path(__file__).resolve().parent / 'companion-fixture.py'))

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--baseline', type=Path, help='Frozen pre-change companion folder')
parser.add_argument('--before', type=Path, help='Frozen B3 companion folder, before B3b cache changes')
parser.add_argument('--original-frames', type=Path, help='Frozen original Frames.swift, with the same console fixture')
args = parser.parse_args()
if sum(bool(value) for value in (args.baseline, args.before, args.original_frames)) > 1:
    parser.error('Choose one baseline source')
if args.original_frames:
    parser.error('--original-frames measured retired bitmap APIs; use a Coco-capable --baseline instead')
source_root = (args.baseline or args.before or ROOT / 'plugin/companion') / 'Sources'
with TemporaryDirectory(prefix='b3-resources-') as directory:
    work = Path(directory)
    assets = fixture_helpers['stage_assets'](ROOT, work)
    env = dict(os.environ, HOME=str(work), CLAUDE_CONFIG_DIR=str(work / 'config'))
    sources = work / 'Sources'
    sources.mkdir()
    # Preserve the original fixture's full library link context, excluding production main.
    # The measurement exercises CocoPlayer and CocoPaint.
    for path in sorted(source_root.glob('*.swift')):
        if path.name != 'main.swift':
            shutil.copy2(path, sources / path.name)
    shutil.copy2(ROOT / 'tools/tests/companion-resources/main.swift', work / 'main.swift')
    command = ['swiftc', '-O', '-swift-version', '5', '-module-cache-path', str(work / 'cache')]
    if not args.baseline and not args.original_frames:
        command += ['-D', 'B3']
    if not args.baseline and not args.before and not args.original_frames:
        command += ['-D', 'B3B']
    command += [*map(str, sorted(sources.glob('*.swift'))), str(work / 'main.swift'), '-o', str(work / 'fixture')]
    subprocess.run(command, env=env, check=True)
    subprocess.run([str(work / 'fixture'), str(assets)], env=env, cwd=work, check=True)
