# SPDX-License-Identifier: AGPL-3.0-or-later
"""
The realistic rider: MakeHuman's CC0 base mesh in an athletic build, rigged
with its own default skeleton and weights, dressed in the On Your Left house
kit, under a helmet and glasses, cut down for a phone -- #369, #430, #623.

Run by `process-assets.ts`, never by hand:

    Blender -b --factory-startup --python process_rider.py -- \
        <makehuman-dir> <out.glb> <report.json> <target-tris> <texture-pixels> \
        <colour.png> <normal.png> <orm.png> <system-assets-dir> <mark.png>

MakeHuman is not needed and not run: the files it ships its assets in are
plain text -- `base.obj` (the mesh, with its helper geometry), the skeleton
`default.mhskel` (JSON; a joint is the mean of a list of helper vertices), the
weights `default_weights.mhw` (JSON; bone -> [[vertex, weight]]) and each
`.target` (a vertex index and an offset a line) -- and all of them index the
SAME vertex list, which is why the OBJ is parsed here rather than imported:
Blender's importer renumbers vertices.

What it does:

1. Parse the OBJ: every vertex, and the faces of the `body` group only (the
   `helper-*` and `joint-*` groups are scaffolding).
2. BUILD (#623): apply MakeHuman's own macro targets, weighted by MakeHuman's
   own macro arithmetic, for BUILD below -- an athletic, lean build. The
   helper vertices move with the body, so the joints do too.
3. Build the joints from `default.mhskel`, and REDUCE the skeleton from 163
   bones (fingers, toes, face, twist bones) to the KEEP set a pedalling rider
   needs. A dropped bone's weights go to its nearest kept ancestor, so no
   vertex loses its influence.
4. Keep the full-resolution body (HIGH) for the bakes; decimate a copy (LOW)
   to what is left of <target-tris> once the helmet and glasses are paid for.
   ⚠️ Smooth-shaded: until #623 every face was flat, which drew a faceted body
   and split every vertex three ways (26 986 vertices for 8 998 triangles).
5. Build the helmet and glasses (#623) round the head's own vertices -- one
   mesh, one draw call among three riders, as the sphere cap was.
6. Bake, with Cycles on ONE thread (`process_tree.py` says why), from HIGH onto
   LOW's texture coordinates: a tangent-space NORMAL map, and AMBIENT
   OCCLUSION with the helmet in the scene.
7. Draw the house kit onto LOW's texture coordinates from `rider_kit.py`'s
   numbers: a colour map, and an occlusion/roughness/kit map (three's own
   channel order: occlusion R, roughness G, and in B how much of the kit's
   main colour a texel is -- premultiplied, with the colour map black there). The skin
   is MakeHuman's CC0 skin's detail on the tone the rider already had; the
   brows are MakeHuman's CC0 eyebrow, laid onto the skin through its own
   `.mhclo` fit. The eyes are left as they were (#623's open question).
8. Add the kit's relief and the riding pose's creases (seams, the zip, the
   straps, the pockets, the chamois, the folds at hip, knee, elbow and
   shoulder) to the baked normal map, and write the three maps as PNGs for
   `encode-ktx2.ts`.
9. Export a skinned GLB in MakeHuman's rest pose, the helmet beside the body.

It does NOT pose the body onto the bicycle. That is done at runtime by
`src/game/three-renderer.ts` section RealisticRiderBelt, which aims each kept
bone at the joint positions `src/game/bicycle.ts` section `riderJoints`
derives -- the hips on the saddle, the hands on the hoods, and each knee and
foot from `legBones(crankAngle)`. One source for where a leg is, rather than a
pose baked here that `bicycle.ts` could drift from; and the legs therefore turn
exactly when the HUD shows a cadence, which is #349's rule.

ADR 0026 D-5: the inputs are pinned by `inputs.lock.json` (MakeHuman at one
commit, MakeHuman's CC0 system assets pack by its archive's digest) and the
tool by `sources.ts` section PINNED_BLENDER.
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

# The kit's numbers, beside this file. ⚠️ No bytecode: Python would otherwise
# leave a `__pycache__` beside them, a binary `ASSET001` rightly refuses.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rider_kit as KIT  # noqa: E402

args = sys.argv[sys.argv.index("--") + 1 :]
MH_DIR, OUT_GLB, OUT_REPORT = args[:3]
TARGET_TRIS = int(args[3])
PIXELS = int(args[4])
COLOUR_PNG, NORMAL_PNG, ORM_PNG = (os.path.join(os.path.dirname(OUT_GLB), name) for name in args[5:8])
SYSTEM_DIR = args[8]
MARK_PNG = args[9]
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

# --- 2's numbers: the build ---------------------------------------------------
# MakeHuman's macro sliders, 0 to 1. Gender, age and the three ethnic mixes are
# MakeHuman's OWN defaults (50 %, 25 years, a third each), unchanged: they are
# who the rider is, which is the owner's to rule on, and #623 rules only on the
# build. Muscle is raised from MakeHuman's 50 % and weight lowered from its
# 50 %: an athletic, lean build.
BUILD = {"gender": 0.5, "muscle": 0.85, "weight": 0.25}
ETHNIC = ("african", "asian", "caucasian")


def macro_targets():
    """(file, weight) for every macro target, by MakeHuman's own arithmetic.

    `apps/humanmodifier.py` at the pinned commit: a universal target's weight
    is the product of its gender, age, muscle and weight values; an ethnic
    target's is its ethnic share times its gender and age values. Age 25 is
    MakeHuman's "young" at a value of 1, and a slider at 50 % is "average" at
    a value of 1.
    """
    gender = {"female": 1 - BUILD["gender"], "male": BUILD["gender"]}
    muscle = BUILD["muscle"]
    weight = BUILD["weight"]
    muscles = {
        "averagemuscle": 1 - max(0.0, (muscle - 0.5) * 2),
        "maxmuscle": max(0.0, (muscle - 0.5) * 2),
    }
    weights = {
        "averageweight": 1 - max(0.0, 1 - weight * 2),
        "minweight": max(0.0, 1 - weight * 2),
    }
    out = []
    for sex, g in gender.items():
        for m, mv in muscles.items():
            for w, wv in weights.items():
                out.append((f"universal-{sex}-young-{m}-{w}.target", g * mv * wv))
        for ethnic in ETHNIC:
            out.append((f"{ethnic}-{sex}-young.target", g / len(ETHNIC)))
    return [(name, value) for name, value in out if value > 0]


# The helmet's shell: rings from the crown to the rim, segments round it.
HELMET_RINGS = 7
HELMET_SEGMENTS = 22


def mh(path):
    return os.path.join(MH_DIR, path)


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# --- 1. parse the OBJ ---------------------------------------------------------
raw, uvs, faces, groups = [], [], [], {}
group = None
with open(mh("base.obj")) as handle:
    for line in handle:
        if line.startswith("v "):
            raw.append([float(value) for value in line.split()[1:4]])
        elif line.startswith("vt "):
            uvs.append(tuple(float(v) for v in line.split()[1:3]))
        elif line.startswith("g "):
            group = line.split()[1]
        elif line.startswith("f "):
            corners = [c.split("/") for c in line.split()[1:]]
            vertices = [int(c[0]) - 1 for c in corners]
            groups.setdefault(group, set()).update(vertices)
            if group == "body":
                faces.append(
                    (vertices, [int(c[1]) - 1 if len(c) > 1 and c[1] else None for c in corners])
                )

# --- 2. the build -------------------------------------------------------------
applied = []
for name, value in macro_targets():
    with open(mh(os.path.join("targets", name))) as handle:
        for line in handle:
            if line.startswith("#") or not line.strip():
                continue
            index, dx, dy, dz = line.split()
            point = raw[int(index)]
            point[0] += value * float(dx)
            point[1] += value * float(dy)
            point[2] += value * float(dz)
    applied.append([name, round(value, 6)])

# MakeHuman is Y-up, facing +Z; Blender is Z-up. (x, y, z) -> (x, -z, y).
positions = [Vector((x * UNIT, -z * UNIT, y * UNIT)) for x, y, z in raw]


def centre_of(vertices):
    return sum((positions[i] for i in vertices), Vector()) / len(vertices)


# The texture coordinates each vertex of the body has.
vertex_uv = {}
for vertices, uv_indices in faces:
    for vertex, uv_index in zip(vertices, uv_indices):
        if uv_index is not None:
            vertex_uv.setdefault(vertex, set()).add(uvs[uv_index])

# --- 3. the skeleton, reduced -------------------------------------------------
skeleton = json.load(open(mh("default.mhskel")))
bones = skeleton["bones"]


def joint(name):
    indices = skeleton["joints"][name]
    return sum((positions[i] for i in indices), Vector()) / len(indices)


def kept_ancestor(name):
    while name is not None and name not in KEEP:
        name = bones[name]["parent"]
    return name


mesh = bpy.data.meshes.new("rider")
mesh.from_pydata([tuple(p) for p in positions], [], [f[0] for f in faces])
uv_layer = mesh.uv_layers.new(name="uv")
loop = 0
for _, uv_indices in faces:
    for index in uv_indices:
        if index is not None:
            uv_layer.data[loop].uv = uvs[index]
        loop += 1
for polygon in mesh.polygons:
    polygon.use_smooth = True
body = bpy.data.objects.new("rider", mesh)
scene.collection.objects.link(body)

armature_data = bpy.data.armatures.new("skeleton")
armature = bpy.data.objects.new("skeleton", armature_data)
scene.collection.objects.link(armature)
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
HEAD = {name: edit[name].head.copy() for name in KEEP}
bpy.ops.object.mode_set(mode="OBJECT")

# --- weights, merged into the kept set ---------------------------------------
weights = json.load(open(mh("default_weights.mhw")))["weights"]
merged = {}
for bone_name, pairs in weights.items():
    target = kept_ancestor(bone_name) or "root"
    table = merged.setdefault(target, {})
    for vertex, weight in pairs:
        table[vertex] = table.get(vertex, 0.0) + weight
dominant = {}
for bone_name in KEEP:
    vertex_group = body.vertex_groups.new(name=bone_name)
    for vertex, weight in sorted(merged.get(bone_name, {}).items()):
        vertex_group.add([vertex], min(1.0, weight), "REPLACE")
        if weight > dominant.get(vertex, ("", -1.0))[1]:
            dominant[vertex] = (bone_name, weight)

# --- 4. drop the helpers; HIGH for the bakes ----------------------------------
bm = bmesh.new()
bm.from_mesh(body.data)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
bmesh.ops.triangulate(bm, faces=bm.faces[:])
bm.to_mesh(body.data)
bm.free()
source_tris = len(body.data.polygons)
high = body.copy()
high.data = body.data.copy()
high.name = "rider-high"
high.vertex_groups.clear()
scene.collection.objects.link(high)

# --- 5. the helmet and the glasses -------------------------------------------
# Built round the head's own vertices, in the rest pose, and exported as one
# mesh beside the body: the renderer carries it on the head bone.
head_vertices = [v for v in groups["body"] if dominant.get(v, ("",))[0] == "head"]
eye_l = centre_of(groups["helper-l-eye"])
eye_r = centre_of(groups["helper-r-eye"])
eye_mid = (eye_l + eye_r) / 2
eye_radius = max((positions[i] - eye_l).length for i in groups["helper-l-eye"])
top = max(positions[i].z for i in head_vertices)
skull = [positions[i] for i in head_vertices if positions[i].z > eye_mid.z - 0.01]
skull_front = min(p.y for p in skull)
skull_back = max(p.y for p in skull)
skull_half_width = max(abs(p.x) for p in skull)
# The shell: clear of the skull by CLEARANCE all round, its crown over the top
# of the head.
CLEARANCE = 0.015
centre = Vector((0.0, (skull_front + skull_back) / 2 + 0.006, eye_mid.z + 0.022))
radius = Vector((
    skull_half_width + CLEARANCE,
    (skull_back - skull_front) / 2 + CLEARANCE,
    top - centre.z + CLEARANCE,
))

SHELL = (0.86, 0.86, 0.86)
STRAP = (0.02, 0.02, 0.022)
LENS = (0.015, 0.018, 0.022)
FRAME = (0.03, 0.03, 0.032)
helmet_vertices, helmet_faces, helmet_colours = [], [], []


def add_quad(corners, colour):
    start = len(helmet_vertices)
    helmet_vertices.extend(tuple(c) for c in corners)
    helmet_colours.extend([colour] * 4)
    helmet_faces.append((start, start + 1, start + 2, start + 3))


def shell_point(ring, segment):
    """A point of the shell: `ring` from the crown, `segment` round from the front."""
    around = 2 * math.pi * segment / HELMET_SEGMENTS
    back = 0.5 - 0.5 * math.cos(around)  # 0 at the front, 1 at the back
    # The rim: over the brows at the front, down to the nape at the back.
    rim = math.radians(88 + 30 * back ** 1.4)
    down = rim * ring / HELMET_RINGS
    # A road helmet's tail: longer behind.
    stretch = 1 + 0.12 * back ** 2
    return centre + Vector((
        radius.x * math.sin(down) * math.sin(around),
        -radius.y * stretch * math.sin(down) * math.cos(around),
        radius.z * math.cos(down),
    ))


def is_vent(ring, segment):
    """Four rows of slots over the crown, running front to back."""
    return ring in (1, 2, 4) and segment in (2, 5, 17, 20)


for ring in range(HELMET_RINGS):
    for segment in range(HELMET_SEGMENTS):
        if is_vent(ring, segment):
            continue
        add_quad(
            (
                shell_point(ring, segment),
                shell_point(ring + 1, segment),
                shell_point(ring + 1, segment + 1),
                shell_point(ring, segment + 1),
            ),
            SHELL,
        )

# The straps: from the rim before and behind each ear, meeting under it, and
# on to the chin.
chin = Vector((0.0, skull_front + 0.035, eye_mid.z - 0.11))
for side in (1, -1):
    under_ear = Vector((side * (skull_half_width - 0.004), centre.y + 0.005, eye_mid.z - 0.055))
    for segment in ((4.5, 7.5) if side > 0 else (17.5, 14.5)):
        rim = shell_point(HELMET_RINGS, segment)
        along = (under_ear - rim).normalized()
        across = along.cross(Vector((side, 0, 0))).normalized() * 0.005
        add_quad((rim - across, under_ear - across, under_ear + across, rim + across), STRAP)
    across = Vector((0, 0, 0.005))
    add_quad((under_ear - across, chin - across, chin + across, under_ear + across), STRAP)

# The glasses: a curved lens before each eye, a bridge, and an arm to each ear.
LENS_OUT = 0.014
for side, eye in ((1, eye_l), (-1, eye_r)):
    front = eye + Vector((0, -eye_radius - LENS_OUT, 0))
    columns, rows = 5, 3
    width, lens_height = 0.05, 0.032
    grid = []
    for row in range(rows + 1):
        line = []
        for column in range(columns + 1):
            s = column / columns - 0.5
            t = row / rows - 0.5
            # Wrapped round the face: the outer edge swept back.
            x = front.x + side * s * width
            y = front.y + (s + 0.5) ** 2 * 0.022 + t * t * 0.006
            # An oval: the corners drawn in.
            z = front.z + t * lens_height * math.sqrt(max(0.0, 1 - (1.6 * s) ** 4))
            line.append(Vector((x, y, z)))
        grid.append(line)
    for row in range(rows):
        for column in range(columns):
            quad = (grid[row][column], grid[row + 1][column], grid[row + 1][column + 1], grid[row][column + 1])
            add_quad(quad if side > 0 else quad[::-1], LENS)
    outer = grid[rows // 2][columns]
    ear = Vector((side * (skull_half_width + 0.004), centre.y + 0.02, outer.z + 0.004))
    up = Vector((0, 0, 0.003))
    add_quad((outer - up, ear - up, ear + up, outer + up), FRAME)
bridge_l = eye_l + Vector((-0.026, -eye_radius - LENS_OUT, 0.008))
bridge_r = eye_r + Vector((0.026, -eye_radius - LENS_OUT, 0.008))
up = Vector((0, 0, 0.003))
add_quad((bridge_r - up, bridge_l - up, bridge_l + up, bridge_r + up), FRAME)

helmet_mesh = bpy.data.meshes.new("helmet")
helmet_mesh.from_pydata(helmet_vertices, [], helmet_faces)
for polygon in helmet_mesh.polygons:
    polygon.use_smooth = True
helmet_paint = helmet_mesh.color_attributes.new("paint", "BYTE_COLOR", "POINT")
for index, colour in enumerate(helmet_colours):
    helmet_paint.data[index].color = (*colour, 1.0)
helmet_mesh.color_attributes.active_color = helmet_paint
bm = bmesh.new()
bm.from_mesh(helmet_mesh)
bmesh.ops.triangulate(bm, faces=bm.faces[:])
bm.to_mesh(helmet_mesh)
bm.free()
helmet = bpy.data.objects.new("helmet", helmet_mesh)
scene.collection.objects.link(helmet)
helmet_tris = len(helmet_mesh.polygons)

# --- 4 (continued). LOW: the body decimated to what the helmet leaves ---------
body_budget = TARGET_TRIS - helmet_tris
bpy.ops.object.select_all(action="DESELECT")
bpy.context.view_layer.objects.active = body
body.select_set(True)
if source_tris > body_budget:
    decimate = body.modifiers.new("collapse", "DECIMATE")
    decimate.ratio = body_budget / source_tris
    decimate.use_symmetry = True
    decimate.symmetry_axis = "X"
    bpy.ops.object.modifier_apply(modifier="collapse")
body_tris = len(body.data.polygons)
if body_tris + helmet_tris > TARGET_TRIS:
    raise RuntimeError(f"the rider is {body_tris} + {helmet_tris} triangles, over {TARGET_TRIS}")

# --- 6. bake the normal map and the occlusion, HIGH onto LOW -----------------
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
# ⚠️ ONE thread, no adaptive sampling, a fixed seed: `process_tree.py` says why.
scene.render.threads_mode = "FIXED"
scene.render.threads = 1
scene.cycles.use_adaptive_sampling = False
scene.cycles.use_denoising = False
scene.cycles.seed = 623
scene.world = bpy.data.worlds.new("bake")
# How far the occlusion looks: a hand's breadth, so a crease reads and the far
# side of the body does not.
scene.world.light_settings.distance = 0.12


def bake_image(name):
    image = bpy.data.images.new(name, PIXELS, PIXELS, alpha=False, float_buffer=True)
    image.colorspace_settings.name = "Non-Color"
    return image


material = bpy.data.materials.new("rider")
material.use_nodes = True
body.data.materials.append(material)
target = material.node_tree.nodes.new("ShaderNodeTexImage")
material.node_tree.nodes.active = target
high.data.materials.clear()
high.data.materials.append(bpy.data.materials.new("rider-high"))

bpy.ops.object.select_all(action="DESELECT")
high.select_set(True)
body.select_set(True)
bpy.context.view_layer.objects.active = body
bake = scene.render.bake
bake.use_selected_to_active = True
bake.cage_extrusion = 0.012
bake.max_ray_distance = 0.03
bake.margin = 8
bake.margin_type = "EXTEND"
bake.target = "IMAGE_TEXTURES"

normal_image = bake_image("normal")
target.image = normal_image
scene.cycles.samples = 1
bake.normal_space = "TANGENT"
bpy.ops.object.bake(type="NORMAL")

occlusion_image = bake_image("occlusion")
target.image = occlusion_image
scene.cycles.samples = 64
bpy.ops.object.bake(type="AO")


def pixels_of(image):
    array = np.empty(PIXELS * PIXELS * 4, dtype=np.float32)
    image.pixels.foreach_get(array)
    return array.reshape(PIXELS, PIXELS, 4).astype(np.float64)


baked_normal = pixels_of(normal_image)[..., :3] * 2 - 1
baked_occlusion = pixels_of(occlusion_image)[..., 0]

# --- 7. rasterise LOW's texture coordinates ----------------------------------
# Row 0 is v = 0 -- Blender's own image order -- and flipped only when written.
low_mesh = body.data
low_mesh.calc_loop_triangles()
uv_data = low_mesh.uv_layers["uv"].data
LIMBS = {
    "head": ("head", "neck01"),
    "torso": ("root", "spine05", "spine04", "spine03", "spine02", "spine01",
              "pelvis.L", "pelvis.R", "clavicle.L", "clavicle.R"),
    "upperarm.L": ("upperarm01.L",), "upperarm.R": ("upperarm01.R",),
    "forearm.L": ("lowerarm01.L", "wrist.L"), "forearm.R": ("lowerarm01.R", "wrist.R"),
    "thigh.L": ("upperleg01.L",), "thigh.R": ("upperleg01.R",),
    "shin.L": ("lowerleg01.L",), "shin.R": ("lowerleg01.R",),
    "foot.L": ("foot.L",), "foot.R": ("foot.R",),
}
LIMB_NAMES = list(LIMBS)
group_names = {g.index: g.name for g in body.vertex_groups}
limb_of_bone = {bone: LIMB_NAMES.index(limb) for limb, owned in LIMBS.items() for bone in owned}
vertex_limb = np.zeros((len(low_mesh.vertices), len(LIMB_NAMES)))
for vertex in low_mesh.vertices:
    for element in vertex.groups:
        vertex_limb[vertex.index, limb_of_bone[group_names[element.group]]] += element.weight
vertex_position = np.array([tuple(v.co) for v in low_mesh.vertices])

covered = np.zeros((PIXELS, PIXELS), dtype=bool)
texel_position = np.zeros((PIXELS, PIXELS, 3))
texel_limb = np.zeros((PIXELS, PIXELS, len(LIMB_NAMES)))
# Metres per unit of texture coordinate along u and along v, and their
# directions in 3-D, per texel.
texel_scale = np.ones((PIXELS, PIXELS, 2))
texel_u_axis = np.zeros((PIXELS, PIXELS, 3))
texel_v_axis = np.zeros((PIXELS, PIXELS, 3))


def rasterise(corners):
    """The texels whose centres a triangle (in texel units) covers, and their weights."""
    low = np.floor(corners.min(axis=0)).astype(int)
    top_corner = np.ceil(corners.max(axis=0)).astype(int)
    xs = np.arange(max(low[0], 0), min(top_corner[0], PIXELS - 1) + 1)
    ys = np.arange(max(low[1], 0), min(top_corner[1], PIXELS - 1) + 1)
    if len(xs) == 0 or len(ys) == 0:
        return None
    gx, gy = np.meshgrid(xs, ys)
    a, b, c = corners
    det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
    if abs(det) < 1e-12:
        return None
    w0 = ((b[1] - c[1]) * (gx - c[0]) + (c[0] - b[0]) * (gy - c[1])) / det
    w1 = ((c[1] - a[1]) * (gx - c[0]) + (a[0] - c[0]) * (gy - c[1])) / det
    w2 = 1 - w0 - w1
    inside = (w0 >= -1e-6) & (w1 >= -1e-6) & (w2 >= -1e-6)
    if not inside.any():
        return None
    return gy[inside], gx[inside], np.stack([w0[inside], w1[inside], w2[inside]], axis=1)


for triangle in low_mesh.loop_triangles:
    uv3 = np.array([tuple(uv_data[loop].uv) for loop in triangle.loops])
    found = rasterise(uv3 * PIXELS - 0.5)
    if found is None:
        continue
    rows, columns, weights3 = found
    points = vertex_position[list(triangle.vertices)]
    covered[rows, columns] = True
    texel_position[rows, columns] = weights3 @ points
    texel_limb[rows, columns] = weights3 @ vertex_limb[list(triangle.vertices)]
    duv = np.array([uv3[1] - uv3[0], uv3[2] - uv3[0]])
    dp = np.array([points[1] - points[0], points[2] - points[0]])
    try:
        jacobian = np.linalg.solve(duv, dp)  # rows: dP/du, dP/dv
    except np.linalg.LinAlgError:
        continue
    lengths = np.maximum(np.linalg.norm(jacobian, axis=1), 1e-9)
    texel_scale[rows, columns] = lengths
    texel_u_axis[rows, columns] = jacobian[0] / lengths[0]
    texel_v_axis[rows, columns] = jacobian[1] / lengths[1]

limb = np.argmax(texel_limb, axis=2)


def limb_is(*names):
    return np.isin(limb, [LIMB_NAMES.index(name) for name in names])


P = texel_position
X, Y, Z = P[..., 0], P[..., 1], P[..., 2]


def smooth(edge0, edge1, x):
    t = np.clip((x - edge0) / (edge1 - edge0), 0, 1)
    return t * t * (3 - 2 * t)


def along(point, start, end):
    """How far along a segment a point is, 0 at `start`, 1 at `end`."""
    start, end = np.array(start), np.array(end)
    axis = end - start
    return ((point - start) @ axis) / (axis @ axis)


# The joints the kit is measured from.
hip = {s: HEAD[f"upperleg01.{s}"] for s in "LR"}
knee = {s: HEAD[f"lowerleg01.{s}"] for s in "LR"}
ankle = {s: HEAD[f"foot.{s}"] for s in "LR"}
shoulder = {s: HEAD[f"upperarm01.{s}"] for s in "LR"}
elbow = {s: HEAD[f"lowerarm01.{s}"] for s in "LR"}
wrist = {s: HEAD[f"wrist.{s}"] for s in "LR"}
hips_z = (hip["L"].z + hip["R"].z) / 2
neck_z = HEAD["neck01"].z
shoulders_z = (shoulder["L"].z + shoulder["R"].z) / 2
torso_y = float(np.mean([HEAD[name].y for name in ("spine05", "spine04", "spine03", "spine02", "spine01")]))
foot_floor = float(vertex_position[:, 2].min())


def per_side(point, values_l, values_r):
    return np.where(point[..., 0] > 0, values_l, values_r)


def hem_at(point):
    """The jersey's hem at a point: lower at the back."""
    round_here = np.degrees(np.arctan2(np.abs(point[..., 0]), -(point[..., 1] - torso_y)))
    return hips_z + KIT.HEM_ABOVE_HIPS - KIT.HEM_BACK_DROP * smooth(60, 150, round_here)


