#!/usr/bin/env python3
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scratch import TemporaryDirectory
ROOT = Path(__file__).resolve().parents[2]
p = argparse.ArgumentParser()
p.add_argument('--source', type=Path, default=ROOT / 'plugin/companion/Sources')
options = p.parse_args()
with TemporaryDirectory(prefix='s2-swift-security-', dir=os.environ.get('TMPDIR')) as scratch_name:
    scratch = Path(scratch_name).resolve()
    env = dict(os.environ, HOME=str(scratch), CLAUDE_CONFIG_DIR=str(scratch / 'config'))
    sources = []
    for name in ('SecureFiles.swift', 'RequestChannel.swift', 'Requests.swift', 'Motion.swift', 'Health.swift', 'PointerMonitor.swift',
                 'DmThread.swift', 'QuotaPixels.swift', 'NewChat.swift'):
        source = options.source / name
        if source.exists():
            target = scratch / name
            shutil.copy2(source, target)
            sources.append(str(target))
    feed = (options.source / 'Feed.swift').read_text()
    (scratch / 'FeedRecords.swift').write_text(feed.split('@MainActor\nfinal class Feed {', 1)[0])
    sources.append(str(scratch / 'FeedRecords.swift'))
    # The feed records also name value types that live in drawing files: take those types alone.
    if (options.source / 'D1.swift').exists():
        d1 = (options.source / 'D1.swift').read_text()
        (scratch / 'D1Records.swift').write_text('import Foundation\n' + d1[d1.index('struct D1Helper:'):d1.index('enum D1Away {')])
        sources.append(str(scratch / 'D1Records.swift'))
    if (options.source / 'PlayShake.swift').exists():
        play = (options.source / 'PlayShake.swift').read_text()
        (scratch / 'Stick.swift').write_text('import Foundation\n' + play[play.index('struct Stick:'):play.index('/// His stick, small')])
        sources.append(str(scratch / 'Stick.swift'))
    pet = (options.source / 'Pet.swift').read_text()
    (scratch / 'Size.swift').write_text('import Foundation\n' + pet[pet.index('enum Size:'):pet.index('/// The idle animation')])
    sources.append(str(scratch / 'Size.swift'))
    shutil.copy2(ROOT / 'tools/tests/companion-security/main.swift', scratch / 'main.swift')
    flags = ['-D', 'SECURE_CURRENT'] if (options.source / 'SecureFiles.swift').exists() else []
    subprocess.run(['/usr/bin/xcrun', '--sdk', 'macosx', 'swiftc', '-swift-version', '5', *flags, '-module-cache-path', str(scratch / 'cache'), *sources, str(scratch / 'main.swift'), '-o', str(scratch / 'check')], env=env, check=True)
    raise SystemExit(subprocess.run([str(scratch / 'check'), str(scratch)], env=env).returncode)
