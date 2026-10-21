#!/usr/bin/env python3
"""tools/art/overlay-patch.py on the shipped desktop frames: the piece lands on the frame's own anchor,
nothing outside the changed box moves, and the shipped frames are never touched."""
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import art_intake_fixtures as F  # noqa: E402

ov = F.load_tool('overlay-patch')
ROOT = F.ROOT
FRAMES = ROOT / 'plugin/assets/desktop'


def frame(name):
    return ov.A.load_rgba(ov.frame_files(FRAMES)[name])


def tree_hash(folder):
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(Path(folder).glob('*.png'))}


def bow_piece(tmp):
    """The bow of think-a cut out and enlarged 8x, as a stand-in for a bow painted alone."""
    crop = Image.fromarray(frame('think-a')).crop((92, 28, 130, 75))
    big = np.asarray(crop.resize((crop.width * 8, crop.height * 8), Image.LANCZOS)).copy()
    rgb = big[..., :3].astype(int)
    hair = (rgb[..., 0] > 200) & (90 < rgb[..., 1]) & (rgb[..., 1] < 190) & (rgb[..., 2] < 170) & (np.abs(rgb[..., 0] - rgb[..., 1]) > 60)
    big[..., 3] = np.where(hair & ~((rgb[..., 1] < 110) & (rgb[..., 2] < 70)), 0, big[..., 3])
    path = Path(tmp) / 'bow.png'
    Image.fromarray(big).save(path)
    return path


def glasses_piece(tmp):
    """scroll-a enlarged 3x with thin brown rims and a bridge drawn round the two eyes."""
    base = frame('scroll-a')
    centres, boxes = ov.find_eyes(base)
    k = 3
    big = Image.fromarray(base).resize((base.shape[1] * k, base.shape[0] * k), Image.LANCZOS)
    draw = ImageDraw.Draw(big)
    for (x, y), b in zip(centres, boxes):
        r = (b[3] - b[1]) * 0.75 * k
        draw.ellipse([x * k - r, y * k - r, x * k + r, y * k + r], outline=(92, 42, 30, 255), width=3)
    path = Path(tmp) / 'glasses.png'
    big.save(path)
    return path, centres


