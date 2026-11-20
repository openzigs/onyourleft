# Spike 0040: A rolling route, and a moving ride that turns 90° every few hundred metres through streamed real buildings

- **Date**: 2026-11-19
- **Issue**: [#2882](https://github.com/openzigs/onyourleft/issues/2882), Phase 0 of the open-world epic
  [#2880](https://github.com/openzigs/onyourleft/issues/2880). The owner's ruling of 2026-11-19 on the issue: *"build
  the spike and measure it in the browser harness on this Mac; the tablet frame measurement is the owner's and waits for
  a tablet session, so state it as owed in the PR. No install on any device."*
- **Number**: **0040.** `docs/spikes/` holds 0001 to 0008, 0010 to 0020 and 0022 to 0039 on `origin/main` at
  `ae37331f2`, and no open pull request adds a spike.

A spike is a dated measurement that decides nothing (`docs/agents/conventions.md` §7). It informs the ADRs #2884 (map
reads), #2885 (heights) and #2888 (camera), and the Phase 1 issues #2895 (rolling profile) and #2901 (per-tile planning
worker).

## Rules this spike holds

- **No product code.** The prototype is `apps/web/tools/rolling-route-spike/`. Nothing under `apps/web/src/` imports it
  and no spike module reaches a trainer module by any import chain (`spike-boundary.test.ts`). No realistic-budget
  ceiling is changed: `MAPPED_BUILDING_MAX` is still 36 and `REALISTIC_FRAME_TRIANGLES` 300,000.
- **No device.** Every number below was measured on the development Mac (an Apple M4 Pro) and says so. The tablet's are
  owed, and are listed under "Waiting on the owner".
- **No coordinate in a log or a result.** The two start points are public crossroads on north–south street grids,
  written in the page's source so the ride can be repeated; they are nobody's home. The page's results and its one
  console line carry the place's name (`suburb`, `city`), never a coordinate, a tile id or a block id.
- **No paid service.** The tiles come from the project's published archive (`map/basemap.ts`
  §`PUBLISHED_BASEMAP_URL`), read through the product's own `world-data/corridor-source.ts` (range requests, nothing else).
- **Unmeasured is not a pass.**

## What was built

| File | What it is |
|---|---|
| `rolling-profile.ts` | A `RouteProfile` that grows ahead and swaps its tail at a junction. Its header lists what `routeProfile` would not do |
| `turning-ride.ts` | The scripted ride: compass-aligned legs of 300 to 500 m, each turned 90° left or right from a seeded generator |
| `block-grid.ts` | Blocks of `n × n` z15 tiles on a fixed grid; `streamRide` rides a path and counts tiles and late blocks |
| `streaming.ts`, `run-streaming.mjs` | Tiles an hour and the lead at 40 km/h over hour-long scripted rides; writes `results/streaming.json` |
| `page/` | The ride: the product's `three-renderer.ts` and `scene.ts` (through the realistic page's `rideFrame`), the product's planners (`landClassMask`, `urbanClassMap`, `footprintPlans`, `mappedBuildingsOf`, `mappedTown`), and real tiles read and decoded on the main thread or in `plan-worker.ts` |
| `summary.ts` | The frame statistics in the tables below, tested |
| `run-page.mjs` | Builds the page, rides each configuration in Chromium and writes `results/<world>-<planning>-<place>.json` |
| `scenery-keying.test.ts` | The scenery question, answered by running `scatter.ts` |

Run from `apps/web`: `node tools/rolling-route-spike/run-page.mjs 240`, then
`node tools/rolling-route-spike/run-streaming.mjs`.

## How the ride works

The rider rides at a steady **30 km/h**. The profile holds the leg the rider is on and the **default branch** past its
junction: straight on for 600 m. **150 m before the junction** the scripted choice is made and the profile's tail is
swapped for the turned street (`RollingProfile.swapTail`). That swap hands the game a **new `RouteProfile` object**, and
the town is planned again against it. About 18 s later the rider rides through the corner and the view swings 90°.
Both moments are recorded: **"at the swaps"** is the 3 s around each swap, **"through the corners"** the 3 s around
each corner, and **"steady"** is the rest.

