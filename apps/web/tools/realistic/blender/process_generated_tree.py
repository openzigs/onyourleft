# SPDX-License-Identifier: AGPL-3.0-or-later
"""
One GENERATED tree, dressed and exported -- #1283, ADR 0049 D-1.

Run by `process-assets.ts`, never by hand:

    Blender -b --factory-startup --python process_generated_tree.py -- \
        <in.gltf> <out.glb> <report.json> <plan.json>

`<in.gltf>` is one level of one tree as `generated-trees.ts` wrote it from the
pinned generator's numbers: one mesh of two primitives, the wood (material
`bark`) and the leaf cards (material `leaves`), with no image. `<plan.json>` is
written by `process-assets.ts` from the same committed numbers and says what
the level wears and what the run writes.

## Why this is not `process_tree.py`

That script cuts a photoscan DOWN: it thins a million leaf triangles by whole
cards and collapses the wood until the plant fits its budget. A generated tree
arrives at its budget -- `generated-trees.ts` asks the generator for the size
wanted -- so nothing here deletes, collapses or thins a triangle, and the
report says how many went in and how many came out so that a run which did is
seen. What the two scripts share is what the runtime reads the same way off
either kind of tree, and it is one module: `impostor.py`.

## What it does, in order

1. Import the level through `gltf_import.py`, as every scan is imported, so an
   import that dropped a triangle stops the run. The tree already stands on the
   origin with its trunk on the vertical axis, and is NOT re-centred: the
   ground blob the runtime lays under it (#620) is under its trunk.
2. Draw the LEAF CARD: a sprig, each leaf of it cut out of a leaf atlas by
   that atlas's own opacity map, turned and laid at the place the plan gives.
   Every texel of a leaf is the atlas's, its colour multiplied by the plan's
   tone; the arrangement is the plan's numbers. Its normal map is the atlas's,
   turned with each leaf. The atlas is ambientCG's, a GRID of single leaves
   (#1283), or Poly Haven's, where each leaf is a whole sprig lying in a
   RECTANGLE of its own (#1294): `atlas_cell` reads either.
3. Wear the bark, downsized, on the wood.
4. For a FULL level, render the eight-view impostor strip and its normals from
   the dressed tree (`impostor.py`).
5. Bake ambient occlusion into a colour attribute with Cycles on one thread --
   per VERTEX, not per corner, so the exporter does not split a vertex the
   generator shared; and twice, once for the wood and once for the leaf cards,
   for the reason the bake itself gives.
6. Export a GLB with what the runtime needs to size the tree and its impostor
   in the object's extras. A MIDDLE level is exported with no image: it wears
   the full level's maps at runtime, as a scan's middle level does (#617).

Everything measured goes into <report.json>.
"""

import json
import math
import os
import sys

import bpy
import numpy as np

# The modules beside this file. ⚠️ No bytecode: a `__pycache__` beside them is
# a binary `ASSET001` refuses.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gltf_import import import_scan  # noqa: E402
from impostor import IMPOSTOR_FRAMES, render_impostor  # noqa: E402

args = sys.argv[sys.argv.index("--") + 1 :]
IN_GLTF, OUT_GLB, OUT_REPORT, PLAN_JSON = args[:4]
with open(PLAN_JSON) as handle:
    PLAN = json.load(handle)
NAME = PLAN["name"]
WANT_MAPS = PLAN["maps"]
OUT_IMPOSTOR = OUT_GLB[: -len(".glb")] + "-impostor.png"
OUT_IMPOSTOR_NORMALS = OUT_GLB[: -len(".glb")] + "-impostor-normals.png"
# Where a leaf card is cut: half coverage, which is where the runtime cuts it.
OPAQUE = 0.5


