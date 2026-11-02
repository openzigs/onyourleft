# Spike 0033: Untagged US footprints — what they measure, and the thresholds the inference rules should start from

- **Date**: 2026-11-02
- **Issue**: [#2022](https://github.com/openzigs/onyourleft/issues/2022), the first of the set under the
  owner's ruling of 2026-11-02 on it (*"Yes, measure first."*), inside the epic
  [#1656](https://github.com/openzigs/onyourleft/issues/1656)'s rulings D1 (archetype rules first, no draw
  calls and no bytes), D3 (no regional style prior) and D6 (no federal datasets and no ML enrichment).
  Informs [#2023](https://github.com/openzigs/onyourleft/issues/2023) (garages and sheds),
  [#2024](https://github.com/openzigs/onyourleft/issues/2024) (barns and pole buildings),
  [#2025](https://github.com/openzigs/onyourleft/issues/2025) (manufactured homes),
  [#2026](https://github.com/openzigs/onyourleft/issues/2026) (shops and commercial buildings) and
  [#2027](https://github.com/openzigs/onyourleft/issues/2027) (copying a neighbour's type).
- **Number**: **0033.** `docs/spikes/` holds 0001 to 0008, 0010 to 0020 and 0022 to 0031 on `origin/main` at `7b70696f`; 0021 is claimed by [#1057](https://github.com/openzigs/onyourleft/issues/1057)
  and 0032 by the open pull request [#1989](https://github.com/openzigs/onyourleft/pull/1989)
  ([#1985](https://github.com/openzigs/onyourleft/issues/1985)). This file takes 0033 so that none of them collides
  (`SPIKE001`).

A spike is a dated measurement that decides nothing (`docs/agents/conventions.md` §7). The thresholds in
"Proposed thresholds" are **starting points for the five rule issues**, each of which still needs the owner's
before/after frames on the course before it merges. No product code changes here.

## Rules this spike holds

- **Aggregate figures only for the owner's course.** No coordinate, tile x/y, place name, route name, road name or
  anything that locates the owner is in this file, in the pull request, or in a commit. The course is called "the
  course" throughout, and its stretches by class (`rural`, `village`), never by where they are.
- **The three public lines are named by town or county**, as spike 0031 named its sample corridors, and give a length
  and a direction but no coordinate. They are straight lines drawn for this spike, i.e. synthetic. The fourth public
  corridor is the shipped demo route (`apps/web/demo/routes/`, CC0-1.0 and ODbL per ADR 0056).
- **No data and no script is committed.** The reading and measuring scripts were throwaway and local, as spike 0031's was.
  No tile, footprint or ring is in the repository.
- **Unmeasured is not a pass.** A rule whose precision could not be measured on mapped types is stated as unmeasured, and
  a figure from fewer than 20 mapped footprints is given with its count and called thin.
- **No federal dataset and no machine-learned enrichment (D6).** Every threshold below comes from the course and the
  public corridors (the measurement), from vendor and Census dimensions (published), or from the product's own
  constants. Atwal et al. is cited as published research on which features matter, not as a source of a number we use.
- **No paid service** (ADR 0036 D-7): the archive is the one every build already reads.

## The question

For footprints that carry no mapped `building_type` (hereafter *untagged*), the rule issues #2023 to #2027 propose to
infer a kind from footprint area, shape, neighbours, distance and class of the nearest road, and the land use under it.
Before any rule is written:

1. What do untagged footprints on a real US corridor look like on each of those axes?
2. Do parking polygons reach the corridor at all?
3. Do the outlines look machine-traced, which would weaken the shape signals?
4. Where a footprint *is* typed, how well would each proposed rule have called its type, and so what should each
   threshold be?
5. How many footprints on the owner's course would each rule change?

## Method

### The corridors

All five were read, or kept, through the ride's own path: `world-data/corridor.ts` §`planCorridor` and
§`readCorridorTiles`, the z15 tiles within `CORRIDOR_HALF_WIDTH_METRES` (250 m) of the line, decoded by
`packages/map-features` §`decodeTile`, at `CORRIDOR_READER_VERSION` 4 (the twelve building fields included).

| Corridor | Where | Length | z15 tiles | Footprints | Seam-cut, left out | Mapped type | Landmark only | Untagged | Untagged and drawn (12 to 20,000 m²) |
|---|---|---|---|---|---|---|---|---|---|
| The course | the owner's, the corridor already kept on the owner's device at reader v4 | about 49 km | 74 | 262 | 3 | 46 | 9 | 204 | 200 |
| Demo | the shipped demo climb route | 3.0 km | 6 | 89 | 0 | 6 | 1 | 82 | 81 |
| Town line | Frederick, Maryland, a straight line running north from downtown, roughly along Market Street | 5.3 km | 14 | 6,724 | 34 | 2,315 | 22 | 4,353 | 4,221 |
| Suburb line | Plano, Texas, a straight north–south line | 6.7 km | 8 | 2,185 | 22 | 2,051 | 0 | 112 | 110 |
| Farm line | Lancaster County, Pennsylvania, a straight east–west line through farmland | 6.8 km | 18 | 346 | 0 | 20 | 0 | 326 | 324 |

- **The three public lines were read on 2026-11-02 from the archive `PUBLISHED_BASEMAP_URL` names** (`basemap-us-oyl-20261031.pmtiles`,
  #1557's own build, ETag `"d31ad8c706ecfaaec69ab8fdee191ada-164"`); every planned tile came back `covered`. The
  course's stored corridor was read earlier at the same reader version; the stored record does not carry the archive's
  identity, so which build it came from is **not known**.
- **Three more straight lines were tried and left out.** Three farmland lines of about 6 to 7 km, in central Iowa, southern
  Wisconsin and central Kansas, returned **3, 31 and 0 footprints**: farm buildings there are largely not in the
  map, so there is nothing to infer from, and a rule cannot act on a footprint that is not there. (That is a finding in
  itself, below.) The Lancaster County line was kept as the farm sample because its buildings are mapped.
- **Why three public lines and not two.** The issue asks for two. The course has no farmland at all (its land is
  wood, park, wetland, residential and a little commercial), so #2024 had no farm sample to be read on; the farm line
  is the one added for it. The town and suburb lines carry the mapped types that are the only truth available.
- **The course's stretch classes** (the product's own `urban-class.ts` §`urbanClassMap`, 100 m windows): 432 `rural`
  and 54 `village` windows. The demo: 30 `rural`. The town line: 3 `city-centre`, 20 `town`, 30 `village`. The
  suburb line: 54 `town`, 13 `village`. The farm line: 48 `rural`, 20 `village`.

### What was measured per footprint

Outer ring only, in metres, from the corridor's local frame.

- **Area**; **minimum-area rectangle** by `footprint-buildings.ts` §`minimumAreaRectangle`'s method (a hull edge is a side),
  giving the **aspect** (long over short side), the **short side** and **rectangularity** (area over the rectangle's).
- **Corners**: the ring simplified at 0.5 m (`FOOTPRINT_SIMPLIFY_METRES`'s tolerance), counted; and the **largest
  deviation of any corner from a right angle**.
- **Gap to a neighbour**: the shortest distance between the two rings' edges (not between centroids). A *house-sized*
  footprint is one of 60 to 400 m² that is either untagged or mapped as a house, detached, semidetached, terrace or
  residential building.
- **Road**: the shortest distance from the ring to the centreline of each **ground** `streets` line, and its class
  (`kind`, `kind_detail`). **Setback** below is that distance to the nearest road that is not `service` and not a motorway.
  ⚠️ **The nearest road is a `service` road for 26 to 92 % of small and large footprints alike** (a driveway, a
  parking aisle, the lane behind a shop), so a setback that includes `service` roads measures the footprint's own drive.
- **Land under it**: the product's own `land-class.ts` §`landClassMask` at the footprint's centroid and §`kindAt`, and
  `footprint-buildings.ts` §`footprintUse` of the two.
- **Stretch class** at the footprint: the product's urban class of the 100 m window nearest its centroid.
- **Seam-cut footprints** — 59 across the five corridors (0.6 %), 3 on the course — have a vertex on a z15 tile edge, where
  a tile clips a polygon. They are left out of every figure. Whether the other half of each was read was **not** checked.

### Truth, and what is wrong with it

Footprints with a mapped type (`b.t` in the packed record) are the only labelled data there is: **4,438 across the five corridors, 4,347 of them drawn (12 to 20,000 m²)**. They are used two ways: to describe what a mapped garage, shed, house or shop looks
like on these axes, and to ask what a proposed rule would have called each mapped footprint if its tag were hidden.
Footprints with a mapped landmark and no type (worship, school, town hall) are counted as mapped, since mapped data wins.

⚠️ **Mapped footprints are not a random sample of footprints.** 2,051 of the suburb line's 2,163 are typed (a bulk tagging of houses, whose median area is 320 m²), and the town line's mapped footprints include 391 garages, 116 sheds and 856 houses.
A precision measured on them describes the places where someone tagged buildings. It is an upper bound on how the
rule does where nobody did, which is the case the rules exist for. The course has **46** mapped types, the demo 6, the
farm line 20: the rules are validated on the town and suburb lines and **only described** on the rest.

### Quantisation

A z15 tile carries coordinates in a grid of 4,096; one step is **about 0.23 to 0.24 m** at these latitudes. A vertex is
therefore off by up to about 0.12 m, and the corner angle of a short wall by `atan(0.24 / length)`: more than 2° for a wall
under 6 m. Among untagged footprints with a short side under 5 m, **40 %** have every corner within 2° of a right angle;
with a short side of 8 to 15 m, 66 %. **No threshold below about 3° means anything for a small building**, and none is
used below.

### Controls

A comparison that cannot fail is not a measurement, so each was run against a control that must fail.

- **Leave-one-out copy of a neighbour's type** (#2027): exact-type accuracy on the 4,347 mapped footprints is **97.6 %** with the
  labels as mapped (50 m, ±25 % area). With the labels **shuffled among the same footprints** it falls to **41.8 %**, the chance rate for a set dominated by `house`.
- **The garage and shed rules' precision**: 332 of 386 mapped footprints they call garage or shed are one (86 %). With the labels shuffled,
  **44 of 386** are (11 %), the share of mapped footprints that are garages or sheds.

## Results

### What an untagged footprint looks like

**Area** of the untagged footprints, by corridor (count, then share of that corridor's untagged):

| Area, m² | The course (204) | Demo (82) | Town (4,353) | Suburb (112) | Farm (326) |
|---|---|---|---|---|---|
| under 12 (not drawn) | 4 (2 %) | 1 (1 %) | 131 (3 %) | 1 (1 %) | 2 (1 %) |
| 12 to 25 | 3 (1 %) | 3 (4 %) | 172 (4 %) | 1 (1 %) | 1 (0 %) |
| 25 to 40 | 9 (4 %) | 2 (2 %) | 156 (4 %) | 6 (5 %) | 0 |
| 40 to 60 | 6 (3 %) | 11 (13 %) | 383 (9 %) | 0 | 8 (2 %) |
| 60 to 90 | 13 (6 %) | 5 (6 %) | 476 (11 %) | 1 (1 %) | 14 (4 %) |
| 90 to 140 | 36 (18 %) | 15 (18 %) | 897 (21 %) | 5 (4 %) | 46 (14 %) |
| 140 to 200 | 27 (13 %) | 13 (16 %) | 874 (20 %) | 5 (4 %) | 69 (21 %) |
| 200 to 300 | 34 (17 %) | 10 (12 %) | 492 (11 %) | 2 (2 %) | 70 (21 %) |
| 300 to 500 | 25 (12 %) | 12 (15 %) | 319 (7 %) | 21 (19 %) | 54 (17 %) |
| 500 to 1,000 | 27 (13 %) | 7 (9 %) | 262 (6 %) | 21 (19 %) | 39 (12 %) |
| 1,000 to 2,500 | 12 (6 %) | 3 (4 %) | 135 (3 %) | 22 (20 %) | 20 (6 %) |
| 2,500 to 20,000 | 8 (4 %) | 0 | 55 (1 %) | 26 (23 %) | 3 (1 %) |
| 20,000 and over (not drawn) | 0 | 0 | 1 | 1 (1 %) | 0 |

Percentiles of the drawn untagged (10th, 25th, 50th, 75th, 90th), m²: the course 62, 118, 215, 439, 961; demo 46, 87, 161,
319, 583; town 46, 79, 141, 229, 521; suburb 126, 378, 878, 2,360, 5,099; farm 103, 153, 230, 376, 814. The suburb line's
untagged are different in kind: they are what a bulk tagging of houses left, the shops, flats, offices and civic
buildings (36 of 110 are on `commercial` land). **On the course 3 % of the untagged are under 25 m² (7 of 204), where a garage or shed is, and 35 % are 300 m² or more (72 of 204).**

**Shape**, of the drawn untagged:

| | Course | Demo | Town | Suburb | Farm |
|---|---|---|---|---|---|
| rectangularity, 10th / 50th / 90th | 0.72 / 0.97 / 1.00 | 0.75 / 0.98 / 1.00 | 0.76 / 0.97 / 1.00 | 0.54 / 0.91 / 1.00 | 0.73 / 0.99 / 1.00 |
| aspect, 10th / 50th / 90th | 1.10 / 1.58 / 3.00 | 1.10 / 1.50 / 2.50 | 1.09 / 1.58 / 3.42 | 1.07 / 1.65 / 2.50 | 1.12 / 1.56 / 2.49 |
| four corners | 60 % | 72 % | 60 % | 39 % | 65 % |
| five or six | 16 % | 16 % | 20 % | 15 % | 13 % |
| seven or eight | 14 % | 6 % | 11 % | 13 % | 10 % |
| nine or more | 10 % | 6 % | 9 % | 34 % | 13 % |

**Do the outlines look machine-traced? Mostly rectangular, yes; the corner angles cannot say more.**

- Across the five corridors, **60 % of untagged footprints have four corners, against 38 % of mapped ones, and 59 % are at least
  0.95 rectangular, against 37 %.** The untagged are *more* rectangular than the mapped, which is what an imported,
  regularised outline looks like beside a hand-drawn one. The median untagged footprint on every corridor but the suburb
  line is 0.97 to 0.99 rectangular.
- Within 5° of a right angle at every corner: **80 % of untagged against 71 % of mapped** (the course: 73 % against 37 %, on 54 mapped footprints, landmarks included).
  Within 0.5°: 14 to 30 % of untagged by corridor. Quantisation (above) limits the small ones, so this is read as
  "square-cornered" and not as "traced".
- **Consequence for the shape signals.** Rectangularity and corner count separate few footprints: most are clean rectangles
  whatever they are. What survives is **area and aspect** (below), and **one signal that a rectangle cannot fake — a
  party wall** (a gap to a neighbour under 1.5 m), which separates a row house from a standalone building.

**Neighbours**, the gap from an untagged footprint to the nearest house-sized one: 25th / 50th / 75th percentile, m, share within 40 m,
share with none within 100 m:

| | Course | Demo | Town | Suburb | Farm |
|---|---|---|---|---|---|
| gap | 4.0 / 10.1 / 28.3 | 2.4 / 7.4 / 16.1 | 0.0 / 5.0 / 10.3 | 5.4 / 36.9 / 69.4 | 5.0 / 10.3 / 22.0 |
| within 40 m | 68 % | 89 % | 92 % | 24 % | 86 % |
| none within 100 m | 22 % | 9 % | 3 % | 57 % | 4 % |

**Roads**, the class of the nearest road that is not a `service` road, and the setback to it, for untagged footprints by size:

| | n | primary, secondary or tertiary | residential or unclassified | none within 150 m | setback 10th / 50th / 90th, m |
|---|---|---|---|---|---|
| Course, under 75 m² | 26 | 27 % | 54 % | 19 % | 11 / 37 / 170 |
| Course, 75 to 300 | 102 | 54 % | 42 % | 4 % | 9 / 18 / 59 |
| Course, 300 and over | 72 | 56 % | 40 % | 4 % | 7 / 22 / 80 |
| Town, under 75 | 989 | 37 % | 63 % | 1 % | 7 / 16 / 52 |
| Town, 75 to 300 | 2,461 | 32 % | 68 % | 0 % | 8 / 15 / 28 |
| Town, 300 and over | 771 | 42 % | 57 % | 2 % | 8 / 16 / 59 |
| Farm, 75 to 300 | 195 | 75 % | 25 % | 0 % | 8 / 17 / 73 |
| Farm, 300 and over | 116 | 75 % | 24 % | 1 % | 12 / 22 / 104 |

(The demo, suburb line and the farm's small rows are in the same range; the suburb's setbacks are larger, a median 39 m for 300 m² and over.)

**Land use under** the untagged, by the product's `footprintUse` (all of it 'residential' unless the land says otherwise):

| | Course | Demo | Town | Suburb | Farm |
|---|---|---|---|---|---|
| residential | 92 % | 100 % | 95 % | 67 % | 97 % |
| commercial | 6 % | 0 | 3 % | 33 % | 0 |
| industrial | 2 % | 0 | 2 % | 0 | 0 |
| farmland | 0 | 0 | 0 | 0 | 3 % |

The land class under them is `other` (no polygon reaches it) for **73 % on the course, 64 % on the town line and 94 % on the farm
line.** **Farmland is not mapped where the farms are**: 11 of the farm line's 324 untagged footprints are on land the
product classes `farmland`, and 0 on the course.

### Parking

**No parking polygon reaches any of the five corridors.** The decoded `landuse` kinds across them are
`pitch`, `grass`, `residential`, `park`, `school`, `commercial`, `industrial`, `swimming_pool` and the like; none is `parking`.
Protomaps' documented `landuse` layer (read 2026-11-02 at docs.protomaps.com/basemaps/layers) lists 55 kind values and `parking` is not among them: it appears only as a *point*
kind in the `pois` layer. The decoder keeps every `landuse` kind, so it is not dropping them. **The parking half of #2026 cannot be
measured, and cannot run, on this archive.**

### What mapped footprints look like — the reference

Pooled over the five corridors (seam-cut left out); area 10th / 50th / 90th, m², and the median aspect and rectangularity.

| Mapped type | n | area | aspect | rectangularity |
|---|---|---|---|---|
| `house` | 2,786 | 70 / 320 / 595 | 1.38 | 0.84 |
| `detached` | 446 | 88 / 154 / 240 | 1.43 | 0.94 |
| `semidetached_house` | 279 | 58 / 83 / 104 | 3.31 | 0.96 |
| `terrace` | 70 | 71 / 85 / 288 | 1.94 | 0.98 |
| `apartments` | 158 | 272 / 786 / 1,317 | 2.29 | 0.99 |
| `garage` | 401 | 27 / 44 / 91 | 1.22 | 0.98 |
| `garages` | 18 | 41 / 119 / 212 | 2.68 | 0.98 |
| `shed` | 118 | 7 / 19 / 58 | 1.29 | 0.98 |
| retail, commercial, office, supermarket | 88 | 145 / 1,426 / 5,566 | 1.69 | 0.88 |
| `barn` | 5 | 328 / 401 / 718 | 1.43 | 0.80 |
| church, school, civic | 49 | 85 / 1,108 / 5,787 | 1.64 | 0.68 |

**40 of the 118 mapped sheds are under 12 m²**, the product's draw floor (`FOOTPRINT_MIN_AREA`), so no rule is asked about them.

**Published dimensions** (read 2026-11-02; vendor and guide pages, so rounded and varying by maker):

- **Garages**: a one-car garage is 12 × 20 to 12 × 24 ft (22 to 27 m²); a two-car 18 × 20 to 22 × 22 ft (33 to 45 m²); a three-car
  about 32 × 22 ft (65 m²), and 38 × 26 or 40 × 30 ft (92 to 112 m²) for the larger ones. ([Angi, *Garage Sizes*](https://www.angi.com/articles/average-garage-size.htm).)
  The mapped garages' median of 44 m² is a two-car.
- **Pole barns**: packages come in 24, 30 or 40 ft widths and any length, so 24 × 30 ft is 67 m², 30 × 40 is 111 m² and 40 × 60 is 223 m².
  ([Carter Lumber, *Agricultural Pole Barns*](https://carterlumber.com/projects/pole-barns/agricultural-pole-barns).)
- **Manufactured homes**: single-wides are 12 to 18 ft wide and 40 to 80 ft long, 480 to 1,440 ft² (45 to 134 m²), 16 × 80 ft (119 m²) the most popular. ([MHVillage, *Mobile Home Sizes*](https://resources.mhvillage.com/buyers/explore/mobile-home-sizes-guide).)
  A double-wide is about twice the width and is not long and narrow.
- **New houses**: the median size of a single-family house completed in 2025 was **2,142 ft² (199 m²)** of floor area.
  ([Census Bureau, *Characteristics of New Housing*, 2025](https://www.census.gov/construction/chars/highlights.html).) That is
  the footprint of a one-storey house and about half of a two-storey one's, before a garage. The mapped `detached` median of 154 m² agrees.

**Other renderers.** OSM2World gives every building without a type three levels of 2.5 m and a flat roof, and overrides those
only for a building **tagged** as a garage, shed, hut, cabin, greenhouse or the like; it never reads a kind from a shape
([`BuildingDefaults.java`](https://raw.githubusercontent.com/tordanik/OSM2World/master/core/src/main/java/org/osm2world/world/modules/building/BuildingDefaults.java)).
**Streets GL's defaults for a missing tag could not be confirmed** from its README or from search; they are in its source,
which was not read. So neither is a precedent for inferring a kind from geometry, and the rules here have no prior art to copy
thresholds from, which is why the corridors' own numbers carry them.

**Atwal et al. 2022** (*Scientific Reports* 12, "Predicting building types using OpenStreetMap",
[PMC9676186](https://pmc.ncbi.nlm.nih.gov/articles/PMC9676186/)) separate residential from non-residential buildings with
footprint area, the class of the roads within 30, 60 and 90 m, the size of parking lots near, the land use underneath and
OSM tags; overall accuracy 96.7 to 98.0 % over three US areas, and "building area" was the feature the decision tree split on
first (at 1,319.7 m²). The same ordering appears below: area carries the commercial call. Their parking feature is an OSM
polygon, which this archive does not carry.

### #2023: garages and sheds

**The footprints a garage or shed rule is asked about are small and square, with a house nearby.** Of the mapped garages 81 %
are under 75 m², 98 % within 40 m of a house-sized footprint, and 92 % farther from the road than that footprint; of the
mapped sheds 95 % are under 75 m², 88 % within 40 m, 77 % farther back. Mapped houses under 90 m² have a median aspect of 2.59
(they are half of a semi), against 1.21 for garages and 1.31 for sheds: **aspect, not rectangularity, separates them**, because a
garage is 0.98 rectangular and so is a terrace.

Each rule below is the issue's, then swept on the mapped footprints of the five corridors (the garage rule needs a shed
rule above it, so both are scored together; a footprint under 12 m² is not drawn):

| Rule | of the mapped footprints it calls a garage or shed, how many are one | recall of mapped garages and sheds | mapped houses called one | untagged on the course (of 200) |
|---|---|---|---|---|
| shed under 20 m², anywhere | 30 of 47 (64 %); a shed 25, a garage 5, a house-like 16, other 1 | 32 % of drawn mapped sheds (25 of 78) | 16 of 3,554 | 2 |
| garage under 75 m², aspect ≤ 1.5, rectangularity ≥ 0.9, a house-sized footprint within 40 m, farther back (as written) | 261 of 290 (90 %) | 59 % overall | 43 of 3,554 (1.2 %) | 9 |
| the same with aspect ≤ 1.75 | 302 of 339 (89 %) | 67 % | 51 | 9 |
| the same with aspect ≤ 2.0 | 319 of 377 (85 %) | 71 % | 72 | 9 |
| shed under 25 m² | 60 of 84 (71 % garage-or-shed; 37 are sheds, 44 % by type) | 47 % of sheds | 23 | 3 |
| garage under 90 m², aspect ≤ 1.75, shed under 25 | 301 of 356 (85 %) | 73 % | 76 | 13 |
| the same without the "farther back" test | 329 of 426 (77 %) | 79 % | 118 | 17 |

The "farther back" test **earns its place**: removing it costs 8 points of precision and puts 42 more mapped houses in the
garage column. The distance to a house-sized footprint (40 m) is not binding: the 90th percentile for mapped garages is 24 m.
On the town line 243 of 4,221 untagged footprints (5.8 %) would become garages and 115 (2.7 %) sheds; on the course 11 of 200 (5.5 %), on the demo 5 of 81, on the farm line 6 of 324, on the suburb line 1 of 110.

⚠️ **The setback must be to a road that is not a `service` road.** For under-75 m² footprints the nearest road is a service
road 43 to 79 % of the time.

### #2024: barns and pole buildings

**Precision is unmeasured: five mapped barns** (and no mapped `farm_auxiliary`, `cowshed` or `stable`) in all five
corridors. What can be said is about what the rule *as written* would also catch.

- **The "on farmland or rural" condition does most of the work and the farmland half cannot be used.** Only 3 % of the farm
  line's untagged are on `farmland` land (94 % are on land no polygon reaches). The stretch class `rural` is usable.
- **Without it, the rule is a house rule.** Of the mapped footprints of 100 m² or more, in `village` windows **213 of 490 are rectangular (≥ 0.9) with a house-sized footprint within 80 m nearer the road, 191 of them mapped `house` or `detached`**; in `town` windows 545 of 2,338.
- **Restricted to `rural` windows** it still reaches 22 of the course's 200 untagged footprints (11 %), 34 of the demo's 81 and 42 of the farm line's 324. That 34 of the demo's 81 pass in 3 km shows the stretch class alone does not separate a farm from a few houses: a big rectangle behind another house is also a garden house.
- **A setback condition separates the mapped barns from the mapped houses.** The four mapped barns with a measurable setback
  stand 12, 60, 86 and 248 m from the nearest non-service road, one with no road within 150 m; **mapped houses on the course, demo and farm
  line stand 19, 22 and 25 m (10th, 50th, 90th)**. Adding "at least 40 m from the nearest non-service street (or none within 150 m)":
  of 223 mapped houses of 100 m² or more and rectangularity ≥ 0.9 in `rural` or `village` windows, **1 passes**; on the
  course 10 of 200 untagged pass, the demo 12 of 81, the farm line 14 of 324. Of those, above 250 m² (the issue's pole-building line):
  7, 5 and 8.
- That 40 m is read off five barns and 35 houses. It is the best the corridors offer and it **needs the owner's frames**.
- The 250 m² line sits between a 40 × 60 ft pole building (223 m²) and a 40 × 80 (297 m²). The untagged `rural` footprints of
  100 m² or more have a median of 283 m² on the course, 251 on the demo and 276 on the farm line, so about half would be pole
  buildings: whether that is right is a question for frames, not for this data.

### #2025: manufactured homes

**The rule as written finds nothing on the course.** Long side at least 3.5× the short, short side 4 to 5.8 m, area 70 to
140 m²: **0 of 200** untagged footprints on the course, 0 of 81 on the demo, 0 of 324 on the farm line. The rule's footprints
are on the town line (78 untagged, and 181 *mapped* ones: 92 `semidetached_house` and 89 `house`) — a row house is the same
size and shape as a single-wide. Adding "no other footprint within 1.5 m" (a manufactured home stands free, a row house
shares a wall) leaves **4 untagged and 3 mapped** in all five corridors. A parallel-neighbours test (several in a park) leaves none, so it
**could not be tested here**: there is no manufactured-home park in any corridor, and the archive's type vocabulary
(`schema.ts` §`BUILDING_TYPES`) has no manufactured, mobile or static-caravan type, so there is no mapped truth to measure against either.

The issue's numbers agree with the published ones: a 14 × 60 to 18 × 80 ft single-wide is 78 to 134 m² and 4.3 to 5.5 m wide, inside the issue's 70 to 140 m² and 4 to 5.8 m. (A 12 ft wide one, 3.7 m, and an 18 × 40 ft one, aspect 2.2, are outside it.) **On the owner's course the rule would produce no before/after frame.**

### #2026: shops and commercial buildings

**300 m² is too low and the parking half has nothing to read.** On the 300 m² and over footprints that stand on a primary, secondary
or tertiary street within 30 m in a `village` or `town` window:

| Where | mapped footprints passing | commercial, industrial or warehouse | houses | apartments | other |
|---|---|---|---|---|---|
| Town line | 36 | 10 (28 %) | 14 (39 %) | 8 | 4 |
| Suburb line | 110 | 0 | 90 (82 %) | 17 | 3 |
| All five | 148 | 10 (7 %) | 104 (70 %) | 25 | 9 |

**The rule as written would draw a mapped house as a shop 104 times in 148**, because in a bulk-tagged suburb a house of 300 m² on a collector road is the commonest thing there is. Area is
the feature that carries the call: among mapped footprints of 300 m² and over, commercial ones have a median of 2,395 m²
and houses 462 m² (a rank statistic of 0.88 that a random commercial footprint is larger than a random house), and road setback, density, aspect and corner count are weaker (0.79, 0.55, 0.73, 0.42).

| Area at least, within 50 m of a primary, secondary or tertiary street, `village` or `town` | mapped passing | commercial-ish | houses | apartments | other |
|---|---|---|---|---|---|
| 300 m² | 173 | 24 (14 %) | 105 (61 %) | 31 | 13 |
| 500 m² | 111 | 20 (18 %) | 55 | 24 | 12 |
| 750 m² | 49 | 19 (39 %) | 5 | 14 | 11 |
| **1,000 m²** | **34** | **16 (47 %)** | **0** | 9 | 9 |
| 1,500 m² | 24 | 16 (67 %) | 0 | 1 | 7 |

At 1,000 m² no mapped house passes, on either line (the town line: 7 commercial of 14; the suburb line: 9 of 19). What the 1,000 m² rule gets wrong is
an apartment block or a civic building drawn as a shop, which is a flat-roofed box either way. **Recall is low by design**: 16 of the 97 mapped
commercial, industrial and warehouse footprints pass (16 %), the rest being smaller or off a main street. Without any road or stretch condition,
area alone at 1,000 m² is 31 % commercial (169 mapped), so the street is worth about 16 points.

On the course the rule as written (300 m², 30 m) would change **13 of 200**; the 1,000 m² and 50 m rule changes **2**. On the town line it changes 87
under the first, and 54 under the second.

**Parking.** The parking half cannot run (above). Carrying `amenity=parking` polygons would be a change to the project's own
archive build (#1557, ADR 0062) and a new field rule; it is not measured here and not recommended on this evidence: the
street-and-area rule is already the better half.

### #2027: copying a mapped neighbour's type

**The mechanism works where the neighbours are mapped, and on the course there is nobody to copy from.** Leave-one-out on the 4,347 mapped footprints — hide a
footprint's type, copy the nearest mapped neighbour's whose area is within ±25 %, aspect within ±25 % and rectangularity within 0.1:

| Neighbour within | Area ± | footprints that get a copy | exact type right | coarse kind right |
|---|---|---|---|---|
| 30 m | 25 % | 72 % | 98.3 % | 99.4 % |
| 50 m | 15 % | 73 % | 97.4 % | 99.2 % |
| **50 m** | **25 %** | **80 %** | **97.6 %** | **99.0 %** |
| 100 m (the issue) | 25 % | 87 % | 96.6 % | 98.3 % |
| 100 m | 40 % | 90 % | 96.0 % | 97.9 % |

The 50 m radius gives up 7 points of coverage for a point of accuracy, and the coarse kinds are house, garage or shed, apartment,
commercial, industrial, farm and civic. The control above (labels shuffled: 41.8 %) shows the measure can fail.

⚠️ **That accuracy is an upper bound.** A mapped footprint's mapped neighbours were usually mapped by the same hand in the same
session, which is not true of an untagged one, so the untagged are exactly the footprints that this leave-one-out cannot represent.

**On the course, the rule has nearly nothing to act on.** Only **13 % of the course's untagged footprints have any footprint with a mapped type within 100 m**. At 50 m and ±25 %, **0 of 200** get a copy; at 100 m with the area allowance widened to ±100 % and the
shape condition off, 6 do. The demo: 0 of 81 at 50 m and 1 at 100 m; the farm line: 0 of 324 at 50 m and 3 at 100 m. The town line has the yield (16 % of its untagged at 100 m and ±25 %) and the suburb line 5 %. **The
issue's premise — "the owner's course has 46 typed footprints to copy from" — holds, but the untagged footprints are not next to them.**
"No chains" costs nothing: the copy source is only ever a footprint with a mapped type.

## Proposed thresholds

Starting points, to be confirmed against the owner's frames. "On the course" is the number of the course's 200 drawn untagged
footprints (204, 4 of them under the draw floor) each rule would change, rule by rule.

| Issue | Rule | The issue says | Proposed | Why | On the course | Confidence |
|---|---|---|---|---|---|---|
| #2023 | shed | under 20 m² | **12 to 20 m²**, anywhere | 32 % of drawn mapped sheds are under 20 m²; precision 64 % as garage-or-shed, 53 % as a shed. Raising it to 25 m² recalls 47 % of sheds at 44 % precision | 2 | measured (n = 47 mapped) |
| #2023 | garage | under 75 m², roughly square, within 40 m, farther back | **20 to 75 m², aspect ≤ 1.75, rectangularity ≥ 0.9, a house-sized (60 to 400 m²) footprint within 40 m, farther from the nearest non-service street than that footprint** | 89 % of 339 mapped footprints called garage or shed are one; 51 of 3,554 mapped houses (1.4 %) are called one; aspect ≤ 1.5 loses 8 points of recall for 1 of precision | 9 | measured |
| #2024 | barn | 100 m² or more, rectangular, rural, behind a house | **`rural` stretch class only; 100 m² or more; rectangularity ≥ 0.9; a house-sized footprint within 80 m nearer the road; at least 40 m from the nearest non-service street**; pole building above 250 m² unchanged | without the setback test it fires on 22 of 200 untagged and on mapped houses; with it, 1 of 223 mapped houses passes | 10 (7 pole) | **unmeasured** (5 mapped barns) |
| #2025 | manufactured home | aspect ≥ 3.5, short side 4 to 5.8 m, area 70 to 140 m² | **keep these, and add "no other footprint within 1.5 m"** | the numbers agree with 14 × 60 to 18 × 80 ft; without the isolation test 181 mapped row houses and semis pass in one corridor | **0** | thresholds measured, **rule unmeasured** (no mapped truth, no park in any corridor) |
| #2026 | commercial | 300 m² or more, on a primary, secondary or tertiary street, village or town, or within 30 m of parking | **1,000 m² or more, within 50 m of a primary, secondary or tertiary street, `village` or `town` window; drop the parking half** | at 300 m² 61 to 70 % of the mapped footprints that pass are houses; at 1,000 m² none are, and 47 % are commercial | 2 | measured (34 mapped); parking **cannot be measured** |
| #2027 | copy a neighbour | within about 100 m, area ±25 %, similar shape | **within 50 m, area ±25 %, aspect ±25 %, rectangularity ±0.1, nearest first, mapped types only (not a landmark)** | 97.6 % exact on leave-one-out against 96.6 % at 100 m, for 7 fewer points of coverage | **0** | measured as an upper bound |

Across the course the five proposed rules, applied together, would change **23 of 200** untagged footprints (12 %) — 9 garages,
2 sheds, 10 barns, 2 shops and no manufactured homes or copied types, with overlaps counted once. Across the demo they change 17 of 81, the farm line 26 of 324,
the suburb line 29 of 110, and the town line 702 of 4,221.

## What this changes for the five issues

- **#2025 and #2027 will not show on the owner's course.** Neither has a footprint to act on there (0 and 0), so neither can have the
  owner-approved before/after frames the epic asks of every rule. They are worth building only if the course changes or a different
  one is wanted; the data does not support spending the draw-call and triangle budget on them first.
- **#2026's parking half should be dropped**, and its area line raised to 1,000 m². At 300 m² the rule turns mapped houses into shops.
- **#2024 is the riskiest rule**: it is the only one that can turn a house into a barn (on the course 10 of 200) and its precision cannot be measured with five mapped barns.
- **#2023 is the safest and the most useful** on the course (11 of 200), and the evidence for it is the strongest (339 mapped footprints).
- **Farm buildings are largely not mapped in the three states tried** (3, 31 and 0 footprints on three 6 to 7 km lines, in Iowa, Wisconsin and Kansas). No rule helps there; it is a map-coverage finding, not a rule one.

## Could not confirm, and limits

- **Streets GL's defaults for a missing tag** were not read (its source was not opened).
- **Which build of the archive the course's stored corridor came from.** The record does not keep the archive's identity.
- **Precision of every rule on untagged footprints.** Only mapped footprints are labelled; untagged ones are untagged because nobody tagged them, and a rule
  validated on the tagged may not hold there. The two numbers that matter, #2023's 89 % and #2026's 47 %, are upper bounds in that sense.
- **A mapped type in the course's own data** is 46 footprints (19 `house`, 7 `school`, 5 `church`, 3 each `warehouse`, `garage` and `retail`, 2 each `shed` and `commercial`, 1 each
  `apartments` and `barn`), too few to validate any rule on; the course is only described.
- **The seam-cut footprints** (59) were excluded without checking whether their other half was read.
- **The stretch class** is the product's, built per 100 m of route; a footprint takes the class of the window nearest its centroid, as `footprint-buildings.ts` takes it from the nearest road.
- **The three public lines are the ones chosen**, not a random draw of US places. They show how the numbers move between a town, a bulk-tagged suburb and a farm area, not what the US is like.
- **No visual check.** Nothing here has been drawn; a rule that is right on the numbers can still look wrong, and the epic's frames are the check.
