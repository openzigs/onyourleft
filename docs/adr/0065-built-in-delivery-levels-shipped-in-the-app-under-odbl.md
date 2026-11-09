# ADR 0065: Built-in Delivery levels — short town rounds with their houses baked in, committed and shipped in the app under ODbL 1.0, solo only, with their obstacle roster

- **Status**: **Accepted, 2026-11-08**, on the owner's
  [ruling of that day](https://github.com/openzigs/onyourleft/pull/2371#issuecomment-6723843813) on pull request #2371: Q0 accepted as written; and Q5 yes, 2 MiB a level
  file and 8 MiB for all of them, refused at build time and never trimmed to fit. The owner had
  answered #2359's four open questions the same day, in a
  [comment on #2360](https://github.com/openzigs/onyourleft/issues/2360#issuecomment-6722601585):
  Q1 (b), bake the house footprints into each level file; Q2 yes, an assisted finish unlocks the
  next level; Q3 yes, level rounds stay separate from the week's rounds; Q4 a crash costs points
  only. D-15 records each answer. Proposed 2026-11-08
- **Date**: 2026-11-08
- **Deciders**: **the owner**, on the rulings of 2026-11-08 quoted in #2359 (about six short town
  levels of 1.5 to 5 km on real OpenStreetMap streets and mapped houses, with our own names,
  unlocking in order, kept out of the owner's home area, with four phased kinds of obstacle) and the
  answers of the same day on #2360 (D-15). The owner chose (b) for Q1 where #2360 recommended (a);
  this ADR is written to the answer. The size ceilings of D-3 were the author's recommendation, put
  to the owner in D-15 Q5 and accepted. Everything else is the author's engineering reading of those rulings
- **Issue**: [#2360](https://github.com/openzigs/onyourleft/issues/2360), phase 0 of the epic
  [#2359](https://github.com/openzigs/onyourleft/issues/2359), a child of the Delivery epic
  [#1803](https://github.com/openzigs/onyourleft/issues/1803)
- **Number**: **0065**. On 2026-11-08 `main` (`5cbf6be4`) holds no `docs/adr/` file numbered 0065,
  and `docs/agents/conventions.md` §7 and `docs/architecture.md` both give 0065 as the next free
  number. No open pull request names it; the open issues that name it are this epic's own
  sub-issues, which point here. **0057 and 0058 stay claimed** by
  [#1748](https://github.com/openzigs/onyourleft/issues/1748) and
  [#1752](https://github.com/openzigs/onyourleft/issues/1752)
- **Supersedes**, in part and for the level files of D-2 and the level rounds of D-10 only:
  - [ADR 0064](0064-built-in-lap-race-circuits-shipped-in-the-app-under-odbl.md) **D-1**, where it
    says the supersession covers *"the circuit files of D-2 only"* and that *"Nothing else derived
    from an external source is committed"*; **D-6.2**, *"`ODbL-1.0` is admitted for that
    directory's JSON files and for nothing else"*; **D-7.2**, USGS 3DEP *"as a source for these
    files only"*; and **D-8.1**, a built-in course *"is offered only in the lap race's course
    picker"*;
  - [ADR 0032](0032-external-data-for-the-game-world.md) **D-1 item 2**, *"No dataset derived from
    an external source is committed for the game world"*, and the *"Still true"* that
    [ADR 0054](0054-towns-from-real-map-data.md) D-1's table gives it;
  - [ADR 0056](0056-the-demos-shipped-map-under-odbl.md) **D-2.4**, *"In the demo build only …
    never in `apps/web/dist`, the APK, the service worker's precache or `apps/web/public/`"*, for
    the app's built-in levels only (the owner's answer to Q1);
  - [ADR 0012](0012-data-licence.md) **D-4**, *"§4.6 is not the plan"*, for this one database, as
    D-4's last paragraph asks a successor to decide;
  - the roster rule of [#1811](https://github.com/openzigs/onyourleft/issues/1811), approved by the
    owner on 2026-10-28 and recorded in `apps/web/src/game/delivery/obstacles.ts`' header, *"No
    animal and no person is an obstacle"*. That rule is in a code comment, not an ADR, so it gains
    no amendment; [#2364](https://github.com/openzigs/onyourleft/issues/2364) rewrites the comment
    when it adds the first animal or person (D-10.6).

  Each superseded ADR gains one dated `## Amendments` entry pointing here, in this pull request
  (ADR 0013)
- **Relates to**: [ADR 0059](0059-delivery-a-parcel-round-game-mode.md) D-1, D-2, D-3 and D-4
  (**all unchanged**, D-11 and D-12); ADR 0054 D-2, D-3.3, D-3.5 and D-3.6; ADR 0056 D-2.1, D-3,
  D-4, D-6 and D-9; ADR 0064 D-2 to D-9; [ADR 0062](0062-we-build-our-own-basemap-archive-from-openstreetmap.md)
  (our own archive); [ADR 0038](0038-drafting-in-the-first-multiplayer-release.md) D-3.4 (no
  lateral offset in a room); [ADR 0004](0004-privacy-and-location.md) D;
  [ADR 0036](0036-a-self-hostable-instance-server-now.md) D-3 and D-7;
  [ADR 0015](0015-dependency-licences.md) D-2 and `ASSET004`; spike
  [0028](../spikes/0028-delivery-mark-and-patent-read.md) §4

---

## Context

### The rulings this records

The epic #2359 quotes the owner's rulings of 2026-11-08:

> 1. **Short town levels.** About 6 built-in Delivery rounds, 1.5–5 km each, on towns made from real
>    OpenStreetMap streets and mapped houses (ODbL), with invented names, the same way the lap
>    race's built-in circuits were made (#2293, ADR 0064, `apps/web/src/game/circuits/data/*.json`).
>    - They work with no saved routes and no instance.
>    - Levels unlock in order. Each one adds more houses, tighter timing and more hazards.
>    - Keep them out of the owner's home area. Never put coordinates or place names in public text.
>      The circuits' regions are private; choose new regions the same way, and record them only in
>      the private scratchpad.
> 2. **Obstacles, all four kinds, phased:**
>    - (a) static: parked cars and bins to steer round;
>    - (b) moving hazards with fair warning: dogs, cars pulling out, other riders;
>    - (c) tighter targets: smaller mailboxes, and houses that must not get a parcel;
>    - (d) weather and dusk: rain or low light that hides targets until the rider is closer.

And the owner's answers of the same day on #2360, to the epic's open questions:

> 1. **What a level ships: (b), bake the house footprints into each level file**, so a level works
>    fully offline from first launch. ADR 0065 supersedes ADR 0056 D-2.4 for the app's built-in
>    levels only, and says so. The APK and precache then carry a corridor-sized ODbL database per
>    level. The ADR records its size, the ODbL notice and attribution (as for the circuits), and
>    keeps the rule that **targets are never stored**: no seed in the file, targets picked per ride
>    by an in-memory seed (ADR 0059 D-4). The houses ship as footprints only, with **no OSM id,
>    address, street or place name**.
> 2. **Assisted unlocks:** yes. Finishing a level with the assisted setting on unlocks the next
>    (DL10, "no fail").
> 3. **Level rounds stay separate** from the week's rounds and do not change
>    `delivery-progress.ts`' week counts.
> 4. **A crash costs points only.** No slow-down of the drawn rider (ADR 0059 D-2.4 unchanged).
>
> Also confirmed: dogs and other riders are hazards, and contact is never drawn as harm to them.

### Why an ADR and not an amendment to ADR 0064

An `## Amendments` entry may record a fact that has become false, and **may not change a decision**
(ADR 0013 D-3). Shipping levels changes decisions in four ADRs and one owner-approved rule:

- ADR 0064 limited its supersession, its ODbL admission, its height source and its picker to the
  circuits. Levels are a second committed dataset derived from OpenStreetMap, in a second directory,
  offered in a second picker.
- ADR 0064 D-2.3 rejected a baked corridor for the circuits because ADR 0056 D-2.4 forbids one in
  the app. The owner's answer to Q1 bakes one for the levels, so D-2.4 is superseded for them.
- ADR 0012 D-4 declined §4.6 for the project's data; ADR 0056 and ADR 0064 each decided it for one
  database. The level files are a third.
- #1811's roster says no animal and no person is an obstacle. The ruling adds dogs and other riders.

So this is a new ADR that supersedes those points in part, and the amendments are the pointer
entries ADR 0013 asks the superseded ADRs to carry. That is the shape ADR 0056 and ADR 0064 took.

### Why a level needs its houses and a circuit did not

ADR 0064 shipped a circuit's line and heights only, and read its corridor from the archive per ride
(its D-2.2), because a lap race on the stylised world needs no corridor and a race with no archive
reachable is still a race. **A Delivery round with no houses is not a round**: its targets are picked
from the mapped houses the town draws (ADR 0059 D-4.1), and with too few the HUD says so and there is
nothing to play. A level read from the archive would therefore be unplayable on its first ride with
no network, and would draw a different number of houses after an archive refresh. Baking the houses
makes a level the same on every device and every ride, and playable with no network from first launch **in the Android shell**; in a browser, offline play is limited by the realistic asset set (D-8.4). It also lets the build tool
check its house count once, when the file is made, rather than the rider finding out.

### What exists today (read at `main` `5cbf6be4`)

- **Rounds**: `apps/web/src/game/delivery/round.ts` (`FIRST_DAY_HOUSES` 8, `MOST_HOUSES` 12,
  `FEWEST_DELIVERY_HOUSES` 3); the week in `delivery-progress.ts` (`localStorage`, counts only, the
  fields `DELIVERY_PROGRESS_FIELDS` names); the throw window in `throw.ts`
  (`THROW_WINDOW_BEFORE_METRES`, `THROW_WINDOW_AFTER_METRES`, and `ASSISTED_THROW_SCALE` for DL10).
- **Obstacles**: `obstacles.ts` (#1811, #1820): crossing obstacles dodged by timing, and standing
  obstacles in one seeded lane of `steer.ts` §`LANE_OFFSETS_METRES`, with at most one lane blocked
  at any distance; every placed obstacle avoidable at some speed from
  `AVOIDABLE_SLOWEST_METRES_PER_SECOND` to `AVOIDABLE_FASTEST_METRES_PER_SECOND`; the assist setting
  places fewer or none. A crash is `CRASH_SCORE_DELTA` and nothing else.
- **The circuits' precedent**: `apps/web/src/game/circuits/` (the reader `circuit-file.ts`, the
  loader `circuits.ts`, the `circuit:` route-id namespace that `@onyourleft/store` §`circuitRouteId`
  alone makes), the files and `LICENCE-ODbL.txt` in `circuits/data/`, their `ASSETS.toml` rows, and
  `scripts/check-repo-rules.sh` §`ASSET_DATABASE_DIR`, the one directory where `ASSET004` admits
  `ODbL-1.0`. The four circuit files are 8 to 22 KB each.
- **The corridor**: `world-data/corridor.ts` §`CORRIDOR_HALF_WIDTH_METRES`, **250** either side of
  the road.
- **The demo's baked corridors** (ADR 0056): two lines baked on 2026-10-25 and recorded in
  `apps/web/tools/demo/demo-routes.ts`: 11 km of a dense city centre at 1 906 428 bytes, and 25 km of
  open country at 450 720 bytes, for all four layers in the demo's packed binary shape. That is
  about 173 KB and 18 KB a kilometre. Its ceiling is `DEMO_ROUTE_MAX_BYTES`, 8 MiB a route.
- **The picker**: `apps/web/src/views/GameCoursesView.tsx`, reached from the Games tab (#2292).
- **The seam**: `delivery/delivery-cannot-reach-trainer.test.ts` (#1807) and #1816's
  byte-identical trainer-writes test.

---

## Decision

### D-1 — What this supersedes, and what still holds

| Decision | After this ADR |
|---|---|
| ADR 0032 **D-1 item 2**, and ADR 0054 D-1's *"Still true"* for it | **Superseded for the level files of D-2 only.** They are committed (D-7). Nothing else derived from an external source is committed beyond them and ADR 0064's circuit files. ADR 0032 D-1 items 1 and 3 hold: `game/` makes no request for them and no store persists them |
| ADR 0064 **D-1** (*"the circuit files of D-2 only"*; *"Nothing else … is committed"*) | **Superseded in part**: the level files are a second committed exception. Every row of ADR 0064 D-1 still holds for the circuits |
| ADR 0064 **D-2** (a circuit ships its line and heights only) and **D-2.3** (no baked corridor for a circuit) | **Unchanged for the circuits.** A level takes the shape D-2.3 rejected for them, for the reason Context gives |
| ADR 0064 **D-6.2** (`ODbL-1.0` at one directory only) | **Superseded in part**: admitted at a second directory, the levels' (D-7.1), and nowhere else |
| ADR 0064 **D-7.2** (USGS 3DEP for the circuit files only) | **Superseded in part**: also the height source of the level files (D-7.4) |
| ADR 0064 **D-8.1** (offered only in the lap race's course picker) | **Superseded in part**: levels are offered in the Delivery picker (D-8.1). A **circuit** is still offered only in the lap race's course picker, and a level never in it |
| ADR 0056 **D-2.4** (a baked corridor in the demo build only) | **Superseded for the level files only** (the owner's answer to Q1): each level's building layer is in `apps/web/dist`, the APK and the precache. The demo bundle stays in the demo build only, and D-5.1 (the demo bundle is never committed) still binds the demo bundle |
| ADR 0056 **D-2.1** (no OSM id, no name, no address) and **D-9** (CI uses the synthetic fixture) | **Carried over** to the level files (D-2.3, D-7.5) |
| ADR 0012 **D-4** (*"§4.6 is not the plan"*) | **Superseded for this one database**: §4.6 a, the entire database (D-6.4) |
| ADR 0054 **D-2** and **D-3.5** (`worldCorridors`, read per route and never leaving the device) | **Unchanged.** A level reads no corridor from the archive and writes nothing to `worldCorridors` (D-2.4) |
| ADR 0054 **D-3.6** (the ride's credit, keyed on the corridor) | **Extended, not superseded**: the credit is also keyed on a level, for the whole ride (D-6.5). Delivery runs only in the realistic world (ADR 0059 D-3.1), so no world that D-3.6 says shows none is touched |
| ADR 0059 **D-1 to D-5** | **Unchanged** (D-11, D-12, D-13), except **D-4.4** (what persists is counts only), which is **Extended, not superseded**: level progress also stores level ids (D-9.2), still no house, position or seed. D-2 is not reopened |
| #1811's roster (*"No animal and no person is an obstacle"*) | **Superseded for level rounds** (D-10). A round on a rider's own route keeps #1811's roster until the owner rules otherwise in the issue that proposes it, and D-10's rules bind that issue |

### D-2 — What a level ships: its line, heights, round parameters and the corridor's building footprints

1. **Per level, one plain JSON file** holding: the level's stable id and its own name; an ordered
   list of points (latitude, longitude, height) for its line, a loop or point to point (D-5); its
   length; the source of its heights (D-7.4, as `ElevationDataset` names one); the round's
   parameters (D-4); **the building footprints of the corridor around the line** (item 2); the
   archive build it was drawn from and its digest (D-5.3); and the licence fields of D-6.2.
2. **The buildings are footprints only** (the owner's answer to Q1): for each building in
   `CORRIDOR_HALF_WIDTH_METRES` either side of the line, its outline and the building fields the
   realistic world already reads for drawing it (ADR 0054 D-3.3 as its amendments list them), each a
   whitelisted value, a clamped whole number or a palette index. **No other layer is baked**: no
   land use, water, footway, side street or place point. The level's own line is its road; the rest
   of the town is drawn as the realistic world draws a corridor that carries no records of those
   kinds, and #2362's screenshots show what that looks like. Baking another layer widens a
   published database and is a change to this ADR.
3. **The rule an implementer tests. A level file holds no house list, no seed, no OSM id, no
   street or place name and no address.** *"No house list"* means: nothing in the file says which
   buildings are a round's houses, its targets, its no-delivery houses or its mailbox houses, in
   what order, or by what index. The buildings are map data; which of them a ride uses is picked per
   ride (D-4.2). The file also holds **no owner, no route id other than its own `level:` id, no
   device time and no tile coordinate list**. The reader **fails closed**: a file carrying any
   field outside the format's whitelist, at any depth, is refused, so an OSM id or a name added by a
   later authoring change is a red test and not a silent publication.
4. **A level reads no corridor from the archive**, and nothing of a level is written to
   `worldCorridors`. The buildings come from the file, so a level draws the same with or without a
   network, an archive or an instance. ADR 0054 D-2 and D-3.5 are not reached.
5. **Each level loads only when it is chosen**: a file or chunk of its own, never in the start-up
   bundle. The build issue states the mechanism.

### D-3 — Its size, and the ceilings

1. **Estimated, not yet measured.** No level is drawn on the day this is written. A building
   footprint with its fields is a few hundred bytes of JSON. From the demo's two measured bakes
   (Context: about 173 KB a kilometre for every layer of a dense city centre, 18 KB across open
   country, in a packed binary), a town level's building layer is expected to be **about 0.1 to
   1.5 MiB** of JSON at 1.5 to 5 km. How that was worked out, as assumptions and not
   measurements: a 500 m wide corridor (250 m each side) is 0.75 to 2.5 km^2 at 1.5 to 5 km; a
   town carries about 500 to 1,500 buildings a km^2; a footprint with its fields is about 300 bytes
   of JSON. That gives about 0.1 MiB (0.75 x 500 x 300 B) to about 1.1 MiB (2.5 x 1,500 x 300 B),
   and the 1.5 MiB upper figure leaves about a third for denser footprints. The 173 KB a kilometre
   is every layer in a packed binary and is not used in this sum, only as a sanity check that
   buildings alone are far smaller. The 2 MiB ceiling is about a third above 1.5 MiB. #2362's
   measured sizes replace all of this. At six levels, that is **about 2 to 6 MiB** together, before
   compression. The APK's zip and the network's gzip shrink JSON several times; the precache holds
   the files as served.
2. **The ceilings, set by the owner (D-15 Q5): 2 MiB for one level file, and 8 MiB for every level
   file together.** The build fails above either, as `vite.demo.config.ts` fails the demo build
   above `DEMO_ROUTE_MAX_BYTES`, and the build tool refuses to write a file over the first. A level
   over 2 MiB is redrawn shorter or elsewhere; the corridor is **not** narrowed to fit, because a
   narrower corridor is a different town from the one a route's world draws.
3. **The real sizes are stated in the pull requests that commit the files** (#2362, #2367), each
   with its file's bytes and building count, and the total. A raise of either ceiling needs the
   owner's approval in that pull request.

### D-4 — The round's parameters, and no house in the file

1. **Each file carries its round's parameters**: the number of houses on the round; the throw
   window (no wider than `throw.ts`' own, which the assisted setting still scales); the hazard mix
   (which kinds of D-10 the round places) and their density; the share of targets that are mailboxes
   (D-10.3); the share of the round's houses that must not get a parcel (D-10.3); and the weather and
   light (D-10.4). Each is range-checked by the reader, and an error names the field and the
   constraint, never a value that is a coordinate (ADR 0004 D).
2. **Targets are picked per ride, by a seed held in memory** (ADR 0059 D-4, unchanged): the round's
   houses, which of them are mailboxes and which must not get a parcel are all picked when the round
   starts, from the buildings the file supplies, by a seed from the platform's cryptographic random
   source that is never stored, exported, synced, logged or derived from anything stored. **So a
   public level file cannot recompute what a rider was given**, and a ride on a level stores no more
   than a ride on a route does.
3. **Levels rise in order** (the ruling): each later level has **more** houses than the one before
   (strictly, and never above `round.ts` `MOST_HOUSES`, so the first level starts low enough that
   six strictly rising levels fit under it), a throw window at least as tight, and at least the
   hazards of the one before, with **at least one of the three strictly harder**. The build issue's
   test reads the files and holds that, so two identical levels in a row fail it.

### D-5 — Length, shape and provenance

1. **1.5 to 5 km**, measured along the line. The reader refuses a file outside it. These are the
   level format's own bounds; `circuit-file.ts`' 3 to 8 km stay the circuits'.
2. **A loop or point to point.** A loop closes within `LOOP_CLOSURE_METRES`, as a circuit does; a
   point-to-point level ends the round at its last point. Either starts and ends at a public place
   (D-13.1).
3. **Each file records the archive build it was drawn from** (ADR 0062 D-1.4's build record) and a
   SHA-256 digest, as ADR 0064 D-6.3 does, so a redraw after an archive refresh is a reviewable
   commit and never a silent one.
4. **A level that cannot hold its house count is not committed.** The build tool counts the
   buildings the realistic world would make eligible as targets on the line, and refuses to write a
   level whose parameters ask for more. With the houses baked, the HUD's too-few-houses message is
   never reached on a level; it stays for a rider's own route.

### D-6 — Licence and attribution: ODbL 1.0, as for the circuits

1. **A level file is a Derivative Database of OpenStreetMap, and it is Publicly Conveyed**: its line
   follows the archive's mapped streets and its buildings are the archive's footprints, and the app is
   offered to anyone. Each file is offered **under ODbL 1.0** (§4.4 a.i), whether or not the extract
   is substantial, for ADR 0064 D-3.3's reason: a corridor's buildings over six levels are very likely
   more than the *Substantial* guideline's 100 features.
2. **§4.2 b: the licence travels inside each file and beside it**, with exactly ADR 0064 D-3.2's
   fields: the identifier `ODbL-1.0`, the URI `https://opendatacommons.org/licenses/odbl/1-0/`, the
   source (*OpenStreetMap contributors*, `https://www.openstreetmap.org/copyright`, through the
   project's own archive) and the §4.3 notice that ADR 0056 D-3.3 quotes. A `LICENCE-ODbL.txt` sits
   beside the files, and the notice in `apps/web/public/licences/` names the level files.
3. **§4.4 d: nothing incompatible is added.** The Contents the files add are the level's name and
   parameters, which are ours, and its heights, which are public domain (D-7.4).
4. **§4.6 a, the entire database: the files themselves**, plain JSON in the public repository at a
   stable path and in every build of the app, free of charge (ADR 0064 D-4.1), and the build carries
   its own compliance (ADR 0064 D-4.2). A screenshot or video of a level ride published outside the
   app carries, beside the credit, the stable repository URL of the levels' directory (ADR 0064
   D-4.3); where a place cannot hold a URL, the image is not published.
5. **The credit**: `© OpenStreetMap contributors`, from `apps/web/src/map/basemap.ts`
   §`OSM_ATTRIBUTION` and never a copy, **in the Delivery picker beside the levels** and **on the
   ride screen for the whole of a ride on a level**, because every frame draws the file's line and
   buildings. **The credits screen names the level files** beside the circuits' sentence
   (`CreditsView.tsx`). A published screenshot of a level ride, an owner-review one on a pull request
   included, shows the credit in the frame (ADR 0064 D-5.4).
6. **The ODbL governs the data, not the program.** The code that reads the files is
   `AGPL-3.0-or-later` by path.

### D-7 — Committed at one directory, with ODbL admitted there, authored by hand

1. **The files are committed at `apps/web/src/game/delivery/levels/data/`**, with
   `LICENCE-ODbL.txt` beside them. They are data, not source: no SPDX header, and **never under
   `packages/`**.
2. **`ODbL-1.0` is admitted at that directory's JSON files and nowhere else** beyond the
   circuits': `scripts/check-repo-rules.sh`'s `ASSET004` admission becomes the two directories, and
   each level file has an `ASSETS.toml` row (present, digest, licence, attribution and derivation,
   as the circuits' rows have). The repository rule that checks the circuits' in-file licence fields
   and notice file covers the levels' directory too.
3. **Authored by hand, outside CI.** A build tool a developer runs reads the archive's street lines
   and building footprints around a chosen start, writes the level, and drops every OSM id, name and
   address before writing. The level's layout, its name and its parameters are ours (D-12).
4. **The heights are USGS 3DEP**, sampled once along the line at authoring, with its name and
   resolution in the file, as ADR 0064 D-7.2 has it for the circuits. It is public domain (ADR 0032's
   table) and bare earth.
5. **Tests use a synthetic fixture level** wherever they draw or screenshot a ride (ADR 0056 D-9,
   ADR 0064 D-6.4), so no CI artefact is a Produced Work of a real level. A test may read the real
   files to check their shape, their licence fields, their bounds and the order of D-4.3.

### D-8 — Where levels are offered: the Delivery picker, solo, on the device

1. **Levels are listed in the Delivery picker, before the rider's own routes**
   (`GameCoursesView.tsx`), in unlock order (D-9). A level is **solo only** (DL9, ADR 0038 D-3.4):
   never a room's course and never in a room's course list, and a test asserts the room course list
   cannot hold one. A level is not offered for a lap race, a free ride or a workout, and a circuit
   is not offered for Delivery.
2. **A reserved `level:` route-id namespace**, followed by the level's stable id, names a level
   wherever the game keys a route. No saved route id and no `circuit:` id may carry it, and a test
   fails if a route id can start with it, as for `circuit:`.
3. **A level is not copied into the rider's records** (ADR 0064 D-8.2): not saved as a
   `RouteRecord`, not synced to an instance, not in *export everything* and not in a shared route.
   A ride on one names it by its `level:` id and records what any Delivery ride records. No instance
   ever holds a level (ADR 0036 D-3 (c) and (d) are not engaged).
4. **It works with no instance** (the ruling), and with no network **in the Android shell only**.
   The files are in the app and a level reads nothing from the archive (D-2.4), but Delivery runs
   only in the realistic world (ADR 0059 D-3.1), and in a browser the realistic asset set is
   excluded from the precache (`PRECACHE_EXCLUSIONS` in `apps/web/tools/precache/precache.ts`, ADR
   0026 D-7; `realisticWorldNotice` says it is not kept on the device for offline use). **So a
   browser rider with no network cannot play a level, with the buildings baked in or not.** The
   owner's Q1 (b) answer reads "fully offline"; this ADR holds it for the Android shell and for a
   browser that has the realistic set cached by use, and does not claim more. Putting the realistic
   set a level needs into the browser precache would reverse ADR 0026 D-7 for those assets, adding
   their whole size to the first-visit download; that is a decision for its own ADR and the owner,
   not made here. `apps/web/src/privacy/no-network.test.ts` is not widened.

### D-9 — Unlocks and progress, kept on the device

1. **Levels unlock in order.** The first is open; finishing a level opens the next. **Finishing
   with the assisted setting on counts** (the owner's answer to Q2; DL10, "no fail").
2. **Kept on the device, on `delivery-progress.ts`' pattern**: `localStorage` under a namespaced,
   versioned key, written field by field from a fixed list of fields, and a stored value this build
   cannot read reads as nothing unlocked beyond the first. It holds **level ids and counts only**:
   which levels are finished, and at most a best score per level. **No house, no index into a level's
   buildings, no position and no seed.** It is not in the ride record, not synced and not exported.
3. **Level rounds are separate from the week's rounds** (the owner's answer to Q3): a level round
   neither reads nor changes `delivery-progress.ts`' day, houses or week score, and a test holds the
   week unchanged across a level ride.

### D-10 — The roster, for level rounds

The four kinds, phased by #2362 to #2366:

1. **Static**: parked cars and bins, standing in one lane at the kerb, steered round. #1811's rule
   holds: at most one lane is blocked at any distance.
2. **Moving, with fair warning**: dogs, cars pulling out and other riders. This **supersedes
   #1811's *"No animal and no person is an obstacle"*** for level rounds (the ruling).
3. **Tighter targets**: smaller mailboxes, and houses that must not get a parcel.
4. **Weather and dusk**: rain or low light that hides a target until the rider is closer.

Rules every kind keeps:

5. **A parcel at a no-delivery house costs points and never rewards damage** (ADR 0059 D-1.4). The
   house is told apart in words and by shape, never by colour alone.
6. **No contact with a dog or a person is drawn as harm to them.** A contact costs the rider points
   (D-11), and the dog or the person is drawn carrying on unhurt: no fall, no injury, no cry of pain
   and no sound or image of one. Nothing scores for touching either. #2364 rewrites `obstacles.ts`'
   roster comment when it adds them.
7. **"Other riders" are drawn figures**, part of the level's hazards. They are not the pacer, not a
   lap-race bot and not another rider's data, and they keep out of the pacer's place in the
   foreground (#1863).
8. **Every hazard can be avoided across ADR 0059's speed range**, from
   `AVOIDABLE_SLOWEST_METRES_PER_SECOND` to `AVOIDABLE_FASTEST_METRES_PER_SECOND`, at every drawn
   line, and a test sweeps it as `obstacles.test.ts` does today.
9. **Every hazard is announced in words before it reaches the rider**, through the live region, at
   a distance that leaves time to act at the fastest of that range (the lap race's
   `PUDDLE_WARNING_METRES` is the precedent; #2364 sets and tests the number). A hidden target is
   revealed early enough that its throw window can be reached at that speed. No warning is carried
   by colour or sight alone.
10. **The assisted setting covers every new pressure** (DL10): fewer or no hazards, no hidden
    targets, and no fail.

### D-11 — The trainer: ADR 0059 D-2 is unchanged, and not reopened

**A crash, a contact, a hazard, a miss, the weather, the light, an unlock and a level's parameters
change nothing the trainer is sent, or when.** A crash costs points only (ADR 0059 D-2.4, the
owner's answer to Q4): no slow-down of the drawn rider. A level's heights are its road, and the
trainer gets that road's grade at the rider's distance exactly as on a route; rain and dusk are a
drawing and never a grade, a resistance or an ERG target. This ADR does not reopen D-2: a virtual
slow-down would need a superseding ADR 0059 D-2. `delivery-cannot-reach-trainer.test.ts` (#1807)
stays green **unmodified** with every level module inside its walk, and each issue that changes a
ride extends #1816's test: the same power trace, with and without that change, sends byte-identical
trainer writes at identical times.

### D-12 — IP: our own roster and layouts (ADR 0059 D-1)

The roster of D-10, every level's layout, its name and its parameters are this project's own. None
is traced, transcribed or recreated from the arcade game spike 0028 §4 reads, from its sequels or
ports, or from any other game. No newspapers, no *"subscriber"* word, no reward for breaking
windows or damaging property, and no arcade game named. A level's name is ours and is not a place
name. New rider-facing words are approved by the owner in the pull request that adds them; this ADR
proposes none.

### D-13 — Privacy (ADR 0064 D-9, carried over)

1. **Every level runs on public roads and starts and ends at a public place**, chosen as no
   person's home and not beside one. **No level is drawn in or near the owner's home area.**
2. **The regions are named nowhere public**: not in an issue, a pull request, a commit message, a
   review, this ADR, `docs/`, an `ASSETS.toml` row or a rider-facing word. **They are recorded only
   in the private scratchpad.** The files' own points and outlines are the only coordinates.
3. **An error about a level names the field and the constraint and never the value** (ADR 0004 D),
   in the build tool, the reader and the repository rule alike.
4. **Which house got a parcel is still never stored, exported, synced or logged** (ADR 0059 D-4),
   and #1817's test is extended to a level ride.

### D-14 — This is not a legal opinion

ADR 0012 D-6's rule, ADR 0056 D-11's and ADR 0064 D-10's, for the same reason: no lawyer was
consulted. The ODbL clauses this relies on are the ones ADR 0056 read first-hand on 2026-10-24.

### D-15 — What the owner was asked, and the answers

Q1 to Q4 were #2359's open questions, carried to #2360 and answered there on 2026-11-08 in a
[comment](https://github.com/openzigs/onyourleft/issues/2360#issuecomment-6722601585). Q0 and Q5
were asked in this pull request and answered there on 2026-11-08 in a [comment](https://github.com/openzigs/onyourleft/pull/2371#issuecomment-6723843813).

1. **Q0 — Accept this ADR before it merges, or merge it as Proposed?** Recommended: **accept before
   merge**; the pull request flips the Status line. **Answered: accepted**, *"ADR 0065 is accepted
   as written"*; the Status line says Accepted.
2. **Q1 — What does a level ship: (a) the line, heights and round parameters only, with the houses
   read from the published basemap's corridor per ride under the `level:` namespace (ADR 0064
   D-2.2), or (b) also the house footprints baked into each file, superseding ADR 0056 D-2.4 for the
   app?** Recommended by #2360: **(a)**, because it ships no corridor-sized database in the APK and
   precache; its cost was that a level with no corridor read yet, and no network, falls back to the
   HUD's too-few-houses message. **Answered: (b)**, *"so a level works fully offline from first
   launch"*, with footprints only and no OSM id, address, street or place name. D-2 and D-3 are
   written to it.
3. **Q2 — Does finishing a level with the assisted setting on unlock the next?** Recommended:
   **yes** (DL10, "no fail"). **Answered: yes** (D-9.1).
4. **Q3 — Are level rounds separate from the week's rounds?** Recommended: **yes**. **Answered:
   yes** (D-9.3).
5. **Q4 — A crash on a level: points only, or a slow-down?** Recommended: **points only** (ADR 0059
   D-2.4). **Answered: points only** (D-11).
6. **Q5 — The size ceilings of D-3.2: 2 MiB a level file and 8 MiB for all of them?** Recommended:
   **yes**, about the estimate's upper end with room for six levels, and well under the demo's
   8 MiB a route. **Answered: yes**, 2 MiB per level file and 8 MiB for all the level files
   together; a level over either ceiling is refused at build time, and its corridor is never
   narrowed to fit (D-3.2).

---

## Consequences

### What this enables

- **#2361 can be built**: a level format, a reader that fails closed, and a build tool, with a
  document to be checked against. #2362 to #2367 follow it.
- **A rider with no saved route and no instance can play Delivery at once**, on a real town, the
  same on every ride, and in the Android shell with no network either. A browser rider with no
  network cannot (D-8.4).

### What this costs

- **A third Publicly Used ODbL database, and the largest**: a corridor's buildings per level, in
  `apps/web/dist`, the APK and the precache, under §4.2, §4.3, §4.4 and §4.6 for every release for as
  long as the files ship.
- **More OpenStreetMap-derived data in the permanent history.** A mistake in a committed file cannot
  be withdrawn by a later commit; D-2.3's fail-closed reader, D-5.3's digest and D-13 are why the
  files are reviewed before they land.
- **Up to 8 MiB more in the app** (D-3.2) and its precache, loaded per level.
- **A level does not pick up archive improvements.** It is redrawn by hand, as a new commit.
- **A level draws no land use, footway or side street from the map** (D-2.2); those parts of its
  town are procedural.

### Constraints this places on other work

| Issue | Constraint |
|---|---|
| [#2361](https://github.com/openzigs/onyourleft/issues/2361) | D-2 (the file's fields, the fail-closed reader, per-level loading), D-3.2's ceilings in the build, D-4.1's ranges, D-5's bounds and provenance, D-6.2's licence fields, D-7 (the directory, `ASSET004`, the repository rule, the build tool, 3DEP, the fixture level), D-8.2's reserved namespace and its test, D-13.3 |
| [#2362](https://github.com/openzigs/onyourleft/issues/2362) | D-3.3's sizes in the pull request, D-6.5's credits, D-8.1 (first in the picker, solo, the room-list test), D-8.3, D-10.1, D-11, D-13 (regions in the private scratchpad only) |
| [#2363](https://github.com/openzigs/onyourleft/issues/2363) | D-9 |
| [#2364](https://github.com/openzigs/onyourleft/issues/2364) | D-10.2 and D-10.5 to D-10.10, the warning distance of D-10.9, the rewrite of `obstacles.ts`' roster comment, D-11 |
| [#2365](https://github.com/openzigs/onyourleft/issues/2365) | D-10.3, D-10.5, D-10.10, D-4.2 (mailboxes and no-delivery houses picked per ride), D-11 |
| [#2366](https://github.com/openzigs/onyourleft/issues/2366) | D-10.4, D-10.9's reveal distance, D-10.10, D-11 (weather is never a grade) |
| [#2367](https://github.com/openzigs/onyourleft/issues/2367) | D-3.3, D-4.3 (each level rises), D-5.4, D-13 |
| `docs/odbl.md` | Lists the level files as a Publicly Used database when the first one lands (#2362) |
| ADR 0064, ADR 0032, ADR 0054, ADR 0056 and ADR 0012 | Each gains one appended entry under ADR 0013 pointing here, in this pull request |

---

## What would make this ADR wrong

- **A level is offered in a room.** That is DL9 and ADR 0038 D-3.4, and needs its own ADR first.
- **A crash slows the drawn rider.** That reopens ADR 0059 D-2 and needs a superseding ADR.
- **The file needs a name, an address or another layer**, for a caption or a richer town. That is a
  change to D-2, and for a name to ADR 0054 D-2.2 and ADR 0055 D-3 too.
- **The measured sizes are far over the estimate of D-3.1**, so that six levels do not fit the
  ceilings. Then the shape of D-2 (JSON, the corridor's width) is reopened, here and not in a build
  script.
- **The ODbL text, the OSMF's guidance on games, or USGS 3DEP's terms change.** The dates are there
  for that reason.

## Sources

| What | Where | Read |
|---|---|---|
| The owner's rulings on levels and obstacles | [#2359](https://github.com/openzigs/onyourleft/issues/2359), its body | 2026-11-08 |
| The owner's answers to Q1 to Q4 | [Comment on #2360](https://github.com/openzigs/onyourleft/issues/2360#issuecomment-6722601585) | 2026-11-08 |
| ODbL 1.0 §1.0, §4.2, §4.3, §4.4 and §4.6, verbatim | ADR 0056's Context, read first-hand from <https://opendatacommons.org/licenses/odbl/1-0/> | 2026-10-24 |
| The demo's two measured bakes and their ceiling | `apps/web/tools/demo/demo-routes.ts` §`DEMO_ROUTE_MAX_BYTES` | 2026-11-08 |
| The circuits' format, files, rows and repository rule | `apps/web/src/game/circuits/`, `ASSETS.toml`, `scripts/check-repo-rules.sh` §`ASSET_DATABASE_DIR` | 2026-11-08 |
| The roster rule superseded | `apps/web/src/game/delivery/obstacles.ts`, its header's *"Our own roster (DL1)"* | 2026-11-08 |

## Amendments

Appended under [ADR 0013](0013-adr-amendments.md). Nothing above this line has been edited.

- **2026-11-08** — **`ASSET_DATABASE_DIR` is now `ASSET_DATABASE_DIRS`.** Context's *What exists
  today* and the Sources table cite `scripts/check-repo-rules.sh` §`ASSET_DATABASE_DIR`, the one
  directory where `ASSET004` admitted `ODbL-1.0` when this was written. #2361 (pull request #2372),
  building D-7.2, made it a list of the two directories and renamed it `ASSET_DATABASE_DIRS`. Read
  each `§ASSET_DATABASE_DIR` above as `§ASSET_DATABASE_DIRS`. No decision changes. Recorded by
  #2362.
- **2026-11-08** — **A level is listed and ridden in the realistic world whatever Settings chose.**
  The owner's ruling on pull request #2378 ([#2362, comment of
  2026-11-08](https://github.com/openzigs/onyourleft/issues/2362#issuecomment-6727623184)): the
  built-in rounds are always listed in the Delivery picker, with the standard world chosen too.
  Choosing one rides it in the realistic world **for that ride only**, and the rider's Settings
  choice is never written. A rider's own route keeps DL6 (ADR 0059 D-3.1): with the standard world
  chosen it offers no round. **Its relation to ADR 0026 D-7:** that decision's
  heading fetches realism *"when the rider asks for it"*, and its body says *"when the rider chooses
  the realistic world (D-3)"*. A press on a level is recorded here as the rider asking for it, for
  that ride. In a browser the press therefore downloads the realistic set, which is still excluded
  from the precache and still not kept for offline use. The level's setup says so in the browser
  only. Inside the Android shell the set ships in the APK and nothing is downloaded. D-7's fallback
  holds unchanged: if the set cannot be loaded, the ride is in the standard world and the ride
  screen says so. No other decision changes. Recorded by #2362.