The map is read on a **fixed grid of one-tile blocks** (z15, about 900 m by 1.2 km at this latitude): every block within
the fog (`terrain.ts` §`VIEW_AHEAD_METRES`, 400 m) plus a 200 m lead of the rider is asked for once, and kept. The town
is planned over the blocks within that reach (`page/plan.ts` §`planTown`), exactly as `GameView`'s press plans a
corridor, and put in the frame. It is planned again at every swap and whenever a block arrives.

- **`planning=main`**: the blocks are read, decoded and planned on the main thread.
- **`planning=worker`**: `plan-worker.ts` reads, decodes and runs `footprintPlans`; it posts the features and the plans
  to the page. The land-class mask and the urban class are **objects with methods** (`land-class.ts` §`LandClassMask`,
  `urban-class.ts` §`UrbanClassMap`) and cannot cross from a worker, so the page builds them again, then builds
  `mappedBuildingsOf` and `mappedTown`.

The renderer is the top rung of each world, held there (the quality ladder is off, so both worlds are measured at the
same rung for the whole ride). Chromium 1248 in its new headless mode, 1280×800 CSS pixels at a device pixel ratio of
2 (the tablet's 2560×1600), drawing through ANGLE on Metal; every result records the WebGL renderer it got. Each run is
240 s of riding after a 3 s warm-up.

## Results, on the Mac

Measured 2026-11-19 on `ae37331f2` plus this branch, eight runs of 240 s (`results/*.json`). Every run got
**ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro)** at a 16.7 ms display interval, and the realistic runs loaded the
realistic world. Each run made **5 turns**. "Dropped" counts display refreshes with no new frame. "Longest main-thread
frame" is the time `tick` spent building the scene frame and rendering it: where a frame stalls, its gap lands on the
next frame, so the two columns say which frame paid. **The GPU frequency column is the tablet's, and is owed.**

### Frame time

