"""Synthetic pictures for the art intake tool tests: a known pixel grid, then the way an image model
might hand it back (non-integer scale, soft edges, noise, a flat or checkered background)."""
import importlib.util
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
ART = ROOT / 'tools' / 'art'
# Far enough apart that noise and blur cannot make one read as another.
PALETTE = ['#5C2A1E', '#1E1514', '#EC8462', '#FDE6DE', '#E8501F', '#A8D4E6']


def load_tool(name):
    """A tools/art script by file name (they have hyphens, so no plain import)."""
    sys.path.insert(0, str(ART))
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), ART / f'{name}.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def rgb(h):
    return [int(h[i:i + 2], 16) for i in (1, 3, 5)]


def make_art(w, h, seed, palette=PALETTE, hole=True):
    """A blocky sprite: a body of overlapping rectangles, flat colour blocks, a one pixel outline,
    black eyes, a small hole, and a few lone pixels."""
    rng = np.random.default_rng(seed)
    body = np.zeros((h, w), bool)
    body[h // 5:h - 1, w // 6:w - w // 6] = True
    for _ in range(3):
        x0, y0 = rng.integers(0, max(1, w // 2)), rng.integers(0, max(1, h // 2))
        body[y0:y0 + rng.integers(h // 4, h // 2 + 2), x0:x0 + rng.integers(w // 3, w // 2 + 2)] = True
    body[0, w // 3:w // 3 + 2] = True
    inner = ndi.binary_erosion(body, border_value=0)
    art = np.zeros((h, w, 4), np.uint8)
    colours = [rgb(c) for c in palette]
    blocks = rng.integers(2, 6, size=(h // 3 + 1, w // 3 + 1))
    for y in range(h):
        for x in range(w):
            if body[y, x]:
                art[y, x] = colours[blocks[y // 3, x // 3]] + [255]
    art[body & ~inner] = colours[0] + [255]
    ey = h // 2
    for ex in (w // 3, 2 * w // 3):
        art[ey:ey + 3, ex:ex + 2] = colours[1] + [255]
    if ey + 5 < h:
        art[ey + 5, w // 2] = colours[4] + [255]
    if hole:
        art[ey + 6:ey + 8, w // 2 + 2:w // 2 + 4] = 0
    return art


def paint(art, scale, blur=1.0, noise=5.0, bg=None, seed=1, pad=(0, 0, 0, 0), aspect=1.0):
    """Hand a grid back the way an image model might: bicubic to a non-integer scale (so art pixels
    are slightly uneven), a Gaussian blur, noise, transparent padding (left, top, right, bottom in
    art pixels), and optionally a flat colour or 'checker' background."""
    rng = np.random.default_rng(seed)
    h, w = art.shape[:2]
    W, H = round(w * scale), round(h * scale * aspect)
    f = art.astype(np.float32) / 255.0
    pm = np.dstack([f[..., :3] * f[..., 3:4], f[..., 3:4]])
    big = np.dstack([np.asarray(Image.fromarray((pm[..., k] * 255).round().astype(np.uint8)).resize((W, H), Image.NEAREST)) for k in range(4)])
    chans = [Image.fromarray(big[..., k]) for k in range(4)]
    if blur:
        chans = [c.filter(ImageFilter.GaussianBlur(blur)) for c in chans]
    out = np.stack([np.asarray(c).astype(np.float32) / 255.0 for c in chans], -1)
    a = np.clip(out[..., 3:4], 0, 1)
    colour = np.where(a > 1e-3, out[..., :3] / np.maximum(a, 1e-3), 0)
    colour = np.clip(colour * 255 + rng.normal(0, noise, colour.shape) * (a > 0.5), 0, 255)
    res = np.dstack([colour, a * 255]).round().astype(np.uint8)
    left, top, right, bottom = (round(p * scale) for p in pad)
    res = np.pad(res, ((top, bottom), (left, right), (0, 0)))
    if bg is not None:
        hh, ww = res.shape[:2]
        if bg == 'checker':
            yy, xx = np.mgrid[:hh, :ww]
            ground = np.where(((yy // 24 + xx // 24) % 2)[..., None] == 0, 255, 204).repeat(3, -1)
        else:
            ground = np.broadcast_to(np.array(bg, float), (hh, ww, 3))
        al = res[..., 3:4] / 255.0
        res = np.dstack([(res[..., :3] * al + ground * (1 - al)).round().astype(np.uint8), np.full((hh, ww), 255, np.uint8)])
    return res


def ink_box(art):
    ys, xs = np.where(art[..., 3] > 0)
    return [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]


def sheet_of(pictures, cols, gap=4, palette=PALETTE):
    """A kit target and the exact art sheet for pictures laid out cols to a row, top left in their cells."""
    cw = max(p.shape[1] for p in pictures)
    ch = max(p.shape[0] for p in pictures)
    rows = (len(pictures) + cols - 1) // cols
    sw, sh = cols * cw + (cols + 1) * gap, rows * ch + (rows + 1) * gap
    truth = np.zeros((sh, sw, 4), np.uint8)
    cells = []
    for n, art in enumerate(pictures):
        x, y = gap + (n % cols) * (cw + gap), gap + (n // cols) * (ch + gap)
        truth[y:y + art.shape[0], x:x + art.shape[1]] = art
        cells.append(dict(id=f'p{n}', x=x, y=y, w=art.shape[1], h=art.shape[0], ink=ink_box(art)))
    kit = dict(key='test', palette='test', block=7, margin=gap, sheet=[sw, sh], cells=cells,
               palette_def=dict(colours=[c.upper() for c in palette], keep=[palette[3], palette[1]]))
    return kit, truth


def wrong_set(truth, cell, got):
    """(x, y) of the art pixels in one cell that differ from the truth (colour or clear)."""
    want = truth[cell['y']:cell['y'] + cell['h'], cell['x']:cell['x'] + cell['w']].copy()
    have = got.copy()
    want[want[..., 3] == 0] = 0
    have[have[..., 3] == 0] = 0
    return {(int(x), int(y)) for y, x in np.argwhere(np.any(want != have, -1))}


def wrong_cells(truth, kit, got):
    return sum(len(wrong_set(truth, c, got[c['id']])) for c in kit['cells'])
