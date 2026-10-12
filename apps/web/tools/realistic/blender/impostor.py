# SPDX-License-Identifier: AGPL-3.0-or-later
"""
A tree's eight-view impostor strip and its normals -- #430, #630, and since
#1283 one module for both kinds of tree.

`process_tree.py` renders a photoscan's far band from the full scan, and
`process_generated_tree.py` a generated tree's from its full level. What the
runtime reads off either is the same -- which frame faces the camera, how the
normals are encoded, how big the quad is -- so it is written once, here. It is
not a script of its own: ASSET007 records the script a row was made by, and
`provenance.test.ts` holds every module such a script imports to being
committed with this header.

⚠️ **Moved out of `process_tree.py` statement for statement by #1283**, and
`realistic:process --check` reproduced every scan's two strips byte for byte
afterwards. The one thing added is `normal_frame`, which a scan does not pass.

## The convention, which `three-renderer.ts` section impostorMaterial reads

Frame k is the plant seen from azimuth 2*pi*k/8, anticlockwise from -Y in
Blender, which is +Z -- the model's front -- in three. The strip is centred on
half the plant's height and `ortho` metres tall, which is what `render_impostor`
returns for the file's extras.

The normals are in the plant's OWN frame in three's axes -- x across, y up, z
the model's front (Blender's -Y) -- which is Blender's world here, because the
plant stands unrotated on the origin; encoded n * 0.5 + 0.5, no alpha (the
colour strip's alpha is the silhouette), and the background 0.5 grey, the zero
vector. Cycles' Normal pass, which respects the leaves' alpha: a pixel's normal
is the first surface at least `pass_alpha_threshold` opaque.
"""

import math

import bpy
import numpy as np

# The strip: eight views.
IMPOSTOR_FRAMES = 8
# #630: samples a pixel for the normal pass. The pass is data, not light: a
# few samples only anti-alias the silhouette and the leaf edges.
NORMAL_SAMPLES = 8


