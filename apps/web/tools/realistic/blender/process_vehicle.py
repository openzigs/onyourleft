# SPDX-License-Identifier: AGPL-3.0-or-later
"""
A car from Kenney's CC0 Car Kit, cut to Delivery's obstacle budget, its
wheels kept apart so they can turn and its indicators added -- #2540.

Run by `process-assets.ts`, never by hand:

    Blender -b --factory-startup --python process_vehicle.py -- \
        <in.glb> <out.glb> <report.json> <wheel-tris> \
        <length> <width> <height> <paint-cell>

The realistic world draws a parked car inside the Delivery obstacles' ONE
instanced call (`three-renderer.ts` section DeliveryBelt), where every
instance carries every kind's triangles and the instance's kind collapses
the rest. A model that brought its own picture would be a material, and a
material is a call, so the kit's colour map is carried into the corners'
colours here and the GLB carries no picture at all -- as the roadside models
do (#1274, `process_roadside_model.py`). The map is a palette of flat and
graded swatches, so a corner's colour read at its own texture coordinate is
the colour the kit drew there.

1. Import the GLB through `gltf_import.py` and keep its body and its four
   wheels, by the kit's own names; anything else stops the run. Apply each
   one's transforms.
2. Collapse-decimate the front-left wheel to <wheel-tris>, about its hub,
   and draw all four from it: the kit's four are one shape, its right-hand
   ones turned about, so the GLB holds ONE wheel mesh under four nodes, the
   right-hand two turned half a turn about the vertical. The body is kept
   whole: the kit's body is already a few hundred triangles, and the wheels
   are where its budget is.
3. Colour each CORNER from the colour map read at its own texture
   coordinate, bilinear over the decoded pixels and taken to linear. Then
   split off as `paint` the body's faces whose texture coordinates' middle
   lies in <paint-cell> -- the swatch the kit paints this car's body with,
   as `column,row` of 32 by 128 pixel cells -- so the renderer can paint it
   per instance; what is left is `body`. The body's faces drawn from
   GLASS_CELL, the kit's pale glass swatch, are coloured GLASS_SRGB instead:
   read as the kit drew them, the windows were near-white (PR #2548's
   pictures), not glass.
4. Stand it on the origin and bring it to <length> by <width> by <height>
   metres: the body's footprint centred at x = y = 0 and the lowest point of
   the tyres at z = 0, the body stretched to the box (Kenney's cars are
   chunkier than a real one), and each wheel moved with its hub and scaled
   evenly by the height's factor about it, so a wheel stays round and still
   touches the ground. Each wheel's object origin is its hub, so the GLB's
   node carries the point it turns about.
5. Add an amber indicator each side, front and back: a quad
   INDICATOR_WIDTH by INDICATOR_HEIGHT, INDICATOR_PROUD metres proud of the
   body where a ray along the car meets it at INDICATOR_INSET in from the
   side and INDICATOR_UP above the road. `indicator-left` is the car's left
   (+x, its nose along -y in Blender, +z in glTF), `indicator-right` its right.
6. Drop every material and texture coordinate, clear the kit's own split
   normals and shade by angle, and export the GLB: eight nodes, each a mesh
   with its corners' colour as COLOR_0.

ADR 0026 D-5: every choice is an argument or a constant here, the input is
pinned by `inputs.lock.json` and the tool by `sources.ts` section
PINNED_BLENDER. There is one level of detail: a second would be more
triangles in the one roster every obstacle instance submits, never fewer
(`three-renderer.ts` section DELIVERY_OBSTACLE_TRIANGLES).
"""

import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

# ⚠️ No bytecode, as `process_rock.py` imports its helper.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gltf_import import import_scan  # noqa: E402

args = sys.argv[sys.argv.index("--") + 1 :]
IN_GLB, OUT_GLB, OUT_REPORT = args[:3]
WHEEL_TRIS = int(args[3])
LENGTH, WIDTH, HEIGHT = (float(each) for each in args[4:7])
PAINT_COLUMN, PAINT_ROW = (int(each) for each in args[7].split(","))

