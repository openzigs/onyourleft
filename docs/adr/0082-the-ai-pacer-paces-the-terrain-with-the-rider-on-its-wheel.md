# ADR 0082: The AI pacer paces the terrain with the rider on its wheel — superseding in part ADR 0072 D-2

- **Status**: **Accepted**, 2026-11-18, by the owner on
  [#2802](https://github.com/openzigs/onyourleft/pull/2802): *"Yes to pacer rule"*, the answer to
  that pull request's R-1
- **Date**: 2026-11-18
- **Deciders**: **the owner**, who ruled on R-1 and set the 300 m. **The author** chose the other
  figures, marked *the author's choice* where they are made
- **Issue**: [#2794](https://github.com/openzigs/onyourleft/issues/2794)
- **Number**: **0082**. 0075 (#2670), 0076 (#2767) and 0077 (#2762) are claimed in open pull
  requests, and 0078 is ADR 0078 (#2793). 0079 and 0080 are claimed by #2779's epic, with ADR 0080 in
  #2795, and 0081 by #2790. The next free number is then **0083**
- **Supersedes, in part**: [ADR 0072](0072-a-model-directs-the-bot-pacer-during-a-ride.md) **D-2**'s
  *"The model picks the plan and the intent; nothing else"*, for a second case beside
  [ADR 0078](0078-a-floor-under-the-ai-pacers-intent.md)'s: with the rider level with the pacer or
  in its draft, the device picks the intent near a hill. ADR 0072 gains one dated `## Amendments`
  entry pointing here, and ADR 0078 one on which of the two wins. Neither body is edited
  ([ADR 0013](0013-adr-amendments.md) D-3)
- **Leaves standing**: the rest of ADR 0072 — #92's 80 % to 110 % envelope (D-2.2), no power in the
  answer (D-3), the line and its screen (D-4), the log as the whole of what replays the pacer and
  `MODEL_PACER_CODE_VERSION` (D-5), no pacer event reaching a trainer (D-6), #92's pacer on any miss
  (D-7) — and all of ADR 0078

## Context

#2794 asks that the pacer *"ease slightly before a climb… and lift on a descent"*. Its pull request
#2802 shows the model the course ahead (`course`, `@onyourleft/domain` §`ModelPacerCourse`) and asks
for it in the prompt (`pacer-5`). On the owner's PC (`gemma4:12b`, 54 asks for each prompt, #2802's
tables):

- with the rider **40 m behind**, `pacer-5` eased in every valid answer near a hill (13 of 13);
- with the rider **level, in the draft**, it held everywhere, before the climb, on it, over the top
  and on the descent, under both wordings tried;
- with the rider **ahead**, it never lifted on the descent.

So the terrain moved the intent only where the gap rules already left room. Making the pacer pace
the terrain with the rider on its wheel is a device-side rule, as ADR 0078's floor is, and a change to
ADR 0072 D-2. #2802 asked the owner (R-1). The owner answered *"Yes to pacer rule"* on 2026-11-18.

## Decision

### D-1 — The rule

1. **When it applies.** On an ask built with the rider **level** with the pacer (`riderPlace`
   `level`: within **2 s** at the rider's own speed, `@onyourleft/domain` §`riderPlaceOf`) **or in
   its draft** (`riderInDraft`). **Never with the rider `ahead`**, which is ADR 0078's ground. With
   the rider `behind` and out of the draft the model's gap rules decide, as they did.
2. **What it does** (`@onyourleft/domain` §`pacerTerrainAt`, §`riddenDirection`), read at the pacer's
   place on the route when the ask was built:
   - **`ease` in the last 300 m before the next climb** (`PACER_BEFORE_CLIMB_M`, the owner's
     figure). A climb is #2794's: **3 %** or steeper for at least **200 m** without a break
     (`route/course-ahead.ts`), so a 150 m ramp is not one;
   - **`lift` on a descent**, by the same rule downhill, counted end to end, so the last metres of a
     descent still count;
   - **`lift` for the first 200 m after a climb ends** (`PACER_OVER_THE_TOP_M`, *the author's
     choice*: the shortest a climb is, about 20 s at 36 km/h);
   - **on the climb itself, and everywhere else, the model's intent is ridden.**
3. **Only the intent moves.** The plan is the model's. The rule answers with one of the three
   intents and no number, and the direction is ridden through `directedPacingFactor`, so it never
   leaves #92's envelope.
4. **When two terrains meet.** A descent that runs into a climb inside 300 m is *before a climb*,
   ridden at `ease`: saving for the climb is the rule's reason for existing, and `ease` is the lower
   of the two. *The author's choice*.
5. **On applied answers only.** The rule moves an answer that is applied. A late, invalid, refused
   or failed ask leaves the decision in force, or #92's pacer, as ADR 0072 D-7 says. That keeps the
   log the whole of what replays the pacer (D-2).

### D-2 — Against ADR 0078's floor, the floor wins

The floor rides an `ease` as `hold` once the rider has been ahead for 10 s. `riddenDirection` applies
this rule first and the floor **last**, so where both could act, **the floor wins**. Today they
cannot both act on one ask: this rule refuses `ahead`, and the floor acts only on asks built with the
rider `ahead`. The order is there so that a later change that lets them meet, for example a wider
draft, cannot let an `ease` before a climb pull away from a rider who has been ahead for 10 s, which
is the owner's 2026-11-17 complaint ADR 0078 answers.

### D-3 — The line beside the intent ridden

Where the device rides an intent other than the model's, **a line that contradicts the intent ridden
is not shown** (`pacerSayAgainstRidden`): a push under `ease`, an ease under `lift`, either under
`hold`. The direction is still applied and logged. For the floor this is the rule ADR 0078 D-1.3
already rides.

**Why the line, and not the whole answer, is refused.** `say-against-intent` (ADR 0072's
2026-11-17 amendment) makes the whole answer invalid, so the decision in force stays. Doing that
here would undo the rule: the model's `hold` with *"I'll push on"* before a climb would leave the
last decision in force, not the `ease` the owner asked for. And the instance cannot make the check:
it has no route profile, so it cannot tell that the pacer is over a climb's top. So the instance and
the device go on reading the line against the model's intent, and the device then drops a line that
does not fit the intent it rode.

### D-4 — Replay and the log

1. **The log records the direction ridden**, as ADR 0078 D-2.1 does: the rule is applied before the
   decision is logged, so an applied record holds the `ease` or `lift` the pacer rode.
2. **`MODEL_PACER_CODE_VERSION` stays 1.** For a given route, plan and log, the pacer's power is what
   it was: `pacerDirectionAt` reads the decision in force off the log, and replay never runs the
   rule. A stored ride replays exactly, with or without this rule in the code.
3. **What the log does not say.** It does not record that the rule fired, or what the model chose.

### D-5 — What this does not change

- the envelope (ADR 0072 D-2.2), and no number in the answer (D-3);
- **the trainer**: no model output and no rule output reaches it (D-6). `model-pacer-wiring.test.tsx`
  and `lap-race-cannot-reach-trainer.test.ts` are unchanged;
- the fallback (D-7);
- the data sent (D-3.4 as amended): the rule reads the route profile the device already has, and the
  `riderPlace` and `riderInDraft` already in the state. Nothing new leaves the device;
- the prompt (`pacer-5`), which still asks the model to pace the terrain where the gap rules leave a
  choice.

### D-6 — Reversing it

Removing the rule is a code change in `riddenDirection` and the director, with no store change: a log
written with the rule replays with or without it.

## Consequences

### What this enables

With the rider on its wheel, the pacer now eases before a climb and lifts on a descent and over the
top, whatever the model says, which is what #2794 asked for and the model did not do.

### What this costs, stated plainly

- The model's say over the intent is narrower again: ADR 0072 D-2's *"nothing else"* now has two
  exceptions, ADR 0078's and this one.
- The log hides the rule (D-4.3). How often the model agreed with the terrain has to be measured
  against the model, as #2802's tables were.
- **A line can vanish.** When the model's line describes the intent it chose and the device rides
  another, the rider sees no line for that answer.
- The terrain is read when the ask is built, and the answer comes about 1.5 s later. At 36 km/h the
  pacer is then some 15 m further on, so the ease can start a few metres late and the lift can run a
  few metres past the 200 m.

## What would make this ADR wrong

- **The owner's tablet ride shows the pacer surging away on a descent from a rider in the draft.** A
  `lift` is +5 %, and the pacer also descends faster: then the descent lift should be `hold`.
- **The model learns to pace the terrain itself** with the rider level, under a later prompt or
  model. Then the rule only repeats the model, and could be removed (D-6).

## Amendments

Appended under [ADR 0013](0013-adr-amendments.md). Nothing above this line has been edited.

- **2026-11-18** — **D-1.5, D-2, D-3's reason and D-4.2 and D-4.3 are superseded in part by
  [ADR 0083](0083-the-device-decides-the-ai-pacers-intent-and-the-model-writes-the-line.md)**, **Proposed**, on the owner's
  ruling of that day on [#2835](https://github.com/openzigs/onyourleft/issues/2835). **The rule
  itself, D-1.1 to D-1.4, stands whole**, with its figures: it is now the second step of the one
  device rule (`pacer/device-rule.ts` §`pacerRuleDecision`), read before the gap. What moves: the
  device decides every intent, so the rule no longer acts *"on applied answers only"* (D-1.5) and a
  missed answer no longer leaves an older decision in force; there is no order to keep against ADR
  0078's floor (D-2), because the rule refuses `ahead` and the gap rule never eases there;
  `pacerSayAgainstRidden` (D-3) is read on every line; `MODEL_PACER_CODE_VERSION` is 2 (D-4.2); and
  the log records that the rule set the intent, as `before-climb`, `descent` or `over-the-top`
  (D-4.3). `riddenDirection` is gone from the code. This ADR's body is unchanged.
