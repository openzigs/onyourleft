# SPDX-License-Identifier: AGPL-3.0-or-later
"""
The realistic world's cars: three bodies out of GGBotNet's CC0 "PSX Style
Cars" pack, at real proportions, in one atlas -- #2847, ADR 0081. It made
one Kenney sedan from #2540 until then.

Run by `process-assets.ts`, never by hand:

    Blender -b --factory-startup --python process_vehicle.py -- \
        <pack-dir> <out.glb> <report.json> <atlas-name> <atlas-pixels> \
        <width> <body> <body> <body>

and each <body> is `name|model.obj|length|paint.png;paint.png;...`, every
path inside <pack-dir>, <atlas-name> a PNG written beside <out.glb>, the
first paint picture the one the pack's model
wears and the rest the pack's other paints of the same body.

The realistic world draws a parked car inside the Delivery obstacles' ONE
instanced call (`three-renderer.ts` section DeliveryBelt), where every
instance carries every kind's triangles and the instance's kind -- and since
#2847 its body -- collapses the rest. So the three bodies wear ONE picture,
the atlas, and the call stays one.

1. Import each body's OBJ and apply its transforms. The pack's cars stand on
   their wheels with the nose along -y and the roof along +z, as Blender reads
   them; anything but one mesh stops the run.
2. Split it into its loose parts. Its four wheels are the four parts whose
   lowest point is the car's lowest (within WHEEL_GROUND); any other count
   stops the run. Each is named by its corner and kept as its own node, its
   origin at its hub, so it can roll and steer about it.
3. Bring it to <length> along the road, scaled evenly -- the pack's own
   proportions, which are a real car's, where its page warns that "the scale
   unit between cars is not correct" -- its footprint centred at x = y = 0
   and its tyres on z = 0. Its body (every part but its mirrors) and its wheels
   must fit inside <width> across; the mirrors, a part wholly outboard of
   MIRROR_SHARE of the body's half-width, may stand past it, and the report
   says by how much.
4. Read which texels are the body's paint: those whose colour differs, by
   more than PAINT_SPREAD in any channel, between the pack's paints of the
   same body. A paint texel is stored as a grey, its shading as a share of a
   colour the renderer supplies (the instance's paint), with alpha 1; every
   other texel -- glass, lamps, tyres, trim -- keeps the pack's own colour with
   alpha 0. The shade is each paint's linear luminance over its own
   PAINT_REFERENCE percentile across the paint texels, averaged over the
   paints and kept at most 1.
5. Lay the three pictures and a white cell into one atlas, <atlas-pixels>
   square, two cells by two: the bodies in their order, the white cell last.
   Each body's texture coordinates are moved into its cell. The white cell is
   opaque white with alpha 1, so a corner that samples it keeps its own
   colour: the renderer gives every other obstacle, and the indicators, a
   coordinate there.
6. Add an amber indicator each side, front and back, as #2540 did: a quad
   INDICATOR_WIDTH by INDICATOR_HEIGHT, INDICATOR_PROUD metres proud of the
   body where a ray along the car meets it INDICATOR_INSET in from the body's
   side, INDICATOR_UP_SHARE of the body's height above the road.
   `indicator-left` is the car's left (+x).
7. Give every corner a colour -- white, and the indicators amber -- keep the
   pack's own normals, and export the GLB: seven nodes a body, each named
   `<body>-<part>`, with its corners' colour as COLOR_0 and its texture
   coordinates as TEXCOORD_0, no material and no picture. The atlas is written
   beside it as a PNG; the pipeline encodes it.

ADR 0026 D-5: every choice is an argument or a constant here, the input is
pinned by `inputs.lock.json` and the tool by `sources.ts` section
PINNED_BLENDER. There is one level of detail: a second would be more
triangles in the one roster every obstacle instance submits, never fewer
(`three-renderer.ts` section DELIVERY_REALISTIC_OBSTACLE_TRIANGLES).
"""

import json
import math
import os
import struct
import sys
import zlib

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

