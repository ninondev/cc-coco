#!/usr/bin/env python3
"""Presence session files: a dead session's files go, a live one's stay, a late write cannot bring them back.

Runs the real helper (macOS presence-native and presence-follow, Linux presence-linux-<arch>) in scratch folders.
A session is three files named by its owner token: .presence-registration-T, .presence-follow-T.jsonl and
.presence-deadline-T.jsonl. They are checked here for a normal end, a killed session, two sessions at once, a
late deadline write after the end, a reused pid and deep paths.
"""
import argparse
import itertools
import os
import platform
import select
import shutil
import subprocess
import sys
import threading
import time
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scratch import TemporaryDirectory
try:
    import resource
except ImportError:  # Windows: these tests are skipped there
    resource = None

ROOT = Path(__file__).resolve().parents[2]
DARWIN = sys.platform == 'darwin'
SUPPORTED = DARWIN or sys.platform.startswith('linux')
parser = argparse.ArgumentParser()
parser.add_argument('--binary', type=Path, help='the full helper (default: the one in plugin/bin for this machine)')
parser.add_argument('--follower', type=Path, help='the follower build (macOS: presence-follow; default: the full helper)')
args, rest = parser.parse_known_args()
if args.binary is None and SUPPORTED:
    if DARWIN:
        args.binary = ROOT / 'plugin/bin/presence-native'
    else:
        machine = {'arm64': 'aarch64', 'amd64': 'x86_64'}.get(platform.machine(), platform.machine())
        args.binary = ROOT / f'plugin/bin/presence-linux-{machine}'
if args.follower is None and SUPPORTED:
    args.follower = ROOT / 'plugin/bin/presence-follow' if DARWIN and args.binary == ROOT / 'plugin/bin/presence-native' else args.binary
BIN = str(args.binary)
FOLLOWER = str(args.follower)
SERIAL = itertools.count(1)
KINDS = ('registration', 'marker', 'deadline')
LARGE_SIZES = (9000, 70000, 250000)  # commit lines; the plugin sends them in pieces of 16384 characters (presence.ts sendFIFO)
DEEP_FOLDER = (120, 147, 400, 900)  # the helper builds longer paths under this folder; macOS allows 1024 in all
DEEP_PLUGIN = (120, 147, 400, 700, 1000)


def cpu_now():
    if resource is None:
        return time.process_time()
    own, children = resource.getrusage(resource.RUSAGE_SELF), resource.getrusage(resource.RUSAGE_CHILDREN)
    return own.ru_utime + own.ru_stime + children.ru_utime + children.ru_stime


def wait_until(condition, what, wall=120, cpu=30):
    """Wait for a condition. The wall limit only catches a hang and is generous; the CPU limit catches a busy loop."""
    started, used = time.monotonic(), cpu_now()
    while not condition():
        if time.monotonic() - started > wall or cpu_now() - used > cpu:
            raise AssertionError('timed out waiting for ' + what)
        time.sleep(0.01)


def deep_directory(base, total):
    """A directory under base whose whole path is `total` characters long (60-character components)."""
    path = str(base)
    while len(path) < total - 1:
        path += '/' + 'd' * min(total - len(path) - 1, 60)
    os.makedirs(path, mode=0o700, exist_ok=True)
    return Path(path)


def leaf(kind, token):
    return {'registration': f'.presence-registration-{token}', 'marker': f'.presence-follow-{token}.jsonl',
            'deadline': f'.presence-deadline-{token}.jsonl'}[kind]


def present(folder, token):
    return tuple(kind for kind in KINDS if (folder / leaf(kind, token)).exists())


