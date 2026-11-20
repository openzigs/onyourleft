# ADR 0089: In an open-world ride the fixed chase camera follows the rolling route, through a junction turn and a U-turn, and never enters a building

- **Status**: **Accepted**, 2026-11-20, by the owner on its pull request
  [#2956](https://github.com/openzigs/onyourleft/pull/2956), with every recommendation taken and the
  answers recorded in D-6. Proposed 2026-11-19, on the owner's rulings of that day on the epic
  [#2880](https://github.com/openzigs/onyourleft/issues/2880)
- **Date**: 2026-11-19
- **Deciders**: **the owner**, whose rulings of 2026-11-19 start the open-world ride. **The author**
  wrote the camera rules from the code as it stands; each number is read from a named constant
- **Issue**: [#2888](https://github.com/openzigs/onyourleft/issues/2888), Phase 0 of the epic #2880
- **Number**: **0089**, reserved for #2888 by the owner's lane note of 2026-11-19, beside 0087
  (#2885), 0088 (#2887) and 0090 (#2884, moved off 0086, which ADR 0086 had taken that day). On
  2026-11-19 the open pull requests [#2873](https://github.com/openzigs/onyourleft/pull/2873) (0081),
  [#2864](https://github.com/openzigs/onyourleft/pull/2864) (0083),
  [#2863](https://github.com/openzigs/onyourleft/pull/2863) (0084) and
  [#2872](https://github.com/openzigs/onyourleft/pull/2872) (0085) each write one
- **Supersedes, in part, for open-world rides only**:
  [ADR 0008](0008-mobile-client-architecture.md) **D-5**'s *"over terrain generated from the imported
  route"*. #2888 asked whether this needed an `## Amendments` entry or a new ADR.
  [ADR 0013](0013-adr-amendments.md) D-3 settles it: an amendment may record a fact, and *"the
  moment a correction would change what a reader should do, it is a decision"*. A camera that follows
  a route nobody imported changes what the renderer does, so it is a new ADR. ADR 0008 gains one
  dated `## Amendments` entry pointing here; its body is not edited
- **Leaves standing, for every ride**: ADR 0008 D-5's **fixed chase camera** and its warning that a
  free camera is out of scope. Nothing here is a free-look; every rule below is a function of the
  road and the frame, as `apps/web/src/game/camera.ts` already is. For route rides, every word of
  D-5 and its amendments
- **Relates to**: ADR 0087 (#2885), which gives the open-world ride's ground from real heights, and
  whose D-6.2 lock (100 m) this relies on; ADR 0088 (#2887), the junction choice; the spike
  [#2882](https://github.com/openzigs/onyourleft/issues/2882), which measures the frames

---

## Context

### Why ADR 0008 D-5 does not cover an open-world ride

ADR 0008 D-5, the owner's ruling of 2026-09-03: *"A **fixed chase camera** over terrain generated
from the imported route."* An open-world ride (#2880) has no imported route. The road is a **rolling
route** (#2895): the street being ridden plus the default branch ahead, extended as the rider goes,
with its tail past the next junction replaced when the rider chooses another way (ADR 0088). Its
ground comes from real heights (ADR 0087). So as written, D-5 decides nothing about the open-world
ride's camera. The camera code will not have to change shape, because it is already a function of
the road and the frame (`camera.ts`'s header). But what it must hold through a 90° junction turn and
a U-turn on a street lined with real buildings has not been written down anywhere.

### What the camera does today (read at `origin/main` `ae37331f2`)

- **The rig** (`apps/web/src/game/camera.ts`):
  - the eye is `CAMERA_BEHIND_METRES` (**4.5 m**) back along the heading and `CAMERA_ABOVE_METRES`
    (**2 m**) up;
  - the target is `CAMERA_TARGET_AHEAD_METRES` (**25 m**) out;
  - the field of view is **70°**.
- **Turning.** `GameView` damps the heading (`dampedHeading`, time constant
  `CAMERA_YAW_SETTLE_SECONDS`, **0.1 s**) and turns the eye and the target together about the pivot
  (`turnedPose`). The pivot is the rider on a straight, and within about 1.5 m of them in a bend.
- **Yaw-rate caps.** The turn is capped at `CAMERA_MAXIMUM_YAW_RATE`, **π/2 rad/s (90°/s)**, and at
  `REDUCED_MOTION_MAXIMUM_YAW_RATE`, **π/3 rad/s (60°/s)**, for a rider who asked for reduced
  motion.
- **The bend tests** (`apps/web/src/game/chase-camera-bend.test.ts`, #1994) ride at 30 km/h, at
  60 fps and at 20 fps, and hold the following:
  - **A 90° corner.** The target stays on the road (within half the 7 m road). The yaw rate stays
    under the cap. The camera turns the whole 90°. The rider stays within 0.2 of the frame's middle.
  - **A hairpin.** The same rules hold.
  - **The target slides along the road.** From one 60 fps frame to the next, the target's step
    changes by under 0.25 m (`TARGET_STEP_METRES`). The step itself is not bounded: the target
    legitimately travels several times the rider's speed, on 25 m of lever. It is a jump in the
    step that the test rules out.
  - **A turnaround.** The camera turns round with the rider at no more than the cap and keeps them
    in the frame. The target may leave the road while it turns.
- **Bend easing.** `apps/web/src/game/bend-easing.ts` eases the **drawn** rider into a sharp bend
  (25° lean). The drawn rider lags the odometer by at most `MAX_LAG_METRES` (**30 m**), and the lag
  is a drawing only.
- **Road shape.** A road's corner is smoothed over `BEND_SMOOTHING_METRES` (**10 m**,
  `terrain.ts`).
- **Clearance.** A structure keeps `ROAD_CLEARANCE_METRES` (**4.1 m**: the 3.5 m half-road plus
  the 0.6 m verge) from the road's centreline (`settlements.ts` §`structureClearance`,
  `landform.ts`). At a city junction, the corner building's nearest point is about 4.1 m from each
  street's centreline. **The eye, 4.5 m behind a rider who is turning, can stand over it.** Nothing
  today tests for that, because no route ride has turned a city corner through mapped buildings at
  junction distance.

---

## Decision

### D-1 — The camera follows the rolling route, as it follows a route

In an open-world ride, the fixed chase camera is placed by the same `camera.ts` and `scene.ts`
functions as on a route, applied to the rolling route's road. The road is the street being ridden
plus the default branch ahead, or the chosen branch once a choice is made. There is no second camera,
no free-look and no cinematic cut.

### D-2 — Through a 90° junction turn: checkable rules

#2896 and #2897 hold each rule with a test that rides the rolling route through a 90° junction at
30 km/h and at 40 km/h, at 60 fps and at 20 fps, built on `chase-camera-bend.test.ts`'s `ride`
harness.

| Rule | The bound | Where the number is from |
|---|---|---|
| **C-1. The swing is capped** | The yaw rate never exceeds **90°/s**, or **60°/s** with reduced motion | `CAMERA_MAXIMUM_YAW_RATE`, `REDUCED_MOTION_MAXIMUM_YAW_RATE` |
| **C-2. The camera looks at the road** | The target stays within **3.5 m** of the road's centreline all the way round | `chase-camera-bend.test.ts` §`ON_THE_ROAD` (half of `ROAD_WIDTH_METRES`) |
| **C-3. The rider stays in the middle** | The rider is never more than **0.2** of the frame's width off its middle | `chase-camera-bend.test.ts` §`RIDER_IN_THE_MIDDLE` |
| **C-4. The target slides** | From one 60 fps frame to the next, the target's step changes by less than **0.25 m**. The step itself is not bounded, since the target travels several times the rider's speed | `chase-camera-bend.test.ts` §`TARGET_STEP_METRES`, which bounds the change in the step, not the step |
| **C-5. The eye is never inside a building** | The eye is never inside a drawn building's volume: its footprint raised to its drawn height, grown by `NEAR_PLANE_METRES` (**0.5 m**) on every side and on top. The line from the eye to the rider passes through no drawn building's volume. Both hold in every frame, including while the eye is moving | The near plane, so no wall is clipped open in front of the lens |
| **C-6. A choice never moves the camera** | Swapping the rolling route's tail (a choice made before the lock) moves neither the eye nor the target by any amount | The tail swaps at least **100 m** before the junction (ADR 0087 D-6.2). The target is at most **25 m** ahead, and the drawn rider is at most **30 m** behind the odometer, so the camera never looks at the part that changed |

**How C-5 is met.** The eye is pulled in toward the rider, along the line from the eye to the
rider's head. That keeps it on the sight line it already had, so a pull-in only shortens that line
and never moves it behind a building. The pull-in is **anticipatory**, not reactive. A pull that
starts only once the eye is inside a volume is already too late: at 40 km/h the eye closes on a
wall at about 0.185 m a 60 fps frame from riding forward, plus about 0.12 m a frame of yaw sweep
at the cap.

- **Look ahead 1 s.** Each frame, the rig tests the eye it would have over the next **1 s**. It
  rides on at the current speed, turns the heading toward the road ahead at no more than C-1's cap,
  and takes the shortest pull-in that keeps every one of those eyes clear of C-5. The rig eases
  toward the largest such pull-in.
- **Ease at 4.5 m/s.** The pull-in changes at most **4.5 m a second** (0.075 m a 60 fps frame), in
  and out. That is the whole 4.5 m of `CAMERA_BEHIND_METRES` in the 1 s horizon, so any pull-in
  the horizon calls for is complete before the eye reaches the wall. The pull-in eases back out only
  once the whole horizon is clear.
- **Prefer 1.5 m.** The eye stays at least **1.5 m** from the rider where that clears C-5.
- **C-5 wins** over the 1.5 m floor and over the easing. If a corner is so tight that 1.5 m is
  still inside a volume, the eye goes on in toward the rider's head. That always clears C-5: the
  rider is on the road, and every structure keeps 4.1 m from its centreline. If a building the
  horizon could not see (a block streamed in late) would put the eased eye inside it, the eye jumps
  in to the clear length that frame. #2896's rides through a 90° junction, at 30 and 40 km/h and at
  60 and 20 fps, assert that no such jump happens.
- **No rise.** The eye is never raised to clear a building. A raised eye is still inside the
  volume while it rises, and a sight line from over a roof to a rider beside the building passes
  through it.

It never passes through a wall, and it never cuts behind the building.

### D-3 — Through a U-turn and a dead end: checkable rules

A U-turn (ADR 0088 D-1.6) and a dead end's turn-round (D-1.7) are a turnaround, as at the far end of
an out-and-back course. They are held by the same rules as `chase-camera-bend.test.ts` §"at a
turnaround", on the rolling route:

- **C-7.** The camera turns the full **180°** about the pivot (`turnedPose`), never faster than C-1's
  cap. At 90°/s that takes at least **2 s**, and at 60°/s at least **3 s**.
- **C-8.** The rider stays within the frame throughout. As at a turnaround, the target may leave
  the road while it turns, and C-2 does not apply.
- **C-9.** C-5 holds throughout. The eye sweeps a circle of 4.5 m round the pivot, which on a city
  street reaches the building line, so the pull-in is part of every urban U-turn.

### D-4 — What is not decided here

- **Frame time.** The frames at a turn are #2882's to measure, and #2910's on the tablet. These
  rules are geometry and hold at any frame rate. If #2882 finds the C-5 test too costly per frame
  against the per-tile building plans (#2901), that is a performance finding for #2896, not a reason
  to drop C-5.
- **The prompt** and the street map are not the camera's (ADR 0088, #2898, #2904).

### D-5 — Route rides are unchanged

A route ride's camera is ADR 0008 D-5's, with its amendments, and `chase-camera-bend.test.ts`
already holds it. C-5 may be applied to route rides too, since a mapped town on a route has the same
corner. Doing so is #2903's or a follow-up's call, and it changes nothing this ADR decides.

### D-6 — What the owner was asked, and the answers

The owner answered all three on **2026-11-20**, on the pull request
[#2956](https://github.com/openzigs/onyourleft/pull/2956), each as recommended. Each answer follows
its question.

1. **Q0 — Accept this ADR before it merges, or merge it as Proposed?** Recommended: **accept before
   merge**. **Answered: accepted before merge.** The Status line says so.
2. **Q1 — A new ADR rather than an amendment**, for ADR 0013 D-3's reason? Recommended: **yes**. The
   owner's lane note already reserved a number for it. **Answered: yes**, a new ADR.
3. **Q2 — Pull the eye in ahead of the wall, toward the rider and past 1.5 m if it must (D-2,
   C-5)**, rather than raise it or let it pass through a wall? Recommended: **yes**. A camera inside
   a building shows the rider nothing, and a camera that cuts behind one hides the junction. A
   raised eye is inside the building while it rises. **Answered: yes**, pull the eye in toward the
   rider ahead of the wall, past 1.5 m if it must; never inside a building. C-5 stands.

---

## Consequences

### What this enables

- The open-world ride's camera can be built (#2896) and tested against stated numbers before any
  tablet session.
- A rule, C-5, that the realistic world never had to state, because no route turned a mapped city
  corner at junction distance.

### What this costs

- **A per-frame test of the eyes of the next 1 s against nearby building volumes** (C-5), on the
  frame budget the tablet is already short of. #2901's per-tile plans give the footprints and
  heights. The test touches only the few within the horizon: at 40 km/h, about 11 m of riding plus
  the 4.5 m eye.
- **The rider looks bigger at a city corner**, when the eye is pulled in, and the field of view
  briefly shows less road ahead.
- **A U-turn takes at least 2 s** to turn the view, by C-1's cap.

### Constraints this places on other work

| Issue | Constraint |
|---|---|
| [#2896](https://github.com/openzigs/onyourleft/issues/2896) | D-1, and C-1 to C-9 as tests on the rolling route |
| [#2895](https://github.com/openzigs/onyourleft/issues/2895) | C-6: the tail swaps only before ADR 0087's lock |
| [#2897](https://github.com/openzigs/onyourleft/issues/2897) | The U-turn and the dead end ride D-3's turnaround |
| [#2901](https://github.com/openzigs/onyourleft/issues/2901), [#2902](https://github.com/openzigs/onyourleft/issues/2902) | The footprints and drawn heights of the buildings within C-5's 1 s horizon are available to C-5 each frame |
| [#2910](https://github.com/openzigs/onyourleft/issues/2910) | The tablet session watches a city-corner turn and a U-turn |
| ADR 0008 | One dated `## Amendments` entry pointing here; its body is not edited |

---

## What would make this ADR wrong

- **`camera.ts`'s rig changes.** C-1 to C-4 are its constants; C-5's 1.5 m floor and its 4.5 m/s
  ease assume a 4.5 m eye. A new rig is checked against C-5 in the same pull request.
- **ADR 0087's lock or `bend-easing.ts`'s lag changes** so that the lock is less than the lag plus
  the 25 m look-ahead. Then C-6 no longer holds by construction, and needs a test of its own.
- **A free camera is ever asked for.** That is still a change to ADR 0008 D-5, as it was.

---

## Amendments

Appended under [ADR 0013](0013-adr-amendments.md). Nothing above this line has been edited.

- **2026-11-20** — **C-6's *"by any amount"*, and its margin, as a test states them.** A tail swap
  rebuilds the rolling route's profile, and a rebuilt profile need not reproduce every
  floating-point value bit for bit, so *"moves neither the eye nor the target by any amount"* is
  read as **by no more than a stated floating-point tolerance**, far below anything drawn, which
  [#2896](https://github.com/openzigs/onyourleft/issues/2896)'s test should name. The margin is also
  larger than C-6's row and the second bullet of *What would make this ADR wrong* count. The drawn
  rider's lag (up to 30 m behind the odometer) puts the target further from the junction, not
  nearer, so it adds to the margin rather than using it up: with the tail swapped no later than
  100 m before the junction (ADR 0087 D-6.2) and the target at most 25 m ahead of the odometer, the
  camera looks at least **75 m** short of the changed road, whatever the lag. That bullet's
  condition is therefore a lock shorter than the 25 m look-ahead, not shorter than the lag plus it;
  its conclusion, that C-6 then needs a test of its own, is unchanged. #2896's test should state
  the tolerance and the 75 m margin. (#2959, from the review of #2956)
- **2026-11-20** — **C-5's jump covers any frame in which the eased eye would be inside a
  building, not only a late block.** The bullet under C-5 names one cause, a building the 1 s
  horizon *"could not see"*. A misprediction is another: the horizon rides on at the current speed
  and turns at C-1's cap, so a rider who speeds up, or a heading that turns faster than the
  prediction, can bring the eased eye to a wall the horizon placed further off. C-5 holds *"in every
  frame"* and *"C-5 wins"* over the easing, so the eye jumps in to the clear length in that frame
  too. #2896 should test it that way, with a ride that speeds up inside the horizon beside a building, and
  assert that C-5 holds in every frame. (#2959, from the review of #2956)