def triangles(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def read_image(path, data):
    """An image's texels as float32 rows from the BOTTOM, in the file's own
    values: nothing is converted, so what is written back is what was read."""
    image = bpy.data.images.load(path)
    if data:
        image.colorspace_settings.name = "Non-Color"
    width, height = image.size
    texels = np.array(image.pixels[:], dtype=np.float32).reshape(height, width, 4)
    bpy.data.images.remove(image)
    return texels


def sample(texels, x, y):
    """`texels` at the fractional texel coordinates (x, y), bilinear, edges held."""
    height, width = texels.shape[:2]
    x = np.clip(x - 0.5, 0, width - 1)
    y = np.clip(y - 0.5, 0, height - 1)
    x0 = np.floor(x).astype(np.int64)
    y0 = np.floor(y).astype(np.int64)
    x1 = np.minimum(x0 + 1, width - 1)
    y1 = np.minimum(y0 + 1, height - 1)
    fx = (x - x0)[..., None]
    fy = (y - y0)[..., None]
    low = texels[y0, x0] * (1 - fx) + texels[y0, x1] * fx
    high = texels[y1, x0] * (1 - fx) + texels[y1, x1] * fx
    return low * (1 - fy) + high * fy


def shrunk(texels, factor):
    """`texels` with every `factor` x `factor` block averaged into one: a leaf
    is drawn several times smaller than it was scanned, and reading the scan
    one texel in every few would speckle it."""
    if factor == 1:
        return texels
    height, width = texels.shape[0] // factor * factor, texels.shape[1] // factor * factor
    blocks = texels[:height, :width].reshape(height // factor, factor, width // factor, factor, -1)
    return blocks.mean(axis=(1, 3))


def atlas_cell(sprig, cell, atlas_w, atlas_h):
    """Where one leaf lies in its atlas, in texels from the atlas's BOTTOM
    left -- (x0, y0, x1, y1) -- and which way its tip points there, radians.

    A grid's cells are counted along its rows from the top left and all point
    one way. A rectangle is given from the atlas's top left, as a picture is
    read, and carries its own turn (#1294)."""
    if "rects" in sprig:
        rect = sprig["rects"][cell]
        x0, y0 = rect["x"], atlas_h - (rect["y"] + rect["height"])
        return x0, y0, x0 + rect["width"], y0 + rect["height"], math.radians(rect["turn"])
    columns, rows = sprig["grid"]
    cell_w, cell_h = atlas_w / columns, atlas_h / rows
    column, row = cell % columns, cell // columns
    # Row 0 is the atlas's top row.
    left, bottom = column * cell_w, atlas_h - (row + 1) * cell_h
    return (
        int(round(left)),
        int(round(bottom)),
        int(round(left + cell_w)),
        int(round(bottom + cell_h)),
        math.radians(sprig["atlasTurn"]),
    )


def draw_sprig(sprig, pixels):
    """The leaf card at `pixels` a side: its colour with the cut-out in alpha,
    and its tangent-space normals. Rows from the bottom, where the card grows
    from its twig."""
    colour_atlas = read_image(sprig["colour"], False)
    opacity_atlas = read_image(sprig["opacity"], True)
    normal_atlas = read_image(sprig["normal"], True)
    atlas_h, atlas_w = opacity_atlas.shape[:2]
    colour = np.zeros((pixels, pixels, 3), dtype=np.float32)
    normal = np.zeros((pixels, pixels, 3), dtype=np.float32)
    normal[:, :, 2] = 1.0
    alpha = np.zeros((pixels, pixels), dtype=np.float32)
    # The centre of every texel of the card, as shares of its side.
    across, up = np.meshgrid(
        (np.arange(pixels, dtype=np.float32) + 0.5) / pixels,
        (np.arange(pixels, dtype=np.float32) + 0.5) / pixels,
    )
    tone = np.array(sprig["tone"], dtype=np.float32)
    averaged = {}
    for leaf in sprig["leaves"]:
        x0, y0, x1, y1, turn_atlas = atlas_cell(sprig, leaf["cell"], atlas_w, atlas_h)
        solid = opacity_atlas[y0:y1, x0:x1, 0] > OPAQUE
        if not solid.any():
            raise SystemExit(f"{NAME}: the atlas holds no leaf in cell {leaf['cell']}")
        # The leaf's own extent, along the way its tip points.
        ys, xs = np.nonzero(solid)
        centre_x, centre_y = xs.mean() + 0.5, ys.mean() + 0.5
        axis = (-math.sin(turn_atlas), math.cos(turn_atlas))
        along = (xs + 0.5 - centre_x) * axis[0] + (ys + 0.5 - centre_y) * axis[1]
        length_texels = float(along.max() - along.min())
        # The stalk end: the leaf's middle, pushed back along its axis.
        stalk_x = x0 + centre_x + axis[0] * float(along.min())
        stalk_y = y0 + centre_y + axis[1] * float(along.min())
        # From the card to the atlas: turn back by the leaf's own turn, scale
        # the card's share to atlas texels, and turn into the atlas's frame.
        turn = math.radians(leaf["turn"])
        scale = length_texels / leaf["length"]
        dx, dy = across - leaf["at"][0], up - leaf["at"][1]
        leaf_x = (dx * math.cos(turn) + dy * math.sin(turn)) * scale
        leaf_y = (-dx * math.sin(turn) + dy * math.cos(turn)) * scale
        source_x = stalk_x + leaf_x * math.cos(turn_atlas) - leaf_y * math.sin(turn_atlas)
        source_y = stalk_y + leaf_x * math.sin(turn_atlas) + leaf_y * math.cos(turn_atlas)
        inside = (source_x >= x0) & (source_x < x1) & (source_y >= y0) & (source_y < y1)
        # Read from the atlas averaged down to about a texel a texel.
        factor = max(1, int(scale / pixels))
        if factor not in averaged:
            averaged[factor] = tuple(
                shrunk(atlas, factor) for atlas in (opacity_atlas, colour_atlas, normal_atlas)
            )
        opacity_small, colour_small, normal_small = averaged[factor]
        cover = sample(opacity_small, source_x / factor, source_y / factor)[..., 0] * inside
        texel = sample(colour_small, source_x / factor, source_y / factor)[..., :3] * tone
        tangent = sample(normal_small, source_x / factor, source_y / factor)[..., :3] * 2 - 1
        # The atlas's normal, turned as the leaf was: atlas frame to card frame.
        spin = turn - turn_atlas
        turned = np.empty_like(tangent)
        turned[..., 0] = tangent[..., 0] * math.cos(spin) - tangent[..., 1] * math.sin(spin)
        turned[..., 1] = tangent[..., 0] * math.sin(spin) + tangent[..., 1] * math.cos(spin)
        turned[..., 2] = tangent[..., 2]
        # A later leaf lies over an earlier one.
        keep = cover[..., None]
        colour = colour * (1 - keep) + texel * keep
        normal = normal * (1 - keep) + turned * keep
        alpha = alpha * (1 - cover) + cover
    # `colour` is weighted by its cover so far. Where the card is cut away the
    # colour is the leaves' own mean, so that a coarser mip level does not
    # fringe the cut-out with whatever lay behind the leaf in the atlas.
    weight = alpha[..., None]
    mean = colour.sum(axis=(0, 1)) / max(float(weight.sum()), 1e-6)
    colour = np.where(weight >= OPAQUE, colour / np.maximum(weight, 1e-6), mean)
    length = np.maximum(np.linalg.norm(normal, axis=2, keepdims=True), 1e-6)
    normal = normal / length * 0.5 + 0.5
    return colour, alpha, normal


def save_image(name, path, rgba, data):
    """An RGBA picture written as a PNG and kept as the datablock a material reads."""
    height, width = rgba.shape[:2]
    image = bpy.data.images.new(name, width, height, alpha=True)
    if data:
        image.colorspace_settings.name = "Non-Color"
    image.alpha_mode = "STRAIGHT"
    image.pixels.foreach_set(np.clip(rgba, 0, 1).astype(np.float32).ravel())
    image.filepath_raw = path
    image.file_format = "PNG"
    image.save()
    return image


def upstream(path, data):
    """An upstream map as the datablock a material reads."""
    image = bpy.data.images.load(path)
    if data:
        image.colorspace_settings.name = "Non-Color"
    return image


def downsize(image, pixels):
    """Scales an image so its longer side is `pixels`. ⚠️ Called AFTER the
    impostor and the bake, as `process_tree.py` scales a scan's maps: a render
    reads an image again from its file, and a map scaled before one is
    exported at the size it was downloaded at -- measured, 4.5 MB of GLB."""
    side = max(image.size[0], image.size[1])
    factor = pixels / side
    image.scale(max(1, round(image.size[0] * factor)), max(1, round(image.size[1] * factor)))
    if max(image.size[0], image.size[1]) != pixels:
        raise SystemExit(f"{image.name}: {image.size[0]} x {image.size[1]} after scaling to {pixels}")


def dress(material, colour_image, normal_image, cut_out):
    """One material: its colour map, its normal map, a constant roughness, and
    for a leaf card the colour map's alpha."""
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    for node in list(nodes):
        nodes.remove(node)
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    shader.inputs["Roughness"].default_value = 0.85
    shader.inputs["Metallic"].default_value = 0.0
    colour = nodes.new("ShaderNodeTexImage")
    colour.image = colour_image
    links.new(colour.outputs["Color"], shader.inputs["Base Color"])
    relief = nodes.new("ShaderNodeTexImage")
    relief.image = normal_image
    bump = nodes.new("ShaderNodeNormalMap")
    links.new(relief.outputs["Color"], bump.inputs["Color"])
    links.new(bump.outputs["Normal"], shader.inputs["Normal"])
    if cut_out:
        links.new(colour.outputs["Alpha"], shader.inputs["Alpha"])
        material.blend_method = "BLEND"
    material.use_backface_culling = False


bpy.ops.wm.read_factory_settings(use_empty=True)
repeated_triangles = import_scan(IN_GLTF)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
if len(meshes) != 1:
    raise SystemExit(f"expected one mesh: {[o.name for o in meshes]}")
plant = meshes[0]
plant.name = NAME
bpy.context.view_layer.objects.active = plant
plant.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
generated_tris = triangles(plant)
if generated_tris != PLAN["triangles"]:
    raise SystemExit(f"{NAME}: {generated_tris} triangles imported, {PLAN['triangles']} generated")

scene = bpy.context.scene
# ⚠️ ONE thread, and no adaptive sampling, for `process_tree.py`'s reason:
# Cycles sums samples in whatever order its threads finish.
scene.render.threads_mode = "FIXED"
scene.render.threads = 1
scene.cycles.use_adaptive_sampling = False
# The FULL level's size, which the plan carries to every level of the tree, so
# that the runtime stands the full mesh, the middle one and the impostor at one
# size -- as a scan's levels all record the full scan's.
height, width = PLAN["heightMetres"], PLAN["widthMetres"]
report = {
    "generatedTriangles": generated_tris,
    "heightMetres": height,
    "widthMetres": width,
    "repeatedTrianglesDropped": repeated_triangles,
}
plant["oyl_scan_height"] = height
plant["oyl_scan_width"] = width

# --- 2, 3. what it wears ----------------------------------------------------------
stage = os.path.dirname(OUT_GLB)
sprig = PLAN["sprig"]
sprig_colour, sprig_alpha, _ = draw_sprig(sprig, sprig["pixels"])
_, _, sprig_normal = draw_sprig(sprig, sprig["normalPixels"])
report["sprigCoverage"] = float((sprig_alpha >= OPAQUE).mean())
leaf_colour = save_image(
    f"{NAME}_leaves_colour",
    os.path.join(stage, f"{NAME}.{PLAN['level']}.leaves.png"),
    np.dstack([sprig_colour, sprig_alpha]),
    False,
)
leaf_normal = save_image(
    f"{NAME}_leaves_normal",
    os.path.join(stage, f"{NAME}.{PLAN['level']}.leaves-normal.png"),
    np.dstack([sprig_normal, np.ones(sprig_normal.shape[:2], dtype=np.float32)]),
    True,
)
bark = PLAN["bark"]
bark_colour = upstream(bark["colour"], False)
bark_normal = upstream(bark["normal"], True)
by_name = {slot.material.name: slot.material for slot in plant.material_slots}
if sorted(by_name) != ["bark", "leaves"]:
    raise SystemExit(f"{NAME}: expected the materials bark and leaves, not {sorted(by_name)}")
dress(by_name["bark"], bark_colour, bark_normal, False)
dress(by_name["leaves"], leaf_colour, leaf_normal, True)

# --- 4. the impostor strip, from the dressed FULL level ---------------------------
if PLAN["impostor"] is not None:
    frame_w, frame_h = PLAN["impostor"]["frame"]
    ortho = render_impostor(
        scene,
        height,
        width,
        OUT_IMPOSTOR,
        OUT_IMPOSTOR_NORMALS,
        frame_w,
        frame_h,
        tuple(PLAN["impostor"]["normalFrame"]),
    )
    report.update(
        {
            "impostorFrames": IMPOSTOR_FRAMES,
            "impostorFramePixels": [frame_w, frame_h],
            "impostorNormalFramePixels": PLAN["impostor"]["normalFrame"],
            "impostorOrthoScale": ortho,
        }
    )
    plant["oyl_impostor_scale"] = ortho
    plant["oyl_impostor_frames"] = IMPOSTOR_FRAMES

# --- 5. bake ambient occlusion into a colour attribute, per vertex ----------------
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 64
scene.cycles.seed = 430
if scene.world is None:
    scene.world = bpy.data.worlds.new("world")
scene.world.light_settings.distance = 1.5
attribute = plant.data.color_attributes.new("ao", "BYTE_COLOR", "POINT")
plant.data.color_attributes.active_color = attribute
scene.render.bake.target = "VERTEX_COLORS"
bpy.ops.object.select_all(action="DESELECT")
plant.select_set(True)
bpy.context.view_layer.objects.active = plant


def bake_occlusion():
    """One occlusion bake into the attribute, read back a value a vertex."""
    bpy.ops.object.bake(type="AO")
    baked = np.empty(len(attribute.data) * 4, dtype=np.float32)
    attribute.data.foreach_get("color", baked)
    return baked.reshape(-1, 4).copy()


# ⚠️ TWO bakes, because a bake samples a surface AT its vertices and a leaf
# card's are its corners, where the sprig is cut away: baked with the cut-out,
# every leaf vertex reads 0 -- measured, and a canopy drawn black.
#
# 1. With the leaves cut out: the WOOD's occlusion, shaded by the leaves that
#    are really there.
# 2. With every card whole: the LEAF CARDS' occlusion. A whole card hides more
#    than its sprig does, so what it hides is scaled by the share of a card the
#    sprig covers -- a ray that meets a card passes it that often.
wood_occlusion = bake_occlusion()
leaf_shader = next(n for n in by_name["leaves"].node_tree.nodes if n.type == "BSDF_PRINCIPLED")
cut_out = leaf_shader.inputs["Alpha"].links[0]
alpha_from = cut_out.from_socket
by_name["leaves"].node_tree.links.remove(cut_out)
card_occlusion = bake_occlusion()
by_name["leaves"].node_tree.links.new(alpha_from, leaf_shader.inputs["Alpha"])
leaf_slot = next(i for i, slot in enumerate(plant.material_slots) if slot.material.name == "leaves")
is_leaf = np.zeros(len(plant.data.vertices), dtype=bool)
for polygon in plant.data.polygons:
    if polygon.material_index == leaf_slot:
        is_leaf[list(polygon.vertices)] = True
coverage = report["sprigCoverage"]
ao = wood_occlusion
ao[is_leaf, :3] = 1.0 - coverage * (1.0 - card_occlusion[is_leaf, :3])
ao[:, 3] = 1.0
attribute.data.foreach_set("color", ao.ravel())
plant.data.update()
report["meanWoodOcclusion"] = float(ao[~is_leaf, 0].mean())
report["meanLeafOcclusion"] = float(ao[is_leaf, 0].mean())
report["meanWholeCardOcclusion"] = float(card_occlusion[is_leaf, 0].mean())
report["meanWoodOcclusionWithCardsWhole"] = float(card_occlusion[~is_leaf, 0].mean())
# ⚠️ No node reads the colour, on purpose, as `process_rock.py` leaves its own:
# the exporter writes the ACTIVE attribute either way, and where no node reads
# it writes it normalized UNSIGNED_SHORT RGBA, 8 bytes a vertex, where the
# node-wired FLOAT RGB costs 12 -- measured here, 30 KB a tree. The runtime
# multiplies by the vertex colour whenever the geometry carries one.

report["triangles"] = triangles(plant)
if report["triangles"] != generated_tris:
    raise SystemExit(f"{NAME}: {report['triangles']} triangles left of {generated_tris} generated")
downsize(bark_colour, bark["pixels"])
downsize(bark_normal, bark["pixels"])
shipped_images = []
for image in (bark_colour, bark_normal, leaf_colour, leaf_normal):
    shipped_images.append([image.name, image.size[0], image.size[1]])
report["images"] = sorted(shipped_images) if WANT_MAPS else []
report["materials"] = len(plant.material_slots)

# --- 6. export --------------------------------------------------------------------
bpy.ops.object.select_all(action="DESELECT")
plant.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=OUT_GLB,
    export_format="GLB",
    use_selection=True,
    export_vertex_color="ACTIVE",
    export_all_vertex_colors=False,
    # "NONE" keeps each material and its name and writes no image: the runtime
    # pairs a middle part with the full level's part of the same name (#617).
    export_image_format="AUTO" if WANT_MAPS else "NONE",
    export_jpeg_quality=85,
    export_extras=True,
    export_yup=True,
)

with open(OUT_REPORT, "w") as handle:
    json.dump(report, handle, indent=2, sort_keys=True)
print("REPORT", json.dumps(report, sort_keys=True))
