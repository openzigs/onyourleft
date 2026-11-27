# SPDX-License-Identifier: AGPL-3.0-or-later
"""
The facade pieces a mapped footprint in a town is wrapped in -- #3334, the
owner's direction of 2026-11-26 on it: pieces of Quaternius's CC0 Downtown
City MegaKit, in ONE GLB and mapped into ONE colour atlas, so every wrapped
building costs one draw call between them (`src/game/facade-kit.ts`).

Run by `process-assets.ts`, never by hand:

    Blender -b --factory-startup --python process_downtown_kit.py -- \
        <source-dir> <out.glb> <report.json> <atlas.png> <atlas-pixels> \
        <margin-pixels> <piece>...

`<atlas.png>` is written beside `<out.glb>`. Each `<piece>` is
`id|Source|metres wide|metres tall|x|y|width|height|options`: the name it
ships under, its file in the kit's glTF export (empty where this script makes
the whole piece), the rectangle its bay is, its cell of the atlas in pixels
from the TOP-LEFT, and its options, `key=value` joined by `;` (a value's
several names by `,`):

- `lies=1`: the kit models it lying flat (the roof);
- `mesh=<id>`: it is piece `<id>` in another skin -- its cell is baked and no
  mesh of its own is written;
- `skin=render`: its wall is baked from the kit's concrete, not its brick;
- `wall=`, `accent=`, `fixed=`: the kit materials that are those classes in
  this piece, where they are not the classes of CLASS_OF below;
- `glass=lit-1|lit-2|dark`: what is seen through its glass;
- `leaf=<Source>`: the kit's door leaf, hung in its frame;
- `made=awning|fascia|balcony|ladder`: what this script makes itself (MADE).

The cells are `facade-kit.ts` section kitCells', so the pipeline and the
renderer read one layout.

1. Import each piece's glTF through `gltf_import.py`, and write its node's
   placement into its vertices. Blender's axes: the wall's face is the plane
   y = 0, its outside is -Y, X runs along it and Z up it.
2. Drop the faces nobody outside a building sees: the kit's `MI_InteriorWall`
   (the wall's inner face), `MI_FakeInterior` (a plane behind the glass that
   the kit's own shader draws a room on, which no shader here does),
   `MI_InteriorFloor` and `MI_InteriorRoof`.
3. A piece that lies flat is stood up, its top turned to face -Y, so that it
   is baked like a wall. A door frame's opening is closed: with the kit's own
   door leaf where the piece names one, and a pane of glass behind it where
   it does not. MADE: what the kit does not hold is made here, of a few boxes
   and quads -- an awning, a sign band, a ladder, and the landing under the
   kit's own railing.
4. Two new texture-coordinate sets a piece. `atlas`: every corner projected
   straight onto the wall's plane, into the piece's cell, so the piece in
   relief and a flat card of its rectangle wear the same texels. `tint`: the
   class of the corner's face in its first coordinate (0 fixed, 1 wall,
   2 trim, 3 accent -- `facade-kit.ts` section KIT_TINT_CLASSES), which the
   renderer multiplies by the building's own colour for that class.
5. Each piece's colour baked into its cell with Cycles, from the piece onto a
   card of its rectangle (selected to active), as an emission: colour only,
   no light. Brick, metal, slate and asphalt are the kit's own pictures
   through the kit's own coordinates. A `trim` or `accent` face, a `render`
   wall and a stone one are baked NEUTRAL: the picture's brightness about its
   own mean, at NEUTRAL_LEVEL, so that the building's colour is the colour
   drawn and the picture's grain stays. The kit tells its pale brick, its
   green and its dark trim apart in its own engine shader, which a glTF does
   not carry; here the dark trim is the trim's picture darkened (DARK), and
   the others are a class. Glass shows one of the kit's own interior pictures
   laid across the piece's glass, dimmed under a sky's reflection.
6. Drop every material, the kit's own coordinates and its vertex colours,
   triangulate, dissolve faces of no area, shade every face flat, and export
   the GLB: one mesh a piece that has its own, named by its id.

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
    name, source, wide, tall, x, y, width, height, options = spec.split("|")
    chosen = dict(option.split("=", 1) for option in options.split(";") if option)
    PIECES.append(
        {
            "id": name,
            "source": source,
            "wide": float(wide),
            "tall": float(tall),
            "cell": (int(x), int(y), int(width), int(height)),
            "lies": chosen.get("lies") == "1",
            "mesh": chosen.get("mesh"),
            "skin": chosen.get("skin"),
            "wall": chosen.get("wall", "").split(",") if "wall" in chosen else None,
            "accent": chosen.get("accent", "").split(","),
            "fixed": chosen.get("fixed", "").split(","),
            "glass": chosen.get("glass", "dark"),
            "leaf": chosen.get("leaf"),
            "made": chosen.get("made"),
        }
    )

# Where the kit's glTF export is, inside its archive.
EXPORT = "Exports/glTF (Godot)"
# Step 2: the materials whose faces are dropped.
UNSEEN = ("MI_InteriorWall", "MI_FakeInterior", "MI_InteriorFloor", "MI_InteriorRoof")
GLASS_MATERIAL = "MI_Glass"
# Step 4: the classes, `facade-kit.ts` section KIT_TINT_CLASSES' places.
FIXED, WALL, TRIM, ACCENT = 0, 1, 2, 3
# Step 4: each kit material's class, where a piece's options do not say.
CLASS_OF = {
    "MI_RedBrick": WALL,
    "MI_RedBrick_Pale": WALL,
    "MI_Trim": TRIM,
    "MI_Trim_Green": ACCENT,
}
# Step 5: the grey a neutral class is baked at, linear (`facade-kit.ts`
# section KIT_NEUTRAL_LEVEL), and each neutral picture's mean brightness and
# how much of its grain is kept: the trim's cream field (its picture also
# holds a brown band, which stays darker), and the concrete a render wall is.
NEUTRAL_LEVEL = 0.8
NEUTRAL = {
    "T_Trim_BaseColor.png": (0.36, 0.7),
    "T_Concrete_BaseColor.png": (0.205, 0.3),
}
RENDER_PICTURE = "T_Concrete_BaseColor.png"
# Step 5: the kit's dark trim, as a share of its trim picture.
DARK = (0.16, 0.15, 0.15)
DARK_MATERIAL = "MI_Trim_Dark"
# Step 5: glass. The kit's interior picture a kind of glass shows, how bright
# it is shown, the sky's colour over it (linear), and how much of the sky.
GLASS = {
    "lit-1": ("T_lit_interior_1.png", 0.55, 0.3),
    "lit-2": ("T_lit_interior_2.png", 0.55, 0.3),
    "dark": ("T_dark_interior.png", 0.6, 0.45),
}
SKY = (0.2, 0.27, 0.36)
# Step 3: how far behind the wall's face a door's pane or leaf stands, metres,
# and how far along the wall the kit's leaf (hinged at its own origin, a metre
# wide) is moved to stand in the middle of its frame.
PANE_BEHIND = 0.07
LEAF_ALONG = 0.5
LEAF_BEHIND = 0.1
# Step 3, MADE: flat colours (linear) for what this script makes.
MADE_DARK = (0.03, 0.03, 0.035)
STRIPE = (0.95, 0.6)
BOARD = (0.9, 0.72)
# Step 3, MADE, metres. An awning: its strips across a bay, where it meets the
# wall, how far it reaches, where its edge hangs and how deep its valance is.
AWNING = {"strips": 8, "top": 0.95, "reach": 0.9, "edge": 0.45, "valance": 0.2}
# A sign band: how far it stands off the wall, and its board's inset.
FASCIA = {"proud": 0.08, "inset": 0.12}
# A landing: its slab's thickness, and how far it reaches (the kit's railing).
LANDING = {"slab": 0.06, "reach": 1.0, "half": 0.98}
# A ladder: its stringers' half-spacing and size, its rungs' pitch and size,
# and how far off the wall it stands (at the landing's outer edge).
LADDER = {"half": 0.2, "bar": 0.04, "pitch": 0.3, "rung": 0.03, "off": 0.92}
# Step 5: how far before the wall's face the bake's rays start, metres --
# past every piece's relief, a landing's metre too -- and how far they reach.
CAGE_METRES = 1.2
RAY_METRES = 2.5
BAKE_SAMPLES = 4
ATLAS_UV = "atlas"
TINT_UV = "tint"
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


def picture_of(uri):
    return bpy.data.images.load(os.path.join(SOURCE_DIR, EXPORT, uri), check_existing=True)


def emitting(name, tint):
    """A new material that emits, its class in its name (step 4 reads it
    back); returns it with its node tree and its emission node."""
    material = bpy.data.materials.new(f"{name}_c{tint}")
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    emit = nodes.new("ShaderNodeEmission")
    output = nodes.new("ShaderNodeOutputMaterial")
    links.new(emit.outputs["Emission"], output.inputs["Surface"])
    return material, nodes, links, emit


def flat(name, tint, colour):
    """A material that emits one colour."""
    material, _, _, emit = emitting(name, tint)
    emit.inputs["Color"].default_value = (*colour, 1.0)
    return material


def pictured(name, tint, uri, uv_map, neutral=False, scaled=None):
    """A material that emits the kit's picture `uri` through `uv_map`: as it
    is; `neutral`, its brightness about its mean at NEUTRAL_LEVEL; or
    `scaled`, multiplied by a colour."""
    material, nodes, links, emit = emitting(name, tint)
    coordinates = nodes.new("ShaderNodeUVMap")
    coordinates.uv_map = uv_map
    image = nodes.new("ShaderNodeTexImage")
    image.image = picture_of(uri)
    links.new(coordinates.outputs["UV"], image.inputs["Vector"])
    colour = image.outputs["Color"]
    if neutral:
        mean, grain = NEUTRAL[uri]
        grey = nodes.new("ShaderNodeRGBToBW")
        links.new(colour, grey.inputs["Color"])

        def math_node(operation, value, constant):
            node = nodes.new("ShaderNodeMath")
            node.operation = operation
            links.new(value, node.inputs[0])
            node.inputs[1].default_value = constant
            return node.outputs["Value"]

        # level * (1 + grain * (brightness / mean - 1)), never past 1.
        value = math_node("DIVIDE", grey.outputs["Val"], mean)
        value = math_node("SUBTRACT", value, 1.0)
        value = math_node("MULTIPLY", value, grain)
        value = math_node("ADD", value, 1.0)
        value = math_node("MULTIPLY", value, NEUTRAL_LEVEL)
        value = math_node("MINIMUM", value, 1.0)
        colour = value
    elif scaled is not None:
        mix = nodes.new("ShaderNodeMixRGB")
        mix.blend_type = "MULTIPLY"
        mix.inputs["Fac"].default_value = 1.0
        mix.inputs["Color2"].default_value = (*scaled, 1.0)
        links.new(colour, mix.inputs["Color1"])
        colour = mix.outputs["Color"]
    links.new(colour, emit.inputs["Color"])
    return material


def glazed(name, kind, bounds):
    """Glass: the kit's interior picture laid across `bounds` (the piece's
    glass on the wall's plane, x0, x1, z0, z1), dimmed, under the sky."""
    uri, bright, sky = GLASS[kind]
    material, nodes, links, emit = emitting(name, FIXED)
    x0, x1, z0, z1 = bounds
    place = nodes.new("ShaderNodeTexCoord")
    split = nodes.new("ShaderNodeSeparateXYZ")
    links.new(place.outputs["Object"], split.inputs["Vector"])

    def across(output, low, high):
        node = nodes.new("ShaderNodeMapRange")
        node.inputs["From Min"].default_value = low
        node.inputs["From Max"].default_value = high if high > low else low + 1.0
        links.new(split.outputs[output], node.inputs["Value"])
        return node.outputs["Result"]

    join = nodes.new("ShaderNodeCombineXYZ")
    links.new(across("X", x0, x1), join.inputs["X"])
    links.new(across("Z", z0, z1), join.inputs["Y"])
    image = nodes.new("ShaderNodeTexImage")
    image.image = picture_of(uri)
    image.extension = "EXTEND"
    links.new(join.outputs["Vector"], image.inputs["Vector"])
    dim = nodes.new("ShaderNodeMixRGB")
    dim.blend_type = "MULTIPLY"
    dim.inputs["Fac"].default_value = 1.0
    dim.inputs["Color2"].default_value = (bright, bright, bright, 1.0)
    links.new(image.outputs["Color"], dim.inputs["Color1"])
    over = nodes.new("ShaderNodeMixRGB")
    over.blend_type = "MIX"
    over.inputs["Fac"].default_value = sky
    over.inputs["Color2"].default_value = (*SKY, 1.0)
    links.new(dim.outputs["Color"], over.inputs["Color1"])
    links.new(over.outputs["Color"], emit.inputs["Color"])
    return material