args = sys.argv[sys.argv.index("--") + 1 :]
PACK, OUT_GLB, OUT_REPORT = args[:3]
OUT_ATLAS = os.path.join(os.path.dirname(OUT_GLB), args[3])
ATLAS_PIXELS = int(args[4])
WIDTH = float(args[5])
BODIES = []
for spec in args[6:]:
    name, model, length, paints = spec.split("|")
    BODIES.append(
        {"name": name, "model": model, "length": float(length), "paints": paints.split(";")}
    )
if len(BODIES) != 3:
    raise SystemExit(f"expected three bodies, not {len(BODIES)}")

WHEELS = ["wheel-front-left", "wheel-front-right", "wheel-back-left", "wheel-back-right"]
# Step 2: how far above the car's lowest point a wheel's lowest point may be, metres in the pack.
WHEEL_GROUND = 0.02
# Step 3: a part wholly outboard of this share of the body's half-width is a mirror.
MIRROR_SHARE = 0.9
# Step 4: a texel whose paints differ by more than this, in any channel of its
# stored sRGB, is paint; the shade's reference is this percentile of each paint's.
PAINT_SPREAD = 0.05
PAINT_REFERENCE = 90
# Step 5: the cells, `column,row` from the atlas's top-left: the bodies' and the white one.
CELLS = [(0, 0), (1, 0), (0, 1)]
WHITE_CELL = (1, 1)
# Step 6: the indicators, in metres, #2540's numbers but the inset and the
# height, which is this share of the body's: the pack's bodies are a third
# taller or shorter than Kenney's, and their lamps sit lower on them.
INDICATOR_UP_SHARE = 0.33
INDICATOR_WIDTH = 0.14
INDICATOR_HEIGHT = 0.07
INDICATOR_INSET = 0.2
INDICATOR_PROUD = 0.006
# Amber, as sRGB: #ff7a00, #2540's.
INDICATOR_SRGB = (0xFF / 255, 0x7A / 255, 0x00 / 255)

def triangles(mesh):
    return sum(len(p.vertices) - 2 for p in mesh.polygons)


def linear_of(values):
    return np.where(values <= 0.04045, values / 12.92, ((values + 0.055) / 1.055) ** 2.4)


def srgb_of(values):
    return np.where(
        values <= 0.0031308, values * 12.92, 1.055 * np.maximum(values, 0) ** (1 / 2.4) - 0.055
    )


def read_image(path):
    """A picture's stored values, bottom row first: (height, width, 4)."""
    image = bpy.data.images.load(path)
    image.colorspace_settings.name = "Non-Color"
    width, height = image.size
    values = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(values)
    bpy.data.images.remove(image)
    return values.reshape(height, width, 4).astype(np.float64)


def write_png(path, values):
    """8-bit RGBA PNG, written here so no colour management touches the bytes. Row 0 is v = 0."""
    data = np.clip(np.round(values[::-1] * 255), 0, 255).astype(np.uint8)
    height_px, width_px = data.shape[:2]
    rows = b"".join(b"\x00" + data[row].tobytes() for row in range(height_px))

    def chunk(kind, body_bytes):
        payload = kind + body_bytes
        return (
            struct.pack(">I", len(body_bytes))
            + payload
            + struct.pack(">I", zlib.crc32(payload) & 0xFFFFFFFF)
        )

    with open(path, "wb") as handle:
        handle.write(b"\x89PNG\r\n\x1a\n")
        handle.write(chunk(b"IHDR", struct.pack(">IIBBBBB", width_px, height_px, 8, 6, 0, 0, 0)))
        handle.write(chunk(b"IDAT", zlib.compress(rows, 9)))
        handle.write(chunk(b"IEND", b""))


