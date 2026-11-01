# ADR 0055: Place kinds and ranks from the corridor tiles already read, never a name — ADR 0054 D-2.2 superseded in part

- **Status**: **Accepted, 2026-10-25**, on the owner's ruling of that day on [#1631](https://github.com/openzigs/onyourleft/issues/1631), with D-8 Q1 (the rank gate, rank 9 and up) and Q2 (the town, village, hamlet and quarter points kept). Proposed 2026-10-24
- **Date**: 2026-10-24
- **Deciders**: **the owner**, on ruling (a) of 2026-10-24 on
  [#1628](https://github.com/openzigs/onyourleft/issues/1628), quoted in Context. Drafted by the
  author for that approval
- **Issue**: [#1631](https://github.com/openzigs/onyourleft/issues/1631), of the epic
  [#1628](https://github.com/openzigs/onyourleft/issues/1628) (an urban class per stretch of route)
- **Number**: **0055**, the next free number in
  [`docs/agents/conventions.md`](../agents/conventions.md) §7 on 2026-10-24, checked against the
  ownership table in [`docs/architecture.md`](../architecture.md). #1631 claimed it when it was
  filed; no other open issue or pull request names it (#1644 names it only to say it is #1631's)
- **Supersedes**: [ADR 0054](0054-towns-from-real-map-data.md) **D-2.2, in part** — for one layer,
  `places`, and from it three fields and a point, and nothing else. D-1 below says which sentences of
  D-2.2 stop holding and which still do. It also widens ADR 0054 **D-3.3**'s sentence of records by one
  kind (D-5). Every other decision of ADR 0054 stands
- **Relates to**: [ADR 0004](0004-privacy-and-location.md) D,
  [ADR 0012](0012-data-licence.md) D-3, [ADR 0013](0013-adr-amendments.md) (the pointer appended to
  ADR 0054), [ADR 0036](0036-a-self-hostable-instance-server-now.md) D-3 and D-7,
  [#1633](https://github.com/openzigs/onyourleft/issues/1633) (`urban-class.ts`, the class this is a
  prior for), [#1630](https://github.com/openzigs/onyourleft/issues/1630) (the spike its provisional
  numbers wait on)

---

## Context

### The ruling this records

The owner, 2026-10-24, ruling (a) on #1628: *"Infer an urban class per stretch of route (unknown /
rural / village / town / city centre) from data already read: footprint coverage, commercial land
share and tagged storeys. ALSO read the Protomaps `places` layer's kind and rank
(city/town/village/suburb), never the name. That reverses ADR 0054 D-2.2 … the plan must include an
issue for a new ADR that supersedes D-2.2 … and state the privacy reasoning: the rank only, no names,
nothing leaves the device."* This is that ADR.

### Why built form alone is not enough

`apps/web/src/game/urban-class.ts` (#1633) classes each 100 m window of the route from footprint
coverage, commercial land and mapped storeys. A downtown whose towers carry no mapped `height` reads
as `town` on those measures, however dense its footprints. The archive already says, in the same
tile bytes, that a city's locality point stands nearby. ADR 0054 D-2.2 forbade reading it because
`places` carries names. The decoder's design (`packages/map-features/src/schema.ts`: a key is only
compared with a fixed list, and no other value is ever turned into a string) can read a layer's kind
without its name, so the name was never the obstacle.

### What was read, and when

Read on **2026-10-24**.

| What | Where | Finding |
|---|---|---|
| The layer's fields | `https://docs.protomaps.com/basemaps/layers` (read as a summary, so secondary; the authority for every field is the `Places.java` row below, at a pinned commit) | `places`: `kind` (`country`, `region`, `locality`, `macrohood`, `neighbourhood`), `kind_detail`, `capital`, `population`, `population_rank` (integer), `wikidata`, and the names |
| How the archive writes them | protomaps/basemaps `tiles/src/main/java/com/protomaps/basemap/layers/Places.java` at [`c809cd18`](https://github.com/protomaps/basemaps/blob/c809cd1833/tiles/src/main/java/com/protomaps/basemap/layers/Places.java) (tiles 4.14.9, the last change to that file before the archive's 4.15.2, and identical to `main` on that day) | `place=city/town/village` becomes `kind=locality`; `place=suburb` becomes `kind=neighbourhood` with `kind_detail=suburb`; `place=quarter` becomes `kind=macrohood`. `kind_detail` is written from the OSM `place` tag. **The zoom table's default `maxzoom` is 15, and `locality`, `neighbourhood` and `macrohood` keep it** (only `country` and `region` stop earlier; the 99 in `getZoomsPops` is the fallback for a feature no rule matches). `population_rank` is `i + 1` for the highest of 18 population breaks the population reaches, so **1 to 18**, and a `wikidata` config row may override it. A label grid thins points: at z15, 16-pixel cells of at most 3 points each |
| Whether places reach the corridor's z15 tiles | The published archive `basemap-us-20260914.pmtiles`, decoded by hand with a throwaway script (never committed) that read only `kind`, `kind_detail` and `population_rank` and printed counts | The table below |

**The z15 sample, 2026-10-24.** Each corridor is a straight line through the place named, with ADR
0054 D-2.3's 300 m half-width, and the tiles are every z15 tile within 300 m of it — the tiles the
corridor read fetches. Counts only. *In the tiles* counts every place point in those tiles; *within
300 m* counts those inside the corridor itself. The names are of the sampled downtowns and suburbs, which are
public places and not any rider's; no coordinate is recorded.

| Corridor | z15 tiles | Tiles with a place point | `locality`/`city` in the tiles (within 300 m) | `neighbourhood`/`suburb` in the tiles (within 300 m) | `macrohood`/`quarter` (within 300 m) | `neighbourhood`/`neighbourhood` (within 300 m) | `population_rank` seen |
|---|---|---|---|---|---|---|---|
| Downtown: Chicago Loop, State Street | 10 | 10 | 1 (1) | 2 (1) | 2 (1) | 14 (8) | 1–13 |
| Downtown: Denver, 16th Street | 7 | 7 | 2 (0) | 0 | 0 | 24 (7) | 1–12 |
| Downtown: Minneapolis, Nicollet | 7 | 6 | 1 (0) | 1 (0) | 1 (1) | 6 (2) | 1–12 |
| Suburb: Naperville IL, Washington Street | 9 | 1 | 1 (1) | 0 | 0 | 0 | 9 |
| Suburb: Arlington VA, Wilson Boulevard | 9 | 7 | 2 (2) | 5 (4) | 0 | 4 (0) | 1–10 |

What it shows:

1. **Places do reach the corridor's z15 tiles**, so the prior is not inert from z15 alone. Every
   sampled corridor had a `city` locality or a `suburb` in its tiles; the nearest of them lay 0 to
   600 m from the line, to the nearest 100 m.
2. **A locality is one point, often outside the 300 m corridor.** In Denver and Minneapolis the city
   point is in a fetched tile but 400–600 m from the line. D-4's reach is measured from that point,
   and it can only find points in tiles already fetched.
3. **`city` does not mean downtown.** Both suburban corridors, which are suburbs in any rider's
   sense, have `city` localities within 300 m of the line (the sample did not read which places they
   are, by design). That is why D-4 makes the point a prior that can only lift a
   window already near the city threshold, never a class of its own.
4. **The commonest point is `neighbourhood`/`neighbourhood`**, which the list in D-2 does not admit.
   It marks a named neighbourhood in a city and in a town alike, and says nothing D-4 uses.

---

## Decision

### D-1 — What of ADR 0054 D-2.2 this supersedes, and what still holds

| ADR 0054 D-2.2 | After this ADR |
|---|---|
| *"Four layers"* | **Five**: `landuse`, `water`, `buildings`, `roads` and **`places`** |
| *"`pois` and `places` are not read"* | **Superseded for `places`**, for D-2's fields only. `pois` is still not read |
| *"they carry names, and the world names no place"* | **Still true.** No name from any layer is read (D-3), and ADR 0054 D-5.7, *"Nothing names a place"*, stands unchanged |
| *"From `buildings`, `addr_housenumber` is dropped on read"* | **Still true** |
| *"No OSM identifier is kept"* | **Still true**, and `wikidata` counts as one (D-3) |
| `water` is read for D-5's own rule | **Unchanged** |

### D-2 — What is read from `places`

1. **`kind`**, one of `locality`, `neighbourhood` or `macrohood`. Any other value (`country`,
   `region`, anything new) drops the point.
2. **`kind_detail`**, one of `city`, `town`, `village`, `hamlet`, `suburb` or `quarter`. Any other
   value (`neighbourhood`, `locality`, `isolated_dwelling`, `farm`, `allotments`, anything new), or
   none, drops the point. In the archive `place=suburb` is `kind=neighbourhood` with
   `kind_detail=suburb`, and `place=quarter` is `kind=macrohood` with `kind_detail=quarter`.
3. **`population_rank`**, an integer from **1 to 18** inclusive (Context: the archive writes 1 to 18,
   and a `wikidata` config row that overrides it is held to the same range). A value that is absent,
   not an integer, or outside that range drops the point; no `0` is admitted, as nothing cited writes one.
4. **The point's position**, projected into the corridor frame exactly as the other layers' geometry
   is. A `places` feature that is not a point drops.
5. **A bound on the count.** The decoder stops at a per-layer count of places, a new limit in
   `packages/map-features/src/limits.ts` that #1632 sets with its reason, as every other layer has.

### D-3 — What is never read

`name`, every `name:*`, every `pmap:*`, `wikidata`, `population`, `capital`, `sort_key` (and any
`sort_rank`), `min_zoom`, `ref` and the feature id. **They are excluded by construction, not by a
filter**: the decoder looks up only the three keys of D-2 in the `places` layer, so a value under
any other key is never turned into a string, and so cannot reach the store, a log or a message. This
is the design `schema.ts` documents for the other four layers and the trap ADR 0012 D-3 names.
`wikidata` is the identifier of a named place and counts as a name. `population` is not read
although `population_rank` is: the rank says how big, in eighteen steps, and the exact count would
single out one place.

### D-4 — From where: only the z15 tiles the corridor read already fetches

The `places` features are decoded from the bytes of the z15 tiles that ADR 0054 D-2.3 already
fetches for the corridor. **No extra request, no lower-zoom tile and no other host.** Reading
`places` from z10–z12 tiles (the research's option C on #1628) is **not admitted**: it adds requests
and widens the area disclosed under ADR 0054 D-6.1. Context's sample shows it is not needed. If the
archive ever stops carrying places at z15, the prior goes quiet (D-6 below says what that costs) and
the question returns to the owner; it does not become option C by default.

### D-5 — How it is used: a prior in `urban-class.ts`, and nowhere else

1. **Only as a prior, and only upwards from `town`.** A window that `urban-class.ts` §`classify`
   puts at `town`, and that is **borderline** — its footprint coverage at least
   `PLACE_PRIOR_MIN_COVERAGE`, **0.25** (at or above `TOWN_COVERAGE` 0.15, with **no upper bound**: a window of `CITY_COVERAGE` 0.35 or more that `classify()` still returns as `town`, for want of mapped heights, is the motivating case and must not be capped out) — is
   lifted to `city-centre` when a **lifting point** lies within `PLACE_PRIOR_REACH_METRES`, **800 m**,
   of the window's centre on the drawn road. Both numbers are provisional until #1630's readings, as
   every threshold in `urban-class.ts` is, and are named there beside the rule.
2. **A lifting point** is either a `locality` with `kind_detail` `city` and a `population_rank` of
   at least `PLACE_PRIOR_MIN_CITY_RANK`, **9** (a population of 100,000 or more by the archive's
   breaks), or a `neighbourhood` with `kind_detail` `suburb`, whatever its rank (an OSM suburb seldom
   carries a population). A `town`, `village`, `hamlet` or `quarter` point never lifts a window.
3. **Never the only signal.** A window with rural or village built form stays as it is, whatever
   places stand near it. A window with no corridor stays `unknown`, whatever places exist nearby,
   and an `unknown` window is never filled (#1633). The prior is applied to a window before
   `urban-class.ts`'s smoothing, so a lifted window still needs `URBAN_MIN_RUN_METRES` to stand.
4. **Never shown to the rider.** No label, HUD line, toast, credit or log names a place's kind,
   detail or rank. ADR 0054 D-5.7 stands, and a signpost still carries no words.
5. **The points that are held and lift nothing.** `town`, `village`, `hamlet` and `quarter` points
   are read and held because the list in D-2 is the owner's ruling. Their only permitted use, later,
   is as a further prior in `urban-class.ts` under D-5.3 and D-5.4; any other use is a change to
   this ADR. #1632 should prove these points are held and never shown.

### D-6 — Where it is held: the ODbL store `worldCorridors`

1. **In the existing store, as a fifth kind of record.** ADR 0054 D-3.3's sentence of records, as its
   amendment of 2026-10-22 has it, gains *"place points with `kind`, `kind_detail` and
   `population_rank`"*, and reads from this ADR's acceptance: building footprint polygons with `kind`,
   `height` and `min_height`; land-use polygons with `kind`; water polygons; footway lines with
   `kind` and `kind_detail`; street lines with `kind`, `kind_detail` and whether each is a bridge or
   a tunnel; place points with `kind`, `kind_detail` and `population_rank`; and which tiles were read
   and when — no OSM identifier, no name, no address.
2. **`CORRIDOR_READER_VERSION` is bumped**, from 2 to 3, so a row kept by an older reader is read
   again rather than trusted, as #1565 did. No Dexie schema change: the records travel in the
   existing packed `Blob` of `WorldCorridorRecord`.
3. **ADR 0054 D-3.1 to D-3.6 stand unchanged** for the new records: owner-scoped, ODbL 1.0,
   droppable without loss, never leaving the device, and attributed in the frame.
4. **No corridor, no class, no prior.** With no map data — outside the archive, offline, tiles off,
   inside a privacy zone, the stylised world — there are no place points and the world is today's
   (ADR 0054 D-4). If the archive carries no places at z15 for a route, the class is built form
   alone, as #1633 builds it today.

### D-7 — The privacy reasoning (owner ruling (a))

1. **The rank only, no names.** What is read says what kind of settlement is near, and roughly how
   big in eighteen steps, not which one. Names, `wikidata` and `population` are never decoded (D-3),
   so they cannot reach the store, a log or an error message.
2. **Nothing new leaves the device.** No new request is made (D-4): the `places` features are inside
   tile bytes already fetched under ADR 0054 D-6, so an observer of the network — the archive host,
   its CDN, or anyone on the path — sees exactly what it saw before. The records live in the ODbL
   store that never leaves the device (ADR 0054 D-3.5): not exported, not synced, not shared and not
   sent to an instance. `apps/web/src/privacy/world-corridor-never-sent.test.ts` and
   `apps/web/src/transfer/world-corridor-not-exported.test.ts` must run over a corridor that holds
   place points (#1632).
3. **A place point is location data.** It is a position on the route's corridor, like every other
   record in the store, so ADR 0004 D and ADR 0054 D-6.6 apply: a message about one names the field
   and the constraint and never its position, its tile's `z/x/y` or its kind.
4. **No instance and no map data lose nothing.** With no corridor there is no class and no prior,
   and the world is today's (ADR 0054 D-4). Nothing here involves `apps/instance` (CLAUDE.md §1,
   ADR 0036 D-3).
5. **No paid service** (ADR 0036 D-7): the bytes are those of the archive already configured.

### D-8 — What the owner is asked to rule on

1. **Q0 — Accept this ADR?** It stays Proposed until the owner's words on #1631, and its Status line
   is then changed to Accepted with that date, in the pull request that lands it or before it
   merges: a Status line cannot be changed by an amendment afterwards (ADR 0013).
2. **Q1 — Is D-5.2's rank gate wanted?** Recommended: **yes**, rank 9 and up, so that a `city`
   point does more than `kind_detail` alone; Context item 3 shows `city` alone marks suburbs too.
   Without it, `population_rank` is held and read by nothing.
3. **Q2 — Keep the `town`, `village`, `hamlet` and `quarter` points that lift nothing (D-5.5)?**
   Recommended: **yes**, as the ruling's list; dropping them is a smaller store and an equally valid
   answer.

---

## Consequences

### What this enables

- **A downtown with unmapped heights can still read as `city-centre`**, where its footprints are
  dense and a city or suburb point stands near the road, so #1628's city buildings appear where a
  city is.
- **#1632 has a document to be checked against.**

### What this costs

- **A fifth layer in the decoder** and a fifth kind of record in the ODbL store, with its own hostile
  fixtures, count limit and sentinel test.
- **Every stored corridor is read again once**, on the reader-version bump (D-6.2).
- **A prior can be wrong.** A suburb's `city` point next to a dense strip mall can lift a window to
  `city-centre`. D-5's borderline gate, the rank gate and smoothing bound how often; the cost of a
  wrong lift is taller buildings for a stretch, never a building where the map has none (ADR 0054
  D-5.1 still governs placement).

### Constraints this places on other work

| Issue | Constraint |
|---|---|
| [#1632](https://github.com/openzigs/onyourleft/issues/1632) | D-2 and D-3 in full, with the sentinel test that is red if `name` is read; D-2.5's limit; D-4's unchanged request count; D-5 with its named, provisional constants, including D-5.2's rank gate as the owner rules Q1; D-6.2's version bump in both directions; D-7.2's two tests over a corridor with places; the `records.ts` doc comment that lists place points |
| [#1630](https://github.com/openzigs/onyourleft/issues/1630) | Its readings may change `PLACE_PRIOR_MIN_COVERAGE`, `PLACE_PRIOR_REACH_METRES` and `PLACE_PRIOR_MIN_CITY_RANK`, as numbers, not the rules |
| Any future use of a place point | D-5.3 and D-5.4: a prior only, never shown. A name, a `wikidata` id or `population` is a change to this ADR |
| ADR 0054 | One appended entry under ADR 0013 pointing here, in the pull request that writes this ADR |

---

## What would make this ADR wrong

- **The archive stops carrying places at z15**, or moves them behind a coarser label grid. The
  prior then goes quiet (D-6.4); option C stays a separate decision with its disclosure measured.
- **The schema changes `kind_detail` or `population_rank`.** D-2 names 4.15.2's values; a new archive
  is checked against them before it is configured, as ADR 0054 says for its own fields.
- **A place's kind or rank turns out to identify it.** A high rank near a US route is one of a
  handful of cities. That is no more than the route's own footprints already say, and the store
  never leaves the device; if the store ever does leave it, this is one more reason ADR 0054 D-3.5
  is load-bearing.

---

## Amendments

Appended under [ADR 0013](0013-adr-amendments.md). Nothing above this line has been edited.

- **2026-11-01** — **D-6.1's sentence of records no longer lists every building field: see
  [ADR 0054](0054-towns-from-real-map-data.md)'s entry of this date**
  ([#1788](https://github.com/openzigs/onyourleft/issues/1788), on the owner's ruling D4 of
  2026-10-27 on [#1656](https://github.com/openzigs/onyourleft/issues/1656)). From
  [#1789](https://github.com/openzigs/onyourleft/issues/1789)'s decoder, the building footprints in
  `worldCorridors` also carry the twelve fields
  [#1557](https://github.com/openzigs/onyourleft/issues/1557)'s profile writes on z15 buildings,
  each a whitelisted value, a clamped whole number or a palette index, and each `null` where the
  configured archive carries none. ADR 0054's entry names each one as `BuildingFeature` stores it.
  D-6.1's sentence reads, from #1789: building footprint polygons with `kind`, `height` and
  `min_height`, and with the building type, levels, roof levels, roof shape, roof orientation, roof
  direction, wall colour, roof colour, wall material, roof material, start year and landmark flag;
  land-use polygons with `kind`; water polygons; footway lines with `kind` and `kind_detail`; street
  lines with `kind`, `kind_detail` and whether each is a bridge or a tunnel; place points with
  `kind`, `kind_detail` and `population_rank`; and which tiles were read and when — no OSM
  identifier, no name, no address. What still stands, unchanged: D-1 to D-8. The place points are
  read, held and used exactly as above, and no building field is a prior in `urban-class.ts` under
  this ADR.
