#!/usr/bin/env python3
"""Exercise the shipping shell/TypeScript with real scratch files and processes."""
import argparse
import json
import hashlib
import importlib.util
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import tempfile
import time
import unittest
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scratch import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--plugin', type=Path, default=ROOT / 'plugin')
parser.add_argument('--out', type=Path)
parser.add_argument('--real-process-identity', action='store_true')
parser.add_argument('--scripted-process-identity', action='store_true', help='legacy flag; native helper uses no ps')
args, _ = parser.parse_known_args()
SKIP_PUBLIC_SHELL_GATE = os.environ.get('COCO_SKIP_PUBLIC_SHELL_GATE') == '1'
# An explicit --out is a requested evidence folder; default scratch is always cleaned.
_scratch = None if args.out else TemporaryDirectory(prefix='coco-presence-transport-')
OUT = (args.out or Path(_scratch.name)).resolve()
OUT.mkdir(parents=True, exist_ok=True)

# An executable path/name or a shell command. Persona text and matching a user's
# command are data, not invocation. Comments and generated declarations are not run.
INVOKES_PYTHON = re.compile(r'''(?:^\#![^\n]*\bpython[\d.]*\b|["']/[^"'\s]*/python[\d.]*["']|\b(?:argv|executableURL|spawn|exec|execFile|run)\b[^\n;]{0,160}["']python[\d.]*["']|(?:^|[;|&()\s])(?:exec\s+)?(?:/(?:usr/)?bin/)?python[\d.]*(?:[ \t]+\S|[ \t]*$))''', re.MULTILINE)


def runtime_violations(plugin, files=None):
    hits = []
    for path in files if files is not None else plugin.rglob('*'):
        if not path.is_file() or '.claude-plugin/types' in path.as_posix():
            continue
        if path.suffix == '.py':
            hits.append(str(path)); continue
        try:
            text = path.read_text(encoding='utf-8')
        except UnicodeError:
            continue
        text = '\n'.join(line for line in text.splitlines() if line.lstrip().startswith('#!') or not line.lstrip().startswith(('#', '//')))
        if INVOKES_PYTHON.search(text):
            hits.append(str(path))
    return hits


def shipping_files(plugin):
    # Use the assembler's approved inventory, so excluded Rust CI tooling is
    # never mistaken for a Python helper shipped to users.
    spec = importlib.util.spec_from_file_location('presence_release_policy', ROOT/'coco/scripts/release-policy.py')
    policy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(policy)
    return [path for path in plugin.rglob('*') if path.is_file() and policy.plugin_allowed(path.relative_to(plugin).as_posix())]


def isolated_public_gate(public, destination):
    original = public.read_bytes()
    source = original.decode()
    seam = 'SCRATCH_BASE=/private/tmp'
    if source.count(seam) != 1:
        raise ValueError('public gate scratch seam changed')
    destination.write_text(source.replace(seam, 'SCRATCH_BASE=${TMPDIR:-/private/tmp}'))
    if hashlib.sha256(public.read_bytes()).digest() != hashlib.sha256(original).digest():
        raise ValueError('canonical public gate changed while copying')


def native_inventory_probe():
    if os.name == 'nt':
        return ('unavailable', 'POSIX process inventory is unavailable on Windows')
    done = subprocess.run(['/bin/sh', str(args.plugin/'bin/presence.sh'), 'stats', str(os.getpid())], capture_output=True, text=True, timeout=5)
    if done.returncode:
        return ('error', done.stderr or f'native helper exited {done.returncode}')
    try:
        rows = json.loads(done.stdout)
        if len(rows) != 1 or rows[0]['pid'] != os.getpid() or not rows[0]['birth']:
            return ('error', 'native helper did not identify its test parent')
    except (ValueError, KeyError, TypeError):
        return ('error', 'invalid native helper process inventory')
    return ('available', str(os.getpid()) + '; actual native helper birth ' + rows[0]['birth'])