# The kit's parts, by the names its GLB gives them.
WHEELS = ["wheel-front-left", "wheel-front-right", "wheel-back-left", "wheel-back-right"]
KEPT = ["body", *WHEELS]
# Step 2: the wheel every wheel is drawn from.
TEMPLATE_WHEEL = "wheel-front-left"
# Step 3: the colour map's cells, in pixels: the kit's swatches are 64 wide,
# each a flat half and a graded half, so a cell of 32 is one of them.
CELL_WIDTH = 32
CELL_HEIGHT = 128
# Step 3: the kit's glass swatch, `column,row`: its windscreen, rear screen and
# front side windows, ten triangles of the sedan. Its rear side windows are
# not glass in the kit -- one painted face with the pillar -- and stay so.
GLASS_CELL = (1, 3)
# Tinted glass, as sRGB: #2b3642, this project's own, a dark blue-grey.
GLASS_SRGB = (0x2B / 255, 0x36 / 255, 0x42 / 255)
# Step 5: the indicators, in metres, this project's own numbers.
INDICATOR_WIDTH = 0.14
INDICATOR_HEIGHT = 0.07
INDICATOR_INSET = 0.38
INDICATOR_UP = 0.62
INDICATOR_PROUD = 0.006
# Amber, as sRGB: #ff7a00, deeper than the stylised car's #f59a1b (#2506),
# which the realistic world's AgX tone mapping washed out (PR #2548).
INDICATOR_SRGB = (0xFF / 255, 0x7A / 255, 0x00 / 255)
# Step 6: an edge whose faces meet at more than this is drawn as a crease.
SHARP_DEGREES = 35.0