def render_impostor(scene, height, width, out_colour, out_normals, frame_w, frame_h, normal_frame=None):
    """Render the plant standing on the origin -- `height` tall and `width`
    across -- as eight orthographic views on one transparent strip at
    `out_colour`, each `frame_w` x `frame_h`, and the same views' normals at
    `out_normals`, each `normal_frame` (the colour's size when it is None).
    Every scene setting it changes is put back. Returns the strip's height in
    the plant's own units."""
    camera_data = bpy.data.cameras.new("impostor")
    camera_data.type = "ORTHO"
    ortho = max(height, width * frame_h / frame_w) * 1.02
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
    scene.render.resolution_x = frame_w
    scene.render.resolution_y = frame_h
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 32
    scene.cycles.seed = 430
    scene.cycles.use_denoising = False
    scene.view_settings.view_transform = "Standard"
    strip = np.zeros((frame_h, frame_w * IMPOSTOR_FRAMES, 4), dtype=np.float32)
    distance = max(height, width) * 4
    for frame in range(IMPOSTOR_FRAMES):
        # Frame k is the plant seen from azimuth 2*pi*k/8, anticlockwise from
        # -Y in Blender, which is +Z -- the model's front -- in three. The
        # runtime picks the frame by the same rule.
        angle = 2 * math.pi * frame / IMPOSTOR_FRAMES
        camera.location = (math.sin(angle) * distance, -math.cos(angle) * distance, height / 2)
        camera.rotation_euler = (math.pi / 2, 0, angle)
        path = f"{out_colour}.frame{frame}.png"
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        image = bpy.data.images.load(path)
        pixels = np.array(image.pixels[:], dtype=np.float32).reshape(frame_h, frame_w, 4)
        strip[:, frame * frame_w : (frame + 1) * frame_w, :] = pixels
        bpy.data.images.remove(image)
    out = bpy.data.images.new("impostor", frame_w * IMPOSTOR_FRAMES, frame_h, alpha=True)
    out.pixels.foreach_set(strip.ravel())
    out.filepath_raw = out_colour
    out.file_format = "PNG"
    out.save()
    bpy.data.images.remove(out)

    # --- 2b. #630: the same eight views' NORMALS ------------------------------
    # AFTER the colour strip, and every setting it changes is put back below,
    # so the colour strip and everything after it are the bytes they were.
    #
    # The convention, which `three-renderer.ts` section impostorMaterial reads:
    # the plant's OWN frame in three's axes -- x across, y up, z the model's
    # front (Blender's -Y) -- which is Blender's world here, because the plant
    # stands unrotated on the origin; encoded n * 0.5 + 0.5, no alpha (the
    # colour strip's alpha is the silhouette), and the background 0.5 grey,
    # the zero vector. Cycles' Normal pass, which respects the leaves' alpha:
    # a pixel's normal is the first surface at least `pass_alpha_threshold`
    # opaque.
    view_layer = scene.view_layers[0]
    view_layer.use_pass_normal = True
    scene.use_nodes = True
    tree = scene.node_tree
    for node in list(tree.nodes):
        tree.nodes.remove(node)
    layers = tree.nodes.new("CompositorNodeRLayers")
    separate = tree.nodes.new("CompositorNodeSeparateColor")
    combine = tree.nodes.new("CompositorNodeCombineColor")
    composite = tree.nodes.new("CompositorNodeComposite")
    tree.links.new(layers.outputs["Normal"], separate.inputs["Image"])
    # (x, y, z) in Blender to (x, z, -y) in three, each * 0.5 + 0.5.
    for channel, source, sign in (("Red", "Red", 0.5), ("Green", "Blue", 0.5), ("Blue", "Green", -0.5)):
        scale = tree.nodes.new("CompositorNodeMath")
        scale.operation = "MULTIPLY_ADD"
        scale.use_clamp = True
        scale.inputs[1].default_value = sign
        scale.inputs[2].default_value = 0.5
        tree.links.new(separate.outputs[source], scale.inputs[0])
        tree.links.new(scale.outputs[0], combine.inputs[channel])
    tree.links.new(combine.outputs["Image"], composite.inputs["Image"])
    samples = scene.cycles.samples
    scene.cycles.samples = NORMAL_SAMPLES
    scene.render.film_transparent = False
    scene.render.image_settings.color_mode = "RGB"
    scene.view_settings.view_transform = "Raw"
    # The normals may be rendered smaller than the colour: light varies slowly
    # across a crown, and the runtime reads both strips by one coordinate.
    normal_w, normal_h = normal_frame if normal_frame is not None else (frame_w, frame_h)
    scene.render.resolution_x = normal_w
    scene.render.resolution_y = normal_h
    normals = np.zeros((normal_h, normal_w * IMPOSTOR_FRAMES, 3), dtype=np.float32)
    for frame in range(IMPOSTOR_FRAMES):
        angle = 2 * math.pi * frame / IMPOSTOR_FRAMES
        camera.location = (math.sin(angle) * distance, -math.cos(angle) * distance, height / 2)
        camera.rotation_euler = (math.pi / 2, 0, angle)
        path = f"{out_normals}.frame{frame}.png"
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        image = bpy.data.images.load(path)
        image.colorspace_settings.name = "Non-Color"
        pixels = np.array(image.pixels[:], dtype=np.float32).reshape(normal_h, normal_w, 4)
        normals[:, frame * normal_w : (frame + 1) * normal_w, :] = pixels[:, :, :3]
        bpy.data.images.remove(image)
    out = bpy.data.images.new("impostor-normals", normal_w * IMPOSTOR_FRAMES, normal_h, alpha=False)
    out.colorspace_settings.name = "Non-Color"
    rgba = np.ones((normal_h, normal_w * IMPOSTOR_FRAMES, 4), dtype=np.float32)
    rgba[:, :, :3] = normals
    out.pixels.foreach_set(rgba.ravel())
    out.filepath_raw = out_normals
    out.file_format = "PNG"
    out.save()
    bpy.data.images.remove(out)
    # Put back everything the colour strip was rendered with.
    for node in list(tree.nodes):
        tree.nodes.remove(node)
    scene.use_nodes = False
    view_layer.use_pass_normal = False
    scene.cycles.samples = samples
    scene.render.film_transparent = True
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "Standard"
    scene.render.resolution_x = frame_w
    scene.render.resolution_y = frame_h
    bpy.data.objects.remove(camera, do_unlink=True)
    bpy.data.objects.remove(sun_obj, do_unlink=True)
    return ortho