def class_of(piece, name):
    """The class of the kit material `name` in `piece` -- step 4."""
    if name in piece["fixed"]:
        return FIXED
    if name in piece["accent"]:
        return ACCENT
    if piece["wall"] is not None:
        if name in piece["wall"]:
            return WALL
        # A piece that names its own wall has no brick for one.
        return CLASS_OF.get(name, FIXED) if CLASS_OF.get(name) != WALL else FIXED
    return CLASS_OF.get(name, FIXED)


def kit_part(piece, source, uv_name=None):
    """Steps 1 and 2 for one of the kit's files, and step 5's materials on it:
    returns the object, its kit coordinate set's name, and its triangles as
    the kit ships them."""
    path = os.path.join(SOURCE_DIR, EXPORT, source + ".gltf")
    before = set(bpy.data.objects)
    repeated = import_scan(path)
    parts = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
    if len(parts) != 1:
        raise SystemExit(f"{source}: expected one mesh, found {len(parts)}")
    obj = parts[0]
    # Step 1: its whole placement written into its vertices.
    world = obj.matrix_world.copy()
    obj.parent = None
    obj.data.transform(world)
    obj.matrix_world = Matrix.Identity(4)
    for empty in [o for o in bpy.data.objects if o not in before and o.type != "MESH"]:
        bpy.data.objects.remove(empty, do_unlink=True)
    source_triangles = triangles(obj)

    # Step 2: the faces nobody outside sees.
    names = [slot.material.name.split(".")[0] for slot in obj.material_slots]
    work = bmesh.new()
    work.from_mesh(obj.data)
    unseen = [face for face in work.faces if names[face.material_index] in UNSEEN]
    bmesh.ops.delete(work, geom=unseen, context="FACES")
    work.to_mesh(obj.data)
    work.free()
    obj.data.update()
    if uv_name is not None:
        obj.data.uv_layers[0].name = uv_name
    kit_uv = obj.data.uv_layers[0].name

    # Where its glass is, on the wall's plane: what an interior is laid across.
    glass = [
        obj.data.vertices[index].co
        for polygon in obj.data.polygons
        if names[polygon.material_index] == GLASS_MATERIAL
        for index in polygon.vertices
    ]
    bounds = (
        (min(v.x for v in glass), max(v.x for v in glass), 0.0, piece["tall"])
        if glass
        else (0.0, 1.0, 0.0, 1.0)
    )

    # Step 5's materials, each slot given its own IN PLACE.
    # ⚠️ Clearing the slots first would put every face in slot 0, and the
    # whole piece in its first picture.
    pictures = base_colours(path)
    for index, name in enumerate(names):
        label = f"{piece['id']}_{source}_{index}"
        tint = class_of(piece, name)
        uri = pictures.get(name)
        if name in UNSEEN:
            # An unseen material's slot is left with no face, and wears anything.
            made = flat(label, FIXED, MADE_DARK)
        elif name == GLASS_MATERIAL:
            made = glazed(label, piece["glass"], bounds)
        elif uri is None:
            raise SystemExit(f"{piece['id']}: {name} has no colour picture")
        elif tint == WALL and piece["skin"] == "render":
            made = pictured(label, tint, RENDER_PICTURE, kit_uv, neutral=True)
        elif name == DARK_MATERIAL:
            made = pictured(label, FIXED, uri, kit_uv, scaled=DARK)
        elif tint != FIXED and uri in NEUTRAL:
            made = pictured(label, tint, uri, kit_uv, neutral=True)
        else:
            made = pictured(label, tint, uri, kit_uv)
        obj.data.materials[index] = made
    return obj, kit_uv, source_triangles, repeated


