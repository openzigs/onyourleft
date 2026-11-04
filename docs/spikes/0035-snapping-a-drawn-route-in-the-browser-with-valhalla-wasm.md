# Spike 0035: Snapping a drawn route in the browser, with no instance, using Valhalla compiled to WebAssembly

- **Date**: 2026-11-03
- **Issue**: [#2009](https://github.com/openzigs/onyourleft/issues/2009), under the epic
  [#55](https://github.com/openzigs/onyourleft/issues/55), and its owner rulings of 2026-11-02: **trial in-browser
  Valhalla first** (`tobilg/valhalla-wasm`, npm `valhalla-browser` 0.2.1, built on Valhalla 3.8.3) against one state's
  routing tiles that we build ourselves; fall back to `route_snapper` or to home instances only if it does not work; **do
  not route on the basemap's `roads` layer**; elevation is [#2013](https://github.com/openzigs/onyourleft/issues/2013)'s,
  not this spike's. Informs [#2007](https://github.com/openzigs/onyourleft/issues/2007) (editing a route) and
  [#2008](https://github.com/openzigs/onyourleft/issues/2008) (Valhalla on a home instance).
- **Number**: **0035.** `docs/spikes/` holds 0001 to 0008, 0010 to 0020 and 0022 to 0033 on `origin/main` at
  `c20cc7a0`; 0021 is claimed by [#1057](https://github.com/openzigs/onyourleft/issues/1057), and 0034 by the open pull
  request [#2106](https://github.com/openzigs/onyourleft/pull/2106) (controls for the rider's own music player), which
  merges first. [#2105](https://github.com/openzigs/onyourleft/pull/2105), also open, adds a spike and takes a later
  number.

A spike is a dated measurement that decides nothing (`docs/agents/conventions.md` §7). No product code changes here.

## Rules this spike holds

- **No coordinate and no place name.** The graph was built from one US state's public OpenStreetMap extract, picked
  because it is small and long enough for a 150 km route; it is called "the state" throughout. The route end points
  were random points snapped to the state's roads, and are kept nowhere but the throwaway working directory.
- **No data and no script is committed.** The build, the static server, the harness page and the drivers were
  throwaway and local, as spikes 0031 and 0033's were. No tile, graph or route is in the repository.
- **No paid service** (ADR 0036 D-7). Everything ran on the development Mac; the graph was served from `127.0.0.1`.
- **No device.** The issue's rulings ask for the owner's tablet, in the Capacitor WebView and in Chrome. That is the
  owner's measurement, and it was **not** taken. Every timing below is a desktop number and says so.
- **Unmeasured is not a pass.** What was not measured is listed at the end.

## The question

Can a rider with no instance get a drawn route snapped to roads, in the app, from a routing graph we build and host as
static files? Specifically, the issue's list:

1. cold and warm route time for 5, 40 and 150 km routes;
2. bytes and tiles fetched;
3. WASM and process memory;
4. how fast a dragged waypoint re-snaps;
5. whether routes match the instance's Valhalla;
6. whether the CSP allows WASM and workers;
7. the licences of compiled dependencies.

## Method

### The graph

| Step | What | Measured |
|---|---|---|
| Input | The state's Geofabrik extract, downloaded 2026-11-03 | 22,253,740 bytes `.osm.pbf` |
| Build | `ghcr.io/valhalla/valhalla:3.8.3`: `valhalla_build_config`, `valhalla_build_admins`, `valhalla_build_tiles`, `valhalla_build_extract` | 5 s, 23 s and 2 s (admins, tiles, extract) on an Apple M4 Pro in Docker |
| Archive | `graph.tar`, with Valhalla's own `index.bin` first | **54,097,920 bytes, 2.43 times the extract** |
| Tiles | 28 | level 0: 1 tile, 3.75 MB; level 1: 2 tiles, 6.7 MB; level 2: 25 tiles, median 0.79 MB, **largest 11.82 MB**, 43.5 MB in all |
| Manifest | The SDK's schema 1, written by a throwaway script from the archive's index | 5,124 bytes |

The SDK's own `pnpm run data:osm` was **not** used: it compiles Valhalla's native tools from source first. The
official 3.8.3 image built tiles the WebAssembly runtime read without complaint, and the manifest it needs (release
id, Valhalla revision, coverage, the archive's size, index and validators, and every tile's offset, size and SHA-256)
was derived from the archive directly.

A level-2 tile is 0.25° square, about 28 × 22 km at mid-US latitudes, which is the figure the owner's privacy ruling cites.

### The runtime and the harness

- `valhalla-browser@0.2.1` from the npm registry (published 2026-09-21; tarball SHA-512 prefix `dead983fe38f`), its
  worker and its 9,861,835-byte `valhalla-browser.wasm` **served from the page's own origin** through the SDK's
  `workerUrl` and `wasmUrl` overrides, as the app would ship them.
- A static server in front of the dataset that does what R2 behind a CDN does: single byte ranges, a strong `ETag`,
  `Last-Modified`, `Cache-Control: public, max-age=31536000, immutable`, identity encoding.
- Headless Chromium from the repository's pinned Playwright 1.63.0, on an Apple M4 Pro with 24 GB. One fresh browser
  context per route, so each cold route started with an empty HTTP cache and a new worker.
- Costing `bicycle` with Valhalla's defaults. Three end-point pairs per length class, chosen by asking the native
  service for routes within 15 % of 5, 40 and 150 km.
- Per pair: initialise the router; route (cold); route again (warm); then move the destination about 250 m and route
  (a dragged waypoint, same session). Then the same pair through `valhalla_service` 3.8.3 on the same `graph.tar`.
- Each pair ran under both of the SDK's transports: `indexed-tar` (byte ranges into `graph.tar`) and
  `individual-tiles` (one GET per `.gph` file).

## Results

### Route time, bytes and tiles

Times are wall-clock milliseconds measured on the page around `router.route()`, on localhost, so they are compute time
plus a near-zero network. Ranges are over the three pairs in each class. Initialising the router (module start and
graph metadata) took **74 to 205 ms** and fetched **13,990 bytes** of metadata (`indexed-tar`) or 12,070
(`individual-tiles`), on top of the WASM.

| Class | Routes (km) | Transport | Cold route | Bytes fetched on the cold route | Tiles | Warm route | Dragged waypoint |
|---|---|---|---|---|---|---|---|
| 5 km | 5.69, 4.88, 5.07 | `indexed-tar` | 232–282 ms | 7.7–13.3 MB | 3–4 | 2–8 ms | 2–5 ms |
| 5 km | | `individual-tiles` | 225–284 ms | 7.7–13.3 MB | 3–4 | 2–10 ms | 2–7 ms |
| 40 km | 45.19, 38.91, 38.19 | `indexed-tar` | 252–307 ms | 9.6–18.5 MB | 5–7 | 12–62 ms | 17–61 ms |
| 40 km | | `individual-tiles` | 266–371 ms | 9.6–18.5 MB | 5–7 | 12–45 ms | 11–54 ms |
| 150 km | 163.02, 166.88, 150.85 | `indexed-tar` | 713–798 ms | 53.1–54.0 MB | 22–24 | 278–354 ms | 279–322 ms |
| 150 km | | `individual-tiles` | 761–837 ms | 53.1–54.0 MB | 22–24 | 289–372 ms | 298–329 ms |

- **A warm route and a dragged waypoint fetched nothing** in every run (0 requests): once a session holds the tiles
  around a route, re-snapping a moved point is compute alone.
- **The 150 km routes fetched essentially the whole graph** (53–54 MB of 54.1 MB). The search fans out across most of
  a small state.
- **The bytes are the cost, not the compute.** At an illustrative 20 Mbit/s, which is arithmetic and not a
  measurement, a cold 5 km route is 3 to 5 s of download, a 40 km one 4 to 7 s and a 150 km one about 22 s. A route
  through a denser state would fetch more per kilometre: the largest tile here, 11.8 MB, is one town.
- **The graph cannot be compressed on the wire.** `gzip -6` takes `graph.tar` from 54.1 MB to 20.2 MB, but the SDK
  rejects any `Content-Encoding` other than identity (its `HttpStore.read`), so the host must serve it uncompressed.
- **The app's own assets** would add 9.86 MB of WASM (2.14 MB with `gzip -9`, 1.38 MB with Brotli at quality 11) and
  an 87.8 KB worker (28.6 KB gzipped), fetched once per install.

### The HTTP cache across sessions

A second router session in the same browser profile, routing the same 40 km pair:

| Transport | Graph bytes from the server, first session | Second session |
|---|---|---|
| `indexed-tar` | 18,511,320 | **18,511,320** |
| `individual-tiles` | 18,509,400 | **0** |

Headless desktop Chromium did not reuse cached byte ranges of `graph.tar`; it did reuse whole `.gph` files. A rider who plans near home
twice would download the tiles twice under the default transport and once under `individual-tiles`. The SDK keeps no
store of its own (no OPFS or IndexedDB, its README says), so the HTTP cache is all there is, and it is evictable.

### The decoded-tile budget

The SDK's `memoryBudgetBytes` bounds the decoded tiles it keeps; the default is 32 MiB, and the runs above used
128 MiB, the SDK's maximum. One 150 km pair (163 km) was routed at four budgets:

| Budget | Result |
|---|---|
| 32 MiB (the default) | **Did not finish in 150 s.** The progress log shows the same tiles fetched again and again: the route's working set does not fit, the hard LRU evicts, and the search asks for the tile back |
| 48 MiB | 993 ms |
| 64 MiB | 1,022 ms |
| 128 MiB | 765 ms (the table above) |

The SDK sets no limit of its own on that loop. A build has to size the budget to the dataset's largest route and
abort a route that runs long (the SDK takes an `AbortSignal`); otherwise a long route never returns.

### Memory

- **WebAssembly linear memory**: the high-water capacity was **128 MiB in every run**, the SDK's default initial
  allocation in a browser, and it never grew toward the 512 MiB default cap. The decoded cache held 7.4 to 51.5 MiB
  after the warm route.
- **Process memory**, the resident size of every process the Chromium instance reported (browser, GPU, network and
  renderers), read with `ps`: 136 MiB idle, **330 MiB after the first 5 km route**, and 532 to 651 MiB after the later
  runs. The later figures include processes of closed contexts that had not yet exited, so they are an upper bound and
  not a per-route figure. None of it is a tablet figure.

### Do the routes match the instance's Valhalla?

For all nine pairs, under both transports, the route's length matched `valhalla_service` 3.8.3 to the reported
precision and the two shapes' Hausdorff distance was **0 m**. That is the expected answer for the same engine on the
same `graph.tar`, and it is what it proves: the WebAssembly build changes nothing about the route. It does **not**
prove that an instance built from another extract date or another configuration ([#2008](https://github.com/openzigs/onyourleft/issues/2008))
would agree; those would differ by their data, as two instances would.

### The Content-Security-Policy

`apps/web/index.html` declares no policy, and nothing in `apps/mobile` adds one, so today the app and the Android
shell restrict neither WASM nor workers. The demo page (`apps/web/demo/index.html`) has one in a `<meta>` tag. Five
policies were tried with the page on one origin and the graph on another, as `tiles.openzigs.com` would be.

**First finding: a policy on the page does not reach the routing worker.** A dedicated worker loaded from a URL takes
its policy from the **worker script's own response headers**, not from the document. With the policy on the page only,
every one of the first four policies below routed, including the demo's, whose `connect-src 'self'` should have
refused the graph. A `<meta>` policy, which is the demo's, can never govern the worker. The table below is therefore
with the same policy also sent on the worker script's response:

| Policy | Result |
|---|---|
| None (the app and the Android shell today) | Routed |
| The demo page's policy, unchanged | **Refused**: the manifest fetch failed (`connect-src 'self'`) |
| The demo page's policy plus the graph's origin in `connect-src` | Routed |
| `connect-src` allows the graph, `script-src 'self'` without `'wasm-unsafe-eval'` | **Refused**: `WebAssembly.compileStreaming` violates `script-src` |
| `worker-src 'none'` | **Refused**: the worker could not be created |

So a policy the app adds later needs, **on the response that serves the worker script**: `'wasm-unsafe-eval'` in
`script-src`, the graph's origin in `connect-src`, and `'self'` in `worker-src`.

### Licences

- **The SDK**: MIT (`LICENSE`, `dist/licenses/SDK.txt`).
- **Compiled into the WASM**, from `dist/licenses/`: Valhalla MIT; Boost BSL-1.0; Protobuf BSD-3-Clause; protozero
  BSD-2-Clause; vtzero BSD-2-Clause; zlib (Zlib); RapidJSON MIT; Howard Hinnant's `date` MIT; `unordered_dense` MIT;
  `cpp-statsd-client` MIT; `cxxopts` MIT; musl MIT; Emscripten MIT or NCSA (with LLVM's Apache-2.0 WITH
  LLVM-exception parts); the IANA time-zone data public domain. **None is copyleft and every one is OSI-approved.** A
  search of the fifteen licence texts for GNU GPL, LGPL or AGPL text found none.
- **Where it may go**: `apps/web` (AGPL-3.0-or-later) may take MIT code; the adapter belongs there in any case, since
  `docs/agents/route-planning.md` §4i keeps engine types out of `packages/domain`'s `RoutingProvider`. A build has to
  carry the fifteen licence texts and the package's `NOTICE.md` through `check:notices` (§4g).
- **The graph is ODbL-1.0**, derived from OpenStreetMap. Hosting it is a public use of a derived database, so it needs
  OpenStreetMap attribution, as the basemap archive already carries.
- **Maturity, which is not a licence matter but sits beside it**: `valhalla-browser` is at 0.2.1, first published
  2026-09-18, with one maintainer. Its README says physical mobile devices are **not** among its verification targets.

## What a build would have to do differently from the defaults

Each of these was found by the measurement and none is a guess:

1. **Turn off `loki.use_connectivity`** in the configuration served with the graph. With
   `valhalla_build_config`'s default (`true`), every route failed with Valhalla error 170 (*unconnected regions*):
   the likely reason, not read in Valhalla's source, is that the connectivity map is built from a local tile
   directory and with remote tiles there is none. Setting it to `false` made every route work. (The SDK's own
   `data:osm` script may already do this; it was not run.)
2. **Use the `individual-tiles` transport.** It costs one request per tile instead of byte ranges, and it is the only
   one the browser's cache reused.
3. **Size `memoryBudgetBytes` to the dataset, and time a route out.** The default livelocks on a long route here;
   128 MiB is the SDK's maximum, and a state whose long routes need more than that cannot be routed end to end at all.
4. **Route each leg separately.** The SDK accepts exactly two locations per request (`validateRequest`), and one
   worker runs one route at a time. A drawn route of N points is N − 1 requests in series. That fits the planner's
   existing per-leg draft and its stale-leg accounting (`docs/agents/route-planning.md` §4i).
5. **Host the graph uncompressed**, in an immutable release directory whose name is the manifest's `release`, with a
   strong `ETag`, `Last-Modified`, single-range support, and CORS that exposes `ETag`, `Content-Length`,
   `Content-Range` and `Last-Modified`.
6. **Serve the worker and the WASM from the app's own origin**, so that no third party is contacted and no blob-worker
   bootstrap is needed, and send any future policy on the worker's response (above).
7. **Record the boundary in `apps/web/src/privacy/boundaries.ts`**, as the owner's privacy ruling asks: snapping
   fetches the level-2 tiles around each point, including near home, from our own host and never a third party. In
   these runs a 5 km route asked for 3 or 4 tiles and a 150 km route for 22 to 24, so the set of tiles requested draws
   the route's corridor at about 28 × 22 km resolution. With `individual-tiles` a tile already cached is not asked for
   again.

## Recommendation

**On the desktop, in-browser Valhalla works well enough to build snapping for everyone**, with the seven changes above.
Compute is not the problem: a 40 km route is a third of a second cold, a dragged waypoint re-snaps in under 70 ms up to
40 km and in about a third of a second at 150 km, and the routes are the native engine's. **The cost is bytes**: 8 to
13 MB for the first short route, and most of a state's graph for a long one, uncompressible, on mobile data.

**What should gate the build is the owner's tablet**, which this spike could not touch: cold and warm route time in the
Capacitor WebView and in Chrome, memory with the 128 MiB WASM allocation and a 128 MiB decoded-tile budget on a tablet,
and whether its HTTP cache keeps `.gph` files as desktop Chromium did. If the tablet's numbers hold, there is no reason
on this evidence to try `route_snapper`. If memory does not fit, `route_snapper` at city or county scale is the ruled
fallback, and leaving snapping to home instances ([#2008](https://github.com/openzigs/onyourleft/issues/2008)) the other.

The tile build itself is cheap (30 s for this state), so building the state the owner rides in costs nothing worth
deciding on; that build is also the first measurement #2008 needs, as the ruling says.

## Not measured, and limits

- **The owner's tablet**, in the Capacitor WebView and in Chrome: every number the issue's ruling asks for there. This
  is the gate, above.
- **A real network.** The graph was on `127.0.0.1`. Cold times over R2 and the CDN, and whether R2 serves the headers
  the SDK checks (`ETag` byte for byte, `Content-Range`, no encoding), were not tried.
- **A larger or denser state.** This one's largest tile is 11.8 MB and its whole graph fits the 128 MiB budget. A
  state with larger tiles, or a long route whose working set exceeds 128 MiB, was not tried, and the second is the
  case that would not route at all.
- **The SDK's own dataset build** (`data:osm`), which adds time-zone data and may set the connectivity option itself.
  The graph here has no time-zone database (`valhalla_build_tiles` warned), which matters to time-dependent costing
  and not to a planned bicycle route.
- **`route_snapper`, BRouter and the basemap's roads.** The ruling puts Valhalla first and rules the basemap's roads
  out; the other two are fallbacks and were not measured.
- **Elevation**, which is [#2013](https://github.com/openzigs/onyourleft/issues/2013)'s.
- **Snap quality against what a rider meant.** The only check was agreement with the native engine. Whether the
  bicycle costing's defaults choose roads a rider would accept is a question about Valhalla, the same on an instance.
- **One machine, one run per configuration**, except that each class has three pairs. No timing here is a
  distribution.
