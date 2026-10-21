#!/usr/bin/env python3
"""Assert the isolated lifecycle cleanup contract without running a CLI install."""
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(os.environ.get('COCO_PROMISES_ROOT', Path(__file__).resolve().parents[2]))


class InstallPromises(unittest.TestCase):
    def test_E2_store_cleanup_assertion_detects_retained_namespaced_files(self):
        text = (ROOT / 'tools/release/install-test.sh').read_text()
        helper = re.search(r"cat > .*?assert.py.*?<<'PY'\n([\s\S]*?)\nPY", text)[1]
        with tempfile.TemporaryDirectory(prefix='p1-store-contract-') as folder:
            base = Path(folder).resolve()
            for name in ('config/settings.json', 'project-a/.claude/settings.json', 'project-b/.claude/settings.local.json', 'config/plugins/installed_plugins.json', 'final-list.json'):
                path = base / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('[]' if name == 'final-list.json' else '{}')
            (base / 'installed-path.txt').write_text(str(base / 'config/plugins/cache/coco/plugin'))
            def run():
                return subprocess.run([sys.executable, '-c', helper, 'clean', str(base), str(base / 'final-list.json')], capture_output=True, text=True, env=dict(os.environ, HOME=str(base / 'home'), CLAUDE_CONFIG_DIR=str(base / 'config')))
            clean = run()
            self.assertEqual(clean.returncode, 0, clean.stderr)
            for root in ('config/plugins/store', 'home/.claude/plugins/store'):
                owned = base / root / 'coco@coco.json'
                owned.parent.mkdir(parents=True, exist_ok=True)
                owned.write_text('{"fixture":"must not remain"}')
                retained = run()
                self.assertNotEqual(retained.returncode, 0, f'Failed to reject {root}')
                self.assertIn('Plugin store files remain after uninstall', retained.stderr)
                self.assertTrue(owned.exists(), 'Assertion may not delete store data to turn green')
                owned.unlink()
            other = base / 'config/plugins/store/another-plugin.json'
            other.write_text('{"fixture":"preserve"}')
            self.assertEqual(run().returncode, 0)
            self.assertTrue(other.exists())


if __name__ == '__main__':
    unittest.main(verbosity=2)
