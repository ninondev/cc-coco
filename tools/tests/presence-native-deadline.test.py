#!/usr/bin/env python3
"""Real follower deadline protocol tests; no shipped artifact is rewritten."""
import argparse
import os
from pathlib import Path
import selectors
import subprocess
import sys
import tempfile
import time
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scratch import TemporaryDirectory

parser = argparse.ArgumentParser()
parser.add_argument('--binary', required=True, type=Path)
args, rest = parser.parse_known_args()


class Follower:
    def __init__(self, folder, token='owner', enabled=True):
        self.folder = folder
        self.control = folder / f'.presence-deadline-{token}.jsonl'
        self.requests = folder / 'requests.jsonl'
        self.requests.write_text('')
        argv = [str(args.binary), str(folder), 'follow', token, str(self.requests), '', '']
        if enabled:
            argv.append(str(self.control))
        self.child = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.selector = selectors.DefaultSelector()
        self.selector.register(self.child.stdout, selectors.EVENT_READ)
        self.data = bytearray()
        self.collect_until(lambda: f'READY\t{token}\n'.encode() in self.data)

    def collect(self, seconds):
        stop = time.monotonic() + seconds
        while time.monotonic() < stop:
            if self.selector.select(max(0, stop - time.monotonic())):
                chunk = os.read(self.child.stdout.fileno(), 65536)
                if not chunk:
                    raise AssertionError(f'follower exited {self.child.poll()}: {self.child.stderr.read()}')
                self.data.extend(chunk)

    def collect_until(self, condition, seconds=3):
        stop = time.monotonic() + seconds
        while not condition():
            if time.monotonic() >= stop:
                raise AssertionError('native output condition timed out: ' + repr(bytes(self.data[-300:])))
            self.collect(min(.03, stop - time.monotonic()))

    def arm(self, generation, delay_ms):
        at = int(time.time() * 1000) + delay_ms if delay_ms else 0
        self.control.write_text(f'{generation}\t{at}\n')
        return at

    def deadlines(self):
        return [line for line in self.data.decode().splitlines() if line.startswith('DEADLINE\t')]

    def close(self):
        self.child.terminate()
        try:
            self.child.wait(timeout=2)
        except subprocess.TimeoutExpired:
            self.child.kill()
            self.child.wait(timeout=2)
        self.selector.close()
        self.child.stdout.close()
        self.child.stderr.close()


