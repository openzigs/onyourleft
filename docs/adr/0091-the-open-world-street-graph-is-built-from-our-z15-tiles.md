# ADR 0091: The open-world ride's street graph is built from our z15 basemap tiles, to follow streets and never to plan a route

- **Status**: **Proposed**, 2026-11-19, on the owner's ruling Q3 of 2026-11-19 on the epic #2880.
  Accepted only on the owner's approval on its pull request. D-9 lists the questions for the owner
- **Date**: 2026-11-19
- **Deciders**: **the owner**, who ruled Q3 on 2026-11-19 (quoted in Context) and asked for it to be
  proven first. **The author** chose among the three sources the ruling and #2886 name, on
  [spike 0040](../spikes/0040-open-world-street-graph-from-our-z15-tiles.md)'s measurements, and
  decided what the ruling leaves open. Each such choice is marked *the author's choice*
- **Issue**: [#2886](https://github.com/openzigs/onyourleft/issues/2886), Phase 0 of the open-world
  epic [#2880](https://github.com/openzigs/onyourleft/issues/2880); it rests on
  [#2881](https://github.com/openzigs/onyourleft/issues/2881)'s spike
- **Number**: **0091**. The owner's lane note of 2026-11-19 on #2881 reserved **0090** for this
  ADR. On the same day the open pull request
  [#2942](https://github.com/openzigs/onyourleft/pull/2942) wrote 0090 for #2884, because the 0086
  reserved for #2884 was already ADR 0086 (#2869). A number claimed by an open pull request is
  taken, so this ADR takes **0091**, the first number after it. The open pull requests #2873 (0081),
  #2864 (0083), #2863 (0084) and #2872 (0085) do not collide, and 0087 to 0089 stay reserved for
  #2885, #2887 and #2888
- **Supersedes**: nothing. **Extends**, for the open-world ride only,
  [ADR 0054](0054-towns-from-real-map-data.md) D-2.2's list of the fields read from `roads`: D-2
  below adds `oneway`, `access` and `is_link`. ADR 0054 gains one dated `## Amendments` entry pointing
  here. Its body is not edited
- **Leaves standing**: #2009's ruling of 2026-11-02 for snapping and routing a drawn route (D-6);
  [ADR 0062](0062-we-build-our-own-basemap-archive-from-openstreetmap.md) unchanged, with no
  road-graph field added to the build (D-1); ADR 0054 D-2.2's other rule, that no name, house number
  or OSM identifier is read; ADR 0004 D (no coordinate in an error)

---

## Context

The open-world ride (#2880) lets a rider start anywhere and turn at junctions. It needs a street
graph round the rider: which streets meet where, and which way each leaves. The basemap archive the
ride is to stream (#2884, Proposed as ADR 0090 in pull request #2942) holds lines, not a graph.

**The owner's ruling Q3, 2026-11-19, verbatim:**

> **Q3, road graph: "Allow, prove in a spike (Recommended)"** — building the free ride's street
> graph from the basemap is allowed (it follows streets; it does not plan routes, so #2009's ruling
> does not bind it), proven first in a Phase 0 spike measured against a Valhalla graph; the
> project's own basemap build (ADR 0062) may add road-graph fields if the spike says so.

**#2009's ruling, 2026-11-02, verbatim** (the owner's rulings of that day on
[#2009](https://github.com/openzigs/onyourleft/issues/2009)):

> **Do not route on the basemap's `roads` layer**: its roads are merged with no ids, simplified,
> clipped at tile edges, and carry no bicycle, surface or turn tags.

**Why the first does not contradict the second.** #2009's ruling is about **routing**: snapping a
drawn route to roads and choosing the path between two points. That needs a way's identity, so a
saved route can name the ways it uses. It needs bicycle and surface tags to cost a path, and turn
restrictions to keep the path legal. The basemap has none of these, and the ruling stands for that
use (D-6). An open-world ride plans nothing. It **follows the street the rider is on and offers the
streets that meet it**, and the rider chooses. For that it needs only where streets meet, at grade.
Spike 0040 measured each of #2009's four objections for this use:

- **Merged and simplified.** These cost the junction vertex at 52 to 65 % of junctions. Finding
  the junctions geometrically recovers them (D-4).
- **Clipped at tile edges.** No junction was lost at a seam once seams are stitched.
- **No ids and no bicycle, surface or turn tags.** Following a street does not need them.

So the two rulings answer different questions, and the one graph source serves only the question
Q3 allows.

**What spike 0040 measured** (2026-11-19, desktop only). It built a graph from our archive's z15
`roads` and matched it against Valhalla 3.8.3 built from the same OSM data, at an 8 m tolerance:

| Area | Valhalla junctions | Recall | False junctions | Precision | Lost at a seam |
|---|---:|---:|---:|---:|---:|
| Suburb | 489 | **99.6 %** | **6** | 98.8 % | 0 |
| Town centre | 405 | **100 %** | **3** | 99.3 % | 0 |
| City centre | 2,153 | **98.7 %** | **20** | 99.1 % | 0 |

- **Public streets, service roads out on both sides:** recall 100 %, 100 % and 98.7 %, with 1, 0
  and 1 false junctions.
- **Distance:** matched junctions are a median 0.09 m apart.
- **Shared vertices are not enough.** Line ends and shared vertices alone find only **35.5 to
  47.6 %** of the junctions. The rest need an at-grade crossing or a line end snapped onto another
  line.
- **Fields at z15:** `oneway`, `access` and `is_link` are in our archive. A roundabout flag and a
  service subtype are not. A one-way ring finds **11 of 26** roundabouts.
- **Cost:** a 3×3 block builds in 15 to 64 ms cold on the desktop. The tablet figure is owed.
- **Valhalla in the browser:** `valhalla-browser` 0.2.1 exposes routing only, with no graph
  traversal.

## Decision

### D-1 — The source: our z15 basemap tiles as they are

The open-world ride's street graph is built on the device from the **`roads` layer of the z15
tiles of the configured basemap archive**. That is the archive `apps/web/src/map/basemap.ts`
resolves (ADR 0054 D-2.1), built per ADR 0062, and the open-world ride is to stream those tiles
(#2884). Of the three sources #2886 names, this is the first. The other two are not taken:

- **No road-graph field is added to our archive build.** The junction recall above needs none.
  ADR 0062 and its build are unchanged, and #2893 stays unneeded unless D-9 Q4 says otherwise.
- **No Valhalla tiles.** They would be a second download beside tiles the ride already reads.
  `valhalla-browser` 0.2.1 offers no traversal, so we would have to decode Valhalla's binary tile
  format ourselves, and it gives junctions the tiles already give to within decimetres.

*The author's choice*, on the numbers in Context.

### D-2 — What the graph reads, and what it never reads

From each `roads` feature at z15, and nothing else:

- `kind` and `kind_detail`, already decoded (`@onyourleft/map-features` §`StreetFeature`);
- `is_bridge` and `is_tunnel`, already decoded as `StreetFeature.grade`;
- **`oneway`**, read as one of `yes`, `-1` or absent. Any other value, including `no`, is treated
  as absent;
- **`access`**, read only to tell whether it is `no` or `private`. Any other value, or none, is
  treated as open;
- **`is_link`**, as a boolean.

The last three are new to the decoder (#2892). **Never read**: `name` and every `name:*`, `ref`,
`network*`, `shield_text*`, `service` and `min_zoom`. No OSM identifier is in the tiles to read.
ADR 0054 D-2.2's rule that no name, house number or OSM identifier is read stands as it is.

### D-3 — Which ways are in the graph, and which are never junctions

- **In the graph**: the streets `@onyourleft/map-features` already keeps, that is `kind`
  `major_road` or `minor_road`, or `other` with a street's `kind_detail` (§`STREET_KINDS`,
  §`OTHER_STREET_KIND_DETAILS`).
- **Never in the graph**: `kind` `highway`, which is motorways and their links, as
  `apps/web/src/game/cross-streets.ts` §`meetsAtGrade` rules. Footways and paths, the `path` kind
  and §`FOOTWAY_KIND_DETAILS`, are left out of the first version. That is *the author's choice*,
  put to the owner as D-9 Q1.
- **Never a junction where they cross**: a line on a bridge or in a tunnel. Its ends join the street
  where it comes back to grade, but a street it passes over or under meets it nowhere.
- **Never offered as a turn**: a way whose `access` is `no` or `private`, and a way whose
  `kind_detail` is `service`. Driveways, parking aisles and alleys all carry that one value, which
  the tiles cannot tell apart. The spike's public-street figures are the graph with these left out.
  Leaving service ways out is *the author's choice*, put to the owner as D-9 Q2.

### D-4 — Junctions are found geometrically, not read from shared vertices

The builder (#2894) does what spike 0040 §"Building the graph" did, per tile as tiles arrive:

1. Clip each line to its own tile.
2. Snap points that coincide within a small tolerance.
3. Stitch seam ends across tile edges.
4. Make a junction where two at-grade lines cross.
5. Make a junction where a dangling line end lies on another at-grade line.

Its tolerances are #2894's, set with tests against the spike's figures, which held from 0.5 m to
5 m. **A builder that reads only shared vertices does not meet this ADR**: it finds at most 47.6 %
of the junctions.

### D-5 — One-way streets and roundabouts

- A turn **against** a street's `oneway` is not offered. A street tagged `-1` runs against its
  line's direction. *The author's choice*, put to the owner as D-9 Q3.
- **A roundabout is a ring of ordinary junctions.** The tiles carry no roundabout flag. A ring's
  direction is known only where its lines carry `oneway`, which 11 of the spike's 26 roundabouts
  did. The ring is not inferred from shape, because that matched 73 rings that were not
  roundabouts. Adding a roundabout flag to our build is the one change the spike found that might
  justify ADR 0062's build carrying a road-graph field. It is D-9 Q4, not part of this ADR.

### D-6 — It follows streets and offers turns. It plans no route

The graph holds which streets meet where and which way each leaves, for the ride to follow the
current street and offer the next turn. **It is never used to find a path to a destination, to
cost one, or to snap or store a drawn route.** "Ride to a destination" in an open-world ride (#2913)
waits for #2008 or #2009's snapping, as #2880 says. #2009's ruling of 2026-11-02 stands, unchanged,
for every routing use.

### D-7 — Licence and where the code lives

The graph builder lives under `packages/`, so it is **Apache-2.0** (`CLAUDE.md` §3) and takes no
GPL or AGPL dependency. Velopopuli (GPL-3.0) is prior art to read and never to copy, and spike 0040
did not open it. Valhalla is not a dependency. The road data is ODbL 1.0, as every other record
from the archive is (ADR 0062 D-4), and stays on the device as ADR 0054 D-3 and ADR 0090 (#2884,
in its pull request #2942) say.

### D-8 — The graph is built from untrusted input, and never reaches the trainer

- Tiles are untrusted input. The graph is built only from `@onyourleft/map-features`' bounded
  decoder (`limits.ts`), and the builder bounds its own nodes and edges per tile.
- No error, log line or toast from the builder names a coordinate, a tile id or a block id. It
  names the field and the constraint (ADR 0004 D).
- The graph module imports nothing that can reach the trainer. The grade comes from the road, and
  how a junction choice is made is #2887's ADR.

### D-9 — Questions for the owner, with the author's recommendation

1. **May an open-world ride follow footways, cycleways and paths?** *Recommend: not in the first
   version.* The spike measured streets only. A cycleway network would need its own junction
   measurement, and footways in town centres would add many junctions that a road bike would not
   take.
2. **Should service ways (driveways, parking aisles, alleys) be offered as turns?** *Recommend: no.*
   The tiles cannot tell a driveway from an alley. Leaving them out gives the spike's public-street
   figures (recall 98.7 to 100 %, at most one false junction per area). Leaving them in offers a
   turn at most driveways in a suburb (489 junctions against 184).
3. **Should a turn against a one-way street be refused?** *Recommend: yes*, as a cyclist on a real
   road would.
4. **Should our archive build add a roundabout flag (#2893), so that a roundabout's direction and
   exits are known?** *Recommend: not now.* Ride the first version (#2910) with roundabouts as
   rings of ordinary junctions, then decide with the tablet ride in hand. The cost is a US rebuild
   on the owner's Mac and an upload under ADR 0062 D-2.

## Consequences

- **#2892** decodes `oneway`, `access` and `is_link` from `roads` and nothing else new (D-2).
- **#2894** builds the graph geometrically under `packages/` (D-4, D-7), and its tests hold it to
  the spike's figures.
- **#2893** is not started unless D-9 Q4 is answered yes.
- **No new download and no change to the archive.** The graph comes from tiles the open-world ride
  is to stream (#2884).
- **What is given up:** roundabouts are not known as roundabouts, a driveway cannot be told from an
  alley, and the graph knows no turn restriction. None of these matters to following a street.
  Each would matter to routing, which #2009 keeps off this layer.

## What would make this ADR wrong

- **The tablet cannot build a block in time.** The spike's city centre took 34 ms warm on the
  desktop's main thread. If the tablet's figure (#2881's owed measurement, then #2910) does not fit
  in a worker, the source does not change, but D-4's builder must split work or be precomputed.
  Precomputing would be a build-time field, which is the second option.
- **Junction recall falls well below the spike's 98.7 % elsewhere**, in places it did not sample
  (#2910 measures a suburb, a town centre and a city centre on the tablet). Then D-1 has to be
  revisited with those numbers.
- **The owner wants roundabouts entered the right way round, or "the third exit"** (D-9 Q4). Then
  #2893 adds a roundabout flag under ADR 0062, and D-5's second point changes.
