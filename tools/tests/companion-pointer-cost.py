#!/usr/bin/env python3
"""Actual fade logic on synthetic pointer events; never starts production or injects system input."""
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
parser.add_argument('--appearance', choices=['light', 'dark', 'both'], default='both')
parser.add_argument('--pure-only', action='store_true', help='Extract shipping fade model without compiling app integration')
parser.add_argument('--functional-only', action='store_true', help='Skip synthetic CPU pacing and run the pointer/meter regressions')
args = parser.parse_args()
sources = ROOT / 'plugin/companion/Sources'
# Inspect only the shipping input path and its reusable single-fire scheduler.
app = (sources / 'App.swift').read_text()
one_shot = app[app.index('final class OneShot {'):app.index('struct Options {')]
if 'repeating:' in one_shot or 'Timer.scheduledTimer' in one_shot:
    raise SystemExit('one-shot scheduler unexpectedly repeats')
rig = (sources / 'CompanionRig.swift').read_text()
fade = rig[rig.index('struct CompanionPointerFade {'):]
if any(value in fade for value in ['Timer(', 'DispatchSource.makeTimerSource', 'NSEvent.mouseLocation', 'CVDisplayLink']):
    raise SystemExit('pure pointer model unexpectedly owns a timer or pointer polling')
print('static event proof: fade owns no timer/poll/display link; OneShot has no repeating interval', flush=True)
with TemporaryDirectory(prefix='b3c-pointer-', dir=os.environ.get('TMPDIR')) as work:
    scratch = Path(work).resolve()  # SecureDirectory walks the real path (/var is a link on macOS)
    env = dict(os.environ, HOME=str(scratch), CLAUDE_CONFIG_DIR=str(scratch / 'config'))
    snapshot = scratch / 'Sources'; snapshot.mkdir()
    if args.pure_only:
        for name in ['WindowManners.swift', 'Tuning.swift', 'CompanionPhysics.swift', 'PointerMonitor.swift']:
            shutil.copy2(sources / name, snapshot / name)
        (snapshot / 'PointerFade.swift').write_text('import Foundation\n' + fade)
    else:
        for source in sources.glob('*.swift'):
            if source.name != 'main.swift':
                shutil.copy2(source, snapshot / source.name)
        pet = snapshot / 'Pet.swift'
        pet.write_text(pet.read_text() + '''
extension Pet {
 var testSpeechFade: CompanionPointerFade { speechFade }
 var testPillFade: CompanionPointerFade { bubbleFade }
 var testMeterArmed: Bool { pointerMeter.isArmed }
 func testArmMeter() { pointerMeter.arm(form: tuning.pointer.near, enabled: tuning.pointer.meter) }
 func testDisarmMeter() { stopPointerMonitor() }
 func testLeaveReducedPill(at: Double) { leaveReducedPointerPill(at: at) }
 func testBlockedSpriteExit() { activityPresented = true; pointer(.sprite, inside: false); activityPresented = false }
 func testHideExtras() { hideExtras() }
 func testHideAll() { hide() }
 var testPillAlpha: Float { bubble.contentView?.layer?.opacity ?? 1 }
}
''')
    shutil.copy2(ROOT / 'tools/tests/companion-pointer-cost/main.swift', scratch / 'main.swift')
    binary = scratch / 'check'
    flags = [] if args.pure_only else ['-D', 'POINTER_FULL']
    subprocess.run(['swiftc', '-O', '-swift-version', '5', '-module-cache-path', str(scratch / 'cache'), *flags,
                    *map(str, sorted(snapshot.glob('*.swift'))), str(scratch / 'main.swift'), '-o', str(binary)], env=env, check=True)
    for appearance in (['light', 'dark'] if args.appearance == 'both' else [args.appearance]):
        for form in ['reduced', 'full']:
            folder = scratch / (appearance + '-' + form); folder.mkdir()
            extra = ['--functional-only'] if args.functional_only else []
            subprocess.run([str(binary), appearance, str(folder), str(ROOT / 'plugin/assets'), form, *extra], env=env, cwd=folder, check=True)