class Lines:
    """Whole lines from a child's stdout, without Python's buffering getting between select and read."""
    def __init__(self, child):
        self.child, self.buffer, self.fd = child, bytearray(), child.stdout.fileno()
        os.set_blocking(self.fd, False)

    def next(self, what='output', wall=90):
        started = time.monotonic()
        while True:
            at = self.buffer.find(b'\n')
            if at >= 0:
                line = bytes(self.buffer[:at]).decode(errors='replace')
                del self.buffer[:at + 1]
                return line
            if select.select([self.fd], [], [], 0.2)[0]:
                chunk = os.read(self.fd, 65536)
                if not chunk:
                    raise AssertionError(f'helper ended while waiting for {what}: {self.child.poll()}')
                self.buffer += chunk
            elif time.monotonic() - started > wall:
                raise AssertionError('timed out waiting for ' + what)

    def until(self, wanted, what=None):
        while True:
            line = self.next(what or wanted)
            if line == wanted or (wanted.endswith('\t') and line.startswith(wanted)):
                return line


class Harness(unittest.TestCase):
    def setUp(self):
        self.scratch = TemporaryDirectory(prefix='presence-files-')
        self.folder = Path(self.scratch.name).resolve() / 'presence'
        self.folder.mkdir(mode=0o700)
        self.children = []
        self.sender = BIN

    def tearDown(self):
        for child in self.children:
            if child.poll() is None:
                child.kill()
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                pass
            for pipe in (child.stdout, child.stderr):
                if pipe:
                    pipe.close()
        self.scratch.cleanup()

    def spawn(self, argv, **options):
        child = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **options)
        self.children.append(child)
        return child

    def helper(self, *words, folder=None, timeout=60):
        done = subprocess.run([BIN, str(folder or self.folder), *words], capture_output=True, timeout=timeout)
        return done

    def sweep(self, folder=None):
        done = self.helper('sweep', folder=folder)
        self.assertEqual(done.returncode, 0, done.stderr)
        return sorted(tuple(line.split('\t')[1:]) for line in done.stdout.decode().splitlines() if line.startswith('SWEPT\t'))

    def follower(self, token, folder=None, binary=None, deadline=True):
        return Follower(self, token, folder or self.folder, binary or FOLLOWER, deadline)

    def deadline_write(self, token, generation=1, at=1000, folder=None):
        return self.helper('deadline-write', token, f'{generation}\t{at}\n', folder=folder)

    def send(self, fifo, data, piece=4096, wall=60, via=None):
        """Write into the commit FIFO. piece=None is one blocking write of all of it. via=(folder, device, inode)
        sends it the way the plugin does: the helper's fifo-send verb, 16384 characters at a time."""
        if via:
            folder, device, inode = via
            text = data.decode()
            for at in range(0, len(text), 16384):
                done = subprocess.run([self.sender, str(folder), 'fifo-send', fifo, device, inode, text[at:at + 16384]], capture_output=True, timeout=wall)
                self.assertEqual(done.returncode, 0, done.stderr)
            return
        failure = []

        def work():
            try:
                fd = os.open(fifo, os.O_WRONLY)
                try:
                    step = len(data) if piece is None else piece
                    for at in range(0, len(data), step):
                        part = memoryview(data)[at:at + step]
                        while part:
                            part = part[os.write(fd, part):]
                finally:
                    os.close(fd)
            except BaseException as error:  # reported by the caller
                failure.append(error)
        # A write the helper never reads blocks for ever, so it runs in a thread that can be given up on.
        thread = threading.Thread(target=work, daemon=True)
        thread.start()
        thread.join(wall)
        if thread.is_alive():
            raise AssertionError(f'the helper did not take {len(data)} bytes written to its FIFO in {"one write" if piece is None else f"pieces of {piece}"}')
        if failure:
            raise failure[0]

    def transact(self, owner, remove='', commit='-', piece=4096, folder=None, binary=None, plugin_way=False):
        """One helper transaction, the way the plugin runs it. Returns the seconds the commit took to land."""
        folder = folder or self.folder
        self.sender = binary or BIN
        token = f'{owner}-t{next(SERIAL)}'
        child = self.spawn([binary or BIN, str(folder), 'transaction', token, '', remove])
        lines, fifo, via = Lines(child), '', None
        try:
            for _ in range(100000):
                line = lines.next('INSPECT')
                if line.startswith('PRESENCE\t'):
                    parts = line.split('\t')
                    fifo = parts[2]
                    via = (folder, parts[3], parts[4]) if plugin_way else None
                elif line == 'INSPECT':
                    break
            self.assertTrue(fifo, 'no FIFO named')
            self.send(fifo, b'\n', piece, via=via)
            lines.until('READY')
            started = time.monotonic()
            self.send(fifo, commit.encode() + b'\n', piece, via=via)
            lines.until('COMMITTED')
            elapsed = time.monotonic() - started
            self.assertEqual(child.wait(timeout=60), 0, child.stderr.read())
            return elapsed
        except BaseException:
            child.kill()  # a stuck transaction would hold the lock against the next one
            raise


