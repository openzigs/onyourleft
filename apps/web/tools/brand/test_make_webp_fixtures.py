# SPDX-License-Identifier: AGPL-3.0-or-later
"""
What `make_webp_fixtures.py --check` reads of a lossy fixture -- #1167, #1178.

    python3 -m unittest discover -s apps/web/tools/brand -p 'test_*.py'

For the two lossy fixtures `--check` compares the chunk layout rather than the
bytes, so `chunk_types` has to refuse a file that only LOOKS like the layout:
another RIFF form, a RIFF size that is not the file's, stray bytes after the
last chunk, or a chunk whose length runs past the end. Run with the pinned
environment, as `test_derive_brand.py` is.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import make_webp_fixtures  # noqa: E402

LOSSY = Path(__file__).resolve().parent / "fixtures" / "lossy.webp"


def resized(data: bytes) -> bytes:
    """`data` with its RIFF size made the file's again."""
    return data[:4] + (len(data) - 8).to_bytes(4, "little") + data[8:]


class ChunkTypes(unittest.TestCase):
    def setUp(self) -> None:
        self.data = LOSSY.read_bytes()

    def test_reads_the_committed_fixture(self) -> None:
        self.assertEqual(make_webp_fixtures.chunk_types(self.data), [b"VP8 "])

    def test_refuses_another_riff_form(self) -> None:
        with self.assertRaisesRegex(ValueError, "not a WebP"):
            make_webp_fixtures.chunk_types(self.data[:8] + b"AVI " + self.data[12:])

    def test_refuses_a_riff_size_that_is_not_the_files(self) -> None:
        with self.assertRaisesRegex(ValueError, "RIFF size"):
            make_webp_fixtures.chunk_types(self.data + b"\x00\x00")

    def test_refuses_stray_bytes_after_the_last_chunk(self) -> None:
        # The RIFF size made right, so only the stray bytes are wrong.
        with self.assertRaisesRegex(ValueError, "stray bytes"):
            make_webp_fixtures.chunk_types(resized(self.data + b"\x00\x00"))

    def test_refuses_a_chunk_that_runs_past_the_end(self) -> None:
        length = int.from_bytes(self.data[16:20], "little")
        longer = self.data[:16] + (length + 64).to_bytes(4, "little") + self.data[20:]
        with self.assertRaisesRegex(ValueError, "past the end"):
            make_webp_fixtures.chunk_types(longer)

    def test_check_reads_a_broken_lossy_fixture_as_different_not_a_traceback(self) -> None:
        self.assertTrue(make_webp_fixtures.same("x/lossy.webp", self.data, self.data))
        self.assertFalse(make_webp_fixtures.same("x/lossy.webp", self.data, self.data + b"\x00\x00"))


if __name__ == "__main__":
    unittest.main()
