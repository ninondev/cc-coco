#!/usr/bin/env python3
"""Event-only helper behavior against an isolated owned home. No installation or follower."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import os
import platform
from pathlib import Path
import subprocess
import tempfile
import unittest

PARSER = argparse.ArgumentParser()
PARSER.add_argument('--binary', type=Path, required=True)
OPTIONS, REMAINING = PARSER.parse_known_args()
BINARY = OPTIONS.binary.resolve()


class State(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory(prefix='m1-state-test-', dir=os.environ['TMPDIR'])
        self.home = Path(self.scratch.name)
        self.data = self.home/'.local/share/coco/mod'
        self.env = dict(os.environ, HOME=str(self.home), USERPROFILE=str(self.home))

    def tearDown(self):
        self.scratch.cleanup()

    def call(self, *args, stdin=None, good=True):
        run = subprocess.run([str(BINARY), *map(str, args)], input=stdin, capture_output=True,
                             text=True, timeout=3, env=self.env)
        if good:
            self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
        return run, json.loads(run.stdout)

    def test_strict_dispatch_never_runs_a_load_guard(self):
        for args in [(), ('--revision', '1.0'), ('--mark-loaded', '--now', '1'), ('--bogus',),
                     ('--claim-welcome', '--revision', '1'), ('--claim-welcome', '--data', str(self.home/'outside'))]:
            run, result = self.call(*args, good=False)
            self.assertNotEqual(run.returncode, 0)
            self.assertFalse(result['ok'])
        self.assertFalse(self.data.exists())

    def test_welcome_is_one_atomic_claim_across_four_processes(self):
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: self.call('--claim-welcome'), range(12)))
        self.assertEqual(sum(result['claimed'] for _, result in results), 1)
        self.assertEqual((self.data/'welcome.claimed').read_bytes(), b'1\n')

    def test_cooldowns_and_daily_closing_limit(self):
        for kind, delay in [('waiting', 30000), ('status', 600000)]:
            for now, expected in [(1000000, True), (1000000 + delay - 1, False), (1000000 + delay, True), (1, False)]:
                _, result = self.call('--claim', kind, '--now', now, '--cooldown', delay)
                self.assertEqual(result['claimed'], expected)
        for i in range(7):
            _, result = self.call('--claim', 'closing', '--now', 1000000+i*1200000, '--cooldown', 1200000, '--day', '2026-10-07', '--limit', 6)
            self.assertEqual(result['claimed'], i < 6)
        _, result = self.call('--claim', 'closing', '--now', 1000000+7*1200000, '--cooldown', 1200000, '--day', '2026-10-08', '--limit', 6)
        self.assertTrue(result['claimed'])

    def test_concurrent_cooldown_claims_allow_exactly_one_winner(self):
        def claim(_):
            run, result = self.call('--claim', 'waiting', '--now', 1000000, '--cooldown', 30000, good=False)
            self.assertIn(run.returncode, (0, 1))
            return result.get('claimed', False)
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(claim, range(12)))
        self.assertEqual(sum(results), 1)
        self.assertEqual((self.data/'waiting.claimed').read_bytes(), b'1000000\n')

    @unittest.skipUnless(os.name=='posix','uses Unix advisory locks')
    def test_lock_contention_fails_closed_and_recovers_when_owner_closes(self):
        import fcntl
        self.data.mkdir(parents=True)
        with (self.data/'waiting.lock').open('wb') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            run, result = self.call('--claim', 'waiting', '--now', 1000000, '--cooldown', 30000, good=False)
            self.assertNotEqual(run.returncode, 0)
            self.assertFalse(result['ok'])
            self.assertFalse((self.data/'waiting.claimed').exists())
        self.assertTrue(self.call('--claim', 'waiting', '--now', 1000000, '--cooldown', 30000)[1]['claimed'])

    def test_invalid_claims_do_not_write_state(self):
        for args in [('waiting', '--now', '1', '--cooldown', '1'), ('other', '--now', '1', '--cooldown', '30000'),
                     ('status', '--now', 'NaN', '--cooldown', '600000'),
                     ('closing', '--now', '1', '--cooldown', '1200000', '--day', '2026-02-30', '--limit', '6'),
                     ('status', '--now', '1', '--now', '2', '--cooldown', '600000')]:
            self.assertNotEqual(self.call('--claim', *args, good=False)[0].returncode, 0)
        self.assertFalse(self.data.exists())

    def test_symlinked_parent_never_reaches_outside(self):
        outside=self.home/'outside'; outside.mkdir()
        (self.home/'.local').symlink_to(outside, target_is_directory=True)
        self.assertNotEqual(self.call('--claim-welcome',good=False)[0].returncode,0)
        self.assertEqual(list(outside.iterdir()),[])

    def test_leaf_links_and_fifo_are_rejected_without_touching_target(self):
        self.data.mkdir(parents=True)
        target=self.home/'sentinel';target.write_bytes(b'0\n')
        leaf=self.data/'status.claimed'
        leaf.symlink_to(target)
        self.assertNotEqual(self.call('--claim','status','--now',1000000,'--cooldown',600000,good=False)[0].returncode,0)
        leaf.unlink();os.link(target,leaf)
        self.assertNotEqual(self.call('--claim','status','--now',1000000,'--cooldown',600000,good=False)[0].returncode,0)
        leaf.unlink()
        if hasattr(os,'mkfifo'):
            os.mkfifo(leaf)
            self.assertNotEqual(self.call('--claim','status','--now',1000000,'--cooldown',600000,good=False)[0].returncode,0)
        self.assertEqual(target.read_bytes(),b'0\n')

    def test_logs_keep_40_and_byte_cap_without_following_links(self):
        logs=self.data/'logs';logs.mkdir(parents=True)
        for i in range(60):
            path=logs/f'{i:03}.log';path.write_bytes(b'x'*32);os.utime(path,ns=(1000000000+i,1000000000+i))
        outside=self.home/'outside';outside.mkdir();(outside/'sentinel').write_bytes(b'unchanged')
        (logs/'linked-folder').symlink_to(outside,target_is_directory=True)
        (logs/'linked-file').symlink_to(outside/'sentinel')
        os.link(outside/'sentinel',logs/'hardlink')
        _,result=self.call('--prune-logs')
        self.assertEqual(result['removed'],20)
        self.assertEqual(len(list(logs.glob('*.log'))),40)
        self.assertTrue((logs/'linked-folder').is_symlink());self.assertTrue((logs/'linked-file').is_symlink())
        self.assertEqual((outside/'sentinel').read_bytes(),b'unchanged')
        for path in logs.glob('*.log'):path.unlink()
        for i in range(3):
            with (logs/f'large-{i}.log').open('wb') as file:file.truncate(8*1024*1024)
        self.call('--prune-logs')
        self.assertLessEqual(sum(path.stat().st_size for path in logs.glob('*.log')),20*1024*1024)

    @unittest.skipUnless(platform.system()=='Darwin','request transport currently belongs to the macOS companion')
    def test_requests_are_bounded_and_companion_folder_is_never_installed(self):
        request=self.home/'Library/Application Support/Coco/requests.jsonl'
        self.assertNotEqual(self.call('--ensure-requests',good=False)[0].returncode,0)
        self.assertFalse(request.parent.exists())
        request.parent.mkdir(parents=True)
        self.call('--ensure-requests');self.call('--ensure-requests')
        self.call('--append-requests',stdin='{"id":"fixture","kind":"hello"}\n')
        _,result=self.call('--read-requests');self.assertEqual(result['text'],'{"id":"fixture","kind":"hello"}\n')
        before=request.read_bytes()
        for body in ['bad\n','{}\n{}\n','{"x":1,"x":2}\n','{}','x'*16385]:
            self.assertNotEqual(self.call('--append-requests',stdin=body,good=False)[0].returncode,0)
        self.assertEqual(request.read_bytes(),before)
        request.unlink();outside=self.home/'outside';outside.write_bytes(b'unchanged');request.symlink_to(outside)
        for mode in ['--ensure-requests','--read-requests','--append-requests']:
            self.assertNotEqual(self.call(mode,stdin='{}\n',good=False)[0].returncode,0)
        self.assertEqual(outside.read_bytes(),b'unchanged')


if __name__=='__main__':
    unittest.main(argv=[__file__,*REMAINING])
