# SPDX-License-Identifier: AGPL-3.0-or-later
"""
One photoscanned rock, cut down to what a phone can draw -- #430, #474.

Run by `process-assets.ts`, never by hand:

    Blender -b --factory-startup --python process_rock.py -- \
        <in.gltf> <out.glb> <report.json> <object> <target-tris>

A rock is the easy case the tree script is not: its silhouette is its whole
shape and it has no cards to lose, so a collapse-decimate is the right tool.
The scan's normal map keeps the surface the decimation took away.

1. Import the glTF through `gltf_import.py` (#696's stable rule for a
   repeated triangle, and its guard), keep ONE object, stand it on the origin.
2. Collapse-decimate to <target-tris>.
3. Bake ambient occlusion into a colour attribute with Cycles -- #620, the
   same bake `process_tree.py` step 6 makes, with a ground plane under the
   rock for the bake alone, so its foot and the crevices between its lobes
   are dark for nothing at runtime. Until #620 a boulder was uniformly lit.
4. Drop the roughness/metalness/occlusion map (the runtime uses a constant
   roughness, and the occlusion is now in the vertices) and downsize the
   colour and normal maps to TEXTURE_PIXELS. The baked colour is exported as
   COLOR_0 because it is the ACTIVE colour attribute; no node reads it (see
   step 4's note on the bytes that saves).
5. Export a GLB.

## Why a Cycles bake and not the scan's own occlusion map

The scan's map is a texture over the scan's UVs; carrying it to the vertices
is a bake too (an emission bake of the map), and it knows nothing about the
ground the rock stands on -- which is the occlusion #620 is about. The AO bake
sees both. The decimated rock has 2 400 triangles over under two metres, so a
vertex colour is a few centimetres apart: fine enough for a contact shadow and
the gaps between lobes, and it costs no texture at all.

ADR 0026 D-5: every choice is an argument or a constant here, the input is
pinned by `inputs.lock.json` and the tool by `sources.ts` section PINNED_BLENDER.
"""

import json
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

# The one glTF import, beside this file. ⚠️ No bytecode, as `process_rider.py`
# imports its kit: a `__pycache__` beside it is a binary `ASSET001` refuses.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gltf_import import import_scan  # noqa: E402

args = sys.argv[sys.argv.index("--") + 1 :]
IN_GLTF, OUT_GLB, OUT_REPORT, OBJECT = args[:4]
TARGET_TRIS = int(args[4])
# The same ceiling the tree script uses; `realistic-budget.ts` holds it.
TEXTURE_PIXELS = 512
# #620: how far the occlusion bake looks, in metres of the scan. About half the
# boulder's own height (it is 1.0 m tall before the runtime fits it), so a
# lobe darkens its neighbour and the foot darkens against the ground, while
# the top of the rock, which sees the whole sky, stays at 1. `process_tree.py`
# uses 1.5 m for a canopy several metres across.
AO_DISTANCE = 0.5
# The ground plane the bake sees and the export does not: wide enough that
# every ray leaving the rock's foot sideways within AO_DISTANCE meets it.
AO_GROUND_METRES = 8.0


