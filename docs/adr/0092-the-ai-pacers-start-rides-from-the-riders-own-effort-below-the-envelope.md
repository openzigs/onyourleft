# ADR 0092: The AI pacer's start rides from the rider's own effort, below the envelope if the rider is, and a surge alone may reach 115 % — superseding in part ADR 0072 D-2.2 and ADR 0083 D-3.1 and D-7

- **Status**: **Accepted**, 2026-11-20, on the owner's ruling of that day on
  [#2864](https://github.com/openzigs/onyourleft/pull/2864#issuecomment-7052547100), ruling 1
  (*"The pacer starts alongside the rider at the rider's speed and builds to its target over about
  30 s"*), and on the owner's second ruling of that day on
  [#2864](https://github.com/openzigs/onyourleft/pull/2864#issuecomment-7054189148) (*"a surge on its own may reach 115 % of the target for at most 15 s; the chase and
  the plan stay capped at 110 %"*), both quoted in Context. This ADR records those rulings; it
  decides nothing they do not, apart from the one reading D-4.3 marks as *the author's*. D-4 was
  added before this ADR reached `main`, so the ADR was extended rather than amended
- **Date**: 2026-11-20
- **Deciders**: **the owner**, whose ruling is quoted in Context. **The author** chose the figures
  marked *the author's choice*
- **Issue**: [#2835](https://github.com/openzigs/onyourleft/issues/2835), in its pull request #2864
- **Number**: **0092**, the next free number (`docs/agents/conventions.md` §7). 0091 is claimed by
  the open pull request #2951. The next free number is then **0093**
- **Supersedes, in part**:
  - [ADR 0072](0072-a-model-directs-the-bot-pacer-during-a-ride.md) **D-2.2**'s *"clamped to 80 %
    to 110 % of the flat figure"*, for the first 30 s of a directed ride only: in that time the
    pacer may ride below 80 %, down to 0, when the rider does; and **its ceiling for a surge
    only**: past the first 30 s a surge may take the pacer above 110 %, to 115 %, for at most 15 s
    (D-4);
  - [ADR 0083](0083-the-device-decides-the-ai-pacers-intent-and-the-model-writes-the-line.md)
    **D-3.1** (a 60 s ramp from the bottom of the envelope, *"at 80 % at the line whatever the
    decision"*), and **D-7**'s *"The envelope"* under *What does not move*, for the same 30 s and
    for a surge (D-4), and its 2026-11-20 amendment's surges *"inside 80..110 %"* (point 3), for
    the ceiling only.
    ADR 0083's Consequences named this change (*"the fix is below 80 %, which is a change to the
    owner's '80-110 is good' and a new decision"*): this is that decision.

  It is a new ADR because it changes part of an accepted decision, and
  [ADR 0013](0013-adr-amendments.md) D-3 sends a changed decision to a new ADR. ADR 0083's
  2026-11-20 amendment describes the change and is kept; ADR 0072 and ADR 0083 each gain one dated
  `## Amendments` entry pointing here. No body is edited
- **Leaves standing**: #92's 80 % to 110 % envelope **from 30 s on** for the plan and the intent,
  the chase among them; the floor of 80 % from 30 s on, a recovery included; the surges and
  recoveries' shape, depth and windows (ADR 0083's 2026-11-20 amendment, point 3); the ceiling of
  110 % inside the start ramp and for everything but a surge; no power in the model's answer (ADR
  0072 D-3), the trainer (ADR 0072 D-6), and the rest of ADR 0072 and ADR 0083

## Context

On the owner's tablet ride of 2026-11-20 (build `deploy/ride-preview-1120`, pacer at 2.3 W/kg,
128 s) the saved decision log had the gap at −28.6 s five seconds in: ADR 0083 D-3's ramp from 80 %
was still far faster than a rider pulling away from the line. ADR 0083's Consequences had said so in
advance: 80 % of the pacer's power is about 93 % of its speed on the flat, and the only fix is below
the envelope. The owner ruled, on #2864:

> "**Gentle start.** The pacer starts alongside the rider at the rider's speed and builds to its
> target over about 30 s."

A pacer that starts at the rider's speed starts below 80 % whenever the rider does, so the ruling
moves the envelope's floor for the start, which ADR 0072 D-2.2 fixed and ADR 0083 D-7 left standing.

The same ruling asked for *"a power range"*, ridden *"almost like a real person would do then pull
back"*, which ADR 0083's 2026-11-20 amendment built as surges of 4 to 8 % held inside the envelope.
Inside it, a pacer whose target is already near 110 % (a climb, or a chase at its whole share) has
almost no room to surge. Later that day the owner ruled, on [#2864](https://github.com/openzigs/onyourleft/pull/2864#issuecomment-7054189148):

> "**a surge on its own may reach 115 % of the target for at most 15 s**; the chase and the plan
> stay capped at 110 %."

That moves the envelope's ceiling, which ADR 0072 D-2.2 fixed, for a surge only.

## Decision

### D-1 — Where the start begins

1. **The start ramp begins at the rider's own effort**: the rider's W/kg over the pacer's, in
   hundredths, held to **0** and to the envelope's ceiling, **110 %** (`@onyourleft/domain`
   §`pacerStartFrom`). At the same W/kg the pacer, at its 75 kg, rides about the rider's speed. A
   rider with no live power gives 0, so a rider who is not pedalling is not left behind.
2. **It is decided every second inside the ramp** (`PACER_START_DECIDE_EVERY_S`) and kept with each
   decision as `startFrom`, so a stored ride replays from its log alone (ADR 0072 D-5).

### D-2 — How long it lasts, and the envelope after it

1. **The ramp lasts 30 s** (`PACER_START_RAMP_S`, the owner's *"about 30 s"*), linear in power from
   `startFrom` to what the decision in force asks (§`directedPacingFactor`), so the pacer reaches its
   target at 30 s with no step.
2. **Below 80 % only inside the ramp.** From 30 s on, every direction is clamped to #92's 80 % to
   110 % as before, whatever it is handed: `packages/domain/src/pacer/model-pacer.test.ts`, *"never
   takes the pacer outside #92's envelope past the ramp, whatever it is handed"*.
3. **Never above 110 % inside the ramp.** After it, only a surge goes above 110 % (D-4).

### D-4 — A surge alone may reach 115 %, for at most 15 s

1. **The plan and the intent are held to 110 % first.** `directedPacingFactor` clamps the plan's
   factor times the intent's to #92's 80 % to 110 %, as before, so neither the plan nor the chase
   (`lift`, to its whole 10 %) can pass 110 % on its own.
2. **Then the surge, and only the surge, may carry it to 115 %**
   (`PACER_SURGE_CEILING`): the held figure times one plus the surge, clamped to 80 % and 115 %.
   With no surge in force the pacer is at most 110 %, exactly as before. The surge's depth is
   unchanged, 4 to 8 % (`PACER_SURGE_LEAST`, `PACER_SURGE_MOST`), so 115 % is reached only from a
   target at or near the top of the envelope.
3. **A surge on a chase counts as a surge.** *The author's reading* of the owner's *"a surge on
   its own"*: it is the surge, and nothing else, that can take the pacer past 110 %, so a pacer at
   a chase's 110 % that is also in a surge window may ride to 115 % for that surge. The chase
   itself stays at 110 %.
4. **At most 15 s.** A surge is held for 8 to 15 s (`PACER_SURGE_HELD_LEAST_S`,
   `PACER_SURGE_HELD_MOST_S`), its edges included, and a recovery of half its depth follows it at
   once, so the pacer is above 110 % for 15 s at the most at a time and never in two windows back
   to back.
5. **Never while waiting, never in the ramp.** A pacer easing for a rider does not surge
   (`pacerAsRidden`), and the start ramp has no surge, so neither can pass 110 %.
6. **Replay is unchanged in kind**: the surge is a function of the seconds ridden alone, so a stored
   ride replays from its log (ADR 0072 D-5). `MODEL_PACER_CODE_VERSION` stays 3: version 3 has not
   reached `main` or a rider's saved ride, so no log rides by the old ceiling.

Tested in `packages/domain/src/pacer/model-pacer.test.ts` (*"a surge alone may reach 115 % for
15 s"*), through the physics in `packages/physics/src/pacer.test.ts`, and on the shipped path in
`apps/web/src/game/simulation.test.ts` and `apps/web/src/game/model-pacer-wiring.test.tsx`, which
rides past 110 % in a surge and compares every trainer write with an undirected ride.

### D-3 — What does not move

- **The trainer.** No pacer decision, start, surge or line reaches a trainer write (ADR 0072
  D-6): the surge moves the bot, never the rider's resistance or an ERG target.
- **A rider with no instance, no consent or the switch off** rides #92's pacer, whose start is
  unchanged.

## Consequences

- The pacer leaves the line with the rider rather than 28 s up the road, which is what the owner
  asked for.
- **A pacer can ride far below its advertised W/kg for up to 30 s**, as low as 0 behind a rider who
  is not pedalling. That is the ruling's intent; the ride average is still not held (ADR 0072
  D-2.4).
- `startFrom` is a new field in each decision of the log, and `MODEL_PACER_CODE_VERSION` is 3 (ADR
  0083's 2026-11-20 amendment).
- **A pacer can ride 15 % over its flat figure for up to 15 s** (D-4), so a rider on its wheel at the
  top of the envelope sees it go away for a moment, then come back in the recovery. That is the
  ruling's *"push … then pull back"*.

## What would make this ADR wrong

- **The pacer still takes off** on the tablet: then the rider's W/kg is not the rider's speed, and
  the start should read speed.
- **A rider who starts hard is held back** by a pacer pinned to their effort for 30 s: then the
  ramp is too long, *the author's choice* of reading the owner's *"about 30 s"* as exactly 30.
- **The owner meant no surge above 110 % on a chase**: then D-4.3 is the wrong reading of *"a surge
  on its own"*, and a surge on a `lift` should be held to 110 %.
