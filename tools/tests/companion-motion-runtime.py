#!/usr/bin/env python3
"""Actual Pet/layers on fake geometry with no presented windows or production entry point."""
import os, shutil, subprocess, tempfile
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scratch import TemporaryDirectory
ROOT = Path(__file__).resolve().parents[2]
with TemporaryDirectory(prefix='b3c-runtime-', dir=os.environ.get('TMPDIR')) as folder:
    scratch = Path(folder)
    env = dict(os.environ, HOME=folder, CLAUDE_CONFIG_DIR=str(scratch/'config'))
    sources=scratch/'Sources'; sources.mkdir()
    for p in (ROOT/'plugin/companion/Sources').glob('*.swift'):
        if p.name!='main.swift': shutil.copy2(p,sources/p.name)
    p=sources/'Pet.swift'
    p.write_text(p.read_text()+'''\n// Scratch-only access to exact shipping state; no production test hooks.\nextension Pet {
 var testRig: LookView { lookView }
 var testHitFrame: CGRect { hit.frame }
 var testLookFrame: CGRect { look.frame }
 var testClingFaceAt: Double? { clingFaceOnAt }
 var testClingStopAt: Double? { clingFaceStopAt }
 var testClingOpenAt: Double? { clingFaceOpenAt }
 var testVisible: Bool { logicalVisible }
 var testTarget: Place.Target? { retainedTarget }
 var testSqueezeFace: Bool { squeezeFace }
 var testPointerMonitor: Bool { pointerMonitor != nil }
 var testFade: CompanionPointerFade { speechFade }
 var testGlance: String? { glanceFace }
 var testCardWidth: CGFloat? { card?.view.bounds.width }
 var testPlacement: Bool { relocating }
 func testHideHour() { hideForAnHour() }
 func testCard(_ target:Place.Target) { cardWanted = true; placeCard(target) }
 func testPutBack() { putBack() }
 func testFinishHourWave() { finishHourWave() }
 func testGreeting() { returnGreeting = false; showReaction(Reactor.Reaction(key:"wave",frame:"wave",hold:1,line:nil,lineHold:1)) }
 func testFinishPop() { lookView.place.removeAllAnimations(); cancelEntry(); refreshRigFiltering() }
 func testDisplayOptions() { displayOptionsMoved() }
}\n''')
    shutil.copy2(ROOT/'tools/tests/companion-motion-runtime/main.swift',scratch/'main.swift')
    binary=scratch/'check'
    subprocess.run(['swiftc','-O','-swift-version','5','-module-cache-path',str(scratch/'cache'),*map(str,sorted(sources.glob('*.swift'))),str(scratch/'main.swift'),'-o',str(binary)],env=env,check=True)
    for appearance in ('light','dark'):
        work=scratch/appearance;work.mkdir()
        subprocess.run([str(binary),str(ROOT/'plugin/assets'),str(work),appearance],env=dict(env,TMPDIR=str(work)),cwd=work,check=True)
