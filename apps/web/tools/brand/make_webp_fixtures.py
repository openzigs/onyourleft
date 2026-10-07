# SPDX-License-Identifier: AGPL-3.0-or-later
"""
The lossless WebP reader's own fixtures -- #1167.

    python3 apps/web/tools/brand/make_webp_fixtures.py           # write them
    python3 apps/web/tools/brand/make_webp_fixtures.py --check   # write nothing; fail
                                                                 # unless every committed
                                                                 # fixture is these bytes

`webp-testing.test.ts` held `webp-testing.ts` to Pillow over the two logos
alone, and they reach only some of the reader: neither carries a colour
palette, a subtract-green transform, a one-symbol prefix code or a chunk
before its picture. These pictures are drawn from arithmetic -- nothing is
read or downloaded -- and written by Pillow 12.3.0's lossless encoder
(libwebp 1.6.0), the same pinned environment `derive_brand.py` refuses to run
without. `--digests` prints, for each, the SHA-256 of the RGBA bytes Pillow
decodes it to, which is what `webp-testing.test.ts` records: re-take them with
Pillow, never from the reader under test.

Lossless WebP from this libwebp is byte-identical on macOS and Linux (#1167),
so `--check` compares a lossless fixture's bytes. The two LOSSY fixtures exist
only to be refused, and libwebp's lossy encoder makes no promise of the same
bytes on another CPU, so for them `--check` compares the chunk layout -- the
thing the reader's refusal reads -- rather than the bytes.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from derive_brand import check_tools, inside_root  # noqa: E402

FIXTURES = "apps/web/tools/brand/fixtures"


def palette(colours: int, width: int, height: int, alpha: bool) -> Image.Image:
    """`colours` flat colours scattered by a seeded draw, which no predictor
    guesses, so libwebp's smallest encoding is the colour-indexing one."""
    index = np.random.default_rng(colours).integers(0, colours, (height, width))
    table = np.array(
        [((37 * i) % 256, (101 * i + 40) % 256, (59 * i + 200) % 256, 255) for i in range(colours)],
        dtype=np.uint8,
    )
    if alpha:
        table[:, 3] = np.linspace(0, 255, colours).astype(np.uint8)
    return Image.fromarray(table[index], "RGBA")


def gradient(width: int, height: int) -> Image.Image:
    """Smooth colour with a little seeded noise: what predictors, the cross-colour
    transform and subtract-green are for."""
    rng = np.random.default_rng(1167)
    yy, xx = np.mgrid[0:height, 0:width].astype(np.float64)
    # One noise shared by the three channels, so green predicts red and blue.
    shared = rng.integers(0, 40, (height, width))
    red = 40 + 150 * xx / width + shared + rng.integers(0, 3, (height, width))
    green = 60 + 120 * yy / height + shared
    blue = 90 + 60 * (xx + yy) / (width + height) + shared + rng.integers(0, 3, (height, width))
    alpha = 255 - 200 * (xx / width) * (yy / height)
    rgba = np.dstack([red, green, blue, alpha])
    return Image.fromarray(np.clip(np.round(rgba), 0, 255).astype(np.uint8), "RGBA")


def chunk_types(data: bytes) -> list[bytes]:
    """The RIFF chunk types of a WebP file, in order, or a ValueError for a file
    that is not a `RIFF`/`WEBP` form, whose RIFF size is not the file's, or whose
    last chunk does not end exactly at the end (#1178's review)."""
    if len(data) < 12 or data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        raise ValueError("not a WebP")
    if int.from_bytes(data[4:8], "little") != len(data) - 8:
        raise ValueError("the RIFF size is not the file's")
    types, offset = [], 12
    while offset < len(data):
        if offset + 8 > len(data):
            raise ValueError("stray bytes after the last chunk")
        length = int.from_bytes(data[offset + 4 : offset + 8], "little")
        types.append(data[offset : offset + 4])
        offset += 8 + length + (length & 1)
    if offset != len(data):
        raise ValueError("a chunk runs past the end of the file")
    return types


def same(path: str, made: bytes, committed: bytes) -> bool:
    if "lossy" in Path(path).name:
        try:
            return chunk_types(made) == chunk_types(committed)
        except ValueError:
            return False
    return made == committed


def encode(picture: Image.Image, **extra: object) -> bytes:
    out = io.BytesIO()
    picture.save(out, format="WEBP", lossless=True, quality=100, method=6, exact=True, **extra)
    return out.getvalue()


def lossy(picture: Image.Image) -> bytes:
    out = io.BytesIO()
    picture.save(out, format="WEBP", lossless=False, quality=80, method=6)
    return out.getvalue()


# A minimal EXIF block (an empty little-endian TIFF directory). It puts a VP8X
# header and an EXIF chunk around the picture, which the reader must step over.
EMPTY_EXIF = b"Exif\x00\x00II*\x00\x08\x00\x00\x00\x00\x00\x00\x00\x00\x00"


def fixtures() -> dict[str, bytes]:
    return {
        f"{FIXTURES}/one-pixel.webp": encode(Image.new("RGBA", (1, 1), (200, 30, 90, 128))),
        f"{FIXTURES}/two-colours.webp": encode(palette(2, 37, 23, alpha=False)),
        f"{FIXTURES}/four-colours.webp": encode(palette(4, 29, 17, alpha=False)),
        f"{FIXTURES}/sixteen-colours-alpha.webp": encode(palette(16, 31, 19, alpha=True)),
        f"{FIXTURES}/many-colours.webp": encode(palette(200, 41, 27, alpha=False)),
        f"{FIXTURES}/gradient.webp": encode(gradient(67, 45)),
        f"{FIXTURES}/with-exif.webp": encode(palette(3, 9, 7, alpha=False), exif=EMPTY_EXIF),
        # Two LOSSY pictures the reader must refuse rather than misread: a bare
        # `VP8 ` chunk, and a `VP8X` header, an `ALPH` chunk and a `VP8 ` chunk.
        f"{FIXTURES}/lossy.webp": lossy(gradient(16, 12).convert("RGB")),
        f"{FIXTURES}/lossy-alpha.webp": lossy(gradient(16, 12)),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="write nothing; compare with what is committed")
    parser.add_argument("--digests", action="store_true", help="print Pillow's RGBA digests")
    arguments = parser.parse_args()
    check_tools()
    made = fixtures()
    if arguments.digests:
        for path in (p for p in made if "lossy" not in p):
            picture = Image.open(inside_root(path))
            rgba = picture.convert("RGBA").tobytes()
            print(f"{path} {picture.width}x{picture.height} {hashlib.sha256(rgba).hexdigest()}")
        return
    if arguments.check:
        differ = [
            path
            for path, data in made.items()
            if not inside_root(path).exists() or not same(path, data, inside_root(path).read_bytes())
        ]
        for path in differ:
            print(f"make_webp_fixtures: {path} is not what this script makes", file=sys.stderr)
        if differ:
            raise SystemExit(1)
        print(f"make_webp_fixtures: all {len(made)} fixtures are what this script makes")
        return
    for path, data in made.items():
        target = inside_root(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        print(f"{hashlib.sha256(data).hexdigest()}  {path}")


if __name__ == "__main__":
    main()
