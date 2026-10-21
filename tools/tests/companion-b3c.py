#!/usr/bin/env python3
"""Ride selection and actual Store/Pet saves in fixtures; never launches Companion/main.swift."""
from pathlib import Path
import argparse
import os
import shutil
import subprocess
import tempfile
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scratch import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--appearance', choices=('both', 'light', 'dark'), default='both')
parser.add_argument('--placement-only', action='store_true', help='Pure production placement helpers only; independent of app integration')
args = parser.parse_args()
with TemporaryDirectory(prefix='companion-b3c-', dir=os.environ.get('TMPDIR', '/private/tmp')) as name:
    # SecureDirectory walks the real path: on macOS TMPDIR sits under /var, a link to /private/var.
    scratch = Path(name).resolve()
    env = dict(os.environ, HOME=str(scratch), CLAUDE_CONFIG_DIR=str(scratch / 'config'))
    snapshot = scratch / 'Sources'
    snapshot.mkdir()
    sources = ROOT / 'plugin/companion/Sources'
    test_main = (ROOT / 'tools/tests/companion-b3c/main.swift').read_text()
    if args.placement_only:
        for name in ['Place.swift', 'CompanionPhysics.swift', 'Tuning.swift', 'WindowManners.swift', 'PointerMonitor.swift']:
            shutil.copy2(sources / name, snapshot / name)
        around = (sources / 'Around.swift').read_text()
        hover = around[around.index('struct HoverState {'):around.index('/// Shared ink')]
        labels = around[around.index('enum ButtonLabelPlacement {'):around.index('/// The drawing metrics')]
        (snapshot / 'AroundHelpers.swift').write_text('import AppKit\n' + hover + labels)
        claude = (sources / 'Claude.swift').read_text()
        sighting = claude[claude.index('    enum Sighting:'):claude.index('    private(set) var sighting')]
        (snapshot / 'ClaudeSighting.swift').write_text('import AppKit\nenum Claude {\n' + sighting + '}\n')
        placement = test_main[test_main.index('    let motion = CompanionMotionTuning.standard'):test_main.index('    let file = scratch.appendingPathComponent("companion.json")')]
        (scratch / 'main.swift').write_text('import AppKit\nimport Darwin\nvar checks = 0, failures = 0\nfunc expect(_ value: Bool, _ label: String) { checks += 1; if !value { failures += 1; print("FAIL: \\(label)") } }\nMainActor.assumeIsolated {\n' + placement + '}\nprint("companion-b3c placement: \\(checks) checks, \\(failures) failures")\nexit(failures == 0 ? 0 : 1)\n')
    else:
        for source in sources.glob('*.swift'):
            if source.name != 'main.swift':
                shutil.copy2(source, snapshot / source.name)
        (scratch / 'main.swift').write_text(test_main)
    binary = scratch / 'check'
    subprocess.run(['swiftc', '-O', '-swift-version', '5', '-module-cache-path', str(scratch / 'cache'),
                    *map(str, sorted(snapshot.glob('*.swift'))), str(scratch / 'main.swift'), '-o', str(binary)],
                   env=env, cwd=scratch, check=True)
    appearances = ('light', 'dark') if args.appearance == 'both' else (args.appearance,)
    for appearance in appearances:
        folder = scratch / appearance
        folder.mkdir()
        subprocess.run([str(binary), str(ROOT / 'plugin/assets'), str(folder), appearance],
                       env=dict(env, TMPDIR=str(folder)), cwd=folder, check=True)
