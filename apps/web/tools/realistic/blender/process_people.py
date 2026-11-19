# SPDX-License-Identifier: AGPL-3.0-or-later
"""
The people on the pavements: MakeHuman's CC0 base mesh in three builds, each
dressed in MakeHuman's own CC0 clothes, shoes and hair, rigged with MakeHuman's
default skeleton and cut down for a phone -- the owner's request of 2026-11-18
("can we use a real model for the pedestrian").

Run by `process-assets.ts`, never by hand:

    Blender -b --factory-startup --python process_people.py -- \
        <makehuman-dir> <out.glb> <report.json> \
        <target-tris> <atlas-pixels> <atlas.png> <system-assets-dir>

Until now a person was the RIDER's body cut by vertex clustering when the page
loaded and painted by region (`people-body.ts`): one build, skin-tight
"clothes", bare feet, and a face the clustering had folded. Here each person
is a body with real garments over it, and the garments' own photographs.

MakeHuman is not needed and not run, as for the rider (`process_rider.py`
says why the OBJ is parsed here and not imported). What it does, for each of
PEOPLE below:

1. Parse `base.obj` and apply MakeHuman's macro targets for the person's
   BUILD, by MakeHuman's own arithmetic. The helper vertices move with the
   body, so the joints and every garment's fit do too.
2. Build the joints from `default.mhskel`, reduced to KEEP -- the rider's own
   set, by the same names, which is what `three-renderer.ts` section
   PeopleBelt poses a walk, a run and a ride with -- and merge the weights of
   every dropped bone into its nearest kept ancestor.
3. FIT each garment: a `.mhclo` gives every vertex of its OBJ as a weighted
   mean of three base vertices plus an offset scaled by the body's own size,
   which is MakeHuman's proxy fit (`shared/proxy.py` at the pinned commit).
   A fitted vertex takes its skin weights from the same three, by the same
   weights. The base vertices a garment says it hides (`delete_verts`) are
   dropped from the body, so no skin shows through a seam.
4. Split what is left into PARTS -- the head and neck, the limbs, the top,
   the bottoms, the shoes, the hair and the eyes (the base mesh's own eye
   helpers, drawn dark) -- and give each its REGION, the five
   `people-body.ts` section PersonRegion names. A garment's connected pieces
   that reach below the knee, or hang from below the hips as a skirt does,
   are bottoms; the rest are top. Hair is cards, so the head under it (THE
   SCALP) is drawn as hair too, and the brows are MakeHuman's own cards.
5. Collapse-decimate each part to its share of <target-tris>, the shares
   weighted so the head keeps its face and a trouser leg gives its triangles
   up first (PART_WEIGHT), and join them into one mesh a person.
6. THE ATLAS: one picture for everybody. Each part's photograph is cropped to
   what its faces use, box-filtered down to its tile, and DIVIDED by its own
   mean colour: what is kept is the fabric's weave, the face's features and
   the hair's strands, as a share of the part's colour, so each person on a
   street still wears their own seeded colours (`people.ts` section
   personLook) -- the renderer multiplies the two. A texel holds half the
   share, so one twice as bright as its part's mean is white. Hair keeps its
   photograph's own opacity; every other texel is opaque.
7. Export one skinned GLB, each person a mesh under their own skeleton with a
   primitive a region, named by the region.

ADR 0026 D-5: every choice is an argument or a constant here, the inputs are
pinned by `inputs.lock.json` (MakeHuman at one commit, MakeHuman's CC0 system
assets pack by its archive's digest) and the tool by `sources.ts` section
PINNED_BLENDER. Nothing here is random.

Nobody here wears a garment that carries MakeHuman's own mark: the pack's
`male_casualsuit02`, `male_casualsuit04`, `female_casualsuit01` and
`female_casualsuit02` print it on the chest and are not taken (ADR 0049 D-6).
"""

import json
import os
import struct
import sys
import zlib

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.kdtree import KDTree

sys.dont_write_bytecode = True

args = sys.argv[sys.argv.index("--") + 1 :]
MH_DIR, OUT_GLB, OUT_REPORT = args[:3]
TARGET_TRIS = int(args[3])
ATLAS = int(args[4])
# The atlas is written beside the GLB, for `encode-ktx2.ts`.
ATLAS_PNG = os.path.join(os.path.dirname(OUT_GLB), args[5])
SYSTEM_DIR = args[6]
# MakeHuman's unit is the decimetre.
UNIT = 0.1