class RuntimeGuardTests(unittest.TestCase):
    def test_guard_accepts_persona_data_and_catches_all_runtime_invocations(self):
        folder = Path(tempfile.mkdtemp(prefix='guard-', dir=OUT))
        cases = {
            'script.sh': 'python3 -c "print(1)"\n',
            'bare.sh': 'python3 script.py\n',
            'interactive.sh': 'python3\n',
            'exec.sh': 'exec python3 "$script"\n',
            'helper.sh': '#!/usr/bin/python3\nprint(1)\n',
            'code.ts': "const argv = ['/usr/bin/python3', script]\n",
            'name.ts': "spawn(['python', '-m', 'module'])\n",
            'native.swift': 'process.executableURL = URL(fileURLWithPath: "/usr/bin/python3")\n',
            'old.py': 'pass\n',
        }
        for name, text in cases.items():
            path = folder/name
            path.write_text(text)
            self.assertIn(str(path), runtime_violations(folder), name)
            path.unlink()
        (folder/'prose.json').write_text('{"text":"People ask whether she is a Python."}')
        (folder/'matcher.ts').write_text('const PYTHON = /\\bpython\\b/i\n')
        # C3 accepted repeat normalizer: a language alias is data, not an executable.
        (folder/'aliases.ts').write_text('const aliases = new Map([["py", "python"]])\n')
        self.assertEqual(runtime_violations(folder), [])

    @unittest.skipIf(SKIP_PUBLIC_SHELL_GATE, 'work order forbids executing the public check.sh')
    def test_public_shell_gate_rejects_runtime_mutations(self):
        if os.name == 'nt':
            self.skipTest('POSIX shell release gate is unavailable on Windows')
        public = args.plugin.parent / 'scripts/check.sh'
        if not public.is_file():
            public = args.plugin.parent / 'coco/scripts/check.sh'
        self.assertTrue(public.is_file(), str(public))
        folder = Path(tempfile.mkdtemp(prefix='shell-guard-', dir=OUT))
        (folder/'scripts').mkdir(); (folder/'plugin').mkdir()
        isolated_public_gate(public, folder/'scripts/check.sh')
        env = dict(os.environ, COCO_KEEP_SCRATCH='0', TMPDIR=str(OUT))
        (folder/'plugin/prose.json').write_text('{"text":"People ask whether she is a Python."}')
        done = subprocess.run(['/bin/sh', str(folder/'scripts/check.sh'), '--scan-only'], env=env, capture_output=True, text=True)
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        for n, text in enumerate(['python3 script.py\n', 'python3\n', 'exec python3 "$script"\n', '#!/usr/bin/python3\n', "spawn(['/usr/bin/python3'])\n", "spawn(['python'])\n"]):
            path = folder/'plugin/injected.sh'
            path.write_text(text)
            done = subprocess.run(['/bin/sh', str(folder/'scripts/check.sh'), '--scan-only'], env=env, capture_output=True, text=True)
            (OUT/f'shell-guard-mutation-{n}.log').write_text(done.stdout + done.stderr)
            self.assertEqual(done.returncode, 1, text + done.stdout + done.stderr)
            self.assertIn('Python runtime invocation', done.stdout)
        path.unlink()

    def test_native_process_inventory_available(self):
        status, evidence = native_inventory_probe()
        if status == 'unavailable':
            self.skipTest(evidence)
        self.assertEqual(status, 'available', evidence)
        self.assertIn(str(os.getpid()), evidence)

    @unittest.skipIf(SKIP_PUBLIC_SHELL_GATE, 'work order forbids executing the public check.sh')
    def test_public_shell_gate_detects_python_after_non_utf8_bytes(self):
        if os.name == 'nt':
            self.skipTest('POSIX shell release gate is unavailable on Windows')
        public = args.plugin.parent / 'scripts/check.sh'
        if not public.is_file():
            public = args.plugin.parent / 'coco/scripts/check.sh'
        folder = Path(tempfile.mkdtemp(prefix='byte-guard-', dir=OUT))
        (folder/'scripts').mkdir(); (folder/'plugin').mkdir()
        isolated_public_gate(public, folder/'scripts/check.sh')
        (folder/'plugin/injected.sh').write_bytes(b'\xff\xfe\npython3 script.py\n')
        env = dict(os.environ, LC_ALL='en_US.UTF-8', COCO_KEEP_SCRATCH='0', TMPDIR=str(OUT))
        done = subprocess.run(['/bin/sh', str(folder/'scripts/check.sh'), '--scan-only'], env=env, capture_output=True)
        (OUT/'shell-guard-non-utf8.log').write_bytes(done.stdout + done.stderr)
        self.assertEqual(done.returncode, 1, done.stdout + done.stderr)
        self.assertIn(b'Python runtime invocation', done.stdout)

    @unittest.skipIf(SKIP_PUBLIC_SHELL_GATE, 'work order forbids executing the public check.sh')
    def test_public_shell_gate_fails_when_the_scanner_cannot_read(self):
        if os.name == 'nt':
            self.skipTest('POSIX shell release gate is unavailable on Windows')
        public = args.plugin.parent / 'scripts/check.sh'
        if not public.is_file():
            public = args.plugin.parent / 'coco/scripts/check.sh'
        folder = Path(tempfile.mkdtemp(prefix='failed-guard-', dir=OUT))
        (folder/'scripts').mkdir(); (folder/'plugin').mkdir(); (folder/'commands').mkdir()
        isolated_public_gate(public, folder/'scripts/check.sh')
        (folder/'plugin/code.ts').write_text('export const valid = true\n')
        scanner = folder/'commands/sed'
        scanner.write_text('#!/bin/sh\nexit 71\n'); scanner.chmod(0o700)
        env = dict(os.environ, PATH=str(folder/'commands') + os.pathsep + os.environ['PATH'], COCO_KEEP_SCRATCH='0', TMPDIR=str(OUT))
        done = subprocess.run(['/bin/sh', str(folder/'scripts/check.sh'), '--scan-only'], env=env, capture_output=True, text=True)
        (OUT/'shell-guard-scanner-failed.log').write_text(done.stdout + done.stderr)
        self.assertEqual(done.returncode, 1, done.stdout + done.stderr)
        self.assertIn('Python runtime invocation scan failed', done.stdout)

    def test_shipping_inventory_excludes_ci_and_still_detects_runtime_python(self):
        folder = Path(tempfile.mkdtemp(prefix='shipping-guard-', dir=OUT))
        (folder/'hooks').mkdir()
        (folder/'companion-rs/ci').mkdir(parents=True)
        tool = folder/'companion-rs/ci/cache.py'
        tool.write_text('print("development helper")\n')
        runtime = folder/'hooks/injected.ts'
        runtime.write_text("spawn(['python3', 'helper.py'])\n")
        files = shipping_files(folder)
        self.assertNotIn(tool, files)
        self.assertIn(runtime, files)
        self.assertEqual(runtime_violations(folder, files), [str(runtime)])

    def test_shipping_plugin_contains_no_python_runtime_invocation_or_helper(self):
        self.assertEqual(runtime_violations(args.plugin, shipping_files(args.plugin)), [])


