#!/usr/bin/env python3
"""Shrink the 1024 px app icon PNG to an 8-bit palette PNG (about 125 KB instead of 740 KB).

Usage: python3 scripts/quantize-icon.py SOURCE_1024.png DEST.png   (needs Pillow)

Why not im.quantize(colors=256) alone: the icon has a soft drop shadow, a smooth alpha ramp of
pure black. A single shared octree palette collapses that ramp into a few steps, which shows up
as a hard grey band around the icon. (Pillow ignores dither= for FASTOCTREE, so dithering does
not help either.) So the 256 palette entries are split by role:

  0..31    black with alpha 0, 2, 4 ... 62   (the shadow ramp; the index is alpha/2, so the
                                             gradient also compresses well)
  32..71   octree colours for the thin anti-aliased rim of the squircle (RGBA)
  72..255  octree colours for the opaque artwork (RGB)

Maintainer tool only; the plugin does not need Python or Pillow at runtime.
"""
import sys

import numpy as np
from PIL import Image

STEP = 2          # shadow alpha step
SHADOW_MAX = 63   # shadow pixels are black with alpha 1..63
RIM_COLORS = 40
OPAQUE_FROM = 250  # alpha at or above this counts as opaque artwork


def main(src, dst):
    a = np.asarray(Image.open(src).convert("RGBA"))
    al = a[..., 3].astype(int)
    dark = a[..., :3].max(axis=2) < 16
    shadow = (al <= SHADOW_MAX) & dark
    opaque = al >= OPAQUE_FROM
    rim = ~shadow & ~opaque

    n_shadow = SHADOW_MAX // STEP + 1
    n_opaque = 256 - n_shadow - RIM_COLORS
    pal = np.zeros((256, 4), dtype=np.uint8)
    idx = np.zeros(al.shape, dtype=np.int32)

    pal[:n_shadow, 3] = np.arange(n_shadow) * STEP
    idx[shadow] = np.rint(al[shadow] / STEP).astype(int)

    def octree(pixels, mode, colors):
        flat = np.ascontiguousarray(pixels.reshape(-1, 1, pixels.shape[-1]))
        q = Image.fromarray(flat, mode).quantize(colors=colors, method=Image.Quantize.FASTOCTREE)
        table = sorted(q.palette.colors.items(), key=lambda kv: kv[1])
        return table, np.asarray(q).reshape(-1).astype(int)

    table, ix = octree(a[rim], "RGBA", RIM_COLORS)
    for color, i in table:
        pal[n_shadow + i] = color
    idx[rim] = ix + n_shadow

    base = n_shadow + RIM_COLORS
    table, ix = octree(a[opaque][:, :3], "RGB", n_opaque)
    for color, i in table:
        pal[base + i] = (*color[:3], 255)
    idx[opaque] = ix + base

    out = Image.fromarray(idx.astype("uint8"), "P")
    out.putpalette(pal[:, :3].reshape(-1).tolist())
    out.save(dst, optimize=True, transparency=bytes(pal[:, 3].tolist()))


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