# The rider's own kept bones (`process_rider.py` section KEEP), by the same
# names: `three-renderer.ts` poses a person by them.
KEEP = [
    "root",
    "spine05", "spine04", "spine03", "spine02", "spine01",
    "neck01", "head",
    "clavicle.L", "upperarm01.L", "lowerarm01.L", "wrist.L",
    "clavicle.R", "upperarm01.R", "lowerarm01.R", "wrist.R",
    "pelvis.L", "upperleg01.L", "lowerleg01.L", "foot.L",
    "pelvis.R", "upperleg01.R", "lowerleg01.R", "foot.R",
]
ETHNIC = ("african", "asian", "caucasian")

# The people. MakeHuman's macro sliders, 0 to 1; age and the ethnic mix are
# MakeHuman's own defaults, as the rider's are. Each garment is a directory of
# the system assets pack and the file name its files share.
#
# ⚠️ The FIRST is the rider's own build (`process_rider.py` section BUILD), to
# the digit: a scenery cyclist is this person seated by the realistic rider's
# skeleton (`three-renderer.ts` section PeopleBelt), which only fits a body
# whose joints are where the rider's are.
PEOPLE = [
    {
        "name": "person-a",
        "build": {"gender": 0.5, "muscle": 0.85, "weight": 0.25},
        "skin": ("skins/young_caucasian_male", "young_lightskinned_male_diffuse.png"),
        "clothes": ("clothes/male_casualsuit06", "male_casualsuit06"),
        "shoes": ("clothes/shoes05", "shoes05"),
        "hair": ("hair/short02", "short02"),
        "brows": ("eyebrows/eyebrow001", "eyebrow001"),
    },
    {
        "name": "person-b",
        "build": {"gender": 0.0, "muscle": 0.5, "weight": 0.5},
        "skin": ("skins/young_caucasian_female", "young_lightskinned_female_diffuse.png"),
        "clothes": ("clothes/female_elegantsuit01", "female_elegantsuit01"),
        "shoes": ("clothes/shoes01", "shoes01"),
        "hair": ("hair/ponytail01", "ponytail01"),
        "brows": ("eyebrows/eyebrow001", "eyebrow001"),
    },
    {
        "name": "person-c",
        "build": {"gender": 1.0, "muscle": 0.5, "weight": 0.5},
        "skin": ("skins/young_caucasian_male", "young_lightskinned_male_diffuse.png"),
        "clothes": ("clothes/male_casualsuit05", "male_casualsuit05"),
        "shoes": ("clothes/shoes02", "shoes02"),
        "hair": ("hair/short01", "short01"),
        "brows": ("eyebrows/eyebrow001", "eyebrow001"),
    },
]

# The parts a person is cut into, each one's region (`people-body.ts` section
# PersonRegion, by name) and how much a square metre of it weighs when the
# triangles are shared out: the face is what a rider looks at.
PARTS = ["head", "limbs", "top", "bottoms", "shoes", "hair", "brows", "eyes"]
REGION = {
    "head": "skin", "limbs": "skin", "eyes": "skin",
    "top": "top", "bottoms": "bottoms", "shoes": "shoes", "hair": "hair", "brows": "hair",
}
# How far a piece of a garment that hangs below the hips must hang to be
# bottoms and not a shirt's tail, in MakeHuman's decimetres.
SKIRT_DROP = 2.0
# The tiles whose photograph's opacity is kept: hair and brows are cards.
CUT_OUT = ("hair", "brows")
# A garment's picture, where it is not `<name>_diffuse.png`.
PICTURE = {"eyebrow001": "eyebrow001.png"}
PART_WEIGHT = {"head": 7.0, "limbs": 2.5, "top": 1.0, "bottoms": 0.7, "shoes": 2.5, "hair": 4.0}
# The parts too small to weigh: an eye is a ball a few pixels across and a
# brow a card. This many triangles the pair, of the total.
FIXED_TRIS = {"eyes": 24, "brows": 24}
# The bones whose skin is the head's part: the face, the neck and what a
# collar leaves of the chest, in one piece so no seam opens at the throat.
HEAD_BONES = ("head", "neck01", "spine", "clavicle", "root")

