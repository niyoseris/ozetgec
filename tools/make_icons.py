#!/usr/bin/env python3
"""Özetgeç ikonları: koyu yeşil zemin üzerinde krem bir "ö" işareti.

Kullanım: python3 tools/make_icons.py
Çıktı:    icons/icon16.png, icon32.png, icon48.png, icon128.png
"""

from __future__ import annotations

import os

from PIL import Image, ImageDraw

SIZES = (16, 32, 48, 128)
SUPERSAMPLE = 4
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "icons")

BG_TOP = (42, 84, 58)
BG_BOTTOM = (19, 42, 29)
CREAM = (246, 239, 221)
DOT = (178, 214, 150)


def vertical_gradient(size: int, top, bottom) -> Image.Image:
    gradient = Image.new("RGB", (1, size))
    for y in range(size):
        t = y / max(1, size - 1)
        gradient.putpixel((0, y), tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return gradient.resize((size, size), Image.NEAREST)


def render(size: int) -> Image.Image:
    work = size * SUPERSAMPLE
    canvas = Image.new("RGBA", (work, work), (0, 0, 0, 0))

    mask = Image.new("L", (work, work), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, work - 1, work - 1), radius=int(work * 0.23), fill=255
    )
    canvas.paste(vertical_gradient(work, BG_TOP, BG_BOTTOM), (0, 0), mask)

    draw = ImageDraw.Draw(canvas)
    cx = work / 2
    cy = work * 0.585
    outer = work * 0.255
    thickness = work * 0.082

    draw.ellipse(
        (cx - outer, cy - outer, cx + outer, cy + outer),
        outline=CREAM,
        width=max(1, int(thickness)),
    )

    dot_r = work * 0.042
    for dx in (-work * 0.083, work * 0.083):
        draw.ellipse(
            (cx + dx - dot_r, work * 0.285 - dot_r, cx + dx + dot_r, work * 0.285 + dot_r),
            fill=DOT,
        )

    return canvas.resize((size, size), Image.LANCZOS)


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in SIZES:
        path = os.path.join(OUT_DIR, f"icon{size}.png")
        render(size).save(path, "PNG", optimize=True)
        print(f"yazıldı: {path}")


if __name__ == "__main__":
    main()
