# Spike 0029: Overture building heights for US footprints — licence and attribution, coverage, and a join by OSM way id

- **Date**: 2026-10-29
- **Issue**: [#1787](https://github.com/openzigs/onyourleft/issues/1787), under the owner's
  ruling **D5 of 2026-10-27** (an Overture heights spike before any adoption) and **D6** of the
  same day (no federal datasets and no ML enrichment), both on
  [#1656](https://github.com/openzigs/onyourleft/issues/1656). Related:
  [#1557](https://github.com/openzigs/onyourleft/issues/1557) (the project's own Planetiler
  archive), [ADR 0054](../adr/0054-towns-from-real-map-data.md) D-2 and D-3,
  [ADR 0056](../adr/0056-the-demos-shipped-map-under-odbl.md),
  [ADR 0012](../adr/0012-data-licence.md) D-3.
- **Number**: **0029.** `docs/spikes/` holds 0001 to 0020 and 0022 to 0028 on `origin/main` at
  `7f7d66ab`; 0021 is claimed by [#1057](https://github.com/openzigs/onyourleft/issues/1057), and
  no open pull request carried a spike on 2026-10-29.
- **Status of this file**: the kill criterion and the measurement plan below are committed and
  pushed **before anything is measured**, as spikes 0015 and 0024 did, and their text is not
  changed afterwards. The results are appended under them.

A spike is a dated measurement that decides nothing (`docs/agents/conventions.md` §7). Adopting
Overture heights would be a new ADR, and this file does not write it.

## The question

Four questions, before anyone proposes adopting Overture Maps building heights:

1. **Licence and attribution.** What is the Overture buildings theme's licence, and which
   attribution lines would the project owe for the US heights?
2. **Coverage.** What share of OSM building footprints that carry no `height` would gain one from
   Overture, on sample small-town and suburban corridors?
3. **The join.** Can Overture's heights be joined onto our OSM footprints by OSM way id, inside the
   #1557 build?
4. **Build cost.** What does the join cost, in time and disk, on a free standard runner or on the
   owner's machine?

## Rules this spike holds

- **No identifier reaches the device, the archive or this file.** The way-id join happens inside
  the measurement only. No OSM or Overture identifier is written to a tile, a store or this
  write-up (ADR 0012 D-3, ADR 0054 D-2.2 and D-3.3).
- **No place.** Sample corridors are reported **by region class only**. This file gives no
  coordinate, no place name, no state and no route, and no tile, extract or Overture data is
  committed (CLAUDE.md §6, ADR 0004 D).
- **No paid service** (ADR 0036 D-7). If reading the Overture release needs an account, a paid
  egress or a paid query service, the spike stops and reports that as its finding.
- **One pinned release.** Overture releases monthly and the building fields have moved between
  versions, so one release is read and named, and every figure is from it.
- **No measurement script is committed.** The scripts are throwaway.

## The kill criterion, stated before measuring

Adopting Overture heights for US footprints is **not worth an ADR** if **any one** of these is true
of the measurement this spike makes. Each threshold is set now, before any Overture or OSM record
has been read for this spike.

**Two rules bind every condition**, carried from spikes 0015 and 0024:

1. **Unmeasured is not a pass.** A condition this spike could not measure, or did not, is reported
   as unmeasured, and the result is a go-signal only if every condition passes on a measurement.
2. **A sample below its floor is unmeasured.** A share is stated for a region class only on at
   least **200** OSM footprints in that class, and a median difference only on at least **20**
   pairs. Below either floor the figure is given and the class is unmeasured for that condition.

| # | Kill condition | Why this line |
|---|---|---|
| O1 | **The licence does not admit it, or reading it costs money.** The pinned release's buildings theme is not under ODbL 1.0; **or** a dataset that supplies a US height in the sample is under terms that ODbL 1.0 §4.4 would not let the project hold inside its ODbL store and archive (a non-commercial or no-derivatives term, or terms that forbid redistribution); **or** the release cannot be read without an account, a paid egress or a paid query service | ADR 0054 D-3.2 declares the store ODbL 1.0 and ADR 0056 ships a bundle under it. A source that cannot sit inside that declaration needs more than an ADR, and a paid read is ruled out by ADR 0036 D-7 |
| O2 | **It does not add enough.** Overture adds a height to **fewer than half** of the sampled OSM footprints that carry no `height` in OSM, in **two or more** of the four region classes. Put the other way, a pass needs at least 50 % in at least three of the four | The issue's suggested threshold, taken as written. A second source behind the one origin (ADR 0054 D-2.1) is a standing cost, and one that helps only some kinds of place is not worth it |
| O3 | **The heights it adds are not better than the rule we have.** Where Overture gives a height from a dataset **other than OSM** on a footprint that OSM also describes, the median absolute difference exceeds **3 m** (one storey) in any region class with at least 20 pairs, against either reference: (a) OSM's own `height`, or (b) on footprints with `building:levels` and no `height`, Protomaps' levels-derived `3L + 2` that the archive already carries (#1629) | A height that is wrong by more than a storey is no better than the storey rule (#1540) the world uses today. Overture's height on an OSM footprint may simply be OSM's own value, which agrees with itself, so only a height attributed to another dataset is an independent check |
| O4 | **The join by way id does not hold.** Of the sampled Overture building records that name an OSM way in `sources[]`, **fewer than 90 %** match a building way that a Planetiler build of the same OSM data emits as a footprint | The issue's question 3. A join that misses one footprint in ten silently leaves the misses on the storey rule, which is tolerable; one that misses more means the record ids and the build's footprints are not the same population |
| O5 | **The join costs too much to build.** Extrapolated to the US, the join adds **more than the Planetiler build's own time** on the same sample (a doubling), **or more than 50 GB** of disk beyond what the build already needs | A refresh that takes twice as long or needs a second disk is a cost every later refresh pays. Whether the result fits a free standard runner (6-hour job, 14 GB disk) or needs the owner's machine is reported in either case, and is not a kill on its own |

**What does not kill it, said now so it cannot be argued later**:

- the number of attribution lines adoption would add to the credits screen and the ADR 0056 notice:
  each is quoted and counted, and no threshold is set on them here;
- **the provenance of the heights.** If they come from a machine-learned dataset or from a
  federal survey, the shares by dataset are reported for the owner to weigh against D6. D5 asked
  for this spike after D6 was ruled, and how D6 reads on a third party's derived heights is the
  owner's, not this file's;
- that adoption needs a new ADR superseding ADR 0054 D-2 in part and amending ADR 0056: it does
  in any case, and is written down below, not started;
- a footprint that Overture draws from a dataset other than OSM, with no OSM way behind it: the
  world draws OSM footprints only, and those records are counted and set aside;
- #1557's own build not fitting a free runner: that is #1557's question, and only the join's
  extra cost is this spike's.

## The measurement plan, stated before measuring

- **The release.** The newest Overture release on the public bucket on the day of measuring,
  read **anonymously** (no credentials, no account) with DuckDB (MIT) over HTTPS or S3, filtered
  by each corridor's bounding box. The release, its schema version and the OSM snapshot date its
  notes give are named in the results.
- **The licence.** Overture's licence and attribution pages, the release notes for the pinned
  release, the ODbL 1.0 text and the licence of each dataset that appears in the sample's
  `sources[]`, each read first-hand and quoted with its URL and the date read.
- **The corridors.** Four, one per region class, chosen **before any record is read**, each a
  rectangle of about 4 km² around a through road: (R1) a small farm-belt town; (R2) an inner
  suburb of a large metro, mostly built before 1960; (R3) an outer suburb, mostly built after
  1980; (R4) a small hill or mountain town. The choice is kept outside the repository and is not
  reported.
- **OSM.** For each corridor, a regional OpenStreetMap extract (Geofabrik, free, no account) dated
  as near the release's OSM snapshot as is offered, the gap stated. A footprint is a way or a
  multipolygon relation with a `building` tag other than `no`, inside the rectangle. Counted per
  class: footprints; the share with `height`; the share with `building:levels`.
- **The join.** Each Overture record in the rectangle is read with its `height` and its
  `sources[]`. A record names an OSM way when an entry's `dataset` is OSM and its `record_id` is
  `w<id>@<version>`. Counted: the share of records that name one; the share of those whose way is
  among the footprints a Planetiler (Apache-2.0) build of the same extract emits on its building
  layer; and, of the matches, the share whose version differs from the extract's, with what the
  record's height does then.
- **Coverage and agreement.** For the OSM footprints with no `height`, the share whose joined
  Overture record carries a height, by the dataset `sources[]` attributes the height to. O3's
  pairs and their median absolute difference, by reference (a) and (b).
- **The cost.** The Planetiler build of the extract timed with and without a lookup that joins an
  Overture height onto each building way by id, on this machine, three runs each, with the peak
  extra disk; and the time and size of extracting the Overture height table for the extract's
  area. Both are extrapolated to the US by the ratio of footprints, and set against a free
  standard runner's limits.
- **The machine.** Recorded with the results: model, memory, operating system, Java and DuckDB
  versions.

## Results

Measured on **2026-10-29**, after the commit above was pushed.

> ## ⚠️ The answer in one paragraph
>
> **No kill condition trips, and the result is still not a go-signal**: three of the five are
> unmeasured, and rule 1 says unmeasured is not a pass. The join by way id **works**: every one
> of the 4,578 sampled Overture records that names an OSM way matched a footprint the Planetiler
> build emitted (O4), and the US join costs about **9 minutes and 1.3 GB** on top of a
> buildings-only build extrapolated to about 21 minutes (O5). Coverage is **38 %** in the farm-belt town, **84 %** in the
> inner suburb and **74 %** in the outer suburb, and the hill town has too few OSM footprints
> (140) to count (O2). Not one sampled OSM footprint carries a `height`, so no corridor gives the
> 20 independent pairs O3 needs. On the licence, the theme is ODbL and reading it is free, but two
> of the three datasets behind the US heights could not be read first-hand: **Esri's** CC BY 4.0
> waiver for OpenStreetMap and **USGS's** terms (O1). The finding the owner most needs is
> provenance: across the US, **86 %** of the heights Overture would add are Microsoft's
> **machine-learned** estimates and **11 %** are **USGS lidar**. Ruling D6 says no federal
> datasets and no ML enrichment.

### What was read, and on what

| | |
|---|---|
| **Machine** | Apple M4 Pro, 12 cores, 24 GB, macOS 26.6.2; Temurin Java 21.0.10; Planetiler 0.10.2 (the release jar); DuckDB 2.0.0 and pyosmium 4.3.2 in a throwaway Python 3.14 environment. ⚠️ **The machine was shared**: other agents were building and testing in sibling worktrees, and the load average was 25 to 36 on 12 cores while the builds ran. Every time below is a wall-clock figure under that load |
| **Overture release** | **`2026-10-21.0`**, schema **v2.0.0**, the newest on the bucket that day. Read **anonymously**: no account, no credentials and no paid query service, from the public `overturemaps-us-west-2` bucket with DuckDB's `httpfs`. ADR 0036 D-7 holds |
| **Its OSM data** | The release notes give the buildings theme an **OSM cut-off of 2026-09-12** and say *"No changes, re-promoted the data from the September release."* So October's buildings are September's |
| **OSM extracts** | Geofabrik's free regional extracts, the ones dated **2026-09-01** (replication time `2026-09-01T20:20:50Z`, **11 days before** the cut-off; the next one offered was 19 days after), each checked against its published MD5. For the version question, one state's extract of **2026-10-28** too |
| **Planetiler build** | A throwaway profile with one layer, shaped like the Protomaps `buildings` layer that #1557 would build, read at `protomaps/basemaps` `42ffaaa4` (2026-09-11). It emits a polygon for each `building` other than `no`, at zooms 11 to 15. Its height is `height`, or else `max(levels, 1) × 3 + 2`, and its feature id carries the OSM id (as `id × 10 + 2`; Protomaps' `FeatureId.create` packs it as `(type << 44) | id`), which is how the match below is read back from the tiles. In join mode it also loads a `(way id, height)` table into a primitive map and gives a way that has no `height` and no `building:levels` the joined height. **Only the buildings layer was built**, not the whole basemap, so its time is a floor on #1557's |
| **Corridors** | Four rectangles of about 4 km² each, one per region class, chosen before any record was read. They sit in three states' extracts and are named nowhere here. A footprint counts when its centroid is inside the rectangle, and so does an Overture record when the centre of its bounding box is |

### Licence and attribution, read first-hand on 2026-10-29

**Overture's attribution page**, <https://docs.overturemaps.org/attribution/> (*"Last updated on
May 15, 2026"*; the site serves the v2.0.0 docs). Under **Buildings**:

> **License for theme:** ODbL
>
> - © OpenStreetMap contributors. Available under the Open Database License.
> - Esri Community Maps contributors. Available under CC BY 4.0.
> - Global ML Building Footprints. Licensed by Microsoft under the Open Database License.
> - Google Open Buildings. Available under CC BY 4.0.
> - USGS 3D Elevation Program Digital Elevation Program.
> - Qian Shi, et al. A First High-quality Vector Data of Buildings in East Asian Countries Based on
>   a Comprehensive Large-scale Mapping Framework. Zenodo, 22 July 2023, doi:10.5281/zenodo.8174931.
>   Available under CC BY 4.0.
> - Work derived from BTN 2024 ign.es. Available under CC BY 4.0

The general line on the same page reads: *"If you are the author of a publication or research report
that uses Overture data, you may choose to add the following citation, including the date the data
were accessed: Overture Maps Foundation, overturemaps.org."* Its example for a map reads:
*"© OpenStreetMap contributors, Overture Maps Foundation."* **The USGS line names no licence.**

**The release itself labels each source.** Every entry in a record's `sources[]` has a `license`
field, and in the sample it took exactly three values:

| `sources[].dataset` | `sources[].license`, as written in the data |
|---|---|
| OpenStreetMap; Microsoft ML Buildings | `ODbL-1.0` |
| Esri Community Maps | `Creative Commons by Attribution (CC BY 4.0) with OpenStreetMap waivers` |
| USGS Lidar | **null** |

**Microsoft has changed its licence since then.** The `GlobalMLBuildingFootprints` README, read at
`c691ea1a` (2026-08-14), says: *"This data is licensed by Microsoft under the
[CDLA Permissive 2.0](https://cdla.dev/permissive-2-0/)."* The README's history shows that line
replacing the ODbL one on **2026-03-11** (`ef94ee3d`). Overture's page and its records still say
ODbL. The CDLA Permissive 2.0 text (<https://cdla.dev/permissive-2-0/>) reads: *"2.1. A Data
Recipient may share Data, with or without modifications, so long as the Data Recipient makes
available the text of this agreement with the shared Data."* and *"3.1. This agreement does not
impose any restriction or obligations with respect to the use, modification, or sharing of
Results."* Neither licence stops the project holding the heights. Which one binds a given height is
the ADR's question, and under CDLA §2.1 the agreement's text would travel with the ADR 0056 bundle.

**ODbL 1.0**, <https://opendatacommons.org/licenses/odbl/1-0/>. The theme is itself an ODbL
Database, so the grant that admits it is the licence's own **§3.1**: *"The rights granted cover, for
example: a. Extraction and Re-utilisation of the whole or a Substantial part of the Contents;
b. Creation of Derivative Databases; c. Creation of Collective Databases …"*. A join table is a
Derivative Database (**§4.4 b**: *"Extraction or Re-utilisation of the whole or a Substantial part
of the Contents into a new database is a Derivative Database and must comply with Section 4.4."*),
and our store and archive stay under **§4.4 a**: *"Any Derivative Database that You Publicly Use
must be only under the terms of: i. This License …"*. The clause that limits what may be admitted is
**§4.4 d**: *"You must not add Contents to Derivative Databases under Section 4.4 a that are
incompatible with the rights granted under this License."*

**That clause is where the CC BY line matters.** The OSMF's licence-compatibility page
(<https://wiki.osmfoundation.org/wiki/Licence/Licence_Compatibility>) says: *"all CC BY versions
have additional terms that make them incompatible with OpenStreetMap without explicit waivers."*
The OSM wiki's list of Esri's datasets (<https://wiki.openstreetmap.org/wiki/Esri/ArcGIS_Datasets>)
labels them *"CC-BY 4.0 with Waiver for OpenStreetMap"*. ⚠️ **The waiver itself was not read
first-hand.** Esri's Community Maps Data Sharing post returned HTTP 403 to this read, so this file
cannot quote it, or say whether it reaches a project that takes the data through Overture rather
than through OpenStreetMap. ⚠️ **Nor were USGS's terms read**: its copyrights-and-credits page also
returned 403. US federal survey data is usually public domain, but that is not a quotation and is
not relied on here.

**The attribution lines adoption would add**, to the credits screen and to the ADR 0056 notice.
Lines 2 to 4 are Overture's own wording from the page above:

1. **Overture, always.** The theme is an ODbL Database, so ODbL §4.3 asks for a notice. Its §4.3 a
   example, with the database named the way ADR 0056 D-3.3 names OSM, would read: *"Contains
   information from the Overture Maps buildings theme, which is made available here under the Open
   Database License (ODbL)."* The database's name in that line is this file's suggestion, not
   Overture's.
2. **Microsoft, always**, because it supplies every height in three of the four classes:
   *"Global ML Building Footprints. Licensed by Microsoft under the Open Database License."* If the
   CDLA reading holds, the bundle also carries the CDLA Permissive 2.0 text.
3. **Esri, only if its heights are admitted**: *"Esri Community Maps contributors. Available under
   CC BY 4.0."*
4. **USGS, only if its heights are admitted**: *"USGS 3D Elevation Program Digital Elevation
   Program."*

So adoption adds **two lines at least, and four at most**, beside today's *"© OpenStreetMap
contributors"*.

**Overture's retention rule binds the build.** The release page says: *"Overture maintains publicly
available data releases for a maximum of 60 days (two monthly releases)"*. A #1557 refresh either
reads a release within its 60 days or keeps its own copy of the join table, which is ODbL data
under §4.4.

### Coverage, by region class

The four committed corridors, then the supplementary one (below the table):

| Region class | OSM footprints | with `height` | with `building:levels` | Overture adds a height | where it comes from | median abs diff, both present |
|---|---|---|---|---|---|---|
| R1 small farm-belt town | 353 | 0.0 % | 0.0 % | **38.2 %** (135) | all Microsoft ML | no pair |
| R2 inner suburb, mostly pre-1960 | 2,625 | 0.0 % | 0.8 % | **83.7 %** (2,196) | all Microsoft ML | no pair with `height`; 11 with levels, 3.9 m |
| R3 outer suburb, mostly post-1980 | 1,466 | 0.0 % | 0.1 % | **73.7 %** (1,081) | all Microsoft ML | no pair with `height`; 1 with levels, 0.6 m |
| R4 small hill town | **140**, under the floor | 0.0 % | 5.0 % | 83.6 % (117) | 77 Esri, 40 Microsoft ML | no pair with `height`; 6 with levels, 1.6 m |
| *R4b, supplementary:* a second small hill town | 1,427 | 0.0 % | 0.4 % | 85.9 % (1,226) | 1,028 Esri, 173 Microsoft ML, 25 USGS | no pair with `height`; 5 with levels, 1.0 m |

- **Not one sampled OSM footprint carries `height`**: 0 of 6,011, across all five corridors.
  `building:levels` is rare too.
- **R4b was added after R4 came in under the floor.** It was chosen before any record of its own
  rectangle was read. It sits outside the committed plan, so it is reported here and **not counted
  against any condition**.
- **What the classes miss is footprints, not heights.** In R1, Overture holds 2,017 buildings, and
  1,664 of them (82.5 %) are Microsoft ML footprints that OSM does not map at all. R4 is the same:
  713 of its 925 are Esri footprints. The world draws OSM footprints only, so a height join leaves
  that gap where it is.
- **Overture never overrides OSM's own height.** Across three whole state extracts, 11,629 building
  ways carry `height`, and only **2** of them also have an Overture height attributed to another
  dataset. So O3(a)'s pairs cannot come from the join at any sample size.
- **Supplementary O3(b), outside the plan.** Over those three whole extracts, **108,598** building
  ways have `building:levels`, no `height`, and an Overture height from another dataset. The median
  absolute difference from `3L + 2` is **2.1 m**, and 75.2 % are within 3 m. That is a statewide
  figure and not a region class, so it decides nothing about O3.
- **Sliced by D6's terms**, the share Overture adds: from Microsoft ML alone, R1 38.2 %, R2 83.7 %,
  R3 73.7 %, R4 28.6 %, R4b 12.1 %. From the one source that is neither machine-learned nor federal,
  Esri: R1 to R3 0 %, R4 55.0 %, R4b 72.0 %.

### The join, tested

- **The share of sampled Overture records that name an OSM way** in `sources[]`, as
  `w<id>@<version>`: R1 17.5 %, R2 94.8 %, R3 78.6 %, R4 15.1 %. That is 4,578 of 7,571 in the four
  committed corridors, or 60.5 %. Another 4 name a relation. The rest are Microsoft or Esri
  footprints with no OSM way behind them.
- **The share of those that match a footprint the Planetiler build emitted**, read back from the
  z15 tiles' feature ids over each rectangle: **100.0 % in every class** (353 of 353, 2,621 of 2,621,
  1,464 of 1,464, and 140 of 140). Every OSM footprint way in the rectangles but one has an Overture
  record that names it.
- **One whole state**: of the 535,261 building ways in its extract, 338,967 (63.3 %) found a height
  in the US join table. 329,495 of them (61.6 %) took it, because they had no `height` and no
  `building:levels` of their own.
- **When the OSM version differs from the record's.** The join keys on the way id and **ignores the
  version**, so the height lands either way. At 11 days before the cut-off, 2 of the 4,578 sampled
  matches differ, both newer in the record, and both carry a height. Across the whole state, 75 of
  338,923 differ. Against the **2026-10-28** extract, seven weeks after the cut-off, **4,588 of
  338,923 (1.35 %)** have moved on from the record's version and 58 are gone. That is the drift a
  build from a current planet would see. Of all 5,952 building ways in that state whose version
  changed between the two extracts, **325 (5.5 %) changed their node list**. The rest were tag-only
  edits, and only 1 gained a `height` and 43 gained `building:levels`. So about one changed
  footprint in eighteen may carry a height measured for an older shape. Checking the version
  instead of ignoring it would drop that 1.35 %.
- **No identifier left the build.** The way id is read inside the build and only a height is
  written. ⚠️ **Protomaps already sets an OSM-derived feature id** on every building in its archive
  (`FeatureId.create`, `(type << 44) | id`), which ADR 0054 D-2.2 drops on read. A join adds no
  identifier that is not already in the tile, and the ADR should know that one is there.

### The cost, measured and extrapolated

**Reading Overture for the US.** One streaming DuckDB query over a rectangle around the
contiguous US took **348 s** to read and write, and **355 s** in total. Its peak memory footprint
was 10.9 GB under an 8 GB memory limit. It found **85.1 million** records naming an OSM way. The
rectangle takes in border strips of Canada and Mexico, so that is an overcount. Of them, **52.1
million** carry a height attributed to another dataset:

| Height source, US | Records | Share of added heights |
|---|---|---|
| Microsoft ML Buildings (`ODbL-1.0` in the data) | 45,013,399 | **86.4 %** |
| USGS Lidar (licence **null** in the data) | 5,587,868 | **10.7 %** |
| Esri Community Maps (CC BY 4.0 with OSM waivers) | 1,482,826 | 2.8 % |

The join table, `(way id, height)` as CSV, is **752.5 MB**. The run also wrote a 2.9 GB
intermediate file, which a build does not need.

**The build, one state, three runs each, alternating:**

| Run | Base | Join (that state's table, 0.58 M entries) |
|---|---|---|
| 1 | 8.16 s | 9.84 s |
| 2 | 10.22 s | 9.81 s |
| 3 | 8.67 s | 9.19 s |
| **Median** | **8.67 s** | **9.81 s** |

With the **whole US table** loaded (52.1 M entries), under heavier load, the build took 54.8, 57.4
and 60.6 s, against 21.5, 22.2 and 27.3 s for the base build. **Loading the table took 19.5 to
35.5 s** of each, and the build's resident memory rose from 1.9 to 3.0 GB to 5.5 to 6.3 GB. The
join made the same 329,495 heights with either table. The buildings-only archive grew from
33.85 MB to 37.58 MB (**+11.0 %**), because more footprints carry a height.

**Extrapolated to the US** by building ways: 79,038,088 in the US against about 0.54 million in
the state, both from Geofabrik's taginfo with data to 2026-10-28, a factor of **145.5**.

| | US, extrapolated or measured |
|---|---|
| Buildings-only build, base | 8.67 s × 145.5 ≈ **21 min** (≈ 54 min at the contended rate). #1557's whole basemap takes longer |
| Overture read | **5.9 min**, measured at US scale |
| Table load | **20 to 36 s**, measured at US scale |
| Per-way lookups | (9.81 − 8.67) s × 145.5 ≈ **2.8 min**. The difference is about the size of the run-to-run noise |
| **The join's extra time** | **≈ 9 min** |
| **The join's extra disk** | 0.75 GB table + 11 % on the buildings layer (≈ 0.54 GB) ≈ **1.3 GB** |
| The join's extra memory | ≈ 3 GB of heap for the table; the read is a separate step, 10.9 GB peak |

**Against a free standard runner** (`ubuntu-latest` on a public repository: 4 CPUs, 16 GB RAM,
14 GB SSD, per GitHub's runner reference read on 2026-10-29; the 6-hour job limit is the issue's
figure, not re-read): the join's own 9 minutes, 1.3 GB and 3 GB of heap would fit. **The US build
it rides on would not fit the disk**: Geofabrik's US extract of 2026-09-01 is 12.1 GB alone, which
leaves under 2 GB of the 14 for Planetiler's temporary files and its output. That is #1557's
question, and the answer this spike points to is **the owner's machine**.

### The kill criterion, judged

| # | Result | Verdict |
|---|---|---|
| O1 | The theme is **ODbL** and reading it is **free and anonymous**. Microsoft's heights are ODbL in the data and CDLA Permissive 2.0 in Microsoft's README since 2026-03-11; both admit them. **Esri's waiver and USGS's terms were not read first-hand** (both pages returned 403), so it is not shown that ODbL §4.4 d admits them | **Unmeasured**, not tripped. A join that takes Microsoft's heights only would rest on text that was read |
| O2 | R1 **38.2 %** (under half); R2 **83.7 %**; R3 **73.7 %**; R4 **unmeasured** (140 footprints, under the 200 floor) | **Unmeasured**: one measured failure, where the kill needs two; two measured passes, where a pass needs three. R4b's 85.9 % would make a third, but it is outside the plan |
| O3 | **No class reaches 20 pairs**: (a) none anywhere, (b) 11, 1 and 6 | **Unmeasured.** (a) cannot be measured through this join at any size, because Overture keeps OSM's own height. The supplementary (b), 2.1 m over 108,598 pairs, sits under the 3 m line |
| O4 | **100.0 %** in every class | **Pass** |
| O5 | ≈ 9 min against a build of at least 21 min; ≈ 1.3 GB against 50 GB | **Pass**, on figures taken on a shared machine |

**No condition trips, and the result is not a go-signal**, because O1, O2 and O3 are unmeasured.
The next measurement that would close each one: for O1, the Esri waiver's text and USGS's terms read
first-hand, or a decision to join Microsoft's heights only; for O2, a hill-town class with enough
OSM footprints, committed before it is read; for O3, an independent height (a surveyed sample, or
the owner's eye on the tablet) rather than OSM's own, which the join never overlaps.

**D6 is the owner's, and this file does not read it.** Every height the join adds in R1 to R3 is
Microsoft's machine-learned estimate. Across the US, 86.4 % are, and 10.7 % are USGS lidar.

### What adoption would take, written down and not started

1. **A new ADR**, numbered with whatever is free when it is written. `docs/agents/conventions.md`
   §7 gives **0060** on 2026-10-29: the issue's 0059 has since been taken. It would:
   - supersede **ADR 0054 D-2 in part**: a second source behind the one origin, read at build time
     and never at runtime;
   - amend **ADR 0056** for the attribution lines above, for the CDLA text if Microsoft's current
     licence is the one that binds, and for its D-3.4 (§4.4 d: nothing incompatible is added),
     which would have to be answered again for the added heights;
   - say which datasets' heights are admitted (Microsoft only, or with Esri and USGS) once O1's two
     unread texts are read;
   - record the owner's reading of **D6** on a third party's machine-learned and federal heights;
   - choose between a version-blind join and a version-checked one.
2. **A build change to #1557.** A step that reads the pinned Overture release anonymously and keeps
   the `(way id, height)` table, within Overture's 60-day window or as the build's own ODbL copy.
   Then the lookup in the buildings layer, for a way with no `height` and no `building:levels`.
   The way id is consumed in the build and never written.
3. **The credits screen and the ADR 0056 notice**, with two to four lines.

**None of this is started**, and writing the ADR is out of scope until the owner has ruled on this
report (#1787).

### What this spike did not do

- **Built only the buildings layer**, not the whole Protomaps basemap. So its base time is a floor,
  which makes O5's ratio an upper bound.
- **Took its times on a shared machine** under heavy load from other work. The medians are given
  with every run, and the join's per-way cost is about the size of the noise.
- **Read neither the Esri waiver nor USGS's terms** (403 on both). Nothing above relies on either.
- **Used a rectangle for the US**, which takes in border strips of Canada and Mexico and leaves out
  Alaska and Hawaii.
- **Committed no script, tile, extract or Overture record.** The corridors are written nowhere in
  the repository.
