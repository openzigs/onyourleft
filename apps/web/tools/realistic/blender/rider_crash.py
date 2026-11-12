# SPDX-License-Identifier: AGPL-3.0-or-later
"""
The rider's fall and get-up in a Delivery crash -- every number the clip is
posed from, in ONE file (#2493).

`process_rider.py` step 10 imports this, poses the MakeHuman rider's own
skeleton onto each moment below exactly as `three-renderer.ts` section
`RealisticRiderBelt` poses it onto a bicycle, and writes the poses into
`rider.glb` as one animation, `crash`. It is this repository's own work, from
arithmetic, derived from no other product or motion capture, and dedicated
CC0-1.0 in `ASSETS.toml` as the kit is.

## What it draws, over #2475's timeline

`src/game/delivery/crash-look.ts` times a crash and rolls the bicycle onto its
side and back; the runtime blends the body from its riding pose to this clip's
by that file's share, so the clip is the BODY'S part and the roll stays the
bicycle's:

- **thrown**, part way through the fall: the hands off the bars, the arm on
  the side going down reaching for the road and the other flung up; the foot
  on that side out of its pedal reaching down, the other knee drawn up.
- **landed**, as the fall ends: on the road beside the bicycle, clear of it
  -- past its saddle and bars, on the side away from its wheels -- lying on
  the low side and facing the bicycle, propped on the low arm, which reaches
  out ahead and away from it with the elbow up, the other hand caught on the
  road before the chest, the top knee still drawn up, the head lifted.
- **down**, until the rise: settled (#2505) -- the torso lower and further
  out, the low arm stretched further ahead, the other hand dropped onto the
  hip, the top leg let down onto the low one, the head down.
- **rising**, half way up: a hand back on its grip, the other pushing off the
  road, the low foot planted, the other on its pedal.
- **back on** at the end, the riding pose itself.

## Units and frame

Metres, the BICYCLE's frame in glTF's axes, as `bicycle.ts` section
`riderJoints` gives the riding joints: `+X` the rider's left, `+Y` up, `+Z`
forward, the ground under the wheels at `Y = 0`. Every moment falls to the
rider's RIGHT (`-X`); the runtime mirrors the clip for a fall to the left.

At #2475's 75 degrees on its side, a point of the bicycle's frame is
`0.966 * x + 0.259 * y` above the road. #2505: the lying moments are written
with `on_road` -- how far above the road, how far along it out from the
wheels' line, and how far forward -- because a body lying on the road beside
a bicycle on its side is described by those three and not by the bicycle's
`x` and `y`. The first pass placed the body in the bicycle's own `x` and `y`,
and it lay through the rear wheel, the seat tube and the saddle, with the low
elbow 18 cm under the road.

Each moment is `(name, when, joints)`: `when` names #2475's time it is at --
`start`, `fall`, `riseAt` or `end`, in seconds from `crash-look.ts` -- and a
share of the next stretch; `joints` is `RIDING` or the hips, the shoulders,
each hand's middle and each foot (index 0 the `+X`, left), and the head's
nod in radians (down positive) -- and, if it names them, the way each elbow
and each knee bends (`elbows`, `knees`, directions). Without them the riding
stance's are used, whose elbows bend out and down: into the road, on a
bicycle on its side.

`realistic-textures.test.ts` section "#2505" reads the drawn body back and
holds it 3 cm clear of every part of the bicycle, out of the road, with the
low arm in sight from above, and moving between landed and down.
"""

RIDING = "riding"

# The bicycle at #2475's 75 degrees on its right side: the road's up, and the
# way along the road out from the wheels' line, in the bicycle's frame.
ROAD_UP = (0.966, 0.259)
ROAD_OUT = (-0.259, 0.966)


def on_road(up, out, forward):
    """The point -- or the direction -- `up` above the road, `out` along it from
    the wheels' line and `forward`, in the bicycle's frame (#2505)."""
    return (
        round(up * ROAD_UP[0] + out * ROAD_OUT[0], 4),
        round(up * ROAD_UP[1] + out * ROAD_OUT[1], 4),
        forward,
    )


CRASH_MOMENTS = (
    ("start", ("start", 0.0), RIDING),
    (
        "thrown",
        ("start", 0.55),
        {
            "hips": (-0.04, 0.95, -0.27),
            "shoulders": (-0.10, 1.40, -0.08),
            "hands": ((0.35, 1.30, 0.15), (-0.55, 0.75, 0.30)),
            "feet": ((0.12, 0.50, -0.10), (-0.40, 0.25, -0.05)),
            "nod": -0.2,
        },
    ),
    (
        "landed",
        ("fall", 0.0),
        {
            "hips": on_road(0.18, 1.32, -0.28),
            "shoulders": on_road(0.24, 1.40, 0.22),
            "hands": (on_road(0.10, 1.15, 0.30), on_road(0.06, 1.60, 0.60)),
            "feet": (on_road(0.24, 1.45, -0.50), on_road(0.06, 1.22, -0.70)),
            "nod": -0.3,
            "elbows": (on_road(1.0, 0.0, -0.3), on_road(0.5, 1.0, 0.0)),
            "knees": (on_road(0.6, -0.6, 0.5), on_road(0.0, -1.0, 0.3)),
        },
    ),
    (
        "down",
        ("riseAt", 0.0),
        {
            "hips": on_road(0.17, 1.35, -0.30),
            "shoulders": on_road(0.21, 1.45, 0.18),
            "hands": (on_road(0.30, 1.40, -0.20), on_road(0.06, 1.68, 0.68)),
            "feet": (on_road(0.12, 1.40, -0.78), on_road(0.06, 1.25, -0.80)),
            "nod": 0.1,
            "elbows": (on_road(1.0, 0.0, -0.3), on_road(0.5, 1.0, 0.0)),
            "knees": (on_road(0.3, -1.0, 0.3), on_road(0.0, -1.0, 0.3)),
        },
    ),
    (
        "rising",
        ("riseAt", 0.5),
        {
            "hips": (-0.03, 0.88, -0.27),
            "shoulders": (-0.05, 1.28, -0.04),
            "hands": ((0.20, 0.93, 0.40), (-0.30, 0.95, 0.30)),
            "feet": ((0.09, 0.42, -0.06), (-0.28, 0.08, -0.02)),
            "nod": -0.1,
        },
    ),
    ("back on", ("end", 0.0), RIDING),
)
