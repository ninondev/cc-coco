#!/usr/bin/env python3
"""Compile the shipping hash function alone; compare 10,000 native draws with JS.

Each --language run builds only one fixture, under the project's heavy lane.
No application or window is launched; the fixture is deleted at exit.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
BASE = 1_791_014_400_000


def function(source, declaration):
    start = source.index(declaration)
    opening = source.index('{', start)
    depth = 1
    end = opening + 1
    while depth:
        depth += (source[end] == '{') - (source[end] == '}')
        end += 1
    return source[start:end]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--language', choices=('rust', 'swift'), required=True)
    args = parser.parse_args()
    edges = [0, 2**32 - 1, 2**32, 8_640_000_000_000_000]
    quiets = list(range(BASE, BASE + 10000)) + edges
    javascript = subprocess.run([
        shutil.which('bun') or 'bun', '--no-env-file', '-e',
        "import {sleepAfter} from './plugin/hooks/sleep.ts'; console.log(JSON.stringify(Array.from({length:10000},(_,i)=>" + str(BASE) + "+i).concat(" + json.dumps(edges) + ").map(sleepAfter)))",
    ], cwd=ROOT, capture_output=True, text=True, check=True)
    expected = json.loads(javascript.stdout)
    with tempfile.TemporaryDirectory(prefix='m1p2-native-sleep-', dir=os.environ['TMPDIR']) as work:
        scratch = Path(work)
        binary = scratch / 'check'
        if args.language == 'rust':
            source = (ROOT / 'plugin/companion-rs/src/protocol.rs').read_text()
            assert 'Some(self.quiet_at + sleep_after(self.quiet_at))' in source
            assert 'now - self.quiet_at >= delay' in source
            assert 'self.set_event("sleep", self.quiet_at + delay)' in source
            body = function(source, 'pub fn sleep_after(')
            main_source = body + f'\nfn main(){{for stamp in ({BASE}u64..{BASE + 10000}u64).chain([' + ','.join(str(at) for at in edges) + ']) {println!("{}",sleep_after(stamp as f64));}}'
            path = scratch / 'check.rs'
            path.write_text(main_source)
            command = ['rustc', '--edition=2021', str(path), '-o', str(binary)]
        else:
            source = (ROOT / 'plugin/companion/Sources/PresenceObserver.swift').read_text()
            assert 'quiet + Double(presenceSleepAfter(Int64(quiet)))' in source
            assert 'let delay = presenceSleepAfter(quietAt)' in source
            assert 'event("sleep", quietAt + delay)' in source
            assert 'return quiet + 150_000' in source
            body = function(source, 'func presenceSleepAfter(')
            main_source = body + f'\nfor stamp in Int64({BASE})..<Int64({BASE + 10000}) {{ print(presenceSleepAfter(stamp)) }}\nfor stamp in [' + ','.join('Int64(' + str(at) + ')' for at in edges) + '] { print(presenceSleepAfter(stamp)) }'
            path = scratch / 'main.swift'
            path.write_text(main_source)
            command = ['swiftc', '-swift-version', '5', '-num-threads', '4', '-module-cache-path', str(scratch / 'cache'), str(path), '-o', str(binary)]
        subprocess.run(command, check=True)
        native = subprocess.run([str(binary)], capture_output=True, text=True, check=True)
        values = [int(value) for value in native.stdout.splitlines()]
        assert values == expected, 'native sleep delays differ from shipping JavaScript'
        print(f'{args.language}: {len(quiets)} parity cases pass, 0 fail; deadline call sites pass')


if __name__ == '__main__':
    main()
