# SPDX-License-Identifier: AGPL-3.0-or-later
"""
One photoscanned rock, cut down to what a phone can draw -- #430, #474.

Run by `process-assets.ts`, never by hand:

    Blender -b --factory-startup --python process_rock.py -- \
        <in.gltf> <out.glb> <report.json> <object> <target-tris>

A rock is the easy case the tree script is not: its silhouette is its whole
shape and it has no cards to lose, so a collapse-decimate is the right tool.
The scan's normal map keeps the surface the decimation took away.

1. Import the glTF, keep ONE object, stand it on the origin.
2. Collapse-decimate to <target-tris>.
3. Drop the roughness/metalness/occlusion map (the runtime uses a constant
   roughness) and downsize the colour and normal maps to TEXTURE_PIXELS.
4. Export a GLB.

ADR 0026 D-5: every choice is an argument or a constant here, the input is
pinned by `inputs.lock.json` and the tool by `sources.ts` section PINNED_BLENDER.
"""

import json
import sys

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1 :]
IN_GLTF, OUT_GLB, OUT_REPORT, OBJECT = args[:4]
TARGET_TRIS = int(args[4])
# The same ceiling the tree script uses; `realistic-budget.ts` holds it.
TEXTURE_PIXELS = 512


def triangles(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=IN_GLTF)
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
}
with open(OUT_REPORT, "w") as handle:
    json.dump(report, handle, indent=2, sort_keys=True)
print("REPORT", json.dumps(report, sort_keys=True))