| Place | World | Planning | Window | p50 ms | p95 ms | max ms | Dropped | Longest main-thread frame ms | Long tasks / longest ms | Draw calls max | Triangles max | GPU frequency |
|---|---|---|---|--:|--:|--:|--:|--:|--:|--:|--:|---|
| suburb | stylised | main | steady | 16.7 | 16.7 | 2083.3 | 529 (2.5/s) | 2041.8 | 6 / 2041 | 20 | 40,626 | owed |
| suburb | stylised | main | at the swaps | 16.7 | 16.7 | 1099.9 | 180 (12/s) | 2089 | 5 / 2089 | 18 | 39,044 | owed |
| suburb | stylised | main | through the corners | 16.7 | 16.7 | 16.8 | 0 (0/s) | 5.4 | 0 / 0 | 14 | 38,790 | owed |
| suburb | stylised | worker | steady | 16.7 | 16.7 | 200 | 52 (0.2/s) | 12.2 | 7 / 200 | 20 | 40,626 | owed |
| suburb | stylised | worker | at the swaps | 16.7 | 16.7 | 133.3 | 19 (1.3/s) | 29.9 | 4 / 129 | 18 | 39,634 | owed |
| suburb | stylised | worker | through the corners | 16.7 | 16.7 | 16.8 | 0 (0/s) | 1.4 | 0 / 0 | 14 | 38,790 | owed |
| suburb | realistic | main | steady | 16.7 | 16.7 | 2399.8 | 618 (2.9/s) | 2253.7 | 6 / 2253 | 46 | 125,113 | owed |
| suburb | realistic | main | at the swaps | 16.7 | 16.7 | 1316.6 | 233 (15.5/s) | 2404.3 | 5 / 2404 | 43 | 116,877 | owed |
| suburb | realistic | main | through the corners | 16.7 | 16.7 | 16.8 | 0 (0/s) | 4 | 0 / 0 | 33 | 84,202 | owed |
| suburb | realistic | worker | steady | 16.7 | 16.7 | 433.4 | 182 (0.9/s) | 247.1 | 15 / 247 | 46 | 125,113 | owed |
| suburb | realistic | worker | at the swaps | 16.7 | 16.8 | 233.3 | 52 (3.5/s) | 238.3 | 12 / 200 | 43 | 116,877 | owed |
| suburb | realistic | worker | through the corners | 16.7 | 16.7 | 16.8 | 0 (0/s) | 3.9 | 0 / 0 | 33 | 84,202 | owed |
| city | stylised | main | steady | 16.7 | 16.8 | 283.3 | 33 (0.2/s) | 282.7 | 3 / 283 | 27 | 34,746 | owed |
| city | stylised | main | at the swaps | 16.7 | 16.8 | 483.3 | 116 (7.7/s) | 494.8 | 7 / 495 | 26 | 28,220 | owed |
| city | stylised | main | through the corners | 16.7 | 16.7 | 16.8 | 0 (0/s) | 1.7 | 0 / 0 | 23 | 24,603 | owed |
| city | stylised | worker | steady | 16.7 | 16.8 | 99.9 | 5 (0/s) | 12.8 | 1 / 100 | 27 | 34,746 | owed |
| city | stylised | worker | at the swaps | 16.7 | 16.7 | 133.4 | 26 (1.7/s) | 22.6 | 5 / 138 | 26 | 28,220 | owed |
| city | stylised | worker | through the corners | 16.7 | 16.7 | 83.3 | 4 (0.3/s) | 13.1 | 1 / 92 | 23 | 24,603 | owed |
| city | realistic | main | steady | 16.7 | 16.7 | 833.2 | 95 (0.4/s) | 530.4 | 5 / 530 | 51 | 178,108 | owed |
| city | realistic | main | at the swaps | 16.7 | 16.8 | 733.3 | 184 (12.3/s) | 846.9 | 7 / 847 | 51 | 178,108 | owed |
| city | realistic | main | through the corners | 16.7 | 16.8 | 516.6 | 30 (2.5/s) | 5.9 | 0 / 0 | 45 | 167,078 | owed |
| city | realistic | worker | steady | 16.7 | 16.7 | 33.3 | 1 (0/s) | 235 | 2 / 235 | 51 | 178,108 | owed |
| city | realistic | worker | at the swaps | 16.7 | 16.8 | 400 | 146 (9.7/s) | 279.3 | 16 / 279 | 51 | 178,108 | owed |
| city | realistic | worker | through the corners | 16.7 | 16.8 | 316.7 | 36 (3/s) | 247.2 | 2 / 247 | 45 | 167,078 | owed |

**What the table says.**

- **The view swinging 90° costs nothing.** Through the corners the longest main-thread frame was 1.4 to 13 ms in seven
  of the eight runs, and no long task started there. The road, the ground and the scenery are already rebuilt every
  frame in world coordinates (`three-renderer.ts`), so turning the camera onto a new street is an ordinary frame. The
  eighth (city, realistic, worker) has two slow frames in a corner window, and both are the first frame after a plan
  made for blocks that arrived 1.4 s before the corner, not the corner. The other gaps through the city's corners are
  stalls that began just before the window.
- **The stall is the plan, and it is a stall of seconds.** On the main thread every re-plan — at each swap, and
  whenever a block arrives — holds the main thread for **0.26 to 2.4 s** on this Mac: 12 to 15 dropped frames a second
  around the swaps, and the suburb's steady ride drops 2.5 to 2.9 a second only because blocks arrive in it.
- **A worker removes most of it, and not all.** With `footprintPlans` in the worker, the longest main-thread task
  around a swap falls from 2.4 s to **0.13 to 0.14 s (stylised) and 0.20 to 0.28 s (realistic)**. What is left on the main
  thread is, in both worlds, a task of 77 to 200 ms when a plan arrives: receiving 7,000 to 14,000 plans by structured
  clone and building the land-class mask and the urban class again, which cannot cross from a worker (`mainMs` below is
  the second part, 44 to 128 ms). In the **realistic world only**, two frames more: **the first frame on a new profile
  object, 64 to 217 ms** (finding 7 below), and **the first frame on a new town, 149 to 279 ms**. The stylised world's
  same two frames were under 50 ms in every run. Which of the realistic belts pays for them was not profiled.