def triangles(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def linear(value):
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def colour_map(obj):
    """The picture the kit's material reads, as linear RGB rows, row 0 the
    bottom as Blender stores it."""
    material = obj.material_slots[0].material if obj.material_slots else None
    image = None
    if material is not None and material.use_nodes:
        image = next(
            (n.image for n in material.node_tree.nodes if n.type == "TEX_IMAGE" and n.image),
            None,
        )
    if image is None:
        raise SystemExit(f"{obj.name}: no colour map to read its colour through")
    width, height = image.size
    pixels = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    picture = pixels.reshape(height, width, 4)[:, :, :3].astype(np.float64)
    if image.colorspace_settings.name == "sRGB":
        picture = np.where(
            picture <= 0.04045, picture / 12.92, ((picture + 0.055) / 1.055) ** 2.4
        )
    return picture


def sample(picture, u, v):
    """Bilinear in the picture at texture coordinate (u, v), clamped, v up."""
    height, width, _ = picture.shape
    x = min(max(u, 0.0), 1.0) * width - 0.5
    y = min(max(v, 0.0), 1.0) * height - 0.5
    x0 = math.floor(x)
    y0 = math.floor(y)
    fx = x - x0
    fy = y - y0
    out = np.zeros(3)
    for dy, wy in ((0, 1 - fy), (1, fy)):
        for dx, wx in ((0, 1 - fx), (1, fx)):
            row = min(max(y0 + dy, 0), height - 1)
            column = min(max(x0 + dx, 0), width - 1)
            out += wx * wy * picture[row, column]
    return out


def select_only(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


# --- 1. import, keep the body and the wheels -----------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
repeated_triangles = import_scan(IN_GLB)
meshes = {o.name: o for o in bpy.data.objects if o.type == "MESH"}
if sorted(meshes) != sorted(KEPT):
    raise SystemExit(f"expected exactly {KEPT}: {sorted(meshes)}")
for obj in list(bpy.data.objects):
    if obj.type != "MESH":
        bpy.data.objects.remove(obj, do_unlink=True)
picture = colour_map(meshes["body"])
source_tris = {name: triangles(obj) for name, obj in sorted(meshes.items())}
for name in KEPT:
    select_only(meshes[name])
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# --- 2. one wheel, collapsed; where the four stand --------------------------------
def extent(objects):
    co = [v.co for o in objects for v in o.data.vertices]
    low = Vector((min(c.x for c in co), min(c.y for c in co), min(c.z for c in co)))
    high = Vector((max(c.x for c in co), max(c.y for c in co), max(c.z for c in co)))
    return low, high


kit_hubs = {name: sum(extent([meshes[name]]), Vector()) / 2 for name in WHEELS}
ground = extent([meshes[name] for name in WHEELS])[0].z
wheel = meshes[TEMPLATE_WHEEL]
for name in WHEELS:
    if name != TEMPLATE_WHEEL:
        mesh = meshes.pop(name).data
        bpy.data.objects.remove(bpy.data.objects[name], do_unlink=True)
        bpy.data.meshes.remove(mesh)
wheel.data.transform(Matrix.Translation(-kit_hubs[TEMPLATE_WHEEL]))
select_only(wheel)
bpy.ops.object.modifier_add(type="TRIANGULATE")
bpy.ops.object.modifier_apply(modifier=wheel.modifiers[-1].name)
if triangles(wheel) > WHEEL_TRIS:
    modifier = wheel.modifiers.new("collapse", "DECIMATE")
    modifier.ratio = WHEEL_TRIS / triangles(wheel)
    bpy.ops.object.modifier_apply(modifier="collapse")

# --- 3. the corners' colour, and the paint split off -----------------------------
for name in sorted(meshes):
    mesh = meshes[name].data
    uv_layer = mesh.uv_layers.active
    if uv_layer is None:
        raise SystemExit(f"{name}: no texture coordinates to read its colour through")
    colours = np.ones((len(mesh.loops), 4), dtype=np.float32)
    for loop in mesh.loops:
        u, v = uv_layer.data[loop.index].uv
        colours[loop.index, :3] = sample(picture, u, v)
    attribute = mesh.color_attributes.new("colour", "FLOAT_COLOR", "CORNER")
    attribute.data.foreach_set("color", colours.ravel())
    mesh.color_attributes.active_color = attribute

body = meshes["body"]
height_px, width_px, _ = picture.shape
uv_layer = body.data.uv_layers.active
painted = []
glass = [linear(c) for c in GLASS_SRGB] + [1.0]
glazed = 0
body_colours = body.data.color_attributes["colour"].data
for polygon in body.data.polygons:
    us = [uv_layer.data[i].uv for i in polygon.loop_indices]
    u = sum(each.x for each in us) / len(us)
    v = sum(each.y for each in us) / len(us)
    column = int(min(max(u, 0.0), 0.999999) * width_px) // CELL_WIDTH
    row = int(min(max(1.0 - v, 0.0), 0.999999) * height_px) // CELL_HEIGHT
    if column == PAINT_COLUMN and row == PAINT_ROW:
        painted.append(polygon.index)
    if (column, row) == GLASS_CELL:
        for i in polygon.loop_indices:
            body_colours[i].color = glass
        glazed += len(polygon.vertices) - 2
if not painted:
    raise SystemExit(f"no face of the body is painted from cell {PAINT_COLUMN},{PAINT_ROW}")
if not glazed:
    raise SystemExit(f"no face of the body is glass from cell {GLASS_CELL}")
paint = body.copy()
paint.data = body.data.copy()
paint.name = "paint"
paint.data.name = "paint"
bpy.context.scene.collection.objects.link(paint)
chosen = set(painted)
for obj, keep_painted in ((body, False), (paint, True)):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    gone = [f for f in bm.faces if (f.index in chosen) != keep_painted]
    bmesh.ops.delete(bm, geom=gone, context="FACES")
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
parts = {**meshes, "paint": paint}

# --- 4. stood on the origin, brought to the box --------------------------------
shell = [parts["body"], parts["paint"]]
low, high = extent(shell)
middle = Vector(((low.x + high.x) / 2, (low.y + high.y) / 2, ground))
across = WIDTH / (high.x - low.x)
along = LENGTH / (high.y - low.y)
up = HEIGHT / (high.z - ground)


def stretched(point):
    return Vector(
        ((point.x - middle.x) * across, (point.y - middle.y) * along, (point.z - middle.z) * up)
    )


for obj in shell:
    for vertex in obj.data.vertices:
        vertex.co = stretched(vertex.co)
    obj.data.update()
wheel.data.transform(Matrix.Scale(up, 4))
wheel.data.update()
hubs = {}
for name in WHEELS:
    obj = wheel if name == TEMPLATE_WHEEL else bpy.data.objects.new(name, wheel.data)
    if obj is not wheel:
        bpy.context.scene.collection.objects.link(obj)
    hubs[name] = stretched(kit_hubs[name])
    obj.location = hubs[name]
    # The car's right-hand wheels are its left-hand one turned about, as the
    # kit's own are: one mesh, four nodes.
    turned = name.endswith("-right")
    obj.rotation_euler = (0.0, 0.0, math.pi if turned else 0.0)
    parts[name] = obj
    outer = max(abs(hubs[name].x + (-v.co.x if turned else v.co.x)) for v in wheel.data.vertices)
    if outer > WIDTH / 2:
        raise SystemExit(f"{name}: it stands outside the {WIDTH} m footprint")

# --- 5. the indicators ---------------------------------------------------------
shell_bm = bmesh.new()
for obj in shell:
    shell_bm.from_mesh(obj.data)
tree = BVHTree.FromBMesh(shell_bm)
shell_bm.free()
amber = [linear(c) for c in INDICATOR_SRGB] + [1.0]


def indicator(side):
    """Two quads, one at the nose (-y) and one at the tail (+y), on `side`:
    +1 the car's left (+x), -1 its right."""
    x = side * (WIDTH / 2 - INDICATOR_INSET)
    vertices = []
    faces = []
    for facing in (-1, 1):
        start = Vector((x, facing * (LENGTH / 2 + 1.0), INDICATOR_UP))
        hit, _normal, _index, _distance = tree.ray_cast(start, Vector((0, -facing, 0)))
        if hit is None:
            raise SystemExit(f"no body behind the indicator at x {x:.2f}, facing {facing}")
        y = hit.y + facing * INDICATOR_PROUD
        w = INDICATOR_WIDTH / 2
        h = INDICATOR_HEIGHT / 2
        first = len(vertices)
        corners = [(-w, -h), (w, -h), (w, h), (-w, h)]
        vertices.extend(Vector((x + dx, y, INDICATOR_UP + dz)) for dx, dz in corners)
        # Wound to face outward, along `facing`.
        quad = [first, first + 1, first + 2, first + 3]
        faces.append(quad if facing < 0 else list(reversed(quad)))
    name = "indicator-left" if side > 0 else "indicator-right"
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in vertices], [], faces)
    mesh.update()
    attribute = mesh.color_attributes.new("colour", "FLOAT_COLOR", "CORNER")
    attribute.data.foreach_set("color", amber * len(mesh.loops))
    mesh.color_attributes.active_color = attribute
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