def joined(obj, others):
    """`others` joined into `obj`."""
    bpy.ops.object.select_all(action="DESELECT")
    for other in others:
        other.select_set(True)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.join()
    return bpy.context.view_layer.objects.active


class Made:
    """Step 3, MADE: a mesh of boxes and quads, each face in a material."""

    def __init__(self, name, uv_name):
        self.name = name
        self.uv_name = uv_name
        self.vertices = []
        self.faces = []
        self.slots = []
        self.materials = []

    def slot(self, material):
        if material not in self.materials:
            self.materials.append(material)
        return self.materials.index(material)

    def quad(self, corners, material):
        """Four corners, counter-clockwise seen from where it faces."""
        start = len(self.vertices)
        self.vertices.extend(corners)
        self.faces.append(tuple(range(start, start + len(corners))))
        self.slots.append(self.slot(material))

    def box(self, x0, x1, y0, y1, z0, z1, material):
        """A box, its six faces outward. y0 is its outer face (the lesser y)."""
        a, b, c, d = (x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)
        e, f, g, h = (x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1)
        for corners in (
            (a, b, c, d),  # outward, -Y
            (f, e, h, g),  # the wall's side
            (e, a, d, h),  # -X
            (b, f, g, c),  # +X
            (d, c, g, h),  # up
            (e, f, b, a),  # down
        ):
            self.quad(corners, material)

    def build(self):
        mesh = bpy.data.meshes.new(self.name)
        mesh.from_pydata(self.vertices, [], self.faces)
        for material in self.materials:
            mesh.materials.append(material)
        for polygon, slot in zip(mesh.polygons, self.slots):
            polygon.material_index = slot
        mesh.uv_layers.new(name=self.uv_name)
        mesh.update()
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj


def make_awning(piece):
    """An awning across a bay: strips of two brightnesses of its canvas, each
    a slope seen from above and from below, and a valance; a cheek each end."""
    made = Made(piece["id"], "kit")
    stripes = [flat(f"{piece['id']}_stripe_{i}", ACCENT, (v, v, v)) for i, v in enumerate(STRIPE)]
    half = piece["wide"] / 2
    top, reach, edge = AWNING["top"], -AWNING["reach"], AWNING["edge"]
    foot = edge - AWNING["valance"]
    step = piece["wide"] / AWNING["strips"]
    for strip in range(AWNING["strips"]):
        x0, x1 = -half + strip * step, -half + (strip + 1) * step
        canvas = stripes[strip % 2]
        made.quad([(x0, reach, edge), (x1, reach, edge), (x1, 0.0, top), (x0, 0.0, top)], canvas)
        made.quad([(x0, 0.0, top), (x1, 0.0, top), (x1, reach, edge), (x0, reach, edge)], canvas)
        made.quad([(x0, reach, foot), (x1, reach, foot), (x1, reach, edge), (x0, reach, edge)], canvas)
    for x, outside in ((-half, True), (half, False)):
        cheek = [(x, reach, edge), (x, 0.0, edge), (x, 0.0, top)]
        made.quad(cheek if outside else cheek[::-1], stripes[0])
        made.quad(cheek[::-1] if outside else cheek, stripes[0])
    return made.build()