- **The draw stays inside its budget.** The most triangles in a frame were 125,113 (suburb) and 178,108 (city) against
  `REALISTIC_FRAME_TRIANGLES` = 300,000, with the mapped belt's cap left at `MAPPED_BUILDING_MAX` = 36 (how many it
  drew was not read off the frames). The city centre's realistic frames reached **51 draw calls**, one over `REALISTIC_VILLAGE_DRAW_CALLS` = 50
  (`realistic-budget.ts:524`); the suburb's reached 46. No ceiling was changed.

### Planning

| Place | World | Planning | Plans | Footprints held, most | `footprintPlans` ms, most | `landClassMask` ms, most | `urbanClassMap` ms, most | In the worker ms, most | On the main thread ms, p50 / most | Asked to in the frame ms, p50 / most | JS heap MiB at the end |
|---|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| suburb | stylised | main | 11 | 13,972 | 1970.1 | 51.4 | 45.1 | — | 1014.9 / 2071.9 | 1014.9 / 2072 | 1174 |
| suburb | stylised | worker | 11 | 13,972 | 2050.9 | 58.3 | 50.5 | 2157.9 | 60.8 / 100.3 | 1266.8 / 2557.3 | 612 |
| suburb | realistic | main | 11 | 13,972 | 2066.5 | 40.5 | 45.5 | — | 1073.3 / 2158.2 | 1073.3 / 2158.2 | 1287 |
| suburb | realistic | worker | 11 | 13,972 | 2073.3 | 52.3 | 49.6 | 2172.6 | 68.9 / 103.4 | 1361.5 / 2581.4 | 714 |
| city | stylised | main | 9 | 3,078 | 366.2 | 56.2 | 60.8 | — | 260.7 / 473.6 | 272.9 / 473.7 | 63 |
| city | stylised | worker | 8 | 3,078 | 365.7 | 53 | 58.6 | 472 | 84.1 / 127.7 | 355.6 / 956.4 | 60 |
| city | realistic | main | 9 | 3,078 | 400.3 | 59.2 | 73.1 | — | 257.1 / 534.1 | 258.5 / 542 | 171 |
| city | realistic | worker | 8 | 3,078 | 385.9 | 59 | 69.7 | 514.7 | 82.8 / 120.9 | 356.9 / 670.2 | 168 |

`footprintPlans` is the cost: 0.37 s for the city centre's 3,078 footprints and **2.1 s for the suburb's 13,972**, on
this Mac, because every plan re-plans every footprint in reach against the whole new profile. The mask and the urban
class are 40 to 73 ms each. "Asked to in the frame" is from the swap or block that asked for a plan to the plan being put in
the frame; on the worker path it is also how long the rider sees the new street's buildings **unranked**, standing where
the default branch's plan put them: up to 2.6 s in the suburb, about 22 m at 30 km/h. The JS heap ended at 1.2 to 1.3 GiB
in the suburb with planning on the main thread (the old plans not yet collected); it is a reading, not a measurement of
graphics memory, which is owed.

### Reading the map

| Place | World | Planning | Turns | Blocks read | Tiles an hour at this rate | Block read ms, p50 / p95 / most | Decode ms, most | Largest tile KiB |
|---|---|---|--:|--:|--:|--:|--:|--:|
| suburb | stylised | main | 5 | 11 | 165 | 624.4 / 1648.7 / 1648.7 | 4.8 | 145 |
| suburb | stylised | worker | 5 | 11 | 165 | 657.4 / 2003.5 / 2003.5 | 5.2 | 145 |
| suburb | realistic | main | 5 | 11 | 165 | 727.3 / 1826.3 / 1826.3 | 6.9 | 145 |
| suburb | realistic | worker | 5 | 11 | 165 | 1027.1 / 1974.3 / 1974.3 | 5.1 | 145 |
| city | stylised | main | 5 | 11 | 165 | 649 / 1440.7 / 1440.7 | 7.6 | 217 |
| city | stylised | worker | 5 | 11 | 165 | 719.7 / 1208.7 / 1208.7 | 5.2 | 217 |
| city | realistic | main | 5 | 11 | 165 | 748.7 / 1823.8 / 1823.8 | 4.8 | 217 |
| city | realistic | worker | 5 | 11 | 165 | 860.1 / 2170.5 / 2170.5 | 13 | 217 |

