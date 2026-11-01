# OpenStreetMap data and the ODbL: what this project owes, and what it does not trigger

On Your Left draws two things from OpenStreetMap data: the **ride map** (vector tiles from a
Protomaps basemap archive, [ADR 0010](adr/0010-map-tiles-and-routing.md) and
[ADR 0012](adr/0012-data-licence.md)), and, once [ADR 0054](adr/0054-towns-from-real-map-data.md) is built
([#1540](https://github.com/openzigs/onyourleft/issues/1540); until then the realistic world's
towns are procedural and the corridor is read but not yet drawn), the **towns in the realistic
world**, from the same archive. OpenStreetMap's data is published under
the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/) (ODbL). This page
records what that licence asks of the project, where each obligation is met, and which obligations
the project deliberately does not trigger, with the exact condition that would trigger them.

It is a summary. The decisions are ADR 0012 D-5, ADR 0032 D-5 and ADR 0054 D-3, and, for the demo
build, [ADR 0056](adr/0056-the-demos-shipped-map-under-odbl.md); where this page and an ADR
disagree, the ADR wins.

## What is held, where, and under what licence

- **Map tiles** are fetched from the configured archive and drawn. They are not kept as records.
- **The world corridor store** ([#1545](https://github.com/openzigs/onyourleft/issues/1545),
  ADR 0054 D-3). Per (owner, route), on the rider's device only, in its own IndexedDB object store in
  `packages/store` (`WorldCorridorRecord`): building footprints with `kind`, `height` and
  `min_height`, and, from #1789, the twelve building fields of ADR 0054's 2026-11-01 amendment
  (building type, levels, roof levels, roof shape, orientation and direction, wall and roof colour
  as palette indices, wall and roof material, start year and landmark flag, each `null` where the
  archive carries none); land-use and water polygons with `kind`; footway lines with `kind` and
  `kind_detail`; street lines with `kind`, `kind_detail` and whether each is a bridge or a tunnel
  (#1565, ADR 0054's 2026-10-22 amendment); place points with `kind`, `kind_detail` and
  `population_rank` (ADR 0055); and which tiles were read and when. No OSM identifier, no name and
  no address.
  Every record carries `licence: 'ODbL-1.0'`: the store is treated as a **Derivative Database** of
  OpenStreetMap (D-3.2). It is droppable without loss and is erased with its route and by the device
  erase (D-3.4).

## The attribution obligation (ODbL §4.3), and where it is met

A frame drawn from map data is treated as a **Produced Work** (ADR 0032 D-5, ADR 0054 D-3.6), and
§4.3 asks for a notice wherever it is shown. The rule:

- **The ride map** shows `© OpenStreetMap contributors` beside the map whenever a map is drawn
  (ADR 0012 D-5). The string is `apps/web/src/map/basemap.ts` §`OSM_ATTRIBUTION`, and every surface
  uses that constant, never a copy. Since #1975 the same line goes on to credit ESA WorldCover
  (CC BY 4.0, `§WORLDCOVER_ATTRIBUTION`), whose derived `landcover` layer the archive carries and
  the app does not draw; OpenStreetMap stays first.
- **The ride screen** shows the same line, small, in the HUD's actions panel, **for the whole ride**
  whenever the ride's world was given map data when it started (`GameView.tsx`, #1552). It is keyed
  on the corridor the ride started with, never on "the realistic world is chosen" and never on what
  is in frame: the notice is for the work. A ride drawn wholly from the procedural world (the
  stylised world, no archive, map tiles off, offline with nothing kept, outside coverage, a read
  still running at the press) shows **no** credit, because it owes none and saying otherwise is
  false.
- **The credits screen** (`apps/web/src/views/CreditsView.tsx`) has a *Map data* entry naming
  OpenStreetMap contributors, linking the ODbL 1.0, and carrying ODbL §4.3 a's own example sentence:
  *"Contains information from OpenStreetMap, which is made available here under the Open Database
  License (ODbL)."* Below it, the ESA WorldCover credit and a link to CC BY 4.0 (#1975).
- **An exported course** (`packages/fit/src/route/`) carries the attribution and the licence URL in
  the formats that have somewhere to put them.

## Why share-alike (ODbL §4.4) is not engaged

§4.4 attaches to a Derivative Database that is **Publicly Used**. The world corridor store is a
Derivative Database, and **nothing in it leaves the device** (ADR 0054 D-3.5): not in an activity
export, not in *export everything*, not in instance sync, not in a shared route, not in a ride
write-up's context. So it is never Publicly Used, there is no Derivative Database to offer, and §4.4
and §4.6 (offering the database or the changes) are not engaged. Two tests hold that line:
`apps/web/src/transfer/world-corridor-not-exported.test.ts` runs *export everything* over an account
that holds a corridor and fails on any trace of one in the files, and
`apps/web/src/privacy/world-corridor-never-sent.test.ts` fails if any module that talks to an
instance names the store (a source scan, which its own header says is not a proof).

⚠️ **This rests on one condition alone.** ADR 0012 D-2's other reason (*"there is no OSM-derived
database"*) is false for this store, so the only thing keeping §4.4 off is that the store is never
published. **The day any of the store's records leaves a device** (an instance cache of corridors,
a shared route carrying its corridor, a write-up given footprints, a sync of the store), §4.4 and
§4.6 come back, and that change is a **superseding ADR** that publishes the store under ODbL 1.0
and decides §4.6 a or b, never a code change or a review note.

## The demo's shipped bundle

[ADR 0056](adr/0056-the-demos-shipped-map-under-odbl.md), **Proposed** on 2026-10-24 on the owner's
rulings of that day on [#1643](https://github.com/openzigs/onyourleft/issues/1643). Nothing below is
built until the owner accepts it and the bake script
([#1651](https://github.com/openzigs/onyourleft/issues/1651)) lands; until then the demo rides the
synthetic road and draws no OpenStreetMap data.

- **What is in it.** Per preset route, one file in the demo's build output (`apps/web/demo/dist`,
  gitignored, never committed; a SHA-256 per route may be): the decoded corridor records the
  renderer reads (footprints, land use, water, footways, streets and place points, with the fields
  ADR 0054 D-3.3 lists and no OSM identifier, name or address; ADR 0056's 2026-11-01 amendment),
  the route's line and elevation from a GPX the owner supplies, stripped to latitude, longitude and
  elevation (ADR 0056 D-2, D-7), and the licence, source and notice. No owner, route id or device
  time.
- **Its licence.** It is a Derivative Database that is Publicly Used, so it is offered **under ODbL
  1.0** (§4.4 a.i). Shipping it in a build Publicly Conveys it, so the file carries the licence's
  URI and a notice file sits beside it (§4.2 b and d). The notice is ODbL §4.3 a's example:
  *"Contains information from OpenStreetMap, which is made available here under the Open Database
  License (ODbL)."*
- **Where it is offered (§4.6 a, the entire database).** As the plain file next to the demo, and as
  an asset on a GitHub release. A video made from it names the release asset's URL. A site that
  embeds the demo complies by serving the output unchanged (ADR 0056 D-4).
- **Where attribution is shown.** `© OpenStreetMap contributors` (`basemap.ts` §`OSM_ATTRIBUTION`)
  in the demo frame whenever bundle data is drawn, with the §4.3 notice reachable from the demo, and
  burned into every exported video frame drawn from it (ADR 0056 D-8).
- **CI never bakes OpenStreetMap data.** The demo's browser gate runs on a bundle baked from the
  synthetic corridor fixture, so no test artefact carries an ODbL obligation (ADR 0056 D-9).

⚠️ **The on-device store is unchanged.** ADR 0054 D-3.5 still binds `worldCorridors` whole: nothing
in it leaves the device, the bake never reads it, and the share-alike reasoning in the section above
still holds for it. The bundle is a separate database, made at build time from the archive, and it
is the only OpenStreetMap-derived database this project publishes.

## What does not change

The archive itself is distributed by Protomaps as *"an Open Database License Produced Work
(OpenStreetMap attribution required)"* (docs.protomaps.com/basemaps/downloads, read 2026-10-21), and
this project's own code stays under its own licences (`CLAUDE.md` §3): the ODbL governs the data,
not the program that reads it.
