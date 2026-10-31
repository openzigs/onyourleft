# Spike 0031: Land-use kinds and urban density in our archive

- **Date**: 2026-10-30
- **Issue**: [#1630](https://github.com/openzigs/onyourleft/issues/1630), under the epic
  [#1628](https://github.com/openzigs/onyourleft/issues/1628) (its research of 2026-10-24, "Could
  Not Confirm" items 1, 2 and 5). Informs [#1633](https://github.com/openzigs/onyourleft/issues/1633)
  (`apps/web/src/game/urban-class.ts`, whose thresholds are marked provisional until this reading)
  and #1628's open question 3.
- **Number**: **0031.** `docs/spikes/` holds 0001 to 0020 and 0022 to 0029 on `origin/main` at
  `d44743e8`; 0021 is claimed by [#1057](https://github.com/openzigs/onyourleft/issues/1057), and
  0030 is taken by [#1896](https://github.com/openzigs/onyourleft/issues/1896)'s spike, open as
  [#1928](https://github.com/openzigs/onyourleft/pull/1928) on 2026-10-30, the only other open
  pull request carrying one. This file takes 0031 so that the two do not collide (`SPIKE001`).

A spike is a dated measurement that decides nothing (`docs/agents/conventions.md` §7). The one
change it informs, the land-class table, is made by #1630 itself, and the reasons are below.

## Rules this spike holds

- **Counts and shares only.** No coordinate, no tile x/y and no geometry is in this file. The
  sample corridors are named by town, which the issue allows: a document is not the world, and
  nothing here reaches the game (ADR 0054 D-5.7).
- **No real tile is committed**, and no test reads the archive. The reading script was local and
  is not committed. CI's land-use fixtures stay synthetic (`packages/map-features/src/fixtures/tiles.ts`'s
  rule; `apps/web/src/game/testing/land-use-fixtures.ts`).
- **No paid service** (ADR 0036 D-7): the archive is the one every build already reads.

## The archive

| | |
|---|---|
| URL | `https://tiles.openzigs.com/basemap-us-20260914.pmtiles` (`apps/web/src/map/basemap.ts` §`PUBLISHED_BASEMAP_URL`) |
| Identity (the header's etag, as `corridor-source.ts` reads it) | `"d4b735992cf20fdb02af9ea09e097f8f-183"` |
| Build | Protomaps Basemap v4 (`packages/map-features/src/limits.ts`: v4.15.2), z0–15, US |
| Read on | 2026-10-30 |

## Method

1. **Eight corridors**, each a straight line of about 2 km (1,996 to 2,002 m) drawn along the
   named street or road, 401 points, no elevation of interest. Two of each class:

   | Name here | Class | Where |
   |---|---|---|
   | Rural A | rural | a section-line road in central Iowa farmland |
   | Rural B | rural | a section-line road in central Kansas farmland |
   | Village A | village | Woodstock, Vermont, along US 4 through the village |
   | Village B | village | Stockbridge, Massachusetts, along Main Street |
   | Town A | town main street | Bozeman, Montana, along Main Street |
   | Town B | town main street | Frederick, Maryland, along Market Street |
   | Downtown A | US downtown | Chicago, Illinois, along State Street through the Loop |
   | Downtown B | US downtown | Portland, Oregon, along Broadway |

2. **The ride's own read.** Each line went through `world-data/corridor.ts` §`planCorridor` and
   §`readCorridorTiles` against the archive above, by `world-data/corridor-source.ts`
   §`archiveSource` — the z15 tiles within `CORRIDOR_HALF_WIDTH_METRES` (250 m) of the line,
   each decoded by `packages/map-features` §`decodeTile` — then §`worldCorridorOf`,
   `land-class.ts` §`landClassMask` and §`kindAt`, and `urban-class.ts` §`urbanClassMap`. Every
   planned tile came back `covered` (4 to 8 tiles a corridor); none was refused.
3. **Kinds.** Two counts:
   - **pieces**: every decoded `landuse` (and `water`) feature, by kind. A polygon that crosses a
     tile edge is one piece in each tile, so this counts presence, not polygons.
   - **shares**: `urban-class.ts`' sweep (below) asked §`kindAt` at every sample on land that is
     covered and not water, and counted the kind it named; `(none)` is covered land no polygon
     reaches. The share is of those samples.
4. **Per 100 m window**, by a copy of `urban-class.ts` §`urbanClassMap`'s measurement (the copy
   only reported what that function keeps internal): a sweep every 5 m along the line and every
   5 m across it out to ±250 m; footprints (`building` features, not `building_part`) assigned
   to the window their centroid is beside.
   - **Coverage**: footprint area over the window's covered land that is not water.
   - **Commercial**: the share of that land whose §`kindAt` is `commercial`.
   - **Built-up**: the share of it the mask classes `built-up`.
   - **4+ storeys**: footprints with a mapped height whose `footprint-buildings.ts`
     §`storeysFor` (#1629's rule: `3L + 2` read as `L` storeys) is 4 or more. A footprint with no
     height is not counted.
   - **Levels-derived**: the share of the window's footprints whose height is within 0.01 m of
     `3L + 2` for a whole `L ≥ 1`. ⚠️ A mapped `height` that happens to be 5, 8, 11 … m reads as
     levels-derived too; the archive does not say which it was.
   - **Class today**: `urbanClassMap`'s answer at the window's middle, with the thresholds as
     they stand on `main`, place prior and smoothing included.
5. **Protomaps' rules.** `tiles/src/main/java/com/protomaps/basemap/layers/Landuse.java` on
   `protomaps/basemaps` `main` at `4df8646541c8`, its last change (2026-07-07) before the
   archive's build (2026-09-14), read for which `kind` values a rule can write.

⚠️ **Window 0 (†) over-counts coverage.** A footprint up to 250 m before the line's start is
nearest the start, so it is assigned to window 0, while window 0's land is only the sweep across
its own 100 m. Downtown A's window 0 reads 127.3 %. `urban-class.ts` measures the same way, so a
real route that starts in a town has the same first window; the summaries below leave window 0
out. The partial last window (2 m) is left out everywhere.

## Results: the land-use kinds

**Neither `retail` nor `neighbourhood` was counted, in any corridor, as a piece or as a share.**
No rule of `Landuse.java` writes `retail`, and `place=neighbourhood` is written as `kind`
`other` (its rule at `with("place", "neighbourhood")`). Town B's 5.6 % of `other` and Downtown
A's 2.0 % are that `other`, or a feature no rule matched; either way the table reads it as
`other`, as it should.

Pieces, by corridor:

| Corridor | Pieces (`landuse` unless marked) |
|---|---|
| Rural A | none |
| Rural B | `nature_reserve` 4, `water` (water) 3 |
| Village A | `park` 12, `water` (water) 7, `pitch` 6, `grass` 6, `cemetery` 4, `meadow` 3, `pedestrian` 3, `swimming_pool` (water) 3, `school` 2, `wood` 2, `grassland` 1, `playground` 1 |
| Village B | `wood` 30, `pitch` 17, `water` (water) 13, `nature_reserve` 6, `golf_course` 3, `cemetery` 3, `park` 3, `recreation_ground` 3, `wetland` 2, `pedestrian` 2, `hospital` 2, `grass` 2, `swimming_pool` (water) 2, `garden` 1, `kindergarten` 1, `village_green` 1, `scrub` 1, `playground` 1 |
| Town A | `residential` 57, `commercial` 13, `park` 12, `pitch` 10, `grass` 5, `school` 3, `playground` 3, `industrial` 3, `wetland` 3, `recreation_ground` 2, `cemetery` 2, `swimming_pool` (water) 2, `kindergarten` 2, `pedestrian` 1, `farmland` 1, `garden` 1, `sand` 1, `wood` 1 |
| Town B | `pitch` 30, `residential` 29, `swimming_pool` (water) 27, `playground` 26, `park` 23, `industrial` 16, `water` (water) 10, `school` 5, `other` 5, `commercial` 5, `recreation_ground` 4, `pedestrian` 4, `wood` 3, `fountain` (water) 3, `cemetery` 2, `grass` 2, `dog_park` 1, `platform` 1, `university` 1, `hospital` 1 |
| Downtown A | `garden` 1808, `pedestrian` 523, `commercial` 237, `grass` 199, `residential` 133, `park` 105, `pitch` 70, `platform` 68, `pier` 68, `swimming_pool` (water) 65, `fountain` (water) 48, `railway` 34, `water` (water) 31, `meadow` 24, `industrial` 22, `university` 21, `playground` 20, `recreation_ground` 19, `college` 18, `sand` 16, `dog_park` 13, `school` 5, `other` 4, `wetland` 4, `scrub` 3, `hospital` 3, `kindergarten` 2, `wood` 1, `grassland` 1 |
| Downtown B | `platform` 55, `residential` 55, `commercial` 51, `pedestrian` 32, `park` 23, `grass` 20, `university` 18, `scrub` 16, `industrial` 15, `fountain` (water) 10, `garden` 9, `water` (water) 9, `pier` 8, `swimming_pool` (water) 7, `pitch` 6, `playground` 4, `wetland` 4, `bare_rock` 3, `dog_park` 3, `school` 2, `railway` 2, `wood` 2, `beach` 1, `college` 1 |

Shares of covered land, by corridor (`(none)` is land no polygon reaches):

| Corridor | Shares, % |
|---|---|
| Rural A | `(none)` 100.0 |
| Rural B | `(none)` 93.5, `nature_reserve` 6.5 |
| Village A | `(none)` 70.9, `wood` 15.2, `park` 12.5, `school` 0.3, `cemetery` 0.3, `grass` 0.3, `water` 0.2, `grassland` 0.1, `meadow` 0.1, `pedestrian` and `swimming_pool` under 0.05 |
| Village B | `(none)` 68.3, `wood` 13.1, `golf_course` 9.7, `hospital` 3.8, `scrub` 2.0, `park` 1.5, `nature_reserve` 0.5, `water` 0.4, `grass` 0.2, `cemetery` 0.2, `village_green` 0.1, `recreation_ground` 0.1, `pitch` 0.1, `wetland` and `swimming_pool` under 0.05 |
| Town A | `commercial` 44.8, `residential` 27.4, `(none)` 17.6, `park` 5.8, `school` 2.4, `industrial` 1.4, `grass` 0.3, `playground` 0.2, `wetland` under 0.05 |
| Town B | `(none)` 83.6, `other` 5.6, `school` 4.5, `residential` 3.5, `park` 1.6, `cemetery` 1.1, `water` 0.1, `pitch`, `playground` and `swimming_pool` under 0.05 |
| Downtown A | `commercial` 42.3, `(none)` 26.4, `residential` 14.4, `university` 4.4, `college` 3.8, `other` 2.0, `pedestrian` 2.0, `park` 1.6, `garden` 1.3, `school` 1.1, `industrial` 0.3, `railway` 0.1, `grass` 0.1, `water` 0.1, `fountain` under 0.05 |
| Downtown B | `(none)` 77.6, `commercial` 7.1, `university` 5.3, `park` 4.3, `residential` 3.3, `pedestrian` 0.9, `school` 0.5, `industrial` 0.3, `platform` 0.3, `grass` 0.1, `pitch` 0.1, `playground` 0.1, and six more under 0.05 |

### What became of `LAND_CLASS_OF_KIND`

The issue's rule is that a kind seen zero times in every sample is removed and a kind that was
seen stays. Applied to the 41 entries, with Protomaps' rules as the second witness:

- **Removed (13)** — counted zero times in all eight corridors **and** written by no rule of
  `Landuse.java`: `retail`, `neighbourhood` (written as `other`), `marina`, `protected_area`,
  `townhall`, `library`, `post_office`, `supermarket`, `grocery`, `hotel`, `stadium`, and
  `farmyard` and `orchard` (both written as `farmland`, which the table keeps). Each now reads
  as `other`, which is what each already was in practice: the archive never hands the table
  these strings.
- **Kept though unseen (4)** — `forest` (`landuse=forest`, and a US forest operator's
  `protected_area`), `national_park`, `zoo` and `military` are each written by a rule; they are
  absent from these corridors because none of them crosses one, not because the archive cannot
  carry them. Removing them would make a national forest or a base `other` the day a route
  crosses one.
- **Kept, seen (24)** — every other entry was counted in at least one corridor.

**For #1633:** the `commercial` signal rests on `commercial` alone, and that is the only string
the archive uses for it. `URBAN_COMMERCIAL_KINDS` (`commercial`) needs no addition from this
reading.

### Kinds the archive emits that the table does not name

Seen here and read as `other` today, recorded for whoever revisits the table (this spike changes
none of them): `grassland`, `kindergarten`, `village_green`, `sand`, `platform`, `pier`,
`bare_rock`, `beach`, and Protomaps' own `other`. In the `water` layer, `swimming_pool` and
`fountain` are water whatever their kind. `kindergarten` beside `school` (which is `built-up`) and
`village_green` beside `park` are the two whose class looks wrong rather than merely
unlisted. Downtown A's 1,808 `garden` pieces are mostly small; they are 1.3 % of its land.

## Results: per-window density

Summaries over windows 1 to 19 (minimum / median / maximum), then every window for the six
corridors with buildings. Both rural corridors read 0 for everything in every window: no
footprint, no built-up land, and the classifier calls every window `rural`.

| Corridor | Coverage % | Commercial % | Built-up % | Footprints | 4+ storeys | Levels-derived | Any height |
|---|---|---|---|---:|---:|---:|---:|
| Rural A | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 | 0 | — | — |
| Rural B | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 | 0 | — | — |
| Village A | 0.0 / 5.3 / 18.1 | 0 / 0 / 0 | 0.0 / 0.0 / 4.4 | 326 | 0 | 1.8 % | 1.8 % |
| Village B | 2.4 / 4.9 / 25.3 | 0 / 0 / 0 | 0.0 / 0.0 / 33.0 | 257 | 1 | 1.6 % | 1.6 % |
| Town A | 9.8 / 24.5 / 39.5 | 0.0 / 45.8 / 95.3 | 26.6 / 86.0 / 99.6 | 871 | 10 | 1.7 % | 2.3 % |
| Town B | 7.5 / 30.2 / 58.3 | 0 / 0 / 0 | 0.0 / 0.0 / 32.7 | 1,619 | 16 | 20.5 % | 20.7 % |
| Downtown A | 26.3 / 56.5 / 82.9 | 13.7 / 47.5 / 68.9 | 41.4 / 70.0 / 85.0 | 642 | 318 | 52.8 % | 59.2 % |
| Downtown B | 29.3 / 48.6 / 63.8 | 0.0 / 4.3 / 24.1 | 0.0 / 9.5 / 61.1 | 473 | 201 | 89.4 % | 96.2 % |

Footprints, 4+ storeys and the two height shares are over windows 0 to 19.

### Village A

| Window | Coverage % | Commercial % | Built-up % | Footprints | 4+ storeys | Levels-derived % | Class today |
|---:|---:|---:|---:|---:|---:|---:|---|
| 0 † | 0.0 | 0.0 | 0.0 | 0 | 0 | — | `village` |
| 1 | 0.0 | 0.0 | 0.0 | 0 | 0 | — | `village` |
| 2 | 4.1 | 0.0 | 0.0 | 7 | 0 | 0.0 | `village` |
| 3 | 3.3 | 0.0 | 0.0 | 7 | 0 | 0.0 | `village` |
| 4 | 3.6 | 0.0 | 0.7 | 13 | 0 | 0.0 | `village` |
| 5 | 5.1 | 0.0 | 0.0 | 11 | 0 | 0.0 | `village` |
| 6 | 7.7 | 0.0 | 0.0 | 22 | 0 | 0.0 | `village` |
| 7 | 10.6 | 0.0 | 0.0 | 18 | 0 | 0.0 | `village` |
| 8 | 12.1 | 0.0 | 4.4 | 26 | 0 | 0.0 | `village` |
| 9 | 18.1 | 0.0 | 3.1 | 17 | 0 | 5.9 | `village` |
| 10 | 17.1 | 0.0 | 0.0 | 30 | 0 | 16.7 | `village` |
| 11 | 13.8 | 0.0 | 0.0 | 40 | 0 | 0.0 | `village` |
| 12 | 5.4 | 0.0 | 0.0 | 17 | 0 | 0.0 | `village` |
| 13 | 5.3 | 0.0 | 0.0 | 19 | 0 | 0.0 | `village` |
| 14 | 4.4 | 0.0 | 0.0 | 12 | 0 | 0.0 | `village` |
| 15 | 6.1 | 0.0 | 0.0 | 10 | 0 | 0.0 | `village` |
| 16 | 3.1 | 0.0 | 0.0 | 12 | 0 | 0.0 | `village` |
| 17 | 1.7 | 0.0 | 0.0 | 9 | 0 | 0.0 | `rural` |
| 18 | 2.5 | 0.0 | 0.0 | 11 | 0 | 0.0 | `rural` |
| 19 | 8.9 | 0.0 | 0.0 | 45 | 0 | 0.0 | `rural` |

### Village B

| Window | Coverage % | Commercial % | Built-up % | Footprints | 4+ storeys | Levels-derived % | Class today |
|---:|---:|---:|---:|---:|---:|---:|---|
| 0 † | 1.1 | 0.0 | 0.0 | 2 | 0 | 0.0 | `rural` |
| 1 | 2.9 | 0.0 | 0.0 | 5 | 1 | 20.0 | `rural` |
| 2 | 2.4 | 0.0 | 0.0 | 2 | 0 | 0.0 | `rural` |
| 3 | 5.3 | 0.0 | 0.0 | 8 | 0 | 0.0 | `village` |
| 4 | 5.0 | 0.0 | 0.0 | 9 | 0 | 0.0 | `village` |
| 5 | 2.5 | 0.0 | 4.3 | 7 | 0 | 0.0 | `village` |
| 6 | 6.4 | 0.0 | 30.0 | 5 | 0 | 20.0 | `village` |
| 7 | 5.8 | 0.0 | 33.0 | 13 | 0 | 15.4 | `village` |
| 8 | 25.3 | 0.0 | 8.3 | 49 | 0 | 0.0 | `village` |
| 9 | 11.3 | 0.0 | 0.0 | 24 | 0 | 0.0 | `village` |
| 10 | 3.4 | 0.0 | 0.0 | 8 | 0 | 0.0 | `village` |
| 11 | 7.5 | 0.0 | 0.0 | 15 | 0 | 0.0 | `village` |
| 12 | 2.8 | 0.0 | 0.0 | 6 | 0 | 0.0 | `village` |
| 13 | 2.6 | 0.0 | 0.0 | 9 | 0 | 0.0 | `village` |
| 14 | 4.5 | 0.0 | 0.0 | 17 | 0 | 0.0 | `village` |
| 15 | 4.6 | 0.0 | 0.0 | 18 | 0 | 0.0 | `village` |
| 16 | 4.9 | 0.0 | 0.0 | 11 | 0 | 0.0 | `village` |
| 17 | 5.2 | 0.0 | 0.0 | 14 | 0 | 0.0 | `village` |
| 18 | 6.4 | 0.0 | 0.0 | 23 | 0 | 0.0 | `village` |
| 19 | 3.3 | 0.0 | 0.0 | 12 | 0 | 0.0 | `village` |

### Town A

| Window | Coverage % | Commercial % | Built-up % | Footprints | 4+ storeys | Levels-derived % | Class today |
|---:|---:|---:|---:|---:|---:|---:|---|
| 0 † | 48.7 | 0.0 | 58.7 | 111 | 0 | 0.9 | `town` |
| 1 | 16.4 | 0.0 | 50.1 | 47 | 0 | 0.0 | `town` |
| 2 | 19.1 | 0.0 | 29.9 | 46 | 1 | 2.2 | `town` |
| 3 | 16.2 | 21.4 | 66.6 | 61 | 0 | 0.0 | `town` |
| 4 | 14.0 | 22.8 | 81.8 | 55 | 0 | 0.0 | `town` |
| 5 | 23.0 | 22.8 | 90.9 | 49 | 0 | 0.0 | `town` |
| 6 | 15.1 | 34.0 | 71.9 | 21 | 0 | 0.0 | `town` |
| 7 | 24.5 | 77.0 | 84.0 | 22 | 0 | 9.1 | `town` |
| 8 | 31.4 | 90.7 | 95.5 | 55 | 2 | 3.6 | `town` |
| 9 | 35.5 | 83.3 | 96.3 | 54 | 2 | 0.0 | `town` |
| 10 | 39.5 | 95.3 | 99.6 | 29 | 1 | 3.4 | `town` |
| 11 | 26.9 | 69.8 | 94.7 | 42 | 1 | 2.4 | `town` |
| 12 | 27.2 | 72.9 | 94.5 | 34 | 0 | 0.0 | `town` |
| 13 | 18.9 | 74.9 | 91.0 | 36 | 1 | 2.8 | `town` |
| 14 | 25.7 | 54.9 | 91.1 | 33 | 0 | 6.1 | `town` |
| 15 | 18.1 | 44.0 | 89.1 | 51 | 1 | 3.9 | `town` |
| 16 | 27.2 | 45.8 | 81.7 | 33 | 1 | 6.1 | `town` |
| 17 | 27.2 | 52.0 | 86.0 | 30 | 0 | 0.0 | `town` |
| 18 | 9.8 | 24.2 | 42.0 | 20 | 0 | 0.0 | `town` |
| 19 | 38.2 | 11.6 | 26.6 | 42 | 0 | 0.0 | `town` |

### Town B

| Window | Coverage % | Commercial % | Built-up % | Footprints | 4+ storeys | Levels-derived % | Class today |
|---:|---:|---:|---:|---:|---:|---:|---|
| 0 † | 41.0 | 0.0 | 64.6 | 7 | 0 | 14.3 | `village` |
| 1 | 7.5 | 0.0 | 18.6 | 6 | 0 | 0.0 | `village` |
| 2 | 21.1 | 0.0 | 3.0 | 48 | 0 | 0.0 | `village` |
| 3 | 10.5 | 0.0 | 0.0 | 38 | 0 | 10.5 | `village` |
| 4 | 19.0 | 0.0 | 0.0 | 49 | 0 | 12.2 | `town` |
| 5 | 15.0 | 0.0 | 0.0 | 80 | 0 | 0.0 | `town` |
| 6 | 43.5 | 0.0 | 0.0 | 168 | 1 | 35.7 | `town` |
| 7 | 29.5 | 0.0 | 0.0 | 59 | 3 | 22.0 | `town` |
| 8 | 30.2 | 0.0 | 0.0 | 21 | 3 | 38.1 | `town` |
| 9 | 58.3 | 0.0 | 0.0 | 51 | 5 | 80.4 | `town` |
| 10 | 34.3 | 0.0 | 0.0 | 69 | 3 | 79.7 | `town` |
| 11 | 49.0 | 0.0 | 0.0 | 55 | 1 | 23.6 | `town` |
| 12 | 42.2 | 0.0 | 0.0 | 68 | 0 | 20.6 | `town` |
| 13 | 34.7 | 0.0 | 0.0 | 71 | 0 | 36.6 | `town` |
| 14 | 33.5 | 0.0 | 0.0 | 147 | 0 | 12.9 | `town` |
| 15 | 41.5 | 0.0 | 0.0 | 215 | 0 | 3.7 | `town` |
| 16 | 27.7 | 0.0 | 0.5 | 125 | 0 | 44.0 | `town` |
| 17 | 31.2 | 0.0 | 32.7 | 114 | 0 | 5.3 | `town` |
| 18 | 27.4 | 0.0 | 18.5 | 125 | 0 | 0.8 | `town` |
| 19 | 24.8 | 0.0 | 17.9 | 103 | 0 | 1.9 | `town` |

### Downtown A

| Window | Coverage % | Commercial % | Built-up % | Footprints | 4+ storeys | Levels-derived % | Class today |
|---:|---:|---:|---:|---:|---:|---:|---|
| 0 † | 127.3 | 15.0 | 74.0 | 66 | 30 | 69.7 | `city-centre` |
| 1 | 44.6 | 22.4 | 70.0 | 23 | 11 | 60.9 | `city-centre` |
| 2 | 50.8 | 13.7 | 66.6 | 25 | 15 | 72.0 | `city-centre` |
| 3 | 32.2 | 15.0 | 72.2 | 16 | 9 | 75.0 | `city-centre` |
| 4 | 73.1 | 23.5 | 80.0 | 28 | 19 | 82.1 | `city-centre` |
| 5 | 62.3 | 30.4 | 46.2 | 16 | 9 | 68.8 | `city-centre` |
| 6 | 26.3 | 43.1 | 69.0 | 32 | 8 | 28.1 | `city-centre` |
| 7 | 72.6 | 39.4 | 76.8 | 58 | 32 | 51.7 | `city-centre` |
| 8 | 64.0 | 68.0 | 79.5 | 46 | 25 | 54.3 | `city-centre` |
| 9 | 55.2 | 66.4 | 79.3 | 34 | 18 | 64.7 | `city-centre` |
| 10 | 62.0 | 68.9 | 75.1 | 27 | 10 | 40.7 | `city-centre` |
| 11 | 78.6 | 55.3 | 85.0 | 40 | 22 | 50.0 | `city-centre` |
| 12 | 56.5 | 67.3 | 76.5 | 30 | 19 | 50.0 | `city-centre` |
| 13 | 41.9 | 47.5 | 53.4 | 26 | 13 | 53.8 | `city-centre` |
| 14 | 82.9 | 28.0 | 41.4 | 18 | 6 | 22.2 | `city-centre` |
| 15 | 65.7 | 49.8 | 69.0 | 41 | 17 | 48.8 | `city-centre` |
| 16 | 75.1 | 53.0 | 76.3 | 49 | 25 | 46.9 | `city-centre` |
| 17 | 43.3 | 48.5 | 56.0 | 21 | 12 | 33.3 | `city-centre` |
| 18 | 38.7 | 44.7 | 46.9 | 28 | 10 | 39.3 | `city-centre` |
| 19 | 55.2 | 47.9 | 49.3 | 18 | 8 | 22.2 | `city-centre` |

### Downtown B

| Window | Coverage % | Commercial % | Built-up % | Footprints | 4+ storeys | Levels-derived % | Class today |
|---:|---:|---:|---:|---:|---:|---:|---|
| 0 † | 102.3 | 5.0 | 47.8 | 54 | 15 | 87.0 | `city-centre` |
| 1 | 36.3 | 19.1 | 61.1 | 9 | 6 | 88.9 | `city-centre` |
| 2 | 54.9 | 5.6 | 44.4 | 11 | 6 | 90.9 | `city-centre` |
| 3 | 37.7 | 7.2 | 22.2 | 6 | 5 | 83.3 | `city-centre` |
| 4 | 51.6 | 24.1 | 34.4 | 22 | 15 | 100.0 | `city-centre` |
| 5 | 35.0 | 20.7 | 20.5 | 11 | 7 | 63.6 | `city-centre` |
| 6 | 36.3 | 14.9 | 17.9 | 13 | 7 | 76.9 | `city-centre` |
| 7 | 48.6 | 23.0 | 22.7 | 14 | 10 | 64.3 | `city-centre` |
| 8 | 40.1 | 0.9 | 0.9 | 16 | 13 | 75.0 | `city-centre` |
| 9 | 37.0 | 0.0 | 9.4 | 23 | 10 | 95.7 | `city-centre` |
| 10 | 56.1 | 0.0 | 2.5 | 26 | 14 | 88.5 | `city-centre` |
| 11 | 49.0 | 0.0 | 0.0 | 28 | 14 | 100.0 | `city-centre` |
| 12 | 55.1 | 2.2 | 5.8 | 27 | 15 | 81.5 | `city-centre` |
| 13 | 52.5 | 0.0 | 0.0 | 39 | 21 | 97.4 | `city-centre` |
| 14 | 51.8 | 0.0 | 0.7 | 28 | 11 | 85.7 | `city-centre` |
| 15 | 43.8 | 0.0 | 0.3 | 18 | 9 | 83.3 | `city-centre` |
| 16 | 42.2 | 6.9 | 6.6 | 25 | 4 | 100.0 | `city-centre` |
| 17 | 63.8 | 8.5 | 9.5 | 39 | 10 | 94.9 | `city-centre` |
| 18 | 48.7 | 4.3 | 15.6 | 34 | 6 | 100.0 | `city-centre` |
| 19 | 29.3 | 0.0 | 27.7 | 30 | 3 | 83.3 | `city-centre` |

## What the readings say about #1633's thresholds

Observations, not decisions; #1633 owns the numbers.

1. **Every corridor's class came out as its sample class**, after smoothing: both rural
   corridors `rural`; the villages `village` (with `rural` at their ends); the towns `town` (Town
   B's residential south end `village`); both downtowns `city-centre` throughout.
2. **Coverage separates the classes, with overlap at the edges.** Village windows reach 25.3 %
   (Village B, window 8), above `TOWN_COVERAGE` (15 %); town windows fall to 7.5 % and 9.8 %;
   downtown windows fall to 26.3 % and 29.3 %, under `CITY_COVERAGE` (35 %). The smoothing
   (`URBAN_MIN_RUN_METRES`, 300 m) is what holds each corridor to one class.
3. **Two town windows met the city-centre test before smoothing**, by coverage of at least 35 %
   and one of its branches: Town A's windows 9 and 10 by commercial share (83.3 % and 95.3 %
   against `CITY_COMMERCIAL`, 50 %), and Town B's windows 9 and 11 by towers (seven and six
   footprints of 5+ storeys within 200 m against `CITY_TOWER_COUNT`, 3). Neither run reached 300 m, so both
   stayed `town`. A longer commercial main street, or a third tall building, would make a
   stretch of either town a city centre.
4. **Commercial land is uneven.** Town B's main street has no `commercial` polygon at all (0 % in
   every window), and Downtown B's is at most 24.1 %; Town A's reaches 95.3 %. The commercial
   branches alone would miss Town B and Downtown B. Coverage, heights and the place prior carried
   them.
5. **Built-up share is not a density signal downtown.** Downtown B's median built-up share is
   9.5 %, because 77.6 % of its land carries no land-use polygon: OSM maps the buildings there,
   not the land under them. `RURAL_MAX_BUILT_UP` is only ever read together with coverage, so
   this did not misclass a window here.
6. **Heights are mapped downtown, rarely elsewhere.** Levels-derived heights are 89.4 % of
   Downtown B's footprints and 52.8 % of Downtown A's, 20.5 % in Town B and under 2 % in the
   villages and Town A. A median-storeys test (`CITY_MEDIAN_STOREYS`) can only speak where heights
   are mapped, which in this sample is the downtowns and one town.
7. **The first window over-counts** (window 0 above); a route that starts in a town reads its
   first 100 m as denser than it is.

## Not measured

- Outside the US (the archive covers the US only) and in any corridor not listed.
- Overture-sourced land use (`Landuse.java`'s Overture path): this archive's tiles carried no
  Overture subtype in these corridors, so whether a build that reads Overture would hand the table
  another string is not known from this reading.
- Polygon counts as distinct polygons: pieces are per tile.
