# SPDX-License-Identifier: AGPL-3.0-or-later
"""
Every brand image the app ships, made from the owner's three source pictures -- #965.

    python3 apps/web/tools/brand/derive_brand.py            # write the outputs
    python3 apps/web/tools/brand/derive_brand.py --check    # write nothing; fail
                                                            # unless every committed
                                                            # output decodes to the
                                                            # pixels this makes

Run it with the interpreter of a virtual environment holding exactly the
packages `brand.json` pins (`pip install -r apps/web/tools/brand/requirements.txt`);
any other version is refused, because a different resampler makes different
bytes. Nothing in CI runs it: CI holds `ASSETS.toml` to `brand.json` instead
(`provenance.test.ts`), the shape `apps/web/tools/realistic/` has for Blender.

## The sources, and how each is cut

The owner made the art with Google Gemini (#965's comments of 2026-10-01).
Every source is a JPEG, so nothing in them is transparent and every output is
cut out:

- **The icon mark** -- the shield with the rider and the arrow on the blue
  panel of `gemini-assets-v3.jpeg`. The panel's background is one flat blue and
  the shield has a white rim, so the mark is the connected part of the panel
  that is not that blue. The panel's baked rounded corners and the light sheet
  around them are thrown away: every icon is drawn on the panel's own flat
  blue, so the only rounding is the one a launcher's mask applies.
- **The wordmark** -- "ON YOUR LEFT" from `gemini-assets-v2.jpeg`, whose
  "transparent" checkerboard Gemini painted into the pixels. The checkerboard
  is light (no channel below 197) and the letters are dark, so coverage is read
  from the darkest channel. The letters are set in one flat navy rather than
  the JPEG's mottled one; the arrow keeps its own colours.
- **The full logo** -- `gemini-logo-green.jpeg`: the shield, the rider, the
  arrow, the wordmark and the white sticker outline, and NO tagline (the owner's
  ruling of 2026-10-01), on a flat #00FF00 green screen. It is cut by the
  owner's chroma key (`chroma_key`), with the green spill taken out of its
  edges. The light-palette variant is laid on a soft navy shadow of its own
  outline, because its white sticker outline would otherwise vanish on the
  light palette's white canvas; the dark variant is the keyed logo alone.

## No model, and no download

Until the owner's green-screen logo (2026-10-01) the full logo was cut from
`gemini-assets-v3.jpeg` by a background-removal model (rembg's
`isnet-general-use`, fetched at run time and checked against a digest). A
chroma key is three lines of arithmetic and needs neither, so rembg,
onnxruntime and the model are gone from this pipeline: it reads only the
committed sources and fetches nothing.

## Determinism

Every step is integer or float arithmetic on NumPy arrays, SciPy's filters and
Pillow's resampler. PNGs are written with no metadata at a fixed compression
level; the full logo is written as LOSSLESS WebP (#972), with no metadata.

## What `--check` compares, and why it is not bytes -- #972

`--check` re-makes everything in memory and compares DECODED PIXELS: the
same format (the extension says which), the same mode, the same size, and the
same RGBA bytes. It compared the files' bytes until #972, and that was a
promise the pinned packages cannot keep: Pillow's wheels bundle their own
zlib, which on Linux (zlib-ng) compresses the very same pixels into different
bytes than on the Mac where the outputs were made. Measured on 2026-10-05 with
the pinned Python and packages on Linux: every one of the 23 outputs failed a
byte comparison, and every one decoded to exactly the pixels the script makes.
The pixels are the art and are what this script decides; the compressor's
bytes are not. `ASSET003` still pins the committed bytes, so a file cannot
change unseen -- what changes is that a contributor on another platform can
re-run `--check` and get an answer about the art. Both encoders here are
lossless, so a pixel comparison is the whole of what a byte comparison could
promise about the picture.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import sys
from importlib import metadata
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3].resolve()
TABLE = json.loads((HERE / "brand.json").read_text(encoding="utf-8"))


def refuse(message: str) -> None:
    raise SystemExit(f"derive_brand: {message}")


def inside_root(path: str) -> Path:
    """A brand.json path as a file in this repository, or a refusal.

    Every path the table names is read or written relative to the repository
    root, so a `..` or an absolute path in a committed table would reach a file
    outside it. Resolved before it is compared, so a symlink out is refused too.
    """
    target = (ROOT / path).resolve()
    if not target.is_relative_to(ROOT):
        refuse(f"{path} is not inside the repository")
    return target


def check_tools() -> None:
    """Refuse any interpreter or package other than the pinned ones."""
    python = f"{sys.version_info.major}.{sys.version_info.minor}"
    if python != TABLE["python"]:
        refuse(f"Python {TABLE['python']} is pinned, this is {python}")
    for name, pinned in TABLE["packages"].items():
        try:
            found = metadata.version(name)
        except metadata.PackageNotFoundError:
            refuse(f"{name} {pinned} is pinned and is not installed")
        if found != pinned:
            refuse(f"{name} {pinned} is pinned, this environment has {found}")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_source(path: str) -> bytes:
    for source in TABLE["sources"]:
        if source["path"] == path:
            data = inside_root(path).read_bytes()
            if sha256(data) != source["sha256"]:
                refuse(f"{path} is not the source brand.json records")
            return data
    refuse(f"{path} is not a source in brand.json")
    raise AssertionError  # unreachable


# --- The pieces ----------------------------------------------------------------

# The icon panel of gemini-assets-v3.jpeg, measured on the sheet: its flat blue
# runs from x = 1862 to 2634 and from y = 118 to 912. A few pixels in from each
# edge is clear of the baked rounded corner's antialiasing.
ICON_PANEL = (1862, 118, 2635, 913)
# How far a pixel may be from the panel's blue and still be background.
BLUE_TOLERANCE = 46.0
# The rounded corners' radius on the sheet, measured: about 60 px. A border
# band this wide is never part of the mark.
PANEL_EDGE = 70

# The bottom wordmark of gemini-assets-v2.jpeg, with a margin.
WORDMARK_BOX = (590, 1200, 2245, 1392)
# The checkerboard's darkest channel is never below 197; a letter's is below 60.
CHECKER_FLOOR = 196.0
INK_CEILING = 70.0

# The letters' one navy, and the dark palette's ink (`tokens.ts`
# DARK_COLOUR_TOKENS.ink), which the dark wordmark is set in. The logo keeps
# its navy letters in both palettes: they sit on its own white sticker.
NAVY = (17, 36, 64)
DARK_INK = (0xE4, 0xEB, 0xE9)
# Where a mark sits. A square icon carries the mark at the share of its side the
# owner's panel does (its widest extent about 0.78 of the panel). A maskable web
# icon keeps the mark inside the circle a launcher may crop to -- the middle 80 %
# (W3C Manifest, "icon masks") -- and an Android foreground inside the 66 dp
# circle of its 108 dp layer; both are held there by `provenance.test.ts`.
SQUARE_EXTENT = 0.78
MASKABLE_DIAGONAL = 0.76
FOREGROUND_DIAGONAL = 62.0 / 108.0


def as_float(image: Image.Image) -> np.ndarray:
    return np.asarray(image.convert("RGB"), dtype=np.float64)


def icon_mark(sheet: Image.Image) -> tuple[np.ndarray, tuple[int, int, int]]:
    """The mark as straight RGBA floats, and the panel's flat blue."""
    panel = as_float(sheet.crop(ICON_PANEL))
    height, width, _ = panel.shape
    inner = np.zeros((height, width), dtype=bool)
    inner[PANEL_EDGE:-PANEL_EDGE, PANEL_EDGE:-PANEL_EDGE] = True
    border = panel[~inner]
    blue = np.median(border, axis=0)
    distance = np.sqrt(((panel - blue) ** 2).sum(axis=2))
    background = distance < BLUE_TOLERANCE
    # The mark is the largest part of the panel that is not its blue. (Not
    # "the part at the centre": the centre is the rider's jersey, which is blue.)
    labels, count = ndimage.label(~background)
    if count == 0:
        refuse("the icon panel holds nothing but blue; the panel box is wrong")
    # The light sheet outside the rounded corners touches the panel's edge; the
    # mark does not.
    areas = ndimage.sum_labels(np.ones_like(labels), labels, index=np.arange(1, count + 1))
    edge = np.zeros((height, width), dtype=bool)
    edge[:2, :] = edge[-2:, :] = edge[:, :2] = edge[:, -2:] = True
    for touching in np.unique(labels[edge]):
        if touching > 0:
            areas[touching - 1] = 0
    largest = int(np.argmax(areas)) + 1
    mark = ndimage.binary_fill_holes(labels == largest)
    # Soft edge: the rim's own antialiasing already blends towards the blue, so
    # a one-pixel feather over a one-pixel dilation composites it cleanly.
    alpha = ndimage.gaussian_filter(ndimage.binary_dilation(mark).astype(np.float64), 0.8)
    alpha = np.clip(alpha * 1.6 - 0.3, 0.0, 1.0)
    alpha[mark] = 1.0
    rows = np.nonzero(alpha.max(axis=1) > 0)[0]
    cols = np.nonzero(alpha.max(axis=0) > 0)[0]
    top, bottom, left, right = rows[0], rows[-1] + 1, cols[0], cols[-1] + 1
    rgba = np.dstack([panel, alpha * 255.0])[top:bottom, left:right]
    return rgba, tuple(int(round(channel)) for channel in blue)  # type: ignore[return-value]


