#!/usr/bin/env python3
"""Generates WorkoutApp's launcher icons and splash image from logo.png (black background, red/white emblem).

    python3 make-icons.py <android res dir> [logo.png] [--preview preview.png]

Writes into the generated Android project (android/app/src/main/res):
  * adaptive icon (Android 8+): black background colour + emblem foreground + monochrome layer for themed icons (Android 13+)
  * legacy square + round icons (ic_launcher.png / ic_launcher_round.png) for every density
  * splash.png replacements: black background with the emblem centred (same size as the existing template files)
The emblem is scaled so its sharpest tips stay inside Android's adaptive-icon safe zone (a circle of 66 of the 108 dp)
and is re-centred (the source art sits a little above the middle). Needs: pip install pillow numpy
"""
import glob
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

SAFE_FRACTION = 0.29    # farthest solid pixel stays within 29% of the 108dp canvas (the safe circle's radius is 30.5%)
LEGACY_FRACTION = 0.42  # legacy icons have no safe-zone rule: let the emblem fill more of the square
SPLASH_FRACTION = 0.16  # emblem radius as a fraction of the splash's shorter side
BG = (0, 0, 0)
FG_DP = 108
FG_SIZES = {'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432}
LEGACY_SIZES = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}

ADAPTIVE_XML = """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/wa_launcher_bg"/>
    <foreground android:drawable="@mipmap/wa_launcher_fg"/>
    <monochrome android:drawable="@mipmap/wa_launcher_mono"/>
</adaptive-icon>
"""
COLORS_XML = """<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="wa_launcher_bg">#000000</color>
</resources>
"""


def load_logo(path):
    im = Image.open(path).convert('RGB')
    a = np.asarray(im).astype(np.float32)
    solid = a.sum(axis=2) > 150          # ignore the faint glow when measuring the shape
    ys, xs = np.nonzero(solid)
    cx, cy = (xs.min() + xs.max()) / 2.0, (ys.min() + ys.max()) / 2.0
    r = float(np.sqrt((xs - cx) ** 2 + (ys - cy) ** 2).max())
    return im, cx, cy, r


def place(src, cx, cy, r, size, fraction):
    """The emblem on a size x size black square, centred, farthest tip at fraction*size from the middle."""
    scale = fraction * size / r
    big = src.resize((max(1, round(src.width * scale)), max(1, round(src.height * scale))), Image.LANCZOS)
    canvas = Image.new('RGB', (size, size), BG)
    canvas.paste(big, (round(size / 2 - cx * scale), round(size / 2 - cy * scale)))
    return canvas


def to_rgba(rgb_img):
    """Un-premultiply from black: compositing the result over black reproduces the original exactly."""
    a = np.asarray(rgb_img).astype(np.float32)
    alpha = a.max(axis=2) / 255.0
    safe = np.maximum(alpha[..., None], 1e-3)
    rgb = np.clip(a / safe, 0, 255)
    rgb[alpha < 1e-3] = 0
    return Image.fromarray(np.dstack([rgb, alpha * 255]).astype(np.uint8), 'RGBA')


def to_mono(rgb_img):
    a = np.asarray(rgb_img).astype(np.float32).max(axis=2)
    out = np.zeros(a.shape + (4,), np.uint8)
    out[..., :3] = 255
    out[..., 3] = np.clip(a, 0, 255).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')


def circle(img):
    s = img.width
    mask = Image.new('L', (s * 4, s * 4), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, s * 4 - 1, s * 4 - 1), fill=255)
    mask = mask.resize((s, s), Image.LANCZOS)
    out = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    out.paste(img.convert('RGBA'), (0, 0), mask)
    return out


def write(path, img):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, 'PNG', optimize=True)


def main():
    argv = sys.argv[1:]
    preview = None
    if '--preview' in argv:
        i = argv.index('--preview')
        preview = argv[i + 1]
        del argv[i:i + 2]
    if not argv:
        sys.exit('usage: make-icons.py <android res dir> [logo.png] [--preview out.png]')
    res = argv[0]
    logo = argv[1] if len(argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'logo.png')
    if not os.path.isfile(logo):
        sys.exit('ICON ERROR: logo not found: ' + logo)
    src, cx, cy, r = load_logo(logo)

    # remove same-named .webp/.jpg icons that would clash with the PNGs written below
    for pat in ('ic_launcher.webp', 'ic_launcher_round.webp', 'ic_launcher.jpg', 'ic_launcher_round.jpg'):
        for p in glob.glob(os.path.join(res, 'mipmap-*', pat)):
            os.remove(p)

    for d, size in FG_SIZES.items():
        fg = place(src, cx, cy, r, size, SAFE_FRACTION)
        write(os.path.join(res, 'mipmap-' + d, 'wa_launcher_fg.png'), to_rgba(fg))
        write(os.path.join(res, 'mipmap-' + d, 'wa_launcher_mono.png'), to_mono(fg))
    for d, size in LEGACY_SIZES.items():
        sq = place(src, cx, cy, r, size, LEGACY_FRACTION)
        write(os.path.join(res, 'mipmap-' + d, 'ic_launcher.png'), sq)
        write(os.path.join(res, 'mipmap-' + d, 'ic_launcher_round.png'), circle(sq))
    for name in ('ic_launcher.xml', 'ic_launcher_round.xml'):
        p = os.path.join(res, 'mipmap-anydpi-v26', name)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        open(p, 'w', encoding='utf-8').write(ADAPTIVE_XML)
    p = os.path.join(res, 'values', 'wa_colors.xml')
    os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, 'w', encoding='utf-8').write(COLORS_XML)

    splashes = glob.glob(os.path.join(res, '**', 'splash.png'), recursive=True)
    for sp in splashes:
        w, h = Image.open(sp).size
        s = min(w, h)
        out = Image.new('RGB', (w, h), BG)
        out.paste(place(src, cx, cy, r, s, SPLASH_FRACTION), ((w - s) // 2, (h - s) // 2))
        out.save(sp, 'PNG', optimize=True)
    print('icons: adaptive + legacy launcher icons written; %d splash image(s) replaced' % len(splashes))

    if preview:
        S = 216
        tile = Image.new('RGB', (S * 4 + 50, S + 20), (58, 58, 62))
        fg = to_rgba(place(src, cx, cy, r, S, SAFE_FRACTION))
        base = Image.new('RGBA', (S, S), BG + (255,))
        base.alpha_composite(fg)
        sq = base.copy()
        masks = []
        m = Image.new('L', (S * 4, S * 4), 0)
        ImageDraw.Draw(m).rounded_rectangle((0, 0, S * 4 - 1, S * 4 - 1), radius=S * 4 * 0.3, fill=255)
        squircle = Image.new('RGBA', (S, S), (0, 0, 0, 0))
        squircle.paste(base, (0, 0), m.resize((S, S), Image.LANCZOS))
        tile.paste(circle(base), (10, 10), circle(base))
        tile.paste(squircle, (S + 20, 10), squircle)
        tile.paste(sq.convert('RGB'), (S * 2 + 30, 10))   # full 108dp canvas, to see the margins
        zone = sq.convert('RGB')
        ImageDraw.Draw(zone).ellipse((S / 2 - S * 0.305, S / 2 - S * 0.305, S / 2 + S * 0.305, S / 2 + S * 0.305), outline=(0, 200, 255))
        tile.paste(zone, (S * 3 + 40, 10))                # same canvas with the 66dp safe circle outlined
        tile.save(preview)
        print('preview written: ' + preview)


if __name__ == '__main__':
    main()
