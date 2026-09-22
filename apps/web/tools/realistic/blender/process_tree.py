# SPDX-License-Identifier: AGPL-3.0-or-later
"""
One photoscanned plant, cut down to what a phone can draw -- #430, #474.

Run by `process-assets.ts`, never by hand:

    Blender -b --factory-startup --python process_tree.py -- \
        <in.gltf> <out.glb> <report.json> <object> <target-tris> <impostor|none> <auto|all>

`impostor` also writes `<out>-impostor.png` beside the GLB (the `.glb` suffix
swapped for `-impostor.png`). `all` treats every face as foliage, for a shrub
whose leaves are its whole shape; `auto` splits wood from foliage by material.

## Why this is a script and not a pull request's worth of hand edits

ADR 0026 D-5: a derived asset is reproducible from a recorded input by a
committed script. Every choice below is either an argument on the command line
or a constant in this file, the input is pinned by `inputs.lock.json`, and the
Blender version by `sources.ts` section PINNED_BLENDER -- so a re-run is the same
run. The random thinning is seeded from the object's name, which is what makes
two runs keep the same cards.

## What it does, in order

1. Import the Poly Haven glTF and keep ONE object -- a pack like
   `fir_sapling_medium` holds three saplings, and each shipped variant is one
   of them. Stand it on the origin.
2. Render eight orthographic views round the FULL scan onto one transparent
   strip -- the far band's impostor. Before anything is thinned: the far band
   is a picture, so it may as well be a picture of every leaf (spike 0005,
   "What these taught #430", 3).
3. Split the geometry into WOOD and FOLIAGE. By material NAME first and blend
   mode second, because a trunk can be alpha-hashed too (spike 0005, 4).
4. THIN the foliage rather than decimating it: a collapse on a million leaf
   triangles melts them into a few blobs, so whole cards are deleted at random
   and each survivor is grown about its own centre to keep the canopy's
   coverage (spike 0005, 2).
5. Collapse-decimate the wood, whose silhouette survives it.
6. Bake ambient occlusion into a colour attribute with Cycles, so a canopy is
   dark inside for nothing at runtime.
7. Drop every roughness/metalness/occlusion map (the runtime uses a constant
   roughness, and the occlusion is now in the vertices) and downsize every
   remaining image to at most TEXTURE_PIXELS on a side -- ADR 0026 D-6's
   ceiling is 2048, and #457's device run put trees at 187 MiB of textures at
   1K, which is what this halves twice.
8. Export a GLB, with what the runtime needs to size the impostor recorded in
   the object's extras.

Everything measured goes into <report.json>.
"""

import hashlib
import json
import math
import random
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1 :]
IN_GLTF, OUT_GLB, OUT_REPORT, OBJECT = args[:4]
TARGET_TRIS = int(args[4])
WANT_IMPOSTOR = args[5] == "impostor"
ALL_FOLIAGE = args[6] == "all"
OUT_IMPOSTOR = OUT_GLB[: -len(".glb")] + "-impostor.png"

# The strip: eight views, each FRAME_W x FRAME_H. The far band starts where a
# 9 m tree is about 250 px tall on the tablet, so 512 px frames are twice what
# the nearest impostor needs.
IMPOSTOR_FRAMES = 8
FRAME_W, FRAME_H = 256, 512
# The largest side any shipped texture may have. ADR 0026 D-6 caps it at 2048;
# `realistic-budget.ts` holds the shipped files to this lower figure.
TEXTURE_PIXELS = 512
# The share of the triangle budget the foliage may spend when wood is kept --
# the wood is collapsed toward the rest, and the foliage then gets what is left.
FOLIAGE_SHARE = 0.75

# Seeded from the object's own name, so a re-run keeps the same cards and two
# variants of one pack do not keep the same pattern.
random.seed(int(hashlib.sha256(OBJECT.encode()).hexdigest()[:8], 16))


def triangles(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def is_foliage(material):
    """Leaves, twigs and needles. By name first: a trunk can be alpha-hashed."""
    if ALL_FOLIAGE:
        return True
    if material is None:
        return False
    name = material.name.lower()
    if any(word in name for word in ("leaf", "leaves", "twig", "needle", "foliage")):
        return True
    return material.blend_method == "BLEND"


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=IN_GLTF)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
keep = [o for o in meshes if o.name == OBJECT or o.name.startswith(OBJECT + "_LOD")]
if len(keep) != 1:
    raise SystemExit(f"expected one object named {OBJECT}: {[o.name for o in meshes]}")
