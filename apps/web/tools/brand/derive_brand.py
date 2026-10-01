# SPDX-License-Identifier: AGPL-3.0-or-later
"""
Every brand image the app ships, made from the owner's two source sheets -- #965.

    python3 apps/web/tools/brand/derive_brand.py            # write the outputs
    python3 apps/web/tools/brand/derive_brand.py --check    # write nothing; fail
                                                            # unless every committed
                                                            # output is reproduced
                                                            # byte for byte

Run it with the interpreter of a virtual environment holding exactly the
packages `brand.json` pins (`pip install -r apps/web/tools/brand/requirements.txt`);
any other version is refused, because a different resampler or a different
inference runtime makes different bytes. Nothing in CI runs it: CI holds
`ASSETS.toml` to `brand.json` instead (`provenance.test.ts`), the shape
`apps/web/tools/realistic/` has for Blender.

## The sources, and why they are cut rather than used

The owner made the art with Google Gemini (#965's comment of 2026-10-01). Both
sheets are JPEGs, and Gemini PAINTED the "transparent" checkerboard into their
pixels, so nothing in them is transparent. Every output is therefore cut out:

- **The icon mark** -- the shield with the rider and the arrow on the blue
  panel of `gemini-assets-v3.jpeg`. The panel's background is one flat blue and
  the shield has a white rim, so the mark is the connected part of the panel
  that is not that blue. The panel's baked rounded corners and the light sheet
  around them are thrown away: every icon is drawn on the panel's own flat
  blue, so the only rounding is the one a launcher's mask applies.
- **The wordmark** -- "ON YOUR LEFT" from `gemini-assets-v2.jpeg`. The
  checkerboard is light (no channel below 197) and the letters are dark, so
  coverage is read from the darkest channel. The letters are set in one flat
  navy rather than the JPEG's mottled one; the arrow keeps its own colours.
- **The full logo** -- from `gemini-assets-v3.jpeg`. Its checker squares are
  the same white as its sticker rim and the inside of its shield, so colour
  cannot cut it: the emblem is cut by the `isnet-general-use` background-removal
  model (through rembg), whose mask drops the shield's white fill, so the
  mask's holes are filled back as one flat white. The wordmark and the tagline
  under it are cut by colour, as above.

## Determinism

Every step is integer or float arithmetic on NumPy arrays, Pillow's resampler,
and one ONNX inference on ONE thread (a thread pool may sum in another order).
PNGs are written with no metadata at a fixed compression level. `--check`
re-makes everything in memory and compares bytes.

## The model is fetched here and never at run time

`brand.json` names its URL and SHA-256. It is downloaded into
`apps/web/tools/brand/build/` (ignored) the first time, checked against the
digest every time, and is a TOOL: nothing the app ships contains or fetches it.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import sys
import urllib.request
from importlib import metadata
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
BUILD = HERE / "build"
TABLE = json.loads((HERE / "brand.json").read_text(encoding="utf-8"))


def refuse(message: str) -> None:
    raise SystemExit(f"derive_brand: {message}")


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
            data = (ROOT / path).read_bytes()
            if sha256(data) != source["sha256"]:
                refuse(f"{path} is not the source brand.json records")
            return data
    refuse(f"{path} is not a source in brand.json")
    raise AssertionError  # unreachable


def model_path() -> Path:
    model = TABLE["model"]
    path = BUILD / f"{model['name']}.onnx"
    if not path.exists():
        BUILD.mkdir(parents=True, exist_ok=True)
        print(f"derive_brand: fetching {model['url']}", file=sys.stderr)
        with urllib.request.urlopen(model["url"]) as response:
            data = response.read()
        if sha256(data) != model["sha256"]:
            refuse(f"{model['url']} did not match the digest brand.json records")
        path.write_bytes(data)
    if sha256(path.read_bytes()) != model["sha256"]:
        refuse(f"{path} is not the model brand.json records; delete it and run again")
    return path


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
# The full logo of gemini-assets-v3.jpeg: the emblem above, the words below.
LOGO_EMBLEM_BOX = (300, 100, 1220, 850)
LOGO_WORDS_BOX = (230, 850, 1380, 1070)

# The checkerboard's darkest channel is never below 197; a letter's is below 60.
CHECKER_FLOOR = 196.0
INK_CEILING = 70.0

# The letters' one navy, and the dark palette's ink (`tokens.ts`
# DARK_COLOUR_TOKENS.ink), which the dark variants are set in.
NAVY = (17, 36, 64)
DARK_INK = (0xE4, 0xEB, 0xE9)
# The shield's fill where the model's mask dropped it.
SHIELD_WHITE = (255, 255, 255)
# The model's coverage above which a pixel is the emblem's for the purpose of
# finding what the shield's rim encloses; how far in from that outline the
# coverage is taken as whole; and how light, and how colourless, a pixel inside
# must be to be white.
EMBLEM_FLOOR = 0.1
EMBLEM_EDGE = 3
WHITE_FLOOR = 188.0
GREY_CHROMA = 24.0

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


class LocalModel:
    """rembg's isnet-general-use session over the digest-checked model, on one thread."""

    def __init__(self) -> None:
        import onnxruntime as ort
        from rembg.sessions.dis_general_use import DisSession

        path = model_path()

        class Pinned(DisSession):
            @classmethod
            def download_models(cls, *args, **kwargs):
                return str(path)

        options = ort.SessionOptions()
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1
        options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        self.session = Pinned("isnet-general-use", options, providers=["CPUExecutionProvider"])

    def mask(self, picture: Image.Image) -> np.ndarray:
        return np.asarray(self.session.predict(picture)[0], dtype=np.float64) / 255.0


