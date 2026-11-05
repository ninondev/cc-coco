#!/usr/bin/env python3
"""The presence transport tests finish in very deep plugin and data folders (paths of 120 to 1000 characters).

Cause of the old hang (tools/tests/presence-real.ts, the test harness, not the plugin): each session's claim records
the path of its helper, so with a plugin path of about 120 characters and the 24 sessions of the concurrent-writers
test one commit line grew past 8192 bytes. The harness handed it to the helper's FIFO with one blocking write. A
blocking write larger than the pipe holds wakes a kqueue reader for its first part only (measured on this Mac:
nothing wakes the reader for the rest), so the helper waited for ever. The plugin never writes that way: its
fifo-send verb writes without blocking, 16384 characters at a time. The harness now writes in 4096-byte pieces.
This test runs presence-real.ts on copies of the plugin's hooks and bin folders at long paths.
"""
import argparse
import os
import shutil
import signal
import subprocess
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scratch import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--plugin', type=Path, default=ROOT / 'plugin')
args, rest = parser.parse_known_args()
# (length of the plugin folder's path, length of the evidence folder's path); 0 keeps the short default.
# The longest file the run reads is 36 characters below the plugin folder, and macOS stops paths at 1023 characters.
CASES = ((120, 0), (147, 0), (400, 0), (980, 0), (0, 900), (147, 140))
WALL = 150  # seconds; only a hang reaches it (the run itself takes about five)


def deep_directory(base, total):
    """A directory under base whose whole path is `total` characters long (60-character components)."""
    path = str(base)
    while len(path) < total - 1:
        path += '/' + 'd' * min(total - len(path) - 1, 60)
    os.makedirs(path, mode=0o700, exist_ok=True)
    return Path(path)


@unittest.skipIf(os.name == 'nt', 'the POSIX transport is not used on Windows')
class DeepPaths(unittest.TestCase):
    def test_transport_tests_finish_at_long_paths(self):
        bun = shutil.which('bun')
        self.assertTrue(bun, 'bun is required to run the real presence transport tests')
        for plugin_length, out_length in CASES:
            with self.subTest(plugin=plugin_length, out=out_length), TemporaryDirectory(prefix='presence-deep-') as name:
                base = Path(name).resolve()
                plugin = (deep_directory(base / 'p', plugin_length - len('/plugin')) if plugin_length else base / 'p') / 'plugin'
                out = deep_directory(base / 'o', out_length) if out_length else base / 'o'
                plugin.mkdir(parents=True, exist_ok=True)
                out.mkdir(parents=True, exist_ok=True)
                for part in ('hooks', 'bin'):
                    shutil.copytree(args.plugin / part, plugin / part, symlinks=True)
                self.assertEqual(len(str(plugin)), plugin_length or len(str(plugin)))
                self.assertGreaterEqual(len(str(out)), out_length - 1)
                child = subprocess.Popen([bun, str(ROOT / 'tools/tests/presence-real.ts'), str(plugin), str(out)],
                                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, start_new_session=True)
                try:
                    output, _ = child.communicate(timeout=WALL)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    output, _ = child.communicate()
                    self.fail(f'presence-real.ts hung at plugin path {len(str(plugin))}, out path {len(str(out))}:\n' + output[-1500:])
                finally:
                    try:
                        os.killpg(child.pid, signal.SIGKILL)  # nothing of its group may outlive it
                    except ProcessLookupError:
                        pass
                self.assertEqual(child.returncode, 0, output[-2500:])
                self.assertIn('"failed":0', output)


if __name__ == '__main__':
    unittest.main(argv=[__file__, *rest], verbosity=2)
