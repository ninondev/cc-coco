#!/usr/bin/env python3
"""HIGH-CONTRAST.md section 5: actual shipped silhouette pixels, no art edits."""
import argparse
import hashlib
import json
import unittest
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
GROUNDS = {'black': '#000000', 'aquatic': '#202020', 'dusk': '#2D3236', 'desert': '#FFFAEF', 'white': '#FFFFFF'}
MINIMUM = 0.85


def luminance(rgb):
    values = [value / 255 for value in rgb[:3]]
    linear = [value / 12.92 if value <= .04045 else ((value + .055) / 1.055) ** 2.4 for value in values]
    return sum(value * weight for value, weight in zip(linear, (.2126, .7152, .0722)))


def measure(path, radius=1):
    with Image.open(path) as source:
        image = source.convert('RGBA')
    width, height = image.size
    pixels = list(image.getdata())
    opaque = [pixel[3] >= 128 for pixel in pixels]
    light = [luminance(pixel) for pixel in pixels]
    # Designer's opaque threshold, 4-neighbour silhouette and bottom bust-cut exclusion.
    edge = []
    for y in range(max(0, height - 2)):
        for x in range(width):
            if opaque[y * width + x] and any(not (0 <= nx < width and 0 <= ny < height) or not opaque[ny * width + nx] for nx, ny in ((x-1,y),(x+1,y),(x,y-1),(x,y+1))):
                edge.append((x, y))
    assert edge, f'Frame has no visible silhouette: {path}'
    out = {}
    for name, color in GROUNDS.items():
        ground = luminance(tuple(int(color[index:index+2], 16) for index in (1,3,5)))
        passing = 0
        for x, y in edge:
            best = 0
            for ny in range(max(0,y-radius), min(height,y+radius+1)):
                for nx in range(max(0,x-radius), min(width,x+radius+1)):
                    if opaque[ny * width + nx]:
                        value = light[ny * width + nx]
                        best = max(best, (max(value,ground)+.05)/(min(value,ground)+.05))
            passing += best >= 3
        out[name] = {'passing': passing, 'silhouette': len(edge), 'share': passing / len(edge)}
    return out


class SilhouettePromises(unittest.TestCase):
    def test_HC5_every_shipped_frame_at_least_85_percent_on_five_grounds(self):
        manifest = json.loads((ROOT / 'plugin/assets/frame-manifest.json').read_text())
        results, failures = {}, []
        for family in ('desktop', 'pixel', 'kitty'):
            folder = ROOT / 'plugin/assets' / family
            if family in ('desktop', 'pixel'):
                self.assertTrue(folder.is_dir(), f'{family}: required shipped frame family is missing')
            if not folder.exists():
                continue
            files = sorted(folder.glob('*.png'))
            self.assertTrue(files, f'{family}: empty shipped frame inventory')
            if family in ('desktop', 'pixel'):
                expected = {frame['filename'] for frame in manifest['frames']}
                if family == 'pixel':
                    expected |= {'42-shed-a.png', '43-shed-b.png', '44-shed-c.png'}
                self.assertEqual({path.name for path in files}, expected, f'{family}: shipped frame inventory differs from manifest')
            for path in files:
                # Painted art is drawn at 64 CSS px from the 128 px source; pixel
                # art uses its 32 px source at 32 CSS px. Match edges.py's radii.
                radius = 2 if family == 'desktop' else 1
                row = measure(path, radius)
                results[path.relative_to(ROOT).as_posix()] = {'sourceSha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'sourcePixelRadius': radius, 'grounds': row}
                for ground, value in row.items():
                    if value['share'] < MINIMUM:
                        failures.append(f'{path.relative_to(ROOT)} {ground}: {value["passing"]}/{value["silhouette"]} ({value["share"]:.9%}) < 85%')
        self.assertTrue(results)
        if RECEIPT:
            RECEIPT.parent.mkdir(parents=True, exist_ok=True)
            RECEIPT.write_text(json.dumps({'minimum': MINIMUM, 'grounds': GROUNDS, 'frames': results, 'failures': failures}, indent=2) + '\n')
        print(f'HC5 measured {len(results)} shipped frames; {len(failures)} frame/ground failures', flush=True)
        self.assertEqual(failures, [], '\n'.join(failures))


RECEIPT = None
if __name__ == '__main__':
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument('--root', type=Path)
    parser.add_argument('--receipt', type=Path)
    args, remaining = parser.parse_known_args()
    if args.root:
        ROOT = args.root.resolve()
    RECEIPT = args.receipt
    unittest.main(argv=['promises-silhouette', *remaining], verbosity=2)
