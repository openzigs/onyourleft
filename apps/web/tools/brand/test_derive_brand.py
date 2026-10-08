# SPDX-License-Identifier: AGPL-3.0-or-later
"""
What `derive_brand.py --check` compares -- #1167.

    python3 -m unittest discover -s apps/web/tools/brand -p 'test_*.py'

Run with the interpreter of the pinned environment `derive_brand.py` names
(`requirements.txt`). Nothing in CI runs it, for the reason nothing in CI runs
`derive_brand.py`: CI has no Python with Pillow.

The owner's ruling of 2026-10-07: a WebP logo is compared by its BYTES, and a
PNG by its decoded pixels with no rendering metadata (`iCCP`, `gAMA`, `sRGB`,
`eXIf` and the rest) in the made file or the committed one.
"""

from __future__ import annotations

import io
import sys
import unittest
import zlib
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import derive_brand  # noqa: E402

LOGO = "apps/web/src/brand/logo-dark.webp"
WORDMARK = "apps/web/src/brand/wordmark-light.png"


def picture() -> Image.Image:
    """A small RGBA picture with every channel varying."""
    image = Image.new("RGBA", (23, 17))
    image.putdata(
        [((x * 11) % 256, (y * 13) % 256, (x * y) % 256, (x + y) * 6 % 256) for y in range(17) for x in range(23)]
    )
    return image


def chunk(kind: bytes, body: bytes) -> bytes:
    return len(body).to_bytes(4, "big") + kind + body + zlib.crc32(kind + body).to_bytes(4, "big")


def with_chunk(png: bytes, kind: bytes, body: bytes) -> bytes:
    """`png` with one chunk put straight after its IHDR, as an editor would."""
    after_header = len(derive_brand.PNG_SIGNATURE) + 8 + 13 + 4
    return png[:after_header] + chunk(kind, body) + png[after_header:]


def pixels(data: bytes) -> bytes:
    image = Image.open(io.BytesIO(data))
    return image.convert("RGBA").tobytes()


# A chunk body for each kind the ruling names, and the two newer colour chunks.
METADATA = {
    b"iCCP": b"sRGB\x00\x00" + zlib.compress(b"\x00" * 128),
    b"gAMA": (45455).to_bytes(4, "big"),
    b"sRGB": b"\x00",
    b"cHRM": b"\x00" * 32,
    b"cICP": b"\x01\x0d\x00\x01",
    b"eXIf": b"II*\x00\x08\x00\x00\x00\x00\x00\x00\x00\x00\x00",
}


# The article each chunk's name takes in the message (#1178's review: "a eXIf").
ARTICLES = {b"iCCP": "an", b"gAMA": "a", b"sRGB": "a", b"cHRM": "a", b"cICP": "a", b"eXIf": "an"}


