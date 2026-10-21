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
    for name in ('SecureFiles.swift', 'RequestChannel.swift', 'Requests.swift', 'Motion.swift', 'Health.swift', 'PointerMonitor.swift'):
        source = options.source / name
        if source.exists():
            target = scratch / name
            shutil.copy2(source, target)
            sources.append(str(target))
    feed = (options.source / 'Feed.swift').read_text()
    (scratch / 'FeedRecords.swift').write_text(feed.split('@MainActor\nfinal class Feed {', 1)[0])
    sources.append(str(scratch / 'FeedRecords.swift'))
    pet = (options.source / 'Pet.swift').read_text()
    (scratch / 'Size.swift').write_text('import Foundation\n' + pet[pet.index('enum Size:'):pet.index('/// The idle animation')])
    sources.append(str(scratch / 'Size.swift'))
    shutil.copy2(ROOT / 'tools/tests/companion-security/main.swift', scratch / 'main.swift')
    flags = ['-D', 'SECURE_CURRENT'] if (options.source / 'SecureFiles.swift').exists() else []
    subprocess.run(['/usr/bin/xcrun', '--sdk', 'macosx', 'swiftc', '-swift-version', '5', *flags, '-module-cache-path', str(scratch / 'cache'), *sources, str(scratch / 'main.swift'), '-o', str(scratch / 'check')], env=env, check=True)
    raise SystemExit(subprocess.run([str(scratch / 'check'), str(scratch)], env=env).returncode)
