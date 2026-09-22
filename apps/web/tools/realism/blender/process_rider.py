# SPDX-License-Identifier: AGPL-3.0-or-later
"""
The placeholder realistic rider's BODY: MakeHuman's CC0 base mesh, rigged with
its own default skeleton and weights, cut down for a phone -- #457 (4).

Run by `process-assets.ts`, never by hand:

    Blender -b --factory-startup --python process_rider.py -- \
        <makehuman-dir> <out.glb> <report.json> <target-tris>

MakeHuman is not needed and not run: the three files it ships its assets in
are plain text -- `base.obj` (the mesh, with its helper geometry), the
skeleton `default.mhskel` (JSON; a joint is the mean of a list of helper
vertices) and the weights `default_weights.mhw` (JSON; bone -> [[vertex,
weight]]) -- and all three index the SAME vertex list, which is why the OBJ is
parsed here rather than imported: Blender's importer renumbers vertices.

What it does:

1. Parse the OBJ: every vertex, and the faces of the `body` group only (the
   `helper-*` and `joint-*` groups are scaffolding).
2. Build the joints from `default.mhskel`, and REDUCE the skeleton from 163
   bones (fingers, toes, face, twist bones) to the {@link KEEP} set a pedalling
   rider needs. A dropped bone's weights go to its nearest kept ancestor, so
   no vertex loses its influence.
3. Colour by dominant bone -- jersey, bib shorts, skin, shoes -- into a vertex
   colour, so the body needs no texture at all.
4. Delete the helper vertices, collapse-decimate to <target-tris>, and export
   a skinned GLB in MakeHuman's rest pose.

It does NOT pose the body onto the bicycle. That is done at runtime by
`browser/realism/rider.ts`, which aims each kept bone at the joint positions
`src/game/bicycle.ts` already computes -- the hip on the saddle, the hands on
the hoods, and each knee and foot from `legBones(crankAngle)`. One source for
where a leg is, rather than a pose baked here that `bicycle.ts` could drift
from.
"""

import json
import os
import sys

import bmesh
import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1 :]
MH_DIR, OUT_GLB, OUT_REPORT = args[:3]
TARGET_TRIS = int(args[3])
# MakeHuman's unit is the decimetre.
UNIT = 0.1

# The bones a rider on a bicycle is posed with, and their parents in the
# reduced skeleton. Everything else merges into its nearest kept ancestor.
KEEP = [
    "root",
    "spine05", "spine04", "spine03", "spine02", "spine01",
    "neck01", "head",
    "clavicle.L", "upperarm01.L", "lowerarm01.L", "wrist.L",
    "clavicle.R", "upperarm01.R", "lowerarm01.R", "wrist.R",
    "pelvis.L", "upperleg01.L", "lowerleg01.L", "foot.L",
    "pelvis.R", "upperleg01.R", "lowerleg01.R", "foot.R",
]

# Which garment a bone's dominant vertices wear. Linear sRGB-ish, 0-1.
JERSEY = (0.08, 0.22, 0.55, 1.0)
BIB = (0.03, 0.03, 0.035, 1.0)
SKIN = (0.72, 0.52, 0.42, 1.0)
SHOE = (0.9, 0.9, 0.9, 1.0)
GARMENT = {
    "root": BIB, "pelvis.L": BIB, "pelvis.R": BIB,
    "upperleg01.L": BIB, "upperleg01.R": BIB,
    "lowerleg01.L": SKIN, "lowerleg01.R": SKIN,
    "foot.L": SHOE, "foot.R": SHOE,
    "spine05": BIB, "spine04": JERSEY, "spine03": JERSEY, "spine02": JERSEY, "spine01": JERSEY,
    "clavicle.L": JERSEY, "clavicle.R": JERSEY,
    "upperarm01.L": JERSEY, "upperarm01.R": JERSEY,
    "lowerarm01.L": SKIN, "lowerarm01.R": SKIN,
    "wrist.L": SKIN, "wrist.R": SKIN,
    "neck01": SKIN, "head": SKIN,
}


def mh(path):
    return os.path.join(MH_DIR, path)


bpy.ops.wm.read_factory_settings(use_empty=True)

# --- 1. parse the OBJ ---------------------------------------------------------
positions, uvs, faces = [], [], []
group = None
with open(mh("base.obj")) as handle:
    for line in handle:
        if line.startswith("v "):
            _, x, y, z = line.split()[:4]
            # MakeHuman is Y-up, facing +Z; Blender is Z-up. (x, y, z) -> (x, -z, y).
            positions.append(Vector((float(x) * UNIT, -float(z) * UNIT, float(y) * UNIT)))
        elif line.startswith("vt "):
            uvs.append(tuple(float(v) for v in line.split()[1:3]))
        elif line.startswith("g "):
            group = line.split()[1]
        elif line.startswith("f ") and group == "body":
            corners = [c.split("/") for c in line.split()[1:]]
            faces.append(
                ([int(c[0]) - 1 for c in corners], [int(c[1]) - 1 if len(c) > 1 and c[1] else None for c in corners])
            )

