# SPDX-License-Identifier: AGPL-3.0-or-later
"""
One photoscanned tree, made cheap enough to measure on a phone -- #457 (3).

Run by `process-assets.ts`, never by hand:

    Blender -b --factory-startup --python process_tree.py -- \
        <in.gltf> <out.glb> <out-impostor.png> <report.json> <object-prefix> <target-tris>

What it does, in order, and why each step is here rather than in the browser:

1. Import the Poly Haven glTF and keep the objects whose name starts with
   <object-prefix> (a pack like `fir_sapling` holds three saplings; one is
   enough). Join them.
2. Split the geometry by material into WOOD (trunk and branches) and FOLIAGE
   (anything alpha-blended or alpha-hashed that is not wood).
3. WOOD: collapse-decimate. Bark survives a collapse; its silhouette is large.
4. FOLIAGE: THIN rather than decimate. A collapse on a million leaf cards melts
   them into a few blobs; deleting whole cards at random and scaling each
   survivor up about its own centre keeps the canopy's outline and its
   density to the eye. This is the step #430's pipeline most needs to inherit.
5. Bake ambient occlusion into a colour attribute with Cycles, so the canopy
   is dark inside with no runtime cost -- COLOR_0 in glTF multiplies the base
   colour and three applies it for nothing.
6. Export a GLB, textures embedded.
7. Render eight orthographic views round the FULL scan (before step 2) onto
   one transparent strip -- the impostor the far band is drawn with.

Everything it measured goes into <report.json>, which is what the spike
write-up's asset table is filled from.
"""

import json
import math
import random
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1 :]
IN_GLTF, OUT_GLB, OUT_IMPOSTOR, OUT_REPORT, PREFIX = args[:5]
TARGET_TRIS = int(args[5])
IMPOSTOR_FRAMES = 8
FRAME_W, FRAME_H = 256, 512
random.seed(457)


def triangles(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def is_foliage(material):
    """Leaves, twigs and needles. A trunk can be alpha-HASHED too, so the blend
    mode alone is not the test -- island_tree_02's bark material is."""
    if material is None:
        return False
    name = material.name.lower()
    if any(word in name for word in ("leaf", "leaves", "twig", "needle", "foliage")):
        return True
    return material.blend_method == "BLEND"


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=IN_GLTF)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
keep = [o for o in meshes if o.name.startswith(PREFIX)]
if not keep:
    raise SystemExit(f"no object starts with {PREFIX}: {[o.name for o in meshes]}")
for obj in meshes:
    if obj not in keep:
        bpy.data.objects.remove(obj, do_unlink=True)
bpy.ops.object.select_all(action="DESELECT")
for obj in keep:
    obj.select_set(True)
bpy.context.view_layer.objects.active = keep[0]
if len(keep) > 1:
    bpy.ops.object.join()
tree = bpy.context.view_layer.objects.active
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
source_tris = triangles(tree)

# Stand the tree on the origin, so the runtime places it by its foot.
corners = [tree.matrix_world @ Vector(c) for c in tree.bound_box]
low_z = min(c.z for c in corners)
mid_x = sum(c.x for c in corners) / 8
mid_y = sum(c.y for c in corners) / 8
tree.location -= Vector((mid_x, mid_y, low_z))
bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)

scene = bpy.context.scene
# --- 7. the impostor strip, from the FULL scan ------------------------------
# Rendered before anything is thinned: the far band is drawn from a picture,
# so it may as well be a picture of the whole canopy rather than the thinned
# one the near band has to make do with.
dims = tree.dimensions
height = dims.z
impostor_height = height
width = max(dims.x, dims.y)
camera_data = bpy.data.cameras.new("impostor")
camera_data.type = "ORTHO"
camera_data.ortho_scale = max(height, width * FRAME_H / FRAME_W) * 1.02
camera = bpy.data.objects.new("impostor", camera_data)
scene.collection.objects.link(camera)
scene.camera = camera
sun = bpy.data.lights.new("sun", "SUN")
sun.energy = 3.5
sun_obj = bpy.data.objects.new("sun", sun)
sun_obj.rotation_euler = (math.radians(35), 0, math.radians(135))
scene.collection.objects.link(sun_obj)
if scene.world is None:
    scene.world = bpy.data.worlds.new("world")
scene.world.use_nodes = True
background = scene.world.node_tree.nodes.get("Background")
if background is not None:
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
scene.view_settings.view_transform = "Standard"
strip = np.zeros((FRAME_H, FRAME_W * IMPOSTOR_FRAMES, 4), dtype=np.float32)
distance = max(height, width) * 4
for frame in range(IMPOSTOR_FRAMES):
    # Frame k is the tree seen from azimuth 2πk/8, anticlockwise from +Y in
    # Blender (which is -Z, "towards the viewer", in three) -- the runtime
    # picks the frame by the same rule.
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

bpy.data.objects.remove(camera, do_unlink=True)
bpy.data.objects.remove(sun_obj, do_unlink=True)

# --- 2. split by material ---------------------------------------------------
foliage_slots = {i for i, slot in enumerate(tree.material_slots) if is_foliage(slot.material)}
bm = bmesh.new()
bm.from_mesh(tree.data)
bm.faces.ensure_lookup_table()
leaf_faces = [f for f in bm.faces if f.material_index in foliage_slots]
wood_tris = sum(len(f.verts) - 2 for f in bm.faces if f.material_index not in foliage_slots)
leaf_tris = sum(len(f.verts) - 2 for f in leaf_faces)