def logo(sheet: Image.Image, ink: tuple[int, int, int], width: int, model: LocalModel) -> Image.Image:
    left, top, right, bottom = LOGO_EMBLEM_BOX
    emblem_area = sheet.crop(LOGO_EMBLEM_BOX)
    coverage = model.mask(emblem_area)
    # The model keeps the rider, the arrow and the shield's rim and leaves the
    # white inside the shield half covered or not at all. Everything the rim
    # encloses is the emblem: fully covered, and where it is near-white, one
    # flat white rather than the JPEG's speckle.
    enclosed = ndimage.binary_fill_holes(coverage > EMBLEM_FLOOR)
    inside = ndimage.binary_erosion(enclosed, iterations=EMBLEM_EDGE)
    colour = as_float(emblem_area)
    # The checkerboard shows through inside the front wheel, so a light grey
    # with no colour in it is white here too.
    chroma = colour.max(axis=2) - colour.min(axis=2)
    whitish = inside & (colour.min(axis=2) > WHITE_FLOOR) & (chroma < GREY_CHROMA)
    colour[whitish] = SHIELD_WHITE
    alpha = coverage.copy()
    alpha[inside] = 1.0
    emblem = np.dstack([colour, alpha * 255.0])

    w_left, w_top, w_right, w_bottom = LOGO_WORDS_BOX
    words = lettering(as_float(sheet.crop(LOGO_WORDS_BOX)), ink)

    canvas = np.zeros((w_bottom - top, w_right - w_left, 4), dtype=np.float64)
    canvas[0 : bottom - top, left - w_left : right - w_left] = emblem
    region = canvas[w_top - top : w_bottom - top, 0 : w_right - w_left]
    # The words are below the emblem's box; where the two boxes meet, the
    # opaquer of the two wins.
    take = words[..., 3] > region[..., 3]
    region[take] = words[take]
    picture = to_image(trimmed(canvas))
    height = round(picture.height * width / picture.width)
    return picture.resize((width, height), Image.Resampling.LANCZOS)


def png(picture: Image.Image) -> bytes:
    out = io.BytesIO()
    picture.save(out, format="PNG", optimize=False, compress_level=9)
    return out.getvalue()


def derive() -> dict[str, bytes]:
    sheets = {
        source["path"]: Image.open(io.BytesIO(read_source(source["path"]))).convert("RGB")
        for source in TABLE["sources"]
    }
    families = TABLE["families"]
    mark, blue = icon_mark(sheets[families["icon"]["source"]])
    model: LocalModel | None = None
    made: dict[str, bytes] = {}
    for output in TABLE["outputs"]:
        family, kind, size = output["family"], output["kind"], output["size"]
        sheet = sheets[families[family]["source"]]
        if family == "icon":
            picture = icon(kind, size, mark, blue)
        elif family == "wordmark":
            picture = wordmark(sheet, NAVY if kind == "wordmark-light" else DARK_INK, size)
        elif family == "logo":
            if model is None:
                model = LocalModel()
            picture = logo(sheet, NAVY if kind == "logo-light" else DARK_INK, size, model)
        else:
            refuse(f"unknown family {family}")
        made[output["path"]] = png(picture)
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
        digest = sha256((ROOT / output["path"]).read_bytes())
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
        differ = [path for path, data in made.items() if not (ROOT / path).exists() or (ROOT / path).read_bytes() != data]
        for path in differ:
            print(f"derive_brand: {path} is not what this script makes", file=sys.stderr)
        if differ:
            raise SystemExit(1)
        print(f"derive_brand: all {len(made)} outputs reproduced byte for byte")
        return
    for path, data in made.items():
        target = ROOT / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        print(f"{sha256(data)}  {path}")


if __name__ == "__main__":
    main()
