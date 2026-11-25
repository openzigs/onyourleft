# Spike 0042: Dense-city tiles over `valhalla-browser`'s 64 MiB per-tile limit

- **Date**: 2026-11-24
- **Issue**: [#2347](https://github.com/openzigs/onyourleft/issues/2347), item 2: how a dense metro gets routed in the
  browser before any rider uses this. The owner's lane comment of 2026-11-24: make a one-state graph built by
  `apps/web/tools/valhalla` open in `valhalla-browser` 0.2.1, decide from measurements on the one-state extract #3136
  used, build it locally and upload nothing.
- **Number**: **0042.** `docs/spikes/` holds up to 0041 on `origin/main` at `5e535b6f9`, and no remote branch carries
  0042 or higher.

A spike is a dated measurement that decides nothing (`docs/agents/conventions.md` §7). No place name, tile id or
coordinate appears below: the state is the one #3136 measured, and it is not named.

## What the limit is

`valhalla-browser` 0.2.1 holds the limit in two places, read from upstream's source on 2026-11-24:

- **The loader** (`packages/valhalla-core/src/loader.ts`, `LIMIT = 64 * 1024 * 1024`) refuses a manifest that lists any
  tile larger than that. The check runs when the router starts, over every tile, so one large tile makes the whole graph
  fail with `{ step: "init", code: "DATASET" }`. A tile of exactly 64 MiB is accepted.
- **The WebAssembly's transport** (`native/runtime.cpp`) throws `Tile exceeds transfer limit` for anything larger. This
  is compiled into `valhalla-browser.wasm`, so a higher limit needs a rebuilt WebAssembly, not only a patched loader.

Upstream's own dataset builder (`scripts/build-dataset.py`, `TILE_LIMIT`) refuses such tiles too. Our
`make-release.ts` did not, which is how a release no session can open got made (#2347). It now refuses one, and names
every tile over the limit by id, path and size.

Checked in headless Chromium on the development Mac: the release below with one manifest entry's size raised to 64 MiB
plus one byte fails at start with `DATASET` for every pair, exactly as #2347 saw.

## The state's graph, measured

Built on 2026-11-24 with `build-graph.sh` as it is on `main` (Valhalla 3.8.3, pinned by digest, 8 threads, Docker
Desktop's VM at 12 CPUs and 3.8 GiB) from the 22,290,298-byte extract #3136 used:

| | |
|---|---|
| Build time | 12 s, `graph.tar` 54,169,600 bytes |
| Tiles | 28: one at level 0, two at level 1, 25 at level 2 |
| Largest tile | **11,851,056 bytes**, a level-2 tile: 17.7 % of the limit |

**Nothing in this state's graph is near the limit.** The release opens in `valhalla-browser` 0.2.1 and routes. Measured
with the dev-only measurement page (`apps/web/tools/valhalla/measure/`) in headless Chromium on the Mac, against a local
server sending R2's headers, one run per pair, with end points snapped to roads by the same graph's native `locate`:

| Pair | Routed | Start | Cold route (tiles, decoded bytes) | Warm route |
|---|---|---|---|---|
| 13 km class | 13.265 km | 196 ms | 239 ms (2, 4,607,680) | 3 ms |
| 37 km class | 36.608 km | 75 ms | 328 ms (6, 18,360,976) | 28 ms |
| 62 km class | 62.436 km | 79 ms | 402 ms (11, 25,654,744) | 72 ms |

Each routed length is the native engine's for the same pair, to the metre. These are desktop numbers. The tablet's are
#2009's and #2734's to take.

## Which build options shrink a level-2 tile

Each row is one build of the same extract with `valhalla_build_config` options added, and the largest tile and the sum of
the level-2 tiles, read from the tile directory:

| Options turned off | Largest tile | vs default | Level-2 total | vs default |
|---|---|---|---|---|
| none (the default) | 11,851,056 | | 43,614,808 | |
| `include_driveways` | 11,603,192 | −2.1 % | 41,532,016 | −4.8 % |
| `include_driveways`, `include_platforms`, `include_construction` | 11,603,192 | −2.1 % | 41,532,016 | −4.8 % |
| `include_driveways`, `include_driving` | 11,576,200 | −2.3 % | 41,438,088 | −5.0 % |
| `include_pedestrian` | 8,791,856 | −25.8 % | 34,417,488 | −21.1 % |
| `include_driveways`, `include_pedestrian` | 8,556,920 | −27.8 % | 32,426,600 | −25.7 % |

- Driveways off saves about 2 % of the largest tile here, which agrees with #2347: it did not bring a 73 MB tile under
  67,108,864 bytes.
- **Pedestrian-only ways off is the one option that moves the number**: about a quarter. At that ratio a 73 MB tile
  would come to about 53 to 54 MB, under the limit. That is an extrapolation from a less dense area and was not measured
  on the dense tile itself.
- It is not free for a bicycle router. `include_pedestrian` drops ways whose only access is on foot. A footway that
  allows bicycles keeps its bicycle access and stays, but a rider loses the paths a bike may be wheeled along, and an end
  point on one snaps elsewhere. How much bicycle routing changes was not measured.
- One of the nine builds (`valhalla_build_tiles`, 8 threads) died with a segmentation fault and passed when run again.
  Seen once; not chased.

## The other ways round it

- **A `valhalla-browser` release with a higher limit.** None exists. 0.2.1, published 2026-09-21, is the latest on npm
  (checked 2026-11-24), and the upstream repository (`tobilg/valhalla-wasm`) was last pushed that day and has no open
  issues. A higher limit needs both the loader and the WebAssembly changed, and a tile over 64 MiB would take more than
  half of the SDK's largest decoded-tile budget (128 MiB) on its own. It would be a request upstream or a fork that
  rebuilds the WebAssembly (the package is MIT).
- **Splitting a tile.** Not possible with this SDK. A tile's extent is fixed by its level (a level-2 tile is 0.25° a
  side) and is part of the GraphId the SDK checks, and Valhalla's tile hierarchy is compiled into both the builder and
  the WebAssembly. Re-levelling is the same: it needs a custom hierarchy in both.
- **Leaving the tile out.** The graph then opens, and routes that would cross the missing cell detour or fail. This is
  what the owner ruled for #2009's measurement on 2026-11-07. What the SDK answers for an end point inside the missing
  cell was not measured.

## What this leaves for a decision

1. For this state's graph, nothing: its largest tile is under a fifth of the limit, and the release opens and routes.
   `make-release.ts` now refuses a build that would not open, so a future build of a denser state stops at the build,
   naming its tiles, rather than at a rider's first route.
2. For a state with a dense metro, in order of cost: build with pedestrian-only ways off, measured on that tile, if
   bicycle routes across the city still hold; else leave the tile out and say so; else ask upstream for a higher limit.
