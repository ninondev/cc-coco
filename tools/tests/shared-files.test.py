#!/usr/bin/env python3
"""Exercise the actual fixed host scripts against throwaway shared folders only."""
import base64
import os
import concurrent.futures
import json
import os
import pathlib
import re
import subprocess
import tempfile
import threading
import time
import unittest
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from hooks_source import hook_source
from scratch import TemporaryDirectory

ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCE = Path(os.environ.get('S2_SHARED_SOURCE', hook_source(ROOT / 'plugin/hooks/shared-files.ts'))).read_text()
HELPER = ROOT / 'plugin/bin/companion-control'


def script(name):
    match = re.search(r'export const ' + name + r' = String\.raw`([^`]+)`', SOURCE)
    assert match, name
    return match.group(1)


ATOMIC = script('ATOMIC_WRITE')
DIAGNOSTIC = script('DIAGNOSTIC_APPEND')
CAP = 200 * 1024


def run(code, folder, text, name=None, env=None):
    argv = ['/bin/sh', '-c', code, 'coco', str(folder)]
    if name is not None:
        argv.append(name)
    argv.extend([str(HELPER), str(ROOT / "plugin/bin/presence.sh")])
    return subprocess.run(argv, input=text, text=True, capture_output=True, timeout=3, env=env)