thigh_t = per_side(P, along(P, hip["L"], knee["L"]), along(P, hip["R"], knee["R"]))
upperarm_t = per_side(P, along(P, shoulder["L"], elbow["L"]), along(P, shoulder["R"], elbow["R"]))
ankle_z = per_side(P, ankle["L"].z, ankle["R"].z)
# Round the torso, in degrees from the front centre line.
round_torso = np.degrees(np.arctan2(np.abs(X), -(Y - torso_y)))
hem_z = hem_at(P)

# --- the garments ---------------------------------------------------------------
torso = limb_is("torso")
thigh = limb_is("thigh.L", "thigh.R")
shin = limb_is("shin.L", "shin.R")
foot = limb_is("foot.L", "foot.R")
upperarm = limb_is("upperarm.L", "upperarm.R")
head_or_neck = limb_is("head")
collar_top = neck_z + KIT.COLLAR_ABOVE_NECK

jersey = covered & (
    (torso & (Z >= hem_z))
    | (upperarm & (upperarm_t < KIT.SLEEVE_END))
    | (head_or_neck & (Z < collar_top))
)
bib = covered & ~jersey & ((torso & (Z < hem_z)) | (thigh & (thigh_t < KIT.LEG_CUFF)))
sock_top = ankle_z + KIT.SOCK_TOP
shoe = covered & foot & (Z < ankle_z + KIT.SHOE_COLLAR)
sock = covered & (foot | shin) & (Z < sock_top) & ~shoe
skin = covered & ~(jersey | bib | sock | shoe)