# The atlas: a row a person, a quarter of its side tall, each part's tile as
# (column, row, side) in sixteenths of the atlas's side.
TILE = {
    "head": (0, 0, 4), "top": (4, 0, 4), "bottoms": (8, 0, 4),
    "hair": (12, 0, 2), "limbs": (12, 2, 2), "shoes": (14, 0, 2), "eyes": (14, 2, 1), "brows": (15, 2, 1), "scalp": (14, 3, 1),
}
# Texels of a tile's edge its faces stay clear of, so a mip level never
# reaches the next tile.
TILE_PAD = 3
# The tiles that are one flat tone, as a share of their region's colour: the
# eyes dark against the skin, the scalp a little darker than the hair over it.
FLAT_SHARE = {"eyes": 0.16, "scalp": 0.7}
# The scalp, in shares of how far the crown is above the eyes: how near a
# hair vertex the head must be, and where a forehead ends and a head's back begins.
SCALP_REACH = 0.22
SCALP_ABOVE_EYES = 0.5
SCALP_BEHIND_EYES = 0.75
# Texels round a part's faces the atlas keeps of its photograph.
COVER_MARGIN = 4
# What is painted out of a photograph before anything reads it, as
# (u0, v0, u1, v1) of the picture: `male_casualsuit06` prints MakeHuman's own
# wordmark on its chest, its back and a sleeve, and nobody here wears a mark
# (ADR 0049 D-6). Each rectangle becomes the mean of the texels just outside
# it -- the shirt is one plain cloth there.
PAINT_OVER = {
    "male_casualsuit06": [(0.18, 0.825, 0.31, 0.90), (0.42, 0.78, 0.645, 0.895), (0.71, 0.81, 0.77, 0.865)],
}
# How far past a picture's edge a texture coordinate may reach and be held to
# the edge; further is refused.
UV_SLACK = 0.01


def mh(path):
    return os.path.join(MH_DIR, path)


def system(*path):
    return os.path.join(SYSTEM_DIR, *path)


def macro_targets(build):
    """(file, weight) for every macro target -- `process_rider.py`'s own arithmetic."""
    gender = {"female": 1 - build["gender"], "male": build["gender"]}
    muscle, weight = build["muscle"], build["weight"]
    if muscle < 0.5 or weight > 0.5:
        raise RuntimeError("only the average-to-max muscle and min-to-average weight targets are pinned")
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


def linear_of(values):
    return np.where(values <= 0.04045, values / 12.92, ((values + 0.055) / 1.055) ** 2.4)


def srgb_of(values):
    return np.where(values <= 0.0031308, values * 12.92, 1.055 * np.maximum(values, 0) ** (1 / 2.4) - 0.055)


def read_image(path):
    """A picture's stored values, bottom row first: (height, width, 4)."""
    image = bpy.data.images.load(path)
    image.colorspace_settings.name = "Non-Color"
    width, height = image.size
    values = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(values)
    bpy.data.images.remove(image)
    return values.reshape(height, width, 4).astype(np.float64)


