# SPDX-License-Identifier: AGPL-3.0-or-later
"""
The house models a mapped footprint may be drawn as -- #1585, the owner's
ruling of 2026-10-22 on it: GildedAge's RVA set and Orzechu's brick building
with shop, CC-BY-4.0, atlased into ONE material so they cost one draw call.

Run by `process-assets.ts`, never by hand:

    Blender -b --factory-startup --python process_house_models.py -- \
        <first-source-dir> <out> <report.json> <which> <other-source-dir>...

`<which>` is a source id (write that model's GLB, geometry only) or `atlas`
(write the one baked colour atlas every model's GLB is mapped into, as a PNG
the KTX2 step encodes). Every run reads EVERY model, because the atlas's
layout is one packing of all of them: a model's texture coordinates are
places in a picture the other twelve share.

1. Import each model's `scene.gltf` through `gltf_import.py`, in the order of
   its source id, join its parts, apply its transforms, and bring it to
   metres (MODELS' `scale`: the RVA set is in centimetres but one).
2. Turn it so its long axis is X and its front faces the side MODELS
   names -- `end`: the front is the +X end; `side`: the front is the long side
   that glTF calls +Z -- and stand it on the origin: its footprint's middle at
   x = z = 0 and its lowest point at y = 0.
3. The shop's photograph of a real shop interior, posters and the "OPEN"
   sign on its door are painted over with #1590's glass before anything reads
   the picture (the owner's ruling of 2026-10-23 on #1585; ADR 0049's
   amendment of that date). Nothing else in any picture is changed.
4. One new texture-coordinate set for all thirteen at once (Smart UV Project
   over every model, then one packing of every island), and -- for `atlas` --
   each model's own colour picture baked into it with Cycles, as an emission
   read through the model's original coordinates: colour only, no light. The
   originals repeat their pictures (their coordinates run past 0 and 1),
   which one shared picture cannot do; the bake is what makes the thirteen
   one material.
5. For a model: drop every material and the original coordinates,
   triangulate, dissolve faces of no area, shade every face flat, and export
   the GLB. For `atlas`: save the baked picture.

ADR 0026 D-5: every choice is a constant here, the inputs are pinned by
`inputs.lock.json` and the tool by `sources.ts` section PINNED_BLENDER.
"""

import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

# ⚠️ No bytecode, as `process_rock.py` imports its helper.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gltf_import import import_scan  # noqa: E402

args = sys.argv[sys.argv.index("--") + 1 :]
FIRST_DIR, OUT, OUT_REPORT, WHICH = args[:4]
SOURCE_DIRS = sorted([FIRST_DIR, *args[4:]], key=lambda d: os.path.basename(d.rstrip("/")))

# Each model: metres per unit of its file, which way its front faces as
# imported (Blender's axes, Z up), and whether that front is an END of its
# long axis or a long SIDE -- read from renders of each side on 2026-10-23.
MODELS = {
    "old_american_brick_shop": {"scale": 1.0, "front": "+x", "kind": "end"},
    "rva_detached_house_01a": {"scale": 0.01, "front": "+y", "kind": "end"},
    "rva_detached_house_02a": {"scale": 0.01, "front": "+y", "kind": "end"},
    "rva_detached_house_02b": {"scale": 0.01, "front": "+y", "kind": "end"},
    "rva_detached_house_03a": {"scale": 0.01, "front": "+y", "kind": "end"},
    "rva_detached_house_03c": {"scale": 0.01, "front": "+y", "kind": "end"},
    "rva_detached_house_04a": {"scale": 0.01, "front": "+y", "kind": "end"},
    "rva_detached_house_04b": {"scale": 1.0, "front": "-y", "kind": "end"},
    "rva_duplex_01a": {"scale": 0.01, "front": "+y", "kind": "end"},
    "rva_duplex_01b": {"scale": 0.01, "front": "+y", "kind": "end"},
    "rva_duplex_02a": {"scale": 0.01, "front": "+y", "kind": "end"},
    "rva_duplex_02b": {"scale": 0.01, "front": "+y", "kind": "end"},
    "rva_house_01_brick_alternate": {"scale": 0.01, "front": "-y", "kind": "side"},
}