colour = np.zeros((PIXELS, PIXELS, 3))
shade = np.zeros((PIXELS, PIXELS))  # of the main colour, where the mask is 1
mask = np.zeros((PIXELS, PIXELS))
rough = np.full((PIXELS, PIXELS), KIT.ROUGHNESS["skin"])


def paint(where, rgb=None, shade_value=None, roughness=None):
    if rgb is not None:
        colour[where] = rgb
        mask[where] = 0
    if shade_value is not None:
        shade[where] = shade_value
        mask[where] = 1
    if roughness is not None:
        rough[where] = roughness


# The jersey, in the main colour; its side panels a darker cut of it.
paint(jersey, shade_value=KIT.MAIN, roughness=KIT.ROUGHNESS["jersey"])
side_panel = (
    jersey & torso & (round_torso > KIT.SIDE_PANEL[0]) & (round_torso < KIT.SIDE_PANEL[1])
    & (Z < shoulders_z - KIT.SIDE_PANEL_BELOW_SHOULDERS)
)
paint(side_panel, shade_value=KIT.SIDE_PANEL_SHADE)
# Sleeve cuffs and the collar band: white.
sleeve_cuff = jersey & upperarm & (upperarm_t > KIT.SLEEVE_END - KIT.SLEEVE_CUFF)
collar_band = jersey & head_or_neck & (Z > collar_top - KIT.COLLAR_BAND)
paint(sleeve_cuff | collar_band, rgb=KIT.WHITE, roughness=KIT.ROUGHNESS["cuff"])
# The zip, down the front centre line.
zip_line = jersey & (torso | head_or_neck) & (np.abs(X) < KIT.ZIP_HALF_WIDTH) & (Y < torso_y)
paint(zip_line, rgb=KIT.ZIP, roughness=KIT.ROUGHNESS["zip"])
# The rear pockets' elastic band, a darker cut of the main colour.
pockets = jersey & torso & (Y > torso_y) & (np.abs(X) < KIT.POCKETS_HALF_WIDTH) & (Z < hem_z + KIT.POCKET_DEPTH)
paint(pockets & (Z > hem_z + KIT.POCKET_DEPTH - KIT.POCKET_BAND), shade_value=KIT.POCKET_BAND_SHADE)

