#!/usr/bin/env python3
"""Presence security source gates; dynamic file attacks run in the companion/native harness."""
from pathlib import Path
import os
import re
import unittest
ROOT = Path(__file__).resolve().parents[2]
PLUGIN = Path(os.environ.get('PRESENCE_SECURITY_PLUGIN', ROOT / 'plugin'))
class PresenceSecurity(unittest.TestCase):
    def test_metadata_only_identity(self):
        for relative in ['bin/presence-native.c', 'companion/Sources/PresenceObserver.swift']:
            source = (PLUGIN / relative).read_text()
            self.assertFalse('KERN_PROCARGS2' in source, relative)
        source = (PLUGIN / 'hooks/presence.ts').read_text()
        self.assertFalse('reader.args' in source)
        self.assertIn('registeredOwner', source)
        self.assertFalse('this.io.write(' in source)
        self.assertIn("'fifo-send'", source)
    def test_no_environment_snapshot(self):
        source = (PLUGIN / 'companion/Sources/Neighbours.swift').read_text()
        self.assertFalse('ProcessInfo.processInfo.environment' in source)
        self.assertFalse('private let environment: [String: String]' in source)
    def test_native_readers_do_not_access_process_text(self):
        # Source-policy coverage, not dynamic interception. Own CLI argv and
        # individual getenv calls remain permitted; process-text reads do not.
        forbidden = (
            r'\bKERN_PROCARGS(?:2)?\b',
            r'''["'][^"'\n]*(?:/|\b)(?:cmdline|environ|mem)["']''',
            r'\b(?:(?:NR_|SYS_|__NR_)?process_vm_readv|(?:NR_|SYS_|__NR_)?ptrace)\b',
            r'\b(?:task_for_pid|mach_vm_read(?:_overwrite)?|vm_read(?:_overwrite)?)\s*\(',
            r'\b_NSGetEnviron\s*\(',
            r'\bProcessInfo\s*\.\s*processInfo\s*\.\s*environment\b',
        )
        # Synthetic source strings show each gate detects its prohibited form;
        # these APIs and paths are never executed or opened by the test.
        samples = (
            'sysctl(KERN_PROCARGS2)', 'path(proc, "cmdline")',
            'syscall6(NR_process_vm_readv, pid)', 'mach_vm_read(task, address)',
            '_NSGetEnviron()', 'ProcessInfo.processInfo.environment',
        )
        for pattern, sample in zip(forbidden, samples):
            self.assertRegex(sample, pattern)
            self.assertNotRegex('int main(int argc, char **argv) { getenv("ALLOWED_DIRECTORY"); }', pattern)
        readers = (
            'bin/presence-native.c', 'bin/presence-linux.c', 'bin/companion-control.c',
            'companion/Sources/PresenceObserver.swift', 'companion/Sources/Neighbours.swift',
            'hooks/presence.ts',
        )
        for relative in readers:
            source = (PLUGIN / relative).read_text()
            for pattern in forbidden:
                with self.subTest(reader=relative, forbidden=pattern):
                    self.assertIsNone(re.search(pattern, source), relative)
    def test_native_file_boundary(self):
        source = (PLUGIN / 'bin/presence-native.c').read_text()
        self.assertIn('openat(', source)
        self.assertIn('O_NOFOLLOW', source)
        self.assertIn('st_nlink != 1', source)
        self.assertIn('renameat(', source)
        self.assertFalse('O_TRUNC' in source)
        linux = (PLUGIN / 'bin/presence-linux.c').read_text()
        self.assertFalse('O_TRUNC' in linux)
        self.assertIn('secure_directory(', linux)
        self.assertIn('O_NOFOLLOW|O_NONBLOCK', linux)
        self.assertIn('NR_renameat2', linux)
        self.assertNotIn('create_file(journal); output', linux)
        self.assertIn('fifo_send(', linux)
if __name__ == '__main__': unittest.main()
