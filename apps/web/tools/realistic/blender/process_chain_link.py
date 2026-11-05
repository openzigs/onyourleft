# SPDX-License-Identifier: AGPL-3.0-or-later
"""
Poly Haven's chain-link fence kit made into one 8 m fence piece, its frame
coloured a vertex at a time and its wire a cut-out -- #1274, the owner's ruling
of 2026-11-05.

Run by `process-assets.ts`, never by hand:

    Blender -b --factory-startup --python process_chain_link.py -- \
        <in.gltf> <out.glb> <report.json> <post-tris> <panel-tris>

The realistic world draws this where industrial, school and sports grounds
meet the road, INSIDE the field fence's own instanced draw
(`three-renderer.ts` section RealisticStructureBelts): the piece is folded
into the fence's mesh and each instance draws one of the two shapes. So it
brings no material and no texture of its own but the wire's opacity, which
`sources.ts` encodes from the kit's own `wire_opacity` map.

1. Import the glTF through `gltf_import.py` and keep the kit's double panel
   (`modular_chainlink_fence_double`, 1.91 m of panel between two posts' room)
   and its post (`modular_chainlink_fence_post`, 2.52 m), transforms applied.
2. Split the panel by material: its tubes (`..._posts`) and its wire plane
   (`..._wire`).
3. The post and the tubes are each welded, triangulated and collapse-decimated
   to their own <post-tris> and <panel-tris>, then coloured a vertex at a time
   from the posts' colour map, as `process_roadside_model.py` colours a lamp:
   averaged to COLOUR_CELLS a side, read through each corner's coordinates.
4. The wire plane is a 3 x 5 grid of quads mapped by one affine projection,
   so it is dissolved to its outline -- the same plane and the same
   coordinates in two triangles -- and given a second, flipped face: the
   fence is seen from both sides and the material draws front faces only.
   Its colour is the wire colour map's mean where the opacity map says there
   is wire, and its texture coordinates are kept.
5. One piece: posts at x = -4, -2, 0, 2 and 4 m, and a panel between each
   two, so the piece is BOUNDARY_PIECE_METRES (8 m) long along x, standing
   on z = 0 as the kit stands. The frame is one object, `frame`, and the wire
   another, `wire`; nothing is scaled or turned (the renderer turns it).

ADR 0026 D-5: every choice is an argument or a constant here, the input is
pinned by `inputs.lock.json` and the tool by `sources.ts` section PINNED_BLENDER.
"""

import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gltf_import import import_scan  # noqa: E402

args = sys.argv[sys.argv.index("--") + 1 :]
IN_GLTF, OUT_GLB, OUT_REPORT = args[:3]
POST_TRIS = int(args[3])
PANEL_TRIS = int(args[4])
PANEL = "modular_chainlink_fence_double"
POST = "modular_chainlink_fence_post"
OPACITY = os.path.join(os.path.dirname(IN_GLTF), "modular_chainlink_fence_wire_opacity_1k.jpg")
# Step 3: the colour map averaged to this many cells a side before it is read.
COLOUR_CELLS = 32
# Step 3: an edge whose faces meet at more than this is drawn as a crease.
SHARP_DEGREES = 40.0
# Step 5: where the posts stand along the piece, metres. The kit's panel
# fills the two metres between two posts' middles.
POSTS = (-4.0, -2.0, 0.0, 2.0, 4.0)
BAY = 2.0
# Step 4: an opacity above this is wire, for the wire's mean colour.
WIRE_OPACITY = 0.5