def make_fascia(piece):
    """A sign band: a board the building's accent, and a panel its trim. No
    text, no brand, no logo (`building-paint.ts` section SIGN_PAINTS' rule)."""
    made = Made(piece["id"], "kit")
    frame = flat(f"{piece['id']}_frame", ACCENT, (BOARD[1],) * 3)
    panel = flat(f"{piece['id']}_panel", TRIM, (BOARD[0],) * 3)
    half, tall = piece["wide"] / 2, piece["tall"]
    proud, inset = -FASCIA["proud"], FASCIA["inset"]
    made.box(-half, half, proud, 0.0, 0.0, tall, frame)
    y = proud - 0.005
    made.quad(
        [
            (-half + inset, y, inset),
            (half - inset, y, inset),
            (half - inset, y, tall - inset),
            (-half + inset, y, tall - inset),
        ],
        panel,
    )
    return made.build()


def make_ladder(piece):
    """A fire escape's ladder, a storey tall: two stringers and its rungs."""
    made = Made(piece["id"], "kit")
    metal = flat(f"{piece['id']}_metal", FIXED, MADE_DARK)
    half, bar, off = LADDER["half"], LADDER["bar"], -LADDER["off"]
    for x in (-half, half):
        made.box(x - bar / 2, x + bar / 2, off - bar, off, 0.0, piece["tall"], metal)
    rung = LADDER["rung"]
    count = int(round(piece["tall"] / LADDER["pitch"]))
    for index in range(1, count):
        z = index * LADDER["pitch"]
        made.box(-half, half, off - bar, off, z - rung / 2, z + rung / 2, metal)
    return made.build()


