#!/usr/bin/env python3
"""Scratch drivers remove only their own run directories, including on failure."""
import importlib.util
import contextlib
import io
import os
from pathlib import Path
import subprocess
import signal
import tempfile
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scratch import TemporaryDirectory
from fixture_cpu import wait_for as wait_for_cpu, communicate as communicate_cpu
ROOT = Path(__file__).resolve().parents[2]

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

class ScratchCleanup(unittest.TestCase):
    def test_native_cleans_created_folder_on_success_and_compile_failure(self):
        module = load('native_cleanup', ROOT/'tools/tests/companion-native.py')
        for failed in (False, True):
            with TemporaryDirectory(prefix='native-cleanup-fixture-') as root:
                created = []
                real = tempfile.mkdtemp
                def tracked(*args, **kwargs):
                    if len(args) >= 3:
                        args = (*args[:2], root, *args[3:])
                    else:
                        kwargs['dir'] = root
                    result = real(*args, **kwargs)
                    created.append(Path(result))
                    return result
                def fake_run(command, **kwargs):
                    if command[0] == '/bin/sh':
                        return subprocess.CompletedProcess(command, 0, stdout=b'<plist/>')
                    if failed and '-O' in command:
                        return subprocess.CompletedProcess(command, 73)
                    return subprocess.CompletedProcess(command, 0)
                with contextlib.redirect_stdout(io.StringIO()), patch.object(module.tempfile, 'mkdtemp', tracked), patch.object(module.shutil, 'which', return_value='/scratch/swiftc'), patch.object(module.subprocess, 'run', fake_run):
                    if failed:
                        with self.assertRaises(subprocess.CalledProcessError): module.main()
                    else:
                        self.assertEqual(module.main(), 0)
                self.assertEqual(len(created), 1)
                self.assertFalse(created[0].exists(), f'leaked after failed={failed}: {created[0]}')

    def test_feed_and_transport_remove_default_scratch_at_process_exit(self):
        for script in ('companion-feed-latency.py', 'presence-transport.test.py'):
            for failed in (False, True):
                with TemporaryDirectory(prefix='driver-cleanup-fixture-') as root:
                    root = Path(root)
                    commands = root/'bin'; commands.mkdir()
                    compiler = commands/'swiftc'
                    compiler.write_text('#!/bin/sh\n[ "$FAIL_COMPILE" = 1 ] && exit 73\nwhile [ "$1" != -o ]; do shift; done\nshift\nprintf "#!/bin/sh\\nexit 0\\n" > "$1"\nchmod +x "$1"\n')
                    compiler.chmod(0o700)
                    env = dict(os.environ, TMPDIR=str(root), PATH=str(commands)+os.pathsep+os.environ['PATH'], FAIL_COMPILE='1' if failed else '0')
                    code = "import runpy; runpy.run_path(" + repr(str(ROOT/'tools/tests'/script)) + ", run_name='cleanup_probe'); " + ("raise RuntimeError('fixture failure')" if failed else '')
                    done = subprocess.run([sys.executable, '-c', code], env=env, capture_output=True)
                    expected = 73 if failed and script == 'companion-feed-latency.py' else 1 if failed else 0
                    self.assertEqual(done.returncode, expected, done.stdout+done.stderr)
                    leaked = [p.name for p in root.iterdir() if p.name.startswith(('coco-feed-latency-', 'coco-presence-transport-'))]
                    self.assertEqual(leaked, [], f'{script} failed={failed}')

    def test_engine_runner_removes_own_scratch_without_trashing_or_other_data(self):
        module = load('runner_cleanup', ROOT/'tools/run-tests.py')
        with TemporaryDirectory(prefix='runner-cleanup-fixture-') as root:
            owned = Path(root)/'coco-tests-owned'; owned.mkdir()
            (owned/'cache').write_bytes(b'generated')
            other = Path(root)/'keep-owner-data'; other.mkdir()
            with patch.object(module.os, 'access', return_value=True), patch.object(module.subprocess, 'run') as run:
                module.remove_scratch(str(owned))
                module.remove_scratch(str(other))
                self.assertFalse(owned.exists())
                self.assertTrue(other.is_dir())
                run.assert_not_called()


    def test_shell_drivers_remove_builds_after_failure_and_keep_only_on_request(self):
        scripts = (
            ('tools/typecheck/check.sh', 'typecheck.'),
            ('tools/tests/presence-owner-check.sh', 'coco-owner-presence.'),
            ('tools/build-presence-native.sh', 'coco-presence-build.'),
            ('tools/build-presence-linux.sh', 'coco-linux-build.'),
            ('tools/measure-presence.sh', 'coco-presence-meter.'),
        )
        for script, prefix in scripts:
            for keep in (False, True):
                with self.subTest(script=script, keep=keep), TemporaryDirectory(prefix='shell-cleanup-fixture-') as name:
                    folder = Path(name); commands = folder/'bin'; commands.mkdir()
                    home = folder/'home'; (home/'.bun/install/cache/typescript@5.fixture/lib').mkdir(parents=True)
                    (home/'.bun/install/cache/typescript@5.fixture/lib/tsc.js').write_text('fixture')
                    for command in ('clang', 'swiftc', 'bun', 'node', 'ld.lld'):
                        stub = commands/command
                        stub.write_text('#!/bin/sh\n[ "'+command+'" = node ] && echo "error TS9999: fixture"\nexit 73\n'); stub.chmod(0o700)
                    env = dict(os.environ, HOME=str(home), TMPDIR=str(folder), PATH=str(commands)+os.pathsep+os.environ['PATH'], COCO_KEEP_SCRATCH='1' if keep else '0')
                    argv = ['sh', str(ROOT/script)]
                    if script.endswith('typecheck/check.sh'): argv.append(str(ROOT/'plugin'))
                    if script.endswith('build-presence-linux.sh'): argv += ['--out', str(folder/'output')]
                    done = subprocess.run(argv, env=env, capture_output=True, timeout=10)
                    self.assertNotEqual(done.returncode, 0, done.stdout+done.stderr)
                    leaked = [p for p in folder.iterdir() if p.name.startswith(prefix)]
                    self.assertEqual(len(leaked), 1 if keep else 0, done.stdout+done.stderr)

                    if script == 'tools/typecheck/check.sh' and not keep:
                        (commands/'node').write_text('#!/bin/sh\nexit 0\n')
                        success = subprocess.run(argv, env=env, capture_output=True, timeout=10)
                        self.assertEqual(success.returncode, 0, success.stdout+success.stderr)
                        self.assertEqual(list(folder.glob(prefix+'*')), [])
                        (commands/'node').write_text('#!/bin/sh\nexit 73\n')
                        crashed = subprocess.run(argv, env=env, capture_output=True, timeout=10)
                        self.assertNotEqual(crashed.returncode, 0)
                        self.assertEqual(list(folder.glob(prefix+'*')), [])
                        for sig in (signal.SIGINT, signal.SIGTERM):
                            (commands/'node').write_text('#!/bin/sh\necho READY > "$TMPDIR/ready"\nsleep 30\n')
                            ready = folder/'ready'
                            ready.unlink(missing_ok=True)
                            child = subprocess.Popen(argv, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
                            try:
                                self.assertTrue(wait_for_cpu(ready.exists, cpu_limit=5), 'node fixture did not start within the CPU budget')
                                os.killpg(child.pid, sig)
                                communicate_cpu(child, cpu_limit=10)
                            finally:
                                if child.poll() is None: os.killpg(child.pid, signal.SIGKILL); child.communicate()
                            self.assertEqual(child.returncode, 128 + sig)
                            self.assertEqual(list(folder.glob(prefix+'*')), [])

    def test_cleanup_does_not_delete_a_replacement_directory_or_symlink(self):
        module = load('scratch_owned_cleanup', ROOT/'tools/scratch.py')
        with TemporaryDirectory(prefix='identity-cleanup-fixture-') as name:
            folder = Path(name); owned = folder/'owned'; owned.mkdir()
            cleanup = module.register_scratch(owned)
            moved = folder/'moved'; owned.rename(moved)
            owned.mkdir(); (owned/'owner-data').write_text('keep')
            cleanup.cleanup()
            self.assertEqual((owned/'owner-data').read_text(), 'keep')
            other = folder/'other'; other.mkdir()
            linked = folder/'linked'; linked.mkdir()
            cleanup = module.register_scratch(linked)
            linked.rmdir(); linked.symlink_to(other, target_is_directory=True)
            cleanup.cleanup()
            self.assertTrue(other.is_dir())
            self.assertTrue(linked.is_symlink())

    def test_python_driver_honours_keep_scratch(self):
        with TemporaryDirectory(prefix='keep-cleanup-fixture-') as name:
            folder = Path(name)
            env = dict(os.environ, TMPDIR=str(folder), COCO_KEEP_SCRATCH='1')
            code = "import runpy; runpy.run_path(" + repr(str(ROOT/'tools/tests/presence-transport.test.py')) + ", run_name='cleanup_probe')"
            done = subprocess.run([sys.executable, '-c', code], env=env, capture_output=True)
            self.assertEqual(done.returncode, 0, done.stdout+done.stderr)
            self.assertEqual(len(list(folder.glob('coco-presence-transport-*'))), 1)

    def test_python_driver_cleans_on_interrupt(self):
        for sig in (signal.SIGINT, signal.SIGTERM):
            with self.subTest(signal=sig), TemporaryDirectory(prefix='interrupt-cleanup-fixture-') as name:
                folder = Path(name)
                env = dict(os.environ, TMPDIR=str(folder), COCO_KEEP_SCRATCH='0')
                code = "import runpy,time; runpy.run_path(" + repr(str(ROOT/'tools/tests/presence-transport.test.py')) + ", run_name='cleanup_probe'); print('READY', flush=True); time.sleep(30)"
                child = subprocess.Popen([sys.executable, '-c', code], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                try:
                    self.assertEqual(child.stdout.readline().strip(), 'READY')
                    child.send_signal(sig)
                    communicate_cpu(child, cpu_limit=10)
                finally:
                    if child.poll() is None: child.kill(); child.communicate()
                self.assertNotEqual(child.returncode, 0)
                self.assertEqual(list(folder.glob('coco-presence-transport-*')), [])


    def test_native_hosts_cleanup_on_success_failure_and_signals(self):
        for script in ('presence-native-deadline-real.ts', 'presence-native-touch-real.ts'):
            self.assertIn('registerScratch', (ROOT/'tools/tests'/script).read_text())
        for mode in ('success', 'failure', 'SIGINT', 'SIGTERM', 'keep'):
            with self.subTest(mode=mode), TemporaryDirectory(prefix='bun-cleanup-fixture-') as name:
                folder = Path(name); fixture = folder/'fixture.ts'
                fixture.write_text("import { mkdtempSync } from 'node:fs'; import { join } from 'node:path'; import { registerScratch } from " + repr(str(ROOT/'tools/tests/scratch-process.ts')) + "; const folder=mkdtempSync(join(process.env.TMPDIR!, 'native-host-fixture-')); const cleanup=registerScratch(folder); console.log('READY'); " + ("throw new Error('fixture failure')" if mode == 'failure' else "setInterval(()=>{},1000)" if mode.startswith('SIG') else "cleanup()"))
                env = dict(os.environ, TMPDIR=str(folder), COCO_KEEP_SCRATCH='1' if mode == 'keep' else '0')
                child = subprocess.Popen(['bun', 'run', str(fixture)], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                try:
                    line = child.stdout.readline().strip()
                    self.assertEqual(line, 'READY', child.stderr.read() if not line else line)
                    if mode.startswith('SIG'): child.send_signal(getattr(signal, mode))
                    communicate_cpu(child, cpu_limit=5)
                finally:
                    if child.poll() is None: child.kill(); child.communicate()
                self.assertEqual(len(list(folder.glob('native-host-fixture-*'))), 1 if mode == 'keep' else 0)
                self.assertEqual(child.returncode, 0 if mode in ('success', 'keep') else 1 if mode == 'failure' else 128+getattr(signal, mode))

if __name__ == '__main__': unittest.main()