# The mark: the app's two chevrons, square on the upper back, white.
mark_image = bpy.data.images.load(MARK_PNG)
mark_image.colorspace_settings.name = "Non-Color"
mark_size = mark_image.size[0]
mark = np.empty(mark_size * mark_size * 4, dtype=np.float32)
mark_image.pixels.foreach_get(mark)
mark = mark.reshape(mark_size, mark_size, 4)[..., 0].astype(np.float64)
mark_z = float(hips_z + KIT.HEM_ABOVE_HIPS - KIT.HEM_BACK_DROP + KIT.MARK_HEIGHT_SHARE * (
    shoulders_z - (hips_z + KIT.HEM_ABOVE_HIPS - KIT.HEM_BACK_DROP)
))
# Seen from behind, the rider's left is the viewer's left, which is +X, and the
# icon's left is its u = 0: so u runs from +X to -X. Blender's picture rows run
# bottom-up, as v does here, and the icon is drawn top-down, so v is flipped.
mark_u = 0.5 - X / KIT.MARK_METRES
mark_v = 0.5 + (Z - mark_z) / KIT.MARK_METRES
on_back = jersey & torso & (Y > torso_y + 0.02)
inside_mark = on_back & (mark_u >= 0) & (mark_u < 1) & (mark_v >= 0) & (mark_v < 1)
coverage = np.zeros((PIXELS, PIXELS))
mu = np.clip((mark_u * mark_size).astype(int), 0, mark_size - 1)
mv = np.clip((mark_v * mark_size).astype(int), 0, mark_size - 1)
coverage[inside_mark] = mark[mv[inside_mark], mu[inside_mark]]
mark_cover = inside_mark & (coverage > 0.5)
paint(mark_cover, rgb=KIT.WHITE)

