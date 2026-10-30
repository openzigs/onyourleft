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

Not yet measured.