def painted_picture(paths):
    """Step 4: the body's picture with its paint as a grey shade and alpha 1,
    everything else its own colour and alpha 0; and how many texels are paint."""
    pictures = [read_image(os.path.join(PACK, path))[:, :, :3] for path in paths]
    shapes = {picture.shape for picture in pictures}
    if len(shapes) != 1:
        raise SystemExit(f"{paths}: the paints are not one size: {shapes}")
    stack = np.stack(pictures)
    paint = (stack.max(axis=0) - stack.min(axis=0)).max(axis=-1) > PAINT_SPREAD
    if not paint.any():
        raise SystemExit(f"{paths}: no texel differs between the paints")
    weights = np.array([0.2126, 0.7152, 0.0722])
    shades = []
    for picture in pictures:
        luminance = linear_of(picture) @ weights
        reference = np.percentile(luminance[paint], PAINT_REFERENCE)
        shades.append(luminance / reference)
    shade = np.clip(np.mean(shades, axis=0), 0.0, 1.0)
    grey = srgb_of(shade)
    out = np.zeros(pictures[0].shape[:2] + (4,))
    out[:, :, :3] = np.where(paint[:, :, None], grey[:, :, None], pictures[0])
    out[:, :, 3] = np.where(paint, 1.0, 0.0)
    return out, int(paint.sum())


def loose_parts(mesh):
    """The mesh's faces in connected groups, each a list of face indices, in face order."""
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.faces.ensure_lookup_table()
    seen = set()
    groups = []
    for face in bm.faces:
        if face.index in seen:
            continue
        stack = [face]
        seen.add(face.index)
        group = []
        while stack:
            each = stack.pop()
            group.append(each.index)
            for edge in each.edges:
                for other in edge.link_faces:
                    if other.index not in seen:
                        seen.add(other.index)
                        stack.append(other)
        groups.append(sorted(group))
    bm.free()
    return sorted(groups)


def extent(mesh, faces=None):
    indices = (
        {v for f in faces for v in mesh.polygons[f].vertices}
        if faces is not None
        else range(len(mesh.vertices))
    )
    co = [mesh.vertices[i].co for i in indices]
    low = Vector((min(c.x for c in co), min(c.y for c in co), min(c.z for c in co)))
    high = Vector((max(c.x for c in co), max(c.y for c in co), max(c.z for c in co)))
    return low, high


def separated(obj, faces, name):
    """A new object holding a copy of `faces` of `obj`, and nothing else."""
    copy = obj.copy()
    copy.data = obj.data.copy()
    copy.name = name
    copy.data.name = name
    bpy.context.scene.collection.objects.link(copy)
    keep = set(faces)
    bm = bmesh.new()
    bm.from_mesh(copy.data)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in keep], context="FACES")
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.to_mesh(copy.data)
    bm.free()
    copy.data.update()
    return copy


def coloured(mesh, rgba):
    attribute = mesh.color_attributes.new("colour", "FLOAT_COLOR", "CORNER")
    attribute.data.foreach_set("color", list(rgba) * len(mesh.loops))
    mesh.color_attributes.active_color = attribute


def into_cell(mesh, cell):
    """Moves the mesh's texture coordinates into `cell` of the two-by-two atlas (v up, as Blender's)."""
    column, row = cell
    layer = mesh.uv_layers.active
    for loop in layer.data:
        u, v = loop.uv
        loop.uv = ((min(max(u, 0.0), 1.0) + column) / 2, (min(max(v, 0.0), 1.0) + (1 - row)) / 2)


