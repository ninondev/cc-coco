#!/usr/bin/env python3
"""Headless fixtures of the shipping settings and startup preparation paths."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scratch import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source', type=Path, default=ROOT / 'plugin/companion/Sources')
options = parser.parse_args()
with TemporaryDirectory(prefix='s2-settings-security-', dir=os.environ.get('TMPDIR')) as name:
    scratch = Path(name).resolve()
    env = dict(os.environ, HOME=str(scratch), CLAUDE_CONFIG_DIR=str(scratch / 'config'))
    sources = []
    for filename in ('SecureFiles.swift', 'RequestChannel.swift'):
        source = options.source / filename
        if source.exists():
            target = scratch / filename
            shutil.copy2(source, target)
            sources.append(str(target))
    app = (options.source / 'App.swift').read_text()
    trace = app[app.index('struct Trace {'):app.index('/// A reusable one-shot')]
    arguments = app[app.index('struct Options {'):app.index('/// Explicit opens')]
    store = app[app.index('@MainActor\nfinal class Store {'):app.index('@MainActor\nfinal class Companion:')]
    # Execute the complete, unchanged production folder/channel preparation stanza.
    # Surrounding app wiring and GUI launch are deliberately outside these fixtures.
    prepare = app.split('Claude.testPID = options.testPID\n', 1)[1].split('        scheduleRequestExpiry()', 1)[0]
    (scratch / 'Settings.swift').write_text('import AppKit\nimport Darwin\n' + trace + arguments + store
        + '\n@MainActor func prepareStartup(_ options: Options) -> RequestChannel? {\n'
        + '    var channel: RequestChannel?\n    let trace = Trace(on: false)\n' + prepare + '\n    return channel\n}\n')
    sources.append(str(scratch / 'Settings.swift'))
    pet = (options.source / 'Pet.swift').read_text()
    place = (options.source / 'Place.swift').read_text()
    (scratch / 'Values.swift').write_text('import AppKit\n'
        + pet[pet.index('enum Size:'):pet.index('/// The idle animation')]
        + place[place.index('enum Place {'):place.index('    /// What placing him needs')] + '}\n')
    sources.append(str(scratch / 'Values.swift'))
    neighbour = (options.source / 'Neighbours.swift').read_text()
    (scratch / 'NeighbourConfiguration.swift').write_text(neighbour.split('struct NeighbourQuota:', 1)[0])
    sources.append(str(scratch / 'NeighbourConfiguration.swift'))
    shutil.copy2(ROOT / 'tools/tests/companion-settings-security/main.swift', scratch / 'main.swift')
    subprocess.run(['/usr/bin/xcrun', '--sdk', 'macosx', 'swiftc', '-swift-version', '5',
                    '-module-cache-path', str(scratch / 'cache'), *sources, str(scratch / 'main.swift'),
                    '-o', str(scratch / 'check')], env=env, check=True)
    raise SystemExit(subprocess.run([str(scratch / 'check'), str(scratch)], env=env).returncode)