# The bib shorts, the leg grippers in the main colour, and the chamois.
paint(bib, rgb=KIT.BIB, roughness=KIT.ROUGHNESS["bib"])
gripper = bib & thigh & (thigh_t > KIT.LEG_CUFF - KIT.LEG_GRIPPER)
paint(gripper, shade_value=KIT.MAIN, roughness=KIT.ROUGHNESS["cuff"])
chamois = bib & torso & (Z < hips_z - KIT.CHAMOIS_BELOW_HIPS) & (np.abs(X) < KIT.CHAMOIS_HALF_WIDTH)
paint(chamois, roughness=KIT.ROUGHNESS["chamois"])

# Socks, white with a main-colour cuff; shoes, dark, on a pale sole.
paint(sock, rgb=KIT.WHITE, roughness=KIT.ROUGHNESS["sock"])
paint(sock & (Z > sock_top - KIT.SOCK_CUFF), shade_value=KIT.MAIN)
paint(shoe, rgb=KIT.SHOE, roughness=KIT.ROUGHNESS["shoe"])
paint(shoe & (Z < foot_floor + KIT.SOLE_HEIGHT), rgb=KIT.SOLE, roughness=KIT.ROUGHNESS["sole"])

# --- the skin: the pack's detail on the rider's own tone ----------------------
skin_image = bpy.data.images.load(os.path.join(SYSTEM_DIR, *KIT.SKIN_PICTURE))
skin_image.colorspace_settings.name = "Non-Color"
sw, sh = skin_image.size
skin_pixels = np.empty(sw * sh * 4, dtype=np.float32)
skin_image.pixels.foreach_get(skin_pixels)
skin_pixels = skin_pixels.reshape(sh, sw, 4)[..., :3].astype(np.float64)
factor = sw // PIXELS
skin_texels = skin_pixels.reshape(PIXELS, factor, PIXELS, factor, 3).mean(axis=(1, 3))