bpy.ops.wm.read_factory_settings(use_empty=True)
half = ATLAS_PIXELS // 2
atlas = np.zeros((ATLAS_PIXELS, ATLAS_PIXELS, 4))
white_row = (1 - WHITE_CELL[1]) * half
white_column = WHITE_CELL[0] * half
atlas[white_row : white_row + half, white_column : white_column + half] = 1.0
white_uv = ((WHITE_CELL[0] + 0.5) / 2, ((1 - WHITE_CELL[1]) + 0.5) / 2)
amber = [float(c) for c in linear_of(np.array(INDICATOR_SRGB))] + [1.0]
parts = {}
report_bodies = {}
for number, body in enumerate(BODIES):
    name = body["name"]
    # --- 1. import ------------------------------------------------------------
    before = set(bpy.data.objects)
    bpy.ops.wm.obj_import(filepath=os.path.join(PACK, body["model"]))
    imported = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in imported if o.type == "MESH"]
    if len(meshes) != 1 or len(imported) != 1:
        raise SystemExit(f"{body['model']}: expected one mesh, not {[o.name for o in imported]}")
    source = meshes[0]
    bpy.ops.object.select_all(action="DESELECT")
    source.select_set(True)
    bpy.context.view_layer.objects.active = source
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    source_triangles = triangles(source.data)

    # --- 2. its wheels ----------------------------------------------------------
    groups = loose_parts(source.data)
    ground = extent(source.data)[0].z
    wheel_groups = [g for g in groups if extent(source.data, g)[0].z <= ground + WHEEL_GROUND]
    if len(wheel_groups) != 4:
        raise SystemExit(f"{name}: expected four wheels on the ground, not {len(wheel_groups)}")
    shell_faces = sorted(f for g in groups if g not in wheel_groups for f in g)

    # --- 3. to <length>, evenly ------------------------------------------------
    shell_groups = [g for g in groups if g not in wheel_groups]
    main = max(shell_groups, key=len)
    main_low, main_high = extent(source.data, main)
    main_half = (main_high.x - main_low.x) / 2
    main_middle = (main_high.x + main_low.x) / 2
    mirrors = []
    for g in shell_groups:
        g_low, g_high = extent(source.data, g)
        inner = min(abs(g_low.x - main_middle), abs(g_high.x - main_middle))
        if (g_low.x - main_middle) * (g_high.x - main_middle) > 0 and inner >= MIRROR_SHARE * main_half:
            mirrors.append(g)
    kept = [f for g in groups if g not in mirrors for f in g]
    # Centred on everything but the mirrors, which need not come in pairs.
    low, high = extent(source.data, kept)
    scale = body["length"] / (high.y - low.y)
    middle = Vector(((low.x + high.x) / 2, (low.y + high.y) / 2, ground))
    for vertex in source.data.vertices:
        vertex.co = (vertex.co - middle) * scale
    source.data.update()
    kept_low, kept_high = extent(source.data, kept)
    outer = max(abs(kept_low.x), abs(kept_high.x))
    if outer > WIDTH / 2 + 1e-6:
        raise SystemExit(f"{name}: its body is {2 * outer:.3f} m across, wider than {WIDTH} m")
    all_low, all_high = extent(source.data)
    mirror_half = max(abs(all_low.x), abs(all_high.x))

    # --- 4 and 5. its paint, its cell ------------------------------------------
    picture, paint_texels = painted_picture(body["paints"])
    if picture.shape[0] != half or picture.shape[1] != half:
        raise SystemExit(f"{name}: its picture is not {half} px square: {picture.shape}")
    column, row = CELLS[number]
    # Rows are bottom first, as Blender stores them: the top row of cells is the upper half.
    bottom = (1 - row) * half
    atlas[bottom : bottom + half, column * half : column * half + half] = picture
    into_cell(source.data, CELLS[number])

    # --- the parts -------------------------------------------------------------
    hubs = {}
    body_obj = separated(source, shell_faces, f"{name}-body")
    coloured(body_obj.data, (1.0, 1.0, 1.0, 1.0))
    parts[f"{name}-body"] = body_obj
    for group in wheel_groups:
        w_low, w_high = extent(source.data, group)
        hub = (w_low + w_high) / 2
        corner = ("wheel-front" if hub.y < 0 else "wheel-back") + (
            "-left" if hub.x > 0 else "-right"
        )
        if corner in hubs:
            raise SystemExit(f"{name}: two wheels at its {corner}")
        wheel = separated(source, group, f"{name}-{corner}")
        for vertex in wheel.data.vertices:
            vertex.co = vertex.co - hub
        wheel.data.update()
        wheel.location = hub
        coloured(wheel.data, (1.0, 1.0, 1.0, 1.0))
        hubs[corner] = hub
        parts[f"{name}-{corner}"] = wheel
    if sorted(hubs) != sorted(WHEELS):
        raise SystemExit(f"{name}: its wheels are not one at each corner: {sorted(hubs)}")

    # --- 6. the indicators -------------------------------------------------------
    lamp_bm = bmesh.new()
    lamp_bm.from_mesh(body_obj.data)
    tree = BVHTree.FromBMesh(lamp_bm)
    lamp_bm.free()
    body_low, body_high = extent(body_obj.data)
    lamp_up = INDICATOR_UP_SHARE * body_high.z

    def indicator(side):
        x = side * (outer - INDICATOR_INSET)
        vertices = []
        faces = []
        for facing in (-1, 1):
            start = Vector((x, facing * (body["length"] / 2 + 1.0), lamp_up))
            hit, _normal, _index, _distance = tree.ray_cast(start, Vector((0, -facing, 0)))
            if hit is None:
                raise SystemExit(f"{name}: no body behind the indicator at x {x:.2f}, facing {facing}")
            y = hit.y + facing * INDICATOR_PROUD
            w = INDICATOR_WIDTH / 2
            h = INDICATOR_HEIGHT / 2
            first = len(vertices)
            vertices.extend(
                Vector((x + dx, y, lamp_up + dz)) for dx, dz in [(-w, -h), (w, -h), (w, h), (-w, h)]
            )
            quad = [first, first + 1, first + 2, first + 3]
            faces.append(quad if facing < 0 else list(reversed(quad)))
        part = f"{name}-indicator-left" if side > 0 else f"{name}-indicator-right"
        mesh = bpy.data.meshes.new(part)
        mesh.from_pydata([tuple(v) for v in vertices], [], faces)
        mesh.update()
        layer = mesh.uv_layers.new(name="UVMap")
        for loop in layer.data:
            loop.uv = white_uv
        coloured(mesh, amber)
        obj = bpy.data.objects.new(part, mesh)
        bpy.context.scene.collection.objects.link(obj)
        parts[part] = obj
        return obj

    indicator(1)
    indicator(-1)

    wheel_radius = sum(h.z for h in hubs.values()) / 4
    report_bodies[name] = {
        "sourceTriangles": source_triangles,
        "bodyTriangles": triangles(body_obj.data),
        "wheelTriangles": sum(triangles(parts[f"{name}-{w}"].data) for w in WHEELS),
        "indicatorTriangles": triangles(parts[f"{name}-indicator-left"].data)
        + triangles(parts[f"{name}-indicator-right"].data),
        "paintTexels": paint_texels,
        "scale": round(scale, 4),
        # In glTF's axes: x across (the car's left +), y up, z along (its nose +).
        "lengthMetres": round(body_high.y - body_low.y, 4),
        "widthMetres": round(2 * outer, 4),
        "heightMetres": round(body_high.z, 4),
        "mirrorsHalfWidthMetres": round(mirror_half, 4),
        "wheelRadiusMetres": round(wheel_radius, 4),
        "wheelbaseMetres": round(hubs["wheel-back-left"].y - hubs["wheel-front-left"].y, 4),
        "indicatorUpMetres": round(lamp_up, 4),
    }
    bpy.data.objects.remove(source, do_unlink=True)