for obj in bpy.data.objects:
    if obj not in keep:
        bpy.data.objects.remove(obj, do_unlink=True)
plant = keep[0]
bpy.context.view_layer.objects.active = plant
plant.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
source_tris = triangles(plant)

# --- 1. stand it on the origin ------------------------------------------------
corners = [plant.matrix_world @ Vector(c) for c in plant.bound_box]
low_z = min(c.z for c in corners)
mid_x = sum(c.x for c in corners) / 8
mid_y = sum(c.y for c in corners) / 8
for vertex in plant.data.vertices:
    vertex.co -= Vector((mid_x, mid_y, low_z))
plant.data.update()

scene = bpy.context.scene
# ⚠️ ONE thread, and no adaptive sampling. A first run on eight threads made a
# different impostor and a different occlusion bake every time -- Cycles sums
# samples in whatever order its threads finish -- so two of four impostors and
# every tree's vertex colours failed `--check`. On one thread the order is
# fixed and so are the bytes; the cost is about a minute a tree, once.
scene.render.threads_mode = "FIXED"
scene.render.threads = 1
scene.cycles.use_adaptive_sampling = False
dims = plant.dimensions.copy()
height = dims.z
width = max(dims.x, dims.y)
report = {"sourceTriangles": source_tris, "heightMetres": height, "widthMetres": width}
# The FULL scan's size, recorded in the file: the thinned cards are grown about
# their own centres and can reach past it, so the runtime sizes a plant by
# these rather than by the shipped mesh's bounding box -- which is also what
# makes the near mesh and the impostor, rendered from the full scan, the same
# size on screen.
plant["oyl_scan_height"] = height
plant["oyl_scan_width"] = width

# --- 2. the impostor strip, from the FULL scan --------------------------------
if WANT_IMPOSTOR:
    camera_data = bpy.data.cameras.new("impostor")
    camera_data.type = "ORTHO"
    ortho = max(height, width * FRAME_H / FRAME_W) * 1.02
    camera_data.ortho_scale = ortho
    camera = bpy.data.objects.new("impostor", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 3.5
    sun_obj = bpy.data.objects.new("sun", sun)
    sun_obj.rotation_euler = (math.radians(35), 0, math.radians(135))
    scene.collection.objects.link(sun_obj)
    scene.world = bpy.data.worlds.new("world")
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.55, 0.62, 0.7, 1.0)
    background.inputs["Strength"].default_value = 0.8
    scene.render.film_transparent = True
    scene.render.resolution_x = FRAME_W
    scene.render.resolution_y = FRAME_H
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 32
    scene.cycles.seed = 430
    scene.cycles.use_denoising = False
    scene.view_settings.view_transform = "Standard"
    strip = np.zeros((FRAME_H, FRAME_W * IMPOSTOR_FRAMES, 4), dtype=np.float32)
    distance = max(height, width) * 4
    for frame in range(IMPOSTOR_FRAMES):
        # Frame k is the plant seen from azimuth 2*pi*k/8, anticlockwise from
        # -Y in Blender, which is +Z -- the model's front -- in three. The
        # runtime picks the frame by the same rule.
        angle = 2 * math.pi * frame / IMPOSTOR_FRAMES
        camera.location = (math.sin(angle) * distance, -math.cos(angle) * distance, height / 2)
        camera.rotation_euler = (math.pi / 2, 0, angle)
        path = f"{OUT_IMPOSTOR}.frame{frame}.png"
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        image = bpy.data.images.load(path)
        pixels = np.array(image.pixels[:], dtype=np.float32).reshape(FRAME_H, FRAME_W, 4)
        strip[:, frame * FRAME_W : (frame + 1) * FRAME_W, :] = pixels
        bpy.data.images.remove(image)
    out = bpy.data.images.new("impostor", FRAME_W * IMPOSTOR_FRAMES, FRAME_H, alpha=True)
    out.pixels.foreach_set(strip.ravel())
    out.filepath_raw = OUT_IMPOSTOR
    out.file_format = "PNG"
    out.save()
    bpy.data.images.remove(out)
    bpy.data.objects.remove(camera, do_unlink=True)
    bpy.data.objects.remove(sun_obj, do_unlink=True)
    report.update(
        {
            "impostorFrames": IMPOSTOR_FRAMES,
            "impostorFramePixels": [FRAME_W, FRAME_H],
            "impostorOrthoScale": ortho,
        }
    )
    # What the runtime needs to stand the impostor where the tree stands,
    # carried in the file rather than typed into a table beside it.
    plant["oyl_impostor_scale"] = ortho
    plant["oyl_impostor_frames"] = IMPOSTOR_FRAMES