def box_resize(values, side):
    """`values` box-filtered to `side` by `side`: each texel the mean of its own block."""
    height, width = values.shape[:2]
    ys = (np.arange(side + 1) * height) // side
    xs = (np.arange(side + 1) * width) // side
    if height < side or width < side:
        # Enlarged: nearest, which a crop smaller than its tile is.
        return values[np.minimum((np.arange(side) * height) // side, height - 1)][
            :, np.minimum((np.arange(side) * width) // side, width - 1)
        ]
    summed = np.add.reduceat(np.add.reduceat(values, ys[:-1], axis=0), xs[:-1], axis=1)
    counts = (ys[1:] - ys[:-1])[:, None] * (xs[1:] - xs[:-1])[None, :]
    return summed / counts[:, :, None]


def write_png(path, values):
    """8-bit RGBA PNG, written here so no colour management touches the bytes. Row 0 is v = 0."""
    data = np.clip(np.round(values[::-1] * 255), 0, 255).astype(np.uint8)
    height_px, width_px = data.shape[:2]
    rows = b"".join(b"\x00" + data[row].tobytes() for row in range(height_px))

    def chunk(kind, body_bytes):
        payload = kind + body_bytes
        return struct.pack(">I", len(body_bytes)) + payload + struct.pack(">I", zlib.crc32(payload) & 0xFFFFFFFF)

    with open(path, "wb") as handle:
        handle.write(b"\x89PNG\r\n\x1a\n")
        handle.write(chunk(b"IHDR", struct.pack(">IIBBBBB", width_px, height_px, 8, 6, 0, 0, 0)))
        handle.write(chunk(b"IDAT", zlib.compress(rows, 9)))
        handle.write(chunk(b"IEND", b""))


def triangle_mask(a, b, c, side):
    """The texels of a `side`-square tile whose middle is inside triangle abc, and its bounding edge."""
    mask = np.zeros((side, side), dtype=bool)
    left = max(0, int(np.floor(min(a[0], b[0], c[0]))))
    right = min(side, int(np.ceil(max(a[0], b[0], c[0]))) + 1)
    bottom = max(0, int(np.floor(min(a[1], b[1], c[1]))))
    top = min(side, int(np.ceil(max(a[1], b[1], c[1]))) + 1)
    if right <= left or top <= bottom:
        return mask
    xs = np.arange(left, right)[None, :] + 0.5
    ys = np.arange(bottom, top)[:, None] + 0.5
    area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    if abs(area) < 1e-12:
        return mask
    w0 = ((b[0] - xs) * (c[1] - ys) - (b[1] - ys) * (c[0] - xs)) / area
    w1 = ((c[0] - xs) * (a[1] - ys) - (c[1] - ys) * (a[0] - xs)) / area
    w2 = 1 - w0 - w1
    # Half a texel of slack, so a sliver thinner than a texel is still covered.
    slack = -0.5 / max(1.0, abs(area) ** 0.5)
    mask[bottom:top, left:right] = (w0 >= slack) & (w1 >= slack) & (w2 >= slack)
    return mask


def grown(mask, texels):
    """`mask` grown by `texels` in every direction."""
    out = mask.copy()
    for _ in range(texels):
        wider = out.copy()
        wider[1:, :] |= out[:-1, :]
        wider[:-1, :] |= out[1:, :]
        wider[:, 1:] |= out[:, :-1]
        wider[:, :-1] |= out[:, 1:]
        out = wider
    return out


def read_obj(path, wanted=None):
    """An OBJ's vertices, texture coordinates and faces ([(vertex, uv)] a face), by group."""
    vertices, uvs, faces = [], [], []
    group = None
    with open(path) as handle:
        for line in handle:
            if line.startswith("v "):
                vertices.append([float(value) for value in line.split()[1:4]])
            elif line.startswith("vt "):
                uvs.append(tuple(float(value) for value in line.split()[1:3]))
            elif line.startswith("g "):
                group = line.split()[1]
            elif line.startswith("f ") and (wanted is None or group in wanted):
                corners = [corner.split("/") for corner in line.split()[1:]]
                faces.append(
                    (group, [(int(c[0]) - 1, int(c[1]) - 1 if len(c) > 1 and c[1] else None) for c in corners])
                )
    return vertices, uvs, faces


def read_fit(path):
    """A `.mhclo`: each vertex's three base vertices, weights and offset, its scales and what it hides."""
    fit, hidden, scales = [], set(), {}
    section = None
    with open(path) as handle:
        for line in handle:
            parts = line.split()
            if not parts or parts[0].startswith("#"):
                continue
            if parts[0] in ("x_scale", "y_scale", "z_scale"):
                scales[parts[0][0]] = (int(parts[1]), int(parts[2]), float(parts[3]))
            elif parts[0] == "verts":
                section = "verts"
            elif parts[0] == "delete_verts":
                section = "delete"
            elif section == "verts" and len(parts) == 9:
                fit.append(([int(v) for v in parts[:3]], [float(w) for w in parts[3:6]], [float(d) for d in parts[6:9]]))
            elif section == "verts" and len(parts) == 1:
                fit.append(([int(parts[0])] * 3, [1.0, 0.0, 0.0], [0.0, 0.0, 0.0]))
            elif section == "delete":
                at = 0
                while at < len(parts):
                    if at + 2 < len(parts) and parts[at + 1] == "-":
                        hidden.update(range(int(parts[at]), int(parts[at + 2]) + 1))
                        at += 3
                    else:
                        hidden.add(int(parts[at]))
                        at += 1
    return fit, hidden, scales


# --- the base mesh, once ------------------------------------------------------
BASE, BASE_UV, BASE_FACES = read_obj(mh("base.obj"), {"body", "helper-l-eye", "helper-r-eye"})
SKELETON = json.load(open(mh("default.mhskel")))
BONES = SKELETON["bones"]


def kept_ancestor(name):
    while name is not None and name not in KEEP:
        name = BONES[name]["parent"]
    return name


# Each base vertex's weights, by kept bone.
VERTEX_WEIGHTS = {}
for bone_name, pairs in json.load(open(mh("default_weights.mhw")))["weights"].items():
    target = kept_ancestor(bone_name) or "root"
    for vertex, weight in pairs:
        table = VERTEX_WEIGHTS.setdefault(vertex, {})
        table[target] = table.get(target, 0.0) + weight

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
MATERIALS = {}
for region in ("skin", "top", "bottoms", "shoes", "hair"):
    MATERIALS[region] = bpy.data.materials.new(region)

atlas = np.zeros((ATLAS, ATLAS, 4), dtype=np.float64)
atlas[:, :, :3] = 0.5
atlas[:, :, 3] = 1.0
report = {"targetTriangles": TARGET_TRIS, "atlasPixels": ATLAS, "people": []}
exported = []


def to_blender(point):
    """MakeHuman is Y-up, facing +Z, in decimetres; Blender is Z-up, in metres."""
    return Vector((point[0] * UNIT, -point[2] * UNIT, point[1] * UNIT))


def part_object(name, points, weights, faces, regions):
    """One part as an object: `faces` are [(vertex, (u, v))] over `points`, `regions` each face's."""
    used = sorted({vertex for face in faces for vertex, _ in face})
    local = {vertex: at for at, vertex in enumerate(used)}
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([to_blender(points[v]) for v in used], [], [[local[v] for v, _ in face] for face in faces])
    layer = mesh.uv_layers.new(name="UVMap")
    at = 0
    for face in faces:
        for _, uv in face:
            layer.data[at].uv = uv
            at += 1
    slots = sorted(set(regions))
    for region in slots:
        mesh.materials.append(MATERIALS[region])
    for polygon, region in zip(mesh.polygons, regions):
        polygon.use_smooth = True
        polygon.material_index = slots.index(region)
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    groups = {bone: obj.vertex_groups.new(name=bone) for bone in KEEP}
    for vertex in used:
        table = weights.get(vertex, {})
        total = sum(table.values())
        if total <= 0:
            raise RuntimeError(f"{name}: vertex {vertex} is moved by no kept bone")
        for bone, weight in sorted(table.items()):
            groups[bone].add([local[vertex]], weight / total, "REPLACE")
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.to_mesh(mesh)
    bm.free()
    return obj


def area_of(obj):
    return sum(polygon.area for polygon in obj.data.polygons)


def decimated(obj, target):
    count = len(obj.data.polygons)
    if count <= target:
        return
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    modifier = obj.modifiers.new("collapse", "DECIMATE")
    modifier.ratio = target / count
    bpy.ops.object.modifier_apply(modifier="collapse")


for row, person in enumerate(PEOPLE):
    # --- 1. the build ---------------------------------------------------------
    points = np.array(BASE, dtype=np.float64)
    applied = []
    for name, value in macro_targets(person["build"]):
        with open(mh(os.path.join("targets", name))) as handle:
            for line in handle:
                if line.startswith("#") or not line.strip():
                    continue
                index, dx, dy, dz = line.split()
                points[int(index)] += value * np.array([float(dx), float(dy), float(dz)])
        applied.append([name, round(value, 6)])

    def joint(name):
        return sum((to_blender(points[i]) for i in SKELETON["joints"][name]), Vector()) / len(
            SKELETON["joints"][name]
        )

    hips = float(np.mean([points[i][1] for i in SKELETON["joints"][BONES["root"]["head"]]]))

    # --- 3. the garments, fitted ----------------------------------------------
    hidden = set()
    parts = {}

    def fitted(directory, stem):
        fit, hides, scales = read_fit(system(directory, f"{stem}.mhclo"))
        vertices, uvs, faces = read_obj(system(directory, f"{stem}.obj"))
        if len(fit) != len(vertices):
            raise RuntimeError(f"{stem}: {len(fit)} fitted vertices for {len(vertices)} in its OBJ")
        scale = np.array(
            [abs(points[scales[axis][0]][at] - points[scales[axis][1]][at]) / scales[axis][2] for at, axis in enumerate("xyz")]
        )
        placed, weights = {}, {}
        for at, (base, share, offset) in enumerate(fit):
            placed[at] = sum(points[v] * w for v, w in zip(base, share)) + np.array(offset) * scale
            table = {}
            for v, w in zip(base, share):
                for bone, weight in VERTEX_WEIGHTS.get(v, {}).items():
                    table[bone] = table.get(bone, 0.0) + w * weight
            weights[at] = {bone: weight for bone, weight in table.items() if weight > 0}
        hidden.update(hides)
        return placed, weights, [[[v, uvs[uv]] for v, uv in face] for _, face in faces]

    garments = {}

    def worn(part, kind):
        directory, stem = person[kind]
        placed, weights, faces = fitted(directory, stem)
        garments[part] = (placed, weights, faces, system(directory, PICTURE.get(stem, f"{stem}_diffuse.png")))
        return placed, faces

    clothes_points, clothes_faces = worn("top", "clothes")
    # A garment's connected pieces: below the hips, bottoms; the rest, top.
    parent = list(range(len(clothes_points)))

    def find(vertex):
        while parent[vertex] != vertex:
            parent[vertex] = parent[parent[vertex]]
            vertex = parent[vertex]
        return vertex

    for face in clothes_faces:
        first = find(face[0][0])
        for vertex, _ in face[1:]:
            parent[find(vertex)] = first
    pieces = {}
    for vertex in range(len(clothes_points)):
        pieces.setdefault(find(vertex), []).append(vertex)
    knees = float(np.mean([points[i][1] for i in SKELETON["joints"][BONES["lowerleg01.L"]["head"]]]))

    def is_low(members):
        heights = [clothes_points[v][1] for v in members]
        # A trouser leg reaches below the knee; a skirt hangs from below the
        # hips for more than a shirt's tail does.
        return min(heights) < knees or (np.mean(heights) < hips and max(heights) - min(heights) > SKIRT_DROP)

    low = {piece for piece, members in pieces.items() if is_low(members)}
    whole = garments.pop("top")
    for part, wanted in (("top", False), ("bottoms", True)):
        faces = [face for face in clothes_faces if (find(face[0][0]) in low) == wanted]
        if faces:
            garments[part] = (whole[0], whole[1], faces, whole[3])
    worn("shoes", "shoes")
    worn("hair", "hair")
    worn("brows", "brows")

    # --- 4. the body, less what the garments hide -----------------------------
    def dominant(vertex):
        table = VERTEX_WEIGHTS.get(vertex, {})
        return max(sorted(table), key=lambda bone: table[bone]) if table else "root"

    body = {"head": [], "limbs": [], "eyes": []}
    for group, face in BASE_FACES:
        if any(vertex in hidden for vertex, _ in face):
            continue
        if group != "body":
            body["eyes"].append(face)
            continue
        votes = [dominant(vertex).startswith(HEAD_BONES) for vertex, _ in face]
        body["head" if sum(votes) * 2 > len(votes) else "limbs"].append(face)
    # The FACE is the largest piece of the head's part in the skin's own
    # layout, and has the head's tile to itself; the neck, the ears' backs and
    # the mouth's inside share the limbs' tile.
    island = {}

    def island_of(uv):
        island.setdefault(uv, uv)
        while island[uv] != uv:
            island[uv] = island[island[uv]]
            uv = island[uv]
        return uv

    for face in body["head"]:
        first = island_of(face[0][1])
        for _, uv in face[1:]:
            island[island_of(uv)] = first
    sizes = {}
    for face in body["head"]:
        corners = [BASE_UV[uv] for _, uv in face]
        size = 0.0
        for at in range(1, len(corners) - 1):
            ax, ay = corners[at][0] - corners[0][0], corners[at][1] - corners[0][1]
            bx, by = corners[at + 1][0] - corners[0][0], corners[at + 1][1] - corners[0][1]
            size += abs(ax * by - ay * bx) / 2
        sizes[island_of(face[0][1])] = sizes.get(island_of(face[0][1]), 0.0) + size
    face_island = max(sorted(sizes), key=lambda each: sizes[each])
    skin_path = system(*person["skin"])
    # THE SCALP: hair is cards, and between two cards is the head. Where the
    # head lies under the hair -- within SCALP_REACH of one of its vertices,
    # and above the forehead or behind the ears, so a fringe darkens no brow
    # -- it is drawn as hair, in one flat tone.
    hair_tree = KDTree(len(garments["hair"][0]))
    for at, point in garments["hair"][0].items():
        hair_tree.insert(Vector(point), at)
    hair_tree.balance()
    eye = np.mean([points[vertex] for group, face in BASE_FACES if group != "body" for vertex, _ in face], axis=0)
    crown = max(points[vertex][1] for group, face in BASE_FACES if group == "body" for vertex, _ in face)
    rise = crown - eye[1]

    def under_hair(vertex):
        point = points[vertex]
        if point[1] < eye[1] + SCALP_ABOVE_EYES * rise and point[2] > eye[2] - SCALP_BEHIND_EYES * rise:
            return False
        return hair_tree.find(Vector(point))[2] < SCALP_REACH * rise

    # Each tile's picture and the faces it holds, whichever part they are cut with.
    tiled = {name: (None, []) for name in TILE}
    tiled["head"] = (skin_path, [])
    tiled["limbs"] = (skin_path, [])
    for part in ("head", "limbs", "eyes"):
        faces = [[[vertex, BASE_UV[uv] if uv is not None else (0.0, 0.0)] for vertex, uv in face] for face in body[part]]
        if not faces:
            continue
        parts[part] = (points, VERTEX_WEIGHTS, faces)
        for face, original in zip(faces, body[part]):
            if part == "eyes":
                tiled["eyes"][1].append(face)
            elif part == "head" and all(under_hair(vertex) for vertex, _ in original):
                tiled["scalp"][1].append(face)
            elif part == "head" and island_of(original[0][1]) == face_island:
                tiled["head"][1].append(face)
            else:
                tiled["limbs"][1].append(face)
    for part, (part_points, part_weights, faces, picture) in garments.items():
        parts[part] = (part_points, part_weights, faces)
        tiled[part] = (picture, faces)

    # --- 6. the atlas, and each face's texture coordinates into it -------------
    tiles = {}
    for name, (picture, faces) in tiled.items():
        if not faces:
            continue
        column, tile_row, sixteenths = TILE[name]
        side = sixteenths * ATLAS // 16
        x0 = column * ATLAS // 16
        y0 = (row * 4 + tile_row) * ATLAS // 16
        if name in FLAT_SHARE:
            atlas[y0 : y0 + side, x0 : x0 + side, :3] = srgb_of(np.array(FLAT_SHARE[name] / 2))
            for face in faces:
                for corner in face:
                    corner[1] = ((x0 + side / 2) / ATLAS, (y0 + side / 2) / ATLAS)
            tiles[name] = {"at": [x0, y0, side]}
            continue
        source = read_image(picture)
        height, width = source.shape[:2]
        for u_from, v_from, u_to, v_to in PAINT_OVER.get(os.path.basename(picture).replace("_diffuse.png", ""), []):
            l, r = int(u_from * width), int(u_to * width)
            b_, t = int(v_from * height), int(v_to * height)
            ring = np.concatenate(
                [
                    source[b_ - 4 : b_, l:r].reshape(-1, 4),
                    source[t : t + 4, l:r].reshape(-1, 4),
                    source[b_:t, l - 4 : l].reshape(-1, 4),
                    source[b_:t, r : r + 4].reshape(-1, 4),
                ]
            )
            source[b_:t, l:r] = ring.mean(axis=0)
        us = [corner[1][0] for face in faces for corner in face]
        vs = [corner[1][1] for face in faces for corner in face]
        if min(us) < -UV_SLACK or max(us) > 1 + UV_SLACK or min(vs) < -UV_SLACK or max(vs) > 1 + UV_SLACK:
            raise RuntimeError(f"{person['name']}/{name}: texture coordinates outside the picture")
        # The pack's `short04` reaches v = 1.0031: held to the picture's edge.
        for face in faces:
            for corner in face:
                corner[1] = (min(1.0, max(0.0, corner[1][0])), min(1.0, max(0.0, corner[1][1])))
        us = [min(1.0, max(0.0, u)) for u in us]
        vs = [min(1.0, max(0.0, v)) for v in vs]
        # What the faces use of the picture, and the same again round it
        # for the tile's padding.
        inner = side - 2 * TILE_PAD
        u0, u1, v0, v1 = min(us), max(us), min(vs), max(vs)
        pad_u = (u1 - u0) * TILE_PAD / inner
        pad_v = (v1 - v0) * TILE_PAD / inner
        left = max(0, int(np.floor((u0 - pad_u) * width)))
        right = min(width, int(np.ceil((u1 + pad_u) * width)))
        bottom = max(0, int(np.floor((v0 - pad_v) * height)))
        top = min(height, int(np.ceil((v1 + pad_v) * height)))
        tile = box_resize(source[bottom:top, left:right], side)
        colour = linear_of(tile[:, :, :3])
        cut_out = name in CUT_OUT
        opacity = tile[:, :, 3] if cut_out else np.ones((side, side))

        def into_tile(uv):
            return (
                (uv[0] * width - left) / (right - left) * side,
                (uv[1] * height - bottom) / (top - bottom) * side,
            )

        # Which texels the tile's faces cover, and COVER_MARGIN texels round
        # them. Only those are kept: the rest of a photograph is not this
        # part's, and its corner carries its publisher's address.
        covered = np.zeros((side, side), dtype=bool)
        for face in faces:
            corners = [into_tile(corner[1]) for corner in face]
            for at in range(1, len(corners) - 1):
                covered |= triangle_mask(corners[0], corners[at], corners[at + 1], side)
        if not covered.any():
            raise RuntimeError(f"{person['name']}/{name}: its faces cover no texel")
        # The tile's mean colour, over what its faces cover, by opacity.
        weight = covered * opacity
        mean = (colour * weight[:, :, None]).sum(axis=(0, 1)) / weight.sum()
        share = np.clip(colour / mean / 2, 0, 1)
        kept = grown(covered, COVER_MARGIN)
        # Outside, and under hair that is cut away, the mean: no stray
        # picture, and no dark fringe in a mip level.
        share[~kept] = 0.5
        share[opacity < 0.05] = 0.5
        opacity = np.where(kept, opacity, 0.0 if cut_out else 1.0)
        atlas[y0 : y0 + side, x0 : x0 + side, :3] = srgb_of(share)
        atlas[y0 : y0 + side, x0 : x0 + side, 3] = opacity
        for face in faces:
            for corner in face:
                at = into_tile(corner[1])
                corner[1] = ((x0 + at[0]) / ATLAS, (y0 + at[1]) / ATLAS)
        tiles[name] = {"at": [x0, y0, side], "meanLinear": [round(float(value), 6) for value in mean]}
    objects = {}
    for part in PARTS:
        if part in parts:
            part_points, part_weights, faces = parts[part]
            regions = [
                "hair" if part == "head" and any(face is each for each in tiled["scalp"][1]) else REGION[part]
                for face in faces
            ]
            objects[part] = part_object(f"{person['name']}-{part}", part_points, part_weights, faces, regions)

    # --- 5. each part cut to its share -----------------------------------------
    source_tris = {part: len(obj.data.polygons) for part, obj in objects.items()}
    fixed = {part: min(source_tris[part], FIXED_TRIS[part]) for part in FIXED_TRIS if part in objects}
    weighed = {part: area_of(obj) * PART_WEIGHT[part] for part, obj in objects.items() if part not in fixed}
    budget = TARGET_TRIS - sum(fixed.values())
    for part, obj in objects.items():
        decimated(obj, fixed[part] if part in fixed else int(budget * weighed[part] / sum(weighed.values())))
    cut_tris = {part: len(obj.data.polygons) for part, obj in objects.items()}
    if sum(cut_tris.values()) > TARGET_TRIS:
        raise RuntimeError(f"{person['name']} is {sum(cut_tris.values())} triangles, over {TARGET_TRIS}")

    bpy.ops.object.select_all(action="DESELECT")
    ordered = [objects[part] for part in PARTS if part in objects]
    for obj in ordered:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = ordered[0]
    bpy.ops.object.join()
    figure = ordered[0]
    figure.name = person["name"]
    figure.data.name = person["name"]

    # --- 2. the skeleton, reduced ----------------------------------------------
    armature_data = bpy.data.armatures.new(f"{person['name']}-skeleton")
    armature = bpy.data.objects.new(f"{person['name']}-skeleton", armature_data)
    scene.collection.objects.link(armature)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode="EDIT")
    edit = {}
    for name in KEEP:
        bone = armature_data.edit_bones.new(name)
        bone.head = joint(BONES[name]["head"])
        bone.tail = joint(BONES[name]["tail"])
        if (bone.tail - bone.head).length < 1e-4:
            bone.tail = bone.head + Vector((0, 0, 0.05))
        edit[name] = bone
    for name in KEEP:
        above = kept_ancestor(BONES[name]["parent"])
        if above is not None:
            edit[name].parent = edit[above]
    bpy.ops.object.mode_set(mode="OBJECT")
    figure.parent = armature
    modifier = figure.modifiers.new("skin", "ARMATURE")
    modifier.object = armature
    exported += [figure, armature]

    heights = [vertex.co.z for vertex in figure.data.vertices]
    report["people"].append(
        {
            "name": person["name"],
            "build": person["build"],
            "targets": applied,
            "garments": [person["clothes"][1], person["shoes"][1], person["hair"][1], person["brows"][1]],
            "skin": person["skin"][0].split("/")[-1],
            "hiddenBaseVertices": len(hidden),
            "sourceTriangles": source_tris,
            "triangles": cut_tris,
            "trianglesTotal": sum(cut_tris.values()),
            "vertices": len(figure.data.vertices),
            "heightMetres": round(max(heights) - min(heights), 4),
            "tiles": tiles,
        }
    )

# --- 7. export ----------------------------------------------------------------
write_png(ATLAS_PNG, atlas)
bpy.ops.object.select_all(action="DESELECT")
for obj in exported:
    obj.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=OUT_GLB,
    export_format="GLB",
    use_selection=True,
    export_skins=True,
    export_animations=False,
    # No normals: the renderer makes each posed phase's from its triangles
    # (`people-body.ts` section vertexNormals), and a file's would only
    # repeat a vertex along every crease.
    export_normals=False,
    export_tangents=False,
    export_image_format="NONE",
    export_yup=True,
)
with open(OUT_REPORT, "w") as handle:
    json.dump(report, handle, indent=2, sort_keys=True)
    handle.write("\n")
