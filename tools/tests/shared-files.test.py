#!/usr/bin/env python3
"""Exercise the actual fixed host scripts against throwaway shared folders only."""
import base64
import concurrent.futures
import json
import pathlib
import re
import subprocess
import tempfile
import threading
import time
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCE = (ROOT / 'plugin/hooks/shared-files.ts').read_text()


def script(name):
    match = re.search(r'export const ' + name + r' = String\.raw`([^`]+)`', SOURCE)
    assert match, name
    return match.group(1)


ATOMIC = script('ATOMIC_WRITE')
DIAGNOSTIC = script('DIAGNOSTIC_APPEND')
CAP = 200 * 1024


def run(code, folder, text, name=None):
    argv = ['/bin/sh', '-c', code, 'claudesama', str(folder)]
    if name is not None:
        argv.append(name)
    return subprocess.run(argv, input=text, text=True, capture_output=True, timeout=3)


class SharedFiles(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='claudesama-shared-files-')
        self.addCleanup(self.tmp.cleanup)
        self.folder = pathlib.Path(self.tmp.name) / 'Library/Application Support/Claude-sama'
        self.folder.mkdir(parents=True)

    def test_bundled_first_render_heads_are_byte_exact_in_both_styles(self):
        for family, module in [('pixel', 'rest-frames.ts'), ('desktop', 'painted-frames.ts')]:
            text = (ROOT / 'plugin/hooks' / module).read_text()
            bundled = json.loads(text.split(' = ', 1)[1])
            assets = sorted((ROOT / 'plugin/assets' / family).glob('*.png'))
            self.assertEqual(len(bundled), 16)
            self.assertEqual(len(assets), 16)
            for asset in assets:
                frame = re.match(r'\d+-(.*)\.png', asset.name).group(1)
                self.assertEqual(base64.b64decode(bundled[frame]), asset.read_bytes())

    def test_independent_startup_fixture_bytes_match_assets(self):
        text = (ROOT / 'tools/tests/band-png-bytes.ts').read_text()
        fixture = json.loads(text.split(' = ', 1)[1].removesuffix(' as const\n'))
        for family, frames in fixture.items():
            for frame, encoded in frames.items():
                asset = next((ROOT / 'plugin/assets' / family).glob('??-' + frame + '.png'))
                self.assertEqual(base64.b64decode(encoded), asset.read_bytes())

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

    def test_diagnostics_recovers_dead_lock_owner(self):
        (self.folder / 'diagnostics').touch()
        lock = self.folder / '.diagnostics.lock'
        lock.mkdir()
        (lock / 'owner.99999999').write_text('99999999\n')
        record = '{"step":"session.start.begin"}\n'
        result = run(DIAGNOSTIC, self.folder, record)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.folder / 'diagnostics.log').read_text(), record)
        self.assertFalse(lock.exists())


if __name__ == '__main__':
    unittest.main(verbosity=2)
