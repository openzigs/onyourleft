# ADR 0054: Towns from real map data — the route's corridor read once from our own basemap archive, held in an ODbL store, and the procedural world kept whole

- **Status**: Accepted, 2026-10-21, by the owner, on the answers to D-8 recorded on
  [#1538](https://github.com/openzigs/onyourleft/issues/1538) that day. Phase B's other issues
  ([#1539](https://github.com/openzigs/onyourleft/issues/1539),
  [#1540](https://github.com/openzigs/onyourleft/issues/1540)) are checked against it
- **Date**: 2026-10-21
- **Deciders**: **the owner**, on the ruling of 2026-10-21 quoted in Context and on the answers D-8
  asks for. Drafted by the author for that approval
- **Issue**: [#1538](https://github.com/openzigs/onyourleft/issues/1538), phase B of the epic
  [#1533](https://github.com/openzigs/onyourleft/issues/1533)
- **Number**: **0054**, the next free number in
  [`docs/agents/conventions.md`](../agents/conventions.md) §7 on 2026-10-21, checked against the
  ownership table in [`docs/architecture.md`](../architecture.md); no open issue or pull request named
  it
- **Supersedes**: [ADR 0032](0032-external-data-for-the-game-world.md) **D-1, in part** — for one
  source (D-2) and three kinds of record (land use, building footprints, footways), and nothing else.
  D-1 below says exactly which sentences of ADR 0032 stop holding and which still do. It is also
  **the successor to [ADR 0012](0012-data-licence.md) that ADR 0012 D-3.2 and ADR 0032 D-5 require**
  before an OSM-derived record is held (D-3 here). ADR 0012 itself is not superseded: its segment
  rules are untouched
- **Relates to**: [ADR 0002](0002-local-first-architecture.md) decision A,
  [ADR 0004](0004-privacy-and-location.md) B, C and D, [ADR 0010](0010-map-tiles-and-routing.md) D-1
  and D-7, [ADR 0024](0024-offline-and-caching-posture.md) D-2,
  [ADR 0026](0026-realistic-game-world.md) D-7, [ADR 0036](0036-a-self-hostable-instance-server-now.md)
  D-3, [ADR 0049](0049-open-asset-sources-for-the-realistic-world.md) (the materials a footprint is
  dressed in), [#1523](https://github.com/openzigs/onyourleft/issues/1523) (the GPU ceiling every
  structure count waits on)

---

## Context

### The ruling this records

The owner, 2026-10-21, on #1533: *"Can we research adding more scenery. Possibly some areas with city
buildings, sidewalks in areas. Possible people running or walking … We also need them to be generated
realistically. Can't have a building sitting out in the forest. Right now the landscape can be
repetitive and sparse."* And on the research that followed: **towns come from real map data**, and
phase B's first issue drafts an ADR that supersedes ADR 0032 D-1, for the owner's approval. This is
that draft.

### Why today's world cannot do what was asked

`apps/web/src/game/settlements.ts` places villages and farmsteads from **the route and a seed only**:
*"no map, no place data, no names."* A site is built if the ground there is level, low and dry. Nothing
in the program knows whether that ground is a forest, a park or a town, so the procedural world cannot
keep a building out of a forest — it can only make one less likely. ADR 0032 D-1 is why: the game
world takes no external data, and its table rejects OpenStreetMap by name.

### What has changed since ADR 0032 was written

ADR 0032 rejected a world fetch on three counts that were not about licence: **there was nowhere to
read it from**, **a request would be made continuously while somebody rides**, and **a world that
needs a network is not there on a turbo in a garage**. Two of the three have moved, and this ADR is
built around the third.

1. **The archive stands, on the project's own host.** ADR 0032's 2026-09-26 amendment records that
   `https://tiles.openzigs.com/basemap-us-20260914.pmtiles` is published (#53) and that every build
   already contacts that host whenever a ride's map is shown (`apps/web/src/map/basemap.ts`
   §`PUBLISHED_BASEMAP_URL`). It is the **Protomaps Basemap v4.15.2** schema, z0–15, US coverage, and
   it holds the records this needs:

   | Layer | Fields read here | Zooms |
   |---|---|---|
   | `buildings` | `kind`, `height`, `min_height` | individual buildings at **z15**; merged below |
   | `landuse` | `kind` (`residential`, `commercial`, `industrial`, `forest`, `wood`, `park`, …) | all |
   | `roads` | `kind`, `kind_detail` (`sidewalk`, `pedestrian`, `path`, …) | all |
   | `water` | presence only | all |

   It has no `building:levels` and no `roof:shape`.
2. **A read need not be continuous.** A route is known before the ride starts. Read once, for the
   route's corridor, when the route is loaded, and the ride itself asks nothing of anybody — the shape
   ADR 0032 D-3 drew for the **route's** elevation (*"once, at planning or import … stored with the
   route"*), now proposed for the world beside it.
3. **Offline is unchanged, and has to stay so.** ADR 0036 D-3(a): no feature that works with no
   network today may start to need one. The procedural world works today. D-4 keeps it, whole.

### What was read, and when

Read on **2026-10-21** with a fetch tool that returns a summary of the page, so the quoted fragments
below are as that tool reported them; a reader relying on a fragment for more than its sense re-reads
the page.

| What | Where | Finding |
|---|---|---|
| The archive's data terms | `https://docs.protomaps.com/basemaps/downloads` | *"distributed as an Open Database License Produced Work (OpenStreetMap attribution required)"* — the same sentence ADR 0010 quotes from 2026-09-03 |
| The layers and their fields | `https://docs.protomaps.com/basemaps/layers` | `buildings`: `kind`, `addr_housenumber`, `height`, `min_height`, `layer`; *"z0-14 contains merged buildings … z15+ contains individual OSM"* buildings. `landuse`: `kind`. `roads`: `kind`, `kind_detail` including `sidewalk` |
| Where a game's OSM credit may go | `https://osmfoundation.org/wiki/Licence/Attribution_Guidelines`, last edited 10 September 2026 | For games, attribution can appear *"on a splash screen on application startup, in the game view, during gameplay, on the credits page, in the menu, or in another suitable location"*; the text credits "OpenStreetMap", for example *"© OpenStreetMap contributors"* |

---

## Decision

### D-1 — What of ADR 0032 D-1 this supersedes, and what still holds

ADR 0032 D-1 made three checkable statements. This ADR changes the third and leaves the first true (`game/` still makes no request; the one
module outside it does); the
second, and every other ruling in that ADR, stands.

| ADR 0032 D-1 | After this ADR |
|---|---|
| **1.** No runtime request is made by anything under `apps/web/src/game/` | **Still true.** `game/` stays pure and names no network primitive. The read is made by **one module outside `game/`** (D-2), and `game/` reads its result from the store |
| **2.** No dataset derived from an external source is committed | **Still true.** Nothing is committed: the records arrive per route, on the rider's device |
| **3.** No structured record from an external source is persisted | **Superseded** for the records D-2 lists, held only in the store D-3 defines |
| The table's **OpenStreetMap** row, *"Rejected"* | **Admitted**, through the project's own Protomaps archive only, for the records D-2 lists |
| Every other row: Copernicus GLO-30, ESA WorldCover, Mapterhorn, SRTM/NASADEM/3DEP, OpenMapTiles, street-level imagery | **Unchanged.** Still rejected, for ADR 0032's reasons |
| D-3: the route's elevation is not the world's | **Unchanged.** The hillside beside the road is still invented; this ADR reads no elevation |

ADR 0032 D-4 is the checklist a fetch owes. Its answers are D-2 (items 1–3), D-6 (items 4 and 5), and
D-4 here (item 6 and the seventh, offline).

### D-2 — The source: the configured basemap archive, read once per route, for its corridor only

1. **One origin, the one the map already uses.** The archive is the URL `apps/web/src/map/basemap.ts`
   resolves — `PUBLISHED_BASEMAP_URL` by default, or the build's `VITE_BASEMAP_PMTILES_URL`, so a
   self-hoster who points the map at an archive of their own points the world there too. No other
   host is ever contacted for the world. This is ADR 0032 D-4 item 1.
2. **Four layers, the fields in Context's table, and nothing else.** `pois` and `places` are **not
   read**: they carry names, and the world names no place (`settlements.ts`: a signpost *"carries no
   words"*). From `buildings`, `addr_housenumber` is **dropped on read** — an address is not scenery.
   No OSM identifier is kept. `water` is read although #1538 did not list it, because D-5's own rule
   (never on water) cannot be applied without it.
3. **The corridor only.** The z15 tiles within a fixed distance of the route's line — at most
   **300 m** either side, which is beyond anything the world places a structure at today; #1539 sets
   the number to what the renderer draws and states its tile and byte cost. A cap on tiles per route
   is #1539's, with its measurement.
4. **When a route is chosen or saved, never during a ride.** The read runs when the rider chooses a
   route to ride, before the ride starts, and when the rider saves a route, and its result is kept
   (D-3), so a second ride of the same route asks nothing. A save never waits on the read and never
   fails because of it: the route is saved first, and a read that fails leaves the route saved and
   the world procedural. **No request for the world is made while a ride is recording.** A read still running
   when the ride starts is abandoned, and that ride is drawn from whatever was already kept. This is
   the answer to ADR 0032 D-1's second count: the disclosure is one corridor, once, and not a sequence
   of positions for an hour.
5. **One module, seen by the gate.** The read is made by one module outside `game/`, which issues
   its archive range requests with its own single `fetch`. It does **not** hand the job to the
   `pmtiles` package's built-in fetching source, because a `fetch` inside a dependency is invisible
   to `apps/web/src/privacy/no-network.test.ts`. That module gains one `PERMITTED_NETWORK_CALLS`
   entry, `primitive: 'fetch', count: 1`. It is not instance traffic, so ADR 0036 D-3(a)'s *"exactly
   one module for instance traffic"* is not touched. ADR 0032 D-4 items 2 and 3 — a static assertion
   that the module's configuration names no other origin, and a browser-gate assertion that no other
   host is contacted — are owed by #1539, both of them.

### D-3 — The ODbL store: the successor to ADR 0012 that ADR 0032 D-5 requires

ADR 0012 D-3 lets OSM-derived records be held on four conditions and says the store is declared ODbL
in a successor ADR. This is that declaration.

1. **Its own object store**, in `packages/store`, never fields on `RouteRecord` or on any other
   record. One entry per **(owner, route)**, read only through a call that takes the owner, so the
   store joins `packages/store/src/activity-store.scoping.test.ts`'s derived enumeration like every
   other owner-scoped read (`CLAUDE.md` §6, cross-athlete exposure).
2. **Declared ODbL 1.0.** The store's contents are treated as a **Derivative Database** of
   OpenStreetMap. Protomaps calls its archive a Produced Work, and a drawn tile is one; but footprints,
   heights, land-use classes and footway lines read back out of a vector tile into records are
   records, and this ADR does not lean on the archive's label to say otherwise. If the store is ever
   Publicly Used, it is under ODbL 1.0 (§4.4 a.i) — share-alike for the derived database — and the
   ADR that makes it public decides ODbL §4.6 a or b then, as ADR 0012 D-4 requires.
3. **What is in it, in one sentence** (ADR 0012 D-3.4): per route, building footprint polygons with
   `kind`, `height` and `min_height`; land-use polygons with `kind`; water polygons; footway lines
   with `kind` and `kind_detail`; and which tiles were read and when — no OSM identifier, no name, no
   address.
4. **Droppable without loss.** Nothing of the rider's is in it and nothing of the rider's points into
   it. Deleting it costs the rider a re-read, or the procedural world (D-4), and never a ride, a route
   or a setting. It is erased with its route and by the device erase.
5. **Nothing in it leaves the device.** Not in an activity export, not in *export everything*, not in
   instance sync, not in a shared route, not in a ride write-up's context. So nothing in it is
   Publicly Used and §4.4 is not engaged. ⚠️ **ADR 0012 D-2's reason 1 — *"there is no OSM-derived
   database"* — is false for this store**, so the line that holds it is reason 2 alone: it is never
   published. That makes this item load-bearing. **A change that sends any of this store's contents
   anywhere is a change to this ADR**, not a review note.

   ⚠️ **This overrides a warning, openly.** ADR 0012 D-2 says *"do not cite reason 2 without reason
   1"*, because reason 2 (nothing is published) expires once a server exists, and ADR 0032 D-5
   repeats it. There is now an instance server (ADR 0036), instance sync, and AI write-ups that run
   on it (ADR 0046). This ADR cites reason 2 alone anyway, for this store only, because the
   alternative is to publish an OSM-derived database under ODbL, which D-8 does not ask for. A
   documented ban is not a gate (CLAUDE.md §8), so **#1539 owes a test that fails if this store
   reaches any export, export-everything, instance-sync or write-up payload**: it builds each
   payload from a route whose store is populated and asserts that no byte of the store's records
   (footprint, land-use, water or footway) is in it, and it is derived from the payload builders so
   that a new one is a red test until it is listed.
6. **Attribution in the frame.** A frame drawn from these records is treated as a Produced Work (ODbL §4.3,
   ADR 0032 D-5) — with ADR 0032 D-5's caveat carried forward: the OSM Produced Work guideline does
   not say that a 3D scene is one, so this ADR does not rest on it (D-3.1 treats the store as a
   Derivative Database regardless), and the credit is given as a courtesy that costs nothing — and attribution is owed wherever it is shown. While any part of the drawn world came
   from the store, the game view shows **"© OpenStreetMap contributors"**; the credits screen
   (`apps/web/src/credits/`) gains the same line. In the game view it is a small line in a corner, clear
   of the HUD, for the whole ride (D-8 Q3). A ride drawn wholly from the procedural world shows no credit, because it owes none.

### D-4 — No data: today's procedural world, unchanged

ADR 0036 D-3(a) and ADR 0002 decision A, and ADR 0032 D-4's sixth and seventh items.

1. **When there is nothing to read, the world is today's world.** Outside the archive's coverage
   (everywhere outside the US), offline, with map tiles switched off (D-6.4), when the read failed or
   had not finished, and inside a privacy zone (D-6.3), `settlements.ts` builds exactly what it builds
   today from the same route and seed. #1540 holds this with a test: an empty store gives a world
   equal, item for item, to the world the procedural placer gives with no store at all.
2. **Per stretch, not per route.** Map data where it was read, the procedural world where it was not,
   decided per settlement site, so a route that leaves the US, or passes a privacy zone, is mixed
   rather than refused.
3. **No error, no prompt.** The absence of map data is a normal state and the rider is not told about
   it as a failure. The OSM credit's presence (D-3.6) is the only visible difference.
4. **A self-hoster with no cloud account** (ADR 0002 A) gets the procedural world, or the map-data
   world from an archive they host themselves through `VITE_BASEMAP_PMTILES_URL`. Written down here,
   as ADR 0032 D-4.6 requires.
5. **Nothing that rides today needs the network after this ADR**, and the ride never waits for the
   read.

### D-5 — Placement: a building stands only where the map says people built

These are rules for #1540 and #1541 to hold with tests; the numbers in them are those issues'.

1. **A building needs a footprint, or built-up land behind it.** Either it is a footprint from
   `buildings` (`kind` `building` or `building_part`), drawn on that footprint at that footprint's
   height; or it is a **procedural lot** inside built-up land use — `residential`, `commercial` or
   `industrial` at least, with any other kind added only by naming it in the code beside this rule.
2. **Never on forest, wood, water or park.** A footprint or lot that overlaps any of them is not
   built, whatever else is true. Footprints in OSM inside a park (a pavilion, a toilet block) are the
   one exception worth a line in the code, and #1540 decides whether to keep them.
3. **Where map data was read, the procedural placer does not also place a village there.** A stretch
   with data and no footprint and no built-up land is countryside, and stays countryside. This is the
   rule that keeps a procedural village out of a real forest.
4. **The road wins.** The route is the rider's own line and OSM's road may sit metres from it, so
   every footprint and lot keeps `settlements.ts` §`structureClearance` from every segment of the
   whole route, exactly as a procedural building does today, and is dropped otherwise. The level and
   dry rules stay for procedural lots.
5. **Footways from `kind_detail`.** `roads` features with `kind_detail` `sidewalk` (and the footway
   and pedestrian kinds #1540 lists) are drawn as the kerbed pavement #1535 builds, along their own
   line, and they are where #1541's pedestrians walk. Where there is no data, #1535's procedural
   pavements stand.
6. **The structure cap does not rise with this ADR.** `realistic-budget.ts`
   §`REALISTIC_STRUCTURE_ITEMS` is **36** today and a real town has hundreds of footprints, so the
   nearest come first, within the cap. The cap rises only **after #1523's fix is on main** and only to
   a number measured with Part AH on the tablet against #1523's after-row, recorded in
   `realistic-budget.ts` with that measurement — never a number chosen in this ADR. The stylised
   world's cap is unchanged.
7. **Nothing names a place.** No street name, house number, shop name or brand reaches the world, and
   a signpost still carries no words.

### D-6 — Privacy: the corridor read sends nothing a map read does not, and stops short of a zone

1. **What the request carries.** Byte-range requests for one archive file, to the origin of D-2.1,
   with no coordinate, no route id, no athlete id and no credential in the URL, a header or a body.
   ⚠️ **The ranges are a function of location**: the host can work out which tiles were read, as it
   can from any map tile request today, and with them the route's corridor at z15 tile size — about 0.8 km across at 49 N and about 1.1 km at 25 N (a z15 tile, 0.64–1.23 km² over the archive's 24–50 N, as `apps/mobile/src/android/data-safety.ts` has it). Stated plainly rather than minimised: that is a more exact outline of
   one route than a map view at a lower zoom, sent once per route, to the same host and with the same
   IP address a map view already sends. ADR 0010 D-7's question — who observes it — has the answer it
   has for the map: the project's own archive host and its CDN, or the self-hoster's own.
2. **A `departing` entry** in `apps/web/src/privacy/boundaries.ts` for that request, owed by #1539,
   and which says in its own words that a tile range is a coarse location. ADR 0032 D-4 item 4's
   *"no coordinate pair departs"* test cannot fire here, because the location travels as byte offsets
   in a `Range` header and not as a pair; the control that protects the rider is D-6.3, so #1539
   also owes tests that map each requested range back to its tile and check it against the
   athlete's privacy zones, and that with tiles off nothing is requested.
3. **A privacy zone stays trimmed.** No tile that touches one of the athlete's privacy zones (ADR 0004
   B, at the zone's own radius) is requested, and the world there is procedural (D-4.2). The read
   never asks for the tiles touching a rider's zone, which is stricter than the map view, and
   deliberately so. ⚠️ **The gap is visible**: a corridor with the zone's tiles left out shows the
   host a hole, and the hole bounds where the zone is. The rule is still right, since asking for the
   tiles would be worse, but it hides the tiles and not the fact that something is hidden.
4. **The map-tiles switch governs it.** With map tiles off (`apps/web/src/map/tiles-preference.ts`),
   nothing is asked of the tile host, for the map or for the world. One switch, because a rider who
   turned tiles off asked for exactly that. D-8 Q4.
5. **Disclosure and the Play answer move with this, in the same pull request as the read** (the
   precedent is #387, which changed the policy and `data-safety.ts` with `no-network.test.ts`).
   (a) `docs/privacy-policy.md` says tiles are requested *"when a map is on screen"* and *"to draw a
   ride that has a GPS track"*; the world read breaks both, so #1539 rewrites those sentences and
   the retained-record description. (b) `apps/mobile/src/android/data-safety.ts` answers Approximate
   location on two facts: the tile host's retained record holds **no `Range` field**, and **every
   request names one file**. The read must keep both: it is a range request on that one file and
   **never a `z/x/y` URL**, and #1539 re-checks the retained record. (c) The tiles switch is
   labelled *"Draw map tiles under my rides"* (`SettingsView.tsx`), which D-6.4 makes inaccurate,
   so the label and the policy's description of it change with the read. (d) A planet archive
   (D-8 Q1) would change (b)'s area reasoning, which is written for the 24–50 N archive.
6. **The store is location data.** It outlines where a route goes. ADR 0004 D applies to it and to the
   read: an error or log line names the field and the constraint and never a coordinate or a tile's
   `z/x/y`, which is a coordinate at tile precision.

### D-7 — Height alone, and what is not read

The archive carries `height` and `min_height` and no `building:levels` or `roof:shape`. The proposal,
for D-8 Q2: a footprint is drawn at its `height` (above `min_height`); where `height` is missing, a
height is chosen by `kind` and footprint area and hashed per footprint so it is the same on lap two;
storeys are `height` divided by a fixed storey height, which places the windows; the roof is chosen by
footprint area and height (flat for large or tall, pitched for small), hashed. Reading
`building:levels` or `roof:shape` would need an archive built by this project rather than copied from
Protomaps (ADR 0010 D-1, *"We do not generate"*), which is a separate decision.

### D-8 — What the owner is asked to rule on

> **Answered by the owner, 2026-10-21, on [#1538](https://github.com/openzigs/onyourleft/issues/1538).**
> Q0: accepted before merge. Q1: (i), today's procedural world outside the US; a planet archive
> stays open as [#1554](https://github.com/openzigs/onyourleft/issues/1554). Q2: yes, `height` alone
> with D-7's rules for now; an archive of the project's own that keeps `building:levels` and
> `roof:shape` is [#1557](https://github.com/openzigs/onyourleft/issues/1557), later. Q3: the
> recommended corner line plus the credits screen. Q4, Q5 and Q6: yes. The owner also ruled that the
> read runs when a route is saved as well as when it is chosen (D-2.4). The questions are kept below
> as they were asked.

1. **Q0 — Accept this ADR before it merges, or merge it as Proposed?** Recommended: **accept before
   merge**, and the pull request flips the Status line. A Status line cannot be changed by an
   amendment afterwards (ADR 0013), which is why ADR 0044's acceptance needed ADR 0052 D-5.
2. **Q1 — What riders outside the US get, and what it would cost.** Options: (i) **today's
   procedural world, unchanged** (D-4): free, no change. (ii) **A Protomaps planet build** on the
   project's own host: `docs/cost-model.md` measures it at 138 GB (build `20260915`), about
   **2.07 USD a month** for R2 storage, plus its tile-request line; ADR 0010's ~120 GB is stale.
   No paid service is a prerequisite (ADR 0036 D-7), because a self-hoster can serve the same
   archive from their own disk. (iii) **OSM extracts** of chosen regions, built by this project:
   free to host at a fraction of (ii)'s size, but the build is ours to run (ADR 0010 D-1, *"we do
   not generate"*), so it needs its own decision. Coverage outside the US by (ii) or (iii) is not
   free of an owner decision, since it changes `docs/cost-model.md` and the Play Data Safety
   answer in D-6.5(d). Recommended: **(i) in this ADR**, with (ii) raised as the unavoidable-cost
   question for the owner: about 2 USD a month more, and a re-reading of Approximate location.
3. **Q2 — Is `height` alone enough?** Recommended: **yes**, with D-7's rules for storeys and roofs.
4. **Q3 — Where the OSM credit sits in the game view.** Recommended: **a small line in a corner of
   the game view, clear of the HUD, for the whole ride**, plus the credits screen. The guideline
   permits the credits page alone for a game; a corner line is the reading that holds for a rider who
   never opens the credits.
5. **Q4 — Does the map-tiles switch govern the world read too?** Recommended: **yes**, one switch
   (D-6.4).
6. **Q5 — A privacy zone stops the read** at any tile touching the zone (D-6.3). Recommended: **yes**.
7. **Q6 — No read while a ride records** (D-2.4), so a route is read only when chosen and before the
   ride starts. Recommended: **yes**; the cost is that the first ride of a newly chosen route started
   at once may be procedural.

---

## Consequences

### What this enables

- **Towns where towns are.** A US route through a town draws that town's buildings at their own
  heights and their own pavements, and a stretch through a forest draws no house.
- **Phase B can start**: #1539 (the corridor read and the store) and #1540
  (buildings from footprints and lots) have a document to be checked against.
- **Phase D's land classes** (#1542) have a source where data exists.

### What this costs

- **A new request, and a sharper outline of one route to the tile host**, once per route (D-6.1).
- **An ODbL store whose only protection from share-alike is that it never leaves the device**
  (D-3.5). Every future sync, share or export feature has to keep it out, and has to know to.
- **An attribution obligation in the frame** (D-3.6).
- **Two worlds to keep working**: the procedural world is no longer the only path, and D-4's
  equality test is what stops it rotting.
- **US only.** A rider anywhere else sees no change, which is honest and is D-8 Q1.
- **More code paths to test**: a module with a network primitive, a store, a scoping entry, a
  boundary entry and two gate assertions, before one building is drawn.

### Constraints this places on other work

| Issue | Constraint |
|---|---|
| [#1539](https://github.com/openzigs/onyourleft/issues/1539) | D-2 and D-3 in full, including D-3.5's payload test; D-6.2–D-6.6, including the range-to-zone and tiles-off tests, `docs/privacy-policy.md`, `data-safety.ts` and the switch label (D-6.5); the `PERMITTED_NETWORK_CALLS` entry, the static origin assertion and the browser-gate host assertion; the scoping-test entry; states its tile, byte and time cost |
| [#1540](https://github.com/openzigs/onyourleft/issues/1540) | D-4.1's equality test; D-5.1–D-5.4, D-5.6 and D-5.7; D-7 as the owner rules it; draw calls, triangles and texture memory measured with Part AH |
| [#1535](https://github.com/openzigs/onyourleft/issues/1535), [#1541](https://github.com/openzigs/onyourleft/issues/1541) | D-5.5: footways from data where read, procedural pavements otherwise |
| [#1542](https://github.com/openzigs/onyourleft/issues/1542) | Land use only through D-3's store and D-2's read; nothing of its own |
| Any sync, share or export feature | D-3.5: the store's contents never leave the device without a change to this ADR |
| ADR 0032 and ADR 0012 | Each gains one appended entry under ADR 0013 pointing here, in the pull request that accepted this ADR |

---

## What would make this ADR wrong

- **The store starts to leave the device.** Instance sync of routes is the likely road. Then
  ODbL §4.4 is live and this ADR is superseded by one that publishes the store under ODbL and decides
  §4.6.
- **The archive moves to a schema without `height`, `kind_detail` or z15 buildings**, or its terms
  change. D-2 names v4.15.2's fields; a new archive is checked against them before it is configured.
- **The tablet cannot carry a town.** If Part AH shows that even the nearest 36 footprints, dressed,
  put the realistic rung back on #1523's ceiling, D-5.6 holds the cap and phase B draws fewer, plainer
  buildings — the budget wins over this ADR.
- **OSM building coverage on a route is thin.** D-5.3 then draws a real stretch as countryside where
  a town stands unmapped. That is the price of *"can't have a building sitting out in the forest"*,
  and it is the rule the owner asked for.

## Amendments

Appended under [ADR 0013](0013-adr-amendments.md). Nothing above this line has been edited.

- **2026-10-22** — **Street lines are a fourth kind of record in `worldCorridors`.** The Context says
  *"three kinds of record (land use, building footprints, footways), and nothing else"* and D-3.3
  lists footway lines only. #1565 (cross streets at their mapped junctions) asked, at the owner's
  request, for the mapped streets themselves, so the store now also holds **street lines with `kind` and
  `kind_detail`** (the decoder's `StreetFeature`: motorway to service road, no OSM identifier, no
  name). D-3.3's sentence reads, from this date: building footprint polygons with `kind`, `height` and
  `min_height`; land-use polygons with `kind`; water polygons; footway lines with `kind` and
  `kind_detail`; street lines with `kind` and `kind_detail`; and which tiles were read and when. What
  still stands, unchanged: D-3.1 to D-3.6, including that the store never leaves the device (D-3.5), is
  ODbL 1.0 data and is droppable without loss. The street lines are bounded at read time by the
  decoder and at use by `STREET_MAX_METRES`.
