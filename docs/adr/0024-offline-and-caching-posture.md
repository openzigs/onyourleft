# ADR 0024: The offline and caching posture — a hand-written worker, the whole asset graph, and an update a rider asks for

- **Status**: Accepted
- **Date**: 2026-09-20
- **Deciders**: the repository owner, who chose finding 4 of
  [#391](https://github.com/openzigs/onyourleft/issues/391) for a planning pass and then ruled on
  each of [#403](https://github.com/openzigs/onyourleft/issues/403)'s five sub-decisions. The
  rulings are the owner's because D-1 accepts a **dependency licence question** that `CLAUDE.md` §3
  says is answered before the code is written, and because D-2 decides what a rider downloads on a
  phone plan. Everything below the rulings is the author's, following from them
- **Issue**: [#403](https://github.com/openzigs/onyourleft/issues/403), under epic
  [#402](https://github.com/openzigs/onyourleft/issues/402), from
  [#391](https://github.com/openzigs/onyourleft/issues/391) finding 4
- **Number**: **0024**. 0021 remains a live reservation held by
  [#330](https://github.com/openzigs/onyourleft/issues/330) and still unwritten; 0022 was taken by
  [#340](https://github.com/openzigs/onyourleft/issues/340) and 0023 by
  [#357](https://github.com/openzigs/onyourleft/issues/357).
  [`docs/architecture.md`](../architecture.md)'s reservation table is the check `CLAUDE.md` §7 asks
  for, and it said 0024 was free
- **Supersedes**: nothing
- **Relates to**: [ADR 0002](0002-local-first-architecture.md), whose "works with no network"
  statements [#404](https://github.com/openzigs/onyourleft/issues/404) has just amended as false of
  the shipped artefact — **this ADR is the plan that makes them true**;
  [ADR 0011](0011-stream-storage.md), whose refusal of `navigator.storage.estimate()` is **not** an
  argument against `persist()` and D-5 says why; [ADR 0015](0015-dependency-licences.md), whose
  fail-closed branch produced D-1's measurement; [ADR 0010](0010-map-tiles-and-routing.md) D-1,
  whose basemap is the one thing D-2 deliberately does not precache

---

## Context

`CLAUDE.md` §1 says the first milestone is **"entirely local: pair a BLE trainer, record a ride,
store it, view it. No server, no account, no hosting bill."** ADR 0002 says the same in its own
voice at four separate lines. Until #404 the About screen said it to riders.

**It was not true of the shipped artefact**, and #404 measured exactly how untrue. Read on
2026-09-19 with this repository's own pinned Playwright (`@playwright/test` 1.63.0, Chromium
revision 1243) against `vite preview` over `apps/web/dist`:

| Scenario | Result |
|---|---|
| Online cold load, fresh context | `200`, app renders, 4 requests |
| `navigator.serviceWorker.getRegistrations()` | **0** |
| `caches.keys()` | **`[]`** |
| `navigator.storage.persisted()` | **`false`** |
| Offline reload of an already-loaded tab | **`net::ERR_INTERNET_DISCONNECTED`** |
| Offline cold start, fresh context | **`net::ERR_INTERNET_DISCONNECTED`** |
| Offline in-app hash navigation, tab already open | **Works**, 0 failed requests |

**The data is local and the app is not.** Nothing under `apps/web/src`, and nothing in any leaf
package's source, calls `fetch` or `XMLHttpRequest` at all — so recording, storing, analysing and
riding genuinely need no network. The client is still handed its HTML and its bundle by a server,
so a cold start needs one.

### Why this is a posture rather than a task

A service worker is a **cache that sits in front of the application itself**, and `CLAUDE.md` §5
names this program's dominant defect shape as *"a write that reports success while the read cannot
see it"*. A stale worker serving yesterday's bundle is that shape at the outermost layer, where it
is hardest to see and most expensive to diagnose. Four of the five decisions below exist because
the cache can be wrong in a way that still looks green.

### ⚠️ The riders this is for are in a basement

#391 finding 4's demand evidence is riders with a trainer in a garage or basement, on a laptop or
tablet with no reliable connection. That is the case that decides D-2: an app that opens offline
and whose headline feature does not would satisfy the letter of "offline" and none of the need.

---

## Decision

### D-1 — A hand-written service worker and a local Vite plugin. **Not** Workbox.

**This was settled by measurement rather than by preference**, on 2026-09-20, running the exact
sequence #403 prescribed:

```
pnpm --filter @onyourleft/web add -D vite-plugin-pwa@1.3.0
  → +284 packages

pnpm run check:licences
  → DEP001: @onyourleft/web (apps/web): caniuse-lite is CC-BY-4.0, which is not
    permitted in the build-time closure of an AGPL-3.0-or-later application
  → exit 1
```

The path, from `pnpm why caniuse-lite --recursive`:

```
caniuse-lite@1.0.30001810
└─ browserslist → @babel/helper-compilation-targets → @babel/core
   → @babel/preset-env → workbox-build@7.4.1 → vite-plugin-pwa@1.3.0 → @onyourleft/web
```

The tree was restored (`git checkout -- . && pnpm install --frozen-lockfile`) and
`check:licences` returned to green — *868 dependency licences across 7 workspace packages are
permitted where they land*.

**So adopting Workbox costs a licence ruling before it costs a line of code.** `DEP001` fails
closed, and admitting `CC-BY-4.0` into ADR 0015's build-time table would be an ADR 0016-shaped
amendment taken for a transitive dependency of a plugin that generates a list of files this
repository already produces.

⚠️ **And the asymmetry that makes this read strangely is deliberate and already recorded.**
`CC-BY-4.0` **is** admitted for a committed **asset** under `apps/` — [ADR 0023](0023-cc-by-assets-and-attribution.md)
D-1 — and is **not** admitted as a **dependency** licence, because ADR 0023 D-5 deliberately left
ADR 0015's tables alone. The asset gate and `DEP001` disagree on purpose. This ADR does not
disturb that.

**What is written instead**: `apps/web/sw.ts`, plus a small local Vite plugin that reads the
build's own output. Zero dependencies, zero licence question, no `minimumReleaseAge` collision
(`CLAUDE.md` §8), and the cache policy readable in one file — the same posture as `scripts/*.sh`
and `apps/web/browser/pmtiles-fixture.ts`, both of which chose writing the thing over installing
it.

**What this costs, stated plainly**: the update dance is written by hand. That cost is **not
avoided** by Workbox, because D-3 forbids the default `skipWaiting()` behaviour anyway and
[#407](https://github.com/openzigs/onyourleft/issues/407) has to specify the sequence either way.

### D-2 — The **whole asset graph** is precached, and the list is derived rather than written

Shell-only — `index.html`, the entry chunk, the CSS — would ship an application that opens with no
network and whose trainer game does not. That is not what #391 finding 4 asks for.

So the precache covers the shell **and** the lazy chunks (`three-renderer`, `maplibre`,
`FitnessChart`, `TraceChart`) **and** the eleven `.glb` files and one `.png` that
`apps/web/src/game/scenery-models.ts` imports as `?url`.

⚠️ **The list is generated from the build's own output and is never written down.** A hand-written
list fails closed against *deleting* an asset and **open** against *adding* one, which is
[#142](https://github.com/openzigs/onyourleft/issues/142)'s defect exactly (`CLAUDE.md` §4e): the
gate keeps passing while the thing it selects quietly shrinks. A new model added to
`scenery-models.ts` must land in the precache with no edit to the worker, and
[#406](https://github.com/openzigs/onyourleft/issues/406) is where that is enforced rather than
intended.

⚠️ **The basemap is NOT precached, and that is a decision rather than an oversight.** ADR 0010 D-1
put PMTiles on object storage read over HTTP range requests; a continental archive is roughly
19 GB. Caching it is a feature with a storage cost, a cost-model consequence (`CLAUDE.md` §4l) and
a rider-facing choice about *which region*, and it is none of this epic's business.
⚠️ **The trainer game does not need it**: `apps/web/src/game/hud/plan.ts` draws the route in plan
view with no basemap and issues no request, because it projects `RouteProfile.positions` the game
already holds, and `apps/web/src/game/plan-no-network.test.tsx` asserts it asks for no tile. **A
feature that needs no network because it needs no remote data beats one that caches remote data**,
and that is the shape this epic reaches for.

Route **planning** is out of scope for a different reason: `CLAUDE.md` §4i records that there is a
`RoutingProvider` interface and deliberately no engine adapter, so planning is unavailable online
too. [#53](https://github.com/openzigs/onyourleft/issues/53) owns it.

### D-3 — The update is one a rider asks for, and never arrives mid-ride

Stated as rules, because this is where §5's dominant defect reappears:

1. **No `skipWaiting()` on install.** A page controlled by worker v1 that later `lazy()`-imports a
   chunk from v2's precache is served an asset its own bundle does not expect, or a 404 —
   [create-react-app#3613](https://github.com/react/create-react-app/issues/3613). ⚠️ This client
   is eleven models and four lazy chunks deep, so that is the **likely** case here rather than the
   exotic one.
2. **Activation is rider-gestured**: a new worker waits, the rider is told, and only an explicit
   action sends `SKIP_WAITING`. Then `controllerchange`, then one reload.
3. ⚠️ **Never activate while a ride is recording.** Swapping the worker mid-ride can break the
   very lazy import the ride is about to need, on the one screen a rider cannot attend to.
   `apps/web/src/recording/` knows whether a recording is live; the update path asks it.
4. **Cache names carry a version**, and `activate` deletes every cache that is not the current
   one. A cache nobody deletes is a disk leak that outlives the bug that created it.

### D-4 — The worker does **not** register inside the Android shell

Registration happens only when `apps/web/src/support/capacitor.ts` §`isNativeShell()` is false.

`apps/mobile/capacitor.config.ts` sets `webDir: '../web/dist'` and `cap sync` copies those assets
**into the APK** (`CLAUDE.md` §4h), so inside the shell the client is already served from local
storage and already cold-starts with no network —
[#410](https://github.com/openzigs/onyourleft/issues/410) measures that rather than assuming it. A
worker there would add a cache layer in front of files that are already local: all of D-3's
staleness risk, none of D-2's benefit.

⚠️ **It is not merely redundant, it is worse than redundant.** An APK update replaces the asset
tree wholesale while a registered worker would still be holding the previous build in Cache
Storage, keyed to the same origin — which is D-3's failure mode arriving by a route D-3's
rider-gestured reload cannot reach, because the rider never asked for a web update.

### D-5 — `persist()` is called, and the icons are `CC0-1.0`

**Persistence.** `navigator.storage.persist()` is called once the app is installed — Chrome grants
it silently on a heuristic that includes the site having been installed or bookmarked
([web.dev/articles/persistent-storage](https://web.dev/articles/persistent-storage), read
2026-09-19), which is why [#409](https://github.com/openzigs/onyourleft/issues/409) is blocked by
the manifest and the worker rather than standing alone. Until then every ride in IndexedDB sits on
the browser's **best-effort** tier, which `persisted() === false` measured above.

⚠️ **ADR 0011's refusal of `navigator.storage.estimate()` is not an argument against this, and the
two are different APIs answering different questions.** ADR 0011 lines 54 and 236 decline
`estimate()` because it is *"unavailable in the test environment"* and because *"it reports a
browser-quota figure that includes the origin's other storage rather than this ride's cost"* —
both statements about **measuring** storage. `persist()` **requests durability** and returns a
boolean about this origin. Neither reason transfers. This is recorded here so the next reader does
not re-derive it, or worse, read ADR 0011 as forbidding it.

⚠️ **The account export ([#35](https://github.com/openzigs/onyourleft/issues/35)) remains the real
backstop and this does not replace it.** `persist()` is a request the browser may refuse, and
About already tells riders the honest consequence: clearing site data removes the rides and there
is no copy anywhere else.

**Icon licence — and this is a red build if it is not ruled here.** A web app manifest needs icons;
icons are committed binaries; `ASSETS.toml` rows are therefore required and `ASSET004` fails
closed. Read from `scripts/check-repo-rules.sh` on 2026-09-19:

```
ASSET_LICENCES_PERMISSIVE="Apache-2.0 MIT BSD-2-Clause BSD-3-Clause ISC"
ASSET_LICENCES_WEAK="CC0-1.0 MPL-2.0 BlueOak-1.0.0 MIT-0 0BSD Unlicense"
ASSET_LICENCES_ATTRIBUTED="CC-BY-4.0"
```

⚠️ **`AGPL-3.0-or-later` is on none of those lists.** A PNG this repository draws itself, committed
under `apps/`, **fails `ASSET004`** — which is the gate working correctly rather than a bug in it.

**The icons are declared `CC0-1.0`**, which is already admitted under `apps/`. That is a dedication
this project is entitled to make of its own work, it needs no list widened and no third party
credited, and it matches what `apps/web/src/game/models/` already carries. The alternative —
widening `ASSET_LICENCES_*` to admit the project's own copyleft — is rejected: it would make the
asset gate's lists a statement about *who wrote a file* rather than *what may ship*, and #372's
week has been a long argument for not loosening a gate to fit a case.

---

## Consequences

### What this enables

- ADR 0002's four "no network" statements become true of the shipped artefact rather than of the
  architecture alone, and #404's amendment can be superseded by a measurement.
- A rider in a basement opens the app with the connection off and rides.
- #409 becomes reachable, so a rider's history leaves the evictable tier.
- The precache list cannot silently shrink when an asset is added.

### What this costs, stated plainly

- **The update dance is ours to write and ours to get wrong.** D-3 is four rules and every one of
  them is a way the cache can serve something stale. #407 carries them.
- **A first visit downloads more.** D-2 precaches the models and the lazy chunks, which is a real
  number on a phone plan and is not yet measured — #406 publishes it the way validation 0002
  Part H publishes the model cost.
- **Two client behaviours now differ by platform** (D-4), which is a thing to hold in mind
  whenever an offline bug is reported: *which* build was it.
- **The basemap stays online-only**, so the ride map is the one screen that does not work in a
  basement. The trainer game does, which is the one that matters for #391's riders.

### Constraints this places on other work

- A new asset imported as `?url` must reach the precache with **no** edit to the worker (D-2).
- Nothing may call `skipWaiting()` on install (D-3).
- Nothing may register the worker inside the shell (D-4).
- A committed icon carries an `ASSETS.toml` row with a licence `ASSET004` admits (D-5).
- ⚠️ An offline claim in prose or in a UI string is only as good as the gate behind it. #404's
  header records why: *"restoring the claim first is how it went unnoticed the first time."*
  [#408](https://github.com/openzigs/onyourleft/issues/408) is where the claim is proved, in the
  pinned Chromium, **with a control** — because an offline assertion that passes against a page
  which rendered nothing is the vacuous pass this repository has shipped five times.

### What would make this ADR wrong

- **`vite-plugin-pwa`'s closure stops reaching `caniuse-lite`**, or ADR 0015 admits `CC-BY-4.0` in
  the build-time closure for an unrelated reason. D-1 is a measurement with a date on it and it
  ages; re-run the four commands before citing it.
- **A hand-written worker accumulates enough special cases to be worse than the library.** The
  honest signal is `sw.ts` growing a second cache strategy; at that point re-run D-1's measurement
  rather than defending the original choice.
- **Chrome's persistence heuristic changes** so that installation no longer implies a grant, which
  would make D-5's sequencing wrong without making `persist()` wrong.
- **The Android shell turns out not to cold-start offline.** D-4 rests on it; #410 measures it, and
  a negative result reopens D-4 rather than this whole ADR.

---

## Notes

⚠️ **This ADR decides a posture and builds nothing.** Its five decisions are implemented by
[#405](https://github.com/openzigs/onyourleft/issues/405) (manifest and icons),
[#406](https://github.com/openzigs/onyourleft/issues/406) (precache),
[#407](https://github.com/openzigs/onyourleft/issues/407) (the update path),
[#408](https://github.com/openzigs/onyourleft/issues/408) (the proof, in a real browser),
[#409](https://github.com/openzigs/onyourleft/issues/409) (persistence) and
[#410](https://github.com/openzigs/onyourleft/issues/410) (the Android measurement).

⚠️ **D-1 is the third time a licence gate's fail-closed branch has decided a design question here**,
after [ADR 0016](0016-unlicense.md) and [ADR 0023](0023-cc-by-assets-and-attribution.md) — and the
first where the answer was to **not adopt the dependency** rather than to rule on its licence. That
is worth noticing: `DEP001` is doing more design work than a licence checker is usually credited
with.

## What was read, and when

| Source | Read | What it settled |
|---|---|---|
| `pnpm --filter @onyourleft/web add -D vite-plugin-pwa@1.3.0`, then `pnpm run check:licences` | 2026-09-20 | D-1 — `DEP001` exit 1 on `caniuse-lite` / `CC-BY-4.0`, +284 packages |
| `pnpm why caniuse-lite --recursive` | 2026-09-20 | D-1 — the path through `workbox-build` → `@babel/preset-env` → `browserslist` |
| `git checkout -- . && pnpm install --frozen-lockfile`, then `pnpm run check:licences` | 2026-09-20 | the tree restored; 868 licences permitted |
| [#404](https://github.com/openzigs/onyourleft/issues/404)'s Playwright measurement | 2026-09-19 | the Context table — what the shipped build does offline |
| [web.dev/articles/persistent-storage](https://web.dev/articles/persistent-storage) | 2026-09-19 | D-5 — the grant heuristic includes installation |
| [create-react-app#3613](https://github.com/react/create-react-app/issues/3613) | 2026-09-19 | D-3 — the stale-chunk failure mode |
| [Workbox — handling service worker updates](https://developer.chrome.com/docs/workbox/handling-service-worker-updates) | 2026-09-19 | D-3 — the `SKIP_WAITING` / `controllerchange` / reload sequence |
| `scripts/check-repo-rules.sh` §`ASSET_LICENCES_*` | 2026-09-19 | D-5 — `AGPL-3.0-or-later` is on none of the three lists |

---

## Amendments

Appended under [ADR 0013](0013-adr-amendments.md). Nothing above this line has been edited.

- **2026-09-21** — §Consequences' *"A first visit downloads more … and is not yet measured"* is
  no longer wholly true: its first-visit half was measured for
  [#418](https://github.com/openzigs/onyourleft/issues/418), in the lockfile-pinned headless
  Chromium on a developer machine and **not on a phone**, so the phone-plan half still stands.
  **Method.** A cold first visit per run (a fresh browser context: no cache, no worker); the build
  served by a local static server with **one shared throttled downlink** — so the page and the
  service worker's precache genuinely contend, which DevTools' per-target network emulation does
  not model — at 1.6 Mb/s down and 150 ms per request (DevTools' "Slow 4G" figures), gzip on text
  as a CDN would send it, and the CPU throttled 4× over CDP; FCP from the `paint` timeline,
  offline-ready as `navigator.serviceWorker.ready`; nine runs each, median reported. **Figures.**
  The whole first visit — app plus D-2's precache — is **1,363,395 bytes on the wire** (the
  precache is 27 files, 3.09 MiB uncompressed). Median first contentful paint was **1804 ms** as
  shipped, **1700 ms** with the first render no longer waiting for `register()` to resolve, and
  **1688 ms** with registration also deferred to `window.load`; median offline-ready was 7517,
  7565 and 7574 ms respectively. A second batch comparing the shipped build with the change
  `main.tsx` now carries gave FCP **1836 → 1708 ms** and offline-ready 7572 → 7482 ms. At 9 Mb/s,
  40 ms and no CPU throttle every variant but the original painted at 392 ms (the original: 428).
  **Reading.** The cost on first paint was the `await` of the registration before the first
  render — one round trip for `sw.js` — and not bandwidth contention from the precache: the entry
  chunk is fetched before the worker registers and `load` fires before the first paint. Deferring
  registration to `load` moved median first paint by 12 ms and median offline-ready by 9 ms
  (7574 against 7565 ms) — both inside the runs' spread, so neither is read as signal in either
  direction: deferring bought nothing measurable. So `main.tsx` renders first and still registers at module
  evaluation; its comments carry these numbers, and the apparatus is described here and in the pull
  request that closes #418 rather than committed as a gate, because a timing gate on a GPU-less CI runner is
  the flaky kind.