class Follower:
    def __init__(self, case, token, folder, binary, deadline=True):
        self.case, self.token, self.folder = case, token, folder
        self.requests = folder / f'requests-{token}.jsonl'
        self.requests.write_text('')
        argv = [binary, str(folder), 'follow', token, str(self.requests), '', '']
        if deadline:
            argv.append(str(folder / leaf('deadline', token)))
        self.child = case.spawn(argv)
        self.lines = Lines(self.child)
        self.lines.until(f'READY\t{token}', 'the follower being ready')
        self.pid = self.child.pid

    def files(self):
        return present(self.folder, self.token)

    def kill(self):
        self.child.kill()
        self.child.wait(timeout=10)

    def end(self):
        self.child.terminate()
        self.child.wait(timeout=10)

    def alive(self):
        return self.child.poll() is None


@unittest.skipUnless(SUPPORTED, 'presence helpers exist for macOS and Linux only')
class SessionFiles(Harness):
    def test_normal_end_removes_all_three_files(self):
        alpha = self.follower('alpha')
        self.assertEqual(self.deadline_write('alpha').returncode, 0)
        self.assertEqual(alpha.files(), KINDS)
        self.transact('alpha', remove='alpha')
        self.assertEqual(present(self.folder, 'alpha'), ())

    def test_late_deadline_write_after_the_end_does_not_bring_the_file_back(self):
        self.follower('alpha')
        self.assertEqual(self.deadline_write('alpha', 1).returncode, 0)
        self.assertTrue((self.folder / leaf('deadline', 'alpha')).exists())
        self.transact('alpha', remove='alpha')
        for generation in range(2, 7):
            done = self.deadline_write('alpha', generation)
            self.assertEqual(done.returncode, 0, done.stderr)
            self.assertEqual(present(self.folder, 'alpha'), ())
        self.assertEqual([name for name in os.listdir(self.folder) if 'stage' in name], [])

    def test_deadline_writes_racing_the_end_leave_nothing_behind(self):
        for round_number in range(3):
            token = f'racer{round_number}'
            self.follower(token)
            writers = [self.spawn([BIN, str(self.folder), 'deadline-write', token, f'{n}\t{n}\n']) for n in range(1, 9)]
            self.transact(token, remove=token)
            writers += [self.spawn([BIN, str(self.folder), 'deadline-write', token, f'{n}\t{n}\n']) for n in range(9, 13)]
            for writer in writers:
                self.assertEqual(writer.wait(timeout=60), 0, writer.stderr.read())
            self.assertEqual(present(self.folder, token), ())
        self.assertEqual([name for name in os.listdir(self.folder) if 'stage' in name], [])

    def test_two_sessions_at_once_end_independently(self):
        alpha, bravo = self.follower('alpha'), self.follower('bravo')
        for token in ('alpha', 'bravo'):
            self.assertEqual(self.deadline_write(token).returncode, 0)
        self.assertEqual((alpha.files(), bravo.files()), (KINDS, KINDS))
        self.transact('alpha', remove='alpha')
        self.assertEqual((alpha.files(), bravo.files()), ((), KINDS))
        self.assertEqual(self.deadline_write('bravo', 2).returncode, 0)
        self.assertEqual(self.sweep(), [])
        self.assertTrue(bravo.alive())
        self.transact('bravo', remove='bravo')
        self.assertEqual(bravo.files(), ())

    def test_many_sessions_starting_together_all_become_ready(self):
        for round_number in range(3):
            tokens = [f'burst{round_number}x{n}' for n in range(8)]
            requests = []
            for token in tokens:
                path = self.folder / f'requests-{token}.jsonl'
                path.write_text('')
                requests.append(path)
            children = [self.spawn([FOLLOWER, str(self.folder), 'follow', token, str(path), '', '', str(self.folder / leaf('deadline', token))])
                        for token, path in zip(tokens, requests)]
            for token, child in zip(tokens, children):
                Lines(child).until(f'READY\t{token}', 'a follower of the burst')
            for token in tokens:
                self.assertEqual(present(self.folder, token), ('registration', 'marker'))
            self.assertEqual(self.sweep(), [])
            for child in children:
                child.terminate()
                child.wait(timeout=10)
            self.sweep()

    def test_killed_session_is_swept_and_a_live_one_is_not(self):
        alpha, bravo = self.follower('alpha'), self.follower('bravo')
        for token in ('alpha', 'bravo'):
            self.assertEqual(self.deadline_write(token).returncode, 0)
        alpha.kill()
        self.assertEqual(alpha.files(), KINDS, 'a killed follower cannot clean up after itself')
        self.assertEqual(self.sweep(), [('alpha', 'gone')])
        self.assertEqual((alpha.files(), bravo.files()), ((), KINDS))
        self.assertTrue(bravo.alive())
        self.assertEqual(self.sweep(), [])

    def test_a_session_that_ends_sweeps_a_killed_session(self):
        alpha, bravo, charlie = self.follower('alpha'), self.follower('bravo'), self.follower('charlie')
        self.assertEqual(self.deadline_write('alpha').returncode, 0)
        alpha.kill()
        self.assertEqual(alpha.files(), KINDS)
        self.transact('bravo')  # an ordinary transaction leaves the folder alone
        self.assertEqual(alpha.files(), KINDS)
        self.transact('bravo', remove='bravo')
        self.assertEqual((alpha.files(), bravo.files(), charlie.files()), ((), (), ('registration', 'marker')))

    def test_a_second_follower_under_a_live_token_removes_nothing_of_the_first(self):
        alpha = self.follower('alpha')
        self.assertEqual(self.deadline_write('alpha').returncode, 0)
        before = [(self.folder / leaf(kind, 'alpha')).stat().st_ino for kind in ('registration', 'marker')]
        requests = self.folder / 'requests-twin.jsonl'
        requests.write_text('')
        twin = self.spawn([FOLLOWER, str(self.folder), 'follow', 'alpha', str(requests), '', '', str(self.folder / leaf('deadline', 'alpha'))])
        self.assertNotEqual(twin.wait(timeout=30), 0, 'the second follower must refuse a token that is registered')
        self.assertTrue(alpha.alive())
        self.assertEqual(alpha.files(), KINDS)
        self.assertEqual([(self.folder / leaf(kind, 'alpha')).stat().st_ino for kind in ('registration', 'marker')], before)

    def test_the_next_follower_start_sweeps_a_killed_session(self):
        alpha = self.follower('alpha')
        self.assertEqual(self.deadline_write('alpha').returncode, 0)
        alpha.kill()
        bravo = self.follower('bravo')
        self.assertEqual((alpha.files(), bravo.files()), ((), ('registration', 'marker')))

    def test_a_session_may_start_again_under_the_token_of_a_killed_one(self):
        first = self.follower('alpha')
        first.kill()
        second = self.follower('alpha')
        self.assertTrue(second.alive())
        self.assertEqual(second.files(), ('registration', 'marker'))
        fields = (self.folder / leaf('registration', 'alpha')).read_text().split('\t')
        self.assertEqual(int(fields[0]), second.pid)

    def test_a_reused_pid_does_not_count_as_alive(self):
        live = self.follower('live')
        text = (self.folder / leaf('registration', 'live')).read_text()
        fields = text.rstrip('\n').split('\t')
        self.assertEqual(len(fields), 6)
        self.assertEqual(int(fields[0]), live.pid)
        head, _, last = fields[2].rpartition(':')
        wrong = f'{head}:{int(last) + 1}'

        def fake(token, stamp):
            fields_now = list(fields)
            fields_now[2], fields_now[5] = stamp, token
            (self.folder / leaf('registration', token)).write_text('\t'.join(fields_now) + '\n')
            (self.folder / leaf('marker', token)).write_text(f'READY\t{token}\n')
            (self.folder / leaf('deadline', token)).write_text('1\t1000\n')

        fake('same', fields[2])      # the live pid with the stamp it started with: the same process
        fake('reused', wrong)        # the live pid, but another start time: the pid now belongs to another process
        self.assertEqual(self.sweep(), [('reused', 'reused')])
        self.assertEqual(present(self.folder, 'reused'), ())
        self.assertEqual(present(self.folder, 'same'), KINDS)
        self.assertEqual(live.files(), ('registration', 'marker'))
        self.assertTrue(live.alive())

    def test_a_registration_that_cannot_be_read_counts_as_live(self):
        for token, text in (('empty', ''), ('words', 'not a registration\n'), ('short', '1\t2\tdarwin:1:2\n'),
                            ('foreign', '999999\t1\tmars:1:2\t501\t/bin/x\tforeign\n'),
                            ('other', '999999\t1\tdarwin:1:2\t501\t/bin/x\tsomeone-else\n')):
            (self.folder / leaf('registration', token)).write_text(text)
            (self.folder / leaf('marker', token)).write_text(f'READY\t{token}\n')
        self.assertEqual(self.sweep(), [])
        for token in ('empty', 'words', 'short', 'foreign', 'other'):
            self.assertEqual(present(self.folder, token), ('registration', 'marker'))

    def test_files_of_other_names_and_kinds_are_left_alone(self):
        names = ('.presence-registration-', '.presence-registration-bad name', '.presence-follow-x.json', '.presence-deadline-x',
                 'presence.jsonl', 'snapshot.json', '.presence-flock')
        for name in names:
            (self.folder / name).write_text('keep\n')
        self.assertEqual(self.sweep(), [])
        self.assertEqual(sorted(os.listdir(self.folder)), sorted(names))

    def test_marker_and_deadline_files_without_a_registration_go_after_a_minute(self):
        for token in ('fresh', 'old'):
            for kind in ('marker', 'deadline'):
                (self.folder / leaf(kind, token)).write_text('1\t1000\n')
        past = time.time() - 120
        for kind in ('marker', 'deadline'):
            os.utime(self.folder / leaf(kind, 'old'), (past, past))
        self.assertEqual(self.sweep(), [('old', 'orphan'), ('old', 'orphan')])
        self.assertEqual(present(self.folder, 'old'), ())
        self.assertEqual(present(self.folder, 'fresh'), ('marker', 'deadline'))

    def test_files_of_a_live_session_stay_however_old_they_are(self):
        alpha = self.follower('alpha')
        self.assertEqual(self.deadline_write('alpha').returncode, 0)
        past = time.time() - 86400
        for kind in KINDS:
            os.utime(self.folder / leaf(kind, 'alpha'), (past, past))
        self.assertEqual(self.sweep(), [])
        self.assertEqual(alpha.files(), KINDS)

    @unittest.skipUnless(DARWIN, 'the Linux follower is ended by the kernel and cannot clean up')
    def test_follower_removes_its_own_files_when_it_is_ended(self):
        alpha = self.follower('alpha')
        self.assertEqual(self.deadline_write('alpha').returncode, 0)
        self.assertEqual(alpha.files(), KINDS)
        alpha.end()
        self.assertEqual(alpha.files(), ())

    def test_follower_ends_with_its_host_and_leaves_nothing_after_a_sweep(self):
        requests = self.folder / 'requests-host.jsonl'
        requests.write_text('')
        code = ('import subprocess,sys,time; p=subprocess.Popen(sys.argv[1:],stdout=subprocess.DEVNULL); print(p.pid,flush=True); time.sleep(120)')
        host = self.spawn([sys.executable, '-c', code, FOLLOWER, str(self.folder), 'follow', 'host', str(requests), '', '',
                           str(self.folder / leaf('deadline', 'host'))], text=False)
        pid = int(Lines(host).next('the follower pid'))
        wait_until(lambda: (self.folder / leaf('marker', 'host')).exists(), 'the follower being ready')
        self.assertEqual(self.deadline_write('host').returncode, 0)

        def running():
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                return False
            return True
        host.kill()
        host.wait(timeout=10)
        wait_until(lambda: not running(), 'the follower ending with its host', cpu=10)
        if DARWIN:
            self.assertEqual(present(self.folder, 'host'), ())
        self.sweep()
        self.assertEqual(present(self.folder, 'host'), ())


