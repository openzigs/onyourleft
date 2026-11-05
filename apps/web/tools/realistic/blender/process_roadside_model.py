# SPDX-License-Identifier: AGPL-3.0-or-later
"""
One Poly Haven roadside model -- a street lamp, a road barrier -- cut down to a
few hundred triangles that carry their colour in their vertices -- #1274.

Run by `process-assets.ts`, never by hand:

    Blender -b --factory-startup --python process_roadside_model.py -- \
        <in.gltf> <out.glb> <report.json> <object> <target-tris>

The realistic world draws these where the stylised world draws its own
furniture from numbers, inside the draw call that furniture already makes:
`three-renderer.ts` merges a street's lamp posts with its bollards and bins
into one vertex-coloured mesh (#1689), and the gantries' boxes are one
instanced mesh (#679). A model that brought its own texture would be a
material, and a material is a call. So the photograph is carried into the
vertex colours here, and the GLB carries no picture at all.

1. Import the glTF through `gltf_import.py` (#696's stable rule for a
   repeated triangle, and its guard), keep ONE object, apply its transforms.
2. Weld coincident positions (glTF splits a vertex wherever its texture
   coordinates do, which a collapse cannot merge across -- `process_rock.py`
   found it first), triangulate, and collapse-decimate to <target-tris>;
   THEN stand it on the origin: its footprint's middle at x = y = 0 and its
   lowest point at z = 0. After the collapse, because the collapse moves
   the lowest vertices: stood first, the barrier's foot ended 1.6 cm up.
   Nothing is turned or scaled: the model is the size Poly Haven measured
   it, and the renderer places it.
3. Colour each VERTEX with its material's base colour where its corners
   meet it: a material with a colour map is read through each corner's own
   texture coordinates from that map averaged down to COLOUR_CELLS on a side
   -- a vertex of a few hundred triangles stands for a patch of the surface,
   not a point of it, so it takes the patch's mean rather than whatever one
   texel lies under its corner -- and a material with none gives its own
   base colour. A vertex's colour is the mean of its
   corners'. Arithmetic in numpy over the decoded pixels, so it is the same
   on every run; no render, no bake.
4. Drop every material and every texture coordinate, mark edges sharper than
   SHARP_DEGREES as sharp and shade the rest smooth, and export the GLB with
   the colour as COLOR_0 -- the one attribute, unwired, that
   `process_rock.py` says the exporter writes as normalized UNSIGNED_SHORT.

ADR 0026 D-5: every choice is an argument or a constant here, the input is
pinned by `inputs.lock.json` and the tool by `sources.ts` section PINNED_BLENDER.
"""

import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

# The one glTF import, beside this file. No bytecode: a `__pycache__` beside it
# is a binary `ASSET001` refuses.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gltf_import import import_scan  # noqa: E402

args = sys.argv[sys.argv.index("--") + 1 :]
IN_GLTF, OUT_GLB, OUT_REPORT, OBJECT = args[:4]
TARGET_TRIS = int(args[4])
# Step 3: the colour map averaged to this many cells a side before it is read.
COLOUR_CELLS = 32
# Step 4: an edge whose faces meet at more than this is drawn as a crease.
SHARP_DEGREES = 40.0