class Overlay(unittest.TestCase):
    def test_a_bow_lands_on_each_frames_own_sunburst_and_nothing_else_moves(self):
        before_hashes = tree_hash(FRAMES)
        with tempfile.TemporaryDirectory() as tmp:
            piece = bow_piece(tmp)
            out = Path(tmp) / 'out'
            self.assertEqual(ov.main(['--piece', str(piece), '--kind', 'bow', '--only', 'work-a,sleep,idle-reading', '--out', str(out)]), 0)
            report = json.loads((out / 'overlay.json').read_text())
            for name in ('work-a', 'sleep', 'idle-reading'):
                with self.subTest(frame=name):
                    files = ov.frame_files(out / 'desktop')
                    after = ov.A.load_rgba(files[name])
                    before = frame(name)
                    want = ov.find_sunburst(before, ov.bow_area(before))
                    got = ov.find_sunburst(after, ov.bow_area(after))
                    self.assertAlmostEqual(got['point'][0], want['point'][0], delta=1.0)
                    self.assertAlmostEqual(got['point'][1], want['point'][1], delta=1.0)
                    self.assertAlmostEqual(got['length'], want['length'], delta=1.5)
                    x0, y0, x1, y1 = report['frames'][name]['changed_box']
                    outside = np.ones(before.shape[:2], bool)
                    outside[y0:y1, x0:x1] = False
                    self.assertTrue(np.array_equal(before[outside], after[outside]))
                    self.assertTrue((out / 'checks' / f'{files[name].stem}-6x.png').exists())
                    self.assertTrue((out / 'patch' / f'{files[name].stem}.png').exists())
        self.assertEqual(before_hashes, tree_hash(FRAMES))

    def test_glasses_take_only_the_box_round_the_eyes_and_sit_on_them(self):
        with tempfile.TemporaryDirectory() as tmp:
            piece, centres = glasses_piece(tmp)
            out = Path(tmp) / 'out'
            self.assertEqual(ov.main(['--piece', str(piece), '--kind', 'eyes', '--only', 'scroll-a', '--out', str(out)]), 0)
            before = frame('scroll-a')
            after = ov.A.load_rgba(ov.frame_files(out / 'desktop')['scroll-a'])
            changed = np.any(before != after, -1)
            ys, xs = np.where(changed)
            rim = (np.abs(after[..., :3].astype(int) - [92, 42, 30]).max(-1) <= 40) & changed
            ry, rx = np.where(rim)
            self.assertGreater(len(rx), 30)
            mid_x, mid_y = sum(c[0] for c in centres) / 2, sum(c[1] for c in centres) / 2
            self.assertAlmostEqual(rx.mean(), mid_x, delta=1.5)
            self.assertAlmostEqual(ry.mean(), mid_y, delta=1.5)
            region = json.loads((out / 'overlay.json').read_text())['frames']['scroll-a']['changed_box']
            self.assertLess(xs.max() - xs.min(), 55)
            self.assertLess(ys.max() - ys.min(), 40)
            self.assertEqual(region[1], ys.min())
            found = ov.find_eyes(after)[0]
            for a, b in zip(found, centres):
                self.assertAlmostEqual(a[0], b[0], delta=1.0)
                self.assertAlmostEqual(a[1], b[1], delta=1.0)

    def test_snap_to_frame_keeps_to_the_frames_own_colours(self):
        with tempfile.TemporaryDirectory() as tmp:
            piece, _ = glasses_piece(tmp)
            out = Path(tmp) / 'out'
            ov.main(['--piece', str(piece), '--kind', 'eyes', '--only', 'scroll-a', '--snap-to-frame', '--out', str(out)])
            before = frame('scroll-a')
            after = ov.A.load_rgba(ov.frame_files(out / 'desktop')['scroll-a'])
            palette = {tuple(p[:3]) for p in before.reshape(-1, 4) if p[3] > 200}
            box = np.any(before != after, -1)
            used = {tuple(p[:3]) for p in after[box] if p[3] > 0}
            self.assertTrue(used <= palette, len(used - palette))

    def test_the_draft_bow_anchors_find_one_sunburst_on_every_frame(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(ov.main(['--draft-anchors', 'bow', '--out', tmp]), 0)
            draft = json.loads((Path(tmp) / 'anchors-bow-draft.json').read_text())
            shipped = json.loads((ROOT / 'plugin/assets/frame-manifest.json').read_text())['frames']
            self.assertEqual(sorted(draft['frames']), sorted(f['name'] for f in shipped))
            self.assertEqual(len(draft['frames']), 42)
            for name, a in draft['frames'].items():
                with self.subTest(frame=name):
                    self.assertTrue(100 <= a['point'][0] <= 122 and 44 <= a['point'][1] <= 58, a)
                    self.assertTrue(13.5 <= a['length'] <= 17.5, a)

    def test_manifest_eyes_agree_with_the_eyes_found_in_the_frame(self):
        manifest = json.loads((ROOT / 'plugin/assets/frame-manifest.json').read_text())
        known = ov.manifest_eyes(manifest)
        for name in ('idle-reading', 'work-a', 'think-a'):
            with self.subTest(frame=name):
                found = ov.eyes_anchor(ov.find_eyes(frame(name))[0])
                self.assertAlmostEqual(found['point'][0], known[name]['point'][0], delta=2.0)
                self.assertAlmostEqual(found['point'][1], known[name]['point'][1], delta=2.0)
                self.assertAlmostEqual(found['length'], known[name]['length'], delta=2.0)

    def test_it_will_not_write_over_the_shipped_frames_or_into_the_plugin(self):
        before = tree_hash(FRAMES)
        with tempfile.TemporaryDirectory() as tmp:
            piece = bow_piece(tmp)
            for target in (FRAMES, FRAMES / 'x', ROOT / 'plugin/assets'):
                with self.subTest(out=str(target)):
                    with self.assertRaises(SystemExit):
                        ov.main(['--piece', str(piece), '--kind', 'bow', '--only', 'work-a', '--out', str(target)])
        self.assertEqual(before, tree_hash(FRAMES))
        self.assertFalse((FRAMES / 'x').exists())

    def test_naming_no_frames_lists_them_instead_of_patching_all(self):
        with tempfile.TemporaryDirectory() as tmp:
            piece = bow_piece(tmp)
            with self.assertRaises(SystemExit) as caught:
                ov.main(['--piece', str(piece), '--kind', 'bow', '--out', str(Path(tmp) / 'out')])
            self.assertIn('--only', str(caught.exception))


if __name__ == '__main__':
    unittest.main()