# --- 4. thin the foliage: whole cards, at random ----------------------------
# A card is a connected island of faces. Union-find over shared vertices.
parent = {}


def find(x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x


for face in leaf_faces:
    parent.setdefault(face.index, face.index)
vert_owner = {}
for face in leaf_faces:
    for vert in face.verts:
        other = vert_owner.get(vert.index)
        if other is None:
            vert_owner[vert.index] = face.index
        else:
            a, b = find(face.index), find(other)
            if a != b:
                parent[a] = b
islands = {}
for face in leaf_faces:
    islands.setdefault(find(face.index), []).append(face)

leaf_budget = max(1, int(TARGET_TRIS * 0.7))
keep_share = min(1.0, leaf_budget / max(1, leaf_tris))
doomed = []
survivors = []
for faces in islands.values():
    (survivors if random.random() < keep_share else doomed).append(faces)
bmesh.ops.delete(bm, geom=[f for faces in doomed for f in faces], context="FACES_ONLY")
# Scale each survivor about its own centre, so the canopy keeps its coverage.
grow = min(4.0, 1.0 / math.sqrt(max(keep_share, 1e-6)))
for faces in survivors:
    verts = {v for f in faces for v in f.verts}
    centre = sum((v.co for v in verts), Vector()) / len(verts)
    for v in verts:
        v.co = centre + (v.co - centre) * grow
loose = [v for v in bm.verts if not v.link_faces]
bmesh.ops.delete(bm, geom=loose, context="VERTS")
bm.to_mesh(tree.data)
bm.free()

# --- 3. collapse the wood ---------------------------------------------------
# A decimate modifier acts on the whole mesh, so the foliage is separated,
# the wood decimated, and the two joined again.
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="DESELECT")
bpy.ops.object.mode_set(mode="OBJECT")
for poly in tree.data.polygons:
    poly.select = poly.material_index in foliage_slots
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.separate(type="SELECTED")
bpy.ops.object.mode_set(mode="OBJECT")
wood = tree
leaves = [o for o in bpy.context.selected_objects if o is not wood]
wood_budget = max(200, TARGET_TRIS - (triangles(leaves[0]) if leaves else 0))
if triangles(wood) > wood_budget:
    modifier = wood.modifiers.new("collapse", "DECIMATE")
    modifier.ratio = wood_budget / triangles(wood)
    bpy.context.view_layer.objects.active = wood
    bpy.ops.object.modifier_apply(modifier="collapse")
bpy.ops.object.select_all(action="DESELECT")
for obj in [wood, *leaves]:
    obj.select_set(True)
bpy.context.view_layer.objects.active = wood
bpy.ops.object.join()
tree = bpy.context.view_layer.objects.active
tree.name = PREFIX
final_tris = triangles(tree)

# --- 5. bake ambient occlusion into a colour attribute ----------------------
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 64
attribute = tree.data.color_attributes.new("ao", "BYTE_COLOR", "CORNER")
tree.data.color_attributes.active_color = attribute
scene.render.bake.target = "VERTEX_COLORS"
bpy.ops.object.select_all(action="DESELECT")
tree.select_set(True)
bpy.context.view_layer.objects.active = tree
if scene.world is None:
    scene.world = bpy.data.worlds.new("world")
scene.world.light_settings.distance = 1.5
bpy.ops.object.bake(type="AO")
ao = np.empty(len(attribute.data) * 4, dtype=np.float32)
attribute.data.foreach_get("color", ao)
mean_ao = float(ao.reshape(-1, 4)[:, 0].mean()) if len(ao) else 1.0
# glTF carries COLOR_0 into the material only when a node reads it: wire the
# attribute into every material's base colour as a multiply.
for slot in tree.material_slots:
    material = slot.material
    if material is None or not material.use_nodes:
        continue
    nodes, links = material.node_tree.nodes, material.node_tree.links
    shader = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
    if shader is None:
        continue
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

# --- 6. export --------------------------------------------------------------
bpy.ops.export_scene.gltf(
    filepath=OUT_GLB,
    export_format="GLB",
    use_selection=True,
    export_vertex_color="ACTIVE",
    export_all_vertex_colors=False,
    export_image_format="AUTO",
    export_yup=True,
)

with open(OUT_REPORT, "w") as handle:
    json.dump(
        {
            "sourceTriangles": source_tris,
            "sourceWoodTriangles": wood_tris,
            "sourceFoliageTriangles": leaf_tris,
            "foliageCardsKeptShare": keep_share,
            "foliageCardGrowth": grow,
            "triangles": final_tris,
            "materials": len(tree.material_slots),
            "heightMetres": height,
            "widthMetres": width,
            "meanAmbientOcclusion": mean_ao,
            "impostorFrames": IMPOSTOR_FRAMES,
            "impostorFramePixels": [FRAME_W, FRAME_H],
            "impostorOrthoScale": camera_data.ortho_scale,
        },
        handle,
        indent=2,
    )
print("REPORT", open(OUT_REPORT).read())