def make_landing(piece, kit_uv):
    """The landing under the kit's railing: one slab."""
    made = Made(f"{piece['id']}_slab", kit_uv)
    metal = flat(f"{piece['id']}_slab", FIXED, MADE_DARK)
    made.box(-LANDING["half"], LANDING["half"], -LANDING["reach"], 0.0, 0.0, LANDING["slab"], metal)
    return made.build()


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
    source_triangles = 0
    if piece["made"] == "awning":
        obj = make_awning(piece)
    elif piece["made"] == "fascia":
        obj = make_fascia(piece)
    elif piece["made"] == "ladder":
        obj = make_ladder(piece)
    else:
        obj, kit_uv, source_triangles, dropped = kit_part(piece, piece["source"])
        repeated += dropped
        if piece["made"] == "balcony":
            # The kit's railing stands at its stairs' head: its foot brought
            # down onto the slab this script lays under it.
            low = min(v.co.z for v in obj.data.vertices)
            obj.data.transform(Matrix.Translation((0.0, 0.0, LANDING["slab"] - low)))
            obj = joined(obj, [make_landing(piece, kit_uv)])
        if piece["leaf"] is not None:
            # Step 3: the kit's own door leaf, in the middle of the frame.
            leaf, _, leaf_triangles, dropped = kit_part(piece, piece["leaf"], kit_uv)
            repeated += dropped
            source_triangles += leaf_triangles
            leaf.data.transform(Matrix.Translation((LEAF_ALONG, LEAF_BEHIND, 0.0)))
            obj = joined(obj, [leaf])
        elif piece["source"].startswith("DoorFrame"):
            # Step 3: or its opening closed with a pane.
            pane = quad(f"{piece['id']}_pane", piece, PANE_BEHIND)
            half = piece["wide"] / 2
            pane.data.materials.append(
                glazed(f"{piece['id']}_pane", piece["glass"], (-half, half, 0.0, piece["tall"]))
            )
            # The kit's coordinate set on the pane too, so the join keeps one set of that name.
            pane.data.uv_layers.new(name=kit_uv)
            obj = joined(obj, [pane])
    obj.name = piece["id"]
    obj.data.name = piece["id"]

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

    # Step 4: the projection onto the wall's plane, into the piece's cell; and each
    # corner's class, read back off its face's material's name.
    classes = [int(slot.material.name.split(".")[0].rsplit("_c", 1)[1]) for slot in obj.material_slots]
    obj.data.uv_layers.new(name=ATLAS_UV)
    obj.data.uv_layers.new(name=TINT_UV)
    # ⚠️ Read back by name: adding a set moves the others in memory.
    layer = obj.data.uv_layers[ATLAS_UV]
    tint = obj.data.uv_layers[TINT_UV]
    for polygon in obj.data.polygons:
        for index in polygon.loop_indices:
            co = obj.data.vertices[obj.data.loops[index].vertex_index].co
            layer.data[index].uv = cell_uv(piece, co.x, co.z)
            tint.data[index].uv = (float(classes[polygon.material_index]), 0.0)
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

# Step 6: geometry, the atlas's coordinates and the classes only.
placeholder = bpy.data.materials.new("downtown_kit_atlas")
written = []
for piece, obj, source_triangles in made:
    for name in [l.name for l in obj.data.uv_layers if l.name not in (ATLAS_UV, TINT_UV)]:
        obj.data.uv_layers.remove(obj.data.uv_layers[name])
    obj.data.uv_layers[ATLAS_UV].active_render = True
    obj.data.uv_layers.active = obj.data.uv_layers[ATLAS_UV]
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
    if piece["mesh"] is None:
        written.append(obj)
# What `--check` holds a run to (`sources.ts` section EXPECTED_REPORTS).
report.update(
    {
        "pieces": len(made),
        "meshes": len(written),
        "triangles": sum(each["triangles"] for each in report["each"].values()),
        "sourceTriangles": sum(each["sourceTriangles"] for each in report["each"].values()),
        "repeatedTrianglesDropped": repeated,
    }
)

bpy.ops.object.select_all(action="DESELECT")
for obj in written:
    obj.select_set(True)
bpy.context.view_layer.objects.active = written[0]
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
