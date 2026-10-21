#!/usr/bin/env python3
"""Console-only native presence/feed checks. No application is launched."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scratch import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[2]
with TemporaryDirectory(prefix='b3-presence-') as work:
    scratch = Path(work).resolve()
    work = str(scratch)
    env = dict(os.environ, HOME=work, CLAUDE_CONFIG_DIR=str(scratch / 'config'))
    sources = scratch / 'sources'
    sources.mkdir()
    # Compile the real transport and feed in isolation from concurrent UI edits. The two
    # dependency declarations are copied verbatim from production, not replacement mocks.
    folder = ROOT / 'plugin/companion/Sources'
    for name in ('Feed.swift', 'PresenceObserver.swift', 'SecureFiles.swift', 'Motion.swift', 'Requests.swift',
                 'DmThread.swift', 'NewChat.swift', 'QuotaPixels.swift', 'PlayShake.swift'):
        shutil.copy2(folder / name, sources / name)
    app = (folder / 'App.swift').read_text()
    pet = (folder / 'Pet.swift').read_text()
    dependencies = app[:app.index('struct Options {')] + '\n' + pet[pet.index('enum Size:'):pet.index('enum IdleBlink {')]
    # Feed payload model declarations are copied verbatim; omit D1 UI/services.
    d1 = (folder / 'D1.swift').read_text()
    dependencies += '\n' + d1[:d1.index('enum D1Away {')]
    (sources / 'Dependencies.swift').write_text(dependencies)
    shutil.copy2(ROOT / 'tools/tests/companion-presence-b3/main.swift', scratch / 'main.swift')
    command = ['swiftc', '-j', '4', '-O', '-swift-version', '5', '-module-cache-path', str(scratch / 'cache'),
               *map(str, sources.glob('*.swift')), str(scratch / 'main.swift'), '-o', str(scratch / 'checks')]
    compiled = subprocess.run(command, env=env, capture_output=True, text=True)
    print(compiled.stdout, end='')
    print(compiled.stderr, end='')
    print('Compile exit:', compiled.returncode)
    if compiled.returncode:
        raise SystemExit(compiled.returncode)
    raise SystemExit(subprocess.run([str(scratch / 'checks'), work], env=env, cwd=work).returncode)
