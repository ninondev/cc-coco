#!/usr/bin/env python3
"""Offline registry aliases preserve source bytes and use only owned scratch."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('offline_registry_unit', ROOT/'plugin/companion-rs/ci/offline_registry.py')
cache = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cache)


class RegistryCache(unittest.TestCase):
    def test_defaults_preserve_the_prior_official_source(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(cache.source_context(), (Path('/private/tmp/companion-cargo-windows/registry'), 'index.crates.io-1949cf8c6b5b557f'))

    def test_mirror_alias_is_local_offline_and_does_not_modify_source(self):
        with tempfile.TemporaryDirectory(prefix='g1-registry-unit-', dir=os.environ['TMPDIR']) as folder:
            root = Path(folder)
            source, home, registry = root/'source', root/'home', 'owner-mirror-123'
            home.mkdir()
            originals = {}
            for kind in ('cache', 'index', 'src'):
                path = source/kind/registry/'fixture'
                path.parent.mkdir(parents=True)
                path.write_bytes((kind+' unchanged').encode())
                originals[kind] = path
            with patch.dict(os.environ, {cache.SOURCE_ENV: str(source), cache.REGISTRY_ENV: registry}):
                context = cache.prepare_registry(home)
            self.assertEqual(context['registry'], registry)
            self.assertEqual(context['source'], str(source))
            self.assertIn('offline = true', (home/'config.toml').read_text())
            self.assertTrue((home/'registry/cache'/registry).exists())
            for kind, original in originals.items():
                alias = home/'registry'/kind/cache.DEFAULT_REGISTRY/'fixture'
                self.assertEqual(alias.read_bytes(), original.read_bytes())
                self.assertEqual((home/'registry'/kind/registry/'fixture').read_bytes(), original.read_bytes())
                if kind != 'cache':
                    self.assertNotEqual(alias.stat().st_ino, original.stat().st_ino)
                    alias.write_bytes(b'owned alias mutation')
                    self.assertEqual(original.read_bytes(), (kind+' unchanged').encode())

    def test_missing_registry_kind_fails_before_alias_write(self):
        with tempfile.TemporaryDirectory(prefix='g1-registry-red-', dir=os.environ['TMPDIR']) as folder:
            root = Path(folder)
            (root/'home').mkdir()
            with patch.dict(os.environ, {cache.SOURCE_ENV: str(root/'absent'), cache.REGISTRY_ENV: 'mirror'}):
                with self.assertRaises(FileNotFoundError):
                    cache.prepare_registry(root/'home')
            self.assertEqual(list((root/'home').iterdir()), [])

    def test_registry_traversal_is_rejected(self):
        for name in ('../mirror', 'x/y', '.', '..', ''):
            with self.subTest(name=name), patch.dict(os.environ, {cache.REGISTRY_ENV: name}):
                with self.assertRaises(ValueError):
                    cache.source_context()


if __name__ == '__main__':
    unittest.main()
