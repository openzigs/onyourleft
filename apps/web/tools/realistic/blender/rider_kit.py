# SPDX-License-Identifier: AGPL-3.0-or-later
"""
The On Your Left house kit -- every number it is drawn from, in ONE file (#623).

`process_rider.py` imports this and nothing else decides what the kit looks
like. It is this repository's own design, drawn from arithmetic, dedicated
CC0-1.0 in `ASSETS.toml` as the app icons are (ADR 0024 D-5), and derived from
nobody's kit, livery or picture (ADR 0009 L1/L2). It carries no text and no
team, sponsor, manufacturer or brand mark. The one mark on it is this app's own
two chevrons, drawn by `apps/web/tools/icons/generate-icons.ts`' arithmetic
(`markCoverage`) and handed to Blender as a picture by `process-assets.ts`.

## The main colour is NOT here

The jersey's main colour is one parameter the RENDERER sets
(`three-renderer.ts` section `RealisticRiderBelt`, from `bicycle.ts` section
`RIDER_PALETTE`'s jersey, which is the app's `accent`). The main-colour panels
are stored as a SHADE -- 1 for a panel in the main colour itself, less for one
a darker cut of it -- in the blue channel of the occlusion/roughness map, with
the colour map black there, and the renderer adds `shade * main colour`. So the
kit is drawn once, and a rider's own colour (the later half of #623) is one
uniform.

## Units and frame

Metres, Blender's frame: Z up, the rider facing -Y in MakeHuman's rest pose,
the rider's LEFT at +X. Colours are LINEAR light (the colour map is written
sRGB-encoded by `process_rider.py`). Every length is measured from the
skeleton's own joints, which `process_rider.py` builds from the mesh AFTER the
build targets are applied, so a different build moves the cuffs with the limbs.
"""

# --- where each garment ends ----------------------------------------------------
# A fraction along a limb is 0 at the joint nearer the body and 1 at the next.

# The bib shorts' leg ends this far from the hip to the knee, and the gripper
# band -- the main colour -- is the last GRIPPER of it.
LEG_CUFF = 0.80
LEG_GRIPPER = 0.075
# The sleeve ends this far from the shoulder to the elbow, the cuff band last.
SLEEVE_END = 0.52
SLEEVE_CUFF = 0.08
# The jersey's hem, in metres above the hip joints -- and how much lower it
# hangs at the back, as a cycling jersey is cut for a rider bent forward.
HEM_ABOVE_HIPS = 0.10
HEM_BACK_DROP = 0.05
# The collar: this far above the neck's joint, and its band's depth.
COLLAR_ABOVE_NECK = 0.035
COLLAR_BAND = 0.018
# The sock's top, above the ankle joint, and its cuff band; the shoe's collar.
SOCK_TOP = 0.13
SOCK_CUFF = 0.025
SHOE_COLLAR = 0.012
# The sole's upper edge, above the lowest point of the foot.
SOLE_HEIGHT = 0.014

# --- the jersey's panels ---------------------------------------------------------
# Round the torso, in degrees from the front centre line (0) to the back (180).
SIDE_PANEL = (78.0, 112.0)
# ...from the waist to this far below the shoulder joints: under the arm only.
SIDE_PANEL_BELOW_SHOULDERS = 0.09
# The zip: half its width, and its teeth's pitch.
ZIP_HALF_WIDTH = 0.0045
ZIP_PITCH = 0.004
# Three rear pockets: their width all together, their depth, and the elastic
# band along their top edge.
POCKETS_HALF_WIDTH = 0.155
POCKET_DEPTH = 0.17
POCKET_BAND = 0.014
# The bib straps under the jersey, each this far either side of the spine and
# of the breastbone, and this wide. They show through the jersey as relief only.
STRAP_OFFSET = 0.075
STRAP_HALF_WIDTH = 0.018
# The mark: the side of the square it is drawn in on the upper back, and how
# far that square's centre is from the hem towards the shoulders' height.
MARK_METRES = 0.15
MARK_HEIGHT_SHARE = 0.55
# The chamois: half its width, and how far below the hip joints it starts.
CHAMOIS_HALF_WIDTH = 0.075
CHAMOIS_BELOW_HIPS = 0.035

