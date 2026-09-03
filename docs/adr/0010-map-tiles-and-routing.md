# ADR 0010: Map tiles, routing and elevation — providers, licences and cost

- **Status**: Accepted
- **Date**: 2026-09-03
- **Deciders**: **No owner decision was sought or given for this ADR, and none is claimed.** Unlike
  [ADR 0008](0008-mobile-client-architecture.md), whose four decisions are the repository owner's
  rulings written up, every decision below is the author's engineering work. It is nonetheless not
  a free choice: **D-1 to D-7 are derived from two decisions that are already merged** —
  [ADR 0002](0002-local-first-architecture.md) decision A, which forbids the deployment unit from
  requiring "a cloud object store, a CDN account, or per-request-billed compute", and
  [ADR 0001](0001-licence.md) §3 as tightened by `CLAUDE.md` §3, which makes the licence boundary a
  path and admits **no GPL or AGPL dependency anywhere under `packages/`, with no exemption**. Where
  this ADR goes beyond deriving, it says **author's judgement** in the line. Where a figure or a
  licence is asserted, it carries the **URL and the date it was read**, so a reader can recheck
  rather than trust
- **Issue**: [#60](https://github.com/openzigs/onyourleft/issues/60)
- **Supersedes**: nothing
- **Constrains**: [#53](https://github.com/openzigs/onyourleft/issues/53) (which this ADR corrects
  in four places), [#63](https://github.com/openzigs/onyourleft/issues/63),
  [#70](https://github.com/openzigs/onyourleft/issues/70),
  [#72](https://github.com/openzigs/onyourleft/issues/72),
  [#54](https://github.com/openzigs/onyourleft/issues/54), and the map-rendering half of
  [#12](https://github.com/openzigs/onyourleft/issues/12) and of
  [#55](https://github.com/openzigs/onyourleft/issues/55)
- **Relates to**: [ADR 0001](0001-licence.md) (the licence boundary, and the ODbL question it
  **defers** — see the boundary note below), [ADR 0002](0002-local-first-architecture.md) (the
  deployment unit these numbers must fit inside),
  [ADR 0003](0003-platform-support-matrix.md) (whose habit of dating every drifting figure this ADR
  copies), [ADR 0004](0004-privacy-and-location.md) (the privacy half of what a map may display),
  [ADR 0006](0006-fit-codec-licensing.md) (the evidence standard this ADR tries to match),
  [ADR 0007](0007-patent-posture.md) (which names #55/#60 as the place popularity data would feed
  routing, and forbids promising it)

> **This ADR decides providers and creates no infrastructure and no code.** It does not stand up a
> tile server or a routing engine ([#53](https://github.com/openzigs/onyourleft/issues/53)), add a
> dependency, touch the lockfile, or implement map rendering
> ([#63](https://github.com/openzigs/onyourleft/issues/63)). Everything here is a constraint on
> those issues. Nothing here is in Phase 1: owner decision D6 puts the whole of #17 in Phase 3, and
> the Phase 1 product renders no map at all.

> ⚠️ **Two questions that look like this one's and are not.** The **ODbL Derivative Database**
> question for *stored segment and route geometry* is deferred by ADR 0001 and owned by
> [#64](https://github.com/openzigs/onyourleft/issues/64); the privacy half of what may be drawn
> from a stored trace is [ADR 0004](0004-privacy-and-location.md)'s. **This ADR decides neither and
> contradicts neither.** What it does settle is the narrower, already-settled part: an OSM-derived
> *basemap tile* is a **Produced Work**, needs **attribution and nothing more**, and that is stated
> by the publisher of the archive we consume, quoted below.

---

## Context

### Why this is a licence decision at least as much as a technical one

`CLAUDE.md` §3 makes the licence boundary a **path**: everything under `packages/` is Apache-2.0,
everything under `apps/` is AGPL-3.0-or-later, and a GPL or AGPL dependency anywhere under
`packages/` fails CI with no exemption. So "which engine" is not a taste question settled in review.
It decides which directory the code that talks to the engine may live in, and therefore whether an
offline or in-browser router is ever possible at all.

[ADR 0001](0001-licence.md)'s own *Constraints on other work* section already carries this as an
open item, verbatim:

> **#53 must re-check its routing engine choice.** OpenRouteService is **GPL-3.0**, pgRouting is
> **GPL-2.0**, tilemaker is FTWPL, and planetiler-openmaptiles carries a bespoke MapTiler/Klokan
> licence with attribution obligations. #53 currently names ORS as the bootstrap without flagging
> its licence.

**This ADR discharges that item.** #53's body still recommends starting on OpenRouteService's free
public tier; **D-4 replaces that**, and for two reasons, only one of which is the licence.

### Why it is a cost decision at least as much as a technical one

[ADR 0002](0002-local-first-architecture.md) decision A fixes the deployment unit as one small
self-hostable instance and states what it **must not require**:

> Kubernetes, a managed database, a cloud object store, a CDN account, or **per-request-billed
> compute**. Each of those is a second bill and a second operator skill.

A tile pipeline is the heaviest thing anyone would put inside that box, and a metered tile API is
exactly the per-request bill that clause exists to exclude. The product is free to the end user, so
a cost that scales with popularity is not a budgeting problem; it is a design defect that surfaces
as a bill on the day the product succeeds. #17's own model makes the size of it plain: swap
self-hosted tiles for a commercial tile API and the whole instance goes from ≈$88/month to
≈$1,031/month, **92% of it tiles**.

### Sources, with the date each was read

Everything below was read on **2026-09-03** unless stated. Licence texts were fetched from each
project's own repository through the GitHub API and hashed, so a future reader can tell whether the
terms moved rather than trusting this summary. **Reproduce any row with:**

```bash
gh api repos/<owner>/<repo>/contents/<path> -q .content | base64 -d | shasum -a 256
```

| Project | Licence file | SPDX / character | SHA-256 of the fetched text |
| --- | --- | --- | --- |
| `valhalla/valhalla` | `COPYING` (`LICENSE.md` is a 44-byte pointer to it) | **MIT** | `8bdb14aebb005ffa75ee3890aa10b242b30c840caa01b996c56338ca279f37cd` |
| `Project-OSRM/osrm-backend` | `LICENSE.TXT` | **BSD-2-Clause** (GitHub-detected) | — |
| `graphhopper/graphhopper` | `LICENSE.txt` | **Apache-2.0** (GitHub-detected) | — |
| `abrensch/brouter` | `LICENSE` | **MIT** (GitHub-detected) | — |
| `GIScience/openrouteservice` | `LICENSE` | **GPL-3.0** (GitHub-detected) | — |
| `pgRouting/pgrouting` | `LICENSE` | **GPL-2.0** (GitHub-detected) | — |
| `systemed/tilemaker` | `LICENCE.txt` | **FTWPL** — a 203-byte WTFPL variant; **not an OSI-approved licence** | `d0e2c59a956e30421ec2e43f4023aac9468b96ff1433b2b5de72451eefed0fb4` |
| `onthegomap/planetiler` | `LICENSE` | **Apache-2.0** (GitHub-detected) | — |
| `openmaptiles/planetiler-openmaptiles` | `LICENSE.md` | **Split: BSD-3 code + CC-BY-4.0 design, with a credit obligation** | `66aaa5af7ac728dd9a26ba91c85837bbfca269ac41ec302650f228e1fbe85fa6` |
| `protomaps/basemaps` | `LICENSE.md` | **BSD-3 code + CC0 visual design** | `74f975cfedd168098c43b5cfd6e587e40604684c4ffcec3e90d24b3b09c061b0` |
| `protomaps/PMTiles` | `LICENSE` | **BSD-3 reference implementations; the specification itself public domain / CC0** | `0371c38f338835f7fc13ed71176f3d92144e22c8b736a31cced57adbbeb647b3` |
| `protomaps/go-pmtiles` | `LICENSE` | **BSD-3-Clause** (GitHub-detected) | — |
| `maplibre/maplibre-gl-js` | `LICENSE.txt` | **BSD-3**, plus attached notices for inherited `mapbox-gl-js` ≤ v1.13 (BSD-3) and `glfx.js` (MIT) | `ee5fc05a0677eaf69601d2c7db0d9ecd6cc27c3abc1d0733bc9ed34707cf8ef2` |
| `maplibre/martin` | `LICENSE-APACHE` | **Apache-2.0** (GitHub-detected) | — |
| `mapterhorn/mapterhorn` | `LICENSE` | **BSD-3-Clause** for the code; terrain data "various open-data sources" | — |

Latest release of each, read from the GitHub releases API on **2026-09-03**:

| Project | Latest release | Published |
| --- | --- | --- |
| Valhalla | `3.8.3` | 2026-07-25 |
| OSRM | `v26.9.0` | 2026-09-01 |
| GraphHopper | `11.0` | 2025-10-14 |
| BRouter | `v1.7.10` | 2026-07-17 |
| OpenRouteService | `v9.10.0` | 2026-07-28 |
| MapLibre GL JS | `v6.7.0` | 2026-09-02 |
| Martin | `martin-v1.15.0` | 2026-09-02 |
| go-pmtiles | `v1.31.2` | 2026-07-22 |
| planetiler | `v0.10.2` | 2026-03-29 |
| tilemaker | `v3.2.0` | 2026-08-29 |

Prices and terms, each with its page:

| Fact | Source | Read |
| --- | --- | --- |
| R2: storage **$0.015/GB-month**; Class A **$4.50/M**; Class B **$0.36/M**; **egress free**; free tier 10 GB-month + 1 M Class A + 10 M Class B | `https://developers.cloudflare.com/r2/pricing/` — page states "Last updated Aug 7, 2026" | 2026-09-03 |
| Backblaze B2: **$6.95/TB/month** (= **$0.00695/GB-month**); free egress to 3× average monthly storage then $0.01/GB; **unconditionally free egress via Cloudflare, Fastly, bunny.net and others**; **Class A, B and C API calls are free** on pay-as-you-go | `https://www.backblaze.com/cloud-storage/pricing` | 2026-09-03 |
| Google **Dynamic Maps** (per map load): free cap **10,000**, then **$7.00 / $5.60 / $4.20 / $2.10 / $0.53** per 1,000 across the published tiers | `https://developers.google.com/maps/billing-and-pricing/pricing` | 2026-09-03 |
| Google **Map Tiles API: 2D Map Tiles** (per tile): free cap **100,000**, then **$0.60 / $0.48 / $0.36 / $0.18 / $0.045** per 1,000 | same page | 2026-09-03 |
| Google **Elevation API**: free cap **5,000**, then **$5.00 / $4.00 / $3.00 / $1.50 / $0.38** per 1,000 | same page | 2026-09-03 |
| Protomaps cost calculator, at its own defaults (10 M tile requests, 50% cache hit, 110 GB stored, 1,000 GB egress): **AWS $119.56/mo, Cloudflare $11.45/mo, Google Dynamic Maps $3,640/mo** | `https://docs.protomaps.com/deploy/cost` | 2026-09-03 |
| "Cloudflare R2 is known to have higher latency (500ms or higher) than other Cloud Storage products, but lower storage and no egress costs." | `https://docs.protomaps.com/deploy/cloudflare` | 2026-09-03 |
| Deployment comparison chart: **Cloudflare latency 🚀, AWS 🚀🚀🚀**, with the scale defined as "Speedy maps tiles 🚀🚀🚀 load in ≤ 200 ms in the client for customers, slow tiles 🚀 load ≥ 500 ms" | `https://docs.protomaps.com/deploy/` | 2026-09-03 |
| "A full planet file is roughly **120 gigabytes**, including zoom levels from 0 to 15… distributed as an Open Database License Produced Work (OpenStreetMap attribution required)"; **daily build channel**, BLAKE3 hashes published, "All builds for the past week" retained; "hotlinking to these downloads are discouraged" | `https://docs.protomaps.com/basemaps/downloads` | 2026-09-03 |
| Pinball Map's first month on R2 after leaving Mapbox: **"$1.67 and this next month will likely be $0"**, "Our bill for the month was entirely for storage. The 111gb we are storing cost us $1.67", archive "like 115-120gb", upload "took 24 hours from my home network", ~1 M Class B requests in the month at 50–60 k prior Mapbox map loads | `https://blog.pinballmap.com/2024/11/05/protomaps-tile-hosting/` | 2026-09-03 |
| OpenFreeMap: "Using our public instance is completely free: there are no limits… We aim to cover the running costs of our public instance through donations" and **"I believe it can be self-sustainable if enough people subscribe to the support plans"** | `https://openfreemap.org/` | 2026-09-03 |
| Copernicus DEM: DSM "including buildings, infrastructure and vegetation"; GLO-30/GLO-90 "available worldwide with a free license"; **"The datasets were made available for use in 2019 and will be maintained until 2026"**; the exact attribution notice quoted in D-5 | `https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM` | 2026-09-03 |
| Copernicus GLO-30 Public: `s3://copernicus-dem-30m`, `--no-sign-request`, Cloud-Optimized GeoTIFF, STAC v1.0.0; "a small subset of tiles covering specific countries are not yet released to the public" | `https://registry.opendata.aws/copernicus-dem/` | 2026-09-03 |

**Three sources this ADR deliberately does not rely on, and why:**

1. **The NPR case study** cited by #53 and #60 for "roughly $1 per 100,000 tile transfers plus
   egress". The URL carried in #60 (`blog.apps.npr.org/2024/11/26/pmtiles-maps-cost.html`) returned
   **HTTP 404 on 2026-09-03** and was not located elsewhere. The figure is therefore **not
   re-verified**, and it is not needed: Protomaps' own cost calculator is a primary, vendor-published,
   open-source model and is used instead. The correction #53 needs stands regardless, and is
   restated in D-2.
2. **Mapbox's rate table.** `https://www.mapbox.com/pricing` renders its rates client-side and served
   none to an automated fetch on 2026-09-03. The Mapbox figures below are **inherited from #60's own
   body (read 2026-09-02) and not re-verified.** They are marked as such in the table. Mapbox is
   rejected on *shape*, not on the third decimal place, so the gap does not move the decision.
3. **Mapterhorn's per-source terrain attribution list.** `https://mapterhorn.com/attribution` is
   client-rendered and `https://mapterhorn.com/attribution.json` returned **HTTP 404 on 2026-09-03**,
   so the terms of the underlying terrain sources could not be read. That is precisely why D-5 does
   not put Mapterhorn on the critical path.

### The cost model, stated inline so a reader can recompute rather than trust

| Symbol | Assumption | Value | Provenance |
| --- | --- | --- | --- |
| `A` | monthly active users | 10,000 | #17's modelling point |
| `L` | map loads per user per month | 30 | ⚠️ **inferred and unsourced.** The softest number in the model |
| `T` | tile requests per map load | 15 | inherited from #60; also unsourced |
| `h` | CDN cache hit rate | 50% | Protomaps' calculator default. Conservative — a real basemap caches far better |
| `s` | average tile size | 70 KB | inherited from #60; Protomaps' calculator takes it as an input |
| `S` | archive size stored | 110 GB | Pinball Map's **measured** 111 GB; Protomaps states ~120 GB for planet z0–15 |

Derived: map loads `M = A × L = 300,000/month`. Tile requests `R = M × T = 4,500,000/month`. Origin
requests `R × (1 − h) = 2,250,000/month`. Egress `R × s ≈ 315 GB/month`.

> **`L` is the difference between a $950 bill and a $3,050 bill on a metered API, and nobody has
> measured it.** #54's revision block already says so and #53 already carries a "measured cost per
> 100,000 tile requests" criterion. **Instrument the client for one week and replace it.** Every
> figure below is only as good as that number — which is an argument *for* the option whose cost does
> not depend on it much, and that is part of D-1's reasoning rather than incidental to it.

**Free tiers are excluded from every total**, per #17's rule that a free tier is a discount and not a
plan.

| Option | Monthly cost at `R` = 4.5 M tile requests / `M` = 300 k loads | How it was computed |
| --- | --- | --- |
| Google Map Tiles API 2D | **$2,220.00** | 100 k free; 900 k × $0.60/1k = $540; 3.5 M × $0.48/1k = $1,680 |
| Google Dynamic Maps | **$1,750.00** | billed per *load*: 10 k free; 90 k × $7.00/1k = $630; 200 k × $5.60/1k = $1,120 |
| Mapbox GL JS Map Loads | **≈$950** *(not re-verified — see above)* | 50 k free, then the $5/$4/$3 per-1k ladder over 300 k loads |
| Mapbox Vector Tiles API | **≈$925** *(not re-verified)* | 200 k free, then the $0.25/$0.20 per-1k ladder over 4.5 M |
| PMTiles on AWS (S3 + CloudFront + Lambda) | **≈$42.59** ⚠️ *rates unverified — see note* | CloudFront GETs 4.5 M ÷ 10 k × $0.009 = $4.05; CloudFront egress 315 GB × $0.10 = $31.50; Lambda 2.25 M invocations ≈ $1.35 + ≈$2.26 compute; S3 GETs 2.25 M × $0.0004/1k = $0.90; S3 storage 110 GB × $0.023 = $2.53; S3→CloudFront $0.00 |
| **PMTiles on R2 + Cloudflare Worker** | **$7.46** | Workers paid plan $5.00 (4.5 M invocations are inside the 10 M included); R2 Class B 2.25 M × $0.36/M = $0.81; R2 storage 110 GB × $0.015 = $1.65; **egress $0.00** |
| **PMTiles on R2, custom domain, no Worker** | **$2.46** | R2 Class B $0.81 + R2 storage $1.65 + egress $0.00. This is the shape Pinball Map actually runs |
| OpenFreeMap public instance | **$0.00** — *someone else's* donation budget | see D-7 |

⚠️ **The AWS row's unit rates are the only figures in this document with no source and no fetch
date**, and that is worth stating rather than quietly leaving. Every other quoted figure — R2, B2,
Google, the Protomaps calculator, Copernicus — appears in *Sources* with a URL and 2026-09-03. The
five AWS rates do not, and they were carried from memory rather than read.

**They are load-bearing**: the ~$40/month gap between AWS and R2 is the headline of this comparison,
and it rests almost entirely on CloudFront egress at $0.10/GB against R2's $0.00. Anyone relying on
that trade for a decision should re-read AWS's published rates first. The *direction* is not in
doubt — zero-egress against metered egress is a structural difference, not a pricing accident — but
the *magnitude* is unverified and should not be quoted as though it were measured.

The cheapest commercial tile API is **≈124×** the Worker shape and **≈376×** the no-Worker shape, and
the multiple grows with traffic, because R2 egress is $0 while every metered API's marginal rate is
bounded below by a positive number. Protomaps' own calculator, run at its defaults on 2026-09-03,
independently reports **$11.45 Cloudflare against $119.56 AWS and $3,640 Google Dynamic Maps** — a
different volume and the same shape.

### The trade this buys, which is latency and is user-visible

Protomaps' own deployment documentation, read 2026-09-03, carries a warning on the page that tells
you how to do exactly what D-1 chooses:

> **WARNING** Cloudflare R2 is known to have higher latency (500ms or higher) than other Cloud
> Storage products, but lower storage and no egress costs. Evaluate this as a deployment option
> alongside others.

and its comparison chart rates **Cloudflare 🚀 against AWS 🚀🚀🚀**, on a scale it defines on the same
page: "Speedy maps tiles 🚀🚀🚀 load in ≤ 200 ms in the client for customers, slow tiles 🚀 load
≥ 500 ms".

**So the honest statement of D-1 is: this saves about $35/month and costs up to ~300 ms on a cold
cache.** Two things bound it, and both are load-bearing:

- The penalty is on **cache misses only**. A warm edge cache responds "in 100 milliseconds or less"
  by the same document's account, and a basemap is the most cacheable object a product has.
- It is **reversible for the price difference and one URL**. The archive is a single immutable file;
  moving it to S3 or GCS is an upload, and #63's acceptance criteria already require the basemap URL
  to be configuration and prove it by rendering against a second archive. **This is the property
  that makes choosing the cheap option responsible rather than reckless**, and it is why D-1 names
  the measurement that reverses it instead of asserting the latency is fine.

### The two structurally different risks, which #17 already separates and #53's body does not

1. **A metered API with a paid ladder** — the risk is a *price*. Exceeding a free tier sends a bill.
   It is bounded, and the bound is knowable in advance, which is what the table above is.
2. **A donation-funded free public instance** — the risk is *disappearance*. It sends an **outage**,
   not a bill, and the bound is unknown. OpenFreeMap's own funding statement is conditional in its
   own words: "I believe it can be self-sustainable **if** enough people subscribe to the support
   plans" (read 2026-09-03).

**#17's epic acceptance criterion already names both**, in its current wording — this ADR checked
and it needs no rewording. #53's *body*, however, still proposes "starting on ORS's free public tier
while volume is trivial… a legitimate bootstrap". **D-4 overrules that**, and #53's revision block
already flags the wording as inherited.

### What a tile pipeline actually is, and why the archive format is the whole trick

A Z/X/Y tile pyramid for the planet at z0–15 is on the order of hundreds of millions of individual
files. Uploading it as individual objects costs more in *request fees* than in storage. PMTiles
collapses the pyramid into **one file with an internal directory**, served by HTTP **byte-range**
request: a 127-byte header at offset 0, a root directory constrained to lie within the first 16,384
bytes so a client can prefetch it in one range request, then optional leaf directories and the tile
data (`protomaps/PMTiles` `spec/v3`, as recorded in #63, read 2026-09-02). There is **no rendering
server at any point**. The consequences that matter here are two: the running cost is storage plus
GET requests and nothing else, and **the archive is immutable**, which is the operational cost D-3
is about.

---

## Decision

### D-1 — Tiles: the **Protomaps basemap as a PMTiles archive**, on **Cloudflare R2**, behind **Cloudflare's CDN**

| Layer | Choice | Licence, verified 2026-09-03 |
| --- | --- | --- |
| Source data | **OpenStreetMap** | **ODbL 1.0**. A rendered basemap tile is a **Produced Work**: attribution required, share-alike not triggered — stated by the archive's publisher, quoted below |
| Cartography / schema | **`protomaps/basemaps`** | **BSD-3 code + CC0 visual design.** No credit obligation of its own |
| Generation | **We do not generate.** Copy Protomaps' published daily build. If we ever generate: **planetiler** (Apache-2.0) with the `protomaps/basemaps` profile | Apache-2.0 + BSD-3 + CC0 |
| Storage | **Cloudflare R2**, standard class | n/a — a service, not a dependency |
| Serving | **Cloudflare CDN**, via a custom domain on the bucket; the `PMTiles/serverless/cloudflare` Worker **only if** #53's measurement shows Z/X/Y compatibility or explicit `Cache-Control` is needed | Worker source is BSD-3 (`protomaps/PMTiles`) |
| Client library | **MapLibre GL JS** (`v6.7.0`) + the **`pmtiles`** protocol shim | **BSD-3** both. Lands in `apps/web`, which is AGPL-3.0-or-later — BSD-3 is admissible there and under `packages/` alike; what keeps it in `apps/` is the DOM, not the licence |

Protomaps' downloads page states the data terms itself, read 2026-09-03:

> It's available as a single PMTiles archive, distributed as an **Open Database License Produced
> Work (OpenStreetMap attribution required)**.

**Copy the archive; do not hotlink it.** The same page says hotlinking "are discouraged" and
"URLs may change". #53 copies a pinned daily build into our own bucket and verifies it with the
published BLAKE3 digest.

**Rejected, with the reason:**

- **Every commercial tile API** — Google, Mapbox — on **shape**, not price. A per-request bill that
  scales with popularity is the thing ADR 0002 decision A forbids the deployment unit from requiring,
  and it is incompatible with a product that is free to the end user. The price table is evidence of
  the size of the mistake, not the reason for avoiding it.
- **A live tile-rendering server** (Martin, Apache-2.0; or a raster stack). Technically fine and
  licence-clean, but it is an always-on process per region with a rendering CPU budget, in a project
  whose whole cost story is that there is no tile server. #53's inherited "low thousands of dollars
  per month" figure for this is **unsourced in either direction** and is not repeated here.
- **`planetiler-openmaptiles` and the OpenMapTiles schema.** ⚠️ **This is the sharpest licence
  finding in this ADR and it is not the one #60 expected.** The repository's `LICENSE.md`, fetched
  2026-09-03, is a *split* licence: BSD-3 for the code, and **CC-BY 4.0 for the schema's cartography
  and "look and feel"**, with an obligation stated verbatim:

  > Products or services using maps derived from OpenMapTiles schema need to visibly credit
  > "OpenMapTiles.org" or reference "OpenMapTiles" with a link to `http://openmaptiles.org/`.
  > […] Exceptions to OpenMapTiles attribution requirement can be in a written form granted by
  > MapTiler (info@maptiler.com).

  That is a permanent, product-visible credit obligation on **our** UI, curable only by a commercial
  grant from a third party. `protomaps/basemaps` releases its visual design under **CC0** and has no
  such clause. **Choosing Protomaps' schema is therefore a licence choice, not a cartographic
  preference**, and it is the reason OpenFreeMap is not merely a funding risk (D-7): OpenFreeMap
  serves OpenMapTiles-schema tiles and credits "© OpenMapTiles" on its own front page.
- **`tilemaker`** (FTWPL). Not used, so nothing turns on it. Recorded because #53 names it: the
  203-byte licence text is a WTFPL variant and is **not OSI-approved**. `CLAUDE.md` §3 sends non-OSI
  licences to an ADR before they are discussed and #24 owns the per-package allowlist; since
  tilemaker is not a dependency here, this ADR does **not** rule on it and does not need to.

### D-2 — Cloudflare R2 is the default, and the four wrong figures in filed issues are corrected here

**The corrections, each naming the issue that carries the wrong figure.** All four issues already
carry them in their **revision blocks**, which `CLAUDE.md` says supersede an issue body; this ADR is
the citable source they point at.

| Wrong figure | Carried by | Correction, read 2026-09-03 |
| --- | --- | --- |
| "object storage around $0.02–0.023/GB/month" | #17, #27, #54 | That is **S3 Standard only**. **R2 is $0.015/GB-month. B2 is $0.00695/GB-month** — 3.3× below the quoted floor |
| "egress around $0.09/GB" | #17, #27, #54 | **Not true of either recommended provider.** R2 egress is **$0**; B2 is free to 3× stored bytes and **unconditionally free via Cloudflare, Fastly and bunny.net**. $0.09 is an AWS rate applied to a non-AWS plan |
| "roughly $1 per 100,000 tile transfers plus egress" | #53 | An **AWS-shaped** figure. On R2, 100,000 tile transfers cost **at most $0.036** — that is every one of them missing the cache — and **$0.018 at the 50% hit rate modelled above**, with **zero egress**. Quoting it beside an R2 recommendation overstates R2 by 28–56×. ⚠️ Its cited source **404s** — see *Sources* |
| "free to ~50k loads/month" for a commercial tile API | #53 | **Mapbox Map Loads only.** Google **Dynamic Maps is 10,000**; Google **Map Tiles API 2D is 100,000**; Mapbox Vector Tiles API is 200,000. Four SKUs, four numbers, and they are not interchangeable — Dynamic Maps bills per *load* and Map Tiles bills per *tile* |

**Why R2 and not B2, given B2 is 2.2× cheaper on storage and charges nothing for GETs** — this is
*author's judgement* and the margin is thin. R2 wins on three things that matter more than $1/month
at this size: it supports **HTTP/2** where B2 is HTTP/1.1 only (`docs.protomaps.com/pmtiles/cloud-storage`,
read 2026-09-03), which matters for a client issuing many small byte-range requests; the CDN, the
cache and the storage are one account and one control plane; and Protomaps' own tooling, worker and
documentation are written against it, so #53 inherits a supported path rather than a novel one.
**B2 is named here as the standing alternative**, not as a rejected one: the archive is one file, so
switching providers is an upload and a URL change, and if the R2 cold-cache latency in D-1 proves
unacceptable the same property is what makes AWS or GCS available.

### D-3 — The operational cost is not a price: the archive is **immutable**, and the cadence is **quarterly**

A PMTiles archive cannot be patched. Refreshing OSM data means **rebuilding or re-downloading and
re-uploading the whole ~120 GB file**, then repointing the configured URL. Pinball Map's write-up
records the practical shape of that: the upload "took 24 hours from my home network", and the update
process is "uploading a new pmtile file and then changing the environment variable to point to it".

**Decision — the refresh cadence is quarterly**, with these properties, and this is *author's
judgement* calibrated to the cost above:

- **Quarterly**, not daily and not never. Daily is what Protomaps publishes and is free to consume,
  but each refresh is a ~120 GB transfer and a period of double storage while the old archive is
  still referenced; monthly buys freshness nobody in this product will notice on a basemap.
  Never is how OSM data silently ossifies at whatever date the archive was first built — which is
  the failure #53's own criterion names.
- **The archive URL is versioned and the old archive stays live until the new one is verified.**
  A refresh is therefore a config change with a rollback, not a mutation.
- **The build date is recorded and displayed.** #70 already requires the OSM extract date for the
  routing engine; the basemap needs the same field for the same reason.
- **Double storage during a refresh is the only extra cost**, and it is trivial. R2 bills a
  GB-month as the daily peak averaged over the period, so holding a second 110 GB archive for a week
  is `110 × 7/30 × $0.015` ≈ **$0.39**. The upload itself is a multipart write — Class A operations
  at $4.50/M, and Pinball Map records "fewer than 1,000" of them for a whole-planet upload, so it is
  fractions of a cent. There is no ingress or egress charge either way. That is the whole of it.

### D-4 — Routing: **Valhalla**, self-hosted, invoked **over HTTP as a separate process**

**The engine is Valhalla `3.8.3` (MIT).** ORS's free public tier is **not** the bootstrap; a
regional self-hosted build is.

**Say the shape first, because the licence consequence follows from it and this is exactly where
such decisions get made loosely.** A routing engine can enter a codebase in two shapes and they are
not the same licence question:

| Shape | What is combined | Licence consequence |
| --- | --- | --- |
| **A separate server process reached over HTTP** *(chosen)* | Nothing. We send JSON and receive JSON | The engine's licence **does not attach to this codebase at all**. Not even a GPL engine would be "linked" |
| **A library, or a WASM build, running in-process** | The engine, into our artefact | The engine's licence binds. Under `CLAUDE.md` §3 a **GPL engine is then fatal to any `packages/` leaf, with no exemption**, and an AGPL one is fatal everywhere |

So the licence table below is **not** the reason ORS is rejected as a *self-hosted server*; over
HTTP, ORS's GPL-3.0 would be compatible with an AGPL application and would attach to nothing.

**It is the reason ORS is rejected as the engine**, and here is the difference, which is the point of
this decision:

1. **The interface outlives the transport.** #70 requires a `RoutingProvider` with route and
   elevation-along-a-shape, engine-agnostic, and the architecture's own rule is that anything which
   is *a function of the data rather than of the deployment* belongs in a leaf package under
   `packages/` — Apache-2.0, where **no GPL dependency may appear at all**. The moment anyone wants
   an offline or in-browser route — and #15's offline half, #74's head-unit export and #85's route
   import all point that way — a permissive engine can be compiled in and a GPL one cannot. Choosing
   MIT keeps a door open that GPL closes permanently and irreversibly, because ADR 0001 deliberately
   collected **no CLA** and so this project cannot relicense its way out.
2. **The public API is a disappearance risk**, per the second risk class above. #53's proposed
   bootstrap puts an institution-funded free endpoint on the critical path, which #17's epic
   criterion (b) forbids.
3. **On capability, Valhalla is the better fit anyway, and that is independent of both.** Its
   costing is evaluated **per request**, so a rider toggling "avoid hills" needs no graph rebuild;
   OSRM bakes costing into a Lua profile at preprocess time (#70, read 2026-09-02). Valhalla also
   exposes `/height` and the edge attributes #72 needs from one process.

**The field, and where each sits:**

| Engine | Licence (2026-09-03) | Admissible as an HTTP service | Admissible **linked into `packages/`** | Verdict |
| --- | --- | --- | --- | --- |
| **Valhalla** | **MIT** | ✅ | ✅ | **Chosen** |
| OSRM | BSD-2 | ✅ | ✅ | Viable. The second engine for #70's two-engine test |
| GraphHopper | Apache-2.0 | ✅ | ✅ | Viable |
| BRouter | MIT | ✅ | ✅ | Viable, and bike-specific with offline support — the natural candidate if #15 ever wants on-device routing |
| OpenRouteService | **GPL-3.0** | ✅ (nothing is linked) | ❌ **Fatal under `CLAUDE.md` §3** | **Rejected** — reasons 1 and 2 above |
| pgRouting | **GPL-2.0** | ✅ (it is a PostgreSQL extension, out of process) | ❌ **Fatal** | Not needed; recorded because ADR 0001 names it |

**#70's "same test suite passes against two engines" criterion is what makes this repointable
rather than aspirational, and it is now specific: Valhalla and OSRM.**

**Popularity-weighted routing is not promised.** No open engine has it, [ADR 0007](0007-patent-posture.md)
names #55/#60 as the place popularity data would feed routing, and #70 says plainly: do not promise
it. Repeated here because this is the ADR someone will cite.

### D-5 — Elevation: the engine's `/height`, over a **named** DEM, defaulting to **Copernicus GLO-30**

Elevation is not a separate service. It is **`/height` on the same Valhalla process** (MIT), which
takes `shape` or `encoded_polyline`, supports `range:true` for cumulative distance and
`resample_distance` for uniform sampling — the two things #72's acceptance criteria require in order
for total ascent to mean anything.

**The DEM loaded into that process is `Copernicus DEM GLO-30 Public`**, and its terms are an
obligation, not a courtesy. Verbatim from the Copernicus Data Space Ecosystem, read 2026-09-03:

> When communicating to the General Public or distributing the Copernicus WorldDEM-30 (GLO-30), the
> User shall inform the General Public of the source by using the following notice:
>
> © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the
> European Union and ESA; all rights reserved
>
> Where the Copernicus WorldDEM-30 (GLO-30) data have been adapted or modified, the User shall
> provide the following notice: "produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and
> © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA;
> all rights reserved"

**A computed elevation profile is adapted data**, so the second notice is the one that applies. It
goes wherever the profile is displayed or exported, alongside the OSM attribution — which is one
more reason #72's "record the elevation source with the route" criterion is a licence requirement and
not only a data-integrity one.

**Three caveats that must travel with this choice**, each of which is a defect waiting to be filed
against #72 if it is forgotten:

1. **It is a DSM, not a DTM.** It "represents the surface of the Earth including buildings,
   infrastructure and vegetation". On a tree-lined road it biases grade. This is why #72 requires
   the source and resolution to be stored per route and forbids comparing routes computed from
   different DEMs.
2. **Coverage is not complete.** "A small subset of tiles covering specific countries are not yet
   released to the public", and ocean cells have no tiles at all. #72's "render a data void as a gap
   and report ascent as incomplete" criterion is what handles this, and it is not optional.
3. ⚠️ **The maintenance horizon is now.** The same page states the datasets "were made available for
   use in 2019 and **will be maintained until 2026**". It is 2026. This ADR does not know what
   happens next and **does not pretend to**: see *Open questions*.

**Rejected:** Google's **Elevation API** — free to 5,000 events then $5.00/1,000 (read 2026-09-03),
which is the same metered shape D-1 rejects, on a call made once per route edit. **Not chosen but
recorded as the strongest alternative:** **Mapterhorn** (code BSD-3), which distributes
Terrarium-encoded RGB terrain **as PMTiles** — the identical serving shape as D-1, and the obvious
source for hillshade in #63 and terrain in #91. It is not on the critical path today only because
its per-source data attribution list could not be fetched on 2026-09-03 (see *Sources*); resolving
that is cheap and would make it the better answer.

### D-6 — What a self-hoster must run: **not a tile pipeline, and not a planet build**

ADR 0002 made self-hosting unconditional and set the floor at "one person and their mates" on
~2 vCPU / 4 GB, one command, local disk sufficient, **no cloud object store and no CDN account
required**. A tile pipeline is the heaviest thing that could be put in that box, so this is the
decision most likely to break ADR 0002 if it is got wrong.

**It is not required, and the honest answer is the one #60 asked for: an instance operator can point
at someone else's tiles.**

| What the operator wants | What they run | Cost and size |
| --- | --- | --- |
| A map, minimum effort | **Nothing.** Point the configured basemap URL at the project's published archive | $0, 0 GB. Admissible because #63 already requires the URL to be configuration and proves it against a second archive |
| A map, no external dependency | `pmtiles extract` a **regional cutout** of the archive, serve it from the same box with `pmtiles serve` or Caddy | A country-sized cutout is single-digit GB, not 120. Protomaps rates both local shapes **🚀🚀🚀 latency** — a self-hoster serving their own region gets *better* latency than the CDN deployment, not worse. `--maxzoom` trades detail for size: "each additional zoom level roughly doubles the size of the file" |
| Routing | Valhalla over a **regional OSM extract** | Fits the reference box. ⚠️ A **planet** build does not, and this ADR does not claim to know what it needs — see *Open questions* |
| **Elevation** | The **same Valhalla process**, plus a **Copernicus GLO-30 DEM for the operator's region** loaded into it | ⚠️ This row was missing from an earlier draft, and its absence was the sharper kind of gap: an operator who followed the routing row alone got a Valhalla that **answers `/route` and fails `/height`**, with no error explaining why. D-5 puts elevation on that process, so the DEM is a *separate download the routing row does not imply*. Sizes are region-dependent and this ADR does not have a measured figure — **#53 must record the actual download and disk footprint for the reference region when it stands the service up**, because "and also fetch a DEM" is not an instruction anyone can follow. |

**Nothing in D-1 to D-5 adds a required cloud account to a self-host.** R2 is *this project's*
hosting choice for *its own* published archive, if it ever publishes one; it is not a dependency of
the software. That distinction is what keeps ADR 0002 decision A intact, and it is why D-1 is
recorded as a provider choice rather than as an architectural requirement.

### D-7 — A donation-funded free public instance may **not** sit on the critical path

Not OpenFreeMap for tiles, not the OpenRouteService public API for routing, not any successor of
either.

The reasoning is the risk taxonomy above: these fail #17's epic criterion **(b)**, and they do so
*while passing (a) literally*, because they are not metered. That is exactly the gap #17's current
wording was rewritten to close, and it needs no further rewording — this ADR checked the wording and
confirms it names both failure modes.

**They remain legitimate in two roles**, and the distinction is the load-bearing part:

- **As a development or demo fallback**, clearly labelled, never in a shipped default.
- **As the thing a self-hoster may freely choose** for their own instance under D-6. An operator
  accepting an outage risk for their own deployment is their decision; shipping that decision to
  every user as a default is ours, and this ADR declines it.

**And they are owed acknowledgement, not just a rejection.** OpenFreeMap is a genuine public good
that a for-profit alternative is not, and the reason it cannot be a dependency here — that its
funding is conditional in its own author's words — is a statement about risk transfer, not about
its quality.

#### The second reason, which is a `SECURITY.md` class and not a funding one

**Every tile request discloses where the athlete is looking.** A sequence of `z/x/y` requests is a
viewport trace, and `SECURITY.md` puts "leaks location through an API response, an export, a cache
**or an error message**" squarely in scope — a tile request is the same disclosure by a different
route, and [ADR 0004](0004-privacy-and-location.md) exists because GPS traces reveal where people
live. So "who serves the tiles" is a question about who gets to observe that, and it has three
honest answers rather than a clean one:

- **A third-party public instance** sees every viewport of every athlete, under terms we neither set
  nor can change. That is the disqualifying answer for a shipped default, independently of funding.
- **Our own bucket behind our own CDN** narrows it to one vendor we have an account and a contract
  with and whose logging we configure. Better, and **not** "none" — a hosting provider on the request
  path can always see request paths, and this ADR does not claim otherwise.
- **A self-hoster's own regional cutout on their own disk (D-6)** is the only answer that is
  genuinely "nobody outside", which is one more reason D-6 is a floor the design has to keep meeting.

**Privacy-zone truncation does not help here**, and it is worth stating so nobody assumes it does:
truncation protects the *trace*, while the viewport is disclosed by the act of panning a map. The
mitigation available at this layer is limited to who is on the receiving end, which is what D-7
decides. Anything stronger belongs to #63 and ADR 0004.

---

## Consequences

### What this enables

- **#53 can be built**, and its shape is now fixed: copy a pinned Protomaps daily build to R2,
  serve it behind Cloudflare, stand up a regional Valhalla, and **measure** the two numbers this ADR
  refuses to assert — cold-cache first-tile latency and cost per 100,000 tile requests.
- **#63 can be built** without choosing a provider. MapLibre GL JS + `pmtiles`, both BSD-3, against
  a configured URL.
- **#70 has a named default and a named second engine**, which is what its "same tests against two
  engines" criterion needs in order to be runnable.
- **#72 has a named elevation source, its attribution text and its three caveats**, so the "record
  the source with the route" criterion has something concrete to record.
- **#54's tile line is now derivable rather than guessed** — with `L` still flagged as the number
  that has to be measured before the model means anything.

### What this costs, knowingly

- **Up to ~300 ms of extra cold-cache first-tile latency** versus AWS, for about $35/month. Named,
  measured by #63, reversible by moving one file and one URL.
- **A ~120 GB quarterly transfer**, and a few days of double storage each time.
- **A stale basemap between refreshes.** Quarterly means up to three months of missing new cycleways.
  Acceptable for a basemap; it would not be acceptable for the routing graph, which is why D-4's
  extract date is recorded separately.
- **We carry OSM attribution and Copernicus attribution as product-visible obligations**, forever,
  in every surface that shows a map or an elevation profile — including exports and static images.
- **Cloudflare becomes a concentration**: storage, CDN and (optionally) compute in one vendor. The
  mitigation is real but is not free — the archive is portable in a way a rendering service is not,
  and D-2 names B2 and AWS as the exits.

### What this forecloses

1. **Any commercial tile API on the critical path** — Google, Mapbox and successors. Reopening this
   means superseding this ADR, not filing a ticket.
2. **The OpenMapTiles schema as the default cartography**, and with it OpenFreeMap as a default
   basemap and `planetiler-openmaptiles` as a default generator — because of the CC-BY 4.0
   "visibly credit OpenMapTiles" obligation, curable only by a written grant from MapTiler.
3. **A live tile-rendering server** as the primary serving path.
4. **Linking any GPL routing or tiling code into a leaf package**, permanently: OpenRouteService
   (GPL-3.0) and pgRouting (GPL-2.0) can never be in-process dependencies of anything under
   `packages/`, and ADR 0001's deliberate absence of a CLA means this project cannot relicense its
   way out of that.
5. **Promising popularity-weighted routing.** No open engine has it; ADR 0007 constrains where
   popularity data may be used at all.
6. **Requiring a self-hoster to hold a cloud object-store or CDN account.** D-6 is a floor, not a
   recommendation, and a future design that needs one contradicts ADR 0002 decision A.
7. **Shipping a default that discloses athlete viewports to a party we have no relationship with**,
   per the `SECURITY.md` reasoning in D-7.

### What this does **not** foreclose

- Changing storage provider (B2, AWS, GCS, bunny.net). One file, one upload, one URL.
- Changing routing engine. That is what #70's interface is for, and D-4 names the second engine.
- An offline or in-browser router later — **provided the engine is permissive**. D-4 is what keeps
  that possible.
- Adopting Mapterhorn for terrain once its data attribution is verified.
- A public reference instance run by this project. ADR 0002 already answers that separately, and
  this ADR neither creates one nor assumes one.

### Constraints this places on other work

| Issue | Constraint |
| --- | --- |
| #53 | Build against D-1/D-4. **Do not** bootstrap on the ORS public API. Record the measured cold-cache latency and the measured cost per 100 k tile requests. Verify the downloaded archive against its published BLAKE3 digest. Copy, do not hotlink |
| #63 | MapLibre GL JS + `pmtiles`, both BSD-3, in `apps/web`. Basemap URL is configuration. OSM attribution is a licence obligation asserted by a test, per its own criteria |
| #70 | `RoutingProvider` stays engine-agnostic and Apache-2.0-clean: **no dependency carrying GPL may sit under it**. Default Valhalla, second engine OSRM. Record engine, version, licence and OSM extract date |
| #72 | Elevation from `/height` over Copernicus GLO-30 by default. Store source **and** resolution per route. Carry the Copernicus "produced using…" notice. Resample before summing ascent; do not use integer height precision for grade |
| #54 | Use D-2's corrected rates. **Do not assert a tile cost until `L` is measured.** Every line carries its source and fetch date |
| #17, #27 | The corrected storage and egress rates in D-2 supersede the figures in their bodies; their revision blocks already say so |
| #64 | Unaffected. The ODbL **Derivative Database** question for stored geometry is still yours, and this ADR does not touch it |

---

## Open questions, and who owns each

Recorded rather than answered, because [ADR 0006](0006-fit-codec-licensing.md) set the standard that
a question is either settled with reproducible evidence or named with the exact step that would
settle it.

1. **Planet-build hardware for Valhalla / GraphHopper / OSRM. Unresolved, and deliberately not
   quoted.** Secondary sources circulating in #53 and #70 gave **32 GB, 60 GB and 128–196 GB** of
   RAM. **No primary sizing document was read for this ADR.** Three figures with a 6× spread and no
   primary source is not a range, it is an absence. **The step that settles it:** build a
   single-country extract on the ADR 0002 reference box, record peak RSS, peak disk and wall time,
   then a continent, then extrapolate. **Owner: #53**, and it feeds #54. Until then no number goes
   into any cost model.
2. **`L`, map loads per user per month.** Inferred and unsourced; the difference between $950 and
   $3,050 on a metered API and the widest error bar in this ADR. **The step:** instrument the client
   for one week. **Owner: #53**, via its measured-cost criterion.
3. **Cold-cache first-tile latency on R2, measured rather than quoted.** Protomaps' own warning is
   the only evidence here and it is a vendor's general statement, not our measurement.
   **The step:** #63's existing cold-load criterion. **Owner: #63.** If it fails its budget, D-1's
   remedy is the provider swap in D-2, not a redesign.
4. **Copernicus DEM after 2026.** The publisher's own page says maintained "until 2026". Whether
   that means a successor programme, a frozen archive or a withdrawal is **not known to this ADR**.
   **The step:** read the Copernicus DEM Product Handbook and the ESA User Licence, neither of which
   was read here. **Owner: #72.** SRTM (public domain) and Mapterhorn are the standing fallbacks and
   both are named in #72 already.
5. **Whether the Cloudflare Worker is needed at all.** The $5/month floor buys Z/X/Y compatibility
   and explicit `Cache-Control`; Pinball Map runs without one. **The step:** #53 measures cache-hit
   ratio and latency both ways. **Owner: #53.** It is a $5 question, recorded only because the
   difference is 3× on the total.
6. **Mapterhorn's terrain data terms.** Not readable on 2026-09-03. **The step:** ask upstream, or
   read `mapterhorn/mapterhorn`'s own build sources. **Owner: #72.**

---

## Notes

### Numbering

This ADR takes **0010**, per the settled ownership table in
[`docs/architecture.md`](../architecture.md), merged as
[#112](https://github.com/openzigs/onyourleft/pull/112) closing
[#97](https://github.com/openzigs/onyourleft/issues/97). **#60's own acceptance criterion still names
`0008-tiles-and-routing.md` and is stale**; 0008 went to
[#86](https://github.com/openzigs/onyourleft/issues/86) because merged ADRs already cite it by number
— four times in [`0005-tech-stack.md`](0005-tech-stack.md) alone — and a citation in a merged
document is a fact where an acceptance criterion in an open issue is still a proposal. #60 carries a
comment recording the change. Rule `ADR001` in `scripts/check-repo-rules.sh` fails the build on a
duplicate number and `ADR002` on a malformed filename, so neither could have been got wrong silently.

### A dangling cross-reference this ADR found and did not fix

[ADR 0001](0001-licence.md)'s *Data* section defers the ODbL question with the words "**Deferred to
ADR 0007, owned by #64**". **ADR 0007 is the patent posture (#59)**, and the settled numbering table
reserves no number for #64's data-licence ADR at all. The *ownership* is unambiguous and unaffected —
#64 owns the question, and ADR 0001's substantive constraint ("the ODbL question must be answered
before segment geometry is persisted anywhere") stands exactly as written. Only the ADR **number** in
that sentence is now dangling. It is recorded here rather than repaired because a merged ADR is a
protected path amended by a superseding ADR and not by an edit, and because repairing it belongs
with #64's own ADR, which will take a number. Filed as [#119](https://github.com/openzigs/onyourleft/issues/119).

### On not overstating this

Three things about this document are weaker than they may look, and a reader should come away able to
say which:

- **The cost table is arithmetic over published rate cards, not an invoice.** Every rate carries its
  page and date, and the derivation is shown so it can be recomputed — but a rate card is not a bill.
  Exactly one real bill informs it (Pinball Map's $1.67, at roughly 1/5 of our modelled volume), and
  #53's measured-cost criterion is what converts the rest.
- **The decisive input `L` is a guess**, and the whole table scales linearly in it. What survives a
  wrong `L` is the *ordering*, because the R2 shape is dominated by storage, which does not depend on
  `L` at all, while every metered option is linear in it. **That asymmetry, not the absolute
  numbers, is the argument.**
- **No owner ruling stands behind any of this.** Three review rounds in this repository have flagged
  an ADR claiming authority it did not have, so it is said plainly at the top and again here: D-1 to
  D-7 are derived from ADR 0002 decision A and ADR 0001 §3 plus the author's engineering judgement,
  and the judgement calls are marked where they occur.

### What would make this ADR wrong

- **`L` is measured and comes in far below 30.** Then a metered API's bill is small enough that the
  shape argument is doing all the work and the price table is doing none — which would be worth
  saying, and would not change D-1, because a bill that is small at 10 k MAU is not small at 100 k.
- **Cold-cache latency on R2 measures worse than Protomaps' own warning suggests**, or the warm-cache
  hit rate is far below 50%. Then D-1's provider changes and the rest of the ADR stands unaltered —
  which is the property the decision was structured to have.
- **A permissive engine loses cycling-costing parity with ORS**, or Valhalla changes licence. D-4's
  reasoning is explicitly two-part; either part failing reopens it.
- **The Copernicus programme stops publishing GLO-30** without a successor. D-5's fallbacks are named
  and #72 owns them.
- **`packages/` stops being the home of the routing interface** — if #70 concludes the interface is
  deployment-specific and belongs under `apps/`, then reason 1 in D-4 weakens to a preference. It
  would not change the outcome, because reasons 2 and 3 are independent of it, but the ADR would be
  overstating its case and should say so.