# --- 3. split by material, and collapse the wood FIRST ------------------------
# The wood goes first because a collapse does not always reach the ratio it is
# given -- a welded mesh with open borders keeps more than asked, and a first
# run that thinned the foliage to a fixed share and then collapsed the wood
# shipped `tree_small_02` at 33 182 triangles against 28 000, which
# `realistic-budget.test.ts` caught. So whatever the wood actually came to, the
# foliage is then thinned to exactly what is left.
foliage_slots = {i for i, slot in enumerate(plant.material_slots) if is_foliage(slot.material)}
source_wood = sum(len(p.vertices) - 2 for p in plant.data.polygons if p.material_index not in foliage_slots)
source_leaves = triangles(plant) - source_wood
wood = None
if 0 < len(foliage_slots) < len(plant.material_slots) and source_wood > 0:
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.object.mode_set(mode="OBJECT")
    for poly in plant.data.polygons:
        poly.select = poly.material_index not in foliage_slots
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.separate(type="SELECTED")
    bpy.ops.object.mode_set(mode="OBJECT")
    wood = next(o for o in bpy.context.selected_objects if o is not plant)
    # Weld first, for `process_rock.py`'s reason: glTF splits a vertex at every
    # texture seam, and a collapse cannot merge across a split.
    bpy.ops.object.select_all(action="DESELECT")
    wood.select_set(True)
    bpy.context.view_layer.objects.active = wood
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=1e-5)
    bpy.ops.object.mode_set(mode="OBJECT")
    wood_budget = max(200, int(TARGET_TRIS * (1 - FOLIAGE_SHARE)))
    for _attempt in range(5):
        if triangles(wood) <= wood_budget:
            break
        modifier = wood.modifiers.new("collapse", "DECIMATE")
        modifier.ratio = 0.97 * wood_budget / triangles(wood)
        bpy.ops.object.modifier_apply(modifier="collapse")
wood_tris = triangles(wood) if wood is not None else 0

# --- 4. thin the foliage to exactly what is left: whole cards, seeded -----------
# A card is a connected island of faces: union-find over shared vertices, in
# face-index order so the islands come out the same every run. The islands are
# shuffled with the seeded generator and kept in that order while they fit, so
# the total can never pass the budget -- a random keep-share could, by chance.
leaf_budget = max(0, TARGET_TRIS - wood_tris)
bm = bmesh.new()
bm.from_mesh(plant.data)
bm.faces.ensure_lookup_table()
leaf_faces = [f for f in bm.faces if f.material_index in foliage_slots]
leaf_tris = sum(len(f.verts) - 2 for f in leaf_faces)
parent = {}


