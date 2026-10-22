# OpenStreetMap data and the ODbL: what this project owes, and what it does not trigger

On Your Left draws two things from OpenStreetMap data: the **ride map** (vector tiles from a
Protomaps basemap archive, [ADR 0010](adr/0010-map-tiles-and-routing.md) and
[ADR 0012](adr/0012-data-licence.md)), and, since [ADR 0054](adr/0054-towns-from-real-map-data.md),
the **towns in the realistic world**, from the same archive. OpenStreetMap's data is published under
the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/) (ODbL). This page
records what that licence asks of the project, where each obligation is met, and which obligations
the project deliberately does not trigger, with the exact condition that would trigger them.

It is a summary. The decisions are ADR 0012 D-5, ADR 0032 D-5 and ADR 0054 D-3; where this page and
an ADR disagree, the ADR wins.

## What is held, where, and under what licence

- **Map tiles** are fetched from the configured archive and drawn. They are not kept as records.
- **The world corridor store** ([#1545](https://github.com/openzigs/onyourleft/issues/1545),
  ADR 0054 D-3). Per (owner, route), on the rider's device only, in its own IndexedDB object store in
  `packages/store` (`WorldCorridorRecord`): building footprints with `kind`, `height` and
  `min_height`; land-use and water polygons with `kind`; footway lines with `kind` and
  `kind_detail`; and which tiles were read and when. No OSM identifier, no name and no address.
  Every record carries `licence: 'ODbL-1.0'`: the store is treated as a **Derivative Database** of
  OpenStreetMap (D-3.2). It is droppable without loss and is erased with its route and by the device
  erase (D-3.4).

## The attribution obligation (ODbL §4.3), and where it is met

A frame drawn from map data is treated as a **Produced Work** (ADR 0032 D-5, ADR 0054 D-3.6), and
§4.3 asks for a notice wherever it is shown. The rule:

- **The ride map** shows `© OpenStreetMap contributors` beside the map whenever a map is drawn
  (ADR 0012 D-5). The string is `apps/web/src/map/basemap.ts` §`OSM_ATTRIBUTION`, and every surface
  uses that constant, never a copy.
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
  License (ODbL)."*
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

## What does not change

The archive itself is distributed by Protomaps as *"an Open Database License Produced Work
(OpenStreetMap attribution required)"* (docs.protomaps.com/basemaps/downloads, read 2026-10-21), and
this project's own code stays under its own licences (`CLAUDE.md` §3): the ODbL governs the data,
not the program that reads it.
