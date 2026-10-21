#!/usr/bin/env python3
"""The back view and the dizzy face (tools/art/frame-manifest-turn.json): while the file is off the
build reads nothing from it; turned on, it adds a turn_frames list and the PNGs and checks them first."""
import hashlib
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), ROOT / 'tools' / f'{name}.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


assets = load('build-assets')
frames = load('build-art-frames')
SPEC = json.loads((ROOT / 'tools/art/frame-manifest-turn.json').read_text())


def png(size, mode='RGBA'):
    buf = io.BytesIO()
    Image.new(mode, size, (200, 100, 80, 255)[:len(mode)]).save(buf, 'PNG')
    return buf.getvalue()


def write_art(root, spec):
    for frame in spec['frames']:
        for kind in ('painted', 'pixel'):
            path = root / frame[kind]['file']
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(png(tuple(frame[kind]['size'])))


class TurnFrames(unittest.TestCase):
    def test_the_committed_file_is_off_and_names_both_frames_once(self):
        self.assertFalse(SPEC['enabled'])
        self.assertEqual([f['name'] for f in SPEC['frames']], ['spin-back', 'dizzy'])
        names = [f[k]['filename'] for f in SPEC['frames'] for k in ('painted', 'pixel')]
        self.assertEqual(len(set(names)), 4)
        self.assertTrue(all(n.startswith(('assets/desktop/', 'assets/pixel/')) for n in names))
        existing = {p.name for folder in ('desktop', 'pixel') for p in (ROOT / 'plugin/assets' / folder).glob('*.png')}
        self.assertFalse({Path(n).name for n in names} & existing)
        self.assertEqual({f['base'] for f in SPEC['frames']}, {'flustered'})

    def test_off_or_absent_adds_nothing(self):
        self.assertEqual(assets.turn_frames(), [])
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(assets.turn_frames(Path(tmp) / 'none.json', Path(tmp)), [])
        manifest, output = {'frames': [1]}, {'a': b'x'}
        frames.add_turn_frames(manifest, output, [])
        self.assertEqual((manifest, output), ({'frames': [1]}, {'a': b'x'}))

    def test_on_with_the_art_in_adds_entries_and_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            on = dict(SPEC, enabled=True)
            (root / 'turn.json').write_text(json.dumps(on))
            write_art(root, on)
            turn = assets.turn_frames(root / 'turn.json', root)
            self.assertEqual([e['name'] for e, _ in turn], ['spin-back', 'dizzy'])
            manifest, output = {'frames': ['kept']}, {}
            frames.add_turn_frames(manifest, output, turn)
            self.assertEqual(manifest['frames'], ['kept'])
            self.assertEqual(len(manifest['turn_frames']), 2)
            self.assertEqual(sorted(output), sorted(f[k]['filename'] for f in SPEC['frames'] for k in ('painted', 'pixel')))
            entry = manifest['turn_frames'][0]
            data = output[entry['painted']['filename']]
            self.assertEqual(entry['painted']['sha256'], hashlib.sha256(data).hexdigest())

    def test_on_without_the_art_stops_and_names_the_missing_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'turn.json').write_text(json.dumps(dict(SPEC, enabled=True)))
            with self.assertRaises(ValueError) as caught:
                assets.turn_frames(root / 'turn.json', root)
            self.assertIn('art/turn/spin-back.png', str(caught.exception))

    def test_a_picture_of_the_wrong_size_or_mode_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            on = dict(SPEC, enabled=True)
            (root / 'turn.json').write_text(json.dumps(on))
            write_art(root, on)
            (root / on['frames'][0]['pixel']['file']).write_bytes(png((36, 32)))
            with self.assertRaises(ValueError) as caught:
                assets.turn_frames(root / 'turn.json', root)
            self.assertIn('expected RGBA 35x32', str(caught.exception))
            (root / on['frames'][0]['pixel']['file']).write_bytes(png((35, 32), 'RGB'))
            with self.assertRaises(ValueError):
                assets.turn_frames(root / 'turn.json', root)


if __name__ == '__main__':
    unittest.main()
