# SPDX-License-Identifier: AGPL-3.0-or-later
"""
The facade pieces a mapped footprint in a town is wrapped in -- #3334, the
owner's direction of 2026-11-26 on it: twelve pieces of Quaternius's CC0
Downtown City MegaKit, in ONE GLB and mapped into ONE colour atlas, so every
wrapped building costs one draw call between them (`src/game/facade-kit.ts`).

Run by `process-assets.ts`, never by hand:

    Blender -b --factory-startup --python process_downtown_kit.py -- \
        <source-dir> <out.glb> <report.json> <atlas.png> <atlas-pixels> \
        <margin-pixels> <piece>...

`<atlas.png>` is written beside `<out.glb>`. Each `<piece>` is
`id|Source|metres wide|metres tall|x|y|width|height|lies`: the name it ships
under, its file in the kit's glTF export, the rectangle its bay is, its cell
of the atlas in pixels from the TOP-LEFT, and `1` where the kit models it
lying flat (the roof). The cells are `facade-kit.ts` section kitCells', so the
pipeline and the renderer read one layout.

1. Import each piece's glTF through `gltf_import.py`, and write its node's
   placement into its vertices. Blender's axes: the wall's face is the plane
   y = 0, its outside is -Y, X runs along it and Z up it.
2. Drop the faces nobody outside a building sees: the kit's `MI_InteriorWall`
   (the wall's inner face), `MI_FakeInterior` (a plane behind the glass that
   the kit's own shader draws a room on, which no shader here does),
   `MI_InteriorFloor` and `MI_InteriorRoof`.
3. A piece that lies flat is stood up, its top turned to face -Y, so that it
   is baked like a wall. The door frame's opening is closed with a pane of
   glass behind it: the kit hangs a separate door there, which is not taken.
4. One new texture-coordinate set a piece: every corner projected straight
   onto the wall's plane, into the piece's cell. So the piece in relief and a
   flat card of its rectangle wear the same texels.
5. Each piece's colour baked into its cell with Cycles, from the piece onto a
   card of its rectangle (selected to active), as an emission read through the
   kit's own coordinates: colour only, no light. The kit's pictures repeat and
   are shared by every piece, which one atlas cell cannot do; the bake is what
   makes the twelve one material. Glass is one flat colour, #1590's dark pane.
6. Drop every material, the kit's own coordinates and its vertex colours,
   triangulate, dissolve faces of no area, shade every face flat, and export
   the GLB: one mesh a piece, named by its id.

ADR 0026 D-5: every choice is a constant here or an argument `sources.ts`
states, the inputs are pinned by `inputs.lock.json` and the tool by
`sources.ts` section PINNED_BLENDER.
"""

import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix

# ⚠️ No bytecode, as `process_rock.py` imports its helper.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gltf_import import gltf_document, import_scan  # noqa: E402

args = sys.argv[sys.argv.index("--") + 1 :]
SOURCE_DIR, OUT, OUT_REPORT, ATLAS_NAME = args[:4]
ATLAS_PIXELS = int(args[4])
MARGIN_PIXELS = int(args[5])
PIECES = []
for spec in args[6:]:
    name, source, wide, tall, x, y, width, height, lies = spec.split("|")
    PIECES.append(
        {
            "id": name,
            "source": source,
            "wide": float(wide),
            "tall": float(tall),
            "cell": (int(x), int(y), int(width), int(height)),
            "lies": lies == "1",
        }
    )