# Where the front must face once turned, in Blender's axes: the +X end, or
# the -Y side, which the exporter's Y-up conversion writes as glTF +Z.
TURN_TO = {"end": Vector((1, 0, 0)), "side": Vector((0, -1, 0))}

# Step 3: the shop's pictures, in pixels of its 1024 x 1024 base colour from
# the TOP-LEFT, as an image viewer shows them: the shop window's glass (the
# interior photograph and its posters) and the door's lower pane (the "OPEN"
# sign). Each is filled with #1590's glass: `three-renderer.ts`' dark room,
# (0.012, 0.014, 0.018) linear, under a pane that lightens upward by up to
# (0.03, 0.04, 0.05) -- the shop front's own shading, as a picture.
SHOP = "old_american_brick_shop"
SHOP_GLASS_BOXES = [(586, 640, 1003, 994), (366, 732, 551, 890)]
GLASS_ROOM = (0.012, 0.014, 0.018)
GLASS_PANE = (0.03, 0.04, 0.05)

# Step 4: the atlas. 4096 square holds the thirteen at about 4 cm a texel;
# one packing, a margin wide enough that a mipmap two levels down does not
# reach a neighbour.
ATLAS_PIXELS = 4096
ISLAND_MARGIN = 0.002
ANGLE_LIMIT_DEGREES = 66.0
BAKE_SAMPLES = 4
BAKE_MARGIN = 8
ATLAS_UV = "atlas"
# Step 5: a face narrower than this is no face, and is dissolved.
DEGENERATE_METRES = 1e-4


def srgb(linear):
    return 12.92 * linear if linear <= 0.0031308 else 1.055 * linear ** (1 / 2.4) - 0.055


def extent(obj):
    """The vertices' extent along X, Y and Z, read off the mesh itself: an
    object's `dimensions` is its cached bounds, stale after `data.transform`."""
    co = [v.co for v in obj.data.vertices]
    return Vector(
        (
            max(c.x for c in co) - min(c.x for c in co),
            max(c.y for c in co) - min(c.y for c in co),
            max(c.z for c in co) - min(c.z for c in co),
        )
    )


