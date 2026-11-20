# ADR 0087: The open-world ride's ground and grade come from real heights, and a junction choice is final 100 m before the junction

- **Status**: **Accepted**, 2026-11-20, by the owner on its pull request
  [#2948](https://github.com/openzigs/onyourleft/pull/2948), with every recommendation taken and the
  answers recorded in D-10. Proposed 2026-11-19, on the owner's ruling of that day on the epic
  [#2880](https://github.com/openzigs/onyourleft/issues/2880)
- **Date**: 2026-11-19
- **Deciders**: **the owner**, whose ruling of 2026-11-19 is quoted in Context. **The author** chose
  the lock distance, the decode bounds and the fallback within that ruling; each such choice is
  marked *the author's choice*
- **Issue**: [#2885](https://github.com/openzigs/onyourleft/issues/2885), Phase 0 of the epic #2880
- **Number**: **0087**, reserved for #2885 by the owner's lane note of 2026-11-19, beside 0088
  (#2887), 0089 (#2888) and 0090 (#2884, moved off 0086, which ADR 0086 had taken that day). On
  2026-11-19 the open pull requests [#2873](https://github.com/openzigs/onyourleft/pull/2873) (0081),
  [#2864](https://github.com/openzigs/onyourleft/pull/2864) (0083),
  [#2863](https://github.com/openzigs/onyourleft/pull/2863) (0084) and
  [#2872](https://github.com/openzigs/onyourleft/pull/2872) (0085) each write one
- **Supersedes, in part, for open-world rides only**:
  [ADR 0032](0032-external-data-for-the-game-world.md) **D-3** (the route's elevation is not the
  world's) and D-1's **Mapterhorn** row (*"Rejected"*); and the two rows of
  [ADR 0054](0054-towns-from-real-map-data.md) **D-1**'s table that keep them: *"D-3: the route's
  elevation is not the world's — Unchanged. The hillside beside the road is still invented"* and
  *"Every other row: … Mapterhorn … — Unchanged. Still rejected"*. Both ADRs gain one dated
  `## Amendments` entry pointing here; neither body is edited ([ADR 0013](0013-adr-amendments.md) D-2,
  D-3)
- **Leaves standing**: for route rides, every word of ADR 0032 D-3 and ADR 0054 D-1: the hillside
  beside a route is invented from the route's own heights, and the trainer gets the route's stored
  profile. For every ride, ADR 0032 D-1's other rows, ADR 0059 D-2 and ADR 0060 D-2 (no game event
  reaches the trainer), and `packages/domain`'s profile and simulation constants (D-6)
- **Relates to**: [#2013](https://github.com/openzigs/onyourleft/issues/2013) (the US terrain
  archive, a prerequisite); ADR 0090 (#2884, the open-world ride's streamed reads, whose grid and
  privacy rules this reads under); ADR 0088 (#2887, junction choice, which D-6's lock binds);
  [ADR 0004](0004-privacy-and-location.md) D; [ADR 0036](0036-a-self-hostable-instance-server-now.md)
  D-3 and D-7; the spike [#2882](https://github.com/openzigs/onyourleft/issues/2882)

---

## Context

### The ruling this records

The owner, **2026-11-19**, on the seventh question the open-world research put (recorded on #2880),
verbatim:

> **Q7, heights: "Yes, real heights (Recommended)"**

Asked as: the ground and the road's grade come from real height data (#2013), reversing ADR 0032 D-3
and ADR 0054 D-1's invented ground, for free rides only.

### Why an open-world ride needs it

A route ride has its heights before it starts: the route's stored profile (`RouteRecord.elevation`,
ADR 0010 D-5), which `packages/domain/src/route/profile.ts` turns into the grade the trainer gets, and
from which the hillside beside the road is invented (ADR 0032 D-3). **An open-world ride has no
route in advance**, so it has no stored profile: the road ahead is whichever street the rider chooses
at the next junction (ADR 0088). Both its ground and the trainer's grade need a height source the app
can read while the ride is under way. And a side street drawn on invented ground meets the real road
with a visible step the moment the rider turns onto it.

ADR 0032 D-3 drew the line this crosses, in its own words: *"A future issue that 'just reads the DEM
the route already used, for the ground beside it' has crossed from the left column to the right, and
it is this ADR it needs to supersede."* This is that ADR, for open-world rides only.

### What exists, and what does not

- **#2013** (open, owner ruling of 2026-11-02 *"Yes: the lower 48 on R2"*) hosts a **Mapterhorn**
  extract on the project's own R2: Terrarium-encoded terrain RGB, **512 px WebP** tiles in a PMTiles
  archive, **z0–12**, a pixel about **14.6 m** at 40° N, mostly USGS 3DEP 1/3 arc-second (public
  domain) over the US. It also designs the interpolation across bridges and tunnels from the
  basemap's flags. No DEM decoder exists in the repository today.
- **The grade path** (read at `origin/main` `ae37331f2`):
  - `packages/domain/src/route/profile.ts` resamples heights to a **10 m** grid
    (`PROFILE_RESOLUTION_METRES`), despikes them with a median (`DESPIKE_WINDOW_METRES`, 30 m) and
    takes a least-squares slope over **100 m** (`GRADIENT_WINDOW_METRES`), centred on each sample.
    `windowSamples` turns the windows into sample counts: `half = round(window / resolution / 2)`.
    At a 10 m spacing that is **±5 samples (±50 m)** for the slope and **±2 samples (±20 m)** for the
    median, because `Math.round(1.5)` is 2. The file's header says *"a median over three samples"*;
    that holds only where the spacing is a little over 10 m.
  - **The grid is stretched to the route's length.** `routeProfile` takes
    `count = round(total / 10) + 1` samples and spaces them `total / (count − 1)` apart, so the last
    lands on the route's end. A route ride's length never changes, so this costs it nothing. A road
    whose length changes moves **every** sample, from `s = 0`, and a spacing that crosses 10 m flips
    the median between 3 and 5 samples.
  - `gradeAt` interpolates between the two grid samples either side of the rider, so it reads the
    next sample, up to **10 m** ahead.
  - `packages/domain/src/trainer/simulation.ts` writes at most once a second
    (`SIMULATION_SETPOINT_INTERVAL_SECONDS`), skips a change under **0.1 %**
    (`SIMULATION_GRADE_DEADBAND_PERCENT`) and clamps to **±40 %** (`MAX_SIMULATED_GRADE_PERCENT`).
  - `apps/web/src/game/gradient.ts` §`sample(at, distance, bounded)` already has a bounded path: with
    `bounded` set, the grade sent walks toward the road's at
    **`CORRECTION_GRADE_STEP_PERCENT_PER_SECOND` = 1 % a second** (`apps/web/src/net/correction.ts`),
    written for a race correction that moves the rider (#782).

---

## Decision

### D-1 — Scope: open-world rides only

Every rule here applies to an **open-world ride** (ADR 0090 D-1). A route ride keeps its stored
profile and its invented hillside, and nothing here changes what its trainer is sent.

### D-2 — The source: #2013's archive, read on ADR 0090's grid

1. **Heights come from #2013's terrain archive** on the project's own host, at **z12** only, and from
   nowhere else. A self-hoster points the build at an archive of their own, as with the basemap.
2. **Read on ADR 0090's blocks.** A z14 block lies inside exactly one z12 tile, so the height tiles
   held are the z12 tiles that contain the 3 × 3 blocks ADR 0090 D-2 holds: one to four tiles, each
   about 7.5 km across at 40° N, coarser than a block. ADR 0090's R-1 (fixed grid), R-2 (no coordinate
   or tile id in any words), R-3 (zones read the same way), R-6 (tiles off: nothing requested),
   R-7 (an accurate disclosure) and R-8 (a crossing's request waits a random delay of up to 30 s,
   holding only the request and never the ride; accepted with ADR 0090 on 2026-11-20) bind every
   height read.
3. **Through #2013's module and its one `PERMITTED_NETWORK_CALLS` entry.** The open-world ride adds no
   network primitive for heights.
4. **The map-tiles switch governs it** (ADR 0054 D-6.4's one switch). *The author's choice*, put to
   the owner as D-10 Q4 and accepted.

### D-3 — A height tile is untrusted input, and its decode is bounded

A tile may come from an archive a self-hoster configured, or from a host that was not what it
claimed. Each bound is held by a test with a synthetic fixture committed beside it, never a
production tile (#2880's hard rules). *The author's choice*, each one:

| Bound | Value | What a breach does |
|---|---|---|
| Compressed bytes | at most `MAX_TILE_BYTES` (**4 MiB**, `packages/map-features/src/limits.ts`), checked before decode; a 512 px WebP is far smaller | refused unread |
| Pixels | read from the WebP header **before** decoding, and exactly **512 × 512**; anything else is refused unread, so a decode never allocates more than 512 × 512 × 4 bytes (1 MiB) | refused unread |
| Time | the decode runs off the main thread and is abandoned after **2 s** | the tile is unreadable |
| Heights | Terrarium: `R × 256 + G + B / 256 − 32768` metres; a value outside **−200 m to 4,600 m** (the lower 48 run from −86 m to 4,421 m) is no-data | the pixel is no-data |
| No-data | a sample whose four bilinear neighbours include no-data takes the nearest valid pixel within 2 pixels; with none, the tile is unreadable | the tile is unreadable |
| Height step along the road | two neighbouring road samples on D-4.1's grid (10 m apart) differ by at most **4 m**, the **±40 %** grade `simulation.ts` clamps to | both samples are no-data, and D-7 applies there |

**An unreadable tile is an error, never a crash or a hang**, and its words name the field and the
constraint, never the tile's `z/x/y` or a coordinate (ADR 0004 D). What the ride does with it is D-7.

**The decode bounds alone do not bound the grade.** A hostile tile whose heights all stay inside
−200…4,600 m decodes cleanly, and a plateau 3 or more samples wide survives the median, so without
the last row it could take the grade sent to the ±40 % clamp from one second to the next. A route
file is held only by the clamp, because the rider chose it; a height tile the rider did not choose,
read while they pedal, is not (CLAUDE.md §6, trainer control). The step row turns such a plateau
into no-data, which D-7 walks to 0 % at D-6.4's 1 % a second. *The author's choice* of 4 m: a road
needs no steeper step than the clamp would send, and a real one that a 14.6 m pixel renders steeper
(a road cut along a cliff, a bridge with no flag) is flattened by D-7, the safe direction. A tile
can still describe a steep road made of steps under 4 m; that is the same ground a route file can
describe, and the clamp and the deadband hold it.

### D-4 — Heights along the road, and the ground beside it

1. **The road's heights** are sampled from the tiles along the rolling route's line by bilinear
   interpolation, on a **ride-anchored, unstretched 10 m grid**: sample `i` is exactly `i × 10 m`
   from the ride's start, and a sample once taken is never moved. Extending the rolling route, or
   swapping its tail past a junction, adds or replaces samples past the changed road and moves no
   sample before it. The despike and the slope run over that grid with **fixed counts**, 5 samples
   for the median and 11 for the slope, the counts `profile.ts` gives a 10 m spacing; never with
   counts derived from a spacing. Their filters and constants are `profile.ts`'s, **unchanged**.
   What changes is the resampling: `routeProfile` as written stretches its grid to the route's
   length (Context), which an open-world road, whose length changes every second, cannot use.
   #2899 adds the anchored grid to `packages/domain`; whether as an option of `routeProfile` or a
   sibling over the same stages is #2899's call. *The author's choice*, over the alternative of
   sending every swap and extension through D-6.4's bounded path: the rolling route extends all the
   time, so that path would hold every open-world grade at 1 % a second and the trainer would never
   feel a real hill's start.
2. **The ground** (#2900) is drawn from the same tiles, and meets the road at the road's own
   despiked height, so a side street and the road it leaves stand on one surface, with no step.
3. **Bridges and tunnels** (#2013's design): where the basemap marks a road `is_bridge` or
   `is_tunnel`, the road's height across the span is linear between the heights at its two ends,
   and the ground under a bridge stays the terrain's.

### D-5 — The grade comes from the road, and from nothing else

No game event sets resistance or an ERG target (ADR 0059 D-2, ADR 0060 D-2). A junction choice
(ADR 0088) changes **which road** the rolling route appends; it never changes how a grade is
computed, and it is not on an import path that can reach the trainer. In ERG or a workout the
open-world ride sends what that state sends today.

### D-6 — Grade safety: a junction choice is final **100 m** before the junction, and anything the lock cannot prevent is walked at **1 % a second**

1. **How far ahead the grade reads, on D-4.1's grid.** **Precondition: the samples before a
   changed road do not move**, which D-4.1's anchored grid with fixed window counts guarantees. On
   it, the grade sent at a distance `s` reads the grid sample up to 10 m ahead (`gradeAt`), whose
   slope reads heights up to 50 m beyond it, each of which is a median of heights up to 20 m beyond
   that. **The grade sent at `s` depends on the road up to `s + 80 m` at most, and on nothing
   further.** That is a bound by construction, given the precondition. **Without it the bound is
   false.** On `routeProfile`'s stretched grid a tail of a different length moves every sample:
   the review of this ADR's first draft measured grade changes of 0.02 to 0.06 % on gentle ground
   and 1.3 to 4.6 % on rough ground more than 100 m before the junction, a step that neither the
   lock nor the slew covers. The first draft's probe had used branches of equal length, so it
   never moved the grid. `packages/domain/src/route/profile.reach.test.ts` now holds both halves:
   two tails of the same length, one climbing at 60 % and one falling at 60 %, leave every grade up
   to `s = junction − 80 m` identical; two flat tails 600 m and 655 m long change a grade more than
   100 m before the junction by more than the 0.1 % deadband (0.72 % on its ground). The equal-length
   probe found the grade first differing **49.5 to 65 m** before the junction, so the research's
   *"about 60 m"* was a fair typical figure. The lock covers the bound, not the typical figure,
   because a probe cannot try every road.
2. **The lock: 100 m.** A choice at a junction is **final when the rider is 100 m before it**:
   80 m of reach and two grid samples of margin. Until then the rolling route's tail past the
   junction follows the current choice (the default, or the rider's), and swapping it, for a branch
   of any length, changes no grade sent, because on D-4.1's grid every grade sent so far reads only
   samples short of the junction, and the swap moves none of them. After it, no press changes that
   junction. At 40 km/h, 100 m is 9 s.
3. **The rolling route always reaches past the reach.** It extends at least **180 m** ahead of the
   rider along its current branches (the 100 m lock plus the 80 m reach), so no grade sent is read
   from the taper `profile.ts` puts on a profile's last half-window. On D-4.1's grid an extension
   only appends samples, so it changes no grade sent either.
4. **The slew limit, for what the lock cannot prevent.** A **U-turn**, a **dead end** that turns the
   rider round, a height tile that arrives late or is replaced (D-7), and the start of a ride all
   change the road under the rider at once. For each, the grade is sent through `gradient.ts`'s
   existing bounded path, at `CORRECTION_GRADE_STEP_PERCENT_PER_SECOND`, **1 % a second**, until it
   is on the road's own grade. That is ten times the driver's deadband, the rate #782 chose for the
   same reason.
5. **The clamp and the deadband stay.** `simulation.ts`'s ±40 % and 0.1 % hold every write.
6. **Numbers measured later.** Spike #2882 measures how the rolling route behaves. A measurement
   that leaves the lock at or above the reach is recorded by amendment. A lock shorter than the
   reach, or a wider slew rate, is a new decision.

### D-7 — Where heights are unavailable

Offline with nothing held, tiles off (D-2.4), outside the archive, or a tile that is unreadable
(D-3): the road's height there is unknown. *The author's choice*, put to the owner as D-10 Q2 and
accepted: the
grade sent **walks to 0 %** by D-6.4's bounded path and stays there until heights return, when it
walks back up to the road's. The ground there is drawn flat at the last known height, and the ride
screen says that heights are unavailable, with no coordinate in the words.

### D-8 — Credit

#2013 credits the archive's sources whose pixels fall in the extract on the credits screen. While an
open-world ride's ground or grade comes from it, the game view's corner credit (ADR 0054 D-3.6) adds
**"Terrain © Mapterhorn"**, with the sources on the credits screen. ADR 0032 D-6 judged Mapterhorn's
attribution *"intractable for a frame"* because its list did not load; #2013 records that
`attribution.json` now loads. Put to the owner as D-10 Q3 and accepted.

### D-9 — The instance, and no paid service

A rider with no instance gets real heights: the archive is on the tile host, which is not the
instance (ADR 0036 D-3). No paid service is a prerequisite (ADR 0036 D-7). The archive's storage
and request lines are #2013's row in `docs/cost-model.md`. The open-world reads are a few z12 tiles
an hour, far fewer than ADR 0090's block reads.

### D-10 — What the owner was asked, and the answers

The owner answered all five on **2026-11-20**, on the pull request
[#2948](https://github.com/openzigs/onyourleft/pull/2948), each as recommended. Each answer follows
its question.

1. **Q0 — Accept this ADR before it merges, or merge it as Proposed?** Recommended: **accept before
   merge**. **Answered: accepted before merge.** The Status line says so.
2. **Q1 — The lock at 100 m and the slew limit at 1 % a second (D-6)?** Recommended: **yes**. The
   lock removes the step a choice could cause; the slew limit handles the U-turn and the dead end,
   which no lock can. **Answered: yes**, the lock at 100 m and a slew limit of 1 % a second. D-6
   stands.
3. **Q2 — With no heights, walk the grade to 0 % (D-7)**, rather than hold the last grade?
   Recommended: **walk to 0 %**. A held climb that the rider cannot see is worse than a flat road.
   **Answered: walk the grade to 0 %** when there are no heights. D-7 stands.
4. **Q3 — "Terrain © Mapterhorn" in the corner while it is drawn (D-8)?** Recommended: **yes**.
   **Answered: yes.** D-8 stands.
5. **Q4 — The map-tiles switch governs heights too (D-2.4)?** Recommended: **yes**, one switch, as
   ADR 0054 D-8 Q4 ruled for the corridor. **Answered: yes**, one switch: the map-tiles switch
   governs heights too. D-2.4 stands.

---

## Consequences

### What this enables

- **The trainer feels the real hills** of a street the rider chose a minute ago.
- **Side streets meet the road** with no step, because ground and road share one height source.
- #2899 (grade from height tiles) and #2900 (ground from height tiles) have rules to be held to, and
  ADR 0088 has the lock its junction choice obeys.

### What this costs

- **A second location-revealing read** while a ride records, though coarser than the basemap's.
- **A new untrusted decoder** (D-3), with its fixtures and bounds.
- **A junction choice cannot be changed in the last 100 m.** A rider who presses late goes the way
  the lock froze. ADR 0088 has to show the lock.
- **The ride's feel depends on #2013's archive** and on its bridge flags. A missing flag puts a
  bridge at the valley floor, and the 1 % a second slew does not apply to a road's own grade, so the
  trainer feels the dip as the road. #2899 measures how often the flags are missing.
- **Two height models**: a route ride's invented hillside and an open-world ride's real one.

### Constraints this places on other work

| Issue | Constraint |
|---|---|
| [#2013](https://github.com/openzigs/onyourleft/issues/2013) | A prerequisite: the archive, its reader's one `fetch`, the bridge interpolation and the credits list |
| [#2895](https://github.com/openzigs/onyourleft/issues/2895) | D-6.2 and D-6.3: the tail swaps only before the lock, and the profile always reaches 180 m ahead. Its tests swap between branches **of different lengths**, and extend the route, and assert that no grade sent before the swap point changes |
| [#2899](https://github.com/openzigs/onyourleft/issues/2899) | D-3 (each bound a test with a committed synthetic fixture, including a plateau tile inside the height range that the step row turns into no-data), D-4.1 (the anchored grid with fixed window counts), D-4.3, D-5, D-6 and D-7. A test drives a junction choice at 101 m and at 99 m, between branches **of different lengths**, and asserts the grades sent: the first may change the branch, the second does not, and neither steps the grade. `profile.reach.test.ts`'s equal-length half is rewritten over the anchored grid with tails of different lengths |
| [#2900](https://github.com/openzigs/onyourleft/issues/2900) | D-3 and D-4.2: no step where a side street meets the road |
| ADR 0088 (#2887) | The 100 m lock is when a choice becomes final, and the prompt shows it |
| ADR 0032 and ADR 0054 | One dated `## Amendments` entry each, pointing here; neither body is edited |

---

## What would make this ADR wrong

- **`profile.ts`'s windows or `gradeAt`'s interpolation change.** D-6.1's 80 m is read from them; a
  wider window needs a longer lock, in the same pull request.
  `packages/domain/src/route/profile.reach.test.ts` fails if the reach grows past the lock (a
  200 m slope window turns it red).
- **The open-world road is sampled on a stretched grid.** D-6.1's bound holds only while a swap or
  an extension moves no sample before it (D-4.1). `profile.reach.test.ts`'s stretched-grid half
  shows what breaks otherwise.
- **#2013's archive does not ship**, or ships without the bridge flags' interpolation. Then this ADR
  has no source, and an open-world ride has no real grade.
- **The 14.6 m pixel is too coarse** for a steep street in a town, and the 100 m slope window does
  not hide it. #2899's measurements on real streets say.
- **A rider finds the 100 m lock too early** at speed on a descent. The lock is a distance, so at
  60 km/h it is 6 s; a time-based lock would be a new decision.

---

## Amendments

Appended under [ADR 0013](0013-adr-amendments.md). Nothing above this line has been edited.

- **2026-11-20** — **How D-4.1's windows treat a no-data sample, which D-3's step row relies on.**
  D-3's *Height step along the road* row makes two neighbouring road samples no-data, and the
  paragraph under D-3's table says that turns a hostile plateau into no-data *"which D-7 walks to
  0 %"*. The body does not say what D-4.1's 5-sample median and 11-sample slope do with a window
  that holds a no-data sample. If they dropped it and fitted the rest, a valid sample beside the
  plateau's edge could still carry the jump into the slope, and the grade sent would leave the road
  before D-7's walk began, which D-3 says cannot happen. D-3's statement is true only if **a grade
  whose median or slope window holds any no-data sample is itself unavailable, and D-7 applies to
  it**: the grade sent walks to 0 % at D-6.4's 1 % a second, and walks back once every sample in
  its windows is valid again. That is the reading
  [#2899](https://github.com/openzigs/onyourleft/issues/2899) should build, and its plateau-tile test
  (the #2899 row of the constraints table) should assert that the grade sent never moves by more than
  1 % a second while the rider nears, crosses and leaves the plateau. The step row also reaches one
  sample further than D-6.1 counts: whether a sample is no-data depends on the sample 10 m after
  it, so the grade sent at `s` depends on the road up to **`s + 90 m`**, not `s + 80 m`. D-6.2's
  100 m lock still covers it, with one grid sample of margin rather than two; a lock that stays at
  or above the reach is a figure D-6.6 records by amendment, and this is that record.
  ([#2959](https://github.com/openzigs/onyourleft/issues/2959), from the review of #2948)
- **2026-11-20** — **D-6.4's *"ten times the driver's deadband"* compares a rate with a
  magnitude.** The slew is 1 % a second; the deadband is 0.1 % of grade between one write and the
  next. The comparison holds per write: `gradient.ts` writes at most once a second, so each write
  of a walk moves the grade by at most 1 %, ten times the 0.1 % deadband. (#2959, from the review
  of #2948)