class NativeDeadlineTests(unittest.TestCase):
    def setUp(self):
        self.scratch = TemporaryDirectory(prefix='presence-deadline-')
        self.folder = Path(self.scratch.name).resolve()
        self.reader = Follower(self.folder)

    def tearDown(self):
        self.reader.close()
        self.scratch.cleanup()

    def test_capability_and_once_with_exact_channel(self):
        self.assertEqual(self.reader.data.decode().splitlines()[0], f'FOLLOW\t{self.reader.child.pid}\tDEADLINE1')
        at = self.reader.arm(1, 100)
        self.reader.collect_until(lambda: bool(self.reader.deadlines()))
        self.reader.collect(.15)
        self.assertEqual(self.reader.deadlines(), [f'DEADLINE\t1\t{at}'])
        self.assertIn(f'\n==> {self.reader.control} <==\nDEADLINE\t1\t{at}\n'.encode(), self.reader.data)
        self.reader.control.write_text(f'1\t{at}\n')
        self.reader.collect(.1)
        self.assertEqual(len(self.reader.deadlines()), 1)

    def test_cancel_and_new_generation_replace_old_deadline(self):
        self.reader.arm(1, 100)
        self.reader.collect(.02)
        self.reader.arm(2, 0)
        self.reader.collect(.15)
        self.assertEqual(self.reader.deadlines(), [])
        at = self.reader.arm(3, 180)
        self.reader.collect(.02)
        newer = self.reader.arm(4, 80)
        self.reader.collect(.22)
        self.assertEqual(self.reader.deadlines(), [f'DEADLINE\t4\t{newer}'])
        self.assertNotIn(f'DEADLINE\t3\t{at}', self.reader.data.decode())

    def test_replaced_file_and_stale_generation(self):
        self.reader.arm(10, 180)
        self.reader.collect(.03)
        at = int(time.time() * 1000) + 80
        replacement = self.folder / 'replacement'
        replacement.write_text(f'11\t{at}\n')
        replacement.replace(self.reader.control)
        self.reader.collect(.22)
        self.assertEqual(self.reader.deadlines(), [f'DEADLINE\t11\t{at}'])
        self.reader.arm(9, 30)
        self.reader.collect(.08)
        self.assertEqual(len(self.reader.deadlines()), 1)

    def test_incomplete_or_embedded_nul_command_cannot_fire(self):
        self.reader.arm(1, 100)
        self.reader.collect(.02)
        self.reader.control.write_text('2\t0')
        self.reader.collect(.13)
        self.assertEqual(self.reader.deadlines(), [])
        self.reader.control.write_bytes(b'2\t1\n\0trailing')
        self.reader.collect(.08)
        self.assertEqual(self.reader.deadlines(), [])
        self.reader.control.write_text('2\t0\n')
        self.reader.collect(.04)
        at = self.reader.arm(3, 60)
        self.reader.collect_until(lambda: bool(self.reader.deadlines()))
        self.assertEqual(self.reader.deadlines(), [f'DEADLINE\t3\t{at}'])

    def test_revalidate_after_output_backpressure(self):
        self.reader.arm(1, 120)
        self.reader.collect(.02)
        self.reader.requests.write_text('x' * 1048576 + '\n')
        time.sleep(.15)  # Deliberately do not drain the real follower stdout pipe.
        self.reader.arm(2, 0)
        at = self.reader.arm(3, 120)
        state = self.folder / 'next-snapshot'
        state.write_text('snapshot-after-stall\n')
        state.replace(self.folder / 'snapshot.json')
        self.reader.collect_until(lambda: bool(self.reader.deadlines()))
        self.reader.collect(.1)
        self.assertEqual(self.reader.deadlines(), [f'DEADLINE\t3\t{at}'])
        self.assertIn(b'snapshot-after-stall\n', self.reader.data)

    def test_legacy_header_unchanged(self):
        self.reader.close()
        self.reader = Follower(self.folder, 'legacy', enabled=False)
        self.assertEqual(self.reader.data.decode().splitlines()[0], f'FOLLOW\t{self.reader.child.pid}')

    def test_armed_deadline_full_pipe_cannot_block_host_death(self):
        folder = self.folder / 'host-death'
        folder.mkdir(mode=0o700)
        requests = folder / 'requests.jsonl'
        requests.write_text('')
        control = folder / '.presence-deadline-host.jsonl'
        control.write_text(f'1\t{int(time.time() * 1000) + 3000}\n')
        host_code = 'import subprocess,sys,time; p=subprocess.Popen(sys.argv[1:],stdout=subprocess.PIPE); print(p.pid,flush=True); time.sleep(60)'
        host = subprocess.Popen([sys.executable, '-c', host_code, str(args.binary), str(folder), 'follow', 'host', str(requests), '', '', str(control)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        pid = int(host.stdout.readline())
        try:
            stop = time.monotonic() + 3
            while not (folder / '.presence-follow-host.jsonl').exists():
                self.assertLess(time.monotonic(), stop, 'follower readiness timed out')
                time.sleep(.01)
            requests.write_text('x' * 1048576 + '\n')
            time.sleep(.1)
            host.kill()
            host.wait(timeout=2)
            stop = time.monotonic() + 2
            while True:
                try:
                    os.kill(pid, 0)
                except ProcessLookupError:
                    break
                self.assertLess(time.monotonic(), stop, 'full-pipe follower survived host death with armed deadline')
                time.sleep(.01)
        finally:
            if host.poll() is None:
                host.kill()
                host.wait(timeout=2)
            host.stdout.close()
            host.stderr.close()
            try:
                os.kill(pid, 9)
            except ProcessLookupError:
                pass


if __name__ == '__main__':
    unittest.main(argv=[__file__, *rest])
