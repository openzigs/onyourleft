# ADR 0059: Delivery, a parcel-round game mode — its own expression, no game event reaches the trainer, its own draw-call ceiling, no stored targets, and the touch lock kept whole

- **Status**: **Accepted, 2026-10-28**, on the owner's ruling of that day on
  [#1804](https://github.com/openzigs/onyourleft/issues/1804), with D-6 answered as written: a crash
  costs points only. It records the owner's rulings DL1, DL4, DL5, DL6, DL6b and DL11 of 2026-10-27 on
  the epic [#1803](https://github.com/openzigs/onyourleft/issues/1803). Proposed 2026-10-28
- **Date**: 2026-10-28
- **Deciders**: **the owner**, on the rulings of 2026-10-27 quoted in Context. Drafted by the author
  for that approval. D-2's choice of the crash penalty (points only) is the author's reading of
  DL5, put to the owner in D-6
- **Issue**: [#1804](https://github.com/openzigs/onyourleft/issues/1804), of the epic
  [#1803](https://github.com/openzigs/onyourleft/issues/1803) (Delivery: a parcel-round game mode in
  the trainer game)
- **Number**: **0059**. On 2026-10-28 `main` holds no `docs/adr/` file numbered 0057 or above, and no
  open pull request names 0059. **0057 is claimed by
  [#1748](https://github.com/openzigs/onyourleft/issues/1748) and 0058 by
  [#1752](https://github.com/openzigs/onyourleft/issues/1752)**, each by its title, and both are
  unwritten, so this ADR leaves them alone. [#1787](https://github.com/openzigs/onyourleft/issues/1787)
  and [#1788](https://github.com/openzigs/onyourleft/issues/1788) mention 0059 only as "the next free
  number today" and claim nothing
- **Supersedes**: nothing. No existing ADR is amended by this one
- **Relates to**: [ADR 0004](0004-privacy-and-location.md) D (the coordinate-message rule),
  [ADR 0009](0009-clean-room-posture.md) R1 and L1 (facts versus expression; trade dress),
  [ADR 0026](0026-realistic-game-world.md) (the realistic world),
  [ADR 0038](0038-drafting-in-the-first-multiplayer-release.md) D-3.4 (no lateral offset in a room),
  [ADR 0054](0054-towns-from-real-map-data.md) D-2.2 and
  [ADR 0055](0055-place-kinds-and-ranks-from-the-corridor-never-a-name.md) D-3 (never a name or an
  address), [#1432](https://github.com/openzigs/onyourleft/issues/1432) (the touch lock),
  [#1523](https://github.com/openzigs/onyourleft/issues/1523) (the tablet GPU at its ceiling),
  [#1689](https://github.com/openzigs/onyourleft/issues/1689) (the village frame frozen at 50 calls)

---

## Context

### What Delivery is

A game mode inside the trainer game: the rider rides a round of houses in a realistic town, throws
parcels to doorsteps and porches, and avoids obstacles. Speed comes from the rider's power through
the game's existing physics. The epic #1803 files it as 24 sub-issues over three phases; this ADR is
the first, and every phase 0 code issue waits on it.

The genre's inspiration is the 1985 arcade game *Paperboy*. It is named here once, to say what is
avoided, and nowhere else in this ADR.

### The rulings this records (owner, 2026-10-27, on #1803), quoted in full

> - **DL1 Theme.** Parcels to doorsteps and porches. Our own name "Delivery", our own art, sounds,
>   words and layouts. No newspapers, no "subscriber" word, and no reward for breaking windows.
> - **DL4 Touch lock.** The #1432 touch lock stays everywhere, with no exempt throw zone. While the
>   lock is on, throws come by key or remote only; touch throwing works only when the rider has the
>   lock off.
> - **DL5 Trainer.** **Never.** No game event (a hit, a miss, an obstacle, a delivery) may change
>   what the trainer is sent. The trainer gets only the road's grade, as today. A crash slows the
>   virtual rider or costs points. This is recorded in the ADR, so reversing it needs a superseding
>   ADR. Add a test-held guarantee that Delivery's code path cannot reach the trainer-command seam
>   (see wiring-gate.md).
> - **DL6 World.** The **realistic towns** come first. This is the owner's choice over the
>   recommendation of the stylised world.
> - **DL6b GPU.** Delivery gets **its own raised draw-call ceiling**, a separate constant that
>   applies only while Delivery runs. `REALISTIC_VILLAGE_DRAW_CALLS` stays **frozen at 50** for
>   ordinary riding.
>   - The new ceiling's number is proposed from desktop and tablet measurement and approved by the
>     owner in the PR.
>   - The issue says it will cost more dropped frames on the tablet (#1523 is still open). The owner
>     accepts that for Delivery only.
>   - Parcels, markers and obstacles should still be instanced so the raise stays small.
> - **DL11 Targets.** In realistic towns, targets are chosen from the **mapped houses the town
>   already draws**, by a seeded pick. **Nothing about which house got a parcel is ever stored with
>   the ride, exported, synced or logged**, so no record points at a real address (CLAUDE.md §6,
>   location data). Add a test-held guarantee that the ride record, export and sync payloads carry
>   no delivery-target data.

DL2, DL3, DL7, DL10 and DL12 are design rulings the sub-issues carry and need no ADR. DL8 and DL9
are recorded under Consequences as not decided here.

### Why an ADR and not a line in each issue

Two of these rulings are safety and privacy questions, not design choices, and an issue body is
re-read and reinterpreted by every lane that picks it up.

- **Trainer control is a safety issue** (CLAUDE.md §6). "Hit an obstacle, so the resistance spikes"
  is the obvious game design, and it is the dangerous one: a grade step that arrives while a rider
  is sprinting out of the saddle can unseat them, and the 40 % clamp
  (`packages/domain/src/trainer/simulation.ts` §`MAX_SIMULATED_GRADE_PERCENT`) bounds how steep a
  hill may be, not how suddenly one may arrive. It must be closed for good, not per review.
- **Location data** (CLAUDE.md §6, ADR 0004). In a realistic town the houses drawn are real mapped
  buildings (ADR 0054). A record that says "the rider delivered to this house" is a record that
  points at a real address.
- **Expression** (DL1). Game rules and mechanics are not protected; a game's name, art, sounds,
  words, level designs and overall get-up are. That is ADR 0009 R1's facts-versus-expression line,
  and L1's trade-dress limb (not reproducing another product's look as a set), applied here by
  analogy to a game rather than to a fitness service.

### What exists today (read at `origin/main` `2c37876b`)

- **The game sends the grade and nothing else.** `apps/web/src/game/gradient.ts` samples the road's
  grade at the rider's simulated distance and offers it to the trainer through
  `apps/web/src/game/trainer-port.ts`, whose `GradientTrainer` is `setSimulationParameters` and
  `letGo` only. `setTargetPower` is absent from it on purpose.
- **The trainer-command seam** is the five modules `scripts/check-wiring.mjs` lists as
  `TRAINER_COMMAND_SEAM`, named in D-2.
- **The village frame is frozen at 50 calls** (`apps/web/src/game/realistic-budget.ts`
  §`REALISTIC_VILLAGE_DRAW_CALLS`, the owner's ruling on #1689), held by
  `apps/web/browser/realistic-town.browser.spec.ts`. #1523 is open.
- **The touch lock** (`apps/web/src/design/touch-lock.ts`, #1432) ignores a tap and lets a key or
  screen-reader click through; a control marked `TOUCH_LOCK_EXEMPT` is never stopped.

---

## Decision

### D-1 — Expression: Delivery is this project's own (DL1, 2026-10-27)

1. The mode is called **"Delivery"**. It delivers **parcels** to **doorsteps and porches**.
2. Its art, sounds, rider-facing words and round layouts are this project's own, made for it. None
   is traced, sampled, transcribed or recreated from the arcade game named in Context, from its
   sequels or ports, or from any other game.
3. It uses **no newspapers** and **no "subscriber" word**, in the product or in its code's
   rider-facing strings.
4. It gives **no reward for breaking windows or damaging property**. A parcel that misses is a miss;
   nothing the rider can hit scores for being broken.
5. It **names no arcade game**, in the product, its rider-facing words, its store listing or its
   release notes.

Each sub-issue that adds rider-facing words, art or sound proposes them in its pull request, and
the owner approves the wording there. This ADR proposes no rider-facing sentence; the name
"Delivery" is the owner's own, from DL1.

### D-2 — The trainer: no game event changes what it is sent (DL5, 2026-10-27)

1. **No game event — a hit, a miss, an obstacle, a delivery, a crash, a round's start or end —
   changes what the trainer is sent, or when.** The trainer gets the road's grade at the rider's
   distance, exactly as `gradient.ts` sends it today, in every trainer state. In ERG or a workout
   Delivery adds nothing to what that state sends.
2. **Delivery's code may not import, directly or through any chain of static imports**, any of:
   - `packages/domain/src/trainer/simulation.ts`
   - `packages/sensors/protocol/src/fitness-machine-control.ts`
   - `packages/sensors/protocol/src/simulation-writer.ts`
   - `packages/sensors/protocol/src/erg-writer.ts`
   - `packages/sensors/protocol/src/trainer-control-choice.ts`
   - `apps/web/src/game/trainer-port.ts`
   - `apps/web/src/game/gradient.ts`

   The first five are `TRAINER_COMMAND_SEAM` in `scripts/check-wiring.mjs`, and the guarantee reads
   them from there rather than copying them, so a sixth seam module joins it without an edit here.
   #1807 holds this as a red test, and also forbids `apps/web/src/ride/trainer.ts`. "Delivery's
   code" means every non-test module under `apps/web/src/game/delivery/`.
3. **A steering or throwing controller has no path to `setSimulationParameters`, `setTargetPower` or
   `letGo`.** A key, a touch, a gamepad or a Bluetooth controller (phases 1 and 2) is an input to
   Delivery only; nothing it produces is a trainer command or an input to one.
4. **The crash penalty in phase 0 is points only.** A crash takes points off the round's score. It
   does **not** slow the virtual rider. DL5 allows either; this ADR builds the one that keeps
   item 1 true, for this reason: the grade the trainer gets is read at the rider's **simulated**
   distance (`gradient.ts`), so a virtual slow-down holds the rider on a stretch of road for longer
   and changes the time at which every later grade is written. That is a game event changing what
   the trainer is sent, and it would make #1816's behavioural test (the same power trace, with and
   without Delivery, sends an identical sequence of grades and times) impossible to pass. D-6 puts
   this reading to the owner.
5. **The recorded ride is unchanged by Delivery.** Its power, cadence, heart rate, distance and
   moving time are what the same ride without Delivery records. #1816 holds this through the store's
   own read path. Because item 4 builds no slow-down, no game state is added to `simulation.ts` for
   Delivery in phase 0.

A static-import test cannot see a module reaching a trainer through a value passed in at runtime or
a platform global. That half is #1816's behavioural test through the real `GameView`; neither test
replaces the other.

### D-3 — The world and the GPU: realistic towns, and Delivery's own ceiling (DL6 and DL6b, 2026-10-27)

1. **Realistic towns first.** Delivery runs in the realistic world (ADR 0026, ADR 0054). A stylised
   Delivery is not built in this epic and would be its own issue.
2. **Delivery gets its own village draw-call ceiling**, a separate constant in
   `apps/web/src/game/realistic-budget.ts` that applies **only while Delivery runs**.
3. **`REALISTIC_VILLAGE_DRAW_CALLS` stays frozen at 50** for ordinary riding, and the browser gate
   keeps holding an ordinary village frame at exactly that. Delivery's constant is never applied to
   an ordinary ride.
4. **The raise costs more dropped frames on the tablet while #1523 is open.** The owner accepts
   that, for Delivery only. That is why the ceiling is a second constant and not a raise of the
   first.
5. **Parcels, target markers and obstacles are drawn instanced** (#1814), so the raise stays small.
6. **The number itself is not decided here.** #1815 proposes it from the Delivery village frame
   measured on the desktop browser gate and on the tablet, and the owner approves it in that pull
   request.

### D-4 — Targets: picked from the drawn houses, and never kept (DL11, 2026-10-27)

1. **Targets are picked from the mapped houses the town already draws**, by a seeded pick (#1808).
   A house is eligible only through what the world already plans for drawing (its footprint and its
   doorstep or porch-step anchor); nothing is fetched or decoded for Delivery.
2. **Which house got a parcel is never stored with the ride, exported, synced or logged.** It is
   held in memory for the ride and dropped when the ride ends. No error message, log line, toast or
   crash report formats a target's position, or the rider's position at a throw (ADR 0004 D).
3. **The seed is drawn fresh for each ride and is never stored.** It comes from the platform's
   cryptographic random source when the round starts and lives in the ride's memory only. It is
   never written to the store, an export, a sync payload or a log, and it is never derived from
   anything that is stored (the route, the date, the ride's id). **The reason is that the pick is
   deterministic: a stored seed beside a stored route recomputes exactly which houses were
   targets**, so keeping the seed would keep the targets by another name.
4. **What persists between rides is counts only**: how many houses the next round has, the day of
   the round's week, a score. Never a house, an index into a town's houses, a position or a seed.
5. **No name or address field is read** to pick, order or describe a target. ADR 0054 D-2.2 and
   ADR 0055 D-3 already keep names and addresses from being decoded; Delivery refers to a target by
   its place in the round (first, second, …) and by nothing else.
6. #1817 holds items 2 to 4 as a red test over the ride record, an export and a sync payload.

### D-5 — The touch lock stays whole (DL4, 2026-10-27)

1. **The #1432 touch lock applies to Delivery as to every other control**, and **no throw zone or
   throw control is exempt**: none carries `TOUCH_LOCK_EXEMPT`.
2. **While the lock is on, throws come by key or remote only.** A Bluetooth remote, ring or keyboard
   arrives as a key event, which the lock already lets through. Touch throwing works only when the
   rider has turned the lock off.
3. The lock's exemptions stay what they are today: controls that stop what the app asks of the
   trainer. A throw asks nothing of the trainer (D-2), so it has no claim to one.

### D-6 — What the owner is asked to rule on

1. **D-2 item 4: points only.** DL5 says "a crash slows the virtual rider or costs points". This
   ADR builds points only, for the reason given there. Accepting the ADR accepts that. If the owner
   wants a virtual slow-down as well, it needs the grade the trainer gets to stay keyed to a distance
   the slow-down does not touch, which is a second distance in the game and a change to D-2; it
   would be a superseding ADR, not an amendment.

---

## Consequences

### What this enables

- **Every phase 0 code issue has a document to be checked against** (#1806 to #1818). Each cites the
  D-item it rests on.
- **#1807 and #1817 have a decision to test**, rather than a ruling quoted in an issue body.

### What this costs

- **A crash cannot be felt in the pedals, and cannot cost the rider ground.** Points are the only
  penalty in phase 0, which is a weaker deterrent than a slow-down.
- **More dropped frames on the tablet during Delivery** while #1523 is open, accepted by the owner
  for Delivery only.
- **No ride history of deliveries.** A rider cannot look back at which houses a past round visited;
  only counts survive the ride.
- **Touch throwing is unavailable with the lock on.** A rider who keeps the lock on needs a key or a
  remote to play.

### Reversing any of these

Each of D-1 to D-5 is reversed only by a **superseding ADR**. An `## Amendments` entry
([ADR 0013](0013-adr-amendments.md)) may record that a fact stated here has become false — a path
renamed, an issue renumbered — and may not change a decision. In particular:

- a game event reaching the trainer, or a virtual slow-down (D-2), needs a superseding ADR;
- raising or merging the ordinary village ceiling (D-3) is the #1689 ruling's, and is not changed by
  Delivery's ceiling;
- storing, exporting or syncing a target or a seed (D-4) needs a superseding ADR, and would also
  need ADR 0004's reasoning answered;
- exempting a throw control from the touch lock (D-5) needs a superseding ADR.

### Not decided here

- **DL8, brand controllers** (Elite Sterzo, Zwift Play, Zwift Click and Zwift Ride): not now. A
  revisit needs its own ADR and counsel.
- **DL9, rooms**: Delivery is solo. A room-held lateral position is a new `physicsVersion` under
  [ADR 0038](0038-drafting-in-the-first-multiplayer-release.md) D-3.4, so multiplayer Delivery needs
  its own ADR first.
- **Whether Delivery is offered during a workout or in ERG**, and **whether the week's counts travel
  in an account export**: the epic's open questions, for #1818 and the owner. D-2 and D-4 hold
  whichever way they are answered.

## What would make this ADR wrong

- **The trainer turns out to change its resistance with the game's virtual speed** in FTMS
  simulation mode. D-2 rests on the trainer being sent the grade only and working resistance out
  from the grade and its own flywheel. That is read from the code, not measured (the epic's Could
  Not Confirm 14); #1816's tablet step is where it is felt.
- **The world starts decoding an address or a name** for the houses it draws. D-4 item 5 assumes
  ADR 0054 D-2.2 and ADR 0055 D-3 keep them out.

---

## Amendments

Appended under [ADR 0013](0013-adr-amendments.md). Nothing above this line has been edited.

- **2026-10-28** — **D-2.2's list is no longer the whole set #1807's test forbids; the test is wider,
  never narrower.** Made under the owner's acceptance of D-2 on 2026-10-28, on the review of #1842.
  D-2.1 and D-2.3 are unchanged; this records what now holds them. Three facts:
  (1) **The forbidden set adds every trainer-control writer**, the half below the seam that carries
  the bytes and imports the protocol's types only, so it was reachable without touching a module
  D-2.2 names. They are found by rule over every non-test module under `apps/` and `packages/`, not
  written down: a GATT write (`writeValue…`, `BleClient.write…`), a `write` that names a control
  point, a method named for a trainer command (`setTargetPower`, `setTargetResistance`,
  `setTargetResistanceLevel`, `setSimulationParameters`, `letGo`, `requestControl`,
  `writeControlPoint`), and a `write` in a module declaring a `…ControlPoint` interface. On this
  date that finds `packages/sensors/web-bluetooth/src/fitness-machine-channel.ts`
  (`createFitnessMachineChannel`), `apps/mobile/src/ble/fitness-machine-channel.ts`,
  `apps/mobile/src/ble/ble-client.ts`, `apps/web/src/validation/capture.ts`,
  `apps/web/src/ride/controller.ts`, `packages/sensors/protocol/src/fitness-machine-control.ts`,
  `packages/sensors/protocol/src/simulator-bridge.ts`, `packages/sensors/src/simulator/ftms.ts`,
  `packages/sensors/src/simulator/vendor-control.ts` and `apps/web/src/game/gradient.ts`, beside
  two browser-gate harnesses. A writer added later is forbidden the day it lands.
  (2) **"Any chain of static imports" is read by name**: a barrel's `export … from` is followed only
  for the names a Delivery module asks of it, so a value from `@onyourleft/domain` does not count as
  reaching `trainer/simulation.ts`, which that barrel also re-exports. A namespace import, a dynamic
  import and `export *` are followed for every name asked.
  (3) **The walk fails closed** on what it cannot follow: any `import.meta.glob`, any `import.meta`
  member but `url`, `env` and `hot`, and a `Worker` or `SharedWorker` built from anything but a
  literal `new URL('…', import.meta.url)`, which is followed into the module it names. The test is
  `apps/web/src/game/delivery/delivery-cannot-reach-trainer.test.ts`. (#1807)
