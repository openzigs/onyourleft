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
- **landed**, as the fall ends, and **down**, until the rise: lying along the
  bicycle on the road, the low arm out ahead on the ground, the other over the
  hip, the legs off the pedals, the head lifted to look up the road.
- **rising**, half way up: a hand back on its grip, the other pushing off the
  road, the low foot planted, the other on its pedal.
- **back on** at the end, the riding pose itself.

## Units and frame

Metres, the BICYCLE's frame in glTF's axes, as `bicycle.ts` section
`riderJoints` gives the riding joints: `+X` the rider's left, `+Y` up, `+Z`
forward, the ground under the wheels at `Y = 0`. Every moment falls to the
rider's RIGHT (`-X`); the runtime mirrors the clip for a fall to the left.

At #2475's 75 degrees on its side, a point of the bicycle's frame is
`0.966 * x + 0.259 * y` above the road, so the low side's numbers below are
the road itself: the low hand's and foot's within 3 cm of it.

Each moment is `(name, when, joints)`: `when` names #2475's time it is at --
`start`, `fall`, `riseAt` or `end`, in seconds from `crash-look.ts` -- and a
share of the next stretch; `joints` is `RIDING` or the hips, the shoulders,
each hand's middle and each foot (index 0 the `+X`, left), and the head's
nod in radians (down positive).
"""

RIDING = "riding"

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
            "hips": (-0.08, 0.75, -0.30),
            "shoulders": (-0.12, 1.12, 0.02),
            "hands": ((0.05, 1.00, -0.05), (-0.32, 1.20, 0.45)),
            "feet": ((0.0, 0.45, -0.38), (-0.06, 0.35, -0.62)),
            "nod": -0.3,
        },
    ),
    (
        "down",
        ("riseAt", 0.0),
        {
            "hips": (-0.08, 0.75, -0.30),
            "shoulders": (-0.10, 1.15, 0.0),
            "hands": ((0.05, 1.00, -0.05), (-0.32, 1.20, 0.45)),
            "feet": ((0.0, 0.45, -0.38), (-0.06, 0.35, -0.62)),
            "nod": -0.4,
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
