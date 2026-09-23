# ADR 0032: The trainer game's world takes no external data source — every candidate ruled on, first-hand

- **Status**: Accepted
- **Date**: 2026-09-22
- **Deciders**: the author. ⚠️ **No owner decision was sought or given**, and none is needed: every
  candidate below is refused on a rule the owner has **already** decided —
  [ADR 0002](0002-local-first-architecture.md) decision **A** (a self-hoster must not be required to
  hold a cloud account), [ADR 0010](0010-map-tiles-and-routing.md) **D-7** (a request discloses where
  the athlete is), `CLAUDE.md` §3 (a licence question is answered before the code is written) — or on
  a licence that fails closed. ⚠️ **If a future owner wants one of these anyway, that is a decision
  and this ADR is superseded, not amended**; D-4 is the list of what such a change would owe
- **Issue**: [#248](https://github.com/openzigs/onyourleft/issues/248), under epic
  [#240](https://github.com/openzigs/onyourleft/issues/240). Also discharges
  [#376](https://github.com/openzigs/onyourleft/issues/376) (epic
  [#374](https://github.com/openzigs/onyourleft/issues/374)), which asked for the imagery ruling to
  land **in this document rather than in a second ADR**
- **Number**: **0032**. [`docs/architecture.md`](../architecture.md)'s reservation table is the check
  `CLAUDE.md` §7 asks for. ⚠️ **It is not the next free number and that is deliberate**: 0029, 0030
  and 0031 were claimed by work in flight on the same day
  ([#378](https://github.com/openzigs/onyourleft/issues/378)–[#381](https://github.com/openzigs/onyourleft/issues/381)),
  and a written ADR cannot be renumbered without breaking citations, so taking the next free number
  in two places at once would have collided. 0021 is [ADR 0021](0021-racing-another-riders-ghost.md),
  written in this same pull request
- **Supersedes**: nothing. ⚠️ In particular it does **not** supersede or amend
  [ADR 0010](0010-map-tiles-and-routing.md) or [ADR 0012](0012-data-licence.md) — it answers a
  question neither of them asked, and **D-3 is the boundary** between this document's subject and
  ADR 0010 D-5's
- **Relates to**: [ADR 0002](0002-local-first-architecture.md) decision A,
  [ADR 0004](0004-privacy-and-location.md), [ADR 0009](0009-clean-room-posture.md) L2,
  [ADR 0010](0010-map-tiles-and-routing.md) D-1, D-5, D-7 and open questions 4 and 6,
  [ADR 0012](0012-data-licence.md) D-2 and D-3, [ADR 0023](0023-cc-by-assets-and-attribution.md),
  [ADR 0024](0024-offline-and-caching-posture.md) D-2, [ADR 0026](0026-realistic-game-world.md) D-4
  and D-7, [#53](https://github.com/openzigs/onyourleft/issues/53),
  [#72](https://github.com/openzigs/onyourleft/issues/72),
  [#7](https://github.com/openzigs/onyourleft/issues/7),
  [#458](https://github.com/openzigs/onyourleft/issues/458)

---

## Context

### The question, and why it is asked before anything needs it

**May the trainer game's world take data from outside the athlete's own route?** Not assets — those
are [ADR 0022](0022-game-scenery-model-pack.md)'s and [ADR 0026](0026-realistic-game-world.md)'s, and
they are files this repository commits. **Data**: a height for the hillside beside the road, a
landcover class saying whether it is forest or field, a building footprint, a photograph.

#240 is deliberately **purely procedural**: it adds no data source, makes no network request, stores
nothing, and needs no new dependency. That is the option that is *structurally free* of the licence
question, the same move [ADR 0012](0012-data-licence.md) D-1 made for segment geometry. This document
exists so the alternative is **decided rather than drifted into**.

### What has changed since #248 was filed, and it matters

[#458](https://github.com/openzigs/onyourleft/issues/458) has landed, as
`apps/web/src/game/landform.ts`. The ground beside the road is no longer one flat quad — that was
`three-renderer.ts` §`GROUND_RADIUS_METRES`, now deleted — but a corridor of ground built from the
road's own centreline, at the road's own height, plus a smooth seeded lateral profile read at the
**wrapped** route distance so a place looks the same on lap two. **That file already defers to this
one, by name and in its own header**: *"There is no elevation off the road in this program: a
`RouteProfile` is a line, and an external elevation model is #248's decision rather than this file's.
So the lateral profile is **invented, deterministically**."*

⚠️ **So the concrete thing a "yes" would change is now a shipped, working feature rather than a
gap**, and the trade is legible: a real hillside instead of an invented one. **D-2 is what that
would actually buy and cost.**

### The standard of evidence this document holds itself to

#248's fifth acceptance criterion: *"Every licence claim in the ADR is first-hand. For each adopted
source, the verbatim attribution text is quoted with the URL and the date it was read."* Everything
below was read on **2026-09-22** unless it says otherwise, with the URL given. Where a read failed,
the failure is recorded with its method, because a failure is a finding.

---

## Decision

### D-1 — **No external data source for the trainer game's world.** The world is the athlete's own route and this repository's own committed assets

Stated as a decision rather than as an absence, because #248's seventh criterion asks for exactly
that: *"writing it down is what stops the question being reopened by every future scenery PR."*

Concretely, and checkable by reading our own code:

1. **No runtime request is made by anything under `apps/web/src/game/`** — to any origin, for any
   datum, at any time. `apps/web/src/game/plan-no-network.test.tsx` already asserts this of the plan
   view and is the shape a future assertion takes.
2. **No dataset derived from an external source is committed** for the game world. `ASSETS.toml`
   governs committed binaries and D-4 is what a future one would owe.
3. **No structured record from an external source is persisted**, so no `packages/store` schema
   version grows a landcover column, a building table or a DEM cache. [ADR 0012](0012-data-licence.md)
   D-3's warning transfers verbatim: *"Do not merge a matcher that writes an OSM identifier into
   `SegmentRecord` and call it an optimisation."* The scenery equivalent is a `RouteRecord` that
   grows a cached landcover column.

**The rulings, one candidate at a time.** Every row of #248's table, plus the imagery class #376
adds. The reason column is the *first* reason each fails, not the only one.

| Candidate | Licence, read first-hand | Ruling |
|---|---|---|
| **Copernicus DEM GLO-30** | Bespoke, **not OSI and not CC** | ⚠️ **Rejected for the world; the ROUTE's elevation is D-3 and is NOT this ADR's** |
| **ESA WorldCover 10 m** | **CC-BY-4.0**, confirmed first-hand | **Rejected on architecture, not on licence** — it is the one candidate whose licence clears |
| **OpenStreetMap** | ODbL 1.0, already ruled on by [ADR 0012](0012-data-licence.md) | **Rejected.** D-5 is the ODbL §4.5(b) answer #248 asks for |
| **Mapterhorn** | Code BSD-3-Clause; data = the union of **153 separate open-data licences** | **Rejected for the world.** ⚠️ Its terms are now **read**, which resolves ADR 0010 open question 6 — D-6 |
| **SRTM / NASADEM / USGS 3DEP** | Public domain / CC0, confirmed first-hand | **Rejected on fitness, not on licence** |
| **OpenMapTiles / OpenFreeMap** | CC-BY-4.0 with a *"visibly credit OpenMapTiles"* term | **Already foreclosed** by [ADR 0010](0010-map-tiles-and-routing.md). Recorded, not re-litigated |
| **Street-level photographic imagery** | Every candidate proprietary, `-NC`, `-SA`, or unruled | **Rejected**, carried forward from [#374](https://github.com/openzigs/onyourleft/issues/374) — D-7 |

#### Copernicus DEM GLO-30 — the evidence, and the unresolved half #248 asks about

Read **2026-09-22** from
`https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM`.
The attribution notice is verbatim what [ADR 0010](0010-map-tiles-and-routing.md) D-5 already quotes,
and the modified-data form is the one that would apply:

> produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH
> 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved

**Four findings, and the third is the one #248's fourth criterion asks for.**

1. **The licence is bespoke** — *"The GLO-30 and GLO-90 datasets are available worldwide with a free
   licence"* — and it is on neither `ASSET004`'s permissive list nor its weak list nor
   [ADR 0015](0015-dependency-licences.md)'s tables. ⚠️ `ASSET004` **fails closed**, so a committed
   GLO-30 cutout would stop the build until an ADR ruled on the identifier. That is the rule working,
   not an obstacle to route around.
2. **The notice carries *"all rights reserved"***, which is not how an open licence usually ends, and
   it must travel *"wherever the profile is displayed or exported"*. For a **world** that means every
   frame of a ride, which is the credits-screen shape [ADR 0023](0023-cc-by-assets-and-attribution.md)
   D-3 built — but ADR 0023's admission is scoped to `CC-BY-4.0` and this is not that identifier.
3. ⚠️ **The post-2026 status is UNRESOLVED and is recorded as unresolved.** The same page, read
   2026-09-22, still says: *"The datasets were made available for use in 2019 and **will be
   maintained until 2026**."* It is 2026. The latest release named is still **2024_1 (July 2024)**.
   **What was read**: that collection-description page, and the AWS Open Data registry entry
   (`https://registry.opendata.aws/copernicus-dem/`, 2026-09-22), which says the data *"comes from
   Copernicus DEM 2021 release"* with update frequency *"None, except GLO-30 Public can be updated if
   the public tile list changes."* **What was NOT read**: the DEM Product Handbook and the ESA User
   Licence — ADR 0010 open question 4's named step, owned by
   [#72](https://github.com/openzigs/onyourleft/issues/72), which `spacedata.copernicus.eu` refused
   on 2026-09-22 with `ECONNREFUSED`. **So any decision resting on GLO-30 inherits an open
   dependency**, and this ADR's does not rest on it.
4. **Access is not uniform.** The same page records that registered users in named categories (public
   authorities, Copernicus services, EU institutions, EU-funded research) may download both
   instances, while *"international organizations and the general public"* are more limited — against
   which the AWS Open Data mirror serves GLO-30 Public with `aws s3 ls --no-sign-request`, no account
   at all. ⚠️ **Two access routes with different conditions is itself a reason not to build a shipped
   default on it** without the User Licence in hand.

#### ESA WorldCover — the one licence that clears, rejected anyway

Read **2026-09-22** from `https://esa-worldcover.org/en/data-access`. CC-BY-4.0, and the attribution
string, verbatim:

> © ESA WorldCover project [year] / Contains modified Copernicus Sentinel data ([year]) processed by
> ESA WorldCover consortium

⚠️ **This upgrades ESA WorldCover from second-hand to first-hand** — #248 records it as reported and
forbids a second-hand claim in a Decision section, and this read discharges that. The terms are as
reported.

**And it still fails**, on three counts that are architectural rather than legal:

1. **There is nowhere to put it.** It is a **global 10 m raster**. A route is the athlete's own and
   arrives at import time, so a per-route cutout cannot be committed; a global one cannot be shipped
   in an APK; and pre-generation *"has no home"* — no server (owner decision **D6**), no build-time
   data pipeline. What is left is a **runtime fetch**, which is D-4.
2. **A runtime fetch would be the first outbound HTTP request `apps/web/src` has ever made**, and it
   would be made *continuously while somebody rides*. [ADR 0010](0010-map-tiles-and-routing.md) D-7's
   disclosure argument is **worse** here than for a map: a map request says where the athlete is
   *looking*; a world request says where they are *riding*, once a tile, for an hour.
3. **[ADR 0002](0002-local-first-architecture.md) decision A.** Serving it needs an archive, and
   [#53](https://github.com/openzigs/onyourleft/issues/53) has published nothing —
   `.env.example`'s `VITE_BASEMAP_PMTILES_URL` is still empty.

⚠️ **If it is ever adopted, its CC-BY-4.0 is the easy half**: `ASSET004` admits `CC-BY-4.0` under
`apps/` only, `ASSET006` requires `creator`, `url` and `modified`, and `apps/web/src/credits/`
generates the screen that discharges the continuing obligation. That machinery exists and works. It
is the fetch that does not.

#### SRTM, NASADEM and USGS 3DEP — clear licences, wrong data

- **USGS**, read 2026-09-22 from
  `https://www.usgs.gov/faqs/what-are-terms-uselicensing-map-services-and-data-national-map`:
  *"Map services and data downloaded from The National Map are free and in the public domain. There
  are no restrictions."* The requested acknowledgement is
  *"Data available from U.S. Geological Survey, National Geospatial Program."*
- **NASA**, read 2026-09-22 from
  `https://www.earthdata.nasa.gov/engage/open-data-services-software-policies/data-use-policy`:
  ESDIS content is *"generally not copyrighted"* and data from a NASA-led mission is
  *"licensed as Creative Commons Zero (CC0)"*. Attribution is **requested**, not required.

⚠️ **These upgrade SRTM/NASADEM/3DEP from second-hand to first-hand too**, and both licences clear
`CLAUDE.md` §3 anywhere. They are rejected on **fitness**:

- **30 m is the wrong scale for the thing being drawn.** #458's corridor is a hillside within tens of
  metres of the road; a 30 m post spacing gives roughly one height per road width. The synthesised
  lateral profile it replaces is smooth and continuous at any scale.
- **3DEP is US-only**, so it could never be the shipped default; SRTM has voids.
- **They are still data that has to arrive**, so counts 1–3 of the WorldCover ruling apply unchanged.

### D-2 — What a "yes" would buy, and what it would cost, stated plainly

#248 asks for this and it is the part a future reader will want.

**What it would buy.** A real landform. Today a rider on a Pyrenean col sees an invented hillside of
the right *height* — #458 takes it from the route's own elevation — and the wrong *shape*. With a
DEM they would see the valley that is actually there. With landcover they would see forest where
there is forest. That is a real improvement and this document does not pretend otherwise.

**What it would cost.** Six things, and the first three are not negotiable by anybody writing code:

| Cost | Why |
|---|---|
| **A hosting dependency** | [ADR 0002](0002-local-first-architecture.md) decision A. Somebody has to serve it. #53 has published nothing |
| **A continuous location disclosure** | [ADR 0010](0010-map-tiles-and-routing.md) D-7, made worse: a ride is a sustained, ordered sequence of exactly where the athlete is |
| **An offline regression** | [ADR 0024](0024-offline-and-caching-posture.md) D-2 precaches *"the whole asset graph"*; [ADR 0026](0026-realistic-game-world.md) D-7 has already narrowed that to the **stylised** world. A world that needs a network is a world that is not there on a turbo in a garage — which is where this product is used |
| **An attribution obligation in the frame** | Copernicus' notice must go *"wherever the profile is displayed or exported"*. For a world, that is the ride screen |
| **The first outbound request in `apps/web/src`** | And with it the two assertions `CLAUDE.md` §4f records as **not** subsuming each other: a `styleOrigins`-shaped static check **and** a browser-gate network assertion |
| **A `departing` declaration in `privacy/boundaries.ts`** | ⚠️ And `coordinatesIn` walks a structure looking for declared coordinate shapes; a GeoJSON-shaped layer emits bare `[longitude, latitude]` pairs, which is the case that file is weakest on |

### D-3 — ⚠️ The boundary: the **route's** elevation is not the **world's**, and this ADR does not touch it

The single most likely misreading of D-1.

[ADR 0010](0010-map-tiles-and-routing.md) **D-5** already decides that a planned route's elevation
comes from Valhalla's `/height` over a named DEM, defaulting to Copernicus GLO-30, and
[#72](https://github.com/openzigs/onyourleft/issues/72) owns it. That is a **route** question: it
happens once, at planning time, on a server the rider or an operator runs; the result is stored with
the route (`RouteRecord.elevation`, with its source recorded); and the game then reads the *stored
profile*, never a DEM.

**Nothing in D-1 changes that**, and D-1 is not a veto on ADR 0010 D-5. The distinction is:

| | Route elevation (ADR 0010 D-5, #72) | The world (this ADR) |
|---|---|---|
| When | Once, at planning or import | Continuously, while riding |
| What is disclosed | One route, once | Where the athlete is, all ride |
| Where it is stored | With the route | Nowhere |
| Attribution | One notice beside one profile | In the frame |

⚠️ **A future issue that "just reads the DEM the route already used, for the ground beside it" has
crossed from the left column to the right**, and it is this ADR it needs to supersede.

### D-4 — What a future runtime fetch would owe, all six, and anything short of all six is a deferral

Written so a future proposal can be checked rather than argued about. #248's sixth criterion is this
list.

1. **A named origin**, with an archive actually standing —
   [#53](https://github.com/openzigs/onyourleft/issues/53).
2. **A `styleOrigins`-shaped static assertion** (`apps/web/src/map/basemap.ts`) that the game's
   configuration names no other origin.
3. **A browser-gate network assertion** that no other host is contacted — ⚠️ `CLAUDE.md` §4f records
   that neither of those subsumes the other and that deleting either leaves a real hole.
4. **A `departing` declaration in `apps/web/src/privacy/boundaries.ts`**, with the bare-pair problem
   in D-2's last row solved rather than noted.
5. **An answer to [ADR 0010](0010-map-tiles-and-routing.md) D-7** — who observes the request — that
   is not *"a third-party public instance"*, which that decision calls *"the disqualifying answer for
   a shipped default, independently of funding."*
6. **An answer to [ADR 0002](0002-local-first-architecture.md) decision A** — what the self-hoster
   who holds no cloud account gets. ⚠️ *"They get a worse world"* is an acceptable answer **only if it
   is written down**; it is not acceptable as an unstated consequence.

And a seventh that is not a fetch question: **an answer to
[ADR 0024](0024-offline-and-caching-posture.md) D-2 and [ADR 0026](0026-realistic-game-world.md) D-7**
— whether the ride works with the network off, and what the rider is told when it does not.

**The alternative shape, which is cheaper and is what a "yes" should probably take**: a
**build-time-derived, committed** artefact under [ADR 0026](0026-realistic-game-world.md) **D-5**'s
pipeline — recorded upstream URL and digest, a committed deterministic script, a pinned tool version,
an output digest, an `ASSETS.toml` row. That needs no origin, no fetch, no disclosure and no offline
caveat. ⚠️ **It also cannot represent a route the rider has not imported yet**, which is why it
solves the *licence* problem and not the *product* one, and why it is recorded here as a shape rather
than as a recommendation.

### D-5 — The ODbL question, answered on the side it actually falls

#248 asks which side of ODbL **§4.5(b)** a rendered world falls on, and the answer has two halves
that are usually conflated.

**The frame is a Produced Work.** ODbL §1.0 defines one as *"a work (such as an image, audiovisual
material, text, or sounds) resulting from using the whole or a Substantial part of the Contents"*,
and §4.5(b) says creating one *"does not create a Derivative Database for purposes of Section 4.4."*
A frame drawn on a rider's screen is the strongest Produced Work candidate there is —
[ADR 0012](0012-data-licence.md)'s own phrasing: *"A picture of a road is not a database of roads."*

⚠️ **And that is not the question that decides anything**, which is the finding here. To *draw* the
frame the client must first **fetch and hold** structured OSM-derived records — a `natural=wood`
polygon, a building footprint, a way id. **That holding is the Derivative Database question**, and
[ADR 0012](0012-data-licence.md) **D-3** binds it: a separate object store, never fields on an
existing record; declared ODbL in a **successor ADR to 0012** rather than an amendment; the athlete's
own geometry preserved so the OSM table can be dropped and rebuilt; and a pull-request sentence
naming which fields. **So "the frame is a Produced Work" is true and buys nothing**, because the
obligation attaches a step earlier.

⚠️ **Two facts that a later reader must have.** The OSM wiki's own Produced Work guideline **does not
say a 3D scene is one** — #248 records it read 2026-09-11, last edited 2026-03-27, offering no
example covering generated 3D geometry. And **[ADR 0012](0012-data-licence.md) D-2's reason 2 —
*"nothing is Publicly Used"* — expires the moment [#7](https://github.com/openzigs/onyourleft/issues/7)
lands a server.** An argument that leans on it has a shelf life and this one does not lean on it:
D-1 refuses the fetch, so §4.4 is not reached by any route.

**[ADR 0009](0009-clean-room-posture.md) L2 permits OSM** — *"Terrain comes from the athlete's own
imported route (ADR 0008 D-5) or from OpenStreetMap"* — and that permission is untouched. It says
OSM *may* be used; this ADR says the game *does not*, which is a narrower statement and not a
contradiction.

### D-6 — Mapterhorn: the terms are now read, and ADR 0010 open question 6 is answered

[ADR 0010](0010-map-tiles-and-routing.md) D-5 calls Mapterhorn *"the strongest alternative"*, says it
is off the critical path *only* because its per-source attribution list could not be fetched, and
calls resolving that *"cheap"*. Two attempts had failed — **404 on 2026-09-03** (ADR 0010),
**403 on 2026-09-11** (#248). **The third attempt, on 2026-09-22, succeeded**, and what it found is
more interesting than either failure.

| What was read, 2026-09-22 | Result |
|---|---|
| `https://mapterhorn.com/attribution` (following a 301 to `/attribution/`) | **HTTP 200.** Its static HTML says: *"Mapterhorn uses the following open-data sources to build its terrain tiles. For a full list in JSON format see attribution.json."* **The list itself renders client-side** |
| `https://mapterhorn.com/attribution.json`, and three sibling paths | **HTTP 404** on all of them. ⚠️ **The page's own list does not load** |
| `https://tiles.mapterhorn.com/attribution.json` | **HTTP 200** — a **TileJSON**, not an attribution list. Its whole attribution field is `<a href='https://mapterhorn.com/attribution'>© Mapterhorn</a>`: one line, pointing at the page whose list is missing |
| `mapterhorn/mapterhorn` via the GitHub API — ADR 0010 open question 6's own named fallback step | Repository licence **BSD-3-Clause**. `source-catalog/` holds **153 source directories**, each carrying its own `metadata.json` (name, website, licence, producer, resolution, access year) and a `LICENSE.pdf` |
| `source-catalog/README.md` | *"Licenses which are share-alike or which do not allow commercial usage will not be accepted."* And `EXCLUDED.md` names three sources excluded for exactly that — Lithuania and the Azores for non-commercial terms, Hong Kong because *"License can be revoked at any time"* |
| `source-catalog/glo30/metadata.json` | `"license": "COPERNICUS full, free and open license"`, producer *"DLR e.V. 2010-2014, Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA. All rights reserved."* |

**The answer to ADR 0010 open question 6, stated as an answer**: *Mapterhorn's terrain data has no
single licence.* It is the **union of 153 national and regional open-data licences**, curated under a
stated policy that excludes share-alike and non-commercial terms, and the project's own public
attribution surface is **one line — "© Mapterhorn" — whose expansion currently 404s.**

**What follows for this ADR**: rejected for the world, with D-1's reasons, unchanged. **What follows
for [#72](https://github.com/openzigs/onyourleft/issues/72)** — which owns ADR 0010 open questions 4
and 6 — is more useful and is recorded here because it is where the reading happened:

- The **curation policy is a genuine asset**: a source set with share-alike and non-commercial
  excluded by rule is exactly what `CLAUDE.md` §3 needs, and no other candidate here offers it.
- The **attribution burden is tractable for a route profile** — one notice beside one profile, in the
  shape ADR 0010 D-5 already designed — and **intractable for a frame**.
- ⚠️ **The 404 is a live risk to be raised upstream, not a detail.** A project whose attribution page
  cannot render its own list is a project whose downstream attribution cannot be discharged in good
  faith; the repository holds the data (153 `metadata.json` files) and the website does not serve it.

### D-7 — Street-level photographic imagery: rejected, carried forward rather than re-decided

[#376](https://github.com/openzigs/onyourleft/issues/376) asks for this ruling to land **in this
document** and explicitly forbids a second ADR, on the reservation-table argument. Its parent
[#374](https://github.com/openzigs/onyourleft/issues/374) investigated it and **rejected it on three
independent grounds**, each sufficient alone: **licence** (Google, Bing and Apple are proprietary,
platform-locked and forbid caching; Mapillary is CC-BY-SA with some content CC-BY-NC-SA, which is
non-OSI and fails `CLAUDE.md` §3 everywhere; Panoramax is `etalab-2.0` or CC-BY-SA-4.0, neither ruled
on here, so both **fail closed**); **cost and privacy** (per-request billing fails
[ADR 0002](0002-local-first-architecture.md) decision A, and a third party observing every position
is [ADR 0010](0010-map-tiles-and-routing.md) D-7's disqualifying answer); and **coverage** (#374
records roughly 1.1 M km covered worldwide, about 93 % of it in France).

⚠️ **The ruling is carried forward, not re-derived**, and this document does not re-read #374's
sources: they were read first-hand on **2026-09-19** and #374 records them with their dates. What is
decided here is that **imagery is inside D-1**, so it needs no separate rule — and that #374's own
finding stands: *"'later phase' is the wrong frame"*, because no future phase changes the licence,
the disclosure or the coverage, and a server (#7) fixes none of the three.

**The one candidate #374 asks not to be over-claimed**: KartaView / OpenStreetCam is recorded there
as **second-hand only** and is **not ruled on** here either, for the reason #248's fifth criterion
gives. It is rejected by D-1 like everything else; it is not rejected on its licence, because nobody
has read it.

---

## Consequences

### What this enables

- **#240 needs no follow-up**, which is #248's seventh criterion. The procedural world is the world.
- **The question is citable.** A future scenery pull request proposing a fetch has a document to be
  measured against (D-4) rather than an argument to have.
- **`apps/web/src` keeps its zero outbound requests**, and with it the offline claim
  [ADR 0024](0024-offline-and-caching-posture.md) makes and the browser gate measures.
- **ADR 0010 open question 6 is answered** (D-6) and open question 4 is **precisely** characterised
  as unresolved (D-1), both with dates and methods, which is what #72 inherits.

### What this costs

- **The hillside beside the road is invented.** #458's corridor has the right height at the road and
  a seeded, plausible shape away from it. On a real col it is not the real valley, and a rider who
  knows the road will know.
- **There is no landcover.** Whether a stretch is forest, field or town is
  `apps/web/src/game/scatter.ts`'s seeded guess from latitude, altitude and gradient — provenance is
  in that file's §Provenance — and not what is actually there.
- **A coastal road has no sea, and a town has no town.** Nothing in the world knows about water,
  buildings or roads other than the one being ridden.
- ⚠️ **This is a real product gap and this document does not minimise it.** It is the price of
  [ADR 0002](0002-local-first-architecture.md) decision A and
  [ADR 0010](0010-map-tiles-and-routing.md) D-7, both of which are decisions the owner has already
  taken, and the honest framing is that the gap is **paid for** rather than absent.

### Constraints this places on other work

| Issue | Constraint |
|---|---|
| [#240](https://github.com/openzigs/onyourleft/issues/240), [#458](https://github.com/openzigs/onyourleft/issues/458) | Confirmed as the answer, not as a placeholder. The synthesis stays |
| [#376](https://github.com/openzigs/onyourleft/issues/376), [#374](https://github.com/openzigs/onyourleft/issues/374) | Discharged by D-7. No second ADR |
| [#72](https://github.com/openzigs/onyourleft/issues/72) | **Unblocked on open question 6** by D-6, and told exactly what is still missing on open question 4. ⚠️ D-3 says this ADR does not touch the route's own elevation |
| [#53](https://github.com/openzigs/onyourleft/issues/53) | Unaffected. The basemap is a map, not a world; D-1 is about `apps/web/src/game/` |
| Any future scenery issue | D-4's six, or it is a deferral recorded as one |

---

## What would make this ADR wrong

- **The owner decides the world should be real at the cost of the offline claim.** Then D-1 is
  superseded by an ADR carrying that decision, and D-4 is the checklist it has to satisfy. That is
  the mechanism working, not this document failing.
- **A build-time pipeline appears that can derive world data per route without a runtime request.**
  D-4's closing paragraph describes the shape; what defeats it today is that a route arrives when the
  rider imports it, not when the build runs. ⚠️ **If [#7](https://github.com/openzigs/onyourleft/issues/7)
  lands a server the rider runs themselves, that stops being true** — a self-hosted instance could
  derive a route's world at import time, on the athlete's own hardware, disclosing nothing. **That is
  the single most likely way this ADR becomes wrong**, and it is worth re-reading then rather than
  re-deriving.
- **Copernicus GLO-30's maintenance horizon resolves badly** — a withdrawal rather than a successor.
  That would not change D-1, which does not rest on it, but it would move
  [ADR 0010](0010-map-tiles-and-routing.md) D-5 and #72, and D-6's reading of Mapterhorn would become
  the more valuable half of this document.
- **Mapterhorn publishes its attribution list.** D-6's third finding is a live defect in somebody
  else's project and it may be fixed the week after this is written. The union-of-153 conclusion does
  **not** change if it is; only the practicality of discharging it does.
- **Somebody reads D-5's "the frame is a Produced Work" as permission.** It is the true half of a
  two-half answer and it is the half that decides nothing.