mesh = bpy.data.meshes.new("rider")
mesh.from_pydata([tuple(p) for p in positions], [], [f[0] for f in faces])
uv_layer = mesh.uv_layers.new(name="uv")
loop = 0
for _, uv_indices in faces:
    for index in uv_indices:
        if index is not None:
            uv_layer.data[loop].uv = uvs[index]
        loop += 1
body = bpy.data.objects.new("rider", mesh)
bpy.context.scene.collection.objects.link(body)

# --- 2. the skeleton, reduced -------------------------------------------------
skeleton = json.load(open(mh("default.mhskel")))
bones = skeleton["bones"]


def joint(name):
    indices = skeleton["joints"][name]
    return sum((positions[i] for i in indices), Vector()) / len(indices)


def kept_ancestor(name):
    while name is not None and name not in KEEP:
        name = bones[name]["parent"]
    return name


armature_data = bpy.data.armatures.new("skeleton")
armature = bpy.data.objects.new("skeleton", armature_data)
bpy.context.scene.collection.objects.link(armature)
bpy.context.view_layer.objects.active = armature
bpy.ops.object.mode_set(mode="EDIT")
edit = {}
for name in KEEP:
    bone = armature_data.edit_bones.new(name)
    bone.head = joint(bones[name]["head"])
    bone.tail = joint(bones[name]["tail"])
    if (bone.tail - bone.head).length < 1e-4:
        bone.tail = bone.head + Vector((0, 0, 0.05))
    edit[name] = bone
for name in KEEP:
    parent = kept_ancestor(bones[name]["parent"])
    if parent is not None:
        edit[name].parent = edit[parent]
bpy.ops.object.mode_set(mode="OBJECT")

# --- weights, merged into the kept set ---------------------------------------
weights = json.load(open(mh("default_weights.mhw")))["weights"]
merged = {}
for bone_name, pairs in weights.items():
    target = kept_ancestor(bone_name) or "root"
    table = merged.setdefault(target, {})
    for vertex, weight in pairs:
        table[vertex] = table.get(vertex, 0.0) + weight
for bone_name, table in merged.items():
    vertex_group = body.vertex_groups.new(name=bone_name)
    for vertex, weight in table.items():
        vertex_group.add([vertex], min(1.0, weight), "REPLACE")

# --- 3. colour by dominant bone ----------------------------------------------
dominant = {}
for bone_name, table in merged.items():
    for vertex, weight in table.items():
        if weight > dominant.get(vertex, ("", -1.0))[1]:
            dominant[vertex] = (bone_name, weight)
colours = mesh.color_attributes.new("garment", "BYTE_COLOR", "POINT")
for vertex in range(len(positions)):
    colours.data[vertex].color = GARMENT.get(dominant.get(vertex, ("", 0))[0], SKIN)
mesh.color_attributes.active_color = colours

material = bpy.data.materials.new("rider")
material.use_nodes = True
nodes, links = material.node_tree.nodes, material.node_tree.links
shader = nodes["Principled BSDF"]
shader.inputs["Roughness"].default_value = 0.65
attribute = nodes.new("ShaderNodeVertexColor")
attribute.layer_name = "garment"
links.new(attribute.outputs["Color"], shader.inputs["Base Color"])
mesh.materials.append(material)

# --- 4. drop the helpers, decimate, skin, export -----------------------------
bm = bmesh.new()
bm.from_mesh(mesh)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
bm.to_mesh(mesh)
bm.free()
source_tris = sum(len(p.vertices) - 2 for p in mesh.polygons)
bpy.context.view_layer.objects.active = body
body.select_set(True)
bpy.ops.object.modifier_add(type="TRIANGULATE")
bpy.ops.object.modifier_apply(modifier=body.modifiers[-1].name)
if source_tris > TARGET_TRIS:
    decimate = body.modifiers.new("collapse", "DECIMATE")
    decimate.ratio = TARGET_TRIS / source_tris
    decimate.use_symmetry = True
    decimate.symmetry_axis = "X"
    bpy.ops.object.modifier_apply(modifier="collapse")
triangles = sum(len(p.vertices) - 2 for p in mesh.polygons)
body.parent = armature
skin = body.modifiers.new("skin", "ARMATURE")
skin.object = armature
height = max(v.co.z for v in mesh.vertices) - min(v.co.z for v in mesh.vertices)

bpy.ops.object.select_all(action="DESELECT")
body.select_set(True)
armature.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=OUT_GLB,
    export_format="GLB",
    use_selection=True,
    export_skins=True,
    export_animations=False,
    export_vertex_color="ACTIVE",
    export_yup=True,
)
with open(OUT_REPORT, "w") as handle:
    json.dump(
        {
            "sourceBones": len(bones),
            "bones": len(KEEP),
            "sourceTriangles": source_tris,
            "triangles": triangles,
            "heightMetres": height,
            "materials": 1,
            "textures": 0,
        },
        handle,
        indent=2,
    )
print("REPORT", open(OUT_REPORT).read())