class SharedFiles(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory(prefix='coco-shared-files-')
        self.addCleanup(self.tmp.cleanup)
        self.folder = pathlib.Path(self.tmp.name).resolve() / 'Library/Application Support/Coco'
        self.folder.mkdir(parents=True)

    def test_direct_writer_reproduces_partial_json(self):
        """The previous direct-write protocol exposes an incomplete document to readers."""
        target = self.folder / 'view.json'
        entered, release = threading.Event(), threading.Event()
        payload = json.dumps({'session': 'baseline', 'text': 'x' * 32000})

        def previous_writer():
            with target.open('w') as output:
                output.write(payload[:64])
                output.flush()
                entered.set()
                self.assertTrue(release.wait(2))
                output.write(payload[64:])

        writer = threading.Thread(target=previous_writer)
        writer.start()
        try:
            self.assertTrue(entered.wait(2))
            with self.assertRaises(json.JSONDecodeError):
                json.loads(target.read_text())
        finally:
            release.set()
            writer.join(2)
        self.assertEqual(json.loads(target.read_text())['session'], 'baseline')

    def test_four_sessions_write_only_complete_json(self):
        target = self.folder / 'view.json'
        target.write_text(json.dumps({'session': 'initial'}))
        start = threading.Barrier(5)
        observed = 0

        def session(number):
            start.wait()
            for sequence in range(12):
                text = json.dumps({'session': number, 'sequence': sequence, 'text': 'x' * 32000})
                result = run(ATOMIC, self.folder, text, 'view.json')
                self.assertEqual(result.returncode, 0, result.stderr)

        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            futures = [pool.submit(session, number) for number in range(4)]
            start.wait()
            while any(not future.done() for future in futures):
                record = json.loads(target.read_text())
                self.assertIn(record['session'], ['initial', 0, 1, 2, 3])
                observed += 1
                time.sleep(0.0005)
            for future in futures:
                future.result()
        self.assertGreater(observed, 0)
        self.assertFalse(list(self.folder.glob('.view.*')))

    def test_atomic_write_does_not_recreate_a_missing_folder_or_accept_other_targets(self):
        missing = self.folder / 'uninstalled'
        self.assertNotEqual(run(ATOMIC, missing, '{}', 'view.json').returncode, 0)
        self.assertFalse(missing.exists())
        self.assertNotEqual(run(ATOMIC, self.folder, '{}', '../outside.json').returncode, 0)
        self.assertFalse((self.folder.parent / 'outside.json').exists())

    def test_diagnostics_off_creates_nothing_and_turning_off_stops_writes(self):
        missing = self.folder / 'missing'
        self.assertEqual(run(DIAGNOSTIC, missing, '{}\n').returncode, 0)
        self.assertFalse(missing.exists())
        record = json.dumps({'step': 'register'}) + '\n'
        self.assertEqual(run(DIAGNOSTIC, self.folder, record).returncode, 0)
        self.assertEqual(list(self.folder.iterdir()), [])
        flag = self.folder / 'diagnostics'
        flag.touch()
        self.assertEqual(run(DIAGNOSTIC, self.folder, record).returncode, 0)
        log = self.folder / 'diagnostics.log'
        self.assertEqual(log.read_text(), record)
        flag.unlink()
        self.assertEqual(run(DIAGNOSTIC, self.folder, record).returncode, 0)
        self.assertEqual(log.read_text(), record)

    def test_diagnostics_rotate_at_cap_and_concurrent_lines_stay_whole(self):
        (self.folder / 'diagnostics').touch()
        record = json.dumps({'step': 'register', 'error': 'x' * 3900}) + '\n'
        for _ in range(55):
            result = run(DIAGNOSTIC, self.folder, record)
            self.assertEqual(result.returncode, 0, result.stderr)
        for name in ['diagnostics.log', 'diagnostics.log.1']:
            path = self.folder / name
            self.assertTrue(path.exists())
            self.assertLessEqual(path.stat().st_size, CAP)
            for line in path.read_text().splitlines():
                self.assertEqual(json.loads(line)['step'], 'register')
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda n: run(DIAGNOSTIC, self.folder, json.dumps({'step': 'redraw', 'id': n}) + '\n'), range(32)))
        self.assertTrue(all(result.returncode == 0 for result in results))
        rows = [json.loads(line) for line in (self.folder / 'diagnostics.log').read_text().splitlines()]
        ids = [row['id'] for row in rows if row['step'] == 'redraw']
        self.assertEqual(sorted(ids), list(range(32)))
        self.assertEqual(len(ids), len(set(ids)))
        self.assertFalse((self.folder / '.diagnostics.lock').exists())

    def test_diagnostics_ignores_legacy_lock_directory(self):
        (self.folder / 'diagnostics').touch()
        lock = self.folder / '.diagnostics.lock'
        lock.mkdir()
        (lock / 'owner.99999999').write_text('99999999\n')
        record = '{"step":"session.start.begin"}\n'
        result = run(DIAGNOSTIC, self.folder, record)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.folder / 'diagnostics.log').read_text(), record)
        self.assertEqual((lock/'owner.99999999').read_text(), '99999999\n')

    def test_writes_refuse_parent_and_leaf_links(self):
        outside = self.folder.parent / 'outside'
        outside.mkdir()
        target = outside / 'view.json'; target.write_text('untouched')
        alias = self.folder / 'alias'; alias.symlink_to(outside, target_is_directory=True)
        self.assertNotEqual(run(ATOMIC, alias, 'bad', 'view.json').returncode, 0)
        self.assertEqual(target.read_text(), 'untouched')
        (self.folder/'view.json').symlink_to(target)
        self.assertNotEqual(run(ATOMIC, self.folder, 'bad', 'view.json').returncode, 0)
        self.assertEqual(target.read_text(), 'untouched')
        (self.folder/'diagnostics').touch()
        log = self.folder/'diagnostics.log'; log.symlink_to(target)
        self.assertNotEqual(run(DIAGNOSTIC, self.folder, 'bad\n').returncode, 0)
        self.assertEqual(target.read_text(), 'untouched')

    def test_rotation_and_lock_refuse_links_and_multilinks(self):
        (self.folder/'diagnostics').touch()
        target = self.folder.parent/'outside'; target.write_text('untouched')
        log = self.folder/'diagnostics.log'; log.write_text('x'*CAP)
        backup = self.folder/'diagnostics.log.1'; backup.symlink_to(target)
        self.assertNotEqual(run(DIAGNOSTIC, self.folder, '{}\n').returncode, 0)
        self.assertEqual(target.read_text(), 'untouched'); self.assertEqual(log.stat().st_size, CAP)
        backup.unlink(); os.link(target, backup)
        self.assertNotEqual(run(DIAGNOSTIC, self.folder, '{}\n').returncode, 0)
        self.assertEqual(target.read_text(), 'untouched')
        lock = self.folder/'.shared-diagnostics-lock'; lock.unlink(missing_ok=True); lock.symlink_to(target)
        self.assertNotEqual(run(DIAGNOSTIC, self.folder, '{}\n').returncode, 0)
        self.assertEqual(target.read_text(), 'untouched')

    def test_permanent_lock_leaves_refuse_links_and_multilinks(self):
        (self.folder/'diagnostics').touch()
        outside=self.folder.parent/'outside';outside.write_text('untouched')
        for name,script,target in [('.shared-view-lock',ATOMIC,'view.json'),('.shared-diagnostics-lock',DIAGNOSTIC,None)]:
            lock=self.folder/name
            for hard in [False,True]:
                if hard:os.link(outside,lock)
                else:lock.symlink_to(outside)
                self.assertNotEqual(run(script,self.folder,'{}\n',target).returncode,0)
                self.assertEqual(outside.read_text(),'untouched');lock.unlink()

    def test_view_multilink_and_fifo_refused_without_blocking(self):
        outside = self.folder.parent/'outside'; outside.write_text('untouched')
        view = self.folder/'view.json'; os.link(outside, view)
        self.assertNotEqual(run(ATOMIC, self.folder, 'bad', 'view.json').returncode, 0)
        self.assertEqual(outside.read_text(), 'untouched')
        view.unlink(); os.mkfifo(view)
        self.assertNotEqual(run(ATOMIC, self.folder, 'bad', 'view.json').returncode, 0)

    def test_four_diagnostic_writers_validate_slow_record_metadata_without_holding_the_lock(self):
        # Since a474436 the record's metadata (one line, at most 4096 bytes, no NUL) is checked by the native helper
        # behind DIAGNOSTIC_APPEND. Four writers whose records are still arriving must all be admitted: none may hold
        # the diagnostics lock while it waits for its own input (lead, 10-10).
        (self.folder / 'diagnostics').touch()
        argv = ['/bin/sh', '-c', DIAGNOSTIC, 'coco', str(self.folder), str(HELPER), str(ROOT / 'plugin/bin/presence.sh')]
        writers = []
        try:
            for number in range(4):
                writer = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                writer.stdin.write(('{"step": "metadata", "id": %d' % number).encode())
                writer.stdin.flush()
                writers.append(writer)
            # As long as M1's metadata barrier waited (1.5 s): longer than a writer's bounded wait for the lock.
            time.sleep(1.5)
            for writer in writers:
                try:
                    writer.stdin.write(b'}\n')
                    writer.stdin.close()
                except BrokenPipeError:
                    pass  # this writer already gave up; its exit code below says so
            results = [(writer.wait(timeout=10), writer.stderr.read().decode()) for writer in writers]
        finally:
            for writer in writers:
                if writer.poll() is None:
                    writer.kill()
                    writer.wait()
                for stream in (writer.stdout, writer.stderr):
                    stream.close()
        self.assertEqual([code for code, _ in results], [0, 0, 0, 0], [error for _, error in results])
        rows = [json.loads(line) for line in (self.folder / 'diagnostics.log').read_text().splitlines()]
        self.assertEqual(sorted(row['id'] for row in rows), list(range(4)))
        self.assertFalse(list(self.folder.glob('.diagnostic.*')))

    def test_four_view_writers_still_sending_do_not_hold_the_lock(self):
        # U9: write-shared reads the view before it takes the view lock, as DIAGNOSTIC_APPEND does, so four writers
        # whose views are still arriving are all admitted and view.json is one writer's whole document.
        argv = ['/bin/sh', '-c', ATOMIC, 'coco', str(self.folder), 'view.json', str(HELPER),
                str(ROOT / 'plugin/bin/presence.sh')]
        writers = []
        try:
            for number in range(4):
                writer = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                writer.stdin.write(('{"id": %d' % number).encode())
                writer.stdin.flush()
                writers.append(writer)
            time.sleep(1.5)  # longer than a writer's bounded wait for the lock
            for writer in writers:
                try:
                    writer.stdin.write(b'}\n')
                    writer.stdin.close()
                except BrokenPipeError:
                    pass
            results = [(writer.wait(timeout=10), writer.stderr.read().decode()) for writer in writers]
        finally:
            for writer in writers:
                if writer.poll() is None:
                    writer.kill()
                    writer.wait()
                for stream in (writer.stdout, writer.stderr):
                    stream.close()
        self.assertEqual([code for code, _ in results], [0, 0, 0, 0], [error for _, error in results])
        self.assertIn(json.loads((self.folder / 'view.json').read_text())['id'], range(4))


if __name__ == '__main__':
    unittest.main(verbosity=2)
