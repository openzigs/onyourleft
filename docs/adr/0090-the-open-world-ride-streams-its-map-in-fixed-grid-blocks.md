# ADR 0090: The open-world ride streams its map in fixed-grid blocks while it rides, keeps what it rode on the device, and reads inside the rider's own privacy zone

- **Status**: **Proposed**, 2026-11-19, on the owner's rulings of 2026-11-19 on the epic
  [#2880](https://github.com/openzigs/onyourleft/issues/2880). Accepted only on the owner's approval
  on its pull request. D-9 lists the questions for the owner
- **Date**: 2026-11-19
- **Deciders**: **the owner**, whose rulings of 2026-11-19 are quoted in Context. **The author**
  chose the block size, the lead and the cache rules within those rulings; each such choice is
  marked *the author's choice*
- **Issue**: [#2884](https://github.com/openzigs/onyourleft/issues/2884), Phase 0 of the epic #2880
- **Number**: **0090**. The owner's lane note of 2026-11-19 on #2884 reserved 0086 for this ADR,
  0087 for #2885, 0088 for #2887 and 0089 for #2888. **0086 was already ADR 0086** (#2869, merged
  that day), so this ADR takes the next number after the other three reservations, which stand. On
  2026-11-19 the open pull requests [#2873](https://github.com/openzigs/onyourleft/pull/2873) (0081),
  [#2864](https://github.com/openzigs/onyourleft/pull/2864) (0083),
  [#2863](https://github.com/openzigs/onyourleft/pull/2863) (0084) and
  [#2872](https://github.com/openzigs/onyourleft/pull/2872) (0085) each write one, and 0082 and 0086
  are written
- **Supersedes, in part, for open-world rides only**:
  [ADR 0054](0054-towns-from-real-map-data.md) **D-2.3** (the corridor only), **D-2.4** (no request
  for the world while a ride is recording) and **D-6.3** (no tile touching a privacy zone is
  requested). **Extends** ADR 0054 **D-3** (the ODbL store) to a cache of ridden blocks (D-6 here).
  ADR 0054 gains one dated `## Amendments` entry pointing here; its body is not edited
  ([ADR 0013](0013-adr-amendments.md) D-2, D-3)
- **Leaves standing, for every ride**: ADR 0054 D-2.1 (one origin, the configured archive), D-2.2
  (the layers and fields read), **D-2.5** (one module, one `fetch`; D-3 here), D-3.1 to D-3.6, D-4,
  D-5, D-6.1, D-6.2, D-6.4 to D-6.6 and D-7. **For route rides, every word of ADR 0054**: a route
  ride keeps its corridor, read once, before the ride
- **Relates to**: [ADR 0004](0004-privacy-and-location.md) B, C and D;
  [ADR 0036](0036-a-self-hostable-instance-server-now.md) D-3 and D-7;
  [ADR 0032](0032-external-data-for-the-game-world.md) D-4; ADR 0087 (#2885, real heights, which
  reads its height tiles on the grid D-2 fixes); the spike
  [#2882](https://github.com/openzigs/onyourleft/issues/2882) (the rolling route on the tablet,
  which measures what D-2 estimates)

---

## Context

### The rulings this records

The owner asked on 2026-11-19 whether an open world is possible: *"Can we allow the user to pick an
address to start from and ride and be able to turn on streets and have the buildings and roads render
properly?"* The research that followed put seven questions. Three of the owner's answers, all of
**2026-11-19** and recorded on #2880, decide this ADR. Verbatim:

> **Q1, map data: "I would like stream as you ride."**

Asked with it whether downloads cost money, the owner was told that R2 egress is $0 and Class B
reads are $0.36 a million after 10 million free a month (`docs/cost-model.md`), and that a streamed
ride is a few hundred tile reads an hour, an estimate.

> **Q2, privacy zones: "Yes, device-only (Recommended)"**

Asked as: a free ride may read the real map inside the rider's own privacy zone, requested as coarse
fixed blocks (never centred on home), never logged; recorded rides are still trimmed by zones when
shared.

> **Q6, range: "Anywhere in the US (Recommended)"**

Asked as: stream wherever the rider goes, limited only by the US-only basemap; keep ridden tiles on
the device for next time.

### Why ADR 0054 cannot carry an open-world ride as written

ADR 0054 reads **a route's corridor, once, before the ride** (D-2.3, D-2.4). Its reason is stated in
D-2.4: *"the disclosure is one corridor, once, and not a sequence of positions for an hour."* An
open-world ride has no route in advance. The rider chooses each street at its junction (#2887), so
the world ahead is not known until the ride is under way, and there is no corridor to read before it.
The only ways to draw real streets round a rider who may turn anywhere are to hold the whole area in
advance (a region download, which Q1 rejected in favour of streaming and Q6 widened to the whole US)
or to read it as the rider goes. Q1 chose the second. That is exactly the disclosure D-2.4 was
written to prevent, and the owner has accepted it for this mode. This ADR records that acceptance,
says plainly what it costs, and binds the mitigations.

ADR 0054 D-6.3 asks for no tile that touches one of the rider's privacy zones, and draws the world
there procedurally. An open-world ride that starts at home, which is where most rides start, would
then have no real streets to choose between at its first junction. Q2 lets it read them.

### What is in the code today

- `apps/web/src/world-data/corridor-source.ts` is **the one module** that asks the basemap archive
  for anything the world draws. It issues byte-range requests on the one archive URL
  `apps/web/src/map/basemap.ts` §`readBasemapConfig` resolves, with `credentials: 'omit'`, never a
  `z/x/y` URL, through its own single `fetch`, and `apps/web/src/privacy/no-network.test.ts` pins it
  at exactly one (`PERMITTED_NETWORK_CALLS`).
- `apps/web/src/game/world-data/corridor.ts` §`describeCorridorFailure` is the only place a corridor
  failure becomes words, and the words name what failed and never a tile or a coordinate.
- `apps/web/src/privacy/world-corridor-never-sent.test.ts` and
  `apps/web/src/transfer/world-corridor-not-exported.test.ts` prove that the corridor store
  (`worldCorridors`) reaches no instance payload and no export.
- `apps/web/src/map/tiles-preference.ts` is the map-tiles switch, which governs the corridor read
  (ADR 0054 D-6.4).
- The fog ends at **400 m** (`apps/web/src/game/terrain.ts` §`VIEW_AHEAD_METRES`) and mapped
  buildings are placed within 300 m of the road (ADR 0054 D-2.3).

---

## Decision

### D-1 — Scope: open-world rides only

Every rule here applies to an **open-world ride**: a ride with no route chosen in advance, whose road
is the street graph round the rider (#2880). A route ride, a workout on a route, a lap race and a
Delivery level are not open-world rides, and nothing here changes how they read the map. A route ride
still reads its corridor once, before the ride, and asks nothing while it records.

### D-2 — The grid: the rider's block and the eight round it, read as the rider crosses blocks

1. **A block is one z14 tile of the archive's own tiling**, read as its four z15 tiles. It is fixed
   to the archive's grid and never to the rider, the start or home. *The author's choice*: a z14
   tile is 2.4 km × cos(latitude) across, which is about **2.2 km at 25° N, 1.9 km at 40° N and
   1.6 km at 49° N**, twice the z15 tile ADR 0054 D-6.1 calls the precision a single tile read
   reveals.
2. **What is requested is a function of the rider's block alone.** While an open-world ride is
   under way, the reader holds the **3 × 3 blocks** centred on the block the rider is in. When the
   rider enters a new block, the blocks of the new 3 × 3 that are neither held nor cached (D-6) are
   requested; nothing else is. Two positions inside one block produce the same requests, and a
   position's place inside its block changes nothing that is sent.
3. **The lead is at least one block.** With the rider anywhere in the centre block, every point less
   than one block width away is held, so the nearest edge of what is held is at least **1.6 km**
   off, about 2 min 24 s at 40 km/h. That is four times the 400 m fog, so a block is read long before
   anything in it is drawn. A **start** requests the start's 3 × 3, 36 z15 tiles, before the ride
   begins.
4. **Tile reads, estimated, not measured**: at a steady 40 km/h in a straight line a rider crosses a
   1.9 km block about every 2.8 min, about 21 times an hour, and each crossing asks for 3 new blocks
   (5 on a diagonal), 12 to 20 z15 tiles. That is **about 250 to 420 tile reads an hour**, plus the
   archive's directory reads, and fewer where a block is cached or the rider turns back. The spike
   #2882 measures it. A measurement that keeps the block a z14 tile or coarser changes only this
   paragraph's figures and may be recorded by an amendment; **a finer block is a new decision**
   (ADR 0013 D-3), because it sharpens what the host learns (D-4).

### D-3 — One module, one `fetch`, as ADR 0054 D-2.5 already says

The streamed reads are made by `apps/web/src/world-data/corridor-source.ts`'s existing
`archiveSource`, so its `PERMITTED_NETWORK_CALLS` entry stays `primitive: 'fetch', count: 1`, and
`no-network.test.ts` stays an exact list. If #2890 finds the reader cannot share that module, it may
add **exactly one** more entry, for one new module outside `game/`, and the pull request that adds it
names this decision. No `fetch` is handed to a dependency (ADR 0054 D-2.5's reason holds). The same
rules hold every request: a `Range` header on the one archive URL, no coordinate, route id, athlete
id, credential or cookie, and never a `z/x/y` URL (ADR 0054 D-6.1). It is not instance traffic:
ADR 0036 D-3(a)'s *"exactly one module for instance traffic"* is untouched.

### D-4 — The privacy consequence, stated plainly

**While an open-world ride is recording, the tile host — `tiles.openzigs.com` by default, or a
self-hoster's own archive — sees a sequence of byte-range reads that follows where the rider goes,
block by block, for the length of the ride.** The ranges are a function of location, so the host can
tell which blocks were read, in what order and when, from the same IP address a map view already
sends. That is the disclosure ADR 0054 D-2.4 was written to prevent, *"one corridor, once, and not a
sequence of positions for an hour"*, and this ADR makes it, for this mode, because the owner accepted
it in Q1.

What the host learns, and what it does not:

- **It learns** the rider's path at block precision (about 1.6 to 2.2 km), the time each block was
  entered, to within the reader's own scheduling, and so a rough speed. On a first ride from home it
  learns that the ride began somewhere in the centre block of the first request, which is where home
  is to within one block. A cache (D-6) means a second ride from home asks nothing for the blocks it
  already holds, but the first ride's disclosure has happened.
- **It does not learn** the rider's position inside a block, the start point inside its block, any
  coordinate, the rider's identity (no credential, no cookie, no athlete id), the privacy zone, or
  anything recorded.
- **A rider who wants none of this turns map tiles off** (D-7), and the open-world ride then asks
  nothing.

### D-5 — The mitigations, each a rule an implementer tests

| Rule | What a test holds |
|---|---|
| **R-1. Fixed grid, never centred.** A request is for whole blocks of the archive's z14 grid, and the set requested is a function of the rider's block alone (D-2.2) | Two positions in one block, anywhere in it, give the identical request sequence; the start point, a privacy zone's centre and the rider's position never appear in a request's derivation except through their block |
| **R-2. No coordinate, tile `z/x/y` or block id in any log, error, toast or crash report** (ADR 0004 D) | Every failure the reader and the cache can raise is described through one function, as `describeCorridorFailure` is, and a test drives each failure with a fixture whose coordinates and ids are known and asserts that none of them, in any spelling, is in the words |
| **R-3. Inside a privacy zone, blocks are read the same way** (Q2). The zone never leaves the device, and the reader does not read it: the request sequence does not depend on whether a zone exists | The same ride with and without a zone over its start gives the identical request sequence. This is stricter than D-6.3's hole, which showed the host where something was hidden |
| **R-4. A recorded open-world ride is trimmed by zones when shared** (ADR 0004 B and C), exactly as any ride is | #2906's test: a shared open-world ride starting inside a zone has no point inside it |
| **R-5. The cache is location data and stays on the device** (D-6) | The never-sent and not-exported tests named in D-6.4 fail if a cached record reaches any payload |
| **R-6. Map tiles off: nothing is requested** (D-7) | With the switch off, an open-world ride makes no request at all, cached or not |
| **R-7. A disclosure that is accurate.** `apps/web/src/privacy/boundaries.ts` declares the streamed read `departing`, and says in its own words that it follows the rider block by block; `docs/privacy-policy.md` and `apps/mobile/src/android/data-safety.ts` say so too (ADR 0054 D-6.5's precedent) | The pull request that first sends a streamed request (#2890) changes all three, and re-checks data-safety's two facts: the retained record holds no `Range` field, and every request names one file |

### D-6 — The ridden-block cache: ADR 0054 D-3, extended

1. **What is kept.** The decoded records ADR 0054 D-3.3 (as amended) names, for each block read in an
   open-world ride, with the block's key and when it was read and last ridden. **Never the raw tile
   bytes**, which carry names and addresses ADR 0054 D-2.2 drops on read.
2. **Where.** Its own object store in `packages/store`, or `worldCorridors` keyed per block; either
   way one entry per **(owner, block)**, read only through a call that takes the owner, and entered in
   `packages/store/src/activity-store.scoping.test.ts`'s derived enumeration (CLAUDE.md §6,
   cross-athlete exposure). A schema change carries a tested `up` and `down` (`packages/CLAUDE.md`
   §5).
3. **Declared ODbL 1.0, a Derivative Database of OpenStreetMap**, exactly as ADR 0054 D-3.2 declares
   the corridor store, and held on the same single reason: it is never published.
4. **Nothing in it leaves the device.** Not in an activity export, not in *export everything*, not in
   instance sync, not in a shared route, not in a ride write-up's context.
   `apps/web/src/privacy/world-corridor-never-sent.test.ts` and
   `apps/web/src/transfer/world-corridor-not-exported.test.ts` (or siblings derived from the same
   payload builders) cover it with a populated cache. A change that sends any of it anywhere is a
   change to this ADR and to ADR 0054.
5. **Bounded, and evicted.** The cache has a fixed ceiling, and when it is reached the
   least-recently-ridden blocks go first. #2891 states the ceiling with a measurement of a block's
   decoded size; it is never unbounded.
6. **Erased** with the rider's data and by the device erase, and **droppable without loss**: deleting
   it costs a re-read and never a ride, a route or a setting.
7. **Read before the network.** A block in the cache is never requested again while it is there, so
   the cache is a privacy measure as well as a cost one.

### D-7 — Map tiles off, offline, or outside the US

1. **The map-tiles switch governs the streamed read** as ADR 0054 D-6.4 makes it govern the corridor:
   with tiles off, nothing is requested.
2. With tiles off, or offline, an open-world ride **rides only what is cached**. If the start's own
   block is not cached, the picker (#2889) says the open-world ride needs map tiles or a place it has
   ridden before, and offers nothing that would request. Where the held area ends, the ride treats it
   as the edge of the map (#2908).
3. **Outside the archive's coverage** (everywhere outside the US) there is nothing to read, and the
   ride treats the coverage's edge as the edge of the map (#2908). This is Q6: anywhere in the US.

### D-8 — The instance, and no paid service

ADR 0036 D-3 holds, restated: **the tile host is not the instance.** A rider with no instance can take
an open-world ride, and nothing of it is sent to an instance. A self-hoster with no cloud account
points `VITE_BASEMAP_PMTILES_URL` at an archive of their own, and the streamed read goes there (ADR
0054 D-2.1, D-4.4). No paid service is a prerequisite (ADR 0036 D-7): the project's own reads are R2
Class B requests, free up to 10 million a month and $0.36 a million after
(`docs/cost-model.md`, read 2026-09-15). At D-2.4's estimate a thousand riders riding ten open-world
hours a month make about four million reads, inside the free tier. `docs/cost-model.md` carries no
figure this changes; #2882's measurement goes there if it does.

### D-9 — What the owner is asked to rule on

1. **Q0 — Accept this ADR before it merges, or merge it as Proposed?** Recommended: **accept before
   merge**, and the pull request changes the Status line, which an amendment cannot do later
   (ADR 0013).
2. **Q1 — The block: a z14 tile, and its 3 × 3 held round the rider (D-2)?** Recommended: **yes**. A
   coarser block hides more and costs more bytes; a z15 block would halve both. #2882's measurement
   may make it coarser by amendment, never finer.
3. **Q2 — The cache's ceiling (D-6.5)**: set by #2891 from a measurement, or a number now?
   Recommended: **by #2891**, with least-recently-ridden eviction fixed here.
4. **Q3 — Tiles off rides what is cached (D-7.2)**, rather than refusing the open-world ride
   outright? Recommended: **yes**; a cached block costs no request.

---

## Consequences

### What this enables

- **An open-world ride anywhere in the US**, starting at home, with real streets round the rider at
  every junction.
- **A second ride in the same place asks less**, and asks nothing where the rider has ridden before.
- Phase 1's readers have a rule to be checked against: #2889 (start), #2890 (streamed reader), #2891
  (cache), #2906 (recording) and #2908 (edge of the map).

### What this costs

- **The rider's path, at block precision, to the tile host, for the whole ride** (D-4). It is the
  largest location disclosure the app has made to any party, and it is accepted for this mode only.
- **No hole round a privacy zone** for an open-world ride, so the first ride from home tells the host
  which block home is in (D-4). The corridor read's hole told the host where the zone roughly was;
  this tells it where the ride roughly began. Neither is nothing.
- **A second ODbL store**, or a second kind of row in the first, whose only protection from
  share-alike is that it never leaves the device (D-6.3, D-6.4).
- **A request while a ride records**, which every route ride still refuses: two read paths to keep
  apart, and a test that a route ride still makes none.

### Constraints this places on other work

| Issue | Constraint |
|---|---|
| [#2889](https://github.com/openzigs/onyourleft/issues/2889) | The start's 3 × 3 is read before the ride (D-2.3); the start point never leaves the device; tiles off with nothing cached says so (D-7.2) |
| [#2890](https://github.com/openzigs/onyourleft/issues/2890) | D-2, D-3, R-1, R-2, R-3, R-6 and R-7 in full, including `boundaries.ts`, `docs/privacy-policy.md` and `data-safety.ts`; a route ride still makes no request while recording |
| [#2891](https://github.com/openzigs/onyourleft/issues/2891) | D-6 in full: the scoping-test entry, the payload tests, the ceiling with its measurement, and a tested rollback |
| [#2906](https://github.com/openzigs/onyourleft/issues/2906) | R-4 |
| [#2908](https://github.com/openzigs/onyourleft/issues/2908) | D-7.2 and D-7.3 |
| ADR 0087 (#2885) | Height tiles are read on D-2's blocks, under R-1 to R-3, R-6 and R-7 |
| ADR 0054 | One dated `## Amendments` entry pointing here; its body is not edited |

---

## What would make this ADR wrong

- **The host's view turns out finer than a block.** If #2890 finds the archive's directory layout or
  the reader's timing reveals position inside a block, D-4's account is wrong and R-1 needs a fix
  before the reader ships.
- **The cache starts to leave the device.** Then ODbL §4.4 is live, as ADR 0054 says for its own store.
- **#2882 measures a lead the grid cannot meet**, for example a block read that takes longer than the
  2 min 24 s the lead gives at 40 km/h on a slow connection. Then D-2 changes, by a new ADR if the
  block gets finer.
- **The owner's acceptance of the path disclosure is withdrawn.** Then the open-world ride needs a
  region download before the ride, which is a new decision.