def linear_of(values):
    return np.where(values <= 0.04045, values / 12.92, ((values + 0.055) / 1.055) ** 2.4)


skin_linear = linear_of(skin_texels)
skin_mean = skin_linear[skin].mean(axis=0)
detail = np.clip(skin_linear / skin_mean, *KIT.SKIN_DETAIL_RANGE)
# ⚠️ The eyes are left exactly as they were -- flat skin -- because whether the
# face has eyes is still the owner's question (#623), and the pack PAINTS eyes
# into its sockets. Its detail fades out round each eye.
for eye in (eye_l, eye_r):
    distance = np.linalg.norm(P - np.array(eye), axis=2)
    keep = smooth(eye_radius + 0.004, eye_radius + 0.014, distance)[..., None]
    detail = detail * keep + (1 - keep)
colour[skin] = (np.array(KIT.SKIN_TONE) * detail)[skin]
paint(skin, roughness=KIT.ROUGHNESS["skin"])

# --- the brows: MakeHuman's eyebrow, laid onto the skin through its fit -------
brow_dir = os.path.join(SYSTEM_DIR, *KIT.BROW_DIRECTORY)
brow_name = KIT.BROW_DIRECTORY[-1]
brow_image = bpy.data.images.load(os.path.join(brow_dir, f"{brow_name}.png"))
brow_image.colorspace_settings.name = "Non-Color"
bw, bh = brow_image.size
brow = np.empty(bw * bh * 4, dtype=np.float32)
brow_image.pixels.foreach_get(brow)
brow = brow.reshape(bh, bw, 4).astype(np.float64)
fit = []
with open(os.path.join(brow_dir, f"{brow_name}.mhclo")) as handle:
    reading = False
    for line in handle:
        parts = line.split()
        if line.startswith("verts"):
            reading = True
            continue
        if reading and len(parts) == 9:
            fit.append(([int(v) for v in parts[:3]], [float(w) for w in parts[3:6]]))
        elif reading and parts:
            break
brow_uv, brow_faces = [], []
with open(os.path.join(brow_dir, f"{brow_name}.obj")) as handle:
    for line in handle:
        if line.startswith("vt "):
            brow_uv.append(tuple(float(v) for v in line.split()[1:3]))
        elif line.startswith("f "):
            brow_faces.append([tuple(int(i) - 1 for i in c.split("/")[:2]) for c in line.split()[1:]])


def body_uv_of(vertex):
    found = vertex_uv.get(vertex)
    if found is None or len(found) != 1:
        raise RuntimeError(f"the brow's fit names vertex {vertex}, which has {found} texture coordinates")
    return np.array(next(iter(found)))