def with_corrupt_idat(png: bytes) -> bytes:
    """`png` with one byte inside its first IDAT's data flipped and the CRC made
    right again: the chunk framing reads cleanly and only the decoder can tell."""
    offset = len(derive_brand.PNG_SIGNATURE)
    while png[offset + 4 : offset + 8] != b"IDAT":
        offset += 12 + int.from_bytes(png[offset : offset + 4], "big")
    length = int.from_bytes(png[offset : offset + 4], "big")
    body = bytearray(png[offset + 8 : offset + 8 + length])
    body[length // 2] ^= 0xFF
    return png[:offset] + chunk(b"IDAT", bytes(body)) + png[offset + 12 + length :]


class WebpIsComparedByBytes(unittest.TestCase):
    def test_the_same_bytes_pass(self) -> None:
        made = derive_brand.webp(picture())
        self.assertIsNone(derive_brand.why_not_made(LOGO, made, made))

    def test_other_bytes_fail_even_with_the_same_pixels(self) -> None:
        made = derive_brand.webp(picture())
        # The same picture, the same pixels, encoded with libwebp's fastest
        # method: what a different libwebp might write for the same art.
        out = io.BytesIO()
        picture().save(out, format="WEBP", lossless=True, quality=0, method=0, exact=True)
        other = out.getvalue()
        self.assertNotEqual(made, other)
        self.assertEqual(pixels(made), pixels(other))
        reason = derive_brand.why_not_made(LOGO, made, other)
        self.assertIsNotNone(reason)
        self.assertIn("bytes", reason or "")

    def test_one_changed_byte_fails(self) -> None:
        made = derive_brand.webp(picture())
        # An EXIF chunk round a picture whose pixels do not change, then one
        # byte of it changed: the pixels are still the same.
        out = io.BytesIO()
        picture().save(
            out, format="WEBP", lossless=True, quality=100, method=6, exact=True, exif=b"Exif\x00\x00II*\x00"
        )
        one = bytearray(out.getvalue())
        one[-1] ^= 0xFF
        self.assertEqual(pixels(bytes(one)), pixels(made))
        self.assertIsNotNone(derive_brand.why_not_made(LOGO, out.getvalue(), bytes(one)))


class PngIsComparedByPixelsAndCarriesNoMetadata(unittest.TestCase):
    def setUp(self) -> None:
        self.made = derive_brand.png(picture())

    def test_what_this_script_writes_carries_no_metadata(self) -> None:
        self.assertIsNone(derive_brand.png_metadata(self.made))
        self.assertIsNone(derive_brand.why_not_made(WORDMARK, self.made, self.made))

    def test_other_bytes_with_the_same_pixels_pass(self) -> None:
        # Another zlib's bytes for the same pixels: what Linux writes.
        out = io.BytesIO()
        picture().save(out, format="PNG", compress_level=1)
        other = out.getvalue()
        self.assertNotEqual(self.made, other)
        self.assertIsNone(derive_brand.why_not_made(WORDMARK, self.made, other))

    def test_other_pixels_fail(self) -> None:
        changed = picture()
        changed.putpixel((5, 5), (1, 2, 3, 4))
        reason = derive_brand.why_not_made(WORDMARK, self.made, derive_brand.png(changed))
        self.assertEqual(reason, "it does not decode to the pixels this script makes")

    def test_rendering_metadata_in_the_committed_file_fails_by_name(self) -> None:
        for kind, body in METADATA.items():
            with self.subTest(chunk=kind):
                committed = with_chunk(self.made, kind, body)
                # The control: the pixels are untouched, so only the chunk can
                # be what fails it.
                self.assertEqual(pixels(committed), pixels(self.made))
                reason = derive_brand.why_not_made(WORDMARK, self.made, committed)
                self.assertIsNotNone(reason)
                self.assertIn("the committed file", reason or "")
                self.assertIn(f"{ARTICLES[kind]} {kind.decode()} chunk", reason or "")

    def test_rendering_metadata_in_the_made_file_fails_by_name(self) -> None:
        made = with_chunk(self.made, b"iCCP", METADATA[b"iCCP"])
        reason = derive_brand.why_not_made(WORDMARK, made, self.made)
        self.assertIsNotNone(reason)
        self.assertIn("the file this script makes", reason or "")
        self.assertIn("iCCP", reason or "")

    def test_a_chunk_nobody_listed_is_refused_too(self) -> None:
        committed = with_chunk(self.made, b"tEXt", b"Raw profile type exif\x00ff")
        self.assertIn("a tEXt chunk", derive_brand.why_not_made(WORDMARK, self.made, committed) or "")

    def test_a_truncated_png_is_refused_in_words(self) -> None:
        self.assertEqual(
            derive_brand.why_not_made(WORDMARK, self.made, self.made[:-3]),
            "the committed file is not a readable PNG: a chunk runs past the end of the file",
        )

    def test_a_file_that_is_not_a_png_is_refused_in_words(self) -> None:
        self.assertEqual(
            derive_brand.why_not_made(WORDMARK, b"GIF89a" + self.made[6:], self.made),
            "the file this script makes is not a readable PNG: it does not begin with the PNG signature",
        )

    def test_a_chunk_takes_its_article(self) -> None:
        for kind, body in METADATA.items():
            with self.subTest(chunk=kind):
                self.assertEqual(
                    derive_brand.png_metadata(with_chunk(self.made, kind, body)),
                    f"{ARTICLES[kind]} {kind.decode()} chunk ({derive_brand.RENDERING_CHUNKS[kind]})",
                )

    def test_a_corrupt_data_stream_is_a_reason_not_a_traceback(self) -> None:
        broken = with_corrupt_idat(self.made)
        # The control: the framing reads, so only the decoder can find it.
        self.assertIsNone(derive_brand.png_metadata(broken))
        for made, committed, which in (
            (self.made, broken, "the committed file"),
            (broken, self.made, "the file this script makes"),
        ):
            with self.subTest(which=which):
                reason = derive_brand.why_not_made(WORDMARK, made, committed)
                self.assertIsNotNone(reason)
                self.assertTrue((reason or "").startswith(f"{which} does not decode ("), reason)


class TheCommittedOutputsPass(unittest.TestCase):
    """Every committed PNG output carries no rendering metadata today."""

    def test_no_committed_png_carries_metadata(self) -> None:
        for output in derive_brand.TABLE["outputs"]:
            if output["path"].endswith(".png"):
                with self.subTest(path=output["path"]):
                    data = derive_brand.inside_root(output["path"]).read_bytes()
                    self.assertIsNone(derive_brand.png_metadata(data))


if __name__ == "__main__":
    unittest.main()
