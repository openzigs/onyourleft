# SPDX-License-Identifier: AGPL-3.0-or-later
"""
The one way the pipeline imports a scan's glTF -- #696, #687, #885's review.

`process_tree.py` and `process_rock.py` both call `import_scan(path)` rather
than `bpy.ops.import_scene.gltf`, so a repeated triangle is resolved by one
stable rule whichever kind of asset the scan becomes, and an import that
dropped anything else stops the run. It is not a script of its own: ASSET007
records the script a row was made by, and `provenance.test.ts` holds every
module such a script imports to being committed with this header.

## Why a triangle held twice is dropped here, before Blender sees it

`island_tree_02`'s scan has exactly one: the same three vertices at triangles
26 840 and 27 291 of its wood, wound opposite ways, the only repeated triangle
in any tree, shrub or rock input. The glTF importer ends with
`mesh.validate()`, which finds a repeated face by sorting every face with
`blender::parallel_sort` and dropping whichever of the two the sort put second
-- and a parallel sort does not order equal keys the same way from run to run.
Measured on 2026-09-29 on one Mac: of 150 bare imports, 148 dropped the second
(what is committed) and 2 the first; of 100 runs of `process_tree.py` up to the
wood's collapse or through a whole middle level, 4 made something else, and
every one of the 4 was this. The kept triangle then sits at a different place
in the face list and faces the other way, which moves the wood's face order
through the collapse, the occlusion bake's samples and the glTF's vertex count
(the middle level's 40 bytes, #696) and the full scan's impostor (#687): the
tree script made to keep the SECOND reproduces #696's `54886342…` and #687's
`7a1f1ac9…` and `5a47c511…` byte for byte. #687's "first run in a fresh tree"
was chance, not a cold cache -- about one import in fifty, and `--check`
imports this scan twice.

So the second of any repeated triangle in a primitive is dropped HERE, by a
stable rule -- the first is kept, which is what the committed files were made
from -- and the import is then held to having dropped nothing else, so a
repeat across two primitives, which this cannot see, stops the run rather than
being resolved by the sort. No rock input holds a repeat, so for a rock the
rule drops nothing and the guard is what it adds.
"""

import json

import bpy
import numpy as np
from io_scene_gltf2.io.imp.gltf2_io_binary import BinaryData


def import_scan(path):
    """Import the glTF at `path` into the current scene with every repeated
    triangle's second copy dropped, and return how many were dropped. Raises
    SystemExit when the importer kept any other count of triangles."""
    with open(path) as handle:
        document = json.load(handle)
    triangle_indices = {
        primitive["indices"]
        for mesh in document.get("meshes", [])
        for primitive in mesh["primitives"]
        if "indices" in primitive and primitive.get("mode", 4) == 4
    }
    dropped = 0
    decode_accessor = BinaryData.decode_accessor

    def decode_without_repeats(gltf, accessor_idx, cache=False):
        """The importer's own decode, with a repeated triangle's second copy
        dropped from a triangle list's indices -- first occurrences kept, in
        order."""
        nonlocal dropped
        array = decode_accessor(gltf, accessor_idx, cache)
        if accessor_idx not in triangle_indices or len(array) % 3 != 0:
            return array
        triangles_of = array.reshape(-1, 3)
        _, first = np.unique(np.sort(triangles_of, axis=1), axis=0, return_index=True)
        if len(first) == len(triangles_of):
            return array
        dropped += len(triangles_of) - len(first)
        return triangles_of[np.sort(first)].reshape(-1, 1)

    BinaryData.decode_accessor = staticmethod(decode_without_repeats)
    try:
        bpy.ops.import_scene.gltf(filepath=path)
    finally:
        BinaryData.decode_accessor = staticmethod(decode_accessor)

    # What `mesh.validate()` may still have dropped is its choice, not the
    # pipeline's: refuse it rather than ship a coin toss.
    imported = sum(len(mesh.polygons) for mesh in bpy.data.meshes)
    declared = -dropped
    for mesh in document.get("meshes", []):
        for primitive in mesh["primitives"]:
            if primitive.get("mode", 4) != 4:
                continue
            counted = primitive.get("indices", primitive["attributes"]["POSITION"])
            declared += document["accessors"][counted]["count"] // 3
    if imported != declared:
        raise SystemExit(
            f"the importer kept {imported} triangles of {declared}: "
            "mesh.validate() dropped some, and which it drops is not reproducible"
        )
    return dropped