# --- colours: LINEAR light, and shades of the main colour --------------------
# A shade is a multiple of the renderer's main colour (where the mask is 1).
MAIN = 1.0
SIDE_PANEL_SHADE = 0.42
POCKET_BAND_SHADE = 0.55
SEAM_SHADE = 0.72
# Colours of their own (where the mask is 0).
WHITE = (0.80, 0.80, 0.80)
BIB = (0.016, 0.019, 0.024)
ZIP = (0.20, 0.20, 0.21)
SHOE = (0.020, 0.020, 0.022)
SOLE = (0.62, 0.62, 0.60)
# The skin's tone is the one the rider has worn since #369: the skin pack
# brings its detail (divided by its own mean) and not its tone.
SKIN_TONE = (0.52, 0.32, 0.23)
# Which of MakeHuman's CC0 system skins brings that detail, and which of its CC0
# eyebrows is laid on -- paths inside the system assets pack. Each file's own
# entry on the pack's page reads CC0 by "makehuman_system" (`sources.ts`
# section `systemAssetVerdict` checks it before a byte is written).
SKIN_PICTURE = ("skins", "young_caucasian_male", "young_lightskinned_male_diffuse.png")
BROW_DIRECTORY = ("eyebrows", "eyebrow001")
# How far the pack's detail may move the tone, either way.
SKIN_DETAIL_RANGE = (0.55, 1.45)

# --- roughness ---------------------------------------------------------------
ROUGHNESS = {
    "jersey": 0.78,
    "bib": 0.46,
    "chamois": 0.85,
    "skin": 0.52,
    "sock": 0.88,
    "shoe": 0.34,
    "sole": 0.6,
    "zip": 0.3,
    "cuff": 0.7,
}

# --- relief, in metres: the normal map's height field ------------------------
# Negative is a groove.
SEAM_DEPTH = -0.0006
SEAM_HALF_WIDTH = 0.0022
ZIP_RIDGE = 0.0012
STRAP_RIDGE = 0.0005
POCKET_STEP = 0.0008
CUFF_RIDGE = 0.0006
CHAMOIS_PAD = 0.004
SHOE_STRAP_RIDGE = 0.0015
SHOE_STRAPS = 3

# --- the creases the riding pose makes: procedural folds (#623) ------------
# No cloth simulation -- Blender's is not reproducible byte for byte, and ADR
# 0026 D-5's `--check` needs it to be. Each crease is rings of folds round a
# limb, centred on a joint, on the side the joint BENDS towards on the bicycle
# (`bicycle.ts` section `riderJoints` puts the hips flexed, the knees flexed,
# the elbows a little bent and the arms reaching forward):
#
#   joint -> (the side it bends to, how far the folds reach down the limb,
#             their spacing, their depth on cloth, and on skin, and how far
#             from the limb's axis they reach -- about the limb's own radius,
#             so a hip's folds stay in the groin and off the belly)
#
# The side is a direction in the rest pose: -Y is the front of the body. The
# folds reach a quarter as far back up the limb as down it.
CREASES = {
    "hip": ((0.0, -1.0, 0.0), 0.075, 0.020, 0.0014, 0.0006, 0.10),
    "knee": ((0.0, 1.0, 0.0), 0.055, 0.012, 0.0010, 0.0005, 0.07),
    "elbow": ((0.0, -1.0, 0.0), 0.045, 0.010, 0.0008, 0.0004, 0.05),
    "shoulder": ((0.0, -1.0, 0.0), 0.060, 0.018, 0.0012, 0.0006, 0.07),
}