def triangles(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def linear(cells):
    return np.where(cells <= 0.04045, cells / 12.92, ((cells + 0.055) / 1.055) ** 2.4)


def picture_of(image):
    width, height = image.size
    pixels = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    return pixels.reshape(height, width, 4)


def base_picture(material):
    """The picture that feeds a material's base colour, or None."""
    shader = next((n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if shader is None:
        return None
    for link in shader.inputs["Base Color"].links:
        node = link.from_node
        seen = 0
        while node is not None and node.type != "TEX_IMAGE" and seen < 4:
            upstream = [l.from_node for i in node.inputs for l in i.links]
            node = upstream[0] if upstream else None
            seen += 1
        if node is not None and node.type == "TEX_IMAGE":
            return node.image
    return None


def cells_of(image):
    picture = picture_of(image)[:, :, :3]
    height, width = picture.shape[:2]
    rows = height // COLOUR_CELLS
    cols = width // COLOUR_CELLS
    cells = (
        picture[: rows * COLOUR_CELLS, : cols * COLOUR_CELLS]
        .reshape(COLOUR_CELLS, rows, COLOUR_CELLS, cols, 3)
        .mean(axis=(1, 3))
    )
    return linear(cells) if image.colorspace_settings.name == "sRGB" else cells


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


def select_only(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def split_by_material(obj, suffix):
    """A copy of `obj` keeping only the faces whose material ends in `suffix`."""
    copy = obj.copy()
    copy.data = obj.data.copy()
    copy.name = f"{obj.name}-{suffix}"
    bpy.context.collection.objects.link(copy)
    mesh = bmesh.new()
    mesh.from_mesh(copy.data)
    names = [slot.material.name if slot.material else "" for slot in copy.material_slots]
    gone = [f for f in mesh.faces if not names[f.material_index].endswith(suffix)]
    bmesh.ops.delete(mesh, geom=gone, context="FACES")
    mesh.to_mesh(copy.data)
    mesh.free()
    return copy


def decimated(obj, target):
    """Welded, triangulated and collapsed to about `target` triangles."""
    select_only(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=1e-5)
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.modifier_add(type="TRIANGULATE")
    bpy.ops.object.modifier_apply(modifier=obj.modifiers[-1].name)
    if triangles(obj) > target:
        modifier = obj.modifiers.new("collapse", "DECIMATE")
        modifier.ratio = target / triangles(obj)
        bpy.ops.object.modifier_apply(modifier="collapse")
    return obj


def colour_from_picture(obj, cells):
    """Each vertex the mean of its corners' colour, read through their coordinates."""
    mesh = obj.data
    uv_layer = mesh.uv_layers.active
    if uv_layer is None:
        raise SystemExit(f"{obj.name}: no texture coordinates to read its colour through")
    sums = np.zeros((len(mesh.vertices), 3))
    counts = np.zeros(len(mesh.vertices))
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            vertex = mesh.loops[loop_index].vertex_index
            u, v = uv_layer.data[loop_index].uv
            sums[vertex] += sample(cells, u, v)
            counts[vertex] += 1
    set_colour(obj, sums / np.maximum(counts, 1)[:, None])


def set_colour(obj, colours):
    mesh = obj.data
    attribute = mesh.color_attributes.new("colour", "FLOAT_COLOR", "POINT")
    flat = np.ones((len(mesh.vertices), 4), dtype=np.float32)
    flat[:, :3] = colours
    attribute.data.foreach_set("color", flat.ravel())
    mesh.color_attributes.active_color = attribute


def placed(obj, dx, dy=0.0):
    copy = obj.copy()
    copy.data = obj.data.copy()
    bpy.context.collection.objects.link(copy)
    for vertex in copy.data.vertices:
        vertex.co.x += dx
        vertex.co.y += dy
    copy.data.update()
    return copy


def joined(parts, name):
    bpy.ops.object.select_all(action="DESELECT")
    for part in parts:
        part.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    obj.data.name = name
    return obj


bpy.ops.wm.read_factory_settings(use_empty=True)
repeated_triangles = import_scan(IN_GLTF)
meshes = {o.name: o for o in bpy.data.objects if o.type == "MESH"}
for name in (PANEL, POST):
    if name not in meshes:
        raise SystemExit(f"expected an object named {name}: {sorted(meshes)}")
for obj in list(bpy.data.objects):
    if obj.name not in (PANEL, POST):
        bpy.data.objects.remove(obj, do_unlink=True)
panel = meshes[PANEL]
post = meshes[POST]
for obj in (panel, post):
    select_only(obj)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
source_tris = triangles(panel) + triangles(post)

posts_material = next(
    slot.material for slot in post.material_slots if slot.material.name.endswith("posts")
)
wire_material = next(
    slot.material for slot in panel.material_slots if slot.material.name.endswith("wire")
)
post_cells = cells_of(base_picture(posts_material))

# --- 2, 3. the tubes and the post: cut and coloured ---------------------------
tubes = split_by_material(panel, "posts")
wire = split_by_material(panel, "wire")
bpy.data.objects.remove(panel, do_unlink=True)
decimated(tubes, PANEL_TRIS)
decimated(post, POST_TRIS)
colour_from_picture(tubes, post_cells)
colour_from_picture(post, post_cells)
for obj in (tubes, post):
    mesh = obj.data
    mesh.materials.clear()
    while mesh.uv_layers:
        mesh.uv_layers.remove(mesh.uv_layers[0])
    select_only(obj)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(SHARP_DEGREES))

# The post's middle on the origin: the kit stands it at (-1, 1).
low = Vector([min(v.co[i] for v in post.data.vertices) for i in range(3)])
high = Vector([max(v.co[i] for v in post.data.vertices) for i in range(3)])
post_middle = ((low.x + high.x) / 2, (low.y + high.y) / 2)

# --- 4. the wire: its outline, both faces, its mean colour --------------------
select_only(wire)
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.remove_doubles(threshold=1e-5)
bpy.ops.mesh.dissolve_limited(angle_limit=math.radians(1.0), delimit={"UV"})
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.quads_convert_to_tris()
bpy.ops.object.mode_set(mode="OBJECT")
mesh = bmesh.new()
mesh.from_mesh(wire.data)
front = list(mesh.faces)
back = bmesh.ops.duplicate(mesh, geom=front)["geom"]
bmesh.ops.reverse_faces(mesh, faces=[g for g in back if isinstance(g, bmesh.types.BMFace)])
mesh.to_mesh(wire.data)
mesh.free()
wire.data.materials.clear()
opacity = picture_of(bpy.data.images.load(OPACITY))[:, :, 0]
colour = picture_of(base_picture(wire_material))[:, :, :3]
if opacity.shape != colour.shape[:2]:
    raise SystemExit("the wire's opacity and colour maps are not the same size")
where = opacity > WIRE_OPACITY
wire_colour = linear(colour[where].mean(axis=0))
set_colour(wire, np.tile(wire_colour, (len(wire.data.vertices), 1)))
select_only(wire)
bpy.ops.object.shade_flat()

# --- 5. the piece --------------------------------------------------------------
# The panel's own two posts' room is x = -2 to 0 in the kit.
frame_parts = [placed(post, x - post_middle[0], -post_middle[1]) for x in POSTS]
frame_parts += [placed(tubes, left + BAY) for left in POSTS[:-1]]
wire_parts = [placed(wire, left + BAY) for left in POSTS[:-1]]
for obj in (post, tubes, wire):
    bpy.data.objects.remove(obj, do_unlink=True)
frame = joined(frame_parts, "frame")
wire = joined(wire_parts, "wire")

frame_tris = triangles(frame)
wire_tris = triangles(wire)
corners = [v.co for v in frame.data.vertices] + [v.co for v in wire.data.vertices]
low = Vector([min(c[i] for c in corners) for i in range(3)])
high = Vector([max(c[i] for c in corners) for i in range(3)])

bpy.ops.object.select_all(action="DESELECT")
frame.select_set(True)
wire.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=OUT_GLB,
    export_format="GLB",
    use_selection=True,
    export_vertex_color="ACTIVE",
    export_all_vertex_colors=False,
    export_materials="NONE",
    export_texcoords=True,
    export_extras=False,
    export_yup=True,
)
report = {
    "sourceTriangles": source_tris,
    "frameTriangles": frame_tris,
    "wireTriangles": wire_tris,
    "triangles": frame_tris + wire_tris,
    # In glTF's axes: x as Blender's, y up, z toward the viewer.
    "lengthMetres": high.x - low.x,
    "heightMetres": high.z - low.z,
    "depthMetres": high.y - low.y,
    "lowestMetres": low.z,
    "wireLinearColour": [float(c) for c in wire_colour],
    "repeatedTrianglesDropped": repeated_triangles,
}
with open(OUT_REPORT, "w") as handle:
    json.dump(report, handle, indent=2, sort_keys=True)
print("REPORT", json.dumps(report, sort_keys=True))