# Where the kit's glTF export is, inside its archive.
EXPORT = "Exports/glTF (Godot)"
# Step 2: the materials whose faces are dropped.
UNSEEN = ("MI_InteriorWall", "MI_FakeInterior", "MI_InteriorFloor", "MI_InteriorRoof")
# Step 3 and 5: glass, as a colour (linear): #1590's dark room under a pane.
GLASS = (0.027, 0.034, 0.043)
GLASS_MATERIAL = "MI_Glass"
# Step 3: the piece whose opening is closed, and how far behind the wall's
# face the pane stands, metres: where the kit's own glass is in its frame.
CLOSED = "DoorFrame_Metal_Single"
PANE_BEHIND = 0.07
# Step 5: how far before the wall's face the bake's rays start, metres --
# past every piece's relief -- and how far they reach behind it.
CAGE_METRES = 0.3
RAY_METRES = 1.0
BAKE_SAMPLES = 4
ATLAS_UV = "atlas"
# Step 6: a face narrower than this is no face, and is dissolved.
DEGENERATE_METRES = 1e-4
# A piece's relief may stand this far outside its bay's rectangle: a sill's
# or a frame's overhang, clamped into the cell.
OVERHANG_METRES = 0.2


def triangles(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def base_colours(path):
    """Each material's base colour picture, by the material's name, read from
    the glTF itself: the importer's node tree multiplies the picture by the
    kit's vertex colours, which are its own shader's wear masks, not colour."""
    document = gltf_document(path)
    pictures = {}
    for material in document.get("materials", []):
        texture = material.get("pbrMetallicRoughness", {}).get("baseColorTexture")
        if texture is None:
            pictures[material["name"]] = None
            continue
        if texture.get("texCoord", 0) != 0:
            raise SystemExit(f"{path}: {material['name']} reads a second coordinate set")
        source = document["textures"][texture["index"]]["source"]
        pictures[material["name"]] = document["images"][source]["uri"]
    return pictures


def emission(name, picture, uv_map):
    """A material that emits `picture` through `uv_map`, or the glass colour."""
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    emit = nodes.new("ShaderNodeEmission")
    output = nodes.new("ShaderNodeOutputMaterial")
    links.new(emit.outputs["Emission"], output.inputs["Surface"])
    if picture is None:
        emit.inputs["Color"].default_value = (*GLASS, 1.0)
    else:
        coordinates = nodes.new("ShaderNodeUVMap")
        coordinates.uv_map = uv_map
        image = nodes.new("ShaderNodeTexImage")
        image.image = picture
        links.new(coordinates.outputs["UV"], image.inputs["Vector"])
        links.new(image.outputs["Color"], emit.inputs["Color"])
    return material


def cell_uv(piece, x, z):
    """The wall-plane point (x along, z up) of `piece`, in its cell, as
    Blender's coordinates (v up from the picture's bottom)."""
    left, top, width, height = piece["cell"]
    along = min(1.0, max(0.0, x / piece["wide"] + 0.5))
    up = min(1.0, max(0.0, z / piece["tall"]))
    return (
        (left + along * width) / ATLAS_PIXELS,
        1.0 - (top + (1.0 - up) * height) / ATLAS_PIXELS,
    )


def quad(name, piece, y):
    """A rectangle of the piece's bay on the plane y, facing -Y."""
    half = piece["wide"] / 2
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(
        [(-half, y, 0.0), (half, y, 0.0), (half, y, piece["tall"]), (-half, y, piece["tall"])],
        [],
        [(0, 1, 2, 3)],
    )
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


bpy.ops.wm.read_factory_settings(use_empty=True)
report = {"each": {}, "pixels": [ATLAS_PIXELS, ATLAS_PIXELS]}
repeated = 0
made = []
for piece in PIECES:
    path = os.path.join(SOURCE_DIR, EXPORT, piece["source"] + ".gltf")
    before = set(bpy.data.objects)
    repeated += import_scan(path)
    parts = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
    if len(parts) != 1:
        raise SystemExit(f"{piece['source']}: expected one mesh, found {len(parts)}")
    obj = parts[0]
    # Step 1: its whole placement written into its vertices.
    world = obj.matrix_world.copy()
    obj.parent = None
    obj.data.transform(world)
    obj.matrix_world = Matrix.Identity(4)
    for empty in [o for o in bpy.data.objects if o not in before and o.type != "MESH"]:
        bpy.data.objects.remove(empty, do_unlink=True)
    obj.name = piece["id"]
    obj.data.name = piece["id"]
    source_triangles = triangles(obj)

    # Step 2: the faces nobody outside sees.
    names = [slot.material.name.split(".")[0] for slot in obj.material_slots]
    work = bmesh.new()
    work.from_mesh(obj.data)
    unseen = [face for face in work.faces if names[face.material_index] in UNSEEN]
    bmesh.ops.delete(work, geom=unseen, context="FACES")
    work.to_mesh(obj.data)
    work.free()

    # Step 3: stood up, where it lies flat; its foot on z = 0 and its face on y = 0.
    if piece["lies"]:
        obj.data.transform(Matrix.Rotation(math.radians(90), 4, "X"))
        zs = [v.co.z for v in obj.data.vertices]
        ys = [v.co.y for v in obj.data.vertices]
        obj.data.transform(Matrix.Translation((0.0, -min(ys), -min(zs))))
    obj.data.update()
    xs = [v.co.x for v in obj.data.vertices]
    zs = [v.co.z for v in obj.data.vertices]
    ys = [v.co.y for v in obj.data.vertices]
    half = piece["wide"] / 2 + OVERHANG_METRES
    if min(xs) < -half or max(xs) > half or min(zs) < -OVERHANG_METRES:
        raise SystemExit(f"{piece['id']}: it stands outside its bay")
    if max(zs) > piece["tall"] + OVERHANG_METRES or -min(ys) > CAGE_METRES:
        raise SystemExit(f"{piece['id']}: it stands outside its bay")

    # Step 5's materials, made before the kit's are dropped: each the kit's
    # own colour picture through the kit's own coordinates.
    pictures = base_colours(path)
    kit_uv = obj.data.uv_layers[0].name
    # ⚠️ Each slot is given its material in place: clearing the slots first
    # would put every face in slot 0, and the whole piece in its first picture.
    for index, name in enumerate(names):
        uri = pictures.get(name)
        picture = None
        if uri is not None:
            picture = bpy.data.images.load(
                os.path.join(SOURCE_DIR, EXPORT, uri), check_existing=True
            )
        elif name != GLASS_MATERIAL and name not in UNSEEN:
            # An unseen material's slot is left with no face, and wears anything.
            raise SystemExit(f"{piece['id']}: {name} has no colour picture")
        obj.data.materials[index] = emission(f"{piece['id']}_{index}_bake", picture, kit_uv)

    # Step 3: the door frame's opening, closed with a pane.
    if piece["source"] == CLOSED:
        pane = quad(f"{piece['id']}_pane", piece, PANE_BEHIND)
        pane.data.materials.append(emission(f"{piece['id']}_pane_bake", None, kit_uv))
        # The kit's coordinate set on the pane too, so the join keeps one set of that name.
        pane.data.uv_layers.new(name=kit_uv)
        bpy.ops.object.select_all(action="DESELECT")
        pane.select_set(True)
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.join()
        obj = bpy.context.view_layer.objects.active

    # Step 4: the projection onto the wall's plane, into the piece's cell.
    layer = obj.data.uv_layers.new(name=ATLAS_UV)
    for loop in obj.data.loops:
        co = obj.data.vertices[loop.vertex_index].co
        layer.data[loop.index].uv = cell_uv(piece, co.x, co.z)
    made.append((piece, obj, source_triangles))

# Step 5: one atlas, a bake a piece, each from the piece onto its card.
atlas = bpy.data.images.new("downtown_kit_atlas", ATLAS_PIXELS, ATLAS_PIXELS, alpha=False)
scene = bpy.context.scene
# ⚠️ ONE thread and a fixed seed, `process_rock.py`'s reason: `--check`.
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.render.threads_mode = "FIXED"
scene.render.threads = 1
scene.cycles.use_adaptive_sampling = False
scene.cycles.samples = BAKE_SAMPLES
scene.cycles.seed = 3334
bake = scene.render.bake
bake.margin = MARGIN_PIXELS
bake.margin_type = "EXTEND"
bake.target = "IMAGE_TEXTURES"
bake.use_selected_to_active = True
bake.use_cage = False
bake.cage_extrusion = CAGE_METRES
bake.max_ray_distance = RAY_METRES
for index, (piece, obj, _) in enumerate(made):
    card = quad(f"{piece['id']}_card", piece, 0.0)
    card_layer = card.data.uv_layers.new(name=ATLAS_UV)
    for loop in card.data.loops:
        co = card.data.vertices[loop.vertex_index].co
        card_layer.data[loop.index].uv = cell_uv(piece, co.x, co.z)
    target_material = bpy.data.materials.new(f"{piece['id']}_card")
    target_material.use_nodes = True
    target = target_material.node_tree.nodes.new("ShaderNodeTexImage")
    target.image = atlas
    target_material.node_tree.nodes.active = target
    card.data.materials.append(target_material)
    # Every other piece out of the rays' way: they all stand on the origin.
    for _, other, _ in made:
        other.hide_render = other is not obj
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    card.select_set(True)
    bpy.context.view_layer.objects.active = card
    bake.use_clear = index == 0
    bpy.ops.object.bake(type="EMIT")
    bpy.data.objects.remove(card, do_unlink=True)
for _, obj, _ in made:
    obj.hide_render = False
atlas.filepath_raw = os.path.join(os.path.dirname(OUT), ATLAS_NAME)
atlas.file_format = "PNG"
atlas.save()

# Step 6: geometry and the atlas's coordinates only.
placeholder = bpy.data.materials.new("downtown_kit_atlas")
for piece, obj, source_triangles in made:
    for name in [layer.name for layer in obj.data.uv_layers if layer.name != ATLAS_UV]:
        obj.data.uv_layers.remove(obj.data.uv_layers[name])
    obj.data.materials.clear()
    obj.data.materials.append(placeholder)
    for attribute in [a for a in obj.data.color_attributes]:
        obj.data.color_attributes.remove(attribute)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_add(type="TRIANGULATE")
    bpy.ops.object.modifier_apply(modifier=obj.modifiers[-1].name)
    # Flat, from each face, `process_house_models.py`'s reason: the files' own
    # split normals made that export vary from run to run.
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.dissolve_degenerate(threshold=DEGENERATE_METRES)
    bpy.ops.object.mode_set(mode="OBJECT")
    if obj.data.has_custom_normals:
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
    for polygon in obj.data.polygons:
        polygon.use_smooth = False
    ys = [v.co.y for v in obj.data.vertices]
    report["each"][piece["id"]] = {
        "triangles": triangles(obj),
        "sourceTriangles": source_triangles,
        # How far its relief stands before the wall's face, and behind it.
        "beforeMetres": round(max(0.0, -min(ys)), 4),
        "behindMetres": round(max(0.0, max(ys)), 4),
    }
# What `--check` holds a run to (`sources.ts` section EXPECTED_REPORTS).
report.update(
    {
        "pieces": len(made),
        "triangles": sum(each["triangles"] for each in report["each"].values()),
        "sourceTriangles": sum(each["sourceTriangles"] for each in report["each"].values()),
        "repeatedTrianglesDropped": repeated,
    }
)

bpy.ops.object.select_all(action="DESELECT")
for _, obj, _ in made:
    obj.select_set(True)
bpy.context.view_layer.objects.active = made[0][1]
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    use_selection=True,
    export_materials="PLACEHOLDER",
    export_vertex_color="NONE",
    export_extras=False,
    export_yup=True,
)

with open(OUT_REPORT, "w") as handle:
    json.dump(report, handle, indent=2, sort_keys=True)
print("REPORT", json.dumps(report, sort_keys=True))
