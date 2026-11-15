#!/usr/bin/env python3
"""Compile the real Mac pet and test character line routing without launching its UI.

Uses a scratch voice file only; the user's HOME and running pet are untouched.
"""
from pathlib import Path
import hashlib
import json
import os
import subprocess
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scratch import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[2]
with TemporaryDirectory(prefix='companion-lines-') as folder:
    scratch = Path(folder).resolve()
    subprocess.run(['bun', str(ROOT / 'tools/tests/companion-lines/transport.ts'), str(scratch)], check=True)
    control = scratch / 'control'
    subprocess.run(['/usr/bin/xcrun', '--sdk', 'macosx', 'clang', '-std=c11', '-Wall', '-Wextra', '-Werror',
                    str(ROOT / 'plugin/bin/companion-control.c'), '-o', str(control)], check=True)
    for fixture in json.loads((scratch / 'fixtures.json').read_text()):
        book = (scratch / (fixture['name'] + '.book.json')).read_bytes()
        assert fixture['file'] == 'lines-' + hashlib.sha256(book).hexdigest() + '.json'
        subprocess.run([str(control), 'write-lines', str(scratch), fixture['file']], input=book, check=True)
        assert (scratch / fixture['file']).read_bytes() == book
        feed = (scratch / (fixture['name'] + '.feed.json')).read_bytes()
        subprocess.run([str(control), 'write-shared', str(scratch), 'view.json'], input=feed, check=True)
        assert (scratch / 'view.json').read_bytes() == feed
        if fixture['name'] == 'large-book':
            assert len(book) > 1_048_576
            assert subprocess.run([str(control), 'write-shared', str(scratch), 'view.json'], input=book).returncode != 0
            assert (scratch / 'view.json').read_bytes() == feed
        print('PASS native writer round-trip', fixture['name'], len(book), 'bytes', flush=True)
    outside = scratch / 'outside'
    outside.write_bytes(b'untouched')
    unsafe = scratch / ('lines-' + 'a' * 64 + '.json')
    for hardlink in (False, True):
        if hardlink: os.link(outside, unsafe)
        else: unsafe.symlink_to(outside)
        assert subprocess.run([str(control), 'write-lines', str(scratch), unsafe.name], input=b'bad').returncode != 0
        assert outside.read_bytes() == b'untouched'
        unsafe.unlink()
    for name in ('../outside', 'voice.json', 'lines-' + 'A' * 64 + '.json'):
        assert subprocess.run([str(control), 'write-lines', str(scratch), name], input=b'bad').returncode != 0
    print('PASS line writer rejects traversal, unrelated names, symlinks and hardlinks', flush=True)
    sources = [str(p) for p in sorted((ROOT / 'plugin/companion/Sources').glob('*.swift')) if p.name != 'main.swift']
    binary = scratch / 'check'
    subprocess.run(['swiftc', '-j', '4', '-swift-version', '5', '-module-cache-path', str(scratch / 'cache'),
                    *sources, str(ROOT / 'tools/tests/companion-lines/main.swift'), '-o', str(binary)], check=True)
    subprocess.run([str(binary), str(scratch)], check=True, timeout=30)