def triangles(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


bpy.ops.wm.read_factory_settings(use_empty=True)
# Through `gltf_import.py`, as `process_tree.py` imports a plant: no rock
# input holds a repeated triangle today, so nothing is dropped, and the guard
# there stops the run if `mesh.validate()` ever drops one of its own choosing.
repeated_triangles = import_scan(IN_GLTF)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
keep = [o for o in meshes if o.name == OBJECT]
if len(keep) != 1:
    raise SystemExit(f"expected one object named {OBJECT}: {[o.name for o in meshes]}")
for obj in bpy.data.objects:
    if obj not in keep:
        bpy.data.objects.remove(obj, do_unlink=True)
rock = keep[0]
bpy.context.view_layer.objects.active = rock
rock.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
source_tris = triangles(rock)

corners = [rock.matrix_world @ Vector(c) for c in rock.bound_box]
low_z = min(c.z for c in corners)
mid_x = sum(c.x for c in corners) / 8
mid_y = sum(c.y for c in corners) / 8
for vertex in rock.data.vertices:
    vertex.co -= Vector((mid_x, mid_y, low_z))
rock.data.update()

# glTF splits a vertex wherever its texture coordinates do, so the imported
# mesh is thousands of islands a collapse cannot merge across -- a first run
# stopped at 26 616 of the 2 400 triangles asked for. Welding positions keeps
# the per-corner coordinates (Blender stores those on the loops) and gives the
# collapse one surface to work on.
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.remove_doubles(threshold=1e-5)
bpy.ops.object.mode_set(mode="OBJECT")
bpy.ops.object.modifier_add(type="TRIANGULATE")
bpy.ops.object.modifier_apply(modifier=rock.modifiers[-1].name)
if triangles(rock) > TARGET_TRIS:
    modifier = rock.modifiers.new("collapse", "DECIMATE")
    modifier.ratio = TARGET_TRIS / triangles(rock)
    bpy.ops.object.modifier_apply(modifier="collapse")

# --- 3. bake ambient occlusion into a colour attribute (#620) ---------------------
scene = bpy.context.scene
# ⚠️ ONE thread, no adaptive sampling, a fixed seed: `process_tree.py` says why
# (Cycles sums samples in whatever order its threads finish), and `--check`
# re-makes this file byte for byte only on one thread.
scene.render.threads_mode = "FIXED"
scene.render.threads = 1
scene.cycles.use_adaptive_sampling = False
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 64
scene.cycles.seed = 620
if scene.world is None:
    scene.world = bpy.data.worlds.new("world")
scene.world.light_settings.distance = AO_DISTANCE
bpy.ops.mesh.primitive_plane_add(size=AO_GROUND_METRES, location=(0.0, 0.0, 0.0))
ground = bpy.context.active_object
# ⚠️ Per VERTEX, not per corner as `process_tree.py` bakes a plant. glTF has
# one colour a vertex, so a corner attribute makes the exporter split every
# vertex whose corners differ: the first run of this bake turned the rock's
# 2 103 vertices into 4 095 and its 206 020 bytes into 319 048. A vertex bake
# averages its corners and adds one COLOR_0 and nothing else (16 984 bytes, as
# step 4 exports it).
attribute = rock.data.color_attributes.new("ao", "BYTE_COLOR", "POINT")
rock.data.color_attributes.active_color = attribute
scene.render.bake.target = "VERTEX_COLORS"
bpy.ops.object.select_all(action="DESELECT")
rock.select_set(True)
bpy.context.view_layer.objects.active = rock
bpy.ops.object.bake(type="AO")
ground_mesh = ground.data
bpy.data.objects.remove(ground, do_unlink=True)
bpy.data.meshes.remove(ground_mesh)
ao = np.empty(len(attribute.data) * 4, dtype=np.float32)
attribute.data.foreach_get("color", ao)
channel = ao.reshape(-1, 4)[:, 0] if len(ao) else np.ones(1, dtype=np.float32)
mean_ao = float(channel.mean())
darkest_ao = float(channel.min())

# --- 4. materials: drop the packed maps, wire the occlusion in, shrink images ----
for slot in rock.material_slots:
    material = slot.material
    if material is None or not material.use_nodes:
        continue
    nodes, links = material.node_tree.nodes, material.node_tree.links
    shader = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
    if shader is None:
        continue
    for name in ("Roughness", "Metallic"):
        for link in list(shader.inputs[name].links):
            links.remove(link)
    shader.inputs["Roughness"].default_value = 0.9
    shader.inputs["Metallic"].default_value = 0.0
    # ⚠️ NO node reads the "ao" attribute, on purpose. The exporter's
    # `export_vertex_color="ACTIVE"` writes the active colour attribute as
    # COLOR_0 anyway, and glTF multiplies COLOR_0 into the base colour by
    # definition. Wired through a node, Blender 4.4.3 exports it as FLOAT
    # VEC3 (12 bytes a vertex); unwired, it takes its ACTIVE path, adds the
    # alpha and exports the BYTE_COLOR attribute as normalized UNSIGNED_SHORT
    # VEC4 (8 bytes a vertex). An UNSIGNED_BYTE colour is not something this
    # exporter writes for a real attribute (#686's review asked), and a
    # post-export rewrite of the file is a step ADR 0026 D-5 does not have.
    for node in nodes:
        for socket in node.inputs:
            if socket.name == "Occlusion":
                for link in list(socket.links):
                    links.remove(link)
    changed = True
    while changed:
        changed = False
        for node in list(nodes):
            if node.type in ("OUTPUT_MATERIAL", "BSDF_PRINCIPLED"):
                continue
            if not any(output.links for output in node.outputs):
                nodes.remove(node)
                changed = True

images = []
for image in bpy.data.images:
    if image.users == 0 or image.size[0] == 0:
        continue
    side = max(image.size[0], image.size[1])
    if side > TEXTURE_PIXELS:
        factor = TEXTURE_PIXELS / side
        image.scale(max(1, round(image.size[0] * factor)), max(1, round(image.size[1] * factor)))
    images.append([image.name, image.size[0], image.size[1]])

dims = rock.dimensions.copy()
# The size the runtime fits the rock by, recorded in the file for the reason
# `process_tree.py` records a plant's: one rule for every realistic model.
rock["oyl_scan_height"] = dims.z
rock["oyl_scan_width"] = max(dims.x, dims.y)
bpy.ops.object.select_all(action="DESELECT")
rock.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=OUT_GLB,
    export_format="GLB",
    use_selection=True,
    export_vertex_color="ACTIVE",
    export_all_vertex_colors=False,
    export_image_format="AUTO",
    export_jpeg_quality=85,
    export_extras=True,
    export_yup=True,
)
report = {
    "sourceTriangles": source_tris,
    "triangles": triangles(rock),
    "heightMetres": dims.z,
    "widthMetres": max(dims.x, dims.y),
    "images": sorted(images),
    "materials": len(rock.material_slots),
    "meanAmbientOcclusion": mean_ao,
    "darkestAmbientOcclusion": darkest_ao,
    "repeatedTrianglesDropped": repeated_triangles,
}
with open(OUT_REPORT, "w") as handle:
    json.dump(report, handle, indent=2, sort_keys=True)
print("REPORT", json.dumps(report, sort_keys=True))