brow_on_body = [sum(body_uv_of(v) * w for v, w in zip(vertices, fitted)) for vertices, fitted in fit]
brow_colour = np.zeros((PIXELS, PIXELS, 3))
brow_alpha = np.zeros((PIXELS, PIXELS))
# The brow picture is several times finer than a texel of the body's map, so
# each texel takes the mean of the picture's pixels round its sample.
span = max(1, bw // PIXELS * 2)
for face in brow_faces:
    for fan in range(1, len(face) - 1):
        tri = [face[0], face[fan], face[fan + 1]]
        found = rasterise(np.array([brow_on_body[v] for v, _ in tri]) * PIXELS - 0.5)
        if found is None:
            continue
        rows, columns, weights3 = found
        at = weights3 @ np.array([brow_uv[t] for _, t in tri])
        sx = np.clip((at[:, 0] * bw).astype(int) - span // 2, 0, bw - span)
        sy = np.clip((at[:, 1] * bh).astype(int) - span // 2, 0, bh - span)
        sample = np.zeros((len(sx), 4))
        for dy in range(span):
            for dx in range(span):
                sample += brow[sy + dy, sx + dx]
        sample /= span * span
        stronger = sample[:, 3] > brow_alpha[rows, columns]
        brow_alpha[rows[stronger], columns[stronger]] = sample[stronger, 3]
        brow_colour[rows[stronger], columns[stronger]] = sample[stronger, :3]
brow_alpha = np.where(skin, brow_alpha, 0)
colour = colour * (1 - brow_alpha[..., None]) + linear_of(brow_colour) * brow_alpha[..., None]
brow_texels = int((brow_alpha > 0.5).sum())

# ⚠️ PREMULTIPLIED, both maps: the colour map is black where the main colour
# is, and the blue channel of the occlusion/roughness map carries the main
# colour's SHADE there and 0 elsewhere, so the renderer's albedo is
# `colour + blue * main` and a filtered texel on a boundary blends two
# albedos. The first version stored the shade as white in the colour map and a
# 0/1 mask in blue, and multiplied them: half-way across a hem, half white times
# half the main colour drew a pale halo round every panel of the kit.
colour[mask > 0] = 0.0
main_share = shade * mask

# --- 8. the relief and the creases -------------------------------------------
CREASE_JOINTS = {
    "hip": (hip, knee),
    "knee": (knee, ankle),
    "elbow": (elbow, wrist),
    "shoulder": (shoulder, elbow),
}


def creases(point, cloth, side_sign):
    """Rings of folds round a limb at each joint, on the side it bends to."""
    h = np.zeros(point.shape[:-1])
    for name, (side_of_bend, reach, spacing, cloth_depth, skin_depth, limb_radius) in KIT.CREASES.items():
        near, far = CREASE_JOINTS[name]
        for s in "LR":
            start = np.array(near[s])
            axis = np.array(far[s]) - start
            axis = axis / np.linalg.norm(axis)
            offset = point - start
            s_along = offset @ axis
            radial = offset - s_along[..., None] * axis
            radial_length = np.maximum(np.linalg.norm(radial, axis=-1), 1e-6)
            facing = (radial @ np.array(side_of_bend)) / radial_length
            # A little waviness round the limb, so the folds are not lathe-turned.
            around = np.arctan2(radial[..., 0], radial[..., 2] + 1e-9)
            phase = 0.9 * np.sin(3 * around) + 0.5 * np.sin(5 * around + 1.3)
            fold = np.cos(2 * np.pi * s_along / spacing + phase)
            reach_here = np.where(s_along >= 0, reach, reach / 4)
            envelope = (
                np.exp(-((s_along / reach_here) ** 2))
                * smooth(0.0, 0.6, facing)
                * smooth(limb_radius, limb_radius * 0.8, radial_length)
            )
            depth = np.where(cloth, cloth_depth, skin_depth)
            h += np.where(side_sign == (1 if s == "L" else -1), depth * fold * envelope, 0)
    return h


cuffs = sleeve_cuff | collar_band | gripper


def relief(point):
    """The kit's relief at a point, in metres -- for each texel's OWN garment."""
    x, y, z = point[..., 0], point[..., 1], point[..., 2]
    h = np.zeros(x.shape)
    round_here = np.degrees(np.arctan2(np.abs(x), -(y - torso_y)))
    hem_here = hem_at(point)
    radius_here = np.maximum(np.hypot(x, y - torso_y), 0.05)
    in_jersey = jersey & torso
    # A seam either side of each side panel: a groove, by the metre.
    below = z < shoulders_z - KIT.SIDE_PANEL_BELOW_SHOULDERS
    for edge in KIT.SIDE_PANEL:
        d = np.radians(round_here - edge) * radius_here
        h += np.where(in_jersey & below, KIT.SEAM_DEPTH * np.exp(-((d / KIT.SEAM_HALF_WIDTH) ** 2)), 0)
    # The zip's teeth.
    teeth = 0.75 + 0.25 * np.cos(2 * np.pi * z / KIT.ZIP_PITCH)
    h += np.where(jersey & (y < torso_y), KIT.ZIP_RIDGE * np.exp(-((x / KIT.ZIP_HALF_WIDTH) ** 2)) * teeth, 0)
    # The bib straps under the jersey, front and back.
    for offset in (KIT.STRAP_OFFSET, -KIT.STRAP_OFFSET):
        strap = smooth(KIT.STRAP_HALF_WIDTH + 0.003, KIT.STRAP_HALF_WIDTH - 0.003, np.abs(x - offset))
        h += np.where(in_jersey & (z < shoulders_z + 0.03), KIT.STRAP_RIDGE * strap, 0)
    # The pockets stand proud of the back, with seams between them and at the band.
    pocket = in_jersey & (y > torso_y) & (z < hem_here + KIT.POCKET_DEPTH)
    wide = smooth(KIT.POCKETS_HALF_WIDTH, KIT.POCKETS_HALF_WIDTH - 0.004, np.abs(x))
    h += np.where(pocket, KIT.POCKET_STEP * wide, 0)
    for divider in (-KIT.POCKETS_HALF_WIDTH / 3, KIT.POCKETS_HALF_WIDTH / 3):
        h += np.where(pocket, wide * KIT.SEAM_DEPTH * np.exp(-(((x - divider) / KIT.SEAM_HALF_WIDTH) ** 2)), 0)
    band = z - (hem_here + KIT.POCKET_DEPTH - KIT.POCKET_BAND)
    h += np.where(pocket, wide * KIT.SEAM_DEPTH * np.exp(-((band / KIT.SEAM_HALF_WIDTH) ** 2)), 0)
    # The cuffs, the collar and the grippers: a raised band.
    h += np.where(cuffs, KIT.CUFF_RIDGE, 0)
    # The chamois: a pad under the seat.
    pad = smooth(KIT.CHAMOIS_HALF_WIDTH, KIT.CHAMOIS_HALF_WIDTH - 0.02, np.abs(x)) * smooth(
        hips_z - KIT.CHAMOIS_BELOW_HIPS, hips_z - KIT.CHAMOIS_BELOW_HIPS - 0.03, z
    )
    h += np.where(bib & torso, KIT.CHAMOIS_PAD * pad, 0)
    # A shoe's straps across the top of the foot.
    straps = np.maximum(0, np.cos(2 * np.pi * KIT.SHOE_STRAPS * y / 0.2)) ** 6
    h += np.where(shoe & (z > foot_floor + KIT.SOLE_HEIGHT), KIT.SHOE_STRAP_RIDGE * straps, 0)
    # The creases the riding pose makes.
    h += creases(point, jersey | bib, np.where(X > 0, 1, -1))
    return h


# The slope of the relief along each texel's own u and v, in metres per metre,
# by central differences one texel either side IN 3-D -- so no island border
# and no neighbouring garment reaches into a texel's slope.
step_u = np.maximum(texel_scale[..., 0] / PIXELS, 1e-5)
step_v = np.maximum(texel_scale[..., 1] / PIXELS, 1e-5)
slope_u = (relief(P + texel_u_axis * step_u[..., None]) - relief(P - texel_u_axis * step_u[..., None])) / (2 * step_u)
slope_v = (relief(P + texel_v_axis * step_v[..., None]) - relief(P - texel_v_axis * step_v[..., None])) / (2 * step_v)
# ⚠️ Rounded to a billionth, `draw-bicycle-maps.ts`' reason: a slope of nothing
# a hair either side of zero must not round to two different bytes.
slope_u = np.where(covered, np.round(slope_u, 9), 0)
slope_v = np.where(covered, np.round(slope_v, 9), 0)
# A shoe is smooth: the foot's toes the bake finds under it are not drawn.
baked_normal[shoe] = (0.0, 0.0, 1.0)
# And no baked normal leans further than MAXIMUM_BAKED_TILT: the fingers the
# decimation merged into a mitten send the bake's rays off the fingertips at
# grazing angles, which is a projection failure and not a surface.
MAXIMUM_BAKED_TILT = math.radians(40)
tilt_xy = np.linalg.norm(baked_normal[..., :2], axis=2)
too_far = tilt_xy > math.sin(MAXIMUM_BAKED_TILT) * np.linalg.norm(baked_normal, axis=2)
scale_xy = math.tan(MAXIMUM_BAKED_TILT) * np.abs(baked_normal[..., 2]) / np.maximum(tilt_xy, 1e-9)
baked_normal[too_far, 0] *= scale_xy[too_far]
baked_normal[too_far, 1] *= scale_xy[too_far]
baked_normal[too_far, 2] = np.abs(baked_normal[too_far, 2])
baked_normal /= np.maximum(np.linalg.norm(baked_normal, axis=2, keepdims=True), 1e-9)
# Whiteout blending: the baked normal's tilt plus the relief's, over its z.
normal = np.stack([baked_normal[..., 0] - slope_u, baked_normal[..., 1] - slope_v, baked_normal[..., 2]], axis=2)
normal /= np.maximum(np.linalg.norm(normal, axis=2, keepdims=True), 1e-9)
relief_tilt = np.degrees(np.arctan(np.hypot(slope_u, slope_v)))

# --- fill every texel no triangle covers, so a mipmap does not bleed ----------


def dilate(values, known, passes=12):
    values = values.copy()
    known = known.copy()
    for _ in range(passes):
        total = np.zeros_like(values)
        count = np.zeros(known.shape)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            shifted = np.roll(np.roll(values, dy, axis=0), dx, axis=1)
            shifted_known = np.roll(np.roll(known, dy, axis=0), dx, axis=1)
            total += np.where(shifted_known[..., None], shifted, 0)
            count += shifted_known
        grow = ~known & (count > 0)
        values[grow] = total[grow] / count[grow, None]
        known = known | grow
    return values


def srgb(linear):
    linear = np.clip(linear, 0, 1)
    return np.where(linear <= 0.0031308, linear * 12.92, 1.055 * linear ** (1 / 2.4) - 0.055)


colour_out = dilate(srgb(colour), covered)
orm = dilate(np.stack([np.clip(baked_occlusion, 0, 1), rough, main_share], axis=2), covered)
# The normal map beyond the islands is the bake's own margin.
normal_out = np.where(covered[..., None], normal, baked_normal)


def write_png(path, values):
    """8-bit RGB PNG, top row first -- written here rather than by Blender, so
    no colour management touches the bytes. Row 0 of `values` is v = 0."""
    data = np.clip(np.round(values[::-1] * 255), 0, 255).astype(np.uint8)
    height_px, width_px = data.shape[:2]
    rows = b"".join(b"\x00" + data[row].tobytes() for row in range(height_px))

    def chunk(kind, body_bytes):
        payload = kind + body_bytes
        return struct.pack(">I", len(body_bytes)) + payload + struct.pack(">I", zlib.crc32(payload) & 0xFFFFFFFF)

    with open(path, "wb") as handle:
        handle.write(b"\x89PNG\r\n\x1a\n")
        handle.write(chunk(b"IHDR", struct.pack(">IIBBBBB", width_px, height_px, 8, 2, 0, 0, 0)))
        handle.write(chunk(b"IDAT", zlib.compress(rows, 9)))
        handle.write(chunk(b"IEND", b""))


write_png(COLOUR_PNG, colour_out)
write_png(NORMAL_PNG, normal_out * 0.5 + 0.5)
write_png(ORM_PNG, orm)


def texel_nearest(point):
    """The covered texel nearest a point, as [column, row from the TOP, metres]."""
    distance = np.where(covered, np.linalg.norm(P - np.array(point), axis=2), np.inf)
    row, column = np.unravel_index(np.argmin(distance), distance.shape)
    return [int(column), int(PIXELS - 1 - row), round(float(distance[row, column]), 4)]


def window_tilt(texel):
    column, row = texel[0], PIXELS - 1 - texel[1]
    return round(float(relief_tilt[max(0, row - 3) : row + 4, max(0, column - 3) : column + 4].mean()), 4)


# Where `realistic-textures.test.ts` samples a crease and a flat panel of the
# committed normal map: the back of the left knee, and the outside of the left
# thigh half-way down the shorts.
crease_texel = texel_nearest(np.array(knee["L"]) + np.array([0.0, 0.05, 0.0]))
flat_texel = texel_nearest(np.array(hip["L"]) * 0.55 + np.array(knee["L"]) * 0.45 + np.array([0.08, 0.0, 0.0]))

# --- 9. clean up and export --------------------------------------------------
bpy.data.objects.remove(high, do_unlink=True)
material.node_tree.nodes.remove(target)
body.parent = armature
skin_modifier = body.modifiers.new("skin", "ARMATURE")
skin_modifier.object = armature
height_m = max(v.co.z for v in body.data.vertices) - min(v.co.z for v in body.data.vertices)

bpy.ops.object.select_all(action="DESELECT")
body.select_set(True)
armature.select_set(True)
helmet.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=OUT_GLB,
    export_format="GLB",
    use_selection=True,
    export_skins=True,
    export_animations=False,
    export_vertex_color="ACTIVE",
    export_tangents=True,
    export_image_format="NONE",
    export_yup=True,
)
with open(OUT_REPORT, "w") as handle:
    json.dump(
        {
            "build": BUILD,
            "targets": applied,
            "sourceBones": len(bones),
            "bones": len(KEEP),
            "sourceTriangles": source_tris,
            "bodyTriangles": body_tris,
            "helmetTriangles": helmet_tris,
            "triangles": body_tris + helmet_tris,
            "heightMetres": height_m,
            "textures": 3,
            "texturePixels": PIXELS,
            "coveredShare": round(float(covered.mean()), 4),
            "meanOcclusion": round(float(baked_occlusion[covered].mean()), 4),
            "browTexels": brow_texels,
            "markZ": round(mark_z, 4),
            "creaseTexel": crease_texel,
            "flatTexel": flat_texel,
            "creaseReliefDegrees": window_tilt(crease_texel),
            "flatReliefDegrees": window_tilt(flat_texel),
        },
        handle,
        indent=2,
    )
print("REPORT", open(OUT_REPORT).read())