parts["indicator-left"] = indicator(1)
parts["indicator-right"] = indicator(-1)

# --- 6. no material, no coordinates; creases; export ---------------------------
# Once a mesh: the four wheels share one.
for name in sorted(parts):
    obj = parts[name]
    if name in WHEELS and name != TEMPLATE_WHEEL:
        continue
    select_only(obj)
    obj.data.materials.clear()
    while obj.data.uv_layers:
        obj.data.uv_layers.remove(obj.data.uv_layers[0])
    triangulated = bmesh.new()
    triangulated.from_mesh(obj.data)
    bmesh.ops.triangulate(triangulated, faces=triangulated.faces[:])
    triangulated.to_mesh(obj.data)
    triangulated.free()
    if obj.data.has_custom_normals:
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(SHARP_DEGREES))

bpy.ops.object.select_all(action="DESELECT")
for obj in parts.values():
    obj.select_set(True)
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
counts = {name: triangles(parts[name]) for name in sorted(parts)}
report = {
    "sourceTriangles": sum(source_tris.values()),
    # Every node's, a wheel's four times: what the renderer draws.
    "triangles": sum(counts.values()),
    "bodyTriangles": counts["body"],
    "paintTriangles": counts["paint"],
    "glassTriangles": glazed,
    "wheelTriangles": triangles(wheel),
    "wheels": len(WHEELS),
    "indicatorTriangles": counts["indicator-left"] + counts["indicator-right"],
    "levelsOfDetail": 1,
    # In glTF's axes: x across (the car's left +), y up, z along (its nose +).
    "lengthMetres": round(LENGTH, 4),
    "widthMetres": round(WIDTH, 4),
    "heightMetres": round(HEIGHT, 4),
    "frontHubMetres": [round(hubs["wheel-front-left"].x, 4), round(hubs["wheel-front-left"].z, 4), round(-hubs["wheel-front-left"].y, 4)],
    "backHubMetres": [round(hubs["wheel-back-left"].x, 4), round(hubs["wheel-back-left"].z, 4), round(-hubs["wheel-back-left"].y, 4)],
    "repeatedTrianglesDropped": repeated_triangles,
}
with open(OUT_REPORT, "w") as handle:
    json.dump(report, handle, indent=2, sort_keys=True)
print("REPORT", json.dumps(report, sort_keys=True))
