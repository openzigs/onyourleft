# ADR 0070: Houses on inferred built-up land — a suburb mapped only by its streets, superseding ADR 0054 D-5.1 in part

- **Status**: **Proposed, 2026-11-15.** The direction is the owner's ruling of that day on
  [#2684](https://github.com/openzigs/onyourleft/issues/2684) (quoted in Context). The rule's numbers
  in D-1 are the author's, measured as D-5 records, and are accepted only on the owner's approval on
  this ADR's pull request (the cues' thresholds and the 0.5 share are the author's, measured as D-5
  records), after the owner-approved screenshots and the moving-ride tablet frame
  check #2684 asks for
- **Date**: 2026-11-15
- **Deciders**: **the owner**, in the ruling quoted in Context and on this ADR's pull request.
  Drafted by the author for that approval
- **Issue**: [#2684](https://github.com/openzigs/onyourleft/issues/2684), after
  [#2655](https://github.com/openzigs/onyourleft/issues/2655) (the same suburbs where OSM maps the
  footprints)
- **Number**: **0070**. On 2026-11-15 `docs/adr/` holds no file numbered 0070,
  `docs/agents/conventions.md` §7 gives 0070 as the next free number, and no open pull request or
  issue names it
- **Supersedes**: [ADR 0054](0054-towns-from-real-map-data.md) **D-5.1, in part** — it adds one more
  source of built-up land, and nothing else — and **D-5.3**'s _"a stretch with data and no footprint
  and no built-up land is countryside"_ reads _"no built-up land, mapped or inferred"_. D-5.2, D-5.4,
  D-5.5, D-5.6 and D-5.7 are unchanged, by name. ADR 0054 gains an appended amendment pointing here
  ([ADR 0013](0013-adr-amendments.md)); its body is not edited
- **Amends**: [ADR 0055](0055-place-kinds-and-ranks-from-the-corridor-never-a-name.md) D-5.4 by an
  appended entry: `land-class.ts` reads place points as one cue (D-1.7), never a name
- **Rests on**: ADR 0054 D-5.6 (the structure cap of 36 does not rise), and the 2026-11-15 entry in
  its `## Amendments` (#2655: no procedural field boundary beside a mapped house)

## Context

The owner's ruling of 2026-11-15 on #2684: _"Yes I would like the houses drawn. I would like the maps
to be as realistic as possible and represent everything we can that is marked, parks, golf courses,
water, bridges etc."_

ADR 0054 D-5.1 lets a building stand only on a mapped footprint or as a procedural lot on mapped
built-up land use (`residential`, `commercial`, `industrial`, or a kind named beside the rule). In
many US suburbs OpenStreetMap has neither: the streets are mapped and the land between them is not.
There the ground reads `other`, and the realistic world drew open country — fields, fences, trees —
where the HUD map shows a dense residential street grid. #2655 fixed the case with footprints; this
is the case without.

The map does say people built there, in the one layer that is mapped: a suburb's streets are many
and close together, and a farm road's are few and far apart. That difference is what D-1 reads.

## Decision

### D-1 — Inferred built-up land, and its rule

A covered cell of the land-class mask (`apps/web/src/game/land-class.ts`, 5 m cells) is **inferred
built-up land** where all three hold:

1. **No land use is mapped there.** No land-use polygon covers the cell, or only Protomaps' own
   `other` kind does (which is where Protomaps writes `place=neighbourhood`). A polygon of any other
   kind whose class is `other` — an aerodrome, a beach, a heath, a platform — is a mapper's
   statement about that ground, and the cell is not inferred. Farmland, meadow, wood, water and park
   hold their own classes and are never inferred over.
2. **A residential street is near.** The cell's centre is within **60 m** of a street whose
   `kind_detail` is `residential`, `living_street` or `service`, and which is not in a tunnel.
3. **The streets about it are dense.** The `residential` and `living_street` streets in the
   **560 m** square about the cell come to at least **45 street metres a hectare**. `service` roads
   are not counted: a car park's aisles and a mall's delivery lanes are `service` too. **Required**,
   and not enough alone.

Then the owner's ruling of 2026-11-15 on #2684 (_"how do we know between suburb and rural where there
might be farms"_) is met by cues **combined**, each read over the same 560 m square (D-1.4 to D-1.7).
Three are for a suburb and two against; the square is a suburb's where, beyond condition 3, the
cues for outnumber those against:

4. **Joins (for).** At least **0.15 joins a hectare**: a join is a vertex of one counted street within
   **6 m** of another's segment, counted once a place. A grid or a run of cul-de-sacs has them, and a
   farm road with a few driveways does not.
5. **Farmland (against).** Mapped `farmland`, `meadow` or `farmyard` (all class `farmland`) is at least
   **15 %** of the square.
6. **Edge of a mapped suburb (for).** At least **5 mapped footprints** in the square, or mapped built-up
   land (a polygon's) is at least **5 %** of it.
7. **Places (for and against).** The nearest `place` point within **1 500 m** is a `suburb`, `quarter`,
   neighbourhood, `town` or `city` (for); a `hamlet` within **600 m** is against; a `village`, or a
   hamlet further off, speaks neither way. The archive's places carry no `isolated_dwelling` or `farm`.
8. **`UrbanClass` is not read.** It is built from this mask (`urban-class.ts`), so reading it here
   would be a circle; a rural window it reads as a village is the consequence of D-2.3, not a cue.

Inferred cells take the class `built-up` in the mask, built once at the press after the polygons,
under its own work cap; past the cap the rest is not inferred, which is today's world. Where the
polygon pass ran out of work, nothing is inferred, so a wood the cap left unpainted is never read
as open land beside a street.

### D-2 — Inferred land is built-up land to every reader

Only lot density reads inferred land differently from mapped built-up land (D-2.1). By the rules
already in place:

1. **Procedural lots** stand there (`settlements.ts` §`lotsAt`), with the house archetypes and lot
   spacing the residential lots use (18 m plots, 15 m from the route's road, facing it, kept off every
   mapped footprint and off every stretch of the road) but **sparser: 50 % of plots built, where mapped
   residential land builds 80 %** — the owner's ruling that where the map does not mark the houses
   they are not over-saturated. The same hash, so a plot built on inferred land is built on mapped
   land too. The mask tells the two apart (`inferredAt`), which this is the one reader of.
2. **No field boundary** stands on it (`land-class.ts` §`fieldGround`): no field fence, hedge or wall
   beside these houses, as #2655 keeps them from mapped ones.
3. Trees, rocks and shrubs are not scattered on it, pedestrians walk there, the ground is levelled
   to the road near it, and the urban class counts it as built-up (a rural window may read as a
   village), as on a mapped residential polygon.

### D-3 — What does not change

D-5.2 (never on forest, wood, water or park) holds: those cells keep their class. Rail, industrial
and military land is mapped built-up already, and D-1 changes nothing there. The structure cap stays
at 36 (D-5.6), and no triangle ceiling, vertex attribute count or draw-call bound rises: lots are
procedural structures under the same cap, ranked as #2429 and #2655 left them.

### D-4 — The tests that hold it

`apps/web/src/game/inferred-suburb.test.ts`: the cues, each at its threshold and combined (`suburbCues`, `nearestPlace`); lots sparser on inferred land than on mapped; a seeded suburb fixture with streets and no footprint or
land use draws houses through `sceneFrame` and no field boundary among them; a seeded farm road with
a crossroads and driveways infers nothing and draws no house; each of D-1's three conditions has
its control.

### D-5 — The measurement

Read on 2026-11-15 through the game's own path (`world-data/corridor.ts` §`planCorridor` and
§`readCorridorTiles`, `packages/map-features` §`decodeTile`) from the published
`basemap-us-oyl-20261031.pmtiles`, with #2655's probe: `sceneFrame` at the realistic structure cap
and `refillMappedBuildings` into a real `MappedBuildingBelt`, a frame every 50 m. Each corridor is a
ride along the longest residential street (or, in the rural controls without one, the longest
`unclassified` road) read by a 1.2 km line at the town's centre: about 1 km of road each. The
probe was throwaway and local, as spikes 0031 and 0033's were; no tile, coordinate or script is
committed. Public places only: nothing here is the owner's route.

**Streets only** is the same corridor with every footprint and every built-up land-use polygon taken
away, so a real street network stands for a suburb OpenStreetMap maps with streets only, which is
this ADR's case. **As mapped** is the corridor as read. _Houses_ is houses drawn in a frame, mapped
and procedural; _before_ is with inference off (D-1 given no work), _after_ with it on.

| Corridor                                                         | Footprints read | Density along the road, median (least–most) | As mapped: houses, median, before → after | Streets only: houses, median (frames with none), before → after |
| ---------------------------------------------------------------- | --------------- | ------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------- |
| Citrus Heights CA                                                | 1 738           | 60 (50–71)                                  | 36 → 45                                   | 0 (18 of 18) → 32 (0 of 18)                                     |
| Upper Arlington OH                                               | 1 983           | 78 (65–98)                                  | 36 → 36                                   | 0 (16 of 16) → 25 (0 of 16)                                     |
| Mesa AZ                                                          | 2 466           | 117 (78–132)                                | 37 → 37                                   | 0 (20 of 20) → 33 (0 of 20)                                     |
| Plano TX                                                         | 4 274           | 85 (67–119)                                 | 36 → 36                                   | 0 (20 of 20) → 32 (0 of 20)                                     |
| Oak Park IL                                                      | 5 971           | 94 (89–111)                                 | 37 → 37                                   | 0 (17 of 17) → 27 (0 of 17)                                     |
| Levittown NY                                                     | 2 156           | 98 (70–109)                                 | 36 → 36                                   | 0 (16 of 16) → 33 (0 of 16)                                     |
| Henderson NV                                                     | 935             | 24 (11–49)                                  | 46 → 46                                   | 0 (14 of 14) → 0 (12 of 14)                                     |
| Rural: Story County IA, a `residential` farm road                | 10              | 19 (18–19)                                  | 0 → 0                                     | 0 → 0                                                           |
| Rural: Walworth County WI, a `residential` road                  | 0               | 32 (19–38)                                  | 0 → 0                                     | 0 → 0                                                           |
| Rural: Union County OH, an `unclassified` road                   | 8               | 0                                           | 3 → 3                                     | 0 → 0                                                           |
| Rural: Tipton County IN, an `unclassified` road                  | 0               | 0                                           | 0 → 0                                     | 0 → 0                                                           |
| Rural: Lancaster County NE, an `unclassified` road               | 0               | 0                                           | 0 → 0                                     | 0 → 0                                                           |
| Rural: Harvey County KS, a straight line (no road of 500 m read) | 0               | 0                                           | 0 → 0                                     | 0 → 0                                                           |

Density is D-1.3's, in street metres a hectare over the 560 m square, every 50 m of the road.

- **The threshold.** Along the six suburbs' residential streets the least reading is 50 and the
  medians 60 to 117; along the rural roads the most is 38. 45 stands between them. Over a 400 m
  square, the first window tried, the two overlapped: a rural crossroads in Walworth County read 54
  and the thinnest stretch of Citrus Heights 53. Over the 560 m square, they did not.
- **The houses.** In every one of the six suburbs read with streets only, the frames went from no
  house at all to 25 to 33 houses at the median, and no frame was left without one; every rural
  control stayed at none. As mapped, where OSM has the footprints, the count did not fall anywhere,
  and in Citrus Heights (footprints and no residential land use, #2655's case) lots now stand in the
  gaps between mapped houses as they already do on mapped residential land.
- **Inferred lots among mapped houses (Citrus Heights).** Where footprints are mapped and no
  residential land use is, lots now stand in the gaps at the sparser share, 0.5 of the plots, as the
  ruling asks of ground the map does not mark. The footprints near are a cue _for_ a suburb (D-1.6),
  as the ruling lists them, so they are not a reason to infer nothing; lots keep off every mapped
  footprint.
- **What it misses.** The Henderson NV street read 24 at the median: a low-density stretch with
  large lots and collector streets mapped as `tertiary`, which D-1.3 does not count. With its
  streets only it would still draw open country. That is the price of keeping the farm road open.

#### The cues and the sparser share, measured on 2026-11-15 (after the owner's ruling)

The same path, the same archive, and the same suburbs with their footprints and built-up land taken
away (streets only), plus the control places below. Windows are the 560 m squares about each sampled
street, in the 600 m by 240 m strip about a 1.2 km line through each place's centre; the figures are
the range of each place's percentiles of the windows read.

| Cue                      | Suburbs, streets only                                                      | Rural controls                              | Threshold                                                                             |
| ------------------------ | -------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------- |
| Joins a hectare          | 0.03 to 0.45 median by place; 10th percentile 0 to 0.19; 90th 0.10 to 0.99 | 0 to 0.03 median; 90th percentile 0 to 0.10 | **0.15**, between the rural 90th percentile and the suburbs' medians                  |
| Farmland share           | 0 to 0.01 (90th percentile)                                                | 0.07 to 0.52 where fields are mapped        | **0.15**, above every suburb read and below the rural medians where fields are mapped |
| Footprints in the square | 26 to 437 in a 600 m by 240 m strip                                        | 0 to 10                                     | **5**                                                                                 |
| Place within 1 500 m     | six of the seven suburbs had one (Upper Arlington none)                    | none                                        | counted for or against as D-1.7                                                       |

Mapped footprints within 45 m of a residential street, per 100 street metres per side, in the six
public suburbs: Mesa AZ 0.9, Plano TX 1.9, Levittown NY 2.9, Upper Arlington OH 2.9, Citrus Heights CA
3.2, Oak Park IL 4.0 (median 2.9). Mapped residential land's procedural lots stand 0.8 of an 18 m plot
a side: 4.4. **Inferred land builds 0.5 of the plots, 2.8 per 100 m per side: the measured median, and
63 % of the mapped lots.** Inferred share along the streets of those suburbs (streets only) with every
cue: Upper Arlington OH 0.57 (no place near), Mesa AZ 0.81, Citrus Heights CA 0.78, Levittown NY 0.95,
Henderson NV 0.95, Oak Park IL 0.99, Plano TX 1.00. A first design, joins as a vertex two streets
_share_, read 0.03 to 0.13 a hectare in these suburbs, because the tiles do not keep a junction's
node: the nearness test replaced it.

⚠️ **What this does not show.** The rural controls above were taken at coordinates, and four of the
five held no `residential` or `living_street` road in the strip at all, so for them the cues were not
exercised: a farm road with farmland and no place is held by the density (45) and the farmland cue
together, and by the fixtures in `inferred-suburb.test.ts`, not by a measured county road. Walworth
County WI, read at the coordinate used, is a lake town with dense residential streets and some
footprints, and it reads as a suburb (0.68) as it should; it is not a rural control. A tablet frame
on a real farm road is the check that remains. The press now also scans the mask's chunks once for
farmland and built-up land, 4 096 cell tests a 320 m chunk under the same 20 million cap; its time
was not re-measured on the tablet.

## Consequences

### What this enables

- **A suburb that OpenStreetMap maps only by its streets is drawn as a suburb**, with houses along
  the rider's road and no field fences among them.
- **The rural world is unchanged**: a farm road with a house every few hundred metres stays open
  country, measured on six rural roads.

### What this costs

- **A procedural house can stand where no house is.** A vacant block, a school field or a church car
  park with no land-use polygon, within 60 m of a residential street in a dense grid, reads as
  built-up. It is the price D-5.3's _"a stretch with data and no built-up land is countryside"_
  paid the other way.
- **Fewer trees in such a suburb.** The scatter keeps trees off built-up land, as it does on a
  mapped residential polygon.
- **The press does more**, once a ride, under a work cap of 20 million cell tests: on the
  development machine, inference took about 60 ms over a 50 km route through an unbroken street grid
  (an arithmetic fixture, five parallel streets and a cross street every 120 m). The levelling field
  then measures the inferred town's chunks, as it does a mapped one's, up to its existing cap of 512
  chunks: about 340 ms more on that fixture. A route with no dense residential streets costs
  nothing more.

### Constraints this places on other work

| Work                                    | Constraint                                                                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Anything that reads the land-class mask | `built-up` includes inferred land; `inferredAt` tells them apart, and a reader other than `lotsAt` that uses it needs a change to this ADR |
| A change to D-1's numbers               | Measured again on public suburbs and rural controls through our own archive, and recorded here as an amendment                             |

## What would make this ADR wrong

- **A rural road reads as a suburb.** A hamlet's tight grid of `residential` roads, or an archive
  that tags more rural roads `residential`, could cross 45. A tablet frame of open country turned
  into houses would show it, and D-1.3's number would rise.
- **A suburb's streets are mapped under other kinds.** Where collector streets are `tertiary` and
  only cul-de-sacs are `residential`, the density reads low (Henderson). Counting `tertiary` would
  reach those, and would reach every rural county road with it.
- **The tablet cannot carry it.** If the moving-ride frame check shows the suburb's lots putting the
  realistic rung back on its ceiling, the cap holds and fewer are drawn: the budget wins over this ADR.