def to_image(rgba: np.ndarray) -> Image.Image:
    return Image.fromarray(np.clip(np.round(rgba), 0, 255).astype(np.uint8), "RGBA")


def placed(mark: np.ndarray, canvas: int, extent: float, by_diagonal: bool) -> Image.Image:
    """The mark centred on a transparent canvas, scaled to `extent` of its side."""
    height, width, _ = mark.shape
    span = float(np.hypot(width, height)) if by_diagonal else float(max(width, height))
    scale = extent * canvas / span
    size = (max(1, round(width * scale)), max(1, round(height * scale)))
    resized = to_image(mark).resize(size, Image.Resampling.LANCZOS)
    layer = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    layer.paste(resized, ((canvas - size[0]) // 2, (canvas - size[1]) // 2))
    return layer


# Everything is composed at this size and resized once, so every size of one
# kind is the same picture.
MASTER = 1024


def icon(kind: str, size: int, mark: np.ndarray, blue: tuple[int, int, int]) -> Image.Image:
    if kind == "foreground":
        layer = placed(mark, MASTER, FOREGROUND_DIAGONAL, by_diagonal=True)
        return layer.resize((size, size), Image.Resampling.LANCZOS)
    extent, diagonal = (SQUARE_EXTENT, False) if kind == "square" else (MASKABLE_DIAGONAL, True)
    ground = Image.new("RGBA", (MASTER, MASTER), (*blue, 255))
    ground.alpha_composite(placed(mark, MASTER, extent, diagonal))
    picture = ground.convert("RGB").resize((size, size), Image.Resampling.LANCZOS)
    if kind in ("square", "maskable"):
        return picture
    if kind == "round":
        # A legacy round launcher icon: the maskable picture inside a circle.
        scale = 4
        yy, xx = np.mgrid[0 : size * scale, 0 : size * scale]
        centre = (size * scale - 1) / 2.0
        inside = (xx - centre) ** 2 + (yy - centre) ** 2 <= (size * scale / 2.0) ** 2
        disc = Image.fromarray((inside * 255).astype(np.uint8), "L")
        disc = disc.resize((size, size), Image.Resampling.BOX)
        rounded = picture.convert("RGBA")
        rounded.putalpha(disc)
        return rounded
    refuse(f"unknown icon kind {kind}")
    raise AssertionError


def lettering(area: np.ndarray, ink: tuple[int, int, int]) -> np.ndarray:
    """Dark letters and a blue arrow on a light checkerboard, as straight RGBA."""
    darkest = area.min(axis=2)
    alpha = np.clip((CHECKER_FLOOR - darkest) / (CHECKER_FLOOR - INK_CEILING), 0.0, 1.0)
    # The colour under a partly covered pixel, with the checkerboard taken out.
    # The checkerboard is near-white, so it is taken as white.
    safe = np.maximum(alpha, 1e-6)[..., None]
    colour = np.clip((area - (1.0 - alpha[..., None]) * 255.0) / safe, 0.0, 255.0)
    # The arrow is blue (blue well above red); everything else is letter, which
    # is set in one flat colour so the JPEG's mottling does not ship.
    arrow = (area[..., 2] - area[..., 0]) > 70.0
    arrow = ndimage.binary_dilation(arrow, iterations=2) & (alpha > 0)
    letter = ~arrow
    colour[letter] = ink
    return np.dstack([colour, alpha * 255.0])


def trimmed(rgba: np.ndarray, margin: int = 2) -> np.ndarray:
    alpha = rgba[..., 3]
    rows = np.nonzero(alpha.max(axis=1) > 0)[0]
    cols = np.nonzero(alpha.max(axis=0) > 0)[0]
    top = max(0, rows[0] - margin)
    left = max(0, cols[0] - margin)
    return rgba[top : rows[-1] + 1 + margin, left : cols[-1] + 1 + margin]


def wordmark(sheet: Image.Image, ink: tuple[int, int, int], height: int) -> Image.Image:
    rgba = trimmed(lettering(as_float(sheet.crop(WORDMARK_BOX)), ink))
    picture = to_image(rgba)
    width = round(picture.width * height / picture.height)
    return picture.resize((width, height), Image.Resampling.LANCZOS)


# The full logo's green screen, and the key that takes it out -- the owner's
# key of 2026-10-01, written down exactly. `k` is how much greener than its
# other two channels a pixel is: about 255 on the screen, near nought on the
# art (whose greens are none: the palette is navy, blue, orange, grey and
# white). Below `KEY_FLOOR` a pixel is wholly the art's, above
# `KEY_FLOOR + KEY_RAMP` wholly the screen's, and linear between. The green the
# screen spills into the art's edges is then taken out by holding green to at
# most `DESPILL` above the larger of red and blue.
KEY_FLOOR = 60.0
KEY_RAMP = 90.0
DESPILL = 10.0

# The light palette's canvas is white (`tokens.ts` COLOUR_TOKENS.canvas), and so
# is the logo's sticker outline, which would vanish against it. The light
# variant is therefore laid on a soft shadow of its own outline, in the
# letters' navy, so the sticker's edge reads; the dark variant needs none --
# the white outline is the edge, on a near-black canvas. Measured at the
# keyed logo's own size (about 1 900 px across), before it is resized.
SHADOW_SIGMA = 9.0
SHADOW_OPACITY = 0.45
SHADOW_PAD = 36


def chroma_key(screen: np.ndarray) -> np.ndarray:
    """The logo off its green screen, as straight RGBA floats, cropped to what it covers."""
    red, green, blue = screen[..., 0], screen[..., 1], screen[..., 2]
    others = np.maximum(red, blue)
    k = green - others
    alpha = np.clip(1.0 - (k - KEY_FLOOR) / KEY_RAMP, 0.0, 1.0)
    colour = screen.copy()
    colour[..., 1] = np.minimum(green, others + DESPILL)
    rows = np.nonzero(alpha.max(axis=1) > 0)[0]
    cols = np.nonzero(alpha.max(axis=0) > 0)[0]
    if len(rows) == 0:
        refuse("the logo's sheet is nothing but green screen")
    top, bottom, left, right = rows[0], rows[-1] + 1, cols[0], cols[-1] + 1
    return np.dstack([colour, alpha * 255.0])[top:bottom, left:right]


def shadowed(rgba: np.ndarray) -> np.ndarray:
    """`rgba` over a soft navy shadow of its own outline, on a padded canvas."""
    pad = SHADOW_PAD
    height, width, _ = rgba.shape
    canvas = np.zeros((height + 2 * pad, width + 2 * pad, 4), dtype=np.float64)
    canvas[pad : pad + height, pad : pad + width] = rgba
    under = ndimage.gaussian_filter(canvas[..., 3] / 255.0, SHADOW_SIGMA) * SHADOW_OPACITY
    over = canvas[..., 3] / 255.0
    out_alpha = over + under * (1.0 - over)
    safe = np.maximum(out_alpha, 1e-9)[..., None]
    navy = np.array(NAVY, dtype=np.float64)
    out_colour = (canvas[..., :3] * over[..., None] + navy * (under * (1.0 - over))[..., None]) / safe
    return np.dstack([out_colour, out_alpha * 255.0])


def logo(sheet: Image.Image, kind: str, width: int) -> Image.Image:
    rgba = chroma_key(as_float(sheet))
    if kind == "logo-light":
        rgba = shadowed(rgba)
    elif kind != "logo-dark":
        refuse(f"unknown logo kind {kind}")
    picture = to_image(rgba)
    height = round(picture.height * width / picture.width)
    return picture.resize((width, height), Image.Resampling.LANCZOS)


def png(picture: Image.Image) -> bytes:
    out = io.BytesIO()
    picture.save(out, format="PNG", optimize=False, compress_level=9)
    return out.getvalue()


def webp(picture: Image.Image) -> bytes:
    """Lossless WebP -- #972. `exact` keeps the colour of a fully transparent
    pixel, so the file decodes to exactly the RGBA the pipeline made; quality
    100 and method 6 are libwebp's slowest, smallest lossless setting."""
    out = io.BytesIO()
    picture.save(out, format="WEBP", lossless=True, quality=100, method=6, exact=True)
    return out.getvalue()


def encode(path: str, picture: Image.Image) -> bytes:
    if path.endswith(".png"):
        return png(picture)
    if path.endswith(".webp"):
        return webp(picture)
    refuse(f"{path} is neither a .png nor a .webp")
    raise AssertionError  # unreachable


FORMATS = {".png": "PNG", ".webp": "WEBP"}


def same_pixels(path: str, made: bytes, committed: bytes) -> bool:
    """Whether the committed file is the picture this script makes, decoded."""
    expected = FORMATS[Path(path).suffix]
    a = Image.open(io.BytesIO(made))
    b = Image.open(io.BytesIO(committed))
    if a.format != expected or b.format != expected:
        return False
    a.load()
    b.load()
    return a.mode == b.mode and a.size == b.size and a.tobytes() == b.tobytes()


def derive() -> dict[str, bytes]:
    sheets = {
        source["path"]: Image.open(io.BytesIO(read_source(source["path"]))).convert("RGB")
        for source in TABLE["sources"]
    }
    families = TABLE["families"]
    mark, blue = icon_mark(sheets[families["icon"]["source"]])
    made: dict[str, bytes] = {}
    for output in TABLE["outputs"]:
        family, kind, size = output["family"], output["kind"], output["size"]
        sheet = sheets[families[family]["source"]]
        if family == "icon":
            picture = icon(kind, size, mark, blue)
        elif family == "wordmark":
            picture = wordmark(sheet, NAVY if kind == "wordmark-light" else DARK_INK, size)
        elif family == "logo":
            picture = logo(sheet, kind, size)
        else:
            refuse(f"unknown family {family}")
        made[output["path"]] = encode(output["path"], picture)
    return made


def records() -> str:
    """The `ASSETS.toml` entries for the sources and the committed outputs.

    `provenance.test.ts` holds the manifest to exactly these, so this is a
    convenience for pasting, not a second source of truth.
    """
    entries = []
    common = (
        f'licence = "CC-BY-4.0"\nread = "{TABLE["read"]}"\n'
    )
    for source in TABLE["sources"]:
        entries.append(
            "[[asset]]\n"
            f'path = "{source["path"]}"\n'
            f'source = "The owner\'s brand art (#965), {source["what"]}; generated with Google Gemini, whose terms claim no ownership of what it generates"\n'
            + common
            + f'sha256 = "{source["sha256"]}"\n'
            f'creator = "{TABLE["creator"]}"\n'
            f'url = "{TABLE["url"]}"\n'
            'modified = "no"\n'
        )
    for output in TABLE["outputs"]:
        family = TABLE["families"][output["family"]]
        source = next(s for s in TABLE["sources"] if s["path"] == family["source"])
        digest = sha256(inside_root(output["path"]).read_bytes())
        entries.append(
            "[[asset]]\n"
            f'path = "{output["path"]}"\n'
            f'source = "The owner\'s brand art (#965), generated with Google Gemini; made from {family["source"]} by apps/web/tools/brand/derive_brand.py"\n'
            + common
            + f'sha256 = "{digest}"\n'
            f'creator = "{TABLE["creator"]}"\n'
            f'url = "{TABLE["url"]}"\n'
            f'modified = "{family["modified"]}"\n'
            f'input = "{family["source"]}"\n'
            f'inputsha256 = "{source["sha256"]}"\n'
            'script = "apps/web/tools/brand/derive_brand.py"\n'
            f'tool = "{TABLE["tool"]}"\n'
        )
    return "\n".join(entries)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="write nothing; compare bytes")
    parser.add_argument("--records", action="store_true", help="print the ASSETS.toml entries")
    arguments = parser.parse_args()
    if arguments.records:
        print(records())
        return
    check_tools()
    made = derive()
    if arguments.check:
        differ = [
            path
            for path, data in made.items()
            if not inside_root(path).exists()
            or not same_pixels(path, data, inside_root(path).read_bytes())
        ]
        for path in differ:
            print(f"derive_brand: {path} is not the picture this script makes", file=sys.stderr)
        if differ:
            raise SystemExit(1)
        print(f"derive_brand: all {len(made)} outputs decode to the pixels this script makes")
        return
    for path, data in made.items():
        target = inside_root(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        print(f"{sha256(data)}  {path}")


if __name__ == "__main__":
    main()