@unittest.skipUnless(SUPPORTED, 'presence helpers exist for macOS and Linux only')
class DeepPaths(Harness):
    def lifecycle(self, folder, binary, follower, large=None):
        """A session start, a deadline write, a transaction (optionally a large commit) and the end."""
        alpha = Follower(self, 'alpha', folder, follower)
        self.assertEqual(self.deadline_write('alpha', folder=folder).returncode, 0)
        self.assertEqual(alpha.files(), KINDS)
        fields = (folder / leaf('registration', 'alpha')).read_text().rstrip('\n').split('\t')
        self.assertEqual(int(fields[0]), alpha.pid)
        self.assertTrue(fields[4].endswith(os.path.basename(follower)), fields[4])
        if large:
            self.transact('alpha', commit='{"pad":"' + 'x' * large + '"}', folder=folder, binary=binary, plugin_way=True)
        self.transact('alpha', remove='alpha', folder=folder, binary=binary)
        self.assertEqual(alpha.files(), ())
        alpha.end()

    def test_deep_data_folder(self):
        for length in DEEP_FOLDER:
            with self.subTest(folder_length=length):
                folder = deep_directory(self.folder, length)
                self.assertGreaterEqual(len(str(folder)), length - 1)
                self.lifecycle(folder, BIN, FOLLOWER)
                self.assertEqual(self.sweep(folder), [])

    def test_deep_helper_path(self):
        for length in DEEP_PLUGIN:
            with self.subTest(plugin_length=length):
                where = deep_directory(self.folder.parent / f'plugin{length}', length - len('/presence-native'))
                full, follower = where / 'presence-native', where / 'presence-follow'
                shutil.copy2(BIN, full)
                shutil.copy2(FOLLOWER, follower)
                self.assertGreaterEqual(len(str(full)), length - 1)
                data = self.folder / f'data{length}'
                data.mkdir(mode=0o700)
                self.lifecycle(data, str(full), str(follower))

    def test_large_commit_sent_the_way_the_plugin_sends_it(self):
        for size in LARGE_SIZES:
            with self.subTest(bytes=size):
                commit = '{"pad":"' + 'x' * size + '"}'
                seconds = self.transact(f'big{size}', commit=commit, plugin_way=True)
                journal = (self.folder / 'presence.jsonl').read_text().splitlines()
                self.assertEqual(journal[-1], commit)
                self.assertLess(seconds, 30)

    def test_deep_plugin_and_deep_data_folder_together_with_many_sessions(self):
        folder = deep_directory(self.folder, 147)
        where = deep_directory(self.folder.parent / 'plugin-many', 147 - len('/presence-native'))
        full, follower = where / 'presence-native', where / 'presence-follow'
        shutil.copy2(BIN, full)
        shutil.copy2(FOLLOWER, follower)
        sessions = [Follower(self, f'many{n}', folder, str(follower)) for n in range(24)]
        for session in sessions:
            self.assertEqual(self.deadline_write(session.token, folder=folder).returncode, 0)
        self.transact('many0', commit='{"pad":"' + 'x' * 20000 + '"}', folder=folder, plugin_way=True)
        self.assertEqual(self.sweep(folder), [])
        for session in sessions:
            self.transact(session.token, remove=session.token, folder=folder)
            self.assertEqual(session.files(), ())


if __name__ == '__main__':
    unittest.main(argv=[__file__, *rest], verbosity=2)
