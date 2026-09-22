# SPDX-License-Identifier: AGPL-3.0-or-later
"""
One tiled photographic map, downsized to what a structure can spend -- #475.

Run by `process-assets.ts`, never by hand:

    Blender -b --factory-startup --python process_texture.py -- \
        <in-dir> <out.jpg> <report.json> <map-file> <pixels> <colour|data>

ADR 0026 D-12 layer 3. No CC0 or verified CC-BY-4.0 source in D-4's list
publishes a whole building a rider would pass in the country -- Poly Haven's
"buildings" are urban facade kits of 118 000 to 175 000 triangles, gates and
shutters -- so the structures are built in `three-renderer.ts` from numbers,
as the stylised world's are, and wear Poly Haven's CC0 photographic surfaces.
This makes those surfaces: one map of one texture, downsized.

1. Load <map-file> from <in-dir> -- a Poly Haven 1K JPEG, locked by
   `inputs.lock.json`.
2. Mark it Non-Color when it is <data> (a normal map), so nothing between the
   file and the scale is a colour transform.
3. Scale it to <pixels> on a side -- `realistic-budget.ts`
   section REALISTIC_TEXTURE_PIXELS.structure holds the committed file to it.
4. Save it as a JPEG at QUALITY.

ADR 0026 D-5: every choice is an argument or a constant here, the input is
pinned by `inputs.lock.json` and the tool by `sources.ts` section PINNED_BLENDER.
"""

import json
import os
import sys

import bpy

args = sys.argv[sys.argv.index("--") + 1 :]
IN_DIR, OUT_JPG, OUT_REPORT, MAP_FILE = args[:4]
PIXELS = int(args[4])
KIND = args[5]
if KIND not in ("colour", "data"):
    raise SystemExit(f"expected colour or data, got {KIND}")
# The quality the tree and rock scripts export their maps at.
QUALITY = 85

bpy.ops.wm.read_factory_settings(use_empty=True)
source = os.path.join(IN_DIR, MAP_FILE)
image = bpy.data.images.load(source, check_existing=False)
if KIND == "data":
    image.colorspace_settings.name = "Non-Color"
source_size = [image.size[0], image.size[1]]
if source_size[0] == 0 or source_size[1] == 0:
    raise SystemExit(f"{source} did not load")
side = max(source_size)
if side > PIXELS:
    factor = PIXELS / side
    image.scale(max(1, round(source_size[0] * factor)), max(1, round(source_size[1] * factor)))

scene = bpy.context.scene
scene.render.image_settings.file_format = "JPEG"
scene.render.image_settings.quality = QUALITY
scene.render.image_settings.color_mode = "RGB"
# Written as the pixels are, not through a view transform: `save_render`
# would apply the scene's display transform to a colour map and to a normal
# map alike.
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"
scene.view_settings.exposure = 0.0
scene.view_settings.gamma = 1.0
image.save_render(OUT_JPG, scene=scene)

written = bpy.data.images.load(OUT_JPG, check_existing=False)
report = {
    "source": MAP_FILE,
    "sourcePixels": source_size,
    "pixels": [written.size[0], written.size[1]],
    "kind": KIND,
    "quality": QUALITY,
}
with open(OUT_REPORT, "w") as handle:
    json.dump(report, handle, indent=2, sort_keys=True)
print("REPORT", json.dumps(report, sort_keys=True))
