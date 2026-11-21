# ADR 0083: The device decides the AI pacer's intent, and the model writes the line — superseding in part ADR 0072 D-2, D-3, D-4.2, D-5 and D-7, ADR 0078 D-1 and D-2, and ADR 0082 D-1.5, D-2, D-3 and D-4

- **Status**: **Accepted**, 2026-11-19, on the owner's answers to D-9, recorded in D-10 and in the
  owner-ruling comment on [#2864](https://github.com/openzigs/onyourleft/pull/2864). Proposed
  2026-11-18 on the owner's ruling of that day on
  [#2835](https://github.com/openzigs/onyourleft/issues/2835), which accepts the design and that it
  needs an ADR (*"yes fold these in"*, quoted in Context)
- **Date**: 2026-11-18
- **Deciders**: **the owner**, whose ruling is quoted in Context and who answers D-9. **The
  author** chose the figures, marked *the author's choice* where they are made
- **Issue**: [#2835](https://github.com/openzigs/onyourleft/issues/2835)
- **Number**: **0083**. `docs/agents/adr-numbering.md` gives 0081 as the next free number and 0083
  as the one after it. #2835 and [#2836](https://github.com/openzigs/onyourleft/issues/2836) run in
  parallel and each needs an ADR, so this lane took 0083 and left 0081 to #2836's, and said so on
  #2835. No open pull request held either number. **The next free number is still 0081**, and the
  number after it is **0084**
- **Supersedes, in part**:
  - [ADR 0072](0072-a-model-directs-the-bot-pacer-during-a-ride.md) **D-2**'s *"The model picks the
    plan and the intent; nothing else"*, whole: the device picks the intent, and nobody picks a
    plan. **D-3.1** and **D-3.2**: the answer's schema is `{"say"}` and no longer names a plan or an
    intent. **D-4.2**'s last sentence and R-5 (*"A line that fails makes the whole answer invalid: a
    model that wrote a bad line is not trusted for its direction either"*): there is no direction in
    the answer to distrust. **D-5.1**'s *"it reads no rider state directly"* and **D-5.2**'s *"A
    decision applies from the first fixed step at or after its arrival"*: a decision is the
    device's, and applies from its ask. **D-7**'s *"On any late, invalid, missing … answer the pacer
    rides the decision in force, and with none in force, #92's own rule"*: such an answer costs a
    line and nothing else. The 2026-11-17 amendment's `say-against-intent` rule goes with D-4.2's;
  - [ADR 0078](0078-a-floor-under-the-ai-pacers-intent.md) **D-1.1**'s *"for at least 10 s"*, and
    **D-2.2**'s *"It does not record that the floor fired"*: the pacer never eases with the rider
    ahead, from the first ask, and the log says why it rode what it rode;
  - [ADR 0082](0082-the-ai-pacer-paces-the-terrain-with-the-rider-on-its-wheel.md) **D-1.5** (*"On
    applied answers only"*), **D-2** (the order against the floor), **D-3**'s reason for refusing
    only the line, and **D-4.2** and **D-4.3** (`MODEL_PACER_CODE_VERSION` stays 1; the log does not
    say the rule fired).

  It is a new ADR because each of these changes part of an accepted decision, and
  [ADR 0013](0013-adr-amendments.md) D-3 sends a changed decision to a new ADR. ADR 0072, ADR 0078
  and ADR 0082 each gain one dated `## Amendments` entry pointing here; no body is edited
- **Leaves standing**: #92's 80 % to 110 % envelope (ADR 0072 D-2.2, the owner's *"80-110 is
  good"*), the existing pacer physics (D-2.3), no power and no tools (D-3), the input's *no
  coordinate, no place name, no rider name, no date, no identifier* (D-3.4), the line's screen and
  that it is never kept (D-4, ADR 0077), the log stored with the ride as an optional ride fact
  (D-5.4), **no pacer event reaching a trainer** (D-6), the instance's gates, consent, slot and
  sealed routes (D-8), the patent posture (D-9); ADR 0078's *"the floor never lifts"* read as: the
  floor never makes a lift, the gap rule does; and ADR 0082 D-1.1 to D-1.4, its terrain rule and its
  figures, whole

## Context

### What the owner saw, and ruled

On the tablet ride of 2026-11-18 (build ride-1118b, `pacer-5`, ADR 0078 and ADR 0082 in it):

> "saying it is slowing down when behind me. Also at the start it takes off to aggressive. Almost
> at full speed"
>
> "I think the agent needs a bit more logic to give it more feedback"

The saved ride's log: 48 asks in about four minutes. The first three failed, the first of them
while the model loaded cold, so the pacer rode its plain target from a standstill. Then `ease` on
every answer for two and a half minutes. `pacer-5`'s own rule table says *rider behind and losing
ground: ease, so they can come back*, so that `ease` may have been the pacer correctly waiting and
explaining it badly. **The log could not say**: it kept the direction ridden and nothing about
where the rider was, the line, or whether a device rule had changed the model's answer.

After a review of the AI code the same day, the issue's revision block records:

> **Owner ruling:** "yes fold these in", given to "Shall I fold these into #2835 and #2836 along
> with the review's design?" … That design moves the pacing decision to the device, which needs an
> ADR; the ruling accepts it.

### What was wrong with the shape, not the prompt

A model picked the intent from a table of rules written in the prompt. Two device rules then
corrected it (ADR 0078, ADR 0082). Three things followed:

- **A failed, late or void answer changed the pacing.** The pacer rode a decision up to 15 s old,
  or none. A line the screen stopped, or one that said the opposite of its intent, voided the
  direction with it.
- **`ease` was a fixed 7 %.** A rider more than about 7 % under the pacer's setting could never
  come back, however long the pacer eased.
- **The rules were deterministic, and were being asked of a model.** ADR 0078 measured the model
  easing on 11 and 13 of 20 asks with the rider ahead under `pacer-3`; ADR 0082 measured it
  holding on every ask where it was asked to pace the terrain. Each time the fix was a device rule.

## Decision

### D-1 — The device decides the intent, by one rule

Each time it asks, the device decides what the pacer does (`@onyourleft/domain`
§`pacerRuleDecision`, `pacer/device-rule.ts`), read in this order:

1. **The rider is at a standstill**, so no time gap can be said: behind the pacer, `ease` by the
   most it may (**20 %**, reason `rider-stopped`); level or ahead, `hold`.
2. **The terrain, with the rider on the wheel**: ADR 0082 D-1 as it stands. The rider `level` or in
   the draft, and never `ahead`: `ease` in the last 300 m before a climb, `lift` on a descent and
   for 200 m over a climb's top, at ADR 0072's fixed shares (7 % and 5 %).
3. **The gap** (§`pacerGapResponse`), a time gap at the rider's own speed:
   - inside **2 s** either way (`PACER_LEVEL_S`, ADR 0078's figure), `hold`;
   - **behind**, `ease`, to wait; **ahead**, `lift`, to chase;
   - **the response grows with the gap, in a straight line**: `share = (|gap| − 2 s) / (10 s −
     2 s)`, held to 0 and 1. The pacer eases by `share × 20 %`, or lifts by `share × 10 %`, to a
     whole percent. So 4 s behind is 5 %, 6 s is 10 %, 8 s is 15 %, and 10 s or more is the whole
     20 %; 6 s ahead is 5 % and 10 s or more is the whole 10 %.

   20 % and 10 % are the whole of #92's envelope below and above the flat figure. The **10 s**
   (`PACER_GAP_FULL_S`, about 100 m at 36 km/h) is *the author's choice*, a feel parameter.
4. **What the rule cannot do.** It cannot ease with the rider ahead: ahead, its only answers are
   `lift` and `hold`, **from the first ask**. That is ADR 0078's floor without its 10 s, and it is
   the rule's shape rather than a correction to it. It cannot leave the envelope: the share is
   capped in the rule and the product is clamped again where it is ridden
   (§`directedPacingFactor`). It names no power.
5. **No plan is chosen.** Every decision rides `rolling`, #92's own rule. The issue offered *"choose
   the plan by rule (per climb or per lap), or drop it from the call"*; it is dropped. The saved
   ride was `rolling` throughout, and a plan that changes how the pacer takes a hill on top of ADR
   0082's rule for the same hill is two rules for one thing. `even` and `climber` stay readable in
   a log from before this ADR. *The author's choice*.

### D-2 — The model writes the line, and only the line

1. **The answer is `{"say": <a line>}`.** A key the schema does not name still voids the answer, so
   an answer with `intent`, `plan` or `watts` in it is no answer (§`readModelPacerAnswer`). The
   device's port holds no direction in what it returns (`instance/pacer-port.ts` §`PacerReply`), so
   there is no path by which a model's words reach `GameSimulation.directPacer`.
2. **The model is told what the pacer is doing and why**, in closed words: `intent`, `byPct` (whole
   percent), `reason` (one of `rider-level`, `rider-behind`, `rider-ahead`, `rider-stopped`,
   `before-climb`, `descent`, `over-the-top`) and `starting` (D-3). A state without a `reason` is
   refused, field named, before any model call.
3. **A failed, late or void answer costs a line, never the pacing.** The decision was put in force
   when it was asked. `say-against-intent` is gone: a line that says the opposite of what the pacer
   is doing is hidden on the device (§`pacerSayAgainstRidden`, ADR 0082 D-3's function, now read on
   every line) and logged as `against`.
4. **A repeat is no new line.** The device holds the last three lines shown, as it has since #2760,
   and a line whose words are one of them again, whatever its case, spacing or punctuation, is not
   shown, not spoken and not sent back as a fourth (§`pacerSayRepeats`). Logged as `repeat`.
5. **More to coach from**, each a number and each left out when it cannot be said: the gap in
   seconds, the whole seconds the rider has been where they are, the metres they gained or lost on
   the pacer over the last 30 s, and how far power, cadence and heart rate moved against the half
   minute before (percent, rpm, bpm). D-3.4's *no coordinate, no place name, no rider name, no
   date, no identifier* holds, and the reader still refuses a key it does not name.
6. **A "story so far" line**, written **on the instance** from those fields
   (`pacer-prompt.ts` §`pacerStory`), goes before the state: *"the player is behind you by 6.8 s,
   and has been behind for 90 s; they are closing; you are easing by 12 % so they can get back on; a
   climb starts in 100 m."* It is written there, from fields already read against closed lists and
   ranges, so that there is still no free-text field a device could put a place or a name into.
7. **The prompt is `pacer-6`.** It states the goal (a kind training partner who keeps the rider
   company and says something useful), says what each reason means, asks for a line that says
   **why** (*"easing so you can get back on"*, never a bare *"slowing down"*), gives three worked
   examples, and asks for no repeat. `pacer-5`'s rule table and its plans are gone. **The screen on
   the line is as strict as it was** (ADR 0072 D-4.2, ADR 0077).
8. **What is sent does not change in kind.** What leaves the device is still the rider's gap, power,
   cadence and heart rate and how they trend, and the pacer's last lines, to the rider's own
   instance's local model. The drifts are those trends as numbers, and `docs/privacy-policy.md`
   says so.
9. **One sentence of the consent changes, because it was no longer true.** *"The AI picks how the
   pacer rides and writes a short line for you; it never sets your trainer."* becomes *"The app
   picks how the pacer rides; the AI writes a short line for you and never sets your trainer."*
   Draft wording, for the owner (D-9 R-7).

### D-3 — A gentle start

1. **For the first 60 s of a directed ride the pacer is ramped up from the bottom of #92's
   envelope** (`PACER_START_RAMP_S`, the issue's figure). **The curve is linear in power**: it
   rides `0.8 + (target − 0.8) × t / 60` of its flat figure, where `target` is what the decision
   in force asks at this grade. So it is at 80 % at the line whatever the decision, half way to its
   target at 30 s, and exactly on it at 60 s, with no step (§`pacerStartShare`, §`startRamped`).
2. **It is a function of the seconds ridden**, applied where a direction is ridden, live and on
   replay by one function. A ride with no direction in force rides #92's rule as it did.
3. **And the rule waits at the start anyway.** A rider slower off the line than the pacer is behind
   it within a second or two, and D-1 eases for them.

### D-4 — The model is warm before the ride

1. **The app warms the model when the rider turns the AI pacer on in the ride menu**, consent
   given, and not at "Go": `POST /v1/analysis/pacer/warm` (`PacerPort.warmPacer`).
2. **The warm-up uses the pacer's own prompt prefix**: a one-token call of the pacer's shape about
   a fixed state with nothing of the rider's in it (`PACER_WARM_UP_INPUT`).
3. **It takes no model slot.** It passes ADR 0071's gate and consent and counts against the same
   rate limit, but a rider reading the ride menu holds up no write-up and no other rider's race.
   The route is sealed-only, a row beside ADR 0072's in ADR 0047 D-7's table.
4. **Not built here: the instance loading the model when it starts, and keeping it loaded** (the
   issue's design, 2). It would hold the model's memory on the operator's machine for as long as
   the instance runs, whoever rides, where today it is held for 30 minutes after a call. D-9 R-5
   asks the owner before that is built.

### D-5 — The log, and replay

1. **Every record is a decision of the device's** (§`PacerRuleRecord`): when it was decided and
   asked, when the answer arrived (or that none did) and what became of the ask, the direction
   ridden with its share, **the rule that set it** (`reason`), **where the rider was** (`place`, and
   the gap in seconds), and **what became of the line** (`shown`, `none`, `repeat` or `against`).
   **Numbers and closed words only**: no line (ADR 0072 D-4.4 stands), and no coordinate.
2. **A decision is in force from its ask**, until a newer one or 15 s, whatever became of its
   line. The pacer is still a pure function of the route, the plan, the position, the wind and the
   log (§`pacerDirectionAt`), now with the seconds ridden for the ramp.
3. **`MODEL_PACER_CODE_VERSION` is 2.** The pacer's power for a given route, plan and log changed
   three ways: a decision applies from its ask, its intent goes by a stored share, and the first
   minute is ramped. The issue allows raising it *"only if replay needs it"*; it does.
4. **A version 1 log still reads and still replays as it was ridden.** A record is read by its
   shape, and `pacerDirectionAt` rides a version 1 record by version 1's rule (applied answers
   only, from arrival, fixed shares, no ramp). The owner's saved rides of 2026-11-17 and 2026-11-18
   are not dropped by this change.
5. **The model's own intent is not logged beside the intent ridden**, as the issue's body asked:
   there is none any more.
6. **A ride that ends with an ask out** has its record written as `failed` with no arrival, so the
   log holds every decision the pacer rode (`ModelPacer.end`).

### D-6 — What a refusal does

A refused request (no consent, not offered, busy, a state the instance does not read) still ends
the ride's asks, and with them its decisions: the one in force lapses after 15 s and the pacer
rides #92's own rule to the end (ADR 0072 D-7, for refusals, unchanged). A rider who withdrew their
consent has not chosen a pacer that reads them. *The author's choice*, D-9 R-4.

### D-7 — What does not move

- **The trainer.** No decision and no line reaches it (ADR 0072 D-6).
  `lap-race-cannot-reach-trainer.test.ts` is unmodified. In `model-pacer-wiring.test.tsx` the
  comparisons of trainer writes (`expectGradesOnly`, the ERG comparison, the release) are
  unmodified; its stand-in instance had to change, because it answered a direction and a
  `PacerReply` no longer has one, and so did what it expects of a directed ride.
- **The envelope**, the pacer's 75 kg, and that it never takes a draft.
- **The data sent** and the consent it is sent under (D-2.8), and every instance gate.
- **A rider with no instance, no consent or the switch off** loses nothing: the pacer is #92's.

### D-8 — A device and an instance on either side of this change

- **A device from before it, against an instance with it**: its state has no `reason`, so every
  ask is `validation_failed`, which that device reads as a refusal. It rides #92's pacer.
- **A device with it, against an instance from before it**: that instance refuses the new fields
  (`validation_failed`). The same.

Nothing is lost either way but the AI pacer, and nothing reaches a model. **Update both.**

### D-9 — Questions for the owner

| # | Question | Recommendation |
|---|---|---|
| **R-1** | Approve ADR 0083: the device decides the pacer's intent by D-1's rule, and the model writes only the line | **Approve.** It is the design the ruling of 2026-11-18 accepted |
| **R-2** | **No easing while the rider is ahead, from the first ask** (ADR 0078's floor, without its 10 s). The issue says *"the owner must say yes first"* | **Yes.** The rule that decides is now the device's, so the 10 s that guarded a model's answer guards nothing |
| **R-3** | The figures: the response whole at **10 s**; the pacer **chases** a rider ahead by up to 10 % (ADR 0078 said the floor never lifts, and left chasing to the model); the start ramp linear over **60 s** | **Yes**, to be felt on the tablet ride |
| **R-4** | A refusal still ends the ride's decisions, so the pacer rides #92's rule (D-6), rather than carrying on by the device rule with no lines | **Yes** |
| **R-5** | Should the instance load the model when it starts and keep it loaded (D-4.4)? It holds the model's memory on the PC all the time the instance runs | **Not yet.** Ride with the menu warm-up first; build it if the first line is still slow |
| **R-6** | The plan is dropped, not chosen by rule (D-1.5) | **Yes** |
| **R-7** | The switch still reads *"Let the AI on your instance steer the pacer and cheer you on"*, and once agreed *"The AI will steer the pacer on this ride."* Neither is true of the model any more. This change rewords only the consent paragraph's sentence on what the AI does (D-2.9); the switch and the status line are the owner's approved wording (ADR 0072 R-8) and are measured in the browser gate | **Reword both**, for example *"Ride with the AI pacer: it waits for you, and the AI on your instance cheers you on"* and *"The AI pacer is on for this ride."*, in a follow-up with its screenshots |

### D-10 — The owner's answers

The owner answered D-9 on 2026-11-19, each question asked one at a time with its recommendation,
as recorded in the owner-ruling comment on
[#2864](https://github.com/openzigs/onyourleft/pull/2864):

| # | The owner's answer | What it settles |
|---|---|---|
| **R-1** | *"Approve both (Recommended)"*, given with R-2 | The device decides the pacer's intent by D-1's rule, and the model writes only the line |
| **R-2** | Approved in R-1's answer | No easing while the rider is ahead, from the first ask. This is the owner's yes that #2835 required before ADR 0078's floor changed |
| **R-3** | *"Approve (Recommended)"* | The response whole at 10 s, a rider ahead chased by up to 10 %, and the start ramp from 80 % to the target over 60 s, to be felt on the tablet ride |
| **R-4** | *"Approve both (Recommended)"*, given with R-6 | A refusal ends the ride's decisions, and the pacer rides #92's rule (D-6) |
| **R-5** | *"Not yet (Recommended)"* | The instance does not keep the model loaded from its start (D-4.4). Ride with the menu warm-up first |
| **R-6** | Approved in R-4's answer | The plan is dropped, not chosen by rule (D-1.5) |
| **R-7** | *"Coach wording (Recommended)"* | The consent sentence stands as drafted (*"The app picks how the pacer rides; the AI writes a short line for you and never sets your trainer."*). The switch reads *"Let the AI on your server coach you through the pacer"* and, once agreed, the status line *"The AI will coach you on this ride."*, changed in #2864 with the owner's screenshots. They replace ADR 0072 R-8's switch and status wording |

## Consequences

### What this enables

- **A pacer whose pacing does not depend on a model answering.** A cold load, a slow answer or a
  void one is a line the rider does not see.
- **A rider well under the pacer's setting can come back**: the pacer waits by up to 20 %, not 7 %.
- **A ride that can be explained afterwards**: the log says where the rider was, why the pacer did
  what it did, and what became of each line.

### What this costs, stated plainly

- **The model no longer has any say over the pacing.** ADR 0072's title is now true of the line
  only. A model that would have read the ride better than a straight line through the gap cannot.
- **A device rule that reads the rider is nearer the '637 claim language than a model that does**
  (ADR 0072 D-9). The owner's rulings of 2026-11-16 (*"We are fine with the patent. Put it in."*)
  and of 2026-11-18 on #2835 accept it; **this is not a freedom-to-operate opinion**, nothing was
  searched for it, and #1234's opinion is still read against ADR 0072 D-9 when it arrives.
- **The envelope limits the gentle start.** 80 % of the pacer's power is about 93 % of its speed on
  the flat. If the pacer still *"takes off"* on the tablet, the fix is below 80 %, which is a change
  to the owner's *"80-110 is good"* and a new decision.
- **A rider who stops is left behind at 80 %**, and comes back slowly: the same limit.
- **A slow answer delays the next decision.** One ask is out at a time (ADR 0072 D-5.5), and the
  device decides when it asks, so an answer that takes 10 s holds the decision in force for 10 s
  rather than 5. It cannot lapse: the port's wait is 10 s and a decision holds 15.
- **The story carries numbers the line may not quote.** ADR 0072's 2026-11-17 amendment recorded
  the model quoting the gap in metres, which the screen voids. The prompt forbids it; the screen is
  the rule, and a quoted number now costs that line only.
- **Not measured.** The prompt-token cost of `pacer-6` and its latency against today's 1.2 to
  1.5 s were not measured on the owner's PC by this change, and #2838's scoring harness had no
  branch to run when it was written. Both are owed before the tablet ride.

## What would make this ADR wrong

- **The pacer yo-yos**: easing and lifting in turn as the rider crosses the 2 s band. Then the
  curve needs a dead band or the decision some memory, and that is a change to D-1.3.
- **Most lines are hidden** as `against` or `repeat` on a ride's log: then the prompt is not doing
  its job, and the rider has a silent pacer.
- **A pacer decision reaches a trainer write**, by any path: then ADR 0072 D-6 has failed.
- **Replay diverges under version 2**: then something reads a clock or the rider outside the log.

## Amendments

Appended under [ADR 0013](0013-adr-amendments.md). Nothing above this line has been edited.

- **2026-11-20** — The owner's tablet ride of 2026-11-20 (build `deploy/ride-preview-1120`, 2.3
  W/kg, 128 s) and the owner's four rulings on it, recorded in the comment on
  [#2864](https://github.com/openzigs/onyourleft/pull/2864#issuecomment-7052547100), make
  these figures and statements of the body no longer true; #2864 builds them.
  **1. Gentle start** (*"starts alongside the rider at the rider's speed and builds to its target
  over about 30 s"*): D-3.1's 60 s ramp from #92's 80 % floor is now **30 s**
  (`PACER_START_RAMP_S`) from **the rider's own effort**, their W/kg over the pacer's held to 0 and
  110 % (`pacerStartFrom`), decided every second inside the ramp (`PACER_START_DECIDE_EVERY_S`) and
  kept with each decision as `startFrom`, so the replay still reads it off the log. The pacer may
  therefore ride **below 80 %** in those 30 s, as the rider does pulling away; Consequences' *"the
  fix is below 80 %, which is a change to the owner's 80-110"* is that change, made by the owner.
  **2. The pacer's power on the ride screen**: a *Pacer power* reading, the watts its tick rode and
  what it is doing (`hud/fields.ts` §`pacerPowerReading`, `pacer-doing.ts`), on a tablet; away from
  one it gives way, as the solo draft does. **3. A power range** (*"push almost like a real person
  would do then pull back"*): past the ramp, a hold or a lift surges 4 to 8 % above its target for 8
  to 15 s and recovers half as far below it for as long, in fixed 45 s windows a seeded hash picks,
  one in four steady (`pacerSurgeAt`); never on an ease, and still inside 80 to 110 %. D-1.3's chase
  is now **5 % at 3 s ahead rising to 10 % at 10 s** (`PACER_CHASE_FIRST`, `PACER_CHASE_FIRST_S`),
  where the body's straight line from 2 s gave 1 % at 3 s; the wait is unchanged. **4. Fewer, less
  repetitive lines**: a decision is still made every 5 s (`MODEL_PACER_DECIDE_EVERY_S`), but it asks
  for a line only on the first decision, then no sooner than **30 s** after the last ask and only for
  a new `reason`, or after **60 s** (`MODEL_PACER_SAY_LEAST_S`, `MODEL_PACER_SAY_MOST_S`); a decision
  that asks for none is logged `unasked`. D-2.4's *"the last three lines"* is now the last **ten**
  shown (`MODEL_PACER_REPEAT_MEMORY`), and a line with six in ten of its words in common with one of
  them is a repeat too (`PACER_SAY_SAME_SHARE`); the model is still sent the last three.
  `MODEL_PACER_CODE_VERSION` is **3**, so D-5.3's *"is 2"* is no longer true; a version 2 log, from
  preview builds only, is not replayed under 3 (ADR 0072 D-5). The trainer is unchanged (D-7).
- **2026-11-20** — **D-3.1, and D-7's *"The envelope"*, are superseded in part by
  [ADR 0092](0092-the-ai-pacers-start-rides-from-the-riders-own-effort-below-the-envelope.md)**, accepted on the owner's ruling 1 of that day on #2864. The previous entry's
  start below 80 % is that ADR's decision, not this ADR's: ADR 0072 D-2.2's envelope gives way for
  the first 30 s only, and this ADR's *Leaves standing* and D-7 hold from 30 s on. This ADR's body
  is unchanged.