def triangles(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def base_colour_of(material):
    """The material's base colour: (cells, None) where a picture feeds it --
    the picture averaged to COLOUR_CELLS a side, linear RGB, row 0 the
    bottom as Blender stores it -- and (None, rgb) where nothing does."""
    if material is None or not material.use_nodes:
        return None, (0.8, 0.8, 0.8)
    shader = next((n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if shader is None:
        return None, (0.8, 0.8, 0.8)
    socket = shader.inputs["Base Color"]
    image = None
    for link in socket.links:
        node = link.from_node
        # The importer may put a mix with the vertex colour or a factor
        # between the picture and the shader; follow it to the picture.
        seen = 0
        while node is not None and node.type != "TEX_IMAGE" and seen < 4:
            upstream = [l.from_node for i in node.inputs for l in i.links]
            node = upstream[0] if upstream else None
            seen += 1
        if node is not None and node.type == "TEX_IMAGE":
            image = node.image
    if image is None:
        value = socket.default_value
        return None, (value[0], value[1], value[2])
    width, height = image.size
    pixels = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    picture = pixels.reshape(height, width, 4)[:, :, :3]
    rows = height // COLOUR_CELLS
    cols = width // COLOUR_CELLS
    cells = (
        picture[: rows * COLOUR_CELLS, : cols * COLOUR_CELLS]
        .reshape(COLOUR_CELLS, rows, COLOUR_CELLS, cols, 3)
        .mean(axis=(1, 3))
    )
    # Blender decodes an sRGB picture's pixels as sRGB values; the vertex
    # colour is stored linear, so each cell's mean is taken to linear here.
    if image.colorspace_settings.name == "sRGB":
        cells = np.where(cells <= 0.04045, cells / 12.92, ((cells + 0.055) / 1.055) ** 2.4)
    return cells, None


def sample(cells, u, v):
    """Bilinear in the cells at texture coordinate (u, v), wrapped, v up."""
    n = COLOUR_CELLS
    x = (u % 1.0) * n - 0.5
    y = (v % 1.0) * n - 0.5
    x0 = math.floor(x)
    y0 = math.floor(y)
    fx = x - x0
    fy = y - y0
    out = np.zeros(3)
    for dy, wy in ((0, 1 - fy), (1, fy)):
        for dx, wx in ((0, 1 - fx), (1, fx)):
            out += wx * wy * cells[(y0 + dy) % n, (x0 + dx) % n]
    return out


bpy.ops.wm.read_factory_settings(use_empty=True)
repeated_triangles = import_scan(IN_GLTF)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
keep = [o for o in meshes if o.name == OBJECT]
if len(keep) != 1:
    raise SystemExit(f"expected one object named {OBJECT}: {[o.name for o in meshes]}")
for obj in bpy.data.objects:
    if obj not in keep:
        bpy.data.objects.remove(obj, do_unlink=True)
model = keep[0]
bpy.context.view_layer.objects.active = model
model.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
source_tris = triangles(model)

# --- 2. weld, triangulate, collapse, stand ------------------------------------
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.remove_doubles(threshold=1e-5)
bpy.ops.object.mode_set(mode="OBJECT")
bpy.ops.object.modifier_add(type="TRIANGULATE")
bpy.ops.object.modifier_apply(modifier=model.modifiers[-1].name)
if triangles(model) > TARGET_TRIS:
    modifier = model.modifiers.new("collapse", "DECIMATE")
    modifier.ratio = TARGET_TRIS / triangles(model)
    bpy.ops.object.modifier_apply(modifier="collapse")

# ... and stand what is left on the origin.
co = [v.co.copy() for v in model.data.vertices]
low = Vector((min(c.x for c in co), min(c.y for c in co), min(c.z for c in co)))
high = Vector((max(c.x for c in co), max(c.y for c in co), max(c.z for c in co)))
shift = Vector(((low.x + high.x) / 2, (low.y + high.y) / 2, low.z))
for vertex in model.data.vertices:
    vertex.co -= shift
model.data.update()

# --- 3. the base colour into the vertices ------------------------------------
mesh = model.data
looks = [base_colour_of(slot.material) for slot in model.material_slots] or [
    (None, (0.8, 0.8, 0.8))
]
uv_layer = mesh.uv_layers.active
if uv_layer is None:
    raise SystemExit(f"{OBJECT}: no texture coordinates to read its colour through")
sums = np.zeros((len(mesh.vertices), 3))
counts = np.zeros(len(mesh.vertices))
for polygon in mesh.polygons:
    cells, flat = looks[min(polygon.material_index, len(looks) - 1)]
    for loop_index in polygon.loop_indices:
        vertex = mesh.loops[loop_index].vertex_index
        if cells is None:
            colour = np.array(flat)
        else:
            u, v = uv_layer.data[loop_index].uv
            colour = sample(cells, u, v)
        sums[vertex] += colour
        counts[vertex] += 1
colours = sums / np.maximum(counts, 1)[:, None]
attribute = mesh.color_attributes.new("colour", "FLOAT_COLOR", "POINT")
flat_colours = np.ones((len(mesh.vertices), 4), dtype=np.float32)
flat_colours[:, :3] = colours
attribute.data.foreach_set("color", flat_colours.ravel())
mesh.color_attributes.active_color = attribute
mean_colour = [float(c) for c in colours.mean(axis=0)] if len(colours) else [0.0, 0.0, 0.0]

# --- 4. no material, no coordinates; creases; export -------------------------
mesh.materials.clear()
while mesh.uv_layers:
    mesh.uv_layers.remove(mesh.uv_layers[0])
bpy.ops.object.shade_smooth_by_angle(angle=math.radians(SHARP_DEGREES))

dims = model.dimensions.copy()
bpy.ops.object.select_all(action="DESELECT")
model.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=OUT_GLB,
    export_format="GLB",
    use_selection=True,
    export_vertex_color="ACTIVE",
    export_all_vertex_colors=False,
    export_materials="NONE",
    export_texcoords=False,
    export_extras=False,
    export_yup=True,
)
report = {
    "sourceTriangles": source_tris,
    "triangles": triangles(model),
    # In glTF's axes: x as Blender's, y up, z toward the viewer.
    "widthMetres": dims.x,
    "heightMetres": dims.z,
    "depthMetres": dims.y,
    "meanLinearColour": mean_colour,
    "repeatedTrianglesDropped": repeated_triangles,
}
with open(OUT_REPORT, "w") as handle:
    json.dump(report, handle, indent=2, sort_keys=True)
print("REPORT", json.dumps(report, sort_keys=True))
