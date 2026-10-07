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

⚠️ **Why there is no adapter, and why writing one would be worse than not.** Nothing is running.
Standing up Valhalla is [#53](https://github.com/openzigs/onyourleft/issues/53), and #70's own
criteria — *"the same test suite passes against two different engines"* and *"repointed from a
bootstrap endpoint to a self-hosted instance"* — cannot be met without one. An adapter written
against an API nobody in the loop can call is §4a's *"a documented command nobody has run is the
most expensive kind of wrong"* in a new place, and it is **worse than absent**: a reviewer reads
request-shaping code as evidence the engine was talked to. `apps/web/src/routing/testing.ts` says
this at the point somebody would go looking, and `routing/preferences.ts` carries the named-option
→ costing mapping as a table so the adapter starts from ADR 0010's recorded read rather than a
guess.

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
