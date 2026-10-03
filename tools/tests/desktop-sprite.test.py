#!/usr/bin/env python3
"""Check the two shipped band sprite families without an image decoder or app access."""
import json
from pathlib import Path
import re
import struct
import unittest

ROOT = Path(__file__).resolve().parents[2]


class DesktopSpriteAssets(unittest.TestCase):
    def test_every_registered_frame_has_pixel_and_painted_pngs_at_native_size(self):
        art = (ROOT / 'plugin/hooks/art.ts').read_text()
        names = re.search(r'export const FRAME_NAMES = (\[[^\n]+\]) as const', art)
        self.assertIsNotNone(names, 'the generated frame inventory must remain readable')
        frames = json.loads(names[1])
        self.assertEqual(len(frames), 16)
        self.assertEqual(len(set(frames)), 16)
        filenames = {f'{i:02d}-{frame}.png' for i, frame in enumerate(frames, 1)}
        for family, dimensions in [('pixel', (35, 32)), ('desktop', (137, 128))]:
            folder = ROOT / 'plugin/assets' / family
            self.assertEqual({p.name for p in folder.glob('*.png')}, filenames)
            for filename in sorted(filenames):
                with self.subTest(family=family, frame=filename):
                    data = (folder / filename).read_bytes()
                    self.assertEqual(data[:8], b'\x89PNG\r\n\x1a\n')
                    self.assertEqual(data[12:16], b'IHDR')
                    self.assertEqual(struct.unpack('>II', data[16:24]), dimensions)
                    self.assertEqual(data[-8:-4], b'IEND')


if __name__ == '__main__':
    unittest.main(verbosity=2)
