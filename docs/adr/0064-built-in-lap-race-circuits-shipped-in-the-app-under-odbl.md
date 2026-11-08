# ADR 0064: Built-in lap-race circuits — short loops drawn on our own basemap, committed and shipped in the app under ODbL 1.0, for solo bot races only

- **Status**: **Accepted, 2026-11-06**, on the owner's
  [ruling of that day](https://github.com/openzigs/onyourleft/pull/2297#issuecomment-6700261818)
  on pull request #2297: Q0 accept before merge; Q1 (a), lines drawn on our basemap's streets; Q2 (a), line and heights only; Q3 (a), heights from USGS 3DEP; Q4 yes, ODbL
  1.0; and Q5 yes, in a [later comment](https://github.com/openzigs/onyourleft/pull/2297#issuecomment-6700630598) that day: the circuits are kept out of the owner's home
  area. D-11 records each answer. Proposed 2026-11-06;
  the pull request flipped this line before merge, because an amendment cannot change a Status line
  afterwards (ADR 0013). [#2293](https://github.com/openzigs/onyourleft/issues/2293) builds the
  circuits
- **Date**: 2026-11-06
- **Deciders**: **the owner**, on the ruling of 2026-11-06 that #2293 records (built-in circuits,
  for solo races against bots only, confirming [ADR 0060](0060-the-lap-race-effort-distance-and-a-bounded-race-offset.md)
  D-14 Q6). The owner ruled **that** circuits ship, **for solo bot races only**, **three or four
  loops of about 3 to 8 km on real roads drawn from our own basemap**, **original, with our own
  names**, **with their map data and the OpenStreetMap credit**, and **working with no instance**.
  That ruling left open what of the map data ships, where the hills come from, and how the licence
  is carried: D-11 put those as questions with a recommendation, and the owner's
  [ruling of 2026-11-06 on #2297](https://github.com/openzigs/onyourleft/pull/2297#issuecomment-6700261818)
  took the recommendation on Q0 to Q4 (D-11). Drafted by the author; each recommendation was the
  author's engineering reading
- **Issue**: [#2293](https://github.com/openzigs/onyourleft/issues/2293), of the epic
  [#1894](https://github.com/openzigs/onyourleft/issues/1894). Its lane scope (the comment of
  2026-11-06) asks first whether shipping circuit map data in the app needs an ADR change, and if it
  does, for that change as its own pull request for the owner, before any code. This is that change
- **Number**: **0064**. On 2026-11-06 `main` (`f045191f`) holds no `docs/adr/` file numbered 0064,
  no open pull request adds one, and no open issue names it. **0057 and 0058 stay claimed** by
  [#1748](https://github.com/openzigs/onyourleft/issues/1748) and
  [#1752](https://github.com/openzigs/onyourleft/issues/1752)
- **Supersedes**, in part and for the circuit files of D-2 only:
  - [ADR 0032](0032-external-data-for-the-game-world.md) **D-1 item 2**, *"No dataset derived from
    an external source is committed for the game world"*, and the *"Still true"* that
    [ADR 0054](0054-towns-from-real-map-data.md) D-1's table gives it;
  - [ADR 0012](0012-data-licence.md) **D-4**, *"§4.6 is not the plan"*, for this one database, as
    D-4's last paragraph asks a successor to decide;
  - [ADR 0054](0054-towns-from-real-map-data.md) **D-3.6**, only where it says a stylised-world ride
    shows no credit: a stylised-world ride on a built-in circuit shows one (D-5.3).

  Each gains one dated `## Amendments` entry pointing here, in this pull request (ADR 0013).
  [ADR 0056](0056-the-demos-shipped-map-under-odbl.md) is **not** superseded: D-1 says why
- **Relates to**: ADR 0060 D-1, D-7.3 and D-11; [ADR 0028](0028-racing-fairness.md) D-7.1;
  [ADR 0054](0054-towns-from-real-map-data.md) D-2, D-3.5 and D-3.6; ADR 0056 D-2.4, D-3, D-4, D-6,
  D-7 and D-9; [ADR 0062](0062-we-build-our-own-basemap-archive-from-openstreetmap.md) (our own
  archive); [ADR 0010](0010-map-tiles-and-routing.md) D-5 and ADR 0032 D-3 (a route's elevation);
  [ADR 0004](0004-privacy-and-location.md) D; [ADR 0036](0036-a-self-hostable-instance-server-now.md)
  D-3 and D-7; [ADR 0015](0015-dependency-licences.md) D-2 and `ASSET004`

---

## Context

### The ruling this records

#2293's body, the owner's ruling of 2026-11-06:

> built-in circuits are for solo races against bots only. Online rooms keep using a loop the host
> saved.
>
> - Three or four short loops, about 3–8 km, on real roads, drawn from our own basemap.
> - Original: no other game's track designs or names, and our own names (ADR 0060 D-1.5).
> - Shipped as built-in routes with their map data and OSM attribution. Follow ADR 0056's ODbL
>   handling for shipped map data; if it does not cover the app (it was written for the demo
>   build), an ADR amendment comes first, for the owner.
> - No coordinates or place names in public text beyond what the shipped route data must carry.
> - Offered in the lap race's course picker, reached from the Games tab (#2292's sibling issue) and
>   from the ride setup.
> - Must work with no instance.

The issue's comment of the same day corrects the Games tab to #2292.

### Why ADR 0056 does not cover the app

ADR 0056 was written for the demo build and says so where it matters:

- **D-2.4**: *"In the demo build only (the owner's ruling): never in `apps/web/dist`, the APK, the
  service worker's precache or `apps/web/public/`."*
- **D-5.1**: *"The bundle is generated, never committed"*, which is how it keeps ADR 0054 D-1 item 2
  (ADR 0032 D-1 item 2) true.
- **D-7.4**: the route's line is *"the owner's own recorded track, or a line drawn by hand, never a
  route exported from a planner that snapped it to OpenStreetMap or another map's roads"*, because a
  snapped line is data derived from OpenStreetMap.

A circuit **drawn from our own basemap** and **shipped in the app** fails all three: the line
follows the basemap's mapped streets, so it is derived from OpenStreetMap; it must be committed,
because there is nothing to regenerate it from at build time (a line on real roads needs the roads,
and the app build has no routing engine, and ADR 0056 D-9 keeps a real-data bake out of a pull
request's checks, though the owner or the release job may run one); and it
lands in `apps/web/dist` and the APK.

### Why an ADR and not an amendment

The issue asks for *"an ADR amendment"*. An `## Amendments` entry may record that a stated fact has
become false, and **may not change a decision** (ADR 0013 D-3; ADR 0060's own Consequences say the
same). Committing a dataset derived from an external source reverses ADR 0032 D-1 item 2, and
offering a Publicly Used database under §4.6 reverses ADR 0012 D-4 for it. Both are decisions. So
this is a new ADR that supersedes those two in part, and the amendments are the pointer entries ADR
0013 asks the superseded ADRs to carry. That is the shape ADR 0056 took for the demo and ADR 0062
took for ADR 0010 D-1, on the owner's ruling that a reversed decision is a new ADR.

### What exists today (read at `main` `f045191f`)

- **The course picker** is the stage chooser, `apps/web/src/game/StageChooser.tsx`: a lap race is
  offered on a **loop** route the rider imported or saved (#1907, ADR 0060 D-11.1), and a room's
  course is a loop the host saved. No route is built into the app.
- **The world reads the corridor per route, on the device.** With the realistic world chosen,
  `GameView` asks `loadWorldCorridor` for the chosen route while the rider chooses (ADR 0054 D-2),
  from the configured archive, into the owner-scoped `worldCorridors` store. The stylised world, the
  lap race's first world (ADR 0060 D-14 Q5), reads none. With no archive reachable the world is
  procedural (ADR 0054 D-4).
- **The ride screen's OpenStreetMap credit is keyed on the corridor** (`GameView.tsx`,
  `rideHasCorridor ? OSM_ATTRIBUTION : undefined`, #1552, ADR 0054 D-3.6). A ride on the stylised
  world owes and shows none today, because its road is the rider's own line.
- **A route's elevation** is the GPX's for an imported route, and Valhalla's `/height` over
  Copernicus GLO-30 for a planned one (ADR 0010 D-5). ADR 0032 records Copernicus GLO-30's licence as
  *"Bespoke, not OSI and not CC"*, and SRTM, NASADEM and USGS 3DEP as *"Public domain / CC0,
  confirmed first-hand"*, rejected for the **world** on fitness, not on licence (ADR 0032 D-1's
  table; D-3 says the route's elevation is not that ADR's question).
- **The licence gates.** `LIC001` and `LIC002` scan source file types, not `.json`.
  `ASSETS.toml` records committed binaries, and since #937 `ASSET008` also demands a row for an
  `.svg`, `.lottie`, `.riv` or Lottie `.json`. A circuit's JSON is none of those, so `ASSET008` does
  not discover it, but the manifest may name any file voluntarily, and a named file gets `ASSET002`
  (present), `ASSET003` (digest), `ASSET004` (the licence admitted at its path), `ASSET006`
  (attribution) and `ASSET007` (derivation). ADR 0056 D-7.5 records that an `ODbL-1.0` file needs
  that licence admitted at its path first.

### How much OpenStreetMap is in a short loop

The OpenStreetMap Foundation's *Substantial* guideline, **"Endorsed by the OSMF board 2014-06-06"**
(<https://osmfoundation.org/wiki/Licence/Community_Guidelines/Substantial_-_Guideline>, read
2026-11-06), treats as insubstantial *"Less than 100 Features"*, or *"The features relating to an
area of up to 1,000 inhabitants"*, and adds *"we regard repeated small extractions as one big
extraction!"*. A 3 to 8 km loop follows tens of street ways, and four of them are one extraction by
that rule. Whether the total stays under 100 is not measured, and the guideline is not a licence
term and does not call itself a legal opinion. D-3 does not rest on it.

---

## Decision

### D-1 — What this supersedes, and what still holds

| Decision | After this ADR |
|---|---|
| ADR 0032 **D-1 item 2**, *"No dataset derived from an external source is committed for the game world"*, and ADR 0054 D-1's *"Still true"* | **Superseded for the circuit files of D-2 only.** They are committed (D-6). Nothing else derived from an external source is committed, and ADR 0032 D-1 items 1 and 3 hold: `game/` makes no request for them, and no store persists them |
| ADR 0012 **D-4**, *"§4.6 is not the plan"* | **Superseded for this one database**, as ADR 0056 did for the demo bundle: §4.6 a, the entire database (D-4) |
| ADR 0054 **D-2** (the corridor read per route, on the device) and **D-3.5** (`worldCorridors` never leaves the device) | **Unchanged.** A circuit's corridor, when the realistic world is chosen, is read like any route's (D-2.2) |
| ADR 0054 **D-3.6** (the ride's credit, keyed on the corridor) | **Extended, and superseded in part**: the credit is also owed for the whole of a ride on a built-in circuit, in every world, so the stylised world no longer always shows none (D-5.3) |
| ADR 0056, every decision | **Unchanged.** Its bundle stays in the demo build only (D-2.4). A circuit file is a different database with no corridor in it (D-2.1), so D-2.4 is not reached; the owner answered Q2 (a), so this row stands |
| ADR 0060 D-11 and ADR 0028 D-7.1 | **Unchanged**: D-14 Q6 already allows a bundled circuit for solo bot races; D-8 here holds it there |

### D-2 — What is shipped: the circuit's line and heights, and no corridor

1. **Per circuit, one plain JSON file**: an ordered list of points (latitude, longitude, height) that
   closes on itself within `LOOP_CLOSURE_METRES`, the circuit's own name and length, the source of
   its heights (D-7, as `ElevationDataset` names one) and the licence metadata of D-3.2. **No OSM
   identifier, no street or place name, no address, no owner, no route id and no device time.**
   A file of this shape is a few tens of kilobytes at most; the build issue states the real sizes.
2. **No corridor is shipped** (option (a), the owner's answer to D-11 Q2). With the realistic world chosen,
   the circuit's corridor is read from the configured archive while the rider chooses, by the same
   code as a rider's own route's (ADR 0054 D-2), and with no archive reachable the world is
   procedural (ADR 0054 D-4). The stylised world needs none. **The `worldCorridors` port is keyed by
   owner and a branded route id** (`corridor-port.ts`), and a circuit is not a `RouteRecord` (D-8.2).
   So a circuit's corridor key is a **reserved id namespace**, `circuit:` followed by the stable
   circuit id, which no route id may carry (the build issue checks this against how route ids are made, and
   a test fails if a route id can start with it).
   The read keeps the owner filter, and `activity-store.scoping.test.ts` still derives it (CLAUDE.md
   §6); the build adds a case that a circuit's kept corridor is not visible to another owner.
3. **Rejected, for Q2: (b) a baked corridor per circuit, ADR 0056's bundle shape, in the app.** It
   would let the realistic world draw a circuit offline and the same every time, but it puts a
   corridor-sized ODbL database (ADR 0056's ceiling is 8 MiB a route) in `apps/web/dist`, the APK
   and the precache, which ADR 0056 D-2.4 forbids; it needs a real-data bake in the release job,
   which ADR 0056 D-9 keeps out of a pull request's checks; and it adds to the bundle budget for a
   world the lap race does not draw first.

### D-3 — Its licence: ODbL 1.0, whether or not the extract is substantial

1. **A circuit's line is treated as a Derivative Database of OpenStreetMap, and it is Publicly
   Conveyed** (ODbL §1.0, quoted first-hand in ADR 0056's Context): it follows the basemap's mapped
   streets, and the app is offered to anyone. So each file is offered **under ODbL 1.0** (§4.4 a.i),
   as the demo bundle and `worldCorridors` are.
2. **§4.2 b: the licence travels inside the file and beside it.** Each file carries the identifier
   `ODbL-1.0`, the URI `https://opendatacommons.org/licenses/odbl/1-0/`, the source (*OpenStreetMap
   contributors*, `https://www.openstreetmap.org/copyright`, through the project's own archive, ADR
   0062) and the §4.3 notice that ADR 0056 D-3.3 quotes. A `LICENCE-ODbL.txt` sits beside the files
   in the repository, and the same notice is copied into the app's `apps/web/public/licences/` and
   named on its credits screen (§4.2 d). **That naming is new work**: the credits screen's *Map data*
   entry says today that the map is "Not a file this app ships" (`CreditsView.tsx`), which stops
   being true, so the build rewrites that comment and entry (D-5.2).
3. **Why not lean on the Substantial guideline.** It may well put four short loops under its 100
   features, but it counts the four as one, the count is not measured, and it is guidance rather
   than a licence term. Offering the files under ODbL costs a notice and a file the repository
   already publishes (D-4); not doing so, if the reading were wrong, is a breach in every release.
   *Author's reading.*
4. **§4.4 d: nothing incompatible is added.** The Contents the files add to OpenStreetMap's are the
   circuit's name and length, which are ours, and its heights, whose source must be one ODbL can
   carry (D-7).
5. **The ODbL governs the data, not the program** (ADR 0056 D-3.5). The code that reads the files is
   `AGPL-3.0-or-later` by path.

### D-4 — §4.6: the entire database (a), offered where the files already are

1. **§4.6 a, the entire database: the files themselves.** They are plain JSON, in the public
   repository at a stable path and inside every build of the app, free of charge. §4.6 b (a method)
   would be no cheaper and is a weaker offer, as ADR 0056 D-4.1 found.
2. **The build carries its own compliance** (ADR 0056 D-4.4's rule, for the reason ADR 0012 D-4
   gave). Whoever redistributes the app, a fork, a store build, or a self-hoster serving the web
   client from an instance, Publicly Conveys the files. They comply by shipping the build unchanged,
   which carries the files with their licence fields and the notice in `public/licences/`; nobody
   has to know this ADR exists.
3. **§4.6 for a published Produced Work.** §4.6 also asks that the database be offered to recipients
   of a Produced Work made from it, and ADR 0056 D-4.3 met that for videos by naming a release-asset
   URL beside them. D-4.1 reaches only people who receive the build. So a screenshot or video of a
   ride on a built-in circuit that is published outside the app (a store listing, a promo clip, a
   pull request) carries, beside the D-5.4 credit, the stable repository URL of the circuit files'
   directory, which the build issue names. Where a place cannot hold a URL, the image is not
   published.

### D-5 — Attribution

1. **The course picker** shows `© OpenStreetMap contributors` (`apps/web/src/map/basemap.ts`
   §`OSM_ATTRIBUTION`, never a copy) beside the built-in circuits, linking or beside a link to the
   §4.3 notice.
2. **The credits screen** keeps its *Map data* entry (`CreditsView.tsx`) and its §4.3 sentence, and
   the build **adds** to it a sentence that the app ships the circuits' files under ODbL 1.0 with a
   link to the notice (D-3.2), and corrects the code comment that calls the map data "not a file
   this app ships".
3. **The ride screen shows the credit for the whole of a ride on a built-in circuit**, in every
   world, because the road it draws is the circuit's line: the frame is a Produced Work of the file.
   This adds a second key (a built-in circuit) to ADR 0054 D-3.6's (the corridor). **It narrows
   D-3.6's statement for the stylised world**: `docs/odbl.md` lists *"the stylised world"* by name
   among the worlds that show no credit, and that stops being true for a stylised-world ride on a
   circuit. So ADR 0054 D-3.6 is superseded **in part** (the Supersedes list), the build updates that
   parenthesis in `docs/odbl.md` and the comment beside the corridor-keyed credit in `GameView.tsx`,
   and a ride on the stylised world with no circuit still shows none.
4. **A screenshot or video of a ride on a built-in circuit that is published** (an owner-review
   screenshot on a pull request included) shows that credit in the frame. Video export follows ADR
   0056 D-8.2 if it is ever offered for the game.

### D-6 — Committed, at one path, with ODbL admitted there and nowhere else

1. **The files are committed** under one directory of `apps/web` that the build issue names, with
   `LICENCE-ODbL.txt` beside them. They are data, not source: no SPDX header, as ADR 0056 D-6 has it,
   and **never under `packages/`**, whose consumers must be able to take a package with no ODbL
   obligation.
2. **`ODbL-1.0` is admitted for that directory's JSON files and for nothing else.** The
   default, and the recommendation, is to **name each file in `ASSETS.toml`** (Context: a named text
   file gets `ASSET002` to `ASSET004`, `ASSET006` and `ASSET007`), with `ASSET004`'s per-path
   admission extended to `ODbL-1.0` at that one directory. That gives the digest (D-6.3), the
   attribution and the derivation record with no new rule. A new repository rule is needed only for
   what the manifest cannot say, that the licence fields of D-3.2 are inside each file and the
   notice file is present; the build issue adds that small check, or says why `ASSETS.toml` alone
   suffices. *Author's reading* of how ADR 0015 D-2's per-path admission applies.

3. **A digest per file** is recorded with the archive build it was drawn from (ADR 0062 D-1.4's
   build record), so a later redraw is a reviewable change and not a silent one.
4. **Tests use a synthetic fixture circuit** wherever they draw or screenshot a ride, so no CI
   artefact is a Produced Work of a real circuit (ADR 0056 D-9's rule, carried over). A test may read
   the real files to check their shape, their licence fields and that they close.

### D-7 — Where the line and the heights come from

1. **The line is drawn on our own archive's street lines** (the ruling): an authoring script, run
   by a developer outside CI, reads the archive's street lines around a chosen start and writes the
   closed loop that follows them, with no OSM identifier or name. The method is the build issue's,
   stated in its pull request. **The loop's design is ours** (ADR 0060 D-1.2 and D-1.3): no course
   traced or recreated from any game.
2. **The heights, the owner's answer to D-11 Q3 (a): USGS 3DEP**, sampled once along the line at authoring,
   with its name and resolution recorded in the file as a planned route records its DEM. It is
   public domain (ADR 0032's table), so §4.4 d is met and nothing is owed beyond a courtesy credit;
   it is a bare-earth model, so a tree-lined road does not gain false grade. It covers the archive's
   coverage. ADR 0032 D-1's rejection of 3DEP is for the **world**, and ADR 0032 D-3 leaves a route's
   elevation outside it; adding it as a source for these files only is recorded here so that it is
   a decision and not a drift.
3. **Not chosen: Copernicus GLO-30.** Its licence is bespoke, not OSI and not CC (ADR 0032),
   and *"all rights reserved"* is in its notice; committing heights derived from it is not a step
   this project has taken for any file.
4. **The alternative the owner did not choose (Q1 (b), Q3 (b)): a GPX the owner rides** on each
   loop, under ADR 0056 D-7's rules (latitude, longitude and elevation only, no timestamp, trimmed or
   starting at a public place, `CC0-1.0`). Its line is then the owner's own trace and not derived
   from OpenStreetMap, D-3 and D-4 fall away for the line, and ADR 0032 D-1 item 2 is not reached at
   all. It costs the owner a ride on each loop and gives GPS noise in the line.

### D-8 — Solo bot races only, on the device

1. **A built-in circuit is offered only in the lap race's course picker, for a solo race against
   bots.** It is **never** a room's course (ADR 0060 D-11.3), never in a room's course list, and not
   offered for a free ride or a workout. A test asserts the room course list cannot hold one.
2. **A built-in circuit is not copied into the rider's records.** It is not saved as a
   `RouteRecord`, not synced to an instance, not in *export everything* and not in a shared route. A
   ride on one names it by a stable circuit id, and the ride records what any lap race records (ADR
   0060 D-2.4). So no instance ever holds a circuit (ADR 0036 D-3 (c) and (d) are not engaged), and
   no rider export becomes a second copy of the database.
3. **It works with no instance and no network** (the ruling; ADR 0060 D-7.3). The files are in the
   app bundle, so a stylised-world race on one needs no request.
   `apps/web/src/privacy/no-network.test.ts` is not widened. The realistic world's corridor read is
   the one that already exists (D-2.2).

### D-9 — Privacy

1. **Every circuit runs on public roads and starts and ends at a public place**, chosen as no
   person's home and not beside one. The circuits are the project's, not any rider's, so no rider's
   location is published. **Where they are drawn is also a disclosure**: loops authored by one
   identifiable maintainer on roads they know reveal that maintainer's home area, and committed
   history is permanent. So **no circuit is drawn in or near the owner's home area**; the circuits
   use other regions (Q5, the owner's [ruling of 2026-11-06](https://github.com/openzigs/onyourleft/pull/2297#issuecomment-6700630598)). The area is never named, here or
   in any other public text (D-9.2).
2. **No coordinate and no place name in public text** (the ruling): not in an issue, a pull request,
   a commit message, a review, this ADR, `docs/`, or a rider-facing word. The files' own points are
   the only coordinates, and a circuit's name is ours and is not a place name.
3. **An error about a circuit names the field and the constraint and never the value** (ADR 0004
   D), in the authoring script, the loader and the repository rule alike.

### D-10 — This is not a legal opinion

ADR 0012 D-6's rule and ADR 0056 D-11's, for the same reason: no lawyer was consulted. The ODbL
clauses this relies on are the ones ADR 0056 read first-hand on 2026-10-24; the Substantial
guideline was read on 2026-11-06.

### D-11 — What the owner was asked, and the answers

The owner answered on 2026-11-06, in a [comment on pull request #2297](https://github.com/openzigs/onyourleft/pull/2297#issuecomment-6700261818): *"Q0: accept before
merge. Q1 (a): lines drawn on our basemap's streets. Q2 (a): line and heights only. Q3 (a): heights
from USGS 3DEP. Q4: yes, treat the circuits as ODbL 1.0."* Q5 was answered the same day in a
[later comment](https://github.com/openzigs/onyourleft/pull/2297#issuecomment-6700630598): keep the built-in circuits out of the owner's home area, none drawn in or near
it. Each answer is the recommendation.

1. **Q0 — Accept this ADR before it merges, or merge it as Proposed?** Recommended: **accept before
   merge**; the pull request flips the Status line. **Answered: accept before merge.**
2. **Q1 — Where does each circuit's line come from: (a) drawn on our own basemap's streets (D-7.1),
   or (b) a GPX the owner rides (D-7.4)?** Recommended: **(a)**, because it is the ruling's *"drawn
   from our own basemap"* and needs no ride; it is what makes D-1, D-3, D-4 and D-6 necessary.
   **Answered: (a)**, lines drawn on our basemap's streets.
3. **Q2 — What of the map data ships: (a) the line and heights only, the corridor read per ride as
   for any route (D-2.2), or (b) a baked corridor per circuit in the app (D-2.3)?** Recommended:
   **(a)**. (b) supersedes ADR 0056 D-2.4 for the app and is a larger change. **Answered: (a)**,
   the line and heights only.
4. **Q3 — The heights: (a) USGS 3DEP (D-7.2), (b) the owner's GPX, or (c) flat?** Recommended:
   **(a)**. (c) costs every circuit its hills, which the trainer would otherwise put in the legs.
   **Answered: (a)**, USGS 3DEP.
5. **Q4 — Treat the circuits as ODbL 1.0 whatever the Substantial guideline says (D-3.3)?**
   Recommended: **yes**. **Answered: yes**, ODbL 1.0.
6. **Q5 — Are the circuits kept out of the owner's home area (D-9.1)?** Recommended: **yes**.
   **Answered: yes**, no circuit is drawn in or near the owner's home area (D-9.1).

---

## Consequences

### What this enables

- **#2293 can be built**: three or four circuits, a course picker that offers them, and the credit,
  with a document to be checked against. #2292's Games tab can lead to it.
- **A rider with no saved loop can race at once**, offline on the stylised world, with no instance.

### What this costs

- **The project's first OpenStreetMap-derived data in its permanent history.** A mistake in a
  committed file cannot be withdrawn by a later commit; D-6.3's digest and D-9's rules are why the
  files are reviewed before they land.
- **A second Publicly Used ODbL database**, with §4.2, §4.3, §4.4 and §4.6 binding every release of
  the app for as long as the files ship. D-4.2 is how a redistributor meets them without knowing.
- **A credit on rides that showed none**: a stylised-world race on a built-in circuit now shows the
  OpenStreetMap line for the whole ride.
- **A new height source for four files** (3DEP, Q3 (a)), and an authoring script a developer
  runs by hand.
- **A circuit redrawn after an archive refresh is a new commit.** Nothing redraws itself.

### Constraints this places on other work

| Issue | Constraint |
|---|---|
| [#2293](https://github.com/openzigs/onyourleft/issues/2293) | D-2 to D-9 as the owner answered D-11: the file shape and licence fields, the notice file, the repository rule of D-6.2, the digest, the fixture circuit for drawn tests, the picker's and the ride screen's credit, solo races only, nothing copied into the rider's records, no coordinate or place name in public text, screenshots that show the credit |
| [#2292](https://github.com/openzigs/onyourleft/issues/2292) | None beyond #2293's: the Games tab leads to the same picker |
| [#2102](https://github.com/openzigs/onyourleft/issues/2102) | None: a room's course stays a loop the host saved (D-8.1) |
| ADR 0032, ADR 0054 and ADR 0012 | Each gains one appended entry under ADR 0013 pointing here, in this pull request |

---

## What would make this ADR wrong

- **The line is taken from a GPX the owner rides after all (Q1 (b)).** The owner answered (a) on
  2026-11-06. Were that reversed, the line would not be OpenStreetMap's, D-3, D-4 and D-6.2 would
  apply to nothing, and ADR 0032 D-1 item 2 would not be superseded: a superseding ADR, not an
  amendment.
- **A baked corridor is shipped in the app after all (Q2 (b)).** The owner answered (a) on
  2026-11-06. Were that reversed, ADR 0056 D-2.4 would be superseded for the app, and D-1's ADR
  0056 row would change.
- **The lap race is offered in a room on a built-in circuit.** That is ADR 0060 D-11.3 and the
  patent reading spike 0030 §5.1 rests on, and it needs a superseding ADR first.
- **USGS 3DEP's terms, or the OSMF's guidance on games, change.** The dates above are there for that
  reason.

## Sources

| What | Where | Read |
|---|---|---|
| The owner's ruling and the lane scope | [#2293](https://github.com/openzigs/onyourleft/issues/2293), its body and its comment of 2026-11-06 | 2026-11-06 |
| The owner's answers to D-11 and the acceptance | [Comment on #2297](https://github.com/openzigs/onyourleft/pull/2297#issuecomment-6700261818) | 2026-11-06 |
| ODbL 1.0 §1.0, §4.2, §4.3, §4.4 and §4.6, verbatim | ADR 0056's Context, read first-hand from <https://opendatacommons.org/licenses/odbl/1-0/> | 2026-10-24 |
| The OSMF *Substantial* guideline: its endorsement date, its thresholds, and *"repeated small extractions as one big extraction"* | <https://osmfoundation.org/wiki/Licence/Community_Guidelines/Substantial_-_Guideline> | 2026-11-06 |
| Copernicus GLO-30 *"Bespoke, not OSI and not CC"*; SRTM, NASADEM and USGS 3DEP *"Public domain / CC0"* | ADR 0032 D-1's table, read first-hand there | as ADR 0032 records |

---

## Amendments

Appended under [ADR 0013](0013-adr-amendments.md). Nothing above this line has been edited.

- **2026-11-08** — **D-1, D-6.2, D-7.2 and D-8.1 are superseded in part by
  [ADR 0065](0065-built-in-delivery-levels-shipped-in-the-app-under-odbl.md)**, proposed that day ([#2360](https://github.com/openzigs/onyourleft/issues/2360), on the owner's rulings of that day on the
  epic [#2359](https://github.com/openzigs/onyourleft/issues/2359)), for the built-in Delivery
  levels only. The levels are a second committed dataset derived from OpenStreetMap, so D-1's
  *"the circuit files of D-2 only"* and *"Nothing else … is committed"* stop being the whole
  exception; `ODbL-1.0` is admitted at a second directory, the levels', beside this one (D-6.2);
  USGS 3DEP is also the levels' height source (D-7.2); and the levels are offered in the Delivery
  picker (D-8.1). Every decision here still holds for the circuits, D-2.3 included: a circuit ships
  no corridor, and is offered only in the lap race's course picker. This entry is a pointer; the
  supersession is ADR 0065's.
