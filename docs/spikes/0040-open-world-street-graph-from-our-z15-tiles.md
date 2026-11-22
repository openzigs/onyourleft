# Spike 0040: An open-world street graph from our z15 basemap tiles, measured against Valhalla

- **Date measured**: **2026-11-19.** Every figure below was measured that day on the machine in
  "Cost".
- **Issue**: [#2881](https://github.com/openzigs/onyourleft/issues/2881), Phase 0 of the open-world
  epic [#2880](https://github.com/openzigs/onyourleft/issues/2880), on the owner's ruling Q3 of
  2026-11-19 (*"Allow, prove in a spike"*) and the lane note of the same day (*"Desktop measurement
  only; no device, no deploy"*). Informs [#2886](https://github.com/openzigs/onyourleft/issues/2886),
  the ADR on the graph's source, and through it #2892, #2893 and #2894.
- **Number**: **0040.** `docs/spikes/` holds 0001 to 0008, 0010 to 0020 and 0022 to 0039 on
  `origin/main` at `ae37331f2`; no open pull request adds a spike on that day.

A spike is a dated measurement that decides nothing (`docs/agents/conventions.md` §7). No product
code changes here.

## Rules this spike holds

- **No coordinate, no tile id and no place name.** The sample areas are public places, chosen here
  from the map and never from any rider's data, and they are called by their class only, as spike
  0035 did. Their positions,
  the tiles read and the probe points were kept in a throwaway working directory and nowhere else.
- **No data and no script is committed.** The measuring code was throwaway and local, as spikes
  0031, 0033 and 0035's were; the method below is written so that it can be rebuilt. Code meant to
  be kept is #2894's, under `packages/` (Apache-2.0).
- **No GPL code read for this, and none copied.** Velopopuli was not opened. The Protomaps profile
  (BSD-3-Clause) and Valhalla (MIT) were read for what they write.
- **No paid service** (ADR 0036 D-7). The archive is the one every build already reads; Valhalla
  ran in Docker on the development Mac; the extracts are Geofabrik's free downloads.
- **No device.** The tablet half of question 5 is the owner's, and it was **not** taken.
- **Unmeasured is not a pass.** What was not measured is listed at the end.

## The questions

The issue's six: (1) whether our archive carries `oneway`, `access` and `is_link` at z15; (2) how
many junctions a graph built from the tiles finds, misses and invents, and how many it loses at a
tile seam, against a Valhalla graph of the same area; (3) whether a node where three or more lines
meet survives as a line endpoint or vertex after Protomaps' line merging; (4) roundabouts found by
shape; (5) build time and memory for a 3×3 block of z15 tiles; (6) whether `valhalla-browser`
0.2.1 exposes graph traversal.

## Method

### The archive

| | |
|---|---|
| File | `basemap-us-oyl-20261031.pmtiles` at `https://tiles.openzigs.com/` (`apps/web/src/map/basemap.ts` §`PUBLISHED_BASEMAP_URL`) |
| Identity (the header's etag) | `"d31ad8c706ecfaaec69ab8fdee191ada-164"` |
| Build | Our own Planetiler build of the Protomaps profile at `42ffaaa4a85a41bfcb23e43cc0f5b492a5eca123` (`apps/web/tools/basemap/build.sh` §`UPSTREAM_SHA`), from the 2026-10-31 US extract (ADR 0062) |
| Read | 153 z15 tiles (17 blocks of 3×3) by range request through `pmtiles` 4.5.0, the version `apps/web` pins |

Each tile's `roads` layer was decoded whole, every key and value, by a throwaway reader, not by
`@onyourleft/map-features` §`decodeTile`, which drops `oneway` and `access` on purpose.

**What Protomaps writes at the pinned commit**, read in `tiles/src/main/java/com/protomaps/basemap/layers/Roads.java`
at `42ffaaa4` (the research had read upstream `main`): `oneway` from the way's own `oneway` tag
with min zoom 14; `access` from its `access` tag with min zoom 15; `is_link` on every `*_link`;
`is_bridge` and `is_tunnel` from z12. `service` is copied only when `kind` is `other`. Every zoom
ends in `FeatureMerge.mergeLineStrings(items, 0.5, 0.1, 4)`: lines with equal attributes are joined
end to end, lines under 0.5 px dropped, the result simplified at 0.1 px, and anything more than
4 px outside the tile cut. At z15 a pixel (of 256) is about 3.6 m here, so 0.1 px is about 0.36 m.

### The reference graph

| Step | What | Measured |
|---|---|---|
| Input | Geofabrik extracts of one small US state and its two neighbours (so that the state line does not cut the reference), each `Last-Modified` 2026-11-19 | 52.6 MB, 311.9 MB and 217.6 MB |
| Build | `ghcr.io/valhalla/valhalla:3.8.3` (spike 0035's), `valhalla_build_tiles`, `mjolnir.concurrency` 2 to fit Docker's 4 GB | 109 s |
| Edges | Every directed edge of every level whose shape reaches within 0.004° (300 to 450 m) of a block, read with the image's own Python bindings (`valhalla.utils.GraphUtils.get_edge_shape`) | 119,395 directed edges over the 17 blocks |
| Attributes | Each edge's `classification`, `use`, `link`, `bridge`, `tunnel` and `round_about`, read back through `locate` (verbose) at the edge's own midpoint, keeping only the candidate whose `edge_id` is that edge | 5,068 were not read back, and none is lost: 3,096, all on levels 0 and 1, are shortcuts, which `locate` never returns and which must not count; the other 1,972, in the two blocks on the state line, are each the exact twin of an edge that was read (a way in two extracts is built twice) |

⚠️ **The reference is 19 days newer than the archive.** Geofabrik keeps no 2026-10-31 extract of
the state, only the latest and one per year. Edits made between the two dates count as misses or
false junctions below; they are a floor under both, not a property of the tiles.

### The two street sets

The comparison is of like with like: the ways a rider could follow, at grade, with motorways out,
as `apps/web/src/game/cross-streets.ts` §`meetsAtGrade` already rules.

| | Basemap (`roads` at z15) | Valhalla |
|---|---|---|
| **All streets** | `kind` `major_road` or `minor_road`, or `other` with a street `kind_detail` (`@onyourleft/map-features` §`STREET_KINDS`, §`OTHER_STREET_KIND_DETAILS`); never a footway (§`FOOTWAY_KIND_DETAILS`); never `kind` `highway` (motorways and their links) | `use` `road`, `ramp`, `turn_channel`, `alley`, `driveway`, `parking_aisle`, `emergency_access`, `drive_through`, `living_street`, `service_road`, `culdesac`; never a motorway, nor a ramp joined to one through ramps |
| **Public streets** | the above without `kind_detail` `service` | `use` `road`, `ramp`, `turn_channel`, `living_street`, `culdesac` |

A **Valhalla junction** is a graph node where three or more distinct undirected street edges meet.
Nodes are keyed by position, so a node's copies on two hierarchy levels are one node.

### Building the graph from the tiles

For each block, all nine tiles' street lines in one plane (Web Mercator tile units scaled to metres
at the block's middle), then:

1. **Clip** every line to its own tile's box, so the 4 px buffer two neighbours share is not read
   twice. A clip point on an inner seam is a **seam end**.
2. **Snap** points within 1.0 m into one node. A bridge's or a tunnel's inner vertices never snap
   to another line; their ends do, which is where they meet the road at grade.
3. **Stitch seams**: a seam end joins a seam end of the neighbouring tile within 3.0 m.
4. **Crossings**: two at-grade segments that cross make a node on both, at the crossing.
5. **T-snaps**: a line end that is still dangling and lies within 3.0 m of another at-grade line
   makes a node on that line.

A **tile junction** is a node with three or more distinct neighbours. Its **form** is recorded:
*endpoints* (only line ends meet there), *vertex* (a line passes through on a vertex of its own),
*crossing* (step 4 was needed) or *T-snap* (step 5 was needed).

### Matching

Junctions are counted inside each block less a 50 m border, where the clip at the block's outer
edge can cut an arm off. Each Valhalla junction is paired with at most one tile junction, nearest
first, within the **matching tolerance: 8 m**, `cross-streets.ts` §`JUNCTION_TOLERANCE_METRES`.
5 m and 15 m were run too. **Missed** is a Valhalla junction with no pair; **false** is a tile
junction with no pair; **seam-lost** is a missed junction within the tolerance of an inner seam.

**A control.** The same matching with every tile junction moved 25 m east pairs 8.6 % (suburb),
6.4 % (town) and 10.4 % (city centre) of the Valhalla junctions. The agreement below is not what a
dense network gives by chance.

## Results

### 1. What our archive carries at z15

From the 27 decoded tiles of the three areas (1,576 `roads` features):

| Field | Present at z15 | Features carrying it (suburb / town / city centre) | Values seen |
|---|---|---|---|
| `oneway` | **yes** | 28 / 45 / 393 | `yes`, `no`, `-1` |
| `access` | **yes** | 23 / 15 / 67 | `yes`, `no`, `private`, `customers`, `permissive`, `destination` |
| `is_link` | **yes** | 3 / 1 / 24 | `true` |
| `is_bridge` | yes | 7 / 12 / 76 | `true` |
| `is_tunnel` | yes | 1 / 3 / 22 | `true` |
| `service` | only on `kind` `other` | 0 / 1 / 7 | |
| a roundabout (`junction`) | **no** | — | |

Every one of the three fields the issue asked about is in our archive, because our build pins the
profile that writes them. Two things the profile does not write matter below: **no roundabout
flag, and no `oneway` that OSM only implies** (a `junction=roundabout` way with no `oneway` tag
reaches the tile with none), and **no service subtype on a `minor_road`**, so a driveway, a parking
aisle and an alley are all `kind_detail` `service`.

### 2. Junctions, per area

All streets. Tolerance **8 m**; the 5 m and 15 m runs differ from these by at most one junction.
**Recall** is matched over Valhalla junctions, **precision** matched over matched plus false.

**Suburb** (9 tiles, 115,299 bytes decompressed)

| Valhalla junctions | Matched | Missed | False | Seam-lost | Recall | Precision |
|---:|---:|---:|---:|---:|---:|---:|
| 489 | 487 | 2 | 6 | 0 | 99.6 % | 98.8 % |

**Town centre** (9 tiles, 173,540 bytes)

| Valhalla junctions | Matched | Missed | False | Seam-lost | Recall | Precision |
|---:|---:|---:|---:|---:|---:|---:|
| 405 | 405 | 0 | 3 | 0 | 100 % | 99.3 % |

**City centre** (9 tiles, 665,095 bytes)

| Valhalla junctions | Matched | Missed | False | Seam-lost | Recall | Precision |
|---:|---:|---:|---:|---:|---:|---:|
| 2,153 | 2,126 | 27 | 20 | 0 | 98.7 % | 99.1 % |

**Public streets only** (service roads out on both sides), same tolerance:

| Area | Valhalla junctions | Matched | Missed | False | Seam-lost |
|---|---:|---:|---:|---:|---:|
| Suburb | 184 | 184 | 0 | 1 | 0 |
| Town centre | 218 | 218 | 0 | 0 | 0 |
| City centre | 794 | 784 | 10 | 1 | 0 |

- **Where they agree, they agree to decimetres**: matched pairs are a median 0.09 m apart, the 95th
  percentile 0.19 to 0.24 m, the largest 2.1 m. Both are drawn from the same OSM nodes.
- **What is missed and invented is mostly service roads.** Of the city centre's 27 misses, the
  edges at 18 included a service road, parking aisle or driveway; of its 20 false junctions, 19
  had a `service` line in them (suburb: 2 of 2 misses and 5 of 6 false; town centre: 3 of 3
  false). Short stubs that the 0.5 px rule drops, and the 19 days
  of edits, account for the rest; neither was separated from the other.
- **Seams cost nothing.** With step 3, no junction in any of the 17 blocks was lost at a seam
  (12, 12 and 68 Valhalla junctions lie within 8 m of a seam in the three areas). With seam ends
  joined only where they coincide exactly, 3 were lost in the city centre, none in the other two
  areas and 1 in each of 6 of the 14 roundabout blocks.
- **The tolerances are not tuned to the answer.** Snap 0.5 m with T-snap 0.5 m found 488, 405 and
  2,130; 2 m with 5 m found 485, 403 and 2,114, with 7, 3 and 25 false.
- **The 14 roundabout blocks** (below), as a fourth sample: 6,956 Valhalla junctions, 6,904
  matched (99.3 %), 61 false, 0 seam-lost; public streets 2,272, 2,252 matched, 11 false.

### 3. What line merging and 0.1 px simplification leave

A node where three or more lines meet **often does not survive as a vertex**. Of the matched
junctions:

| Area | Endpoints | Vertex | **Needed a crossing** | **Needed a T-snap** | Found with steps 4 and 5 off |
|---|---:|---:|---:|---:|---:|
| Suburb | 8 | 220 | 133 | 126 | 233 of 489 (47.6 %) |
| Town centre | 10 | 164 | 135 | 96 | 176 of 405 (43.5 %) |
| City centre | 87 | 671 | 752 | 616 | 765 of 2,153 (35.5 %) |

A straight street through a crossroads is collinear at the junction, so the merged line keeps no
vertex there and the simplification removes the one it had; a side street's end then lies on a
segment, not on a point. **Snapping points alone finds a third to a half of the junctions; the
geometric steps find the rest.** They are what `cross-streets.ts` already does relative to one
route, done for the whole network.

### 4. Roundabouts

None of the three areas has one, so 15 more blocks were read, each centred on a roundabout drawn
at random (seed 2881) from the 82 that the reference graph flags in the state (`round_about`
edges joined into rings, rings within 40 m counted once). Two fell in one block, which was read
once: **14 blocks, 26 roundabouts** inside their counting areas. A tile ring is a cycle of at-grade
lines 25 to 300 m round whose shape is at least 0.85 round (4π·area / perimeter²; a square is
0.79), paired with a Valhalla roundabout within 30 m.

| Detector, over all 17 blocks | Found | Missed | False |
|---|---:|---:|---:|
| **A small one-way ring** (every line `oneway=yes`) | **11** | **15** | 14 |
| Any small round ring, one-way or not | 25 | 1 | 73 |

The one-way test misses 15 of 26 because a roundabout's `oneway` is usually implied, not tagged,
and the tile carries only a tagged one. Without it, shape alone finds them and also every round
cul-de-sac, turning circle and circular drive (73). **Neither is good enough to call something a
roundabout**: the tiles cannot say which way a ring runs, or that it is one.

### 5. Cost

Desktop only: an Apple M4 Pro, Node 26.13.0 (V8), the throwaway builder above (all five steps plus
the ring search, which is quadratic in places and unoptimised). One cold build is a fresh
`worker_threads` worker, its first and only build; warm is the main thread after two builds, the
median of ten. Memory is V8's heap: growth during the build (garbage included, no collection
forced) and the worker's whole heap afterwards, against **5.6 MiB for an empty worker**.

| Area | Cold, in a worker | Warm, main thread (median / max) | Heap growth | Worker heap after |
|---|---:|---:|---:|---:|
| Suburb | 21 to 22 ms | 8.4 / 9.0 ms | 6.5 to 11.0 MiB | 22 to 25 MiB |
| Town centre | 15 to 16 ms | 5.3 / 7.3 ms | 2.9 to 3.7 MiB | 20 to 21 MiB |
| City centre | 61 to 64 ms | 34.2 / 35.5 ms | 15 to 28 MiB | 56 MiB |

Ranges are over five cold runs. **The city centre's 34 ms warm on the main thread is two frames at
60 Hz on this desktop**, so the build belongs in a worker or must be split per tile (#2894, #2901),
on this evidence before the tablet's is taken. Not a browser and not the tablet: see below.

### 6. Does `valhalla-browser` 0.2.1 expose graph traversal?

**No.** Read in the published tarball (`npm pack valhalla-browser@0.2.1`):

- `dist/client.d.ts`: the `Router` class has `initialize()`, `route(request)`, `diagnostics()`,
  `cancel()` and `dispose()`, and `createRouter(options)`. Nothing else is exported but types and
  `RoutingError`.
- `dist/protocol.d.ts`: the worker's `Operations` are `initialize`, `route` and `diagnostics`.
- `dist/core/engine.d.ts`: `Engine` has `initialize`, `route`, `diagnostics` and `dispose`; the
  WebAssembly exports the worker calls are `_vb_init`, `_vb_route`, `_vb_stats` and `_vb_dispose`.

There is no locate, no expansion and no way to ask for the edges at a node. A graph from Valhalla
tiles in the browser would mean decoding Valhalla's binary `.gph` format ourselves, against a
format tied to the Valhalla version that wrote it.

## Recommendation

**The tiles as they are**, for the first open-world ride's street graph: no road-graph fields added
to our archive build, and no Valhalla tiles.

The numbers the ADR on the graph source (#2886) should rest on:

1. **Junction recall 98.7 to 100 % and precision 98.8 to 99.3 %** in the three areas at 8 m (§2),
   **0 junctions lost at a seam** in 17 blocks, matched positions a median 0.09 m apart; and on
   public streets alone, recall 98.7 to 100 % with at most one false junction an area.
2. **Steps 4 and 5 are required**: snapping points alone finds only 35.5 to 47.6 % (§3). The
   builder is geometric, as `cross-streets.ts` is, not a reading of shared vertices.
3. **`oneway`, `access` and `is_link` are in the archive at z15** (§1), so the graph can read them
   with no change to our build; the two things it cannot read are a roundabout and a service
   subtype.
4. **Cost**: 15 to 64 ms cold and at most 56 MiB of worker heap for a 3×3 block on the desktop (§5),
   pending the tablet.
5. **Valhalla tiles add a second download and a binary format we would have to decode**, since
   `valhalla-browser` 0.2.1 routes and does nothing else (§6), for junctions the tiles already give
   to within the reference's own drift.

**What would justify the second option later**, for #2893 to weigh: a roundabout flag (or OSM's
implied `oneway` on a roundabout) written by our build. The tiles find 11 of 26 roundabouts as
one-way rings (§4); without the flag the graph treats a roundabout as a ring of ordinary junctions
and cannot say which way it runs. That is a question about how a turn at a roundabout is offered
(#2887), not about whether the graph is right.

## Not measured, and limits

- **The owner's tablet**, on the main thread and in a worker, in the Capacitor WebView: the issue's
  criterion, left to the owner by the lane note. This is the gate on question 5.
- **A browser.** The desktop figures are Node's V8, not Chromium's main thread or a Web Worker.
- **The same OSM date.** The reference is 19 days newer than the archive (Method).
- **One state, three areas and 14 roundabout blocks.** A city with a grid of dual carriageways, or
  a rural area, was not read.
- **Grade separation without a bridge or tunnel flag.** OSM's `layer` is not in the tiles; two
  lines that cross without a flag are a junction here, as in `cross-streets.ts`. None was told
  apart from a real one.
- **Footways, cycleways and tracks.** Neither street set has them; whether an open-world ride may
  follow a cycleway is the ADR's question.
- **Turn restrictions.** Valhalla holds them and the tiles do not; not compared.
- **An incremental build.** The block was built whole, not tile by tile as a streamed ride adds
  tiles (#2894).
- **One machine.** No timing here is a distribution beyond the runs stated.