if __name__ == '__main__':
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(RuntimeGuardTests)
    if os.name != 'nt':
        bun = shutil.which('bun')
        if not bun:
            raise SystemExit('presence-transport.test.py: bun required for real shipping TypeScript transport tests')
        status, evidence = native_inventory_probe()
        if status == 'error':
            raise SystemExit('native process inventory failed: ' + evidence)
        # The harness starts shell hosts and helpers; a killed harness must not leave them waiting (they would
        # outlive it, reparented to init). It runs in its own process group, and nothing of that group may remain.
        real = subprocess.Popen([bun, str(Path(__file__).with_name('presence-real.ts')), str(args.plugin), str(OUT)], start_new_session=True)
        try:
            code = real.wait(timeout=75)
        except subprocess.TimeoutExpired:
            code = 'timeout after 75 s'
            os.killpg(real.pid, signal.SIGKILL)
        def running_in_group(group):
            # Live members only: helpers that just exited stay as zombies until init reaps them.
            alive = []
            for stat in Path('/proc').glob('[0-9]*/stat'):
                try:
                    fields = stat.read_text().rsplit(')', 1)[1].split()
                except OSError:
                    continue
                if fields[0] != 'Z' and int(fields[2]) == group:
                    alive.append(int(stat.parent.name))
            return alive
        leaked = running_in_group(real.pid) if Path('/proc/self/stat').exists() else []
        for _ in range(20):
            if not leaked:
                break
            time.sleep(0.1)
            leaked = running_in_group(real.pid)
        if leaked:
            os.killpg(real.pid, signal.SIGKILL)
        real.wait()
        if code:
            raise SystemExit('presence-real.ts: ' + str(code))
        if leaked:
            raise SystemExit('presence-real.ts left processes of its group running after it ended: ' + ' '.join(map(str, leaked)))
    done = unittest.TextTestRunner(verbosity=2).run(suite)
    print('Scratch evidence:', OUT)
    raise SystemExit(0 if done.wasSuccessful() else 1)
