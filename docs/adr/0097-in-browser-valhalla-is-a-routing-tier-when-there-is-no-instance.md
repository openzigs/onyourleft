# ADR 0097: In-browser Valhalla is a routing tier, used when no instance routes a leg

- **Status**: **Accepted**, 2026-11-24, on the owner's ruling of that day on
  [#2730](https://github.com/openzigs/onyourleft/issues/2730): *"yes, in-browser Valhalla becomes a
  product routing tier, used when there is no instance"*, chosen as "In-app routing, no server"
  alongside instance routing. The ruling made the decision. This ADR records it and the terms #2730
  asked for. The author chose each term below, and each is marked as a recommendation the owner can
  overrule without reopening the yes
- **Date**: 2026-11-24
- **Deciders**: **the owner** (the yes); the author (the terms, D-1 to D-7)
- **Issue**: [#2730](https://github.com/openzigs/onyourleft/issues/2730), built by
  [#2734](https://github.com/openzigs/onyourleft/issues/2734), under the route builder's phase 2
  epic [#2729](https://github.com/openzigs/onyourleft/issues/2729). It rests on
  [#2347](https://github.com/openzigs/onyourleft/issues/2347) (the per-tile limit) and
  [#2008](https://github.com/openzigs/onyourleft/issues/2008) (instance routing)
- **Number**: **0097**. On 2026-11-24, `docs/agents/conventions.md` §7 gives 0097 as the next free
  number, and no remote branch's `docs/adr/` holds it
- **Supersedes**: nothing. [ADR 0010](0010-map-tiles-and-routing.md) D-4 chose Valhalla for the
  reason that it can be compiled in: *"the moment anyone wants an offline or in-browser route… a
  permissive engine can be compiled in and a GPL one cannot"*, and its *Consequences* list *"An
  offline or in-browser router later — provided the engine is permissive"*. This ADR takes up that
  option. D-4's separate process stays the shape of the instance tier. ADR 0010 gains one dated
  `## Amendments` pointer here (ADR 0013). Its body is not edited
- **Leaves standing**: ADR 0036 D-3's four invariants (a rider with no instance gains a tier and
  loses nothing); ADR 0004 D (no message names a coordinate); ADR 0054 D-6.4 (one switch for
  everything the tile host is asked)

## Context

Until #2008 every leg the route planner drew was a straight line. #2008 routes on the rider's own
instance when one is paired, so a rider with no instance still drew straight lines. Spike
[0035](../spikes/0035-snapping-a-drawn-route-in-the-browser-with-valhalla-wasm.md) measured
`valhalla-browser` 0.2.1 (MIT, Valhalla 3.8.3 compiled to WebAssembly) on a desktop. It found that
the routes match the native engine's to the metre, and it listed seven settings a build needs.
#2009 measured it on the owner's tablet in Chrome: a 5 km route took 2.7 s cold and about 40 ms
warm, and a 150 km route took 19.1 s cold and about 1.2 s warm, with 128 to 189 MiB of WebAssembly
memory. **Not measured: the Capacitor WebView**, which is the app. #2734's tablet check closes that
gap, and it is owed (D-7).

#2730 asked for six decisions. Each is stated below as a decision, not a list of options.

## Decision

### D-1 — Three tiers behind the one `RoutingProvider`, in a fixed order

1. **The instance**, when this device is connected to one it can seal to (`instance/routing-port.ts`
   §`offered`) **and it answers**. It has the full costing (hills, surface) and its own heights.
2. **In-browser Valhalla**, when the build names a graph (`routing/browser-graph.ts`) and map tiles
   are on.
3. **Freehand**, always.

`apps/web/src/routing/tiers.ts` §`routingTiers` is that order, and `main.tsx` §`buildRouting` is
the one place it is built. The in-browser engine is made on the first leg it is asked for. With an
instance that answers, it is never made and its graph is never fetched (`tiers.test.ts`). A leg goes
from the instance to the browser **only** when the instance answers `'unavailable'` (unreachable, or
no engine behind it). Any other answer from the instance is final: no route, a waypoint in a privacy
zone, or a rate limit. A leg the instance refused for a privacy zone is not then sent anywhere else.

**What the rider sees when the browser tier refuses a leg.** It is outside the graph
(`OUTSIDE_COVERAGE`), too large for the engine's memory (`RESOURCE_LIMIT`), too slow (`TIMEOUT`, or
90 s, which the adapter cancels), or the engine or graph cannot be loaded (offline, a host error, a
changed file, map tiles off). In each case the leg is drawn **freehand**: a straight line whose
length is a lower bound, marked with a fixed sentence that says why, and "Follow roads" on it asks
again (`draft.ts` §`FreehandFallback`). Only a graph that holds both ends and finds no road between
them (`NO_ROUTE`, `LOCATION_NOT_FOUND`) leaves a failed leg, because then the rider has to move a
waypoint. No sentence names a coordinate or a place, and the SDK's own text is never shown.

**What the browser tier does not do.** The SDK takes `bicycle_type` and no `use_hills` or
`avoid_bad_surfaces`. So the hills and surface choices do not reach it, and every leg it routes has
surface `'unknown'`, never assumed paved (#70, #72). It has no heights: the terrain archive (#2013)
measures a route the browser routed, at the archive's own 15 m spacing.

### D-2 — Coverage: one state's graph per release, immutable, on our R2

The graph is one release directory, `https://tiles.openzigs.com/routing/<release>/`, that
`apps/web/tools/valhalla` builds and `upload.sh` uploads. It is never overwritten, and a newer graph
is a new directory. `PUBLISHED_ROUTING_GRAPH_URL` names the release built for #2347: one state, not
named in public text (the owner's rule), with its largest tile at 17.7 % of the limit
([spike 0042](../spikes/0042-dense-city-tiles-over-the-browser-sdk-limit.md)). A shipped build names
its release, so a directory a shipped build names is never deleted. A rider outside the state gets
straight lines (D-1), as with no tier at all. A regional or national graph is a later decision, and
the per-tile limit (D-3) and the 4 MiB manifest limit bound it. A self-hosted build points
`VITE_ROUTING_GRAPH_MANIFEST_URL` at its own release, or sets `none`. **Recommendation:** add a
`docs/cost-model.md` row when a second state is published. One state's graph is 54 MB, under a
cent a month on R2, so this ADR adds no row (`check:cost-model` is not touched).

### D-3 — Dense metros: refuse at the build, never in a rider's session

`valhalla-browser` 0.2.1 refuses a whole graph if any tile is over 64 MiB. `make-release.ts` refuses
such a build and names each tile (#2347), so a graph a session cannot open is never published. A
leg through a tile left out of a graph is outside it, and D-1 draws it straight. Spike 0042 lists
what can be done for a dense metro, in order of cost: build with pedestrian-only ways off, leave the
tile out and say so, or ask upstream for a higher limit. **No tile is left out silently.** A release
that omits one says so in its build record and in the pull request that publishes it.

### D-4 — The privacy boundary: squares of the graph, named in the request

The engine runs on the device, and no waypoint, line or coordinate leaves it. What leaves is the
graph tiles a leg's search reaches. The SDK fetches each level-2 tile as a file of its own
(`tiles/2/…/<id>.gph`, the `individual-tiles` transport spike 0035 chose because it is the only one
the HTTP cache reused). So the host can tell which 0.25° squares, about 28 × 22 km at mid-US
latitudes, a route crossed, and **unlike the map and the terrain archive, the request's path names
the square**, so Cloudflare's retained record holds it too. The fetch is a function of the squares
alone, so it reads inside a privacy zone the same way as outside one. With map tiles off nothing is
fetched. It is recorded as a departing boundary in `privacy/boundaries.test.ts` and disclosed in
`docs/privacy-policy.md` and the Play Location row (`apps/mobile/src/android/data-safety.ts`).
`privacy/no-network.test.ts` §"the in-browser routing graph is disclosed" holds all three to the
default host. `browser/routing.browser.spec.ts` watches the real worker fetch from no other origin.
**Recommendation:** keep `individual-tiles`. `indexed-tar` (byte ranges of `graph.tar`) would keep
the square out of the record, as the map's byte ranges do, at the cost of the HTTP cache. That is
the owner's trade to revisit.

### D-5 — Third-party runtime risk: pinned, named, and optional

`valhalla-browser` is 0.x, with one maintainer, last published 2026-09-21. It is pinned at exactly
`0.2.1`. Its WebAssembly is named in `apps/web/third-party-notices.json` §`copiedIntoBuild` by its
content hash, with all fifteen licence texts it carries, so a version bump fails the build until
someone reads the notices again. `tools/valhalla/stays-out.test.ts` admits exactly one module under
`src/` to it, and only by a dynamic `import()`. If it is abandoned: it is MIT, so a fork can rebuild
its WebAssembly, and the tier can be turned off with `VITE_ROUTING_GRAPH_MANIFEST_URL=none` with
nothing else lost (D-1's other two tiers). Builds are not byte-reproducible (#2347), so every build
is a new release (D-2). The engine and its 9.9 MB WebAssembly are kept out of the web precache
(`tools/routing/runtime-assets.ts`) and fetched on the first routed leg.

### D-6 — ODbL: the hosted graph is offered under ODbL, and credited where it is drawn

The graph is a Derivative Database of OpenStreetMap. Its directory carries `NOTICE.txt` and
`graph.tar` (ODbL §4.2, §4.3, §4.6 a; `make-release.ts`). A routed leg is a Produced Work. It is
drawn on the planner's map, which carries `© OpenStreetMap contributors`, and the Credits screen
names OpenStreetMap and the ODbL. `docs/odbl.md` §"The routing graph" says so. **Known gap:** a
planner whose map engine failed to load routes with the map tiles switch on and shows no credit
beside the legs. It is recorded in #2734's pull request as a follow-up.

### D-7 — The worker's policy, and the device check

The app declares no Content-Security-Policy today. When it does, the policy goes **on the response
that serves the worker script**: `'wasm-unsafe-eval'` in `script-src`, the graph's origin in
`connect-src`, and `'self'` in `worker-src` (spike 0035: a page's policy does not reach a worker).
The engine's worker and WebAssembly are served from the app's own origin, under `routing/`, and
never from a CDN. The tablet frame check in the Capacitor app, on a 40 km route with cold and warm
times, is the owner's, and #2734 cannot close it from a desktop.

## Consequences

- A rider with no instance gets roads in the state the graph covers. Elsewhere they get straight
  lines, marked as such. Nothing a rider could do before needs an instance now (ADR 0036 D-3 (a)).
- The app ships the engine: about 9.9 MB of WebAssembly (2.2 MB gzipped) in the APK, plus the
  notices of fifteen compiled-in libraries. Boost's per-file copyright listing alone is 2.1 MB, and
  it is in the notices twice: the served `licences/third-party.txt` and the Credits screen's copy.
- The planner keeps an engine's answer that arrives after the rider's next edit. Before, a slow
  engine left a leg "being routed" for good (`draft.ts` §`adoptAnswers`).
- The tile host learns which 28 × 22 km squares a drawn route crosses, by name (D-4).

## What would make this ADR wrong

- The tablet check shows the Capacitor WebView cannot hold the 128 MiB budget, or a cold 40 km
  route takes so long that a straight line is the better answer. Then the tier should be off by
  default on the device, and this ADR superseded.
- `valhalla-browser` changes its per-tile or memory limits, or its licence, in a release the
  project wants. Then D-3 and D-5 are re-read.
- The owner decides the square in the request path is too much (D-4). Then `indexed-tar` replaces
  `individual-tiles`.

## Sources

- Spike 0035, spike 0042, #2009's tablet measurement (2026-11-08), #2347.
- `valhalla-browser` 0.2.1's `dist/core/types.d.ts`, `dist/worker.js` and upstream's
  `packages/valhalla-core/src/loader.ts` and `native/runtime.cpp`, read on 2026-11-24.
