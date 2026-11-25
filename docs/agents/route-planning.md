# Route planning

Part of the agent instructions. The root [`CLAUDE.md`](../../CLAUDE.md) is the index; this file
carries §4i, moved out of it verbatim on 2026-10-05 so that it is read when it is needed
rather than loaded into every session. **Read it when you work on route planning, the routing interface, or anything that would talk to a routing engine.**

It has the same authority as the root file. Where the text below says "this file" or
"CLAUDE.md", it means the root index and the files under `docs/agents/` together; a bare
"§4c" is found through the topic map in the root.

---

### 4i. Route planning has an interface and no engine, deliberately

[#70](https://github.com/openzigs/onyourleft/issues/70)'s `RoutingProvider` is in
**`packages/domain/src/routing/`** and there is **no HTTP adapter anywhere**. Both halves of that
are decisions, and the second is the one that looks like an omission.

**Why the interface is in the Apache-2.0 leaf.**
[ADR 0010](../adr/0010-map-tiles-and-routing.md) D-4 chose Valhalla (MIT), self-hosted, reached
**over HTTP as a separate process** — so nothing is linked and no engine's licence attaches to this
codebase at all. What decides where the *interface* lives is D-4's other argument: *"the interface
outlives the transport… the moment anyone wants an offline or in-browser route, a permissive engine
can be compiled in and a GPL one cannot."* An Apache-2.0 leaf is where that door stays open.

⚠️ **#70's "no engine-specific type appears above the interface, proved by a lint-enforced import
boundary" is discharged by a rule that already existed.** `boundaries/dependencies` forbids any
import from `packages/*` into `apps/*` in both spellings (§4d), so a Valhalla type reaching
`packages/domain/src/routing/` is a lint error rather than a review note. `packages/domain`'s own
`lib: ["ES2024"]` / `types: []` closure is the second half: that file could not name `fetch`,
`Response` or `URL` even if somebody wanted it to.

⚠️ **The engine runs on the rider's instance, since #2008** — a reviewer who remembers this
paragraph saying *"Nothing is running"* is reading the old file. Valhalla `3.9.1` is an optional
add-on in `apps/instance/deploy/home/compose.yaml` (profiles `routing-build` and `routing`), and the
**HTTP adapter is on the instance**, `apps/instance/src/routing/valhalla.ts`, which owns the
named-option → costing table and was run against a real one-state build. The client never calls
the engine: `apps/web/src/instance/routing-port.ts` is a `RoutingProvider` that asks the instance,
sealed, through the one #777 module, and refuses on the device any leg or line touching a privacy
zone (a `departing` boundary in `privacy/boundaries.test.ts`). `main.tsx` hands the planner that
provider only when the device is connected to an instance it can seal to. Still not done: #70's
*"the same suite against two engines"* (OSRM, #3137).

⚠️ **And in the app, since #2734, when no instance routes a leg** ([ADR 0097](../adr/0097-in-browser-valhalla-is-a-routing-tier-when-there-is-no-instance.md)).
`apps/web/src/routing/tiers.ts` picks the engine per leg: the instance when it answers, else
Valhalla compiled to WebAssembly (`valhalla-browser` 0.2.1) on the build's graph
(`routing/browser-graph.ts`), else none and a straight line. `routing/valhalla-browser-provider.ts`
is the **one** module under `src/` that reaches the SDK, by a dynamic `import()` only
(`tools/valhalla/stays-out.test.ts`); it is a `departing` boundary, because the SDK's worker fetches
the graph's 0.25° tiles from the tile host. A leg the engine cannot route here (off the graph, too
large, too slow, not loadable, map tiles off) comes back as a `FreehandFallback` and the draft draws
it straight with the reason on it (`draft.ts`). The SDK takes no hills or surface option and has no
heights, so its legs' surface is `'unknown'` and the terrain archive measures them. Its contract is
`routing/contract-testing.ts`: the scripted double passes it in Vitest, and the adapter passes it
against the real SDK on a synthetic grid in `browser/routing.browser.spec.ts`.

**What is real, and what the tests therefore prove.** The interface; the validation every engine's
numbers must pass; the draft, its undo and its stale-leg accounting; the elevation profile and its
coverage; the screen. #71's two hardest criteria are about *how many times* an engine was asked and
*which legs* — a real engine answering correctly proves neither, which is why the double counts its
calls and a test reads the count.

⚠️ **`packages/domain` now exports two things called an elevation source and they are not the same.**
`segment/segment.ts`'s `ElevationSource` is a three-value category (`'device' | 'dem' | 'none'`);
`routing/provider.ts`'s **`ElevationDataset`** is a named dataset and its grid resolution, which is
what #72 requires a route to store. The second is not called `ElevationSource` because the first
already is — a collision the typechecker caught rather than a naming preference.
