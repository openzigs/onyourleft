# ADR 0092: The AI pacer's start rides from the rider's own effort, below the envelope if the rider is — superseding in part ADR 0072 D-2.2 and ADR 0083 D-3.1 and D-7

- **Status**: **Accepted**, 2026-11-20, on the owner's ruling of that day on
  [#2864](https://github.com/openzigs/onyourleft/pull/2864#issuecomment-7052547100), ruling 1
  (*"The pacer starts alongside the rider at the rider's speed and builds to its target over about
  30 s"*), quoted in Context. This ADR records that ruling; it decides nothing the ruling does not
- **Date**: 2026-11-20
- **Deciders**: **the owner**, whose ruling is quoted in Context. **The author** chose the figures
  marked *the author's choice*
- **Issue**: [#2835](https://github.com/openzigs/onyourleft/issues/2835), in its pull request #2864
- **Number**: **0092**, the next free number (`docs/agents/conventions.md` §7). 0091 is claimed by
  the open pull request #2951. The next free number is then **0093**
- **Supersedes, in part**:
  - [ADR 0072](0072-a-model-directs-the-bot-pacer-during-a-ride.md) **D-2.2**'s *"clamped to 80 %
    to 110 % of the flat figure"*, for the first 30 s of a directed ride only: in that time the
    pacer may ride below 80 %, down to 0, when the rider does;
  - [ADR 0083](0083-the-device-decides-the-ai-pacers-intent-and-the-model-writes-the-line.md)
    **D-3.1** (a 60 s ramp from the bottom of the envelope, *"at 80 % at the line whatever the
    decision"*), and **D-7**'s *"The envelope"* under *What does not move*, for the same 30 s.
    ADR 0083's Consequences named this change (*"the fix is below 80 %, which is a change to the
    owner's '80-110 is good' and a new decision"*): this is that decision.

  It is a new ADR because it changes part of an accepted decision, and
  [ADR 0013](0013-adr-amendments.md) D-3 sends a changed decision to a new ADR. ADR 0083's
  2026-11-20 amendment describes the change and is kept; ADR 0072 and ADR 0083 each gain one dated
  `## Amendments` entry pointing here. No body is edited
- **Leaves standing**: #92's 80 % to 110 % envelope **from 30 s on**, the surges and recoveries
  inside it (ADR 0083's 2026-11-20 amendment, point 3), the ceiling of 110 % at every second, no
  power in the model's answer (ADR 0072 D-3), the trainer (ADR 0072 D-6), and the rest of ADR 0072
  and ADR 0083

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
3. **Never above 110 %**, inside the ramp or after it.

### D-3 — What does not move

- **The trainer.** No pacer decision, start or line reaches a trainer write (ADR 0072 D-6).
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

## What would make this ADR wrong

- **The pacer still takes off** on the tablet: then the rider's W/kg is not the rider's speed, and
  the start should read speed.
- **A rider who starts hard is held back** by a pacer pinned to their effort for 30 s: then the
  ramp is too long, *the author's choice* of reading the owner's *"about 30 s"* as exactly 30.