def find(x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x


for face in leaf_faces:
    parent.setdefault(face.index, face.index)
owner = {}
for face in leaf_faces:
    for vert in face.verts:
        other = owner.get(vert.index)
        if other is None:
            owner[vert.index] = face.index
        else:
            a, b = find(face.index), find(other)
            if a != b:
                parent[a] = b
islands = {}
for face in leaf_faces:
    islands.setdefault(find(face.index), []).append(face)
order = sorted(islands)
random.shuffle(order)
kept, survivors, doomed = 0, [], []
for key in order:
    faces = islands[key]
    size = sum(len(f.verts) - 2 for f in faces)
    if kept + size <= leaf_budget:
        survivors.append(faces)
        kept += size
    else:
        doomed.append(faces)
bmesh.ops.delete(bm, geom=[f for faces in doomed for f in faces], context="FACES_ONLY")
keep_share = kept / max(1, leaf_tris)
grow = min(4.0, 1.0 / math.sqrt(max(keep_share, 1e-6)))
for faces in survivors:
    # An ordered de-duplication, not a set: a set of vertices iterates in
    # memory-address order, which moves between runs, and a float sum in a
    # different order is a different centre in the last bit -- enough to fail
    # `--check` on a shrub whose every other step was deterministic.
    verts = list(dict.fromkeys(v for f in faces for v in f.verts))
    centre = sum((v.co for v in verts), Vector()) / len(verts)
    for v in verts:
        v.co = centre + (v.co - centre) * grow
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
bm.to_mesh(plant.data)
bm.free()

# --- 5. join the wood back ---------------------------------------------------------
bpy.ops.object.select_all(action="DESELECT")
plant.select_set(True)
bpy.context.view_layer.objects.active = plant
if wood is not None:
    wood.select_set(True)
    bpy.ops.object.join()
plant = bpy.context.view_layer.objects.active
plant.name = OBJECT
report["triangles"] = triangles(plant)
if report["triangles"] > TARGET_TRIS:
    raise SystemExit(f"{OBJECT}: {report['triangles']} triangles, over the {TARGET_TRIS} asked for")
report["sourceWoodTriangles"] = source_wood
report["sourceFoliageTriangles"] = source_leaves
report["foliageCardsKeptShare"] = keep_share
report["foliageCardGrowth"] = grow

# --- 6. bake ambient occlusion into a colour attribute ---------------------------
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 64
scene.cycles.seed = 430
if scene.world is None:
    scene.world = bpy.data.worlds.new("world")
scene.world.light_settings.distance = 1.5
attribute = plant.data.color_attributes.new("ao", "BYTE_COLOR", "CORNER")
plant.data.color_attributes.active_color = attribute
scene.render.bake.target = "VERTEX_COLORS"
bpy.ops.object.select_all(action="DESELECT")
plant.select_set(True)
bpy.context.view_layer.objects.active = plant
bpy.ops.object.bake(type="AO")
ao = np.empty(len(attribute.data) * 4, dtype=np.float32)
attribute.data.foreach_get("color", ao)
report["meanAmbientOcclusion"] = float(ao.reshape(-1, 4)[:, 0].mean()) if len(ao) else 1.0

# --- 7. materials: drop the packed maps, wire the occlusion in, shrink images ---
def prune_material(material):
    """Removes the occlusion link the importer makes, then every node nothing
    reads, until none is left -- so the roughness/metalness/occlusion image is
    not exported and the report counts only what ships."""
    nodes, links = material.node_tree.nodes, material.node_tree.links
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


for slot in plant.material_slots:
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
    shader.inputs["Roughness"].default_value = 0.85
    shader.inputs["Metallic"].default_value = 0.0
    # glTF carries COLOR_0 into the material only when a node reads it.
    colour = nodes.new("ShaderNodeVertexColor")
    colour.layer_name = "ao"
    multiply = nodes.new("ShaderNodeMix")
    multiply.data_type = "RGBA"
    multiply.blend_type = "MULTIPLY"
    multiply.inputs["Factor"].default_value = 1.0
    base = shader.inputs["Base Color"]
    if base.links:
        links.new(base.links[0].from_socket, multiply.inputs["A"])
    else:
        multiply.inputs["A"].default_value = base.default_value
    links.new(colour.outputs["Color"], multiply.inputs["B"])
    links.new(multiply.outputs["Result"], base)
    prune_material(material)

shipped_images = []
for image in bpy.data.images:
    if image.users == 0 or image.size[0] == 0:
        continue
    side = max(image.size[0], image.size[1])
    if side > TEXTURE_PIXELS:
        factor = TEXTURE_PIXELS / side
        image.scale(max(1, round(image.size[0] * factor)), max(1, round(image.size[1] * factor)))
    shipped_images.append([image.name, image.size[0], image.size[1]])
report["images"] = sorted(shipped_images)
report["materials"] = len(plant.material_slots)

# --- 8. export -------------------------------------------------------------------
bpy.ops.object.select_all(action="DESELECT")
plant.select_set(True)
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

with open(OUT_REPORT, "w") as handle:
    json.dump(report, handle, indent=2, sort_keys=True)
print("REPORT", json.dumps(report, sort_keys=True))