# --- 7. colour, coordinates, export ------------------------------------------
for name in sorted(parts):
    obj = parts[name]
    obj.data.materials.clear()
    triangulated = bmesh.new()
    triangulated.from_mesh(obj.data)
    bmesh.ops.triangulate(triangulated, faces=triangulated.faces[:])
    triangulated.to_mesh(obj.data)
    triangulated.free()
    obj.data.update()

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
    export_texcoords=True,
    export_normals=True,
    export_extras=False,
    export_yup=True,
)
write_png(OUT_ATLAS, atlas)
counts = {name: triangles(parts[name].data) for name in sorted(parts)}
report = {
    "sourceTriangles": sum(each["sourceTriangles"] for each in report_bodies.values()),
    # Every node's: what each obstacle instance submits of the three.
    "triangles": sum(counts.values()),
    "bodies": len(BODIES),
    "nodes": len(parts),
    "levelsOfDetail": 1,
    "atlasPixels": ATLAS_PIXELS,
    "wheelTriangles": sum(each["wheelTriangles"] for each in report_bodies.values()),
    "indicatorTriangles": sum(each["indicatorTriangles"] for each in report_bodies.values()),
    "paintTexels": sum(each["paintTexels"] for each in report_bodies.values()),
    "perBody": report_bodies,
}
with open(OUT_REPORT, "w") as handle:
    json.dump(report, handle, indent=2, sort_keys=True)
print("REPORT", json.dumps(report, sort_keys=True))
