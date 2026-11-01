# ADR 0062: We build our own basemap archive from OpenStreetMap

- **Status**: **Accepted, 2026-11-01**, on the owner's
  [ruling of that day](https://github.com/openzigs/onyourleft/pull/1991#issuecomment-6562146716) on
  pull request #1991: ADR 0010 D-1 (*"We do not generate … copy Protomaps' published build"*) is
  *"recorded as a **new superseding ADR 0062** ("we build our own basemap from OpenStreetMap on the
  owner's Mac"), not an amendment ("New ADR 0062")"*
- **Date**: 2026-11-01
- **Deciders**: **the owner**. The decisions below are the owner's rulings, and the author wrote them
  up: the ruling of 2026-10-31 on
  [#1557](https://github.com/openzigs/onyourleft/issues/1557#issuecomment-6544990824) (build on the
  owner's Mac, no paid build service, a separate name beside the live file, switch only after the
  owner's tablet check and word, any rise in R2 cost put to the owner first), the rulings of
  2026-10-31 on #1557 to upload the first build and to publish the WorldCover credit, and the ruling
  of 2026-11-01 on #1991 that this is a new ADR. Where a line goes beyond those rulings it says
  **author's reading**
- **Issue**: [#1557](https://github.com/openzigs/onyourleft/issues/1557) (build the project's own
  basemap archive with Planetiler), written in pull request
  [#1991](https://github.com/openzigs/onyourleft/pull/1991) for
  [#1788](https://github.com/openzigs/onyourleft/issues/1788)
- **Number**: **0062**. On 2026-11-01 `main` holds no `docs/adr/` file numbered 0062, no open pull
  request other than #1991 adds one, and no issue claims 0062. **0057 is claimed by
  [#1748](https://github.com/openzigs/onyourleft/issues/1748) and 0058 by
  [#1752](https://github.com/openzigs/onyourleft/issues/1752)**, both by their titles and both
  unwritten, and are left alone as ADR 0059 to ADR 0061 left them
- **Supersedes**: **one row of [ADR 0010](0010-map-tiles-and-routing.md) D-1 and nothing else**: the
  *Generation* row's decision *"**We do not generate.** Copy Protomaps' published daily build"*. ADR
  0013 D-3 sends a reversed decision to a superseding ADR, and this is that case. The same row's
  second half, *"If we ever generate: **planetiler** (Apache-2.0) with the `protomaps/basemaps`
  profile"*, is what D-1 below does, and stands. ADR 0010's body is not edited; a dated entry
  appended to its `## Amendments` section (ADR 0013) points here and does nothing else
- **Relates to**: [ADR 0010](0010-map-tiles-and-routing.md) D-1 (the rest of the table: OpenStreetMap
  under ODbL 1.0, the `protomaps/basemaps` schema, R2 behind Cloudflare's CDN, MapLibre), D-3 (an
  immutable archive under a versioned URL, refreshed quarterly) and D-6 (a self-hoster runs no tile
  pipeline); [ADR 0036](0036-a-self-hostable-instance-server-now.md) D-7 (no issue may take a paid
  service as a prerequisite); [ADR 0032](0032-external-data-for-the-game-world.md) (the
  WorldCover credit's text); [ADR 0054](0054-towns-from-real-map-data.md) (the world reads the
  configured archive, and its 2026-11-01 entry declares the building fields this build adds);
  [ADR 0056](0056-the-demos-shipped-map-under-odbl.md) (the demo bundle, baked from the same
  archive)

---

## Context

ADR 0010 D-1 chose, on 2026-09-03, not to generate a basemap: the project copies a pinned daily
build of Protomaps' published archive into its own bucket and serves it. That was right for a
project that needed only what that build carries.

On 2026-10-27 the owner's ruling D4 on [#1656](https://github.com/openzigs/onyourleft/issues/1656)
asked for building fields that Protomaps' build does not carry (levels, roof shape, colours,
materials and the rest that ADR 0054's 2026-11-01 entry lists). No published build carries them, so
the only way to have them is to build the archive.
[#1557](https://github.com/openzigs/onyourleft/issues/1557) wrote that build
(`apps/web/tools/basemap/`, merged in [#1974](https://github.com/openzigs/onyourleft/pull/1974)).
On 2026-10-31 the owner ruled that it is run on the owner's Mac and uploaded under a separate name, and the first build was uploaded beside
the Protomaps file that the client still reads. That build was not clipped to its extract and so
addressed far more tiles than the old file; `build.sh` now clips to the region's outline, and the
default archive moves only to a clipped rebuild.

So from the switch of `apps/web/src/map/basemap.ts` §`PUBLISHED_BASEMAP_URL` to the project's own
build, ADR 0010 D-1's *"We do not generate"* is a reversed decision, not an out-of-date
description. ADR 0013 D-3 does not allow an amendment for that, and the owner ruled on 2026-11-01
that it is recorded here.

## Decision

### D-1 — We build the basemap archive ourselves, from OpenStreetMap

1. **The archive the project publishes is built by this project** with
   `apps/web/tools/basemap/build.sh`: Planetiler and upstream's `protomaps/basemaps` profile at the
   commit the README pins, plus this project's `BuildingTags` patch
   (`profile/protomaps-basemaps.patch`), which adds the z15 building fields and changes nothing
   else. Every layer the ride map and the world read stays upstream's Protomaps v4 schema.
2. **The input is a dated Geofabrik extract of OpenStreetMap**, checked against Geofabrik's
   published MD5, and **the output is clipped to that region's Geofabrik `.poly` outline**
   (Planetiler's `--polygon`), so the archive addresses only tiles that meet the region. An unclipped
   build is never made the default.
3. **The build runs on the owner's Mac.** No paid build service is part of it.
4. **Every build writes a build record** with the SHA-256 of each input, the extract's name and
   date, the build year that bounds `start_year`, and the archive's size. A rebuild from the same
   record and the same inputs is the same archive, given the same JDK, which the README records
   but does not pin.

### D-2 — Publishing: a new dated name, beside the old file, and the old one kept

1. **Each build is uploaded under a new dated name** to the project's own R2 bucket, beside the
   archives already there. A PMTiles archive cannot be patched, so a refresh is a new file, as ADR
   0010 D-3 already says.
2. **An archive is never deleted or renamed while a build in use names it.** A build of the client
   carries its archive's URL, so a release still installed on a rider's device keeps its map.
   *Author's reading*: "in use" means any release that has not been withdrawn, not only the latest.
3. **Upload is a separate step from the build, and is the owner's.** `build.sh` uploads nothing.

### D-3 — The switch is the owner's word, after two checks

The default archive (`PUBLISHED_BASEMAP_URL`) moves to a new build only **on the owner's word**,
given after both of:

1. **a tablet check**: the owner rides or replays routes on the tablet with a build pointed at the
   new archive (`VITE_BASEMAP_PMTILES_URL`) and compares it with the current map; and
2. **a coverage check**: `pnpm --filter @onyourleft/web basemap:compare` between the new archive and
   the current one, whose `coverage` block (each archive's header bounds and addressed-tile count)
   shows the new archive covering the region the current one covers and not filling a box beyond
   it.

The change of the constant is its own pull request, and the old archive stays in place under D-2.2.

### D-4 — Licences and credits

1. **The tiles are an ODbL 1.0 Produced Work** of OpenStreetMap, as ADR 0010 D-1 says of Protomaps'
   build, and the app's "© OpenStreetMap contributors" attribution is unchanged. The archive's own
   attribution string is upstream's.
2. **The WorldCover credit is published** (the owner's ruling of 2026-10-31 on #1557): the archive
   carries upstream's `landcover` layer, derived from ESA WorldCover under CC BY 4.0, so the app
   gives the credit beside the ride map and on the credits screen
   (`apps/web/src/map/basemap.ts` §`WORLDCOVER_ATTRIBUTION`, ADR 0032's text).
3. **A `NOTICE.txt` sits beside the archives in the bucket**, giving each archive's data credits
   (OpenStreetMap under ODbL 1.0, and the WorldCover credit under CC BY 4.0), in words the owner
   approves.
4. **The build's own code is this project's**, `AGPL-3.0-or-later` under `apps/`. It is compiled
   into a jar that is never distributed; only the tiles are published. Every other input's licence
   is recorded in `apps/web/tools/basemap/README.md`.

### D-5 — No paid service

Building on the owner's Mac adds no service. Storage and serving are the R2 bucket and CDN the
project already uses for the Protomaps copy (ADR 0010 D-1, D-2), so **the cost is the existing
hosting**, plus each archive D-2.2 keeps beside the current one. ADR 0010 D-3 priced double storage
for about a week of a refresh; D-2.2 makes it a standing cost for as long as a release in use names
the older archive (about $0.27 a month for a US archive at `docs/cost-model.md`'s rate). This
keeps ADR 0036 D-7: no issue takes a paid service as a prerequisite.
**Any rise in the R2 bill is put to the owner first** (the ruling of 2026-10-31 on #1557).

### D-6 — What does not change

ADR 0010 D-1's other rows, D-2, D-3 (immutable, versioned, refreshed quarterly) and D-6 stand. A
self-hoster still runs no tile pipeline: they may point at the project's published archive, cut a
regional extract of it, or point at any Protomaps v4 archive, including Protomaps' own build, and
the client reads each the same way. Read from an archive this profile did not build, every building
field ADR 0054's 2026-11-01 entry declares is `null`.

## Consequences

- **The archive can carry what the world needs**, starting with the building fields #1656 asked for,
  without waiting on a third party's schema.
- **The project owns the refresh.** A quarterly rebuild is hours on the owner's Mac and an upload of
  the whole file; nothing refreshes by itself. If the owner's Mac cannot build it, the map stays on
  the last archive, which still works.
- **A build that goes wrong is caught before riders see it**, by D-3's two checks, and undone by
  moving the constant back, because the old file is still there (D-2.2).
- **The bucket grows by one archive per refresh** while older releases name older files. Removing an
  archive no build names is a decision for the owner, not a clean-up.
- **This ADR builds nothing.** It records a decision whose tooling #1557 already merged; the switch
  of `PUBLISHED_BASEMAP_URL` is a separate pull request.

## What would make this ADR wrong

- **A published build starts carrying the building fields.** If Protomaps' own archive (or another
  Protomaps v4 build) carries what ADR 0054's 2026-11-01 entry declares, copying it is again the
  cheaper choice, and this ADR should be superseded back.
- **The owner's Mac can no longer run the build** (the US build needs hours and a large heap). Then
  the build moves somewhere else, and D-1.3 and D-5 must be decided again, with no paid service.
- **The R2 bill rises past what the owner accepts** because D-2.2 keeps too many archives. Then
  D-2.2's reading of "in use" has to change, which is a decision for the owner.
