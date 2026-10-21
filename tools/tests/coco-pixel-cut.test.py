#!/usr/bin/env python3
"""tools/art/coco-pixel-cut.py reads the kit's own guides back exactly after they are scaled the way a redraw
comes back (another square size, a JPEG round trip, room around the drawing)."""
import io
import subprocess
import sys
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scratch import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[2]
KIT = ROOT / 'art' / 'ref' / '新形象' / '放开版' / '像素'
TOOL = ROOT / 'tools' / 'art' / 'coco-pixel-cut.py'


def truth(img, block, boxes):
    a = np.asarray(img.convert('RGB')).astype(float)
    return [np.array([[a[int((by + j + 0.5) * block), int((bx + i + 0.5) * block)] for i in range(24)] for j in range(18)])
            for bx, by in boxes]


def redraw(img, size, pad, path):
    im = img.convert('RGB').resize(size, Image.LANCZOS)
    if pad:
        bg = Image.new('RGB', (size[0] + 2 * pad, size[1] + 2 * pad), (255, 255, 255))
        bg.paste(im, (pad, pad))
        im = bg
    b = io.BytesIO()
    im.save(b, 'JPEG', quality=88)
    Image.open(io.BytesIO(b.getvalue())).convert('RGB').save(path)


class PixelCut(unittest.TestCase):
    def check(self, guide, block, boxes, size, pad, mode):
        img = Image.open(KIT / guide)
        with TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            redraw(img, size, pad, tmp / 'in.png')
            run = subprocess.run([sys.executable, '-I', str(TOOL), str(tmp / 'in.png'), str(tmp / 'out'), mode, '--guide', str(KIT / guide)],
                                 capture_output=True, text=True)
            self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
            for n, want in enumerate(truth(img, block, boxes), 1):
                got = np.asarray(Image.open(tmp / 'out' / f'{n}.png').convert('RGBA')).astype(float)
                paper = np.abs(want - 255).sum(-1) < 6
                drawn = got[..., 3] > 0
                # paper reads as transparent; the white keycap inside the outline stays white
                self.assertTrue((~drawn[paper] | (np.abs(got[..., :3][paper] - 255).sum(-1) < 6)).all(), n)
                self.assertTrue(drawn[~paper].all(), n)
                self.assertTrue((np.abs(got[..., :3][~paper] - want[~paper]).sum(-1) < 6).all(), n)

    def test_the_test_cell_at_another_size(self):
        self.check('试一格-引导.png', 16, [(0, 0)], (1024, 768), 0, '--cell')

    def test_a_sheet_with_room_around_it(self):
        self.check('引导-1.png', 10, [(c * 28, r * 22) for r in range(4) for c in range(4)], (1300, 1011), 50, '--sheet')


if __name__ == '__main__':
    unittest.main()