def triangles(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def colour_pictures(house):
    """The colour pictures a model's materials read: its `diffuse` (the RVA
    set's specular-glossiness) or its `baseColor` (the shop's)."""
    return sorted(
        {
            node.image
            for slot in house.material_slots
            if slot.material is not None and slot.material.use_nodes
            for node in slot.material.node_tree.nodes
            if node.type == "TEX_IMAGE"
            and node.image is not None
            and ("diffuse" in node.image.name or "baseColor" in node.image.name)
        },
        key=lambda image: image.name,
    )


def paint_glass(image):
    width, height = image.size
    pixels = list(image.pixels)
    for left, top, right, bottom in SHOP_GLASS_BOXES:
        for y in range(top, bottom):
            up = (bottom - 1 - y) / max(1, bottom - top - 1)
            colour = [srgb(GLASS_ROOM[c] + GLASS_PANE[c] * up) for c in range(3)]
            row = height - 1 - y
            for x in range(left, right):
                at = (row * width + x) * 4
                pixels[at : at + 3] = colour
    image.pixels[:] = pixels


bpy.ops.wm.read_factory_settings(use_empty=True)
houses = []
repeated = 0
for directory in SOURCE_DIRS:
    name = os.path.basename(directory.rstrip("/"))
    if name not in MODELS:
        raise SystemExit(f"{name}: not one of the house models")
    spec = MODELS[name]
    before = set(bpy.data.objects)
    repeated += import_scan(os.path.join(directory, "scene.gltf"))
    parts = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
    # Each part's whole placement -- its parents' too -- written into its
    # vertices, then the parents dropped: the files nest a mesh under a
    # Y-up and a scale node, and applying only an object's own transform
    # loses its parents'.
    for part in parts:
        world = part.matrix_world.copy()
        part.parent = None
        part.data.transform(world)
        part.matrix_world = Matrix.Identity(4)
    for empty in [o for o in bpy.data.objects if o not in before and o.type != "MESH"]:
        bpy.data.objects.remove(empty, do_unlink=True)
    bpy.ops.object.select_all(action="DESELECT")
    for part in parts:
        part.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    if len(parts) > 1:
        bpy.ops.object.join()
    house = bpy.context.view_layer.objects.active
    house.name = name
    # Steps 1 and 2: metres, turned, stood on the origin.
    facing = {"+x": Vector((1, 0, 0)), "-y": Vector((0, -1, 0)), "+y": Vector((0, 1, 0))}[
        spec["front"]
    ]
    target = TURN_TO[spec["kind"]]
    angle = math.atan2(target.y, target.x) - math.atan2(facing.y, facing.x)
    house.data.transform(Matrix.Rotation(angle, 4, "Z") @ Matrix.Scale(spec["scale"], 4))
    xs = [v.co.x for v in house.data.vertices]
    ys = [v.co.y for v in house.data.vertices]
    zs = [v.co.z for v in house.data.vertices]
    house.data.transform(
        Matrix.Translation(((min(xs) + max(xs)) / -2, (min(ys) + max(ys)) / -2, -min(zs)))
    )
    house.data.update()
    houses.append(house)

for house in houses:
    if extent(house).x < extent(house).y:
        raise SystemExit(f"{house.name}: its long axis is not X once turned")

# Step 3: the shop's photograph, painted over before anything reads it.
shop_pictures = colour_pictures(next(h for h in houses if h.name == SHOP))
if len(shop_pictures) != 1:
    raise SystemExit(f"{SHOP}: expected one base colour picture, found {len(shop_pictures)}")
paint_glass(shop_pictures[0])

# Step 4: one packing for all of them, into a coordinate set of its own.
bpy.ops.object.select_all(action="DESELECT")
for house in houses:
    layer = house.data.uv_layers.new(name=ATLAS_UV)
    house.data.uv_layers.active = layer
    house.select_set(True)
bpy.context.view_layer.objects.active = houses[0]
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(
    angle_limit=math.radians(ANGLE_LIMIT_DEGREES),
    island_margin=ISLAND_MARGIN,
    area_weight=0.0,
    correct_aspect=True,
    scale_to_bounds=False,
)
# Smart UV Project's own packing leaves most of a shared square empty when
# it packs thirteen objects' islands at once; a second pack of them all, by
# their bounding boxes and turned to fit, fills it.
bpy.ops.uv.select_all(action="SELECT")
bpy.ops.uv.pack_islands(
    udim_source="CLOSEST_UDIM",
    rotate=True,
    rotate_method="CARDINAL",
    scale=True,
    merge_overlap=False,
    margin_method="FRACTION",
    margin=ISLAND_MARGIN,
    shape_method="AABB",
)
bpy.ops.object.mode_set(mode="OBJECT")

report = {"repeatedTrianglesDropped": repeated}

if WHICH == "atlas":
    atlas = bpy.data.images.new("house_models_atlas", ATLAS_PIXELS, ATLAS_PIXELS, alpha=False)
    # Each model's colour picture, and nothing else of its material, read
    # through its ORIGINAL coordinates into an emission the bake copies: the
    # imported materials are specular-glossiness and blended, and what their
    # shading would add is not a colour.
    for house in houses:
        pictures = colour_pictures(house)
        if len(pictures) != 1:
            raise SystemExit(f"{house.name}: expected one colour picture, found {len(pictures)}")
        material = bpy.data.materials.new(f"{house.name}_bake")
        material.use_nodes = True
        nodes, links = material.node_tree.nodes, material.node_tree.links
        nodes.clear()
        coordinates = nodes.new("ShaderNodeUVMap")
        coordinates.uv_map = house.data.uv_layers[0].name
        picture = nodes.new("ShaderNodeTexImage")
        picture.image = pictures[0]
        emission = nodes.new("ShaderNodeEmission")
        output = nodes.new("ShaderNodeOutputMaterial")
        links.new(coordinates.outputs["UV"], picture.inputs["Vector"])
        links.new(picture.outputs["Color"], emission.inputs["Color"])
        links.new(emission.outputs["Emission"], output.inputs["Surface"])
        target = nodes.new("ShaderNodeTexImage")
        target.image = atlas
        nodes.active = target
        house.data.materials.clear()
        house.data.materials.append(material)
    scene = bpy.context.scene
    # ⚠️ ONE thread and a fixed seed, `process_rock.py`'s reason: `--check`.
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.render.threads_mode = "FIXED"
    scene.render.threads = 1
    scene.cycles.use_adaptive_sampling = False
    scene.cycles.samples = BAKE_SAMPLES
    scene.cycles.seed = 1585
    bake = scene.render.bake
    bake.margin = BAKE_MARGIN
    bake.target = "IMAGE_TEXTURES"
    bpy.ops.object.select_all(action="DESELECT")
    for house in houses:
        house.select_set(True)
    bpy.context.view_layer.objects.active = houses[0]
    bpy.ops.object.bake(type="EMIT")
    atlas.filepath_raw = OUT
    atlas.file_format = "PNG"
    atlas.save()
    report["pixels"] = [ATLAS_PIXELS, ATLAS_PIXELS]
    report["models"] = len(houses)
else:
    house = next((h for h in houses if h.name == WHICH), None)
    if house is None:
        raise SystemExit(f"{WHICH}: not one of the house models")
    for other in houses:
        if other is not house:
            bpy.data.objects.remove(other, do_unlink=True)
    # One at a time, looked up afresh: removing a layer moves the others.
    for name in [layer.name for layer in house.data.uv_layers if layer.name != ATLAS_UV]:
        house.data.uv_layers.remove(house.data.uv_layers[name])
    house.data.materials.clear()
    house.data.materials.append(bpy.data.materials.new("house_models_atlas"))
    for attribute in [a for a in house.data.color_attributes]:
        house.data.color_attributes.remove(attribute)
    bpy.ops.object.select_all(action="DESELECT")
    house.select_set(True)
    bpy.context.view_layer.objects.active = house
    bpy.ops.object.modifier_add(type="TRIANGULATE")
    bpy.ops.object.modifier_apply(modifier=house.modifiers[-1].name)
    # Flat, from each face: a house is planes, and the files' own split
    # normals made the export vary from run to run -- a corner shared by a
    # face of no area has no normal of its own, and which neighbour's it took
    # moved between runs (seen 2026-10-23, one vertex in 2 605).
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.dissolve_degenerate(threshold=DEGENERATE_METRES)
    bpy.ops.object.mode_set(mode="OBJECT")
    if house.data.has_custom_normals:
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
    for polygon in house.data.polygons:
        polygon.use_smooth = False
    dims = extent(house)
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format="GLB",
        use_selection=True,
        export_materials="PLACEHOLDER",
        export_vertex_color="NONE",
        export_extras=False,
        export_yup=True,
    )
    report.update(
        {
            "triangles": triangles(house),
            # glTF's axes: X along, Z across, Y up.
            "lengthMetres": round(dims.x, 4),
            "depthMetres": round(dims.y, 4),
            "heightMetres": round(dims.z, 4),
            "front": MODELS[WHICH]["kind"],
        }
    )

with open(OUT_REPORT, "w") as handle:
    json.dump(report, handle, indent=2, sort_keys=True)
print("REPORT", json.dumps(report, sort_keys=True))
