# ADR 0094: A Delivery crash stops the drawn rider, who gets back on and rides on, on a second distance the trainer never reads

- **Status**: **Proposed**, 2026-11-22. It takes effect only when the owner accepts it on its pull
  request. Until then ADR 0059 D-2.4 and ADR 0065 D-11 stand as written, and a crash costs points
  and changes the drawn rider's attitude, nothing else
- **Date**: 2026-11-22
- **Deciders**: **the owner**, on the request quoted in Context (tablet session, 2026-11-21), filed
  as [#3011](https://github.com/openzigs/onyourleft/issues/3011), with the lane note of 2026-11-22
  (*"write the ADR only — crash stops the rider and shows them getting back on"*). The author drafted
  it for the owner's approval. Each number and each rule the request leaves open is the author's
  choice and says so, and D-11 puts each one to the owner with a recommendation
- **Issue**: [#3011](https://github.com/openzigs/onyourleft/issues/3011), under the Delivery levels
  epic [#2359](https://github.com/openzigs/onyourleft/issues/2359); it follows
  [#2454](https://github.com/openzigs/onyourleft/issues/2454) (the crash drawn) and pull request
  [#2993](https://github.com/openzigs/onyourleft/pull/2993) (the crash's weight)
- **Number**: **0094**. On 2026-11-22 `main` (`76c1b2603`) holds ADRs up to 0091, and
  `docs/agents/conventions.md` §7 gives 0092 as the next free number. **0092 is claimed by the open
  pull request [#2864](https://github.com/openzigs/onyourleft/pull/2864)**, which adds
  `docs/adr/0092-…`, so it is taken. **0093 is left to
  [#3010](https://github.com/openzigs/onyourleft/issues/3010)**, whose ADR lane started beside this
  one on the same day; the two lanes agreed on the issues that the lower issue number takes the lower
  ADR number. 0083 and 0085 stay claimed by the open pull requests #2864 and #2872
- **Supersedes**, in part, for Delivery rounds only:
  - [ADR 0059](0059-delivery-a-parcel-round-game-mode.md) **D-2 item 4**, *"The crash penalty in
    phase 0 is points only … It does **not** slow the virtual rider"*, and the owner's answer to its
    **D-6 item 1** ("points only");
  - [ADR 0065](0065-built-in-delivery-levels-shipped-in-the-app-under-odbl.md) **D-11**'s second
    sentence, *"A crash costs points only (ADR 0059 D-2.4, the owner's answer to Q4): no slow-down
    of the drawn rider"*, and the answer to its **D-15 Q4** ("points only"). ADR 0065 named this
    reversal in *What would make this ADR wrong*: *"A crash slows the drawn rider. That reopens ADR
    0059 D-2 and needs a superseding ADR."* This is that ADR.

  Each gains one dated `## Amendments` entry pointing here, in this pull request (ADR 0013). Their
  bodies are not edited
- **Leaves standing**, word for word: ADR 0059 **D-2 items 1, 2, 3 and 5** and its amendment of
  2026-10-28 (no game event changes what the trainer is sent, or when; the static-import walk; no
  controller reaches a trainer command; the recorded ride unchanged); ADR 0065 **D-11**'s first,
  third and later sentences; ADR 0060 in full, the lap race included (D-9 here); ADR 0066 D-7 (the
  trainer never feels a draft); ADR 0004 D (no coordinate in a message)
- **Relates to**: [ADR 0060](0060-the-lap-race-effort-distance-and-a-bounded-race-offset.md) D-3
  and D-5.3, the precedent for a drawn distance the grade is never read at;
  [ADR 0066](0066-the-bot-pacer-and-the-riders-own-ghost-give-a-draft-in-a-solo-ride.md) D-1
  (a solo draft, which is physics); [ADR 0013](0013-adr-amendments.md); `SECURITY.md` (trainer
  control is a safety issue)

---

## Context

### The owner's request, verbatim

Tablet session, 2026-11-21, the Evening Round on build `4439ea908`, with #2993's crash weight in it:

> *"when the user crashes they should stop and animation should show them getting back on the bike.
> Today it shows crash but doesn't stop and they keep moving."*

The owner said to file it the same day. The lane note on #3011, 2026-11-22: *"write the ADR only —
crash stops the rider and shows them getting back on, superseding ADR 0065 Q4 / ADR 0059 D-2.4 as
needed. No implementation in this PR."*

### Why a crash does not stop the rider today

ADR 0059 D-2.4 chose points only for one reason, and the reason is still true: **the grade the
trainer gets is read at the rider's simulated distance** (`apps/web/src/game/gradient.ts`, sampled
in `GameView.tsx` from `simulation.state.ride.distance`). A crash that really stopped the rider would
hold them on one stretch of road for the length of the stop, and every grade after it would be
written later than on the same ride with no crash. That is a game event changing what the trainer is
sent and when, which D-2.1 forbids.

ADR 0059 D-6.1 said what reversing it would take: *"the grade the trainer gets to stay keyed to a
distance the slow-down does not touch, which is a second distance in the game and a change to D-2;
it would be a superseding ADR, not an amendment."* The lap race already has such a second distance:
ADR 0060 D-3's `effortDistance`, which the grade is read at, and a drawn distance beside it that
items move within a bound B. This ADR gives Delivery the same shape for one cause, a crash.

### What exists today (read at `main` `76c1b2603`)

- `apps/web/src/game/delivery/obstacles.ts` §`Crash` is `{ scoreDelta }` and nothing else, with
  `CRASH_SCORE_DELTA = -1`. Hazards are proved avoidable from
  `AVOIDABLE_SLOWEST_METRES_PER_SECOND` (3 m/s) to `AVOIDABLE_FASTEST_METRES_PER_SECOND` (12 m/s,
  43.2 km/h), and neighbours stand at least `OBSTACLE_SIGHT_METRES` (60 m) apart.
- `apps/web/src/game/delivery/crash-look.ts` draws the crash over `CRASH_SECONDS` = 1.8 s: down over
  `CRASH_FALL_SECONDS` (0.45 s), lying until `CRASH_RISE_AT_SECONDS` (1.2 s), back up over
  `CRASH_RISE_SECONDS` (0.6 s). Its header says the rider is drawn *"where the simulation has them
  throughout"*, and that holding the drawn rider back would need the camera to choose between them.
  The realistic rider plays our own crash clip, made by `apps/web/tools/realistic/blender/process_rider.py`
  step 10 from `rider_crash.py` on those times (#2493, #2993): hands off the bars, lying along the
  bicycle, one foot planted to get back on.
- `apps/web/src/game/delivery/ride-round.ts` §`stepDeliveryRide` takes `along`, *"the simulation's
  own odometer"*, and every part of the round reads it: the throw, the misses, the obstacles and
  `nextHouse`.
- The lap race has **no crash**. Its items knock a rider back on ADR 0060 D-3's bounded offset
  (`apps/web/src/game/lap-race/`), and nothing in it falls over.
- Two tests hold ADR 0059 D-2 today. `apps/web/src/game/delivery/delivery-cannot-reach-trainer.test.ts`
  (#1807) walks every Delivery module's imports. `apps/web/src/game/delivery-wiring.test.tsx` (#1816)
  rides one power trace through the real `GameView` with and without a round, a crash among it, and
  holds the trainer's writes `toStrictEqual`, and the stored ride's power, cadence, heart rate,
  distance and moving time equal.

### What was run for this ADR

On this branch, with no change to code, the two tests above pass (78 tests in the two files). Then
three changes were made to `GameView.tsx` one at a time and restored, to show which of them the
existing tests catch:

| Change | What it is | `delivery-wiring.test.tsx` |
|---|---|---|
| The simulation is held (`holdAt`) while a crash is drawn | the naive stop: the real rider paused | **9 red**, among them every *"sends the same writes at the same times"* case with a crash and *"stores the same power, cadence, heart rate, distance and moving time"* |
| The simulation's odometer is moved back 20 m on a crash (`correctToward(-20)`) | distance lost on the odometer | **the same 9 red** |
| The round is handed the odometer less 5 m | a round on a second distance, which is this ADR's design | **6 red, none of them a trainer write**: each failure is the test's own scripted outcome (*"expected '0 delivered, 3 missed' to be '2 delivered, 1 missed'"*, a crash or a no-delivery the script expected that did not happen), because the test's shadow round still reads the odometer. The trainer-write comparisons stayed green |

So the existing test already fails on the two ways of stopping a rider that D-2.1 forbids, and does
not fail on the way this ADR proposes. The implementation issue (D-12) has to move the test's shadow
round onto the drawn distance, and keep every trainer-write comparison unmodified.

---

## Decision

### D-1 — What this supersedes, and the one rule it does not touch

1. **A Delivery crash costs its points (ADR 0059 D-2.4's penalty, unchanged) and stops the drawn
   rider**, who is drawn falling, getting back on and riding on (D-3, D-10). This replaces D-2.4's
   *"It does **not** slow the virtual rider"*, and ADR 0065 D-11's *"no slow-down of the drawn
   rider"*, for Delivery rounds, on a rider's own route and on a built-in level alike.
2. ⚠️ **Nothing reaches the trainer. ADR 0059 D-2.1 holds unchanged**, as ADR 0065 D-11 restated it:
   *"A crash, a contact, a hazard, a miss, the weather, the light, an unlock and a level's parameters
   change nothing the trainer is sent, or when."* A crash makes **no resistance, grade, ERG target or
   timing change** of any kind. Trainer control is a safety issue (`SECURITY.md`): a person is
   pedalling against what the trainer is told. D-5 says how this stays true and which tests hold it.

### D-2 — Two distances: the ride distance and the drawn distance

1. **`rideDistance`** is the simulation's own odometer (`simulation.state.ride.distance`), earned by
   the rider's power through the one physics. It is **the only distance the grade is read at**, the
   only one the trainer's timing depends on, the only one recorded and synced, the only one a solo
   draft reads (ADR 0066 D-1; `solo-draft.ts` through `fieldDraftFactors`), and the only one the HUD's distance shows.
   Nothing in this ADR changes it.
2. **`crashOffset`** is a separate number of metres, held in the Delivery round
   (`ride-round.ts`), **never in `simulation.ts`**, and **clamped to `[−B, 0]`** after every change.
   A crash makes it more negative (D-3); the payout brings it back toward nought (D-4). Nothing else
   changes it.
3. The rider is **drawn** at **`drawnDistance = rideDistance + crashOffset`**, and the round reads
   that distance: its throws, misses, obstacles, hazard warnings, `nextHouse` and its end.
4. **The offset never flows into the ride distance.** Nothing adds it to `rideDistance`, nothing
   derives it from the grade, and nothing that feeds the simulation reads `drawnDistance`: not the
   gradient session, not a draft, not a room's correction (a round is solo, DL9, so there is none).
   This is ADR 0060 D-3.4 and D-5.3's rule, for this offset.
5. **B, the bound, is a rule and not a free number** (the author's choice; D-11 Q3):
   `B = AVOIDABLE_FASTEST_METRES_PER_SECOND × CRASH_STOP_SECONDS`, rounded up to the next 5 m. With
   the stop of D-3 at 1.8 s that is 12 × 1.8 = 21.6 m, so **B = 25 m**. A longer stop (D-11 Q2)
   raises B by the same rule and needs no new ADR.
6. **What B means for the rider.** The road the rider is drawn on and the road the grade is read at
   are never more than B apart, and are apart only from a crash until its payout ends. What the
   trainer holds lags the read point a little further (the once-a-second write and its deadband, as
   ADR 0060 D-3.5 says), so during a stop the rider may feel the road up to about B ahead of where
   they are drawn: at 12 m/s, about two seconds of road; at 5 m/s, about the same 9 m the rider rode
   while down. ADR 0060 accepted 10 m on the same reasoning; this is larger, and temporary.

### D-3 — The stop

1. **For `CRASH_STOP_SECONDS` from a crash the drawn rider does not move along the road**: each
   simulation step that runs takes what the ride covered off `crashOffset`, so `drawnDistance` holds
   where the crash was. `CRASH_STOP_SECONDS` is one constant, equal to the crash's drawn length
   (`crash-look.ts` §`CRASH_SECONDS`, 1.8 s today); a longer get-back-on clip (D-10) changes that
   one constant.
2. **If the offset reaches −B during a stop, the stop ends there**: the drawn rider moves with the
   ride from that step, and the get-up still plays to its end. Only a second crash early in a payout at
   about 7 m/s or more, or one stop at more than about 50 km/h, can reach it (D-4.3, D-4.4).
3. **While the rider is down** (from the crash to the end of the stop):
   - no throw is taken, and a throw asked for is refused, as one inside `THROW_COOLDOWN_SECONDS` is;
   - no contact is counted: a second hazard reached, or a moving one that reaches the held rider,
     costs nothing, and a moving hazard is never drawn through the rider (ADR 0065 D-10.6's *"no
     contact … drawn as harm"* holds both ways);
   - a parcel already in the air lands as it would have;
   - a house whose window closes while the rider is held is missed as today, read at
     `drawnDistance`, which is held: a house the rider has not reached is not missed by the stop.
4. **A ride paused while the rider is down stays down** on resume and finishes the stop afterwards
   (today's #2454 rule, `delivery-wiring.test.tsx` §"keeps a rider who paused while down still
   down"). A pause steps nothing, so it changes neither distance.
5. **The rider pedals through the stop exactly as before.** The trainer is sent the road at
   `rideDistance`, which goes on as the rider's power moves it. Nothing tells the rider to stop
   pedalling, and nothing reads whether they did.

### D-4 — After the stop: the distance is banked and paid out (recommended; D-11 Q1)

1. **The distance ridden while down is banked, and paid out once the rider is back on**: after the
   stop, the drawn rider moves faster than the ride, by a share **P = 25 %** of the ride's speed
   (the author's choice), until `crashOffset` is back to nought. So a crash costs its point and
   the houses the rider could not throw at, never ground at the end: the round and the ride finish
   together.
2. **The payout takes the same time at every speed**: `CRASH_STOP_SECONDS / P`, 7.2 s with the
   numbers above, because the banked distance and the payout both scale with the speed. That holds
   below 9.6 m/s, where the cap of item 3 does not bite; nearer 12 m/s the payout takes longer.
3. **The payout never takes the drawn speed past `AVOIDABLE_FASTEST_METRES_PER_SECOND`.** The drawn
   rider moves at `max(v, min((1 + P) × v, AVOIDABLE_FASTEST))` for a ride speed `v`, so every speed
   the rider is drawn at by the payout is one every hazard is already proved avoidable at (ADR 0065
   D-10.8, `obstacles.test.ts`, `moving-hazards.test.ts`), and their warnings (D-10.9) need no new
   distance. A rider above 43.2 km/h is already outside that range; their offset waits, bounded by
   B, until they slow.
4. **A crash during a payout** starts a new stop from the offset as it stands (D-3.2 bounds it).
5. **A ride that ends with an offset outstanding** ends its round as #1857 has it
   (`endDeliveryRide`), read at `drawnDistance`: a house the drawn rider had not passed counts for
   nothing (`round.ts` §`endRound`). The most a late crash can cost there is the houses within B of
   the end.

**Option L, the distance lost**, is recorded so the owner can choose it instead. The offset is never
paid out, so each crash costs the rider the ground they rode while down, as a real crash does. Its
costs: the drawn road and the felt road drift apart by up to 21.6 m a crash **with no bound** (five
crashes at 43 km/h is about 108 m, a climb felt well before it is seen); and the ride's own end, read
on the odometer, comes before the drawn rider reaches it, so the last houses of a round fall off a
ride that has ended. Option L would need the grade read at the drawn distance to avoid the drift,
which D-1.2 forbids. The author recommends against it for those reasons.

### D-5 — Nothing reaches the trainer: the rule restated, and the tests that hold it

1. **The rule, word for word from ADR 0059 D-2.1**: *"No game event — a hit, a miss, an obstacle, a
   delivery, a crash, a round's start or end — changes what the trainer is sent, or when."* A stop
   and a payout are game events. They move `crashOffset` and the drawing, and nothing else.
2. **The offset lives only in Delivery's own modules**, under `apps/web/src/game/delivery/`, which
   `delivery-cannot-reach-trainer.test.ts` walks. That test stays green **unmodified**, with every
   module the implementation adds inside its walk. `simulation.ts` gains no Delivery state (ADR 0059
   D-2.5's last sentence stays true).
3. **The behavioural test is extended, never relaxed.** `delivery-wiring.test.tsx`'s comparisons of
   trainer writes (`toStrictEqual`, the same grades at the same times) and of the stored ride stay as
   they are, and the implementation adds a case that rides one power trace with crashes, stops and
   payouts in it, **and the same trace with Delivery off, and sends byte-identical trainer writes at
   identical times and stores an identical ride**. Its non-vacuity checks show that a stop happened,
   that the drawn distance fell behind the ride distance by more than a metre and came back to it,
   and that the road climbs or falls under the stop, so that a stop on a flat road cannot pass it by
   accident.
4. **A test that the naive stop is red.** The implementation shows, as a mutation listed in its pull
   request, that holding the simulation during a crash (`holdAt`) and moving its odometer back on a
   crash each turn that case red. Both did on `main` on 2026-11-22 (Context).
5. **The safety reading stands on the grade only.** The trainer is sent the road's grade; resistance
   is worked out from it by the trainer and its flywheel. ADR 0059's *What would make this ADR wrong*
   applies here too: if a trainer turns out to change its resistance with the game's virtual speed,
   D-2 rests on a false reading, and so does this.

### D-6 — The camera, the world and the HUD

1. **The camera follows the drawn rider**, as the lap race draws its riders at their drawn distance: it stops with them,
   and pays out with them. There is no jump back, because the drawn rider never jumps. This answers
   `crash-look.ts`' note that holding the rider back *"would need the camera to choose between them
   and a jump back"*: the camera never chooses the ride distance.
2. **The world is drawn round the drawn rider**, as it is round the drawn lap racer. B is a few
   houses, well inside what the corridor and the town already hold.
3. **The HUD's distance and speed are the ride's**: what the rider pedalled, what is recorded, and
   what the HUD shows today. The HUD's *"Crashed"* lasts the stop, as it lasts the crash today, and is
   said through the one live region (#647's owed rule) as today. The next house's countdown
   (`nextHouse`) reads `drawnDistance`, so it holds while the rider is held.
4. **A pacer or the rider's own ghost on a Delivery ride** is drawn at its own distance, so it draws
   further ahead during a stop. That is a drawing. Its draft reads `rideDistance` (D-2.4), so a
   crash changes no draft, and through it no simulated speed and no grade time.

### D-7 — Reduced motion (§4e)

**The stop and the payout apply under reduced motion** (recommended; D-11 Q6). A rider stopping is
not an animation: it is where the rider is. The crash's drawing keeps its reduced-motion rule
(`crash-look.ts` §"Reduced motion"): a still crash pose from the crash until the rise would begin,
then the rider upright, with no fall or rise drawn between. The payout is the rider riding a little
faster, which is ordinary motion, not decoration.

### D-8 — The assisted setting (DL10)

**The stop and the payout apply with the assist on too** (recommended; D-11 Q5). Under D-4 a stop
costs no ground, so it is no new pressure the assist must remove. The assist's own settings still do
what they do: fewer or no hazards (so fewer crashes), wider windows, no fail.

### D-9 — The lap race is not changed

**This ADR applies to Delivery only** (recommended; D-11 Q4). The lap race has no crash, and its
knock-backs already move a bounded drawn distance under ADR 0060 D-3, with a fairness rule (D-4)
written for B = 10 m. A stop in a race would be a second cause on that offset, larger than its B,
and would change that fairness rule's bound. A lap-race crash, if one is wanted, needs its own ADR.

### D-10 — The animation: our own clip

1. **The animation is this project's own**, made the way #2493 made the crash clip: by
   `apps/web/tools/realistic/blender/process_rider.py` from our own script (`rider_crash.py`, with
   `apps/web/tools/realistic/rider-crash.ts`), on the MakeHuman
   rider the realistic world already ships, timed from `crash-look.ts`. No clip, motion capture or
   animation is taken from another game or a third-party library, and none is downloaded. A new
   source for one would be an asset-source question under ADR 0049, not something this ADR admits.
2. **The first build plays today's clip** over the 1.8 s stop: down, lying, and back up on the bike
   with one foot planted (#2993). That alone answers *"doesn't stop and they keep moving"*.
3. **A real get-back-on** (the rider standing, lifting the bicycle and swinging a leg over) is a
   longer clip, made the same way, and its own issue (D-12). It changes `CRASH_STOP_SECONDS` and,
   by D-2.5's rule, B: at about 3 s, B is 40 m and the payout lasts about 12 s. The owner chooses
   whether it is wanted (D-11 Q2).
4. **The stylised world** draws no MakeHuman rider. It keeps its roll and rebound (`crashedRoll`,
   `crashRebound`), held in place for the stop.
5. **No draw call is added.** The clip is in the rider's own file and the stop moves nothing new, so
   Delivery's ceiling (ADR 0059 D-3) and the frame rate are unchanged by this; the owner's tablet
   check (D-12) is where the frames are seen to hold.

### D-11 — What the owner is asked to rule on

| # | Question | Recommended | Rests on |
|---|---|---|---|
| **Q0** | Accept this ADR: a Delivery crash stops the drawn rider on a second distance, with nothing sent to the trainer | **Yes** | D-1, D-2, D-5 |
| **Q1** | After the stop: the distance **banked and paid out** (D-4), or **lost** (option L) | **Banked and paid out** | D-4 |
| **Q2** | The stop's length: **1.8 s with today's clip** now, and a real get-back-on clip of about 3 s as a follow-up issue; or 1.8 s and no follow-up; or wait for the longer clip | **1.8 s now, the longer clip as a follow-up** | D-3.1, D-10 |
| **Q3** | B by the rule of D-2.5 (25 m at 1.8 s), the payout share P = 25 % (7.2 s), and the payout capped at 12 m/s | **Yes, all three** | D-2.5, D-4 |
| **Q4** | Delivery only, the lap race unchanged | **Yes** | D-9 |
| **Q5** | The stop applies with the assisted setting on | **Yes** | D-8 |
| **Q6** | The stop applies under reduced motion, with the still crash pose | **Yes** | D-7 |

### D-12 — What follows, once accepted

Filed under [#2359](https://github.com/openzigs/onyourleft/issues/2359) after the owner accepts this
ADR, not before (#3011's acceptance):

1. **The stop and the payout**: `crashOffset` in `ride-round.ts`, the round and the drawing on
   `drawnDistance`, the camera on the drawn rider, and the rules of D-3 and D-4, each held by a test
   read back through `GameView`; the tests of D-5.3 and D-5.4; `crash-look.ts`' and `obstacles.ts`'
   headers rewritten to cite this ADR in place of ADR 0059 D-2.4.
2. **The get-back-on clip**, if Q2 asks for it: the clip, the constant, and B by D-2.5.
3. **Owner tablet check** on #733: crash on a round; the rider stops, gets back on and rides on; the
   frames hold.

---

## Consequences

### What this enables

- **A crash reads as a crash**: the rider stops, gets back on and rides on, which is what the owner
  asked for, with the trainer's behaviour exactly what it is today.
- **#3011's implementation issue has a document to be checked against**, with the trainer rule
  restated and the tests that hold it named (D-5).

### What this costs

- **A second distance in Delivery.** Every part of the round now reads `drawnDistance`, and a future
  change that reads the odometer instead, or that feeds `drawnDistance` to the simulation, is a
  defect. D-2.4 and D-5 are where that is checked.
- **The drawn road and the felt road can differ by up to B** (25 m as proposed) from a crash until
  its payout ends, so a rider can feel a climb start up to about two seconds before they are drawn
  on it, at the fast end of the range.
- **A crash still cannot be felt in the pedals**, by design. The stop is drawn; the legs feel the
  road.
- **Under D-4 a crash costs no ground**, only its point and the throws missed while down and during
  a faster payout. Option L would cost ground and is refused for the drift it causes.

### Reversing any of these

Each of D-1 to D-10 is reversed only by a **superseding ADR**; an amendment may record a renamed
path or a changed constant's value under D-2.5's rule, never a decision (ADR 0013). In particular:

- any crash, stop or payout reaching the trainer, or `crashOffset` touching `rideDistance`
  (D-1.2, D-2.4), needs a superseding ADR of ADR 0059 D-2.1 itself, and the safety reasoning
  answered;
- a stop in the lap race (D-9) needs its own ADR and ADR 0060 D-4's bound re-proved.

### Not decided here

- **Whether a crash costs more points**, or costs a stop of a different length on a level than on a
  rider's own route. `CRASH_SCORE_DELTA` stays −1.
- **Sound** for the fall and the get-back-on: the game's audio cues are their own issue.

## What would make this ADR wrong

- **The trainer changes its resistance with the game's virtual speed** (ADR 0059's own condition).
- **A round is played in a room** (DL9). A room's correction steers toward the ride distance (ADR
  0060 D-5.4), and a held drawn rider there would need that reasoning re-run first.
- **A hazard turns out unavoidable at a payout speed** under 12 m/s that the sweeps do not cover.
  Then D-4.3's cap is wrong, and the payout is reopened here.

## Sources

| What | Where | Read |
|---|---|---|
| The owner's request | [#3011](https://github.com/openzigs/onyourleft/issues/3011), its body (tablet session of 2026-11-21) | 2026-11-22 |
| The lane note | [#3011, comment of 2026-11-22](https://github.com/openzigs/onyourleft/issues/3011#issuecomment-7077863218) | 2026-11-22 |
| The crash's times and clip | `apps/web/src/game/delivery/crash-look.ts`; pull request [#2993](https://github.com/openzigs/onyourleft/pull/2993) | 2026-11-22 |
| The speed range, spacing and `Crash` | `apps/web/src/game/delivery/obstacles.ts` | 2026-11-22 |
| The round's distance | `apps/web/src/game/delivery/ride-round.ts` §`stepDeliveryRide`; `apps/web/src/game/GameView.tsx`, where it is stepped after the grade is sampled | 2026-11-22 |
| The tests run and the three changes | `apps/web/src/game/delivery-wiring.test.tsx`, `apps/web/src/game/delivery/delivery-cannot-reach-trainer.test.ts`, on this branch at `76c1b2603` | 2026-11-22 |
