# ADR 0027: A tab left behind by another tab's update is told so, and reloads only when the rider asks

- **Status**: Accepted
- **Date**: 2026-09-22
- **Deciders**: the author, on the engineering question
  [#483](https://github.com/openzigs/onyourleft/issues/483) states. The owner's ruling recorded in
  [ADR 0024](0024-offline-and-caching-posture.md) D-3 — *an update is one a rider asks for, and never
  arrives mid-ride* — is **applied** here rather than revisited, and the decision below is the
  smallest thing that makes D-3's own posture true of a second tab as well as the first
- **Issue**: [#483](https://github.com/openzigs/onyourleft/issues/483), from the review of
  [#481](https://github.com/openzigs/onyourleft/pull/481) (finding 5), carried by
  [#482](https://github.com/openzigs/onyourleft/pull/482) and deferred there with #483 as the record
- **Number**: **0027**. `docs/architecture.md`'s ownership table is the check `CLAUDE.md` §7 asks
  for, and it recorded 0027 as the next free number with **0021 a live reservation**
  ([#330](https://github.com/openzigs/onyourleft/issues/330), the ghost-racing supersession of
  ADR 0007 D4, claimed and not yet written). 0021 is left alone for the reason
  [ADR 0022](0022-game-scenery-model-pack.md) left it alone: a written ADR cannot be renumbered
  without breaking citations, so a collision would land on the reservation rather than here
- **Relates to**: [ADR 0024](0024-offline-and-caching-posture.md) (D-3, whose four rules this
  extends and none of which it reverses), [ADR 0013](0013-adr-amendments.md) (which is why this is
  an ADR and not an appended amendment), and
  [#467](https://github.com/openzigs/onyourleft/issues/467) and
  [#473](https://github.com/openzigs/onyourleft/issues/473), whose guards constrain the signal this
  decision may be read off
- **Supersedes**: nothing

---

## Context

### The case

Two tabs, **A** and **B**, both loaded on version 1. Version 2 installs and waits. The rider presses
*Update now* in **B**. Then:

1. `apps/web/src/offline/worker-core.ts`'s `activate` deletes every cache but its own
   (`staleCaches`, ADR 0024 D-3 rule 4). **Version 1's precache is gone.**
2. The Service Workers specification's Activate algorithm makes the new worker the **service worker
   client**'s active worker for *every* client of the registration — **tab A included**, whatever
   `clients.claim()` does. `worker-core.ts`'s claim comment used to say the claim was *"safe on an
   update too: … the page that asked for it reloads on `controllerchange`"*, which is true of B and
   was never true of A.
3. Tab A's watcher sees `controllerchange` with `asked === false` and does nothing, which is
   correct — that is #467's reload-loop guard, and relaxing it would reload every first visit on
   the origin. Since #473 A also *withdraws* its own offer and tells the rider `none`.

**Tab A is now version 1's JavaScript under version 2's cache.** Any lazy chunk A has not already
loaded — a route, the renderer, a model — is a version-1 hashed URL that version 2's precache does
not hold. With the network off the import simply fails. With the network on it goes to the server,
which after a deploy no longer serves version-1 hashes either. ADR 0024 D-2 precaches *"the whole
asset graph"* precisely because this client is four lazy chunks and a dozen `.glb` files deep, so
this is the likely case rather than the exotic one — and it is the same failure mode create-react-app
[#3613](https://github.com/react/create-react-app/issues/3613) describes, which D-3 rule 1 already
refuses to accept from `skipWaiting()` on install.

**ADR 0024 D-3 has no state for it.** A is told there is nothing to do, which is true of the *offer*
and false of the *tab*. That matters most in exactly the case D-3 exists for: A is **mid-ride** (the
update is deferred per tab while *that tab* records), B is on the library, and the rider takes the
update in B.

### Why this is an ADR and not an amendment to ADR 0024

[ADR 0013](0013-adr-amendments.md) D-3 draws the line: an amendment says *"this description of the
world is out of date"*, and *"the moment a correction would change what a reader should **do**, it is
a decision, and a decision gets an ADR"*. This adds a rider-facing state and a rule about when a page
may reload. Appending it to ADR 0024 would be editing D-3's body in all but name.

### The three options #483 put, and what each costs

| Option | What it costs |
|---|---|
| **A rider-facing state in the left-behind tab** | One more state and one more sentence. Does not repair the tab until the rider acts, so a rider who ignores it can still meet a chunk that will not load — but they meet it *having been told*, rather than as a mystery |
| **The worker keeps the previous version's precache until no client of it remains** | A second cache, a rule for when it may go, and a way to know a client has gone. Cache Storage has no such signal: `clients.matchAll()` is a snapshot, a worker is terminated between events, and a tab closed while the worker is asleep leaves the old cache for ever. It would make ADR 0024 D-3 rule 4's *"a cache nobody deletes is a disk leak"* into the ordinary case, on an origin that shares its quota with the rider's rides |
| **Preload every lazy chunk at start-up** | Deletes the benefit of lazy loading for every rider on every visit, to repair a case that needs two tabs and a deploy. ADR 0024's own first-visit measurement (its 2026-09-21 amendment) is 1,363,395 bytes on the wire and a median 7.5 s to offline-ready; this would move the *first paint* cost, which is the number that amendment shows is the one that matters |

## Decision

### D-1 — A tab that another tab's update took over is told so, in a state of its own

`UpdateStatus` gains **`superseded`**: *another tab took an update and this tab was left behind; it
is running an older bundle under the new worker's cache.* The copy says what is wrong with **this
tab** — that parts of it may fail to open until it is reloaded — rather than repeating the offer's
*"a new version is ready"*, which would send the rider looking for a button that is not the one they
need.

### D-2 — The repair is a **rider's reload**, never an automatic one

The state renders one control, *Reload now*, and nothing reloads without it. This is ADR 0024 D-3
rule 2's posture (*"activation is rider-gestured"*) applied to the repair, and it is also the only
option compatible with #467: `controllerchange` fires with `asked === false` on the **first ever**
activation on an origin, where nothing is stale, so a rule that reloaded on an unasked
`controllerchange` would reload every first visit — install, claim, reload, install.

⚠️ **There is deliberately no *Not now*.** Dismissing an offer leaves a rider on a version that
works; dismissing this would leave them on one whose next lazy route may not open, with nothing on
screen left to say why.

### D-3 — Nothing reloads a tab that is recording **or paused**

While `rideInProgress` is true the state is **`superseded-deferred`**: the sentence, and no control.
The refusal lives in the watcher and not only in the component, for the reason ADR 0024 D-3 rule 3's
does — *"a refusal that lives in a view is one `disabled` attribute away from being no refusal at
all"*. `apps/web/src/ride/controller.ts` §`rideInProgress` is the one place that decides what "in
progress" means, and it counts a **paused** ride, so this and the unload guard cannot disagree.

### D-4 — The signal is the **worker's own state**, not `controllerchange`, and not `redundant`

A tab is superseded when a worker it was **offering** — so `isAnUpdate` was true of it, which is what
tells an update from a first install — leaves `installed` for a state other than `redundant`.

- `redundant` means a **newer** worker replaced it while it was still waiting. Nothing activated,
  this tab's cache is untouched, and the newer one is offered when it installs. Not superseded.
- `activating` / `activated` mean it **took control**. Superseded.

⚠️ `controllerchange` cannot be the signal, for #467's reason above. The worker's state can, and it
needs no extra listener: #473 already made the watcher follow a waiting worker's `statechange` in
order to withdraw the offer.

`superseded` is **sticky for the life of the tab** and outranks a further waiting release. Nothing
that happens in this tab makes an old bundle current again, a release installing behind it does not
make the staleness less true, and both are repaired by the same reload; so `activate()` is refused in
this state, and the rider is given one story about why their page has to reload rather than two.

⚠️ **And `asked` outranks `superseded` in turn** — `update.ts` §`status` returns `activating` before
it reads `superseded` at all. That is necessary: a tab that has pressed *Update now* is waiting for
its own `controllerchange` — `settle` sets `superseded` on that tab too — and offering it a *Reload
now* in the same moment is two controls for one reload. It is a **tested** ordering rather than an
incidental one: `update.test.ts` §*"tells the tab that did not ask that it was left behind"* ends by
requiring the tab that **did** ask to still read `activating`, and swapping the two checks turns that
case red. The cost is stated here rather than left in the code: **a tab whose `controllerchange` never
arrives after it asked can never reach `superseded`.** It sits on *"Updating. This page will reload in
a moment."* for the life of the tab, holding `superseded` internally with no control on screen — in
exactly the state where a manual reload is the repair. It is reachable if the worker's
`skipWaiting()` rejects or the event is missed. It is **not a regression** — that tab was equally
stuck before this ADR — and the ordering is deliberately **not** changed to repair it, because the
repair would put two controls on screen during every ordinary update, which is the thing the
paragraph above refuses.

## Consequences

- A rider with two tabs is told the truth in both. The one that asked reloads; the one that did not
  is told it was left behind and reloads when it is ready to.
- **A rider who ignores the notice is no worse off than before this ADR**, and better informed: the
  chunk that fails to load was already going to fail, and now there is a sentence on screen that
  explains it.
- One new control and two new sentences inside the accessibility gate, audited in both states.
- ⚠️ **What this does NOT repair.** It tells the rider; it does not make the old bundle work. A lazy
  import in a superseded tab still fails until the reload. Making it work is the second option above,
  and this ADR declines it.
- ⚠️ **One case is undetectable and is not detected.** If a tab's watcher is constructed *after* the
  new worker has already activated, the registration reports nothing waiting and nothing installing,
  and there is no signal left to read: `registration.active` is the new worker and this tab is
  controlled by it, which is indistinguishable from an ordinary fresh load. The watcher is built in
  `main.tsx`'s second render, tens of milliseconds after load, so the window is small — but it is
  real and it is stated here rather than implied by a green test. Closing it would need the running
  bundle to carry its own version and compare it with the worker's, which is a build-time coupling
  nothing else in this client has.
- ⚠️ **Nothing here is measured on a phone.** The browser-gate case runs in the lockfile-pinned
  headless Chromium; the Android shell registers no worker at all (ADR 0024 D-4), so this whole
  decision is about the web client.

## What would make this ADR wrong

- **A rider reports the notice and does not know what to do with it.** The copy is the whole of the
  decision's value, and it has not been read by anyone but its author.
- **The stale-chunk failure turns out to be rare in practice** — for instance if a deploy's hashed
  filenames largely repeat, so a version-1 chunk URL is still served. Then telling a rider their tab
  is broken would be alarming them about something they would never have met, and `none` was closer
  to right than this is. What would settle it is a deploy and a log, neither of which exists: there
  is no server in Phase 1 (owner decision D6).
- **A second cache becomes cheap.** If the worker ever gains a reliable way to know its last client
  has gone, option two repairs the tab instead of narrating at it, and this decision becomes the
  fallback rather than the answer.
- **`superseded` outranking a waiting release proves confusing**: a rider who reloads and is
  immediately offered an update might reasonably have wanted one press rather than two. D-4 chose the
  single honest story; a measurement of real riders could reverse it.