Each block was one z15 tile. A block took **0.6 to 1.0 s** (median) and up to **2.2 s** to read from the published
archive over the internet, and at most 13 ms to decode. The page asked for 11 tiles in 240 s, which is the start's four
and seven more; that rate, 165 an hour, is dominated by the start and is not the hour's figure, which follows.

### Tiles an hour, and the lead at 40 km/h

Counted by `run-streaming.mjs` (`results/streaming.json`) over hour-long scripted rides on the real z15 grid, five seeds
at each start: every block that comes within 600 m (the fog's 400 m and the page's 200 m lead) of the rider, once.

| Turns | Block | 30 km/h, tiles an hour (min / median / max) | 40 km/h |
|---|--:|--:|--:|
| left or right at random (the page's ride: it wanders and comes back) | 1 tile | 21 / 33 / 46 | 25 / 42 / 54 |
| | 2×2 | 32 / 52 / 68 | 36 / 60 / 76 |
| | 4×4 | 64 / 96 / 128 | 64 / 96 / 144 |
| left and right in turn (a staircase: it never comes back) | 1 tile | 77 / 83 / 88 | 102 / 109 / 114 |
| | 2×2 | 104 / 116 / 124 | 140 / 152 / 164 |
| | 4×4 | 144 / 160 / 192 | 192 / 208 / 240 |

So the estimate the owner was given, "a few hundred an hour", was high: a ride that never comes back reads **about 110 tiles an hour at
40 km/h in one-tile blocks**, and one that wanders reads a third of that. Coarser blocks read more for the same ride:
2×2 blocks 1.4 to 1.6 times as many, 4×4 1.9 to 2.9 times. A tile is one range request, and a leaf directory of the
archive is one more where it is not yet held, so at about 110 tiles an hour Class B reads are far inside the free tier (`docs/cost-model.md`).

**The lead.** A block is ready when it has been read **and** the town planned over it. The slowest of each on this Mac
over all eight runs were a 2,171 ms read and a 2,581 ms plan latency, so a block was taken to be ready **4.75 s** after it
was asked for. At 40 km/h (11.1 m/s) the shortest lead at which no block was ever needed before it was ready, over ten
hour-long rides, was **60 m past the fog: ask for every block within 460 m**. The tablet is slower, and how much slower is
owed; if it reads and plans three times as slowly the lead is 170 m (570 m in all), and at five times 270 m (670 m).

## What `RouteProfile` / `routeProfile` had to change

Read in `packages/domain/src/route/profile.ts` at `ae37331f2`, and held by `rolling-profile.test.ts`.

1. **The grid is stretched to land on the end** (`profile.ts:484–486`, `const resolution = total / (count - 1)`). A
   profile that grows would re-space every sample at every extension, and every odometer reading would move under the
   rider. The rolling profile spaces its samples exactly 10 m apart and carries the part of a step left over to the next
   extension. *Test: "spaces its samples exactly, where routeProfile stretches its grid to the end".*
2. **The three arrays are fixed and `readonly`** (`profile.ts:190–216`), and consumers hold them. The rolling profile
   keeps its own growable arrays and hands out a **new `RouteProfile` after every change** and the same one otherwise,
   so a holder of an old one is never changed under it. *Test: "never moves a sample it already handed out when it
   grows".*
3. **`routeProfile` refuses points with no height** (`profile.ts:283–287`, *"no point in this route carries an
   elevation"*). An open-world ride has no heights until #2013's DEM; the spike gives every point 0 m. #2885 decides
   where they come from.
4. **The grade at the end is provisional.** The slope is fitted over a 100 m window (`GRADIENT_WINDOW_METRES`); its
   last 50 m has no road past it. The rolling profile fits again the samples within a window of every change and says
   how far the grade is final (`settledTo`). *Test: "fits the grade again near the end once more road is known".*
5. **The head is never dropped.** `terrain.ts:549–556` §`corridorOrigin` and `scatter.ts:897–904` §`scatterSeed` both
   read `positions[0]`, so dropping ridden road moves the world's origin and re-seeds the scenery. The arrays grow for
   the whole ride: 3,000 samples an hour at 30 km/h.
6. **`distanceOnRoute` clamps a ride that is not a loop at `totalDistance`** (`profile.ts:551–554`). The rider must never
   reach the end of what is known, so the default branch has to be extended before the rider is within the fog of it.
7. **Every per-profile cache sees a swap as a new route.** `scene.ts` and the modules under it keep a dozen caches keyed
   on the profile object or the corridor object (`racing-line.ts:436` and `:464`, `drawn-line.ts:130`,
   `road-grid.ts:48`, `cross-streets.ts:958`, `landform.ts:1991`, `waterways.ts:474`, `streets.ts:508`,
   `footways.ts:235`, `footprint-buildings.ts:5886`, `land-class.ts:807`, `park-dressing.ts:354`), and each is rebuilt
   over the **whole** profile on the first frame after a swap. In the stylised world that frame stayed under 50 ms on
   this Mac; in the realistic world it was 64 to 217 ms with no planning on the main thread (the worker runs), and how
   much of that is these caches and how much a realistic belt was not profiled.

## How the stylised scenery is keyed

**By the route, not by the place.** Read in `apps/web/src/game/scatter.ts` at `ae37331f2`:

- The seed is `scatterSeed(profile)` (`scatter.ts:897–904`): the route's **first point** and its **rounded
  `totalDistance`**.
- Placement is "a stateless hash of where you are" (`scatter.ts:31`), and where you are is a **cell of odometer**:
  `cellSpanMetres(profile)` (`scatter.ts:1022–1025`) divides the route's whole length into equal cells.
- `footprint-buildings.ts:5324` seeds every mapped building's paint, roof and variant from the same `scatterSeed`.

So **riding back down a street does not show the same scenery**: the same street as part of another route, or the other
way, has another seed and other cells (*test: "grows other scenery on the same street ridden the other way"*, which
finds no item in the same place). And a rolling profile **re-seeds and re-cuts every cell at every extension**, because
`totalDistance` changes: the scenery beside the rider is replaced each time the road ahead grows (*test: "re-seeds and
re-cuts the cells when a rolling profile grows"*). An open-world ride needs scenery keyed by place — a hash of the
ground's own coordinates in a fixed world frame, with the seed taken from the grid rather than the route.

## How `CORRECTION_GRADE_STEP_PERCENT_PER_SECOND` is applied

Read in `apps/web/src/game/gradient.ts` and `apps/web/src/net/correction.ts` at `ae37331f2`:

- The constant is **1 % a second** (`correction.ts:82`), chosen for #782's room corrections.
- It is applied only on the **bounded path** of `GradientSession.sample` (`gradient.ts:296–316`): a sample marked
  `bounded` sets `owed` (`:296`); while owed, every write is the road's grade (`gradeAt(profile, distanceOnRoute(…))`,
  `:300`) clamped to within `CORRECTION_GRADE_STEP_PERCENT_PER_SECOND × elapsed` of the grade last sent (`:310–311`),
  where `elapsed` is capped at one setpoint interval (`:309`). It stays owed until the trainer is on the road's own
  grade, then the ordinary driver takes over again.
- The session **captures the profile once**: `createGradientSession` builds its driver with `createSimulationDriver({
  profile })` (`gradient.ts:197–200`), and `GameView.tsx:2967` creates it per ride. A rolling profile needs a session
  that is told of each new profile, or one that reads the grade through a function.

So a grade lock or slew limit at a junction (#2899) can reuse the bounded path as it stands: mark the samples around a
swap `bounded`, and the trainer walks to the new road's grade at 1 % a second and is released when it gets there.

## Recommendation

For #2884, #2895 and #2901 to decide; a spike decides nothing.

1. **The request grid: one z15 tile a block.** It reads the fewest tiles for a turning ride (about 110 an hour at
   40 km/h at most), it is already a fixed grid that is never centred on a place, and a tile is already 0.9 by 1.2 km at
   this latitude, which is coarse. A 2×2 block reads 1.4 to 1.6 times as much for no gain in time to ready.
2. **The lead: ask for every block within 700 m of the rider** — the fog's 400 m and 300 m more. On this Mac 460 m was
   enough at 40 km/h; 700 m holds at five times slower reads and plans, until the tablet says what its own number is. A
   lead costs almost nothing: it moves a read earlier, and with the ridden-tile cache it adds no reads.
3. **A worker is required for the first version — and is not enough by itself.** With today's planners on the main
   thread a turn stalls the ride for 0.3 to 2.4 s on a desktop chip; the tablet's figure is owed. Moving
   `footprintPlans` to a worker took the longest stall to 0.13 to 0.28 s, which still dropped 19 to 146 frames over a
   run's five swaps. The rest has to go too, and each needs a product change that this spike did not make:
   - **Plan per tile, not per route.** `footprintPlans` re-plans every footprint in reach against the whole route at
     every swap, because a plan reads the route (its seed, `footprint-buildings.ts:5324`, and its clearance from the
     road). A building's plan in an open world must depend on its tile and the street network, so that it is planned
     once, when its tile arrives, and never again.
   - **Make the land-class mask and the urban class transferable** (typed arrays, not objects with methods), so the
     worker's are the ones drawn.
   - **Key the per-profile caches by place, or extend them, rather than rebuilding them over the whole ride at a swap**
     (finding 7), and find which realistic belt pays 64 to 279 ms on the first frame on a new profile or a new town.
   - **Key the scenery by place** (the scenery section): today it is re-seeded at every extension.
4. **What the turn does not need:** anything for the view's swing. The corner itself was an ordinary frame in every run.

## Waiting on the owner

The issue's first criterion is measured on the owner's tablet, and is **not met here**:

- **Frame time p50 / p95, dropped frames and GPU frequency for both worlds, main thread and worker, steady and at
  turns, on the tablet.** Every number above is the Mac's. The tablet's GPU frequency
  (`/sys/class/misc/mali0/device/cur_freq` once a second, #1523's method) and its graphics memory (`dumpsys meminfo`'s
  `Graphics` row) were not read: neither is reachable from a page.
- How to take them, with no install: build and serve the page from the Mac on the local network
  (`pnpm exec vite build --config tools/rolling-route-spike/vite.config.ts` and
  `pnpm exec vite preview --config tools/rolling-route-spike/vite.config.ts --host`, from `apps/web`), open
  `http://<the Mac>:4173/?world=realistic&planning=worker&place=suburb&seconds=240` in the tablet's Chrome for each of
  the eight configurations, and read the one `OYL-SPIKE-0040 {…}` line each run prints, through `adb logcat` or Chrome's
  remote inspector, while reading the GPU clock over `adb`. The tablet's Chrome is not the shell's WebView; the shell's
  numbers would need the page staged into a debug build, which the ruling rules out for now.

## What this did not measure

- **Real heights.** The ride is flat (no DEM, #2013); grade, ground and the grade step at a junction are untested here.
- **A street graph.** The legs are compass-aligned and only roughly on the streets; #2881 builds the graph.
- **The shell's WebView, the quality ladder, and a ride longer than four minutes.** The per-profile caches grow with the
  ride (finding 7), so a swap an hour in would rebuild them over fifteen times the road; what that costs was not
  measured.
- **The network as a rider has it.** The block reads are this Mac's home connection to the archive's host on one
  evening, with whatever the host's own cache held; a tablet on its Wi-Fi, or a phone's connection, was not measured.
