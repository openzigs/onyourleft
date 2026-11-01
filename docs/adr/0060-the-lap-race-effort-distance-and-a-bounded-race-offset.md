# ADR 0060: The lap race — its own expression, no game event reaches the trainer, effort distance and a bounded race offset, bots, and its own draw-call ceiling

- **Status**: **Accepted, 2026-10-30**, on the owner's
  [ruling of that day](https://github.com/openzigs/onyourleft/pull/1930#issuecomment-6533945989) on
  pull request #1930, with every D-14 recommendation as written; D-14 quotes the ruling and records
  each answer. Proposed 2026-10-30
- **Date**: 2026-10-30
- **Deciders**: **the owner**, on the request of 2026-10-30 that the epic
  [#1894](https://github.com/openzigs/onyourleft/issues/1894) was planned from. The author drafted it
  for that approval. Every recommendation here is the author's engineering reading and says so
- **Issue**: [#1895](https://github.com/openzigs/onyourleft/issues/1895), of the epic
  [#1894](https://github.com/openzigs/onyourleft/issues/1894) (a lap race with items and bots, where
  no game event reaches the trainer)
- **Number**: **0060**. On 2026-10-30 `main` (`f5fef915`) holds no `docs/adr/` file numbered 0060,
  and no open pull request names 0060. **0057 is claimed by
  [#1748](https://github.com/openzigs/onyourleft/issues/1748) and 0058 by
  [#1752](https://github.com/openzigs/onyourleft/issues/1752)**, both by their titles and both
  unwritten, so this ADR leaves them alone, as ADR 0059 did
- **Supersedes**: nothing. No existing ADR is amended by this one. **ADR 0059 D-2.4 is unchanged**:
  Delivery keeps its refusal of a virtual slow-down. D-3 here is a decision for a new mode
- **Relates to**: [ADR 0007](0007-patent-posture.md) D4 (the bot pacer ✅),
  [ADR 0009](0009-clean-room-posture.md) (the clean-room posture toward Zwift),
  [ADR 0028](0028-racing-fairness.md) D-1, D-2 and D-7 (one physics, the room re-simulates, the
  patent constraints), [ADR 0036](0036-a-self-hostable-instance-server-now.md) D-3 and D-7 (the device
  is canonical; no paid prerequisite), [ADR 0038](0038-drafting-in-the-first-multiplayer-release.md)
  D-3.4 and its Context (single file; no bot pacer in rooms),
  [ADR 0051](0051-live-race-standings.md) (live standings),
  [ADR 0059](0059-delivery-a-parcel-round-game-mode.md) D-1, D-2, D-3, D-5 and its amendment (the
  Delivery precedent this ADR follows), spike 0030 (`docs/spikes/0030-lap-race-expression-line-and-patent-read.md`,
  [#1896](https://github.com/openzigs/onyourleft/issues/1896), pull request
  [#1928](https://github.com/openzigs/onyourleft/pull/1928)), the IP and patent reading D-9 and D-11
  rest on

---

## Context

### What the lap race is

A new game mode in the trainer game. Riders on smart trainers race several laps of a loop. They pick
up items at points round the lap and use them to gain a little ground or to knock a rival back. A race
is **solo against bots, on the device with no instance**, or **against other riders through the
rider's own instance**. Speed comes from the rider's own watts through the one physics. The epic #1894
records the owner's request of 2026-10-30 as *"a multiplayer cycling game in the kart-racing genre:
multiple laps, power-ups, taking out opponents, and bots"* (the epic's words, not a quotation of the
owner). It files 18 sub-issues over three phases. This ADR and spike 0030 are phase 0, and every
code issue waits on this one.

The genre is the kart racer, and its best-known series is *Mario Kart*. It is named here once, to say
what is avoided, and nowhere else in this ADR.

### Why an ADR, and why before any code

The same three reasons ADR 0059 gave for Delivery, and one that is new:

- **Trainer control is a safety issue** (CLAUDE.md §6). In a kart racer the obvious design is "hit by
  an item, so you slow down". On a trainer the obvious way to slow a rider is to raise the resistance,
  and that is the dangerous one. It must be closed for good, not per review.
- **Expression.** Game rules and mechanics are not protected. A game's name, characters, item
  designs, courses, sounds and get-up are. Spike 0030 §2 reads where that line sits for this genre.
- **Fairness when speed comes from real watts.** A kart racer keeps a race close by making the back
  of the field stronger. A race on trainers is decided by the riders' legs. This ADR says how far
  items may move a result, as a number.
- **New: this mode cannot avoid moving riders.** ADR 0059 D-2.4 refused any virtual slow-down because
  the trainer's grade is read at the rider's simulated distance, so moving the rider changes when
  each grade is written. Delivery could do without moving anybody. A race with items cannot. D-3 is
  how the two are kept apart.

### What exists today (read at `origin/main` `f5fef915`)

- **One physics.** `packages/physics/src/simulate.ts` §`advance` is the only tick. The #92 bot,
  `packages/physics/src/pacer.ts` §`advanceBot`, calls it with power from a target W/kg and a pacing
  rule, and takes no recorded ride.
- **The grade is read at the rider's own distance.** `apps/web/src/game/gradient.ts` samples the
  road's grade at the rider's odometer, wrapped onto the route, and offers it to the trainer through
  `apps/web/src/game/trainer-port.ts`. `packages/domain/src/trainer/simulation.ts` writes a grade **at
  most once a second**, and only when it has moved by more than a **0.1 % deadband**. In a room the
  #782 correction also limits how fast the grade may step. D-2.1 inherits all three.
- **The trainer-command seam** is the list `scripts/check-wiring.mjs` holds as `TRAINER_COMMAND_SEAM`.
  Delivery's guarantee is `apps/web/src/game/delivery/delivery-cannot-reach-trainer.test.ts` (#1807),
  which reads that list and also finds every trainer-control writer by rule (ADR 0059's amendment).
- **Draw calls.** `apps/web/src/game/realistic-budget.ts` holds `REALISTIC_VILLAGE_DRAW_CALLS = 50`
  (frozen, the owner's ruling on #1689) and Delivery's own `DELIVERY_VILLAGE_DRAW_CALLS = 53` (#1815).
- **Lanes.** `apps/web/src/game/delivery/steer.ts` draws three lanes through `scene.ts` §`lateralOf`
  and says that a lateral position a room holds would be a new `physicsVersion` under ADR 0038 D-3.4,
  so a room ride ignores steering.
- **Rooms.** A room re-simulates each rider from reported power (ADR 0028 D-2); drafting is a room
  setting, on by default (`apps/instance/src/room/core/settings.ts`, #787).
- **The touch lock** (`apps/web/src/design/touch-lock.ts`, #1432) stops a tap and lets a key or a
  screen-reader click through; a control marked `TOUCH_LOCK_EXEMPT` is never stopped.

---

## Decision

### D-1 — Expression: the mode is this project's own

As ADR 0059 D-1, applied to this genre.

1. **The mode's own name**, chosen by the owner (D-14 Q7). "Lap race" is a working name only.
2. **Its own items, art, sounds, words and circuits**, made for it. None is traced, sampled,
   transcribed or recreated from any game.
3. **No name, character, item design, course design, sound or get-up of any kart series.** In
   particular, no item is a shell, a banana, a star, a mushroom, a lightning bolt, or anything
   recognisably one of them, in look, name, sound or described behaviour. That an item moves a rival
   back is a rule; looking like one of that series' items is expression. Spike 0030 §2.4 lists what
   the mode must not resemble.
4. **No trainer app's power-up names or icons** (ADR 0009). D-4 and D-5 also refuse the mechanics
   one trainer app's power-ups use (changes to drag and mass).
5. **The mode names no other game anywhere a rider sees**: the product, its rider-facing words, its
   store listing and its release notes.

Each sub-issue that adds rider-facing words, art or sound proposes them in its pull request, and the
owner approves them there. This ADR proposes no rider-facing sentence.

### D-2 — The trainer: no game event reaches it

As ADR 0059 D-2, for this mode.

1. **No item pick-up, item use, hit, knock-back, lap, overtake, finish or bot action changes what the
   trainer is sent, or when.** The trainer gets the road's grade at the rider's **effort distance**
   (D-3), exactly as `gradient.ts` sends it today, in every trainer state. In ERG or a workout the mode
   adds nothing to what that state sends.
2. **The mode's code may not import, directly or through static imports read by name** (ADR 0059's
   amendment of 2026-10-28, part 2), any of:
   - **every module in `scripts/check-wiring.mjs` §`TRAINER_COMMAND_SEAM`**, read from that file, so
     a module added to the seam is forbidden the day it is added;
   - **every trainer-control writer the #1807 rule finds** (ADR 0059's amendment, part 1), found by
     rule rather than listed;
   - `apps/web/src/game/trainer-port.ts`, `apps/web/src/game/gradient.ts` and
     `apps/web/src/ride/trainer.ts`.

   The walk fails closed on what it cannot follow, as #1807's does (ADR 0059's amendment, part 3).
   "The mode's code" means every non-test module under the mode's own directories in `apps/web` and
   `packages/domain`. #1898 holds this as a red test, **sharing #1807's walk, not copying it**.
3. **A lane, item or gamepad control has no path to `setSimulationParameters`, `setTargetPower` or
   `letGo`.** It is an input to the race only.
4. **The recorded ride is unchanged by the mode.** Its power, cadence, heart rate, distance and moving
   time are what the same ride without the mode records. The recorded distance is the effort distance
   (D-3), never the drawn one.

A static-import test cannot see a value passed in at runtime. That half is #1906's behavioural test:
the same power trace, with and without a race full of items, sends a byte-identical sequence of
grades at identical times through the real `GameView`. #1911 repeats it in a room.

### D-3 — Two distances: effort distance and a bounded race offset

**Proposed: option A.** Options B and C are recorded so the owner can choose either instead.

**(A) Effort distance plus a bounded race offset** (recommended).

1. **`effortDistance`** is the distance the rider's own power has earned through the one physics
   (`packages/physics` §`advance`), and in a room the distance the room's re-simulation gives (ADR
   0028 D-2). It is **the only distance the grade is read at**, the only one the trainer's timing
   depends on, and the only one recorded.
2. **`raceOffset`** is a separate number of metres, changed **only** by item effects, and **clamped
   to `[−B, +B]`** after every change.
3. **B = 10 m** (proposed). A rider is **drawn and ranked** at `effortDistance + raceOffset`, and laps
   and the finish are counted at that drawn distance.
4. **The offset never decays into or out of `effortDistance`.** Nothing adds the offset to the effort
   distance, nothing derives the offset from it, and an offset that returns toward zero does so by its
   own rule, never by moving the effort distance.
5. **What B means for the rider.** The road the rider is drawn on and the road the grade is **read**
   at are never more than B apart. What the trainer **holds** lags the read point further, because of
   the once-a-second write, the deadband and, in a room, the #782 grade-step limiter, so the drawn
   road and the felt road can differ by about 2B at 36 km/h. A rider knocked back 10 m sees a crest
   up to about 20 m before they feel it.

**Why 10 m.** The grade is written at most once a second, so the trainer already holds each grade for
up to a second of road. At a race pace of about 36 km/h that is about 10 m. **B = 10 m keeps the
drawn hill and the grade's read point within about one write interval of each other at race pace.**
This is **speed-dependent**: on a climb at 12 km/h, 10 m is about 3 s of road, so the same B is a
larger disagreement in time exactly where the grade matters most. It is also
about one second of riding, which is a felt but small swing in a race: an item can win or lose a
close sprint, and 2B = 20 m (about two seconds) is the most items can ever move a result (D-4). The
owner may choose another number. The trade-off is that a bigger B gives items more weight and lets
the drawn and felt hills drift further apart.

**(B) Flat circuits only.** With every circuit flat, the grade is a constant and it does not matter
where a rider is drawn. **This costs every rider's own hilly loop**, and most riders' loops are not
flat.

**(C) The mode only in free ride, with no simulation writes.** Without grade writes, nothing items
do can reach the trainer. **This costs the feel of the road**: no hills in the legs during a race.

**This is a new decision for a new mode.** ADR 0059 D-2.4 stays exactly as written for Delivery.

### D-4 — Effort dominates

1. **The fairness rule, in a form #1897 can test**, naming the two racers X and Y so that neither
   letter is the bound B or an option: *if, at the instant the first of the two reaches the race
   length at their drawn distance, X's `effortDistance` exceeds Y's by more than 2B, then X finishes
   ahead of Y, under any item sequence.* (The proof, with `eX` and `eY` the two effort distances:
   Y's drawn distance is at most `eY + B`, which is less than `eX − B`, which is at most X's drawn
   distance.) In the
   epic's words: **a rider whose effort distance leads by more than 2B finishes ahead under any item
   sequence.** Under option
   A with B = 10 m, a rider who leads on the pedals by more than 20 m at the line wins, whatever
   items did.
2. **Items may make a close race closer. They cannot reverse a race won on the pedals by more than
   2B.**
3. **Catch-up comes only from item strength weighted by race position** (#1899). It never comes from
   changing the effort a rider needs: **no item and no rule changes any rider's grade, mass,
   `C_D·A`, rolling resistance, drafting multiplier or power, ever.** ADR 0028 D-1's one physics is
   untouched.

### D-5 — Items act on the virtual rider only

1. An item changes only **`raceOffset`**, **the drawn lane** and **the item a rider holds**.
2. **An item never changes** another rider's reported power, mass, physics coefficients, drafting
   multiplier `k`, or anything the room re-simulates under ADR 0028 D-2.
3. **Drafting, where a room has it on, reads `effortDistance` only.** The room computes `k` from
   effort distances, never from drawn ones, so a knock-back costs a rider their place on the screen,
   never their shelter (ADR 0038 D-4 is unchanged).
4. **Clients send inputs, never outcomes.** A rider's client sends "use the held item" and "change
   lane". The room resolves hits and offsets from the shared rules (#1899, #1909) and the client
   predicts and is corrected, as ADR 0028 D-2 has it for position. **The room's correction steers
   toward `effortDistance` only.** The #782 correction moves the simulation's ride distance, which is
   what the grade is read at, so a room that reported drawn distance (`effortDistance` plus
   `raceOffset`) as position would let an item hit move the grade's read point and break D-2.1 and
   D-3.4. `raceOffset` never reaches the correction path, and #1909 holds this as a test.
5. **One item is held at a time, and matching items are never combined into a stronger effect.**
   Spike 0030 §3.3 and §6 read this as keeping US 11,103,784's claims out of reach by construction.
   A second item slot would need that reading re-run first.

### D-6 — Lanes in a room

1. **Proposed: a lane the room holds for item hits only is outside ADR 0038 D-3.4.** D-3.4 is about
   a lateral position as an **input to the draft model and the physics**. A lane that **neither
   `packages/physics` nor the draft model ever reads**, and that only decides whether an item hit a
   rider, is race state like the held item. It is not a `physicsVersion` change.
2. **Either way, the draft model keeps no lateral argument** and D-3.4's single-file drafting is
   unchanged. #1909's room holds the lane beside the item state, and a test asserts that neither
   `advance` nor the draft function is passed it.
3. **Lanes are discrete**, a small fixed number of positions a rider changes between, never a
   continuous lateral position. Spike 0030 §6 reads US 11,071,911 as outside by construction *given
   discrete lanes*, and §10 lists drag-scaled or touch-start steering as something that would make
   that reading wrong. #1901 is bound by this, and a continuous or drag-scaled steer needs the spike's
   reading re-run first.
4. **The alternative** is to treat any room-held lateral position as D-3.4 says, which would need an
   ADR superseding ADR 0038 D-3.4 before #1909.

**Owner question (D-14 Q2): is a lane the room holds for item hits only, never read by the physics
or the draft model, outside ADR 0038 D-3.4 (proposed), or does it need a superseding ADR?**

### D-7 — Bots are synthetic, and a solo race needs no instance

1. **A bot's power comes from a target W/kg and a pacing rule** through `packages/physics`
   §`advanceBot`, the #92 bot. **A bot never comes from a recorded ride of any rider**, this rider's
   or another's. That is ADR 0007 D4's ✅ for a bot pacer and its ❌ for a ghost of another rider.
2. **A bot is a racer like any other**: its `effortDistance` comes from its own paced power, and its
   `raceOffset` from items, under the same rules and the same B.
3. **A solo race against bots runs entirely on the device with no instance and no network**
   (CLAUDE.md §1, ADR 0036 D-3 (a)). `apps/web/src/privacy/no-network.test.ts` is not widened.

### D-8 — Bots in rooms: not filed, and put to the owner

On 2026-09-28 the owner accepted the planner's recommendations, among them *"no bot pacer in
rooms"* (quoted in ADR 0038's Context). **This epic files no bots-in-rooms work.** A room race is
riders only.

**Owner question (D-14 Q3): should a later ADR revisit "no bot pacer in rooms" for the lap race (for
example, bots to fill a small room), or does the 2026-09-28 acceptance stand?** Nothing is filed until
the owner answers.

### D-9 — No rubber-banding of bots by rank

1. **Proposed: bots do not vary their power with their race position.** A bot holds its tier's
   pacing whatever its place, and its catch-up comes from the same position-weighted items a rider
   gets (D-4.3).
2. **Why**: it keeps D-4's fairness rule meaningful against bots (a bot cannot pedal harder because it
   is behind), and it keeps a bot's power a function of its tier and the road only.
3. **The patent reading.** Spike 0030 §3.2 and §6 read US 7,278,913, which claims computer racers
   given **target ranks** with performance changed according to them. A bot with a W/kg tier and **no
   target rank** is outside that claim by construction. The patent is **reported expired on
   2025-04-21** (Google Patents, matching the front page's 183-day adjustment); the office record was
   not read (spike 0030 §7 item 1).

**Owner question (D-14 Q4): no rubber-banding (proposed), or should bots vary their power with their
race position?** If yes, spike 0030 §8 Question 2 (reading '913 in Patent Center) comes first.

### D-10 — The world and the GPU

As ADR 0059 D-3, for this mode.

1. **Which world first is the owner's choice** (D-14 Q5). **Proposed: the stylised world, on a
   rider's own loop route**, because it is the cheaper GPU case and a race draws several riders at
   once. The owner chose realistic towns for Delivery over the same recommendation.
2. **The mode gets its own draw-call ceiling**, a separate constant that applies **only while the mode
   runs**. For the realistic world it lives in `apps/web/src/game/realistic-budget.ts`; for the
   stylised world it sits beside that world's own budget (#1903).
3. **`REALISTIC_VILLAGE_DRAW_CALLS` stays frozen at 50**, and **Delivery's
   `DELIVERY_VILLAGE_DRAW_CALLS` is not reused or changed.**
4. **Items, item effects and pick-up markers are drawn instanced** (#1902), so the raise stays small.
5. **The number is not decided here.** #1903 proposes it from the desktop browser gate and the tablet,
   and the owner approves it in that pull request. While #1523 is open the tablet cost is stated
   there.

### D-11 — Courses

1. **A race's circuit is a loop route the rider imported or saved** (ADR 0028 D-7.1). **Nothing is
   served from an instance as course content.**
2. **A circuit shipped inside the app bundle, for a solo bot race, is put to the owner.** Spike 0030
   §5.1 reads it against US 9,174,085 claim 1, whose *cycling class* limitation spike 0005 §4 says
   carries the whole distance for a live race:
   - **In a solo bot race**, a bundled circuit stays outside that claim on **two** independent
     grounds: no class delivered as video and audio, and **no second rider** at all.
   - **In a room**, a bundled circuit keeps only the first ground, and weakens it, because a menu of
     shipped circuits is a menu of things offered for selection.
3. **Proposed, if the owner allows bundled circuits: solo bot races only, never a room's course.**
   **Authority.** ADR 0028 D-7.1 is a fairness and patent constraint between people, and a solo bot
   race has no second rider, so the proposed reading is that D-7.1 does not reach it and this ADR
   supersedes nothing. If the owner reads D-7.1 strictly, a yes to Q6 is a **partial supersession of
   D-7.1 for solo bot races**, as D-6 would be for ADR 0038 D-3.4, and the owner's answer says so.

**Owner question (D-14 Q6): may a loop circuit shipped in the app be offered for a solo bot race
(proposed: yes, solo only, never in a room), or does every race use the rider's own loop?**

### D-12 — Individuals, and standings as ADR 0051 has them

1. **No team-versus-team win condition** (ADR 0028 D-7.6). Spike 0030 §4.3 records why that stays
   live: Zwift's US 11,173,342 and US 11,602,671 claim team objectives.
2. **Live standings follow ADR 0051**: W/kg beside other riders' names, never watts; the standings
   are not a live region (ADR 0051 D-7). A race's result is a finish order. **No history of item
   events or positions against bots is stored**, which also keeps spike 0030 §4.2's '903 reading
   true.

### D-13 — The touch lock stays whole

As ADR 0059 D-5.

1. **No item-use or lane control carries `TOUCH_LOCK_EXEMPT`.**
2. **With the lock on, items and lanes come by key, remote or gamepad.** Touch item use works only
   with the lock off.
3. **Item use is a separate control from steering.** A single drag that both steers and aims an item
   is not built; spike 0030 §4.4 and §10 say why it would need a fresh reading first.

### D-14 — What the owner is asked to rule on

The epic's eight open questions, each with this ADR's proposal. Accepting the ADR as written accepts
each proposal.

| # | Question | Proposed | Owner's answer, 2026-10-30 | Where |
|---|---|---|---|---|
| **Q1** | Option A (bounded offset), B (flat circuits) or C (no simulation writes); and B's value | **A, with B = 10 m** | **A, B = 10 m**, as proposed | D-3 |
| **Q2** | Lanes in a room: outside ADR 0038 D-3.4, or a superseding ADR? | **Outside**, the lane being read by item hits only | **Outside**: no new ADR for an item-only lane | D-6 |
| **Q3** | Bots in rooms: revisit the 2026-09-28 acceptance or not? | **Not now**; nothing filed | **Not now**: no bots in rooms | D-8 |
| **Q4** | Bot rubber-banding by rank? | **No** | **No** | D-9 |
| **Q5** | Stylised world or realistic towns first? | **Stylised**, on the rider's own loop | **Stylised first** | D-10 |
| **Q6** | A circuit shipped in the app for solo races? | **Yes, for solo bot races only**, never a room's course | **Yes, for solo bot races only** | D-11 |
| **Q7** | The mode's name, and the item catalogue's names and behaviour | **The owner's**; names in #1899's and #1904's pull requests | **Chosen later**, in #1899 and #1904 | D-1 |
| **Q8** | Drafting in a lap-race room: on, off, or the creator's choice? | **The creator's choice, as today** (#787), with `k` read from effort distance only | **The creator's choice**, read from effort distance | D-5.3 |

**The owner's ruling, 2026-10-30**, on pull request
[#1930](https://github.com/openzigs/onyourleft/pull/1930#issuecomment-6533945989), quoted:

> ADR 0060 is accepted with every D-14 recommendation as written: Q1 A (effort distance for the
> trainer, items move only a bounded race offset, B = 10 m); Q2 no new ADR for an item-only lane; Q3
> no bots in rooms for now; Q4 no rubber-banding of bots; Q5 stylised world first; Q6 a bundled
> circuit for solo bot races only; Q7 names chosen later in #1899/#1904; Q8 drafting is the room
> creator's choice, read from effort distance. Mark it Accepted and merge.

So every decision above marked *proposed* is decided as proposed, and the owner questions that end
D-6, D-8, D-9 and D-11 are answered by Q2, Q3, Q4 and Q6.

---

## Consequences

### What this enables

- **Every phase 1 and phase 2 issue has a document to be checked against** (#1897 to #1912), and
  each cites the D-item it rests on.
- **#1897 has a fairness rule to test** (D-4.1), **#1898 a forbidden set to walk** (D-2.2), **#1906
  and #1911 a behaviour to hold** (D-2.1), and **#1903 a ceiling to measure** (D-10).

### What this costs

- **The drawn road and the felt road can differ by up to B** (10 m as proposed). A knocked-back rider
  sees a crest slightly before feeling it. Option A buys items that move riders at that price.
- **Items cannot win a race lost on the pedals by more than 2B.** Riders who expect a kart racer's
  last-second reversal from the back will not get one. That is the point.
- **No item can be felt in the legs.** Every effect is on the screen only.
- **Bots do not catch up by pedalling harder.** A rider well ahead of a bot tier stays ahead; the
  rider picks a stronger tier instead.
- **Touch item use is unavailable with the lock on**, as for Delivery.
- **More dropped frames on the tablet while the mode runs**, if the owner approves a raised ceiling
  in #1903 while #1523 is open.

### Reversing any of these

Each of D-1 to D-13 is reversed only by a **superseding ADR**. An `## Amendments` entry
([ADR 0013](0013-adr-amendments.md)) may record that a fact stated here has become false (a path
renamed, an issue renumbered) and may not change a decision. In particular:

- any game event reaching the trainer (D-2), or the offset touching `effortDistance` (D-3.4), needs a
  superseding ADR;
- raising B needs a superseding ADR, because D-4's rule and #1897's test are written against it;
- an item that changes physics, drafting or power (D-4.3, D-5.2) needs a superseding ADR;
- a second item slot (D-5.5) needs spike 0030's '784 reading re-run, then a superseding ADR;
- exempting an item control from the touch lock (D-13) needs a superseding ADR.

### Not decided here

- **Whether the mode is offered during a workout or in ERG.** D-2 holds either way; the chooser
  (#1907) and the owner decide.
- **Public lap-race rooms** and **cross-instance races** (#56): follow-ups the epic does not file.
- **Brand controllers**: as ADR 0059's "Not decided here" (DL8).

## What would make this ADR wrong

- **The trainer changes its resistance with the game's virtual speed** in FTMS simulation mode. D-2
  and D-3 rest on the trainer being sent the grade only and working resistance out from the grade and
  its own flywheel. That is read from the code, not measured (the epic's Could Not Confirm item 4);
  #1906's device step is where it is felt.
- **A rider can feel a 10 m disagreement** between the drawn and the felt road as a fault rather
  than as part of a race. Then B is too large, and Q1 is asked again.
- **The room's 1 Hz frame makes item hits feel wrong** (the epic's Could Not Confirm item 5). That
  changes how hits are shown (#1911), not the rules here.
- **Spike 0030 is overtaken**: the office record for US 7,278,913 shows it alive, or a claim on
  rank-weighted items or on items in exercise races turns up. D-9 and #1899 would then need a new
  reading before the mode ships.

---

## Amendments

Appended under [ADR 0013](0013-adr-amendments.md). Nothing above this line has been edited.

- **2026-10-31** — **Proposed, for the owner's ruling on the pull request that appends this entry**
  ([#1960](https://github.com/openzigs/onyourleft/issues/1960), the owner's request of 2026-10-31
  for smarter bots): **a bot's power may follow a course-only race plan.** D-9.1 is unchanged: a bot
  never varies its power with its race position, and D-14 Q4's answer stands. What this entry
  changes is D-9.2's last clause, *"a function of its tier and the road only"*, which on its words
  forbids any plan. **The rule from this entry: a bot's power is a function of its tier, the road,
  the distance it has left and its own energy budget, and never of any other racer.** That widens a
  rule, and ADR 0013 D-3's last row sends a decision whose reasoning has been overtaken to a
  superseding ADR. This entry is therefore a proposal on that point: **the owner's ruling must say
  in its own words that it accepts an amendment despite D-3, or the entry is withdrawn and the same
  rule is written as ADR 0061.** The author recommends ADR 0061 if the owner does not say so. ADR
  0059's entry of 2026-10-28 recorded a ruling the owner had already given; this one records none
  yet.
  (1) **What the plan may read**: the bot's tier; the course, meaning the grade along the loop, the
  lap count and the race length; the bot's own `effortDistance`, so that the distance left is the
  race length less it (the finish is counted at the drawn distance, D-3.3, so the closing sprint
  can start up to B, 10 m, early or late relative to the visible line, and the code that follows
  must not assert that the bot sprints at the line); and the budget the bot itself has spent, in the critical-power and W′ style of
  `packages/domain/src/analysis/critical-power.ts`: a reserve of work above the tier's power that a
  climb or the closing distance draws down and an easier stretch refills. The plan is fixed from the
  course before the start, and each step is pure and seeded by the race's own seed.
  (2) **What it may never read**: any other racer's place, power, `effortDistance`, drawn distance,
  gap to the bot or finish; the bot's own place or rank; and **the bot's own `raceOffset` and drawn
  distance** (`effortDistance + raceOffset`). The last is the one that is easy to miss. `raceOffset`
  is moved by other racers' items (D-5.1), and laps are counted at the drawn distance (D-3.3), so a
  plan that measured the distance left from the drawn distance, or counted laps from the race's lap
  counter, would make a bot's power depend on what another racer did. This also depends on solo races having no
  drafting: `advanceBot` passes no draft multiplier and D-8 keeps bots out of rooms, where drafting
  lives (D-5.3, Q8). If D-8 is revisited, the bot's `effortDistance` would carry another racer's
  shelter, and a new entry must first say how the plan stays independent of it. A bot's item and lane choices
  (`packages/domain/src/lap-race/bots.ts` §`botDecision`, #1900) read the race as they do today and
  are not its power; the sibling tactics issue #1959 keeps to that.
  (3) **What does not move**: D-7.1, so power still comes from the tier's W/kg through a pacing rule
  into `packages/physics` §`advanceBot` and §`advance`, with no new physics, and a bot is never built
  from a recorded ride (#1955's scans); D-2, so no game event reaches the trainer (#1952's walk);
  D-4.3 and D-5.2, so no rule changes a rider's grade, mass, `C_D·A`, rolling resistance or drafting
  multiplier, and no rule of catch-up changes a rider's power. D-4.3 is read as that rule of
  catch-up; it does not forbid a bot's own pacing, which #92's grade pacing already varies, and a
  bot is a racer like any other (D-7.2) in that its power comes from its own rule, bounded by (4); and D-8, so there are still no bots in
  rooms.
  (4) **The bounds, held as tests by the code that follows this entry**: a bot's mean power over a
  race stays within a stated tolerance of its tier's W/kg × `BOT_MASS_KILOGRAMS` (75 kg), the
  tolerance a named constant that the code's pull request proposes and the owner approves there; its
  peak stays inside two limits: the intensity bounds `MINIMUM_INTENSITY_WATTS_PER_KILOGRAM` (0.5)
  to `MAXIMUM_INTENSITY_WATTS_PER_KILOGRAM` (7), and a surge ceiling over the tier's power, a named
  constant that the code's pull request proposes and the owner approves there. #92's own band,
  +10% and -20% (`PACING_FACTOR_CEILING` and `PACING_FACTOR_FLOOR`), is not carried over: a W′ plan
  must be able to exceed +10% on a climb and in the closing sprint, which that band forbids; with items off, `fierce`, `hard`, `brisk` and `steady`
  finish in that order over 100 seeds; and #1900's test that the same bot on the same course reads
  back an identical power trace whether it leads or trails is kept, with a mutation that reads rank
  proven to turn it red.
  (5) **The patent reading**: spike 0030 §3.2 reads US 7,278,913 claim 1 as needing a target rank
  set for each computer racer and a performance value changed according to it. The plan sets no rank
  and reads none, so D-9.3's reading holds by construction. Spike 0030 was not re-run for this entry,
  and no search was made for claims on energy-budget pacing of computer opponents. (#1960)
