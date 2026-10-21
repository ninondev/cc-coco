#!/usr/bin/env python3
"""Run native manifest/cache-identity regressions against the exact shipping loader, without Pet."""
from pathlib import Path
import hashlib
import os
import re
import shutil
import subprocess
import tempfile
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scratch import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[2]
sources = ROOT / 'plugin/companion/Sources'
fixture = (ROOT / 'tools/tests/companion-b3/main.swift').read_text()
# Exclude the optional compilation guard with the Pet helper: this harness keeps only
# the data helpers and must not inherit an unmatched #if from the input fixture.
prefix = re.split(r'(?:#if B3B\s*)?@MainActor func safePet', fixture, maxsplit=1)[0]
helpers = prefix + 'func writePNG' + fixture.split('func writePNG', 1)[1].split('let assets =', 1)[0]
identity = '    let manifest =' + fixture.split('    let manifest =', 1)[1].split('    frames.prepare(', 1)[0]
semantic = '    let semanticRoot =' + fixture.split('    let semanticRoot =', 1)[1].split('    // Exercise shipping input methods', 1)[0]
live = '    let root = scratch.appendingPathComponent("art")' + fixture.split('    let root = scratch.appendingPathComponent("art")', 1)[1].split('    print("cache bytes:', 1)[0]
pet = (sources / 'Pet.swift').read_text()
size = 'enum Size:' + pet.split('enum Size:', 1)[1].split('/// The idle animation', 1)[0]
with TemporaryDirectory(prefix='b3c-manifest-', dir=os.environ.get('TMPDIR')) as directory:
    work = Path(directory)
    for name in ['Frames.swift', 'Tuning.swift', 'WindowManners.swift', 'CompanionPhysics.swift', 'PointerMonitor.swift']:
        shutil.copy2(sources / name, work / name)
        print(name, 'SHA256', hashlib.sha256((work / name).read_bytes()).hexdigest(), flush=True)
    (work / 'Size.swift').write_text('import AppKit\n' + size)
    (work / 'main.swift').write_text(helpers + '''
let assets = URL(fileURLWithPath: CommandLine.arguments[1])
let scratch = URL(fileURLWithPath: CommandLine.arguments[2])
MainActor.assumeIsolated {
    let appearance = NSAppearance(named: ProcessInfo.processInfo.environment["COMPANION_APPEARANCE"] == "dark" ? .darkAqua : .aqua)!
    appearance.performAsCurrentDrawingAppearance {
    let t = CompanionTuning.load(try! Data(contentsOf: assets.appendingPathComponent("companion-tuning.json")))!
''' + identity + semantic + live + '''
    }
}
print("manifest regressions: \\(checks) checks, \\(failures) failures")
exit(failures == 0 ? 0 : 1)
''')
    env = dict(os.environ, HOME=str(work), CLAUDE_CONFIG_DIR=str(work / 'config'))
    binary = work / 'check'
    subprocess.run(['swiftc', '-O', '-swift-version', '5', '-module-cache-path', str(work / 'cache'),
                    *map(str, sorted(work.glob('*.swift'))), '-o', str(binary)], env=env, check=True)
    for appearance in ['light', 'dark']:
        scratch = work / appearance
        scratch.mkdir()
        print('Appearance:', appearance, flush=True)
        result = subprocess.run([str(binary), str(ROOT / 'plugin/assets'), str(scratch)],
                                env=dict(env, COMPANION_APPEARANCE=appearance), cwd=scratch)
        if result.returncode:
            raise SystemExit(result.returncode)
