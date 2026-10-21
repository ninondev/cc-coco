#!/usr/bin/env python3
"""C3 startup graph and separate pure-algorithm runner contracts."""
import importlib.util
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from hooks_source import hook_source

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools'))
spec = importlib.util.spec_from_file_location('load_path_runner', ROOT / 'tools/run-tests.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


def eager_modules(entry):
    seen = set()
    def visit(path):
        path = path.resolve()
        if path in seen:
            return
        seen.add(path)
        text = path.read_text()
        imports = re.finditer(r"^import\s+(?:(type)\s+)?[\s\S]*?from\s+['\"]([^'\"]+)['\"]", text, re.M)
        for statement in imports:
            if statement[1]:
                continue
            target = path.parent / statement[2]
            for suffix in ('.ts', '.tsx', '.json'):
                candidate = target.with_suffix(suffix)
                if candidate.exists():
                    if suffix != '.json':
                        visit(candidate)
                    else:
                        seen.add(candidate.resolve())
                    break
    visit(entry)
    return seen


class LoadPathContracts(unittest.TestCase):
    def test_closed_book_does_not_evaluate_book_modules(self):
        graph = eager_modules(hook_source(ROOT / 'plugin/hooks/register.tsx'))
        for name in ('book-text.ts', 'card-metrics.ts', 'card-metrics-latin.ts', 'card-metrics-hi.ts'):
            self.assertNotIn(hook_source(ROOT / 'plugin/hooks' / name).resolve(), graph, name)

    def test_source_graph_detects_static_value_import_and_skips_types(self):
        import tempfile
        with tempfile.TemporaryDirectory(prefix='moe-c3-graph-') as folder:
            base = Path(folder)
            (base / 'entry.ts').write_text("import { value } from './data'\nimport type { Kind } from './types'\nconst later = () => import('./later')\n")
            for name in ('data', 'types', 'later'):
                (base / (name + '.ts')).write_text('export const value = 1\n')
            self.assertEqual(eager_modules(base / 'entry.ts'), {(base / 'entry.ts').resolve(), (base / 'data.ts').resolve()})

    def test_lazy_version_matches_manifest(self):
        import json
        version = json.loads((ROOT / 'plugin/.claude-plugin/plugin.json').read_text())['version']
        text = hook_source(ROOT / 'plugin/hooks/plugin-version.ts').read_text()
        self.assertEqual(re.search(r'PLUGIN_VERSION = ("[^"]+")', text)[1], json.dumps(version))

    def test_engine_copy_excludes_independently_run_bun_algo_tests(self):
        ignored = runner.skip_test_files(str(ROOT / 'tools/tests'))(str(ROOT / 'tools/tests'), ['algo', 'startup.test.tsx', 'fixtures'])
        self.assertIn('algo', ignored)
        self.assertNotIn('startup.test.tsx', ignored)
        self.assertNotIn('fixtures', ignored)


if __name__ == '__main__':
    unittest.main()
